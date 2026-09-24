// ============================================================================
// OPERATION BLACKOUT — Ranked Search & Destroy round engine.
//
// This module is the AUTHORITY on the match: round phases, the economy, sides,
// the bomb, plant/defuse progression, overtime and every win condition. It owns
// money and loadout persistence across rounds and nothing else — hit points live
// on the actors (player + bots) so there is exactly one source of truth for
// damage, and positions live in the world.
//
// Design rules this file obeys:
//   * PURE. No three.js, no DOM, no timers. Everything is `update(dt, ctx)`.
//   * Deterministic given (state, dt, ctx). Randomness is injectable.
//   * Events are queued, never dispatched through callbacks mid-mutation, so a
//     listener can never re-enter the state machine while it is stepping.
//
// Competitive rules (mirrors CS2 / CoD Search & Destroy conventions):
//   * Best of 13: first to 7 round wins, sides swap after 6 rounds.
//   * 6-6 → overtime: first to lead by two, maximum six extra rounds, else draw.
//   * Attackers win by eliminating the defence, or by detonating the charge.
//   * Defenders win by eliminating the attack (before a plant), by defusing, or
//     by running the clock down with no charge on site.
//   * A planted charge keeps the round alive even if every attacker is dead.
//   * One life per round. Survivors keep their weapons and armor; the dead buy
//     from scratch next round.
// ============================================================================
import type { WeaponId } from '../economy/catalog';
import { COMP_BUY_ITEMS, buyItemById, buyItemForWeapon, type CompBuyItem } from './buy';

export type CompTeam = 'alpha' | 'bravo';
export type CompSide = 'attack' | 'defend';
export type CompSiteId = 'A' | 'B';
export type CompPhase = 'buy' | 'live' | 'roundEnd' | 'matchEnd';
export type CompActionKind = 'plant' | 'defuse';
export type CompWinReason = 'elimination' | 'detonation' | 'defuse' | 'time' | 'defused-time';
export type CompBombState = 'carried' | 'dropped' | 'planted' | 'defused' | 'detonated';

// ---------------------------------------------------------------- tuning ----
export const COMP_START_MONEY = 800;
export const COMP_MAX_MONEY = 16000;
export const COMP_WIN_REWARD = 3250;
/** Loss bonus ladder, indexed by consecutive losses (capped at the last entry). */
export const COMP_LOSS_REWARDS = [1400, 1900, 2400, 2900, 3400];
export const COMP_PLANT_REWARD = 300;
export const COMP_DEFUSE_REWARD = 300;
export const COMP_BUY_SECONDS = 15;
export const COMP_ROUND_SECONDS = 100;
export const COMP_ROUND_END_SECONDS = 6.5;
export const COMP_BOMB_FUSE = 40;
export const COMP_PLANT_SECONDS = 3.2;
export const COMP_DEFUSE_SECONDS = 10;
export const COMP_DEFUSE_KIT_SECONDS = 5;
export const COMP_ROUNDS_TO_WIN = 7;
export const COMP_HALFTIME_ROUNDS = 6;
export const COMP_OVERTIME_START_MONEY = 5000;
/** Hard stop for overtime: 6 extra rounds. Beyond that the match is a draw. */
export const COMP_OVERTIME_MAX_ROUNDS = 6;
/** Pickup radius for a dropped charge. */
export const COMP_PICKUP_RADIUS = 1.5;
/** How close a defender must be to defuse, measured from the charge. */
export const COMP_DEFUSE_RADIUS = 1.6;
/** Charge blast radius + the damage curve, resolved by the engine on detonation. */
export const COMP_BLAST_RADIUS = 14;
export const COMP_BLAST_DAMAGE = 500;

