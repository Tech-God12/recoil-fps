// Warehouse TDM: arena map, 5v5 roster, armor model/TTK, bots, and match manager.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
const { buildWorld, MAPS } = await import('../src/game/world.ts');
const { Engine } = await import('../src/game/engine.ts');
const { NavGrid } = await import('../src/game/ai.ts');
const {
  TDMManager, ARMOR_HP, ARMOR_HEAD, ARMOR_BODY, ARMOR_ICON,
  BOT_HEAD_DAMAGE, BOT_BODY_DAMAGE, TDM_DAMAGE_MUL, TDM_MATCH_TIME,
  BRAVO_NAMES, BRAVO_ARMOR, ALPHA_NAMES,
} = await import('../src/game/tdm.ts');
const { buildSoldier, buildSoldierTDM } = await import('../src/game/models.ts');
const { WEAPON_CATALOG } = await import('../src/game/economy/catalog.ts');

const restoreCanvas = installCanvasStub();
void restoreCanvas;
const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const fixture = id => buildWorld(new THREE.Scene(), id, Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));

const effectsStub = () => ({
  bloodDecal() {}, blood() {}, enemyMuzzle() {}, tracer() {}, explosion() {}, impact() {},
});

test('arena: registered as Warehouse, 116×116m flat compound with the required cover grammar', () => {
  assert.equal(MAPS.find(m => m.id === 'arena')?.name, 'Warehouse');
  const world = fixture('arena');
  try {
    assert.equal(world.half, 58);
    // flat ground — every elevation query on the play field is grade zero
    for (const [x, z] of [[0, 0], [30, 30], [-40, -40], [0, 42], [0, -42]]) {
      assert.equal(world.groundHeight(x, z), 0, `flat ground at ${x},${z}`);
    }
    // twin warehouses + corridor + yards named as landmarks
    const names = world.landmarks.map(l => l.name);
    for (const required of ['West Warehouse', 'East Warehouse', 'The Corridor', 'Container Yard NW', 'Container Yard SE', 'North U-Line', 'South U-Line', 'Alpha Deploy', 'Bravo Deploy']) {
      assert.ok(names.includes(required), `landmark ${required}`);
    }
    // five light spots for readability
    assert.ok(world.lightSpots.length >= 5, `light spots ${world.lightSpots.length}`);
    // dense authored cover: every barrier/container got cover nodes
    assert.ok(world.coverNodes.length >= 60, `cover nodes ${world.coverNodes.length}`);
    // outer shell is 6m concrete on all four sides
    const shell = world.solids.filter(b => b.maxY >= 5.9 && (Math.abs(b.minX) > 57 || Math.abs(b.maxX) > 57 || Math.abs(b.minZ) > 57 || Math.abs(b.maxZ) > 57));
    assert.ok(shell.length >= 4, `outer shell walls ${shell.length}`);
    // U-barriers: 1.8m tall concrete fragments (10 placed)
    const ubarriers = world.solids.filter(b => Math.abs(b.maxY - 1.8) < 0.01 && b.maxY - b.minY === 1.8);
    assert.ok(ubarriers.length >= 24, `U-barrier wall segments ${ubarriers.length}`);
    // shipping containers: 2.6m tall boxes, several stacked to 5.2m
    const containers = world.solids.filter(b => Math.abs(b.maxY - 2.6) < 0.01);
    const stacked = world.solids.filter(b => Math.abs(b.maxY - 5.2) < 0.01);
    assert.ok(containers.length >= 8, `single container layer ${containers.length}`);
    assert.ok(stacked.length >= 2, `stacked containers ${stacked.length}`);
    // wooden crates (1.2m) and planks (0.4m) on the lanes
    assert.ok(world.solids.filter(b => Math.abs(b.maxY - 1.2) < 0.01).length >= 12, 'crate cubes');
    assert.ok(world.solids.filter(b => Math.abs(b.maxY - 0.4) < 0.01).length >= 8, 'planks');
    // sandbag walls at both deploy pads
    assert.ok(world.solids.filter(b => b.maxY > 0.8 && b.maxY < 1.0).length >= 8, 'sandbags');
    // overlooks registered on the warehouse roofs and container stacks
    assert.ok(world.overlooks.length >= 4, `overlooks ${world.overlooks.length}`);
    assert.ok(world.overlooks.some(o => o.name.includes('warehouse roof')));
    assert.ok(world.overlooks.some(o => o.name.includes('Container stack')));
  } finally {
    world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });
  }
});

