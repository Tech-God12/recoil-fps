// Recoil FPS — Warehouse TDM: 5v5 team deathmatch brain + match manager.
// One TDMBot class drives BOTH teams (4 AI allies + player = ALPHA, 5 AI = BRAVO).
// Pure simulation: rendering/audio enter only through the injected TDMContext.
import * as THREE from 'three';
import { buildSoldierTDM, type SoldierModel } from './models';
import { NavGrid } from './ai';
import type { Effects } from './effects';

export type TDMTeam = 'alpha' | 'bravo';
export type TDMArmor = 0 | 1 | 2;
/** Who landed the killing blow — 'player' is the human on team ALPHA. */
export type TDMKiller = TDMTeam | 'player';
export type TDMState = 'PATROL' | 'ENGAGE' | 'FLANK' | 'PUSH' | 'COVER' | 'DEAD';
export type TDMRole = 'pusher' | 'flanker' | 'holder';

/* ================= ARMOR MODEL (shared by player + bots) ================= */
export const ARMOR_HP = [150, 180, 210] as const;
export const ARMOR_HEAD = [1, 0.85, 0.75] as const;   // −0% / −15% / −25% headshot damage
export const ARMOR_BODY = [1, 0.55, 0.45] as const;   // −0% / −45% / −55% body damage
export const ARMOR_ICON = ['○', '◍', '⬢'] as const;
export const ARMOR_LABEL = ['NO ARMOR', 'LIGHT VEST', 'HEAVY VEST'] as const;
export const ARMOR_SPEED = [1.06, 1.0, 0.94] as const; // unarmored operators move fastest

export const TDM_MATCH_TIME = 150; // 2:30
export const TDM_RESPAWN = 10;     // seconds
export const TDM_DAMAGE_MUL = 0.55; // global TTK stretch applied to player weapon damage

/** Bot rifles deal 52 head / 22–30 body — three headshots drop an unarmored target. */
export const BOT_HEAD_DAMAGE = 52;
export const BOT_BODY_DAMAGE = 26;

export const ALPHA_NAMES = ['Atlas', 'Rook', 'Juno', 'Havoc'] as const;
export const ALPHA_ARMOR: TDMArmor[] = [2, 1, 0, 1];
export const BRAVO_NAMES = ['Viper', 'Reaper', 'Ghost', 'Specter', 'Wraith'] as const;
export const BRAVO_ARMOR: TDMArmor[] = [2, 1, 2, 0, 1];

const ALPHA_SPAWN_XS = [-12, -6, 0, 6, 12];
const BRAVO_SPAWN_XS = [-12, -6, 0, 6, 12];
const MID_POINTS = [
  [0, 0], [-18, 12], [18, -10], [-18, -12], [18, 12], [0, -24], [0, 24], [-28, 6], [28, -6],
] as const;

export interface TDMTarget {
  kind: 'player' | 'bot';
  bot?: TDMBot;
  feet(): THREE.Vector3;
  alive(): boolean;
}

export interface TDMContext {
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  half: number;
  effects: Effects;
  nav: NavGrid;
  moveCollide(pos: THREE.Vector3, dx: number, dz: number, radius: number): void;
  groundHeight(x: number, z: number): number;
  playerAlive(): boolean;
  playerFeet(): THREE.Vector3;
  damagePlayer(amount: number, from: THREE.Vector3, isHead: boolean): void;
  aiThrowGrenade(from: THREE.Vector3, target: THREE.Vector3, team: TDMTeam, kind: 'frag' | 'flash'): void;
  onBotFire(pos: THREE.Vector3): void;
  onBotDeath(victim: TDMBot, killerTeam: TDMKiller): void;
  onCallout(kind: 'contact' | 'push' | 'grenade' | 'fallback' | 'mandown', pos: THREE.Vector3, team: TDMTeam): void;
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();

/* ================= TDM BOT ================= */
export class TDMBot {
  readonly name: string;
  readonly team: TDMTeam;
  readonly armor: TDMArmor;
  readonly model: SoldierModel;
  readonly pos: THREE.Vector3;
  readonly maxHp: number;
  hp: number;
  yaw = 0;
  state: TDMState = 'PATROL';
  kills = 0;
  dormant = false;
  respawnT = 0;
  stunTimer = 0;
  frags = 3;
  flashes = 1;

  private personality = Math.random();
  private role: TDMRole;
  private ctx: TDMContext;
  private nav: NavGrid;
  private manager: TDMManager;

