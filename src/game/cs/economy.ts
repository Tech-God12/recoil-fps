// Recoil FPS — DUSTYARD TACTICAL (CS2 competitive): the economy.
// PURE DATA (no three.js, no React) so the buy menu, the engine, the bots and the
// Node tests all read exactly the same numbers.
//
// Contract (spec §3):
//   · everyone starts round 1 with $800, wallet clamps to [0, $16000]
//   · kills pay by weapon class, round wins pay $3250, bomb detonation pays $3500
//   · the loss bonus climbs $1400 → $3400 with consecutive losses, resets on a win
//   · plants pay the planter $800, defuses pay the defuser $300
//   · money persists across rounds; dying costs you your guns, never your wallet

export type TeamId = 'alpha' | 'bravo';          // alpha = CT (defenders), bravo = T (attackers)
export type CSWeaponClass = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'heavy' | 'knife' | 'grenade';

/* ===================== MATCH SHAPE (MR8) ===================== */

export const CS_WIN_ROUNDS = 9;                  // first to 9 wins
export const CS_MAX_ROUNDS = 15;                 // MR8: 8 rounds per half, 2 × 7 + decider
export const CS_HALF_ROUNDS = 8;                 // sides/spawns swap after round 8
export const CS_FREEZE_SECONDS = 20;             // freeze time: buy window, no movement
export const CS_ROUND_SECONDS = 100;             // 1:40 to plant
export const CS_BOMB_SECONDS = 40;               // C4 fuse once planted
export const CS_ROUND_END_SECONDS = 6;           // slow-mo scoreboard beat between rounds
export const CS_PLANT_SECONDS = 3.5;             // hold X to plant
export const CS_DEFUSE_SECONDS = 10;             // hold X, bare hands
export const CS_DEFUSE_KIT_SECONDS = 5;          // hold X with defuse kit
export const CS_PICKUP_SECONDS = 0.5;            // hold X on the dropped C4
export const CS_START_MONEY = 800;
export const CS_MAX_MONEY = 16000;
export const CS_KNIFE_SPEED_MUL = 1.15;          // knife out = fastest legs
export const CS_KNIFE_DAMAGE = 40;
export const CS_KNIFE_BACKSTAB = 150;
export const CS_TEAM_SIZE = 5;

/* ===================== REWARDS ===================== */

/** Kill reward by weapon class of the KILLER's gun (CS2's kill award table). */
export const CS_KILL_REWARDS: Record<CSWeaponClass, number> = {
  pistol: 300, smg: 600, rifle: 300, sniper: 100, heavy: 300, knife: 1500, grenade: 300,
};

export const CS_ROUND_WIN = 3250;                // elimination / defuse / timeout win
export const CS_BOMB_WIN = 3500;                 // extra-tidy win: the bomb did it
export const CS_PLANT_BONUS = 800;               // to the planter, win or lose
export const CS_DEFUSE_BONUS = 300;              // to the defuser
/** Loss bonus ladder: index = consecutive losses BEFORE this one (capped). */
export const CS_LOSS_LADDER = [1400, 1900, 2400, 2900, 3400] as const;

export function lossBonus(consecutiveLosses: number): number {
  return CS_LOSS_LADDER[Math.min(Math.max(0, consecutiveLosses), CS_LOSS_LADDER.length - 1)];
}

export function killReward(weaponClass: CSWeaponClass): number {
  return CS_KILL_REWARDS[weaponClass] ?? CS_KILL_REWARDS.rifle;
}

export function clampMoney(money: number): number {
  return Math.max(0, Math.min(CS_MAX_MONEY, Math.round(money)));
}

/** Round-end payout for a team: winners take the round rate, losers climb the ladder. */
export function roundPayout(won: boolean, consecutiveLosses: number, bombWin: boolean): number {
  if (won) return bombWin ? CS_BOMB_WIN : CS_ROUND_WIN;
  return lossBonus(consecutiveLosses);
}

/* ===================== TEAM ECO READ ===================== */

export type EcoState = 'ECO' | 'FORCE' | 'FULL BUY';

/** Team-average wallet → the HUD banner. <$2k save, <$4k force, else full buy. */
export function ecoFor(averageMoney: number): EcoState {
  if (averageMoney < 2000) return 'ECO';
  if (averageMoney < 4000) return 'FORCE';
  return 'FULL BUY';
}

