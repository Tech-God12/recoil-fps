// Recoil FPS — Bomb Defusal: competitive round rules + economy.
// Pure module (no three.js / DOM) so every rule is unit-testable under Node.
//
// Modelled on the CS2 competitive ruleset, retuned for a 5v5 bot lobby:
//   · freeze time with a buy phase, 1:45 rounds, 40 s bomb, 3.2 s plant,
//     10 s defuse (5 s with a kit)
//   · kill rewards per weapon class, round-win rewards per win condition,
//     a five-step loss-bonus ladder and the plant bonus on a lost round
//   · halftime side swap with an economy reset, and a sudden-death decider
//     round (everyone on $10,000) when regulation ends level.
import type { WeaponId } from '../economy/catalog';

export type DefuseTeam = 'alpha' | 'bravo';
export type DefuseSide = 'attack' | 'defend';
export type SiteId = 'A' | 'B';
export type RoundEndReason = 'elimination' | 'bomb' | 'defuse' | 'time';
export type RoundPhase = 'freeze' | 'live' | 'planted' | 'post' | 'over';

export const DEFUSE = {
  freezeTime: 12,
  roundTime: 105,
  bombTime: 40,
  plantTime: 3.2,
  defuseTime: 10,
  kitDefuseTime: 5,
  postRound: 6,
  /** Seconds after the freeze ends during which the spawn buy zone stays open. */
  buyWindow: 20,
  startMoney: 800,
  maxMoney: 16000,
  suddenDeathMoney: 10000,
  hp: 100,
  /** Lethal radius of the bomb blast; damage falls off linearly to the edge. */
  blastRadius: 26,
  blastDamage: 500,
} as const;

export const ROUND_REWARD: Record<RoundEndReason, number> = {
  elimination: 3250,
  time: 3250,
  bomb: 3500,
  defuse: 3500,
};
/** Consecutive-loss income ladder (1st loss … 5th+ loss). */
export const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400] as const;
export const PLANT_TEAM_BONUS = 800;
export const PLANT_PLAYER_BONUS = 300;
export const DEFUSE_PLAYER_BONUS = 300;

/** Body/head armor reduction in this mode. Kevlar blunts body shots; the helmet
 * stops rifle one-taps from the M416 (the AK still one-taps — as it should). */
export const DEFUSE_BODY_REDUCTION = 0.25;
export const DEFUSE_HEAD_REDUCTION = 0.2;

export interface MatchFormat {
  id: 'short' | 'standard';
  label: string;
  sub: string;
  maxRounds: number;
  winTarget: number;
  /** Sides swap after this many rounds. */
  half: number;
}
export const MATCH_FORMATS: MatchFormat[] = [
  { id: 'short', label: 'Short match', sub: 'First to 5 · swap after 4', maxRounds: 8, winTarget: 5, half: 4 },
  { id: 'standard', label: 'Competitive', sub: 'First to 7 · swap after 6', maxRounds: 12, winTarget: 7, half: 6 },
];
export const formatById = (id: string | undefined): MatchFormat =>
  MATCH_FORMATS.find(f => f.id === id) ?? MATCH_FORMATS[0];

// ============================ BUY MENU ============================
export type BuyCategory = 'pistol' | 'smg' | 'rifle' | 'heavy' | 'gear' | 'grenade';
export type GearId = 'kevlar' | 'helmet' | 'kit' | 'frag' | 'flash';
export type BuyItemId = WeaponId | GearId;

export interface BuyItem {
  id: BuyItemId;
  name: string;
  price: number;
  category: BuyCategory;
  /** Weapon slot for guns; absent for gear. */
  slot?: 'primary' | 'secondary';
  /** Cash paid to the shooter per kill with this weapon. */
  killReward: number;
  /** Side-restricted item (the defuse kit is defenders-only). */
  side?: DefuseSide;
  blurb: string;
}

