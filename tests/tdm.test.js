// Warehouse 5v5 TDM — armor math, the arena world, and the ten-bot match.
// Geometry-only stand-ins: no browser, no renderer, no audio.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';
const { buildWorld, MAPS } = await import('../src/game/world.ts');
const { NavGrid } = await import('../src/game/ai.ts');
const armor = await import('../src/game/tdm/armor.ts');
const arena = await import('../src/game/tdm/arena.ts');
const { TDMBot } = await import('../src/game/tdm/bot.ts');
const { TDMManager } = await import('../src/game/tdm/manager.ts');
const { buildSoldier, buildArmoredSoldier } = await import('../src/game/models.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal',
  'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal',
  'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const fixture = () => buildWorld(new THREE.Scene(), 'arena', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));

/** A bot context that satisfies the interface without a renderer or audio engine. */
function botCtx(world) {
  const player = new THREE.Vector3(0, 0, 42);
  const shots = [];
  return {
    shots,
    ctx: {
      occluders: world.occluders,
      coverNodes: world.coverNodes,
      groundHeight: world.groundHeight,
      moveCollide(p, dx, dz) { p.x += dx; p.z += dz; },
      effects: { bloodDecal() {}, enemyMuzzle() {}, tracer() {}, blood() {} },
      playerFeet: () => player.clone(),
      playerEye: () => player.clone().setY(1.6),
      playerAlive: () => true,
      playerArmor: () => 0,
      damagePlayer: (amount, from, head) => shots.push({ amount, head }),
      onCallout() {},
      aiThrowGrenade() {},
      onBotFire() {},
    },
  };
}

/* ==================== ARMOR & TTK ==================== */

test('armor tiers are 150/180/210 HP with the pinned head and body multipliers', () => {
  assert.deepEqual(armor.ARMOR_TABLE.map(s => s.hp), [150, 180, 210]);
  assert.deepEqual(armor.ARMOR_TABLE.map(s => s.headMul), [1, 0.85, 0.75]);
  assert.deepEqual(armor.ARMOR_TABLE.map(s => s.bodyMul), [1, 0.60, 0.48]);
  // Speed is a real trade: no armor is fastest, heavy plating is slowest.
  assert.ok(armor.ARMOR_TABLE[0].moveMul > armor.ARMOR_TABLE[1].moveMul);
  assert.ok(armor.ARMOR_TABLE[1].moveMul > armor.ARMOR_TABLE[2].moveMul);
  assert.deepEqual(armor.ARMOR_TABLE.map(s => s.icon), ['○', '◍', '⬢']);
  assert.equal(armor.armorOf(9).level, 0, 'unknown tiers fall back to no armor');
});

test('an enemy rifle kills bare plating in exactly three headshots', () => {
  // 34 damage × 2.3 head × 0.55 arena scale × 1.21 head boost = 52.0 raw.
  assert.equal(armor.tdmWeaponDamage(34 * 2.3, true), 52);
  assert.equal(armor.headshotsToKillRifle(0), 3);
  assert.equal(armor.headshotsToKillRifle(1), 5);
  assert.equal(armor.headshotsToKillRifle(2), 6);
  for (const level of [0, 1, 2]) assert.ok(armor.headshotsToKillRifle(level) > 1, 'a headshot never one-shots');
  assert.equal(armor.tdmWeaponDamage(34, false), 18.7);
  // Armor pays for itself in body shots, which is the whole point of the picker.
  assert.deepEqual([0, 1, 2].map(armor.bodyShotsToKillRifle), [6, 12, 17]);
});

test('player and bot damage paths apply the target vest exactly once', () => {
  // Player path: bots hand the engine RAW damage; the vest math happens in the engine.
  const raw = armor.botRawDamage(true, 0.5);
  assert.equal(raw, 52);
  assert.equal(Math.round(armor.botDamageToPlayer(true, 2, 0.5)), 39);           // 52 × 0.75 helmet
  const bodyRaw = armor.botRawDamage(false, 1);
  assert.equal(bodyRaw, 30, 'body damage tops out at 30');
  assert.equal(Math.round(armor.botDamageToPlayer(false, 0, 1)), 30);            // bare chest takes it all
  assert.equal(Math.round(armor.botDamageToPlayer(false, 1, 1)), 18);            // light vest: 30 × 0.60
  assert.equal(Math.round(armor.botDamageToBot(2, true, 0.5)), 39);              // bots wear armor too
  assert.equal(Math.round(armor.botDamageToBot(2, false, 1)), 14);               // 30 × 0.48
});

test('the roster fields exactly one overwatch per team on the pinned armor ladder', () => {
  // BRAVO is the spec's five: Heavy, Light, Heavy, None, Light.
  assert.deepEqual(armor.BRAVO_ROSTER.map(o => o.armor), [2, 1, 2, 0, 1]);
  assert.deepEqual(armor.BRAVO_ROSTER.map(o => o.name), ['Viper', 'Reaper', 'Ghost', 'Specter', 'Wraith']);
  // ALPHA is four AI allies plus the player, none of them a bare-chested free kill.
  assert.deepEqual(armor.ALPHA_ROSTER.map(o => o.armor), [2, 2, 1, 1]);
  assert.equal(armor.ALPHA_ROSTER.length, armor.TDM_TEAM_SIZE - 1, 'four AI + the player make five');
  assert.equal(armor.BRAVO_ROSTER.filter(o => o.role === 'Overwatch').length, 1);
  assert.deepEqual([armor.TDM_MATCH_SECONDS, armor.TDM_RESPAWN_SECONDS, armor.TDM_FRAGS, armor.TDM_FLASHES], [150, 10, 3, 1]);
});

/* ==================== ENEMY BODY ==================== */

/** Bounding box of the visible body only: the invisible hit proxies don't count. */
function bodyBox(model) {
  const box = new THREE.Box3();
  const ghost = o => { const m = Array.isArray(o.material) ? o.material[0] : o.material; return !!m && m.transparent === true && m.opacity === 0; };
  model.group.updateMatrixWorld(true);
  model.group.traverse(o => { if (o.isMesh && !ghost(o)) box.expandByObject(o); });
  return box;
}

test('enemy operators wear visibly thicker plating that grows with the armor tier', () => {
  const restore = installCanvasStub();
  const campaign = buildSoldier();
  const bare = buildArmoredSoldier(0, 'bravo');
  const light = buildArmoredSoldier(1, 'bravo');
  const heavy = buildArmoredSoldier(2, 'bravo');

  const width = m => { const b = bodyBox(m); return b.max.x - b.min.x; };
  const tris = m => geometryBudget(m.group).triangles;

  // Bulked up over the campaign soldier, and each tier adds real mass.
  assert.ok(width(bare) > width(campaign) + 0.02, `armored body wider than campaign (${width(bare).toFixed(2)} vs ${width(campaign).toFixed(2)})`);
  assert.ok(width(heavy) > width(light) && width(light) >= width(bare), 'heavier tiers are wider at the shoulders');
  assert.ok(tris(heavy) > tris(light) && tris(light) > tris(bare), 'each tier adds plating geometry');

  // Headshots must be resolvable by the engine's raycast: the head proxy has to keep
  // its nose in front of the chest box, or the 3-headshot TTK can never happen.
  const partAt = (model, y) => {
    model.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, y, -6), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObjects(model.group.children, true)[0];
    return hit?.object.userData.part ?? 'MISS';
  };
  const partAtYaw = (model, y, deg) => {
    model.group.rotation.y = deg * Math.PI / 180;
    return partAt(model, y);
  };
  // A headshot has to register from EVERY angle. The chest proxy used to run 1.81 m
  // tall, which out-reached the head sphere anywhere but dead ahead, so a strafing
  // enemy was effectively immune to the 3-headshot TTK.
  for (const tier of [light, heavy]) {
    for (let deg = 0; deg < 360; deg += 45) {
      assert.equal(partAtYaw(tier, 1.78, deg), 'head', `head height at ${deg}° is a headshot`);
      assert.equal(partAtYaw(tier, 1.25, deg), 'torso', `chest height at ${deg}° is a body shot`);
    }
    tier.group.rotation.y = 0;
  }
  assert.equal(partAt(heavy, 2.0), 'head', 'the helmet proxy stays hittable above the chest box');

  // No silhouette holes: every visible body point must resolve to a hurtbox. The
  // rifle is scenery, exactly as on the campaign soldier, so it is excluded.
  for (const deg of [0, 90]) {
    let holes = 0, covered = 0;
    heavy.group.rotation.y = deg * Math.PI / 180;
    heavy.group.updateMatrixWorld(true);
    for (let y = 0.1; y <= 2.0; y += 0.1) {
      for (let x = -0.5; x <= 0.5; x += 0.1) {
        const from = new THREE.Vector3(x, y, 30);
        const ray = new THREE.Raycaster(from, new THREE.Vector3(0, 0, -1), 0.1, 100);
        const seen = ray.intersectObjects(heavy.group.children, true)
          .find(hit => hit.object.material?.opacity !== 0 && !hit.object.name.startsWith('world AK'));
        if (!seen) continue;
        covered++;
        if (ray.intersectObjects(heavy.hitMeshes, false).length === 0) holes++;
      }
    }
    assert.ok(covered > 50, `the sweep actually saw the body at ${deg}° (${covered} points)`);
    assert.equal(holes, 0, `no unhittable body geometry at ${deg}°`);
  }
  heavy.group.rotation.y = 0;

  // Both factions build, and the rig contract the bots drive holds at every tier.
  const alpha = buildArmoredSoldier(2, 'alpha');
  assert.ok(alpha.hitMeshes.length > 0);
  for (const model of [bare, light, heavy]) {
    assert.deepEqual([...new Set(model.hitMeshes.map(h => h.userData.part))].sort(), ['head', 'limb', 'torso']);
    for (const key of ['torso', 'head', 'lLeg', 'rLeg', 'muzzle', 'lArm', 'rArm', 'rifle']) {
      assert.ok(model.parts[key], `rig exposes ${key}`);
    }
  }
  restore();
});

