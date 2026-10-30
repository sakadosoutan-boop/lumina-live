import type { Asset, Deck, Show, SongScene } from "./types";
import { SETLIST_SCENE_TAG, setlistSceneSections } from "./setlist-scenes";

export const MAX_SONG_SCENES = 128;

/** A scene owns its visual settings, without capturing lyrics or transport state. */
export function captureSongScene(
  show: Show,
  name: string,
  id: string,
): SongScene {
  return {
    id,
    name,
    decks: show.decks.map((deck) => ({ ...deck })),
    crossfade: show.crossfade,
    fx: { ...show.fx },
  };
}

export function missingSceneAssetIds(
  scene: SongScene,
  assets: readonly Asset[],
): string[] {
  const available = new Set(
    assets
      .filter(
        (asset) =>
          asset.kind === "procedural" ||
          (asset.url?.trim() && !asset.url.startsWith("indexeddb:")),
      )
      .map((asset) => asset.id),
  );
  return [...new Set(scene.decks.map((deck) => deck.assetId))].filter(
    (id) => !available.has(id),
  );
}

export function applySongScene(show: Show, scene: SongScene): Show {
  const missing = missingSceneAssetIds(scene, show.assets);
  if (missing.length)
    throw new Error(
      "シーンの素材を再リンクしてください: " + missing.join(", "),
    );
  return {
    ...show,
    decks: scene.decks.map((deck) => ({ ...deck })),
    crossfade: scene.crossfade,
    fx: { ...scene.fx },
  };
}

export function assignSceneMainAsset(
  scene: SongScene,
  asset: Asset,
): SongScene {
  // Match App's fresh deck settings, playing unmetered footage at natural speed.
  const deck: Deck = {
    assetId: asset.id,
    opacity: 1,
    speed: 1,
    scale: 1,
    rotation: 0,
    mirror: false,
    beatSync: asset.kind === "procedural" || !!asset.beats,
    beats: asset.beats ?? 8,
    hue: 0,
    saturation: 1,
    brightness: 1,
    blend: "normal",
  };
  return {
    ...scene,
    // Inactive decks also need resolvable IDs when the scene is applied.
    decks: [deck, { ...deck, opacity: 0 }, { ...deck, opacity: 0 }],
    crossfade: 0,
    fx: { ...scene.fx },
  };
}

export function createCollectionSongScenes(
  show: Show,
  slug: string,
  idFactory: () => string,
): SongScene[] {
  return setlistSceneSections.flatMap((section) => {
    const asset = show.assets.find(
      (asset) =>
        asset.tags.includes(SETLIST_SCENE_TAG) &&
        asset.tags.includes(`song:${slug}`) &&
        asset.tags.includes(`section:${section.id}`),
    );
    return asset
      ? [
          assignSceneMainAsset(
            captureSongScene(show, section.label, idFactory()),
            asset,
          ),
        ]
      : [];
  });
}
