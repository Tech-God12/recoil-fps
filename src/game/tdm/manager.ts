// Recoil FPS — Warehouse TDM manager: 5v5 roster, match clock, scoring, respawns.
//
// Owns all ten combatants (the player is ALPHA's fifth slot and lives in the
// Engine), the two score totals, the 2:30 clock and the ten-second respawn cycle.
// Everything the HUD and the radar need is exposed through `hud()`; everything the
// renderer needs through `getHittables()`.
import * as THREE from 'three';
import { NavGrid } from '../ai';
import type { AABB, World } from '../world';
import { TDMBot, type TdmBotCtx, type TdmHost } from './bot';
import {
  ALPHA_ROSTER, BRAVO_ROSTER, TDM_FRAG_RADIUS, TDM_MATCH_SECONDS, TDM_RESPAWN_SECONDS, TDM_TEAM_SIZE,
  armorOf, blastArmorMul, tdmFragDamage, type ArmorLevel, type TdmOperative, type TeamId,
} from './armor';
import { TDM_PERCHES, TDM_SPAWNS } from './arena';

export interface TdmManagerOptions {
  world: World;
  ctx: TdmBotCtx;
  /**
   * The scene the match is rendered from. Required, not optional: a bot whose model
   * group is never parented still passes every raycast (three refreshes matrices
   * inside Mesh.raycast) while drawing absolutely nothing — invisible enemies.
   */
  scene: THREE.Scene;
  /** Push text into the HUD kill feed. */
  onFeed(text: string, headshot: boolean, mine: boolean): void;
  /** Fired whenever the score changes so the engine can refresh derived state. */
  onScore(team: TeamId): void;
}

export interface TdmRosterRow {
  name: string;
  armor: ArmorLevel;
  icon: string;
  dead: boolean;
  kills: number;
  state: string;
  perch: boolean;
}

export interface TdmHudState {
  alphaScore: number;
  bravoScore: number;
  timeLeft: number;
  /** Total match length, so the HUD can time its opening hints off the clock. */
  duration: number;
  matchOver: boolean;
  playerKills: number;
  playerDeaths: number;
  /** Seconds until the player is back on the yard (0 while alive). */
  respawnIn: number;
  alpha: TdmRosterRow[];
  bravo: TdmRosterRow[];
  rosterVersion: number;
}

/** Personality bias per roster role — the perk, the runner, the anchor. */
const ROLE_BIAS: Record<string, number> = {
  Assault: 0.72, Breacher: 0.6, Overwatch: 0.34, Runner: 0.68, Flanker: 0.5,
};

export class TDMManager implements TdmHost {
  bots: TDMBot[] = [];
  alpha: TDMBot[] = [];
  bravo: TDMBot[] = [];
  alphaScore = 0;
  bravoScore = 0;
  timeLeft = TDM_MATCH_SECONDS;
  matchOver = false;
  rosterVersion = 0;
  nav: NavGrid;
  /** The player's own armor, mirrored here so bot damage maths stays in one place. */
  playerArmor: ArmorLevel = 0;

  private ctx: TdmBotCtx;
  private opts: TdmManagerOptions;
  private solids: AABB[];
  private playerKills = 0;
  private pendingFragTeam: TeamId | null = null;
  private pendingFragPlayer = false;
  private playerDeaths = 0;
  private respawnIn = 0;
  private started = false;

  constructor(opts: TdmManagerOptions) {
    this.opts = opts;
    this.ctx = opts.ctx;
    this.solids = opts.world.solids;
    // 1 m cells: the arena's 3.2 m warehouse doors and 4 m corridor stay navigable.
    this.nav = new NavGrid(opts.world.solids, opts.world.half, opts.world.groundHeight, 1);
    const home = new THREE.Vector3(0, 0, 0);
    for (const operative of ALPHA_ROSTER) this.alpha.push(this.makeBot(operative, 'alpha', home));
    for (const operative of BRAVO_ROSTER) this.bravo.push(this.makeBot(operative, 'bravo', home));
    this.bots = [...this.alpha, ...this.bravo];
  }

  private makeBot(operative: TdmOperative, team: TeamId, _home: THREE.Vector3): TDMBot {
    // Overwatch anchors hold a perch; everyone else roams. The perk is part of the
    // roster so both teams always field exactly one elevated shooter.
    const perchEntry = TDM_PERCHES.find(p => p.team === team && operative.role === 'Overwatch');
    const jitter = (Math.random() - 0.5) * 0.35;
    const personality = Math.min(0.95, Math.max(0.05, (ROLE_BIAS[operative.role] ?? 0.5) + jitter));
    const bot = new TDMBot(this.ctx, this, {
      name: operative.name, team, armor: operative.armor, personality,
      perch: perchEntry ? new THREE.Vector3(...perchEntry.at) : undefined,
    });
    this.opts.scene.add(bot.model.group);
    return bot;
  }

