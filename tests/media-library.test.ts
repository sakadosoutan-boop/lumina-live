import { expect, it, vi } from "vitest";
import { downloadMediaBlob, mergeAssetCatalog } from "../src/media-library";
import type { Asset } from "../src/types";
const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  kind: "video",
  tags: [],
  hue: 0,
  energy: 0.5,
  license: "CC0",
  ...extra,
});
it("preserves cached/connected files, upgrades stale URLs and adds new online assets without duplicates", () => {
  const result = mergeAssetCatalog(
    [
      asset("a", { url: "blob:https://example.com/local", favorite: true }),
      asset("b", { url: undefined, status: "missing" }),
    ],
    [
      asset("a", { url: "./assets/a.mp4", tags: ["web-library"] }),
      asset("b", { url: "./assets/b.mp4" }),
      asset("c"),
    ],
  );
  expect(result.map((a) => a.id)).toEqual(["a", "b", "c"]);
  expect(result[0].url).toContain("blob:");
  expect(result[0].favorite).toBe(true);
  expect(result[0].tags).toContain("web-library");
  expect(result[1].url).toBe("./assets/b.mp4");
});
it("rejects an oversized chunked download and an HTML error page", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(20), {
          headers: { "content-type": "video/mp4" },
        }),
    ) as typeof fetch;
    await expect(
      downloadMediaBlob(
        "https://example.com/a.mp4",
        new AbortController().signal,
        10,
      ),
    ).rejects.toThrow("上限");
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<!doctype html>", {
          headers: { "content-type": "text/html" },
        }),
    ) as typeof fetch;
    await expect(
      downloadMediaBlob(
        "https://example.com/a.mp4",
        new AbortController().signal,
      ),
    ).rejects.toThrow("見つかりません");
  } finally {
    globalThis.fetch = original;
  }
});
it("reconnecting a folder replaces an old blob while keeping favorites and online collection membership", () => {
  const result = mergeAssetCatalog(
    [asset("a", { url: "blob:cached", favorite: true, tags: ["web-library"] })],
    [asset("a", { url: "blob:folder", tags: ["folder-connected"] })],
    true,
  );
  expect(result[0].url).toBe("blob:folder");
  expect(result[0].favorite).toBe(true);
  expect(result[0].tags).toEqual(["web-library", "folder-connected"]);
});
