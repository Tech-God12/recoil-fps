import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';
import { installAudioStub } from './helpers/audio.js';

// Real Web Audio graph stand-in: every kit sound runs its actual synthesis code.
installAudioStub();
installCanvasStub();

const kits = await import('../src/game/kits.ts');
const { KitCharge, KitDirector, KIT_TUNING, KIT_DEFS, KIT_IDS, KIT_LURE_BREAK_CHANCE, snapCardinal, barricadePlacement, sonarTagged, chooseLure, isKitId } = kits;
const { buildDart, buildBarricade, buildDecoy } = await import('../src/game/kit-models.ts');
const { Enemy, NavGrid, Squad } = await import('../src/game/ai.ts');
const { TDMManager } = await import('../src/game/tdm.ts');
const { sanitizeSettings, DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { KitSlot, KitPicker, KitPauseCard, KitHint } = await import('../src/ui/Kits.tsx');

// ------------------------------------------------------------------ pure ----

test('three kits, each with a named ability, a rule and a cooldown that matches the tuning table', () => {
  assert.deepEqual([...KIT_IDS], ['recon', 'bulwark', 'phantom']);
  assert.equal(KIT_DEFS.recon.cooldown, 30);
  assert.equal(KIT_DEFS.bulwark.cooldown, 40);
  assert.equal(KIT_DEFS.phantom.cooldown, 35);
  for (const id of KIT_IDS) {
    assert.ok(KIT_DEFS[id].ability && KIT_DEFS[id].blurb && KIT_DEFS[id].rule, id);
    assert.equal(KIT_DEFS[id].cooldown, KIT_TUNING[id].cooldown);
  }
  assert.ok(isKitId('phantom'));
  assert.ok(!isKitId('nuke'));
  assert.ok(!isKitId(3));
});

test('kit charge: spend gates on ready, ticks down, kill refunds shave 20 % of the full cooldown', () => {
  const c = new KitCharge(30, true);
  assert.ok(c.ready);
  assert.equal(c.pct, 1);
  assert.ok(c.spend());
  assert.ok(!c.spend(), 'cannot spend twice');
  assert.equal(c.left, 30);
  c.tick(10);
  assert.equal(c.left, 20);
  assert.ok(Math.abs(c.pct - 1 / 3) < 1e-9);
  c.refund(KIT_TUNING.killRefund);
  assert.equal(c.left, 14, 'a kill takes 6 s off a 30 s kit');
  c.refund(1);
  assert.equal(c.left, 0);
  assert.ok(c.ready);
  c.tick(-5);
  assert.equal(c.left, 0, 'negative time never un-readies');
  c.reset(40, false);
  assert.equal(c.left, 40);
  assert.ok(!c.ready);
});

test('barricade placement snaps to a cardinal axis, sits ahead of the feet and faces the look direction', () => {
  assert.deepEqual(snapCardinal(0.2, -0.9), { x: 0, z: -1 });
  assert.deepEqual(snapCardinal(-0.8, 0.5), { x: -1, z: 0 });
  const T = KIT_TUNING.bulwark;
  for (const dir of [{ x: 0, z: -1 }, { x: 1, z: 0.2 }, { x: -0.1, z: 0.9 }, { x: -0.95, z: -0.3 }]) {
    const p = barricadePlacement({ x: 5, y: 1, z: -3 }, dir);
    const f = snapCardinal(dir.x, dir.z);
    assert.ok(Math.abs(p.center.x - (5 + f.x * T.placeDist)) < 1e-9);
    assert.ok(Math.abs(p.center.z - (-3 + f.z * T.placeDist)) < 1e-9);
    // the model's -Z face must point along the snapped look direction
    const g = new THREE.Object3D(); g.rotation.y = p.yaw; g.updateMatrixWorld(true);
    const face = new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion);
    assert.ok(face.x * f.x + face.z * f.z > 0.999, `facing for ${JSON.stringify(dir)}`);
    // AABB: width across the look direction, thin along it, height 1.4 m from the feet
    const w = p.box.maxX - p.box.minX, d = p.box.maxZ - p.box.minZ;
    const across = f.x === 0 ? w : d, along = f.x === 0 ? d : w;
    assert.ok(Math.abs(across - T.width) < 1e-9);
    assert.ok(Math.abs(along - T.collideDepth) < 1e-9);
    assert.equal(p.box.minY, 1);
    assert.ok(Math.abs(p.box.maxY - (1 + T.height)) < 1e-9);
  }
  // A crouched eye (1.22) is under the wall, a standing eye (1.62) is over it.
  assert.ok(T.height > 1.22 && T.height < 1.62);
});

