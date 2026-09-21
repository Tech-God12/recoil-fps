/* Headless smoke test: build the arena world + TDM manager under Node with a
 * Proxy-stubbed canvas/document, then simulate bot ticks. Catches runtime
 * crashes and stuck-bot regressions without a browser. NOT part of the app. */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- minimal DOM shim ----
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
function makeCanvas() {
  const c: any = {
    width: 0, height: 0, style: {},
    addEventListener: () => {}, removeEventListener: () => {},
    getContext: (kind: string) => (kind === '2d' ? new Proxy({ canvas: c }, ctx2dHandler) : null),
    toDataURL: () => 'data:image/png;base64,',
  };
  return c;
}
(globalThis as any).document = {
  createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : { style: {}, addEventListener: () => {} }),
  createElementNS: () => makeCanvas(),
  addEventListener: () => {}, removeEventListener: () => {},
};
(globalThis as any).window = globalThis;
(globalThis as any).self = globalThis;

async function main() {
  const THREE = await import('three');
  const { buildWorld } = await import('../src/game/world');
  const { TDMManager } = await import('../src/game/tdm');
  const { NavGrid } = await import('../src/game/ai');

  const scene = new THREE.Scene();
  const world = buildWorld(scene, 'arena');
  console.log('WORLD OK — half', world.half, 'solids', world.solids.length, 'coverNodes', world.coverNodes.length, 'spawn', world.playerSpawn.toArray().map(v => +v.toFixed(1)).join(','));

  // NavGrid reachability audit: flood fill from the player spawn; report the
  // fraction of free cells that are reachable, and sample key POIs.
  const gh = world.navigationHeight ?? world.groundHeight;
  const nav = new NavGrid(world.solids, world.half, gh);
  const n = (nav as any).n as number;
  const blocked = (nav as any).blocked as Uint8Array;
  const seen = new Uint8Array(n * n);
  const q: number[] = [];
  const start = nav.toCell(world.playerSpawn.x) + nav.toCell(world.playerSpawn.z) * n;
  q.push(start); seen[start] = 1;
  while (q.length) {
    const cur = q.pop()!;
    const cx = cur % n, cz = (cur / n) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const k = nz * n + nx;
      if (seen[k] || blocked[k]) continue;
      seen[k] = 1; q.push(k);
    }
  }
  let free = 0, reach = 0;
  for (let i = 0; i < n * n; i++) { if (!blocked[i]) { free++; if (seen[i]) reach++; } }
  console.log(`NAV — ${n}x${n} cells, free ${free}, reachable from spawn ${reach} (${Math.round(reach / free * 100)}%)`);
  const poi: [string, number, number][] = [
    ['mid', 0, 0], ['bravo spawn', 0, -world.half + 14], ['alpha spawn', 0, world.half - 14],
    ['west yard', -world.half + 22, 0], ['east yard', world.half - 22, 0],
    ['west hall', -10.5, 0], ['east hall', 10.5, 0],
  ];
  for (const [name, x, z] of poi) {
    const k = nav.toCell(x) + nav.toCell(z) * n;
    const [fx, fz] = nav.nearestFree(nav.toCell(x), nav.toCell(z));
    const kk = fz * n + fx;
    console.log(`  POI ${name.padEnd(12)} (${x},${z}) -> ${seen[kk] ? 'REACHABLE' : blocked[k] ? 'BLOCKED+UNREACHABLE' : 'UNREACHABLE'}`);
  }

  // ---- TDMManager simulation: 60 seconds of bot logic at 60Hz ----
  const half = world.half;
  const playerPos = new THREE.Vector3(0, 1.62, 40);
  const effectsStub: any = new Proxy({}, { get: () => () => {} });
  const solids = world.solids;
  const moveCollide = (p: any, dx: number, dz: number, r: number) => {
    // cheap AABB collide matching engine semantics closely enough for a smoke test
    for (const [ax, az] of [[dx, 0], [0, dz]] as const) {
      const nx = p.x + ax, nz = p.z + az;
      let hit = false;
      for (const b of solids) {
        if (b.maxY <= p.y + 0.55 || b.minY > p.y + 1.7) continue;
        if (nx > b.minX - r && nx < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) { hit = true; break; }
      }
      if (!hit) { p.x = nx; p.z = nz; }
      if (Math.abs(p.x) > half - 0.5) p.x = Math.sign(p.x) * (half - 0.5);
      if (Math.abs(p.z) > half - 0.5) p.z = Math.sign(p.z) * (half - 0.5);
    }
  };
  const mgr = new TDMManager({
    scene, occluders: world.occluders, coverNodes: world.coverNodes, solids, half,
    groundHeight: gh, effects: effectsStub,
    playerPos: () => playerPos.clone(), playerFeet: () => new THREE.Vector3(playerPos.x, 0, playerPos.z),
    playerAlive: () => true, playerDowned: () => false, playerOnFire: () => false,
    damagePlayer: () => {}, moveCollide,
    revivePlayer: () => {}, finishDownedPlayer: () => {}, onPlayerKillConfirmed: () => {},
    onCallout: () => {}, throwGrenade: () => {}, onBotFire: () => {},
    onFeed: (k: string, w: string, v: string) => console.log(`  FEED ${k} [${w}] ${v}`),
    onScore: () => {},
  } as any, 1);
  console.log('TDM OK — bots', mgr.bots.length, 'spawn spread alpha:', mgr.bots.filter(b => b.team === 'alpha').map(b => b.pos.toArray().map(v => +v.toFixed(0)).join(',')).join(' | '));

  const stuckAcc = new Map<any, { t: number; lx: number; lz: number; worst: number }>();
  for (const b of mgr.bots) stuckAcc.set(b, { t: 0, lx: b.pos.x, lz: b.pos.z, worst: 0 });
  const dt = 1 / 60;
  for (let f = 0; f < 120 * 60; f++) {
    mgr.update(dt);
    if (f % 30 === 0) {
      for (const b of mgr.bots) {
        const s = stuckAcc.get(b)!;
        const moved = Math.hypot(b.pos.x - s.lx, b.pos.z - s.lz);
        if (b.dead || b.state === 'ENGAGE' || b.state === 'COVER') { s.t = 0; }
        else if (moved < 0.25) { s.t += 0.5; s.worst = Math.max(s.worst, s.t); }
        else s.t = 0;
        s.lx = b.pos.x; s.lz = b.pos.z;
      }
    }
  }
  console.log('SIM 60s done — score', mgr.alphaScore, ':', mgr.bravoScore);
  for (const b of mgr.bots) {
    const s = stuckAcc.get(b)!;
    console.log(`  ${b.team} ${b.name.padEnd(8)} state ${b.state.padEnd(7)} pos ${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)} worstStill ${s.worst.toFixed(1)}s`);
  }

  // ================= PART B/C ACCEPTANCE CHECKS =================
  const { TD_DOWN, TD_KILLED, TDM_DOWNED_SECONDS, TDM_ONFIRE_KILLS } = await import('../src/game/tdm');
  const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error('ACCEPT FAIL: ' + msg); console.log('  OK', msg); };

  // fresh manager for deterministic tests
  let playerDownedFlag = false, playerOnFireFlag = false;
  const events2: string[] = [];
  const mgr2 = new TDMManager({
    scene, occluders: world.occluders, coverNodes: world.coverNodes, solids, half,
    groundHeight: gh, effects: effectsStub,
    playerPos: () => playerPos.clone(), playerFeet: () => new THREE.Vector3(playerPos.x, 0, playerPos.z),
    playerAlive: () => true, playerDowned: () => playerDownedFlag, playerOnFire: () => playerOnFireFlag,
    damagePlayer: () => {}, moveCollide,
    revivePlayer: () => { events2.push('REVIVED'); playerDownedFlag = false; },
    finishDownedPlayer: (k: any) => { events2.push('EXECUTED_BY_' + k.name); playerDownedFlag = false; },
    onPlayerKillConfirmed: (v: any, w: string) => events2.push(`PKILL_${v === 'player' ? 'PLAYER' : v.name}_${w}`),
    onCallout: (k: string) => events2.push('CALLOUT_' + k),
    throwGrenade: () => {}, onBotFire: () => {},
    onFeed: (k: string, w: string, v: string) => events2.push(`FEED_${k}_${w}_${v}`),
    onScore: () => {},
  } as any, 1);
  // park everyone far from the test corners so stray AI doesn't interfere
  for (const b of mgr2.bots) b.updateVisualFrame?.();

  // ---- B1: down a bot -> NOT a kill until confirmed ----
  const victim = mgr2.bots.find(b => b.team === 'bravo')!;
  const res1 = victim.takeDamage(9999, false, 'player');
  assert(res1 === TD_DOWN, 'lethal damage on a fresh bot returns TD_DOWN (not TD_KILLED)');
  assert(victim.downed && !victim.dead, 'victim enters DOWNED state, still not dead');
  assert(victim.downedTimer > 0 && victim.downedTimer <= TDM_DOWNED_SECONDS, 'bleed-out clock running');

  // ---- B2: enemy bot executes the downed body ----
  const enemy = mgr2.bots.find(b => b.team === 'alpha')!;
  enemy.pos.set(victim.pos.x + 1, victim.pos.y, victim.pos.z); // within 2.6m trigger range
  enemy.forceExecute({ isPlayer: false, bot: victim });
  for (let i = 0; i < 60 * 3 && !victim.dead; i++) { mgr2.update(1 / 60); }
  assert(victim.dead, 'EXECUTE channel completes -> victim confirmed dead');
  assert(events2.some(e => e.startsWith('FEED_') && e.includes('EXECUTED')), 'feed shows EXECUTED weapon tag');

  // ---- B3: bleed-out when nobody finishes ----
  const v2 = mgr2.bots.find(b => b.team === 'bravo' && !b.dead && !b.downed)!;
  v2.pos.set(999, 0, 999); // isolate: no enemy within executor range
  for (const b of mgr2.bots) if (b !== v2) b.pos.set(-999, 0, -999);
  v2.takeDamage(9999, false, 'player');
  let bled = false;
  for (let i = 0; i < 60 * (TDM_DOWNED_SECONDS + 2) && !bled; i++) { mgr2.update(1 / 60); if (v2.dead) bled = true; }
  assert(bled, 'unexecuted downed bot bleeds out and dies');
  assert(events2.some(e => e.includes('BLEED OUT')), 'bleed-out kill credited via feed');

  // ---- B4: ally bot revives the downed PLAYER ----
  playerDownedFlag = true;
  // player at origin; put an alpha teammate 3m away, bravo far away
  const medic = mgr2.bots.find(b => b.team === 'alpha' && !b.dead && !b.downed)!;
  playerPos.set(0, 1.6, 0);
  medic.pos.set(3, 0, 0);
  for (const b of mgr2.bots) if (b !== medic) b.pos.set(60, 0, 60);
  mgr2.notifyDown('player');
  assert(!!medic.rescue, 'nearest alpha teammate claims the rescue');
  let revived = false;
  for (let i = 0; i < 60 * 8 && !revived; i++) {
    mgr2.update(1 / 60);
    if (events2.some(e => e === 'REVIVED')) revived = true;
  }
  assert(revived, `teammate bot reaches the player and completes the revive (final state=${medic.state} rescue=${!!medic.rescue})`);

  // ---- B5: player executes a downed enemy via confirmExecution ----
  const v3 = mgr2.bots.find(b => b.team === 'bravo' && !b.dead && !b.downed)!;
  v3.pos.set(0, 0, 0); v3.takeDamage(9999, false, 'player');
  events2.length = 0;
  v3.confirmExecution('player', 'slow'); // 'player' executor = the human finished them
  assert(v3.dead, 'player slow-finisher confirms the kill');
  assert(events2.some(e => e === 'PKILL_' + v3.name + '_FINISHER'), 'funnel credits FINISHER to the player');

  // ---- C1: 3 kills within 30s -> ON FIRE ----
  assert(TDM_ONFIRE_KILLS === 3, 'streak threshold is 3');
  const streaker = mgr2.bots.find(b => b.team === 'alpha' && !b.dead && !b.downed)!;
  for (let k = 0; k < 3; k++) streaker.noteKill();
  assert(streaker.onFire, '3 quick kills ignite the killer');
  // ---- C2: when the PLAYER is on fire, bravo bots force-hunt them ----
  playerOnFireFlag = true;
  const hunter = mgr2.bots.find(b => b.team === 'bravo' && !b.dead && !b.downed)!;
  streaker.pos.set(-40, 0, -40); // keep the C1 streaker from out-bountying the player
  hunter.pos.set(8, 0, 0); // 8m from the burning player, 60m+ from the streaker
  let sawHunt = false;
  for (let i = 0; i < 60 * 6 && !sawHunt; i++) {
    mgr2.update(1 / 60);
    if (hunter.state === 'PUSH' && (hunter as any).hunting?.isPlayer) sawHunt = true;
  }
  assert(sawHunt, 'enemy bot forces a PUSH hunt on the burning player');
  assert(events2.some(e => e === 'CALLOUT_onfire' || e === 'CALLOUT_hunt'), 'push/hunt callout fired');
  // ---- C3: killing a burning enemy as the player pays the SHUTDOWN bounty ----
  streaker.diedOnFire = true;
  events2.length = 0;
  mgr2.handleKill('player', streaker, false, 'M4', streaker.diedOnFire);
  assert(events2.some(e => e.includes('_SHUTDOWN')), 'shutdown credit flows through the funnel');

  console.log('ALL ACCEPTANCE CHECKS PASSED');
}
main().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });
