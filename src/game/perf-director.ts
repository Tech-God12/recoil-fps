// Recoil FPS — adaptive quality director.
//
// The engine already scaled render resolution to defend the frame rate, but
// resolution is only one of the levers, and it is the one that costs the most
// image quality per millisecond recovered. On a machine that is CPU-bound —
// shadow map re-renders, particle updates, light evaluation — shrinking the
// backbuffer barely helps, so the scaler would ratchet all the way to 60% and
// the game would still stutter while looking soft.
//
// This module owns a single ordered ladder of quality tiers. Each tier bundles
// every lever at once, so one decision moves resolution, post-FX, shadow budget,
// particle density and draw distance together and consistently.
//
// It is deliberately pure: no three.js, no DOM, no timers. The engine feeds it
// frame times and applies whatever tier it returns, which means the whole
// hysteresis and panic-detection story is unit-testable in Node.

export interface QualityTier {
  /** Shown in the settings/HUD readout. */
  name: string;
  /** Multiplier applied to the player's resolution-scale cap. */
  renderScale: number;
  bloom: boolean;
  /** Shadow map edge size in texels; 0 disables shadows entirely. */
  shadowMap: number;
  /** Frames between static shadow-map refreshes. Higher is cheaper. */
  shadowInterval: number;
  /** Scales particle/decal spawn counts. */
  particleMul: number;
  /** Metres at which distant dressing stops being drawn. */
  drawDistance: number;
  /** Fullscreen vignette/contrast pass (cheap, but it is still a pass). */
  finishingPass: boolean;
}

/**
 * Ordered best → worst. Tier 0 is what the game looked like before this existed;
 * nothing below it is ever used unless the machine has actually proven it needs it.
 */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'Ultra',       renderScale: 1.00, bloom: true,  shadowMap: 4096, shadowInterval: 30,  particleMul: 1.00, drawDistance: 260, finishingPass: true },
  { name: 'High',        renderScale: 0.92, bloom: true,  shadowMap: 2048, shadowInterval: 36,  particleMul: 0.85, drawDistance: 230, finishingPass: true },
  { name: 'Balanced',    renderScale: 0.82, bloom: true,  shadowMap: 2048, shadowInterval: 48,  particleMul: 0.65, drawDistance: 190, finishingPass: true },
  { name: 'Performance', renderScale: 0.72, bloom: false, shadowMap: 1024, shadowInterval: 64,  particleMul: 0.45, drawDistance: 150, finishingPass: false },
  { name: 'Fast',        renderScale: 0.62, bloom: false, shadowMap: 1024, shadowInterval: 96,  particleMul: 0.28, drawDistance: 120, finishingPass: false },
  { name: 'Minimum',     renderScale: 0.52, bloom: false, shadowMap: 0,    shadowInterval: 240, particleMul: 0.15, drawDistance: 95,  finishingPass: false },
];

export interface DirectorConfig {
  /** Frame rate we are defending. */
  targetFps: number;
  /** Evaluate a decision at most this often. */
  evalMs: number;
  /** After a change, ignore this long so the change's own cost is not measured. */
  lockMs: number;
  /** Consecutive bad windows required before dropping a tier. */
  downWindows: number;
  /** Consecutive good windows required before climbing back. */
  upWindows: number;
  /** Minimum clean samples before a window counts at all. */
  minSamples: number;
  /** A frame longer than this is a hitch (asset decode, GC), not throughput. */
  stallSeconds: number;
  /** Highest tier index the player allows (a manual quality setting pins this). */
  floor: number;
  ceiling: number;
}

export const DEFAULT_DIRECTOR: DirectorConfig = {
  targetFps: 60,
  evalMs: 1200,
  lockMs: 2200,
  downWindows: 2,
  upWindows: 4,
  minSamples: 24,
  stallSeconds: 0.25,
  floor: 0,
  ceiling: QUALITY_TIERS.length - 1,
};

export interface DirectorDecision {
  /** Tier index after this update. */
  tier: number;
  /** True only on the update that actually moved. */
  changed: boolean;
  /** Why it moved — surfaced in the HUD so the drop is never mysterious. */
  reason: 'panic' | 'down' | 'up' | 'hold';
  /** Median FPS over the window that produced this decision, or -1. */
  fps: number;
}

/**
 * Hysteretic quality controller.
 *
 * Design notes that matter:
 *  - The window statistic is a MEDIAN, not a mean. One 800 ms asset hitch would
 *    drag a mean below target for several seconds and ratchet quality down for
 *    a stall that has already ended.
 *  - Climbing back up needs twice as many good windows as dropping needs bad
 *    ones, and the lock-out after any change is longer than the window itself.
 *    Without both, the controller oscillates between two tiers forever, which is
 *    far more distracting than simply sitting one tier low.
 *  - The panic path exists because the normal ladder needs several seconds to
 *    reach a usable tier. A machine rendering at 18 fps should not have to look
 *    at 18 fps for eight seconds first.
 */
export class PerfDirector {
  readonly config: DirectorConfig;
  private tierIndex: number;
  private samples: number[] = [];
  private lastEval = 0;
  private lockUntil = 0;
  private badWindows = 0;
  private goodWindows = 0;
  private panicUsed = false;
  private started = -1;

  constructor(startTier = 0, config: Partial<DirectorConfig> = {}) {
    this.config = { ...DEFAULT_DIRECTOR, ...config };
    this.tierIndex = this.clamp(startTier);
  }

  get tier(): QualityTier { return QUALITY_TIERS[this.tierIndex]; }
  get index(): number { return this.tierIndex; }

