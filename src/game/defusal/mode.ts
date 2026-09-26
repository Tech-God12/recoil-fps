// Recoil FPS — BOMB DEFUSAL: the live 5v5 competitive mode on Sirocco.
//
// Owns everything that happens inside a match except the player's own body
// (the engine keeps movement, weapons and the camera): ten combatants and their
// money, the round/economy state machine (rules.ts), the bomb, smoke clouds,
// dropped weapons and — most importantly — the objective director that turns the
// shared TDM combat brain into a team that plays the map:
//   attackers pick a plan (execute, split, rush, default, fake), walk real lanes,
//   stage out of sight, throw execute smokes, plant, and hold post-plant angles;
//   defenders set up 2-1-2 (or stack), read hits and rotate, retake together and
//   defuse — or save when the clock says a defuse is impossible.
import * as THREE from 'three';
import { NavGrid } from '../ai';
import type { Effects } from '../effects';
import type { AABB } from '../world';
import { setWorldWeapon, worldWeaponMesh, type WorldWeaponKind } from '../models';
import type { WeaponId } from '../economy/catalog';
import { REWARDS } from '../economy/rewards';
import { TDMBot, type BotDirector, type BotGoal, type BotHit, type BotSkill, type BotSquad, type BotWeapon, type TDMArmor, type TDMContext, type TDMTeam } from '../tdm';
import {
  MatchState, TIMING, ECONOMY, roundPayout, pickMvp, combatScore, other,
  type MatchFormatId, type MatchTransition, type RoundEndReason, type RoundPhase, type RoundRecord, type Side, type TeamId,
} from './rules';
import { SHOP, afterDeath, freshInventory, grantMoney, inventoryValue, killRewardFor, shopItem, buy as shopBuy, type ArmorTier, type Inventory, type ShopItem } from './shop';
import { ROLE_SHEET, pickAttackPlan, pickDefenseSetup, planPurchases, teamBuyCall, type AttackPlan, type AttackStyle, type BotRole, type BuyCall, type DefenseSetup } from './botplan';
import {
  ATTACK_ROUTES, BUY_ZONES, CONTROL_SPOTS, DEFENSE_POSTS, DEFENSE_SETUPS, SITES, SPAWNS, SIROCCO_HALF,
  inRect, siroccoZoneAt, siteAt, type Lane, type PostId, type SiteId, type Vec2,
} from '../maps/sirocco';
import { buildC4, redGlowTexture, smokePuffTexture } from './bomb';
import { audio } from '../audio';

export type { Side, TeamId, RoundEndReason, RoundPhase };

export interface DefusalOptions {
  side: Side | 'random';
  format: MatchFormatId;
  difficulty: string;
}

export const SIDE_LABEL: Record<Side, string> = { attack: 'ATTACKERS', defend: 'DEFENDERS' };
/** Team band colours by side — tan/amber attackers, navy defenders. */
export const SIDE_TINT: Record<Side, number> = { attack: 0xC7792E, defend: 0x2F6FB0 };
const ALPHA_NAMES = ['Dagger', 'Havoc', 'Bricks', 'Tundra'];
const BRAVO_NAMES = ['Viper', 'Reaper', 'Ghost', 'Specter', 'Wraith'];
const SKILLS: Record<string, BotSkill> = {
  Easy: { acc: 0.62, head: 0.5, reaction: 1.6 },
  Normal: { acc: 0.8, head: 0.8, reaction: 1.15 },
  Hard: { acc: 0.92, head: 1.0, reaction: 0.9 },
  Nightmare: { acc: 1.0, head: 1.25, reaction: 0.75 },
};
/** Bot-side gun handling. Damage/armor ratios mirror shop.BALLISTICS. */
export const BOT_WEAPONS: Record<WeaponId, BotWeapon> = {
  m1911: { id: 'm1911', name: '1911', kind: 'pistol', damage: 35, armorRatio: 0.505, interval: 0.3, burst: [1, 3], pause: [0.3, 0.6], accNear: 0.74, accFar: 0.26, range: 30, headChance: 0.12 },
  deagle: { id: 'deagle', name: 'Deagle', kind: 'pistol', damage: 53, armorRatio: 0.93, interval: 0.45, burst: [1, 2], pause: [0.4, 0.8], accNear: 0.72, accFar: 0.35, range: 40, headChance: 0.14 },
  mp7: { id: 'mp7', name: 'MP', kind: 'smg', damage: 26, armorRatio: 0.625, interval: 0.075, burst: [4, 8], pause: [0.25, 0.5], accNear: 0.72, accFar: 0.25, range: 28, headChance: 0.08 },
  vector: { id: 'vector', name: 'Vector', kind: 'smg', damage: 26, armorRatio: 0.6, interval: 0.065, burst: [4, 9], pause: [0.25, 0.5], accNear: 0.74, accFar: 0.25, range: 26, headChance: 0.08 },
  ak47: { id: 'ak47', name: 'AK-47', kind: 'rifle', damage: 36, armorRatio: 0.775, interval: 0.1, burst: [3, 6], pause: [0.3, 0.6], accNear: 0.8, accFar: 0.42, range: 60, headChance: 0.11 },
  m4a1: { id: 'm4a1', name: 'M416', kind: 'rifle', damage: 33, armorRatio: 0.7, interval: 0.09, burst: [3, 6], pause: [0.3, 0.55], accNear: 0.82, accFar: 0.46, range: 60, headChance: 0.1 },
  scar_h: { id: 'scar_h', name: 'SCAR', kind: 'rifle', damage: 40, armorRatio: 0.85, interval: 0.1, burst: [2, 5], pause: [0.35, 0.6], accNear: 0.8, accFar: 0.48, range: 62, headChance: 0.1 },
  mcx: { id: 'mcx', name: 'SPEAR', kind: 'rifle', damage: 38, armorRatio: 0.82, interval: 0.083, burst: [3, 6], pause: [0.3, 0.55], accNear: 0.82, accFar: 0.47, range: 62, headChance: 0.1 },
  awm: { id: 'awm', name: 'AWM', kind: 'sniper', damage: 115, armorRatio: 0.975, interval: 1.45, burst: [1, 1], pause: [0.9, 1.6], accNear: 0.72, accFar: 0.8, range: 80, headChance: 0.18 },
  spas12: { id: 'spas12', name: 'SPAS', kind: 'shotgun', damage: 26, armorRatio: 0.5, interval: 0.85, burst: [1, 2], pause: [0.5, 0.9], accNear: 0.85, accFar: 0.1, range: 16, headChance: 0.06, pellets: 8, falloffStart: 8 },
  m249: { id: 'm249', name: 'M249', kind: 'lmg', damage: 32, armorRatio: 0.8, interval: 0.08, burst: [6, 12], pause: [0.3, 0.6], accNear: 0.72, accFar: 0.35, range: 55, headChance: 0.07 },
};
const WORLD_KIND: Record<WeaponId, WorldWeaponKind> = {
  m1911: 'pistol', deagle: 'pistol', mp7: 'smg', vector: 'smg', ak47: 'rifle', m4a1: 'rifle',
  scar_h: 'rifle', mcx: 'rifle', awm: 'sniper', spas12: 'shotgun', m249: 'lmg',
};

export interface Combatant {
  id: string;
  name: string;
  team: TeamId;
  isPlayer: boolean;
  bot: TDMBot | null;
  role: BotRole;
  inv: Inventory;
  alive: boolean;
  kills: number; deaths: number; assists: number; headshots: number; damage: number; mvps: number; plants: number; defuses: number;
  roundKills: number; roundDamage: number;
  planted: boolean; defused: boolean;
  /** Damage each enemy dealt to this combatant this round (assists). */
  damageBy: Map<string, number>;
  modelSide: Side | null;
}

export interface DefusalCtx {
  scene: THREE.Scene;
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  solids: AABB[];
  half: number;
  groundHeight(x: number, z: number): number;
  effects: Effects;
  moveCollide(p: THREE.Vector3, dx: number, dz: number, r: number): void;
  playerPos(): THREE.Vector3;
  playerFeet(): THREE.Vector3;
  playerAlive(): boolean;
  playerHp(): number;
  /** Line of sight from the player's eye (FOV + walls + smoke). */
  playerCanSee(p: THREE.Vector3): boolean;
  damagePlayer(amount: number, from: THREE.Vector3, killer: TDMBot, hit?: BotHit): void;
  throwGrenade(from: THREE.Vector3, target: THREE.Vector3, owner: TDMBot, kind: 'frag' | 'flash' | 'smoke'): void;
  onBotFire(pos: THREE.Vector3, team: TDMTeam): void;
  spawnPlayer(at: THREE.Vector3, yaw: number, inv: Inventory): void;
  equipPlayer(inv: Inventory, focus?: 'primary' | 'secondary'): void;
  bombDetonated(at: THREE.Vector3): void;
  onFeed(killer: string, weapon: string, victim: string, headshot: boolean, killerTeam: TeamId, zone: string): void;
  onRadio(text: string): void;
  onCallout(text: string): void;
  announce(text: string): void;
  onMoney(amount: number, reason: string, total: number): void;
  earnWallet(amount: number, reason: string): void;
  onMatchEnd(): void;
  onBodyFall?(at: THREE.Vector3, heavy: boolean): void;
  onWeaponDrop?(at: THREE.Vector3): void;
}

type BombStateId = 'none' | 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
type Task =
  | 'route' | 'stage' | 'hold' | 'plant' | 'getbomb' | 'loot'
  | 'rotate' | 'retakeStage' | 'retake' | 'defuse' | 'flee' | 'follow' | 'hunt';
interface BotPlan {
  task: Task;
  route: Vec2[];
  /** Waypoints remaining until the staging point (≤0 = past it). */
  stageLeft: number;
  lane: Lane | null;
  hold: { at: Vec2; face: Vec2; crouch?: boolean } | null;
  anchor: boolean;
  post: PostId | null;
  smokeAt: Vec2 | null;
  speed: number;
  t: number;
  /** Resume task after a fight interrupts a plant/defuse. */
  resume: Task | null;
  lootAt: THREE.Vector3 | null;
  /** Heard a fight: look that way until `lookT`. */
  lookAt: THREE.Vector3 | null;
  lookT: number;
}

interface Smoke { pos: THREE.Vector3; age: number; group: THREE.Group; mat: THREE.SpriteMaterial; puffs: { s: THREE.Sprite; off: THREE.Vector3; size: number }[] }
interface Drop { weapon: WeaponId; pos: THREE.Vector3; mesh: THREE.Object3D }

export interface DefusalBanner {
  id: number;
  kind: 'round' | 'live' | 'end' | 'halftime' | 'planted' | 'match' | 'info';
  title: string;
  sub?: string;
  team?: TeamId;
  side?: Side;
  mvp?: string;
  ttl: number;
}

export interface DefusalRosterEntry {
  id: string; name: string; team: TeamId; side: Side; alive: boolean; hp: number;
  money: number | null; kills: number; deaths: number; assists: number; mvps: number; headshots: number; damage: number;
  score: number; weapon: string | null; armor: ArmorTier; kit: boolean; bomb: boolean; you: boolean; value: number;
}

