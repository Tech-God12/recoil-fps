// Web Audio stand-in. Field-kit effects reuse the real detonation pipeline —
// glass, debris, spatial audio — so an engine test needs the audio layer to
// exist without a browser. Every unknown property resolves to a callable that
// returns another node, which is enough for a graph-building audio engine.
/**
 * AudioParam stand-in that actually remembers what was scheduled on it.
 *
 * The original stub swallowed setValueAtTime/ramps and left `.value` at 0,
 * which meant a test could not tell a carefully shaped envelope from silence —
 * any assertion about level or pitch was vacuous. Scheduling methods now record
 * into `.schedule` and update `.value` to the most recent target, so tests can
 * inspect the envelope a synth voice was built with.
 */
function makeParam() {
  const target = { value: 0, schedule: [] };
  const record = name => (value, time) => {
    if (typeof value === 'number') {
      target.schedule.push({ name, value, time });
      target.value = value;
    }
    return target;
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (typeof key === 'symbol') return undefined;
      if (typeof key === 'string' && /^(setValueAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setTargetAtTime)$/.test(key)) {
        return t[key] = record(key);
      }
      return t[key] = () => {};
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}

export function makeAudioNode() {
  return new Proxy({}, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      // Every AudioParam the engine touches: levels, filters, panner geometry,
      // compressor dynamics. They all need the scheduling methods.
      if (typeof key === 'string' && /^(gain|delayTime|frequency|Q|detune|pan|playbackRate|position|orientation|threshold|knee|ratio|attack|release|reduction)/.test(key)) {
        return target[key] ?? (target[key] = makeParam());
      }
      if (key in target) return target[key];
      return target[key] = (...args) => (key === 'connect' ? args[0] ?? makeAudioNode() : makeAudioNode());
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

/** Installs `window` with a working AudioContext constructor. Returns a restore fn. */
export function installAudioStub() {
  const previous = globalThis.window;
  class FakeAudioContext {
    constructor() {
      this.destination = makeAudioNode();
      this.listener = makeAudioNode();
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 48000;
    }
  }
  const Context = new Proxy(FakeAudioContext, {
    construct(Target, args) {
      const instance = new Target(...args);
      return new Proxy(instance, {
        get(target, key) {
          if (typeof key === 'symbol') return undefined;
          if (key in target) return target[key];
          return target[key] = () => makeAudioNode();
        },
        set(target, key, value) { target[key] = value; return true; },
      });
    },
  });
  globalThis.window = { AudioContext: Context, webkitAudioContext: Context, innerWidth: 1600, innerHeight: 900 };
  return () => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  };
}
