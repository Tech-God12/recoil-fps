import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();
const { Engine, criticallyDampedSpring } = await import('../src/game/engine.ts');

function springAt(rate) {
  const pos = new THREE.Vector3(-18, 4, 11);
  const vel = new THREE.Vector3();
  const goal = new THREE.Vector3(8, 1.5, -6);
  for (let t = 0; t < 1 - 1e-9; t += 1 / rate) criticallyDampedSpring(pos, vel, goal, 10, 1 / rate);
  return { pos, vel };
}

function bot(id, x, yaw = 0) {
  return {
    id, dead: false,
    eyePos: () => new THREE.Vector3(x, 1.62, 0),
    model: { group: { rotation: { y: yaw } } },
  };
}

function rigFor(list) {
  return Object.assign(Object.create(Engine.prototype), {
    isDefusal: true, dead: true, dfDeathCamT: 0, dfSpectate: 0, dfSpectateId: null,
    defusal: { spectateList: () => list },
    dfDeathAt: new THREE.Vector3(), dfKiller: null, yaw: 0,
    dfCamPos: new THREE.Vector3(), dfCamVel: new THREE.Vector3(), dfCamLook: new THREE.Vector3(),
    dfCamLookFrom: new THREE.Vector3(), dfCamPosFrom: new THREE.Vector3(),
    dfCamWantPos: new THREE.Vector3(), dfCamWantLook: new THREE.Vector3(), dfCamRayDir: new THREE.Vector3(),
    dfCamRot: new THREE.Quaternion(), dfCamGoalRot: new THREE.Quaternion(), dfCamAim: new THREE.Object3D(),
    dfCamSubject: null, dfCamBlend: 1, dfCamClip: 2.5, dfCamInit: false,
    raycaster: new THREE.Raycaster(), world: { occluders: [] },
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300), fovSetting: 92,
  });
}

test('critically damped spectator follow is frame-rate independent at 30 and 144 fps', () => {
  const low = springAt(30);
  const high = springAt(144);
  assert.ok(low.pos.distanceTo(high.pos) < 1e-9, `position drift ${low.pos.distanceTo(high.pos)}`);
  assert.ok(low.vel.distanceTo(high.vel) < 1e-9, `velocity drift ${low.vel.distanceTo(high.vel)}`);
});

test('spectator handoff preserves the selected identity and eases camera position, orientation and FOV separately', () => {
  const first = bot(101, 0, 0);
  const second = bot(202, 24, Math.PI - 0.02);
  const roster = [first, second];
  const rig = rigFor(roster);

  Engine.prototype.composeSpectatorCamera.call(rig, 1 / 60);
  const atFirst = rig.camera.position.clone();
  assert.equal(Engine.prototype.dfSpectateTarget.call(rig), first);

  // A teammate dying before the current subject must not shift the view to a
  // different index: identity wins over the filtered list index.
  roster.splice(0, 0, bot(77, -10));
  assert.equal(Engine.prototype.dfSpectateTarget.call(rig), first);

  rig.dfSpectateId = second.id;
  rig.dfSpectate = 2;
  Engine.prototype.composeSpectatorCamera.call(rig, 1 / 60);
  assert.ok(rig.camera.position.distanceTo(atFirst) < 0.3, 'switching subject never teleports the chase camera');
  assert.ok(rig.dfCamBlend > 0 && rig.dfCamBlend < 0.1, 'handoff has an explicit eased transition');
  assert.ok(rig.camera.fov > 60 && rig.camera.fov < 92, 'FOV responds on its own, gentler easing curve');

  for (let i = 0; i < 90; i++) Engine.prototype.composeSpectatorCamera.call(rig, 1 / 144);
  assert.ok(rig.camera.position.x > 10, 'camera reaches the new subject after the smooth handoff');
  assert.ok(Number.isFinite(rig.camera.quaternion.x + rig.camera.quaternion.y + rig.camera.quaternion.z + rig.camera.quaternion.w), 'quaternion slerp remains finite across yaw wrap');
});
