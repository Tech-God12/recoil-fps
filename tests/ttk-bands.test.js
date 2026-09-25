// Gunfeel headline: TTK consistency bands across the whole catalog.
// A rebalance that silently two-taps with an AR or three-taps with the sniper
// must fail here, not in a player's hands. All numbers mirror engine.ts:
// falloff past falloffStart, the 74-damage TDM cap (bolt-actions exempt), and
// the armor reduction curves.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();
const { WEAPON_CATALOG } = await import('../src/game/economy/catalog.ts');
const tdm = await import('../src/game/tdm.ts');

const TDM_CAP = 74; // engine.ts: no weapon may two-tap the 150 HP TDM pool
const byId = Object.fromEntries(WEAPON_CATALOG.map(w => [w.id, w.base]));
const dmgNear = id => byId[id].damage;
const dmgFar = id => byId[id].damage * (byId[id].falloffMul ?? 0.85);
// TDM per-hit damage after the cap and (optionally) armor reduction.
const tdmHit = (id, { head = false, armor = 0 } = {}) => {
  const b = byId[id];
  const bolt = id === 'awm';
  let dmg = b.damage * (head ? b.headMul : 1);
  if (!bolt) dmg = Math.min(dmg, TDM_CAP);
  const table = head ? tdm.TDM_HEAD_REDUCTION : tdm.TDM_BODY_REDUCTION;
  return dmg * (1 - table[armor]);
};
const pool = armor => tdm.TDM_BASE_HP + armor * tdm.TDM_HP_PER_ARMOR;
const shotsFor = (dmg, hp) => Math.ceil(hp / dmg);
const ttkSec = (id, shots) => ((shots - 1) * 60) / byId[id].rpm;

test('catalog constants used by this file match the shipped TDM rules', () => {
  assert.equal(tdm.TDM_BASE_HP, 150);
  assert.equal(tdm.TDM_HP_PER_ARMOR, 20);
  assert.deepEqual([...tdm.TDM_BODY_REDUCTION], [0, 0.12, 0.22]);
});

test('mission TTK: every automatic/pistol body-kills in 2–5 shots, 0.10–0.45 s', () => {
  for (const w of WEAPON_CATALOG) {
    if (w.id === 'awm' || w.id === 'spas12') continue; // special-cased below
    const shots = shotsFor(dmgNear(w.id), 100);
    const ttk = ttkSec(w.id, shots);
    assert.ok(shots >= 2 && shots <= 5, `${w.id}: ${shots} body shots (100 HP)`);
    assert.ok(ttk >= 0.1 - 1e-9 && ttk <= 0.45, `${w.id}: body TTK ${ttk.toFixed(2)} s`);
  }
});

test('mission TTK: every headshot kills in 1–2 hits (or ≤0.15 s for bullet hoses)', () => {
  for (const w of WEAPON_CATALOG) {
    if (w.id === 'spas12') continue;
    const shots = shotsFor(dmgNear(w.id) * byId[w.id].headMul, 100);
    // The Vector needs 3 heads at 1100 RPM — 0.11 s, still the fastest head TTK
    // in the game. Rate trades against per-shot damage; the band pins the TTK.
    assert.ok(shots <= 2 || ttkSec(w.id, shots) <= 0.15, `${w.id}: ${shots} headshots (100 HP)`);
  }
});

test('AWM is a real sniper: one body shot at any mission range', () => {
  assert.equal(shotsFor(dmgNear('awm'), 100), 1);
  assert.equal(shotsFor(dmgFar('awm'), 100), 1); // 160 × 0.85 = 136 > 100
  assert.ok(byId.awm.rpm <= 60, 'the price is the fire rate, not the damage');
});

test('TDM TTK: bolt sniper one-taps unarmored, two-taps armor (cap exempt)', () => {
  assert.equal(shotsFor(tdmHit('awm'), pool(0)), 1);
  assert.equal(shotsFor(tdmHit('awm', { armor: 1 }), pool(1)), 2);
  assert.equal(shotsFor(tdmHit('awm', { armor: 2 }), pool(2)), 2);
  assert.equal(shotsFor(tdmHit('awm', { head: true, armor: 2 }), pool(2)), 1);
});

test('TDM TTK: no automatic two-taps; nothing needs more than 7 body shots', () => {
  for (const w of WEAPON_CATALOG) {
    if (w.id === 'awm' || w.id === 'spas12') continue;
    const shots = shotsFor(tdmHit(w.id), pool(0));
    assert.ok(shots >= 3 && shots <= 7, `${w.id}: ${shots} body shots (150 HP)`);
  }
});

test('SCAR no longer dominates the AK: same body-shot count up close', () => {
  assert.equal(shotsFor(dmgNear('scar_h'), 100), shotsFor(dmgNear('ak47'), 100));
  assert.equal(shotsFor(tdmHit('scar_h'), pool(0)), shotsFor(tdmHit('ak47'), pool(0)));
  // …but keeps its range identity: better falloff gate and multiplier.
  assert.ok(byId.scar_h.falloffStart > byId.ak47.falloffStart);
  assert.ok(byId.scar_h.falloffMul >= byId.ak47.falloffMul);
});

test('SPAS-12: one close pump kills, damage falls off to a two-pump past 12 m', () => {
  const spas = WEAPON_CATALOG.find(w => w.id === 'spas12');
  const close = spas.pellets * byId.spas12.damage;
  assert.ok(close >= 100, `close burst ${close} must one-pump 100 HP`);
  const far = close * byId.spas12.falloffMul;
  assert.ok(far >= 50 && far < 100, `far burst ${far} must two-pump, not tickle or delete`);
});

test('falloff never creates a damage cliff: at most +2 body shots at range', () => {
  for (const w of WEAPON_CATALOG) {
    if (w.id === 'spas12') continue; // shotguns are *supposed* to fall off a cliff
    const extra = shotsFor(dmgFar(w.id), 100) - shotsFor(dmgNear(w.id), 100);
    assert.ok(extra <= 2, `${w.id}: +${extra} shots at range`);
  }
});
