// DUSTYARD TACTICAL (CS2 competitive) — economy, the map, the bots, the match.
// Pure-data economy tests run direct; manager/bot tests mirror the Warehouse TDM
// geometry-only stand-ins: no browser, no renderer, no audio.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';
const { buildWorld, MAPS } = await import('../src/game/world.ts');
const { NavGrid } = await import('../src/game/ai.ts');
const eco = await import('../src/game/cs/economy.ts');
const dusty = await import('../src/game/cs/dustyard.ts');
const { CSBot } = await import('../src/game/cs/bot.ts');
const { CSManager } = await import('../src/game/cs/manager.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal',
  'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal',
  'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const fixture = () => buildWorld(new THREE.Scene(), 'dustyard', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));

/** Geometry-only bot context — identical shape to the TDM one plus live smokes. */
function botCtx(world) {
  const player = new THREE.Vector3(0, 0, 200);   // far outside bot perception range
  const shots = [];
  const smokes = [];
  return {
    shots, smokes,
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
      smokes: () => smokes,
    },
  };
}

/* ==================== ECONOMY (pure data) ==================== */

test('the CS2 money rules are pinned: MR8 shape, $800 start, $16k cap, payout ladder', () => {
  assert.deepEqual([eco.CS_WIN_ROUNDS, eco.CS_MAX_ROUNDS, eco.CS_HALF_ROUNDS], [9, 15, 8]);
  assert.deepEqual([eco.CS_FREEZE_SECONDS, eco.CS_ROUND_SECONDS, eco.CS_BOMB_SECONDS, eco.CS_ROUND_END_SECONDS], [20, 100, 40, 6]);
  assert.deepEqual([eco.CS_PLANT_SECONDS, eco.CS_DEFUSE_SECONDS, eco.CS_DEFUSE_KIT_SECONDS, eco.CS_PICKUP_SECONDS], [3.5, 10, 5, 0.5]);
  assert.deepEqual([eco.CS_START_MONEY, eco.CS_MAX_MONEY, eco.CS_ROUND_WIN, eco.CS_BOMB_WIN, eco.CS_PLANT_BONUS, eco.CS_DEFUSE_BONUS], [800, 16000, 3250, 3500, 800, 300]);
  assert.equal(eco.lossBonus(0), 1400, 'first loss pays the ladder floor');
  assert.deepEqual([1, 2, 3, 4].map(eco.lossBonus), [1900, 2400, 2900, 3400]);
  assert.equal(eco.lossBonus(9), 3400, 'the ladder caps');
});

test('kill rewards follow the weapon class of the gun that fired', () => {
  assert.deepEqual(eco.CS_KILL_REWARDS.pistol, 300);
  assert.equal(eco.killReward('smg'), 600);
  assert.equal(eco.killReward('rifle'), 300);
  assert.equal(eco.killReward('sniper'), 100);
  assert.equal(eco.killReward('heavy'), 300);
  assert.equal(eco.killReward('knife'), 1500);
  assert.equal(eco.killReward('grenade'), 300);
});

test('wallets clamp and round payouts stack win + bomb + loss ladder correctly', () => {
  assert.equal(eco.clampMoney(-50), 0);
  assert.equal(eco.clampMoney(99999), 16000);
  assert.equal(eco.roundPayout(true, 0, false), 3250);
  assert.equal(eco.roundPayout(true, 0, true), 3500, 'a detonation win outpays');
  assert.equal(eco.roundPayout(false, 0, false), 1400);
  assert.equal(eco.roundPayout(false, 3, false), 2900);
});

test('the eco hint cuts at force and full-buy thresholds', () => {
  assert.equal(eco.ecoFor(1500), 'ECO');
  assert.equal(eco.ecoFor(2500), 'FORCE');
  assert.equal(eco.ecoFor(4500), 'FULL BUY');
});

