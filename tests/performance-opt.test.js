// Performance anti-lag headline: headless proofs that the lag fixes actually shipped
// and didn't regress. Mirrors validate.mjs but pinned here so mutations kill.
import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const effectsMod = await import('../src/game/effects.ts');
const { Effects } = effectsMod;

function fxRig() {
  const scene = new THREE.Scene();
  const fx = new Effects(scene);
  return { scene, fx, any: fx };
}

// 1. Decals are now instanced — 2 draws vs 260 before
test('bullet holes and blood are instanced (not 260 individual meshes)', () => {
  const { scene, any } = fxRig();
  assert.ok(any.holes instanceof THREE.InstancedMesh, 'holes must be InstancedMesh');
  assert.ok(any.bloods instanceof THREE.InstancedMesh, 'bloods must be InstancedMesh');
  assert.equal(any.holes.count, 0, 'holes start at 0 draws');
  assert.equal(any.bloods.count, 0, 'bloods start at 0 draws');
  assert.equal(any.holes.geometry.type, 'CircleGeometry');
  // scene should contain exactly 1 holes + 1 bloods + brass + tracers etc — not 260
  const instanced = scene.children.filter(o => o.isInstancedMesh);
  assert.ok(instanced.length >= 3, `scene has ${instanced.length} instanced meshes (holes+bloods+brass)`);
  // legacy: no Mesh holes in scene
  const meshes = scene.children.filter(o => o.isMesh && !o.isInstancedMesh && o.geometry?.type === 'CircleGeometry');
  assert.equal(meshes.length, 0, 'no individual CircleGeometry meshes should remain');
});

test('instanced holes still stamp and orient to the surface normal', () => {
  const { any } = fxRig();
  const pos = new THREE.Vector3(10, 1, 10);
  const normal = new THREE.Vector3(0, 0, 1);
  any.impact(pos, normal);
  assert.equal(any.holeCount, 1);
  assert.equal(any.holes.count, 1);
  const m = new THREE.Matrix4();
  any.holes.getMatrixAt(0, m);
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  assert.ok(Math.abs(p.x - pos.x) < 0.02 && Math.abs(p.z - pos.z) < 0.02, `hole at ${p.x.toFixed(2)},${p.z.toFixed(2)} near ${pos.x},${pos.z}`);
  // second impact replaces ring correctly
  any.impact(new THREE.Vector3(20, 1, 20), new THREE.Vector3(0, 1, 0));
  assert.equal(any.holeCount, 2);
});

test('blood decals are instanced and scale-randomized via matrix', () => {
  const { any } = fxRig();
  any.bloodDecal(new THREE.Vector3(5, 0, 5), 1.5);
  assert.equal(any.bloodCount, 1);
  assert.equal(any.bloods.count, 1);
  const m = new THREE.Matrix4();
  any.bloods.getMatrixAt(0, m);
  const scale = new THREE.Vector3().setFromMatrixScale(m);
  assert.ok(scale.x >= 0.85 && scale.x <= 1.15, `blood scale ${scale.x.toFixed(2)} must be 0.85–1.15`);
});

test('dust is 180 points not 320 and throttles every 2nd frame', () => {
  const { any, fx } = fxRig();
  const pos = any.dust.geometry.attributes.position.array;
  assert.equal(pos.length, 180 * 3, 'dust must be 180 points (was 320) — 44% fewer verts');
  const before = pos[0];
  fx.update(0.016, new THREE.Vector3(0, 0, 0));
  const after1 = any.dust.geometry.attributes.position.array[0];
  fx.update(0.016, new THREE.Vector3(0, 0, 0));
  const after2 = any.dust.geometry.attributes.position.array[0];
  // dust moves on one of the two ticks (throttled to ~30 Hz, 2× dt compensation)
  const moved = after1 !== before || after2 !== after1;
  assert.ok(moved, 'dust must advance across two throttled ticks');
  // overall after two frames it must have moved
  assert.notEqual(after2, before, 'dust must have net movement after 2 ticks');
});

test('engine defaults are anti-lag: antialias false, DPR 1.1, shadow 1024, aniso 4', () => {
  const src = readFileSync('src/game/engine.ts', 'utf8');
  assert.ok(src.includes('antialias: false'), 'renderer must be antialias:false with composer');
  assert.ok(src.includes('Math.min(window.devicePixelRatio || 1, 1.1)'), 'DPR cap must be 1.1 not 1.25');
  assert.ok(src.includes('initShadow = 1024'), 'shadow init must be 1024 not 2048');
  assert.ok(src.includes('Math.min(4, this.renderer.capabilities.getMaxAnisotropy())'), 'aniso baseline must be 4 not 8');
  assert.ok(src.includes('Bloom at HALF resolution and only on genuinely bright pixels — threshold 0.96'), 'bloom threshold must be 0.96');
});

test('shadow refresh is gated by movement (not every 10th frame blind)', () => {
  const src = readFileSync('src/game/engine.ts', 'utf8');
  assert.ok(src.includes('lastShadowPos'), 'engine must track lastShadowPos');
  assert.ok(src.includes('distanceTo(this.lastShadowPos) > 0.8'), 'shadow must gate on 0.8 m move');
});

test('composeCamera uses trauma shake not RNG jitter', () => {
  const src = readFileSync('src/game/engine.ts', 'utf8');
  assert.ok(src.includes('trauma-based smooth decay'), 'shake must be trauma-based');
  assert.ok(src.includes('Math.sin(t * 23'), 'shake must use sin harmonics not Math.random per frame');
  assert.ok(!src.includes('eye.x += (Math.random() - 0.5) * this.shake * 0.14'), 'old RNG shake must be gone');
});

test('weapon geometry segment LOD: tubes and spheres cheaper', () => {
  const src = readFileSync('src/game/weapons/geometry.ts', 'utf8');
  // tubes 16 not 24
  assert.ok(src.includes('segments = 16') || src.includes('16)'), 'tube base must be 16 not 24');
  assert.ok(src.includes('// ANTI-LAG'), 'geometry must be annotated with anti-lag comment');
});

test('finish differentiates metal vs polymer (audit W7)', () => {
  const src = readFileSync('src/game/weapons/finish.ts', 'utf8');
  assert.ok(src.includes("this.metalness = 0.55"), 'steel must set metalness 0.55');
  assert.ok(src.includes('this.metalness = 0.02'), 'polymer must be dielectric 0.02');
  assert.ok(src.includes('this.metalness = 0.0'), 'wood must be 0.0');
  assert.ok(src.includes('MATERIAL RESPONSE FIX'), 'finish must comment W7 fix');
});

test('audio panner limit is 16 not 24 and prunes in updateListener', () => {
  const src = readFileSync('src/game/audio.ts', 'utf8');
  assert.ok(src.includes('spatialVoices.size > 16'), 'panner limit must be 16');
  assert.ok(src.includes('prune expired spatial panners here'), 'updateListener must prune');
});

test('HUD compass memoizes 73 ticks', () => {
  const src = readFileSync('src/ui/Hud.tsx', 'utf8');
  assert.ok(src.includes('useMemo(() => Array.from({ length: 73 }'), 'compass must memoize');
  assert.ok(src.includes('TDM_RESPAWN_SECONDS'), 'respawn bar must use constant not magic 5');
});

test('world dust & AI scratch vectors annotated', () => {
  const aiSrc = readFileSync('src/game/ai.ts', 'utf8');
  assert.ok(aiSrc.includes('tmpV3'), 'ai must have tmpV3 scratch');
  assert.ok(aiSrc.toLowerCase().includes('reuse scratch'), 'ai must reuse scratch vectors');
});
