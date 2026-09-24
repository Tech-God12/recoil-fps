import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { DEFAULT_PROFILE } = await import('../src/game/economy/profile.ts');
const { settleResult } = await import('../src/game/economy/settlement.ts');
const { TDM_DRAW_CASH, tdmOutcome } = await import('../src/game/tdm.ts');
const { Engine } = await import('../src/game/engine.ts');
const { voice } = await import('../src/game/voice.ts');
const { ResultsScreen } = await import('../src/ui/Screens.tsx');

test('TDM outcome resolution distinguishes alpha wins, bravo wins, and ties', () => {
  assert.equal(tdmOutcome(11, 10), 'win');
  assert.equal(tdmOutcome(10, 11), 'loss');
  assert.equal(tdmOutcome(10, 10), 'draw');
});

test('engine end-match wiring emits a draw outcome and logs the draw-specific stipend', () => {
  voice.setEnabled(false);
  const events = [];
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    ended: false,
    tdm: { alphaScore: 10, bravoScore: 10, timeLeft: 0, bots: [] },
    tdmPlayerKills: 3, tdmPlayerDeaths: 2, tdmPlayerDead: false, tdmArmor: 1,
    shots: 20, hits: 10, headshots: 1, score: 300, cashEarned: 0, cashLog: [],
    difficultyId: 'Normal', runStartT: performance.now(), keys: new Set(), triggerHeld: false, rmb: false,
    onEvent: event => events.push(event),
  });

  engine.endTDMMatch();
  assert.equal(engine.pendingResult.tdm.outcome, 'draw');
  assert.equal(engine.pendingResult.win, false);
  assert.equal(engine.pendingResult.mission.status, 'complete');
  assert.equal(engine.pendingResult.cash, TDM_DRAW_CASH);
  assert.deepEqual(engine.pendingResult.cashLog.map(row => row.reason), ['draw']);
  assert.equal(events.filter(event => event.type === 'cash').length, 1);
  const settled = settleResult(structuredClone(DEFAULT_PROFILE), engine.pendingResult);
  assert.equal(settled.profile.missions, 0);
  assert.equal(settled.wallet.earned, TDM_DRAW_CASH);
});

test('a TDM draw pays the draw stipend without incrementing the story-mission count', () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.cash = 100;
  profile.lifetimeCash = 800;
  profile.missions = 4;
  profile.kills = 12;
  const settled = settleResult(profile, {
    win: false, kills: 3, shots: 20, hits: 10,
    cash: TDM_DRAW_CASH, difficultyMul: 1,
    tdm: { outcome: tdmOutcome(10, 10) },
  });

  assert.equal(settled.profile.cash, 100 + TDM_DRAW_CASH);
  assert.equal(settled.profile.lifetimeCash, 800 + TDM_DRAW_CASH);
  assert.equal(settled.profile.missions, 4);
  assert.equal(settled.profile.kills, 15);
  assert.deepEqual(settled.wallet, { before: 100, after: 350, gradeBonus: 0, earned: TDM_DRAW_CASH });
});

test('a TDM win retains its match payout but still does not count as a story mission', () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.cash = 20;
  profile.missions = 2;
  const settled = settleResult(profile, {
    win: true, kills: 2, shots: 20, hits: 10, cash: 100, difficultyMul: 1,
    tdm: { outcome: 'win' },
  });
  assert.equal(settled.profile.missions, 2);
  assert.equal(settled.profile.kills, 2);
  assert.equal(settled.wallet.gradeBonus, 200);
  assert.equal(settled.wallet.earned, 300);
  assert.equal(settled.profile.cash, 320);
});

test('story mission failures still count as an ended mission and retain their earned cash', () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.cash = 50;
  profile.missions = 2;
  const settled = settleResult(profile, {
    win: false, kills: 1, shots: 8, hits: 2, cash: 100, difficultyMul: 1.25,
  });
  assert.equal(settled.profile.missions, 3);
  assert.equal(settled.profile.kills, 1);
  assert.equal(settled.wallet.earned, 125);
  assert.equal(settled.profile.cash, 175);
});

test('TDM draw debrief is labeled as a draw, not a grade-D defeat', () => {
  const report = {
    win: false, kills: 3, score: 0, shots: 20, hits: 10, headshots: 1, timeSec: 150,
    mission: { id: 'tdm-warehouse', name: 'Warehouse TDM', map: 'arena', status: 'complete', duration: 150, phases: [] },
    pressure: { totalSpawned: 10, peakLive: 10, retired: 0, pending: 0, candidateChecks: 0, sightChecks: 0, deferred: 0 },
    cash: TDM_DRAW_CASH, cashLog: [{ reason: 'draw', amount: TDM_DRAW_CASH, t: 150 }], difficultyMul: 1,
    tdm: {
      alphaScore: 10, bravoScore: 10, playerKills: 3, outcome: 'draw',
      roster: [{ name: 'YOU', team: 'alpha', dead: false, armorIcon: '○', you: true, kills: 3, deaths: 3, headshots: 1 }],
    },
  };
  const html = renderToStaticMarkup(React.createElement(ResultsScreen, {
    r: report, wallet: { before: 0, after: TDM_DRAW_CASH, gradeBonus: 0, earned: TDM_DRAW_CASH },
    onRedeploy() {}, onMenu() {}, onArmory() {},
  }));
  assert.match(html, />Draw</);
  assert.match(html, /Match draw/);
  assert.match(html, />Rematch</);
  assert.doesNotMatch(html, /results-root lose/);
  assert.doesNotMatch(html, /Grade D/);
});
