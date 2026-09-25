// ============================================================================
// OPERATION BLACKOUT — tactical director.
//
// The bot combat brain lives in tdm.ts and is good at *fighting*. This module is
// the layer above it that makes five bots play a ROUND: pick a site, take roles,
// walk authored routes, hold angles, plant only when the site is actually clear,
// rotate on the plant call, and commit to a defuse when the fuse demands it.
//
// It also owns the ranked gear table: what a bot carries after its buy, and how
// lethal that hardware is. A pistol eco round has to FEEL different from a full
// buy, or the economy is decoration.
//
// The director never moves a bot. It publishes orders; the bot's own PATROL state
// executes them, so cover, grenades, strafing and reaction time keep working.
// ============================================================================
import type { WeaponId } from '../economy/catalog';
import type { TDMBot } from '../tdm';
import { botBuyPlan, botWishlist, buyItemById } from './buy';
import {
  COMP_DEFUSE_KIT_SECONDS, COMP_DEFUSE_RADIUS, COMP_DEFUSE_SECONDS, COMP_PLANT_SECONDS,
  CompetitiveMatch, siteAt,
  type CompCombatant, type CompSiteId, type CompTeam,
} from './rules';

// ------------------------------------------------------------------ orders ---
export type CompOrderMode = 'move' | 'post' | 'action';
export type CompVerb = 'push' | 'hold' | 'rotate' | 'plant' | 'defuse' | 'retake' | 'recover';

/** One bot's marching orders for the next few seconds. */
export interface CompOrder {
  mode: CompOrderMode;
  /** Where the bot is heading / holding. */
  x: number;
  z: number;
  /** Where to look once it has arrived (a doorway, a corridor mouth). */
  watchX?: number;
  watchZ?: number;
  /** Move-speed multiplier: rushers sprint, anchors walk. */
  speed?: number;
  /** False = hold the line: no long chases, no wandering off the objective. */
  free: boolean;
  verb: CompVerb;
  site: CompSiteId | null;
}

/** Live positions of the actors — the rules store no geometry, so it comes here. */
export interface PositionSource { (id: string): { x: number; z: number } | null }

export interface DirectorHooks {
  /** Squad-level verb for the HUD / kill feed / announcer. */
  callout(kind: 'planting' | 'defusing' | 'retake' | 'target-a' | 'target-b' | 'rotating' | 'recover', team: CompTeam, at: { x: number; z: number }): void;
}

// -------------------------------------------------------------- bot gear -----
export interface BotGear {
  id: WeaponId;
  name: string;
  /** Weapon family: drives falloff, armor piercing and kill rewards. */
  class: 'PISTOL' | 'SMG' | 'RIFLE' | 'BR' | 'SNIPER' | 'SHOTGUN' | 'LMG';
  /** Body / head damage per landed round, before the armor model. */
  damage: number;
  headDamage: number;
  /** Seconds between rounds, magazine size, reload time. */
  shotGap: number;
  mag: number;
  reload: number;
  /** Rounds per burst (min, max). */
  burst: [number, number];
  /** Base hit probability, before distance falloff. */
  accuracy: number;
  /** Pellet count for shotguns (0 = single projectile). */
  pellets: number;
  speedMul: number;
  audio: 'pistol' | 'deagle' | 'smg' | 'vector' | 'm4' | 'ak' | 'scar' | 'shotgun' | 'sniper' | 'lmg';
}

/**
 * Ranked gear table, tuned against 100 HP and the competitive armor model:
 * a rifle is a three-round body kill through a plate, the AWM ends a body in one
 * round, and the shotgun only matters inside ten metres.
 */
