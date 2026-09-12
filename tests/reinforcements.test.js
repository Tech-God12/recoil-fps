import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { PressureDirector, canInsertSquad, actorInView, makeSpawnView } = await import('../src/game/systems/reinforcements.ts');

const camera = new THREE.PerspectiveCamera(95, 16 / 9, 0.05, 500);
camera.position.set(0, 1.62, 0); camera.updateMatrixWorld(true);
const view = () => makeSpawnView(camera, [0, 0, 0]);
const site = { id: 'south', from: 'south', at: [0, 0, 50], members: [[0, 0, 50], [-1.2, 0, 51], [1.2, 0, 51]] };
const probes = { isWalkable: () => true, hasLineOfSight: () => false };

test('spawn rejects proximity, visible frustum, open LOS, and blocked landing independently', () => {
  assert.equal(canInsertSquad(site.members, view(), probes), true);
  assert.equal(canInsertSquad([[0, 0, 24], [-1, 0, 23], [1, 0, 23]], view(), probes), false);
  assert.equal(canInsertSquad([[0, 0, -40], [-1, 0, -40], [1, 0, -40]], view(), probes), false);
  assert.equal(canInsertSquad(site.members, view(), { ...probes, hasLineOfSight: () => true }), false);
  assert.equal(canInsertSquad(site.members, view(), { ...probes, hasLineOfSight: at => at[1] > 1.6 }), false, 'a visible head blocks insertion');
  assert.equal(canInsertSquad(site.members, view(), { ...probes, hasLineOfSight: at => at[1] < 1 }), false, 'a visible body blocks insertion');
  assert.equal(canInsertSquad(site.members, view(), { ...probes, isWalkable: () => false }), false);
});

test('2000 varied spawn attempts agree with an independent Three.js frustum and minimum range', () => {
  let accepted = 0;
  const frustum = new THREE.Frustum();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 2000; i++) {
    const x = Math.sin(i * 1.3) * 45, z = Math.cos(i * 0.71) * 45;
    camera.fov = 45 + i % 76; camera.aspect = 0.8 + (i % 17) / 10;
    camera.position.set(x, 1.62, z);
    camera.rotation.set(Math.sin(i) * 0.3, i * 0.47, Math.cos(i) * 0.61, 'YXZ');
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const snapshot = makeSpawnView(camera, [x, 0, z]);
    const a = i * 2.39996, r = 8 + i % 95;
    const members = [[x + Math.cos(a) * r, 0, z + Math.sin(a) * r], [x + Math.cos(a) * r + 1.2, 0, z + Math.sin(a) * r + 1], [x + Math.cos(a) * r - 1.2, 0, z + Math.sin(a) * r + 1]];
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (canInsertSquad(members, snapshot, probes)) {
      accepted++;
      for (const at of members) {
        const body = new THREE.Sphere(new THREE.Vector3(at[0], at[1] + 0.95, at[2]), 1.1);
        assert.equal(frustum.intersectsSphere(body), false, `attempt ${i}: visible pop-in`);
        assert.ok(Math.hypot(at[0] - x, at[2] - z) >= 25, `attempt ${i}: too close`);
        assert.equal(actorInView(at, snapshot), false);
      }
    }
  }
  assert.ok(accepted > 100, 'the safety test must permit valid spawns, not reject everything');
  camera.fov = 95; camera.aspect = 16 / 9; camera.position.set(0, 1.62, 0); camera.rotation.set(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
});

