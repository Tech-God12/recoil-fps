import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installCanvasStub, geometryBudget } from './helpers/geometry.js';

const { DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { DEFAULT_PROFILE } = await import('../src/game/economy/profile.ts');
const { WEAPON_CATALOG, CALIBER } = await import('../src/game/economy/catalog.ts');
const { CALIBER: ARMORY_CALIBER } = await import('../src/ui/tactical.tsx');
const { WEAPON_BUILDERS } = await import('../src/game/models.ts');
const { STREAK_LADDER } = await import('../src/game/streaks.ts');
const { MainMenu, PauseMenu, ResultsScreen, wrapMenuSelection } = await import('../src/ui/Screens.tsx');
const { default: Hud } = await import('../src/ui/Hud.tsx');

const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const noop = () => {};
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../src/game/engine.ts', import.meta.url), 'utf8');

function hud(overrides = {}) {
  return {
    hp: 170, mag: 30, magSize: 30, weapon: 'M416', weaponId: 'm4a1',
    reloading: false, reloadStage: 'idle', frags: 3, flashes: 1, bearing: 0,
    kills: 0, score: 0, enemiesLeft: 5, cooking: false, sprinting: false,
    ads: 0, spread: 0, cash: 0, secondaryWeapon: '1911', heldSlot: 'primary',
    reticle: 'none', scopePower: 1, scopeMinPower: 1, scopeMaxPower: 1,
    pings: [], mapImage: '', playerMap: { nx: .5, nz: .5 }, enemiesMap: [],
    fps: 60, worldHalf: 46, ...overrides,
  };
}
function fx(hitmark = null) {
  return { hitmark, feed: [], dmgArcs: [], scorePops: [], banner: null, callout: null,
    flashPow: 0, missionBanner: null, streakMsg: null, nukeFlash: null };
}
function tdm(outcome = 'win') {
  return {
    alphaScore: 12, bravoScore: 9, playerKills: 3, outcome,
    roster: [{ name: 'YOU', team: 'alpha', dead: false, armorIcon: '◍', you: true, kills: 3, deaths: 2, headshots: 1 }],
  };
}
function report(outcome = 'win') {
  return {
    win: outcome === 'win', kills: 3, score: 450, shots: 20, hits: 8, headshots: 1, timeSec: 150,
    mission: { id: 'tdm-warehouse', name: 'Warehouse TDM', map: 'arena', status: 'complete', duration: 150, phases: [] },
    pressure: { totalSpawned: 10, peakLive: 10 }, cash: 450, cashLog: [], difficultyMul: 1,
    tdm: tdm(outcome),
  };
}
const wallet = { before: 0, after: 450, gradeBonus: 0, earned: 450 };
const screen = (r) => render(ResultsScreen, { r, wallet, onRedeploy: noop, onMenu: noop, onArmory: noop });
const overlay = (h, f = fx()) => render(Hud, { hud: h, s: DEFAULT_SETTINGS, fx: f });

test('all five home actions wrap in both keyboard directions, including the last item and ranked entry', () => {
  const menu = render(MainMenu, { s: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, onDeploy: noop,
    onSettings: noop, onMap: noop, onArmory: noop, onRanked: noop });
  assert.equal((menu.match(/class="rm-item seq/g) ?? []).length, 5);
  assert.match(menu, /OPERATION BLACKOUT/);
  assert.match(menu, /SETTINGS/);
  for (const step of [1, -1]) {
    let selected = 0;
    const reached = new Set([selected]);
    for (let i = 0; i < 5; i++) {
      selected = wrapMenuSelection(selected, step, 5);
      reached.add(selected);
    }
    assert.deepEqual([...reached].sort(), [0, 1, 2, 3, 4]);
    assert.equal(selected, 0, 'a full circuit returns to the starting action');
  }
  assert.match(readFileSync(new URL('../src/ui/Screens.tsx', import.meta.url), 'utf8'), /wrapMenuSelection\(s, -1, items\.length\)/);
  assert.match(appSource, /onRanked=\{\(\) => \{ setMenuView\('home'\); changePhase\('ranked-setup'\); \}\}/);
});

test('paused scorestreak card shows the actual five ladder entries and ready state when App passes the HUD', () => {
  const props = { onResume: noop, onRestart: noop, onSettings: noop, onQuit: noop };
  const before = render(PauseMenu, props);
  assert.doesNotMatch(before, /pause-streak-row/);
  const streaks = { points: 430, ladder: STREAK_LADDER.map((s, i) => ({ ...s, key: String(i + 3),
    ready: i === 0, claimed: i === 0, active: false })) };
  const after = render(PauseMenu, { ...props, streaks });
  assert.equal((after.match(/pause-streak-row/g) ?? []).length, 5);
  assert.match(after, /430 pts this life/);
  assert.match(after, /READY/);
  assert.match(appSource, /streaks=\{hud\.comp \? undefined : hud\.streaks\}/);
});

test('nonlethal head hits render a distinct amber diamond; body and red kill markers remain distinct', () => {
  const h = hud();
  const body = overlay(h, fx({ id: 1, kill: false, headshot: false }));
  const head = overlay(h, fx({ id: 2, kill: false, headshot: true }));
  const kill = overlay(h, fx({ id: 3, kill: true, headshot: true }));
  assert.match(body, /aria-label="Hit"/);
  assert.doesNotMatch(body, /hm-head-core/);
  assert.match(head, /aria-label="Headshot hit"/);
  assert.match(head, /hm-head-core/);
  assert.match(head, /#F1C36A/);
  assert.match(kill, /aria-label="Kill confirmed"/);
  assert.match(kill, /hm-kill/);
  assert.doesNotMatch(kill, /hm-head-core/);
  assert.match(engineSource, /type: 'hit', kill: false, headshot: part === 'head'/);
  assert.match(appSource, /headshot: event\.headshot === true/);
});

test('all ten live ammo readouts use the armory cartridge label, not a name guess', () => {
  assert.equal(CALIBER, ARMORY_CALIBER, 'armory and HUD share one data source');
  assert.equal(WEAPON_CATALOG.length, 10);
  for (const entry of WEAPON_CATALOG) {
    const markup = overlay(hud({ weapon: entry.name, weaponId: entry.id }));
    assert.ok(markup.includes(CALIBER[entry.id].round), `${entry.id} caliber missing`);
    assert.ok(markup.includes(entry.name), `${entry.id} weapon name missing`);
  }
  assert.match(engineSource, /weaponId: this\.def\(\)\.id/);
});

test('TDM win/loss/draw use a match result stamp; story retains its grade and wallet math is untouched', () => {
  for (const [outcome, stamp] of [['win', 'W'], ['loss', 'L'], ['draw', '=']]) {
    const html = screen(report(outcome));
    assert.match(html, new RegExp(`class="stamp-grade"[^>]*>${stamp}</span>`));
    assert.doesNotMatch(html, /Grade [A-F]/);
    assert.match(html, /final score ALPHA 12 : 9 BRAVO/);
  }
  const story = { ...report('win'), tdm: undefined,
    mission: { ...report().mission, id: 'kasbah', name: 'Town', phases: [] } };
  assert.match(screen(story), /Grade [A-F]/);
});

test('opening arena strip is 8 sim seconds only; exposed grace is signaled, disappears on expiry or death', () => {
  const match = { ...tdm(), timeLeft: 150, playerDead: false, respawnIn: 0,
    spawnShield: 1.6, maxHp: 170, onFire: false, onFireLeft: 0 };
  const opening = overlay(hud({ tdm: match }));
  assert.match(opening, /5V5 · MOST KILLS AT 2:30 WINS/);
  assert.match(opening, /TAB.*SCOREBOARD/);
  assert.match(opening, /SPAWN SHIELD/);
  const later = overlay(hud({ tdm: { ...match, timeLeft: 141, spawnShield: 0 } }));
  assert.doesNotMatch(later, /MOST KILLS AT 2:30 WINS|SPAWN SHIELD/);
  assert.match(later, /WAREHOUSE TDM/);
  const dead = overlay(hud({ tdm: { ...match, playerDead: true } }));
  assert.doesNotMatch(dead, /SPAWN SHIELD/);
  assert.match(dead, /ELIMINATED/);
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.onboard-tdm \{[^}]*flex-wrap: wrap/,
    'the short opening cue must wrap inside phone viewports, not scroll off-screen');
  assert.match(css, /\.onboard-tdm \{ width: calc\(100vw - 24px\)/);
});

test('MP7 is named consistently without changing its save ID or geometry budget', () => {
  const entry = WEAPON_CATALOG.find(w => w.id === 'mp7');
  assert.equal(entry.name, 'MP7');
  assert.equal(entry.short, 'MP7');
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.loadout.secondary.weapon = 'mp7';
  const menu = render(MainMenu, { s: DEFAULT_SETTINGS, profile, onDeploy: noop, onSettings: noop, onMap: noop });
  assert.match(menu, /MP7/);
  assert.match(overlay(hud({ weapon: 'MP7', weaponId: 'mp7', heldSlot: 'secondary' })), /4\.6×30MM/);
  const restore = installCanvasStub();
  try {
    const gun = WEAPON_BUILDERS.mp7();
    assert.deepEqual(geometryBudget(gun.group), { draws: 33, triangles: 30847 });
    gun.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  } finally { restore(); }
});
