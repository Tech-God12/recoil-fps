// Recoil FPS — Weapon + character models v3
// Every model uses ONE atlas material and merged geometry → 1-8 draw calls per model.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AttachSlot, WeaponId } from './economy/catalog';
import type { SkinDef, SkinRole } from './economy/skins';

type Region = [number, number, number, number]; // u0 v0 u1 v1

/* ---------- Atlas painters ---------- */
function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; }
function noise(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, a: number) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
}
function fill(ctx: CanvasRenderingContext2D, r: Region, S: number, color: string, grain = 600, ga = 0.08) {
  const x = r[0] * S, y = r[1] * S, w = (r[2] - r[0]) * S, h = (r[3] - r[1]) * S;
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h); noise(ctx, x, y, w, h, grain, ga);
}

// soldier atlas regions
const SR = {
  camo: [0, 0, .5, .5] as Region, vest: [.5, 0, 1, .5] as Region, skin: [0, .5, .25, .75] as Region,
  black: [.25, .5, .5, .75] as Region, boot: [.5, .5, .75, .75] as Region, helmet: [.75, .5, 1, .75] as Region,
  webbing: [0, .75, .25, 1] as Region, visor: [.25, .75, .5, 1] as Region, olive: [.5, .75, .75, 1] as Region,
};
let soldierMat: THREE.MeshStandardMaterial | null = null;
function getSoldierMat() {
  if (soldierMat) return soldierMat;
  const S = 512; const [c, ctx] = canvas(S, S);
  // desert camo
  fill(ctx, SR.camo, S, '#8A7A57', 0);
  const cx = SR.camo[0] * S, cy = SR.camo[1] * S, cw = .5 * S;
  const camoCols = ['#6E6142', '#A0906A', '#5A4E33', '#B7A57C'];
  for (let i = 0; i < 260; i++) { ctx.fillStyle = camoCols[i % 4]; ctx.beginPath(); ctx.ellipse(cx + Math.random() * cw, cy + Math.random() * cw, 6 + Math.random() * 16, 4 + Math.random() * 10, Math.random() * 3, 0, 7); ctx.fill(); }
  noise(ctx, cx, cy, cw, cw, 3000, 0.06);
  fill(ctx, SR.vest, S, '#2F2D26', 1500, 0.07);
  // vest stitching / molle rows
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
  for (let y = 0; y < cw; y += 22) { ctx.beginPath(); ctx.moveTo(SR.vest[0] * S, cy + y); ctx.lineTo(S, cy + y); ctx.stroke(); }
  fill(ctx, SR.skin, S, '#A67B58', 400, 0.05);
  fill(ctx, SR.black, S, '#17181A', 500, 0.05);
  fill(ctx, SR.boot, S, '#2B2118', 500, 0.08);
  fill(ctx, SR.helmet, S, '#4A4A34', 800, 0.07);
  fill(ctx, SR.webbing, S, '#7A6A46', 600, 0.08);
  fill(ctx, SR.visor, S, '#0B0E12', 200, 0.03);
  fill(ctx, SR.olive, S, '#55603A', 600, 0.07);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  soldierMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.05 });
  return soldierMat;
}

/* ---------- geometry helpers ---------- */
function uvTo(g: THREE.BufferGeometry, r: Region) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) { uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]) * 0.9 + 0.02, r[1] + uv.getY(i) * (r[3] - r[1]) * 0.9 + 0.02); }
  return g;
}
const E = new THREE.Euler(); const Q = new THREE.Quaternion(); const V1 = new THREE.Vector3(1, 1, 1); const MT = new THREE.Matrix4();
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  Q.setFromEuler(E.set(rx, ry, rz)); MT.compose(new THREE.Vector3(x, y, z), Q, V1); g.applyMatrix4(MT); return g;
}
class Part {
  geos: THREE.BufferGeometry[] = [];
  box(w: number, h: number, d: number, r: Region, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { this.geos.push(place(uvTo(new THREE.BoxGeometry(w, h, d), r), x, y, z, rx, ry, rz)); return this; }
  cyl(rt: number, rb: number, h: number, seg: number, r: Region, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { this.geos.push(place(uvTo(new THREE.CylinderGeometry(rt, rb, h, seg), r), x, y, z, rx, ry, rz)); return this; }
  sph(rad: number, r: Region, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, phi = Math.PI) { const g = new THREE.SphereGeometry(rad, 12, 10, 0, Math.PI * 2, 0, phi); g.scale(sx, sy, sz); this.geos.push(place(uvTo(g, r), x, y, z)); return this; }
  tor(rad: number, tube: number, r: Region, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { this.geos.push(place(uvTo(new THREE.TorusGeometry(rad, tube, 6, 16), r), x, y, z, rx, ry, rz)); return this; }
  mesh(m: THREE.Material, castShadow = true) {
    const g = mergeGeometries(this.geos, false)!;
    for (const x of this.geos) x.dispose();
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = castShadow; mesh.receiveShadow = true; return mesh;
  }
}

/* ================= WEAPONS ================= */
export interface LArmKey { t: number; p: [number, number, number]; r: [number, number, number] }
export interface WeaponModel {
  group: THREE.Group;
  mag: THREE.Object3D;
  chargingHandle: THREE.Object3D;
  muzzle: THREE.Object3D;
  sightY: number;
  optic: THREE.Object3D;
  lArm: THREE.Object3D | null;   // animated left arm (reload)
  lArmKeys: LArmKey[];           // reload keyframes, t in 0..1
  adsHidden: THREE.Object3D[];   // in-model reticles/lenses hidden in ADS (HUD draws the single clean sight)
  sockets: Partial<Record<AttachSlot, THREE.Object3D>>;    // mount points for Armory parts
  removable: Partial<Record<AttachSlot, THREE.Object3D[]>>; // stock meshes hidden while a part is equipped
  attached: Partial<Record<AttachSlot, THREE.Object3D>>;    // currently mounted components (runtime)
}

/** Empty mount point in gun-local space (barrel along −Z). */
export function makeSocket(x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.userData.socket = true;
  return o;
}

export const WM = {
  poly: new THREE.MeshStandardMaterial({ color: 0x1B1D1F, roughness: 0.5, metalness: 0.4 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x565B62, roughness: 0.32, metalness: 0.9 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x2A2D31, roughness: 0.45, metalness: 0.8 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x7A6A45, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0E0E10, roughness: 0.5, metalness: 0.4 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6E4625, roughness: 0.7 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4E2F16, roughness: 0.75 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0C0C0C, roughness: 0.95 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xC89838, roughness: 0.3, metalness: 0.95 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x5C564A, roughness: 0.95 }),
  sleeveDark: new THREE.MeshStandardMaterial({ color: 0x46413A, roughness: 0.95 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x2E2820, roughness: 0.9 }),
  glass: new THREE.MeshBasicMaterial({ color: 0x9FD4E8, transparent: true, opacity: 0.16, depthWrite: false }),
  reticle: new THREE.MeshBasicMaterial({ color: 0xFF2828 }),
  scopeInner: new THREE.MeshBasicMaterial({ color: 0x060708, side: THREE.DoubleSide }),
  tritium: new THREE.MeshBasicMaterial({ color: 0x7CFF5A }),
  fde: new THREE.MeshStandardMaterial({ color: 0x9B7E55, roughness: 0.72, metalness: 0.08 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xC9CDD2, roughness: 0.15, metalness: 1.0 }),
  midSteel: new THREE.MeshStandardMaterial({ color: 0x35393E, roughness: 0.42, metalness: 0.75 }),
  od: new THREE.MeshStandardMaterial({ color: 0x4C5B3C, roughness: 0.78, metalness: 0.05 }),
};

/* ---------- Weapon finishes ---------- */

// Palette roles a finish may repaint. Arms (sleeve/glove), ammo (brass),
// rubber furniture, glass and emissive marks are never touched.
const SKIN_ROLES: SkinRole[] = ['poly', 'steel', 'darkSteel', 'dark', 'tan', 'wood', 'woodDark', 'fde', 'chrome', 'midSteel', 'od'];
// Built lazily: the wood grain block below re-tints WM.wood after definition.
let SKIN_HEX: Map<number, SkinRole> | null = null;
function skinHex(): Map<number, SkinRole> {
  if (!SKIN_HEX) SKIN_HEX = new Map(SKIN_ROLES.map(role => [(WM[role] as THREE.MeshStandardMaterial).color.getHex(), role]));
  return SKIN_HEX;
}

interface SkinSnap { c: number; r: number; m: number }

/**
 * Repaint a gun group with a finish. Matches materials against the stock WM
 * palette by their original color, so repaints are idempotent and switching
 * back to Factory restores stock values. CALLERS MUST OWN THE MATERIALS:
 * clone per gun first (the viewer and the engine both do) — never run this
 * on shared WM or every gun changes color.
 */
export function applySkin(root: THREE.Object3D, skin: SkinDef): void {
  const coats = skin?.coats ?? {};
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat.color || typeof mat.roughness !== 'number' || typeof mat.metalness !== 'number') return;
    let snap = (mat.userData.skinSnap ?? null) as SkinSnap | null;
    if (!snap) {
      snap = { c: mat.color.getHex(), r: mat.roughness, m: mat.metalness };
      mat.userData.skinSnap = snap;
    }
    const role = skinHex().get(snap.c);
    const coat = role ? coats[role] : undefined;
    if (!coat) {
      mat.color.setHex(snap.c);
      mat.roughness = snap.r;
      mat.metalness = snap.m;
      return;
    }
    mat.color.setHex(coat.color ?? snap.c);
    mat.roughness = coat.roughness ?? snap.r;
    mat.metalness = coat.metalness ?? snap.m;
  });
}

// Deterministic lacquer grain: no external assets or runtime canvas allocation.
const grainData = new Uint8Array(128*256*4);
for (let y=0;y<256;y++) for (let x=0;x<128;x++) {
  const grain = Math.sin(x*0.7 + Math.sin(y*0.034)*2 + Math.sin(y*0.011+x*0.08))*0.5+0.5;
  const fleck = ((x*37+y*71)%31)/31;
  const i=(y*128+x)*4;
  grainData[i]=170+grain*30+fleck*8; grainData[i+1]=105+grain*22; grainData[i+2]=60+grain*14; grainData[i+3]=255;
}
const woodGrain = new THREE.DataTexture(grainData,128,256);
woodGrain.colorSpace=THREE.SRGBColorSpace; woodGrain.wrapS=woodGrain.wrapT=THREE.RepeatWrapping;
woodGrain.magFilter=THREE.LinearFilter; woodGrain.needsUpdate=true;
WM.wood.map=woodGrain; WM.wood.color.setHex(0x886445); WM.wood.roughness=0.34;
WM.woodDark.map=woodGrain; WM.woodDark.color.setHex(0x8B5C30);

/** Collects parts per-material and merges → 1 draw call per material. */
export class GunBuilder {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private static M = new THREE.Matrix4();
  private static Q = new THREE.Quaternion();
  private static E = new THREE.Euler();
  private static V = new THREE.Vector3();
  private static S = new THREE.Vector3(1, 1, 1);
  private put(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    if (geo.index) { const indexed=geo; geo=geo.toNonIndexed(); indexed.dispose(); }
    GunBuilder.Q.setFromEuler(GunBuilder.E.set(rx, ry, rz));
    GunBuilder.M.compose(GunBuilder.V.set(x, y, z), GunBuilder.Q, GunBuilder.S);
    geo.applyMatrix4(GunBuilder.M);
    let a = this.buckets.get(mat);
    if (!a) { a = []; this.buckets.set(mat, a); }
    a.push(geo);
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    // Small detail prims (teeth, pins, ribs, slots) don't need rounded edges:
    // plain boxes cost 12 tris instead of ~150, which funds the extra detail.
    const geo = Math.max(w, h, d) < 0.035
      ? new THREE.BoxGeometry(w, h, d)
      : new RoundedBoxGeometry(w, h, d, 1, Math.min(w,h,d)*0.13);
    this.put(geo, mat, x, y, z, rx, ry, rz); return this;
  }
  cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, seg = 16, open = false) { this.put(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat, x, y, z, rx, ry, rz); return this; }
  sph(r: number, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(r, 10, 8); g.scale(sx, sy, sz); this.put(g, mat, x, y, z); return this;
  }
  build(parent: THREE.Object3D) {
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false)!;
      for (const gg of geos) gg.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Cylinder limb between two points (for arms). */
function limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number, mat: THREE.Material, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}
function gloveBox(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), WM.glove);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}

interface ArmAnchors { fore: [number, number, number]; mag: [number, number, number]; fa: [number, number, number] }
/**
 * Procedural first-person arms, built in gun-local space.
 * Right arm is static (gripping). Left arm lives in its own group so the
 * engine can drive it through reload keyframes derived from the anchors.
 */
function attachArms(gun: THREE.Group, a: ArmAnchors): { lArm: THREE.Group; keys: LArmKey[] } {
  // ---- right arm (static grip) ----
  const r = new THREE.Group(); r.userData.arm = true; gun.add(r);
  const rS = new THREE.Vector3(0.21, -0.40, 0.20), rE = new THREE.Vector3(0.155, -0.31, -0.03), rW = new THREE.Vector3(0.035, -0.115, -0.055);
  limb(r, rS, rE, 0.052, 0.046, WM.sleeve);
  limb(r, rE, rW, 0.044, 0.038, WM.sleeveDark);
  // rolled cuff
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), WM.sleeveDark);
  cuff.position.copy(rE).lerp(rW, 0.55);
  cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(rW, rE).normalize());
  r.add(cuff);
  // glove wrapped on pistol grip
  gloveBox(r, 0.034, 0.075, 0.042, 0.004, -0.075, -0.045, -0.32);
  // fingers curling over the front strap
  for (let i = 0; i < 3; i++) gloveBox(r, 0.036, 0.013, 0.014, 0.0, -0.062 - i * 0.016, -0.068, -0.32);
  gloveBox(r, 0.02, 0.05, 0.02, 0.028, -0.075, -0.03, -0.3, 0, -0.4); // thumb

  // ---- left arm (animated) ----
  const lArm = new THREE.Group(); lArm.userData.arm = true; gun.add(lArm);
  const lS = new THREE.Vector3(-0.23, -0.40, 0.16), lE = new THREE.Vector3(-0.175, -0.29, -0.15);
  const fw = new THREE.Vector3(...a.fore);
  limb(lArm, lS, lE, 0.052, 0.046, WM.sleeve);
  const cuff2 = cuff.clone(); cuff2.position.copy(lE).lerp(fw, 0.55);
  cuff2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(fw, lE).normalize());
  lArm.add(cuff2);
  limb(lArm, lE, fw, 0.044, 0.037, WM.sleeveDark);
  // glove around foregrip/handguard
  gloveBox(lArm, 0.04, 0.062, 0.05, fw.x, fw.y, fw.z);
  for (let i = 0; i < 3; i++) gloveBox(lArm, 0.042, 0.012, 0.016, fw.x, fw.y - 0.012 - i * 0.015, fw.z - 0.028);
  gloveBox(lArm, 0.02, 0.05, 0.02, fw.x - 0.026, fw.y - 0.005, fw.z + 0.005, 0, 0, 0.4);

  // reload keyframes: hand travels foregrip → mag → magwell → forward-assist → foregrip
  const mg = new THREE.Vector3(...a.mag), fa = new THREE.Vector3(...a.fa);
  const toMag: [number, number, number] = [mg.x - fw.x, mg.y - fw.y + 0.02, mg.z - fw.z];
  const keys: LArmKey[] = [
    { t: 0.0, p: [0, 0, 0], r: [0, 0, 0] },
    { t: 0.13, p: [0, 0, 0], r: [0, 0, 0] },
    { t: 0.30, p: toMag, r: [0.5, 0, 0.12] },
    { t: 0.50, p: [toMag[0], toMag[1] - 0.075, toMag[2]], r: [0.62, 0, 0.12] },
    { t: 0.62, p: [toMag[0] * 0.4, toMag[1] * 0.35, toMag[2] * 0.4], r: [0.3, 0, 0.05] },
    { t: 0.74, p: [fa.x - fw.x, fa.y - fw.y, fa.z - fw.z], r: [-0.35, 0, -0.15] },
    { t: 0.86, p: [0, 0, 0], r: [0, 0, 0] },
    { t: 1.0, p: [0, 0, 0], r: [0, 0, 0] },
  ];
  return { lArm, keys };
}

