import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();
// Web Audio stand-in: the mode plays stingers and beeps through the shared engine.
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
const { TIMING, roundPayout } = await import('../src/game/defusal/rules.ts');
const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const world = buildWorld(new THREE.Scene(), 'sirocco', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));
const phys = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 4 };
phys.nearSolids = Engine.prototype.nearSolids.bind(phys);
Engine.prototype.buildSolidGrid.call(phys);

function makeMode(side, seed = 11) {
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const player = { pos: new THREE.Vector3(0, 0, 35), alive: true, hp: 100 };
  const feed = [];
  const pending = [];
  let mode = null;
  mode = new DefusalMode({
    scene: new THREE.Scene(), occluders: world.occluders, coverNodes: world.coverNodes, solids: world.solids, half: world.half,
    groundHeight: world.groundHeight, effects: new Proxy({}, { get: () => () => {} }),
    moveCollide: (p, dx, dz, r) => { Engine.prototype.moveAxis.call(phys, p, dx, dz, r, 1.7); p.y = Engine.prototype.supportHeight.call(phys, p, r); },
    playerPos: () => new THREE.Vector3(player.pos.x, 1.62, player.pos.z), playerFeet: () => player.pos.clone(),
    playerAlive: () => player.alive, playerHp: () => player.hp, playerCanSee: () => false,
    damagePlayer: () => {},
    throwGrenade: (_f, target, owner, kind) => pending.push({ kind, at: target.clone(), owner }),
    onBotFire: () => {},
    spawnPlayer: at => { player.pos.copy(at); player.alive = true; player.hp = 100; },
    equipPlayer: () => {}, bombDetonated: () => {},
    onFeed: (k, w, v) => feed.push(`${k}>${w}>${v}`), onRadio: () => {}, onCallout: () => {}, announce: () => {},
    onMoney: () => {}, earnWallet: () => {}, onMatchEnd: () => {},
  }, { side, format: 'short', difficulty: 'Normal' }, rng);
  /** Simulate ~`sec` seconds in fixed 1/30 s ticks; returns the time actually simulated. */
  const step = (sec, dt = 1 / 30) => {
    const n = Math.max(1, Math.round(sec / dt));
    for (let i = 0; i < n; i++) {
      // the stand-in steps out when a round goes live, leaving a bot-vs-bot round
      if (mode.match.phase === 'live' && player.alive) { player.alive = false; mode.playerKilled(null, false, 'C4'); }
      mode.update(dt, { interact: false });
      while (pending.length) { const g = pending.pop(); if (g.kind === 'smoke') mode.spawnSmoke(g.at); }
    }
    return n * dt;
  };
  return { mode, player, feed, step };
}
const aliveOn = (mode, side) => mode.players.filter(c => c.alive && mode.sideOf(c) === side);
const killAll = (mode, side) => { for (const c of aliveOn(mode, side)) if (c.bot) { c.bot.takeDamage(999, false, 'player', false); mode.handleKill('player', c.bot, false, 'ak47'); } };

test('a full bot round resolves inside the clock and pays CS2 money to both teams', () => {
  const { mode, step } = makeMode('attack');
  step(TIMING.freeze + 0.1);
  assert.equal(mode.match.phase, 'live');
  const bank = new Map(mode.players.map(c => [c.id, { money: c.inv.money, kills: c.kills }]));
  for (let i = 0; i < 200 && mode.match.phase !== 'over'; i++) step(0.5);
  const rec = mode.match.lastRound;
  assert.ok(rec, 'round decided within 100 s of play');
  for (const c of mode.players) {
    if (c.isPlayer) continue;
    const before = bank.get(c.id);
    const expected = roundPayout({ won: c.team === rec.winner, side: mode.sideOf(c), reason: rec.reason, planted: rec.planted, alive: c.alive, lossesAfter: mode.match.losses[c.team] });
    const extra = c.inv.money - before.money - expected - (c.planted ? 300 : 0) - (c.defused ? 300 : 0);
    const kills = c.kills - before.kills;
    assert.ok(extra >= 0 && extra % 100 === 0 && extra <= kills * 900, `${c.name}: +${c.inv.money - before.money} vs payout ${expected}, ${kills} kills`);
  }
});

