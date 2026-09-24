import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
const { Engine, DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { DefusalMode } = await import('../src/game/defusal/mode.ts');
const { default: DefusalHudLayer } = await import('../src/ui/DefusalHud.tsx');
const { default: BuyMenu, autoBuyPlan } = await import('../src/ui/BuyMenu.tsx');
const { MainMenu, ResultsScreen } = await import('../src/ui/Screens.tsx');
const { freshInventory } = await import('../src/game/defusal/shop.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const world = buildWorld(new THREE.Scene(), 'sirocco', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));
const phys = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 4 };
phys.nearSolids = Engine.prototype.nearSolids.bind(phys);
Engine.prototype.buildSolidGrid.call(phys);
function makeMode(side) {
  const player = new THREE.Vector3(0, 0, 35);
  return new DefusalMode({
    scene: new THREE.Scene(), occluders: world.occluders, coverNodes: world.coverNodes, solids: world.solids, half: world.half,
    groundHeight: world.groundHeight, effects: new Proxy({}, { get: () => () => {} }),
    moveCollide: (p, dx, dz, r) => Engine.prototype.moveAxis.call(phys, p, dx, dz, r, 1.7),
    playerPos: () => new THREE.Vector3(player.x, 1.62, player.z), playerFeet: () => player.clone(), playerAlive: () => true,
    playerHp: () => 100, playerCanSee: () => false, damagePlayer() {}, throwGrenade() {}, onBotFire() {},
    spawnPlayer: at => player.copy(at), equipPlayer() {}, bombDetonated() {}, onFeed() {}, onRadio() {}, onCallout() {},
    announce() {}, onMoney() {}, earnWallet() {}, onMatchEnd() {},
  }, { side, format: 'short', difficulty: 'Normal' }, () => 0.37);
}
const hudOf = df => ({ defusal: df, spectating: null, hp: 100, bearing: 0 });

test('defusal HUD renders the CS top bar, buy phase, money and the Tab board', () => {
  const mode = makeMode('attack');
  const html = renderToStaticMarkup(React.createElement(DefusalHudLayer, { hud: hudOf(mode.hud()), showBoard: true }));
  for (const text of ['ATTACK', 'DEFEND', 'BUY PHASE', '$800', 'ROUND 1', 'FIRST TO 7', 'SIROCCO · BOMB DEFUSAL', 'YOUR SQUAD', 'HOSTILES', 'Dagger', 'Viper', 'PISTOL ROUND']) {
    assert.ok(html.includes(text), `HUD shows ${text}`);
  }
  assert.match(html, /HOLD: PLANT/, 'round-1 controls strip teaches the attacker keys');
  assert.ok(!html.includes('df-c4'), 'no bomb clock before a plant');
});

test('a planted bomb replaces the round clock and is announced', () => {
  const mode = makeMode('defend');
  mode.update(10.2, { interact: false });
  const planter = mode.players.find(c => c.bot && mode.sideOf(c) === 'attack');
  mode.giveBomb(planter);
  mode.plantBomb(planter, new THREE.Vector3(30.5, 0, -31.6));
  const html = renderToStaticMarkup(React.createElement(DefusalHudLayer, { hud: hudOf(mode.hud()), showBoard: false }));
  assert.match(html, /df-clock planted/);
  assert.match(html, /BOMB PLANTED/);
  assert.match(html, /SITE B/);
});

test('buy menu lists prices, locks the enemy rifle, and auto-buy picks a sane package', () => {
  const mode = makeMode('defend');
  const df = { ...mode.hud(), money: 5200, inv: { ...freshInventory(5200) } };
  const html = renderToStaticMarkup(React.createElement(BuyMenu, { df, owned: ['m4a1'], onBuy: () => ({ ok: true }), onClose() {} }));
  for (const text of ['BUY MENU', '$5,200', 'Rifles', 'M416', 'YOUR BUILD', 'Attackers only', 'YOUR ROUND LOADOUT', 'AUTO-BUY', 'DEFUSE KIT']) {
    assert.ok(html.includes(text), `buy menu shows ${text}`);
  }
  // $5,200: M416 (3,100) → helmet (1,000) → kit (400) → smoke (300) → flash (200) → the frag no longer fits → second flash (200).
  assert.deepEqual(autoBuyPlan(freshInventory(5200), 'defend'), ['m4a1', 'helmet', 'kit', 'smoke', 'flash', 'flash']);
  assert.deepEqual(autoBuyPlan(freshInventory(800), 'attack'), ['kevlar'], 'pistol round: armor only');
});

test('Arena Mode offers Sirocco Bomb Defusal next to Warehouse TDM', () => {
  const html = renderToStaticMarkup(React.createElement(MainMenu, {
    s: DEFAULT_SETTINGS, onDeploy() {}, onSettings() {}, onMap() {}, initialView: 'arena',
    defusal: { side: 'defend', format: 'long' }, onDefusal() {},
  }));
  for (const text of ['SIROCCO', 'BOMB DEFUSAL', 'WAREHOUSE', 'TEAM DEATHMATCH', 'NEW MODE', 'ATTACK', 'DEFEND', 'FIRST TO 13', 'Play']) {
    assert.ok(html.includes(text), `arena screen shows ${text}`);
  }
});

test('the debrief tells the defusal story: score, round strip and standings', () => {
  const mode = makeMode('attack');
  const res = mode.result();
  res.alphaScore = 7; res.bravoScore = 3; res.winner = 'alpha'; res.rounds = 10;
  res.history = Array.from({ length: 10 }, (_, i) => ({ round: i + 1, half: i < 6 ? 1 : 2, winner: i % 3 ? 'alpha' : 'bravo', winnerSide: 'attack', reason: ['elimination', 'bomb', 'defuse', 'time'][i % 4], planted: false, alphaScore: 0, bravoScore: 0 }));
  const r = {
    win: true, kills: 14, score: 3400, shots: 300, hits: 90, headshots: 6, timeSec: 900,
    mission: { id: 'defusal-sirocco', name: 'Sirocco Bomb Defusal', map: 'sirocco', status: 'complete', duration: 900, phases: [] },
    pressure: { totalSpawned: 10, peakLive: 10, retired: 0, pending: 0, candidateChecks: 0, sightChecks: 0, deferred: 0 },
    cash: 2500, cashLog: [{ reason: 'round', amount: 150, t: 1 }, { reason: 'plant', amount: 150, t: 2 }], difficultyMul: 1, defusal: res,
  };
  const html = renderToStaticMarkup(React.createElement(ResultsScreen, { r, wallet: { before: 0, after: 2650, gradeBonus: 0, earned: 2650 }, onRedeploy() {}, onMenu() {}, onArmory() {} }));
  for (const text of ['Victory 7 — 3', 'Round history', 'Final standings', 'Rounds won', 'Bombs planted', 'YOUR SQUAD']) {
    assert.ok(html.includes(text), `debrief shows ${text}`);
  }
  assert.equal((html.match(/df-hcell/g) ?? []).length, 10, 'one history cell per round played');
  assert.ok(!html.includes('Mission timeline'), 'no mission timeline for arena modes');
});
