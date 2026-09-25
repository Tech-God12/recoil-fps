// Recoil FPS — Field Kit shop: ids, prices and the pure profile reducers that buy
// and equip a kit. Kept free of three.js / audio so the profile layer (and its
// tests) can import it without a renderer.
//
// Kits are earned, not issued: a fresh operator owns none and deploys without an
// ability until one is bought in the KITS menu. Ownership is permanent; the
// equipped kit is locked for the whole deployment (no mid-match swapping).

export type KitId = 'recon' | 'bulwark' | 'phantom' | 'mine' | 'medic';
export const KIT_IDS: readonly KitId[] = ['recon', 'bulwark', 'phantom', 'mine', 'medic'];

export function isKitId(v: unknown): v is KitId {
  return typeof v === 'string' && (KIT_IDS as readonly string[]).includes(v);
}

/**
 * One-time unlock price per kit. The economy reference point is the tested
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
export const KIT_PRICES: Record<KitId, number> = {
  recon: 4500,
  medic: 5000,
  mine: 5500,
  phantom: 6000,
  bulwark: 7500,
};

/** The slice of the player profile the kit reducers read and write. */
export interface KitWallet {
  cash: number;
  ownedKits: KitId[];
  equippedKit: KitId | null;
}

export type KitResult<T> = { ok: true; value: T } | { ok: false; error: 'UNKNOWN' | 'ALREADY_OWNED' | 'INSUFFICIENT_FUNDS' | 'NOT_OWNED' };

/** Buy a kit. A first purchase is equipped automatically so it is never "bought but missing". */
export function buyKit<P extends KitWallet>(p: P, id: unknown): KitResult<P> {
  if (!isKitId(id)) return { ok: false, error: 'UNKNOWN' };
  if (p.ownedKits.includes(id)) return { ok: false, error: 'ALREADY_OWNED' };
  const price = KIT_PRICES[id];
  if (p.cash < price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  return {
    ok: true,
    value: { ...p, cash: p.cash - price, ownedKits: [...p.ownedKits, id], equippedKit: p.equippedKit ?? id },
  };
}

/** Equip an owned kit, or pass null to deploy without one. */
export function equipKit<P extends KitWallet>(p: P, id: KitId | null): KitResult<P> {
  if (id === null) return { ok: true, value: { ...p, equippedKit: null } };
  if (!isKitId(id)) return { ok: false, error: 'UNKNOWN' };
  if (!p.ownedKits.includes(id)) return { ok: false, error: 'NOT_OWNED' };
  return { ok: true, value: { ...p, equippedKit: id } };
}

/** Sanitize persisted kit state: unknown ids dropped, duplicates removed, equip must be owned. */
export function readKits(owned: unknown, equipped: unknown): { ownedKits: KitId[]; equippedKit: KitId | null } {
  const ownedKits = Array.isArray(owned) ? KIT_IDS.filter(id => owned.includes(id)) : [];
  const equippedKit = isKitId(equipped) && ownedKits.includes(equipped) ? equipped : null;
  return { ownedKits, equippedKit };
}
