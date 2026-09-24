// ============================================================================
// OPERATION BLACKOUT — Ranked ladder.
//
// A rating ladder with seven tiers (SUBJECT: public, instantly legible names),
// three divisions each, and a skill-rating update that rewards winning first and
// individual impact second. Pure maths + pure reducers: the HUD, the debrief and
// the menu badge all read the same numbers.
// ============================================================================

export type RankTierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master' | 'grandmaster';

export interface RankTier {
  id: RankTierId;
  name: string;
  min: number;
  max: number;
  /** Accent colour for badges and bars. */
  color: string;
  /** Grandmaster is a single band; everything else splits III → I. */
  divisions: number;
}

export const RATING_FLOOR = 0;
export const RATING_CEILING = 3500;
export const PLACEMENT_MATCHES = 5;
/** Placement matches swing harder so a new account finds its tier quickly. */
export const PLACEMENT_MULTIPLIER = 1.75;

export const RANK_TIERS: RankTier[] = [
  { id: 'bronze', name: 'BRONZE', min: 0, max: 599, color: '#A9724A', divisions: 3 },
  { id: 'silver', name: 'SILVER', min: 600, max: 1099, color: '#B9C2C8', divisions: 3 },
  { id: 'gold', name: 'GOLD', min: 1100, max: 1599, color: '#D8B07A', divisions: 3 },
  { id: 'platinum', name: 'PLATINUM', min: 1600, max: 1999, color: '#7FC5D8', divisions: 3 },
  { id: 'diamond', name: 'DIAMOND', min: 2000, max: 2399, color: '#8FB7FF', divisions: 3 },
  { id: 'master', name: 'MASTER', min: 2400, max: 2899, color: '#C88BE0', divisions: 3 },
  { id: 'grandmaster', name: 'GRANDMASTER', min: 2900, max: RATING_CEILING, color: '#FF6A2B', divisions: 1 },
];

export const RATING_START = 1000;

export interface RankedProfile {
  rating: number;
  peak: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  placements: number;
  /** Consecutive wins (negative = losing streak) for the streak flag. */
  streak: number;
}

export const DEFAULT_RANKED: RankedProfile = {
  rating: RATING_START, peak: RATING_START, wins: 0, losses: 0, draws: 0, matches: 0, placements: 0, streak: 0,
};

const ROMAN = ['III', 'II', 'I'] as const;

export interface RankView {
  tier: RankTier;
  division: number;
  /** "GOLD II" */
  label: string;
  /** Progress through the current division, 0..1. */
  divisionProgress: number;
  /** Progress through the current tier, 0..1 — drives the long bar. */
  tierProgress: number;
  ratingToNext: number;
  placed: boolean;
  placementsLeft: number;
}

export const clampRating = (value: number) => Math.max(RATING_FLOOR, Math.min(RATING_CEILING, Math.round(value)));

/** Everything the UI needs to render a rank badge, from one rating number. */
export function rankFor(rating: number, profile?: Pick<RankedProfile, 'placements'>): RankView {
  const clamped = clampRating(rating);
  const tier = RANK_TIERS.find(t => clamped >= t.min && clamped <= t.max) ?? RANK_TIERS[0];
  const span = tier.max - tier.min + 1;
  const intoTier = clamped - tier.min;
  const divisions = tier.divisions;
  const perDivision = span / divisions;
  const divisionIndex = Math.min(divisions - 1, Math.floor(intoTier / perDivision));
  const intoDivision = intoTier - divisionIndex * perDivision;
  const placementsLeft = profile ? Math.max(0, PLACEMENT_MATCHES - profile.placements) : 0;
  return {
    tier,
    division: divisions - divisionIndex, // III (lowest) → I (highest)
    label: divisions === 1 ? tier.name : `${tier.name} ${ROMAN[divisionIndex]}`,
    divisionProgress: Math.max(0, Math.min(1, intoDivision / perDivision)),
    tierProgress: Math.max(0, Math.min(1, intoTier / (span - 1))),
    ratingToNext: divisionIndex === divisions - 1
      ? (tier.id === 'grandmaster' ? 0 : RANK_TIERS[Math.min(RANK_TIERS.length - 1, RANK_TIERS.indexOf(tier) + 1)].min - clamped)
      : Math.ceil(tier.min + (divisionIndex + 1) * perDivision - clamped),
    placed: placementsLeft === 0,
    placementsLeft,
  };
}

export interface RatingInput {
  win: boolean;
  draw: boolean;
  /** Rounds won by the player's team / by the opponents. */
  roundsFor: number;
  roundsAgainst: number;
  kills: number;
  deaths: number;
  headshots: number;
  plants: number;
  defuses: number;
  mvp: number;
  current: RankedProfile;
}

export interface RatingResult {
  delta: number;
  breakdown: { outcome: number; performance: number; margin: number };
  placements: boolean;
  next: RankedProfile;
}

/**
 * Skill update. Outcome dominates, personal impact moves the needle, and the
 * round margin separates a 7-0 sweep from a 7-6 thriller. Placement matches
 * swing harder in both directions and never drop below zero rating.
 */
export function ratingDelta(input: RatingInput): RatingResult {
  const outcome = input.draw ? 0 : input.win ? 20 : -20;
  const kd = input.kills / Math.max(1, input.deaths);
  const rawPerf = (kd - 1) * 6 + input.headshots * 0.4 + input.plants * 2.5 + input.defuses * 2.5 + input.mvp * 2;
  const performance = Math.max(-10, Math.min(18, rawPerf));
  const margin = Math.max(-8, Math.min(8, (input.roundsFor - input.roundsAgainst) * 1.5));
  let delta = outcome + performance + margin;
  const placements = input.current.placements < PLACEMENT_MATCHES;
  if (placements) delta *= PLACEMENT_MULTIPLIER;
  delta = Math.round(Math.max(-42, Math.min(42, delta)));
  const rating = clampRating(input.current.rating + delta);
  const applied = rating - input.current.rating;
  const next: RankedProfile = {
    rating,
    peak: Math.max(input.current.peak, rating),
    wins: input.current.wins + (input.win && !input.draw ? 1 : 0),
    losses: input.current.losses + (!input.win && !input.draw ? 1 : 0),
    draws: input.current.draws + (input.draw ? 1 : 0),
    matches: input.current.matches + 1,
    placements: Math.min(PLACEMENT_MATCHES, input.current.placements + 1),
    streak: input.win && !input.draw
      ? Math.max(1, input.current.streak + 1)
      : input.draw ? input.current.streak : Math.min(-1, input.current.streak - 1),
  };
  return { delta: applied, breakdown: { outcome, performance: Math.round(performance), margin: Math.round(margin) }, placements, next };
}

/** Win rate as a whole-number percentage (draws count as half a win). */
export function winRate(profile: RankedProfile): number {
  const played = profile.wins + profile.losses + profile.draws;
  if (!played) return 0;
  return Math.round(((profile.wins + profile.draws * 0.5) / played) * 100);
}

/** Coat-of-arms glyph for each tier, drawn as text so no art pipeline is needed. */
export const RANK_GLYPH: Record<RankTierId, string> = {
  bronze: '◈',
  silver: '◈◈',
  gold: '✦',
  platinum: '✦✦',
  diamond: '❖',
  master: '❖✦',
  grandmaster: '✪',
};
