// Recoil FPS — Enemy AI v3: grid A* navigation, unpredictable tactics, squad pushes, grenades
import * as THREE from 'three';
import { buildSoldier, type SoldierModel } from './models';
import type { Effects } from './effects';
import type { AABB } from './world';
import { PRESSURE_BUDGET, type ReinforcementBatch } from './systems/reinforcements';
import type { Position } from './systems/mission';

export type AIState = 'PATROL' | 'ALERT' | 'SEARCH' | 'ENGAGE' | 'SUPPRESS' | 'FLANK' | 'ADVANCE' | 'RETREAT' | 'DEAD';
export type CalloutKind = 'contact' | 'flank' | 'grenade' | 'mandown' | 'fallback' | 'push';

export interface Difficulty { reaction: number; accuracy: number; flank: boolean; aggression: number }
export const DIFFICULTIES: Record<string, Difficulty> = {
  Easy: { reaction: 0.9, accuracy: 0.52, flank: false, aggression: 0.45 },
  Normal: { reaction: 0.5, accuracy: 0.72, flank: true, aggression: 0.8 },
  Hard: { reaction: 0.28, accuracy: 0.88, flank: true, aggression: 1.0 },
};

export interface AIContext {
  scene: THREE.Scene;
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  solids: AABB[];
  half: number;
  groundHeight?(x: number, z: number): number;
  effects: Effects;
  difficulty: Difficulty;
  playerPos(): THREE.Vector3;
  playerFeet(): THREE.Vector3;
  playerVel(): number;
  playerAlive(): boolean;
  playerStaticTime(): number;
  damagePlayer(amount: number, from: THREE.Vector3): void;
  moveCollide(pos: THREE.Vector3, dx: number, dz: number, radius: number): void;
  onCallout(kind: CalloutKind, pos: THREE.Vector3): void;
  aiThrowGrenade(from: THREE.Vector3, target: THREE.Vector3): void;
  onEnemyFire(pos: THREE.Vector3): void;
  onEliminated?(enemy: Enemy): void;
  /**
   * Opening grace window: while this returns false hostiles cannot acquire the player
   * at all, so a deployment is never met by squads that are already firing.
   */
  canAcquire?(): boolean;
}

/* ================= NAV GRID (A*) ================= */
export class NavGrid {
  cell: number;
  n: number;
  half: number;
  blocked: Uint8Array;
  /**
   * `cell` defaults to the 2 m campaign grid. Tight arenas pass 1 m so a 3.2 m
   * doorway always leaves a free cell instead of being inflated shut by the
   * 0.35 m wall padding — that single change is what lets bots fight indoors.
   */
  constructor(solids: AABB[], half: number, groundHeight: (x: number, z: number) => number = () => 0, cell = 2) {
    this.cell = cell;
    this.half = half; this.n = Math.ceil((half * 2) / this.cell);
    this.blocked = new Uint8Array(this.n * this.n);
    for (const b of solids) {
      const x0 = Math.max(0, Math.floor((b.minX - 0.35 + half) / this.cell)), x1 = Math.min(this.n - 1, Math.floor((b.maxX + 0.35 + half) / this.cell));
      const z0 = Math.max(0, Math.floor((b.minZ - 0.35 + half) / this.cell)), z1 = Math.min(this.n - 1, Math.floor((b.maxZ + 0.35 + half) / this.cell));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const floor = groundHeight(this.toWorld(x), this.toWorld(z));
        if (b.maxY <= floor + 0.55 || b.minY > floor + 1.7) continue;
        this.blocked[z * this.n + x] = 1;
      }
    }
  }
  toCell(v: number) { return Math.max(0, Math.min(this.n - 1, Math.floor((v + this.half) / this.cell))); }
  toWorld(c: number) { return c * this.cell - this.half + this.cell / 2; }
  free(x: number, z: number) { return x >= 0 && z >= 0 && x < this.n && z < this.n && !this.blocked[z * this.n + x]; }
  nearestFree(x: number, z: number) {
    if (this.free(x, z)) return [x, z];
    for (let r = 1; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (this.free(x + dx, z + dz)) return [x + dx, z + dz];
    return [x, z];
  }
  lineFree(ax: number, az: number, bx: number, bz: number) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (this.cell * 0.5)) + 1;
    for (let i = 0; i <= steps; i++) { const t = i / steps; if (!this.free(this.toCell(ax + (bx - ax) * t), this.toCell(az + (bz - az) * t))) return false; }
    return true;
  }
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const [sx, sz] = this.nearestFree(this.toCell(from.x), this.toCell(from.z));
    const [gx, gz] = this.nearestFree(this.toCell(to.x), this.toCell(to.z));
    const n = this.n, key = (x: number, z: number) => z * n + x;
    // Binary-heap open list — pathfinding was O(n²) with array scans + splice.
    const open: number[] = [key(sx, sz)];
    const openSet = new Set<number>(open);
    const heapIndex = new Map<number,number>([[open[0],0]]);
    const g = new Map<number, number>([[key(sx, sz), 0]]);
    const f = new Map<number, number>([[key(sx, sz), Math.hypot(gx - sx, gz - sz)]]);
    const came = new Map<number, number>();
    const closed = new Set<number>();
    const fOf = (k: number) => f.get(k) ?? Infinity;
    const heapPop = (): number => {
      const top = open[0];
      const last = open.pop()!;
      if (open.length) {
        open[0] = last; heapIndex.set(last,0);
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < open.length && fOf(open[l]) < fOf(open[m])) m = l;
          if (r < open.length && fOf(open[r]) < fOf(open[m])) m = r;
          if (m === i) break;
          const t = open[i]; open[i] = open[m]; open[m] = t; heapIndex.set(open[i],i); heapIndex.set(open[m],m); i = m;
        }
      }
      openSet.delete(top); heapIndex.delete(top);
      return top;
    };
    const heapPush = (k: number) => {
      open.push(k); openSet.add(k); heapIndex.set(k,open.length-1);
      let i = open.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fOf(open[p]) <= fOf(open[i])) break;
        const t = open[i]; open[i] = open[p]; open[p] = t; heapIndex.set(open[i],i); heapIndex.set(open[p],p); i = p;
      }
    };
    // Search budget scales with the grid: the arena runs 1 m cells (13 k nodes),
    // where a fixed 2 500-node cap silently failed every cross-map request.
    const budget = Math.max(2500, n * n);
    let iter = 0;
    while (open.length && iter++ < budget) {
      const cur = heapPop();
      const cx = cur % n, cz = Math.floor(cur / n);
      if (cx === gx && cz === gz) {
        const out: THREE.Vector3[] = [];
        let k = cur;
        while (came.has(k)) { out.push(new THREE.Vector3(this.toWorld(k % n), 0, this.toWorld(Math.floor(k / n)))); k = came.get(k)!; }
        out.reverse();
        // string-pull
        const sm: THREE.Vector3[] = []; let last = from;
        for (let i = 0; i < out.length; i++) {
          const nxt = out[i + 1];
          if (!nxt || !this.lineFree(last.x, last.z, nxt.x, nxt.z)) { sm.push(out[i]); last = out[i]; }
        }
        sm.push(to.clone());
        return sm;
      }
      closed.add(cur);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.free(nx, nz)) continue;
        if (dx && dz && (!this.free(cx + dx, cz) || !this.free(cx, cz + dz))) continue; // no corner cutting
        const nk = key(nx, nz);
        if (closed.has(nk)) continue;
        const ng = (g.get(cur) ?? 0) + (dx && dz ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          came.set(nk, cur); g.set(nk, ng); f.set(nk, ng + Math.hypot(gx - nx, gz - nz));
          if (!openSet.has(nk)) heapPush(nk);
          else {
            // Decrease-key must restore the heap ordering. Updating f alone left
            // better routes buried and wasted the bounded search on worse nodes.
            let i=heapIndex.get(nk)!;
            while(i>0) {
              const parent=(i-1)>>1;
              if(fOf(open[parent])<=fOf(open[i])) break;
              [open[i],open[parent]]=[open[parent],open[i]];
              heapIndex.set(open[i],i);heapIndex.set(open[parent],parent);i=parent;
            }
          }
        }
      }
    }
    return null;
  }
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
let enemyCounter = 0;

