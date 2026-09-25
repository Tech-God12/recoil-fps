// Recoil FPS — Scorestreaks.
// Kills, headshots and objectives bank points inside one life. Crossing a threshold
// arms that streak; it stays in your pocket through death (CoD rules) until you call it
// in. Kills made BY streaks never feed the next streak — you earn the chopper with your
// rifle, not with the sentry. UAV → Precision Airstrike → Sentry Gun → Attack Helicopter
// → Tactical Nuke.
import * as THREE from 'three';
import { audio } from './audio';
import type { Effects } from './effects';
import { buildChopper, buildJet, buildSentry, buildUav, makeUavMarkerMaterial, type ChopperModel, type SentryModel } from './streak-models';

export type StreakId = 'uav' | 'airstrike' | 'sentry' | 'chopper' | 'nuke';

export interface StreakDef {
  id: StreakId;
  name: string;
  short: string;
  cost: number;
  desc: string;
  /** Seconds the streak stays on the field (0 = instant). */
  duration: number;
  icon: string;
}

// Ladder pricing: points reset on death, and a strong life banks 800–1500 (8–15
// kills mixed with headshots/objectives). The old top end (1500/2500) needed
// 15–25 kills in ONE life — the chopper and nuke were decorative. The new curve
// (3 / 6 / 8–9 / 12 / 20 kills) puts the UAV in every hot life, the chopper in
// great ones, and the nuke in legendary ones. Pinned by streak earnability tests.
export const STREAK_LADDER: readonly StreakDef[] = [
  { id: 'uav', name: 'UAV', short: 'UAV', cost: 300, duration: 30, icon: '◬', desc: 'Recon drone paints every hostile on the radar and through walls for 30 s.' },
  { id: 'airstrike', name: 'Precision airstrike', short: 'Strike', cost: 600, duration: 0, icon: '✈', desc: 'Designate a point. Two fast-movers carpet a 30 m line through it.' },
  { id: 'sentry', name: 'Sentry gun', short: 'Sentry', cost: 850, duration: 60, icon: '⌖', desc: 'Auto-turret placed where you stand. Guns anything it sees for 60 s.' },
  { id: 'chopper', name: 'Attack helicopter', short: 'Chopper', cost: 1200, duration: 45, icon: '✱', desc: 'Gunship orbits over you and works the ground with a chin gun for 45 s.' },
  { id: 'nuke', name: 'Tactical nuke', short: 'Nuke', cost: 2000, duration: 10, icon: '☢', desc: '10 s countdown. Everything on the field dies. In the arena, the match is yours.' },
];

export const STREAK_POINTS = { kill: 100, headshot: 150, objective: 250, assist: 50 } as const;

export function streakDef(id: StreakId): StreakDef {
  return STREAK_LADDER.find(s => s.id === id)!;
}

/**
 * Pure progression state. No three.js, so the rules are unit-testable in Node:
 *  - points accumulate within a life and reset to 0 on death;
 *  - each threshold can be claimed once per life;
 *  - earned streaks persist across deaths until consumed;
 *  - the same streak is never held twice.
 */
export class StreakLadder {
  points = 0;
  lifetimePoints = 0;
  earned: StreakId[] = [];
  private claimed = new Set<StreakId>();

  constructor(private readonly ladder: readonly StreakDef[] = STREAK_LADDER) {}

  /** Add points; returns the streaks that were armed by this addition, in ladder order. */
  addPoints(n: number): StreakDef[] {
    if (n <= 0) return [];
    this.points += n;
    this.lifetimePoints += n;
    const out: StreakDef[] = [];
    for (const def of this.ladder) {
      if (this.points < def.cost || this.claimed.has(def.id)) continue;
      this.claimed.add(def.id);
      if (this.earned.includes(def.id)) continue;
      this.earned.push(def.id);
      out.push(def);
    }
    return out;
  }

  has(id: StreakId): boolean { return this.earned.includes(id); }

  /** Spend an armed streak. */
  consume(id: StreakId): boolean {
    const i = this.earned.indexOf(id);
    if (i < 0) return false;
    this.earned.splice(i, 1);
    return true;
  }

  /** Death: progress resets, armed streaks are kept. */
  onDeath(): void {
    this.points = 0;
    this.claimed.clear();
  }

