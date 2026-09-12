// Recoil FPS — World builder v3: merged geometry (1 draw call / material), BVH raycasts,
// two maps, destructible instanced glass, coherent street grids with no on-road clutter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getMaterials, type TextureSet } from './textures';

// Install BVH acceleration globally (huge raycast speed-up for merged meshes)
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type MapId = 'alrasul' | 'kasbah';
export const MAPS: { id: MapId; name: string; desc: string; enemies: number }[] = [
  { id: 'alrasul', name: 'AL-RASUL CROSSING', desc: 'Grid-plan desert township. Central plaza, mosque, market, depot and residential compounds.', enemies: 21 },
  { id: 'kasbah', name: 'KASBAH RIDGE', desc: 'Radial hill-fortress. A central citadel with ring roads, spoke streets and tight wedge alleys.', enemies: 15 },
];

export interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface SquadSpawn { leader: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; patrol: THREE.Vector3[] }

export interface WindowHole { x: number; y: number; z: number; nx: number; nz: number } // center + outward normal (horizontal)

export interface World {
  group: THREE.Group;
  solids: AABB[];
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  squadSpawns: SquadSpawn[];
  playerSpawn: THREE.Vector3;
  interiors: AABB[];
  concrete: AABB[];
  wood: AABB[];
  half: number;
  lightSpots: THREE.Vector3[];
  windows: WindowHole[];
  glass: THREE.InstancedMesh | null;
  breakGlass(instanceId: number): THREE.Vector3 | null;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);