export function buildM4(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.05; // bare-gun sight line runs through the HK diopter drum
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, T = WM.tan, D = WM.dark, G = WM.grip, R = WM.rubber, B = WM.brass, MS = WM.midSteel;
  const b = new GunBuilder();
  const skb = new GunBuilder(); const skG = new THREE.Group();   // stock (removable)
  const brb = new GunBuilder(); const brG = new THREE.Group();   // barrel assembly (removable)
  const ubb = new GunBuilder(); const ubG = new THREE.Group();   // vertical foregrip (removable)
  const opb = new GunBuilder(); const opG = new THREE.Group();   // sights (removable)
  // ---- HK416 receivers: tall piston upper over an ambi lower ----
  b.box(0.038, 0.036, 0.17, P, 0, -0.012, -0.10);                 // lower receiver
  b.box(0.040, 0.034, 0.21, MS, 0, 0.020, -0.12);                 // tall flat-top upper
  b.box(0.0405, 0.005, 0.21, D, 0, 0.002, -0.12);                 // receiver seam
  b.box(0.041, 0.008, 0.05, P, 0, 0.032, -0.03);                  // rail riser base
  for (let i = 0; i < 9; i++) b.box(0.032, 0.007, 0.015, D, 0, 0.040, -0.045 - i * 0.024);
  b.box(0.008, 0.008, 0.008, DS, -0.021, 0.004, -0.045, 0, 0, 0);   // takedown pin F
  b.box(0.008, 0.008, 0.008, DS, -0.021, 0.004, -0.155, 0, 0, 0);   // takedown pin R
  b.box(0.004, 0.020, 0.052, DS, 0.0215, 0.018, -0.14);             // ejection port recess
  b.box(0.006, 0.014, 0.030, B, 0.020, 0.018, -0.145);              // brass in port
  b.box(0.005, 0.016, 0.020, S, 0.022, 0.020, -0.125);              // bolt face
  b.box(0.006, 0.013, 0.024, P, 0.023, 0.011, -0.105);              // shell deflector
  b.cyl(0.006, 0.006, 0.012, S, 0.024, 0.020, -0.088, 0, 0, Math.PI / 2); // forward assist
  b.cyl(0.004, 0.004, 0.014, D, 0.024, 0.020, -0.088, 0, 0, Math.PI / 2); // assist plunger
  b.box(0.006, 0.010, 0.022, S, -0.021, -0.006, -0.075);            // selector L
  b.box(0.006, 0.010, 0.022, S, 0.021, -0.006, -0.075);             // selector R
  b.box(0.008, 0.006, 0.014, S, 0.021, 0.002, -0.055);              // mag release R
  b.box(0.008, 0.006, 0.014, S, -0.021, 0.002, -0.055);             // mag release L (ambi)
  b.box(0.006, 0.020, 0.012, S, -0.021, 0.004, -0.120);             // bolt catch L
  b.box(0.006, 0.020, 0.012, S, 0.021, 0.004, -0.120);              // bolt catch R (ambi)
  // Magwell: flush with the lower receiver — nothing protrudes past the mag
  // itself (the old flare/bevel boxes poked through drum mags and read as a
  // broken piece sticking out of the gun).
  b.box(0.034, 0.020, 0.034, P, 0, -0.036, -0.158);                 // integral flared well
  b.box(0.006, 0.004, 0.050, P, 0, -0.040, -0.095);                 // trigger guard
  b.box(0.006, 0.014, 0.006, P, 0, -0.045, -0.115);                 // guard rear post
  b.box(0.005, 0.018, 0.005, DS, 0, -0.030, -0.093);                // trigger
  b.box(0.028, 0.088, 0.036, G, 0, -0.056, -0.045, -0.32);          // HK grip
  for (let i = 0; i < 4; i++) b.box(0.029, 0.004, 0.028, D, 0, -0.040 - i * 0.015, -0.041 - i * 0.004, -0.32); // grip texture
  b.box(0.012, 0.030, 0.020, G, 0, -0.045, -0.022, -0.32);          // beavertail
  b.box(0.030, 0.010, 0.034, G, 0, -0.100, -0.058, -0.32);          // grip base
  // ---- HK slimline stock (buffer tube runs INTO the receiver — no floating gap) ----
  skb.box(0.038, 0.036, 0.016, P, 0, 0.004, -0.010);                // receiver end plate / tube boss
  skb.cyl(0.0165, 0.0165, 0.024, S, 0, 0.012, 0.002, Math.PI / 2);  // castle nut collar at the receiver
  skb.cyl(0.015, 0.015, 0.135, S, 0, 0.012, 0.055, Math.PI / 2);    // buffer tube (seats into the boss)
  for (let i = 0; i < 4; i++) skb.cyl(0.0158, 0.0158, 0.003, D, 0, 0.012, 0.035 + i * 0.018, Math.PI / 2); // notches
  skb.box(0.030, 0.052, 0.095, P, 0, -0.004, 0.145);                // slimline body
  skb.box(0.026, 0.016, 0.070, P, 0, 0.028, 0.140);                 // cheek riser
  skb.box(0.018, 0.008, 0.075, D, 0, 0.022, 0.140);                 // riser seam
  skb.box(0.034, 0.068, 0.016, R, 0, -0.008, 0.196);                // buttpad
  for (let i = 0; i < 3; i++) skb.box(0.035, 0.006, 0.017, D, 0, -0.028 + i * 0.018, 0.196); // pad ribs
  skb.box(0.032, 0.012, 0.085, P, 0, -0.034, 0.140);                // stock toe
  skb.box(0.010, 0.006, 0.030, D, -0.017, -0.004, 0.145);           // adjustment lever
  skb.box(0.006, 0.020, 0.030, D, 0.016, -0.004, 0.145);            // sling slot
  skb.cyl(0.006, 0.006, 0.004, D, -0.016, 0.006, 0.155, 0, 0, Math.PI / 2); // QD socket
  // ---- fat HK quad rail with round cooling holes + quad rails ----
  b.cyl(0.023, 0.023, 0.20, P, 0, 0.020, -0.315, Math.PI / 2, 0, 0, 12);
  b.cyl(0.024, 0.024, 0.020, D, 0, 0.020, -0.225, Math.PI / 2, 0, 0, 12); // cap R
  b.cyl(0.024, 0.024, 0.020, D, 0, 0.020, -0.405, Math.PI / 2, 0, 0, 12); // cap F
  for (let i = 0; i < 6; i++) b.box(0.030, 0.007, 0.014, D, 0, 0.0445, -0.245 - i * 0.028);
  for (let i = 0; i < 5; i++) { b.box(0.005, 0.028, 0.014, D, 0.0245, 0.020, -0.245 - i * 0.032); b.box(0.005, 0.028, 0.014, D, -0.0245, 0.020, -0.245 - i * 0.032); }
  for (let i = 0; i < 5; i++) b.box(0.028, 0.006, 0.014, D, 0, -0.0035, -0.245 - i * 0.032);
  for (const av of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    for (let i = 0; i < 5; i++) {
      b.box(0.008, 0.003, 0.016, D, Math.cos(av) * 0.0225, 0.020 + Math.sin(av) * 0.0225, -0.25 - i * 0.03, 0, 0, av - Math.PI / 2);
    }
  }
  for (let i = 0; i < 4; i++) {  // signature round cooling holes, both flanks
    b.cyl(0.005, 0.005, 0.002, D, 0.0235, 0.020, -0.261 - i * 0.032, 0, 0, Math.PI / 2);
    b.cyl(0.005, 0.005, 0.002, D, -0.0235, 0.020, -0.261 - i * 0.032, 0, 0, Math.PI / 2);
  }
  b.cyl(0.007, 0.007, 0.004, D, 0.0245, 0.020, -0.30, 0, 0, Math.PI / 2); // QD socket rail
  // ---- heavy barrel + tall gas block with integral flip-up front sight ----
  brb.cyl(0.0105, 0.0105, 0.17, S, 0, 0.020, -0.490, Math.PI / 2);
  brb.cyl(0.0115, 0.0115, 0.010, S, 0, 0.020, -0.445, Math.PI / 2);  // barrel step ring
  brb.box(0.020, 0.034, 0.026, DS, 0, 0.028, -0.430);               // tall gas block
  brb.cyl(0.004, 0.004, 0.13, S, 0, 0.034, -0.365, Math.PI / 2);    // gas tube
  brb.box(0.006, 0.012, 0.008, DS, 0, 0.006, -0.430);               // sling swivel base
  brb.box(0.005, 0.024, 0.005, D, 0, 0.058, -0.430);                // flip front post (up)
  brb.box(0.004, 0.020, 0.014, D, -0.011, 0.056, -0.430);           // post wing L
  brb.box(0.004, 0.020, 0.014, D, 0.011, 0.056, -0.430);            // post wing R
  brb.cyl(0.011, 0.010, 0.048, S, 0, 0.020, -0.592, Math.PI / 2);   // HK birdcage
  for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2 + 0.3; brb.box(0.005, 0.005, 0.030, D, Math.cos(a2) * 0.0105, 0.020 + Math.sin(a2) * 0.0105, -0.592); }
  brb.cyl(0.004, 0.004, 0.050, D, 0, 0.020, -0.592, Math.PI / 2);   // bore shadow
  brb.cyl(0.012, 0.012, 0.006, DS, 0, 0.020, -0.568, Math.PI / 2);  // crush washer
  brb.cyl(0.0125, 0.0125, 0.008, DS, 0, 0.020, -0.562, Math.PI / 2); // notched collar
  // ---- vertical foregrip ----
  ubb.box(0.022, 0.058, 0.028, P, 0, -0.020, -0.340, 0.10);
  ubb.cyl(0.013, 0.013, 0.024, G, 0, -0.020, -0.340, Math.PI / 2, 0, 0); // finger groove ring
  ubb.cyl(0.0125, 0.0125, 0.024, G, 0, -0.035, -0.3415, Math.PI / 2, 0, 0); // groove 2
  ubb.box(0.024, 0.008, 0.030, G, 0, -0.050, -0.343, 0.10);         // base cap
  // ---- PEQ-15 ----
  b.box(0.024, 0.018, 0.055, T, 0.030, 0.030, -0.330);
  b.box(0.026, 0.006, 0.057, D, 0.030, 0.020, -0.330);              // clamp
  b.cyl(0.005, 0.005, 0.006, D, 0.030, 0.030, -0.300, Math.PI / 2); // emitter
  b.cyl(0.006, 0.006, 0.004, D, 0.030, 0.036, -0.345);              // dial
  b.box(0.010, 0.004, 0.016, D, 0.030, 0.041, -0.330);              // fire button
  // ---- HK diopter drum (rear BUIS, hides with the optic) ----
  opb.box(0.030, 0.006, 0.030, D, 0, 0.043, -0.045);                 // diopter base
  opb.cyl(0.009, 0.009, 0.020, D, 0, 0.050, -0.045, 0, 0, Math.PI / 2, 12); // rotating drum
  opb.cyl(0.003, 0.003, 0.022, D, 0, 0.050, -0.045, 0, 0, Math.PI / 2, 8); // aperture bore
  // (bare gun ships with the HK diopter drum irons above — optics are Armory parts)
  skb.build(skG); g.add(skG);
  brb.build(brG); g.add(brG);
  ubb.build(ubG); g.add(ubG);
  opb.build(opG); g.add(opG);
  b.build(g);
  // Bare rifle ships with irons only — glass + glowing reticles come from Armory optics.
  const adsHidden: THREE.Object3D[] = [];
  // ---- STANAG (animated) ----
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.027, 0.070, 0.056, S, 0, -0.045, 0, 0.12);
  mb.box(0.026, 0.060, 0.052, S, 0, -0.100, 0.012, 0.28);
  for (let i = 0; i < 4; i++) mb.box(0.029, 0.004, 0.050, D, 0, -0.035 - i * 0.020, 0.004 + i * 0.004, 0.16);
  mb.box(0.030, 0.010, 0.058, D, 0, -0.132, 0.020, 0.28);
  mb.build(mag);
  mag.position.set(0, -0.03, -0.155); mag.userData.homeY = -0.03; mag.userData.homeZ = -0.155; g.add(mag);
  // ---- charging handle ----
  const ch = new THREE.Group();
  const cb = new GunBuilder();
  cb.box(0.032, 0.010, 0.035, S, 0, 0, 0);
  cb.box(0.056, 0.008, 0.012, S, 0, 0, 0.014);
  cb.build(ch);
  ch.position.set(0, 0.032, -0.015); g.add(ch);
  const optic = new THREE.Group(); g.add(optic); // (kept for API; sight parts are fixed)
  // ---- arms ----
  const { lArm, keys } = attachArms(g, { fore: [0, -0.028, -0.340], mag: [0, -0.150, -0.155], fa: [0.024, 0.020, -0.090] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.625); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.02, -0.615),
    optic: makeSocket(0, 0.052, -0.11),
    magazine: makeSocket(0, -0.03, -0.155),
    underbarrel: makeSocket(0, -0.008, -0.34),
    stock: makeSocket(0, 0.012, 0.02),
    rail: makeSocket(-0.028, 0.02, -0.30),
    barrel: makeSocket(0, 0.02, -0.42),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [opG, ...adsHidden], magazine: [mag], underbarrel: [ubG], stock: [skG], barrel: [brG] };
  return { group: g, mag, chargingHandle: ch, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export function buildAK47(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.066;
  const S = WM.steel, W = WM.wood, WD = WM.woodDark, D = WM.dark, MS = WM.midSteel;
  const b = new GunBuilder();
  const skb = new GunBuilder(); const skG = new THREE.Group();
  const brb = new GunBuilder(); const brG = new THREE.Group();
  const opb = new GunBuilder(); const opG = new THREE.Group();
  // ---- stamped receiver with reinforcements + rivets ----
  b.box(0.038, 0.042, 0.23, S, 0, 0.012, -0.12);
  b.box(0.039, 0.010, 0.20, MS, 0, -0.004, -0.12);                   // stiffening rail
  b.box(0.040, 0.012, 0.23, S, 0, 0.037, -0.12);                    // ribbed dust cover
  for (let i = 0; i < 5; i++) b.box(0.041, 0.003, 0.004, D, 0, 0.043, -0.12 + (i - 2) * 0.028);
  b.box(0.004, 0.020, 0.060, D, 0.021, 0.016, -0.13);               // ejection port
  b.box(0.008, 0.028, 0.006, S, 0.024, 0.014, -0.07);               // charging knob
  b.box(0.007, 0.032, 0.022, S, 0.021, -0.002, -0.06);              // selector - enhanced
  for (let i = 0; i < 3; i++) b.box(0.007, 0.004, 0.016, D, 0.021, -0.010 + i * 0.009, -0.06); // selector notches
  b.box(0.020, 0.012, 0.030, S, 0, -0.012, -0.235);                 // rear trunnion
  b.box(0.004, 0.016, 0.090, D, -0.0205, 0.018, -0.10);             // dovetail side rail
  b.box(0.006, 0.010, 0.016, S, -0.022, 0.018, -0.07);              // rail clamp F
  b.box(0.006, 0.010, 0.016, S, -0.022, 0.018, -0.13);              // rail clamp R
  b.box(0.024, 0.020, 0.036, S, 0, -0.016, -0.175);                 // magwell dimple block
  for (const side of [-1, 1]) {
    for (const z of [-0.045, -0.08, -0.19, -0.215]) b.cyl(0.0025, 0.0025, 0.002, S, side * 0.0205, 0.005, z, 0, 0, Math.PI / 2);
    b.cyl(0.003, 0.003, 0.002, S, side * 0.0205, -0.016, -0.175, 0, 0, Math.PI / 2); // magwell rivet
    for (let i = 0; i < 5; i++) b.box(0.002, 0.006, 0.010, WD, side * 0.0225, 0.015, -0.25 - i * 0.023);
  }
  // ---- wood furniture ----
  b.box(0.042, 0.036, 0.16, W, 0, 0.014, -0.31);                    // upper HG
  b.box(0.044, 0.024, 0.16, W, 0, -0.012, -0.31);                   // lower HG w/ swell
  b.box(0.046, 0.014, 0.10, WD, 0, -0.020, -0.31);                  // palm swell
  for (let i = 0; i < 3; i++) b.box(0.0465, 0.004, 0.012, WD, 0, -0.024, -0.28 - i * 0.025); // finger grooves
  b.box(0.046, 0.030, 0.014, S, 0, -0.002, -0.235);                 // HG ferrule R
  b.box(0.046, 0.030, 0.014, S, 0, -0.002, -0.385);                 // HG ferrule F
  b.box(0.030, 0.088, 0.038, W, 0, -0.054, -0.04, -0.32);            // grip - steeper
  b.box(0.030, 0.010, 0.038, WD, 0, -0.088, -0.052, -0.3);          // grip cap
  // Stock boot slots INTO the stamped receiver tang — the old version floated
  // 2 cm behind the receiver with visible daylight between the two parts.
  skb.box(0.034, 0.046, 0.045, WD, 0, 0.004, 0.008);                 // stock boot (into receiver)
  skb.box(0.037, 0.052, 0.010, S, 0, 0.002, 0.028);                  // steel tang collar
  skb.box(0.038, 0.058, 0.15, W, 0, -0.006, 0.100);                  // stock - accurate taper
  skb.box(0.040, 0.070, 0.014, D, 0, -0.008, 0.170);                // buttplate
  skb.box(0.020, 0.030, 0.016, WD, 0, -0.020, 0.170);               // trapdoor
  skb.box(0.006, 0.020, 0.060, WD, 0, -0.004, 0.09);                // stock lightening cut look
  skb.box(0.008, 0.010, 0.020, S, 0, 0.020, 0.045);                 // rear sling swivel
  // ---- barrel assembly ----
  brb.cyl(0.009, 0.009, 0.23, S, 0, 0.012, -0.50, Math.PI / 2);
  brb.cyl(0.006, 0.006, 0.20, S, 0, 0.032, -0.42, Math.PI / 2);     // gas tube
  brb.box(0.020, 0.030, 0.030, S, 0, 0.030, -0.41);                 // gas block
  brb.box(0.020, 0.008, 0.20, WD, 0, 0.032, -0.42);                 // heat guard - thicker
  // (bayonet lug + protruding cleaning rod deleted — at viewmodel scale they
  //  read as a sharp broken spike hanging under the barrel)
  // AKM front sight tower - accurate post with protective ears
  brb.box(0.022, 0.038, 0.024, S, 0, 0.024, -0.585);
  brb.cyl(0.003, 0.003, 0.022, D, 0, 0.054, -0.585);
  brb.cyl(0.0015, 0.0015, 0.006, S, 0, 0.065, -0.585);
  brb.box(0.005, 0.032, 0.016, D, -0.012, 0.050, -0.585);
  brb.box(0.005, 0.032, 0.016, D, 0.012, 0.050, -0.585);
  brb.box(0.006, 0.006, 0.024, D, 0, 0.042, -0.585);
  brb.cyl(0.002, 0.002, 0.010, S, -0.009, 0.022, -0.585, 0, 0, 1.5708);
  brb.cyl(0.002, 0.002, 0.010, S, 0.009, 0.022, -0.585, 0, 0, 1.5708);
  brb.cyl(0.011, 0.012, 0.032, S, 0, 0.012, -0.645, Math.PI / 2);   // slant brake
  brb.box(0.012, 0.006, 0.020, D, 0, 0.018, -0.648, 0.35);          // slant cut
  brb.cyl(0.004, 0.004, 0.034, D, 0, 0.012, -0.645, Math.PI / 2);   // bore shadow
  b.box(0.006, 0.004, 0.030, S, 0, -0.038, -0.09);                  // trigger guard
  b.box(0.005, 0.018, 0.005, S, 0, -0.028, -0.09);                  // trigger
  b.box(0.008, 0.012, 0.014, S, 0, -0.036, -0.150);                 // mag release paddle
  // ---- rear tangent sight ----
  opb.box(0.024, 0.010, 0.040, S, 0, 0.046, -0.20);
  opb.box(0.024, 0.014, 0.008, D, 0, 0.052, -0.205);                // slider
  opb.box(0.026, 0.003, 0.006, S, 0, 0.058, -0.205);                // leaf notch
  // ---- Kobra (open frame) ----
  opb.box(0.034, 0.010, 0.046, D, 0, 0.044, -0.12);
  opb.box(0.005, 0.026, 0.038, D, -0.016, 0.062, -0.12);
  opb.box(0.005, 0.026, 0.038, D, 0.016, 0.062, -0.12);
  opb.box(0.037, 0.005, 0.038, D, 0, 0.077, -0.12);
  skb.build(skG); g.add(skG);
  brb.build(brG); g.add(brG);
  opb.build(opG); g.add(opG);
  b.build(g);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 12), WM.reticle);
  dot.position.set(0, SIGHT_Y, -0.125); g.add(dot);
  // ---- curved mag ----
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  for (let i=0;i<13;i++) {
    const tt=i/12, angle=0.10+tt*0.68;
    mb.box(0.029,0.019,0.062,S,0,-0.010-tt*0.162,tt*tt*0.068,angle);
    for (const side of [-1,1]) mb.box(0.0019,0.019,0.003,D,side*0.015,-0.010-tt*0.162,tt*tt*0.068-0.019,angle);
    if (i % 2 === 0) mb.box(0.004,0.020,0.008,D,0,-0.010-tt*0.162,tt*tt*0.068+0.028,angle);
  }
  mb.box(0.031,0.008,0.066,D,0,-0.177,0.068,0.77);
  mb.build(mag);
  mag.position.set(0, -0.03, -0.17); mag.userData.homeY = -0.03; mag.userData.homeZ = -0.17; g.add(mag);
  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [-0.01, -0.028, -0.310], mag: [0, -0.155, -0.170], fa: [0.024, 0.014, -0.070] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.645); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.012, -0.66),
    optic: makeSocket(0, 0.050, -0.12),
    magazine: makeSocket(0, -0.03, -0.17),
    underbarrel: makeSocket(0, -0.026, -0.31),
    stock: makeSocket(0, -0.004, 0.015),
    rail: makeSocket(-0.024, 0.015, -0.28),
    barrel: makeSocket(0, 0.012, -0.39),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [opG, dot], magazine: [mag], stock: [skG], barrel: [brG] };
  return { group: g, mag, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden: [dot], sockets, removable, attached: {} };
}

