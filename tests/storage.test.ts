import { afterEach, describe, expect, it, vi } from "vitest";
import { builtInAssets } from "../src/catalog";
import { distributeLyrics, parseLrc } from "../src/sync";
import type { Asset, Deck, Show } from "../src/types";
import {
  downloadFile,
  restoreMedia,
  revokeMediaUrls,
  serializeShow,
  storeMedia,
  validateShow,
} from "../src/storage";
import { OutputMediaBridge } from "../src/output-media";

const asset = (id = "clip", patch: Partial<Asset> = {}): Asset => ({
  id,
  name: "Clip",
  kind: "video",
  tags: ["local"],
  hue: 210,
  energy: 0.5,
  license: "User supplied",
  ...patch,
});
const deck = (assetId: string): Deck => ({
  assetId,
  opacity: 1,
  speed: 1,
  scale: 1,
  rotation: 0,
  mirror: false,
  beatSync: true,
  beats: 8,
  hue: 0,
  saturation: 1,
  brightness: 1,
  blend: "normal",
});
function show(): Show {
  const lyrics = "[instrumental:4]\n夜の向こうへ\n光を探して";
  return {
    version: 1,
    title: "Midnight Session",
    assets: builtInAssets.map((a) => ({ ...a, tags: [...a.tags] })),
    songs: [
      {
        id: "song-1",
        title: "Beyond the Night",
        bpm: 120,
        duration: 180,
        lyrics,
        cues: distributeLyrics(lyrics, 180, 120),
        offset: 0,
        beatsPerBar: 4,
      },
    ],
    decks: [
      deck(builtInAssets[0].id),
      deck(builtInAssets[10].id),
      { ...deck(builtInAssets[32].id), opacity: 0, blend: "screen" },
    ],
    crossfade: 0,
    master: 1,
    lyricStyle: {
      enabled: true,
      size: 64,
      position: 0.77,
      color: "#ffffff",
      align: "center",
      mode: "line",
      shadow: true,
    },
    fx: { glitch: 0, bloom: 0.15, vignette: 0.25, chromatic: 0, pixelate: 0 },
  };
}
function read(value: unknown): Show {
  return validateShow(JSON.stringify(value));
}
function change(path: string, value: unknown): Show {
  const result = show();
  const parts = path.split(".");
  let target = result as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1))
    target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("show files at the live-app boundary", () => {
  it("accepts the real initial catalog and round-trips the set without losing cues or seeds", () => {
    const original = show();
    const result = validateShow(serializeShow(original));
    expect(result.songs).toEqual(original.songs);
    expect(result.decks).toEqual(original.decks);
    expect(result.lyricStyle).toEqual(original.lyricStyle);
    expect(
      result.assets.map((a) => [a.id, a.visual, a.seed, a.source]),
    ).toEqual(original.assets.map((a) => [a.id, a.visual, a.seed, a.source]));
    expect(serializeShow(result)).toBe(serializeShow(original));
    expect(validateShow("\uFEFF" + serializeShow(original))).toEqual(result);
  });

  it("supplies legacy defaults without inventing media metadata or replacing explicit zero/false", () => {
    const input = show();
    Object.assign(input.songs[0], {
      offset: undefined,
      beatsPerBar: undefined,
      lyrics: undefined,
    });
    Object.assign(input.decks[0], {
      mirror: undefined,
      beatSync: undefined,
      blend: undefined,
    });
    Object.assign(input.assets[0], {
      visual: undefined,
      seed: undefined,
      favorite: undefined,
    });
    input.lyricStyle = {} as Show["lyricStyle"];
    input.fx = {} as Show["fx"];
    const result = read(input);
    expect(result.songs[0]).toMatchObject({
      offset: 0,
      beatsPerBar: 4,
      lyrics: input.songs[0].cues.map((c) => c.text).join("\n"),
    });
    expect(result.songs[0]).not.toHaveProperty("timelineBpm");
    expect(result.decks[0]).toMatchObject({
      mirror: false,
      beatSync: true,
      blend: "normal",
    });
    expect(result.assets[0]).toMatchObject({
      visual: "plasma",
      seed: 0,
      favorite: false,
    });
    expect(result.lyricStyle).toEqual(show().lyricStyle);
    expect(result.fx).toEqual(show().fx);
    input.lyricStyle = {
      ...show().lyricStyle,
      enabled: false,
      shadow: false,
      position: 0,
    };
    input.fx = { glitch: 0, bloom: 0, vignette: 0, chromatic: 0, pixelate: 0 };
    expect(read(input)).toMatchObject({
      lyricStyle: input.lyricStyle,
      fx: input.fx,
    });
  });

  it("preserves the timeline BPM separately from live BPM and allows overlapping/out-of-duration lyric edits", () => {
    const input = show();
    input.songs[0].timelineBpm = 100.5;
    input.songs[0].bpm = 200;
    input.songs[0].offset = -12.25;
    input.songs[0].cues = [
      { id: "later", start: 200, end: 210, text: "later" },
      { id: "first", start: 1, end: 12, text: "first" },
      { id: "overlap", start: 1, end: 1, text: "" },
    ];
    expect(validateShow(serializeShow(input)).songs).toEqual(input.songs);
  });

  it("autosaves real LRC tails after loading shorter audio, without clamping the editable cues", () => {
    const input = show();
    input.songs[0].cues = parseLrc("[00:01.00]first\n[03:00.00]last");
    input.songs[0].duration = 2;
    expect(input.songs[0].cues.at(-1)?.end).toBe(185);
    expect(validateShow(serializeShow(input)).songs[0].cues).toEqual(
      input.songs[0].cues,
    );
    input.songs[0].cues.push({
      id: "editable-outlier",
      start: 1e100,
      end: 1e101,
      text: "needs editing",
    });
    expect(validateShow(serializeShow(input)).songs[0].cues).toEqual(
      input.songs[0].cues,
    );
  });

  it.each([
    "",
    "{",
    "null",
    "[]",
    "true",
    "42",
    '"show"',
    '{"version":1}',
    '{"version":1,"assets":null}',
  ])("rejects malformed file %j with a validation error", (raw) => {
    expect(() => validateShow(raw)).toThrow(/Lumina show/);
  });

  it.each([
    ["version", 2],
    ["version", "1"],
    ["title", {}],
    ["assets", []],
    ["songs", []],
    ["decks", []],
    ["assets.0", null],
    ["songs.0", []],
    ["decks.0", false],
    ["lyricStyle", null],
    ["lyricStyle", []],
    ["fx", "yes"],
    ["assets.0.id", ""],
    ["assets.0.id", "  "],
    ["assets.0.id", " leading"],
    ["assets.0.id", "bad\nid"],
    ["assets.0.name", {}],
    ["assets.0.tags", null],
    ["assets.0.tags", ["ok", {}]],
    ["assets.0.tags", [1]],
    ["assets.0.kind", "audio"],
    ["assets.0.visual", "unknown"],
    ["assets.0.visual", {}],
    ["assets.0.license", null],
    ["assets.0.source", []],
    ["assets.0.attribution", {}],
    ["assets.0.status", false],
    ["assets.0.favorite", "false"],
    ["assets.0.favorite", null],
    ["assets.0.hue", -1],
    ["assets.0.hue", 361],
    ["assets.0.energy", -1],
    ["assets.0.energy", 1.01],
    ["assets.0.bpm", 0],
    ["assets.0.bpm", 401],
    ["assets.0.beats", 0],
    ["assets.0.beats", 2.5],
    ["assets.0.duration", 0],
    ["assets.0.duration", -1],
    ["assets.0.bytes", -1],
    ["assets.0.bytes", 1.1],
    ["assets.0.seed", -1],
    ["songs.0.id", {}],
    ["songs.0.title", []],
    ["songs.0.lyrics", null],
    ["songs.0.audioName", {}],
    ["songs.0.bpm", "120"],
    ["songs.0.bpm", 19.9],
    ["songs.0.bpm", 400.1],
    ["songs.0.timelineBpm", 0],
    ["songs.0.timelineBpm", "120"],
    ["songs.0.timelineBpm", null],
    ["songs.0.duration", 0],
    ["songs.0.duration", -1],
    ["songs.0.offset", null],
    ["songs.0.offset", "0"],
    ["songs.0.beatsPerBar", 0],
    ["songs.0.beatsPerBar", 3.5],
    ["songs.0.beatsPerBar", 1e8],
    ["songs.0.cues", {}],
    ["songs.0.cues.0", null],
    ["songs.0.cues.0.id", ""],
    ["songs.0.cues.0.text", {}],
    ["songs.0.cues.0.section", {}],
    ["songs.0.cues.0.start", -1],
    ["songs.0.cues.0.end", -1],
    ["decks.0.assetId", "missing"],
    ["decks.0.opacity", 1.1],
    ["decks.0.speed", 0],
    ["decks.0.scale", 1e8],
    ["decks.0.rotation", 181],
    ["decks.0.hue", -181],
    ["decks.0.saturation", -1],
    ["decks.0.brightness", 3],
    ["decks.0.beats", 0],
    ["decks.0.beats", 8.5],
    ["decks.0.mirror", 0],
    ["decks.0.beatSync", "true"],
    ["decks.0.blend", "overlay"],
    ["decks.0.blend", null],
    ["crossfade", -1],
    ["master", 1.1],
    ["lyricStyle.enabled", "false"],
    ["lyricStyle.shadow", null],
    ["lyricStyle.size", 0],
    ["lyricStyle.size", 1000000],
    ["lyricStyle.position", 1.1],
    ["lyricStyle.align", "right"],
    ["lyricStyle.mode", "html"],
    ["lyricStyle.color", "url(javascript:alert(1))"],
    ["lyricStyle.color", {}],
    ["fx.glitch", -1],
    ["fx.bloom", 2],
    ["fx.vignette", null],
    ["fx.chromatic", "0"],
    ["fx.pixelate", {}],
  ])("rejects invalid %s = %j before the renderer sees it", (path, value) => {
    expect(() => read(change(path as string, value))).toThrow(/Lumina show/);
  });

  it("rejects duplicate IDs in their actual scopes while allowing separate songs to share cue IDs", () => {
    const input = show();
    input.songs.push({ ...structuredClone(input.songs[0]), id: "song-2" });
    expect(read(input).songs).toHaveLength(2);
    input.songs[1].id = input.songs[0].id;
    expect(() => read(input)).toThrow(/duplicate/);
    input.songs.pop();
    input.assets.push({ ...input.assets[0] });
    expect(() => read(input)).toThrow(/duplicate/);
    input.assets.pop();
    input.songs[0].cues.push({ ...input.songs[0].cues[0] });
    expect(() => read(input)).toThrow(/duplicate/);
  });

  it("rejects overflow JSON numbers, unsafe integer metadata and reversed lyric spans", () => {
    for (const path of [
      "master",
      "songs.0.offset",
      "songs.0.timelineBpm",
      "assets.0.energy",
      "fx.glitch",
      "decks.0.speed",
    ]) {
      const raw = JSON.stringify(change(path, "__OVERFLOW__")).replace(
        '"__OVERFLOW__"',
        "1e999",
      );
      expect(() => validateShow(raw)).toThrow(/Lumina show/);
    }
    expect(() =>
      read(change("assets.0.bytes", Number.MAX_SAFE_INTEGER + 1)),
    ).toThrow();
    expect(() => read(change("songs.0.duration", 1e100))).toThrow();
    const input = show();
    input.songs[0].cues[0] = { id: "reversed", start: 10, end: 9, text: "no" };
    expect(() => read(input)).toThrow(/end/);
    // NaN must fail before JSON.stringify could silently turn it into null.
    expect(() => serializeShow(change("fx.bloom", NaN))).toThrow(/fx.bloom/);
  });

  it("bounds the file, catalog, strings and UI allocation inputs", () => {
    expect(() => validateShow(" ".repeat(10 * 1024 * 1024 + 1))).toThrow(
      /file size/,
    );
    expect(() => read(change("assets", Array(100001).fill(null)))).toThrow(
      /assets/,
    );
    expect(() => read(change("songs", Array(10001).fill(null)))).toThrow(
      /songs/,
    );
    expect(() =>
      read(change("assets.0.tags", Array(1025).fill("tag"))),
    ).toThrow(/tags/);
    expect(() =>
      read(change("songs.0.cues", Array(100001).fill(null))),
    ).toThrow(/cues/);
    expect(() => read(change("title", "x".repeat(65537)))).toThrow(/title/);
  });

  it("copies only schema fields, so foreign native metadata and prototype keys never enter app state", () => {
    const input = JSON.parse(JSON.stringify(show()));
    input.__proto__ = { poisoned: true };
    Object.defineProperty(input, "__proto__", {
      value: { poisoned: true },
      enumerable: true,
    });
    input.fx.surprise = { bad: true };
    input.assets[0].nativePath = "C:\\private\\recording.mp4";
    input.assets[0].metadata = { nested: [1, 2] };
    input.songs[0].audioBuffer = "runtime";
    const result = read(input);
    expect(Object.prototype).not.toHaveProperty("poisoned");
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(result.fx).toEqual(show().fx);
    expect(JSON.stringify(result)).not.toMatch(
      /nativePath|audioBuffer|metadata|poisoned/,
    );
  });
});

