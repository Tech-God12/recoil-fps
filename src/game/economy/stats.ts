// Recoil FPS — stat resolution: base stats + attachment mods → resolved stats.
// Pure functions only (no three.js / React) so Node tests exercise the real math.
import type { BaseWeaponStats } from './catalog';

export type ScopeReticle = 'none' | 'dot' | 'holo' | 'acog' | 'sniper';

export interface StatMods {
  damageMul?: number; rpmMul?: number; magAdd?: number; magMul?: number; reserveAdd?: number;
  hipSpreadMul?: number; adsSpreadAdd?: number; adsSpreadMul?: number;
  recoilMul?: number; recoilYawMul?: number; adsTimeMul?: number;
  adsFovDelta?: number;
  /** Absolute ADS FOV override — magnified scopes give the SAME true zoom on every gun. */
  adsFovSet?: number;
  tacReloadMul?: number; emptyReloadMul?: number;
  falloffStartAdd?: number; falloffMulAdd?: number;
  noiseRadiusMul?: number; moveSpeedMul?: number; swapTimeMul?: number; headMulAdd?: number;
  autoOverride?: boolean;
  laser?: boolean; flashlight?: boolean;
  scopeReticle?: ScopeReticle;
  // Engine-resolved extras (default 1 / false when no attachment sets them).
  flashMul?: number; suppressed?: boolean;
  spreadXMul?: number; spreadYMul?: number;
  swayMul?: number; swayMulCrouched?: number;
  bipod?: boolean; masterkey?: boolean; lpvo?: boolean; canted?: boolean;
}

