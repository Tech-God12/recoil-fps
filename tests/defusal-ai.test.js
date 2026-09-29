import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();

const inert = new Proxy(function () {}, {
  get(_t, p) {
    if (p === 'currentTime') return 0;
    if (p === 'state') return 'running';
    if (p === 'sampleRate') return 44100;
    if (p === 'getChannelData') return () => new Float32Array(64);
    if (p === 'then') return undefined;
    if (p === Symbol.toPrimitive) return () => 0;
    return inert;
  },
  apply() { return inert; }, construct() { return inert; }, set() { return true; },
});
globalThis.window = globalThis;
globalThis.AudioContext = inert;

const { buildWorld } = await import('../src/game/world.ts');
const { Engine } = await import('../src/game/engine.ts');
const { DefusalMode } = await import('../src/game/defusal/mode.ts');
const { TIMING } = await import('../src/game/defusal/rules.ts');
const { teamBuyCall, planPurchases, FULL_BUY_THRESHOLD, ROLE_SHEET } = await import('../src/game/defusal/botplan.ts');
const { SITES } = await import('../src/game/maps/sirocco.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const world = buildWorld(new THREE.Scene(), 'sirocco', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));
const phys = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 4 };
phys.nearSolids = Engine.prototype.nearSolids.bind(phys);
Engine.prototype.buildSolidGrid.call(phys);

function makeAiMode(side = 'defend', seed = 42, difficulty = 'Normal') {
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const player = { pos: new THREE.Vector3(0, 0, 35), alive: true, hp: 100 };
  const feed = [];
  const grenadesThrown = [];
  const radioCalls = [];
  let mode = null;
  mode = new DefusalMode({
    scene: new THREE.Scene(), occluders: world.occluders, coverNodes: world.coverNodes, solids: world.solids, half: world.half,
    groundHeight: world.groundHeight, effects: new Proxy({}, { get: () => () => {} }),
    moveCollide: (p, dx, dz, r) => { Engine.prototype.moveAxis.call(phys, p, dx, dz, r, 1.7); p.y = Engine.prototype.supportHeight.call(phys, p, r); },
    playerPos: () => new THREE.Vector3(player.pos.x, 1.62, player.pos.z), playerFeet: () => player.pos.clone(),
    playerAlive: () => player.alive, playerHp: () => player.hp, playerCanSee: () => false,
    damagePlayer: () => {},
    throwGrenade: (_f, target, owner, kind) => grenadesThrown.push({ kind, at: target.clone(), owner }),
    onBotFire: () => {},
    spawnPlayer: at => { player.pos.copy(at); player.alive = true; player.hp = 100; },
    equipPlayer: () => {}, bombDetonated: () => {},
    onFeed: (k, w, v) => feed.push(`${k}>${w}>${v}`), onRadio: text => radioCalls.push(text), onCallout: () => {}, announce: () => {},
    onMoney: () => {}, earnWallet: () => {}, onMatchEnd: () => {},
  }, { side, format: 'short', difficulty }, rng);
  const step = (sec, dt = 1 / 30) => {
    const n = Math.max(1, Math.round(sec / dt));
    for (let i = 0; i < n; i++) {
      if (mode.match.phase === 'live' && player.alive) { player.alive = false; mode.playerKilled(null, false, 'C4'); }
      mode.update(dt, { interact: false });
    }
    return n * dt;
  };
  return { mode, player, feed, grenadesThrown, radioCalls, step };
}

test('attack plan styles: rush vs split vs default vs fake produce distinct lane sheets and speeds', () => {
  const { mode } = makeAiMode('defend', 10);
  const lanesFor = mode['lanesFor'].bind(mode);

  // Rush style: all 5 bots push the same main lane
  const rushA = lanesFor({ site: 'A', style: 'rush' });
  const rushB = lanesFor({ site: 'B', style: 'rush' });
  assert.equal(rushA.every(l => l === 'long'), true, 'Rush A sends all bots through long');
  assert.equal(rushB.every(l => l === 'tunnels'), true, 'Rush B sends all bots through tunnels');

  // Split style: bots split between two attack lanes
  const splitA = lanesFor({ site: 'A', style: 'split' });
  const splitB = lanesFor({ site: 'B', style: 'split' });
  assert.ok(splitA.includes('long') && splitA.includes('short'), 'Split A uses both long and short lanes');
  assert.ok(splitB.includes('tunnels') && splitB.includes('window'), 'Split B uses both tunnels and window lanes');

  // Default style: spreads across 5 distinct control zones
  const def = lanesFor({ site: 'A', style: 'default' });
  const uniqueLanes = new Set(def);
  assert.equal(uniqueLanes.size, 5, 'Default style occupies 5 distinct map lanes');

  // Fake style: splits pressure between both sites
  const fakeA = lanesFor({ site: 'A', style: 'fake' });
  assert.ok(fakeA.includes('tunnels') && (fakeA.includes('short') || fakeA.includes('long')), 'Fake A exerts pressure on B tunnels and A lanes');
});

