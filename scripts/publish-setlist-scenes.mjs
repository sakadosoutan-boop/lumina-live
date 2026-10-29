import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Copy the prepared scene collection into the existing GitHub Pages library.
// Use an explicit private build path; never copy hosting credentials or identity.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.resolve(root, process.argv[2] ?? "../lumina-live-web/dist");
const target = path.join(root, "docs");
const readCatalog = async (dir) =>
  JSON.parse(await fs.readFile(path.join(dir, "assets/catalog.json"), "utf8"));
const existing = await readCatalog(target);
const incoming = (await readCatalog(from)).filter((a) =>
  a.tags.includes("setlist-scene"),
);
if (incoming.length !== 44)
  throw new Error("Expected the verified 44 scene collection");
const grouped = new Map();
for (const a of incoming) {
  const song = a.tags.find((tag) => tag.startsWith("song:"));
  const section = a.tags.find((tag) => tag.startsWith("section:"));
  if (!song || !section) throw new Error(`Missing scene tags: ${a.id}`);
  const set = grouped.get(song) ?? new Set();
  if (set.has(section)) throw new Error(`Duplicate song section: ${a.id}`);
  set.add(section);
  grouped.set(song, set);
}
if (grouped.size !== 11 || [...grouped.values()].some((s) => s.size !== 4))
  throw new Error("Expected main/A/B/C for each of eleven songs");

for (const a of incoming) {
  for (const field of ["url", "thumbnail"]) {
    const rel = a[field].replace(/^\.\//, "").replace(/^\//, "");
    if (!/^assets\/library\/[a-z0-9-]+\.(mp4|jpg)$/.test(rel))
      throw new Error(`Invalid scene path: ${rel}`);
    const src = path.join(from, rel);
    const stat = await fs.stat(src);
    if (field === "url" && stat.size !== a.bytes)
      throw new Error(`Video byte count mismatch: ${a.id}`);
    await fs.mkdir(path.dirname(path.join(target, rel)), { recursive: true });
    await fs.copyFile(src, path.join(target, rel));
    // GitHub Pages is hosted below /lumina-live/, so root URLs cannot be used.
    a[field] = `./${rel}`;
  }
  a.license = "Canva Free Content License・出典と利用条件を参照";
}
const catalog = [
  ...new Map([...existing, ...incoming].map((a) => [a.id, a])).values(),
];
await fs.writeFile(
  path.join(target, "assets/catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
const creditsPath = path.join(target, "assets/credits.txt");
const marker = "\n=== Canva 曲別シーン ===\n";
const credits = (await fs.readFile(creditsPath, "utf8")).split(marker)[0];
await fs.writeFile(
  creditsPath,
  credits +
    marker +
    "Canvaの無料・横長動画を用いたVJ用ループ。元素材の著作権は各権利者に帰属。\n" +
    "Canvaコンテンツ使用許諾：https://www.canva.com/policies/content-license-agreement/\n\n" +
    incoming
      .map((a) => `${a.name}\n${a.license}\n${a.source}\n${a.attribution}\n`)
      .join("\n"),
);
console.log(
  JSON.stringify({
    scenes: incoming.length,
    songs: grouped.size,
    totalCatalog: catalog.length,
    bytes: incoming.reduce((n, a) => n + a.bytes, 0),
  }),
);
