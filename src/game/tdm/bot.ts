// Recoil FPS — Warehouse TDM bot: one class, both teams.
//
// The same TDMBot drives your four ALPHA allies and the five BRAVO hostiles; the
// only difference is which side of the kill feed they land on. Behaviour follows
// the arena spec: personalities (pusher / flanker / holder), randomised burst fire
// with distance-scaled accuracy, strafing, smart grenade flushes, cover falls at
// low health, flank manoeuvres when contact is lost, overwatch perches, and squad
// callouts that actually share intel.
import * as THREE from 'three';
import { buildArmoredSoldier, type SoldierModel } from '../models';
import { NavGrid } from '../ai';
import type { Effects } from '../effects';
import { armorOf, botDamageToBot, botRawDamage, type ArmorLevel, type TeamId } from './armor';

export type TdmState = 'PATROL' | 'ENGAGE' | 'FLANK' | 'PUSH' | 'COVER' | 'DEAD';
export type TdmCallout = 'contact' | 'flank' | 'grenade' | 'mandown' | 'fallback' | 'push';

export interface TdmBotCtx {
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  groundHeight(x: number, z: number): number;
  moveCollide(p: THREE.Vector3, dx: number, dz: number, r: number): void;
  effects: Effects;
  playerFeet(): THREE.Vector3;
  playerEye(): THREE.Vector3;
  playerAlive(): boolean;
  playerArmor(): ArmorLevel;
  damagePlayer(amount: number, from: THREE.Vector3, head: boolean): void;
  /** Team-flavoured squad chatter: the engine decides ally vs hostile phrasing. */
  onCallout(kind: TdmCallout, pos: THREE.Vector3, team: TeamId): void;
  aiThrowGrenade(from: THREE.Vector3, target: THREE.Vector3, team: TeamId): void;
  onBotFire(pos: THREE.Vector3): void;
}

export interface TdmHost {
  nav: NavGrid;
  /** Whole roster of the bot's own team (the bot filters itself and the dead out). */
  allies(bot: TDMBot): readonly TDMBot[];
  /** Whole roster of the opposing bot team. */
  hostiles(bot: TDMBot): readonly TDMBot[];
  /** Is the human player an enemy of this team? (bravo → true) */
  playerIsHostile(team: TeamId): boolean;
  killed(victim: TDMBot, killer: TDMBot | 'YOU' | 'FRAG', headshot: boolean): void;
}

export interface BotOptions {
  name: string;
  team: TeamId;
  armor: ArmorLevel;
  /** 0 cautious … 1 aggressive. Drives pusher / flanker / holder behaviour. */
  personality: number;
  /** Overwatch post: this bot holds an elevated position instead of roaming. */
  perch?: THREE.Vector3;
}

/** Firing model, quoted verbatim by the arena docs and pinned by the tests. */
export const BOT_ACCURACY = {
  close: 0.82, far: 0.43, farRange: 65, firstBulletBonus: 0.12,
  burstMin: 2, burstMax: 5, shotMin: 0.12, shotMax: 0.18,
  strafeMin: 2.2, strafeMax: 3.0, headChance: 0.22, perchHeadChance: 0.3,
  pushTick: 0.045, pushRange: [6, 28] as [number, number],
  grenadeFlushChance: 0.08, grenadeOpenChance: 0.015,
  grenadeCooldown: [10, 17] as [number, number],
  lowHealth: 0.35,
} as const;

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Mid-yard patrol anchors — the contested real estate worth rotating through. */
const PATROL_POINTS: [number, number][] = [
  [0, 0], [-18, 12], [18, -10], [-26, -20], [26, 20], [-12, -24], [12, 24], [-34, 4], [34, -4], [0, -22], [0, 22],
];
const INNER_RADIUS = 20, OUTER_RADIUS = 34;

export class TDMBot {
  readonly name: string;
  readonly team: TeamId;
  readonly armor: ArmorLevel;
  readonly maxHp: number;
  readonly personality: number;
  /** p > 0.58 — takes the fight to you. */
  readonly pusher: boolean;
  /** 0.35 ≤ p ≤ 0.75 — looks for the angled route when contact breaks. */
  readonly flanker: boolean;
  readonly perch: THREE.Vector3 | null;

