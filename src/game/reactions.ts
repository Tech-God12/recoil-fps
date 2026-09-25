import * as THREE from 'three';
import type { SoldierModel } from './models';

/**
 * IMPACT & DEATH REACTIONS — shared by mission soldiers (ai.ts) and arena/defusal
 * bots (tdm.ts). See docs/impact-reactions.md.
 *
 * Before: every hit pitched the torso forward by the same amount, and every death
 * rotated the WHOLE soldier −86° about X as one rigid board, falling backwards along
 * its own facing no matter where the shot came from — through walls if one was
 * behind it — with the rifle glued to its hands.
 *
 * Now: hits flinch by zone and direction; deaths pick one of six multi-joint
 * procedural animations from hit zone × shot direction × cause, fall along the
 * bullet's travel, check the fall path against collision and slump against walls
 * instead of clipping, drop the rifle, and settle. Once settled a corpse costs zero
 * per-frame work.
 */

export type HitZone = 'head' | 'torso' | 'limb';
export interface HitInfo {
  /** World point the damage came from (shooter eye, grenade position…). */
  from?: THREE.Vector3;
  zone?: HitZone;
  explosive?: boolean;
}
/** Map a hit-proxy `userData.part` tag onto a reaction zone. */
export function hitZone(part: unknown): HitZone {
  return part === 'head' ? 'head' : part === 'limb' ? 'limb' : 'torso';
}
export type DeathVariant = 'crumple' | 'back' | 'forward' | 'spin' | 'kneel' | 'blast' | 'slump';