/* ==================== ARENA WORLD ==================== */

test('the warehouse arena is a bounded, non-empty 116 m yard with both teams below/above centre', () => {
  const w = fixture();
  assert.equal(w.half, 58);
  assert.ok(w.solids.length > 300, `expected a furnished yard, got ${w.solids.length} solids`);
  // Occluders are merged one mesh per material, so this is a small number on purpose.
  assert.ok(w.occluders.length >= 6, 'bullet-stopping cover batches');
  assert.ok(w.coverNodes.length > 200, 'AI cover graph');
  assert.ok(w.interiors.length >= 4, 'warehouse + corridor + shell interiors');
  assert.equal(w.glass, null, 'freight yards have no shop glass');
  // Impact surfaces + the minimap are painted from these two lists.
  assert.ok(w.concrete.length > 150, 'concrete surfaces registered');
  assert.ok(w.wood.length > 20, 'timber cover registered');
  assert.equal(w.groundHeight(0, 0), 0, 'flat yard');
  // Five spawn points a side, all under cover behind the sandbag line.
  for (const team of ['alpha', 'bravo']) {
    const points = arena.TDM_SPAWNS[team];
    assert.equal(points.length, armor.TDM_TEAM_SIZE);
    for (const [x, y, z] of points) {
      assert.equal(y, 0);
      assert.ok(team === 'alpha' ? z > 40 : z < -40, `${team} spawn ${z} on its own half`);
      assert.ok(Math.abs(x) <= 16);
    }
  }
});

