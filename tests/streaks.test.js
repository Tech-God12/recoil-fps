import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { StreakLadder, STREAK_LADDER, STREAK_POINTS, streakDef } = await import('../src/game/streaks.ts');

test('ladder is ordered, ascending and matches the CoD-style tiering', () => {
  assert.deepEqual(STREAK_LADDER.map(s => s.id), ['uav', 'airstrike', 'sentry', 'chopper', 'nuke']);
  for (let i = 1; i < STREAK_LADDER.length; i++) assert.ok(STREAK_LADDER[i].cost > STREAK_LADDER[i - 1].cost, `${STREAK_LADDER[i].id} must cost more than ${STREAK_LADDER[i - 1].id}`);
  assert.equal(streakDef('uav').cost, 400);
  assert.equal(streakDef('nuke').cost, 2500);
  assert.equal(STREAK_POINTS.headshot, 150);
});

test('points arm streaks in order and each threshold is claimed once per life', () => {
  const l = new StreakLadder();
  assert.deepEqual(l.addPoints(300), []);
  assert.deepEqual(l.addPoints(100).map(s => s.id), ['uav']);
  assert.ok(l.has('uav'));
  // more points do not re-arm a claimed tier
  assert.deepEqual(l.addPoints(100), []);
  // a big jump can arm several tiers at once, in ladder order
  assert.deepEqual(l.addPoints(600).map(s => s.id), ['airstrike', 'sentry']);
  assert.equal(l.points, 1100);
  assert.deepEqual(l.earned, ['uav', 'airstrike', 'sentry']);
});

test('next() reports the upcoming tier with progress measured from the previous one', () => {
  const l = new StreakLadder();
  l.addPoints(550);
  const n = l.next();
  assert.equal(n.def.id, 'airstrike');
  assert.equal(n.remaining, 150);
  assert.ok(Math.abs(n.pct - 0.5) < 1e-9, 'halfway between 400 and 700');
  l.addPoints(2000);
  assert.equal(l.next(), null, 'ladder complete');
});

test('death resets progress but earned streaks survive; consumed streaks are gone', () => {
  const l = new StreakLadder();
  l.addPoints(1000);
  assert.deepEqual(l.earned, ['uav', 'airstrike', 'sentry']);
  l.onDeath();
  assert.equal(l.points, 0);
  assert.deepEqual(l.earned, ['uav', 'airstrike', 'sentry'], 'streaks in your pocket persist across death');
  assert.equal(l.next().def.id, 'uav', 'the ladder restarts from the bottom');
  assert.ok(l.consume('sentry'));
  assert.ok(!l.has('sentry'));
  assert.ok(!l.consume('sentry'), 'cannot spend twice');
  // re-earning the same tier after death only arms it if it is not already held
  assert.deepEqual(l.addPoints(400), [], 'UAV is still held, so no duplicate');
  assert.deepEqual(l.addPoints(600).map(s => s.id), ['sentry'], 'a spent tier can be earned again next life');
});

test('streak points are never awarded for zero or negative input', () => {
  const l = new StreakLadder();
  assert.deepEqual(l.addPoints(0), []);
  assert.deepEqual(l.addPoints(-50), []);
  assert.equal(l.points, 0);
});

// ---------------------------------------------------------------------------------
// Headless director smoke: every streak spawns, engages fake hostiles and despawns
// without touching a renderer, a browser or the Web Audio API.
// ---------------------------------------------------------------------------------
import * as THREE from 'three';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';
const { StreakDirector } = await import('../src/game/streaks.ts');
const { audio, SpatialAudioEngine } = await import('../src/game/audio.ts');
const { buildChopper, buildSentry, buildJet, buildUav } = await import('../src/game/streak-models.ts');

function silence() {
  const saved = {};
  for (const k of Object.getOwnPropertyNames(SpatialAudioEngine.prototype)) {
    if (k === 'constructor') continue;
    saved[k] = audio[k];
    audio[k] = k === 'rotorLoop' ? () => ({ move() {}, stop() {} }) : () => {};
  }
  return () => { for (const k in saved) audio[k] = saved[k]; };
}

