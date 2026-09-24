// ============================================================================
// OPERATION BLACKOUT — Ranked buy menu.
//
// The Armory catalog prices are *progression* prices (a $7,800 AWM is a grind
// reward). Ranked play needs match prices tuned for a 13-round economy, so this
// module publishes its own rack: what a weapon costs when the match, not the
// wallet, is paying for it.
//
// Everything here is pure data + pure functions. The buy menu UI, the bot shopper
// and the round engine all read the same table, so a price can never disagree
// between the UI and the rules.
// ============================================================================
import { weaponById, type WeaponClass, type WeaponId } from '../economy/catalog';
import type { CompSide, CompTeam } from './rules';

export type CompBuyKind = 'weapon' | 'armor' | 'kit' | 'nade';
export type CompBuyCategory = 'PISTOLS' | 'SMGS' | 'RIFLES' | 'HEAVY' | 'GEAR';

export interface CompBuyItem {
  id: string;
  name: string;
  short: string;
  price: number;
  kind: CompBuyKind;
  category: CompBuyCategory;
  /** Weapon slot this purchase occupies (weapon items only). */
  slot?: 'primary' | 'secondary';
  weapon?: WeaponId;
  cls: WeaponClass | 'GEAR';
  helmet?: boolean;
  nade?: 'frag' | 'flash' | 'both';
  /** Restrict to one side — the defuse kit is defenders only. */
  side?: CompSide;
  /** Quick-buy key shown in the menu (digits and Q/E/F style keys). */
  key: string;
  /** 1 = entry kit, 2 = workhorse, 3 = force multiplier. Drives bot shopping. */
  tier: 1 | 2 | 3;
  blurb: string;
  /** Small stat line for the tooltip: DAMAGE / RPM derived from the real catalog. */
  stat: string;
}

const statOf = (id: WeaponId): string => {
  const w = weaponById(id);
  if (!w) return '';
  const b = w.base;
  return `${b.damage} DMG · ${b.rpm} RPM · ${b.magSize} MAG`;
};

function weapon(
  weaponId: WeaponId, price: number, category: CompBuyCategory, key: string, tier: 1 | 2 | 3, blurb: string,
): CompBuyItem {
  const entry = weaponById(weaponId)!;
  return {
    id: `w_${weaponId}`,
    name: entry.name,
    short: entry.short,
    price,
    kind: 'weapon',
    category,
    slot: entry.slot,
    weapon: weaponId,
    cls: entry.cls,
    key,
    tier,
    blurb,
    stat: statOf(weaponId),
  };
}

/**
 * The ranked rack. Prices are CS2-adjacent with the magazine sizes and damage of
 * this game's catalog, so "3 body shots with a rifle / 1 with the AWM" holds.
 */
export const COMP_BUY_ITEMS: CompBuyItem[] = [
  // ---- pistols & machine pistol ----
  weapon('m1911', 0, 'PISTOLS', '1', 1, 'Service sidearm. Eight rounds, always on your hip — free, and never taken away.'),
  weapon('deagle', 700, 'PISTOLS', '2', 2, 'Hand cannon. Two rounds centre-mass end a fight for the price of a scope.'),
  weapon('mp7', 1250, 'PISTOLS', '3', 2, 'Machine pistol in the secondary slot: 900 RPM of close-quarters pressure.'),
  // ---- submachine guns ----
  weapon('vector', 1250, 'SMGS', '4', 2, 'Fast-cycling SMG. Cheap, controllable, and the best money-per-kill in the game.'),
  // ---- rifles ----
  weapon('ak47', 2700, 'RIFLES', '5', 3, 'Seven-six-two. Three bodies, one head, and a recoil climb you must learn.'),
  weapon('m4a1', 2900, 'RIFLES', '6', 3, 'The standard rifle. Flattest pattern on the rack — the safe full-buy.'),
  weapon('scar_h', 3300, 'RIFLES', '7', 3, 'Two-tap battle rifle. Slower to shoulder, unforgiving, lethal in good hands.'),
  // ---- heavy & special ----
  weapon('spas12', 2100, 'HEAVY', '8', 2, 'Eight pellets of 12-gauge. Site-clearing tool inside ten metres.'),
  weapon('awm', 4750, 'HEAVY', '9', 3, 'Bolt-action .338. One body shot, one round in the magazine budget.'),
  weapon('m249', 5200, 'HEAVY', '0', 3, 'Belt-fed suppression. Holds a lane alone; you will not be reloading soon.'),
  // ---- gear ----
  { id: 'g_kevlar', name: 'Kevlar Vest', short: 'KEVLAR', price: 650, kind: 'armor', category: 'GEAR', cls: 'GEAR', key: 'Q', tier: 1, blurb: 'Body armor. Absorbs nearly half of every round that lands.', stat: 'BODY PROTECTION' },
  { id: 'g_helmet', name: 'Kevlar + Helmet', short: 'HELMET', price: 1000, kind: 'armor', category: 'GEAR', cls: 'GEAR', helmet: true, key: 'W', tier: 2, blurb: 'Adds a helmet: headshots stop being an instant end to your round.', stat: 'BODY + HEAD' },
  { id: 'g_kit', name: 'Defuse Kit', short: 'KIT', price: 400, kind: 'kit', category: 'GEAR', cls: 'GEAR', side: 'defend', key: 'E', tier: 1, blurb: 'Halves defuse time — five seconds instead of ten. Defenders only.', stat: '10s → 5s' },
  { id: 'g_frag', name: 'Frag Grenade', short: 'FRAG', price: 300, kind: 'nade', category: 'GEAR', cls: 'GEAR', nade: 'frag', key: 'R', tier: 1, blurb: 'Damages through a held angle. Maximum two per operator.', stat: 'LETHAL' },
  { id: 'g_flash', name: 'Flashbang', short: 'FLASH', price: 200, kind: 'nade', category: 'GEAR', cls: 'GEAR', nade: 'flash', key: 'F', tier: 1, blurb: 'Blinds a held angle for the entry. Maximum two per operator.', stat: 'TEMPORARY' },
];

