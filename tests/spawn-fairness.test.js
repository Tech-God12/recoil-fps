import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
import { installAudioStub } from './helpers/audio.js';

const { buildWorld } = await import('../src/game/world.ts');
const { TDMManager, SPAWN_CLOSE_RANGE, TDM_RESPAWN_SECONDS } = await import('../src/game/tdm.ts');
const { SpawnProtection, EXPOSED_SPAWN_SHIELD_SECONDS } = await import('../src/game/systems/spawn-protection.ts');
const { Engine } = await import('../src/game/engine.ts');

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function warehouse() {
  const restoreCanvas = installCanvasStub();
  const originalRandom = Math.random;
  Math.random = seeded(127);
  const scene = new THREE.Scene();
  let world, manager;
  try {
    world = buildWorld(scene, 'arena');
    const beforeBots = scene.children.length;
    const player = world.playerSpawn.clone();
    const reports = { shots: 0, feed: 0, damage: 0, grenades: 0 };
    const ctx = {
      scene, occluders: world.occluders, coverNodes: world.coverNodes,
      solids: world.solids, half: world.half,
      groundHeight: world.navigationHeight ?? world.groundHeight,
      effects: { blood() {}, bloodDecal() {}, tracer() {}, enemyMuzzle() {} },
      playerPos: () => player.clone().add(new THREE.Vector3(0, 1.62, 0)),
      playerFeet: () => player.clone(), playerAlive: () => true,
      damagePlayer() { reports.damage++; },
      moveCollide(p, dx, dz, r) {
        const x = p.x + dx, z = p.z + dz;
        if (!world.solids.some(b => b.minY < p.y + 1.7 && b.maxY > p.y + 0.55
          && x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ)) { p.x = x; p.z = z; }
      },
      onCallout() {}, throwGrenade() { reports.grenades++; },
      onBotFire() { reports.shots++; }, onFeed() { reports.feed++; },
      onScore() {}, playerOnFire: () => false,
    };
    manager = new TDMManager(ctx);
    return {
      scene, world, manager, player, ctx, reports,
      cleanup() {
        manager.dispose();
        assert.equal(manager.bots.length, 0, 'the match releases all nine bot models');
        assert.equal(scene.children.length, beforeBots, 'glow/marker sprites are removed with the actors');
        const geometry = new Set(), materials = new Set();
        world.group.traverse(o => {
          if (!o.isMesh && !o.isPoints) return;
          geometry.add(o.geometry);
          for (const material of Array.isArray(o.material) ? o.material : [o.material]) materials.add(material);
        });
        for (const g of geometry) { g.disposeBoundsTree?.(); g.dispose(); }
        for (const m of materials) m.dispose();
        world.group.removeFromParent();
        Math.random = originalRandom;
        restoreCanvas();
      },
    };
  } catch (error) {
    manager?.dispose();
    Math.random = originalRandom;
    restoreCanvas();
    throw error;
  }
}

function assertLanding(rig, decision, forPlayer = false) {
  const { manager, world, player } = rig;
  const { position: p } = decision;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < world.half && Math.abs(p.z) < world.half);
  assert.ok(manager.nav.free(manager.nav.toCell(p.x), manager.nav.toCell(p.z)), 'landing must be navigable');
  assert.ok(!world.solids.some(b => b.minY < p.y + 1.7 && b.maxY > p.y + 0.55
    && p.x + 0.36 > b.minX && p.x - 0.36 < b.maxX
    && p.z + 0.36 > b.minZ && p.z - 0.36 < b.maxZ), 'no body may begin in a solid');
  const bodies = manager.bots.filter(b => !b.dead).map(b => b.pos);
  if (!forPlayer) bodies.push(player);
  for (const other of bodies) assert.ok(Math.hypot(p.x - other.x, p.z - other.z) >= 1.5,
    'landing must clear both enemy and friendly body capsules');
  assert.equal(decision.exposed, decision.visibleThreats > 0 || decision.nearestEnemy < SPAWN_CLOSE_RANGE);
}