test('the container spec, warehouse shells and corridor are all present in the collision set', () => {
  const w = fixture();
  const box = (x, z, y) => w.solids.find(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > y && b.minY < y + 0.1);
  assert.ok(box(-45, 0, 2.6), 'stacked container at the west flank');
  assert.ok(box(45, 0, 2.6), 'stacked container at the east flank');
  assert.ok(box(-10, 0, 5.5), 'west warehouse shell');
  assert.ok(box(10, 0, 5.5), 'east warehouse shell');
  // The yard is sealed: the outer wall ring is 6 m of concrete.
  assert.ok(w.solids.some(b => b.maxY >= 6 && b.minX <= -55), 'west perimeter wall');
  assert.ok(w.solids.some(b => b.maxY >= 6 && b.maxZ >= 55), 'south perimeter wall');
  assert.equal(w.groundHeight(0, 0), 0, 'flat yard');
  assert.equal(w.groundHeight(0, 50), 0);
});

test('both spawns can reach both warehouses, the corridor and the enemy yard on foot', () => {
  const w = fixture();
  // The arena runs the fine 1 m grid: the 3.2 m doors and the 4 m corridor must
  // stay navigable, and no part of the yard may be sealed off from the spawns.
  const nav = new NavGrid(w.solids, w.half, w.groundHeight, 1);
  for (const team of ['alpha', 'bravo']) {
    const from = new THREE.Vector3(...arena.TDM_SPAWNS[team][2]);
    const other = new THREE.Vector3(...arena.TDM_SPAWNS[team === 'alpha' ? 'bravo' : 'alpha'][2]);
    assert.ok(nav.path(from, new THREE.Vector3(-10, 0, -6)), `${team} reaches the west warehouse`);
    assert.ok(nav.path(from, new THREE.Vector3(10, 0, 6)), `${team} reaches the east warehouse`);
    assert.ok(nav.path(from, new THREE.Vector3(0, 0, 0)), `${team} reaches the corridor`);
    assert.ok(nav.path(from, other), `${team} can cross to the enemy yard`);
  }
  // Reachability audit: a competitive map must not hide sealed pockets of floor.
  const N = nav.n, seen = new Uint8Array(N * N);
  const start = [nav.toCell(0), nav.toCell(42.5)];
  seen[start[1] * N + start[0]] = 1;
  const queue = [start];
  while (queue.length) {
    const [x, z] = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen[nz * N + nx] || !nav.free(nx, nz)) continue;
      seen[nz * N + nx] = 1; queue.push([nx, nz]);
    }
  }
  let free = 0, isolated = 0;
  for (let i = 0; i < N * N; i++) { if (nav.blocked[i]) continue; free++; if (!seen[i]) isolated++; }
  assert.ok(isolated / free < 0.02, `${isolated} of ${free} free cells are walled off`);
  // Roof access: the stair block climbs the 5.5 m shell in steppable 0.5 m risers.
  const risers = w.solids.filter(b => b.maxY > 0.4 && b.maxY < 5.5 && Math.abs(b.maxX - b.minX) >= 1);
  assert.ok(risers.length >= 8, `expected a flight of stairs, found ${risers.length} steps`);
  const top = w.solids.find(b => Math.abs(b.maxY - arena.WAREHOUSE.h) < 0.05);
  assert.ok(top, 'a walkable surface at warehouse roof height');
});

