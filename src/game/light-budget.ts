import * as THREE from 'three';

/**
 * LIGHT BUDGET
 *
 * three.js compiles the number of point lights into every MeshStandardMaterial
 * shader, and every lit fragment loops over all of them — whether a light is 60 m
 * away, behind three walls or at intensity 0. The Warehouse shipped with 8 point
 * lights (spawn washes, work lights, centre lights, muzzle flash, ON FIRE glow), so
 * every pixel on screen paid for 8 lights to show, at most, 2 of them.
 *
 * The budget turns decorative lights into *virtual sources* (the original light
 * objects are detached from the scene but kept, so existing flicker code that
 * writes `light.intensity` keeps working unchanged) and drives a fixed pool of real
 * lights that are re-assigned to the sources nearest the camera. The shader light
 * count becomes a constant `POOL + dynamic lights` on every map, and never changes
 * mid-match (so no shader recompiles).
 */

/** Real point lights available to decorative sources. Two matches the old
 *  "centre lights capped at 2" budget that Sandblast/Town already shipped with. */
export const LIGHT_POOL_SIZE = 2;
/** Re-pick nearest sources 5×/s: a player sprinting 7 m/s moves 1.4 m between picks,
 *  well inside every source's 12–22 m range, so a hand-over is never visible late. */
export const REASSIGN_INTERVAL = 0.2;
/** Seconds for a pooled light to fade out of its old source / into the new one.
 *  0.25 s is long enough to hide the swap, short enough not to read as a dimmer. */
export const FADE_SECONDS = 0.25;

export interface LightSource {
  /** Detached original light: position/color/distance/decay/intensity are read live. */
  light: THREE.PointLight;
}

interface Slot {
  light: THREE.PointLight;
  source: LightSource | null;
  /** 0..1 fade weight applied on top of the source's own (possibly flickering) intensity. */
  weight: number;
  /** Source this slot should serve; when it differs from `source`, the slot fades
   *  out, swaps, then fades back in. */
  target: LightSource | null;
}

export class LightBudget {
  readonly sources: LightSource[] = [];
  readonly slots: Slot[] = [];
  private timer = 0;

  constructor(scene: THREE.Object3D, poolSize = LIGHT_POOL_SIZE) {
    for (let i = 0; i < poolSize; i++) {
      // Pre-added at intensity 0 so the scene's light count is fixed from frame 1.
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      light.name = `light-budget slot ${i}`;
      scene.add(light);
      this.slots.push({ light, source: null, weight: 0, target: null });
    }
  }

  /**
   * Take ownership of a point light: remove it from its parent (it keeps its world
   * position) and register it as a virtual source.
   */
  adopt(light: THREE.PointLight): LightSource {
    light.updateWorldMatrix(true, false);
    const world = new THREE.Vector3().setFromMatrixPosition(light.matrixWorld);
    light.removeFromParent();
    light.position.copy(world);
    const source = { light };
    this.sources.push(source);
    return source;
  }

  /** Adopt every point light under `root` that passes `filter`. Returns how many. */
  adoptAll(root: THREE.Object3D, filter: (l: THREE.PointLight) => boolean = () => true): number {
    const found: THREE.PointLight[] = [];
    root.traverse(o => { if ((o as THREE.PointLight).isPointLight && filter(o as THREE.PointLight)) found.push(o as THREE.PointLight); });
    for (const l of found) this.adopt(l);
    return found.length;
  }

  /**
   * Rank sources by how much they could matter to the viewer: distance past the
   * light's own falloff range. A light whose range reaches the camera ranks 0-ish.
   */
  static rank(source: LightSource, eye: THREE.Vector3): number {
    const l = source.light;
    const range = l.distance > 0 ? l.distance : 30;
    return l.position.distanceTo(eye) - range;
  }

  /** Pure selection: the `n` best sources for `eye` (exported for tests). */
  static pick(sources: LightSource[], eye: THREE.Vector3, n: number): LightSource[] {
    if (sources.length <= n) return sources.slice();
    const scored = sources.map(s => ({ s, r: LightBudget.rank(s, eye) }));
    scored.sort((a, b) => a.r - b.r);
    return scored.slice(0, n).map(x => x.s);
  }

  update(dt: number, eye: THREE.Vector3) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = REASSIGN_INTERVAL;
      const wanted = LightBudget.pick(this.sources, eye, this.slots.length);
      // Slots already aimed at a wanted source keep it (no needless swaps); the
      // remaining slots are handed the unserved sources, or null to go dark.
      const unserved = wanted.filter(w => !this.slots.some(s => s.target === w));
      for (const slot of this.slots) {
        if (slot.target && wanted.includes(slot.target)) continue;
        slot.target = unserved.shift() ?? null;
      }
    }
    const step = dt / FADE_SECONDS;
    for (const slot of this.slots) {
      if (slot.source !== slot.target) {
        slot.weight = Math.max(0, slot.weight - step);
        // A dark slot swaps instantly; a lit one waits until it has faded out.
        if (slot.weight === 0) slot.source = slot.target;
      } else if (slot.source) {
        slot.weight = Math.min(1, slot.weight + step);
      }
      const src = slot.source?.light;
      if (!src) { slot.light.intensity = 0; continue; }
      slot.light.position.copy(src.position);
      slot.light.color.copy(src.color);
      slot.light.distance = src.distance;
      slot.light.decay = src.decay;
      slot.light.intensity = src.intensity * slot.weight;
    }
  }

  dispose() {
    for (const s of this.slots) { s.light.removeFromParent(); s.light.dispose(); }
    for (const s of this.sources) s.light.dispose();
    this.slots.length = 0; this.sources.length = 0;
  }
}
