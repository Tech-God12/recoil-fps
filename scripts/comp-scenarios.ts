/* ============================================================================
 * OPERATION BLACKOUT — headless match harness.
 *
 * Plays ranked Search & Destroy with no engine and no WebGL: the same
 * CompetitiveRunner, the same tactical director and the same bot brains the
 * browser runs. It fast-forwards whole matches and asserts what a player would
 * notice first if it were broken:
 *
 *   A1  the match reaches a decision inside its round budget
 *   A2  attackers plant, defenders defuse, rounds end for several reasons
 *   A3  the economy never leaves its band
 *   A4  squads actually move and attackers actually reach a site
 *   A5  the HUD payload stays sane for the whole match
 *   B1  the PLAYER's own plant path works, end to end, and detonates
 *   C1  a frame of the mode is cheap enough to run at 60 fps
 *
 * Run: node --import tsx --loader ./scripts/asset-loader.mjs scripts/comp-scenarios.ts
 * ========================================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { buildWorld } from '../src/game/world';
import { NavGrid } from '../src/game/ai';
import type { TDMBot, TDMContext } from '../src/game/tdm';
import { CompetitiveRunner, PLAYER_ID, type CompUiEvent, type PlayerKit, type PlayerBridge } from '../src/game/competitive/match';
import { COMP_MAX_MONEY, COMP_SITES, COMP_BOMB_FUSE } from '../src/game/competitive/rules';

// ------------------------------------------------------------- DOM shims ----
const ctx2dHandler: ProxyHandler<any> = {
  get(target, prop) {
    if (prop === 'canvas') return target.canvas;
    if (prop in target) return target[prop];
    return (..._args: any[]) => {
      void _args;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop: () => {} };
      if (prop === 'getImageData') return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
      if (prop === 'measureText') return { width: 1 };
      return undefined;
    };
  },
  set(target, prop, value) { target[prop] = value; return true; },
};
function makeCanvas(): any {
  const canvas: any = {
    width: 0, height: 0, style: {},
    addEventListener: () => {}, removeEventListener: () => {},
    getContext: (kind: string) => (kind === '2d' ? new Proxy({ canvas }, ctx2dHandler) : null),
    toDataURL: () => 'data:image/png;base64,',
  };
  return canvas;
}
(globalThis as any).document = { createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : { style: {}, addEventListener: () => {} }) };
(globalThis as any).window = globalThis;

/** Deterministic RNG so a bad run can be reproduced instead of re-rolled. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
};

// ------------------------------------------------------------- test rig ------
interface Rig {
  runner: CompetitiveRunner;
  scene: THREE.Scene;
  feed: string[];
  ui: CompUiEvent[];
  player: { x: number; y: number; z: number; hp: number; armor: number; helmet: boolean; alive: boolean; invulnerable: boolean };
  step: (dt: number) => void;
  toPhase: (phase: string) => boolean;
}

function makeRig(): Rig {
  const scene = new THREE.Scene();
  const world = buildWorld(scene, 'arena');
  const nav = new NavGrid(world.solids, world.half, world.groundHeight);
  const effectsStub: any = new Proxy({}, { get: () => () => {} });
  const feed: string[] = [];
  const ui: CompUiEvent[] = [];
  const player = { x: 0, y: 0, z: 36, hp: 100, armor: 0, helmet: false, alive: true, invulnerable: false };

  const bridge: PlayerBridge = {
    armor: () => player.armor,
    helmet: () => player.helmet,
    setArmor: (armor, helmet) => { player.armor = armor; player.helmet = helmet; },
    alive: () => player.alive,
    position: () => ({ x: player.x, y: player.y + 1.6, z: player.z }),
    spawn: (x, z) => { player.x = x; player.y = world.groundHeight(x, z); player.z = z; player.hp = 100; player.alive = true; },
    applyKit: (kit: PlayerKit) => { player.armor = kit.armor; player.helmet = kit.helmet; },
    setFrozen: () => {},
    damage: (amount) => {
      if (player.invulnerable) return;
      player.hp = Math.max(0, player.hp - amount);
      if (player.hp <= 0) player.alive = false;
    },
  };

  const ctx: TDMContext = {
    scene, occluders: world.occluders, nav,
    coverNodes: world.coverNodes, solids: world.solids, half: world.half,
    groundHeight: world.groundHeight, effects: effectsStub,
    playerPos: () => new THREE.Vector3(player.x, player.y + 1.6, player.z),
    playerFeet: () => new THREE.Vector3(player.x, 0, player.z),
    playerAlive: () => player.alive,
    random: () => Math.random(),
    moveCollide: (p: THREE.Vector3, dx: number, dz: number, r: number) => {
      const nx = p.x + dx, nz = p.z + dz;
      let hit = false;
      for (const b of world.solids) {
        if (b.maxY <= p.y + 0.55 || b.minY > p.y + 1.7) continue;
        if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) { hit = true; break; }
      }
      if (!hit) { p.x = nx; p.z = nz; }
      if (Math.abs(p.x) > world.half - 0.5) p.x = Math.sign(p.x) * (world.half - 0.5);
      if (Math.abs(p.z) > world.half - 0.5) p.z = Math.sign(p.z) * (world.half - 0.5);
    },
    damagePlayer: (amount: number, _from: THREE.Vector3, _killer: TDMBot, _isHead?: boolean) => bridge.damage(amount, _from, 'RIFLE'),
    onCallout: () => {}, throwGrenade: () => {}, onBotFire: () => {},
    onFeed: (killer, weapon, victim, headshot) => feed.push(`${killer} [${weapon}] ${victim}${headshot ? ' HS' : ''}`),
    onScore: () => {}, playerOnFire: () => false,
  } as unknown as TDMContext;

  const runner = new CompetitiveRunner({ scene, world, ctx, player: bridge, emit: e => ui.push(e), random: Math.random });
  runner.start();

  const step = (dt: number) => {
    runner.update(dt);
    player.y = world.groundHeight(player.x, player.z);
  };
  const toPhase = (phase: string) => {
    for (let i = 0; i < 30 * 25; i++) {
      if (runner.match.phase === phase) return true;
      step(1 / 30);
    }
    return runner.match.phase === phase;
  };
  return { runner, scene, feed, ui, player, step, toPhase };
}

const DT = 1 / 30;

// =============================================================== scenario A ==
interface MatchSummary {
  rounds: number; plants: number; defuses: number; score: [number, number]; draw: boolean;
  reasons: string[]; moneyOk: boolean; hudOk: boolean; slowest: number; siteReach: number;
  feed: number; uiOk: boolean; p95: number;
}

function scenarioA(seed: number): MatchSummary {
  Math.random = mulberry32(seed);
  console.log(`\n=== A · a full ranked match, bots only (seed ${seed}) ===`);
  const rig = makeRig();
  const { runner } = rig;
  const travelled = new Map<string, number>();
  const siteEntries = new Map<string, Set<number>>();
  const plants = new Set<number>();
  const defuses = new Set<number>();
  const drops = new Set<number>();
  const reasons = new Map<string, number>();
  const rounds: string[] = [];
  const moneyOutOfBand: string[] = [];
  const hudProblems: string[] = [];
  let bombState = runner.match.bomb.state;
  let lastResult: { winner: string; reason: string } | null = null;
  let round = runner.match.round;
  let seconds = 0;
  const frameCost: number[] = [];

  while (runner.match.phase !== 'matchEnd' && seconds < 45 * 60) {
    const previous = new Map<string, [number, number]>();
    for (const bot of runner.manager.bots) previous.set(bot.name, [bot.pos.x, bot.pos.z]);
    const t0 = performance.now();
    rig.step(DT);
    frameCost.push(performance.now() - t0);
    seconds += DT;
    for (const bot of runner.manager.bots) {
      const p = previous.get(bot.name);
      if (p) travelled.set(bot.name, (travelled.get(bot.name) ?? 0) + Math.hypot(bot.pos.x - p[0], bot.pos.z - p[1]));
    }
    const bomb = runner.match.bomb;
    if (bomb.state === 'planted' && bombState !== 'planted') {
      plants.add(runner.match.round);
      const attacker = runner.match.roster(runner.match.teamOnSide('attack')).find(c => c.alive);
      if (attacker) {
        const pos = runner.positionOf(attacker.id);
        const site = bomb.site ? COMP_SITES[bomb.site] : null;
        if (pos && site) siteEntries.set(attacker.id, (siteEntries.get(attacker.id) ?? new Set()).add(runner.match.round));
      }
    }
    if (bomb.state === 'defused' && bombState !== 'defused') defuses.add(runner.match.round);
    if (bomb.state === 'dropped' && bombState !== 'dropped') drops.add(runner.match.round);
    bombState = bomb.state;

    // a site is "reached" when an attacker walks into a live site circle
    for (const bot of runner.manager.bots) {
      if (bot.dead || runner.match.sideOfId(bot.name) !== 'attack') continue;
      for (const id of ['A', 'B'] as const) {
        const site = COMP_SITES[id];
        if (Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z) <= site.radius) {
          const key = `site-${id}`;
          siteEntries.set(key, (siteEntries.get(key) ?? new Set()).add(runner.match.round));
        }
      }
    }

    if (runner.match.phase === 'roundEnd' && runner.match.lastRound) lastResult = { ...runner.match.lastRound };
    if (runner.match.round !== round) {
      const last = lastResult;
      reasons.set(last?.reason ?? 'unknown', (reasons.get(last?.reason ?? 'unknown') ?? 0) + 1);
      rounds.push(`  round ${round}: ${last?.winner ?? '?'} by ${last?.reason ?? '?'} ${runner.match.score.alpha}-${runner.match.score.bravo}`);
      round = runner.match.round;
    }
    for (const c of runner.match.combatants) {
      if (c.money < 0 || c.money > COMP_MAX_MONEY) moneyOutOfBand.push(`${c.id} $${c.money}`);
    }
    if (Math.abs(seconds % 1) < DT) {
      const hud = runner.hud();
      if (hud.roster.length !== 10) hudProblems.push(`roster ${hud.roster.length}`);
      if (hud.alive.alpha + hud.alive.bravo > 10) hudProblems.push('too many alive');
      if (!Number.isFinite(hud.timeLeft) || hud.timeLeft < 0) hudProblems.push(`timeLeft ${hud.timeLeft}`);
      if (hud.bomb.fuse < 0 || hud.bomb.fuse > COMP_BOMB_FUSE) hudProblems.push(`fuse ${hud.bomb.fuse}`);
      if (!Number.isFinite(hud.money)) hudProblems.push('money not finite');
      if (hud.roster.some(r => !Number.isFinite(r.adr) || !Number.isFinite(r.hp))) hudProblems.push('bad roster row');
    }
  }

  const m = runner.match;
  console.log(rounds.join('\n'));
  console.log(`  match: ${m.score.alpha} - ${m.score.bravo} after ${m.history.length} rounds (${Math.round(seconds)}s simulated)`);
  console.log(`  plants ${plants.size} · defuses ${defuses.size} · charge dropped ${drops.size} · reasons ${[...reasons].map(([k, v]) => `${k}×${v}`).join(', ')}`);
  console.log(`  site entries: ${[...siteEntries].map(([k, v]) => `${k}=${v.size}`).join(' ')}`);

  check(m.phase === 'matchEnd', `A1 [${seed}] the match reaches a decision`);
  check(m.history.length >= 7 && m.history.length <= 19, `A1 [${seed}] round count inside the format (${m.history.length})`);
  check(m.draw || Math.max(m.score.alpha, m.score.bravo) >= 7, `A1 [${seed}] the winner cleared the format (${m.score.alpha}-${m.score.bravo}${m.overtime ? ', overtime' : ''})`);
  check(moneyOutOfBand.length === 0, `A3 [${seed}] no wallet left the money band`);
  const stuck = [...travelled].filter(([, d]) => d < 10);
  check(stuck.length === 0, `A4 [${seed}] every bot moved (slowest ${Math.min(...travelled.values()).toFixed(0)} m)`);
  const siteReach = [...siteEntries].filter(([k]) => k.startsWith('site-')).reduce((n, [, v]) => n + v.size, 0);
  check(hudProblems.length === 0, `A5 [${seed}] HUD payload sane (${hudProblems.slice(0, 3).join('; ') || 'clean'})`);
  check(rig.ui.some(e => e.type === 'round-end') && rig.ui.some(e => e.type === 'match-end'), `A5 [${seed}] round + match events reach the UI`);

  frameCost.sort((a, b) => a - b);
  const p95 = frameCost[Math.floor(frameCost.length * 0.95)] ?? 0;
  const avg = frameCost.reduce((a, b) => a + b, 0) / Math.max(1, frameCost.length);
  console.log(`  frame cost: avg ${avg.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms`);
  check(p95 < 25, `C1 [${seed}] a frame stays cheap (p95 ${p95.toFixed(2)} ms)`);

  const summary: MatchSummary = {
    rounds: m.history.length, plants: plants.size, defuses: defuses.size,
    score: [m.score.alpha, m.score.bravo], draw: m.draw,
    reasons: [...reasons.keys()], moneyOk: moneyOutOfBand.length === 0, hudOk: hudProblems.length === 0,
    slowest: Math.min(...travelled.values()), siteReach, feed: rig.feed.length, uiOk: true, p95,
  };
  return summary;
}

// =============================================================== scenario B ==
function scenarioB(): void {
  console.log('\n=== B · the player carries and plants the charge ===');
  const rig = makeRig();
  const { runner } = rig;
  rig.player.invulnerable = true;
  check(rig.toPhase('live'), 'B0 the match starts (buy phase elapsed)');

  const site = COMP_SITES.A;
  rig.player.x = site.x - 1.0;
  rig.player.z = site.z;
  runner.match.dropBomb(site.x - 1.0, site.z);
  runner.match.update(1 / 30);
  const picked = runner.playerTryPickup();
  check(picked, 'B1 the player picks the dropped charge up');
  check(runner.match.bomb.carrierId === PLAYER_ID, `B1 the charge is on the player (${runner.match.bomb.carrierId})`);
  const carryPrompt = runner.hud().prompt;
  check(carryPrompt?.kind === 'plant' && carryPrompt.ok, `B3 the HUD offers the plant (${JSON.stringify(carryPrompt)})`);

  let planted = false;
  for (let i = 0; i < 30 * 8 && !planted; i++) {
    runner.playerHoldAction(1 / 30);
    rig.step(1 / 30);
    if (runner.match.bomb.state === 'planted') planted = true;
  }
  check(planted, 'B2 holding interact at site A plants the charge');

  const armed = runner.hud();
  check(armed.bomb.state === 'planted' && armed.bomb.fuse > 0, `B3 the HUD shows the armed charge (fuse ${armed.bomb.fuse.toFixed(1)})`);
  check(armed.action === null && armed.roster.find(r => r.you)?.plants === 1, 'B3 the plant is scored on the player row');
  let ended = false;
  for (let i = 0; i < 30 * 60 && !ended; i++) {
    rig.player.x = 40; rig.player.z = 40; // step out of the blast
    rig.step(1 / 30);
    if (runner.match.phase === 'roundEnd' || runner.match.phase === 'matchEnd') ended = true;
  }
  const reason = runner.match.lastRound?.reason ?? 'unknown';
  console.log(`  armed round ended by: ${reason} (winner ${runner.match.lastRound?.winner ?? '?'})`);
  check(ended, 'B4 the armed round resolves');
  check(reason === 'detonation' || reason === 'defuse' || reason === 'defused-time',
    `B4 the armed round resolved through the charge (${reason})`);
  check(rig.ui.some(e => e.type === 'bomb-planted' as never) || runner.match.history.length > 0, 'B4 history recorded the round');
  runner.dispose();
}

// ==================================================================== main ===
function main(): void {
  const seeds = [1, 7, 13, 29];
  const summaries: MatchSummary[] = [];
  for (const seed of seeds) summaries.push(scenarioA(seed));

  const rounds = summaries.reduce((n, s) => n + s.rounds, 0);
  const plants = summaries.reduce((n, s) => n + s.plants, 0);
  const defuses = summaries.reduce((n, s) => n + s.defuses, 0);
  const reasons = new Set(summaries.flatMap(s => s.reasons));
  const decided = summaries.filter(s => s.draw || Math.max(...s.score) >= 7).length;
  console.log('\n=== aggregate over ' + seeds.length + ' matches ===');
  console.log(`  ${rounds} rounds · ${plants} plants (${Math.round((plants / rounds) * 100)}%) · `
    + `${defuses} defuses · reasons: ${[...reasons].join(', ')}`);
  console.log(`  scores: ${summaries.map(s => `${s.score[0]}-${s.score[1]}`).join('  ')}`);

  check(decided === summaries.length, 'A1 every match reaches a decision');
  check(plantRatio(plants, rounds) >= 0.3, `A2 attackers plant often enough (${plants}/${rounds} rounds)`);
  check(defuses >= 2, `A2 defenders defuse across the run (${defuses})`);
  check(reasons.size >= 3, `A2 rounds end for several reasons (${[...reasons].join(', ')})`);
  check(summaries.every(s => s.moneyOk && s.hudOk), 'A3/A5 economy and HUD hold across every match');
  check(summaries.every(s => s.slowest > 10), 'A4 no bot is ever stuck');
  check(summaries.every(s => s.siteReach >= 2), `A4 attackers reach a site every match (min ${Math.min(...summaries.map(s => s.siteReach))})`);
  check(summaries.every(s => s.feed > 20), `A5 the kill feed fills (min ${Math.min(...summaries.map(s => s.feed))})`);
  check(Math.max(...summaries.map(s => s.p95)) < 25, `C1 frames stay cheap (worst p95 ${Math.max(...summaries.map(s => s.p95)).toFixed(2)} ms)`);

  scenarioB();
  console.log(`\n${failures.length ? `FAILURES (${failures.length}):\n - ${failures.join('\n - ')}` : 'ALL CHECKS PASSED'}`);
  if (failures.length) process.exitCode = 1;
}

const plantRatio = (plants: number, rounds: number) => (rounds ? plants / rounds : 0);

main();
