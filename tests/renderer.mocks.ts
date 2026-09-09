import { vi } from "vitest";
import type { Deck, RenderState } from "../src/types";

type Handle = { id: number };
type Uniform = { program: Handle; name: string };
export function mockGL(canvas: MockCanvas) {
  const constants = [
    "MAX_TEXTURE_SIZE",
    "MAX_RENDERBUFFER_SIZE",
    "DEPTH_TEST",
    "CULL_FACE",
    "BLEND",
    "DITHER",
    "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
    "ARRAY_BUFFER",
    "STATIC_DRAW",
    "FRAGMENT_SHADER",
    "VERTEX_SHADER",
    "HIGH_FLOAT",
    "COMPILE_STATUS",
    "LINK_STATUS",
    "FRAMEBUFFER",
    "FLOAT",
    "TEXTURE0",
    "TEXTURE_2D",
    "TRIANGLES",
    "TEXTURE_MIN_FILTER",
    "TEXTURE_MAG_FILTER",
    "LINEAR",
    "TEXTURE_WRAP_S",
    "TEXTURE_WRAP_T",
    "CLAMP_TO_EDGE",
    "RGBA",
    "UNSIGNED_BYTE",
    "COLOR_ATTACHMENT0",
    "FRAMEBUFFER_COMPLETE",
    "COLOR_BUFFER_BIT",
    "UNPACK_FLIP_Y_WEBGL",
  ];
  const api: Record<string, any> = Object.fromEntries(
    constants.map((name, index) => [name, index + 1]),
  );
  const resources = new Map<string, Set<Handle>>();
  let sequence = 0,
    lost = false,
    program: Handle | null = null,
    target: Handle | null = null;
  const uniforms = new Map<Handle, Map<string, number[]>>();
  const draws: { target: Handle | null; uniforms: Map<string, number[]> }[] =
    [];
  for (const kind of [
    "Buffer",
    "Texture",
    "Framebuffer",
    "Program",
    "Shader",
  ]) {
    const live = new Set<Handle>();
    resources.set(kind, live);
    api[`create${kind}`] = vi.fn(() => {
      const value = { id: ++sequence };
      live.add(value);
      return value;
    });
    api[`delete${kind}`] = vi.fn((value: Handle) => {
      live.delete(value);
    });
  }
  for (const name of [
    "disable",
    "pixelStorei",
    "bindBuffer",
    "bufferData",
    "shaderSource",
    "compileShader",
    "attachShader",
    "bindAttribLocation",
    "linkProgram",
    "viewport",
    "enableVertexAttribArray",
    "disableVertexAttribArray",
    "vertexAttribPointer",
    "activeTexture",
    "bindTexture",
    "texParameteri",
    "texImage2D",
    "texSubImage2D",
    "framebufferTexture2D",
    "clearColor",
    "clear",
  ])
    api[name] = vi.fn();
  api.getParameter = vi.fn(() => 4096);
  api.getShaderPrecisionFormat = vi.fn(() => ({ precision: 23 }));
  api.getShaderParameter = vi.fn(() => true);
  api.getProgramParameter = vi.fn(() => true);
  api.getShaderInfoLog = vi.fn(() => "shader failure");
  api.getProgramInfoLog = vi.fn(() => "link failure");
  api.checkFramebufferStatus = vi.fn(() => api.FRAMEBUFFER_COMPLETE);
  api.bindFramebuffer = vi.fn((_type: number, value: Handle | null) => {
    target = value;
  });
  api.useProgram = vi.fn((value: Handle | null) => {
    program = value;
  });
  api.getUniformLocation = vi.fn((value: Handle, name: string): Uniform => ({
    program: value,
    name,
  }));
  for (const name of [
    "uniform1f",
    "uniform2f",
    "uniform3f",
    "uniform4f",
    "uniform1i",
  ]) {
    api[name] = vi.fn((location: Uniform, ...values: number[]) => {
      if (!uniforms.has(location.program))
        uniforms.set(location.program, new Map());
      uniforms.get(location.program)!.set(location.name, values);
    });
  }
  api.drawArrays = vi.fn(() =>
    draws.push({ target, uniforms: new Map(uniforms.get(program!)) }),
  );
  api.readPixels = vi.fn((...args: unknown[]) =>
    (args.at(-1) as Uint8Array).fill(42),
  );
  const extension = {
    loseContext: vi.fn(() => {
      lost = true;
      for (const set of resources.values()) set.clear();
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    }),
    restoreContext: vi.fn(() => {
      lost = false;
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    }),
  };
  api.getExtension = vi.fn(() => extension);
  api.isContextLost = vi.fn(() => lost);
  return {
    api,
    gl: api as WebGLRenderingContext,
    draws,
    extension,
    remaining: () =>
      [...resources.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

export class MockCanvas extends EventTarget {
  width = 300;
  height = 150;
  context?: ReturnType<typeof mockGL>;
  snapshots: [number, number][] = [];
  constructor(public ownerDocument: MockDocument) {
    super();
  }
  getContext(kind: string) {
    if (kind === "2d") return { clearRect: vi.fn() };
    if (
      this.ownerDocument.disabled ||
      (kind === "webgl2" && this.ownerDocument.webgl1)
    )
      return null;
    if (!this.context) {
      this.context = mockGL(this);
      this.ownerDocument.contexts.push(this.context);
      this.ownerDocument.configureGL?.(this.context);
    }
    return this.context.gl;
  }
  toDataURL = vi.fn(() => {
    this.snapshots.push([this.width, this.height]);
    return `data:image/webp;base64,${Buffer.from(`mock ${this.snapshots.length}`).toString("base64")}`;
  });
}

export class MockVideo {
  crossOrigin = "";
  muted = false;
  defaultMuted = false;
  playsInline = false;
  loop = false;
  preload = "";
  src = "";
  readyState = 2;
  duration = 8;
  seeking = false;
  videoWidth = 64;
  videoHeight = 36;
  playbackRate = 1;
  paused = true;
  currentTime = 0;
  onloadeddata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  frame?: () => void;
  load = vi.fn();
  removeAttribute = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  requestVideoFrameCallback = vi.fn((callback: () => void) => {
    this.frame = callback;
    return 42;
  });
  cancelVideoFrameCallback = vi.fn();
}

export class MockImage {
  crossOrigin = "";
  decoding = "";
  src = "";
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  removeAttribute = vi.fn();
}

export class MockDocument {
  hidden = false;
  disabled = false;
  webgl1 = false;
  canvases: MockCanvas[] = [];
  videos: MockVideo[] = [];
  images: MockImage[] = [];
  contexts: ReturnType<typeof mockGL>[] = [];
  configureGL?: (context: ReturnType<typeof mockGL>) => void;
  createElement(tag: string) {
    if (tag === "canvas") {
      const canvas = new MockCanvas(this);
      this.canvases.push(canvas);
      return canvas;
    }
    if (tag === "video") {
      const video = new MockVideo();
      this.videos.push(video);
      return video;
    }
    if (tag === "img") {
      const image = new MockImage();
      this.images.push(image);
      return image;
    }
    throw new Error(`Unexpected mock element ${tag}`);
  }
}

export const deck = (assetId: string): Deck => ({
  assetId,
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
export const state = (assetId: string): RenderState => ({
  time: 6,
  beat: 12,
  bpm: 120,
  playing: true,
  decks: [deck(assetId)],
  crossfade: 0,
  master: 1,
  blackout: false,
  freeze: false,
  fx: { glitch: 0, bloom: 0, vignette: 0, chromatic: 0, pixelate: 0 },
  lyric: "",
  lyricProgress: 0,
  lyricStyle: {
    enabled: false,
    size: 64,
    position: 0.77,
    color: "#fff",
    align: "center",
    mode: "line",
    shadow: true,
  },
  audio: { low: 0, mid: 0, high: 0, level: 0 },
  width: 240,
  height: 135,
});