test('post-plant: attackers anchor on designated site posts and hold defensive angles', () => {
  const { mode, step } = makeAiMode('defend', 15);
  step(TIMING.freeze + 0.1);

  const attackers = mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'attack');
  assert.ok(attackers.length > 0);

  // Plant the bomb on site A
  const planter = attackers[0];
  mode.giveBomb(planter);
  planter.bot.pos.set(-31, 0, -30);
  mode.plantBomb(planter, new THREE.Vector3(-31, 0, -30));
  assert.equal(mode.match.phase, 'planted');

  // Verify all living attackers receive anchor hold tasks on site A post-plant spots
  const siteA = SITES.A;
  for (const c of attackers) {
    const plan = mode['plans'].get(c.bot);
    assert.ok(plan, `${c.name} has a plan`);
    assert.equal(plan.task, 'hold', `${c.name} is holding`);
    assert.equal(plan.anchor, true, `${c.name} is anchored`);
    assert.ok(plan.hold, `${c.name} has a hold spot`);
    // Hold spot matches one of the authored post-plant positions
    const isPostPlantSpot = siteA.postPlant.some(sp =>
      Math.abs(sp.at[0] - plan.hold.at[0]) < 0.1 && Math.abs(sp.at[1] - plan.hold.at[1]) < 0.1
    );
    assert.ok(isPostPlantSpot, `${c.name} is stationed at an authored post-plant position`);
  }
});

test('retake: defenders stage together and deploy smoke + flashbang utility', () => {
  const { mode, grenadesThrown, step } = makeAiMode('attack', 20);
  step(TIMING.freeze + 0.1);

  // Give defenders utility
  const defenders = mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'defend');
  for (const c of defenders) {
    c.inv.smokes = 1;
    c.inv.flashes = 1;
    c.bot.flashes = 1;
  }

  // Plant the bomb on site B
  const planter = mode.players.find(c => c.bot && c.alive && mode.sideOf(c) === 'attack');
  mode.giveBomb(planter);
  planter.bot.pos.set(31, 0, -29);
  mode.plantBomb(planter, new THREE.Vector3(31, 0, -29));
  assert.equal(mode.match.phase, 'planted');

  // Verify defenders are assigned retakeStage tasks
  for (const c of defenders) {
    const plan = mode['plans'].get(c.bot);
    assert.ok(plan);
    assert.equal(plan.task, 'retakeStage', `${c.name} starts in retakeStage`);
  }

  // Step simulation until retake triggers
  for (let i = 0; i < 40 && mode.match.phase === 'planted'; i++) {
    step(0.3);
  }

  // Verify utility was thrown during retake
  const thrownSmokes = grenadesThrown.filter(g => g.kind === 'smoke');
  const thrownFlashes = grenadesThrown.filter(g => g.kind === 'flash');
  assert.ok(thrownSmokes.length > 0 || thrownFlashes.length > 0, 'Defenders deployed retake utility (smoke or flash)');
});

test('sound awareness: gunfire and footstep alerts rotate bot gaze towards threat', () => {
  const { mode, step } = makeAiMode('attack', 25);
  step(TIMING.freeze + 0.1);

  const defender = mode.players.find(c => c.bot && c.alive && mode.sideOf(c) === 'defend');
  assert.ok(defender && defender.bot);

  // Place defender holding an angle facing North
  const plan = mode['plans'].get(defender.bot);
  plan.task = 'hold';
  plan.hold = { at: [defender.bot.pos.x, defender.bot.pos.z], face: [defender.bot.pos.x, defender.bot.pos.z - 10] };
  plan.lookAt = null;

  // Sound event nearby (e.g. footsteps/gunfire from East)
  const soundPos = new THREE.Vector3(defender.bot.pos.x + 12, 0, defender.bot.pos.z);
  mode.notifyGunshot(soundPos, 20);

  // Bot should turn gaze towards sound origin
  assert.ok(plan.lookAt, 'Bot registered sound and oriented gaze');
  assert.ok(plan.lookAt.distanceTo(soundPos) < 0.1, 'Bot lookAt matches sound origin');
  assert.ok(plan.lookT > mode.roundTime, 'Look duration is active');
});

test('team economy: buy calls synchronize team strategy without split eco/full buys', () => {
  let rngVal = 0.5;
  const rng = () => rngVal;

  // Pistol round (round 1)
  assert.equal(teamBuyCall([800, 800, 800, 800, 800], 'attack', { pistolRound: true, lastOfHalf: false, mustWin: false }), 'pistol');

  // Eco round (low team average bank)
  assert.equal(teamBuyCall([1800, 1500, 2000, 1400, 1900], 'defend', { pistolRound: false, lastOfHalf: false, mustWin: false }), 'eco');

  // Force buy (medium bank or last round of half)
  assert.equal(teamBuyCall([2800, 2900, 2700, 2600, 3000], 'attack', { pistolRound: false, lastOfHalf: false, mustWin: false }), 'force');
  assert.equal(teamBuyCall([1400, 1200, 1800, 1500, 1100], 'defend', { pistolRound: false, lastOfHalf: true, mustWin: false }), 'force');

  // Full buy (rich team bank above threshold)
  assert.ok(FULL_BUY_THRESHOLD.attack <= 4200);
  assert.equal(teamBuyCall([5000, 4800, 5200, 4400, 4600], 'attack', { pistolRound: false, lastOfHalf: false, mustWin: false }), 'full');

  // Individual role purchases under full buy
  const startInv = { money: 6000, primary: null, secondary: 'm1911', armor: 0, kit: false, frags: 0, flashes: 0, smokes: 0 };
  for (const role of ROLE_SHEET) {
    const bought = planPurchases(startInv, 'defend', 'full', role, rng);
    assert.ok(bought.primary !== null, `${role} bought a primary weapon`);
    assert.equal(bought.armor, 2, `${role} bought full armor (vest + helmet)`);
    assert.ok(bought.money < startInv.money, `${role} spent money`);
  }
});
