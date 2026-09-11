import { describe, expect, it, vi } from "vitest";
import { planFolderLibrary } from "../src/folder-library";
import type { Asset } from "../src/types";

function file(
  path: string,
  type = "",
  contents = "media",
  lastModified = 123,
): File {
  const result = new File([contents], path.split("/").at(-1)!, {
    type,
    lastModified,
  });
  Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result;
}
function asset(id = "clip", patch: Partial<Asset> = {}): Asset {
  return {
    id,
    name: "Curated clip",
    kind: "video",
    url: `/assets/media/prepared/${id}.mp4`,
    tags: ["cc0", "loop"],
    hue: 123,
    energy: 0.8,
    license: "CC0-1.0",
    source: "https://example.org/credits",
    attribution: "Original artist",
    duration: 12,
    bpm: 120,
    beats: 8,
    bytes: 99,
    favorite: true,
    status: "prepared",
    ...patch,
  };
}
const catalogFile = (value: unknown) =>
  file("pack/assets/catalog.json", "application/json", JSON.stringify(value));

describe("planFolderLibrary curated catalogs", () => {
  it.each([
    "assets/media/prepared/clip.mp4",
    "media/prepared/clip.mp4",
    "selected/assets/media/prepared/clip.mp4",
    "selected/media/prepared/clip.mp4",
  ])("matches complete anchored segments: %s", async (path) => {
    const media = file(path);
    const row = asset();
    const result = await planFolderLibrary([media], [row]);
    expect(result).toEqual({
      entries: [{ asset: row, file: media }],
      missing: 0,
      skipped: 0,
    });
    expect(result.entries[0].asset).not.toBe(row);
    expect(result.entries[0].asset.tags).not.toBe(row.tags);
  });

  it("uses the selected curated catalog, preserving metadata and ignoring originals/extras", async () => {
    const row = asset("clip", {
      thumbnail: "/assets/media/thumbnails/clip.jpg",
    });
    const chosen = catalogFile([
      row,
      asset("generated", {
        kind: "procedural",
        url: undefined,
        visual: "plasma",
        seed: 0,
      }),
    ]);
    const media = file("pack/media/prepared/clip.mp4");
    const preview = file("pack/media/thumbnails/clip.jpg");
    const extras = [
      file("pack/media/originals/clip.mp4"),
      file("pack/media/prepared/extra.mp4"),
      file("pack/ORGY_01.mp4"),
    ];
    const result = await planFolderLibrary(
      [chosen, media, preview, ...extras],
      [asset("other")],
    );
    expect(result).toEqual({
      entries: [{ asset: row, file: media, thumbnail: preview }],
      skipped: 3,
      missing: 0,
    });
  });

  it("treats an empty catalog as authoritative", async () => {
    expect(await planFolderLibrary([file("pack/extra.mp4")], [])).toEqual({
      entries: [],
      skipped: 1,
      missing: 0,
    });
  });

  it("counts unavailable media, but not procedural rows or unavailable thumbnails", async () => {
    const media = file("media/prepared/clip.mp4");
    const result = await planFolderLibrary(
      [media],
      [
        asset("clip", { thumbnail: "/assets/media/thumbnails/missing.jpg" }),
        asset("absent"),
        asset("no-url", { url: undefined }),
        asset("generated", { kind: "procedural", url: undefined }),
      ],
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].thumbnail).toBeUndefined();
    expect(result.missing).toBe(2);
  });

  it.each([
    ["a/media/prepared/clip.mp4", "b/media/prepared/clip.mp4"],
    ["assets/media/prepared/clip.mp4", "media/prepared/clip.mp4"],
    ["media/prepared/clip.mp4", "media/prepared/clip.mp4"],
  ])(
    "skips ambiguous paths, even with an exact candidate (%s, %s)",
    async (a, b) => {
      expect(await planFolderLibrary([file(a), file(b)], [asset()])).toEqual({
        entries: [],
        skipped: 2,
        missing: 1,
      });
    },
  );

  it("skips multiple catalog rows claiming the same file", async () => {
    const result = await planFolderLibrary(
      [file("media/prepared/clip.mp4")],
      [asset(), asset("alias", { url: "/media/prepared/clip.mp4" })],
    );
    expect(result).toEqual({ entries: [], skipped: 1, missing: 2 });
  });

  it("does not guess from filenames, partial segments or nonmatching case", async () => {
    const files = [
      "clip.mp4",
      "prepared/clip.mp4",
      "mymedia/prepared/clip.mp4",
      "media/prepared/CLIP.mp4",
      "media/originals/clip.mp4",
    ].map((path) => file(path));
    expect(await planFolderLibrary(files, [asset()])).toEqual({
      entries: [],
      skipped: 5,
      missing: 1,
    });
  });

  it("decodes safe local URL segments and supports a direct media child", async () => {
    const media = file("pack/media/my clip.mp4");
    expect(
      (
        await planFolderLibrary(
          [media],
          [asset("clip", { url: "./media/my%20clip.mp4" })],
        )
      ).entries[0].file,
    ).toBe(media);
  });

  it.each([
    "https://example.org/assets/media/prepared/clip.mp4",
    "/assets/media/prepared/clip.mp4?download=1",
    "blob:https://example.org/clip",
  ])("does not resolve external or decorated URLs: %s", async (url) => {
    expect(
      await planFolderLibrary(
        [file("media/prepared/clip.mp4")],
        [asset("clip", { url })],
      ),
    ).toEqual({ entries: [], skipped: 1, missing: 1 });
  });

  it("ignores ambiguous thumbnails without losing matched media", async () => {
    const media = file("media/prepared/clip.mp4");
    const result = await planFolderLibrary(
      [
        media,
        file("a/media/thumbnails/clip.jpg"),
        file("b/media/thumbnails/clip.jpg"),
      ],
      [asset("clip", { thumbnail: "/media/thumbnails/clip.jpg" })],
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].thumbnail).toBeUndefined();
    expect(result.skipped).toBe(2);
    expect(result.missing).toBe(0);
  });
});

