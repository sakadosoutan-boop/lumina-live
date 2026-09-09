import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Read-only media audit. The only writable files are these two reports.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = "research/library-audit.json";
const CACHE = "research/media-decode-cache.json";
const LIMIT = 20_000_000_000;
const INPUTS = [
  "assets/open-candidates.json",
  "assets/pack-candidates.json",
  "assets/catalog.json",
  "assets/prepared.json",
  "assets/excluded.json",
  "research/open-acquisition.json",
  "research/pack-acquisition.json",
  "src/catalog.ts",
  "scripts/audit-library.mjs",
];
const DECODE_BEFORE_INPUT = [
  "-hide_banner",
  "-nostdin",
  "-v",
  "error",
  "-xerror",
  "-threads",
  "2",
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegts,flv,ogg",
];
const DECODE_AFTER_INPUT = ["-map", "0:v:0", "-an", "-f", "null", "-"];
const now = () => new Date().toISOString();
const sha = (data) => createHash("sha256").update(data).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");
const key = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const hashOK = (value) =>
  typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const sizeOK = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code) => Object.assign(new Error(code), { code });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// OneDrive hydration can change ctime without changing media contents. Identity,
// length and mtime guard reads; SHA256 is always recomputed, even on cache hits.
const sameStat = (a, b) =>
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ino === b.ino &&
  a.dev === b.dev;

