// Recoil FPS — end-of-match accounting shared by story operations and TDM.
import { grantCash, type PlayerProfile } from './profile';
import { gradeBonus, gradeFor } from './rewards';

export interface SettlementInput {
  win: boolean;
  kills: number;
  shots: number;
  hits: number;
  cash: number;
  difficultyMul: number;
  tdm?: { outcome: 'win' | 'loss' | 'draw' };
}

export interface SettlementWallet { before: number; after: number; gradeBonus: number; earned: number }

export function settleResult(profile: PlayerProfile, result: SettlementInput): { profile: PlayerProfile; wallet: SettlementWallet } {
  const bonus = result.win ? gradeBonus(gradeFor(result).grade) : 0;
  const earned = Math.round(result.cash * result.difficultyMul) + bonus;
  const next = grantCash(profile, earned, result.tdm ? 'TDM' : 'MISSION');
  if (!result.tdm) next.missions += 1;
  next.kills += result.kills;
  return {
    profile: next,
    wallet: { before: profile.cash, after: next.cash, gradeBonus: bonus, earned },
  };
}