export function buildM1911(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.045;
  const S = WM.steel, W = WM.wood, WD = WM.woodDark, D = WM.dark, MS = WM.midSteel;
  const b = new GunBuilder();
  const slb = new GunBuilder(); const slide = new THREE.Group();
  const brb = new GunBuilder(); const brG = new THREE.Group();
  const opb = new GunBuilder(); const opG = new THREE.Group();
  // ---- slide (reciprocates): flat-top slab with cocking serrations ----
  slb.box(0.027, 0.030, 0.200, S, 0, 0.026, -0.05);                 // slide
  slb.box(0.020, 0.004, 0.190, MS, 0, 0.041, -0.05);                // flat top rib
  slb.box(0.002, 0.020, 0.190, MS, -0.0135, 0.026, -0.05, 0, 0, 0.12); // side flat L
  slb.box(0.002, 0.020, 0.190, MS, 0.0135, 0.026, -0.05, 0, 0, -0.12); // side flat R
  for (let i = 0; i < 6; i++) slb.box(0.0285, 0.020, 0.0025, D, 0, 0.026, 0.018 + i * 0.006); // rear serrations
  for (let i = 0; i < 4; i++) slb.box(0.0285, 0.020, 0.0025, D, 0, 0.026, -0.120 + i * 0.006); // front serrations
  slb.box(0.002, 0.012, 0.040, D, 0.0136, 0.032, -0.09);            // ejection port cut
  slb.box(0.002, 0.008, 0.030, S, 0.0132, 0.032, -0.09);            // barrel hood in port
  slb.box(0.003, 0.008, 0.026, D, 0.0125, 0.026, -0.02);            // extractor
  slb.box(0.024, 0.026, 0.004, D, 0, 0.026, 0.051);                 // rear plate
  slb.cyl(0.0025, 0.0025, 0.006, S, 0, 0.030, 0.051, Math.PI / 2);  // firing pin
  // ---- frame ----
  b.box(0.025, 0.026, 0.150, S, 0, 0.002, -0.04);                   // frame
  b.box(0.026, 0.004, 0.150, D, 0, 0.010, -0.04);                   // slide rail seam
  b.box(0.024, 0.020, 0.060, MS, 0, -0.002, -0.10);                 // dust cover
  brb.cyl(0.007, 0.007, 0.032, S, 0, 0.026, -0.155, Math.PI / 2);   // barrel + bushing
  brb.cyl(0.009, 0.009, 0.006, D, 0, 0.026, -0.150, Math.PI / 2);   // bushing ring
  brb.cyl(0.0035, 0.0035, 0.034, D, 0, 0.026, -0.155, Math.PI / 2); // bore shadow
  // ---- walnut grips with diamond checkering + screws ----
  b.box(0.026, 0.080, 0.034, W, 0, -0.036, 0.020, -0.25);           // wood grips
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.box(0.001, 0.030, 0.004, WD, sx * 0.0132, -0.036, 0.008 + i * 0.009, -0.25, 0.5, 0);
      b.box(0.001, 0.030, 0.004, WD, sx * 0.0132, -0.036, 0.008 + i * 0.009, -0.25, -0.5, 0);
    }
  }
  b.sph(0.003, D, -0.008, -0.036, 0.004); b.sph(0.003, D, 0.008, -0.036, 0.004); // grip screws
  b.sph(0.003, D, -0.008, -0.036, 0.036); b.sph(0.003, D, 0.008, -0.036, 0.036);
  b.box(0.006, 0.004, 0.030, S, 0, -0.022, -0.05);                  // trigger guard
  b.box(0.005, 0.016, 0.005, S, 0, -0.014, -0.045);                 // trigger
  for (let i = 0; i < 3; i++) b.box(0.0055, 0.002, 0.0055, D, 0, -0.018 + i * 0.005, -0.045); // trigger grooves
  b.box(0.010, 0.016, 0.012, S, 0, 0.032, 0.052);                   // hammer
  b.box(0.012, 0.006, 0.008, D, 0, 0.040, 0.052);                   // hammer spur
  b.box(0.008, 0.010, 0.020, S, 0, 0.030, 0.028);                   // beavertail safety
  b.box(0.006, 0.008, 0.030, S, -0.014, 0.012, -0.020);             // slide stop
  b.box(0.005, 0.007, 0.022, S, -0.014, 0.016, 0.008);              // thumb safety L
  b.box(0.005, 0.007, 0.022, S, 0.014, 0.016, 0.008);               // thumb safety R
  b.cyl(0.0035, 0.0035, 0.004, S, -0.0135, 0.004, 0.006, 0, 0, Math.PI / 2); // mag release
  b.box(0.020, 0.030, 0.006, MS, 0, -0.052, 0.038, -0.25);          // mainspring housing
  for (let i = 0; i < 4; i++) b.box(0.021, 0.002, 0.006, D, 0, -0.062 + i * 0.007, 0.036 - i * 0.002, -0.25);
  for (let i = 0; i < 3; i++) b.box(0.024, 0.002, 0.004, D, 0, -0.024 - i * 0.008, 0.002 + i * 0.002, -0.25); // front strap
  b.box(0.027, 0.006, 0.035, D, 0, -0.077, 0.030, -0.25);           // magwell bevel
  opb.box(0.004, 0.009, 0.006, D, 0, SIGHT_Y, -0.138);              // front blade
  opb.box(0.005, 0.008, 0.006, D, -0.006, SIGHT_Y, 0.038);          // rear notch L
  opb.box(0.005, 0.008, 0.006, D, 0.006, SIGHT_Y, 0.038);           // rear notch R
  slb.build(slide); g.add(slide);
  brb.build(brG); g.add(brG);
  opb.build(opG); g.add(opG);
  b.build(g);
  // tritium dots (hidden in ADS — HUD crosshair takes over)
  const adsHidden: THREE.Object3D[] = [];
  for (const [x, z] of [[0, -0.1415], [-0.006, 0.0345], [0.006, 0.0345]] as const) {
    const t = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 8), WM.tritium);
    t.position.set(x, SIGHT_Y + 0.002, z); g.add(t);
    adsHidden.push(t);
  }
  // ---- single-stack mag (hidden in grip, drops on reload) ----
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.022, 0.075, 0.028, S, 0, -0.038, 0.021, -0.25);
  mb.box(0.024, 0.008, 0.030, D, 0, -0.077, 0.030, -0.25);
  mb.build(mag);
  mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);
  const optic = new THREE.Group(); g.add(optic);
  // 1911: support hand wraps under the dominant hand
  const { lArm, keys } = attachArms(g, { fore: [0.005, -0.105, -0.030], mag: [0, -0.090, 0.020], fa: [0.0, -0.014, -0.045] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.026, -0.175); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.026, -0.172),
    optic: makeSocket(0, 0.042, 0.0),
    magazine: makeSocket(0, -0.06, 0.03),
    rail: makeSocket(0.016, 0.002, -0.08),
    barrel: makeSocket(0, 0.026, -0.10),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [opG, ...adsHidden], magazine: [mag], barrel: [brG] };
  return { group: g, mag, chargingHandle: slide, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export function buildAWM(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.076;
  const S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, R = WM.rubber, OD = WM.od;
  const b = new GunBuilder();
  const ubb = new GunBuilder(); const ubG = new THREE.Group();

  // ================= ACCURACY INTERNATIONAL AWM =================
  // Signature silhouette: slab-sided GREEN polymer stock halves bolted onto an
  // aluminium chassis spine, a REAL daylight thumbhole between grip and butt,
  // spacer-stacked buttpad, black action riding on top, long free-float barrel
  // with the huge AI brake, and a stubby box mag ahead of the trigger guard.
  const chassisMat = OD;

  // -- aluminium chassis spine (visible dark line running the gun's length) --
  b.box(0.024, 0.020, 0.62, DS, 0, -0.020, -0.10);                 // full-length spine
  // -- receiver bedding block (green, holds the action) --
  b.box(0.040, 0.052, 0.22, chassisMat, 0, -0.006, -0.13);
  b.box(0.041, 0.008, 0.22, D, 0, -0.034, -0.13);                  // chassis seam line

  // -- BUTT: two slab side-panels with the open thumbhole between them --
  for (const side of [-1, 1]) {
    b.box(0.008, 0.062, 0.215, chassisMat, side * 0.016, -0.004, 0.115); // upper slab (spine → butt)
    b.box(0.008, 0.022, 0.150, chassisMat, side * 0.016, -0.062, 0.135); // lower rail slab
    b.box(0.008, 0.030, 0.020, chassisMat, side * 0.016, -0.036, 0.200); // rear tie post
    b.box(0.008, 0.026, 0.018, chassisMat, side * 0.016, -0.034, 0.052); // front tie post (behind grip)
  }
  // (the void between the slabs from z 0.06→0.19, y -0.02→-0.05 IS the thumbhole)
  b.box(0.030, 0.062, 0.030, chassisMat, 0, -0.004, 0.212);        // butt block joining the slabs
  // -- spacer-stacked recoil pad --
  b.box(0.042, 0.088, 0.012, D, 0, -0.006, 0.232);                 // spacer 1
  b.box(0.042, 0.088, 0.012, chassisMat, 0, -0.006, 0.244);        // spacer 2
  b.box(0.044, 0.092, 0.026, R, 0, -0.006, 0.263);                 // rubber pad
  // -- adjustable cheekpiece riding the upper slabs --
  b.box(0.034, 0.020, 0.115, chassisMat, 0, 0.036, 0.115);
  b.box(0.030, 0.006, 0.110, D, 0, 0.025, 0.115);                  // riser gap shadow
  b.cyl(0.006, 0.006, 0.040, DS, 0, 0.034, 0.155, 0, 0, Math.PI / 2); // cheek adjust wheel

  // -- separate near-vertical pistol grip (black, distinct from the green) --
  b.box(0.030, 0.080, 0.036, G, 0, -0.062, 0.010, -0.12);
  for (let i = 0; i < 3; i++) b.box(0.031, 0.004, 0.030, D, 0, -0.048 - i * 0.016, 0.012, -0.12);
  b.box(0.032, 0.010, 0.038, D, 0, -0.100, 0.014, -0.12);          // grip cap
  b.box(0.008, 0.006, 0.09, DS, 0, -0.052, -0.075);                // trigger guard
  b.box(0.005, 0.022, 0.006, S, 0, -0.042, -0.075);                // two-stage match trigger
  b.box(0.006, 0.012, 0.020, S, 0.021, -0.036, -0.125);            // mag release
  b.box(0.010, 0.006, 0.024, S, -0.020, 0.022, 0.005);             // 3-position safety

  // -- flat slab forend with the AI vent slots --
  b.box(0.038, 0.046, 0.22, chassisMat, 0, -0.008, -0.35);
  b.box(0.039, 0.010, 0.22, D, 0, -0.032, -0.35);                  // belly seam
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    b.box(0.002, 0.014, 0.045, D, side * 0.0195, -0.002, -0.29 - i * 0.062); // long vent slots
  }
  b.box(0.020, 0.014, 0.030, DS, 0, -0.034, -0.43);                // bipod spigot
  b.cyl(0.006, 0.006, 0.004, D, -0.0195, -0.010, -0.44, 0, 0, Math.PI / 2); // QD flush cup

  // -- long free-floating barrel (visible gap over the forend) --
  b.cyl(0.012, 0.011, 0.40, S, 0, 0.024, -0.46, Math.PI / 2, 0, 0, 20);
  b.cyl(0.016, 0.014, 0.030, DS, 0, 0.024, -0.265, Math.PI / 2);   // reinforced knox/barrel nut
  // -- the huge AWM slab brake: side-ported, wider than the barrel --
  b.box(0.030, 0.026, 0.075, DS, 0, 0.024, -0.685);
  for (let i = 0; i < 3; i++) {
    b.box(0.036, 0.016, 0.012, D, 0, 0.024, -0.660 - i * 0.022);   // side ports L+R
  }
  b.cyl(0.0065, 0.0065, 0.080, D, 0, 0.024, -0.688, Math.PI / 2);  // bore shadow

  // -- black cylindrical action + flat top, big bolt with pear handle --
  b.cyl(0.019, 0.019, 0.19, DS, 0, 0.024, -0.115, Math.PI / 2, 0, 0, 20);
  b.box(0.024, 0.008, 0.19, D, 0, 0.042, -0.115);                  // action flat/rail base
  b.box(0.020, 0.008, 0.065, D, 0.010, 0.038, -0.055);             // bolt raceway
  b.box(0.004, 0.014, 0.050, D, 0.0195, 0.020, -0.130);            // ejection port shadow
  b.cyl(0.013, 0.013, 0.030, S, 0, 0.024, -0.012, Math.PI / 2);    // bolt shroud
  const bolt = new THREE.Group(); g.add(bolt);
  const bb = new GunBuilder();
  bb.cyl(0.0055, 0.0055, 0.045, S, 0.028, 0.030, -0.040, 0, 0, 0.95); // bolt lever, swept back
  bb.sph(0.010, D, 0.048, 0.044, -0.040); bb.build(bolt);          // pear handle

  // Harris-style bipod on the forend spigot
  ubb.box(0.022, 0.018, 0.04, D, 0, -0.034, -0.43);
  ubb.cyl(0.008, 0.008, 0.026, DS, 0, -0.042, -0.43, 0, 0, Math.PI / 2); // cant hinge
  ubb.cyl(0.005, 0.005, 0.07, D, -0.018, -0.074, -0.43, 0.12, 0, 0.1);
  ubb.cyl(0.005, 0.005, 0.07, D, 0.018, -0.074, -0.43, 0.12, 0, -0.1);
  ubb.cyl(0.0035, 0.0035, 0.06, S, -0.022, -0.129, -0.437, 0.12, 0, 0.1); // lower leg L
  ubb.cyl(0.0035, 0.0035, 0.06, S, 0.022, -0.129, -0.437, 0.12, 0, -0.1); // lower leg R
  ubb.box(0.010, 0.008, 0.014, R, -0.025, -0.160, -0.440);          // foot L
  ubb.box(0.010, 0.008, 0.014, R, 0.025, -0.160, -0.440);           // foot R

  ubb.build(ubG); g.add(ubG);
  b.build(g);

  // Scope is its own group so it disappears in ADS — the HUD renders the clean high-zoom scope
  const optic = new THREE.Group(); g.add(optic);
  const sb = new GunBuilder();
  sb.box(0.024, 0.014, 0.08, D, 0, 0.045, -0.12);                         // Picatinny base
  sb.cyl(0.007, 0.007, 0.03, DS, -0.014, 0.045, -0.11, 0, 0, Math.PI / 2); // clamping screws
  sb.cyl(0.007, 0.007, 0.03, DS,  0.014, 0.045, -0.11, 0, 0, Math.PI / 2);
  for (const z of [-0.045, -0.19]) {                                      // scope rings (leave with the scope)
    sb.box(0.032, 0.017, 0.024, DS, 0, 0.046, z);
    sb.cyl(0.021, 0.021, 0.016, DS, 0, SIGHT_Y, z, Math.PI / 2);
  }
  sb.cyl(0.017, 0.017, 0.23, D, 0, SIGHT_Y, -0.13, Math.PI / 2, 0, 0, 24, true);  // 34mm scope tube
  sb.cyl(0.026, 0.019, 0.06, D, 0, SIGHT_Y, -0.255, Math.PI / 2, 0, 0, 24, true);          // objective bell 50mm
  sb.cyl(0.020, 0.017, 0.05, D, 0, SIGHT_Y, -0.005, Math.PI / 2, 0, 0, 24, true);          // ocular bell
  sb.cyl(0.014, 0.014, 0.03, D, 0, SIGHT_Y - 0.024, -0.13);                // elevation turret
  sb.cyl(0.014, 0.014, 0.03, D, 0.024, SIGHT_Y, -0.13, 0, 0, Math.PI / 2); // windage turret
  sb.cyl(0.010, 0.010, 0.02, D, 0, SIGHT_Y + 0.024, -0.13);                // parallax knob
  sb.box(0.022, 0.018, 0.014, D, 0, SIGHT_Y, -0.05);                       // throw lever
  for (let i=0;i<8;i++) sb.cyl(0.021,0.021,0.0018,DS,0,SIGHT_Y,-0.025+i*0.004,Math.PI/2,0,0,24,true);
  sb.build(optic);

  // Scope lenses (glass tint + mil-dot reticle) kept with the scope, hidden in ADS
  const adsHidden: THREE.Object3D[] = [];
  const scopeLens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), WM.glass);
  scopeLens.position.set(0, SIGHT_Y, 0.018); g.add(scopeLens);
  const retH = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.0007), WM.reticle);
  retH.position.set(0, SIGHT_Y, 0.017); g.add(retH);
  const retV = new THREE.Mesh(new THREE.PlaneGeometry(0.0007, 0.032), WM.reticle);
  retV.position.set(0, SIGHT_Y, 0.017); g.add(retV);
  // mil-dot ticks on the reticle crosshair
  for (const [ox, oy] of [[-0.012, 0], [0.012, 0], [0, -0.012], [0, 0.012]] as const) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 6), WM.reticle);
    dot.position.set(ox, SIGHT_Y + oy, 0.017); g.add(dot);
    adsHidden.push(dot);
  }
  adsHidden.push(optic, scopeLens, retH, retV);

  // Detachable box magazine (5 rounds .338 Lapua) — stubby single-stack that
  // barely proud of the chassis belly, exactly like the real AI mag.
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.026, 0.052, 0.075, DS, 0, -0.040, -0.145);
  mb.box(0.028, 0.008, 0.078, D, 0, -0.068, -0.145);               // baseplate
  mb.box(0.0265, 0.004, 0.076, S, 0, -0.052, -0.145);              // witness seam
  mb.build(mag);
  mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);

  const { lArm, keys } = attachArms(g, { fore: [0, -0.038, -0.35], mag: [0, -0.075, -0.145], fa: [0.048, 0.044, -0.04] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.024, -0.73); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.024, -0.725),
    optic: makeSocket(0, 0.052, -0.12),
    magazine: makeSocket(0, -0.014, -0.145),
    underbarrel: makeSocket(0, -0.034, -0.43),
    rail: makeSocket(-0.021, 0.0, -0.30),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [...adsHidden], magazine: [mag], underbarrel: [ubG] };
  return { group: g, mag, chargingHandle: bolt, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export function buildMP7(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.062;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, MS = WM.midSteel;
  const b = new GunBuilder();
  const skb = new GunBuilder(); const skG = new THREE.Group();
  const ubb = new GunBuilder(); const ubG = new THREE.Group();
  const opb = new GunBuilder(); const opG = new THREE.Group();

  // Compact reinforced polymer receiver
  b.box(0.041, 0.059, 0.22, P, 0, 0.01, -0.10);
  b.box(0.042, 0.010, 0.20, MS, 0, -0.012, -0.10);                   // lower stiffener
  b.box(0.036, 0.012, 0.24, D, 0, 0.04, -0.11);                     // top Picatinny rail
  for (const sx of [-1, 1]) b.box(0.004, 0.040, 0.18, MS, sx * 0.022, 0.005, -0.02); // side plates
  for (const sx of [-1, 1]) b.box(0.010, 0.010, 0.18, D, sx * 0.024, 0.030, -0.10); // side rails
  b.box(0.036, 0.035, 0.09, P, 0, -0.028, -0.125);                   // lower receiver
  b.box(0.030, 0.025, 0.05, P, 0, -0.025, -0.155);                   // battery compartment
  b.box(0.028, 0.030, 0.030, G, 0, -0.100, -0.028, -0.32);           // grip backstrap
  b.cyl(0.016, 0.016, 0.06, P, 0, 0.012, -0.23, Math.PI / 2, 0, 0, 20); // barrel shroud
  for (let i = 0; i < 9; i++) b.box(0.030, 0.006, 0.013, D, 0, 0.048, -0.04 - i * 0.02);
  // folded flip-up BUIS lying flat on the rail (never block the sight)
  b.box(0.020, 0.005, 0.030, D, 0, 0.053, -0.205);                  // front flip folded
  b.box(0.024, 0.005, 0.026, D, 0, 0.053, -0.025);                  // rear flip folded
  for (const sx of [-1, 1]) b.box(0.006, 0.012, 0.034, D, sx * 0.014, 0.055, -0.205); // sight wings

  // Ventilated heat shield, ambidextrous controls and receiver pins.
  for(const side of [-1,1]) {
    for(let i=0;i<5;i++) b.box(0.002,0.008,0.012,DS,side*0.022,0.019,-0.15-i*0.017);
    b.cyl(0.003,0.003,0.002,S,side*0.022,-0.003,-0.025,0,0,Math.PI/2);
    b.box(0.004,0.007,0.026,DS,side*0.024,0.005,-0.062);
    b.box(0.005,0.008,0.020,S,side*0.023,-0.008,-0.045);             // selector paddle
  }
  b.box(0.002,0.016,0.058,DS,0.022,0.023,-0.064); // ejection port
  b.box(0.004,0.008,0.051,S,0.024,0.014,-0.064);
  b.box(0.006,0.008,0.012,S,-0.023,-0.002,-0.045);                   // mag release
  for (let i = 0; i < 4; i++) b.box(0.030, 0.004, 0.010, D, 0, -0.020, -0.13 - i * 0.020); // hand-stop ridges
  // Folding foregrip (extended forward)
  ubb.box(0.022, 0.065, 0.025, G, 0, -0.04, -0.21, 0.12);
  ubb.box(0.024, 0.012, 0.028, P, 0, -0.005, -0.21);                // hinge block
  ubb.cyl(0.006, 0.006, 0.026, S, 0, -0.005, -0.21, 0, 0, Math.PI / 2); // hinge pin
  for (let i = 0; i < 3; i++) ubb.box(0.023, 0.004, 0.020, D, 0, -0.025 - i * 0.014, -0.208 - i * 0.003, 0.12);
  ubb.box(0.024, 0.008, 0.027, P, 0, -0.073, -0.218, 0.12);         // pommel cap

  // Pistol grip with 40-round magazine inserted inside the grip
  b.box(0.028, 0.095, 0.038, G, 0, -0.055, -0.05, -0.32);
  for (let i = 0; i < 4; i++) b.box(0.029, 0.004, 0.030, D, 0, -0.035 - i * 0.016, -0.043 - i * 0.005, -0.32);
  b.box(0.030, 0.008, 0.040, P, 0, -0.100, -0.066, -0.32);          // grip base
  b.box(0.006, 0.004, 0.045, P, 0, -0.045, -0.10);                  // trigger guard
  b.box(0.005, 0.018, 0.005, S, 0, -0.035, -0.098);                 // trigger with safety blade

  // Ambi charging handle at rear top (T-handle like MP7)
  b.box(0.045, 0.010, 0.025, D, 0, 0.036, 0.02);
  b.box(0.056, 0.008, 0.014, D, 0, 0.036, 0.026);                   // T wings
  for (const sx of [-1, 1]) b.box(0.008, 0.012, 0.030, DS, sx * 0.026, 0.036, 0.020); // T latches
  b.box(0.008, 0.025, 0.055, P, 0, -0.052, -0.10);                   // trigger bow
  skb.box(0.036, 0.025, 0.030, P, 0, 0.030, 0.155);                  // pad heel
  skb.box(0.030, 0.055, 0.012, G, 0, 0.005, 0.160);                   // pad face plate

  // Extendable wire stock rails + buttpad
  skb.cyl(0.004, 0.004, 0.16, S, -0.018, 0.01, 0.07, Math.PI / 2);  // left rail
  skb.cyl(0.004, 0.004, 0.16, S,  0.018, 0.01, 0.07, Math.PI / 2);  // right rail
  for (const sx of [-1, 1]) skb.cyl(0.006, 0.006, 0.05, D, sx * 0.018, 0.01, 0.025, Math.PI / 2, 0, 0, 12);
  skb.box(0.036, 0.020, 0.028, P, 0, -0.037, 0.155);                 // pad toe
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) skb.cyl(0.0045, 0.0045, 0.004, D, sx * 0.018, 0.01, 0.03 + i * 0.03, Math.PI / 2);
  skb.box(0.036, 0.065, 0.016, P, 0, 0.005, 0.155);                 // buttpad
  skb.box(0.030, 0.050, 0.006, G, 0, 0.005, 0.148);                 // pad face
  skb.cyl(0.005, 0.005, 0.004, D, -0.019, 0.005, 0.155, 0, 0, Math.PI / 2); // QD socket

  // Compact barrel + slotted flash hider
  b.cyl(0.007, 0.007, 0.06, S, 0, 0.012, -0.24, Math.PI / 2);
  b.box(0.022, 0.022, 0.025, D, 0, 0.012, -0.215);                   // barrel collar
  b.cyl(0.010, 0.010, 0.035, DS, 0, 0.012, -0.28, Math.PI / 2);
  for (let i = 0; i < 4; i++) { const ha = (i / 4) * Math.PI * 2 + 0.4; b.box(0.004, 0.004, 0.024, D, Math.cos(ha) * 0.0095, 0.012 + Math.sin(ha) * 0.0095, -0.28); }
  b.cyl(0.0035, 0.0035, 0.037, D, 0, 0.012, -0.28, Math.PI / 2);    // bore shadow

  // Micro Red Dot Sight (Aimpoint T1 style on high riser)
  opb.box(0.028, 0.016, 0.040, D, 0, 0.052, -0.12);                 // riser mount
  opb.cyl(0.016, 0.016, 0.052, D, 0, SIGHT_Y+0.004, -0.12, Math.PI / 2,0,0,20,true);    // micro tube body
  opb.cyl(0.006, 0.006, 0.008, D, 0.014, SIGHT_Y, -0.12, 0, 0, Math.PI / 2); // battery cap
  skb.build(skG); g.add(skG);
  ubb.build(ubG); g.add(ubG);
  opb.build(opG); g.add(opG);
  b.build(g);

  // Lens & bright micro dot (hidden in ADS — HUD draws the clean red dot)
  const adsHidden: THREE.Object3D[] = [];
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.011, 14), WM.glass);
  lens.position.set(0, SIGHT_Y, -0.09); g.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 10), WM.reticle);
  dot.position.set(0, SIGHT_Y, -0.089); g.add(dot);
  adsHidden.push(lens, dot);

  // 40-round straight high-capacity magazine inside grip
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.025, 0.11, 0.032, DS, 0, -0.09, -0.07, -0.32);
  mb.box(0.028, 0.012, 0.036, D, 0, -0.15, -0.09, -0.32);
  for(const side of [-1,1]) for(let i=0;i<4;i++) mb.box(0.002,0.004,0.023,D,side*0.013,-0.10-i*0.009,-0.073-i*0.003,-0.32);
  mb.build(mag);
  mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);

  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0, -0.05, -0.21], mag: [0, -0.15, -0.09], fa: [0, 0.036, 0.02] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.31); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.012, -0.30),
    optic: makeSocket(0, 0.056, -0.12),
    magazine: makeSocket(0, -0.05, -0.055),
    underbarrel: makeSocket(0, -0.02, -0.21),
    stock: makeSocket(0, 0.01, 0.0),
    rail: makeSocket(-0.023, 0.01, -0.10),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [opG, ...adsHidden], magazine: [mag], underbarrel: [ubG], stock: [skG] };
  return { group: g, mag, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export function buildSCARH(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.066;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, R = WM.rubber, T = WM.fde, TD = WM.tan, MS = WM.midSteel;
  const b = new GunBuilder();
  const skb = new GunBuilder(); const skG = new THREE.Group();
  const mb = new GunBuilder(); const mag = new THREE.Group();
  const brb = new GunBuilder(); const brG = new THREE.Group();
  // FDE flat-top receiver with full-length top rail
  b.box(0.045, 0.062, 0.40, T, 0, 0.012, -0.20);                     // receiver
  b.box(0.040, 0.012, 0.42, TD, 0, 0.047, -0.20);                    // top rail spine
  for (let i = 0; i < 12; i++) b.box(0.034, 0.006, 0.014, TD, 0, 0.055, -0.055 - i * 0.027);
  b.box(0.002, 0.040, 0.36, TD, -0.0235, 0.012, -0.20);              // side plate L
  b.box(0.002, 0.040, 0.36, TD, 0.0235, 0.012, -0.20);               // side plate R
  for (let i = 0; i < 6; i++) b.box(0.004, 0.010, 0.020, TD, -0.0235, 0.012, -0.06 - i * 0.055); // rail covers L
  for (let i = 0; i < 6; i++) b.box(0.004, 0.010, 0.020, TD, 0.0235, 0.012, -0.06 - i * 0.055); // rail covers R
  b.cyl(0.004, 0.004, 0.048, S, 0, 0.020, -0.06, 0, 0, Math.PI / 2);  // takedown pin F
  b.cyl(0.004, 0.004, 0.048, S, 0, 0.020, -0.34, 0, 0, Math.PI / 2);  // takedown pin R
  // ambi charging handle recess + handle
  b.box(0.030, 0.014, 0.040, D, 0, 0.040, -0.36);
  const ch = new THREE.Group(); ch.position.set(0, 0.040, -0.36);
  const chb = new GunBuilder();
  chb.box(0.018, 0.008, 0.034, DS, 0, 0, 0.008);                       // CH stem
  chb.box(0.022, 0.014, 0.026, D, -0.020, 0, 0);                      // side handle L
  chb.box(0.006, 0.010, 0.020, DS, -0.028, 0, 0);                      // handle serrations
  chb.box(0.012, 0.010, 0.020, D, 0.015, 0, 0);                       // nub R
  chb.build(ch); ch.userData.homeZ = 0; g.add(ch);
  // reciprocating bolt visible in the ejection cutout (right side)
  b.box(0.002, 0.022, 0.060, D, 0.0235, 0.018, -0.26);               // ejection cutout
  b.box(0.002, 0.016, 0.040, S, 0.0232, 0.018, -0.26);               // bolt in cutout
  for (let i = 0; i < 3; i++) b.box(0.002, 0.014, 0.003, D, 0.0234, 0.018, -0.272 + i * 0.012); // bolt serrations
  b.box(0.002, 0.006, 0.014, DS, 0.0234, 0.023, -0.245);              // extractor
  b.box(0.006, 0.020, 0.030, TD, 0.0245, 0.020, -0.215);              // brass deflector
  b.box(0.030, 0.035, 0.012, DS, 0, 0.008, -0.005);                // QD end plate
  b.box(0.034, 0.010, 0.19, TD, 0, 0.040, -0.4775);                   // forend top rail
  b.box(0.020, 0.012, 0.012, TD, 0, 0.050, -0.56);                   // sight riser
  b.box(0.028, 0.025, 0.025, TD, 0, -0.045, -0.035);                 // beavertail
  skb.box(0.016, 0.014, 0.030, DS, 0, -0.022, 0.003);                // stock latch
  b.box(0.042, 0.020, 0.050, TD, 0, -0.040, -0.125, -0.22);              // magwell flare
  b.box(0.040, 0.016, 0.10, T, 0, -0.019, -0.44);                     // forend belly
  b.box(0.026, 0.040, 0.014, TD, 0, -0.040, -0.055);                 // grip cap
  // SCAR trigger module + ambi selector + mag release
  b.box(0.030, 0.030, 0.090, TD, 0, -0.030, -0.10);                  // trigger module
  b.box(0.006, 0.004, 0.050, P, 0, -0.048, -0.155);                  // trigger guard
  b.box(0.005, 0.020, 0.006, S, 0, -0.038, -0.150);                  // trigger
  for (const sx of [-1, 1]) b.box(0.004, 0.008, 0.026, S, sx * 0.017, -0.028, -0.095); // selector
  b.box(0.006, 0.010, 0.016, S, -0.017, -0.024, -0.075);             // mag release L
  b.box(0.006, 0.010, 0.016, S, 0.017, -0.024, -0.075);              // mag release R
  b.box(0.006, 0.018, 0.012, S, -0.017, -0.020, -0.115);             // bolt catch
  b.cyl(0.003, 0.003, 0.032, DS, 0, -0.030, -0.120, 0, 0, Math.PI / 2); // trigger pin
  b.cyl(0.003, 0.003, 0.032, DS, 0, -0.030, -0.085, 0, 0, Math.PI / 2); // hammer pin
  // free-float forend with vent slots + QD sockets
  b.box(0.046, 0.052, 0.16, T, 0, 0.008, -0.47);                     // forend
  for (let i = 0; i < 7; i++) {
    b.box(0.002, 0.020, 0.012, TD, -0.0235, 0.008, -0.41 - i * 0.020);
    b.box(0.002, 0.020, 0.012, TD, 0.0235, 0.008, -0.41 - i * 0.020);
  }
  for (let i = 0; i < 5; i++) b.box(0.020, 0.002, 0.012, TD, 0, -0.0185, -0.42 - i * 0.022); // bottom slots
  for (let i = 0; i < 3; i++) {
    b.box(0.003, 0.006, 0.120, TD, -0.024, 0.002 + i * 0.010, -0.47);
    b.box(0.003, 0.006, 0.120, TD, 0.024, 0.002 + i * 0.010, -0.47);
  }
  b.cyl(0.004, 0.004, 0.003, DS, -0.0235, -0.005, -0.02, 0, 0, Math.PI / 2); // rear QD
  b.cyl(0.004, 0.004, 0.003, D, -0.0235, 0.020, -0.55, 0, 0, Math.PI / 2); // QD L
  b.cyl(0.004, 0.004, 0.003, D, 0.0235, 0.020, -0.55, 0, 0, Math.PI / 2); // QD R
  b.cyl(0.014, 0.014, 0.030, DS, 0, 0.020, -0.545, Math.PI / 2);      // gas block
  b.cyl(0.005, 0.005, 0.020, S, 0, 0.038, -0.545);                    // gas regulator
  b.cyl(0.008, 0.008, 0.010, DS, 0, 0.050, -0.545, 0, 0, 0, 12);       // regulator dial
  b.box(0.017, 0.004, 0.004, D, 0, 0.050, -0.545);                    // dial notch
  b.box(0.004, 0.004, 0.017, D, 0, 0.050, -0.545);                    // dial notch 2
  // heavy barrel + PWS-style compensator with prongs
  brb.cyl(0.0085, 0.0085, 0.14, S, 0, 0.020, -0.60, Math.PI / 2, 0, 0, 20);
  brb.cyl(0.013, 0.013, 0.050, DS, 0, 0.020, -0.685, Math.PI / 2, 0, 0, 20);
  brb.cyl(0.0145, 0.0145, 0.006, DS, 0, 0.020, -0.670, Math.PI / 2);   // chamber ring F
  brb.cyl(0.0145, 0.0145, 0.006, DS, 0, 0.020, -0.700, Math.PI / 2);   // chamber ring R
  for (let i = 0; i < 3; i++) { const ma = (i / 3) * Math.PI * 2; brb.box(0.006, 0.008, 0.040, D, Math.cos(ma) * 0.0125, 0.020 + Math.sin(ma) * 0.0125, -0.685); }
  brb.cyl(0.004, 0.004, 0.052, D, 0, 0.020, -0.685, Math.PI / 2);     // bore shadow
  // FDE pistol grip with palm swell
  b.box(0.030, 0.085, 0.036, T, 0, -0.075, -0.055, -0.30);
  b.box(0.032, 0.020, 0.020, TD, 0, -0.095, -0.038, -0.30);           // palm swell
  for (let i = 0; i < 3; i++) b.box(0.031, 0.004, 0.028, TD, 0, -0.055 - i * 0.016, -0.049 - i * 0.005, -0.30);
  // flip-up BUIS (front post + rear aperture, deployed)
  b.box(0.006, 0.020, 0.008, D, 0, SIGHT_Y - 0.010, -0.56);          // front post
  b.box(0.020, 0.006, 0.010, D, 0, 0.058, -0.56);                    // front wings base
  b.box(0.004, 0.016, 0.010, D, -0.012, SIGHT_Y - 0.012, -0.56);     // wing L
  b.box(0.004, 0.016, 0.010, D, 0.012, SIGHT_Y - 0.012, -0.56);      // wing R
  b.box(0.024, 0.006, 0.012, D, 0, 0.058, -0.10);                    // rear housing
  b.box(0.006, 0.014, 0.010, D, -0.011, SIGHT_Y - 0.011, -0.10);     // ear L
  b.box(0.006, 0.014, 0.010, D, 0.011, SIGHT_Y - 0.011, -0.10);      // ear R
  b.box(0.016, 0.003, 0.010, D, 0, SIGHT_Y - 0.004, -0.10);          // aperture deck
  b.cyl(0.0022, 0.0022, 0.012, MS, 0, SIGHT_Y - 0.004, -0.10, Math.PI / 2); // aperture
  // side-folding skeleton stock + rubber pad + cheek riser
  skb.box(0.040, 0.055, 0.10, T, 0, 0.008, 0.055);                   // stock body
  skb.box(0.030, 0.030, 0.06, TD, 0, 0.008, 0.055);                  // lightening cut
  skb.box(0.036, 0.050, 0.022, R, 0, 0.008, 0.115);                  // rubber pad
  skb.box(0.034, 0.014, 0.090, TD, 0, 0.042, 0.055);                 // cheek riser
  skb.cyl(0.008, 0.008, 0.044, S, 0, 0.008, 0.003, 0, 0, Math.PI / 2); // hinge pin
  skb.box(0.020, 0.020, 0.016, DS, 0, 0.008, 0.003);                 // hinge block
  skb.cyl(0.005, 0.005, 0.004, DS, -0.021, 0.008, 0.055, 0, 0, Math.PI / 2); // QD L
  skb.cyl(0.005, 0.005, 0.004, DS, 0.021, 0.008, 0.055, 0, 0, Math.PI / 2); // QD R
  skb.box(0.008, 0.006, 0.028, DS, 0, -0.022, 0.055);                // fold lever
  skb.box(0.006, 0.018, 0.026, DS, 0.017, 0.008, 0.080);             // sling slot
  for (let i = 0; i < 2; i++) skb.box(0.037, 0.005, 0.023, DS, 0, -0.005 + i * 0.020, 0.115); // pad ribs
  skb.cyl(0.004, 0.004, 0.036, DS, 0, 0.036, 0.030, 0, 0, Math.PI / 2); // riser knob F
  skb.cyl(0.004, 0.004, 0.036, DS, 0, 0.036, 0.080, 0, 0, Math.PI / 2); // riser knob R
  skb.build(skG); skG.userData.homeZ = 0; g.add(skG);
  // 20-round 7.62 curved steel mag
  mb.box(0.032, 0.11, 0.052, S, 0, -0.09, -0.135, -0.22);
  mb.box(0.034, 0.014, 0.054, D, 0, -0.145, -0.15, -0.22);
  for (let i = 0; i < 4; i++) mb.box(0.033, 0.005, 0.045, DS, 0, -0.065 - i * 0.02, -0.128 - i * 0.005, -0.22);
  mb.box(0.034, 0.030, 0.054, DS, 0, -0.038, -0.122, -0.22);          // magwell collar
  mb.build(mag); mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);
  brb.build(brG); g.add(brG);
  b.build(g);
  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0, -0.02, -0.46], mag: [0, -0.12, -0.13], fa: [0, 0.04, -0.36] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.020, -0.72); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.020, -0.71),
    optic: makeSocket(0, 0.062, -0.20),
    magazine: makeSocket(0, -0.03, -0.125),
    underbarrel: makeSocket(0, -0.024, -0.46),
    stock: makeSocket(0, 0.008, 0.0),
    grip: makeSocket(0, -0.06, -0.055),
    rail: makeSocket(-0.026, 0.012, -0.30),
    barrel: makeSocket(0, 0.020, -0.54),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { magazine: [mag], stock: [skG], barrel: [brG] };
  return { group: g, mag, chargingHandle: ch, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden: [], sockets, removable, attached: {} };
}