export const COMP_TEAM_NAMES: Record<CompTeam, string> = { alpha: 'ALPHA', bravo: 'BRAVO' };
export const COMP_SIDE_NAMES: Record<CompSide, string> = { attack: 'ATTACK', defend: 'DEFEND' };
/** Bomb sites on the Warehouse arena — the twin halls, one per side. */
export const COMP_SITES: Record<CompSiteId, { id: CompSiteId; name: string; x: number; z: number; radius: number }> = {
  A: { id: 'A', name: 'WEST HALL', x: -10.5, z: 0, radius: 5.2 },
  B: { id: 'B', name: 'EAST HALL', x: 10.5, z: 0, radius: 5.2 },
};

export const otherTeam = (team: CompTeam): CompTeam => (team === 'alpha' ? 'bravo' : 'alpha');
export const otherSide = (side: CompSide): CompSide => (side === 'attack' ? 'defend' : 'attack');

/** Which site is this ground position standing in? Null when out of bounds of both. */
export function siteAt(x: number, z: number): CompSiteId | null {
  for (const id of ['A', 'B'] as CompSiteId[]) {
    const site = COMP_SITES[id];
    const dx = x - site.x, dz = z - site.z;
    if (dx * dx + dz * dz <= site.radius * site.radius) return id;
  }
  return null;
}

/** The charge carries a site label; defenders use it to call a rotate. */
export function siteLabel(site: CompSiteId | null): string {
  return site ? `SITE ${site} — ${COMP_SITES[site].name}` : 'NO SITE';
}

// ---------------------------------------------------------------- damage ----
export interface CompDamageResult { hp: number; armor: number; taken: number; absorbed: number }

/**
 * Competitive armor model. Armor is a 100 point pool that absorbs a share of the
 * incoming round and wears out doing it; a helmet protects the head only. Armor
 * piercing rounds (the AWM) ignore most of that protection — a bolt-action body
 * shot still ends the fight, which is the whole point of the weapon.
 */
export function applyCompetitiveDamage(
  hp: number, armor: number, helmet: boolean, amount: number, isHead: boolean, pierce = false,
): CompDamageResult {
  if (amount <= 0) return { hp, armor, taken: 0, absorbed: 0 };
  let protection = isHead ? (helmet ? 0.40 : 0) : 0.45;
  if (pierce) protection *= 0.2;
  let taken = amount, absorbed = 0;
  if (armor > 0 && protection > 0) {
    const wanted = amount * protection;
    // Wear is deliberately steeper than protection: a plate survives ~4 rifle
    // rounds, so armor matters most in the first exchange of a round.
    const wear = wanted * 1.6;
    const used = Math.min(armor, wear);
    const share = wear > 0 ? used / wear : 0;
    absorbed = wanted * share;
    taken = amount - absorbed;
    armor = Math.max(0, armor - used);
  }
  return { hp: Math.max(0, hp - taken), armor, taken, absorbed };
}

/** Kill reward by weapon family — SMGs and shotguns pay, the AWM does not. */
export function killReward(cls: CompBuyItem['cls']): number {
  switch (cls) {
    case 'SMG': return 600;
    case 'SG': return 900;
    case 'SR': return 100;
    case 'LMG': return 300;
    case 'PISTOL': return 300;
    default: return 300;
  }
}

// ------------------------------------------------------------ combatant ----
export interface CompCombatant {
  id: string;
  name: string;
  team: CompTeam;
  money: number;
  alive: boolean;
  /** Primary weapon currently owned (lost on death). Null = pistol only. */
  primary: WeaponId | null;
  secondary: WeaponId;
  /** Armor pool 0..100 and whether the helmet was bought. */
  armor: number;
  helmet: boolean;
  kit: boolean;
  frags: number;
  flashes: number;
  // match statistics
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  plants: number;
  defuses: number;
  mvps: number;
  roundsPlayed: number;
  /** killed this round — used to decide who keeps their kit next round */
  deadThisRound: boolean;
}

export interface CompCombatantSeed {
  id: string;
  name: string;
  team: CompTeam;
  starter?: WeaponId;
}

