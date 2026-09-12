import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { buildWorld } = await import('../src/game/world.ts');
const { getMission } = await import('../src/game/systems/mission.ts');
const { MissionMarkers } = await import('../src/game/systems/mission-markers.ts');

function materialFixture() {
  const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash'];
  return Object.fromEntries(keys.map(key => [key, new THREE.MeshStandardMaterial()]));
}

// Ground-level flood fill through actual authored collider bounds, not a straight-line probe.
function reachability(world, start) {
  const cell = 0.5, radius = 0.34;
  const n = Math.ceil(world.half * 2 / cell);
  const blocked = new Uint8Array(n * n);
  const clamp = value => Math.max(0, Math.min(n - 1, value));
  const toCell = value => clamp(Math.floor((value + world.half) / cell));
  const toWorld = value => value * cell - world.half + cell / 2;
  for (const b of world.solids) {
    if (b.maxY <= 0.34 || b.minY >= 1.75) continue;
    const x0 = toCell(b.minX - radius), x1 = toCell(b.maxX + radius);
    const z0 = toCell(b.minZ - radius), z1 = toCell(b.maxZ + radius);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const wx = toWorld(x), wz = toWorld(z);
      if (wx + radius > b.minX && wx - radius < b.maxX && wz + radius > b.minZ && wz - radius < b.maxZ) blocked[z * n + x] = 1;
    }
  }
  const visited = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let tail = 0, head = 0;
  const first = toCell(start[2]) * n + toCell(start[0]);
  assert.equal(blocked[first], 0, 'mission deployment must not start inside a collider');
  queue[tail++] = first; visited[first] = 1;
  while (head < tail) {
    const k = queue[head++], x = k % n, z = Math.floor(k / n);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= n || nz < 0 || nz >= n) continue;
      const next = nz * n + nx;
      if (!visited[next] && !blocked[next]) { visited[next] = 1; queue[tail++] = next; }
    }
  }
  return {
    reaches(at, within) {
      for (let z = toCell(at[2] - within); z <= toCell(at[2] + within); z++) {
        for (let x = toCell(at[0] - within); x <= toCell(at[0] + within); x++) {
          if (visited[z * n + x] && Math.hypot(toWorld(x) - at[0], toWorld(z) - at[2]) <= within) return true;
        }
      }
      return false;
    },
  };
}

for (const id of ['alrasul', 'kasbah']) {
  test(`${id}: Phase 1 objective regions connect to the deployment point without relying on stairs`, () => {
    const scene = new THREE.Scene();
    const world = buildWorld(scene, id, materialFixture());
    const mission = getMission(id);
    const markers = new MissionMarkers(scene, world, mission);
    const spawn = mission.deployment ?? [world.playerSpawn.x, world.playerSpawn.y, world.playerSpawn.z];
    const flood = reachability(world, spawn);
    for (const phase of mission.phases) {
      assert.ok(flood.reaches(phase.at, Math.min(phase.radius, 3)), `${phase.id} is not reachable at ground level`);
    }
    assert.ok(mission.insertions.filter(site => flood.reaches(site.at, 2)).length >= 6, 'need several connected insertion approaches');
    markers.dispose();
    world.group.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
  });
}