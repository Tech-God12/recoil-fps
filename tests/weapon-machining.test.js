import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeWeapon } from './helpers/weapon-geometry.js';
const { GunBuilder } = await import('../src/game/weapons/geometry.ts');
const { WEAPON_BUILDERS, WM } = await import('../src/game/models.ts');

function makePocket() {
  const b = new GunBuilder(), group = new THREE.Group();
  b.name('machining regression block').box(.040, .070, .120, WM.darkSteel, 0, 0, 0)
    .mill([{x:.021,y:0,z:0,w:.008,h:.020,d:.050,radius:.0015}]);
  b.build(group); group.updateMatrixWorld(true);
  return group;
}

test('blind milling removes actual face geometry and shades the newly exposed cavity', () => {
  const group = makePocket(), mesh = group.children[0];
  const ray = new THREE.Raycaster(new THREE.Vector3(.080,0,0),new THREE.Vector3(-1,0,0),0,.2);
  const hit = ray.intersectObject(group,true)[0];
  assert.ok(hit.point.x < .018, 'a painted rectangle would still intersect at the original .020 face');
  assert.ok(hit.point.x > .015, 'a blind pocket must retain a floor');
  const values = mesh.geometry.attributes.weaponCavity.array;
  assert.ok(Array.from(values).some(v=>v < .5));
  assert.ok(Array.from(values).some(v=>v > .99));
  assert.equal(mesh.geometry.userData.pieces.length, 1, 'machining retains one named continuous source solid');
  mesh.geometry.dispose();
});

test('cached machining returns independently owned geometry and finite attributes', () => {
  const first = makePocket(), second = makePocket();
  const a = first.children[0].geometry, b = second.children[0].geometry;
  assert.notEqual(a.attributes.position.array, b.attributes.position.array);
  const original = b.attributes.position.getX(0);
  a.attributes.position.setX(0, 999);
  assert.equal(b.attributes.position.getX(0), original);
  for (const attribute of Object.values(b.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite));
  a.dispose(); b.dispose();
});

test('M416 and SCAR differ in receiver cross-section and stock structure, not just finish colour', () => {
  const ar = WEAPON_BUILDERS.m4a1(), scar = WEAPON_BUILDERS.scar_h();
  const frontSurface = (model, y) => {
    model.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(-.20,y,-.110),new THREE.Vector3(1,0,0),0,.4);
    const hit = ray.intersectObject(model.group,true).find(hit=>hit.object.material.name!=='receiver engravings');
    assert.ok(hit); return Math.abs(hit.point.x);
  };
  try {
    assert.ok(frontSurface(ar,.020) - frontSurface(ar,.034) > .002, 'AR upper has a genuinely rounded bolt tunnel');
    assert.ok(Math.abs(frontSurface(scar,.020) - frontSurface(scar,.034)) < .001, 'SCAR has a broad monolithic sidewall');
    const ray = new THREE.Raycaster(new THREE.Vector3(-.20,-.028,.181),new THREE.Vector3(1,0,0),0,.4);
    assert.equal(ray.intersectObject(ar.removable.stock[0],true).length,0, 'AR stock has a real triangular void');
    assert.ok(ray.intersectObject(scar.removable.stock[0],true).length>0, 'SCAR boot is a different solid moulding');
  } finally { disposeWeapon(ar); disposeWeapon(scar); }
});