export interface CompEventMap {
  'phase': { phase: CompPhase; round: number };
  'round-start': { round: number; side: Record<CompTeam, CompSide> };
  'round-end': { winner: CompTeam; reason: CompWinReason; score: Record<CompTeam, number>; round: number };
  'kill': { killerId: string | null; victimId: string; weapon: string; headshot: boolean };
  'bomb-planted': { actorId: string; site: CompSiteId };
  'plant-progress': { actorId: string; progress: number; duration: number };
  'defuse-progress': { actorId: string; progress: number; duration: number };
  'bomb-defused': { actorId: string; site: CompSiteId };
  'bomb-detonated': { site: CompSiteId };
  'bomb-dropped': { x: number; z: number };
  'bomb-picked': { actorId: string };
  'action-cancelled': { actorId: string; kind: CompActionKind };
  'buy': { actorId: string; itemId: string; cost: number };
  'halftime': { side: Record<CompTeam, CompSide> };
  'overtime': { round: number };
  'match-end': { winner: CompTeam | null; draw: boolean; score: Record<CompTeam, number> };
}
export type CompEvent = { [K in keyof CompEventMap]: { type: K } & CompEventMap[K] }[keyof CompEventMap];

export interface CompActionState {
  kind: CompActionKind;
  actorId: string;
  progress: number;
  duration: number;
  site: CompSiteId | null;
}

export interface CompBombStateView {
  state: CompBombState;
  carrierId: string | null;
  site: CompSiteId | null;
  fuse: number;
  x: number;
  z: number;
  dropped: boolean;
}

export interface CompMatchOptions {
  roundsToWin?: number;
  /** Deterministic RNG for carrier picks (tests pass a seeded one). */
  random?: () => number;
  startMoney?: number;
}

/**
 * The round engine. One instance per match; the orchestrator feeds it kills,
 * positions and time, and drains events.
 */
export class CompetitiveMatch {
  readonly combatants: CompCombatant[] = [];
  phase: CompPhase = 'buy';
  round = 0;
  timeLeft = COMP_BUY_SECONDS;
  score: Record<CompTeam, number> = { alpha: 0, bravo: 0 };
  /** Which side each team is playing this round. */
  side: Record<CompTeam, CompSide> = { alpha: 'attack', bravo: 'defend' };
  lossStreak: Record<CompTeam, number> = { alpha: 0, bravo: 0 };
  /** Round winners in order — drives the scoreboard pips. */
  history: CompTeam[] = [];
  bomb: CompBombStateView = { state: 'carried', carrierId: null, site: null, fuse: 0, x: 0, z: 0, dropped: false };
  action: CompActionState | null = null;
  overtime = false;
  draw = false;
  winner: CompTeam | null = null;
  /** Set while the round-end screen is showing. */
  lastRound: { winner: CompTeam; reason: CompWinReason } | null = null;
  /** Bomb carrier history so the same operator does not always get the charge. */
  private lastCarrier: string | null = null;
  private readonly roundsToWin: number;
  private readonly random: () => number;
  private readonly startMoney: number;
  private events: CompEvent[] = [];

  constructor(seeds: CompCombatantSeed[], options: CompMatchOptions = {}) {
    this.roundsToWin = options.roundsToWin ?? COMP_ROUNDS_TO_WIN;
    this.random = options.random ?? Math.random;
    this.startMoney = options.startMoney ?? COMP_START_MONEY;
    for (const seed of seeds) {
      const starter = seed.starter ?? 'm1911';
      this.combatants.push({
        id: seed.id, name: seed.name, team: seed.team,
        money: this.startMoney, alive: true,
        primary: null, secondary: starter,
        armor: 0, helmet: false, kit: false, frags: 0, flashes: 0,
        kills: 0, deaths: 0, headshots: 0, damage: 0, plants: 0, defuses: 0, mvps: 0,
        roundsPlayed: 0, deadThisRound: false,
      });
    }
  }

