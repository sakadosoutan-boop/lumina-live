import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateAssetCatalog } from "../src/storage";
import { setlistSceneSongs } from "../src/setlist-scenes";

// Saved shows refer to these IDs; additive originals must not replace them.
const legacyCanvaSceneIds = [
  "canva-setlist-01-music-ocean-night",
  "canva-setlist-02-odoriko-golden-field",
  "canva-setlist-03-beat-it-canyon",
  "canva-setlist-04-i-want-it-that-way-ocean",
  "canva-setlist-05-megane-cherry-blossom",
  "canva-setlist-06-eight-beat-coastal-road",
  "canva-setlist-07-lovin-green-forest",
  "canva-setlist-08-wasurete-mist-lake",
  "canva-setlist-09-zenzenzense-aerial-mountain",
  "canva-setlist-10-koibito-woman-beach",
  "canva-setlist-11-sora-blue-sky-grass",
  "canva-sections-01-music-a",
  "canva-sections-02-music-b",
  "canva-sections-03-music-c",
  "canva-sections-04-sora-mo-toberu-hazu-a",
  "canva-sections-05-sora-mo-toberu-hazu-b",
  "canva-sections-06-sora-mo-toberu-hazu-c",
  "canva-sections-07-odoriko-a",
  "canva-sections-08-odoriko-b",
  "canva-sections-09-odoriko-c",
  "canva-sections-10-beat-it-a",
  "canva-sections-11-beat-it-b",
  "canva-sections-12-beat-it-c",
  "canva-sections-13-i-want-it-that-way-a",
  "canva-sections-14-i-want-it-that-way-b",
  "canva-sections-15-i-want-it-that-way-c",
  "canva-sections-16-megane-wo-hazushite-a",
  "canva-sections-17-megane-wo-hazushite-b",
  "canva-sections-18-megane-wo-hazushite-c",
  "canva-sections-19-eight-beat-a",
  "canva-sections-20-eight-beat-b",
  "canva-sections-21-eight-beat-c",
  "canva-sections-22-lovin-a",
  "canva-sections-23-lovin-b",
  "canva-sections-24-lovin-c",
  "canva-sections-25-wasurete-kudasai-a",
  "canva-sections-26-wasurete-kudasai-b",
  "canva-sections-27-wasurete-kudasai-c",
  "canva-sections-28-zenzenzense-a",
  "canva-sections-29-zenzenzense-b",
  "canva-sections-30-zenzenzense-c",
  "canva-sections-31-koibito-gokko-a",
  "canva-sections-32-koibito-gokko-b",
  "canva-sections-33-koibito-gokko-c",
];

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
  const canvaScenes = scenes.filter((a: { tags: string[] }) =>
    a.tags.includes("canva"),
  );
  expect(canvaScenes).toHaveLength(44);
  expect(canvaScenes.map((a: { id: string }) => a.id).sort()).toEqual(
    [...legacyCanvaSceneIds].sort(),
  );
  for (const a of canvaScenes) {
    expect(a.tags.filter((t: string) => t.startsWith("song:"))).toHaveLength(1);
    expect(a.tags.filter((t: string) => t.startsWith("section:"))).toHaveLength(
      1,
    );
  }
  for (const song of setlistSceneSongs) {
    expect(
      canvaScenes
        .filter((a: { tags: string[] }) => a.tags.includes(`song:${song.slug}`))
        .flatMap((a: { tags: string[] }) =>
          a.tags.filter((t) => t.startsWith("section:")),
        )
        .sort(),
    ).toEqual(["section:a", "section:b", "section:c", "section:main"]);
  }
  // Originals may arrive independently, with the exterior optional.
  for (const a of catalog.filter((a: { id: string }) =>
    a.id.startsWith("original-wasurete-"),
  )) {
    expect(a.kind).toBe("video");
    expect(a.tags).toContain("setlist-scene");
    expect(a.tags).not.toContain("canva");
    expect(a.tags.filter((t: string) => t.startsWith("song:"))).toEqual([
      "song:wasurete-kudasai",
    ]);
    const sections = a.tags.filter((t: string) => t.startsWith("section:"));
    expect(sections).toHaveLength(1);
    expect(["section:main", "section:a", "section:b", "section:c"]).toContain(
      sections[0],
    );
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
