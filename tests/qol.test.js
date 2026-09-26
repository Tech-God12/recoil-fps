// Quality-of-life features are the easiest thing in a game to ship subtly
// broken, because none of them announce themselves when they misfire: a reload
// cancel that hands you ammunition you never loaded, an auto-reload that eats
// your trigger pull, a setting that silently fails to persist. These pin the
// behaviour that actually matters.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { DEFAULT_SETTINGS, sanitizeSettings, Engine } = await import('../src/game/engine.ts');

test('every QoL setting has a default and survives a round trip through storage', () => {
  for (const key of ['autoReload', 'holdCrouch', 'autoSprint', 'damageNumbers', 'colorblind']) {
    assert.ok(key in DEFAULT_SETTINGS, `${key} has no default`);
  }
  // Sensible out-of-the-box posture: the helpful ones on, the opinionated ones off.
  assert.equal(DEFAULT_SETTINGS.autoReload, true);
  assert.equal(DEFAULT_SETTINGS.damageNumbers, true);
  assert.equal(DEFAULT_SETTINGS.autoSprint, false, 'auto-sprint changes movement feel; opt in');
  assert.equal(DEFAULT_SETTINGS.holdCrouch, false, 'stance toggle is the existing behaviour; opt in');
  assert.equal(DEFAULT_SETTINGS.colorblind, 'off');

  const stored = JSON.stringify({
    ...DEFAULT_SETTINGS, autoReload: false, holdCrouch: true, autoSprint: true,
    damageNumbers: false, colorblind: 'deuteranopia',
  });
  const back = sanitizeSettings(stored);
  assert.equal(back.autoReload, false);
  assert.equal(back.holdCrouch, true);
  assert.equal(back.autoSprint, true);
  assert.equal(back.damageNumbers, false);
  assert.equal(back.colorblind, 'deuteranopia');
});

test('a corrupt colour-blind value falls back instead of poisoning the body class', () => {
  const back = sanitizeSettings(JSON.stringify({ ...DEFAULT_SETTINGS, colorblind: 'cb-bad"><script>' }));
  assert.equal(back.colorblind, 'off');
});

/** Minimal stand-in with just the state the reload-cancel logic reads. */
function reloadContext(stage, { pump = false, mag = 0 } = {}) {
  return {
    reloadT: 1,
    currentReloadStage: stage,
    cur: 0,
    mags: [mag],
    reloadStages: [],
    autoReloadPending: false,
    def: () => ({ pumpShotgun: pump }),
  };
}

test('a reload can only be cancelled once the magazine is actually seated', () => {
  const canCancel = Engine.prototype.canCancelReload;
  // Before the mag is in, cancelling would hand over ammunition the animation
  // never delivered — the classic reload-cancel exploit.
  assert.equal(canCancel.call(reloadContext('idle')), false);
  assert.equal(canCancel.call(reloadContext('magOut')), false);
  assert.equal(canCancel.call(reloadContext('magIn')), true);
  assert.equal(canCancel.call(reloadContext('ready')), true);
  // Not reloading at all is not cancellable.
  const idle = reloadContext('ready'); idle.reloadT = -1;
  assert.equal(canCancel.call(idle), false);
});

test('tube-fed shotguns can cancel as soon as one shell is aboard', () => {
  const canCancel = Engine.prototype.canCancelReload;
  assert.equal(canCancel.call(reloadContext('magOut', { pump: true, mag: 0 })), false, 'empty tube has nothing to fire');
  assert.equal(canCancel.call(reloadContext('magOut', { pump: true, mag: 1 })), true, 'one shell is a usable shotgun');
});

test('cancelling a reload still runs the stages it skipped, so ammo stays honest', () => {
  const ran = [];
  const ctx = reloadContext('magIn');
  ctx.reloadT = 1.0;
  ctx.reloadStages = [
    { t: 0.5, fn: () => ran.push('already-fired') },  // behind the playhead
    { t: 1.6, fn: () => ran.push('ready') },
    { t: 2.0, fn: () => ran.push('finish') },
  ];
  Engine.prototype.finishReloadEarly.call(ctx);
  assert.deepEqual(ran, ['ready', 'finish'], 'pending stages must still fire exactly once');
  assert.equal(ctx.reloadT, -1, 'reload must actually end');
  assert.deepEqual(ctx.reloadStages, [], 'no stage may fire again later');
  assert.equal(ctx.currentReloadStage, 'ready');
  assert.equal(ctx.autoReloadPending, false, 'a cancelled reload must not queue another one');
});

test('cancelling twice is harmless', () => {
  const ctx = reloadContext('ready');
  let calls = 0;
  ctx.reloadStages = [{ t: 9, fn: () => calls++ }];
  Engine.prototype.finishReloadEarly.call(ctx);
  Engine.prototype.finishReloadEarly.call(ctx);
  assert.equal(calls, 1, 'a double cancel double-loaded the gun');
});
