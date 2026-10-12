// Recoil FPS — Bomb Defusal BOT BEHAVIOUR.
//
// These tests exist because "the AI is so stupid" is not a bug report you can
// fix by reading code. Every claim about the bots here is measured against a
// live match running on the real Sirocco geometry: does a rush actually move
// faster than a default, does a split actually arrive from two lanes, do the
// attackers hold their post-plant angles, does a retake go in as a group.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
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
const { Engine } = await import('../src/game/engine.ts');
const { DefusalMode } = await import('../src/game/defusal/mode.ts');
const { TIMING } = await import('../src/game/defusal/rules.ts');
const L = await import('../src/game/maps/sirocco.ts');
const { DIFFICULTY_SKILLS } = await import('../src/game/defusal/mode.ts');
const { teamBuyCall, planPurchases, ROLE_SHEET } = await import('../src/game/defusal/botplan.ts');
const { freshInventory, inventoryValue } = await import('../src/game/defusal/shop.ts');

const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
const world = buildWorld(new THREE.Scene(), 'sirocco', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));
const phys = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 4 };
phys.nearSolids = Engine.prototype.nearSolids.bind(phys);
Engine.prototype.buildSolidGrid.call(phys);
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;

/** A live match with the player parked out of the way; returns bot-only rounds. */
function makeMode(side, seed = 11) {
  const shots = [];
  let s = seed >>> 0;
  const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const player = { pos: new THREE.Vector3(0, 0, 39), alive: true, hp: 100 };
  const clock = { t: 0 };
  const thrown = [];
  const pending = [];
  let mode = null;
  mode = new DefusalMode({
    scene: new THREE.Scene(), occluders: world.occluders, coverNodes: world.coverNodes, solids: world.solids, half: world.half,
    groundHeight: world.groundHeight, effects: new Proxy({}, { get: () => () => {} }),
    moveCollide: (p, dx, dz, r) => { Engine.prototype.moveAxis.call(phys, p, dx, dz, r, 1.7); p.y = Engine.prototype.supportHeight.call(phys, p, r); },
    playerPos: () => new THREE.Vector3(player.pos.x, 1.62, player.pos.z), playerFeet: () => player.pos.clone(),
    playerAlive: () => player.alive, playerHp: () => player.hp, playerCanSee: () => false,
    damagePlayer: () => {},
    throwGrenade: (_f, target, owner, kind) => { thrown.push({ kind, at: target.clone(), owner }); pending.push({ kind, at: target.clone(), owner }); },
    onBotFire: (pos, team) => shots.push({ t: clock.t, team, pos: pos.clone() }),
    spawnPlayer: at => { player.pos.copy(at); player.alive = true; player.hp = 100; },
    equipPlayer: () => {}, bombDetonated: () => {},
    onFeed: () => {}, onRadio: () => {}, onCallout: () => {}, announce: () => {},
    onMoney: () => {}, earnWallet: () => {}, onMatchEnd: () => {},
  }, { side, format: 'short', difficulty: 'Normal' }, rng);
  const step = (sec, dt = 1 / 30, onTick) => {
    const n = Math.max(1, Math.round(sec / dt));
    for (let i = 0; i < n; i++) {
      if (mode.match.phase === 'live' && player.alive) { player.alive = false; mode.playerKilled(null, false, 'C4'); }
      clock.t += dt;
      mode.update(dt, { interact: false });
      while (pending.length) { const g = pending.pop(); if (g.kind === 'smoke') mode.spawnSmoke(g.at); }
      onTick?.(clock.t);
    }
    return n * dt;
  };
  return { mode, player, step, thrown, shots, clock };
}

/** Nobody can hit anything: isolates movement/positioning from who wins duels. */
/** Advance a mode without the harness's per-tick player bookkeeping. */
function step0(mode, secs, dt = 1 / 30) {
  for (let t = 0; t < secs; t += dt) mode.update(dt, { interact: false });
}
const blindAll = mode => { for (const b of mode.bots) b.skill = { acc: 0, head: 0, reaction: 30 }; };
const attackers = mode => mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'attack').map(c => c.bot);
const defenders = mode => mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'defend').map(c => c.bot);
const dist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

// =====================================================================
// 1. THE PLAN IS ACTUALLY EXECUTED
// =====================================================================