test('pressure escalates through replacements but never exceeds ten live enemies or the work budget', () => {
  const d = new PressureDirector([site]);
  d.setPolicy({ target: 9, interval: 1 }, 'market', [10, 0, 0]);
  d.request(900);
  let actors = [];
  let next = 0;
  const hooks = {
    ...probes,
    spawn(batch) {
      actors.push(...batch.members.map(at => ({ id: ++next, at, alive: true, seesPlayer: false })));
      return true;
    },
    retire(id) { actors = actors.filter(a => a.id !== id); },
  };
  for (let i = 0; i < 180; i++) {
    d.update(0.5, actors, view(), hooks);
    assert.ok(actors.filter(a => a.alive).length <= 10);
    assert.ok(d.stats().candidateChecks <= 8);
    assert.ok(d.stats().sightChecks <= 32);
    assert.ok(d.stats().pending <= 30);
    if (i % 8 === 7) actors = [];
  }
  assert.ok(d.stats().totalSpawned > 18);
  assert.ok(d.stats().peakLive <= 10);
  actors = Array.from({ length: 8 }, (_, i) => ({ id: i + 10000, at: [0, 0, 50], alive: true, seesPlayer: false }));
  const before = d.stats().totalSpawned;
  d.update(5, actors, view(), hooks);
  assert.equal(d.stats().totalSpawned, before, 'a squad of three does not fit into two remaining slots');
});

test('retirement requires twenty seconds beyond ninety metres, no LOS, and outside the view', () => {
  const d = new PressureDirector([site]);
  d.setPolicy({ target: 0, interval: 5 }, null, [0, 0, 0]);
  const actors = [{ id: 1, at: [0, 0, 95], alive: true, seesPlayer: false }];
  const retired = [];
  const hooks = { ...probes, spawn: () => false, retire: id => retired.push(id) };
  d.update(0.5, actors, view(), hooks);
  for (let i = 0; i < 39; i++) d.update(0.5, actors, view(), hooks);
  assert.deepEqual(retired, []);
  d.update(0.5, actors, view(), hooks);
  assert.deepEqual(retired, [1]);
  const d2 = new PressureDirector([site]);
  d2.setPolicy({ target: 0, interval: 5 }, null, [0, 0, 0]);
  actors[0].seesPlayer = true;
  d2.update(25, actors, view(), hooks);
  d2.update(25, actors, view(), hooks);
  assert.deepEqual(retired, [1]);
});

test('phase pressure targets, not total kills, determine reinforcement demand', () => {
  const d = new PressureDirector([site]);
  const actors = [];
  let id = 0;
  const hooks = {
    ...probes,
    spawn(batch) { actors.push(...batch.members.map(at => ({ id: ++id, at, alive: true, seesPlayer: false }))); return true; },
    retire() {},
  };
  d.setPolicy({ target: 3, interval: 4 }, 'market', [10, 0, 0]);
  d.update(1, actors, view(), hooks);
  assert.equal(actors.length, 3);
  d.update(100, actors, view(), hooks);
  assert.equal(actors.length, 3, 'a low-pressure phase must not fill the cap');
  d.setPolicy({ target: 9, interval: 4 }, null, [20, 0, 0]);
  d.update(1, actors, view(), hooks);
  d.update(5, actors, view(), hooks);
  assert.equal(actors.length, 9, 'the hold policy admits additional squads');
});

test('unsafe sites defer rather than spawning openly; failed allocations consume no budget', () => {
  const sites = Array.from({ length: 40 }, (_, i) => ({ ...site, id: `entry-${i}` }));
  const d = new PressureDirector(sites);
  d.setPolicy({ target: 6, interval: 1 }, 'market', [10, 0, 0]);
  let attempts = 0;
  const hooks = { ...probes, isWalkable: () => false, spawn: () => { attempts++; return true; }, retire: () => {} };
  d.update(1, [], view(), hooks);
  assert.equal(attempts, 0);
  assert.equal(d.stats().candidateChecks, 8);
  hooks.isWalkable = () => true; hooks.spawn = () => false;
  d.update(1, [], view(), hooks);
  assert.equal(d.stats().totalSpawned, 0);
  hooks.spawn = () => { attempts++; return true; };
  hooks.hasLineOfSight = () => true;
  d.update(1, [], view(), hooks);
  assert.equal(attempts, 0, 'the director must retain the visibility gate when it wraps the probes');
});