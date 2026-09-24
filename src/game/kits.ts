// ============================================================================
// Recoil FPS — FIELD KITS: one tactical ability per operator, on a cooldown.
//
// Kits are bought once in the KITS menu and equipped there; the equipped kit is
// locked for the whole deployment (no mid-match swapping) and arrives HALF charged,
// so nobody opens a match with a free ability.
//   RECON   · Sonar Dart  — thrown sensor: three pulses tag hostiles through walls as
//                           full-body silhouettes; tagged hostiles take +10 % damage.
//                           The ping is loud — close hostiles come to investigate.
//   BULWARK · Barricade   — folding steel shield that stops bullets, sight-lines and
//                           AI pathing both ways. Press Z beside it to recall it and
//                           bank part of the cooldown back.
//   PHANTOM · Holo-Decoy  — a hologram that runs ahead firing blanks; hostiles who
//                           see it shoot it instead of you. When it dies it bursts,
//                           stunning everyone standing close to it.
//
// The director is mode-agnostic in the same way the scorestreak director is: it talks
// to the engine only through `KitContext`, so missions and Warehouse TDM share every
// line of it. The AI side (mission `Enemy`, TDM `TDMBot`) sees kits through two tiny
// hooks: `KitLure` (who to shoot instead of the player) and `userData.kitHit` on
// barricade plates (bullets that strike it damage it).
// ============================================================================
import * as THREE from 'three';
import type { Effects } from './effects';
import type { AABB } from './world';
import { audio } from './audio';
import {
  buildBarricade, buildDart, buildDecoy, buildTagGhost, disposeDartFx, disposeDecoy, disposeKitObject,
  makeSonarMarkerMaterial, type BarricadeModel, type DartModel, type DecoyModel, type TagGhost,
} from './kit-models';
import { KIT_IDS, KIT_PRICES, isKitId, type KitId } from './economy/kit-shop';

export { KIT_IDS, KIT_PRICES, isKitId, type KitId };
export const KIT_KEY = 'Z';

// --------------------------------------------------------------- tuning ----
// Every number here was set against the existing combat model:
//   * mission hostile hit = 7–14 dmg (avg 10.5), TDM bot hit = 18–24 (avg 21);
//   * a TDM match is 150 s with a 5 s respawn; a mission phase runs 60–120 s;
//   * the UAV streak (400 pts ≈ 4 kills) paints the whole map for 30 s.
// Kits must be worth pressing every fight but never replace a streak. Playtest
// feedback on the first pass: kills refunded the kit in a few seconds, so the
// cooldowns went up by ~50 % and kill refunds went from 20 % to 8 % with a cap.
export const KIT_TUNING = {
  recon: {
    /** 45 s: ~3 darts per 150 s TDM match — intel you plan around, not spam. */
    cooldown: 45,
    /** Throw speed m/s: a 25 m flat throw lands in ~1 s, far enough to clear a courtyard. */
    throwSpeed: 26,
    /** Fin-stabilised: falls at 55 % of g so the dart flies flatter than a frag. */
    gravityScale: 0.55,
    /** Flight time cap before the dart is considered spent where it lies. */
    maxFlight: 2.5,
    /** First ping fires shortly after impact so a thrown dart pays off inside one peek. */
    firstPulse: 0.4,
    pulses: 3,
    pulseEvery: 2.5,
    /** Tag radius: one courtyard / warehouse bay. Larger than the radar's 22 m always-on ring. */
    radius: 24,
    /** A tag lasts slightly longer than the pulse gap so coverage is continuous for ~8 s. */
    revealFor: 3.2,
    /** The ping is audible: hostiles this close walk over to find the dart (the risk). */
    hearRadius: 14,
    /**
     * Tagged hostiles take +10 % damage from the player. Enough to turn a 5-hit mission
     * kill into 4 at the margin, never enough to change headshot maths — it rewards
     * pushing on intel instead of just reading it.
     */
    markDamageMul: 1.1,
  },
  bulwark: {
    /** 60 s: the wall lives 24 s of it, and a recall can bank up to half back. */
    cooldown: 60,
    life: 24,
    /**
     * 450 HP ≈ 43 mission hits or ≈ 21 TDM hits — two hostiles focusing it break it
     * in ~6–8 s, a frag (260 at the centre) plus a burst breaks it faster. Long enough
     * to reload or hold a lane, short enough that holding it forever is impossible.
     */
    hp: 450,
    /** 2.4 m covers a crouched player plus a lean on either side. */
    width: 2.4,
    /**
     * 1.4 m: a crouched eye (1.22 m) is fully covered from an AI eye at 1.62 m, a standing
     * eye (1.62 m) is exposed. Crouch to be safe, stand to shoot over — the decision.
     */
    height: 1.4,
    depth: 0.12,
    /** Collision slab depth (includes the kick-stands) for player/AI movement. */
    collideDepth: 0.34,
    /** Planted this far ahead of the feet: close enough to duck behind in one step. */
    placeDist: 1.7,
    /** Frag splash vs the wall: full at the centre, falling to 40 % at the edge. */
    blastDamage: 260,
    /** Recall needs the player within 3.5 m of the wall — two steps, so it's a choice to walk back. */
    recallRange: 3.5,
    /**
     * Recall refund: 50 % of the full cooldown × remaining integrity. An untouched wall
     * picked up at once returns 30 s; a half-broken one returns 15 s. Moving the wall is
     * cheaper than replanting it, but never free.
     */
    recallRefund: 0.5,
    /** Unfold / fold animation lengths (s). The blocker is live from the first frame. */
    unfold: 0.38,
    fold: 0.3,
  },
  phantom: {
    /** 50 s: a decoy wins one fight, and the burst can win a second one. */
    cooldown: 50,
    life: 10,
    /** 120 HP ≈ one TDM bot burst (6 hits) or 11 mission hits — it soaks a volley, not a war. */
    hp: 120,
    /** Jog speed of a real operator carrying a rifle (player sprint is ≈ 6.5 m/s). */
    speed: 3.6,
    /** Runs for 2.6 s (≈ 9 m) then holds and fires — far enough to pull aim off you. */
    runFor: 2.6,
    /** Hostiles with eyes on it inside this range target it instead of you. */
    lureRadius: 32,
    /** Blank fire is heard this far away (a suppressed rifle is 30 m, an open one 65 m). */
    noiseRadius: 28,
    /** Blank bursts: 0.55–1.1 s apart reads like a rifleman pacing shots. */
    fireMin: 0.55,
    fireMax: 1.1,
    /** While holding it weaves sideways at 1.4 m/s over ±0.8 m, like a rifleman strafing. */
    strafeSpeed: 1.4,
    strafeRange: 0.8,
    /**
     * Glitch burst when the decoy dies (shot down OR timed out): hostiles within 6 m are
     * stunned for 1.6 s. 6 m is inside the distance hostiles close to when they push a
     * target; 1.6 s is just under a flashbang so the frag/flash economy stays on top.
     */
    burstRadius: 6,
    burstStun: 1.6,
    /** Materialise animation (s): the decoy can be targeted from the first frame anyway. */
    materialize: 0.35,
  },
  /** Every kill knocks 8 % of the full cooldown off (3.6 s on Recon)… */
  killRefund: 0.08,
  /** …but no more than 30 % of one cooldown per charge, so a multi-kill can't chain kits. */
  refundCap: 0.3,
  /** Kits deploy 50 % charged: the first use comes 22–30 s in, never at the spawn. */
  deployCharge: 0.5,
} as const;