/**
 * Effective rifle range. Perception still reaches much further (see checkLOS) so
 * squads react and manoeuvre on sight, but they will not pull the trigger from
 * across the map — they close to this distance first. Without it a hostile that
 * spotted you at its 48m perception ceiling was already firing bursts before it
 * was anywhere near you.
 */
export const ENGAGE_RANGE = 30;
const NAMES = ['Aslan', 'Verik', 'Dmitri', 'Kolya', 'Rustam', 'Bekzat', 'Timur', 'Marat', 'Oleg', 'Sasha', 'Yuri', 'Anton', 'Farid', 'Nazar', 'Ilya'];

export class Enemy {
  id = enemyCounter++;
  name = NAMES[this.id % NAMES.length];
  model: SoldierModel;
  pos: THREE.Vector3;
  yaw = 0;
  hp = 100;
  state: AIState = 'PATROL';
  role: 'leader' | 'flankA' | 'flankB';
  squad: Squad;
  ctx: AIContext;
  nav: NavGrid;
  dormant = false;
  deadAge = 0;
  missionZone: string | undefined;

  private patrolIdx = 0;
  private stateTime = 0;
  private reactTimer = -1;
  private lastKnown = new THREE.Vector3();
  private lastSeenT = 999;
  private hasLOS = false;
  private losTimer = 0;
  private coverPos: THREE.Vector3 | null = null;
  private hasRealCover = false;
  private coverAge = 0;
  private peeking = false;
  private peekTimer = 0;
  private waitTimer = 0.5;
  private burstLeft = 0;
  private burstTimer = 0;
  private burstIdx = 0;
  private flankTarget: THREE.Vector3 | null = null;
  private flinch = 0;
  private deathT = -1;
  private moveTarget: THREE.Vector3 | null = null;
  private walkPhase = 0;
  private locomotion = 0;
  private shotPose = 0;
  private recentDamage = 0;
  private grenadeCD = 0;
  private crouched = false;
  private strafeDir = 0; private strafeT = 0; private strafeCD = 0;
  private lastX = 0; private lastZ = 0;
  private path: THREE.Vector3[] | null = null;
  private pathGoal = new THREE.Vector3();
  private repathT = 0;
  private stuckT = 0;
  // Committed obstacle-avoidance: a side picked once and held, plus the cumulative
  // time this goal has been unreachable. Re-rolling the sidestep direction on every
  // logic tick is what made blocked actors visibly vibrate in place.
  private escapeDir = 0;
  private escapeT = 0;
  private blockedT = 0;
  private personality: number; // 0 cautious .. 1 aggressive
  stunTimer = 0;

  invalidatePath() { this.path = null; this.repathT = 0; }

  constructor(ctx: AIContext, nav: NavGrid, squad: Squad, role: Enemy['role'], spawn: THREE.Vector3) {
    this.ctx = ctx; this.nav = nav; this.squad = squad; this.role = role;
    this.model = buildSoldier();
    this.pos = spawn.clone();
    this.model.group.position.copy(this.pos);
    ctx.scene.add(this.model.group);
    for (const m of this.model.hitMeshes) m.userData.enemy = this;
    this.personality = Math.random();
  }