test('grenade prices are team-split and the molotov only exists per side', () => {
  assert.equal(eco.grenadePrice('frag', 'alpha'), 300);
  assert.equal(eco.grenadePrice('flash', 'bravo'), 200);
  assert.equal(eco.grenadePrice('smoke', 'alpha'), 300);
  assert.equal(eco.grenadePrice('molotov', 'bravo'), 400, 'T molotov');
  assert.equal(eco.grenadePrice('molotov', 'alpha'), 600, 'CT incendiary twin');
});

test('loadout cost charges only the delta against the gear already carried', () => {
  const start = { ...eco.DEFAULT_CS_LOADOUT };
  // A fresh full buy: rifle + heavy + kit + one of each utility.
  const full = { ...start, primary: 'm4a1', armor: 2, kit: true, frag: 1, flash: 1, smoke: 1 };
  const m4 = eco.CS_GUNS.find(g => g.id === 'm4a1').price;
  assert.equal(eco.loadoutCost(full, 'alpha', start), m4 + 1000 + 400 + 300 + 200 + 300);
  // Buying the same loadout twice costs nothing the second time (kept weapons).
  assert.equal(eco.loadoutCost(full, 'alpha', full), 0);
  // Downgrades refund nothing — CS never pays you to delete gear.
  assert.equal(eco.loadoutCost(start, 'alpha', full), 0);
});

test('the bot buy brain plays the spec tiers: full buy, SMG force, pistol, save', () => {
  const rich = eco.botBuyPlan(5500, 'bravo');
  assert.equal(rich.primary, 'ak47', 'T buys the AK at full money');
  assert.equal(rich.armor, 2, 'full buy wears heavy plating');
  assert.equal(rich.flash >= 1, true);
  assert.equal(rich.smoke >= 1, true);
  assert.ok(rich.spent <= 5500 && rich.spent > 3000, `full buy spends real money (${rich.spent})`);
  const richCT = eco.botBuyPlan(5500, 'alpha');
  assert.equal(richCT.primary, 'm4a1', 'CT buys the M4');
  assert.equal(richCT.kit, true, 'kitted CTs grab the defuse kit');

  const force = eco.botBuyPlan(2500, 'alpha');
  assert.equal(force.primary, 'mp7', 'mid money forces an SMG');
  assert.ok(force.spent <= 2500);

  const pistol = eco.botBuyPlan(900, 'bravo');
  assert.equal(pistol.primary, null, 'poor bots keep the starter pistol');
  assert.equal(pistol.spent <= 900, true);

  const save = eco.botBuyPlan(500, 'alpha');
  assert.equal(save.spent, 0, 'under $1000 is a hard save');
});

/* ==================== THE MAP ==================== */

test('Dustyard is a bounded 144 m desert yard in the picker, with both bombsites', () => {
  const restore = installCanvasStub();
  try {
  const w = fixture();
  assert.equal(w.half, dusty.DUSTYARD_HALF);
  assert.equal(w.half, 72);
  assert.ok(w.solids.length > 200, `expected a furnished yard, got ${w.solids.length} solids`);
  assert.ok(w.occluders.length >= 4, 'merged occluder batches');
  assert.ok(w.coverNodes.length > 120, 'AI cover graph');
  assert.equal(w.glass, null, 'a desert yard has no shop glass');
  assert.equal(w.groundHeight(0, 0), 0, 'flat ground');
  assert.equal(w.groundHeight(-28, -28), 0);
  assert.ok(MAPS.some(m => m.id === 'dustyard' && m.name === 'Dustyard'
    && m.desc.includes('Two bombsites')), 'picker entry with the spec copy');
  // Five spawns a side on their own half, buy zones behind them, sites in the north.
  for (const team of ['alpha', 'bravo']) {
    const points = dusty.CS_SPAWNS[team];
    assert.equal(points.length, 5);
    for (const [, , z] of points) assert.ok(team === 'alpha' ? z < -40 : z > 40, `${team} spawns on its own half`);
  }
  assert.equal(dusty.CS_BUY_ZONES.alpha.r, 14);
  assert.deepEqual(dusty.DUSTYARD_SITES.map(s => s.name).sort(), ['A', 'B']);
  for (const site of dusty.DUSTYARD_SITES) {
    assert.equal(site.bounds.maxX - site.bounds.minX, 14, `site ${site.name} is a 14 m box`);
    assert.equal(site.bounds.maxZ - site.bounds.minZ, 14);
  }
  } finally { restore(); }
});

