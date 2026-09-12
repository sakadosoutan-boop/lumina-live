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
  ...(await read("assets/jrock-originals.json").catch(() => [])),
];
const selections = new Map(
  (await read("research/jrock-selections.json").catch(() => [])).map((s) => [
    s.id,
    s,
  ]),
);
const merged = [
  ...new Map(
    [...current, ...seasonal].map((a) => [
      a.id,
      {
        ...a,
        tags: [...new Set([...a.tags, ...(selections.get(a.id)?.tags ?? [])])],
      },
    ]),
  ).values(),
];
await fs.writeFile(
  path.join(root, "assets/catalog.json"),
  JSON.stringify(merged, null, 2) + "\n",
);
console.log(
  JSON.stringify({ assets: merged.length, seasonal: seasonal.length }),
);
