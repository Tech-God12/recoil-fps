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

/** Two-bone chain state hung off the animated arm group. */
export interface ArmRig {
  upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D;
  L1: number; L2: number;
  shoulder: THREE.Vector3; rest: THREE.Vector3; pole: THREE.Vector3;
}

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _toTarget = new THREE.Vector3(), _poleDir = new THREE.Vector3(), _axis = new THREE.Vector3();
const _upperDir = new THREE.Vector3(), _elbow = new THREE.Vector3(), _foreDir = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qInv = new THREE.Quaternion();
const _bx = new THREE.Vector3(), _bz = new THREE.Vector3(), _basis = new THREE.Matrix4();
/** Gun-forward hint; keeps the bone twist deterministic so the glove never barrel-rolls. */
const TWIST_HINT = new THREE.Vector3(0, 0, -1);

/**
 * Orient `node` so its local +Y follows `dir`, choosing the remaining twist from a
 * fixed hint instead of three.js' minimal-arc rotation (which spins unpredictably
 * as the target sweeps past the pole and makes the hand flip mid-animation).
 */
function aimBone(node: THREE.Object3D, dir: THREE.Vector3, parentInv: THREE.Quaternion | null) {
  _bx.crossVectors(TWIST_HINT, dir);
  if (_bx.lengthSq() < 1e-8) _bx.set(1, 0, 0); else _bx.normalize();
  _bz.crossVectors(_bx, dir).normalize();
  _basis.makeBasis(_bx, dir, _bz);
  node.quaternion.setFromRotationMatrix(_basis);
  if (parentInv) node.quaternion.premultiply(parentInv);
}

/**
 * Analytic two-bone IK. Places the elbow on the circle of valid solutions nearest
 * the pole hint, so the arm bends the way a human arm bends instead of snapping
 * through the weapon. `roll` twists the wrist about the forearm.
 *
 * Target is in the same space as the arm group's parent (gun-local).
 */
