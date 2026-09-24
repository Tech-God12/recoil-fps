/* Headless Bomb Defusal match simulation (bots only; the player slot dies at
 * round start). Validates the round loop, economy, plants/defuses and stuck
 * bots without a browser. NOT part of the app.
 * Run:  node --import ./tests/helpers/register-json.js scripts/defuse-sim.ts
 * Env:  FMT=short|standard  SIDE=attack|defend  QUIET=1 (stats only)  FEED=1 (kill feed)  MAXT=<sim seconds> */
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
  const { buildSiteArchitecture } = await import('../src/game/defuse/sites');
  const { DefuseDirector } = await import('../src/game/defuse/director');
  const { formatById, DEFUSE_BODY_REDUCTION, DEFUSE_HEAD_REDUCTION } = await import('../src/game/defuse/rules');

  const scene = new THREE.Scene();
  const world = buildWorld(scene, 'arena');
  buildSiteArchitecture(world);
  const half = world.half;
  const gh = world.navigationHeight ?? world.groundHeight;
  const solids = world.solids;
  if (process.env.SOLIDS_NEAR) {
    // Debug: list solids within 4 m of "x,z" (for diagnosing nav pinch points).
    const [qx, qz] = process.env.SOLIDS_NEAR.split(',').map(Number);
    for (const b of solids) {
      const dx = Math.max(b.minX - qx, 0, qx - b.maxX), dz = Math.max(b.minZ - qz, 0, qz - b.maxZ);
      if (Math.hypot(dx, dz) < 4 && b.maxY > 0.3) console.log(`solid x ${b.minX.toFixed(2)}..${b.maxX.toFixed(2)} z ${b.minZ.toFixed(2)}..${b.maxZ.toFixed(2)} y ${b.minY.toFixed(1)}..${b.maxY.toFixed(1)}`);
    }
    process.exit(0);
  }
  const effectsStub: any = new Proxy({}, { get: () => () => {} });
  const moveCollide = (p: any, dx: number, dz: number, r: number) => {
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
  const playerPos = new THREE.Vector3(0, 0, 40);
  let playerAlive = true;
  const mgr = new TDMManager({
    scene, occluders: world.occluders, coverNodes: world.coverNodes, solids, half,
    groundHeight: gh, effects: effectsStub,
    playerPos: () => playerPos.clone().setY(1.62), playerFeet: () => playerPos.clone(),
    playerAlive: () => playerAlive,
    damagePlayer: () => {}, moveCollide,
    onCallout: () => {}, throwGrenade: () => {}, onBotFire: () => {},
    playerOnFire: () => false, onFeed: () => {}, onScore: () => {},
  } as any, {
    respawn: false, visionCone: true, objective: true, baseHp: 100, hpPerArmor: 0,
    headReduction: [0, 0, DEFUSE_HEAD_REDUCTION], bodyReduction: [0, DEFUSE_BODY_REDUCTION, DEFUSE_BODY_REDUCTION],
    accuracyMul: 0.9, reactionAdd: 0.1,
  });
  const fmt = formatById(process.env.FMT ?? 'standard');
  let simT = 0;
  const log: string[] = [];
  const stats: { attackWon: boolean; reason: string }[] = [];
  let over = false;
  let director: any = null;
  const pending: (() => void)[] = [];
  director = new DefuseDirector(mgr, {
    scene, groundHeight: gh,
    playerFeet: () => playerPos.clone(), playerAlive: () => playerAlive,
    placePlayer: (spawn: any) => { playerPos.copy(spawn); playerAlive = true; },
    explode: () => {},
    emit: (ev: any) => {
      const t = simT.toFixed(0).padStart(5);
      if (ev.type === 'round-start') {
        log.push(`${t} ROUND ${ev.round} player=${ev.side}${ev.pistol ? ' PISTOL' : ''}${ev.matchPoint ? ' MP:' + ev.matchPoint : ''}${ev.suddenDeath ? ' SUDDEN' : ''}`);
        // the sim has no human: the player dies at once (drops the bomb if carrying)
        pending.push(() => {
          playerAlive = false; director.playerDiedTo('SIM');
          // keep it 4v4 so side balance (not headcount) decides rounds
          const c = director.combatants.find((x: any) => x.team === 'bravo' && x.bot && !x.bot.dead && x.bot.name === 'Wraith');
          if (c) { c.bot.takeDamage(999, false, c.bot, false); (director as any).handleDeath(c, null, false, 'SIM'); }
        });
      } else if (ev.type === 'round-end') { const att = director.match.history[director.match.history.length - 1]; stats.push({ attackWon: ev.winner === (att.alphaSide === 'attack' ? 'alpha' : 'bravo'), reason: ev.reason }); log.push(`${t}   END winner=${ev.winner} (${ev.reason}) mvp=${ev.mvp} — ${ev.mvpWhy} · score ${ev.alphaScore}:${ev.bravoScore}${ev.halftime ? ' HALFTIME' : ''}${ev.over ? ' OVER' : ''}`); }
      else if (ev.type === 'bomb') log.push(`${t}   BOMB ${ev.what}${ev.site ? ' @' + ev.site : ''}${ev.by ? ' by ' + ev.by : ''}`);
      else if (ev.type === 'feed' && process.env.FEED) log.push(`${t}     ${ev.killer} [${ev.weapon}] ${ev.victim}${ev.zone ? ' ' + ev.zone : ''}`);
    },
    matchOver: (s: any) => { over = true; log.push(`MATCH OVER ${s.alphaScore}:${s.bravoScore} winner ${s.winner}`); for (const p of s.players) log.push(`  ${p.team} ${p.name.padEnd(8)} K${p.kills} D${p.deaths} A${p.assists} ADR${p.adr} MVP${p.mvps} P${p.plants} DF${p.defuses} $${p.money} ${p.weapon}`); },
  }, fmt, (process.env.SIDE as any) ?? 'attack');
  const dt = 1 / 30;
  const t0 = Date.now();
  const stuck = new Map<any, { t: number; lx: number; lz: number; worst: number; where: string }>();
  for (const b of mgr.bots) stuck.set(b, { t: 0, lx: b.pos.x, lz: b.pos.z, worst: 0, where: '' });
  const maxT = Number(process.env.MAXT ?? 4000);
  let frame = 0;
  while (!over && simT < maxT) {
    while (pending.length) pending.shift()!();
    mgr.update(dt);
    director.update(dt);
    simT += dt; frame++;
    if (frame % 15 === 0 && director.phase === 'live') {
      for (const b of mgr.bots) {
        const s = stuck.get(b)!;
        const moved = Math.hypot(b.pos.x - s.lx, b.pos.z - s.lz);
        const holding = b.orders && Math.hypot(b.pos.x - b.orders.goal.x, b.pos.z - b.orders.goal.z) < 1.5;
        if (b.dead || b.state !== 'PATROL' || holding || !b.orders) s.t = 0;
        else if (moved < 0.2) { s.t += 0.5; if (s.t > s.worst) { s.worst = s.t; s.where = `${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)} -> ${b.orders.goal.x.toFixed(1)},${b.orders.goal.z.toFixed(1)}`; } }
        else s.t = 0;
        s.lx = b.pos.x; s.lz = b.pos.z;
      }
    }
  }
  if (!process.env.QUIET) console.log(log.join('\n'));
  const aw = stats.filter(x => x.attackWon).length;
  const by: Record<string, number> = {};
  for (const x of stats) by[x.reason] = (by[x.reason] ?? 0) + 1;
  console.log(`STATS rounds ${stats.length} attackWins ${aw} reasons ${JSON.stringify(by)}`);
  console.log(`sim ${simT.toFixed(0)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s wall`);
  for (const [b, s] of stuck) if (s.worst >= 3) console.log(`  STUCK ${b.team} ${b.name} worst ${s.worst}s at ${s.where}`);
}
main().catch(e => { console.error('SIM FAIL:', e); process.exit(1); });