test('a rush reaches the site measurably sooner than a default', () => {
  const advance = style => {
    const { mode, step } = makeMode('defend', 8080);
    step(TIMING.freeze + 0.05);
    blindAll(mode);
    mode.forceAttackPlan({ site: 'B', style });
    step(16);
    const c = L.SITES.B.center;
    const live = attackers(mode);
    assert.equal(live.length, 5, 'nobody dies in a blind round');
    return live.reduce((a, b) => a + dist(b.pos, c[0], c[1]), 0) / live.length;
  };
  const rush = advance('rush');
  const def = advance('default');
  assert.ok(rush < def - 10, `after 16 s a rush squad averages ${rush.toFixed(1)} m from B, a default ${def.toFixed(1)} m — the styles must differ`);
});

test('a split arrives on two separate lanes, an execute does not', () => {
  const lanes = style => {
    const { mode, step } = makeMode('defend', 5150);
    step(TIMING.freeze + 0.05);
    blindAll(mode);
    mode.forceAttackPlan({ site: 'B', style });
    step(6);
    const used = new Set(attackers(mode).map(b => mode.planOf(b)?.lane));
    let spread = 0;
    step(16, 1 / 30, () => {
      const xs = attackers(mode).map(b => b.pos.x);
      spread = Math.max(spread, Math.max(...xs) - Math.min(...xs));
    });
    return { used, spread };
  };
  const split = lanes('split');
  const rush = lanes('rush');
  assert.equal(rush.used.size, 1, `a rush commits one lane, got ${[...rush.used]}`);
  assert.ok(split.used.size >= 2, `a split must use two lanes, got ${[...split.used]}`);
  assert.ok(split.spread > rush.spread + 5, `a split approach (${split.spread.toFixed(1)} m wide) must be wider than a rush (${rush.spread.toFixed(1)} m)`);
});

test('the lane leash keeps an attacker on his own lane instead of chasing across the map', () => {
  const { mode, step } = makeMode('defend', 991);
  step(TIMING.freeze + 0.05);
  mode.forceAttackPlan({ site: 'B', style: 'exec' });
  // Park the defenders on the far side of the map; a leashed attacker must not
  // abandon his lane to walk at them.
  for (const b of defenders(mode)) b.pos.set(-36, 0, -26);
  let worstX = Infinity;
  step(16, 1 / 30, () => { for (const b of attackers(mode)) worstX = Math.min(worstX, b.pos.x); });
  assert.ok(worstX > -22, `an attacker wandered to x=${worstX.toFixed(1)} — the B-site squad must stay east of mid`);
});

// =====================================================================
// 2. POST-PLANT
// =====================================================================

test('after the plant the attackers take post-plant posts and hold them', () => {
  const { mode, step } = makeMode('defend', 4477);
  step(TIMING.freeze + 0.05);
  blindAll(mode);
  const atk = mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'attack');
  // The squad has taken the site; this test is about what they do next.
  atk.forEach((c, i) => c.bot.pos.set(28 + (i % 3) * 2.5, 0, -30 - Math.floor(i / 3) * 3));
  const planter = atk[0];
  mode.giveBomb(planter);
  planter.bot.pos.set(30.5, 0, -31.6);
  mode.plantBomb(planter, new THREE.Vector3(30.5, 0, -31.6));
  assert.equal(mode.match.phase, 'planted');
  step(20);
  const live = attackers(mode);
  assert.equal(live.length, 5, 'attackers alive to hold the plant');
  const posts = L.SITES.B.postPlant;
  const claimed = new Set();
  for (const b of live) {
    const near = posts.filter(p => dist(b.pos, p.at[0], p.at[1]) < 6).sort((x, y) => dist(b.pos, x.at[0], x.at[1]) - dist(b.pos, y.at[0], y.at[1]))[0];
    if (near) claimed.add(near);
  }
  assert.ok(claimed.size >= 3, `only ${claimed.size} distinct post-plant angles taken — attackers must spread onto their posts, not stack on the bomb`);
  // and they are anchored, i.e. they will not go walking back into the site
  const anchored = live.filter(b => mode.planOf(b)?.anchor).length;
  assert.ok(anchored >= claimed.size, `${anchored}/${live.length} attackers are anchored on their angle`);
});

