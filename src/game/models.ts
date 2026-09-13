// Recoil FPS — Weapon + character models v3
// Every model uses ONE atlas material and merged geometry → 1-8 draw calls per model.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
}

const WM = {
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
  tritium: new THREE.MeshBasicMaterial({ color: 0x7CFF5A }),
};

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
class GunBuilder {
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
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { this.put(new RoundedBoxGeometry(w, h, d, 1, Math.min(w,h,d)*0.13), mat, x, y, z, rx, ry, rz); return this; }
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
  const r = new THREE.Group(); gun.add(r);
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
  const lArm = new THREE.Group(); gun.add(lArm);
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
  const SIGHT_Y = 0.07;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, T = WM.tan, D = WM.dark, G = WM.grip, R = WM.rubber, B = WM.brass;
  const b = new GunBuilder();
  // ---- receivers ----
  b.box(0.038, 0.036, 0.17, P, 0, -0.012, -0.10);
  b.box(0.040, 0.034, 0.21, P, 0, 0.020, -0.12);
  b.box(0.041, 0.008, 0.05, P, 0, 0.032, -0.03);                    // rail riser base
  for (let i = 0; i < 9; i++) b.box(0.032, 0.007, 0.015, D, 0, 0.040, -0.045 - i * 0.024);
  b.box(0.008, 0.008, 0.008, DS, -0.021, 0.004, -0.045, 0, 0, 0);   // takedown pin F
  b.box(0.008, 0.008, 0.008, DS, -0.021, 0.004, -0.155, 0, 0, 0);   // takedown pin R
  b.box(0.004, 0.020, 0.052, DS, 0.0215, 0.018, -0.14);             // ejection port recess
  b.box(0.006, 0.014, 0.030, B, 0.020, 0.018, -0.145);              // brass in port
  b.box(0.005, 0.016, 0.020, S, 0.022, 0.020, -0.125);              // bolt face
  b.box(0.006, 0.013, 0.024, P, 0.023, 0.011, -0.105);              // shell deflector
  b.cyl(0.006, 0.006, 0.012, S, 0.024, 0.020, -0.088, 0, 0, Math.PI / 2); // forward assist
  b.box(0.006, 0.010, 0.022, S, -0.021, -0.006, -0.075);            // selector L
  b.box(0.006, 0.010, 0.022, S, 0.021, -0.006, -0.075);             // selector R
  b.box(0.008, 0.006, 0.014, S, 0.021, 0.002, -0.055);              // mag release
  b.box(0.006, 0.020, 0.012, S, -0.021, 0.004, -0.120);             // bolt catch
  b.box(0.020, 0.026, 0.032, P, 0, -0.030, -0.160);                 // magwell flare
  b.box(0.006, 0.004, 0.050, P, 0, -0.040, -0.095);                 // trigger guard
  b.box(0.005, 0.018, 0.005, DS, 0, -0.030, -0.093);                // trigger
  b.box(0.028, 0.088, 0.036, G, 0, -0.056, -0.045, -0.32);          // MOE grip
  b.box(0.012, 0.030, 0.020, G, 0, -0.045, -0.022, -0.32);          // beavertail
  b.box(0.030, 0.010, 0.034, G, 0, -0.100, -0.058, -0.32);          // grip base
  // ---- stock ----
  b.cyl(0.015, 0.015, 0.10, S, 0, 0.012, 0.065, Math.PI / 2);
  b.box(0.007, 0.007, 0.020, D, 0, 0.012, 0.030);                   // castle nut
  b.box(0.036, 0.050, 0.082, P, 0, -0.004, 0.140);                  // CTR body
  b.box(0.030, 0.018, 0.060, P, 0, 0.028, 0.130);                   // cheek riser
  b.box(0.040, 0.070, 0.016, R, 0, -0.010, 0.185);                  // buttpad
  b.box(0.038, 0.012, 0.075, P, 0, -0.034, 0.135);                  // stock toe
  b.box(0.010, 0.006, 0.030, D, -0.020, -0.004, 0.140);             // adjustment lever
  b.cyl(0.006, 0.006, 0.004, D, -0.019, 0.006, 0.150, 0, 0, Math.PI / 2); // QD socket
  // ---- railed handguard ----
  b.cyl(0.023, 0.023, 0.20, P, 0, 0.020, -0.315, Math.PI / 2, 0, 0, 8);
  for (let i = 0; i < 6; i++) b.box(0.030, 0.007, 0.014, D, 0, 0.0445, -0.245 - i * 0.028);
  for (let i = 0; i < 5; i++) { b.box(0.005, 0.028, 0.014, D, 0.0245, 0.020, -0.245 - i * 0.032); b.box(0.005, 0.028, 0.014, D, -0.0245, 0.020, -0.245 - i * 0.032); }
  for (let i = 0; i < 5; i++) b.box(0.028, 0.006, 0.014, D, 0, -0.0035, -0.245 - i * 0.032);
  b.cyl(0.007, 0.007, 0.004, D, 0.0245, 0.020, -0.30, 0, 0, Math.PI / 2); // QD socket rail
  // ---- barrel assembly ----
  b.cyl(0.0085, 0.0085, 0.17, S, 0, 0.020, -0.490, Math.PI / 2);
  b.box(0.018, 0.022, 0.024, DS, 0, 0.026, -0.430);                 // gas block
  b.cyl(0.004, 0.004, 0.13, S, 0, 0.034, -0.365, Math.PI / 2);      // gas tube
  b.box(0.005, 0.030, 0.005, D, 0, 0.052, -0.430);                  // flip front post (up)
  b.box(0.004, 0.022, 0.014, D, -0.011, 0.048, -0.430);             // post wing L
  b.box(0.004, 0.022, 0.014, D, 0.011, 0.048, -0.430);              // post wing R
  b.cyl(0.011, 0.010, 0.048, S, 0, 0.020, -0.592, Math.PI / 2);     // A2 birdcage
  for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2; b.box(0.004, 0.004, 0.030, D, Math.cos(a2) * 0.010, 0.020 + Math.sin(a2) * 0.010, -0.592); }
  b.cyl(0.012, 0.012, 0.006, DS, 0, 0.020, -0.568, Math.PI / 2);    // crush washer
  // ---- vertical foregrip ----
  b.box(0.022, 0.058, 0.028, P, 0, -0.020, -0.340, 0.10);
  b.cyl(0.013, 0.013, 0.024, G, 0, -0.020, -0.340, Math.PI / 2, 0, 0); // finger groove ring
  b.box(0.024, 0.008, 0.030, G, 0, -0.050, -0.343, 0.10);           // base cap
  // ---- PEQ-15 ----
  b.box(0.024, 0.018, 0.055, T, 0.030, 0.030, -0.330);
  b.cyl(0.005, 0.005, 0.006, D, 0.030, 0.030, -0.300, Math.PI / 2); // emitter
  b.cyl(0.006, 0.006, 0.004, D, 0.030, 0.036, -0.345);              // dial
  // ---- folded rear BUIS (low profile, never blocks sight) ----
  b.box(0.030, 0.008, 0.030, D, 0, 0.044, -0.045);
  // ---- EXPS holo (open frame, see-through) ----
  b.box(0.038, 0.010, 0.050, D, 0, 0.048, -0.11);                   // QD mount
  b.box(0.012, 0.014, 0.030, D, -0.024, 0.048, -0.11);              // QD lever
  b.box(0.040, 0.014, 0.052, D, 0, 0.058, -0.11);                   // battery housing
  b.box(0.005, 0.028, 0.042, D, -0.019, 0.072, -0.11);              // left wall
  b.box(0.005, 0.028, 0.042, D, 0.019, 0.072, -0.11);               // right wall
  b.box(0.043, 0.005, 0.042, D, 0, 0.088, -0.11);                   // top hood
  b.box(0.043, 0.008, 0.006, D, 0, 0.082, -0.132);                  // front brow
  b.build(g);
  // glass panes + glowing reticle (center dot + 65MOA ring) — hidden in ADS, HUD draws the single clean sight
  const adsHidden: THREE.Object3D[] = [];
  const glassF = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.024), WM.glass);
  glassF.position.set(0, SIGHT_Y, -0.131); g.add(glassF);
  const glassR = glassF.clone(); glassR.position.z = -0.090; g.add(glassR);
  adsHidden.push(glassF, glassR);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0015, 12), WM.reticle);
  dot.position.set(0, SIGHT_Y, -0.0895); g.add(dot);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0060, 0.0070, 24), WM.reticle.clone());
  (ring.material as THREE.MeshBasicMaterial).transparent = true;
  (ring.material as THREE.MeshBasicMaterial).opacity = 0.9;
  ring.position.set(0, SIGHT_Y, -0.0895); g.add(ring);
  adsHidden.push(dot, ring);
  // ---- PMAG (animated) ----
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.027, 0.070, 0.056, S, 0, -0.045, 0, 0.12);
  mb.box(0.026, 0.060, 0.052, S, 0, -0.100, 0.012, 0.28);
  for (let i = 0; i < 4; i++) mb.box(0.029, 0.004, 0.050, D, 0, -0.035 - i * 0.020, 0.004 + i * 0.004, 0.16);
  mb.box(0.030, 0.010, 0.058, D, 0, -0.132, 0.020, 0.28);
  mb.build(mag);
  mag.position.set(0, -0.03, -0.155); g.add(mag);
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
  return { group: g, mag, chargingHandle: ch, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden };
}

