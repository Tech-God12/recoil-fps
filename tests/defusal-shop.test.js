import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../src/game/defusal/shop.ts');
const { WEAPON_CATALOG } = await import('../src/game/economy/catalog.ts');
const B = await import('../src/game/defusal/botplan.ts');
const { SHOP, GRENADE_LIMITS, freshInventory, canBuy, buy, afterDeath, grantMoney, itemPrice, shopItem, killRewardFor, inventoryValue, hitDamage, modScaleFor, BALLISTICS } = S;

test('the shop sells every armory gun at CS2 price bands, with class kill rewards', () => {
  const guns = SHOP.filter(i => i.weapon).map(i => i.weapon).sort();
  assert.deepEqual(guns, WEAPON_CATALOG.map(w => w.id).sort(), 'all ten armory weapons are buyable');
  for (const i of SHOP) if (i.weapon) assert.equal(i.kind === 'secondary', WEAPON_CATALOG.find(w => w.id === i.weapon).slot === 'secondary', `${i.id} lands in its armory slot`);
  assert.equal(shopItem('ak47').price, 2700);
  assert.equal(shopItem('m4a1').price, 3100);
  assert.equal(shopItem('awm').price, 4750);
  assert.equal(shopItem('kevlar').price, 650);
  assert.equal(shopItem('helmet').price, 1000);
  assert.equal(shopItem('kit').price, 400);
  assert.equal(killRewardFor('vector'), 600);
  assert.equal(killRewardFor('spas12'), 900);
  assert.equal(killRewardFor('awm'), 100);
  assert.equal(killRewardFor('ak47'), 300);
  assert.equal(killRewardFor('FRAG'), 300);
});

test('buy rules: money, side locks, duplicates, helmet upgrade and grenade limits', () => {
  let inv = freshInventory(800);
  assert.equal(inv.secondary, 'm1911');
  assert.deepEqual(canBuy(inv, 'ak47', 'attack'), { ok: false, reason: 'Need $2,700' });
  assert.deepEqual(canBuy(grantMoney(inv, 5000), 'kit', 'attack'), { ok: false, reason: 'Defenders only' });
  assert.deepEqual(canBuy(grantMoney(inv, 5000), 'ak47', 'defend'), { ok: false, reason: 'Attackers only' });
  assert.deepEqual(canBuy(grantMoney(inv, 5000), 'm4a1', 'attack'), { ok: false, reason: 'Defenders only' });
  assert.equal(canBuy(inv, 'm1911', 'attack').ok, false, 'already holding a 1911');
  inv = buy(inv, 'kevlar', 'defend').inv;
  assert.equal(inv.money, 150);
  assert.equal(inv.armor, 1);
  assert.equal(itemPrice(shopItem('helmet'), inv), 350, 'vest owners upgrade for $350');
  inv = grantMoney(inv, 10000);
  inv = buy(inv, 'helmet', 'defend').inv;
  assert.equal(inv.armor, 2);
  assert.equal(inv.money, 150 + 10000 - 350);
  assert.equal(canBuy(inv, 'kevlar', 'defend').ok, false, 'no downgrade purchase');
  for (const n of ['flash', 'flash', 'smoke', 'frag']) inv = buy(inv, n, 'defend').inv;
  assert.equal(inv.flashes, 2);
  assert.equal(canBuy(inv, 'flash', 'defend').ok, false, `max ${GRENADE_LIMITS.flash} flashes`);
  assert.deepEqual(canBuy(inv, 'frag', 'defend'), { ok: false, reason: 'Carrying max' });
  const bought = buy(inv, 'm4a1', 'defend');
  assert.ok(bought.ok);
  assert.equal(bought.replaced, null, 'no primary to replace yet');
  const again = buy(bought.inv, 'scar_h', 'defend');
  assert.equal(again.replaced, 'm4a1', 'replacing reports the gun that hits the floor');
  assert.equal(inv.primary, null, 'purchases are immutable');
});

test('death strips the kit but keeps the bank; money is capped at $16,000', () => {
  const rich = { ...freshInventory(9000), primary: 'awm', armor: 2, kit: true, frags: 1, flashes: 2, smokes: 1 };
  const dead = afterDeath(rich);
  assert.deepEqual(dead, { ...freshInventory(9000), money: 9000 });
  assert.equal(grantMoney(rich, 9000).money, 16000);
  assert.equal(inventoryValue(rich), 4750 + 1000 + 400 + 300 + 400 + 300);
});

