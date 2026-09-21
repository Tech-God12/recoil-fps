// Recoil FPS — Warehouse TDM: armor ladder, TTK constants and the match roster.
// PURE DATA (no three.js, no React) so the setup screen, the engine and Node
// tests all read exactly the same numbers.
//
// TTK contract (150s arena deathmatch, 10s respawn — fights must resolve fast):
//   torso     — M416 deals 18.7 per round (34 × 0.55 TDM scale) → ~8 rounds on a
//               bare target, ~11 through a light vest, ~13 through a heavy plate.
//   head      — the TDM head boost puts the reference carbine at exactly 52 per
//               headshot, so a bare target dies to 3 headshots (156 ≥ 150) and
//               NEVER to one. Vests then stretch that to 4-5 headshots, because
//               their head plating is the only damage reduction that stacks with
//               the enlarged health pool.
// The vest's body % is deliberately carried by the 150/180/210 health pool rather
// than a second multiplier: stacking −45%/−55% on top of the 0.55× weapon scale
// pushed torso TTK past 25 rounds, which reads as "bullets do nothing".

export type ArmorLevel = 0 | 1 | 2;
export type TeamId = 'alpha' | 'bravo';

export interface ArmorSpec {
  level: ArmorLevel;
  name: string;
  /** Single-glyph icon used by the picker and by the HUD roster. */
  icon: string;
  short: string;
  hp: number;
  /** Multiplier applied to incoming HEAD damage (armor plating + helmet). */
  headMul: number;
  /** Multiplier applied to incoming BODY damage. */
  bodyMul: number;
  /** One-line pitch under the picker card. */
  blurb: string;
  /** Movement multiplier — heavier plates slow the operator down. */
  moveMul: number;
}

export const ARMOR_TABLE: readonly ArmorSpec[] = [
  {
    level: 0, name: 'None', icon: '○', short: 'BARE', hp: 150,
    headMul: 1.00, bodyMul: 1.00, moveMul: 1.06,
    blurb: 'Bare chest, full speed. Fastest legs, but a rifle headshot lands at full value.',
  },
  {
    level: 1, name: 'Light Vest', icon: '◍', short: 'LIGHT', hp: 180,
    headMul: 0.85, bodyMul: 0.60, moveMul: 1.0,
    blurb: 'Balanced plate carrier. Head −15 %, body −40 %.',
  },
  {
    level: 2, name: 'Heavy Vest', icon: '⬢', short: 'HEAVY', hp: 210,
    headMul: 0.75, bodyMul: 0.48, moveMul: 0.94,
    blurb: 'Full coverage + helmet plating. Head −25 %, body −52 %. Slowest.',
  },
] as const;

const armorByLevel: Record<number, ArmorSpec> = {
  0: ARMOR_TABLE[0], 1: ARMOR_TABLE[1], 2: ARMOR_TABLE[2],
};

export function armorOf(level: number): ArmorSpec {
  return armorByLevel[level] ?? ARMOR_TABLE[0];
}

export function armorMaxHp(level: number): number {
  return armorOf(level).hp;
}

/* ===================== MATCH CONSTANTS ===================== */

export const TDM_MATCH_SECONDS = 150;          // 2:30
export const TDM_RESPAWN_SECONDS = 10;
export const TDM_TEAM_SIZE = 5;
export const TDM_FRAGS = 3;
export const TDM_FLASHES = 1;

/** Global weapon scale — "base weapon damage in TDM × 0.55" (spec §4). */
export const TDM_DAMAGE_SCALE = 0.55;
/**
 * Reference carbine: 34 dmg × 2.3 head = 78.2 → ×0.55 = 43, which is four
 * headshots on a bare target. The spec wants three, and 34 × 2.3 × 0.55 × 1.21
 * = 52.0 exactly, so every weapon keeps its own relative head power while the
 * mode-wide 3-shot headshot contract holds for the starter rifle.
 */
export const TDM_HEAD_BOOST = 1.21;

/** What a bot's rifle delivers to the PLAYER before armor (spec §4). */
export const BOT_HEAD_DAMAGE = 52;
export const BOT_BODY_MIN = 22;
export const BOT_BODY_MAX = 30;

/** Fully-resolved health of one actor, for the HUD and the results screen. */
export interface TdmHealth { hp: number; maxHp: number }

/* ===================== DAMAGE MATH ===================== */

/**
 * Damage the player's weapon deals to a bot in TDM.
 * `raw` is the catalog number with the weapon's own head/limb multiplier already
 * applied by the engine, so this only layers the mode's TTK scale on top.
 */
export function tdmWeaponDamage(raw: number, head: boolean): number {
  const scaled = raw * TDM_DAMAGE_SCALE * (head ? TDM_HEAD_BOOST : 1);
  return Math.max(1, Math.round(scaled * 10) / 10);
}