/* ===================== BUY CATALOG ===================== */

/** Armory weapon ids — the CS guns are the exact same models the campaign uses. */
export type CSWeaponId = 'm1911' | 'deagle' | 'mp7' | 'vector' | 'ak47' | 'm4a1' | 'scar_h' | 'awm' | 'm249' | 'spas12';

export interface CSGunEntry {
  id: CSWeaponId;
  name: string;
  cls: CSWeaponClass;
  slot: 'primary' | 'secondary';
  price: number;
  /** Team-locked guns (AK for T, M4 for CT) show a side tag; others are shared. */
  team?: TeamId;
  /** Card stats — display only, the armory catalog owns the real ballistics. */
  dmg: number; rpm: number; mag: number; armorPen: number;
}

export const CS_GUNS: readonly CSGunEntry[] = [
  { id: 'm1911', name: 'M1911', cls: 'pistol', slot: 'secondary', price: 300, dmg: 42, rpm: 420, mag: 8, armorPen: 42 },
  { id: 'deagle', name: 'Desert Eagle', cls: 'pistol', slot: 'secondary', price: 700, dmg: 63, rpm: 240, mag: 7, armorPen: 93 },
  { id: 'mp7', name: 'MP7', cls: 'smg', slot: 'primary', price: 1200, dmg: 24, rpm: 900, mag: 40, armorPen: 62 },
  { id: 'vector', name: 'Vector', cls: 'smg', slot: 'primary', price: 1200, dmg: 26, rpm: 1100, mag: 33, armorPen: 58 },
  { id: 'ak47', name: 'AK-47', cls: 'rifle', slot: 'primary', price: 2700, team: 'bravo', dmg: 46, rpm: 600, mag: 30, armorPen: 77 },
  { id: 'm4a1', name: 'M4A1', cls: 'rifle', slot: 'primary', price: 3100, team: 'alpha', dmg: 34, rpm: 780, mag: 30, armorPen: 70 },
  { id: 'scar_h', name: 'SCAR-H', cls: 'rifle', slot: 'primary', price: 3000, dmg: 52, rpm: 520, mag: 20, armorPen: 81 },
  { id: 'awm', name: 'AWM', cls: 'sniper', slot: 'primary', price: 4750, dmg: 115, rpm: 48, mag: 5, armorPen: 97 },
  { id: 'm249', name: 'M249', cls: 'heavy', slot: 'primary', price: 5200, dmg: 32, rpm: 750, mag: 100, armorPen: 67 },
  { id: 'spas12', name: 'SPAS-12', cls: 'heavy', slot: 'primary', price: 1300, dmg: 13, rpm: 260, mag: 8, armorPen: 80 },
];

export function gunById(id: CSWeaponId): CSGunEntry {
  return CS_GUNS.find(g => g.id === id) ?? CS_GUNS[0];
}

export interface CSGrenadeEntry { id: 'frag' | 'flash' | 'smoke' | 'molotov'; name: string; price: number; team?: TeamId; max: number }
/** Molotov is the T budget fire; incendiary is its CT twin — one mechanic, two names. */
export const CS_GRENADES: readonly CSGrenadeEntry[] = [
  { id: 'frag', name: 'Frag Grenade', price: 300, max: 3 },
  { id: 'flash', name: 'Flashbang', price: 200, max: 2 },
  { id: 'smoke', name: 'Smoke Grenade', price: 300, max: 2 },
  { id: 'molotov', name: 'Molotov', price: 400, team: 'bravo', max: 1 },
  { id: 'molotov', name: 'Incendiary', price: 600, team: 'alpha', max: 1 },
];

export interface CSGearEntry { id: 'kevlar' | 'helmet' | 'kit'; name: string; price: number; team?: TeamId; blurb: string }
export const CS_GEAR: readonly CSGearEntry[] = [
  { id: 'kevlar', name: 'Kevlar Vest', price: 650, blurb: 'Light plating · 180 HP pool · head −15%' },
  { id: 'helmet', name: 'Kevlar + Helmet', price: 1000, blurb: 'Heavy plating · 210 HP pool · head −25%' },
  { id: 'kit', name: 'Defuse Kit', price: 400, team: 'alpha', blurb: 'Halves defuse time: 10s → 5s' },
];