  model: SoldierModel;
  pos = new THREE.Vector3();
  yaw = 0;
  hp: number;
  kills = 0;
  deaths = 0;
  state: TdmState = 'PATROL';
  dead = false;
  deadAge = 0;
  stunTimer = 0;
  /** True while this bot can see a hostile — the radar burns red for its blip. */
  seesEnemy = false;

  private nav: NavGrid;
  private ctx: TdmBotCtx;
  private host: TdmHost;
  private target: TDMBot | 'PLAYER' | null = null;
  private hasLOS = false;
  private losTimer = 0;
  private stateTime = 0;
  private lastKnown = new THREE.Vector3();
  private lastSeenT = 999;
  private burstLeft = 0;
  private burstTimer = 0;
  private burstIdx = 0;
  private burstGap = 0;
  private strafeDir = 0;
  private strafeT = 0;
  private path: THREE.Vector3[] | null = null;
  private pathGoal = new THREE.Vector3();
  private repathT = 0;
  private moveTarget: THREE.Vector3 | null = null;
  private coverPos: THREE.Vector3 | null = null;
  private grenadeCD = 4;
  private reactTimer = 0;
  private flinch = 0;
  private shotPose = 0;
  private walkPhase = 0;
  private locomotion = 0;
  private lastX = 0;
  private lastZ = 0;
  private stuckT = 0;
  private escapeDir = 0;
  private escapeT = 0;
  private deathT = -1;
  private calloutT = 0;

  constructor(ctx: TdmBotCtx, host: TdmHost, opts: BotOptions) {
    this.ctx = ctx; this.host = host;
    this.name = opts.name; this.team = opts.team; this.armor = opts.armor;
    this.maxHp = armorOf(opts.armor).hp; this.hp = this.maxHp;
    this.personality = opts.personality;
    this.pusher = opts.personality > 0.58;
    this.flanker = opts.personality >= 0.35 && opts.personality <= 0.75;
    this.perch = opts.perch ? opts.perch.clone() : null;
    this.nav = host.nav;
    this.model = buildArmoredSoldier(opts.armor, opts.team);
  }

  private get mates() { return this.host.allies(this); }
  /** The team this bot is shooting at. */
  get opposing(): TeamId { return this.team === 'alpha' ? 'bravo' : 'alpha'; }
  get personalityKind(): 'pusher' | 'flanker' | 'holder' {
    return this.pusher ? 'pusher' : this.flanker ? 'flanker' : 'holder';
  }

  /* ==================== LIFECYCLE ==================== */

  /** (Re)deploy at a spawn point. Called on match start and on every respawn. */
  deploy(at: THREE.Vector3, yaw: number) {
    this.pos.copy(at);
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.dead = false; this.deadAge = 0; this.deathT = -1;
    this.state = 'PATROL'; this.stateTime = 0;
    this.target = null; this.hasLOS = false; this.seesEnemy = false;
    this.lastSeenT = 999; this.losTimer = Math.random() * 0.15;
    this.burstLeft = 0; this.burstTimer = 0; this.burstIdx = 0; this.burstGap = 0;
    this.strafeDir = 0; this.strafeT = 0;
    this.path = null; this.moveTarget = null; this.coverPos = null;
    this.grenadeCD = 4 + Math.random() * 5;
    // Reaction grace after a spawn, so nobody is shot by a bot that just materialised.
    this.reactTimer = 0.45 + Math.random() * 0.5;
    this.flinch = 0; this.shotPose = 0; this.stuckT = 0; this.escapeT = 0; this.stunTimer = 0;
    this.lastX = at.x; this.lastZ = at.z;
    const g = this.model.group;
    g.visible = true; g.position.copy(at); g.rotation.set(0, yaw, 0);
    const p = this.model.parts;
    p.torso.position.y = 0.95; p.torso.rotation.set(0, 0, 0);
    for (const part of [p.head, p.lLeg, p.rLeg, p.lShin, p.rShin, p.lArm, p.rArm, p.rifle]) part.rotation.set(0, 0, 0);
  }

