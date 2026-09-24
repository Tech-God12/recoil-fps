// ============================================================================
// Recoil FPS — FIELD KITS: one tactical ability per operator, on a cooldown.
//
// Pick one of three kits before deploying (menu card) or from the pause menu:
//   RECON   · Sonar Dart     — thrown sensor that pulses and tags hostiles through walls,
//                              but the ping is loud: close hostiles come to investigate it.
//   BULWARK · Barricade      — chest-high steel wall that stops bullets and AI sight-lines
//                              both ways; hostiles shoot it down or frag it.
//   PHANTOM · Holo-Decoy     — a hologram that runs ahead firing blanks; hostiles who see
//                              or hear it lock onto it and burn their fire on it.
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
  buildBarricade, buildDart, buildDecoy, disposeKitObject, makeSonarMarkerMaterial,
  type BarricadeModel, type DartModel, type DecoyModel,
} from './kit-models';

export type KitId = 'recon' | 'bulwark' | 'phantom';
export const KIT_IDS: readonly KitId[] = ['recon', 'bulwark', 'phantom'];
export const KIT_KEY = 'Z';

// --------------------------------------------------------------- tuning ----
// Every number here was set against the existing combat model:
//   * mission hostile hit = 7–14 dmg (avg 10.5), TDM bot hit = 18–24 (avg 21);
//   * a TDM match is 150 s with a 5 s respawn; a mission phase runs 60–120 s;
//   * the UAV streak (400 pts ≈ 4 kills) paints the whole map for 30 s.
// Kits must be worth pressing every fight but never replace a streak.
export const KIT_TUNING = {
  recon: {
    /** One use per engagement cycle: ~5 darts per 150 s TDM match before kill refunds. */
    cooldown: 30,
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
  },
  bulwark: {
    /** Longer than recon: a wall is a fight-winning tool, and it lives 22 s of those 40. */
    cooldown: 40,
    life: 22,
    /**
     * 450 HP ≈ 43 mission hits or ≈ 21 TDM hits — two hostiles focusing it break it
     * in ~6–8 s, a frag (260 at the centre) plus a burst breaks it faster. Long enough
     * to reload or revive a lane, short enough that holding it forever is impossible.
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
  },
  phantom: {
    /** Between recon and bulwark: a decoy wins one fight, so it recharges in about one. */
    cooldown: 35,
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
  },
  /** Every kill knocks 20 % of the full cooldown off: aggression recharges your kit. */
  killRefund: 0.2,
  /** Swapping kits mid-match starts the new kit on a full cooldown (no swap-to-refresh). */
  swapStartsCold: true,
} as const;

export interface KitDef {
  id: KitId;
  name: string;
  ability: string;
  role: string;
  blurb: string;
  /** One-line rule shown on menu cards and in the pause reference. */
  rule: string;
  cooldown: number;
}

export const KIT_DEFS: Record<KitId, KitDef> = {
  recon: {
    id: 'recon', name: 'RECON', ability: 'Sonar Dart', role: 'Intel',
    blurb: 'Throw a sensor dart. Three pulses tag every hostile within 24 m through walls.',
    rule: 'The ping is loud — hostiles within 14 m come to find the dart.',
    cooldown: KIT_TUNING.recon.cooldown,
  },
  bulwark: {
    id: 'bulwark', name: 'BULWARK', ability: 'Barricade', role: 'Cover',
    blurb: 'Plant a 1.4 m steel wall ahead of you. Stops bullets and sight-lines both ways.',
    rule: 'Crouch behind it to be safe; stand to shoot over it. 450 HP, frags crack it.',
    cooldown: KIT_TUNING.bulwark.cooldown,
  },
  phantom: {
    id: 'phantom', name: 'PHANTOM', ability: 'Holo-Decoy', role: 'Deception',
    blurb: 'Send a hologram running ahead firing blanks. Hostiles who see it shoot it instead.',
    rule: 'Lures anyone with eyes on it inside 32 m and draws hearing within 28 m. 120 HP.',
    cooldown: KIT_TUNING.phantom.cooldown,
  },
};

