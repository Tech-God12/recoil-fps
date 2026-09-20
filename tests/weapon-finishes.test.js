import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeWeapon } from './helpers/weapon-geometry.js';

const { WM, WEAPON_BUILDERS, applySkin } = await import('../src/game/models.ts');
const { WeaponFinish, weaponTexturesReady, areWeaponTexturesReady } = await import('../src/game/weapons/finish.ts');
const { GunBuilder } = await import('../src/game/weapons/geometry.ts');
const { skinById } = await import('../src/game/economy/skins.ts');

function pieces(root) {
  const result = [];
  root.traverse(mesh => {
    if (mesh.isMesh) for (const piece of mesh.geometry.userData.pieces ?? []) result.push({ mesh, piece });
  });
  return result;
}
function shader() {
  return { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>' };
}

test('physical weapon finishes share colour/roughness assets but distinguish walnut, metal and checkering', async () => {
  await weaponTexturesReady;
  assert.equal(areWeaponTexturesReady(), true, 'readiness also resolves safely without a browser DOM');
  assert.ok(WM.steel instanceof WeaponFinish && WM.wood instanceof WeaponFinish);
  assert.equal(WM.steel.map, WM.darkSteel.map, 'shared maps must not duplicate on every gun');
  assert.notEqual(WM.wood.map, WM.steel.map);
  assert.equal(WM.wood.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(WM.steel.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(WM.steel.roughnessMap.colorSpace, THREE.NoColorSpace);
  assert.notEqual(WM.steel.map, WM.steel.roughnessMap, 'roughness is data, not the colour texture');
  assert.equal(WM.grip.bumpMap.image.width, 512);
  assert.notEqual(WM.wood.bumpMap, WM.woodDark.bumpMap);
  assert.equal(WM.woodDark.bumpMap.repeat.x, 8, 'checkering retains a fine physical scale over larger wood UVs');
});

test('cloned viewmodel materials retain their finish shaders and share, rather than own, textures', () => {
  for (const original of Object.values(WM).filter(material => material instanceof WeaponFinish)) {
    const clone = original.clone();
    assert.ok(clone instanceof WeaponFinish);
    assert.notEqual(clone.userData.finish, original.userData.finish);
    assert.deepEqual(clone.userData.finish, original.userData.finish);
    assert.equal(clone.map, original.map);
    assert.equal(clone.bumpMap, original.bumpMap);
    const sourceShader = shader(), clonedShader = shader();
    original.onBeforeCompile(sourceShader); clone.onBeforeCompile(clonedShader);
    assert.match(clonedShader.vertexShader, /attribute vec2 weaponSurface/);
    assert.match(clonedShader.fragmentShader, /diffuseColor\.rgb = mix/);
    assert.equal(clonedShader.fragmentShader, sourceShader.fragmentShader);
    assert.notEqual(clonedShader.uniforms.weaponWearColor.value, sourceShader.uniforms.weaponWearColor.value);
    const color = original.color.getHex();
    clone.color.setHex(0xFF0000);
    assert.equal(original.color.getHex(), color, 'viewer fading/painting must not mutate the shared finish');
    clone.dispose();
  }
});

test('skins restore factory PBR parameters without dropping grain, wear or owned-material isolation', () => {
  const material = WM.darkSteel.clone();
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 1, 1);
  group.add(new THREE.Mesh(geometry, material));
  const initial = [material.color.getHex(), material.roughness, material.metalness];
  const image = material.map, roughness = material.roughnessMap;
  // The catalog currently ships Factory only; exercise the supported future-coat path.
  const painted = { ...skinById('factory'), coats: { darkSteel: { color: 0xCCAA77, roughness: 0.85, metalness: 0.13 } } };
  applySkin(group, painted);
  assert.equal(material.color.getHex(), 0xCCAA77);
  assert.equal(material.map, image); assert.equal(material.roughnessMap, roughness);
  assert.equal(material.customProgramCacheKey(), WM.darkSteel.customProgramCacheKey());
  applySkin(group, skinById('factory'));
  assert.deepEqual([material.color.getHex(), material.roughness, material.metalness], initial);
  material.dispose(); geometry.dispose();
});

test('bevel-only wear leaves flat faces unpainted, with metre-scaled UVs and finite smooth normals', () => {
  const group = new THREE.Group(), b = new GunBuilder();
  b.name('surface test').profile([[-0.15, -0.025], [-0.15, 0.025], [0.15, 0.025], [0.15, -0.025]], 0.040, WM.steel, 0, 0.002);
  b.build(group);
  const geometry = group.children[0].geometry;
  const { position, normal, uv, weaponSurface } = geometry.attributes;
  assert.equal(weaponSurface.count, position.count);
  assert.ok(Array.from(normal.array).every(Number.isFinite));
  const mask = Array.from({ length: weaponSurface.count }, (_, i) => weaponSurface.getX(i));
  assert.ok(mask.some(value => value > 0.5), 'real rounded bevels carry polished edges');
  let flatTriangles = 0;
  for (let i = 0; i < position.count; i += 3) {
    if (![i, i + 1, i + 2].every(j => Math.abs(position.getX(j) - 0.020) < 1e-7)) continue;
    flatTriangles++;
    for (let j = i; j < i + 3; j++) {
      assert.ok(weaponSurface.getX(j) < 1e-5, 'do not paint the entire cap silver');
      assert.ok(Math.abs(uv.getX(j) + position.getZ(j) / WM.steel.userData.finish.tile) < 1e-5);
      assert.ok(Math.abs(uv.getY(j) - position.getY(j) / WM.steel.userData.finish.tile) < 1e-5);
    }
  }
  assert.ok(flatTriangles > 4);
  geometry.dispose();
});

test('sculpted furniture has continuously varying width, not a texture on a flat extruded plate', () => {
  const group = new THREE.Group(), b = new GunBuilder();
  b.name('rounded stock').loft([[0, 0.020, -0.020, 0.028], [0.10, 0.022, -0.045, 0.048], [0.20, 0.020, -0.070, 0.038]], WM.wood);
  b.build(group);
  const geometry = group.children[0].geometry, p = geometry.attributes.position;
  const widthAt = z => {
    let width = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) - z) < 1e-6) width = Math.max(width, Math.abs(p.getX(i)) * 2);
    return width;
  };
  assert.ok(widthAt(0.10) > widthAt(0) * 1.6);
  assert.ok(widthAt(0.20) < widthAt(0.10));
  assert.equal(geometry.userData.pieces.length, 1, 'one closed furniture solid');
  assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  geometry.dispose();
});

