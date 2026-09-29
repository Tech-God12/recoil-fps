import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
installCanvasStub();
const { buildWorld } = await import('../src/game/world.ts');
const { NavGrid } = await import('../src/game/ai.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage', 'dirtPath'];
const mats = () => Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()]));
const build = (id, detail) => buildWorld(new THREE.Scene(), id, mats(), { detail });
const dispose = w => w.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });

const budget = g => {
  let draws = 0, tris = 0;
  g.traverseVisible(o => {
    if (!o.isMesh) return;
    draws++;
    tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
  });
  return { draws, tris };
};
const key = b => `${b.minX.toFixed(4)},${b.minY.toFixed(4)},${b.minZ.toFixed(4)},${b.maxX.toFixed(4)},${b.maxY.toFixed(4)},${b.maxZ.toFixed(4)}`;
const MAPS = ['alrasul', 'kasbah', 'arena', 'sirocco'];
/** Maps that actually author ornament geometry. The others batch everything as solids. */
const ORNAMENTED = ['arena', 'sirocco'];

// THE CONTRACT: dropping ornament must not move a single thing the game simulates.
// This is guaranteed by construction (dressing() geometry never reaches solids, cover,
// occluders or nav) but a guarantee nobody checks is a guarantee nobody keeps.
for (const id of MAPS) {
  test(`${id}: low detail changes nothing the game simulates`, () => {
    const hi = build(id, 'high');
    const lo = build(id, 'low');

    assert.deepEqual(
      lo.solids.map(key).sort(), hi.solids.map(key).sort(),
      `${id}: collision geometry differs between detail levels`);

    assert.deepEqual(
      lo.coverNodes.map(v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`).sort(),
      hi.coverNodes.map(v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`).sort(),
      `${id}: cover nodes differ between detail levels`);

    for (const f of ['interiors', 'concrete', 'wood', 'metalDecks']) {
      assert.deepEqual(lo[f].map(key).sort(), hi[f].map(key).sort(), `${id}: ${f} differs between detail levels`);
    }

    // Bot pathing: every blocked cell must agree, or low-detail players and high-detail
    // players are not playing the same map.
    const navHi = new NavGrid(hi.solids, hi.half, hi.navigationHeight ?? hi.groundHeight);
    const navLo = new NavGrid(lo.solids, lo.half, lo.navigationHeight ?? lo.groundHeight);
    let differing = 0;
    for (let x = 0; x < navHi.size; x++) {
      for (let z = 0; z < navHi.size; z++) if (navHi.blocked(x, z) !== navLo.blocked(x, z)) differing++;
    }
    assert.equal(differing, 0, `${id}: ${differing} navigation cells differ between detail levels`);

    assert.equal(lo.playerSpawn.distanceTo(hi.playerSpawn), 0, `${id}: spawn moved`);
    assert.equal(lo.overlooks.length, hi.overlooks.length, `${id}: overlooks differ`);
    dispose(hi); dispose(lo);
  });
}

test('low detail actually buys something on the maps that use ornament', () => {
  for (const id of ORNAMENTED) {
    const hi = build(id, 'high');
    const lo = build(id, 'low');
    const h = budget(hi.group), l = budget(lo.group);
    // Ornament is merged per material into its own unshadowed mesh, so the saving shows
    // up as DRAW CALLS rather than triangles — which is the number that actually costs
    // frame time.
    //
    // The bar is per map because Sirocco has a hard floor the Warehouse does not:
    // bomb-site paint, the site letters and the lane arrows are wayfinding, not
    // ornament, so they are drawn at every tier. Culling them once made the sites
    // completely unmarked at low detail. Seven objective materials therefore survive
    // into the low build and cap the achievable saving at roughly a fifth.
    const bar = id === 'sirocco' ? 0.85 : 0.75;
    assert.ok(l.draws <= h.draws * bar,
      `${id}: low detail only cut draws ${h.draws} -> ${l.draws}; the setting is not earning its place`);
    assert.ok(l.tris <= h.tris, `${id}: low detail must never add triangles`);
    dispose(hi); dispose(lo);
  }
});

test('the maps that author no ornament are honestly unaffected', () => {
  // Sandblast and Town push everything through the batched solid path, so the detail
  // setting is a no-op there. Asserting it keeps the claim honest: if someone later adds
  // dressing() to those maps, this test fails and the docs have to be updated.
  for (const id of MAPS.filter(m => !ORNAMENTED.includes(m))) {
    const hi = build(id, 'high');
    const lo = build(id, 'low');
    assert.equal(budget(lo.group).draws, budget(hi.group).draws,
      `${id} now has ornament geometry — add it to ORNAMENTED and update the settings copy`);
    dispose(hi); dispose(lo);
  }
});

// The batching trap: a material that comes back undefined silently becomes three.js's
// default white MeshBasicMaterial, which cannot batch and costs a whole extra draw call.
test('no map ever renders with a default material', () => {
  for (const id of MAPS) {
    for (const detail of ['low', 'high']) {
      const w = build(id, detail);
      const bad = [];
      // three.js substitutes `new MeshBasicMaterial()` when a mesh is built with an
      // undefined material. Match it on the fields that distinguish the implicit
      // fallback from a deliberately-authored white decal material (which is textured
      // or transparent, and therefore white on purpose).
      const isImplicitFallback = m =>
        m.type === 'MeshBasicMaterial' && m.name === '' &&
        m.color?.getHex() === 0xffffff &&
        !m.map && !m.vertexColors && m.transparent === false && m.opacity === 1;
      w.group.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) { bad.push(`${o.name || '(unnamed)'}: null material`); continue; }
          if (isImplicitFallback(m)) bad.push(`${o.name || '(unnamed)'}: implicit default material`);
        }
      });
      assert.deepEqual(bad, [], `${id}/${detail} has un-batchable default materials`);
      dispose(w);
    }
  }
});
