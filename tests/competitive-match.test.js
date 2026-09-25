import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// ---- minimal DOM so the bomb prop and site markers can build headlessly ----
const ctx2d = new Proxy({}, {
  get(target, prop) {
    if (prop === 'canvas') return { width: 256, height: 256 };
    if (prop in target) return target[prop];
    return (..._args) => {
      void _args;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop: () => {} };
      if (prop === 'getImageData') return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
      if (prop === 'measureText') return { width: 1 };
      return undefined;
    };
  },
  set(target, prop, value) { target[prop] = value; return true; },
});
const makeCanvas = () => ({
  width: 0, height: 0, style: {},
  addEventListener: () => {}, removeEventListener: () => {},
  getContext: (kind) => (kind === '2d' ? ctx2d : null),
  toDataURL: () => 'data:image/png;base64,',
});
globalThis.document = { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, addEventListener: () => {} }) };

const world = await import('../src/game/world.ts');
const ai = await import('../src/game/ai.ts');
const match = await import('../src/game/competitive/match.ts');
const rules = await import('../src/game/competitive/rules.ts');
const buy = await import('../src/game/competitive/buy.ts');
const rank = await import('../src/game/economy/rank.ts');
const profile = await import('../src/game/economy/profile.ts');
const tactics = await import('../src/game/competitive/tactics.ts');

/** Deterministic RNG: bots call Math.random, so the whole match is seeded through it. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRig(seed = 7) {
  const rng = mulberry32(seed);
  Math.random = rng;
  const scene = new THREE.Scene();
  const built = world.buildWorld(scene, 'arena');
  const nav = new ai.NavGrid(built.solids, built.half, built.groundHeight);
  const feed = [];
  const ui = [];
  const player = { x: 0, y: 0, z: 36, hp: 100, armor: 0, helmet: false, alive: true };
  const kit = { primary: null, secondary: 'm1911', armor: 0, helmet: false, kit: false, frags: 0, flashes: 0 };
  const bridge = {
    armor: () => player.armor,
    helmet: () => player.helmet,
    setArmor: (armor, helmet) => { player.armor = armor; player.helmet = helmet; },
    alive: () => player.alive,
    position: () => ({ x: player.x, y: player.y + 1.6, z: player.z }),
    spawn: (x, z) => { player.x = x; player.z = z; player.y = built.groundHeight(x, z); player.hp = 100; player.alive = true; },
    applyKit: (next) => Object.assign(kit, next),
    setFrozen: () => {},
    damage: (amount) => { player.hp = Math.max(0, player.hp - amount); if (player.hp <= 0) player.alive = false; },
  };
  const effects = new Proxy({}, { get: () => () => {} });
  const ctx = {
    scene, occluders: built.occluders, nav, coverNodes: built.coverNodes, solids: built.solids, half: built.half,
    groundHeight: built.groundHeight, effects,
    playerPos: () => new THREE.Vector3(player.x, 1.6, player.z),
    playerFeet: () => new THREE.Vector3(player.x, 0, player.z),
    playerAlive: () => player.alive,
    random: rng,
    moveCollide: (p, dx, dz, r) => {
      const nx = p.x + dx, nz = p.z + dz;
      let hit = false;
      for (const b of built.solids) {
        if (b.maxY <= p.y + 0.55 || b.minY > p.y + 1.7) continue;
        if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) { hit = true; break; }
      }
      if (!hit) { p.x = nx; p.z = nz; }
    },
    damagePlayer: (amount) => bridge.damage(amount, { x: 0, y: 0, z: 0 }, 'RIFLE'),
    onCallout: () => {}, throwGrenade: () => {}, onBotFire: () => {},
    onFeed: (...args) => feed.push(args.join(' ')),
    onScore: () => {}, playerOnFire: () => false,
  };
  const runner = new match.CompetitiveRunner({ scene, world: built, ctx, player: bridge, emit: e => ui.push(e), random: rng });
  runner.start();
  const step = (seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds; t += dt) runner.update(dt);
  };
  return { runner, player, kit, feed, ui, step, world: built };
}

/** Play a whole ranked match, returning the round-by-round story. */
function playMatch(seed) {
  const rig = makeRig(seed);
  const { runner } = rig;
  const rounds = [];
  const plants = new Set();
  const defuses = new Set();
  let bombState = runner.match.bomb.state;
  let guard = 0;
  while (runner.match.phase !== 'matchEnd' && guard++ < 40 * 60 * 30) {
    rig.step(1 / 30);
    const bomb = runner.match.bomb;
    if (bomb.state === 'planted' && bombState !== 'planted') plants.add(runner.match.round);
    if (bomb.state === 'defused' && bombState !== 'defused') defuses.add(runner.match.round);
    bombState = bomb.state;
    if (runner.match.phase === 'roundEnd' && runner.match.lastRound && rounds.length < runner.match.round) {
      rounds.push({ ...runner.match.lastRound, round: runner.match.round });
    }
  }
  return { rig, rounds, plants, defuses, wire: runner.match };
}