export const COMP_BUY_CATEGORIES: CompBuyCategory[] = ['PISTOLS', 'SMGS', 'RIFLES', 'HEAVY', 'GEAR'];

export function buyItemById(id: string): CompBuyItem | undefined {
  return COMP_BUY_ITEMS.find(item => item.id === id);
}

export function buyItemForWeapon(weaponId: WeaponId): CompBuyItem | undefined {
  return COMP_BUY_ITEMS.find(item => item.weapon === weaponId);
}

/** Match price of a weapon (0 for the free starter). */
export function rankedPrice(weaponId: WeaponId): number {
  return buyItemForWeapon(weaponId)?.price ?? 0;
}

export function itemsInCategory(category: CompBuyCategory, side: CompSide): CompBuyItem[] {
  return COMP_BUY_ITEMS.filter(item => item.category === category && (item.side === undefined || item.side === side));
}

// -------------------------------------------------------------- bot shop ----
export type CompBuyPlan = 'eco' | 'force' | 'full';

export interface BotShopContext {
  team: CompTeam;
  side: CompSide;
  /** Average cash across living members of the team. */
  teamMoney: number;
  /** Rounds the team has lost in a row (drives the loss bonus). */
  lossStreak: number;
  /** True when the team is one round from elimination — spend everything. */
  desperate?: boolean;
}

/**
 * Team-level shopping decision. Squads buy together: a mixed eco wastes both the
 * money and the round, which is exactly how real competitive lobbies behave.
 */
export function botBuyPlan(ctx: BotShopContext): CompBuyPlan {
  const money = ctx.teamMoney;
  if (ctx.desperate && money >= 2400) return 'full';
  if (money >= 3500) return 'full';
  if (money >= 2400) return 'force';
  if (ctx.lossStreak >= 3 && money >= 2100) return 'force';
  return 'eco';
}

/** What one bot wants to buy this round, in priority order. */
export function botWishlist(input: {
  plan: CompBuyPlan;
  money: number;
  side: CompSide;
  hasPrimary: boolean;
  hasKit: boolean;
  armor: number;
  helmet: boolean;
  frags: number;
  flashes: number;
  /** Deterministic 0..1 roll — the director passes a seeded value per bot. */
  roll: number;
}): string[] {
  const out: string[] = [];
  const canAfford = (price: number) => input.money >= price;
  const wantRifle = input.roll < 0.22 ? 'w_ak47' : input.roll < 0.62 ? 'w_ak47' : input.roll < 0.8 ? 'w_m4a1' : 'w_scar_h';
  const buyUtility = () => {
    if (input.side === 'defend' && !input.hasKit && canAfford(400)) out.push('g_kit');
    if (input.frags < 1 && canAfford(300)) out.push('g_frag');
    if (input.flashes < 1 && canAfford(200)) out.push('g_flash');
  };
  const buyArmor = (withHelmet: boolean) => {
    if (input.armor >= 100 && (!withHelmet || input.helmet)) return;
    const price = withHelmet ? 1000 : 650;
    if (input.armor > 0) return; // a damaged plate is not worth rebuying mid-match
    if (canAfford(price)) out.push(withHelmet ? 'g_helmet' : 'g_kevlar');
  };
  switch (input.plan) {
    case 'full': {
      if (!input.hasPrimary) {
        // Occasionally the squad fields a sniper or a shotgun on the full buy.
        const special = input.roll > 0.93 ? 'w_awm' : input.roll > 0.88 ? 'w_spas12' : null;
        const pick = special ?? wantRifle;
        const cost = buyItemById(pick)?.price ?? Infinity;
        if (canAfford(cost)) out.push(pick);
        else if (canAfford(1250)) out.push('w_vector');
      }
      buyArmor(true);
      buyUtility();
      break;
    }
    case 'force': {
      if (!input.hasPrimary) {
        if (canAfford(1250)) out.push(input.roll < 0.5 ? 'w_vector' : 'w_mp7');
        else if (canAfford(700)) out.push('w_deagle');
      }
      buyArmor(false);
      if (input.side === 'defend' && !input.hasKit && canAfford(400)) out.push('g_kit');
      break;
    }
    case 'eco': {
      // Eco means eco: no rifles. A cheap pistol upgrade or armor is allowed when
      // the squad is too rich to be trusted with saving.
      if (!input.hasPrimary && input.money >= 1750 && input.armor < 100) out.push('g_kevlar');
      else if (input.side === 'defend' && !input.hasKit && input.money >= 900) out.push('g_kit');
      else if (input.money >= 2500 && input.frags < 1) out.push('g_frag');
      break;
    }
  }
  return out;
}

/** Cheap helper the director uses to price a full buy for the "can we afford it" check. */
export function fullBuyCost(): number {
  return rankedPrice('ak47') + 1000 + 300;
}
