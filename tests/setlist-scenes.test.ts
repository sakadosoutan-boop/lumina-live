import { describe, expect, it } from "vitest";
import {
  filterLibraryAssets,
  hasSetlistScenes,
  SETLIST_SCENE_TAG,
  setlistSceneSongs,
  sortSetlistScenes,
} from "../src/setlist-scenes";
import type { Asset } from "../src/types";

const asset = (
  id: string,
  tags: string[],
  extra: Partial<Asset> = {},
): Asset => ({
  id,
  name: id,
  kind: "video",
  tags,
  hue: 0,
  energy: 0.5,
  license: "CC0",
  ...extra,
});
const scene = (id: string, song: string, section: string) =>
  asset(id, [SETLIST_SCENE_TAG, `song:${song}`, `section:${section}`]);
const clips = [
  scene("music-main", "music", "main"),
  scene("music-a", "music", "a"),
  scene("music-b", "music", "b"),
  scene("music-c", "music", "c"),
  scene("odoriko-a", "odoriko", "a"),
  scene("prefix-song", "music-live", "a"),
  scene("prefix-section", "music", "ambient"),
  asset("no-scene-tag", ["song:music", "section:a"]),
  asset("untagged-section", [SETLIST_SCENE_TAG, "song:music"]),
  asset("untagged-song", [SETLIST_SCENE_TAG, "section:a"]),
];
const ids = (assets: Asset[]) => assets.map((a) => a.id);

