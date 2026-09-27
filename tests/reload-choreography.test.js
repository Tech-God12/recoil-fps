import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeWeapon } from './helpers/weapon-geometry.js';

const { Engine } = await import('../src/game/engine.ts');
const { WEAPON_BUILDERS } = await import('../src/game/models.ts');

/**
 * One universal magwell-exchange animation used to play for every weapon, so a belt-fed
 * SAW, a pump shotgun and a bolt rifle all mimed a magazine change none of them has.
 * These assert that each weapon's support hand now does what its actual mechanism does.
 */

const STYLE = {
  m4a1: 'ar', scar_h: 'ar', aug_a3: 'ar', ak47: 'ak', mp7: 'smg',
  vector: 'gripfed', m1911: 'pistol', deagle: 'pistol',
  awm: 'bolt', spas12: 'tube', m249: 'belt',
};

const ANCHOR = {
  m4a1: 'm4', ak47: 'ak', aug_a3: 'aug', scar_h: 'scar', mp7: 'smg', vector: 'vector',
  m249: 'lmg', awm: 'sniper', spas12: 'shotgun', m1911: 'pistol', deagle: 'deagle',
};

function context(model, audioTag) {
  return {
    VM_S: 1.35, def: () => ({ model, audioTag, boltAction: audioTag === 'sniper' }),
    ads: 0, adsFovEff: () => 60, crouched: false, grounded: true, walkBlend: 0, footPhase: 0,
    sprinting: false, sprintPose: 0, vmKick: 0, vmKickRot: 0, boltCycle: 0,
    reloadT: -1, reloadDur: 2, switchT: -1, cooking: false, pumpT: 0, slideKick: 0,
    inspectT: -1, INSPECT_DUR: 2.1,
    bipodDeployed: () => false, updateTactical() {},
    _armTarget: new THREE.Vector3(),
    poseLArm: Engine.prototype.poseLArm, restArm: Engine.prototype.restArm,
    muzzleFlash: new THREE.Object3D(), vmLight: new THREE.Object3D(),
  };
}

/** Sample the support-hand target path across a whole reload, in gun space. */
function handPath(id, samples = 120) {
  const model = WEAPON_BUILDERS[id]();
  const rig = model.lArm.userData.rig;
  const ctx = context(model, ANCHOR[id]);
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const rt = i / samples;
    ctx.reloadT = rt * ctx.reloadDur;
    Engine.prototype.animateViewmodel.call(ctx, 1 / 60);
    model.group.updateWorldMatrix(true, true);
    const p = rig.hand.getWorldPosition(new THREE.Vector3());
    out.push({ t: rt, p: model.group.worldToLocal(p) });
  }
  return { model, rig, path: out };
}

test('every weapon declares the mechanism it actually has', () => {
  for (const [id, style] of Object.entries(STYLE)) {
    const model = WEAPON_BUILDERS[id]();
    assert.ok(model.lArmKeys.length >= 4, `${id} has almost no reload keyframes`);
    // Keyframes must be sorted and span the whole cycle, or the interpolator skips.
    for (let i = 1; i < model.lArmKeys.length; i++) {
      assert.ok(model.lArmKeys[i].t >= model.lArmKeys[i - 1].t,
        `${id} (${style}) keyframes are out of order at index ${i}`);
    }
    assert.equal(model.lArmKeys[0].t, 0, `${id} must have a keyframe at t=0`);
    assert.equal(model.lArmKeys[model.lArmKeys.length - 1].t, 1, `${id} must have a keyframe at t=1`);
    disposeWeapon(model);
  }
});

// THE BOLT GUN. Settled decision: the support hand never leaves the forend and the
// firing hand runs the bolt. Doing it the other way looks wrong and loses the sight
// picture between shots.
test('AWM: the support hand never leaves the forend', () => {
  const { model, path } = handPath('awm');
  const rest = path[0].p.clone();
  let worst = 0, worstAt = 0;
  for (const s of path) {
    const d = s.p.distanceTo(rest);
    if (d > worst) { worst = d; worstAt = s.t; }
  }
  assert.ok(worst < 0.05,
    `the AWM support hand wandered ${(worst * 1000).toFixed(0)}mm from the forend at t=${worstAt.toFixed(2)} — a bolt gun is not reloaded by letting go of it`);
  // ...but it is not frozen either; the shooter's grip still settles.
  assert.ok(worst > 0.004, 'the AWM support hand is completely static, which reads as a bug');
  disposeWeapon(model);
});

// THE BELT-FED. The document flags this as the one most likely to be broken in any
// implementation, so it gets its own dedicated test.
test('M249: the feed cover swings open without the cover, box or hinge translating', () => {
  const model = WEAPON_BUILDERS.m249();
  const cover = model.chargingHandle;
  const ctx = context(model, 'lmg');

  const homePos = cover.position.clone();
  let maxRot = 0;
  let maxDrift = 0;
  for (let i = 0; i <= 90; i++) {
    ctx.reloadT = (i / 90) * ctx.reloadDur;
    Engine.prototype.animateViewmodel.call(ctx, 1 / 60);
    maxRot = Math.max(maxRot, Math.abs(cover.rotation.x));
    maxDrift = Math.max(maxDrift, cover.position.distanceTo(homePos));
  }
  assert.ok(maxRot > 1.0,
    `the feed cover only opened ${maxRot.toFixed(2)} rad; a SAW cover swings through more than a radian`);
  assert.ok(maxDrift < 1e-6,
    `the feed cover TRANSLATED ${(maxDrift * 1000).toFixed(2)}mm while opening — it is hinged, not thrown`);
  disposeWeapon(model);
});

