import { expect, it } from "vitest";
import { defaultLayout, fitSidePanels, parseLayout } from "../src/layout";

it("loads old, unavailable and damaged preferences without blocking the console", () => {
  for (const value of [null, "{broken", "null", "[]", "false"])
    expect(parseLayout(value)).toEqual(defaultLayout);
  expect(
    parseLayout('{"thumbnail":"999","preview":null,"lyrics":-8,"monitor":999}'),
  ).toEqual({ ...defaultLayout, lyrics: 210, monitor: 0.75 });
});
it("retains valid independent display preferences and ignores unknown fields", () => {
  const layout = {
    ...defaultLayout,
    sidebar: 200,
    preview: 0.5,
    thumbnail: 260,
  };
  expect(
    parseLayout(JSON.stringify({ ...layout, master: 0, assets: [] })),
  ).toEqual(layout);
  expect(defaultLayout.thumbnail).toBe(200);
});
it.each([1000, 1024, 1280, 1366, 1920, 3840])(
  "keeps usable center and side panels at %ipx after restoring a large layout",
  (width) => {
    const requested = { ...defaultLayout, sidebar: 280, lyrics: 440 };
    const fitted = fitSidePanels(width, requested);
    expect(fitted.sidebar).toBeGreaterThanOrEqual(120);
    expect(fitted.lyrics).toBeGreaterThanOrEqual(210);
    expect(width - fitted.sidebar - fitted.lyrics - 16).toBeGreaterThanOrEqual(
      460,
    );
    expect(requested.sidebar).toBe(280);
    expect(requested.lyrics).toBe(440);
  },
);