export function mediaPath(value, isUrl = false) {
  if (typeof value !== "string" || !value || /[\x00-\x1f]/.test(value))
    throw fail("INVALID_MEDIA_PATH");
  let p = slash(value);
  if (isUrl) {
    if (!p.startsWith("/assets/media/") || /[?#]/.test(p))
      throw fail("INVALID_MEDIA_URL");
    try {
      p = p.split("/").map(decodeURIComponent).join("/").slice(1);
    } catch {
      throw fail("INVALID_URL_ENCODING");
    }
  } else if (path.isAbsolute(p)) {
    p = slash(path.relative(ROOT, path.resolve(p)));
  }
  const parts = p.split("/");
  if (
    !p.startsWith("assets/media/") ||
    parts.some(
      (s) =>
        !s ||
        s === "." ||
        s === ".." ||
        /[\\:\x00-\x1f]/.test(s) ||
        /[. ]$/.test(s),
    )
  )
    throw fail("OUTSIDE_SAFE_MEDIA");
  if (path.isAbsolute(p) || path.win32.isAbsolute(p))
    throw fail("OUTSIDE_SAFE_MEDIA");
  return p;
}

// lstat every component, including the leaf; never follow a symlink/junction.
export async function safeStat(relative, { missing = false } = {}) {
  if (
    typeof relative !== "string" ||
    relative.includes("\\") ||
    path.isAbsolute(relative) ||
    relative
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.includes(":"))
  )
    throw fail("UNSAFE_REPO_PATH");
  const rootStat = await fs.lstat(ROOT);
  if (
    rootStat.isSymbolicLink() ||
    key(path.resolve(await fs.realpath(ROOT))) !== key(ROOT)
  )
    throw fail("SYMLINK_ROOT");
  let full = ROOT;
  const parts = relative.split("/");
  let stat;
  for (let i = 0; i < parts.length; i++) {
    full = path.join(full, parts[i]);
    try {
      stat = await fs.lstat(full);
    } catch (error) {
      if (missing && error.code === "ENOENT" && i === parts.length - 1)
        return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw fail("SYMLINK_REJECTED");
    if (i < parts.length - 1 && !stat.isDirectory())
      throw fail("NOT_A_DIRECTORY");
  }
  const real = await fs.realpath(full);
  if (key(path.resolve(real)) !== key(path.resolve(ROOT, relative)))
    throw fail("REALPATH_MISMATCH");
  return stat;
}

async function readStable(relative) {
  const before = await safeStat(relative);
  if (!before.isFile()) throw fail("NOT_A_REGULAR_FILE");
  const handle = await fs.open(path.join(ROOT, relative), "r");
  try {
    if (!sameStat(before, await handle.stat()))
      throw fail("FILE_CHANGED_DURING_READ");
    const bytes = await handle.readFile();
    if (
      !sameStat(before, await handle.stat()) ||
      !sameStat(before, await safeStat(relative))
    )
      throw fail("FILE_CHANGED_DURING_READ");
    return {
      bytes,
      size: before.size,
      mtimeMs: before.mtimeMs,
      sha256: sha(bytes),
      capturedAt: now(),
    };
  } finally {
    await handle.close();
  }
}

async function hashMedia(relative) {
  mediaPath(relative);
  const before = await safeStat(relative);
  if (!before.isFile()) throw fail("NOT_A_REGULAR_FILE");
  const handle = await fs.open(path.join(ROOT, relative), "r");
  try {
    if (!sameStat(before, await handle.stat()))
      throw fail("FILE_CHANGED_DURING_HASH");
    const digest = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      digest.update(chunk);
    if (
      !sameStat(before, await handle.stat()) ||
      !sameStat(before, await safeStat(relative))
    )
      throw fail("FILE_CHANGED_DURING_HASH");
    return {
      path: relative,
      size: before.size,
      mtimeMs: before.mtimeMs,
      sha256: digest.digest("hex"),
      stat: before,
    };
  } finally {
    await handle.close();
  }
}

function cleanText(value) {
  return value
    .replaceAll(ROOT, "[repo]")
    .replaceAll(slash(ROOT), "[repo]")
    .replace(/[A-Za-z]:[\\/][^\r\n"<>|]*/g, "[absolute-path-redacted]")
    .replace(/\/(?:Users|home)\/[^\s"<>]+/g, "[absolute-path-redacted]");
}

async function save(relative, value) {
  if (![AUDIT, CACHE].includes(relative)) throw fail("WRITE_NOT_OWNED");
  const previous = await safeStat(relative, { missing: true });
  if (previous && (!previous.isFile() || previous.nlink > 1))
    throw fail("UNSAFE_REPORT_TARGET");
  // No temporary files: this task owns exactly the script and these two paths.
  const handle = await fs.open(
    path.join(ROOT, relative),
    previous ? "r+" : "wx",
  );
  try {
    if (previous && !sameStat(previous, await handle.stat()))
      throw fail("REPORT_TARGET_CHANGED");
    const text =
      JSON.stringify(
        value,
        (_k, v) => (typeof v === "string" ? cleanText(v) : v),
        2,
      ) + "\n";
    await handle.truncate(0);
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function fileKind(relative) {
  if (/\.(?:part|partial|tmp|crdownload|download)(?:\.|$)/i.test(relative))
    return "partial";
  if (/\.(?:zip|7z|rar|tar|tgz|gz)$/i.test(relative)) return "transferArchive";
  if (
    /\.(?:mp4|mov|m4v|webm|mkv|avi|mpg|mpeg|mts|m2ts|flv|ogv)$/i.test(relative)
  )
    return "videoFile";
  if (/\.(?:jpg|jpeg|png|webp|gif)$/i.test(relative)) return "image";
  return "other";
}

export function cacheHit(entry, actual, decoderSignature) {
  return (
    !!entry &&
    entry.pass === true &&
    entry.fullDecode === true &&
    entry.decoderSignature === decoderSignature &&
    entry.path === actual.path &&
    entry.size === actual.size &&
    entry.mtimeMs === actual.mtimeMs &&
    hashOK(entry.sha256) &&
    entry.sha256 === actual.sha256
  );
}

async function pool(items, limit, fn) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const i = index++;
        await fn(items[i], i);
      }
    }),
  );
}

async function inventory() {
  const result = { assets: [], researchEvidence: [], rejected: [] };
  async function walk(relative, destination) {
    let stat;
    try {
      stat = await safeStat(relative);
    } catch (error) {
      result.rejected.push({
        path: relative,
        code: error.code ?? "INVENTORY_ERROR",
      });
      return;
    }
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = await fs.readdir(path.join(ROOT, relative));
      } catch (error) {
        result.rejected.push({
          path: relative,
          code: error.code ?? "DIRECTORY_READ_ERROR",
        });
        return;
      }
      for (const name of entries.sort()) {
        const child = relative + "/" + name;
        if (child !== AUDIT && child !== CACHE) await walk(child, destination);
      }
    } else if (stat.isFile()) {
      destination.push({
        path: relative,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        kind: fileKind(relative),
      });
    } else result.rejected.push({ path: relative, code: "NOT_A_REGULAR_FILE" });
  }
  await walk("assets", result.assets);
  await walk("research", result.researchEvidence);
  result.fingerprint = sha(JSON.stringify(result));
  result.measuredAt = now();
  return result;
}

async function snapshot() {
  const result = {};
  for (const relative of INPUTS) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const data = await readStable(relative);
        const text = data.bytes.toString("utf8").replace(/^\uFEFF/, "");
        result[relative] = {
          ...data,
          data: relative.endsWith(".json") ? JSON.parse(text) : text,
        };
        delete result[relative].bytes;
        break;
      } catch (error) {
        if (
          attempt < 7 &&
          (error instanceof SyntaxError ||
            ["ENOENT", "FILE_CHANGED_DURING_READ"].includes(error.code))
        ) {
          await delay(150);
        } else {
          result[relative] = {
            error: error.code ?? "INVALID_JSON",
            capturedAt: now(),
          };
          break;
        }
      }
    }
  }
  return result;
}

