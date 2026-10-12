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
const SHOPMOD = await import('../src/game/defusal/shop.ts');
const { freshInventory } = SHOPMOD;

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
  // Your balance reads compact; prices stay exact so you can budget.
  for (const text of ['Buy menu', '$5.2k', 'Rifles', 'Attachments', 'M416', 'Your build', 'Attackers only', 'Your round loadout', 'Auto-buy', 'Defuse kit']) {
    assert.ok(html.includes(text), `buy menu shows ${text}`);
  }
  // The buy menu stopped shouting; it must not start again.
  for (const shout of ['BUY MENU', 'YOUR BUILD', 'YOUR ROUND LOADOUT', 'AUTO-BUY', 'DEFUSE KIT', 'EQUIPMENT VALUE', 'BUY TIME IS OVER', '/ KILL']) {
    assert.ok(!html.includes(shout), `buy menu must not shout "${shout}"`);
  }
  // $5,200: M416 (3,100) → helmet (1,000) → kit (400) → smoke (300) → flash (200) → the frag no longer fits → second flash (200).
  assert.deepEqual(autoBuyPlan(freshInventory(5200), 'defend'), ['m4a1', 'helmet', 'kit', 'smoke', 'flash', 'flash']);
  assert.deepEqual(autoBuyPlan(freshInventory(800), 'attack'), ['kevlar'], 'pistol round: armor only');
});

test('the Arena screen is minimal: two cards, two choices, one Play', () => {
  const html = renderToStaticMarkup(React.createElement(MainMenu, {
    s: DEFAULT_SETTINGS, onDeploy() {}, onSettings() {}, onMap() {}, initialView: 'arena',
    defusal: { side: 'defend', format: 'long' }, onDefusal() {},
  }));
  for (const text of ['Sirocco', 'Bomb defusal', 'Warehouse', 'Team deathmatch', 'Attack', 'Defend', 'First to 13', 'Play']) {
    assert.ok(html.includes(text), `arena screen shows ${text}`);
  }
  // Each card still says in one plain sentence what the mode actually is.
  assert.ok(html.includes('Plant the bomb — or stop it.'), 'sirocco says what it is');
  assert.ok(html.includes('Most eliminations when the clock runs out wins it.'), 'warehouse says what it is');

  // The numbered-step scaffolding and the badge/kicker soup are gone for good.
  for (const gone of [
    'PICK A GAME', 'MATCH SETUP', 'YOUR ABILITY', 'SELECTED', 'NEW MODE',
    'HOVER FOR A LIVE FLYOVER', 'How a round works', 'YOUR SQUAD', 'FIELD BUILD',
    'step-num', 'q-row', 'ARENA MODE',
  ]) assert.ok(!html.includes(gone), `${gone} is gone from the arena screen`);

  // Choices are still real radiogroups, just labelled like words instead of shouting.
  assert.ok(html.includes('role="radiogroup" aria-label="Side"'), 'Side is a radiogroup');
  assert.ok(html.includes('role="radiogroup" aria-label="Match length"'), 'Match length is a radiogroup');
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5, 'three sides + two lengths');
  assert.equal((html.match(/deploy-btn/g) ?? []).length, 1, 'exactly one Play button');
});