describe("URL and autosave contracts", () => {
  it.each([
    "/assets/media/日本 語.mp4",
    "./assets/media/日本%20語.mp4",
    "/media/clip-id",
    "./media/clip-id",
    "http://127.0.0.1:43123/media/clip-id",
    "http://localhost:9999/assets/media/a.mp4",
    "https://cdn.example.test/video.mp4?token=abc%2Fdef#t=2",
    "blob:http://127.0.0.1:1234/abc-123",
    "blob:https://example.test/abc-123",
    "blob:null/abc-123",
    "indexeddb:clip",
  ])("accepts safe portable/native media URL %s", (url) => {
    const input = show();
    input.assets.push(asset("clip", { url }));
    expect(read(input).assets.at(-1)?.url).toBe(url);
    if (!url.startsWith("blob:"))
      expect(validateShow(serializeShow(input)).assets.at(-1)?.url).toBe(url);
  });

  it.each([
    "",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "vbscript:msgbox(1)",
    "file:///C:/private/video.mp4",
    "data:text/html,<script>alert(1)</script>",
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    "//evil.example/a",
    "\\\\evil.example\\a",
    "/media\\evil",
    " https://cdn.example/a",
    "https://cdn.example/a\n",
    "https://",
    "https:///evil.example/a",
    "https://user:password@evil.example/a",
    "https://evil.example\\@safe.example/a",
    "./javascript:alert(1)",
    "./other/path.mp4",
    "/assets/../private",
    "/assets/%2e%2e/private",
    "/media/%252e%252e/private",
    "/assets/a%2f..%2f..%2fprivate",
    "/assets/%5c..%5cprivate",
    "/assets/%00a",
    "/assets/%zz",
    "https://host.test/media/%2e%2e/private",
    "blob:javascript:alert(1)",
    "blob:file:///C:/private",
    "blob:https://host.test/a/../../evil",
    "blob:https://host.test/a?x=1",
    "indexeddb:another-id",
    "https://host.test/media/file.mp4:secret",
  ])("rejects unsafe media URL %j", (url) => {
    const input = show();
    input.assets.push(asset("clip", { url }));
    expect(() => read(input)).toThrow(/url/);
  });

  it("validates thumbnail, source and audio URL fields instead of trusting secondary URL slots", () => {
    for (const path of [
      "assets.0.url",
      "assets.0.thumbnail",
      "assets.0.source",
      "songs.0.audioUrl",
    ]) {
      expect(() => read(change(path, "javascript:alert(1)"))).toThrow();
      expect(() => read(change(path, {}))).toThrow();
    }
    expect(() =>
      read(change("assets.0.thumbnail", "data:image/svg+xml;base64,PHN2Zy8+")),
    ).toThrow();
    expect(() =>
      read(change("assets.0.thumbnail", "data:image/png;base64,not base64")),
    ).toThrow();
    expect(
      read(change("assets.0.thumbnail", "data:image/png;base64,YQ==")).assets[0]
        .thumbnail,
    ).toBe("data:image/png;base64,YQ==");
    expect(() =>
      read(
        change(
          "assets.0.thumbnail",
          "data:image/png;base64," + "A".repeat(300000),
        ),
      ),
    ).toThrow();
    expect(
      read(change("songs.0.audioUrl", "blob:https://host.test/audio-id"))
        .songs[0],
    ).not.toHaveProperty("audioUrl");
  });

  it("keeps autosave small, stable and reloadable without mutating or revoking live resources", () => {
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const input = show();
    for (const a of input.assets)
      a.thumbnail = "data:image/png;base64," + "A".repeat(100000);
    input.assets.push(
      asset("clip", {
        url: "blob:https://host.test/media-id",
        thumbnail: "/assets/media/thumb.png",
        favorite: true,
      }),
    );
    input.assets.push(
      asset("photo", {
        kind: "image",
        url: "/media/photo",
        thumbnail: "blob:https://host.test/thumb",
      }),
    );
    input.songs[0].audioUrl = "blob:https://host.test/audio-id";
    input.songs[0].audioName = "My track.wav";
    input.songs[0].timelineBpm = 110;
    const before = structuredClone(input);
    const json = serializeShow(input),
      result = validateShow(json);
    expect(json.length).toBeLessThan(150000);
    expect(json).not.toMatch(/data:image|blob:|audioUrl/);
    expect(result.assets.find((a) => a.id === "clip")).toMatchObject({
      url: "indexeddb:clip",
      thumbnail: "/assets/media/thumb.png",
      favorite: true,
    });
    expect(result.songs[0]).toMatchObject({
      audioName: "My track.wav",
      timelineBpm: 110,
    });
    expect(serializeShow(result)).toBe(json);
    expect(input).toEqual(before);
    expect(revoke).not.toHaveBeenCalled();
  });
});