  private stateTime = 0;
  private losTimer = 0;
  private hasLOS = false;
  private target: TDMTarget | null = null;
  private readonly targetPos = new THREE.Vector3();     // live target feet (only while hasLOS)
  private readonly lastKnown = new THREE.Vector3();     // last place the target was seen
  private lastSeenT = 999;
  private hasTargetPos = false;

  private burstLeft = 0;
  private burstTimer = 0;
  private burstIdx = 0;
  private strafeDir = 0;
  private strafeT = 0;
  private strafeSpeed = 2.6;
  private grenadeCD = 6;
  private coverUsed = false;
  private coverPos: THREE.Vector3 | null = null;
  private coverWait = 0;
  private moveTarget: THREE.Vector3 | null = null;
  private path: THREE.Vector3[] | null = null;
  private repathT = 0;
  private stuckT = 0;

  // visual state
  private flinch = 0;
  private deathT = -1;
  private deadAge = 0;
  private walkPhase = 0;
  private locomotion = 0;
  private shotPose = 0;
  private crouched = false;
  private lastX = 0;
  private lastZ = 0;

  constructor(ctx: TDMContext, nav: NavGrid, manager: TDMManager, name: string, team: TDMTeam, armor: TDMArmor, spawn: THREE.Vector3) {
    this.ctx = ctx; this.nav = nav; this.manager = manager;
    this.name = name; this.team = team; this.armor = armor;
    // >0.58 pusher · 0.35–0.58 flanker · else holder
    this.role = this.personality > 0.58 ? 'pusher' : this.personality >= 0.35 ? 'flanker' : 'holder';
    this.maxHp = ARMOR_HP[armor];
    this.hp = this.maxHp;
    this.pos = spawn.clone();
    this.model = buildSoldierTDM(armor, team);
    this.model.group.position.copy(this.pos);
    this.yaw = team === 'alpha' ? 0 : Math.PI; // face the enemy half
    this.model.group.rotation.y = this.yaw;
    for (const hm of this.model.hitMeshes) (hm.userData as { enemy?: unknown }).enemy = this;
  }

  get dead() { return this.state === 'DEAD'; }
  get isPlayerAlly() { return this.team === 'alpha'; }
  eyePos(out = TMP_A) { return out.set(this.pos.x, this.pos.y + 1.55, this.pos.z); }

  addTo(scene: THREE.Scene) { scene.add(this.model.group); }

  /** Spawns/respawns: full reset at a team spawn point. */
  respawn(at: THREE.Vector3) {
    this.pos.copy(at);
    this.hp = this.maxHp;
    this.state = 'PATROL';
    this.stateTime = 0;
    this.hasLOS = false;
    this.target = null;
    this.hasTargetPos = false;
    this.lastSeenT = 999;
    this.burstLeft = 0; this.burstTimer = 0; this.burstIdx = 0;
    this.strafeDir = 0; this.strafeT = 0;
    this.grenadeCD = 4 + Math.random() * 6;
    this.coverUsed = false; this.coverPos = null;
    this.moveTarget = null; this.path = null; this.repathT = 0; this.stuckT = 0;
    this.flinch = 0; this.deathT = -1; this.deadAge = 0;
    this.stunTimer = 0;
    this.walkPhase = 0; this.locomotion = 0; this.shotPose = 0;
    this.frags = 3; this.flashes = 1;
    this.yaw = this.team === 'alpha' ? 0 : Math.PI;
    const g = this.model.group;
    g.visible = true;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0);
    g.scale.setScalar(1);
    const p = this.model.parts;
    p.torso.position.y = 0.95;
    p.torso.rotation.set(0, 0, 0);
    for (const part of [p.head, p.lLeg, p.rLeg, p.lShin, p.rShin, p.lArm, p.rArm, p.rifle]) part.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
  }

  applyStun(t: number) {
    if (this.dead) return;
    this.stunTimer = Math.max(this.stunTimer, t);
    this.flinch = 0.5;
    this.burstLeft = 0;
  }

