/**
 * Offline map renderer — architectural massing views of every map.
 *
 * There is no browser in this environment (Chromium will not install), so the only
 * way to actually LOOK at a map is to rasterise it in Node. This drives the same
 * software rasteriser the weapon renders use, via its perspective path.
 *
 * Deliberately clay-shaded. The point of these images is to judge massing, street
 * width and skyline — whether a block reads as a place or as a pile of boxes —
 * and flat grey is how architects check exactly that. Textures would only hide it
 * (and the canvas stub cannot produce them anyway).
 *
 *   node --import ./tests/helpers/register-json.js scripts/render-map.ts [id|all] [outDir]
 */
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { installCanvasStub } from '../tests/helpers/geometry.js';

installCanvasStub();

const { render, encodePNG } = await import('./raster.ts');
const { buildWorld, MAPS } = await import('../src/game/world.ts');

const MAT_KEYS = ['sand', 'plaza', 'adobeWall', 'adobeWall2', 'adobeBrick', 'concrete', 'asphalt', 'wood',
  'rustedMetal', 'sandbag', 'tileFloor', 'plaster', 'whitewash', 'stoneBlock', 'firedBrick', 'packedEarth',
  'corrugatedMetal', 'roughTimber', 'terracePavers', 'cobbleLane', 'wadiBed', 'signage', 'dirtPath'];

const materials = () => Object.fromEntries(
  MAT_KEYS.map(k => [k, new THREE.MeshStandardMaterial()]),
) as never;

/** Warm desert sky over a dusty horizon; the haze fades distant blocks into it. */
const SKY = { top: [104, 132, 168] as [number, number, number], bottom: [196, 190, 176] as [number, number, number] };

interface Shot { name: string; azimuth: number; elevation: number; distance: number; fov: number; lookHeight: number }

/** Three angles per map: a high establishing view and two lower three-quarter passes. */
const SHOTS: Shot[] = [
  { name: 'aerial', azimuth: 0.62, elevation: 0.52, distance: 1.55, fov: 56, lookHeight: 0.06 },
  { name: 'approach', azimuth: 2.35, elevation: 0.20, distance: 1.25, fov: 62, lookHeight: 0.10 },
  { name: 'street', azimuth: 3.95, elevation: 0.11, distance: 0.92, fov: 68, lookHeight: 0.08 },
];

function renderMap(id: string, outDir: string) {
  const world = buildWorld(new THREE.Scene(), id as never, materials());
  const root = world.group;
  root.updateWorldMatrix(true, true);

  // Frame on the BUILT area, not the scene bounds — every map sits on a huge terrain
  // skirt, and fitting to that renders the town as a speck in the middle of a desert.
  // Skip the invisible map-boundary walls: alrasul and kasbah close themselves in with
  // solids 10 km tall, which would otherwise dominate both the centre and the extent.
  const box = new THREE.Box3();
  for (const s of world.solids) {
    // Two shapes of out-of-bounds volume: 10 km-tall walls, and thin kill/ceiling slabs
    // parked at y=10000. Neither is architecture; both wreck the fit.
    if (s.maxY - s.minY > 40 || s.maxY > 60) continue;
    box.expandByPoint(new THREE.Vector3(s.minX, s.minY, s.minZ));
    box.expandByPoint(new THREE.Vector3(s.maxX, s.maxY, s.maxZ));
  }
  if (box.isEmpty()) box.setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.5;

  for (const s of SHOTS) {
    const d = radius * s.distance;
    const eye: [number, number, number] = [
      center.x + Math.cos(s.azimuth) * Math.cos(s.elevation) * d,
      box.min.y + Math.sin(s.elevation) * d + 2,
      center.z + Math.sin(s.azimuth) * Math.cos(s.elevation) * d,
    ];
    const target: [number, number, number] = [center.x, box.min.y + Math.min(size.y, 14) * s.lookHeight * 2.2, center.z];
    const { rgba, width, height } = render(root, {
      width: 1600, height: 900, clay: true,
      camera: { eye, target, fov: s.fov },
      sky: SKY,
      sun: { dir: [-0.45, 0.80, 0.40], strength: 0.86, ambient: 0.30 },
      haze: { start: radius * 1.1, end: radius * 5.0 },
    });
    if (process.env.RM_DEBUG) console.log(`  ${s.name} eye=${eye.map(v=>v.toFixed(1))} tgt=${target.map(v=>v.toFixed(1))} r=${radius.toFixed(1)}`);
    const file = join(outDir, `${id}-${s.name}.png`);
    writeFileSync(file, encodePNG(width, height, rgba));
    console.log(file);
  }

  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}

const which = process.argv[2] ?? 'all';
const outDir = process.argv[3] ?? 'docs/renders/maps';
mkdirSync(outDir, { recursive: true });
const ids = which === 'all' ? MAPS.map(m => m.id) : [which];
for (const id of ids) renderMap(id, outDir);
