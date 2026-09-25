// Recoil FPS — Bomb Defusal competitive rules (PURE: no three.js, React or DOM).
// CS2-faithful round flow and economy. The three.js mode (defusal/mode.ts) drives
// this state machine; every number is game design and is pinned by
// tests/defusal-rules.test.js.

export type Side = 'attack' | 'defend';
/** alpha is always the player's squad (same convention as the Warehouse TDM). */
export type TeamId = 'alpha' | 'bravo';
export type RoundEndReason = 'elimination' | 'bomb' | 'defuse' | 'time';
export type MatchFormatId = 'short' | 'long';
export type RoundPhase = 'freeze' | 'live' | 'planted' | 'over' | 'halftime' | 'ended';

export interface MatchFormat { id: MatchFormatId; label: string; roundsToWin: number; halftimeAfter: number; maxRounds: number }
export const MATCH_FORMATS: Record<MatchFormatId, MatchFormat> = {
  short: { id: 'short', label: 'Short match', roundsToWin: 7, halftimeAfter: 6, maxRounds: 12 },
  long: { id: 'long', label: 'Full match', roundsToWin: 13, halftimeAfter: 12, maxRounds: 24 },
};

/** Seconds. */
export const TIMING = {
  /** Buy phase: movement locked, buy menu open everywhere in the buy zone. */
  freeze: 10,
  /** Buying stays open this long into the live round (buy zone only). */
  buyGrace: 15,
  round: 105,
  bomb: 40,
  plant: 3.2,
  defuse: 10,
  defuseKit: 5,
  roundEnd: 5,
  halftime: 6,
} as const;

export const ECONOMY = {
  start: 800,
  max: 16000,
  winElimination: 3250,
  winTime: 3250,
  winBomb: 3500,
  winDefuse: 3500,
  /** Indexed by (consecutive-loss counter − 1) after the loss is counted. */
  lossLadder: [1400, 1900, 2400, 2900, 3400] as const,
  /** CS2: each half starts with one "banked" loss, so the pistol-round loser gets $1,900. */
  startingLosses: 1,
  /** Every attacker on a lost round in which the bomb was planted. */
  plantTeamBonus: 800,
  plantPersonal: 300,
  defusePersonal: 300,
} as const;

export type KillClass = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'lmg' | 'grenade';
export const KILL_REWARD: Record<KillClass, number> = {
  pistol: 300, smg: 600, shotgun: 900, rifle: 300, sniper: 100, lmg: 300, grenade: 300,
};

export const other = (team: TeamId): TeamId => (team === 'alpha' ? 'bravo' : 'alpha');
export const flip = (side: Side): Side => (side === 'attack' ? 'defend' : 'attack');

/** Loss bonus for a team whose counter has just been advanced to `lossesAfter`. */
export function lossBonus(lossesAfter: number): number {
  const i = Math.max(1, Math.min(ECONOMY.lossLadder.length, Math.round(lossesAfter))) - 1;
  return ECONOMY.lossLadder[i];
}

export function winReward(reason: RoundEndReason): number {
  if (reason === 'bomb') return ECONOMY.winBomb;
  if (reason === 'defuse') return ECONOMY.winDefuse;
  if (reason === 'time') return ECONOMY.winTime;
  return ECONOMY.winElimination;
}

export interface PayoutInput {
  won: boolean;
  side: Side;
  reason: RoundEndReason;
  planted: boolean;
  /** Alive when the round ended. */
  alive: boolean;
  /** Team loss counter AFTER this round was scored. */
  lossesAfter: number;
}

/** Round-end money for one combatant (personal plant/defuse bonuses are paid live). */
export function roundPayout(p: PayoutInput): number {
  if (p.won) return winReward(p.reason);
  // CS rule: attackers who hide until the clock runs out earn nothing at all.
  if (p.reason === 'time' && p.side === 'attack' && p.alive) return 0;
  return lossBonus(p.lossesAfter) + (p.side === 'attack' && p.planted ? ECONOMY.plantTeamBonus : 0);
}

export function clampMoney(amount: number): number {
  return Math.max(0, Math.min(ECONOMY.max, Math.round(amount)));
}

export interface RoundRecord {
  round: number;
  half: 1 | 2;
  winner: TeamId;
  winnerSide: Side;
  reason: RoundEndReason;
  planted: boolean;
  /** Score after this round. */
  alphaScore: number;
  bravoScore: number;
}

export type MatchTransition =
  | { type: 'live' }
  | { type: 'end'; record: RoundRecord }
  | { type: 'round'; round: number; swapped: boolean }
  | { type: 'halftime' }
  | { type: 'ended'; winner: TeamId | 'draw' };

/**
 * Authoritative match clock and score. The mode reports eliminations, plants and
 * defuses; the state machine itself ends rounds on the round timer (defenders win)
 * and on the bomb timer (attackers win), and handles halftime and match point.
 */
export class MatchState {
  readonly format: MatchFormat;
  round = 1;
  score: Record<TeamId, number> = { alpha: 0, bravo: 0 };
  losses: Record<TeamId, number> = { alpha: ECONOMY.startingLosses, bravo: ECONOMY.startingLosses };
  alphaSide: Side;
  phase: RoundPhase = 'freeze';
  /** Seconds remaining in the current phase. */
  clock: number = TIMING.freeze;
  planted = false;
  history: RoundRecord[] = [];
  winner: TeamId | 'draw' | null = null;