export interface KitDef {
  id: KitId;
  name: string;
  ability: string;
  role: string;
  blurb: string;
  /** One-line rule shown on menu cards and in the pause reference. */
  rule: string;
  /** Short bullet points: how the ability plays, in order of use. */
  steps: string[];
  cooldown: number;
  price: number;
  /** Menu stat bars: 0..1 against the three kits. */
  stats: { label: string; value: string; bar: number }[];
}

// Player-facing names are plain words: the kit IS the thing it deploys. (`ability`
// equals `name` so every "… READY" / "… RECHARGING" message reads naturally.)
export const KIT_DEFS: Record<KitId, KitDef> = {
  recon: {
    id: 'recon', name: 'Radar', ability: 'Radar', role: 'Intel',
    blurb: 'Throw a small radar unit. It sets itself up and shows every enemy within 24 m through walls.',
    rule: 'Enemies it finds take 10% more damage. It is loud — enemies within 14 m will come to check it out.',
    steps: ['Throw it into the room before you go in.', 'It scans 3 times and shows enemies through walls.', 'Push while they are marked: +10% damage.'],
    cooldown: KIT_TUNING.recon.cooldown,
    price: KIT_PRICES.recon,
    stats: [
      { label: 'RANGE', value: '24 m', bar: 0.8 },
      { label: 'SHOWS ENEMIES', value: '≈8 s', bar: 0.55 },
      { label: 'COOLDOWN', value: '45 s', bar: 0.45 },
    ],
  },
  bulwark: {
    id: 'bulwark', name: 'Barricade', ability: 'Barricade', role: 'Cover',
    blurb: 'Drop a folding steel shield in front of you. It stops bullets and blocks the way.',
    rule: 'Crouch behind it to stay safe, stand up to shoot over it. 450 HP. Press Z next to it to pick it back up.',
    steps: ['Look at open ground and press Z.', 'Crouch to hide, stand to shoot over it.', 'Walk up to it and press Z to pick it up.'],
    cooldown: KIT_TUNING.bulwark.cooldown,
    price: KIT_PRICES.bulwark,
    stats: [
      { label: 'HEALTH', value: '450 HP', bar: 1 },
      { label: 'LASTS', value: '24 s', bar: 0.9 },
      { label: 'COOLDOWN', value: '60 s', bar: 0.25 },
    ],
  },
  phantom: {
    id: 'phantom', name: 'Decoy', ability: 'Decoy', role: 'Distraction',
    blurb: 'Send out a fake soldier that runs ahead and fires blanks. Enemies who see it shoot at it instead of you.',
    rule: 'Works on enemies within 32 m who can see it. When it is destroyed it stuns enemies within 6 m.',
    steps: ['Aim down a lane and press Z.', 'Flank them while they shoot at it.', 'When it breaks, anyone close gets stunned.'],
    cooldown: KIT_TUNING.phantom.cooldown,
    price: KIT_PRICES.phantom,
    stats: [
      { label: 'RANGE', value: '32 m', bar: 0.9 },
      { label: 'STUN', value: '6 m', bar: 0.6 },
      { label: 'COOLDOWN', value: '50 s', bar: 0.35 },
    ],
  },
};

/**
 * Chance that a lured hostile hit by the player drops the decoy and turns on the real
 * shooter. 50 %: shooting from behind your decoy is strong but not free.
 */
export const KIT_LURE_BREAK_CHANCE = 0.5;

export function kitDef(id: KitId): KitDef { return KIT_DEFS[id]; }

// ----------------------------------------------------------- pure logic ----

/** Cooldown meter. Pure: no time source, the caller ticks it. */
export class KitCharge {
  left: number;
  /** Fraction of a cooldown refunded since the last spend (capped by `refundCap`). */
  refunded = 0;
  constructor(public cooldown: number, startCharge = 1) {
    this.left = cooldown * (1 - Math.max(0, Math.min(1, startCharge)));
  }
  get ready(): boolean { return this.left <= 0; }
  /** 0 = just spent, 1 = ready. */
  get pct(): number { return this.cooldown <= 0 ? 1 : 1 - Math.max(0, Math.min(1, this.left / this.cooldown)); }
  tick(dt: number) { if (dt > 0) this.left = Math.max(0, this.left - dt); }
  spend(): boolean {
    if (!this.ready) return false;
    this.left = this.cooldown;
    this.refunded = 0;
    return true;
  }
  /**
   * Knock a fraction of the FULL cooldown off (kill refund). With a cap, the total
   * refunded this charge never exceeds `cap` of a cooldown. Never goes below ready.
   */
  refund(fraction: number, cap = Infinity) {
    if (fraction <= 0 || this.ready) return;
    const allowed = Math.max(0, Math.min(fraction, cap - this.refunded));
    if (allowed <= 0) return;
    this.refunded += allowed;
    this.left = Math.max(0, this.left - this.cooldown * allowed);
  }
  /** Uncapped time bank (barricade recall). */
  bank(seconds: number) { if (seconds > 0) this.left = Math.max(0, this.left - seconds); }
}

/** Snap a horizontal direction to the nearest cardinal axis. */
export function snapCardinal(dx: number, dz: number): { x: number; z: number } {
  if (Math.abs(dx) >= Math.abs(dz)) return { x: dx >= 0 ? 1 : -1, z: 0 };
  return { x: 0, z: dz >= 0 ? 1 : -1 };
}

/**
 * Where a barricade goes. It snaps to the nearest cardinal facing so its collision is
 * an exact axis-aligned box (the whole collision stack is AABB-based), planted
 * `placeDist` ahead of the feet with its face toward the look direction.
 */
export function barricadePlacement(feet: { x: number; y: number; z: number }, dir: { x: number; z: number },
  cfg: { placeDist: number; width: number; height: number; collideDepth: number } = KIT_TUNING.bulwark) {
  const f = snapCardinal(dir.x, dir.z);
  const cx = feet.x + f.x * cfg.placeDist, cz = feet.z + f.z * cfg.placeDist;
  // Local -Z of the model must point along f: rotation θ maps -Z to (-sin θ, -cos θ).
  const yaw = Math.atan2(-f.x, -f.z);
  const alongX = f.z !== 0; // facing ±Z → wall spans X
  const hw = cfg.width / 2, hd = cfg.collideDepth / 2;
  const box: AABB = alongX
    ? { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd, minY: feet.y, maxY: feet.y + cfg.height }
    : { minX: cx - hd, maxX: cx + hd, minZ: cz - hw, maxZ: cz + hw, minY: feet.y, maxY: feet.y + cfg.height };
  return { center: { x: cx, y: feet.y, z: cz }, yaw, facing: f, box };
}

