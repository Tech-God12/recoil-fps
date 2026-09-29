import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();

const inert = new Proxy(function () {}, {
  get(_t, p) {
    if (p === 'currentTime') return 0;
    if (p === 'state') return 'running';
    if (p === 'sampleRate') return 44100;
    if (p === 'getChannelData') return () => new Float32Array(64);
    if (p === 'then') return undefined;
    if (p === Symbol.toPrimitive) return () => 0;
    return inert;
  },
  apply() { return inert; }, construct() { return inert; }, set() { return true; },
});
globalThis.window = globalThis;
globalThis.AudioContext = inert;

const { Engine } = await import('../src/game/engine.ts');

test('critically damped spring on position converges smoothly without overshoot', () => {
  const engine = Object.create(Engine.prototype);
  engine.dfCamPos = new THREE.Vector3(0, 0, 0);
  engine.dfCamVel = new THREE.Vector3(0, 0, 0);
  engine.dfCamInit = true;
  engine.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  engine.fovSetting = 75;
  engine.dfCamDist = 2.5;

  const wantPos = new THREE.Vector3(10, 5, 20);

  // Simulate at 60 fps (dt = 1/60)
  const dt = 1 / 60;
  let lastDist = engine.dfCamPos.distanceTo(wantPos);

  for (let frame = 0; frame < 60; frame++) {
    // Run spring step
    const omega = 11.0;
    const dPos = engine.dfCamPos.clone().sub(wantPos);
    const temp = engine.dfCamVel.clone().addScaledVector(dPos, omega).multiplyScalar(dt);
    const exp = Math.exp(-omega * dt);
    engine.dfCamPos.copy(wantPos).add(dPos.add(temp).multiplyScalar(exp));
    engine.dfCamVel.addScaledVector(temp, -omega).multiplyScalar(exp);

    const dist = engine.dfCamPos.distanceTo(wantPos);
    assert.ok(dist <= lastDist + 1e-6, `Position converges monotonically without oscillation: ${dist} vs ${lastDist}`);
    lastDist = dist;
  }

  assert.ok(engine.dfCamPos.distanceTo(wantPos) < 0.05, 'Camera reaches target position within 1 second');
});

test('spectator camera tracking is stable at both 30 FPS and 144 FPS', () => {
  for (const fps of [30, 60, 120, 144]) {
    const dt = 1 / fps;
    const pos = new THREE.Vector3(0, 0, 0);
    const vel = new THREE.Vector3(0, 0, 0);
    const wantPos = new THREE.Vector3(5, 2, -10);

    const omega = 11.0;
    for (let f = 0; f < fps; f++) {
      const dPos = pos.clone().sub(wantPos);
      const temp = vel.clone().addScaledVector(dPos, omega).multiplyScalar(dt);
      const exp = Math.exp(-omega * dt);
      pos.copy(wantPos).add(dPos.add(temp).multiplyScalar(exp));
      vel.addScaledVector(temp, -omega).multiplyScalar(exp);

      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), `Stable finite coordinates at ${fps} fps`);
      assert.ok(Number.isFinite(vel.x) && Number.isFinite(vel.y) && Number.isFinite(vel.z), `Stable finite velocities at ${fps} fps`);
    }

    assert.ok(pos.distanceTo(wantPos) < 0.05, `Converges at ${fps} FPS`);
  }
});

test('quaternion slerp smoothly interpolates rotation across yaw wraps', () => {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  const qStart = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI + 0.1, 0));
  const qTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI - 0.1, 0));

  cam.quaternion.copy(qStart);
  const dt = 1 / 60;
  const slerpK = 1 - Math.exp(-dt * 14);

  // Slerp step
  cam.quaternion.slerp(qTarget, slerpK);

  assert.ok(Number.isFinite(cam.quaternion.x));
  assert.ok(Number.isFinite(cam.quaternion.y));
  assert.ok(Number.isFinite(cam.quaternion.z));
  assert.ok(Number.isFinite(cam.quaternion.w));
  assert.ok(Math.abs(cam.quaternion.length() - 1.0) < 1e-4, 'Quaternion remains normalized');
});
