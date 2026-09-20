import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryBudget } from './helpers/geometry.js';

const models = await import('../src/game/models.ts');
const attach3d = await import('../src/game/attachments.ts');
const catalog = await import('../src/game/economy/catalog.ts');

const { WEAPON_BUILDERS } = models;
const { ATTACHMENT_BUILDERS, attach, detach, applyBuild } = attach3d;
const { WEAPON_CATALOG, ATTACHMENT_CATALOG, weaponById, attachmentById } = catalog;

function finiteGroup(group) {
  group.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    assert.ok(pos.count > 0, 'empty geometry');
    const arr = pos.array;
    for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), 'non-finite vertex');
  });
}

test('all ten guns build with finite geometry and full armory wiring', () => {
  assert.deepEqual(Object.keys(WEAPON_BUILDERS).sort(), WEAPON_CATALOG.map(w => w.id).sort());
  for (const entry of WEAPON_CATALOG) {
    const model = WEAPON_BUILDERS[entry.id]();
    finiteGroup(model.group);
    const bounds = new THREE.Box3().setFromObject(model.group);
    assert.ok(bounds.max.z - bounds.min.z > 0.2, `${entry.id} has no real length`);
    assert.equal(typeof model.mag.userData.homeY, 'number', `${entry.id} mag needs homeY for reload`);
    assert.ok(model.chargingHandle, `${entry.id} needs a charging handle`);
    assert.ok(model.lArm, `${entry.id} needs a left arm`);
    assert.deepEqual(model.attached, {}, `${entry.id} starts bare`);
    for (const slot of entry.slots) {
      assert.ok(model.sockets[slot], `${entry.id} missing ${slot} socket`);
      // removable[slot] may be absent (stock A2 birdcage doubles as a QD mount) but never junk.
      const rem = model.removable[slot];
      assert.ok(rem === undefined || Array.isArray(rem), `${entry.id}.${slot} removable must be an array`);
    }
  }
});

test('guns stay inside the measured render budgets', () => {
  for (const entry of WEAPON_CATALOG) {
    const model = WEAPON_BUILDERS[entry.id]();
    const { draws, triangles } = geometryBudget(model.group);
    assert.ok(draws <= 44, `${entry.id}: ${draws} draws over budget`);
    // Hero-detail budget: curved furniture, cut openings and multi-segment bevels.
    // Draw calls stay at the original cap; tiny hardware is adaptively tessellated.
    assert.ok(triangles <= 48000, `${entry.id}: ${Math.round(triangles)} tris over budget`);
    const floor = entry.slot === 'primary' ? 20000 : 10000;
    assert.ok(triangles >= floor, `${entry.id}: ${Math.round(triangles)} tris under richness floor`);
  }
});

test('every catalog attachment has a builder that produces finite meshes', () => {
  for (const part of ATTACHMENT_CATALOG) {
    const builder = ATTACHMENT_BUILDERS[part.visual];
    assert.ok(builder, `${part.id} has no visual builder`);
    const wid = part.compat.find(id => weaponById(id)?.slots.includes(part.slot));
    const model = WEAPON_BUILDERS[wid]();
    const obj = builder({ weapon: wid, model, cls: weaponById(wid).cls });
    assert.ok(obj.isObject3D, `${part.id} builds no object`);
    if (part.visual === 'stock_none') {
      assert.equal(obj.children.length, 0, 'stk_none is the only empty part');
      continue;
    }
    let meshes = 0;
    obj.traverse(o => { if (o.isMesh) meshes++; });
    assert.ok(meshes >= 1 && meshes <= 6, `${part.id}: ${meshes} meshes`);
    finiteGroup(obj);
  }
});

test('attach/detach round-trips child count and stock visibility', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const before = model.group.children.length;
  attach(model, attachmentById('muz_flash_hider'), 'm4a1');
  assert.equal(model.group.children.length, before + 1);
  assert.ok((model.removable.muzzle ?? []).every(o => o.visible === false));
  detach(model, 'muzzle');
  assert.equal(model.group.children.length, before);
  assert.ok((model.removable.muzzle ?? []).every(o => o.visible === true));
  detach(model, 'muzzle'); // idempotent
  assert.equal(model.group.children.length, before);
});

test('applyBuild with a full build then an empty build restores the group', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const before = model.group.children.length;
  applyBuild(model, {
    weapon: 'm4a1',
    attachments: {
      muzzle: 'muz_suppressor', optic: 'opt_3x', magazine: 'mag_extended',
      underbarrel: 'ub_vert_grip', stock: 'stk_heavy', rail: 'rail_laser', barrel: 'brl_long',
    },
  });
  assert.equal(Object.keys(model.attached).length, 7);
  assert.ok(model.group.children.length > before);
  applyBuild(model, { weapon: 'm4a1', attachments: {} });
  assert.equal(model.group.children.length, before);
  assert.deepEqual(model.attached, {});
});