export function buildAK47(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.064;
  const S = WM.steel, W = WM.wood, WD = WM.woodDark, D = WM.dark;
  const b = new GunBuilder();
  // ---- receiver ----
  b.box(0.038, 0.042, 0.23, S, 0, 0.012, -0.12);
  b.box(0.040, 0.012, 0.23, S, 0, 0.037, -0.12);                    // ribbed dust cover
  for (let i = 0; i < 5; i++) b.box(0.041, 0.003, 0.004, D, 0, 0.043, -0.12 + (i - 2) * 0.028);
  b.box(0.004, 0.020, 0.060, D, 0.021, 0.016, -0.13);               // ejection port
  b.box(0.008, 0.028, 0.006, S, 0.024, 0.014, -0.07);               // charging knob
  b.box(0.006, 0.030, 0.020, S, 0.021, -0.002, -0.06);              // selector
  b.box(0.020, 0.012, 0.030, S, 0, -0.012, -0.235);                 // rear trunnion
  // ---- wood furniture ----
  b.box(0.042, 0.036, 0.16, W, 0, 0.014, -0.31);                    // upper HG
  b.box(0.044, 0.024, 0.16, W, 0, -0.012, -0.31);                   // lower HG w/ swell
  b.box(0.046, 0.014, 0.10, WD, 0, -0.020, -0.31);                  // palm swell
  b.box(0.028, 0.085, 0.036, W, 0, -0.052, -0.04, -0.3);            // grip
  b.box(0.036, 0.055, 0.15, W, 0, -0.004, 0.09);                    // stock
  b.box(0.040, 0.070, 0.014, D, 0, -0.008, 0.170);                  // buttplate
  b.box(0.006, 0.020, 0.060, WD, 0, -0.004, 0.09);                  // stock lightening cut look
  // ---- barrel assembly ----
  b.cyl(0.009, 0.009, 0.23, S, 0, 0.012, -0.50, Math.PI / 2);
  b.cyl(0.006, 0.006, 0.20, S, 0, 0.032, -0.42, Math.PI / 2);       // gas tube
  b.box(0.020, 0.030, 0.030, S, 0, 0.030, -0.41);                   // gas block
  b.box(0.018, 0.006, 0.20, WD, 0, 0.030, -0.42);                   // wooden gas-tube heat guard
  b.cyl(0.0035, 0.0035, 0.19, D, 0, -0.012, -0.47, Math.PI / 2);    // cleaning rod
  // classic AK front sight tower with two protective ears
  b.box(0.020, 0.034, 0.022, S, 0, 0.022, -0.585);
  b.box(0.006, 0.030, 0.006, D, 0, 0.052, -0.585);
  b.box(0.004, 0.028, 0.014, D, -0.011, 0.048, -0.585);
  b.box(0.004, 0.028, 0.014, D, 0.011, 0.048, -0.585);
  b.cyl(0.011, 0.012, 0.032, S, 0, 0.012, -0.645, Math.PI / 2);     // slant brake
  b.box(0.006, 0.004, 0.030, S, 0, -0.038, -0.09);                  // trigger guard
  b.box(0.005, 0.018, 0.005, S, 0, -0.028, -0.09);                  // trigger
  // ---- rear tangent sight ----
  b.box(0.024, 0.010, 0.040, S, 0, 0.046, -0.20);
  b.box(0.024, 0.014, 0.008, D, 0, 0.052, -0.205);                  // slider
  for (const side of [-1,1]) {
    for (const z of [-0.045,-0.08,-0.19,-0.215]) b.cyl(0.0025,0.0025,0.002,S,side*0.0205,0.005,z,0,0,Math.PI/2);
    for (let i=0;i<5;i++) b.box(0.002,0.006,0.010,WD,side*0.0225,0.015,-0.25-i*0.023);
  }
  // ---- Kobra (open frame) ----
  b.box(0.034, 0.010, 0.046, D, 0, 0.044, -0.12);
  b.box(0.005, 0.026, 0.038, D, -0.016, 0.062, -0.12);
  b.box(0.005, 0.026, 0.038, D, 0.016, 0.062, -0.12);
  b.box(0.037, 0.005, 0.038, D, 0, 0.077, -0.12);
  b.build(g);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 12), WM.reticle);
  dot.position.set(0, SIGHT_Y, -0.125); g.add(dot);
  // ---- curved mag ----
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  for (let i=0;i<12;i++) {
    const t=i/11, angle=0.12+t*0.65;
    mb.box(0.028,0.019,0.061,S,0,-0.012-t*0.157,t*t*0.065,angle);
    for (const side of [-1,1]) mb.box(0.0018,0.019,0.003,D,side*0.0145,-0.012-t*0.157,t*t*0.065-0.018,angle);
  }
  mb.box(0.031,0.008,0.066,D,0,-0.177,0.068,0.77);
  mb.build(mag);
  mag.position.set(0, -0.03, -0.17); g.add(mag);
  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [-0.01, -0.028, -0.310], mag: [0, -0.155, -0.170], fa: [0.024, 0.014, -0.070] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.645); g.add(muzzle);
  return { group: g, mag, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden: [dot] };
}

