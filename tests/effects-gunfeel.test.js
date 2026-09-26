// Muzzle residue + ejected brass: the two new per-shot effects. Verified against
// the real pools headless — budget, short rise, bounce, and expiry.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const { Effects } = await import('../src/game/effects.ts');

function rig() {
  const scene = new THREE.Scene();
  const fx = new Effects(scene);
  const any = fx;
  const playerPos = new THREE.Vector3(0, 0, 0);
  return { scene, fx, any, playerPos };
}

test('muzzle residue reuses the burst pool and stays too brief to obscure a firefight', () => {
  const { fx, any } = rig();
  const at = new THREE.Vector3(0, 1.5, -1);
  fx.gunSmoke(at);
  const residue = any.bursts.filter(s => s.active);
  assert.equal(residue.length, 1, 'first shot emits one small residue burst');
  assert.equal(residue[0].count, 1, 'a propellant trace is not a sight-obscuring cloud');
  assert.equal(residue[0].maxLife, 0.08, 'residue clears in 80 ms');
  assert.equal(residue[0].mat.size, 0.025, 'residue stays visually fine-grained');
  fx.gunSmoke(at);
  fx.gunSmoke(at);
  assert.equal(any.bursts.filter(s => s.active).length, 3, 'rapid fire uses the preallocated ring rather than a new particle system');
});

test('muzzle residue lifts briefly and clears inside 80 ms', () => {
  const { fx, any, playerPos } = rig();
  fx.gunSmoke(new THREE.Vector3(0, 1.5, 0));
  const slot = any.bursts.find(s => s.active);
  const y0 = slot.pos[1];
  fx.update(0.02, playerPos);
  assert.ok(slot.pos[1] >= y0, `residue should not fall before it dissipates (moved ${(slot.pos[1] - y0).toFixed(3)})`);
  assert.ok(slot.active, 'residue must still be visible during its 80 ms lifetime');
  fx.update(0.07, playerPos);
  assert.equal(slot.active, false, 'residue must clear after its 80 ms life');
  assert.equal(slot.points.visible, false);
});

test('brass ejects right-and-up and lands in the instance buffer', () => {
  const { fx, any, playerPos } = rig();
  assert.equal(any.brass.count, 0, 'an unfired gun must cost zero draws');
  fx.ejectBrass(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(1, 0, 0));
  assert.ok(Math.abs(any.brassLife[0] - 1.6) < 1e-6, 'casing life must be 1.6 s');
  assert.ok(any.brassVel[0] > 1.0, `casing must fly right (+x), got ${any.brassVel[0].toFixed(2)}`);
  assert.ok(any.brassVel[1] > 1.5, `casing must pop up, got ${any.brassVel[1].toFixed(2)}`);
  fx.update(0.016, playerPos);
  assert.equal(any.brass.count, 12, 'first eject must re-arm the full ring');
  const m = new THREE.Matrix4();
  any.brass.getMatrixAt(0, m);
  assert.ok(Math.abs(m.elements[12] - any.brassPos[0]) < 1e-6, 'instance 0 must track the casing');
  assert.ok(m.elements[0] !== 0, 'live casing must render at full scale');
});

test('brass bounces on the footing plane and parks at scale 0 when spent', () => {
  const { fx, any, playerPos } = rig();
  fx.ejectBrass(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(1, 0, 0));
  const floorY = playerPos.y + 0.012;
  let minY = Infinity;
  for (let i = 0; i < 120; i++) {
    fx.update(0.02, playerPos); // 2.4 s of flight
    minY = Math.min(minY, any.brassPos[1]);
  }
  assert.ok(minY >= floorY - 1e-6, `casing tunneled the floor (min ${minY.toFixed(4)})`);
  assert.ok(any.brassLife[0] <= 0, 'casing must expire after 1.6 s');
  const m = new THREE.Matrix4();
  any.brass.getMatrixAt(0, m);
  assert.ok(Math.abs(m.elements[0]) < 1e-6, 'spent casing must park at scale 0');
  assert.equal(any.brass.count, 0, 'an expired ring must release its draw call');
});

test('dispose releases the brass buffer without throwing', () => {
  const { fx } = rig();
  assert.doesNotThrow(() => fx.dispose());
});