test('barrels move the bore: long goes forward, short pulls back', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const base = model.muzzle.position.z;
  attach(model, attachmentById('brl_long'), 'm4a1');
  assert.ok(model.muzzle.position.z < base, 'long barrel must extend past the stock muzzle');
  detach(model, 'barrel');
  assert.equal(model.muzzle.position.z, base);
  attach(model, attachmentById('brl_short'), 'm4a1');
  assert.ok(model.muzzle.position.z > base, 'short barrel must pull the muzzle back');
});

test('a can fitted over a long barrel seats on the new bore end', () => {
  const model = WEAPON_BUILDERS.m4a1();
  applyBuild(model, { weapon: 'm4a1', attachments: { barrel: 'brl_long', muzzle: 'muz_suppressor' } });
  assert.equal(model.attached.muzzle.position.z, model.sockets.muzzle.position.z);
  assert.ok(model.muzzle.position.z < -0.7, `can tip at ${model.muzzle.position.z}`);
});

test('optics hide only their aiming mark in ADS — the glass stays see-through', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const hidden = model.adsHidden.length;
  attach(model, attachmentById('opt_3x'), 'm4a1');
  assert.ok(Number.isFinite(model.attached.optic.userData.sightYOffset));
  assert.ok(model.adsHidden.length > hidden, 'optic mark must join adsHidden');
  assert.ok(model.removable.optic.every(o => o.visible === false), 'ACOG hides the irons');
  // lenses carry no adsHide tag: the sight picture looks through real glass
  let lenses = 0;
  model.attached.optic.traverse(o => {
    if (o.isMesh && o.material === models.WM.glass) {
      lenses++;
      assert.equal(o.userData.adsHide, undefined, 'glass must stay visible in ADS');
    }
  });
  assert.ok(lenses >= 2, `ACOG needs front+rear lenses, found ${lenses}`);
  detach(model, 'optic');
  assert.equal(model.adsHidden.length, hidden);
});

test('magnified optics are genuinely see-through down the optical axis', () => {
  for (const [id, wid] of [['opt_4x', 'm4a1'], ['opt_6x', 'awm'], ['opt_3x', 'm4a1']]) {
    const part = attachmentById(id);
    const model = WEAPON_BUILDERS[wid]();
    const obj = ATTACHMENT_BUILDERS[part.visual]({ weapon: wid, model, cls: weaponById(wid).cls });
    const y = obj.userData.lensH;
    obj.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, y, 0.3), new THREE.Vector3(0, 0, -1), 0, 1.0);
    const hits = ray.intersectObject(obj, true);
    assert.ok(hits.length >= 2, `${id}: ray must meet both lenses, got ${hits.length}`);
    for (const h of hits) {
      const o = h.object;
      const seeThrough = o.material === models.WM.glass || o.userData.adsHide === true;
      assert.ok(seeThrough, `${id}: solid ${o.geometry.type} blocks the sight line`);
    }
  }
});

test('pistol mags and barrels ship compact variants without rifle furniture', () => {
  const pistol = WEAPON_BUILDERS.m1911();
  const rifle = WEAPON_BUILDERS.m4a1();
  const pcls = weaponById('m1911').cls;
  const rcls = weaponById('m4a1').cls;
  const pmag = ATTACHMENT_BUILDERS.mag_ext({ weapon: 'm1911', model: pistol, cls: pcls });
  const rmag = ATTACHMENT_BUILDERS.mag_ext({ weapon: 'm4a1', model: rifle, cls: rcls });
  assert.equal(pmag.userData.variant, 'pistol');
  assert.equal(rmag.userData.variant, 'std');
  for (const visual of ['barrel_long', 'barrel_short']) {
    const pp = ATTACHMENT_BUILDERS[visual]({ weapon: 'm1911', model: pistol, cls: pcls });
    const rp = ATTACHMENT_BUILDERS[visual]({ weapon: 'm4a1', model: rifle, cls: rcls });
    assert.equal(pp.userData.variant, 'pistol', `${visual} pistol variant`);
    assert.equal(rp.userData.variant, 'std', `${visual} rifle variant`);
    // rifle furniture (gas block, shroud, posts) merges into extra material
    // buckets; the pistol barrel is a pure tube with fewer meshes
    let pMeshes = 0;
    let rMeshes = 0;
    pp.traverse(o => { if (o.isMesh) pMeshes++; });
    rp.traverse(o => { if (o.isMesh) rMeshes++; });
    assert.ok(rMeshes > pMeshes, `${visual}: rifle keeps furniture (${rMeshes} meshes vs ${pMeshes})`);
  }
});