/** Recall refund in seconds for a wall at `hpFrac` integrity (pure). */
export function recallRefundSeconds(hpFrac: number, cfg: { cooldown: number; recallRefund: number } = KIT_TUNING.bulwark): number {
  return cfg.cooldown * cfg.recallRefund * Math.max(0, Math.min(1, hpFrac));
}

/** Which of `points` a sonar pulse at `center` tags (3-D distance, walls ignored — it is sonar). */
export function sonarTagged<T extends { pos: { x: number; y: number; z: number } }>(center: { x: number; y: number; z: number }, radius: number, points: T[]): T[] {
  const r2 = radius * radius;
  return points.filter(p => {
    const dx = p.pos.x - center.x, dy = p.pos.y - center.y, dz = p.pos.z - center.z;
    return dx * dx + dy * dy + dz * dz <= r2;
  });
}

/** Hostiles caught by a decoy burst at `center` (flat 2-D radius, walls ignored — it's an EMP pulse). */
export function burstVictims<T extends { pos: { x: number; z: number } }>(center: { x: number; z: number }, radius: number, points: T[]): T[] {
  return points.filter(p => Math.hypot(p.pos.x - center.x, p.pos.z - center.z) <= radius);
}

/** Anything a hostile can be tricked into shooting at. */
export interface KitLure {
  /** Aim point (chest/eye height). Live vector — read, never mutate. */
  eye: THREE.Vector3;
  /** Ground position. Live vector — read, never mutate. */
  feet: THREE.Vector3;
  active(): boolean;
  /** A hostile round landed on it. */
  hit(amount: number): void;
}

/**
 * The lure a hostile at `eye` locks onto: the nearest active lure inside `radius`
 * that it can actually see. Pure given the visibility predicate.
 */
export function chooseLure(eye: THREE.Vector3, lures: KitLure[], radius: number, visible: (from: THREE.Vector3, to: THREE.Vector3) => boolean): KitLure | null {
  let best: KitLure | null = null, bestD = radius;
  for (const l of lures) {
    if (!l.active()) continue;
    const d = eye.distanceTo(l.eye);
    if (d > bestD) continue;
    if (!visible(eye, l.eye)) continue;
    best = l; bestD = d;
  }
  return best;
}

// -------------------------------------------------------------- context ----

export interface KitHostile {
  /** Stable identity (the Enemy / TDMBot object) — reveal tags are keyed on it. */
  ref: object;
  pos: THREE.Vector3;
  alive(): boolean;
  /** Disorient for `seconds` (decoy burst). Optional so plain test doubles stay tiny. */
  stun?(seconds: number): void;
  /** Crouched right now (the sonar silhouette drops to crouch height). */
  crouched?(): boolean;
}

/** Screen/camera feedback the engine turns into a HUD overlay and camera shake. */
export type KitFxKind = 'ping' | 'slam' | 'recall' | 'decoy' | 'burst' | 'break' | 'ready';

export interface KitContext {
  scene: THREE.Scene;
  effects: Effects;
  /** Live world occluder list — barricade plates are pushed in/out of it. */
  occluders: THREE.Object3D[];
  groundHeight(x: number, z: number): number;
  playerFeet(): THREE.Vector3;
  playerEye(): THREE.Vector3;
  playerDir(): THREE.Vector3;
  playerAlive(): boolean;
  hostiles(): KitHostile[];
  /** Is this footprint clear of world solids and of the player's own capsule? */
  canPlaceBox(box: AABB): boolean;
  /** Add/remove a movement blocker; the engine refreshes its collision grid and hittables. */
  addBlocker(box: AABB): void;
  removeBlocker(box: AABB): void;
  /** Slide a ground actor with world collision (the AI mover). Sets pos.y to the support. */
  moveCollide(pos: THREE.Vector3, dx: number, dz: number, radius: number): void;
  /** Make noise at a point: hostiles in the radius investigate it. */
  alertAt(pos: THREE.Vector3, radius: number): void;
  announce(text: string, spoken?: string): void;
  /** Optional HUD / camera feedback (overlay flash, shake). */
  feedback?(kind: KitFxKind, at?: THREE.Vector3): void;
}

export interface KitLiveHud { kind: 'dart' | 'barricade' | 'decoy'; label: string; timeLeft: number; total: number; detail?: string; health?: number }

export interface KitHud {
  id: KitId;
  name: string;
  ability: string;
  key: string;
  ready: boolean;
  /** 0..1 charge. */
  pct: number;
  cooldownLeft: number;
  cooldown: number;
  live: KitLiveHud[];
  /** Hostiles currently sonar-tagged. */
  tagged: number;
  /** Show the onboarding prompt (early in the deployment and never used yet). */
  hint: boolean;
  /** Bulwark: standing next to your wall — Z recalls it. */
  recall: boolean;
  /** Bumps each time the kit becomes ready / is used — drives HUD burst animations. */
  readyEpoch: number;
  useEpoch: number;
  blurb: string;
  rule: string;
}