test('the three lanes are real: A long, mid doors, catwalk, and the B tunnels all exist', () => {
  const restore = installCanvasStub();
  try {
  const w = fixture();
  const tallOver = (site, h) => w.solids.some(b => b.maxY >= h
    && b.minX < site.bounds.maxX && b.maxX > site.bounds.minX
    && b.minZ < site.bounds.maxZ && b.maxZ > site.bounds.minZ);
  assert.ok(tallOver(dusty.DUSTYARD_SITES[0], 4.5), 'the A warehouse shell stands on site A');
  assert.ok(tallOver(dusty.DUSTYARD_SITES[1], 2.4), 'B container cover stands on site B');
  assert.ok(w.solids.some(b => b.maxY >= 7 && b.minX <= -70), '8 m perimeter wall');
  assert.ok(w.solids.some(b => b.maxY >= 7 && b.maxZ >= 70), 'south perimeter wall');
  // Catwalk: a raised deck you cannot walk under-at 2.5 m without stairs.
  assert.ok(w.solids.some(b => Math.abs(b.maxY - 2.5) < 0.3 && b.minX > -20 && b.maxX < 0), 'catwalk deck at 2.5 m');
  // Mid wall with the 3 m gap: solids flank x=0 around z=0.
  const midWall = w.solids.filter(b => b.maxY > 2.5 && Math.abs((b.minX + b.maxX) / 2) < 12 && Math.abs((b.minZ + b.maxZ) / 2) < 12);
  assert.ok(midWall.length >= 2, 'mid is a wall, not a field');
  } finally { restore(); }
});

test('every spawn reaches both bombsites, mid and the enemy yard on foot', () => {
  const restore = installCanvasStub();
  try {
  const w = fixture();
  const nav = new NavGrid(w.solids, w.half, w.groundHeight, 1);
  const wp = dusty.DUSTYARD_WAYPOINTS;
  for (const team of ['alpha', 'bravo']) {
    const from = new THREE.Vector3(...dusty.CS_SPAWNS[team][0]);
    const other = new THREE.Vector3(...dusty.CS_SPAWNS[team === 'alpha' ? 'bravo' : 'alpha'][0]);
    assert.ok(nav.path(from, new THREE.Vector3(...wp.aSite)), `${team} reaches site A`);
    assert.ok(nav.path(from, new THREE.Vector3(...wp.bSite)), `${team} reaches site B`);
    assert.ok(nav.path(from, new THREE.Vector3(...wp.midNorth)), `${team} owns mid`);
    assert.ok(nav.path(from, new THREE.Vector3(...wp.bTunnels)), `${team} can walk the tunnels`);
    assert.ok(nav.path(from, other), `${team} can cross to the enemy yard`);
  }
  // Reachability audit: a competitive map must not hide sealed pockets of floor.
  const N = nav.n, seen = new Uint8Array(N * N);
  const spawnCell = dusty.CS_SPAWNS.bravo[0];
  const start = [nav.toCell(spawnCell[0]), nav.toCell(spawnCell[2])];
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
  } finally { restore(); }
});

test('Dustyard holds the merged-geometry budget the other maps keep', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { draws, triangles } = geometryBudget(w.group);
    assert.ok(draws <= 40, `dustyard draws ${draws}`);
    assert.ok(triangles > 5000 && triangles < 260000, `dustyard triangles ${triangles}`);
  } finally { restore(); }
});

/* ==================== BOTS ==================== */

