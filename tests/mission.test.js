import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { Mission, getMission, objectiveGuidance, validateMission } = await import('../src/game/systems/mission.ts');

function fixture() {
  const source = structuredClone(getMission('alrasul'));
  source.phases = [
    { id: 'approach', type: 'advance', title: 'Approach', location: 'Market', brief: 'Move.', at: [10, 0, 0], radius: 2, pressure: { target: 3, interval: 8 }, onComplete: { alert: 'market', reinforce: 3 } },
    { id: 'market', type: 'clear', title: 'Clear', location: 'Market', brief: 'Clear.', at: [10, 0, 0], radius: 8, zone: 'market', count: 2, pressure: { target: 6, interval: 6 } },
    { id: 'cache', type: 'destroy', title: 'Destroy', location: 'Garrison', brief: 'Plant.', at: [20, 0, 0], radius: 3, plantSeconds: 2, fuse: 5, pressure: { target: 6, interval: 6 }, onComplete: { alert: 'all', reinforce: 6 } },
    { id: 'defend', type: 'hold', title: 'Hold', location: 'Garrison', brief: 'Hold.', at: [20, 0, 0], radius: 8, seconds: 8, escalate: { every: 2, count: 3 }, pressure: { target: 9, interval: 4 } },
    { id: 'exfil', type: 'extract', title: 'Extract', location: 'South gate', brief: 'Leave.', at: [40, 0, 0], radius: 3, pressure: { target: 6, interval: 8 } },
  ];
  return new Mission(source);
}

const input = (at, overrides = {}) => ({ player: at, alive: true, paused: false, interact: false, targetVisible: true, ...overrides });
function reachClear(m) {
  m.start(); m.drainEvents();
  m.update(0.1, input([10, 0, 0])); m.drainEvents();
}
function reachDestroy(m) {
  reachClear(m);
  for (const id of [1, 2]) m.recordElimination({ id, at: [10, 0, 0], zone: 'market' });
  m.update(0.1, input([10, 0, 0])); m.drainEvents();
}
function reachHold(m) {
  reachDestroy(m);
  m.update(2, input([20, 0, 0], { interact: true }));
  m.update(5, input([30, 0, 0])); m.drainEvents();
}

test('advance is spatial, not elapsed time or an empty enemy roster', () => {
  const m = fixture(); m.start();
  m.update(30, input([0, 0, 0]));
  assert.equal(m.current.type, 'advance');
  m.update(0.1, input([10, 4, 0]));
  assert.equal(m.current.type, 'advance', 'being above a target must not complete it');
  m.update(0.1, input([8, 0, 0]));
  assert.equal(m.current.type, 'clear');
});

test('clear credits the named zone once per victim, never arbitrary distant kills', () => {
  const m = fixture(); reachClear(m);
  m.recordElimination({ id: 1, at: [80, 0, 0], zone: 'depot' });
  m.update(1, input([10, 0, 0]));
  assert.equal(m.snapshot([10, 0, 0]).completed, 0);
  m.recordElimination({ id: 2, at: [10, 0, 0], zone: 'market' });
  m.recordElimination({ id: 2, at: [10, 0, 0], zone: 'market' });
  m.update(1, input([10, 0, 0]));
  assert.equal(m.current.type, 'clear');
  assert.equal(m.snapshot([10, 0, 0]).completed, 1);
  m.recordElimination({ id: 3, at: [11, 0, 0], zone: 'market' });
  m.update(0.1, input([10, 0, 0]));
  assert.equal(m.current.type, 'destroy');
});

test('killing market defenders during approach does not soft-lock the later clear', () => {
  const m = fixture(); m.start();
  for (const id of [1, 2]) m.recordElimination({ id, at: [10, 0, 0], zone: 'market' });
  m.update(0.1, input([0, 0, 0]));
  assert.equal(m.current.type, 'advance');
  m.update(0.1, input([10, 0, 0]));
  assert.equal(m.current.type, 'clear', 'only one phase transition is allowed per update');
  m.update(0.1, input([10, 0, 0]));
  assert.equal(m.current.type, 'destroy');
});

