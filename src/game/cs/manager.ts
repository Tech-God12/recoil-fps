// Recoil FPS — DUSTYARD TACTICAL manager: MR8 rounds, the CS2 economy, the C4.
//
// Owns the whole competitive loop: freeze → live → (planted) → round end, the
// first-to-9 match race with the half-time spawn swap at round 8, every wallet in
// the match (the player's plus each bot's), the bomb entity (carried / dropped /
// planted with its accelerating beep), smoke clouds that blind bot vision, and the
// per-bot duty assignments that make nine AI operators play the objective.
//
// The Engine stays responsible for the human side: pointer input, buying UI, the
// player's own plant/defuse channel, and all rendering. This file never touches
// the camera.
import * as THREE from 'three';
import { NavGrid } from '../ai';
import type { World } from '../world';
import { CSBot, type CSBotCtx, type CSHost, type CSDuty } from './bot';
import {
  ALPHA_ROSTER, BRAVO_ROSTER, TDM_FRAG_RADIUS, blastArmorMul, tdmFragDamage, type ArmorLevel, type TeamId,
} from '../tdm/armor';
import {
  botBuyPlan, clampMoney, killReward, lossBonus, roundPayout,
  CS_BOMB_SECONDS, CS_DEFUSE_BONUS, CS_FREEZE_SECONDS, CS_HALF_ROUNDS, CS_MAX_ROUNDS,
  CS_PLANT_BONUS, CS_ROUND_END_SECONDS, CS_ROUND_SECONDS, CS_START_MONEY,
  CS_WIN_ROUNDS, type CSWeaponClass, type CSWeaponId, gunById,
} from './economy';
import { CS_BUY_ZONES, CS_SPAWNS, DUSTYARD_SITES, SITE_HOLDS } from './dustyard';

export type CSPhase = 'FREEZE' | 'LIVE' | 'PLANTED' | 'ROUND_END';
export type CSWinReason = 'ELIMINATION' | 'TIME' | 'BOMB_EXPLODED' | 'BOMB_DEFUSED';

export interface CSManagerOptions {
  world: World;
  ctx: CSBotCtx;
  /** The scene the match renders from — bot models and the bomb entity live here. */
  scene: THREE.Scene;
  onFeed(text: string, headshot: boolean, mine: boolean): void;
  /** Player wallet changed: engine turns this into the +$ HUD pop. */
  onMoney(amount: number, reason: string): void;
  onPhase(phase: CSPhase): void;
  onRoundEnd(winner: TeamId, reason: CSWinReason): void;
  onBombPlanted(at: THREE.Vector3, site: 'A' | 'B'): void;
  onBombBeep(at: THREE.Vector3): void;
  onBombExploded(at: THREE.Vector3): void;
  onBombDefused(byBot: CSBot | null): void;
  /** Round reset for the human: engine repositions, refills, re-arms. */
  onRoundStart(spawn: THREE.Vector3, yaw: number): void;
  onMatchEnd(): void;
}

export interface CSPlayerRow {
  name: string; armor: ArmorLevel; kills: number; deaths: number; money: number;
  alive: boolean; hasBomb: boolean; damage: number; you: boolean;
}
export interface CsHudState {
  phase: CSPhase;
  alphaRounds: number; bravoRounds: number;
  round: number; maxRounds: number;
  /** Seconds left in the current sub-phase (freeze, round clock, or end pause). */
  timeLeft: number;
  roundTimeLeft: number;
  freezeLeft: number;
  bombTimeLeft: number;
  planted: boolean;
  site: 'A' | 'B' | null;
  playerMoney: number; playerArmor: ArmorLevel; playerKit: boolean; playerAlive: boolean;
  lossStreakAlpha: number; lossStreakBravo: number;
  nextLossBonus: number;
  aliveAlpha: number; aliveBravo: number;
  roundResult: { winner: TeamId; reason: CSWinReason } | null;
  matchOver: boolean;
  halftime: boolean;
  canBuy: boolean;
  inBuyZone: boolean;
  /** Where the C4 is, normalized for the radar (planted or dropped). */
  bombNx: number; bombNz: number;
  bombVisible: boolean;
  alpha: CSPlayerRow[];
  bravo: CSPlayerRow[];
  rosterVersion: number;
  /* ---- engine-supplied extras (viewmodel + channel state) ---- */
  weapon?: string; mag?: number; magSize?: number; knifeOut?: boolean;
  defusePct?: number;
  fragN?: number; flashN?: number; smokeN?: number; molotovN?: number;
}

export interface CSScoreRow {
  name: string; team: TeamId; kills: number; deaths: number; damage: number;
  alive: boolean; armor: ArmorLevel; money: number; you: boolean; mvp: boolean;
}
export interface CsReport {
  alphaRounds: number; bravoRounds: number;
  winner: TeamId | 'draw';
  rounds: { alpha: number; bravo: number }[];
  rows: CSScoreRow[];
  playerKills: number; playerDeaths: number; playerDamage: number;
  adr: number;
  duration: number;
}

const ROLE_BIAS: Record<string, number> = { Assault: 0.72, Breacher: 0.6, Overwatch: 0.34, Runner: 0.68, Flanker: 0.5 };

