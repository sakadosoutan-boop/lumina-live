// Pure Vitest/Node tests. GL and media are mocked; real shader/pixel QA belongs
// to the parent's CUA session. This file never launches or controls a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VJRenderer } from '../src/renderer';
import { generateProceduralThumbnails } from '../src/thumbnail';
import { builtInAssets } from '../src/catalog';
import { MockCanvas, MockDocument, deck, state } from './renderer.mocks';
import type { Asset } from '../src/types';

let document: MockDocument;
beforeEach(() => {
  document = new MockDocument();
  vi.stubGlobal('document', document); vi.stubGlobal('window', {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function rig(assets = builtInAssets, options = {}) {
  const canvas = document.createElement('canvas') as MockCanvas;
  const renderer = new VJRenderer(canvas as unknown as HTMLCanvasElement, assets, options);
  return { canvas, renderer, current: state(assets[0].id), gl: canvas.context! };
}

describe('renderer cadence and lifecycle', () => {
  it('measures exact 30/60 FPS intervals, counts real misses, and resets samples when the target changes', () => {
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const r = rig(); r.renderer.render(r.current);
    for (let i = 1; i <= 30; i++) { now = i * 1000 / 30; r.renderer.render(r.current); }
    expect(r.renderer.getStats()).toMatchObject({ fps: 30, dropped: 0, mediaErrors: [] });
    now += 2000 / 30; r.renderer.render(r.current);
    expect(r.renderer.getStats().dropped).toBe(1);
    r.renderer.setTargetFps(60); r.renderer.render(r.current);
    const start = now;
    for (let i = 1; i <= 60; i++) { now = start + i * 1000 / 60; r.renderer.render(r.current); }
    expect(r.renderer.getStats()).toMatchObject({ fps: 60, dropped: 1 });
    now += 50; r.renderer.render(r.current);
    expect(r.renderer.getStats().dropped).toBe(3);
    for (const invalid of [0, -1, NaN, Infinity]) r.renderer.setTargetFps(invalid);
    now += 1000 / 60; r.renderer.render(r.current);
    expect(r.renderer.getStats().dropped).toBe(3);
    r.renderer.dispose();
  });

  it('excludes pause/freeze/blackout/hidden transitions and suspension from late counts', () => {
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const r = rig(); r.renderer.render(r.current);
    for (const mode of ['freeze', 'blackout', 'pause', 'hidden']) {
      r.current.freeze = mode === 'freeze'; r.current.blackout = mode === 'blackout'; r.current.playing = mode !== 'pause';
      document.hidden = mode === 'hidden';
      now += 200; r.renderer.render(r.current); now += 200; r.renderer.render(r.current);
      r.current.freeze = r.current.blackout = false; r.current.playing = true; document.hidden = false;
      now += 200; r.renderer.render(r.current);
    }
    now += 5000; r.renderer.render(r.current);
    expect(r.renderer.getStats().dropped).toBe(0); r.renderer.dispose();
  });

  it('captures freeze once, gives blackout priority, and restores captured bytes after context loss', () => {
    const r = rig(); r.current.fx.bloom = 0.3; r.renderer.render(r.current);
    expect(r.gl.api.readPixels).not.toHaveBeenCalled();
    const frames = r.gl.draws.length;
    r.current.freeze = true; r.renderer.render(r.current); r.renderer.render(r.current);
    expect(r.gl.api.readPixels).toHaveBeenCalledTimes(1);
    expect(r.gl.draws.length - frames).toBe(2); // Only the presentation pass.
    r.current.blackout = true; r.renderer.render(r.current);
    expect(r.gl.draws.length - frames).toBe(2);
    expect(r.gl.api.clearColor).toHaveBeenLastCalledWith(0, 0, 0, 1);
    r.gl.extension.loseContext(); r.gl.extension.restoreContext();
    r.current.blackout = false; r.renderer.render(r.current);
    const restored = r.gl.api.texSubImage2D.mock.calls.find((args: unknown[]) => args.at(-1) instanceof Uint8Array);
    expect(restored?.at(-1)).toEqual(new Uint8Array(240 * 135 * 4).fill(42));
    expect(r.gl.api.readPixels).toHaveBeenCalledTimes(1);
    r.current.freeze = false; r.renderer.render(r.current);
    r.renderer.dispose(); r.renderer.dispose(); expect(r.gl.remaining()).toBe(0);
  });

  it('cleans up partial shader initialization and falls back to WebGL1', () => {
    document.configureGL = context => context.api.getShaderParameter.mockReturnValue(false);
    const failed = rig();
    expect(failed.renderer.getStats().mediaErrors[0]).toContain('shader failure');
    expect(failed.gl.remaining()).toBe(0); failed.renderer.dispose();
    document.configureGL = undefined; document.webgl1 = true;
    const fallback = rig(); fallback.renderer.render(fallback.current);
    expect(fallback.renderer.getStats().mediaErrors).toEqual([]);
    fallback.renderer.dispose({ loseContext: true });
    expect(fallback.gl.remaining()).toBe(0); expect(fallback.gl.extension.loseContext).toHaveBeenCalledTimes(1);
  });

  it('caps internal pixel allocation, reuses targets between frames, and frees them on resize/disposal', () => {
    const r = rig(); r.current.width = 3840; r.current.height = 2160;
    r.renderer.render(r.current);
    expect([r.canvas.width, r.canvas.height]).toEqual([1920, 1080]);
    const allocated = r.gl.api.createFramebuffer.mock.calls.length;
    r.renderer.render(r.current); expect(r.gl.api.createFramebuffer).toHaveBeenCalledTimes(allocated);
    r.current.width = 240; r.current.height = 135; r.renderer.render(r.current);
    expect(r.gl.api.deleteFramebuffer).toHaveBeenCalledTimes(allocated);
    r.renderer.dispose(); expect(r.gl.remaining()).toBe(0);
  });
});

describe('video clock and resource handling', () => {
  const videoAsset: Asset = { ...builtInAssets[0], id: 'video', kind: 'video', url: 'blob:host-owned' };
  it('reports off-air video readiness only after assignment, decoding and seeking complete', () => {
    const r = rig([builtInAssets[0], videoAsset]);
    expect(r.renderer.isDeckReady(0)).toBe(false);
    r.current.decks = [deck(builtInAssets[0].id), deck(videoAsset.id)];
    r.renderer.render(r.current);
    expect(r.renderer.isDeckReady(0)).toBe(true);
    const video = document.videos[0];
    video.readyState = 1; expect(r.renderer.isDeckReady(1)).toBe(false);
    video.readyState = 2; video.seeking = true; expect(r.renderer.isDeckReady(1)).toBe(false);
    video.seeking = false; expect(r.renderer.isDeckReady(1)).toBe(true);
    expect(video.play).not.toHaveBeenCalled(); // B is preloaded, not playing.
    for (const slot of [-1, 2, 3, 0.5, NaN]) expect(r.renderer.isDeckReady(slot)).toBe(false);
    video.onerror?.(); expect(r.renderer.isDeckReady(1)).toBe(false);
    r.renderer.setAssets([builtInAssets[0], { ...videoAsset, url: 'blob:replacement' }]);
    expect(r.renderer.isDeckReady(1)).toBe(false);
    r.renderer.render(r.current); expect(r.renderer.isDeckReady(1)).toBe(true);
    r.gl.extension.loseContext(); expect(r.renderer.isDeckReady(0)).toBe(false); expect(r.renderer.isDeckReady(1)).toBe(false);
    r.renderer.dispose(); expect(r.renderer.isDeckReady(0)).toBe(false);
  });

  it('rejects incomplete/broken images, removed assignments, and zero-opacity media', () => {
    const imageAsset: Asset = { ...videoAsset, id: 'image', kind: 'image' };
    const r = rig([builtInAssets[0], imageAsset]);
    r.current.decks = [deck(builtInAssets[0].id), deck(imageAsset.id)]; r.renderer.render(r.current);
    const image = document.images[0];
    expect(r.renderer.isDeckReady(1)).toBe(false);
    image.complete = true; expect(r.renderer.isDeckReady(1)).toBe(false);
    image.naturalWidth = image.naturalHeight = 64; expect(r.renderer.isDeckReady(1)).toBe(true);
    r.current.decks[1].opacity = 0; r.renderer.render(r.current); expect(r.renderer.isDeckReady(1)).toBe(false);
    r.current.decks = []; r.renderer.render(r.current); expect(r.renderer.isDeckReady(0)).toBe(false);
    r.renderer.dispose(); expect(r.gl.remaining()).toBe(0);
  });

  it('fits video duration to beats, wraps seeks, and uploads only decoded/dirty frames', async () => {
    let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const r = rig([videoAsset]); r.current.beat = 2; r.current.playing = false; r.renderer.render(r.current);
    const video = document.videos[0];
    expect(video.playbackRate).toBe(2); expect(video.currentTime).toBe(2);
    const uploads = r.gl.api.texImage2D.mock.calls.length;
    now += 100; r.renderer.render(r.current);
    expect(r.gl.api.texImage2D).toHaveBeenCalledTimes(uploads); expect(r.gl.api.texSubImage2D).not.toHaveBeenCalled();
    video.frame?.(); now += 100; r.renderer.render(r.current);
    expect(r.gl.api.texSubImage2D).toHaveBeenCalledTimes(1);
    r.current.beat = 11; now += 100; r.renderer.render(r.current); expect(video.currentTime).toBe(3);
    r.current.decks[0].speed = 0; now += 100; r.renderer.render(r.current); expect(video.currentTime).toBe(0);
    expect(video.play).not.toHaveBeenCalled();
    r.renderer.dispose(); expect(r.gl.remaining()).toBe(0);
    expect(video.removeAttribute).toHaveBeenCalledWith('src'); expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
    expect(video.onloadeddata).toBeNull(); expect(video.onseeked).toBeNull(); expect(video.onerror).toBeNull();
  });

  it('pauses late play promises, releases changed clips during blackout, and avoids starting hidden decoders', async () => {
    const r = rig([videoAsset]);
    // Blackout must not instantiate a decoder or allocate render targets.
    r.current.blackout = true; r.renderer.render(r.current); expect(document.videos).toHaveLength(0);
    r.current.blackout = false; r.current.playing = false; r.renderer.render(r.current);
    const video = document.videos[0]; let finish: () => void = () => {};
    video.play.mockImplementation(() => new Promise<void>(resolve => { finish = () => { video.paused = false; resolve(); }; }));
    r.current.playing = true; r.renderer.render(r.current);
    r.current.freeze = true; r.renderer.render(r.current); finish(); await Promise.resolve();
    expect(video.paused).toBe(true);
    r.current.blackout = true; r.current.decks = []; r.renderer.render(r.current);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(1); expect(video.load).toHaveBeenCalledTimes(2);
    r.renderer.dispose(); expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(1); expect(r.gl.remaining()).toBe(0);
  });
});

describe('chunked procedural thumbnails using the real renderer with mocked GL', () => {
  it('renders all 96 original presets at 240×135, yields bounded batches and releases one context', async () => {
    vi.useFakeTimers();
    const before = structuredClone(builtInAssets), batches: number[] = [], ticks: number[] = [];
    const job = generateProceduralThumbnails(undefined, { onBatch: batch => { batches.push(batch.size); ticks.push(Date.now()); } });
    expect(document.contexts).toHaveLength(0); // Initial asynchronous yield.
    await vi.runAllTimersAsync(); const urls = await job;
    expect([...urls.keys()]).toEqual(builtInAssets.map(asset => asset.id));
    expect(builtInAssets).toEqual(before); expect(Math.max(...batches)).toBeLessThanOrEqual(2);
    expect(new Set(ticks).size).toBeGreaterThan(1); expect(document.contexts).toHaveLength(1);
    const canvas = document.canvases.find(item => item.context)!;
    expect(canvas.snapshots).toEqual(Array.from({ length: 96 }, () => [240, 135]));
    const gl = document.contexts[0];
    const proceduralDraws = gl.draws.filter(draw => draw.uniforms.has('uSeed'));
    expect(proceduralDraws).toHaveLength(96);
    expect(proceduralDraws.map(draw => draw.uniforms.get('uSeed')![0])).toEqual(builtInAssets.map(asset => asset.seed));
    expect(new Set(proceduralDraws.map(draw => draw.uniforms.get('uVariant')![0])).size).toBe(8);
    expect(new Set(proceduralDraws.map(draw => draw.uniforms.get('uHue')![0])).size).toBe(8);
    expect(new Set(proceduralDraws.map(draw => draw.uniforms.get('uTime')![0])).size).toBe(8);
    expect(gl.remaining()).toBe(0); expect(gl.extension.loseContext).toHaveBeenCalledTimes(1);
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  });

  it('skips nonprocedural/duplicate IDs and does no work when already aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(); controller.abort();
    await expect(generateProceduralThumbnails(undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.contexts).toHaveLength(0);
    expect(await generateProceduralThumbnails([{ ...builtInAssets[0], kind: 'video' }])).toEqual(new Map());
    const job = generateProceduralThumbnails([builtInAssets[0], builtInAssets[0]]);
    await vi.runAllTimersAsync(); expect((await job).size).toBe(1);
  });

  it.each(['abort', 'callback', 'webgl'] as const)('cleans up after %s failure', async reason => {
    vi.useFakeTimers(); const controller = new AbortController(); let batches = 0;
    document.disabled = reason === 'webgl';
    const job = generateProceduralThumbnails(undefined, { signal: controller.signal, onBatch: () => {
      batches++; if (reason === 'abort') controller.abort(); else throw new Error('consumer failed');
    } });
    const assertion = expect(job).rejects.toThrow(reason === 'abort' ? /abort/i : reason === 'callback' ? /consumer failed/ : /WebGL is unavailable/);
    await vi.runAllTimersAsync(); await assertion;
    expect(batches).toBe(reason === 'webgl' ? 0 : 1);
    for (const context of document.contexts) {
      expect(context.remaining()).toBe(0); expect(context.extension.loseContext).toHaveBeenCalledTimes(1);
    }
    expect(document.canvases[0].width).toBe(1);
  });
});
