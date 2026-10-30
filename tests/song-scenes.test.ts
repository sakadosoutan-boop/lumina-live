import { describe, expect, it, vi } from "vitest";
import type { Asset, Deck, Show, SongScene } from "../src/types";
import { mergeAssetCatalog } from "../src/media-library";
import {
  applySongScene,
  assignSceneMainAsset,
  captureSongScene,
  createCollectionSongScenes,
  MAX_SONG_SCENES,
  missingSceneAssetIds,
} from "../src/song-scenes";

const asset = (id: string, patch: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  kind: "video",
  url: `/media/${id}`,
  tags: [],
  hue: 0,
  energy: 0.5,
  license: "User supplied",
  ...patch,
});
const deck = (assetId: string): Deck => ({
  assetId,
  opacity: 0.7,
  speed: 2,
  scale: 1.5,
  rotation: 45,
  mirror: true,
  beatSync: true,
  beats: 16,
  hue: -30,
  saturation: 1.2,
  brightness: 0.8,
  blend: "screen",
});
function show(): Show {
  return {
    version: 1,
    title: "Live set",
    assets: [asset("a"), asset("b"), asset("c")],
    decks: [deck("a"), deck("b"), deck("c")],
    crossfade: 0.8,
    master: 0.4,
    fx: {
      glitch: 0.2,
      bloom: 0.3,
      vignette: 0.4,
      chromatic: 0.5,
      pixelate: 0.6,
      depth: -0.7,
      mapping: 0.8,
      motionBeats: 16,
    },
    lyricStyle: {
      enabled: true,
      size: 64,
      position: 0.77,
      x: 0.3,
      color: "#ffffff",
      align: "left",
      mode: "karaoke",
      shadow: true,
    },
    songs: [
      {
        id: "song",
        title: "Selected title",
        bpm: 145,
        timelineBpm: 120,
        duration: 180,
        lyrics: "Keep the lyrics",
        cues: [{ id: "cue", start: 2, end: 8, text: "Keep the lyrics" }],
        offset: -2,
        beatsPerBar: 3,
        audioUrl: "blob:https://host.test/audio",
        audioName: "live.wav",
      },
    ],
  };
}

