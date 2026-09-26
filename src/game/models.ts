// Character models and the public weapon-model API.
// Weapon assemblies live in weapons/ so each silhouette can be maintained separately.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GunBuilder, WM } from './weapons/core';
export { GunBuilder, WM, applySkin, makeSocket } from './weapons/core';
export type { WeaponModel, LArmKey } from './weapons/core';
export { WEAPON_BUILDERS, buildM4, buildAK47, buildM1911, buildAWM, buildMP7, buildSCARH, buildM7Spear, buildVector, buildSPAS12, buildDeagle, buildM249 } from './weapons/index';

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

/* ================= ENEMY SOLDIER ================= */
export interface SoldierModel {
  group: THREE.Group;
  parts: { torso: THREE.Object3D; head: THREE.Object3D; lLeg: THREE.Object3D; rLeg: THREE.Object3D; lShin: THREE.Object3D; rShin: THREE.Object3D; muzzle: THREE.Object3D; lArm: THREE.Object3D; rArm: THREE.Object3D; rifle: THREE.Object3D };
  /** Mission soldiers only: detailed finish-shader rifle parts vs the one-draw atlas gun. */
  weaponLod?: { hi: THREE.Object3D[]; lo: THREE.Object3D; near: boolean };
  hitMeshes: THREE.Mesh[];
}

/**
 * Shared material for invisible hit proxies. `visible = false` makes the renderer skip
 * the mesh entirely while raycasts (which ignore material visibility) still hit it.
 * These used to be opacity-0 *transparent* meshes: 4 alpha-blended boxes/spheres per
 * soldier drawn every frame for nothing — 40 of the Warehouse's ~200 draw calls plus
 * blended overdraw across every soldier's silhouette.
 */
