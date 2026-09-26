/* Headless ENGINE smoke test for Bomb Defusal. Boots the real Engine on Sirocco
 * against a stub WebGL2 context (every GL call answered, nothing drawn), then
 * drives frames and input: buy menu purchases, weapon swaps, grenades incl. smoke,
 * bomb drop, radio orders, damage, death → spectate, round transitions and HUD.
 * Catches runtime exceptions in the engine glue without a browser. NOT part of the app.
 *   node --import ./tests/helpers/register-json.js scripts/defusal-engine-smoke.ts [seconds=240] */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- DOM / audio shims ----------
const ctx2dHandler: ProxyHandler<any> = {
  get(target, prop) {
    if (prop === 'canvas') return target.canvas;
    if (prop in target) return target[prop];
    return () => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return { addColorStop: () => {} };
      if (prop === 'getImageData') return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
      if (prop === 'measureText') return { width: 1 };
      return undefined;
    };
  },
  set(target, prop, value) { target[prop] = value; return true; },
};
const GL_NAMES = new Map<number, string>();
const glConst = (name: string) => { let h = 0x8000; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xFFFFF; GL_NAMES.set(h, name); return h; };
function fakeGL(canvas: any): any {
  const obj = () => ({});
  const target: any = {
    canvas,
    drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getParameter: (p: number) => {
      const n = GL_NAMES.get(p) ?? '';
      if (n === 'VERSION') return 'WebGL 2.0 (stub)';
      if (n === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00 (stub)';
      if (n === 'VIEWPORT' || n === 'SCISSOR_BOX') return new Int32Array([0, 0, 1280, 720]);
      if (n.startsWith('MAX_')) return n.includes('TEXTURE_SIZE') || n.includes('RENDERBUFFER') ? 8192 : 32;
      if (n === 'SAMPLES') return 4;
      return 0;
    },
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' }),
    isContextLost: () => false,
    getError: () => 0,
    getShaderParameter: () => true,
    getProgramParameter: (_p: any, pname: number) => { const n = GL_NAMES.get(pname) ?? ''; return n.startsWith('ACTIVE_') ? 0 : true; },
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', getShaderSource: () => '',
    getAttribLocation: () => -1, getUniformLocation: () => obj(), getUniformBlockIndex: () => 0,
    checkFramebufferStatus: () => glConst('FRAMEBUFFER_COMPLETE'),
    createTexture: obj, createBuffer: obj, createFramebuffer: obj, createRenderbuffer: obj,
    createProgram: obj, createShader: obj, createVertexArray: obj, createQuery: obj, createSampler: obj,
    fenceSync: obj, clientWaitSync: () => glConst('ALREADY_SIGNALED'),
    getActiveUniform: () => null, getActiveAttrib: () => null,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) return glConst(prop);
      return () => undefined;
    },
  });
}
function makeCanvas() {
  const c: any = {
    width: 1280, height: 720, style: {}, clientWidth: 1280, clientHeight: 720,
    addEventListener: () => {}, removeEventListener: () => {},
    getContext: (kind: string) => (kind === '2d' ? new Proxy({ canvas: c }, ctx2dHandler) : kind.startsWith('webgl') ? fakeGL(c) : null),
    toDataURL: () => 'data:image/png;base64,',
    requestPointerLock: async () => { (globalThis as any).document.pointerLockElement = c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  return c;
}
const listeners = new Map<string, ((e: any) => void)[]>();
const g = globalThis as any;
g.window = globalThis;
g.self = globalThis;
g.document = {
  createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : { style: {}, addEventListener: () => {} }),
  createElementNS: () => makeCanvas(),
  addEventListener: () => {}, removeEventListener: () => {},
  pointerLockElement: null, exitPointerLock: () => { g.document.pointerLockElement = null; }, hidden: false,
};
g.addEventListener = (type: string, fn: any) => { const l = listeners.get(type) ?? []; l.push(fn); listeners.set(type, l); };
g.removeEventListener = () => {};
g.devicePixelRatio = 1; g.innerWidth = 1280; g.innerHeight = 720;
let rafQueue: ((t: number) => void)[] = [];
g.requestAnimationFrame = (fn: any) => { rafQueue.push(fn); return rafQueue.length; };
g.cancelAnimationFrame = () => {};
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
  apply() { return inert; }, construct() { return inert; }, set() { return true; },
});
g.AudioContext = inert;
g.speechSynthesis = { getVoices: () => [], speak: () => {}, cancel: () => {}, pause: () => {}, resume: () => {}, speaking: false, pending: false };
g.SpeechSynthesisUtterance = class { text: string; constructor(text: string) { this.text = text; } };

