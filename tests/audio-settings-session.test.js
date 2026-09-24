import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { Engine, DEFAULT_SETTINGS } = await import('../src/game/engine.ts');
const { SpatialAudioEngine } = await import('../src/game/audio.ts');
const engineSource = readFileSync(new URL('../src/game/engine.ts', import.meta.url), 'utf8');

test('High shadows use 3072²; audio/crosshair changes preserve adaptive scale and samples', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const pixels = [], composerPixels = [];
  let shadowResizes = 0, disposedShadows = 0;
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    userPR: 1, dynPR: .72, appliedPR: .72, adaptiveEnabled: true,
    adaptStep: 2, adaptLow: 1, adaptHigh: 2, adaptLockUntil: 900,
    adaptSamples: [.016, .018, .017],
    renderer: { setPixelRatio: value => pixels.push(value), shadowMap: { enabled: true, needsUpdate: false }, toneMappingExposure: 1 },
    composer: { setPixelRatio: value => composerPixels.push(value) },
    sunLight: { castShadow: true, shadow: {
      mapSize: { width: 2048, height: 2048, set(w, h) { this.width = w; this.height = h; shadowResizes++; } },
      map: { dispose() { disposedShadows++; } },
    } },
    bloom: { enabled: false, strength: 0 },
    vignettePass: { uniforms: { uVignette: { value: 0 }, uGrain: { value: 0 } }, enabled: false },
  });
  try {
    Engine.prototype.applySettings.call(engine, { ...DEFAULT_SETTINGS, shadowQuality: 'high', masterVolume: 42, crosshairSize: 13 });
    assert.equal(engine.sunLight.shadow.mapSize.width, 3072);
    assert.equal(engine.sunLight.shadow.mapSize.height, 3072);
    assert.equal(shadowResizes, 1);
    assert.equal(disposedShadows, 1, 'resize retires the old shadow target');
    assert.equal(1 - (3072 * 3072) / (4096 * 4096), 0.4375, 'High has 43.75% fewer texels than before');
    assert.equal(engine.adaptStep, 2);
    assert.equal(engine.dynPR, .72);
    assert.deepEqual(engine.adaptSamples, [.016, .018, .017]);
    assert.equal(engine.adaptLockUntil, 900);
    assert.deepEqual(pixels, [], 'unrelated settings must not reallocate the drawing buffer');
    assert.deepEqual(composerPixels, []);
    Engine.prototype.applySettings.call(engine, { ...DEFAULT_SETTINGS, shadowQuality: 'high', resolutionScale: 80 });
    assert.equal(engine.adaptStep, 0, 'an actual scale change resets the adaptive ladder');
    assert.deepEqual(engine.adaptSamples, []);
    assert.deepEqual(pixels, [.8]);
    assert.deepEqual(composerPixels, [.8], 'post-FX follows exactly the same resolution cap');
    engine.adaptSamples.push(.017);
    Engine.prototype.applySettings.call(engine, { ...DEFAULT_SETTINGS, shadowQuality: 'high', resolutionScale: 80, masterVolume: 30 });
    assert.deepEqual(engine.adaptSamples, [.017], 'a subsequent sound tweak leaves measurement history intact');
    Engine.prototype.applySettings.call(engine, { ...DEFAULT_SETTINGS, shadowQuality: 'high', resolutionScale: 80, adaptiveResolution: false });
    assert.equal(engine.adaptiveEnabled, false);
    assert.deepEqual(engine.adaptSamples, [], 'changing the adaptive policy resets only its own state');
    assert.equal(shadowResizes, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('one casing voice is a quiet, bounded, high-passed Web Audio event scheduled after the shot', () => {
  const starts = [], stops = [], ramps = [], filters = [];
  let disconnected = 0;
  const param = (name) => ({
    value: 0,
    setValueAtTime(value, time) { ramps.push([name, 'set', value, time]); },
    linearRampToValueAtTime(value, time) { ramps.push([name, 'linear', value, time]); },
    exponentialRampToValueAtTime(value, time) { ramps.push([name, 'exp', value, time]); },
  });
  const node = () => ({ connect(other) { return other; }, disconnect() { disconnected++; } });
  const voices = [];
  const ctx = {
    currentTime: 5, state: 'running',
    createBufferSource() {
      const src = { ...node(), playbackRate: { value: 1 },
        start(t, offset) { starts.push([t, offset]); }, stop(t) { stops.push(t); } };
      voices.push(src);
      return src;
    },
    createBiquadFilter() {
      const f = { ...node(), frequency: param('frequency'), Q: param('Q') };
      filters.push(f);
      return f;
    },
    createGain() { return { ...node(), gain: param('gain') }; },
  };
  const audio = new SpatialAudioEngine();
  Object.assign(audio, { ctx, master: node(), windStarted: true, noiseBuf: {} });
  const previousRandom = Math.random;
  Math.random = () => 0.5;
  try {
    audio.casingTick();
    audio.casingTick(0.95); // slow bolt action ejects after the chamber cycles
    assert.equal(voices.length, 2, 'one new voice per shot, no wall-clock timers');
    assert.deepEqual(starts.map(([t]) => +t.toFixed(3)), [5.22, 5.99]);
    assert.ok(stops.every((t, i) => t - starts[i][0] <= .069), 'each voice has a hard stop');
    assert.ok(filters.every(f => f.type === 'bandpass' || f.type === 'highpass'));
    assert.ok(filters.some(f => f.type === 'highpass' && f.frequency.value === 2200));
    assert.deepEqual(ramps.filter(row => row[0] === 'gain' && row[1] === 'linear').map(row => row[2]), [.07, .07]);
    for (const src of voices) src.onended();
    assert.ok(disconnected >= 6, 'ended nodes disconnect from the graph');
    const liveShot = engineSource.slice(engineSource.indexOf('private tryFire()'), engineSource.indexOf('private armLoadout('));
    assert.ok(liveShot.indexOf('this.mags[this.cur]--') < liveShot.indexOf('audio.casingTick('), 'no casing on a dry click');
    assert.equal((liveShot.match(/audio\.casingTick\(/g) ?? []).length, 1, 'one scheduled layer per primary report');
    assert.match(engineSource, /audio\.fireShotgun\(\);\s*audio\.casingTick\(0\.36\)/, 'the manual Masterkey also ejects');
  } finally { Math.random = previousRandom; }
});