export interface AABB { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/** A standing soldier is ~1.75 m from boots to helmet — the length a fall sweeps. */
export const BODY_LENGTH = 1.75;
/** Clearance kept between a fallen head and a wall (helmet radius + a hair). */
const WALL_CLEARANCE = 0.15;
/** Below this much free floor the body cannot topple at all: it sits against the wall. */
export const SLUMP_BELOW = 1.0;
/** Final lying tilt: 83°, not 90° — the torso box is ~0.25 m deep, so a full 90° about
 *  the boots would sink the chest into the floor. `LIE_LIFT` covers the rest. */
const LIE_TILT = 1.45;
const LIE_LIFT = 0.1;

/** Joint + root channels a death keyframe can drive. Angles in radians, metres. */
export interface Pose {
  tilt: number;   // topple about a horizontal axis through the boots, toward the fall direction
  sink: number;   // root drops (knees giving way / sitting)
  lift: number;   // root rises (blast arc, lying thickness)
  twist: number;  // extra yaw (spin variant)
  slide: number;  // root travels along the fall direction
  torsoX: number; torsoZ: number;
  headX: number; headZ: number;
  armLX: number; armLZ: number; armRX: number; armRZ: number;
  hipX: number; kneeX: number;
}
const ZERO: Pose = { tilt: 0, sink: 0, lift: 0, twist: 0, slide: 0, torsoX: 0, torsoZ: 0, headX: 0, headZ: 0, armLX: 0, armLZ: 0, armRX: 0, armRZ: 0, hipX: 0, kneeX: 0 };
type Key = { t: number } & Partial<Pose>;
const CHANNELS = Object.keys(ZERO) as (keyof Pose)[];

/*
 * Keyframes, in seconds. Sign conventions (soldier faces −Z):
 *   torsoX < 0 leans forward; headX > 0 snaps the head back;
 *   hipX > 0 swings the thigh forward; kneeX < 0 folds the shin back;
 *   armLZ < 0 / armRZ > 0 fling arms outward; armX > 0 swings hands forward/up.
 * Durations sit at 0.9–1.3 s: CS2/Valorant deaths read in ~1 s; longer and the
 * player is watching an animation instead of the next target.
 */
const VARIANTS: Record<Exclude<DeathVariant, 'slump'>, { keys: Key[]; impact: number; slide: number }> = {
  // Headshot "lights out": no shove, the legs simply stop holding.
  crumple: { impact: 0.8, slide: 0.05, keys: [
    { t: 0.12, headX: 0.5, torsoX: 0.1, kneeX: -0.4, hipX: 0.25, sink: 0.12, armLX: 0.3, armRX: 0.3 },
    { t: 0.45, sink: 0.5, hipX: 1.15, kneeX: -2.0, torsoX: -0.35, headX: -0.6, tilt: 0.15, armLX: 0.1, armRX: 0.1, armLZ: -0.2, armRZ: 0.2 },
    { t: 0.8, tilt: 1.38, sink: 0.45, hipX: 0.9, kneeX: -1.4, torsoX: -0.2, headX: -0.3, headZ: 0.5, armLZ: -0.5, armRZ: 0.3 },
    { t: 1.1, tilt: LIE_TILT, sink: 0.42, hipX: 0.6, kneeX: -0.9, torsoX: -0.15, headX: -0.2, headZ: 0.6, armLZ: -0.7, armRZ: 0.4 },
  ] },
  // Shot from the front: chest punched back, arms thrown up, lands on the back.
  back: { impact: 0.68, slide: 0.25, keys: [
    { t: 0.14, torsoX: 0.35, headX: 0.4, armLZ: -0.6, armRZ: 0.6, kneeX: -0.2, tilt: 0.2 },
    { t: 0.4, tilt: 0.95, torsoX: 0.25, kneeX: -0.5, hipX: 0.1, armLZ: -1.2, armRZ: 1.2, armLX: 1.0, armRX: 0.8, headX: 0.3 },
    { t: 0.68, tilt: LIE_TILT + 0.06, kneeX: -0.25, hipX: 0.25, armLX: 1.6, armRX: 1.9, armLZ: -0.9, armRZ: 1.3, headX: 0.25 },
    { t: 0.95, tilt: LIE_TILT, kneeX: -0.3, hipX: 0.2, armLX: 1.7, armRX: 1.9, armLZ: -1.0, armRZ: 1.2, headX: 0.15, headZ: -0.4 },
  ] },
  // Shot from behind: spine arches, then folds and pitches face-down, arms reaching.
  forward: { impact: 0.62, slide: 0.3, keys: [
    { t: 0.14, torsoX: 0.2, headX: 0.3, kneeX: -0.2 },
    { t: 0.35, tilt: 0.5, kneeX: -0.8, hipX: 0.6, torsoX: -0.4, headX: -0.2, armLX: 0.9, armRX: 0.9 },
    { t: 0.62, tilt: LIE_TILT + 0.05, kneeX: -0.4, hipX: 0.2, torsoX: -0.15, armLX: 2.2, armRX: 2.0, armLZ: -0.3, armRZ: 0.3, headZ: 0.6 },
    { t: 0.9, tilt: LIE_TILT, kneeX: -0.5, hipX: 0.15, torsoX: -0.1, armLX: 2.3, armRX: 1.8, armLZ: -0.4, armRZ: 0.5, headZ: 0.7 },
  ] },
  // Hit from the side: spun toward the shot's travel, drops onto the flank.
  spin: { impact: 0.8, slide: 0.2, keys: [
    { t: 0.15, twist: 0.4, torsoZ: 0.3, headZ: 0.4, armLZ: -0.5, armRZ: 0.5, kneeX: -0.3, hipX: 0.2 },
    { t: 0.5, twist: 1.1, tilt: 0.7, kneeX: -1.0, hipX: 0.7, torsoX: -0.2, torsoZ: 0.2 },
    { t: 0.8, twist: 1.4, tilt: LIE_TILT + 0.05, kneeX: -0.6, hipX: 0.4, armLX: 1.2, armRX: 0.4, armLZ: -1.0, armRZ: 0.3 },
    { t: 1.0, twist: 1.45, tilt: LIE_TILT, kneeX: -0.7, hipX: 0.45, armLX: 1.3, armRX: 0.5, armLZ: -1.1, armRZ: 0.4, headZ: 0.5 },
  ] },
  // Leg shot: drops to the knees, hangs there a beat, then topples forward.
  kneel: { impact: 1.1, slide: 0.15, keys: [
    { t: 0.2, sink: 0.2, hipX: 0.5, kneeX: -0.9, torsoX: -0.2, armLX: 0.4, armRX: 0.4 },
    { t: 0.5, sink: 0.46, hipX: 0.1, kneeX: -1.6, torsoX: -0.3, headX: -0.4, armLX: 0.1, armRX: 0.2 },
    { t: 0.75, sink: 0.46, hipX: 0.12, kneeX: -1.6, torsoX: -0.35, headX: -0.5, tilt: 0.1, armLX: 0.1, armRX: 0.15 },
    { t: 1.1, tilt: LIE_TILT, sink: 0.25, hipX: 0.4, kneeX: -0.8, torsoX: -0.1, armLX: 2.0, armRX: 1.6, headZ: -0.5 },
    { t: 1.3, tilt: LIE_TILT, sink: 0.22, hipX: 0.35, kneeX: -0.7, torsoX: -0.1, armLX: 2.1, armRX: 1.7, headZ: -0.6 },
  ] },
  // Explosion: lifted and thrown along the blast, limbs flung, one bounce.
  blast: { impact: 0.7, slide: 2.0, keys: [
    { t: 0.12, tilt: 0.5, lift: 0.35, slide: 0.5, torsoX: 0.5, headX: 0.5, armLZ: -1.4, armRZ: 1.4, armLX: 1.2, hipX: -0.3, kneeX: -0.6 },
    { t: 0.4, tilt: 1.3, lift: 0.45, slide: 1.4, torsoX: 0.3, armLZ: -1.2, armRZ: 1.6, armLX: 1.8, armRX: 0.6, hipX: 0.3, kneeX: -0.9 },
    { t: 0.7, tilt: 1.55, lift: 0.0, slide: 1.85, armLX: 2.0, armRX: 1.2, armLZ: -1.0, armRZ: 1.1, hipX: 0.2, kneeX: -0.5 },
    { t: 0.85, tilt: LIE_TILT, lift: 0.14, slide: 1.95, armLX: 1.9, armRX: 1.3, armLZ: -1.1, armRZ: 1.2, hipX: 0.15, kneeX: -0.4 },
    { t: 1.0, tilt: LIE_TILT, lift: 0.0, slide: 2.0, armLX: 1.9, armRX: 1.3, armLZ: -1.1, armRZ: 1.2, hipX: 0.15, kneeX: -0.4, headZ: 0.5 },
  ] },
};
/** Blocked fall: turn the back to the wall and sit down against it. */
const SLUMP: { keys: Key[]; impact: number; slide: number } = { impact: 0.55, slide: 0.05, keys: [
  { t: 0.15, sink: 0.12, kneeX: -0.5, hipX: 0.4, headX: 0.3, torsoX: 0.1 },
  { t: 0.55, sink: 0.5, hipX: 1.45, kneeX: -1.3, torsoX: 0.18, headX: -0.3, armLX: 0.4, armRX: 0.5, armLZ: -0.3, armRZ: 0.3 },
  { t: 1.0, sink: 0.52, hipX: 1.5, kneeX: -1.1, torsoX: 0.12, headX: -0.55, headZ: 0.35, armLX: 0.3, armRX: 0.35, armLZ: -0.35, armRZ: 0.4 },
] };

export function deathDuration(variant: DeathVariant): number {
  const def = variant === 'slump' ? SLUMP : VARIANTS[variant];
  return def.keys[def.keys.length - 1].t;
}

/** Soldier forward vector for a yaw (models face −Z at yaw 0). */
export function forwardOf(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/**
 * Pick a death from zone, cause and where the shot travelled relative to facing.
 * `travel` is the horizontal unit direction the damage moved (shooter → victim).
 */
export function chooseDeath(zone: HitZone, explosive: boolean, yaw: number, travel: THREE.Vector3): DeathVariant {
  if (explosive) return 'blast';
  if (zone === 'head') return 'crumple';
  if (zone === 'limb') return 'kneel';
  const d = forwardOf(yaw, tmpA).dot(travel);
  // ±0.35 ≈ a 70° cone front/back; the remaining ~110° each side reads as a side hit.
  if (d < -0.35) return 'back';
  if (d > 0.35) return 'forward';
  return 'spin';
}

/** Is world point (x,y,z) inside any collision box? */
export function pointBlocked(solids: readonly AABB[], x: number, y: number, z: number): boolean {
  for (const b of solids) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y > b.minY && y < b.maxY) return true;
  return false;
}

/**
 * Free floor length along `dir` from `pos`, sampled at knee and chest height every
 * 0.2 m out to 2.4 m (a lying body plus a blast slide).
 */
export function freeLength(solids: readonly AABB[], pos: THREE.Vector3, dir: THREE.Vector3, max = 2.4): number {
  for (let s = 0.2; s <= max + 1e-6; s += 0.2) {
    const x = pos.x + dir.x * s, z = pos.z + dir.z * s;
    if (pointBlocked(solids, x, pos.y + 0.45, z) || pointBlocked(solids, x, pos.y + 1.1, z)) return s - 0.2;
  }
  return max;
}

export interface FallPlan { variant: DeathVariant; dir: THREE.Vector3; free: number; tiltCap: number; slideCap: number; twist: number }

/**
 * Resolve where the body can actually go. Prefer the variant's natural direction;
 * if a wall is in the way try both sides; with less than SLUMP_BELOW anywhere, sit
 * down against the wall. Tilt/slide are capped so the head stops short of geometry.
 */
export function planFall(variant: DeathVariant, natural: THREE.Vector3, yaw: number, pos: THREE.Vector3, solids: readonly AABB[]): FallPlan {
  const slideWanted = variant === 'slump' ? 0 : VARIANTS[variant].slide;
  const need = BODY_LENGTH + WALL_CLEARANCE + Math.min(slideWanted, 0.3);
  let dir = natural.clone().setY(0);
  if (dir.lengthSq() < 1e-6) dir = forwardOf(yaw).negate();
  dir.normalize();
  let free = freeLength(solids, pos, dir);
  if (free < need) {
    for (const sign of [1, -1]) {
      const side = new THREE.Vector3(-dir.z * sign, 0, dir.x * sign);
      const f = freeLength(solids, pos, side);
      if (f > free + 0.2) { free = f; dir = side; if (f >= need) break; }
    }
  }
  let twist = 0;
  if (free < SLUMP_BELOW) {
    // Back to the wall: yaw the body so it faces AWAY from the blocked direction.
    const want = Math.atan2(dir.x, dir.z); // yaw whose forward is −dir
    twist = wrapAngle(want - yaw);
    return { variant: 'slump', dir, free, tiltCap: 0, slideCap: 0, twist };
  }
  const slideCap = Math.max(0, Math.min(slideWanted, free - BODY_LENGTH - WALL_CLEARANCE));
  const reach = (free - WALL_CLEARANCE - slideCap) / BODY_LENGTH;
  const tiltCap = reach >= 1 ? Math.PI : Math.asin(Math.max(0, reach));
  return { variant, dir, free, tiltCap, slideCap, twist };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Smoothstep-interpolated pose at time `t` (seconds), starting from `from`. */
export function samplePose(variant: DeathVariant, t: number, from: Pose, out: Pose): Pose {
  const keys = (variant === 'slump' ? SLUMP : VARIANTS[variant]).keys;
  let prevT = 0; let prev: Partial<Pose> = from;
  for (const k of keys) {
    if (t <= k.t) {
      const f = Math.max(0, Math.min(1, (t - prevT) / Math.max(1e-4, k.t - prevT)));
      const s = f * f * (3 - 2 * f);
      for (const c of CHANNELS) { const a = prev[c] ?? ZERO[c], b = k[c] ?? ZERO[c]; out[c] = a + (b - a) * s; }
      return out;
    }
    prevT = k.t; prev = k;
  }
  const last = keys[keys.length - 1];
  for (const c of CHANNELS) out[c] = last[c] ?? ZERO[c];
  return out;
}

/* ============================== runtime ============================== */

/** Flinch envelope: 40 ms attack, then e^(−9t) — gone in ~0.35 s, a flick not a stagger. */
const FLINCH_ATTACK = 0.04;
const FLINCH_DECAY = 9;
const FLINCH_LIFE = 0.45;
/** Rifle drop physics: 9.81 m/s² gravity; bounces keep 30 % of vertical speed. */
const GRAVITY = 9.81;
const BOUNCE = 0.3;

const tmpA = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export interface DeathContext {
  pos: THREE.Vector3;            // feet position at death (root)
  yaw: number;
  surfaceY: number;              // floor height under the body (rifle lands here too)
  solids: readonly AABB[];
  dropWeapon: boolean;           // false: hide the rifle (defusal spawns its own pickup)
  onImpact?: (at: THREE.Vector3, heavy: boolean) => void;
  onClatter?: (at: THREE.Vector3) => void;
}

interface RifleDrop {
  obj: THREE.Object3D; parent: THREE.Object3D;
  homePos: THREE.Vector3; homeQuat: THREE.Quaternion;
  vel: THREE.Vector3; spin: THREE.Vector3; bounces: number; resting: boolean; floorY: number;
}

export class BodyReactions {
  variant: DeathVariant | null = null;
  plan: FallPlan | null = null;
  private t = 0;
  private from: Pose = { ...ZERO };
  private pose: Pose = { ...ZERO };
  private root = new THREE.Vector3();
  private yaw = 0;
  private impactAt = 0;
  private impacted = false;
  private settled = false;
  private ctx: DeathContext | null = null;
  private rifle: RifleDrop | null = null;
  private hiddenRifle: { obj: THREE.Object3D } | null = null;
  // flinch
  private flinchT = FLINCH_LIFE;
  private flinchZone: HitZone = 'torso';
  private flinchFront = 1;   // +1 shot from the front, −1 from behind
  private flinchSide = 0;    // −1..1 lateral component
  private flinchLeg = 1;     // which leg buckles

  get dying(): boolean { return this.variant !== null && !this.settled; }
  get isSettled(): boolean { return this.settled; }
  get droppedRifle(): THREE.Object3D | null { return this.rifle?.obj ?? null; }

  /** Offsets added last frame on channels the alive pose doesn't reset (see applyFlinch). */
  private readonly applied = { ty: 0, tz: 0, hz: 0 };

  /** Directional, zone-aware hit flinch (additive on the live pose). */
  hit(zone: HitZone, travel: THREE.Vector3 | null, yaw: number) {
    this.flinchT = 0;
    this.flinchZone = zone;
    if (travel && travel.lengthSq() > 1e-6) {
      const fwd = forwardOf(yaw, tmpA);
      this.flinchFront = fwd.dot(travel) < 0 ? 1 : -1;
      // right vector of a −Z-facing body is (cos yaw, 0, −sin yaw)
      this.flinchSide = Math.cos(yaw) * travel.x - Math.sin(yaw) * travel.z;
    } else { this.flinchFront = 1; this.flinchSide = 0; }
    this.flinchLeg = Math.random() < 0.5 ? 1 : -1;
  }

  /** Current flinch weight (0..1). Exported for tests. */
  flinchWeight(): number {
    const t = this.flinchT;
    if (t >= FLINCH_LIFE) return 0;
    return t < FLINCH_ATTACK ? t / FLINCH_ATTACK : Math.exp(-(t - FLINCH_ATTACK) * FLINCH_DECAY);
  }

  /** Call at the END of the alive pose update: adds the flinch on top of it. */
  applyFlinch(dt: number, p: SoldierModel['parts']) {
    // torso.y / torso.z / head.z are not re-assigned every frame by the alive pose
    // code (tdm.ts never touches them; ai.ts only eases torso.z), so a plain `+=`
    // would accumulate into a permanent twist. Undo last frame's offset first.
    p.torso.rotation.y -= this.applied.ty; p.torso.rotation.z -= this.applied.tz; p.head.rotation.z -= this.applied.hz;
    this.applied.ty = this.applied.tz = this.applied.hz = 0;
    if (this.flinchT >= FLINCH_LIFE) return;
    this.flinchT += dt;
    const w = this.flinchWeight();
    if (w <= 0) return;
    const r0y = p.torso.rotation.y, r0z = p.torso.rotation.z, h0z = p.head.rotation.z;
    if (this.flinchZone === 'head') {
      p.head.rotation.x += 0.5 * w;                       // snap back
      p.head.rotation.z += 0.25 * w * this.flinchSide;
      p.torso.rotation.x += 0.1 * w;
    } else if (this.flinchZone === 'limb') {
      const leg = this.flinchLeg > 0 ? p.rLeg : p.lLeg, shin = this.flinchLeg > 0 ? p.rShin : p.lShin;
      leg.rotation.x += 0.45 * w; shin.rotation.x -= 0.6 * w; // knee buckles
      p.torso.rotation.x -= 0.12 * w;
      p.torso.rotation.z += 0.12 * w * this.flinchLeg;
    } else {
      p.torso.rotation.x += 0.28 * w * this.flinchFront;  // punched back / shoved forward
      p.torso.rotation.y += 0.35 * w * this.flinchSide;   // twist away from a side hit
      p.head.rotation.x += 0.15 * w * this.flinchFront;
    }
    this.applied.ty = p.torso.rotation.y - r0y; this.applied.tz = p.torso.rotation.z - r0z; this.applied.hz = p.head.rotation.z - h0z;
  }

  /** Begin the death. `info.from` defaults to "in front of the victim". */
  die(model: SoldierModel, info: HitInfo, ctx: DeathContext) {
    const zone = info.zone ?? 'torso';
    const travel = new THREE.Vector3();
    if (info.from) travel.set(ctx.pos.x - info.from.x, 0, ctx.pos.z - info.from.z);
    if (travel.lengthSq() < 1e-6) forwardOf(ctx.yaw, travel).negate();
    travel.normalize();
    const natural = chooseDeath(zone, !!info.explosive, ctx.yaw, travel);
    // Kneel/crumple fold over the body's own front; everything else goes with the shot.
    const naturalDir = natural === 'kneel' ? forwardOf(ctx.yaw) : travel.clone();
    const plan = planFall(natural, naturalDir, ctx.yaw, ctx.pos, ctx.solids);
    // spin: the keyed twist is multiplied by ±1 so the body turns with the shot's
    // lateral push (a hit travelling to the body's right spins it clockwise).
    if (plan.variant === 'spin') {
      const side = Math.cos(ctx.yaw) * travel.x - Math.sin(ctx.yaw) * travel.z;
      plan.twist = side >= 0 ? -1 : 1;
    }
    this.plan = plan;
    this.variant = plan.variant;
    this.ctx = ctx;
    this.t = 0; this.impacted = false; this.settled = false;
    this.impactAt = (plan.variant === 'slump' ? SLUMP : VARIANTS[plan.variant]).impact;
    this.root.copy(ctx.pos);
    this.yaw = ctx.yaw;
    this.flinchT = FLINCH_LIFE; this.applied.ty = this.applied.tz = this.applied.hz = 0;
    // Blend from whatever the soldier was doing (aiming, running) instead of popping.
    const p = model.parts;
    this.from = { ...ZERO, torsoX: p.torso.rotation.x, torsoZ: p.torso.rotation.z, headX: p.head.rotation.x, headZ: p.head.rotation.z,
      armLX: p.lArm.rotation.x, armLZ: p.lArm.rotation.z, armRX: p.rArm.rotation.x, armRZ: p.rArm.rotation.z,
      hipX: (p.lLeg.rotation.x + p.rLeg.rotation.x) / 2, kneeX: (p.lShin.rotation.x + p.rShin.rotation.x) / 2 };
    p.torso.rotation.y = 0; p.lArm.rotation.y = 0; p.rArm.rotation.y = 0;
    this.startRifle(model, travel, ctx);
    this.applyPose(model);
  }

  private startRifle(model: SoldierModel, travel: THREE.Vector3, ctx: DeathContext) {
    const obj = model.parts.rifle;
    const parent = obj.parent;
    const scene = model.group.parent;
    if (!parent) return;
    if (!ctx.dropWeapon || !scene) {
      obj.visible = false;
      this.hiddenRifle = { obj };
      return;
    }
    const drop: RifleDrop = {
      obj, parent, homePos: obj.position.clone(), homeQuat: obj.quaternion.clone(),
      // Falls out of the hands with the body's momentum plus a small toss.
      vel: new THREE.Vector3(travel.x * 1.1 + (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.6, travel.z * 1.1 + (Math.random() - 0.5) * 0.6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 7),
      bounces: 0, resting: false, floorY: ctx.surfaceY + 0.035,
    };
    model.group.updateMatrixWorld(true);
    scene.attach(obj);
    this.rifle = drop;
  }

  /**
   * Advance the death. Returns true while anything is still moving; false once the
   * body and rifle are settled (callers may skip further calls — zero cost).
   */
  update(dt: number, model: SoldierModel): boolean {
    if (!this.variant || this.settled) {
      if (this.rifle) this.rifle.obj.visible = model.group.visible;
      return false;
    }
    this.t += dt;
    this.applyPose(model);
    if (!this.impacted && this.t >= this.impactAt) {
      this.impacted = true;
      this.ctx?.onImpact?.(tmpA.copy(model.group.position), this.variant === 'blast');
    }
    const rifleMoving = this.updateRifle(dt, model);
    if (this.t >= deathDuration(this.variant) && !rifleMoving) this.settled = true;
    return !this.settled;
  }

  private applyPose(model: SoldierModel) {
    const plan = this.plan!, pose = samplePose(this.variant!, this.t, this.from, this.pose);
    const def = this.variant === 'slump' ? SLUMP : VARIANTS[this.variant!];
    // Tilt never exceeds what the free floor allows (head stops short of walls).
    const tilt = Math.min(pose.tilt, plan.tiltCap);
    // Blast keys author their own slide arc; the rest ease their small shove in over 0.6 s.
    const slide = Math.min(this.variant === 'blast' ? pose.slide : def.slide * Math.min(1, this.t / 0.6), plan.slideCap);
    // Slump turns the back to the wall; spin's keyed twist is signed by plan.twist (±1).
    const twist = this.variant === 'slump' ? plan.twist * Math.min(1, this.t / 0.45) : this.variant === 'spin' ? pose.twist * plan.twist : 0;
    const g = model.group;
    const axis = tmpA.crossVectors(UP, plan.dir).normalize();
    tmpQ.setFromAxisAngle(axis, tilt);
    tmpQ2.setFromAxisAngle(UP, this.yaw + twist);
    g.quaternion.multiplyQuaternions(tmpQ, tmpQ2);
    const lieLift = LIE_LIFT * Math.max(0, Math.sin(tilt));
    g.position.set(this.root.x + plan.dir.x * slide, this.root.y - pose.sink + pose.lift + lieLift, this.root.z + plan.dir.z * slide);
    const p = model.parts;
    p.torso.rotation.x = pose.torsoX; p.torso.rotation.z = pose.torsoZ;
    p.head.rotation.x = pose.headX; p.head.rotation.z = pose.headZ;
    p.lArm.rotation.x = pose.armLX; p.lArm.rotation.z = pose.armLZ;
    p.rArm.rotation.x = pose.armRX; p.rArm.rotation.z = pose.armRZ;
    // Legs differ slightly so the pair never mirrors perfectly (reads as limp, not posed).
    p.lLeg.rotation.x = pose.hipX * 1.08; p.rLeg.rotation.x = pose.hipX * 0.9;
    p.lShin.rotation.x = pose.kneeX * 0.92; p.rShin.rotation.x = pose.kneeX * 1.06;
  }

  private updateRifle(dt: number, model: SoldierModel): boolean {
    const r = this.rifle;
    if (!r) return false;
    r.obj.visible = model.group.visible;
    if (r.resting) return false;
    r.vel.y -= GRAVITY * dt;
    r.obj.position.addScaledVector(r.vel, dt);
    tmpQ.setFromEuler(tmpE.set(r.spin.x * dt, r.spin.y * dt, r.spin.z * dt, 'XYZ'));
    r.obj.quaternion.multiply(tmpQ);
    if (r.obj.position.y <= r.floorY && r.vel.y < 0) {
      r.obj.position.y = r.floorY;
      if (r.bounces === 0) this.ctx?.onClatter?.(r.obj.position);
      r.bounces++;
      r.vel.y = -r.vel.y * BOUNCE; r.vel.x *= 0.5; r.vel.z *= 0.5; r.spin.multiplyScalar(0.35);
      if (r.bounces >= 2 || Math.abs(r.vel.y) < 0.4) {
        // Lie on its side, keeping only the heading it tumbled to.
        const heading = tmpE.setFromQuaternion(r.obj.quaternion, 'YXZ').y;
        r.obj.quaternion.setFromEuler(tmpE.set(0, heading, Math.PI / 2, 'YXZ'));
        r.resting = true;
        return false;
      }
    }
    return true;
  }

  /** Respawn / pool reuse: put the rifle back in the hands and clear all state. */
  reset(model: SoldierModel) {
    if (this.rifle) {
      const r = this.rifle;
      r.parent.add(r.obj);
      r.obj.position.copy(r.homePos); r.obj.quaternion.copy(r.homeQuat); r.obj.visible = true;
      this.rifle = null;
    }
    if (this.hiddenRifle) { this.hiddenRifle.obj.visible = true; this.hiddenRifle = null; }
    const p = model.parts;
    for (const part of [p.torso, p.head, p.lArm, p.rArm, p.lLeg, p.rLeg, p.lShin, p.rShin]) part.rotation.set(0, 0, 0);
    model.group.rotation.set(0, model.group.rotation.y, 0);
    this.variant = null; this.plan = null; this.ctx = null; this.settled = false; this.t = 0;
    this.flinchT = FLINCH_LIFE; this.applied.ty = this.applied.tz = this.applied.hz = 0;
  }
}

/** Shared helper: floor height under a body (top of a crate/slab it died on, else ground). */
export function surfaceUnder(pos: THREE.Vector3, solids: readonly AABB[], ground: number): number {
  let surfaceY = ground;
  for (const b of solids) {
    if (b.maxY > pos.y + 0.4 || b.maxY <= surfaceY) continue;
    if (pos.x > b.minX - 0.3 && pos.x < b.maxX + 0.3 && pos.z > b.minZ - 0.3 && pos.z < b.maxZ + 0.3) surfaceY = b.maxY;
  }
  return surfaceY;
}