  // ------------------------------------------------------------- queries ---
  of(id: string): CompCombatant | undefined { return this.combatants.find(c => c.id === id); }
  teamOf(id: string): CompTeam | null { return this.of(id)?.team ?? null; }
  roster(team: CompTeam): CompCombatant[] { return this.combatants.filter(c => c.team === team); }
  sideOf(team: CompTeam): CompSide { return this.side[team]; }
  /** Side of the team this combatant plays for. */
  sideOfId(id: string): CompSide | null { const t = this.teamOf(id); return t ? this.side[t] : null; }
  isAttacker(id: string): boolean { return this.sideOfId(id) === 'attack'; }
  aliveIds(team: CompTeam): string[] { return this.roster(team).filter(c => c.alive).map(c => c.id); }
  bombCarrier(): CompCombatant | undefined { return this.bomb.carrierId ? this.of(this.bomb.carrierId) : undefined; }
  /** True while the round is live and the bomb has not resolved. */
  get roundLive(): boolean { return this.phase === 'live'; }
  get matchOver(): boolean { return this.phase === 'matchEnd'; }
  get bombArmed(): boolean { return this.bomb.state === 'planted'; }
  /** Buy phase — money can still be spent. */
  get canBuyNow(): boolean { return this.phase === 'buy'; }

  drain(): CompEvent[] { const out = this.events; this.events = []; return out; }
  private emit(event: CompEvent): void { this.events.push(event); }

  // -------------------------------------------------------- match control ---
  /** Kick off the match: places everyone, picks the round-1 carrier. */
  startMatch(): void {
    if (this.round !== 0) return;
    for (const c of this.combatants) { c.alive = true; c.deadThisRound = false; c.armor = 0; c.helmet = false; }
    this.beginRound(1);
  }

  private beginRound(round: number): void {
    this.round = round;
    this.action = null;
    this.lastRound = null;
    this.timeLeft = COMP_BUY_SECONDS;
    this.phase = 'buy';
    for (const c of this.combatants) { c.alive = true; c.roundsPlayed++; }
    // The charge always starts on an attacker, and never on the previous carrier
    // twice running while someone else is available.
    const attackers = this.roster(this.teamOnSide('attack')).map(c => c.id);
    this.bomb = { state: 'carried', carrierId: this.pickCarrier(attackers), site: null, fuse: 0, x: 0, z: 0, dropped: false };
    this.emit({ type: 'round-start', round, side: { ...this.side } });
    this.emit({ type: 'phase', phase: this.phase, round });
  }

  /** Which team is playing this side right now. */
  teamOnSide(side: CompSide): CompTeam {
    return this.side.alpha === side ? 'alpha' : 'bravo';
  }

  private pickCarrier(candidates: string[]): string | null {
    if (!candidates.length) return null;
    const pool = candidates.length > 1 && this.lastCarrier
      ? candidates.filter(id => id !== this.lastCarrier)
      : candidates;
    const chosen = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
    this.lastCarrier = chosen;
    return chosen;
  }

  /**
   * Advance the clocks one frame. Alive lists are derived from the combatants, so
   * kills are the only way a body leaves the round — one source of truth.
   */
  update(dt: number): void {
    if (dt <= 0 || this.phase === 'matchEnd') return;
    const step = Math.min(dt, 1);
    if (this.phase === 'buy') {
      this.timeLeft -= step;
      if (this.timeLeft <= 0) { this.timeLeft = COMP_ROUND_SECONDS; this.phase = 'live'; this.emit({ type: 'phase', phase: 'live', round: this.round }); }
      return;
    }
    if (this.phase === 'roundEnd') {
      this.timeLeft -= step;
      if (this.timeLeft <= 0) this.advanceAfterRoundEnd();
      return;
    }
    // ---- live ----
    this.timeLeft = Math.max(0, this.timeLeft - step);
    if (this.bomb.state === 'planted') {
      this.bomb.fuse = Math.max(0, this.bomb.fuse - step);
      if (this.bomb.fuse <= 0) {
        const site = this.bomb.site ?? 'A';
        this.bomb = { ...this.bomb, state: 'detonated', fuse: 0 };
        this.emit({ type: 'bomb-detonated', site });
        this.resolveRound(this.teamOnSide('attack'), 'detonation');
        return;
      }
    }
    const attackers = this.aliveIds(this.teamOnSide('attack'));
    const defenders = this.aliveIds(this.teamOnSide('defend'));
    if (!defenders.length) { this.resolveRound(this.teamOnSide('attack'), 'elimination'); return; }
    if (!attackers.length && this.bomb.state !== 'planted') { this.resolveRound(this.teamOnSide('defend'), 'elimination'); return; }
    if (this.timeLeft <= 0 && this.bomb.state !== 'planted') { this.resolveRound(this.teamOnSide('defend'), 'time'); return; }
    // A defender who ran the clock out on a planted charge still has defuse time
    // only while the fuse burns — the timer expiring is not a win once armed.
  }