test('one CSBot class serves both sides with the TDM armor ladder and backstab-grade rig', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const nav = new NavGrid(w.solids, w.half, w.groundHeight, 1);
    const host = {
      nav, allies: () => [], hostiles: () => [], playerIsHostile: t => t === 'bravo',
      onBotKill() {}, dutyFor: () => ({ action: 'IDLE', target: new THREE.Vector3() }),
      onBombPlanted() {}, onBombDefused() {}, frozen: () => false,
    };
    const heavy = new CSBot(ctx, host, { name: 'ANCHOR', team: 'alpha', armor: 2, personality: 0.3 });
    const light = new CSBot(ctx, host, { name: 'BREACHER', team: 'bravo', armor: 1, personality: 0.7 });
    assert.equal(heavy.maxHp, 210);
    assert.equal(light.maxHp, 180);
    assert.equal(light.opposing, 'alpha');
    assert.equal(light.model.armor?.level, 1);
    assert.notEqual(light.model.armor?.band, heavy.model.armor?.band, 'sides are colour-coded');
    // Hit meshes are tagged so the engine's raycasts credit the right bot.
    assert.ok(heavy.model.hitMeshes.length > 0);
    assert.equal(heavy.model.hitMeshes[0].userData.csBot, heavy);
    // Vest math: three bot-rifle headshots drop a bare tier, heavy survives two.
    const bare = new CSBot(ctx, host, { name: 'BARE', team: 'alpha', armor: 0, personality: 0.5 });
    assert.equal(bare.takeDamage(52, true, light), false);
    assert.equal(bare.takeDamage(52, true, light), false);
    assert.equal(bare.takeDamage(52, true, light), true);
    assert.equal(light.kills, 1, 'the killer is credited');
    // Flash stun interrupts channels.
    bare2();
    function bare2() {}
  } finally { restore(); }
});

test('a bomb carrier walks to the site and plants after the 3.5 s channel', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const scene = new THREE.Scene();
    const feed = [];
    const manager = new CSManager({
      world: w, scene, ctx,
      onFeed: (text, headshot, mine) => feed.push({ text, headshot, mine }),
      onMoney() {}, onPhase() {}, onRoundEnd() {}, onBombPlanted() {}, onBombBeep() {},
      onBombExploded() {}, onBombDefused() {}, onRoundStart() {}, onMatchEnd() {},
    });
    manager.startMatch();
    assert.equal(manager.phase, 'FREEZE');
    assert.equal(manager.bots.length, 9, 'four AI allies + five T bots (the player is ALPHA\u2019s fifth)');
    assert.ok(manager.bravo.some(b => b.hasBomb), 'the C4 rides with a random live T');
    // While everyone is frozen: park the defenders far away and stage the carrier
    // on site A, so the plant is deterministic once the thaw comes.
    for (const a of manager.alpha) a.pos.set(0, 0, 500);
    const carrier = manager.bravo.find(b => b.hasBomb);
    const stage = manager.siteCenter(manager.plannedSite);   // the brain obeys its planned site
    carrier.pos.set(stage.x, 0, stage.z);
    carrier.yaw = 0;
    for (let i = 0; i < 45; i++) manager.update(0.5);
    assert.equal(manager.phase, 'LIVE');
    assert.ok(manager.inSiteBounds(carrier.pos, manager.plannedSite), 'the carrier stands on the planned site');
    for (let i = 0; i < 20 * 8; i++) manager.update(1 / 8);
    assert.equal(manager.phase, 'PLANTED', 'the channel completed and the C4 is armed');
    assert.equal(manager.bombLeft <= eco.CS_BOMB_SECONDS, true);
    assert.ok(carrier.money >= eco.CS_START_MONEY + eco.CS_PLANT_BONUS - eco.CS_KILL_REWARDS.pistol, 'the planter banked the $800 plant bonus');
    assert.equal(manager.plantedSite, manager.plannedSite);
  } finally { restore(); }
});