describe("setlist scene library filters", () => {
  it("groups shuffled scenes in setlist order and main/A/B/C order without mutating the library", () => {
    const shuffled = [
      scene("odoriko-c", "odoriko", "c"),
      scene("music-b", "music", "b"),
      scene("odoriko-main", "odoriko", "main"),
      scene("music-a", "music", "a"),
      scene("music-main", "music", "main"),
      scene("odoriko-a", "odoriko", "a"),
      scene("music-c", "music", "c"),
      scene("odoriko-b", "odoriko", "b"),
    ];
    const before = structuredClone(shuffled);
    expect(ids(filterLibraryAssets(shuffled, SETLIST_SCENE_TAG, ""))).toEqual([
      "music-main",
      "music-a",
      "music-b",
      "music-c",
      "odoriko-main",
      "odoriko-a",
      "odoriko-b",
      "odoriko-c",
    ]);
    expect(shuffled).toEqual(before);
  });

  it("preserves non-scene positions and the relative order of unknown scene tags", () => {
    const ordinary = asset("ordinary", []),
      later = asset("later", []);
    const input = [
      scene("z", "unknown", "a"),
      ordinary,
      scene("known-c", "music", "c"),
      scene("known-a", "music", "a"),
      later,
      scene("y", "unknown", "a"),
    ];
    expect(ids(sortSetlistScenes(input))).toEqual([
      "known-a",
      "ordinary",
      "known-c",
      "z",
      "later",
      "y",
    ]);
    expect(ids(filterLibraryAssets(input, "all", "", "odoriko", "c"))).toEqual(
      ids(sortSetlistScenes(input)),
    );
  });
  it("offers scenes only for exact collection membership, including newly loaded assets", () => {
    const ordinary = [
      asset("ordinary", ["song:music", "setlist-scene-preview"]),
    ];
    expect(hasSetlistScenes([])).toBe(false);
    expect(hasSetlistScenes(ordinary)).toBe(false);
    expect(hasSetlistScenes([...ordinary, clips[0]])).toBe(true);
  });

  it("requires collection, exact song and exact section together", () => {
    expect(
      ids(filterLibraryAssets(clips, SETLIST_SCENE_TAG, "", "music", "a")),
    ).toEqual(["music-a"]);
  });

  it.each(["main", "a", "b", "c"])("selects section:%s", (section) => {
    expect(
      ids(filterLibraryAssets(clips, SETLIST_SCENE_TAG, "", "music", section)),
    ).toEqual([`music-${section}`]);
  });

  it("allows all songs or sections, and includes incompletely tagged scenes only when applicable", () => {
    expect(
      ids(filterLibraryAssets(clips, SETLIST_SCENE_TAG, "", "", "a")),
    ).toEqual(["music-a", "odoriko-a", "prefix-song", "untagged-song"]);
    expect(
      ids(filterLibraryAssets(clips, SETLIST_SCENE_TAG, "", "music")),
    ).toEqual([
      "music-main",
      "music-a",
      "music-b",
      "music-c",
      "prefix-section",
      "untagged-section",
    ]);
    expect(filterLibraryAssets(clips, SETLIST_SCENE_TAG, "")).toHaveLength(
      clips.length - 1,
    );
  });

  it("ANDs case-insensitive name, tag or license search with the scene selection", () => {
    const named = [
      asset("named", [SETLIST_SCENE_TAG, "song:music", "section:a", "Night"], {
        name: "夜の海 Ocean",
        license: "Canva",
      }),
    ];
    for (const query of ["夜の海", "OCEAN", "night", "CANVA"])
      expect(
        filterLibraryAssets(named, SETLIST_SCENE_TAG, query, "music", "a"),
      ).toEqual(named);
    expect(
      filterLibraryAssets(named, SETLIST_SCENE_TAG, "ocean", "odoriko", "a"),
    ).toEqual([]);
    expect(
      filterLibraryAssets(named, SETLIST_SCENE_TAG, "ocean", "music", "b"),
    ).toEqual([]);
    expect(
      filterLibraryAssets(named, SETLIST_SCENE_TAG, "forest", "music", "a"),
    ).toEqual([]);
  });

  it.each([
    "all",
    "favorites",
    "video",
    "procedural",
    "imported",
    "folder-connected",
    "jrock",
    "halloween",
  ])("ignores retained scene selections after switching to %s", (category) => {
    const ordinary = asset(
      "ordinary",
      ["imported", "folder-connected", "jrock", "halloween"],
      {
        favorite: true,
        kind: category === "procedural" ? "procedural" : "video",
      },
    );
    expect(
      filterLibraryAssets([ordinary], category, "ordinary", "music", "a"),
    ).toEqual([ordinary]);
    expect(
      filterLibraryAssets([ordinary], category, "missing", "music", "a"),
    ).toEqual([]);
  });

  it("still excludes assets outside the active ordinary category", () => {
    expect(filterLibraryAssets(clips, "imported", "", "music", "a")).toEqual(
      [],
    );
    expect(filterLibraryAssets(clips, "favorites", "", "music", "a")).toEqual(
      [],
    );
  });

  it("returns no substitute scene when a requested song or section has no match", () => {
    expect(
      filterLibraryAssets(clips, SETLIST_SCENE_TAG, "", "koibito-gokko", "c"),
    ).toEqual([]);
    expect(
      filterLibraryAssets([], SETLIST_SCENE_TAG, "", "music", "a"),
    ).toEqual([]);
  });

  it("supports all eleven configured song slugs without changing asset order or input", () => {
    const songs = [
      "music",
      "sora-mo-toberu-hazu",
      "odoriko",
      "beat-it",
      "i-want-it-that-way",
      "megane-wo-hazushite",
      "eight-beat",
      "lovin",
      "wasurete-kudasai",
      "zenzenzense",
      "koibito-gokko",
    ];
    expect(setlistSceneSongs.map((s) => s.slug)).toEqual(songs);
    const all = songs.map((slug) => scene(slug, slug, "main"));
    const before = structuredClone(all);
    for (const slug of songs)
      expect(
        ids(filterLibraryAssets(all, SETLIST_SCENE_TAG, "", slug, "main")),
      ).toEqual([slug]);
    expect(filterLibraryAssets(all, SETLIST_SCENE_TAG, "")).toEqual(all);
    expect(all).toEqual(before);
  });
});
