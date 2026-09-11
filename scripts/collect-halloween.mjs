import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import ffmpeg from "ffmpeg-static";

// Only writes the independent catalog/journal and assets/media/halloween/stock/**.
// One ordinary GET per missing source; no retries, cookies, URL rewriting or mirrors.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOCK = path.join(ROOT, "assets/media/halloween/stock");
const JOURNAL = path.join(ROOT, "research/halloween-acquisition.json");
const CATALOG = path.join(ROOT, "assets/halloween-catalog.json");
const CAP = 200_000_000; // Both cumulative received source bytes and managed media disk.
const FILE_CAP = 80_000_000;
const FETCH_MS = 120_000;
const PROCESS_MS = 300_000;
const PIPELINE = "h264-crf24-veryfast-yuv420p-720p30-muted-v1";
const SELECTION = [
  "moon-360",
  "vetla-fog",
  "misty-river-47",
  "misty-river",
  "bats-thermal",
];
const args = process.argv.slice(2);
if (args.some((a) => !["--verify-only", "--help"].includes(a)))
  throw Error("Unknown argument");
if (args.includes("--help")) {
  console.log(
    "node scripts/collect-halloween.mjs [--verify-only]\n200 MB source-transfer and stock-disk ceilings; ordinary HTTPS GET only; persisted HTTP 403 is never retried. Verify-only reuses existing sources and performs full video decoding without network.",
  );
  process.exit(0);
}
const VERIFY = args.includes("--verify-only");
const now = () => new Date().toISOString();
const relative = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const url = (p) => "/" + relative(p);
const error = (code, message) => Object.assign(Error(message), { code });
async function stat(p) {
  try {
    const s = await fs.lstat(p);
    if (s.isSymbolicLink()) throw error("SYMLINK", p);
    return s;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function readJSON(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function hash(p) {
  const h = createHash("sha256");
  for await (const b of createReadStream(p)) h.update(b);
  return h.digest("hex");
}
async function diskBytes(p = STOCK) {
  let n = 0;
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw error("SYMLINK", path.join(p, e.name));
    const f = path.join(p, e.name);
    n += e.isDirectory() ? await diskBytes(f) : (await fs.stat(f)).size;
  }
  return n;
}
async function atomicJSON(p, value) {
  // Temporary writes remain inside the owned stock subtree, even for JSON reports.
  const temp = path.join(STOCK, path.basename(p) + ".tmp");
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(temp, p);
}
function run(a) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ["-hide_banner", "-nostdin", "-nostats", ...a],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "",
      failure;
    const timer = setTimeout(() => {
      failure = error("FFMPEG_TIMEOUT", "FFmpeg exceeded 5 minutes");
      child.kill();
    }, PROCESS_MS);
    child.stdout.on("data", (b) => {
      stdout = (stdout + b).slice(-100_000);
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-100_000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(error("FFMPEG_FAILED", stderr.slice(-5000)));
      else resolve({ stdout, stderr });
    });
  });
}
const inputArgs = (p) => [
  "-xerror",
  "-err_detect",
  "explode",
  "-threads",
  "2",
  "-protocol_whitelist",
  "file,pipe",
  "-i",
  p,
];
async function decode(p, delivery = false) {
  const result = await run([
    ...inputArgs(p),
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-progress",
    "pipe:1",
    "-f",
    "null",
    "-",
  ]);
  const frames = Number(
    [...result.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1],
  );
  const seconds =
    Number([...result.stdout.matchAll(/^out_time_us=(\d+)/gm)].at(-1)?.[1]) /
    1e6;
  const inputLog = result.stderr.split("Output #")[0];
  const stream = inputLog.split("\n").find((s) => s.includes("Video:")) ?? "";
  const dims = /\b(\d{2,5})x(\d{2,5})\b/.exec(stream);
  const width = Number(dims?.[1]),
    height = Number(dims?.[2]);
  if (
    !frames ||
    !seconds ||
    !width ||
    !height ||
    !result.stdout.includes("progress=end")
  )
    throw error(
      "DECODE_INCOMPLETE",
      "No complete video decode/progress metadata",
    );
  if (
    delivery &&
    (!stream.includes("Video: h264") ||
      !stream.includes("yuv420p") ||
      width > 1280 ||
      height > 720 ||
      width % 2 ||
      height % 2 ||
      !stream.includes("30 fps") ||
      /Audio:/.test(inputLog))
  )
    throw error(
      "DELIVERY_FORMAT",
      "Expected silent even-sized H.264 yuv420p <=1280x720",
    );
  return {
    passed: true,
    checkedAt: now(),
    frames,
    durationSeconds: delivery ? frames / 30 : seconds,
    decodedEndTimestampSeconds: seconds,
    width,
    height,
    stream: stream.trim(),
    audioPresent: /Audio:/.test(inputLog),
    fullVideoDecode: true,
  };
}