  get dead() { return this.state === 'DEAD'; }
  get seesPlayer() { return this.hasLOS; }
  eyePos() { return tmpV2.set(this.pos.x, this.pos.y + 1.62 - (this.crouched ? 0.4 : 0), this.pos.z).clone(); }

  /** Sight *and* inside effective rifle range. Squads advance before they shoot. */
  private canFire(): boolean {
    return this.hasLOS && this.pos.distanceTo(this.ctx.playerFeet()) <= ENGAGE_RANGE;
  }

  resetForInsertion(squad: Squad, role: Enemy['role'], at: Position, focus: Position, zone: string | null) {
    this.id = enemyCounter++;
    this.name = NAMES[this.id % NAMES.length];
    this.squad = squad; this.role = role; this.missionZone = zone ?? undefined;
    this.pos.set(...at); this.hp = 100; this.state = 'ALERT'; this.dormant = false;
    this.deadAge = 0; this.deathT = -1; this.stateTime = 0; this.lastSeenT = 999;
    this.reactTimer = -1; this.hasLOS = false; this.losTimer = (this.id % 5) * 0.04;
    this.lastKnown.set(...focus); this.moveTarget = this.approachPoint(new THREE.Vector3(...focus));
    this.coverPos = null; this.hasRealCover = false; this.coverAge = 0;
    this.peeking = false; this.peekTimer = 0; this.waitTimer = 0.6;
    this.burstLeft = 0; this.burstTimer = 0; this.burstIdx = 0;
    this.flankTarget = null; this.flinch = 0; this.recentDamage = 0;
    this.grenadeCD = 4; this.crouched = false; this.stunTimer = 0;
    this.strafeDir = 0; this.strafeT = 0; this.strafeCD = 0;
    this.path = null; this.repathT = 0; this.stuckT = 0; this.patrolIdx = 0;
    this.escapeDir = 0; this.escapeT = 0; this.blockedT = 0;
    this.walkPhase = 0; this.locomotion = 0; this.shotPose = 0; this.lastX = at[0]; this.lastZ = at[2];
    this.yaw = Math.atan2(at[0] - focus[0], at[2] - focus[2]);
    const g = this.model.group;
    g.visible = true; g.position.copy(this.pos); g.rotation.set(0, this.yaw, 0); g.scale.setScalar(1);
    const p = this.model.parts;
    p.torso.position.y = 0.95; p.torso.rotation.set(0, 0, 0);
    for (const part of [p.head, p.lLeg, p.rLeg, p.lShin, p.rShin, p.lArm, p.rArm, p.rifle]) part.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
  }

  applyStun(t: number) {
    if (this.dead) return;
    this.stunTimer = Math.max(this.stunTimer, t); this.flinch = 0.5;
    this.lastKnown.copy(this.ctx.playerFeet());
    if (this.state === 'PATROL' || this.state === 'ALERT') this.setState('ALERT');
  }

  checkLOS(): boolean {
    if (!this.ctx.playerAlive()) return false;
    // Deployment grace: no acquisition at all until the mission lets hostiles engage.
    if (this.ctx.canAcquire && !this.ctx.canAcquire()) return false;
    const eye = this.eyePos(); const pp = this.ctx.playerPos();
    const dist = eye.distanceTo(pp);
    if (dist > 70) return false;
    const dir = tmpV.copy(pp).sub(eye).normalize();
    if (this.state === 'PATROL' || this.state === 'ALERT' || this.state === 'SEARCH') {
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const flat = tmpV2.set(dir.x, 0, dir.z).normalize();
      if (fwd.dot(flat) < Math.cos(Math.PI / 4) && dist > 16) return false;
      if (dist > 48) return false;
    }
    ray.set(eye, dir); ray.far = dist - 0.3;
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  private approachPoint(target: THREE.Vector3) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, length = Math.hypot(dx,dz) || 1;
    const side = this.role === 'flankA' ? -5.5 : this.role === 'flankB' ? 5.5 : 0;
    const [x,z] = this.nav.nearestFree(this.nav.toCell(target.x - dz/length*side), this.nav.toCell(target.z + dx/length*side));
    return new THREE.Vector3(this.nav.toWorld(x),target.y,this.nav.toWorld(z));
  }

  hear(pos: THREE.Vector3, radius: number) {
    if (this.dead) return;
    if (this.pos.distanceTo(pos) > radius) return;
    if (this.state === 'PATROL' || this.state === 'ALERT' || this.state === 'SEARCH') {
      this.setState(this.state === 'PATROL' ? 'ALERT' : this.state);
      this.lastKnown.copy(pos);
      const next = this.approachPoint(pos);
      if (!this.moveTarget || this.moveTarget.distanceTo(next) > 3) { this.moveTarget = next; this.path = null; }
    }
  }

  takeDamage(amount: number, isHead: boolean): boolean {
    if (this.dead) return false;
    this.hp -= amount; this.recentDamage += amount;
    this.flinch = isHead ? 0.35 : 0.22;
    if (this.hp <= 0) { this.die(); return true; }
    this.lastKnown.copy(this.ctx.playerFeet()); this.lastSeenT = 0;
    if (this.state === 'PATROL' || this.state === 'ALERT' || this.state === 'SEARCH') { this.setState('ENGAGE'); this.reactTimer = this.ctx.difficulty.reaction * 0.4; this.squad.alertAll(this.lastKnown); }
    // Only the most cautious, badly-hurt enemies give ground — everyone else holds and fights
    if (this.recentDamage > 90 && this.hp < 45 && this.state !== 'RETREAT' && this.personality < 0.25) {
      this.setState('RETREAT'); this.ctx.onCallout('fallback', this.pos);
    } else if (this.state === 'ENGAGE' && this.hasRealCover && Math.random() < 0.5) {
      this.peeking = false; this.waitTimer = 0.6 + Math.random(); // duck when shot
    }
    return false;
  }

