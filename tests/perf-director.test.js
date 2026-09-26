// The quality director is the one system that is allowed to change how the game
// looks without the player asking. That makes its failure modes unusually
// annoying — oscillation, ratcheting down on a single hitch, or never climbing
// back — so its hysteresis is pinned here rather than tuned by feel.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { PerfDirector, QUALITY_TIERS, guessStartTier } = await import('../src/game/perf-director.ts');

/** Run the director over `seconds` of frames rendered at `fps`. */
function simulate(director, fps, seconds, startMs = 0) {
  const dt = 1 / fps;
  const changes = [];
  let t = startMs;
  for (let i = 0; i < Math.ceil(seconds * fps); i++) {
    t += dt * 1000;
    const d = director.update(t, dt);
    if (d.changed) changes.push({ t, ...d });
  }
  return { changes, endMs: t };
}

test('the tier ladder only ever gets cheaper', () => {
  for (let i = 1; i < QUALITY_TIERS.length; i++) {
    const hi = QUALITY_TIERS[i - 1], lo = QUALITY_TIERS[i];
    assert.ok(lo.renderScale <= hi.renderScale, `${lo.name} renders larger than ${hi.name}`);
    assert.ok(lo.shadowMap <= hi.shadowMap, `${lo.name} shadows cost more than ${hi.name}`);
    assert.ok(lo.shadowInterval >= hi.shadowInterval, `${lo.name} refreshes shadows more often than ${hi.name}`);
    assert.ok(lo.particleMul <= hi.particleMul, `${lo.name} spawns more particles than ${hi.name}`);
    assert.ok(lo.drawDistance <= hi.drawDistance, `${lo.name} draws further than ${hi.name}`);
    assert.ok(!(lo.bloom && !hi.bloom), `${lo.name} enables bloom that ${hi.name} does not`);
  }
  // Never so aggressive that the game becomes unreadable.
  assert.ok(QUALITY_TIERS.at(-1).renderScale >= 0.5, 'bottom tier must stay legible');
});

test('a machine holding target is left completely alone', () => {
  const d = new PerfDirector(0);
  const { changes } = simulate(d, 62, 40);
  assert.deepEqual(changes, [], 'a healthy machine must never be touched');
  assert.equal(d.index, 0);
});

test('a genuinely slow machine is rescued within a second, not eight', () => {
  const d = new PerfDirector(0);
  const { changes } = simulate(d, 20, 3);
  assert.ok(changes.length > 0, 'never reacted to 20 fps');
  assert.equal(changes[0].reason, 'panic');
  assert.ok(changes[0].t < 1500, `first rescue took ${Math.round(changes[0].t)} ms`);
  assert.ok(changes[0].tier >= 2, 'a 3x deficit deserves more than one step');
});

test('one long hitch does not cost a tier', () => {
  const d = new PerfDirector(0);
  let t = 0;
  // Four seconds of healthy frames, then a single 700 ms stall, then healthy again.
  for (let i = 0; i < 240; i++) { t += 1000 / 60; d.update(t, 1 / 60); }
  t += 700; d.update(t, 0.7);
  for (let i = 0; i < 240; i++) { t += 1000 / 60; d.update(t, 1 / 60); }
  assert.equal(d.index, 0, 'a single hitch must not ratchet quality down');
});

test('it steps down under sustained load and climbs back when the load clears', () => {
  const d = new PerfDirector(0);
  const slow = simulate(d, 38, 20);
  assert.ok(slow.changes.length > 0, 'never reacted to sustained 38 fps');
  const bottomed = d.index;
  assert.ok(bottomed > 0);

  const fast = simulate(d, 120, 60, slow.endMs);
  assert.ok(fast.changes.some(c => c.reason === 'up'), 'never recovered when the machine freed up');
  assert.ok(d.index < bottomed, `stuck at tier ${bottomed} despite 120 fps`);
});

test('it does not oscillate when the machine sits exactly on the boundary', () => {
  const d = new PerfDirector(1);
  // 57 fps: below the 60 target but inside the dead zone.
  const { changes } = simulate(d, 57, 90);
  assert.ok(changes.length <= 1, `oscillated ${changes.length} times on a steady 57 fps`);
});

test('the player can pin the ladder and the director respects it', () => {
  const d = new PerfDirector(2);
  d.setBounds(2, 2);
  simulate(d, 12, 30);
  assert.equal(d.index, 2, 'director escaped a pinned tier under load');
  simulate(d, 200, 30);
  assert.equal(d.index, 2, 'director escaped a pinned tier when idle');
});

test('the first-launch guess is conservative but not insulting', () => {
  assert.equal(guessStartTier({ renderer: 'ANGLE (Google, SwiftShader)', deviceMemoryGb: 16, cores: 8 }), 5);
  assert.equal(guessStartTier({ mobile: true }), 4);
  assert.equal(guessStartTier({ renderer: 'ANGLE (NVIDIA GeForce RTX 4070)', deviceMemoryGb: 32, cores: 16 }), 0);
  // The machine in the brief: 16 GB, unidentified GPU. Should start High and climb.
  const typical = guessStartTier({ deviceMemoryGb: 16, cores: 8 });
  assert.ok(typical >= 1 && typical <= 2, `16 GB machine should start mid-ladder, got ${typical}`);
  // Weak integrated graphics must not be handed Ultra.
  assert.ok(guessStartTier({ renderer: 'Intel(R) UHD Graphics 620', deviceMemoryGb: 8, cores: 4 }) >= 3);
});
