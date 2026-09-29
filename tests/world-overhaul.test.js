import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
installCanvasStub();
const { buildWorld } = await import('../src/game/world.ts');
const { Engine } = await import('../src/game/engine.ts');
const { NavGrid } = await import('../src/game/ai.ts');
const { getMission } = await import('../src/game/systems/mission.ts');
const { MissionMarkers } = await import('../src/game/systems/mission-markers.ts');
const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const fixture = id => buildWorld(new THREE.Scene(), id, Object.fromEntries(keys.map(key => [key, new THREE.MeshStandardMaterial()])));
const budget = group => {
  let draws = 0, triangles = 0;
  group.traverseVisible(o => { if (o.isMesh) { draws++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
  return { draws, triangles };
};
const dispose = world => world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });

for (const id of ['alrasul', 'kasbah']) {
  test(`${id}: all elevated firing positions are climbable with the actual engine capsule/support code`, () => {
    const world = fixture(id);
    const context = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 8, nearSolids: Engine.prototype.nearSolids };
    Engine.prototype.buildSolidGrid.call(context);
    assert.ok(world.overlooks.length >= 6);
    for (const overlook of world.overlooks) {
      const p = overlook.approach.clone();
      for (const target of overlook.route) {
        let steps = 0;
        while (Math.hypot(target.x - p.x, target.z - p.z) > 0.1 && steps++ < 1500) {
          const direction = new THREE.Vector3(target.x - p.x, 0, target.z - p.z).normalize().multiplyScalar(0.08);
          Engine.prototype.moveAxis.call(context, p, direction.x, direction.z, 0.34, 1.7);
          p.y = Engine.prototype.supportHeight.call(context, p, 0.4);
        }
        assert.ok(steps < 1500, `${overlook.name}: stair or landing obstructed at ${p.toArray()}`);
      }
      assert.ok(p.distanceTo(overlook.at) < 0.15, `${overlook.name}: incorrect support height`);
    }
    dispose(world);
  });

  test(`${id}: every complete insertion squad is safe on the real 2m nav grid, before and after demolition`, () => {
    const world = fixture(id), mission = getMission(id);
    for (const changed of [false, true]) {
      if (changed) world.detonate();
      const nav = new NavGrid(world.solids, world.half, world.navigationHeight ?? world.groundHeight);
      for (const site of mission.insertions) {
        assert.ok(Math.hypot(site.at[0] - mission.deployment[0], site.at[2] - mission.deployment[2]) >= 40);
        const [x, y, z] = site.at;
        for (const at of site.members ?? [site.at, [x - 1.2, y, z + 1.2], [x + 1.2, y, z + 1.2]]) {
          assert.ok(nav.free(nav.toCell(at[0]), nav.toCell(at[2])), `${site.id}: blocked member ${at} after=${changed}`);
          assert.ok(!world.solids.some(b => b.minY < at[1] + 1.8 && b.maxY > at[1] + 0.34 && at[0] + 0.36 > b.minX && at[0] - 0.36 < b.maxX && at[2] + 0.36 > b.minZ && at[2] - 0.36 < b.maxZ), `${site.id}: capsule collision`);
          assert.ok(nav.path(new THREE.Vector3(...mission.deployment), new THREE.Vector3(...at)), `${site.id}: disconnected landing`);
        }
      }
    }
    dispose(world);
  });

  test(`${id}: bounded merged geometry, useful cover, landmark silhouette and intact vault/glass contract`, t => {
    const world = fixture(id);
    for (const changed of [false, true]) {
      if (changed) world.detonate();
      const b = budget(world.group);
      assert.ok(b.draws <= 20, `${b.draws} world draws`);
      // DRAW CALLS are the budget that matters and they are still hard-capped at 20:
      // the whole world merges down to one mesh per material, so architectural detail
      // is free at the API level. The triangle ceiling was raised from 112k/65k to
      // 210k/140k in the architecture overhaul — recessed window reveals, stepped
      // parapets, mashrabiya bays, plinths and roof programs cost vertices, not
      // submissions, and a GPU that can run this game at all eats 200k triangles in
      // well under a millisecond. Keep the draw assertion above sacred; this one is a
      // regression tripwire against accidental geometry explosions, not a perf limit.
      assert.ok(b.triangles < (id === 'alrasul' ? 210000 : 140000), `${b.triangles} world triangles`);
      t.diagnostic(`${changed ? 'destroyed' : 'intact'}: ${b.draws} world draws, ${b.triangles} triangles (not an FPS measurement)`);
    }
    assert.ok(world.coverNodes.length >= 25 && world.coverNodes.length <= 40);
    for (const p of world.coverNodes) assert.ok(!world.solids.some(b => b.minY < 1.7 && b.maxY > 0.34 && p.x + 0.5 > b.minX && p.x - 0.5 < b.maxX && p.z + 0.5 > b.minZ && p.z - 0.5 < b.maxZ), 'cover inside solid');
    assert.ok(world.landmarks.some(l => l.at.y >= 24));
    assert.ok(world.windows.filter(w => w.y < 3).length >= 30);
    assert.equal(world.glass.count, world.windows.length);
    for (const w of world.windows) assert.equal(Math.hypot(w.nx, w.nz), 1);
    assert.ok(world.breakGlass(0) instanceof THREE.Vector3);
    assert.equal(world.breakGlass(0), null, 'glass only breaks once');
    dispose(world);
  });
}

