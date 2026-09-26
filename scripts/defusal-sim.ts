import '../tests/helpers/register-json.js';

/* Headless Bomb Defusal simulation: builds Sirocco + the DefusalMode under Node
 * (Proxy-stubbed canvas/document) and plays full matches bot-vs-bot with a
 * stand-in player parked at spawn. Uses the engine's real collision code.
 * Catches runtime crashes, stalled rounds, dead economies and stuck bots
 * without a browser. NOT part of the app.
 *   node --import ./tests/helpers/register-json.js scripts/defusal-sim.ts [matches=1] [format=short] [seed] */
/* eslint-disable @typescript-eslint/no-explicit-any */

const ctx2dHandler: ProxyHandler<any> = {
  get(target, prop) {
    if (prop === 'canvas') return target.canvas;
    if (prop in target) return target[prop];
    return () => {
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
// Web Audio stand-in: every node/param/call resolves to the same inert proxy.
const inert: any = new Proxy(function () { /* inert */ }, {
  get(_t, prop) {
    if (prop === 'currentTime') return 0;
    if (prop === 'state') return 'running';
    if (prop === 'sampleRate') return 44100;
    if (prop === 'getChannelData') return () => new Float32Array(4096);
    if (prop === 'then') return undefined;
    if (prop === Symbol.toPrimitive) return () => 0;
    return inert;
  },
  apply() { return inert; },
  construct() { return inert; },
  set() { return true; },
});
(globalThis as any).AudioContext = inert;

async function main() {
  const matches = Number(process.argv[2] ?? 1);
  const format = (process.argv[3] ?? 'short') as 'short' | 'long';
  let seed = Number(process.argv[4] ?? 1337);
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  Math.random = rng;

  const THREE = await import('three');
  const { buildWorld } = await import('../src/game/world');
  const { Engine } = await import('../src/game/engine');
  const { DefusalMode } = await import('../src/game/defusal/mode');

  const scene = new THREE.Scene();
  const world = buildWorld(scene, 'sirocco');
  const E: any = Engine.prototype;
  const phys: any = { world, solidGrid: new Map(), scratch: [], GRID_CELL: 4 };
  phys.nearSolids = E.nearSolids.bind(phys);
  E.buildSolidGrid.call(phys);
  const moveCollide = (p: any, dx: number, dz: number, r: number) => {
    E.moveAxis.call(phys, p, dx, dz, r, 1.7);
    p.y = E.supportHeight.call(phys, p, r);
  };
  const ray = new THREE.Raycaster();
  const effects: any = new Proxy({}, { get: () => () => {} });

  let totals = { rounds: 0, plants: 0, defuses: 0, explode: 0, elim: 0, time: 0, stalls: 0 };
  for (let mi = 0; mi < matches; mi++) {
    const player = { pos: new THREE.Vector3(0, 0, 35), hp: 100, alive: true };
    const pending: { kind: string; at: any; t: number; owner: any }[] = [];
    let ended = false;
    let mode: any = null;
    const log: string[] = [];
    mode = new DefusalMode({
      scene, occluders: world.occluders, coverNodes: world.coverNodes, solids: world.solids, half: world.half,
      groundHeight: world.groundHeight, effects, moveCollide,
      playerPos: () => new THREE.Vector3(player.pos.x, 1.62, player.pos.z),
      playerFeet: () => player.pos.clone(),
      playerAlive: () => player.alive,
      playerHp: () => player.hp,
      playerCanSee: (p: any) => {
        const eye = new THREE.Vector3(player.pos.x, 1.62, player.pos.z);
        const dir = p.clone().sub(eye); const dist = dir.length(); dir.normalize();
        ray.set(eye, dir); ray.far = dist - 0.3;
        return player.alive && ray.intersectObjects(world.occluders, false).length === 0;
      },
      damagePlayer: (amount: number, _from: any, killer: any, hit: any) => {
        if (!player.alive) return;
        const armor = mode.player.inv.armor;
        let dmg = amount;
        if (hit && ((hit.part === 'head' && armor >= 2) || (hit.part === 'torso' && armor >= 1))) dmg *= hit.armorRatio;
        player.hp -= dmg;
        mode.recordPlayerDamage(killer, Math.min(dmg, player.hp + dmg));
        if (player.hp <= 0) { player.hp = 0; player.alive = false; mode.playerKilled(killer, !!hit?.head, hit?.weapon ?? 'RIFLE'); }
      },
      throwGrenade: (_from: any, target: any, owner: any, kind: string) => pending.push({ kind, at: target.clone(), t: kind === 'smoke' ? 1.6 : kind === 'flash' ? 1.4 : 2.2, owner }),
      onBotFire: () => {},
      spawnPlayer: (at: any) => { player.pos.copy(at); player.hp = 100; player.alive = true; },
      equipPlayer: () => {},
      bombDetonated: (at: any) => { if (player.alive && player.pos.distanceTo(at) < 14) { player.alive = false; player.hp = 0; mode.playerKilled(null, false, 'C4'); } },
      onFeed: (k: string, w: string, v: string, hs: boolean, _t: string, zone: string) => log.push(`    ${k || '—'} [${w}${hs ? ' HS' : ''}] ${v} @ ${zone}`),
      onRadio: () => {},
      onCallout: () => {},
      announce: () => {},
      onMoney: () => {},
      earnWallet: () => {},
      onMatchEnd: () => { ended = true; },
    }, { side: mi % 2 ? 'defend' : 'attack', format, difficulty: 'Normal' }, rng);

    const dt = 1 / 30;
    let t = 0, lastRound = 0;
    const still = new Map<any, { x: number; z: number; t: number; worst: number }>();
    let roundStart = 0;
    const t0 = Date.now();
    while (!ended && t < 60 * 60) {
      // The parked stand-in hands the bomb straight to the squad; with ABSENT=1 it
      // also steps out when the round goes live (clean bot-vs-bot balance numbers).
      if (mode.bomb.carrier === mode.player) mode.playerDropBomb(new THREE.Vector3(0, 0, -1));
      if (process.env.ABSENT && mode.match.phase === 'live' && player.alive) { player.alive = false; player.hp = 0; mode.playerKilled(null, false, 'C4'); }
      mode.update(dt, { interact: false });
      for (let i = pending.length - 1; i >= 0; i--) {
        const g = pending[i];
        g.t -= dt;
        if (g.t > 0) continue;
        pending.splice(i, 1);
        if (g.kind === 'smoke') mode.spawnSmoke(g.at);
        else if (g.kind === 'flash') { for (const b of mode.bots) if (!b.dead && b.pos.distanceTo(g.at) < 10) b.applyStun(2.5); }
        else for (const b of mode.bots) {
          if (b.dead || b.team === g.owner.team) continue;
          const d = b.pos.distanceTo(g.at);
          if (d < 6 && b.takeDamage(d < 2.5 ? 95 : 95 * (1 - (d - 2.5) / 3.5), false, g.owner, false)) mode.handleKill(g.owner, b, false, 'FRAG');
        }
      }
      t += dt;
      const m = mode.match;
      if (process.env.TRACE && m.round === Number(process.env.TRACE) && (m.phase === 'live' || m.phase === 'planted') && Math.floor(t * 30) % 150 === 0) {
        const atk = mode.players.filter((c: any) => mode.sideOf(c) === 'attack');
        console.log(`  t=${(105 - m.clock).toFixed(0).padStart(3)} bomb=${mode.bomb.state}${mode.bomb.carrier ? ':' + mode.bomb.carrier.name : ''} exec=${(mode as any).executing} ` + atk.map((c: any) => c.bot ? `${c.name}${c.alive ? '' : '✝'}[${mode.debugTask(c.bot)} ${c.bot.state} ${c.bot.pos.x.toFixed(0)},${c.bot.pos.z.toFixed(0)}]` : `YOU${c.alive ? '' : '✝'}`).join(' '));
      }
      if (m.round !== lastRound) { lastRound = m.round; roundStart = t; still.clear(); }
      if (m.phase === 'live' || m.phase === 'planted') {
        for (const b of mode.bots) {
          if (b.dead) continue;
          const s = still.get(b) ?? { x: b.pos.x, z: b.pos.z, t: 0, worst: 0 };
          const busy = mode.bomb.defuser?.bot === b || mode.bomb.planter?.bot === b;
          if (Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < 0.05 && !b.holding && !busy && b.state === 'PATROL') { s.t += dt; s.worst = Math.max(s.worst, s.t); }
          else s.t = 0;
          s.x = b.pos.x; s.z = b.pos.z;
          still.set(b, s);
        }
      }
      if (m.phase === 'over' && m.clock > 4.95) {
        const r = m.lastRound;
        const alive = (team: string) => mode.players.filter((c: any) => c.team === team && c.alive).length;
        const stuck = [...still.entries()].filter(([, s]) => s.worst > 6).map(([b, s]) => `${b.name}@${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)}(${s.worst.toFixed(0)}s ${mode.debugTask(b)} ${b.state})`);
        const money = (team: string) => Math.round(mode.players.filter((c: any) => c.team === team).reduce((a: number, c: any) => a + c.inv.money, 0) / 5);
        console.log(`R${String(r.round).padStart(2)} ${r.winnerSide.padEnd(6)} ${r.reason.padEnd(11)} ${String(r.alphaScore).padStart(2)}-${String(r.bravoScore).padEnd(2)} planted=${r.planted ? 'Y' : 'n'} dur=${(t - roundStart - 10).toFixed(0)}s alive a${alive('alpha')} b${alive('bravo')} plan=${(mode as any).attack.style}${(mode as any).attack.site} buy a:${(mode as any).buyCalls.alpha} b:${(mode as any).buyCalls.bravo} $a${money('alpha')} $b${money('bravo')}${stuck.length ? ' STUCK ' + stuck.join(' ') : ''}`);
        if (process.env.FEED) for (const l of log) console.log(l);
        log.length = 0;
        totals.rounds++;
        if (r.planted) totals.plants++;
        if (r.reason === 'defuse') totals.defuses++;
        if (r.reason === 'bomb') totals.explode++;
        if (r.reason === 'elimination') totals.elim++;
        if (r.reason === 'time') totals.time++;
        if (stuck.length) totals.stalls++;
        // step past the >4.95 window
        mode.update(0.1, { interact: false }); t += 0.1;
      }
    }
    const res = mode.result();
    console.log(`MATCH ${mi + 1}: ${res.alphaScore}-${res.bravoScore} winner=${res.winner} rounds=${res.rounds} (${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${(t / 60).toFixed(1)} min game)`);
    for (const r of res.roster) console.log(`   ${r.team} ${r.name.padEnd(8)} K${r.kills} A${r.assists} D${r.deaths} MVP${r.mvps} dmg${r.damage}`);
    mode.dispose();
  }
  console.log('TOTALS', JSON.stringify(totals));
}
main().catch(e => { console.error('SIM FAIL:', e); process.exit(1); });
