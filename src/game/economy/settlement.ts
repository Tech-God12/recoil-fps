// Recoil FPS — end-of-match accounting shared by story operations and TDM.
import { grantCash, type PlayerProfile } from './profile';
import { gradeBonus, gradeFor } from './rewards';
import type { RankedProfile } from './rank';

export interface SettlementInput {
  win: boolean;
  kills: number;
  shots: number;
  hits: number;
  cash: number;
  difficultyMul: number;
  tdm?: { outcome: 'win' | 'loss' | 'draw' };
  /** Ranked is authoritative even when a scoreboard is also supplied as `tdm`. */
  comp?: { next: RankedProfile };
}

export interface SettlementWallet { before: number; after: number; gradeBonus: number; earned: number }

export function settleResult(profile: PlayerProfile, result: SettlementInput): { profile: PlayerProfile; wallet: SettlementWallet } {
  // Story/TDM grade bonuses are already established. Ranked pays its round-based
  // earnings instead; its rating and placements move exactly once at settlement.
  const bonus = result.comp ? 0 : result.win ? gradeBonus(gradeFor(result).grade) : 0;
  const earned = Math.round(result.cash * result.difficultyMul) + bonus;
  const next = grantCash(profile, earned, result.comp ? 'BLACKOUT' : result.tdm ? 'TDM' : 'MISSION');
  if (result.comp) next.ranked = { ...result.comp.next };
  if (!result.tdm && !result.comp) next.missions += 1;
  next.kills += result.kills;
  return {
    profile: next,
    wallet: { before: profile.cash, after: next.cash, gradeBonus: bonus, earned },
  };
}
