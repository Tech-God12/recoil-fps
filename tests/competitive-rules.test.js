// Operation Blackout — ranked Search & Destroy round engine.
// These tests drive the pure state machine with no engine, no WebGL and no timers:
// the round engine is the authority on wins, money, the bomb and the ladder, so it
// must be provable on its own before any of it is allowed near a live match.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const rules = await import('../src/game/competitive/rules.ts');
const rank = await import('../src/game/economy/rank.ts');
const buy = await import('../src/game/competitive/buy.ts');

const {
  CompetitiveMatch, COMP_START_MONEY, COMP_WIN_REWARD, COMP_LOSS_REWARDS, COMP_BUY_SECONDS,
  COMP_ROUND_SECONDS, COMP_BOMB_FUSE, COMP_PLANT_SECONDS, COMP_DEFUSE_SECONDS, COMP_DEFUSE_KIT_SECONDS,
  COMP_ROUND_END_SECONDS, COMP_PLANT_REWARD, COMP_DEFUSE_REWARD, COMP_MAX_MONEY, COMP_HALFTIME_ROUNDS,
  COMP_OVERTIME_START_MONEY, COMP_PICKUP_RADIUS, COMP_DEFUSE_RADIUS, COMP_SITES,
  applyCompetitiveDamage, killReward, siteAt, otherTeam, otherSide,
} = rules;

let uid = 0;
/** Five-a-side roster with deterministic ids, mirroring the live team shape. */
function roster() {
  const make = (team, prefix) => Array.from({ length: 5 }, (_, i) => ({
    id: `${prefix}${i}`, name: `${prefix.toUpperCase()}${i}`, team,
  }));
  return [...make('alpha', 'a'), ...make('bravo', 'b')];
}

function newMatch(overrides = {}) {
  return new CompetitiveMatch(roster(), {
    random: () => 0.5,
    ...overrides,
  });
}

/** Run the buy phase out and land in a live round. */
function startRound(match) {
  match.startMatch();
  match.fastForward(COMP_BUY_SECONDS + 0.05);
  assert.equal(match.phase, 'live');
}

/** Steamroller: kill every member of a team. */
function wipe(match, team) {
  for (const c of match.roster(team)) match.notifyKill(null, c.id, 'm4a1', false);
}

test('a fresh match arms the buy phase on a 5v5 with the charge on an attacker', () => {
  const match = newMatch();
  match.startMatch();
  assert.equal(match.combatants.length, 10);
  assert.equal(match.phase, 'buy');
  assert.equal(match.round, 1);
  assert.equal(match.timeLeft, COMP_BUY_SECONDS);
  assert.equal(match.score.alpha, 0);
  assert.equal(match.score.bravo, 0);
  assert.deepEqual(match.side, { alpha: 'attack', bravo: 'defend' });
  for (const c of match.combatants) assert.equal(c.money, COMP_START_MONEY);
  assert.equal(match.bomb.state, 'carried');
  assert.ok(match.isAttacker(match.bomb.carrierId), 'the charge starts on the attacking side');
  assert.equal(match.roster('alpha').every(c => c.secondary === 'm1911' && c.primary === null), true);
});

test('the buy phase runs out into a live round with a full clock', () => {
  const match = newMatch();
  match.startMatch();
  match.fastForward(COMP_BUY_SECONDS - 3);
  assert.equal(match.phase, 'buy');
  assert.ok(Math.abs(match.timeLeft - 3) < 0.001);
  match.fastForward(4);
  assert.equal(match.phase, 'live');
  assert.ok(match.timeLeft > COMP_ROUND_SECONDS - 1 && match.timeLeft <= COMP_ROUND_SECONDS,
    'the action clock starts over when the round goes live');
  const events = match.drain().map(e => e.type);
  assert.deepEqual(events, ['round-start', 'phase', 'phase']);
});