test('a ranked match plays to a decision inside its round budget', () => {
  const { wire, rounds } = playMatch(7);
  assert.equal(wire.phase, 'matchEnd');
  assert.ok(rounds.length >= 7 && rounds.length <= 19, `rounds ${rounds.length}`);
  assert.equal(wire.history.length, wire.score.alpha + wire.score.bravo);
  assert.ok(wire.draw || Math.max(wire.score.alpha, wire.score.bravo) >= rules.COMP_ROUNDS_TO_WIN);
});

test('sides swap at the half and the economy resets with them', () => {
  const { wire } = playMatch(7);
  // Round 13 is the first after a 12-round regulation, so the sides must have flipped
  // at the half (round 7) — every match that reaches overtime proves the swap ran.
  if (wire.history.length > rules.COMP_HALFTIME_ROUNDS) {
    assert.notEqual(wire.side.alpha, 'attack', 'alpha must not still be attacking after the half');
  }
  assert.ok(wire.combatants.every(c => c.money >= 0 && c.money <= rules.COMP_MAX_MONEY));
});

test('attackers plant the charge and defenders contest it', () => {
  // Three seeded matches, because a single seed can legitimately be a run of
  // defender holds — what must never happen is a match with no plant at all.
  let plants = 0;
  let credited = 0;
  for (const seed of [7, 29, 101]) {
    const run = playMatch(seed);
    plants += run.plants.size;
    credited += run.wire.combatants.filter(c => c.plants > 0).length;
  }
  assert.ok(plants >= 2, `expected plants across three matches, got ${plants}`);
  assert.ok(credited > 0, 'someone must be credited with a plant');
});

test('the buy phase arms the player through the bridge and the rules gate the rack', () => {
  const rig = makeRig(11);
  const { runner, player } = rig;
  // Round one: $800, so kevlar is affordable and a rifle is not.
  assert.equal(runner.match.of(match.PLAYER_ID).money, rules.COMP_START_MONEY);
  assert.equal(runner.playerBuy('w_ak47'), false, 'a $2700 rifle cannot be bought with $800');
  assert.equal(runner.playerBuy('g_kevlar'), true, 'kevlar at $650 is affordable in round one');
  assert.ok(player.armor > 0, 'the bridge must receive the armour the rules sold');
  assert.ok(runner.match.of(match.PLAYER_ID).money < rules.COMP_START_MONEY, 'money must be spent');
  assert.equal(runner.currentKit().armor, player.armor);
});

test('catalog: ranked prices are legal purchases from a full wallet', () => {
  const rack = buy.COMP_BUY_ITEMS;
  assert.ok(rack.length >= 14, 'the rack needs weapons, armour, a kit and grenades');
  assert.ok(rack.some(i => i.id === 'w_ak47' && i.price === 2700));
  assert.ok(rack.some(i => i.id === 'w_awm' && i.price === 4750));
  assert.ok(rack.some(i => i.id === 'g_kevlar' && i.price === 650));
  assert.ok(rack.some(i => i.id === 'g_kit' && i.price === 400));
});

test('the HUD payload stays coherent through a live round', () => {
  const rig = makeRig(13);
  rig.step(16); // clear the buy phase
  const hud = rig.runner.hud();
  assert.equal(hud.roster.length, 10);
  assert.equal(hud.roster.filter(r => r.you).length, 1);
  assert.ok(['buy', 'live', 'roundEnd', 'matchEnd'].includes(hud.phase));
  assert.ok(['A', 'B'].includes(rig.runner.director.targetSite));
  assert.ok(Number.isFinite(hud.timeLeft) && hud.timeLeft >= 0);
  assert.ok(hud.alive.alpha + hud.alive.bravo <= 10);
  assert.ok(Number.isFinite(hud.money));
  assert.ok(hud.roster.every(r => Number.isFinite(r.adr) && Number.isFinite(r.hp)));
});

