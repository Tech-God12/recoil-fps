import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
installCanvasStub();
const { LightBudget, LIGHT_POOL_SIZE, FADE_SECONDS } = await import('../src/game/light-budget.ts');
const { snapToShadowTexels, fitSunShadow, SHADOW_SPAN, SHADOW_LOOK_BIAS } = await import('../src/game/shadow-fit.ts');
const { usesPostChain, vignetteOverlay, DEFAULT_SETTINGS, GRAPHICS_PRESETS } = await import('../src/game/engine.ts');
const { buildSoldier, buildArmoredSoldier, HIT_PROXY_MAT, updateWeaponLod, WEAPON_LOD_DISTANCE } = await import('../src/game/models.ts');
const { buildWorld } = await import('../src/game/world.ts');

const pointLights = root => { let n = 0; root.traverse(o => { if (o.isPointLight) n++; }); return n; };
const light = (x, z, intensity = 5, distance = 15) => { const l = new THREE.PointLight(0xffaa00, intensity, distance, 1.8); l.position.set(x, 3, z); return l; };

test('light budget: adopting decorative lights leaves a fixed pool in the scene', () => {
  const scene = new THREE.Scene();
  const dressing = new THREE.Group(); scene.add(dressing);
  for (let i = 0; i < 6; i++) dressing.add(light(i * 20, 0));
  assert.equal(pointLights(scene), 6);
  const budget = new LightBudget(scene);
  assert.equal(budget.adoptAll(dressing), 6);
  assert.equal(pointLights(scene), LIGHT_POOL_SIZE, 'only pooled lights remain in the render scene');
  // adopted sources keep their world position even though they left their parent
  dressing.position.set(100, 0, 0);
  assert.equal(budget.sources[5].light.position.x, 100);
  budget.dispose();
});

test('light budget: pool serves the nearest sources and cross-fades on hand-over', () => {
  const scene = new THREE.Scene();
  const budget = new LightBudget(scene);
  const a = budget.adopt(light(0, 0)), b = budget.adopt(light(10, 0)), far = budget.adopt(light(200, 0));
  const eye = new THREE.Vector3(2, 1.6, 0);
  for (let i = 0; i < 30; i++) budget.update(1 / 60, eye);
  const served = budget.slots.map(s => s.source);
  assert.ok(served.includes(a) && served.includes(b) && !served.includes(far));
  for (const s of budget.slots) assert.ok(Math.abs(s.light.intensity - 5) < 1e-6, 'fully faded in to source intensity');
  // walk to the far light: one slot must fade OUT before re-targeting (no pop)
  eye.set(199, 1.6, 0);
  budget.update(0.21, eye);
  const swapping = budget.slots.find(s => s.target === far);
  assert.ok(swapping, 'far source becomes a target');
  assert.ok(swapping.light.intensity < 5 && swapping.source !== far, 'old source is fading, not snapped');
  for (let i = 0; i < Math.ceil(2 * FADE_SECONDS * 60) + 2; i++) budget.update(1 / 60, eye);
  assert.equal(swapping.source, far);
  assert.ok(swapping.light.position.distanceTo(far.light.position) < 1e-6);
  assert.ok(Math.abs(swapping.light.intensity - 5) < 1e-6);
  budget.dispose();
});

test('light budget: flicker written to a virtual source reaches the pooled light', () => {
  const scene = new THREE.Scene();
  const budget = new LightBudget(scene);
  const src = budget.adopt(light(0, 0, 4));
  for (let i = 0; i < 30; i++) budget.update(1 / 60, new THREE.Vector3());
  src.light.intensity = 2.5; // what engine.ts arenaFx.flicker does every frame
  budget.update(1 / 60, new THREE.Vector3());
  assert.ok(budget.slots.some(s => Math.abs(s.light.intensity - 2.5) < 1e-6));
  budget.dispose();
});

test('light budget: pick ranks by distance past each light\'s own range', () => {
  const eye = new THREE.Vector3();
  const small = { light: light(12, 0, 5, 5) };   // 7 m outside its range
  const big = { light: light(20, 0, 5, 22) };    // camera inside its range
  assert.deepEqual(LightBudget.pick([small, big], eye, 1), [big]);
});

test('Warehouse: shader point-light count drops from 12 to 4 once the pool adopts dressing', () => {
  const keys = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood', 'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth', 'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage'];
  const scene = new THREE.Scene();
  const world = buildWorld(scene, 'arena', Object.fromEntries(keys.map(k => [k, new THREE.MeshStandardMaterial()])));
  const dressing = pointLights(world.group);
  // The enlarged Warehouse adds 4 hall floodlights to the 4 spawn washes/work lights.
  assert.equal(dressing, 8, 'spawn washes + work lights + hall floodlights');
  // Before: dressing(8) + 2 centre lights + muzzle flash + ON FIRE = 12.
  const before = dressing + 2 + 2;
  const budget = new LightBudget(scene);
  budget.adoptAll(world.group);
  const after = pointLights(scene) + 2; // + muzzle flash + ON FIRE (dynamic, not adopted)
  assert.equal(before, 12);
  assert.equal(after, 4);
  budget.dispose();
});

