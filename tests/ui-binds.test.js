// The settings bind reference must cover every real binding, and the menu cursor
// must reach every entry — both regressed silently before (audit U4/U5).
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { BINDS, menuStep } = await import('../src/ui/bindings.ts');
const { isLowAmmo, shouldShowReload } = await import('../src/ui/hud-math.ts');

test('bind reference covers every engine binding', () => {
  const text = BINDS.map(([a, k]) => `${a}=${k}`).join(' ');
  for (const action of [
    'Move', 'Sprint', 'Crouch', 'Slide', 'Jump / Vault', 'Fire', 'Aim', 'Reload',
    'Lean left', 'Lean right', 'Frag grenade', 'Flashbang', 'Primary / Sidearm',
    'Last weapon', 'Plant / Detonate', 'Underbarrel shotgun', 'Scope zoom',
    'Canted sight', 'Field kit', 'Tactical map', 'Scoreboard', 'Pause',
  ]) {
    assert.ok(BINDS.some(([a]) => a === action), `missing action: ${action}`);
  }
  assert.match(text, /Tap Q/, 'Q-tap vs Q-hold must be spelled out');
  assert.match(text, /Field kit=Z/, 'the kit hotkey must be discoverable');
  assert.match(text, /Tab/, 'scoreboard hold must be discoverable');
  assert.match(text, /Tactical map=M/, 'the full tactical map must be discoverable');
});

test('menu cursor wraps across all five entries', () => {
  assert.equal(menuStep(0, -1, 5), 4, 'up from the top reaches SETTINGS');
  assert.equal(menuStep(4, 1, 5), 0, 'down from the bottom wraps home');
  assert.equal(menuStep(2, 1, 5), 3);
  assert.equal(menuStep(2, -1, 5), 1);
});

test('low-ammo hint is relative: full AWM stays quiet, dry guns shout', () => {
  assert.equal(shouldShowReload(5, 5, false), false, 'full AWM must not blink RELOAD');
  assert.equal(shouldShowReload(30, 30, false), false);
  assert.equal(shouldShowReload(7, 30, false), true, '7/30 is below a quarter');
  assert.equal(shouldShowReload(0, 30, false), true);
  assert.equal(shouldShowReload(0, 30, true), false, 'already reloading: no nag');
  assert.equal(isLowAmmo(5, 5), false);
  assert.equal(isLowAmmo(1, 5), true);
  assert.equal(isLowAmmo(0, 0), false, 'degenerate mag size never warns');
});
