// Recoil FPS — procedural field-ability hardware: the Radar unit, the Barricade and the
// Decoy hologram. Everything is built from primitives at runtime (no model files),
// but detail parts are MERGED per material so a deployed ability costs a handful of draw
// calls no matter how many rivets, pouches and struts it carries.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------------
// Shared materials + procedural textures (created once, shared by every ability)
// ---------------------------------------------------------------------------------
type MatKey = 'olive' | 'gunmetal' | 'steel' | 'rubber' | 'dark' | 'glass' | 'hazard' | 'cyan' | 'amber' | 'label';
let mats: Record<MatKey, THREE.MeshStandardMaterial> | null = null;
let wornTex: THREE.CanvasTexture | null | undefined;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? [c, g] : null;
}

/** Deterministic PRNG so every run paints the same wear. */
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

/** Worn olive paint over steel: mottling, scratches and chipped edges showing bare metal. */
function worn(): THREE.CanvasTexture | null {
  if (wornTex !== undefined) return wornTex;
  const cg = canvas(256, 256);
  if (!cg) return (wornTex = null);
  const [c, g] = cg;
  const r = rng(7);
  g.fillStyle = '#5d6446'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { // mottling
    const v = 70 + Math.floor(r() * 40);
    g.fillStyle = `rgba(${v},${v + 8},${v - 18},0.18)`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 10, 2 + r() * 10);
  }
  g.strokeStyle = 'rgba(190,190,175,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 70; i++) { // scratches
    const x = r() * 256, y = r() * 256, a = r() * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (6 + r() * 26), y + Math.sin(a) * (6 + r() * 26)); g.stroke();
  }
  g.fillStyle = 'rgba(150,150,140,0.55)';
  for (let i = 0; i < 120; i++) { // edge chips
    const edge = Math.floor(r() * 4), t = r() * 256, d = r() * 10;
    const [x, y] = edge === 0 ? [t, d] : edge === 1 ? [t, 256 - d] : edge === 2 ? [d, t] : [256 - d, t];
    g.fillRect(x, y, 1 + r() * 4, 1 + r() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (wornTex = tex);
}

function hazardTex(): THREE.CanvasTexture | null {
  const cg = canvas(128, 32);
  if (!cg) return null;
  const [c, g] = cg;
  g.fillStyle = '#e8a31a'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#181818';
  for (let x = -32; x < 160; x += 24) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 12, 32); g.lineTo(x + 44, 0); g.lineTo(x + 32, 0); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(3, 1);
  return tex;
}

function labelTex(): THREE.CanvasTexture | null {
  const cg = canvas(256, 64);
  if (!cg) return null;
  const [c, g] = cg;
  g.fillStyle = '#d9d2bd'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1a1a1a'; g.fillRect(4, 4, 248, 56);
  g.fillStyle = '#d9d2bd';
  g.font = 'bold 26px monospace'; g.textAlign = 'center';
  g.fillText('BALLISTIC · IIIA', 128, 32);
  g.font = '14px monospace';
  g.fillText('KEEP CLEAR OF HINGES', 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function M() {
  if (mats) return mats;
  mats = {
    olive: new THREE.MeshStandardMaterial({ color: 0xffffff, map: worn(), roughness: 0.78, metalness: 0.35 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.45, metalness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.32, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.6, metalness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1c3a44, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.7 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xffffff, map: hazardTex(), roughness: 0.7, metalness: 0.1 }),
    cyan: new THREE.MeshStandardMaterial({ color: 0x5fe3ff, emissive: 0x5fe3ff, emissiveIntensity: 2.4, roughness: 0.4 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: 0xffb030, emissiveIntensity: 2.2, roughness: 0.4 }),
    label: new THREE.MeshStandardMaterial({ color: 0xffffff, map: labelTex(), roughness: 0.8, metalness: 0 }),
  };
  return mats;
}

// ---------------------------------------------------------------------------------
// Part builder: collect primitives per material, bake transforms, merge
// ---------------------------------------------------------------------------------
class Parts {
  private bins = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(this.m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    geo.dispose();
    (this.bins.get(mat) ?? this.bins.set(mat, []).get(mat)!).push(g);
    return this;
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  }
  rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat, x, y, z, rx, ry, rz);
  }
  cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz);
  }
  sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 12) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0)), mat, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  capsule(r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CapsuleGeometry(r, len, 3, 10), mat, x, y, z, rx, ry, rz);
  }
  /** One mesh per material, added to `parent`. */
  build(parent: THREE.Object3D, override?: THREE.Material): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    if (override) {
      const all = [...this.bins.values()].flat();
      if (all.length) { const mesh = new THREE.Mesh(mergeGeometries(all)!, override); parent.add(mesh); out.push(mesh); }
    } else {
      for (const [mat, list] of this.bins) {
        const mesh = new THREE.Mesh(mergeGeometries(list)!, mat);
        parent.add(mesh); out.push(mesh);
      }
    }
    for (const list of this.bins.values()) for (const g of list) g.dispose();
    this.bins.clear();
    return out;
  }
}