  private die() {
    this.state = 'DEAD'; this.deathT = 0;
    // Sit the pool on whatever the soldier actually died on (crate, floor slab, roof),
    // instead of pinning every kill to the ground plane under the map.
    let surfaceY = this.ctx.groundHeight?.(this.pos.x, this.pos.z) ?? 0;
    for (const b of this.ctx.solids) {
      if (b.maxY > this.pos.y + 0.4 || b.maxY <= surfaceY) continue;
      if (this.pos.x > b.minX - 0.3 && this.pos.x < b.maxX + 0.3 && this.pos.z > b.minZ - 0.3 && this.pos.z < b.maxZ + 0.3) surfaceY = b.maxY;
    }
    this.ctx.effects.bloodDecal(this.pos, surfaceY);
    if (this.role === 'leader') { this.ctx.onCallout('mandown', this.pos); this.squad.leaderDown(); }
    this.ctx.onEliminated?.(this);
  }

  setState(s: AIState) { if (this.state === 'DEAD') return; if (this.state !== s) { this.state = s; this.stateTime = 0; this.path = null; } }

  private findCover(preferClose = false): THREE.Vector3 | null {
    const pp = this.ctx.playerPos(); const pf = this.ctx.playerFeet();
    let best: THREE.Vector3 | null = null, bestScore = Infinity;
    for (const node of this.ctx.coverNodes) {
      if (Math.abs(node.y - this.pos.y) > 0.5) continue;
      const d = node.distanceTo(this.pos);
      if (d > (preferClose ? 34 : 24)) continue;
      const dp = node.distanceTo(pf);
      if (dp < 5) continue;
      if (this.squad.isCoverTaken(node, this)) continue;
      const eye = tmpV.set(node.x, node.y + 1.3, node.z);
      const dir = new THREE.Vector3().copy(pp).sub(eye); const dist = dir.length(); dir.normalize();
      ray.set(eye.clone(), dir); ray.far = Math.min(dist - 0.3, 60);
      if (ray.intersectObjects(this.ctx.occluders, false).length === 0) continue;
      const ideal = preferClose ? 9 : 16 + this.personality * -6;
      const score = d * 0.7 + Math.abs(dp - ideal) * 0.6 + Math.random() * 3;
      if (score < bestScore) { bestScore = score; best = node; }
    }
    return best ? best.clone() : null;
  }

  /** Navigate toward target using the grid; returns true when arrived */
  private goTo(target: THREE.Vector3, speed: number, dt: number): boolean {
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (dist < 0.4) { this.path = null; return true; }
    this.repathT -= dt;
    const direct = this.nav.lineFree(this.pos.x, this.pos.z, target.x, target.z);
    if (!direct) {
      if (this.repathT <= 0 || this.pathGoal.distanceTo(target) > 2) {
        this.path = this.nav.path(this.pos, target);
        this.pathGoal.copy(target); this.repathT = 1.5 + (this.id%5)*0.17;
      }
    } else this.path = null;
    let wp = target;
    if (this.path && this.path.length) {
      wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.7) { this.path.shift(); wp = this.path[0] ?? target; }
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const bx = this.pos.x, bz = this.pos.z;
    this.ctx.moveCollide(this.pos, (dx / d) * speed * dt, (dz / d) * speed * dt, 0.36);
    const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
    if (moved < speed * dt * 0.25) {
      this.stuckT += dt;
      this.blockedT += dt;
      if (this.stuckT > 0.35) {
        // Pick a side once and hold it. The previous code re-rolled the direction on
        // every logic tick, so a blocked actor shuffled left/right in place and read
        // as a glitch — most visibly in the riverbed under the bridge decks.
        if (this.escapeT <= 0) {
          this.escapeDir = this.escapeDir === 0 ? (this.personality > 0.5 ? 1 : -1) : -this.escapeDir;
          this.escapeT = 0.8;
          this.path = null; this.repathT = Math.max(this.repathT, 0.45);
        }
        this.escapeT -= dt;
        // Arc around the obstruction (mostly sideways, a little forward) instead of
        // grinding straight into it.
        const side = this.escapeDir;
        this.ctx.moveCollide(this.pos,
          ((-dz / d) * side * 0.9 + (dx / d) * 0.4) * speed * dt * 1.6,
          ((dx / d) * side * 0.9 + (dz / d) * 0.4) * speed * dt * 1.6, 0.36);
        // Genuinely unreachable: release the goal, but only after a real attempt and
        // with a repath cooldown, so we never re-target the same wall every tick.
        if (this.blockedT > 3) {
          this.blockedT = 0; this.stuckT = 0; this.escapeT = 0;
          this.path = null; this.repathT = Math.max(this.repathT, 1.2);
          return true;
        }
      }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
      this.escapeT = Math.max(0, this.escapeT - dt);
      this.blockedT = Math.max(0, this.blockedT - dt);
    }
    this.yaw = Math.atan2(-dx, -dz);
    // Local separation prevents three actors collapsing onto the same path waypoint.
    for (const teammate of this.squad.members) {
      if (teammate === this || teammate.dead) continue;
      const sx = this.pos.x-teammate.pos.x, sz=this.pos.z-teammate.pos.z, gap=Math.hypot(sx,sz);
      if (gap > 0.02 && gap < 2) this.ctx.moveCollide(this.pos,sx/gap*(2-gap)*dt,sz/gap*(2-gap)*dt,0.36);
    }
    return false;
  }

