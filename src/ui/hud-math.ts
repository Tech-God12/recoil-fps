// Recoil FPS — pure HUD predicates (no JSX) so Node tests pin them.

/** Low-ammo state, relative to the magazine. Absolute thresholds lie: the AWM's
 *  full 5-round mag used to glow red with a permanent blinking RELOAD. */
export function isLowAmmo(mag: number, magSize: number): boolean {
  if (!Number.isFinite(mag) || !Number.isFinite(magSize) || magSize <= 0) return false;
  return mag <= 0 || mag / magSize < 0.25;
}

/** The blinking RELOAD hint shows for low ammo while the gun is in battery. */
export function shouldShowReload(mag: number, magSize: number, reloading: boolean): boolean {
  return !reloading && isLowAmmo(mag, magSize);
}
