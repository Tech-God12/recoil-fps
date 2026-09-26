// Recoil FPS — Armory catalog: weapons + attachments (PURE DATA, no three.js / React).
// Every number here is game design, safe to import from Node tests and the engine alike.
import type { StatMods } from './stats';

export type WeaponId =
  | 'm4a1' | 'ak47' | 'm1911' | 'awm' | 'mp7'
  | 'scar_h' | 'mcx_spear' | 'vector' | 'spas12' | 'deagle' | 'm249';
export type WeaponClass = 'AR' | 'BR' | 'SMG' | 'PDW' | 'SR' | 'SG' | 'LMG' | 'PISTOL';
export type SlotId = 'primary' | 'secondary';
export type AttachSlot = 'muzzle' | 'optic' | 'magazine' | 'underbarrel' | 'stock' | 'rail' | 'barrel';
export type AttachmentId = string;
export type AudioKind =
  | 'm4' | 'ak' | 'pistol' | 'sniper' | 'smg'
  | 'scar' | 'spear' | 'vector' | 'shotgun' | 'deagle' | 'lmg';

export interface BaseWeaponStats {
  auto: boolean; rpm: number; damage: number; headMul: number; limbMul: number;
  magSize: number; reserve: number; hipSpread: number; adsSpread: number;
  pattern: [number, number][]; adsFov: number; tacReload: number; emptyReload: number;
  adsTime: number; recoilMul: number; falloffStart: number; falloffMul: number;
  noiseRadius: number; moveSpeedMul: number; swapTime: number;
}

export interface WeaponCatalogEntry {
  id: WeaponId; name: string; short: string; cls: WeaponClass; slot: SlotId;
  price: number;
  starter: boolean;
  blurb: string;
  base: BaseWeaponStats;
  slots: AttachSlot[];
  audio: AudioKind;
  boltAction?: boolean;
  pump?: boolean;
  pellets?: number;
  scoped?: boolean;
  beltFed?: boolean;
  slideBlowback?: boolean;
  bloom?: { perShot: number; max: number; decay: number };
}

export interface AttachmentCatalogEntry {
  id: AttachmentId; slot: AttachSlot; name: string; price: number;
  compat: WeaponId[];
  desc: string;
  pros: string[];
  cons: string[];
  mods: StatMods;
  visual: string;
  tier: 1 | 2 | 3;
  /** Physical mounting / ammunition family, shown alongside compatibility. */
  family?: string;
}

const STOCK = [[1.1, .12], [1.2, -.08], [1.35, .18], [1.45, -.15]] as [number, number][];

