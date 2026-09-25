import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../src/game/defusal/rules.ts');
const { MatchState, ECONOMY, TIMING, KILL_REWARD, MATCH_FORMATS, lossBonus, roundPayout, winReward, pickMvp, clampMoney } = R;

/** Advance the state machine, collecting every transition. */
function run(m, seconds, dt = 0.1) {
  const out = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) out.push(...m.tick(dt));
  return out;
}

test('CS2 economy constants are pinned', () => {
  assert.equal(ECONOMY.start, 800);
  assert.equal(ECONOMY.max, 16000);
  assert.equal(ECONOMY.winElimination, 3250);
  assert.equal(ECONOMY.winTime, 3250);
  assert.equal(ECONOMY.winBomb, 3500);
  assert.equal(ECONOMY.winDefuse, 3500);
  assert.deepEqual([...ECONOMY.lossLadder], [1400, 1900, 2400, 2900, 3400]);
  assert.equal(ECONOMY.startingLosses, 1);
  assert.equal(ECONOMY.plantTeamBonus, 800);
  assert.equal(ECONOMY.plantPersonal, 300);
  assert.equal(ECONOMY.defusePersonal, 300);
  assert.deepEqual(KILL_REWARD, { pistol: 300, smg: 600, shotgun: 900, rifle: 300, sniper: 100, lmg: 300, grenade: 300 });
  assert.equal(TIMING.plant, 3.2);
  assert.equal(TIMING.bomb, 40);
  assert.equal(TIMING.defuse, 10);
  assert.equal(TIMING.defuseKit, 5);
});

test('loss bonus climbs 1,900 → 3,400 from the pistol round and a win only drops one tier', () => {
  const m = new MatchState('long', 'attack');
  const lossesPaid = [];
  for (let i = 0; i < 5; i++) {
    run(m, TIMING.freeze + 0.05);
    m.endRound('defend', 'elimination');          // alpha (attack) loses
    lossesPaid.push(lossBonus(m.losses.alpha));
    run(m, TIMING.roundEnd + 0.05);
  }
  assert.deepEqual(lossesPaid, [1900, 2400, 2900, 3400, 3400], 'CS2: pistol-round loss already pays the second tier');
  run(m, TIMING.freeze + 0.05);
  m.endRound('attack', 'elimination');            // alpha wins once
  assert.equal(m.losses.alpha, 4, 'a win steps the counter down by one, not to zero');
  run(m, TIMING.roundEnd + 0.05);
  run(m, TIMING.freeze + 0.05);
  m.endRound('defend', 'time');
  assert.equal(lossBonus(m.losses.alpha), 3400, 'back on the top tier after a single win');
});

test('round payouts: winners by reason, plant bonus on a loss, nothing for attackers who hide out the clock', () => {
  assert.equal(winReward('bomb'), 3500);
  assert.equal(winReward('defuse'), 3500);
  assert.equal(winReward('time'), 3250);
  assert.equal(roundPayout({ won: true, side: 'attack', reason: 'elimination', planted: false, alive: true, lossesAfter: 0 }), 3250);
  assert.equal(roundPayout({ won: false, side: 'attack', reason: 'defuse', planted: true, alive: false, lossesAfter: 2 }), 1900 + 800);
  assert.equal(roundPayout({ won: false, side: 'defend', reason: 'bomb', planted: true, alive: true, lossesAfter: 1 }), 1400, 'plant bonus is attackers only');
  assert.equal(roundPayout({ won: false, side: 'attack', reason: 'time', planted: false, alive: true, lossesAfter: 3 }), 0, 'survivors of a time-out get nothing');
  assert.equal(roundPayout({ won: false, side: 'attack', reason: 'time', planted: false, alive: false, lossesAfter: 3 }), 2400, 'the dead still get the loss bonus');
  assert.equal(clampMoney(17000.4), 16000);
  assert.equal(clampMoney(-5), 0);
});