  /** Next unclaimed threshold this life, with progress toward it. */
  next(): { def: StreakDef; remaining: number; pct: number; from: number } | null {
    let from = 0;
    for (const def of this.ladder) {
      if (this.claimed.has(def.id)) { from = def.cost; continue; }
      return { def, remaining: def.cost - this.points, pct: Math.min(1, (this.points - from) / (def.cost - from)), from };
    }
    return null;
  }

  claimedThisLife(id: StreakId): boolean { return this.claimed.has(id); }
}

/** Anything a streak can shoot: mission hostiles and TDM bravo bots both fit. */
export interface StreakTarget {
  pos: THREE.Vector3;   // feet
  alive(): boolean;
  /** Apply damage; returns true if this hit killed the target (engine credits the kill). */
  damage(amount: number, source: StreakId): boolean;
}

export interface StreakContext {
  scene: THREE.Scene;
  effects: Effects;
  occluders: THREE.Object3D[];
  half: number;
  isTDM: boolean;
  groundHeight(x: number, z: number): number;
  playerFeet(): THREE.Vector3;
  playerEye(): THREE.Vector3;
  playerDir(): THREE.Vector3;
  playerAlive(): boolean;
  targets(): StreakTarget[];
  /** Explosion at a point: damages targets AND the player, glass, particles, audio, shake. */
  blast(pos: THREE.Vector3, radius: number, maxDamage: number, source: StreakId): void;
  /** Camera ray against world + targets; used to designate the strike point. */
  aimPoint(): THREE.Vector3 | null;
  /** Is the ground footprint free of solids? (sentry placement) */
  canPlace(pos: THREE.Vector3): boolean;
  announce(text: string, spoken?: string): void;
  shake(amount: number): void;
  /** Nuke resolved: TDM ends as a win, missions lose every live hostile. */
  onNuke(): void;
}

export interface ActiveStreakHud { id: StreakId; name: string; timeLeft: number; total: number; detail?: string }

export interface StreakHud {
  points: number;
  next: { name: string; cost: number; pct: number; remaining: number } | null;
  ladder: { id: StreakId; name: string; short: string; cost: number; icon: string; key: string; ready: boolean; claimed: boolean; active: boolean }[];
  active: ActiveStreakHud[];
  designating: boolean;
  uav: boolean;
  nukeCountdown: number | null;
  /** Set for one HUD tick when a strike is confirmed (reticle flash). */
  lastEvent?: string;
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// ---------------------------------------------------------------------------------
// Sentry gun
// ---------------------------------------------------------------------------------
const SENTRY_RANGE = 42;
const SENTRY_RPM = 660;
const SENTRY_DMG = 13;
const SENTRY_TURN = 5.5; // rad/s
class Sentry {
  model: SentryModel;
  life: number;
  kills = 0;
  private target: StreakTarget | null = null;
  private scanT = 0;
  private fireCD = 0;
  private yaw: number;
  private pitch = 0;
  private wantYaw: number;
  private wantPitch = 0;
  private ledT = 0;
  private headPos = new THREE.Vector3();

  constructor(private ctx: StreakContext, pos: THREE.Vector3, facingYaw: number) {
    this.model = buildSentry();
    this.model.group.position.copy(pos);
    this.model.group.rotation.y = facingYaw;
    this.yaw = this.wantYaw = 0;
    ctx.scene.add(this.model.group);
    this.life = streakDef('sentry').duration;
  }

  private headWorld(): THREE.Vector3 {
    return this.model.pitchPivot.getWorldPosition(this.headPos);
  }

