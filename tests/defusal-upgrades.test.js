import './helpers/register-json.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCanvasStub } from './helpers/geometry.js';

installCanvasStub();
const { Engine } = await import('../src/game/engine.ts');
const { attachmentOffers, buy, buyAttachment, freshInventory } = await import('../src/game/defusal/shop.ts');

// This deliberately exercises Engine's field-build cache rather than applyBuild
// directly: a successful shop purchase must reach the viewmodel used in-round.
test('a field-bought attachment reaches the cached in-round viewmodel', () => {
  let inv = buy(freshInventory(10000), 'm4a1', 'defend').inv;
  const optic = attachmentOffers(inv).find(offer => offer.attachment.slot === 'optic');
  assert.ok(optic);
  inv = buyAttachment(inv, optic.id).inv;

  const engine = Object.assign(Object.create(Engine.prototype), {
    dfBuilds: {}, dfWeaponCache: new Map(), vmScene: new THREE.Scene(),
  });
  const weapon = Engine.prototype.dfWeapon.call(engine, inv.primary, inv.primaryAttachments);
  assert.equal(weapon.model.attached.optic?.name, optic.name);
  assert.equal(weapon.model.group.parent, engine.vmScene, 'field build is mounted in the viewmodel scene');
  assert.equal(Engine.prototype.dfWeapon.call(engine, inv.primary, inv.primaryAttachments), weapon, 'the completed field build stays cached for the round');
});
