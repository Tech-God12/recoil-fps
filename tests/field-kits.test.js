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
const { KitCharge, KitDirector, KIT_TUNING, KIT_DEFS, KIT_IDS, KIT_PRICES, KIT_LURE_BREAK_CHANCE, snapCardinal, barricadePlacement, sonarTagged, chooseLure, isKitId, recallRefundSeconds, burstVictims } = kits;
const { buyKit, equipKit, readKits } = await import('../src/game/economy/kit-shop.ts');
const { DEFAULT_PROFILE, migrateProfile } = await import('../src/game/economy/profile.ts');
const { buildDart, buildBarricade, buildDecoy } = await import('../src/game/kit-models.ts');
const { Enemy, NavGrid, Squad } = await import('../src/game/ai.ts');
const { TDMManager } = await import('../src/game/tdm.ts');
const { sanitizeSettings, DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { KitSlot, KitEquipButton, KitPauseCard, KitHint, KitFx } = await import('../src/ui/Kits.tsx');
const { default: KitsMenu } = await import('../src/ui/KitsMenu.tsx');
const { PauseMenu } = await import('../src/ui/Screens.tsx');

// ------------------------------------------------------------------ pure ----

test('exactly three kits, each with a named ability, price, steps, stats and a cooldown that matches the tuning table', () => {
  assert.deepEqual([...KIT_IDS], ['recon', 'bulwark', 'phantom']);
  assert.equal(Object.keys(KIT_DEFS).length, 3);
  assert.equal(KIT_DEFS.recon.cooldown, 45);
  assert.equal(KIT_DEFS.bulwark.cooldown, 60);
  assert.equal(KIT_DEFS.phantom.cooldown, 50);
  for (const id of KIT_IDS) {
    const d = KIT_DEFS[id];
    assert.ok(d.ability && d.blurb && d.rule, id);
    assert.equal(d.cooldown, KIT_TUNING[id].cooldown);
    assert.equal(d.price, KIT_PRICES[id]);
    assert.ok(d.price > 0);
    assert.equal(d.steps.length, 3);
    assert.ok(d.stats.every(s => s.bar > 0 && s.bar <= 1 && s.value), id);
  }
  // A kill is worth 8 % and never more than 30 % of one charge: no refilling off two kills.
  assert.equal(KIT_TUNING.killRefund, 0.08);
  assert.equal(KIT_TUNING.refundCap, 0.3);
  assert.equal(KIT_TUNING.deployCharge, 0.5);
  assert.ok(isKitId('phantom'));
  assert.ok(!isKitId('nuke'));
  assert.ok(!isKitId(3));
});

test('kit charge: spend gates on ready, ticks down, kill refunds are small and capped per charge', () => {
  const half = new KitCharge(50, 0.5);
  assert.equal(half.left, 25, 'a half-charged kit waits half a cooldown');
  assert.ok(!half.ready);
  const c = new KitCharge(30);
  assert.ok(c.ready);
  assert.equal(c.pct, 1);
  assert.ok(c.spend());
  assert.ok(!c.spend(), 'cannot spend twice');
  assert.equal(c.left, 30);
  c.tick(10);
  assert.equal(c.left, 20);
  assert.ok(Math.abs(c.pct - 1 / 3) < 1e-9);
  c.refund(KIT_TUNING.killRefund, KIT_TUNING.refundCap);
  assert.ok(Math.abs(c.left - 17.6) < 1e-9, 'a kill takes 2.4 s off a 30 s kit');
  for (let i = 0; i < 10; i++) c.refund(KIT_TUNING.killRefund, KIT_TUNING.refundCap);
  assert.ok(Math.abs(c.left - (20 - 9)) < 1e-9, `ten more kills stop at the 30 % cap (left ${c.left})`);
  c.bank(100);
  assert.equal(c.left, 0);
  assert.ok(c.ready);
  c.tick(-5);
  assert.equal(c.left, 0, 'negative time never un-readies');
  assert.ok(c.spend());
  assert.equal(c.refunded, 0, 'the cap resets with each spend');
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

test('kits are bought, not given: shop rules, equip rules and save migration', () => {
  assert.deepEqual(DEFAULT_PROFILE.ownedKits, [], 'new players own no kit');
  assert.equal(DEFAULT_PROFILE.equippedKit, null, 'and spawn without one');
  assert.ok(!('fieldKit' in DEFAULT_SETTINGS), 'the old free settings kit is gone');
  assert.ok(!('fieldKit' in sanitizeSettings('{"fieldKit":"phantom"}')));
  const broke = { ...DEFAULT_PROFILE, cash: 1000 };
  assert.deepEqual(buyKit(broke, 'recon'), { ok: false, error: 'INSUFFICIENT_FUNDS' });
  assert.deepEqual(buyKit(broke, 'nuke'), { ok: false, error: 'UNKNOWN' });
  assert.deepEqual(equipKit(broke, 'recon'), { ok: false, error: 'NOT_OWNED' });
  const rich = { ...DEFAULT_PROFILE, cash: 20000 };
  const a = buyKit(rich, 'bulwark');
  assert.ok(a.ok);
  assert.equal(a.value.cash, 20000 - KIT_PRICES.bulwark);
  assert.deepEqual(a.value.ownedKits, ['bulwark']);
  assert.equal(a.value.equippedKit, 'bulwark', 'the first kit bought is equipped');
  assert.deepEqual(buyKit(a.value, 'bulwark'), { ok: false, error: 'ALREADY_OWNED' });
  const b = buyKit(a.value, 'recon');
  assert.ok(b.ok);
  assert.equal(b.value.equippedKit, 'bulwark', 'buying a second kit keeps the current one equipped');
  const c = equipKit(b.value, 'recon');
  assert.ok(c.ok && c.value.equippedKit === 'recon');
  const none = equipKit(c.value, null);
  assert.ok(none.ok && none.value.equippedKit === null, 'players can deploy with no kit');
  assert.equal(rich.cash, 20000, 'shop calls never mutate the input profile');
  // forged / legacy saves
  assert.deepEqual(readKits(['recon', 'nuke', 'recon', 7], 'phantom'), { ownedKits: ['recon'], equippedKit: null });
  assert.deepEqual(readKits(undefined, 'recon'), { ownedKits: [], equippedKit: null });
  const m = migrateProfile(JSON.stringify({ ...DEFAULT_PROFILE, ownedKits: ['phantom'], equippedKit: 'phantom' }));
  assert.deepEqual([m.ownedKits, m.equippedKit], [['phantom'], 'phantom']);
});

test('recall refund and burst victims are pure and bounded', () => {
  assert.equal(recallRefundSeconds(1), 30, 'untouched wall banks half of 60 s');
  assert.equal(recallRefundSeconds(0.5), 15);
  assert.equal(recallRefundSeconds(-1), 0);
  assert.equal(recallRefundSeconds(3), 30);
  const pts = [{ pos: { x: 5.9, z: 0 } }, { pos: { x: 0, z: 6.1 } }, { pos: { x: 3, z: 3 } }];
  assert.deepEqual(burstVictims({ x: 0, z: 0 }, KIT_TUNING.phantom.burstRadius, pts).map(p => pts.indexOf(p)), [0, 2]);
});

test('kit hardware stays inside a small geometry budget', () => {
  // Barricade: 3 plates × (face, stripe, 2 ribs, hinge post) + glass, legs, skid, lamp ≈ 20 draws.
  for (const [name, group, maxTris, maxDraws] of [
    ['dart', buildDart().group, 400, 12], ['barricade', buildBarricade(2.4, 1.4, 0.12).group, 600, 26], ['decoy', buildDecoy().group, 600, 16],
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
  ].map((pos, i) => ({ id: i, pos, hp: 100, stunned: 0 }));
  const alerts = [];
  const messages = [];
  const feedback = [];
  // Every Effects call is recorded; kits reach sparks/slamDust/holoBurst/sonarPulse etc.
  const fxCalls = [];
  const effects = new Proxy({}, { get: (_t, k) => (...a) => { fxCalls.push(k); return a; } });
  const player = { feet: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 0, -1), alive: true };
  const ctx = {
    scene, occluders,
    effects,
    groundHeight: () => 0,
    playerFeet: () => player.feet.clone(),
    playerEye: () => player.feet.clone().add(new THREE.Vector3(0, 1.62, 0)),
    playerDir: () => player.dir.clone(),
    playerAlive: () => player.alive,
    hostiles: () => hostiles.map(h => ({ ref: h, pos: h.pos, alive: () => h.hp > 0, stun: s => { h.stunned = s; }, crouched: () => false })),
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
    feedback: kind => feedback.push(kind),
  };
  return { scene, occluders, solids, hostiles, alerts, messages, feedback, fxCalls, player, ctx, wall };
}

const step = (d, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) d.update(dt); };

test('RECON: the dart flies, sticks in the wall, pings three times, tags only what is in range, alerts, and cleans up', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'recon', 1);
  const baseline = w.scene.children.length;
  assert.ok(d.activate());
  assert.ok(!d.charge.ready, 'cooldown started');
  assert.equal(d.liveCount, 1);
  step(d, 1.0); // ≈0.47 s flight to the wall at 26 m/s + 0.4 s to the first ping
  const hud = d.hud();
  assert.equal(hud.live[0].kind, 'dart');
  assert.match(hud.live[0].detail, /PING 1\/3/);
  // stuck at the wall face (z ≈ -11.75), not through it
  const dart = w.scene.children.slice(baseline).find(o => o.type === 'Group');
  assert.ok(dart.position.z > -12 && dart.position.z < -11.4, `dart z ${dart.position.z}`);
  // three hostiles within 24 m of the dart are tagged through the wall; the others are not
  const tagged = w.hostiles.filter(h => d.isRevealed(h)).map(h => h.id).sort();
  assert.deepEqual(tagged, [0, 1, 4]);
  assert.ok(w.messages.some(m => m === 'SONAR — 3 HOSTILES TAGGED · +10% DMG'));
  assert.equal(hud.tagged, 3);
  // tagged hostiles take +10 % from the player; untagged ones don't
  assert.equal(d.damageMul(w.hostiles[0]), KIT_TUNING.recon.markDamageMul);
  assert.equal(d.damageMul(w.hostiles[2]), 1);
  assert.ok(w.feedback.includes('ping') && w.fxCalls.includes('sonarPulse'), 'ping drives the screen sweep and the world pulse');
  step(d, 5.8);
  assert.equal(w.alerts.length, 3, 'every ping is audible');
  assert.ok(w.alerts.every(a => a.radius === KIT_TUNING.recon.hearRadius));
  assert.equal(d.liveCount, 0, 'dart retired after the last ping');
  step(d, 4);
  assert.ok(w.hostiles.every(h => !d.isRevealed(h)), 'tags fade');
  assert.equal(w.scene.children.length, baseline, 'scene back to the baseline (markers are pooled)');
  assert.equal(d.stats.darts, 1);
  d.dispose();
  assert.equal(w.scene.children.length, baseline - 32, 'marker + silhouette pools removed on dispose');
});

test('BULWARK: the wall registers as an occluder + blocker, soaks 450 HP of hostile fire, and is removed when broken', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark', 1);
  const occ = w.occluders.length;
  assert.ok(d.activate());
  assert.equal(w.solids.length, 1);
  const plates = w.occluders.slice(occ);
  assert.equal(plates.length, 3);
  assert.ok(plates.every(p => typeof p.userData.kitHit === 'function'));
  step(d, KIT_TUNING.bulwark.unfold + 0.05);
  assert.ok(w.feedback.includes('slam'), 'the wall slams down with camera feedback');
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
  assert.ok(w.feedback.includes('break'));
  assert.ok(d.stats.barricadeDamage >= 450);
});

