import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets"),
  mediaDir = path.join(assetsDir, "media"),
  proxyDir = path.join(mediaDir, "prepared"),
  thumbDir = path.join(mediaDir, "thumbnails");
const ffmpeg = path.join(root, "node_modules/ffmpeg-static/ffmpeg.exe");
const preparedFile = path.join(assetsDir, "prepared.json");
const cap = 1_900_000_000,
  totalCap = 20_000_000_000;
await fs.mkdir(proxyDir, { recursive: true });
await fs.mkdir(thumbDir, { recursive: true });
const exists = async (p) => {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
};
const read = async (p, fallback) => {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
};
const safe = (p) => {
  const full = path.resolve(p),
    rel = path.relative(mediaDir, full);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw Error("Outside managed media");
  return full;
};
const url = (p) =>
  "/" +
  path.relative(root, p).split(path.sep).map(encodeURIComponent).join("/");
async function size(dir) {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw Error("Unexpected symbolic link");
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? await size(p) : (await fs.stat(p)).size;
  }
  return n;
}
function run(args, max = 4_000_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ["-hide_banner", "-threads", "2", ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const data = [];
    let bytes = 0,
      err = "";
    p.stdout.on("data", (b) => {
      bytes += b.length;
      if (bytes > max) p.kill();
      else data.push(b);
    });
    p.stderr.on("data", (b) => (err = (err + b.toString()).slice(-5000)));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(data))
        : reject(Error(err || `ffmpeg exit ${code}`)),
    );
  });
}
async function hash(file) {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
}
const source = [
  ...(await read(path.join(assetsDir, "open-candidates.json"), [])),
  ...(await read(path.join(assetsDir, "pack-candidates.json"), [])),
];
const allUnique = [...new Map(source.map((a) => [a.id, a])).values()];
// A general-purpose live library must not auto-cue unreviewed adult-labelled pack extras.
const excluded = allUnique
  .filter((a) => /\bORGY(?:\b|[-_])/i.test(a.name.replaceAll("_", " ")))
  .map((a) => ({
    id: a.id,
    name: a.name,
    reason:
      "Adult-labelled pack extra; excluded from performance library pending individual review",
  }));
