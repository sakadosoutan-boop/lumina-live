import { validateAssetCatalog } from "./storage";
import type { Asset } from "./types";

export interface FolderLibraryPlan {
  entries: Array<{ asset: Asset; file: File; thumbnail?: File }>;
  skipped: number;
  missing: number;
}

const MAX_CATALOG_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 100000;
const VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const MIME: Record<string, "video" | "image"> = {
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/x-m4v": "video",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
};

type LocalFile = { file: File; path: string; kind?: "video" | "image" };

// Do not let URL parsing collapse traversal before it can be rejected. File paths
// are literal filesystem names; only catalog URLs are percent-decoded for matching.
function safeSegments(path: string): boolean {
  return (
    !/[\u0000-\u001f\u007f\\:?#]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function normalizePath(raw: string, url = false): string | undefined {
  if (!raw || raw.length > 8192 || raw !== raw.trim()) return;
  let path = raw;
  if (url) {
    if (path.startsWith("//")) return;
    path = path.replace(/^(?:\.\/|\/)/, "");
  }
  if (!safeSegments(path) || path.split("/").length > 64) return;
  let decoded = path;
  // Reject encoded separators and traversal, including nested encodings. Keep
  // literal percent-containing filenames only when their escapes are well formed.
  for (let i = 0; decoded.includes("%"); i++) {
    if (i === 4 || /%(?:2f|5c)/i.test(decoded)) return;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return;
    }
    if (!safeSegments(decoded)) return;
  }
  return url ? decoded : path;
}

function extension(path: string): string {
  return path.split("/").at(-1)!.split(".").at(-1)!.toLowerCase();
}

function kind(file: File, path: string): LocalFile["kind"] {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (Object.hasOwn(MIME, mime)) return MIME[mime];
  const ext = extension(path);
  return VIDEO.has(ext) ? "video" : IMAGE.has(ext) ? "image" : undefined;
}

function excluded(path: string): boolean {
  return /\bORGY(?:\b|[-_])/i.test(
    path.split("/").at(-1)!.replaceAll("_", " "),
  );
}

function thumbnailDirectory(path: string): boolean {
  return path
    .split("/")
    .slice(0, -1)
    .some((part) => /^(?:thumbs?|thumbnails?)$/i.test(part));
}

function stem(path: string): string {
  return path
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

// A deterministic 128-bit, non-cryptographic metadata fingerprint. No media bytes
// are read. This is an identity hint, not a content checksum or security primitive.
function stableId(file: File, path: string): string {
  const input = JSON.stringify([path, file.size, file.lastModified]);
  let a = 1779033703,
    b = 3144134277,
    c = 1013904242,
    d = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    a = b ^ Math.imul(a ^ k, 597399067);
    b = c ^ Math.imul(b ^ k, 2869860233);
    c = d ^ Math.imul(c ^ k, 951274213);
    d = a ^ Math.imul(d ^ k, 2716044179);
  }
  a = Math.imul(c ^ (a >>> 18), 597399067);
  b = Math.imul(d ^ (b >>> 22), 2869860233);
  c = Math.imul(a ^ (c >>> 17), 951274213);
  d = Math.imul(b ^ (d >>> 19), 2716044179);
  return (
    "folder-" +
    [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a]
      .map((n) => (n >>> 0).toString(16).padStart(8, "0"))
      .join("")
  );
}

/**
 * Plan a one-shot folder selection; the caller owns object URLs and persistence.
 * A selected catalog.json takes precedence over `catalog`. Invalid, oversized or
 * multiple catalogs reject the whole plan (never fall back to importing extras).
 * `skipped` counts input files not used as media, thumbnails or the chosen catalog;
 * `missing` counts nonprocedural catalog rows without one unambiguous media file.
 * Missing thumbnails do not increment `missing`. An empty catalog imports nothing.
 *
 * Catalog matching is case-sensitive, on complete path segments: a selected root
 * may precede the entire catalog path, and assets/media/... also accepts media/....
 * No basename-only, external URL, query/fragment, traversal or backslash matching.
 * Pick a root containing assets/ or media/; picking prepared/ alone cannot relink.
 * Generic folders use MIME/extension hints, omit thumbnail directories, paired JPEG
 * basenames and legacy ORGY filenames. Formats/codecs are not decoded or verified.
 * IDs depend on selected relative path, size and mtime, not content; changing the
 * selected root or file metadata can change an ID. Identical paths are ambiguous.
 * Limits: 100,000 files, 8,192 path characters, 64 segments, 10 MiB catalog bytes;
 * catalog row/schema bounds come from validateAssetCatalog. Only catalog is read.
 */
export async function planFolderLibrary(
  files: readonly File[],
  catalog?: readonly Asset[],
): Promise<FolderLibraryPlan> {
  if (files.length > MAX_FILES) throw new Error("Folder exceeds 100,000 files");
  const catalogFiles = files.filter(
    (file) => file.name.toLowerCase() === "catalog.json",
  );
  if (catalogFiles.length > 1)
    throw new Error("Multiple catalog.json files are ambiguous");
  const chosen = catalogFiles[0];
  let rows: Asset[] | undefined;
  if (chosen) {
    if (!normalizePath(chosen.webkitRelativePath || chosen.name))
      throw new Error("Invalid catalog.json path");
    if (chosen.size > MAX_CATALOG_BYTES)
      throw new Error("catalog.json exceeds 10 MiB");
    rows = validateAssetCatalog(
      JSON.parse((await chosen.text()).replace(/^\uFEFF/, "")),
    );
  } else if (catalog !== undefined) {
    rows = validateAssetCatalog(catalog);
  }

  const local: LocalFile[] = [];
  const paths = new Map<string, LocalFile[]>();
  for (const file of files) {
    if (file === chosen) continue;
    const path = normalizePath(file.webkitRelativePath || file.name);
    if (!path || excluded(path)) continue;
    const item = { file, path, kind: kind(file, path) };
    local.push(item);
    const group = paths.get(path) ?? [];
    group.push(item);
    paths.set(path, group);
  }

  const entries: FolderLibraryPlan["entries"] = [];
  const used = new Set<File>(chosen ? [chosen] : []);
  let missing = 0;
  if (rows !== undefined) {
    // Index only the requested anchored suffixes, avoiding all-pairs file scans.
    const suffixes = new Map<string, Set<LocalFile>>();
    const keys = (url?: string): string[] => {
      const path = url && normalizePath(url, true);
      if (!path || !/^(?:assets|media)\/[^/]/.test(path)) return [];
      return path.startsWith("assets/media/") ? [path, path.slice(7)] : [path];
    };
    for (const row of rows) {
      for (const key of [...keys(row.url), ...keys(row.thumbnail)])
        if (!suffixes.has(key)) suffixes.set(key, new Set());
    }
    for (const item of local) {
      const parts = item.path.split("/");
      for (let i = 0; i < parts.length - 1; i++) {
        const candidates = suffixes.get(parts.slice(i).join("/"));
        // Two candidates already establish ambiguity; never retain an unbounded
        // list that would be expanded again for each catalog row.
        if (candidates && candidates.size < 2) candidates.add(item);
      }
    }
    const match = (url?: string): LocalFile | undefined => {
      const candidates = new Set(
        keys(url).flatMap((key) => [...(suffixes.get(key) ?? [])]),
      );
      return candidates.size === 1 ? [...candidates][0] : undefined;
    };
    const pending = rows
      .filter((row) => row.kind !== "procedural")
      .map((asset) => ({ asset, item: match(asset.url) }));
    const claims = new Map<LocalFile, number>();
    for (const { item } of pending)
      if (item) claims.set(item, (claims.get(item) ?? 0) + 1);
    for (const { asset, item } of pending) {
      if (!item || claims.get(item) !== 1) {
        missing++;
        continue;
      }
      const preview = match(asset.thumbnail);
      const thumbnail = preview?.kind === "image" ? preview.file : undefined;
      entries.push({
        asset,
        file: item.file,
        ...(thumbnail ? { thumbnail } : {}),
      });
      used.add(item.file);
      if (thumbnail) used.add(thumbnail);
    }
  } else {
    const videoStems = new Set(
      local
        .filter((item) => item.kind === "video")
        .map((item) => stem(item.path)),
    );
    for (const item of local) {
      if (
        !item.kind ||
        paths.get(item.path)!.length !== 1 ||
        thumbnailDirectory(item.path)
      )
        continue;
      if (
        item.kind === "image" &&
        (extension(item.path) === "jpg" ||
          extension(item.path) === "jpeg" ||
          item.file.type === "image/jpeg") &&
        videoStems.has(stem(item.path))
      )
        continue;
      entries.push({
        asset: {
          id: stableId(item.file, item.path),
          name: item.file.name.replace(/\.[^.]+$/, ""),
          kind: item.kind,
          tags: ["local"],
          hue: 210,
          energy: 0.5,
          license: "User supplied",
          bytes: item.file.size,
          status: "local",
        },
        file: item.file,
      });
      used.add(item.file);
    }
  }
  return {
    entries,
    skipped: files.filter((file) => !used.has(file)).length,
    missing,
  };
}
