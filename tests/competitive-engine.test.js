import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import {
  makeRunner, playMatch, stepUntil, fakeEngine, Effects,
  matchMod, rules, rank,
} from './helpers/comp-rig.js';

const Engine = (await import('../src/game/engine.ts')).Engine;
const { CompHudLayer, CompScoreboard, CompDebriefPanel, RankedSetup, RankBadge, compClock } =
  await import('../src/ui/Competitive.tsx');

const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('a fully armed round rebuilds the player loadout from the ranked kit', () => {
  const ctx = fakeEngine();
  Engine.prototype.compApplyKit.call(ctx, {
    primary: 'ak47', secondary: 'm1911', armor: 100, helmet: true, kit: false, frags: 1, flashes: 2,
  });
  assert.equal(ctx.weapons.length, 2, 'a primary and a sidearm');
  assert.equal(ctx.compArmor, 100);
  assert.equal(ctx.compHelmet, true);
  assert.equal(ctx.frags, 1);
  assert.equal(ctx.flashes, 2);
  const [primary, sidearm] = ctx.weapons;
  assert.ok(primary.magSize > sidearm.magSize, 'the AK holds more than the M1911');
  assert.deepEqual(ctx.mags, [primary.magSize, sidearm.magSize], 'mags are refilled on a buy');
  assert.equal(primary.model.group.visible, true);
  assert.equal(sidearm.model.group.visible, false, 'the sidearm waits in the holster');
  assert.ok(ctx.vmScene.children.includes(primary.model.group));

  // Buying the same rifle again next round must not rebuild the viewmodel.
  const before = ctx.weapons[0];
  Engine.prototype.compApplyKit.call(ctx, {
    primary: 'ak47', secondary: 'm1911', armor: 65, helmet: true, kit: true, frags: 0, flashes: 0,
  });
  assert.equal(ctx.weapons[0], before, 'the same gun is reused, only refilled');
  assert.equal(ctx.compArmor, 65, 'armour carries its wear into the next round');
  assert.equal(ctx.weapons[0].model.group.visible, true);

  // A loss drops the rifle: the rack gives you back your pistol only.
  Engine.prototype.compApplyKit.call(ctx, { primary: null, secondary: 'm1911', armor: 0, helmet: false, kit: false, frags: 0, flashes: 0 });
  assert.equal(ctx.weapons.length, 1);
  assert.equal(ctx.weapons[0].model.group.visible, true);
});

test('the ranked debrief is written from the match, the ladder and the wallet', () => {
  const { runner } = playMatch(7);
  assert.equal(runner.match.phase, 'matchEnd');
  const actor = runner.match.of(matchMod.PLAYER_ID);
  const ctx = fakeEngine({ comp: runner, compMatchT: 412, dead: true, score: 900, shots: 180, hits: 44, triggerHeld: true, rmb: true });
  ctx.keys.add('KeyW');
  Engine.prototype.endCompMatch.call(ctx);
  assert.equal(ctx.ended, true, 'the match is over once');
  assert.equal(ctx.pendingResult.type, 'end');
  assert.equal(ctx.pendingResult.comp.score.alpha, runner.match.score.alpha);
  assert.equal(ctx.pendingResult.comp.rounds, runner.match.history.length);
  assert.equal(ctx.pendingResult.comp.kills, actor.kills);
  assert.equal(ctx.pendingResult.comp.adr, Math.round(actor.damage / Math.max(1, actor.roundsPlayed)));
  assert.equal(ctx.pendingResult.comp.ratingAfter, ctx.compRanked.rating);
  assert.equal(ctx.pendingResult.comp.ratingBefore, ctx.compRanked.rating - ctx.compDebrief.delta);
  assert.equal(ctx.pendingResult.comp.next.rating, ctx.compRanked.rating);
  assert.equal(ctx.pendingResult.comp.placement, ctx.compRanked.placements > 0, 'a placement is flagged');
  assert.equal(ctx.pendingResult.tdm.roster.length, 10, 'the ranked board lists both squads plus the player');
  assert.equal(ctx.pendingResult.tdm.roster.filter(r => r.you).length, 1);
  assert.ok(ctx.cashEarned > 0, 'ranked pays into the armory wallet');
  assert.equal(ctx.keys.size, 0, 'input is released on the debrief');
  assert.ok(ctx.pendingResult.comp.rankBefore.length > 0);
  assert.ok(ctx.finishDelay > 0, 'the debrief screen gets its beat');

  // Ending twice must not double-pay or re-write the ladder.
  const cash = ctx.cashEarned, rating = ctx.compRanked.rating;
  Engine.prototype.endCompMatch.call(ctx);
  assert.equal(ctx.cashEarned, cash);
  assert.equal(ctx.compRanked.rating, rating);
});