  /**
   * Fast-forward the clocks in bounded steps. Used by tests and headless match
   * harnesses; live play always steps frame by frame through update().
   */
  fastForward(seconds: number, step = 1 / 30): void {
    let left = Math.max(0, seconds);
    while (left > 1e-6) {
      const slice = Math.min(step, left);
      this.update(slice);
      left -= slice;
    }
  }

  // ------------------------------------------------------------ violence ---
  /** Register damage for the ADR column. Kills flow through notifyKill. */
  notifyDamage(victimId: string, amount: number): void {
    const victim = this.of(victimId);
    if (victim && amount > 0) victim.damage += amount;
  }

  /**
   * A confirmed kill. Killer may be null (world/fall damage) — the round still
   * loses a body, which is what matters for the win conditions.
   */
  notifyKill(killerId: string | null, victimId: string, weapon = 'RIFLE', headshot = false): void {
    const victim = this.of(victimId);
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.deadThisRound = true;
    victim.deaths++;
    const killer = killerId ? this.of(killerId) : undefined;
    if (killer && killer.id !== victim.id && killer.team !== victim.team) {
      killer.kills++;
      if (headshot) killer.headshots++;
      const item = buyItemForWeapon(weapon as WeaponId);
      const reward = killReward(item?.cls ?? 'AR');
      this.pay(killer, reward);
      this.emit({ type: 'kill', killerId: killer.id, victimId, weapon, headshot });
    } else {
      this.emit({ type: 'kill', killerId: null, victimId, weapon, headshot });
    }
    // Dying with the charge drops it where the body fell.
    if (this.bomb.state === 'carried' && this.bomb.carrierId === victimId) this.dropBomb();
  }

  /** Move the charge out of the carrier's hands onto the ground. */
  dropBomb(x = this.bomb.x, z = this.bomb.z): void {
    if (this.bomb.state !== 'carried') return;
    this.bomb = { ...this.bomb, state: 'dropped', carrierId: null, dropped: true, x, z };
    this.emit({ type: 'bomb-dropped', x, z });
  }

  /** An attacker standing on the dropped charge picks it up. */
  tryPickup(id: string, x: number, z: number): boolean {
    if (this.bomb.state !== 'dropped' || !this.isAttacker(id)) return false;
    const owner = this.of(id);
    if (!owner || !owner.alive) return false;
    const dx = x - this.bomb.x, dz = z - this.bomb.z;
    if (dx * dx + dz * dz > COMP_PICKUP_RADIUS * COMP_PICKUP_RADIUS) return false;
    this.bomb = { ...this.bomb, state: 'carried', carrierId: id, dropped: false };
    this.emit({ type: 'bomb-picked', actorId: id });
    return true;
  }