export interface DefusalHud {
  phase: RoundPhase;
  clock: number;
  round: number;
  maxRounds: number;
  roundsToWin: number;
  halftimeAfter: number;
  alphaScore: number;
  bravoScore: number;
  alphaSide: Side;
  money: number;
  /** Your round inventory (buy menu). */
  inv: Inventory;
  side: Side;
  buyOpen: boolean;
  inBuyZone: boolean;
  buyTimeLeft: number;
  armor: ArmorTier;
  kit: boolean;
  smokes: number;
  hasBomb: boolean;
  bombState: BombStateId;
  bombSite: SiteId | null;
  bombTimeLeft: number;
  bombZone: string | null;
  plantProgress: number;
  defuseProgress: number;
  defuseTotal: number;
  defuserIsPlayer: boolean;
  prompt: string | null;
  playerDead: boolean;
  roster: DefusalRosterEntry[];
  history: { round: number; winner: TeamId; reason: RoundEndReason; half: 1 | 2 }[];
  banner: DefusalBanner | null;
  smokeDensity: number;
  plan: string | null;
  matchPoint: TeamId[];
  lastOfHalf: boolean;
  radar: { sites: { id: SiteId; nx: number; nz: number }[]; allies: { nx: number; nz: number; yaw: number }[]; bomb?: { nx: number; nz: number; planted: boolean } };
}

export interface DefusalResult {
  alphaScore: number;
  bravoScore: number;
  winner: TeamId | 'draw';
  history: RoundRecord[];
  roster: DefusalRosterEntry[];
  startSide: Side;
  rounds: number;
  plants: number;
  defuses: number;
  mvps: number;
  assists: number;
  damage: number;
}

const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);
const d2 = (a: { x: number; z: number }, x: number, z: number) => Math.hypot(a.x - x, a.z - z);

export class DefusalMode implements BotSquad {
  bots: TDMBot[] = [];
  readonly director: BotDirector;
  readonly match: MatchState;
  readonly players: Combatant[] = [];
  readonly player: Combatant;
  readonly nav: NavGrid;
  readonly startSide: Side;
  /** Bumped when a body dies or a model is rebuilt — engine refreshes hittables. */
  rosterVersion = 0;
  private ctx: DefusalCtx;
  private tctx: TDMContext;
  private skill: BotSkill;
  private tick = 0;
  private planT = 0;
  private spotT = 0;
  private spotted = new Set<TDMBot>();
  private roundTime = 0;
  private readonly rng: () => number;
  // ---- bomb ----
  bomb = {
    state: 'none' as BombStateId,
    carrier: null as Combatant | null,
    pos: new THREE.Vector3(),
    site: null as SiteId | null,
    plantT: 0,
    planter: null as Combatant | null,
    defuseT: 0,
    defuser: null as Combatant | null,
    beepT: 0,
    keyT: 0,
    whined: false,
  };
  private c4World = buildC4(1.35);
  private c4Carry = buildC4(0.9);
  private c4Light: THREE.PointLight;
  private c4Glow: THREE.Sprite;
  private ledOn = 0;
  private bombTossT = 0;
  private bombDroppedAt = 0;
  // ---- utility / loot ----
  private smokes: Smoke[] = [];
  private drops: Drop[] = [];
  // ---- AI plans ----
  private plans = new Map<TDMBot, BotPlan>();
  private attack: AttackPlan = { site: 'A', style: 'exec' };
  private executing = false;
  private stagedSince = -1;
  private defaultDecideAt = 0;
  private defense: DefenseSetup = 'standard';
  private rotatedTo: SiteId | null = null;
  private threat: Record<SiteId, number> = { A: 0, B: 0 };
  private retakeGoT = -1;
  private lastSite: SiteId | undefined;
  private lastLossSite: SiteId | undefined;
  private buyCalls: Record<TeamId, BuyCall> = { alpha: 'pistol', bravo: 'pistol' };
  private followPlayer = false;
  private reportCooldown = new Map<string, number>();
  private announcedTen = false;
  // ---- hud ----
  private banner: DefusalBanner | null = null;
  private bannerSeq = 0;

  constructor(ctx: DefusalCtx, opts: DefusalOptions, rng: () => number = Math.random) {
    this.ctx = ctx;
    this.rng = rng;
    this.startSide = opts.side === 'random' ? (rng() < 0.5 ? 'attack' : 'defend') : opts.side;
    this.match = new MatchState(opts.format, this.startSide);
    this.skill = SKILLS[opts.difficulty] ?? SKILLS.Normal;
    this.nav = new NavGrid(ctx.solids, ctx.half, ctx.groundHeight);
    this.tctx = {
      scene: ctx.scene, occluders: ctx.occluders, coverNodes: ctx.coverNodes, solids: ctx.solids, half: ctx.half,
      groundHeight: ctx.groundHeight, effects: ctx.effects, moveCollide: ctx.moveCollide,
      onBodyFall: ctx.onBodyFall, onWeaponDrop: ctx.onWeaponDrop,
      playerPos: ctx.playerPos, playerFeet: ctx.playerFeet,
      playerAlive: () => ctx.playerAlive() && this.player.alive,
      damagePlayer: (a, f, k, hit) => ctx.damagePlayer(a, f, k, hit as BotHit | undefined),
      onCallout: (kind, pos, team) => this.botCallout(kind, pos, team),
      throwGrenade: (from, target, owner) => ctx.throwGrenade(from, target, owner, 'frag'),
      onBotFire: (p, team) => { ctx.onBotFire(p, team); this.hearGunfire(p, team); },
      onFeed: () => { /* feed is emitted by recordDeath */ },
      onScore: () => { /* live scoreboard reads hud() */ },
      playerOnFire: () => false,
      sightBlocked: (a, b) => this.sightBlocked(a, b),
    };
    this.director = {
      idleGoal: bot => this.idleGoal(bot),
      mayChase: bot => this.mayChase(bot),
      busy: bot => this.isBusy(bot),
    };

    const mk = (id: string, name: string, team: TeamId, isPlayer: boolean, role: BotRole): Combatant => ({
      id, name, team, isPlayer, bot: null, role, inv: freshInventory(),
      alive: true, kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, mvps: 0, plants: 0, defuses: 0,
      roundKills: 0, roundDamage: 0, planted: false, defused: false, damageBy: new Map(), modelSide: null,
    });
    this.player = mk('player', 'YOU', 'alpha', true, 'rifler');
    this.players.push(this.player);
    const roles: BotRole[] = ['entry', 'awper', 'support', 'lurker'];
    ALPHA_NAMES.forEach((n, i) => this.players.push(mk(n, n, 'alpha', false, roles[i])));
    BRAVO_NAMES.forEach((n, i) => this.players.push(mk(n, n, 'bravo', false, ROLE_SHEET[i])));
    for (const c of this.players) {
      if (c.isPlayer) continue;
      const side = this.match.sideOf(c.team);
      const pad = SPAWNS[side][0];
      const bot = new TDMBot(this.tctx, this, this.nav, c.team, c.name, 0, V(pad[0], pad[1]), {
        baseHp: 100, hpPerArmor: 0, momentum: false, corpseLinger: Infinity, dropWeapon: false,
        tint: SIDE_TINT[side], marker: c.team === 'alpha', fovCos: Math.cos(THREE.MathUtils.degToRad(95)),
      });
      bot.skill = this.skill;
      c.bot = bot;
      c.modelSide = side;
      this.bots.push(bot);
    }

    // Bomb dressing. The light is added once (intensity 0) so the scene's light
    // count — and every compiled shader — never changes mid-match.
    this.c4World.group.visible = false;
    ctx.scene.add(this.c4World.group);
    this.c4Light = new THREE.PointLight(0xFF3A22, 0, 7, 2);
    ctx.scene.add(this.c4Light);
    this.c4Glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: redGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.c4Glow.scale.set(0.9, 0.9, 1);
    this.c4Glow.visible = false;
    ctx.scene.add(this.c4Glow);
    this.c4Carry.group.rotation.set(Math.PI / 2, 0, 0);
    this.c4Carry.group.position.set(0, 0.34, 0.33);

    this.startRound(false);
  }

  // =====================================================================
  // LOOKUPS
  // =====================================================================
  private byBot = (bot: TDMBot): Combatant => this.players.find(c => c.bot === bot)!;
  private byId = (id: string) => this.players.find(c => c.id === id);
  sideOf(c: Combatant): Side { return this.match.sideOf(c.team); }
  private posOf(c: Combatant): THREE.Vector3 { return c.isPlayer ? this.ctx.playerFeet() : c.bot!.pos; }
  private aliveOn(side: Side): Combatant[] { return this.players.filter(c => c.alive && this.sideOf(c) === side); }
  private botsOn(side: Side): TDMBot[] { return this.players.filter(c => c.bot && c.alive && this.sideOf(c) === side).map(c => c.bot!); }
  get playerSide(): Side { return this.match.alphaSide; }
  get alphaAlive(): number { return this.players.filter(c => c.team === 'alpha' && c.alive).length; }

  // =====================================================================
  // ROUND LIFECYCLE
  // =====================================================================
  private startRound(swapped: boolean) {
    const m = this.match;
    const pistol = m.round === 1 || m.round === m.format.halftimeAfter + 1;
    this.clearRoundEntities();
    for (const c of this.players) {
      if (pistol) c.inv = freshInventory(ECONOMY.start);
      else if (!c.alive) c.inv = afterDeath(c.inv);
      else if (c.bot) c.inv = { ...c.inv, frags: c.bot.frags, flashes: c.bot.flashes };
      c.alive = true;
      c.roundKills = 0; c.roundDamage = 0; c.planted = false; c.defused = false;
      c.damageBy.clear();
    }
    // Team buys (bots): the whole squad makes one call from its average bank.
    for (const team of ['alpha', 'bravo'] as TeamId[]) {
      const side = m.sideOf(team);
      const members = this.players.filter(c => c.team === team);
      const call = teamBuyCall(members.map(c => c.inv.money), side, {
        pistolRound: pistol, lastOfHalf: m.isLastRoundOfHalf, mustWin: m.matchPoint().includes(other(team)),
      });
      this.buyCalls[team] = call;
      let awp = members.some(c => c.inv.primary === 'awm');
      for (const c of members) {
        if (!c.bot) continue;
        const role: BotRole = c.role === 'awper' && awp && c.inv.primary !== 'awm' ? 'rifler' : c.role;
        c.inv = planPurchases(c.inv, side, call, role, this.rng);
        if (c.inv.primary === 'awm') awp = true;
      }
    }
    // Spawn everyone on their side's pads; the player takes the centre pad.
    const pads: Record<Side, Vec2[]> = { attack: [...SPAWNS.attack], defend: [...SPAWNS.defend] };
    const order = [this.player, ...this.players.filter(c => !c.isPlayer)];
    for (const c of order) {
      const side = this.sideOf(c);
      const pad = pads[side].shift() ?? SPAWNS[side][0];
      const at = V(pad[0], pad[1]);
      if (c.bot) {
        this.equipBot(c);
        c.bot.respawn(at);
        c.bot.frags = c.inv.frags;
        c.bot.flashes = c.inv.flashes;
      } else {
        this.ctx.spawnPlayer(at, side === 'attack' ? 0 : Math.PI, c.inv);
      }
    }
    // The bomb goes to a random attacker — sometimes you.
    const attackers = this.players.filter(c => this.sideOf(c) === 'attack');
    this.giveBomb(attackers[Math.floor(this.rng() * attackers.length)]);
    this.roundTime = 0;
    this.announcedTen = false;
    this.followPlayer = false;
    this.planRound();
    this.rosterVersion++;
    const side = this.playerSide;
    const mp = m.matchPoint();
    this.setBanner('round', `ROUND ${m.round}`, pistol ? 'PISTOL ROUND · BUY PHASE' : mp.length ? 'MATCH POINT · BUY PHASE' : m.isLastRoundOfHalf ? 'LAST ROUND OF THE HALF · BUY PHASE' : 'BUY PHASE', undefined, side, 3.2);
    if (this.bomb.carrier?.isPlayer) this.ctx.onRadio('You have the bomb — plant it on A or B (hold X on site).');
    if (swapped) this.ctx.announce('Second half. Switching sides.');
    else if (mp.length) this.ctx.announce('Match point.');
    else if (pistol) this.ctx.announce('Pistol round.');
    audio.roundStartStinger();
  }

