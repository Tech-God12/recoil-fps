// Recoil FPS — Warehouse 5v5 Team Deathmatch.
// One bot brain drives BOTH teams: the four allies fighting beside the player use
// exactly the same targeting, pushes, flanks and grenade logic as the five hostiles.
// Lethal hits kill outright and score immediately — no wounded state, no revives.
// Momentum layer: 3 kills inside 30 s ignites ON FIRE (+damage, +speed) but every enemy hunts you.
import * as THREE from 'three';
import { buildArmoredSoldier, type SoldierModel } from './models';
import type { Effects } from './effects';
import type { AABB } from './world';
import { arenaZoneAt } from './world';
import { NavGrid } from './ai';

export type TDMTeam = 'alpha' | 'bravo';
export type TDMArmor = 0 | 1 | 2;
export type TDMBotState = 'PATROL' | 'ENGAGE' | 'FLANK' | 'PUSH' | 'COVER' | 'DEAD';

export const TDM_MATCH_SECONDS = 150;
export const TDM_RESPAWN_SECONDS = 5;
export const TDM_BASE_HP = 150;
export const TDM_HP_PER_ARMOR = 20;
// ---- momentum "ON FIRE" ----
export const TDM_FIRE_KILLS = 3;
export const TDM_FIRE_WINDOW = 30;
export const TDM_FIRE_SECONDS = 15;
export const TDM_FIRE_COOLDOWN = 20;
export const TDM_FIRE_DMG_MUL = 1.1;
export const TDM_FIRE_SPEED_MUL = 1.05;
export const TDM_FIRE_HUNT_RANGE = 50;
export const TDM_SHUTDOWN_CASH = 500;
/** Player-weapon damage multiplier in TDM. Full damage — bullets must FEEL like
 * they hurt. The 3-headshot floor is enforced by the engine's per-round damage
 * cap (74), not by gutting every hit. */
export const TDM_DAMAGE_MUL = 1.0;
/** Armor damage reduction (bots + player alike): [none, light, heavy].
 * Deliberately light — armor buys roughly 1-3 extra bullets, never immunity. */
export const TDM_HEAD_REDUCTION = [0, 0.10, 0.18];
export const TDM_BODY_REDUCTION = [0, 0.12, 0.22];
export const TDM_ARMOR_NAMES = ['None', 'Light', 'Heavy'] as const;
export const TDM_ARMOR_ICONS = ['○', '◍', '⬢'] as const;

export interface TDMContext {
  scene: THREE.Scene;
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  solids: AABB[];
  half: number;
  groundHeight(x: number, z: number): number;
  effects: Effects;
  playerPos(): THREE.Vector3;   // eye
  playerFeet(): THREE.Vector3;
  playerAlive(): boolean;
  /** Bot→player damage. The engine applies the player's own armor reduction. */
  damagePlayer(amount: number, from: THREE.Vector3, killer: TDMBot): void;
  moveCollide(pos: THREE.Vector3, dx: number, dz: number, radius: number): void;
  onCallout(kind: string, pos: THREE.Vector3, team: TDMTeam): void;
  throwGrenade(from: THREE.Vector3, target: THREE.Vector3, owner: TDMBot): void;
  onBotFire(pos: THREE.Vector3, team: TDMTeam): void;
  onFeed(killer: string, weapon: string, victim: string, headshot: boolean, killerTeam: TDMTeam, zone: string): void;
  onScore(): void; // roster / scoreboard changed
  playerOnFire(): boolean;
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

const ALPHA_NAMES: { name: string; armor: TDMArmor }[] = [
  { name: 'Dagger', armor: 2 }, { name: 'Havoc', armor: 1 }, { name: 'Bricks', armor: 1 }, { name: 'Tundra', armor: 0 },
];
export const BRAVO_ROSTER: { name: string; armor: TDMArmor }[] = [
  { name: 'Viper', armor: 2 }, { name: 'Reaper', armor: 1 }, { name: 'Ghost', armor: 2 }, { name: 'Specter', armor: 0 }, { name: 'Wraith', armor: 1 },
];

const ALPHA_SPAWNS: [number, number][] = [[0, 34], [-12, 37], [12, 37], [-4, 40], [4, 40]];
const BRAVO_SPAWNS: [number, number][] = ALPHA_SPAWNS.map(([x, z]) => [-x, -z]);
/** Contested waypoints: the warehouse doors and interiors, both container yards,
 * and the mid lanes. Kept in sync with the arena layout in world.ts (half 46). */
const MID_POINTS: [number, number][] = [
  [0, 0], [0, 14], [0, -14], [-28, 0], [28, 0], [-10.5, 0], [10.5, 0], [-22, 16], [22, -16], [-28, -12], [28, 12],
];

/** Shared floating team marker so the player can tell allies apart at a glance. */
let allyMarkerTex: THREE.CanvasTexture | null = null;
function getAllyMarkerTexture(): THREE.CanvasTexture {
  if (allyMarkerTex) return allyMarkerTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  // downward chevron, teal with a dark outline — reads as "friendly" instantly
  ctx.beginPath();
  ctx.moveTo(12, 14); ctx.lineTo(52, 14); ctx.lineTo(32, 44); ctx.closePath();
  ctx.fillStyle = '#4FB0C6';
  ctx.strokeStyle = 'rgba(8,12,14,0.9)';
  ctx.lineWidth = 5;
  ctx.stroke(); ctx.fill();
  allyMarkerTex = new THREE.CanvasTexture(c);
  allyMarkerTex.colorSpace = THREE.SRGBColorSpace;
  return allyMarkerTex;
}

/** Soft radial glow shared by the ON FIRE sprite. */
let fireGlowTex: THREE.CanvasTexture | null = null;
function getFireGlowTexture(): THREE.CanvasTexture {
  if (fireGlowTex) return fireGlowTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,190,90,0.95)');
  g.addColorStop(0.4, 'rgba(255,120,30,0.55)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  fireGlowTex = new THREE.CanvasTexture(c);
  fireGlowTex.colorSpace = THREE.SRGBColorSpace;
  return fireGlowTex;
}

interface TargetRef {
  feet: THREE.Vector3;
  eye: THREE.Vector3;
  isPlayer: boolean;
  bot: TDMBot | null;
}

let tdmIds = 0;

export class TDMBot {
  id = tdmIds++;
  name: string;
  team: TDMTeam;
  armor: TDMArmor;
  model: SoldierModel;
  pos: THREE.Vector3;
  yaw = 0;
  maxHp: number;
  hp: number;
  state: TDMBotState = 'PATROL';
  frags = 3;
  flashes = 1;
  /** Match stats: persist across respawns, feed the Tab scoreboard. */
  kills = 0;
  deaths = 0;
  headshots = 0;
  respawnT = -1;
  deadAge = 0;
  stunTimer = 0;
  /** 0 cautious .. 1 aggressive. >0.58 = pusher, 0.35–0.75 may flank, else holder. */
  personality = Math.random();