test('bridge demolition is idempotent and removes collision, bullets and wood support together', () => {
  const w = fixture('alrasul');
  const ray = new THREE.Raycaster(new THREE.Vector3(48, 3, -10.56), new THREE.Vector3(0, -1, 0));
  const before = ray.intersectObjects(w.occluders, false)[0];
  assert.ok(Math.abs(before.point.y) < 0.01);
  assert.equal(w.groundHeight(48, -10.56), -2.5, 'terrain is the riverbed, never a bridge deck');
  assert.equal(w.navigationHeight(48,-10.56),0);
  const solidCount = w.solids.length;
  assert.equal(w.detonate(), true);
  assert.equal(w.detonate(), false);
  assert.equal(w.solids.length, solidCount, 'no growing collider arrays');
  assert.equal(w.groundHeight(48, -10.56), -2.5);
  assert.ok(ray.intersectObjects(w.occluders, false)[0].point.y < -0.8);
  assert.ok(w.wood.find(b => b.minX === 46).minY > 1000);
  const nav = new NavGrid(w.solids, w.half, w.groundHeight);
  assert.equal(nav.free(nav.toCell(48), nav.toCell(-10)), false, 'wadi rubble is cover, not invisible to nav');
  dispose(w);
});

test('fallen hoist blocks a real lane and defender relay stays inside five-draw marker budget', () => {
  const w = fixture('kasbah');
  const ray = new THREE.Raycaster(new THREE.Vector3(-43, 1, -22), new THREE.Vector3(0, 0, -1), 0, 10);
  assert.equal(ray.intersectObjects(w.occluders, false).length, 0);
  w.detonate();
  assert.ok(ray.intersectObjects(w.occluders, false).length > 0);
  const markers = new MissionMarkers(new THREE.Scene(), w, getMission('kasbah'));
  assert.ok(budget(markers.group).draws <= 5);
  assert.ok(budget(markers.group).triangles <= 640);
  markers.setPhase(getMission('kasbah').phases[3]);
  markers.setContested(true); markers.destroyCache(w);
  assert.equal(markers.cache.visible, false);
  markers.dispose(); dispose(w);
});

// Footstep audio has had a `metal` profile since the audio rewrite, but nothing ever
// returned that surface, so the warehouse's steel decks sounded like the concrete slab
// underneath them. These assert the decks line up with geometry you can actually stand on
// — a deck that drifts off its container is worse than no deck at all, because the player
// hears steel while walking on air.
test('arena: every steel deck sits on geometry the player can actually stand on', () => {
  const world = fixture('arena');
  const context = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 8, nearSolids: Engine.prototype.nearSolids };
  Engine.prototype.buildSolidGrid.call(context);
  assert.ok(world.metalDecks.length >= 6, `expected the container yards and both catwalks to be decked, got ${world.metalDecks.length}`);
  for (const deck of world.metalDecks) {
    const x = (deck.minX + deck.maxX) / 2, z = (deck.minZ + deck.maxZ) / 2;
    const p = new THREE.Vector3(x, deck.maxY, z);
    p.y = Engine.prototype.supportHeight.call(context, p, 0.4);
    // surfaceAt() probes half a metre above the feet.
    assert.ok(p.y + 0.5 >= deck.minY && p.y + 0.5 <= deck.maxY,
      `deck at (${x.toFixed(1)}, ${z.toFixed(1)}) spans y ${deck.minY}–${deck.maxY} but the floor there is ${p.y.toFixed(2)} — footsteps would not read as metal`);
    assert.ok(p.y > 2.2, `deck at (${x.toFixed(1)}, ${z.toFixed(1)}) resolves to ground level (${p.y.toFixed(2)})`);
  }
  dispose(world);
});

test('arena: exterior container yards have mirrored, navigable cover density', () => {
  const world = fixture('arena');
  // Catwalks sit near the warehouse centre. Every remaining metal deck is a
  // container roof, so this catches a return to the empty-yard blockout while
  // proving both teams receive the same elevated choices.
  const yardDecks = world.metalDecks.filter(deck => Math.abs((deck.minX + deck.maxX) / 2) > 20);
  assert.ok(yardDecks.length >= 14, `expected a full pair of exterior container rows, got ${yardDecks.length} decks`);
  for (const deck of yardDecks) {
    const cx = (deck.minX + deck.maxX) / 2, cz = (deck.minZ + deck.maxZ) / 2;
    const mirror = yardDecks.find(other => {
      const ox = (other.minX + other.maxX) / 2, oz = (other.minZ + other.maxZ) / 2;
      return Math.abs(ox + cx) < 0.05 && Math.abs(oz + cz) < 0.05 &&
        Math.abs((other.maxX - other.minX) - (deck.maxX - deck.minX)) < 0.05 &&
        Math.abs((other.maxZ - other.minZ) - (deck.maxZ - deck.minZ)) < 0.05;
    });
    assert.ok(mirror, `container deck at (${cx.toFixed(1)}, ${cz.toFixed(1)}) has no fair opposite-yard match`);
  }
  dispose(world);
});

test('arena: ground level is not steel', () => {
  const world = fixture('arena');
  const inside = (x, y, z, b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
  for (const [x, z] of [[0, 0], [-30, 0], [30, 0], [-38, 20], [38, -20], [0, 30], [0, -30]]) {
    assert.ok(!world.metalDecks.some(d => inside(x, 0.5, z, d)),
      `(${x}, ${z}) at ground level is being reported as a steel deck`);
  }
  dispose(world);
});

test('the other maps carry no steel decks', () => {
  for (const id of ['alrasul', 'kasbah', 'sirocco']) {
    const world = fixture(id);
    assert.equal(world.metalDecks.length, 0, `${id} should have no steel decks`);
    dispose(world);
  }
});
