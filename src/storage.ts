import type { Asset, Deck, LyricCue, Show, Song, VisualKind } from "./types";

const DB = "lumina-live-v1";
const DB_TIMEOUT = 5000;
const MISSING_MEDIA = "ファイルの再リンクが必要";
const MAX_SHOW_LENGTH = 10 * 1024 * 1024;
// Bound arithmetic and allocations while allowing long installations and sets.
const MAX_SECONDS = 365 * 24 * 60 * 60;
const VISUALS: readonly VisualKind[] = [
  "tunnel",
  "waves",
  "particles",
  "grid",
  "rings",
  "plasma",
  "kaleido",
  "noise",
  "aurora",
  "bars",
  "terrain",
  "vortex",
];

function invalid(field: string): never {
  throw new Error("Lumina showデータが不正です: " + field);
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(field);
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string, max = 65536): string {
  if (typeof value !== "string" || value.length > max) invalid(field);
  return value;
}
function id(value: unknown, field: string): string {
  const result = string(value, field, 256);
  if (
    !result.trim() ||
    result !== result.trim() ||
    /[\u0000-\u001f\u007f]/.test(result)
  )
    invalid(field);
  return result;
}
function number(
  value: unknown,
  field: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid(field);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}
function enumeration<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(field);
  return value as T;
}
function array(
  value: unknown,
  field: string,
  min: number,
  max: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    invalid(field);
  return value;
}
function unique<T extends { id: string }>(items: T[], field: string): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    invalid(field + ".id (duplicate)");
  return items;
}
// Only absence gets a default. Explicit null and wrong types are still rejected.
const fallback = (value: unknown, defaultValue: unknown): unknown =>
  value === undefined ? defaultValue : value;

function safePath(path: string, field: string, allowColon = false): void {
  let decoded = path;
  for (let i = 0; i < 4; i++) {
    if (
      /[\u0000-\u001f\u007f\\]/.test(decoded) ||
      decoded.startsWith("//") ||
      decoded
        .split("/")
        .some(
          (part) =>
            part === "." ||
            part === ".." ||
            (!allowColon && part.includes(":")),
        )
    )
      invalid(field);
    if (!decoded.includes("%")) return;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      invalid(field);
    }
  }
  invalid(field);
}