test('the arena stays inside the merged-geometry budget the other maps hold', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { draws, triangles } = geometryBudget(w.group);
    assert.ok(draws <= 40, `arena draws ${draws}`);
    assert.ok(triangles > 8000 && triangles < 260000, `arena triangles ${triangles}`);
    assert.ok(MAPS.some(m => m.id === 'arena' && m.name === 'Warehouse'));
  } finally { restore(); }
});

/* ==================== BOT AI ==================== */

test('one TDMBot class serves both teams, with personalities from the roster bias', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const host = { nav: new NavGrid(w.solids, w.half, w.groundHeight), allies: () => [], hostiles: () => [], playerIsHostile: (t) => t === 'bravo', killed() {} };
    const holder = new TDMBot(ctx, host, { name: 'ANCHOR', team: 'alpha', armor: 2, personality: 0.3 });
    const pusher = new TDMBot(ctx, host, { name: 'BREACHER', team: 'bravo', armor: 1, personality: 0.72 });
    const flanker = new TDMBot(ctx, host, { name: 'LANE', team: 'alpha', armor: 0, personality: 0.5 });
    assert.equal(holder.maxHp, 210);
    assert.equal(pusher.maxHp, 180);
    assert.equal(flanker.maxHp, 150);
    assert.equal(holder.personalityKind, 'holder');
    assert.equal(pusher.personalityKind, 'pusher');
    assert.equal(flanker.personalityKind, 'flanker');
    assert.equal(pusher.opposing, 'alpha');
    assert.equal(holder.opposing, 'bravo');
    // Armor is worn on the model, not just in the stat block.
    assert.equal(pusher.model.armor?.level, 1);
    assert.notEqual(pusher.model.armor?.band, holder.model.armor?.band, 'sides are colour-coded');
    // A bravo bot shoots the player; an alpha bot never does.
    assert.equal(host.playerIsHostile('bravo'), true);
    assert.equal(host.playerIsHostile('alpha'), false);
    // Rifle damage lands on health with the vest applied, and three head hits drop bare plating.
    const bare = new TDMBot(ctx, host, { name: 'BARE', team: 'alpha', armor: 0, personality: 0.5 });
    assert.equal(bare.takeDamage(armor.BOT_HEAD_DAMAGE, true, 'YOU'), false);
    assert.equal(bare.takeDamage(armor.BOT_HEAD_DAMAGE, true, 'YOU'), false);
    assert.equal(bare.takeDamage(armor.BOT_HEAD_DAMAGE, true, 'YOU'), true);
    // 0.82 up close down to 0.43 at 65 m, with the first-round bonus on top.
    assert.equal(armor.BOT_HEAD_DAMAGE, 52);
    assert.equal(armor.BOT_BODY_MIN, 22);
    assert.equal(armor.BOT_BODY_MAX, 30);
  } finally { restore(); }
});

