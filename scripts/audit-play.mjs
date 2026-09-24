// Headless playtest instrumentation: no WebGL, browser, or game-code shims are shipped.
// Run: node scripts/audit-play.mjs  (geometry/collision, 10-gun TTK, AI, UI states).
import '../tests/helpers/register-json.js';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { installCanvasStub, geometryBudget } from '../tests/helpers/geometry.js';

const restoreCanvas = installCanvasStub();
const originalRandom = Math.random;
let seed = 127;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const round = (n, dp = 2) => Number(n.toFixed(dp));
const p95 = xs => round([...xs].sort((a, b) => a - b)[Math.floor(xs.length * .95)] ?? 0);
const visibleBudget = group => {
  let draws = 0, triangles = 0;
  group.traverseVisible(o => {
    if (!o.isMesh) return;
    draws += Array.isArray(o.material) ? o.geometry.groups.length : 1;
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
  });
  return { draws, triangles };
};
const disposeWorld = w => w.group.traverse(o => {
  if (o.isMesh || o.isPoints) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); }
});
const builtWorlds = [], worldMaterials = [];
let manager = null, ai = null;

try {
  const { buildWorld } = await import('../src/game/world.ts');
  const { getMission, Mission } = await import('../src/game/systems/mission.ts');
  const { AIManager, DIFFICULTIES } = await import('../src/game/ai.ts');
  const { TDMManager, TDM_BASE_HP, TDM_HP_PER_ARMOR, TDM_BODY_REDUCTION } = await import('../src/game/tdm.ts');
  const { WEAPON_CATALOG } = await import('../src/game/economy/catalog.ts');
  const { WEAPON_BUILDERS } = await import('../src/game/models.ts');
  const { recoilImpulse } = await import('../src/game/recoil.ts');
  const { DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
  const { DEFAULT_PROFILE } = await import('../src/game/economy/profile.ts');
  const { MainMenu, BootScreen, PauseMenu, ResultsScreen } = await import('../src/ui/Screens.tsx');
  const { RankedSetup } = await import('../src/ui/Competitive.tsx');
  const { rankFor } = await import('../src/game/economy/rank.ts');
  const { default: Armory } = await import('../src/ui/armory/Armory.tsx');
  const { default: TdmSetup } = await import('../src/ui/TdmSetup.tsx');
  const { default: Settings } = await import('../src/ui/Settings.tsx');
  const { default: MissionObjective } = await import('../src/ui/MissionObjective.tsx');

  const materialNames = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
  const mats = Object.fromEntries(materialNames.map(k => [k, new THREE.MeshStandardMaterial()]));
  worldMaterials.push(...Object.values(mats));
  const worlds = {};
  for (const id of ['alrasul', 'kasbah', 'arena']) {
    const scene = new THREE.Scene();
    const started = performance.now();
    const w = buildWorld(scene, id, mats);
    builtWorlds.push(w);
    worlds[id] = { w, scene };
    const b = visibleBudget(w.group);
    const mission = id === 'arena' ? null : getMission(id);
    console.log('MAP', JSON.stringify({ id, buildMs: round(performance.now() - started), ...b,
      solids: w.solids.length, occluders: w.occluders.length, cover: w.coverNodes.length,
      windows: w.windows.length, lightSpots: w.lightSpots.length,
      landmarks: w.landmarks.map(l => l.name), phases: mission?.phases.map(p => p.type) ?? ['tdm'],
      half: w.half, aiPool: id === 'arena' ? 9 : 10 }));
  }

  for (const entry of WEAPON_CATALOG) {
    const model = WEAPON_BUILDERS[entry.id]();
    try {
      const b = geometryBudget(model.group);
      const damageAt = range => entry.base.damage * (range > entry.base.falloffStart ? entry.base.falloffMul : 1);
      const shots = (hp, armor, range) => Math.ceil(hp / (damageAt(range) * (entry.pellets ?? 1) * (1 - armor)));
      const ttk = (hits, rpm) => round(Math.max(0, hits - 1) * 60 / rpm, 3);
      const missionHits = shots(100, 0, 10), tdmHits = shots(TDM_BASE_HP + TDM_HP_PER_ARMOR, TDM_BODY_REDUCTION[1], 10);
      const impulse = recoilImpulse({ pattern: entry.base.pattern, shot: 0, recoil: entry.base.recoilMul, baseRecoil: entry.base.recoilMul,
        horizontal: 1, aiming: true, crouched: false, supported: false, random: .5 });
      console.log('GUN', JSON.stringify({ id: entry.id, ...b, mag: entry.base.magSize, adsMs: entry.base.adsTime * 1000,
        reloadMs: entry.base.tacReload * 1000, kickDeg: round(impulse.aimPitch * 180 / Math.PI, 3),
        mission10: [missionHits, ttk(missionHits, entry.base.rpm)], mission50: [shots(100, 0, 50), ttk(shots(100, 0, 50), entry.base.rpm)],
        tdm10: [tdmHits, ttk(tdmHits, entry.base.rpm)], tdm50: [shots(TDM_BASE_HP + TDM_HP_PER_ARMOR, TDM_BODY_REDUCTION[1], 50), ttk(shots(TDM_BASE_HP + TDM_HP_PER_ARMOR, TDM_BODY_REDUCTION[1], 50), entry.base.rpm)] }));
    } finally {
      model.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    }
  }

  // Real nav, occluders, bot brains & weapons, headless effects. Starting from an
  // ordinary arena deployment and then stress-testing enemy presence in alpha spawn.
  const arena = worlds.arena.w;
  const shots = { alpha: 0, bravo: 0, player: 0, feed: 0 };
  const player = arena.playerSpawn.clone();
  const ctx = {
    scene: worlds.arena.scene, occluders: arena.occluders, coverNodes: arena.coverNodes,
    solids: arena.solids, half: arena.half, groundHeight: arena.groundHeight,
    effects: { blood() {}, bloodDecal() {}, tracer() {}, enemyMuzzle() {} },
    playerPos: () => player.clone().add(new THREE.Vector3(0, 1.62, 0)),
    playerFeet: () => player.clone(), playerAlive: () => true,
    damagePlayer() { shots.player++; },
    moveCollide(p, dx, dz, r) {
      const nx = p.x + dx, nz = p.z + dz;
      if (!arena.solids.some(b => b.minY < 1.8 && b.maxY > .34 && nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r)) { p.x = nx; p.z = nz; }
    },
    onCallout() {}, throwGrenade() {}, onBotFire(_pos, team) { shots[team]++; },
    onFeed() { shots.feed++; }, onScore() {}, playerOnFire: () => false,
  };
  manager = new TDMManager(ctx);
  const ms = [];
  for (let i = 0; i < 240; i++) { const t = performance.now(); manager.update(1 / 30); ms.push(performance.now() - t); }
  console.log('TDM_SIM', JSON.stringify({ seconds: 8, bots: manager.bots.length, meanMs: round(ms.reduce((a, b) => a + b, 0) / ms.length), p95Ms: p95(ms), ...shots,
    score: [manager.alphaScore, manager.bravoScore], states: manager.bots.map(b => [b.team, b.state]) }));

  // Candidate risk = visible within rifle range. Deliberately hold the 5 enemy
  // positions fixed to emulate being pushed into the alpha yard on redeploy.
  const brav = manager.bots.filter(b => b.team === 'bravo');
  const risk = spawn => {
    const sight = new THREE.Raycaster();
    const eye = spawn.clone().add(new THREE.Vector3(0, 1.62, 0));
    const list = brav.filter(b => !b.dead).map(b => {
      const enemyEye = b.pos.clone().add(new THREE.Vector3(0, 1.62, 0));
      const dir = eye.clone().sub(enemyEye);
      const dist = dir.length();
      sight.set(enemyEye, dir.normalize()); sight.far = Math.max(0, dist - .3);
      return { dist: round(dist, 1), visible: sight.intersectObjects(arena.occluders, false).length === 0 };
    });
    return { minDist: round(Math.min(...list.map(x => x.dist)), 1), visibleWithin30: list.filter(x => x.visible && x.dist <= 30).length };
  };
  for (const locations of [
    [[0, 28], [12, 27], [-12, 27], [0, 30], [0, 26]],
    [[0, 38], [-12, 37], [12, 37], [-4, 40], [4, 40]],
  ]) {
    brav.forEach((b, i) => { b.pos.set(locations[i][0], 0, locations[i][1]); b.state = 'PATROL'; });
    let visible = 0, close = 0, min = 999, protectedLandings = 0, collisions = 0;
    for (let i = 0; i < 80; i++) {
      const landing = manager.getSpawnDecision('alpha', true);
      const p = landing.position;
      const r = risk(p);
      if (r.visibleWithin30) visible++;
      if (r.minDist < 8) close++;
      if (landing.exposed) protectedLandings++;
      if (manager.bots.some(b => !b.dead && Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 1.5)) collisions++;
      min = Math.min(min, r.minDist);
    }
    console.log('SPAWN_STRESS', JSON.stringify({ positions: locations, trials: 80, visibleWithin30: visible, within8: close, minimumDistance: min,
      protectedLandings, collisions }));
  }
  manager.dispose();
  manager = null;

  // Real mission AI model pool & behavior, in clear sight to time reaction and
  // decision cost; no WebGL. A mission result is also advanced through real rules.
  const scene = new THREE.Scene();
  const counts = { shots: 0, damage: 0, callouts: 0 };
  const aiCtx = { ...ctx, scene, half: 70, solids: [], occluders: [], coverNodes: [],
    difficulty: DIFFICULTIES.Normal,
    playerPos: () => new THREE.Vector3(0, 1.62, 0), playerFeet: () => new THREE.Vector3(),
    playerVel: () => 0, playerStaticTime: () => 0,
    damagePlayer() { counts.damage++; },
    onEnemyFire() { counts.shots++; }, aiThrowGrenade() {}, onCallout() { counts.callouts++; },
    canAcquire: () => true,
  };
  ai = new AIManager(aiCtx, []);
  ai.insertSquad({ insertionId: 'test', from: 'north', focus: [0, 0, 0], members: [[0, 0, 23], [-3, 0, 24], [3, 0, 24]] });
  const aiMs = [], states = [];
  for (let i = 0; i < 180; i++) {
    const t = performance.now(); ai.update(1 / 60); aiMs.push(performance.now() - t);
    if (i % 30 === 0) states.push(ai.enemies.map(e => e.state));
  }
  console.log('MISSION_AI_SIM', JSON.stringify({ seconds: 3, pool: ai.allocationCount(), active: ai.enemies.length,
    meanMs: round(aiMs.reduce((a, b) => a + b, 0) / aiMs.length), p95Ms: p95(aiMs), states, ...counts }));
  ai.dispose();
  ai = null;

  const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
  const noop = () => {};
  const profile = structuredClone(DEFAULT_PROFILE);
  const menu = render(MainMenu, { s: DEFAULT_SETTINGS, profile, onDeploy: noop, onSettings: noop, onMap: noop,
    onSelect: noop, onArmory: noop, onArenaSetup: noop });
  const settings = render(Settings, { s: DEFAULT_SETTINGS, set: noop, onClose: noop });
  const armory = render(Armory, { profile, onProfile: noop, onDeploy: noop, onBack: noop });
  const tdmSetup = render(TdmSetup, { profile, onProfile: noop, armor: 1, onArmor: noop, onDeploy: noop, onBack: noop });
  const ranked = render(RankedSetup, { rank: rankFor(profile.ranked.rating, profile.ranked), rating: profile.ranked.rating,
    record: profile.ranked, onDeploy: noop, onBack: noop });
  const mission = new Mission(getMission('alrasul'));
  mission.start();
  const missionHud = { ...mission.snapshot(mission.current.at), waypoint: { x: 0, y: 0, visible: false }, live: 3, targetPressure: 3, totalSpawned: 3 };
  const objective = render(MissionObjective, { mission: missionHud });
  const pause = render(PauseMenu, { onResume: noop, onRestart: noop, onSettings: noop, onQuit: noop });
  const boot = render(BootScreen, { map: 'kasbah' });
  const r = { win: true, kills: 4, score: 600, shots: 55, hits: 21, headshots: 1, timeSec: 160,
    mission: { id: 'tdm-warehouse', name: 'Warehouse TDM', map: 'arena', status: 'complete', duration: 150, phases: [] },
    pressure: {}, cash: 500, cashLog: [], difficultyMul: 1,
    tdm: { alphaScore: 15, bravoScore: 10, outcome: 'win', playerKills: 4, roster: [] } };
  const results = render(ResultsScreen, { r, wallet: { before: 0, after: 500, earned: 500, gradeBonus: 0 }, onRedeploy: noop, onMenu: noop, onArmory: noop });
  console.log('UI_STATES', JSON.stringify(Object.fromEntries([
    ['home', menu], ['settings', settings], ['armory', armory], ['tdmSetup', tdmSetup], ['rankedSetup', ranked],
    ['boot', boot], ['missionObjective', objective], ['pause', pause], ['results', results],
  ].map(([name, markup]) => [name, { bytes: markup.length, buttons: (markup.match(/<button\b/g) ?? []).length, text: markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 140) }]))));
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  console.log('UI_GAPS', JSON.stringify({ rankedLinkUnwired: /OPERATION BLACKOUT/.test(menu) && !appSource.includes('onRanked={() =>'),
    mainMenuEntries: (menu.match(/<button[^>]+class="rm-item seq/g) ?? []).length }));

} finally {
  try {
    // A failed assertion/SSR import must not leave the nine-bot scene or three
    // generated worlds live until process exit; normal and error paths share cleanup.
    ai?.dispose();
    manager?.dispose();
    for (const w of builtWorlds) disposeWorld(w);
    for (const m of worldMaterials) m.dispose();
  } finally {
    Math.random = originalRandom;
    restoreCanvas();
  }
}