export function buildVector(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.068;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, R = WM.rubber, MS = WM.midSteel;
  const b = new GunBuilder();
  const skb = new GunBuilder(); const skG = new THREE.Group();
  const ubb = new GunBuilder(); const ubG = new THREE.Group();
  const opb = new GunBuilder(); const opG = new THREE.Group();
  const brb = new GunBuilder(); const brG = new THREE.Group();

  // Slab-sided Super-V receiver with top rail + side vents
  b.box(0.048, 0.075, 0.30, P, 0, 0.005, -0.13);
  b.box(0.040, 0.014, 0.32, D, 0, 0.046, -0.13);                     // top rail
  for (let i = 0; i < 11; i++) b.box(0.034, 0.006, 0.014, DS, 0, 0.055, -0.01 - i * 0.024);
  b.box(0.050, 0.020, 0.26, D, 0, -0.028, -0.13);                    // lower clamshell
  for (let i = 0; i < 6; i++) {
    b.box(0.002, 0.018, 0.016, DS, -0.0245, 0.005, -0.02 - i * 0.042);
    b.box(0.002, 0.018, 0.016, DS, 0.0245, 0.005, -0.02 - i * 0.042);
  }
  b.box(0.002, 0.020, 0.070, MS, 0.0245, 0.010, -0.20);              // ejection port
  b.box(0.004, 0.012, 0.050, D, 0.0245, 0.010, -0.20);               // port recess
  b.cyl(0.004, 0.004, 0.052, S, 0, 0.028, -0.03, 0, 0, Math.PI / 2);  // pin F
  b.cyl(0.004, 0.004, 0.052, S, 0, 0.028, -0.23, 0, 0, Math.PI / 2);  // pin R
  // Super-V pivoting trigger module + guard + ambi safety
  b.box(0.030, 0.034, 0.080, P, 0, -0.045, -0.055);                  // trigger housing
  b.box(0.006, 0.004, 0.055, D, 0, -0.062, -0.090);                  // trigger guard
  b.box(0.005, 0.020, 0.006, S, 0, -0.052, -0.085);                  // trigger
  for (const sx of [-1, 1]) b.box(0.004, 0.008, 0.026, S, sx * 0.017, -0.040, -0.045); // safety
  // textured pistol grip
  b.box(0.030, 0.085, 0.036, G, 0, -0.085, -0.020, -0.30);
  for (let i = 0; i < 4; i++) b.box(0.031, 0.004, 0.028, D, 0, -0.060 - i * 0.015, -0.013 - i * 0.005, -0.30);
  b.box(0.032, 0.008, 0.038, P, 0, -0.126, -0.032, -0.30);           // grip base
  // short barrel shroud + threaded muzzle + protector
  brb.cyl(0.017, 0.017, 0.07, P, 0, 0.010, -0.295, Math.PI / 2, 0, 0, 20);
  brb.cyl(0.012, 0.012, 0.030, S, 0, 0.010, -0.335, Math.PI / 2);
  brb.cyl(0.014, 0.014, 0.012, D, 0, 0.010, -0.348, Math.PI / 2);    // thread protector
  brb.cyl(0.005, 0.005, 0.032, D, 0, 0.010, -0.335, Math.PI / 2);    // bore shadow
  // non-reciprocating side charger (left)
  b.box(0.014, 0.012, 0.030, D, -0.028, 0.028, -0.06);
  b.box(0.012, 0.020, 0.040, G, -0.032, 0.028, -0.06);               // charger knob
  b.box(0.046, 0.030, 0.20, D, 0, -0.048, -0.18);                     // magwell shroud
  brb.cyl(0.020, 0.020, 0.05, P, 0, 0.010, -0.265, Math.PI / 2, 0, 0, 20); // shroud ring
  b.box(0.030, 0.030, 0.025, G, 0, -0.055, -0.26);                   // hand-stop fin
  b.box(0.046, 0.070, 0.018, D, 0, 0.005, 0.025);                    // rear cap plate
  b.box(0.014, 0.020, 0.050, DS, 0, 0.002, 0.040);                   // stock latch lever
  b.box(0.006, 0.040, 0.008, S, 0, -0.040, -0.275);                  // front sling loop
  b.box(0.046, 0.070, 0.020, D, 0, 0.005, -0.285);                    // front receiver cap
  b.box(0.028, 0.030, 0.020, P, 0, -0.115, -0.015, -0.30);           // grip plug
  // flip-up polymer BUIS (deployed)
  b.box(0.006, 0.018, 0.008, D, 0, SIGHT_Y - 0.009, -0.27);          // front post
  b.box(0.022, 0.006, 0.010, D, 0, 0.060, -0.27);                    // front base
  b.box(0.026, 0.006, 0.012, D, 0, 0.060, -0.015);                   // rear housing
  b.box(0.005, 0.014, 0.010, D, -0.011, SIGHT_Y - 0.009, -0.015);    // ear L
  b.box(0.005, 0.014, 0.010, D, 0.011, SIGHT_Y - 0.009, -0.015);     // ear R
  // folding vertical foregrip with finger grooves + hinge
  ubb.box(0.024, 0.075, 0.028, G, 0, -0.075, -0.21, 0.10);
  ubb.box(0.026, 0.014, 0.030, P, 0, -0.040, -0.21);                 // hinge block
  ubb.cyl(0.007, 0.007, 0.028, P, 0, -0.040, -0.21, 0, 0, Math.PI / 2); // hinge pin
  for (let i = 0; i < 3; i++) ubb.box(0.025, 0.004, 0.022, D, 0, -0.060 - i * 0.016, -0.208 - i * 0.003, 0.10);
  ubb.box(0.026, 0.008, 0.030, P, 0, -0.112, -0.216, 0.10);          // pommel
  // 4-position telescoping stock rails + pad
  skb.cyl(0.005, 0.005, 0.15, S, -0.016, 0.012, 0.075, Math.PI / 2);
  skb.cyl(0.005, 0.005, 0.15, S, 0.016, 0.012, 0.075, Math.PI / 2);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) skb.cyl(0.0055, 0.0055, 0.004, D, sx * 0.016, 0.012, 0.02 + i * 0.03, Math.PI / 2);
  skb.box(0.040, 0.075, 0.020, P, 0, 0.008, 0.155);                  // buttpad
  skb.box(0.034, 0.060, 0.006, R, 0, 0.008, 0.146);                  // pad face
  skb.box(0.030, 0.018, 0.10, G, 0, 0.048, 0.10);                    // cheek weld
  // EOTech-class holographic window (removable optic)
  opb.box(0.030, 0.014, 0.050, D, 0, 0.062, -0.11);                  // riser
  opb.box(0.034, 0.030, 0.008, D, 0, SIGHT_Y + 0.004, -0.135);       // window frame
  opb.box(0.030, 0.020, 0.030, D, 0, SIGHT_Y - 0.002, -0.115);       // hood body
  opb.box(0.026, 0.010, 0.006, D, 0, SIGHT_Y - 0.012, -0.095);       // battery box
  skb.build(skG); skG.userData.homeZ = 0; g.add(skG);
  ubb.build(ubG); g.add(ubG);
  opb.build(opG); g.add(opG);
  brb.build(brG); g.add(brG);
  b.build(g);

  const adsHidden: THREE.Object3D[] = [];
  const glassF = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.024), WM.glass);
  glassF.position.set(0, SIGHT_Y + 0.004, -0.1305); g.add(glassF);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0045, 0.0055, 24), WM.reticle);
  ring.position.set(0, SIGHT_Y + 0.004, -0.130); g.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 10), WM.reticle);
  dot.position.set(0, SIGHT_Y + 0.004, -0.1295); g.add(dot);
  adsHidden.push(glassF, ring, dot);

  // Extended .45 ACP stick magazine ahead of the trigger guard
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.030, 0.13, 0.042, DS, 0, -0.10, -0.145);
  mb.box(0.032, 0.012, 0.044, D, 0, -0.168, -0.145);
  for (let i = 0; i < 5; i++) mb.box(0.031, 0.004, 0.036, S, 0, -0.065 - i * 0.02, -0.145);
  mb.box(0.034, 0.024, 0.046, P, 0, -0.045, -0.145);                 // magwell flare
  mb.build(mag); mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);

  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0, -0.075, -0.23], mag: [0, -0.14, -0.125], fa: [-0.032, 0.028, -0.06] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.010, -0.36); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.010, -0.355),
    optic: makeSocket(0, 0.062, -0.11),
    magazine: makeSocket(0, -0.04, -0.145),
    underbarrel: makeSocket(0, -0.042, -0.21),
    stock: makeSocket(0, 0.012, 0.02),
    rail: makeSocket(-0.026, 0.005, -0.13),
    barrel: makeSocket(0, 0.010, -0.28),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [opG, ...adsHidden], magazine: [mag], underbarrel: [ubG], stock: [skG], barrel: [brG] };
  return { group: g, mag, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export function buildSPAS12(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.070;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, R = WM.rubber, MS = WM.midSteel;
  const b = new GunBuilder();
  const pbb = new GunBuilder(); const pump = new THREE.Group();
  const skb = new GunBuilder(); const skG = new THREE.Group();

  // Chunky SPAS receiver with top rail + side plates
  b.box(0.046, 0.070, 0.30, S, 0, 0.005, -0.05);
  b.box(0.040, 0.012, 0.32, D, 0, 0.044, -0.05);                     // top rail spine
  for (let i = 0; i < 10; i++) b.box(0.034, 0.006, 0.014, DS, 0, 0.052, 0.075 - i * 0.027);
  b.box(0.002, 0.050, 0.26, DS, -0.024, 0.005, -0.05);               // side plate L
  b.box(0.002, 0.050, 0.26, DS, 0.024, 0.005, -0.05);                // side plate R
  for (let i = 0; i < 5; i++) {
    b.box(0.003, 0.012, 0.024, D, -0.024, 0.005, 0.03 - i * 0.045);
    b.box(0.003, 0.012, 0.024, D, 0.024, 0.005, 0.03 - i * 0.045);
  }
  b.box(0.002, 0.024, 0.080, MS, 0.024, 0.015, -0.10);               // loading port lip
  b.box(0.004, 0.018, 0.060, D, 0.024, 0.015, -0.10);                // port recess
  b.box(0.008, 0.016, 0.040, S, -0.025, 0.020, -0.16);               // pump release
  b.box(0.048, 0.072, 0.050, S, 0, 0.005, -0.215);                    // receiver collar
  b.box(0.008, 0.050, 0.16, D, -0.027, 0.005, -0.05);                // side saddle plate
  b.box(0.040, 0.060, 0.050, DS, 0, 0.008, 0.115);                   // stock adapter
  b.box(0.036, 0.020, 0.030, D, 0, -0.030, 0.10);                    // rear sling plate
  b.box(0.008, 0.024, 0.070, DS, 0, -0.056, -0.075);                 // trigger bow
  b.box(0.032, 0.022, 0.022, G, 0, -0.100, -0.002, -0.28);           // palm swell
  b.box(0.024, 0.024, 0.020, DS, 0, -0.008, -0.28);                  // tube clamp
  b.cyl(0.016, 0.016, 0.20, DS, 0, 0.018, -0.40, Math.PI / 2, 0, 0, 20); // barrel shroud
  b.cyl(0.018, 0.018, 0.02, D, 0, 0.018, -0.495, Math.PI / 2);       // shroud ring
  b.cyl(0.020, 0.020, 0.015, D, 0, 0.018, -0.30, Math.PI / 2, 0, 0, 12); // front band
  b.cyl(0.008, 0.008, 0.004, D, 0, SIGHT_Y - 0.004, 0.06, Math.PI / 2); // ghost aperture
  b.cyl(0.004, 0.004, 0.005, MS, 0, SIGHT_Y - 0.004, 0.06, Math.PI / 2); // aperture hole
  for (let i = 0; i < 6; i++) b.cyl(0.008, 0.008, 0.05, S, -0.033, 0.005, -0.11 + i * 0.024, Math.PI / 2, 0, 0, 10);
  b.box(0.044, 0.014, 0.080, S, 0, 0.038, 0.13);                     // top cover extension
  b.cyl(0.013, 0.013, 0.025, DS, 0, 0.018, -0.51, Math.PI / 2, 0, 0, 14); // muzzle ring
  b.box(0.004, 0.030, 0.090, DS, 0.024, 0.015, -0.02);               // port cover
  b.box(0.008, 0.040, 0.014, DS, 0, -0.038, -0.105);                 // guard front strap
  // ghost-ring sights (deployed): front blade + rear ring
  b.box(0.006, 0.022, 0.008, D, 0, SIGHT_Y - 0.011, -0.30);          // front blade
  b.box(0.024, 0.006, 0.010, D, 0, 0.060, -0.30);                    // front base
  b.box(0.028, 0.006, 0.012, D, 0, 0.060, 0.06);                     // rear housing
  b.box(0.006, 0.018, 0.010, D, -0.013, SIGHT_Y - 0.011, 0.06);      // ear L
  b.box(0.006, 0.018, 0.010, D, 0.013, SIGHT_Y - 0.011, 0.06);       // ear R
  // barrel + extended mag tube with cap + barrel ring
  b.cyl(0.011, 0.011, 0.30, S, 0, 0.018, -0.35, Math.PI / 2, 0, 0, 20);
  b.cyl(0.010, 0.010, 0.26, DS, 0, -0.008, -0.33, Math.PI / 2, 0, 0, 20); // mag tube
  b.cyl(0.013, 0.013, 0.020, D, 0, -0.008, -0.465, Math.PI / 2);      // tube cap
  b.cyl(0.005, 0.005, 0.302, D, 0, 0.018, -0.35, Math.PI / 2);        // bore shadow
  b.box(0.030, 0.040, 0.020, DS, 0, 0.005, -0.26);                    // barrel ring
  // sliding pump with action bars (reciprocates)
  pbb.box(0.040, 0.042, 0.10, G, 0, -0.008, -0.33);
  pbb.box(0.046, 0.048, 0.020, G, 0, -0.008, -0.385);                // pump cap F
  pbb.box(0.046, 0.048, 0.020, G, 0, -0.008, -0.235);                // pump cap R
  pbb.box(0.046, 0.048, 0.024, G, 0, -0.008, -0.31);                 // pump mid-band
  for (let i = 0; i < 4; i++) pbb.box(0.041, 0.006, 0.012, D, 0, -0.008, -0.29 - i * 0.024); // pump ribs
  pbb.cyl(0.004, 0.004, 0.10, S, -0.014, 0.005, -0.25, Math.PI / 2);  // action bar L
  pbb.cyl(0.004, 0.004, 0.10, S, 0.014, 0.005, -0.25, Math.PI / 2);   // action bar R
  // trigger group + cross-bolt safety + trigger guard
  b.box(0.006, 0.004, 0.060, D, 0, -0.048, -0.075);                  // trigger guard
  b.box(0.005, 0.020, 0.006, S, 0, -0.038, -0.070);                  // trigger
  b.cyl(0.004, 0.004, 0.050, S, 0, -0.030, -0.055, 0, 0, Math.PI / 2); // cross-bolt
  // pistol grip with finger grooves
  b.box(0.030, 0.085, 0.036, G, 0, -0.080, -0.010, -0.28);
  for (let i = 0; i < 3; i++) b.box(0.031, 0.004, 0.028, D, 0, -0.058 - i * 0.016, -0.004 - i * 0.005, -0.28);
  b.box(0.032, 0.008, 0.038, P, 0, -0.121, -0.021, -0.28);           // grip base
  // top-folding skeleton stock + struts + pad
  skb.cyl(0.005, 0.005, 0.20, S, -0.014, 0.015, 0.17, Math.PI / 2);   // strut L
  skb.cyl(0.005, 0.005, 0.20, S, 0.014, 0.015, 0.17, Math.PI / 2);    // strut R
  skb.cyl(0.007, 0.007, 0.030, D, 0, 0.015, 0.07, 0, 0, Math.PI / 2); // fold hinge
  skb.box(0.034, 0.070, 0.016, P, 0, 0.010, 0.270);                   // buttplate
  skb.box(0.030, 0.056, 0.006, R, 0, 0.010, 0.261);                   // pad face
  skb.box(0.036, 0.014, 0.06, G, 0, 0.048, 0.25);                     // cheek weld
  skb.build(skG); skG.userData.homeZ = 0; g.add(skG);
  pbb.build(pump); pump.userData.homeY = 0; pump.userData.homeZ = 0; g.add(pump);
  b.build(g);

  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0, -0.01, -0.32], mag: [0.02, 0.01, -0.08], fa: [0, 0.03, -0.18] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.018, -0.51); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.018, -0.50),
    optic: makeSocket(0, 0.058, -0.05),
    magazine: makeSocket(0, -0.02, -0.33),
    underbarrel: makeSocket(0, -0.035, -0.33),
    stock: makeSocket(0, 0.015, 0.08),
    rail: makeSocket(-0.025, 0.005, -0.17),
  };
  for (const s of Object.values(sockets)) g.add(s);
  // The pump IS the reload handle: engine drives `mag` for reload anims.
  const removable = { stock: [skG] };
  return { group: g, mag: pump, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden: [], sockets, removable, attached: {} };
}

