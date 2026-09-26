// The reload rig is the most-watched animation in the game: it plays a few
// hundred times a session, centre-screen, at arm's length. These tests pin the
// two failures the old translate-the-whole-arm rig shipped with:
//   1. the forearm swept straight through the receiver and magwell, and
//   2. the shoulder slid around with the hand, so the limb detached from a body.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { disposeWeapon } from './helpers/weapon-geometry.js';

const { WEAPON_BUILDERS } = await import('../src/game/weapons/index.ts');
const { poseArmIK } = await import('../src/game/weapons/core.ts');

/**
 * Surface probe over the real gun geometry (arms excluded). A point counts as
 * "inside the gun" when the closest surface point's outward normal faces away
 * from it — the standard signed-distance test, and far tighter than an AABB.
 */
function gunSurfaceProbe(model) {
  model.group.updateMatrixWorld(true);
  const parts = [];
  // Object3D.traverse cannot prune, and the arms are merged subtrees — walk by hand.
  (function walk(o) {
    if (o.userData.arm) return;
    if (o.isMesh && o.visible && o.geometry?.attributes?.position) {
      if (!o.geometry.boundsTree) o.geometry.boundsTree = new MeshBVH(o.geometry);
      o.geometry.computeBoundingBox();
      parts.push({
        mesh: o,
        toLocal: new THREE.Matrix4().copy(o.matrixWorld).invert(),
        box: o.geometry.boundingBox.clone(),
      });
    }
    for (const child of o.children) walk(child);
  })(model.group);
  assert.ok(parts.length > 0, 'gun has no body geometry to probe');
  const local = new THREE.Vector3();
  const hit = {};
  return function depthInside(worldPoint) {
    let deepest = 0;
    for (const { mesh, toLocal, box } of parts) {
      local.copy(worldPoint).applyMatrix4(toLocal);
      // A point outside the mesh's own bounds cannot be inside its surface; this
      // also stops back-facing far walls from reading as penetration.
      if (!box.containsPoint(local)) continue;
      const res = mesh.geometry.boundsTree.closestPointToPoint(local, hit, 0, 0.09);
      if (!res || !res.faceIndex && res.faceIndex !== 0) continue;
      const tri = faceNormal(mesh.geometry, res.faceIndex);
      const away = local.clone().sub(res.point);
      // Degenerate distance: treat as surface contact, not penetration.
      if (away.lengthSq() < 1e-12) continue;
      const depth = -away.dot(tri);
      if (depth > deepest) deepest = depth;
    }
    return deepest;
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function faceNormal(geometry, faceIndex) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const i0 = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const i1 = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const i2 = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
  _a.fromBufferAttribute(pos, i0); _b.fromBufferAttribute(pos, i1); _c.fromBufferAttribute(pos, i2);
  return _b.clone().sub(_a).cross(_c.clone().sub(_a)).normalize();
}

/** Sample points down both bones of the solved arm, in world space. */
function limbSamples(model) {
  model.group.updateMatrixWorld(true);
  const rig = model.lArm.userData.rig;
  const shoulder = model.lArm.getWorldPosition(new THREE.Vector3());
  const elbow = rig.elbow.getWorldPosition(new THREE.Vector3());
  const wrist = rig.hand.getWorldPosition(new THREE.Vector3());
  const pts = [];
  // Skip the last 30% of the forearm: the wrist and glove are *meant* to touch
  // the gun. Everything before that is upper arm / forearm and must stay clear.
  for (let i = 0; i <= 10; i++) pts.push(shoulder.clone().lerp(elbow, i / 10));
  for (let i = 0; i <= 8; i++) pts.push(elbow.clone().lerp(wrist, (i / 8) * 0.70));
  return { shoulder, elbow, wrist, pts };
}

const RELOADERS = ['m4a1', 'ak47', 'scar_h', 'mp7', 'vector', 'awm', 'm249', 'mcx_spear'];

for (const id of RELOADERS) {
  test(`${id}: the reload arm never passes through the gun body`, () => {
    const model = WEAPON_BUILDERS[id]();
    const depthInside = gunSurfaceProbe(model);
    const keys = model.lArmKeys;
    assert.ok(keys.length >= 4, `${id} has no reload choreography`);
    const offset = new THREE.Vector3(), rot = new THREE.Euler();
    for (let step = 0; step <= 120; step++) {
      const rt = step / 120;
      let i = 0;
      while (i < keys.length - 2 && rt > keys[i + 1].t) i++;
      const k0 = keys[i], k1 = keys[i + 1];
      const f = THREE.MathUtils.clamp((rt - k0.t) / Math.max(1e-4, k1.t - k0.t), 0, 1);
      const s = f * f * (3 - 2 * f);
      offset.set(
        k0.p[0] + (k1.p[0] - k0.p[0]) * s,
        k0.p[1] + (k1.p[1] - k0.p[1]) * s,
        k0.p[2] + (k1.p[2] - k0.p[2]) * s,
      );
      rot.set(
        k0.r[0] + (k1.r[0] - k0.r[0]) * s,
        k0.r[1] + (k1.r[1] - k0.r[1]) * s,
        k0.r[2] + (k1.r[2] - k0.r[2]) * s,
      );
      poseArmIK(model.lArm, offset, rot);
      const { pts } = limbSamples(model);
      for (const p of pts) {
        const depth = depthInside(p);
        assert.ok(
          depth < 0.002,
          `${id}: limb centreline is ${(depth * 1000).toFixed(1)} mm inside the gun at t=${rt.toFixed(2)} ` +
          `(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`,
        );
      }
    }
    disposeWeapon(model);
  });

  test(`${id}: the shoulder is an anchor and the bones keep constant length`, () => {
    const model = WEAPON_BUILDERS[id]();
    const rig = model.lArm.userData.rig;
    const anchor = model.lArm.position.clone();
    const offset = new THREE.Vector3(), rot = new THREE.Euler();
    for (const k of model.lArmKeys) {
      offset.set(...k.p); rot.set(...k.r);
      poseArmIK(model.lArm, offset, rot);
      model.group.updateMatrixWorld(true);
      assert.deepEqual(model.lArm.position.toArray(), anchor.toArray(), `${id}: shoulder drifted`);
      const toGun = new THREE.Matrix4().copy(model.group.matrixWorld).invert();
      const elbow = rig.elbow.getWorldPosition(new THREE.Vector3()).applyMatrix4(toGun);
      const wrist = rig.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(toGun);
      assert.ok(Math.abs(elbow.distanceTo(rig.shoulder) - rig.upperLen) < 1e-4, `${id}: upper arm stretched`);
      assert.ok(Math.abs(wrist.distanceTo(elbow) - rig.foreLen) < 1e-4, `${id}: forearm stretched`);
    }
    disposeWeapon(model);
  });

  test(`${id}: the hand actually lands on its keyframed target`, () => {
    const model = WEAPON_BUILDERS[id]();
    const rig = model.lArm.userData.rig;
    const offset = new THREE.Vector3(), rot = new THREE.Euler();
    for (const k of model.lArmKeys) {
      offset.set(...k.p); rot.set(...k.r);
      poseArmIK(model.lArm, offset, rot);
      model.group.updateMatrixWorld(true);
      const toGun = new THREE.Matrix4().copy(model.group.matrixWorld).invert();
      const wrist = rig.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(toGun);
      const want = rig.rest.clone().add(offset);
      // Reach clamping may shorten extreme targets; 3 cm is well inside "looks right".
      assert.ok(wrist.distanceTo(want) < 0.03, `${id}: hand missed its target by ${wrist.distanceTo(want).toFixed(3)}`);
    }
    disposeWeapon(model);
  });
}

test('the rest pose returns the support hand exactly to the handguard grip', () => {
  for (const id of RELOADERS) {
    const model = WEAPON_BUILDERS[id]();
    const rig = model.lArm.userData.rig;
    poseArmIK(model.lArm, new THREE.Vector3(0.1, -0.2, 0.05), new THREE.Euler(0.5, 0.2, 0.1));
    poseArmIK(model.lArm, new THREE.Vector3(), new THREE.Euler());
    model.group.updateMatrixWorld(true);
    const toGun = new THREE.Matrix4().copy(model.group.matrixWorld).invert();
    const wrist = rig.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(toGun);
    assert.ok(wrist.distanceTo(rig.rest) < 1e-3, `${id}: rest pose drifted off the handguard`);
    // Hand orientation must be identity in gun space at rest, or the glove twists.
    const q = rig.hand.getWorldQuaternion(new THREE.Quaternion());
    const gunQ = model.group.getWorldQuaternion(new THREE.Quaternion());
    assert.ok(q.angleTo(gunQ) < 1e-3, `${id}: rest hand is twisted off the gun frame`);
    disposeWeapon(model);
  }
});

test('the clip probe is not toothless: a line through the receiver is caught', () => {
  // Calibration. If this ever stops failing the geometry, the clip assertions
  // above have quietly become decorative.
  const model = WEAPON_BUILDERS.m4a1();
  const depthInside = gunSurfaceProbe(model);
  // Sweep a horizontal line straight through the lower receiver / magwell block.
  let worst = 0;
  for (let i = 0; i <= 40; i++) {
    const x = -0.05 + (i / 40) * 0.10;
    worst = Math.max(worst, depthInside(new THREE.Vector3(x, -0.030, -0.160)));
  }
  assert.ok(worst > 0.002, `probe failed to flag a line through the receiver (worst ${(worst * 1000).toFixed(1)} mm)`);
  disposeWeapon(model);
});