let arrayMatShared: THREE.MeshStandardMaterial | null = null;
/** Radar emitter face: dark tile grid with cyan-lit seams (shared, never disposed). */
function arrayMat(): THREE.MeshStandardMaterial {
  if (arrayMatShared) return arrayMatShared;
  const cg = canvas(256, 160);
  let map: THREE.CanvasTexture | null = null;
  let emi: THREE.CanvasTexture | null = null;
  if (cg) {
    const [c, g] = cg;
    g.fillStyle = '#10161a'; g.fillRect(0, 0, 256, 160);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) {
      g.fillStyle = (x + y) % 2 ? '#1b252b' : '#162026';
      g.fillRect(4 + x * 17.8, 4 + y * 19, 15, 16);
    }
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    const ce = canvas(256, 160)!;
    const ge = ce[1];
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 160);
    ge.fillStyle = '#5fe3ff';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) ge.fillRect(9 + x * 17.8, 10 + y * 19, 5, 3);
    ge.fillRect(0, 0, 256, 2); ge.fillRect(0, 158, 256, 2);
    emi = new THREE.CanvasTexture(ce[0]); emi.colorSpace = THREE.SRGBColorSpace;
  }
  return (arrayMatShared = new THREE.MeshStandardMaterial({
    color: 0xffffff, map, emissive: emi ? 0xffffff : 0x113844, emissiveMap: emi, emissiveIntensity: 1.6, roughness: 0.35, metalness: 0.5,
  }));
}

// ---------------------------------------------------------------------------------
// Radar: throwable ground radar — rugged case, fold-out legs, mast, spinning array panel
// ---------------------------------------------------------------------------------
export interface DartModel {
  group: THREE.Group;
  /** Status light (own material — the director pulses it). */
  led: THREE.Mesh;
  /** Radar head: spins while deployed. */
  dish: THREE.Group;
  /** 0 = folded for the throw, 1 = legs out, mast up. */
  setDeploy(k: number): void;
  /** Flat expanding ground ring for each pulse (world space, scaled by the director). */
  ring: THREE.Mesh;
  /** Trailing echo ring. */
  echo: THREE.Mesh;
  /** Expanding translucent dome — the pulse's 3-D reach. */
  dome: THREE.Mesh;
  /** Vertical beacon beam marking the unit. */
  beam: THREE.Mesh;
}

export function buildDart(): DartModel {
  const m = M();
  const group = new THREE.Group();
  // Base: a rugged rounded case (olive, worn) on a rubber skirt, with a carry handle,
  // a dark top deck, vents, bolts and a small status panel. ~26 × 20 cm footprint.
  const body = new Parts()
    .rbox(0.26, 0.085, 0.2, 0.025, m.olive, 0, 0.06, 0)
    .rbox(0.275, 0.03, 0.215, 0.012, m.rubber, 0, 0.022, 0)
    .rbox(0.2, 0.02, 0.15, 0.008, m.gunmetal, 0, 0.108, 0)
    .cyl(0.05, 0.056, 0.03, m.dark, 0, 0.128, 0, 0, 0, 0, 16)
    .rbox(0.07, 0.03, 0.004, 0.003, m.glass, -0.06, 0.07, 0.101)
    // carry handle across the back edge
    .cyl(0.008, 0.008, 0.16, m.steel, 0, 0.13, -0.085, 0, 0, Math.PI / 2, 8)
    .box(0.012, 0.035, 0.012, m.steel, -0.08, 0.112, -0.085)
    .box(0.012, 0.035, 0.012, m.steel, 0.08, 0.112, -0.085);
  for (let i = 0; i < 4; i++) body.box(0.012, 0.03, 0.004, m.dark, 0.03 + i * 0.022, 0.065, 0.101); // vents
  for (const [x, z] of [[-0.09, -0.065], [0.09, -0.065], [-0.09, 0.065], [0.09, 0.065]]) body.cyl(0.007, 0.007, 0.006, m.steel, x, 0.12, z, 0, 0, 0, 8);
  body.build(group);
  // status LED strip on the front (own material — the director pulses it)
  const ledMat = m.cyan.clone();
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.004), ledMat);
  led.position.set(-0.06, 0.07, 0.104);
  group.add(led);
  // three fold-out legs with rubber feet
  const legs: THREE.Group[] = [];
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.5]) {
    const hinge = new THREE.Group();
    hinge.position.set(Math.sin(a) * 0.12, 0.05, Math.cos(a) * 0.1);
    hinge.rotation.y = a;
    new Parts()
      .rbox(0.028, 0.018, 0.17, 0.006, m.gunmetal, 0, 0, 0.085)
      .cyl(0.012, 0.012, 0.036, m.steel, 0, 0, 0, 0, 0, Math.PI / 2, 8)
      .cyl(0.024, 0.028, 0.016, m.rubber, 0, -0.012, 0.17, 0, 0, 0, 10)
      .build(hinge);
    group.add(hinge);
    legs.push(hinge);
  }
  // telescopic mast: two steel stages with collars
  const mast = new THREE.Group();
  mast.position.y = 0.14;
  new Parts()
    .cyl(0.02, 0.024, 0.16, m.gunmetal, 0, 0.08, 0, 0, 0, 0, 12)
    .cyl(0.028, 0.028, 0.018, m.dark, 0, 0.16, 0, 0, 0, 0, 12)
    .cyl(0.014, 0.014, 0.12, m.steel, 0, 0.23, 0, 0, 0, 0, 10)
    .build(mast);
  group.add(mast);
  // Head: a flat phased-array panel (glowing emitter grid) on a turntable yoke,
  // tilted back 15°, with a sensor pod and whip antenna. Reads as "radar" at a glance.
  const dish = new THREE.Group();
  dish.position.y = 0.29;
  mast.add(dish);
  const tilt = -0.26;
  const head = new Parts()
    .cyl(0.04, 0.045, 0.025, m.gunmetal, 0, 0.012, 0, 0, 0, 0, 16)     // turntable
    .rbox(0.2, 0.018, 0.04, 0.006, m.gunmetal, 0, 0.032, 0)          // yoke bar
    .rbox(0.016, 0.1, 0.03, 0.005, m.gunmetal, -0.1, 0.08, 0)        // yoke arms
    .rbox(0.016, 0.1, 0.03, 0.005, m.gunmetal, 0.1, 0.08, 0)
    .rbox(0.32, 0.2, 0.04, 0.012, m.olive, 0, 0.14, 0, tilt, 0, 0)    // panel housing
    .rbox(0.18, 0.1, 0.035, 0.01, m.dark, 0, 0.13, 0.04, tilt, 0, 0) // rear electronics box
    .cyl(0.004, 0.004, 0.2, m.dark, 0.12, 0.3, 0.02, 0, 0, 0, 5)     // antenna
    .sphere(0.008, m.amber, 0.12, 0.4, 0.02, 1, 1, 1, 8);
  for (const s of [-1, 1]) head.cyl(0.012, 0.012, 0.03, m.steel, s * 0.1, 0.12, 0, 0, 0, Math.PI / 2, 10); // pivots
  head.build(dish);
  // emitter face (own mesh so its emissive grid can glow)
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.17), arrayMat());
  face.position.set(0, 0.14 - Math.sin(tilt) * 0.021, -0.021 * Math.cos(tilt));
  face.rotation.set(tilt, Math.PI, 0);
  dish.add(face);

  const setDeploy = (k: number) => {
    const e = Math.max(0, Math.min(1, k));
    // legs tucked flat under the case, then swing down/out
    for (const l of legs) l.rotation.x = THREE.MathUtils.lerp(-0.2, 0.42, e);
    const up = Math.max(0, Math.min(1, (e - 0.35) / 0.65));
    mast.scale.set(1, Math.max(0.04, up), 1);
    dish.scale.setScalar(Math.max(0.04, up));
  };
  setDeploy(0);

  // pulse FX (world space, additive)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false;
  const echo = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  echo.rotation.x = -Math.PI / 2; echo.visible = false;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), fresnelShell(0x5fe3ff));
  dome.visible = false;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.visible = false;
  return { group, led, dish, setDeploy, ring, echo, dome, beam };
}

