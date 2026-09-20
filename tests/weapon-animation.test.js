import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeWeapon } from './helpers/weapon-geometry.js';

const { Engine } = await import('../src/game/engine.ts');
const { WEAPON_BUILDERS } = await import('../src/game/models.ts');
const { attach } = await import('../src/game/attachments.ts');
const { attachmentById } = await import('../src/game/economy/catalog.ts');

function animationContext(model, audioTag) {
  return {
    VM_S: 1.95, def: () => ({ model, audioTag, boltAction: false }),
    ads: 0, adsFovEff: () => 60, crouched: false, grounded: true, walkBlend: 0, footPhase: 0,
    sprinting: false, sprintPose: 0, vmKick: 0, vmKickRot: 0, boltCycle: 0,
    reloadT: -1, reloadDur: 2, switchT: -1, cooking: false, pumpT: 0, slideKick: 0,
    bipodDeployed: () => false, poseLArm() {}, updateTactical() {},
    muzzleFlash: new THREE.Object3D(), vmLight: new THREE.Object3D(),
  };
}

test('M249 reload opens the cover around a fixed hinge, never translating it off the gun', () => {
  const model = WEAPON_BUILDERS.m249();
  const context = animationContext(model, 'lmg');
  const home = model.chargingHandle.position.clone();
  context.reloadT = 1;
  Engine.prototype.animateViewmodel.call(context, 1 / 60);
  assert.ok(model.chargingHandle.rotation.x < -0.8);
  assert.deepEqual(model.chargingHandle.position.toArray(), home.toArray());
  context.reloadT = -1;
  for (let i = 0; i < 60; i++) Engine.prototype.animateViewmodel.call(context, 1 / 60);
  assert.ok(Math.abs(model.chargingHandle.rotation.x) < 0.001);
  assert.deepEqual(model.chargingHandle.position.toArray(), home.toArray());
  disposeWeapon(model);
});

test('both pistol slides cycle while the mounted sight follows the same movement', () => {
  for (const [id, tag] of [['m1911', 'pistol'], ['deagle', 'deagle']]) {
    const model = WEAPON_BUILDERS[id]();
    attach(model, attachmentById('opt_pistol_rmr'), id);
    const context = animationContext(model, tag); context.slideKick = 1;
    Engine.prototype.animateViewmodel.call(context, 1 / 60);
    assert.ok(model.chargingHandle.position.z > 0.01, `${id} slide never cycles`);
    const optic = model.attached.optic.getWorldPosition(new THREE.Vector3());
    const mount = model.sockets.optic.getWorldPosition(new THREE.Vector3());
    assert.ok(optic.distanceTo(mount) < 1e-8, `${id} optic leaves its slide`);
    for (let i = 0; i < 20; i++) Engine.prototype.animateViewmodel.call(context, 1 / 60);
    assert.equal(model.chargingHandle.position.z, model.chargingHandle.userData.homeZ);
    disposeWeapon(model);
  }
});

test('AWM bolt returns home after cycling in loadout and legacy arsenal modes', () => {
  for (const explicitBoltAction of [true, undefined]) {
    const model = WEAPON_BUILDERS.awm(), context = animationContext(model, 'sniper');
    context.def = () => ({ model, audioTag: 'sniper', boltAction: explicitBoltAction });
    context.cur = 3; context.boltCycle = 0.5;
    Engine.prototype.animateViewmodel.call(context, 1 / 60);
    assert.ok(model.chargingHandle.position.z > 0.025);
    context.boltCycle = 0;
    Engine.prototype.animateViewmodel.call(context, 1 / 60);
    assert.equal(model.chargingHandle.position.z, model.chargingHandle.userData.homeZ);
    disposeWeapon(model);
  }
});

test('bipod legs fold forward on their hinges instead of sweeping sideways through the receiver', () => {
  const model = WEAPON_BUILDERS.scar_h();
  attach(model, attachmentById('ub_bipod'), 'scar_h');
  const context = animationContext(model, 'scar');
  const legs = model.attached.underbarrel.userData.legs;
  const pivots = legs.map(leg => leg.position.toArray());
  context.bipodDeployed = () => true;
  for (let i = 0; i < 60; i++) Engine.prototype.animateViewmodel.call(context, 1 / 60);
  assert.ok(legs.every(leg => Math.abs(leg.rotation.x) < 0.001));
  context.bipodDeployed = () => false;
  for (let i = 0; i < 60; i++) Engine.prototype.animateViewmodel.call(context, 1 / 60);
  legs.forEach((leg, i) => {
    assert.ok(Math.abs(leg.rotation.x - Math.PI / 2) < 0.001);
    assert.ok(Math.abs(leg.rotation.z) <= 0.12);
    assert.deepEqual(leg.position.toArray(), pivots[i]);
  });
  disposeWeapon(model);
});
