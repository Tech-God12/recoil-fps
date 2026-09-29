/**
 * Render every weapon (or one named weapon) to PNG elevations, with no GPU.
 *
 *   node --import ./tests/helpers/register-json.js scripts/render-gun.ts [id|all] [outDir]
 *   node --import ./tests/helpers/register-json.js scripts/render-gun.ts aug_a3 /tmp/out
 *
 * Output lands in docs/renders/weapons/<id>-<view>.png by default.
 *
 * WHY THIS EXISTS AND WHY IT LOOKS THE WAY IT DOES
 *
 * There is no browser and no GPU in the build sandbox, so geometry cannot be checked by
 * looking at it in the game. Without this, "the magazine has no gap where it meets the
 * well" can only be asserted, never seen. Every choice here serves gap-hunting:
 *
 *  - Orthographic, not perspective. Perspective hides the thing you are looking for: a
 *    magazine that stops 3 mm short of its well looks seated from any angle that has a
 *    vanishing point in it.
 *  - Side elevation is the useful view. Top and iso are rendered too, but nearly every
 *    modelling error worth finding shows in the elevation and nowhere else.
 *  - Clay shading by default. The finishes are near-black OD green and gunmetal; in
 *    their own colours the models render as dark blobs. A uniform neutral clay turns a
 *    2 mm step into a visible shading break. Pass `clay: false` to check the finish.
 *  - Flat shading, no specular. A highlight will happily paper over a crack.
 *  - Backfaces kept. A missing backface is itself a bug worth seeing.
 *  - A 5 cm grid behind the model, so gaps can be estimated by eye.
 *  - The support arm is hidden; it covers the joints being inspected.
 *
 * This is a verification tool, not a preview: no textures, shadows, transparency or
 * anti-aliasing. It answers where the geometry is, which is all it was built for.
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