  private faceTarget(t: THREE.Vector3) { this.yaw = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z)); }

  private fireShot() {
    const ctx = this.ctx;
    this.model.group.updateMatrixWorld(true);
    const muzzle = this.model.parts.muzzle.getWorldPosition(new THREE.Vector3());
    this.shotPose = 1;
    const pp = ctx.playerPos();
    ctx.effects.enemyMuzzle(muzzle);
    ctx.onEnemyFire(muzzle);
    const dist = muzzle.distanceTo(pp);
    const suppressing = this.state === 'SUPPRESS' || !this.hasLOS;
    // accuracy: distance falloff, moving player harder, first rounds of a burst less accurate
    let acc = ctx.difficulty.accuracy * Math.max(0.3, 1 - dist / 75);
    acc *= 1 - Math.min(0.45, ctx.playerVel() * 0.06);
    acc *= this.burstIdx === 0 ? 0.55 : this.burstIdx === 1 ? 0.8 : 1;
    if (suppressing) acc *= 0.25;
    this.burstIdx++;
    ray.set(muzzle, tmpV.copy(pp).sub(muzzle).normalize()); ray.far = Math.max(0,dist - 0.2);
    const obstruction = ray.intersectObjects(ctx.occluders,false)[0];
    if (obstruction) { ctx.effects.tracer(muzzle,obstruction.point,true); return; }
    if (this.hasLOS && Math.random() < acc && ctx.playerAlive()) {
      ctx.effects.tracer(muzzle, pp.clone(), true);
      ctx.damagePlayer(7 + Math.floor(Math.random() * 8), this.pos);
    } else {
      const miss = (this.hasLOS ? pp : this.lastKnown).clone().add(new THREE.Vector3((Math.random() - .5) * 3, 0.8 + (Math.random() - .3) * 2, (Math.random() - .5) * 3));
      ctx.effects.tracer(muzzle, miss, true);
    }
  }

  /** Cheap per-frame visual sync (runs every frame for smooth animation). */
  updateVisualFrame(dt: number) {
    if (this.state === 'DEAD') {
      this.deadAge += dt;
      if (this.deathT >= 0 && this.deathT < 0.6) {
        this.deathT += dt; const t = Math.min(1, this.deathT / 0.5);
        this.model.group.rotation.x = -t * Math.PI / 2 * 0.96;
        this.model.group.position.y = this.pos.y + 0.1 * Math.sin(t * Math.PI);
      }
      return;
    }
    if (this.stunTimer > 0) this.stunTimer -= dt;
    this.flinch = Math.max(0, this.flinch - dt);
    this.updateVisual(dt);
  }

  /** Expensive brain logic (LOS raycasts, cover search, state machine) — staggered across frames. */
  updateLogic(dt: number) {
    if (this.state === 'DEAD' || this.stunTimer > 0) return;
    this.stateTime += dt; this.lastSeenT += dt; this.coverAge += dt;
    this.recentDamage = Math.max(0, this.recentDamage - dt * 22);
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.14 + Math.random() * 0.1;
      const had = this.hasLOS;
      this.hasLOS = this.checkLOS();
      if (this.hasLOS) {
        this.lastKnown.copy(this.ctx.playerFeet()); this.lastSeenT = 0;
        if ((this.state === 'PATROL' || this.state === 'ALERT' || this.state === 'SEARCH') && this.reactTimer <= 0) this.reactTimer = this.ctx.difficulty.reaction * (0.7 + Math.random() * 0.6);
        if (!had) this.squad.shareIntel(this.lastKnown);
      }
    }
    if (this.reactTimer > 0) {
      this.reactTimer -= dt;
      if (this.reactTimer <= 0 && this.hasLOS) {
        this.setState('ENGAGE');
        if (!this.squad.contactCalled) { this.squad.contactCalled = true; this.ctx.onCallout('contact', this.pos); }
        this.squad.alertAll(this.lastKnown); this.squad.onEngage(this);
      }
    }

    const closeContact = this.hasLOS && this.pos.distanceTo(this.ctx.playerFeet()) < 14;
    if (closeContact && this.reactTimer <= 0 && this.state !== 'ENGAGE' && this.state !== 'SUPPRESS') {
      this.coverPos = null; this.moveTarget = null; this.flankTarget = null;
      this.setState('ENGAGE'); this.waitTimer = 0;
    }
    switch (this.state) {
      case 'PATROL': this.doPatrol(dt); break;
      case 'ALERT': this.doAlert(dt); break;
      case 'SEARCH': this.doSearch(dt); break;
      case 'ENGAGE': this.doEngage(dt, false); break;
      case 'SUPPRESS': this.doEngage(dt, true); break;
      case 'FLANK': this.doFlank(dt); break;
      case 'ADVANCE': this.doAdvance(dt); break;
      case 'RETREAT': this.doRetreat(dt); break;
    }
    this.tryGrenade();
  }

  private doPatrol(dt: number) {
    const path = this.squad.patrol; const target = path[this.patrolIdx % path.length];
    const off = this.role === 'flankA' ? 1.4 : this.role === 'flankB' ? -1.4 : 0;
    if (this.goTo(tmpV.set(target.x + off, 0, target.z + off).clone(), 1.7, dt)) this.patrolIdx++;
    this.crouched = false;
  }
  private doAlert(dt: number) {
    this.crouched = false;
    if (this.moveTarget) { if (this.goTo(this.moveTarget, 3.4, dt)) { this.moveTarget = null; this.setState('SEARCH'); } }
    else this.setState('SEARCH');
  }
  private doSearch(dt: number) {
    // sweep around last known: pick random nearby points, look around
    if (!this.moveTarget) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
      this.moveTarget = new THREE.Vector3(this.lastKnown.x + Math.cos(a) * r, 0, this.lastKnown.z + Math.sin(a) * r);
    }
    if (this.goTo(this.moveTarget, 2.6, dt)) this.moveTarget = null;
    this.yaw += Math.sin(this.stateTime * 2.2) * dt * 1.5;
    if (this.stateTime > 12) this.setState('PATROL');
  }

  private doEngage(dt: number, suppress: boolean) {
    const pf = this.ctx.playerFeet();
    const range = this.pos.distanceTo(pf);
    // Spotted you from across the sector: close the distance instead of spraying from
    // the edge of perception. This is what made a fresh deployment feel like the squad
    // was already firing before it had any business shooting.
    if (this.hasLOS && range > ENGAGE_RANGE) { this.startAdvance(); return; }
    // A visible nearby threat takes priority over running to a distant cover node.
    if (this.hasLOS && range < 18) {
      this.crouched = false; this.faceTarget(pf);
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.fireShot(); this.burstLeft++;
        this.burstTimer = this.burstLeft % 4 === 0 ? 0.65 : 0.16;
      }
      this.coverPos = null;
      return;
    }
    if (!this.coverPos) {
      const found = this.findCover();
      if (found) { this.coverPos = found; this.hasRealCover = true; } else { this.coverPos = this.pos.clone(); this.hasRealCover = false; }
      this.coverAge = 0;
    }
    // periodically relocate to a fresh cover node so the player can't pre-aim
    if (this.hasRealCover && this.coverAge > 7 + Math.random() * 6 && !this.peeking) {
      const next = this.findCover(this.personality > 0.5);
      if (next && next.distanceTo(this.coverPos) > 3) { this.coverPos = next; this.coverAge = 0; }
    }
    const atCover = this.pos.distanceTo(this.coverPos) < 0.6;
    if (!atCover) {
      this.goTo(this.coverPos, 3.5, dt); this.crouched = false;
      if (this.canFire()) { this.faceTarget(this.ctx.playerFeet()); this.burstTimer -= dt; if (this.burstTimer <= 0) { this.fireShot(); this.burstTimer = 0.4; } }
    }
    else {
      this.crouched = this.hasRealCover && !this.peeking;
      this.faceTarget(this.hasLOS ? this.ctx.playerFeet() : this.lastKnown);
      if (!this.hasRealCover) { // open ground: strafe
        this.strafeCD -= dt;
        if (this.strafeT > 0) {
          this.strafeT -= dt;
          const pp = this.lastKnown; const dx = this.pos.x - pp.x, dz = this.pos.z - pp.z, d = Math.hypot(dx, dz) || 1;
          this.ctx.moveCollide(this.pos, (-dz / d) * this.strafeDir * 2.8 * dt, (dx / d) * this.strafeDir * 2.8 * dt, 0.36);

        } else if (this.strafeCD <= 0) { this.strafeDir = Math.random() > 0.5 ? 1 : -1; this.strafeT = 0.4 + Math.random() * 0.5; this.strafeCD = 1 + Math.random() * 1.4; }
      }
      if (this.peeking) {
        this.peekTimer -= dt; this.burstTimer -= dt;
        // Blind suppressive fire still respects effective range — no shots from
        // across the map at a stale last-known position.
        if (this.burstLeft > 0 && this.burstTimer <= 0 && this.pos.distanceTo(this.lastKnown) <= ENGAGE_RANGE) { this.burstTimer = 0.1 + Math.random() * 0.04; this.burstLeft--; this.fireShot(); }
        if (this.peekTimer <= 0 || (this.burstLeft <= 0 && Math.random() < 0.02)) { this.peeking = false; this.waitTimer = 0.7 + Math.random() * 1.3 * (1 - this.personality * 0.5); }
      } else {
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) {
          this.peeking = true; this.burstIdx = 0;
          this.peekTimer = 0.6 + Math.random() * 0.8;
          this.burstLeft = suppress ? 6 + Math.floor(Math.random() * 5) : 3 + Math.floor(Math.random() * 4);
          this.burstTimer = 0.05;
        }
      }
    }
    // aggressive personalities push when the player has been quiet
    if (!suppress && this.lastSeenT > 3.5 && this.personality * this.ctx.difficulty.aggression > 0.45 && Math.random() < dt * 0.35) { this.setState('ADVANCE'); this.ctx.onCallout('push', this.pos); }
    // lost track for a long time → search
    if (this.lastSeenT > 16) { this.setState('SEARCH'); this.moveTarget = this.lastKnown.clone(); this.coverPos = null; }
  }

  private doAdvance(dt: number) {
    this.crouched = false;
    if (!this.moveTarget) {
      const c = this.findCover(true);
      this.moveTarget = c ?? this.lastKnown.clone();
    }
    // fire on the move once the player is inside effective range
    if (this.canFire()) { this.burstTimer -= dt; if (this.burstTimer <= 0) { this.burstTimer = 0.28; this.burstIdx = 1; this.fireShot(); } }
    if (this.goTo(this.moveTarget, 4.8, dt) || this.stateTime > 7) { this.moveTarget = null; this.coverPos = null; this.setState('ENGAGE'); }
  }

  private doFlank(dt: number) {
    this.crouched = false;
    if (!this.flankTarget) {
      const pp = this.ctx.playerFeet();
      const away = tmpV.copy(this.pos).sub(pp).normalize();
      const perp = new THREE.Vector3(-away.z, 0, away.x); if (this.role === 'flankA') perp.negate();
      this.flankTarget = pp.clone().addScaledVector(perp, 16).addScaledVector(away, 4);
      const h = this.ctx.half - 4;
      this.flankTarget.x = Math.max(-h, Math.min(h, this.flankTarget.x)); this.flankTarget.z = Math.max(-h, Math.min(h, this.flankTarget.z));
    }
    if (this.goTo(this.flankTarget, 4.8, dt) || (this.hasLOS && this.stateTime > 2.5) || this.stateTime > 14) { this.flankTarget = null; this.coverPos = null; this.setState('ENGAGE'); }
  }

  private doRetreat(dt: number) {
    this.crouched = false;
    if (!this.moveTarget) {
      const away = tmpV.copy(this.pos).sub(this.ctx.playerFeet()).normalize();
      const far = this.pos.clone().addScaledVector(away, 14);
      const h = this.ctx.half - 4; far.x = Math.max(-h, Math.min(h, far.x)); far.z = Math.max(-h, Math.min(h, far.z));
      this.moveTarget = far; this.coverPos = null;
    }
    if (this.goTo(this.moveTarget, 5.4, dt) || this.stateTime > 4.5) { this.moveTarget = null; this.recentDamage = 0; this.setState('ENGAGE'); }
  }

  private tryGrenade() {
    if (this.grenadeCD > 0 || this.squad.grenadeCD > 0) return;
    if (this.state !== 'ENGAGE' && this.state !== 'SUPPRESS') return;
    const d = this.pos.distanceTo(this.ctx.playerFeet());
    if (d < 8 || d > 30) return;
    // camping player behind cover, OR player out of sight for a while → flush
    const camping = this.ctx.playerStaticTime() > 3 && !this.hasLOS;
    const lost = this.lastSeenT > 2.5 && this.lastSeenT < 8 && !this.hasLOS;
    if (!(camping || lost)) return;
    if (Math.random() > 0.35 + this.ctx.difficulty.aggression * 0.3) { this.grenadeCD = 2; return; }
    this.squad.grenadeCD = 10 - this.ctx.difficulty.aggression * 4; this.grenadeCD = 16;
    this.ctx.onCallout('grenade', this.pos);
    const target = this.lastKnown.clone(); target.x += (Math.random() - .5) * 2.5; target.z += (Math.random() - .5) * 2.5;
    this.ctx.aiThrowGrenade(this.eyePos(), target);
  }

  startFlank() { if (this.dead || !this.ctx.difficulty.flank) return; this.setState('FLANK'); this.flankTarget = null; this.ctx.onCallout('flank', this.pos); }
  startSuppress() { if (this.dead) return; this.setState('SUPPRESS'); }
  startAdvance() { if (this.dead) return; this.setState('ADVANCE'); this.moveTarget = null; }

  private updateVisual(dt: number) {
    const g = this.model.group;
    g.position.set(this.pos.x, this.pos.y, this.pos.z);
    let dy = this.yaw - g.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, dt * 10);
    const p = this.model.parts;
    const movedLen = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ); this.lastX = this.pos.x; this.lastZ = this.pos.z;
    const targetTorsoY = this.crouched ? 0.55 : 0.95;
    p.torso.position.y += (targetTorsoY - p.torso.position.y) * Math.min(1, dt * 9);
    // Brains move only every third frame. Smooth measured speed rather than switching
    // the walk pose off on the two intervening frames (the original skating bug).
    const measured = Math.min(18,movedLen / Math.max(dt,0.001));
    this.locomotion += (measured-this.locomotion) * (1-Math.exp(-dt*6));
    this.walkPhase += this.locomotion * dt * 3.5;
    const stride = Math.min(1,this.locomotion/2.5);
    const swing = Math.sin(this.walkPhase) * 0.62 * stride;
    p.lShin.rotation.x = Math.max(0,-Math.sin(this.walkPhase))*0.95*stride + (this.crouched ? 0.85 : 0);
    p.rShin.rotation.x = Math.max(0,Math.sin(this.walkPhase))*0.95*stride + (this.crouched ? 0.85 : 0);
    p.torso.position.y += Math.abs(Math.sin(this.walkPhase*2))*0.014*stride;
    this.shotPose = Math.max(0,this.shotPose-dt*8);
    p.rifle.position.z = -0.42 + this.shotPose*0.065;
    const lT = this.crouched ? 0.6 : swing, rT = this.crouched ? -0.12 : -swing;
    p.lLeg.rotation.x += (lT - p.lLeg.rotation.x) * Math.min(1, dt * 8);
    p.rLeg.rotation.x += (rT - p.rLeg.rotation.x) * Math.min(1, dt * 8);
    const aiming = this.state !== 'PATROL' && this.state !== 'RETREAT';
    p.rifle.rotation.x += ((aiming ? -0.025-this.shotPose*0.12 : 0.38) - p.rifle.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.x += ((aiming ? 1.35 : -0.15) - p.rArm.rotation.x) * Math.min(1, dt * 6);
    p.lArm.rotation.x += ((aiming ? 1.25 : 0.1) - p.lArm.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.z += ((aiming ? -0.25 : 0) - p.rArm.rotation.z) * Math.min(1, dt * 6);
    p.lArm.rotation.z += ((aiming ? 0.3 : 0) - p.lArm.rotation.z) * Math.min(1, dt * 6);
    p.torso.rotation.x = -this.flinch * 0.8 + stride*0.045 - this.shotPose*0.035; p.head.rotation.x = -this.flinch * 1.2;
    const shouldLean = this.peeking && this.crouched && this.hasRealCover;
    const leanTarget = shouldLean ? (this.id % 2 === 0 ? 0.42 : -0.42) : 0;
    p.torso.rotation.z += (leanTarget - p.torso.rotation.z) * Math.min(1, dt * 5);
  }
}

