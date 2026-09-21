// Recoil FPS — DUSTYARD TACTICAL bot: one class, both sides, objective-driven.
//
// The combat core (perception raycasts, burst fire, strafing, A* movement) follows
// the proven Warehouse TDM bot; what is new is the duty layer. The CSManager hands
// every living bot a duty each tick — where to go, whether to plant, defuse or
// hold — and the bot executes it while still fighting anything it can see:
//
//   MOVE    path to the duty target (escort the carrier, rotate, retake)
//   HOLD    anchor at a spot and watch an approach (site holds, post-plant defense)
//   PLANT   stand still on a bombsite for 3.5 s (bomb carrier only)
//   DEFUSE  stand still on the bomb for 10 s / 5 s with a kit (CT only)
//
// Bots never respawn: when they die they stay down until the round resets.
import * as THREE from 'three';
import { buildArmoredSoldier, type SoldierModel } from '../models';
import { NavGrid } from '../ai';
import type { Effects } from '../effects';
import { armorOf, botDamageToBot, botRawDamage, type ArmorLevel, type TeamId } from '../tdm/armor';
import { BOT_ACCURACY } from '../tdm/bot';
import { CS_PLANT_SECONDS, CS_DEFUSE_SECONDS, CS_DEFUSE_KIT_SECONDS, type CSWeaponClass } from './economy';

export type CSDutyAction = 'MOVE' | 'HOLD' | 'PLANT' | 'DEFUSE' | 'IDLE';
export interface CSDuty {
  action: CSDutyAction;
  target: THREE.Vector3;
  /** HOLD only: the approach this bot watches while anchored. */
  face?: THREE.Vector3;
  /** DEFUSE with a kit halves the channel. */
  kit?: boolean;
}

export interface CSBotCtx {
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
  onCallout(kind: string, pos: THREE.Vector3, team: TeamId): void;
  aiThrowGrenade(from: THREE.Vector3, target: THREE.Vector3, team: TeamId, kind?: 'frag' | 'flash' | 'smoke'): void;
  onBotFire(pos: THREE.Vector3): void;
  /** Live smoke clouds (centre + radius): line of sight through them is blocked. */
  smokes(): { x: number; y: number; z: number; r: number }[];
}

export interface CSHost {
  nav: NavGrid;
  allies(bot: CSBot): readonly CSBot[];
  hostiles(bot: CSBot): readonly CSBot[];
  playerIsHostile(team: TeamId): boolean;
  /** Credit the kill, pay the killer, end the round if a side is wiped. */
  onBotKill(victim: CSBot, killer: CSBot | 'PLAYER' | 'WORLD', headshot: boolean): void;
  /** The current duty for this bot (manager computes per phase). */
  dutyFor(bot: CSBot): CSDuty;
  onBombPlanted(planter: CSBot, at: THREE.Vector3): void;
  onBombDefused(defuser: CSBot | 'PLAYER'): void;
  /** True while the round is frozen — bots stand fast, wallets open. */
  frozen(): boolean;
}

