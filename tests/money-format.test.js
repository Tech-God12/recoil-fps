import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { formatCash, exactCash } = await import('../src/game/economy/money.ts');

test('balances under a thousand are printed in full', () => {
  assert.equal(formatCash(0), '$0');
  assert.equal(formatCash(50), '$50');
  assert.equal(formatCash(650), '$650');
  assert.equal(formatCash(999), '$999');
});

test('a thousand and up is written in k', () => {
  assert.equal(formatCash(1000), '$1k');
  assert.equal(formatCash(2000), '$2k');
  assert.equal(formatCash(10000), '$10k');
  assert.equal(formatCash(16000), '$16k');
  assert.equal(formatCash(100000), '$100k');
});

test('the fraction is truncated, so a wallet never reads richer than it is', () => {
  // $1,999 must not become "$2k" - you cannot afford the $2,000 thing.
  assert.equal(formatCash(1999), '$1.9k');
  assert.equal(formatCash(1500), '$1.5k');
  assert.equal(formatCash(1050), '$1k');
  assert.equal(formatCash(12500), '$12.5k');
  assert.equal(formatCash(9999), '$9.9k');
});

test('negative balances keep their sign', () => {
  assert.equal(formatCash(-200), '-$200');
  assert.equal(formatCash(-2500), '-$2.5k');
});

test('fractional cents never leak into the display', () => {
  assert.equal(formatCash(650.7), '$650');
  assert.equal(formatCash(1000.9), '$1k');
  assert.equal(exactCash(3100.4), '$3,100');
});

test('prices stay exact, because you have to be able to budget against them', () => {
  assert.equal(exactCash(3100), '$3,100');
  assert.equal(exactCash(650), '$650');
  assert.equal(exactCash(16000), '$16,000');
  // The two formatters must disagree above a thousand - that is the point.
  assert.notEqual(exactCash(2700), formatCash(2700));
});

test('the compact form is always shorter than the exact form once it kicks in', () => {
  for (const n of [1000, 1999, 2500, 10000, 99999, 250000]) {
    assert.ok(formatCash(n).length <= exactCash(n).length,
      `${n}: compact "${formatCash(n)}" is not shorter than exact "${exactCash(n)}"`);
  }
});