test('simulation-time spawn shield expires, never uses wall time, and resets on attack or a safe spawn', () => {
  const shield = new SpawnProtection();
  shield.grant(false);
  assert.equal(shield.active, false);
  shield.grant(true);
  assert.equal(shield.remaining, EXPOSED_SPAWN_SHIELD_SECONDS);
  shield.tick(-5); shield.tick(NaN); shield.tick(0);
  assert.equal(shield.remaining, EXPOSED_SPAWN_SHIELD_SECONDS, 'paused frames cannot consume grace');
  shield.tick(0.6);
  assert.ok(Math.abs(shield.remaining - 1) < 0.001);
  shield.cancel(); assert.equal(shield.active, false);
  shield.grant(true); shield.tick(EXPOSED_SPAWN_SHIELD_SECONDS);
  assert.equal(shield.remaining, 0);
  shield.grant(true); shield.grant(false);
  assert.equal(shield.active, false, 'safe redeployment removes any previous shield');
});

test('successful streak calls and confirmed strikes forfeit grace; unavailable calls do not', () => {
  const shield = new SpawnProtection();
  let activations = 0;
  const streaks = {
    activate() { activations++; return true; },
    confirmStrike() { activations++; return true; },
  };
  shield.grant(true);
  assert.equal(shield.spendOn(() => streaks.activate('uav')), true);
  assert.equal(shield.active, false, 'remote offensive support cannot hide under invulnerability');
  shield.grant(true);
  assert.equal(shield.spendOn(() => false), false);
  assert.equal(shield.active, true, 'an unavailable streak is not an attack');
  assert.equal(shield.spendOn(() => streaks.confirmStrike()), true);
  assert.equal(shield.active, false, 'confirming a real strike cancels protection');
  assert.equal(activations, 2);
  const source = readFileSync(new URL('../src/game/engine.ts', import.meta.url), 'utf8');
  assert.match(source, /spawnShield\.spendOn\(\(\) => this\.streaks\.activate\(streak\)\)/);
  assert.match(source, /spawnShield\.spendOn\(\(\) => this\.streaks\.confirmStrike\(\)\)/);
});

test('real Warehouse LOS and bodies: 80 approach and 80 occupied-pad redeploys, plus mirrored Bravo stress', () => {
  const rig = warehouse();
  try {
    const { manager, player } = rig;
    assert.equal(manager.bots.length, 9);
    const enemies = manager.bots.filter(b => b.team === 'bravo');
    for (const [locations, expectedClose] of [
      [[[0, 28], [12, 27], [-12, 27], [0, 30], [0, 26]], 0],
      [[[0, 38], [-12, 37], [12, 37], [-4, 40], [4, 40]], 0],
    ]) {
      enemies.forEach((b, i) => b.pos.set(locations[i][0], 0, locations[i][1]));
      let close = 0, seen = 0, protectedCount = 0;
      for (let i = 0; i < 80; i++) {
        const decision = manager.getSpawnDecision('alpha', true);
        assertLanding(rig, decision, true);
        if (decision.nearestEnemy < SPAWN_CLOSE_RANGE) close++;
        if (decision.visibleThreats) seen++;
        if (decision.exposed) protectedCount++;
      }
      assert.equal(close, expectedClose, 'inner-yard fallback must beat a point-blank camper');
      assert.ok(protectedCount >= seen, 'every line-of-sight spawn receives protection');
      if (locations[0][1] === 38) assert.ok(seen < 76, 'occupation LOS must improve on the 76/80 baseline');
      else assert.ok(protectedCount > 0, 'approach collapse needs guaranteed grace when no pad is safe');
    }
    const alpha = manager.bots.filter(b => b.team === 'alpha');
    [[0, -28], [-12, -27], [12, -27], [0, -30]].forEach(([x, z], i) => alpha[i].pos.set(x, 0, z));
    player.set(0, 0, -26); // fifth Alpha opponent against the mirrored Bravo yard
    for (let i = 0; i < 80; i++) {
      const decision = manager.getSpawnDecision('bravo');
      assertLanding(rig, decision);
      assert.ok(decision.position.z < 0, 'Bravo stays on its own half when Alpha pushes');
    }
  } finally { rig.cleanup(); }
});