function snapshotHashes(inputs) {
  return Object.fromEntries(
    Object.entries(inputs).map(([p, v]) => [p, v.sha256 ?? null]),
  );
}

export function proceduralCount(text) {
  // Parse static arrays without evaluating application code or loading its UI.
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const ast = ts.createSourceFile(
    "catalog.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const arrays = {};
  let generator = "";
  for (const statement of ast.statements)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(ast);
        if (
          ["families", "variations"].includes(name) &&
          declaration.initializer &&
          ts.isArrayLiteralExpression(declaration.initializer)
        ) {
          if (
            !declaration.initializer.elements.every((e) =>
              ts.isObjectLiteralExpression(e),
            )
          )
            throw fail("PROCEDURAL_ARRAY_UNSUPPORTED");
          arrays[name] = declaration.initializer.elements.length;
        }
        if (name === "builtInAssets")
          generator = declaration.initializer?.getText(ast) ?? "";
      }
    }
  if (
    !arrays.families ||
    !arrays.variations ||
    !/families\.flatMap\(/.test(generator) ||
    !/variations\.map\(/.test(generator) ||
    !/kind:\s*["']procedural["']/.test(generator)
  )
    throw fail("PROCEDURAL_GENERATOR_UNSUPPORTED");
  return {
    count: arrays.families * arrays.variations,
    ...arrays,
    expected: 96,
    method:
      "Static TypeScript arrays and generator inspected; no media file or decode required.",
  };
}

const childProcesses = new Set();
async function fullDecode(ffmpeg, actual) {
  if (!sameStat(actual.stat, await safeStat(actual.path)))
    throw fail("FILE_CHANGED_BEFORE_DECODE");
  const result = await new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [...DECODE_BEFORE_INPUT, "-i", actual.path, ...DECODE_AFTER_INPUT],
      {
        cwd: ROOT,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    childProcesses.add(child);
    let stderr = "",
      stderrBytes = 0,
      errorCode = null,
      timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        child.kill();
      },
      30 * 60 * 1000,
    );
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      stderr = (stderr + chunk.toString("utf8")).slice(-16384);
    });
    child.on("error", (error) => {
      errorCode = error.code ?? "SPAWN_ERROR";
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      childProcesses.delete(child);
      resolve({
        pass: exitCode === 0 && stderrBytes === 0 && !errorCode && !timedOut,
        exitCode,
        signal,
        errorCode,
        timedOut,
        stderrBytes,
        stderr: cleanText(stderr),
        childPid: child.pid ?? null,
      });
    });
  });
  if (!sameStat(actual.stat, await safeStat(actual.path)))
    throw fail("FILE_CHANGED_DURING_DECODE");
  return result;
}