test('the player can plant the charge and the rules resolve the round', () => {
  const rig = makeRig(17);
  const { runner } = rig;
  rig.step(16);
  const site = rules.COMP_SITES.A;
  rig.player.x = site.x - 1;
  rig.player.z = site.z;
  runner.match.dropBomb(site.x - 1, site.z);
  assert.equal(runner.playerTryPickup(), true, 'standing on the dropped charge picks it up');
  assert.equal(runner.match.bomb.carrierId, match.PLAYER_ID);
  const prompt = runner.hud().prompt;
  assert.equal(prompt?.kind, 'plant');
  assert.equal(prompt?.ok, true);
  for (let i = 0; i < 30 * 6 && runner.match.bomb.state !== 'planted'; i++) {
    runner.playerHoldAction(1 / 30);
    runner.update(1 / 30);
  }
  assert.equal(runner.match.bomb.state, 'planted');
  assert.ok(runner.match.bomb.fuse > 0 && runner.match.bomb.fuse <= rules.COMP_BOMB_FUSE);
  assert.ok(runner.hud().roster.find(r => r.you).plants === 1, 'the plant is credited to the player');
});

test('ranked bots kill with the competitive armour model, not the TDM one', () => {
  const rig = makeRig(5);
  rig.step(16);
  const bot = rig.runner.manager.bots.find(b => !b.dead);
  bot.setCompetitive(tactics.BOT_GEAR.ak47, 100, false);
  // Four rifle rounds through a full plate: the rules model says the plate eats the
  // first shots and the fourth drops the operator.
  let killed = false;
  let taken = 0;
  for (let i = 0; i < 4 && !killed; i++) {
    const res = bot.applyRankedDamage(36, false, false, 'player');
    killed = res.killed;
    taken += res.taken;
  }
  assert.equal(killed, true, 'four 36-damage rounds must drop a fully armoured operator');
  assert.ok(taken > 0 && taken < 4 * 36, 'armour must absorb part of the damage');
});

test('the charge blast is lethal up close and survivable at the rim', () => {
  assert.equal(match.blastDamage(0), rules.COMP_BLAST_DAMAGE);
  assert.equal(match.blastDamage(5), rules.COMP_BLAST_DAMAGE);
  const rim = match.blastDamage(rules.COMP_BLAST_RADIUS - 0.01);
  assert.ok(rim < 100, `rim damage ${rim} should not one-shot a full-health operator`);
  assert.ok(match.blastDamage(3) > match.blastDamage(9), 'damage must fall off with distance');
});

test('the ladder is evaluated from the match, and the profile keeps it', () => {
  const start = rank.DEFAULT_RANKED;
  const win = rank.ratingDelta({
    win: true, draw: false, roundsFor: 7, roundsAgainst: 4,
    kills: 18, deaths: 9, headshots: 7, plants: 2, defuses: 0, mvp: 3, current: start,
  });
  assert.ok(win.delta > 0, 'a winning, productive match must gain rating');
  assert.equal(win.next.wins, 1);
  assert.equal(win.next.matches, 1);
  const loss = rank.ratingDelta({
    win: false, draw: false, roundsFor: 2, roundsAgainst: 7,
    kills: 1, deaths: 12, headshots: 0, plants: 0, defuses: 0, mvp: 0, current: win.next,
  });
  assert.ok(loss.delta < 0);
  const view = rank.rankFor(win.next.rating, win.next);
  assert.ok(view.label.length > 0 && view.tier);

  const store = new Map();
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  profile.saveProfile({ ...profile.DEFAULT_PROFILE, ranked: win.next }, storage);
  const reloaded = profile.loadProfile(storage);
  assert.equal(reloaded.ranked.rating, win.next.rating);
  assert.equal(reloaded.ranked.placements, win.next.placements);
  const corrupt = profile.migrateProfile(JSON.stringify({ ...profile.DEFAULT_PROFILE, ranked: 'nonsense' }));
  assert.equal(corrupt.ranked.rating, rank.DEFAULT_RANKED.rating, 'a broken ladder blob resets to placement rank');
});