export interface CSBotOptions {
  name: string;
  team: TeamId;
  armor: ArmorLevel;
  /** 0 cautious … 1 aggressive — same personality dial the TDM bots use. */
  personality: number;
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class CSBot {
  readonly name: string;
  readonly team: TeamId;
  readonly maxHpByArmor: Record<number, number> = { 0: 150, 1: 180, 2: 210 };
  personality: number;

  model: SoldierModel;
  pos = new THREE.Vector3();
  yaw = 0;
  armor: ArmorLevel;
  hp = 150;
  money = 800;
  /** Class of the gun this bot is carrying — drives the kill reward table. */
  weaponClass: CSWeaponClass = 'pistol';
  hasBomb = false;
  kit = false;
  kills = 0;
  deaths = 0;
  damageDealt = 0;
  state = 'IDLE';
  dead = false;
  deadAge = 0;
  /** Live plant/defuse channel progress, for the HUD and the manager. */
  channelT = 0;

  private ctx: CSBotCtx;
  private host: CSHost;
  private target: CSBot | 'PLAYER' | null = null;
  private hasLOS = false;
  private losTimer = 0;
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
  private grenadeCD = 8;
  private smokeThrown = false;
  private duty: CSDuty = { action: 'IDLE', target: new THREE.Vector3() };

  constructor(ctx: CSBotCtx, host: CSHost, opts: CSBotOptions) {
    this.ctx = ctx; this.host = host;
    this.name = opts.name; this.team = opts.team;
    this.armor = opts.armor;
    this.hp = this.maxHpByArmor[opts.armor] ?? 150;
    this.personality = opts.personality;
    this.model = buildArmoredSoldier(opts.armor, opts.team);
    // Tag every hit box so the engine's bullet raycasts credit this bot.
    for (const mesh of this.model.hitMeshes) mesh.userData.csBot = this;
  }

  get maxHp(): number { return this.maxHpByArmor[this.armor] ?? 150; }
  get opposing(): TeamId { return this.team === 'alpha' ? 'bravo' : 'alpha'; }
  private get mates() { return this.host.allies(this); }

  /* ==================== LIFECYCLE ==================== */

  /** Round start: full health, bought gear, fresh model if the tier changed. */
  deploy(at: THREE.Vector3, yaw: number) {
    if ((this.model.armor?.level ?? 0) !== this.armor) this.rebuildModel();
    this.pos.copy(at);
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.dead = false; this.deadAge = 0; this.deathT = -1;
    this.state = 'IDLE';
    this.target = null; this.hasLOS = false;
    this.lastSeenT = 999; this.losTimer = Math.random() * 0.2;
    this.burstLeft = 0; this.burstTimer = 0; this.burstIdx = 0; this.burstGap = 0;
    this.strafeDir = 0; this.strafeT = 0;
    this.path = null; this.channelT = 0;
    this.grenadeCD = 8 + Math.random() * 6;
    this.smokeThrown = false;
    this.reactTimer = 0.35 + Math.random() * 0.5;
    this.flinch = 0; this.shotPose = 0; this.stuckT = 0; this.escapeT = 0;
    this.lastX = at.x; this.lastZ = at.z;
    const g = this.model.group;
    g.visible = true; g.position.copy(at); g.rotation.set(0, yaw, 0);
    const p = this.model.parts;
    p.torso.position.y = 0.95; p.torso.rotation.set(0, 0, 0);
    for (const part of [p.head, p.lLeg, p.rLeg, p.lShin, p.rShin, p.lArm, p.rArm, p.rifle]) part.rotation.set(0, 0, 0);
  }

  private rebuildModel() {
    const old = this.model;
    old.group.removeFromParent();
    old.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.model = buildArmoredSoldier(this.armor, this.team);
    for (const mesh of this.model.hitMeshes) mesh.userData.csBot = this;
  }

  /** Re-parent after a manager rebuild (armor change swaps the model object). */
  adoptScene(scene: THREE.Scene) {
    scene.add(this.model.group);
    this.model.group.position.copy(this.pos);
    this.model.group.rotation.y = this.yaw;
  }

  eyePos(out = tmp.clone()): THREE.Vector3 { return out.set(this.pos.x, this.pos.y + 1.58, this.pos.z); }
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.model.parts.muzzle.getWorldPosition(out);
    return out;
  }

  /* ==================== DAMAGE ==================== */

  takeDamage(amount: number, isHead: boolean, from: CSBot | 'PLAYER' | 'WORLD'): boolean {
    if (this.dead) return false;
    const spec = armorOf(this.armor);
    const dealt = isHead ? amount * spec.headMul : amount;
    this.hp -= dealt;
    this.flinch = isHead ? 0.4 : 0.22;
    if (from !== 'WORLD' && from !== 'PLAYER') from.damageDealt += Math.min(dealt, Math.max(0, this.hp + dealt));
    if (this.hp <= 0) { this.die(from); return true; }
    if (from !== 'WORLD') {
      const at = from === 'PLAYER' ? this.ctx.playerFeet() : from.pos;
      this.lastKnown.copy(at);
      this.lastSeenT = 0;
      this.target ??= from === 'PLAYER' ? 'PLAYER' : from;
      this.channelT = 0;                    // flinching off the plant/defuse channel
      if (this.state === 'IDLE' || this.state === 'MOVE') this.state = 'ENGAGE';
    }
    return false;
  }

  /** TDM-style stun for flashbangs. */
  applyStun(t: number) {
    if (this.dead) return;
    this.reactTimer = Math.max(this.reactTimer, t * 0.6);
    this.flinch = 0.5;
    this.channelT = 0;
  }