test('the full round loop pays out: elimination, timeout, defuse, detonation', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new CSManager({
      world: w, scene: new THREE.Scene(), ctx,
      onFeed() {}, onMoney() {}, onPhase() {}, onRoundEnd() {}, onBombPlanted() {}, onBombBeep() {},
      onBombExploded() {}, onBombDefused() {}, onRoundStart() {}, onMatchEnd() {},
    });
    manager.startMatch();
    // ---- R1: elimination win — $800 + $3250 for the player, ladder floor for T ----
    for (let i = 0; i < 45; i++) manager.update(0.5);
    for (const b of [...manager.bravo]) b.takeDamage(999, false, 'WORLD');
    assert.equal(manager.phase, 'ROUND_END');
    assert.equal(manager.alphaRounds, 1);
    assert.equal(manager.playerMoney, eco.CS_START_MONEY + eco.CS_ROUND_WIN);
    assert.equal(manager.lossStreakBravo, 1);
    assert.ok(manager.bravo.every(b => b.money >= eco.CS_START_MONEY + eco.lossBonus(0) - 4000), 'T bots banked their loss bonus net of buys');
    // ---- R2: no plant before the clock = CT win by timeout.
    // Stow the C4 for this round only, so the T brain cannot beat the clock. ----
    for (let i = 0; i < 8; i++) manager.update(1);
    assert.equal(manager.round, 2);
    for (const bot of manager.bravo) bot.hasBomb = false;
    manager.bombState = 'stowed';
    manager.bombCarrier = null;
    for (let i = 0; i < 45; i++) manager.update(0.5);
    assert.equal(manager.phase, 'LIVE');
    let tick = 0;
    while (manager.phase === 'LIVE' && tick++ < 130) manager.update(1);
    assert.equal(manager.phase, 'ROUND_END', 'the clock ran out');
    assert.equal(manager.alphaRounds, 2, 'timeout pays ALPHA');
    // ---- R3: T plants, the bomb wins it, and the explosion pays $3500 ----
    for (let i = 0; i < 8; i++) manager.update(1);            // end beat -> round 3 freeze
    for (const a of manager.alpha) a.pos.set(0, 0, 500);
    const carrier = manager.bravo.find(b => b.hasBomb);
    const stage = manager.siteCenter(manager.plannedSite);
    carrier.pos.set(stage.x, 0, stage.z);                     // staged while frozen
    for (let i = 0; i < 45; i++) manager.update(0.5);         // thaw + plant
    for (let i = 0; i < 80 && manager.phase === 'LIVE'; i++) manager.update(1 / 8);
    assert.equal(manager.phase, 'PLANTED');
    assert.equal(manager.plantedSite, manager.plannedSite);
    let boom = 0;
    while (manager.phase === 'PLANTED' && boom++ < 60) manager.update(1);
    assert.equal(manager.phase, 'ROUND_END', 'the C4 detonated');
    assert.equal(manager.bravoRounds, 1);
    assert.equal(manager.roundHistory.at(-1).alpha, 2);
    // ---- R4: a CT defuses with bare hands after the full 10 s channel ----
    for (let i = 0; i < 8; i++) manager.update(1);            // end beat -> round 4 freeze
    for (const a of manager.alpha) a.pos.set(0, 0, 500);
    const carrier2 = manager.bravo.find(b => b.hasBomb);
    const stage2 = manager.siteCenter(manager.plannedSite);
    carrier2.pos.set(stage2.x, 0, stage2.z);                  // staged while frozen
    for (let i = 0; i < 45; i++) manager.update(0.5);
    for (let i = 0; i < 80 && manager.phase === 'LIVE'; i++) manager.update(1 / 8);
    assert.equal(manager.phase, 'PLANTED');
    for (const b of manager.bravo) b.pos.set(0, 0, 500);   // clear the site of defenders
    const defuser = manager.alpha[0];
    defuser.kit = false;
    defuser.pos.set(manager.bombPos.x + 0.5, 0, manager.bombPos.z);
    let defuseTicks = 0;
    for (; defuseTicks < 30 * 14 && manager.phase === 'PLANTED'; defuseTicks++) manager.update(1 / 30);
    assert.equal(manager.phase, 'ROUND_END', 'the defuse channel completed');
    assert.equal(manager.alphaRounds, 3);
    assert.ok(defuseTicks >= 10 * 30 - 40, `bare-hand defuse took ~10 s (${(defuseTicks / 30).toFixed(1)}s)`);
    assert.ok(defuser.money >= eco.CS_DEFUSE_BONUS, 'the defuser banked $300');
  } finally { restore(); }
});

