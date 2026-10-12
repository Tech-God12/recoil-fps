import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
installCanvasStub();
const { buildWorld } = await import('../src/game/world.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood',
  'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth',
  'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage', 'dirtPath'];
const mats = () => Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()]));

/** Every triangle in the built world, in world space. */
function triangles(world) {
  const out = [];
  world.group.updateWorldMatrix(true, true);
  world.group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = o.geometry;
    const pos = g.attributes?.position;
    if (!pos) return;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      out.push([a.clone(), b.clone(), c.clone()]);
    }
  });
  return out;
}

const centroid = t => ({
  x: (t[0].x + t[1].x + t[2].x) / 3,
  y: (t[0].y + t[1].y + t[2].y) / 3,
  z: (t[0].z + t[1].z + t[2].z) / 3,
});


/**
 * Height of the first visible surface looking straight down at (x, z).
 * Starts below head height on purpose: from above it would just find the roof.
 */
function visibleFloorAt(world, x, z, fromY = 2.2) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, fromY + 10);
  const meshes = [];
  world.group.traverse(o => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
  const hits = ray.intersectObjects(meshes, false);
  return hits.length ? hits[0].point.y : null;
}

/** Height the player actually stands at (x, z): the top of any solid under foot. */
function walkableAt(world, x, z) {
  let y = 0; // terrain
  for (const s of world.solids) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    if (s.maxY > 2.2 || s.maxY < -0.5) continue; // walls and ceilings are not floors
    y = Math.max(y, s.maxY);
  }
  return y;
}

let cached = null;
const alrasul = () => (cached ??= { w: buildWorld(new THREE.Scene(), 'alrasul', mats()), get tris() { return (this._t ??= triangles(this.w)); } });

// The house the player meets first on alrasul: spawn is at (-12, 0, 94) and
// this one sits just off the insertion road at (1, 82), 10 x 12, door east.
const HOUSE = { cx: 1, cz: 82, w: 10, d: 12 };

test('the floor you see inside a building is the floor you stand on', () => {
  // The complaint this guards, in the player's words: "the floor is too high
  // when I go inside". The base moulding used to be a solid box spanning the
  // whole footprint from y=0 to y=0.65. It does not collide, so the player
  // walked at terrain level - buried two feet inside the visible floor, with
  // every sill and doorway reading that much too high.
  const world = alrasul().w;
  for (const [x, z] of [
    [HOUSE.cx, HOUSE.cz],
    [HOUSE.cx - 2.5, HOUSE.cz - 3],
    [HOUSE.cx + 2.5, HOUSE.cz + 3],
    [HOUSE.cx + 2.5, HOUSE.cz - 3],
  ]) {
    const seen = visibleFloorAt(world, x, z);
    const stand = walkableAt(world, x, z);
    assert.ok(seen !== null, `nothing to stand on at (${x}, ${z})`);
    assert.ok(Math.abs(seen - stand) < 0.15,
      `at (${x}, ${z}) the visible floor is at ${seen.toFixed(2)} m but the player stands at ${stand.toFixed(2)} m - ` +
      `a ${Math.abs(seen - stand).toFixed(2)} m mismatch, so you are standing inside the floor`);
  }
});

test('stepping through the door does not change your floor height', () => {
  const world = alrasul().w;
  const doorX = HOUSE.cx + HOUSE.w / 2;
  const heights = [doorX + 1.6, doorX + 0.3, doorX - 1.2].map(x => visibleFloorAt(world, x, HOUSE.cz));
  for (const h of heights) assert.ok(h !== null, 'the doorway has no ground under it');
  const spread = Math.max(...heights) - Math.min(...heights);
  assert.ok(spread < 0.2,
    `the floor jumps ${spread.toFixed(2)} m walking through the doorway (${heights.map(h => h.toFixed(2)).join(' -> ')})`);
});

