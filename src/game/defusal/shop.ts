// Recoil FPS — Bomb Defusal buy menu, inventory and ballistics (PURE DATA + logic).
// Prices follow the CS2 price bands mapped onto RECOIL's ten armory guns. A gun the
// player owns in the Armory is fielded with their own build (attachments + finish);
// everything here is build-agnostic.
import { weaponById, type WeaponId } from '../economy/catalog';
import { ECONOMY, KILL_REWARD, clampMoney, type KillClass, type Side } from './rules';

export type ShopCategory = 'pistols' | 'smgs' | 'rifles' | 'heavy' | 'gear' | 'grenades';
export type GrenadeKind = 'frag' | 'flash' | 'smoke';
/** 0 = none, 1 = kevlar vest, 2 = kevlar + helmet. */
export type ArmorTier = 0 | 1 | 2;
export type ShopItemId =
  | WeaponId
  | 'kevlar' | 'helmet' | 'kit'
  | 'frag' | 'flash' | 'smoke';

export interface ShopItem {
  id: ShopItemId;
  name: string;
  category: ShopCategory;
  price: number;
  kind: 'primary' | 'secondary' | 'armor' | 'helmet' | 'kit' | 'grenade';
  weapon?: WeaponId;
  grenade?: GrenadeKind;
  /** Purchase restriction. */
  side?: Side;
  killClass?: KillClass;
  tag: string;
}

export const SHOP_CATEGORIES: { id: ShopCategory; label: string }[] = [
  { id: 'pistols', label: 'Pistols' },
  { id: 'smgs', label: 'SMGs' },
  { id: 'rifles', label: 'Rifles' },
  { id: 'heavy', label: 'Heavy' },
  { id: 'gear', label: 'Gear' },
  { id: 'grenades', label: 'Grenades' },
];

export const SHOP: ShopItem[] = [
  { id: 'm1911', name: '1911', category: 'pistols', price: 200, kind: 'secondary', weapon: 'm1911', killClass: 'pistol', tag: 'Standard sidearm' },
  { id: 'deagle', name: 'Deagle', category: 'pistols', price: 700, kind: 'secondary', weapon: 'deagle', killClass: 'pistol', tag: 'Helmet-piercing one-tap' },
  { id: 'mp7', name: 'MP', category: 'pistols', price: 1050, kind: 'secondary', weapon: 'mp7', killClass: 'smg', tag: 'Machine pistol · $600 kills' },
  { id: 'vector', name: 'Vector', category: 'smgs', price: 1250, kind: 'primary', weapon: 'vector', killClass: 'smg', tag: 'Anti-eco · $600 kills' },
  { id: 'ak47', name: 'AK-47', category: 'rifles', price: 2700, kind: 'primary', weapon: 'ak47', side: 'attack', killClass: 'rifle', tag: 'Attackers · one-tap headshots' },
  { id: 'm4a1', name: 'M416', category: 'rifles', price: 3100, kind: 'primary', weapon: 'm4a1', side: 'defend', killClass: 'rifle', tag: 'Defenders · accurate, controllable' },
  { id: 'scar_h', name: 'SCAR', category: 'rifles', price: 3300, kind: 'primary', weapon: 'scar_h', killClass: 'rifle', tag: 'Hard-hitting battle rifle' },
  { id: 'awm', name: 'AWM', category: 'rifles', price: 4750, kind: 'primary', weapon: 'awm', killClass: 'sniper', tag: 'One shot, one kill' },
  { id: 'spas12', name: 'SPAS', category: 'heavy', price: 1050, kind: 'primary', weapon: 'spas12', killClass: 'shotgun', tag: 'Close quarters · $900 kills' },
  { id: 'm249', name: 'M249', category: 'heavy', price: 5200, kind: 'primary', weapon: 'm249', killClass: 'lmg', tag: '100-round suppression' },
  { id: 'kevlar', name: 'Kevlar Vest', category: 'gear', price: 650, kind: 'armor', tag: 'Body armor' },
  { id: 'helmet', name: 'Kevlar + Helmet', category: 'gear', price: 1000, kind: 'helmet', tag: 'Head + body armor' },
  { id: 'kit', name: 'Defuse Kit', category: 'gear', price: 400, kind: 'kit', side: 'defend', tag: 'Halves defuse time' },
  { id: 'frag', name: 'Frag Grenade', category: 'grenades', price: 300, kind: 'grenade', grenade: 'frag', killClass: 'grenade', tag: 'Hold G to cook' },
  { id: 'flash', name: 'Flashbang', category: 'grenades', price: 200, kind: 'grenade', grenade: 'flash', tag: 'Blinds and stuns · F' },
  { id: 'smoke', name: 'Smoke Grenade', category: 'grenades', price: 300, kind: 'grenade', grenade: 'smoke', tag: 'Blocks sight for 18s · Z' },
];

