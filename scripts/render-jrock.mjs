import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "assets/media/jrock/originals");
const source = process.argv[2];
if (!source) throw Error("Pass the generated image directory");
const { scenes } = JSON.parse(
  await fs.readFile(path.join(root, "research/jrock-generation.json"), "utf8"),
);
await fs.mkdir(dir, { recursive: true });
const run = (args) =>
  new Promise((resolve, reject) => {
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
const catalog = [],
  entries = [];
for (const s of scenes) {
  const png = path.join(dir, s.id + ".png"),
    mp4 = path.join(dir, s.id + ".mp4"),
    jpg = path.join(dir, s.id + ".jpg");
  await fs.copyFile(path.join(source, s.image), png);
  let vf = `scale=2560:-2,zoompan=z='1.08+0.045*sin(2*PI*on/${s.period})':x='iw/2-iw/zoom/2+12*sin(2*PI*on/480)':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30`;
  if (s.id === "jrock-prism-impact")
    vf += ",eq=brightness='0.025*sin(2*PI*t/4)':eval=frame";
  await run([
    "-y",
    "-loop",
    "1",
    "-i",
    png,
    "-vf",
    vf,
    "-frames:v",
    "480",
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
    id: s.id,
    name: "ROCK · " + s.name,
    kind: "video",
    url: `/assets/media/jrock/originals/${s.id}.mp4`,
    thumbnail: `/assets/media/jrock/originals/${s.id}.jpg`,
    tags: ["jrock", "original", "loop", ...s.tags],
    hue: s.hue,
    energy: s.energy,
    duration: 16,
    beats: s.id === "jrock-prism-impact" ? 32 : 64,
    license: "AI生成オリジナル · Lumina Liveで利用可",
    source: "Lumina Live / OpenAI image generation",
    attribution: "AI生成背景 + Lumina Live カメラ・光量アニメーション",
    status: "AI生成静止画から制作した16秒の無音ループ",
    bytes,
  });
  entries.push({
    id: s.id,
    bytes,
    sha256: createHash("sha256")
      .update(await fs.readFile(mp4))
      .digest("hex"),
    decoded: true,
    frames: 480,
    width: 1280,
    height: 720,
    filter: vf,
  });
  console.log(s.id, bytes);
}
await fs.writeFile(
  path.join(root, "assets/jrock-originals.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
await fs.writeFile(
  path.join(root, "research/jrock-originals-build.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      method:
        "Generated still artwork with looping camera and smooth brightness animation",
      entries,
    },
    null,
    2,
  ) + "\n",
);