test('reference-specific factory finishes and solid stock survive the shared builders', () => {
  const pistol = WEAPON_BUILDERS.m1911(), scar = WEAPON_BUILDERS.scar_h();
  const saw = WEAPON_BUILDERS.m249(), spas = WEAPON_BUILDERS.spas12(), ak = WEAPON_BUILDERS.ak47();
  try {
    const slide = pieces(pistol.chargingHandle).find(({ piece }) => piece.name === 'rounded 1911 slide');
    assert.equal(slide.mesh.material, WM.darkSteel, 'the 1911 is blued, not a bright silver slab');
    const shell = pieces(scar.mag).find(({ piece }) => piece.name === 'continuous magazine shell');
    assert.equal(shell.mesh.material, WM.fde, 'reference SCAR magazine is tan');
    assert.ok(!pieces(spas.group).some(({ mesh }) => mesh.material === WM.red), 'no added red shell saddle');
    saw.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(-0.2, -0.015, 0.170), new THREE.Vector3(1, 0, 0), 0, 0.4);
    assert.ok(ray.intersectObject(saw.removable.stock[0], true).length > 0, 'M249 stock is solid, not the generic skeleton stock');
    const stock = pieces(ak.removable.stock[0]).find(({ piece }) => piece.name === 'walnut stock');
    const p = stock.mesh.geometry.attributes.position, widths = new Set();
    for (let i = stock.piece.start; i < stock.piece.start + stock.piece.count; i++) widths.add(Math.round(Math.abs(p.getX(i)) * 1e6));
    assert.ok(widths.size > 20, 'walnut buttstock needs sculpted cross-sections');
  } finally { for (const model of [pistol, scar, saw, spas, ak]) disposeWeapon(model); }
});