test('sonar tags by true distance (through walls) and the lure picker wants sight and range', () => {
  const pts = [{ pos: new THREE.Vector3(10, 0, 0) }, { pos: new THREE.Vector3(0, 0, 23.9) }, { pos: new THREE.Vector3(0, 0, 24.5) }, { pos: new THREE.Vector3(16, 18, 0) }];
  assert.deepEqual(sonarTagged(new THREE.Vector3(), 24, pts).map(p => pts.indexOf(p)), [0, 1], 'z=24.5 and the 24.1 m rooftop are outside');
  const mk = (x, active = true) => ({ eye: new THREE.Vector3(x, 1.5, 0), feet: new THREE.Vector3(x, 0, 0), active: () => active, hit() {} });
  const near = mk(8), far = mk(20), dead = mk(4, false), out = mk(40);
  const eye = new THREE.Vector3(0, 1.6, 0);
  assert.equal(chooseLure(eye, [far, near, dead, out], 32, () => true), near, 'nearest visible live lure');
  assert.equal(chooseLure(eye, [far, near], 32, (_f, to) => to.x > 10), far, 'hidden lure is skipped');
  assert.equal(chooseLure(eye, [out], 32, () => true), null, 'out of range');
  assert.ok(KIT_LURE_BREAK_CHANCE > 0 && KIT_LURE_BREAK_CHANCE < 1);
});

test('settings persist the field kit and reject forged values', () => {
  assert.equal(DEFAULT_SETTINGS.fieldKit, 'recon');
  assert.equal(sanitizeSettings({ fieldKit: 'bulwark' }).fieldKit, 'bulwark');
  assert.equal(sanitizeSettings({ fieldKit: 'nuke' }).fieldKit, 'recon');
  assert.equal(sanitizeSettings('{"fieldKit":"phantom"}').fieldKit, 'phantom');
});

test('kit hardware stays inside a small geometry budget', () => {
  for (const [name, group, maxTris, maxDraws] of [
    ['dart', buildDart().group, 400, 12], ['barricade', buildBarricade(2.4, 1.4, 0.12).group, 600, 20], ['decoy', buildDecoy().group, 600, 16],
  ]) {
    const b = geometryBudget(group);
    assert.ok(b.triangles < maxTris, `${name}: ${b.triangles} triangles`);
    assert.ok(b.draws < maxDraws, `${name}: ${b.draws} draws`);
  }
});

// -------------------------------------------------------------- headless ----