test('M249: the hand works the feed tray on top, and never mimes a magazine change', () => {
  const { model, path } = handPath('m249');
  // The belt is laid into the tray on TOP of the receiver. At some point the hand must
  // be above the bore line; a magwell reload never goes up there.
  const highest = Math.max(...path.map(s => s.p.y));
  const lowest = Math.min(...path.map(s => s.p.y));
  assert.ok(highest > -0.02,
    `the hand never rose to the feed tray (peak y=${highest.toFixed(3)}) — this is still a magwell animation`);
  assert.ok(lowest < -0.10, 'the hand never reached down for the belt box');
  disposeWeapon(model);
});

// THE TUBE GUN. Four shells, one at a time — the rhythm is the whole character of it.
test('SPAS-12: four separate shells go in, not one magazine', () => {
  const { model, path } = handPath('spas12', 240);
  // Count round trips: the hand should approach the loading gate four distinct times.
  // Track sign changes in vertical direction as a robust proxy for "shuttling".
  let trips = 0;
  let rising = null;
  for (let i = 1; i < path.length; i++) {
    const dy = path[i].p.y - path[i - 1].p.y;
    if (Math.abs(dy) < 1e-5) continue;
    const up = dy > 0;
    if (rising === null) { rising = up; continue; }
    if (up !== rising) { trips++; rising = up; }
  }
  assert.ok(trips >= 7,
    `the SPAS hand only reversed direction ${trips} times; four shells loaded one at a time means at least seven reversals`);
  disposeWeapon(model);
});

// THE AK. Rock-and-lock: the empty pivots FORWARD off its front catch.
test('AK-47: the magazine rocks forward out of the well, it does not drop straight down', () => {
  const { model, path } = handPath('ak47');
  const keys = model.lArmKeys;
  const magZ = keys.find(k => Math.abs(k.t - 0.25) < 0.001)?.p[2];
  assert.ok(magZ !== undefined, 'expected a strip keyframe at t=0.25');
  // Between gripping the magazine and clearing it, the hand must travel FORWARD
  // (toward the muzzle, i.e. more negative z) as the magazine rotates out.
  const strip = path.find(s => s.t >= 0.25);
  const clearing = path.find(s => s.t >= 0.34);
  assert.ok(clearing.p.z < strip.p.z - 0.01,
    `the AK hand moved ${(clearing.p.z - strip.p.z).toFixed(3)}m in z while stripping; it should sweep forward off the front catch`);
  disposeWeapon(model);
});

test('AK-47 differs from the AR it used to be animated as', () => {
  const ak = WEAPON_BUILDERS.ak47();
  const m4 = WEAPON_BUILDERS.m4a1();
  // Same number of keys with the same shape would mean the table is not branching.
  const shape = m => m.lArmKeys.map(k => k.t.toFixed(3)).join(',');
  assert.notEqual(shape(ak), shape(m4), 'the AK and the M4 still share one animation');
  disposeWeapon(ak); disposeWeapon(m4);
});

// THE GRIP-FED GUN.
test('Vector: the magazine goes up through the pistol grip', () => {
  const model = WEAPON_BUILDERS.vector();
  // The magazine object itself must sit at grip depth, behind the trigger group,
  // not in a separate well ahead of it.
  const magZ = model.mag.position.z;
  const m4 = WEAPON_BUILDERS.m4a1();
  assert.ok(magZ > m4.mag.position.z,
    'the Vector magazine should sit further back than an AR magwell — it feeds through the grip');
  disposeWeapon(model); disposeWeapon(m4);
});

// THE AR. The thumb comes off the magazine onto the bolt release.
test('AR-pattern weapons touch the bolt release on the way back', () => {
  for (const id of ['m4a1', 'scar_h']) {
    const model = WEAPON_BUILDERS[id]();
    const keys = model.lArmKeys;
    const seat = keys.find(k => Math.abs(k.t - 0.80) < 0.001);
    const release = keys.find(k => Math.abs(k.t - 0.845) < 0.001);
    assert.ok(release, `${id} has no bolt-release keyframe`);
    // The release sits ABOVE and INBOARD of where the magazine was seated.
    assert.ok(release.p[1] > seat.p[1], `${id}: the bolt release must be above the magwell`);
    assert.ok(release.p[0] < seat.p[0], `${id}: the bolt release is on the inboard side of the receiver`);
    disposeWeapon(model);
  }
});

test('weapons without a bolt release do not pretend to have one', () => {
  for (const id of ['ak47', 'mp7', 'm249', 'awm', 'spas12']) {
    const model = WEAPON_BUILDERS[id]();
    const has = model.lArmKeys.some(k => Math.abs(k.t - 0.845) < 0.001);
    assert.equal(has, false, `${id} has a bolt-release keyframe but no bolt release`);
    disposeWeapon(model);
  }
});