export class Squad {
  members: Enemy[] = [];
  patrol: THREE.Vector3[];
  contactCalled = false;
  grenadeCD = 0;
  private cohesion = true;
  private flankTimer = 0;
  private pushTimer = 0;
  constructor(patrol: THREE.Vector3[]) { this.patrol = patrol; }
  alertAll(pos: THREE.Vector3) { for (const m of this.members) { if (m.dead) continue; if (m.state === 'PATROL' || m.state === 'ALERT' || m.state === 'SEARCH') { m.setState('ALERT'); m.hear(pos, 1000); } } }
  shareIntel(_pos: THREE.Vector3) { /* members already share via alertAll */ }
  onEngage(who: Enemy) {
    if (!this.cohesion) return;
    if (who.role === 'leader') {
      const a = this.members.find(m => m.role === 'flankA' && !m.dead);
      const b = this.members.find(m => m.role === 'flankB' && !m.dead);
      if (a) a.startSuppress();
      if (b) this.flankTimer = 2 + Math.random() * 3;
      this.pushTimer = 14 + Math.random() * 10;
    }
  }
  leaderDown() { this.cohesion = false; }
  isCoverTaken(node: THREE.Vector3, self: Enemy) { for (const m of this.members) { if (m === self || m.dead) continue; if (m.pos.distanceTo(node) < 1.4) return true; } return false; }
  update(dt: number, ctx: AIContext) {
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);
    if (this.flankTimer > 0) { this.flankTimer -= dt; if (this.flankTimer <= 0) { const b = this.members.find(m => m.role === 'flankB' && !m.dead); if (b && (b.state === 'ENGAGE' || b.state === 'ALERT' || b.state === 'SUPPRESS')) b.startFlank(); } }
    // coordinated push: whole squad advances when player camps
    if (this.pushTimer > 0 && this.cohesion) {
      this.pushTimer -= dt;
      if (this.pushTimer <= 0 && ctx.playerStaticTime() > 5 && Math.random() < ctx.difficulty.aggression) {
        for (const m of this.members) if (!m.dead && (m.state === 'ENGAGE' || m.state === 'SUPPRESS')) m.startAdvance();
        ctx.onCallout('push', this.members.find(m => !m.dead)?.pos ?? new THREE.Vector3());
        this.pushTimer = 20 + Math.random() * 10;
      } else if (this.pushTimer <= 0) this.pushTimer = 8;
    }
  }
}