  /* ==================== HOST INTERFACE ==================== */

  allies(bot: TDMBot): readonly TDMBot[] { return bot.team === 'alpha' ? this.alpha : this.bravo; }
  hostiles(bot: TDMBot): readonly TDMBot[] { return bot.team === 'alpha' ? this.bravo : this.alpha; }
  playerIsHostile(team: TeamId): boolean { return team === 'bravo'; }

  killed(victim: TDMBot, killer: TDMBot | 'YOU' | 'FRAG', headshot: boolean, fragTeam?: TeamId) {
    if (killer === 'FRAG') {
      // The engine resolves the thrower for an explosive kill; without attribution
      // the score goes to the side that is not the victim.
      const credited = fragTeam ?? this.pendingFragTeam ?? victim.opposing;
      this.scoreFor(credited);
      // A player frag is already announced by the engine's own kill event.
      if (!this.pendingFragPlayer) this.opts.onFeed(`${credited === 'alpha' ? 'ALPHA' : 'BRAVO'}  [FRAG]  ${victim.name}`, headshot, false);
      this.rosterVersion++;
      return;
    }
    const killerName = killer === 'YOU' ? 'YOU' : killer.name;
    this.scoreFor(killer === 'YOU' ? 'alpha' : killer.team);
    this.playerKills += killer === 'YOU' ? 1 : 0;
    this.opts.onFeed(`${killerName} ▸ ${victim.name}`, headshot, killer === 'YOU');
    this.rosterVersion++;
  }

  scoreFor(team: TeamId) {
    if (team === 'alpha') this.alphaScore++; else this.bravoScore++;
    this.opts.onScore(team);
    this.rosterVersion++;
  }

  /** A player elimination credited from the engine's own weapons (never double). */
  playerKill() {
    this.playerKills++;
    this.scoreFor('alpha');
  }

  playerDown() {
    this.playerDeaths++;
    this.respawnIn = TDM_RESPAWN_SECONDS;
  }

  playerRespawned() {
    this.respawnIn = 0;
    this.rosterVersion++;
  }

  /** Countdown owned by the engine; the manager only stores the number. */
  tickPlayerRespawn(dt: number): boolean {
    if (this.respawnIn <= 0) return false;
    this.respawnIn = Math.max(0, this.respawnIn - dt);
    return this.respawnIn <= 0;
  }

  /* ==================== MATCH LIFECYCLE ==================== */

  /** Deploy every bot at its team spawn (called once, on match start). */
  start() {
    if (this.started) return;
    this.started = true;
    for (const bot of this.alpha) this.spawnBot(bot);
    for (const bot of this.bravo) this.spawnBot(bot);
    this.rosterVersion++;
  }

  private spawnBot(bot: TDMBot) {
    if (bot.perch) {
      // Overwatch redeploys straight onto its platform and looks into the yard.
      bot.deploy(bot.perch, this.faceYard(bot.perch));
      return;
    }
    const spawn = this.getSpawn(bot.team, bot);
    bot.deploy(spawn, this.faceYard(spawn));
  }

  private faceYard(from: THREE.Vector3): number {
    return Math.atan2(-from.x, -from.z);        // face the middle of the map
  }

  /**
   * Team spawn with the spec's random ±2–4 m offset. Offsets are validated against
   * the NavGrid and against living hostiles: you never respawn inside a wall, and
   * you never respawn in someone's crosshair.
   */
  getSpawn(team: TeamId, forBot?: TDMBot): THREE.Vector3 {
    const points = TDM_SPAWNS[team];
    const enemies = team === 'alpha' ? this.bravo : this.alpha;
    let best: THREE.Vector3 | null = null;
    let bestClearance = -Infinity;
    const candidates = 10;
    for (let i = 0; i < candidates; i++) {
      const base = points[i % points.length];
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * 2;                     // ±2–4 m
      const x = base[0] + Math.cos(angle) * radius;
      const z = base[2] + Math.sin(angle) * radius;
      if (!this.nav.free(this.nav.toCell(x), this.nav.toCell(z))) continue;
      if (this.solids.some(b => b.maxY > 0.6 && b.minY < 1.7 && x > b.minX - 0.45 && x < b.maxX + 0.45 && z > b.minZ - 0.45 && z < b.maxZ + 0.45)) continue;
      let clearance = Infinity;
      for (const e of enemies) if (!e.dead) clearance = Math.min(clearance, Math.hypot(e.pos.x - x, e.pos.z - z));
      for (const a of (team === 'alpha' ? this.alpha : this.bravo)) {
        if (a === forBot || a.dead) continue;
        clearance = Math.min(clearance, a.pos.distanceTo(new THREE.Vector3(x, 0, z)));
      }
      if (clearance > bestClearance) { bestClearance = clearance; best = new THREE.Vector3(x, 0, z); }
      if (clearance > 24) break;
    }
    if (best) return best;
    const fallback = points[(Math.random() * points.length) | 0];
    return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
  }

