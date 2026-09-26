import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../src/game/engine.ts');

/** Invoke the private TypeScript method as a deliberately tiny engine-shaped
 * object. This locks the accessibility promise independently of WebGL. */
function quickSwapContext({ reserve = 0, mag = 0, infinite = false } = {}) {
  return {
    autoSwapEmptyEnabled: true, reloadT: -1, switchT: -1, cur: 0,
    mags: [mag, 8], reserves: [reserve, 0], INFINITE_AMMO: infinite,
    weapons: [{ magSize: 20 }, { magSize: 30 }], switchedTo: null,
    switchWeapon(i) { this.switchedTo = i; },
  };
}

test('empty-weapon quick swap never steals an available reload', () => {
  for (const state of [{ reserve: 1 }, { infinite: true }, { mag: 1 }]) {
    const ctx = quickSwapContext(state);
    Engine.prototype.quickSwapIfEmpty.call(ctx);
    assert.equal(ctx.switchedTo, null, `should not swap for ${JSON.stringify(state)}`);
  }
});

test('empty-weapon quick swap selects a usable alternate only when current weapon is unreloadable', () => {
  const ctx = quickSwapContext();
  Engine.prototype.quickSwapIfEmpty.call(ctx);
  assert.equal(ctx.switchedTo, 1);
});
