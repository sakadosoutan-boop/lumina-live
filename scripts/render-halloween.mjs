import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "assets/media/halloween/originals");
await fs.mkdir(dir, { recursive: true });
const scenes = [
  {
    id: "halloween-pumpkin-gate",
    name: "HALLOWEEN · カボチャの門",
    image: "exec-4dadea63-aa85-4b4e-a426-4b31f5fc6dca.png",
    hue: 28,
    tags: ["orange", "pumpkin", "forest"],
  },
  {
    id: "halloween-moon-castle",
    name: "HALLOWEEN · 月夜の城",
    image: "exec-54bd417b-520d-4499-9f8a-f68290db2c0f.png",
    hue: 250,
    tags: ["purple", "moon", "bats"],
  },
];
const generated = process.argv[2];
if (!generated) throw Error("Pass the generated image directory");
function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      path.join(root, "node_modules/ffmpeg-static/ffmpeg.exe"),
      ["-hide_banner", "-loglevel", "error", ...args],
      { windowsHide: true },
    );
    let err = "";
    p.stderr.on("data", (b) => (err = (err + b).slice(-4000)));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(Error(err))));
  });
}
const catalog = [],
  evidence = [];
for (const scene of scenes) {
  const png = path.join(dir, scene.id + ".png"),
    mp4 = path.join(dir, scene.id + ".mp4"),
    jpg = path.join(dir, scene.id + ".jpg");
  await fs.copyFile(path.join(generated, scene.image), png);
  // A continuous 12s sinusoidal camera cycle; source subjects are static generated artwork.
  await run([
    "-y",
    "-loop",
    "1",
    "-i",
    png,
    "-vf",
    "scale=2560:-2,zoompan=z='1.04+0.025*sin(2*PI*on/360)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30",
    "-frames:v",
    "360",
    "-an",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4,
  ]);
  await run(["-i", mp4, "-f", "null", "-"]);
  await run(["-y", "-i", mp4, "-frames:v", "1", "-vf", "scale=480:-2", jpg]);
  const bytes = (await fs.stat(mp4)).size;
  catalog.push({
    id: scene.id,
    name: scene.name,
    kind: "video",
    url: `/assets/media/halloween/originals/${scene.id}.mp4`,
    thumbnail: `/assets/media/halloween/originals/${scene.id}.jpg`,
    tags: ["halloween", "original", "loop", ...scene.tags],
    hue: scene.hue,
    energy: 0.2,
    duration: 12,
    license: "AI生成オリジナル · Lumina Liveで利用可",
    source: "Lumina Live / OpenAI image generation",
    attribution: "AI生成背景 + Lumina Live カメラアニメーション",
    status: "AI生成静止画を用いた12秒カメラループ・無音",
    bytes,
  });
  evidence.push({
    id: scene.id,
    sourceImage: scene.image,
    bytes,
    sha256: createHash("sha256")
      .update(await fs.readFile(mp4))
      .digest("hex"),
    decoded: true,
    frames: 360,
    duration: 12,
  });
  console.log(scene.id, bytes);
}
await fs.writeFile(
  path.join(root, "assets/halloween-originals.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
await fs.writeFile(
  path.join(root, "research/halloween-originals-build.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      method:
        "Generated still artwork with sinusoidal camera movement; not generated moving subjects",
      entries: evidence,
    },
    null,
    2,
  ) + "\n",
);