export const HIT_PROXY_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
HIT_PROXY_MAT.visible = false;
HIT_PROXY_MAT.name = 'hit proxy (never drawn)';

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
  // Low-cost world LOD of the same AK silhouette: no detached blocks or segmented magazine.
  rifle.name = 'world AK rifle';
  rb.name('world receiver').profile([[-0.151, -0.040], [-0.151, 0.035], [0.151, 0.035], [0.151, -0.032]], 0.063, WM.darkSteel);
  rb.name('world dust cover').cyl(0.031, 0.031, 0.294, WM.darkSteel, 0, 0.022, 0, Math.PI / 2, 0, 0, 16);
  rb.name('world stock').profile([[0.143, 0.031], [0.200, 0.026], [0.340, 0.020], [0.349, -0.083], [0.316, -0.085], [0.192, -0.027], [0.143, -0.024]], 0.055, WM.wood, 0, 0.002);
  rb.name('world buttplate').box(0.058, 0.105, 0.012, WM.rubber, 0, -0.032, 0.348);
  rb.name('world handguard').profile([[-0.148, 0.022], [-0.326, 0.022], [-0.334, -0.013], [-0.313, -0.033], [-0.170, -0.033], [-0.148, -0.014]], 0.060, WM.wood, 0, 0.002);
  rb.name('world upper handguard').box(0.041, 0.027, 0.140, WM.wood, 0, 0.039, -0.237);
  rb.name('world barrel').tube(0.012, 0.0045, 0.257, WM.steel, 0, 0.020, -0.426, Math.PI / 2, 0, 0, 16);
  rb.name('world gas tube').cyl(0.007, 0.007, 0.215, WM.darkSteel, 0, 0.045, -0.318, Math.PI / 2, 0, 0, 12);
  rb.name('world gas block').profile([[-0.401, 0.009], [-0.434, 0.009], [-0.425, 0.049], [-0.403, 0.055]], 0.025, WM.darkSteel);
  rb.name('world front sight tower').profile([[-0.495, 0.010], [-0.520, 0.010], [-0.517, 0.079], [-0.500, 0.079]], 0.017, WM.darkSteel);
  rb.name('world front sight hood').tube(0.010, 0.007, 0.010, WM.darkSteel, 0, 0.084, -0.508, Math.PI / 2, 0, 0, 16);
  rb.name('world grip').profile([[0.035, -0.027], [0.074, -0.027], [0.105, -0.143], [0.061, -0.147]], 0.038, WM.wood, 0, 0.002);
  rb.name('world continuous magazine').profile([[-0.101, -0.029], [-0.031, -0.029], [-0.039, -0.112], [-0.062, -0.178], [-0.101, -0.243], [-0.167, -0.207], [-0.125, -0.146], [-0.106, -0.095]], 0.039, WM.darkSteel, 0, 0.001);
  rb.name('world trigger guard').profile([[0.034, -0.029], [-0.025, -0.029], [-0.028, -0.080], [0.028, -0.080]], 0.009, WM.darkSteel, 0, 0.0005, [[[0.023, -0.038], [-0.017, -0.038], [-0.019, -0.070], [0.022, -0.070]]]);
  rb.name('world rear sight').box(0.028, 0.018, 0.041, WM.darkSteel, 0, 0.055, -0.134);
  rb.build(rifle);
  // Distance LOD (frame budget): the GunBuilder rifle is ~5 finish-shader meshes and
  // several thousand triangles per soldier; past WEAPON_LOD_DISTANCE it is a handful
  // of pixels, so the one-draw atlas silhouette stands in.
  const hi = [...rifle.children];
  const lo = worldWeaponMesh('rifle').mesh; lo.visible = false; rifle.add(lo);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.02,-0.56); rifle.add(muzzle);
  rifle.position.set(0.09, 0.32, -0.42);
  torso.add(rifle);

  // ---- generous invisible hit proxies ----
  const ghost = HIT_PROXY_MAT;
  const torsoHit = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.15, 0.6), ghost); torsoHit.position.y = 0.28; torsoHit.userData.part = 'torso'; torso.add(torsoHit); hitMeshes.push(torsoHit);
  // Head hit proxy is deliberately generous (≈50% wider than the visual skull):
  // headshots — especially with the AWM — should reward aim in the right area,
  // not pixel-perfect luck. The capsule also covers the neck seam so shots that
  // land between helmet and collar still count as head, never fall into torso.
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8), ghost); headHit.position.y = 0.13; headHit.userData.part = 'head'; head.add(headHit); hitMeshes.push(headHit);
  const neckHit = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.24, 8), ghost); neckHit.position.y = -0.06; neckHit.userData.part = 'head'; head.add(neckHit); hitMeshes.push(neckHit);
  const legHit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.45), ghost); legHit.position.y = 0.45; legHit.userData.part = 'limb'; g.add(legHit); hitMeshes.push(legHit);

  return { group: g, parts: { torso, head, lLeg, rLeg, lShin, rShin, muzzle, lArm, rArm, rifle }, hitMeshes, weaponLod: { hi, lo, near: true } };
}

/* ================= TDM ARMORED SOLDIER =================
 * Bulkier combat frame for the Warehouse arena: thicker torso (0.52 vs 0.40),
 * an oversized plate carrier, 1.25x helmet and heavier limbs. `armor` drives
 * the visible kit — 0 fatigues only, 1 light plates, 2 heavy plates + shoulder
 * pauldrons — and `tint` separates the two teams at a glance.
 */