  private ctx: TDMContext;
  private mgr: TDMManager;
  private nav: NavGrid;
  private stateTime = 0;
  private losTimer = 0;
  private hasLOS = false;
  private target: TargetRef | null = null;
  private lastKnown: THREE.Vector3 | null = null;
  private lastSeenT = 999;
  private burstLeft = 0;
  private burstIdx = 0;
  private shotTimer = 0;
  private pauseTimer = 0.4;
  private grenadeCD = 6 + Math.random() * 8;
  private pushTarget: THREE.Vector3 | null = null;
  private flankTarget: THREE.Vector3 | null = null;
  private coverPos: THREE.Vector3 | null = null;
  private patrolTarget: THREE.Vector3 | null = null;
  private crouched = false;
  private strafeDir = Math.random() > 0.5 ? 1 : -1;
  private strafeT = 0;
  private strafeSpeed = 2.2 + Math.random() * 0.8;
  /** Human-like acquisition delay: counts down after a target first becomes
   * visible; the bot may not fire until it reaches zero AND is facing them. */
  private reactionT = 0;
  private hadLOS = false;
  /** Teal chevron floating above alpha teammates (null for bravo). */
  private allyMarker: THREE.Sprite | null = null;
  // movement / pathing
  private path: THREE.Vector3[] | null = null;
  private pathGoal = new THREE.Vector3();
  private repathT = 0;
  private stuckT = 0;
  private escapeDir = 0;
  private escapeT = 0;
  private blockedT = 0;
  // visuals
  private walkPhase = 0;
  private locomotion = 0;
  private shotPose = 0;
  private flinch = 0;
  private deathT = -1;
  private lastX = 0;
  private lastZ = 0;
  // ---- momentum "ON FIRE" ----
  private killTimes: number[] = [];
  onFire = false;
  private onFireT = 0;
  private fireCooldown = 0;
  private fireGlow: THREE.Sprite | null = null;
  private fireParticles: THREE.Points | null = null;
  private firePhase = 0;
  /** Boosted push speed while hunting an ignited target. */
  private huntPush = false;

  get pusher() { return this.personality > 0.58; }
  get flanker() { return this.personality > 0.35 && this.personality < 0.75; }
  get dead() { return this.state === 'DEAD'; }