test('a dead carrier drops the bomb and another attacker picks it up', () => {
  const { mode, step } = makeMode('defend', 5);
  step(TIMING.freeze + 0.1);
  const attackers = aliveOn(mode, 'attack');
  const carrier = attackers[0];
  mode.giveBomb(carrier);
  carrier.bot.takeDamage(999, false, 'player', false);
  mode.handleKill('player', carrier.bot, false, 'm4a1');
  assert.equal(mode.bomb.state, 'dropped');
  assert.ok(mode.bomb.pos.distanceTo(carrier.bot.pos) < 1.2);
  for (let i = 0; i < 60 && mode.bomb.state === 'dropped'; i++) step(0.5);
  assert.equal(mode.bomb.state === 'carried' || mode.bomb.state === 'planted' || mode.match.phase === 'over', true, `bomb state ${mode.bomb.state}`);
  if (mode.bomb.state === 'carried') assert.notEqual(mode.bomb.carrier, carrier);
});

test('with the bomb planted, killing every attacker does not end the round — defenders must defuse', () => {
  const { mode, step } = makeMode('defend', 23);
  step(TIMING.freeze + 0.1);
  const planter = aliveOn(mode, 'attack').find(c => c.bot);
  // No kits on this team: the retake has to live with the full 10 s defuse.
  for (const c of aliveOn(mode, 'defend')) c.inv = { ...c.inv, kit: false };
  mode.giveBomb(planter);
  planter.bot.pos.set(-29, 0, -32.6);
  mode.plantBomb(planter, new THREE.Vector3(-29, 0, -32.6));
  assert.equal(mode.match.phase, 'planted');
  killAll(mode, 'attack');
  step(0.2);
  assert.equal(mode.match.phase, 'planted', 'no elimination win while the bomb ticks');
  let started = -1, t = 0, defuser = null;
  while (t < 45 && mode.match.phase === 'planted') {
    t += step(1 / 30);
    if (mode.bomb.defuser && started < 0) { started = t; defuser = mode.bomb.defuser; }
    if (!mode.bomb.defuser && mode.match.phase === 'planted') { started = -1; defuser = null; }
  }
  assert.equal(mode.match.lastRound.reason, 'defuse', 'bot defenders retake and defuse an undefended bomb');
  assert.ok(defuser?.defused, 'the defuser is credited');
  const took = t - started;
  assert.equal(defuser.inv.kit, false);
  assert.ok(Math.abs(took - TIMING.defuse) < 0.25, `kitless defuse took ${took.toFixed(2)}s, expected ${TIMING.defuse}s`);
});

test('halftime: sides swap, everyone restarts on $800 with a 1911, and bots change colours', () => {
  const { mode, step } = makeMode('attack', 3);
  for (let r = 0; r < 6; r++) {
    step(Math.max(0.1, mode.match.clock) + 0.1);
    assert.equal(mode.match.phase, 'live', `round ${r + 1} live`);
    killAll(mode, 'defend');
    step(TIMING.roundEnd + 0.2);
  }
  assert.equal(mode.match.phase, 'halftime');
  step(TIMING.halftime + 0.2);
  assert.equal(mode.match.round, 7);
  assert.equal(mode.playerSide, 'defend');
  for (const c of mode.players) {
    assert.ok(c.inv.money <= 800 && c.inv.money >= 0, `${c.name} restarts the half on the pistol-round bank ($${c.inv.money})`);
    assert.ok(c.inv.primary === null && ['m1911', 'deagle', 'mp7'].includes(c.inv.secondary), `${c.name} is on pistols`);
    if (c.bot) assert.equal(c.modelSide, mode.sideOf(c), `${c.name} wears the new side colours`);
  }
  assert.equal(mode.match.score.alpha, 6);
});
