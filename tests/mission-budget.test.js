import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';

const { Mission, getMission } = await import('../src/game/systems/mission.ts');
const { PressureDirector, makeSpawnView } = await import('../src/game/systems/reinforcements.ts');

test('mission-only work has a bounded event/actor/query budget over a 20-minute simulation', t => {
  const camera = new THREE.PerspectiveCamera(95, 16 / 9, 0.05, 500);
  camera.position.set(0, 1.62, 0); camera.updateMatrixWorld(true);
  const view = makeSpawnView(camera, [0, 0, 0]);
  const mission = new Mission(getMission('alrasul'));
  const director = new PressureDirector(Array.from({ length: 64 }, (_, i) => ({ id: `site-${i}`, from: 'south', at: [i - 32, 0, 60] })));
  director.setPolicy({ target: 9, interval: 4 }, 'market', [-25, 0, 20]);
  let actors = [], id = 0, maxCasts = 0;
  const hooks = {
    isWalkable: () => true, hasLineOfSight: () => false,
    spawn(batch) { actors.push(...batch.members.map(at => ({ id: ++id, at, alive: true, seesPlayer: false }))); return true; },
    retire(victim) { actors = actors.filter(actor => actor.id !== victim); },
  };
  mission.start(); mission.drainEvents();
  const start = performance.now();
  for (let i = 0; i < 2400; i++) {
    mission.update(0.5, { player: [0, 0, 96], alive: true });
    director.update(0.5, actors, view, hooks);
    const stats = director.stats();
    maxCasts = Math.max(maxCasts, stats.sightChecks);
    assert.ok(actors.length <= 10);
    assert.ok(stats.candidateChecks <= 8);
    assert.ok(stats.sightChecks <= 32);
    assert.ok(stats.pending <= 30);
    if (i % 24 === 0) actors = [];
  }
  const duration = performance.now() - start;
  assert.equal(mission.report().phases.length, 5);
  assert.ok(mission.diagnostics().queuedEvents <= 64);
  t.diagnostic(`2400 pressure evaluations: ${duration.toFixed(2)} ms total; max LOS probes per evaluation: ${maxCasts}. This is not an ai.update or GPU/FPS benchmark.`);
});