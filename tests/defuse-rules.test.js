import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const rules = await import('../src/game/defuse/rules.ts');
const sites = await import('../src/game/defuse/sites.ts');
const {
  DEFUSE, BUY_ITEMS, MATCH_FORMATS, formatById, freshKit, canBuy, applyBuy, effectivePrice, buyItem,
  killReward, lossBonus, roundIncome, clampMoney, DefuseMatch, beepInterval, reasonLabel, LOSS_BONUS,
} = rules;
const { SITES, siteAt, ATTACK_SPAWNS, DEFEND_SPAWNS } = sites;

const kitWith = patch => ({ ...freshKit(), ...patch });

test('fresh kit is a pistol-round kit: $800, 1911, nothing else', () => {
  const k = freshKit();
  assert.deepEqual(k, { money: 800, primary: null, secondary: 'm1911', armor: 0, kit: false, frags: 0, flashes: 0 });
  assert.equal(freshKit(10000).money, 10000);
});

test('every buyable gun maps to a catalog weapon slot and a positive kill reward', () => {
  for (const item of BUY_ITEMS.filter(i => i.slot)) {
    assert.ok(item.killReward > 0, item.id);
    assert.ok(item.price > 0, item.id);
  }
  assert.equal(new Set(BUY_ITEMS.map(i => i.id)).size, BUY_ITEMS.length, 'ids are unique');
});

test('defuse kit is defenders-only', () => {
  const rich = kitWith({ money: 5000 });
  assert.equal(canBuy('kit', rich, 'attack').ok, false);
  assert.equal(canBuy('kit', rich, 'defend').ok, true);
});

test('helmet on top of kevlar only costs the difference', () => {
  const helmet = buyItem('helmet');
  assert.equal(effectivePrice(helmet, kitWith({ armor: 0 })), 1000);
  assert.equal(effectivePrice(helmet, kitWith({ armor: 1 })), 350);
  const { kit, check } = applyBuy('helmet', kitWith({ money: 400, armor: 1 }), 'attack');
  assert.equal(check.ok, true);
  assert.equal(kit.armor, 2);
  assert.equal(kit.money, 50);
});

test('buy guards: money, duplicates, grenade caps, unknown ids', () => {
  assert.deepEqual(canBuy('ak47', kitWith({ money: 2699 }), 'attack'), { ok: false, reason: 'Not enough money' });
  assert.equal(canBuy('m1911', kitWith({ money: 5000 }), 'attack').ok, false, 'already equipped');
  let kit = kitWith({ money: 5000 });
  kit = applyBuy('frag', kit, 'attack').kit;
  assert.equal(canBuy('frag', kit, 'attack').ok, false, 'frag cap is 1');
  kit = applyBuy('flash', applyBuy('flash', kit, 'attack').kit, 'attack').kit;
  assert.equal(kit.flashes, 2);
  assert.equal(canBuy('flash', kit, 'attack').ok, false, 'flash cap is 2');
  assert.equal(canBuy('rocket', kit, 'attack').ok, false);
});

test('buying a primary replaces it and charges the full price', () => {
  let kit = kitWith({ money: 6000 });
  kit = applyBuy('ak47', kit, 'attack').kit;
  assert.equal(kit.primary, 'ak47');
  assert.equal(kit.money, 3300);
  kit = applyBuy('vector', kit, 'attack').kit;
  assert.equal(kit.primary, 'vector');
  assert.equal(kit.money, 1800);
});

test('kill rewards follow the CS ladder (AWP-class low, SMG/shotgun high, frag 300)', () => {
  assert.equal(killReward('awm'), 100);
  assert.equal(killReward('vector'), 600);
  assert.equal(killReward('spas12'), 900);
  assert.equal(killReward('AK-47'), 300, 'display names resolve too');
  assert.equal(killReward('FRAG'), 300);
  assert.equal(killReward('???'), 300);
});

test('loss bonus climbs 1400 → 3400 and caps', () => {
  assert.equal(lossBonus(0), 1400);
  assert.equal(lossBonus(1), 1400);
  assert.equal(lossBonus(2), 1900);
  assert.equal(lossBonus(5), 3400);
  assert.equal(lossBonus(12), 3400);
  assert.equal(LOSS_BONUS.length, 5);
});

