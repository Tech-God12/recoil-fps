// Mix glue: the master bus must compress stacked gunshots instead of clipping,
// and the casing tink must land ~90 ms after the shot, quiet and highpassed.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installAudioStub } from './helpers/audio.js';
const { audio } = await import('../src/game/audio.ts');

test('master bus runs through a gentle glue compressor', () => {
  const restore = installAudioStub();
  try {
    audio.ensure();
    assert.ok(audio.comp, 'compressor must exist on the master bus');
    assert.equal(audio.comp.threshold.value, -18);
    assert.equal(audio.comp.ratio.value, 4);
    assert.equal(audio.comp.attack.value, 0.003, '3 ms attack keeps the transient punchy');
    assert.equal(audio.comp.release.value, 0.18);
    assert.ok(audio.makeup, 'glue needs makeup gain or the mix just gets quieter');
    assert.equal(audio.makeup.gain.value, 1.12);
  } finally {
    restore();
  }
});

test('casing tink is delayed, quiet, and highpassed', () => {
  const restore = installAudioStub();
  const calls = [];
  const real = audio.burstDirect.bind(audio);
  audio.burstDirect = (opts) => { calls.push(opts); return real(opts); };
  try {
    audio.ensure();
    audio.fireCasing();
  } finally {
    audio.burstDirect = real;
    restore();
  }
  assert.equal(calls.length, 1, 'one tink per casing');
  const [tink] = calls;
  assert.equal(tink.when, 0.09, 'tink must land ~90 ms after the shot (eject + flight time)');
  assert.ok(tink.gain <= 0.15, `tink gain ${tink.gain} must sit under the gunshot, not over it`);
  assert.equal(tink.hp, 4200, 'casing is all ping: highpass the body out');
  assert.ok(tink.freq > 5000 && tink.freq < 8000, `brass rings at ~6.4 kHz (got ${tink.freq})`);
});