  private hasLOS(t: StreakTarget): boolean {
    const from = this.headWorld();
    _a.set(t.pos.x, t.pos.y + 1.1, t.pos.z);
    _b.subVectors(_a, from);
    const d = _b.length();
    if (d > SENTRY_RANGE || d < 0.5) return false;
    ray.set(from, _b.normalize());
    ray.far = d - 0.3;
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  update(dt: number) {
    this.life -= dt;
    this.scanT -= dt;
    this.fireCD -= dt;
    this.ledT += dt;
    (this.model.led.material as THREE.MeshStandardMaterial).emissiveIntensity = this.target ? 3.5 : 1.2 + Math.sin(this.ledT * 6) * 1.0;
    if (this.scanT <= 0) {
      this.scanT = 0.2;
      if (this.target && (!this.target.alive() || !this.hasLOS(this.target))) this.target = null;
      if (!this.target) {
        let best: StreakTarget | null = null, bd = Infinity;
        const head = this.headWorld();
        for (const t of this.ctx.targets()) {
          if (!t.alive()) continue;
          const d = t.pos.distanceTo(head);
          if (d < bd && d <= SENTRY_RANGE && this.hasLOS(t)) { bd = d; best = t; }
        }
        if (best) this.target = best;
      }
    }
    // aim
    const head = this.headWorld();
    if (this.target) {
      _a.set(this.target.pos.x, this.target.pos.y + 1.05, this.target.pos.z).sub(head);
      // local frame: group yaw applied first
      // world → group-local: apply Ry(-gy). three's Ry(θ): x' = c·x + s·z, z' = -s·x + c·z
      const gy = this.model.group.rotation.y;
      const c = Math.cos(gy), sn = Math.sin(gy);
      const lx = c * _a.x - sn * _a.z;
      const lz = sn * _a.x + c * _a.z;
      this.wantYaw = Math.atan2(-lx, -lz);
      this.wantPitch = Math.atan2(_a.y, Math.hypot(lx, lz));
    } else {
      // idle sweep
      this.wantYaw = Math.sin(this.ledT * 0.6) * 0.9;
      this.wantPitch = 0;
    }
    let dy = this.wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    const step = SENTRY_TURN * dt;
    this.yaw += Math.abs(dy) < step ? dy : Math.sign(dy) * step;
    const dp = this.wantPitch - this.pitch;
    this.pitch += Math.abs(dp) < step ? dp : Math.sign(dp) * step;
    this.model.yawPivot.rotation.y = this.yaw;
    this.model.pitchPivot.rotation.x = this.pitch; // Rx(+α) tips the -Z barrel upward
    const fm = this.model.flash.material as THREE.MeshBasicMaterial;
    fm.opacity = Math.max(0, fm.opacity - dt * 20);
    // fire
    if (this.target && this.fireCD <= 0 && Math.abs(dy) < 0.09 && Math.abs(dp) < 0.09) {
      this.fireCD = 60 / SENTRY_RPM;
      const mz = this.model.muzzles[Math.floor(Math.random() * 2)].getWorldPosition(_b);
      const d = this.target.pos.distanceTo(head);
      const hit = Math.random() < Math.max(0.35, 0.92 - d / SENTRY_RANGE * 0.6);
      _c.set(this.target.pos.x, this.target.pos.y + 0.6 + Math.random() * 0.9, this.target.pos.z);
      if (!hit) { _c.x += (Math.random() - 0.5) * 1.6; _c.z += (Math.random() - 0.5) * 1.6; _c.y += (Math.random() - 0.5) * 1.2; }
      this.ctx.effects.tracer(mz, _c);
      fm.opacity = 1; this.model.flash.rotation.z = Math.random() * Math.PI;
      audio.sentryFireSpatial(mz.x, mz.y, mz.z);
      if (hit) {
        this.ctx.effects.blood(_c);
        if (this.target.damage(SENTRY_DMG, 'sentry')) { this.kills++; this.target = null; }
      } else {
        this.ctx.effects.impact(_c.setY(this.ctx.groundHeight(_c.x, _c.z) + 0.02), _a.set(0, 1, 0));
      }
    }
  }

  dispose() {
    this.ctx.scene.remove(this.model.group);
    this.model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}

// ---------------------------------------------------------------------------------
// Attack helicopter
// ---------------------------------------------------------------------------------
const CHOPPER_ALT = 26;
const CHOPPER_RADIUS = 24;
const CHOPPER_SPEED = 13;
const CHOPPER_DMG = 11;
class Chopper {
  model: ChopperModel;
  life: number;
  kills = 0;
  private pos = new THREE.Vector3();
  private angle = 0;
  private center = new THREE.Vector3();
  private arriving = true;
  private target: StreakTarget | null = null;
  private scanT = 0;
  private burstLeft = 0;
  private burstCD = 1.2;
  private roundCD = 0;
  private rotorHandle: ReturnType<typeof audio.rotorLoop> | null = null;
  private bank = 0;
  private velPrev = new THREE.Vector3();

  constructor(private ctx: StreakContext) {
    this.model = buildChopper();
    this.life = streakDef('chopper').duration + 6; // +6 covers the fly-in
    const pf = ctx.playerFeet();
    this.center.set(pf.x, 0, pf.z);
    // spawn at the map edge on the far side from the player, above the fog line
    const edge = ctx.half + 60;
    const a = Math.atan2(pf.z, pf.x) + Math.PI + (Math.random() - 0.5);
    this.pos.set(Math.cos(a) * edge, CHOPPER_ALT + 14, Math.sin(a) * edge);
    this.angle = Math.atan2(this.pos.z - this.center.z, this.pos.x - this.center.x);
    this.model.group.position.copy(this.pos);
    ctx.scene.add(this.model.group);
    try { this.rotorHandle = audio.rotorLoop(this.pos.x, this.pos.y, this.pos.z); } catch { this.rotorHandle = null; }
  }

  private gunLOS(t: StreakTarget): boolean {
    const from = this.model.muzzle.getWorldPosition(_a);
    _b.set(t.pos.x, t.pos.y + 1.0, t.pos.z).sub(from);
    const d = _b.length();
    if (d > 90) return false;
    ray.set(from, _b.normalize());
    ray.far = d - 0.4;
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  update(dt: number) {
    this.life -= dt;
    // follow the player's position loosely so the orbit stays over the fight
    if (this.ctx.playerAlive()) {
      const pf = this.ctx.playerFeet();
      this.center.x += (pf.x - this.center.x) * Math.min(1, dt * 0.35);
      this.center.z += (pf.z - this.center.z) * Math.min(1, dt * 0.35);
    }
    const lim = this.ctx.half - 4;
    this.center.x = THREE.MathUtils.clamp(this.center.x, -lim, lim);
    this.center.z = THREE.MathUtils.clamp(this.center.z, -lim, lim);
    const prev = this.velPrev.copy(this.pos);
    if (this.arriving) {
      const want = _a.set(this.center.x + Math.cos(this.angle) * CHOPPER_RADIUS, CHOPPER_ALT, this.center.z + Math.sin(this.angle) * CHOPPER_RADIUS);
      const to = _b.subVectors(want, this.pos);
      const d = to.length();
      if (d < 3) this.arriving = false;
      else this.pos.addScaledVector(to.normalize(), Math.min(d, 42 * dt));
    } else {
      this.angle += (CHOPPER_SPEED / CHOPPER_RADIUS) * dt;
      const wx = this.center.x + Math.cos(this.angle) * CHOPPER_RADIUS;
      const wz = this.center.z + Math.sin(this.angle) * CHOPPER_RADIUS;
      const wy = CHOPPER_ALT + Math.sin(this.angle * 2.3) * 1.5;
      this.pos.x += (wx - this.pos.x) * Math.min(1, dt * 2.2);
      this.pos.z += (wz - this.pos.z) * Math.min(1, dt * 2.2);
      this.pos.y += (wy - this.pos.y) * Math.min(1, dt * 2.2);
    }
    // heading from actual velocity; bank into the turn
    const vx = this.pos.x - prev.x, vz = this.pos.z - prev.z;
    const speed = Math.hypot(vx, vz) / Math.max(dt, 1e-4);
    if (speed > 0.5) {
      const heading = Math.atan2(-vx, -vz); // model nose is -Z
      let dh = heading - this.model.group.rotation.y;
      while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      this.model.group.rotation.y += dh * Math.min(1, dt * 3);
      const wantBank = this.arriving ? 0 : -0.42;
      this.bank += (wantBank - this.bank) * Math.min(1, dt * 1.5);
    }
    this.model.body.rotation.z = this.bank;
    this.model.body.rotation.x = this.arriving ? -0.18 : -0.08;
    this.model.group.position.copy(this.pos);
    this.model.rotor.rotation.y += dt * 38;
    this.model.tailRotor.rotation.x += dt * 60;
    (this.model.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = (Math.sin(this.life * 9) > 0.6) ? 4 : 0.3;
    this.rotorHandle?.move(this.pos.x, this.pos.y, this.pos.z);
    const fm = this.model.flash.material as THREE.MeshBasicMaterial;
    fm.opacity = Math.max(0, fm.opacity - dt * 18);

    // targeting
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.3;
      if (this.target && (!this.target.alive() || !this.gunLOS(this.target))) this.target = null;
      if (!this.target && !this.arriving) {
        let best: StreakTarget | null = null, bd = Infinity;
        for (const t of this.ctx.targets()) {
          if (!t.alive()) continue;
          const d = t.pos.distanceTo(this.pos);
          if (d < bd && this.gunLOS(t)) { bd = d; best = t; }
        }
        this.target = best;
      }
    }
    // point the chin gun
    if (this.target) {
      const gunWorld = this.model.gun.getWorldPosition(_a);
      _b.set(this.target.pos.x, this.target.pos.y + 0.9, this.target.pos.z);
      this.model.gun.lookAt(_b);
      this.model.gun.rotateY(Math.PI); // lookAt points +Z at target; barrels are -Z
      // burst fire
      this.burstCD -= dt;
      if (this.burstLeft <= 0 && this.burstCD <= 0) {
        this.burstLeft = 10 + Math.floor(Math.random() * 6);
        this.burstCD = 1.0 + Math.random() * 0.8;
        audio.chopperGunSpatial(gunWorld.x, gunWorld.y, gunWorld.z, this.burstLeft);
      }
      this.roundCD -= dt;
      if (this.burstLeft > 0 && this.roundCD <= 0) {
        this.burstLeft--;
        this.roundCD = 0.05;
        const mz = this.model.muzzle.getWorldPosition(_a);
        const hit = Math.random() < 0.5;
        _c.set(this.target.pos.x, this.target.pos.y + 0.5 + Math.random() * 1.0, this.target.pos.z);
        if (!hit) { _c.x += (Math.random() - 0.5) * 3.2; _c.z += (Math.random() - 0.5) * 3.2; _c.y = this.ctx.groundHeight(_c.x, _c.z) + 0.05; }
        this.ctx.effects.tracer(mz, _c);
        fm.opacity = 1; this.model.flash.rotation.z = Math.random() * Math.PI;
        if (hit) {
          this.ctx.effects.blood(_c);
          if (this.target.damage(CHOPPER_DMG, 'chopper')) { this.kills++; this.target = null; }
        } else {
          this.ctx.effects.impact(_c, _b.set(0, 1, 0));
        }
      }
    } else {
      this.model.gun.rotation.set(0.25, 0, 0);
    }
  }

  quiet() { this.rotorHandle?.stop(); this.rotorHandle = null; }

  dispose() {
    this.rotorHandle?.stop();
    this.ctx.scene.remove(this.model.group);
    this.model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}

// ---------------------------------------------------------------------------------
// Precision airstrike
// ---------------------------------------------------------------------------------
const STRIKE_ALT = 48;
const STRIKE_SPEED = 95;
const STRIKE_BOMBS = 7;
const STRIKE_SPACING = 5;
/** Bomb radius (9 m) plus a margin: the nearest splash can never reach the designator. */
export const STRIKE_DANGER_CLOSE = 16;
class Airstrike {
  jets: THREE.Group[] = [];
  private pos = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private t = 0;
  private bombsDropped = 0;
  private bombTimer = 0;
  private released = false;
  private flybyPlayed = false;
  private whistled = false;
  done = false;
  private readonly leadIn = 190;

  constructor(private ctx: StreakContext, private target: THREE.Vector3, approachDir: THREE.Vector3) {
    this.dir.set(approachDir.x, 0, approachDir.z).normalize();
    if (this.dir.lengthSq() < 0.01) this.dir.set(0, 0, -1);
    this.pos.copy(target).addScaledVector(this.dir, -this.leadIn);
    this.pos.y = STRIKE_ALT;
    for (let i = 0; i < 2; i++) {
      const j = buildJet();
      j.visible = false;
      ctx.scene.add(j);
      this.jets.push(j);
    }
  }

  update(dt: number) {
    this.t += dt;
    if (this.done) return;
    this.pos.addScaledVector(this.dir, STRIKE_SPEED * dt);
    // distance along the run: negative before the target, positive after
    const along = _a.subVectors(this.pos, this.target).dot(this.dir);
    if (!this.flybyPlayed && along > -150) {
      this.flybyPlayed = true;
      audio.jetFlyby(this.target.x, STRIKE_ALT, this.target.z);
    }
    if (!this.whistled && along > -140) { this.whistled = true; audio.bombWhistle(); }
    const yaw = Math.atan2(-this.dir.x, -this.dir.z);
    // wingman echelon-right
    const right = _b.set(this.dir.z, 0, -this.dir.x);
    this.jets.forEach((j, i) => {
      j.visible = true;
      j.position.copy(this.pos).addScaledVector(right, i * 9).addScaledVector(this.dir, -i * 7);
      j.position.y += i * 2;
      j.rotation.set(0, yaw, 0);
    });
    // bombs walk along the line centred on the target, starting when the lead is ~1.5 s short
    if (!this.released && along > -35) this.released = true;
    if (this.released && this.bombsDropped < STRIKE_BOMBS) {
      this.bombTimer -= dt;
      if (this.bombTimer <= 0) {
        this.bombTimer = 0.11;
        const k = this.bombsDropped - (STRIKE_BOMBS - 1) / 2;
        _c.copy(this.target).addScaledVector(this.dir, k * STRIKE_SPACING);
        _c.x += (Math.random() - 0.5) * 1.5; _c.z += (Math.random() - 0.5) * 1.5;
        _c.y = this.ctx.groundHeight(_c.x, _c.z) + 0.3;
        this.ctx.blast(_c.clone(), 9, 210, 'airstrike');
        this.bombsDropped++;
      }
    }
    if (along > 260 && this.bombsDropped >= STRIKE_BOMBS) this.done = true;
  }

  dispose() {
    for (const j of this.jets) {
      this.ctx.scene.remove(j);
      j.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  }
}

// ---------------------------------------------------------------------------------
// UAV
// ---------------------------------------------------------------------------------
class Uav {
  life: number;
  private drone: ReturnType<typeof buildUav>;
  private angle = Math.random() * Math.PI * 2;
  private markers: THREE.Sprite[] = [];
  private markerMat: THREE.SpriteMaterial;

  constructor(private ctx: StreakContext) {
    this.life = streakDef('uav').duration;
    this.drone = buildUav();
    ctx.scene.add(this.drone.group);
    this.markerMat = makeUavMarkerMaterial();
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(this.markerMat);
      s.scale.set(0.042, 0.042, 1);
      s.renderOrder = 50;
      s.visible = false;
      ctx.scene.add(s);
      this.markers.push(s);
    }
  }

  update(dt: number) {
    this.life -= dt;
    this.angle += dt * 0.09;
    const r = this.ctx.half * 0.7;
    const g = this.drone.group;
    g.position.set(Math.cos(this.angle) * r, 70, Math.sin(this.angle) * r);
    // velocity is (-sin a, cos a); the -Z nose rotated by θ points (-sin θ, -cos θ) ⇒ θ = π - a
    g.rotation.set(0, Math.PI - this.angle, 0);
    g.rotateZ(-0.22); // gentle bank into the circle
    this.drone.prop.rotation.z += dt * 50;
    let i = 0;
    const blink = this.life < 5 ? (Math.sin(this.life * 12) > 0) : true;
    for (const t of this.ctx.targets()) {
      if (!t.alive() || i >= this.markers.length) continue;
      const s = this.markers[i++];
      s.position.set(t.pos.x, t.pos.y + 2.25, t.pos.z);
      s.visible = blink;
    }
    for (; i < this.markers.length; i++) this.markers[i].visible = false;
  }

  dispose() {
    this.ctx.scene.remove(this.drone.group);
    this.drone.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const s of this.markers) this.ctx.scene.remove(s);
    this.markerMat.map?.dispose();
    this.markerMat.dispose();
  }
}

// ---------------------------------------------------------------------------------
// Director — owns the ladder and every live streak entity
// ---------------------------------------------------------------------------------
export class StreakDirector {
  ladder = new StreakLadder();
  private sentries: Sentry[] = [];
  private chopper: Chopper | null = null;
  private strikes: Airstrike[] = [];
  private uav: Uav | null = null;
  designating = false;
  private nukeT = -1;
  private nukeTick = 0;
  private nukeFired = false;
  /** Keys shown on the HUD; the engine binds the actual KeyboardEvent codes. */
  keyLabels: Record<StreakId, string> = { uav: '3', airstrike: '4', sentry: '5', chopper: '6', nuke: '7' };
  private lastEvent = '';
  private lastEventT = 0;

  constructor(private ctx: StreakContext) {}

  get uavActive(): boolean { return !!this.uav; }
  get nukeCountdown(): number | null { return this.nukeT >= 0 ? this.nukeT : null; }
  get anyActive(): boolean { return !!this.uav || !!this.chopper || this.sentries.length > 0 || this.strikes.length > 0 || this.nukeT >= 0; }

  /** Combat points from the player's own weapons/objectives. Announces newly armed streaks. */
  addPoints(n: number): StreakDef[] {
    const armed = this.ladder.addPoints(n);
    for (const def of armed) {
      audio.streakReady();
      this.ctx.announce(`${def.name} ready — press ${this.keyLabels[def.id]}`, `${def.name.toLowerCase()} ready.`);
    }
    return armed;
  }

  onPlayerDeath() {
    this.ladder.onDeath();
    this.designating = false;
  }

  /** Try to call in a streak. Returns false if not armed / not usable right now. */
  activate(id: StreakId): boolean {
    if (!this.ladder.has(id) || !this.ctx.playerAlive()) return false;
    switch (id) {
      case 'uav': {
        if (this.uav) { this.uav.life = streakDef('uav').duration; this.ladder.consume(id); this.ctx.announce('UAV time extended'); return true; }
        this.ladder.consume(id);
        this.uav = new Uav(this.ctx);
        audio.streakDeploy();
        this.ctx.announce('UAV online — hostiles painted', 'UAV online.');
        return true;
      }
      case 'airstrike': {
        // toggles designation; the strike is consumed on confirm
        this.designating = !this.designating;
        if (this.designating) this.ctx.announce('Designate target — click to confirm, right-click to abort', 'Mark the target.');
        return true;
      }
      case 'sentry': {
        const feet = this.ctx.playerFeet();
        const dir = this.ctx.playerDir();
        const p = _a.set(feet.x + dir.x * 1.9, 0, feet.z + dir.z * 1.9);
        p.y = this.ctx.groundHeight(p.x, p.z);
        if (Math.abs(p.x) > this.ctx.half - 1 || Math.abs(p.z) > this.ctx.half - 1 || !this.ctx.canPlace(p)) {
          this.ctx.announce('No room — the sentry needs clear ground ahead');
          return false;
        }
        this.ladder.consume(id);
        if (this.sentries.length >= 2) this.sentries.shift()!.dispose();
        this.sentries.push(new Sentry(this.ctx, p.clone(), Math.atan2(dir.x, dir.z) + Math.PI));
        audio.streakDeploy();
        this.ctx.announce('Sentry gun deployed', 'Sentry gun deployed.');
        return true;
      }
      case 'chopper': {
        if (this.chopper) { this.ctx.announce('Gunship already on station'); return false; }
        this.ladder.consume(id);
        this.chopper = new Chopper(this.ctx);
        audio.streakDeploy();
        this.ctx.announce('Attack helicopter inbound', 'Attack helicopter inbound.');
        return true;
      }
      case 'nuke': {
        if (this.nukeT >= 0) return false;
        this.ladder.consume(id);
        this.nukeT = streakDef('nuke').duration;
        this.nukeTick = 0;
        audio.streakDeploy();
        this.ctx.announce('Tactical nuke inbound — 10 seconds', 'Tactical nuke inbound. Ten seconds.');
        return true;
      }
    }
  }

  /** LMB while designating. */
  confirmStrike(): boolean {
    if (!this.designating) return false;
    const point = this.ctx.aimPoint();
    if (!point) { this.ctx.announce('No target — aim at the ground'); return false; }
    if (point.distanceTo(this.ctx.playerFeet()) < STRIKE_DANGER_CLOSE) { this.ctx.announce(`Danger close — pick a point ${STRIKE_DANGER_CLOSE} m out or more`); return false; }
    this.designating = false;
    this.ladder.consume('airstrike');
    // The run crosses your line of sight: the jets rip through the target left-to-right
    // and the bomb line never walks back toward you.
    const toTarget = _b.subVectors(point, this.ctx.playerFeet());
    const dir = _c.set(toTarget.z, 0, -toTarget.x);
    this.strikes.push(new Airstrike(this.ctx, point.clone(), dir));
    audio.streakDeploy();
    this.ctx.announce('Strike package inbound — stand clear', 'Fast movers inbound. Stand clear.');
    this.lastEvent = 'strike'; this.lastEventT = 0.6;
    return true;
  }

  cancelDesignation() { this.designating = false; }

  update(dt: number) {
    this.lastEventT -= dt;
    if (this.lastEventT <= 0) this.lastEvent = '';
    if (this.uav) { this.uav.update(dt); if (this.uav.life <= 0) { this.uav.dispose(); this.uav = null; this.ctx.announce('UAV offline'); } }
    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const s = this.sentries[i];
      s.update(dt);
      if (s.life <= 0) { s.dispose(); this.sentries.splice(i, 1); this.ctx.announce(`Sentry expired — ${s.kills} kill${s.kills === 1 ? '' : 's'}`); }
    }
    if (this.chopper) {
      this.chopper.update(dt);
      if (this.chopper.life <= 0) { const k = this.chopper.kills; this.chopper.dispose(); this.chopper = null; this.ctx.announce(`Gunship RTB — ${k} kill${k === 1 ? '' : 's'}`, 'Gunship returning to base.'); }
    }
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.update(dt);
      if (s.done) { s.dispose(); this.strikes.splice(i, 1); }
    }
    if (this.nukeT >= 0) {
      const before = Math.ceil(this.nukeT);
      this.nukeT -= dt;
      const after = Math.ceil(this.nukeT);
      if (after !== before && after > 0) audio.nukeSiren(after <= 3);
      this.nukeTick += dt;
      if (this.nukeT <= 0 && !this.nukeFired) {
        this.nukeFired = true;
        this.nukeT = -1;
        audio.nukeBlast();
        this.ctx.shake(3);
        this.ctx.onNuke();
      }
    }
  }

  hud(): StreakHud {
    const next = this.ladder.next();
    const active: ActiveStreakHud[] = [];
    if (this.uav) active.push({ id: 'uav', name: 'UAV', timeLeft: this.uav.life, total: streakDef('uav').duration });
    for (const s of this.sentries) active.push({ id: 'sentry', name: 'Sentry', timeLeft: s.life, total: streakDef('sentry').duration, detail: `${s.kills} kills` });
    if (this.chopper) active.push({ id: 'chopper', name: 'Gunship', timeLeft: Math.max(0, this.chopper.life), total: streakDef('chopper').duration + 6, detail: `${this.chopper.kills} kills` });
    for (const s of this.strikes) if (!s.done) active.push({ id: 'airstrike', name: 'Strike', timeLeft: 1, total: 1, detail: 'Inbound' });
    return {
      points: this.ladder.points,
      next: next ? { name: next.def.name, cost: next.def.cost, pct: next.pct, remaining: next.remaining } : null,
      ladder: STREAK_LADDER.map(d => ({
        id: d.id, name: d.name, short: d.short, cost: d.cost, icon: d.icon, key: this.keyLabels[d.id],
        ready: this.ladder.has(d.id), claimed: this.ladder.claimedThisLife(d.id),
        active: (d.id === 'uav' && !!this.uav) || (d.id === 'chopper' && !!this.chopper) || (d.id === 'sentry' && this.sentries.length > 0) || (d.id === 'nuke' && this.nukeT >= 0) || (d.id === 'airstrike' && (this.designating || this.strikes.length > 0)),
      })),
      active,
      designating: this.designating,
      uav: !!this.uav,
      nukeCountdown: this.nukeCountdown,
      lastEvent: this.lastEvent || undefined,
    };
  }

  /** Match over: cut looping audio (the rotor) while the debrief is up, keep the scene as-is. */
  quiet() { this.chopper?.quiet(); this.designating = false; }

  dispose() {
    this.uav?.dispose(); this.uav = null;
    for (const s of this.sentries) s.dispose(); this.sentries = [];
    this.chopper?.dispose(); this.chopper = null;
    for (const s of this.strikes) s.dispose(); this.strikes = [];
  }
}
