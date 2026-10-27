import { afterEach, expect, it, vi } from "vitest";
import {
  MEDIA_ACCEPT,
  mediaType,
  prepareImportedMedia,
} from "../src/import-media";

const urls: string[] = [];
afterEach(() => {
  urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  vi.restoreAllMocks();
});
it("recognizes provider files with empty/generic MIME and uppercase extensions", () => {
  for (const type of ["", "application/octet-stream"]) {
    expect(mediaType({ name: "ライブ.MP4", type })).toBe("video/mp4");
    expect(mediaType({ name: "loop.WebM", type })).toBe("video/webm");
  }
  expect(mediaType({ name: "clip", type: "video/mp4" })).toBe("video/mp4");
  expect(
    mediaType({ name: "clip.exe", type: "application/octet-stream" }),
  ).toBeUndefined();
  expect(MEDIA_ACCEPT).toContain(".mp4");
});
it("normalizes unknown MIME for playback and stores the same readable bytes", async () => {
  const persist = vi.fn(async (_id: string, _blob: Blob) => {});
  const { asset, saved } = await prepareImportedMedia(
    new File(["test video"], "clip.mp4"),
    undefined,
    persist,
  );
  urls.push(asset.url!);
  expect(saved).toBe(true);
  expect(asset.kind).toBe("video");
  const blob = persist.mock.calls[0][1] as Blob;
  expect(blob.type).toBe("video/mp4");
  expect(await blob.text()).toBe("test video");
  expect(await (await fetch(asset.url!)).text()).toBe("test video");
});
it.each(["QuotaExceededError", "SecurityError", "AbortError", "timeout"])(
  "still imports when persistent storage fails: %s",
  async (name) => {
    const { asset, saved } = await prepareImportedMedia(
      new File(["new"], "clip.mp4"),
      undefined,
      async () => {
        throw new Error(name);
      },
    );
    urls.push(asset.url!);
    expect(saved).toBe(false);
    expect(asset.tags).toContain("session-only");
    expect(await (await fetch(asset.url!)).text()).toBe("new");
  },
);
it("successful reimport clears session-only and retains asset/deck identity", async () => {
  const first = await prepareImportedMedia(
    new File(["old"], "clip.mp4"),
    undefined,
    async () => {
      throw Error();
    },
  );
  const second = await prepareImportedMedia(
    new File(["new"], "clip.mp4"),
    first.asset,
    async () => {},
  );
  urls.push(first.asset.url!, second.asset.url!);
  expect(second.asset.id).toBe(first.asset.id);
  expect(second.asset.tags).not.toContain("session-only");
  expect(second.saved).toBe(true);
});
it("rejects unreadable and empty files before claiming they are usable", async () => {
  const persist = vi.fn(async () => {});
  await expect(
    prepareImportedMedia(new File([], "empty.mp4"), undefined, persist),
  ).rejects.toThrow("空のファイル");
  const file = new File(["data"], "cloud.mp4");
  vi.spyOn(file, "slice").mockImplementation(() => {
    throw Error("unavailable");
  });
  await expect(prepareImportedMedia(file, undefined, persist)).rejects.toThrow(
    "ダウンロード",
  );
  expect(persist).not.toHaveBeenCalled();
});
