/**
 * Warehouse-only redeploy safety. All clocks are simulation seconds: pause/tab-away
 * must not use up a shield, and a shot/throw must not exploit it offensively.
 */
export const EXPOSED_SPAWN_SHIELD_SECONDS = 1.6; // Just enough to turn toward a camper; much shorter than the 5 s respawn wait.

export class SpawnProtection {
  private timeLeft = 0;

  get remaining(): number { return this.timeLeft; }
  get active(): boolean { return this.timeLeft > 0; }

  grant(exposed: boolean): void { this.timeLeft = exposed ? EXPOSED_SPAWN_SHIELD_SECONDS : 0; }
  tick(dt: number): void { if (Number.isFinite(dt) && dt > 0) this.timeLeft = Math.max(0, this.timeLeft - dt); }
  cancel(): void { this.timeLeft = 0; }

  /** An unarmed streak or invalid designation is not an attack. An actual call is. */
  spendOn(action: () => boolean): boolean {
    const used = action();
    if (used) this.cancel();
    return used;
  }
}