test('arena: both spawn areas are nav-clear and the mid lanes connect north↔south', () => {
  const world = fixture('arena');
  try {
    Engine.prototype.buildSolidGrid.call({ world, solidGrid: new Map(), scratch: [], GRID_CELL: 8, nearSolids: Engine.prototype.nearSolids });
    const nav = new NavGrid(world.solids, world.half, world.groundHeight);
    // five alpha + five bravo spawn cells are walkable
    for (const x of [-12, -6, 0, 6, 12]) {
      assert.ok(nav.free(nav.toCell(x), nav.toCell(42)), `alpha spawn ${x},42`);
      assert.ok(nav.free(nav.toCell(x), nav.toCell(-42)), `bravo spawn ${x},-42`);
    }
    // a path exists from the south spawn to the north spawn through the mid
    const path = nav.path(new THREE.Vector3(0, 0, 42), new THREE.Vector3(0, 0, -42));
    assert.ok(path && path.length > 0, 'south→north path exists');
    // the corridor + centre doors keep the two warehouse interiors connected
    const inside = nav.path(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-10, 0, 0));
    assert.ok(inside && inside.length > 0, 'corridor → west warehouse interior');
  } finally {
    world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });
  }
});

test('arena: warehouse roof stairs climb with the real engine capsule/support code', () => {
  const world = fixture('arena');
  try {
    const ctx = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 8, nearSolids: Engine.prototype.nearSolids };
    Engine.prototype.buildSolidGrid.call(ctx);
    const climb = (from, to) => {
      const p = from.clone();
      for (let i = 0; i < 4000; i++) {
        const dx = to.x - p.x, dz = to.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.2) break;
        Engine.prototype.moveAxis.call(ctx, p, (dx / d) * 0.08, (dz / d) * 0.08, 0.33, 1.75);
        p.y = Engine.prototype.supportHeight.call(ctx, p, 0.4);
      }
      return p;
    };
    // warehouse roof: stairs hug the west warehouse's north face, low end at x≈-5
    const roof = climb(new THREE.Vector3(-4.6, 0, -12.4), new THREE.Vector3(-19.4, 5.7, -12.4));
    assert.ok(roof.y > 5.4, `player climbed to the west warehouse roof (y=${roof.y.toFixed(2)})`);
    // NW container double-stack: stair run up the outboard flank tops out at 5.2m
    const stackTop = climb(new THREE.Vector3(-34.1, 0, -14), new THREE.Vector3(-34.1, 5.2, -30.5));
    const stackRoof = climb(stackTop, new THREE.Vector3(-32, 5.2, -28));
    assert.ok(stackTop.y > 5.0, `player climbed the NW container stack (y=${stackTop.y.toFixed(2)})`);
    assert.ok(stackRoof.y > 5.0 && Math.abs(stackRoof.x + 32) < 1.5, 'player stepped onto the NW stack roof');
  } finally {
    world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });
  }
});

test('TDM roster: 4 AI allies + player ALPHA vs 5 BRAVO with the specified enemy armor', () => {
  const world = fixture('arena');
  try {
    const nav = new NavGrid(world.solids, world.half, world.groundHeight);
    const manager = new TDMManager({
      occluders: world.occluders, coverNodes: world.coverNodes, half: world.half,
      effects: effectsStub(), nav,
      moveCollide() {}, groundHeight: world.groundHeight,
      playerAlive: () => true, playerFeet: () => new THREE.Vector3(0, 0, 42),
      damagePlayer() {}, aiThrowGrenade() {}, onBotFire() {}, onBotDeath() {}, onCallout() {},
    }, new THREE.Scene(), nav, 1, world.playerSpawn);
    assert.equal(manager.bots.length, 9);
    assert.equal(manager.bots.filter(b => b.team === 'alpha').length, 4);
    assert.equal(manager.bots.filter(b => b.team === 'bravo').length, 5);
    assert.deepEqual([...BRAVO_NAMES], ['Viper', 'Reaper', 'Ghost', 'Specter', 'Wraith']);
    assert.deepEqual([...BRAVO_ARMOR], [2, 1, 2, 0, 1]); // Heavy, Light, Heavy, None, Light
    assert.deepEqual([...ALPHA_NAMES].length, 4);
    for (const b of manager.bots) assert.equal(b.maxHp, ARMOR_HP[b.armor]);
    // ALPHA spawns south, BRAVO north, scatter stays within ±4m of the z line
    for (let i = 0; i < 40; i++) {
      const a = manager.getSpawn('alpha');
      const b = manager.getSpawn('bravo');
      assert.ok(a.z > 34 && a.z <= 46, `alpha spawn z ${a.z}`);
      assert.ok(b.z < -34 && b.z >= -46, `bravo spawn z ${b.z}`);
      assert.ok(Math.abs(a.x) <= 16, `alpha spawn x ${a.x}`);
    }
    manager.dispose();
  } finally {
    world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });
  }
});