  constructor(ctx: TDMContext, mgr: TDMManager, nav: NavGrid, team: TDMTeam, name: string, armor: TDMArmor, spawn: THREE.Vector3) {
    this.ctx = ctx; this.mgr = mgr; this.nav = nav; this.team = team; this.name = name; this.armor = armor;
    this.maxHp = TDM_BASE_HP + armor * TDM_HP_PER_ARMOR;
    this.hp = this.maxHp;
    this.model = buildArmoredSoldier(armor, team === 'alpha' ? 0x2C7C8E : 0xA33326);
    if (team === 'alpha') {
      // Floating chevron above friendly heads — allies must be unmistakable.
      this.allyMarker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getAllyMarkerTexture(), transparent: true, depthWrite: false, depthTest: false,
      }));
      this.allyMarker.scale.set(0.44, 0.44, 1);
      this.allyMarker.renderOrder = 5;
      ctx.scene.add(this.allyMarker);
    }
    // ON FIRE dressing: additive glow + small ember column, hidden until ignited.
    this.fireGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getFireGlowTexture(), color: 0xFFA040, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.fireGlow.scale.set(1.7, 1.7, 1);
    this.fireGlow.visible = false;
    this.fireGlow.renderOrder = 6;
    ctx.scene.add(this.fireGlow);
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
    this.fireParticles = new THREE.Points(emberGeo, new THREE.PointsMaterial({
      color: 0xFFA850, size: 0.13, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.fireParticles.visible = false;
    this.fireParticles.frustumCulled = false;
    ctx.scene.add(this.fireParticles);
    this.pos = spawn.clone();
    this.model.group.position.copy(this.pos);
    ctx.scene.add(this.model.group);
    for (const mesh of this.model.hitMeshes) mesh.userData.tdmBot = this;
    this.lastX = spawn.x; this.lastZ = spawn.z;
    this.yaw = Math.atan2(-(-spawn.x), -(-spawn.z)); // face map centre
  }

  eyePos() { return tmpB.set(this.pos.x, this.pos.y + 1.62 - (this.crouched ? 0.4 : 0), this.pos.z).clone(); }

  respawn(at: THREE.Vector3) {
    this.pos.copy(at);
    this.hp = this.maxHp;
    this.frags = 3; this.flashes = 1;
    this.state = 'PATROL'; this.stateTime = 0;
    this.respawnT = -1; this.deadAge = 0; this.deathT = -1;
    this.target = null; this.lastKnown = null; this.lastSeenT = 999; this.hasLOS = false;
    this.burstLeft = 0; this.pauseTimer = 0.5 + Math.random() * 0.5;
    this.pushTarget = null; this.flankTarget = null; this.coverPos = null; this.patrolTarget = null;
    this.path = null; this.repathT = 0; this.stuckT = 0; this.blockedT = 0;
    this.reactionT = 0; this.hadLOS = false;
    this.stunTimer = 0; this.flinch = 0; this.grenadeCD = 5 + Math.random() * 7;
    this.crouched = false; this.walkPhase = 0; this.locomotion = 0;
    this.lastX = at.x; this.lastZ = at.z;
    // momentum reset: a respawn is a clean sheet
    this.killTimes = [];
    if (this.onFire) this.endFire();
    this.huntPush = false;
    const g = this.model.group;
    g.visible = true; g.position.copy(this.pos); g.rotation.set(0, this.yaw, 0);
    this.model.parts.torso.position.y = 0.95; this.model.parts.torso.rotation.set(0, 0, 0);
    for (const part of [this.model.parts.head, this.model.parts.lLeg, this.model.parts.rLeg, this.model.parts.lShin, this.model.parts.rShin, this.model.parts.lArm, this.model.parts.rArm, this.model.parts.rifle]) part.rotation.set(0, 0, 0);
    this.yaw = Math.atan2(-(0 - at.x), -(0 - at.z));
    g.updateMatrixWorld(true);
  }

  applyStun(t: number) {
    if (this.dead) return;
    this.stunTimer = Math.max(this.stunTimer, t);
    this.flinch = 0.5;
  }

  disposeMarker() {
    if (this.allyMarker) {
      this.allyMarker.removeFromParent();
      this.allyMarker.material.dispose();
      this.allyMarker = null;
    }
    if (this.fireGlow) {
      this.fireGlow.removeFromParent();
      this.fireGlow.material.dispose();
      this.fireGlow = null;
    }
    if (this.fireParticles) {
      this.fireParticles.removeFromParent();
      this.fireParticles.geometry.dispose();
      (this.fireParticles.material as THREE.Material).dispose();
      this.fireParticles = null;
    }
  }

  /** Heard gunfire: soft intel — hunt the noise if not already fighting. */
  hearShot(pos: THREE.Vector3) {
    if (this.dead) return;
    if (this.state === 'PATROL') {
      this.lastKnown = pos.clone();
      this.lastSeenT = Math.min(this.lastSeenT, 4);
      this.patrolTarget = pos.clone();
    }
  }

  /** Damage already scaled by TDM rules; armor reduction applied here so it also
   * protects against bot fire and grenades, not only the player's bullets.
   * Returns true on a killing blow — HP at 0 means dead, immediately. */
  takeDamage(amount: number, isHead: boolean, attacker: TDMBot | 'player', applyArmor = true): boolean {
    if (this.dead) return false;
    let dmg = amount;
    if (applyArmor) dmg *= 1 - (isHead ? TDM_HEAD_REDUCTION[this.armor] : TDM_BODY_REDUCTION[this.armor]);
    this.hp -= dmg;
    this.flinch = isHead ? 0.35 : 0.22;
    // being shot reveals the shooter's rough position
    const from = attacker === 'player' ? this.ctx.playerFeet() : attacker.pos;
    this.lastKnown = from.clone();
    this.lastSeenT = 0;
    if (this.hp <= 0) { this.hp = 0; this.die(); return true; }
    if (this.state === 'PATROL') this.state = 'ENGAGE';
    // Badly hurt → break for cover
    if (this.hp < this.maxHp * 0.35 && this.state !== 'COVER' && Math.random() < 0.65) this.enterCover();
    return false;
  }

  private die() {
    this.state = 'DEAD';
    if (this.onFire) this.endFire();
    this.deathT = 0;
    this.respawnT = TDM_RESPAWN_SECONDS;
    let surfaceY = this.ctx.groundHeight(this.pos.x, this.pos.z);
    for (const b of this.ctx.solids) {
      if (b.maxY > this.pos.y + 0.4 || b.maxY <= surfaceY) continue;
      if (this.pos.x > b.minX - 0.3 && this.pos.x < b.maxX + 0.3 && this.pos.z > b.minZ - 0.3 && this.pos.z < b.maxZ + 0.3) surfaceY = b.maxY;
    }
    this.ctx.effects.bloodDecal(this.pos, surfaceY);
  }

  // ==================== MOMENTUM: "ON FIRE" ====================
  /** Called on every confirmed kill this combatant lands. */
  registerKill() {
    this.killTimes.push(performance.now());
  }

  private ignite() {
    this.onFire = true;
    this.onFireT = TDM_FIRE_SECONDS;
    this.killTimes = [];
    this.mgr.onIgnite(this);
  }

  endFire() {
    this.onFire = false;
    this.onFireT = 0;
    this.fireCooldown = TDM_FIRE_COOLDOWN;
    this.huntPush = false;
    if (this.fireGlow) this.fireGlow.visible = false;
    if (this.fireParticles) this.fireParticles.visible = false;
  }

  /** Momentum timers — driven by the manager with real (unstripped) dt. */
  updateFire(dt: number) {
    if (this.dead) return;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const now = performance.now();
    while (this.killTimes.length && now - this.killTimes[0] > TDM_FIRE_WINDOW * 1000) this.killTimes.shift();
    if (!this.onFire && this.fireCooldown <= 0 && this.killTimes.length >= TDM_FIRE_KILLS) this.ignite();
    if (this.onFire) {
      this.onFireT -= dt;
      if (this.onFireT <= 0) this.endFire();
    }
  }

  private setState(s: TDMBotState) {
    if (this.state === 'DEAD') return;
    if (this.state !== s) { this.state = s; this.stateTime = 0; this.path = null; }
  }

  private enterCover() {
    const threat = this.lastKnown ?? this.target?.feet ?? null;
    if (!threat) return;
    let best: THREE.Vector3 | null = null, bestScore = Infinity;
    for (const node of this.ctx.coverNodes) {
      const d = node.distanceTo(this.pos);
      if (d > 26) continue;
      if (node.distanceTo(threat) < 6) continue;
      // cover must break LOS from the threat's eye level
      const eye = tmpA.set(node.x, node.y + 1.25, node.z);
      const dir = new THREE.Vector3(threat.x, threat.y + 1.5, threat.z).sub(eye);
      const dist = dir.length(); dir.normalize();
      ray.set(eye.clone(), dir); ray.far = Math.min(dist - 0.3, 50);
      if (ray.intersectObjects(this.ctx.occluders, false).length === 0) continue;
      const score = d + Math.random() * 4;
      if (score < bestScore) { bestScore = score; best = node; }
    }
    if (best) {
      this.coverPos = best.clone();
      this.setState('COVER');
      this.ctx.onCallout('fallback', this.pos, this.team);
    }
  }

  private isFireTarget(t: TargetRef): boolean {
    if (t.bot) return t.bot.onFire;
    return this.ctx.playerOnFire();
  }

  /** Pick the nearest live enemy (bravo bots also hunt the player).
   * An ON FIRE enemy within 50 m overrides everything — the bounty IS the fight. */
  private acquireTarget(): TargetRef | null {
    let fire: TargetRef | null = null;
    let fd = Infinity;
    if (this.team === 'bravo' && this.ctx.playerAlive() && this.ctx.playerOnFire()) {
      const feet = this.ctx.playerFeet();
      const d = feet.distanceTo(this.pos);
      if (d < TDM_FIRE_HUNT_RANGE) { fd = d; fire = { feet, eye: this.ctx.playerPos(), isPlayer: true, bot: null }; }
    }
    for (const bot of this.mgr.bots) {
      if (bot.team === this.team || bot.dead || !bot.onFire) continue;
      const d = bot.pos.distanceTo(this.pos);
      if (d < TDM_FIRE_HUNT_RANGE && d < fd) { fd = d; fire = { feet: bot.pos.clone(), eye: bot.eyePos(), isPlayer: false, bot }; }
    }
    if (fire) return fire;
    let best: TargetRef | null = null;
    let bestD = Infinity;
    if (this.team === 'bravo' && this.ctx.playerAlive()) {
      const feet = this.ctx.playerFeet();
      const d = feet.distanceTo(this.pos);
      if (d < bestD) { bestD = d; best = { feet, eye: this.ctx.playerPos(), isPlayer: true, bot: null }; }
    }
    for (const bot of this.mgr.bots) {
      if (bot.team === this.team || bot.dead) continue;
      const d = bot.pos.distanceTo(this.pos);
      if (d < bestD) { bestD = d; best = { feet: bot.pos.clone(), eye: bot.eyePos(), isPlayer: false, bot }; }
    }
    return best;
  }

  private checkLOS(target: TargetRef): boolean {
    const eye = this.eyePos();
    const dist = eye.distanceTo(target.eye);
    if (dist > 78) return false;
    const dir = tmpA.copy(target.eye).sub(eye).normalize();
    ray.set(eye, dir); ray.far = dist - 0.3;
    return ray.intersectObjects(this.ctx.occluders, false).length === 0;
  }

  /** Navigate; returns true on arrival (or when the goal proves unreachable). */
  private goTo(target: THREE.Vector3, speed: number, dt: number): boolean {
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (dist < 0.5) { this.path = null; return true; }
    this.repathT -= dt;
    const direct = this.nav.lineFree(this.pos.x, this.pos.z, target.x, target.z);
    if (!direct) {
      if (this.repathT <= 0 || this.pathGoal.distanceTo(target) > 2) {
        this.path = this.nav.path(this.pos, target);
        this.pathGoal.copy(target); this.repathT = 1.4 + (this.id % 5) * 0.15;
      }
    } else this.path = null;
    let wp = target;
    if (this.path && this.path.length) {
      // advance waypoints aggressively: on arrival, OR whenever the straight
      // line to the NEXT waypoint is already clear (stops corner-hugging jams)
      while (this.path.length && (
        Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.9 ||
        (this.path.length > 1 && this.nav.lineFree(this.pos.x, this.pos.z, this.path[1].x, this.path[1].z))
      )) this.path.shift();
      wp = this.path[0] ?? target;
    }
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    const bx = this.pos.x, bz = this.pos.z;
    const fireMul = this.onFire ? TDM_FIRE_SPEED_MUL : 1;
    this.ctx.moveCollide(this.pos, (dx / d) * speed * fireMul * dt, (dz / d) * speed * fireMul * dt, 0.36);
    const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
    if (moved < speed * dt * 0.25) {
      this.stuckT += dt; this.blockedT += dt;
      if (this.stuckT > 0.25) {
        if (this.escapeT <= 0) {
          // probe BOTH perpendicular directions and commit to whichever
          // actually moves — no more guessing wrong and grinding a wall
          const px = this.pos.x, pz = this.pos.z, step = speed * dt * 1.6;
          let bestSide = 0, bestGain = 0;
          for (const side of [1, -1] as const) {
            const probe = this.pos.clone();
            this.ctx.moveCollide(probe, (-dz / d) * side * step * 4, (dx / d) * side * step * 4, 0.36);
            const gain = Math.hypot(probe.x - px, probe.z - pz);
            if (gain > bestGain) { bestGain = gain; bestSide = side; }
          }
          this.escapeDir = bestSide !== 0 ? bestSide : (this.escapeDir === 0 ? 1 : -this.escapeDir);
          this.escapeT = 0.7;
          this.path = null; this.repathT = Math.max(this.repathT, 0.4);
        }
        this.escapeT -= dt;
        const side = this.escapeDir;
        this.ctx.moveCollide(this.pos,
          ((-dz / d) * side * 0.95 + (dx / d) * 0.3) * speed * dt * 1.6,
          ((dx / d) * side * 0.95 + (dz / d) * 0.3) * speed * dt * 1.6, 0.36);
        // truly wedged → give up on this goal entirely and pick a new one
        if (this.blockedT > 2.2) { this.blockedT = 0; this.stuckT = 0; this.escapeT = 0; this.path = null; this.repathT = Math.max(this.repathT, 1.0); return true; }
      }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
      this.escapeT = Math.max(0, this.escapeT - dt);
      this.blockedT = Math.max(0, this.blockedT - dt);
    }
    // teammate separation
    for (const mate of this.mgr.bots) {
      if (mate === this || mate.dead || mate.team !== this.team) continue;
      const sx = this.pos.x - mate.pos.x, sz = this.pos.z - mate.pos.z, gap = Math.hypot(sx, sz);
      if (gap > 0.02 && gap < 1.8) this.ctx.moveCollide(this.pos, sx / gap * (1.8 - gap) * dt, sz / gap * (1.8 - gap) * dt, 0.36);
    }
    this.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  private faceTarget(t: THREE.Vector3) { this.yaw = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z)); }

  /** True only when the RENDERED body actually faces the target (±40°).
   * The logic yaw snaps instantly but the model turns at a finite speed —
   * without this gate bots could shoot targets behind their back. */
  private renderedFacing(t: THREE.Vector3): boolean {
    const want = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z));
    let d = want - this.model.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) < 0.7;
  }

  private fireShot(target: TargetRef) {
    this.model.group.updateMatrixWorld(true);
    const muzzle = this.model.parts.muzzle.getWorldPosition(new THREE.Vector3());
    this.shotPose = 1;
    this.ctx.effects.enemyMuzzle(muzzle);
    this.ctx.onBotFire(muzzle, this.team);
    const aimAt = target.eye.clone();
    const dist = muzzle.distanceTo(aimAt);
    // accuracy 0.82 close → 0.43 at 65 m; first bullet of a burst +0.12
    let acc = THREE.MathUtils.lerp(0.82, 0.43, THREE.MathUtils.clamp((dist - 4) / 61, 0, 1));
    if (this.burstIdx === 0) acc = Math.min(0.94, acc + 0.12);
    this.burstIdx++;
    // never shoot through a wall
    ray.set(muzzle, tmpA.copy(aimAt).sub(muzzle).normalize()); ray.far = Math.max(0, dist - 0.25);
    const wall = ray.intersectObjects(this.ctx.occluders, false)[0];
    const hostile = this.team === 'bravo';
    if (wall) { this.ctx.effects.tracer(muzzle, wall.point, hostile); return; }
    if (Math.random() < acc) {
      this.ctx.effects.tracer(muzzle, aimAt, hostile);
      const headshot = Math.random() < 0.10;
      // 44 head / 18-24 body — tuned against the lighter TDM armor curve so a
      // full-HP player survives roughly 7-9 hits (plus regen between fights)
      const dmg = (headshot ? 44 : 18 + Math.random() * 6) * (this.onFire ? TDM_FIRE_DMG_MUL : 1);
      if (target.isPlayer) {
        if (this.ctx.playerAlive()) this.ctx.damagePlayer(dmg, this.pos, this);
      } else if (target.bot && !target.bot.dead) {
        this.ctx.effects.blood(aimAt);
        const killed = target.bot.takeDamage(dmg, headshot, this);
        if (killed) this.mgr.handleKill(this, target.bot, headshot, 'RIFLE');
      }
    } else {
      const miss = aimAt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.6, (Math.random() - 0.3) * 1.8, (Math.random() - 0.5) * 2.6));
      this.ctx.effects.tracer(muzzle, miss, hostile);
    }
  }

  private tryGrenade(target: TargetRef, dist: number) {
    if (this.grenadeCD > 0 || this.frags <= 0) return;
    if (dist < 9 || dist > 34) return;
    let chance = this.hasLOS ? 0.015 : 0.08;   // flush targets hiding behind cover
    if (this.pusher) chance *= 1.3;
    if (dist > 18) chance *= 1.5;
    if (Math.random() > chance) { this.grenadeCD = 0.8; return; }
    this.frags--;
    this.grenadeCD = 10 + Math.random() * 7;
    this.ctx.onCallout('grenade', this.pos, this.team);
    const at = (this.hasLOS ? target.feet : (this.lastKnown ?? target.feet)).clone();
    at.x += (Math.random() - 0.5) * 3; at.z += (Math.random() - 0.5) * 3;
    this.ctx.throwGrenade(this.eyePos(), at, this);
  }

  /** Squad comms: borrow intel from any living teammate that has eyes on. */
  private shareIntel() {
    for (const mate of this.mgr.bots) {
      if (mate === this || mate.dead || mate.team !== this.team) continue;
      if (!mate.hasLOS || !mate.lastKnown) continue;
      if (mate.pos.distanceTo(this.pos) > 50) continue;
      if (!this.lastKnown || mate.lastSeenT < this.lastSeenT) {
        this.lastKnown = mate.lastKnown.clone();
        this.lastSeenT = Math.min(this.lastSeenT, mate.lastSeenT + 0.3);
      }
    }
  }

  updateLogic(dt: number) {
    if (this.dead || this.stunTimer > 0) return;
    this.stateTime += dt; this.lastSeenT += dt;
    this.grenadeCD = Math.max(0, this.grenadeCD - dt);

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.08 + Math.random() * 0.07;
      this.target = this.acquireTarget();
      this.hasLOS = this.target ? this.checkLOS(this.target) : false;
      if (this.hasLOS && this.target) {
        // fresh acquisition → human reaction delay before the first round
        if (!this.hadLOS) this.reactionT = 0.28 + Math.random() * 0.22;
        this.lastKnown = this.target.feet.clone();
        this.lastSeenT = 0;
        if (this.state === 'PATROL') this.setState('ENGAGE');
      }
      if (!this.hasLOS) this.shareIntel();
      this.hadLOS = this.hasLOS;
    }
    this.reactionT = Math.max(0, this.reactionT - dt);
    /** May this bot legally pull the trigger right now? Needs sight, an elapsed
     * reaction window, and a rendered body that is actually pointing that way. */
    const canFire = (t: TargetRef) => this.hasLOS && this.reactionT <= 0 && this.renderedFacing(t.feet);

    const target = this.target;
    const dist = target ? Math.hypot(target.feet.x - this.pos.x, target.feet.z - this.pos.z) : Infinity;

    switch (this.state) {
      case 'PATROL': {
        this.crouched = false;
        // bounty spotted while patrolling → drop everything and PUSH the fire target
        if (target && this.isFireTarget(target)) { this.startPush(target, true); break; }
        if (!this.patrolTarget) {
          const roll = Math.random();
          if (roll < 0.35) {
            // hunt INTO the enemy half — this is what makes both squads press
            // the attack instead of orbiting their own yard
            const sign = this.team === 'alpha' ? -1 : 1;
            this.patrolTarget = new THREE.Vector3((Math.random() - 0.5) * 44, 0, sign * (14 + Math.random() * 18));
          } else if (roll < 0.9) {
            // contested middle: doors, corridor, yards
            const p = MID_POINTS[Math.floor(Math.random() * MID_POINTS.length)];
            this.patrolTarget = new THREE.Vector3(p[0] + (Math.random() - 0.5) * 6, 0, p[1] + (Math.random() - 0.5) * 6);
          } else {
            // rare short hold near base (holders covering the yard)
            const baseZ = this.team === 'alpha' ? 26 : -26;
            const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 14;
            this.patrolTarget = new THREE.Vector3(Math.cos(a) * r, 0, baseZ + Math.sin(a) * r * 0.5);
          }
          const h = this.ctx.half - 4;
          this.patrolTarget.x = THREE.MathUtils.clamp(this.patrolTarget.x, -h, h);
          this.patrolTarget.z = THREE.MathUtils.clamp(this.patrolTarget.z, -h, h);
        }
        const speed = this.pusher ? 3.9 : 3.1;
        if (this.goTo(this.patrolTarget, speed, dt)) this.patrolTarget = null;
        // hunt stale intel — but once the spot has been checked, drop it and move
        // on (never loiter over a body waiting for the victim to come back)
        if (!this.hasLOS && this.lastKnown && this.lastSeenT < 9) {
          if (Math.hypot(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z) < 2.2) {
            this.lastKnown = null; this.lastSeenT = 999; this.patrolTarget = null;
          } else this.patrolTarget = this.lastKnown.clone();
        }
        break;
      }
      case 'ENGAGE': {
        if (!target) { this.setState('PATROL'); break; }
        // bounty IS the fight: an on-fire enemy never gets poked at range — push him
        if (this.isFireTarget(target) && !this.huntPush) { this.startPush(target, true); break; }
        if (this.hasLOS) {
          this.crouched = false;
          this.faceTarget(target.feet);
          // burst fire: 2–5 rounds, 0.12–0.18 s between shots.
          // Gated on canFire so the body must visibly aim first.
          this.shotTimer -= dt;
          if (this.burstLeft > 0 && this.shotTimer <= 0 && canFire(target)) {
            this.fireShot(target);
            this.burstLeft--;
            this.shotTimer = 0.12 + Math.random() * 0.06;
            if (this.burstLeft <= 0) this.pauseTimer = 0.35 + Math.random() * 0.55;
          } else if (this.burstLeft <= 0) {
            this.pauseTimer -= dt;
            if (this.pauseTimer <= 0) { this.burstLeft = 2 + Math.floor(Math.random() * 4); this.burstIdx = 0; }
          }
          // strafe perpendicular to the target while shooting
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeDir = -this.strafeDir; this.strafeT = 0.7 + Math.random() * 1.1; }
          const dx = this.pos.x - target.feet.x, dz = this.pos.z - target.feet.z, d = Math.hypot(dx, dz) || 1;
          this.ctx.moveCollide(this.pos, (-dz / d) * this.strafeDir * this.strafeSpeed * dt, (dx / d) * this.strafeDir * this.strafeSpeed * dt, 0.36);
          // keep a sane range band: back off point-blank, close at long range
          if (dist > 34) this.ctx.moveCollide(this.pos, (-dx / d) * 2.4 * dt, (-dz / d) * 2.4 * dt, 0.36);
          else if (dist < 5) this.ctx.moveCollide(this.pos, (dx / d) * 2.0 * dt, (dz / d) * 2.0 * dt, 0.36);
          this.tryGrenade(target, dist);
          // committed push: pushers close the fight instead of poking forever
          if (this.pusher && dist > 6 && dist < 28 && Math.random() < dt * 0.9) this.startPush(target);
        } else {
          // lost sight: flankers wing around, pushers charge the last position, holders hunt
          this.tryGrenade(target, dist);
          if (this.flanker && Math.random() < 0.5 && this.lastSeenT < 6) this.startFlank(target);
          else if (this.pusher || this.isFireTarget(target)) this.startPush(target, this.isFireTarget(target));
          else if (this.lastKnown) {
            if (this.goTo(this.lastKnown, 3.8, dt) || this.lastSeenT > 8) {
              // checked the spot — forget it so we don't camp a corpse
              this.lastKnown = null; this.lastSeenT = 999;
              this.setState('PATROL');
            }
          } else this.setState('PATROL');
        }
        break;
      }
      case 'PUSH': {
        this.crouched = false;
        if (!this.pushTarget) { this.setState('ENGAGE'); break; }
        // shoot on the move whenever sight opens up (still needs to face them)
        if (this.hasLOS && target && canFire(target)) {
          this.shotTimer -= dt;
          if (this.shotTimer <= 0) { this.burstIdx = 1; this.fireShot(target); this.shotTimer = 0.22 + Math.random() * 0.08; }
        }
        if (this.goTo(this.pushTarget, this.huntPush ? 6.6 : 4.6, dt) || this.stateTime > (this.huntPush ? 9 : 7)) {
          this.pushTarget = null; this.huntPush = false; this.setState('ENGAGE');
        }
        break;
      }
      case 'FLANK': {
        this.crouched = false;
        if (!this.flankTarget) { this.setState('ENGAGE'); break; }
        if (this.goTo(this.flankTarget, 4.6, dt) || (this.hasLOS && this.stateTime > 2) || this.stateTime > 11) {
          this.flankTarget = null; this.setState('ENGAGE');
        }
        break;
      }
      case 'COVER': {
        if (!this.coverPos) { this.setState('ENGAGE'); break; }
        const atCover = this.pos.distanceTo(this.coverPos) < 0.7;
        if (!atCover) { this.goTo(this.coverPos, 4.8, dt); this.crouched = false; }
        else {
          this.crouched = true;
          if (this.lastKnown) this.faceTarget(this.lastKnown);
          // pop out and return fire once partially recovered / after a beat
          if (this.hasLOS && target && this.stateTime > 1.2 && canFire(target)) {
            this.crouched = false;
            this.shotTimer -= dt;
            if (this.shotTimer <= 0) { this.burstIdx = 0; this.fireShot(target); this.shotTimer = 0.15; }
          }
          if (this.stateTime > 4.5 + Math.random() * 3) {
            this.coverPos = null;
            this.setState('ENGAGE');
          }
        }
        break;
      }
      case 'DEAD': break;
    }
  }

  private startPush(target: TargetRef, hunt = false) {
    // pushes prefer pack behaviour but never stall the match: an ally nearby
    // always green-lights it, and even alone the push goes through 80% of the time
    if (!hunt) {
      const allyNear = this.mgr.bots.some(b => b !== this && !b.dead && b.team === this.team && b.pos.distanceTo(this.pos) < 22);
      if (!allyNear && Math.random() > 0.8) return;
    }
    this.huntPush = hunt;
    const at = (this.hasLOS ? target.feet : (this.lastKnown ?? target.feet)).clone();
    at.x += (Math.random() - 0.5) * 10; at.z += (Math.random() - 0.5) * 10;
    const h = this.ctx.half - 4;
    at.x = THREE.MathUtils.clamp(at.x, -h, h); at.z = THREE.MathUtils.clamp(at.z, -h, h);
    this.pushTarget = at;
    this.setState('PUSH');
    this.ctx.onCallout(hunt ? 'pushfire' : 'push', this.pos, this.team);
  }

  private startFlank(target: TargetRef) {
    const at = this.lastKnown ?? target.feet;
    const away = tmpA.set(this.pos.x - at.x, 0, this.pos.z - at.z).normalize();
    // 90° ± 34° offset, 8–18 m out
    const ang = (Math.PI / 2 + (Math.random() - 0.5) * 1.2) * (this.id % 2 === 0 ? 1 : -1);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const dir = new THREE.Vector3(away.x * cos - away.z * sin, 0, away.x * sin + away.z * cos);
    const r = 8 + Math.random() * 10;
    const p = new THREE.Vector3(at.x + dir.x * r, 0, at.z + dir.z * r);
    const h = this.ctx.half - 4;
    p.x = THREE.MathUtils.clamp(p.x, -h, h); p.z = THREE.MathUtils.clamp(p.z, -h, h);
    this.flankTarget = p;
    this.setState('FLANK');
    this.ctx.onCallout('flank', this.pos, this.team);
  }

  updateVisualFrame(dt: number) {
    if (this.allyMarker) {
      this.allyMarker.visible = !this.dead;
      // gentle bob so the chevron reads as a marker, not level geometry
      this.allyMarker.position.set(this.pos.x, this.pos.y + 2.24 + Math.sin(performance.now() * 0.003 + this.id) * 0.05, this.pos.z);
    }
    // ON FIRE dressing: flicker the glow and cycle the ember column
    if (this.onFire) {
      this.firePhase += dt;
      const t = performance.now() * 0.001;
      if (this.fireGlow) {
        this.fireGlow.visible = true;
        this.fireGlow.position.set(this.pos.x, this.pos.y + 1.25 + Math.sin(t * 9) * 0.08, this.pos.z);
        const s = 1.6 + Math.sin(t * 13) * 0.18;
        this.fireGlow.scale.set(s, s, 1);
      }
      if (this.fireParticles) {
        this.fireParticles.visible = true;
        const arr = this.fireParticles.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < 14; i++) {
          const a = this.firePhase * (1.7 + (i % 4) * 0.35) + i * 2.39;
          const r = 0.28 + (i % 3) * 0.13;
          arr[i * 3] = this.pos.x + Math.cos(a) * r;
          arr[i * 3 + 1] = this.pos.y + 0.35 + ((this.firePhase * (1.4 + (i % 5) * 0.3) + i * 0.37) % 1.35);
          arr[i * 3 + 2] = this.pos.z + Math.sin(a) * r;
        }
        this.fireParticles.geometry.attributes.position.needsUpdate = true;
      }
    }
    if (this.dead) {
      this.deadAge += dt;
      if (this.deathT >= 0 && this.deathT < 0.6) {
        this.deathT += dt;
        const t = Math.min(1, this.deathT / 0.5);
        this.model.group.rotation.x = -t * Math.PI / 2 * 0.96;
        this.model.group.position.y = this.pos.y + 0.1 * Math.sin(t * Math.PI);
      }
      // corpse fades from the field a moment before the respawn
      if (this.deadAge > TDM_RESPAWN_SECONDS - 1.5) this.model.group.visible = false;
      return;
    }
    if (this.stunTimer > 0) this.stunTimer -= dt;
    this.flinch = Math.max(0, this.flinch - dt);
    const g = this.model.group;
    this.pos.y = Math.max(this.pos.y, this.ctx.groundHeight(this.pos.x, this.pos.z));
    g.position.set(this.pos.x, this.pos.y, this.pos.z);
    g.rotation.x = 0;
    let dy = this.yaw - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, dt * 10);
    const p = this.model.parts;
    const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x; this.lastZ = this.pos.z;
    const targetTorsoY = this.crouched ? 0.55 : 0.95;
    p.torso.position.y += (targetTorsoY - p.torso.position.y) * Math.min(1, dt * 9);
    const measured = Math.min(18, moved / Math.max(dt, 0.001));
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
    const aiming = this.state === 'ENGAGE' || this.state === 'COVER' || this.state === 'PUSH';
    p.rifle.rotation.x += ((aiming ? -0.025 - this.shotPose * 0.12 : 0.32) - p.rifle.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.x += ((aiming ? 1.35 : -0.1) - p.rArm.rotation.x) * Math.min(1, dt * 6);
    p.lArm.rotation.x += ((aiming ? 1.25 : 0.12) - p.lArm.rotation.x) * Math.min(1, dt * 6);
    p.rArm.rotation.z += ((aiming ? -0.25 : 0) - p.rArm.rotation.z) * Math.min(1, dt * 6);
    p.lArm.rotation.z += ((aiming ? 0.3 : 0) - p.lArm.rotation.z) * Math.min(1, dt * 6);
    p.torso.rotation.x = -this.flinch * 0.8 + stride * 0.045 - this.shotPose * 0.035;
    p.head.rotation.x = -this.flinch * 1.2;
  }
}