/** Disposes the radar's own materials and its world-space pulse meshes. */
export function disposeDartFx(m: DartModel) {
  (m.led.material as THREE.Material).dispose();
  for (const o of [m.ring, m.echo, m.dome, m.beam]) {
    o.removeFromParent();
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  }
}

/** Soft rim-lit shell (bright at grazing angles, clear face-on): the radar dome. */
function fresnelShell(color: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float rim = pow(1.0-abs(dot(vN,vV)),2.5); float grid = step(0.94, fract(vY*10.0)); gl_FragColor = vec4(uColor, uOpacity*(rim*0.9+grid*0.35)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  bindOpacity(mat);
  return mat;
}

/** Make `material.opacity` drive the shader's uOpacity so callers treat it like a basic material. */
function bindOpacity(mat: THREE.ShaderMaterial) {
  Object.defineProperty(mat, 'opacity', {
    get: () => mat.uniforms.uOpacity.value as number,
    set: (v: number) => { mat.uniforms.uOpacity.value = v; },
    configurable: true,
  });
}

// ---------------------------------------------------------------------------------
// Hologram material + soldier body (decoy and radar silhouettes)
// ---------------------------------------------------------------------------------
/**
 * Hologram: fresnel rim glow, horizontal scanlines that crawl upward, a bright band
 * sweeping the body and per-frame flicker. `opacity` is bound to the shader so the
 * director fades it like any other material; `uTime` is advanced by the owner.
 */
export function makeHoloMaterial(color: number, throughWalls = false): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.6 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vec4 mv = viewMatrix*wp; vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vY = wp.y; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        float rim = pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.2);
        float scan = 0.8 + 0.2*step(0.5, fract(vY*60.0 - uTime*1.6));
        float band = smoothstep(0.08,0.0,abs(fract(vY*0.4 - uTime*0.35)-0.5));
        float light = 0.5 + 0.5*clamp(normalize(vN).y*0.6 + 0.4, 0.0, 1.0);
        float a = uOpacity*(0.16*light + rim*1.25 + band*0.45)*scan;
        gl_FragColor = vec4(uColor*(0.55+rim*0.9+band*0.8) + vec3(rim*rim*0.35), a);
      }`,
    transparent: true, depthWrite: false, depthTest: !throughWalls, blending: THREE.AdditiveBlending,
  });
  bindOpacity(mat);
  return mat;
}

interface SoldierRig {
  root: THREE.Group;
  torso: THREE.Group;
  lLeg: THREE.Group; rLeg: THREE.Group;
  lArm: THREE.Group; rArm: THREE.Group;
  muzzle: THREE.Object3D;
}

/**
 * Operator silhouette at real proportions (1.85 m with helmet): plate carrier with
 * pouches, backpack, helmet with NVG mount and ear-pro, jointed arms holding a rifle,
 * jointed legs with knee pads and boots. Faces -Z. Every limb is ONE merged mesh.
 */
function buildSoldier(mat: THREE.Material): SoldierRig {
  const root = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 0.95; root.add(torso);
  new Parts()
    .rbox(0.32, 0.16, 0.21, 0.04, mat, 0, 0.03, 0)            // pelvis / belt
    .capsule(0.12, 0.12, mat, 0, 0.2, 0, 0, 0, 0)             // abdomen
    .rbox(0.42, 0.36, 0.27, 0.05, mat, 0, 0.42, 0)            // plate carrier
    .rbox(0.32, 0.27, 0.04, 0.015, mat, 0, 0.44, -0.15)       // front plate
    .rbox(0.08, 0.1, 0.06, 0.015, mat, -0.1, 0.3, -0.17)      // mag pouches
    .rbox(0.08, 0.1, 0.06, 0.015, mat, 0, 0.3, -0.17)
    .rbox(0.08, 0.1, 0.06, 0.015, mat, 0.1, 0.3, -0.17)
    .rbox(0.3, 0.36, 0.14, 0.04, mat, 0, 0.45, 0.2)           // backpack
    .cyl(0.055, 0.06, 0.08, mat, 0, 0.64, 0)                  // neck
    .sphere(0.1, mat, 0, 0.76, -0.01, 0.92, 1.05, 1)          // head
    .add(new THREE.SphereGeometry(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat, 0, 0.77, 0.005) // helmet
    .rbox(0.05, 0.05, 0.04, 0.01, mat, 0, 0.86, -0.12)        // NVG mount
    .cyl(0.04, 0.04, 0.035, mat, -0.115, 0.74, 0, 0, 0, Math.PI / 2) // ear pro
    .cyl(0.04, 0.04, 0.035, mat, 0.115, 0.74, 0, 0, 0, Math.PI / 2)
    .sphere(0.075, mat, -0.22, 0.56, 0)                       // shoulders
    .sphere(0.075, mat, 0.22, 0.56, 0)
    .build(torso);
  // rifle shouldered in a low-ready: stock in the right shoulder pocket, pointing -Z
  const rifle = new THREE.Group(); rifle.position.set(0.1, 0.44, -0.24); rifle.rotation.x = 0.06; torso.add(rifle);
  new Parts()
    .box(0.05, 0.08, 0.3, mat, 0, 0, 0)                 // receiver
    .box(0.045, 0.055, 0.28, mat, 0, 0.005, -0.28)      // handguard
    .cyl(0.011, 0.011, 0.2, mat, 0, 0.01, -0.52, Math.PI / 2, 0, 0, 8) // barrel
    .cyl(0.018, 0.018, 0.05, mat, 0, 0.01, -0.63, Math.PI / 2, 0, 0, 8) // muzzle device
    .box(0.035, 0.15, 0.07, mat, 0, -0.1, -0.06, 0.22, 0, 0) // magazine
    .box(0.03, 0.09, 0.04, mat, 0, -0.07, 0.08, -0.3, 0, 0)  // grip
    .box(0.04, 0.09, 0.2, mat, 0, -0.015, 0.24)              // stock
    .cyl(0.024, 0.024, 0.13, mat, 0, 0.075, -0.02, Math.PI / 2, 0, 0, 10) // optic
    .build(rifle);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.66); rifle.add(muzzle);
  rifle.updateMatrix();
  // Arms solved with two-bone IK so both hands land ON the rifle (grip + handguard)
  // instead of hand-tuned angles that float or clip through the body.
  const UPPER = 0.29, FORE = 0.29;
  const down = new THREE.Vector3(0, -1, 0);
  const arm = (x: number, handLocal: THREE.Vector3, pole: THREE.Vector3) => {
    const sh = new THREE.Group(); sh.position.set(x, 0.55, 0); torso.add(sh);
    new Parts().capsule(0.052, UPPER - 0.08, mat, 0, -UPPER / 2, 0).rbox(0.11, 0.07, 0.12, 0.03, mat, 0, -0.02, 0).build(sh);
    const el = new THREE.Group(); el.position.y = -UPPER; sh.add(el);
    new Parts().capsule(0.045, FORE - 0.1, mat, 0, -FORE / 2 + 0.02, 0).rbox(0.07, 0.09, 0.055, 0.02, mat, 0, -FORE, 0).build(el);
    const target = handLocal.clone().applyMatrix4(rifle.matrix);
    const toT = target.clone().sub(sh.position);
    const d = Math.min(toT.length(), UPPER + FORE - 1e-3);
    const dir = toT.normalize();
    // elbow: law of cosines, bent toward the pole direction
    const cosA = (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d);
    const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = dir.clone().multiplyScalar(cosA * UPPER).addScaledVector(bend, Math.sqrt(Math.max(0, 1 - cosA * cosA)) * UPPER);
    const qU = new THREE.Quaternion().setFromUnitVectors(down, elbow.clone().normalize());
    sh.quaternion.copy(qU);
    const foreDir = dir.clone().multiplyScalar(d).sub(elbow).normalize();
    el.quaternion.copy(qU.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(down, foreDir)));
    return sh;
  };
  const rArm = arm(0.22, new THREE.Vector3(0, -0.08, 0.075), new THREE.Vector3(0.8, -1, 0.3));
  const lArm = arm(-0.22, new THREE.Vector3(-0.01, -0.04, -0.24), new THREE.Vector3(-0.9, -1, 0.1));
  // legs: hip pivot → thigh → knee pivot → shin, knee pad, boot
  const leg = (x: number) => {
    const hip = new THREE.Group(); hip.position.set(x, 0.95, 0); root.add(hip);
    new Parts().capsule(0.078, 0.28, mat, 0, -0.22, 0).build(hip);
    const knee = new THREE.Group(); knee.position.y = -0.45; hip.add(knee);
    new Parts()
      .capsule(0.062, 0.3, mat, 0, -0.2, 0)
      .rbox(0.1, 0.11, 0.05, 0.02, mat, 0, -0.02, -0.06)
      .rbox(0.11, 0.09, 0.26, 0.03, mat, 0, -0.45, -0.04)
      .build(knee);
    knee.rotation.x = 0.08;
    return hip;
  };
  const lLeg = leg(-0.11), rLeg = leg(0.11);
  return { root, torso, lLeg, rLeg, lArm, rArm, muzzle };
}

let depthOnly: THREE.MeshBasicMaterial | null = null;
/**
 * Hologram clean-up: every holo mesh gets a depth-only twin drawn in the opaque pass.
 * The additive hologram then only shows its FRONT surface, instead of every limb,
 * pouch and rifle part glowing through each other into a tangled mess.
 */
function addDepthPrepass(root: THREE.Object3D) {
  depthOnly ??= new THREE.MeshBasicMaterial({ colorWrite: false });
  const list: THREE.Mesh[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh) list.push(o); });
  for (const mesh of list) {
    const d = new THREE.Mesh(mesh.geometry, depthOnly);
    d.renderOrder = -1; d.frustumCulled = mesh.frustumCulled;
    d.userData.sharedGeometry = true;
    mesh.add(d);
  }
}

// ---------------------------------------------------------------------------------
// Radar tag: through-wall body silhouette
// ---------------------------------------------------------------------------------
export interface TagGhost {
  group: THREE.Group;
  mat: THREE.ShaderMaterial;
}

let ghostGeo: THREE.BufferGeometry | null = null;
/** One merged soldier geometry shared by every silhouette (1 draw each). */
function ghostGeometry(): THREE.BufferGeometry {
  if (ghostGeo) return ghostGeo;
  const tmp = new THREE.MeshBasicMaterial();
  const rig = buildSoldier(tmp);
  rig.root.updateMatrixWorld(true);
  const list: THREE.BufferGeometry[] = [];
  rig.root.traverse(o => { if (o instanceof THREE.Mesh) { list.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); o.geometry.dispose(); } });
  ghostGeo = mergeGeometries(list)!;
  for (const g of list) g.dispose();
  tmp.dispose();
  return ghostGeo;
}

/**
 * A full soldier silhouette drawn through walls in radar cyan, so a found enemy reads
 * as a body (stance, facing, crouch height) rather than a floating dot. The geometry is
 * shared; each ghost owns its material so it can fade on its own clock.
 */
export function buildTagGhost(throughWalls = true): TagGhost {
  const mat = makeHoloMaterial(0x5fe3ff, throughWalls);
  mat.opacity = 0.35;
  const group = new THREE.Group();
  const body = new THREE.Mesh(ghostGeometry(), mat);
  body.renderOrder = 50; body.frustumCulled = false;
  group.add(body);
  // In the menu (no walls to see through) the silhouette is drawn front-surface only.
  if (!throughWalls) addDepthPrepass(group);
  group.visible = false;
  return { group, mat };
}

// ---------------------------------------------------------------------------------
// Barricade: folding ballistic shield
// ---------------------------------------------------------------------------------
export interface BarricadeModel {
  group: THREE.Group;
  /** The meshes bullets and AI line-of-sight stop against (registered as occluders). */
  plates: THREE.Mesh[];
  /** Amber beacon: steady when healthy, flickers under 35 % integrity (own material). */
  lamp: THREE.Mesh;
  /** Hinge pivots of the two wing plates: rotated ±90° when folded, 0 when deployed. */
  wings: THREE.Group[];
  /** Per-barricade plate material: tinted toward scorched steel as integrity drops. */
  plateMat: THREE.MeshStandardMaterial;
}

/** Armour panel outline: chamfered top corners, a notch at the top of the centre panel. */
function panelShape(w: number, h: number, chamfer: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h - chamfer);
  s.lineTo(w / 2 - chamfer, h);
  s.lineTo(-w / 2 + chamfer, h);
  s.lineTo(-w / 2, h - chamfer);
  s.closePath();
  return s;
}

/**
 * A three-panel folding ballistic shield `width` × `height`, threat face toward local -Z:
 * bevelled armour panels in worn olive, a steel edge frame with rivets, a hazard band, a
 * recessed ballistic-glass viewport, rear handles and ribs, hinge barrels, outrigger feet
 * with rubber pads, kick-stands and a caged amber beacon.
 */
export function buildBarricade(width: number, height: number, depth: number): BarricadeModel {
  const m = M();
  const group = new THREE.Group();
  const plates: THREE.Mesh[] = [];
  const wings: THREE.Group[] = [];
  const plateMat = m.olive.clone();
  const pw = width / 3;
  for (let i = 0; i < 3; i++) {
    const centre = i === 1;
    const hingeX = i === 0 ? -pw / 2 : pw / 2;
    const parent = centre ? group : new THREE.Group();
    if (!centre) { parent.position.set(hingeX, 0, 0); group.add(parent); wings.push(parent as THREE.Group); }
    const x = centre ? 0 : (i === 0 ? -pw / 2 : pw / 2);
    const h = centre ? height : height * 0.93;
    const w = pw - 0.025;
    // armour panel (the occluder): extruded with a bevel so edges catch the light
    const bevel = Math.min(0.012, depth * 0.2);
    const geo = new THREE.ExtrudeGeometry(panelShape(w - bevel * 2, h - bevel * 2, 0.12), { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    geo.translate(0, bevel, -(depth - bevel * 2) / 2);
    // planar UVs so the worn texture spans the panel instead of stretching per face
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) + w / 2) / 1.2, pos.getY(k) / 1.2);
    geo.computeVertexNormals();
    const plate = new THREE.Mesh(geo, plateMat);
    plate.position.set(x, 0, 0);
    parent.add(plate);
    plates.push(plate);
    // detail, merged per material into the same pivot
    const fz = -depth / 2 - 0.006; // front face
    const d = new Parts()
      .box(w, 0.035, 0.014, m.gunmetal, x, 0.05, fz)               // bottom frame
      .box(0.03, h - 0.2, 0.014, m.gunmetal, x - w / 2 + 0.02, (h - 0.2) / 2 + 0.05, fz)
      .box(0.03, h - 0.2, 0.014, m.gunmetal, x + w / 2 - 0.02, (h - 0.2) / 2 + 0.05, fz)
      .box(w - 0.26, 0.07, 0.01, m.hazard, x, h - 0.17, fz - 0.002) // hazard band
      .box(w - 0.14, 0.03, 0.012, m.gunmetal, x, h * 0.45, fz)     // mid rib
      .box(w - 0.1, 0.05, 0.03, m.gunmetal, x, h * 0.35, depth / 2 + 0.015) // rear ribs
      .box(w - 0.1, 0.05, 0.03, m.gunmetal, x, h * 0.7, depth / 2 + 0.015);
    for (let r = 0; r < 5; r++) {
      const ry = 0.12 + r * (h - 0.35) / 4;
      d.cyl(0.011, 0.011, 0.012, m.steel, x - w / 2 + 0.02, ry, fz - 0.008, Math.PI / 2, 0, 0, 6);
      d.cyl(0.011, 0.011, 0.012, m.steel, x + w / 2 - 0.02, ry, fz - 0.008, Math.PI / 2, 0, 0, 6);
    }
    // rear carry handle
    d.cyl(0.012, 0.012, 0.22, m.rubber, x, h * 0.55, depth / 2 + 0.07, 0, 0, Math.PI / 2, 8)
      .box(0.02, 0.02, 0.07, m.gunmetal, x - 0.11, h * 0.55, depth / 2 + 0.035)
      .box(0.02, 0.02, 0.07, m.gunmetal, x + 0.11, h * 0.55, depth / 2 + 0.035);
    if (centre) {
      // recessed viewport: frame + ballistic glass, and the stencil label under it
      d.box(0.42, 0.14, 0.018, m.gunmetal, 0, h - 0.33, fz - 0.002)
        .box(0.36, 0.085, 0.02, m.glass, 0, h - 0.33, fz - 0.006)
        .box(0.3, 0.075, 0.004, m.label, 0, h * 0.58, fz - 0.004);
    } else {
      // hinge barrels on the joint with the centre panel
      const hx = x + (i === 0 ? w / 2 + 0.012 : -w / 2 - 0.012);
      for (const hy of [0.25, h * 0.5, h - 0.3]) d.cyl(0.02, 0.02, 0.14, m.steel, hx, hy, 0);
    }
    d.build(parent);
  }
  // base: outrigger feet with rubber pads and kick-stands on the friendly (+Z) side
  const base = new Parts();
  for (const x of [-width / 2 + 0.3, width / 2 - 0.3]) {
    base.box(0.06, 0.05, 0.5, m.gunmetal, x, 0.025, 0.25)
      .rbox(0.1, 0.03, 0.12, 0.01, m.rubber, x, 0.015, 0.5)
      .box(0.04, 0.04, 0.6, m.gunmetal, x, 0.3, 0.26, 0.9, 0, 0);
  }
  base.box(width * 0.98, 0.07, 0.16, m.dark, 0, 0.035, 0.02)
    .box(0.06, 0.08, 0.08, m.gunmetal, 0.3, height + 0.01, 0.02); // beacon mount
  base.build(group);
  // caged beacon (own material so each barricade flickers independently)
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), m.amber.clone());
  lamp.position.set(0.3, height + 0.08, 0.02);
  group.add(lamp);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, 4, 12), m.gunmetal);
  cage.position.copy(lamp.position); cage.rotation.x = Math.PI / 2;
  group.add(cage);
  return { group, plates, lamp, wings, plateMat };
}

// ---------------------------------------------------------------------------------
// Decoy: hologram operator on a projector base
// ---------------------------------------------------------------------------------
export interface DecoyModel {
  group: THREE.Group;
  lLeg: THREE.Object3D; rLeg: THREE.Object3D;
  lArm: THREE.Object3D; rArm: THREE.Object3D;
  /** Muzzle socket for the fake shots. */
  muzzle: THREE.Object3D;
  /** The hologram shader (opacity bound; advance `uniforms.uTime`). */
  mat: THREE.ShaderMaterial;
  /** Projector base at the hologram's feet. */
  puck: THREE.Object3D;
  /** Projector cone from the base up through the body (additive). */
  cone: THREE.Mesh;
  /** Horizontal scan ring that sweeps up the body. */
  scan: THREE.Mesh;
  /** Upper body pivot (glitch slices offset it sideways). */
  torso: THREE.Group;
  /** Kept for API compatibility: the shader draws its own scanlines. */
  lines: THREE.CanvasTexture | null;
}

export function buildDecoy(): DecoyModel {
  const m = M();
  const mat = makeHoloMaterial(0x7cf5d8);
  const rig = buildSoldier(mat);
  const group = new THREE.Group();
  group.add(rig.root);
  addDepthPrepass(rig.root);
  // projector base: armoured disc, emitter lens, light ring and three stub feet
  const puck = new THREE.Group();
  new Parts()
    .cyl(0.18, 0.22, 0.05, m.gunmetal, 0, 0.025, 0, 0, 0, 0, 16)
    .cyl(0.12, 0.16, 0.03, m.dark, 0, 0.065, 0, 0, 0, 0, 16)
    .cyl(0.05, 0.05, 0.02, m.glass, 0, 0.088, 0, 0, 0, 0, 12)
    .box(0.07, 0.02, 0.06, m.rubber, 0.19, 0.01, 0).box(0.07, 0.02, 0.06, m.rubber, -0.1, 0.01, 0.17).box(0.07, 0.02, 0.06, m.rubber, -0.1, 0.01, -0.17)
    .build(puck);
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.008, 6, 32), m.cyan);
  glow.rotation.x = Math.PI / 2; glow.position.y = 0.081;
  puck.add(glow);
  group.add(puck);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x7cf5d8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.06, 1.9, 24, 1, true), coneMat);
  cone.position.y = 1.03;
  group.add(cone);
  const scanMat = new THREE.MeshBasicMaterial({ color: 0xe8fdff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const scan = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.32, 32), scanMat);
  scan.rotation.x = -Math.PI / 2;
  group.add(scan);
  return { group, lLeg: rig.lLeg, rLeg: rig.rLeg, lArm: rig.lArm, rArm: rig.rArm, muzzle: rig.muzzle, mat, puck, cone, scan, torso: rig.torso, lines: null };
}

// ---------------------------------------------------------------------------------
// Mine: bounding proximity mine — olive canister, fuze prongs, red eye, trigger ring
// ---------------------------------------------------------------------------------
export interface MineModel {
  group: THREE.Group;
  /** The canister (jumps up out of the ground when tripped). */
  body: THREE.Group;
  /** Red status eye (own material — blinks faster once armed). */
  led: THREE.Mesh;
  /** Ground ring at the trigger radius (own material; radius 1, scaled by the owner). */
  ring: THREE.Mesh;
  /** Thin laser fan lines sweeping from the fuze (own material). */
  laser: THREE.Mesh;
}

export function buildMine(): MineModel {
  const m = M();
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const p = new Parts()
    // canister: slightly tapered, rubber base ring, ribbed band, dark lid
    .cyl(0.095, 0.105, 0.075, m.olive, 0, 0.045, 0, 0, 0, 0, 20)
    .add(new THREE.TorusGeometry(0.103, 0.012, 6, 20), m.rubber, 0, 0.012, 0, Math.PI / 2)
    .cyl(0.1, 0.1, 0.012, m.gunmetal, 0, 0.062, 0, 0, 0, 0, 20)
    .cyl(0.085, 0.092, 0.018, m.dark, 0, 0.09, 0, 0, 0, 0, 20)
    // fuze well + three prongs + pull ring
    .cyl(0.028, 0.032, 0.03, m.gunmetal, 0, 0.112, 0, 0, 0, 0, 12)
    .add(new THREE.TorusGeometry(0.02, 0.003, 5, 14), m.steel, 0.045, 0.1, 0, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    p.cyl(0.0035, 0.0035, 0.05, m.steel, Math.sin(a) * 0.012, 0.15, Math.cos(a) * 0.012, 0, 0, 0, 5);
    p.sphere(0.006, m.steel, Math.sin(a) * 0.012, 0.176, Math.cos(a) * 0.012, 1, 1, 1, 6);
  }
  for (let i = 0; i < 6; i++) { // lid bolts
    const a = i * Math.PI / 3 + 0.3;
    p.cyl(0.006, 0.006, 0.006, m.steel, Math.sin(a) * 0.07, 0.1, Math.cos(a) * 0.07, 0, 0, 0, 6);
  }
  p.box(0.05, 0.02, 0.003, m.hazard, 0, 0.045, 0.101); // hazard band on the side
  p.build(body);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 6),
    new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff3b2f, emissiveIntensity: 2.5, roughness: 0.3 }));
  led.position.set(-0.045, 0.1, 0.03);
  body.add(led);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015;
  group.add(ring);
  // laser fan: a thin flat wedge of red light that sweeps around (tripwire read)
  const laser = new THREE.Mesh(new THREE.CircleGeometry(1, 16, -0.05, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  laser.rotation.x = -Math.PI / 2; laser.position.y = 0.02;
  group.add(laser);
  return { group, body, led, ring, laser };
}

/** Disposes the mine's own materials (geometry via disposeAbilityObject). */
export function disposeMine(mm: MineModel) {
  disposeAbilityObject(mm.group);
  for (const o of [mm.led, mm.ring, mm.laser]) (o.material as THREE.Material).dispose();
}

// ---------------------------------------------------------------------------------
// Medkit: rugged med case that opens into a healing station with a holo cross
// ---------------------------------------------------------------------------------
export interface MedkitModel {
  group: THREE.Group;
  /** 0 = closed case, 1 = lid open, emitter up, cross lit. */
  setOpen(k: number): void;
  /** Spinning holo cross above the case. */
  cross: THREE.Group;
  /** Cross + vial glow (own material). */
  glow: THREE.MeshStandardMaterial;
  /** Ground ring at the heal radius (own material; radius 1, scaled by the owner). */
  ring: THREE.Mesh;
  /** Soft dome showing the field (own material; radius 1, scaled by the owner). */
  dome: THREE.Mesh;
}

let medTex: THREE.CanvasTexture | null | undefined;
/** Off-white case paint with a green medical cross and light grime. */
function medPaint(): THREE.CanvasTexture | null {
  if (medTex !== undefined) return medTex;
  const cg = canvas(128, 128);
  if (!cg) return (medTex = null);
  const [c, g] = cg;
  g.fillStyle = '#d9d6cc'; g.fillRect(0, 0, 128, 128);
  const r = rng(11);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(90,85,70,${0.05 + r() * 0.08})`; g.fillRect(r() * 128, r() * 128, 1 + r() * 4, 1 + r() * 4); }
  g.fillStyle = '#1f9c5a'; g.fillRect(52, 28, 24, 72); g.fillRect(28, 52, 72, 24);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.strokeRect(4, 4, 120, 120);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (medTex = t);
}
let medMat: THREE.MeshStandardMaterial | null = null;

