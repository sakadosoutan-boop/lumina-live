import type { Asset } from "./types";

export const SETLIST_SCENE_TAG = "setlist-scene";

export const setlistSceneSongs = [
  { slug: "music", name: "ミュージック" },
  { slug: "sora-mo-toberu-hazu", name: "空も飛べるはず" },
  { slug: "odoriko", name: "踊り子" },
  { slug: "beat-it", name: "Beat It" },
  { slug: "i-want-it-that-way", name: "I Want It That Way" },
  { slug: "megane-wo-hazushite", name: "メガネを外して" },
  { slug: "eight-beat", name: "エイトビート" },
  { slug: "lovin", name: "lovin’" },
  { slug: "wasurete-kudasai", name: "忘れてください" },
  { slug: "zenzenzense", name: "前前前世" },
  { slug: "koibito-gokko", name: "恋人ごっこ" },
] as const;

// Neutral clip labels; these do not describe or infer a song's structure.
export const setlistSceneSections = [
  { id: "main", label: "基本" },
  { id: "a", label: "Aメロ" },
  { id: "b", label: "Bメロ" },
  { id: "c", label: "Cメロ" },
] as const;

export function hasSetlistScenes(assets: readonly Asset[]): boolean {
  return assets.some((asset) => asset.tags.includes(SETLIST_SCENE_TAG));
}

export function filterLibraryAssets(
  assets: readonly Asset[],
  category: string,
  search: string,
  sceneSong = "",
  sceneSection = "",
): Asset[] {
  const q = search.toLowerCase();
  return assets.filter(
    (asset) =>
      (category === "all" ||
        (category === "favorites" && asset.favorite) ||
        (category === "video" && asset.kind === "video") ||
        (category === "procedural" && asset.kind === "procedural") ||
        asset.tags.includes(category)) &&
      (category !== SETLIST_SCENE_TAG ||
        ((!sceneSong || asset.tags.includes(`song:${sceneSong}`)) &&
          (!sceneSection || asset.tags.includes(`section:${sceneSection}`)))) &&
      (!q ||
        `${asset.name} ${asset.tags.join(" ")} ${asset.license}`
          .toLowerCase()
          .includes(q)),
  );
}