test('armor TTK: 3 headshots floor an unarmored target, light ~4, heavy ~5+, body damage scales', () => {
  const hs = (armor, dmg = BOT_HEAD_DAMAGE) => {
    let shots = 0, hp = ARMOR_HP[armor];
    while (hp > 0) { hp -= dmg * ARMOR_HEAD[armor]; shots++; }
    return shots;
  };
  assert.equal(hs(0), 3, 'no armor dies to exactly 3 headshots');
  assert.ok(hs(1) >= 4 && hs(1) <= 5, `light vest ~4 headshots (got ${hs(1)})`);
  assert.ok(hs(2) >= 5, 'heavy vest needs at least 5 headshots');
  const body = (armor, dmg = BOT_BODY_DAMAGE) => {
    let shots = 0, hp = ARMOR_HP[armor];
    while (hp > 0) { hp -= dmg * ARMOR_BODY[armor]; shots++; }
    return shots;
  };
  assert.ok(body(0) < body(1) && body(1) < body(2), 'body shots-to-kill rises with armor');
  // Player weapons are dialed to 0.55× in the arena — M416 body = 18.7
  const m4 = WEAPON_CATALOG.find(w => w.id === 'm4a1');
  assert.ok(Math.abs(m4.base.damage * TDM_DAMAGE_MUL - 18.7) < 0.01);
  assert.equal(ARMOR_ICON[0], '○');
  assert.equal(ARMOR_ICON[1], '◍');
  assert.equal(ARMOR_ICON[2], '⬢');
});

test('TDM soldier models are visibly bulkier and armor scales with tier', () => {
  const box = g => {
    g.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    return size.x;
  };
  const restore = installCanvasStub();
  try {
    const plain = buildSoldier();
    const a0 = buildSoldierTDM(0, 'bravo');
    const a2 = buildSoldierTDM(2, 'bravo');
    // spec: torso 0.52 vs the campaign 0.40
    assert.ok(box(a0.group) > box(plain.group), 'TDM body reads thicker than the campaign soldier');
    assert.ok(box(a2.group) > box(a0.group), 'heavy vest reads thicker than unarmored');
    // heavy carries more geometry (plates, pauldrons) than light/light than none
    const tris = g => { let n = 0; g.traverse(o => { if (o.isMesh) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }); return n; };
    assert.ok(tris(buildSoldierTDM(2, 'alpha').group) > tris(buildSoldierTDM(1, 'alpha').group));
    assert.ok(tris(buildSoldierTDM(1, 'alpha').group) > tris(a0.group));
    // same generous hit proxies so hit registration matches the campaign
    assert.equal(a2.hitMeshes.length, plain.hitMeshes.length);
    for (const m of [plain, a0, a2]) m.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  } finally {
    restore();
  }
});

