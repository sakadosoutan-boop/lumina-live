import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateAssetCatalog } from "../src/storage";
import { setlistSceneSongs } from "../src/setlist-scenes";
it("accepts every asset shipped in the public catalog", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../docs/assets/catalog.json", import.meta.url),
      "utf8",
    ),
  );
  expect(validateAssetCatalog(catalog)).toHaveLength(catalog.length);
});

it("ships playable scene files below the GitHub Pages subpath for all song sections", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../docs/assets/catalog.json", import.meta.url),
      "utf8",
    ),
  );
  const scenes = catalog.filter((a: { tags: string[] }) =>
    a.tags.includes("setlist-scene"),
  );
  expect(scenes).toHaveLength(setlistSceneSongs.length * 4);
  for (const song of setlistSceneSongs) {
    expect(
      scenes
        .filter((a: { tags: string[] }) => a.tags.includes(`song:${song.slug}`))
        .map((a: { tags: string[] }) =>
          a.tags.find((t) => t.startsWith("section:")),
        )
        .sort(),
    ).toEqual(["section:a", "section:b", "section:c", "section:main"]);
  }
  for (const a of scenes) {
    for (const field of ["url", "thumbnail"]) {
      expect(a[field]).toMatch(/^\.\/assets\/library\/[a-z0-9-]+\.(mp4|jpg)$/);
      const deployed = new URL(
        a[field],
        "https://example.github.io/lumina-live/",
      );
      expect(deployed.pathname).toMatch(/^\/lumina-live\/assets\/library\//);
      const bytes = readFileSync(
        new URL(`../docs/${a[field]}`, import.meta.url),
      );
      expect(bytes.length).toBeGreaterThan(0);
      if (field === "url") {
        expect(bytes.length).toBe(a.bytes);
        expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
      }
    }
  }
});
