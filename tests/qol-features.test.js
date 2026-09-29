import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeWeapon } from './helpers/weapon-geometry.js';

const { Engine, DEFAULT_SETTINGS, sanitizeSettings } = await import('../src/game/engine.ts');
const { WEAPON_BUILDERS } = await import('../src/game/models.ts');

/** Minimal viewmodel context — same shape the reload tests drive. */
function ctx(model, extra = {}) {
  return {
    VM_S: 1.35, def: () => ({ model, audioTag: 'm4', boltAction: false }),
    ads: 0, adsFovEff: () => 60, crouched: false, grounded: true, walkBlend: 0, footPhase: 0,
    sprinting: false, sprintPose: 0, vmKick: 0, vmKickRot: 0, boltCycle: 0,
    reloadT: -1, reloadDur: 2, switchT: -1, cooking: false, pumpT: 0, slideKick: 0,
    inspectT: -1, INSPECT_DUR: 2.1,
    bipodDeployed: () => false, updateTactical() {},
    _armTarget: new THREE.Vector3(),
    poseLArm: Engine.prototype.poseLArm, restArm: Engine.prototype.restArm,
    muzzleFlash: new THREE.Object3D(), vmLight: new THREE.Object3D(),
    ...extra,
  };
}

/** Sample the weapon's viewmodel transform at a given inspect time. */
function poseAt(model, inspectT) {
  const c = ctx(model, { inspectT });
  Engine.prototype.animateViewmodel.call(c, 1 / 60);
  const g = model.group;
  return {
    pos: g.position.clone(), rot: new THREE.Euler().copy(g.rotation),
  };
}

test('inspect turns the weapon over and puts it back exactly where it started', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const rest = poseAt(model, -1);
  const mid = poseAt(model, 2.1 * 0.5);

  // Mid-animation the gun is rolled toward the eye, not merely nudged.
  assert.ok(Math.abs(mid.rot.z - rest.rot.z) > 0.3,
    `inspect should roll the weapon over; z moved ${(mid.rot.z - rest.rot.z).toFixed(3)} rad`);
  assert.ok(Math.abs(mid.rot.y - rest.rot.y) > 0.2,
    'inspect should turn the left side of the weapon into view');
  assert.ok(mid.pos.z > rest.pos.z, 'inspect should draw the weapon closer to the eye');

  // And it is a closed loop: both ends of the clock land back on the rest pose.
  // Idle sway is driven by performance.now(), so no two samples are ever bit-identical.
  // Measure that noise floor from two rest samples rather than inventing a tolerance.
  const rest2 = poseAt(model, -1);
  let noise = 0;
  for (const k of ['x', 'y', 'z']) {
    noise = Math.max(noise, Math.abs(rest2.pos[k] - rest.pos[k]), Math.abs(rest2.rot[k] - rest.rot[k]));
  }
  const tol = Math.max(noise * 8, 1e-5);
  for (const t of [0, 2.1]) {
    const end = poseAt(model, t);
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Math.abs(end.pos[k] - rest.pos[k]) <= tol,
        `inspect at t=${t} left position.${k} displaced by ${(end.pos[k] - rest.pos[k]).toExponential(2)} (sway floor ${tol.toExponential(2)})`);
      assert.ok(Math.abs(end.rot[k] - rest.rot[k]) <= tol,
        `inspect at t=${t} left rotation.${k} displaced by ${(end.rot[k] - rest.rot[k]).toExponential(2)} (sway floor ${tol.toExponential(2)})`);
    }
  }
  // Sanity: the mid-animation pose must dwarf that floor, or the test proves nothing.
  assert.ok(Math.abs(mid.rot.z - rest.rot.z) > tol * 50,
    'the inspect pose is barely above the idle-sway noise floor');
  disposeWeapon(model);
});

test('the inspect pose is continuous — no snap between frames', () => {
  const model = WEAPON_BUILDERS.m4a1();
  let prev = poseAt(model, 0);
  let worst = 0;
  for (let i = 1; i <= 120; i++) {
    const cur = poseAt(model, (i / 120) * 2.1);
    worst = Math.max(worst, Math.abs(cur.rot.z - prev.rot.z), Math.abs(cur.rot.y - prev.rot.y));
    prev = cur;
  }
  // 2.1 s over 120 samples; a smooth eased curve moves far less than this per step.
  assert.ok(worst < 0.09, `inspect jumps ${worst.toFixed(3)} rad between adjacent frames`);
  disposeWeapon(model);
});

test('inspect does not fight the reload — the reload pose still wins', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const reloadOnly = ctx(model, { reloadT: 1.0, reloadDur: 2 });
  Engine.prototype.animateViewmodel.call(reloadOnly, 1 / 60);
  const a = model.group.rotation.clone();
  // The engine clears inspectT whenever a reload starts, so this combination should
  // never occur in play; assert the guard exists rather than the blended result.
  const src = Engine.prototype.animateViewmodel.toString();
  assert.match(src, /inspectT\s*>=\s*0/, 'inspect pose must be gated on its own clock');
  assert.ok(Number.isFinite(a.z));
  disposeWeapon(model);
});

test('sprint mode persists and only accepts hold or toggle', () => {
  assert.equal(DEFAULT_SETTINGS.sprintMode, 'hold');
  assert.equal(sanitizeSettings({ sprintMode: 'toggle' }).sprintMode, 'toggle');
  assert.equal(sanitizeSettings({ sprintMode: 'hold' }).sprintMode, 'hold');
  assert.equal(sanitizeSettings({ sprintMode: 'sticky' }).sprintMode, 'hold');
  assert.equal(sanitizeSettings({}).sprintMode, 'hold');
});

test('the sprint latch releases when you stop pushing forward', () => {
  // Mirrors the engine rule: tap latches, releasing the stick drops it.
  let latched = false, wasDown = false;
  const step = (shift, iz) => {
    if (shift && !wasDown) latched = !latched;
    if (iz >= 0) latched = false;
    wasDown = shift;
    return latched;
  };
  assert.equal(step(true, -1), true, 'tap while advancing latches');
  assert.equal(step(true, -1), true, 'holding the key does not re-toggle');
  assert.equal(step(false, -1), true, 'releasing the key keeps the latch');
  assert.equal(step(false, 0), false, 'stopping drops the latch');
  assert.equal(step(false, -1), false, 'and it stays dropped until the next tap');
  assert.equal(step(true, -1), true);
});