export const KEVLAR_PRICE = 650;
export const HELMET_PRICE = 1000;
export const KIT_PRICE = 400;

/* ===================== LOADOUT CART ===================== */

/** What a side carries into a round. Weapons are armory ids; armor is the TDM tier. */
export interface CSLoadout {
  primary: CSWeaponId | null;
  secondary: CSWeaponId | null;
  armor: 0 | 1 | 2;              // 0 bare (150), 1 kevlar (180), 2 kevlar+helmet (210)
  kit: boolean;                  // defuse kit — CT only
  frag: number; flash: number; smoke: number; molotov: number;
}

export const DEFAULT_CS_LOADOUT: CSLoadout = {
  primary: null, secondary: 'm1911', armor: 0, kit: false,
  frag: 0, flash: 0, smoke: 0, molotov: 0,
};

export function loadoutCost(cart: CSLoadout, team: TeamId, startFrom: CSLoadout = DEFAULT_CS_LOADOUT): number {
  let total = 0;
  if (cart.primary && cart.primary !== startFrom.primary) total += gunById(cart.primary).price;
  if (cart.secondary && cart.secondary !== startFrom.secondary) total += gunById(cart.secondary).price;
  if (cart.armor > startFrom.armor) total += cart.armor === 2 ? HELMET_PRICE : KEVLAR_PRICE;
  if (cart.kit && !startFrom.kit && team === 'alpha') total += KIT_PRICE;
  for (const g of CS_GRENADES) {
    const owned = startFrom[g.id];
    const want = Math.min(cart[g.id], g.max);
    if (want > owned) total += (want - owned) * grenadePrice(g.id, team);
  }
  return total;
}

export function grenadePrice(id: 'frag' | 'flash' | 'smoke' | 'molotov', team: TeamId): number {
  const entry = CS_GRENADES.find(g => g.id === id && (!g.team || g.team === team));
  return entry?.price ?? (id === 'molotov' ? (team === 'alpha' ? 600 : 400) : 0);
}

/* ===================== BOT BUY BRAIN ===================== */

export interface BotBuy {
  primary: CSWeaponId | null;
  secondary: CSWeaponId;
  armor: 0 | 1 | 2;
  kit: boolean;
  frag: number; flash: number; smoke: number; molotov: number;
  spent: number;
}

/**
 * The spec's bot economy (§4): full buy at $4k, SMG+vest at $2k, pistol plus a
 * maybe-vest below that, and a hard save under $1k. Priorities spend down the
 * list so a windfall round upgrades sensibly instead of skipping the rifle.
 */
export function botBuyPlan(money: number, team: TeamId): BotBuy {
  const plan: BotBuy = {
    primary: null, secondary: team === 'alpha' ? 'm1911' : 'm1911', armor: 0, kit: false,
    frag: 0, flash: 0, smoke: 0, molotov: 0, spent: 0,
  };
  let left = money;
  const spend = (amount: number) => { left -= amount; plan.spent += amount; };
  const rifle: CSWeaponId = team === 'bravo' ? 'ak47' : 'm4a1';
  const smg: CSWeaponId = 'mp7';

  if (left >= 4000) {
    plan.primary = rifle; spend(gunById(rifle).price);
  } else if (left >= 2000) {
    plan.primary = smg; spend(gunById(smg).price);
  }
  // Armor before toys: a vest turns one rifle burst into three.
  if (left >= HELMET_PRICE && plan.primary) { plan.armor = 2; spend(HELMET_PRICE); }
  else if (left >= KEVLAR_PRICE && (plan.primary || left >= KEVLAR_PRICE + 400)) { plan.armor = 1; spend(KEVLAR_PRICE); }
  // Utility for anyone who can still eat this month.
  if (plan.armor > 0 || plan.primary) {
    if (left >= CS_KILL_REWARDS.grenade) { plan.frag = 1; spend(300); }
    if (left >= 200) { plan.flash = 1; spend(200); }
    if (left >= 300 && plan.primary) { plan.smoke = 1; spend(300); }
    if (team === 'bravo' && left >= 400 && plan.primary) { plan.molotov = 1; spend(400); }
  }
  // Defuse kits only for CTs who are already kitted — retake money is not free.
  if (team === 'alpha' && plan.primary && plan.armor > 0 && left >= KIT_PRICE) { plan.kit = true; spend(KIT_PRICE); }
  return plan;
}
