// Recoil FPS — Atmosphere: analytic sky, sun, volumetric-ish cloud deck and
// image-based lighting. Replaces the old 4×256 gradient dome + sprite sun.
//
// Why this exists: PBR materials only look "real" when the indirect light that
// hits them comes from the same sky the player can see. Previously the world was
// lit by `RoomEnvironment` (an indoor photo studio) at 0.25 intensity while the
// sky was a flat vertical gradient — so every surface read chalky and flat.
// Here one shader owns the sky, and that exact shader is baked through PMREM into
// the scene environment, so sky, fog, sun and ambient all agree.
import * as THREE from 'three';
import type { MapId } from './world';

export interface AtmospherePreset {
  /** Sun direction (normalised, pointing FROM the ground TOWARD the sun). */
  sun: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  /** Angular size multiplier of the sun disc (1 = ~0.6°, realistic). */
  sunSize: number;
  zenith: number;
  horizon: number;
  /** Colour below the horizon line — bounce from the terrain. */
  ground: number;
  /** Extra warm scattering around the sun. */
  glow: number;
  glowPower: number;
  /** 0 = clear, 1 = overcast. Drives the cloud deck coverage. */
  cloudCover: number;
  cloudColor: number;
  cloudShadow: number;
  /** Airborne dust: lifts the horizon band and thickens fog. */
  haze: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Hemisphere + ambient trim once IBL carries most of the indirect light. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambient: number;
  ambientIntensity: number;
  /** Multiplier applied to renderer.toneMappingExposure for this map. */
  exposure: number;
  /** Strength of scene.environment (IBL). */
  envIntensity: number;
  /** Drifting dust motes / sand in the air, 0 disables. */
  dust: number;
}

/** One authored sky per map. Sun vectors here ARE the shadow-casting sun direction. */
export const ATMOSPHERES: Record<MapId, AtmospherePreset> = {
  // Sandblast — hard, high desert light an hour past noon. Bleached, hot, dusty.
  alrasul: {
    sun: [-0.52, 0.62, 0.59], sunColor: 0xFFF0D2, sunIntensity: 2.15, sunSize: 1.05,
    zenith: 0x2F6EA8, horizon: 0xD9CBA8, ground: 0xB49A72,
    glow: 0xFFD9A0, glowPower: 6.5,
    cloudCover: 0.34, cloudColor: 0xFFF6E6, cloudShadow: 0xB9AF9C,
    haze: 0.42, fogColor: 0xD3C3A2, fogNear: 80, fogFar: 280,
    hemiSky: 0xBFD8F2, hemiGround: 0x9A7F58, hemiIntensity: 0.26,
    ambient: 0x8A7A60, ambientIntensity: 0.05,
    exposure: 0.88, envIntensity: 0.55, dust: 0.35,
  },
  // Town — cool, hazy hill morning. Blue shadows, soft key, moisture in the air.
  kasbah: {
    sun: [0.63, 0.52, -0.58], sunColor: 0xFFEEDA, sunIntensity: 1.95, sunSize: 1.0,
    zenith: 0x27578C, horizon: 0xC8D2D6, ground: 0x8C8A7C,
    glow: 0xFFE4C2, glowPower: 8.0,
    cloudCover: 0.5, cloudColor: 0xF4F6F4, cloudShadow: 0xA8AFB4,
    haze: 0.55, fogColor: 0xB8C4C8, fogNear: 60, fogFar: 240,
    hemiSky: 0xC3D9F0, hemiGround: 0x6E7568, hemiIntensity: 0.32,
    ambient: 0x707A78, ambientIntensity: 0.06,
    exposure: 0.92, envIntensity: 0.6, dust: 0.2,
  },
  // Warehouse — overcast industrial dusk. Flat sky, the map lights itself.
  arena: {
    sun: [0.38, 0.74, 0.55], sunColor: 0xE8ECF2, sunIntensity: 1.7, sunSize: 0.85,
    zenith: 0x33445C, horizon: 0xA9B2BC, ground: 0x6E7480,
    glow: 0xD8DEE8, glowPower: 12.0,
    cloudCover: 0.78, cloudColor: 0xDCE2EA, cloudShadow: 0x8E96A2,
    haze: 0.5, fogColor: 0x9BA5B0, fogNear: 45, fogFar: 185,
    hemiSky: 0xBCC8D8, hemiGround: 0x5A5F66, hemiIntensity: 0.4,
    ambient: 0x6A7078, ambientIntensity: 0.08,
    exposure: 0.95, envIntensity: 0.62, dust: 0.15,
  },
  // Sirocco — golden hour. Long raking shadows, burnt horizon, thick dust.
  sirocco: {
    sun: [-0.86, 0.30, 0.41], sunColor: 0xFFC286, sunIntensity: 2.25, sunSize: 1.35,
    zenith: 0x2A5A8E, horizon: 0xE9A765, ground: 0xA2764A,
    glow: 0xFFB05A, glowPower: 3.4,
    cloudCover: 0.42, cloudColor: 0xFFD9AE, cloudShadow: 0xA8794E,
    haze: 0.66, fogColor: 0xD4A878, fogNear: 48, fogFar: 205,
    hemiSky: 0xD6C0A4, hemiGround: 0x8A6440, hemiIntensity: 0.28,
    ambient: 0x8A6E4C, ambientIntensity: 0.06,
    exposure: 0.88, envIntensity: 0.58, dust: 0.45,
  },
};

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

