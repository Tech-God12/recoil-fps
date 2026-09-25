import * as THREE from 'three';
import { installCanvasStub } from './geometry.js';
import { installAudioStub } from './audio.js';

// One canvas + audio stub for the whole process: the ranked rig builds a real
// arena world, real viewmodels and real effects, and fires the real detonation.
const restoreCanvas = installCanvasStub();
const restoreAudio = installAudioStub();

export const worldMod = await import('../../src/game/world.ts');
const ai = await import('../../src/game/ai.ts');
export const matchMod = await import('../../src/game/competitive/match.ts');
export const rules = await import('../../src/game/competitive/rules.ts');
export const rank = await import('../../src/game/economy/rank.ts');
export const tactics = await import('../../src/game/competitive/tactics.ts');
export const engineMod = await import('../../src/game/engine.ts');
const { Effects } = await import('../../src/game/effects.ts');
export const Engine = engineMod.Engine;

export { restoreCanvas, restoreAudio, Effects };

/** Deterministic RNG — bots reach for Math.random, so seeding it seeds the match. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A live ranked match: real arena, real squads, real round engine, player on a stub bridge. */
export function makeRunner(seed = 7, { autostart = true } = {}) {
  const rng = mulberry32(seed);
  Math.random = rng;
  const scene = new THREE.Scene();
  const built = worldMod.buildWorld(scene, 'arena');
  const nav = new ai.NavGrid(built.solids, built.half, built.groundHeight);
  const player = { x: 0, y: 0, z: 36, hp: 100, armor: 0, helmet: false, alive: true };
  const ui = [];
  const bridge = {
    armor: () => player.armor,
    helmet: () => player.helmet,
    setArmor: (armor, helmet) => { player.armor = armor; player.helmet = helmet; },
    alive: () => player.alive,
    position: () => ({ x: player.x, y: player.y + 1.6, z: player.z }),
    spawn: (x, z, yaw) => {
      player.x = x; player.z = z; player.hp = 100; player.alive = true;
      player.y = yaw === undefined ? player.y : player.y;
    },
    applyKit: (kit) => Object.assign(player, kit),
    setFrozen: () => {},
    damage: (amount) => { player.hp = Math.max(0, player.hp - amount); if (player.hp <= 0) player.alive = false; },
  };
  const ctx = {
    scene, occluders: built.occluders, coverNodes: built.coverNodes, solids: built.solids, half: built.half,
    groundHeight: built.groundHeight, effects: new Effects(scene),
    nav, random: rng,
    playerPos: () => new THREE.Vector3(player.x, player.y + 1.6, player.z),
    playerFeet: () => new THREE.Vector3(player.x, player.y, player.z),
    playerAlive: () => player.alive,
    moveCollide: (p, dx, dz, r) => {
      const nx = p.x + dx, nz = p.z + dz;
      for (const b of built.solids) {
        if (b.maxY <= 0.55 || b.minY > 1.9) continue;
        if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) return;
      }
      p.x = nx; p.z = nz;
    },
    damagePlayer: () => {}, onCallout: () => {}, throwGrenade: () => {}, onBotFire: () => {},
    onFeed: () => {}, onScore: () => {}, playerOnFire: () => false,
  };
  const runner = new matchMod.CompetitiveRunner({
    scene, world: built, ctx, player: bridge, emit: event => ui.push(event), random: rng,
  });
  if (autostart) runner.start();
  return { runner, player, world: built, scene, ctx, ui, rng };
}

/** Steps a runner with a fixed timestep until `test` passes or the budget runs out. */
export function stepUntil(runner, test, seconds = 30, dt = 1 / 30) {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    if (test()) return true;
    runner.update(dt);
  }
  return test();
}

/** Plays a whole ranked match and returns the runner. */
export function playMatch(seed, seconds = 45 * 60) {
  const rig = makeRunner(seed);
  const last = rig.runner.match;
  stepUntil(rig.runner, () => last.phase === 'matchEnd', seconds);
  return rig;
}

/** A stand-in engine carrying only the ranked fields, with the real methods bolted on. */
export function fakeEngine(overrides = {}) {
  const earned = [];
  const engine = {
    isComp: false, ended: false, dead: false, finishDelay: 0, score: 0, shots: 0, hits: 0,
    comp: null, compMatchT: 0, compRanked: structuredClone(rank.DEFAULT_RANKED), compRatingChange: 0,
    compDebrief: null, compArmor: 0, compHelmet: false, compKitWeapons: [null, 'm1911'],
    compBuilds: {}, compBuyOpen: true, compBuyCursor: 0, frags: 0, flashes: 0,
    vmScene: new THREE.Scene(), weapons: [], mags: [], reserves: [],
    cur: 0, lastCur: 0, shotIdx: 0, shotResetT: 0, reloadT: -1, reloadStages: [], currentReloadStage: 'idle',
    cashEarned: 0, cashLog: [], difficultyId: 'regular', pendingResult: null,
    triggerHeld: false, rmb: false, keys: new Set(),
    world: null, effects: null, shake: 0, ai: { enemies: [] },
    // Real prototype methods: the loadout builder, the FX-only blast helper and the
    // pre-match damage model, so nothing here re-implements engine behaviour.
    buildLoadoutWeapon: Engine.prototype.buildLoadoutWeapon,
    blowOutGlass: Engine.prototype.blowOutGlass,
    compRack: Engine.prototype.compRack,
    compHudView: Engine.prototype.compHudView,
    rebuildHittables() {},
    earnCash(amount, tag) { this.cashEarned += amount; this.cashLog.push({ amount, tag }); earned.push([tag, amount]); },
    ...overrides,
  };
  engine.earned = earned;
  return engine;
}