test('ranked rounds resolve through the round engine, never the mission fail path', () => {
  const { runner } = makeRunner(3);
  const ctx = fakeEngine({ comp: runner, isComp: true });
  Engine.prototype.endMatch.call(ctx, false);
  assert.equal(ctx.ended, false, 'a ranked death is a spectate camera, not a mission failure');
  assert.equal(ctx.pendingResult, null);
  assert.equal(runner.match.phase, 'buy');
});

test('the charge blast reuses the frag FX without touching health or kill credit', () => {
  const rig = makeRunner(11);
  const { runner } = rig;
  stepUntil(runner, () => runner.match.phase === 'live', 20);
  const victim = runner.manager.bots.find(b => !b.dead);
  assert.ok(victim);
  const before = { hp: victim.hp, armor: victim.armorPool, kills: runner.match.of(matchMod.PLAYER_ID).kills };
  const anchor = {
    mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
    pos: victim.pos.clone(), vel: new THREE.Vector3(), fuse: 0, kind: 'frag', fromAI: false, fxOnly: true,
  };
  // Real world (so the windows really blow out), real effects, stubbed audio.
  const ctx = fakeEngine({
    world: rig.world, effects: new Effects(rig.scene), shake: 0,
    eyePos: () => new THREE.Vector3(0, 1.6, 36),
    comp: runner, isComp: true, tdm: runner.manager,
  });
  Engine.prototype.explode.call(ctx, anchor);
  assert.equal(victim.hp, before.hp, 'the visual blast must not damage the squad');
  assert.equal(victim.armorPool, before.armor);
  assert.equal(runner.match.of(matchMod.PLAYER_ID).kills, before.kills, 'no frag kills are credited for the charge');
  assert.ok(ctx.shake > 0, 'the camera still feels the blast');
});

test('the blast model is the ranked one: 14 m, 500 at the centre', () => {
  assert.equal(rules.COMP_BLAST_RADIUS, 14);
  assert.equal(rules.COMP_BLAST_DAMAGE, 500);
  assert.equal(matchMod.blastDamage(4.9), rules.COMP_BLAST_DAMAGE);
  assert.ok(matchMod.blastDamage(13.9) > 0 && matchMod.blastDamage(13.9) < 20);
});

// ------------------------------------------------------------------ the UI ----

test('the ranked HUD renders real round state, rack prices and the site call', () => {
  const rig = makeRunner(7);
  const { runner } = rig;
  stepUntil(runner, () => runner.match.phase === 'live', 20);
  const ctx = fakeEngine({ comp: runner, world: rig.world, compBuyCursor: 2, compBuyOpen: false, compRanked: rank.DEFAULT_RANKED });
  const view = Engine.prototype.compHudView.call(ctx);
  assert.equal(view.roster.length, 10);
  assert.equal(view.buyOpen, false, 'the rack closes when the round goes live');
  assert.equal(view.rack.length > 8, true);
  assert.equal(view.targetSite, runner.director.targetSite);
  assert.equal(view.siteRings.length, 2);
  // Nine bots plus the player make the ten combatants; the player is not a radar dot.
  assert.equal(view.mates.length + view.foes.length, 9);

  const html = render(CompHudLayer, { comp: view });
  assert.match(html, /comp-layer/, 'the ranked layer is on screen');
  assert.match(html, new RegExp(`Round ${view.round}`), 'the round number reads through');
  assert.ok(html.includes(`>${view.score.alpha}<`) && html.includes(`>${view.score.bravo}<`), 'both sides of the score print');
  assert.ok(html.includes(`Target site ${view.targetSite}`), 'attackers always read a live objective');
  assert.ok(!html.includes('undefined'), 'nothing undefined leaks into the HUD');
  assert.ok(!html.includes('NaN'), 'nothing NaN leaks into the HUD');
});