export const BUY_ITEMS: BuyItem[] = [
  { id: 'm1911', name: '1911', price: 200, category: 'pistol', slot: 'secondary', killReward: 300, blurb: 'Default sidearm. Precise, forgiving.' },
  { id: 'deagle', name: 'Deagle', price: 700, category: 'pistol', slot: 'secondary', killReward: 300, blurb: 'Hand cannon. Head-shot eco king.' },
  { id: 'mp7', name: 'MP', price: 1250, category: 'pistol', slot: 'secondary', killReward: 600, blurb: 'Machine pistol. Sidearm slot, SMG bite.' },
  { id: 'vector', name: 'Vector', price: 1500, category: 'smg', slot: 'primary', killReward: 600, blurb: 'Blistering 1100 RPM. The force-buy.' },
  { id: 'spas12', name: 'SPAS', price: 1200, category: 'smg', slot: 'primary', killReward: 900, blurb: 'Close-quarters slam. Hold a door.' },
  { id: 'ak47', name: 'AK-47', price: 2700, category: 'rifle', slot: 'primary', killReward: 300, blurb: 'One-tap headshots through a helmet.' },
  { id: 'm4a1', name: 'M416', price: 3100, category: 'rifle', slot: 'primary', killReward: 300, blurb: 'Fast, controllable, the defender\'s rifle.' },
  { id: 'scar_h', name: 'SCAR', price: 3500, category: 'rifle', slot: 'primary', killReward: 300, blurb: '7.62 battle rifle. Hits like a truck.' },
  { id: 'awm', name: 'AWM', price: 4750, category: 'heavy', slot: 'primary', killReward: 100, blurb: 'One shot, one kill. Owns a lane.' },
  { id: 'm249', name: 'M249', price: 5200, category: 'heavy', slot: 'primary', killReward: 300, blurb: '100-round belt. Spam the smoke.' },
  { id: 'kevlar', name: 'Kevlar Vest', price: 650, category: 'gear', killReward: 0, blurb: '−25% body damage.' },
  { id: 'helmet', name: 'Kevlar + Helmet', price: 1000, category: 'gear', killReward: 0, blurb: 'Vest plus −20% head damage.' },
  { id: 'kit', name: 'Defuse Kit', price: 400, category: 'gear', killReward: 0, side: 'defend', blurb: 'Halves defuse time: 10 s → 5 s.' },
  { id: 'frag', name: 'Frag Grenade', price: 300, category: 'grenade', killReward: 300, blurb: 'Max 1. Clears corners.' },
  { id: 'flash', name: 'Flashbang', price: 200, category: 'grenade', killReward: 0, blurb: 'Max 2. Blind, then swing.' },
];
export const buyItem = (id: string): BuyItem | undefined => BUY_ITEMS.find(i => i.id === id);
export const BUY_CATEGORIES: { id: BuyCategory; label: string; key: string }[] = [
  { id: 'pistol', label: 'Pistols', key: '1' },
  { id: 'smg', label: 'SMG · Shotgun', key: '2' },
  { id: 'rifle', label: 'Rifles', key: '3' },
  { id: 'heavy', label: 'Heavy', key: '4' },
  { id: 'gear', label: 'Gear', key: '5' },
  { id: 'grenade', label: 'Grenades', key: '6' },
];
export const MAX_FRAGS = 1;
export const MAX_FLASHES = 2;

/** Everything the buy menu needs to know about one combatant's current kit. */
export interface Kit {
  money: number;
  primary: WeaponId | null;
  secondary: WeaponId;
  armor: 0 | 1 | 2; // none / kevlar / kevlar+helmet
  kit: boolean;
  frags: number;
  flashes: number;
}

export const freshKit = (money: number = DEFUSE.startMoney): Kit => ({
  money, primary: null, secondary: 'm1911', armor: 0, kit: false, frags: 0, flashes: 0,
});

/** Effective price for this kit (a helmet upgrade on existing kevlar costs only the difference). */
export function effectivePrice(item: BuyItem, kit: Kit): number {
  if (item.id === 'helmet' && kit.armor === 1) return 350;
  return item.price;
}

export type BuyCheck = { ok: true; price: number } | { ok: false; reason: string };

