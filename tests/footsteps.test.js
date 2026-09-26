// A footstep used to be a single filtered noise blip, which is why every
// surface sounded like the same click at a different pitch. It is now a layered
// event — heel strike, body mass, sole scuff, loose-material crunch, kit rattle
// — and these tests assert the layers actually exist and actually differ per
// surface, rather than just asserting "some audio happened".
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installAudioStub } from './helpers/audio.js';

const restoreAudio = installAudioStub();
const { audio } = await import('../src/game/audio.ts');

/**
 * Capture the synth voices built during `fn`.
 *
 * Nodes are logged in creation order and then grouped: a source (buffer or
 * oscillator) claims every filter and gain created after it, up to the next
 * source. That mirrors how the audio engine builds a voice — source first, then
 * its filter chain — and gives one record per audible layer.
 */
function capture(fn) {
  const ctx = audio.ensure();
  const log = [];
  const real = {
    bufferSource: ctx.createBufferSource.bind(ctx),
    oscillator: ctx.createOscillator.bind(ctx),
    filter: ctx.createBiquadFilter.bind(ctx),
    gain: ctx.createGain.bind(ctx),
  };
  ctx.createBiquadFilter = () => { const f = real.filter(); log.push({ type: 'filter', node: f }); return f; };
  ctx.createGain = () => { const g = real.gain(); log.push({ type: 'gain', node: g }); return g; };
  ctx.createBufferSource = () => { const s = real.bufferSource(); log.push({ type: 'noise', node: s }); return s; };
  ctx.createOscillator = () => { const o = real.oscillator(); log.push({ type: 'tone', node: o }); return o; };
  try { fn(); } finally {
    ctx.createBufferSource = real.bufferSource;
    ctx.createOscillator = real.oscillator;
    ctx.createBiquadFilter = real.filter;
    ctx.createGain = real.gain;
  }

  const voices = [];
  let current = null;
  for (const entry of log) {
    if (entry.type === 'noise' || entry.type === 'tone') {
      current = { kind: entry.type, osc: entry.node, filters: [], gains: [] };
      voices.push(current);
    } else if (current) {
      current[entry.type === 'filter' ? 'filters' : 'gains'].push(entry.node);
    }
  }
  return voices;
}

/** Loudest level ever scheduled on any gain in this set of voices. */
function peakGain(voices) {
  let peak = 0;
  for (const v of voices) {
    for (const g of v.gains) {
      for (const e of g.gain.schedule ?? []) peak = Math.max(peak, e.value);
    }
  }
  return peak;
}

/** Filter centre frequencies touched by a captured set of noise layers. */
function noiseFreqs(events) {
  const out = [];
  for (const e of events) {
    if (e.kind !== 'noise') continue;
    for (const f of e.filters) if (typeof f.frequency?.value === 'number' && f.frequency.value > 0) out.push(f.frequency.value);
  }
  return out;
}

/**
 * The heel strike is emitted first and is the only fully deterministic layer,
 * which makes it the honest way to compare one surface's voicing with another's
 * — the scuff, crunch and gear layers are jittered on purpose.
 */
function heelFreq(events) {
  const first = events.find(e => e.kind === 'noise');
  return first.filters[0].frequency.value;
}

const SURFACES = ['sand', 'concrete', 'wood'];

test('a walking footstep is a layered event, not one blip', () => {
  for (const surface of SURFACES) {
    const events = capture(() => audio.footstep(surface, false, false));
    const noise = events.filter(e => e.kind === 'noise');
    const tones = events.filter(e => e.kind === 'tone');
    assert.ok(noise.length >= 3, `${surface}: only ${noise.length} noise layers — heel, scuff and gear are the minimum`);
    assert.equal(tones.length, 1, `${surface}: expected exactly one low body thump, got ${tones.length}`);
  }
});

test('the body thump is a real pitch drop, not a beep', () => {
  const events = capture(() => audio.footstep('wood', false, false));
  const tone = events.find(e => e.kind === 'tone');
  assert.ok(tone, 'no body layer at all');
  // Below the vocal range, or it will not read as weight.
  const pitches = tone.osc.frequency.schedule.map(e => e.value);
  assert.ok(pitches.length >= 2, 'body layer holds one pitch — that is a beep, not an impact');
  assert.ok(pitches[0] <= 220, `body layer starts at ${pitches[0]} Hz, too high to read as mass`);
  assert.ok(pitches.at(-1) < pitches[0], 'body layer must drop in pitch as it decays');
  assert.ok(pitches.at(-1) >= 30, 'body layer decays below anything a speaker will reproduce');
});

