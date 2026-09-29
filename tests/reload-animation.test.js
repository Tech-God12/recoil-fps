import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { disposeWeapon } from './helpers/weapon-geometry.js';

const { Engine } = await import('../src/game/engine.ts');
const { WEAPON_BUILDERS } = await import('../src/game/models.ts');
const { solveArm } = await import('../src/game/weapons/core.ts');

const ROSTER = [
  ['m4a1', 'm4'], ['ak47', 'ak'], ['aug_a3', 'aug'], ['scar_h', 'scar'], ['mp7', 'smg'],
  ['vector', 'vector'], ['m249', 'lmg'], ['awm', 'sniper'], ['spas12', 'shotgun'],
  ['m1911', 'pistol'], ['deagle', 'deagle'],
];

function animationContext(model, audioTag) {
  return {
    VM_S: 1.35, def: () => ({ model, audioTag, boltAction: false }),
    ads: 0, adsFovEff: () => 60, crouched: false, grounded: true, walkBlend: 0, footPhase: 0,
    sprinting: false, sprintPose: 0, vmKick: 0, vmKickRot: 0, boltCycle: 0,
    reloadT: -1, reloadDur: 2, switchT: -1, cooking: false, pumpT: 0, slideKick: 0,
    bipodDeployed: () => false, updateTactical() {},
    _armTarget: new THREE.Vector3(),
    poseLArm: Engine.prototype.poseLArm, restArm: Engine.prototype.restArm,
    muzzleFlash: new THREE.Object3D(), vmLight: new THREE.Object3D(),
  };
}

/** One merged BVH of every non-arm solid, expressed in gun-local space. */
function gunBVH(model) {
  model.group.updateWorldMatrix(true, true);
  const inverse = model.group.matrixWorld.clone().invert();
  const geometries = [];
  model.group.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o; p; p = p.parent) if (p.userData.arm) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    for (const key of Object.keys(g.attributes)) if (key !== 'position') g.deleteAttribute(key);
    geometries.push(g.index ? g.toNonIndexed() : g);
  });
  return new MeshBVH(BufferGeometryUtils.mergeGeometries(geometries, false), { targetLeafSize: 12 });
}

const RAY_DIR = new THREE.Vector3(0.923, 0.371, 0.103).normalize();
const ray = new THREE.Ray(new THREE.Vector3(), RAY_DIR);
const nearest = {};
/** Depth below the weapon surface, or 0 when the point is in free air. */
function penetration(bvh, point) {
  ray.origin.copy(point);
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 1e-7);
  if (!(hit && hit.face.normal.dot(RAY_DIR) > 0)) return 0;
  bvh.closestPointToPoint(point, nearest);
  return nearest.distance;
}

// A glove squashes against a handguard; a forearm does not pass through a receiver.
const CLIP_LIMIT = 0.012;

test('the support arm is a two-bone chain with a pinned shoulder, not one rigid block', () => {
  for (const [id] of ROSTER) {
    const model = WEAPON_BUILDERS[id]();
    const rig = model.lArm.userData.rig;
    assert.ok(rig, `${id} has no arm rig`);
    assert.ok(rig.upper && rig.lower && rig.hand, `${id} is missing a bone`);
    assert.notEqual(rig.upper, rig.lower);
    assert.equal(rig.lower.parent, rig.upper, `${id} forearm must hang off the upper arm`);
    assert.equal(rig.hand.parent, rig.lower, `${id} hand must hang off the forearm`);
    assert.ok(rig.L1 > 0.1 && rig.L2 > 0.1, `${id} bone lengths look wrong`);
    disposeWeapon(model);
  }
});