/** A flat 80 m yard with one wall at z = -12 and six hostiles. */
function fakeWorld() {
  const scene = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.5), new THREE.MeshBasicMaterial());
  wall.position.set(0, 2, -12); wall.updateMatrixWorld(true);
  scene.add(wall);
  const occluders = [wall];
  const solids = [];
  const hostiles = [
    new THREE.Vector3(3, 0, -20), new THREE.Vector3(-6, 0, -18), new THREE.Vector3(0, 0, -38),
    new THREE.Vector3(30, 0, 30), new THREE.Vector3(-8, 0, -26), new THREE.Vector3(40, 0, -40),
  ].map((pos, i) => ({ id: i, pos, hp: 100 }));
  const alerts = [];
  const messages = [];
  const player = { feet: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 0, -1), alive: true };
  const ctx = {
    scene, occluders,
    effects: { tracer() {}, enemyMuzzle() {}, glassShatter() {}, impact() {} },
    groundHeight: () => 0,
    playerFeet: () => player.feet.clone(),
    playerEye: () => player.feet.clone().add(new THREE.Vector3(0, 1.62, 0)),
    playerDir: () => player.dir.clone(),
    playerAlive: () => player.alive,
    hostiles: () => hostiles.map(h => ({ ref: h, pos: h.pos, alive: () => h.hp > 0 })),
    canPlaceBox: box => !solids.some(b => box.minX < b.maxX && box.maxX > b.minX && box.minZ < b.maxZ && box.maxZ > b.minZ),
    addBlocker: box => solids.push(box),
    removeBlocker: box => { const i = solids.indexOf(box); if (i >= 0) solids.splice(i, 1); },
    moveCollide: (p, dx, dz) => {
      const nx = p.x + dx, nz = p.z + dz;
      if (nz < -11.6 && p.z >= -11.6 && Math.abs(nx) < 10) return; // the wall
      p.x = nx; p.z = nz;
    },
    alertAt: (pos, radius) => alerts.push({ pos: pos.clone(), radius }),
    announce: text => messages.push(text),
  };
  return { scene, occluders, solids, hostiles, alerts, messages, player, ctx, wall };
}

const step = (d, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) d.update(dt); };

test('RECON: the dart flies, sticks in the wall, pings three times, tags only what is in range, alerts, and cleans up', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'recon');
  const baseline = w.scene.children.length;
  assert.ok(d.activate());
  assert.ok(!d.charge.ready, 'cooldown started');
  assert.equal(d.liveCount, 1);
  step(d, 1.0); // ≈0.47 s flight to the wall at 26 m/s + 0.4 s to the first ping
  const hud = d.hud();
  assert.equal(hud.live[0].kind, 'dart');
  assert.match(hud.live[0].detail, /PING 1\/3/);
  // stuck at the wall face (z ≈ -11.75), not through it
  const dart = w.scene.children.find(o => o.type === 'Group');
  assert.ok(dart.position.z > -12 && dart.position.z < -11.4, `dart z ${dart.position.z}`);
  // three hostiles within 24 m of the dart are tagged through the wall; the others are not
  const tagged = w.hostiles.filter(h => d.isRevealed(h)).map(h => h.id).sort();
  assert.deepEqual(tagged, [0, 1, 4]);
  assert.ok(w.messages.some(m => m === 'SONAR — 3 HOSTILES TAGGED'));
  assert.equal(hud.tagged, 3);
  step(d, 5.8);
  assert.equal(w.alerts.length, 3, 'every ping is audible');
  assert.ok(w.alerts.every(a => a.radius === KIT_TUNING.recon.hearRadius));
  assert.equal(d.liveCount, 0, 'dart retired after the last ping');
  step(d, 4);
  assert.ok(w.hostiles.every(h => !d.isRevealed(h)), 'tags fade');
  assert.equal(w.scene.children.length, baseline, 'scene back to the baseline (markers are pooled)');
  assert.equal(d.stats.darts, 1);
  d.dispose();
  assert.equal(w.scene.children.length, baseline - 16, 'marker pool removed on dispose');
});

test('BULWARK: the wall registers as an occluder + blocker, soaks 450 HP of hostile fire, and is removed when broken', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark');
  const occ = w.occluders.length;
  assert.ok(d.activate());
  assert.equal(w.solids.length, 1);
  const plates = w.occluders.slice(occ);
  assert.equal(plates.length, 3);
  assert.ok(plates.every(p => typeof p.userData.kitHit === 'function'));
  step(d, 0.3);
  // plates block a ray from a hostile's eye to a crouched player behind the wall
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.62, -15), new THREE.Vector3(0, 1.22, 0).sub(new THREE.Vector3(0, 1.62, -15)).normalize(), 0, 15);
  w.scene.updateMatrixWorld(true);
  const hit = ray.intersectObjects(w.occluders.slice(1), false)[0];
  assert.ok(hit && hit.object.userData.kitHit, 'crouched player is covered');
  // hostile fire: 30 hits of 10.5 do not break it, the rest does
  for (let i = 0; i < 30; i++) plates[i % 3].userData.kitHit(10.5);
  step(d, 0.1);
  assert.equal(d.liveCount, 1);
  assert.ok(Math.abs(d.hud().live[0].health - (450 - 315) / 450) < 1e-6);
  for (let i = 0; i < 13; i++) plates[i % 3].userData.kitHit(10.5);
  step(d, 0.1);
  assert.equal(d.liveCount, 0, 'broken');
  assert.equal(w.occluders.length, occ, 'plates removed from occluders');
  assert.equal(w.solids.length, 0, 'blocker removed');
  assert.ok(w.messages.includes('BARRICADE DESTROYED'));
  assert.ok(d.stats.barricadeDamage >= 450);
});