test('BULWARK: Z beside your wall recalls it and banks cooldown by remaining integrity', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark', 1);
  assert.ok(d.activate());
  step(d, 1);
  assert.ok(d.hud().recall, 'standing 1.7 m from the wall offers a recall');
  const left = d.charge.left;
  w.ctx.occluders[1].userData.kitHit(225); // half integrity
  assert.ok(d.activate(), 'recall works while the kit is recharging');
  assert.ok(Math.abs(d.charge.left - (left - 15)) < 1e-6, `half a wall banks 15 s (left ${d.charge.left})`);
  assert.equal(w.solids.length, 0, 'blocker lifted at once');
  assert.ok(w.messages.some(m => m.startsWith('BARRICADE RECALLED')));
  step(d, KIT_TUNING.bulwark.fold + 0.05);
  assert.equal(d.liveCount, 0, 'folded away');
  assert.equal(d.stats.recalls, 1);
  // out of range: no recall, just the recharge message
  assert.ok(d.activate() === false && !d.hud().recall);
});

test('BULWARK: refused placement keeps the charge, walls expire after 24 s, and hostile frags crack them', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark', 1);
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
  step(d, KIT_TUNING.bulwark.unfold);
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
  const d = new KitDirector(w.ctx, 'phantom', 1);
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
  assert.ok(w.messages.includes('DECOY DOWN'), 'nobody was close enough to be stunned');
  assert.equal(d.stats.decoyHits, 8);
  assert.ok(w.feedback.includes('burst'));
});

