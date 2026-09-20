// Recoil FPS — 5v5 Warehouse TDM
import * as THREE from 'three';
import { buildSoldier, type SoldierModel } from './models';
import { NavGrid, type CalloutKind } from './ai';
import type { AABB } from './world';
import type { Effects } from './effects';

export type TDMTeam = 'alpha' | 'bravo';
export type TDMState = 'PATROL' | 'ENGAGE' | 'FLANK' | 'PUSH' | 'COVER' | 'DEAD';
export type ArmorLevel = 0 | 1 | 2;

export const TDM_MATCH_SECONDS = 150;
export const TDM_RESPAWN = 10;
export const TDM_HP = [150, 180, 210] as const;
export const TDM_DMG_MUL = 0.55;
export const BRAVO_ROSTER: { name: string; armor: ArmorLevel }[] = [
  { name: 'Viper', armor: 2 },
  { name: 'Reaper', armor: 1 },
  { name: 'Ghost', armor: 2 },
  { name: 'Specter', armor: 0 },
  { name: 'Wraith', armor: 1 },
];
export const ALPHA_ROSTER = ['YOU', 'Nomad', 'Hawk', 'Ridge', 'Kestrel'] as const;

export function armorMaxHp(level: ArmorLevel) { return TDM_HP[level]; }
export function armorReduce(level: ArmorLevel, isHead: boolean, amount: number) {
  if (level === 0) return amount;
  if (level === 1) return amount * (isHead ? 0.85 : 0.55);
  return amount * (isHead ? 0.75 : 0.45);
}
export function playerArmorMul(level: ArmorLevel) {
  if (level === 1) return 0.6;
  if (level === 2) return 0.48;
  return 1;
}

export interface TDMContext {
  scene: THREE.Scene;
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  solids: AABB[];
  half: number;
  groundHeight(x: number, z: number): number;
  effects: Effects;
  playerPos(): THREE.Vector3;
  playerFeet(): THREE.Vector3;
  playerAlive(): boolean;
  damagePlayerTDM(amount: number, from: THREE.Vector3, isHead: boolean): void;
  moveCollide(pos: THREE.Vector3, dx: number, dz: number, radius: number, supportHeight?: number): void;
  onCallout(kind: CalloutKind, pos: THREE.Vector3): void;
  aiThrowGrenade(from: THREE.Vector3, target: THREE.Vector3): void;
  onEnemyFire(pos: THREE.Vector3): void;
  onKill(victim: TDMBot, killerTeam: TDMTeam, headshot: boolean, byPlayer: boolean): void;
  getBots(): TDMBot[];
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

const ALPHA_SPAWNS: [number, number][] = [[-8, 42], [-4, 42], [0, 42], [4, 42], [8, 42]];
const BRAVO_SPAWNS: [number, number][] = [[-8, -42], [-4, -42], [0, -42], [4, -42], [8, -42]];
const MID_POINTS: [number, number][] = [[0, 0], [-18, 12], [18, -10], [-12, -8], [14, 10], [0, 18], [0, -18]];

export function jitterSpawn(team: TDMTeam, slot: number): THREE.Vector3 {
  const list = team === 'alpha' ? ALPHA_SPAWNS : BRAVO_SPAWNS;
  const [x, z] = list[slot % 5];
  const j = 2 + Math.random() * 2;
  return new THREE.Vector3(x + (Math.random() - 0.5) * j * 2, 0, z + (Math.random() - 0.5) * j * 2);
}

export class TDMBot {
  name: string;
  team: TDMTeam;
  armor: ArmorLevel;
  model: SoldierModel;
  pos: THREE.Vector3;
  yaw = 0;
  hp: number;
  maxHp: number;
  state: TDMState = 'PATROL';
  personality: number;
  ctx: TDMContext;
  nav: NavGrid;
  slot: number;
  frags = 3;
  flashes = 1;
  deadAge = 0;
  respawnT = 0;