export function buildArmoredSoldier(armor: 0 | 1 | 2, tint?: number): SoldierModel {
  const m = getSoldierMat();
  const teamMat = tint !== undefined
    ? new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7, metalness: 0.25 })
    : null;
  const g = new THREE.Group();
  const hitMeshes: THREE.Mesh[] = [];
  const tag = (mesh: THREE.Mesh, part: string) => { mesh.userData.part = part; mesh.castShadow = false; hitMeshes.push(mesh); return mesh; };

  // ---- torso (pivot at hips y=0.95) — visibly wider than the mission soldier ----
  const torso = new THREE.Group(); torso.position.y = 0.95;
  const t = new Part();
  t.box(0.52, 0.58, 0.30, SR.camo, 0, 0.30, 0);                    // thick shirt body
  t.box(0.58, 0.48, 0.37, SR.vest, 0, 0.30, 0);                    // bulky plate carrier
  t.box(0.60, 0.10, 0.39, SR.vest, 0, 0.54, 0);                    // shoulder straps
  if (armor >= 1) {
    t.box(0.46, 0.34, 0.05, SR.black, 0, 0.32, -0.21);             // front plate
    t.box(0.46, 0.34, 0.05, SR.black, 0, 0.32, 0.21);              // back plate
  }
  if (armor >= 2) {
    t.box(0.62, 0.14, 0.41, SR.black, 0, 0.10, 0);                 // heavy waist band
    t.box(0.20, 0.16, 0.10, SR.black, -0.36, 0.44, 0);             // shoulder pauldron L
    t.box(0.20, 0.16, 0.10, SR.black, 0.36, 0.44, 0);              // shoulder pauldron R
    t.box(0.30, 0.12, 0.06, SR.helmet, 0, 0.50, -0.21);            // throat guard
  }
  for (const px of [-0.16, 0, 0.16]) t.box(0.11, 0.16, 0.08, SR.webbing, px, 0.20, -0.22);
  t.box(0.13, 0.11, 0.07, SR.webbing, 0.20, 0.44, -0.20);          // radio
  t.box(0.38, 0.34, 0.16, SR.olive, 0, 0.32, 0.24);                // pack
  t.box(0.56, 0.07, 0.34, SR.black, 0, 0.05, 0);                   // belt
  t.box(0.20, 0.12, 0.20, SR.camo, 0, 0.64, 0);                    // collar
  const torsoMesh = tag(t.mesh(m), 'torso'); torso.add(torsoMesh);
  if (teamMat) { // team band across the carrier
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.07, 0.385), teamMat);
    band.position.y = 0.47; band.castShadow = false; band.userData.part = 'torso';
    torso.add(band); hitMeshes.push(band);
  }
  g.add(torso);
  const pv = new Part(); pv.box(0.50, 0.24, 0.31, SR.camo, 0, 0.85, 0);
  g.add(tag(pv.mesh(m), 'torso'));

  // ---- head: helmet scaled 1.25x — a clear but honest headshot target ----
  const head = new THREE.Group(); head.position.y = 0.72;
  const h = new Part();
  h.sph(0.115, SR.skin, 0, 0.13, 0, 1, 1.12, 1);
  h.box(0.06, 0.05, 0.04, SR.skin, 0, 0.10, -0.11);
  h.sph(0.19, SR.helmet, 0, 0.19, 0, 1.0, 0.88, 1.12, Math.PI * 0.62); // big shell
  h.box(0.34, 0.035, 0.07, SR.helmet, 0, 0.15, -0.15);                 // brim
  if (armor >= 1) h.box(0.26, 0.10, 0.05, SR.visor, 0, 0.14, -0.13);   // ballistic visor
  if (armor >= 2) { h.box(0.10, 0.09, 0.05, SR.black, -0.16, 0.13, -0.02); h.box(0.10, 0.09, 0.05, SR.black, 0.16, 0.13, -0.02); } // ear armor
  h.box(0.05, 0.15, 0.02, SR.black, 0.12, 0.05, -0.02);
  head.add(tag(h.mesh(m), 'head'));
  torso.add(head);

  // ---- arms (thicker sleeves) ----
  const mkArm = (side: number) => {
    const a = new THREE.Group(); a.position.set(side * 0.30, 0.48, -0.02);
    const p = new Part();
    p.box(0.16, 0.36, 0.16, SR.camo, 0, -0.15, 0);
    p.box(0.19, 0.12, 0.19, armor >= 2 ? SR.black : SR.vest, 0, -0.02, 0);
    p.box(0.13, 0.09, 0.13, SR.black, 0, -0.35, 0);
    p.box(0.12, 0.30, 0.12, SR.camo, 0, -0.48, 0);
    p.box(0.10, 0.10, 0.11, SR.black, 0, -0.65, 0);
    a.add(tag(p.mesh(m), 'limb'));
    torso.add(a); return a;
  };
  const lArm = mkArm(-1), rArm = mkArm(1);

  // ---- legs (thicker) ----
  const mkLeg = (side: number) => {
    const leg = new THREE.Group(); leg.position.set(side * 0.14, 0.92, 0);
    const thigh = new Part();
    thigh.box(0.20, 0.41, 0.21, SR.camo, 0, -0.205, 0);
    if (armor >= 1) thigh.box(0.16, 0.20, 0.06, SR.black, 0, -0.20, -0.12);
    thigh.box(0.14, 0.14, 0.06, SR.olive, side * 0.04, -0.22, -0.11);
    leg.add(tag(thigh.mesh(m), 'limb'));
    const shin = new THREE.Group(); shin.position.y = -0.43;
    const lower = new Part();
    lower.box(0.17, 0.13, 0.10, SR.black, 0, 0, -0.09);
    lower.box(0.16, 0.35, 0.17, SR.camo, 0, -0.20, 0);
    lower.box(0.17, 0.13, 0.28, SR.boot, 0, -0.41, -0.05);
    lower.box(0.18, 0.045, 0.30, SR.black, 0, -0.47, -0.05);
    shin.add(tag(lower.mesh(m), 'limb')); leg.add(shin); g.add(leg);
    return { leg, shin };
  };
  const left = mkLeg(-1), right = mkLeg(1);

  // ---- rifle: blocky carbine silhouette (cheap world LOD) ----
  const rifle = new THREE.Group();
  const rp = new Part();
  rp.box(0.055, 0.09, 0.34, SR.black, 0, 0, 0.02);          // receiver
  rp.box(0.05, 0.07, 0.20, SR.black, 0, -0.005, -0.24);     // handguard
  rp.cyl(0.013, 0.013, 0.24, 10, SR.black, 0, 0.012, -0.44, Math.PI / 2);
  rp.box(0.045, 0.14, 0.05, SR.black, 0, -0.10, 0.06);      // grip+mag block
  rp.box(0.05, 0.09, 0.16, SR.black, 0, -0.005, 0.24);      // stock
  rp.box(0.02, 0.03, 0.14, SR.black, 0, 0.06, -0.06);       // top rail/optic
  const rifleMesh = rp.mesh(m); rifleMesh.castShadow = false;
  rifle.add(rifleMesh);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.56); rifle.add(muzzle);
  rifle.position.set(0.10, 0.32, -0.42);
  torso.add(rifle);

  // ---- generous invisible hit proxies (scaled to the wider frame) ----
  const ghost = HIT_PROXY_MAT;
  const torsoHit = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.18, 0.68), ghost); torsoHit.position.y = 0.28; torsoHit.userData.part = 'torso'; torso.add(torsoHit); hitMeshes.push(torsoHit);
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), ghost); headHit.position.y = 0.14; headHit.userData.part = 'head'; head.add(headHit); hitMeshes.push(headHit);
  const neckHit = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 8), ghost); neckHit.position.y = -0.06; neckHit.userData.part = 'head'; head.add(neckHit); hitMeshes.push(neckHit);
  const legHit = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.9, 0.5), ghost); legHit.position.y = 0.45; legHit.userData.part = 'limb'; g.add(legHit); hitMeshes.push(legHit);

  return { group: g, parts: { torso, head, lLeg: left.leg, rLeg: right.leg, lShin: left.shin, rShin: right.shin, muzzle, lArm, rArm, rifle }, hitMeshes };
}

