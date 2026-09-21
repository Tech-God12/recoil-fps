// Game recoil in radians. Permanent aim displacement requires mouse compensation;
// the small spring component recovers, never the entire burst. No zoom-dependent
// multiplier: optical magnification already makes the same angular kick look larger.
export const RECOIL_FLOORS = { attachment: 0.62, horizontal: 0.65, overall: 0.42 } as const;
export interface RecoilInput {
  pattern: readonly (readonly [number, number])[];
  shot: number;
  recoil: number;
  baseRecoil: number;
  horizontal: number;
  aiming: boolean;
  crouched: boolean;
  supported: boolean;
  random?: number;
}
export function recoilImpulse(input: RecoilInput) {
  const { pattern, shot, recoil, baseRecoil, horizontal, aiming, crouched, supported } = input;
  const index = Math.min(Math.max(0, Math.floor(shot)), Math.max(0, pattern.length - 1));
  const [vertical, lateral] = pattern[index] ?? [1, 0.1];
  // Crouching is a real commitment (slow move speed), so it pays SERIOUS recoil
  // control — 55% of standing kick, noticeably better than snap-shooting upright.
  const stance = supported ? 0.50 : crouched ? 0.55 : 1;
  const gain = Math.max(baseRecoil * RECOIL_FLOORS.overall, recoil * stance * (aiming ? 0.92 : 1));
  // Global kick tuned down (~22%) — controllable sprays, headshots stay skill-gated.
  const rise = Math.max(0.4, vertical) * 0.0082 * gain;
  const noise = (Math.max(0, Math.min(1, input.random ?? 0.5)) - 0.5) * rise * 0.20;
  const yaw = lateral * 0.0055 * gain * Math.max(RECOIL_FLOORS.horizontal, horizontal) + noise;
  return { rise, yaw, aimPitch: rise * 0.68, aimYaw: yaw * 0.68, springPitch: rise * 0.45, springYaw: yaw * 0.38 };
}
// Aim also recentres a touch quicker, so bursts reset between trigger pulls.
export function recoilRecovery(dt: number): number { return Math.exp(-Math.max(0, dt) / 0.155); }