  eyePos(out = tmp.clone()): THREE.Vector3 { return out.set(this.pos.x, this.pos.y + 1.58, this.pos.z); }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.model.parts.muzzle.getWorldPosition(out);
    return out;
  }

  takeDamage(amount: number, isHead: boolean, from: TDMBot | 'YOU' | 'FRAG' = 'YOU'): boolean {
    if (this.dead) return false;
    // Armor reduction lives here, exactly as it does for the player: the vest's
    // head factor is the last thing between a headshot and the health pool.
    const spec = armorOf(this.armor);
    this.hp -= isHead ? amount * spec.headMul : amount;
    this.flinch = isHead ? 0.4 : 0.22;
    if (this.hp <= 0) { this.die(from); return true; }
    if (from !== 'FRAG') {
      const at = from === 'YOU' ? this.ctx.playerFeet() : from.pos;
      this.lastKnown.copy(at);
      this.lastSeenT = 0;
      this.target ??= from === 'YOU' ? 'PLAYER' : from;
      if (this.state === 'PATROL') { this.setState('ENGAGE'); this.reactTimer = 0.12 + Math.random() * 0.2; }
    }
    return false;
  }

  applyStun(t: number) {
    if (this.dead) return;
    this.stunTimer = Math.max(this.stunTimer, t);
    this.flinch = 0.5;
  }

  private die(killer: TDMBot | 'YOU' | 'FRAG') {
    this.dead = true; this.state = 'DEAD'; this.deathT = 0; this.deadAge = 0;
    this.deaths++;
    this.burstLeft = 0; this.seesEnemy = false;
    this.ctx.effects.bloodDecal(this.pos, Math.max(this.ctx.groundHeight(this.pos.x, this.pos.z), this.pos.y - 1.2));
    if (killer !== 'FRAG' && killer !== 'YOU') killer.kills++;
    this.host.killed(this, killer, this.flinch > 0.3);
  }

  private setState(s: TdmState) {
    if (this.state === 'DEAD' || this.state === s) return;
    this.state = s; this.stateTime = 0;
    if (s !== 'COVER') this.coverPos = null;
    if (s !== 'PUSH' && s !== 'FLANK') this.moveTarget = null;
    this.path = null;
  }

  private call(kind: TdmCallout) {
    if (this.calloutT > 0) return;
    this.calloutT = 3.5 + Math.random() * 3;
    this.ctx.onCallout(kind, this.pos, this.team);
  }

  /* ==================== PERCEPTION ==================== */

  private losTo(point: THREE.Vector3): boolean {
    const eye = this.eyePos(tmp.clone());
    const dist = eye.distanceTo(point);
    if (dist > 70) return false;
    const dir = tmp2.copy(point).sub(eye).normalize();
    ray.set(eye, dir); ray.far = Math.max(0.2, dist - 0.35);
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  /** Refresh target + line of sight. Runs on the 0.08–0.15 s perception tick. */
  private perceive() {
    const candidates: { key: TDMBot | 'PLAYER'; pos: THREE.Vector3; eye: THREE.Vector3 }[] = [];
    if (this.host.playerIsHostile(this.team) && this.ctx.playerAlive()) {
      candidates.push({ key: 'PLAYER', pos: this.ctx.playerFeet(), eye: this.ctx.playerEye() });
    }
    for (const b of this.host.hostiles(this)) if (!b.dead) candidates.push({ key: b, pos: b.pos, eye: b.eyePos() });

    let best: typeof candidates[number] | null = null;
    let bestScore = -Infinity;
    let bestVisible = false;
    for (const c of candidates) {
      const d = this.pos.distanceTo(c.pos);
      if (d > 72) continue;
      // One raycast per candidate per tick: near the front arc geometry decides
      // visibility, and a hostile at your back has to come from a team-mate's
      // callout instead (that is what comms are for).
      const visible = this.facingDot(c.pos) > -0.35 && this.losTo(c.eye);
      if (visible) { this.lastKnown.copy(c.pos); this.lastSeenT = 0; }
      const score = (visible ? 100 : 0) - d + (c.key === 'PLAYER' ? 4 : 0);
      if (score > bestScore) { bestScore = score; best = c; bestVisible = visible; }
    }
    if (!best) { this.hasLOS = false; this.seesEnemy = false; return; }
    const acquired = this.target === null;
    this.target = best.key;
    // Reuse the per-candidate result: the winner was already raycast this tick.
    this.hasLOS = bestVisible;
    this.seesEnemy = this.hasLOS;
    if (this.hasLOS && acquired) {
      this.call('contact');
      // Tell the squad: every ally within earshot picks up the contact point.
      for (const mate of this.mates) {
        if (mate === this || mate.dead) continue;
        if (mate.pos.distanceTo(this.pos) > 50) continue;
        if (mate.state === 'PATROL' || mate.state === 'COVER') mate.receiveIntel(best.pos, best.key === 'PLAYER' ? 'PLAYER' : best.key);
      }
      if (this.state === 'PATROL') { this.setState('ENGAGE'); this.reactTimer = 0.16 + Math.random() * 0.22; }
    }
  }

  /** Gunfire within earshot: turn toward it and treat it as a contact point. */
  hear(pos: THREE.Vector3, radius: number) {
    if (this.dead) return;
    if (this.pos.distanceTo(pos) > radius) return;
    if (this.target === null) { this.lastKnown.copy(pos); this.lastSeenT = Math.min(this.lastSeenT, 1.4); }
    if (this.state === 'PATROL') {
      this.setState(this.perch ? 'COVER' : 'ENGAGE');
      this.moveTarget = null;
    }
  }

  /** Squad comms: a team-mate's contact becomes your contact. */
  receiveIntel(at: THREE.Vector3, key: TDMBot | 'PLAYER') {
    if (this.dead) return;
    this.lastKnown.copy(at);
    this.lastSeenT = Math.min(this.lastSeenT, 0.7);
    if (this.target === null) this.target = key;
  }

  private facingDot(point: THREE.Vector3): number {
    const fwd = tmp.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const flat = tmp2.set(point.x - this.pos.x, 0, point.z - this.pos.z).normalize();
    return fwd.dot(flat);
  }

  private targetPos(): THREE.Vector3 | null {
    if (this.target === 'PLAYER') return this.ctx.playerAlive() ? this.ctx.playerFeet() : null;
    if (this.target instanceof TDMBot) return this.target.dead ? null : this.target.pos;
    return null;
  }

  private aimPoint(): THREE.Vector3 | null {
    if (this.target === 'PLAYER') return this.ctx.playerAlive() ? this.ctx.playerEye() : null;
    if (this.target instanceof TDMBot) return this.target.dead ? null : this.target.eyePos();
    return null;
  }

  /* ==================== MOVEMENT ==================== */

  private goTo(target: THREE.Vector3, speed: number, dt: number): boolean {
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (dist < 0.5) { this.path = null; return true; }
    this.repathT -= dt;
    if (!this.nav.lineFree(this.pos.x, this.pos.z, target.x, target.z)) {
      if (this.repathT <= 0 || this.pathGoal.distanceTo(target) > 2.5) {
        this.path = this.nav.path(this.pos, target);
        this.pathGoal.copy(target); this.repathT = 1.4 + Math.random() * 0.8;
      }
    } else this.path = null;

    let wp = target;
    if (this.path && this.path.length) {
      wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.8) { this.path.shift(); wp = this.path[0] ?? target; }
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const bx = this.pos.x, bz = this.pos.z;
    this.step((dx / d) * speed * dt, (dz / d) * speed * dt);
    if (Math.hypot(this.pos.x - bx, this.pos.z - bz) < speed * dt * 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 0.4) {
        // Commit to one sidestep direction and hold it — re-rolling every tick is
        // what makes blocked AI vibrate in place.
        if (this.escapeT <= 0) { this.escapeDir = this.escapeDir === 0 ? (Math.random() < 0.5 ? 1 : -1) : -this.escapeDir; this.escapeT = 0.9; }
        this.stuckT = 0;
      }
      if (this.escapeT > 0) {
        this.escapeT -= dt;
        this.step(((-dz / d) * this.escapeDir * 0.9 + (dx / d) * 0.35) * speed * dt * 1.5,
          ((dx / d) * this.escapeDir * 0.9 + (dz / d) * 0.35) * speed * dt * 1.5);
      }
    } else this.stuckT = 0;
    return false;
  }

  /** Horizontal step + terrain support, clamped to the perch box when posted. */
  private step(dx: number, dz: number) {
    this.ctx.moveCollide(this.pos, dx, dz, 0.36);
    if (this.perch) {
      const r = 3.4;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, this.perch.x - r, this.perch.x + r);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, this.perch.z - r, this.perch.z + r);
      this.pos.y = Math.max(this.perch.y, this.ctx.groundHeight(this.pos.x, this.pos.z));
      return;
    }
    this.pos.y = this.ctx.groundHeight(this.pos.x, this.pos.z);
  }

  private patrolTarget(): THREE.Vector3 {
    if (Math.random() < 0.35) {
      const home = this.team === 'alpha' ? 1 : -1;
      const a = Math.random() * Math.PI * 2, r = INNER_RADIUS + Math.random() * (OUTER_RADIUS - INNER_RADIUS);
      return new THREE.Vector3(Math.cos(a) * r, 0, Math.abs(Math.sin(a) * r) * home);
    }
    const [x, z] = PATROL_POINTS[(Math.random() * PATROL_POINTS.length) | 0];
    return new THREE.Vector3(x, 0, z);
  }

  private findCover(): THREE.Vector3 | null {
    const threat = this.lastKnown;
    let best: THREE.Vector3 | null = null, bestScore = Infinity;
    for (const node of this.ctx.coverNodes) {
      // Bots keep to their own elevation: roof nodes belong to roof bots.
      if (Math.abs(node.y - this.pos.y) > 0.6) continue;
      if (this.perch && node.distanceTo(this.perch) > 6) continue;
      const d = node.distanceTo(this.pos);
      if (d > 26 || node.distanceTo(threat) < 6) continue;
      if (this.mates.some(m => !m.dead && m !== this && m.state === 'COVER' && m.pos.distanceTo(node) < 1.5)) continue;
      const eye = tmp.set(node.x, node.y + 1.3, node.z).clone();
      const dir = tmp2.set(threat.x - eye.x, threat.y + 0.6 - eye.y, threat.z - eye.z);
      const len = dir.length(); dir.normalize();
      ray.set(eye, dir); ray.far = Math.max(0.3, len - 0.4);
      if (ray.intersectObjects(this.ctx.occluders, false).length === 0) continue;   // no real cover
      const score = d * 0.8 + Math.abs(node.distanceTo(threat) - 14) * 0.5 + Math.random() * 2.5;
      if (score < bestScore) { bestScore = score; best = node; }
    }
    return best ? best.clone() : null;
  }

  private flankPoint(target: THREE.Vector3): THREE.Vector3 {
    // 90° ± 34° off the target axis, 8–18 m out: a genuine angle, not a crab walk.
    const base = Math.atan2(this.pos.x - target.x, this.pos.z - target.z);
    const angle = base + (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + (Math.random() - 0.5) * 1.18);
    const radius = 8 + Math.random() * 10;
    const p = new THREE.Vector3(target.x + Math.sin(angle) * radius, 0, target.z + Math.cos(angle) * radius);
    const [cx, cz] = this.nav.nearestFree(this.nav.toCell(p.x), this.nav.toCell(p.z));
    return p.set(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
  }

  private pushPoint(target: THREE.Vector3): THREE.Vector3 {
    // Close on an angle: pushing bots arrive offset ±5 m instead of queueing up.
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const side = (Math.random() - 0.5) * 10;
    const advance = 4 + Math.random() * 6;
    const p = new THREE.Vector3(
      this.pos.x + (dx / d) * advance + (-dz / d) * side, 0,
      this.pos.z + (dz / d) * advance + (dx / d) * side,
    );
    const [cx, cz] = this.nav.nearestFree(this.nav.toCell(p.x), this.nav.toCell(p.z));
    return p.set(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
  }

  /* ==================== COMBAT ==================== */

  private tryFire(dt: number, distance: number) {
    if (this.reactTimer > 0 || this.stunTimer > 0) return;
    if (!this.hasLOS || !this.aimPoint()) { this.burstLeft = 0; return; }
    if (this.friendlyInLine()) { this.burstLeft = 0; return; }   // friendly fire discipline
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer > 0) return;
      this.shoot(distance);
      this.burstLeft--;
      this.burstTimer = BOT_ACCURACY.shotMin + Math.random() * (BOT_ACCURACY.shotMax - BOT_ACCURACY.shotMin);
      if (this.burstLeft <= 0) this.burstGap = 0.42 + Math.random() * 0.7;
      return;
    }
    this.burstGap -= dt;
    if (this.burstGap > 0) return;
    this.burstLeft = BOT_ACCURACY.burstMin + ((Math.random() * (BOT_ACCURACY.burstMax - BOT_ACCURACY.burstMin + 1)) | 0);
    this.burstIdx = 0;
    this.burstTimer = 0;
  }

  private friendlyInLine(): boolean {
    const aim = this.aimPoint();
    if (!aim) return false;
    const eye = this.eyePos(tmp.clone());
    const dir = tmp2.copy(aim).sub(eye).normalize();
    for (const mate of this.mates) {
      if (mate.dead || mate === this) continue;
      const to = new THREE.Vector3(mate.pos.x - eye.x, mate.pos.y + 1 - eye.y, mate.pos.z - eye.z);
      const dist = to.length();
      if (dist > 24) continue;
      if (to.normalize().dot(dir) > 0.985) return true;
    }
    return false;
  }

  private shoot(distance: number) {
    const aim = this.aimPoint();
    if (!aim) return;
    // Accuracy: 0.82 in your face, 0.43 at 65 m, +0.12 on the first round of a burst.
    const falloff = THREE.MathUtils.clamp((distance - 8) / (BOT_ACCURACY.farRange - 8), 0, 1);
    let acc = THREE.MathUtils.lerp(BOT_ACCURACY.close, BOT_ACCURACY.far, falloff)
      + (this.burstIdx === 0 ? BOT_ACCURACY.firstBulletBonus : 0);
    if (this.strafeT > 0 && this.strafeDir !== 0) acc *= 0.88;
    if (this.perch) acc *= 1.06;
    acc = Math.min(0.95, acc);
    this.burstIdx++;
    this.shotPose = 1;
    const muzzle = this.muzzleWorld();
    this.ctx.effects.enemyMuzzle(muzzle);
    this.ctx.onBotFire(this.pos);
    const head = Math.random() < (this.perch ? BOT_ACCURACY.perchHeadChance : BOT_ACCURACY.headChance);
    if (Math.random() > acc) {
      // A miss still throws a tracer past the target so incoming fire reads.
      const miss = aim.clone();
      miss.x += (Math.random() - 0.5) * 2.2; miss.y += (Math.random() - 0.5) * 1.4; miss.z += (Math.random() - 0.5) * 2.2;
      this.ctx.effects.tracer(muzzle, miss, true);
      return;
    }
    const hit = aim.clone();
    if (!head) hit.y -= 0.42;
    this.ctx.effects.tracer(muzzle, hit, true);
    if (this.target === 'PLAYER') {
      // Raw bot damage goes to the engine, which applies the PLAYER's armor — the
      // reduction lives in exactly one place per side (spec §4).
      this.ctx.damagePlayer(botRawDamage(head, Math.random()), this.pos, head);
    } else if (this.target instanceof TDMBot && !this.target.dead) {
      this.ctx.effects.blood(hit);
      this.target.takeDamage(botDamageToBot(this.target.armor, head, Math.random()), head, this);
    }
  }

  private tryGrenade() {
    if (this.grenadeCD > 0 || this.stunTimer > 0 || this.perch) return;
    const tpos = this.targetPos();
    if (!tpos) return;
    const d = this.pos.distanceTo(tpos);
    if (d < 8 || d > 34) return;
    const flush = !this.hasLOS && this.lastSeenT < 6;            // they are behind cover
    let chance = flush ? BOT_ACCURACY.grenadeFlushChance : BOT_ACCURACY.grenadeOpenChance;
    if (this.pusher) chance *= 1.3;
    if (d > 18) chance *= 1.5;
    if (Math.random() > chance) return;
    const [lo, hi] = BOT_ACCURACY.grenadeCooldown;
    this.grenadeCD = lo + Math.random() * (hi - lo);
    this.call('grenade');
    const aim = this.lastKnown.clone();
    aim.x += (Math.random() - 0.5) * 3; aim.z += (Math.random() - 0.5) * 3;
    this.ctx.aiThrowGrenade(this.eyePos(tmp.clone()), aim, this.team);
  }

  /* ==================== STATE MACHINE ==================== */

  private updateState(dt: number) {
    this.stateTime += dt;
    this.lastSeenT += dt;
    this.calloutT = Math.max(0, this.calloutT - dt);
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);
    this.reactTimer = Math.max(0, this.reactTimer - dt);
    const low = this.hp < this.maxHp * BOT_ACCURACY.lowHealth;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.08 + Math.random() * 0.07;     // 0.08–0.15 s perception tick
      this.perceive();
    }

    // Squad comms for the blind: borrow a mate's contact when they have eyes.
    if (!this.target && this.lastSeenT > 2) {
      for (const mate of this.mates) {
        if (mate === this || mate.dead || !mate.seesEnemy) continue;
        if (mate.pos.distanceTo(this.pos) > 50) continue;
        this.receiveIntel(mate.lastKnown, mate.target ?? 'PLAYER');
        break;
      }
    }

    // Badly hurt: break contact and get behind something solid.
    if (low && !this.perch && this.state !== 'COVER') {
      const node = this.findCover();
      if (node) { this.coverPos = node; this.setState('COVER'); this.call('fallback'); }
    }

    switch (this.state) {
      case 'PATROL': {
        if (this.perch) {
          // Overwatch holds the platform, sweeping the approach lanes.
          const sweep = this.team === 'alpha' ? 0 : Math.PI;
          const aim = new THREE.Vector3(
            this.pos.x + Math.sin(sweep + Math.sin(this.stateTime * 0.25) * 0.7) * 20, this.pos.y,
            this.pos.z + Math.cos(sweep + Math.sin(this.stateTime * 0.25) * 0.7) * 20);
          this.faceTowards(aim, dt * 0.6);
          this.strafe(dt, this.pos);
          break;
        }
        if (!this.moveTarget || this.pos.distanceTo(this.moveTarget) < 1.4) this.moveTarget = this.patrolTarget();
        this.goTo(this.moveTarget, this.pusher ? 4.6 : 3.9, dt);
        if (this.target) this.setState('ENGAGE');
        break;
      }

      case 'ENGAGE': {
        const tpos = this.targetPos();
        if (tpos && this.hasLOS) {
          this.faceTowards(this.aimPoint() ?? tpos, dt);
          if (this.stunTimer <= 0) this.strafe(dt, tpos);
          this.tryFire(dt, this.pos.distanceTo(tpos));
          this.tryGrenade();
          if (this.pusher && !this.perch) {
            const d = this.pos.distanceTo(tpos);
            const [lo, hi] = BOT_ACCURACY.pushRange;
            const mateNear = this.mates.some(m => !m.dead && m !== this && m.pos.distanceTo(this.pos) < 12);
            if (d > lo && d < hi && (mateNear || Math.random() < 0.6) && Math.random() < BOT_ACCURACY.pushTick) {
              this.setState('PUSH'); this.call('push');
            }
          }
        } else {
          const t = this.targetPos() ?? (this.lastSeenT < 12 ? this.lastKnown : null);
          if (!t) { this.setState('PATROL'); break; }
          if (this.stateTime > 0.9 && this.flanker && !this.perch) {
            this.setState('FLANK');
          } else if (this.stateTime > 1.6 && !this.perch) {
            this.setState('PUSH');
          }
        }
        break;
      }

      case 'PUSH': {
        const tpos = this.targetPos();
        if (this.hasLOS && tpos) { this.setState('ENGAGE'); break; }
        const goal = tpos ?? this.lastKnown;
        if (!this.moveTarget) {
          this.moveTarget = this.pushPoint(goal);
          this.call('push');
        }
        if (this.goTo(this.moveTarget, 4.5, dt) || this.stateTime > 7) { this.moveTarget = null; this.setState('ENGAGE'); }
        break;
      }

      case 'FLANK': {
        const tpos = this.targetPos();
        if (this.hasLOS && tpos) {
          this.faceTowards(this.aimPoint() ?? tpos, dt);
          this.tryFire(dt, this.pos.distanceTo(tpos));
          if (this.stateTime > 0.6) this.setState('ENGAGE');
          break;
        }
        const goal = tpos ?? this.lastKnown;
        if (!this.moveTarget) { this.moveTarget = this.flankPoint(goal); this.call('flank'); }
        if (this.goTo(this.moveTarget, 4.2, dt) || this.stateTime > 9) { this.moveTarget = null; this.setState('ENGAGE'); }
        break;
      }

      case 'COVER': {
        if (!this.coverPos) { this.setState('ENGAGE'); break; }
        if (this.goTo(this.coverPos, 4.0, dt) || this.stateTime > 6) {
          if (!low) { this.coverPos = null; this.setState('ENGAGE'); break; }
          // Hug the node, peek, and keep shooting while the health pool holds.
          if (this.target) this.faceTowards(this.aimPoint() ?? this.lastKnown, dt);
          this.tryFire(dt, this.pos.distanceTo(this.lastKnown));
          this.tryGrenade();
        }
        break;
      }

      case 'DEAD':
      default:
        break;
    }
  }

  private strafe(dt: number, tpos: THREE.Vector3) {
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.7 + Math.random() * 1.1;
      this.strafeDir = Math.random() < 0.2 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    }
    if (this.strafeDir === 0) return;
    const speed = BOT_ACCURACY.strafeMin + Math.random() * (BOT_ACCURACY.strafeMax - BOT_ACCURACY.strafeMin);
    if (this.perch) {
      // Overwatch shuffles along the platform instead of orbiting the target.
      this.step(Math.sin(this.stateTime * 1.7) * speed * dt * this.strafeDir, Math.cos(this.stateTime * 0.9) * speed * dt * 0.4);
      return;
    }
    const dx = tpos.x - this.pos.x, dz = tpos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    this.step((-dz / d) * this.strafeDir * speed * dt, (dx / d) * this.strafeDir * speed * dt);
  }

  private faceTowards(point: THREE.Vector3, dt: number) {
    const want = Math.atan2(point.x - this.pos.x, point.z - this.pos.z);
    let dy = want - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 7);
  }

  /* ==================== FRAMES ==================== */

  /** Cheap per-frame pass: locomotion, yaw lerp, flinch, shot pose, death drop. */
  updateVisualFrame(dt: number) {
    const g = this.model.group;
    if (!g.visible) g.visible = true;
    g.position.copy(this.pos);
    let dy = this.yaw - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, dt * 11);
    const p = this.model.parts;
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x; this.lastZ = this.pos.z;
    const measured = Math.min(18, moved / Math.max(dt, 0.001));
    this.locomotion += (measured - this.locomotion) * (1 - Math.exp(-dt * 6));
    this.walkPhase += this.locomotion * dt * 3.5;
    const stride = Math.min(1, this.locomotion / 2.5);
    const swing = Math.sin(this.walkPhase) * 0.62 * stride;
    p.lShin.rotation.x = Math.max(0, -Math.sin(this.walkPhase)) * 0.95 * stride;
    p.rShin.rotation.x = Math.max(0, Math.sin(this.walkPhase)) * 0.95 * stride;
    p.torso.position.y = 0.95 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.014 * stride;
    this.shotPose = Math.max(0, this.shotPose - dt * 9);
    p.rifle.position.z = -0.44 + this.shotPose * 0.07;
    p.lLeg.rotation.x += (swing - p.lLeg.rotation.x) * Math.min(1, dt * 8);
    p.rLeg.rotation.x += (-swing - p.rLeg.rotation.x) * Math.min(1, dt * 8);
    const aiming = this.state === 'ENGAGE' || this.state === 'COVER' || this.state === 'PUSH' || this.state === 'FLANK';
    p.rifle.rotation.x += ((aiming ? -0.03 - this.shotPose * 0.12 : 0.38) - p.rifle.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.x += ((aiming ? 1.35 : -0.15) - p.rArm.rotation.x) * Math.min(1, dt * 6);
    p.lArm.rotation.x += ((aiming ? 1.25 : 0.1) - p.lArm.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.z += ((aiming ? -0.25 : 0) - p.rArm.rotation.z) * Math.min(1, dt * 6);
    p.lArm.rotation.z += ((aiming ? 0.3 : 0) - p.lArm.rotation.z) * Math.min(1, dt * 6);
    this.flinch = Math.max(0, this.flinch - dt * 1.6);
    p.torso.rotation.x = -this.flinch * 0.8 + stride * 0.045 - this.shotPose * 0.035;
    p.head.rotation.x = -this.flinch * 1.2;
    if (this.dead) {
      this.deathT = Math.min(1, (this.deathT < 0 ? 0 : this.deathT) + dt * 2.4);
      g.rotation.z = -this.deathT * Math.PI * 0.48;
      g.position.y = this.pos.y + this.deathT * 0.12;
    } else g.rotation.z = 0;
  }

  update(dt: number) {
    if (this.dead) { this.deadAge += dt; return; }
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      // Blinded and deafened: no aiming, no comms, barely any movement.
      this.updateState(dt * 0.2);
      return;
    }
    this.updateState(dt);
  }
}
