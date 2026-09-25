import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';

installCanvasStub();
const { buildWorld } = await import('../src/game/world.ts');
const { NavGrid } = await import('../src/game/ai.ts');
const L = await import('../src/game/maps/sirocco.ts');
const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const world = buildWorld(new THREE.Scene(), 'sirocco', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));
const nav = new NavGrid(world.solids, world.half, world.navigationHeight ?? world.groundHeight);

function flood(fromX, fromZ) {
  const n = nav.n, seen = new Uint8Array(n * n), q = [nav.toCell(fromX) + nav.toCell(fromZ) * n];
  seen[q[0]] = 1;
  while (q.length) {
    const c = q.pop(), cx = c % n, cz = (c / n) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const k = z * n + x;
      if (seen[k] || nav.blocked[k]) continue;
      seen[k] = 1; q.push(k);
    }
  }
  return seen;
}
const reach = flood(0, 35);
const clear = (x, z, r = 0.42) => !world.solids.some(b => b.minY < 1.7 && b.maxY > 0.5 && x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ);
const V = (x, z) => new THREE.Vector3(x, 0, z);
const pathLen = (a, b) => {
  const p = nav.path(V(...a), V(...b));
  if (!p) return Infinity;
  let len = 0, prev = V(...a);
  for (const q of p) { len += prev.distanceTo(q); prev = q; }
  return len;
};

test('Sirocco is an 88 m square with a bounded, merged geometry budget', () => {
  assert.equal(world.half, 44);
  const { draws, triangles } = geometryBudget(world.group);
  assert.ok(draws <= 48, `${draws} draw calls`);
  assert.ok(triangles < 120000, `${triangles} triangles`);
  assert.ok(world.solids.length > 60, 'building mass and props collide');
  assert.ok(world.interiors.some(b => b.minX >= 31 && b.maxX <= 42), 'B tunnels are an interior (echo, overhead cover)');
});

test('every walkable cell is one connected space — no sealed pockets', () => {
  let free = 0, reached = 0;
  for (let i = 0; i < nav.n * nav.n; i++) if (!nav.blocked[i]) { free++; if (reach[i]) reached++; }
  assert.ok(free > 500);
  assert.equal(reached, free);
});

test('every authored AI point is physically clear and sits on reachable nav', () => {
  const pts = [];
  for (const side of ['attack', 'defend']) L.SPAWNS[side].forEach((p, i) => pts.push([`spawn ${side}${i}`, p]));
  for (const id of ['A', 'B']) {
    const s = L.SITES[id];
    s.plantSpots.forEach((p, i) => pts.push([`plant ${id}${i}`, p]));
    s.postPlant.forEach((p, i) => pts.push([`post-plant ${id}${i}`, p.at]));
    s.retakeStage.forEach((p, i) => pts.push([`retake stage ${id}${i}`, p]));
    s.retakeClear.forEach((p, i) => pts.push([`retake clear ${id}${i}`, p]));
    s.execSmokes.forEach((p, i) => assert.ok(L.isOpen(p[0], p[1]), `exec smoke ${id}${i} lands in open ground`));
  }
  L.ATTACK_ROUTES.forEach(r => r.points.forEach((p, i) => pts.push([`route ${r.lane}${i}`, p])));
  L.CONTROL_SPOTS.forEach(c => pts.push([`control ${c.lane}`, c.at]));
  Object.values(L.DEFENSE_POSTS).forEach(p => pts.push([`post ${p.id}`, p.at]));
  for (const [label, [x, z]] of pts) {
    assert.ok(clear(x, z), `${label} (${x},${z}) is inside geometry`);
    const [fx, fz] = nav.nearestFree(nav.toCell(x), nav.toCell(z));
    assert.ok(reach[fz * nav.n + fx], `${label} is unreachable`);
    assert.ok(Math.hypot(nav.toWorld(fx) - x, nav.toWorld(fz) - z) < 2.4, `${label} is far from walkable nav`);
  }
});

test('plant spots lie inside their painted bomb zone; spawns inside their buy zone', () => {
  for (const id of ['A', 'B']) for (const [x, z] of L.SITES[id].plantSpots) assert.equal(L.siteAt(x, z), id);
  for (const side of ['attack', 'defend']) for (const [x, z] of L.SPAWNS[side]) assert.ok(L.inRect(x, z, L.BUY_ZONES[side]));
  assert.equal(L.siteAt(0, 0), null);
  assert.equal(L.siroccoZoneAt(-34, 0), 'A LONG');
  assert.equal(L.siroccoZoneAt(36.5, 10), 'B TUNNELS');
  assert.equal(L.siroccoZoneAt(0, -3.5), 'MID DOORS');
});

test('defenders rotate faster than attackers can arrive (CS asymmetry)', () => {
  const tA = pathLen([0, 35], L.SITES.A.center), tB = pathLen([0, 35], L.SITES.B.center);
  const cA = pathLen([0, -36], L.SITES.A.center), cB = pathLen([0, -36], L.SITES.B.center);
  for (const len of [tA, tB, cA, cB]) assert.ok(Number.isFinite(len));
  assert.ok(cA < tA * 0.55 && cB < tB * 0.55, `CT ${cA.toFixed(0)}/${cB.toFixed(0)} m vs T ${tA.toFixed(0)}/${tB.toFixed(0)} m`);
  assert.ok(tA < 120 && tB < 120, 'attackers reach a site well inside the round clock');
});

test('no spawn-to-spawn sightline down mid', () => {
  const ray = new THREE.Raycaster();
  for (const [ax, az] of L.SPAWNS.attack) for (const [dx, dz] of L.SPAWNS.defend) {
    const a = new THREE.Vector3(ax, 1.62, az), d = new THREE.Vector3(dx, 1.62, dz);
    const dir = d.clone().sub(a);
    const dist = dir.length();
    ray.set(a, dir.normalize());
    ray.far = dist;
    assert.ok(ray.intersectObjects(world.occluders, false).length > 0, `T pad ${ax},${az} can see CT pad ${dx},${dz}`);
  }
});
