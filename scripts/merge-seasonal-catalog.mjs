import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (file) =>
  JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
const current = await read("assets/catalog.json");
const seasonal = [
  ...(await read("assets/halloween-catalog.json").catch(() => [])),
  ...(await read("assets/halloween-originals.json").catch(() => [])),
];
const merged = [
  ...new Map([...current, ...seasonal].map((a) => [a.id, a])).values(),
];
await fs.writeFile(
  path.join(root, "assets/catalog.json"),
  JSON.stringify(merged, null, 2) + "\n",
);
console.log(
  JSON.stringify({ assets: merged.length, seasonal: seasonal.length }),
);