  /** Armor is applied HERE so bot-vs-bot and player-vs-bot agree. Returns true on kill. */
  takeDamage(amount: number, isHead: boolean, byTeam: TDMKiller, fromPos?: THREE.Vector3): boolean {
    if (this.dead) return false;
    this.hp -= amount * (isHead ? ARMOR_HEAD[this.armor] : ARMOR_BODY[this.armor]);
    this.flinch = isHead ? 0.35 : 0.22;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(byTeam);
      return true;
    }
    if (fromPos) {
      this.lastKnown.copy(fromPos);
      this.hasTargetPos = false;
      this.lastSeenT = Math.min(this.lastSeenT, 1.5);
      if (this.state === 'PATROL') {
        this.state = 'ENGAGE';
        this.stateTime = 0;
        this.burstTimer = 0.3 + Math.random() * 0.3; // reaction beat before returning fire
      }
    }
    return false;
  }

  private die(byTeam: TDMKiller) {
    this.state = 'DEAD';
    this.deathT = 0;
    this.respawnT = 10; // fallback — manager normally drives this
    const surfaceY = this.ctx.groundHeight(this.pos.x, this.pos.z);
    this.ctx.effects.bloodDecal(this.pos, surfaceY);
    this.ctx.onBotDeath(this, byTeam);
  }

  /** Sight test against the world. Perception 70m, occluder raycast. */
  private checkLOS(target: TDMTarget): boolean {
    const eye = this.eyePos(TMP_A).clone();
    const tp = target.feet();
    const aim = TMP_B.set(tp.x, tp.y + 1.3, tp.z);
    const dist = eye.distanceTo(aim);
    if (dist > 70) return false;
    ray.set(eye, aim.sub(eye).normalize());
    ray.far = dist - 0.4;
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  private acquireTarget(): TDMTarget | null {
    let best: TDMTarget | null = null;
    let bestD = Infinity;
    const candidates = this.manager.targetsFor(this.team);
    for (const t of candidates) {
      if (!t.alive()) continue;
      const d = this.pos.distanceTo(t.feet());
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /* ---------------- brain (staggered ~every 3rd frame) ---------------- */
  updateLogic(dt: number) {
    if (this.state === 'DEAD' || this.stunTimer > 0) return;
    this.stateTime += dt;
    this.lastSeenT += dt;
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);

    // --- perception: nearest enemy, LOS every 0.08–0.15s ---
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.08 + Math.random() * 0.07;
      const nearest = this.acquireTarget();
      if (nearest) {
        const seen = this.checkLOS(nearest);
        if (seen) {
          if (!this.hasLOS) this.ctx.onCallout('contact', this.pos, this.team);
          this.hasLOS = true;
          this.target = nearest;
          const feet = nearest.feet();
          this.targetPos.copy(feet);
          this.lastKnown.copy(feet);
          this.hasTargetPos = true;
          this.lastSeenT = 0;
        } else if (this.target === nearest) {
          this.hasLOS = false;
        }
        // lost them for good → drop the live position, keep the memory
        if (this.lastSeenT > 6) { this.hasTargetPos = false; this.target = null; this.hasLOS = false; }
      } else {
        this.hasLOS = false;
        this.target = null;
      }
    }

    // --- squad comms: copy intel from nearby allies that have eyes on ---
    if (!this.target && this.lastSeenT > 3) {
      for (const ally of this.manager.bots) {
        if (ally === this || ally.dead || ally.team !== this.team) continue;
        if (ally.pos.distanceTo(this.pos) > 50) continue;
        const intel = ally.shareIntel();
        if (intel) {
          this.lastKnown.copy(intel);
          this.hasTargetPos = false;
          this.lastSeenT = 2.5;
          if (this.state === 'PATROL') { this.state = 'ENGAGE'; this.stateTime = 0; }
          break;
        }
      }
    }

    switch (this.state) {
      case 'PATROL': this.doPatrol(dt); break;
      case 'ENGAGE': this.doEngage(dt); break;
      case 'FLANK': this.doFlank(dt); break;
      case 'PUSH': this.doPush(dt); break;
      case 'COVER': this.doCover(dt); break;
    }
    this.tryGrenade();
  }

  /** Squad-comms hook: neighbours may copy this bot's fresh sighting. */
  shareIntel(): THREE.Vector3 | null {
    return this.hasLOS && this.target ? this.targetPos : null;
  }

  /* ---------------- states ---------------- */
  private doPatrol(dt: number) {
    this.crouched = false;
    if (this.hasTarget()) { this.enterEngage(); return; }
    if (!this.moveTarget) {
      // random mid points or a lazy orbit of the team base (10–30m)
      if (Math.random() < 0.6) {
        const mid = MID_POINTS[Math.floor(Math.random() * MID_POINTS.length)];
        this.moveTarget = new THREE.Vector3(mid[0] + (Math.random() - 0.5) * 4, 0, mid[1] + (Math.random() - 0.5) * 4);
      } else {
        const baseZ = this.team === 'alpha' ? 42 : -42;
        const a = Math.random() * Math.PI * 2;
        const r = 10 + Math.random() * 20;
        this.moveTarget = new THREE.Vector3(Math.cos(a) * r, 0, baseZ + Math.sin(a) * r * 0.5);
      }
      const [cx, cz] = this.nav.nearestFree(this.nav.toCell(this.moveTarget.x), this.nav.toCell(this.moveTarget.z));
      this.moveTarget.set(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
    }
    if (this.goTo(this.moveTarget, 3.2, dt) || this.stateTime > 20) { this.moveTarget = null; this.stateTime = 0; }
  }

  private hasTarget(): boolean {
    return this.hasLOS && !!this.target && this.target.alive();
  }

  private enterEngage() {
    if (this.state !== 'ENGAGE') { this.state = 'ENGAGE'; this.stateTime = 0; this.path = null; }
    this.moveTarget = null;
    this.coverPos = null;
    this.burstTimer = Math.max(this.burstTimer, 0.05);
  }

  private doEngage(dt: number) {
    const tgt = this.target;
    if (!this.hasTarget() || !tgt) {
      // lost sight → flankers swing wide, everyone else hunts the last position
      if (this.hasTargetPos) {
        if (this.role === 'flanker') this.enterFlank();
        else this.enterPush();
      } else if (this.lastSeenT < 12) {
        this.moveTarget = this.lastKnown.clone();
        this.state = 'PUSH';
        this.stateTime = 0;
      } else {
        this.state = 'PATROL';
        this.stateTime = 0;
      }
      return;
    }
    const dist = this.pos.distanceTo(this.targetPos);

    // low HP → break to cover once per life (holder sooner, pusher ignores it longer)
    if (!this.coverUsed && this.hp < this.maxHp * 0.35 && Math.random() < (this.role === 'pusher' ? 0.04 : 0.12)) {
      const node = this.findCover();
      if (node) {
        this.coverUsed = true;
        this.coverPos = node;
        this.state = 'COVER';
        this.stateTime = 0;
        this.ctx.onCallout('fallback', this.pos, this.team);
        return;
      }
    }

    // pusher instinct: mid-range + company (or gut feeling) → push the angle
    if (this.role === 'pusher' && dist > 6 && dist < 28 && this.grenadeCD > 3) {
      const alliesNear = this.countAlliesNear(12) >= 1;
      if ((alliesNear || Math.random() < 0.6) && Math.random() < 0.045) {
        this.enterPush();
        this.ctx.onCallout('push', this.pos, this.team);
        return;
      }
    }

    // engage: face target, strafe perpendicular, burst fire
    this.faceTarget(this.targetPos);
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      if (this.burstLeft <= 0) {
        this.burstLeft = 2 + Math.floor(Math.random() * 4); // 2–5 rounds
        this.burstIdx = 0;
        this.burstTimer = 0.1;
      } else {
        this.fireShot();
        this.burstLeft--;
        this.burstTimer = 0.12 + Math.random() * 0.06;
      }
    }
    // strafe 2.2–3.0 m/s perpendicular to the target line
    this.strafeCD(dt);
    if (this.strafeT > 0) {
      this.strafeT -= dt;
      const dx = this.pos.x - this.targetPos.x, dz = this.pos.z - this.targetPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.ctx.moveCollide(this.pos, (-dz / d) * this.strafeDir * this.strafeSpeed * dt, (dx / d) * this.strafeDir * this.strafeSpeed * dt, 0.36);
    }
    // keep a fighting distance — never hug inside 5m, never snipe past 40m while engaged
    if (dist > 40) { this.enterPush(); return; }
    if (dist < 5) {
      const dx = this.pos.x - this.targetPos.x, dz = this.pos.z - this.targetPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.ctx.moveCollide(this.pos, (dx / d) * 2.4 * dt, (dz / d) * 2.4 * dt, 0.36);
    }
  }

  private strafeCD(dt: number) {
    if (this.strafeT <= 0 && Math.random() < dt * 1.6) {
      this.strafeDir = Math.random() > 0.5 ? 1 : -1;
      this.strafeT = 0.5 + Math.random() * 0.9;
      this.strafeSpeed = 2.2 + Math.random() * 0.8;
    }
  }

  private enterFlank() {
    this.state = 'FLANK';
    this.stateTime = 0;
    this.path = null;
    this.moveTarget = null;
  }

  private doFlank(dt: number) {
    this.crouched = false;
    if (this.hasTarget() && this.stateTime > 1.2) { this.enterEngage(); return; }
    const anchor = this.hasTargetPos ? this.targetPos : this.lastKnown;
    if (!this.moveTarget) {
      // 90° ± 34° offset around the anchor, 8–18m out
      const away = TMP_A.copy(this.pos).sub(anchor); away.y = 0;
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize();
      const side = this.personality > 0.5 ? 1 : -1;
      const ang = (90 + (Math.random() - 0.5) * 68) * Math.PI / 180 * side;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const dirX = away.x * cos - away.z * sin;
      const dirZ = away.x * sin + away.z * cos;
      const r = 8 + Math.random() * 10;
      this.moveTarget = new THREE.Vector3(
        THREE.MathUtils.clamp(anchor.x + dirX * r, -this.ctx.half + 4, this.ctx.half - 4), 0,
        THREE.MathUtils.clamp(anchor.z + dirZ * r, -this.ctx.half + 4, this.ctx.half - 4));
    }
    if (this.goTo(this.moveTarget, 4.6, dt) || this.stateTime > 8) { this.moveTarget = null; this.enterEngage(); }
  }

  private enterPush() {
    this.state = 'PUSH';
    this.stateTime = 0;
    this.path = null;
    this.moveTarget = null;
  }

  private doPush(dt: number) {
    this.crouched = false;
    const anchor = this.hasTargetPos ? this.targetPos : this.lastKnown;
    if (!this.moveTarget) {
      // push with a ±5m lateral offset so squads don't stack into one column
      const dx = anchor.x - this.pos.x, dz = anchor.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const px = -dz / d, pz = dx / d;
      const off = (Math.random() < 0.5 ? -1 : 1) * 5 * Math.random();
      this.moveTarget = new THREE.Vector3(
        THREE.MathUtils.clamp(anchor.x + px * off, -this.ctx.half + 4, this.ctx.half - 4), 0,
        THREE.MathUtils.clamp(anchor.z + pz * off, -this.ctx.half + 4, this.ctx.half - 4));
    }
    if (this.hasTarget()) { this.enterEngage(); return; }
    if (this.goTo(this.moveTarget, 4.6, dt) || this.stateTime > 10) {
      this.moveTarget = null;
      if (this.lastSeenT > 8) { this.state = 'PATROL'; this.stateTime = 0; }
      else this.enterEngage();
    }
  }

  private doCover(dt: number) {
    if (!this.coverPos) { this.enterEngage(); return; }
    if (this.pos.distanceTo(this.coverPos) > 0.8) {
      this.goTo(this.coverPos, 4.8, dt);
      this.crouched = false;
      return;
    }
    this.crouched = true;
    if (this.hasTarget()) this.faceTarget(this.targetPos);
    this.coverWait -= dt;
    // peek-fire from cover while waiting out the heal-less breather
    if (this.hasTarget() && this.coverWait < 0.4) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) { this.fireShot(); this.burstLeft = Math.max(0, this.burstLeft - 1); this.burstTimer = 0.16; }
    }
    if (this.coverWait <= 0) {
      this.coverPos = null;
      this.crouched = false;
      this.burstLeft = 0;
      this.enterEngage();
    }
  }

  private findCover(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    const threat = this.hasTargetPos ? this.targetPos : this.lastKnown;
    for (const node of this.ctx.coverNodes) {
      const d = node.distanceTo(this.pos);
      if (d > 26) continue;
      if (node.distanceTo(threat) < 5) continue;
      // the node must actually BLOCK the threat's line to the cover spot
      const eye = TMP_A.set(node.x, node.y + 1.2, node.z).clone();
      const aim = TMP_B.set(threat.x, threat.y + 1.3, threat.z);
      const dist = eye.distanceTo(aim);
      ray.set(eye, aim.sub(eye).normalize());
      ray.far = dist - 0.4;
      if (ray.intersectObjects(this.ctx.occluders, false).length === 0) continue;
      const score = d * 0.6 + Math.random() * 4;
      if (score < bestScore) { bestScore = score; best = node; }
    }
    if (best) { this.coverWait = 1.6 + Math.random() * 2.2; return best.clone(); }
    return null;
  }

  private countAlliesNear(radius: number): number {
    let n = 0;
    for (const b of this.manager.bots) {
      if (b === this || b.dead || b.team !== this.team) continue;
      if (b.pos.distanceTo(this.pos) < radius) n++;
    }
    return n;
  }

  /* ---------------- grenades ---------------- */
  private tryGrenade() {
    if (this.grenadeCD > 0 || this.state === 'DEAD') return;
    if (this.state !== 'ENGAGE' && this.state !== 'PUSH' && this.state !== 'COVER') return;
    if (this.frags <= 0 && this.flashes <= 0) return;
    const anchor = this.hasTargetPos ? this.targetPos : (this.lastSeenT < 3.5 ? this.lastKnown : null);
    if (!anchor) return;
    const dist = this.pos.distanceTo(anchor);
    if (dist < 7 || dist > 32) return;

    const behindCover = !this.hasLOS && this.lastSeenT < 3;
    let chance = behindCover ? 0.08 : 0.015;
    if (this.role === 'pusher') chance *= 1.3;
    if (dist > 18) chance *= 1.5;
    if (Math.random() > chance) { this.grenadeCD = 0.8; return; }

    const useFlash = this.flashes > 0 && behindCover && Math.random() < 0.25;
    if (useFlash) this.flashes--; else this.frags--;
    this.grenadeCD = 10 + Math.random() * 7;
    this.ctx.onCallout('grenade', this.pos, this.team);
    const target = anchor.clone();
    target.x += (Math.random() - 0.5) * 2.5;
    target.z += (Math.random() - 0.5) * 2.5;
    this.eyePos(TMP_A);
    this.ctx.aiThrowGrenade(TMP_A.clone(), target, this.team, useFlash ? 'flash' : 'frag');
  }

  /* ---------------- shooting ---------------- */
  private fireShot() {
    const tgt = this.target;
    if (!tgt || !tgt.alive()) return;
    this.model.group.updateMatrixWorld(true);
    const muzzle = this.model.parts.muzzle.getWorldPosition(new THREE.Vector3());
    this.shotPose = 1;
    this.ctx.effects.enemyMuzzle(muzzle);
    this.ctx.onBotFire(muzzle);

    const aim = tgt.feet().clone();
    aim.y += 1.3;
    const dist = muzzle.distanceTo(aim);
    let acc = THREE.MathUtils.lerp(0.82, 0.43, Math.min(1, dist / 65)); // 0.82 close → 0.43 @ 65m
    if (this.burstIdx === 0) acc = Math.min(0.94, acc + 0.12);          // first bullet is the aimed one
    this.burstIdx++;

    ray.set(muzzle, TMP_B.copy(aim).sub(muzzle).normalize());
    ray.far = Math.max(0.1, dist - 0.3);
    const blocker = ray.intersectObjects(this.ctx.occluders, false)[0];
    if (blocker) { this.ctx.effects.tracer(muzzle, blocker.point, true); return; }

    if (Math.random() < acc) {
      const isHead = Math.random() < 0.16;
      this.ctx.effects.tracer(muzzle, aim, true);
      if (tgt.kind === 'player') {
        if (this.ctx.playerAlive()) {
          this.ctx.damagePlayer(isHead ? BOT_HEAD_DAMAGE : 22 + Math.random() * 8, this.pos, isHead);
        }
      } else {
        const bot = tgt.bot!;
        this.ctx.effects.blood(aim);
        if (bot.takeDamage(isHead ? BOT_HEAD_DAMAGE : BOT_BODY_DAMAGE, isHead, this.team, this.pos)) {
          this.kills++;
        }
      }
    } else {
      const miss = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.6, (Math.random() - 0.3) * 1.8, (Math.random() - 0.5) * 2.6));
      this.ctx.effects.tracer(muzzle, miss, true);
    }
  }

  /* ---------------- movement ---------------- */
  private goTo(target: THREE.Vector3, speed: number, dt: number): boolean {
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (dist < 0.6) { this.path = null; return true; }
    this.repathT -= dt;
    if (this.nav.lineFree(this.pos.x, this.pos.z, target.x, target.z)) {
      this.path = null;
    } else if (this.repathT <= 0 || !this.path || !this.path.length) {
      this.path = this.nav.path(this.pos, target);
      this.repathT = 1.2 + (this.personality * 0.6);
    }
    let wp = target;
    if (this.path && this.path.length) {
      wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.8) {
        this.path.shift();
        wp = this.path[0] ?? target;
      }
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const bx = this.pos.x, bz = this.pos.z;
    this.ctx.moveCollide(this.pos, (dx / d) * speed * dt, (dz / d) * speed * dt, 0.36);
    const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
    if (moved < speed * dt * 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 0.5) {
        // committed sidestep around the obstruction, then retry
        const side = this.personality > 0.5 ? 1 : -1;
        this.ctx.moveCollide(this.pos,
          ((-dz / d) * side * 0.9 + (dx / d) * 0.4) * speed * dt * 1.7,
          ((dx / d) * side * 0.9 + (dz / d) * 0.4) * speed * dt * 1.7, 0.36);
        if (this.stuckT > 1.6) { this.stuckT = 0; this.path = null; this.repathT = 0; return true; }
      }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }
    this.yaw = Math.atan2(-dx, -dz);
    // local separation
    for (const other of this.manager.bots) {
      if (other === this || other.dead) continue;
      const sx = this.pos.x - other.pos.x, sz = this.pos.z - other.pos.z;
      const gap = Math.hypot(sx, sz);
      if (gap > 0.02 && gap < 1.6) this.ctx.moveCollide(this.pos, sx / gap * (1.6 - gap) * dt, sz / gap * (1.6 - gap) * dt, 0.36);
    }
    return false;
  }

  private faceTarget(t: THREE.Vector3) {
    this.yaw = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z));
  }

  /* ---------------- visuals (every frame) ---------------- */
  updateVisualFrame(dt: number) {
    const g = this.model.group;
    if (this.state === 'DEAD') {
      this.deadAge += dt;
      if (this.deathT >= 0 && this.deathT < 0.6) {
        this.deathT += dt;
        const t = Math.min(1, this.deathT / 0.5);
        g.rotation.x = -t * Math.PI / 2 * 0.96;
        g.position.y = this.pos.y + 0.1 * Math.sin(t * Math.PI);
      }
      if (this.deadAge > 8) g.visible = false;
      return;
    }
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.flinch = 0.4;
    }
    this.flinch = Math.max(0, this.flinch - dt);
    // yaw lerp toward the brain's decision
    let dy = this.yaw - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, dt * 10);
    g.position.set(this.pos.x, this.pos.y, this.pos.z);

    const p = this.model.parts;
    const movedLen = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x; this.lastZ = this.pos.z;
    const targetTorsoY = this.crouched ? 0.6 : 0.95;
    p.torso.position.y += (targetTorsoY - p.torso.position.y) * Math.min(1, dt * 9);
    const measured = Math.min(18, movedLen / Math.max(dt, 0.001));
    this.locomotion += (measured - this.locomotion) * (1 - Math.exp(-dt * 6));
    this.walkPhase += this.locomotion * dt * 3.5;
    const stride = Math.min(1, this.locomotion / 2.5);
    const swing = Math.sin(this.walkPhase) * 0.62 * stride;
    p.lShin.rotation.x = Math.max(0, -Math.sin(this.walkPhase)) * 0.95 * stride + (this.crouched ? 0.85 : 0);
    p.rShin.rotation.x = Math.max(0, Math.sin(this.walkPhase)) * 0.95 * stride + (this.crouched ? 0.85 : 0);
    p.torso.position.y += Math.abs(Math.sin(this.walkPhase * 2)) * 0.014 * stride;
    this.shotPose = Math.max(0, this.shotPose - dt * 8);
    p.rifle.position.z = -0.42 + this.shotPose * 0.065;
    const lT = this.crouched ? 0.6 : swing, rT = this.crouched ? -0.12 : -swing;
    p.lLeg.rotation.x += (lT - p.lLeg.rotation.x) * Math.min(1, dt * 8);
    p.rLeg.rotation.x += (rT - p.rLeg.rotation.x) * Math.min(1, dt * 8);
    const aiming = this.state !== 'PATROL';
    p.rifle.rotation.x += ((aiming ? -0.025 - this.shotPose * 0.12 : 0.38) - p.rifle.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.x += ((aiming ? 1.35 : -0.15) - p.rArm.rotation.x) * Math.min(1, dt * 6);
    p.lArm.rotation.x += ((aiming ? 1.25 : 0.1) - p.lArm.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.z += ((aiming ? -0.25 : 0) - p.rArm.rotation.z) * Math.min(1, dt * 6);
    p.lArm.rotation.z += ((aiming ? 0.3 : 0) - p.lArm.rotation.z) * Math.min(1, dt * 6);
    p.torso.rotation.x = -this.flinch * 0.8 + stride * 0.045 - this.shotPose * 0.035;
    p.head.rotation.x = -this.flinch * 1.2;
  }

  dispose() {
    this.model.group.traverse(o => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.model.group.removeFromParent();
  }
}

/* ================= TDM MATCH MANAGER ================= */
export interface TDMRosterEntry {
  name: string;
  team: TDMTeam;
  you: boolean;
  dead: boolean;
  armor: TDMArmor;
  kills: number;
}

export class TDMManager {
  bots: TDMBot[] = [];
  alphaScore = 0;
  bravoScore = 0;
  timeLeft = TDM_MATCH_TIME;
  rosterVersion = 0;
  totalRespawns = 0;
  private nav: NavGrid;
  private ctx: TDMContext;
  private playerArmor: TDMArmor;
  private playerDeadFlag = false;
  private tick = 0;

  constructor(ctx: TDMContext, scene: THREE.Scene, nav: NavGrid, playerArmor: TDMArmor, playerSpawn: THREE.Vector3) {
    // Wrap onBotDeath so kill credit never depends on the host remembering to
    // call handleKill — score + respawn bookkeeping live here.
    const wired: TDMContext = {
      ...ctx,
      onBotDeath: (victim, killerTeam) => {
        this.handleKill(killerTeam, victim);
        ctx.onBotDeath(victim, killerTeam);
      },
    };
    this.ctx = wired;
    this.nav = nav;
    this.playerArmor = playerArmor;
    // ALPHA: 4 AI allies
    for (let i = 0; i < 4; i++) {
      const bot = new TDMBot(wired, nav, this, ALPHA_NAMES[i], 'alpha', ALPHA_ARMOR[i], this.getSpawn('alpha'));
      bot.addTo(scene);
      this.bots.push(bot);
    }
    // BRAVO: 5 AI enemies
    for (let i = 0; i < 5; i++) {
      const bot = new TDMBot(wired, nav, this, BRAVO_NAMES[i], 'bravo', BRAVO_ARMOR[i], this.getSpawn('bravo'));
      bot.addTo(scene);
      this.bots.push(bot);
    }
    void playerSpawn;
  }

  /** Team spawn point: one of five slots + a random ±2–4m scatter, nudged off geometry. */
  getSpawn(team: TDMTeam): THREE.Vector3 {
    const xs = team === 'alpha' ? ALPHA_SPAWN_XS : BRAVO_SPAWN_XS;
    const baseZ = team === 'alpha' ? 42 : -42;
    const x = xs[Math.floor(Math.random() * xs.length)];
    const scatter = () => (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2);
    const px = THREE.MathUtils.clamp(x + scatter(), -this.ctx.half + 4, this.ctx.half - 4);
    const pz = THREE.MathUtils.clamp(baseZ + scatter(), -this.ctx.half + 4, this.ctx.half - 4);
    const [cx, cz] = this.nav.nearestFree(this.nav.toCell(px), this.nav.toCell(pz));
    return new THREE.Vector3(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
  }

  /** Everything the opposing team can shoot: bots + (for BRAVO) the player. */
  targetsFor(team: TDMTeam): TDMTarget[] {
    const out: TDMTarget[] = [];
    for (const b of this.bots) {
      if (b.team === team || b.dead) continue;
      out.push({ kind: 'bot', bot: b, feet: () => b.pos, alive: () => !b.dead });
    }
    if (team === 'bravo' && !this.playerDeadFlag) {
      out.push({ kind: 'player', feet: () => this.ctx.playerFeet(), alive: () => this.ctx.playerAlive() && !this.playerDeadFlag });
    }
    return out;
  }

  setPlayerDead(dead: boolean) {
    if (this.playerDeadFlag !== dead) {
      this.playerDeadFlag = dead;
      this.rosterVersion++;
    }
  }

  /** Kill credit + respawn scheduling. victim === 'player' means BRAVO scored on you. */
  handleKill(killerTeam: TDMKiller, victim: TDMBot | 'player') {
    if (killerTeam === 'bravo') this.bravoScore++;
    else this.alphaScore++;
    if (victim !== 'player') {
      victim.respawnT = 10;
    }
    this.rosterVersion++;
  }

  getHittables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const b of this.bots) if (!b.dead) out.push(...b.model.hitMeshes);
    return out;
  }

  aliveCount(team: TDMTeam): number {
    let n = 0;
    for (const b of this.bots) if (b.team === team && !b.dead) n++;
    if (team === 'alpha' && !this.playerDeadFlag) n++;
    return n;
  }

  hudRoster(playerKills: number): TDMRosterEntry[] {
    const out: TDMRosterEntry[] = [];
    for (const b of this.bots) {
      if (b.team === 'alpha') out.push({ name: b.name, team: b.team, you: false, dead: b.dead, armor: b.armor, kills: b.kills });
    }
    out.push({ name: 'YOU', team: 'alpha', you: true, dead: this.playerDeadFlag, armor: this.playerArmor, kills: playerKills });
    for (const b of this.bots) {
      if (b.team === 'bravo') out.push({ name: b.name, team: b.team, you: false, dead: b.dead, armor: b.armor, kills: b.kills });
    }
    return out;
  }

  dispose() {
    for (const b of this.bots) b.dispose();
    this.bots = [];
  }

  update(dt: number) {
    if (this.timeLeft > 0) this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.tick++;
    for (const b of this.bots) {
      b.updateVisualFrame(dt);
      if (b.dead) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) {
          b.respawn(this.getSpawn(b.team));
          this.totalRespawns++;
          this.rosterVersion++;
        }
        continue;
      }
      // stagger brains: every bot thinks 3× per second-ish, animates every frame
      const idx = this.bots.indexOf(b);
      if ((idx + this.tick) % 3 === 0) b.updateLogic(dt * 3);
    }
  }
}
