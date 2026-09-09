import fs from "node:fs/promises";
import { builtInAssets } from "../src/catalog.ts";
import { distributeLyrics } from "../src/sync.ts";
const d = (id) => ({
  assetId: id,
  opacity: 1,
  speed: 1,
  scale: 1,
  rotation: 0,
  mirror: false,
  beatSync: true,
  beats: 8,
  hue: 0,
  saturation: 1,
  brightness: 1,
  blend: "normal",
});
const make = (id, title, bpm, duration, lyrics) => ({
  id,
  title,
  bpm,
  timelineBpm: bpm,
  duration,
  lyrics,
  cues: distributeLyrics(lyrics, duration, bpm),
  offset: 0,
  beatsPerBar: 4,
});
const show = {
  version: 1,
  title: "Lumina — Demo Session",
  songs: [
    make(
      "demo-night",
      "01 / Beyond the Night",
      120,
      180,
      "[instrumental:4]\n夜の向こうへ 手を伸ばす\nまだ知らない光を探して\nこの瞬間を 音に変えて\n僕らの空へ 響かせよう\n[instrumental:4]\n消えない声が 道になる\n何度でも ここから始めよう",
    ),
    make(
      "demo-signal",
      "02 / Signal Bloom",
      96,
      120,
      "[instrumental:4]\n静かな波が 広がって\n名前のない色が生まれる\nひとつの音に かさねよう\nここにいる僕らの鼓動\n[instrumental:4]",
    ),
  ],
  assets: builtInAssets,
  decks: [
    d(builtInAssets[0].id),
    d(builtInAssets[10].id),
    { ...d(builtInAssets[32].id), opacity: 0, blend: "screen" },
  ],
  crossfade: 0,
  master: 1,
  lyricStyle: {
    enabled: true,
    size: 64,
    position: 0.77,
    color: "#ffffff",
    align: "center",
    mode: "line",
    shadow: true,
  },
  fx: { glitch: 0, bloom: 0.15, vignette: 0.25, chromatic: 0, pixelate: 0 },
};
await fs.mkdir("examples", { recursive: true });
await fs.writeFile(
  "examples/Demo-Session.lumina.json",
  JSON.stringify(show, null, 2),
);
console.log(
  "Created original demo set with two songs, estimated cues and 96 visual presets.",
);