  private clamp(i: number): number {
    return Math.max(this.config.floor, Math.min(this.config.ceiling, Math.max(0, Math.min(QUALITY_TIERS.length - 1, i))));
  }

  /** Player changed the quality setting: re-pin the ladder and forget history. */
  setBounds(floor: number, ceiling: number): void {
    this.config.floor = Math.max(0, Math.min(QUALITY_TIERS.length - 1, floor));
    this.config.ceiling = Math.max(this.config.floor, Math.min(QUALITY_TIERS.length - 1, ceiling));
    this.tierIndex = this.clamp(this.tierIndex);
    this.reset();
  }

  /** Jump to a tier directly (manual override / new match). */
  setTier(i: number): void {
    this.tierIndex = this.clamp(i);
    this.reset();
  }

  reset(): void {
    this.samples.length = 0;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.lockUntil = 0;
    this.lastEval = 0;
  }

  /**
   * Feed one frame. `nowMs` is a monotonic clock, `frameSeconds` the delta.
   * Returns the current decision every call; check `changed` to act.
   */
  update(nowMs: number, frameSeconds: number, paused = false): DirectorDecision {
    if (this.started < 0) this.started = nowMs;
    const hold: DirectorDecision = { tier: this.tierIndex, changed: false, reason: 'hold', fps: -1 };
    if (paused) { this.samples.length = 0; return hold; }
    if (frameSeconds > 0 && frameSeconds <= this.config.stallSeconds && this.samples.length < 600) {
      this.samples.push(frameSeconds);
    }

    // Panic: a machine this far under target should not wait out the ladder.
    if (!this.panicUsed && nowMs - this.started > 700 && this.samples.length >= 20) {
      const fps = this.median();
      if (fps > 0 && fps < this.config.targetFps * 0.55) {
        this.panicUsed = true;
        // Distance from target picks the size of the jump, so a 15 fps machine
        // does not take the same single step as a 32 fps one.
        const deficit = this.config.targetFps / Math.max(1, fps);
        const jump = deficit > 2.6 ? 3 : deficit > 1.8 ? 2 : 1;
        const next = this.clamp(this.tierIndex + jump);
        if (next !== this.tierIndex) {
          this.tierIndex = next;
          this.lockUntil = nowMs + this.config.lockMs;
          this.lastEval = nowMs;
          this.samples.length = 0;
          return { tier: next, changed: true, reason: 'panic', fps };
        }
      }
    }
    this.panicUsed = this.panicUsed || nowMs - this.started > 4000;

    if (nowMs < this.lockUntil) { this.samples.length = 0; this.lastEval = nowMs; return hold; }
    if (nowMs - this.lastEval < this.config.evalMs) return hold;
    this.lastEval = nowMs;
    if (this.samples.length < this.config.minSamples) { this.samples.length = 0; return hold; }

    const fps = this.median();
    this.samples.length = 0;
    if (fps <= 0) return hold;

    // Asymmetric thresholds: the band between them is the dead zone that stops
    // a machine sitting exactly on target from flip-flopping every second.
    const downAt = this.config.targetFps * 0.88;
    const upAt = this.config.targetFps * 1.06;

    if (fps < downAt && this.tierIndex < this.config.ceiling) {
      this.goodWindows = 0;
      if (++this.badWindows < this.config.downWindows) return { ...hold, fps };
      this.badWindows = 0;
      this.tierIndex = this.clamp(this.tierIndex + 1);
      this.lockUntil = nowMs + this.config.lockMs;
      return { tier: this.tierIndex, changed: true, reason: 'down', fps };
    }
    if (fps > upAt && this.tierIndex > this.config.floor) {
      this.badWindows = 0;
      if (++this.goodWindows < this.config.upWindows) return { ...hold, fps };
      this.goodWindows = 0;
      this.tierIndex = this.clamp(this.tierIndex - 1);
      this.lockUntil = nowMs + this.config.lockMs;
      return { tier: this.tierIndex, changed: true, reason: 'up', fps };
    }
    this.badWindows = 0;
    this.goodWindows = 0;
    return { ...hold, fps };
  }

  /** Median frame rate of the clean samples in the current window. */
  median(): number {
    const n = this.samples.length;
    if (n === 0) return -1;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const mid = sorted[n >> 1];
    return mid > 0 ? 1 / mid : -1;
  }
}

/**
 * First-launch guess so the very first frame is not rendered at Ultra on a
 * laptop iGPU. Deliberately conservative: the director will climb back within a
 * few seconds if the machine turns out to be quick, and climbing up is far less
 * jarring than watching the first ten seconds of a match hitch.
 */
export function guessStartTier(info: { deviceMemoryGb?: number; cores?: number; renderer?: string; mobile?: boolean }): number {
  if (info.mobile) return 4;
  const gpu = (info.renderer ?? '').toLowerCase();
  const weakGpu = /(intel|uhd|hd graphics|iris|swiftshader|llvmpipe|software|microsoft basic)/.test(gpu);
  const strongGpu = /(rtx|radeon rx|geforce gtx 1[6-9]|rx 6|rx 7|arc a|apple m[1-9])/.test(gpu);
  const mem = info.deviceMemoryGb ?? 8;
  const cores = info.cores ?? 4;

  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 5;
  if (strongGpu && mem >= 16 && cores >= 8) return 0;
  if (strongGpu) return 1;
  if (weakGpu && mem <= 8) return 4;
  if (weakGpu) return 3;
  // 16 GB / 8 cores with an unidentified GPU: start Balanced and let the
  // director prove the machine can do better. This is the common case.
  if (mem >= 16 && cores >= 8) return 1;
  if (mem >= 8 && cores >= 4) return 2;
  return 3;
}