export const BOT_GEAR: Record<WeaponId, BotGear> = {
  m1911: { id: 'm1911', name: 'M1911', class: 'PISTOL', damage: 26, headDamage: 62, shotGap: 0.20, mag: 8, reload: 1.8, burst: [2, 3], accuracy: 0.46, pellets: 0, speedMul: 1, audio: 'pistol' },
  deagle: { id: 'deagle', name: 'Deagle', class: 'PISTOL', damage: 44, headDamage: 104, shotGap: 0.34, mag: 7, reload: 2.0, burst: [1, 2], accuracy: 0.44, pellets: 0, speedMul: 1, audio: 'deagle' },
  mp7: { id: 'mp7', name: 'MP', class: 'SMG', damage: 20, headDamage: 44, shotGap: 0.085, mag: 40, reload: 2.2, burst: [4, 7], accuracy: 0.50, pellets: 0, speedMul: 1, audio: 'smg' },
  vector: { id: 'vector', name: 'Vector', class: 'SMG', damage: 20, headDamage: 42, shotGap: 0.07, mag: 25, reload: 2.3, burst: [5, 8], accuracy: 0.50, pellets: 0, speedMul: 1, audio: 'vector' },
  m4a1: { id: 'm4a1', name: 'M416', class: 'RIFLE', damage: 30, headDamage: 72, shotGap: 0.105, mag: 30, reload: 2.5, burst: [3, 6], accuracy: 0.56, pellets: 0, speedMul: 0.98, audio: 'm4' },
  ak47: { id: 'ak47', name: 'AK-47', class: 'RIFLE', damage: 36, headDamage: 92, shotGap: 0.13, mag: 30, reload: 2.7, burst: [2, 5], accuracy: 0.52, pellets: 0, speedMul: 0.98, audio: 'ak' },
  scar_h: { id: 'scar_h', name: 'SCAR', class: 'BR', damage: 44, headDamage: 106, shotGap: 0.16, mag: 20, reload: 2.6, burst: [2, 3], accuracy: 0.58, pellets: 0, speedMul: 0.96, audio: 'scar' },
  spas12: { id: 'spas12', name: 'SPAS', class: 'SHOTGUN', damage: 13, headDamage: 20, shotGap: 0.85, mag: 8, reload: 3.2, burst: [1, 1], accuracy: 0.72, pellets: 8, speedMul: 0.97, audio: 'shotgun' },
  awm: { id: 'awm', name: 'AWM', class: 'SNIPER', damage: 115, headDamage: 130, shotGap: 1.85, mag: 5, reload: 3.0, burst: [1, 1], accuracy: 0.70, pellets: 0, speedMul: 0.94, audio: 'sniper' },
  m249: { id: 'm249', name: 'M249', class: 'LMG', damage: 28, headDamage: 64, shotGap: 0.09, mag: 100, reload: 5.4, burst: [6, 11], accuracy: 0.42, pellets: 0, speedMul: 0.9, audio: 'lmg' },
};

const STARTER_GEAR = BOT_GEAR.m1911;

/** Gear for the weapon a combatant actually owns; the sidearm is the floor. */
export function gearFor(primary: WeaponId | null, secondary: WeaponId): BotGear {
  if (primary && BOT_GEAR[primary]) return BOT_GEAR[primary];
  return BOT_GEAR[secondary] ?? STARTER_GEAR;
}

/** Ranked price of a weapon (0 when it is the free starter or unknown). */
export function gearPrice(primary: WeaponId | null): number {
  if (!primary) return 0;
  return buyItemById(`w_${primary}`)?.price ?? 0;
}

// ------------------------------------------------------------- site plan -----
interface Post {
  x: number;
  z: number;
  /** Where the holder watches from this post. */
  wx: number;
  wz: number;
  label: string;
}

export interface SitePlan {
  site: CompSiteId;
  /** Attacker lane waypoints in order, walking north from the southern spawn. */
  push: [number, number][];
  /** Late / quiet route the lurker takes. */
  flank: [number, number][];
  /** Where the charge goes down. */
  plant: [number, number][];
  /** Defensive posts: two anchors, a door watch, a link watch and a west/north door. */
  holds: Post[];
  /** Attacker posts after the plant — deny the retake from cover. */
  cover: Post[];
  /** Defensive retake entry points, arriving from the far side of the map. */
  retake: [number, number][];
  /** Where the squad is standing when the round starts. */
  approach: [number, number];
}