export function buildDeagle(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.052;
  const S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, MS = WM.midSteel;
  const b = new GunBuilder();
  const slb = new GunBuilder(); const slide = new THREE.Group();
  const brb = new GunBuilder(); const brG = new THREE.Group();
  const opb = new GunBuilder(); const opG = new THREE.Group();
  // Massive triangular-profile slide with top rib + cocking serrations
  slb.box(0.034, 0.034, 0.200, S, 0, 0.030, -0.05);
  slb.box(0.020, 0.006, 0.190, MS, 0, 0.049, -0.05);                 // top rib
  slb.box(0.002, 0.024, 0.190, MS, -0.017, 0.030, -0.05, 0, 0, 0.10); // side bevel L
  slb.box(0.002, 0.024, 0.190, MS, 0.017, 0.030, -0.05, 0, 0, -0.10); // side bevel R
  for (let i = 0; i < 6; i++) slb.box(0.0355, 0.022, 0.0025, D, 0, 0.030, 0.016 + i * 0.006); // rear serrations
  for (let i = 0; i < 4; i++) slb.box(0.0355, 0.022, 0.0025, D, 0, 0.030, -0.122 + i * 0.006); // front serrations
  slb.box(0.002, 0.014, 0.045, D, 0.017, 0.036, -0.09);              // ejection port
  slb.box(0.002, 0.010, 0.035, S, 0.0166, 0.036, -0.09);             // chamber hood
  slb.box(0.030, 0.030, 0.005, D, 0, 0.030, 0.052);                  // rear plate
  slb.cyl(0.003, 0.003, 0.007, S, 0, 0.034, 0.052, Math.PI / 2);      // firing pin
  // gas-operated rotating bolt housing under the muzzle
  brb.cyl(0.008, 0.008, 0.040, S, 0, 0.030, -0.160, Math.PI / 2);     // barrel
  brb.box(0.024, 0.020, 0.050, DS, 0, 0.030, -0.135);                 // gas housing
  brb.cyl(0.010, 0.010, 0.008, D, 0, 0.030, -0.152, Math.PI / 2);     // housing ring
  brb.cyl(0.0045, 0.0045, 0.042, D, 0, 0.030, -0.160, Math.PI / 2);   // bore shadow
  // frame with accessory rail + trigger group
  b.box(0.030, 0.028, 0.150, S, 0, 0.004, -0.04);
  b.box(0.031, 0.004, 0.150, D, 0, 0.012, -0.04);                     // slide seam
  b.box(0.028, 0.010, 0.070, D, 0, -0.012, -0.10);                    // accessory rail
  for (let i = 0; i < 3; i++) b.box(0.029, 0.006, 0.010, DS, 0, -0.014, -0.075 - i * 0.022);
  b.box(0.006, 0.004, 0.034, DS, 0, -0.024, -0.048);                  // trigger guard
  b.box(0.005, 0.018, 0.005, S, 0, -0.015, -0.043);                   // trigger
  for (let i = 0; i < 3; i++) b.box(0.0055, 0.002, 0.0055, D, 0, -0.019 + i * 0.005, -0.043);
  b.box(0.010, 0.014, 0.012, S, 0, 0.036, 0.048);                     // hammer
  b.box(0.012, 0.006, 0.008, D, 0, 0.044, 0.048);                     // hammer spur
  b.box(0.005, 0.008, 0.024, S, -0.016, 0.018, 0.005);                // safety L
  b.box(0.005, 0.008, 0.024, S, 0.016, 0.018, 0.005);                 // safety R
  b.box(0.006, 0.008, 0.030, S, -0.016, 0.014, -0.025);               // slide stop
  b.cyl(0.004, 0.004, 0.005, S, -0.0155, 0.004, 0.002, 0, 0, Math.PI / 2); // mag release
  // fat rubber grips with finger grooves
  b.box(0.032, 0.085, 0.040, G, 0, -0.038, 0.022, -0.25);
  for (let i = 0; i < 3; i++) b.box(0.033, 0.005, 0.030, D, 0, -0.020 - i * 0.018, 0.028 - i * 0.004, -0.25);
  b.box(0.034, 0.008, 0.042, D, 0, -0.080, 0.032, -0.25);             // grip base
  opb.box(0.005, 0.010, 0.007, D, 0, SIGHT_Y, -0.138);                // front blade
  opb.box(0.006, 0.009, 0.007, D, -0.008, SIGHT_Y, 0.038);            // rear notch L
  opb.box(0.006, 0.009, 0.007, D, 0.008, SIGHT_Y, 0.038);             // rear notch R
  slb.build(slide); g.add(slide);
  brb.build(brG); g.add(brG);
  opb.build(opG); g.add(opG);
  b.build(g);
  // tritium dots (hidden in ADS)
  const adsHidden: THREE.Object3D[] = [];
  for (const [x, z] of [[0, -0.1415], [-0.008, 0.0345], [0.008, 0.0345]] as const) {
    const t = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 8), WM.tritium);
    t.position.set(x, SIGHT_Y + 0.002, z); g.add(t);
    adsHidden.push(t);
  }
  // 7-round single-stack mag (hidden in grip, drops on reload)
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.026, 0.080, 0.034, DS, 0, -0.040, 0.023, -0.25);
  mb.box(0.028, 0.008, 0.036, D, 0, -0.081, 0.033, -0.25);
  mb.build(mag);
  mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);
  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0.005, -0.105, -0.030], mag: [0, -0.090, 0.022], fa: [0.0, -0.015, -0.045] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.030, -0.185); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.030, -0.182),
    optic: makeSocket(0, 0.046, 0.0),
    magazine: makeSocket(0, -0.06, 0.032),
    rail: makeSocket(0.018, -0.01, -0.08),
    barrel: makeSocket(0, 0.030, -0.10),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [opG, ...adsHidden], magazine: [mag], barrel: [brG] };
  return { group: g, mag, chargingHandle: slide, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export function buildM249(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.075;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, R = WM.rubber, MS = WM.midSteel;
  const b = new GunBuilder();
  const skb = new GunBuilder(); const skG = new THREE.Group();
  const ubb = new GunBuilder(); const ubG = new THREE.Group();
  const brb = new GunBuilder(); const brG = new THREE.Group();

  // Stamped-steel SAW receiver with top cover rail
  b.box(0.052, 0.075, 0.42, DS, 0, 0.005, -0.10);
  b.box(0.044, 0.012, 0.44, D, 0, 0.046, -0.10);                     // top rail spine
  for (let i = 0; i < 13; i++) b.box(0.036, 0.006, 0.014, MS, 0, 0.054, 0.075 - i * 0.028);
  b.box(0.002, 0.055, 0.38, MS, -0.027, 0.005, -0.10);               // side plate L
  b.box(0.002, 0.055, 0.38, MS, 0.027, 0.005, -0.10);                // side plate R
  for (let i = 0; i < 6; i++) {
    b.cyl(0.003, 0.003, 0.003, S, -0.0275, 0.020, 0.02 - i * 0.05, 0, 0, Math.PI / 2);
    b.cyl(0.003, 0.003, 0.003, S, 0.0275, 0.020, 0.02 - i * 0.05, 0, 0, Math.PI / 2);
  }
  // hinged feed cover with latch (opens on reload)
  b.box(0.046, 0.018, 0.16, P, 0, 0.030, -0.16);                     // feed cover exterior
  b.cyl(0.006, 0.006, 0.048, S, 0, 0.030, -0.085, 0, 0, Math.PI / 2); // cover hinge
  b.box(0.014, 0.012, 0.020, S, 0, 0.030, -0.235);                   // cover latch
  const cover = new THREE.Group(); g.add(cover);
  const cb = new GunBuilder();
  cb.box(0.042, 0.008, 0.14, DS, 0, 0.026, -0.16);                   // cover underside
  cb.box(0.010, 0.006, 0.120, S, 0, 0.021, -0.16);                   // feed pawl rail
  cb.build(cover);
  // belt + links feeding into the tray (stay with the receiver)
  for (let i = 0; i < 5; i++) {
    b.box(0.012, 0.008, 0.012, S, -0.032, 0.030, -0.12 - i * 0.016); // cartridges
    b.box(0.014, 0.004, 0.010, D, -0.032, 0.030, -0.128 - i * 0.016); // links
  }
  b.box(0.016, 0.006, 0.090, MS, -0.032, 0.026, -0.155);             // belt ramp
  // 200-round assault box + hanger bracket (the "magazine")
  b.box(0.070, 0.075, 0.120, P, 0, -0.075, -0.16);                   // ammo box
  b.box(0.072, 0.010, 0.122, D, 0, -0.040, -0.16);                   // box lid seam
  b.box(0.074, 0.020, 0.020, D, 0, -0.075, -0.16);                   // box latch band
  b.box(0.020, 0.030, 0.060, DS, 0, -0.030, -0.16);                  // hanger bracket
  // quick-change fluted barrel + gas block + slotted hider
  brb.cyl(0.012, 0.012, 0.30, S, 0, 0.020, -0.46, Math.PI / 2, 0, 0, 20);
  for (let i = 0; i < 6; i++) {
    const fa2 = (i / 6) * Math.PI * 2;
    brb.box(0.003, 0.002, 0.22, D, Math.cos(fa2) * 0.0115, 0.020 + Math.sin(fa2) * 0.0115, -0.46);
  }
  b.cyl(0.016, 0.016, 0.030, DS, 0, 0.020, -0.345, Math.PI / 2);      // barrel nut
  b.box(0.016, 0.012, 0.024, S, 0, 0.020, -0.322);                    // carry-handle lug
  b.cyl(0.014, 0.014, 0.035, DS, 0, 0.020, -0.52, Math.PI / 2);       // gas block
  b.cyl(0.005, 0.005, 0.022, S, 0, 0.040, -0.52);                     // gas regulator
  brb.cyl(0.014, 0.014, 0.055, DS, 0, 0.020, -0.635, Math.PI / 2, 0, 0, 20); // flash hider
  for (let i = 0; i < 4; i++) { const ha = (i / 4) * Math.PI * 2 + 0.78; brb.box(0.005, 0.005, 0.040, D, Math.cos(ha) * 0.0135, 0.020 + Math.sin(ha) * 0.0135, -0.635); }
  brb.cyl(0.0045, 0.0045, 0.057, D, 0, 0.020, -0.635, Math.PI / 2);   // bore shadow
  // skeleton carry handle over the barrel (signature SAW part)
  b.box(0.010, 0.008, 0.14, P, 0, 0.052, -0.46);                      // handle bar
  b.box(0.010, 0.030, 0.012, P, 0, 0.036, -0.40);                     // leg F
  b.box(0.010, 0.030, 0.012, P, 0, 0.036, -0.52);                     // leg R
  // folding bipod on the gas block with feet
  ubb.box(0.024, 0.020, 0.045, D, 0, -0.005, -0.52);
  ubb.cyl(0.009, 0.009, 0.028, DS, 0, -0.012, -0.52, 0, 0, Math.PI / 2); // pivot
  ubb.cyl(0.005, 0.005, 0.09, D, -0.020, -0.055, -0.52, 0.10, 0, 0.08);
  ubb.cyl(0.005, 0.005, 0.09, D, 0.020, -0.055, -0.52, 0.10, 0, -0.08);
  ubb.cyl(0.0035, 0.0035, 0.07, S, -0.024, -0.125, -0.527, 0.10, 0, 0.08); // lower L
  ubb.cyl(0.0035, 0.0035, 0.07, S, 0.024, -0.125, -0.527, 0.10, 0, -0.08); // lower R
  ubb.box(0.010, 0.008, 0.016, R, -0.027, -0.162, -0.530);            // foot L
  ubb.box(0.010, 0.008, 0.016, R, 0.027, -0.162, -0.530);            // foot R
  // trigger group + pistol grip + fixed skeleton stock
  b.box(0.006, 0.004, 0.055, D, 0, -0.048, -0.045);                  // trigger guard
  b.box(0.005, 0.020, 0.006, S, 0, -0.038, -0.040);                  // trigger
  b.box(0.030, 0.085, 0.036, G, 0, -0.080, 0.005, -0.28);
  for (let i = 0; i < 3; i++) b.box(0.031, 0.004, 0.028, D, 0, -0.058 - i * 0.016, 0.011 - i * 0.005, -0.28);
  skb.box(0.036, 0.060, 0.12, P, 0, 0.005, 0.155);                   // stock body
  skb.box(0.028, 0.036, 0.08, D, 0, 0.005, 0.155);                   // lightening cut
  skb.box(0.034, 0.058, 0.020, R, 0, 0.005, 0.220);                  // buttpad
  skb.box(0.030, 0.012, 0.10, G, 0, 0.040, 0.155);                   // cheek rest
  skb.cyl(0.007, 0.007, 0.040, S, 0, 0.005, 0.098, 0, 0, Math.PI / 2); // stock pin
  skb.build(skG); skG.userData.homeZ = 0; g.add(skG);
  ubb.build(ubG); g.add(ubG);
  brb.build(brG); g.add(brG);
  b.build(g);
  // aperture BUIS (post + ring), hidden in ADS
  const adsHidden: THREE.Object3D[] = [];
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.020, 0.008), WM.dark);
  post.position.set(0, SIGHT_Y - 0.010, -0.60); g.add(post);
  const ringShape = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0025, 8, 20), WM.dark);
  ringShape.position.set(0, SIGHT_Y, 0.02); g.add(ringShape);
  adsHidden.push(post, ringShape);

  // Feed cover flips open + belt box drops on reload
  const mag = new THREE.Group(); mag.userData.homeY = 0; mag.userData.homeZ = 0; g.add(mag);
  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0, -0.03, -0.40], mag: [0, -0.11, -0.16], fa: [0, 0.04, -0.20] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.020, -0.67); g.add(muzzle);
  const sockets = {
    muzzle: makeSocket(0, 0.020, -0.66),
    optic: makeSocket(0, 0.060, -0.10),
    magazine: makeSocket(0, -0.04, -0.16),
    underbarrel: makeSocket(0, -0.02, -0.52),
    stock: makeSocket(0, 0.005, 0.10),
    rail: makeSocket(-0.028, 0.005, -0.30),
    barrel: makeSocket(0, 0.020, -0.32),
  };
  for (const s of Object.values(sockets)) g.add(s);
  const removable = { optic: [...adsHidden], magazine: [mag], underbarrel: [ubG], stock: [skG], barrel: [brG] };
  return { group: g, mag, chargingHandle: cover, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden, sockets, removable, attached: {} };
}

