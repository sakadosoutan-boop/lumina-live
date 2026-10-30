// @vitest-environment jsdom
import demoShow from "../examples/Demo-Session.lumina.json";
import publicCatalog from "../docs/assets/catalog.json";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SongSceneEditor } from "../src/SongSceneEditor";
import { captureSongScene } from "../src/song-scenes";
import { validateAssetCatalog, validateShow } from "../src/storage";
import type { SongScene } from "../src/types";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(missing = false) {
  const show = validateShow(JSON.stringify(demoShow));
  const catalog = validateAssetCatalog(publicCatalog);
  show.assets.push(
    ...catalog.filter(
      (a) => !missing || a.id !== "original-wasurete-empty-room",
    ),
  );
  const saved = captureSongScene(show, "保存済みのイントロ", "saved-intro");
  const song = {
    ...show.songs[0],
    title: "ヨルシカ / 忘れてください",
    scenes: [saved],
  };
  const onChange = vi.fn();
  let serial = 0;
  await act(async () =>
    root.render(
      <SongSceneEditor
        song={song}
        show={show}
        currentSongId={song.id}
        activeSceneId=""
        thumbnails={new Map()}
        createId={() => `story-${++serial}`}
        onChange={onChange}
        onRecall={vi.fn()}
        onNotice={vi.fn()}
        onSave={vi.fn()}
      />,
    ),
  );
  return { saved, onChange };
}

it("adds the four actual room-story videos in order without replacing saved scenes or using Canva alternatives", async () => {
  const { saved, onChange } = await render();
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "家の外観→空室の4シーンを追加",
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(onChange).toHaveBeenCalledTimes(1);
  const scenes = onChange.mock.calls[0][0] as SongScene[];
  expect(scenes).toHaveLength(5);
  expect(scenes[0]).toBe(saved);
  expect(scenes.slice(1).map((s) => s.name)).toEqual([
    "家の外観",
    "生活のある部屋",
    "物が消えていく部屋",
    "何もなくなった部屋",
  ]);
  expect(scenes.slice(1).map((s) => s.decks[0].assetId)).toEqual([
    "original-wasurete-exterior",
    "original-wasurete-lived-in-room",
    "original-wasurete-emptying-room",
    "original-wasurete-empty-room",
  ]);
  expect(
    scenes
      .slice(1)
      .every((s) => s.decks[0].speed === 1 && !s.decks[0].beatSync),
  ).toBe(true);
});

it("does not offer a partial story pack when a required clip is unavailable", async () => {
  await render(true);
  expect(container.textContent).not.toContain("家の外観→空室の4シーンを追加");
});