test('post chain: default settings render straight to the canvas; vignette is a CSS overlay', () => {
  // The off-screen composer is opt-in. Rendering straight into the multisampled
  // canvas is both faster and already antialiased, and it sidesteps the
  // half-float render target that black-screens GPUs without EXT_color_buffer_float.
  assert.equal(usesPostChain(DEFAULT_SETTINGS), false, 'defaults must not pay for the off-screen chain');
  assert.equal(DEFAULT_SETTINGS.bloom, false, 'bloom must never be on by default');
  for (const [name, preset] of Object.entries(GRAPHICS_PRESETS)) {
    assert.equal(preset.bloom, false, `${name} preset must not enable bloom`);
  }
  for (const name of ['performance', 'balanced', 'high']) {
    assert.equal(
      usesPostChain({ ...DEFAULT_SETTINGS, ...GRAPHICS_PRESETS[name], filmGrain: 0 }),
      false,
      `${name} preset must not pay for the off-screen chain`,
    );
  }
  assert.equal(usesPostChain({ bloom: true, filmGrain: 0 }), true);
  assert.equal(usesPostChain({ bloom: false, filmGrain: 10 }), true);
  // Every individual contributor must be able to engage the chain on its own.
  for (const on of [{ postProcess: true }, { sunShafts: true }, { sharpness: 1 }, { aberration: 1 }]) {
    assert.equal(usesPostChain(on), true, `${Object.keys(on)[0]} must engage the chain`);
  }
  assert.equal(usesPostChain({ postProcess: false, sunShafts: false, sharpness: 0, aberration: 0, bloom: false, filmGrain: 0 }), false);
  assert.equal(vignetteOverlay(0), null);
  assert.match(vignetteOverlay(DEFAULT_SETTINGS.vignette), /radial-gradient\(.*rgba\(0,0,0,0\.100\) 100%\)/);
  assert.match(vignetteOverlay(999), /0\.700/, 'clamped to the slider max');
});

test('shadow fit: centre snaps to whole texels and is stable under sub-texel motion', () => {
  const dir = new THREE.Vector3(-65, 52, 40).normalize();
  const texel = 2 * SHADOW_SPAN / 1024;
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  const a = snapToShadowTexels(new THREE.Vector3(10.03, 0, 5.07), dir, texel, new THREE.Vector3());
  // nudge a quarter texel along both light-space axes and along the light itself
  const moved = a.clone().addScaledVector(right, texel * 0.24).addScaledVector(up, -texel * 0.24).addScaledVector(dir, 3);
  const b = snapToShadowTexels(moved, dir, texel, new THREE.Vector3());
  b.addScaledVector(dir, -3);
  assert.ok(a.distanceTo(b) < 1e-9, 'sub-texel motion does not move the shadow grid');
  for (const axis of [right, up]) {
    const k = a.dot(axis) / texel;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'projection lands on a texel boundary');
  }
});

test('shadow fit: box follows the player, biased toward the view', () => {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.mapSize.set(1024, 1024);
  const dir = new THREE.Vector3(55, 38, -50).normalize();
  fitSunShadow(sun, dir, new THREE.Vector3(100, 1.6, -90), new THREE.Vector3(0, -0.2, -1));
  assert.equal(sun.shadow.camera.right, SHADOW_SPAN);
  const t = sun.target.position;
  assert.ok(Math.abs(t.x - 100) < 0.2 && Math.abs(t.z - (-90 - SHADOW_SPAN * SHADOW_LOOK_BIAS)) < 0.2, `target ${t.toArray()}`);
  const toSun = sun.position.clone().sub(t).normalize();
  assert.ok(toSun.distanceTo(dir) < 1e-6, 'sun direction preserved');
});

test('hit proxies are never drawn but still raycastable', () => {
  for (const model of [buildSoldier(), buildArmoredSoldier(1, 0x2C7C8E)]) {
    const proxies = model.hitMeshes.filter(m => m.material === HIT_PROXY_MAT);
    assert.equal(proxies.length, 4);
    assert.equal(HIT_PROXY_MAT.visible, false);
    model.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.3, -5), new THREE.Vector3(0, 0, 1));
    const hits = ray.intersectObjects(proxies, false);
    assert.ok(hits.length > 0, 'bullets still hit the proxy');
  }
});

test('mission soldier rifle LOD swaps with hysteresis and restores detail up close', () => {
  const model = buildSoldier();
  const lod = model.weaponLod;
  assert.ok(lod && lod.hi.length >= 3, 'detailed rifle parts registered');
  assert.equal(updateWeaponLod(model, 5), true);
  assert.equal(updateWeaponLod(model, WEAPON_LOD_DISTANCE + 1), true, 'inside hysteresis band: stays detailed');
  assert.equal(updateWeaponLod(model, WEAPON_LOD_DISTANCE + 3), false);
  assert.ok(lod.hi.every(o => !o.visible) && lod.lo.visible);
  assert.equal(updateWeaponLod(model, WEAPON_LOD_DISTANCE - 1), false, 'no flicker back inside the band');
  assert.equal(updateWeaponLod(model, WEAPON_LOD_DISTANCE - 3), true);
  assert.ok(lod.hi.every(o => o.visible) && !lod.lo.visible);
  let draws = 0; model.parts.rifle.traverseVisible(o => { if (o.isMesh) draws++; });
  updateWeaponLod(model, 40);
  let far = 0; model.parts.rifle.traverseVisible(o => { if (o.isMesh) far++; });
  assert.equal(far, 1, 'far rifle is a single draw');
  assert.ok(draws > far);
});
