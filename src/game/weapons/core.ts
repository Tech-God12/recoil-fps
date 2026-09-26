// Shared procedural weapon geometry, finishes and first-person rig.
// Gun-local convention: +Y up, -Z forward. All dimensions are visual game units.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { batchRigidGroup, batchRigidSegment } from './geometry';
import { finish } from './finish';
export { GunBuilder, weaponBounds } from './geometry';
import type { AttachSlot } from '../economy/catalog';
import type { SkinDef, SkinRole } from '../economy/skins';

export interface LArmKey { t: number; p: [number, number, number]; r: [number, number, number] }

/**
 * Two-bone IK rig baked onto the animated left arm.
 *
 * The old rig translated the whole arm group, which dragged the shoulder along
 * with the hand — the forearm cylinder swept straight through the receiver and
 * magwell on every reload. Here the shoulder is a fixed anchor in gun space and
 * only the hand target moves; the elbow is solved onto a pole vector that points
 * down-and-outboard, so the limb always folds *away* from the gun body.
 */
export interface ArmRig {
  /** Shoulder anchor in gun-local space (never moves). */
  shoulder: THREE.Vector3;
  /** Rest hand position in gun-local space (the support-hand grip point). */
  rest: THREE.Vector3;
  upperLen: number;
  foreLen: number;
  /** Elbow-out hint in gun-local space. */
  pole: THREE.Vector3;
  elbow: THREE.Group;
  hand: THREE.Group;
}
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

  // ---- left arm (animated, two-bone IK) ----
  // lArm is the SHOULDER pivot. It is placed once and never translated again;
  // only its orientation changes, so the limb can never slide through the gun.
  const fw = new THREE.Vector3(...a.fore);
  const lS = new THREE.Vector3(-0.235, -0.405, 0.165);
  const lArm = new THREE.Group();
  lArm.userData.arm = true;
  lArm.position.copy(lS);
  gun.add(lArm);

  // Bone lengths come from the real rest triangle so the rest pose is pixel-identical
  // to the hand-authored one: shoulder → elbow → support hand.
  const restElbow = new THREE.Vector3(-0.178, -0.292, -0.148);
  const upperLen = restElbow.distanceTo(lS);
  const foreLen = fw.distanceTo(restElbow);

  // Upper arm: authored along local −Y from the shoulder origin.
  const upperTip = new THREE.Vector3(0, -upperLen, 0);
  limb(lArm, new THREE.Vector3(0, 0, 0), upperTip, 0.054, 0.047, WM.sleeve);
  // Deltoid cap so the shoulder joint never shows a hollow cylinder mouth.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.054, 10, 8), WM.sleeve);
  lArm.add(cap);

  const elbow = new THREE.Group();
  elbow.position.copy(upperTip);
  lArm.add(elbow);
  // Elbow ball: hides the seam between the two bones at any bend angle.
  // Shares the forearm material so the whole bone batches into a single draw.
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.047, 10, 8), WM.sleeveDark);
  elbow.add(joint);
  const foreTip = new THREE.Vector3(0, -foreLen, 0);
  limb(elbow, new THREE.Vector3(0, 0, 0), foreTip, 0.045, 0.037, WM.sleeveDark);
  const cuff2 = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), WM.sleeveDark);
  cuff2.position.set(0, -foreLen * 0.46, 0);
  cuff2.quaternion.identity();
  elbow.add(cuff2);

  // Hand: authored in gun space around the rest grip point, then re-parented to
  // the wrist. At rest its gun-space transform is identity, so the glove lands
  // exactly where it was hand-placed before the rig change.
  const lHand = new THREE.Group();
  lHand.position.copy(foreTip);
  elbow.add(lHand);
  gloveBox(lHand, 0.04, 0.062, 0.05, 0, 0, 0);
  for (let i = 0; i < 3; i++) gloveBox(lHand, 0.042, 0.012, 0.016, 0, -0.012 - i * 0.015, -0.028);
  gloveBox(lHand, 0.02, 0.05, 0.02, -0.026, -0.005, 0.005, 0, 0, 0.4);
  // Thumb wrapping the far side of the handguard — kills the old "floating mitt" read.
  gloveBox(lHand, 0.018, 0.042, 0.018, 0.024, 0.004, -0.010, 0.25, 0, -0.35);

  const rig: ArmRig = { shoulder: lS.clone(), rest: fw.clone(), upperLen, foreLen, pole: new THREE.Vector3(-0.72, -0.62, 0.30).normalize(), elbow, hand: lHand };
  lArm.userData.rig = rig;

  // Reload choreography. `p` is the HAND target offset from the rest grip, `r`
  // is the hand's orientation in gun space. The elbow is solved, never authored.
  const mg = new THREE.Vector3(...a.mag), fa = new THREE.Vector3(...a.fa);
  const toMag: [number, number, number] = [mg.x - fw.x, mg.y - fw.y + 0.02, mg.z - fw.z];
  // Outboard standoff: the hand leaves the handguard sideways before diving to
  // the magwell, so the wrist never passes through the barrel line.
  const clearX = Math.min(-0.055, toMag[0] - 0.035);
  const keys: LArmKey[] = [
    { t: 0.00, p: [0, 0, 0], r: [0, 0, 0] },
    { t: 0.10, p: [-0.018, -0.012, 0.010], r: [0.05, -0.08, 0.04] },
    // sweep outboard and back toward the magwell, clear of the receiver
    { t: 0.22, p: [clearX, toMag[1] * 0.45 - 0.010, toMag[2] * 0.55], r: [0.34, -0.22, 0.16] },
    // grip the seated magazine
    { t: 0.33, p: [toMag[0], toMag[1], toMag[2]], r: [0.52, -0.10, 0.14] },
    // strip it straight down and out of frame
    { t: 0.46, p: [toMag[0] - 0.012, toMag[1] - 0.105, toMag[2] + 0.012], r: [0.66, -0.06, 0.16] },
    // dip to the pouch (hand leaves the gun entirely) and come back with a fresh mag
    { t: 0.56, p: [toMag[0] - 0.030, toMag[1] - 0.185, toMag[2] + 0.055], r: [0.74, 0.02, 0.22] },
    { t: 0.68, p: [toMag[0] - 0.004, toMag[1] - 0.052, toMag[2] + 0.004], r: [0.58, -0.06, 0.15] },
    // seat it with a firm upward push
    { t: 0.755, p: [toMag[0], toMag[1] + 0.006, toMag[2]], r: [0.48, -0.08, 0.12] },
    // slap the bolt release / forward assist on the way home
    { t: 0.845, p: [fa.x - fw.x, fa.y - fw.y, fa.z - fw.z], r: [-0.32, 0.10, -0.18] },
    { t: 0.93, p: [-0.010, 0.006, -0.006], r: [-0.06, 0.02, -0.04] },
    { t: 1.00, p: [0, 0, 0], r: [0, 0, 0] },
  ];
  batchRigidGroup(r);
  // The left arm cannot be flattened — its bones are animated transforms. Batch
  // each bone's own meshes instead: three draws for the whole limb, elbow intact.
  batchRigidSegment(lHand);
  batchRigidSegment(elbow);
  batchRigidSegment(lArm);
  poseArmIK(lArm, ZERO3, ZERO_EULER);
  return { lArm, keys };
}

