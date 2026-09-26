/* Headless UI smoke test: loads the REAL built bundle (dist/index.html) into jsdom
 * with the same stub WebGL2 context the engine smoke tests use, then drives the
 * menus with real clicks the way a player would, reporting every console error /
 * uncaught exception along the way.
 *   node scripts/ui-smoke.mjs [dist-uitest/index.html]
 * NOT part of the app. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

/* ---------------- stub WebGL2 (mirrors scripts/headless-shim.ts) ---------------- */
const GL_NAMES = new Map();
const glConst = name => { let h = 0x8000; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xFFFFF; GL_NAMES.set(h, name); return h; };
function fakeGL(canvas) {
  const obj = () => ({});
  const target = {
    canvas,
    drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getParameter: p => {
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
    getProgramParameter: (_p, pname) => { const n = GL_NAMES.get(pname) ?? ''; return n.startsWith('ACTIVE_') ? 0 : true; },
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
const ctx2d = canvas => new Proxy({ canvas }, {
  get(t, prop) {
    if (prop in t) return t[prop];
    return () => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return { addColorStop: () => {} };
      if (prop === 'getImageData') return { data: new Uint8ClampedArray(4 * 64 * 64), width: 64, height: 64 };
      if (prop === 'measureText') return { width: 1 };
      return undefined;
    };
  },
  set(t, prop, v) { t[prop] = v; return true; },
});
const inert = new Proxy(function () {}, {
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

export function boot(file = 'dist-uitest/index.html') {
  const html = readFileSync(file, 'utf8');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => { if (!/Could not parse CSS/.test(e.message)) errors.push(`jsdomError: ${e.message.split('\n').slice(0, 4).join(' | ')}`); });
  virtualConsole.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:4173/', virtualConsole,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function (kind) {
        if (kind === '2d') return ctx2d(this);
        if (typeof kind === 'string' && kind.startsWith('webgl')) return fakeGL(this);
        return null;
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
      window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb?.(null); };
      window.HTMLCanvasElement.prototype.requestPointerLock = function () {
        window.document.pointerLockElement = this;
        window.document.dispatchEvent(new window.Event('pointerlockchange'));
      };
      window.document.exitPointerLock = () => {
        window.document.pointerLockElement = null;
        window.document.dispatchEvent(new window.Event('pointerlockchange'));
      };
      window.AudioContext = inert;
      window.webkitAudioContext = inert;
      window.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, speaking: false, pending: false };
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      window.matchMedia = window.matchMedia ?? (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.devicePixelRatio = 1;
      window.structuredClone = window.structuredClone ?? (v => JSON.parse(JSON.stringify(v)));
      window.addEventListener('error', e => errors.push(`uncaught: ${e.message}\n${(e.error?.stack ?? '').split('\n').slice(0, 5).join('\n')}`));
      window.addEventListener('unhandledrejection', e => errors.push(`unhandled rejection: ${e.reason?.stack ?? e.reason}`));
    },
  });
  const { window } = dom;
  const { document } = window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const root = () => document.getElementById('root');
  const screenText = () => (root()?.textContent ?? '').replace(/\s+/g, ' ');
  const has = needle => screenText().toLowerCase().includes(needle.toLowerCase());
  const byText = needle => [...document.querySelectorAll('button, [role="option"], a')]
    .filter(el => (el.textContent ?? '').replace(/\s+/g, ' ').toLowerCase().includes(needle.toLowerCase()));
  const describe = el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 55)}"`;
  const fire = (el, type = 'click') => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  async function click(needle, { optional = false, match = 0 } = {}) {
    const hits = byText(needle);
    if (hits.length <= match) {
      if (optional) { console.log(`  · nothing matches "${needle}"`); return null; }
      throw new Error(`no clickable element matching "${needle}" — screen: ${screenText().slice(0, 200)}`);
    }
    const el = hits[match];
    console.log(`  click ${describe(el)}`);
    fire(el);
    await sleep(150);
    return el;
  }
  const bootGone = () => !document.querySelector('.boot-root');
  async function waitBoot(maxMs = 90000) {
    let t = 0;
    while (t < maxMs && !bootGone()) { await sleep(250); t += 250; }
    return { ms: t, gone: bootGone() };
  }
  return { window, document, sleep, screenText, has, byText, describe, click, fire, waitBoot, bootGone, errors };
}
