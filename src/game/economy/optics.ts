// Optical magnification is a ratio of image scales, not FOV / power.
export const OPTIC_REFERENCE_FOV = 85;
export function magnificationFov(hipFov: number, power: number): number {
  const fov = Number.isFinite(hipFov) ? Math.min(120, Math.max(50, hipFov)) : OPTIC_REFERENCE_FOV;
  const magnification = Number.isFinite(power) ? Math.max(1, Math.min(12, power)) : 1;
  return 2 * Math.atan(Math.tan(fov * Math.PI / 360) / magnification) * 180 / Math.PI;
}
export function clampScopePower(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value)) * 10) / 10 : max;
}