test('BULWARK: refused placement keeps the charge, walls expire after 22 s, and hostile frags crack them', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark');
  w.solids.push({ minX: -5, maxX: 5, minZ: -3, maxZ: 0, minY: 0, maxY: 3 });
  assert.equal(d.activate(), false);
  assert.ok(d.charge.ready, 'a refused placement does not eat the kit');
  assert.ok(w.messages.some(m => m.includes('NO ROOM')));
  w.solids.length = 0;
  assert.ok(d.activate());
  step(d, KIT_TUNING.bulwark.life - 0.5);
  assert.equal(d.liveCount, 1);
  step(d, 1);
  assert.equal(d.liveCount, 0, 'folded away at end of life');
  // frag: plant a fresh one after the cooldown, then blast it twice at the centre
  step(d, KIT_TUNING.bulwark.cooldown);
  assert.ok(d.charge.ready);
  assert.ok(d.activate());
  step(d, 0.3);
  d.blast(new THREE.Vector3(0, 0.7, -1.7), 7);
  step(d, 0.05);
  assert.equal(d.liveCount, 1, 'one frag is not enough');
  d.blast(new THREE.Vector3(0, 0.7, -1.7), 7);
  step(d, 0.05);
  assert.equal(d.liveCount, 0, 'two frags break it');
});

test('PHANTOM: the decoy runs ahead, fires audible blanks, lures sight-lines, dies to 120 damage and cleans up', () => {
  const w = fakeWorld();
  w.player.dir.set(1, 0, 0); // run along +X, away from the wall
  const d = new KitDirector(w.ctx, 'phantom');
  const baseline = w.scene.children.length;
  assert.ok(d.activate());
  step(d, KIT_TUNING.phantom.runFor + 0.5);
  const lure = d.lures()[0];
  assert.ok(lure, 'decoy is live');
  const ran = lure.feet.x;
  assert.ok(ran > 8 && ran < 10.5, `ran ${ran.toFixed(2)} m`);
  assert.ok(w.alerts.length >= 2 && w.alerts.every(a => a.radius === KIT_TUNING.phantom.noiseRadius), 'blank fire is heard at 28 m');
  // lure picking: a hostile in the open with eyes on it locks on; one behind the wall does not
  assert.equal(d.lureFor(new THREE.Vector3(ran + 12, 1.6, 4)), lure);
  assert.equal(d.lureFor(new THREE.Vector3(ran, 1.6, -20)), null, 'wall blocks the sight-line');
  assert.equal(d.lureFor(new THREE.Vector3(ran + 40, 1.6, 0)), null, 'beyond 32 m');
  // 119 damage leaves it standing, the 120th point pops it
  for (let i = 0; i < 7; i++) lure.hit(17);
  assert.ok(lure.active());
  lure.hit(1);
  assert.ok(!lure.active());
  step(d, 0.5);
  assert.equal(d.liveCount, 0);
  assert.equal(w.scene.children.length, baseline);
  assert.ok(w.messages.includes('DECOY DOWN'));
  assert.equal(d.stats.decoyHits, 8);
});