const excludedIds = new Set(excluded.map((a) => a.id));
const unique = allUnique.filter((a) => !excludedIds.has(a.id));
await fs.writeFile(
  path.join(assetsDir, "excluded.json"),
  JSON.stringify(excluded, null, 2) + "\n",
);
const state = await read(preparedFile, { version: 1, entries: {} });
// Independently acquired seasonal sources already include verified playable files.
const catalog = [
  ...(await read(path.join(assetsDir, "halloween-catalog.json"), [])),
  ...(await read(path.join(assetsDir, "halloween-originals.json"), [])),
];
let proxyBytes = await size(proxyDir);
let failed = 0;
function analyze(raw) {
  const frame = 32 * 18 * 3,
    frames = Math.floor(raw.length / frame);
  let satSum = 0,
    x = 0,
    y = 0,
    motion = 0,
    lumaSum = 0,
    lumaSq = 0;
  for (let i = 0; i < raw.length - 2; i += 3) {
    const r = raw[i] / 255,
      g = raw[i + 1] / 255,
      b = raw[i + 2] / 255,
      max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min,
      l = (r + g + b) / 3;
    lumaSum += l;
    lumaSq += l * l;
    if (d > 0.08) {
      let h =
        max === r
          ? ((g - b) / d) % 6
          : max === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      h = (h * Math.PI) / 3;
      x += Math.cos(h) * d;
      y += Math.sin(h) * d;
      satSum += d;
    }
    if (i >= frame)
      motion +=
        (Math.abs(raw[i] - raw[i - frame]) +
          Math.abs(raw[i + 1] - raw[i + 1 - frame]) +
          Math.abs(raw[i + 2] - raw[i + 2 - frame])) /
        765;
  }
  const n = raw.length / 3,
    contrast = Math.sqrt(Math.max(0, lumaSq / n - (lumaSum / n) ** 2));
  return {
    hue: satSum
      ? Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
      : 0,
    energy: Number(
      Math.min(
        1,
        0.2 +
          contrast * 0.9 +
          (frames > 1 ? (motion / ((frames - 1) * 32 * 18)) * 3 : 0),
      ).toFixed(3),
    ),
    method:
      "Saturation-weighted circular hue; sampled frame difference + contrast, approximate visual intensity",
  };
}
async function publish() {
  await fs.writeFile(preparedFile, JSON.stringify(state, null, 2));
  await fs.writeFile(
    path.join(assetsDir, "catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
}
for (const a of unique) {
  const input = safe(
    path.isAbsolute(a.localPath ?? "")
      ? a.localPath
      : path.join(root, a.localPath ?? decodeURI(a.url).replace(/^\//, "")),
  );
  const info = await exists(input);
  if (!info) {
    failed++;
    continue;
  }
  const meta = a.probe ?? a.metadata ?? {},
    compatible =
      ["h264", "vp8", "vp9", "av1"].includes(meta.codec) &&
      /\.(mp4|webm|m4v)$/i.test(input);
  const key = a.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
    proxy = safe(path.join(proxyDir, key + ".mp4")),
    thumb = safe(path.join(thumbDir, key + ".jpg"));
  const old = state.entries[a.id];
  let playable = input;
  const duration = a.duration ?? meta.duration;
  try {
    const needsProxy = !compatible || meta.width > 1920 || meta.height > 1080;
    if (needsProxy && !process.argv.includes("--no-proxy")) {
      const previous = await exists(proxy);
      if (previous && (!old?.sourceHash || old.sourceHash === a.sha256)) {
        if (!old?.sourceHash)
          await run([
            "-v",
            "error",
            "-i",
            proxy,
            "-map",
            "0:v:0",
            "-f",
            "null",
            "-",
          ]);
        playable = proxy;
      } else if (
        proxyBytes + Math.max(10_000_000, (duration ?? 30) * 1_100_000) < cap &&
        (await size(assetsDir)) +
          Math.max(10_000_000, (duration ?? 30) * 1_100_000) <
          totalCap
      ) {
        const temp = proxy + ".part.mp4";
        console.log(`[prepare] ${a.name}`);
        await run([
          "-v",
          "error",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-an",
          "-vf",
          "scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p",
          "-c:v",
          "libx264",
          "-threads",
          "2",
          "-preset",
          "veryfast",
          "-crf",
          "19",
          "-maxrate",
          "8M",
          "-bufsize",
          "16M",
          "-g",
          "60",
          "-movflags",
          "+faststart",
          "-y",
          temp,
        ]);
        await run([
          "-v",
          "error",
          "-i",
          temp,
          "-map",
          "0:v:0",
          "-f",
          "null",
          "-",
        ]);
        const bytes = (await fs.stat(temp)).size;
        if (proxyBytes + bytes > cap || (await size(assetsDir)) > totalCap) {
          await fs.unlink(safe(temp));
          throw Error("Prepared media capacity limit");
        }
        await fs.rename(temp, proxy);
        proxyBytes += bytes - (previous?.size ?? 0);
        playable = proxy;
      } else if (!compatible)
        throw Error("No room to prepare unsupported source codec");
    } else if (!compatible) throw Error("Source codec requires preparation");
    let analysis = old?.analysis;
    if (!(await exists(thumb)) || !analysis || old?.sourceHash !== a.sha256) {
      await run([
        "-v",
        "error",
        "-ss",
        String(Math.min(2, (duration ?? 8) * 0.2)),
        "-i",
        playable,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=240:136:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,pad=240:136:(ow-iw)/2:(oh-ih)/2",
        "-q:v",
        "3",
        "-y",
        thumb,
      ]);
      const raw = await run([
        "-v",
        "error",
        "-i",
        playable,
        "-t",
        "4",
        "-vf",
        "fps=1,scale=32:18",
        "-an",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ]);
      analysis = analyze(raw);
    }
    const playableInfo = await fs.stat(playable);
    const pHash =
      old?.playablePath === path.relative(root, playable) &&
      old?.bytes === playableInfo.size
        ? old.sha256
        : await hash(playable);
    state.entries[a.id] = {
      sourceHash: a.sha256,
      sourcePath: path.relative(root, input),
      playablePath: path.relative(root, playable),
      bytes: playableInfo.size,
      sha256: pHash,
      analysis,
      prepared: playable !== input,
      verifiedAt: new Date().toISOString(),
    };
    const hue = analysis.hue;
    const color =
      hue < 25 || hue >= 345
        ? "red"
        : hue < 65
          ? "gold"
          : hue < 165
            ? "green"
            : hue < 200
              ? "cyan"
              : hue < 265
                ? "blue"
                : "purple";
    const themeTags =
      a.packId === "beeple-manifest"
        ? ["figurative", "manual-cue"]
        : a.provider === "Mantissa" || a.packId
          ? ["abstract"]
          : [];
    catalog.push({
      id: a.id,
      name: a.name,
      kind: "video",
      url: url(playable),
      thumbnail: url(thumb),
      tags: [
        ...new Set([
          ...a.tags.filter((t) => t !== "needs-transcode"),
          color,
          ...themeTags,
        ]),
      ],
      hue,
      energy: analysis.energy,
      duration,
      license: a.license,
      source: a.source,
      attribution: a.attribution,
      status:
        playable !== input ? "再生用・720p/30fps H.264" : "再生用・配布元動画",
      bytes: playableInfo.size,
    });
    await publish();
    console.log(`[catalog] ${catalog.length}/${unique.length} ${a.name}`);
  } catch (e) {
    failed++;
    state.entries[a.id] = {
      ...old,
      error: String(e),
      checkedAt: new Date().toISOString(),
    };
    console.error(`[not ready] ${a.name}: ${String(e).slice(0, 180)}`);
  }
}
state.updatedAt = new Date().toISOString();
state.count = catalog.length;
state.failed = failed;
state.excluded = excluded.length;
state.assetsBytes = await size(assetsDir);
state.proxyBytes = proxyBytes;
await publish();
await fs.writeFile(
  path.join(assetsDir, "credits.txt"),
  catalog
    .map(
      (a) =>
        `${a.name}\n${a.attribution ?? ""}\n${a.license}\n${a.source ?? ""}\n`,
    )
    .join("\n"),
);
console.log(
  JSON.stringify({
    ready: catalog.length,
    notReady: failed,
    assetsBytes: state.assetsBytes,
    proxyBytes,
    cap: totalCap,
  }),
);
