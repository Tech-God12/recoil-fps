import * as THREE from 'three';

/**
 * Player-following sun shadow frustum.
 *
 * The sun used to cast into a fixed ±80 m box centred on the map origin: 15.6 cm
 * shadow texels on the default 1024 map, and on Sandblast/Town (±124/134 m) whole
 * districts outside that box had no shadows at all. The frustum now follows the
 * player, biased toward where they are looking, and its centre is snapped to whole
 * shadow texels in light space so static shadow edges do not crawl as you move.
 */

/** Half-width of the shadow box. 50 m → 9.8 cm texels at 1024 (1.6× sharper than the
 *  old 80 m box) while still reaching past typical engagement distances. */
export const SHADOW_SPAN = 50;
/** Shift the box this fraction of SHADOW_SPAN along the view direction: shadows reach
 *  ~70 m ahead of the player, 30 m behind — what you look at is what gets texels. */
export const SHADOW_LOOK_BIAS = 0.4;
/** How far the light sits from its target along the sun direction. Must clear the
 *  tallest geometry (Sandblast water tower ≈26 m) at the low golden-hour angle. */
export const SHADOW_LIGHT_DISTANCE = 120;

const right = new THREE.Vector3();
const up = new THREE.Vector3();
const tmp = new THREE.Vector3();
const centerV = new THREE.Vector3();
const snappedV = new THREE.Vector3();

/**
 * Snap `center` so its projection on the light's right/up axes lands on whole
 * texels. Motion along the light direction does not move shadows, so it is left
 * untouched. Pure (writes into `out`).
 */
export function snapToShadowTexels(center: THREE.Vector3, lightDir: THREE.Vector3, texel: number, out: THREE.Vector3): THREE.Vector3 {
  const d = tmp.copy(lightDir).normalize();
  // Any stable basis perpendicular to the light works; world-up is never parallel to
  // a sun that sits above the horizon.
  right.crossVectors(d, THREE.Object3D.DEFAULT_UP).normalize();
  up.crossVectors(right, d).normalize();
  const r = center.dot(right), u = center.dot(up), f = center.dot(d);
  const rs = Math.round(r / texel) * texel, us = Math.round(u / texel) * texel;
  return out.set(0, 0, 0).addScaledVector(right, rs).addScaledVector(up, us).addScaledVector(d, f);
}

/**
 * Re-aim a directional light's shadow camera at the player. `sunDir` points FROM
 * the target TOWARD the sun. Call only on frames that re-render the shadow map.
 */
export function fitSunShadow(sun: THREE.DirectionalLight, sunDir: THREE.Vector3, eye: THREE.Vector3, forward: THREE.Vector3, span = SHADOW_SPAN): void {
  const cam = sun.shadow.camera;
  if (cam.right !== span) {
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.updateProjectionMatrix();
  }
  const texel = (2 * span) / Math.max(1, sun.shadow.mapSize.width);
  const center = centerV.set(forward.x, 0, forward.z);
  if (center.lengthSq() > 1e-6) center.normalize();
  center.multiplyScalar(span * SHADOW_LOOK_BIAS).add(eye);
  center.y = 0;
  const snapped = snapToShadowTexels(center, sunDir, texel, snappedV);
  sun.target.position.copy(snapped);
  sun.target.updateMatrixWorld();
  sun.position.copy(snapped).addScaledVector(sunDir, SHADOW_LIGHT_DISTANCE);
  sun.updateMatrixWorld();
}