/* ================= WORLD WEAPON LODs (Bomb Defusal) =================
 * Bots in the defusal mode carry what they bought, so the silhouette tells
 * you what you are about to fight: a pistol on eco, an AWM on a long angle.
 * Cheap merged boxes in the soldier atlas, swapped under the existing rifle
 * pivot so every TDMBot animation keeps working unchanged.
 */
export type WorldWeaponKind = 'rifle' | 'pistol' | 'smg' | 'sniper' | 'shotgun' | 'lmg';
export function setWorldWeapon(model: SoldierModel, kind: WorldWeaponKind): void {
  const rifle = model.parts.rifle;
  for (const c of [...rifle.children]) {
    if (c === model.parts.muzzle) continue;
    rifle.remove(c);
    if (c instanceof THREE.Mesh) c.geometry.dispose();
  }
  const { mesh, muzzleZ } = worldWeaponMesh(kind);
  rifle.add(mesh);
  model.parts.muzzle.position.set(0, 0.012, muzzleZ);
}

/** Beyond this camera distance mission soldiers show the atlas rifle. At 14 m and a
 *  95° FOV a 0.9 m rifle spans ~60 px at 1080p — enough to read the silhouette, not
 *  the machining. 2 m of hysteresis stops a soldier at the boundary flickering. */
