import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
installCanvasStub();
const R = await import('../src/game/reactions.ts');
const { buildSoldier, buildArmoredSoldier } = await import('../src/game/models.ts');
const { TDMBot, BotSquad } = await import('../src/game/tdm.ts');
const { NavGrid } = await import('../src/game/ai.ts');

const { BodyReactions, chooseDeath, planFall, samplePose, deathDuration, pointBlocked, freeLength, forwardOf, hitZone, SLUMP_BELOW } = R;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function kill(model, info, ctx) {
  const scene = new THREE.Scene(); scene.add(model.group);
  model.group.position.copy(ctx.pos); model.group.rotation.set(0, ctx.yaw, 0);
  const r = new BodyReactions();
  const events = { impact: 0, clatter: 0 };
  r.die(model, info, { surfaceY: ctx.pos.y, solids: [], dropWeapon: true, ...ctx, onImpact: () => events.impact++, onClatter: () => events.clatter++ });
  let frames = 0;
  while (r.update(1 / 60, model) && frames < 600) frames++;
  model.group.updateMatrixWorld(true);
  return { r, scene, events, frames };
}
const worldY = o => o.getWorldPosition(new THREE.Vector3()).y;

test('death choice: zone, cause and shot direction relative to facing', () => {
  const yaw = 0; // facing −Z
  assert.equal(chooseDeath('head', false, yaw, V(0, 0, 1)), 'crumple');
  assert.equal(chooseDeath('limb', false, yaw, V(0, 0, 1)), 'kneel');
  assert.equal(chooseDeath('torso', true, yaw, V(0, 0, 1)), 'blast');
  assert.equal(chooseDeath('torso', false, yaw, V(0, 0, 1)), 'back', 'shot from the front travels +Z → falls on its back');
  assert.equal(chooseDeath('torso', false, yaw, V(0, 0, -1)), 'forward', 'shot from behind → pitched forward');
  assert.equal(chooseDeath('torso', false, yaw, V(1, 0, 0)), 'spin');
  assert.equal(hitZone('limb'), 'limb'); assert.equal(hitZone(undefined), 'torso');
});

test('pose sampling is continuous, starts from the live pose and ends at the last key', () => {
  const from = { tilt: 0, sink: 0, lift: 0, twist: 0, slide: 0, torsoX: 0.3, torsoZ: 0, headX: 0, headZ: 0, armLX: 1.2, armLZ: 0, armRX: 1.1, armRZ: 0, hipX: 0.4, kneeX: -0.3 };
  for (const v of ['crumple', 'back', 'forward', 'spin', 'kneel', 'blast', 'slump']) {
    const out = {};
    samplePose(v, 0, from, out);
    assert.ok(Math.abs(out.armLX - 1.2) < 1e-9, `${v}: t=0 equals the live pose`);
    let prev = { ...out }; let maxJump = 0;
    for (let t = 1 / 120; t <= deathDuration(v) + 0.2; t += 1 / 120) {
      samplePose(v, t, from, out);
      for (const k of Object.keys(out)) maxJump = Math.max(maxJump, Math.abs(out[k] - prev[k]));
      prev = { ...out };
    }
    // 120 Hz sampling: no channel may move more than 0.12 rad (or m) in one step — no pops.
    // An explosion is allowed to be violent (0.2 ≈ 24 rad/s limb fling).
    assert.ok(maxJump < (v === 'blast' ? 0.2 : 0.12), `${v}: largest per-step jump ${maxJump.toFixed(3)}`);
  }
});