export class AIManager {
  enemies: Enemy[] = [];
  squads: Squad[] = [];
  ctx: AIContext;
  nav: NavGrid;
  rosterVersion = 0;
  private pool: Enemy[] = [];
  constructor(ctx: AIContext, spawns: { leader: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; patrol: THREE.Vector3[] }[]) {
    this.ctx = ctx;
    this.nav = new NavGrid(ctx.solids, ctx.half, ctx.groundHeight);
    const reserve = new Squad([new THREE.Vector3()]);
    // Allocate once. Reinforcements reuse these models instead of growing the scene graph.
    for (let i = 0; i < PRESSURE_BUDGET.liveCap; i++) {
      const enemy = new Enemy(ctx, this.nav, reserve, 'leader', new THREE.Vector3());
      enemy.dormant = true;
      enemy.model.group.visible = false;
      this.pool.push(enemy);
    }
    for (const s of spawns) {
      this.insertSquad({
        insertionId: 'initial', from: 'north', zone: null,
        focus: [s.patrol[0].x, s.patrol[0].y, s.patrol[0].z],
        members: [s.leader, s.a, s.b].map(p => [p.x, p.y, p.z] as Position),
      });
    }
  }

  invalidatePaths() { for (const enemy of this.pool) enemy.invalidatePath(); }