test('ballistics: AK one-taps a helmet, the M416 does not, AWM kills to the body, legs take 75%', () => {
  assert.ok(hitDamage('ak47', 'head', 2) >= 100, 'AK headshot through a helmet is lethal');
  assert.ok(hitDamage('m4a1', 'head', 2) < 100, 'M416 needs two headshots on a helmet');
  assert.ok(hitDamage('m4a1', 'head', 1) >= 100, '…but one without a helmet');
  assert.ok(hitDamage('awm', 'torso', 0) >= 100, 'AWM body shot kills an unarmored target');
  assert.ok(hitDamage('deagle', 'head', 2) >= 100, 'Deagle one-taps helmets');
  assert.ok(hitDamage('m1911', 'head', 2) < 100, '1911 does not');
  assert.equal(hitDamage('ak47', 'limb', 2), BALLISTICS.ak47.damage * 0.75, 'armor never covers legs');
  assert.equal(hitDamage('ak47', 'torso', 1), BALLISTICS.ak47.damage * BALLISTICS.ak47.armorRatio);
  assert.equal(hitDamage('ak47', 'head', 1), BALLISTICS.ak47.damage * 4, 'a vest does not protect the head');
  const suppressed = modScaleFor('m4a1', 34 * 0.92);
  assert.ok(Math.abs(suppressed - 0.92) < 1e-9, 'armory damage mods carry into the CS table');
});

test('bot teams buy like CS teams: eco, force and full buys that never overspend', () => {
  assert.equal(B.teamBuyCall([800, 800, 800, 800, 800], 'attack', { pistolRound: true, lastOfHalf: false, mustWin: false }), 'pistol');
  assert.equal(B.teamBuyCall([1900, 2100, 1800, 2000, 1500], 'attack', { pistolRound: false, lastOfHalf: false, mustWin: false }), 'eco');
  assert.equal(B.teamBuyCall([1900, 2100, 1800, 2000, 1500], 'attack', { pistolRound: false, lastOfHalf: true, mustWin: false }), 'force');
  assert.equal(B.teamBuyCall([3000, 2900, 2800, 3100, 2700], 'defend', { pistolRound: false, lastOfHalf: false, mustWin: false }), 'force');
  assert.equal(B.teamBuyCall([4200, 5000, 3900, 4500, 4000], 'attack', { pistolRound: false, lastOfHalf: false, mustWin: false }), 'full');
  let seed = 7;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 200; i++) {
    const side = i % 2 ? 'attack' : 'defend';
    const call = ['pistol', 'eco', 'force', 'full'][i % 4];
    const role = B.ROLE_SHEET[i % 5];
    const money = call === 'pistol' ? 800 : 500 + Math.floor(rng() * 9000);
    const inv = B.planPurchases(freshInventory(money), side, call, role, rng);
    assert.ok(inv.money >= 0, 'never overspends');
    if (side === 'attack') { assert.ok(!inv.kit, 'attackers never carry kits'); assert.notEqual(inv.primary, 'm4a1'); }
    else assert.notEqual(inv.primary, 'ak47');
    if (call === 'full' && money >= 5000) {
      assert.ok(inv.primary, `full buy with $${money} fields a primary`);
      assert.ok(inv.armor >= 1, 'full buy includes armor');
    }
    if (call === 'full' && role === 'awper' && money >= 6000) assert.equal(inv.primary, 'awm');
  }
  const saved = { ...freshInventory(6000), primary: 'ak47' };
  assert.equal(B.planPurchases(saved, 'attack', 'full', 'rifler', rng).primary, 'ak47', 'a saved rifle is kept');
});

test('attack plans lean away from the site hit last round', () => {
  let seed = 99;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  let a = 0;
  for (let i = 0; i < 2000; i++) {
    const p = B.pickAttackPlan(rng, 'full', 'A');
    assert.ok(p.site === 'A' || p.site === 'B');
    assert.ok(['exec', 'rush', 'split', 'default', 'fake'].includes(p.style));
    if (p.site === 'A') a++;
  }
  assert.ok(a / 2000 < 0.48 && a / 2000 > 0.36, `A picked ${(a / 20).toFixed(1)}% after hitting A`);
});