describe("folder catalog validation and bounds", () => {
  it.each(["{", "null", "{}", '[{"id":"broken"}]'])(
    "rejects malformed catalog %s without generic fallback",
    async (text) => {
      await expect(
        planFolderLibrary([
          file("pack/catalog.json", "", text),
          file("pack/extra.mp4"),
        ]),
      ).rejects.toThrow();
    },
  );

  it("validates provided catalogs too", async () => {
    await expect(
      planFolderLibrary([], [asset("clip", { energy: NaN })]),
    ).rejects.toThrow();
    await expect(planFolderLibrary([], [asset(), asset()])).rejects.toThrow();
  });

  it("rejects multiple catalogs even when a provided catalog exists", async () => {
    await expect(
      planFolderLibrary(
        [catalogFile([]), file("other/catalog.json", "", "[]")],
        [],
      ),
    ).rejects.toThrow(/Multiple/);
  });

  it("checks catalog size before reading; accepts exactly 10 MiB", async () => {
    const chosen = file(
      "catalog.json",
      "",
      "[]" + " ".repeat(10 * 1024 * 1024 - 2),
    );
    expect(await planFolderLibrary([chosen])).toEqual({
      entries: [],
      skipped: 0,
      missing: 0,
    });
    const huge = file("catalog.json");
    Object.defineProperty(huge, "size", { value: 10 * 1024 * 1024 + 1 });
    const read = vi.spyOn(huge, "text");
    await expect(planFolderLibrary([huge])).rejects.toThrow(/10 MiB/);
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts BOM JSON and propagates read failures", async () => {
    expect(
      (await planFolderLibrary([file("catalog.json", "", "\uFEFF[]")])).entries,
    ).toEqual([]);
    const broken = catalogFile([]);
    vi.spyOn(broken, "text").mockRejectedValue(new Error("unreadable"));
    await expect(planFolderLibrary([broken])).rejects.toThrow("unreadable");
  });

  it.each([
    "../media/prepared/clip.mp4",
    "pack/./media/prepared/clip.mp4",
    "pack/%2e%2e/media/prepared/clip.mp4",
    "pack/%252e%252e/media/prepared/clip.mp4",
    "pack%2fmedia/prepared/clip.mp4",
    "pack\\media/prepared/clip.mp4",
    "//media/prepared/clip.mp4",
    "C:/media/prepared/clip.mp4",
  ])("rejects unsafe selected path: %s", async (path) => {
    expect((await planFolderLibrary([file(path)], [asset()])).missing).toBe(1);
    expect((await planFolderLibrary([file(path)])).entries).toEqual([]);
  });

  it.each([
    "/assets/media/../prepared/clip.mp4",
    "/assets/media/%2e%2e/prepared/clip.mp4",
    "/assets/media/%252e%252e/prepared/clip.mp4",
    "//example.org/media/prepared/clip.mp4",
  ])("rejects unsafe catalog paths: %s", async (url) => {
    await expect(
      planFolderLibrary(
        [file("media/prepared/clip.mp4")],
        [asset("clip", { url })],
      ),
    ).rejects.toThrow();
  });

  it("bounds file counts and individual paths", async () => {
    await expect(
      planFolderLibrary(Array(100001).fill(file("clip.mp4"))),
    ).rejects.toThrow(/100,000/);
    const result = await planFolderLibrary([
      file("x".repeat(8193) + ".mp4"),
      file("dir/".repeat(65) + "clip.mp4"),
    ]);
    expect(result).toEqual({ entries: [], skipped: 2, missing: 0 });
  });
});

