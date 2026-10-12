// Recoil FPS — how money is written on screen. Pure, no React, no three.js.

/**
 * Compact cash for *balances* — what you are holding.
 *
 * Four figures of wallet is noise when all you want to know is roughly how
 * rich you are, so anything from a thousand up is written in k: 1000 -> $1k,
 * 2000 -> $2k, 10000 -> $10k. Below a thousand the exact number still matters
 * (it is the difference between affording a vest and not), so it is printed in
 * full.
 *
 * The fraction is truncated rather than rounded, deliberately: a wallet should
 * never read richer than it is. $1,999 is "$1.9k", not "$2k" - you cannot
 * afford the two-thousand-dollar thing.
 *
 * Use this for balances only. Prices stay exact via `exactCash` - a shop that
 * says "$3.1k" when it means $3,100 is a shop you cannot budget against.
 */
export function formatCash(amount: number): string {
  const n = Math.trunc(amount);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}$${abs}`;
  // One decimal, truncated, with a bare ".0" dropped so 2000 reads "$2k".
  const tenths = Math.floor(abs / 100) / 10;
  const text = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
  return `${sign}$${text}k`;
}

/** Full precision, grouped. For prices, costs and itemised earnings. */
export function exactCash(amount: number): string {
  const n = Math.trunc(amount);
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;
}