test('freeze → live → time-out gives defenders the round; plant switches the clock to the 40 s fuse', () => {
  const m = new MatchState('short', 'defend');
  assert.equal(m.phase, 'freeze');
  assert.ok(m.buyOpen);
  let tr = run(m, TIMING.freeze + 0.05);
  assert.deepEqual(tr.map(t => t.type), ['live']);
  assert.ok(m.buyOpen, 'buying stays open for the first seconds of the round');
  run(m, TIMING.buyGrace + 0.2);
  assert.ok(!m.buyOpen, 'buy window closes');
  tr = run(m, TIMING.round);
  const end = tr.find(t => t.type === 'end');
  assert.ok(end, 'round ends on the clock');
  assert.equal(end.record.reason, 'time');
  assert.equal(end.record.winnerSide, 'defend');
  assert.equal(end.record.winner, 'alpha', 'alpha defended');
  // Round 2: plant, then let the bomb detonate.
  run(m, TIMING.roundEnd + TIMING.freeze + 0.2);
  assert.equal(m.phase, 'live');
  run(m, 50);
  assert.ok(m.plant());
  assert.equal(m.phase, 'planted');
  assert.ok(Math.abs(m.clock - TIMING.bomb) < 1e-9);
  tr = run(m, TIMING.bomb + 0.05);
  const boom = tr.find(t => t.type === 'end');
  assert.equal(boom.record.reason, 'bomb');
  assert.equal(boom.record.winnerSide, 'attack');
  assert.ok(boom.record.planted);
  assert.equal(m.endRound('defend', 'defuse'), null, 'a finished round cannot be scored twice');
});

test('halftime swaps sides, resets the loss counters, and the match ends at 7 or draws at 6-6', () => {
  const m = new MatchState(MATCH_FORMATS.short, 'attack');
  for (let r = 1; r <= 6; r++) {
    run(m, TIMING.freeze + 0.05);
    m.endRound(r % 2 ? 'attack' : 'defend', 'elimination');
    const tr = run(m, TIMING.roundEnd + 0.05);
    if (r < 6) assert.deepEqual(tr.map(t => t.type), ['round']);
    else assert.deepEqual(tr.map(t => t.type), ['halftime']);
  }
  assert.equal(m.score.alpha, 3);
  const tr = run(m, TIMING.halftime + 0.05);
  assert.deepEqual(tr.map(t => t.type), ['round']);
  assert.equal(tr[0].swapped, true);
  assert.equal(m.alphaSide, 'defend');
  assert.deepEqual(m.losses, { alpha: 1, bravo: 1 });
  assert.equal(m.half, 2);
  for (let r = 7; r <= 12; r++) {
    run(m, TIMING.freeze + 0.05);
    m.endRound(r % 2 ? 'attack' : 'defend', 'elimination');
    run(m, TIMING.roundEnd + 0.05);
    if (m.phase === 'ended') break;
  }
  assert.equal(m.phase, 'ended');
  assert.equal(m.winner, 'draw', '6-6 in a 12-round match is a draw');
  // First to seven.
  const w = new MatchState('short', 'attack');
  let rounds = 0;
  while (w.phase !== 'ended' && rounds < 20) {
    run(w, Math.max(0.05, w.clock) + 0.05);
    if (w.phase === 'live') { w.endRound(w.sideOf('alpha'), 'elimination'); rounds++; }
  }
  assert.equal(w.winner, 'alpha');
  assert.equal(w.score.alpha, 7);
  assert.equal(rounds, 7);
});

test('MVP: defuser or planter takes it on objective wins, otherwise most kills (damage breaks ties)', () => {
  const players = [
    { id: 'a', team: 'alpha', kills: 3, damage: 300 },
    { id: 'b', team: 'alpha', kills: 1, damage: 90, defused: true },
    { id: 'c', team: 'alpha', kills: 3, damage: 340, planted: true },
    { id: 'x', team: 'bravo', kills: 4, damage: 500 },
  ];
  assert.equal(pickMvp({ winner: 'alpha', reason: 'defuse' }, players), 'b');
  assert.equal(pickMvp({ winner: 'alpha', reason: 'bomb' }, players), 'c');
  assert.equal(pickMvp({ winner: 'alpha', reason: 'elimination' }, players), 'c', 'tie on kills → more damage');
  assert.equal(pickMvp({ winner: 'bravo', reason: 'elimination' }, players), 'x');
});