  insertSquad(batch: ReinforcementBatch): boolean {
    if (batch.members.length !== 3 || this.aliveCount() + 3 > PRESSURE_BUDGET.liveCap) return false;
    const free = this.pool.filter(e => e.dormant || (e.dead && e.deadAge >= 6)).slice(0, 3);
    if (free.length !== 3) return false;
    const focus = new THREE.Vector3(...batch.focus);
    const squad = new Squad([focus.clone(), focus.clone().add(new THREE.Vector3(3, 0, 3)), focus.clone().add(new THREE.Vector3(-3, 0, 3))]);
    const roles: Enemy['role'][] = ['leader', 'flankA', 'flankB'];
    for (let i = 0; i < free.length; i++) {
      const e = free[i];
      this.retire(e.id);
      e.resetForInsertion(squad, roles[i], batch.members[i], batch.focus, batch.zone);
      squad.members.push(e); this.enemies.push(e);
    }
    this.squads.push(squad);
    this.rosterVersion++;
    return true;
  }

  retire(id: number) {
    const e = this.enemies.find(actor => actor.id === id);
    if (!e) return;
    e.dormant = true; e.model.group.visible = false;
    this.enemies = this.enemies.filter(actor => actor !== e);
    e.squad.members = e.squad.members.filter(actor => actor !== e);
    this.squads = this.squads.filter(squad => squad.members.length > 0);
    this.rosterVersion++;
  }

  alertZone(zone: string, at: THREE.Vector3) {
    for (const e of this.enemies) {
      if (!e.dead && (zone === 'all' || e.missionZone === zone)) e.hear(at, Infinity);
    }
  }

  allocationCount() { return this.pool.length; }

  dispose() {
    for (const e of this.pool) {
      e.model.group.removeFromParent();
      e.model.group.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    this.pool = []; this.enemies = []; this.squads = [];
  }
  notifyGunshot(pos: THREE.Vector3, radius = 60) { for (const e of this.enemies) e.hear(pos, radius); }
  aliveCount() { return this.enemies.filter(e => !e.dead).length; }
  private tick = 0;
  update(dt: number) {
    for (const s of this.squads) s.update(dt, this.ctx);
    // Stagger brains: each enemy runs expensive logic every 3rd frame (scaled dt),
    // visuals every frame. Cuts AI raycast/path cost by ~66% with no visible change.
    this.tick++;
    const n = this.enemies.length;
    for (let i = 0; i < n; i++) {
      const e = this.enemies[i];
      e.updateVisualFrame(dt);
      if ((i + this.tick) % 3 === 0) e.updateLogic(dt * 3);
    }
  }
}