export function solveArm(arm: THREE.Object3D, target: THREE.Vector3, roll = 0) {
  const rig = arm.userData.rig as ArmRig | undefined;
  if (!rig) return;
  const { L1, L2 } = rig;
  _toTarget.copy(target).sub(rig.shoulder);
  // Clamp reach: never fully lock out (looks broken) and never fold past the elbow.
  const reach = Math.min(Math.max(_toTarget.length(), Math.abs(L1 - L2) + 0.012), L1 + L2 - 0.006);
  if (reach < 1e-5) return;
  _toTarget.normalize();
  _poleDir.copy(rig.pole).sub(rig.shoulder).normalize();
  _axis.crossVectors(_toTarget, _poleDir);
  if (_axis.lengthSq() < 1e-9) _axis.set(1, 0, 0); else _axis.normalize();
  const cosShoulder = (L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach);
  const shoulderAngle = Math.acos(Math.min(1, Math.max(-1, cosShoulder)));
  _upperDir.copy(_toTarget).applyQuaternion(_q.setFromAxisAngle(_axis, -shoulderAngle));
  _elbow.copy(rig.shoulder).addScaledVector(_upperDir, L1);
  aimBone(rig.upper, _upperDir, null);
  _foreDir.copy(target).sub(_elbow).normalize();
  _qInv.copy(rig.upper.quaternion).invert();
  aimBone(rig.lower, _foreDir, _qInv);
  if (roll) rig.lower.quaternion.multiply(_q.setFromAxisAngle(UP, roll));
}
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

  // ---- left arm: a real two-bone IK chain -------------------------------
  // The old arm was ONE rigid batch that got translated bodily toward the magazine,
  // which dragged the shoulder through the receiver — that is the clipping the
  // reload complaint was about. Now the shoulder is pinned, the hand is driven to a
  // world target, and the elbow is solved between them, so the arm can reach the
  // mag well, the pouch and the charging handle without ever passing through the gun.
  const lArm = new THREE.Group(); lArm.userData.arm = true; gun.add(lArm);
  const lS = new THREE.Vector3(-0.235, -0.405, 0.170);
  const lE = new THREE.Vector3(-0.180, -0.290, -0.140);
  const fw = new THREE.Vector3(...a.fore);
  const L1 = lS.distanceTo(lE), L2 = lE.distanceTo(fw);
  lArm.position.copy(lS);

  // Build each bone DETACHED and batch it in isolation. batchRigidGroup() bakes a
  // group's entire subtree into itself, so parenting first would duplicate the
  // forearm and hand geometry into the upper arm and wreck the chain.
  const upper = new THREE.Group(); upper.name = 'left upper arm';
  limb(upper, ZERO, new THREE.Vector3(0, L1, 0), 0.052, 0.046, WM.sleeve);
  batchRigidGroup(upper);

  const lower = new THREE.Group(); lower.name = 'left forearm';
  limb(lower, ZERO, new THREE.Vector3(0, L2, 0), 0.044, 0.037, WM.sleeveDark);
  const cuff2 = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), WM.sleeveDark);
  cuff2.position.set(0, L2 * 0.40, 0);
  lower.add(cuff2);
  batchRigidGroup(lower);

  // Hand frame: +Y continues out past the wrist, +Z is the gun's forward axis.
  const lHand = new THREE.Group(); lHand.name = 'left hand';
  gloveBox(lHand, 0.040, 0.050, 0.062, 0, 0.020, -0.004);
  for (let i = 0; i < 3; i++) gloveBox(lHand, 0.042, 0.016, 0.012, 0, 0.012, -0.036 - i * 0.015);
  gloveBox(lHand, 0.020, 0.020, 0.050, -0.026, 0.014, 0.004, 0.4);
  batchRigidGroup(lHand);

  lower.add(lHand); lHand.position.set(0, L2, 0);
  upper.add(lower); lower.position.set(0, L1, 0);
  lArm.add(upper);

  const rig: ArmRig = {
    upper, lower, hand: lHand, L1, L2,
    shoulder: lS.clone(),
    rest: fw.clone(),
    // Elbow hint: down, outboard and slightly back — where a shooter's support
    // elbow actually lives. Keeps the bend out of the magwell and off the screen edge.
    pole: new THREE.Vector3(-0.44, -0.70, 0.12),
  };
  lArm.userData.rig = rig;
  solveArm(lArm, fw, 0);

  // Reload hand targets, in GUN SPACE (absolute), not deltas from the foregrip.
  const mg = new THREE.Vector3(...a.mag), fa = new THREE.Vector3(...a.fa);
  // How far the charging handle sits above the support hand tells us how much
  // receiver/optic bulk the forearm has to swing around. Tall guns (AWM with its
  // scope, the SAW with its feed cover) need a wider arc than a flat-top carbine.
  const bulk = Math.max(0, fa.y - fw.y);
  // Clamped: too little and the forearm shaves the receiver, too much and the hand
  // swings so far outboard it comes back through the gun from the far side.
  const standoff = Math.min(0.085, 0.052 + bulk * 0.95);
  // The pouch is off the gun entirely: down, inboard and behind, where a chest rig is.
  const pouch: [number, number, number] = [fw.x - 0.055, mg.y - 0.115, mg.z + 0.155];
  // Waypoint clear of the underside of the gun, halfway between grip and magwell.
  const under: [number, number, number] = [
    (fw.x + mg.x) * 0.5 - 0.022,
    Math.min(fw.y, mg.y + 0.03) - 0.052,
    (fw.z + mg.z) * 0.5,
  ];
  const wellLip: [number, number, number] = [mg.x, mg.y + 0.055, mg.z];
  const keys: LArmKey[] = [
    { t: 0.00, p: [fw.x, fw.y, fw.z], r: [0, 0, 0] },
    // Index: hand still driving the foregrip while the gun rolls into the workspace.
    { t: 0.10, p: [fw.x, fw.y - 0.004, fw.z + 0.010], r: [0.05, 0, 0] },
    // Travel UNDER the receiver, not through it. A straight foregrip-to-magwell
    // line cuts the corner and buries the wrist in the handguard on deep-bodied
    // guns (the SAW especially); dropping below the bore line first is also how
    // the motion actually looks on a real reload.
    { t: 0.17, p: [under[0], under[1], under[2]], r: [0.22, 0.06, 0.10] },
    // Strip: thumb finds the release, hand cups the base of the magazine.
    { t: 0.25, p: [mg.x - 0.012, mg.y + 0.030, mg.z + 0.008], r: [0.35, 0.10, 0.18] },
    // Pull the empty clear and sweep down to the pouch.
    { t: 0.38, p: [mg.x - 0.030, mg.y - 0.060, mg.z + 0.060], r: [0.55, 0.16, 0.26] },
    { t: 0.50, p: pouch, r: [0.72, 0.22, 0.30] },
    // Fresh magazine comes up on the same arc and indexes on the well lip.
    { t: 0.64, p: [wellLip[0] - 0.010, wellLip[1] - 0.030, wellLip[2] + 0.030], r: [0.50, 0.12, 0.22] },
    { t: 0.74, p: [mg.x, mg.y + 0.018, mg.z], r: [0.30, 0.05, 0.14] },
    // Seat tap: a short firm push straight up into the well.
    { t: 0.80, p: [mg.x, mg.y + 0.040, mg.z], r: [0.22, 0.02, 0.10] },
    // Charging handle: the hand swings OUTBOARD of the receiver and comes down on
    // the handle from the side, never across the top — a straight-line reach drags
    // the forearm through the upper receiver, which was the last clipping case left.
    { t: 0.85, p: [fa.x - standoff, fa.y + 0.030, fa.z + 0.030], r: [-0.18, -0.16, -0.10] },
    { t: 0.90, p: [fa.x - standoff * 0.55, fa.y + 0.014, fa.z], r: [-0.30, -0.12, -0.16] },
    { t: 0.94, p: [fa.x - standoff * 0.66, fa.y + 0.010, fa.z + 0.042], r: [-0.26, -0.12, -0.14] },
    { t: 0.97, p: [under[0] - 0.010, under[1] + 0.020, under[2] - 0.030], r: [-0.10, -0.04, 0] },
    { t: 0.99, p: [fw.x - 0.004, fw.y + 0.006, fw.z - 0.004], r: [-0.03, 0, 0] },
    { t: 1.00, p: [fw.x, fw.y, fw.z], r: [0, 0, 0] },
  ];
  batchRigidGroup(r);
  // NOTE: do NOT batch lArm — its three bones must stay separate transforms for
  // the IK solver. Each bone is already batched individually above (3 draws).
  return { lArm, keys };
}

