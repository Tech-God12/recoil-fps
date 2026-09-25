/* Shared headless browser shim: stub WebGL2 context (every GL call answered, nothing
 * drawn), 2D canvas proxy, DOM/audio/speech stubs and a manual rAF queue. three.js
 * still does all CPU-side work (culling, sorting, uniform uploads, draw-call counting),
 * so renderer.info and CPU timings measured on top of it are real. NOT part of the app. */
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
export let rafQueue: ((t: number) => void)[] = [];
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
g.SpeechSynthesisUtterance = class { constructor(public text: string) {} };


export const takeRaf = () => { const q = rafQueue; rafQueue = []; return q; };
export { listeners, makeCanvas };