const ZERO3 = /* @__PURE__ */ new THREE.Vector3();
const ZERO_EULER = /* @__PURE__ */ new THREE.Euler();
const _target = /* @__PURE__ */ new THREE.Vector3();
const _dir = /* @__PURE__ */ new THREE.Vector3();
const _axis = /* @__PURE__ */ new THREE.Vector3();
const _side = /* @__PURE__ */ new THREE.Vector3();
const _elbowPos = /* @__PURE__ */ new THREE.Vector3();
const _upperDir = /* @__PURE__ */ new THREE.Vector3();
const _foreDir = /* @__PURE__ */ new THREE.Vector3();
const _q = /* @__PURE__ */ new THREE.Quaternion();
const _qInv = /* @__PURE__ */ new THREE.Quaternion();
const _qHand = /* @__PURE__ */ new THREE.Quaternion();
const DOWN = /* @__PURE__ */ new THREE.Vector3(0, -1, 0);

/**
 * Solve the two-bone chain so the wrist lands on `rest + offset` (gun space)
 * with the hand oriented by `rot` (gun space). Pure transform maths, no
 * allocation — this runs every frame of every reload.
 */
export function poseArmIK(lArm: THREE.Object3D, offset: THREE.Vector3, rot: THREE.Euler): void {
  const rig = lArm.userData.rig as ArmRig | undefined;
  if (!rig) return;
  const { shoulder, rest, upperLen, foreLen, pole, elbow, hand } = rig;
  _target.copy(rest).add(offset);
  _dir.copy(_target).sub(shoulder);
  // Clamp reach so the solver never hits a degenerate/NaN triangle.
  const maxReach = (upperLen + foreLen) * 0.998;
  const minReach = Math.abs(upperLen - foreLen) * 1.02 + 1e-4;
  let dist = _dir.length();
  if (dist < 1e-6) { _dir.set(0, -1, 0); dist = 1e-6; }
  _dir.divideScalar(dist);
  dist = THREE.MathUtils.clamp(dist, minReach, maxReach);

  // Elbow displacement plane: perpendicular to the reach line, tilted toward the pole.
  _axis.copy(_dir).cross(pole);
  if (_axis.lengthSq() < 1e-8) _axis.set(0, 0, 1);
  _axis.normalize();
  _side.copy(_axis).cross(_dir).normalize();
  // Keep the elbow on the pole side of the reach line.
  if (_side.dot(pole) < 0) _side.negate();

  const cosShoulder = THREE.MathUtils.clamp((upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist), -1, 1);
  const shoulderAngle = Math.acos(cosShoulder);
  _upperDir.copy(_dir).multiplyScalar(Math.cos(shoulderAngle)).addScaledVector(_side, Math.sin(shoulderAngle)).normalize();
  _elbowPos.copy(shoulder).addScaledVector(_upperDir, upperLen);
  _foreDir.copy(_target).sub(_elbowPos).normalize();

  lArm.quaternion.setFromUnitVectors(DOWN, _upperDir);
  // Forearm direction expressed in the (already oriented) upper-arm frame.
  _qInv.copy(lArm.quaternion).invert();
  _foreDir.applyQuaternion(_qInv);
  elbow.quaternion.setFromUnitVectors(DOWN, _foreDir);

  // The hand's orientation is authored in gun space, so strip the bone chain out.
  _qHand.setFromEuler(rot);
  _q.copy(lArm.quaternion).multiply(elbow.quaternion).invert().multiply(_qHand);
  hand.quaternion.copy(_q);
}