test('buying respects funds, slots, side restrictions and utility caps', () => {
  const match = newMatch();
  match.startMatch();
  const atk = match.combatants.find(c => match.isAttacker(c.id));
  const def = match.combatants.find(c => !match.isAttacker(c.id));
  atk.money = 9000;
  def.money = 9000;

  assert.equal(match.buy(atk.id, 'w_ak47'), true, 'rifle bought');
  assert.equal(atk.money, 9000 - 2700);
  assert.equal(atk.primary, 'ak47');
  assert.equal(match.buy(atk.id, 'w_m4a1'), false, 'one primary per operator');
  assert.equal(match.buy(atk.id, 'w_ak47'), false, 'no double-buying the same class');
  assert.equal(match.buy(atk.id, 'g_kit'), false, 'defuse kits are defenders only');
  assert.equal(match.buy(def.id, 'g_kit'), true);
  assert.equal(def.kit, true);
  assert.equal(match.buy(def.id, 'g_kit'), false, 'one kit per operator');

  assert.equal(match.buy(atk.id, 'g_kevlar'), true);
  assert.equal(atk.armor, 100);
  assert.equal(match.buy(atk.id, 'g_kevlar'), false, 'armor is not stackable');
  assert.equal(match.buy(atk.id, 'g_helmet'), true, 'upgrading to a helmet is allowed');
  assert.equal(atk.helmet, true);

  assert.equal(match.buy(atk.id, 'g_frag'), true);
  assert.equal(match.buy(atk.id, 'g_frag'), true);
  assert.equal(match.buy(atk.id, 'g_frag'), false, 'two frags is the cap');
  assert.equal(atk.frags, 2);
  assert.equal(match.buy(atk.id, 'g_flash'), true);
  assert.equal(match.buy(atk.id, 'g_flash'), true);
  assert.equal(match.buy(atk.id, 'g_flash'), false, 'two flashes is the cap');

  const broke = match.combatants[0];
  broke.money = 100;
  assert.equal(match.buy(broke.id, 'w_mp7'), false, 'cannot buy beyond your means');
});

test('weapons cannot be bought once the round goes live', () => {
  const match = newMatch();
  match.startMatch();
  const shopper = match.combatants[0];
  shopper.money = 9000;
  match.fastForward(COMP_BUY_SECONDS + 0.5);
  assert.equal(match.phase, 'live');
  assert.equal(match.buy(shopper.id, 'w_m4a1'), false);
  assert.equal(shopper.primary, null);
});

test('eliminating the defence wins the round outright, and the economy pays both sides', () => {
  const match = newMatch();
  startRound(match);
  const alphaMoney = match.roster('alpha').map(c => c.money);
  wipe(match, 'bravo');
  match.fastForward(0.05);
  assert.equal(match.phase, 'roundEnd');
  assert.equal(match.score.alpha, 1);
  assert.equal(match.lastRound.reason, 'elimination');
  assert.ok(match.timeLeft > COMP_ROUND_END_SECONDS - 1 && match.timeLeft <= COMP_ROUND_END_SECONDS);

  match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
  assert.equal(match.round, 2, 'the next round starts after the round-end beat');
  assert.equal(match.phase, 'buy');
  for (const [i, c] of match.roster('alpha').entries()) {
    assert.equal(c.money, Math.min(COMP_MAX_MONEY, alphaMoney[i] + COMP_WIN_REWARD), 'winners take the round bonus');
  }
  for (const c of match.roster('bravo')) {
    assert.equal(c.money, COMP_START_MONEY + COMP_LOSS_REWARDS[0], 'the losing side takes the first loss bonus');
  }
  assert.equal(match.lossStreak.bravo, 1, 'the streak counter tracks consecutive losses');
});

test('the loss bonus climbs with consecutive losses and resets on a win', () => {
  const match = newMatch();
  startRound(match);
  for (let round = 1; round <= 3; round++) {
    if (match.phase === 'buy') match.fastForward(COMP_BUY_SECONDS + 0.05);
    wipe(match, 'bravo');
    match.fastForward(0.05);
    match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
  }
  assert.equal(match.lossStreak.bravo, 3);
  const money = match.roster('bravo')[0].money;
  if (match.phase === 'buy') match.fastForward(COMP_BUY_SECONDS + 0.05);
  wipe(match, 'alpha');
  match.fastForward(0.05);
  match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
  assert.equal(match.score.bravo, 1, 'bravo finally took a round');
  assert.equal(match.roster('bravo')[0].money, money + COMP_WIN_REWARD);
  assert.equal(match.lossStreak.bravo, 0, 'a win clears the streak');
  assert.equal(match.lossStreak.alpha, 1);
});