  /**
   * Hold-to-plant / hold-to-defuse. Call once per frame while the actor holds the
   * interact key: the state machine validates the actor, the site and the charge
   * and reports progress up to completion. Releasing (or an invalid context)
   * cancels and zeroes the timer — except a defuse that is past its halfway mark
   * with a kit, which keeps its progress like a real half-completed wire job.
   */
  holdAction(id: string, kind: CompActionKind, dt: number, ctx: { site: CompSiteId | null; bombDist: number; x?: number; z?: number }): void {
    if (this.phase !== 'live') return;
    const actor = this.of(id);
    if (!actor || !actor.alive) return;
    const duration = this.actionDuration(id, kind);
    if (duration <= 0) return;
    const valid = this.actionValid(actor, kind, ctx);
    if (!valid) {
      if (this.action && this.action.actorId === id && this.action.kind === kind) this.cancelAction('moved');
      return;
    }
    if (!this.action || this.action.actorId !== id || this.action.kind !== kind) {
      if (this.action) { this.emit({ type: 'action-cancelled', actorId: this.action.actorId, kind: this.action.kind }); }
      this.action = { kind, actorId: id, progress: 0, duration, site: kind === 'plant' ? ctx.site : null };
    }
    const state = this.action;
    state.progress += dt;
    if (state.progress >= state.duration) {
      this.action = null;
      if (kind === 'plant') this.completePlant(actor, ctx.site ?? 'A');
      else this.completeDefuse(actor);
      return;
    }
    this.emit(kind === 'plant'
      ? { type: 'plant-progress', actorId: id, progress: state.progress, duration: state.duration }
      : { type: 'defuse-progress', actorId: id, progress: state.progress, duration: state.duration });
  }

  /** Explicit cancellation (key released, actor moved, round ended). */
  cancelAction(reason = 'released'): void {
    void reason;
    if (!this.action) return;
    const { actorId, kind } = this.action;
    this.action = null;
    this.emit({ type: 'action-cancelled', actorId, kind });
  }

  private actionDuration(id: string, kind: CompActionKind): number {
    if (kind === 'plant') return this.bomb.state === 'carried' && this.bomb.carrierId === id ? COMP_PLANT_SECONDS : 0;
    const actor = this.of(id);
    if (!actor || this.bomb.state !== 'planted') return 0;
    if (this.sideOfId(id) !== 'defend') return 0;
    return actor.kit ? COMP_DEFUSE_KIT_SECONDS : COMP_DEFUSE_SECONDS;
  }

  private actionValid(actor: CompCombatant, kind: CompActionKind, ctx: { site: CompSiteId | null; bombDist: number }): boolean {
    if (kind === 'plant') {
      if (this.sideOfId(actor.id) !== 'attack') return false;
      if (this.bomb.state !== 'carried' || this.bomb.carrierId !== actor.id) return false;
      return ctx.site !== null;
    }
    if (this.sideOfId(actor.id) !== 'defend') return false;
    if (this.bomb.state !== 'planted') return false;
    return ctx.bombDist <= COMP_DEFUSE_RADIUS;
  }

  private completePlant(actor: CompCombatant, site: CompSiteId): void {
    this.bomb = { ...this.bomb, state: 'planted', site, fuse: COMP_BOMB_FUSE, carrierId: actor.id };
    actor.plants++;
    // The plant pays the whole attacking team, win or lose — that is the point of
    // a successful execute.
    for (const c of this.roster(actor.team)) this.pay(c, COMP_PLANT_REWARD);
    this.emit({ type: 'bomb-planted', actorId: actor.id, site });
  }

  private completeDefuse(actor: CompCombatant): void {
    const site = this.bomb.site ?? 'A';
    this.bomb = { ...this.bomb, state: 'defused', fuse: 0 };
    actor.defuses++;
    for (const c of this.roster(actor.team)) this.pay(c, COMP_DEFUSE_REWARD);
    this.action = null;
    this.emit({ type: 'bomb-defused', actorId: actor.id, site });
    this.resolveRound(actor.team, 'defuse');
  }

  // ---------------------------------------------------------- round end ----
  private resolveRound(winner: CompTeam, reason: CompWinReason): void {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.action = null;
    this.score[winner]++;
    this.history.push(winner);
    this.lastRound = { winner, reason };
    // Round MVP: most kills this round, plants/defuses break the tie.
    this.awardMvp(winner);
    this.phase = 'roundEnd';
    this.timeLeft = COMP_ROUND_END_SECONDS;
    this.emit({ type: 'round-end', winner, reason, score: { ...this.score }, round: this.round });
  }

