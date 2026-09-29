// Recoil FPS — single-pass finishing chain.
//
// One fragment shader does the whole grade so the composed path costs exactly one
// extra full-screen pass instead of four: FXAA edge clean-up, unsharp clarity,
// per-map lift/gamma/gain + saturation, optional sun shafts, vignette and grain.
// Every stage compiles out through a uniform branch when it is switched off, and
// the cheap stages are ordered so the expensive ones (shafts) are last.
import * as THREE from 'three';

export interface GradeConfig {
  /** Shadow tint (lift), midtone response (gamma) and highlight tint (gain). */
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  saturation: number;
  contrast: number;
  /** Screen-space position of the sun for the shaft pass, in 0..1 UV. */
  sunUv: [number, number];
  sunVisible: number;
}

export const GRADE_SHADER = {
  name: 'RecoilGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    uVignette: { value: 0.16 },
    uGrain: { value: 0.0 },
    uSharpen: { value: 0.28 },
    uFxaa: { value: 1.0 },
    uAberration: { value: 0.35 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.04 },
    uShafts: { value: 0.0 },
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uSunColor: { value: new THREE.Color(0xFFD9A0) },
    uFlash: { value: 0.0 },
    uHurt: { value: 0.0 },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uResolution, uSunUv;
uniform float uTime, uVignette, uGrain, uSharpen, uFxaa, uAberration;
uniform float uSaturation, uContrast, uShafts, uFlash, uHurt;
uniform vec3 uLift, uGamma, uGain, uSunColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Compact FXAA 3.11-style edge pass. Only runs where a real edge exists, so the
// cost on flat sky/wall pixels is three texture fetches and a branch.
vec3 fxaa(vec2 uv, vec2 px) {
  vec3 rgbM = texture2D(tDiffuse, uv).rgb;
  float lM  = luma(rgbM);
  float lNW = luma(texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * px).rgb);
  float lNE = luma(texture2D(tDiffuse, uv + vec2( 1.0, -1.0) * px).rgb);
  float lSW = luma(texture2D(tDiffuse, uv + vec2(-1.0,  1.0) * px).rgb);
  float lSE = luma(texture2D(tDiffuse, uv + vec2( 1.0,  1.0) * px).rgb);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  float range = lMax - lMin;
  if (range < max(0.035, lMax * 0.14)) return rgbM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, -8.0, 8.0) * px;
  vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0 / 3.0 - 0.5)).rgb
                + texture2D(tDiffuse, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv + dir * -0.5).rgb
                           + texture2D(tDiffuse, uv + dir *  0.5).rgb);
  float lB = luma(b);
  return (lB < lMin || lB > lMax) ? a : b;
}

void main() {
  vec2 px = 1.0 / uResolution;
  vec2 uv = vUv;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  vec3 c = uFxaa > 0.5 ? fxaa(uv, px) : texture2D(tDiffuse, uv).rgb;

  // --- lateral chromatic aberration, edges only (lens character, not a filter) ---
  if (uAberration > 0.001) {
    float k = uAberration * 0.0022 * r2 * 4.0;
    c.r = texture2D(tDiffuse, uv + fromCenter * k).r;
    c.b = texture2D(tDiffuse, uv - fromCenter * k).b;
  }

  // --- unsharp clarity: 4-tap cross, keeps micro-detail alive after tone mapping ---
  if (uSharpen > 0.001) {
    vec3 blur = texture2D(tDiffuse, uv + vec2( px.x, 0.0)).rgb
              + texture2D(tDiffuse, uv + vec2(-px.x, 0.0)).rgb
              + texture2D(tDiffuse, uv + vec2(0.0,  px.y)).rgb
              + texture2D(tDiffuse, uv + vec2(0.0, -px.y)).rgb;
    c += (c - blur * 0.25) * uSharpen;
  }

  // --- sun shafts: 10 radial samples from the sun, masked to bright pixels ---
  if (uShafts > 0.001) {
    vec2 delta = (uSunUv - uv) * (1.0 / 10.0) * 0.72;
    vec2 s = uv;
    float decay = 1.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      s += delta;
      vec3 t = texture2D(tDiffuse, s).rgb;
      acc += max(t - 0.72, 0.0) * decay;
      decay *= 0.88;
    }
    c += acc * uSunColor * uShafts * 0.18;
  }

  // --- lift / gamma / gain, then saturation and contrast ---
  c = clamp(c, 0.0, 12.0);
  c = uLift + c * (uGain - uLift);
  c = pow(max(c, vec3(0.0)), uGamma);
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;

  // --- flashbang whiteout / damage red rim, driven by gameplay ---
  if (uHurt > 0.001) {
    float rim = smoothstep(0.10, 0.34, r2);
    c = mix(c, vec3(0.48, 0.03, 0.02), rim * uHurt * 0.85);
  }
  if (uFlash > 0.001) c = mix(c, vec3(1.0), uFlash);

  // --- vignette then grain (grain last so it is not multiplied away) ---
  float vig = smoothstep(0.86, 0.26, length(fromCenter));
  c *= mix(1.0 - uVignette, 1.0, vig);
  if (uGrain > 0.001) {
    float n = fract(sin(dot(uv * uResolution + uTime * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * uGrain * (1.0 - luma(c) * 0.55);
  }

  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
}`,
};

/** Per-map film grades. Subtle — the point is separation, not an Instagram filter. */
export const GRADES: Record<string, GradeConfig> = {
  alrasul: {
    lift: [0.008, 0.006, 0.014], gamma: [0.99, 1.0, 1.03], gain: [1.05, 1.015, 0.955],
    saturation: 1.08, contrast: 1.05, sunUv: [0.5, 0.5], sunVisible: 0,
  },
  kasbah: {
    lift: [0.010, 0.013, 0.020], gamma: [1.02, 1.0, 0.98], gain: [0.985, 1.005, 1.045],
    saturation: 1.02, contrast: 1.06, sunUv: [0.5, 0.5], sunVisible: 0,
  },
  arena: {
    lift: [0.012, 0.014, 0.020], gamma: [1.01, 1.0, 0.99], gain: [0.98, 1.0, 1.05],
    saturation: 0.98, contrast: 1.08, sunUv: [0.5, 0.5], sunVisible: 0,
  },
  sirocco: {
    lift: [0.014, 0.008, 0.006], gamma: [0.97, 1.0, 1.05], gain: [1.075, 1.01, 0.925],
    saturation: 1.1, contrast: 1.04, sunUv: [0.5, 0.5], sunVisible: 0,
  },
};

/**
 * Allocate the off-screen composer buffer.
 *
 * This used to hard-code `HalfFloatType`, which is a trap: rendering INTO a
 * half-float colour buffer needs `EXT_color_buffer_float` (WebGL2) or
 * `EXT_color_buffer_half_float`. Without it the framebuffer is incomplete, the
 * composer silently produces nothing, and the player gets a totally black screen
 * while the DOM HUD carries on as though everything is fine. Probe the extension
 * and fall back to an 8-bit buffer, which every WebGL2 device can render to.
 *
 * `samples` is passed through but should normally be 0 — the finishing pass does
 * its own FXAA, so MSAA on top is duplicated work.
 */
export function makeComposerTarget(renderer: THREE.WebGLRenderer, samples: number): THREE.WebGLRenderTarget {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  return new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
    type: canRenderToFloat(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: Math.max(0, samples),
    depthBuffer: true,
    stencilBuffer: false,
  });
}

/** True when the device can actually use a float colour buffer as a render target. */
export function canRenderToFloat(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    if (!gl || typeof gl.getExtension !== 'function') return false;
    return !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  } catch {
    return false;
  }
}