test('cooldown gate, kill refunds, the ready chime, onboarding hint and cold kit swaps', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'recon');
  assert.ok(d.hud().hint, 'fresh deployment shows the Z prompt');
  assert.ok(d.activate());
  assert.ok(!d.hud().hint, 'prompt gone after first use');
  assert.equal(d.activate(), false);
  assert.ok(w.messages.some(m => m.startsWith('SONAR DART RECHARGING')));
  d.onKill(2);
  step(d, 0.1);
  assert.ok(Math.abs(d.charge.left - (30 - 12 - 0.1)) < 0.05, `left ${d.charge.left}`);
  step(d, 18);
  assert.ok(d.charge.ready);
  assert.ok(w.messages.includes('SONAR DART READY — PRESS Z'));
  assert.ok(d.setKit('phantom'));
  assert.equal(d.kit, 'phantom');
  assert.ok(!d.charge.ready && d.charge.left === 35, 'swapped kit starts cold');
  assert.equal(d.setKit('phantom'), false);
  w.player.alive = false;
  step(d, 40);
  assert.equal(d.activate(), false, 'dead players cannot use kits');
  d.dispose();
});

// ------------------------------------------------------ real AI integration ----

function missionAiCtx(scene, occluders, playerDamage) {
  return {
    scene, occluders, solids: [], coverNodes: [], half: 60,
    effects: { bloodDecal() {}, enemyMuzzle() {}, tracer() {} },
    difficulty: { reaction: 0.3, accuracy: 0.9, flank: false, aggression: 0.8 },
    playerPos: () => new THREE.Vector3(0, 1.62, 45), playerFeet: () => new THREE.Vector3(0, 0, 45), playerAlive: () => true,
    playerVel: () => 0, playerStaticTime: () => 0, damagePlayer: amount => { playerDamage.push(amount); },
    moveCollide(p, x, z) { p.x += x; p.z += z; }, onCallout() {}, aiThrowGrenade() {}, onEnemyFire() {},
  };
}

test('mission AI: a lured soldier engages the decoy and every landed round hits it, never the player', () => {
  const scene = new THREE.Scene();
  const damage = [];
  const ctx = missionAiCtx(scene, [], damage);
  const nav = new NavGrid([], 60, () => 0);
  const squad = new Squad([new THREE.Vector3(0, 0, 0)]);
  const e = new Enemy(ctx, nav, squad, 'leader', new THREE.Vector3(0, 0, 0));
  squad.members.push(e);
  e.yaw = 0; // faces -Z; the player is 45 m behind him at +Z, outside his cone
  let hits = 0;
  const lure = { eye: new THREE.Vector3(0, 1.45, -12), feet: new THREE.Vector3(0, 0, -12), active: () => true, hit: () => { hits++; } };
  e.lure = lure;
  for (let i = 0; i < 60 * 8; i++) { e.updateLogic(1 / 60); e.updateVisualFrame(1 / 60); }
  assert.ok(e.state === 'ENGAGE' || e.state === 'SUPPRESS' || e.state === 'ADVANCE', `state ${e.state}`);
  assert.ok(hits > 3, `decoy took ${hits} rounds`);
  assert.equal(damage.length, 0, 'the player was never hit');
});

test('mission AI: rounds that stop on a barricade plate damage it', () => {
  const scene = new THREE.Scene();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.12), new THREE.MeshBasicMaterial());
  plate.position.set(0, 1.4, -4); plate.updateMatrixWorld(true);
  let soaked = 0;
  plate.userData.kitHit = n => { soaked += n; };
  const damage = [];
  const ctx = missionAiCtx(scene, [plate], damage);
  ctx.playerPos = () => new THREE.Vector3(0, 1.22, -8);
  ctx.playerFeet = () => new THREE.Vector3(0, 0, -8);
  const e = new Enemy(ctx, new NavGrid([], 60, () => 0), new Squad([new THREE.Vector3()]), 'leader', new THREE.Vector3(0, 0, 0));
  e.yaw = 0;
  // Force the shot path directly: the barricade sits between the muzzle and the player.
  for (let i = 0; i < 12; i++) e['fireShot']();
  assert.ok(soaked >= 12 * 7 && soaked <= 12 * 14, `plate soaked ${soaked}`);
  assert.equal(damage.length, 0);
});