const ray = new THREE.Raycaster();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const easeOutBack = (k: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

// ---------------------------------------------------------------- dart ----
class SonarDart {
  model: DartModel;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  stuck = false;
  flight = 0;
  sinceStick = 0;
  pulsesFired = 0;
  private ringT = -1;
  done = false;

  constructor(private ctx: KitContext, private dir: KitDirector, from: THREE.Vector3, aim: THREE.Vector3) {
    const T = KIT_TUNING.recon;
    this.model = buildDart();
    this.pos = from.clone();
    this.vel = aim.clone().normalize().multiplyScalar(T.throwSpeed);
    this.model.group.position.copy(this.pos);
    this.orient(this.vel);
    ctx.scene.add(this.model.group, this.model.ring, this.model.echo, this.model.dome, this.model.beam);
  }

  private spin = 2.2;

  private orient(d: THREE.Vector3) {
    this.model.group.rotation.set(0, Math.atan2(-d.x, -d.z), 0);
  }

  static readonly LIFE = KIT_TUNING.recon.firstPulse + KIT_TUNING.recon.pulseEvery * (KIT_TUNING.recon.pulses - 1) + 0.8;

  get timeLeft(): number {
    if (!this.stuck) return SonarDart.LIFE;
    return Math.max(0, SonarDart.LIFE - this.sinceStick);
  }

  update(dt: number) {
    const T = KIT_TUNING.recon;
    if (!this.stuck) {
      this.flight += dt;
      this.vel.y -= 9.8 * T.gravityScale * dt;
      const step = tmpB.copy(this.vel).multiplyScalar(dt);
      const len = step.length();
      ray.set(this.pos, step.clone().normalize()); ray.far = len + 0.05;
      const hit = ray.intersectObjects(this.ctx.occluders, false)[0];
      const n = hit?.face ? tmpC.copy(hit.face.normal).transformDirection(hit.object.matrixWorld) : null;
      if (hit && n && n.y > 0.6) {
        // Landed on top of something (crate, roof, barricade): deploy right there.
        this.pos.copy(hit.point);
        this.stick();
      } else if (hit) {
        // Hit a wall: drop straight down the face and deploy on the ground below.
        this.pos.copy(hit.point).addScaledVector(step.normalize(), -0.12);
        this.vel.x = 0; this.vel.z = 0; this.vel.y = Math.min(0, this.vel.y);
      } else {
        this.pos.add(step);
        const g = this.ctx.groundHeight(this.pos.x, this.pos.z);
        if (this.pos.y <= g) { this.pos.y = g; this.stick(); }
        else if (this.flight >= T.maxFlight) { this.pos.y = g; this.stick(); }
      }
      this.model.group.position.copy(this.pos);
      // Folded unit tumbles end over end in flight.
      if (!this.stuck) this.model.group.rotation.set(this.flight * 9, this.model.group.rotation.y, this.flight * 4);
      return;
    }
    this.sinceStick += dt;
    // Unfold over 0.35 s: legs swing out, mast telescopes up; the dish spins, faster on a pulse.
    this.model.setDeploy(this.sinceStick / 0.35);
    this.spin = Math.max(2.2, this.spin - dt * 6);
    this.model.dish.rotation.y += dt * this.spin;
    const due = T.firstPulse + this.pulsesFired * T.pulseEvery;
    if (this.pulsesFired < T.pulses && this.sinceStick >= due) this.pulse();
    // LED blinks faster as the last pulse approaches
    const led = this.model.led.material as THREE.MeshStandardMaterial;
    led.emissiveIntensity = 1.2 + (Math.sin(this.sinceStick * (8 + this.pulsesFired * 4)) > 0 ? 1.6 : 0);
    // Beacon beam: breathes while the dart is live, fades over its last 0.8 s.
    const beam = this.model.beam;
    const fade = Math.min(1, this.timeLeft / 0.8);
    (beam.material as THREE.MeshBasicMaterial).opacity = (0.16 + 0.1 * Math.sin(this.sinceStick * 6)) * fade;
    if (this.ringT >= 0) {
      // One pulse = main ring + echo ring 0.12 s behind + wire dome, all over 0.8 s.
      this.ringT += dt;
      const k = Math.min(1, this.ringT / 0.8);
      const e = 1 - Math.pow(1 - k, 2.2);
      const r = Math.max(0.05, e * T.radius);
      this.model.ring.scale.set(r, r, r);
      (this.model.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      const ke = Math.max(0, Math.min(1, (this.ringT - 0.12) / 0.8));
      const re = Math.max(0.05, (1 - Math.pow(1 - ke, 2.2)) * T.radius);
      this.model.echo.scale.set(re, re, re);
      (this.model.echo.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - ke) * (ke > 0 ? 1 : 0);
      const dr = Math.max(0.05, e * T.radius);
      this.model.dome.scale.set(dr, dr * 0.55, dr);
      (this.model.dome.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - k);
      if (this.ringT >= 0.92) {
        this.ringT = -1;
        this.model.ring.visible = this.model.echo.visible = this.model.dome.visible = false;
      }
    }
    // Retire once the last ring has finished expanding.
    if (this.pulsesFired >= T.pulses && this.timeLeft <= 0) this.done = true;
  }

  private stick() {
    this.stuck = true;
    this.vel.set(0, 0, 0);
    // Stand upright wherever it came to rest.
    const g0 = this.model.group;
    g0.rotation.set(0, g0.rotation.y, 0);
    g0.position.copy(this.pos);
    audio.dartStick(this.pos.x, this.pos.y, this.pos.z);
    this.model.beam.position.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    this.model.beam.visible = true;
  }

  private pulse() {
    const T = KIT_TUNING.recon;
    this.pulsesFired++;
    this.ringT = 0;
    this.spin = 14;
    const g = this.pos.y + 0.08;
    for (const o of [this.model.ring, this.model.echo]) { o.visible = true; o.position.set(this.pos.x, g, this.pos.z); o.scale.setScalar(0.05); }
    this.model.dome.visible = true;
    this.model.dome.position.set(this.pos.x, g, this.pos.z);
    this.model.dome.scale.setScalar(0.05);
    const alive = this.ctx.hostiles().filter(h => h.alive());
    const tagged = sonarTagged(this.pos, T.radius, alive);
    for (const h of tagged) this.dir.tag(h.ref, T.revealFor);
    this.dir.pulseFlash();
    audio.sonarPing(this.pos.x, this.pos.y, this.pos.z, this.pulsesFired === T.pulses);
    this.ctx.effects.sonarPulse(this.pos);
    this.ctx.feedback?.('ping', this.pos);
    // The cost of intel: the ping gives the dart's position away.
    this.ctx.alertAt(this.pos, T.hearRadius);
    if (this.pulsesFired === 1) this.ctx.announce(tagged.length ? `RADAR — ${tagged.length} ENEM${tagged.length === 1 ? 'Y' : 'IES'} FOUND · +10% DMG` : 'RADAR — NO ENEMIES IN RANGE');
  }

  dispose() {
    this.ctx.scene.remove(this.model.group);
    disposeKitObject(this.model.group);
    disposeDartFx(this.model);
  }
}

// ----------------------------------------------------------- barricade ----
// Plate tint multiplies the worn-paint texture: white = as painted, dark = scorched.
const SAND = new THREE.Color(0xFFFFFF);
const SCORCHED = new THREE.Color(0x3A3128);

class Barricade {
  model: BarricadeModel;
  hp: number = KIT_TUNING.bulwark.hp;
  life: number = KIT_TUNING.bulwark.life;
  done = false;
  damageTaken = 0;
  /** Folding away (recall / expiry): blocker already lifted, removed when the fold ends. */
  folding = false;
  private age = 0;
  private foldT = 0;
  private hitFlash = 0;
  private sparkT = 0;
  private flick = 0;
  private slammed = false;
  private blockerLive = true;

  constructor(private ctx: KitContext, public box: AABB, center: { x: number; y: number; z: number }, yaw: number) {
    const T = KIT_TUNING.bulwark;
    this.model = buildBarricade(T.width, T.height, T.depth);
    const g = this.model.group;
    g.position.set(center.x, center.y, center.z);
    g.rotation.y = yaw;
    this.pose(0);
    ctx.scene.add(g);
    g.updateMatrixWorld(true);
    for (const p of this.model.plates) {
      p.userData.kitBarricade = true;
      // Any hostile round that stops on a plate damages the wall (see ai.ts / tdm.ts).
      p.userData.kitHit = (amount: number, at?: THREE.Vector3) => this.damage(amount, at);
      ctx.occluders.push(p);
    }
    ctx.addBlocker(box);
    audio.barricadeDeploy(center.x, center.y + 0.7, center.z);
  }

  get center(): THREE.Vector3 { return this.model.group.position; }
  get active(): boolean { return !this.done && !this.folding; }

  /** 0 = folded flat against the ground, 1 = fully deployed. */
  private pose(k: number) {
    const g = this.model.group;
    const rise = easeOutBack(Math.min(1, k * 1.4));
    g.scale.set(1, Math.max(0.05, Math.min(1.08, rise)), 1);
    const open = Math.max(0, Math.min(1, (k - 0.35) / 0.65));
    const swing = (1 - (1 - Math.pow(1 - open, 3))) * Math.PI / 2;
    const [left, right] = this.model.wings;
    left.rotation.y = swing; right.rotation.y = -swing;
    g.updateMatrixWorld(true);
  }

  damage(amount: number, at?: THREE.Vector3) {
    if (!this.active || amount <= 0) return;
    this.hp -= amount; this.damageTaken += amount;
    this.hitFlash = 0.08;
    // Sparks are rate-limited to 20/s so a shotgun volley doesn't drain the burst pool.
    if (this.sparkT <= 0) {
      this.sparkT = 0.05;
      this.ctx.effects.sparks(at ?? tmpA.set(this.center.x, this.center.y + 0.9, this.center.z));
    }
    if (Math.random() < 0.35) audio.barricadeHit(this.center.x, this.center.y + 0.8, this.center.z);
    if (this.hp <= 0) this.destroy(true);
  }

  update(dt: number) {
    if (this.done) return;
    const T = KIT_TUNING.bulwark;
    this.age += dt;
    this.sparkT -= dt;
    if (this.folding) {
      this.foldT += dt;
      const k = 1 - Math.min(1, this.foldT / T.fold);
      this.pose(k);
      if (k <= 0) this.done = true;
      return;
    }
    if (this.age < T.unfold) this.pose(this.age / T.unfold);
    else if (!this.slammed || this.model.group.scale.y !== 1) this.pose(1);
    if (!this.slammed && this.age >= T.unfold * 0.55) {
      // The plates hit the ground: dust ring, thump in the camera.
      this.slammed = true;
      this.ctx.effects.slamDust(tmpA.set(this.center.x, this.center.y + 0.05, this.center.z));
      this.ctx.feedback?.('slam', this.center);
    }
    this.life -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.flick += dt;
    const frac = Math.max(0, this.hp / T.hp);
    // Plates scorch as integrity drops; each hit flashes them hot for 80 ms.
    const mat = this.model.plateMat;
    mat.color.copy(SAND).lerp(SCORCHED, 1 - frac);
    mat.emissive.setHex(0xFF6A2A);
    mat.emissiveIntensity = this.hitFlash > 0 ? 0.55 : 0;
    const lamp = this.model.lamp.material as THREE.MeshStandardMaterial;
    const low = frac < 0.35 || this.life < 4;
    lamp.emissiveIntensity = this.hitFlash > 0 ? 4 : low ? (Math.sin(this.flick * 18) > 0 ? 2.6 : 0.2) : 2.2;
    // Critically damaged: the shield shudders and sheds the odd spark.
    if (frac < 0.35) {
      this.model.group.rotation.z = Math.sin(this.flick * 40) * 0.006;
      if (Math.random() < dt * 2.5) this.ctx.effects.sparks(tmpA.set(this.center.x + (Math.random() - 0.5) * 1.6, this.center.y + 0.4 + Math.random() * 0.8, this.center.z));
    }
    if (this.life <= 0) this.destroy(false);
  }

  /** Lift the blocker + occluders now (movement and bullets pass at once), animate the fold. */
  private release() {
    if (!this.blockerLive) return;
    this.blockerLive = false;
    for (const p of this.model.plates) {
      const i = this.ctx.occluders.indexOf(p);
      if (i >= 0) this.ctx.occluders.splice(i, 1);
      delete p.userData.kitHit;
    }
    this.ctx.removeBlocker(this.box);
  }

  /** Broken: shatter in place. Expired: fold away. */
  destroy(broken: boolean) {
    if (this.done || this.folding) return;
    const c = this.center;
    this.release();
    if (broken) {
      this.done = true;
      this.ctx.effects.glassShatter(tmpA.set(c.x, c.y + 0.8, c.z));
      for (let i = 0; i < 3; i++) this.ctx.effects.sparks(tmpA.set(c.x + (i - 1) * 0.8, c.y + 0.7, c.z));
      this.ctx.effects.slamDust(tmpA.set(c.x, c.y + 0.1, c.z));
      audio.barricadeBreak(c.x, c.y + 0.7, c.z);
      this.ctx.feedback?.('break', c);
      this.ctx.announce('BARRICADE DESTROYED');
    } else {
      this.folding = true;
      audio.barricadeFold(c.x, c.y + 0.7, c.z);
    }
  }

  /** Player recall: fold it up and hand back the remaining integrity fraction. */
  recall(): number {
    if (!this.active) return 0;
    const frac = Math.max(0, this.hp / KIT_TUNING.bulwark.hp);
    this.release();
    this.folding = true;
    const c = this.center;
    audio.barricadeRecall(c.x, c.y + 0.7, c.z);
    this.ctx.feedback?.('recall', c);
    return frac;
  }

  /** Hard stop (match end): no animation. */
  kill() { this.release(); this.done = true; }

  dispose() {
    this.release();
    this.ctx.scene.remove(this.model.group);
    disposeKitObject(this.model.group);
    this.model.plateMat.dispose();
  }
}

// --------------------------------------------------------------- decoy ----
class HoloDecoy implements KitLure {
  model: DecoyModel;
  feet: THREE.Vector3;
  eye = new THREE.Vector3();
  hp: number = KIT_TUNING.phantom.hp;
  life: number = KIT_TUNING.phantom.life;
  done = false;
  private age = 0;
  private fireT = 0.35;
  private dirX: number; private dirZ: number;
  private hitFlash = 0;
  private popT = -1;
  private glitchT = 0.8;
  private glitchLeft = 0;
  private strafeDir = 1;
  private strafeOff = 0;
  shotsFired = 0;
  hitsTaken = 0;
  /** Hostiles stunned by this decoy's burst (tests + debrief). */
  stunned = 0;

  constructor(private ctx: KitContext, from: THREE.Vector3, dx: number, dz: number) {
    this.model = buildDecoy();
    const l = Math.hypot(dx, dz) || 1;
    this.dirX = dx / l; this.dirZ = dz / l;
    this.feet = from.clone();
    this.model.group.position.copy(this.feet);
    this.model.group.rotation.y = Math.atan2(-this.dirX, -this.dirZ);
    this.model.group.scale.set(0.2, 0.02, 0.2);
    ctx.scene.add(this.model.group);
    this.syncEye();
    audio.decoyDeploy(from.x, from.y + 1, from.z);
    ctx.effects.holoBurst(tmpA.set(from.x, from.y + 0.9, from.z));
    ctx.feedback?.('decoy', this.feet);
  }

  active(): boolean { return !this.done && this.popT < 0; }

  hit(amount: number) {
    if (!this.active() || amount <= 0) return;
    this.hp -= amount; this.hitsTaken++;
    this.hitFlash = 0.1;
    this.glitchLeft = Math.max(this.glitchLeft, 0.05);
    if (this.hp <= 0) this.pop(true);
  }

  private syncEye() { this.eye.set(this.feet.x, this.feet.y + 1.45, this.feet.z); }

  /** Death (shot down or out of power): glitch-out plus the stun burst. */
  private pop(shot: boolean) {
    if (this.popT >= 0) return;
    this.popT = 0;
    const P = KIT_TUNING.phantom;
    const c = tmpA.set(this.feet.x, this.feet.y + 1, this.feet.z);
    audio.decoyPop(c.x, c.y, c.z);
    audio.decoyBurst(c.x, c.y, c.z);
    this.ctx.effects.holoBurst(c, true);
    this.ctx.feedback?.('burst', this.feet);
    const caught = burstVictims(this.feet, P.burstRadius, this.ctx.hostiles().filter(h => h.alive()));
    for (const h of caught) h.stun?.(P.burstStun);
    this.stunned = caught.length;
    if (caught.length) this.ctx.announce(`DECOY BURST — ${caught.length} ENEM${caught.length === 1 ? 'Y' : 'IES'} STUNNED`);
    else if (shot) this.ctx.announce('DECOY DOWN');
  }

  update(dt: number) {
    if (this.done) return;
    const T = KIT_TUNING.phantom;
    const g = this.model.group;
    this.model.mat.uniforms.uTime.value += dt; // scanlines crawl, sweep band travels
    if (this.popT >= 0) {
      // glitch-out: flatten and flare sideways, then gone
      this.popT += dt;
      const k = Math.min(1, this.popT / 0.3);
      g.scale.set(1 + k * 0.9, Math.max(0.02, 1 - k), 1 + k * 0.9);
      this.model.torso.position.x = (Math.random() - 0.5) * 0.3 * (1 - k);
      this.model.mat.opacity = 0.95 * (1 - k);
      (this.model.cone.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - k);
      if (k >= 1) this.done = true;
      return;
    }
    this.age += dt; this.life -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    // Materialise: grows out of the puck while a scan ring sweeps up the body.
    const mk = Math.min(1, this.age / T.materialize);
    const grow = easeOutBack(mk);
    g.scale.set(Math.min(1.05, 0.2 + grow * 0.8), Math.min(1.05, grow), Math.min(1.05, 0.2 + grow * 0.8));
    const scanMat = this.model.scan.material as THREE.MeshBasicMaterial;
    if (mk < 1) { this.model.scan.position.y = mk * 1.9; scanMat.opacity = 0.9 * (1 - mk * 0.6); }
    else {
      // After materialising the ring keeps sweeping slowly, like a projector refresh.
      const sweep = (this.age * 0.8) % 1;
      this.model.scan.position.y = sweep * 1.9;
      scanMat.opacity = 0.35 * (1 - sweep);
    }
    const running = this.age < T.runFor;
    const before = tmpB.copy(this.feet);
    if (running) {
      this.ctx.moveCollide(this.feet, this.dirX * T.speed * dt, this.dirZ * T.speed * dt, 0.3);
      // Blocked? Stop and hold where it is instead of moonwalking into a wall.
      if (before.distanceTo(this.feet) < T.speed * dt * 0.2) this.age = T.runFor;
      const ph = this.age * 9;
      this.model.lLeg.rotation.x = Math.sin(ph) * 0.6;
      this.model.rLeg.rotation.x = -Math.sin(ph) * 0.6;
      this.model.torso.position.y = 0.95 + Math.abs(Math.sin(ph)) * 0.04;
    } else {
      // Holding: weave side to side across the lane like a rifleman strafing a peek.
      const sx = -this.dirZ, sz = this.dirX;
      const step = this.strafeDir * T.strafeSpeed * dt;
      if (Math.abs(this.strafeOff + step) > T.strafeRange) this.strafeDir = -this.strafeDir;
      else {
        this.ctx.moveCollide(this.feet, sx * step, sz * step, 0.3);
        if (before.distanceTo(this.feet) < Math.abs(step) * 0.2) this.strafeDir = -this.strafeDir;
        else this.strafeOff += step;
      }
      const ph = this.age * 7;
      this.model.lLeg.rotation.x = Math.sin(ph) * 0.25;
      this.model.rLeg.rotation.x = -Math.sin(ph) * 0.25;
      this.model.torso.position.y = 0.95 + Math.sin(this.age * 2.2) * 0.03;
    }
    g.position.copy(this.feet);
    this.syncEye();
    // Face the nearest hostile once holding, like a real rifleman would.
    const threat = this.nearestHostile(40);
    if (!running && threat) g.rotation.y = Math.atan2(-(threat.x - this.feet.x), -(threat.z - this.feet.z));
    // Glitch slices: every 0.6–1.4 s the upper body jumps sideways for 60 ms.
    this.glitchT -= dt;
    if (this.glitchT <= 0) { this.glitchT = 0.6 + Math.random() * 0.8; this.glitchLeft = 0.06; }
    this.glitchLeft = Math.max(0, this.glitchLeft - dt);
    this.model.torso.position.x = this.glitchLeft > 0 ? (Math.random() - 0.5) * 0.16 : 0;
    // Hologram shimmer: base 0.5, random flicker, bright when hit or glitching; the
    // whole projection dims over its last 2 s so the player sees it running out.
    const power = Math.min(1, this.life / 2);
    this.model.mat.opacity = this.hitFlash > 0 ? 0.95
      : (0.42 + Math.random() * 0.14 + (this.glitchLeft > 0 ? 0.3 : 0)) * (0.55 + 0.45 * power);
    (this.model.cone.material as THREE.MeshBasicMaterial).opacity = (0.1 + Math.random() * 0.04) * power;
    this.fireT -= dt;
    if (this.fireT <= 0 && mk >= 1) {
      this.fireT = T.fireMin + Math.random() * (T.fireMax - T.fireMin);
      this.fireBlank(threat);
    }
    if (this.life <= 0) this.pop(false);
  }

  private nearestHostile(range: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = range;
    for (const h of this.ctx.hostiles()) {
      if (!h.alive()) continue;
      const d = h.pos.distanceTo(this.feet);
      if (d < bd) { bd = d; best = h.pos; }
    }
    return best;
  }

  private fireBlank(threat: THREE.Vector3 | null) {
    const g = this.model.group;
    g.updateMatrixWorld(true);
    const muzzle = this.model.muzzle.getWorldPosition(new THREE.Vector3());
    this.shotsFired++;
    this.ctx.effects.enemyMuzzle(muzzle);
    // Blanks: the tracer flies at the threat (or down-range) but carries no damage.
    const to = threat
      ? tmpB.set(threat.x + (Math.random() - 0.5) * 2, threat.y + 1.2 + (Math.random() - 0.5), threat.z + (Math.random() - 0.5) * 2)
      : tmpB.set(muzzle.x - Math.sin(g.rotation.y) * 30, muzzle.y, muzzle.z - Math.cos(g.rotation.y) * 30);
    this.ctx.effects.tracer(muzzle, to.clone(), false);
    audio.decoyFire(muzzle.x, muzzle.y, muzzle.z);
    this.ctx.alertAt(this.feet, KIT_TUNING.phantom.noiseRadius);
  }

  /** Hard stop (match end): no burst, no announcement. */
  kill() { this.popT = 1; this.done = true; }

  dispose() {
    this.ctx.scene.remove(this.model.group);
    disposeDecoy(this.model);
  }
}

// ------------------------------------------------------------ director ----
/** Tagged-hostile markers pooled at 16 — more than any squad the game fields at once. */
const TAG_POOL = 16;

export class KitDirector {
  readonly kit: KitId;
  charge: KitCharge;
  uses = 0;
  elapsed = 0;
  /** Lifetime stats for the debrief / tests. */
  stats = { darts: 0, tags: 0, barricades: 0, barricadeDamage: 0, recalls: 0, decoys: 0, decoyHits: 0, stunned: 0 };
  private darts: SonarDart[] = [];
  private walls: Barricade[] = [];
  private decoys: HoloDecoy[] = [];
  private tags = new Map<object, number>();
  private markers: THREE.Sprite[] = [];
  private markerMat: THREE.SpriteMaterial;
  private ghosts: TagGhost[] = [];
  private flashT = 0;
  private wasReady: boolean;
  private readyEpoch = 0;
  private useEpoch = 0;

  /**
   * `startCharge` is the fraction of a full charge the kit deploys with
   * (KIT_TUNING.deployCharge = 0.5 in play; tests pass 1 to start ready).
   */
  constructor(private ctx: KitContext, kit: KitId, startCharge: number = KIT_TUNING.deployCharge) {
    this.kit = kit;
    this.charge = new KitCharge(KIT_DEFS[kit].cooldown, startCharge);
    this.wasReady = this.charge.ready;
    this.markerMat = makeSonarMarkerMaterial();
    for (let i = 0; i < TAG_POOL; i++) {
      const s = new THREE.Sprite(this.markerMat);
      s.scale.set(0.026, 0.026, 1);
      s.renderOrder = 51;
      s.visible = false;
      ctx.scene.add(s);
      this.markers.push(s);
      const ghost = buildTagGhost();
      ctx.scene.add(ghost.group);
      this.ghosts.push(ghost);
    }
  }

  get def(): KitDef { return KIT_DEFS[this.kit]; }

  /** Z pressed. Returns true when the ability (or a recall) actually went out. */
  activate(): boolean {
    if (!this.ctx.playerAlive()) return false;
    // Bulwark: Z next to your own live wall recalls it — even while recharging.
    const near = this.recallable();
    if (near) {
      const frac = near.recall();
      const bank = recallRefundSeconds(frac);
      this.charge.bank(bank);
      this.stats.recalls++;
      this.ctx.announce(`BARRICADE PICKED UP — ${Math.round(bank)}s BACK`);
      return true;
    }
    if (!this.charge.ready) {
      audio.kitDenied();
      this.ctx.announce(`${this.def.ability.toUpperCase()} RECHARGING — ${Math.ceil(this.charge.left)}s`);
      return false;
    }
    let ok = false;
    if (this.kit === 'recon') ok = this.throwDart();
    else if (this.kit === 'bulwark') ok = this.plantBarricade();
    else ok = this.sendDecoy();
    if (!ok) { audio.kitDenied(); return false; }
    this.charge.spend();
    this.uses++;
    this.useEpoch++;
    this.wasReady = false;
    return true;
  }

  /** The player's live wall within recall range, if any. */
  private recallable(): Barricade | null {
    if (this.kit !== 'bulwark') return null;
    const feet = this.ctx.playerFeet();
    for (const w of this.walls) {
      if (!w.active) continue;
      if (Math.hypot(w.center.x - feet.x, w.center.z - feet.z) <= KIT_TUNING.bulwark.recallRange) return w;
    }
    return null;
  }

  private throwDart(): boolean {
    const eye = this.ctx.playerEye();
    const dir = this.ctx.playerDir().clone();
    // A slight loft so a level throw carries; the same trick the frag throw uses.
    dir.y += 0.06; dir.normalize();
    const from = eye.clone().addScaledVector(dir, 0.45);
    for (const d of this.darts) d.done = true; // one dart in the air at a time
    this.darts.push(new SonarDart(this.ctx, this, from, dir));
    this.stats.darts++;
    audio.dartThrow();
    return true;
  }

  private plantBarricade(): boolean {
    const feet = this.ctx.playerFeet();
    const dir = this.ctx.playerDir();
    const p = barricadePlacement(feet, dir);
    let ok = this.ctx.canPlaceBox(p.box);
    // Only the old wall in the way? Lift it and try again — never lose it to a refusal.
    const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    if (!ok && this.walls.some(w => w.active && overlaps(w.box, p.box))) {
      for (const w of this.walls) w.destroy(false);
      ok = this.ctx.canPlaceBox(p.box);
    }
    if (!ok) {
      this.ctx.announce('NO ROOM FOR BARRICADE — LOOK AT OPEN GROUND');
      return false;
    }
    for (const w of this.walls) w.destroy(false); // one wall at a time
    this.walls.push(new Barricade(this.ctx, p.box, p.center, p.yaw));
    this.stats.barricades++;
    return true;
  }

  private sendDecoy(): boolean {
    const feet = this.ctx.playerFeet();
    const dir = this.ctx.playerDir();
    if (Math.hypot(dir.x, dir.z) < 0.05) return false; // looking straight down/up
    for (const d of this.decoys) if (d.active()) d.life = 0; // one decoy at a time
    const start = feet.clone();
    // Spawn half a metre ahead so it doesn't clip the viewmodel.
    this.ctx.moveCollide(start, dir.x * 0.5, dir.z * 0.5, 0.3);
    this.decoys.push(new HoloDecoy(this.ctx, start, dir.x, dir.z));
    this.stats.decoys++;
    this.ctx.announce('DECOY OUT');
    return true;
  }

  /** A kill landed: shave the cooldown (8 % each, capped at 30 % per charge). */
  onKill(count = 1) {
    for (let i = 0; i < count; i++) this.charge.refund(KIT_TUNING.killRefund, KIT_TUNING.refundCap);
  }

  /** Sonar tag a hostile for `seconds`. */
  tag(ref: object, seconds: number) {
    if ((this.tags.get(ref) ?? 0) <= 0) this.stats.tags++;
    this.tags.set(ref, Math.max(this.tags.get(ref) ?? 0, seconds));
  }

  /** Every ping re-flashes the silhouettes so the refresh is visible. */
  pulseFlash() { this.flashT = 0.35; }

  isRevealed(ref: object): boolean { return (this.tags.get(ref) ?? 0) > 0; }

  /** Player damage multiplier against `ref` (Recon mark). */
  damageMul(ref: object): number { return this.isRevealed(ref) ? KIT_TUNING.recon.markDamageMul : 1; }

  /** Lures active right now (the decoys). */
  lures(): KitLure[] { return this.decoys.filter(d => d.active()); }

  /** The decoy a hostile at `eye` would lock onto, if any. Visibility = world occluders. */
  lureFor(eye: THREE.Vector3): KitLure | null {
    const lures = this.lures();
    if (!lures.length) return null;
    return chooseLure(eye, lures, KIT_TUNING.phantom.lureRadius, (from, to) => {
      const d = from.distanceTo(to);
      ray.set(from, tmpA.copy(to).sub(from).normalize()); ray.far = Math.max(0, d - 0.3);
      return ray.intersectObjects(this.ctx.occluders, false).length === 0;
    });
  }

  /** Explosion: cracks walls and pops decoys in range. */
  blast(pos: THREE.Vector3, radius: number) {
    const T = KIT_TUNING.bulwark;
    for (const w of this.walls) {
      if (!w.active) continue;
      const d = tmpA.set(w.center.x, w.center.y + 0.7, w.center.z).distanceTo(pos);
      if (d < radius) w.damage(T.blastDamage * THREE.MathUtils.lerp(1, 0.4, d / radius));
    }
    for (const d of this.decoys) if (d.active() && d.eye.distanceTo(pos) < radius) d.hit(KIT_TUNING.phantom.hp);
  }

  update(dt: number) {
    this.elapsed += dt;
    this.charge.tick(dt);
    // Charged (by time or a kill refund): chime + ticker so the player knows to use it.
    if (this.charge.ready && !this.wasReady && this.ctx.playerAlive()) {
      audio.kitReady();
      this.readyEpoch++;
      this.ctx.feedback?.('ready');
      this.ctx.announce(`${this.def.ability.toUpperCase()} READY — PRESS ${KIT_KEY}`);
    }
    this.wasReady = this.charge.ready;
    for (const d of this.darts) d.update(dt);
    for (const w of this.walls) w.update(dt);
    for (const d of this.decoys) d.update(dt);
    this.darts = this.reap(this.darts);
    this.walls = this.reap(this.walls, w => { this.stats.barricadeDamage += w.damageTaken; });
    this.decoys = this.reap(this.decoys, d => { this.stats.decoyHits += d.hitsTaken; this.stats.stunned += d.stunned; });
    // tags + through-wall silhouettes and markers
    for (const [ref, t] of this.tags) {
      const left = t - dt;
      if (left <= 0) this.tags.delete(ref); else this.tags.set(ref, left);
    }
    this.flashT = Math.max(0, this.flashT - dt);
    let i = 0;
    if (this.tags.size) {
      for (const h of this.ctx.hostiles()) {
        if (i >= this.markers.length) break;
        const left = this.tags.get(h.ref);
        if (!left || !h.alive()) continue;
        const crouch = h.crouched?.() ? 0.72 : 1;
        const blink = left > 0.8 || Math.sin(left * 30) > 0; // blink out as the tag fades
        const s = this.markers[i];
        s.position.set(h.pos.x, h.pos.y + 2.05 * crouch + 0.15, h.pos.z);
        s.visible = blink;
        const ghost = this.ghosts[i];
        ghost.group.visible = blink;
        ghost.group.position.set(h.pos.x, h.pos.y, h.pos.z);
        ghost.group.scale.set(1, crouch, 1);
        // Bright on the ping, settling to a steady 0.3, fading over the last 0.8 s.
        ghost.mat.opacity = (0.3 + this.flashT * 1.4) * Math.min(1, left / 0.8);
        i++;
      }
    }
    for (; i < this.markers.length; i++) { this.markers[i].visible = false; this.ghosts[i].group.visible = false; }
  }

  private reap<T extends { done: boolean; dispose(): void }>(list: T[], onGone?: (t: T) => void): T[] {
    const keep: T[] = [];
    for (const e of list) {
      if (e.done) { onGone?.(e); e.dispose(); } else keep.push(e);
    }
    return keep;
  }

  /** Number of live kit entities (tests + HUD). */
  get liveCount(): number { return this.darts.length + this.walls.length + this.decoys.length; }

  hud(): KitHud {
    const live: KitLiveHud[] = [];
    const R = KIT_TUNING.recon, B = KIT_TUNING.bulwark, P = KIT_TUNING.phantom;
    for (const d of this.darts) live.push({ kind: 'dart', label: 'RADAR', timeLeft: d.timeLeft, total: SonarDart.LIFE, detail: d.stuck ? `SCAN ${d.pulsesFired}/${R.pulses}` : 'THROWN' });
    for (const w of this.walls) if (w.active) live.push({ kind: 'barricade', label: 'BARRICADE', timeLeft: Math.max(0, w.life), total: B.life, health: Math.max(0, w.hp / B.hp), detail: `${Math.max(0, Math.ceil(w.hp))} HP` });
    for (const d of this.decoys) if (d.active()) live.push({ kind: 'decoy', label: 'DECOY', timeLeft: Math.max(0, d.life), total: P.life, health: Math.max(0, d.hp / P.hp), detail: `${d.hitsTaken} HITS TAKEN` });
    let tagged = 0;
    for (const t of this.tags.values()) if (t > 0) tagged++;
    return {
      id: this.kit, name: this.def.name, ability: this.def.ability, key: KIT_KEY,
      ready: this.charge.ready, pct: this.charge.pct, cooldownLeft: this.charge.left, cooldown: this.charge.cooldown,
      live, tagged,
      // Onboarding: the prompt shows for the first 45 s of a deployment until the kit is used
      // (long enough to cover the half-charge wait and a few seconds of READY).
      hint: this.uses === 0 && this.elapsed < 45,
      recall: !!this.recallable(),
      readyEpoch: this.readyEpoch, useEpoch: this.useEpoch,
      blurb: this.def.blurb, rule: this.def.rule,
    };
  }

  /** Match over: fold everything away quietly (no announcements after the whistle). */
  quiet() {
    for (const w of this.walls) w.kill();
    for (const d of this.decoys) d.kill();
    for (const d of this.darts) d.done = true;
    this.darts = this.reap(this.darts);
    this.walls = this.reap(this.walls);
    this.decoys = this.reap(this.decoys);
  }

  dispose() {
    this.quiet();
    for (const s of this.markers) this.ctx.scene.remove(s);
    for (const g of this.ghosts) {
      this.ctx.scene.remove(g.group);
      disposeKitObject(g.group);
      g.mat.dispose();
    }
    this.markerMat.map?.dispose();
    this.markerMat.dispose();
  }
}