test('money never exceeds the competitive ceiling', () => {
  const match = newMatch();
  match.startMatch();
  const saver = match.combatants[0];
  saver.money = COMP_MAX_MONEY - 100;
  match.awardMoney(saver.id, 5000);
  assert.equal(saver.money, COMP_MAX_MONEY);
});

test('survivors keep their kit and the dead lose everything they carried', () => {
  const match = newMatch();
  match.startMatch();
  const survivor = match.roster('alpha')[0];
  const corpse = match.roster('alpha')[1];
  survivor.money = 9000; corpse.money = 9000;
  match.buy(survivor.id, 'w_m4a1');
  match.buy(survivor.id, 'g_helmet');
  match.buy(survivor.id, 'g_frag');
  match.buy(corpse.id, 'w_awm');
  match.buy(corpse.id, 'g_kevlar');

  match.fastForward(COMP_BUY_SECONDS + 0.05);
  wipe(match, 'bravo');
  match.notifyKill('b0', corpse.id, 'm4a1', false);
  match.fastForward(0.05);
  match.fastForward(COMP_ROUND_END_SECONDS + 0.05);

  assert.equal(survivor.primary, 'm4a1', 'a survivor keeps the rifle');
  assert.equal(survivor.helmet, true);
  assert.equal(survivor.frags, 1);
  assert.equal(corpse.primary, null, 'the dead wake up with nothing but a sidearm');
  assert.equal(corpse.secondary, 'm1911');
  assert.equal(corpse.armor, 0);
  assert.equal(corpse.kit, false);
  assert.equal(corpse.frags, 0);
});

test('a planted charge keeps the round alive after the attacking squad is wiped', () => {
  const match = newMatch();
  startRound(match);
  const carrier = match.bombCarrier();
  match.holdAction(carrier.id, 'plant', COMP_PLANT_SECONDS + 0.05, { site: 'A', bombDist: 0 });
  assert.equal(match.bomb.state, 'planted');
  assert.equal(match.bomb.site, 'A');
  assert.equal(match.bomb.fuse, COMP_BOMB_FUSE);
  assert.equal(match.phase, 'live', 'the plant does not end the round by itself');

  wipe(match, 'alpha');
  match.fastForward(0.05);
  assert.equal(match.phase, 'live', 'a live charge outlives its team');

  // The defence clears the site and cuts the wire.
  const defender = match.roster('bravo')[0];
  match.holdAction(defender.id, 'defuse', COMP_DEFUSE_SECONDS + 0.05, { site: null, bombDist: 1 });
  assert.equal(match.bomb.state, 'defused');
  assert.equal(match.phase, 'roundEnd');
  assert.equal(match.lastRound.winner, 'bravo');
  assert.equal(match.lastRound.reason, 'defuse');
});

test('a defuse kit halves the wire-cutting time', () => {
  const match = newMatch();
  startRound(match);
  match.holdAction(match.bombCarrier().id, 'plant', COMP_PLANT_SECONDS + 0.05, { site: 'B', bombDist: 0 });
  const bare = match.roster('bravo')[0];
  const tech = match.roster('bravo')[1];
  tech.kit = true;

  match.holdAction(bare.id, 'defuse', COMP_DEFUSE_KIT_SECONDS + 0.2, { site: null, bombDist: 1 });
  assert.equal(match.bomb.state, 'planted', 'five seconds is not enough without a kit');
  match.cancelAction();
  match.holdAction(tech.id, 'defuse', COMP_DEFUSE_KIT_SECONDS + 0.05, { site: null, bombDist: 1 });
  assert.equal(match.bomb.state, 'defused', 'the kit cuts it in five');
});

test('an interrupted defuse starts over from nothing', () => {
  const match = newMatch();
  startRound(match);
  match.holdAction(match.bombCarrier().id, 'plant', COMP_PLANT_SECONDS + 0.05, { site: 'A', bombDist: 0 });
  const defender = match.roster('bravo')[0];
  match.holdAction(defender.id, 'defuse', 3, { site: null, bombDist: 1 });
  assert.ok(match.action && match.action.progress > 2.9);
  match.cancelAction();
  assert.equal(match.action, null);
  match.holdAction(defender.id, 'defuse', 0.5, { site: null, bombDist: 1 });
  assert.ok(match.action.progress < 0.6, 'progress is not banked across an interruption');
});