export const WEAPON_LOD_DISTANCE = 14;
const WEAPON_LOD_HYSTERESIS = 2;
/** Returns true when the detailed rifle is shown. No-op for models without a LOD. */
export function updateWeaponLod(model: SoldierModel, distance: number): boolean {
  const lod = model.weaponLod;
  if (!lod) return true;
  const near = lod.near ? distance < WEAPON_LOD_DISTANCE + WEAPON_LOD_HYSTERESIS : distance < WEAPON_LOD_DISTANCE - WEAPON_LOD_HYSTERESIS;
  if (near !== lod.near) {
    lod.near = near;
    for (const o of lod.hi) o.visible = near;
    lod.lo.visible = !near;
  }
  return near;
}

/** Standalone world gun (also used for weapons dropped on the floor). Muzzle points −z. */
export function worldWeaponMesh(kind: WorldWeaponKind): { mesh: THREE.Mesh; muzzleZ: number } {
  const p = new Part();
  let muzzleZ = -0.56;
  switch (kind) {
    case 'pistol':
      p.box(0.042, 0.065, 0.2, SR.black, 0, 0.012, -0.16);
      p.box(0.038, 0.11, 0.055, SR.black, 0, -0.06, -0.08);
      muzzleZ = -0.27;
      break;
    case 'smg':
      p.box(0.05, 0.08, 0.28, SR.black, 0, 0, -0.02);
      p.box(0.04, 0.13, 0.045, SR.black, 0, -0.1, -0.08);
      p.cyl(0.012, 0.012, 0.14, 8, SR.black, 0, 0.01, -0.22, Math.PI / 2);
      p.box(0.035, 0.05, 0.16, SR.black, 0, -0.01, 0.18);
      muzzleZ = -0.3;
      break;
    case 'sniper':
      p.box(0.058, 0.09, 0.44, SR.black, 0, 0, 0.02);
      p.cyl(0.013, 0.011, 0.56, 10, SR.black, 0, 0.014, -0.47, Math.PI / 2);
      p.cyl(0.032, 0.032, 0.28, 10, SR.black, 0, 0.085, -0.04, Math.PI / 2);
      p.box(0.06, 0.12, 0.26, SR.olive, 0, -0.02, 0.33);
      p.box(0.04, 0.1, 0.05, SR.black, 0, -0.08, 0.06);
      muzzleZ = -0.76;
      break;
    case 'shotgun':
      p.box(0.055, 0.085, 0.3, SR.black, 0, 0, 0.02);
      p.cyl(0.016, 0.016, 0.44, 10, SR.black, 0, 0.015, -0.34, Math.PI / 2);
      p.cyl(0.014, 0.014, 0.36, 8, SR.black, 0, -0.02, -0.3, Math.PI / 2);
      p.box(0.05, 0.05, 0.12, SR.olive, 0, -0.025, -0.3);
      p.box(0.05, 0.1, 0.22, SR.olive, 0, -0.02, 0.27);
      muzzleZ = -0.58;
      break;
    case 'lmg':
      p.box(0.075, 0.12, 0.4, SR.black, 0, 0, 0.02);
      p.box(0.1, 0.1, 0.12, SR.olive, -0.06, -0.08, -0.02);
      p.cyl(0.017, 0.017, 0.36, 10, SR.black, 0, 0.02, -0.36, Math.PI / 2);
      p.box(0.06, 0.1, 0.22, SR.black, 0, -0.01, 0.3);
      p.box(0.01, 0.16, 0.01, SR.black, 0.03, -0.08, -0.44);
      p.box(0.01, 0.16, 0.01, SR.black, -0.03, -0.08, -0.44);
      muzzleZ = -0.56;
      break;
    default:
      p.box(0.055, 0.09, 0.34, SR.black, 0, 0, 0.02);
      p.box(0.05, 0.07, 0.20, SR.black, 0, -0.005, -0.24);
      p.cyl(0.013, 0.013, 0.24, 10, SR.black, 0, 0.012, -0.44, Math.PI / 2);
      p.box(0.045, 0.14, 0.05, SR.black, 0, -0.10, 0.06);
      p.box(0.05, 0.09, 0.16, SR.black, 0, -0.005, 0.24);
      p.box(0.02, 0.03, 0.14, SR.black, 0, 0.06, -0.06);
  }
  const mesh = p.mesh(getSoldierMat());
  mesh.castShadow = false;
  return { mesh, muzzleZ };
}