/**
 * Chance that a lured hostile hit by the player drops the decoy and turns on the real
 * shooter. 50 %: shooting from behind your decoy is strong but not free.
 */
export const KIT_LURE_BREAK_CHANCE = 0.5;

export function kitDef(id: KitId): KitDef { return KIT_DEFS[id]; }
export function isKitId(v: unknown): v is KitId { return typeof v === 'string' && (KIT_IDS as readonly string[]).includes(v); }

// ----------------------------------------------------------- pure logic ----

/** Cooldown meter. Pure: no time source, the caller ticks it. */
export class KitCharge {
  left: number;
  constructor(public cooldown: number, startReady = true) {
    this.left = startReady ? 0 : cooldown;
  }
  get ready(): boolean { return this.left <= 0; }
  /** 0 = just spent, 1 = ready. */
  get pct(): number { return this.cooldown <= 0 ? 1 : 1 - Math.max(0, Math.min(1, this.left / this.cooldown)); }
  tick(dt: number) { if (dt > 0) this.left = Math.max(0, this.left - dt); }
  spend(): boolean {
    if (!this.ready) return false;
    this.left = this.cooldown;
    return true;
  }
  /** Knock a fraction of the FULL cooldown off (kill refund). Never goes below ready. */
  refund(fraction: number) { if (fraction > 0) this.left = Math.max(0, this.left - this.cooldown * fraction); }
  reset(cooldown: number, ready: boolean) { this.cooldown = cooldown; this.left = ready ? 0 : cooldown; }
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

/** Which of `points` a sonar pulse at `center` tags (3-D distance, walls ignored — it is sonar). */
export function sonarTagged<T extends { pos: { x: number; y: number; z: number } }>(center: { x: number; y: number; z: number }, radius: number, points: T[]): T[] {
  const r2 = radius * radius;
  return points.filter(p => {
    const dx = p.pos.x - center.x, dy = p.pos.y - center.y, dz = p.pos.z - center.z;
    return dx * dx + dy * dy + dz * dz <= r2;
  });
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
}

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
  live: KitLiveHud[];
  /** Hostiles currently sonar-tagged. */
  tagged: number;
  /** Show the onboarding prompt (early in the deployment and never used yet). */
  hint: boolean;
  blurb: string;
  rule: string;
}

