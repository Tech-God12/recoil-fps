// Recoil FPS — player profile: wallet, ownership, builds, loadout.
// Pure reducers + versioned localStorage persistence. Never throws on corrupt data.
import {
  attachmentById, attachmentsFor, isCompatible, weaponById,
  type AttachSlot, type AttachmentId, type SlotId, type WeaponId,
} from './catalog';
import { emptyBuild, repairLoadout, type Loadout, type WeaponBuild } from './loadout';
import { DEFAULT_SKIN, isKnownSkin, type SkinId } from './skins';

export type { Loadout, WeaponBuild } from './loadout';

export interface PlayerProfile {
  v: 1;
  cash: number;
  lifetimeCash: number;
  missions: number;
  kills: number;
  ownedWeapons: WeaponId[];
  ownedAttachments: Partial<Record<WeaponId, AttachmentId[]>>;
  builds: Partial<Record<WeaponId, WeaponBuild>>;
  loadout: Loadout;
  skins: Partial<Record<WeaponId, SkinId>>;
  seenArmoryTutorial: boolean;
  /** Dev wallet: the wallet silently refills, so every gun/part is testable for free. */
  devFunds: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const PROFILE_KEY = 'recoilfps.profile.v3';
const LEGACY_PROFILE_KEYS = ['recoilfps.profile.v2', 'recoilfps.profile.v1'] as const;

/** Wallet floor while dev funds are on: buys visibly "spend" but never run dry. */
export const DEV_CASH_FLOOR = 9_999_999;

/** Top the wallet back up to the dev floor (pure: returns the input when off). */
export function applyDevFunds(p: PlayerProfile): PlayerProfile {
  if (!p.devFunds || p.cash >= DEV_CASH_FLOOR) return p;
  return { ...p, cash: DEV_CASH_FLOOR, lifetimeCash: Math.max(p.lifetimeCash, DEV_CASH_FLOOR) };
}

export const DEFAULT_PROFILE: PlayerProfile = {
  v: 1,
  cash: DEV_CASH_FLOOR,
  lifetimeCash: DEV_CASH_FLOOR,
  missions: 0,
  kills: 0,
  ownedWeapons: ['m4a1', 'm1911'],
  ownedAttachments: {},
  builds: {
    m4a1: { weapon: 'm4a1', attachments: {} },
    m1911: { weapon: 'm1911', attachments: {} },
  },
  loadout: {
    primary: { weapon: 'm4a1', attachments: {} },
    secondary: { weapon: 'm1911', attachments: {} },
  },
  skins: {},
  seenArmoryTutorial: false,
  devFunds: true,
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Validate raw input against the live catalog, drop unknown ids, repair the loadout. */
export function migrateProfile(raw: unknown): PlayerProfile {
  const fresh = (): PlayerProfile => structuredClone(DEFAULT_PROFILE);
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fresh();
    const d = data as Record<string, unknown>;
    const num = (v: unknown, fallback: number): number => {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
      return Math.max(0, n);
    };
    const ownedWeapons = (Array.isArray(d.ownedWeapons) ? d.ownedWeapons : [])
      .filter((id): id is WeaponId => typeof id === 'string' && !!weaponById(id));
    if (!ownedWeapons.includes('m4a1')) ownedWeapons.unshift('m4a1');
    if (!ownedWeapons.includes('m1911')) ownedWeapons.push('m1911');

    const ownedAttachments: PlayerProfile['ownedAttachments'] = {};
    const rawAtts = (d.ownedAttachments && typeof d.ownedAttachments === 'object' ? d.ownedAttachments : {}) as Record<string, unknown>;
    for (const w of ownedWeapons) {
      const list = Array.isArray(rawAtts[w]) ? rawAtts[w] as unknown[] : [];
      const valid = [...new Set(list.filter((id): id is AttachmentId => {
        if (typeof id !== 'string') return false;
        const a = attachmentById(id);
        return !!a && isCompatible(a, w);
      }))];
      if (valid.length) ownedAttachments[w] = valid;
    }

    const builds: PlayerProfile['builds'] = {};
    const rawBuilds = (d.builds && typeof d.builds === 'object' ? d.builds : {}) as Record<string, unknown>;
    for (const w of ownedWeapons) {
      const entry = weaponById(w);
      const raw = rawBuilds[w] as { attachments?: unknown } | undefined;
      const atts = (raw?.attachments && typeof raw.attachments === 'object' ? raw.attachments : {}) as Record<string, unknown>;
      const clean: WeaponBuild['attachments'] = {};
      for (const slot of entry?.slots ?? []) {
        const id = atts[slot];
        if (typeof id === 'string') {
          const a = attachmentById(id);
          if (a && a.slot === slot && isCompatible(a, w) && ownedAttachments[w]?.includes(id)) clean[slot] = id;
        }
      }
      builds[w] = { weapon: w, attachments: clean };
    }

    const skins: PlayerProfile['skins'] = {};
    const rawSkins = (d.skins && typeof d.skins === 'object' ? d.skins : {}) as Record<string, unknown>;
    for (const w of ownedWeapons) {
      if (typeof rawSkins[w] === 'string' && isKnownSkin(rawSkins[w] as string)) skins[w] = rawSkins[w] as SkinId;
    }

    const loadout = repairLoadout(d.loadout, ownedWeapons);
    // Loadout attachments mirror the saved per-weapon builds; skins ride along.
    for (const slot of ['primary', 'secondary'] as SlotId[]) {
      const saved = builds[loadout[slot].weapon];
      const skin = skins[loadout[slot].weapon];
      const base = saved
        ? { weapon: saved.weapon, attachments: { ...saved.attachments } }
        : emptyBuild(loadout[slot].weapon);
      loadout[slot] = skin ? { ...base, skin } : base;
    }

    return {
      v: 1,
      cash: num(d.cash, 0),
      lifetimeCash: num(d.lifetimeCash, num(d.cash, 0)),
      missions: num(d.missions, 0),
      kills: num(d.kills, 0),
      ownedWeapons,
      ownedAttachments,
      builds,
      loadout,
      skins,
      seenArmoryTutorial: d.seenArmoryTutorial === true,
      // Opt-out only: every pre-dev-funds save flips to an open wallet automatically.
      devFunds: d.devFunds !== false,
    };
  } catch {
    return fresh();
  }
}

export function loadProfile(storage?: Store): PlayerProfile {
  const store = storage ?? defaultStore();
  if (!store) return structuredClone(DEFAULT_PROFILE);
  try {
    const raw = store.getItem(PROFILE_KEY);
    if (raw) return applyDevFunds(migrateProfile(raw));
    // One-time v1/v2 → v3 migration. v2 already stripped stale kits once, but saves
    // that equipped parts afterwards still spawn with them (the M416 red dot). Keep
    // all progress, ownership and cash, but field bare iron-sight guns with stock
    // mags — and hand the save an open dev wallet for unrestricted testing.
    for (const legacyKey of LEGACY_PROFILE_KEYS) {
      const legacy = store.getItem(legacyKey);
      if (!legacy) continue;
      const moved = migrateProfile(legacy);
      for (const [w, build] of Object.entries(moved.builds)) {
        if (build) moved.builds[w as WeaponId] = { weapon: build.weapon, attachments: {} };
      }
      for (const s of ['primary', 'secondary'] as SlotId[]) {
        const slot = moved.loadout[s];
        moved.loadout[s] = slot.skin
          ? { weapon: slot.weapon, attachments: {}, skin: slot.skin }
          : { weapon: slot.weapon, attachments: {} };
      }
      const funded = applyDevFunds(moved);
      try { store.setItem(PROFILE_KEY, JSON.stringify(funded)); } catch { /* optional */ }
      try { (store as unknown as { removeItem?: (k: string) => void }).removeItem?.(legacyKey); } catch { /* optional */ }
      return funded;
    }
    return structuredClone(DEFAULT_PROFILE);
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

export function saveProfile(p: PlayerProfile, storage?: Store): void {
  const store = storage ?? defaultStore();
  if (!store) return;
  try {
    store.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Storage is optional (private mode, quota) — the session profile still works.
  }
}

const clone = (p: PlayerProfile): PlayerProfile => structuredClone(p);

export function buyWeapon(p: PlayerProfile, id: string): Result<PlayerProfile> {
  const entry = weaponById(id);
  if (!entry) return { ok: false, error: 'UNKNOWN' };
  if (p.ownedWeapons.includes(entry.id)) return { ok: false, error: 'ALREADY_OWNED' };
  if (p.cash < entry.price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  const next = clone(p);
  next.cash -= entry.price;
  next.ownedWeapons.push(entry.id);
  next.builds[entry.id] = emptyBuild(entry.id);
  return { ok: true, value: next };
}

export function buyAttachment(p: PlayerProfile, weapon: string, attachment: string): Result<PlayerProfile> {
  const entry = weaponById(weapon);
  const part = attachmentById(attachment);
  if (!entry || !part) return { ok: false, error: 'UNKNOWN' };
  if (!p.ownedWeapons.includes(entry.id)) return { ok: false, error: 'WEAPON_NOT_OWNED' };
  if (!isCompatible(part, entry.id)) return { ok: false, error: 'INCOMPATIBLE' };
  const owned = p.ownedAttachments[entry.id] ?? [];
  if (owned.includes(part.id)) return { ok: false, error: 'ALREADY_OWNED' };
  if (p.cash < part.price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
  const next = clone(p);
  next.cash -= part.price;
  const list = [...(next.ownedAttachments[entry.id] ?? [])];
  list.push(part.id);
  next.ownedAttachments[entry.id] = list;
  // Buying auto-equips.
  const equipped = equipAttachment(next, entry.id, part.id, part.slot);
  return equipped.ok ? { ok: true, value: equipped.value } : { ok: true, value: next };
}

export function equipAttachment(
  p: PlayerProfile, weapon: string, attachment: string | null, slot: AttachSlot,
): Result<PlayerProfile> {
  const entry = weaponById(weapon);
  if (!entry) return { ok: false, error: 'UNKNOWN' };
  if (!p.ownedWeapons.includes(entry.id)) return { ok: false, error: 'WEAPON_NOT_OWNED' };
  if (!entry.slots.includes(slot)) return { ok: false, error: 'INCOMPATIBLE' };
  if (attachment !== null) {
    const part = attachmentById(attachment);
    if (!part || part.slot !== slot || !isCompatible(part, entry.id)) return { ok: false, error: 'INCOMPATIBLE' };
    if (!(p.ownedAttachments[entry.id] ?? []).includes(part.id)) return { ok: false, error: 'NOT_OWNED' };
  }
  const next = clone(p);
  const build = next.builds[entry.id] ?? emptyBuild(entry.id);
  const atts = { ...build.attachments };
  if (attachment === null) delete atts[slot];
  else atts[slot] = attachment;
  next.builds[entry.id] = { weapon: entry.id, attachments: atts };
  // Keep the live loadout in sync when this weapon is fielded.
  for (const s of ['primary', 'secondary'] as SlotId[]) {
    if (next.loadout[s].weapon === entry.id) next.loadout[s] = { weapon: entry.id, attachments: { ...atts } };
  }
  return { ok: true, value: next };
}

export function setLoadoutWeapon(p: PlayerProfile, slot: SlotId, weapon: string): Result<PlayerProfile> {
  const entry = weaponById(weapon);
  if (!entry) return { ok: false, error: 'UNKNOWN' };
  if (!p.ownedWeapons.includes(entry.id)) return { ok: false, error: 'NOT_OWNED' };
  if (entry.slot !== slot) return { ok: false, error: 'WRONG_SLOT' };
  const other = slot === 'primary' ? p.loadout.secondary.weapon : p.loadout.primary.weapon;
  if (other === entry.id) return { ok: false, error: 'DUPLICATE' };
  const next = clone(p);
  const saved = next.builds[entry.id];
  const skin = next.skins[entry.id];
  const base = saved
    ? { weapon: saved.weapon, attachments: { ...saved.attachments } }
    : emptyBuild(entry.id);
  next.loadout[slot] = skin ? { ...base, skin } : base;
  return { ok: true, value: next };
}

export function grantCash(p: PlayerProfile, amount: number, _reason: string): PlayerProfile {
  const next = clone(p);
  const v = Math.round(amount);
  next.cash = Math.max(0, next.cash + v);
  if (v > 0) next.lifetimeCash += v;
  return next;
}

/** Resolve a weapon's live build (loadout copy wins, saved build is the fallback). */
export function buildForWeapon(p: PlayerProfile, weapon: WeaponId): WeaponBuild {
  const skin = skinFor(p, weapon);
  for (const s of ['primary', 'secondary'] as SlotId[]) {
    if (p.loadout[s].weapon === weapon) return { weapon, attachments: { ...p.loadout[s].attachments }, skin };
  }
  const saved = p.builds[weapon];
  return saved ? { weapon, attachments: { ...saved.attachments }, skin } : { ...emptyBuild(weapon), skin };
}

/** Resolve the chosen finish for a weapon (factory when unset or unknown). */
export function skinFor(p: PlayerProfile, weapon: WeaponId): SkinId {
  const id = p.skins?.[weapon];
  return id && isKnownSkin(id) ? id : DEFAULT_SKIN;
}

/**
 * Pick a finish for a weapon. Allowed before purchase too, so locked guns can
 * preview finishes; the choice simply applies once the gun is bought.
 */
export function setWeaponSkin(p: PlayerProfile, weapon: string, skin: string): Result<PlayerProfile> {
  const entry = weaponById(weapon);
  if (!entry) return { ok: false, error: 'UNKNOWN' };
  if (!isKnownSkin(skin)) return { ok: false, error: 'UNKNOWN_SKIN' };
  const next = clone(p);
  next.skins[entry.id] = skin as SkinId;
  for (const s of ['primary', 'secondary'] as SlotId[]) {
    if (next.loadout[s].weapon === entry.id) next.loadout[s] = { ...next.loadout[s], skin: skin as SkinId };
  }
  return { ok: true, value: next };
}

/** Slots a weapon exposes that currently have no compatible catalog part (empty-state UI). */
export function bareSlots(weapon: WeaponId): AttachSlot[] {
  const entry = weaponById(weapon);
  if (!entry) return [];
  return entry.slots.filter(s => attachmentsFor(weapon, s).length === 0);
}