  constructor(format: MatchFormatId | MatchFormat, alphaSide: Side) {
    this.format = typeof format === 'string' ? MATCH_FORMATS[format] : format;
    this.alphaSide = alphaSide;
  }

  sideOf(team: TeamId): Side { return team === 'alpha' ? this.alphaSide : flip(this.alphaSide); }
  teamOf(side: Side): TeamId { return this.alphaSide === side ? 'alpha' : 'bravo'; }
  get half(): 1 | 2 { return this.round <= this.format.halftimeAfter ? 1 : 2; }
  get lastRound(): RoundRecord | null { return this.history[this.history.length - 1] ?? null; }
  /** Rounds already decided. */
  get played(): number { return this.history.length; }
  /** Buying is legal (the mode additionally requires the buy zone). */
  get buyOpen(): boolean {
    return this.phase === 'freeze' || (this.phase === 'live' && TIMING.round - this.clock <= TIMING.buyGrace);
  }
  get isLastRoundOfHalf(): boolean { return this.round === this.format.halftimeAfter; }
  /** Teams one round away from winning the match. */
  matchPoint(): TeamId[] {
    const need = this.format.roundsToWin - 1;
    return (['alpha', 'bravo'] as TeamId[]).filter(t => this.score[t] === need);
  }

  /** Freeze time over — only callable by tick; exposed for tests. */
  private goLive(): void { this.phase = 'live'; this.clock = TIMING.round; }

  plant(): boolean {
    if (this.phase !== 'live') return false;
    this.phase = 'planted';
    this.planted = true;
    this.clock = TIMING.bomb;
    return true;
  }

  /** Score a round. Ignored unless a round is actually being played. */
  endRound(winnerSide: Side, reason: RoundEndReason): RoundRecord | null {
    if (this.phase !== 'live' && this.phase !== 'planted') return null;
    const winner = this.teamOf(winnerSide);
    const loser = other(winner);
    this.score[winner]++;
    this.losses[winner] = Math.max(0, this.losses[winner] - 1);
    this.losses[loser] = Math.min(ECONOMY.lossLadder.length, this.losses[loser] + 1);
    const record: RoundRecord = {
      round: this.round, half: this.half, winner, winnerSide, reason, planted: this.planted,
      alphaScore: this.score.alpha, bravoScore: this.score.bravo,
    };
    this.history.push(record);
    this.phase = 'over';
    this.clock = TIMING.roundEnd;
    if (this.score[winner] >= this.format.roundsToWin) this.winner = winner;
    else if (this.history.length >= this.format.maxRounds) this.winner = 'draw';
    return record;
  }

  private nextRound(swapped: boolean): MatchTransition {
    this.round++;
    this.phase = 'freeze';
    this.clock = TIMING.freeze;
    this.planted = false;
    return { type: 'round', round: this.round, swapped };
  }

  tick(dt: number): MatchTransition[] {
    const out: MatchTransition[] = [];
    if (this.phase === 'ended' || dt <= 0) return out;
    this.clock -= dt;
    if (this.clock > 0) return out;
    switch (this.phase) {
      case 'freeze':
        this.goLive();
        out.push({ type: 'live' });
        break;
      case 'live': {
        const record = this.endRound('defend', 'time');
        if (record) out.push({ type: 'end', record });
        break;
      }
      case 'planted': {
        const record = this.endRound('attack', 'bomb');
        if (record) out.push({ type: 'end', record });
        break;
      }
      case 'over':
        if (this.winner) {
          this.phase = 'ended';
          this.clock = 0;
          out.push({ type: 'ended', winner: this.winner });
        } else if (this.history.length === this.format.halftimeAfter) {
          this.phase = 'halftime';
          this.clock = TIMING.halftime;
          out.push({ type: 'halftime' });
        } else out.push(this.nextRound(false));
        break;
      case 'halftime':
        this.alphaSide = flip(this.alphaSide);
        this.losses = { alpha: ECONOMY.startingLosses, bravo: ECONOMY.startingLosses };
        out.push(this.nextRound(true));
        break;
    }
    return out;
  }
}

export interface MvpCandidate {
  id: string;
  team: TeamId;
  kills: number;
  damage: number;
  planted?: boolean;
  defused?: boolean;
}

/** CS rules: the defuser (defuse win) or planter (detonation win) takes MVP;
 * otherwise the winning player with most kills, damage breaking ties. */
export function pickMvp(round: Pick<RoundRecord, 'winner' | 'reason'>, players: MvpCandidate[]): string | null {
  const winners = players.filter(p => p.team === round.winner);
  if (!winners.length) return null;
  if (round.reason === 'defuse') { const d = winners.find(p => p.defused); if (d) return d.id; }
  if (round.reason === 'bomb') { const p = winners.find(q => q.planted); if (p) return p.id; }
  const best = [...winners].sort((a, b) => b.kills - a.kills || b.damage - a.damage)[0];
  return best.kills > 0 || best.damage > 0 || round.reason === 'time' ? best.id : null;
}

/** Scoreboard sort key: CS-style score (2/kill, 1/assist, 2/objective, 2/MVP... ) */
export function combatScore(s: { kills: number; assists: number; plants: number; defuses: number; mvps: number }): number {
  return s.kills * 2 + s.assists + s.plants * 2 + s.defuses * 2 + s.mvps * 2;
}