test('the buy rack shows prices, affordability and the cursor during the buy phase', () => {
  const rig = makeRunner(5);
  const { runner } = rig;
  assert.equal(runner.match.phase, 'buy');
  const ctx = fakeEngine({ comp: runner, world: rig.world, compBuyOpen: true, compBuyCursor: 4 });
  const view = Engine.prototype.compHudView.call(ctx);
  assert.equal(view.buyOpen, true);
  const html = render(CompHudLayer, { comp: view });
  assert.match(html, /comp-buy|buy-rack/, 'the rack is up during the buy phase');
  assert.ok(html.includes('$'), 'prices are printed');
  assert.ok(html.includes(String(view.rack[0].name.split(' ')[0])), 'rack entries are named');
  assert.ok(!html.includes('undefined'));

  // Legality is law: attackers are never offered the defuse kit at all.
  const side = runner.match.side[runner.match.of(matchMod.PLAYER_ID).team];
  const kit = view.rack.find(item => item.id === 'g_kit');
  if (side === 'attack') assert.equal(kit, undefined, 'the rack hides the defuse kit from attackers');
  else assert.ok(kit && kit.legal, 'defenders can buy the kit');
});

test('the hold-Tab board reads like a real scoreboard', () => {
  const rig = playMatch(29);
  const { runner } = rig;
  const ctx = fakeEngine({ comp: runner, world: rig.world, ended: true, compRatingChange: 12 });
  const view = Engine.prototype.compHudView.call(ctx);
  const html = render(CompScoreboard, { comp: view });
  assert.match(html, /comp-board/);
  assert.ok(view.roster.some(r => r.you), 'the player is on their own board');
  assert.ok(html.includes('You'), 'the player is named on the board');
  for (const column of ['K', 'D', 'HS', 'ADR']) assert.ok(html.includes(column), `the board names ${column}`);
  assert.equal(view.rank.tier.id.length > 0, true);
  assert.equal(view.ratingChange, 12, 'the board carries the ranked delta once the match ends');
  assert.ok(!html.includes('NaN'));
});

test('the debrief panel reports the ladder move and the round story', () => {
  const { runner } = playMatch(13);
  const ctx = fakeEngine({ comp: runner, compMatchT: 500 });
  Engine.prototype.endCompMatch.call(ctx);
  const report = ctx.pendingResult.comp;
  const html = render(CompDebriefPanel, { report });
  assert.ok(html.includes(report.rankBefore), 'the rank the player came in with');
  assert.ok(html.includes(report.rankAfter), 'and the one they leave with');
  assert.ok(html.includes(String(report.rounds)));
  assert.match(html, /comp-debrief/);
  assert.ok(!html.includes('undefined'));
  const badge = render(RankBadge, { rank: rank.rankFor(report.ratingAfter), delta: report.delta, compact: true });
  assert.ok(badge.length > 0);
});

test('the ranked front end states the rules and the record honestly', () => {
  const record = { wins: 4, losses: 3, draws: 1, streak: 2, matches: 8, placements: 5, rating: 1180 };
  const html = render(RankedSetup, {
    rank: rank.rankFor(record.rating, record), rating: record.rating, record,
    onDeploy: () => {}, onBack: () => {},
  });
  assert.match(html, /blackout/);
  assert.match(html, /Silver|Gold|Bronze|Platinum|Diamond|Master/, 'the tier is named');
  assert.ok(html.includes('1180'), 'the rating is printed');
  assert.match(html, /7|seven/i, 'the win condition is stated');
  assert.ok(!html.includes('undefined'));
});

test('compClock is mm:ss and never negative', () => {
  assert.equal(compClock(0), '0:00');
  assert.equal(compClock(9.4), '0:10', 'the clock rounds up so the last second is honest');
  assert.equal(compClock(61), '1:01');
  assert.equal(compClock(600), '10:00');
  assert.equal(compClock(-5), '0:00');
});