interface Smoke { x: number; y: number; z: number; r: number; t: number; group: THREE.Group }
interface Fire { x: number; y: number; z: number; r: number; t: number; group: THREE.Group; light: THREE.PointLight }

export class CSManager implements CSHost {
  bots: CSBot[] = [];
  alpha: CSBot[] = [];
  bravo: CSBot[] = [];
  nav: NavGrid;

  phase: CSPhase = 'FREEZE';
  freezeLeft = CS_FREEZE_SECONDS;
  roundLeft = CS_ROUND_SECONDS;
  bombLeft = CS_BOMB_SECONDS;
  endLeft = CS_ROUND_END_SECONDS;
  alphaRounds = 0;
  bravoRounds = 0;
  round = 1;
  matchOver = false;
  halftime = false;
  roundResult: { winner: TeamId; reason: CSWinReason } | null = null;
  roundHistory: { alpha: number; bravo: number }[] = [];

  // The human is ALPHA's fifth slot (CT side all match — half-time swaps spawns only).
  playerMoney = CS_START_MONEY;
  playerArmor: ArmorLevel = 0;
  playerKit = false;
  playerDead = false;
  playerKills = 0;
  playerDeaths = 0;
  playerDamage = 0;
  lossStreakAlpha = 0;
  lossStreakBravo = 0;

  /** C4 state: carried by a T bot, dropped on death, or planted on a site. */
  bombState: 'carried' | 'dropped' | 'planted' | 'stowed' = 'stowed';
  bombCarrier: CSBot | null = null;
  bombPos = new THREE.Vector3();
  plantedSite: 'A' | 'B' | null = null;
  private bombMesh!: THREE.Group;
  private bombLight!: THREE.Mesh;
  private bombBeepT = 0;
  private plannedSite: 'A' | 'B' = 'A';

  smokes: Smoke[] = [];
  fires: Fire[] = [];

  rosterVersion = 0;
  private opts: CSManagerOptions;
  private scene: THREE.Scene;
  private tick = 0;
  private matchStart = performance.now();
  /** Stable per-bot slot: pick hold spots and lanes without reshuffling each round. */
  private slots = new WeakMap<CSBot, number>();

  constructor(opts: CSManagerOptions) {
    this.opts = opts;
    this.scene = opts.scene;
    // 1 m cells: the 3 m mid-door gap and 5 m tunnels stay navigable.
    this.nav = new NavGrid(opts.world.solids, opts.world.half, opts.world.groundHeight, 1);
    let slot = 0;
    for (const op of ALPHA_ROSTER) {
      const bot = new CSBot(opts.ctx, this, { name: op.name, team: 'alpha', armor: 0, personality: ROLE_BIAS[op.role] ?? 0.5 });
      this.slots.set(bot, slot++);
      this.scene.add(bot.model.group);
      this.alpha.push(bot);
    }
    for (const op of BRAVO_ROSTER) {
      const bot = new CSBot(opts.ctx, this, { name: op.name, team: 'bravo', armor: 0, personality: ROLE_BIAS[op.role] ?? 0.5 });
      this.slots.set(bot, slot++);
      this.scene.add(bot.model.group);
      this.bravo.push(bot);
    }
    this.bots = [...this.alpha, ...this.bravo];
    this.buildBombMesh();
  }

  /* ==================== HOST INTERFACE (CSBot → manager) ==================== */

  allies(bot: CSBot): readonly CSBot[] { return bot.team === 'alpha' ? this.alpha : this.bravo; }
  hostiles(bot: CSBot): readonly CSBot[] { return bot.team === 'alpha' ? this.bravo : this.alpha; }
  playerIsHostile(team: TeamId): boolean { return team === 'bravo'; }
  frozen(): boolean { return this.phase === 'FREEZE'; }