  private die(killer: CSBot | 'PLAYER' | 'WORLD') {
    this.dead = true;
    this.state = 'DEAD';
    this.deathT = 0; this.deadAge = 0;
    this.deaths++;
    this.channelT = 0;
    this.burstLeft = 0;
    this.ctx.effects.bloodDecal(this.pos, Math.max(this.ctx.groundHeight(this.pos.x, this.pos.z), this.pos.y - 1.2));
    if (killer !== 'WORLD' && killer !== 'PLAYER') killer.kills++;
    this.host.onBotKill(this, killer, this.flinch > 0.3);
  }

  /* ==================== PERCEPTION ==================== */

  /** Does the segment eye→point cross an active smoke cloud? */
  private throughSmoke(from: THREE.Vector3, point: THREE.Vector3): boolean {
    for (const s of this.ctx.smokes()) {
      const cx = s.x - from.x, cy = s.y - from.y, cz = s.z - from.z;
      const dx = point.x - from.x, dy = point.y - from.y, dz = point.z - from.z;
      const len2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / len2));
      const px = from.x + dx * t - s.x, py = from.y + dy * t - s.y, pz = from.z + dz * t - s.z;
      if (px * px + py * py + pz * pz < s.r * s.r) return true;
    }
    return false;
  }

  private losTo(point: THREE.Vector3): boolean {
    const eye = this.eyePos(tmp.clone());
    const dist = eye.distanceTo(point);
    if (dist > 70) return false;
    if (this.throughSmoke(eye, point)) return false;
    const dir = tmp2.copy(point).sub(eye).normalize();
    ray.set(eye, dir); ray.far = Math.max(0.2, dist - 0.35);
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  private perceive() {
    const candidates: { key: CSBot | 'PLAYER'; pos: THREE.Vector3; eye: THREE.Vector3 }[] = [];
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
      const visible = this.facingDot(c.pos) > -0.35 && this.losTo(c.eye);
      if (visible) { this.lastKnown.copy(c.pos); this.lastSeenT = 0; }
      const score = (visible ? 100 : 0) - d + (c.key === 'PLAYER' ? 4 : 0);
      if (score > bestScore) { bestScore = score; best = c; bestVisible = visible; }
    }
    if (!best) { this.hasLOS = false; return; }
    this.target = best.key;
    this.hasLOS = bestVisible;
    if (this.hasLOS && this.state !== 'ENGAGE' && this.state !== 'DEAD') {
      this.state = 'ENGAGE';
      this.reactTimer = Math.max(this.reactTimer, 0.14 + Math.random() * 0.22);
      // Squad comms: nearby mates inherit the contact.
      for (const mate of this.mates) {
        if (mate === this || mate.dead || mate.pos.distanceTo(this.pos) > 50) continue;
        mate.receiveIntel(best.pos, best.key);
      }
    }
  }

  hear(pos: THREE.Vector3, radius: number) {
    if (this.dead || this.pos.distanceTo(pos) > radius) return;
    if (this.target === null) { this.lastKnown.copy(pos); this.lastSeenT = Math.min(this.lastSeenT, 1.4); }
  }

  receiveIntel(at: THREE.Vector3, key: CSBot | 'PLAYER') {
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
    if (this.target instanceof CSBot) return this.target.dead ? null : this.target.pos;
    return null;
  }
  private aimPoint(): THREE.Vector3 | null {
    if (this.target === 'PLAYER') return this.ctx.playerAlive() ? this.ctx.playerEye() : null;
    if (this.target instanceof CSBot) return this.target.dead ? null : this.target.eyePos();
    return null;
  }

  /* ==================== MOVEMENT ==================== */

  private goTo(target: THREE.Vector3, speed: number, dt: number): boolean {
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (dist < 0.6) { this.path = null; return true; }
    this.repathT -= dt;
    if (!this.host.nav.lineFree(this.pos.x, this.pos.z, target.x, target.z)) {
      if (this.repathT <= 0 || this.pathGoal.distanceTo(target) > 2.5) {
        this.path = this.host.nav.path(this.pos, target);
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

  private step(dx: number, dz: number) {
    this.ctx.moveCollide(this.pos, dx, dz, 0.36);
    this.pos.y = this.ctx.groundHeight(this.pos.x, this.pos.z);
  }

  private strafe(dt: number, tpos: THREE.Vector3) {
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.7 + Math.random() * 1.1;
      this.strafeDir = Math.random() < 0.2 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    }
    if (this.strafeDir === 0) return;
    const speed = BOT_ACCURACY.strafeMin + Math.random() * (BOT_ACCURACY.strafeMax - BOT_ACCURACY.strafeMin);
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

  /* ==================== COMBAT ==================== */

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

  private tryFire(dt: number, distance: number) {
    if (this.reactTimer > 0) return;
    if (!this.hasLOS || !this.aimPoint()) { this.burstLeft = 0; return; }
    if (this.friendlyInLine()) { this.burstLeft = 0; return; }
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

  private shoot(distance: number) {
    const aim = this.aimPoint();
    if (!aim) return;
    const falloff = THREE.MathUtils.clamp((distance - 8) / (BOT_ACCURACY.farRange - 8), 0, 1);
    let acc = THREE.MathUtils.lerp(BOT_ACCURACY.close, BOT_ACCURACY.far, falloff)
      + (this.burstIdx === 0 ? BOT_ACCURACY.firstBulletBonus : 0);
    if (this.strafeT > 0 && this.strafeDir !== 0) acc *= 0.88;
    acc = Math.min(0.95, acc);
    this.burstIdx++;
    this.shotPose = 1;
    const muzzle = this.muzzleWorld();
    this.ctx.effects.enemyMuzzle(muzzle);
    this.ctx.onBotFire(this.pos);
    const head = Math.random() < BOT_ACCURACY.headChance;
    if (Math.random() > acc) {
      const miss = aim.clone();
      miss.x += (Math.random() - 0.5) * 2.2; miss.y += (Math.random() - 0.5) * 1.4; miss.z += (Math.random() - 0.5) * 2.2;
      this.ctx.effects.tracer(muzzle, miss, true);
      return;
    }
    const hit = aim.clone();
    if (!head) hit.y -= 0.42;
    this.ctx.effects.tracer(muzzle, hit, true);
    if (this.target === 'PLAYER') {
      // Raw damage — the engine applies the PLAYER's armor, exactly like TDM.
      this.ctx.damagePlayer(botRawDamage(head, Math.random()), this.pos, head);
    } else if (this.target instanceof CSBot && !this.target.dead) {
      this.ctx.effects.blood(hit);
      const dmg = botDamageToBot(this.target.armor, head, Math.random());
      this.damageDealt += dmg;
      this.target.takeDamage(dmg, head, this);
    }
  }

  private tryGrenade() {
    if (this.grenadeCD > 0) return;
    const tpos = this.targetPos();
    if (!tpos) return;
    const d = this.pos.distanceTo(tpos);
    if (d < 8 || d > 32) return;
    const flush = !this.hasLOS && this.lastSeenT < 6;
    const chance = (flush ? BOT_ACCURACY.grenadeFlushChance : BOT_ACCURACY.grenadeOpenChance) * (this.personality > 0.6 ? 1.3 : 1);
    if (Math.random() > chance) return;
    this.grenadeCD = 12 + Math.random() * 8;
    const aim = this.lastKnown.clone();
    aim.x += (Math.random() - 0.5) * 3; aim.z += (Math.random() - 0.5) * 3;
    this.ctx.aiThrowGrenade(this.eyePos(tmp.clone()), aim, this.team, 'frag');
  }

  /** T bomb carriers' escort pops one smoke at the site entrance, once per round. */
  private trySiteSmoke(dutyTarget: THREE.Vector3) {
    if (this.smokeThrown || this.team !== 'bravo' || !this.hasBomb && this.pos.distanceTo(dutyTarget) > 22) return;
    if (this.pos.distanceTo(dutyTarget) > 20) return;
    this.smokeThrown = true;
    const aim = dutyTarget.clone();
    this.ctx.aiThrowGrenade(this.eyePos(tmp.clone()), aim, this.team, 'smoke');
  }

  /* ==================== TICK ==================== */

  update(dt: number) {
    if (this.dead) { this.deadAge += dt; return; }
    this.flinch = Math.max(0, this.flinch - dt);
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);
    this.reactTimer = Math.max(0, this.reactTimer - dt);

    // Freeze time: stand fast at the spawn, face the enemy side, wallets open.
    if (this.host.frozen()) {
      this.state = 'IDLE';
      this.channelT = 0;
      this.faceTowards(tmp.set(this.pos.x * 2, 0, this.pos.z * -1.5), dt * 0.5);
      return;
    }

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.08 + Math.random() * 0.07;
      this.perceive();
    }

    this.duty = this.host.dutyFor(this);
    const engaged = this.target !== null && this.hasLOS && this.state === 'ENGAGE';

    switch (this.state) {
      case 'ENGAGE': {
        const tpos = this.targetPos();
        if (!tpos || !this.hasLOS) {
          this.state = 'MOVE';
          break;
        }
        this.faceTowards(this.aimPoint() ?? tpos, dt);
        this.strafe(dt, tpos);
        this.tryFire(dt, this.pos.distanceTo(tpos));
        this.tryGrenade();
        // Combat outweighs the duty, but never forever: disengage after a slump.
        this.losTimer -= 0;
        if (this.lastSeenT > 3.2) { this.state = 'MOVE'; this.target = null; }
        break;
      }
      case 'PLANT': {
        // The channel survives contact (plants pause under fire, they do not reset)
        // but stops the instant the bot must move.
        if (this.flinch > 0.25) break;
        this.channelT += dt;
        if (this.channelT >= CS_PLANT_SECONDS) {
          this.channelT = 0;
          this.state = 'IDLE';
          this.host.onBombPlanted(this, this.pos.clone());
        }
        break;
      }
      case 'DEFUSE': {
        if (this.flinch > 0.25) break;
        this.channelT += dt;
        const need = this.duty.kit ? CS_DEFUSE_KIT_SECONDS : CS_DEFUSE_SECONDS;
        if (this.channelT >= need) {
          this.channelT = 0;
          this.state = 'IDLE';
          this.host.onBombDefused(this);
        }
        break;
      }
      case 'HOLD': {
        if (engaged) { this.state = 'ENGAGE'; break; }
        this.channelT = 0;
        if (this.pos.distanceTo(this.duty.target) > 1.6) this.goTo(this.duty.target, 4.2, dt);
        else if (this.duty.face) this.faceTowards(this.duty.face, dt * 0.8);
        if (this.target && this.lastSeenT < 1.5) this.state = 'ENGAGE';
        break;
      }
      case 'MOVE':
      default: {
        this.channelT = 0;
        if (this.target && this.lastSeenT < 1.2 && this.hasLOS) { this.state = 'ENGAGE'; break; }
        this.trySiteSmoke(this.duty.target);
        const arrived = this.goTo(this.duty.target, this.hasBomb ? 3.9 : 4.4, dt);
        if (arrived) this.state = this.duty.action === 'PLANT' ? 'PLANT' : this.duty.action === 'DEFUSE' ? 'DEFUSE' : 'HOLD';
        break;
      }
    }
    if (this.state !== 'ENGAGE' && this.target && this.hasLOS && this.state !== 'PLANT' && this.state !== 'DEFUSE') {
      this.state = 'ENGAGE';
    }
  }

  /* ==================== FRAMES ==================== */

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
    // Planting/defusing bots crouch into the bomb; engagers shoulder the rifle.
    const busy = this.state === 'PLANT' || this.state === 'DEFUSE';
    const aiming = this.state === 'ENGAGE' || busy || this.state === 'HOLD';
    p.rifle.rotation.x += ((aiming ? -0.03 - this.shotPose * 0.12 : 0.38) - p.rifle.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.x += ((aiming ? 1.35 : -0.15) - p.rArm.rotation.x) * Math.min(1, dt * 6);
    p.lArm.rotation.x += ((aiming ? 1.25 : 0.1) - p.lArm.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.z += ((aiming ? -0.25 : 0) - p.rArm.rotation.z) * Math.min(1, dt * 6);
    p.lArm.rotation.z += ((aiming ? 0.3 : 0) - p.lArm.rotation.z) * Math.min(1, dt * 6);
    p.torso.rotation.x = -this.flinch * 0.8 + stride * 0.045 - this.shotPose * 0.035 + (busy ? 0.5 : 0);
    p.head.rotation.x = -this.flinch * 1.2;
    if (this.dead) {
      this.deathT = Math.min(1, (this.deathT < 0 ? 0 : this.deathT) + dt * 2.4);
      g.rotation.z = -this.deathT * Math.PI * 0.48;
      g.position.y = this.pos.y + this.deathT * 0.12;
    } else g.rotation.z = 0;
  }
}
