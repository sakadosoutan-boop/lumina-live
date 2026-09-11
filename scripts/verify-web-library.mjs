import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) =>
  JSON.parse(await fs.readFile(path.join(root, f), "utf8"));
const assets = await read("docs/assets/catalog.json");
const evidence = await read("research/web-library-build.json");
const allowed = new Set(await read("research/web-library-approved-ids.json"));
for (const file of [
  "assets/halloween-catalog.json",
  "assets/halloween-originals.json",
])
  for (const a of await read(file)) allowed.add(a.id);
if (
  evidence.failures.length ||
  assets.length !== allowed.size ||
  new Set(assets.map((a) => a.id)).size !== assets.length
)
  throw Error("Incomplete or duplicate catalog");
let total = 0;
for (const a of assets) {
  if (!allowed.has(a.id)) throw Error("Unapproved media");
  for (const key of ["url", "thumbnail"]) {
    if (!/^\.\/assets\/library\/[\w-]+\.(mp4|jpg)$/.test(a[key]))
      throw Error("Unexpected public path");
    const bytes = await fs.readFile(path.join(root, "docs", a[key]));
    if (key === "url") {
      const e = evidence.entries.find((x) => x.id === a.id);
      if (
        bytes.length !== a.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== e.sha256
      )
        throw Error("Hash mismatch " + a.id);
      total += bytes.length;
    }
  }
}
const mp4s = (await fs.readdir(path.join(root, "docs/assets/library"))).filter(
  (f) => f.endsWith(".mp4"),
);
if (mp4s.length !== assets.length || total > 350_000_000)
  throw Error("Unlisted video or over budget");
const html = await fs.readFile(path.join(root, "docs/index.html"), "utf8");
if (!html.includes("フォルダーを接続") || !html.includes("ハロウィン"))
  throw Error("Outdated app bundle");
console.log(
  JSON.stringify({
    verifiedVideos: assets.length,
    halloween: assets.filter((a) => a.tags.includes("halloween")).length,
    bytes: total,
    hashes: "match",
  }),
);