function fakeWorld() {
  const scene = new THREE.Scene();
  const effects = { tracer() {}, blood() {}, impact() {}, explosion() {}, glassShatter() {} };
  const hostiles = Array.from({ length: 6 }, (_, i) => ({ pos: new THREE.Vector3(8 + i * 3, 0, -6 + i * 2), hp: 100, killedBy: null }));
  const blasts = [];
  const messages = [];
  let nuked = 0;
  const targets = () => hostiles.map(h => ({
    pos: h.pos,
    alive: () => h.hp > 0,
    damage: (amount, source) => { if (h.hp <= 0) return false; h.hp -= amount; if (h.hp <= 0) { h.killedBy = source; return true; } return false; },
  }));
  const ctx = {
    scene, effects, occluders: [], half: 100, isTDM: false,
    groundHeight: () => 0,
    playerFeet: () => new THREE.Vector3(0, 0, 0),
    playerEye: () => new THREE.Vector3(0, 1.6, 0),
    playerDir: () => new THREE.Vector3(1, 0, 0),
    playerAlive: () => true,
    targets,
    blast: (pos, radius, maxDamage, source) => {
      blasts.push({ pos: pos.clone(), radius, maxDamage, source });
      for (const t of targets()) if (t.alive() && t.pos.distanceTo(pos) < radius) t.damage(maxDamage, source);
    },
    aimPoint: () => new THREE.Vector3(30, 0, 0),
    canPlace: () => true,
    announce: text => messages.push(text),
    shake() {},
    onNuke: () => { nuked++; for (const t of targets()) if (t.alive()) t.damage(9999, 'nuke'); },
  };
  return { scene, hostiles, blasts, messages, ctx, nuked: () => nuked };
}

test('streak hardware stays inside a soldier-sized geometry budget', () => {
  const restore = installCanvasStub();
  try {
    for (const [name, group, maxTris] of [
      ['sentry', buildSentry().group, 2500], ['chopper', buildChopper().group, 4000], ['jet', buildJet(), 2000], ['uav', buildUav().group, 2000],
    ]) {
      const b = geometryBudget(group);
      assert.ok(b.triangles < maxTris, `${name}: ${b.triangles} triangles`);
      assert.ok(b.draws < 60, `${name}: ${b.draws} draws`);
    }
  } finally { restore(); }
});

test('sentry, UAV, chopper and airstrike all engage hostiles headlessly and clean up', () => {
  const restore = installCanvasStub();
  const unmute = silence();
  try {
    const w = fakeWorld();
    const d = new StreakDirector(w.ctx);
    assert.equal(d.activate('sentry'), false, 'nothing is armed yet');
    d.addPoints(1500);
    assert.ok(d.ladder.has('chopper'));
    assert.ok(w.messages.some(m => m.includes('ATTACK HELICOPTER READY')), 'arming is announced');
    const before = w.scene.children.length;
    assert.ok(d.activate('uav'));
    assert.ok(d.activate('sentry'));
    assert.ok(d.activate('chopper'));
    assert.ok(d.uavActive);
    assert.ok(w.scene.children.length > before, 'entities were added to the scene');
    let hud = d.hud();
    assert.equal(hud.active.length, 3);
    assert.ok(hud.uav);
    // airstrike: designate → confirm
    assert.ok(d.activate('airstrike'));
    assert.ok(d.designating);
    assert.ok(d.confirmStrike());
    assert.ok(!d.designating);
    assert.ok(!d.ladder.has('airstrike'), 'strike consumed on confirm, not on designation');
    // run 90 simulated seconds at 60 Hz
    for (let i = 0; i < 90 * 60; i++) d.update(1 / 60);
    assert.ok(w.blasts.length === 7, `airstrike dropped ${w.blasts.length} bombs`);
    assert.ok(w.blasts.every(b => b.source === 'airstrike'));
    const dead = w.hostiles.filter(h => h.hp <= 0);
    assert.ok(dead.length >= 4, `streaks killed ${dead.length}/6 hostiles`);
    assert.ok(w.hostiles.some(h => h.killedBy === 'sentry' || h.killedBy === 'chopper' || h.killedBy === 'airstrike'));
    hud = d.hud();
    assert.equal(hud.active.length, 0, 'everything expired');
    assert.ok(!hud.uav);
    assert.equal(w.scene.children.length, before, 'scene fully cleaned up after expiry');
    d.dispose();
  } finally { unmute(); restore(); }
});