test('stocks scale down on SMG/PDW frames', () => {
  const smg = WEAPON_BUILDERS.vector();
  const rifle = WEAPON_BUILDERS.m4a1();
  const ps = ATTACHMENT_BUILDERS.stock_heavy({ weapon: 'vector', model: smg, cls: weaponById('vector').cls });
  const rs = ATTACHMENT_BUILDERS.stock_heavy({ weapon: 'm4a1', model: rifle, cls: weaponById('m4a1').cls });
  assert.equal(ps.userData.variant, 'compact');
  assert.equal(ps.scale.x, 0.9);
  assert.equal(rs.userData.variant, 'std');
  assert.equal(rs.scale.x, 1);
});

test('magazines swap the reload handle and restore it on detach', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const stock = model.mag;
  attach(model, attachmentById('mag_extended'), 'm4a1');
  assert.notEqual(model.mag, stock);
  assert.equal(typeof model.mag.userData.homeY, 'number');
  detach(model, 'magazine');
  assert.equal(model.mag, stock);
});

test('stk_none strips the stock and the bipod ships folding legs', () => {
  const model = WEAPON_BUILDERS.m4a1();
  attach(model, attachmentById('stk_none'), 'm4a1');
  assert.ok(model.removable.stock.every(o => o.visible === false), 'stock meshes must hide');
  detach(model, 'stock');
  assert.ok(model.removable.stock.every(o => o.visible === true));
  attach(model, attachmentById('ub_bipod'), 'm4a1');
  assert.equal(model.attached.underbarrel.userData.legs.length, 2);
});

test('reciprocating slides, pump forend and belt cover exist as anim targets', () => {
  for (const id of ['m1911', 'deagle']) {
    const slide = WEAPON_BUILDERS[id]().chargingHandle;
    let meshes = 0;
    slide.traverse(o => { if (o.isMesh) meshes++; });
    assert.ok(meshes > 0, `${id} slide needs meshes to reciprocate`);
  }
  const spas = WEAPON_BUILDERS.spas12();
  let forend = 0;
  spas.mag.traverse(o => { if (o.isMesh) forend++; });
  assert.ok(forend > 0, 'SPAS forend is the pump handle');
  let cover = 0;
  WEAPON_BUILDERS.m249().chargingHandle.traverse(o => { if (o.isMesh) cover++; });
  assert.ok(cover > 0, 'M249 belt cover pops on reload');
});

test('muzzle parts report length, optics report lens height', () => {
  for (const part of ATTACHMENT_CATALOG.filter(a => a.slot === 'muzzle')) {
    const wid = part.compat[0];
    const obj = ATTACHMENT_BUILDERS[part.visual]({ weapon: wid, model: WEAPON_BUILDERS[wid](), cls: weaponById(wid).cls });
    assert.ok(obj.userData.length > 0.01, `${part.id} needs a tip length for the muzzle anchor`);
  }
  for (const part of ATTACHMENT_CATALOG.filter(a => a.slot === 'optic')) {
    const wid = part.compat.find(id => weaponById(id)?.slots.includes('optic'));
    const obj = ATTACHMENT_BUILDERS[part.visual]({ weapon: wid, model: WEAPON_BUILDERS[wid](), cls: weaponById(wid).cls });
    assert.ok(obj.userData.lensH > 0.005, `${part.id} needs a lens height for ADS alignment`);
  }
});

test('applySkin Factory is the identity; coats repaint only their roles', () => {
  const model = WEAPON_BUILDERS.m4a1();
  // callers own the materials: mirror the viewer/engine clone step
  const seen = new Map();
  model.group.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    if (!seen.has(o.material)) seen.set(o.material, o.material.clone());
    o.material = seen.get(o.material);
  });
  const before = new Map();
  model.group.traverse(o => {
    if (o.isMesh && !Array.isArray(o.material)) before.set(o, o.material.color.getHex());
  });
  const factory = { id: 'factory', name: 'Factory', desc: '', swatch: '#000', coats: {} };
  models.applySkin(model.group, factory);
  model.group.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    assert.equal(o.material.color.getHex(), before.get(o), 'Factory must not move any color');
  });
  const polyHex = models.WM.poly.color.getHex();
  models.applySkin(model.group, { ...factory, coats: { poly: { color: 0xFF0000, roughness: 0.1 } } });
  let coated = 0;
  let rest = 0;
  model.group.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    if (before.get(o) === polyHex) {
      assert.equal(o.material.color.getHex(), 0xFF0000, 'poly role takes the coat');
      coated++;
    } else {
      assert.equal(o.material.color.getHex(), before.get(o), 'other roles untouched');
      rest++;
    }
  });
  assert.ok(coated > 0 && rest > 0, `coated ${coated}, untouched ${rest}`);
  models.applySkin(model.group, factory);
  model.group.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    assert.equal(o.material.color.getHex(), before.get(o), 'Factory restores stock colors');
  });
});
