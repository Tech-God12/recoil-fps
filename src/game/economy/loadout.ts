// Recoil FPS — loadout model: two weapon slots, per-weapon attachment builds.
// Pure (no three.js / React).
import { attachmentById, isCompatible, weaponById, type AttachSlot, type AttachmentId, type SlotId, type WeaponId } from './catalog';
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
  secondary: { weapon: 'm1911', attachments: {} },
};

/** One compatibility gate shared by save repair, stat resolution and rendering. */
export function sanitizeBuild(build: WeaponBuild): WeaponBuild {
  const attachments: WeaponBuild['attachments'] = {};
  const weapon = weaponById(build.weapon);
  for (const slot of weapon?.slots ?? []) {
    const id = build.attachments?.[slot];
    const entry = typeof id === 'string' ? attachmentById(id) : undefined;
    if (entry && entry.slot === slot && isCompatible(entry, weapon!.id)) attachments[slot] = entry.id;
  }
  return { weapon: build.weapon, attachments, ...(build.skin ? { skin: build.skin } : {}) };
}

/** Transfer already-purchased generic hardware to the corresponding host-native family.
 * Runtime equip never uses aliases: these are a save migration, not a compatibility bypass.
 */
export function migrateAttachmentId(weapon: WeaponId, id: string): string {
  const families: Record<string, Partial<Record<WeaponId, string>>> = {
    mag_extended: { ak47:'mag_extended_ak',scar_h:'mag_extended_scar',vector:'mag_extended_vector',mp7:'mag_extended_mp7',m1911:'mag_extended_1911',deagle:'mag_extended_deagle' },
    mag_drum: { ak47:'mag_drum_ak',vector:'mag_drum_vector' },
    mag_fast: { mp7:'mag_quick_mp7',vector:'mag_quick_vector' },
    muz_suppressor: { ak47:'muz_ak_suppressor',mp7:'muz_smg_suppressor',vector:'muz_smg_suppressor',m1911:'muz_45_suppressor' },
    muz_compensator: { ak47:'muz_ak_brake',mp7:'muz_smg_comp',vector:'muz_smg_comp',deagle:'muz_50_brake' },
    opt_reddot: { ak47:'opt_ak_dot',m1911:'opt_pistol_rmr',deagle:'opt_pistol_rmr' },
    opt_4x: { ak47:'opt_ak_4x' },
    rail_laser: { mp7:'rail_compact_laser',vector:'rail_compact_laser',m1911:'rail_pistol_laser',deagle:'rail_pistol_laser' },
    rail_flashlight: { m1911:'rail_pistol_light',deagle:'rail_pistol_light' },
    ub_vert_grip: { spas12:'ub_spas_sleeve' },
  };
  return families[id]?.[weapon] ?? id;
}

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
  for (const build of [loadout.primary, loadout.secondary]) {
    if (!build.attachments || Object.entries(build.attachments).some(([slot,id])=>sanitizeBuild(build).attachments[slot as AttachSlot] !== id)) return false;
  }
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
      return sanitizeBuild(skin ? { weapon: entry.id, attachments: { ...atts }, skin } : { weapon: entry.id, attachments: { ...atts } });
    }
    const ownedForSlot = owned.map(o => weaponById(o)).find(e => e && e.slot === slot);
    return { weapon: ownedForSlot?.id ?? fallback, attachments: {} };
  };
  const primary = pick('primary', 'm4a1');
  let secondary = pick('secondary', 'm1911');
  if (secondary.weapon === primary.weapon) secondary = { weapon: 'm1911', attachments: {} };
  return { primary, secondary };
}