test('open ground: every variant ends lying down, settles, thuds once and drops the rifle', () => {
  const cases = [
    ['head', false, V(0, 1.6, -10), 'crumple'], ['torso', false, V(0, 1.6, -10), 'back'], ['torso', false, V(0, 1.6, 10), 'forward'],
    ['torso', false, V(10, 1.6, 0), 'spin'], ['limb', false, V(0, 1.6, -10), 'kneel'], ['torso', true, V(0, 0.2, -3), 'blast'],
  ];
  for (const [zone, explosive, from, expected] of cases) {
    const model = buildSoldier();
    const { r, events, frames, scene } = kill(model, { zone, explosive, from }, { pos: V(0, 0, 0), yaw: 0 });
    assert.equal(r.variant, expected);
    assert.ok(r.isSettled, `${expected}: settled`);
    assert.ok(frames / 60 < 2.5, `${expected}: settles in ${(frames / 60).toFixed(2)} s`);
    assert.equal(events.impact, 1, `${expected}: exactly one body-fall thud`);
    assert.equal(events.clatter, 1, `${expected}: rifle clatters once`);
    const head = worldY(model.parts.head), torso = worldY(model.parts.torso);
    assert.ok(head < 0.6 && torso < 0.6, `${expected}: lying (head ${head.toFixed(2)}, hips ${torso.toFixed(2)})`);
    assert.ok(head > -0.2, `${expected}: head not buried (${head.toFixed(2)})`);
    const rifle = r.droppedRifle;
    assert.ok(rifle && rifle.parent === scene, `${expected}: rifle left the hands`);
    assert.ok(Math.abs(rifle.position.y - 0.035) < 0.01, `${expected}: rifle resting on the floor`);
    for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(model.group.position[k]));
  }
});

test('the body falls along the bullet\'s travel', () => {
  const model = buildSoldier();
  kill(model, { zone: 'torso', from: V(-10, 1.6, 0) }, { pos: V(0, 0, 0), yaw: Math.PI / 2 }); // facing −X, shot from −X
  const head = model.parts.head.getWorldPosition(new THREE.Vector3());
  assert.ok(head.x > 1.0, `head landed downrange (+X), got x=${head.x.toFixed(2)}`);
});

test('walls: a blocked fall turns aside, a boxed-in body slumps — never clips geometry', () => {
  const wallBehind = [{ minX: -3, maxX: 3, minY: 0, maxY: 3, minZ: 0.6, maxZ: 1.0 }];
  // shot from the front (travel +Z) with a wall 0.6 m behind: can't fall back → turns to a side
  const plan = planFall('back', V(0, 0, 1), 0, V(0, 0, 0), wallBehind);
  assert.ok(Math.abs(plan.dir.z) < 1e-6 && plan.variant === 'back', `re-routed sideways ${plan.dir.toArray()}`);
  // corridor 1.4 m wide with the wall behind: nowhere to topple → slump against it
  const box = [...wallBehind, { minX: 0.7, maxX: 1.2, minY: 0, maxY: 3, minZ: -3, maxZ: 3 }, { minX: -1.2, maxX: -0.7, minY: 0, maxY: 3, minZ: -3, maxZ: 3 }];
  const slump = planFall('back', V(0, 0, 1), 0, V(0, 0, 0), box);
  assert.equal(slump.variant, 'slump');
  assert.ok(slump.free < SLUMP_BELOW);
  // Full simulation in the box: body parts end outside every solid.
  const model = buildSoldier();
  const { r } = kill(model, { zone: 'torso', from: V(0, 1.6, -10) }, { pos: V(0, 0, 0), yaw: 0, solids: box });
  assert.equal(r.variant, 'slump');
  for (const part of [model.parts.head, model.parts.torso]) {
    const p = part.getWorldPosition(new THREE.Vector3());
    assert.ok(!pointBlocked(box, p.x, p.y, p.z), `${part === model.parts.head ? 'head' : 'hips'} inside a wall at ${p.toArray().map(v => v.toFixed(2))}`);
  }
  // sits with its back to the wall: facing −Z (away from the wall at +Z)
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(model.group.quaternion); fwd.y = 0; fwd.normalize();
  assert.ok(fwd.z < -0.8, `faces away from the wall (${fwd.toArray().map(v => v.toFixed(2))})`);
  assert.ok(worldY(model.parts.torso) < 0.6, 'sitting, hips on the floor');
});

