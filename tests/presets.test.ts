import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyStagePreset, stagePresets } from "../src/presets";
import { validateShow, serializeShow } from "../src/storage";

const demo = () =>
  validateShow(
    readFileSync(
      new URL("../examples/Demo-Session.lumina.json", import.meta.url),
      "utf8",
    ),
  );
it.each(stagePresets)(
  "$name works without downloaded media and preserves the song and master",
  (preset) => {
    const source = demo();
    source.assets = source.assets.slice(0, 1);
    source.master = 0.23;
    const before = JSON.stringify(source);
    const next = applyStagePreset(source, preset);
    expect(next.songs).toBe(source.songs);
    expect(next.lyricStyle).toBe(source.lyricStyle);
    expect(next.master).toBe(0.23);
    expect(next.decks).toHaveLength(3);
    for (const d of next.decks) {
      const asset = next.assets.find((a) => a.id === d.assetId);
      expect(asset?.kind).toBe("procedural");
      expect(asset?.url).toBeUndefined();
    }
    expect(() => serializeShow(next)).not.toThrow();
    expect(JSON.stringify(source)).toBe(before);
    next.decks[0].opacity = 0.01;
    next.fx.glitch = 0.99;
    const again = applyStagePreset(source, preset);
    expect(again.decks[0].opacity).toBe(1);
    expect(again.fx.glitch).toBeLessThan(0.99);
  },
);