test('tactical nuke counts down ten seconds then resolves exactly once', () => {
  const restore = installCanvasStub();
  const unmute = silence();
  try {
    const w = fakeWorld();
    const d = new StreakDirector(w.ctx);
    d.addPoints(2500);
    assert.ok(d.activate('nuke'));
    assert.ok(!d.activate('nuke'), 'no double nuke');
    assert.ok(d.nukeCountdown > 9.9);
    for (let i = 0; i < 9 * 60; i++) d.update(1 / 60);
    assert.equal(w.nuked(), 0);
    assert.ok(d.nukeCountdown <= 1.05);
    for (let i = 0; i < 3 * 60; i++) d.update(1 / 60);
    assert.equal(w.nuked(), 1);
    assert.equal(d.nukeCountdown, null);
    assert.ok(w.hostiles.every(h => h.hp <= 0 && h.killedBy === 'nuke'));
    d.dispose();
  } finally { unmute(); restore(); }
});

test('sentry placement is refused on blocked ground and the streak is kept', () => {
  const restore = installCanvasStub();
  const unmute = silence();
  try {
    const w = fakeWorld();
    w.ctx.canPlace = () => false;
    const d = new StreakDirector(w.ctx);
    d.addPoints(1000);
    assert.equal(d.activate('sentry'), false);
    assert.ok(d.ladder.has('sentry'), 'a refused placement must not eat the streak');
    assert.ok(w.messages.some(m => m.includes('NO ROOM')));
  } finally { unmute(); restore(); }
});

test('a deployed sentry physically points its barrels at the hostile it is shooting', () => {
  const restore = installCanvasStub();
  const unmute = silence();
  try {
    const w = fakeWorld();
    // one hostile, off-axis and slightly elevated, so both yaw and pitch matter
    w.hostiles.length = 1;
    w.hostiles[0].pos.set(-14, 3, 9);
    w.hostiles[0].hp = 1e9;
    w.ctx.playerDir = () => new THREE.Vector3(0.6, 0, -0.8).normalize(); // sentry deploys facing an unrelated way
    const d = new StreakDirector(w.ctx);
    d.addPoints(1000);
    assert.ok(d.activate('sentry'));
    for (let i = 0; i < 4 * 60; i++) d.update(1 / 60);
    const sentry = w.scene.children.find(o => o.type === 'Group' && o.children.some(c => c.type === 'Group'));
    const yawPivot = sentry.children.find(c => c.type === 'Group');
    const pitchPivot = yawPivot.children.find(c => c.type === 'Group');
    pitchPivot.updateWorldMatrix(true, false);
    const forward = pitchPivot.getWorldDirection(new THREE.Vector3()).negate(); // barrels run along local -Z
    const head = pitchPivot.getWorldPosition(new THREE.Vector3());
    const want = new THREE.Vector3(-14, 3 + 1.05, 9).sub(head).normalize();
    assert.ok(forward.dot(want) > 0.995, `barrel/target misalignment: ${forward.toArray().map(v => v.toFixed(2))} vs ${want.toArray().map(v => v.toFixed(2))}`);
  } finally { unmute(); restore(); }
});

test('airstrike refuses danger-close targets and runs its bomb line across the line of sight', () => {
  const restore = installCanvasStub();
  const unmute = silence();
  try {
    const w = fakeWorld();
    const d = new StreakDirector(w.ctx);
    d.addPoints(700);
    d.activate('airstrike');
    w.ctx.aimPoint = () => new THREE.Vector3(10, 0, 0);
    assert.equal(d.confirmStrike(), false, 'too close');
    assert.ok(d.designating && d.ladder.has('airstrike'), 'still designating, streak intact');
    w.ctx.aimPoint = () => new THREE.Vector3(40, 0, 0);
    assert.ok(d.confirmStrike());
    for (let i = 0; i < 20 * 60; i++) d.update(1 / 60);
    assert.equal(w.blasts.length, 7);
    const xs = w.blasts.map(b => b.pos.x), zs = w.blasts.map(b => b.pos.z);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 4, 'line does not extend toward/away from the player');
    assert.ok(Math.max(...zs) - Math.min(...zs) > 25, 'line sweeps across the view');
    assert.ok(w.blasts.every(b => b.pos.distanceTo(new THREE.Vector3(0, 0, 0)) > 30), 'no splash near the designator');
  } finally { unmute(); restore(); }
});