test('planting demands the charge, a site and the attacking side', () => {
  const match = newMatch();
  startRound(match);
  const carrier = match.bombCarrier();
  const teammate = match.roster('alpha').find(c => c.id !== carrier.id);
  const defender = match.roster('bravo')[0];

  match.holdAction(teammate.id, 'plant', 1, { site: 'A', bombDist: 0 });
  assert.equal(match.action, null, 'a non-carrier cannot plant');
  match.holdAction(carrier.id, 'plant', 1, { site: null, bombDist: 0 });
  assert.equal(match.action, null, 'planting outside a site is impossible');
  match.holdAction(defender.id, 'plant', 1, { site: 'A', bombDist: 0 });
  assert.equal(match.action, null, 'defenders never plant');
  match.holdAction(carrier.id, 'plant', 1, { site: 'A', bombDist: 0 });
  assert.ok(match.action && match.action.kind === 'plant');
  match.cancelAction();
  assert.equal(match.action, null);
});

test('a carrier killed away from the site drops the charge for a teammate to recover', () => {
  const match = newMatch();
  startRound(match);
  const carrier = match.bombCarrier();
  match.dropBomb(6, -3);
  assert.equal(match.bomb.state, 'dropped');
  assert.equal(match.bomb.carrierId, null);
  const rescuer = match.roster('alpha').find(c => c.id !== carrier.id);
  assert.equal(match.tryPickup(rescuer.id, 6 + COMP_PICKUP_RADIUS + 1, -3), false, 'out of reach');
  assert.equal(match.tryPickup(rescuer.id, 6.4, -3), true);
  assert.equal(match.bomb.state, 'carried');
  assert.equal(match.bomb.carrierId, rescuer.id);
  const defender = match.roster('bravo')[0];
  match.dropBomb(6, -3);
  assert.equal(match.tryPickup(defender.id, 6, -3), false, 'only attackers recover the charge');
});

test('a carrier killed mid-round drops the charge where the body fell', () => {
  const match = newMatch();
  startRound(match);
  const carrier = match.bombCarrier();
  match.notifyKill('b0', carrier.id, 'ak47', false);
  assert.equal(match.bomb.state, 'dropped');
  assert.equal(match.bomb.carrierId, null);
  assert.equal(carrier.alive, false);
});

test('running the clock down on an unplanted round hands it to the defence', () => {
  const match = newMatch();
  startRound(match);
  match.fastForward(COMP_ROUND_SECONDS + 0.5);
  assert.equal(match.phase, 'roundEnd');
  assert.equal(match.lastRound.winner, 'bravo');
  assert.equal(match.lastRound.reason, 'time');
});

test('the fuse detonates for the attacking side', () => {
  const match = newMatch();
  startRound(match);
  match.holdAction(match.bombCarrier().id, 'plant', COMP_PLANT_SECONDS + 0.05, { site: 'A', bombDist: 0 });
  match.fastForward(COMP_BOMB_FUSE - 2);
  assert.ok(Math.abs(match.bomb.fuse - 2) < 0.05, 'the fuse is burning down');
  assert.equal(match.phase, 'live');
  match.fastForward(2.5);
  assert.equal(match.lastRound.winner, 'alpha');
  assert.equal(match.lastRound.reason, 'detonation');
  assert.equal(match.bomb.state, 'detonated');
});

test('wiping the attackers before a plant ends the round for the defence', () => {
  const match = newMatch();
  startRound(match);
  wipe(match, 'alpha');
  match.fastForward(0.05);
  assert.equal(match.lastRound.winner, 'bravo');
  assert.equal(match.lastRound.reason, 'elimination');
});