export function canBuy(id: string, kit: Kit, side: DefuseSide): BuyCheck {
  const item = buyItem(id);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (item.side && item.side !== side) return { ok: false, reason: 'Defenders only' };
  const price = effectivePrice(item, kit);
  if (item.slot === 'primary' && kit.primary === item.id) return { ok: false, reason: 'Already equipped' };
  if (item.slot === 'secondary' && kit.secondary === item.id) return { ok: false, reason: 'Already equipped' };
  if (item.id === 'kevlar' && kit.armor >= 1) return { ok: false, reason: 'Already armored' };
  if (item.id === 'helmet' && kit.armor >= 2) return { ok: false, reason: 'Already armored' };
  if (item.id === 'kit' && kit.kit) return { ok: false, reason: 'Already carrying a kit' };
  if (item.id === 'frag' && kit.frags >= MAX_FRAGS) return { ok: false, reason: 'Carrying the max' };
  if (item.id === 'flash' && kit.flashes >= MAX_FLASHES) return { ok: false, reason: 'Carrying the max' };
  if (kit.money < price) return { ok: false, reason: 'Not enough money' };
  return { ok: true, price };
}

/** Apply a purchase. Returns a NEW kit; the input is never mutated. */
export function applyBuy(id: string, kit: Kit, side: DefuseSide): { kit: Kit; check: BuyCheck } {
  const check = canBuy(id, kit, side);
  if (!check.ok) return { kit, check };
  const item = buyItem(id)!;
  const next: Kit = { ...kit, money: kit.money - check.price };
  if (item.slot === 'primary') next.primary = item.id as WeaponId;
  else if (item.slot === 'secondary') next.secondary = item.id as WeaponId;
  else if (item.id === 'kevlar') next.armor = 1;
  else if (item.id === 'helmet') next.armor = 2;
  else if (item.id === 'kit') next.kit = true;
  else if (item.id === 'frag') next.frags += 1;
  else if (item.id === 'flash') next.flashes += 1;
  return { kit: next, check };
}

export const clampMoney = (m: number) => Math.max(0, Math.min(DEFUSE.maxMoney, Math.round(m)));

/** Cash per kill for the weapon that landed it ('FRAG' → grenade reward). */
export function killReward(weapon: string): number {
  if (weapon === 'FRAG') return 300;
  const byId = buyItem(weapon);
  if (byId) return byId.killReward;
  const byName = BUY_ITEMS.find(i => i.name.toUpperCase() === weapon.toUpperCase());
  return byName?.killReward ?? 300;
}

export function lossBonus(consecutiveLosses: number): number {
  const i = Math.max(0, Math.min(LOSS_BONUS.length - 1, consecutiveLosses - 1));
  return LOSS_BONUS[i];
}

/**
 * End-of-round income for one team member.
 * - winners: the win-condition reward
 * - losers: the loss-bonus ladder, +$800 team plant bonus for attackers who planted
 * - attackers who SURVIVE a time-expiry loss get nothing (the CS "save" tax)
 */
export function roundIncome(opts: {
  won: boolean; reason: RoundEndReason; side: DefuseSide; lossStreak: number; planted: boolean; survived: boolean;
}): number {
  if (opts.won) return ROUND_REWARD[opts.reason];
  if (opts.side === 'attack' && opts.reason === 'time' && opts.survived) return 0;
  return lossBonus(opts.lossStreak) + (opts.side === 'attack' && opts.planted ? PLANT_TEAM_BONUS : 0);
}

// ============================ MATCH FLOW ============================
export interface RoundRecord {
  round: number;
  winner: DefuseTeam;
  reason: RoundEndReason;
  alphaSide: DefuseSide;
  mvp: string;
}

export interface RoundOutcome {
  halftime: boolean;
  over: boolean;
  suddenDeath: boolean;
  matchPoint: boolean;
}

export class DefuseMatch {
  alphaScore = 0;
  bravoScore = 0;
  /** 1-based index of the round being played. */
  round = 1;
  history: RoundRecord[] = [];
  /** Consecutive losses per team (drives the loss bonus). */
  lossStreak: Record<DefuseTeam, number> = { alpha: 0, bravo: 0 };
  readonly format: MatchFormat;
  readonly alphaStartSide: DefuseSide;