  dutyFor(bot: CSBot): CSDuty {
    const duty: CSDuty = { action: 'IDLE', target: bot.pos.clone() };
    if (this.phase === 'FREEZE' || this.phase === 'ROUND_END' || this.matchOver) return duty;

    if (this.phase === 'PLANTED') {
      if (bot.team === 'alpha') {
        // Retake: the closest CT channels the defuse, everyone else covers them.
        const defuser = this.pickDefuser();
        if (defuser === bot) {
          duty.action = bot.pos.distanceTo(this.bombPos) < 2.1 ? 'DEFUSE' : 'MOVE';
          duty.target = this.bombPos.clone();
          duty.kit = bot.kit;
        } else {
          duty.action = 'HOLD';
          duty.target = this.coverSpot(this.bombPos, 7 + (this.slots.get(bot) ?? 0) * 2);
          duty.face = this.bombPos.clone();
        }
      } else {
        // Post-plant defense: 10–18 m ring around the C4, eyes on the bomb.
        duty.action = 'HOLD';
        duty.target = this.coverSpot(this.bombPos, 11 + (this.slots.get(bot) ?? 0) * 2.4);
        duty.face = this.bombPos.clone();
      }
      return duty;
    }

    // ---- bomb not planted ----
    if (bot.team === 'bravo') {
      const siteCenter = this.siteCenter(this.plannedSite);
      if (bot.hasBomb) {
        if (this.inSiteBounds(bot.pos, this.plannedSite)) {
          duty.action = 'PLANT';
          duty.target = bot.pos.clone();
        } else {
          duty.action = 'MOVE';
          duty.target = siteCenter.clone();
        }
      } else if (this.bombState === 'dropped') {
        duty.action = 'MOVE';
        duty.target = this.bombPos.clone();
      } else {
        // Escort: shadow the carrier until the site, then take a hold.
        const carrier = this.bombCarrier;
        if (carrier && !carrier.dead && bot.pos.distanceTo(carrier.pos) > 9 && carrier.pos.distanceTo(siteCenter) > 14) {
          duty.action = 'MOVE';
          duty.target = carrier.pos.clone();
        } else {
          duty.action = 'HOLD';
          duty.target = this.holdSpot(bot, this.plannedSite);
          duty.face = siteCenter.clone();
        }
      }
      return duty;
    }

    // CT pre-plant: 2 hold A, 1 holds B, 1 anchors mid (the player is the fifth CT).
    const lane = this.laneFor(bot);
    const hold = lane === 'A' ? SITE_HOLDS.alpha[0] : lane === 'A2' ? SITE_HOLDS.alpha[1]
      : lane === 'B' ? SITE_HOLDS.alpha[3] : SITE_HOLDS.alpha[4];
    duty.action = bot.pos.distanceTo(new THREE.Vector3(hold[0], 0, hold[2])) > 2.0 ? 'MOVE' : 'HOLD';
    duty.target = new THREE.Vector3(hold[0], 0, hold[2]);
    duty.face = new THREE.Vector3(0, 0, 20);
    return duty;
  }

  private pickDefuser(): CSBot | null {
    let best: CSBot | null = null;
    let bestD = Infinity;
    for (const bot of this.alpha) {
      if (bot.dead) continue;
      const d = bot.pos.distanceTo(this.bombPos);
      if (d < bestD) { bestD = d; best = bot; }
    }
    return bestD < 30 ? best : null;
  }

  private laneFor(bot: CSBot): 'A' | 'A2' | 'B' | 'MID' {
    const slot = this.slots.get(bot) ?? 0;
    return slot === 0 ? 'A' : slot === 1 ? 'A2' : slot === 2 ? 'B' : 'MID';
  }

  private holdSpot(bot: CSBot, site: 'A' | 'B'): THREE.Vector3 {
    const slot = (this.slots.get(bot) ?? 0) % 2;
    const holds = site === 'A' ? SITE_HOLDS.bravo[0] : SITE_HOLDS.bravo[2];
    const alt = site === 'A' ? SITE_HOLDS.bravo[1] : SITE_HOLDS.bravo[3];
    const h = slot === 0 ? holds : alt;
    return new THREE.Vector3(h[0], 0, h[2]);
  }

  /** A free nav cell roughly `dist` metres from `at` — defense rings and cover spots. */
  private coverSpot(at: THREE.Vector3, dist: number): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const p = new THREE.Vector3(at.x + Math.cos(a) * dist, 0, at.z + Math.sin(a) * dist);
    const [cx, cz] = this.nav.nearestFree(this.nav.toCell(p.x), this.nav.toCell(p.z));
    return new THREE.Vector3(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
  }

  siteCenter(site: 'A' | 'B'): THREE.Vector3 {
    const s = DUSTYARD_SITES.find(d => d.name === site) ?? DUSTYARD_SITES[0];
    return new THREE.Vector3(s.x, 0, s.z);
  }

  inSiteBounds(p: THREE.Vector3, site: 'A' | 'B' | null): boolean {
    const s = DUSTYARD_SITES.find(d => d.name === site);
    if (!s) return false;
    const b = s.bounds;
    return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  }

  siteAt(p: THREE.Vector3): 'A' | 'B' | null {
    for (const s of DUSTYARD_SITES) if (this.inSiteBounds(p, s.name)) return s.name;
    return null;
  }

  /* ==================== KILLS & ECONOMY ==================== */

  onBotKill(victim: CSBot, killer: CSBot | 'PLAYER' | 'WORLD', headshot: boolean) {
    this.rosterVersion++;
    if (victim.hasBomb) this.dropBomb(victim.pos.clone());
    // PLAYER kills are paid by the engine (it knows the real weapon class);
    // bots pay themselves by their carried gun's class.
    if (killer instanceof CSBot) {
      killer.money = clampMoney(killer.money + killReward(killer.weaponClass));
    }
    const killerName = killer === 'PLAYER' ? 'YOU' : killer instanceof CSBot ? killer.name : 'C4';
    this.opts.onFeed(`${killerName} ▸ ${victim.name}`, headshot, killer === 'PLAYER');
    this.checkElimination();
  }

  /** The engine credits the player's gun by its real weapon class. */
  playerKill(weaponClass: CSWeaponClass, victim?: CSBot) {
    this.playerKills++;
    this.payPlayer(killReward(weaponClass), 'kill');
    if (victim) this.rosterVersion++;
    this.checkElimination();
  }