export const WEAPON_BUILDERS: Record<WeaponId, () => WeaponModel> = {
  m4a1: buildM4,
  ak47: buildAK47,
  m1911: buildM1911,
  awm: buildAWM,
  mp7: buildMP7,
  scar_h: buildSCARH,
  vector: buildVector,
  spas12: buildSPAS12,
  deagle: buildDeagle,
  m249: buildM249,
};

/* ================= ENEMY SOLDIER ================= */
export interface SoldierModel {
  group: THREE.Group;
  parts: { torso: THREE.Object3D; head: THREE.Object3D; lLeg: THREE.Object3D; rLeg: THREE.Object3D; lShin: THREE.Object3D; rShin: THREE.Object3D; muzzle: THREE.Object3D; lArm: THREE.Object3D; rArm: THREE.Object3D; rifle: THREE.Object3D };
  hitMeshes: THREE.Mesh[];
}

export function buildSoldier(): SoldierModel {
  const m = getSoldierMat();
  const g = new THREE.Group();
  const hitMeshes: THREE.Mesh[] = [];
  // Enemies don't cast shadows (21 hostiles × 6 meshes was a shadow-pass disaster).
  // They still receive, so they sit grounded in the scene.
  const tag = (mesh: THREE.Mesh, part: string) => { mesh.userData.part = part; mesh.castShadow = false; hitMeshes.push(mesh); return mesh; };

  // ---- torso (pivot at hips y=0.95) ----
  const torso = new THREE.Group(); torso.position.y = 0.95;
  const t = new Part();
  t.box(0.40, 0.56, 0.24, SR.camo, 0, 0.30, 0);                 // shirt body
  t.box(0.44, 0.42, 0.29, SR.vest, 0, 0.30, 0);                 // plate carrier
  t.box(0.46, 0.08, 0.31, SR.vest, 0, 0.52, 0);                 // shoulder straps top
  for (const px of [-0.13, 0, 0.13]) t.box(0.10, 0.15, 0.07, SR.webbing, px, 0.22, -0.17);  // mag pouches
  t.box(0.12, 0.10, 0.06, SR.webbing, 0.16, 0.42, -0.16);       // radio pouch
  t.box(0.32, 0.30, 0.14, SR.olive, 0, 0.32, 0.20);             // backpack
  t.box(0.46, 0.06, 0.28, SR.black, 0, 0.06, 0);                // belt
  t.box(0.16, 0.14, 0.08, SR.olive, -0.2, 0.02, 0.06);          // hip pouch
  t.box(0.14, 0.12, 0.08, SR.black, 0.22, 0.0, 0.0);            // holster
  t.box(0.16, 0.1, 0.16, SR.camo, 0, 0.62, 0);                  // neck / collar
  const torsoMesh = tag(t.mesh(m), 'torso'); torso.add(torsoMesh);
  g.add(torso);
  // pelvis
  const pv = new Part(); pv.box(0.40, 0.22, 0.25, SR.camo, 0, 0.86, 0);
  g.add(tag(pv.mesh(m), 'torso'));

  // ---- head ----
  const head = new THREE.Group(); head.position.y = 0.70;
  const h = new Part();
  h.sph(0.115, SR.skin, 0, 0.13, 0, 1, 1.12, 1);                 // head
  h.box(0.06, 0.05, 0.04, SR.skin, 0, 0.1, -0.11);               // nose/chin mass
  h.sph(0.15, SR.helmet, 0, 0.19, 0, 1.0, 0.85, 1.1, Math.PI * 0.6); // helmet shell
  h.box(0.28, 0.03, 0.06, SR.helmet, 0, 0.16, -0.14);            // brim
  h.box(0.05, 0.05, 0.05, SR.black, 0, 0.26, -0.14);             // NVG mount
  h.box(0.22, 0.07, 0.06, SR.visor, 0, 0.15, -0.1);              // goggles
  h.box(0.24, 0.03, 0.03, SR.black, 0, 0.17, 0.05);              // goggle strap
  h.box(0.05, 0.14, 0.02, SR.black, 0.11, 0.06, -0.02);          // chin strap
  h.box(0.06, 0.06, 0.04, SR.black, -0.13, 0.13, -0.02);         // comms earpiece
  h.box(0.02, 0.12, 0.02, SR.black, -0.13, 0.06, -0.08);         // boom mic
  head.add(tag(h.mesh(m), 'head'));
  torso.add(head);

  // ---- arms (pivot at shoulder) ----
  const mkArm = (side: number) => {
    const a = new THREE.Group(); a.position.set(side * 0.25, 0.48, -0.02);
    const p = new Part();
    p.box(0.13, 0.34, 0.13, SR.camo, 0, -0.15, 0);                 // upper sleeve
    p.box(0.15, 0.10, 0.15, SR.vest, 0, -0.03, 0);                 // shoulder pad
    p.box(0.11, 0.08, 0.11, SR.black, 0, -0.34, 0);                // elbow pad
    p.box(0.10, 0.28, 0.10, SR.camo, 0, -0.46, 0);                 // forearm sleeve
    p.box(0.09, 0.09, 0.10, SR.black, 0, -0.62, 0);                // glove
    a.add(tag(p.mesh(m), 'limb'));
    torso.add(a); return a;
  };
  const lArm = mkArm(-1), rArm = mkArm(1);

  // Separate thigh and shin pivots preserve a planted sole at rest.
  const mkLeg = (side: number) => {
    const leg = new THREE.Group(); leg.position.set(side*0.115,0.92,0);
    const thigh = new Part();
    thigh.box(0.17,0.41,0.18,SR.camo,0,-0.205,0);
    thigh.box(0.12,0.14,0.06,SR.olive,side*0.035,-0.21,-0.10);
    leg.add(tag(thigh.mesh(m),'limb'));
    const shin = new THREE.Group(); shin.position.y=-0.43;
    const lower = new Part();
    lower.box(0.15,0.12,0.09,SR.black,0,0,-0.085);
    lower.box(0.14,0.35,0.15,SR.camo,0,-0.20,0);
    lower.box(0.15,0.12,0.26,SR.boot,0,-0.41,-0.045);
    lower.box(0.16,0.04,0.28,SR.black,0,-0.47,-0.045);
    shin.add(tag(lower.mesh(m),'limb')); leg.add(shin); g.add(leg);
    return {leg,shin};
  };
  const left=mkLeg(-1), right=mkLeg(1);
  const lLeg=left.leg, rLeg=right.leg, lShin=left.shin, rShin=right.shin;

  // ---- rifle (child of torso) ----
  const rifle = new THREE.Group();
  const rb = new GunBuilder();
  rb.box(0.065,0.085,0.30,WM.darkSteel,0,0,0);
  rb.box(0.055,0.09,0.18,WM.wood,0,-0.015,0.24);
  rb.box(0.06,0.10,0.014,WM.rubber,0,-0.02,0.34);
  rb.box(0.06,0.07,0.18,WM.wood,0,0,-0.23);
  rb.cyl(0.013,0.013,0.24,WM.steel,0,0.02,-0.43,Math.PI/2);
  rb.cyl(0.009,0.009,0.20,WM.darkSteel,0,0.05,-0.30,Math.PI/2);
  rb.box(0.03,0.075,0.023,WM.darkSteel,0,0.05,-0.50);
  rb.box(0.038,0.13,0.06,WM.wood,0,-0.085,0.065,-0.25);
  for (let i=0;i<8;i++) rb.box(0.038,0.027,0.08,WM.darkSteel,0,-0.04-i*0.022,-0.065+i*i*0.001,0.15+i*0.075);
  rb.box(0.045,0.028,0.055,WM.dark,0,0.065,-0.03);
  rb.build(rifle);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.02,-0.56); rifle.add(muzzle);
  rifle.position.set(0.09, 0.32, -0.42);
  torso.add(rifle);

  // ---- generous invisible hit proxies ----
  const ghost = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const torsoHit = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.15, 0.6), ghost); torsoHit.position.y = 0.28; torsoHit.userData.part = 'torso'; torso.add(torsoHit); hitMeshes.push(torsoHit);
  // Head hit proxy is deliberately generous (≈50% wider than the visual skull):
  // headshots — especially with the AWM — should reward aim in the right area,
  // not pixel-perfect luck. The capsule also covers the neck seam so shots that
  // land between helmet and collar still count as head, never fall into torso.
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8), ghost); headHit.position.y = 0.13; headHit.userData.part = 'head'; head.add(headHit); hitMeshes.push(headHit);
  const neckHit = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.24, 8), ghost); neckHit.position.y = -0.06; neckHit.userData.part = 'head'; head.add(neckHit); hitMeshes.push(neckHit);
  const legHit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.45), ghost); legHit.position.y = 0.45; legHit.userData.part = 'limb'; g.add(legHit); hitMeshes.push(legHit);

  return { group: g, parts: { torso, head, lLeg, rLeg, lShin, rShin, muzzle, lArm, rArm, rifle }, hitMeshes };
}
