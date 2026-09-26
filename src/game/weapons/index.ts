import type { WeaponId } from '../economy/catalog';
import type { WeaponModel } from './core';
import { buildM4, buildAK47, buildSCARH, buildSpear } from './rifles';
import { buildM1911, buildDeagle } from './sidearms';
import { buildMP7, buildVector } from './compact';
import { buildAWM, buildSPAS12, buildM249 } from './support';

export { buildM4, buildAK47, buildSCARH, buildSpear, buildM1911, buildDeagle, buildMP7, buildVector, buildAWM, buildSPAS12, buildM249 };
export const WEAPON_BUILDERS: Record<WeaponId, () => WeaponModel> = {
  m4a1: buildM4, ak47: buildAK47, m1911: buildM1911, awm: buildAWM, mp7: buildMP7,
  scar_h: buildSCARH, spear: buildSpear, vector: buildVector, spas12: buildSPAS12, deagle: buildDeagle, m249: buildM249,
};