  /** The player went down — no respawn in TACTICAL, the round plays out. */
  playerDied(killer: CSBot | null) {
    if (this.playerDead || this.phase === 'ROUND_END') return;
    this.playerDead = true;
    this.playerDeaths++;
    this.playerArmor = 0;          // plating dies with you
    this.playerKit = false;
    this.rosterVersion++;
    if (killer) killer.money = clampMoney(killer.money + killReward(killer.weaponClass));
    this.opts.onFeed(`${killer ? killer.name : 'C4'} ▸ YOU`, false, false);
    this.checkElimination();
  }

  private payPlayer(amount: number, reason: string) {
    this.playerMoney = clampMoney(this.playerMoney + amount);
    this.opts.onMoney(amount, reason);
  }

  private aliveCount(team: TeamId): number {
    const bots = team === 'alpha' ? this.alpha : this.bravo;
    let n = bots.filter(b => !b.dead).length;
    if (team === 'alpha' && !this.playerDead) n++;
    return n;
  }

  private checkElimination() {
    if (this.phase === 'ROUND_END' || this.matchOver || this.phase === 'FREEZE') return;
    if (this.aliveCount('alpha') === 0) this.endRound('bravo', 'ELIMINATION');
    else if (this.aliveCount('bravo') === 0) this.endRound('alpha', 'ELIMINATION');
  }

  /* ==================== EXPLOSIONS (frags / flashes from the engine) ==================== */

  applyExplosion(at: THREE.Vector3, kind: 'frag' | 'flash', team: TeamId, byPlayer = false): { kills: CSBot[] } {
    const kills: CSBot[] = [];
    for (const bot of this.bots) {
      if (bot.dead || bot.team === team) continue;
      const d = bot.pos.distanceTo(at);
      if (kind === 'flash') {
        if (d < 12) bot.applyStun(3.2);
        continue;
      }
      if (d > TDM_FRAG_RADIUS) continue;
      if (bot.takeDamage(tdmFragDamage(d) * blastArmorMul(bot.armor), false, byPlayer ? 'PLAYER' : 'WORLD')) kills.push(bot);
    }
    this.rosterVersion++;
    return { kills };
  }

  notifyGunshot(pos: THREE.Vector3, radius: number, team: TeamId) {
    for (const bot of this.bots) {
      if (bot.dead || bot.team === team) continue;
      bot.hear(pos, radius);
    }
  }

  /* ==================== SMOKE & FIRE ==================== */

