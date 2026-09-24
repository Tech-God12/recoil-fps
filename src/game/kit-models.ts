// Recoil FPS — procedural field-kit hardware: the Radar unit, the Barricade and the
// Decoy hologram. Everything is built from primitives at runtime (no model files),
// but detail parts are MERGED per material so a deployed kit costs a handful of draw
// calls no matter how many rivets, pouches and struts it carries.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------------
// Shared materials + procedural textures (created once, shared by every kit)
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

// ---------------------------------------------------------------------------------
// Radar: throwable ground radar — hex puck, tripod legs, telescopic mast, spinning dish
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
  // body: rubber-bumpered hex puck with an armoured top deck and vent slots
  const body = new Parts()
    .cyl(0.15, 0.17, 0.075, m.olive, 0, 0.055, 0, 0, Math.PI / 6, 0, 6)
    .add(new THREE.TorusGeometry(0.165, 0.018, 6, 6), m.rubber, 0, 0.03, 0, Math.PI / 2, 0, Math.PI / 6)
    .cyl(0.12, 0.14, 0.03, m.gunmetal, 0, 0.105, 0, 0, Math.PI / 6, 0, 6)
    .cyl(0.045, 0.05, 0.03, m.dark, 0, 0.13, 0, 0, 0, 0, 12);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    body.box(0.05, 0.012, 0.012, m.dark, Math.sin(a) * 0.1, 0.121, Math.cos(a) * 0.1, 0, a, 0); // vents
    body.cyl(0.008, 0.008, 0.01, m.steel, Math.sin(a + 0.5) * 0.125, 0.122, Math.cos(a + 0.5) * 0.125); // bolts
  }
  body.build(group);
  // status light ring (own material)
  const ledMat = m.cyan.clone();
  const led = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.007, 6, 24), ledMat);
  led.rotation.x = Math.PI / 2; led.position.y = 0.093;
  group.add(led);
  // tripod legs
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 6;
    const hinge = new THREE.Group();
    hinge.position.set(Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15);
    hinge.rotation.y = a;
    new Parts()
      .box(0.024, 0.022, 0.2, m.gunmetal, 0, 0, 0.1)
      .cyl(0.012, 0.012, 0.035, m.steel, 0, 0, 0, 0, 0, Math.PI / 2, 8)
      .rbox(0.05, 0.02, 0.05, 0.008, m.rubber, 0, -0.01, 0.2)
      .build(hinge);
    group.add(hinge);
    legs.push(hinge);
  }
  // telescopic mast
  const mast = new THREE.Group();
  mast.position.y = 0.14;
  new Parts()
    .cyl(0.022, 0.026, 0.2, m.gunmetal, 0, 0.1, 0)
    .cyl(0.015, 0.015, 0.16, m.steel, 0, 0.27, 0)
    .cyl(0.03, 0.03, 0.02, m.dark, 0, 0.2, 0)
    .build(mast);
  group.add(mast);
  // radar head: parabolic dish on a yoke with feed horn and counterweight
  const dish = new THREE.Group();
  dish.position.y = 0.36;
  mast.add(dish);
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) { const r = 0.012 + (i / 8) * 0.13; prof.push(new THREE.Vector2(r, (r * r) * 2.2)); }
  const dishGeo = new THREE.LatheGeometry(prof, 20);
  const head = new Parts()
    .box(0.07, 0.03, 0.04, m.gunmetal, 0, 0.0, 0)
    .box(0.012, 0.09, 0.03, m.gunmetal, -0.05, 0.045, 0)
    .box(0.012, 0.09, 0.03, m.gunmetal, 0.05, 0.045, 0)
    .add(dishGeo, m.steel, 0, 0.09, -0.02, -Math.PI / 2 + 0.25, 0, 0)
    .cyl(0.004, 0.004, 0.13, m.dark, 0, 0.13, -0.08, -Math.PI / 2 + 0.25 + Math.PI / 2 - 0.2, 0, 0, 6)
    .rbox(0.08, 0.05, 0.05, 0.01, m.dark, 0, 0.07, 0.07)
    .cyl(0.003, 0.003, 0.22, m.dark, 0.04, 0.2, 0.07, 0, 0, 0, 5)
    .sphere(0.008, m.amber, 0.04, 0.31, 0.07, 1, 1, 1, 8);
  head.build(dish);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.03, 8), m.cyan);
  horn.position.set(0, 0.11, -0.16); horn.rotation.x = Math.PI / 2 + 0.25;
  dish.add(horn);

  const setDeploy = (k: number) => {
    const e = Math.max(0, Math.min(1, k));
    // legs fold up flat against the puck, then swing down/out to 35°
    for (const l of legs) l.rotation.x = THREE.MathUtils.lerp(-1.4, 0.62, e);
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
        float rim = pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.0);
        float scan = 0.72 + 0.28*step(0.5, fract(vY*38.0 - uTime*1.6));
        float band = smoothstep(0.12,0.0,abs(fract(vY*0.45 - uTime*0.35)-0.5));
        float a = uOpacity*(0.22 + rim*1.1 + band*0.5)*scan;
        gl_FragColor = vec4(uColor*(0.6+rim*0.9+band), a);
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
  // rifle, held across the chest pointing -Z
  const rifle = new THREE.Group(); rifle.position.set(0.07, 0.4, -0.22); torso.add(rifle);
  new Parts()
    .box(0.05, 0.08, 0.3, mat, 0, 0, 0)                 // receiver
    .box(0.045, 0.055, 0.28, mat, 0, 0.005, -0.28)      // handguard
    .cyl(0.011, 0.011, 0.2, mat, 0, 0.01, -0.52, Math.PI / 2, 0, 0, 8) // barrel
    .cyl(0.018, 0.018, 0.05, mat, 0, 0.01, -0.63, Math.PI / 2, 0, 0, 8) // muzzle device
    .box(0.035, 0.15, 0.07, mat, 0, -0.1, -0.06, 0.22, 0, 0) // magazine
    .box(0.03, 0.09, 0.04, mat, 0, -0.07, 0.08, -0.3, 0, 0)  // grip
    .box(0.04, 0.09, 0.22, mat, 0, -0.015, 0.25)             // stock
    .cyl(0.024, 0.024, 0.13, mat, 0, 0.075, -0.02, Math.PI / 2, 0, 0, 10) // optic
    .build(rifle);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.66); rifle.add(muzzle);
  // arms: shoulder pivot → upper arm → elbow pivot → forearm + glove
  const arm = (x: number, sx: number, ex: number, sz: number) => {
    const sh = new THREE.Group(); sh.position.set(x, 0.55, 0); torso.add(sh);
    new Parts().capsule(0.052, 0.2, mat, 0, -0.14, 0).build(sh);
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
    new Parts().capsule(0.046, 0.19, mat, 0, -0.12, 0).rbox(0.07, 0.09, 0.05, 0.02, mat, 0, -0.27, 0).build(el);
    sh.rotation.set(sx, 0, sz); el.rotation.x = ex;
    return sh;
  };
  const rArm = arm(0.23, -0.5, -1.35, -0.2);
  const lArm = arm(-0.23, -1.2, -0.6, 0.55);
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
export function buildTagGhost(): TagGhost {
  const mat = makeHoloMaterial(0x5fe3ff, true);
  mat.opacity = 0.35;
  const group = new THREE.Group();
  const body = new THREE.Mesh(ghostGeometry(), mat);
  body.renderOrder = 50; body.frustumCulled = false;
  group.add(body);
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
// Reveal marker (through-wall radar tag)
// ---------------------------------------------------------------------------------
/** Cyan hollow diamond, distinct from the red UAV marker so the two intel sources never blur. */
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

/** Disposes geometries under a kit object (shared materials and the shared ghost body are kept). */
export function disposeKitObject(o: THREE.Object3D) {
  o.traverse(c => { if (c instanceof THREE.Mesh && c.geometry !== ghostGeo) c.geometry.dispose(); });
}

/** Everything the decoy owns beyond geometry: hologram, cone and scan materials. */
export function disposeDecoy(m: DecoyModel) {
  disposeKitObject(m.group);
  m.mat.dispose();
  (m.cone.material as THREE.Material).dispose();
  (m.scan.material as THREE.Material).dispose();
}