/** The west hall is authored; the east hall is its 180° mirror (x → −x). */
const WEST: SitePlan = {
  site: 'A',
  approach: [-6, 30],
  push: [[-6, 30], [-9, 22], [-10.5, 15], [-10.5, 10.6], [-10.5, 6]],
  flank: [[16, 30], [28, 21], [30, 4], [22, -6], [14, -9], [10.5, -10.6], [10.5, -6]],
  plant: [[-11, -1], [-9.4, 1.6], [-12.4, 0.6]],
  holds: [
    { x: -13.4, z: -3.1, wx: -10.5, wz: 10, label: 'A crate anchor' },
    { x: -15.6, z: 3.4, wx: -10.5, wz: 10.6, label: 'A catwalk' },
    { x: -8.4, z: 6.4, wx: -10.5, wz: 11, label: 'A south door' },
    { x: -10.5, z: -8.4, wx: -10.5, wz: -10.8, label: 'A north door' },
    { x: -20.5, z: 0, wx: -17.5, wz: 0, label: 'A west door' },
  ],
  cover: [
    { x: -15.4, z: -6.2, wx: -10.5, wz: 10, label: 'post-plant west' },
    { x: -5.8, z: -6.4, wx: -10.5, wz: 10, label: 'post-plant link' },
    { x: -10.6, z: 6.6, wx: -10.5, wz: 12, label: 'post-plant south door' },
    { x: -13.4, z: -3.1, wx: -10.5, wz: 10, label: 'post-plant crate' },
  ],
  retake: [[-3.5, -1], [-7, -2], [-10.5, -3.4]],
};

const mirrorPlan = (plan: SitePlan, site: CompSiteId): SitePlan => {
  const flip = ([x, z]: [number, number]): [number, number] => [-x, z];
  return {
    site,
    approach: flip(plan.approach),
    push: plan.push.map(flip),
    flank: plan.flank.map(flip),
    plant: plan.plant.map(flip),
    holds: plan.holds.map(p => ({ x: -p.x, z: p.z, wx: -p.wx, wz: p.wz, label: p.label.replace('A ', 'B ') })),
    cover: plan.cover.map(p => ({ x: -p.x, z: p.z, wx: -p.wx, wz: p.wz, label: p.label.replace('post-plant', 'B post-plant') })),
    retake: plan.retake.map(flip),
  };
};

export const SITE_PLANS: Record<CompSiteId, SitePlan> = { A: WEST, B: mirrorPlan(WEST, 'B') };

/** Mid lane waypoints both squads fight over. */
export const MID_LANE: [number, number][] = [[0, 24], [0, 15], [0, 4], [0, 0], [0, -4], [0, -15]];

/** Squad roles, derived from a stable per-team slot index so they never shuffle. */
export type CompRole = 'entry' | 'support' | 'lurker' | 'anchor-a' | 'anchor-b' | 'rotator';

export function roleFor(team: CompTeam, id: string, roster: CompCombatant[]): CompRole {
  const ids = roster.filter(c => c.team === team).map(c => c.id).sort();
  const index = Math.max(0, ids.indexOf(id));
  return index === 0 ? 'entry' : index === 4 ? 'lurker' : 'support';
}

export function defenderRoleFor(team: CompTeam, id: string, roster: CompCombatant[]): 'anchor-a' | 'anchor-b' | 'rotator' {
  const ids = roster.filter(c => c.team === team).map(c => c.id).sort();
  const index = Math.max(0, ids.indexOf(id));
  return index === 4 ? 'rotator' : index % 4 < 2 ? 'anchor-a' : 'anchor-b';
}

// ------------------------------------------------------------- director ------
interface BotPlan {
  order: CompOrder;
  waypoint: number;
  replan: number;
}

const other = (team: CompTeam): CompTeam => (team === 'alpha' ? 'bravo' : 'alpha');

/**
 * Drives both squads for one competitive match.
 */
export class TacticalDirector {
  /** Pre-plant target for the attacking squad this round. */
  targetSite: CompSiteId = 'A';
  /** True once a defender has reported contact this round (drives rotates). */
  lastContact: { x: number; z: number } | null = null;

