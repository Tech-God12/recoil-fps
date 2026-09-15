// Recoil FPS — loadout model: two weapon slots, per-weapon attachment builds.
// Pure (no three.js / React).
import { weaponById, type AttachSlot, type AttachmentId, type SlotId, type WeaponId } from './catalog';
import { isKnownSkin, type SkinId } from './skins';

export interface WeaponBuild {
  weapon: WeaponId;
  attachments: Partial<Record<AttachSlot, AttachmentId>>;
  /** Chosen finish. Absent = factory default. */
  skin?: SkinId;
}

export interface Loadout {
  primary: WeaponBuild;
  secondary: WeaponBuild;
}

export const emptyBuild = (weapon: WeaponId): WeaponBuild => ({ weapon, attachments: {} });

export const DEFAULT_LOADOUT: Loadout = {
  primary: { weapon: 'm4a1', attachments: {} },
  secondary: { weapon: 'mp7', attachments: {} },
};

/** Class rule: pistols ride secondary only, everything else primary only. */
export function slotForWeapon(weapon: WeaponId): SlotId | null {
  const entry = weaponById(weapon);
  return entry ? entry.slot : null;
}

export function isValidLoadout(loadout: Loadout, owned: WeaponId[]): boolean {
  if (!loadout || !loadout.primary || !loadout.secondary) return false;
  const p = weaponById(loadout.primary.weapon);
  const s = weaponById(loadout.secondary.weapon);
  if (!p || !s) return false;
  if (p.slot !== 'primary' || s.slot !== 'secondary') return false;
  if (!owned.includes(p.id) || !owned.includes(s.id)) return false;
  if (p.id === s.id) return false;
  return true;
}

/** Repair a broken loadout without throwing: fall back slot-by-slot to owned weapons. */
export function repairLoadout(loadout: unknown, owned: WeaponId[]): Loadout {
  const fresh = (): Loadout => structuredClone(DEFAULT_LOADOUT);
  if (!loadout || typeof loadout !== 'object') return fresh();
  const l = loadout as Partial<Record<SlotId, unknown>>;
  const pick = (slot: SlotId, fallback: WeaponId): WeaponBuild => {
    const raw = l[slot] as { weapon?: unknown; attachments?: unknown; skin?: unknown } | undefined;
    const id = typeof raw?.weapon === 'string' ? raw.weapon : '';
    const entry = weaponById(id);
    const atts = raw?.attachments && typeof raw.attachments === 'object' && !Array.isArray(raw.attachments)
      ? (raw.attachments as WeaponBuild['attachments'])
      : {};
    const skin = typeof raw?.skin === 'string' && isKnownSkin(raw.skin) ? (raw.skin as SkinId) : undefined;
    if (entry && entry.slot === slot && owned.includes(entry.id)) {
      return skin ? { weapon: entry.id, attachments: { ...atts }, skin } : { weapon: entry.id, attachments: { ...atts } };
    }
    const ownedForSlot = owned.map(o => weaponById(o)).find(e => e && e.slot === slot);
    return { weapon: ownedForSlot?.id ?? fallback, attachments: {} };
  };
  const primary = pick('primary', 'm4a1');
  let secondary = pick('secondary', 'mp7');
  if (secondary.weapon === primary.weapon) secondary = { weapon: 'mp7', attachments: {} };
  return { primary, secondary };
}