export interface ResolvedWeaponStats extends BaseWeaponStats {
  reticle: ScopeReticle;
  laser: boolean; flashlight: boolean; suppressed: boolean;
  recoilYawMul: number; flashMul: number;
  spreadXMul: number; spreadYMul: number;
  swayMul: number; swayMulCrouched: number;
  bipod: boolean; masterkey: boolean; lpvo: boolean; canted: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Combine base stats with any number of attachment modifiers.
 * Multipliers multiply (order-independent), additives add, then clamp.
 * Returns a NEW object; the base is never mutated.
 */
export function resolveWeaponStats(base: BaseWeaponStats, mods: StatMods[]): ResolvedWeaponStats {
  const mul = (pick: (m: StatMods) => number | undefined): number => {
    let v = 1;
    for (const m of mods) { const x = pick(m); if (x !== undefined) v *= x; }
    return v;
  };
  const add = (pick: (m: StatMods) => number | undefined): number => {
    let v = 0;
    for (const m of mods) { const x = pick(m); if (x !== undefined) v += x; }
    return v;
  };
  const any = (pick: (m: StatMods) => boolean | undefined): boolean => mods.some(m => pick(m) === true);
  const last = <T>(pick: (m: StatMods) => T | undefined): T | undefined => {
    let v: T | undefined;
    for (const m of mods) { const x = pick(m); if (x !== undefined) v = x; }
    return v;
  };

  // Magazines: flat additions apply before multipliers, then round.
  const magGrown = base.magSize + add(m => m.magAdd);
  const mag = Math.max(1, Math.round(magGrown * mul(m => m.magMul)));

  return {
    auto: last(m => m.autoOverride) ?? base.auto,
    rpm: Math.max(30, Math.round(base.rpm * mul(m => m.rpmMul))),
    damage: Math.max(1, base.damage * mul(m => m.damageMul)),
    headMul: base.headMul + add(m => m.headMulAdd),
    limbMul: base.limbMul,
    magSize: mag,
    reserve: Math.max(0, Math.round(base.reserve + add(m => m.reserveAdd))),
    hipSpread: Math.max(0, base.hipSpread * mul(m => m.hipSpreadMul)),
    adsSpread: Math.max(0, (base.adsSpread + add(m => m.adsSpreadAdd)) * mul(m => m.adsSpreadMul)),
    pattern: base.pattern.map(p => [p[0], p[1]] as [number, number]),
    adsFov: last(m => m.adsFovSet) ?? (base.adsFov + add(m => m.adsFovDelta)),
    tacReload: Math.max(0.2, base.tacReload * mul(m => m.tacReloadMul)),
    emptyReload: Math.max(0.2, base.emptyReload * mul(m => m.emptyReloadMul)),
    adsTime: clamp(base.adsTime * mul(m => m.adsTimeMul), 0.08, 0.9),
    recoilMul: Math.max(0.05, base.recoilMul * mul(m => m.recoilMul)),
    falloffStart: Math.max(1, base.falloffStart + add(m => m.falloffStartAdd)),
    falloffMul: clamp(base.falloffMul + add(m => m.falloffMulAdd), 0.05, 1.2),
    noiseRadius: Math.max(4, base.noiseRadius * mul(m => m.noiseRadiusMul)),
    moveSpeedMul: clamp(base.moveSpeedMul * mul(m => m.moveSpeedMul), 0.5, 1.5),
    swapTime: clamp(base.swapTime * mul(m => m.swapTimeMul), 0.03, 1.2),
    reticle: last(m => m.scopeReticle) ?? 'none',
    laser: any(m => m.laser),
    flashlight: any(m => m.flashlight),
    suppressed: any(m => m.suppressed),
    recoilYawMul: mul(m => m.recoilYawMul),
    flashMul: mul(m => m.flashMul),
    spreadXMul: mul(m => m.spreadXMul),
    spreadYMul: mul(m => m.spreadYMul),
    swayMul: mul(m => m.swayMul),
    swayMulCrouched: mul(m => m.swayMulCrouched),
    bipod: any(m => m.bipod),
    masterkey: any(m => m.masterkey),
    lpvo: any(m => m.lpvo),
    canted: any(m => m.canted),
  };
}

export interface StatDelta {
  key: string; label: string; before: number; after: number; betterWhenHigher: boolean;
}

const DELTA_FIELDS: { key: keyof ResolvedWeaponStats; label: string; betterWhenHigher: boolean; digits?: number }[] = [
  { key: 'damage', label: 'DAMAGE', betterWhenHigher: true, digits: 1 },
  { key: 'rpm', label: 'FIRE RATE', betterWhenHigher: true },
  { key: 'magSize', label: 'MAG', betterWhenHigher: true },
  { key: 'reserve', label: 'RESERVE', betterWhenHigher: true },
  { key: 'hipSpread', label: 'HIP SPREAD', betterWhenHigher: false, digits: 4 },
  { key: 'recoilMul', label: 'RECOIL', betterWhenHigher: false, digits: 3 },
  { key: 'adsTime', label: 'ADS TIME', betterWhenHigher: false, digits: 3 },
  { key: 'adsFov', label: 'ZOOM', betterWhenHigher: false, digits: 1 },
  { key: 'tacReload', label: 'RELOAD', betterWhenHigher: false, digits: 2 },
  { key: 'falloffStart', label: 'RANGE', betterWhenHigher: true, digits: 1 },
  { key: 'noiseRadius', label: 'NOISE', betterWhenHigher: false, digits: 1 },
  { key: 'moveSpeedMul', label: 'MOBILITY', betterWhenHigher: true, digits: 3 },
  { key: 'swapTime', label: 'SWAP', betterWhenHigher: false, digits: 3 },
];

/** Changed numeric fields between two resolved stat blocks, for UI delta previews. */
export function diffStats(before: ResolvedWeaponStats, after: ResolvedWeaponStats): StatDelta[] {
  const out: StatDelta[] = [];
  for (const f of DELTA_FIELDS) {
    const b = before[f.key] as number;
    const a = after[f.key] as number;
    if (Math.abs(a - b) > 1e-9) out.push({ key: f.key, label: f.label, before: b, after: a, betterWhenHigher: f.betterWhenHigher });
  }
  return out;
}

export type StatBarKey = 'damage' | 'rpm' | 'range' | 'control' | 'handling' | 'noise' | 'mobility';

export interface StatBarRange {
  min: number; max: number; invert: boolean;
  get(s: ResolvedWeaponStats): number;
}

/** Normalisation for the Armory stat bars (pinned by tests). */
export const STAT_BAR_RANGES: Record<StatBarKey, StatBarRange> = {
  damage: { min: 0, max: 80, invert: false, get: s => s.damage },
  rpm: { min: 0, max: 1200, invert: false, get: s => s.rpm },
  range: { min: 0, max: 60, invert: false, get: s => s.falloffStart },
  control: { min: 0.4, max: 2.4, invert: true, get: s => s.recoilMul },
  handling: { min: 0.08, max: 0.9, invert: true, get: s => s.adsTime },
  noise: { min: 4, max: 95, invert: true, get: s => s.noiseRadius },
  mobility: { min: 0.9, max: 1.06, invert: false, get: s => s.moveSpeedMul },
};

export function statBarFrac(key: StatBarKey, s: ResolvedWeaponStats): number {
  const r = STAT_BAR_RANGES[key];
  const f = clamp((r.get(s) - r.min) / (r.max - r.min), 0, 1);
  return r.invert ? 1 - f : f;
}