// A controllable event boundary, not a second database implementation: tests drive
// commit/abort/open failure independently of request success, as IndexedDB does.
function databaseHarness() {
  type Request = {
    result?: unknown;
    error?: Error;
    onsuccess?: () => void;
    onerror?: () => void;
  };
  const reads = new Map<string, Request>();
  const put = vi.fn();
  const tx = {
    error: null as Error | null,
    oncomplete: undefined as undefined | (() => void),
    onerror: undefined as undefined | (() => void),
    onabort: undefined as undefined | (() => void),
    abort: vi.fn(),
    objectStore: vi.fn(() => ({
      put,
      get: vi.fn((id: string) => {
        const request: Request = {};
        reads.set(id, request);
        return request;
      }),
    })),
  };
  const database = {
    close: vi.fn(),
    transaction: vi.fn(() => tx),
    onversionchange: undefined as undefined | (() => void),
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(),
  };
  const request = {
    result: database,
    error: new Error("open failed"),
    transaction: tx,
    onsuccess: undefined as undefined | (() => void),
    onerror: undefined as undefined | (() => void),
    onblocked: undefined as undefined | (() => void),
    onupgradeneeded: undefined as undefined | (() => void),
  };
  const open = vi.fn(() => request);
  vi.stubGlobal("indexedDB", { open });
  return { open, request, database, tx, reads, put };
}
async function openDatabase(
  h: ReturnType<typeof databaseHarness>,
): Promise<void> {
  h.request.onsuccess!();
  // Opening is deliberately asynchronous relative to consumer transaction setup.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("IndexedDB restoration and media ownership", () => {
  it("recovers a missing DB reference, transfers actual bytes, and keeps output alive after source retirement", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const missing = await restoreMedia([
      asset("clip", { url: "indexeddb:clip" }),
    ]);
    const input = show();
    input.assets.push(missing[0]);
    const saved = validateShow(serializeShow(input));
    expect(saved.assets.at(-1)?.url).toBe("indexeddb:clip");

    const h = databaseHarness(),
      pending = restoreMedia(saved.assets);
    await openDatabase(h);
    h.reads.get("clip")!.result = new Blob(["persistent video bytes"], {
      type: "video/mp4",
    });
    h.reads.get("clip")!.onsuccess!();
    h.tx.oncomplete!();
    const restored = await pending;
    const sourceUrl = restored.at(-1)!.url!;
    const sender = new OutputMediaBridge(),
      receiver = new OutputMediaBridge();
    try {
      expect(await (await fetch(sourceUrl)).text()).toBe(
        "persistent video bytes",
      );
      const packet = structuredClone(await sender.package(restored));
      const output = receiver.restore(packet.assets, packet.blobs);
      const outputUrl = output.at(-1)!.url!;
      expect(outputUrl).not.toBe(sourceUrl);
      expect(restored[0]).toBe(saved.assets[0]);
      // The host retires its URLs after detaching consumers/transferring bytes.
      revokeMediaUrls(restored);
      await expect(fetch(sourceUrl)).rejects.toThrow();
      expect(await (await fetch(outputUrl)).text()).toBe(
        "persistent video bytes",
      );
      expect(receiver.restore(packet.assets, {}).at(-1)?.url).toBe(outputUrl);
      receiver.restore([]);
      await expect(fetch(outputUrl)).rejects.toThrow();
      expect(h.database.close).toHaveBeenCalledOnce();
    } finally {
      revokeMediaUrls(restored);
      sender.dispose();
      receiver.dispose();
    }
  });

  it("does not even access IndexedDB when no asset has a durable blob reference", async () => {
    const open = vi.fn(() => {
      throw new Error("must not open");
    });
    vi.stubGlobal("indexedDB", { open });
    const assets = [
      builtInAssets[0],
      asset("remote", { url: "https://host.test/a.mp4" }),
      asset("native", { url: "/media/native" }),
      asset("missing"),
    ];
    expect(await restoreMedia(assets)).toBe(assets);
    expect(open).not.toHaveBeenCalled();
    vi.stubGlobal("indexedDB", undefined);
    expect(await restoreMedia(assets)).toBe(assets);
  });

  it.each(["absent", "throws", "error", "blocked"] as const)(
    "retains unrelated assets and marks missing media when IndexedDB is %s",
    async (mode) => {
      const h = databaseHarness();
      if (mode === "absent") vi.stubGlobal("indexedDB", undefined);
      if (mode === "throws")
        h.open.mockImplementation(() => {
          throw new Error("SecurityError");
        });
      const assets = [
        builtInAssets[0],
        asset("native", { url: "/media/native" }),
        asset("clip", { url: "blob:https://host.test/old-id" }),
      ];
      const pending = restoreMedia(assets);
      if (mode === "error") h.request.onerror!();
      if (mode === "blocked") h.request.onblocked!();
      const restored = await pending;
      expect(restored[0]).toBe(assets[0]);
      expect(restored[1]).toBe(assets[1]);
      expect(restored[2]).toMatchObject({
        id: "clip",
        url: undefined,
        status: "ファイルの再リンクが必要",
      });
      expect(assets[2].url).toBe("blob:https://host.test/old-id");
      if (mode === "blocked") {
        h.request.onsuccess!();
        expect(h.database.close).toHaveBeenCalledOnce();
      }
      const input = show();
      input.assets.push(restored[2]);
      expect(validateShow(serializeShow(input)).assets.at(-1)?.url).toBe(
        "indexeddb:clip",
      );
    },
  );

  it("only creates a URL for actual blobs after commit, preserving order and the incoming URL lifetime", async () => {
    const h = databaseHarness();
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:https://host.test/restored");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const assets = [
      asset("clip", { url: "indexeddb:clip" }),
      builtInAssets[0],
      asset("absent", { url: "indexeddb:absent" }),
      asset("corrupt", { url: "indexeddb:corrupt" }),
    ];
    const pending = restoreMedia(assets);
    await openDatabase(h);
    const blob = new Blob(["video"], { type: "video/mp4" });
    for (const [id, result] of [
      ["clip", blob],
      ["absent", undefined],
      ["corrupt", { type: "video/mp4" }],
    ] as const) {
      const request = h.reads.get(id)!;
      request.result = result;
      request.onsuccess!();
    }
    expect(create).not.toHaveBeenCalled();
    h.tx.oncomplete!();
    const restored = await pending;
    expect(restored.map((a) => a.id)).toEqual(assets.map((a) => a.id));
    expect(restored[0].url).toBe("blob:https://host.test/restored");
    expect(restored[1]).toBe(assets[1]);
    expect(
      restored
        .slice(2)
        .every((a) => !a.url && a.status === "ファイルの再リンクが必要"),
    ).toBe(true);
    expect(create).toHaveBeenCalledExactlyOnceWith(blob);
    expect(revoke).not.toHaveBeenCalled();
    expect(h.database.close).toHaveBeenCalledOnce();
  });

  it.each(["throw", "abort", "error", "timeout"] as const)(
    "closes the database on transaction %s and never publishes uncommitted URLs",
    async (mode) => {
      vi.useFakeTimers();
      const h = databaseHarness();
      const create = vi.spyOn(URL, "createObjectURL");
      if (mode === "throw")
        h.database.transaction.mockImplementation(() => {
          throw new Error("InvalidStateError");
        });
      const pending = restoreMedia([asset("clip", { url: "indexeddb:clip" })]);
      await openDatabase(h);
      if (mode !== "throw") {
        const request = h.reads.get("clip")!;
        request.result = new Blob(["video"]);
        request.onsuccess!();
        if (mode === "timeout") await vi.advanceTimersByTimeAsync(5001);
        else if (mode === "abort") h.tx.onabort!();
        else h.tx.onerror!();
      }
      const restored = await pending;
      expect(restored[0].url).toBeUndefined();
      expect(h.database.close).toHaveBeenCalledOnce();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("bounds stalled opens and closes a connection that succeeds after the caller has recovered", async () => {
    vi.useFakeTimers();
    const h = databaseHarness();
    const pending = restoreMedia([asset("clip", { url: "indexeddb:clip" })]);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending)[0].url).toBeUndefined();
    h.request.onsuccess!();
    expect(h.database.close).toHaveBeenCalledOnce();
    expect(h.database.transaction).not.toHaveBeenCalled();
  });

  it("degrades object-URL allocation failure without dropping the show or leaking a connection", async () => {
    const h = databaseHarness();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("no object URLs");
    });
    const pending = restoreMedia([
      asset("clip", { url: "indexeddb:clip" }),
      builtInAssets[0],
    ]);
    await openDatabase(h);
    h.reads.get("clip")!.result = new Blob(["video"]);
    h.reads.get("clip")!.onsuccess!();
    h.tx.oncomplete!();
    const result = await pending;
    expect(result[0].url).toBeUndefined();
    expect(result[1]).toBe(builtInAssets[0]);
    expect(h.database.close).toHaveBeenCalledOnce();
  });

  it("releases only discarded blob URLs once per list, including thumbnails, after the caller releases consumers", () => {
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const shared = "blob:https://host.test/shared",
      old = "blob:https://host.test/old",
      thumb = "blob:https://host.test/thumb";
    revokeMediaUrls(
      [
        asset("one", { url: old, thumbnail: thumb }),
        asset("two", { url: old }),
        asset("three", { url: shared }),
        asset("four", { url: "/media/four" }),
        asset("five", { url: "indexeddb:five" }),
      ],
      [asset("retained", { url: shared })],
    );
    expect(revoke.mock.calls.map((call) => call[0]).sort()).toEqual(
      [old, thumb].sort(),
    );
  });

  it("waits for a write commit, propagates aborts, and closes connections on both outcomes", async () => {
    let h = databaseHarness();
    const blob = new Blob(["movie"]);
    let settled = false;
    const success = storeMedia("clip", blob).then(() => {
      settled = true;
    });
    await openDatabase(h);
    expect(h.put).toHaveBeenCalledWith(blob, "clip");
    expect(settled).toBe(false);
    h.tx.oncomplete!();
    await success;
    expect(h.database.close).toHaveBeenCalledOnce();
    h = databaseHarness();
    const failure = storeMedia("clip", blob);
    const rejected = expect(failure).rejects.toThrow(/aborted/);
    await openDatabase(h);
    h.tx.onabort!();
    await rejected;
    expect(h.database.close).toHaveBeenCalledOnce();
  });

  it("rejects unsupported writes without opening IndexedDB", async () => {
    const h = databaseHarness();
    await expect(storeMedia("", new Blob())).rejects.toThrow(/media.id/);
    await expect(storeMedia("clip", {} as Blob)).rejects.toThrow(/media.file/);
    expect(h.open).not.toHaveBeenCalled();
  });
});

describe("download URL lifetime", () => {
  it("keeps the file URL alive during click and releases it after saving has started", async () => {
    vi.useFakeTimers();
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:https://host.test/download",
    );
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(() => expect(revoke).not.toHaveBeenCalled()),
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    downloadFile("Session.lumina.json", "{}");
    expect(anchor).toMatchObject({
      href: "blob:https://host.test/download",
      download: "Session.lumina.json",
    });
    expect(anchor.click).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith(
      "blob:https://host.test/download",
    );
  });

  it("releases the file URL immediately if starting a download throws", () => {
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:https://host.test/failed",
    );
    vi.stubGlobal("document", {
      createElement: () => ({
        click: () => {
          throw new Error("blocked");
        },
      }),
    });
    expect(() => downloadFile("video.webm", new Blob(["movie"]))).toThrow(
      "blocked",
    );
    expect(revoke).toHaveBeenCalledExactlyOnceWith(
      "blob:https://host.test/failed",
    );
  });
});