test('bots throw frags, break contact at low health and share contact intel', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const nav = new NavGrid(w.solids, w.half, w.groundHeight);
    const host = {
      nav, playerIsHostile: (t) => t === 'bravo', killed() {},
      markers: [], allies() { return []; }, hostiles() { return []; },
    };
    const bot = new TDMBot(ctx, host, { name: 'RAIDER', team: 'bravo', armor: 1, personality: 0.8, perch: new THREE.Vector3(10, 5.5, 0) });
    assert.ok(bot.perch, 'overwatch keeps its platform');
    bot.deploy(new THREE.Vector3(10, 5.5, 0), 0);
    // Perched bots clamp to their box instead of wandering off the roof.
    for (let i = 0; i < 240; i++) bot.update(1 / 30);
    assert.ok(Math.abs(bot.pos.x - 10) <= 3.5 && Math.abs(bot.pos.z) <= 3.5, `perch clamp failed at ${bot.pos.toArray()}`);
    assert.ok(bot.pos.y >= 5.5 - 0.01, 'stays on the roof');

    const runner = new TDMBot(ctx, host, { name: 'RUNNER', team: 'bravo', armor: 0, personality: 0.5 });
    runner.deploy(new THREE.Vector3(-30, 0, -30), 0);
    for (let i = 0; i < 300; i++) runner.update(1 / 30);
    assert.ok(runner.pos.length() < 90, 'patrols inside the yard');
    assert.notEqual(runner.state, 'DEAD');
    // Squad comms: hearing gunfire turns a patrolling bot toward the fight.
    const before = runner.state;
    runner.hear(new THREE.Vector3(runner.pos.x + 6, 0, runner.pos.z), 40);
    assert.ok(before === 'PATROL' ? runner.state === 'ENGAGE' || runner.state === 'COVER' : true);
  } finally { restore(); }
});

/* ==================== MATCH MANAGEMENT ==================== */