const ray = new THREE.Raycaster();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

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
    ctx.scene.add(this.model.group);
    ctx.scene.add(this.model.ring);
  }

  private orient(d: THREE.Vector3) {
    // Nose is local -Z: look from pos toward pos - d so -Z faces along d.
    tmpA.copy(this.model.group.position).sub(d);
    this.model.group.lookAt(tmpA);
  }

  get timeLeft(): number {
    const T = KIT_TUNING.recon;
    if (!this.stuck) return T.firstPulse + T.pulseEvery * (T.pulses - 1) + 0.8;
    return Math.max(0, T.firstPulse + T.pulseEvery * (T.pulses - 1) + 0.8 - this.sinceStick);
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
      if (hit) {
        this.pos.copy(hit.point).addScaledVector(step.normalize(), -0.03);
        this.stick();
      } else {
        this.pos.add(step);
        const g = this.ctx.groundHeight(this.pos.x, this.pos.z);
        if (this.pos.y <= g + 0.02) { this.pos.y = g + 0.02; this.stick(); }
        else if (this.flight >= T.maxFlight) this.stick();
      }
      this.model.group.position.copy(this.pos);
      if (!this.stuck) this.orient(this.vel);
      return;
    }
    this.sinceStick += dt;
    const due = T.firstPulse + this.pulsesFired * T.pulseEvery;
    if (this.pulsesFired < T.pulses && this.sinceStick >= due) this.pulse();
    // LED blinks faster as the last pulse approaches
    const led = this.model.led.material as THREE.MeshStandardMaterial;
    led.emissiveIntensity = 1.2 + (Math.sin(this.sinceStick * (8 + this.pulsesFired * 4)) > 0 ? 1.6 : 0);
    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = Math.min(1, this.ringT / 0.7);
      const r = Math.max(0.05, k * T.radius);
      this.model.ring.scale.set(r, r, r);
      (this.model.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
      if (k >= 1) { this.ringT = -1; this.model.ring.visible = false; }
    }
    // Retire once the last ring has finished expanding (ring animation is 0.7 s).
    if (this.pulsesFired >= T.pulses && this.timeLeft <= 0) this.done = true;
  }

  private stick() {
    this.stuck = true;
    this.vel.set(0, 0, 0);
    audio.dartStick(this.pos.x, this.pos.y, this.pos.z);
  }

  private pulse() {
    const T = KIT_TUNING.recon;
    this.pulsesFired++;
    this.ringT = 0;
    const ring = this.model.ring;
    ring.visible = true;
    ring.position.set(this.pos.x, this.ctx.groundHeight(this.pos.x, this.pos.z) + 0.08, this.pos.z);
    const alive = this.ctx.hostiles().filter(h => h.alive());
    const tagged = sonarTagged(this.pos, T.radius, alive);
    for (const h of tagged) this.dir.tag(h.ref, T.revealFor);
    audio.sonarPing(this.pos.x, this.pos.y, this.pos.z, this.pulsesFired === T.pulses);
    // The cost of intel: the ping gives the dart's position away.
    this.ctx.alertAt(this.pos, T.hearRadius);
    if (this.pulsesFired === 1) this.ctx.announce(tagged.length ? `SONAR — ${tagged.length} HOSTILE${tagged.length === 1 ? '' : 'S'} TAGGED` : 'SONAR — NO CONTACTS IN RANGE');
  }

  dispose() {
    this.ctx.scene.remove(this.model.group);
    this.ctx.scene.remove(this.model.ring);
    disposeKitObject(this.model.group);
    this.model.ring.geometry.dispose();
    (this.model.ring.material as THREE.Material).dispose();
  }
}

// ----------------------------------------------------------- barricade ----
class Barricade {
  model: BarricadeModel;
  hp: number = KIT_TUNING.bulwark.hp;
  life: number = KIT_TUNING.bulwark.life;
  done = false;
  damageTaken = 0;
  private hitFlash = 0;
  private flick = 0;

  constructor(private ctx: KitContext, public box: AABB, center: { x: number; y: number; z: number }, yaw: number) {
    const T = KIT_TUNING.bulwark;
    this.model = buildBarricade(T.width, T.height, T.depth);
    const g = this.model.group;
    g.position.set(center.x, center.y, center.z);
    g.rotation.y = yaw;
    g.scale.set(1, 0.05, 1); // unfolds upward over 0.25 s
    ctx.scene.add(g);
    g.updateMatrixWorld(true);
    for (const p of this.model.plates) {
      p.userData.kitBarricade = true;
      // Any hostile round that stops on a plate damages the wall (see ai.ts / tdm.ts).
      p.userData.kitHit = (amount: number) => this.damage(amount);
      ctx.occluders.push(p);
    }
    ctx.addBlocker(box);
    audio.barricadeDeploy(center.x, center.y + 0.7, center.z);
  }

  get center(): THREE.Vector3 { return this.model.group.position; }

  damage(amount: number) {
    if (this.done || amount <= 0) return;
    this.hp -= amount; this.damageTaken += amount;
    this.hitFlash = 0.08;
    if (Math.random() < 0.35) audio.barricadeHit(this.center.x, this.center.y + 0.8, this.center.z);
    if (this.hp <= 0) this.destroy(true);
  }