export function buildM1911(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.045;
  const S = WM.steel, W = WM.wood, D = WM.dark;
  const b = new GunBuilder();
  b.box(0.027, 0.030, 0.200, S, 0, 0.026, -0.05);                   // slide
  for (let i = 0; i < 6; i++) b.box(0.0285, 0.020, 0.0025, D, 0, 0.026, 0.018 + i * 0.006); // rear serrations
  for (let i = 0; i < 4; i++) b.box(0.0285, 0.020, 0.0025, D, 0, 0.026, -0.120 + i * 0.006); // front serrations
  b.box(0.025, 0.026, 0.150, S, 0, 0.002, -0.04);                   // frame
  b.cyl(0.007, 0.007, 0.032, S, 0, 0.026, -0.155, Math.PI / 2);     // barrel + bushing
  b.box(0.026, 0.080, 0.034, W, 0, -0.036, 0.020, -0.25);           // wood grips
  b.sph(0.003, D, -0.008, -0.036, 0.004); b.sph(0.003, D, 0.008, -0.036, 0.004); // grip screws
  b.sph(0.003, D, -0.008, -0.036, 0.036); b.sph(0.003, D, 0.008, -0.036, 0.036);
  b.box(0.006, 0.004, 0.030, S, 0, -0.022, -0.05);                  // trigger guard area
  b.box(0.005, 0.016, 0.005, S, 0, -0.014, -0.045);                 // trigger
  b.box(0.010, 0.016, 0.012, S, 0, 0.032, 0.052);                   // hammer
  b.box(0.008, 0.010, 0.020, S, 0, 0.030, 0.028);                   // beavertail safety
  b.box(0.006, 0.008, 0.030, S, -0.014, 0.012, -0.020);             // slide stop
  b.box(0.004, 0.009, 0.006, D, 0, SIGHT_Y, -0.138);                // front blade
  b.box(0.005, 0.008, 0.006, D, -0.006, SIGHT_Y, 0.038);            // rear notch L
  b.box(0.005, 0.008, 0.006, D, 0.006, SIGHT_Y, 0.038);             // rear notch R
  b.build(g);
  // tritium dots (hidden in ADS — HUD crosshair takes over)
  const adsHidden: THREE.Object3D[] = [];
  for (const [x, z] of [[0, -0.1415], [-0.006, 0.0345], [0.006, 0.0345]] as const) {
    const t = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 8), WM.tritium);
    t.position.set(x, SIGHT_Y + 0.002, z); g.add(t);
    adsHidden.push(t);
  }
  const mag = new THREE.Group(); g.add(mag);
  const optic = new THREE.Group(); g.add(optic);
  // 1911: support hand wraps under the dominant hand
  const { lArm, keys } = attachArms(g, { fore: [0.005, -0.105, -0.030], mag: [0, -0.090, 0.020], fa: [0.0, -0.014, -0.045] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.026, -0.175); g.add(muzzle);
  return { group: g, mag, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden };
}

