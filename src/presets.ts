import { builtInAssets } from "./catalog";
import type { Deck, Show, VisualKind } from "./types";

export interface StagePreset {
  id: string;
  name: string;
  description: string;
  decks: Deck[];
  crossfade: number;
  fx: Show["fx"];
}
const layer = (
  visual: VisualKind,
  variant: number,
  options: Partial<Deck> = {},
): Deck => ({
  assetId: `lumina-${visual}-${variant}`,
  opacity: 1,
  speed: 1,
  scale: 1,
  rotation: 0,
  mirror: false,
  beatSync: true,
  beats: 16,
  hue: 0,
  saturation: 1,
  brightness: 0.85,
  blend: "normal",
  ...options,
});
const fx = (options: Partial<Show["fx"]> = {}): Show["fx"] => ({
  glitch: 0,
  bloom: 0.16,
  vignette: 0.3,
  chromatic: 0,
  pixelate: 0,
  ...options,
});

/** Original scene scores. Only bundled GPU visuals are required. */
export const stagePresets: StagePreset[] = [
  {
    id: "opening",
    name: "オープニング",
    description: "青い光の幕とゆっくり浮かぶ粒子",
    crossfade: 0.18,
    decks: [
      layer("aurora", 1, { speed: 0.5, beats: 32 }),
      layer("waves", 6, { beats: 32 }),
      layer("particles", 8, { opacity: 0.18, blend: "screen", beats: 32 }),
    ],
    fx: fx(),
  },
  {
    id: "rock",
    name: "ロック",
    description: "暖色のトンネルと奥行きのあるグリッド",
    crossfade: 0.15,
    decks: [
      layer("tunnel", 2, { beats: 8 }),
      layer("grid", 5, { beats: 8 }),
      layer("rings", 5, { opacity: 0.12, blend: "screen", beats: 8 }),
    ],
    fx: fx({ chromatic: 0.08 }),
  },
  {
    id: "chorus",
    name: "サビ",
    description: "鮮やかな万華鏡と重なる光のリング",
    crossfade: 0.28,
    decks: [
      layer("kaleido", 7, { beats: 8 }),
      layer("vortex", 3, { beats: 16 }),
      layer("rings", 8, { opacity: 0.2, blend: "screen", beats: 8 }),
    ],
    fx: fx({ bloom: 0.25, vignette: 0.2 }),
  },
  {
    id: "ballad",
    name: "静かな曲",
    description: "柔らかな波と夜空の粒子",
    crossfade: 0.35,
    decks: [
      layer("waves", 1, { speed: 0.4, beats: 32 }),
      layer("aurora", 3, { speed: 0.4, beats: 32 }),
      layer("particles", 8, {
        opacity: 0.12,
        blend: "screen",
        speed: 0.4,
        beats: 32,
      }),
    ],
    fx: fx({ bloom: 0.1 }),
  },
  {
    id: "glitch",
    name: "グリッチ",
    description: "信号のようなバーとデジタルな歪み",
    crossfade: 0.2,
    decks: [
      layer("bars", 6, { beats: 8 }),
      layer("noise", 3, { beats: 16 }),
      layer("grid", 1, { opacity: 0.12, blend: "screen", beats: 8 }),
    ],
    fx: fx({ glitch: 0.25, chromatic: 0.12, pixelate: 0.07, bloom: 0.08 }),
  },
  {
    id: "ending",
    name: "エンディング",
    description: "夕色の地形と余韻を残すゆったりした動き",
    crossfade: 0.25,
    decks: [
      layer("terrain", 5, { speed: 0.3, beats: 32 }),
      layer("waves", 8, { speed: 0.3, beats: 32 }),
      layer("particles", 5, {
        opacity: 0.12,
        blend: "screen",
        speed: 0.3,
        beats: 32,
      }),
    ],
    fx: fx({ bloom: 0.12 }),
  },
];

export function applyStagePreset(show: Show, preset: StagePreset): Show {
  const required = new Map(
    preset.decks.map((d) => {
      const asset = builtInAssets.find((a) => a.id === d.assetId);
      if (!asset) throw new Error("Preset asset is unavailable: " + d.assetId);
      return [asset.id, asset] as const;
    }),
  );
  const present = new Set(show.assets.map((a) => a.id));
  return {
    ...show,
    assets: [
      ...show.assets.map((a) =>
        required.has(a.id)
          ? { ...required.get(a.id)!, favorite: a.favorite }
          : a,
      ),
      ...[...required.values()]
        .filter((a) => !present.has(a.id))
        .map((a) => ({ ...a })),
    ],
    decks: preset.decks.map((d) => ({ ...d })),
    crossfade: preset.crossfade,
    fx: { ...preset.fx },
  };
}