// Hash/fbm pair is the cheapest cloud that still reads as a cloud: 4 octaves of
// value noise, domain-warped once, projected onto a flat deck so the cells stretch
// toward the horizon like real cumulus.
const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uGlow, uSunColor, uCloud, uCloudShadow;
uniform vec3 uSunDir;
uniform float uGlowPower, uSunSize, uCloudCover, uHaze, uTime, uCloudSpeed, uExposure;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float up = clamp(h, 0.0, 1.0);

  // --- base gradient: zenith → horizon, with a dust-thickened horizon band ---
  float grad = pow(1.0 - up, 3.0 + uHaze * 2.0);
  vec3 sky = mix(uZenith, uHorizon, clamp(grad, 0.0, 1.0));
  // ground hemisphere (visible under the terrain edge / through gaps)
  sky = mix(sky, uGround, smoothstep(0.0, -0.09, h));

  // --- sun disc + multi-lobe scattering halo ---
  float cosA = dot(dir, uSunDir);
  float halo = pow(max(cosA, 0.0), uGlowPower);
  float wide = pow(max(cosA, 0.0), 1.6) * 0.32;
  sky += uGlow * (halo * 0.85 + wide) * (0.55 + uHaze * 0.9);
  // 0.6° disc, softened by dust
  float discSize = 0.9985 - uSunSize * 0.0016;
  float disc = smoothstep(discSize, discSize + 0.0009, cosA);
  sky = mix(sky, uSunColor * 6.0, disc * clamp(1.0 - uHaze * 0.35, 0.25, 1.0));

  // --- cloud deck: flat plane projection so cells compress at the horizon ---
  if (uCloudCover > 0.01 && h > 0.005) {
    vec2 uv = dir.xz / max(h, 0.045) * 0.42;
    uv += vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.42);
    float warp = fbm(uv * 0.55);
    float d = fbm(uv * 0.85 + warp * 0.9);
    float cover = smoothstep(0.62 - uCloudCover * 0.42, 0.92 - uCloudCover * 0.30, d);
    // lit tops toward the sun, shaded bases away from it
    float lit = clamp(0.45 + 0.55 * dot(normalize(vec3(dir.x, 0.35, dir.z)), uSunDir), 0.0, 1.0);
    vec3 cloud = mix(uCloudShadow, uCloud, lit);
    cloud += uGlow * pow(max(cosA, 0.0), 10.0) * 0.5;
    // fade the deck into the horizon haze instead of terminating in a hard line
    float fade = smoothstep(0.0, 0.16, h) * (1.0 - smoothstep(0.55, 1.0, up) * 0.18);
    sky = mix(sky, cloud, cover * fade * 0.92);
  }

  gl_FragColor = vec4(sky * uExposure, 1.0);
  #include <colorspace_fragment>
}`;

export interface SkyHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uniforms: Record<string, THREE.IUniform>;
}

function skyUniforms(p: AtmospherePreset, exposure = 1): Record<string, THREE.IUniform> {
  return {
    uZenith: { value: new THREE.Color(p.zenith).convertSRGBToLinear() },
    uHorizon: { value: new THREE.Color(p.horizon).convertSRGBToLinear() },
    uGround: { value: new THREE.Color(p.ground).convertSRGBToLinear() },
    uGlow: { value: new THREE.Color(p.glow).convertSRGBToLinear() },
    uSunColor: { value: new THREE.Color(p.sunColor).convertSRGBToLinear() },
    uCloud: { value: new THREE.Color(p.cloudColor).convertSRGBToLinear() },
    uCloudShadow: { value: new THREE.Color(p.cloudShadow).convertSRGBToLinear() },
    uSunDir: { value: new THREE.Vector3(...p.sun).normalize() },
    uGlowPower: { value: p.glowPower },
    uSunSize: { value: p.sunSize },
    uCloudCover: { value: p.cloudCover },
    uHaze: { value: p.haze },
    uTime: { value: 0 },
    uCloudSpeed: { value: 0.0016 },
    uExposure: { value: exposure },
  };
}

/** Build the visible sky dome. Radius sits just inside the camera far plane. */
export function buildSky(p: AtmospherePreset, radius = 460): SkyHandle {
  const uniforms = skyUniforms(p);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return { mesh, material, uniforms };
}

/**
 * Bake the same sky into a prefiltered radiance map.
 * The cloud deck is flattened for the bake (uCloudCover trimmed) so the IBL stays
 * stable rather than strobing as clouds drift — the visible dome keeps full motion.
 */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, p: AtmospherePreset): THREE.Texture | null {
  try {
    const scene = new THREE.Scene();
    const bake = buildSky({ ...p, cloudCover: p.cloudCover * 0.6 }, 40);
    // The env bake must be raw radiance — the renderer tone-maps the final image,
    // not the light probe.
    bake.material.toneMapped = false;
    bake.material.depthTest = true;
    scene.add(bake.mesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromScene(scene, 0.02, 0.5, 200);
    pmrem.dispose();
    bake.mesh.geometry.dispose();
    bake.material.dispose();
    return target.texture;
  } catch {
    // Headless / stub-GL fallback: no IBL, the hemisphere light still lights the map.
    return null;
  }
}

/** Airborne dust: one additive Points cloud that follows the player. Cheap, 1 draw. */
export class DustField {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private readonly drift: Float32Array;
  private t = 0;
  private readonly extent: number;

  constructor(count: number, extent = 26, color = 0xE8D3AC, size = 0.055) {
    this.extent = extent;
    const positions = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.drift = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * extent * 2;
      const y = Math.random() * 9 - 0.5;
      const z = (Math.random() - 0.5) * extent * 2;
      positions[i * 3] = this.base[i * 3] = x;
      positions[i * 3 + 1] = this.base[i * 3 + 1] = y;
      positions[i * 3 + 2] = this.base[i * 3 + 2] = z;
      this.drift[i * 3] = 0.22 + Math.random() * 0.5;
      this.drift[i * 3 + 1] = (Math.random() - 0.35) * 0.16;
      this.drift[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color, size, sizeAttenuation: true, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'dust';
  }

  setOpacity(v: number) { (this.points.material as THREE.PointsMaterial).opacity = v; }

  /** Motes drift, then wrap inside a box centred on the eye so density is constant. */
  update(dt: number, eye: THREE.Vector3) {
    this.t += dt;
    const attr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const e = this.extent;
    for (let i = 0; i < arr.length; i += 3) {
      let x = arr[i] + this.drift[i] * dt;
      let y = arr[i + 1] + (this.drift[i + 1] + Math.sin(this.t * 0.6 + i) * 0.04) * dt;
      let z = arr[i + 2] + this.drift[i + 2] * dt;
      // wrap relative to the eye
      if (x - eye.x > e) x -= e * 2; else if (x - eye.x < -e) x += e * 2;
      if (z - eye.z > e) z -= e * 2; else if (z - eye.z < -e) z += e * 2;
      if (y > eye.y + 7) y = eye.y - 1.4; else if (y < eye.y - 2) y = eye.y + 6.5;
      arr[i] = x; arr[i + 1] = y; arr[i + 2] = z;
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
