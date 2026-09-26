import '../tests/helpers/register-json.js';

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
    playerAlive: () => true,
    damagePlayer: () => {}, moveCollide,
    onCallout: () => {}, throwGrenade: () => {}, onBotFire: () => {},
    playerOnFire: () => false,
    onFeed: (k: string, w: string, v: string, _hs: boolean, _t: string, zone?: string) => console.log(`  FEED ${k} [${w}] ${v}${zone ? ` — ${zone}` : ''}`),
    onScore: () => {},
  } as any);
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
}
main().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });
