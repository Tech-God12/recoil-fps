import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
installCanvasStub();
const { buildWorld } = await import('../src/game/world.ts');
const { SITES, SIROCCO_OPEN, inRect } = await import('../src/game/maps/sirocco.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal',
  'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal',
  'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage', 'dirtPath'];
const mats = () => Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()]));
const build = detail => buildWorld(new THREE.Scene(), 'sirocco', mats(), { detail });
const dispose = w => w.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });

/** Unshadowed decal meshes — the batch that objective paint merges into. */
function decalTriangles(world) {
  let tris = 0;
  world.group.traverse(o => {
    if (!o.isMesh || o.castShadow) return;
    const g = o.geometry;
    if (!g?.attributes?.position) return;
    tris += (g.index?.count ?? g.attributes.position.count) / 3;
  });
  return tris;
}

// This is the regression that made the map unplayable: bomb-site paint, the site
// letters and the lane arrows were all authored with dressing(), and dressing() is
// deleted outright at low detail. Turning graphics down removed every marking on the
// map, so there was genuinely nothing on screen telling you where the sites were.
test('objective markings survive every detail tier', () => {
  const hi = build('high'), lo = build('low');
  const hiTris = decalTriangles(hi), loTris = decalTriangles(lo);
  assert.ok(hiTris > 0, 'high detail draws decals');
  assert.ok(loTris > 0, 'low detail still draws the objective paint');
  dispose(hi); dispose(lo);
});

test('both sites carry lit corner pylons that are real geometry, not decals', () => {
  for (const detail of ['high', 'low']) {
    const w = build(detail);
    for (const id of ['A', 'B']) {
      const z = SITES[id].zone;
      // Four pylon heads are pushed as light spots, one per zone corner.
      const near = w.lightSpots.filter(p => p.y > 3 && inRect(p.x, p.z, z, 1.2));
      assert.equal(near.length, 4, `${detail}: site ${id} has four lit pylons`);
    }
    dispose(w);
  }
});

test('every plant spot lies inside its own painted zone', () => {
  for (const id of ['A', 'B']) {
    const s = SITES[id];
    for (const [x, z] of s.plantSpots) {
      assert.ok(inRect(x, z, s.zone), `site ${id} plant spot ${x},${z} is inside the paint`);
    }
    assert.ok(inRect(s.center[0], s.center[1], s.zone), `site ${id} centre is inside the paint`);
  }
});

test('the two sites do not overlap and both sit in a walkable area', () => {
  const a = SITES.A.zone, b = SITES.B.zone;
  const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
  assert.equal(overlap, false, 'A and B are separate places');
  for (const id of ['A', 'B']) {
    const c = SITES[id].center;
    assert.ok(SIROCCO_OPEN.some(o => inRect(c[0], c[1], o.rect)), `site ${id} centre is on walkable ground`);
  }
});
