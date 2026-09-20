import * as THREE from 'three';

/** A shared, deterministic surface-work atlas: sparse scratches and broader handling scuffs.
 * This is relief/finish data, not a picture of a gun. It follows the mesh UVs through animation.
 */
export function makeDistressTexture(): THREE.DataTexture {
  const size = 1024, data = new Uint8Array(size * size * 4);
  let state = 71331;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 1] = Math.floor(random() * 255); data[i * 4 + 2] = 128; data[i * 4 + 3] = 255;
  }
  const dot = (x: number, y: number, strength: number, radius: number) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = (Math.round(x + dx) + size * 2) % size, yy = (Math.round(y + dy) + size * 2) % size;
      const index = (yy * size + xx) * 4;
      const weight = Math.max(0, 1 - Math.hypot(dx, dy) / (radius + 0.6));
      data[index] = Math.max(data[index], strength * weight);
    }
  };
  for (let i = 0; i < 560; i++) {
    const x = random() * size, y = random() * size, length = 6 + Math.pow(random(), 3) * 145;
    const angle = random() * Math.PI * 2, strength = 40 + random() * 195;
    for (let t = 0; t < length; t += 0.7) {
      const fade = Math.sin(t / length * Math.PI);
      if (random() > .10) dot(x + Math.cos(angle) * t, y + Math.sin(angle) * t, strength * fade, i % 5 === 0 ? 3 : 1);
    }
  }
  // Local, cross-grained abrasion, not an even cloud of noise on every surface.
  for (let patch = 0; patch < 18; patch++) {
    const x = random() * size, y = random() * size, radius = 14 + random() * 48;
    for (let i = 0; i < 150; i++) {
      const dx = (random() - .5) * radius * 2, dy = (random() - .5) * radius;
      const strength = Math.max(0, 1 - Math.hypot(dx / 2, dy) / radius) * (45 + random() * 130);
      dot(x + dx, y + dy, strength, 2);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = 'fine scratches and handling abrasion';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}
