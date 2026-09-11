import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateAssetCatalog } from "../src/storage";
it("accepts every asset shipped in the public catalog", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../docs/assets/catalog.json", import.meta.url),
      "utf8",
    ),
  );
  expect(validateAssetCatalog(catalog)).toHaveLength(catalog.length);
});