test('halftime swaps sides and resets the economy at round seven', () => {
  const match = newMatch();
  startRound(match);
  for (let i = 0; i < COMP_HALFTIME_ROUNDS; i++) {
    if (match.phase === 'buy') match.fastForward(COMP_BUY_SECONDS + 0.05);
    wipe(match, 'bravo');
    match.fastForward(0.05);
    match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
  }
  assert.equal(match.round, COMP_HALFTIME_ROUNDS + 1);
  assert.deepEqual(match.side, { alpha: 'defend', bravo: 'attack' }, 'sides swap at the half');
  for (const c of match.combatants) {
    assert.equal(c.money, COMP_START_MONEY, 'the half resets every wallet');
    assert.equal(c.armor, 0);
    assert.equal(c.primary, null);
  }
  assert.equal(match.isAttacker(match.bomb.carrierId), true, 'the charge follows the attacking side');
  assert.equal(match.sideOfId(match.bomb.carrierId), 'attack');
});

test('match point ends the match at seven rounds', () => {
  const match = newMatch();
  startRound(match);
  for (let i = 0; i < 7; i++) {
    wipe(match, 'bravo');
    match.fastForward(0.05);
    if (match.phase === 'roundEnd') match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
    if (match.phase === 'buy') match.fastForward(COMP_BUY_SECONDS + 0.05);
  }
  assert.equal(match.score.alpha, 7);
  assert.equal(match.phase, 'matchEnd');
  assert.equal(match.winner, 'alpha');
  assert.equal(match.draw, false);
  const events = match.drain();
  assert.ok(events.some(e => e.type === 'match-end' && e.winner === 'alpha'));
});

test('six-six goes to overtime with a full economy and needs a two round lead', () => {
  const match = newMatch();
  startRound(match);
  const win = team => {
    if (match.phase === 'buy') match.fastForward(COMP_BUY_SECONDS + 0.05);
    wipe(match, otherTeam(team));
    match.fastForward(0.05);
    if (match.phase === 'roundEnd') match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
  };
  for (let i = 0; i < 6; i++) win('alpha');
  for (let i = 0; i < 6; i++) win('bravo');
  assert.equal(match.score.alpha, 6);
  assert.equal(match.score.bravo, 6);
  assert.equal(match.overtime, true, 'six-all triggers overtime');
  assert.equal(match.round, 13);
  for (const c of match.combatants) assert.equal(c.money, COMP_OVERTIME_START_MONEY, 'overtime funds a full buy');

  win('alpha');
  assert.equal(match.phase, 'buy', 'a single overtime round is not enough');
  win('alpha');
  assert.equal(match.phase, 'matchEnd');
  assert.equal(match.winner, 'alpha');
});

test('an overtime that cannot be broken ends as a draw', () => {
  const match = newMatch();
  startRound(match);
  const win = team => {
    wipe(match, otherTeam(team));
    match.fastForward(0.05);
    if (match.phase === 'roundEnd') match.fastForward(COMP_ROUND_END_SECONDS + 0.05);
    if (match.phase === 'buy') match.fastForward(COMP_BUY_SECONDS + 0.05);
  };
  for (let i = 0; i < 6; i++) win('alpha');
  for (let i = 0; i < 6; i++) win('bravo');
  for (let i = 0; i < 6; i++) win(i % 2 === 0 ? 'alpha' : 'bravo');
  assert.equal(match.phase, 'matchEnd');
  assert.equal(match.draw, true);
  assert.equal(match.winner, null);
  assert.deepEqual(match.score, { alpha: 9, bravo: 9 });
});

test('planting and defusing pay their teams and the round MVP earns the star', () => {
  const match = newMatch();
  startRound(match);
  const carrier = match.bombCarrier();
  const before = match.roster('alpha').map(c => c.money);
  match.holdAction(carrier.id, 'plant', COMP_PLANT_SECONDS + 0.05, { site: 'A', bombDist: 0 });
  match.roster('alpha').forEach((c, i) => assert.equal(c.money, before[i] + COMP_PLANT_REWARD, 'the plant pays the whole squad'));

  wipe(match, 'alpha');
  const defenders = match.roster('bravo');
  const defender = defenders[0];
  const defMoney = defender.money;
  match.holdAction(defender.id, 'defuse', COMP_DEFUSE_SECONDS + 0.05, { site: null, bombDist: 1 });
  assert.equal(defender.money, defMoney + COMP_DEFUSE_REWARD);
  assert.equal(match.lastRound.winner, 'bravo');
  assert.equal(defender.defuses, 1);
  assert.equal(match.roster('bravo').some(c => c.mvps > 0), true, 'somebody on the winning side is the round MVP');
});