  /** Match clock, bot respawns, and the per-bot brains. */
  update(dt: number) {
    if (!this.matchOver) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.matchOver = true;
    }
    // Brains are staggered: logic every third frame, visuals every frame.
    this.tick++;
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      bot.updateVisualFrame(dt);
      if (bot.dead) {
        bot.update(dt);
        if (!this.matchOver && bot.deadAge >= TDM_RESPAWN_SECONDS) this.spawnBot(bot);
        continue;
      }
      if ((i + this.tick) % 3 === 0) bot.update(dt * 3);
    }
  }

  private tick = 0;

  /* ==================== DAMAGE PLUMBING ==================== */

  /** Every bot mesh in the raycast set, tagged so the engine can resolve a hit. */
  getHittables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const bot of this.bots) {
      if (bot.dead) continue;
      for (const mesh of bot.model.hitMeshes) {
        mesh.userData.tdmBot = bot;
        out.push(mesh);
      }
    }
    return out;
  }

  /** Nearest living bot to a point, optionally filtered by team. */
  nearestBot(at: THREE.Vector3, team?: TeamId, maxDist = Infinity): TDMBot | null {
    let best: TDMBot | null = null, bestD = maxDist;
    for (const bot of this.bots) {
      if (bot.dead || (team && bot.team !== team)) continue;
      const d = bot.pos.distanceTo(at);
      if (d < bestD) { bestD = d; best = bot; }
    }
    return best;
  }

  /**
   * Explosion resolution for grenades thrown by either side. Frags only hurt the
   * opposing team (the yard would be a team-kill comedy show otherwise), and the
   * flash stuns whoever is looking at it.
   */
  applyExplosion(at: THREE.Vector3, kind: 'frag' | 'flash', team: TeamId, byPlayer = false): { kills: TDMBot[] } {
    const kills: TDMBot[] = [];
    this.pendingFragTeam = team;
    this.pendingFragPlayer = byPlayer;
    try {
    for (const bot of this.bots) {
      if (bot.dead) continue;
      const friendly = bot.team === team;
      if (kind === 'flash') {
        if (bot.pos.distanceTo(at) < 12 && !friendly) bot.applyStun(3.5);
        else if (bot.pos.distanceTo(at) < 9 && friendly) bot.applyStun(1.6);
        continue;
      }
      if (friendly) continue;
      const d = bot.pos.distanceTo(at);
      if (d > TDM_FRAG_RADIUS) continue;
      // Raw blast × the vest's blast resistance, applied here so takeDamage() never
      // double-counts armor on the frag path.
      if (bot.takeDamage(tdmFragDamage(d) * blastArmorMul(bot.armor), false, 'FRAG')) kills.push(bot);
    }
    } finally { this.pendingFragTeam = null; this.pendingFragPlayer = false; }
    return { kills };
  }

  /** Gunfire the bots can hear — the loudest intel on the yard. */
  notifyGunshot(pos: THREE.Vector3, radius: number, team: TeamId) {
    for (const bot of this.bots) {
      if (bot.dead || bot.team === team) continue;
      bot.hear(pos, radius);
    }
  }

  /* ==================== HUD ==================== */

  private rows(team: TeamId): TdmRosterRow[] {
    return (team === 'alpha' ? this.alpha : this.bravo).map(bot => ({
      name: bot.name,
      armor: bot.armor,
      icon: armorOf(bot.armor).icon,
      dead: bot.dead,
      kills: bot.kills,
      state: bot.state,
      perch: !!bot.perch,
    }));
  }

  playerRow(name: string, armor: ArmorLevel, kills: number, dead: boolean): TdmRosterRow {
    return { name, armor, icon: armorOf(armor).icon, dead, kills, state: dead ? 'DEAD' : 'ENGAGE', perch: false };
  }

  hud(playerName: string, playerKills: number, playerDead: boolean): TdmHudState {
    return {
      alphaScore: this.alphaScore,
      bravoScore: this.bravoScore,
      timeLeft: this.timeLeft,
      duration: TDM_MATCH_SECONDS,
      matchOver: this.matchOver,
      playerKills, playerDeaths: this.playerDeaths,
      respawnIn: this.respawnIn,
      alpha: [this.playerRow(playerName, this.playerArmor, playerKills, playerDead), ...this.rows('alpha')],
      bravo: this.rows('bravo'),
      rosterVersion: this.rosterVersion,
    };
  }

  winningTeam(): TeamId | null {
    if (this.alphaScore === this.bravoScore) return null;
    return this.alphaScore > this.bravoScore ? 'alpha' : 'bravo';
  }

  get teamSize(): number { return TDM_TEAM_SIZE; }

  dispose() {
    for (const bot of this.bots) {
      bot.model.group.removeFromParent();
      bot.model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.bots = []; this.alpha = []; this.bravo = [];
  }
}