test('IK puts the hand exactly on target while bone lengths and the shoulder stay fixed', () => {
  for (const [id] of ROSTER) {
    const model = WEAPON_BUILDERS[id]();
    model.group.updateWorldMatrix(true, true);
    const rig = model.lArm.userData.rig;
    const shoulder = model.lArm.position.clone();
    const span = rig.L1 + rig.L2;
    // Sweep a grid of reachable targets around the weapon.
    for (let i = 0; i < 40; i++) {
      const a = i * 0.618 * Math.PI * 2, r = 0.18 + (i % 7) * 0.055;
      const target = new THREE.Vector3(
        shoulder.x + Math.cos(a) * r,
        shoulder.y + Math.sin(a * 1.7) * r + 0.2,
        shoulder.z + Math.sin(a) * r - 0.25,
      );
      // The solver deliberately clamps unreachable targets; only assert exactness
      // inside the genuinely reachable annulus.
      const reach = target.distanceTo(shoulder);
      if (reach > span - 0.02 || reach < Math.abs(rig.L1 - rig.L2) + 0.02) continue;
      solveArm(model.lArm, target, 0);
      model.group.updateWorldMatrix(true, true);
      const elbow = rig.lower.getWorldPosition(new THREE.Vector3());
      const wrist = rig.hand.getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(shoulder.distanceTo(elbow) - rig.L1) < 1e-6, `${id} upper arm stretched`);
      assert.ok(Math.abs(elbow.distanceTo(wrist) - rig.L2) < 1e-6, `${id} forearm stretched`);
      assert.ok(wrist.distanceTo(target) < 1e-6, `${id} hand missed its target`);
      assert.ok(model.lArm.position.distanceTo(shoulder) < 1e-9, `${id} shoulder drifted`);
    }
    disposeWeapon(model);
  }
});

test('IK never explodes on unreachable or degenerate targets', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const rig = model.lArm.userData.rig;
  const shoulder = model.lArm.position.clone();
  for (const target of [
    shoulder.clone(),                                   // zero length
    shoulder.clone().add(new THREE.Vector3(0, 9, 0)),   // far out of reach
    shoulder.clone().add(new THREE.Vector3(0, -9, 0)),  // out of reach, opposite pole
    new THREE.Vector3(0, 0, 0),
  ]) {
    solveArm(model.lArm, target, 0.3);
    model.group.updateWorldMatrix(true, true);
    for (const node of [rig.upper, rig.lower, rig.hand]) {
      const p = node.getWorldPosition(new THREE.Vector3());
      assert.ok(Number.isFinite(p.x + p.y + p.z), 'IK produced NaN');
    }
    const elbow = rig.lower.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(shoulder.distanceTo(elbow) - rig.L1) < 1e-6, 'upper arm stretched');
  }
  disposeWeapon(model);
});

test('no weapon drives its support arm through its own receiver during a reload', () => {
  for (const [id, tag] of ROSTER) {
    const model = WEAPON_BUILDERS[id]();
    const context = animationContext(model, tag);
    const rig = model.lArm.userData.rig;
    const bvh = gunBVH(model);
    const probe = new THREE.Vector3();
    let worst = 0, worstAt = 0;
    for (let i = 0; i <= 90; i++) {
      const rt = i / 90;
      context.reloadT = rt * context.reloadDur;
      Engine.prototype.animateViewmodel.call(context, 1 / 60);
      model.group.updateWorldMatrix(true, true);
      // Upper arm in full; forearm up to the wrist — the hand is meant to touch the gun.
      for (const [node, len, kMax] of [[rig.upper, rig.L1, 6], [rig.lower, rig.L2, 4]]) {
        for (let k = 0; k <= kMax; k++) {
          probe.set(0, len * k / 6, 0);
          model.group.worldToLocal(node.localToWorld(probe));
          const depth = penetration(bvh, probe);
          if (depth > worst) { worst = depth; worstAt = rt; }
        }
      }
    }
    assert.ok(worst <= CLIP_LIMIT,
      `${id} support arm sinks ${(worst * 1000).toFixed(1)}mm into the weapon at t=${worstAt.toFixed(2)} (limit ${CLIP_LIMIT * 1000}mm)`);
    disposeWeapon(model);
  }
});

/**
 * CALIBRATION — a case that MUST fail.
 *
 * The clip assertion above is only worth anything if the probe can actually detect a
 * clip. If the merged BVH ever stops seeing interiors — a mesh dropped from the merge,
 * flipped winding, a changed `userData.arm` marker, a three-mesh-bvh signature change —
 * then `penetration()` quietly returns 0 for everything and every weapon "passes" by
 * measuring nothing at all. That failure mode is silent and permanent.
 *
 * So: prove the detector fires. Find the deepest interior point in each weapon, drive
 * the support hand straight to it, and re-run the exact probe loop the real test uses.
 * It has to come back over the limit. A failure here does not mean the arm is broken —
 * it means the test above has gone toothless.
 */

