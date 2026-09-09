import type {
  Asset,
  Deck,
  RenderState,
  RenderStats,
  VisualKind,
} from "./types";

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Program = {
  handle: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
};
type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};
type Media = {
  asset: Asset;
  element: HTMLVideoElement | HTMLImageElement;
  texture: WebGLTexture;
  width: number;
  height: number;
  uploaded: boolean;
  dirty: boolean;
  failed: boolean;
  dead: boolean;
  frameCallback: number | null;
  uploadedTime: number;
  lastSeek: number;
  lastClock: number;
  lastSync: number;
  lastPlaying: boolean;
  playPending: boolean;
  retryPlayAt: number;
  staging?: HTMLCanvasElement;
  stagingContext?: CanvasRenderingContext2D;
};
type Glyph = { text: string; index: number; width: number };
type LyricLine = { glyphs: Glyph[]; width: number };
type LyricLayout = {
  lines: LyricLine[];
  count: number;
  font: string;
  size: number;
  padding: number;
  lineHeight: number;
};

export interface RendererOptions {
  /** Host render cadence, used only for diagnostics; render() does not throttle. */
  targetFps?: number;
  /** Live outputs precompile shaders. Batch thumbnails compile only as needed. */
  precompile?: boolean;
}

const MAX_PIXELS = 1920 * 1080;
const finite = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const clamp = (v: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, finite(v, low)));
const modulo = (v: number, n: number) => ((v % n) + n) % n;
const blendNumber = (blend: Deck["blend"]) =>
  ["normal", "screen", "add", "multiply", "difference"].indexOf(blend);
