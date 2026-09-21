/**
 * Headless acceptance harness for the lethal arena TDM rules.
 * Drives TDMManager + bots in isolation (no engine, no WebGL) and asserts:
 *   S1  one lethal hit kills outright: dead + scored + zoned feed, no wounded state
 *   S2  momentum: 3 kills/30 s ignites, enemies hunt the burning target, fire ends
 * Run: node --import tsx --loader ./scripts/asset-loader.mjs scripts/tdm-scenarios.ts
 */
import * as THREE from 'three';
import { TDMManager, TDM_FIRE_KILLS } from '../src/game/tdm';
import { buildWorld } from '../src/game/world';
import { NavGrid } from '../src/game/ai';
import type { TDMBot, TDMContext } from '../src/game/tdm';

// ---- minimal canvas shims (same trick as tdm-smoke) ----
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
function makeCanvas(): HTMLCanvasElement {
  const c: any = {
    width: 0, height: 0, style: {},
    addEventListener: () => {}, removeEventListener: () => {},
    getContext: (kind: string) => (kind === '2d' ? new Proxy({ canvas: c }, ctx2dHandler) : null),
    toDataURL: () => 'data:image/png;base64,',
  };
  return c;
}
(globalThis as any).document = { createElement: (t: string) => (t === 'canvas' ? makeCanvas() : {}) };

const feed: string[] = [];
const calls: string[] = [];
const playerPos = new THREE.Vector3(0, 1.6, 38);
let playerHP = 150;
const scene = new THREE.Scene();
const world = buildWorld(scene, 'arena');
const nav = new NavGrid(world.solids, world.half, world.groundHeight);
const effectsStub: any = new Proxy({}, { get: () => () => {} });
const half = world.half;
const ctx: TDMContext = {
  scene, occluders: world.occluders, nav,
  coverNodes: world.coverNodes, solids: world.solids, half,
  groundHeight: world.groundHeight, effects: effectsStub,
  playerAlive: () => playerHP > 0,
  playerPos: () => playerPos.clone(),
  playerFeet: () => new THREE.Vector3(playerPos.x, 0, playerPos.z),
  random: () => Math.random(),
  moveCollide: (p: THREE.Vector3, dx: number, dz: number, r: number) => {
    const nx = p.x + dx, nz = p.z + dz;
    let hit = false;
    for (const b of world.solids) {
      if (b.maxY <= p.y + 0.55 || b.minY > p.y + 1.7) continue;
      if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) { hit = true; break; }
    }
    if (!hit) { p.x = nx; p.z = nz; }
    if (Math.abs(p.x) > half - 0.5) p.x = Math.sign(p.x) * (half - 0.5);
    if (Math.abs(p.z) > half - 0.5) p.z = Math.sign(p.z) * (half - 0.5);
  },
  losBlocked: () => true, // keep the frozen battlefield pacified
  damagePlayer: (a: number) => { playerHP -= a; },
  onCallout: (k: string) => { calls.push(k); },
  throwGrenade: () => {}, onBotFire: () => {},
  playerOnFire: () => false,
  onFeed: (k: string, w: string, v: string, _hs: boolean, _t: 'alpha' | 'bravo', zone?: string) => feed.push(`${k}[${w}]${v}@${zone}`),
  onScore: () => {},
} as unknown as TDMContext;

const mgr = new TDMManager(ctx);
const bot = (team: 'alpha' | 'bravo', nth = 0) => mgr.bots.filter(b => b.team === team)[nth];
const isolate = (b: TDMBot, x: number, z: number) => { b.pos.set(x, 0, z); b.lastKnown = null; };

let ok = 0, bad = 0;
const check = (label: string, cond: boolean) => { if (cond) { ok++; console.log(`  ok  ${label}`); } else { bad++; console.log(`  FAIL ${label}`); } };
/** Drive one bot alone: visuals at real dt, logic at the manager's doubled cadence. */
const drive = (b: TDMBot, seconds: number) => {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    b.updateVisualFrame(1 / 30);
    if (i % 2 === 0) b.updateLogic(1 / 15);
    b.updateFire(1 / 30);
  }
};

// ================= S1: lethal hit kills outright =================
console.log('S1: lethal kill, immediate score + feed');
const prey = bot('bravo', 0);
isolate(prey, 2, 28);
const aScore0 = mgr.alphaScore;
const killed = prey.takeDamage(999, true, 'player');
check('one lethal hit kills outright (no wounded state)', killed && prey.dead);
check('corpse state is DEAD', prey.state === 'DEAD');
mgr.handleKill('player', prey, true, 'RIFLE');
check('kill scored immediately', mgr.alphaScore === aScore0 + 1);
check('feed carries killer, weapon and zone', feed.some(f => /^YOU\[RIFLE\].+@[A-Z ]+$/.test(f)));
check('victim deaths incremented', prey.deaths === 1);
// a second bot goes down to bot fire the same way — lethal for everyone
const prey2 = bot('bravo', 1);
isolate(prey2, 40, 40);
const shooter = bot('alpha', 3);
const bScore0 = mgr.bravoScore;
const killed2 = prey2.takeDamage(999, false, shooter);
check('bot-vs-bot lethal hit kills outright', killed2 && prey2.dead);
mgr.handleKill(shooter, prey2, false, 'RIFLE');
check('bot kill scored for alpha', mgr.alphaScore === aScore0 + 2 && mgr.bravoScore === bScore0);

// ================= S2: momentum ON FIRE =================
console.log('S2: on fire');
const hunter = bot('bravo', 2);
const target = bot('alpha', 0);
isolate(hunter, 10, 0);
isolate(target, -34, 0);
const now = performance.now();
hunter.killTimes.push(now - 2000, now - 1000);
hunter.registerKill();
hunter.updateFire(1 / 60); // momentum is evaluated on the fire tick
hunter.updateVisualFrame(1 / 60); // vfx visibility is driven by the visual frame
check(`${TDM_FIRE_KILLS} kills inside 30 s ignites`, hunter.onFire);
check('fire lasts 15 s (timer set)', hunter.onFireT > 14);
check('ignition callout sent', calls.includes('onfire'));
check('fire vfx live on the model', !!hunter.fireGlow && hunter.fireGlow.visible && !!hunter.fireParticles && hunter.fireParticles.visible);
// burning bot hunts the player-team burning target… (target not on fire; hunt only targets enemies)
// instead: verify PUSH toward the player-team when they ignite
target.killTimes.push(performance.now() - 100, performance.now() - 50);
target.registerKill();
target.updateFire(1 / 60);
check('enemy momentum ignites too', target.onFire);
const d0 = hunter.pos.distanceTo(target.pos);
drive(hunter, 4);
check('burning hunter pushes the burning enemy (hunt override)', hunter.pos.distanceTo(target.pos) < d0 - 6);
check('pushfire callout sent', calls.includes('pushfire'));
// fire ends after its 15 s
target.onFireT = 0.05;
drive(target, 1);
check('fire ends and cooldown arms', !target.onFire && target.fireCooldown > 19 && target.fireCooldown <= 20);
check('fire vfx hidden after burnout', !target.fireGlow!.visible);

console.log(`RESULT ${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