test('TDM bots: bravo prefers a visible decoy, shoots it, and dents barricades; alpha ignores decoys', () => {
  const scene = new THREE.Scene();
  let lureHits = 0;
  const lure = { eye: new THREE.Vector3(0, 1.45, 0), feet: new THREE.Vector3(0, 0, 0), active: () => true, hit: () => { lureHits++; } };
  const plate = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.2), new THREE.MeshBasicMaterial());
  plate.visible = true;
  let soaked = 0;
  plate.userData.kitHit = n => { soaked += n; };
  const occluders = [];
  const ctx = {
    scene, occluders, coverNodes: [], solids: [], half: 50, groundHeight: () => 0,
    effects: { tracer() {}, enemyMuzzle() {}, blood() {}, bloodDecal() {} },
    playerPos: () => new THREE.Vector3(0, 1.6, 45), playerFeet: () => new THREE.Vector3(0, 0, 45), playerAlive: () => true,
    damagePlayer() { throw new Error('player must not be hit while the decoy is the target'); },
    moveCollide(p, dx, dz) { p.x += dx; p.z += dz; }, onCallout() {}, throwGrenade() {}, onBotFire() {},
    onFeed() {}, onScore() {}, playerOnFire: () => false,
    lureFor: () => lure,
  };
  const mgr = new TDMManager(ctx);
  const bravo = mgr.bots.find(b => b.team === 'bravo');
  const alpha = mgr.bots.find(b => b.team === 'alpha');
  bravo.pos.set(0, 0, -10);
  const t = bravo['acquireTarget']();
  assert.equal(t.lure, lure, 'bravo locks the decoy');
  const ta = alpha['acquireTarget']();
  assert.ok(!ta || !ta.lure, 'allies never target the decoy');
  const saved = Math.random;
  try {
    Math.random = () => 0; // every accuracy roll lands
    for (let i = 0; i < 5; i++) bravo['fireShot'](t);
    assert.equal(lureHits, 5);
    // now put a barricade plate between the bot and the decoy
    plate.position.set(0, 1.5, -5); plate.updateMatrixWorld(true);
    occluders.push(plate);
    for (let i = 0; i < 4; i++) bravo['fireShot'](t);
    assert.equal(lureHits, 5, 'the wall stopped those rounds');
    assert.ok(soaked >= 4 * 18, `plate soaked ${soaked}`);
    // shooting a lured bot snaps it out of the illusion (random 0 < 0.5 → break)
    bravo.takeDamage(10, false, 'player');
    assert.ok(bravo.lureImmuneT > 0);
    const t2 = bravo['acquireTarget']();
    assert.ok(!t2 || !t2.lure, 'immune bots look past the decoy');
  } finally { Math.random = saved; }
  mgr.dispose?.();
});

// ------------------------------------------------------------------- UI ----