export class TDMManager {
  bots: TDMBot[] = [];
  alphaScore = 0;
  bravoScore = 0;
  timeLeft = TDM_MATCH_SECONDS;
  rosterVersion = 0;
  nav: NavGrid;
  private ctx: TDMContext;
  private tick = 0;

  constructor(ctx: TDMContext) {
    this.ctx = ctx;
    this.nav = new NavGrid(ctx.solids, ctx.half, ctx.groundHeight);
    for (let i = 0; i < ALPHA_NAMES.length; i++) {
      const s = this.getSpawn('alpha');
      this.bots.push(new TDMBot(ctx, this, this.nav, 'alpha', ALPHA_NAMES[i].name, ALPHA_NAMES[i].armor, s));
    }
    for (let i = 0; i < BRAVO_ROSTER.length; i++) {
      const s = this.getSpawn('bravo');
      this.bots.push(new TDMBot(ctx, this, this.nav, 'bravo', BRAVO_ROSTER[i].name, BRAVO_ROSTER[i].armor, s));
    }
  }

  /** Team spawn: one of five authored pads with a ±2–4 m scatter, preferring the
   * pad farthest from any living enemy so respawns never land inside a fight. */
  getSpawn(team: TDMTeam): THREE.Vector3 {
    const pads = team === 'alpha' ? ALPHA_SPAWNS : BRAVO_SPAWNS;
    let best: THREE.Vector3 | null = null, bestD = -1;
    for (const [px, pz] of pads) {
      const jitterA = Math.random() * Math.PI * 2, jitterR = 2 + Math.random() * 2;
      const p = new THREE.Vector3(px + Math.cos(jitterA) * jitterR, 0, pz + Math.sin(jitterA) * jitterR * 0.5);
      const h = this.ctx.half - 3;
      p.x = THREE.MathUtils.clamp(p.x, -h, h);
      p.z = THREE.MathUtils.clamp(p.z, -h, h);
      const [cx, cz] = this.nav.nearestFree(this.nav.toCell(p.x), this.nav.toCell(p.z));
      p.set(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
      let nearest = Infinity;
      for (const b of this.bots) {
        if (b.dead || b.team === team) continue;
        nearest = Math.min(nearest, b.pos.distanceTo(p));
      }
      if (team === 'bravo' && this.ctx.playerAlive()) nearest = Math.min(nearest, this.ctx.playerFeet().distanceTo(p));
      // Cap so pads tie when no enemy is near — the random term then spreads the
      // squad across all five pads instead of stacking everyone on the first.
      const d = Math.min(nearest, 60) + Math.random() * 12;
      if (d > bestD) { bestD = d; best = p; }
    }
    return best!;
  }

  handleKill(killer: TDMBot | 'player', victim: TDMBot | 'player', headshot: boolean, weapon: string) {
    const killerTeam: TDMTeam = killer === 'player' ? 'alpha' : killer.team;
    if (killerTeam === 'alpha') this.alphaScore++; else this.bravoScore++;
    // per-combatant stat lines (the player's own line lives in the engine)
    if (killer !== 'player') { killer.kills++; if (headshot) killer.headshots++; killer.registerKill(); }
    if (victim !== 'player') victim.deaths++;
    this.rosterVersion++;
    const killerName = killer === 'player' ? 'YOU' : killer.name;
    const victimName = victim === 'player' ? 'YOU' : victim.name;
    const vx = victim === 'player' ? this.ctx.playerFeet().x : victim.pos.x;
    const vz = victim === 'player' ? this.ctx.playerFeet().z : victim.pos.z;
    this.ctx.onFeed(killerName, weapon, victimName, headshot, killerTeam, arenaZoneAt(vx, vz));
    this.ctx.onScore();
  }

  /** Someone is ON FIRE — enemies are told to hunt. */
  onIgnite(bot: TDMBot) {
    this.ctx.onCallout('onfire', bot.pos, bot.team);
  }

  aliveCount(team: TDMTeam) { return this.bots.filter(b => b.team === team && !b.dead).length; }

  /** Player gunfire is intel for the hostile team (allies already track enemies). */
  notifyGunshot(pos: THREE.Vector3, radius = 55) {
    for (const b of this.bots) {
      if (b.dead || b.team !== 'bravo') continue;
      if (b.pos.distanceTo(pos) <= radius) b.hearShot(pos);
    }
  }

  /** Every live hostile body the player's bullets can hit. Teammates are excluded —
   * friendly fire is off and ally bodies must never eat the player's shots. */
  getHittables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const b of this.bots) if (!b.dead && b.team === 'bravo') out.push(...b.model.hitMeshes);
    return out;
  }

  update(dt: number) {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.tick++;
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      b.updateVisualFrame(dt);
      if ((i + this.tick) % 2 === 0) b.updateLogic(dt * 2);
      b.updateFire(dt);
      if (b.dead && b.respawnT > 0) {
        b.respawnT -= dt;
        if (b.respawnT <= 0 && this.timeLeft > 3) {
          b.respawn(this.getSpawn(b.team));
          this.rosterVersion++;
        }
      }
    }
  }

  dispose() {
    for (const b of this.bots) {
      b.disposeMarker();
      b.model.group.removeFromParent();
      b.model.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    }
    this.bots = [];
  }
}
