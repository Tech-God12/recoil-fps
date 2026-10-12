import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { SpectatorRig, springStep, expApproach } = await import('../src/game/spectator.ts');

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Drive a rig over `secs` of wall clock at a fixed timestep, following a
 *  time-parameterised subject. Returns the final output pose plus the largest
 *  single-frame jump, which is what a viewer perceives as a lurch. */
function drive(rig, secs, dt, want, onFrame) {
  let t = 0, maxStep = 0;
  const prev = rig.outPos.clone();
  for (let i = 0; i * dt < secs; i++) {
    t = i * dt;
    rig.update(dt, want(t));
    maxStep = Math.max(maxStep, prev.distanceTo(rig.outPos));
    prev.copy(rig.outPos);
    onFrame?.(t, rig);
  }
  return { pos: rig.outPos.clone(), quat: rig.outQuat.clone(), fov: rig.outFov, maxStep };
}

test('the position spring is frame-rate independent: 30 fps and 144 fps land together', () => {
  const start = { pos: V(0, 1.6, 0), look: V(0, 1.5, -40), fov: 90 };

  // A subject running at a constant 6 m/s, so the only thing that can differ
  // between the two runs is the integrator itself - the input is sampled
  // identically along the path.
  const straight = t => ({ pos: V(3, 1.6, -t * 6), look: V(3, 1.5, -40 - t * 6), fov: 75 });
  const s30 = new SpectatorRig(); s30.cut(start);
  const s144 = new SpectatorRig(); s144.cut(start);
  const a = drive(s30, 2, 1 / 30, straight);
  const b = drive(s144, 2, 1 / 144, straight);
  // The only legitimate difference is the zero-order hold on the subject: at
  // 30 fps you see where he was up to a frame ago. That is worth half a frame
  // of his travel and nothing more - any excess is integrator error.
  const sampling = 6 * (1 / 30 - 1 / 144) / 2;
  const gap = a.pos.distanceTo(b.pos);
  assert.ok(gap < sampling * 1.15,
    `30 fps ended at ${a.pos.toArray().map(v => v.toFixed(3))}, 144 fps at ${b.pos.toArray().map(v => v.toFixed(3))}: ${gap.toFixed(4)} m apart, but sampling alone only explains ${sampling.toFixed(4)} m - the spring is timestep dependent`);
  assert.ok(Math.abs(a.quat.angleTo(b.quat)) < 0.01, 'orientation must not depend on frame rate');
  assert.ok(Math.abs(a.fov - b.fov) < 0.15, 'field of view must not depend on frame rate');

  // And on a subject that is strafing hard, the two frame rates must still end
  // up in effectively the same place. Some divergence is unavoidable here -
  // at 30 fps you genuinely only see the subject 30 times a second - but it
  // has to stay well under what a viewer could notice.
  const strafing = t => ({ pos: V(Math.sin(t * 2) * 4, 1.6 + t * 0.4, -t * 6), look: V(0, 1.5, -40), fov: 75 });
  const w30 = new SpectatorRig(); w30.cut(start);
  const w144 = new SpectatorRig(); w144.cut(start);
  const c = drive(w30, 2, 1 / 30, strafing);
  const d = drive(w144, 2, 1 / 144, strafing);
  assert.ok(c.pos.distanceTo(d.pos) < 0.15, `strafing subject diverged by ${c.pos.distanceTo(d.pos).toFixed(3)} m between frame rates`);
  assert.ok(c.maxStep < 0.35, `30 fps lurched ${c.maxStep.toFixed(3)} m in one frame`);

  // And a brutal frame spike must not blow the spring up.
  const spiky = new SpectatorRig(); spiky.cut(start);
  for (let i = 0; i < 12; i++) spiky.update(0.5, straight(i * 0.5));
  assert.ok(Number.isFinite(spiky.outPos.x) && spiky.outPos.length() < 1e3, 'half-second frames must not destabilise the spring');
});

test('the spring is critically damped: it closes on the subject without overshooting', () => {
  const rig = new SpectatorRig();
  rig.cut({ pos: V(0, 0, 0), look: V(0, 0, -1), fov: 75 });
  const want = () => ({ pos: V(10, 0, 0), look: V(10, 0, -1), fov: 75 });
  let peak = 0;
  drive(rig, 3, 1 / 60, want, (_t, r) => { peak = Math.max(peak, r.outPos.x); });
  assert.ok(peak <= 10.001, `overshot to ${peak.toFixed(3)} - that is a wobble, not critical damping`);
  assert.ok(rig.outPos.x > 9.9, `only reached ${rig.outPos.x.toFixed(2)} in 3 s - too slack to follow a player`);
});