/**
 * Find a point inside the weapon deeper than `want`. A gun is mostly thin walls around
 * air, so interior maxima are small and scattered: a coarse grid misses them and a single
 * refined winner lands in a local maximum. Escalate the grid instead and stop at the
 * first qualifying point — thick weapons exit on the first pass, and only a pistol has to
 * pay for the fine one.
 */
function interiorPointDeeperThan(bvh, want) {
  const g = bvh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const box = g.boundingBox;
  const probe = new THREE.Vector3();
  let bestDepth = 0;
  const best = new THREE.Vector3();
  for (const N of [16, 32, 64]) {
    const sx = (box.max.x - box.min.x) / N;
    const sy = (box.max.y - box.min.y) / N;
    const sz = (box.max.z - box.min.z) / (N * 2);
    for (let ix = 0; ix <= N; ix++) {
      for (let iy = 0; iy <= N; iy++) {
        for (let iz = 0; iz <= N * 2; iz++) {
          probe.set(box.min.x + ix * sx, box.min.y + iy * sy, box.min.z + iz * sz);
          const d = penetration(bvh, probe);
          if (d > bestDepth) { bestDepth = d; best.copy(probe); }
          if (d > want) return { depth: d, point: best, found: true };
        }
      }
    }
  }
  return { depth: bestDepth, point: best, found: false };
}

/** A solid of known thickness: the only way to check the probe measures depth correctly. */
function cubeBVH(side) {
  const g = new THREE.BoxGeometry(side, side, side).toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  return new MeshBVH(g);
}

test('the clip probe measures real depth: it fires inside a solid, stays silent outside, and reads the right magnitude', () => {
  // Against a 60mm cube the answers are known exactly, so a broken BVH, a flipped winding
  // or a changed raycast signature shows up here as a number rather than as silence.
  const bvh = cubeBVH(0.06);
  assert.ok(Math.abs(penetration(bvh, new THREE.Vector3(0, 0, 0)) - 0.03) < 1e-3,
    'the centre of a 60mm cube is 30mm from its nearest face');
  assert.ok(Math.abs(penetration(bvh, new THREE.Vector3(0, 0.025, 0)) - 0.005) < 1e-3,
    '5mm below a face reads 5mm');
  assert.equal(penetration(bvh, new THREE.Vector3(1, 1, 1)), 0, 'free air reads zero');
  assert.equal(penetration(bvh, new THREE.Vector3(0.04, 0, 0)), 0, 'just outside a face reads zero');
  // And it discriminates across the limit the real test asserts on.
  assert.ok(penetration(bvh, new THREE.Vector3(0, 0.02, 0)) < CLIP_LIMIT, '10mm passes');
  assert.ok(penetration(bvh, new THREE.Vector3(0, 0.014, 0)) > CLIP_LIMIT, '16mm fails');
});

test('the clip probe is calibrated: a support arm driven into the receiver is caught', () => {
  for (const [id] of ROSTER) {
    const model = WEAPON_BUILDERS[id]();
    model.group.updateWorldMatrix(true, true);
    const rig = model.lArm.userData.rig;
    const bvh = gunBVH(model);
    const { depth, point, found } = interiorPointDeeperThan(bvh, CLIP_LIMIT * 1.05);

    // 1. The detector sees interiors, and the limit is meaningful for THIS weapon — a
    //    clip deep enough to fail has to be physically representable inside it.
    assert.ok(found,
      `${id}: no interior point deeper than the ${CLIP_LIMIT * 1000}mm limit exists (deepest found ${(depth * 1000).toFixed(1)}mm) — no pose could ever fail the clip test for this weapon`);

    // 2. The pose-to-probe path is live. Note the probe loop deliberately stops 2/3 along
    //    the forearm — the HAND is supposed to touch the gun — so burying the wrist would
    //    prove nothing. Translate the whole limb instead: anchor the shoulder itself at
    //    the deepest interior point, which puts a sampled point (upper arm, k=0) inside.
    solveArm(model.lArm, point, 0);
    model.lArm.position.copy(point);
    model.group.updateWorldMatrix(true, true);
    const probe = new THREE.Vector3();
    let worst = 0;
    for (const [node, len, kMax] of [[rig.upper, rig.L1, 6], [rig.lower, rig.L2, 4]]) {
      for (let k = 0; k <= kMax; k++) {
        probe.set(0, len * k / 6, 0);
        model.group.worldToLocal(node.localToWorld(probe));
        worst = Math.max(worst, penetration(bvh, probe));
      }
    }
    assert.ok(worst > CLIP_LIMIT,
      `${id}: an arm solved INTO the receiver reported only ${(worst * 1000).toFixed(1)}mm — the pose-to-probe path is broken, so the clip test cannot fail`);
    disposeWeapon(model);
  }
});