  detonateSmoke(at: THREE.Vector3) {
    const group = new THREE.Group();
    const mat = new THREE.SpriteMaterial({
      map: smokeTexture(), color: 0xB8B4AC, transparent: true, opacity: 0.92, depthWrite: false,
    });
    const y = this.opts.world.groundHeight(at.x, at.z);
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(mat);
      const a = (i / 12) * Math.PI * 2, r = i < 4 ? 0.8 : 2.6 + Math.random() * 1.8;
      s.position.set(at.x + Math.cos(a) * r, y + 1.4 + (i % 3) * 1.1, at.z + Math.sin(a) * r);
      s.scale.setScalar(5.5 + Math.random() * 3);
      group.add(s);
    }
    this.scene.add(group);
    this.smokes.push({ x: at.x, y: y + 1.8, z: at.z, r: 5.2, t: 18, group });
  }

  detonateFire(at: THREE.Vector3, team: TeamId) {
    const group = new THREE.Group();
    const y = this.opts.world.groundHeight(at.x, at.z);
    const mat = new THREE.SpriteMaterial({ map: fireTexture(), color: 0xFF8A2A, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(mat);
      const a = (i / 10) * Math.PI * 2, r = 0.8 + Math.random() * 2.4;
      s.position.set(at.x + Math.cos(a) * r, y + 0.7 + Math.random() * 0.8, at.z + Math.sin(a) * r);
      s.scale.set(2.4 + Math.random() * 1.4, 2.2 + Math.random(), 1);
      group.add(s);
    }
    const light = new THREE.PointLight(0xFF7A20, 30, 16, 1.6);
    light.position.set(at.x, y + 1.2, at.z);
    group.add(light);
    this.scene.add(group);
    this.fires.push({ x: at.x, y, z: at.z, r: 4.2, t: 7, group, light });
    // Fire hurts whoever stands in it — both sides, the thrower's team excluded from blame.
    void team;
  }

  private tickZones(dt: number) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt;
      const fade = s.t < 3 ? s.t / 3 : 1;
      for (const child of s.group.children) {
        const m = (child as THREE.Sprite).material as THREE.SpriteMaterial;
        if (m.opacity !== undefined) (child as THREE.Sprite).material.opacity = 0.92 * fade;
      }
      if (s.t <= 0) { this.scene.remove(s.group); this.smokes.splice(i, 1); }
    }
    let playerInFire = false;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      f.light.intensity = 24 + Math.sin(performance.now() / 60 + i) * 8;
      if (f.t <= 0) {
        this.scene.remove(f.group);
        f.light.dispose();
        this.fires.splice(i, 1);
        continue;
      }
      this.fireTick -= dt;
      if (this.fireTick <= 0) {
        this.fireTick = 0.5;
        for (const bot of this.bots) {
          if (!bot.dead && Math.hypot(bot.pos.x - f.x, bot.pos.z - f.z) < f.r) bot.takeDamage(12, false, 'WORLD');
        }
        if (!this.playerDead && this.playerAliveCallback?.() && Math.hypot(this.playerPosCallback().x - f.x, this.playerPosCallback().z - f.z) < f.r) {
          this.playerFireDamageCallback?.(12, new THREE.Vector3(f.x, f.y, f.z));
          playerInFire = true;
        }
      }
    }
    void playerInFire;
  }
  private fireTick = 0;
  /** Wired by the engine: player position / liveness / fire damage plumbing. */
  playerPosCallback: () => THREE.Vector3 = () => new THREE.Vector3();
  playerAliveCallback: () => boolean = () => false;
  playerFireDamageCallback: (amount: number, from: THREE.Vector3) => void = () => {};

  /* ==================== BOMB ==================== */

  private buildBombMesh() {
    this.bombMesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.16, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2A2C28, roughness: 0.5, metalness: 0.4 }),
    );
    body.position.y = 0.08;
    body.castShadow = true;
    this.bombLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xFF2020, emissive: 0xFF2020, emissiveIntensity: 2.4 }),
    );
    this.bombLight.position.set(0.1, 0.2, 0);
    this.bombMesh.add(body, this.bombLight);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
  }

  private giveBomb(bot: CSBot) {
    this.bombState = 'carried';
    this.bombCarrier = bot;
    bot.hasBomb = true;
    this.bombMesh.visible = false;
  }

  private dropBomb(at: THREE.Vector3) {
    if (this.bombCarrier) this.bombCarrier.hasBomb = false;
    this.bombCarrier = null;
    this.bombState = 'dropped';
    this.bombPos.copy(at);
    this.bombPos.y = this.opts.world.groundHeight(at.x, at.z);
    this.bombMesh.position.copy(this.bombPos);
    this.bombMesh.visible = true;
    this.opts.onFeed('The C4 was dropped!', false, false);
  }

  /** T bots scoop the dropped C4 just by walking over it. */
  private tryBotPickup() {
    if (this.bombState !== 'dropped') return;
    for (const bot of this.bravo) {
      if (bot.dead) continue;
      if (bot.pos.distanceTo(this.bombPos) < 1.8) {
        this.giveBomb(bot);
        this.opts.onFeed(`${bot.name} picked up the C4`, false, false);
        return;
      }
    }
  }

  onBombPlanted(planter: CSBot, at: THREE.Vector3) {
    this.phase = 'PLANTED';
    this.bombLeft = CS_BOMB_SECONDS;
    this.bombBeepT = 0.4;
    this.bombState = 'planted';
    this.bombCarrier = planter;
    this.bombPos.copy(at);
    this.bombPos.y = this.opts.world.groundHeight(at.x, at.z);
    this.bombMesh.position.copy(this.bombPos);
    this.bombMesh.visible = true;
    this.plantedSite = this.siteAt(at) ?? this.plannedSite;
    planter.money = clampMoney(planter.money + CS_PLANT_BONUS);
    this.opts.onFeed(`${planter.name} planted the C4 (${this.plantedSite})`, false, false);
    this.opts.onBombPlanted(this.bombPos.clone(), this.plantedSite);
    this.rosterVersion++;
  }

  /** The human planter path (only reachable if a future mode hands YOU the C4). */
  playerPlant(at: THREE.Vector3) {
    this.phase = 'PLANTED';
    this.bombLeft = CS_BOMB_SECONDS;
    this.bombBeepT = 0.4;
    this.bombState = 'planted';
    this.bombPos.copy(at);
    this.plantedSite = this.siteAt(at);
    this.payPlayer(CS_PLANT_BONUS, 'plant');
    this.opts.onFeed('YOU planted the C4', false, true);
    this.opts.onBombPlanted(this.bombPos.clone(), this.plantedSite ?? 'A');
  }

  onBombDefused(defuser: CSBot | 'PLAYER') {
    if (defuser === 'PLAYER') {
      this.payPlayer(CS_DEFUSE_BONUS, 'defuse');
      this.opts.onFeed('YOU defused the bomb', false, true);
    } else {
      defuser.money = clampMoney(defuser.money + CS_DEFUSE_BONUS);
      this.opts.onFeed(`${defuser.name} defused the bomb`, false, false);
    }
    this.opts.onBombDefused(defuser === 'PLAYER' ? null : defuser);
    this.endRound('alpha', 'BOMB_DEFUSED');
  }

  private explodeBomb() {
    this.opts.onBombExploded(this.bombPos.clone());
    // The blast itself is the last word: anyone left standing nearby goes with it.
    if (!this.playerDead && this.playerAliveCallback?.()) {
      const d = this.playerPosCallback().distanceTo(this.bombPos);
      if (d <= 12) this.playerKillCallback?.(999, this.bombPos);
      else if (d <= 18) this.playerFireDamageCallback?.(150, this.bombPos);
    }
    this.endRound('bravo', 'BOMB_EXPLODED');
  }
  /** Wired by the engine for the lethal-radius check. */
  playerKillCallback: (amount: number, from: THREE.Vector3) => void = () => {};

  /* ==================== BUY ZONE ==================== */

  inBuyZone(x: number, z: number, team: TeamId = 'alpha'): boolean {
    const zone = CS_BUY_ZONES[team];
    return Math.hypot(x - zone.x, z - zone.z) <= zone.r;
  }

  get canBuyNow(): boolean {
    return this.phase === 'FREEZE' && !this.matchOver;
  }

  /** Commit a purchase cart: validated, charged, returns the spent total (or null). */
  chargePlayer(cost: number): boolean {
    if (!this.canBuyNow) return false;
    if (cost > this.playerMoney) return false;
    this.payPlayer(-cost, 'buy');
    return true;
  }

  /* ==================== ROUND LIFECYCLE ==================== */

  startMatch() {
    this.matchStart = performance.now();
    this.startRound();
  }

  private getSpawn(team: TeamId, index: number): THREE.Vector3 {
    // Half-time (round 9 on): the sides physically swap ends, wallets stay put.
    const side: TeamId = this.halftime ? (team === 'alpha' ? 'bravo' : 'alpha') : team;
    const points = CS_SPAWNS[side];
    const base = points[index % points.length];
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 2;
    return new THREE.Vector3(base[0] + Math.cos(angle) * radius, 0, base[2] + Math.sin(angle) * radius);
  }

  startRound() {
    this.roundResult = null;
    this.phase = 'FREEZE';
    this.freezeLeft = CS_FREEZE_SECONDS;
    this.roundLeft = CS_ROUND_SECONDS;
    this.bombLeft = CS_BOMB_SECONDS;
    this.plantedSite = null;
    this.plannedSite = Math.random() < 0.5 ? 'A' : 'B';
    this.bombState = 'stowed';
    this.bombCarrier = null;
    this.bombMesh.visible = false;
    for (const s of this.smokes) this.scene.remove(s.group);
    for (const f of this.fires) { this.scene.remove(f.group); f.light.dispose(); }
    this.smokes = []; this.fires = [];

    if (this.round > CS_HALF_ROUNDS && !this.halftime) {
      this.halftime = true;
      this.opts.onFeed('HALFTIME — sides swap spawns', false, false);
    }

    // Bots buy on their own wallets, re-armor, and redeploy.
    let i = 0;
    for (const bot of this.bots) {
      const team = bot.team;
      const plan = botBuyPlan(bot.money, team);
      bot.money = clampMoney(bot.money - plan.spent);
      bot.armor = plan.armor;
      bot.kit = plan.kit;
      bot.weaponClass = plan.primary ? gunClassOf(plan.primary) : 'pistol';
      bot.hasBomb = false;
      bot.channelT = 0;
      const index = this.slots.get(bot) ?? i;
      bot.deploy(this.getSpawn(team, index), Math.atan2(-bot.pos.x, -bot.pos.z + 0.001));
      i++;
    }
    // The C4 goes to a random live BRAVO — the player is ALPHA, so it is always a bot.
    const carrier = this.bravo[(Math.random() * this.bravo.length) | 0];
    this.giveBomb(carrier);

    // The human round reset (spawn, HP, kept-or-lost gear) is the engine's job.
    const spawn = this.getSpawn('alpha', 4);
    this.opts.onRoundStart(spawn, Math.atan2(-spawn.x, -spawn.z + 0.001));
    this.opts.onPhase(this.phase);
    this.rosterVersion++;
  }

  private endRound(winner: TeamId, reason: CSWinReason) {
    if (this.phase === 'ROUND_END' || this.matchOver) return;
    this.phase = 'ROUND_END';
    this.endLeft = CS_ROUND_END_SECONDS;
    this.roundResult = { winner, reason };
    if (winner === 'alpha') this.alphaRounds++; else this.bravoRounds++;
    this.roundHistory.push({ alpha: this.alphaRounds, bravo: this.bravoRounds });

    // ---- the payout ----
    const bombWin = reason === 'BOMB_EXPLODED' && winner === 'bravo';
    const loser: TeamId = winner === 'alpha' ? 'bravo' : 'alpha';
    const loserStreak = loser === 'alpha' ? this.lossStreakAlpha : this.lossStreakBravo;
    const winPay = roundPayout(true, 0, bombWin);
    const lossPay = roundPayout(false, loserStreak, false);
    for (const bot of this.bots) {
      bot.money = clampMoney(bot.money + (bot.team === winner ? winPay : lossPay));
    }
    if (winner === 'alpha') {
      this.payPlayer(winPay, 'round');
      this.lossStreakAlpha = 0;
      this.lossStreakBravo++;
    } else {
      this.payPlayer(lossPay, 'loss');
      this.lossStreakBravo = 0;
      this.lossStreakAlpha++;
    }

    this.matchOver = this.alphaRounds >= CS_WIN_ROUNDS || this.bravoRounds >= CS_WIN_ROUNDS
      || this.round >= CS_MAX_ROUNDS;
    this.opts.onRoundEnd(winner, reason);
    this.opts.onPhase(this.phase);
    this.rosterVersion++;
  }

  /** Final scoreboard: per-player rows with an MVP star on the top fragger. */
  report(): CsReport {
    const rows: CSScoreRow[] = [];
    let topKills = -1;
    const candidates: { row: CSScoreRow }[] = [];
    for (const bot of this.alpha) {
      const row: CSScoreRow = { name: bot.name, team: 'alpha', kills: bot.kills, deaths: bot.deaths, damage: Math.round(bot.damageDealt), alive: !bot.dead, armor: bot.armor, money: bot.money, you: false, mvp: false };
      rows.push(row); candidates.push({ row });
      topKills = Math.max(topKills, bot.kills);
    }
    const playerRow: CSScoreRow = {
      name: 'YOU', team: 'alpha', kills: this.playerKills, deaths: this.playerDeaths,
      damage: Math.round(this.playerDamage), alive: !this.playerDead, armor: this.playerArmor,
      money: this.playerMoney, you: true, mvp: false,
    };
    rows.push(playerRow); candidates.push({ row: playerRow });
    topKills = Math.max(topKills, this.playerKills);
    for (const bot of this.bravo) {
      const row: CSScoreRow = { name: bot.name, team: 'bravo', kills: bot.kills, deaths: bot.deaths, damage: Math.round(bot.damageDealt), alive: !bot.dead, armor: bot.armor, money: bot.money, you: false, mvp: false };
      rows.push(row); candidates.push({ row });
      topKills = Math.max(topKills, bot.kills);
    }
    // MVP star: top fragger, ties broken by damage.
    let mvp: CSScoreRow | null = null;
    for (const { row } of candidates) {
      if (row.kills !== topKills) continue;
      if (!mvp || row.damage > mvp.damage) mvp = row;
    }
    if (mvp) mvp.mvp = true;
    const winner: TeamId | 'draw' = this.alphaRounds === this.bravoRounds ? 'draw' : this.alphaRounds > this.bravoRounds ? 'alpha' : 'bravo';
    const totalRounds = Math.max(1, this.roundHistory.length);
    return {
      alphaRounds: this.alphaRounds, bravoRounds: this.bravoRounds, winner,
      rounds: this.roundHistory, rows,
      playerKills: this.playerKills, playerDeaths: this.playerDeaths, playerDamage: Math.round(this.playerDamage),
      adr: Math.round(this.playerDamage / totalRounds),
      duration: (performance.now() - this.matchStart) / 1000,
    };
  }

  /* ==================== TICK ==================== */

  update(dt: number) {
    this.tick++;
    this.tickZones(dt);

    switch (this.phase) {
      case 'FREEZE': {
        this.freezeLeft = Math.max(0, this.freezeLeft - dt);
        for (const bot of this.bots) bot.updateVisualFrame(dt);
        if (this.freezeLeft <= 0) {
          this.phase = 'LIVE';
          this.opts.onPhase(this.phase);
        }
        break;
      }
      case 'LIVE': {
        this.roundLeft = Math.max(0, this.roundLeft - dt);
        this.tickBots(dt);
        this.tryBotPickup();
        if (this.phase === 'LIVE' && this.roundLeft <= 0) this.endRound('alpha', 'TIME');
        break;
      }
      case 'PLANTED': {
        this.bombLeft = Math.max(0, this.bombLeft - dt);
        this.tickBots(dt);
        this.tickBombBeep(dt);
        (this.bombLight.material as THREE.MeshStandardMaterial).emissiveIntensity = (Math.sin(performance.now() / 90) > 0 ? 3 : 0.4);
        if (this.phase === 'PLANTED' && this.bombLeft <= 0) this.explodeBomb();
        break;
      }
      case 'ROUND_END': {
        this.endLeft = Math.max(0, this.endLeft - dt);
        for (const bot of this.bots) bot.updateVisualFrame(dt);
        if (this.endLeft <= 0) {
          if (this.matchOver) { this.opts.onMatchEnd(); this.phase = 'ROUND_END'; this.endLeft = 999; }
          else { this.round++; this.startRound(); }
        }
        break;
      }
    }
  }

  private tickBots(dt: number) {
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      bot.updateVisualFrame(dt);
      if (bot.dead) { bot.update(dt); continue; }
      // Staggered brains: logic every third frame with tripled dt (TDM's proven split).
      if ((i + this.tick) % 3 === 0) bot.update(dt * 3);
    }
  }

  /** C4 beep schedule: 1 s for the first 20 s, 0.5 s to 35 s, then 0.25 s. */
  private tickBombBeep(dt: number) {
    this.bombBeepT -= dt;
    if (this.bombBeepT > 0) return;
    const elapsed = CS_BOMB_SECONDS - this.bombLeft;
    this.bombBeepT = elapsed < 20 ? 1 : elapsed < 35 ? 0.5 : 0.25;
    this.opts.onBombBeep(this.bombPos.clone());
  }

  /* ==================== PLAYER HELPERS ==================== */

  get spawnYaw(): number { return Math.atan2(-this.bombPos.x, -this.bombPos.z); }

  /** CT defuse channel for the human. Returns progress seconds (0 = rejected). */
  playerDefuseTick(dt: number, playerPos: THREE.Vector3): { ok: boolean; t: number; total: number } {
    if (this.phase !== 'PLANTED' || this.playerDead) return { ok: false, t: 0, total: this.playerKit ? 5 : 10 };
    if (playerPos.distanceTo(this.bombPos) > 2.2) return { ok: false, t: 0, total: this.playerKit ? 5 : 10 };
    this.playerDefuseT += dt;
    const total = this.playerKit ? 5 : 10;
    return { ok: true, t: this.playerDefuseT, total };
  }
  playerDefuseT = 0;
  resetPlayerDefuse() { this.playerDefuseT = 0; }
  /** Fires when the human's defuse channel completes. */
  get playerDefuseComplete(): boolean {
    const total = this.playerKit ? 5 : 10;
    return this.playerDefuseT >= total;
  }

  canPlayerDefuse(playerPos: THREE.Vector3): boolean {
    return this.phase === 'PLANTED' && !this.playerDead && playerPos.distanceTo(this.bombPos) <= 2.2;
  }

  canPlayerPickup(_playerPos: THREE.Vector3): boolean {
    // The player is ALPHA (CT) — CTs cannot touch the C4. Kept for future modes.
    return false;
  }

  /* ==================== HUD ==================== */

  /** Shootable meshes for the engine's raycasts: living bots' hit boxes only. */
  getHittables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const bot of this.bots) {
      if (bot.dead) continue;
      out.push(...bot.model.hitMeshes);
    }
    return out;
  }

  private rows(team: TeamId): CSPlayerRow[] {
    return (team === 'alpha' ? this.alpha : this.bravo).map(b => ({
      name: b.name, armor: b.armor, kills: b.kills, deaths: b.deaths, money: b.money,
      alive: !b.dead, hasBomb: b.hasBomb, damage: Math.round(b.damageDealt), you: false,
    }));
  }

  hud(playerPos: { x: number; z: number }): CsHudState {
    const H = 72; // DUSTYARD_HALF — kept literal so the HUD never imports the world
    const bombVisible = this.bombState === 'planted' || this.bombState === 'dropped';
    return {
      phase: this.phase,
      alphaRounds: this.alphaRounds, bravoRounds: this.bravoRounds,
      round: this.round, maxRounds: CS_MAX_ROUNDS,
      timeLeft: this.phase === 'FREEZE' ? this.freezeLeft : this.phase === 'PLANTED' ? this.bombLeft : this.phase === 'ROUND_END' ? this.endLeft : this.roundLeft,
      roundTimeLeft: this.roundLeft,
      freezeLeft: this.freezeLeft,
      bombTimeLeft: this.bombLeft,
      planted: this.phase === 'PLANTED',
      site: this.plantedSite,
      playerMoney: this.playerMoney, playerArmor: this.playerArmor, playerKit: this.playerKit,
      playerAlive: !this.playerDead,
      lossStreakAlpha: this.lossStreakAlpha, lossStreakBravo: this.lossStreakBravo,
      nextLossBonus: lossBonus(Math.max(this.lossStreakAlpha, 0)),
      aliveAlpha: this.aliveCount('alpha'), aliveBravo: this.aliveCount('bravo'),
      roundResult: this.roundResult,
      matchOver: this.matchOver,
      halftime: this.halftime,
      canBuy: this.canBuyNow,
      inBuyZone: this.inBuyZone(playerPos.x, playerPos.z, 'alpha'),
      bombNx: (this.bombPos.x + H) / (2 * H), bombNz: (this.bombPos.z + H) / (2 * H),
      bombVisible,
      alpha: [
        { name: 'YOU', armor: this.playerArmor, kills: this.playerKills, deaths: this.playerDeaths, money: this.playerMoney, alive: !this.playerDead, hasBomb: false, damage: Math.round(this.playerDamage), you: true },
        ...this.rows('alpha'),
      ],
      bravo: this.rows('bravo'),
      rosterVersion: this.rosterVersion,
    };
  }

  dispose() {
    for (const bot of this.bots) {
      bot.model.group.removeFromParent();
      bot.model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.bots = []; this.alpha = []; this.bravo = [];
    for (const s of this.smokes) this.scene.remove(s.group);
    for (const f of this.fires) this.scene.remove(f.group);
    this.smokes = []; this.fires = [];
    this.bombMesh.removeFromParent();
    this.bombMesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}

function gunClassOf(id: CSWeaponId): CSWeaponClass {
  return gunById(id).cls;
}

/* ==================== canvas textures for smoke / fire sprites ==================== */
let smokeTex: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(235,232,225,0.95)');
  g.addColorStop(0.55, 'rgba(210,206,198,0.65)');
  g.addColorStop(1, 'rgba(200,196,188,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}
let fireTex: THREE.Texture | null = null;
function fireTexture(): THREE.Texture {
  if (fireTex) return fireTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 74, 4, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,240,180,1)');
  g.addColorStop(0.4, 'rgba(255,140,40,0.85)');
  g.addColorStop(1, 'rgba(255,80,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  fireTex = new THREE.CanvasTexture(c);
  return fireTex;
}