describe("generic folder planning", () => {
  it("recognizes every supported extension with empty MIME", async () => {
    const extensions = [
      "mp4",
      "webm",
      "mov",
      "m4v",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "avif",
    ];
    const result = await planFolderLibrary(
      extensions.map((ext, i) => file(`pack/clip${i}.${ext.toUpperCase()}`)),
    );
    expect(result.entries.map((entry) => entry.asset.kind)).toEqual([
      ...Array(4).fill("video"),
      ...Array(6).fill("image"),
    ]);
    expect(result.skipped).toBe(0);
    expect(result.missing).toBe(0);
  });

  it("uses recognized MIME and falls back to extension for generic MIME", async () => {
    const result = await planFolderLibrary([
      file("pack/movie", "video/quicktime"),
      file("pack/picture.bin", "image/png"),
      file("pack/clip.mp4", "application/octet-stream"),
    ]);
    expect(result.entries.map((entry) => entry.asset.kind)).toEqual([
      "video",
      "image",
      "video",
    ]);
  });

  it("filters thumbnail directories, paired JPEGs, legacy excluded filenames and unrelated files", async () => {
    const files = [
      file("pack/clip.mp4"),
      file("pack/clip.JPG"),
      file("pack/stills/clip.jpeg"),
      file("pack/thumbnails/unique.png"),
      file("pack/Thumbs/other.webp"),
      file("pack/ORGY_01.mp4"),
      file("pack/01-orgy.mov"),
      file("pack/notes.txt"),
      file("pack/unique.jpg"),
    ];
    const result = await planFolderLibrary(files);
    expect(result.entries.map((entry) => entry.file.name)).toEqual([
      "clip.mp4",
      "unique.jpg",
    ]);
    expect(result.skipped).toBe(7);
  });

  it("keeps separate same-basename clips, but skips identical relative paths", async () => {
    const result = await planFolderLibrary([
      file("pack/a/clip.mp4"),
      file("pack/b/clip.mp4"),
      file("pack/c/clip.mp4"),
      file("pack/c/clip.mp4"),
    ]);
    expect(result.entries).toHaveLength(2);
    expect(new Set(result.entries.map((entry) => entry.asset.id)).size).toBe(2);
    expect(result.skipped).toBe(2);
  });

  it("creates stable metadata IDs without reading media or creating URLs", async () => {
    const media = file("pack/clip.mp4");
    const text = vi.spyOn(media, "text");
    const bytes = vi.spyOn(media, "arrayBuffer");
    const objectUrl = vi.spyOn(URL, "createObjectURL");
    try {
      const first = await planFolderLibrary([media]);
      const again = await planFolderLibrary([file("pack/clip.mp4")]);
      expect(first.entries[0].asset.id).toBe(again.entries[0].asset.id);
      const variants = await planFolderLibrary(
        [
          file("pack/other.mp4"),
          file("pack/clip.mp4", "", "larger", 123),
          file("pack/clip.mp4", "", "media", 124),
        ].slice(0, 1),
      );
      const resized = await planFolderLibrary([
        file("pack/clip.mp4", "", "larger", 123),
      ]);
      const retimed = await planFolderLibrary([
        file("pack/clip.mp4", "", "media", 124),
      ]);
      expect(
        new Set(
          [first, variants, resized, retimed].map((r) => r.entries[0].asset.id),
        ).size,
      ).toBe(4);
      expect(first.entries[0].asset.url).toBeUndefined();
      expect(first.entries[0].asset.thumbnail).toBeUndefined();
      expect(text).not.toHaveBeenCalled();
      expect(bytes).not.toHaveBeenCalled();
      expect(objectUrl).not.toHaveBeenCalled();
    } finally {
      objectUrl.mockRestore();
    }
  });

  it("handles an empty selection and ordinary File without webkitRelativePath", async () => {
    expect(await planFolderLibrary([])).toEqual({
      entries: [],
      skipped: 0,
      missing: 0,
    });
    expect(
      (
        await planFolderLibrary([
          new File(["video"], "clip.mp4", { lastModified: 1 }),
        ])
      ).entries,
    ).toHaveLength(1);
  });
});