  private stateTime = 0;
  lastKnown = new THREE.Vector3();
  hasLOS = false;
  private losTimer = 0;
  private target: TDMBot | 'player' | null = null;
  private targetPos: THREE.Vector3 | null = null;
  private coverPos: THREE.Vector3 | null = null;
  private burstLeft = 0;
  private burstTimer = 0;
  private burstIdx = 0;
  private grenadeCD = 4 + Math.random() * 6;
  private flinch = 0;
  private deathT = -1;
  private walkPhase = 0;
  private shotPose = 0;
  private lastX = 0;
  private lastZ = 0;
  private path: THREE.Vector3[] | null = null;
  private repathT = 0;
  private moveTarget: THREE.Vector3 | null = null;
  private strafeDir = Math.random() > 0.5 ? 1 : -1;

  constructor(ctx: TDMContext, nav: NavGrid, team: TDMTeam, slot: number, name: string, armor: ArmorLevel) {
    this.ctx = ctx; this.nav = nav; this.team = team; this.slot = slot;
    this.name = name; this.armor = armor;
    this.maxHp = armorMaxHp(armor);
    this.hp = this.maxHp;
    this.personality = Math.random();
    this.model = buildSoldier({ armor, team });
    this.pos = jitterSpawn(team, slot);
    this.model.group.position.copy(this.pos);
    ctx.scene.add(this.model.group);
    for (const m of this.model.hitMeshes) m.userData.tdmBot = this;
    this.yaw = team === 'alpha' ? Math.PI : 0;
  }

  get dead() { return this.state === 'DEAD'; }
  get isPusher() { return this.personality > 0.58; }
  get isFlanker() { return this.personality >= 0.35 && this.personality <= 0.75; }
  eyePos() { return tmpV2.set(this.pos.x, this.pos.y + 1.62, this.pos.z).clone(); }

  takeDamage(amount: number, isHead: boolean, fromPlayer: boolean, killerTeam: TDMTeam): boolean {
    if (this.dead) return false;
    const raw = isHead ? 52 : 26;
    const dmg = armorReduce(this.armor, isHead, raw);
    this.hp -= dmg;
    this.flinch = isHead ? 0.35 : 0.22;
    if (this.hp <= 0) {
      this.die(fromPlayer, killerTeam, isHead);
      return true;
    }
    return false;
  }

  private die(fromPlayer: boolean, killerTeam: TDMTeam, headshot: boolean) {
    this.state = 'DEAD'; this.deathT = 0; this.respawnT = TDM_RESPAWN;
    this.ctx.effects.bloodDecal(this.pos, this.ctx.groundHeight(this.pos.x, this.pos.z));
    this.ctx.onKill(this, killerTeam, headshot, fromPlayer);
  }

  respawn() {
    this.pos.copy(jitterSpawn(this.team, this.slot));
    this.hp = this.maxHp;
    this.state = 'PATROL';
    this.deathT = -1;
    this.deadAge = 0;
    this.frags = 3;
    this.flashes = 1;
    this.target = null;
    this.targetPos = null;
    this.hasLOS = false;
    this.model.group.visible = true;
    this.model.group.rotation.set(0, this.team === 'alpha' ? Math.PI : 0, 0);
    this.model.group.position.copy(this.pos);
    this.yaw = this.team === 'alpha' ? Math.PI : 0;
    this.model.group.updateMatrixWorld(true);
  }

