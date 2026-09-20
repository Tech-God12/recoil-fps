import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';

const { Mission, getMission } = await import('../src/game/systems/mission.ts');
const { PressureDirector, makeSpawnView } = await import('../src/game/systems/reinforcements.ts');
const { MissionMarkers } = await import('../src/game/systems/mission-markers.ts');
const { AIManager } = await import('../src/game/ai.ts');
const { buildSoldier } = await import('../src/game/models.ts');
const { Engine, DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { voice } = await import('../src/game/voice.ts');
const { default: MissionObjective, missionClock } = await import('../src/ui/MissionObjective.tsx');
const { MainMenu, BootScreen } = await import('../src/ui/Screens.tsx');

function aiContext() {
  return {
    scene: new THREE.Scene(), solids: [], occluders: [], coverNodes: [], half: 104,
    effects: { bloodDecal() {}, enemyMuzzle() {}, tracer() {} },
    difficulty: { reaction: 0.5, accuracy: 0.7, flank: true, aggression: 0.8 },
    playerPos: () => new THREE.Vector3(0, 1.62, 0), playerFeet: () => new THREE.Vector3(), playerAlive: () => true,
    playerVel: () => 0, playerStaticTime: () => 0, damagePlayer() {},
    moveCollide(p, x, z) { p.x += x; p.z += z; }, onCallout() {}, aiThrowGrenade() {}, onEnemyFire() {},
  };
}

test('articulated soldier stays within its draw/triangle budget; the reinforcement pool cannot grow beyond ten', () => {
  const restore = installCanvasStub();
  try {
    const model = buildSoldier();
    const budget = geometryBudget(model.group);
    assert.ok(budget.draws <= 36, `${budget.draws} draws exceeds 36`);
    assert.ok(budget.triangles <= 9000, `${budget.triangles} triangles exceeds 9000`);
    const ai = new AIManager(aiContext(), []);
    assert.equal(ai.enemies.length, 0, 'no fixed roster spawns at frame zero');
    assert.equal(ai.allocationCount(), 10);
    const batch = { insertionId: 'site', from: 'south', zone: 'market', focus: [0, 0, 0], members: [[0, 0, 50], [-2, 0, 52], [2, 0, 52]] };
    for (let i = 0; i < 3; i++) assert.equal(ai.insertSquad(batch), true);
    assert.equal(ai.aliveCount(), 9);
    assert.equal(ai.insertSquad(batch), false);
    const firstIds = new Set(ai.enemies.map(e => e.id));
    const first = ai.enemies[0];
    first.doAlert = () => {};
    first.checkLOS = () => false;
    first.updateLogic(0.25);
    assert.equal(first.stateTime, 0.25, 'an AI tick must not advance timers twice');
    for (const e of ai.enemies) { e.takeDamage(1000, false); e.updateVisualFrame(7); }
    assert.equal(ai.insertSquad(batch), true);
    const spawned = ai.enemies.filter(e => !e.dead);
    assert.equal(spawned.length, 3);
    assert.ok(spawned.every(e => !firstIds.has(e.id)), 'pooled actors need fresh kill-credit IDs');
    assert.ok(spawned.every(e => e.hp === 100 && e.state === 'ALERT' && e.model.group.visible));
    assert.equal(ai.allocationCount(), 10);
    ai.dispose();
    assert.equal(ai.allocationCount(), 0);
    assert.equal(ai.ctx.scene.children.length, 0, 'retiring the mission releases the actor scene nodes');
  } finally { restore(); }
});

test('mission visuals use at most four draws / 512 triangles and cache collision retires on detonation', () => {
  const world = { solids: [], occluders: [] };
  const markers = new MissionMarkers(new THREE.Scene(), world, getMission('alrasul'));
  const budget = geometryBudget(markers.group);
  assert.ok(budget.draws <= 4);
  assert.ok(budget.triangles <= 512);
  const hold = getMission('alrasul').phases[3];
  markers.setPhase(hold);
  assert.ok(world.occluders.includes(markers.cache));
  markers.destroyCache(world);
  assert.equal(markers.cache.visible, false);
  assert.equal(world.occluders.includes(markers.cache), false);
  assert.ok(world.solids[0].minY > 1000);
  markers.dispose();
});

test('the engine rejects victory before extraction, irrespective of enemy count', () => {
  voice.setEnabled(false);
  const engine = Object.create(Engine.prototype);
  engine.ended = false;
  engine.keys = new Set();
  const mission = new Mission(getMission('alrasul')); mission.start();
  engine.missionRuntime = { mission, pressure: { stats: () => ({}) } };
  engine.endMatch(true);
  assert.equal(engine.ended, false);
  const source = readFileSync(new URL('../src/game/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /aliveCount\(\)\s*===\s*0\)\s*this\.endMatch/);
  assert.match(source, /new AIManager\(ctx, \[\]/, 'the engine must not reintroduce its legacy fixed roster');
  assert.equal((source.match(/pattern: \[\[0, 0\]\]/g) ?? []).length, 4, 'only the explicitly reworked MP changes its recoil pattern');
});

test('a full scripted operation escalates above eighteen total spawns with a ten-live ceiling', () => {
  const mission = new Mission(getMission('alrasul'));
  const camera = new THREE.PerspectiveCamera(95, 16 / 9, 0.05, 500);
  camera.position.set(0, 1.62, 0); camera.updateMatrixWorld(true);
  const view = makeSpawnView(camera, [0, 0, 0]);
  const director = new PressureDirector([{ id: 'insertion', from: 'north', at: [0, 0, 50] }]);
  let actors = [], id = 0, time = 0;
  const hooks = {
    isWalkable: () => true, hasLineOfSight: () => false,
    spawn(batch) { actors.push(...batch.members.map(at => ({ id: ++id, at, alive: true, seesPlayer: false, zone: batch.zone }))); return true; },
    retire(actorId) { actors = actors.filter(a => a.id !== actorId); },
  };
  const events = () => {
    for (const e of mission.drainEvents()) {
      if (e.type === 'phase-started') {
        const clear = e.phase.type === 'advance' ? mission.definition.phases[1] : e.phase;
        director.setPolicy(e.phase.pressure, clear.zone ?? null, clear.at);
      }
      if (e.type === 'phase-completed' && e.consequences.reinforce) director.request(e.consequences.reinforce, e.consequences.from);
      if (e.type === 'reinforcement-request') director.request(e.count, e.from);
    }
  };
  mission.start(); events();
  while (mission.status === 'active' && time < 300) {
    const p = mission.current;
    director.update(0.5, actors, view, hooks);
    assert.ok(actors.length <= 10);
    if (time % 2 === 0 && actors.length) {
      const victim = actors.shift();
      mission.recordElimination({ id: victim.id, at: p.at, zone: victim.zone });
    }
    mission.update(0.5, { player: p.at, alive: true, targetVisible: true, interact: p.type === 'destroy' });
    events(); time += 0.5;
  }
  assert.equal(mission.status, 'complete');
  assert.ok(director.stats().totalSpawned > 18);
  assert.ok(director.stats().peakLive <= 10);
});

test('SSR output exposes the mission verbs, actual objective progress, and a normalized countdown', () => {
  const mission = new Mission(getMission('alrasul')); mission.start();
  const at = mission.current.at;
  const snapshot = { ...mission.snapshot(at), waypoint: { x: 50, y: 50, visible: false }, live: 3, targetPressure: 3, totalSpawned: 3 };
  const html = renderToStaticMarkup(React.createElement(MissionObjective, { mission: snapshot }));
  assert.ok(html.includes(mission.current.title));
  assert.ok(html.includes(mission.current.brief));
  assert.match(html, /Current mission objective/);
  assert.match(html, /Sandblast/);
  assert.equal(missionClock(59.9), '01:00');
  assert.equal(missionClock(0), '00:00');
  // The home menu is the sketch layout: title + Missions/Loadout/Settings only.
  // Maps are deliberately NOT shown until the player enters Missions.
  const menu = renderToStaticMarkup(React.createElement(MainMenu, { s: DEFAULT_SETTINGS, onDeploy() {}, onSettings() {}, onMap() {} }));
  assert.ok(menu.includes('RECOIL'));
  assert.ok(menu.includes('Missions'));
  assert.ok(menu.includes('Loadout'));
  assert.ok(menu.includes('Settings'));
  assert.ok(!menu.includes('Sandblast'), 'map selection must not leak onto the home menu');
  assert.ok(!menu.includes('21 HOSTILES'));
  // The cinematic boot screen names the operation and its first objective.
  const boot = renderToStaticMarkup(React.createElement(BootScreen, { map: 'alrasul' }));
  assert.ok(boot.includes(mission.definition.name), 'boot screen names the operation');
  assert.ok(boot.includes(mission.definition.phases[0].title), 'boot screen shows the opening objective');
});