test('partial room: tilt is capped so the head stops short of the wall', () => {
  const wall = [{ minX: -3, maxX: 3, minY: 0, maxY: 3, minZ: 1.3, maxZ: 1.7 }];
  const all = [...wall, { minX: 0.9, maxX: 1.4, minY: 0, maxY: 3, minZ: -3, maxZ: 3 }, { minX: -1.4, maxX: -0.9, minY: 0, maxY: 3, minZ: -3, maxZ: 3 }];
  assert.ok(freeLength(all, V(0, 0, 0), V(0, 0, 1)) >= SLUMP_BELOW);
  const model = buildSoldier();
  const { r } = kill(model, { zone: 'torso', from: V(0, 1.6, -10) }, { pos: V(0, 0, 0), yaw: 0, solids: all });
  assert.equal(r.variant, 'back');
  assert.ok(r.plan.tiltCap < Math.PI / 2);
  const head = model.parts.head.getWorldPosition(new THREE.Vector3());
  assert.ok(!pointBlocked(all, head.x, head.y, head.z) && head.z < 1.3, `head short of the wall (z=${head.z.toFixed(2)})`);
});

test('flinch: zone-specific, directional, and fully decays', () => {
  const model = buildSoldier(); const p = model.parts;
  const r = new BodyReactions();
  r.hit('head', V(0, 0, 1), 0);
  r.applyFlinch(0.04, p);
  assert.ok(p.head.rotation.x > 0.3, 'head snaps back');
  p.head.rotation.set(0, 0, 0); p.torso.rotation.set(0, 0, 0);
  r.hit('torso', V(0, 0, -1), 0); // from behind
  r.applyFlinch(0.04, p);
  assert.ok(p.torso.rotation.x < -0.2, 'shoved forward when shot from behind');
  p.torso.rotation.set(0, 0, 0);
  r.hit('torso', V(1, 0, 0), 0);  // travelling to the body's right
  r.applyFlinch(0.04, p);
  assert.ok(p.torso.rotation.y > 0.2, 'twists with a side hit');
  for (let i = 0; i < 60; i++) r.applyFlinch(1 / 60, p);
  assert.equal(r.flinchWeight(), 0);
});

test('defusal-style corpse hides its rifle instead of dropping a duplicate; reset restores everything', () => {
  const model = buildArmoredSoldier(1, 0x2C7C8E);
  const scene = new THREE.Scene(); scene.add(model.group);
  const rifle = model.parts.rifle, parent = rifle.parent, home = rifle.position.clone();
  const r = new BodyReactions();
  r.die(model, { zone: 'torso', from: V(0, 1.6, -5) }, { pos: V(0, 0, 0), yaw: 0, surfaceY: 0, solids: [], dropWeapon: false });
  assert.equal(rifle.visible, false); assert.equal(rifle.parent, parent);
  r.reset(model);
  assert.equal(rifle.visible, true);
  // dropping variant: rifle returns to the hands on reset
  const r2 = new BodyReactions();
  r2.die(model, { zone: 'torso', from: V(0, 1.6, -5) }, { pos: V(0, 0, 0), yaw: 0, surfaceY: 0, solids: [], dropWeapon: true });
  assert.equal(rifle.parent, scene);
  for (let i = 0; i < 200; i++) r2.update(1 / 60, model);
  r2.reset(model);
  assert.equal(rifle.parent, parent);
  assert.ok(rifle.position.distanceTo(home) < 1e-9);
  assert.equal(model.group.rotation.x, 0); assert.equal(model.group.rotation.z, 0);
  assert.equal(r2.variant, null);
  assert.ok(forwardOf(0).z === -1);
});