  update(dt: number) {
    if (this.done) return;
    const g = this.model.group;
    if (g.scale.y < 1) { g.scale.y = Math.min(1, g.scale.y + dt / 0.25); g.updateMatrixWorld(true); }
    this.life -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.flick += dt;
    const lamp = this.model.lamp.material as THREE.MeshStandardMaterial;
    const low = this.hp < KIT_TUNING.bulwark.hp * 0.35 || this.life < 4;
    lamp.emissiveIntensity = this.hitFlash > 0 ? 4 : low ? (Math.sin(this.flick * 18) > 0 ? 2.6 : 0.2) : 2.2;
    if (this.life <= 0) this.destroy(false);
  }

  destroy(broken: boolean) {
    if (this.done) return;
    this.done = true;
    const c = this.center;
    if (broken) {
      this.ctx.effects.glassShatter(tmpA.set(c.x, c.y + 0.8, c.z));
      audio.barricadeBreak(c.x, c.y + 0.7, c.z);
      this.ctx.announce('BARRICADE DESTROYED');
    } else {
      audio.barricadeFold(c.x, c.y + 0.7, c.z);
    }
  }

  dispose() {
    for (const p of this.model.plates) {
      const i = this.ctx.occluders.indexOf(p);
      if (i >= 0) this.ctx.occluders.splice(i, 1);
      delete p.userData.kitHit;
    }
    this.ctx.removeBlocker(this.box);
    this.ctx.scene.remove(this.model.group);
    disposeKitObject(this.model.group);
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
  shotsFired = 0;
  hitsTaken = 0;

  constructor(private ctx: KitContext, from: THREE.Vector3, dx: number, dz: number) {
    this.model = buildDecoy();
    const l = Math.hypot(dx, dz) || 1;
    this.dirX = dx / l; this.dirZ = dz / l;
    this.feet = from.clone();
    this.model.group.position.copy(this.feet);
    this.model.group.rotation.y = Math.atan2(-this.dirX, -this.dirZ);
    ctx.scene.add(this.model.group);
    this.syncEye();
    audio.decoyDeploy(from.x, from.y + 1, from.z);
  }

  active(): boolean { return !this.done && this.popT < 0; }

  hit(amount: number) {
    if (!this.active() || amount <= 0) return;
    this.hp -= amount; this.hitsTaken++;
    this.hitFlash = 0.1;
    if (this.hp <= 0) this.pop(true);
  }

  private syncEye() { this.eye.set(this.feet.x, this.feet.y + 1.45, this.feet.z); }

  private pop(shot: boolean) {
    if (this.popT >= 0) return;
    this.popT = 0;
    audio.decoyPop(this.feet.x, this.feet.y + 1, this.feet.z);
    if (shot) this.ctx.announce('DECOY DOWN');
  }

  update(dt: number) {
    if (this.done) return;
    const T = KIT_TUNING.phantom;
    const g = this.model.group;
    if (this.popT >= 0) {
      // glitch-out: flatten and flare, then gone
      this.popT += dt;
      const k = Math.min(1, this.popT / 0.3);
      g.scale.set(1 + k * 0.6, Math.max(0.02, 1 - k), 1 + k * 0.6);
      this.model.mat.opacity = 0.9 * (1 - k);
      if (k >= 1) this.done = true;
      return;
    }
    this.age += dt; this.life -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const running = this.age < T.runFor;
    if (running) {
      const before = tmpA.copy(this.feet);
      this.ctx.moveCollide(this.feet, this.dirX * T.speed * dt, this.dirZ * T.speed * dt, 0.3);
      // Blocked? Stop and hold where it is instead of moonwalking into a wall.
      if (before.distanceTo(this.feet) < T.speed * dt * 0.2) this.age = T.runFor;
      const ph = this.age * 9;
      this.model.lLeg.rotation.x = Math.sin(ph) * 0.6;
      this.model.rLeg.rotation.x = -Math.sin(ph) * 0.6;
    } else {
      this.model.lLeg.rotation.x *= 0.8; this.model.rLeg.rotation.x *= 0.8;
    }
    g.position.copy(this.feet);
    this.syncEye();
    // Face the nearest visible hostile once holding, like a real rifleman would.
    const threat = this.nearestHostile(40);
    if (!running && threat) g.rotation.y = Math.atan2(-(threat.x - this.feet.x), -(threat.z - this.feet.z));
    // Hologram shimmer: base 0.5, random scan flicker, bright flash when hit.
    this.model.mat.opacity = this.hitFlash > 0 ? 0.95 : 0.42 + Math.random() * 0.14 + (Math.sin(this.age * 31) > 0.93 ? -0.3 : 0);
    this.fireT -= dt;
    if (this.fireT <= 0) {
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

  dispose() {
    this.ctx.scene.remove(this.model.group);
    disposeKitObject(this.model.group);
    this.model.mat.dispose();
  }
}

// ------------------------------------------------------------ director ----
export class KitDirector {
  kit: KitId;
  charge: KitCharge;
  uses = 0;
  elapsed = 0;
  /** Lifetime stats for the debrief / tests. */
  stats = { darts: 0, tags: 0, barricades: 0, barricadeDamage: 0, decoys: 0, decoyHits: 0 };
  private darts: SonarDart[] = [];
  private walls: Barricade[] = [];
  private decoys: HoloDecoy[] = [];
  private tags = new Map<object, number>();
  private markers: THREE.Sprite[] = [];
  private markerMat: THREE.SpriteMaterial;
  private wasReady = true;

  constructor(private ctx: KitContext, kit: KitId = 'recon') {
    this.kit = kit;
    // Deploy with the kit ready: the first fight is where a new player learns the key.
    this.charge = new KitCharge(KIT_DEFS[kit].cooldown, true);
    this.markerMat = makeSonarMarkerMaterial();
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(this.markerMat);
      s.scale.set(0.034, 0.034, 1);
      s.renderOrder = 51;
      s.visible = false;
      ctx.scene.add(s);
      this.markers.push(s);
    }
  }

  get def(): KitDef { return KIT_DEFS[this.kit]; }

  /** Swap kits (pause menu). Live gadgets stay out; the new kit starts cold. */
  setKit(id: KitId): boolean {
    if (id === this.kit) return false;
    this.kit = id;
    this.charge.reset(KIT_DEFS[id].cooldown, !KIT_TUNING.swapStartsCold);
    this.wasReady = this.charge.ready;
    this.ctx.announce(`FIELD KIT — ${KIT_DEFS[id].name} · ${KIT_DEFS[id].ability.toUpperCase()}`);
    return true;
  }

  /** Z pressed. Returns true when the ability actually went out. */
  activate(): boolean {
    if (!this.ctx.playerAlive()) return false;
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
    return true;
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
    if (!this.ctx.canPlaceBox(p.box)) {
      this.ctx.announce('NO ROOM FOR BARRICADE — FACE OPEN GROUND');
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
    this.ctx.announce('DECOY OUT — HOSTILES WILL TRACK IT');
    return true;
  }

  /** A kill landed: shave the cooldown. */
  onKill(count = 1) {
    for (let i = 0; i < count; i++) this.charge.refund(KIT_TUNING.killRefund);
  }

  /** Sonar tag a hostile for `seconds`. */
  tag(ref: object, seconds: number) {
    if ((this.tags.get(ref) ?? 0) <= 0) this.stats.tags++;
    this.tags.set(ref, Math.max(this.tags.get(ref) ?? 0, seconds));
  }

  isRevealed(ref: object): boolean { return (this.tags.get(ref) ?? 0) > 0; }

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
      if (w.done) continue;
      const d = tmpA.set(w.center.x, w.center.y + 0.7, w.center.z).distanceTo(pos);
      if (d < radius) {
        const dmg = T.blastDamage * THREE.MathUtils.lerp(1, 0.4, d / radius);
        w.damage(dmg);
      }
    }
    for (const d of this.decoys) if (d.active() && d.eye.distanceTo(pos) < radius) d.hit(KIT_TUNING.phantom.hp);
  }

  update(dt: number) {
    this.elapsed += dt;
    this.charge.tick(dt);
    // Charged (by time or a kill refund): chime + ticker so the player knows to use it.
    if (this.charge.ready && !this.wasReady && this.ctx.playerAlive()) {
      audio.kitReady();
      this.ctx.announce(`${this.def.ability.toUpperCase()} READY — PRESS ${KIT_KEY}`);
    }
    this.wasReady = this.charge.ready;
    for (const d of this.darts) d.update(dt);
    for (const w of this.walls) w.update(dt);
    for (const d of this.decoys) d.update(dt);
    this.darts = this.reap(this.darts);
    this.walls = this.reap(this.walls, w => { this.stats.barricadeDamage += w.damageTaken; });
    this.decoys = this.reap(this.decoys, d => { this.stats.decoyHits += d.hitsTaken; });
    // tags + through-wall markers
    for (const [ref, t] of this.tags) {
      const left = t - dt;
      if (left <= 0) this.tags.delete(ref); else this.tags.set(ref, left);
    }
    let i = 0;
    if (this.tags.size) {
      for (const h of this.ctx.hostiles()) {
        if (i >= this.markers.length) break;
        const left = this.tags.get(h.ref);
        if (!left || !h.alive()) continue;
        const s = this.markers[i++];
        s.position.set(h.pos.x, h.pos.y + 2.2, h.pos.z);
        s.visible = left > 0.8 || Math.sin(left * 30) > 0; // blink out as the tag fades
      }
    }
    for (; i < this.markers.length; i++) this.markers[i].visible = false;
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
    for (const d of this.darts) live.push({ kind: 'dart', label: 'SONAR', timeLeft: d.timeLeft, total: R.firstPulse + R.pulseEvery * (R.pulses - 1) + 0.8, detail: d.stuck ? `PING ${d.pulsesFired}/${R.pulses}` : 'IN FLIGHT' });
    for (const w of this.walls) if (!w.done) live.push({ kind: 'barricade', label: 'BARRICADE', timeLeft: Math.max(0, w.life), total: B.life, health: Math.max(0, w.hp / B.hp), detail: `${Math.max(0, Math.ceil(w.hp))} HP` });
    for (const d of this.decoys) if (d.active()) live.push({ kind: 'decoy', label: 'DECOY', timeLeft: Math.max(0, d.life), total: P.life, health: Math.max(0, d.hp / P.hp), detail: `${d.hitsTaken} ROUNDS DRAWN` });
    let tagged = 0;
    for (const t of this.tags.values()) if (t > 0) tagged++;
    return {
      id: this.kit, name: this.def.name, ability: this.def.ability, key: KIT_KEY,
      ready: this.charge.ready, pct: this.charge.pct, cooldownLeft: this.charge.left,
      live, tagged,
      // Onboarding: the prompt shows for the first 20 s of a deployment until the kit is used.
      hint: this.uses === 0 && this.elapsed < 20,
      blurb: this.def.blurb, rule: this.def.rule,
    };
  }

  /** Match over: fold everything away quietly (no announcements after the whistle). */
  quiet() {
    for (const w of this.walls) w.done = true;
    for (const d of this.decoys) d.done = true;
    for (const d of this.darts) d.done = true;
    this.darts = this.reap(this.darts);
    this.walls = this.reap(this.walls);
    this.decoys = this.reap(this.decoys);
  }

  dispose() {
    this.quiet();
    for (const s of this.markers) this.ctx.scene.remove(s);
    this.markerMat.map?.dispose();
    this.markerMat.dispose();
  }
}