test('tap attachment saves progress through cover breaks, resumes hands-free, and keeps a backup fuse', () => {
  const m = fixture(); reachDestroy(m);
  m.update(3, input([50,0,0],{interact:true}));
  m.update(0.1,input([20,0,0]));
  m.update(3,input([20,0,0],{interact:true,targetVisible:false}));
  assert.equal(m.snapshot([20,0,0]).plantProgress,0);
  m.update(0.1,input([20,0,0]));
  assert.equal(m.snapshot([20,0,0]).plantProgress,0,'a rejected tap behind cover must not latch');
  m.update(0.5,input([20,0,0],{interact:true}));
  m.update(10,input([50,0,0]));
  assert.equal(m.snapshot([20,0,0]).plantProgress,0.25);
  m.update(10,input([20,0,0],{targetVisible:false}));
  assert.equal(m.snapshot([20,0,0]).plantProgress,0.25);
  m.update(1.5,input([20,0,0]));
  assert.equal(m.snapshot([20,0,0]).armed,true,'no need to keep X held');
  assert.equal(m.snapshot([20,0,0]).remaining,5);
  m.update(4.99,input([50,0,0]));
  assert.equal(m.current.type,'destroy');
  m.update(0.02,input([50,0,0]));
  assert.equal(m.current.type,'hold');
  assert.equal(m.drainEvents().filter(e=>e.type==='cache-detonated').length,1);
});

test('remote detonation requires a fresh press and clearance, not continuing to hold X', () => {
  const m=fixture(); reachDestroy(m);
  m.update(2,input([20,0,0],{interact:true}));
  m.update(1,input([50,0,0],{interact:true}));
  assert.equal(m.current.type,'destroy');
  m.update(0,input([20,0,0]));
  m.update(0.1,input([20,0,0],{interact:true}));
  assert.equal(m.current.type,'destroy','remote lockout inside blast clearance');
  m.update(0,input([50,0,0]));
  m.update(0.1,input([50,0,0],{interact:true}));
  assert.equal(m.current.type,'hold');
});

test('hold only advances in-zone, preserves progress outside, and schedules each wave once', () => {
  const m = fixture(); reachHold(m);
  m.update(20, input([60, 0, 0]));
  assert.equal(m.current.type, 'hold');
  assert.equal(m.snapshot([60, 0, 0]).remaining, 8);
  m.update(3, input([20, 0, 0]));
  m.update(10, input([60, 0, 0]));
  assert.equal(m.snapshot([20, 0, 0]).remaining, 5);
  m.update(5, input([20, 0, 0]));
  assert.equal(m.current.type, 'extract');
  const waves = m.drainEvents().filter(e => e.type === 'reinforcement-request');
  assert.equal(waves.length, 3);
  assert.equal(waves.reduce((n, e) => n + e.count, 0), 9);
});

test('each consequence fires once; only extraction ends the mission', () => {
  const m = fixture(); m.start(); m.start();
  m.update(1, input([10, 0, 0]));
  let events = m.drainEvents();
  assert.equal(events.filter(e => e.type === 'phase-started' && e.index === 0).length, 1);
  assert.equal(events.filter(e => e.type === 'phase-completed').length, 1);
  for (let i = 0; i < 10; i++) m.update(1, input([10, 0, 0]));
  assert.equal(m.drainEvents().length, 0);
  for (const id of [1, 2]) m.recordElimination({ id, at: [10, 0, 0] });
  m.update(1, input([10, 0, 0]));
  m.update(2, input([20, 0, 0], { interact: true }));
  m.update(5, input([35, 0, 0]));
  m.update(8, input([20, 0, 0]));
  assert.equal(m.status, 'active');
  m.update(10, input([20, 0, 0]));
  assert.equal(m.status, 'active');
  m.update(0.1, input([40, 0, 0]));
  assert.equal(m.status, 'complete');
  const endedAt = m.elapsed;
  m.update(1000, input([40, 0, 0]));
  assert.equal(m.elapsed, endedAt, 'completion freezes the report clock');
  events = m.drainEvents();
  assert.equal(events.filter(e => e.type === 'mission-ended').length, 1);
  assert.equal(m.report().phases.filter(p => p.complete).length, 5);
});