test('surfaces are genuinely different voicings, not one filter sweep', () => {
  const profile = surface => {
    let layers = 0, heelLo = Infinity, heelHi = 0, lowest = Infinity;
    for (let i = 0; i < 8; i++) {
      const events = capture(() => audio.footstep(surface, false, false));
      layers += events.filter(e => e.kind === 'noise').length;
      const heel = heelFreq(events);
      heelLo = Math.min(heelLo, heel); heelHi = Math.max(heelHi, heel);
      lowest = Math.min(lowest, ...noiseFreqs(events));
    }
    return { heelLo, heelHi, lowest, layers: layers / 8 };
  };
  const sand = profile('sand'), concrete = profile('concrete'), wood = profile('wood');
  // Concrete is the bright, hard one; sand is the dull, soft one.
  assert.ok(concrete.heelLo > sand.heelHi, `concrete heel (${concrete.heelLo}) must sit clearly above sand (${sand.heelHi})`);
  assert.ok(sand.lowest < concrete.lowest, 'sand should reach lower than concrete');
  // Wood sits between the two rather than duplicating either.
  assert.ok(wood.heelHi < concrete.heelLo && wood.heelLo > sand.heelHi, 'wood is not its own voicing');
  // Loose surfaces add discrete crunch grains, so they use more layers.
  assert.ok(concrete.layers > sand.layers, `concrete (${concrete.layers}) should add crunch grains sand (${sand.layers}) does not`);
});

test('crouching removes the gear and the crunch, not just the volume', () => {
  const loud = capture(() => audio.footstep('concrete', false, false)).filter(e => e.kind === 'noise').length;
  const quiet = capture(() => audio.footstep('concrete', false, true)).filter(e => e.kind === 'noise').length;
  assert.ok(quiet < loud, `crouched step used ${quiet} layers vs ${loud} standing — soft-footing must drop layers`);
});

test('consecutive steps alternate feet instead of repeating', () => {
  // Pitch alternates per foot, so two consecutive body layers must differ.
  const a = capture(() => audio.footstep('wood', false, false)).find(e => e.kind === 'tone');
  const b = capture(() => audio.footstep('wood', false, false)).find(e => e.kind === 'tone');
  assert.notEqual(a.osc.frequency.schedule[0].value, b.osc.frequency.schedule[0].value, 'both feet sound identical');
});

test('sprinting is louder and lands harder than walking', () => {
  const peak = peakGain;
  const walk = peak(capture(() => audio.footstep('concrete', false, false)));
  const sprint = peak(capture(() => audio.footstep('concrete', true, false)));
  assert.ok(sprint > walk, `sprint peak ${sprint} is not above walk peak ${walk}`);
});

test('sound traps are unmistakably louder than the floor they sit on', () => {
  const peak = peakGain;
  const floor = peak(capture(() => audio.footstep('concrete', false, false)));
  const glass = peak(capture(() => audio.footstepTrap('glass', false, false)));
  const gravel = peak(capture(() => audio.footstepTrap('gravel', false, false)));
  assert.ok(glass > floor * 1.3, 'stepping in glass must be an audible mistake');
  assert.ok(gravel > floor * 1.3, 'stepping in gravel must be an audible mistake');
});

test('landing and sliding reuse the footstep voice instead of inventing one', () => {
  for (const surface of SURFACES) {
    const land = capture(() => audio.jumpLand(surface));
    assert.ok(land.filter(e => e.kind === 'noise').length >= 4, `${surface}: landing is thinner than a footstep`);
    assert.ok(land.filter(e => e.kind === 'tone').length >= 2, `${surface}: landing needs its own heavy impact tone`);
    const slide = capture(() => audio.slideDrag(surface));
    assert.ok(slide.filter(e => e.kind === 'noise').length >= 3, `${surface}: slide is a single burst again`);
  }
});

test.after(() => restoreAudio());