export const GRENADE_LIMITS: Record<GrenadeKind, number> & { total: number } = { frag: 1, flash: 2, smoke: 1, total: 4 };
/** Upgrading an existing vest to vest + helmet. */
export const HELMET_UPGRADE_PRICE = 350;

export function shopItem(id: string): ShopItem | undefined { return SHOP.find(i => i.id === id); }

export interface Inventory {
  money: number;
  primary: WeaponId | null;
  secondary: WeaponId;
  armor: ArmorTier;
  kit: boolean;
  frags: number;
  flashes: number;
  smokes: number;
}

export function freshInventory(money: number = ECONOMY.start): Inventory {
  return { money: clampMoney(money), primary: null, secondary: 'm1911', armor: 0, kit: false, frags: 0, flashes: 0, smokes: 0 };
}

/** Dead players lose their kit; money carries over. */
export function afterDeath(inv: Inventory): Inventory {
  return { ...freshInventory(inv.money), money: inv.money };
}

export function grantMoney(inv: Inventory, amount: number): Inventory {
  return { ...inv, money: clampMoney(inv.money + amount) };
}

const grenadeKey = (g: GrenadeKind): 'frags' | 'flashes' | 'smokes' => (g === 'frag' ? 'frags' : g === 'flash' ? 'flashes' : 'smokes');
export const grenadeCount = (inv: Inventory) => inv.frags + inv.flashes + inv.smokes;

export function itemPrice(item: ShopItem, inv: Inventory): number {
  if (item.kind === 'helmet' && inv.armor === 1) return HELMET_UPGRADE_PRICE;
  return item.price;
}

export type BuyCheck = { ok: true; price: number } | { ok: false; reason: string };

export function canBuy(inv: Inventory, id: string, side: Side): BuyCheck {
  const item = shopItem(id);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (item.side && item.side !== side) return { ok: false, reason: item.side === 'defend' ? 'Defenders only' : 'Attackers only' };
  if (item.kind === 'primary' && inv.primary === item.weapon) return { ok: false, reason: 'Equipped' };
  if (item.kind === 'secondary' && inv.secondary === item.weapon) return { ok: false, reason: 'Equipped' };
  if (item.kind === 'armor' && inv.armor >= 1) return { ok: false, reason: 'Equipped' };
  if (item.kind === 'helmet' && inv.armor >= 2) return { ok: false, reason: 'Equipped' };
  if (item.kind === 'kit' && inv.kit) return { ok: false, reason: 'Equipped' };
  if (item.kind === 'grenade' && item.grenade) {
    if (inv[grenadeKey(item.grenade)] >= GRENADE_LIMITS[item.grenade]) return { ok: false, reason: 'Carrying max' };
    if (grenadeCount(inv) >= GRENADE_LIMITS.total) return { ok: false, reason: 'Grenade slots full' };
  }
  const price = itemPrice(item, inv);
  if (inv.money < price) return { ok: false, reason: `Need $${price.toLocaleString('en-US')}` };
  return { ok: true, price };
}