test('HUD slot, onboarding prompt, deploy picker and pause card all render with the Z key on screen', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark');
  const hud = d.hud();
  const slot = renderToStaticMarkup(React.createElement(KitSlot, { kit: hud }));
  assert.match(slot, /BULWARK/);
  assert.match(slot, /Barricade/);
  assert.match(slot, /keycap">Z</);
  assert.match(slot, /READY/);
  const hint = renderToStaticMarkup(React.createElement(KitHint, { kit: hud }));
  assert.match(hint, /Press <span class="keycap">Z<\/span>/);
  const picker = renderToStaticMarkup(React.createElement(KitPicker, { value: 'phantom', onChange() {} }));
  assert.equal((picker.match(/role="radio"/g) ?? []).length, 3);
  assert.match(picker, /aria-checked="true"[^>]*kit-phantom|kit-phantom[^"]*on/);
  assert.match(picker, /120 HP · 10s · 35s/);
  d.activate();
  const pause = renderToStaticMarkup(React.createElement(KitPauseCard, { kit: d.hud(), onKit() {} }));
  assert.match(pause, /EQUIPPED/);
  assert.equal((pause.match(/SWAP/g) ?? []).length, 2);
  assert.match(pause, /full cooldown/);
  d.dispose();
});

// ------------------------------------------------ engine wiring, real map ----

test('engine wiring on the real warehouse: placement checks, live collision, hittables and full kit lifecycle', async () => {
  const { buildWorld } = await import('../src/game/world.ts');
  const { Engine } = await import('../src/game/engine.ts');
  const { Effects } = await import('../src/game/effects.ts');
  const scene = new THREE.Scene();
  const world = buildWorld(scene, 'arena');
  // A bare engine carrying only what the kit bridge touches, with the real methods.
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    scene, world, effects: new Effects(scene), solidGrid: new Map(), GRID_CELL: 4, scratch: [], hittables: [],
    _t1: new THREE.Vector3(), pos: new THREE.Vector3(), dead: false, ended: false, isTDM: false, tdm: null,
    ai: { enemies: [], notifyGunshot() {}, nav: new NavGrid(world.solids, world.half, world.groundHeight), invalidatePaths() { this.repaths = (this.repaths ?? 0) + 1; } },
    camera: { getWorldDirection: v => v.set(0, 0, -1) },
    eyePos() { return this.pos.clone().add(new THREE.Vector3(0, 1.62, 0)); },
    onEvent() {},
  });
  engine.buildSolidGrid();
  // find an open spot: a point whose 3 m surroundings are free of tall solids
  let open = null;
  for (let x = -30; x <= 30 && !open; x += 2) for (let z = -30; z <= 30 && !open; z += 2) {
    const clear = !world.solids.some(b => b.maxY > 0.6 && x + 3 > b.minX && x - 3 < b.maxX && z + 3 > b.minZ && z - 3 < b.maxZ);
    if (clear) open = new THREE.Vector3(x, world.groundHeight(x, z), z);
  }
  assert.ok(open, 'the warehouse has open floor');
  engine.pos.copy(open);
  const ctx = engine.kitContext();
  const d = new KitDirector(ctx, 'bulwark');
  const solidsBefore = world.solids.length, occBefore = world.occluders.length;
  const navBlocked = () => engine.ai.nav.blocked.reduce((a, b) => a + (b ? 1 : 0), 0);
  const navBefore = navBlocked();
  assert.ok(d.activate(), 'placed on open floor');
  assert.ok(navBlocked() > navBefore, 'AI nav grid now routes around the wall');
  assert.equal(engine.ai.repaths, 1, 'live AI paths were invalidated');
  assert.equal(world.solids.length, solidsBefore + 1);
  assert.equal(world.occluders.length, occBefore + 3);
  assert.equal(engine.hittables.length, world.occluders.length + (world.glass ? 1 : 0), 'player bullets now stop on the wall');
  // the player cannot walk through it
  const p = open.clone();
  engine.moveAxis(p, 0, -4, 0.35, 1.8);
  assert.ok(p.z > open.z - KIT_TUNING.bulwark.placeDist, `walked to z=${p.z.toFixed(2)} from ${open.z}`);
  // placement into a wall is refused
  const wall = world.solids.find(b => b.maxY > 2 && b.maxX - b.minX > 3);
  assert.ok(!ctx.canPlaceBox({ minX: wall.minX, maxX: wall.minX + 2, minZ: wall.minZ, maxZ: wall.minZ + 0.3, minY: 0, maxY: 1.4 }));
  step(d, KIT_TUNING.bulwark.life + 0.5);
  assert.equal(world.solids.length, solidsBefore, 'blocker lifted after expiry');
  assert.equal(world.occluders.length, occBefore);
  assert.equal(navBlocked(), navBefore, 'nav grid restored');
  const q = open.clone();
  engine.moveAxis(q, 0, -4, 0.35, 1.8);
  assert.ok(q.z < open.z - 3, 'path is open again');
  d.dispose();
});