const VERTEX = `attribute vec2 aPosition;
varying vec2 vUV;
void main() { vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const COMMON = `
varying vec2 vUV;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
float hash21(vec2 p) {
  // Small intermediate values also work on WebGL1 mediump fragment hardware.
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x),
             mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p) {
  return 0.57*noise2(p) + 0.28*noise2(p*2.03+7.1) + 0.15*noise2(p*4.11+13.7);
}
mat2 rotate2(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);
  return c.z * mix(vec3(1), clamp(p-1.0,0.0,1.0), c.y);
}
vec3 grade(vec3 c, vec3 controls) {
  float a=controls.x*TAU, co=cos(a), si=sin(a);
  vec3 axis=vec3(0.577350269);
  c=c*co+cross(axis,c)*si+axis*dot(axis,c)*(1.0-co);
  c=mix(vec3(dot(c,vec3(0.2126,0.7152,0.0722))),c,controls.y);
  return max(vec3(0),c*controls.z);
}
`;

const PROCEDURAL = `
uniform float uAspect, uTime, uBeat, uSeed, uVariant, uHue, uEnergy, uPixel;
uniform vec4 uTransform, uAudio;
uniform vec3 uColor;
vec3 palette(float t) {
  float saturation = mix(0.84, 0.32, step(6.5,uVariant));
  vec3 a=hsv(vec3(fract(uHue),saturation,1.0));
  vec3 b=hsv(vec3(fract(uHue+0.15+0.025*uVariant),saturation,1.0));
  return mix(a,b,0.5+0.5*sin(t*TAU));
}
float stroke(float d, float width) { return 1.0-smoothstep(width,width+uPixel*1.6,abs(d)); }
void main() {
  vec2 p=(vUV-0.5)*vec2(uAspect,1.0);
  p=rotate2(uTransform.y)*p/max(0.08,uTransform.x);
  p.x*=uTransform.z;
  p=rotate2(uVariant*0.19)*p;
  p*=0.85+uVariant*0.065;
  p+=vec2(sin(uSeed*1.71),cos(uSeed*2.13))*0.045*uVariant;
  float t=uTime, v=uVariant;
  float pulse=exp(-fract(uBeat)*5.0)*(0.04+uEnergy*0.08)+uAudio.x*0.15;
  vec3 color=vec3(0);
  /* FAMILY */
  color*=0.85+uEnergy*0.3;
  gl_FragColor=vec4(clamp(grade(color,uColor),0.0,1.0),1.0);
}`;

const FAMILIES: Record<VisualKind, string> = {
  tunnel: `
    float r=max(length(p),0.015), a=atan(p.y,p.x);
    float depth=-log(r), travel=depth*3.4-t*1.2;
    float ribs=stroke(sin(a*(5.0+v)+depth*(0.7+v*0.12)+t*0.15),0.035/r);
    float hoops=pow(0.5+0.5*cos(travel*TAU),18.0);
    float fade=smoothstep(0.02,0.16,r)*(1.0-smoothstep(0.8,1.5,r));
    color=palette(depth*0.22+a*0.1)*(ribs*0.6+hoops*0.6+0.035)*fade;
    color+=palette(0.7)*exp(-r*18.0)*(0.4+pulse);`,
  waves: `
    for(int i=0;i<4;i++) {
      float f=float(i), x=p.x*(2.2+v*0.22);
      float y=sin(x+t*0.45+f*1.3)*0.12+sin(x*1.7-t*0.31+f)*0.055+(f-1.5)*0.105;
      float d=abs(p.y-y), thickness=0.015+0.008*sin(x+f+t*0.2);
      color+=palette(f*0.24+p.x*0.13)*(exp(-d*25.0)*0.20+stroke(d-thickness,0.006)*(0.7+pulse));
    }
    color+=palette(0.3)*(0.025+0.04*(p.y+0.5));`,
  particles: `
    for(int i=0;i<12;i++) {
      float f=float(i), h=hash21(vec2(f+uSeed,3.1)), phase=t*(0.12+h*0.25)+h*TAU;
      vec2 q=vec2(sin(phase+f)*uAspect*0.44,cos(phase*0.73+f*2.4)*0.43);
      float r=0.008+h*0.026+v*0.001;
      float d=length(p-q), core=1.0-smoothstep(r*0.65,r+uPixel,d);
      float glow=r*r/(d*d+r*r);
      color+=palette(h+t*0.025)*(core*0.48+glow*(0.22+pulse));
      color+=palette(h+0.2)*stroke(d-r*1.8,0.0015)*0.12;
    }
    color+=palette(p.y)*0.018;`,
  grid: `
    float horizon=p.y+0.10, floorMask=1.0-smoothstep(-0.025,0.02,horizon);
    float z=0.19/max(0.035,-horizon), x=p.x*z;
    vec2 g=abs(fract(vec2(x*(3.0+v*0.25),z-t*0.65))-0.5);
    float line=1.0-smoothstep(0.015,0.035+z*uPixel*2.0,min(g.x,g.y));
    color=palette(z*0.07)*(line*0.8+0.03)*floorMask/(1.0+z*0.12);
    color+=palette(0.35)*exp(-abs(horizon)*14.0)*(0.25+pulse);
    float sun=length((p-vec2(0.18*sin(v),0.17))*vec2(1,1.15));
    color+=palette(0.75)*(1.0-smoothstep(0.115,0.12,sun))*smoothstep(-0.03,0.03,horizon)*0.55;`,
  rings: `
    for(int i=0;i<5;i++) {
      float f=float(i), phase=t*0.4+f*1.2566;
      vec2 center=vec2(cos(phase),sin(phase*0.81))*(0.035+v*0.011);
      float radius=0.09+f*0.075+0.016*sin(t+f)+pulse*0.03;
      float d=abs(length(p-center)-radius);
      color+=palette(f*0.17)*(stroke(d,0.003+v*0.0007)*0.9+exp(-d*70.0)*0.18);
    }
    color+=palette(length(p))*exp(-length(p)*5.0)*0.035;`,
  plasma: `
    vec2 q=p*(4.0+v*0.4);
    float field=sin(q.x+t*0.43)+sin(q.y*1.35-t*0.52)+sin((q.x+q.y)*0.7+t*0.27);
    field+=sin(length(q+vec2(sin(t*0.21),cos(t*0.19)))*2.0-t*0.7);
    float bands=0.5+0.5*sin(field*1.9+t*0.15);
    color=palette(field*0.13)*(0.08+0.68*pow(bands,1.7));
    color+=vec3(0.65,0.8,1.0)*pow(bands,22.0)*(0.22+pulse);`,
  kaleido: `
    float sectors=5.0+v, sector=TAU/sectors;
    float a=abs(mod(atan(p.y,p.x)+t*0.075+sector*0.5,sector)-sector*0.5);
    vec2 q=vec2(cos(a),sin(a))*length(p);
    float lattice=sin(q.x*(20.0+v)-t*0.7)*sin(q.y*32.0+t*0.41);
    float facets=pow(1.0-abs(lattice),10.0);
    float radial=0.5+0.5*cos(length(p)*24.0-t);
    color=palette(q.x*1.5+q.y*2.0)*(facets*(0.65+pulse)+radial*0.12);
    color*=1.0-smoothstep(0.55,1.1,length(p));`,
  noise: `
    vec2 q=p*(3.0+v*0.25)+vec2(t*0.07,-t*0.035);
    float warp=fbm(q+uSeed*0.31);
    float field=fbm(q+vec2(warp*2.5,warp*1.5)+t*0.03);
    float veins=pow(0.5+0.5*sin(field*32.0+warp*5.0),12.0);
    color=palette(field+warp*0.4)*(0.10+field*0.28+veins*(0.42+pulse));`,
  aurora: `
    color=palette(0.8)*(0.015+0.025*(p.y+0.5));
    for(int i=0;i<4;i++) {
      float f=float(i), x=p.x*(2.0+v*0.2)+f*0.71;
      float curve=sin(x+t*0.2+f)*0.10+noise2(vec2(x*1.5,t*0.12+f))*0.18;
      float d=p.y-curve+(f-1.5)*0.065;
      float veil=exp(-abs(d)*mix(9.0,24.0,step(0.0,d)));
      float threads=0.55+0.45*sin(x*36.0+noise2(vec2(x*3.0,t*0.2))*5.0);
      color+=palette(f*0.14+x*0.04)*veil*threads*(0.24+pulse);
    }`,
  bars: `
    float count=14.0+v*2.0, column=floor((p.x+1.7)*count);
    float h=hash21(vec2(column,uSeed));
    float level=0.07+0.26*(0.5+0.5*sin(t*(0.6+h)+column*1.7));
    level+=(uAudio.x*(1.0-h)+uAudio.z*h)*0.18+pulse*0.2;
    float edge=abs(fract((p.x+1.7)*count)-0.5);
    float bar=(1.0-smoothstep(0.34,0.40,edge))*(1.0-smoothstep(level,level+0.008,abs(p.y)));
    float segments=0.68+0.32*smoothstep(0.06,0.17,fract(abs(p.y)*42.0));
    color=palette(h*0.45+p.y*0.7)*(bar*segments*0.8+exp(-abs(p.y)*40.0)*0.09);`,
  terrain: `
    float ground=0.52-p.y, z=0.45/max(ground,0.09);
    vec2 q=vec2(p.x*z,z+t*0.22)*(2.5+v*0.15);
    float heightField=fbm(q+uSeed*0.17);
    float contours=abs(fract(heightField*12.0)-0.5);
    float ink=1.0-smoothstep(0.025,0.08+z*uPixel,contours);
    float ridge=pow(heightField,2.0);
    color=palette(heightField*0.8+z*0.04)*(ink*0.6+ridge*0.27+0.025)/(1.0+z*0.15);
    color*=smoothstep(0.0,0.18,ground);
    color+=palette(0.65)*exp(-abs(p.y-0.39)*18.0)*(0.12+pulse*0.4);`,
  vortex: `
    float r=max(length(p),0.005), a=atan(p.y,p.x);
    float spiral=a*(3.0+v)+log(r+0.08)*(8.0+v)-t*1.2;
    float arm=pow(0.5+0.5*sin(spiral),8.0);
    float dust=0.65+0.35*sin(r*75.0-t*1.5+a*3.0);
    color=palette(r*0.7+sin(spiral)*0.12)*(arm*dust*(0.8+pulse)+0.025);
    color*=smoothstep(0.02,0.12,r)*(1.0-smoothstep(0.65,1.15,r));
    color+=palette(0.8)*exp(-r*24.0)*0.55;`,
};

const PROCEDURAL_SOURCES = Object.fromEntries(
  Object.entries(FAMILIES).map(([kind, body]) => [
    kind,
    COMMON + PROCEDURAL.replace("/* FAMILY */", body),
  ]),
) as Record<VisualKind, string>;

const MEDIA = `${COMMON}
uniform sampler2D uTexture;
uniform float uAspect, uMediaAspect;
uniform vec4 uTransform;
uniform vec3 uColor;
void main() {
  vec2 p=(vUV-0.5)*vec2(uAspect,1.0);
  p=rotate2(uTransform.y)*p/max(0.08,uTransform.x); p.x*=uTransform.z;
  float cover=max(1.0,uAspect/uMediaAspect);
  vec2 uv=p/vec2(uMediaAspect*cover,cover)+0.5;
  if(any(lessThan(uv,vec2(0))) || any(greaterThan(uv,vec2(1)))) { gl_FragColor=vec4(0); return; }
  vec4 c=texture2D(uTexture,uv); gl_FragColor=vec4(grade(c.rgb,uColor),c.a);
}`;
const MIX = `${COMMON}
uniform sampler2D uA, uB, uOverlay;
uniform vec3 uOpacity, uBlend;
uniform float uCrossfade, uHasOverlay;
vec3 blend(vec3 a, vec3 b, float mode) {
  if(mode<0.5) return b;
  if(mode<1.5) return 1.0-(1.0-a)*(1.0-b);
  if(mode<2.5) return min(a+b,1.0);
  if(mode<3.5) return a*b;
  return abs(a-b);
}
void main() {
  vec4 a=texture2D(uA,vUV), b=texture2D(uB,vUV);
  vec3 base=a.rgb*a.a*uOpacity.x;
  vec3 incoming=b.rgb*b.a*uOpacity.y;
  // Endpoint-preserving crossfade: the selected blend reaches full strength at
  // the midpoint and fades out at either solo endpoint. B takes precedence.
  float mode=uBlend.y>0.5 ? uBlend.y : uBlend.x;
  vec3 color=mix(base,incoming,uCrossfade);
  if(mode>0.5) color=mix(color,blend(base,incoming,mode),4.0*uCrossfade*(1.0-uCrossfade));
  if(uHasOverlay>0.5) {
    vec4 o=texture2D(uOverlay,vUV);
    color=mix(color,blend(color,o.rgb,uBlend.z),o.a*uOpacity.z);
  }
  gl_FragColor=vec4(color,1);
}`;
const BLOOM_EXTRACT = `${COMMON}
uniform sampler2D uTexture;
uniform vec2 uTexel;
void main() {
  vec3 c=(texture2D(uTexture,vUV+uTexel*vec2(-1,-1)).rgb+
          texture2D(uTexture,vUV+uTexel*vec2(1,-1)).rgb+
          texture2D(uTexture,vUV+uTexel*vec2(-1,1)).rgb+
          texture2D(uTexture,vUV+uTexel*vec2(1,1)).rgb)*0.25;
  float light=max(c.r,max(c.g,c.b));
  gl_FragColor=vec4(c*smoothstep(0.45,0.9,light),1);
}`;
const BLUR = `${COMMON}
uniform sampler2D uTexture;
uniform vec2 uDirection;
void main() {
  vec3 c=texture2D(uTexture,vUV).rgb*0.227027;
  c+=(texture2D(uTexture,vUV+uDirection*1.384615).rgb+texture2D(uTexture,vUV-uDirection*1.384615).rgb)*0.316216;
  c+=(texture2D(uTexture,vUV+uDirection*3.230769).rgb+texture2D(uTexture,vUV-uDirection*3.230769).rgb)*0.070270;
  gl_FragColor=vec4(c,1);
}`;
const FINAL = `${COMMON}
uniform sampler2D uScene, uBloom, uLyric;
uniform vec2 uResolution;
uniform vec4 uFX, uLyricRect;
uniform float uPixelate, uTime, uMaster, uHasLyric;
void main() {
  vec2 uv=vUV;
  if(uPixelate>0.001) {
    vec2 cells=uResolution/max(1.0,uPixelate*48.0);
    uv=(floor(uv*cells)+0.5)/cells;
  }
  if(uFX.x>0.001) {
    float tick=floor(uTime*12.0), row=floor(uv.y*32.0);
    float gate=step(1.0-uFX.x*0.32,hash21(vec2(tick,row)));
    uv.x+=(hash21(vec2(row,tick+2.0))-0.5)*uFX.x*0.24*gate;
  }
  vec3 c;
  if(uFX.w>0.001) {
    vec2 shift=(uv-0.5)*uFX.w*0.022;
    c=vec3(texture2D(uScene,uv+shift).r,texture2D(uScene,uv).g,texture2D(uScene,uv-shift).b);
  } else c=texture2D(uScene,uv).rgb;
  if(uFX.y>0.001) c+=texture2D(uBloom,uv).rgb*uFX.y*0.85;
  float vignette=smoothstep(0.15,0.72,length(vUV-0.5));
  c*=1.0-vignette*uFX.z*0.95;
  // Lyrics are composed after every visual effect, before the master dimmer.
  if(uHasLyric>0.5) {
    vec2 luv=(vUV-uLyricRect.xy)/uLyricRect.zw;
    if(all(greaterThanEqual(luv,vec2(0))) && all(lessThanEqual(luv,vec2(1)))) {
      vec4 lyric=texture2D(uLyric,luv); c=mix(c,lyric.rgb,lyric.a);
    }
  }
  gl_FragColor=vec4(clamp(c*uMaster,0.0,1.0),1);
}`;
const PRESENT = `varying vec2 vUV; uniform sampler2D uTexture;
void main() { gl_FragColor=texture2D(uTexture,vUV); }`;

/**
 * Call render from the host's RAF. time is seconds, beat is an absolute beat count.
 * width/height select internal pixels (aspect-preserving cap: 1080p); use CSS to
 * size the output. Hue/rotation are degrees, gain/saturation/opacity/FX are 0..1
 * (gain/saturation may exceed 1). Lyrics use pixels at 1080p and a normalized or
 * percentage vertical position. A/B blends affect their overlap (B takes
 * precedence); solo crossfade endpoints are exact. Slot 2 is composited above
 * both with conventional alpha blending. Further decks are intentionally ignored.
 */
export class VJRenderer {
  private gl: GL | null = null;
  private webgl2 = false;
  private ready = false;
  private lost = false;
  private disposed = false;
  private assets = new Map<string, Asset>();
  private deckAssetIds: string[] = [];
  private programs = new Map<string, Program>();
  private triangle: WebGLBuffer | null = null;
  private transparent: WebGLTexture | null = null;
  private lyricTexture: WebGLTexture | null = null;
  private layers: Target[] = [];
  private scene: Target | null = null;
  private output: Target | null = null;
  private bloom: Target[] = [];
  private media = new Map<number, Media>();
  private width = 0;
  private height = 0;
  private maxDimension = 4096;
  private hasFrame = false;
  private frozen: { pixels: Uint8Array; width: number; height: number } | null =
    null;
  private lyricCanvas: HTMLCanvasElement;
  private lyricContext: CanvasRenderingContext2D | null;
  private lyricLayout: LyricLayout | null = null;
  private lyricLayoutKey = "";
  private lyricPaintKey = "";
  private lyricTextureWidth = 0;
  private lyricTextureHeight = 0;
  private lyricRect = [0, 0, 1, 1];
  private stats: RenderStats = { fps: 0, dropped: 0, mediaErrors: [] };
  private targetFps = 30;
  private frameTime: number | null = null;
  private sampleStart: number | null = null;
  private sampleFrames = 0;
  private measuringPlayback = false;

  constructor(
    private canvas: HTMLCanvasElement,
    assets: Asset[],
    private options: RendererOptions = {},
  ) {
    this.lyricCanvas = canvas.ownerDocument.createElement("canvas");
    this.lyricContext = this.lyricCanvas.getContext("2d");
    this.setAssets(assets);
    this.setTargetFps(options.targetFps ?? 30);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    const contextOptions: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    };
    try {
      this.gl = canvas.getContext("webgl2", contextOptions);
      this.webgl2 = !!this.gl;
      if (!this.gl) this.gl = canvas.getContext("webgl", contextOptions);
      if (!this.gl) {
        this.report("WebGL is unavailable on this canvas/device.");
        return;
      }
      this.initialize();
    } catch (error) {
      this.report(`WebGL initialization: ${this.message(error)}`);
      this.destroyResources();
    }
  }

  setAssets(assets: Asset[]): void {
    if (this.disposed) return;
    this.assets = new Map(
      assets.map((asset) => [asset.id, { ...asset, tags: [...asset.tags] }]),
    );
    // An asset can arrive after a saved deck or an output state message.
    // Retain unresolved faults, but retire missing-asset diagnostics on recovery.
    const missingPrefix = "Missing asset: ";
    this.stats.mediaErrors = this.stats.mediaErrors.filter(
      (message) =>
        !message.startsWith(missingPrefix) ||
        !this.assets.has(message.slice(missingPrefix.length)),
    );
    for (const [slot, media] of this.media) {
      const asset = this.assets.get(media.asset.id);
      if (
        !asset ||
        asset.url !== media.asset.url ||
        asset.kind !== media.asset.kind
      )
        this.releaseMedia(slot);
      else media.asset = asset;
    }
  }

  getStats(): RenderStats {
    return { ...this.stats, mediaErrors: [...this.stats.mediaErrors] };
  }

  /**
   * Readiness of slot 0/1/2 from the most recent render(state). Call after the
   * host has rendered the new deck assignment at least once. This is a local
   * decode-readiness signal for fade gating, not an external-output handshake.
   * Off-air clips with positive opacity are preloaded by render().
   */
  isDeckReady(slot: number): boolean {
    if (
      this.disposed ||
      this.lost ||
      !this.ready ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 2
    )
      return false;
    const asset = this.assets.get(this.deckAssetIds[slot]);
    if (!asset) return false;
    if (asset.kind === "procedural")
      return Object.hasOwn(FAMILIES, asset.visual ?? "plasma");
    const media = this.media.get(slot);
    if (
      !media ||
      media.dead ||
      media.failed ||
      media.asset.id !== asset.id ||
      media.asset.url !== asset.url ||
      media.asset.kind !== asset.kind
    )
      return false;
    if (asset.kind === "video") {
      const video = media.element as HTMLVideoElement;
      return (
        !video.error &&
        video.readyState >= 2 &&
        !video.seeking &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      );
    }
    const image = media.element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }

  /** Call when the host changes its frame cap, on both Console and Output. */
  setTargetFps(fps: number): void {
    if (this.disposed || !Number.isFinite(fps) || fps <= 0) return;
    fps = clamp(fps, 1, 240);
    if (fps === this.targetFps) return;
    this.targetFps = fps;
    this.frameTime = this.sampleStart = null;
    this.sampleFrames = 0;
    this.measuringPlayback = false;
    this.stats.fps = 0;
  }

  render(state: RenderState): void {
    if (this.disposed) return;
    this.deckAssetIds = state.decks.slice(0, 3).map((deck) => deck.assetId);
    const now = performance.now();
    this.measure(
      now,
      state.playing &&
        !state.freeze &&
        !state.blackout &&
        !this.canvas.ownerDocument.hidden &&
        this.ready &&
        !this.lost,
    );
    if (!this.gl || this.lost || !this.ready) return;
    try {
      const decks = state.decks.slice(0, 3);
      // Retire removed clips even while holding a frozen/black frame, without
      // starting new decoders until the output is active again.
      this.reconcileMedia(decks, !state.freeze && !state.blackout);
      if (!state.freeze) this.frozen = null;
      // Read back exactly once on entering freeze, so even context restoration can
      // recover the actual pixels. No readbacks occur in the normal render loop.
      if (state.freeze && this.hasFrame && !this.frozen && this.output)
        this.captureFreeze();
      if (state.blackout) {
        this.pauseMedia();
        this.clearScreen();
        return;
      }
      if (state.freeze && this.hasFrame) {
        this.pauseMedia();
        this.present();
        return;
      }
      if (state.freeze && this.frozen) {
        this.resize(this.frozen.width, this.frozen.height);
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.output!.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          this.width,
          this.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.frozen.pixels,
        );
        this.hasFrame = true;
        this.pauseMedia();
        this.present();
        return;
      }
      const size = this.dimensions(state.width, state.height);
      this.resize(size[0], size[1]);
      const crossfade = clamp(state.crossfade);
      // A first-ever frozen frame still needs its selected media initialized.
      if (state.freeze) this.reconcileMedia(decks);
      const overlay =
        !!decks[2] &&
        clamp(decks[2].opacity) > 0 &&
        this.assets.has(decks[2].assetId);
      if (overlay && this.layers.length < 3)
        this.layers.push(this.createTarget(this.width, this.height));
      if (!overlay && this.layers.length > 2)
        this.deleteTarget(this.layers.pop()!);
      for (let slot = 0; slot < (overlay ? 3 : 2); slot++) {
        const visible =
          !!decks[slot] &&
          clamp(decks[slot].opacity) > 0 &&
          (slot === 2 || (slot === 0 ? crossfade < 1 : crossfade > 0));
        this.renderDeck(slot, decks[slot], state, now, visible);
      }
      this.compose(decks, crossfade, overlay);
      const bloom = clamp(state.fx.bloom);
      if (bloom > 0.001) this.renderBloom();
      const hasLyric = this.updateLyric(state);
      const program = this.use("final", FINAL, this.output);
      this.texture(program, "uScene", this.scene!.texture, 0);
      this.texture(
        program,
        "uBloom",
        bloom > 0.001 ? this.bloom[0].texture : this.transparent!,
        1,
      );
      this.texture(program, "uLyric", this.lyricTexture!, 2);
      this.v2(program, "uResolution", this.width, this.height);
      this.v4(
        program,
        "uFX",
        clamp(state.fx.glitch),
        bloom,
        clamp(state.fx.vignette),
        clamp(state.fx.chromatic),
      );
      this.v4(
        program,
        "uLyricRect",
        ...(this.lyricRect as [number, number, number, number]),
      );
      this.f(program, "uPixelate", clamp(state.fx.pixelate));
      this.f(program, "uTime", modulo(finite(state.time), 3600));
      this.f(program, "uMaster", clamp(state.master, 0, 4));
      this.f(program, "uHasLyric", hasLyric ? 1 : 0);
      this.draw();
      this.hasFrame = true;
      if (state.freeze) {
        this.captureFreeze();
        this.pauseMedia();
      }
      this.present();
    } catch (error) {
      this.report(`Render: ${this.message(error)}`);
      this.pauseMedia();
      this.clearScreen();
    }
  }

  /** loseContext is for throwaway canvases, never canvases a host will reuse. */
  dispose({ loseContext = false }: { loseContext?: boolean } = {}): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.destroyResources(this.lost);
    this.frozen = null;
    this.assets.clear();
    this.deckAssetIds = [];
    this.lyricCanvas.width = this.lyricCanvas.height = 1;
    this.lyricLayout = null;
    if (loseContext && !this.lost)
      this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  private report(message: string): void {
    message = message.slice(0, 350);
    if (!this.stats.mediaErrors.includes(message)) {
      this.stats.mediaErrors.push(message);
      if (this.stats.mediaErrors.length > 16) this.stats.mediaErrors.shift();
    }
  }
  private measure(now: number, playing: boolean): void {
    const interval = this.frameTime === null ? 0 : now - this.frameTime;
    if (this.sampleStart === null || interval < 0 || interval >= 1000) {
      // A resumed/backgrounded tab starts a new sample, not a burst of late frames.
      this.sampleStart = now;
      this.sampleFrames = 0;
    } else {
      this.sampleFrames++;
      if (playing && this.measuringPlayback) {
        // Estimated missed host render intervals, not GPU/decoder frame counts.
        this.stats.dropped += Math.max(
          0,
          Math.round((interval * this.targetFps) / 1000) - 1,
        );
      }
    }
    this.frameTime = now;
    this.measuringPlayback = playing;
    const elapsed = now - this.sampleStart;
    if (elapsed >= 500) {
      this.stats.fps = Math.round((this.sampleFrames * 10000) / elapsed) / 10;
      this.sampleFrames = 0;
      this.sampleStart = now;
    }
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.ready = false;
    this.hasFrame = false;
    this.pauseMedia();
    this.report(
      "WebGL context lost; output will recover when the browser restores it.",
    );
  };
  private onContextRestored = (): void => {
    if (this.disposed) return;
    this.lost = false;
    // Objects from the lost context are already destroyed. Deleting those stale
    // handles in the restored context generates INVALID_OPERATION on some GPUs.
    this.destroyResources(true);
    try {
      this.initialize();
    } catch (error) {
      this.report(`WebGL restoration: ${this.message(error)}`);
      this.destroyResources();
    }
  };
  private initialize(): void {
    const gl = this.gl!;
    this.maxDimension = Math.min(
      4096,
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    );
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.triangle = gl.createBuffer();
    if (!this.triangle)
      throw new Error("Could not allocate the screen triangle.");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triangle);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    this.transparent = this.createTexture();
    this.lyricTexture = this.createTexture();
    if (this.options.precompile !== false) {
      for (const [name, source] of [
        ["media", MEDIA],
        ["mix", MIX],
        ["final", FINAL],
        ["present", PRESENT],
        ["extract", BLOOM_EXTRACT],
        ["blur", BLUR],
      ]) {
        this.program(name, source);
      }
      // Compile before the first cue, avoiding shader compilation on live cuts.
      for (const [name, source] of Object.entries(PROCEDURAL_SOURCES))
        this.program(name, source);
    }
    this.ready = true;
  }
  private destroyResources(contextInvalid = false): void {
    for (const slot of [...this.media.keys()])
      this.releaseMedia(slot, !contextInvalid);
    const gl = this.gl;
    if (gl && !contextInvalid) {
      gl.useProgram(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disableVertexAttribArray(0);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      for (const target of [...this.layers, ...this.bloom])
        this.deleteTarget(target);
      if (this.scene) this.deleteTarget(this.scene);
      if (this.output) this.deleteTarget(this.output);
      for (const program of this.programs.values())
        gl.deleteProgram(program.handle);
      if (this.triangle) gl.deleteBuffer(this.triangle);
      if (this.transparent) gl.deleteTexture(this.transparent);
      if (this.lyricTexture) gl.deleteTexture(this.lyricTexture);
    }
    this.programs.clear();
    this.layers = [];
    this.bloom = [];
    this.scene = this.output = null;
    this.triangle = null;
    this.transparent = this.lyricTexture = null;
    this.width = this.height = 0;
    this.hasFrame = false;
    this.ready = false;
    this.lyricTextureWidth = this.lyricTextureHeight = 0;
    this.lyricLayoutKey = this.lyricPaintKey = "";
  }

  private program(name: string, source: string): Program {
    const cached = this.programs.get(name);
    if (cached) return cached;
    const gl = this.gl!;
    const precision = gl.getShaderPrecisionFormat(
      gl.FRAGMENT_SHADER,
      gl.HIGH_FLOAT,
    )?.precision
      ? "highp"
      : "mediump";
    let vertex = VERTEX,
      fragment = `precision ${precision} float;\n${source}`;
    if (this.webgl2) {
      vertex =
        "#version 300 es\n" +
        vertex.replace(/attribute/g, "in").replace(/varying/g, "out");
      fragment =
        "#version 300 es\n" +
        fragment
          .replace("varying vec2 vUV;", "in vec2 vUV;\nout vec4 fragColor;")
          .replace(/texture2D/g, "texture")
          .replace(/gl_FragColor/g, "fragColor");
    }
    const shaders: WebGLShader[] = [];
    let handle: WebGLProgram | null = null;
    try {
      for (const [type, code] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error(`Could not allocate ${name} shader.`);
        shaders.push(shader);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(`${name}: ${gl.getShaderInfoLog(shader)}`);
      }
      handle = gl.createProgram();
      if (!handle) throw new Error(`Could not allocate ${name} program.`);
      for (const shader of shaders) gl.attachShader(handle, shader);
      gl.bindAttribLocation(handle, 0, "aPosition");
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS))
        throw new Error(`${name}: ${gl.getProgramInfoLog(handle)}`);
      const program = {
        handle,
        uniforms: new Map<string, WebGLUniformLocation | null>(),
      };
      this.programs.set(name, program);
      return program;
    } catch (error) {
      if (handle) gl.deleteProgram(handle);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  private use(name: string, source: string, target: Target | null): Program {
    const gl = this.gl!,
      program = this.program(name, source);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(
      0,
      0,
      target?.width ?? this.canvas.width,
      target?.height ?? this.canvas.height,
    );
    gl.useProgram(program.handle);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triangle);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return program;
  }
  private uniform(program: Program, name: string): WebGLUniformLocation | null {
    if (!program.uniforms.has(name))
      program.uniforms.set(
        name,
        this.gl!.getUniformLocation(program.handle, name),
      );
    return program.uniforms.get(name)!;
  }
  private f(p: Program, n: string, a: number): void {
    this.gl!.uniform1f(this.uniform(p, n), a);
  }
  private v2(p: Program, n: string, a: number, b: number): void {
    this.gl!.uniform2f(this.uniform(p, n), a, b);
  }
  private v3(p: Program, n: string, a: number, b: number, c: number): void {
    this.gl!.uniform3f(this.uniform(p, n), a, b, c);
  }
  private v4(
    p: Program,
    n: string,
    a: number,
    b: number,
    c: number,
    d: number,
  ): void {
    this.gl!.uniform4f(this.uniform(p, n), a, b, c, d);
  }
  private texture(
    p: Program,
    name: string,
    texture: WebGLTexture,
    unit: number,
  ): void {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(p, name), unit);
  }
  private draw(): void {
    this.gl!.drawArrays(this.gl!.TRIANGLES, 0, 3);
  }
  private createTexture(): WebGLTexture {
    const gl = this.gl!,
      texture = gl.createTexture();
    if (!texture) throw new Error("Could not allocate a texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(4),
    );
    return texture;
  }
  private createTarget(width: number, height: number): Target {
    const gl = this.gl!,
      texture = this.createTexture(),
      framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      gl.deleteTexture(texture);
      throw new Error("Could not allocate a framebuffer.");
    }
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(
        `Framebuffer allocation failed at ${width}×${height}; lower the internal resolution.`,
      );
    }
    return { texture, framebuffer, width, height };
  }
  private deleteTarget(target: Target): void {
    this.gl?.deleteFramebuffer(target.framebuffer);
    this.gl?.deleteTexture(target.texture);
  }
  private dimensions(width: number, height: number): [number, number] {
    width = clamp(width, 2, 16384);
    height = clamp(height, 2, 16384);
    const scale = Math.min(
      1,
      this.maxDimension / width,
      this.maxDimension / height,
      Math.sqrt(MAX_PIXELS / (width * height)),
    );
    return [
      Math.max(2, Math.floor(width * scale)),
      Math.max(2, Math.floor(height * scale)),
    ];
  }
  private resize(width: number, height: number): void {
    if (
      width === this.width &&
      height === this.height &&
      this.output &&
      this.scene &&
      this.layers.length >= 2
    ) {
      // Hosts occasionally resize the DOM canvas independently of RenderState.
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      return;
    }
    for (const target of [...this.layers, ...this.bloom])
      this.deleteTarget(target);
    if (this.scene) this.deleteTarget(this.scene);
    if (this.output) this.deleteTarget(this.output);
    this.layers = [];
    this.bloom = [];
    this.scene = this.output = null;
    this.hasFrame = false;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.layers.push(this.createTarget(width, height));
    this.layers.push(this.createTarget(width, height));
    this.scene = this.createTarget(width, height);
    this.output = this.createTarget(width, height);
    this.lyricLayoutKey = this.lyricPaintKey = "";
  }
  private clearScreen(): void {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  private present(): void {
    if (!this.output || !this.hasFrame) {
      this.clearScreen();
      return;
    }
    const program = this.use("present", PRESENT, null);
    this.texture(program, "uTexture", this.output.texture, 0);
    this.draw();
  }
  private captureFreeze(): void {
    const gl = this.gl!,
      output = this.output!;
    const pixels = new Uint8Array(output.width * output.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    gl.readPixels(
      0,
      0,
      output.width,
      output.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    this.frozen = { pixels, width: output.width, height: output.height };
  }

  private renderDeck(
    slot: number,
    deck: Deck | undefined,
    state: RenderState,
    now: number,
    visible: boolean,
  ): void {
    const gl = this.gl!,
      target = this.layers[slot],
      media = this.media.get(slot);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!visible || !deck) {
      if (media) this.pauseOne(media);
      return;
    }
    const asset = this.assets.get(deck.assetId);
    if (!asset) {
      this.report(`Missing asset: ${deck.assetId}`);
      return;
    }
    let program: Program;
    if (asset.kind === "procedural") {
      const visual = asset.visual ?? "plasma";
      if (!(visual in FAMILIES)) {
        this.report(`Unsupported procedural family: ${visual}`);
        return;
      }
      program = this.use(visual, PROCEDURAL_SOURCES[visual], target);
      const speed = clamp(deck.speed, -8, 8);
      const time = deck.beatSync
        ? (finite(state.beat) * 2) / clamp(deck.beats, 1, 128)
        : finite(state.time);
      this.f(program, "uTime", modulo(time * speed, 3600));
      this.f(program, "uBeat", modulo(finite(state.beat) * speed, 1024));
      const seed = modulo(Math.floor(finite(asset.seed ?? 0)), 4096);
      this.f(program, "uSeed", seed);
      this.f(program, "uVariant", seed % 8);
      this.f(program, "uHue", modulo(finite(asset.hue), 360) / 360);
      this.f(program, "uEnergy", clamp(asset.energy));
      this.f(program, "uPixel", 1 / this.height);
      this.v4(
        program,
        "uAudio",
        clamp(state.audio.low),
        clamp(state.audio.mid),
        clamp(state.audio.high),
        clamp(state.audio.level),
      );
    } else {
      if (!media || media.failed) return;
      this.updateMedia(media, deck, state, now);
      if (!media.uploaded) return;
      program = this.use("media", MEDIA, target);
      this.texture(program, "uTexture", media.texture, 0);
      this.f(program, "uMediaAspect", media.width / Math.max(1, media.height));
    }
    this.f(program, "uAspect", this.width / this.height);
    this.v4(
      program,
      "uTransform",
      clamp(deck.scale, 0.08, 12),
      (modulo(finite(deck.rotation), 360) * Math.PI) / 180,
      deck.mirror ? -1 : 1,
      0,
    );
    this.v3(
      program,
      "uColor",
      modulo(finite(deck.hue), 360) / 360,
      clamp(deck.saturation, 0, 3),
      clamp(deck.brightness, 0, 4),
    );
    this.draw();
  }
  private compose(decks: Deck[], crossfade: number, overlay: boolean): void {
    const p = this.use("mix", MIX, this.scene);
    this.texture(p, "uA", this.layers[0].texture, 0);
    this.texture(p, "uB", this.layers[1].texture, 1);
    this.texture(
      p,
      "uOverlay",
      overlay ? this.layers[2].texture : this.transparent!,
      2,
    );
    this.v3(
      p,
      "uOpacity",
      ...([0, 1, 2].map((i) => clamp(decks[i]?.opacity ?? 0)) as [
        number,
        number,
        number,
      ]),
    );
    this.v3(
      p,
      "uBlend",
      ...([0, 1, 2].map((i) =>
        Math.max(0, blendNumber(decks[i]?.blend ?? "normal")),
      ) as [number, number, number]),
    );
    this.f(p, "uCrossfade", crossfade);
    this.f(p, "uHasOverlay", overlay ? 1 : 0);
    this.draw();
  }
  private renderBloom(): void {
    const width = Math.max(2, Math.floor(this.width / 4)),
      height = Math.max(2, Math.floor(this.height / 4));
    while (this.bloom.length < 2)
      this.bloom.push(this.createTarget(width, height));
    let p = this.use("extract", BLOOM_EXTRACT, this.bloom[0]);
    this.texture(p, "uTexture", this.scene!.texture, 0);
    this.v2(p, "uTexel", 1 / this.width, 1 / this.height);
    this.draw();
    p = this.use("blur", BLUR, this.bloom[1]);
    this.texture(p, "uTexture", this.bloom[0].texture, 0);
    this.v2(p, "uDirection", 1 / width, 0);
    this.draw();
    p = this.use("blur", BLUR, this.bloom[0]);
    this.texture(p, "uTexture", this.bloom[1].texture, 0);
    this.v2(p, "uDirection", 0, 1 / height);
    this.draw();
  }

  private reconcileMedia(decks: Deck[], create = true): void {
    for (const [slot, media] of this.media) {
      const deck = decks[slot],
        asset = deck && this.assets.get(deck.assetId);
      if (
        !asset ||
        asset.kind === "procedural" ||
        asset.id !== media.asset.id ||
        asset.url !== media.asset.url ||
        clamp(deck.opacity) === 0
      )
        this.releaseMedia(slot);
    }
    if (!create) return;
    decks.forEach((deck, slot) => {
      const asset = this.assets.get(deck.assetId);
      if (
        asset &&
        asset.kind !== "procedural" &&
        clamp(deck.opacity) > 0 &&
        !this.media.has(slot)
      )
        this.createMedia(slot, asset);
    });
  }
  private createMedia(slot: number, asset: Asset): void {
    if (!asset.url) {
      this.report(`${asset.name}: no media URL.`);
      return;
    }
    const document = this.canvas.ownerDocument;
    const element =
      asset.kind === "video"
        ? document.createElement("video")
        : document.createElement("img");
    element.crossOrigin = "anonymous";
    const media: Media = {
      asset,
      element,
      texture: this.createTexture(),
      width: 0,
      height: 0,
      uploaded: false,
      dirty: true,
      failed: false,
      dead: false,
      frameCallback: null,
      uploadedTime: -1,
      lastSeek: -Infinity,
      lastClock: NaN,
      lastSync: 0,
      lastPlaying: false,
      playPending: false,
      retryPlayAt: 0,
    };
    this.media.set(slot, media);
    element.onerror = () => {
      if (media.dead) return;
      media.failed = true;
      this.pauseOne(media);
      const code =
        asset.kind === "video"
          ? (element as HTMLVideoElement).error?.code
          : undefined;
      this.report(
        `${asset.name}: media load/decode failed${code ? ` (code ${code})` : ""}. Check the URL, codec and CORS access.`,
      );
    };
    if (asset.kind === "video") {
      const video = element as HTMLVideoElement;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = "auto";
      video.onloadeddata = video.onseeked = () => {
        media.dirty = true;
      };
      video.src = asset.url;
      if (typeof video.requestVideoFrameCallback === "function") {
        const onFrame = () => {
          if (media.dead || media.failed) return;
          media.dirty = true;
          media.frameCallback = video.requestVideoFrameCallback(onFrame);
        };
        media.frameCallback = video.requestVideoFrameCallback(onFrame);
      }
      video.load();
    } else {
      const image = element as HTMLImageElement;
      image.decoding = "async";
      image.onload = () => {
        if (!media.dead) media.dirty = true;
      };
      image.src = asset.url;
    }
  }
  private pauseOne(media: Media): void {
    if (media.asset.kind !== "video") return;
    const video = media.element as HTMLVideoElement;
    if (!video.paused) video.pause();
    media.lastPlaying = false;
  }
  private pauseMedia(): void {
    for (const media of this.media.values()) this.pauseOne(media);
  }
  private releaseMedia(slot: number, releaseTexture = !this.lost): void {
    const media = this.media.get(slot);
    if (!media) return;
    media.dead = true;
    media.element.onerror = media.element.onload = null;
    if (media.asset.kind === "video") {
      const video = media.element as HTMLVideoElement;
      if (
        media.frameCallback !== null &&
        typeof video.cancelVideoFrameCallback === "function"
      )
        video.cancelVideoFrameCallback(media.frameCallback);
      video.onloadeddata = video.onseeked = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    } else media.element.removeAttribute("src");
    if (releaseTexture) this.gl?.deleteTexture(media.texture);
    if (media.staging) media.staging.width = media.staging.height = 1;
    this.media.delete(slot);
    // URL ownership belongs to the host: never revoke imported blob URLs here.
  }
  private updateMedia(
    media: Media,
    deck: Deck,
    state: RenderState,
    now: number,
  ): void {
    const element = media.element;
    let width: number, height: number;
    if (media.asset.kind === "video") {
      const video = element as HTMLVideoElement;
      this.syncVideo(media, video, deck, state, now);
      if (video.readyState < 2 || video.seeking || !video.videoWidth) return;
      if (
        media.frameCallback === null &&
        video.currentTime !== media.uploadedTime
      )
        media.dirty = true;
      width = video.videoWidth;
      height = video.videoHeight;
    } else {
      const image = element as HTMLImageElement;
      if (!image.complete || !image.naturalWidth) return;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    if (!media.dirty && media.uploaded) return;
    try {
      let source: TexImageSource = element;
      // Bound upload size for large photos/4K media; decoder cost still depends on
      // the source file. Ordinary <=1080p video uploads directly without a 2D copy.
      const scale = Math.min(
        1,
        this.maxDimension / width,
        this.maxDimension / height,
        Math.sqrt(MAX_PIXELS / (width * height)),
      );
      if (scale < 1) {
        if (!media.staging) {
          media.staging = this.canvas.ownerDocument.createElement("canvas");
          media.stagingContext = media.staging.getContext("2d") ?? undefined;
        }
        if (!media.stagingContext)
          throw new Error("Could not allocate media downsampling canvas.");
        width = Math.max(1, Math.floor(width * scale));
        height = Math.max(1, Math.floor(height * scale));
        if (media.staging.width !== width) media.staging.width = width;
        if (media.staging.height !== height) media.staging.height = height;
        media.stagingContext.clearRect(0, 0, width, height);
        media.stagingContext.drawImage(element, 0, 0, width, height);
        source = media.staging;
      }
      const gl = this.gl!;
      gl.bindTexture(gl.TEXTURE_2D, media.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      if (media.width !== width || media.height !== height || !media.uploaded)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        );
      else
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        );
      media.width = width;
      media.height = height;
      media.uploaded = true;
      media.dirty = false;
      if (media.asset.kind === "video")
        media.uploadedTime = (element as HTMLVideoElement).currentTime;
    } catch (error) {
      media.failed = true;
      this.pauseOne(media);
      this.report(
        `${media.asset.name}: texture/decode failed: ${this.message(error)}`,
      );
    }
  }
  private syncVideo(
    media: Media,
    video: HTMLVideoElement,
    deck: Deck,
    state: RenderState,
    now: number,
  ): void {
    // HTMLMediaElement has no portable reverse playback. Zero/negative media speed
    // holds frame zero; procedural shaders do support negative speed.
    const speed = clamp(deck.speed, 0, 8),
      duration = video.duration;
    let rate = speed,
      clock = finite(state.time) * speed;
    if (deck.beatSync) {
      const beats = clamp(deck.beats || media.asset.beats || 4, 1, 128);
      const secondsPerBeat =
        Number.isFinite(duration) && duration > 0
          ? duration / beats
          : 60 / clamp(media.asset.bpm ?? 120, 20, 400);
      clock = finite(state.beat) * secondsPerBeat * speed;
      rate = (clamp(state.bpm, 20, 400) / 60) * secondsPerBeat * speed;
    }
    const playing =
      state.playing && speed > 0 && !state.freeze && !state.blackout;
    const playbackRate = clamp(rate, 0.0625, 16);
    if (Math.abs(video.playbackRate - playbackRate) > 0.001) {
      try {
        video.playbackRate = playbackRate;
      } catch (error) {
        this.report(
          `${media.asset.name}: playback rate rejected: ${this.message(error)}`,
        );
      }
    }
    if (
      video.readyState >= 1 &&
      Number.isFinite(duration) &&
      duration > 0 &&
      !video.seeking
    ) {
      const target = Math.min(
        modulo(clock, duration),
        Math.max(0, duration - 0.001),
      );
      const drift = Math.abs(
        modulo(video.currentTime - target + duration / 2, duration) -
          duration / 2,
      );
      const jump =
        Number.isFinite(media.lastClock) &&
        Math.abs(clock - media.lastClock) >
          Math.max(0.75, ((now - media.lastSync) / 1000) * playbackRate + 0.3);
      const initial = !Number.isFinite(media.lastClock);
      const resumed = playing && !media.lastPlaying;
      const due = now - media.lastSeek > (playing ? 1200 : 80);
      if (
        drift > (playing ? 0.28 : 1 / 30) &&
        (initial || jump || resumed || due)
      ) {
        try {
          video.currentTime = target;
          media.dirty = true;
          media.lastSeek = now;
        } catch (error) {
          this.report(
            `${media.asset.name}: seek failed: ${this.message(error)}`,
          );
          media.lastSeek = now;
        }
      }
    }
    media.lastClock = clock;
    media.lastSync = now;
    if (!playing) this.pauseOne(media);
    else if (video.paused && !media.playPending && now >= media.retryPlayAt) {
      media.playPending = true;
      try {
        Promise.resolve(video.play()).then(
          () => {
            media.playPending = false;
            if (media.dead || !media.lastPlaying || this.lost || this.disposed)
              video.pause();
          },
          (error) => {
            media.playPending = false;
            if (media.dead || !media.lastPlaying) return;
            media.retryPlayAt = performance.now() + 3000;
            this.report(
              `${media.asset.name}: playback could not start (${this.message(error)}). Retrying after a user gesture / 3 seconds.`,
            );
          },
        );
      } catch (error) {
        media.playPending = false;
        media.retryPlayAt = now + 3000;
        this.report(
          `${media.asset.name}: playback could not start: ${this.message(error)}`,
        );
      }
    }
    media.lastPlaying = playing;
  }

  private graphemes(text: string): string[] {
    if (typeof Intl.Segmenter === "function")
      return [
        ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text),
      ].map((item) => item.segment);
    // Keep combining marks, variation selectors and ZWJ sequences together on older browsers.
    const result: string[] = [];
    for (const char of Array.from(text)) {
      if (
        result.length &&
        (/\p{Mark}|[\uFE0E\uFE0F\u200D]/u.test(char) ||
          result[result.length - 1].endsWith("\u200D"))
      )
        result[result.length - 1] += char;
      else result.push(char);
    }
    return result;
  }
  private layoutLyrics(
    text: string,
    size: number,
    maxWidth: number,
    maxHeight: number,
  ): LyricLayout {
    const ctx = this.lyricContext!;
    const graphemes = this.graphemes(text.replace(/\r\n?/g, "\n")).slice(
      0,
      2048,
    );
    const opening = /^[（〔［｛〈《「『【([{]$/u;
    const closing =
      /^[、。，．！？：；）〕］｝〉》」』】ー〜…!?.,:;\)\]}ぁぃぅぇぉっゃゅょァィゥェォッャュョ]$/u;
    const font = (px: number) =>
      `700 ${px}px "Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, sans-serif`;
    let lines: LyricLine[] = [];
    const wrap = () => {
      ctx.font = font(size);
      lines = [];
      let line: Glyph[] = [],
        width = 0;
      const push = () => {
        lines.push({ glyphs: line, width });
        line = [];
        width = 0;
      };
      graphemes.forEach((text, index) => {
        if (text === "\n") {
          push();
          return;
        }
        const glyph = { text, index, width: ctx.measureText(text).width };
        if (line.length && width + glyph.width > maxWidth) {
          let split = line.length;
          const space = line.map((g) => g.text).lastIndexOf(" ");
          if (space > 0 && space > line.length / 2) split = space + 1;
          while (split > 1 && opening.test(line[split - 1].text)) split--;
          if (closing.test(text) && split === line.length && split > 1) split--;
          const tail = line.splice(split);
          width = line.reduce((sum, item) => sum + item.width, 0);
          push();
          line = tail;
          width = tail.reduce((sum, item) => sum + item.width, 0);
        }
        line.push(glyph);
        width += glyph.width;
      });
      if (line.length || !lines.length) push();
    };
    wrap();
    if (lines.length * size * 1.38 > maxHeight) {
      size = Math.max(
        10,
        size * Math.sqrt(maxHeight / (lines.length * size * 1.38)),
      );
      wrap();
    }
    const maxLines = Math.max(
      1,
      Math.min(12, Math.floor(maxHeight / (size * 1.38))),
    );
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      const last = lines[lines.length - 1],
        ellipsis = ctx.measureText("…").width;
      while (last.glyphs.length && last.width + ellipsis > maxWidth)
        last.width -= last.glyphs.pop()!.width;
      last.glyphs.push({
        text: "…",
        index: last.glyphs.at(-1)?.index ?? 0,
        width: ellipsis,
      });
      last.width += ellipsis;
    }
    return {
      lines,
      count: graphemes.length,
      font: font(size),
      size,
      padding: Math.ceil(size * 0.65),
      lineHeight: size * 1.38,
    };
  }
  private updateLyric(state: RenderState): boolean {
    const style = state.lyricStyle,
      ctx = this.lyricContext;
    if (!style.enabled || !state.lyric || !ctx) return false;
    const text = state.lyric.slice(0, 8192);
    const key = JSON.stringify([
      text,
      style.size,
      style.color,
      style.align,
      style.shadow,
      this.width,
      this.height,
    ]);
    if (key !== this.lyricLayoutKey) {
      this.lyricLayoutKey = key;
      const size = Math.max(
        10,
        (clamp(style.size, 12, 200) * this.height) / 1080,
      );
      this.lyricLayout = this.layoutLyrics(
        text,
        size,
        this.width * 0.86,
        this.height * 0.72,
      );
      const layout = this.lyricLayout;
      this.lyricCanvas.width = Math.min(
        this.width,
        Math.ceil(
          Math.max(...layout.lines.map((line) => line.width), 1) +
            layout.padding * 2,
        ),
      );
      this.lyricCanvas.height = Math.min(
        this.height,
        Math.ceil(layout.lines.length * layout.lineHeight + layout.padding * 2),
      );
      this.lyricPaintKey = "";
    }
    const layout = this.lyricLayout!;
    const progress = clamp(state.lyricProgress);
    const visibleCount =
      style.mode === "typewriter"
        ? Math.floor(layout.count * progress)
        : layout.count;
    const paintKey = `${key}|${style.mode}|${style.mode === "karaoke" ? Math.round(progress * 512) : visibleCount}`;
    const canvas = this.lyricCanvas;
    if (paintKey !== this.lyricPaintKey) {
      this.lyricPaintKey = paintKey;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = layout.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1, layout.size * 0.075);
      ctx.shadowColor = style.shadow ? "rgba(0,0,0,0.95)" : "transparent";
      ctx.shadowBlur = style.shadow ? layout.size * 0.18 : 0;
      ctx.shadowOffsetY = style.shadow ? layout.size * 0.04 : 0;
      ctx.fillStyle = "#fff";
      ctx.fillStyle = style.color;
      const color = ctx.fillStyle;
      layout.lines.forEach((line, lineIndex) => {
        const x =
          style.align === "left"
            ? layout.padding
            : (canvas.width - line.width) / 2;
        const y = layout.padding + layout.lineHeight * (lineIndex + 0.5);
        const lineText = line.glyphs
          .filter((glyph) => glyph.index < visibleCount)
          .map((glyph) => glyph.text)
          .join("");
        if (style.shadow) {
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          ctx.strokeText(lineText, x, y);
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = style.mode === "karaoke" ? 0.32 : 1;
        ctx.fillText(lineText, x, y);
        ctx.globalAlpha = 1;
        if (style.mode === "karaoke") {
          const boundary = layout.count * progress;
          let width = 0;
          for (const glyph of line.glyphs)
            width += glyph.width * clamp(boundary - glyph.index);
          if (width > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(
              x - 1,
              y - layout.lineHeight / 2,
              width + 1,
              layout.lineHeight,
            );
            ctx.clip();
            ctx.fillText(lineText, x, y);
            ctx.restore();
          }
        }
      });
      const gl = this.gl!;
      gl.bindTexture(gl.TEXTURE_2D, this.lyricTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      if (
        canvas.width !== this.lyricTextureWidth ||
        canvas.height !== this.lyricTextureHeight
      ) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          canvas,
        );
        this.lyricTextureWidth = canvas.width;
        this.lyricTextureHeight = canvas.height;
      } else
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          canvas,
        );
    }
    const position = clamp(
      style.position > 1 ? style.position / 100 : style.position,
    );
    const rectWidth = canvas.width / this.width,
      rectHeight = canvas.height / this.height;
    const left = style.align === "left" ? 0.04 : (1 - rectWidth) / 2;
    const top = clamp(position - rectHeight / 2, 0, 1 - rectHeight);
    this.lyricRect = [
      Math.min(left, 1 - rectWidth),
      1 - top - rectHeight,
      rectWidth,
      rectHeight,
    ];
    return true;
  }
}