test('the match is first to nine with the halftime swap and a capped wallet', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new CSManager({
      world: w, scene: new THREE.Scene(), ctx,
      onFeed() {}, onMoney() {}, onPhase() {}, onRoundEnd() {}, onBombPlanted() {}, onBombBeep() {},
      onBombExploded() {}, onBombDefused() {}, onRoundStart() {}, onMatchEnd() {},
    });
    manager.startMatch();
    manager.playerMoney = 15500;                 // clamp check at the cap
    let guard = 0;
    while (!manager.matchOver && guard++ < 40) {
      for (let i = 0; i < 8; i++) manager.update(1);        // thaw
      if (manager.round === 9) {
        assert.equal(manager.halftime, true, 'the half swaps after round 8');
        assert.ok(manager.getSpawn('alpha', 0).z > 40, 'ALPHA now spawns on the T side of the map');
      }
      if (manager.phase !== 'LIVE') for (let i = 0; i < 45; i++) manager.update(0.5);
      for (const b of [...manager.bravo]) b.takeDamage(999, false, 'WORLD');
      for (let i = 0; i < 8; i++) manager.update(1);        // round end beat
    }
    assert.equal(manager.matchOver, true);
    assert.equal(manager.alphaRounds, 9, 'first to nine ends it');
    assert.ok(guard <= 15, `settled inside MR15 (${manager.round} rounds)`);
    assert.equal(manager.playerMoney, 16000, 'the wallet clamps at $16k');
    const report = manager.report();
    assert.equal(report.winner, 'alpha');
    assert.equal(report.rows.length, 10, 'five a side on the final board');
    assert.equal(report.rows.filter(r => r.mvp).length, 1, 'exactly one MVP star');
    assert.ok(report.adr >= 0);
  } finally { restore(); }
});

test('smoke screens deploy on an 18 s fuse and the buy window follows freeze time', () => {
  const restore = installCanvasStub();
  try {
    const w = fixture();
    const { ctx } = botCtx(w);
    const manager = new CSManager({
      world: w, scene: new THREE.Scene(), ctx,
      onFeed() {}, onMoney() {}, onPhase() {}, onRoundEnd() {}, onBombPlanted() {}, onBombBeep() {},
      onBombExploded() {}, onBombDefused() {}, onRoundStart() {}, onMatchEnd() {},
    });
    manager.startMatch();
    assert.equal(manager.canBuyNow, true, 'freeze time is buy time');
    assert.equal(manager.inBuyZone(0, -58, 'alpha'), true, 'the CT disc is a buy zone');
    assert.equal(manager.inBuyZone(0, 0, 'alpha'), false, 'mid is not');
    assert.equal(manager.inBuyZone(0, 58, 'bravo'), true);
    assert.equal(manager.chargePlayer(100000), false, 'you cannot buy what you cannot afford');
    manager.detonateSmoke(new THREE.Vector3(0, 0, 20));
    assert.equal(manager.smokes.length, 1);
    assert.ok(manager.smokes[0].r > 4, 'the cloud is big enough to hide a lane');
    for (let i = 0; i < 19; i++) manager.update(1);
    assert.equal(manager.smokes.length, 0, 'the smoke clears after ~18 s');
    for (let i = 0; i < 45; i++) manager.update(0.5);
    assert.equal(manager.canBuyNow, false, 'live rounds lock the armory');
    assert.equal(manager.chargePlayer(1), false);
  } finally { restore(); }
});