  private readonly match: CompetitiveMatch;
  private readonly positions: PositionSource;
  private readonly hooks: DirectorHooks;
  private readonly random: () => number;
  private readonly plans = new Map<string, BotPlan>();
  private readonly buyRolls = new Map<string, number>();
  /** Seconds since the attacking / defending squad last had eyes on an enemy. */
  attackersClearFor = 0;
  defendersClearFor = 0;

  constructor(match: CompetitiveMatch, positions: PositionSource, hooks: DirectorHooks, random: () => number = Math.random) {
    this.match = match;
    this.positions = positions;
    this.hooks = hooks;
    this.random = random;
  }

  /** Round start: pick the site, clear plans, announce the target. */
  beginRound(): void {
    this.targetSite = this.random() < 0.5 ? 'A' : 'B';
    this.plans.clear();
    this.lastContact = null;
    this.attackersClearFor = 0;
    this.defendersClearFor = 0;
    const attacking = this.match.teamOnSide('attack');
    this.hooks.callout(this.targetSite === 'A' ? 'target-a' : 'target-b', attacking, {
      x: SITE_PLANS[this.targetSite].approach[0], z: SITE_PLANS[this.targetSite].approach[1],
    });
  }

  /** Current order for a bot, or null when the director has nothing to say. */
  orderFor(bot: TDMBot): CompOrder | null {
    return this.plans.get(bot.name)?.order ?? null;
  }

  /** Exposed for tests and debug overlays. */
  planStatus(id: string): { verb: CompVerb; mode: CompOrderMode; site: CompSiteId | null } | null {
    const plan = this.plans.get(id);
    return plan ? { verb: plan.order.verb, mode: plan.order.mode, site: plan.order.site } : null;
  }

  /** Per-frame tick: intel, replans and objective commitments. */
  tick(dt: number, bots: TDMBot[]): void {
    if (this.match.phase === 'matchEnd') return;
    const attacking = this.match.teamOnSide('attack');
    const defending = this.match.teamOnSide('defend');
    const live = this.match.phase === 'live';

    const attackersSee = bots.some(b => b.team === attacking && !b.dead && b.seesEnemy());
    const defendersSee = bots.some(b => b.team === defending && !b.dead && b.seesEnemy());
    this.attackersClearFor = attackersSee ? 0 : this.attackersClearFor + dt;
    this.defendersClearFor = defendersSee ? 0 : this.defendersClearFor + dt;
    if (defendersSee) {
      const spotter = bots.find(b => b.team === defending && !b.dead && b.seesEnemy());
      if (spotter) this.lastContact = { x: spotter.pos.x, z: spotter.pos.z };
    }

    for (const bot of bots) {
      const actor = this.match.of(bot.name);
      if (!actor || bot.dead) { this.plans.delete(bot.name); continue; }
      let plan = this.plans.get(bot.name);
      if (!plan) {
        plan = { order: { mode: 'move', x: bot.pos.x, z: bot.pos.z, free: true, verb: 'hold', site: null }, waypoint: 0, replan: 0 };
        this.plans.set(bot.name, plan);
      }
      plan.replan -= dt;
      if (plan.replan <= 0) {
        plan.replan = 0.3 + this.random() * 0.25;
        if (actor.team === attacking) this.planAttacker(plan, bot, actor);
        else this.planDefender(plan, bot, actor);
      }
      if (live) {
        if (actor.team === attacking) this.commitPlant(plan, bot, actor);
        else this.commitDefuse(plan, bot, actor);
      }
    }
  }