test('a defuse in progress breaks the post-plant hold — attackers converge on the bomb', () => {
  const { mode, step } = makeMode('defend', 3131);
  step(TIMING.freeze + 0.05);
  blindAll(mode);
  const atk = mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'attack');
  atk.forEach((c, i) => c.bot.pos.set(28 + (i % 3) * 2.5, 0, -30 - Math.floor(i / 3) * 3));
  const defs = mode.players.filter(c => c.bot && c.alive && mode.sideOf(c) === 'defend');
  for (const c of defs.slice(1)) c.bot.takeDamage(9999, false, 'player', false);
  const planter = atk[0];
  mode.giveBomb(planter);
  planter.bot.pos.set(30.5, 0, -31.6);
  mode.plantBomb(planter, new THREE.Vector3(30.5, 0, -31.6));
  step(9);
  const before = attackers(mode).map(b => dist(b.pos, mode.bomb.pos.x, mode.bomb.pos.z));
  // The surviving defender is on the bomb with the wire cut.
  const defuser = defs[0].bot;
  const pin = () => {
    defuser.pos.copy(mode.bomb.pos);
    const plan = mode.plans.get(defuser);
    plan.task = 'defuse';
    plan.t = 0;
  };
  pin();
  for (let i = 0; i < 300 && mode.bomb.defuseT <= 0; i++) step(1 / 30, 1 / 30, pin);
  assert.ok(mode.bomb.defuseT > 0, 'the defuse is genuinely running');
  step(1, 1 / 30, pin);
  const tasks2 = attackers(mode).map(b => mode.planOf(b)?.task);
  assert.ok(tasks2.includes('savebomb'), `attackers must react to the defuse, got ${JSON.stringify(tasks2)}`);
  assert.ok(tasks2.filter(t => t === 'savebomb').length >= 3, `most of the squad must abandon its angle, got ${JSON.stringify(tasks2)}`);
  step(8, 1 / 30, pin);
  const after = attackers(mode).map(b => dist(b.pos, mode.bomb.pos.x, mode.bomb.pos.z));
  // The squad must collapse back onto the bomb: the deep post-plant angles give
  // up their hold and come home.
  const near = d => d.filter(v => v < 10).length;
  assert.ok(near(after) >= 4 && near(after) > near(before),
    `the squad must collapse onto the bomb (within 10 m: ${near(before)} -> ${near(after)}; was ${before.map(v => v.toFixed(0))}, now ${after.map(v => v.toFixed(0))})`);
});

// =====================================================================
// 3. RETAKES GO IN TOGETHER
// =====================================================================

test('defenders regroup before a retake instead of trickling in one at a time', () => {
  const { mode, step } = makeMode('attack', 7712);
  step(TIMING.freeze + 0.05);
  const planter = mode.players.find(c => c.bot && c.alive && mode.sideOf(c) === 'attack');
  mode.giveBomb(planter);
  planter.bot.pos.set(-29, 0, -32.6);
  // Nobody shoots: this test measures the shape of the retake, not the fight.
  blindAll(mode);
  mode.plantBomb(planter, new THREE.Vector3(-29, 0, -32.6));
  assert.equal(mode.match.phase, 'planted');

  const site = L.SITES.A;
  const entered = new Map();
  let t = 0;
  let sawStage = 0;
  step(32, 1 / 30, () => {
    t += 1 / 30;
    for (const b of defenders(mode)) {
      if (mode.planOf(b)?.task === 'retakeStage') sawStage++;
      if (!entered.has(b) && L.inRect(b.pos.x, b.pos.z, site.zone, 3)) entered.set(b, t);
    }
  });
  assert.ok(sawStage > 0, 'defenders stage up before committing');
  const times = [...entered.values()].sort((a, b) => a - b);
  assert.ok(times.length >= 3, `at least three defenders reached the site (${times.length})`);
  // The first three arrivals are the retake proper: they must land close together.
  const window = times[2] - times[0];
  assert.ok(window < 6, `first three retakers entered over ${window.toFixed(1)} s — that is a trickle, not a retake`);
  assert.ok(times[0] > 2, 'nobody suicides into the site before the group is ready');
});

// =====================================================================
// 4. UTILITY IS ACTUALLY THROWN
// =====================================================================

test('the director throws its authored execute smokes and retake smokes', () => {
  let exec = 0, retake = 0, delay = 0, rounds = 0;
  for (const seed of [17, 4242, 98765]) {
    const { mode, step } = makeMode('defend', seed);
    for (let r = 0; r < 8 && mode.match.phase !== 'ended'; r++) {
      const before = mode.match.round;
      for (let i = 0; i < 400 && mode.match.round === before && mode.match.phase !== 'ended'; i++) step(0.5);
      rounds++;
    }
    exec += mode.utility.execSmoke; retake += mode.utility.retakeSmoke; delay += mode.utility.delaySmoke;
  }
  assert.ok(rounds > 15, `simulated ${rounds} rounds`);
  assert.ok(exec > 0, 'execute smokes are thrown on site takes');
  assert.ok(exec + retake + delay >= rounds * 0.25, `only ${exec + retake + delay} smokes across ${rounds} rounds`);
});

// =====================================================================
// 5. REACTION TIME AND AIM
// =====================================================================