test('fully occupied primary choices search a bounded free nav ring instead of materializing inside a bot', () => {
  const rig = warehouse();
  const { manager, ctx } = rig;
  const realBots = manager.bots;
  const previousRandom = Math.random;
  const nearestFree = manager.nav.nearestFree;
  try {
    const primary = [];
    Math.random = () => 0.5; // repeat the same ten primary candidates on both calls
    manager.bots = [];
    manager.nav.nearestFree = function (cx, cz) {
      const cell = nearestFree.call(this, cx, cz);
      primary.push(new THREE.Vector3(this.toWorld(cell[0]), ctx.groundHeight(this.toWorld(cell[0]), this.toWorld(cell[1])), this.toWorld(cell[1])));
      return cell;
    };
    manager.getSpawnDecision('alpha', true);
    assert.equal(primary.length, 10);
    manager.nav.nearestFree = nearestFree;
    manager.bots = primary.map(pos => ({ pos, team: 'bravo', dead: false }));
    const landing = manager.getSpawnDecision('alpha', true);
    assertLanding(rig, landing, true);
    assert.ok(landing.exposed, 'a yard camped at all ten choices cannot silently lose its grace');
  } finally {
    manager.nav.nearestFree = nearestFree;
    manager.bots = realBots;
    Math.random = previousRandom;
    rig.cleanup();
  }
});

test('nine real bot brains advance and the glow/HP/score obey reciprocal shield, shot and throw cancellation', () => {
  const rig = warehouse();
  try {
    const { manager, reports, scene, ctx } = rig;
    const beforeSprites = scene.children.filter(o => o.isSprite).length;
    for (let i = 0; i < 600; i++) manager.update(1 / 30);
    assert.equal(manager.bots.length, 9);
    assert.ok(reports.shots > 0, 'both squads are actually ticking and firing in the headless scene');
    const alpha = manager.bots.find(b => b.team === 'alpha' && !b.dead);
    const bravo = manager.bots.find(b => b.team === 'bravo' && !b.dead);
    assert.ok(alpha && bravo);
    bravo.respawn(bravo.pos.clone(), true);
    const hp = bravo.hp, score = manager.alphaScore;
    assert.equal(bravo.takeDamage(500, false, alpha), false);
    assert.equal(bravo.hp, hp);
    assert.equal(manager.alphaScore, score, 'an immune hit cannot award a kill');
    bravo.updateVisualFrame(0.4);
    assert.ok(bravo.spawnShield.active && bravo.fireGlow.visible);
    assert.equal(bravo.fireGlow.material.color.getHex(), 0x73C9DB);
    assert.equal(scene.children.filter(o => o.isSprite).length, beforeSprites, 'shield reuses the existing glow sprite');
    bravo.fireShot({ feet: alpha.pos.clone(), eye: alpha.eyePos(), isPlayer: false, bot: null });
    bravo.updateVisualFrame(0);
    assert.equal(bravo.spawnShield.active, false, 'shooting ends immunity before resolving a hit');
    assert.equal(bravo.fireGlow.visible, false);
    assert.equal(bravo.takeDamage(500, false, alpha), true);
    manager.handleKill(alpha, bravo, false, 'RIFLE');
    assert.equal(manager.alphaScore, score + 1);
    assert.equal(bravo.spawnShield.active, false, 'death cannot retain a shield');
    bravo.respawn(bravo.pos.clone(), true);
    bravo.grenadeCD = 0; bravo.frags = 1;
    const throwsBefore = reports.grenades;
    const random = Math.random;
    Math.random = () => 0; // force the real bot's grenade branch
    try { bravo.tryGrenade({ feet: alpha.pos.clone(), eye: alpha.eyePos(), isPlayer: false, bot: alpha }, 16); }
    finally { Math.random = random; }
    assert.equal(reports.grenades, throwsBefore + 1);
    assert.equal(bravo.spawnShield.active, false, 'an offensive throw cancels grace');
    ctx.competitive = true;
    bravo.respawn(bravo.pos.clone(), true);
    assert.equal(bravo.spawnShield.active, false, 'ranked rounds never get the Warehouse TDM shield');
    assert.equal(TDM_RESPAWN_SECONDS, 5, 'normal respawn timing is unchanged');
  } finally { rig.cleanup(); }
});