/** Raw bot rifle damage before any armor: 52 head, 22–30 body (spec §4). */
export function botRawDamage(head: boolean, roll: number): number {
  const base = head ? BOT_HEAD_DAMAGE : BOT_BODY_MIN + roll * (BOT_BODY_MAX - BOT_BODY_MIN);
  return Math.max(1, Math.round(base * 10) / 10);
}

/** Damage a bot's rifle delivers to the player, after the player's vest. */
export function botDamageToPlayer(head: boolean, armor: number, roll: number): number {
  const spec = armorOf(armor);
  const base = head ? BOT_HEAD_DAMAGE : BOT_BODY_MIN + roll * (BOT_BODY_MAX - BOT_BODY_MIN);
  return Math.max(1, Math.round(base * (head ? spec.headMul : spec.bodyMul) * 10) / 10);
}

/**
 * Damage a bot inflicts on another bot. Bots carry the same 52/22–30 rifle as the
 * BRAVO squads do against the player, and the target's own plating reduces it the
 * same way — otherwise enemy armor would be purely decorative in AI-vs-AI fights.
 */
export function botDamageToBot(targetArmor: number, head: boolean, roll: number): number {
  const spec = armorOf(targetArmor);
  const base = head ? BOT_HEAD_DAMAGE : BOT_BODY_MIN + roll * (BOT_BODY_MAX - BOT_BODY_MIN);
  return Math.max(1, Math.round(base * (head ? spec.headMul : spec.bodyMul) * 10) / 10);
}

/* ===================== BLAST MODEL ===================== */

/**
 * Warehouse frag damage. A grenade is a *push* tool here: 240 at contact drops a
 * bare chest and a light vest outright, while a heavy plate walks away with ~45 HP
 * — armor that stops bullets should still take the edge off a blast, just not all
 * of it (see blastArmorMul).
 */
export const TDM_FRAG_CONTACT = 240;
export const TDM_FRAG_EDGE = 70;
export const TDM_FRAG_RADIUS = 7;

export function tdmFragDamage(dist: number): number {
  const t = Math.min(1, Math.max(0, (dist - 1.5) / (TDM_FRAG_RADIUS - 1.5)));
  return Math.round(TDM_FRAG_CONTACT + (TDM_FRAG_EDGE - TDM_FRAG_CONTACT) * t);
}

/** Plating resists blast at 60 % of its bullet rating: vests help, they do not save. */
export function blastArmorMul(armor: number): number {
  return 1 - (1 - armorOf(armor).bodyMul) * 0.6;
}

/** Rifle headshots needed to drop a fully plated operative (3 / 5 / 6 by tier). */
export function headshotsToKillRifle(armor: number): number {
  return headshotsToKill(BOT_HEAD_DAMAGE, armor);
}

/** Average-rifle body shots needed to drop a fully plated operative. */
export function bodyShotsToKillRifle(armor: number): number {
  const spec = armorOf(armor);
  const body = (BOT_BODY_MIN + BOT_BODY_MAX) / 2;
  return Math.ceil(spec.hp / (body * spec.bodyMul));
}

/** Shots-to-kill table, used by the setup screen and pinned by the Node tests. */
export function headshotsToKill(damage: number, armor: number): number {
  return Math.ceil(armorOf(armor).hp / (damage * armorOf(armor).headMul));
}

/* ===================== ROSTERS ===================== */

export interface TdmOperative {
  name: string;
  armor: ArmorLevel;
  /** Bottle/nickname shown on the roster strip. */
  role: string;
}

/** Team BRAVO — the spec's five hostiles, in their pinned armor levels. */
export const BRAVO_ROSTER: readonly TdmOperative[] = [
  { name: 'Viper', armor: 2, role: 'Assault' },
  { name: 'Reaper', armor: 1, role: 'Breacher' },
  { name: 'Ghost', armor: 2, role: 'Overwatch' },
  { name: 'Specter', armor: 0, role: 'Runner' },
  { name: 'Wraith', armor: 1, role: 'Flanker' },
] as const;

/**
 * Team ALPHA — the player plus four AI allies. Two heavies (assault + overwatch)
 * and two light vests keep ALPHA at parity with BRAVO's spread whatever plate the
 * player brings; nobody on your side is a bare-chested free kill.
 */
export const ALPHA_ROSTER: readonly TdmOperative[] = [
  { name: 'Ronin', armor: 2, role: 'Assault' },
  { name: 'Kilo', armor: 2, role: 'Overwatch' },
  { name: 'Saber', armor: 1, role: 'Breacher' },
  { name: 'Nova', armor: 1, role: 'Runner' },
] as const;

export const PLAYER_CALLSIGN = 'YOU';

export function rosterFor(team: TeamId): readonly TdmOperative[] {
  return team === 'alpha' ? ALPHA_ROSTER : BRAVO_ROSTER;
}