async function main() {
  const startedAt = now();
  console.log(
    `[audit] pid=${process.pid} started=${startedAt} decodeConcurrency=2`,
  );
  const failures = [],
    warnings = [];
  const addFailure = (phase, code, details = {}) =>
    failures.push({ phase, code, ...details });
  const inputs = await snapshot();
  for (const [p, item] of Object.entries(inputs))
    if (item.error) addFailure("input", item.error, { path: p });
  const inputData = (p, fallback) => inputs[p]?.data ?? fallback;
  function arrayInput(p) {
    const value = inputData(p, []);
    if (!Array.isArray(value)) {
      addFailure("input", "EXPECTED_ARRAY", { path: p });
      return [];
    }
    return value;
  }
  const open = arrayInput("assets/open-candidates.json");
  const packs = arrayInput("assets/pack-candidates.json");
  const catalog = arrayInput("assets/catalog.json");
  const excluded = arrayInput("assets/excluded.json");
  const prepared = inputData("assets/prepared.json", {}).entries ?? {};
  if (typeof prepared !== "object" || Array.isArray(prepared))
    throw fail("INVALID_PREPARED_ENTRIES");
  const packLedger = inputData("research/pack-acquisition.json", {});
  const packAuthors = new Map(
    (packLedger.packs ?? []).map((p) => [p.id, p.author]),
  );
  const source = [
    ...open.map((row) => ({ row, lane: "open" })),
    ...packs.map((row) => ({ row, lane: "pack" })),
  ];
  const excludedIds = new Set(excluded.map((row) => row.id));
  const catalogIds = new Set(catalog.map((row) => row.id));
  const sourceById = new Map();
  const jobs = new Map();
  const sourceRecords = [],
    catalogRecords = [];
  const byProvider = {};
  const providerFor = (row) =>
    row.provider ?? packAuthors.get(row.packId) ?? row.packId ?? "Unknown";
  const providerStats = (provider) =>
    (byProvider[provider] ??= {
      sourceAcquired: 0,
      sourceBytes: 0,
      playable: 0,
      playableBytes: 0,
      excluded: 0,
      catalogPending: 0,
    });
  function getPath(value, url = false) {
    return mediaPath(value, url);
  }
  function register(record) {
    if (!record.path) return;
    const k = key(record.path);
    if (!jobs.has(k)) jobs.set(k, { path: record.path, records: [] });
    jobs.get(k).records.push(record);
  }
  function recordProblem(record, code) {
    record.problems.push(code);
    addFailure(record.scope, code, {
      id: record.id,
      ...(record.path ? { path: record.path } : {}),
    });
  }
  for (const { row, lane } of source) {
    const record = {
      scope: "source",
      id: row.id,
      lane,
      provider: providerFor(row),
      problems: [],
    };
    const stats = providerStats(record.provider);
    stats.sourceAcquired++;
    if (sourceById.has(row.id)) recordProblem(record, "DUPLICATE_SOURCE_ID");
    sourceById.set(row.id, { row, record });
    try {
      record.path = row.localPath
        ? getPath(row.localPath)
        : getPath(row.url, true);
      if (row.url && key(getPath(row.url, true)) !== key(record.path))
        recordProblem(record, "SOURCE_URL_PATH_MISMATCH");
      if (fileKind(record.path) !== "videoFile")
        recordProblem(record, "SOURCE_NOT_COMPLETED_VIDEO_PATH");
    } catch (error) {
      recordProblem(record, error.code ?? "INVALID_SOURCE_PATH");
    }
    record.expectedSize = row.bytes ?? row.acquiredBytes;
    record.expectedSha256 = row.sha256?.toLowerCase();
    if (!sizeOK(record.expectedSize))
      recordProblem(record, "MISSING_SOURCE_SIZE");
    if (!hashOK(record.expectedSha256))
      recordProblem(record, "MISSING_SOURCE_SHA256");
    if (sizeOK(row.acquiredBytes) && row.acquiredBytes !== record.expectedSize)
      recordProblem(record, "SOURCE_SIZE_METADATA_MISMATCH");
    stats.sourceBytes += sizeOK(record.expectedSize) ? record.expectedSize : 0;
    record.excluded = excludedIds.has(row.id);
    record.inCatalog = catalogIds.has(row.id);
    if (record.excluded) stats.excluded++;
    else if (!record.inCatalog) stats.catalogPending++;
    sourceRecords.push(record);
    register(record);
  }
  const seenCatalogIds = new Set();
  for (const row of catalog) {
    const sourceItem = sourceById.get(row.id);
    const record = {
      scope: "catalog",
      id: row.id,
      provider: sourceItem?.record.provider ?? providerFor(row),
      problems: [],
    };
    const stats = providerStats(record.provider);
    stats.playable++;
    if (seenCatalogIds.has(row.id))
      recordProblem(record, "DUPLICATE_CATALOG_ID");
    seenCatalogIds.add(row.id);
    if (!sourceItem) recordProblem(record, "CATALOG_WITHOUT_SOURCE");
    if (excludedIds.has(row.id)) recordProblem(record, "EXCLUDED_IN_CATALOG");
    if (row.kind !== "video") recordProblem(record, "UNSUPPORTED_CATALOG_KIND");
    const entry = prepared[row.id];
    if (!entry) recordProblem(record, "MISSING_PREPARED_ENTRY");
    try {
      record.path = getPath(row.url, true);
      if (fileKind(record.path) !== "videoFile")
        recordProblem(record, "CATALOG_NOT_COMPLETED_VIDEO_PATH");
      if (entry && key(getPath(entry.playablePath)) !== key(record.path))
        recordProblem(record, "PREPARED_PLAYABLE_PATH_MISMATCH");
      if (
        entry &&
        sourceItem?.record.path &&
        key(getPath(entry.sourcePath)) !== key(sourceItem.record.path)
      )
        recordProblem(record, "PREPARED_SOURCE_PATH_MISMATCH");
    } catch (error) {
      recordProblem(record, error.code ?? "INVALID_CATALOG_PATH");
    }
    record.expectedSize = row.bytes;
    record.expectedSha256 = (entry?.sha256 ?? row.sha256)?.toLowerCase();
    if (!sizeOK(record.expectedSize))
      recordProblem(record, "MISSING_CATALOG_SIZE");
    if (!hashOK(record.expectedSha256))
      recordProblem(record, "MISSING_PLAYABLE_SHA256");
    if (entry && entry.bytes !== row.bytes)
      recordProblem(record, "PREPARED_SIZE_METADATA_MISMATCH");
    if (row.sha256 && row.sha256.toLowerCase() !== record.expectedSha256)
      recordProblem(record, "CATALOG_SHA_METADATA_MISMATCH");
    if (
      entry &&
      sourceItem &&
      entry.sourceHash?.toLowerCase() !== sourceItem.record.expectedSha256
    )
      recordProblem(record, "PREPARED_SOURCE_HASH_MISMATCH");
    if (entry?.error) recordProblem(record, "PREPARED_ENTRY_HAS_ERROR");
    stats.playableBytes += sizeOK(record.expectedSize)
      ? record.expectedSize
      : 0;
    catalogRecords.push(record);
    register(record);
  }
  let procedural = { count: null, expected: 96 };
  try {
    procedural = proceduralCount(inputData("src/catalog.ts", ""));
    if (procedural.count !== 96)
      addFailure("procedural", "PROCEDURAL_COUNT_MISMATCH");
  } catch (error) {
    addFailure("procedural", error.code ?? "PROCEDURAL_INSPECTION_FAILED");
  }
  const pending = sourceRecords
    .filter((r) => !r.excluded && !r.inCatalog)
    .map((r) => ({
      id: r.id,
      path: r.path,
      lane: r.lane,
      provider: r.provider,
      reason:
        prepared[r.id]?.playablePath &&
        hashOK(prepared[r.id]?.sha256) &&
        !prepared[r.id]?.error
          ? "preparedNotCatalog"
          : "notPrepared",
    }));
  const counts = {
    sourceAcquired: source.length,
    sourceOpenAcquired: open.length,
    sourcePackAcquired: packs.length,
    sourceUniquePaths: new Set(
      sourceRecords.filter((r) => r.path).map((r) => key(r.path)),
    ).size,
    sourceReferencedByCatalog: sourceRecords.filter((r) => r.inCatalog).length,
    playable: catalog.length,
    playableUniquePaths: new Set(
      catalogRecords.filter((r) => r.path).map((r) => key(r.path)),
    ).size,
    procedural: procedural.count,
    combinedPlayable: catalog.length + (procedural.count ?? 0),
    excluded: sourceRecords.filter((r) => r.excluded).length,
    excludedList: excluded.length,
    catalogPending: pending.length,
    catalogPendingOpen: pending.filter((r) => r.lane === "open").length,
    catalogPendingPack: pending.filter((r) => r.lane === "pack").length,
    catalogPendingNotPrepared: pending.filter((r) => r.reason === "notPrepared")
      .length,
    catalogPendingPreparedNotCatalog: pending.filter(
      (r) => r.reason === "preparedNotCatalog",
    ).length,
    preparedEntries: Object.keys(prepared).length,
  };
  const initialInventory = await inventory();
  const decode = {
    concurrencyLimit: 2,
    observedMaxConcurrency: 0,
    fullLength: true,
    scope: "Unique video paths referenced by captured catalog.json",
    command: [
      "ffmpeg-static/ffmpeg.exe",
      ...DECODE_BEFORE_INPUT,
      "-i",
      "<repo-relative-path>",
      ...DECODE_AFTER_INPUT,
    ],
    timeoutPerFileMs: 30 * 60 * 1000,
    scheduled: counts.playableUniquePaths,
    executed: 0,
    reused: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    childPids: [],
    results: [],
  };
  let ffmpeg = null,
    decoderSignature = null;
  try {
    const require = createRequire(import.meta.url);
    ffmpeg = require("ffmpeg-static");
    const ffmpegRelative = slash(path.relative(ROOT, ffmpeg));
    if (!ffmpegRelative.startsWith("node_modules/ffmpeg-static/"))
      throw fail("UNEXPECTED_FFMPEG_PATH");
    const binary = await readStable(ffmpegRelative);
    decode.binaryPath = ffmpegRelative;
    decode.binarySha256 = binary.sha256;
    decoderSignature = sha(
      JSON.stringify({
        sha256: binary.sha256,
        before: DECODE_BEFORE_INPUT,
        after: DECODE_AFTER_INPUT,
        policy: "full-decode-no-error-output-v1",
      }),
    );
    decode.decoderSignature = decoderSignature;
  } catch (error) {
    ffmpeg = null;
    addFailure("decode", error.code ?? "FFMPEG_UNAVAILABLE");
  }
  const cache = {
    version: 2,
    updatedAt: now(),
    algorithm: "SHA256",
    entries: {},
  };
  try {
    const old = JSON.parse((await readStable(CACHE)).bytes.toString("utf8"));
    if (old.version === 2 && old.entries && typeof old.entries === "object") {
      for (const [p, entry] of Object.entries(old.entries)) {
        try {
          if (
            mediaPath(p) === p &&
            entry.path === p &&
            sizeOK(entry.size) &&
            Number.isFinite(entry.mtimeMs) &&
            hashOK(entry.sha256)
          ) {
            cache.entries[p] = {
              path: p,
              size: entry.size,
              mtimeMs: entry.mtimeMs,
              sha256: entry.sha256,
              pass: entry.pass === true,
              fullDecode: entry.fullDecode === true,
              decoderSignature: entry.decoderSignature,
              checkedAt: entry.checkedAt,
            };
          }
        } catch {
          /* Reject absolute, traversal, or unsupported legacy cache entries. */
        }
      }
    } else warnings.push({ code: "CACHE_SCHEMA_NOT_REUSABLE" });
  } catch (error) {
    if (error.code !== "ENOENT")
      warnings.push({
        code: "CACHE_NOT_REUSABLE",
        reason: error.code ?? "INVALID_JSON",
      });
  }
  let saveChain = Promise.resolve();
  const saveCache = () => {
    cache.updatedAt = now();
    const copy = structuredClone(cache);
    saveChain = saveChain.then(() => save(CACHE, copy));
    return saveChain;
  };
  const audit = {
    version: 1,
    timestamp: now(),
    startedAt,
    pid: process.pid,
    status: "running",
    provisional: true,
    provisionalReason:
      "Parent may update acquisition and preparation concurrently. Rerun to verify new or changed media; this is a captured-input audit, not final distribution approval.",
    snapshotUpdated: false,
    inputManifestHashes: snapshotHashes(inputs),
    currentInputManifestHashes: null,
    counts,
    countDefinitions: {
      sourceAcquired:
        "Rows claimed acquired by both candidate manifests, including excluded sources.",
      playable:
        "Rows in captured catalog; validation and decode results reported separately.",
      catalogPending:
        "Source IDs absent from catalog, excluding excluded IDs; not a decode failure.",
      procedural:
        "Static built-in generative assets; separate from acquired/downloaded files.",
    },
    procedural,
    byProvider,
    pending,
    excluded: sourceRecords
      .filter((r) => r.excluded)
      .map((r) => ({ id: r.id, path: r.path, inCatalog: r.inCatalog })),
    sha: {
      algorithm: "SHA256",
      recomputedEveryRun: true,
      computedUniquePaths: 0,
      bytesRead: 0,
    },
    decode,
    failures,
    warnings,
  };
  await save(AUDIT, audit);
  console.log(
    `[snapshot] source=${counts.sourceAcquired} catalog=${counts.playable} procedural=${counts.procedural} excluded=${counts.excluded} pending=${counts.catalogPending}`,
  );
  let completed = 0;
  const jobList = [...jobs.values()];
  await pool(jobList, 2, async (job) => {
    try {
      job.actual = await hashMedia(job.path);
      audit.sha.computedUniquePaths++;
      audit.sha.bytesRead += job.actual.size;
      for (const record of job.records) {
        record.exists = true;
        record.actualSize = job.actual.size;
        record.actualSha256 = job.actual.sha256;
        record.sizeMatch = record.expectedSize === job.actual.size;
        record.hashMatch = record.expectedSha256 === job.actual.sha256;
        if (!record.sizeMatch) recordProblem(record, "SIZE_MISMATCH");
        if (!record.hashMatch) recordProblem(record, "SHA256_MISMATCH");
      }
    } catch (error) {
      job.error = error.code ?? "HASH_READ_FAILED";
      for (const record of job.records) {
        record.exists = error.code === "ENOENT" ? false : null;
        recordProblem(record, job.error);
      }
      delete cache.entries[job.path];
    }
    completed++;
    if (completed % 20 === 0 || completed === jobList.length)
      console.log(
        `[sha] ${completed}/${jobList.length} uniquePaths hashed=${audit.sha.computedUniquePaths} failures=${failures.length}`,
      );
  });
  completed = 0;
  let active = 0;
  const playableJobs = jobList.filter((job) =>
    job.records.some((r) => r.scope === "catalog"),
  );
  await pool(playableJobs, 2, async (job) => {
    const actual = job.actual;
    let result = { path: job.path, pass: false, reused: false };
    try {
      if (!actual || !ffmpeg || fileKind(job.path) !== "videoFile") {
        decode.skipped++;
        result.errorCode =
          job.error ?? (!ffmpeg ? "FFMPEG_UNAVAILABLE" : "NOT_VIDEO_PATH");
        addFailure("decode", "DECODE_SKIPPED", {
          path: job.path,
          reason: result.errorCode,
        });
      } else if (cacheHit(cache.entries[job.path], actual, decoderSignature)) {
        if (!sameStat(actual.stat, await safeStat(actual.path)))
          throw fail("FILE_CHANGED_BEFORE_CACHE_REUSE");
        result = {
          ...result,
          pass: true,
          reused: true,
          checkedAt: cache.entries[job.path].checkedAt,
        };
        decode.reused++;
      } else {
        active++;
        decode.observedMaxConcurrency = Math.max(
          decode.observedMaxConcurrency,
          active,
        );
        decode.executed++;
        try {
          result = {
            ...result,
            ...(await fullDecode(ffmpeg, actual)),
            checkedAt: now(),
          };
        } finally {
          active--;
        }
        if (result.childPid) decode.childPids.push(result.childPid);
        cache.entries[job.path] = {
          path: job.path,
          size: actual.size,
          mtimeMs: actual.mtimeMs,
          sha256: actual.sha256,
          pass: result.pass,
          fullDecode: true,
          decoderSignature,
          checkedAt: result.checkedAt,
        };
        if (!result.pass)
          addFailure("decode", "FULL_DECODE_FAILED", {
            path: job.path,
            exitCode: result.exitCode,
            reason: result.errorCode,
            timedOut: result.timedOut,
            stderr: result.stderr,
          });
      }
    } catch (error) {
      result.errorCode = error.code ?? "DECODE_ERROR";
      addFailure("decode", result.errorCode, { path: job.path });
      delete cache.entries[job.path];
    }
    if (result.pass) decode.passed++;
    else decode.failed++;
    decode.results.push(result);
    completed++;
    if (completed % 20 === 0 || completed === playableJobs.length) {
      console.log(
        `[decode] ${completed}/${playableJobs.length} pass=${decode.passed} executed=${decode.executed} reused=${decode.reused} failed=${decode.failed}`,
      );
      await saveCache();
    }
  });
  // Detect replacement after hashing/decoding, including sources not in catalog.
  for (const job of jobList)
    if (job.actual) {
      try {
        if (!sameStat(job.actual.stat, await safeStat(job.path)))
          throw fail("FILE_CHANGED_SINCE_HASH");
      } catch (error) {
        for (const record of job.records)
          recordProblem(record, error.code ?? "FINAL_STAT_FAILED");
        delete cache.entries[job.path];
        const result = decode.results.find(
          (r) => key(r.path) === key(job.path),
        );
        if (result?.pass) {
          result.pass = false;
          result.invalidated = true;
          decode.passed--;
          decode.failed++;
        }
      }
    }
  await saveCache();
  const finalInventory = await inventory();
  const currentInputs = await snapshot();
  const currentHashes = snapshotHashes(currentInputs);
  const changedInputs = INPUTS.filter(
    (p) => audit.inputManifestHashes[p] !== currentHashes[p],
  );
  for (const [p, item] of Object.entries(currentInputs))
    if (item.error)
      warnings.push({
        code: "CURRENT_INPUT_UNREADABLE",
        path: p,
        reason: item.error,
      });
  for (const rejected of finalInventory.rejected)
    addFailure("inventory", rejected.code, { path: rejected.path });
  const totalAssets = finalInventory.assets.reduce(
    (sum, item) => sum + item.size,
    0,
  );
  const researchEvidence = finalInventory.researchEvidence.reduce(
    (sum, item) => sum + item.size,
    0,
  );
  const total = totalAssets + researchEvidence;
  if (total > LIMIT)
    addFailure("capacity", "CAPACITY_LIMIT_EXCEEDED", { total, limit: LIMIT });
  function groupFiles(kind) {
    const files = finalInventory.assets.filter((item) => item.kind === kind);
    return {
      count: files.length,
      bytes: files.reduce((sum, item) => sum + item.size, 0),
      files,
    };
  }
  const libraries = finalInventory.assets.filter((item) =>
    /(?:^|\/)libraries(?:\/|$)/i.test(item.path),
  );
  for (const record of [...sourceRecords, ...catalogRecords])
    record.pass = record.problems.length === 0;
  const countPass = (records) => ({
    records: records.length,
    matched: records.filter((r) => r.pass).length,
    failed: records.filter((r) => !r.pass).length,
  });
  audit.sha.source = countPass(sourceRecords);
  audit.sha.catalog = countPass(catalogRecords);
  counts.verifiedSource = audit.sha.source.matched;
  const decodeByPath = new Map(decode.results.map((r) => [key(r.path), r]));
  counts.verifiedPlayable = catalogRecords.filter(
    (r) => r.pass && decodeByPath.get(key(r.path))?.pass,
  ).length;
  counts.completedVideoFilesOnDisk = finalInventory.assets.filter(
    (r) => r.kind === "videoFile",
  ).length;
  counts.transferArchives = finalInventory.assets.filter(
    (r) => r.kind === "transferArchive",
  ).length;
  counts.partialFiles = finalInventory.assets.filter(
    (r) => r.kind === "partial",
  ).length;
  audit.bytes = {
    limit: LIMIT,
    totalAssets,
    researchEvidence,
    total,
    withinLimit: total <= LIMIT,
    remaining: LIMIT - total,
    assetFiles: finalInventory.assets.length,
    researchEvidenceFiles: finalInventory.researchEvidence.length,
    scope:
      "Every regular file under assets, plus every research file except library-audit.json and media-decode-cache.json; includes source/pack snapshots, acquisition ledgers, ZIPs, partial transfers, and documents. File lengths (not allocated filesystem blocks). Symlinks rejected.",
    complete: finalInventory.rejected.length === 0,
    measuredAt: finalInventory.measuredAt,
    initialTotal: initialInventory.assets
      .concat(initialInventory.researchEvidence)
      .reduce((sum, item) => sum + item.size, 0),
  };
  audit.storage = {
    assets: finalInventory.assets,
    researchEvidence: finalInventory.researchEvidence,
    transferArchives: groupFiles("transferArchive"),
    partials: groupFiles("partial"),
    libraries: {
      count: libraries.length,
      bytes: libraries.reduce((sum, item) => sum + item.size, 0),
      files: libraries,
    },
    note: "Archive and partial counts are storage/transfer artifacts, never acquired or playable video counts. videoFile/completedVideoFilesOnDisk denotes a non-partial video filename, not a decode guarantee.",
  };
  audit.sourceChecks = sourceRecords;
  audit.catalogChecks = catalogRecords;
  audit.currentInputManifestHashes = currentHashes;
  audit.changedInputs = changedInputs;
  audit.inventoryUpdated =
    initialInventory.fingerprint !== finalInventory.fingerprint;
  audit.snapshotUpdated = changedInputs.length > 0 || audit.inventoryUpdated;
  const currentOpen = currentInputs["assets/open-candidates.json"]?.data;
  const currentPacks = currentInputs["assets/pack-candidates.json"]?.data;
  const currentCatalog = currentInputs["assets/catalog.json"]?.data;
  audit.currentSnapshotCounts = {
    sourceOpenAcquired: Array.isArray(currentOpen) ? currentOpen.length : null,
    sourcePackAcquired: Array.isArray(currentPacks)
      ? currentPacks.length
      : null,
    playable: Array.isArray(currentCatalog) ? currentCatalog.length : null,
    note: "End-of-run manifest counts only; new rows have not been audited by this run.",
  };
  audit.cache = {
    path: CACHE,
    entries: Object.keys(cache.entries).length,
    reuseRequires: [
      "repoRelativePath",
      "size",
      "mtimeMs",
      "recomputedSHA256",
      "pass",
      "fullDecode",
      "decoderSignature",
    ],
  };
  audit.completedAt = now();
  audit.timestamp = audit.completedAt;
  audit.elapsedSeconds = Number(
    ((Date.parse(audit.completedAt) - Date.parse(startedAt)) / 1000).toFixed(3),
  );
  const finalRequested = process.argv.includes("--final");
  audit.provisional =
    !finalRequested || audit.snapshotUpdated || failures.length > 0;
  audit.provisionalReason = audit.provisional
    ? "Captured input snapshot; check changedInputs and failures before using as the final inventory."
    : "Final local file inventory and decode checks completed; hardware performance and live operation are separate checks.";
  audit.status = failures.length
    ? "failed"
    : audit.snapshotUpdated
      ? "snapshotUpdated"
      : finalRequested
        ? "verified"
        : "provisional";
  audit.outcome = failures.length ? "failed" : "verifiedCapturedSnapshot";
  audit.exitCode = failures.length ? 1 : 0;
  audit.completed = true;
  decode.results.sort((a, b) => a.path.localeCompare(b.path));
  await save(AUDIT, audit);
  console.log(
    JSON.stringify({
      pid: process.pid,
      completed: true,
      status: audit.status,
      outcome: audit.outcome,
      snapshotUpdated: audit.snapshotUpdated,
      counts,
      sha: audit.sha,
      decode: {
        executed: decode.executed,
        reused: decode.reused,
        passed: decode.passed,
        failed: decode.failed,
        concurrency: decode.observedMaxConcurrency,
      },
      bytes: audit.bytes,
      failures: failures.length,
      changedInputs,
      currentSnapshotCounts: audit.currentSnapshotCounts,
      elapsedSeconds: audit.elapsedSeconds,
      exitCode: audit.exitCode,
      output: AUDIT,
      cache: CACHE,
    }),
  );
  process.exitCode = audit.exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      for (const child of childProcesses) child.kill();
      console.error(
        JSON.stringify({
          pid: process.pid,
          completed: false,
          error: "INTERRUPTED",
          signal,
        }),
      );
      process.exit(130);
    });
  main().catch((error) => {
    for (const child of childProcesses) child.kill();
    console.error(
      JSON.stringify({
        pid: process.pid,
        completed: false,
        error: error.code ?? "AUDIT_FATAL_ERROR",
      }),
    );
    process.exitCode = 1;
  });
}
