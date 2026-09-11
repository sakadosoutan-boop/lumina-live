import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "docs/assets/library");
const catalogPath = path.join(root, "docs/assets/catalog.json");
const evidencePath = path.join(root, "research/web-library-build.json");
const ffmpeg = path.join(root, "node_modules/ffmpeg-static/ffmpeg.exe");
const CAP = 350_000_000;
const read = async (file) =>
  JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
const approved = new Set(await read("research/web-library-approved-ids.json"));
for (const file of [
  "assets/halloween-catalog.json",
  "assets/halloween-originals.json",
]) {
  for (const a of await read(file).catch(() => [])) approved.add(a.id);
}
const assets = (await read("assets/catalog.json")).filter((a) =>
  approved.has(a.id),
);
const old = await read("research/web-library-build.json").catch(() => ({
  entries: [],
}));
const entries = [],
  failures = [];
await fs.mkdir(output, { recursive: true });
const hash = async (file) => {
  const h = createHash("sha256");
  for await (const part of createReadStream(file)) h.update(part);
  return h.digest("hex");
};
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-threads", "2", ...args],
      { windowsHide: true, cwd: root },
    );
    let error = "";
    child.stderr.on("data", (b) => {
      error = (error + b).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(Error(error || `ffmpeg ${code}`)),
    );
  });
const safeSource = (url) => {
  if (!url?.startsWith("/assets/media/"))
    throw Error("Expected managed local media");
  const p = path.resolve(root, decodeURIComponent(url.slice(1)));
  const relative = path.relative(path.join(root, "assets/media"), p);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("Media path escapes root");
  return p;
};
let bytes = 0;
for (const asset of assets) {
  if (!/^[a-zA-Z0-9_-]+$/.test(asset.id)) throw Error("Unsafe asset ID");
  const source = safeSource(asset.url),
    destination = path.join(output, asset.id + ".mp4");
  const thumb = path.join(output, asset.id + ".jpg");
  try {
    const sourceHash = await hash(source);
    const cached = old.entries.find(
      (e) => e.id === asset.id && e.sourceHash === sourceHash,
    );
    const cachedValid =
      cached &&
      (await hash(destination)
        .then((h) => h === cached.sha256)
        .catch(() => false));
    if (!cachedValid) {
      let filter =
        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30";
      const credit =
        asset.id === "open-eso-milky-way"
          ? "ESO/B. Tafreshi | CC BY 4.0 | Resized by Lumina Live"
          : asset.id === "open-hubble-pillars"
            ? "NASA, ESA/Hubble and the Hubble Heritage Team | CC BY 4.0 | Silent transcode"
            : "";
      if (credit) {
        await fs.writeFile(
          path.join(output, asset.id + ".credit.txt"),
          credit +
            "\n" +
            asset.source +
            "\nhttps://creativecommons.org/licenses/by/4.0/",
        );
        filter += `,drawtext=font=Arial:textfile=docs/assets/library/${asset.id}.credit.txt:fontsize=12:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=5:x=10:y=h-th-10`;
      }
      // Full duration, no added strobe or cuts; original full-quality files remain local.
      await run([
        "-y",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-maxrate",
        "1100k",
        "-bufsize",
        "2200k",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        destination,
      ]);
      await run(["-i", destination, "-map", "0:v:0", "-f", "null", "-"]);
    }
    const stat = await fs.stat(destination);
    if (bytes + stat.size > CAP) throw Error("Public media budget exceeded");
    if (asset.thumbnail) await fs.copyFile(safeSource(asset.thumbnail), thumb);
    else
      await run([
        "-y",
        "-i",
        destination,
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-2",
        thumb,
      ]);
    const item = {
      ...asset,
      url: `./assets/library/${asset.id}.mp4`,
      thumbnail: `./assets/library/${asset.id}.jpg`,
      tags: [...new Set([...asset.tags, "web-library"])],
      bytes: stat.size,
      status: "オンライン・軽量720p H.264",
    };
    bytes += stat.size;
    entries.push({
      id: asset.id,
      sourceHash,
      sha256: await hash(destination),
      bytes: stat.size,
      asset: item,
    });
    await fs.writeFile(
      evidencePath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          settings:
            "Full duration / <=1280x720 / 30fps / H.264 CRF28 capped1100kbps / no audio",
          cap: CAP,
          bytes,
          entries,
          failures,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `${entries.length}/${assets.length} ${asset.id} ${(bytes / 1e6).toFixed(1)} MB`,
    );
  } catch (error) {
    failures.push({ id: asset.id, error: String(error) });
    console.error(asset.id, String(error));
  }
}
await fs.writeFile(
  catalogPath,
  JSON.stringify(
    entries.map((e) => e.asset),
    null,
    2,
  ) + "\n",
);
await fs.writeFile(
  evidencePath,
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      settings:
        "Full duration / <=1280x720 / 30fps / H.264 CRF28 capped1100kbps / no audio",
      cap: CAP,
      bytes,
      entries,
      failures,
    },
    null,
    2,
  ) + "\n",
);
await fs.writeFile(
  path.join(root, "docs/assets/credits.txt"),
  entries
    .map(
      ({ asset: a }) =>
        `${a.name}\n${a.attribution || ""}\n${a.license}\n${a.source || ""}\nModified: resized/re-encoded, no audio.\n`,
    )
    .join("\n"),
  "utf8",
);
console.log(
  JSON.stringify({ ready: entries.length, bytes, failures: failures.length }),
);
if (failures.length) process.exitCode = 1;