function httpUrl(value: string, field: string, sourceLink = false): void {
  if (value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value))
    invalid(field);
  if (!/^https?:\/\/[^/\s?#]/i.test(value)) invalid(field);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid(field);
  }
  if (!parsed.hostname || parsed.username || parsed.password) invalid(field);
  // Inspect the original path; URL() already collapses literal/encoded dot segments.
  safePath(
    value.replace(/^https?:\/\/[^/?#]+/i, "").split(/[?#]/)[0],
    field,
    sourceLink,
  );
}

function mediaUrl(
  value: unknown,
  field: string,
  assetId?: string,
  thumbnail = false,
): string {
  const url = string(value, field, thumbnail ? 256 * 1024 : 8192);
  if (!url || url !== url.trim() || /[\u0000-\u001f\u007f\\]/.test(url))
    invalid(field);
  if (/^https?:\/\//i.test(url)) httpUrl(url, field);
  else if (url.startsWith("blob:")) {
    const inner = url.slice(5);
    if (/^null\/[A-Za-z0-9_-]+$/.test(inner)) return url;
    httpUrl(inner, field);
    const parsed = new URL(inner);
    if (
      !/^\/[A-Za-z0-9_-]+$/.test(parsed.pathname) ||
      parsed.search ||
      parsed.hash
    )
      invalid(field);
  } else if (assetId !== undefined && url === "indexeddb:" + assetId)
    return url;
  else if (
    thumbnail &&
    /^data:image\/(?:png|jpeg|webp|gif|avif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      url,
    ) &&
    !url.endsWith(",")
  )
    return url;
  else if (/^(?:\.?\/assets\/|\.?\/media\/)/.test(url)) {
    const path = url.replace(/^\.\//, "/").split(/[?#]/)[0];
    safePath(path, field);
    if (path.endsWith("/")) invalid(field);
  } else invalid(field);
  return url;
}

export function validateAssetCatalog(value: unknown): Asset[] {
  return unique(array(value, "assets", 0, 10000).map(readAsset), "assets");
}

function readAsset(value: unknown, index: number): Asset {
  const field = "assets[" + index + "]",
    a = object(value, field);
  const asset: Asset = {
    id: id(a.id, field + ".id"),
    name: string(a.name, field + ".name"),
    kind: enumeration(a.kind, field + ".kind", [
      "procedural",
      "video",
      "image",
    ]),
    tags: array(a.tags, field + ".tags", 0, 1024).map((t) =>
      string(t, field + ".tags", 1024),
    ),
    hue: number(a.hue, field + ".hue", 0, 360),
    energy: number(a.energy, field + ".energy", 0, 1),
    license: string(a.license, field + ".license"),
    favorite: boolean(fallback(a.favorite, false), field + ".favorite"),
  };
  if (a.visual !== undefined || asset.kind === "procedural")
    asset.visual = enumeration(
      fallback(a.visual, "plasma"),
      field + ".visual",
      VISUALS,
    );
  if (a.seed !== undefined || asset.kind === "procedural")
    asset.seed = number(
      fallback(a.seed, 0),
      field + ".seed",
      0,
      Number.MAX_SAFE_INTEGER,
      true,
    );
  if (a.url !== undefined)
    asset.url = mediaUrl(a.url, field + ".url", asset.id);
  if (a.thumbnail !== undefined)
    asset.thumbnail = mediaUrl(
      a.thumbnail,
      field + ".thumbnail",
      undefined,
      true,
    );
  if (a.bpm !== undefined) asset.bpm = number(a.bpm, field + ".bpm", 20, 400);
  if (a.beats !== undefined)
    asset.beats = number(a.beats, field + ".beats", 1, 128, true);
  if (a.duration !== undefined)
    asset.duration = number(
      a.duration,
      field + ".duration",
      Number.MIN_VALUE,
      MAX_SECONDS,
    );
  if (a.bytes !== undefined)
    asset.bytes = number(
      a.bytes,
      field + ".bytes",
      0,
      Number.MAX_SAFE_INTEGER,
      true,
    );
  for (const key of ["source", "attribution", "status"] as const) {
    if (a[key] !== undefined) asset[key] = string(a[key], field + "." + key);
  }
  // Source also holds plain-text credits in the built-in catalog.
  if (
    asset.source &&
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(asset.source.trim())
  ) {
    // Source-page namespaces such as Wikimedia /wiki/File:... are links, never local file paths.
    if (/^https?:\/\//i.test(asset.source))
      httpUrl(asset.source, field + ".source", true);
    else mediaUrl(asset.source, field + ".source");
  }
  return asset;
}

function readSong(value: unknown, index: number): Song {
  const field = "songs[" + index + "]",
    s = object(value, field);
  const cues = unique(
    array(s.cues, field + ".cues", 0, 100000).map((value, i): LyricCue => {
      const path = field + ".cues[" + i + "]",
        c = object(value, path);
      // Imported LRC tails and manual cues may legitimately outlive the song.
      const start = number(c.start, path + ".start", 0, Number.MAX_VALUE);
      return {
        id: id(c.id, path + ".id"),
        start,
        end: number(c.end, path + ".end", start, Number.MAX_VALUE),
        text: string(c.text, path + ".text"),
        ...(c.section === undefined
          ? {}
          : { section: string(c.section, path + ".section") }),
      };
    }),
    field + ".cues",
  );
  const song: Song = {
    id: id(s.id, field + ".id"),
    title: string(s.title, field + ".title"),
    bpm: number(s.bpm, field + ".bpm", 20, 400),
    duration: number(
      s.duration,
      field + ".duration",
      Number.MIN_VALUE,
      MAX_SECONDS,
    ),
    lyrics: string(
      fallback(s.lyrics, cues.map((c) => c.text).join("\n")),
      field + ".lyrics",
      1024 * 1024,
    ),
    cues,
    offset: number(
      fallback(s.offset, 0),
      field + ".offset",
      -MAX_SECONDS,
      MAX_SECONDS,
    ),
    beatsPerBar: number(
      fallback(s.beatsPerBar, 4),
      field + ".beatsPerBar",
      1,
      32,
      true,
    ),
  };
  if (s.timelineBpm !== undefined)
    song.timelineBpm = number(s.timelineBpm, field + ".timelineBpm", 20, 400);
  if (s.audioName !== undefined)
    song.audioName = string(s.audioName, field + ".audioName");
  // Session audio URLs cannot restore the audio engine; retain only the relink name.
  if (s.audioUrl !== undefined) mediaUrl(s.audioUrl, field + ".audioUrl");
  return song;
}

function readShow(value: unknown): Show {
  const s = object(value, "show");
  if (s.version !== 1) invalid("version");
  const assets = unique(
    array(s.assets, "assets", 1, 100000).map(readAsset),
    "assets",
  );
  const assetIds = new Set(assets.map((a) => a.id));
  const decks = array(s.decks, "decks", 3, 3).map((value, i): Deck => {
    const field = "decks[" + i + "]",
      d = object(value, field);
    const assetId = id(d.assetId, field + ".assetId");
    if (!assetIds.has(assetId)) invalid(field + ".assetId (missing asset)");
    return {
      assetId,
      opacity: number(d.opacity, field + ".opacity", 0, 1),
      speed: number(d.speed, field + ".speed", 0.25, 4),
      scale: number(d.scale, field + ".scale", 0.25, 4),
      rotation: number(d.rotation, field + ".rotation", -180, 180),
      mirror: boolean(fallback(d.mirror, false), field + ".mirror"),
      beatSync: boolean(fallback(d.beatSync, true), field + ".beatSync"),
      beats: number(d.beats, field + ".beats", 1, 128, true),
      hue: number(d.hue, field + ".hue", -180, 180),
      saturation: number(d.saturation, field + ".saturation", 0, 2),
      brightness: number(d.brightness, field + ".brightness", 0, 2),
      blend: enumeration(fallback(d.blend, "normal"), field + ".blend", [
        "normal",
        "screen",
        "add",
        "multiply",
        "difference",
      ]),
    };
  });
  const l = object(s.lyricStyle, "lyricStyle"),
    fx = object(s.fx, "fx");
  const color = string(fallback(l.color, "#ffffff"), "lyricStyle.color");
  if (!/^#[0-9a-f]{6}$/i.test(color)) invalid("lyricStyle.color");
  return {
    version: 1,
    title: string(s.title, "title"),
    assets,
    decks,
    songs: unique(array(s.songs, "songs", 1, 10000).map(readSong), "songs"),
    crossfade: number(s.crossfade, "crossfade", 0, 1),
    master: number(s.master, "master", 0, 1),
    lyricStyle: {
      enabled: boolean(fallback(l.enabled, true), "lyricStyle.enabled"),
      size: number(fallback(l.size, 64), "lyricStyle.size", 24, 120),
      position: number(fallback(l.position, 0.77), "lyricStyle.position", 0, 1),
      color,
      align: enumeration(fallback(l.align, "center"), "lyricStyle.align", [
        "center",
        "left",
      ]),
      mode: enumeration(fallback(l.mode, "line"), "lyricStyle.mode", [
        "line",
        "karaoke",
        "typewriter",
      ]),
      shadow: boolean(fallback(l.shadow, true), "lyricStyle.shadow"),
    },
    fx: {
      glitch: number(fallback(fx.glitch, 0), "fx.glitch", 0, 1),
      bloom: number(fallback(fx.bloom, 0.15), "fx.bloom", 0, 1),
      vignette: number(fallback(fx.vignette, 0.25), "fx.vignette", 0, 1),
      chromatic: number(fallback(fx.chromatic, 0), "fx.chromatic", 0, 1),
      pixelate: number(fallback(fx.pixelate, 0), "fx.pixelate", 0, 1),
    },
  };
}

export function validateShow(raw: string): Show {
  if (typeof raw !== "string" || raw.length > MAX_SHOW_LENGTH)
    invalid("file size");
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    invalid("JSON");
  }
  return readShow(value);
}

export function serializeShow(show: Show): string {
  // Whitelist via readShow: catalog metadata/native paths and runtime caches stay out.
  // Strip previews before validation/stringification so they cannot fill autosave.
  const persistent = readShow({
    ...show,
    assets: show.assets.map((a) => ({
      ...a,
      // Directory selections are session-scoped, even if a prior cached copy exists.
      tags: a.tags.filter((tag) => tag !== "folder-connected"),
      url:
        a.url?.startsWith("blob:") || (!a.url && a.status === MISSING_MEDIA)
          ? "indexeddb:" + a.id
          : a.url,
      thumbnail:
        a.kind === "procedural" ||
        a.thumbnail?.startsWith("data:") ||
        a.thumbnail?.startsWith("blob:")
          ? undefined
          : a.thumbnail,
    })),
    songs: show.songs.map((s) => ({ ...s, audioUrl: undefined })),
  });
  const result = JSON.stringify(persistent, null, 2);
  if (result.length > MAX_SHOW_LENGTH) invalid("file size");
  return result;
}

async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Media database timed out")),
      DB_TIMEOUT,
    );
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        try {
          if (settled) {
            request.transaction?.abort();
            return;
          }
          if (!request.result.objectStoreNames.contains("media"))
            request.result.createObjectStore("media");
        } catch (error) {
          try {
            request.transaction?.abort();
          } catch {
            /* Already aborted. */
          }
          finish(error);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () =>
        finish(request.error ?? new Error("Media database unavailable"));
      request.onblocked = () => finish(new Error("Media database blocked"));
    } catch (error) {
      finish(error);
    }
  });
}

function transaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let t: IDBTransaction | undefined,
      settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        t?.abort();
      } catch {
        /* It may already be finished. */
      }
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("Media transaction timed out")),
      DB_TIMEOUT,
    );
    try {
      t = database.transaction("media", mode);
      t.onerror = t.onabort = () =>
        fail(t?.error ?? new Error("Media transaction aborted"));
      const result = work(t.objectStore("media"));
      t.oncomplete = () => {
        if (settled) return;
        try {
          const value = result();
          settled = true;
          clearTimeout(timer);
          resolve(value);
        } catch (error) {
          fail(error);
        }
      };
    } catch (error) {
      fail(error);
    }
  });
}