// Refuse symlink/junction paths, and never recursively remove or move anything.
for (const p of [
  "assets",
  "assets/media",
  "assets/media/halloween",
  "assets/media/halloween/stock",
  "research",
]) {
  const full = path.join(ROOT, p);
  const s = await stat(full);
  if (!s) await fs.mkdir(full);
  else if (!s.isDirectory()) throw Error("Expected directory: " + full);
}
const lockPath = path.join(STOCK, "collector.lock");
const lock = await fs.open(lockPath, "wx");
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now() }));
try {
  const manifest = await readJSON(
    path.join(ROOT, "research/halloween-candidates.json"),
  );
  const selected = SELECTION.map((id) => {
    const c = manifest.candidates.find((c) => c.id === id);
    if (
      !c ||
      !c.downloadURL ||
      (c.license !== "CC0-1.0" &&
        !(
          id === "bats-thermal" &&
          c.bundleEligibility === "public_domain_per_source"
        ))
    )
      throw Error("Missing candidate or non-public license: " + id);
    const u = new URL(c.downloadURL);
    if (u.protocol !== "https:" || u.username || u.password)
      throw Error("Unsafe source URL");
    return c;
  });
  const previous = await readJSON(JOURNAL, {
    items: [],
    cumulativeReceivedSourceBytes: 0,
  });
  const state = {
    schemaVersion: 1,
    startedAt: now(),
    mode: VERIFY ? "verify-only" : "acquire",
    pipeline: PIPELINE,
    limits: {
      totalBytes: CAP,
      perSourceBytes: FILE_CAP,
      fetchTimeoutMs: FETCH_MS,
      ffmpegTimeoutMs: PROCESS_MS,
      scope:
        "Cumulative received source bytes and total managed stock disk, each <=200 MB",
    },
    cumulativeReceivedSourceBytes: previous.cumulativeReceivedSourceBytes ?? 0,
    receivedSourceBytesThisRun: 0,
    items: [],
    summary: {},
  };
  const catalog = [];
  async function save() {
    state.updatedAt = now();
    state.summary = {
      requested: selected.length,
      succeeded: catalog.length,
      failed: state.items.filter((i) => i.status === "failed").length,
      preparedBytes: catalog.reduce((n, a) => n + a.bytes, 0),
      retainedSourceBytes: state.items.reduce(
        (n, i) => n + (i.sourceFile?.bytes ?? 0),
        0,
      ),
      stockDiskBytes: (await diskBytes()) - ((await stat(lockPath))?.size ?? 0),
    };
    await atomicJSON(JOURNAL, state);
    await atomicJSON(CATALOG, catalog);
  }
  async function download(c, dest, item) {
    const available = Math.min(
      FILE_CAP,
      CAP - state.cumulativeReceivedSourceBytes,
      CAP - (await diskBytes()) - 300_000,
    );
    if (available <= 0) throw error("SIZE_CAP", "200 MB budget exhausted");
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(error("FETCH_TIMEOUT", "120 second fetch deadline")),
      FETCH_MS,
    );
    const temp = dest + ".part";
    let handle;
    item.acquisition = {
      status: "requesting",
      requestedAt: now(),
      downloadURL: c.downloadURL,
      receivedBytes: 0,
      redirects: "error",
      timeoutMs: FETCH_MS,
    };
    try {
      // A crashed run can leave an incomplete owned temp file. Never reuse it as media.
      await fs.rm(temp, { force: true });
      const res = await fetch(c.downloadURL, {
        signal: controller.signal,
        redirect: "error",
      });
      item.acquisition.httpStatus = res.status;
      item.acquisition.contentType = res.headers.get("content-type");
      item.acquisition.contentLength = res.headers.get("content-length");
      if (!res.ok) {
        await res.body?.cancel();
        throw error(
          "HTTP_" + res.status,
          "HTTP " + res.status + "; no retry or bypass",
        );
      }
      const length = Number(res.headers.get("content-length"));
      if (length > available) {
        await res.body?.cancel();
        throw error("SIZE_CAP", "Content-Length exceeds available budget");
      }
      if (/text\/|json|html/i.test(item.acquisition.contentType ?? "")) {
        await res.body?.cancel();
        throw error("NOT_MEDIA", "Source returned a text document");
      }
      handle = await fs.open(temp, "wx");
      for await (const chunk of res.body) {
        item.acquisition.receivedBytes += chunk.byteLength;
        state.receivedSourceBytesThisRun += chunk.byteLength;
        state.cumulativeReceivedSourceBytes += chunk.byteLength;
        if (item.acquisition.receivedBytes > available) {
          controller.abort();
          throw error(
            "SIZE_CAP",
            "Streaming response exceeded available budget",
          );
        }
        await handle.writeFile(chunk);
      }
      if (
        !item.acquisition.receivedBytes ||
        (length > 0 && length !== item.acquisition.receivedBytes)
      )
        throw error("INCOMPLETE_DOWNLOAD", "Empty or truncated response");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temp, dest);
      item.acquisition.status = "downloaded";
    } finally {
      clearTimeout(timer);
      await handle?.close();
      await fs.rm(temp, { force: true });
    }
  }

  for (const c of selected) {
    const old = previous.items.find((i) => i.id === c.id);
    const id = "halloween-stock-" + c.id;
    const ext = path.extname(new URL(c.downloadURL).pathname);
    if (![".mp4", ".ogv", ".webm"].includes(ext))
      throw Error("Unexpected media extension");
    const source = path.join(STOCK, id + ".source" + ext);
    const prepared = path.join(STOCK, id + ".mp4");
    const thumbnail = path.join(STOCK, id + ".jpg");
    const tempOutput = path.join(STOCK, id + ".preparing.mp4");
    const item = {
      id: c.id,
      assetId: id,
      title: c.title,
      author: c.author,
      sourcePage: c.pageURL,
      downloadURL: c.downloadURL,
      license: c.license,
      licenseURL: c.licenseURL,
      licenseEvidenceURLs: c.licenseEvidenceURLs,
      status: "processing",
      startedAt: now(),
    };
    state.items.push(item);
    console.log("Processing " + c.id);
    try {
      const sourceStat = await stat(source);
      if (sourceStat) {
        if (
          !sourceStat.isFile() ||
          !sourceStat.size ||
          sourceStat.size > FILE_CAP
        )
          throw error("INVALID_CACHE", "Invalid cached source");
        if (
          !old?.sourceFile ||
          old.downloadURL !== c.downloadURL ||
          old.sourceFile.sha256 !== (await hash(source))
        )
          throw error(
            "CACHE_PROVENANCE",
            "Cached source needs matching prior URL and SHA256",
          );
        item.acquisition = {
          ...old.acquisition,
          status: "reused",
          receivedBytes: 0,
          originallyReceivedBytes:
            old.acquisition.originallyReceivedBytes ??
            old.acquisition.receivedBytes,
          reusedAt: now(),
        };
      } else {
        if (
          old?.error?.code === "HTTP_403" ||
          old?.acquisition?.httpStatus === 403
        ) {
          item.acquisition = old.acquisition;
          throw error(
            "HTTP_403",
            "Previously refused source; no repeat request or bypass",
          );
        }
        if (VERIFY)
          throw error("NOT_DOWNLOADED", "Verify-only: no local source");
        await download(c, source, item);
      }
      item.sourceFile = {
        path: relative(source),
        bytes: (await fs.stat(source)).size,
        sha256: await hash(source),
      };
      // Persist source provenance before expensive decoding so a later run can reuse it.
      await save();
      item.sourceDecode = await decode(source);
      if (item.sourceDecode.durationSeconds > 300)
        throw error("DURATION_CAP", "Source exceeds five minutes");
      const reuse =
        old?.pipeline === PIPELINE &&
        old.sourceFile?.sha256 === item.sourceFile.sha256 &&
        (await stat(prepared)) &&
        old.preparedFile?.sha256 === (await hash(prepared));
      if (!reuse) {
        await fs.rm(tempOutput, { force: true });
        const allowance = Math.min(
          30_000_000,
          CAP - (await diskBytes()) - 500_000,
        );
        if (allowance < 1_000_000)
          throw error("SIZE_CAP", "Insufficient delivery conversion budget");
        await run([
          ...inputArgs(source),
          "-map",
          "0:v:0",
          "-an",
          "-sn",
          "-dn",
          "-map_metadata",
          "-1",
          "-vf",
          "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "24",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "2",
          "-maxrate",
          "3M",
          "-bufsize",
          "6M",
          "-movflags",
          "+faststart",
          "-fs",
          String(allowance),
          "-y",
          tempOutput,
        ]);
        const check = await decode(tempOutput, true);
        if (
          Math.abs(check.durationSeconds - item.sourceDecode.durationSeconds) >
          0.35
        )
          throw error(
            "DURATION_MISMATCH",
            "Delivery may have been truncated by the size cap",
          );
        if (
          (await fs.stat(tempOutput)).size >= allowance ||
          (await diskBytes()) > CAP
        )
          throw error("SIZE_CAP", "Conversion reached managed size limit");
        await fs.rename(tempOutput, prepared);
        item.preparedDecode = check;
      } else item.preparedDecode = await decode(prepared, true);
      item.pipeline = PIPELINE;
      item.preparedFile = {
        path: relative(prepared),
        bytes: (await fs.stat(prepared)).size,
        sha256: await hash(prepared),
        reused: Boolean(reuse),
      };
      item.thumbnailTimestampSeconds = Math.min(
        c.id === "bats-thermal" ? 12 : 2,
        item.preparedDecode.durationSeconds / 2,
      );
      if (!(
        old?.thumbnailFile?.sha256 &&
        (old.thumbnailTimestampSeconds ?? 2) === item.thumbnailTimestampSeconds &&
        (await stat(thumbnail)) &&
        old.thumbnailFile.sha256 === (await hash(thumbnail)) &&
        reuse
      )) {
        await run([
          "-threads",
          "2",
          "-protocol_whitelist",
          "file,pipe",
          "-ss",
          String(item.thumbnailTimestampSeconds),
          "-i",
          prepared,
          "-frames:v",
          "1",
          "-vf",
          "scale=320:-2",
          "-q:v",
          "3",
          "-y",
          thumbnail,
        ]);
      }
      item.thumbnailFile = {
        path: relative(thumbnail),
        bytes: (await fs.stat(thumbnail)).size,
        sha256: await hash(thumbnail),
      };
      await run([...inputArgs(thumbnail), "-frames:v", "1", "-f", "null", "-"]);
      item.thumbnailDecode = { passed: true, checkedAt: now() };
      if ((await diskBytes()) > CAP)
        throw error("SIZE_CAP", "Managed media disk exceeds 200 MB");
      const moon = c.id.includes("moon"),
        bats = c.id === "bats-thermal";
      if (bats) item.contentNote = "Source is 486x360 colorized thermal turbine surveillance, with USGS intro/outro logos retained. Thumbnail uses 12 seconds to show footage, not the title card. Not a bat-swarm loop.";
      catalog.push({
        id,
        name: c.title.replace(/\.(webm|ogv|mp4)$/i, ""),
        kind: "video",
        url: url(prepared),
        thumbnail: url(thumbnail),
        tags: [
          "halloween",
          "stock",
          bats ? "public-domain" : "cc0",
          ...(moon
            ? ["moon", "night"]
            : bats
              ? ["bats", "thermal", "spooky"]
              : ["fog", "mist", "atmosphere"]),
        ],
        hue: moon || bats ? 0 : 190,
        energy: bats ? 0.4 : 0.15,
        duration: item.preparedDecode.durationSeconds,
        license: bats ? "Public Domain (USGS)" : "CC0-1.0",
        source: c.pageURL,
        attribution:
          c.author + " — " + c.licenseURL + " (credit retained for provenance)",
        status: "再生用・最大720p/30fps H.264・無音・全デコード確認済",
        bytes: item.preparedFile.bytes,
      });
      item.status = "ready";
      item.changes =
        "Whole source video; aspect-preserving downscale within 1280x720, square pixels, 30 fps, silent H.264/yuv420p, metadata removed, faststart. No seamless-loop claim.";
      console.log("Ready " + c.id + ": " + item.preparedFile.bytes + " bytes");
    } catch (e) {
      item.status = "failed";
      item.error = { code: e.code ?? e.name, message: e.message, at: now() };
      console.log(
        "Skipped " +
          c.id +
          ": " +
          (e.code ?? e.name) +
          " " +
          e.message.slice(0, 180),
      );
    } finally {
      await fs.rm(tempOutput, { force: true });
      item.completedAt = now();
      await save();
    }
  }
  state.completedAt = now();
  await save();
  console.log(JSON.stringify(state.summary));
  if (!catalog.length) process.exitCode = 1;
} finally {
  await lock.close();
  await fs.rm(lockPath, { force: true });
}