  /** Body kit, armor tier, gun silhouette and utility for a bot. */
  private equipBot(c: Combatant) {
    const bot = c.bot!;
    const side = this.sideOf(c);
    if (bot.armor !== c.inv.armor || c.modelSide !== side) {
      bot.rebuildModel(c.inv.armor as TDMArmor, SIDE_TINT[side]);
      c.modelSide = side;
      this.rosterVersion++;
    }
    const wid = c.inv.primary ?? c.inv.secondary;
    bot.weapon = BOT_WEAPONS[wid];
    setWorldWeapon(bot.model, WORLD_KIND[wid]);
    bot.skill = this.skill;
  }

  private clearRoundEntities() {
    for (const s of this.smokes) { s.group.removeFromParent(); s.mat.dispose(); }
    this.smokes = [];
    for (const d of this.drops) this.disposeDrop(d);
    this.drops = [];
    this.bomb.state = 'none'; this.bomb.carrier = null; this.bomb.site = null;
    this.bomb.plantT = 0; this.bomb.planter = null; this.bomb.defuseT = 0; this.bomb.defuser = null;
    this.bomb.whined = false;
    this.c4World.group.visible = false;
    this.c4Carry.group.removeFromParent();
    this.c4Light.intensity = 0;
    this.c4Glow.visible = false;
    this.rotatedTo = null;
    this.threat = { A: 0, B: 0 };
    this.retakeGoT = -1;
    this.spotted.clear();
  }

  private giveBomb(c: Combatant) {
    this.bomb.state = 'carried';
    this.bomb.carrier = c;
    this.c4World.group.visible = false;
    this.c4Glow.visible = false;
    this.c4Carry.group.removeFromParent();
    if (c.bot) c.bot.model.parts.torso.add(this.c4Carry.group);
  }

  private dropBomb(at: THREE.Vector3) {
    this.bomb.state = 'dropped';
    this.bomb.carrier = null;
    this.bombDroppedAt = this.roundTime;
    this.bomb.plantT = 0; this.bomb.planter = null;
    this.bomb.pos.set(at.x, this.ctx.groundHeight(at.x, at.z), at.z);
    this.c4Carry.group.removeFromParent();
    this.c4World.group.position.copy(this.bomb.pos);
    this.c4World.group.rotation.set(0, this.rng() * Math.PI * 2, 0.35);
    this.c4World.group.visible = true;
    if (this.playerSide === 'attack') this.ctx.onRadio(`Bomb dropped — ${siroccoZoneAt(at.x, at.z)}.`);
  }

  private plantBomb(c: Combatant, at: THREE.Vector3) {
    const site = siteAt(at.x, at.z);
    if (!site || !this.match.plant()) return;
    this.bomb.state = 'planted';
    this.bomb.site = site;
    this.bomb.carrier = null;
    this.bomb.plantT = 0; this.bomb.planter = null;
    this.bomb.pos.set(at.x, this.ctx.groundHeight(at.x, at.z), at.z);
    this.bomb.beepT = 0;
    this.c4Carry.group.removeFromParent();
    this.c4World.group.position.copy(this.bomb.pos);
    this.c4World.group.rotation.set(0, this.rng() * Math.PI * 2, 0);
    this.c4World.group.visible = true;
    this.c4Light.position.set(at.x, this.bomb.pos.y + 0.35, at.z);
    this.c4Glow.position.set(at.x, this.bomb.pos.y + 0.22, at.z);
    c.plants++; c.planted = true;
    c.inv = grantMoney(c.inv, ECONOMY.plantPersonal);
    if (c.isPlayer) { this.ctx.onMoney(ECONOMY.plantPersonal, 'plant', c.inv.money); this.ctx.earnWallet(150, 'plant'); }
    audio.c4Armed();
    this.ctx.announce('Bomb has been planted.');
    this.setBanner('planted', 'BOMB PLANTED', `SITE ${site} · 40 SECONDS`, undefined, 'attack', 2.6);
    this.lastSite = site;
    this.onPlanted(site);
  }

  private defuseBomb(c: Combatant) {
    this.bomb.state = 'defused';
    this.bomb.defuseT = 0; this.bomb.defuser = null;
    this.c4Light.intensity = 0;
    this.c4Glow.visible = false;
    c.defuses++; c.defused = true;
    c.inv = grantMoney(c.inv, ECONOMY.defusePersonal);
    if (c.isPlayer) { this.ctx.onMoney(ECONOMY.defusePersonal, 'defuse', c.inv.money); this.ctx.earnWallet(200, 'defuse'); }
    audio.defused();
    this.endRound('defend', 'defuse');
  }

  private detonate() {
    this.bomb.state = 'exploded';
    this.c4World.group.visible = false;
    this.c4Light.intensity = 0;
    this.c4Glow.visible = false;
    const at = this.bomb.pos.clone();
    this.ctx.bombDetonated(at);
    for (const c of this.players) {
      if (!c.alive || !c.bot) continue;
      const d = c.bot.pos.distanceTo(at);
      if (d > 30) continue;
      const dmg = d < 12 ? 500 : THREE.MathUtils.lerp(120, 0, (d - 12) / 18) * (c.inv.armor ? 0.7 : 1);
      c.bot.noteHit({ from: at, explosive: true });
      if (c.bot.takeDamage(dmg, false, c.bot, false)) this.recordDeath(c, null, 'C4', false);
    }
  }

  private endRound(winner: Side, reason: RoundEndReason) {
    const record = this.match.endRound(winner, reason);
    if (record) this.onRoundEnd(record);
  }

  private onRoundEnd(record: RoundRecord) {
    if (record.reason === 'bomb') this.detonate();
    this.bomb.plantT = 0; this.bomb.planter = null; this.bomb.defuseT = 0; this.bomb.defuser = null;
    // Money: CS2 payouts for everyone, survivors included.
    for (const c of this.players) {
      const side = this.sideOf(c);
      const amount = roundPayout({
        won: c.team === record.winner, side, reason: record.reason, planted: record.planted,
        alive: c.alive, lossesAfter: this.match.losses[c.team],
      });
      c.inv = grantMoney(c.inv, amount);
      if (c.isPlayer && amount > 0) this.ctx.onMoney(amount, c.team === record.winner ? 'round win' : 'loss bonus', c.inv.money);
      if (c.bot && c.alive) c.inv = { ...c.inv, frags: c.bot.frags, flashes: c.bot.flashes };
    }
    const mvpId = pickMvp(record, this.players.map(c => ({ id: c.id, team: c.team, kills: c.roundKills, damage: c.roundDamage, planted: c.planted, defused: c.defused })));
    const mvp = mvpId ? this.byId(mvpId) ?? null : null;
    if (mvp) mvp.mvps++;
    const won = record.winner === 'alpha';
    if (won) this.ctx.earnWallet(150, 'round');
    if (mvp?.isPlayer) this.ctx.earnWallet(100, 'mvp');
    const reasonText: Record<RoundEndReason, string> = {
      elimination: record.winnerSide === 'attack' ? 'All defenders eliminated' : 'All attackers eliminated',
      bomb: 'The bomb detonated', defuse: 'The bomb has been defused', time: 'Time ran out — the site held',
    };
    this.setBanner('end', `${SIDE_LABEL[record.winnerSide]} WIN`, reasonText[record.reason], record.winner, record.winnerSide, TIMING.roundEnd - 0.4,
      mvp ? `${mvp.isPlayer ? 'YOU' : mvp.name.toUpperCase()} — ${record.reason === 'defuse' ? 'defused the bomb' : record.reason === 'bomb' && mvp.planted ? 'planted the bomb' : `${mvp.roundKills} elimination${mvp.roundKills === 1 ? '' : 's'}`}` : undefined);
    this.ctx.announce(record.winnerSide === 'attack' ? 'Attackers win.' : 'Defenders win.');
    if (won) audio.roundWinStinger(); else audio.roundLoseStinger();
    if (record.winnerSide === 'attack' && record.planted && this.bomb.site) this.lastLossSite = this.bomb.site;
  }

  private onTransition(tr: MatchTransition) {
    switch (tr.type) {
      case 'live':
        this.setBanner('live', 'GO GO GO', this.playerSide === 'attack' ? 'Plant the bomb on A or B' : 'Defend both sites', undefined, this.playerSide, 1.6);
        break;
      case 'end':
        this.onRoundEnd(tr.record);
        break;
      case 'halftime':
        this.setBanner('halftime', 'HALFTIME', `${this.match.score.alpha} — ${this.match.score.bravo} · SWITCHING SIDES`, undefined, undefined, TIMING.halftime);
        this.ctx.announce('Halftime.');
        break;
      case 'round':
        this.startRound(tr.swapped);
        break;
      case 'ended': {
        const w = this.match.winner;
        this.setBanner('match', w === 'alpha' ? 'VICTORY' : w === 'draw' ? 'DRAW' : 'DEFEAT', `${this.match.score.alpha} — ${this.match.score.bravo}`, w === 'draw' ? undefined : w ?? undefined, undefined, 4);
        if (w === 'alpha') this.ctx.earnWallet(750, 'match');
        this.ctx.onMatchEnd();
        break;
      }
    }
  }

  // =====================================================================
  // KILLS · DAMAGE · DROPS
  // =====================================================================
  onIgnite(): void { /* no momentum layer in competitive */ }

  onDamage(attacker: TDMBot | 'player', victim: TDMBot, amount: number): void {
    const a = attacker === 'player' ? this.player : this.byBot(attacker);
    const v = this.byBot(victim);
    if (!a || !v || a === v || a.team === v.team || amount <= 0) return;
    this.creditDamage(a, v, amount);
  }
  /** Bot → player damage (the engine applies armor, then reports the health loss). */
  recordPlayerDamage(killer: TDMBot, amount: number) {
    const a = this.byBot(killer);
    if (a && amount > 0) this.creditDamage(a, this.player, amount);
  }
  private creditDamage(a: Combatant, v: Combatant, amount: number) {
    a.damage += amount; a.roundDamage += amount;
    v.damageBy.set(a.id, (v.damageBy.get(a.id) ?? 0) + amount);
  }

  handleKill(killer: TDMBot | 'player', victim: TDMBot | 'player', headshot: boolean, weapon: string): void {
    const k = killer === 'player' ? this.player : this.byBot(killer);
    const v = victim === 'player' ? this.player : this.byBot(victim);
    if (v) this.recordDeath(v, k ?? null, weapon, headshot);
  }
  /** The engine reports the player's death (killer null = C4 / own grenade). */
  playerKilled(killer: TDMBot | null, headshot: boolean, weapon: string) {
    this.recordDeath(this.player, killer ? this.byBot(killer) : null, weapon, headshot);
  }

  private resolveItem(weapon: string): ShopItem | undefined {
    const w = weapon.toLowerCase();
    return shopItem(weapon) ?? SHOP.find(i => i.name.toLowerCase() === w || i.weapon === w);
  }