describe("song scene core", () => {
  it("exports the bounded scene count and captures only detached visual settings", () => {
    expect(MAX_SONG_SCENES).toBe(128);
    const live = show(),
      before = structuredClone(live);
    const scene = captureSongScene(live, "My scene", "scene-1");
    expect(scene).toEqual({
      id: "scene-1",
      name: "My scene",
      decks: live.decks,
      crossfade: live.crossfade,
      fx: live.fx,
    });
    expect(scene.decks).not.toBe(live.decks);
    scene.decks.forEach((d, i) => expect(d).not.toBe(live.decks[i]));
    expect(scene.fx).not.toBe(live.fx);
    scene.decks[0].rotation = 0;
    scene.fx.depth = 1;
    expect(live).toEqual(before);
    live.decks[1].opacity = 0;
    live.fx.mapping = 0;
    expect(scene.decks[1].opacity).toBe(0.7);
    expect(scene.fx.mapping).toBe(0.8);
  });

  it("reports missing IDs once in deck order, including inactive and unresolved media", () => {
    const live = show();
    const scene = captureSongScene(live, "Missing", "scene");
    scene.decks = [
      deck("absent"),
      { ...deck("unresolved"), opacity: 0 },
      deck("absent"),
    ];
    const assets = [asset("unresolved", { url: "indexeddb:unresolved" })];
    const before = structuredClone({ scene, assets });
    expect(missingSceneAssetIds(scene, assets)).toEqual([
      "absent",
      "unresolved",
    ]);
    expect({ scene, assets }).toEqual(before);
    for (const url of [undefined, "", "   ", "indexeddb:unresolved"]) {
      expect(
        missingSceneAssetIds(scene, [
          asset("absent"),
          asset("unresolved", { url }),
        ]),
      ).toEqual(["unresolved"]);
    }
  });

  it("accepts procedural assets without URLs and resolved local, remote, or blob URLs", () => {
    const live = show();
    const scene = captureSongScene(live, "Available", "scene");
    for (const url of [
      "/media/a",
      "./assets/a.mp4",
      "https://host.test/a",
      "blob:https://host.test/a",
    ]) {
      expect(
        missingSceneAssetIds(scene, [
          asset("a", { url }),
          asset("b", { kind: "procedural", visual: "plasma", url: undefined }),
          asset("c", { kind: "image" }),
        ]),
      ).toEqual([]);
    }
  });

  it("applies only decks, crossfade, and FX, keeping live song, timing, and master state", () => {
    const live = show(),
      source = show();
    source.decks[0].rotation = -90;
    source.crossfade = 0;
    source.fx.glitch = 0;
    const scene = captureSongScene(source, "Recall", "scene");
    live.songs[0].scenes = [scene];
    const before = structuredClone(live),
      saved = structuredClone(scene);
    const next = applySongScene(live, scene);
    expect(next).toEqual({
      ...live,
      decks: scene.decks,
      crossfade: scene.crossfade,
      fx: scene.fx,
    });
    expect(next).not.toBe(live);
    for (const key of ["songs", "assets", "lyricStyle"] as const)
      expect(next[key]).toBe(live[key]);
    expect(next.decks).not.toBe(scene.decks);
    next.decks.forEach((d, i) => {
      expect(d).not.toBe(scene.decks[i]);
      expect(d).not.toBe(live.decks[i]);
    });
    next.decks[0].assetId = "other";
    next.fx.glitch = 1;
    expect(live).toEqual(before);
    expect(scene).toEqual(saved);
  });

  it.each(["absent", "no-url", "indexeddb"])(
    "refuses %s scene assets without touching live state",
    (mode) => {
      const live = show();
      const scene = captureSongScene(live, "Cannot recall", "scene");
      scene.decks[2] = { ...scene.decks[2], assetId: "missing", opacity: 0 };
      if (mode !== "absent")
        live.assets.push(
          asset("missing", {
            url: mode === "indexeddb" ? "indexeddb:missing" : undefined,
          }),
        );
      const before = structuredClone({ live, scene });
      expect(() => applySongScene(live, scene)).toThrow(/missing/);
      expect({ live, scene }).toEqual(before);
      // A real relink makes the same stored scene usable.
      live.assets = [
        ...live.assets.filter((a) => a.id !== "missing"),
        asset("missing"),
      ];
      expect(applySongScene(live, scene).decks[2].assetId).toBe("missing");
    },
  );

  it.each([
    ["video", undefined, false, 8],
    ["image", undefined, false, 8],
    ["video", 16, true, 16],
    ["image", 4, true, 4],
    ["procedural", undefined, true, 8],
  ] as const)(
    "assigns %s with %s beats as a clean solo asset",
    (kind, beats, beatSync, expectedBeats) => {
      const scene = captureSongScene(show(), "Solo", "scene");
      const selected = asset("new", { kind, beats });
      const before = structuredClone({ scene, selected });
      const result = assignSceneMainAsset(scene, selected);
      expect(result).toMatchObject({
        id: scene.id,
        name: scene.name,
        crossfade: 0,
        fx: scene.fx,
      });
      expect(result.decks).toEqual(
        [1, 0, 0].map((opacity) => ({
          assetId: "new",
          opacity,
          speed: 1,
          scale: 1,
          rotation: 0,
          mirror: false,
          beatSync,
          beats: expectedBeats,
          hue: 0,
          saturation: 1,
          brightness: 1,
          blend: "normal",
        })),
      );
      expect(missingSceneAssetIds(result, [selected])).toEqual([]);
      expect(new Set(result.decks).size).toBe(3);
      result.decks[0].opacity = 0.5;
      result.fx.bloom = 1;
      expect(result.decks[1].opacity).toBe(0);
      expect({ scene, selected }).toEqual(before);
    },
  );
});