  constructor(format: MatchFormat, alphaStartSide: DefuseSide) {
    this.format = format;
    this.alphaStartSide = alphaStartSide;
  }

  /** Sides for a round (1-based). Sudden death keeps second-half sides. */
  sideOf(team: DefuseTeam, round = this.round): DefuseSide {
    const firstHalf = round <= this.format.half;
    const alpha: DefuseSide = firstHalf ? this.alphaStartSide : (this.alphaStartSide === 'attack' ? 'defend' : 'attack');
    return team === 'alpha' ? alpha : (alpha === 'attack' ? 'defend' : 'attack');
  }
  teamOn(side: DefuseSide, round = this.round): DefuseTeam {
    return this.sideOf('alpha', round) === side ? 'alpha' : 'bravo';
  }

  get suddenDeath(): boolean { return this.round > this.format.maxRounds; }
  /** First round of either half (or the decider): pistol/fresh-economy round. */
  get pistolRound(): boolean { return this.round === 1 || this.round === this.format.half + 1; }
  get lastRoundOfHalf(): boolean { return this.round === this.format.half; }

  scoreOf(team: DefuseTeam) { return team === 'alpha' ? this.alphaScore : this.bravoScore; }

  isOver(): boolean {
    const { winTarget, maxRounds } = this.format;
    if (this.alphaScore >= winTarget || this.bravoScore >= winTarget) return true;
    const played = this.history.length;
    if (played > maxRounds) return true; // decider has been played
    return false;
  }

  winner(): DefuseTeam | 'draw' {
    if (this.alphaScore === this.bravoScore) return 'draw';
    return this.alphaScore > this.bravoScore ? 'alpha' : 'bravo';
  }

  /** True when either team is one round from victory. */
  matchPointFor(): DefuseTeam | null {
    const t = this.format.winTarget - 1;
    if (this.alphaScore === t && this.bravoScore < t + 1) return 'alpha';
    if (this.bravoScore === t && this.alphaScore < t + 1) return 'bravo';
    return null;
  }

  recordRound(winner: DefuseTeam, reason: RoundEndReason, mvp: string): RoundOutcome {
    const loser: DefuseTeam = winner === 'alpha' ? 'bravo' : 'alpha';
    this.history.push({ round: this.round, winner, reason, alphaSide: this.sideOf('alpha'), mvp });
    if (winner === 'alpha') this.alphaScore++; else this.bravoScore++;
    // Winning resets your own ladder one notch down (CS2 behaviour: -1 per win).
    this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);
    this.lossStreak[loser] = Math.min(LOSS_BONUS.length, this.lossStreak[loser] + 1);
    const halftime = this.round === this.format.half;
    if (halftime) this.lossStreak = { alpha: 0, bravo: 0 };
    const { winTarget, maxRounds } = this.format;
    const decided = this.alphaScore >= winTarget || this.bravoScore >= winTarget;
    const regulationDone = this.round >= maxRounds;
    const tied = this.alphaScore === this.bravoScore;
    const over = decided || (regulationDone && !tied) || this.round > maxRounds;
    const suddenDeath = !over && regulationDone && tied;
    this.round++;
    return { halftime: halftime && !over, over, suddenDeath, matchPoint: !over && this.matchPointFor() !== null };
  }
}

/** Human label for a round-end reason from the WINNER's perspective. */
export function reasonLabel(reason: RoundEndReason): string {
  switch (reason) {
    case 'elimination': return 'Enemies eliminated';
    case 'bomb': return 'Target destroyed';
    case 'defuse': return 'Bomb defused';
    case 'time': return 'Time expired — target saved';
  }
}

/** Beep interval (seconds) of the planted bomb for a given time remaining — CS-style acceleration. */
export function beepInterval(timeLeft: number): number {
  if (timeLeft <= 1) return 0.08;
  if (timeLeft <= 2) return 0.12;
  if (timeLeft <= 5) return 0.25;
  if (timeLeft <= 10) return 0.45;
  if (timeLeft <= 20) return 0.7;
  return 1.0;
}