test('player respawn, bot rifle, grenade splash and flash all use the real shield gate', () => {
  const rig = warehouse();
  const restoreAudio = installAudioStub();
  try {
    const { manager, scene, player, ctx } = rig;
    const enemy = manager.bots.find(b => b.team === 'bravo');
    const approach = [[0, 28], [12, 27], [-12, 27], [0, 30], [0, 26]];
    manager.bots.filter(b => b.team === 'bravo').forEach((b, i) => b.pos.set(approach[i][0], 0, approach[i][1]));
    const landing = manager.getSpawnDecision('alpha', true);
    assert.ok(landing.exposed);
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, {
      tdm: { getSpawnDecision: () => landing }, spawnShield: new SpawnProtection(), pos: player,
      vel: new THREE.Vector3(), weapons: [{ magSize: 30 }, { magSize: 8 }], mags: [0, 0],
      hp: 1, tdmArmor: 1, dead: true, ended: false, endPlayerFire() {},
      reloadStages: [], scene, grenades: [], grenadeLaunchVel: () => new THREE.Vector3(0, 5, 0),
      tdmPlayerDead: true, tdmRespawnT: 0, world: rig.world, isTDM: true, isComp: false,
      ai: { enemies: [] }, shake: 0,
      effects: { explosion() {} }, blowOutGlass() {}, onEvent() {},
    });
    Engine.prototype.tdmRespawnPlayer.call(engine);
    assert.ok(engine.pos.equals(landing.position) && engine.spawnShield.active);
    assert.equal(engine.hp, 170);
    assert.deepEqual(engine.mags, [30, 8]);
    const hp = engine.hp;
    Engine.prototype.damagePlayerTDM.call(engine, 900, enemy.pos, enemy);
    assert.equal(engine.hp, hp, 'an enemy rifle cannot damage a protected player');
    let attemptedHits = 0;
    ctx.damagePlayer = (amount, from, killer) => {
      attemptedHits++;
      Engine.prototype.damagePlayerTDM.call(engine, amount, from, killer);
    };
    ctx.occluders = []; // Force an unobstructed bot rifle shot into the live player bridge.
    const random = Math.random;
    Math.random = () => 0;
    try { enemy.fireShot({ feet: engine.pos.clone(), eye: engine.pos.clone().add(new THREE.Vector3(0, 1.62, 0)), isPlayer: true, bot: null }); }
    finally { Math.random = random; ctx.occluders = rig.world.occluders; }
    assert.equal(attemptedHits, 1);
    assert.equal(engine.hp, hp, 'the real AI fire path respects the player shield');
    // Live grenade resolution: player and one protected Bravo target stand by a blast.
    const target = manager.bots.find(b => b.team === 'bravo');
    target.respawn(engine.pos.clone().add(new THREE.Vector3(1, 0, 0)), true);
    for (const b of manager.bots) if (b !== target && b.team === 'bravo') b.pos.set(-39, 0, -39);
    engine.tdm = manager;
    engine.eyePos = () => engine.pos.clone().add(new THREE.Vector3(0, 1.62, 0));
    engine.damagePlayerTDM = Engine.prototype.damagePlayerTDM;
    const g = { mesh: new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial()),
      pos: engine.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), kind: 'frag', fromAI: false, owner: null };
    scene.add(g.mesh);
    const score = manager.alphaScore;
    Engine.prototype.explode.call(engine, g);
    assert.equal(engine.hp, hp, 'blast damage uses the same player gate');
    assert.equal(target.hp, target.maxHp, 'blast damage uses the same bot gate');
    assert.equal(manager.alphaScore, score, 'no free grenade kill through a shield');
    g.mesh.material.dispose();
    engine.tdm = { getSpawnDecision: () => landing };
    Engine.prototype.spawnGrenade.call(engine, engine.pos.clone(), engine.pos.clone().add(new THREE.Vector3(0, 0, -20)), false, 'flash');
    assert.equal(engine.spawnShield.active, false, 'a flash throw ends protection');
    for (const grenade of engine.grenades) { grenade.mesh.removeFromParent(); grenade.mesh.geometry.dispose(); grenade.mesh.material.dispose(); }
    engine.spawnShield.grant(true);
    engine.spawnShield.tick(EXPOSED_SPAWN_SHIELD_SECONDS);
    assert.equal(engine.spawnShield.active, false);
  } finally { restoreAudio(); rig.cleanup(); }
});