test('orientation slerps the short way round the yaw wrap', () => {
  // Subject facing just west of due south, then just east of it: a 0.2 rad
  // change that a naive lerp through a look-at point sends the long way.
  const rig = new SpectatorRig();
  rig.cut({ pos: V(0, 0, 0), look: V(Math.sin(Math.PI - 0.1) * 10, 0, Math.cos(Math.PI - 0.1) * 10), fov: 75 });
  const before = rig.outQuat.clone();
  const want = () => ({ pos: V(0, 0, 0), look: V(Math.sin(-Math.PI + 0.1) * 10, 0, Math.cos(-Math.PI + 0.1) * 10), fov: 75 });
  let travel = 0;
  let prev = before.clone();
  drive(rig, 1.5, 1 / 60, want, (_t, r) => { travel += Math.abs(prev.angleTo(r.outQuat)); prev = r.outQuat.clone(); });
  assert.ok(travel < 0.5, `camera swung ${travel.toFixed(2)} rad to cover a 0.2 rad turn - it went the long way`);
});

test('field of view eases on its own channel, slower than the dolly', () => {
  const rig = new SpectatorRig();
  rig.cut({ pos: V(0, 0, 0), look: V(0, 0, -1), fov: 100 });
  const want = () => ({ pos: V(4, 0, 0), look: V(4, 0, -1), fov: 70 });
  drive(rig, 0.25, 1 / 60, want);
  const posDone = rig.outPos.x / 4;
  const fovDone = (100 - rig.outFov) / 30;
  assert.ok(fovDone > 0.05, 'field of view must actually ease, not sit still');
  assert.ok(fovDone < posDone, `fov settled ${(fovDone * 100).toFixed(0)}% vs position ${(posDone * 100).toFixed(0)}% - the zoom must trail the move, not race it`);
});

test('changing subject blends instead of teleporting', () => {
  const rig = new SpectatorRig();
  const a = { pos: V(0, 1.6, 0), look: V(0, 1.6, -10), fov: 75 };
  rig.cut(a);
  drive(rig, 0.5, 1 / 60, () => a);

  // New subject 40 m away across the map.
  const b = { pos: V(30, 1.6, -26), look: V(30, 1.6, -36), fov: 75 };
  rig.transition(b);
  assert.ok(rig.blending, 'a subject change must start a blend');
  assert.ok(rig.outPos.distanceTo(a.pos) < 0.01, 'the blend starts from where the camera already was, not from the new subject');

  let maxStep = 0, frames = 0;
  const prev = rig.outPos.clone();
  for (let i = 0; i < 120; i++) {
    rig.update(1 / 60, b);
    maxStep = Math.max(maxStep, prev.distanceTo(rig.outPos));
    prev.copy(rig.outPos);
    if (rig.blending) frames++;
  }
  // 40 m over ~0.46 s at 60 fps is ~1.4 m a frame at the midpoint; the point is
  // that it is bounded and eased, not an instant cut.
  assert.ok(maxStep < 2.2, `blend stepped ${maxStep.toFixed(2)} m in one frame - too abrupt`);
  assert.ok(frames > 14 && frames < 48, `blend ran ${frames} frames, want roughly a quarter to three quarters of a second`);
  assert.ok(rig.outPos.distanceTo(b.pos) < 0.05, 'the blend must land exactly on the new subject with no second catch-up');
  assert.ok(!rig.blending, 'the blend must finish');
});

test('the blend eases in and out rather than running at constant speed', () => {
  const rig = new SpectatorRig();
  const a = { pos: V(0, 0, 0), look: V(0, 0, -10), fov: 75 };
  rig.cut(a);
  const b = { pos: V(20, 0, 0), look: V(20, 0, -10), fov: 75 };
  rig.transition(b);
  const steps = [];
  let prev = rig.outPos.clone();
  while (rig.blending) {
    rig.update(1 / 120, b);
    steps.push(prev.distanceTo(rig.outPos));
    prev = rig.outPos.clone();
  }
  assert.ok(steps.length > 8);
  const mid = steps[Math.floor(steps.length / 2)];
  assert.ok(steps[0] < mid * 0.35, `blend opens at ${steps[0].toFixed(4)} vs ${mid.toFixed(4)} at the midpoint - it is not easing in`);
  assert.ok(steps[steps.length - 1] < mid * 0.35, 'the blend must ease out, not stop dead');
});

test('the spring solver itself is stable and monotone for any timestep', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.25, 1]) {
    let x = 0, v = 0;
    for (let i = 0; i * dt < 5; i++) [x, v] = springStep(x, v, 1, 11, dt);
    assert.ok(Math.abs(x - 1) < 1e-6, `dt=${dt} did not converge (x=${x})`);
    assert.ok(x <= 1 + 1e-9, `dt=${dt} overshot to ${x}`);
  }
  assert.equal(springStep(3, 2, 9, 11, 0)[0], 3, 'a zero-length frame must change nothing');
});

test('exponential approach covers the same ground per second at any frame rate', () => {
  let a = 0, b = 0;
  for (let i = 0; i < 30; i++) a = expApproach(a, 1, 5, 1 / 30);
  for (let i = 0; i < 144; i++) b = expApproach(b, 1, 5, 1 / 144);
  assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
});
