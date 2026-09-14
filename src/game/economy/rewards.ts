// Recoil FPS — cash economy formulas (pure, no three.js / React).
// A competent first run (~15 kills, all phases, win, B grade) pays ≈ $3,350.

export const REWARDS = { kill: 100, headshot: 150, grenadeKill: 100, phase: 200, extraction: 750 } as const;

export interface GradeInput { win: boolean; kills: number; shots: number; hits: number }

/**
 * Performance grade. Moved here from Screens.tsx so the debrief payout and the
 * results stamp share one implementation. Thresholds are pinned by tests.
 */
export function gradeFor(r: GradeInput): { grade: string; tint: string } {
  const accuracy = r.shots ? Math.round(r.hits / r.shots * 100) : 0;
  const score = (r.win ? 60 : 0) + Math.min(20, r.kills * 2) + Math.min(20, accuracy / 5);
  const grade = score >= 95 ? 'S' : score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
  return { grade, tint: grade === 'S' || grade === 'A' ? '#3FD68E' : grade === 'B' ? '#E8B93C' : '#E5484D' };
}

export function gradeBonus(grade: string): number {
  if (grade === 'S') return 600;
  if (grade === 'A') return 400;
  if (grade === 'B') return 200;
  if (grade === 'C') return 100;
  return 0;
}

/** Streak-mark award: each mark pays once per chain — $50 at 3, $100 at 4, $150 at 5. */
export function streakBonus(streak: number): number {
  if (streak === 3) return 50;
  if (streak === 4) return 100;
  if (streak === 5) return 150;
  return 0;
}

/**
 * Gate a streak payout so chains cannot farm: the mark pays only if it is above
 * paidMark (highest mark already paid in this chain), and the run-wide streak
 * pot cannot exceed capLeft. A full 5-chain pays at most $50+$100+$150 = $300.
 */
export function streakAward(streak: number, paidMark: number, capLeft: number): number {
  if (streak < 3 || streak > 5 || streak <= paidMark || capLeft <= 0) return 0;
  return Math.min(streakBonus(streak), capLeft);
}

/** Debrief multiplier from the live difficulty ids (Easy / Normal / Hard). */
export function difficultyMultiplier(difficulty: string): number {
  if (difficulty === 'Easy') return 0.8;
  if (difficulty === 'Hard') return 1.25;
  return 1.0;
}