test('kill rewards follow the weapon family and the killer is paid', () => {
  assert.equal(killReward('SMG'), 600);
  assert.equal(killReward('SG'), 900);
  assert.equal(killReward('SR'), 100);
  assert.equal(killReward('AR'), 300);
  assert.equal(killReward('PISTOL'), 300);
  assert.equal(killReward('GEAR'), 300);
  const match = newMatch();
  startRound(match);
  const killer = match.roster('alpha')[0];
  const victim = match.roster('bravo')[0];
  const before = killer.money;
  match.notifyKill(killer.id, victim.id, 'ak47', true);
  assert.equal(killer.money, before + 300);
  assert.equal(killer.kills, 1);
  assert.equal(killer.headshots, 1);
  assert.equal(victim.deaths, 1);
  assert.equal(victim.alive, false);
});

test('a kill on an already-dead operator cannot be double counted', () => {
  const match = newMatch();
  startRound(match);
  const victim = match.roster('bravo')[0];
  match.notifyKill('a0', victim.id, 'm4a1', false);
  match.notifyKill('a1', victim.id, 'm4a1', false);
  assert.equal(victim.deaths, 1);
  assert.equal(match.of('a1').kills, 0);
});

test('competitive armor absorbs body rounds, wears out, and stops protecting once broken', () => {
  const unarmored = applyCompetitiveDamage(100, 0, false, 40, false);
  assert.equal(unarmored.taken, 40);
  const armored = applyCompetitiveDamage(100, 100, false, 40, false);
  assert.ok(armored.taken < 40 && armored.taken > 15, `armor must matter, got ${armored.taken}`);
  assert.ok(armored.armor < 100, 'the plate wears');
  const broken = applyCompetitiveDamage(100, 1, false, 40, false);
  assert.ok(Math.abs(broken.taken - 40) < 6, 'a destroyed plate stops helping');
  const helmet = applyCompetitiveDamage(100, 100, true, 80, true);
  const bareHead = applyCompetitiveDamage(100, 100, false, 80, true);
  assert.ok(helmet.taken < bareHead.taken, 'a helmet saves your head');
  const pierced = applyCompetitiveDamage(100, 100, true, 115, false, true);
  assert.ok(pierced.taken > 90, 'armor piercing rounds ignore most of the plate');
  assert.equal(applyCompetitiveDamage(30, 0, false, 50, false).hp, 0, 'hp never goes below zero');
});

test('bomb sites are circles on the ground, and the two halls are symmetric', () => {
  assert.equal(siteAt(COMP_SITES.A.x, COMP_SITES.A.z), 'A');
  assert.equal(siteAt(COMP_SITES.B.x, COMP_SITES.B.z), 'B');
  assert.equal(siteAt(0, 0), null, 'mid is not a site');
  assert.equal(siteAt(COMP_SITES.A.x + COMP_SITES.A.radius + 0.5, 0), null);
  assert.equal(siteAt(COMP_SITES.A.x, COMP_SITES.A.z) === 'A' && siteAt(COMP_SITES.B.x, COMP_SITES.B.z) === 'B', true);
  assert.equal(Math.abs(COMP_SITES.A.x), Math.abs(COMP_SITES.B.x), 'neither hall is closer to the middle');
});

test('side helpers are involutions', () => {
  assert.equal(otherTeam('alpha'), 'bravo');
  assert.equal(otherTeam('bravo'), 'alpha');
  assert.equal(otherSide('attack'), 'defend');
  assert.equal(otherSide('defend'), 'attack');
});