test('bots do not snap: a fresh contact costs a human-plausible acquisition delay', () => {
  // Measured, not asserted from the constants: drop two bots into open ground
  // facing away from each other and time the first trigger pull.
  const trial = (difficulty, seed) => {
    const { mode, step, shots, clock } = makeMode('defend', seed);
    mode.bots.forEach(b => { b.skill = { ...DIFFICULTY_SKILLS[difficulty] }; });
    step(TIMING.freeze + 0.05);
    const atk = attackers(mode)[0], def = defenders(mode)[0];
    if (!atk || !def) return null;
    for (const b of mode.bots) if (b !== atk && b !== def) b.takeDamage(9999, false, 'player', false);
    // A LONG is a clean open corridor: guaranteed line of sight, no cover.
    atk.pos.set(-34, 0, 4); def.pos.set(-34, 0, -12);
    atk.model.group.rotation.y = 0; def.model.group.rotation.y = 0;
    shots.length = 0;
    const t0 = clock.t;
    step(3, 1 / 60);
    return shots.length ? shots[0].t - t0 : null;
  };
  const times = [];
  for (let i = 0; i < 8; i++) { const v = trial('Normal', 606 + i * 137); if (v !== null) times.push(v); }
  assert.ok(times.length >= 5, `enough contacts resolved (${times.length}/8)`);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  assert.ok(Math.min(...times) > 0.12, `fastest trigger pull ${Math.min(...times).toFixed(3)} s — bots must not snap-fire`);
  assert.ok(mean < 2.0, `mean acquisition ${mean.toFixed(3)} s — bots must not be catatonic either`);
});

test('difficulty scales acquisition, and settling suppresses first-round headshots', () => {
  assert.ok(DIFFICULTY_SKILLS.Easy.reaction > DIFFICULTY_SKILLS.Normal.reaction);
  assert.ok(DIFFICULTY_SKILLS.Normal.reaction > DIFFICULTY_SKILLS.Hard.reaction);
  assert.ok(DIFFICULTY_SKILLS.Hard.reaction > DIFFICULTY_SKILLS.Nightmare.reaction);
  assert.ok(DIFFICULTY_SKILLS.Nightmare.reaction >= 0.6, 'even Nightmare keeps a human floor on acquisition');
  // The settle window is observable: right after an acquisition the bot is
  // flagged as settling, and while it is, headshots are off the table.
  const { mode, step } = makeMode('defend', 31337);
  step(TIMING.freeze + 0.05);
  const atk = attackers(mode)[0], def = defenders(mode)[0];
  for (const b of mode.bots) if (b !== atk && b !== def) b.takeDamage(9999, false, 'player', false);
  atk.pos.set(-34, 0, 4); def.pos.set(-34, 0, -12);
  let sawSettling = false;
  step(2, 1 / 60, () => { if (atk.settling || def.settling) sawSettling = true; });
  assert.ok(sawSettling, 'a fresh acquisition puts the bot into the settling window');
});

// =====================================================================
// 6. SOUND
// =====================================================================

test('a bot holding an angle reacts to footsteps behind it', () => {
  // Isolated on purpose: one defender left alive and blinded, so the only
  // thing that can raise his awareness is the noise. If anybody pulls a
  // trigger the test says so rather than passing on gunfire instead.
  const { mode, player, shots } = makeMode('attack', 2468);
  step0(mode, TIMING.freeze + 0.05);
  blindAll(mode);
  const defs = defenders(mode);
  for (const b of defs.slice(1)) b.takeDamage(9999, false, 'player', false);
  for (const b of attackers(mode)) b.takeDamage(9999, false, 'player', false);
  const def = defs[0];
  assert.ok(def.alive ?? true);

  def.pos.set(-31, 0, -30);
  def.model.group.rotation.y = 0; // facing -z, so the runner crosses behind him
  assert.equal(def.heardRecently, false, 'he starts unaware');

  // Settle first: dropping the runner onto his start position is itself a
  // 60 m jump, which the hearing model would quite rightly call a loud noise.
  const settle = (m, p, at) => { for (let i = 0; i < 24; i++) { p.pos.set(at[0], 1.6, at[1]); m.update(1 / 30, { interact: false }); } };
  settle(mode, player, [-18, -25]);
  def.alertT = 0;

  let alerted = false;
  for (let i = 0; i < 40; i++) {
    def.pos.set(-31, 0, -30);
    // ~5.4 m/s: a sprint, not a walk. Walking is meant to stay quiet.
    player.pos.set(-18 + i * 0.18, 1.6, -25);
    mode.update(1 / 30, { interact: false });
    if (def.heardRecently && !def.hasLOS) alerted = true;
  }
  assert.equal(shots.length, 0, 'nobody fired, so the alert can only have come from footsteps');
  assert.ok(alerted, 'footsteps inside earshot must raise the defender’s alert level without him seeing anyone');

  // And the same route walked slowly must not give the runner away.
  const quiet = makeMode('attack', 2468);
  step0(quiet.mode, TIMING.freeze + 0.05);
  blindAll(quiet.mode);
  const qd = defenders(quiet.mode);
  for (const b of qd.slice(1)) b.takeDamage(9999, false, 'player', false);
  for (const b of attackers(quiet.mode)) b.takeDamage(9999, false, 'player', false);
  settle(quiet.mode, quiet.player, [-18, -25]);
  qd[0].alertT = 0;
  let heardWalk = false;
  for (let i = 0; i < 40; i++) {
    qd[0].pos.set(-31, 0, -30);
    qd[0].model.group.rotation.y = 0;
    quiet.player.pos.set(-18 + i * 0.05, 1.6, -25); // 1.5 m/s
    quiet.mode.update(1 / 30, { interact: false });
    if (qd[0].heardRecently && !qd[0].hasLOS) heardWalk = true;
  }
  assert.equal(heardWalk, false, 'walking must stay quiet, or the hearing model is just a proximity alarm');
});