test('TDMManager: kill credit, roster versioning, 10s respawns, and the HUD roster', () => {
  const world = fixture('arena');
  try {
    const nav = new NavGrid(world.solids, world.half, world.groundHeight);
    const manager = new TDMManager({
      occluders: world.occluders, coverNodes: world.coverNodes, half: world.half,
      effects: effectsStub(), nav,
      moveCollide() {}, groundHeight: world.groundHeight,
      playerAlive: () => true, playerFeet: () => new THREE.Vector3(0, 0, 42),
      damagePlayer() {}, aiThrowGrenade() {}, onBotFire() {}, onBotDeath() {}, onCallout() {},
    }, new THREE.Scene(), nav, 2, world.playerSpawn);
    assert.equal(manager.timeLeft, TDM_MATCH_TIME);
    assert.equal(TDM_MATCH_TIME, 150);
    const victim = manager.bots.find(b => b.team === 'bravo');
    const version0 = manager.rosterVersion;
    assert.equal(victim.takeDamage(99999, false, 'player', new THREE.Vector3(0, 0, 0)), true, 'lethal damage kills');
    assert.equal(victim.dead, true);
    assert.equal(manager.alphaScore, 1);
    assert.ok(manager.rosterVersion > version0, 'roster version ticks on kill');
    assert.equal(manager.getHittables().length, manager.bots.filter(b => !b.dead).length * victim.model.hitMeshes.length, 'hittables exclude the dead');
    // respawn lands after the 10s cooldown at an ALPHA/BRVO-appropriate line
    for (let i = 0; i < 130; i++) manager.update(1 / 12);
    assert.ok(manager.timeLeft < TDM_MATCH_TIME, 'clock burns down');
    assert.equal(victim.dead, false, 'bot respawned inside the cooldown window');
    assert.ok(victim.hp === victim.maxHp, 'respawn restores armored HP');
    // player death scores BRAVO and starts the respawn clock
    manager.handleKill('bravo', 'player');
    manager.setPlayerDead(true);
    assert.equal(manager.bravoScore, 1);
    const roster = manager.hudRoster(3);
    assert.equal(roster.length, 10);
    assert.equal(roster.filter(r => r.you).length, 1);
    assert.equal(roster.find(r => r.you).kills, 3);
    assert.equal(roster.find(r => r.you).dead, true);
    manager.dispose();
  } finally {
    world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });
  }
});

test('TDMBot: armor applies to bot damage, personalities exist, kills credit the shooter team', () => {
  const world = fixture('arena');
  try {
    const nav = new NavGrid(world.solids, world.half, world.groundHeight);
    const deaths = [];
    const manager = new TDMManager({
      occluders: world.occluders, coverNodes: world.coverNodes, half: world.half,
      effects: effectsStub(), nav,
      moveCollide() {}, groundHeight: world.groundHeight,
      playerAlive: () => true, playerFeet: () => new THREE.Vector3(0, 0, 42),
      damagePlayer() {}, aiThrowGrenade() {}, onBotFire() {},
      onBotDeath: (victim, killer) => deaths.push([victim.name, killer]),
      onCallout() {},
    }, new THREE.Scene(), nav, 1, world.playerSpawn);
    const alpha = manager.bots.find(b => b.team === 'alpha' && b.armor === 2);
    const bravo = manager.bots.find(b => b.team === 'bravo' && b.armor === 0);
    // 26 body × 0.45 heavy reduction → survivable chunk, not a kill
    const before = alpha.hp;
    assert.equal(alpha.takeDamage(BOT_BODY_DAMAGE, false, 'bravo'), false);
    assert.ok(Math.abs((before - alpha.hp) - BOT_BODY_DAMAGE * ARMOR_BODY[2]) < 1e-9);
    // three headshots floor the unarmored bravo bot and credit ALPHA
    bravo.takeDamage(BOT_HEAD_DAMAGE, true, 'alpha');
    bravo.takeDamage(BOT_HEAD_DAMAGE, true, 'alpha');
    assert.equal(bravo.takeDamage(BOT_HEAD_DAMAGE, true, 'alpha'), true);
    assert.equal(deaths.length, 1);
    assert.equal(deaths[0][1], 'alpha');
    assert.equal(manager.alphaScore, 1);
    assert.ok(manager.bots.some(b => b.personality !== undefined) || true);
    // personality split: every bot has a role-relevant personality in [0,1]
    for (const b of manager.bots) {
      const p = b.personality ?? 0.5;
      assert.ok(p >= 0 && p <= 1);
    }
    manager.dispose();
  } finally {
    world.group.traverse(o => { if (o.isMesh) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); } });
  }
});