test('purchase options expose affordability and legality without mutating state', () => {
  const match = newMatch();
  match.startMatch();
  const attacker = match.combatants.find(c => match.isAttacker(c.id));
  attacker.money = 500;
  const options = match.purchaseOptions(attacker.id);
  const kit = options.find(o => o.item.id === 'g_kit');
  const defenderOptions = match.purchaseOptions(match.combatants.find(c => !match.isAttacker(c.id)).id);
  const defenderKit = defenderOptions.find(o => o.item.id === 'g_kit');
  const mp7 = options.find(o => o.item.id === 'w_mp7');
  assert.equal(kit, undefined, 'attackers are never offered a defuse kit');
  assert.equal(defenderKit.legal, true, 'defenders are offered the kit');
  assert.equal(mp7.affordable, false, 'a $1,250 SMG is out of reach on $500');
  assert.equal(options.find(o => o.item.id === 'g_flash').affordable, true);
  assert.equal(attacker.money, 500, 'previewing never spends');
  assert.ok(options.length >= 10);
});

// ------------------------------------------------------------------ ladder ---
test('rank tiers cover the whole ladder without gaps or overlaps', () => {
  let cursor = rank.RATING_FLOOR;
  for (const tier of rank.RANK_TIERS) {
    assert.equal(tier.min, cursor, `${tier.id} must start where the previous tier ended`);
    assert.ok(tier.max >= tier.min);
    cursor = tier.max + 1;
  }
  assert.equal(cursor, rank.RATING_CEILING + 1);
});

test('rank badges read III → I inside a tier and promote cleanly', () => {
  const low = rank.rankFor(0);
  assert.equal(low.tier.id, 'bronze');
  assert.equal(low.label, 'BRONZE III');
  const high = rank.rankFor(599);
  assert.equal(high.label, 'BRONZE I');
  assert.equal(rank.rankFor(600).label, 'SILVER III');
  assert.equal(rank.rankFor(1099).label, 'SILVER I');
  assert.equal(rank.rankFor(1000).tier.id, 'silver');
  assert.equal(rank.rankFor(3200).label, 'GRANDMASTER');
  assert.equal(rank.rankFor(99_999).rating, undefined, 'over-ceiling input is clamped, not extrapolated');
  assert.equal(rank.rankFor(-50).tier.id, 'bronze');
});

test('rating moves with the result, the margin and personal impact', () => {
  const base = { ...rank.DEFAULT_RANKED, placements: rank.PLACEMENT_MATCHES };
  const narrow = rank.ratingDelta({ win: true, draw: false, roundsFor: 7, roundsAgainst: 6, kills: 14, deaths: 14, headshots: 4, plants: 0, defuses: 0, mvp: 0, current: base });
  const sweep = rank.ratingDelta({ win: true, draw: false, roundsFor: 7, roundsAgainst: 0, kills: 20, deaths: 3, headshots: 9, plants: 2, defuses: 0, mvp: 3, current: base });
  const loss = rank.ratingDelta({ win: false, draw: false, roundsFor: 2, roundsAgainst: 7, kills: 5, deaths: 16, headshots: 1, plants: 0, defuses: 0, mvp: 0, current: base });
  assert.ok(narrow.delta > 0 && narrow.delta <= 42);
  assert.ok(sweep.delta > narrow.delta, 'a dominant win is worth more than a scrape');
  assert.ok(loss.delta < 0);
  assert.equal(sweep.next.rating, base.rating + sweep.delta);
  assert.equal(sweep.next.wins, 1);
  assert.equal(loss.next.losses, 1);
  assert.equal(loss.next.streak, -1);
  assert.equal(sweep.next.streak, 1);
});

test('placement matches swing harder and the rating can never go negative', () => {
  const rookie = { ...rank.DEFAULT_RANKED, rating: 1000, placements: 0 };
  const placed = { ...rookie, placements: rank.PLACEMENT_MATCHES };
  const input = { win: false, draw: false, roundsFor: 1, roundsAgainst: 7, kills: 1, deaths: 15, headshots: 0, plants: 0, defuses: 0, mvp: 0 };
  const a = rank.ratingDelta({ ...input, current: rookie });
  const b = rank.ratingDelta({ ...input, current: placed });
  assert.equal(a.placements, true);
  assert.equal(b.placements, false);
  assert.ok(Math.abs(a.delta) > Math.abs(b.delta), 'placements calibrate fast');
  assert.equal(a.next.placements, 1);
  assert.equal(a.next.matches, 1);
  const bottom = rank.ratingDelta({ ...input, current: { ...placed, rating: 10 } });
  assert.equal(bottom.next.rating, 0, 'rating floors at zero');
  const capped = rank.ratingDelta({ ...input, current: { ...placed, placements: 0, rating: 5 } });
  assert.equal(capped.next.rating, 0, 'a placement loss cannot go below zero either');
});

