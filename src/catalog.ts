import type { Asset, VisualKind } from "./types";

// Original locally authored shader scores. No downloaded stock or remote dependencies.
// The artwork and preset data in this catalog are dedicated to the public domain (CC0).
const families: {
  kind: VisualKind;
  name: string;
  tags: string[];
  energy: number;
}[] = [
  {
    kind: "tunnel",
    name: "Cathedral Transit",
    tags: ["perspective", "architecture", "driving"],
    energy: 0.86,
  },
  {
    kind: "waves",
    name: "Silk Tides",
    tags: ["ribbons", "fluid", "ambient"],
    energy: 0.36,
  },
  {
    kind: "particles",
    name: "Orbital Lanterns",
    tags: ["bokeh", "stars", "floating"],
    energy: 0.5,
  },
  {
    kind: "grid",
    name: "Midnight Causeway",
    tags: ["perspective", "synth", "geometric"],
    energy: 0.72,
  },
  {
    kind: "rings",
    name: "Resonance Garden",
    tags: ["circles", "pulse", "minimal"],
    energy: 0.58,
  },
  {
    kind: "plasma",
    name: "Liquid Alloy",
    tags: ["interference", "fluid", "psychedelic"],
    energy: 0.76,
  },
  {
    kind: "kaleido",
    name: "Prism Conservatory",
    tags: ["symmetry", "crystal", "geometric"],
    energy: 0.82,
  },
  {
    kind: "noise",
    name: "Mineral Currents",
    tags: ["marble", "organic", "texture"],
    energy: 0.42,
  },
  {
    kind: "aurora",
    name: "Polar Veils",
    tags: ["curtains", "sky", "ambient"],
    energy: 0.32,
  },
  {
    kind: "bars",
    name: "Signal Foundry",
    tags: ["equalizer", "rhythm", "graphic"],
    energy: 0.94,
  },
  {
    kind: "terrain",
    name: "Contour Expedition",
    tags: ["landscape", "topography", "perspective"],
    energy: 0.56,
  },
  {
    kind: "vortex",
    name: "Spiral Observatory",
    tags: ["spiral", "rotation", "cosmic"],
    energy: 0.88,
  },
];

const variations = [
  { name: "Arctic / Open", hue: 185, tags: ["cyan", "open"], energy: -0.1 },
  {
    name: "Ember / Inclined",
    hue: 12,
    tags: ["orange", "diagonal"],
    energy: 0.03,
  },
  {
    name: "Orchid / Twin",
    hue: 284,
    tags: ["violet", "paired"],
    energy: -0.04,
  },
  {
    name: "Viridian / Offset",
    hue: 146,
    tags: ["green", "asymmetric"],
    energy: 0.07,
  },
  { name: "Gold / Wide", hue: 43, tags: ["amber", "panoramic"], energy: -0.08 },
  {
    name: "Cobalt / Faceted",
    hue: 224,
    tags: ["blue", "angular"],
    energy: 0.08,
  },
  { name: "Rose / Dense", hue: 330, tags: ["pink", "intricate"], energy: 0.04 },
  {
    name: "Pearl / Radial",
    hue: 204,
    tags: ["pastel", "radial"],
    energy: -0.02,
  },
];

/** Stable IDs and seeds are safe to persist in shows; seed % 8 selects composition. */
export const builtInAssets: Asset[] = families.flatMap((family, familyIndex) =>
  variations.map((variation, variant) => ({
    id: `lumina-${family.kind}-${variant + 1}`,
    name: `${family.name} — ${variation.name}`,
    kind: "procedural" as const,
    visual: family.kind,
    tags: [
      "original",
      "procedural",
      "generative",
      family.kind,
      ...family.tags,
      ...variation.tags,
    ],
    hue: variation.hue,
    energy: Math.min(1, Math.max(0.1, family.energy + variation.energy)),
    bpm: 120,
    beats: 8,
    seed: familyIndex * 8 + variant,
    license: "CC0-1.0",
    source:
      "Locally authored LUMINA LIVE artwork: src/renderer.ts + src/catalog.ts",
    attribution:
      "Original LUMINA LIVE procedural artwork, dedicated to the public domain under CC0 1.0. Attribution is not required.",
    status: "ready",
  })),
);