// ================= NEW GUN 1: AWM / L115A3 TACTICAL SNIPER RIFLE =================
export function buildAWM(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.076;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip, R = WM.rubber;
  const b = new GunBuilder();

  // Arctic Warfare thumbhole chassis stock (OD Green / Dark Tan)
  const chassisMat = WM.tan;
  b.box(0.042, 0.065, 0.28, chassisMat, 0, -0.01, -0.14);          // center receiver bedding
  b.box(0.038, 0.050, 0.26, chassisMat, 0, 0.005, 0.12);           // stock spine
  b.box(0.044, 0.080, 0.04, R, 0, 0.0, 0.25);                      // adjustable recoil pad
  b.box(0.032, 0.024, 0.12, chassisMat, 0, 0.042, 0.08);           // adjustable cheekpiece
  b.box(0.036, 0.075, 0.04, G, 0, -0.065, -0.02, -0.25);           // thumbhole pistol grip
  b.box(0.008, 0.006, 0.08, P, 0, -0.055, -0.09);                  // trigger guard
  b.box(0.005, 0.022, 0.006, S, 0, -0.045, -0.09);                 // match trigger

  // Long free-floating fluted barrel
  b.cyl(0.011, 0.011, 0.38, S, 0, 0.022, -0.47, Math.PI / 2);
  // Heavy 2-chamber tactical muzzle brake
  b.box(0.022, 0.022, 0.06, DS, 0, 0.022, -0.68);
  b.box(0.028, 0.012, 0.012, D, 0, 0.022, -0.67);
  b.box(0.028, 0.012, 0.012, D, 0, 0.022, -0.69);

  // Steel bolt-action receiver + bolt handle
  b.cyl(0.018, 0.018, 0.18, DS, 0, 0.022, -0.12, Math.PI / 2);
  const bolt = new THREE.Group(); g.add(bolt);
  const bb = new GunBuilder();
  bb.cyl(0.005, 0.005, 0.04, S, 0.026, 0.032, -0.05, 0, 0, 0.9);   // bolt lever
  bb.sph(0.009, D, 0.045, 0.048, -0.05); bb.build(bolt);                            // bolt pear handle

  // Folded tactical bipod on forend
  b.box(0.022, 0.018, 0.04, D, 0, -0.018, -0.42);
  b.cyl(0.005, 0.005, 0.12, D, -0.018, -0.07, -0.42, 0.15, 0, 0.1);
  b.cyl(0.005, 0.005, 0.12, D,  0.018, -0.07, -0.42, 0.15, 0, -0.1);

  for (const z of [-0.045,-0.19]) {
    b.box(0.032,0.017,0.024,DS,0,0.046,z);
    b.cyl(0.021,0.021,0.016,DS,0,SIGHT_Y,z,Math.PI/2);
  }
  for (let i=0;i<7;i++) {
    b.box(0.002,0.017,0.014,D,-0.022,-0.01,-0.19-i*0.022);
    b.box(0.002,0.017,0.014,D,0.022,-0.01,-0.19-i*0.022);
  }
  b.box(0.036,0.018,0.18,chassisMat,0,-0.07,0.09); // lower thumbhole stock rail
  b.box(0.036,0.07,0.023,chassisMat,0,-0.038,0.18);
  b.build(g);

  // Scope is its own group so it disappears in ADS — the HUD renders the clean high-zoom scope
  const optic = new THREE.Group(); g.add(optic);
  const sb = new GunBuilder();
  sb.box(0.024, 0.014, 0.08, D, 0, 0.045, -0.12);                         // Picatinny base
  sb.cyl(0.007, 0.007, 0.03, DS, -0.014, 0.045, -0.11, 0, 0, Math.PI / 2); // clamping screws
  sb.cyl(0.007, 0.007, 0.03, DS,  0.014, 0.045, -0.11, 0, 0, Math.PI / 2);
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

  // Detachable box magazine (5 rounds .338 Lapua)
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.box(0.028, 0.065, 0.07, S, 0, -0.045, -0.14);
  mb.box(0.030, 0.008, 0.072, D, 0, -0.08, -0.14);
  mb.build(mag);
  g.add(mag);

  const { lArm, keys } = attachArms(g, { fore: [0, -0.035, -0.36], mag: [0, -0.08, -0.14], fa: [0.045, 0.048, -0.05] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.022, -0.72); g.add(muzzle);
  return { group: g, mag, chargingHandle: bolt, muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden };
}

// ================= NEW GUN 2: MP7A1 SUBMACHINE GUN (PDW) =================
export function buildMP7(): WeaponModel {
  const g = new THREE.Group();
  const SIGHT_Y = 0.062;
  const P = WM.poly, S = WM.steel, DS = WM.darkSteel, D = WM.dark, G = WM.grip;
  const b = new GunBuilder();

  // Compact reinforced polymer receiver
  b.box(0.041, 0.059, 0.22, P, 0, 0.01, -0.10);
  b.box(0.036, 0.012, 0.24, D, 0, 0.04, -0.11);                     // top Picatinny rail
  for (let i = 0; i < 9; i++) b.box(0.030, 0.006, 0.013, D, 0, 0.048, -0.04 - i * 0.02);

  // Ventilated heat shield, ambidextrous controls and receiver pins.
  for(const side of [-1,1]) {
    for(let i=0;i<5;i++) b.box(0.002,0.008,0.012,DS,side*0.022,0.019,-0.15-i*0.017);
    b.cyl(0.003,0.003,0.002,S,side*0.022,-0.003,-0.025,0,0,Math.PI/2);
    b.box(0.004,0.007,0.026,DS,side*0.024,0.005,-0.062);
  }
  b.box(0.002,0.016,0.058,DS,0.022,0.023,-0.064); // ejection port
  b.box(0.004,0.008,0.051,S,0.024,0.014,-0.064);
  // Folding foregrip (extended forward)
  b.box(0.022, 0.065, 0.025, G, 0, -0.04, -0.21, 0.12);
  b.box(0.024, 0.012, 0.028, P, 0, -0.005, -0.21);                  // hinge block

  // Pistol grip with 40-round magazine inserted inside the grip
  b.box(0.028, 0.095, 0.038, G, 0, -0.055, -0.05, -0.32);
  b.box(0.006, 0.004, 0.045, P, 0, -0.045, -0.10);                  // trigger guard
  b.box(0.005, 0.018, 0.005, S, 0, -0.035, -0.098);                 // trigger with safety blade

  // Ambi charging handle at rear top (T-handle like MP7)
  b.box(0.045, 0.010, 0.025, D, 0, 0.036, 0.02);

  // Extendable wire stock rails + buttpad
  b.cyl(0.004, 0.004, 0.16, S, -0.018, 0.01, 0.07, Math.PI / 2);    // left rail
  b.cyl(0.004, 0.004, 0.16, S,  0.018, 0.01, 0.07, Math.PI / 2);    // right rail
  b.box(0.036, 0.065, 0.016, P, 0, 0.005, 0.155);                   // buttpad

  // Compact barrel + 3-prong flash hider
  b.cyl(0.007, 0.007, 0.06, S, 0, 0.012, -0.24, Math.PI / 2);
  b.cyl(0.010, 0.010, 0.035, DS, 0, 0.012, -0.28, Math.PI / 2);

  // Micro Red Dot Sight (Aimpoint T1 style on high riser)
  b.box(0.028, 0.016, 0.040, D, 0, 0.052, -0.12);                   // riser mount
  b.cyl(0.016, 0.016, 0.052, D, 0, SIGHT_Y+0.004, -0.12, Math.PI / 2,0,0,20,true);    // micro tube body
  b.cyl(0.006, 0.006, 0.008, D, 0.014, SIGHT_Y, -0.12, 0, 0, Math.PI / 2); // battery cap
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
  g.add(mag);

  const optic = new THREE.Group(); g.add(optic);
  const { lArm, keys } = attachArms(g, { fore: [0, -0.05, -0.21], mag: [0, -0.15, -0.09], fa: [0, 0.036, 0.02] });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.31); g.add(muzzle);
  return { group: g, mag, chargingHandle: new THREE.Object3D(), muzzle, sightY: SIGHT_Y, optic, lArm, lArmKeys: keys, adsHidden };
}

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
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), ghost); headHit.position.y = 0.14; headHit.userData.part = 'head'; head.add(headHit); hitMeshes.push(headHit);
  const legHit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.45), ghost); legHit.position.y = 0.45; legHit.userData.part = 'limb'; g.add(legHit); hitMeshes.push(legHit);

  return { group: g, parts: { torso, head, lLeg, rLeg, lShin, rShin, muzzle, lArm, rArm, rifle }, hitMeshes };
}