  private losTo(point: THREE.Vector3): boolean {
    const eye = this.eyePos();
    const dist = eye.distanceTo(point);
    if (dist > 80) return false;
    const dir = tmpV.copy(point).sub(eye).normalize();
    ray.set(eye, dir); ray.far = dist - 0.3;
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  private findNearestEnemy() {
    let best: TDMBot | 'player' | null = null;
    let bestD = Infinity;
    if (this.team === 'bravo' && this.ctx.playerAlive()) {
      const d = this.pos.distanceTo(this.ctx.playerFeet());
      if (d < bestD) { bestD = d; best = 'player'; }
    }
    for (const b of this.ctx.getBots()) {
      if (b === this || b.dead || b.team === this.team) continue;
      const d = this.pos.distanceTo(b.pos);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  private aimPoint(): THREE.Vector3 | null {
    if (this.target === 'player') return this.ctx.playerPos();
    if (this.target && this.target !== 'player') return this.target.eyePos();
    return this.targetPos;
  }

  private goTo(target: THREE.Vector3, speed: number, dt: number): boolean {
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (dist < 0.5) { this.path = null; return true; }
    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.path = this.nav.path(this.pos, target);
      this.repathT = 1.2;
    }
    let wp = target;
    if (this.path && this.path.length) {
      wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.7) { this.path.shift(); wp = this.path[0] ?? target; }
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    this.ctx.moveCollide(this.pos, (dx / d) * speed * dt, (dz / d) * speed * dt, 0.36, 1.7);
    this.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  private fireAt(aim: THREE.Vector3) {
    this.model.group.updateMatrixWorld(true);
    const muzzle = this.model.parts.muzzle.getWorldPosition(new THREE.Vector3());
    this.shotPose = 1;
    this.ctx.effects.enemyMuzzle(muzzle);
    this.ctx.onEnemyFire(muzzle);
    const dist = muzzle.distanceTo(aim);
    let acc = 0.82 - (0.82 - 0.43) * Math.min(1, dist / 65);
    if (this.burstIdx === 0) acc += 0.12;
    this.burstIdx++;
    ray.set(muzzle, tmpV.copy(aim).sub(muzzle).normalize()); ray.far = Math.max(0, dist - 0.2);
    const obstruction = ray.intersectObjects(this.ctx.occluders, false)[0];
    if (obstruction) { this.ctx.effects.tracer(muzzle, obstruction.point, true); return; }
    if (Math.random() < acc) {
      this.ctx.effects.tracer(muzzle, aim.clone(), true);
      const isHead = Math.random() < 0.22;
      if (this.target === 'player') {
        const body = 22 + Math.random() * 8;
        this.ctx.damagePlayerTDM(isHead ? 52 : body, this.pos, isHead);
      } else if (this.target && this.target !== 'player') {
        this.target.takeDamage(isHead ? 52 : 26, isHead, false, this.team);
      }
    } else {
      const miss = aim.clone().add(new THREE.Vector3((Math.random() - .5) * 2.4, 0.4, (Math.random() - .5) * 2.4));
      this.ctx.effects.tracer(muzzle, miss, true);
    }
  }

  private tryGrenade(behindCover: boolean) {
    if (this.grenadeCD > 0 || this.frags <= 0) return;
    const aim = this.aimPoint();
    if (!aim) return;
    const d = this.pos.distanceTo(aim);
    let p = behindCover ? 0.08 : 0.015;
    if (this.isPusher) p *= 1.3;
    if (d > 18) p *= 1.5;
    if (Math.random() > p) return;
    this.grenadeCD = 10 + Math.random() * 7;
    this.frags--;
    this.ctx.onCallout('grenade', this.pos);
    this.ctx.aiThrowGrenade(this.eyePos(), aim.clone());
  }

  private findCoverFrom(from: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestS = Infinity;
    for (const node of this.ctx.coverNodes) {
      const d = node.distanceTo(this.pos);
      if (d > 22) continue;
      const eye = tmpV.set(node.x, node.y + 1.3, node.z);
      const dir = new THREE.Vector3().copy(from).sub(eye); const dist = dir.length(); dir.normalize();
      ray.set(eye.clone(), dir); ray.far = Math.min(dist - 0.3, 60);
      if (ray.intersectObjects(this.ctx.occluders, false).length === 0) continue;
      if (d < bestS) { bestS = d; best = node; }
    }
    return best ? best.clone() : null;
  }

  updateVisualFrame(dt: number) {
    if (this.state === 'DEAD') {
      this.deadAge += dt;
      if (this.deathT >= 0 && this.deathT < 0.6) {
        this.deathT += dt; const t = Math.min(1, this.deathT / 0.5);
        this.model.group.rotation.x = -t * Math.PI / 2 * 0.96;
      }
      return;
    }
    this.flinch = Math.max(0, this.flinch - dt);
    const g = this.model.group;
    g.position.set(this.pos.x, this.pos.y, this.pos.z);
    let dy = this.yaw - g.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, dt * 10);
    const p = this.model.parts;
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x; this.lastZ = this.pos.z;
    this.walkPhase += Math.min(8, moved / Math.max(dt, 0.001)) * dt * 3.5;
    const stride = Math.min(1, moved / Math.max(dt, 0.001) / 2.5);
    const swing = Math.sin(this.walkPhase) * 0.62 * stride;
    p.lLeg.rotation.x = swing; p.rLeg.rotation.x = -swing;
    this.shotPose = Math.max(0, this.shotPose - dt * 8);
    p.rifle.position.z = -0.42 + this.shotPose * 0.065;
    p.torso.rotation.x = -this.flinch * 0.8;
    p.head.rotation.x = -this.flinch * 1.2;
  }

  updateLogic(dt: number) {
    if (this.state === 'DEAD') {
      this.respawnT -= dt;
      return;
    }
    this.stateTime += dt;
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.08 + Math.random() * 0.07;
      this.target = this.findNearestEnemy();
      const aim = this.aimPoint();
      this.hasLOS = !!(aim && this.losTo(aim));
      if (this.hasLOS && aim) { this.lastKnown.copy(aim); this.targetPos = aim.clone(); }
    }

    // squad comms
    if (!this.target) {
      for (const a of this.ctx.getBots()) {
        if (a === this || a.dead || a.team !== this.team) continue;
        if (a.hasLOS && a.pos.distanceTo(this.pos) < 50) {
          this.lastKnown.copy(a.lastKnown);
          this.targetPos = a.lastKnown.clone();
          break;
        }
      }
    }

    if (this.hp < this.maxHp * 0.35 && this.state !== 'COVER') {
      const c = this.findCoverFrom(this.lastKnown);
      if (c) { this.coverPos = c; this.state = 'COVER'; this.ctx.onCallout('fallback', this.pos); }
    }

    switch (this.state) {
      case 'COVER': {
        if (this.coverPos && !this.goTo(this.coverPos, 4.2, dt)) break;
        if (this.hp > this.maxHp * 0.5) this.state = 'ENGAGE';
        break;
      }
      case 'ENGAGE': {
        const aim = this.aimPoint();
        if (!aim || !this.hasLOS) {
          if (this.targetPos) {
            if (this.isFlanker) this.state = 'FLANK';
            else this.state = 'PUSH';
          } else this.state = 'PATROL';
          break;
        }
        this.yaw = Math.atan2(-(aim.x - this.pos.x), -(aim.z - this.pos.z));
        const dist = this.pos.distanceTo(aim);
        // strafe
        const dx = this.pos.x - aim.x, dz = this.pos.z - aim.z, d = Math.hypot(dx, dz) || 1;
        const spd = 2.2 + Math.random() * 0.8;
        this.ctx.moveCollide(this.pos, (-dz / d) * this.strafeDir * spd * dt, (dx / d) * this.strafeDir * spd * dt, 0.36, 1.7);
        this.burstTimer -= dt;
        if (this.burstLeft <= 0) { this.burstLeft = 2 + Math.floor(Math.random() * 4); this.burstIdx = 0; }
        if (this.burstTimer <= 0 && this.burstLeft > 0) {
          this.fireAt(aim);
          this.burstLeft--;
          this.burstTimer = 0.12 + Math.random() * 0.06;
        }
        this.tryGrenade(!this.hasLOS);
        if (this.isPusher && dist > 6 && dist < 28) {
          const allies = this.ctx.getBots().filter(b => b !== this && !b.dead && b.team === this.team && b.pos.distanceTo(this.pos) < 18).length;
          if ((allies >= 1 || Math.random() < 0.6) && Math.random() < 0.045) {
            this.state = 'PUSH'; this.ctx.onCallout('push', this.pos);
          }
        }
        break;
      }
      case 'PUSH': {
        const aim = this.targetPos ?? this.lastKnown;
        const off = (Math.random() - 0.5) * 10;
        const t = aim.clone(); t.x += off;
        this.goTo(t, 4.4, dt);
        if (this.hasLOS) this.state = 'ENGAGE';
        if (this.stateTime > 6) this.state = 'PATROL';
        break;
      }
      case 'FLANK': {
        const aim = this.targetPos ?? this.lastKnown;
        const ang = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z) + (Math.PI / 2) * (this.personality > 0.5 ? 1 : -1) + (Math.random() - 0.5) * 0.6;
        const r = 8 + Math.random() * 10;
        this.goTo(new THREE.Vector3(aim.x + Math.sin(ang) * r, 0, aim.z + Math.cos(ang) * r), 4.6, dt);
        if (this.hasLOS && this.stateTime > 1.5) this.state = 'ENGAGE';
        if (this.stateTime > 10) this.state = 'PUSH';
        break;
      }
      default: { // PATROL
        if (this.hasLOS) { this.state = 'ENGAGE'; this.stateTime = 0; break; }
        if (this.targetPos) { this.state = this.isFlanker ? 'FLANK' : 'PUSH'; break; }
        if (!this.moveTarget) {
          if (Math.random() < 0.35) {
            const [mx, mz] = MID_POINTS[Math.floor(Math.random() * MID_POINTS.length)];
            this.moveTarget = new THREE.Vector3(mx, 0, mz);
          } else {
            const baseZ = this.team === 'alpha' ? 42 : -42;
            const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 20;
            this.moveTarget = new THREE.Vector3(Math.cos(a) * r, 0, baseZ + Math.sin(a) * r * 0.3);
          }
        }
        if (this.goTo(this.moveTarget, 2.4, dt)) this.moveTarget = null;
      }
    }
  }
}

export interface TDMRosterEntry {
  name: string; team: TDMTeam; armor: ArmorLevel; dead: boolean; you?: boolean;
}

export class TDMManager {
  bots: TDMBot[] = [];
  alphaScore = 0;
  bravoScore = 0;
  timeLeft = TDM_MATCH_SECONDS;
  rosterVersion = 0;
  nav: NavGrid;
  ctx: TDMContext;

