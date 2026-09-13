import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { Mission, getMission, validateMission } = await import('../src/game/systems/mission.ts');
const { objectiveReadout } = await import('../src/ui/MissionObjective.tsx');

function atDefense() {
  const m = new Mission(getMission('kasbah')); m.start();
  while (m.current.type !== 'defend') {
    const p = m.current;
    if (p.type === 'clear') for (let i = 0; i < p.count; i++) m.recordElimination({ id: i, at: p.at });
    m.update(p.plantSeconds ?? 0.1, { player: p.at, alive: true, interact: true, targetVisible: true });
    if (p.type === 'destroy') m.update(p.fuse, { player: [40, 0, 0], alive: true });
  }
  m.drainEvents();
  return m;
}
const input = (hostiles = 0, extra = {}) => ({ player: [90, 0, 90], alive: true, hostilesInObjective: hostiles, ...extra });

test('defend drains only for hostiles, not for player absence, and exposes actual integrity', () => {
  const m = atDefense();
  m.update(10, input());
  assert.equal(m.snapshot([90, 0, 90]).defense, 100);
  assert.equal(m.snapshot([90, 0, 90]).remaining, 65);
  m.update(2, input(3));
  const s = m.snapshot([90, 0, 90]);
  assert.equal(s.defense, 76);
  assert.equal(s.remaining, 63);
  assert.equal(s.contested, true);
  assert.equal(s.inside, false);
  assert.match(objectiveReadout(s).value, /76%/);
  assert.match(objectiveReadout(s).label, /overrun/);
  m.update(1, input());
  assert.equal(m.snapshot([90, 0, 90]).defense, 76, 'integrity never regenerates for free');
  assert.equal(m.snapshot([90, 0, 90]).contested, false);
});

test('defend fails at zero integrity even on the completion boundary and emits failure exactly once', () => {
  const m = atDefense();
  m.update(65, input());
  m.update(10, input(3));
  assert.equal(m.status, 'failed');
  assert.equal(m.current.type, 'defend');
  assert.equal(m.snapshot([0, 0, 5]).defense, 0);
  m.update(500, input()); m.fail();
  const events = m.drainEvents();
  assert.deepEqual(events.filter(e => e.type === 'mission-ended'), [{ type: 'mission-ended', status: 'failed' }]);
  assert.equal(m.report().phases[3].complete, false);
});

test('defend completes with positive integrity, honors pause/death, and caps oversized timestep at deadline', () => {
  const m = atDefense();
  const before = m.snapshot([0, 0, 5]);
  m.update(50, input(10, { paused: true }));
  assert.deepEqual(m.snapshot([0, 0, 5]), before);
  m.update(74, input());
  m.update(100, input(1)); // Only the final second may drain the relay.
  assert.equal(m.status, 'active');
  assert.equal(m.current.id, 'gate-run');
  assert.equal(m.report().phases[3].complete, true);
  const events = m.drainEvents();
  assert.equal(events.filter(e => e.type === 'phase-completed').length, 1);
  assert.equal(events.filter(e => e.type === 'reinforcement-request').length, 4);
  const dead = atDefense(); dead.update(75, input(0, { alive: false }));
  assert.equal(dead.status, 'failed');
  assert.equal(dead.current.type, 'defend');
});

test('defend validates its pool/drain/timer and sanitizes invalid hostile counts', () => {
  for (const [field, value] of [['defense', 0], ['defense', 1.5], ['defense', 1001], ['drain', NaN], ['drain', 0], ['drain', 101], ['seconds', 0], ['seconds', 301]]) {
    const definition = structuredClone(getMission('kasbah'));
    definition.phases[3][field] = value;
    assert.ok(validateMission(definition).length > 0, `${field}=${value}`);
  }
  const m = atDefense();
  for (const value of [NaN, Infinity, -3, undefined]) m.update(1, input(value));
  assert.equal(m.snapshot([0, 0, 5]).defense, 100);
  m.update(0.1, input(1000));
  assert.equal(m.snapshot([0, 0, 5]).defense, 96, 'input cannot exceed the ten-alive budget');
});

test('20-minute defend success and failure simulations keep events bounded and freeze terminal state', () => {
  for (const hostileCount of [0, 3]) {
    const m = atDefense(); let eventCount = 0;
    for (let i = 0; i < 2400; i++) {
      const p = m.current;
      m.update(0.5, { ...input(hostileCount), player: p.type === 'defend' ? [90, 0, 90] : p.at });
      eventCount += m.drainEvents().length;
      assert.ok(m.diagnostics().queuedEvents <= 64);
    }
    assert.equal(m.status, hostileCount ? 'failed' : 'complete');
    assert.ok(eventCount <= 64);
    const elapsed = m.elapsed;
    m.update(300, input()); assert.equal(m.elapsed, elapsed);
  }
});