export function buildMedkit(): MedkitModel {
  const m = M();
  medMat ??= new THREE.MeshStandardMaterial({ color: 0xffffff, map: medPaint(), roughness: 0.6, metalness: 0.15 });
  const group = new THREE.Group();
  const W = 0.5, H = 0.13, D = 0.34;
  // base tray: painted shell, rubber corners, handle and latches
  const base = new Parts()
    .rbox(W, H, D, 0.03, m.dark, 0, H / 2, 0)
    .rbox(W - 0.02, 0.012, D - 0.02, 0.005, m.gunmetal, 0, H + 0.001, 0)
    .rbox(W * 0.9, 0.03, D * 0.85, 0.01, m.rubber, 0, H - 0.01, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.rbox(0.05, H + 0.012, 0.05, 0.015, m.rubber, sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02));
  for (const sx of [-1, 1]) base.box(0.04, 0.03, 0.012, m.steel, sx * 0.14, H - 0.02, D / 2 + 0.004);
  base.cyl(0.012, 0.012, 0.16, m.gunmetal, 0, H * 0.6, D / 2 + 0.03, 0, 0, Math.PI / 2, 8);
  // insides: foam bed with vials and a bandage roll
  base.box(W - 0.06, 0.01, D - 0.06, m.rubber, 0, H - 0.005, 0);
  base.cyl(0.035, 0.035, 0.07, medMat, 0.14, H + 0.02, -0.06, 0, 0, Math.PI / 2, 12);
  base.build(group);
  const glow = new THREE.MeshStandardMaterial({ color: 0x6cff9a, emissive: 0x3cff7a, emissiveIntensity: 2.2, roughness: 0.3, transparent: true, opacity: 0.95 });
  const vials = new Parts();
  for (let i = 0; i < 4; i++) vials.cyl(0.014, 0.014, 0.07, glow, -0.17 + i * 0.045, H + 0.025, 0.05, 0, 0, 0, 8);
  vials.build(group);
  // lid: painted panel with the cross, hinged on the back edge
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  group.add(lid);
  new Parts()
    .rbox(W, 0.05, D, 0.025, m.dark, 0, 0.025, D / 2)
    .add(new THREE.PlaneGeometry(W * 0.62, D * 0.8), medMat, 0, 0.0515, D / 2, -Math.PI / 2)
    .build(lid);
  // emitter mast + holo cross
  const mast = new THREE.Group();
  mast.position.set(0, H, 0.02);
  group.add(mast);
  new Parts()
    .cyl(0.03, 0.036, 0.03, m.gunmetal, 0, 0.015, 0, 0, 0, 0, 12)
    .cyl(0.01, 0.012, 0.36, m.steel, 0, 0.2, 0, 0, 0, 0, 8)
    .build(mast);
  const cross = new THREE.Group();
  cross.position.y = 0.52;
  mast.add(cross);
  new Parts()
    .rbox(0.07, 0.22, 0.03, 0.01, glow, 0, 0, 0)
    .rbox(0.22, 0.07, 0.03, 0.01, glow, 0, 0, 0)
    .build(cross);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.006, 6, 40), glow);
  cross.add(halo);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72),
    new THREE.MeshBasicMaterial({ color: 0x6cff9a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015;
  group.add(ring);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), fresnelShell(0x6cff9a));
  group.add(dome);

  const setOpen = (k: number) => {
    const e = Math.max(0, Math.min(1, k));
    lid.rotation.x = -e * 1.9; // swings up and back past vertical
    const up = Math.max(0, Math.min(1, (e - 0.3) / 0.7));
    mast.scale.set(1, Math.max(0.02, up), 1);
    cross.scale.setScalar(Math.max(0.02, up));
    glow.emissiveIntensity = 0.3 + up * 1.9;
  };
  setOpen(0);
  return { group, setOpen, cross, glow, ring, dome };
}