test('the reload reads as distinct beats rather than one symmetric dip', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const context = animationContext(model, 'm4');
  const samples = [];
  for (let i = 0; i <= 100; i++) {
    context.reloadT = (i / 100) * context.reloadDur;
    Engine.prototype.animateViewmodel.call(context, 1 / 60);
    samples.push({ rt: i / 100, rx: model.group.rotation.x, y: model.group.position.y });
  }
  // The old animation peaked exactly at the midpoint and was mirror-symmetric.
  const early = samples[25], mid = samples[50], late = samples[75];
  assert.ok(Math.abs(early.rx - mid.rx) < Math.abs(early.rx - samples[2].rx) * 0.5,
    'gun should be HELD in the workspace through the middle, not sliding the whole time');
  assert.ok(Math.abs(mid.rx - late.rx) < Math.abs(early.rx - samples[2].rx) * 0.5,
    'gun should still be held at 75%');
  // And it must come back: the end pose matches the start pose.
  assert.ok(Math.abs(samples[100].rx - samples[0].rx) < 0.02, 'reload does not return to the firing pose');
  disposeWeapon(model);
});

test('the magazine physically leaves the weapon and a fresh one is seated', () => {
  for (const [id, tag] of [['m4a1', 'm4'], ['aug_a3', 'aug'], ['scar_h', 'scar'], ['mp7', 'smg']]) {
    const model = WEAPON_BUILDERS[id]();
    const context = animationContext(model, tag);
    const home = model.mag.userData.homeY ?? 0;
    let lowest = home, hiddenFrames = 0;
    for (let i = 0; i <= 100; i++) {
      context.reloadT = (i / 100) * context.reloadDur;
      Engine.prototype.animateViewmodel.call(context, 1 / 60);
      lowest = Math.min(lowest, model.mag.position.y);
      if (!model.mag.visible) hiddenFrames++;
    }
    assert.ok(lowest < home - 0.08, `${id} magazine barely moves (${(home - lowest).toFixed(3)})`);
    assert.ok(hiddenFrames > 3, `${id} magazine never leaves the gun`);
    // Back to the firing state afterwards.
    context.reloadT = -1;
    for (let i = 0; i < 90; i++) Engine.prototype.animateViewmodel.call(context, 1 / 60);
    assert.equal(model.mag.visible, true, `${id} magazine stayed hidden`);
    assert.ok(Math.abs(model.mag.position.y - home) < 1e-6, `${id} magazine did not return home`);
    assert.ok(Math.abs(model.mag.rotation.x) < 1e-6, `${id} magazine stayed rotated`);
    disposeWeapon(model);
  }
});

test('the support hand returns to the foregrip after a reload ends', () => {
  for (const [id, tag] of [['m4a1', 'm4'], ['ak47', 'ak'], ['aug_a3', 'aug']]) {
    const model = WEAPON_BUILDERS[id]();
    const context = animationContext(model, tag);
    const rig = model.lArm.userData.rig;
    context.reloadT = 0.9 * context.reloadDur;
    Engine.prototype.animateViewmodel.call(context, 1 / 60);
    context.reloadT = -1;
    for (let i = 0; i < 120; i++) Engine.prototype.animateViewmodel.call(context, 1 / 60);
    model.group.updateWorldMatrix(true, true);
    const wrist = model.group.worldToLocal(rig.hand.getWorldPosition(new THREE.Vector3()));
    assert.ok(wrist.distanceTo(rig.rest) < 1e-6, `${id} hand did not settle back on the foregrip`);
    assert.ok(Math.abs(rig.hand.rotation.x) < 0.01 && Math.abs(rig.hand.rotation.y) < 0.01,
      `${id} wrist stayed twisted`);
    disposeWeapon(model);
  }
});