  /**
   * Squad shopping for the buy phase. Returns the item ids each bot should try to
   * buy, in priority order; the orchestrator performs the actual purchases so the
   * rules module stays the only thing that can take money.
   */
  shoppingList(bots: TDMBot[]): { bot: TDMBot; items: string[] }[] {
    if (this.match.phase !== 'buy') return [];
    const out: { bot: TDMBot; items: string[] }[] = [];
    for (const team of ['alpha', 'bravo'] as CompTeam[]) {
      const members = this.match.roster(team).filter(c => c.alive);
      const avg = members.reduce((sum, c) => sum + c.money, 0) / Math.max(1, members.length);
      const opponent = this.match.score[other(team)];
      const plan = botBuyPlan({
        team,
        side: this.match.sideOf(team),
        teamMoney: avg,
        lossStreak: this.match.lossStreak[team],
        desperate: opponent === 6,
      });
      for (const bot of bots.filter(b => b.team === team)) {
        const actor = this.match.of(bot.name);
        if (!actor || !actor.alive) continue;
        out.push({
          bot,
          items: botWishlist({
            plan,
            money: actor.money,
            side: this.match.sideOf(team),
            hasPrimary: actor.primary !== null,
            hasKit: actor.kit,
            armor: actor.armor,
            helmet: actor.helmet,
            frags: actor.frags,
            flashes: actor.flashes,
            roll: this.rollFor(bot.name),
          }),
        });
      }
    }
    return out;
  }

  private rollFor(id: string): number {
    let roll = this.buyRolls.get(id);
    if (roll === undefined) { roll = this.random(); this.buyRolls.set(id, roll); }
    return roll;
  }

  // ---------------------------------------------------------- attacker AI ---
  private planAttacker(plan: BotPlan, bot: TDMBot, actor: CompCombatant): void {
    const route = SITE_PLANS[this.targetSite];
    const planted = this.match.bomb.state === 'planted';

    if (planted) {
      // Post-plant: everyone but the carrier's killer holds the angles the charge
      // is watched from. Once they are down to nothing, they hunt instead.
      const dug = route.cover[this.postSlot(bot) % route.cover.length];
      const lastStand = this.match.roster(other(actor.team)).filter(c => c.alive).length === 0;
      if (lastStand) {
        plan.order = { mode: 'move', x: dug.wx, z: dug.wz, speed: 1.05, free: true, verb: 'push', site: this.targetSite };
        return;
      }
      plan.order = { mode: 'post', x: dug.x, z: dug.z, watchX: dug.wx, watchZ: dug.wz, free: true, verb: 'hold', site: this.targetSite };
      return;
    }

    if (this.match.bomb.state === 'dropped') {
      const grabber = this.nearestLive('attack');
      const bomb = this.match.bomb;
      if (grabber === actor.id) {
        plan.order = { mode: 'move', x: bomb.x, z: bomb.z, free: true, verb: 'recover', site: siteAt(bomb.x, bomb.z) };
        this.hooks.callout('recover', actor.team, { x: bomb.x, z: bomb.z });
        return;
      }
    }

    const isCarrier = this.match.bomb.state === 'carried' && this.match.bomb.carrierId === actor.id;
    const insideSite = siteAt(bot.pos.x, bot.pos.z) !== null;
    // The carrier commits when the site is clear enough to work in — or when the
    // round clock leaves no choice, which is exactly how a real execute goes down.
    const forced = this.match.timeLeft < 42 && insideSite;
    if (isCarrier && insideSite && (!this.enemyNear(actor.id, 11) || forced)) {
      const spot = route.plant[this.postSlot(bot) % route.plant.length];
      plan.order = { mode: 'post', x: spot[0], z: spot[1], free: false, verb: 'plant', site: this.targetSite };
      return;
    }

    const role = roleFor(actor.team, actor.id, this.match.combatants);
    const lane = role === 'lurker' ? route.flank : route.push;
    const [wx, wz] = lane[this.advance(plan, lane, bot)];
    plan.order = {
      mode: 'move', x: wx, z: wz,
      speed: role === 'entry' ? 1.1 : role === 'lurker' ? 0.95 : 1.02,
      free: true, verb: 'push', site: this.targetSite,
    };
  }

