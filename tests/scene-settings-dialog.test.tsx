// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import demoShow from "../examples/Demo-Session.lumina.json";
import { captureSongScene } from "../src/song-scenes";
import { validateShow } from "../src/storage";

// Keep App, its modal event handlers and SongSceneEditor real. Only GPU work
// and unavailable host services are replaced; no browser is launched.
vi.mock("../src/renderer", () => ({
  VJRenderer: class {
    setAssets() {}
    dispose() {}
  },
}));
vi.mock("../src/thumbnail", () => ({
  generateProceduralThumbnails: vi.fn(async () => new Map()),
}));

const dialogSelector = '[role="dialog"][aria-label="シーン設定"]';
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
let container: HTMLDivElement;
let root: Root;
let songs: { id: string; title: string }[];

function required<T extends Element>(
  selector: string,
  scope: ParentNode = container,
): T {
  const element = scope.querySelector<T>(selector);
  expect(element, `Expected ${selector}`).not.toBeNull();
  return element!;
}

function button(name: string, scope: ParentNode = container) {
  const element = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  expect(element, `Expected button ${name}`).toBeDefined();
  return element!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function currentSong() {
  return required<HTMLSelectElement>('select[aria-label="現在の曲"]');
}

function expectSceneDialog(songIndex: number) {
  expect(container.querySelectorAll(dialogSelector)).toHaveLength(1);
  const dialog = required<HTMLElement>(dialogSelector);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.classList.contains("song-scenes-modal")).toBe(true);
  expect(dialog.closest(".modal-backdrop")).not.toBeNull();
  expect(dialog.closest(".content-panel")).toBeNull();
  expect(dialog.closest('[hidden], [aria-hidden="true"]')).toBeNull();
  expect(required("h2", dialog).textContent).toBe("シーン設定");
  expect(
    required<HTMLSelectElement>(
      'select[aria-label="シーンを編集する曲"]',
      dialog,
    ).value,
  ).toBe(songs[songIndex].id);
  const editor = required<HTMLElement>(".song-scene-editor", dialog);
  expect(editor.getAttribute("aria-label")).toBe(
    `${songs[songIndex].title} のシーン設定`,
  );
  expect(
    required<HTMLInputElement>('input[aria-label="1番目のシーン名"]', editor)
      .value,
  ).toBe(`Saved scene ${songIndex + 1}`);
  // A clipped inline editor would still exist in the DOM. Require the real
  // editor to live solely in the dialog outside the scrolling content panel.
  expect(container.querySelectorAll(".song-scene-editor")).toHaveLength(1);
  expect(
    required(".content-panel").querySelector(".song-scene-editor"),
  ).toBeNull();
  return dialog;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage = null;
      postMessage() {}
      close() {}
    },
  );
  // Suppress the render loop; the dialog does not depend on animation frames.
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.clear();
  const show = validateShow(JSON.stringify(demoShow));
  show.songs = show.songs.slice(0, 2).map((song, index) => ({
    ...song,
    scenes: [
      captureSongScene(show, `Saved scene ${index + 1}`, `scene-${index + 1}`),
    ],
  }));
  songs = show.songs;
  localStorage.setItem("lumina-autosave", JSON.stringify(show));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
  expect(currentSong().value).toBe(songs[0].id);
  expect(container.querySelector(dialogSelector)).toBeNull();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  localStorage.clear();
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scene settings dialog opened from the real App", () => {
  it("opens from the top transport while the library is displayed", async () => {
    expect(required(".content-panel").getAttribute("aria-label")).toBe(
      "素材一覧",
    );
    await click(button("シーン設定", required(".transport")));
    expectSceneDialog(0);
    expect(currentSong().value).toBe(songs[0].id);
  });

  it.each(["Escape", "close button"])(
    "reopens the same song from the top transport on the setlist after closing with %s",
    async (closeWith) => {
      await click(button("セットリスト"));
      expect(required(".content-panel").getAttribute("aria-label")).toBe(
        "セットリスト編集",
      );
      const trigger = button("シーン設定", required(".transport"));
      await click(trigger);
      const dialog = expectSceneDialog(0);
      if (closeWith === "Escape") {
        await act(async () => {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
      } else {
        await click(
          required<HTMLButtonElement>('button[aria-label="閉じる"]', dialog),
        );
      }
      expect(container.querySelector(dialogSelector)).toBeNull();
      expect(container.querySelector(".song-scene-editor")).toBeNull();
      await click(trigger);
      expectSceneDialog(0);
      expect(currentSong().value).toBe(songs[0].id);
    },
  );

  it.each([0, 1])(
    "opens setlist row %i without loading that song into the live transport",
    async (index) => {
      await click(button("セットリスト"));
      const row =
        container.querySelectorAll<HTMLElement>(".setlist-row")[index];
      const trigger = [...row.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.trim().startsWith("シーン設定"),
      );
      expect(trigger).toBeDefined();
      await click(trigger!);
      const dialog = expectSceneDialog(index);
      expect(currentSong().value).toBe(songs[0].id);
      expect(
        required<HTMLInputElement>(
          '.setlist-row.current input[aria-label="曲1名前"]',
        ).value,
      ).toBe(songs[0].title);
      const recall = button("呼び出す（即時）", dialog);
      expect(recall.disabled).toBe(index !== 0);
    },
  );

  it("changes the song being edited inside the dialog without switching the live song", async () => {
    await click(button("シーン設定", required(".transport")));
    const dialog = expectSceneDialog(0);
    const picker = required<HTMLSelectElement>(
      'select[aria-label="シーンを編集する曲"]',
      dialog,
    );
    await act(async () => {
      picker.value = songs[1].id;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expectSceneDialog(1);
    expect(currentSong().value).toBe(songs[0].id);
    expect(button("呼び出す（即時）", dialog).disabled).toBe(true);
  });
});
