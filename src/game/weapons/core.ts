// Shared procedural weapon geometry, finishes and first-person rig.
// Gun-local convention: +Y up, -Z forward. All dimensions are visual game units.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { batchRigidGroup } from './geometry';
import { finish } from './finish';
export { GunBuilder, weaponBounds } from './geometry';
import type { AttachSlot } from '../economy/catalog';
import type { SkinDef, SkinRole } from '../economy/skins';

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
  poly: finish({ color: 0x2B2E31, roughness: 0.78, metalness: 0.04 }, 'polymer'), // W3: 0.10→0.04 so polymer reads as plastic, not painted metal
  steel: finish({ color: 0x898C8B, roughness: 0.62, metalness: 0.86 }),
  darkSteel: finish({ color: 0x505356, roughness: 0.70, metalness: 0.62 }),
  tanGrip: finish({ color: 0x8C7D63, roughness: 0.84, metalness: 0.04 }, 'grip'),
  tan: finish({ color: 0x8C7D63, roughness: 0.74, metalness: 0.04 }, 'polymer'), // W3: 0.08→0.04
  dark: finish({ color: 0x242727, roughness: 0.80, metalness: 0.52 }),
  wood: finish({ color: 0xCBBBAA, roughness: 0.58 }, 'wood'),
  woodDark: finish({ color: 0xB5A08B, roughness: 0.72 }, 'checkeredWood'),
  grip: finish({ color: 0x242423, roughness: 0.91 }, 'grip'),
  rubber: finish({ color: 0x151616, roughness: 0.95 }, 'rubber'),
  brass: new THREE.MeshStandardMaterial({ color: 0xC89838, roughness: 0.3, metalness: 0.95 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x5C564A, roughness: 0.95 }),
  sleeveDark: new THREE.MeshStandardMaterial({ color: 0x46413A, roughness: 0.95 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x2E2820, roughness: 0.9 }),
  glass: new THREE.MeshBasicMaterial({ color: 0x9FD4E8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  reticle: new THREE.MeshBasicMaterial({ color: 0xFF2828 }),
  scopeInner: new THREE.MeshBasicMaterial({ color: 0x060708, side: THREE.DoubleSide }),
  tritium: new THREE.MeshBasicMaterial({ color: 0xD4E6BC }),
  marking: new THREE.MeshStandardMaterial({ color: 0xADAFA6, roughness: 0.65 }),
  red: new THREE.MeshStandardMaterial({ color: 0xA73C32, roughness: 0.65 }),
  fde: finish({ color: 0x968366, roughness: 0.72, metalness: 0.04 }, 'polymer'), // W3: 0.50→0.04
  chrome: finish({ color: 0xD7D6D1, roughness: 0.32, metalness: 0.97 }),
  midSteel: finish({ color: 0x606568, roughness: 0.68, metalness: 0.80 }),
  od: finish({ color: 0x465038, roughness: 0.85, metalness: 0.04 }, 'polymer'), // W3: 0.08→0.04
};

/* ---------- Weapon finishes ---------- */

// Palette roles a finish may repaint. Arms (sleeve/glove), ammo (brass),
// rubber furniture, glass and emissive marks are never touched.
const SKIN_ROLES: SkinRole[] = ['poly', 'steel', 'darkSteel', 'dark', 'tan', 'wood', 'woodDark', 'fde', 'chrome', 'midSteel', 'od'];
// Built lazily after the shared physical finishes have been configured.
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

for (const [name, mat] of Object.entries(WM)) mat.name = name;

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
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * 0.16), WM.glove);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}

export interface ArmAnchors { fore: [number, number, number]; mag: [number, number, number]; fa: [number, number, number]; grip?: [number, number, number] }
/**
 * Procedural first-person arms, built in gun-local space.
 * Right arm is static (gripping). Left arm lives in its own group so the
 * engine can drive it through reload keyframes derived from the anchors.
 */
export function attachArms(gun: THREE.Group, a: ArmAnchors): { lArm: THREE.Group; keys: LArmKey[] } {
  // ---- right arm (static grip), fitted to the actual grip instead of one universal offset ----
  const hand = new THREE.Vector3(...(a.grip ?? [0.004, -0.075, -0.020]));
  const handDelta = hand.clone().sub(new THREE.Vector3(0.004, -0.075, -0.045));
  const r = new THREE.Group(); r.userData.arm = true; gun.add(r);
  const rS = new THREE.Vector3(0.21, -0.40, 0.20), rE = new THREE.Vector3(0.155, -0.31, -0.03), rW = new THREE.Vector3(0.035, -0.115, -0.055).add(handDelta);
  limb(r, rS, rE, 0.052, 0.046, WM.sleeve);
  limb(r, rE, rW, 0.044, 0.038, WM.sleeveDark);
  // rolled cuff
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), WM.sleeveDark);
  cuff.position.copy(rE).lerp(rW, 0.55);
  cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(rW, rE).normalize());
  r.add(cuff);
  // glove wrapped on pistol grip
  const fingers = new THREE.Group(); fingers.position.copy(handDelta); r.add(fingers);
  gloveBox(fingers, 0.034, 0.075, 0.042, 0.004, -0.075, -0.045, -0.32);
  // fingers curling over the front strap
  for (let i = 0; i < 3; i++) gloveBox(fingers, 0.036, 0.013, 0.014, 0.0, -0.062 - i * 0.016, -0.068, -0.32);
  gloveBox(fingers, 0.02, 0.05, 0.02, 0.028, -0.075, -0.03, -0.3, 0, -0.4); // thumb

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
  batchRigidGroup(r);
  batchRigidGroup(lArm);
  return { lArm, keys };
}