  /** Planting is a decision re-made every frame, never a scheduled plan. */
  private commitPlant(plan: BotPlan, bot: TDMBot, actor: CompCombatant): void {
    if (this.match.bomb.state !== 'carried' || this.match.bomb.carrierId !== actor.id) {
      if (this.match.action?.actorId === actor.id) this.match.cancelAction();
      return;
    }
    const site = siteAt(bot.pos.x, bot.pos.z);
    const radius = site ? Math.hypot(bot.pos.x - SITE_PLANS[site].plant[0][0], bot.pos.z - SITE_PLANS[site].plant[0][1]) : Infinity;
    // Planting is a judgement call, re-made every frame: a nearby enemy stops the
    // work, distance does not. Under time pressure the carrier plants anyway.
    const forced = this.match.timeLeft < 42;
    const safe = !this.enemyNear(actor.id, 10) || forced;
    if (site && safe && radius < 9) {
      const wasAction = plan.order.mode === 'action';
      plan.order = { mode: 'action', x: bot.pos.x, z: bot.pos.z, free: false, verb: 'plant', site };
      if (!wasAction) this.hooks.callout('planting', actor.team, bot.pos);
      this.match.holdAction(actor.id, 'plant', 1 / 30, { site, bombDist: 0 });
    } else if (plan.order.mode === 'action') {
      plan.order.mode = 'post';
      this.match.cancelAction();
    }
  }

  // ---------------------------------------------------------- defender AI ---
  private planDefender(plan: BotPlan, bot: TDMBot, actor: CompCombatant): void {
    const plantedSite = this.match.bomb.state === 'planted' ? this.match.bomb.site : null;
    if (plantedSite) {
      const route = SITE_PLANS[plantedSite];
      const bomb = this.match.bomb;
      if (this.defuserId() === actor.id) {
        plan.order = { mode: 'move', x: bomb.x, z: bomb.z, speed: 1.1, free: false, verb: 'defuse', site: plantedSite };
        return;
      }
      const idx = this.advance(plan, route.retake, bot);
      const arrived = idx === route.retake.length - 1;
      if (!arrived) {
        plan.order = { mode: 'move', x: route.retake[idx][0], z: route.retake[idx][1], speed: 1.05, free: true, verb: 'rotate', site: plantedSite };
        return;
      }
      const post = route.holds[this.postSlot(bot) % route.holds.length];
      plan.order = { mode: 'post', x: post.x, z: post.z, watchX: bomb.x, watchZ: bomb.z, free: true, verb: 'retake', site: plantedSite };
      this.hooks.callout('retake', actor.team, bot.pos);
      return;
    }

    const role = defenderRoleFor(actor.team, actor.id, this.match.combatants);
    if (role === 'rotator') {
      if (this.lastContact) {
        plan.order = { mode: 'move', x: this.lastContact.x, z: this.lastContact.z, speed: 1.08, free: true, verb: 'rotate', site: siteAt(this.lastContact.x, this.lastContact.z) };
        this.hooks.callout('rotating', actor.team, this.lastContact);
        return;
      }
      const lane = MID_LANE[2];
      plan.order = { mode: 'move', x: lane[0], z: lane[1], speed: 0.95, free: false, verb: 'hold', site: null };
      return;
    }
    const site: CompSiteId = role === 'anchor-a' ? 'A' : 'B';
    const route = SITE_PLANS[site];
    const post = route.holds[this.postSlot(bot) % route.holds.length];
    plan.order = { mode: 'post', x: post.x, z: post.z, watchX: post.wx, watchZ: post.wz, free: false, verb: 'hold', site };
  }