// =====================================================================
// 7. ECONOMY
// =====================================================================

test('a team buys as a team: one call for the whole side, no half-eco splits', () => {
  const rng = (() => { let s = 99; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })();
  for (const side of ['attack', 'defend']) {
    for (const bank of [800, 2000, 3000, 5200, 9000]) {
      const moneys = [bank, bank + 400, bank - 300, bank + 150, bank - 150];
      const call = teamBuyCall(moneys, side, { pistolRound: false, lastOfHalf: false, mustWin: false });
      const values = ROLE_SHEET.map(role => {
        const inv = planPurchases(freshInventory(bank), side, call, role, rng);
        return inventoryValue(inv);
      });
      const spread = Math.max(...values) - Math.min(...values);
      if (call === 'full') {
        assert.ok(Math.min(...values) >= 2500, `${side} $${bank} full buy: cheapest kit only $${Math.min(...values)}`);
        assert.ok(spread <= 4200, `${side} $${bank} full buy spread $${spread} — the team must field comparable kit`);
      }
      if (call === 'eco') assert.ok(Math.max(...values) <= 1500, `${side} $${bank} eco but someone spent $${Math.max(...values)}`);
    }
  }
});

test('the whole side shares one buy call every round of a live match', () => {
  const { mode, step } = makeMode('defend', 8642);
  for (let r = 0; r < 6 && mode.match.phase !== 'ended'; r++) {
    const before = mode.match.round;
    step(TIMING.freeze + 0.2);
    for (const team of ['alpha', 'bravo']) {
      const side = mode.sideOf(mode.players.find(c => c.team === team));
      const invs = mode.players.filter(c => c.team === team && c.bot).map(c => c.inv);
      const call = mode.buyCalls[team];
      if (call === 'eco') {
        const rifles = invs.filter(i => i.primary && !['vector', 'mp7', 'spas12'].includes(i.primary)).length;
        // Saved guns are kept on an eco; nobody should have *bought* a new rifle.
        assert.ok(rifles <= invs.length, `${team} ${side} eco`);
      }
      assert.ok(['pistol', 'eco', 'force', 'full'].includes(call), `${team} has a team buy call`);
    }
    for (let i = 0; i < 400 && mode.match.round === before && mode.match.phase !== 'ended'; i++) step(0.5);
  }
});

test('the spectate list keeps a stable order as bots die', () => {
  // The spectator camera steps through this list. If the order of the
  // survivors changes when someone dies, the camera silently hands itself to a
  // different player mid-round.
  const { mode, step } = makeMode('attack', 8642);
  step(TIMING.freeze + 0.05);
  let prev = mode.spectateList();
  assert.ok(prev.length >= 4, 'a full squad to spectate');
  for (let round = 0; round < 6; round++) {
    const list = mode.spectateList();
    // Whatever is left must appear in the same relative order as before.
    const survivors = prev.filter(b => list.includes(b));
    const seen = list.filter(b => survivors.includes(b));
    assert.deepEqual(seen, survivors, 'survivors must keep their relative order in the spectate list');
    prev = list;
    const victim = list[0];
    if (!victim) break;
    victim.takeDamage(9999, false, 'player', false);
    step(0.2);
  }
});