test("PHANTOM: the decoy's death burst stuns hostiles within 6 m, even on timeout", () => {
  const w = fakeWorld();
  w.player.dir.set(1, 0, 0);
  const d = new KitDirector(w.ctx, 'phantom', 1);
  assert.ok(d.activate());
  step(d, KIT_TUNING.phantom.runFor + 0.2);
  const lure = d.lures()[0];
  // two hostiles push the decoy: one at 3 m, one at 7 m
  w.hostiles[3].pos.set(lure.feet.x + 3, 0, lure.feet.z);
  w.hostiles[5].pos.set(lure.feet.x, 0, lure.feet.z + 7);
  step(d, KIT_TUNING.phantom.life);
  assert.equal(w.hostiles[3].stunned, KIT_TUNING.phantom.burstStun);
  assert.equal(w.hostiles[5].stunned, 0, '7 m is outside the burst');
  assert.ok(w.messages.includes('DECOY BURST — 1 HOSTILE STUNNED'));
  assert.equal(d.stats.stunned, 1);
  d.dispose();
});

test('deploys half charged, locked kit, slow refunds, ready chime and onboarding hint', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'recon');
  assert.ok(!d.charge.ready, 'no free ability at the spawn');
  assert.equal(d.charge.left, 22.5);
  assert.ok(d.hud().hint, 'fresh deployment shows the kit prompt');
  assert.equal(d.activate(), false);
  assert.ok(w.messages.some(m => m.startsWith('SONAR DART RECHARGING')));
  assert.equal(typeof d.setKit, 'undefined', 'no mid-match swapping');
  d.onKill(2);
  assert.ok(Math.abs(d.charge.left - (22.5 - 7.2)) < 1e-6, `two kills take 7.2 s off (left ${d.charge.left})`);
  d.onKill(20);
  assert.ok(Math.abs(d.charge.left - (22.5 - 13.5)) < 1e-6, 'a killing spree stops at 30 % of a cooldown');
  const epoch = d.hud().readyEpoch;
  step(d, 9.1);
  assert.ok(d.charge.ready);
  assert.equal(d.hud().readyEpoch, epoch + 1, 'HUD burst fires once');
  assert.ok(w.feedback.includes('ready'));
  assert.ok(w.messages.includes('SONAR DART READY — PRESS Z'));
  assert.ok(d.activate());
  assert.ok(!d.hud().hint, 'prompt gone after first use');
  assert.equal(d.hud().useEpoch, 1);
  // after a spend, two kills are nowhere near a refill
  d.onKill(2);
  assert.ok(d.charge.left > 45 - 7.3);
  w.player.alive = false;
  step(d, 60);
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