  private commitDefuse(plan: BotPlan, bot: TDMBot, actor: CompCombatant): void {
    if (this.match.bomb.state !== 'planted') {
      if (this.match.action?.actorId === actor.id) this.match.cancelAction();
      return;
    }
    const bomb = this.match.bomb;
    const dist = Math.hypot(bot.pos.x - bomb.x, bot.pos.z - bomb.z);
    const defuseTime = actor.kit ? COMP_DEFUSE_KIT_SECONDS : COMP_DEFUSE_SECONDS;
    // With the fuse nearly out, a defender lies on the wire and takes the gamble.
    const lastChance = bomb.fuse <= defuseTime + 3;
    const safe = !this.enemyNear(actor.id, 12);
    const chosen = this.defuserId() === actor.id;
    if (dist <= COMP_DEFUSE_RADIUS && chosen && (safe || lastChance)) {
      const wasAction = plan.order.mode === 'action';
      plan.order = { mode: 'action', x: bot.pos.x, z: bot.pos.z, free: false, verb: 'defuse', site: bomb.site };
      if (!wasAction) this.hooks.callout('defusing', actor.team, bot.pos);
      this.match.holdAction(actor.id, 'defuse', 1 / 30, { site: null, bombDist: dist });
    } else if (plan.order.mode === 'action') {
      plan.order.mode = 'post';
      this.match.cancelAction();
    }
  }

  // ------------------------------------------------------------- helpers ---
  /** Advance a route and return the waypoint the bot should be servicing. */
  private advance(plan: BotPlan, route: [number, number][], bot: TDMBot): number {
    while (plan.waypoint < route.length - 1) {
      const [x, z] = route[plan.waypoint];
      if (Math.hypot(bot.pos.x - x, bot.pos.z - z) < 2.6) plan.waypoint++;
      else break;
    }
    return Math.min(plan.waypoint, route.length - 1);
  }

  /** Stable slot 0..4 inside the bot's own team, used to split posts. */
  private postSlot(bot: TDMBot): number {
    const ids = this.match.combatants.filter(c => c.team === bot.team).map(c => c.id).sort();
    return Math.max(0, ids.indexOf(bot.name)) % 5;
  }

  /**
   * Is any live enemy inside `within` metres of this operator? The director works
   * from positions, so this is the same information a player reads off the minimap.
   */
  private enemyNear(id: string, within: number): boolean {
    const me = this.match.of(id);
    const myPos = me ? this.positions(id) : null;
    if (!me || !myPos) return false;
    for (const foe of this.match.roster(other(me.team))) {
      if (!foe.alive) continue;
      const pos = this.positions(foe.id);
      if (!pos) continue;
      if (Math.hypot(pos.x - myPos.x, pos.z - myPos.z) <= within) return true;
    }
    return false;
  }

  private nearestLive(side: 'attack' | 'defend'): string | null {
    const team = this.match.teamOnSide(side);
    const bomb = this.match.bomb;
    let best: string | null = null;
    let bestD = Infinity;
    for (const c of this.match.roster(team)) {
      if (!c.alive) continue;
      const pos = this.positions(c.id);
      if (!pos) continue;
      const d = Math.hypot(pos.x - bomb.x, pos.z - bomb.z);
      if (d < bestD) { bestD = d; best = c.id; }
    }
    return best;
  }

  /** Closest living defender — the one who walks in and cuts the wire. */
  defuserId(): string | null {
    // Once someone is on the wire they own the job: swapping mid-defuse would
    // reset the progress bar every frame and nobody would ever finish.
    const active = this.match.action;
    if (active && active.kind === 'defuse') return active.actorId;
    const team = this.match.teamOnSide('defend');
    const bomb = this.match.bomb;
    let best: string | null = null;
    let bestD = Infinity;
    for (const c of this.match.roster(team)) {
      if (!c.alive) continue;
      const pos = this.positions(c.id);
      if (!pos) continue;
      const d = Math.hypot(pos.x - bomb.x, pos.z - bomb.z);
      if (d < bestD) { bestD = d; best = c.id; }
    }
    return best;
  }

  /** Longest travel time a defender needs to reach the charge (HUD rotate hint). */
  defuseEta(id: string): number {
    const pos = this.positions(id);
    if (!pos) return Infinity;
    const bomb = this.match.bomb;
    return Math.hypot(pos.x - bomb.x, pos.z - bomb.z) / 5.2;
  }

  /** Time to plant from now, for the HUD's "plant is possible" hint. */
  static plantTime(): number { return COMP_PLANT_SECONDS; }
}

/** Site lookup re-exported for the HUD and tests. */
export const siteOf = siteAt;