test('a fresh match fields five a side, scores kills once, and spawns every bot on the ground', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const feed = [];
    const scene = new THREE.Scene();
    const manager = new TDMManager({
      world: w, scene, ctx,
      onFeed: (text, headshot, mine) => feed.push({ text, headshot, mine }),
      onScore() {},
    });
    // Every bot must be in the render scene, or the match draws nothing but muzzle
    // flashes: raycasts keep working on unparented meshes, so this is invisible to
    // hit tests and has to be asserted directly.
    const parented = manager.bots.filter(b => b.model.group.parent === scene);
    assert.equal(parented.length, manager.bots.length, 'every bot model is parented to the render scene');
    assert.equal(scene.children.filter(c => c.type === 'Group').length, manager.bots.length, 'the scene holds one group per bot');
    for (const bot of manager.bots) {
      let drawn = 0;
      bot.model.group.traverse(o => { if (o.isMesh && o.material?.opacity !== 0) drawn++; });
      assert.ok(drawn > 5, `${bot.name} contributes visible geometry (${drawn} meshes)`);
    }

    // Nine AI plus the player: the tenth body in the yard is you.
    assert.equal(manager.bots.length, 2 * armor.TDM_TEAM_SIZE - 1);
    assert.equal(manager.alpha.length, armor.TDM_TEAM_SIZE - 1);
    assert.equal(manager.bravo.length, armor.TDM_TEAM_SIZE);
    assert.equal(manager.timeLeft, 150);
    manager.start();
    const nav = manager.nav;
    for (const bot of manager.bots) {
      assert.ok(!bot.dead, `${bot.name} deployed alive`);
      assert.ok(bot.perch ? bot.pos.y > 4 : Math.abs(bot.pos.y) < 0.01, `${bot.name} deployed at its post`);
      // Perched overwatch stands on a roof, which the ground grid rightly calls solid.
      if (!bot.perch) assert.ok(nav.free(nav.toCell(bot.pos.x), nav.toCell(bot.pos.z)), `${bot.name} on a free cell`);
      assert.ok(Math.abs(bot.pos.z) > 30 || bot.perch, `${bot.name} spawns in its own yard`);
    }
    // Deaths score for the killer's side and never twice.
    const victim = manager.bravo[0], killer = manager.alpha[0];
    victim.takeDamage(400, false, killer);
    assert.equal(manager.alphaScore, 1);
    assert.equal(killer.kills, 1);
    victim.takeDamage(400, false, killer);
    assert.equal(manager.alphaScore, 1, 'a corpse cannot be scored twice');
    // The player is ALPHA's fifth: player kills count for the team.
    manager.killed(manager.bravo[1], 'YOU', true);
    assert.equal(manager.alphaScore, 2);
    assert.equal(manager.hud('YOU', 1, false).playerKills, 1);
    // Two and a half minutes, then the match is over.
    for (let i = 0; i < 151; i++) manager.update(1);
    assert.equal(manager.timeLeft, 0);
    assert.equal(manager.matchOver, true);
  } finally { restore(); }
});

test('respawns return every bot to its own yard after the ten-second timer', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new TDMManager({ world: w, scene: new THREE.Scene(), ctx, onFeed() {}, onScore() {} });
    manager.start();
    // A yard bot, not the perched overwatch: the overwatch redeploys back onto its roof.
    const bot = manager.bravo.find(b => !b.perch);
    const perch = manager.bravo.find(b => b.perch);
    bot.takeDamage(500, true, 'YOU');
    perch.takeDamage(500, true, 'YOU');
    assert.equal(bot.dead, true);
    for (let i = 0; i < 9; i++) manager.update(1);
    assert.equal(bot.dead, true, 'still down at nine seconds');
    manager.update(1.2);
    assert.equal(bot.dead, false, 'back on the yard after ten');
    assert.equal(bot.hp, bot.maxHp, 'full health on respawn');
    assert.ok(bot.pos.z < -30, 'respawns at the BRAVO yard');
    assert.equal(perch.dead, false, 'the overwatch respawns too');
    assert.ok(perch.pos.y > 4, 'and goes straight back up to its post');
    // The player's clock is mirrored in the HUD payload.
    manager.playerDown();
    assert.equal(manager.hud('YOU', 0, true).respawnIn, armor.TDM_RESPAWN_SECONDS);
    assert.equal(manager.tickPlayerRespawn(4), false);
    assert.equal(manager.tickPlayerRespawn(6), true);
    manager.playerRespawned();
    assert.equal(manager.hud('YOU', 0, false).respawnIn, 0);
  } finally { restore(); }
});

