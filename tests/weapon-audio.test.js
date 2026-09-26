// Gunfire is the most-heard sound in the game, and two things about it were
// wrong: the MCX Spear had no voice of its own and fell through to the PDW
// zip, and nothing in the mix acknowledged that a loud report briefly raises
// your hearing threshold.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installAudioStub } from './helpers/audio.js';

const restoreAudio = installAudioStub();
const { audio } = await import('../src/game/audio.ts');
const { WEAPON_CATALOG } = await import('../src/game/economy/catalog.ts');

/** Names of every per-weapon fire voice the engine can dispatch to. */
const FIRE_VOICES = [
  'fireM4', 'fireAK', 'firePistol', 'fireSniper', 'fireSMG', 'fireShotgun',
  'fireSCAR', 'fireVector', 'fireLMG', 'fireDeagle', 'fireSpear',
];

test('every audio tag in the catalog has a dedicated fire voice', () => {
  // The Spear shipped mapped to the tag `spear` with no fireSpear(), so it
  // silently played the 4.6 mm PDW sound. This makes that class of mistake loud.
  const tags = new Set(WEAPON_CATALOG.map(w => w.audio));
  const byTag = {
    m4: 'fireM4', ak: 'fireAK', pistol: 'firePistol', sniper: 'fireSniper',
    smg: 'fireSMG', shotgun: 'fireShotgun', scar: 'fireSCAR', vector: 'fireVector',
    lmg: 'fireLMG', deagle: 'fireDeagle', spear: 'fireSpear',
  };
  for (const tag of tags) {
    assert.ok(byTag[tag], `audio tag '${tag}' has no mapping`);
    assert.equal(typeof audio[byTag[tag]], 'function', `${tag} -> ${byTag[tag]} does not exist`);
  }
});

/** Capture the filter frequencies and peak gains a fire voice schedules. */
function voiceProfile(name) {
  const ctx = audio.ensure();
  const realFilter = ctx.createBiquadFilter.bind(ctx);
  const realGain = ctx.createGain.bind(ctx);
  const realOsc = ctx.createOscillator.bind(ctx);
  const freqs = [];
  const gains = [];
  let layers = 0;
  ctx.createBiquadFilter = () => { const f = realFilter(); freqs.push(f); layers++; return f; };
  ctx.createGain = () => { const g = realGain(); gains.push(g); return g; };
  ctx.createOscillator = () => { const o = realOsc(); layers++; return o; };
  try { audio[name](); } finally {
    ctx.createBiquadFilter = realFilter;
    ctx.createGain = realGain;
    ctx.createOscillator = realOsc;
  }
  const hz = freqs.map(f => f.frequency.value).filter(v => v > 0);
  const peak = Math.max(0, ...gains.flatMap(g => (g.gain.schedule ?? []).map(e => e.value)));
  return { layers, peak, low: Math.min(...hz), high: Math.max(...hz) };
}

test('every fire voice is a layered report, not a single filtered pop', () => {
  for (const name of FIRE_VOICES) {
    const p = voiceProfile(name);
    assert.ok(p.layers >= 3, `${name}: only ${p.layers} layers`);
    assert.ok(p.peak > 0.2, `${name}: peak ${p.peak} is inaudible`);
  }
});

test('the Spear reads as a full-power rifle, distinct from the PDW it used to borrow', () => {
  const spear = voiceProfile('fireSpear');
  const smg = voiceProfile('fireSMG');
  const scar = voiceProfile('fireSCAR');
  // Real low end: the 4.6 mm PDW deliberately has almost none.
  assert.ok(spear.low < smg.low, `Spear low ${spear.low} must reach under the PDW's ${smg.low}`);
  assert.ok(spear.low <= 130, 'a 6.8x51 needs genuine full-power low end');
  // Higher chamber pressure than the SCAR means a harder, brighter crack.
  assert.ok(spear.high > scar.high, `Spear crack ${spear.high} should be brighter than the SCAR's ${scar.high}`);
  // And it must not simply be a copy of any existing voice.
  for (const other of FIRE_VOICES.filter(n => n !== 'fireSpear')) {
    const o = voiceProfile(other);
    assert.ok(spear.low !== o.low || spear.high !== o.high, `fireSpear duplicates ${other}`);
  }
});

test('a loud report masks the mix, and a quiet one barely does', () => {
  const ctx = audio.ensure();
  const readPlan = fn => {
    audio.deafen.gain.schedule.length = 0;
    audio.deafenLp.frequency.schedule.length = 0;
    fn();
    return {
      gain: audio.deafen.gain.schedule.map(e => e.value),
      cutoff: audio.deafenLp.frequency.schedule.map(e => e.value),
    };
  };

  const loud = readPlan(() => audio.earProtect(1));
  const floor = Math.min(...loud.gain);
  assert.ok(floor < 0.7, `a .338 should duck hard, floor was ${floor}`);
  assert.ok(Math.max(...loud.gain) >= 1, 'hearing must fully recover');
  assert.ok(Math.min(...loud.cutoff) < 8000, 'masking should take the top end, not just the level');

  const quiet = readPlan(() => audio.earProtect(0.12));
  assert.ok(Math.min(...quiet.gain) > floor, 'a suppressed shot must mask less than a magnum');
});

test('a sub-threshold report does not touch the mix at all', () => {
  audio.deafen.gain.schedule.length = 0;
  audio.earProtect(0.01);
  assert.equal(audio.deafen.gain.schedule.length, 0, 'a near-silent event scheduled a duck');
});

test('the duck always ends at full hearing, however the shots overlap', () => {
  // Holding an LMG must settle at a constant muffled level, never fade to nothing.
  for (let i = 0; i < 12; i++) audio.earProtect(0.74);
  const plan = audio.deafen.gain.schedule;
  assert.equal(plan.at(-1).value, 1, 'the last scheduled value must be full hearing');
  assert.ok(Math.min(...plan.map(e => e.value)) > 0.3, 'sustained fire must not duck to silence');
});

test('indoors the same round masks harder than outdoors', () => {
  const measure = () => {
    audio.deafen.gain.schedule.length = 0;
    audio.earProtect(0.6);
    return Math.min(...audio.deafen.gain.schedule.map(e => e.value));
  };
  audio.indoor = false;
  const outside = measure();
  audio.indoor = true;
  const inside = measure();
  audio.indoor = false;
  assert.ok(inside < outside, `indoors (${inside}) should mask more than outdoors (${outside})`);
});

test.after(() => restoreAudio());
