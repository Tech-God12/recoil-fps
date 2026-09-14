// Recoil FPS — Armory catalog: weapons + attachments (PURE DATA, no three.js / React).
// Every number here is game design, safe to import from Node tests and the engine alike.
import type { StatMods } from './stats';

export type WeaponId =
  | 'm4a1' | 'ak47' | 'm1911' | 'awm' | 'mp7'
  | 'scar_h' | 'vector' | 'spas12' | 'deagle' | 'm249';
export type WeaponClass = 'AR' | 'BR' | 'SMG' | 'PDW' | 'SR' | 'SG' | 'LMG' | 'PISTOL';
export type SlotId = 'primary' | 'secondary';
export type AttachSlot = 'muzzle' | 'optic' | 'magazine' | 'underbarrel' | 'stock' | 'rail' | 'barrel';
export type AttachmentId = string;
export type AudioKind =
  | 'm4' | 'ak' | 'pistol' | 'sniper' | 'smg'
  | 'scar' | 'vector' | 'shotgun' | 'deagle' | 'lmg';

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
}

const STOCK = [[0, 0]] as [number, number][];

function base(o: Partial<BaseWeaponStats> & Pick<BaseWeaponStats, 'rpm' | 'damage'>): BaseWeaponStats {
  const { rpm, damage, ...rest } = o;
  return {
    auto: true, rpm, damage,
    headMul: 2.2, limbMul: 0.85, magSize: 30, reserve: 120,
    hipSpread: 0.01, adsSpread: 0, pattern: STOCK.map(p => [...p] as [number, number]),
    adsFov: 58, tacReload: 2.2, emptyReload: 2.7,
    adsTime: 0.22, recoilMul: 1, falloffStart: 35, falloffMul: 0.85,
    noiseRadius: 65, moveSpeedMul: 1, swapTime: 0.13,
    ...rest,
  };
}
export const WEAPON_CATALOG: WeaponCatalogEntry[] = [
  {
    id: 'm4a1', name: 'Colt M4A1', short: 'M4A1', cls: 'AR', slot: 'primary',
    price: 0, starter: true,
    blurb: 'The workhorse. Flat-shooting, fast-handling carbine that does everything well and forgives everything else.',
    base: base({ auto: true, rpm: 780, damage: 34, headMul: 2.3, limbMul: 0.85, magSize: 30, reserve: 150, hipSpread: 0.008, adsFov: 56, tacReload: 2.1, emptyReload: 2.7, adsTime: 0.22 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'm4',
  },
  {
    id: 'ak47', name: 'Kalashnikov AK-47', short: 'AK-47', cls: 'AR', slot: 'primary',
    price: 3800, starter: false,
    blurb: 'Hard-hitting 7.62. Slower, louder, heavier — and every round lands like a slammed door.',
    base: base({ auto: true, rpm: 600, damage: 46, headMul: 2.5, limbMul: 0.8, magSize: 30, reserve: 120, hipSpread: 0.010, adsFov: 58, tacReload: 2.4, emptyReload: 3.0, adsTime: 0.25 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'ak',
  },
  {
    id: 'm1911', name: 'Colt M1911', short: '1911', cls: 'PISTOL', slot: 'secondary',
    price: 0, starter: true,
    blurb: 'Old warhorse in .45 ACP. Eight rounds of authority for when the primary runs dry.',
    base: base({ auto: false, rpm: 420, damage: 42, headMul: 2.6, limbMul: 0.85, magSize: 8, reserve: 48, hipSpread: 0.006, adsFov: 64, tacReload: 1.5, emptyReload: 1.8, adsTime: 0.16, noiseRadius: 50, moveSpeedMul: 1.05 }),
    slots: ['muzzle', 'optic', 'magazine', 'rail', 'barrel'],
    audio: 'pistol', slideBlowback: true,
  },
  {
    id: 'awm', name: 'AI AWM .338', short: 'AWM', cls: 'SR', slot: 'primary',
    price: 7800, starter: false,
    blurb: 'Bolt-action .338 Lapua. One round, one silhouette down — if you can stand the scope sway and the report.',
    base: base({ auto: false, rpm: 48, damage: 78, headMul: 3.0, limbMul: 1.0, magSize: 5, reserve: 25, hipSpread: 0.045, adsFov: 22, tacReload: 2.25, emptyReload: 2.7, adsTime: 0.42, noiseRadius: 90, moveSpeedMul: 0.96 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'rail'],
    audio: 'sniper', boltAction: true, scoped: true,
  },
  {
    id: 'mp7', name: 'H&K MP7A1', short: 'MP7', cls: 'PDW', slot: 'primary',
    price: 2400, starter: false,
    blurb: 'Pocket firestorm. 900 RPM of 4.6mm for room-clearing on a budget — climbs if you hold the trigger.',
    base: base({ auto: true, rpm: 900, damage: 24, headMul: 2.2, limbMul: 0.8, magSize: 40, reserve: 200, hipSpread: 0.011, pattern: [[0.6, 0.15], [0.75, -0.2], [0.85, 0.25], [0.9, -0.1]], adsFov: 60, tacReload: 1.9, emptyReload: 2.3, adsTime: 0.18, noiseRadius: 55 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail'],
    audio: 'smg',
  },
  {
    id: 'vector', name: 'KRISS Vector .45', short: 'VECTOR', cls: 'SMG', slot: 'primary',
    price: 4600, starter: false,
    blurb: '1,100 RPM Super-V laser. Weak per round, absurd per second — recoil practically deletes itself.',
    base: base({ auto: true, rpm: 1100, damage: 24, headMul: 2.0, limbMul: 0.85, magSize: 25, reserve: 175, hipSpread: 0.011, adsFov: 62, tacReload: 2.0, emptyReload: 2.5, adsTime: 0.17, recoilMul: 0.7, falloffStart: 22, noiseRadius: 58 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'vector',
  },
  {
    id: 'spas12', name: 'Franchi SPAS-12', short: 'SPAS-12', cls: 'SG', slot: 'primary',
    price: 5200, starter: false,
    blurb: 'Pump-action devastation. Eight pellets of 12-gauge diplomacy inside 12 metres — nothing argues back.',
    base: base({ auto: false, rpm: 80, damage: 14, headMul: 1.6, limbMul: 0.9, magSize: 8, reserve: 40, hipSpread: 0.045, adsSpread: 0.028, adsFov: 66, tacReload: 3.2, emptyReload: 3.2, adsTime: 0.24, recoilMul: 1.5, falloffStart: 12, falloffMul: 0.45, noiseRadius: 80 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail'],
    audio: 'shotgun', pump: true, pellets: 8,
  },
  {
    id: 'scar_h', name: 'FN SCAR-H', short: 'SCAR-H', cls: 'BR', slot: 'primary',
    price: 6400, starter: false,
    blurb: 'Two-tap battle rifle. Slow, surgical, and heavy — the muzzle climbs like it has somewhere to be.',
    base: base({ auto: true, rpm: 600, damage: 52, headMul: 2.4, limbMul: 0.85, magSize: 20, reserve: 100, hipSpread: 0.010, adsFov: 55, tacReload: 2.3, emptyReload: 2.9, adsTime: 0.26, recoilMul: 1.35, falloffStart: 45, falloffMul: 0.9, noiseRadius: 75 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'scar',
  },
  {
    id: 'deagle', name: 'Desert Eagle .50 AE', short: 'DEAGLE', cls: 'PISTOL', slot: 'secondary',
    price: 3200, starter: false,
    blurb: 'Hand cannon in .50 AE. Two rounds centre-mass ends the conversation — and nearly your wrist.',
    base: base({ auto: false, rpm: 240, damage: 62, headMul: 2.8, limbMul: 0.8, magSize: 7, reserve: 35, hipSpread: 0.009, adsFov: 64, tacReload: 1.7, emptyReload: 2.0, adsTime: 0.19, recoilMul: 1.8, falloffStart: 30, noiseRadius: 85, moveSpeedMul: 1.03 }),
    slots: ['muzzle', 'optic', 'magazine', 'rail', 'barrel'],
    audio: 'deagle', slideBlowback: true,
  },
  {
    id: 'm249', name: 'FN M249 SAW', short: 'M249', cls: 'LMG', slot: 'primary',
    price: 8600, starter: false,
    blurb: '100-round belt of suppression. Slow to shoulder, slow to reload, impossible to ignore downrange.',
    base: base({ auto: true, rpm: 800, damage: 36, headMul: 2.2, limbMul: 0.85, magSize: 100, reserve: 200, hipSpread: 0.016, adsFov: 60, tacReload: 5.4, emptyReload: 5.4, adsTime: 0.40, recoilMul: 1.15, falloffStart: 40, noiseRadius: 80, moveSpeedMul: 0.92, swapTime: 0.32 }),
    slots: ['muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail', 'barrel'],
    audio: 'lmg', beltFed: true, bloom: { perShot: 0.0006, max: 0.012, decay: 0.03 },
  },
];

const RIFLES: WeaponId[] = ['m4a1', 'ak47', 'scar_h', 'vector', 'mp7', 'spas12', 'm249'];

export const ATTACHMENT_CATALOG: AttachmentCatalogEntry[] = [
  // ---------------- MUZZLE ----------------
  {
    id: 'muz_flash_hider', slot: 'muzzle', name: 'Flash Hider', price: 250, tier: 1,
    compat: ['m4a1', 'ak47', 'm1911', 'awm', 'mp7', 'scar_h', 'vector', 'spas12', 'deagle', 'm249'],
    desc: 'Three-prong hider. Kills the fireball so you keep your night sight picture — and stay harder to spot.',
    pros: ['Muzzle flash −65%', 'Slightly quieter report'],
    cons: ['No recoil help'],
    mods: { flashMul: 0.35, noiseRadiusMul: 0.9 },
    visual: 'flash_hider',
  },
  {
    id: 'muz_compensator', slot: 'muzzle', name: 'Compensator', price: 500, tier: 1,
    compat: ['m4a1', 'ak47', 'm1911', 'awm', 'mp7', 'scar_h', 'vector', 'deagle', 'm249'],
    desc: 'Ported comp that vents gas sideways. Tames climb and sideways walk — but everyone hears you working.',
    pros: ['Recoil −20%', 'Horizontal drift −35%'],
    cons: ['Louder (+15% hear range)'],
    mods: { recoilMul: 0.8, recoilYawMul: 0.65, noiseRadiusMul: 1.15 },
    visual: 'compensator',
  },
  {
    id: 'muz_suppressor', slot: 'muzzle', name: 'Tactical Suppressor', price: 800, tier: 2,
    compat: ['m4a1', 'ak47', 'scar_h', 'vector', 'mp7', 'm1911', 'deagle'],
    desc: 'Baffle-stack can. Kills the report and the flash — hostiles past 20 m won\u2019t hear the shot. Costs you a little velocity.',
    pros: ['Hearing range −70%', 'Flash nearly gone', 'Suppressed audio signature'],
    cons: ['Damage −8%', 'Shorter effective range', 'Slower ADS'],
    mods: { noiseRadiusMul: 0.3, damageMul: 0.92, falloffStartAdd: -8, adsTimeMul: 1.08, flashMul: 0.15, suppressed: true },
    visual: 'suppressor_long',
  },
  {
    id: 'muz_suppressor_sr', slot: 'muzzle', name: '.338 Sound Moderator', price: 1200, tier: 3,
    compat: ['awm'],
    desc: 'Fat-rated can for the .338. Same ghost signature as the tactical can, tuned to keep the big round honest.',
    pros: ['Hearing range −70%', 'Keeps 95% damage', 'Flash nearly gone'],
    cons: ['Shorter effective range', 'Slower ADS'],
    mods: { damageMul: 0.95, noiseRadiusMul: 0.30, falloffStartAdd: -8, adsTimeMul: 1.08, flashMul: 0.15, suppressed: true },
    visual: 'suppressor_fat',
  },
  {
    id: 'muz_brake_heavy', slot: 'muzzle', name: 'Heavy Muzzle Brake', price: 700, tier: 2,
    compat: ['scar_h', 'awm', 'm249', 'deagle'],
    desc: 'Two-chamber brute. Shoves the muzzle back down where it belongs — and announces it to the whole sector.',
    pros: ['Recoil −30%'],
    cons: ['Much louder (+30% hear range)', 'Bigger flash'],
    mods: { recoilMul: 0.7, noiseRadiusMul: 1.3, flashMul: 1.4 },
    visual: 'brake_heavy',
  },
  {
    id: 'muz_duckbill', slot: 'muzzle', name: 'Duckbill Choke', price: 500, tier: 2,
    compat: ['spas12'],
    desc: 'Spreads the pattern into a wide horizontal fan. Hallway-clearing geometry — useless past a doorway.',
    pros: ['Wide horizontal spread'],
    cons: ['Thin vertical coverage'],
    mods: { spreadXMul: 1.6, spreadYMul: 0.5 },
    visual: 'duckbill',
  },
  {
    id: 'muz_full_choke', slot: 'muzzle', name: 'Full Choke', price: 600, tier: 2,
    compat: ['spas12'],
    desc: 'Threaded collar that squeezes the cone tight. Keeps pellets on target a few metres further out.',
    pros: ['Tighter pellet cone', '+4 m effective range'],
    cons: ['None. Tubes love chokes.'],
    mods: { hipSpreadMul: 0.7, adsSpreadMul: 0.7, falloffStartAdd: 4 },
    visual: 'choke',
  },
  // ---------------- OPTIC ----------------
  {
    id: 'opt_reddot', slot: 'optic', name: 'RMR Red Dot', price: 450, tier: 1,
    compat: ['m4a1', 'ak47', 'scar_h', 'vector', 'mp7', 'spas12', 'm249'],
    desc: 'Single glowing dot, both eyes open. Snaps onto target faster than irons — no magnification, no excuses.',
    pros: ['Clean dot reticle', 'Faster ADS'],
    cons: ['No zoom'],
    mods: { scopeReticle: 'dot', adsTimeMul: 0.95 },
    visual: 'reddot',
  },
  {
    id: 'opt_holo', slot: 'optic', name: 'EOTech Holo', price: 700, tier: 2,
    compat: ['m4a1', 'ak47', 'scar_h', 'vector', 'mp7', 'spas12', 'm249'],
    desc: '68-MOA ring with a 1-MOA dot. Built for snap shots on the move — the ring does the leading for you.',
    pros: ['Ring reticle, fast pickup', 'Tighter hip fire'],
    cons: ['Marginally slower than a dot'],
    mods: { scopeReticle: 'holo', adsTimeMul: 0.97, hipSpreadMul: 0.95 },
    visual: 'holo',
  },
  {
    id: 'opt_acog', slot: 'optic', name: 'ACOG 4×', price: 1050, tier: 2,
    compat: ['m4a1', 'ak47', 'scar_h', 'm249'],
    desc: 'Fixed 4× chevron with bullet-drop ticks. Turns mid-range into your personal range day — tunnel vision included.',
    pros: ['4× magnification', '+10 m effective range'],
    cons: ['Slower ADS', 'Poor up close'],
    mods: { scopeReticle: 'acog', adsFovDelta: -22, adsTimeMul: 1.2, falloffStartAdd: 10 },
    visual: 'acog',
  },
  {
    id: 'opt_hybrid', slot: 'optic', name: 'LPVO 1–6×', price: 1400, tier: 3,
    compat: ['m4a1', 'ak47', 'scar_h'],
    desc: 'Low-power variable with true 1×. Tap V while scoped to swing between chevron speed and 6× reach.',
    pros: ['1× / 6× on demand (T)', 'Chevron reticle'],
    cons: ['Slower ADS', 'Heavy glass'],
    mods: { scopeReticle: 'acog', adsFovDelta: -14, adsTimeMul: 1.1, lpvo: true },
    visual: 'lpvo',
  },
  {
    id: 'opt_sniper_hp', slot: 'optic', name: 'High-Power 12×', price: 1650, tier: 3,
    compat: ['awm'],
    desc: 'Replaces the factory scope with a 12× precision tube. Steadier glass for prone-quality shots from a crouch.',
    pros: ['Stronger magnification', 'Steadier when crouched'],
    cons: ['Useless inside 20 m'],
    mods: { scopeReticle: 'sniper', adsFovDelta: -8, swayMulCrouched: 0.7 },
    visual: 'scope_hp',
  },
  {
    id: 'opt_pistol_rmr', slot: 'optic', name: 'Slide-Mount Micro Dot', price: 500, tier: 2,
    compat: ['m1911', 'deagle'],
    desc: 'Milled micro dot riding the slide. Snappier pickup than notches — the dot does not lie about your wobble.',
    pros: ['Dot reticle on a pistol', 'Faster ADS'],
    cons: ['No zoom'],
    mods: { scopeReticle: 'dot', adsTimeMul: 0.92 },
    visual: 'pistol_rmr',
  },
  // ---------------- MAGAZINE ----------------
  {
    id: 'mag_extended', slot: 'magazine', name: 'Extended Mag', price: 600, tier: 2,
    compat: ['m4a1', 'ak47', 'scar_h', 'vector', 'mp7', 'm1911', 'deagle'],
    desc: 'Half again the capacity in a taller mag. More trigger time per reload — slightly more weight on the swing.',
    pros: ['+50% magazine', '+30 reserve'],
    cons: ['Slower reload', 'Slower ADS', 'Slightly slower move'],
    mods: { magMul: 1.5, reserveAdd: 30, tacReloadMul: 1.12, adsTimeMul: 1.04, moveSpeedMul: 0.99 },
    visual: 'mag_ext',
  },
  {
    id: 'mag_drum', slot: 'magazine', name: 'Drum Magazine', price: 1350, tier: 3,
    compat: ['m4a1', 'ak47', 'vector'],
    desc: '75-round drum slung under the receiver. Suppressive fire without the pause — reloading it is a project.',
    pros: ['2.5× magazine'],
    cons: ['Much slower reloads', 'Slower ADS and move'],
    mods: { magMul: 2.5, tacReloadMul: 1.45, emptyReloadMul: 1.4, adsTimeMul: 1.12, moveSpeedMul: 0.97 },
    visual: 'mag_drum',
  },
  {
    id: 'mag_fast', slot: 'magazine', name: 'Fast Mag (Coupled)', price: 700, tier: 2,
    compat: ['m4a1', 'ak47', 'vector', 'mp7'],
    desc: 'Two mags clamped base-to-base. Flip, seat, back in the fight — the reload animation is half the show.',
    pros: ['Much faster reloads'],
    cons: ['Same capacity'],
    mods: { tacReloadMul: 0.72, emptyReloadMul: 0.8 },
    visual: 'mag_coupled',
  },
  {
    id: 'mag_shell_tube', slot: 'magazine', name: 'Extended Tube (+4)', price: 700, tier: 2,
    compat: ['spas12'],
    desc: 'Longer tube under the barrel, four more shells. Twelve rounds of pump-action persuasion.',
    pros: ['+4 shells'],
    cons: ['Longer to top off'],
    mods: { magAdd: 4 },
    visual: 'shell_tube',
  },
  {
    id: 'mag_belt_box', slot: 'magazine', name: '200-Round Soft Pack', price: 1300, tier: 3,
    compat: ['m249'],
    desc: 'Doubled belt box hanging off the SAW. Two hundred rounds before the long reload — plan accordingly.',
    pros: ['2× belt capacity'],
    cons: ['Slower belt reload', 'Heavier'],
    mods: { magMul: 2, emptyReloadMul: 1.35, moveSpeedMul: 0.96 },
    visual: 'belt_box_large',
  },
  {
    id: 'mag_sr_10', slot: 'magazine', name: '10-Round Detachable Box', price: 750, tier: 2,
    compat: ['awm'],
    desc: 'Double-stack box, ten rounds of .338. Twice the follow-ups before the bolt goes lonely.',
    pros: ['5 → 10 rounds'],
    cons: ['Slightly slower reload'],
    mods: { magMul: 2, tacReloadMul: 1.1 },
    visual: 'mag_box_sr',
  },
  // ---------------- UNDERBARREL ----------------
  {
    id: 'ub_vert_grip', slot: 'underbarrel', name: 'Vertical Grip', price: 400, tier: 1,
    compat: RIFLES,
    desc: 'Classic broomhandle. Locks the muzzle down during strings — hip fire opens up a touch.',
    pros: ['Recoil −12%'],
    cons: ['Hip spread +5%'],
    mods: { recoilMul: 0.88, hipSpreadMul: 1.05 },
    visual: 'vgrip',
  },
  {
    id: 'ub_angled_grip', slot: 'underbarrel', name: 'Angled Foregrip', price: 500, tier: 1,
    compat: RIFLES,
    desc: 'Low-profile wedge grip. Shaves time off every shoulder transition with a whisper of recoil help.',
    pros: ['Faster ADS (−15%)', 'Recoil −4%'],
    cons: ['Minimal recoil help'],
    mods: { adsTimeMul: 0.85, recoilMul: 0.96 },
    visual: 'agrip',
  },
  {
    id: 'ub_bipod', slot: 'underbarrel', name: 'Bipod', price: 550, tier: 2,
    compat: ['scar_h', 'awm', 'm249'],
    desc: 'Folding legs that deploy when crouched and still. A tripod-steady firing position anywhere — legs fold, penalties stay.',
    pros: ['Deployed: recoil & spread halved'],
    cons: ['Slower ADS and move when carried'],
    mods: { bipod: true, adsTimeMul: 1.06, moveSpeedMul: 0.98 },
    visual: 'bipod',
  },
  {
    id: 'ub_shotgun_m26', slot: 'underbarrel', name: 'Masterkey Breacher', price: 1800, tier: 3,
    compat: ['m4a1', 'scar_h'],
    desc: 'Mini 12-gauge under the handguard. Press B for a 3-shell problem solver with its own ammo — doors fear it.',
    pros: ['Secondary shotgun (B)', 'Own 3-shell tube'],
    cons: ['Heavy', '3.5 s tube reload'],
    mods: { masterkey: true, moveSpeedMul: 0.98, adsTimeMul: 1.05 },
    visual: 'masterkey',
  },
  // ---------------- STOCK ----------------
  {
    id: 'stk_none', slot: 'stock', name: 'No Stock (Stripped)', price: 300, tier: 1,
    compat: RIFLES,
    desc: 'Sawn-off back end. Handles like a pistol, kicks like a mule — speed is the whole argument.',
    pros: ['Faster move, ADS and swap'],
    cons: ['Recoil +30%', 'Hip spread +15%'],
    mods: { moveSpeedMul: 1.05, adsTimeMul: 0.85, swapTimeMul: 0.8, recoilMul: 1.3, hipSpreadMul: 1.15 },
    visual: 'stock_none',
  },
  {
    id: 'stk_heavy', slot: 'stock', name: 'Precision Heavy Stock', price: 650, tier: 2,
    compat: RIFLES,
    desc: 'Skeletonised stock with a cheek riser. Anchors the rifle for follow-up shots — shouldering takes a beat longer.',
    pros: ['Recoil −18%', 'Steadier sway'],
    cons: ['Slower ADS and move'],
    mods: { recoilMul: 0.82, adsTimeMul: 1.1, moveSpeedMul: 0.98, swayMul: 0.8 },
    visual: 'stock_heavy',
  },
  {
    id: 'stk_folding', slot: 'stock', name: 'Side-Folding Stock', price: 500, tier: 2,
    compat: RIFLES,
    desc: 'Thin hinged tube stock. Swaps and shoulders in a blink — you pay for it in muzzle rise.',
    pros: ['Faster swap and ADS'],
    cons: ['Recoil +8%'],
    mods: { swapTimeMul: 0.75, adsTimeMul: 0.92, recoilMul: 1.08 },
    visual: 'stock_folding',
  },
  // ---------------- RAIL ----------------
  {
    id: 'rail_laser', slot: 'rail', name: 'Tactical Laser (Red)', price: 450, tier: 1,
    compat: ['m4a1', 'ak47', 'm1911', 'awm', 'mp7', 'scar_h', 'vector', 'spas12', 'deagle', 'm249'],
    desc: 'Visible red aiming laser. Tightens hip fire dramatically — and tells nearby hostiles exactly where the dot lives.',
    pros: ['Hip spread −25%', 'Visible aim dot'],
    cons: ['Easier to detect up close'],
    mods: { laser: true, hipSpreadMul: 0.75 },
    visual: 'laser_box',
  },
  {
    id: 'rail_flashlight', slot: 'rail', name: 'Weapon Light', price: 350, tier: 1,
    compat: ['m4a1', 'ak47', 'm1911', 'awm', 'mp7', 'scar_h', 'vector', 'spas12', 'deagle', 'm249'],
    desc: 'High-lumen white light. Owns dark interiors and whites-out anyone staring into it at close range.',
    pros: ['Illuminates interiors', 'Stuns lit hostiles ≤ 10 m'],
    cons: ['Gives away position'],
    mods: { flashlight: true },
    visual: 'light_box',
  },
  {
    id: 'rail_canted', slot: 'rail', name: '45° Canted Irons', price: 400, tier: 1,
    compat: ['m4a1', 'ak47', 'scar_h'],
    desc: 'Offset backup irons for magnified setups. Hold T while scoped to roll into fast 1× irons.',
    pros: ['1× backup sight (hold T)', 'Fast transition'],
    cons: ['Needs a magnified optic to matter'],
    mods: { canted: true },
    visual: 'canted_irons',
  },
  // ---------------- BARREL ----------------
  {
    id: 'brl_long', slot: 'barrel', name: 'Long Barrel', price: 750, tier: 2,
    compat: ['m4a1', 'ak47', 'scar_h', 'vector', 'm249', 'm1911', 'deagle'],
    desc: 'Extended barrel and handguard. More velocity, more reach — more rifle to swing through doorways.',
    pros: ['+15 m effective range', '+4% damage'],
    cons: ['Slower ADS and move'],
    mods: { falloffStartAdd: 15, damageMul: 1.04, adsTimeMul: 1.1, moveSpeedMul: 0.98 },
    visual: 'barrel_long',
  },
  {
    id: 'brl_short', slot: 'barrel', name: 'CQB Short Barrel', price: 700, tier: 2,
    compat: ['m4a1', 'ak47', 'scar_h', 'vector', 'm249', 'm1911', 'deagle'],
    desc: 'Chopped barrel for room work. Snaps around corners — and gives up reach and a little control.',
    pros: ['Faster ADS, swap and move'],
    cons: ['−10 m effective range', 'Wider hip spread'],
    mods: { adsTimeMul: 0.85, swapTimeMul: 0.85, moveSpeedMul: 1.03, falloffStartAdd: -10, hipSpreadMul: 1.1 },
    visual: 'barrel_short',
  },
  {
    id: 'brl_ported', slot: 'barrel', name: 'Ported Slide / Barrel', price: 550, tier: 2,
    compat: ['m1911', 'deagle'],
    desc: 'Gas ports cut into the top line. Vents climb upward and away — with a taller flash to match.',
    pros: ['Recoil −20%'],
    cons: ['Bigger flash'],
    mods: { recoilMul: 0.8, flashMul: 1.3 },
    visual: 'ported_slide',
  },
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
    .filter(a => a.slot === slot && a.compat.includes(weapon))
    .sort((a, b) => a.tier - b.tier || a.price - b.price);
}