test('a doorway is clear all the way to the ground, so you walk through it', () => {
  // The east doorway of the house: the wall runs in z, the hole is centred on
  // the wall and 2.4 m wide, and the leaf is hung open against the inside.
  const tris = alrasul().tris;
  const doorX = HOUSE.cx + HOUSE.w / 2;
  const blocked = [];
  for (const t of tris) {
    const c = centroid(t);
    if (Math.abs(c.x - doorX) > 0.55) continue;           // in the wall plane
    if (Math.abs(c.z - HOUSE.cz) > 0.7) continue;          // in the middle of the opening
    if (c.y < 0.14 || c.y > 2.3) continue;                 // above the threshold slab
    blocked.push(c);
  }
  assert.equal(blocked.length, 0,
    `the doorway is filled in at ${blocked.length} triangles - a door you walk through must not be a door that looks shut ` +
    blocked.slice(0, 3).map(c => `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`).join(' '));
});

test('the door leaf still exists, hung open inside the room', () => {
  // Clearing the opening by deleting the door would also pass the test above.
  const tris = alrasul().tris;
  const doorX = HOUSE.cx + HOUSE.w / 2;
  let leaf = 0;
  for (const t of tris) {
    const c = centroid(t);
    // Just inside the wall, beside the opening, at door height.
    if (c.x > doorX - 0.2 || c.x < doorX - 2.6) continue;
    if (Math.abs(c.z - HOUSE.cz) > 2.2) continue;
    if (c.y < 0.3 || c.y > 2.2) continue;
    leaf++;
  }
  assert.ok(leaf > 0, 'the doorway has no door at all - it should be open, not missing');
});

test('streets read as roads: kerbs and markings, not a bare quad', () => {
  // The insertion road on alrasul runs along x = -12 from z = 16 to z = 102.
  // Count vertices rather than triangle centroids: a kerb is one long box, so
  // its centroids all bunch at the midpoint and tell you nothing.
  const world = alrasul().w;
  world.group.updateWorldMatrix(true, true);
  const half = 5;
  let kerbLeft = 0, kerbRight = 0, marking = 0;
  const v = new THREE.Vector3();
  world.group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const pos = o.geometry.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.z < 14 || v.z > 104) continue;
      const off = v.x + 12;
      if (v.y > 0.1 && v.y < 0.2) {
        if (Math.abs(off + (half - 0.13)) < 0.3) kerbLeft++;
        if (Math.abs(off - (half - 0.13)) < 0.3) kerbRight++;
      }
      if (v.y > 0.03 && v.y < 0.08 && Math.abs(off) < 0.25) marking++;
    }
  });
  assert.ok(kerbLeft > 0 && kerbRight > 0, `the carriageway needs a kerb on both sides (left ${kerbLeft}, right ${kerbRight})`);
  assert.ok(marking > 8, `the carriageway has no centre markings (${marking} vertices)`);
});

test('nothing the road adds is allowed to block movement', () => {
  // Kerbs and markings are scenery. A 14 cm lip that stops a sprint dead at
  // the roadside would be worse than no kerb at all.
  const world = alrasul().w;
  for (const s of world.solids) {
    if (s.maxY > 0.5 || s.maxY <= 0) continue;
    // Only the insertion road: x -17..-7, z 16..102.
    if (s.maxZ < 16 || s.minZ > 102) continue;
    const spansRoad = s.minX < -6.5 && s.maxX > -17.5;
    assert.ok(!spansRoad, `a low solid spans the carriageway at z ${s.minZ.toFixed(1)}..${s.maxZ.toFixed(1)}`);
  }
});

test('every map still builds, and the houses did not take the interiors with them', () => {
  for (const id of ['alrasul', 'kasbah', 'arena', 'sirocco']) {
    const w = buildWorld(new THREE.Scene(), id, mats());
    assert.ok(w.solids.length > 0, `${id} built no collision`);
    assert.ok(w.group.children.length > 0, `${id} built no geometry`);
    w.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
});