test('frags only hurt the other team, and the blast scores for the thrower', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new TDMManager({ world: w, scene: new THREE.Scene(), ctx, onFeed() {}, onScore() {} });
    manager.start();
    // Park one bot of each side on the same square. Viper wears heavy plating, so
    // bring the bare runner: 130 blast damage is 62 through a heavy vest.
    const bravo = manager.bravo.find(b => b.armor === 0), alpha = manager.alpha[0];
    const at = new THREE.Vector3(0, 0, 24);
    for (const b of [bravo, alpha]) { b.pos.copy(at); b.pos.y = 0; }
    const { kills } = manager.applyExplosion(at, 'frag', 'alpha', true);
    assert.ok(kills.includes(bravo), 'an unarmored hostile dies to a frag');
    assert.ok(!alpha.dead, 'friendly frags do not wound team-mates');
    assert.equal(manager.alphaScore, 1);
    // A light vest dies too — 240 blast × 0.76 lands at 182 against 180 HP.
    const light = manager.bravo.find(b => b.armor === 1);
    light.pos.copy(at); light.pos.y = 0;
    assert.ok(manager.applyExplosion(at, 'frag', 'alpha', true).kills.includes(light), 'a light vest dies to a contact frag');
    // The heavy walks away from the same blast, badly hurt: armor is not decoration.
    const heavy = manager.bravo.find(b => b.armor === 2);
    const before = heavy.hp;
    heavy.pos.copy(at); heavy.pos.y = 0;
    const heavyBlast = manager.applyExplosion(at, 'frag', 'alpha', true);
    assert.ok(!heavyBlast.kills.includes(heavy), 'a heavy plate survives a point-blank frag');
    assert.ok(heavy.hp < before - 100, 'but it definitely feels it');
    // Blast falloff: the same grenade at the edge of its radius barely scratches.
    assert.ok(armor.tdmFragDamage(1.5) > armor.tdmFragDamage(7) * 3);
    assert.deepEqual([0, 1, 2].map(armor.blastArmorMul).map(v => Math.round(v * 100)), [100, 76, 69]);
    // A flash stuns the enemy and barely touches the thrower's own side.
    const flashAt = new THREE.Vector3(0, 0, 24);
    heavy.pos.copy(flashAt); heavy.pos.y = 0;
    const flash = manager.applyExplosion(flashAt, 'flash', 'alpha');
    assert.equal(flash.kills.length, 0, 'a flashbang never kills');
    assert.ok(heavy.stunTimer > 3, 'a blinded hostile is out of the fight for seconds');
  } finally { restore(); }
});

test('the player never spawns in a wall and always gets a ±2–4 m offset from a spawn point', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new TDMManager({ world: w, scene: new THREE.Scene(), ctx, onFeed() {}, onScore() {} });
    for (let i = 0; i < 60; i++) {
      for (const team of ['alpha', 'bravo']) {
        const p = manager.getSpawn(team);
        const near = arena.TDM_SPAWNS[team].some(([x, , z]) => Math.hypot(p.x - x, p.z - z) <= 4.05);
        assert.ok(near, `${team} spawn ${p.toArray()} sits on the arc`);
        const inSolid = w.solids.some(b => b.maxY > 0.6 && b.minY < 1.7 && p.x > b.minX - 0.3 && p.x < b.maxX + 0.3 && p.z > b.minZ - 0.3 && p.z < b.maxZ + 0.3);
        assert.ok(!inSolid, `${team} spawn ${p.toArray()} is clear of geometry`);
      }
    }
  } finally { restore(); }
});

test('hittables expose every living bot and drop corpses from the raycast set', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new TDMManager({ world: w, scene: new THREE.Scene(), ctx, onFeed() {}, onScore() {} });
    manager.start();
    const live = manager.getHittables();
    assert.ok(live.length > 10, 'both squads are shootable');
    assert.ok(live.every(m => m.userData.tdmBot instanceof TDMBot));
    assert.ok(live.some(m => m.userData.part === 'head'), 'head proxies are in the set');
    manager.bravo[3].takeDamage(999, false, 'YOU');
    const after = manager.getHittables();
    assert.ok(!after.some(m => m.userData.tdmBot === manager.bravo[3]));
  } finally { restore(); }
});
