import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const { MissionRuntime } = await import('../src/game/systems/mission-runtime.ts');
const { NavGrid } = await import('../src/game/ai.ts');

function fixture() {
  const ended = [], briefs = [], phases = [];
  const world = { solids: [], occluders: [], half: 112 };
  const ai = { nav: new NavGrid([], 112), enemies: [], insertSquad: () => false, retire() {}, alertZone() {}, aliveCount() { return this.enemies.filter(e => !e.dead).length; } };
  const host = {
    world, ai, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(90, 1, 0.05, 500), player: new THREE.Vector3(),
    isAlive: () => true, phaseChanged: p => phases.push(p.id), radio: text => briefs.push(text), detonate() {}, resupply() {}, finish: win => ended.push(win),
  };
  const runtime = new MissionRuntime(host, 'kasbah');
  return { runtime, host, ended, briefs, phases };
}

test('runtime opening presence is requested exactly once even if start is called twice', () => {
  const { runtime, phases, briefs } = fixture();
  const calls = [];
  const request = runtime.pressure.request.bind(runtime.pressure);
  runtime.pressure.request = (count, from) => { calls.push(count); request(count, from); };
  runtime.start(); runtime.start();
  assert.deepEqual(calls, [3]);
  assert.equal(phases.length, 1);
  assert.equal(briefs.length, 1);
  runtime.dispose();
});

test('runtime defense counts only living ground-level intruders and routes overrun into failure', () => {
  const { runtime, host, ended } = fixture();
  runtime.start();
  // Isolate the runtime's actor adapter; the full phase sequence is covered separately.
  runtime.mission.index = 3; runtime.mission.enterPhase(); runtime.consumeEvents();
  host.player.set(40, 0, 40);
  const p = runtime.mission.current.at;
  host.ai.enemies = [
    { id: 1, dead: false, pos: new THREE.Vector3(...p) },
    { id: 2, dead: true, pos: new THREE.Vector3(...p) },
    { id: 3, dead: false, pos: new THREE.Vector3(p[0], 10, p[2]) },
    { id: 4, dead: false, pos: new THREE.Vector3(80, 0, 80) },
  ];
  runtime.update(1, false);
  assert.equal(runtime.mission.snapshot(p).defense, 96);
  assert.equal(runtime.mission.snapshot(p).contested, true);
  runtime.update(24, false);
  assert.deepEqual(ended, [false]);
  runtime.update(50, false);
  assert.deepEqual(ended, [false]);
  runtime.dispose();
});
