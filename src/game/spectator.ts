import * as THREE from 'three';

/**
 * Spectator camera rig.
 *
 * Kept out of the engine so the motion can be tested on its own: a camera that
 * feels right at 144 fps and lurches at 30 fps is the classic symptom of
 * per-frame lerps, and the only way to catch it is to run the same motion at
 * two timesteps and compare the trajectories.
 *
 * Three independent channels, because they want different responses:
 *
 *  - position runs a critically damped spring (implicit Euler, unconditionally
 *    stable), so the camera has weight and never overshoots into geometry;
 *  - orientation is a quaternion slerp, so a subject spinning past due south
 *    does not send the camera the long way round, which is exactly what a
 *    lerped look-at point does;
 *  - field of view eases on its own, slower, so a zoom never fights the dolly.
 *
 * Switching subject blends: the rig snaps its internal state to the new
 * subject and eases the *output* across from the old pose, so the new subject
 * is already being tracked properly while the transition plays out.
 */

/** Where the rig is being asked to be, this frame. */
export interface SpectatorWant {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  up?: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Smootherstep: zero first and second derivative at both ends, so a blend
 *  neither jerks on departure nor lands with a visible stop. */
function smootherstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * One axis of a critically damped spring, integrated with the *exact* solution
 * rather than a numerical step.
 *
 * For x'' + 2*w*x' + w^2*(x - target) = 0 the critically damped case has the
 * closed form y(t) = (c1 + c2*t) * e^(-w*t) with y = x - target. Using it
 * instead of implicit Euler matters for two reasons: it is exact for a
 * stationary target, so the result genuinely does not depend on how the frame
 * was sliced; and e^(-w*dt) can never grow, so a half-second hitch cannot
 * destabilise it. Euler's O(dt) lag is timestep dependent and shows up as the
 * camera trailing further behind at 30 fps than at 144.
 *
 * Returns the new [value, velocity].
 */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  if (dt <= 0) return [x, v];
  const y0 = x - target;
  const c2 = v + omega * y0;
  const e = Math.exp(-omega * dt);
  const y = (y0 + c2 * dt) * e;
  const nv = (c2 - omega * y0 - omega * c2 * dt) * e;
  return [target + y, nv];
}

function springVec(pos: THREE.Vector3, vel: THREE.Vector3, target: THREE.Vector3, omega: number, dt: number) {
  [pos.x, vel.x] = springStep(pos.x, vel.x, target.x, omega, dt);
  [pos.y, vel.y] = springStep(pos.y, vel.y, target.y, omega, dt);
  [pos.z, vel.z] = springStep(pos.z, vel.z, target.z, omega, dt);
}

/** Frame-rate independent exponential approach: the same amount of "catch up"
 *  per second of wall clock regardless of how the frames were sliced. */
export function expApproach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export interface SpectatorTuning {
  /** Position spring rate. Higher is tighter; 11 settles in roughly 0.4 s. */
  posOmega: number;
  /** Orientation slerp rate. */
  rotRate: number;
  /** Field of view easing rate. Deliberately the slowest channel. */
  fovRate: number;
}

export const SPECTATOR_TUNING: SpectatorTuning = { posOmega: 11, rotRate: 9, fovRate: 5 };

export class SpectatorRig {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  fov = 75;

  private vel = new THREE.Vector3();
  private started = false;
  private blendT = 0;
  private blendDur = 0;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private fromFov = 75;
  /** Output pose, after any subject blend. Read this, not `pos`. */
  readonly outPos = new THREE.Vector3();
  readonly outQuat = new THREE.Quaternion();
  outFov = 75;

  private readonly m = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  constructor(private tuning: SpectatorTuning = SPECTATOR_TUNING) {}

  get blending(): boolean { return this.blendT < this.blendDur; }

  /** Orientation that looks from `pos` at `look`. */
  private orient(pos: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    // Degenerate when the target is exactly at the eye: keep the last orientation.
    if (this.tmpV.subVectors(look, pos).lengthSq() < 1e-8) return out;
    this.m.lookAt(pos, look, up);
    return out.setFromRotationMatrix(this.m);
  }

  /** Place the rig exactly, with no motion. Used on the first spectated frame. */
  cut(want: SpectatorWant) {
    this.pos.copy(want.pos);
    this.vel.set(0, 0, 0);
    this.orient(want.pos, want.look, want.up ?? UP, this.quat);
    this.fov = want.fov;
    this.blendT = this.blendDur = 0;
    this.started = true;
    this.outPos.copy(this.pos);
    this.outQuat.copy(this.quat);
    this.outFov = this.fov;
  }

  /**
   * Change of subject. The rig starts tracking the new pose immediately and
   * the visible camera eases across from where it was, so nothing teleports
   * and the new subject is never shown mid-snap.
   *
   * The blend is longer for a bigger jump, but capped: crossing the map should
   * read as a deliberate sweep, not a slow drift.
   */
  transition(want: SpectatorWant) {
    if (!this.started) { this.cut(want); return; }
    this.fromPos.copy(this.outPos);
    this.fromQuat.copy(this.outQuat);
    this.fromFov = this.outFov;
    const jump = this.fromPos.distanceTo(want.pos);
    this.blendDur = THREE.MathUtils.clamp(0.25 + jump * 0.01, 0.25, 0.7);
    this.blendT = 0;
    // Snap the tracker (not the output) so the spring is already settled on the
    // new subject when the blend lands - otherwise the blend ends and a second,
    // visible catch-up starts.
    this.pos.copy(want.pos);
    this.vel.set(0, 0, 0);
    this.orient(want.pos, want.look, want.up ?? UP, this.quat);
    this.fov = want.fov;
  }

  update(dt: number, want: SpectatorWant) {
    if (!this.started) { this.cut(want); return; }
    const up = want.up ?? UP;
    springVec(this.pos, this.vel, want.pos, this.tuning.posOmega, dt);
    this.orient(want.pos, want.look, up, this.tmpQ);
    // slerp by a frame-rate independent fraction; `slerp` takes the short arc.
    this.quat.slerp(this.tmpQ, 1 - Math.exp(-this.tuning.rotRate * dt));
    this.fov = expApproach(this.fov, want.fov, this.tuning.fovRate, dt);

    if (this.blendT < this.blendDur) {
      this.blendT = Math.min(this.blendDur, this.blendT + dt);
      const s = smootherstep(this.blendDur > 0 ? this.blendT / this.blendDur : 1);
      this.outPos.copy(this.fromPos).lerp(this.pos, s);
      this.outQuat.copy(this.fromQuat).slerp(this.quat, s);
      this.outFov = this.fromFov + (this.fov - this.fromFov) * s;
    } else {
      this.outPos.copy(this.pos);
      this.outQuat.copy(this.quat);
      this.outFov = this.fov;
    }
  }

  applyTo(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.outPos);
    camera.quaternion.copy(this.outQuat);
    if (Math.abs(camera.fov - this.outFov) > 1e-4) {
      camera.fov = this.outFov;
      camera.updateProjectionMatrix();
    }
  }

  reset() {
    this.started = false;
    this.blendT = this.blendDur = 0;
    this.vel.set(0, 0, 0);
  }
}