test('the main menu no longer carries a Current Loadout panel', () => {
  const html = renderToStaticMarkup(React.createElement(MainMenu, {
    s: DEFAULT_SETTINGS, onDeploy() {}, onSettings() {}, onMap() {},
  }));
  for (const gone of ['CURRENT LOADOUT', 'rm-loadout', 'EDIT IN ARMORY', 'rm-lo-tag', 'FRAG ×2']) {
    assert.ok(!html.includes(gone), `${gone} is gone from the main menu`);
  }
  // The menu rows read as words, not as a telegram.
  for (const word of ['Missions', 'Arena', 'Loadout', 'Settings']) {
    assert.ok(html.includes(word), `menu still offers ${word}`);
  }
  assert.ok(!html.includes('DEPLOYMENT TERMINAL'), 'the kicker is gone');
  assert.ok(!html.includes('CHOOSE A BATTLEFIELD AND DEPLOY'), 'shouted subtitles are gone');
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

test('the buy menu offers attachments for the gun in hand, and nothing when you have none', () => {
  const S = SHOPMOD;
  const bare = { ...makeMode('attack').hud(), money: 5200, inv: { ...freshInventory(5200) } };
  const noPrimary = renderToStaticMarkup(React.createElement(BuyMenu, { df: bare, owned: [], onBuy: () => ({ ok: true }), onClose() {} }));
  assert.ok(noPrimary.includes('Attachments'), 'the category is always listed');

  const armed = { ...bare, inv: { ...freshInventory(5200), primary: 'ak47' } };
  const html = renderToStaticMarkup(React.createElement(BuyMenu, { df: armed, owned: [], onBuy: () => ({ ok: true }), onClose() {} }));
  // The fitted-parts list only appears once something is actually bolted on.
  assert.ok(!html.includes('buy-fitted'), 'a bare gun lists no fitted parts');

  const fitted = S.buy({ ...freshInventory(16000), primary: 'ak47' }, S.attachmentsForSale('ak47').find(i => i.slot === 'optic').id, 'attack');
  assert.ok(fitted.ok, fitted.reason);
  const withGlass = renderToStaticMarkup(React.createElement(BuyMenu, {
    df: { ...bare, inv: fitted.inv }, owned: [], onBuy: () => ({ ok: true }), onClose() {},
  }));
  assert.ok(withGlass.includes('buy-fitted'), 'a fitted optic shows under the primary');
  assert.ok(withGlass.includes('Optic'), 'labelled by slot');
});

test('the missions screen is one screen: pick an operation on the left, read it on the right', () => {
  const html = renderToStaticMarkup(React.createElement(MainMenu, {
    s: { ...DEFAULT_SETTINGS, map: 'kasbah' }, onDeploy() {}, onSettings() {}, onMap() {}, initialView: 'maps',
  }));
  // Both operations are listed, and the selected one's brief and objectives
  // are on the same screen - no click-through to a second page.
  for (const text of ['Missions', 'Kasbah', 'Al Rasul', 'A fortified market town', 'A river valley under a desert sun', 'Play', 'Loadout']) {
    assert.ok(html.includes(text), `missions screen shows ${text}`);
  }
  assert.ok(/class="ops-steps"/.test(html), 'the objective list is on the screen');
  assert.ok((html.match(/<li>/g) ?? []).length >= 3, 'the selected operation lists its objectives');
  assert.equal((html.match(/deploy-btn/g) ?? []).length, 1, 'exactly one Play button');

  // Selecting drives the detail pane: the other map's brief must not be showing.
  const alrasul = renderToStaticMarkup(React.createElement(MainMenu, {
    s: { ...DEFAULT_SETTINGS, map: 'alrasul' }, onDeploy() {}, onSettings() {}, onMap() {}, initialView: 'maps',
  }));
  assert.notEqual(html.replace(/\s+/g, ''), alrasul.replace(/\s+/g, ''), 'the brief changes with the selection');

  // The old theater-select chrome is gone and must stay gone.
  for (const gone of [
    'SELECT AREA OF OPERATIONS', 'OPERATIONS COMMAND', 'THEATER SELECT', 'DEPLOY TO A THEATER',
    'TWO THEATERS', 'DIFFERENT THREATS', 'PROVE YOURSELF', 'FIELD BUILD', 'FIELD NOTES',
    'SANDBLAST', 'TOWN', 'FORTIFIED MARKET TOWN', 'DESERT RIVER VALLEY',
    'OBJECTIVES ·', 'HOVER A THEATER', 'map2-', 'msn-', '° N', '° E', 'V1.1.0',
  ]) assert.ok(!html.includes(gone), `${gone} is gone from the missions screen`);

  // Sentence case: no shouty words left in the visible copy.
  const words = (html.replace(/<[^>]*>/g, ' ').match(/\b[A-Z]{3,}\b/g) ?? []).filter(w => w !== 'AND');
  assert.deepEqual(words, [], `missions screen still shouts: ${words.join(', ')}`);
});