async function main() {
  const seconds = Number(process.argv[2] ?? 240);
  let seed = 4242;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const THREE = await import('three');
  const { Engine } = await import('../src/game/engine');
  const { DEFAULT_PROFILE, buildForWeapon } = await import('../src/game/economy/profile');
  const events: Record<string, number> = {};
  let ended: any = null;
  const canvas = makeCanvas();
  const builds = Object.fromEntries(DEFAULT_PROFILE.ownedWeapons.map((id: any) => [id, buildForWeapon(DEFAULT_PROFILE, id)]));
  // Let the staged init's nextFrame() awaits resolve.
  const pump = setInterval(() => { const q = rafQueue; rafQueue = []; for (const fn of q) fn(performance.now()); }, 1);
  const t0 = Date.now();
  let engine: any = await Engine.create(canvas, 'Normal', (e: any) => {
    events[e.type] = (events[e.type] ?? 0) + 1;
    if (e.type === 'end') ended = e;
  }, 'sirocco', DEFAULT_PROFILE.loadout, 1, { mode: 'defusal', side: 'attack', format: 'short', builds });
  clearInterval(pump);
  console.log(`ENGINE UP in ${Date.now() - t0} ms — weapons cached: ${engine.dfWeaponCache.size}`);
  engine.applySettings((await import('../src/game/engine')).DEFAULT_SETTINGS);
  engine.start();
  g.document.pointerLockElement = canvas;
  engine.setPaused(false);

  const key = (type: 'keydown' | 'keyup', code: string) => { for (const fn of listeners.get(type) ?? []) fn({ code, repeat: false, preventDefault() {} }); };
  const mouse = (type: 'mousedown' | 'mouseup', button = 0) => { for (const fn of listeners.get(type) ?? []) fn({ button, preventDefault() {} }); };
  const tap = (code: string) => { key('keydown', code); key('keyup', code); };
  let now = performance.now();
  const step = (sec: number) => {
    const frames = Math.round(sec * 30);
    for (let i = 0; i < frames; i++) {
      now += 1000 / 30;
      const q = rafQueue; rafQueue = [];
      for (const fn of q) fn(now);
    }
  };
  const hud = () => engine.hud();
  const log = (label: string) => {
    const h = hud(); const d = h.defusal;
    console.log(`${label.padEnd(26)} R${d.round} ${d.phase.padEnd(8)} clock=${d.clock.toFixed(1).padStart(5)} $${d.money} hp=${h.hp} weapon=${h.weapon}/${h.secondaryWeapon || '-'} armor=${d.armor} nades F${h.frags}/${h.flashes}/S${d.smokes} bomb=${d.bombState}${d.hasBomb ? '(you)' : ''} score ${d.alphaScore}-${d.bravoScore} dead=${d.playerDead}${h.spectating ? ' spec=' + h.spectating.name : ''}${d.prompt ? ' prompt="' + d.prompt + '"' : ''}`);
  };

  const V3 = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error('EXPECTATION FAILED: ' + msg); console.log('  ✓ ' + msg); };
  const mode = engine.defusal;

  // ================= SCENARIO A: the player plants on A =================
  step(10.3);
  expect(hud().defusal.phase === 'live', 'round goes live after freeze time');
  mode.giveBomb(mode.player);
  // Park the defenders on B, stunned, so the scripted plant is deterministic.
  for (const c of mode.players) if (c.bot && c.team === 'bravo') { c.bot.pos.copy(V3(33 + Math.random() * 4, -30 + Math.random() * 4)); c.bot.applyStun(30); }
  engine.pos.copy(V3(-29, -32.6)); engine.lastPos.copy(engine.pos);
  step(0.2);
  expect(hud().defusal.hasBomb && /PLANT/.test(hud().defusal.prompt ?? ''), 'carrier on site sees the plant prompt');
  key('keydown', 'KeyW'); key('keydown', 'KeyX'); step(1.5);
  const midPlant = hud().defusal.plantProgress;
  const lockedPos = engine.pos.clone();
  step(1.5);
  const stillArming = engine.pos.distanceTo(lockedPos);
  step(0.5); key('keyup', 'KeyX'); key('keyup', 'KeyW');
  expect(midPlant > 0.3 && midPlant < 0.7, `plant progress advances (${midPlant.toFixed(2)} at 1.5s)`);
  expect(stillArming < 0.05, 'movement is locked while arming (W held the whole time)');
  expect(hud().defusal.bombState === 'planted' && hud().defusal.bombSite === 'A', 'bomb planted on A after 3.2s');
  expect(hud().defusal.money >= 300, 'planter paid the personal $300');
  const bombPos = mode.bomb.pos.clone();
  // Everyone clear out: the blast must kill anyone who stays.
  engine.pos.copy(V3(0, 35)); engine.lastPos.copy(engine.pos);
  for (let i = 0; i < 44 && hud().defusal.phase !== 'over'; i++) step(1);
  const rec = mode.match.lastRound;
  expect(!!rec && rec.round === 1, `round 1 ended (${rec?.reason}, winner ${rec?.winnerSide})`);
  console.log(`  bomb at ${bombPos.x.toFixed(1)},${bombPos.z.toFixed(1)} — outcome ${rec?.reason}`);
  engine.dispose();

  // ================= SCENARIO B: defender defuse + pickup =================
  const engine2: any = await (async () => {
    const pump2 = setInterval(() => { const q = rafQueue; rafQueue = []; for (const fn of q) fn(performance.now()); }, 1);
    const e2 = await Engine.create(canvas, 'Normal', (e: any) => { events[e.type] = (events[e.type] ?? 0) + 1; }, 'sirocco', DEFAULT_PROFILE.loadout, 1, { mode: 'defusal', side: 'defend', format: 'short', builds });
    clearInterval(pump2);
    return e2;
  })();
  engine2.applySettings((await import('../src/game/engine')).DEFAULT_SETTINGS);
  engine2.start();
  engine2.setPaused(false);
  const m2 = engine2.defusal;
  const hud2 = () => engine2.hud();
  const step2 = (sec: number) => { for (let i = 0; i < Math.round(sec * 30); i++) { now += 1000 / 30; const q = rafQueue; rafQueue = []; for (const fn of q) fn(now); } };
  engine2.setBuyMenuOpen(true);
  expect(!engine2.buyItem('ak47').ok, 'defenders cannot buy the attackers-only AK-47');
  engine2.setBuyMenuOpen(false);
  step2(10.3);
  // An attacker plants, then the whole attacking team is wiped: defenders must still defuse.
  const attackers = m2.players.filter((c: any) => m2.sideOf(c) === 'attack');
  const planter = attackers.find((c: any) => c.bot)!;
  m2.giveBomb(planter);
  planter.bot.pos.copy(V3(30.5, -31.6));
  m2.plantBomb(planter, V3(30.5, -31.6));
  expect(hud2().defusal.bombState === 'planted', 'bot planted on B');
  let gun: string | null = null;
  for (const c of attackers) {
    if (!c.alive) continue;
    gun = gun ?? c.inv.primary ?? c.inv.secondary;
    c.bot.takeDamage(999, false, 'player', false);
    m2.handleKill('player', c.bot, false, 'm4a1');
  }
  step2(0.2);
  expect(hud2().defusal.phase === 'planted', 'round continues after the attackers die with the bomb down');
  // Pick up a dropped gun (every dead attacker dropped at least a pistol-class weapon or better).
  const drop = m2.drops[0];
  if (drop) {
    engine2.pos.copy(drop.pos); engine2.lastPos.copy(engine2.pos); engine2.pos.y = 0;
    step2(0.1);
    const before = hud2().weapon;
    expect(/PICK UP/.test(hud2().defusal.prompt ?? ''), `pickup prompt shows (${hud2().defusal.prompt})`);
    key('keydown', 'KeyX'); key('keyup', 'KeyX'); step2(0.4);
    expect(hud2().weapon !== before || hud2().secondaryWeapon !== '', `picked up ${drop.weapon} (now ${hud2().weapon})`);
  }
  // Keep the bots away from the bomb so the player gets the defuse.
  for (const c of m2.players) if (c.bot && c.alive) c.bot.pos.copy(V3(0, -38));
  engine2.pos.copy(V3(30.5, -30.4)); engine2.lastPos.copy(engine2.pos);
  step2(0.1);
  expect(/DEFUSE/.test(hud2().defusal.prompt ?? ''), 'defuse prompt next to the bomb');
  key('keydown', 'KeyX'); step2(4.9);
  const dp = hud2().defusal.defuseProgress;
  expect(dp > 0.4 && dp < 0.6 && hud2().defusal.defuserIsPlayer, `defuse without kit ~50% at 4.9s (${dp.toFixed(2)})`);
  step2(5.4); key('keyup', 'KeyX');
  const rec2 = m2.match.lastRound;
  expect(rec2?.reason === 'defuse' && rec2.winnerSide === 'defend', 'defenders win by defuse');
  expect(m2.player.defuses === 1, 'defuse credited to the player');
  engine2.dispose();
  console.log('SCENARIOS PASSED');
  if (seconds <= 0) return;

  // ================= free play on a fresh match =================
  {
    const pump3 = setInterval(() => { const q = rafQueue; rafQueue = []; for (const fn of q) fn(performance.now()); }, 1);
    engine = await Engine.create(canvas, 'Normal', (e: any) => { events[e.type] = (events[e.type] ?? 0) + 1; if (e.type === 'end') ended = e; }, 'sirocco', DEFAULT_PROFILE.loadout, 1, { mode: 'defusal', side: 'attack', format: 'short', builds });
    clearInterval(pump3);
    engine.applySettings((await import('../src/game/engine')).DEFAULT_SETTINGS);
    engine.start();
    engine.setPaused(false);
  }
  step(0.5); log('freeze start');
  // ---- buy phase: open menu, purchase a loadout through the engine API ----
  tap('KeyB');
  console.log('buymenu events:', events.buymenu ?? 0);
  engine.setBuyMenuOpen(true);
  for (const id of ['kevlar', 'deagle', 'flash', 'smoke', 'ak47', 'awm']) console.log(`  buy ${id}:`, JSON.stringify(engine.buyItem(id)));
  engine.setBuyMenuOpen(false);
  log('after buys');
  step(10.5); log('round live');
  // ---- use utility and weapons ----
  tap('Digit2'); step(0.4); tap('Digit1'); step(0.4);
  key('keydown', 'KeyW'); step(1.5); key('keyup', 'KeyW');
  tap('KeyZ'); step(0.2); tap('KeyF'); step(2.5);
  mouse('mousedown'); step(0.5); mouse('mouseup');
  key('keydown', 'KeyG'); step(0.6); key('keyup', 'KeyG'); step(3);
  tap('KeyR'); step(2.5);
  tap('Digit6'); tap('Digit8'); step(0.5); tap('Digit8');
  if (hud().defusal.hasBomb) { tap('Digit5'); step(0.3); }
  log('after actions');
  // ---- play on: let the bots fight; die to them; spectate; next rounds ----
  let lastRound = hud().defusal.round;
  let deaths = 0, specChecks = 0;
  const tEnd = seconds;
  for (let t = 0; t < tEnd && !ended; t += 1) {
    step(1);
    const h = hud(); const d = h.defusal;
    if (d.playerDead) { deaths++; if (deaths % 7 === 1) { mouse('mousedown'); mouse('mouseup'); step(0.1); if (hud().spectating) specChecks++; } }
    // walk toward mid now and then so the player meets the enemy
    if (!d.playerDead && d.phase === 'live' && t % 9 === 0) { key('keydown', 'KeyW'); step(1.2); key('keyup', 'KeyW'); mouse('mousedown'); step(0.6); mouse('mouseup'); }
    if (d.round !== lastRound) {
      lastRound = d.round;
      log(`round ${d.round} start`);
      if (d.buyOpen) { engine.setBuyMenuOpen(true); console.log('  autobuy-ish:', ['ak47', 'm4a1', 'helmet', 'kit', 'smoke'].map(id => engine.buyItem(id).ok ? id : '·').join(' ')); engine.setBuyMenuOpen(false); }
    }
  }
  log('final');
  console.log('events:', JSON.stringify(events));
  console.log('spectate checks passed:', specChecks, 'dead seconds:', deaths);
  if (ended) console.log(`MATCH END → win=${ended.win} kills=${ended.kills} score ${ended.defusal.alphaScore}-${ended.defusal.bravoScore} rounds=${ended.defusal.rounds} cash=${ended.cash}`);
  engine.dispose();
  console.log('DISPOSED OK');
  void THREE;
}
main().catch(e => { console.error('ENGINE SMOKE FAIL:', e); process.exit(1); });