function base(o: Partial<BaseWeaponStats> & Pick<BaseWeaponStats, 'rpm' | 'damage'>): BaseWeaponStats {
  const { rpm, damage, ...rest } = o;
  return {
    auto: true, rpm, damage,
    headMul: 2.2, limbMul: 0.85, magSize: 30, reserve: 120,
    hipSpread: 0.01, adsSpread: 0.00045, pattern: STOCK.map(p => [...p] as [number, number]),
    adsFov: 58, tacReload: 2.2, emptyReload: 2.7,
    adsTime: 0.22, recoilMul: 1, falloffStart: 35, falloffMul: 0.85,
    noiseRadius: 65, moveSpeedMul: 1, swapTime: 0.13,
    ...rest,
  };
}
export const WEAPON_CATALOG: WeaponCatalogEntry[] = [
  {
    id: 'm4a1', name: 'M416', short: 'M416', cls: 'AR', slot: 'primary',
    price: 0, starter: true,
    blurb: 'The workhorse. Flat-shooting, fast-handling carbine that does everything well and forgives everything else.',
    base: base({ pattern: [[1.05, 0.08], [1.15, 0.12], [1.25, -0.12], [1.3, 0.2], [1.4, 0.28], [1.48, 0.18], [1.5, -0.25], [1.55, -0.32], [1.6, -0.18], [1.6, 0.23], [1.58, 0.3], [1.55, -0.16]], auto: true, rpm: 780, damage: 34, headMul: 2.3, limbMul: 0.85, magSize: 30, reserve: 150, hipSpread: 0.008, adsFov: 56, tacReload: 2.1, emptyReload: 2.7, adsTime: 0.22 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'm4',
  },
  {
    id: 'mcx_spear', name: 'MCX-SPEAR', short: 'MCX', cls: 'BR', slot: 'primary',
    price: 3600, starter: false,
    blurb: 'Modern 6.8mm piston rifle. Twenty deliberate rounds, a monolithic rail and enough authority to own the long lane.',
    base: base({ pattern: [[1.35, 0.10], [1.48, -0.15], [1.58, 0.22], [1.67, -0.26], [1.75, 0.28], [1.82, -0.20]], auto: true, rpm: 675, damage: 43, headMul: 2.45, limbMul: 0.82, magSize: 20, reserve: 100, hipSpread: 0.009, adsFov: 55, tacReload: 2.28, emptyReload: 2.82, adsTime: 0.25, recoilMul: 1.18, falloffStart: 48, falloffMul: 0.91, noiseRadius: 76, moveSpeedMul: 0.98 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'spear',
  },
  {
    id: 'ak47', name: 'AK-47', short: 'AK-47', cls: 'AR', slot: 'primary',
    price: 1900, starter: false,
    blurb: 'Hard-hitting 7.62. Slower, louder, heavier — and every round lands like a slammed door.',
    base: base({ pattern: [[1.65, -0.16], [1.85, 0.23], [2, 0.34], [2.1, -0.27], [2.2, -0.4], [2.25, 0.45], [2.3, 0.3], [2.2, -0.38]], auto: true, rpm: 600, damage: 46, headMul: 2.5, limbMul: 0.8, magSize: 30, reserve: 120, hipSpread: 0.010, adsFov: 58, tacReload: 2.4, emptyReload: 3.0, adsTime: 0.25 }),
    slots: ["muzzle", "optic", "magazine"],
    audio: 'ak',
  },
  {
    id: 'm1911', name: '1911', short: '1911', cls: 'PISTOL', slot: 'secondary',
    price: 0, starter: true,
    blurb: 'Old warhorse in .45 ACP. Eight rounds of authority for when the primary runs dry.',
    base: base({ pattern: [[2.1, 0.16]], auto: false, rpm: 420, damage: 42, headMul: 2.6, limbMul: 0.85, magSize: 8, reserve: 48, hipSpread: 0.006, adsFov: 64, tacReload: 1.5, emptyReload: 1.8, adsTime: 0.16, noiseRadius: 50, moveSpeedMul: 1.05 }),
    slots: ['muzzle', 'optic', 'magazine', 'rail', 'barrel'],
    audio: 'pistol', slideBlowback: true,
  },
  {
    id: 'awm', name: 'AWM', short: 'AWM', cls: 'SR', slot: 'primary',
    price: 3900, starter: false,
    blurb: 'Bolt-action .338 Lapua. One round, one silhouette down — if you can stand the scope sway and the report.',
    // AWM: a bolt-action sniper MUST one-tap the chest — 78 dmg forced two hits at
    // 48 RPM (1.25 s felt TTK, 2.5 s in TDM), which reads as broken, not balanced.
    // 160 one-taps the 100 HP mission pool at any range, one-taps unarmored TDM
    // operators (150 HP), and still needs two against armor 1–2 (170/190 HP after
    // reduction) — armor stays meaningful. Lowest DPS in the game by far, so the
    // price is the fire rate, the 5-round mag and the slow ADS, not a fake wound.
    base: base({ pattern: [[4.2, 0.28]], auto: false, rpm: 48, damage: 160, headMul: 3.0, limbMul: 1.0, magSize: 5, reserve: 25, hipSpread: 0.045, adsFov: 22, tacReload: 2.25, emptyReload: 2.7, adsTime: 0.42, noiseRadius: 90, moveSpeedMul: 0.96 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'rail'],
    audio: 'sniper', boltAction: true, scoped: true,
  },
  {
    id: 'mp7', name: 'MP', short: 'MP', cls: 'PDW', slot: 'secondary',
    price: 1200, starter: false,
    blurb: 'Pocket firestorm. 900 RPM of 4.6mm riding your secondary slot — a machine pistol for when the primary runs dry.',
    base: base({ pattern: [[0.85, 0.12], [0.95, -0.18], [1.05, 0.2], [1.12, -0.24], [1.18, 0.22]], auto: true, rpm: 900, damage: 24, headMul: 2.2, limbMul: 0.8, magSize: 40, reserve: 200, hipSpread: 0.011, adsFov: 60, tacReload: 1.9, emptyReload: 2.3, adsTime: 0.18, noiseRadius: 55 }),
    slots: ["muzzle", "optic", "magazine", "stock", "rail"],
    audio: 'smg',
  },
  {
    id: 'vector', name: 'Vector', short: 'Vector', cls: 'SMG', slot: 'primary',
    price: 2300, starter: false,
    blurb: 'Fast-cycling Super-V action. Manageable initial kick, but sustained bursts still climb and wander.',
    base: base({ pattern: [[1.0, -0.12], [1.08, 0.2], [1.16, -0.25], [1.22, 0.28], [1.25, -0.32]], auto: true, rpm: 1100, damage: 24, headMul: 2.0, limbMul: 0.85, magSize: 25, reserve: 175, hipSpread: 0.011, adsFov: 62, tacReload: 2.0, emptyReload: 2.5, adsTime: 0.17, recoilMul: 0.7, falloffStart: 22, noiseRadius: 58 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'vector',
  },
  {
    id: 'spas12', name: 'SPAS', short: 'SPAS', cls: 'SG', slot: 'primary',
    price: 2600, starter: false,
    blurb: 'Pump-action devastation. Eight pellets of 12-gauge diplomacy inside 12 metres — nothing argues back.',
    base: base({ pattern: [[3.2, -0.3]], auto: false, rpm: 80, damage: 14, headMul: 1.6, limbMul: 0.9, magSize: 8, reserve: 40, hipSpread: 0.045, adsSpread: 0.028, adsFov: 66, tacReload: 3.2, emptyReload: 3.2, adsTime: 0.24, recoilMul: 1.5, falloffStart: 12, falloffMul: 0.45, noiseRadius: 80 }),
    slots: ["muzzle", "optic", "magazine", "underbarrel", "rail"],
    audio: 'shotgun', pump: true, pellets: 8,
  },
  {
    // SCAR-H: 52 dmg two-tapped (0.10 s) while the AK needed three (0.20 s) at the
    // same 600 RPM — there was no reason to run any other AR. 48 dmg keeps the
    // one-tap head and the best-in-class range (45 m × 0.9) but moves body TTK to
    // three shots, in line with the AK; you now pick SCAR for range, AK for price.
    id: 'scar_h', name: 'SCAR', short: 'SCAR', cls: 'BR', slot: 'primary',
    price: 3200, starter: false,
    blurb: 'Hard-hitting battle rifle. Slow, surgical, and heavy — the muzzle climbs like it has somewhere to be.',
    base: base({ pattern: [[1.45, 0.18], [1.62, -0.25], [1.78, 0.32], [1.87, 0.38], [1.95, -0.35], [1.97, -0.28]], auto: true, rpm: 600, damage: 48, headMul: 2.4, limbMul: 0.85, magSize: 20, reserve: 100, hipSpread: 0.010, adsFov: 55, tacReload: 2.3, emptyReload: 2.9, adsTime: 0.26, recoilMul: 1.35, falloffStart: 45, falloffMul: 0.9, noiseRadius: 75 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'scar',
  },
  {
    id: 'deagle', name: 'Deagle', short: 'Deagle', cls: 'PISTOL', slot: 'secondary',
    price: 1600, starter: false,
    blurb: 'Hand cannon in .50 AE. Two rounds centre-mass ends the conversation — and nearly your wrist.',
    base: base({ pattern: [[3.7, 0.34]], auto: false, rpm: 240, damage: 62, headMul: 2.8, limbMul: 0.8, magSize: 7, reserve: 35, hipSpread: 0.009, adsFov: 64, tacReload: 1.7, emptyReload: 2.0, adsTime: 0.19, recoilMul: 1.8, falloffStart: 30, noiseRadius: 85, moveSpeedMul: 1.03 }),
    slots: ['muzzle', 'optic', 'magazine', 'rail', 'barrel'],
    audio: 'deagle', slideBlowback: true,
  },
  {
    id: 'm249', name: 'M249', short: 'M249', cls: 'LMG', slot: 'primary',
    price: 4300, starter: false,
    blurb: '100-round belt of suppression. Slow to shoulder, slow to reload, impossible to ignore downrange.',
    base: base({ pattern: [[1.05, 0.1], [1.18, 0.18], [1.28, -0.23], [1.35, -0.3], [1.45, 0.33], [1.5, 0.37], [1.56, -0.35]], auto: true, rpm: 800, damage: 36, headMul: 2.2, limbMul: 0.85, magSize: 100, reserve: 200, hipSpread: 0.016, adsFov: 60, tacReload: 5.4, emptyReload: 5.4, adsTime: 0.40, recoilMul: 1.15, falloffStart: 40, noiseRadius: 80, moveSpeedMul: 0.92, swapTime: 0.32 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'lmg', beltFed: true, bloom: { perShot: 0.0006, max: 0.012, decay: 0.03 },
  },
];

export const ATTACHMENT_CATALOG: AttachmentCatalogEntry[] = [
  {
    "id": "muz_flash_hider",
    "slot": "muzzle",
    "name": "5.56 / 7.62 Flash Hider",
    "price": 250,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249"
    ],
    "desc": "Short, open-prong rifle device. Cuts flash without taming the burst.",
    "pros": [
      "Reduced muzzle flash"
    ],
    "cons": [
      "No recoil reduction"
    ],
    "mods": {
      "flashMul": 0.38
    },
    "visual": "flash_hider",
    "family": "Rifle muzzle"
  },
  {
    "id": "muz_compensator",
    "slot": "muzzle",
    "name": "Rifle Compensator",
    "price": 500,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h"
    ],
    "desc": "Side-port compensator for the M416 and SCAR. Flatter bursts, louder report.",
    "pros": [
      "Vertical recoil \u221216%",
      "Horizontal recoil \u221218%"
    ],
    "cons": [
      "Noise +12%",
      "Flash +15%"
    ],
    "mods": {
      "recoilMul": 0.84,
      "recoilYawMul": 0.82,
      "noiseRadiusMul": 1.12,
      "flashMul": 1.15
    },
    "visual": "compensator",
    "family": "Rail carbine"
  },
  {
    "id": "muz_suppressor",
    "slot": "muzzle",
    "name": "QD Rifle Suppressor",
    "price": 800,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249"
    ],
    "desc": "Slim receiver-matched rifle can. Quieter shots, not a recoil eliminator.",
    "pros": [
      "Noise \u221270%",
      "Reduced flash"
    ],
    "cons": [
      "Damage \u22128%",
      "ADS +10%"
    ],
    "mods": {
      "noiseRadiusMul": 0.3,
      "damageMul": 0.92,
      "suppressed": true,
      "flashMul": 0.35,
      "adsTimeMul": 1.1
    },
    "visual": "suppressor_long",
    "family": "Rifle QD"
  },
  {
    "id": "muz_suppressor_sr",
    "slot": "muzzle",
    "name": ".338 Moderator",
    "price": 1200,
    "tier": 3,
    "compat": [
      "awm"
    ],
    "desc": "AWM-specific concentric moderator with a short collar and recessed crown.",
    "pros": [
      "Hearing range \u221270%",
      "Keeps 95% damage",
      "Flash nearly gone"
    ],
    "cons": [
      "Shorter effective range",
      "Slower ADS"
    ],
    "mods": {
      "damageMul": 0.95,
      "noiseRadiusMul": 0.3,
      "falloffStartAdd": -8,
      "adsTimeMul": 1.08,
      "flashMul": 0.15,
      "suppressed": true
    },
    "visual": "suppressor_fat",
    "family": "AWM .338"
  },
  {
    "id": "muz_brake_heavy",
    "slot": "muzzle",
    "name": "Precision Muzzle Brake",
    "price": 700,
    "tier": 2,
    "compat": [
      "awm",
      "scar_h",
      "m249"
    ],
    "desc": "Two-chamber brute. Shoves the muzzle back down where it belongs \u2014 and announces it to the whole sector.",
    "pros": [
      "Vertical recoil \u221220%"
    ],
    "cons": [
      "Flash +35%",
      "Noise +15%",
      "ADS +3%"
    ],
    "mods": {
      "recoilMul": 0.8,
      "recoilYawMul": 0.92,
      "flashMul": 1.35,
      "noiseRadiusMul": 1.15,
      "adsTimeMul": 1.03
    },
    "visual": "brake_heavy",
    "family": "Heavy rifle"
  },
  {
    "id": "muz_duckbill",
    "slot": "muzzle",
    "name": "Duckbill Choke",
    "price": 500,
    "tier": 2,
    "compat": [
      "spas12"
    ],
    "desc": "Spreads the pattern into a wide horizontal fan. Hallway-clearing geometry \u2014 useless past a doorway.",
    "pros": [
      "Wide horizontal spread"
    ],
    "cons": [
      "Thin vertical coverage"
    ],
    "mods": {
      "spreadXMul": 1.6,
      "spreadYMul": 0.5
    },
    "visual": "duckbill"
  },
  {
    "id": "muz_full_choke",
    "slot": "muzzle",
    "name": "Full Choke",
    "price": 600,
    "tier": 2,
    "compat": [
      "spas12"
    ],
    "desc": "Threaded collar that squeezes the cone tight. Keeps pellets on target a few metres further out.",
    "pros": [
      "Tighter pellet cone",
      "+4 m effective range"
    ],
    "cons": [
      "None. Tubes love chokes."
    ],
    "mods": {
      "hipSpreadMul": 0.7,
      "adsSpreadMul": 0.7,
      "falloffStartAdd": 4
    },
    "visual": "choke"
  },
  {
    "id": "opt_reddot",
    "slot": "optic",
    "name": "Red Dot Sight",
    "price": 450,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249",
      "mp7",
      "vector",
      "spas12"
    ],
    "desc": "Tubular 1\u00d7 reflex with a clean red dot and fast acquisition.",
    "pros": [
      "Clean red dot",
      "ADS \u22125%"
    ],
    "cons": [
      "No magnification"
    ],
    "mods": {
      "scopeReticle": "dot",
      "scopePower": 1,
      "adsTimeMul": 0.95
    },
    "visual": "reddot",
    "family": "Compact rail optic"
  },
  {
    "id": "opt_holo",
    "slot": "optic",
    "name": "Holographic Sight",
    "price": 700,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249",
      "mp7",
      "vector",
      "spas12"
    ],
    "desc": "Wide protected window, circle-dot aiming mark and a forward battery compartment.",
    "pros": [
      "Wide circle-dot sight picture"
    ],
    "cons": [
      "ADS +3%",
      "No magnification"
    ],
    "mods": {
      "scopeReticle": "holo",
      "scopePower": 1,
      "adsTimeMul": 1.03
    },
    "visual": "holo",
    "family": "Holographic rail optic"
  },
  {
    "id": "opt_2x",
    "slot": "optic",
    "name": "2x Scope",
    "price": 600,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "mp7",
      "vector"
    ],
    "desc": "Short 2\u00d7 prism with a ring-dot reticle. Sized for carbines and compact rails.",
    "pros": [
      "Fixed 2\u00d7 optical zoom"
    ],
    "cons": [
      "ADS +7%"
    ],
    "mods": {
      "scopeReticle": "prism2",
      "scopePower": 2,
      "adsTimeMul": 1.07
    },
    "visual": "prism_2x",
    "family": "Compact prism"
  },
  {
    "id": "opt_3x",
    "slot": "optic",
    "name": "3x Scope",
    "price": 900,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249"
    ],
    "desc": "3\u00d7 prism with a horseshoe/chevron and compact holdover ladder.",
    "pros": [
      "Fixed 3\u00d7 optical zoom"
    ],
    "cons": [
      "ADS +13%",
      "Sway +4%"
    ],
    "mods": {
      "scopeReticle": "prism3",
      "scopePower": 3,
      "adsTimeMul": 1.13,
      "swayMul": 1.04
    },
    "visual": "prism_3x",
    "family": "Mid-range prism"
  },
  {
    "id": "opt_4x",
    "slot": "optic",
    "name": "4x Scope",
    "price": 1200,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249",
      "awm"
    ],
    "desc": "4\u00d7 combat optic with a pointed chevron and fine BDC stadia. No free damage bonus.",
    "pros": [
      "Fixed 4\u00d7 optical zoom",
      "Distinct BDC sight picture"
    ],
    "cons": [
      "ADS +20%",
      "Sway +8%"
    ],
    "mods": {
      "scopeReticle": "bdc4",
      "scopePower": 4,
      "adsTimeMul": 1.2,
      "swayMul": 1.08
    },
    "visual": "acog_4x",
    "family": "Fixed combat prism"
  },
  {
    "id": "opt_6x",
    "slot": "optic",
    "name": "6x Scope",
    "price": 1600,
    "tier": 3,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249",
      "awm"
    ],
    "desc": "Continuously adjustable 3\u20136\u00d7 precision scope. V opens the slider; wheel or [ / ] adjust while aiming.",
    "pros": [
      "Variable 3\u20136\u00d7 optical zoom",
      "Fine mil reticle"
    ],
    "cons": [
      "ADS +27%",
      "Standing sway +10%"
    ],
    "mods": {
      "scopeReticle": "mil6",
      "scopePower": 6,
      "scopeMinPower": 3,
      "adsTimeMul": 1.27,
      "swayMul": 1.1,
      "swayMulCrouched": 0.8
    },
    "visual": "scope_6x",
    "family": "Variable precision optic"
  },
  {
    "id": "opt_pistol_rmr",
    "slot": "optic",
    "name": "Pistol Red Dot",
    "price": 500,
    "tier": 2,
    "compat": [
      "m1911",
      "deagle"
    ],
    "desc": "Low-profile pistol window and precise red dot. No full-size rifle glass.",
    "pros": [
      "Dot reticle on a pistol",
      "Faster ADS"
    ],
    "cons": [
      "No zoom"
    ],
    "mods": {
      "scopeReticle": "dot",
      "scopePower": 1,
      "adsTimeMul": 0.95
    },
    "visual": "pistol_rmr",
    "family": "Slide-mounted micro optic"
  },
  {
    "id": "mag_extended",
    "slot": "magazine",
    "name": "40-Round STANAG",
    "price": 600,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear"
    ],
    "desc": "Extended STANAG with the original feed neck and a modest lower extension.",
    "pros": [
      "30 \u2192 40 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 10,
      "reserveAdd": 20,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "M416 5.56"
  },
  {
    "id": "mag_drum",
    "slot": "magazine",
    "name": "60-Round Compact Drum",
    "price": 1350,
    "tier": 3,
    "compat": [
      "m4a1",
      "mcx_spear"
    ],
    "desc": "Compact 60-round drum with a short STANAG feed tower.",
    "pros": [
      "30 \u2192 60 rounds"
    ],
    "cons": [
      "Reload +30%",
      "ADS +10%",
      "Move \u22122%"
    ],
    "mods": {
      "magMul": 2,
      "tacReloadMul": 1.3,
      "emptyReloadMul": 1.3,
      "adsTimeMul": 1.1,
      "moveSpeedMul": 0.98
    },
    "visual": "mag_drum",
    "family": "M416 5.56"
  },
  {
    "id": "mag_fast",
    "slot": "magazine",
    "name": "Coupled Rifle Magazines",
    "price": 700,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "ak47"
    ],
    "desc": "A seated magazine plus a supported spare. Faster reloads, more carried bulk.",
    "pros": [
      "Tactical reload \u221222%",
      "Empty reload \u221218%"
    ],
    "cons": [
      "Same capacity",
      "ADS +4%"
    ],
    "mods": {
      "tacReloadMul": 0.78,
      "emptyReloadMul": 0.82,
      "adsTimeMul": 1.04
    },
    "visual": "mag_coupled",
    "family": "Rifle reload system"
  },
  {
    "id": "mag_shell_tube",
    "slot": "magazine",
    "name": "Extended Tube",
    "price": 700,
    "tier": 2,
    "compat": [
      "spas12"
    ],
    "desc": "A short SPAS tube extension with a matching collar and end cap.",
    "pros": [
      "8 \u2192 10 shells"
    ],
    "cons": [
      "Reload +12%"
    ],
    "mods": {
      "magAdd": 2,
      "tacReloadMul": 1.12,
      "emptyReloadMul": 1.12
    },
    "visual": "shell_tube"
  },
  {
    "id": "mag_belt_box",
    "slot": "magazine",
    "name": "Large Ammo Box",
    "price": 1300,
    "tier": 3,
    "compat": [
      "m249"
    ],
    "desc": "Doubled belt box hanging off the gun. Two hundred rounds before the long reload \u2014 plan accordingly.",
    "pros": [
      "100 \u2192 200 rounds"
    ],
    "cons": [
      "Reload +25%",
      "ADS +8%",
      "Move \u22123%"
    ],
    "mods": {
      "magMul": 2,
      "tacReloadMul": 1.25,
      "emptyReloadMul": 1.25,
      "adsTimeMul": 1.08,
      "moveSpeedMul": 0.97
    },
    "visual": "belt_box_large"
  },
  {
    "id": "mag_sr_10",
    "slot": "magazine",
    "name": "10-Round Mag",
    "price": 750,
    "tier": 2,
    "compat": [
      "awm"
    ],
    "desc": "Double-stack box, ten rounds of .338. Twice the follow-ups before the bolt goes lonely.",
    "pros": [
      "5 \u2192 10 rounds"
    ],
    "cons": [
      "Slightly slower reload"
    ],
    "mods": {
      "magMul": 2,
      "tacReloadMul": 1.1
    },
    "visual": "mag_box_sr"
  },
  {
    "id": "ub_vert_grip",
    "slot": "underbarrel",
    "name": "Vertical Grip",
    "price": 400,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "vector"
    ],
    "desc": "Ribbed vertical grip for controlling muzzle climb. Deliberate rather than snap-fast.",
    "pros": [
      "Vertical recoil \u221216%"
    ],
    "cons": [
      "ADS +4%"
    ],
    "mods": {
      "recoilMul": 0.84,
      "recoilYawMul": 0.98,
      "adsTimeMul": 1.04
    },
    "visual": "vgrip"
  },
  {
    "id": "ub_angled_grip",
    "slot": "underbarrel",
    "name": "Angled Foregrip",
    "price": 500,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "vector"
    ],
    "desc": "Low angled palm shelf for horizontal tracking and quick shoulder transitions.",
    "pros": [
      "Horizontal recoil \u221222%",
      "ADS \u22126%"
    ],
    "cons": [
      "Vertical recoil +3%"
    ],
    "mods": {
      "recoilYawMul": 0.78,
      "adsTimeMul": 0.94,
      "recoilMul": 1.03
    },
    "visual": "agrip"
  },
  {
    "id": "ub_bipod",
    "slot": "underbarrel",
    "name": "Bipod",
    "price": 550,
    "tier": 2,
    "compat": [
      "awm",
      "scar_h",
      "m249"
    ],
    "desc": "Hinged legs deploy only when crouched, grounded and still. Strong support, never zero recoil.",
    "pros": [
      "Supported recoil \u221230%",
      "Supported spread reduction"
    ],
    "cons": [
      "ADS +6%",
      "Move \u22122%"
    ],
    "mods": {
      "bipod": true,
      "adsTimeMul": 1.06,
      "moveSpeedMul": 0.98
    },
    "visual": "bipod"
  },
  {
    "id": "ub_shotgun_m26",
    "slot": "underbarrel",
    "name": "Masterkey Breacher",
    "price": 1800,
    "tier": 3,
    "compat": [
      "m4a1",
      "mcx_spear"
    ],
    "desc": "Compact receiver-mounted breacher with a dedicated M416 clamp. Press B; its own three-shell tube.",
    "pros": [
      "Secondary shotgun (B)",
      "Own 3-shell tube"
    ],
    "cons": [
      "Heavy",
      "3.5 s tube reload"
    ],
    "mods": {
      "masterkey": true,
      "moveSpeedMul": 0.98,
      "adsTimeMul": 1.05
    },
    "visual": "masterkey",
    "family": "M416 receiver clamp"
  },
  {
    "id": "stk_none",
    "slot": "stock",
    "name": "Lightweight Stock Kit",
    "price": 300,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear"
    ],
    "desc": "Minimal cheek sleeve and pull tab on the original stock. Keeps the AR silhouette.",
    "pros": [
      "ADS \u22126%",
      "Swap \u221210%"
    ],
    "cons": [
      "Vertical recoil +6%"
    ],
    "mods": {
      "adsTimeMul": 0.94,
      "swapTimeMul": 0.9,
      "recoilMul": 1.06
    },
    "visual": "stock_light",
    "family": "M416 stock furniture"
  },
  {
    "id": "stk_heavy",
    "slot": "stock",
    "name": "Fitted Cheek & Recoil Kit",
    "price": 650,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249"
    ],
    "desc": "Host-matched cheek support and buttpad. Retains the actual weapon stock.",
    "pros": [
      "Vertical recoil \u221212%",
      "Sway \u221218%"
    ],
    "cons": [
      "ADS +8%",
      "Move \u22121%"
    ],
    "mods": {
      "recoilMul": 0.88,
      "swayMul": 0.82,
      "adsTimeMul": 1.08,
      "moveSpeedMul": 0.99
    },
    "visual": "stock_fit",
    "family": "Native stock upgrade"
  },
  {
    "id": "stk_folding",
    "slot": "stock",
    "name": "Compact Stock Pad",
    "price": 500,
    "tier": 2,
    "compat": [
      "vector",
      "mp7"
    ],
    "desc": "Thin recoil pad for the native sliding/folding stock; no generic rifle stock replacement.",
    "pros": [
      "Swap \u221210%",
      "Vertical recoil \u22126%"
    ],
    "cons": [
      "ADS +2%"
    ],
    "mods": {
      "swapTimeMul": 0.9,
      "recoilMul": 0.94,
      "adsTimeMul": 1.02
    },
    "visual": "stock_fit",
    "family": "PDW / SMG stock"
  },
  {
    "id": "rail_laser",
    "slot": "rail",
    "name": "Rifle Laser Module",
    "price": 450,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249"
    ],
    "desc": "Compact rifle laser housing with a seated clamp and visible emitter.",
    "pros": [
      "Hip spread \u221220%",
      "Visible aim dot"
    ],
    "cons": [
      "ADS +2%",
      "Visible beam gives away position"
    ],
    "mods": {
      "laser": true,
      "hipSpreadMul": 0.8,
      "adsTimeMul": 1.02
    },
    "visual": "laser_box",
    "family": "Long-gun side rail"
  },
  {
    "id": "rail_flashlight",
    "slot": "rail",
    "name": "Scout Weapon Light",
    "price": 350,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249",
      "spas12",
      "awm"
    ],
    "desc": "Slim cylindrical scout light on a short rail clamp.",
    "pros": [
      "Illuminates interiors",
      "Close-range light disruption"
    ],
    "cons": [
      "ADS +2%",
      "Visible light gives away position"
    ],
    "mods": {
      "flashlight": true,
      "adsTimeMul": 1.02
    },
    "visual": "light_box",
    "family": "Long-gun rail"
  },
  {
    "id": "rail_canted",
    "slot": "rail",
    "name": "45\u00b0 Canted Irons",
    "price": 400,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h"
    ],
    "desc": "Small offset backup sights on a proper side-rail bracket. Hold T to use the 1\u00d7 backup while ADS.",
    "pros": [
      "1\u00d7 backup sight (hold T)",
      "Fast transition"
    ],
    "cons": [
      "Needs a magnified optic to matter"
    ],
    "mods": {
      "canted": true
    },
    "visual": "canted_irons"
  },
  {
    "id": "brl_long",
    "slot": "barrel",
    "name": "Long Barrel",
    "price": 750,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "m249"
    ],
    "desc": "Host-matched precision barrel with a modest extension. Retains the handguard, receiver and stock silhouette.",
    "pros": [
      "+15 m effective range",
      "+4% damage"
    ],
    "cons": [
      "Slower ADS and move"
    ],
    "mods": {
      "falloffStartAdd": 15,
      "damageMul": 1.04,
      "adsTimeMul": 1.1,
      "moveSpeedMul": 0.98
    },
    "visual": "barrel_long"
  },
  {
    "id": "brl_short",
    "slot": "barrel",
    "name": "CQB Short Barrel",
    "price": 700,
    "tier": 2,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "vector"
    ],
    "desc": "Short host-matched barrel, not a replacement handguard. The muzzle remains seated ahead of the receiver.",
    "pros": [
      "Faster ADS, swap and move"
    ],
    "cons": [
      "\u221210 m effective range",
      "Wider hip spread"
    ],
    "mods": {
      "adsTimeMul": 0.85,
      "swapTimeMul": 0.85,
      "moveSpeedMul": 1.03,
      "falloffStartAdd": -10,
      "hipSpreadMul": 1.1
    },
    "visual": "barrel_short"
  },
  {
    "id": "brl_ported",
    "slot": "barrel",
    "name": "Ported Slide / Barrel",
    "price": 550,
    "tier": 2,
    "compat": [
      "m1911",
      "deagle"
    ],
    "desc": "Gas ports cut into the top line. Vents climb upward and away \u2014 with a taller flash to match.",
    "pros": [
      "Recoil \u221220%"
    ],
    "cons": [
      "Bigger flash"
    ],
    "mods": {
      "recoilMul": 0.8,
      "flashMul": 1.3
    },
    "visual": "ported_slide"
  },
  {
    "id": "muz_ak_brake",
    "slot": "muzzle",
    "name": "AK Slant Brake",
    "price": 500,
    "tier": 1,
    "compat": [
      "ak47"
    ],
    "desc": "Compact angled AK brake. Keeps the wooden rifle silhouette intact.",
    "pros": [
      "Vertical recoil \u221212%",
      "Horizontal recoil \u221214%"
    ],
    "cons": [
      "Flash +15%"
    ],
    "mods": {
      "recoilMul": 0.88,
      "recoilYawMul": 0.86,
      "flashMul": 1.15
    },
    "visual": "ak_brake",
    "family": "AK 7.62"
  },
  {
    "id": "muz_ak_suppressor",
    "slot": "muzzle",
    "name": "AK Threaded Suppressor",
    "price": 800,
    "tier": 2,
    "compat": [
      "ak47"
    ],
    "desc": "Short threaded 7.62 can with its own stepped AK collar.",
    "pros": [
      "Noise \u221270%",
      "Reduced flash"
    ],
    "cons": [
      "Damage \u22128%",
      "ADS +10%"
    ],
    "mods": {
      "noiseRadiusMul": 0.3,
      "damageMul": 0.92,
      "suppressed": true,
      "flashMul": 0.35,
      "adsTimeMul": 1.1
    },
    "visual": "suppressor_long",
    "family": "AK 7.62"
  },
  {
    "id": "muz_smg_comp",
    "slot": "muzzle",
    "name": "Compact SMG Compensator",
    "price": 500,
    "tier": 1,
    "compat": [
      "mp7",
      "vector"
    ],
    "desc": "Short two-port device sized for compact barrels.",
    "pros": [
      "Vertical recoil \u221213%",
      "Horizontal recoil \u221220%"
    ],
    "cons": [
      "Noise +8%"
    ],
    "mods": {
      "recoilMul": 0.87,
      "recoilYawMul": 0.8,
      "noiseRadiusMul": 1.08
    },
    "visual": "compensator",
    "family": "PDW / SMG"
  },
  {
    "id": "muz_smg_suppressor",
    "slot": "muzzle",
    "name": "Compact SMG Suppressor",
    "price": 800,
    "tier": 2,
    "compat": [
      "mp7",
      "vector"
    ],
    "desc": "Short, small-diameter can without rifle-sized collars.",
    "pros": [
      "Noise \u221265%",
      "Low flash"
    ],
    "cons": [
      "ADS +8%",
      "Damage \u22124%"
    ],
    "mods": {
      "noiseRadiusMul": 0.35,
      "suppressed": true,
      "flashMul": 0.3,
      "adsTimeMul": 1.08,
      "damageMul": 0.96
    },
    "visual": "suppressor_long",
    "family": "PDW / SMG"
  },
  {
    "id": "muz_45_suppressor",
    "slot": "muzzle",
    "name": ".45 Pistol Suppressor",
    "price": 800,
    "tier": 2,
    "compat": [
      "m1911"
    ],
    "desc": "Slim boosted pistol can, fitted to the 1911 only.",
    "pros": [
      "Noise \u221260%",
      "Low flash"
    ],
    "cons": [
      "ADS +12%",
      "Recoil +4%"
    ],
    "mods": {
      "noiseRadiusMul": 0.4,
      "suppressed": true,
      "flashMul": 0.25,
      "adsTimeMul": 1.12,
      "recoilMul": 1.04
    },
    "visual": "suppressor_long",
    "family": "1911 .45"
  },
  {
    "id": "muz_50_brake",
    "slot": "muzzle",
    "name": ".50 AE Port Brake",
    "price": 500,
    "tier": 1,
    "compat": [
      "deagle"
    ],
    "desc": "Short polygonal brake follows the Eagle barrel profile.",
    "pros": [
      "Vertical recoil \u221218%"
    ],
    "cons": [
      "Flash +30%",
      "Noise +15%"
    ],
    "mods": {
      "recoilMul": 0.82,
      "flashMul": 1.3,
      "noiseRadiusMul": 1.15
    },
    "visual": "pistol_brake",
    "family": "Deagle .50"
  },
  {
    "id": "opt_ak_4x",
    "slot": "optic",
    "name": "AK 4\u00d7 Side-Mount Optic",
    "price": 1200,
    "tier": 2,
    "compat": [
      "ak47"
    ],
    "desc": "Low 4\u00d7 prism on a receiver-side cantilever. Dedicated AK mounting hardware.",
    "pros": [
      "Fixed 4\u00d7 zoom",
      "AK dovetail mount"
    ],
    "cons": [
      "ADS +22%",
      "Sway +6%"
    ],
    "mods": {
      "scopeReticle": "bdc4",
      "scopePower": 4,
      "adsTimeMul": 1.22,
      "swayMul": 1.06
    },
    "visual": "ak_prism",
    "family": "AK receiver dovetail"
  },
  {
    "id": "opt_ak_dot",
    "slot": "optic",
    "name": "AK Dovetail Red Dot",
    "price": 450,
    "tier": 1,
    "compat": [
      "ak47"
    ],
    "desc": "Compact tube dot on the AK side-mount rather than floating over the cover.",
    "pros": [
      "Clear 1\u00d7 dot",
      "AK dovetail mount"
    ],
    "cons": [
      "ADS +3%"
    ],
    "mods": {
      "scopeReticle": "dot",
      "scopePower": 1,
      "adsTimeMul": 1.03
    },
    "visual": "reddot",
    "family": "AK receiver dovetail"
  },
  {
    "id": "opt_8x",
    "slot": "optic",
    "name": "8\u00d7 Marksman Scope",
    "price": 2000,
    "tier": 3,
    "compat": [
      "awm"
    ],
    "desc": "AWM-only variable long-range optic. Switch smoothly from 3\u00d7 wide view to 8\u00d7 precision.",
    "pros": [
      "Variable 3\u20138\u00d7 optical zoom",
      "Ranging-tree reticle"
    ],
    "cons": [
      "ADS +34%",
      "Standing sway +15%"
    ],
    "mods": {
      "scopeReticle": "mil8",
      "scopePower": 8,
      "scopeMinPower": 3,
      "adsTimeMul": 1.34,
      "swayMul": 1.15,
      "swayMulCrouched": 0.75
    },
    "visual": "scope_8x",
    "family": "AWM long-range"
  },
  {
    "id": "mag_extended_ak",
    "slot": "magazine",
    "name": "45-Round AK Magazine",
    "price": 600,
    "tier": 2,
    "compat": [
      "ak47"
    ],
    "desc": "Host-specific feed geometry, case finish and floorplate. Not a rifle magazine scaled onto another gun.",
    "pros": [
      "30 \u2192 45 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 15,
      "reserveAdd": 30,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "45-Round AK"
  },
  {
    "id": "mag_extended_scar",
    "slot": "magazine",
    "name": "30-Round SCAR Magazine",
    "price": 600,
    "tier": 2,
    "compat": [
      "scar_h"
    ],
    "desc": "Host-specific feed geometry, case finish and floorplate. Not a rifle magazine scaled onto another gun.",
    "pros": [
      "20 \u2192 30 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 10,
      "reserveAdd": 20,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "30-Round SCAR"
  },
  {
    "id": "mag_extended_vector",
    "slot": "magazine",
    "name": "33-Round Vector Magazine",
    "price": 600,
    "tier": 2,
    "compat": [
      "vector"
    ],
    "desc": "Host-specific feed geometry, case finish and floorplate. Not a rifle magazine scaled onto another gun.",
    "pros": [
      "25 \u2192 33 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 8,
      "reserveAdd": 16,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "33-Round Vector"
  },
  {
    "id": "mag_extended_mp7",
    "slot": "magazine",
    "name": "50-Round MP7 Magazine",
    "price": 600,
    "tier": 2,
    "compat": [
      "mp7"
    ],
    "desc": "Host-specific feed geometry, case finish and floorplate. Not a rifle magazine scaled onto another gun.",
    "pros": [
      "40 \u2192 50 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 10,
      "reserveAdd": 20,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "50-Round MP7"
  },
  {
    "id": "mag_extended_1911",
    "slot": "magazine",
    "name": "10-Round .45 Magazine",
    "price": 600,
    "tier": 2,
    "compat": [
      "m1911"
    ],
    "desc": "Host-specific feed geometry, case finish and floorplate. Not a rifle magazine scaled onto another gun.",
    "pros": [
      "8 \u2192 10 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 2,
      "reserveAdd": 8,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "10-Round .45"
  },
  {
    "id": "mag_extended_deagle",
    "slot": "magazine",
    "name": "9-Round .50 AE Magazine",
    "price": 600,
    "tier": 2,
    "compat": [
      "deagle"
    ],
    "desc": "Host-specific feed geometry, case finish and floorplate. Not a rifle magazine scaled onto another gun.",
    "pros": [
      "7 \u2192 9 rounds"
    ],
    "cons": [
      "Reload +10%",
      "ADS +3%"
    ],
    "mods": {
      "magAdd": 2,
      "reserveAdd": 8,
      "tacReloadMul": 1.1,
      "emptyReloadMul": 1.1,
      "adsTimeMul": 1.03
    },
    "visual": "mag_ext",
    "family": "9-Round .50 AE"
  },
  {
    "id": "mag_drum_ak",
    "slot": "magazine",
    "name": "75-Round AK Drum",
    "price": 1350,
    "tier": 3,
    "compat": [
      "ak47"
    ],
    "desc": "Wound steel drum and AK-specific feed tower.",
    "pros": [
      "30 \u2192 75 rounds"
    ],
    "cons": [
      "Reload +35%",
      "ADS +12%",
      "Move \u22123%"
    ],
    "mods": {
      "magMul": 2.5,
      "tacReloadMul": 1.35,
      "emptyReloadMul": 1.35,
      "adsTimeMul": 1.12,
      "moveSpeedMul": 0.97
    },
    "visual": "mag_drum",
    "family": "AK 7.62"
  },
  {
    "id": "mag_drum_vector",
    "slot": "magazine",
    "name": "50-Round Vector Drum",
    "price": 1350,
    "tier": 3,
    "compat": [
      "vector"
    ],
    "desc": "Compact polymer drum with a lowered neck that clears the foregrip.",
    "pros": [
      "25 \u2192 50 rounds"
    ],
    "cons": [
      "Reload +25%",
      "ADS +9%",
      "Move \u22122%"
    ],
    "mods": {
      "magMul": 2,
      "tacReloadMul": 1.25,
      "emptyReloadMul": 1.25,
      "adsTimeMul": 1.09,
      "moveSpeedMul": 0.98
    },
    "visual": "mag_drum",
    "family": "Vector .45"
  },
  {
    "id": "mag_quick_mp7",
    "slot": "magazine",
    "name": "MP7 Quick-Pull Magazine",
    "price": 700,
    "tier": 2,
    "compat": [
      "mp7"
    ],
    "desc": "Native-length magazine with a textured quick-pull floorplate.",
    "pros": [
      "Tactical reload \u221218%",
      "Empty reload \u221215%"
    ],
    "cons": [
      "Same capacity",
      "Hip spread +2%"
    ],
    "mods": {
      "tacReloadMul": 0.82,
      "emptyReloadMul": 0.85,
      "hipSpreadMul": 1.02
    },
    "visual": "mag_quick",
    "family": "Compact reload system"
  },
  {
    "id": "mag_quick_vector",
    "slot": "magazine",
    "name": "Vector Quick-Pull Magazine",
    "price": 700,
    "tier": 2,
    "compat": [
      "vector"
    ],
    "desc": "Native-length magazine with a textured quick-pull floorplate.",
    "pros": [
      "Tactical reload \u221218%",
      "Empty reload \u221215%"
    ],
    "cons": [
      "Same capacity",
      "Hip spread +2%"
    ],
    "mods": {
      "tacReloadMul": 0.82,
      "emptyReloadMul": 0.85,
      "hipSpreadMul": 1.02
    },
    "visual": "mag_quick",
    "family": "Compact reload system"
  },
  {
    "id": "ub_half_grip",
    "slot": "underbarrel",
    "name": "Half Grip",
    "price": 550,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h",
      "vector"
    ],
    "desc": "Short open-frame grip with balanced burst control but a less stable hold.",
    "pros": [
      "Vertical recoil \u22129%",
      "Horizontal recoil \u221212%"
    ],
    "cons": [
      "Sway +12%"
    ],
    "mods": {
      "recoilMul": 0.91,
      "recoilYawMul": 0.88,
      "swayMul": 1.12
    },
    "visual": "half_grip",
    "family": "Burst-control grip"
  },
  {
    "id": "ub_thumb_grip",
    "slot": "underbarrel",
    "name": "Thumb Grip",
    "price": 600,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h"
    ],
    "desc": "Small thumb ledge and handstop; prioritises ADS, not spray control.",
    "pros": [
      "ADS \u221218%",
      "Vertical recoil \u22123%"
    ],
    "cons": [
      "Horizontal recoil +8%"
    ],
    "mods": {
      "adsTimeMul": 0.82,
      "recoilMul": 0.97,
      "recoilYawMul": 1.08
    },
    "visual": "thumb_grip",
    "family": "Fast-handling grip"
  },
  {
    "id": "ub_light_grip",
    "slot": "underbarrel",
    "name": "Light Grip",
    "price": 500,
    "tier": 1,
    "compat": [
      "m4a1",
      "mcx_spear",
      "scar_h"
    ],
    "desc": "Skeletonised palm support for steady single shots. Less helpful in long bursts.",
    "pros": [
      "Sway \u221228%",
      "Aimed dispersion \u221215%"
    ],
    "cons": [
      "Vertical recoil +8%"
    ],
    "mods": {
      "swayMul": 0.72,
      "adsSpreadMul": 0.85,
      "recoilMul": 1.08
    },
    "visual": "light_grip",
    "family": "Precision grip"
  },
  {
    "id": "ub_spas_sleeve",
    "slot": "underbarrel",
    "name": "SPAS Pump Handstop",
    "price": 400,
    "tier": 1,
    "compat": [
      "spas12"
    ],
    "desc": "Short palm stop bolted to the moving pump; follows the action without replacing it.",
    "pros": [
      "Vertical recoil \u22129%"
    ],
    "cons": [
      "Reload +3%"
    ],
    "mods": {
      "recoilMul": 0.91,
      "tacReloadMul": 1.03,
      "emptyReloadMul": 1.03
    },
    "visual": "pump_stop",
    "family": "SPAS sliding pump"
  },
  {
    "id": "rail_compact_laser",
    "slot": "rail",
    "name": "Compact Laser Module",
    "price": 450,
    "tier": 1,
    "compat": [
      "mp7",
      "vector"
    ],
    "desc": "Short housing that stays within compact handguard proportions.",
    "pros": [
      "Hip spread \u221216%"
    ],
    "cons": [
      "Visible beam"
    ],
    "mods": {
      "laser": true,
      "hipSpreadMul": 0.84
    },
    "visual": "compact_laser",
    "family": "Compact rail"
  },
  {
    "id": "rail_pistol_laser",
    "slot": "rail",
    "name": "Pistol Trigger-Guard Laser",
    "price": 450,
    "tier": 1,
    "compat": [
      "m1911",
      "deagle"
    ],
    "desc": "Small underframe module, not a rifle PEQ box on a pistol.",
    "pros": [
      "Hip spread \u221214%"
    ],
    "cons": [
      "Visible beam"
    ],
    "mods": {
      "laser": true,
      "hipSpreadMul": 0.86
    },
    "visual": "pistol_laser",
    "family": "Pistol underframe"
  },
  {
    "id": "rail_pistol_light",
    "slot": "rail",
    "name": "Compact Pistol Light",
    "price": 350,
    "tier": 1,
    "compat": [
      "m1911",
      "deagle"
    ],
    "desc": "Low-profile light with a short trigger-guard clamp.",
    "pros": [
      "Illuminates interiors"
    ],
    "cons": [
      "ADS +3%",
      "Visible light"
    ],
    "mods": {
      "flashlight": true,
      "adsTimeMul": 1.03
    },
    "visual": "pistol_light",
    "family": "Pistol underframe"
  }
];

export const MASTERKEY_SPEC = { pellets: 8, damage: 12, shells: 3, reload: 3.5 } as const;

const byId = new Map<WeaponId, WeaponCatalogEntry>(WEAPON_CATALOG.map(w => [w.id, w]));
const attachById = new Map<AttachmentId, AttachmentCatalogEntry>(ATTACHMENT_CATALOG.map(a => [a.id, a]));

export function weaponById(id: string): WeaponCatalogEntry | undefined {
  return byId.get(id as WeaponId);
}

export function attachmentById(id: string): AttachmentCatalogEntry | undefined {
  return attachById.get(id);
}

export function isCompatible(entry: AttachmentCatalogEntry, weapon: WeaponId): boolean {
  const w = byId.get(weapon);
  if (!w) return false;
  return entry.compat.includes(weapon) && w.slots.includes(entry.slot);
}

/** Every catalog attachment for a weapon+slot pair, tier order (then price). */
export function attachmentsFor(weapon: WeaponId, slot: AttachSlot): AttachmentCatalogEntry[] {
  return ATTACHMENT_CATALOG
    .filter(a => a.slot === slot && isCompatible(a, weapon))
    .sort((a, b) => a.tier - b.tier || a.price - b.price);
}
