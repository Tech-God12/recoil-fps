import './helpers/register-json.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { playMatch, fakeEngine, Engine, restoreCanvas, restoreAudio } from './helpers/comp-rig.js';

const { DEFAULT_PROFILE, saveProfile, loadProfile } = await import('../src/game/economy/profile.ts');
const { settleResult } = await import('../src/game/economy/settlement.ts');
const { rankFor } = await import('../src/game/economy/rank.ts');
const { ResultsScreen, MainMenu } = await import('../src/ui/Screens.tsx');
const { RankedSetup } = await import('../src/ui/Competitive.tsx');
const { DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { armoryLaunchMode } = await import('../src/ui/session-routing.ts');
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const noop = () => {};
after(() => { restoreAudio(); restoreCanvas(); });

test('ranked entry, setup, boot and re-queue are connected to the real competitive launch, not a story mission', () => {
  const menu = render(MainMenu, { s: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, onDeploy: noop,
    onSettings: noop, onMap: noop, onRanked: noop });
  assert.match(menu, /OPERATION BLACKOUT/);
  const setup = render(RankedSetup, { rank: rankFor(DEFAULT_PROFILE.ranked.rating, DEFAULT_PROFILE.ranked),
    rating: DEFAULT_PROFILE.ranked.rating, record: DEFAULT_PROFILE.ranked, onDeploy: noop, onBack: noop });
  assert.match(setup, /DEPLOY TO BLACKOUT/);
  assert.match(source, /onRanked=\{\(\) => \{ setMenuView\('home'\); changePhase\('ranked-setup'\); \}\}/);
  assert.match(source, /phase === 'ranked-setup' && !launching/);
  const launch = source.slice(source.indexOf('const deployRanked ='), source.indexOf('const launch ='));
  assert.equal((launch.match(/await launch\('arena', 'comp'\)/g) ?? []).length, 1, 'no double ranked deployment');
  assert.match(source, /phaseRef\.current === 'ranked-setup'\) changePhase\('menu'\)/, 'setup unmounts before boot');
  assert.match(source, /results\.comp \? deployRanked\(\) : results\.tdm \? launch\('arena', 'tdm'\) : deploy\(\)/);
  assert.match(source, /hud\.comp \? deployRanked\(\) : hud\.tdm \? launch\('arena', 'tdm'\) : deploy\(\)/);
});

test('Armory play from results preserves ranked/TDM mode even when the saved map differs', () => {
  assert.equal(armoryLaunchMode('results', { comp: {}, tdm: {} }, 'kasbah'), 'comp');
  assert.equal(armoryLaunchMode('results', { tdm: {} }, 'alrasul'), 'tdm');
  assert.equal(armoryLaunchMode('results', null, 'kasbah'), 'mission');
  assert.equal(armoryLaunchMode('menu', null, 'arena'), 'tdm');
  assert.equal(armoryLaunchMode('menu', { comp: {} }, 'kasbah'), 'mission', 'a stale result cannot hijack a fresh menu visit');
  assert.match(source, /const armoryMode = armoryLaunchMode\(armoryFrom, results, settings\.map\)/);
  assert.match(source, /armoryMode === 'comp' \? deployRanked\(\) : armoryMode === 'tdm' \? launch\('arena', 'tdm'\) : deploy\(\)/);
  assert.match(source, /BLACKOUT · RANKED SEARCH & DESTROY/);
});

test('a simulated ranked match settles cash and exactly its ladder state, survives reload, and shows its own result', () => {
  const originalRandom = Math.random;
  const rig = playMatch(7);
  try {
    assert.equal(rig.runner.match.phase, 'matchEnd');
    const fake = fakeEngine({ comp: rig.runner, compMatchT: 412, dead: true, shots: 180, hits: 44 });
    Engine.prototype.endCompMatch.call(fake);
    const end = fake.pendingResult;
    assert.equal(end.type, 'end');
    assert.ok(end.comp && end.tdm, 'ranked report includes the leaderboard and its typed debrief');
    assert.equal(end.tdm.outcome, end.comp.draw ? 'draw' : end.comp.win ? 'win' : 'loss');
    const prev = structuredClone(DEFAULT_PROFILE);
    prev.cash = 150; prev.lifetimeCash = 900; prev.missions = 4; prev.kills = 12;
    const settled = settleResult(prev, end);
    assert.equal(settled.profile.ranked.matches, prev.ranked.matches + 1);
    assert.equal(settled.profile.ranked.rating, end.comp.next.rating);
    assert.equal(settled.profile.ranked.placements, end.comp.next.placements);
    assert.equal(settled.profile.missions, 4, 'ranked is not a story mission');
    assert.equal(settled.profile.kills, 12 + end.kills);
    assert.equal(settled.wallet.gradeBonus, 0, 'ranked pays round earnings, not a story grade bonus');
    assert.equal(settled.wallet.earned, Math.round(end.cash * end.difficultyMul));
    assert.equal(settled.profile.cash, 150 + settled.wallet.earned);
    assert.equal(prev.ranked.matches, 0, 'the original profile stays immutable');
    const storage = new Map();
    const store = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    saveProfile(settled.profile, store);
    const reloaded = loadProfile(store);
    assert.deepEqual(reloaded.ranked, end.comp.next, 'rating, record and placements persist for the next queue');
    const page = render(ResultsScreen, { r: end, wallet: settled.wallet,
      onRedeploy: noop, onMenu: noop, onArmory: noop });
    assert.match(page, /RANKED RESULT · BLACKOUT/);
    assert.match(page, /RE-QUEUE/);
    assert.doesNotMatch(page, /Grade [A-F]/);
    const cash = fake.cashEarned, rating = fake.compRanked.rating;
    Engine.prototype.endCompMatch.call(fake);
    assert.equal(fake.cashEarned, cash);
    assert.equal(fake.compRanked.rating, rating);
    assert.match(source, /if \(resultHandled\.current\) break/);
    assert.match(source, /resultHandled\.current = false/, 'every new launch resets the one-result guard');
  } finally {
    rig.runner.dispose();
    const geometry = new Set(), materials = new Set();
    rig.world.group.traverse(object => {
      if (!object.isMesh && !object.isPoints) return;
      geometry.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
    });
    for (const g of geometry) { g.disposeBoundsTree?.(); g.dispose(); }
    for (const m of materials) m.dispose();
    rig.world.group.removeFromParent();
    assert.equal(rig.runner.manager.bots.length, 0, 'all ranked AI actors leave the scene');
    Math.random = originalRandom;
  }
});
