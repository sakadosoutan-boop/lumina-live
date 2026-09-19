import type { RenderState } from "./types";

/** A bounded beat phase is shared by operator preview and projector output. */
export function spatialUniforms(
  fx: RenderState["fx"],
  beat: number,
): [number, number, number, number] {
  const safe = (
    v: number | undefined,
    fallback: number,
    lo: number,
    hi: number,
  ) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v! : fallback));
  const beats = safe(fx.motionBeats, 8, 2, 32);
  const clock = Number.isFinite(beat) ? beat : 0;
  return [
    safe(fx.depth, 0, -1, 1),
    safe(fx.mapping, 0, 0, 1),
    (((clock % beats) + beats) % beats) / beats,
    0,
  ];
}

// sourceScene() is provided by the compositor. No framebuffer allocations or
// texture reads are added when both effects are off. ES 1.00 / mediump safe.
export const SPATIAL_GLSL = `
uniform vec4 uSpatial;
vec3 depthScene(vec2 uv) {
  vec3 original=sourceScene(uv);
  if(abs(uSpatial.x)<0.001) return original;
  vec2 p=uv-0.5;
  float phase=fract(uSpatial.z*sign(uSpatial.x));
  vec3 tunnel=original*0.12;
  for(int i=0;i<6;i++) {
    float layer=float(i)+phase;
    float scale=exp2((layer-2.8)*1.1);
    vec2 q=p/scale;
    float r=max(abs(q.x),abs(q.y));
    float aa=max(0.001,1.25/(uResolution.y*scale));
    float outer=1.0-smoothstep(0.5-aa,0.5+aa,r);
    float aperture=smoothstep(0.30-aa,0.35+aa,r);
    float lifetime=smoothstep(0.0,0.7,layer)*(1.0-smoothstep(4.8,6.0,layer));
    float mask=outer*aperture*lifetime;
    if(mask>0.001) {
      vec3 frame=sourceScene(clamp(q+0.5,0.0,1.0));
      float light=0.48+0.52*smoothstep(0.30,0.50,r);
      float rim=(1.0-smoothstep(aa,aa*3.0,abs(r-0.495)))*0.13;
      frame=frame*light+vec3(0.26,0.48,0.68)*rim;
      tunnel=mix(tunnel,frame,mask);
    }
  }
  return mix(original,tunnel,abs(uSpatial.x));
}
vec3 spatialScene(vec2 uv) {
  vec3 original=depthScene(uv);
  if(uSpatial.y<0.001) return original;
  vec2 aspect=vec2(uResolution.x/uResolution.y,1.0);
  vec2 world=(uv-0.5)*aspect;
  vec2 cell=vec2(0.32,0.24), id=floor(world/cell);
  vec2 center=(id+0.5)*cell, p=world-center;
  vec2 B=0.38*cell, shear=vec2(0.60,0.40);
  float H=0.17*cell.y;
  float phase=uSpatial.z*TAU+hash21(id+11.0)*TAU;
  float h=H*sin(phase);
  vec2 lower=(p-B)/shear, upper=(p+B)/shear;
  float z=0.0, shade=0.24, coverage=0.0;
  float aa=1.2/uResolution.y;
  if(h>=0.0) {
    float nearZ=min(h,min(upper.x,upper.y));
    // Signed silhouette distances, excluding the box's thickness: this stays
    // fully covered when an animated cap passes through zero height.
    float gap=min(min(upper.x,upper.y),h-max(lower.x,lower.y));
    gap=min(gap,min(upper.x-lower.y,upper.y-lower.x));
    coverage=smoothstep(-aa,aa,gap);
    z=nearZ;
    shade=h<=min(upper.x,upper.y) ? 1.0 : (upper.x<upper.y ? 0.44 : 0.72);
  } else {
    coverage=1.0-smoothstep(-aa,aa,max(abs(p.x)-B.x,abs(p.y)-B.y));
    z=max(h,max(lower.x,lower.y));
    shade=h>=max(lower.x,lower.y) ? mix(1.0,0.62,-h/H) : (lower.x>lower.y ? 0.48 : 0.78);
  }
  vec2 q=p-shear*z;
  vec2 sourceUV=(center+q+vec2(0.12,-0.08)*z)/aspect+0.5;
  vec3 mapped=depthScene(clamp(sourceUV,0.0,1.0));
  float edge=min(abs(abs(q.x)-B.x),abs(abs(q.y)-B.y));
  float bevel=(1.0-smoothstep(aa,aa*2.5,edge))*0.11;
  vec3 wall=mix(original*0.18,mapped*shade+vec3(0.12,0.24,0.36)*bevel,coverage);
  return mix(original,wall,uSpatial.y);
}
`;