test('pause freezes every mission clock; death cannot advance an objective', () => {
  const m = fixture(); reachHold(m);
  const before = m.snapshot([20, 0, 0]);
  m.update(60, input([20, 0, 0], { paused: true }));
  assert.deepEqual(m.snapshot([20, 0, 0]), before);
  m.update(60, input([20, 0, 0], { alive: false }));
  assert.equal(m.status, 'failed');
  assert.equal(m.current.type, 'hold');
});

test('both shipped missions have finite objectives, reachable predicate sequences, and terminal extraction', () => {
  for (const map of ['alrasul', 'kasbah']) {
    const definition = getMission(map);
    assert.deepEqual(validateMission(definition), []);
    assert.deepEqual(definition.phases.map(p => p.pressure.target), map === 'alrasul' ? [3, 6, 6, 9, 6] : [3, 6, 6, 9, 9, 6]);
    assert.deepEqual(definition.phases.map(p => p.type), map === 'alrasul' ? ['advance','clear','destroy','hold','extract'] : ['advance','clear','destroy','defend','advance','extract']);
    const m = new Mission(definition); m.start();
    for (const phase of definition.phases) {
      assert.equal(m.current.id, phase.id);
      if (phase.type === 'clear') {
        for (let i = 0; i < phase.count; i++) m.recordElimination({ id: i, at: phase.at, zone: phase.zone });
      }
      if (phase.type === 'destroy') {
        m.update(phase.plantSeconds, input(phase.at, { interact: true }));
        m.update(phase.fuse, input(phase.at));
      } else m.update(phase.seconds ?? 0.1, input(phase.at));
    }
    assert.equal(m.status, 'complete');
    assert.equal(m.report().phases.length, map === 'alrasul' ? 5 : 6);
    assert.ok(m.report().phases.every(p => p.complete));
  }
});

test('invalid definitions fail early instead of creating deadlocked phases', () => {
  const definition = structuredClone(getMission('alrasul'));
  definition.phases[3].seconds = 0;
  assert.throws(() => new Mission(definition), /seconds/);
  definition.phases[3].seconds = 60;
  definition.phases.at(-1).type = 'clear';
  assert.throws(() => new Mission(definition), /extract/);
  const emptyPressure = structuredClone(getMission('alrasul'));
  emptyPressure.phases[1].pressure.target = 0;
  assert.throws(() => new Mission(emptyPressure), /reinforcement squad/);
});

test('guidance uses player-to-objective bearing and shortest signed angle', () => {
  const guide = objectiveGuidance([0, 0, 0], [3, 0, -4], 0);
  assert.equal(guide.distance, 5);
  assert.ok(Math.abs(guide.bearing - 36.86989764584405) < 1e-9);
  assert.ok(Math.abs(guide.relativeBearing - guide.bearing) < 1e-9);
  assert.equal(objectiveGuidance([0, 0, 0], [0, 0, -10], 350).relativeBearing, 10);
  assert.equal(objectiveGuidance([0, 0, 0], [10, 0, 0], 90).relativeBearing, 0);
});

test('mission bookkeeping and event queue stay bounded during long idle sessions', () => {
  const m = fixture(); m.start();
  for (let i = 0; i < 10000; i++) {
    m.recordElimination({ id: i, at: [10, 0, 0], zone: 'market' });
    m.update(1 / 60, input([0, 0, 0]));
  }
  assert.ok(m.diagnostics().creditedVictims <= 2);
  assert.ok(m.diagnostics().queuedEvents <= 64);
  assert.equal(m.report().phases.length, 5);
});