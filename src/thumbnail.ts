import { builtInAssets } from './catalog';
import { VJRenderer } from './renderer';
import type { Asset, RenderState } from './types';

export interface ProceduralThumbnailOptions {
  signal?: AbortSignal;
  /** Receives just the newly completed IDs. Images are self-contained data URLs. */
  onBatch?: (thumbnails: ReadonlyMap<string, string>) => void;
  /** Clamped to 1–4; a job also yields after spending 8 ms on a batch. Default 2. */
  batchSize?: number;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Thumbnail generation aborted.', 'AbortError');
}

function yieldToHost(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Thumbnail generation aborted.', 'AbortError')); };
    const done = () => { cleanup(); resolve(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(done, { timeout: 500 });
    else timer = setTimeout(done, 16);
  });
}

/**
 * Render the catalog (96 originals by default) with the same shaders as Output.
 * One detached 240×135 WebGL canvas is reused for the whole job and released in
 * finally, including on abort, failed rendering, or a throwing onBatch callback.
 * No assets are mutated, no blob URLs need revoking, and nonprocedural assets and
 * duplicate IDs are skipped. Keep the returned URLs in host state/cache; abort
 * the job on unmount. There is no persistent renderer or animation loop.
 */
export async function generateProceduralThumbnails(
  assets: readonly Asset[] = builtInAssets,
  options: ProceduralThumbnailOptions = {},
): Promise<Map<string, string>> {
  const { signal, onBatch } = options;
  checkAbort(signal);
  const unique = new Map<string, Asset>();
  for (const asset of assets) {
    if (asset.kind === 'procedural' && !unique.has(asset.id)) unique.set(asset.id, { ...asset, tags: [...asset.tags] });
  }
  const pending = [...unique.values()];
  const result = new Map<string, string>();
  if (!pending.length) return result;
  const batchSize = Number.isFinite(options.batchSize) ? Math.max(1, Math.min(4, Math.floor(options.batchSize!))) : 2;
  await yieldToHost(signal);
  checkAbort(signal);
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 135;
  let renderer: VJRenderer | undefined;
  try {
    renderer = new VJRenderer(canvas, pending, { precompile: false });
    const state: RenderState = {
      time: 0, beat: 0, bpm: 120, playing: false, decks: [], crossfade: 0,
      master: 1, blackout: false, freeze: false,
      fx: { glitch: 0, bloom: 0, vignette: 0, chromatic: 0, pixelate: 0 },
      lyric: '', lyricProgress: 0,
      lyricStyle: { enabled: false, size: 64, position: 0.77, color: '#ffffff', align: 'center', mode: 'line', shadow: true },
      audio: { low: 0, mid: 0, high: 0, level: 0 }, width: 240, height: 135,
    };
    for (let index = 0; index < pending.length;) {
      checkAbort(signal);
      const batch = new Map<string, string>();
      const start = performance.now();
      do {
        const asset = pending[index++];
        // Deterministic mid-motion frames, preserving each real seed, hue and
        // composition. No substitute CSS artwork or thumbnail-only recoloring.
        const seed = Number.isFinite(asset.seed) ? asset.seed! : 0;
        state.time = 6 + ((seed % 8 + 8) % 8) * 0.37;
        state.beat = state.time * state.bpm / 60;
        state.decks = [{ assetId: asset.id, opacity: 1, speed: 1, scale: 1, rotation: 0,
          mirror: false, beatSync: true, beats: asset.beats ?? 8, hue: 0,
          saturation: 1, brightness: 1, blend: 'normal' }];
        renderer.render(state);
        const errors = renderer.getStats().mediaErrors;
        if (errors.length) throw new Error(`Thumbnail ${asset.id}: ${errors.join('; ')}`);
        // Snapshot in the same task as render: preserveDrawingBuffer is false.
        // Small synchronous encodes keep one bounded snapshot, with no queued
        // GPU readbacks or full-resolution images competing with live output.
        const url = canvas.toDataURL('image/webp', 0.82);
        if (url === 'data:,') throw new Error(`Thumbnail ${asset.id}: canvas snapshot failed.`);
        result.set(asset.id, url);
        batch.set(asset.id, url);
      } while (index < pending.length && batch.size < batchSize && performance.now() - start < 8);
      checkAbort(signal);
      onBatch?.(batch);
      checkAbort(signal);
      if (index < pending.length) await yieldToHost(signal);
    }
    return result;
  } finally {
    renderer?.dispose({ loseContext: true });
    canvas.width = canvas.height = 1;
  }
}