describe("collection scene creation", () => {
  const tagged = (
    section: string,
    slug = "chosen",
    patch: Partial<Asset> = {},
  ) =>
    asset(`${slug}-${section}`, {
      tags: ["setlist-scene", `song:${slug}`, `section:${section}`],
      ...patch,
    });

  it("creates main/A/B/C in order from exact tags, with independent visuals and generated IDs", () => {
    const live = show();
    live.assets = [
      tagged("c"),
      tagged("main", "chosen-live"),
      tagged("a"),
      tagged("b"),
      tagged("main"),
    ];
    const before = structuredClone(live);
    let n = 0;
    const idFactory = vi.fn(() => `scene-${++n}`);
    const scenes = createCollectionSongScenes(live, "chosen", idFactory);
    expect(scenes.map((s) => [s.id, s.name, s.decks[0].assetId])).toEqual([
      ["scene-1", "基本", "chosen-main"],
      ["scene-2", "Aメロ", "chosen-a"],
      ["scene-3", "Bメロ", "chosen-b"],
      ["scene-4", "Cメロ", "chosen-c"],
    ]);
    expect(idFactory).toHaveBeenCalledTimes(4);
    for (const scene of scenes) {
      expect(scene.fx).toEqual(live.fx);
      expect(scene.crossfade).toBe(0);
      expect(scene.decks.map((d) => d.opacity)).toEqual([1, 0, 0]);
      expect(missingSceneAssetIds(scene, live.assets)).toEqual([]);
    }
    scenes[0].decks[0].brightness = 0;
    scenes[0].fx.mapping = 0;
    expect(scenes[1].decks[0].brightness).toBe(1);
    expect(scenes[1].fx.mapping).toBe(0.8);
    expect(live).toEqual(before);
  });

  it.each([false, true])(
    "uses the first matching asset after merging additive originals (exterior: %s)",
    (includeExterior) => {
      const sections = ["main", "a", "b", "c"];
      const canva = sections.map((section) =>
        tagged(section, "wasurete-kudasai", {
          id: `canva-${section}`,
          tags: [
            "setlist-scene",
            "song:wasurete-kudasai",
            `section:${section}`,
            "canva",
          ],
        }),
      );
      const originals = sections
        .filter((section) => includeExterior || section !== "main")
        .map((section) =>
          tagged(section, "wasurete-kudasai", {
            id: `original-wasurete-${section}`,
            tags: [
              "setlist-scene",
              "song:wasurete-kudasai",
              `section:${section}`,
              "original",
            ],
          }),
        );
      // Even originals published first cannot move IDs already in a saved library.
      const incoming = [...originals, ...canva];
      const live = show();
      live.assets = canva;
      live.songs[0].scenes = [
        assignSceneMainAsset(
          captureSongScene(live, "Saved", "saved"),
          canva[1],
        ),
      ];
      const before = structuredClone({ live, incoming });
      const merged = {
        ...live,
        assets: mergeAssetCatalog(live.assets, incoming),
      };
      expect(merged.assets.map((a) => a.id)).toEqual([
        ...canva.map((a) => a.id),
        ...originals.map((a) => a.id),
      ]);
      let n = 0;
      const scenes = createCollectionSongScenes(
        merged,
        "wasurete-kudasai",
        () => `scene-${++n}`,
      );
      expect(scenes.map((s) => s.decks[0].assetId)).toEqual(
        canva.map((a) => a.id),
      );
      expect(scenes.map((s) => s.name)).toEqual([
        "基本",
        "Aメロ",
        "Bメロ",
        "Cメロ",
      ]);
      expect(merged.songs[0].scenes).toEqual(before.live.songs[0].scenes);

      // A fresh library follows incoming order, selecting originals where present.
      const fresh = { ...live, assets: mergeAssetCatalog([], incoming) };
      expect(
        createCollectionSongScenes(
          fresh,
          "wasurete-kudasai",
          () => `fresh-${++n}`,
        ).map((s) => s.decks[0].assetId),
      ).toEqual(
        sections.map((section) =>
          includeExterior || section !== "main"
            ? `original-wasurete-${section}`
            : "canva-main",
        ),
      );
      expect({ live, incoming }).toEqual(before);
    },
  );

  it("skips nonexistent sections without inventing footage or guessing titles", () => {
    const live = show();
    live.songs[0].title = "chosen";
    live.assets = [
      tagged("b"),
      tagged("main"),
      tagged("a", "other"),
      tagged("ambient"),
      tagged("c", "chosen", { tags: ["song:chosen", "section:c"] }),
      tagged("a", "chosen", { tags: ["setlist-scene", "section:a"] }),
    ];
    const idFactory = vi.fn(() => "id");
    expect(createCollectionSongScenes(live, "unknown", idFactory)).toEqual([]);
    expect(createCollectionSongScenes(live, "", idFactory)).toEqual([]);
    expect(idFactory).not.toHaveBeenCalled();
    let n = 0;
    const scenes: SongScene[] = createCollectionSongScenes(
      live,
      "chosen",
      () => `id-${++n}`,
    );
    expect(scenes.map((s) => s.name)).toEqual(["基本", "Bメロ"]);
    expect(n).toBe(2);
    expect(live.songs[0]).not.toHaveProperty("scenes");
  });
});