/** Disposes the medkit's own materials (geometry via disposeAbilityObject). */
export function disposeMedkit(mk: MedkitModel) {
  disposeAbilityObject(mk.group);
  mk.glow.dispose();
  (mk.ring.material as THREE.Material).dispose();
  (mk.dome.material as THREE.Material).dispose();
}

// ---------------------------------------------------------------------------------
// Reveal marker (through-wall radar tag)
// ---------------------------------------------------------------------------------
/** Cyan hollow diamond: reads as "radar contact" at a glance. */
export function makeSonarMarkerMaterial(): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.translate(32, 32); ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = 'rgba(10,20,24,0.9)';
  ctx.lineWidth = 9;
  ctx.strokeRect(-14, -14, 28, 28);
  ctx.strokeStyle = 'rgba(95,227,255,0.98)';
  ctx.lineWidth = 5;
  ctx.strokeRect(-14, -14, 28, 28);
  ctx.fillStyle = 'rgba(95,227,255,0.9)';
  ctx.fillRect(-4, -4, 8, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false });
}

/** Disposes geometries under an ability object (shared materials and the shared ghost body are kept). */
export function disposeAbilityObject(o: THREE.Object3D) {
  o.traverse(c => { if (c instanceof THREE.Mesh && c.geometry !== ghostGeo && !c.userData.sharedGeometry) c.geometry.dispose(); });
}

/** Everything the decoy owns beyond geometry: hologram, cone and scan materials. */
export function disposeDecoy(m: DecoyModel) {
  disposeAbilityObject(m.group);
  m.mat.dispose();
  (m.cone.material as THREE.Material).dispose();
  (m.scan.material as THREE.Material).dispose();
}
