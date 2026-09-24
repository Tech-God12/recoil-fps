// Recoil FPS — Bomb Defusal bot economy + team strategy (PURE; rng injected).
// Teams buy together the way real CS teams do: pistol round, eco, force or full
// buy is called for the whole squad from its average bank, then each bot shops
// for its role. Attack plans and defensive setups are drawn here too.
import { buy, canBuy, type Inventory } from './shop';
import type { Side } from './rules';

export type BuyCall = 'pistol' | 'eco' | 'force' | 'full';
export type BotRole = 'entry' | 'rifler' | 'support' | 'awper' | 'lurker';
export type SiteId = 'A' | 'B';
export type AttackStyle = 'exec' | 'rush' | 'split' | 'default' | 'fake';
export interface AttackPlan { site: SiteId; style: AttackStyle }

/** Average bank a side needs before it commits to rifles + armor. */
export const FULL_BUY_THRESHOLD: Record<Side, number> = { attack: 3700, defend: 4100 };

export function teamBuyCall(moneys: number[], side: Side, o: { pistolRound: boolean; lastOfHalf: boolean; mustWin: boolean }): BuyCall {
  if (o.pistolRound) return 'pistol';
  const avg = moneys.length ? moneys.reduce((a, b) => a + b, 0) / moneys.length : 0;
  if (avg >= FULL_BUY_THRESHOLD[side]) return 'full';
  if (o.lastOfHalf || o.mustWin) return 'force';
  if (avg >= 2600) return 'force';
  return 'eco';
}

/** Buy in order, silently skipping anything unaffordable. */
function shop(inv: Inventory, side: Side, ids: string[]): Inventory {
  let cur = inv;
  for (const id of ids) {
    const r = buy(cur, id, side);
    if (r.ok) cur = r.inv;
  }
  return cur;
}
const pick = <T,>(rng: () => number, table: [T, number][]): T => {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of table) { r -= w; if (r <= 0) return v; }
  return table[table.length - 1][0];
};

/**
 * One bot's shopping trip. Keeps saved weapons (a surviving rifle is never
 * downgraded) and tops up armor and utility around it.
 */
export function planPurchases(inv: Inventory, side: Side, call: BuyCall, role: BotRole, rng: () => number): Inventory {
  let cur = inv;
  const nades = (list: string[]) => { cur = shop(cur, side, list); };
  const armorUp = () => {
    if (cur.armor === 0 && canBuy(cur, 'helmet', side).ok && cur.money - 1000 >= 0) cur = shop(cur, side, ['helmet']);
    else if (cur.armor === 0) cur = shop(cur, side, ['kevlar']);
    else if (cur.armor === 1) cur = shop(cur, side, ['helmet']);
  };
  switch (call) {
    case 'pistol': {
      const plan = pick<string[]>(rng, side === 'defend'
        ? [[['kevlar'], 5], [['kit', 'flash'], 3], [['deagle'], 2], [['smoke', 'flash', 'flash'], 2]]
        : [[['kevlar'], 5], [['deagle'], 3], [['frag', 'flash', 'smoke'], 2], [['flash', 'flash', 'frag'], 2]]);
      cur = shop(cur, side, plan);
      break;
    }
    case 'eco': {
      // Save — maybe one cheap upgrade so the round is not a guaranteed loss.
      if (cur.money >= 1900 && rng() < 0.35) cur = shop(cur, side, [rng() < 0.6 ? 'deagle' : 'flash']);
      break;
    }
    case 'force': {
      if (!cur.primary) {
        const gun = pick<string>(rng, [['vector', 4], ['spas12', 2], ['mp7', 2], [side === 'attack' ? 'ak47' : 'm4a1', cur.money >= 3350 ? 3 : 0]]);
        cur = shop(cur, side, [gun]);
        if (!cur.primary && cur.secondary === 'm1911') cur = shop(cur, side, ['deagle']);
      }
      armorUp();
      if (side === 'defend' && rng() < 0.4) cur = shop(cur, side, ['kit']);
      nades(rng() < 0.5 ? ['flash', 'smoke'] : ['frag']);
      break;
    }
    case 'full': {
      if (!cur.primary || cur.primary === 'vector' || cur.primary === 'spas12') {
        let gun: string;
        if (role === 'awper' && cur.money >= 4750 + 650) gun = 'awm';
        else if (side === 'attack') gun = pick(rng, [['ak47', 8], ['scar_h', 2], ['m249', cur.money > 7500 ? 0.4 : 0]]);
        else gun = pick(rng, [['m4a1', 7], ['scar_h', 2]]);
        const r = buy(cur, gun, side);
        if (r.ok) cur = r.inv;
        else cur = shop(cur, side, [side === 'attack' ? 'ak47' : 'm4a1', 'vector']);
      }
      armorUp();
      if (side === 'defend' && (role === 'support' || rng() < 0.6)) cur = shop(cur, side, ['kit']);
      const utility = role === 'support' ? ['smoke', 'flash', 'frag', 'flash']
        : role === 'entry' ? ['flash', 'flash', 'frag', 'smoke']
          : role === 'awper' ? ['flash', 'smoke']
            : ['smoke', 'frag', 'flash'];
      nades(utility);
      break;
    }
  }
  return cur;
}

export function pickAttackPlan(rng: () => number, call: BuyCall, lastSite?: SiteId): AttackPlan {
  // Slight bias away from last round's site — readable teams get punished.
  const aWeight = lastSite === 'A' ? 0.42 : lastSite === 'B' ? 0.58 : 0.5;
  const site: SiteId = rng() < aWeight ? 'A' : 'B';
  const style = pick<AttackStyle>(rng, call === 'eco' || call === 'pistol'
    ? [['rush', 4], ['exec', 3], ['split', 2], ['default', 1], ['fake', 0.5]]
    : [['exec', 4], ['split', 3], ['default', 2.5], ['rush', 1], ['fake', 1]]);
  return { site, style };
}

/** Defender posts: default 2-1-2, with occasional stacks when the team reads a hit. */
export type DefenseSetup = 'standard' | 'stackA' | 'stackB' | 'aggressive';
export function pickDefenseSetup(rng: () => number, lastLossSite?: SiteId): DefenseSetup {
  return pick<DefenseSetup>(rng, [
    ['standard', 6],
    ['stackA', lastLossSite === 'A' ? 2.5 : 1],
    ['stackB', lastLossSite === 'B' ? 2.5 : 1],
    ['aggressive', 1],
  ]);
}

/** Five-man role sheet; the AWPer only exists once per team. */
export const ROLE_SHEET: BotRole[] = ['entry', 'rifler', 'awper', 'support', 'lurker'];