test('round income: win rewards, plant bonus, and the time-expiry save tax', () => {
  assert.equal(roundIncome({ won: true, reason: 'bomb', side: 'attack', lossStreak: 0, planted: true, survived: true }), 3500);
  assert.equal(roundIncome({ won: true, reason: 'elimination', side: 'defend', lossStreak: 0, planted: false, survived: true }), 3250);
  // Attackers who planted but lost still bank the team plant bonus.
  assert.equal(roundIncome({ won: false, reason: 'defuse', side: 'attack', lossStreak: 1, planted: true, survived: false }), 1400 + 800);
  // Attackers who hid instead of playing the objective get nothing.
  assert.equal(roundIncome({ won: false, reason: 'time', side: 'attack', lossStreak: 3, planted: false, survived: true }), 0);
  assert.equal(roundIncome({ won: false, reason: 'time', side: 'attack', lossStreak: 3, planted: false, survived: false }), 2400);
  assert.equal(clampMoney(99999), DEFUSE.maxMoney);
  assert.equal(clampMoney(-5), 0);
});

test('formats: short FT5/8, competitive FT7/12, unknown falls back to short', () => {
  assert.deepEqual(MATCH_FORMATS.map(f => [f.id, f.winTarget, f.maxRounds, f.half]), [['short', 5, 8, 4], ['standard', 7, 12, 6]]);
  assert.equal(formatById('nope').id, 'short');
});

test('sides swap at halftime and the loss ladder resets', () => {
  const m = new DefuseMatch(formatById('short'), 'attack');
  assert.equal(m.sideOf('alpha'), 'attack');
  assert.equal(m.teamOn('defend'), 'bravo');
  assert.equal(m.pistolRound, true);
  let out;
  for (let r = 1; r <= 4; r++) out = m.recordRound('bravo', 'elimination', 'X');
  assert.equal(out.halftime, true);
  assert.deepEqual(m.lossStreak, { alpha: 0, bravo: 0 });
  assert.equal(m.round, 5);
  assert.equal(m.sideOf('alpha'), 'defend');
  assert.equal(m.pistolRound, true, 'second-half pistol round');
  assert.equal(m.history[0].alphaSide, 'attack');
});

test('winning knocks one notch off your loss ladder; losing adds one (capped)', () => {
  const m = new DefuseMatch(formatById('standard'), 'defend');
  m.recordRound('bravo', 'bomb', 'X');
  m.recordRound('bravo', 'bomb', 'X');
  assert.equal(m.lossStreak.alpha, 2);
  m.recordRound('alpha', 'defuse', 'X');
  assert.equal(m.lossStreak.alpha, 1);
  assert.equal(m.lossStreak.bravo, 1);
});

test('match point, victory at the win target, winner()', () => {
  const m = new DefuseMatch(formatById('short'), 'attack');
  for (let i = 0; i < 4; i++) m.recordRound('alpha', 'bomb', 'X');
  assert.equal(m.matchPointFor(), 'alpha');
  const out = m.recordRound('alpha', 'elimination', 'X');
  assert.equal(out.over, true);
  assert.equal(m.isOver(), true);
  assert.equal(m.winner(), 'alpha');
});

test('a regulation tie goes to one sudden-death decider', () => {
  const m = new DefuseMatch(formatById('short'), 'attack');
  const seq = ['alpha', 'bravo', 'alpha', 'bravo', 'alpha', 'bravo', 'alpha'];
  for (const w of seq) assert.equal(m.recordRound(w, 'elimination', 'X').over, false);
  const eighth = m.recordRound('bravo', 'time', 'X');
  assert.equal(eighth.over, false);
  assert.equal(eighth.suddenDeath, true);
  assert.equal(m.suddenDeath, true);
  assert.equal(m.sideOf('alpha'), 'defend', 'decider keeps second-half sides');
  const decider = m.recordRound('alpha', 'defuse', 'X');
  assert.equal(decider.over, true);
  assert.equal(m.winner(), 'alpha');
});

test('bomb beeps accelerate as the fuse runs down', () => {
  let prev = Infinity;
  for (const t of [40, 25, 15, 8, 4, 1.5, 0.5]) {
    const b = beepInterval(t);
    assert.ok(b <= prev, `beep at ${t}s`);
    prev = b;
  }
  assert.equal(reasonLabel('bomb'), 'Target destroyed');
});

test('sites: centers and plant spots register as their own site; spawns are outside both', () => {
  for (const [id, site] of Object.entries(SITES)) {
    assert.equal(siteAt(site.center[0], site.center[1]), id, `${id} center`);
    for (const p of site.plantSpots) assert.equal(siteAt(p[0], p[1]), id, `${id} plant spot ${p}`);
  }
  for (const p of [...ATTACK_SPAWNS, ...DEFEND_SPAWNS]) assert.equal(siteAt(p[0], p[1]), null, `spawn ${p}`);
});
