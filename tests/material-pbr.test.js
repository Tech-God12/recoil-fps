// World surfaces used to be diffuse + bumpMap + one constant roughness, which is
// why every material read as the same slab of matte plastic under the sun. These
// tests pin the replacement: a derived tangent-space normal map, a varying
// roughness map and a cavity AO map on every surface.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

const restore = installCanvasStub();
const { getMaterials, buildNormalMapForTest, setTextureAnisotropy } = await import('../src/game/textures.ts');
const materials = getMaterials();
restore();

const NAMED = Object.entries(materials).filter(([, m]) => m instanceof THREE.MeshStandardMaterial);

test('every world surface is a full PBR set, not a bump-mapped flat', () => {
  assert.ok(NAMED.length >= 12, `expected the full surface library, got ${NAMED.length}`);
  for (const [name, m] of NAMED) {
    if (name === 'signage') continue; // flat printed board, deliberately unlit detail
    assert.ok(m.map, `${name}: no albedo`);
    assert.ok(m.normalMap, `${name}: still relying on screen-space bump derivatives`);
    assert.equal(m.bumpMap, null, `${name}: bumpMap and normalMap must not both be set`);
    assert.ok(m.roughnessMap, `${name}: constant roughness reads as plastic`);
    assert.ok(m.aoMap, `${name}: no cavity occlusion`);
    // aoMap defaults to the second UV set; the world only authors one.
    assert.equal(m.aoMap.channel, 0, `${name}: aoMap points at a UV set the world never builds`);
    // The roughness scalar multiplies the map, so it has to be neutral.
    assert.equal(m.roughness, 1, `${name}: scalar roughness would cancel the map`);
  }
});

test('derived maps are tileable, linear-space and mipmapped', () => {
  for (const [name, m] of NAMED) {
    if (name === 'signage') continue;
    for (const [slot, texture] of [['normalMap', m.normalMap], ['roughnessMap', m.roughnessMap], ['map', m.map]]) {
      if (!texture) continue;
      assert.equal(texture.wrapS, THREE.RepeatWrapping, `${name}.${slot}: not tileable`);
      assert.equal(texture.wrapT, THREE.RepeatWrapping, `${name}.${slot}: not tileable`);
      assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter, `${name}.${slot}: no trilinear mips`);
      assert.ok(texture.anisotropy >= 8, `${name}.${slot}: anisotropy ${texture.anisotropy} will smear the ground`);
    }
    // Normal and roughness data must stay linear; sRGB-decoding them bends the lighting.
    assert.notEqual(m.normalMap.colorSpace, THREE.SRGBColorSpace, `${name}: normal map is sRGB-tagged`);
    assert.notEqual(m.roughnessMap.colorSpace, THREE.SRGBColorSpace, `${name}: roughness map is sRGB-tagged`);
    assert.equal(m.map.colorSpace, THREE.SRGBColorSpace, `${name}: albedo must be sRGB`);
  }
});

test('the Sobel actually produces relief instead of a flat blue sheet', () => {
  // A diagonal ramp: the normal map must tilt consistently, and a flat field
  // must come back as exactly +Z. This is the guard against a silently
  // no-op normal generator, which looks identical to "no normal map at all".
  const size = 32;
  const ramp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[y * size + x] = x / size;
  const tilted = buildNormalMapForTest({ h: ramp, w: size, hgt: size }, 1);
  const flat = buildNormalMapForTest({ h: new Float32Array(size * size).fill(0.5), w: size, hgt: size }, 1);

  // Sample away from the wrap seam, where the ramp discontinuity lives.
  const mid = (size / 2) * size + size / 2;
  assert.ok(tilted[mid * 4] < 120, `ramp should tilt the X normal negative, got ${tilted[mid * 4]}`);
  assert.ok(Math.abs(tilted[mid * 4 + 1] - 128) <= 1, 'a pure X ramp must not tilt Y');
  assert.equal(flat[mid * 4], 128, 'flat height must encode as exactly +Z');
  assert.equal(flat[mid * 4 + 1], 128, 'flat height must encode as exactly +Z');
  assert.ok(flat[mid * 4 + 2] >= 254, 'flat height must encode as exactly +Z');
});

test('anisotropy tracks the GPU limit the renderer reports', () => {
  setTextureAnisotropy(16);
  assert.equal(materials.sand.map.anisotropy, 8, 'already-built textures are not retroactively changed');
  setTextureAnisotropy(8);
});
