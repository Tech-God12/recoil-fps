import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { criticallyDampedSpringStep } = await import('../src/game/engine.ts');

function run(dt, seconds) {
  let x = 0;
  let v = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const step = criticallyDampedSpringStep(x, v, 10, 11, Math.min(dt, seconds - t));
    x = step[0]; v = step[1];
  }
  return { x, v };
}

test('spectator position spring is stable across 30 fps and 144 fps', () => {
  const thirty = run(1 / 30, 1);
  const high = run(1 / 144, 1);
  assert.ok(Math.abs(thirty.x - high.x) < 0.015, `position drift ${thirty.x} vs ${high.x}`);
  assert.ok(Math.abs(thirty.v - high.v) < 0.12, `velocity drift ${thirty.v} vs ${high.v}`);
  assert.ok(thirty.x > 9.98 && high.x > 9.98, 'critical damping reaches the target without visible lag');
});