  private awardMvp(team: CompTeam): void {
    const pool = this.roster(team);
    let best: CompCombatant | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const score = c.kills * 3 + c.plants * 2 + c.defuses * 2 + c.damage / 400;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && best.kills + best.plants + best.defuses > 0) best.mvps++;
  }

  private advanceAfterRoundEnd(): void {
    // Pay out the round before anyone sees the next buy menu: win bonus, loss
    // ladder, and the loss of everything carried by operators who died.
    this.settleRoundEconomy();
    const need = this.roundsToWin;
    /** Regulation is best-of-thirteen: 12 rounds, and the 13th only exists in OT. */
    const regulationRounds = need * 2 - 2;
    if (!this.overtime) {
      if (this.score.alpha >= need || this.score.bravo >= need) {
        const winner = this.score.alpha > this.score.bravo ? 'alpha' : 'bravo';
        this.finish(winner, false);
        return;
      }
      if (this.round >= regulationRounds) {
        if (this.score.alpha === this.score.bravo) this.beginOvertime();
        else this.finish(this.score.alpha > this.score.bravo ? 'alpha' : 'bravo', false);
        return;
      }
      if (this.round === COMP_HALFTIME_ROUNDS) {
        this.halftime();
        return;
      }
      this.beginRound(this.round + 1);
      return;
    }
    // Overtime: lead by two, or a draw after the hard cap.
    if (Math.abs(this.score.alpha - this.score.bravo) >= 2) {
      this.finish(this.score.alpha > this.score.bravo ? 'alpha' : 'bravo', false);
      return;
    }
    if (this.round >= regulationRounds + COMP_OVERTIME_MAX_ROUNDS) { this.finish(null, true); return; }
    this.beginRound(this.round + 1);
  }

  private halftime(): void {
    const swap: Record<CompTeam, CompSide> = { alpha: otherSide(this.side.alpha), bravo: otherSide(this.side.bravo) };
    this.side = swap;
    this.lossStreak = { alpha: 0, bravo: 0 };
    for (const c of this.combatants) {
      c.money = COMP_START_MONEY;
      c.primary = null;
      c.armor = 0; c.helmet = false; c.kit = false; c.frags = 0; c.flashes = 0;
    }
    this.lastCarrier = null;
    this.emit({ type: 'halftime', side: { ...this.side } });
    this.beginRound(this.round + 1);
  }

  private beginOvertime(): void {
    this.overtime = true;
    // Overtime opens with another side swap, exactly like the half.
    this.side = { alpha: otherSide(this.side.alpha), bravo: otherSide(this.side.bravo) };
    this.lossStreak = { alpha: 0, bravo: 0 };
    for (const c of this.combatants) {
      c.money = COMP_OVERTIME_START_MONEY;
      c.primary = null;
      c.armor = 0; c.helmet = false; c.kit = false; c.frags = 0; c.flashes = 0;
    }
    this.emit({ type: 'overtime', round: this.round + 1 });
    this.beginRound(this.round + 1);
  }

  private finish(winner: CompTeam | null, draw: boolean): void {
    this.winner = winner;
    this.draw = draw;
    this.phase = 'matchEnd';
    this.timeLeft = 0;
    this.emit({ type: 'match-end', winner, draw, score: { ...this.score } });
    this.emit({ type: 'phase', phase: 'matchEnd', round: this.round });
  }

  // ------------------------------------------------------------ economy ----
  private pay(actor: CompCombatant, amount: number): void {
    actor.money = Math.min(COMP_MAX_MONEY, actor.money + amount);
  }

  /** Public form used by the orchestrator for objective bonuses. */
  awardMoney(id: string, amount: number): void {
    const actor = this.of(id);
    if (actor) this.pay(actor, amount);
  }

  /** Pay the round out. Also callable directly by tests and the debrief. */
  settleRoundEconomy(): void {
    const result = this.lastRound;
    if (!result) return;
    const { winner } = result;
    const loser = otherTeam(winner);
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, COMP_LOSS_REWARDS.length);
    this.lossStreak[winner] = 0;
    const lossReward = COMP_LOSS_REWARDS[Math.max(0, this.lossStreak[loser] - 1)];
    for (const c of this.roster(winner)) this.pay(c, COMP_WIN_REWARD);
    for (const c of this.roster(loser)) this.pay(c, lossReward);
    // Dead combatants lose everything they were carrying; survivors keep it.
    for (const c of this.combatants) {
      if (c.deadThisRound) {
        c.primary = null;
        c.secondary = this.starterFor(c);
        c.armor = 0; c.helmet = false; c.kit = false; c.frags = 0; c.flashes = 0;
      }
      c.deadThisRound = false;
    }
  }

  private starterFor(actor: CompCombatant): WeaponId {
    void actor;
    return 'm1911';
  }

  // ------------------------------------------------------------- buying ----
  /** Everything affordable + legal for this combatant right now. */
  purchaseOptions(id: string): { item: CompBuyItem; affordable: boolean; legal: boolean }[] {
    const actor = this.of(id);
    if (!actor) return [];
    return COMP_BUY_ITEMS.filter(item => item.side === undefined || item.side === this.sideOfId(id)).map(item => {
      const legal = this.buyLegal(actor, item);
      return { item, affordable: actor.money >= item.price, legal: legal === true };
    });
  }

  /** Validate a purchase without applying it. Returns an error string or true. */
  buyLegal(actor: CompCombatant, item: CompBuyItem): true | string {
    if (this.phase !== 'buy') return 'Buy phase over';
    if (!actor.alive) return 'Eliminated';
    if (actor.money < item.price) return 'Not enough funds';
    if (item.slot === 'primary' && actor.primary) return 'Already fielding a primary';
    if (item.slot === 'secondary') {
      if (!item.weapon) return 'Invalid slot';
      if (actor.secondary === item.weapon && actor.primary) return 'Already carried';
    }
    if (item.kind === 'armor' && actor.armor >= 100 && (!item.helmet || actor.helmet)) return 'Already armored';
    if (item.kind === 'armor' && actor.helmet && item.helmet) return 'Already armored';
    if (item.kind === 'kit' && actor.kit) return 'Kit already carried';
    if (item.kind === 'kit' && this.sideOfId(actor.id) !== 'defend') return 'Defenders only';
    if (item.kind === 'nade') {
      const total = actor.frags + actor.flashes;
      if (total >= 4) return 'Utility slots full';
      if (item.nade === 'frag' && actor.frags >= 2) return 'Frag limit reached';
      if (item.nade === 'flash' && actor.flashes >= 2) return 'Flash limit reached';
    }
    return true;
  }

  /**
   * Apply a purchase. Returns false when it was rejected, so callers can play a
   * deny sound instead of silently taking money.
   */
  buy(id: string, itemId: string): boolean {
    const actor = this.of(id);
    const item = buyItemById(itemId);
    if (!actor || !item) return false;
    if (this.buyLegal(actor, item) !== true) return false;
    actor.money -= item.price;
    if (item.slot === 'primary' && item.weapon) actor.primary = item.weapon;
    if (item.slot === 'secondary' && item.weapon) actor.secondary = item.weapon;
    if (item.kind === 'armor') { actor.armor = 100; actor.helmet = item.helmet === true; }
    if (item.kind === 'kit') actor.kit = true;
    if (item.kind === 'nade' && item.nade) {
      if (item.nade === 'frag') actor.frags++;
      else if (item.nade === 'flash') actor.flashes++;
      else { actor.frags++; actor.flashes++; }
    }
    this.emit({ type: 'buy', actorId: id, itemId, cost: item.price });
    return true;
  }

  /** Give the armor pool back to a full 100 (used when a bot rebuys). */
  refillArmor(id: string): void {
    const actor = this.of(id);
    if (actor) actor.armor = Math.max(actor.armor, 100);
  }
}
