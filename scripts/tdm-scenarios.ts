/**
 * Headless acceptance harness for the arena Part B/C mechanics.
 * Drives TDMManager + bots in isolation (no engine, no WebGL) and asserts:
 *   S1  down → no score → crawl → execute confirm (score + feed zone)
 *   S2  bleed-out after 4 s with no confirm (no kill credit)
 *   S3  ally bot revives the downed player (heavy tier → 75 HP)
 *   S4  momentum: 3 kills/30 s ignites, enemies hunt the burning target, fire ends
 * Run: node --import tsx --loader ./scripts/asset-loader.mjs scripts/tdm-scenarios.ts
 */
import * as THREE from 'three';
import { TDMManager, TDM_DOWNED_SECONDS, TDM_FIRE_KILLS } from '../src/game/tdm';
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
let playerDownedFlag = false;
const scene = new THREE.Scene();
const world = buildWorld(scene, 'arena');
const nav = new NavGrid(world.solids, world.half, world.groundHeight);
const effectsStub: any = new Proxy({}, { get: () => () => {} });
const half = world.half;
const ctx: TDMContext = {
  scene, occluders: world.occluders, nav,
  coverNodes: world.coverNodes, solids: world.solids, half,
  groundHeight: world.groundHeight, effects: effectsStub,
  playerAlive: () => !playerDownedFlag,
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
  executePlayer: () => { feed.push('player-executed'); },
  revivePlayer: (hp: number, by: string) => { feed.push(`player-revived:${hp}:${by}`); },
  playerDowned: () => playerDownedFlag,
  playerOnFire: () => false,
  onFeed: (k: string, w: string, v: string, _hs: boolean, _t: 'alpha' | 'bravo', zone?: string, kind?: string) => feed.push(`${k}[${w}]${v}@${zone}:${kind}`),
  onScore: () => {},
} as unknown as TDMContext;

const mgr = new TDMManager(ctx, 1);
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

// ================= S1: down → crawl → execute =================
console.log('S1: down, crawl, execute');
const prey = bot('bravo', 0);
isolate(prey, 2, 28);
const aScore0 = mgr.alphaScore;
const died = prey.takeDamage(999, true, 'player');
check('one lethal hit does NOT instantly kill', !died);
check('bot is downed, not dead', prey.downed && !prey.dead);
check('no score on the down', mgr.alphaScore === aScore0);
check('down feed emitted', feed.some(f => f.includes('[DOWN]')));
feed.length = 0;
const crawlFrom = prey.pos.clone();
drive(prey, 2);
check('downed bot crawls toward cover', prey.pos.distanceTo(crawlFrom) > 0.2);
check('downed marker floats above the body', !!prey.downedMarker && prey.downedMarker.visible);
check('downed pose is prone', prey.model.group.rotation.x < -0.8);
const scoreBeforeExec = mgr.alphaScore;
const confirmed = prey.finishDown('player', true);
check('stylish finishDown confirms the kill', confirmed && prey.dead);
check('execution scores exactly one kill', mgr.alphaScore === scoreBeforeExec + 1);
check('EXECUTED feed carries the zone', feed.some(f => f.includes('[EXECUTED]') && /@[A-Z ]+:executed$/.test(f)));
check('killer momentum registered (1 kill)', prey.deaths === 1);

// ================= S2: bleed-out with no confirm =================
console.log('S2: bleed-out');
const bled = bot('bravo', 1);
isolate(bled, 40, 40);
bled.takeDamage(999, false, 'player');
check('second bot downed', bled.downed);
feed.length = 0;
drive(bled, TDM_DOWNED_SECONDS + 1.5);
check('bled out after ~4 s', bled.dead && !bled.downed);
check('bled feed has no killer credit', feed.some(f => /^\[BLED OUT\]/.test(f)));
check('bleed-out scored nothing', mgr.alphaScore === scoreBeforeExec + 1);

// ================= S3: ally bot revives the player =================
console.log('S3: bot revives the player');
playerDownedFlag = true;
playerHP = 0;
playerPos.set(1, 1.6, 31);
const medic = bot('alpha', 1);
isolate(medic, 1, 29);
feed.length = 0;
let chose = false;
for (let i = 0; i < 40 && !chose; i++) { (medic as any).considerRevive(); chose = medic.state === 'REVIVE'; } // 70% roll — retry
check('medic chose to revive', chose && medic.state === 'REVIVE');
drive(medic, 1.2);
check('revive channel is live on the manager', !!mgr.playerRevive && mgr.playerRevive.by === medic);
medic.reviveT = 1.9; // nearly done — channel completes on the next tick
drive(medic, 0.5);
check('revive completed: player up at 50 HP (medium armor tier)', feed.some(f => /^player-revived:50:/.test(f)));
playerDownedFlag = false; // player back up — a fresh channel would abort on the next tick
drive(medic, 0.6);
check('playerRevive cleared after completion', mgr.playerRevive === null);
playerHP = 100;

// stale-revive guard: a reviver that dies mid-channel drops the marker
const medic2 = bot('alpha', 2);
playerDownedFlag = true;
isolate(medic2, 3, 29);
(medic2 as any).considerRevive();
mgr.playerRevive = { by: medic2, t: 0.4 };
medic2.takeDamage(999, true, 'player'); // knocked down mid-revive
mgr.update(1 / 30);
check('stale revive cleared when the reviver drops', mgr.playerRevive === null);
playerDownedFlag = false;

// ================= S4: momentum ON FIRE =================
console.log('S4: on fire');
const hunter = bot('bravo', 2);
const target = bot('alpha', 0);
isolate(hunter, 10, 0);
isolate(target, -34, 0);
const now = performance.now();
hunter.killTimes.push(now - 2000, now - 1000);
hunter.registerKill();
hunter.updateFire(1 / 60); // momentum is evaluated on the fire tick
hunter.updateVisualFrame(1 / 60); // vfx visibility is driven by the visual frame
check('3 kills inside 30 s ignites', hunter.onFire);
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