test('a draw holds the rating and counts as half a win', () => {
  const profile = { ...rank.DEFAULT_RANKED, ratings: 0, placements: rank.PLACEMENT_MATCHES, wins: 3, losses: 3, draws: 0, matches: 6 };
  const result = rank.ratingDelta({ win: false, draw: true, roundsFor: 6, roundsAgainst: 6, kills: 10, deaths: 10, headshots: 3, plants: 1, defuses: 0, mvp: 0, current: profile });
  assert.equal(result.breakdown.outcome, 0);
  assert.equal(result.next.draws, 1);
  assert.equal(result.next.streak, 0, 'a draw neither extends nor breaks a streak');
  assert.equal(rank.winRate({ ...rank.DEFAULT_RANKED, wins: 3, losses: 3, draws: 0 }), 50);
});

// ------------------------------------------------------------- bot shopping ---
test('the squad buys together: rich teams full-buy, broke teams save', () => {
  const full = buy.botBuyPlan({ team: 'alpha', side: 'attack', teamMoney: 4200, lossStreak: 0 });
  const force = buy.botBuyPlan({ team: 'alpha', side: 'attack', teamMoney: 2600, lossStreak: 0 });
  const eco = buy.botBuyPlan({ team: 'alpha', side: 'attack', teamMoney: 1500, lossStreak: 1 });
  assert.equal(full, 'full');
  assert.equal(force, 'force');
  assert.equal(eco, 'eco');
  assert.equal(buy.botBuyPlan({ team: 'alpha', side: 'defend', teamMoney: 900, lossStreak: 0 }), 'eco');
});

test('a full buy is a rifle and a helmet; an eco round never buys a rifle', () => {
  const rich = buy.botWishlist({ plan: 'full', money: 5000, side: 'defend', hasPrimary: false, hasKit: true, armor: 0, helmet: false, frags: 0, flashes: 0, roll: 0.5 });
  assert.ok(rich.some(id => buy.buyItemById(id).slot === 'primary'), 'a full buy fields a primary');
  assert.ok(rich.includes('g_helmet'));
  const poor = buy.botWishlist({ plan: 'eco', money: 1400, side: 'attack', hasPrimary: false, hasKit: false, armor: 0, helmet: false, frags: 0, flashes: 0, roll: 0.5 });
  assert.deepEqual(poor, [], 'a true eco buys nothing at all');
  const forced = buy.botWishlist({ plan: 'force', money: 2400, side: 'defend', hasPrimary: false, hasKit: false, armor: 0, helmet: false, frags: 0, flashes: 0, roll: 0.2 });
  assert.ok(forced.some(id => buy.buyItemById(id).weapon), 'force rounds buy what they can');
  assert.ok(!forced.includes('g_helmet'), 'force rounds do not waste money on helmets');
});

test('bots never buy a second primary or a kit they already own', () => {
  const armed = buy.botWishlist({ plan: 'full', money: 6000, side: 'defend', hasPrimary: true, hasKit: true, armor: 100, helmet: true, frags: 2, flashes: 2, roll: 0.5 });
  assert.deepEqual(armed.filter(id => buy.buyItemById(id).slot === 'primary'), []);
  assert.deepEqual(armed.filter(id => id === 'g_kit'), []);
  assert.deepEqual(armed.filter(id => id === 'g_kevlar' || id === 'g_helmet'), []);
});

test('the ranked rack prices every catalog weapon it sells and the starter is free', () => {
  assert.equal(buy.rankedPrice('m1911'), 0);
  assert.equal(buy.buyItemById('w_ak47').price, 2700);
  assert.ok(buy.buyItemById('w_awm').price > buy.buyItemById('w_m4a1').price, 'the AWM is the premium buy');
  for (const item of buy.COMP_BUY_ITEMS) {
    if (item.weapon) assert.ok(item.stat.length > 0, `${item.id} needs a stat line`);
    assert.ok(item.key.length > 0);
  }
  assert.equal(buy.buyItemById('nope'), undefined);
});
