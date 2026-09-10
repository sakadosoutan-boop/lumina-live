export interface PanelLayout {
  sidebar: number;
  lyrics: number;
  preview: number;
  monitor: number;
  timeline: number;
  thumbnail: number;
}

export const defaultLayout: PanelLayout = {
  sidebar: 144,
  lyrics: 236,
  preview: 0.32,
  monitor: 0.58,
  timeline: 77,
  thumbnail: 200,
};
export const layoutKey = "lumina.layout.v1";
export const bounds = {
  sidebar: [120, 280],
  lyrics: [210, 440],
  preview: [0.18, 0.7],
  monitor: [0.25, 0.75],
  timeline: [60, 160],
  thumbnail: [140, 320],
} satisfies Record<keyof PanelLayout, [number, number]>;
export const limit = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), value));

/** Preferences are local to the operator's display, never part of a show file. */
export function parseLayout(raw: string | null): PanelLayout {
  const result = { ...defaultLayout };
  try {
    const saved = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return result;
    for (const key of Object.keys(result) as (keyof PanelLayout)[]) {
      const value = saved[key];
      if (typeof value === "number" && Number.isFinite(value))
        result[key] = limit(value, ...bounds[key]);
    }
  } catch {
    /* A blocked or old preference must not prevent a live show. */
  }
  return result;
}

/** Keep the center usable after a saved desktop layout is opened on a laptop. */
export function fitSidePanels(width: number, layout: PanelLayout) {
  const available = Math.max(330, width - 16 - 460);
  let sidebar = limit(layout.sidebar, ...bounds.sidebar);
  let lyrics = limit(layout.lyrics, ...bounds.lyrics);
  sidebar = Math.max(120, Math.min(sidebar, available - lyrics));
  lyrics = Math.max(210, Math.min(lyrics, available - sidebar));
  return { sidebar, lyrics };
}