export async function storeMedia(assetId: string, file: Blob): Promise<void> {
  id(assetId, "media.id");
  if (!(file instanceof Blob)) invalid("media.file");
  const database = await db();
  try {
    await transaction(database, "readwrite", (store) => {
      store.put(file, assetId);
      return () => undefined;
    });
  } finally {
    database.close();
  }
}

export async function restoreMedia(assets: Asset[]): Promise<Asset[]> {
  const needsBlob = (a: Asset) =>
    a.url?.startsWith("blob:") ||
    a.url?.startsWith("indexeddb:") ||
    (!a.url && a.status === MISSING_MEDIA);
  const pending = assets.filter(needsBlob);
  if (!pending.length) return assets;
  const blobs = new Map<string, Blob>();
  let database: IDBDatabase | undefined;
  try {
    database = await db();
    await transaction(database, "readonly", (store) => {
      for (const a of pending) {
        const request = store.get(a.id);
        request.onsuccess = () => {
          if (request.result instanceof Blob) blobs.set(a.id, request.result);
        };
      }
      return () => undefined;
    });
  } catch {
    blobs.clear();
  } finally {
    database?.close();
  }
  return assets.map((a) => {
    if (!needsBlob(a)) return a;
    const blob = blobs.get(a.id);
    if (blob) {
      try {
        return {
          ...a,
          url: URL.createObjectURL(blob),
          status: a.status === MISSING_MEDIA ? "local" : a.status,
        };
      } catch {
        /* Unavailable object URLs should not discard the rest of the show. */
      }
    }
    return { ...a, url: undefined, status: MISSING_MEDIA };
  });
}

/** Call after consumers release an old asset list; retained URLs may still be in use. */
export function revokeMediaUrls(
  assets: readonly Asset[],
  retained: readonly Asset[] = [],
): void {
  const urls = (items: readonly Asset[]) =>
    items
      .flatMap((a) => [a.url, a.thumbnail])
      .filter((url): url is string => !!url?.startsWith("blob:"));
  const keep = new Set(urls(retained));
  for (const url of new Set(urls(assets)))
    if (!keep.has(url)) URL.revokeObjectURL(url);
}

export function downloadFile(
  name: string,
  content: Blob | string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  // Keep the URL alive until the browser has had time to start saving large recordings.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
