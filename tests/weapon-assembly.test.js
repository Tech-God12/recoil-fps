import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';
import { disconnectedSolids, assembliesInterfere, disposeWeapon } from './helpers/weapon-geometry.js';

const { WEAPON_BUILDERS, buildSoldier, WM } = await import('../src/game/models.ts');
const { weaponBounds } = await import('../src/game/weapons/geometry.ts');
const { attach, detach, applyBuild, ATTACHMENT_BUILDERS, ATTACH_ORDER } = await import('../src/game/attachments.ts');
const { WEAPON_CATALOG, ATTACHMENT_CATALOG, attachmentsFor, attachmentById, weaponById } = await import('../src/game/economy/catalog.ts');

function approx(a, b, message) { assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`); }
function connected(model, label) {
  assert.deepEqual(disconnectedSolids(model.group), [], `${label}: disconnected solid pieces`);
}
function visible(object) {
  for (let o = object; o; o = o.parent) if (!o.visible || o.userData.arm) return false;
  return true;
}

test('every factory gun is a physically connected assembly, including tiny fixtures', () => {
  for (const [id, build] of Object.entries(WEAPON_BUILDERS)) {
    const model = build();
    try { connected(model, id); } finally { disposeWeapon(model); }
  }
  const restore = installCanvasStub();
  try {
    const soldier = buildSoldier();
    assert.deepEqual(disconnectedSolids(soldier.parts.rifle), [], 'world rifle must not retain the old floating/segmented furniture');
    soldier.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  } finally { restore(); }
});

test('contact audit detects a genuinely displaced stock, not just scene-graph parenting', () => {
  const model = WEAPON_BUILDERS.m4a1();
  const stock = model.removable.stock[0];
  stock.position.y = 0.20; // Still parented to the gun, but physically disconnected.
  assert.ok(disconnectedSolids(model.group).some(name => name.includes('stock')));
  stock.position.y = 0;
  connected(model, 'restored stock');
  disposeWeapon(model);
});

test('all 185 supported attachment/weapon pairings have a continuous contact path', () => {
  let checked = 0;
  for (const entry of ATTACHMENT_CATALOG) for (const id of entry.compat) {
    if (!weaponById(id).slots.includes(entry.slot)) continue;
    const model = WEAPON_BUILDERS[id]();
    try {
      attach(model, entry, id);
      connected(model, `${id} + ${entry.id}`);
      detach(model, entry.slot);
      checked++;
    } finally { disposeWeapon(model); }
  }
  assert.equal(checked, 185);
});

test('fully equipped builds remain connected when replacement slots overlap', () => {
  for (const entry of WEAPON_CATALOG) for (const variant of [0, 1, 3, 5]) {
    const attachments = {};
    for (const slot of entry.slots) {
      const parts = attachmentsFor(entry.id, slot);
      if (parts.length) attachments[slot] = parts[variant % parts.length].id;
    }
    const model = WEAPON_BUILDERS[entry.id]();
    try {
      applyBuild(model, { weapon: entry.id, attachments });
      connected(model, `${entry.id} build ${variant}`);
      // Strip in a different order from installation to exercise shared removable parts.
      for (const slot of [...ATTACH_ORDER].reverse()) detach(model, slot);
      connected(model, `${entry.id} restored factory`);
    } finally { disposeWeapon(model); }
  }
});

test('factory and upgraded magazines never intersect neighbouring foregrips/bipods', () => {
  for (const entry of WEAPON_CATALOG) {
    if (entry.id === 'spas12') continue; // Its internal tube and sliding pump intentionally nest.
    for (const mag of [null, ...attachmentsFor(entry.id, 'magazine')]) {
      for (const underbarrel of [null, ...attachmentsFor(entry.id, 'underbarrel')]) {
        const model = WEAPON_BUILDERS[entry.id]();
        try {
          if (mag) attach(model, mag, entry.id);
          if (underbarrel) attach(model, underbarrel, entry.id);
          const grip = model.attached.underbarrel ?? model.removable.underbarrel?.[0];
          if (!grip) continue;
          assert.equal(assembliesInterfere(model.mag, grip), false,
            `${entry.id}: ${mag?.id ?? 'factory mag'} intersects ${underbarrel?.id ?? 'factory grip'}`);
        } finally { disposeWeapon(model); }
      }
    }
  }
});

test('clearance audit detects the Vector drum pushed back through its foregrip', () => {
  const model = WEAPON_BUILDERS.vector();
  attach(model, attachmentById('mag_drum'), 'vector');
  attach(model, attachmentById('ub_vert_grip'), 'vector');
  model.mag.position.y += 0.065;
  assert.equal(assembliesInterfere(model.mag, model.attached.underbarrel), true);
  disposeWeapon(model);
});

test('side-rail mounts inherit the socket rotation, including pistol underframe rails', () => {
  for (const id of ['m4a1', 'ak47', 'spas12', 'm1911', 'deagle']) {
    const model = WEAPON_BUILDERS[id]();
    attach(model, attachmentById('rail_flashlight'), id);
    const part = model.attached.rail, socket = model.sockets.rail;
    assert.equal(part.parent, socket.parent);
    assert.ok(part.quaternion.angleTo(socket.quaternion) < 1e-8, `${id} rail orientation`);
    assert.ok(part.position.distanceTo(socket.position) < 1e-8, `${id} rail position`);
    disposeWeapon(model);
  }
});

test('rebatching coupled magazines preserves both source shells for contact auditing', () => {
  const model = WEAPON_BUILDERS.m4a1();
  attach(model, attachmentById('mag_fast'), 'm4a1');
  let shells = 0;
  model.mag.traverse(o => {
    if (o.isMesh) shells += (o.geometry.userData.pieces ?? []).filter(p => p.name === 'continuous magazine shell').length;
  });
  assert.equal(shells, 2);
  connected(model, 'coupled magazines');
  disposeWeapon(model);
});

test('trigger guards contain real open space, not dark blocks painted onto a solid frame', () => {
  for (const [id, y, z] of [['m4a1', -0.051, -0.111], ['m1911', -0.031, -0.054]]) {
    const model = WEAPON_BUILDERS[id](); model.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(-0.2, y, z), new THREE.Vector3(1, 0, 0), 0, 0.4);
    assert.equal(ray.intersectObject(model.group, true).filter(hit => visible(hit.object)).length, 0, `${id} trigger opening blocked`);
    disposeWeapon(model);
  }
});

test('curved magazines are continuous shells, not stacks of disconnected boxes', () => {
  for (const id of ['m4a1', 'ak47', 'm1911', 'mp7', 'scar_h', 'vector', 'deagle', 'awm']) {
    const model = WEAPON_BUILDERS[id]();
    let shells = 0;
    model.mag.traverse(o => {
      if (o.isMesh) shells += (o.geometry.userData.pieces ?? []).filter(piece => piece.name === 'continuous magazine shell').length;
    });
    assert.equal(shells, 1, `${id} needs one continuous magazine shell`);
    model.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model.mag);
    for (let i = 1; i < 10; i++) {
      const y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, i / 10);
      const ray = new THREE.Raycaster(new THREE.Vector3(0, y, bounds.max.z + 0.05), new THREE.Vector3(0, 0, -1), 0, 1);
      assert.ok(ray.intersectObject(model.mag, true).length > 0, `${id} magazine has a gap at ${y}`);
    }
    disposeWeapon(model);
  }
});

test('factory muzzles and exposed barrels have open bores rather than solid end caps', () => {
  for (const [id, build] of Object.entries(WEAPON_BUILDERS)) {
    const model = build(); model.group.updateMatrixWorld(true);
    for (const [anchor, distance] of [[model.muzzle, 0.030], [model.sockets.muzzle, 0.020]]) {
      const origin = anchor.getWorldPosition(new THREE.Vector3()); origin.z -= 0.010;
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, 1), 0, distance);
      const hits = ray.intersectObject(model.group, true).filter(hit => visible(hit.object));
      assert.equal(hits.length, 0, `${id} has a cap on its bore`);
    }
    disposeWeapon(model);
  }
});

test('pistol breeches close the rear of the slide while the muzzle remains a real bore', () => {
  for (const id of ['m1911', 'deagle']) {
    const model = WEAPON_BUILDERS[id](); model.group.updateMatrixWorld(true);
    const back = new THREE.Raycaster(new THREE.Vector3(0, id === 'm1911' ? 0.026 : 0.031, 0.10), new THREE.Vector3(0, 0, -1), 0, 0.10);
    assert.ok(back.intersectObject(model.chargingHandle, true).length > 0, `${id} has an unfinished open breech`);
    disposeWeapon(model);
  }
});

test('muzzle attachments have genuinely open bores and seat at their declared ends', () => {
  for (const part of ATTACHMENT_CATALOG.filter(a => a.slot === 'muzzle')) {
    const id = part.compat[0], model = WEAPON_BUILDERS[id]();
    const device = ATTACHMENT_BUILDERS[part.visual]({ weapon: id, model, cls: weaponById(id).cls });
    device.updateMatrixWorld(true);
    const length = device.userData.length;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, -length - 0.010), new THREE.Vector3(0, 0, 1), 0, Math.min(0.022, length * 0.6));
    assert.equal(ray.intersectObject(device, true).length, 0, `${part.id} bore is capped`);
    const bounds = new THREE.Box3().setFromObject(device);
    assert.ok(bounds.max.z > -0.0001, `${part.id} starts ahead of its mounting shoulder`);
    assert.ok(Math.abs(bounds.min.z + length) < 0.004, `${part.id} muzzle anchor misses the visible tip`);
    device.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); disposeWeapon(model);
  }
});

test('stock AWM glass has supported rings without an opaque obstruction on the optical axis', () => {
  const model = WEAPON_BUILDERS.awm(); model.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, model.sightY, 0.2), new THREE.Vector3(0, 0, -1), 0, 0.7);
  const hits = ray.intersectObject(model.optic, true);
  assert.ok(hits.some(hit => hit.object.material === WM.glass));
  for (const { object } of hits) {
    let optical = object.material === WM.glass;
    for (let o = object; o; o = o.parent) optical ||= model.adsHidden.includes(o);
    assert.ok(optical, `${object.name} blocks the scope bore`);
  }
  disposeWeapon(model);
});

test('barrel/muzzle swapping is order-independent and never revives hidden factory devices', () => {
  for (const id of ['m4a1', 'ak47', 'scar_h', 'vector', 'm249', 'm1911', 'deagle']) {
    const model = WEAPON_BUILDERS[id](), original = model.muzzle.position.z;
    attach(model, attachmentById('brl_long'), id);
    attach(model, attachmentById('muz_flash_hider'), id);
    const shoulder = model.sockets.muzzle.position.z;
    detach(model, 'muzzle');
    approx(model.muzzle.position.z, shoulder - 0.004, 'stripping a device must keep the extended barrel anchor');
    assert.ok((model.removable.muzzle ?? []).every(o => !o.visible), 'factory device stays hidden by barrel replacement');
    attach(model, attachmentById('muz_flash_hider'), id);
    detach(model, 'barrel');
    assert.ok((model.removable.muzzle ?? []).every(o => !o.visible), 'barrel strip cannot revive a device under another device');
    approx(model.attached.muzzle.position.z, model.sockets.muzzle.position.z, 'device reseats on factory shoulder');
    detach(model, 'muzzle');
    approx(model.muzzle.position.z, original, 'original muzzle restored');
    disposeWeapon(model);
  }
});

test('slide/cover optics and their sockets share the same moving assembly', () => {
  for (const id of ['m1911', 'deagle', 'm249']) {
    const model = WEAPON_BUILDERS[id]();
    attach(model, attachmentById(id === 'm249' ? 'opt_reddot' : 'opt_pistol_rmr'), id);
    // Catalog names are intentionally resolved; absent/renamed IDs fail rather than silently skipping.
    assert.equal(model.attached.optic.parent, model.chargingHandle);
    const restingY = model.sockets.optic.getWorldPosition(new THREE.Vector3()).y;
    approx(model.sightY + model.attached.optic.userData.sightYOffset, restingY + model.attached.optic.userData.lensH, 'resting ADS height');
    if (id === 'm249') model.chargingHandle.rotation.x = -0.9;
    else model.chargingHandle.position.z += 0.035;
    model.group.updateMatrixWorld(true);
    const socket = model.sockets.optic.getWorldPosition(new THREE.Vector3());
    const optic = model.attached.optic.getWorldPosition(new THREE.Vector3());
    assert.ok(socket.distanceTo(optic) < 1e-8, `${id} optic floats during movement`);
    detach(model, 'optic'); disposeWeapon(model);
  }
});

test('SPAS tube extensions do not steal the reload/pump handle', () => {
  const model = WEAPON_BUILDERS.spas12(), pump = model.mag;
  attach(model, attachmentById('mag_shell_tube'), 'spas12');
  attach(model, attachmentById('ub_vert_grip'), 'spas12');
  assert.equal(model.mag, pump);
  assert.equal(model.attached.underbarrel.parent, pump);
  const extension = model.attached.magazine.position.clone();
  pump.position.z += 0.055;
  assert.deepEqual(model.attached.magazine.position.toArray(), extension.toArray(), 'stationary tube must not cycle with pump');
  detach(model, 'magazine'); assert.equal(model.mag, pump);
  disposeWeapon(model);
});

test('showcase bounds ignore arms and stripped furniture but include fitted accessories', () => {
  const model = WEAPON_BUILDERS.m4a1(), before = weaponBounds(model.group);
  model.lArm.position.set(50, -50, 20);
  const unchanged = weaponBounds(model.group);
  assert.ok(before.min.distanceTo(unchanged.min) < 1e-6 && before.max.distanceTo(unchanged.max) < 1e-6);
  attach(model, attachmentById('stk_none'), 'm4a1');
  assert.ok(weaponBounds(model.group).max.z < before.max.z - 0.1, 'hidden stock must not affect fit');
  attach(model, attachmentById('muz_suppressor'), 'm4a1');
  assert.ok(weaponBounds(model.group).min.z < before.min.z - 0.05, 'long fitted muzzle must be included');
  disposeWeapon(model);
});