  constructor(ctx: TDMContext) {
    this.ctx = ctx;
    this.nav = new NavGrid(ctx.solids, ctx.half, ctx.groundHeight);
    const allyArmor: ArmorLevel[] = [1, 2, 0, 1];
    for (let i = 0; i < 4; i++) {
      this.bots.push(new TDMBot(ctx, this.nav, 'alpha', i + 1, ALPHA_ROSTER[i + 1], allyArmor[i]));
    }
    for (let i = 0; i < 5; i++) {
      const r = BRAVO_ROSTER[i];
      this.bots.push(new TDMBot(ctx, this.nav, 'bravo', i, r.name, r.armor));
    }
  }

  getSpawn(team: TDMTeam) { return jitterSpawn(team, 0); }
  getHittables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const b of this.bots) if (!b.dead) out.push(...b.model.hitMeshes);
    return out;
  }

  handleKill(victim: TDMBot, killerTeam: TDMTeam) {
    if (killerTeam === 'alpha') this.alphaScore++;
    else this.bravoScore++;
    this.rosterVersion++;
    void victim;
  }

  roster(playerDead: boolean, playerArmor: ArmorLevel): TDMRosterEntry[] {
    const rows: TDMRosterEntry[] = [
      { name: 'YOU', team: 'alpha', armor: playerArmor, dead: playerDead, you: true },
    ];
    for (const b of this.bots) rows.push({ name: b.name, team: b.team, armor: b.armor, dead: b.dead });
    return rows;
  }

  private tick = 0;
  update(dt: number) {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.tick++;
    const n = this.bots.length;
    for (let i = 0; i < n; i++) {
      const b = this.bots[i];
      b.updateVisualFrame(dt);
      if ((i + this.tick) % 3 === 0) b.updateLogic(dt * 3);
      if (b.dead && b.respawnT <= 0 && this.timeLeft > 0) {
        b.respawn();
        this.rosterVersion++;
      }
    }
  }

  dispose() {
    for (const b of this.bots) {
      b.model.group.removeFromParent();
      b.model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.bots = [];
  }
}