test('HUD slot, prompt, fx, equipped-kit button, read-only pause card and KITS menu all render', () => {
  const w = fakeWorld();
  const d = new KitDirector(w.ctx, 'bulwark', 1);
  const hud = d.hud();
  const slot = renderToStaticMarkup(React.createElement(KitSlot, { kit: hud }));
  assert.match(slot, /BULWARK/);
  assert.match(slot, /Barricade/);
  assert.match(slot, /keycap">Z</);
  assert.match(slot, /READY/);
  assert.equal((slot.match(/<line /g) ?? []).length, 24, 'segmented charge dial');
  const hint = renderToStaticMarkup(React.createElement(KitHint, { kit: hud }));
  assert.match(hint, /Press <span class="keycap">Z<\/span>/);
  for (const kind of ['ping', 'slam', 'burst', 'break', 'recall', 'decoy', 'ready']) {
    assert.match(renderToStaticMarkup(React.createElement(KitFx, { kind })), new RegExp(`kit-fx-${kind}`));
  }
  const none = renderToStaticMarkup(React.createElement(KitEquipButton, { kit: null, onOpen() {} }));
  assert.match(none, /NONE EQUIPPED/);
  assert.match(none, /GET A KIT/);
  const eq = renderToStaticMarkup(React.createElement(KitEquipButton, { kit: 'phantom', onOpen() {} }));
  assert.match(eq, /PHANTOM · Holo-Decoy/);
  d.activate();
  const pause = renderToStaticMarkup(React.createElement(KitPauseCard, { kit: d.hud() }));
  assert.match(pause, /LOCKED FOR THIS DEPLOYMENT/);
  assert.doesNotMatch(pause, /SWAP|<button/, 'no way to change kits mid-game');
  assert.match(renderToStaticMarkup(React.createElement(KitPauseCard, {})), /No field kit/);
  const noop = () => {};
  const menu = renderToStaticMarkup(React.createElement(PauseMenu, { kit: d.hud(), onResume: noop, onRestart: noop, onSettings: noop, onQuit: noop }));
  for (const label of ['Resume', 'Settings', 'Restart', 'Quit to menu', 'FIELD KIT']) assert.match(menu, new RegExp(label));
  assert.doesNotMatch(menu, /SWAP/);
  d.dispose();
  // KITS menu: three cards, the price on the buy button, the wallet on screen
  const shop = renderToStaticMarkup(React.createElement(KitsMenu, { profile: { ...DEFAULT_PROFILE, cash: 5000 }, onProfile: noop, onBack: noop }));
  assert.match(shop, />Kits</);
  assert.equal((shop.match(/role="tab"/g) ?? []).length, 3);
  assert.match(shop, /BUY · \$4,500/, 'recon is affordable at $5,000');
  assert.match(shop, /\$5,000/);
  const owned = renderToStaticMarkup(React.createElement(KitsMenu, { profile: { ...DEFAULT_PROFILE, ownedKits: ['recon'], equippedKit: 'recon' }, onProfile: noop, onBack: noop }));
  assert.match(owned, /EQUIPPED · UNEQUIP/);
  const poor = renderToStaticMarkup(React.createElement(KitsMenu, { profile: { ...DEFAULT_PROFILE, cash: 100 }, onProfile: noop, onBack: noop }));
  assert.match(poor, /NEED \$4,400 MORE/);
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
  const d = new KitDirector(ctx, 'bulwark', 1);
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