test('TDM bots: kill → procedural death → corpse hides with its rifle → respawn restores the rig', () => {
  const scene = new THREE.Scene();
  const effects = { bloodDecal() {}, tracer() {}, blood() {}, impact() {}, muzzle() {} };
  const solids = [];
  const falls = [], drops = [];
  const ctx = {
    scene, occluders: [], coverNodes: [], solids, half: 40, groundHeight: () => 0, effects,
    playerPos: () => V(0, 1.6, 30), playerFeet: () => V(0, 0, 30), playerAlive: () => false,
    damagePlayer() {}, moveCollide() {}, onCallout() {}, throwGrenade() {}, onBotFire() {}, onFeed() {}, onScore() {},
    onBodyFall: at => falls.push(at.clone()), onWeaponDrop: at => drops.push(at.clone()),
  };
  const mgr = { onDamage() {}, onIgnite() {}, handleKill() {} };
  const nav = new NavGrid(solids, 40, () => 0);
  const bots = [];
  for (let i = 0; i < 6; i++) bots.push(new TDMBot(ctx, mgr, nav, 'bravo', `B${i}`, 1, V(i * 4 - 10, 0, 0)));
  const dirs = [V(0, 1.6, -20), V(0, 1.6, 20), V(20, 1.6, 0), V(-20, 1.6, 0), V(5, 1.6, -5), V(0, 0.3, -2)];
  bots.forEach((b, i) => {
    b.noteHit({ from: dirs[i].clone().add(b.pos), zone: i === 4 ? 'limb' : i === 1 ? 'head' : 'torso', explosive: i === 5 });
    assert.equal(b.takeDamage(9999, i === 1, 'player', false), true);
  });
  const variants = new Set(bots.map(b => b.reactions.variant));
  assert.ok(variants.size >= 5, `varied deaths: ${[...variants]}`);
  for (let f = 0; f < 150; f++) for (const b of bots) b.updateVisualFrame(1 / 60);
  assert.equal(falls.length, 6, 'one thud per body');
  assert.equal(drops.length, 6, 'one clatter per rifle');
  for (const b of bots) assert.ok(b.reactions.isSettled);
  // TDM linger elapses → corpse and its dropped rifle vanish together
  for (let f = 0; f < 60 * 5; f++) for (const b of bots) b.updateVisualFrame(1 / 60);
  for (const b of bots) {
    assert.equal(b.model.group.visible, false);
    assert.equal(b.reactions.droppedRifle.visible, false, 'dropped rifle hides with the corpse');
  }
  const loose = scene.children.filter(c => c === bots[0].model.parts.rifle).length;
  assert.equal(loose, 1, 'rifle lives in the scene while dropped');
  for (const b of bots) b.respawn(V(0, 0, -30));
  for (const b of bots) {
    const p = b.model.parts;
    assert.equal(p.rifle.parent.parent, b.model.group, 'rifle back under the torso');
    assert.equal(p.rifle.visible, true);
    assert.equal(b.model.group.rotation.x, 0); assert.equal(b.model.group.rotation.z, 0);
    assert.equal(b.reactions.variant, null);
  }
  assert.equal(scene.children.filter(c => c.name === 'world AK rifle' || bots.some(b => b.model.parts.rifle === c)).length, 0, 'no rifles left on the floor');
  void BotSquad;
});

test('corpse audio: body fall and rifle clatter are spatial one-shots through a panner', async () => {
  const { installAudioStub } = await import('./helpers/audio.js');
  const { audio } = await import('../src/game/audio.ts');
  const restore = installAudioStub();
  const panners = [];
  const real = audio.createSpatialPanner.bind(audio);
  audio.createSpatialPanner = (x, y, z) => { panners.push([x, y, z]); return real(x, y, z); };
  try {
    audio.ensure();
    audio.bodyFallSpatial(1, 0, 2);
    audio.weaponClatterSpatial(3, 0, 4);
  } finally {
    audio.createSpatialPanner = real;
    restore();
  }
  assert.deepEqual(panners, [[1, 0, 2], [3, 0, 4]], 'each sound is placed at the body / rifle');
});

test('flinch leaves no permanent twist on channels the alive pose never resets', () => {
  const model = buildSoldier();
  const p = model.parts;
  const r = new BodyReactions();
  // Side hit → torso yaw twist + head roll; simulate a pose that only resets torso.x/head.x.
  r.hit('torso', new THREE.Vector3(1, 0, 0), 0);
  for (let i = 0; i < 120; i++) { p.torso.rotation.x = 0; p.head.rotation.x = 0; r.applyFlinch(1 / 60, p); }
  r.hit('head', new THREE.Vector3(-1, 0, 0), 0);
  for (let i = 0; i < 120; i++) { p.torso.rotation.x = 0; p.head.rotation.x = 0; r.applyFlinch(1 / 60, p); }
  assert.ok(Math.abs(p.torso.rotation.y) < 1e-9, `torso yaw drifted: ${p.torso.rotation.y}`);
  assert.ok(Math.abs(p.torso.rotation.z) < 1e-9, `torso roll drifted: ${p.torso.rotation.z}`);
  assert.ok(Math.abs(p.head.rotation.z) < 1e-9, `head roll drifted: ${p.head.rotation.z}`);
});