  private recordDeath(v: Combatant, k: Combatant | null, weapon: string, headshot: boolean) {
    if (!v.alive) return;
    v.alive = false;
    v.deaths++;
    const pos = this.posOf(v).clone();
    const item = this.resolveItem(weapon);
    const label = weapon === 'FRAG' || weapon === 'C4' ? weapon : (item?.name ?? weapon).toUpperCase();
    if (k && k.team !== v.team) {
      k.kills++; k.roundKills++;
      if (headshot) k.headshots++;
      const reward = killRewardFor(weapon === 'FRAG' ? 'FRAG' : item?.id ?? 'ak47');
      k.inv = grantMoney(k.inv, reward);
      if (k.isPlayer) {
        this.ctx.onMoney(reward, 'kill reward', k.inv.money);
        this.ctx.earnWallet(headshot ? REWARDS.headshot : REWARDS.kill, headshot ? 'headshot' : 'kill');
      }
    }
    for (const [id, dmg] of v.damageBy) {
      if (dmg < 40 || (k && id === k.id)) continue;
      const a = this.byId(id);
      if (a && a.team !== v.team) a.assists++;
    }
    // Drops: the gun hits the floor, the bomb too.
    const gun = v.inv.primary ?? (v.inv.secondary !== 'm1911' ? v.inv.secondary : null);
    if (gun) {
      this.spawnDrop(gun, pos);
      v.inv = v.inv.primary === gun ? { ...v.inv, primary: null } : { ...v.inv, secondary: 'm1911' };
    }
    if (this.bomb.state === 'carried' && this.bomb.carrier === v) this.dropBomb(pos);
    if (this.bomb.planter === v) { this.bomb.planter = null; this.bomb.plantT = 0; }
    if (this.bomb.defuser === v) { this.bomb.defuser = null; this.bomb.defuseT = 0; }
    // Intel: defenders read where their team is dying.
    const site = this.siteNear(pos);
    if (site && this.sideOf(v) === 'defend') this.threat[site] += 1.6;
    const zone = siroccoZoneAt(pos.x, pos.z);
    this.ctx.onFeed(k ? (k.isPlayer ? 'YOU' : k.name) : '', label, v.isPlayer ? 'YOU' : v.name, headshot, k?.team ?? other(v.team), zone);
    if (v.team === 'alpha' && !v.isPlayer) this.report(`dead-${v.id}`, `${v.name} is down — ${zone}.`, 0);
    this.rosterVersion++;
    this.checkElimination();
  }

  private checkElimination() {
    const ph = this.match.phase;
    if (ph !== 'live' && ph !== 'planted') return;
    const atk = this.aliveOn('attack').length, def = this.aliveOn('defend').length;
    if (def === 0) this.endRound('attack', 'elimination');
    else if (atk === 0 && this.bomb.state !== 'planted') this.endRound('defend', 'elimination');
  }

