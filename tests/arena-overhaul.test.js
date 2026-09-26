import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';

installCanvasStub();
const { buildWorld, arenaZoneAt } = await import('../src/game/world.ts');
const { NavGrid } = await import('../src/game/ai.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const materials = Object.fromEntries(keys.map(key => [key, new THREE.MeshStandardMaterial()]));
const buildPair = id => [
  buildWorld(new THREE.Scene(), id, materials, false),
  buildWorld(new THREE.Scene(), id, materials, true),
];
const solidKey = world => world.solids.map(b => Object.values(b).map(v => v.toFixed(3)).join(',')).sort();
const coverKey = world => world.coverNodes.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
const pointLights = root => { let count = 0; root.traverse(o => { if (o.isPointLight) count++; }); return count; };

test('detail tiers: Warehouse and Sirocco spend triangles, never collision, on ornament', () => {
  for (const id of ['arena', 'sirocco']) {
    const [low, high] = buildPair(id);
    const lowBudget = geometryBudget(low.group), highBudget = geometryBudget(high.group);
    assert.deepEqual(solidKey(high), solidKey(low), `${id}: detail changed a collider`);
    assert.deepEqual(coverKey(high), coverKey(low), `${id}: detail changed bot cover`);
    const lowNav = new NavGrid(low.solids, low.half, low.navigationHeight ?? low.groundHeight);
    const highNav = new NavGrid(high.solids, high.half, high.navigationHeight ?? high.groundHeight);
    assert.deepEqual([...highNav.blocked], [...lowNav.blocked], `${id}: detail changed nav`);
    assert.ok(highBudget.triangles > lowBudget.triangles * 1.2, `${id}: ornament is not worth its high-detail budget`);
    assert.ok(highBudget.draws <= (id === 'sirocco' ? 48 : 27), `${id}: ornament added a draw`);
  }
});

test('Warehouse: the raised combat spaces have two approaches and readable callouts', () => {
  const [, world] = buildPair('arena');
  const elevated = world.overlooks.filter(o => /catwalk|container|flatcar/i.test(o.name));
  assert.equal(elevated.length, 6, 'two hall catwalks, two containers and two flatcars');
  for (const overlook of elevated) {
    assert.ok(overlook.route.length >= 1, `${overlook.name}: no landing route`);
    const groundPath = new NavGrid(world.solids, world.half, world.navigationHeight ?? world.groundHeight).path(overlook.approach, new THREE.Vector3(overlook.route[0].x, 0, overlook.route[0].z));
    assert.ok(groundPath, `${overlook.name}: approach is disconnected`);
  }
  assert.ok(world.landmarks.some(l => l.name === 'Transit shed'));
  assert.ok(world.landmarks.some(l => l.name === 'Goods store'));
  assert.equal(pointLights(world.group), 8, 'Warehouse keeps four pooled work/floodlight pairs');
});

test('Warehouse: every hall doorway leaves a free two-metre nav cell', () => {
  const [world] = buildPair('arena');
  const nav = new NavGrid(world.solids, world.half, world.navigationHeight ?? world.groundHeight);
  for (const x of [-10.5, 10.5]) for (const z of [-10, 10]) {
    assert.ok(nav.free(nav.toCell(x), nav.toCell(z)), `doorway at ${x},${z} is blocked`);
  }
});

test('Warehouse callouts cover the playable square rather than falling through to YARD', () => {
  for (let x = -55; x <= 55; x += 5) for (let z = -55; z <= 55; z += 5) {
    assert.notEqual(arenaZoneAt(x, z), 'YARD', `unnamed callout at ${x},${z}`);
  }
  assert.equal(arenaZoneAt(0, 48), 'ALPHA YARD');
  assert.equal(arenaZoneAt(0, -48), 'BRAVO YARD');
  assert.equal(arenaZoneAt(-49, 0), 'WEST SIDING');
});
