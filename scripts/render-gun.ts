/**
 * Render every weapon (or one named weapon) to PNG elevations, with no GPU.
 *
 *   node --import ./tests/helpers/register-json.js scripts/render-gun.ts [id|all] [outDir]
 *
 * The side elevation is the view that finds modelling errors: gaps where a magazine
 * meets its well, an optic floating above its rail, a stock that does not touch the
 * receiver. Perspective and specular hide all three, which is why this is orthographic
 * and flat-shaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { encodePNG, render, type ViewName } from './raster';
import { WEAPON_BUILDERS } from '../src/game/models';

const arg = process.argv[2] ?? 'all';
const outDir = process.argv[3] ?? 'docs/renders/weapons';
fs.mkdirSync(outDir, { recursive: true });

const ids = arg === 'all' ? Object.keys(WEAPON_BUILDERS) : [arg];
const VIEWS: { name: string; view: ViewName; flip?: boolean }[] = [
  { name: 'elevation', view: 'elevation' },
  { name: 'elevation-left', view: 'elevation', flip: true },
  { name: 'top', view: 'top' },
];

for (const id of ids) {
  const builder = (WEAPON_BUILDERS as Record<string, () => { group: THREE.Object3D; lArm?: THREE.Object3D }>)[id];
  if (!builder) { console.error(`unknown weapon: ${id}`); process.exitCode = 1; continue; }
  const model = builder();

  // The support arm is not part of the weapon and covers the very joints we want to
  // inspect, so it is hidden for these renders.
  model.group.traverse(o => { if (o.userData.arm) o.visible = false; });

  for (const v of VIEWS) {
    const { rgba, width, height } = render(model.group, {
      width: 1400, height: 620, view: v.view, flip: v.flip, gridStep: 0.05,
    });
    const file = path.join(outDir, `${id}-${v.name}.png`);
    fs.writeFileSync(file, encodePNG(width, height, rgba));
    console.log(`${file}`);
  }
}
