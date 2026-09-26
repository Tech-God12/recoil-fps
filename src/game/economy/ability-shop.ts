// Recoil FPS — Field Ability shop: ids, prices and the pure profile reducers that buy
// and equip an ability. Kept free of three.js / audio so the profile layer (and its
// tests) can import it without a renderer.
//
// Abilities are earned, not issued: a fresh operator owns none and deploys without an
// ability until one is bought in the ABILITIES menu. Ownership is permanent; the
// equipped ability is locked for the whole deployment (no mid-match swapping).

export type AbilityId = 'recon' | 'bulwark' | 'phantom' | 'mine' | 'medic';
export const ABILITY_IDS: readonly AbilityId[] = ['recon', 'bulwark', 'phantom', 'mine', 'medic'];

export function isAbilityId(v: unknown): v is AbilityId {
  return typeof v === 'string' && (ABILITY_IDS as readonly string[]).includes(v);
}

/**
 * One-time unlock price per ability. The economy reference point is the tested
 * "competent run" of ≈ $3,350 (CHANGELOG, economy rebalance) and a mid-tier rifle
 * at $4,000–6,000, so:
 *   RECON   $4,500 — intel only, cheapest: ~1.3 runs.
 *   PHANTOM $6,000 — wins one fight outright when used well: ~1.8 runs.
 *   BULWARK $7,500 — permanent-feeling cover that also blocks AI pathing and can
 *                    be recalled: the strongest, ~2.2 runs.
 *   MEDKIT  $5,000 — sustain, not a fight-winner: it refills you between fights.
 *   MINE    $5,500 — a lane you no longer have to watch, and a likely kill.
 * All five together ($28,500) still cost less than half of the weapon catalog.
 */
export const ABILITY_PRICES: Record<AbilityId, number> = {
  recon: 4500,
  medic: 5000,
  mine: 5500,
  phantom: 6000,
  bulwark: 7500,
};

/** The slice of the player profile the ability reducers read and write. */
export interface AbilityWallet {
  cash: number;
  ownedAbilities: AbilityId[];
  equippedAbility: AbilityId | null;
}

export type AbilityResult<T> = { ok: true; value: T } | { ok: false; error: 'UNKNOWN' | 'ALREADY_OWNED' | 'INSUFFICIENT_FUNDS' | 'NOT_OWNED' };

/** Buy an ability. A first purchase is equipped automatically so it is never "bought but missing". */
export function buyAbility<P extends AbilityWallet>(p: P, id: unknown): AbilityResult<P> {
  if (!isAbilityId(id)) return { ok: false, error: 'UNKNOWN' };
  if (p.ownedAbilities.includes(id)) return { ok: false, error: 'ALREADY_OWNED' };
  const price = ABILITY_PRICES[id];
  if (p.cash < price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  return {
    ok: true,
    value: { ...p, cash: p.cash - price, ownedAbilities: [...p.ownedAbilities, id], equippedAbility: p.equippedAbility ?? id },
  };
}

/** Equip an owned ability, or pass null to deploy without one. */
export function equipAbility<P extends AbilityWallet>(p: P, id: AbilityId | null): AbilityResult<P> {
  if (id === null) return { ok: true, value: { ...p, equippedAbility: null } };
  if (!isAbilityId(id)) return { ok: false, error: 'UNKNOWN' };
  if (!p.ownedAbilities.includes(id)) return { ok: false, error: 'NOT_OWNED' };
  return { ok: true, value: { ...p, equippedAbility: id } };
}

/** Sanitize persisted ability state: unknown ids dropped, duplicates removed, equip must be owned. */
export function readAbilities(owned: unknown, equipped: unknown): { ownedAbilities: AbilityId[]; equippedAbility: AbilityId | null } {
  const ownedAbilities = Array.isArray(owned) ? ABILITY_IDS.filter(id => owned.includes(id)) : [];
  const equippedAbility = isAbilityId(equipped) && ownedAbilities.includes(equipped) ? equipped : null;
  return { ownedAbilities, equippedAbility };
}