  private spawnDrop(weapon: WeaponId, at: THREE.Vector3) {
    const { mesh } = worldWeaponMesh(WORLD_KIND[weapon]);
    const g = new THREE.Group();
    mesh.rotation.set(0, 0, Math.PI / 2);
    mesh.scale.setScalar(1.15);
    g.add(mesh);
    const x = at.x + (this.rng() - 0.5) * 0.8, z = at.z + (this.rng() - 0.5) * 0.8;
    g.position.set(x, this.ctx.groundHeight(x, z) + 0.05, z);
    g.rotation.y = this.rng() * Math.PI * 2;
    this.ctx.scene.add(g);
    this.drops.push({ weapon, pos: g.position.clone(), mesh: g });
  }
  private disposeDrop(d: Drop) {
    d.mesh.removeFromParent();
    d.mesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
  private nearestDrop(p: THREE.Vector3, range: number): Drop | null {
    let best: Drop | null = null, bd = range;
    for (const d of this.drops) { const dd = d2(p, d.pos.x, d.pos.z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
  private takeDrop(c: Combatant, d: Drop) {
    const item = shopItem(d.weapon)!;
    const cur = item.kind === 'primary' ? c.inv.primary : c.inv.secondary;
    this.drops.splice(this.drops.indexOf(d), 1);
    this.disposeDrop(d);
    if (cur && cur !== 'm1911') this.spawnDrop(cur, this.posOf(c));
    c.inv = item.kind === 'primary' ? { ...c.inv, primary: d.weapon } : { ...c.inv, secondary: d.weapon };
    if (c.bot) this.equipBot(c);
  }

  // =====================================================================
  // PLAYER API (called by the engine)
  // =====================================================================
  get inBuyZone(): boolean {
    const p = this.ctx.playerFeet();
    return inRect(p.x, p.z, BUY_ZONES[this.playerSide]);
  }
  canBuyNow(): boolean { return this.player.alive && this.match.buyOpen && this.inBuyZone; }
  buy(id: string): { ok: boolean; reason?: string } {
    if (!this.canBuyNow()) return { ok: false, reason: this.match.buyOpen ? 'Leave the buy zone? You are outside it' : 'Buy time is over' };
    const r = shopBuy(this.player.inv, id, this.playerSide);
    if (!r.ok) return { ok: false, reason: r.reason };
    const item = shopItem(id)!;
    this.player.inv = r.inv;
    // A replaced gun drops at your feet, exactly like CS.
    if (r.replaced && r.replaced !== 'm1911' && (item.kind === 'primary' || item.kind === 'secondary')) this.spawnDrop(r.replaced, this.ctx.playerFeet());
    this.ctx.equipPlayer(this.player.inv, item.kind === 'secondary' ? 'secondary' : item.kind === 'primary' ? 'primary' : undefined);
    return { ok: true };
  }
  /** Player utility spent (engine throws the grenade). */
  consumePlayerGrenade(kind: 'frag' | 'flash' | 'smoke'): boolean {
    const key = kind === 'frag' ? 'frags' : kind === 'flash' ? 'flashes' : 'smokes';
    if (this.player.inv[key] <= 0) return false;
    this.player.inv = { ...this.player.inv, [key]: this.player.inv[key] - 1 };
    return true;
  }
  /** X tap: pick up the weapon at your feet. */
  playerInteractTap(): boolean {
    if (!this.player.alive) return false;
    const d = this.nearestDrop(this.ctx.playerFeet(), 1.9);
    if (!d) return false;
    const item = shopItem(d.weapon)!;
    this.takeDrop(this.player, d);
    audio.pickup();
    this.ctx.equipPlayer(this.player.inv, item.kind === 'secondary' ? 'secondary' : 'primary');
    return true;
  }
  /** 5: drop the bomb in front of you for a teammate (CS muscle memory: slot 5 = C4). */
  playerDropBomb(forward: THREE.Vector3): boolean {
    if (this.bomb.state !== 'carried' || this.bomb.carrier !== this.player || !this.player.alive) return false;
    const f = this.ctx.playerFeet();
    const at = f.clone().addScaledVector(forward.setY(0).normalize(), 1.4);
    // never through a wall: fall back to the player's feet if the toss point is inside geometry
    const blocked = this.ctx.solids.some(b => b.minY < 1 && b.maxY > 0.3 && at.x > b.minX - 0.2 && at.x < b.maxX + 0.2 && at.z > b.minZ - 0.2 && at.z < b.maxZ + 0.2);
    this.dropBomb(blocked ? f : at);
    this.bombTossT = 1.2;
    return true;
  }
  movementLocked(): boolean {
    return this.match.phase === 'freeze' || this.bomb.planter === this.player || this.bomb.defuser === this.player;
  }
  /** Player radio: 6 = A, 7 = B, 8 = follow me. */
  radio(cmd: 'A' | 'B' | 'follow') {
    if (!this.player.alive) return;
    if (cmd === 'follow') {
      this.followPlayer = !this.followPlayer;
      this.ctx.onRadio(this.followPlayer ? 'YOU: Follow me! — "Copy, on you."' : 'YOU: Back to the plan. — "Roger."');
      if (this.followPlayer) {
        for (const bot of this.teamBots('alpha')) { const p = this.plans.get(bot); if (p) p.task = 'follow'; }
      } else this.replanAlpha();
      return;
    }
    this.followPlayer = false;
    if (this.playerSide === 'attack') {
      this.attack = { site: cmd, style: this.match.clock < 55 ? 'rush' : 'exec' };
      this.assignAttack(true);
      this.ctx.onRadio(`YOU: Go ${cmd}! — "Moving ${cmd}."`);
    } else {
      this.rotate(cmd, 3, true);
      this.ctx.onRadio(`YOU: Rotate ${cmd}! — "Rotating."`);
    }
  }
  /** Hand the player's squad back to the director from wherever they stand. */
  private replanAlpha() {
    if (this.bomb.state === 'planted' && this.bomb.site) this.onPlanted(this.bomb.site);
    else if (this.playerSide === 'attack') this.assignAttack(true);
    else this.assignDefense();
  }
  private teamBots(team: TeamId): TDMBot[] { return this.players.filter(c => c.team === team && c.bot && c.alive).map(c => c.bot!); }

  /** Spectator candidates: living teammates first, then anyone alive. */
  spectateList(): TDMBot[] {
    const allies = this.teamBots('alpha');
    return allies.length ? allies : this.teamBots('bravo');
  }
  combatantOf(bot: TDMBot): Combatant { return this.byBot(bot); }

  getHittables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const c of this.players) if (c.bot && c.alive && c.team === 'bravo') out.push(...c.bot.model.hitMeshes);
    return out;
  }

  /** Bot gunfire: enemies holding an angle within earshot turn to face the fight. */
  private hearGunfire(p: THREE.Vector3, team: TDMTeam) {
    for (const c of this.players) {
      if (!c.bot || !c.alive || c.team === team || c.bot.seesEnemy()) continue;
      if (c.bot.pos.distanceTo(p) > 26) continue;
      const plan = this.plans.get(c.bot);
      if (plan && (plan.task === 'hold' || plan.task === 'stage' || plan.task === 'retakeStage')) { plan.lookAt = p.clone(); plan.lookT = this.roundTime + 1.6; }
    }
  }

  /** Player gunfire is heard by the hostile team. */
  notifyGunshot(pos: THREE.Vector3, radius: number) {
    for (const c of this.players) {
      if (!c.bot || !c.alive || c.team !== 'bravo') continue;
      if (c.bot.pos.distanceTo(pos) <= radius) c.bot.hearShot(pos);
    }
    if (this.playerSide === 'attack') { const s = this.siteNear(pos, true); if (s) this.threat[s] += 0.35; }
    for (const c of this.players) {
      if (!c.bot || !c.alive || c.team !== 'bravo' || c.bot.seesEnemy() || c.bot.pos.distanceTo(pos) > Math.min(radius, 30)) continue;
      const plan = this.plans.get(c.bot);
      if (plan && (plan.task === 'hold' || plan.task === 'stage' || plan.task === 'retakeStage')) { plan.lookAt = pos.clone(); plan.lookT = this.roundTime + 1.6; }
    }
  }

  // =====================================================================
  // SMOKE
  // =====================================================================
  spawnSmoke(at: THREE.Vector3) {
    const group = new THREE.Group();
    const mat = new THREE.SpriteMaterial({ map: smokePuffTexture(), color: 0xC9C4BA, transparent: true, depthWrite: false, opacity: 0.95 });
    const puffs: Smoke['puffs'] = [];
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 26) * 3.6;
      const off = new THREE.Vector3(Math.cos(a) * r, 0.5 + ((i * 0.618) % 1) * 2.8, Math.sin(a) * r);
      const s = new THREE.Sprite(mat);
      const size = 3.2 + ((i * 1.37) % 1) * 1.8;
      s.scale.set(0.1, 0.1, 1);
      group.add(s);
      puffs.push({ s, off, size });
    }
    group.position.set(at.x, this.ctx.groundHeight(at.x, at.z), at.z);
    this.ctx.scene.add(group);
    this.smokes.push({ pos: group.position.clone(), age: 0, group, mat, puffs });
    audio.smokePop(at.x, at.y, at.z);
  }
  private smokeRadius(s: Smoke): number {
    const grow = Math.min(1, s.age / 1.6);
    const fade = s.age > 16.5 ? Math.max(0, 1 - (s.age - 16.5) / 2.5) : 1;
    return 4.4 * grow * (0.4 + 0.6 * fade);
  }
  private updateSmokes(dt: number) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      const grow = 1 - Math.pow(1 - Math.min(1, s.age / 1.6), 3);
      const fade = s.age > 16.5 ? Math.max(0, 1 - (s.age - 16.5) / 2.5) : 1;
      s.mat.opacity = 0.95 * fade;
      for (const p of s.puffs) {
        const drift = Math.sin(s.age * 0.35 + p.off.x) * 0.25;
        p.s.position.set(p.off.x * grow + drift, p.off.y * (0.4 + 0.6 * grow), p.off.z * grow);
        const sz = p.size * (0.35 + 0.65 * grow) * (1 + (1 - fade) * 0.4);
        p.s.scale.set(sz, sz, 1);
      }
      if (s.age >= 19) { s.group.removeFromParent(); s.mat.dispose(); this.smokes.splice(i, 1); }
    }
  }
  /** Does any live smoke cloud cut the segment a→b? */
  sightBlocked(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const s of this.smokes) {
      const r = this.smokeRadius(s) * 0.92;
      if (r < 0.6) continue;
      const cx = s.pos.x, cy = s.pos.y + 1.7, cz = s.pos.z;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len2 = dx * dx + dy * dy + dz * dz || 1;
      let t = ((cx - a.x) * dx + (cy - a.y) * dy + (cz - a.z) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t - cx, py = (a.y + dy * t - cy) * 1.35, pz = a.z + dz * t - cz;
      if (px * px + py * py + pz * pz < r * r) return true;
    }
    return false;
  }
  /** 0..1 — how deep inside a smoke cloud this point is (HUD whiteout). */
  smokeDensityAt(p: THREE.Vector3): number {
    let best = 0;
    for (const s of this.smokes) {
      const r = this.smokeRadius(s);
      if (r < 0.5) continue;
      const d = Math.hypot(p.x - s.pos.x, (p.y - (s.pos.y + 1.7)) * 1.35, p.z - s.pos.z);
      best = Math.max(best, THREE.MathUtils.clamp((r - d) / (r * 0.55), 0, 1));
    }
    return best;
  }

  // =====================================================================
  // MAIN UPDATE
  // =====================================================================
  update(dt: number, input: { interact: boolean }) {
    const m = this.match;
    for (const tr of m.tick(dt)) this.onTransition(tr);
    if (m.phase === 'live' || m.phase === 'planted') this.roundTime += dt;
    if (this.banner) { this.banner.ttl -= dt; if (this.banner.ttl <= 0) this.banner = null; }
    this.tick++;
    const frozen = m.phase === 'freeze' || m.phase === 'halftime' || m.phase === 'ended';
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      b.updateVisualFrame(dt);
      if (!frozen && (i + this.tick) % 2 === 0) b.updateLogic(dt * 2);
    }
    if (!frozen) {
      this.planT -= dt;
      if (this.planT <= 0) { this.planT = 0.2; this.updatePlans(); }
      this.updateLoot();
    }
    this.updateBomb(dt, input);
    this.updateSmokes(dt);
    this.spotT -= dt;
    if (this.spotT <= 0) { this.spotT = 0.2; this.updateSpotting(); }
    if (m.phase === 'live' && m.clock < 10.5 && !this.announcedTen && this.bomb.state !== 'planted') {
      this.announcedTen = true;
      this.ctx.onCallout('Ten seconds left in the round!');
    }
  }

  private updateBomb(dt: number, input: { interact: boolean }) {
    const b = this.bomb;
    const m = this.match;
    const p = this.player;
    if (b.state === 'carried' && b.carrier) {
      const c = b.carrier;
      if (c.isPlayer) {
        const feet = this.ctx.playerFeet();
        const onSite = siteAt(feet.x, feet.z);
        if (input.interact && p.alive && onSite && m.phase === 'live') {
          if (b.planter !== p) { b.planter = p; b.plantT = 0; b.keyT = 0; }
          b.plantT += dt;
          b.keyT -= dt;
          if (b.keyT <= 0) { b.keyT = 0.42; audio.c4Key(Math.floor(b.plantT * 3)); }
          if (b.plantT >= TIMING.plant) this.plantBomb(p, feet);
        } else if (b.planter === p) { b.planter = null; b.plantT = 0; }
      } else if (c.bot && c.alive) {
        const plan = this.plans.get(c.bot);
        const bot = c.bot;
        const spot = plan?.task === 'plant' && plan.hold && this.roundTime >= plan.t ? plan.hold.at : null;
        if (spot && m.phase === 'live' && d2(bot.pos, spot[0], spot[1]) < 1.0 && siteAt(bot.pos.x, bot.pos.z)) {
          if (b.planter !== c) { b.planter = c; b.plantT = 0; b.keyT = 0; }
          b.plantT += dt;
          b.keyT -= dt;
          if (b.keyT <= 0) { b.keyT = 0.42; if (bot.pos.distanceTo(this.ctx.playerFeet()) < 18) audio.c4Key(Math.floor(b.plantT * 3)); }
          if (b.plantT >= TIMING.plant) this.plantBomb(c, bot.pos.clone());
        } else if (b.planter === c) { b.planter = null; b.plantT = 0; }
      }
    } else if (b.state === 'dropped') {
      // Attackers auto-pick the bomb up by walking over it.
      this.bombTossT = Math.max(0, this.bombTossT - dt);
      for (const c of this.aliveOn('attack')) {
        if (c.isPlayer && this.bombTossT > 0) continue;
        if (d2(this.posOf(c), b.pos.x, b.pos.z) < 1.15) {
          this.giveBomb(c);
          if (c.isPlayer) { audio.pickup(); this.ctx.onRadio('You picked up the bomb.'); }
          else if (this.playerSide === 'attack') this.ctx.onRadio(`${c.name} has the bomb.`);
          break;
        }
      }
    } else if (b.state === 'planted') {
      const left = m.clock;
      // Beeps accelerate from ~1 per second to a continuous chirp.
      b.beepT -= dt;
      const interval = left > 10 ? 0.35 + 0.65 * Math.min(1, (left - 10) / 30) : left > 5 ? 0.24 : left > 2 ? 0.13 : 0.075;
      if (b.beepT <= 0 && left > 1.05) {
        b.beepT = interval;
        audio.c4Beep(b.pos.x, b.pos.y + 0.2, b.pos.z, 1 - left / TIMING.bomb);
        this.ledOn = 0.09;
      }
      if (left <= 1.05 && !b.whined) { b.whined = true; audio.c4Whine(b.pos.x, b.pos.y, b.pos.z); }
      this.ledOn = Math.max(0, this.ledOn - dt);
      const lit = this.ledOn > 0 || left < 1.05;
      this.c4World.led.visible = lit;
      this.c4Light.intensity = lit ? 3.2 : 0.25;
      this.c4Glow.visible = lit;
      // Defusing.
      if (m.phase === 'planted') {
        const pf = this.ctx.playerFeet();
        const playerTrying = input.interact && p.alive && this.playerSide === 'defend' && d2(pf, b.pos.x, b.pos.z) < 1.7;
        if (playerTrying && (!b.defuser || b.defuser === p)) {
          if (b.defuser !== p) { b.defuser = p; b.defuseT = 0; b.keyT = 0; }
        } else if (b.defuser === p) { b.defuser = null; b.defuseT = 0; }
        if (!b.defuser) {
          for (const c of this.aliveOn('defend')) {
            if (!c.bot) continue;
            const plan = this.plans.get(c.bot);
            if (plan?.task === 'defuse' && this.roundTime >= plan.t && d2(c.bot.pos, b.pos.x, b.pos.z) < 1.25) { b.defuser = c; b.defuseT = 0; b.keyT = 0; break; }
          }
        }
        if (b.defuser) {
          const c = b.defuser;
          const stillThere = c.alive && d2(this.posOf(c), b.pos.x, b.pos.z) < 1.9 && (c.isPlayer || this.plans.get(c.bot!)?.task === 'defuse');
          if (!stillThere) { b.defuser = null; b.defuseT = 0; }
          else {
            b.defuseT += dt;
            b.keyT -= dt;
            if (b.keyT <= 0) { b.keyT = 0.5; if (c.isPlayer || c.bot!.pos.distanceTo(pf) < 15) audio.defuseTick(); }
            if (b.defuseT >= (c.inv.kit ? TIMING.defuseKit : TIMING.defuse)) this.defuseBomb(c);
          }
        }
      }
    }
  }

  /** Bots walking over a better gun take it; early in the round they detour for one. */
  private updateLoot() {
    if (!this.drops.length) return;
    for (const c of this.players) {
      if (!c.bot || !c.alive) continue;
      const d = this.nearestDrop(c.bot.pos, 1.35);
      if (!d) continue;
      const item = shopItem(d.weapon)!;
      const cur = item.kind === 'primary' ? c.inv.primary : c.inv.secondary;
      const curPrice = cur ? shopItem(cur)?.price ?? 0 : 0;
      if (item.price > curPrice && !(c.role !== 'awper' && d.weapon === 'awm' && cur)) {
        this.takeDrop(c, d);
        const plan = this.plans.get(c.bot);
        if (plan?.task === 'loot') { plan.task = plan.resume ?? 'hold'; plan.resume = null; plan.lootAt = null; }
      }
    }
  }

  private updateSpotting() {
    this.spotted.clear();
    for (const c of this.players) {
      if (!c.bot || !c.alive || c.team !== 'bravo') continue;
      const seen = this.players.some(a => a.team === 'alpha' && a.alive && a.bot && a.bot.seesEnemy() && a.bot.targetBot === c.bot)
        || (this.player.alive && this.ctx.playerCanSee(c.bot.eyePos()));
      if (seen) this.spotted.add(c.bot);
    }
  }
  /** Enemies currently visible to you or your team (radar). */
  spottedEnemies(): TDMBot[] { return [...this.spotted].filter(b => !b.dead); }

  // =====================================================================
  // DIRECTOR — plans, goals and team logic
  // =====================================================================
  private newPlan(task: Task, extra: Partial<BotPlan> = {}): BotPlan {
    return { task, route: [], stageLeft: 0, lane: null, hold: null, anchor: false, post: null, smokeAt: null, speed: 4.4, t: 0, resume: null, lootAt: null, lookAt: null, lookT: 0, ...extra };
  }

  private planRound(keepAttack = false) {
    this.plans.clear();
    this.executing = false;
    this.stagedSince = -1;
    const atkTeam = this.match.teamOf('attack');
    if (!keepAttack) this.attack = pickAttackPlan(this.rng, this.buyCalls[atkTeam], this.lastSite);
    this.assignAttack(false);
    this.defense = pickDefenseSetup(this.rng, this.lastLossSite);
    this.assignDefense();
  }

  /** Lane sheet for a plan. Index 0 is given to the bomb carrier's lane group. */
  private lanesFor(plan: AttackPlan): Lane[] {
    const a = plan.site === 'A';
    switch (plan.style) {
      case 'rush': return a ? ['long', 'long', 'long', 'long', 'long'] : ['tunnels', 'tunnels', 'tunnels', 'tunnels', 'tunnels'];
      case 'split': return a ? ['long', 'short', 'long', 'short', 'long'] : ['tunnels', 'window', 'tunnels', 'window', 'tunnels'];
      case 'fake': return a ? ['short', 'long', 'short', 'tunnels', 'tunnels'] : ['tunnels', 'window', 'tunnels', 'long', 'long'];
      case 'default': return ['mid', 'long', 'tunnels', 'window', 'short'];
      default: return a ? ['short', 'long', 'long', 'short', 'long'] : ['tunnels', 'tunnels', 'window', 'tunnels', 'window'];
    }
  }

  private routeFor(site: SiteId, lane: Lane): { points: Vec2[]; stage: number; lane: Lane } {
    const r = ATTACK_ROUTES.find(x => x.site === site && x.lane === lane)
      ?? ATTACK_ROUTES.find(x => x.site === site)!;
    return { points: r.points.map(p => [p[0], p[1]] as Vec2), stage: r.stage, lane: r.lane };
  }

  /** (Re)assign every attacking bot. `fromHere` trims routes to the bot's position. */
  private assignAttack(fromHere: boolean) {
    const bots = this.botsOn('attack');
    if (!bots.length) return;
    const carrierBot = this.bomb.carrier?.bot ?? null;
    const ordered = carrierBot && bots.includes(carrierBot) ? [carrierBot, ...bots.filter(b => b !== carrierBot)] : bots;
    const lanes = this.lanesFor(this.attack);
    const smokeTargets = [...SITES[this.attack.site].execSmokes];
    const fakeSite: SiteId = this.attack.site === 'A' ? 'B' : 'A';
    this.executing = false;
    this.stagedSince = -1;
    this.defaultDecideAt = this.roundTime + 18 + this.rng() * 10;
    ordered.forEach((bot, i) => {
      const c = this.byBot(bot);
      let lane = lanes[i % lanes.length];
      if (bot === carrierBot && this.attack.style === 'fake') lane = lanes[0];
      if (this.attack.style === 'default' && !fromHere) {
        const spot = CONTROL_SPOTS.find(s => s.lane === lane) ?? CONTROL_SPOTS[1];
        this.plans.set(bot, this.newPlan('hold', { hold: { at: spot.at, face: spot.face }, lane, speed: 4.3 }));
        return;
      }
      const isFake = this.attack.style === 'fake' && i >= 3;
      const site = isFake ? fakeSite : this.attack.site;
      const r = this.routeFor(site, lane);
      let pts = r.points, stage = r.stage;
      if (fromHere) {
        // Start from the waypoint nearest the bot, never walking back toward spawn.
        let bi = 0, bd = Infinity;
        pts.forEach((p, k) => { const dd = d2(bot.pos, p[0], p[1]); if (dd < bd) { bd = dd; bi = k; } });
        pts = pts.slice(bi); stage -= bi;
      }
      const smoke = c.inv.smokes > 0 && smokeTargets.length && !isFake ? smokeTargets.shift()! : null;
      this.plans.set(bot, this.newPlan('route', {
        route: pts, stageLeft: this.attack.style === 'rush' ? -1 : stage, lane: r.lane,
        speed: this.attack.style === 'rush' ? 5.2 : 4.5, smokeAt: smoke, anchor: false,
      }));
    });
    if (this.playerSide === 'attack' && !fromHere) {
      const names: Record<AttackStyle, string> = { exec: 'EXECUTE', rush: 'RUSH', split: 'SPLIT', default: 'DEFAULT', fake: 'FAKE' };
      this.ctx.onRadio(`Team plan: ${names[this.attack.style]} ${this.attack.style === 'default' ? '— spread for map control' : this.attack.site}.`);
    }
  }

  private assignDefense() {
    const bots = this.botsOn('defend');
    let posts = [...DEFENSE_SETUPS[this.defense]];
    if (this.playerSide === 'defend') posts = posts.filter(p => p !== 'MID_DOORS' && p !== 'LONG_PUSH').slice(0, bots.length);
    // AWPers take the long sightlines first.
    const awper = bots.find(b => this.byBot(b).inv.primary === 'awm');
    const order = awper ? [awper, ...bots.filter(b => b !== awper)] : bots;
    const pool = [...posts];
    order.forEach(bot => {
      let id: PostId | undefined;
      if (bot === awper) id = pool.find(p => p === 'A_LONG' || p === 'MID' || p === 'B_TUNNEL');
      id = id ?? pool[0];
      if (!id) id = 'B_ANCHOR';
      pool.splice(pool.indexOf(id), 1);
      const post = DEFENSE_POSTS[id];
      this.plans.set(bot, this.newPlan('hold', { hold: { at: post.at, face: post.face, crouch: post.anchor && this.rng() < 0.4 }, post: id, anchor: post.anchor, speed: 4.6 }));
    });
  }

  private startExecute() {
    if (this.executing) return;
    this.executing = true;
    const site = this.attack.site;
    for (const bot of this.botsOn('attack')) {
      const plan = this.plans.get(bot);
      if (!plan) continue;
      if (plan.task === 'stage') plan.task = 'route';
      const c = this.byBot(bot);
      if (plan.smokeAt && c.inv.smokes > 0) {
        this.ctx.throwGrenade(bot.eyePos(), V(plan.smokeAt[0], plan.smokeAt[1]), bot, 'smoke');
        c.inv = { ...c.inv, smokes: c.inv.smokes - 1 };
        plan.smokeAt = null;
      } else if (c.inv.flashes > 0 && bot.flashes > 0 && this.rng() < 0.45 && d2(bot.pos, SITES[site].center[0], SITES[site].center[1]) < 32) {
        bot.flashes--;
        c.inv = { ...c.inv, flashes: Math.max(0, c.inv.flashes - 1) };
        this.ctx.throwGrenade(bot.eyePos(), V(SITES[site].center[0], SITES[site].center[1]), bot, 'flash');
      }
    }
    if (this.playerSide === 'attack') this.ctx.onRadio(`Executing ${site} — go, go, go!`);
  }

  /** Called when the bomb lands on a site. */
  private onPlanted(site: SiteId) {
    const s = SITES[site];
    const spots = [...s.postPlant];
    for (const bot of this.botsOn('attack')) {
      const plan = this.plans.get(bot) ?? this.newPlan('hold');
      if (this.followPlayer && bot.team === 'alpha') continue;
      let bi = 0, bd = Infinity;
      spots.forEach((sp, k) => { const dd = d2(bot.pos, sp.at[0], sp.at[1]); if (dd < bd) { bd = dd; bi = k; } });
      const sp = spots.splice(bi, 1)[0] ?? s.postPlant[0];
      plan.task = 'hold'; plan.hold = { at: sp.at, face: sp.face, crouch: this.rng() < 0.5 }; plan.anchor = true; plan.speed = 4.8;
      this.plans.set(bot, plan);
    }
    // Defenders: every living bot converges on the retake stage.
    this.retakeGoT = this.roundTime + 7;
    for (const bot of this.botsOn('defend')) {
      const plan = this.plans.get(bot) ?? this.newPlan('hold');
      if (this.followPlayer && bot.team === 'alpha') continue;
      const stage = s.retakeStage.reduce((a, b) => (d2(bot.pos, a[0], a[1]) < d2(bot.pos, b[0], b[1]) ? a : b));
      plan.task = 'retakeStage'; plan.hold = { at: stage, face: s.center }; plan.anchor = false; plan.speed = 5.2;
      plan.route = [...s.retakeClear].sort((a, b) => d2(V(stage[0], stage[1]), a[0], a[1]) - d2(V(stage[0], stage[1]), b[0], b[1]));
      this.plans.set(bot, plan);
    }
    if (this.playerSide === 'defend') this.ctx.onRadio(`Bomb is down on ${site} — group up and retake!`);
    else this.ctx.onRadio(`Bomb planted on ${site} — hold your angles.`);
  }

  /** Send `count` defenders (closest non-anchors first) to hold a site. */
  private rotate(site: SiteId, count: number, force = false) {
    if (this.rotatedTo === site && !force) return;
    this.rotatedTo = site;
    const s = SITES[site];
    const postSite = (b: TDMBot) => { const p = this.plans.get(b); return p?.post ? DEFENSE_POSTS[p.post].site : 'mid'; };
    const otherSite: SiteId = site === 'A' ? 'B' : 'A';
    const away = this.botsOn('defend').filter(b => this.plans.has(b) && postSite(b) !== site && this.plans.get(b)!.task !== 'follow')
      .sort((a, b) => d2(a.pos, s.center[0], s.center[1]) - d2(b.pos, s.center[0], s.center[1]));
    // Unless ordered, one anchor always stays home on the other site.
    let otherLeft = away.filter(b => postSite(b) === otherSite).length;
    const keep = force ? 0 : 1;
    const chosen: TDMBot[] = [];
    for (const b of away) {
      if (chosen.length >= count) break;
      if (postSite(b) === otherSite) { if (otherLeft <= keep) continue; otherLeft--; }
      chosen.push(b);
    }
    const posts = (Object.values(DEFENSE_POSTS)).filter(p => p.site === site && p.id !== 'LONG_PUSH');
    chosen.forEach((bot, i) => {
      const plan = this.plans.get(bot)!;
      const post = posts[i % posts.length];
      const off = i >= posts.length ? 1.6 : 0;
      plan.task = 'rotate'; plan.post = post.id; plan.anchor = false;
      plan.hold = { at: [post.at[0] + off, post.at[1] + off], face: post.face }; plan.speed = 5.3;
    });
    if (this.playerSide === 'defend' && !force) this.ctx.onRadio(`They're hitting ${site} — rotating!`);
  }

  /** A defender already on the hit site smokes the attackers' choke to buy rotation time. */
  private delaySmoke(site: SiteId) {
    const choke: Vec2 = site === 'A' ? [-34.5, -12] : [36.5, -11];
    for (const bot of this.botsOn('defend')) {
      const c = this.byBot(bot);
      if (c.inv.smokes <= 0 || d2(bot.pos, SITES[site].center[0], SITES[site].center[1]) > 16) continue;
      this.ctx.throwGrenade(bot.eyePos(), V(choke[0], choke[1]), bot, 'smoke');
      c.inv = { ...c.inv, smokes: c.inv.smokes - 1 };
      return;
    }
  }

  private siteNear(p: THREE.Vector3, approachOnly = false): SiteId | null {
    for (const id of ['A', 'B'] as SiteId[]) {
      const s = SITES[id];
      if (!approachOnly && inRect(p.x, p.z, s.zone, 4)) return id;
      if (s.approach.some(r => inRect(p.x, p.z, r))) return id;
    }
    return null;
  }

  private report(key: string, text: string, cooldown = 7) {
    const now = this.roundTime;
    if ((this.reportCooldown.get(key) ?? -99) > now) return;
    this.reportCooldown.set(key, now + cooldown);
    this.ctx.onRadio(text);
  }

  private updatePlans() {
    const m = this.match;
    const live = m.phase === 'live';
    const planted = this.bomb.state === 'planted' && m.phase === 'planted';
    for (const s of ['A', 'B'] as SiteId[]) this.threat[s] *= 0.93;

    // ---- intel: what the defenders see ----
    for (const c of this.players) {
      if (!c.bot || !c.alive || this.sideOf(c) !== 'defend' || !c.bot.seesEnemy()) continue;
      const tf = c.bot.targetFeet;
      if (!tf) continue;
      const site = this.siteNear(tf);
      if (site) {
        const carrier = this.bomb.carrier && this.bomb.state === 'carried' && d2(this.posOf(this.bomb.carrier), tf.x, tf.z) < 2;
        this.threat[site] += carrier ? 0.9 : 0.35;
      }
    }
    // ally callouts for the player's team
    for (const c of this.players) {
      if (c.team !== 'alpha' || !c.bot || !c.alive || !c.bot.seesEnemy()) continue;
      const tf = c.bot.targetFeet;
      if (!tf) continue;
      const zone = siroccoZoneAt(tf.x, tf.z);
      this.report(`spot-${zone}`, `${c.name}: Contact — ${zone}!`, 9);
    }

    // ---- eco scavenging: gunless bots grab a nearby dropped primary early on ----
    if (live && this.roundTime < 40 && this.drops.length) {
      for (const c of this.players) {
        if (!c.bot || !c.alive || c.inv.primary || c.bot.seesEnemy()) continue;
        const plan = this.plans.get(c.bot);
        if (!plan || plan.task === 'loot' || plan.task === 'plant' || plan.task === 'getbomb' || plan.task === 'follow') continue;
        const d = this.drops.find(x => shopItem(x.weapon)?.kind === 'primary' && d2(c.bot!.pos, x.pos.x, x.pos.z) < 10);
        if (d) { plan.resume = plan.task; plan.task = 'loot'; plan.lootAt = d.pos.clone(); }
      }
    }
    for (const c of this.players) {
      const plan = c.bot ? this.plans.get(c.bot) : null;
      if (plan?.task === 'loot' && plan.lootAt && !this.drops.some(x => x.pos.distanceTo(plan.lootAt!) < 0.1)) {
        plan.task = plan.resume ?? 'hold'; plan.resume = null; plan.lootAt = null;
        if (plan.task === 'route' && !plan.route.length) plan.task = 'hold';
        if (plan.task === 'hold' && !plan.hold) plan.hold = { at: [c.bot!.pos.x, c.bot!.pos.z], face: [0, 0] };
      }
    }

    // ---- attackers ----
    if (live && this.bomb.state !== 'planted') {
      const atkBots = this.botsOn('attack');
      // Dropped bomb: the nearest attacking bot fetches it.
      if (this.bomb.state === 'dropped') {
        // Leave it to the player only while they are standing on it and it just hit the floor.
        const playerCloser = this.playerSide === 'attack' && this.player.alive && this.roundTime - this.bombDroppedAt < 3
          && d2(this.ctx.playerFeet(), this.bomb.pos.x, this.bomb.pos.z) < 2.5;
        let best: TDMBot | null = null, bd = Infinity;
        for (const b of atkBots) { const dd = d2(b.pos, this.bomb.pos.x, this.bomb.pos.z); if (dd < bd) { bd = dd; best = b; } }
        if (best && !playerCloser) {
          const plan = this.plans.get(best);
          if (plan && plan.task !== 'getbomb') { plan.resume = plan.task; plan.task = 'getbomb'; }
        }
      }
      // Default: hold map control, then commit to the site where the info is.
      if (this.attack.style === 'default' && this.roundTime > this.defaultDecideAt && !this.executing) {
        const site: SiteId = this.threat.A < this.threat.B ? 'A' : this.threat.B < this.threat.A ? 'B' : (this.rng() < 0.5 ? 'A' : 'B');
        this.attack = { site, style: 'exec' };
        this.assignAttack(true);
        if (this.playerSide === 'attack') this.ctx.onRadio(`Calling it — ${site}!`);
      }
      // Stage → execute.
      if (!this.executing && this.attack.style !== 'default') {
        let pending = 0, staged = 0;
        for (const b of atkBots) {
          const p = this.plans.get(b);
          if (!p) continue;
          if (p.task === 'stage') staged++;
          else if (p.task === 'route' && p.stageLeft > 0) pending++;
        }
        if (staged && this.stagedSince < 0) this.stagedSince = this.roundTime;
        const waited = this.stagedSince >= 0 && this.roundTime - this.stagedSince > 11;
        if ((staged && pending === 0) || waited || m.clock < 42 || this.attack.style === 'rush') this.startExecute();
      }
      // Carrier: once in the site with the team, go plant.
      const carrier = this.bomb.state === 'carried' ? this.bomb.carrier : null;
      if (carrier?.bot && carrier.alive) {
        const plan = this.plans.get(carrier.bot)!;
        const inSite = siteAt(carrier.bot.pos.x, carrier.bot.pos.z);
        const rushPlant = m.clock < 28;
        if (plan.task !== 'plant' && plan.task !== 'getbomb' && (inSite || rushPlant) && (this.executing || rushPlant)) {
          const site = inSite ?? this.attack.site;
          const spots = SITES[site].plantSpots;
          const spot = spots.reduce((a, b) => (d2(carrier.bot!.pos, a[0], a[1]) < d2(carrier.bot!.pos, b[0], b[1]) ? a : b));
          plan.task = 'plant'; plan.hold = { at: spot, face: SITES[site].center }; plan.speed = 4.8;
        }
      }
    }

    // ---- defenders ----
    if (live && this.bomb.state !== 'planted') {
      for (const s of ['A', 'B'] as SiteId[]) {
        if (this.threat[s] >= 1.6 && this.rotatedTo !== s) { this.rotate(s, this.threat[s] > 3 ? 3 : 2); this.delaySmoke(s); }
      }
    }
    if (planted) {
      const s = SITES[this.bomb.site!];
      const defs = this.botsOn('defend');
      const staged = defs.filter(b => this.plans.get(b)?.task === 'retakeStage' && d2(b.pos, this.plans.get(b)!.hold!.at[0], this.plans.get(b)!.hold!.at[1]) < 2.5).length;
      const need = Math.min(2, defs.length);
      const timeLeft = m.clock;
      if (this.retakeGoT > 0 && (staged >= need || this.roundTime > this.retakeGoT || timeLeft < 22)) {
        this.retakeGoT = -1;
        let smoked = false;
        for (const b of defs) {
          const plan = this.plans.get(b);
          if (plan?.task === 'retakeStage') plan.task = 'retake';
          const c = this.byBot(b);
          if (!smoked && c.inv.smokes > 0) {
            smoked = true;
            this.ctx.throwGrenade(b.eyePos(), V(s.retakeSmoke[0], s.retakeSmoke[1]), b, 'smoke');
            c.inv = { ...c.inv, smokes: c.inv.smokes - 1 };
          }
        }
        if (this.playerSide === 'defend') this.ctx.onRadio('Retaking — go in together!');
      }
      // Pick a defuser: closest bot that can still make it, once the site is quiet or time is short.
      if (!this.bomb.defuser) {
        let best: TDMBot | null = null, bd = Infinity;
        for (const b of defs) {
          const c = this.byBot(b);
          const t = c.inv.kit ? TIMING.defuseKit : TIMING.defuse;
          const dist = d2(b.pos, this.bomb.pos.x, this.bomb.pos.z);
          const arrive = dist / 5;
          const plan = this.plans.get(b)!;
          if (plan.task === 'flee') continue;
          if (timeLeft < t + arrive * 0.6 + 0.2) { plan.task = 'flee'; continue; }
          const quiet = b.sinceSeen > 2.5;
          const desperate = timeLeft < t + arrive + 3;
          if ((plan.task === 'retake' || plan.task === 'defuse') && (quiet || desperate) && dist < bd) { bd = dist; best = b; }
        }
        if (best) {
          for (const b of defs) { const p = this.plans.get(b)!; if (p.task === 'defuse' && b !== best) p.task = 'retake'; }
          this.plans.get(best)!.task = 'defuse';
        }
      }
    }
  }

  private idleGoal(bot: TDMBot): BotGoal | null {
    const plan = this.plans.get(bot);
    if (!plan) return null;
    const m = this.match;
    const c = this.byBot(bot);
    if (m.phase === 'freeze') return { at: bot.pos.clone(), hold: true };
    // Follow orders beat everything but the objective actions.
    if (plan.task === 'follow' && this.player.alive) {
      const f = this.ctx.playerFeet();
      const idx = this.players.filter(x => x.team === 'alpha' && x.bot).indexOf(c);
      const ang = Math.PI + (idx - 1.5) * 0.7;
      const at = V(f.x + Math.sin(ang) * 2.6, f.z + Math.cos(ang) * 2.6);
      const near = d2(bot.pos, f.x, f.z) < 4.2;
      return { at, speed: near ? 3 : 5.2, hold: near, face: near ? V(f.x * 2 - bot.pos.x, f.z * 2 - bot.pos.z) : null };
    }
    switch (plan.task) {
      case 'route': {
        const r = plan.route;
        while (r.length > 1 && (d2(bot.pos, r[0][0], r[0][1]) < 2.2 || d2(bot.pos, r[1][0], r[1][1]) < Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) * 0.85)) {
          r.shift(); plan.stageLeft--;
        }
        if (!this.executing && plan.stageLeft <= 0 && plan.stageLeft > -1 && this.attack.style !== 'rush' && m.clock > 42) {
          const next = r[1] ?? SITES[this.attack.site].center;
          plan.task = 'stage';
          plan.hold = { at: r[0], face: next };
          return { at: V(r[0][0], r[0][1]), hold: true, face: V(next[0], next[1]) };
        }
        if (r.length === 1 && d2(bot.pos, r[0][0], r[0][1]) < 2.2) {
          // Arrived on site: take a clearing spot inside it.
          const site = siteAt(r[0][0], r[0][1]) ?? this.attack.site;
          const spots = SITES[site].postPlant;
          const sp = spots[(this.bots.indexOf(bot) + this.match.round) % spots.length];
          plan.task = 'hold'; plan.hold = { at: sp.at, face: sp.face }; plan.anchor = false;
        }
        return { at: V(r[0][0], r[0][1]), speed: plan.speed };
      }
      case 'stage':
      case 'hold':
      case 'rotate':
      case 'retakeStage': {
        const h = plan.hold!;
        if (plan.task === 'rotate' && d2(bot.pos, h.at[0], h.at[1]) < 1.2) { plan.task = 'hold'; plan.anchor = true; }
        let at = V(h.at[0], h.at[1]);
        // Never hold an angle from inside a smoke: back off toward the face-away side.
        if (this.smokes.length && this.smokeDensityAt(new THREE.Vector3(at.x, 1.6, at.z)) > 0.2) {
          const away = new THREE.Vector3(at.x - h.face[0], 0, at.z - h.face[1]).normalize();
          at = at.addScaledVector(away, 5.5);
          const [cx, cz] = this.nav.nearestFree(this.nav.toCell(at.x), this.nav.toCell(at.z));
          at.set(this.nav.toWorld(cx), 0, this.nav.toWorld(cz));
        }
        const face = plan.lookAt && this.roundTime < plan.lookT ? plan.lookAt.clone() : V(h.face[0], h.face[1]);
        return { at, hold: true, face, crouch: h.crouch, speed: plan.speed };
      }
      case 'plant': {
        const h = plan.hold!;
        return { at: V(h.at[0], h.at[1]), hold: true, face: V(h.face[0], h.face[1]), crouch: true, speed: plan.speed };
      }
      case 'getbomb': {
        if (this.bomb.state !== 'dropped') { plan.task = plan.resume ?? 'route'; plan.resume = null; if (plan.task === 'route' && !plan.route.length) plan.task = 'hold'; return null; }
        return { at: this.bomb.pos.clone(), speed: 5.3 };
      }
      case 'loot': {
        if (!plan.lootAt) { plan.task = plan.resume ?? 'hold'; return null; }
        return { at: plan.lootAt.clone(), speed: 5 };
      }
      case 'retake': {
        const r = plan.route;
        while (r.length > 1 && d2(bot.pos, r[0][0], r[0][1]) < 2) r.shift();
        const tgt = r[0] ?? SITES[this.bomb.site ?? 'A'].center;
        return { at: V(tgt[0], tgt[1]), speed: 4.6, hold: r.length <= 1 && d2(bot.pos, tgt[0], tgt[1]) < 1.5, face: this.bomb.pos.clone() };
      }
      case 'defuse':
        return { at: this.bomb.pos.clone(), speed: 5.2, hold: d2(bot.pos, this.bomb.pos.x, this.bomb.pos.z) < 0.9, crouch: true, face: this.bomb.pos.clone() };
      case 'flee': {
        const home = SPAWNS[this.sideOf(c)][this.bots.indexOf(bot) % 5];
        return { at: V(home[0], home[1]), speed: 5.6, hold: d2(bot.pos, home[0], home[1]) < 1.5, face: this.bomb.pos.clone() };
      }
      case 'hunt':
        return { at: bot.lastKnownEnemy?.clone() ?? V(0, 0), speed: 4.6 };
    }
    return null;
  }

  /** Debug: the director's current task for a bot (sim/diagnostics). */
  debugTask(bot: TDMBot): string {
    const p = this.plans.get(bot);
    return p ? `${p.task}${p.hold ? `→${p.hold.at[0].toFixed(0)},${p.hold.at[1].toFixed(0)}` : p.route[0] ? `→${p.route[0][0].toFixed(0)},${p.route[0][1].toFixed(0)}` : ''}` : 'none';
  }

  private mayChase(bot: TDMBot): boolean {
    const plan = this.plans.get(bot);
    if (!plan) return true;
    if (plan.anchor) return false;
    return plan.task === 'route' || plan.task === 'rotate' || plan.task === 'retake' || plan.task === 'follow' || plan.task === 'hunt';
  }

  private isBusy(bot: TDMBot): boolean {
    const c = this.byBot(bot);
    const plan = this.plans.get(bot);
    if (this.bomb.planter === c && this.bomb.plantT > 0) {
      // Shot while arming → abandon the plant, fight for a few seconds, then retry.
      if (bot.hp < bot.maxHp && bot.sinceSeen < 0.4 && this.rng() < 0.02) {
        this.bomb.planter = null; this.bomb.plantT = 0;
        if (plan) plan.t = this.roundTime + 3.5;
        return false;
      }
      return true;
    }
    if (this.bomb.defuser === c && this.bomb.defuseT > 0) {
      const t = c.inv.kit ? TIMING.defuseKit : TIMING.defuse;
      const spare = this.match.clock - (t - this.bomb.defuseT);
      if (bot.seesEnemy() && bot.sinceSeen < 0.3 && spare > 4 && this.rng() < 0.03) {
        this.bomb.defuser = null; this.bomb.defuseT = 0;
        if (plan) plan.t = this.roundTime + 3;
        return false;
      }
      return true;
    }
    return false;
  }

  private botCallout(kind: string, pos: THREE.Vector3, team: TDMTeam) {
    if (team !== 'bravo') return;
    if (pos.distanceTo(this.ctx.playerFeet()) > 40) return;
    const labels: Record<string, string> = { grenade: 'Frag out!', push: 'They are pushing!', flank: 'Hostiles flanking!', fallback: 'They are falling back!' };
    if (labels[kind]) this.ctx.onCallout(labels[kind]);
  }

  private setBanner(kind: DefusalBanner['kind'], title: string, sub: string | undefined, team: TeamId | undefined, side: Side | undefined, ttl: number, mvp?: string) {
    this.banner = { id: ++this.bannerSeq, kind, title, sub, team, side, ttl, mvp };
  }

  // =====================================================================
  // HUD / RESULTS
  // =====================================================================
  playerPrompt(): string | null {
    const p = this.player;
    if (!p.alive) return null;
    const m = this.match;
    const f = this.ctx.playerFeet();
    if (this.bomb.state === 'carried' && this.bomb.carrier === p) {
      const s = siteAt(f.x, f.z);
      if (s && m.phase === 'live') return this.bomb.planter === p ? `PLANTING ON ${s}…` : `HOLD X — PLANT THE BOMB ON ${s}`;
    }
    if (this.bomb.state === 'planted' && this.playerSide === 'defend' && d2(f, this.bomb.pos.x, this.bomb.pos.z) < 1.7) {
      return this.bomb.defuser === p ? `DEFUSING${p.inv.kit ? ' WITH KIT' : ''}…` : `HOLD X — DEFUSE${p.inv.kit ? ' (KIT: 5s)' : ' (10s — BUY A KIT)'}`;
    }
    const d = this.nearestDrop(f, 1.9);
    if (d) return `X — PICK UP ${shopItem(d.weapon)?.name.toUpperCase() ?? d.weapon}`;
    if (this.canBuyNow() && m.phase === 'freeze') return 'B — OPEN BUY MENU';
    return null;
  }

  private roster(): DefusalRosterEntry[] {
    return this.players.map(c => {
      const side = this.sideOf(c);
      const mine = c.team === 'alpha';
      const wid = c.inv.primary ?? c.inv.secondary;
      return {
        id: c.id, name: c.name, team: c.team, side, alive: c.alive,
        hp: c.alive ? Math.round(c.isPlayer ? this.ctx.playerHp() : Math.max(0, c.bot!.hp)) : 0,
        money: mine ? c.inv.money : null,
        kills: c.kills, deaths: c.deaths, assists: c.assists, mvps: c.mvps, headshots: c.headshots, damage: Math.round(c.damage),
        score: combatScore(c),
        weapon: mine || !c.alive ? (shopItem(wid)?.name ?? wid) : null,
        armor: c.inv.armor, kit: c.inv.kit,
        bomb: mine && this.bomb.state === 'carried' && this.bomb.carrier === c,
        you: c.isPlayer, value: inventoryValue(c.inv),
      };
    });
  }

  hud(): DefusalHud {
    const m = this.match;
    const H = SIROCCO_HALF;
    const nx = (x: number) => (x + H) / (2 * H);
    const b = this.bomb;
    const knowBomb = b.state === 'planted' || this.playerSide === 'attack';
    const planDesc = (() => {
      if (this.playerSide === 'attack') {
        if (this.followPlayer) return 'ORDERS: FOLLOWING YOU';
        const names: Record<AttackStyle, string> = { exec: 'EXECUTE', rush: 'RUSH', split: 'SPLIT', default: 'DEFAULT · MAP CONTROL', fake: 'FAKE & HIT' };
        return `PLAN: ${names[this.attack.style]}${this.attack.style === 'default' ? '' : ` ${this.attack.site}`}${this.executing ? ' · GOING IN' : ''}`;
      }
      const setupNames: Record<DefenseSetup, string> = { standard: '2-1-2 SETUP', stackA: 'STACK A', stackB: 'STACK B', aggressive: 'AGGRESSIVE' };
      return this.followPlayer ? 'ORDERS: FOLLOWING YOU' : `SETUP: ${setupNames[this.defense]}${this.rotatedTo ? ` · ROTATED ${this.rotatedTo}` : ''}`;
    })();
    return {
      phase: m.phase, clock: Math.max(0, m.clock), round: m.round, maxRounds: m.format.maxRounds,
      roundsToWin: m.format.roundsToWin, halftimeAfter: m.format.halftimeAfter,
      alphaScore: m.score.alpha, bravoScore: m.score.bravo, alphaSide: m.alphaSide,
      money: this.player.inv.money,
      inv: { ...this.player.inv },
      side: this.playerSide,
      buyOpen: m.buyOpen && this.player.alive, inBuyZone: this.inBuyZone,
      buyTimeLeft: m.phase === 'freeze' ? m.clock + TIMING.buyGrace : m.phase === 'live' ? Math.max(0, TIMING.buyGrace - (TIMING.round - m.clock)) : 0,
      armor: this.player.inv.armor, kit: this.player.inv.kit, smokes: this.player.inv.smokes,
      hasBomb: b.state === 'carried' && b.carrier === this.player,
      bombState: b.state, bombSite: b.site,
      bombTimeLeft: b.state === 'planted' ? Math.max(0, m.clock) : 0,
      bombZone: b.state === 'dropped' && this.playerSide === 'attack' ? siroccoZoneAt(b.pos.x, b.pos.z) : null,
      plantProgress: b.planter === this.player ? Math.min(1, b.plantT / TIMING.plant) : 0,
      defuseProgress: b.defuser ? Math.min(1, b.defuseT / (b.defuser.inv.kit ? TIMING.defuseKit : TIMING.defuse)) : 0,
      defuseTotal: b.defuser ? (b.defuser.inv.kit ? TIMING.defuseKit : TIMING.defuse) : 0,
      defuserIsPlayer: b.defuser === this.player,
      prompt: this.playerPrompt(),
      playerDead: !this.player.alive,
      roster: this.roster(),
      history: m.history.map(h => ({ round: h.round, winner: h.winner, reason: h.reason, half: h.half })),
      banner: this.banner,
      smokeDensity: this.smokeDensityAt(this.ctx.playerPos()),
      plan: planDesc,
      matchPoint: m.matchPoint(),
      lastOfHalf: m.isLastRoundOfHalf,
      radar: {
        sites: (['A', 'B'] as SiteId[]).map(id => ({ id, nx: nx(SITES[id].center[0]), nz: nx(SITES[id].center[1]) })),
        allies: this.players.filter(c => c.team === 'alpha' && c.bot && c.alive).map(c => ({ nx: nx(c.bot!.pos.x), nz: nx(c.bot!.pos.z), yaw: -c.bot!.yaw * 180 / Math.PI })),
        bomb: (b.state === 'planted' || b.state === 'dropped') && knowBomb ? { nx: nx(b.pos.x), nz: nx(b.pos.z), planted: b.state === 'planted' } : b.state === 'carried' && b.carrier && b.carrier.team === 'alpha' && !b.carrier.isPlayer ? { nx: nx(this.posOf(b.carrier).x), nz: nx(this.posOf(b.carrier).z), planted: false } : undefined,
      },
    };
  }

  result(): DefusalResult {
    const m = this.match;
    const p = this.player;
    return {
      alphaScore: m.score.alpha, bravoScore: m.score.bravo, winner: m.winner ?? 'draw',
      history: [...m.history], roster: this.roster(), startSide: this.startSide, rounds: m.history.length,
      plants: p.plants, defuses: p.defuses, mvps: p.mvps, assists: p.assists, damage: Math.round(p.damage),
    };
  }

  dispose() {
    this.clearRoundEntities();
    for (const b of this.bots) {
      b.disposeMarker();
      b.model.group.removeFromParent();
      b.model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.bots = [];
    for (const g of [this.c4World.group, this.c4Carry.group]) {
      g.removeFromParent();
      g.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    }
    this.c4Light.removeFromParent();
    this.c4Glow.removeFromParent();
    this.c4Glow.material.dispose();
  }
}