export function buildWorld(scene: THREE.Scene, mapId: MapId = 'alrasul', materials?: TextureSet): World {
  const group = new THREE.Group();
  const solids: AABB[] = [];
  const occluders: THREE.Object3D[] = [];
  const coverNodes: THREE.Vector3[] = [];
  const interiors: AABB[] = [];
  const concrete: AABB[] = [];
  const wood: AABB[] = [];
  const lightSpots: THREE.Vector3[] = [];
  const M: TextureSet = materials ?? getMaterials();
  const geoByMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const glassMats: THREE.Matrix4[] = [];
  const glassCenters: THREE.Vector3[] = [];
  const windows: WindowHole[] = [];

  // ---- material cache for colored accents (shared instances so they merge) ----
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const col = (hex: number, rough = 0.85, metal = 0, emissive = 0, side: THREE.Side = THREE.FrontSide) => {
    const k = `${hex}-${rough}-${metal}-${emissive}-${side}`;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, side });
      if (emissive) { m.emissive = new THREE.Color(hex); m.emissiveIntensity = emissive; }
      matCache.set(k, m);
    }
    return m;
  };
  const ACC_TURQ = col(0x2C7C8E, 0.7), ACC_TERRA = col(0x9A4A2E), METAL = col(0x2C2C2A, 0.5, 0.7);
  const GLOW = col(0xFFE2A8, 0.4, 0, 2.4), WATER = col(0x2E6E86, 0.15, 0.3), FROND = col(0x4E6B34, 0.85, 0, 0, THREE.DoubleSide);
  const FABRIC = [0xB0402E, 0x2E6BA0, 0x3E7B52, 0xC7A24B, 0x8C4E86].map(c => col(c, 0.9, 0, 0, THREE.DoubleSide));

  // ---- geometry collection ----
  function push(geo: THREE.BufferGeometry, m: THREE.Material) {
    let arr = geoByMat.get(m);
    if (!arr) { arr = []; geoByMat.set(m, arr); }
    arr.push(geo);
  }
  function box(cx: number, cy: number, cz: number, w: number, h: number, d: number, m: THREE.Material, collide = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, cy, cz);
    push(g, m);
    if (collide) solids.push({ minX: cx - w / 2, minY: cy - h / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxY: cy + h / 2, maxZ: cz + d / 2 });
  }
  function shape(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(new THREE.Euler(rx, ry, rz));
    _m4.compose(new THREE.Vector3(x, y, z), _q, _s);
    geo.applyMatrix4(_m4);
    push(geo, m);
  }
  function ground(x: number, z: number, w: number, d: number, m: THREE.Material, y = 0.02, ry = 0) {
    shape(new THREE.PlaneGeometry(w, d), m, x, y, z, -Math.PI / 2, 0, ry);
  }
  function cover(x: number, z: number, y = 0) { coverNodes.push(new THREE.Vector3(x, y, z)); }

  // wall run with openings; windows (b>0) get a glass pane
  function wallRun(alongX: boolean, x0: number, z0: number, len: number, height: number, thick: number,
    holes: [number, number, number, number][], m: THREE.Material, yb = 0, addGlass = true) {
    const cuts = holes.map(h => [h[0], h[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
    let cur = 0;
    const put = (s: number, e: number, b: number, t: number) => {
      if (e - s < 0.05 || t - b < 0.05) return;
      const mid = (s + e) / 2, w = e - s, ch = t - b, cy = yb + b + ch / 2;
      if (alongX) box(x0 + mid, cy, z0, w, ch, thick, m); else box(x0, cy, z0 + mid, thick, ch, w, m);
    };
    for (const [s, e] of cuts) { put(cur, s, 0, height); cur = e; }
    put(cur, len, 0, height);
    for (const [s, e, b, t] of holes) {
      put(s, e, t, height);
      if (b > 0) {
        put(s, e, 0, b);
        // sill + glass
        const mid = (s + e) / 2;
        if (alongX) box(x0 + mid, yb + b - 0.04, z0, e - s + 0.3, 0.1, thick + 0.16, M.concrete, false);
        else box(x0, yb + b - 0.04, z0 + mid, thick + 0.16, 0.1, e - s + 0.3, M.concrete, false);
        if (addGlass) {
          const gw = e - s - 0.12, gh = t - b - 0.12;
          const cx = alongX ? x0 + mid : x0, cz = alongX ? z0 : z0 + mid, cy = yb + b + (t - b) / 2;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, alongX ? 0 : Math.PI / 2, 0));
          glassMats.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(gw, gh, 1)));
          glassCenters.push(new THREE.Vector3(cx, cy, cz));
          windows.push({ x: cx, y: cy, z: cz, nx: alongX ? 0 : (cx > x0 ? 1 : -1), nz: alongX ? (cz > z0 ? 1 : (z0 === cz ? 1 : -1)) : 0 });
        }
      }
    }
  }

  // ---- building generator ----
  interface HouseOpts { floors?: number; wallMat?: THREE.Material; roofAccess?: boolean; door?: 'south' | 'north' | 'east' | 'west'; light?: boolean }
  const wallMats = () => [M.adobeWall, M.adobeWall2, M.plaster, M.whitewash];
  function house(cx: number, cz: number, w: number, d: number, o: HouseOpts = {}) {
    const floors = o.floors ?? 1, fh = 3.2, H = floors * fh;
    const wm = o.wallMat ?? M.adobeWall;
    const x0 = cx - w / 2, z0 = cz - d / 2;
    const door = o.door ?? 'south';
    const winRow = (len: number): [number, number, number, number][] => {
      const n = Math.max(1, Math.floor(len / 4)), gap = len / n, out: [number, number, number, number][] = [];
      for (let i = 0; i < n; i++) { const c = gap * (i + 0.5); out.push([c - 0.7, c + 0.7, 1.15, 2.3]); }
      return out;
    };
    const doorHole = (len: number): [number, number, number, number] => [len / 2 - 1.2, len / 2 + 1.2, 0, 2.5];
    const noDoorOverlap = (row: [number, number, number, number][], len: number) => row.filter(h => Math.abs((h[0] + h[1]) / 2 - len / 2) > 2.2);
    for (let f = 0; f < floors; f++) {
      const yb = f * fh, g0 = f === 0;
      const n = g0 && door === 'north' ? [...noDoorOverlap(winRow(w), w), doorHole(w)] : winRow(w);
      const s = g0 && door === 'south' ? [...noDoorOverlap(winRow(w), w), doorHole(w)] : winRow(w);
      const ww = g0 && door === 'west' ? [...noDoorOverlap(winRow(d), d), doorHole(d)] : winRow(d);
      const e = g0 && door === 'east' ? [...noDoorOverlap(winRow(d), d), doorHole(d)] : winRow(d);
      wallRun(true, x0, z0, w, fh, 0.5, n, wm, yb);
      wallRun(true, x0, z0 + d, w, fh, 0.5, s, wm, yb);
      wallRun(false, x0, z0, d, fh, 0.5, ww, wm, yb);
      wallRun(false, x0 + w, z0, d, fh, 0.5, e, wm, yb);
      if (f > 0) {
        box(cx, yb + 0.12, cz, w - 0.6, 0.24, d - 0.6, M.concrete);
        wood.push({ minX: x0, minY: yb - 0.2, minZ: z0, maxX: x0 + w, maxY: yb + 3, maxZ: z0 + d });
        // interior stair to upper floor (along west wall)
        // Exterior-style stair: large overlapping treads (0.22 rise, 0.55 run) so the player never wedges between steps
        for (let i = 0; i < 14; i++) box(x0 + 1.5, (f - 1) * fh + 0.11 + i * 0.22, z0 + 0.8 + i * 0.55, 2.2, 0.22, 0.7, M.concrete);
      }
    }
    ground(cx, cz, w - 0.8, d - 0.8, M.tileFloor, 0.04);
    // ---- interior dressing: makes every room feel lived-in (deterministic, merged) ----
    {
      const alongZ = door === 'south' || door === 'north';
      const margin = 0.7;
      const bedX = alongZ ? cx - w * 0.2 : (door === 'east' ? x0 + margin : x0 + w - margin);
      const bedZ = alongZ ? (door === 'south' ? z0 + margin : z0 + d - margin) : cz - d * 0.18;
      const bw = alongZ ? 1.0 : 1.6, bd = alongZ ? 1.6 : 1.0;
      box(bedX, 0.26, bedZ, bw, 0.52, bd, M.wood);                                   // bed/bunk
      box(bedX, 0.34, bedZ + (alongZ ? 0.5 : 0), bw * 0.9, 0.16, bd * 0.55, M.sandbag); // headrest
      box(cx + (alongZ ? w * 0.2 : 0), 0.42, cz + (alongZ ? 0 : d * 0.16), alongZ ? 1.2 : 1.0, 0.84, alongZ ? 1.0 : 1.2, M.wood); // table
      box(alongZ ? x0 + w - margin - 0.2 : cx, 0.75, alongZ ? cz : z0 + d - margin - 0.2, alongZ ? 0.4 : 1.4, 1.5, alongZ ? 1.4 : 0.4, M.wood); // shelf
      shape(new THREE.PlaneGeometry(1.8, 1.1), col(0x7A6248, 0.95, 0, 0, THREE.DoubleSide), cx, 0.05, cz, -Math.PI / 2); // woven rug
    }
    // cornice + parapet + door lintel
    box(cx, H + 0.15, cz, w + 0.5, 0.3, d + 0.5, M.concrete);
    box(cx, H + 0.65, z0, w + 0.5, 0.7, 0.35, M.adobeWall2);
    box(cx, H + 0.65, z0 + d, w + 0.5, 0.7, 0.35, M.adobeWall2);
    box(x0, H + 0.65, cz, 0.35, 0.7, d + 0.5, M.adobeWall2);
    box(x0 + w, H + 0.65, cz, 0.35, 0.7, d + 0.5, M.adobeWall2);
    const lint = (x: number, z: number, lw: number, ld: number) => box(x, 2.68, z, lw, 0.22, ld, M.wood, false);
    if (door === 'south') lint(cx, z0 + d, 2.8, 0.7); if (door === 'north') lint(cx, z0, 2.8, 0.7);
    if (door === 'east') lint(x0 + w, cz, 0.7, 2.8); if (door === 'west') lint(x0, cz, 0.7, 2.8);
    box(cx, fh - 0.3, z0 - 0.01, w + 0.5, 0.18, 0.06, ACC_TURQ, false);
    box(cx, fh - 0.3, z0 + d + 0.01, w + 0.5, 0.18, 0.06, ACC_TERRA, false);
    if (o.roofAccess) {
      const steps = Math.ceil(H / 0.35), run = (d - 2.4) / steps;
      for (let i = 0; i < steps; i++) box(x0 - 1.4, 0.18 + i * 0.35, z0 + 1.2 + i * run, 2.4, 0.35, run + 0.3, M.concrete);
      cover(x0 - 1.4, cz);
      box(x0 - 2.7, H / 2, cz, 0.3, H, d - 1.6, M.adobeWall2); // stair guard wall
    }
    interiors.push({ minX: x0, minY: 0, minZ: z0, maxX: x0 + w, maxY: H + 2, maxZ: z0 + d });
    if (o.light !== false) lightSpots.push(new THREE.Vector3(cx, 2.4, cz));
    shape(new THREE.PlaneGeometry(w + 1.4, d + 1.4), col(0x000000, 1, 0, 0), cx, 0.015, cz, -Math.PI / 2); // contact shadow (dark tint)
    cover(x0 - 1, cz); cover(x0 + w + 1, cz); cover(cx, z0 - 1); cover(cx, z0 + d + 1);
    return { x0, z0, H };
  }

  // walled compound: low perimeter wall with gates, 1-2 houses, yard props
  function compound(cx: number, cz: number, size: number, seed: number, mats: THREE.Material[]) {
    const hw = size / 2;
    const wm = M.adobeBrick;
    // 4 wall runs with a gate gap on two sides
    wallRun(true, cx - hw, cz - hw, size, 2.2, 0.45, seed % 2 ? [[hw - 1.6, hw + 1.6, 0, 2.2]] : [], wm, 0, false);
    wallRun(true, cx - hw, cz + hw, size, 2.2, 0.45, seed % 2 ? [] : [[hw - 1.6, hw + 1.6, 0, 2.2]], wm, 0, false);
    wallRun(false, cx - hw, cz - hw, size, 2.2, 0.45, seed % 3 === 0 ? [[hw - 1.6, hw + 1.6, 0, 2.2]] : [], wm, 0, false);
    wallRun(false, cx + hw, cz - hw, size, 2.2, 0.45, seed % 3 === 0 ? [] : [[hw - 1.6, hw + 1.6, 0, 2.2]], wm, 0, false);
    ground(cx, cz, size - 1, size - 1, M.plaza, 0.025);
    const off = size * 0.22;
    if (seed % 2) {
      house(cx - off, cz - off * 0.4, 9, 8, { floors: 1 + (seed % 3 === 0 ? 1 : 0), wallMat: mats[seed % mats.length], door: 'east' });
      house(cx + off, cz + off * 0.6, 8, 8, { floors: 1, wallMat: mats[(seed + 1) % mats.length], door: 'west' });
    } else {
      house(cx, cz - off * 0.3, 11, 9, { floors: 2, wallMat: mats[seed % mats.length], door: 'south', roofAccess: seed % 4 === 0 });
      // water tank tower
      box(cx + off * 1.4, 2.0, cz + off * 1.3, 0.3, 4, 0.3, METAL); box(cx + off * 1.4 - 1.2, 2.0, cz + off * 1.3, 0.3, 4, 0.3, METAL);
      box(cx + off * 1.4 - 0.6, 4.6, cz + off * 1.3, 2.2, 1.4, 1.6, M.rustedMetal);
    }
    crate(cx + off * 0.9, cz - off * 1.2); barrel(cx - off * 1.3, cz + off * 1.1); barrel(cx - off * 1.3 + 0.9, cz + off * 1.1);
    palm(cx + off * 1.2, cz - off * 0.2, 0.9);
  }

  // ---- props ----
  const crate = (x: number, z: number, s = 1.1) => { box(x, s / 2, z, s, s, s, M.wood); cover(x + s, z); };
  const barrel = (x: number, z: number) => { shape(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), M.rustedMetal, x, 0.53, z); solids.push({ minX: x - .42, minY: 0, minZ: z - .42, maxX: x + .42, maxY: 1.05, maxZ: z + .42 }); };
  function lamp(x: number, z: number) {
    shape(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), METAL, x, 1.8, z);
    solids.push({ minX: x - .1, minY: 0, minZ: z - .1, maxX: x + .1, maxY: 3.6, maxZ: z + .1 });
    box(x + 0.45, 3.5, z, 0.9, 0.05, 0.05, METAL, false);
    shape(new THREE.SphereGeometry(0.14, 10, 8), GLOW, x + 0.88, 3.45, z);
  }
  function palm(x: number, z: number, s = 1) {
    shape(new THREE.CylinderGeometry(0.18 * s, 0.3 * s, 6 * s, 8), M.wood, x, 3 * s, z, 0, 0, 0.05);
    solids.push({ minX: x - .35, minY: 0, minZ: z - .35, maxX: x + .35, maxY: 5.5 * s, maxZ: z + .35 });
    for (let f = 0; f < 7; f++) shape(new THREE.PlaneGeometry(3 * s, 0.6 * s), FROND, x, 6 * s, z, 0, (f / 7) * Math.PI * 2, -0.55);
    shape(new THREE.SphereGeometry(0.35 * s, 8, 6), col(0x5A3A1A), x, 5.9 * s, z);
  }
  function fountain(fx: number, fz: number) {
    shape(new THREE.CylinderGeometry(3.4, 3.7, 0.9, 24), M.concrete, fx, 0.45, fz);
    solids.push({ minX: fx - 3.7, minY: 0, minZ: fz - 3.7, maxX: fx + 3.7, maxY: 0.9, maxZ: fz + 3.7 });
    shape(new THREE.CylinderGeometry(3.1, 3.1, 0.1, 24), WATER, fx, 0.86, fz);
    shape(new THREE.CylinderGeometry(1.7, 1.9, 1.1, 20), M.concrete, fx, 1.2, fz);
    shape(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 20), WATER, fx, 1.72, fz);
    shape(new THREE.CylinderGeometry(0.9, 1.0, 1.0, 16), M.concrete, fx, 2.1, fz);
    shape(new THREE.SphereGeometry(0.35, 12, 10), ACC_TURQ, fx, 2.75, fz);
    for (const [ox, oz] of [[-3.9, 0], [3.9, 0], [0, -3.9], [0, 3.9]] as const) cover(fx + ox, fz + oz);
  }
  function marketRows(baseX: number, baseZ: number, rows = 2, perRow = 4, spacing = 6) {
    ground(baseX, baseZ + (rows - 1) * 3, perRow * spacing + 4, rows * 6 + 6, M.plaza, 0.025);
    for (let r = 0; r < rows; r++) for (let s = 0; s < perRow; s++) {
      const sx = baseX - ((perRow - 1) * spacing) / 2 + s * spacing, rz = baseZ + r * 6;
      box(sx, 0.55, rz, 2.6, 1.1, 1.4, M.wood);
      for (const [ox, oz] of [[-1.4, -.9], [1.4, -.9], [-1.4, .9], [1.4, .9]] as const) shape(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), METAL, sx + ox, 1.3, rz + oz);
      shape(new THREE.PlaneGeometry(3.2, 2.4), FABRIC[(r * perRow + s) % FABRIC.length], sx, 2.55, rz, -Math.PI / 2 + 0.12);
      for (let g = 0; g < 3; g++) shape(new THREE.SphereGeometry(0.16, 6, 5), col(0xC7A24B + g * 0x102030), sx - 0.6 + g * 0.6, 1.2, rz);
      cover(sx, rz + 2.2);
    }
    lightSpots.push(new THREE.Vector3(baseX, 2.4, baseZ + 3));
  }
  function mosque(mx: number, mz: number) {
    const w = 14, d = 13, h = 4.8;
    wallRun(true, mx - w / 2, mz - d / 2, w, h, 0.6, [[4, 7, 0, 3.0], [10, 12, 1.2, 2.8]], M.whitewash, 0, true);
    wallRun(true, mx - w / 2, mz + d / 2, w, h, 0.6, [[5.5, 8.5, 0, 3.2]], M.whitewash);
    wallRun(false, mx - w / 2, mz - d / 2, d, h, 0.6, [[4.5, 7.5, 1.2, 2.8]], M.whitewash);
    wallRun(false, mx + w / 2, mz - d / 2, d, h, 0.6, [[4.5, 7.5, 1.2, 2.8]], M.whitewash);
    ground(mx, mz, w - 1, d - 1, M.tileFloor, 0.04);
    box(mx, h + 0.2, mz, w + 0.6, 0.35, d + 0.6, M.concrete);
    shape(new THREE.SphereGeometry(4.8, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), ACC_TURQ, mx, h + 0.1, mz);
    shape(new THREE.ConeGeometry(0.5, 1.2, 12), GLOW, mx, h + 5.1, mz);
    for (const [tx, tz] of [[mx - w / 2 - 1.6, mz - d / 2 - 1.6], [mx + w / 2 + 1.6, mz + d / 2 + 1.6]] as const) {
      box(tx, 4.4, tz, 1.1, 8.8, 1.1, M.whitewash);
      shape(new THREE.ConeGeometry(0.8, 1.4, 10), ACC_TURQ, tx, 9.5, tz);
      shape(new THREE.SphereGeometry(0.18, 8, 6), GLOW, tx, 9.1, tz);
    }
    box(mx + 3.5, 0.5, mz - 2.5, 1.8, 1.0, 1.0, M.wood); box(mx - 3.5, 0.5, mz + 2.5, 1.8, 1.0, 1.0, M.sandbag);
    interiors.push({ minX: mx - w / 2, minY: 0, minZ: mz - d / 2, maxX: mx + w / 2, maxY: h + 4, maxZ: mz + d / 2 });
    lightSpots.push(new THREE.Vector3(mx, 3, mz));
    cover(mx + 3.5, mz - 1); cover(mx - 3.5, mz + 1); cover(mx - w / 2 - 1.2, mz); cover(mx + w / 2 + 1.2, mz);
  }
  function depot(yx: number, yz: number) {
    ground(yx, yz, 30, 22, M.concrete, 0.025);
    const truck = (tx: number, tz: number) => {
      box(tx, 1.2, tz, 5.6, 1.6, 2.4, M.rustedMetal); box(tx - 2.8, 2.1, tz, 2, 1.6, 2.3, M.rustedMetal);
      for (const [wx, wz] of [[-2, 1.2], [-2, -1.2], [1.8, 1.2], [1.8, -1.2]] as const) shape(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10), METAL, tx + wx, 0.5, tz + wz, Math.PI / 2);
      cover(tx, tz + 3); cover(tx, tz - 3);
    };
    truck(yx - 8, yz - 5); truck(yx + 6, yz - 6); truck(yx, yz + 5);
    const cont = (cx: number, cz: number, c: number, y = 1.3) => { box(cx, y, cz, 6, 2.6, 2.5, col(c, 0.8, 0.3)); cover(cx, cz + 2.5); };
    cont(yx + 10, yz + 4, 0x8C4A2E); cont(yx + 10, yz + 4.01, 0x2E5E6E, 3.9); cont(yx - 10, yz + 6, 0x3E6B4A);
    crate(yx - 4, yz + 8); crate(yx - 3, yz + 9); barrel(yx - 6, yz + 8); barrel(yx + 4, yz - 1);
    // guard tower
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as const) box(yx + 13 + lx, 2.6, yz - 8 + lz, 0.35, 5.2, 0.35, M.wood);
    box(yx + 13, 5.3, yz - 8, 3.8, 0.3, 3.8, M.wood); wood.push({ minX: yx + 11, minY: 5.2, minZ: yz - 10, maxX: yx + 15, maxY: 6, maxZ: yz - 6 });
    box(yx + 13, 5.9, yz - 9.7, 3.8, 0.9, 0.3, M.sandbag); box(yx + 13, 5.9, yz - 6.3, 3.8, 0.9, 0.3, M.sandbag);
    box(yx + 11.1, 5.9, yz - 8, 0.3, 0.9, 3.8, M.sandbag);
    for (let i = 0; i < 12; i++) box(yx + 15.6, 0.22 + i * 0.44, yz - 8 + 1.9 - i * 0.32 - 0.3, 1.4, 0.44, 0.7, M.concrete);
    cover(yx + 13, yz - 8, 5.4);
  }

  // ---- streets ----
  function street(alongX: boolean, pos: number, from: number, to: number, w = 12) {
    const len = to - from, mid = (from + to) / 2;
    if (alongX) {
      ground(mid, pos, len, w, M.asphalt, 0.02, 0);
      concrete.push({ minX: from, minY: -1, minZ: pos - w / 2, maxX: to, maxY: 3, maxZ: pos + w / 2 });
    } else {
      ground(pos, mid, w, len, M.asphalt, 0.02, Math.PI / 2);
      concrete.push({ minX: pos - w / 2, minY: -1, minZ: from, maxX: pos + w / 2, maxY: 3, maxZ: to });
    }
    // lamps on the verge, every 32m — never on the carriageway
    for (let s = from + 16; s < to - 8; s += 32) {
      if (alongX) { lamp(s, pos - w / 2 - 1.6); lamp(s + 16, pos + w / 2 + 1.6); }
      else { lamp(pos - w / 2 - 1.6, s); lamp(pos + w / 2 + 1.6, s + 16); }
    }
  }
  function terrain(size: number, inner: number) {
    const g = new THREE.PlaneGeometry(size, size, 48, 48);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y);
      const e = Math.max(0, (r - inner) / 60);
      p.setZ(i, e * (Math.sin(x * 0.04) * 3 + Math.cos(y * 0.045) * 3.4 + e * 7));
    }
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);
    push(g, M.sand);
  }
  function perimeter(half: number) {
    const pm = M.adobeBrick;
    box(-half / 2 - 4, 2.6, -half, half - 8, 5.2, 1.8, pm); box(half / 2 + 4, 2.6, -half, half - 8, 5.2, 1.8, pm);
    box(-half / 2 - 4, 2.6, half, half - 8, 5.2, 1.8, pm); box(half / 2 + 4, 2.6, half, half - 8, 5.2, 1.8, pm);
    box(-half, 2.6, 0, 1.8, 5.2, 2 * half, pm); box(half, 2.6, 0, 1.8, 5.2, 2 * half, pm);
    for (const [tx, tz] of [[-8, -half], [8, -half], [-8, half], [8, half]] as const) { box(tx, 3.8, tz, 3.2, 7.6, 3.2, pm); box(tx, 7.8, tz, 3.8, 0.7, 3.8, M.adobeWall2); }
    for (const [tx, tz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) box(tx, 4.2, tz, 4, 8.4, 4, pm);
  }

  let squadSpawns: SquadSpawn[] = [];
  const playerSpawn = new THREE.Vector3();
  let half = 104;

  // =====================================================================
  // MAP 1 — AL-RASUL CROSSING (grid, 1.5x)
  // =====================================================================
  if (mapId === 'alrasul') {
    half = 104;
    terrain(520, half + 10);
    perimeter(half);
    // street grid
    street(true, 0, -half, half); street(false, 0, -half, half);
    street(true, -44, -half, half, 9); street(true, 44, -half, half, 9);
    street(false, -44, -half, half, 9); street(false, 44, -half, half, 9);
    street(true, -84, -half, half, 8); street(true, 84, -half, half, 8);
    street(false, -84, -half, half, 8); street(false, 84, -half, half, 8);
    // plaza
    ground(0, 0, 32, 32, M.plaza, 0.035); fountain(0, 0);
    for (const [px, pz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]] as const) { box(px, 0.4, pz, 1.6, 0.8, 1.6, M.adobeBrick); shape(new THREE.SphereGeometry(0.9, 8, 6), col(0x4E6B34), px, 1.4, pz); cover(px, pz); }
    for (const [px, pz] of [[-19, -19], [19, -19], [-19, 19], [19, 19]] as const) palm(px, pz);
    // inner blocks (between ±6 and ±44 minus street margins): landmarks
    mosque(-25, -25);
    house(25, 25, 14, 12, { floors: 2, wallMat: M.adobeBrick, door: 'west', roofAccess: true }); // Garrison
    house(30, 12, 8, 8, { wallMat: M.plaster, door: 'north' });
    marketRows(-25, 17, 2, 4);
    house(-32, 34, 9, 8, { wallMat: M.whitewash, door: 'north' });
    depot(23, -26);
    // mid ring blocks (44..84): residential compounds
    const mats = wallMats();
    let seed = 1;
    for (const bx of [-64, 25, 64]) for (const bz of [-64, 25, 64]) {
      if (Math.abs(bx) === 25 && Math.abs(bz) === 25) continue;
        if (bx === 25 && bz === -64) { compound(bx, bz, 22, seed++, mats); continue; }
      compound(bx, bz, 22, seed++, mats);
    }
    for (const bx of [-64, 64]) for (const bz of [-25, 25]) { if (bz === -25) house(bx, bz - 4, 12, 10, { floors: 2, wallMat: mats[seed++ % 4], door: bx < 0 ? 'east' : 'west' }); else compound(bx, bz + 2, 22, seed++, mats); }
    for (const bz of [-64, 64]) house(-25 + (bz < 0 ? 0 : 5), bz, 12, 10, { floors: bz < 0 ? 1 : 2, wallMat: mats[seed++ % 4], door: bz < 0 ? 'south' : 'north' });
    house(-12, -66, 8, 8, { wallMat: M.plaster, door: 'west' });
    // outer edge strip (84..104): warehouses + rubble lots
    for (const bx of [-94, -60, -25, 25, 60, 94]) { house(bx, -94, 12, 9, { wallMat: mats[seed++ % 4], door: 'south' }); house(bx, 94, 12, 9, { wallMat: mats[seed++ % 4], door: 'north' }); }
    for (const bz of [-60, -25, 25, 60]) { house(-94, bz, 9, 12, { wallMat: mats[seed++ % 4], door: 'east' }); house(94, bz, 9, 12, { wallMat: mats[seed++ % 4], door: 'west' }); }
    playerSpawn.set(0, 0, 96);
    squadSpawns = [
      { leader: new THREE.Vector3(6, 0, 8), a: new THREE.Vector3(-8, 0, 6), b: new THREE.Vector3(8, 0, -6), patrol: [new THREE.Vector3(0, 0, 14), new THREE.Vector3(16, 0, 0), new THREE.Vector3(0, 0, -14), new THREE.Vector3(-16, 0, 0)] },
      { leader: new THREE.Vector3(25, 0, 20), a: new THREE.Vector3(18, 0, 26), b: new THREE.Vector3(32, 0, 20), patrol: [new THREE.Vector3(25, 0, 22), new THREE.Vector3(44, 0, 22), new THREE.Vector3(44, 0, 64), new THREE.Vector3(20, 0, 44)] },
      { leader: new THREE.Vector3(-25, 0, 18), a: new THREE.Vector3(-32, 0, 16), b: new THREE.Vector3(-18, 0, 22), patrol: [new THREE.Vector3(-25, 0, 18), new THREE.Vector3(-44, 0, 44), new THREE.Vector3(-64, 0, 64), new THREE.Vector3(-20, 0, 44)] },
      { leader: new THREE.Vector3(-25, 0, -18), a: new THREE.Vector3(-30, 0, -22), b: new THREE.Vector3(-18, 0, -20), patrol: [new THREE.Vector3(-25, 0, -18), new THREE.Vector3(-44, 0, -44), new THREE.Vector3(-64, 0, -64), new THREE.Vector3(0, 0, -44)] },
      { leader: new THREE.Vector3(25, 0, -26), a: new THREE.Vector3(30, 0, -22), b: new THREE.Vector3(20, 0, -30), patrol: [new THREE.Vector3(25, 0, -26), new THREE.Vector3(44, 0, -44), new THREE.Vector3(64, 0, -64), new THREE.Vector3(64, 0, -25)] },
    ];
  }

  // =====================================================================
  // MAP 2 — KASBAH RIDGE (radial citadel)
  // =====================================================================
  if (mapId === 'kasbah') {
    half = 112;
    terrain(520, half + 12);
    perimeter(half);
    // ring roads: inner r30-42, outer r70-78, far ring r92-100 (bigger, more spacious)
    shape(new THREE.RingGeometry(30, 42, 48), M.asphalt, 0, 0.02, 0, -Math.PI / 2);
    shape(new THREE.RingGeometry(70, 78, 64), M.asphalt, 0, 0.02, 0, -Math.PI / 2);
    shape(new THREE.RingGeometry(92, 100, 72), M.asphalt, 0, 0.02, 0, -Math.PI / 2);
    for (const r of [36, 74, 96]) concrete.push({ minX: -r - 5, minY: -1, minZ: -r - 5, maxX: r + 5, maxY: 3, maxZ: -r + 5 }, { minX: -r - 5, minY: -1, minZ: r - 5, maxX: r + 5, maxY: 3, maxZ: r + 5 }, { minX: -r - 5, minY: -1, minZ: -r, maxX: -r + 5, maxY: 3, maxZ: r }, { minX: r - 5, minY: -1, minZ: -r, maxX: r + 5, maxY: 3, maxZ: r });
    // spokes (6) — span r34..106, stopping at the walls
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      shape(new THREE.PlaneGeometry(9, 72), M.asphalt, Math.cos(a) * 70, 0.021, Math.sin(a) * 70, -Math.PI / 2, 0, -a + Math.PI / 2);
      // lamps only inside the band between ring roads (never on a ring)
      for (const r of [48, 60, 84]) lamp(Math.cos(a) * r + Math.sin(a) * 5.6, Math.sin(a) * r - Math.cos(a) * 5.6);
    }
    // citadel (all inside r28)
    ground(0, 0, 56, 56, M.plaza, 0.035);
    house(0, 0, 24, 20, { floors: 2, wallMat: M.adobeBrick, door: 'south', roofAccess: true });
    for (const [tx, tz] of [[-14, -11], [14, -11], [-14, 11], [14, 11]] as const) { box(tx, 4.5, tz, 3.2, 9, 3.2, M.adobeBrick); box(tx, 9.3, tz, 3.8, 0.6, 3.8, M.adobeWall2); cover(tx + 2.2, tz); }
    fountain(0, 19); fountain(0, -19);
    for (const [px, pz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]] as const) palm(px, pz);
    // wedge districts — usable band is r46..66, centred on r55
    const mats = wallMats();
    let seed = 3;
    const depotSmall = (yx: number, yz: number) => {
      ground(yx, yz, 22, 16, M.concrete, 0.025);
      const truck = (tx: number, tz: number) => {
        box(tx, 1.2, tz, 5.6, 1.6, 2.4, M.rustedMetal); box(tx - 2.8, 2.1, tz, 2, 1.6, 2.3, M.rustedMetal);
        cover(tx, tz + 2.6); cover(tx, tz - 2.6);
      };
      truck(yx - 3, yz - 4); truck(yx + 4, yz + 4);
      box(yx - 8, 1.3, yz + 4.5, 6, 2.6, 2.5, col(0x8C4A2E, 0.8, 0.3)); cover(yx - 8, yz - 6.5);
      crate(yx + 8, yz - 4); barrel(yx + 9, yz - 2.5);
    };
    for (let i = 0; i < 6; i++) {
      const a = ((i + 0.5) / 6) * Math.PI * 2;
      const cx = Math.cos(a) * 55, cz = Math.sin(a) * 55;
      if (i === 0) mosque(cx, cz);
      else if (i === 2) marketRows(cx, cz - 3, 2, 3);
      else if (i === 4) depotSmall(cx, cz);
      else { house(cx - 4.5, cz - 3.5, 9, 9, { floors: 2, wallMat: mats[seed++ % 4], door: 'east' }); house(cx + 4.5, cz + 3.5, 9, 9, { wallMat: mats[seed++ % 4], door: 'west' }); crate(cx, cz + 9); }
      // compounds sit in the far band (r80..100), clear of both outer rings
      const ox = Math.cos(a) * 90, oz = Math.sin(a) * 90;
      compound(ox, oz, 22, seed++, mats);
      const a2 = (i / 6) * Math.PI * 2 + 0.16;
      house(Math.cos(a2) * 92, Math.sin(a2) * 92, 9, 9, { wallMat: mats[seed++ % 4], door: 'south' });
    }
    playerSpawn.set(0, 0, 100);
    squadSpawns = [
      { leader: new THREE.Vector3(4, 0, 24), a: new THREE.Vector3(-6, 0, 28), b: new THREE.Vector3(8, 0, 32), patrol: [new THREE.Vector3(0, 0, 26), new THREE.Vector3(24, 0, 0), new THREE.Vector3(0, 0, -26), new THREE.Vector3(-24, 0, 0)] },
      { leader: new THREE.Vector3(52, 0, 10), a: new THREE.Vector3(56, 0, 16), b: new THREE.Vector3(48, 0, 4), patrol: [new THREE.Vector3(54, 0, 10), new THREE.Vector3(34, 0, 34), new THREE.Vector3(0, 0, 46), new THREE.Vector3(-34, 0, 34)] },
      { leader: new THREE.Vector3(-52, 0, 12), a: new THREE.Vector3(-48, 0, 6), b: new THREE.Vector3(-56, 0, 18), patrol: [new THREE.Vector3(-54, 0, 10), new THREE.Vector3(-34, 0, -34), new THREE.Vector3(0, 0, -46), new THREE.Vector3(34, 0, -34)] },
      { leader: new THREE.Vector3(0, 0, -54), a: new THREE.Vector3(7, 0, -50), b: new THREE.Vector3(-7, 0, -58), patrol: [new THREE.Vector3(0, 0, -54), new THREE.Vector3(70, 0, 0), new THREE.Vector3(0, 0, 70), new THREE.Vector3(-70, 0, 0)] },
      { leader: new THREE.Vector3(70, 0, -54), a: new THREE.Vector3(76, 0, -48), b: new THREE.Vector3(64, 0, -60), patrol: [new THREE.Vector3(70, 0, -54), new THREE.Vector3(88, 0, 0), new THREE.Vector3(44, 0, 76), new THREE.Vector3(-44, 0, 76)] },
    ];
  }

  // =====================================================================
  // MERGE → one mesh per material (+ BVH for fast raycasts)
  // =====================================================================
  for (const [m, geos] of geoByMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const g of geos) g.dispose();
    (merged as unknown as { computeBoundsTree(): void }).computeBoundsTree();
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    occluders.push(mesh);
  }

  // destructible glass — a single InstancedMesh
  let glass: THREE.InstancedMesh | null = null;
  if (glassMats.length) {
    const gm = new THREE.MeshPhysicalMaterial({ color: 0x9FC4D8, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1 });
    glass = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), gm, glassMats.length);
    glassMats.forEach((mm, i) => glass!.setMatrixAt(i, mm));
    glass.instanceMatrix.needsUpdate = true;
    glass.userData.glass = true;
    glass.renderOrder = 5;
    group.add(glass);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const broken = new Set<number>();
  const breakGlass = (i: number) => {
    if (!glass || broken.has(i)) return null;
    broken.add(i);
    glass.setMatrixAt(i, zero);
    glass.instanceMatrix.needsUpdate = true;
    return glassCenters[i].clone();
  };

  scene.add(group);
  return { group, solids, occluders, coverNodes, squadSpawns, playerSpawn, interiors, concrete, wood, half, lightSpots, windows, glass, breakGlass };
}

export function pointInAABB(x: number, y: number, z: number, b: AABB): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}