/** Immutable purchase. Returns the unchanged inventory when the buy is illegal. */
export function buy(inv: Inventory, id: string, side: Side): { ok: boolean; inv: Inventory; reason?: string; replaced?: WeaponId | null } {
  const check = canBuy(inv, id, side);
  if (!check.ok) return { ok: false, inv, reason: check.reason };
  const item = shopItem(id)!;
  const next: Inventory = { ...inv, money: inv.money - check.price };
  let replaced: WeaponId | null | undefined;
  switch (item.kind) {
    case 'primary': replaced = inv.primary; next.primary = item.weapon!; break;
    case 'secondary': replaced = inv.secondary; next.secondary = item.weapon!; break;
    case 'armor': next.armor = 1; break;
    case 'helmet': next.armor = 2; break;
    case 'kit': next.kit = true; break;
    case 'grenade': { const k = grenadeKey(item.grenade!); next[k] = inv[k] + 1; break; }
  }
  return { ok: true, inv: next, replaced };
}

/** Equipment value — the CS scoreboard's "equipment" column. */
export function inventoryValue(inv: Inventory): number {
  let v = 0;
  if (inv.primary) v += shopItem(inv.primary)?.price ?? 0;
  if (inv.secondary !== 'm1911') v += shopItem(inv.secondary)?.price ?? 0;
  v += inv.armor === 2 ? 1000 : inv.armor === 1 ? 650 : 0;
  if (inv.kit) v += 400;
  v += inv.frags * 300 + inv.flashes * 200 + inv.smokes * 300;
  return v;
}

export function killClassFor(weapon: WeaponId | 'FRAG' | string): KillClass {
  if (weapon === 'FRAG') return 'grenade';
  const item = shopItem(weapon);
  return item?.killClass ?? 'rifle';
}
export function killRewardFor(weapon: WeaponId | 'FRAG' | string): number { return KILL_REWARD[killClassFor(weapon)]; }

// =====================================================================
// BALLISTICS — CS-style damage model. Headshots ×4, legs ×0.75, and a
// per-weapon armor ratio (the share of damage that still reaches health
// when the hit lands on armor). Kevlar covers the torso; the helmet the head.
// =====================================================================
export const HEAD_MUL = 4;
export const LIMB_MUL = 0.75;
export interface Ballistics { damage: number; armorRatio: number; pellets?: number }
export const BALLISTICS: Record<WeaponId, Ballistics> = {
  m4a1: { damage: 33, armorRatio: 0.70 },
  ak47: { damage: 36, armorRatio: 0.775 },
  scar_h: { damage: 40, armorRatio: 0.85 },
  awm: { damage: 115, armorRatio: 0.975 },
  vector: { damage: 26, armorRatio: 0.60 },
  mp7: { damage: 26, armorRatio: 0.625 },
  spas12: { damage: 26, armorRatio: 0.50, pellets: 8 },
  m249: { damage: 32, armorRatio: 0.80 },
  m1911: { damage: 35, armorRatio: 0.505 },
  deagle: { damage: 53, armorRatio: 0.93 },
};

export type HitPart = 'head' | 'torso' | 'limb';

/** Is this hit stopped by the victim's armor? */
export function armorCovers(part: HitPart, armor: ArmorTier): boolean {
  if (part === 'head') return armor >= 2;
  if (part === 'torso') return armor >= 1;
  return false;
}

/**
 * Health damage for one bullet/pellet. `modScale` carries armory stat mods
 * (e.g. a suppressor's −8%) as the ratio of the fielded gun's damage to its
 * catalog base; `rangeMul` is the weapon's distance falloff.
 */
export function hitDamage(weapon: WeaponId, part: HitPart, armor: ArmorTier, modScale = 1, rangeMul = 1): number {
  const b = BALLISTICS[weapon] ?? BALLISTICS.m4a1;
  let dmg = b.damage * modScale * rangeMul;
  if (part === 'head') dmg *= HEAD_MUL;
  else if (part === 'limb') dmg *= LIMB_MUL;
  if (armorCovers(part, armor)) dmg *= b.armorRatio;
  return dmg;
}

/** Ratio used to carry armory damage mods into the CS damage table. */
export function modScaleFor(weapon: WeaponId, fieldedDamage: number): number {
  const base = weaponById(weapon)?.base.damage ?? fieldedDamage;
  return base > 0 ? fieldedDamage / base : 1;
}
