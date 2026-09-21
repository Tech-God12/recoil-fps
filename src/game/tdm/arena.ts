// Recoil FPS — WAREHOUSE: the 5v5 TDM arena.
//
// A 116 × 116 m concrete freight yard built around two attached metal warehouses,
// authored for competitive spawn → mid → spawn flow with hard cover at every range:
//
//   north (z −42)  BRAVO spawn: sandbag line, twin U-barriers, container yard
//   centre         TWO warehouses (16×22 m) joined by a 4×6 m corridor, crate cover
//                  inside, roof overlooks reached by external stairs, container stacks
//   south (z +42)  ALPHA spawn: mirrored spawn fortifications
//
// Everything is flat (groundHeight === 0) so the 2 m NavGrid is exact, every
// obstacle registers cover nodes for the bots, and the yard merges into one mesh
// per material with a BVH for cheap raycasts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getMaterials, type TextureSet } from '../textures';
import type { AABB, World } from '../world';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree ??= computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree?: typeof disposeBoundsTree }).disposeBoundsTree ??= disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const ARENA_HALF = 58;
/** 6 m shell walls keep every sightline inside the yard. */
const WALL_H = 6, WALL_T = 1.2;

/** Warehouse footprint (each) and the corridor that joins them. */
export const WAREHOUSE = { w: 16, d: 22, h: 5.5, centres: [-10, 10] as [number, number] } as const;
export const CORRIDOR = { w: 4, d: 6, h: 3.6 } as const;

export type SpawnPoint = [number, number, number];

/**
 * Five spawn points per team on a shallow arc so a respawn wave never stacks in
 * one doorway: alpha holds the south yard, bravo the north yard, both ~42 m out.
 */
export const TDM_SPAWNS: Record<'alpha' | 'bravo', readonly SpawnPoint[]> = {
  alpha: [[-15, 0, 42], [-7.5, 0, 44], [0, 0, 42.5], [7.5, 0, 44], [15, 0, 42]],
  bravo: [[-15, 0, -42], [-7.5, 0, -44], [0, 0, -42.5], [7.5, 0, -44], [15, 0, -42]],
};

/** Elevated overwatch posts — warehouse roofs and the double container stacks. */
export const TDM_PERCHES: readonly { name: string; at: SpawnPoint; team: 'alpha' | 'bravo' }[] = [
  { name: 'West warehouse roof', at: [-10, WAREHOUSE.h, 0], team: 'alpha' },
  { name: 'East warehouse roof', at: [10, WAREHOUSE.h, 0], team: 'bravo' },
  { name: 'South container stack', at: [-45, 5.2, 0], team: 'alpha' },
  { name: 'North container stack', at: [45, 5.2, 0], team: 'bravo' },
];

export function buildArenaWorld(scene: THREE.Scene, materials?: TextureSet): World {
  const group = new THREE.Group();
  const solids: AABB[] = [];
  const occluders: THREE.Object3D[] = [];
  const coverNodes: THREE.Vector3[] = [];
  const interiors: AABB[] = [];
  const concrete: AABB[] = [];
  const wood: AABB[] = [];
  const lightSpots: THREE.Vector3[] = [];
  const landmarks: World['landmarks'] = [];
  const overlooks: World['overlooks'] = [];
  const M: TextureSet = materials ?? getMaterials();
  const geosByMat = new Map<THREE.Material, THREE.BufferGeometry[]>();

  const half = ARENA_HALF;
  const concreteMat = M.concrete;
  const asphaltMat = M.asphalt ?? M.concrete;
  const paverMat = M.terracePavers ?? M.plaza;
  const wallMat = M.corrugatedMetal ?? M.rustedMetal;
  const roofMat = M.rustedMetal ?? M.corrugatedMetal;
  const timberMat = M.roughTimber ?? M.wood;
  const bagMat = M.sandbag;
  const whH = WAREHOUSE.h, whWidth = WAREHOUSE.w, whDepth = WAREHOUSE.d;
  const zN = -whDepth / 2, zS = whDepth / 2;

  // ---- shared accent materials (so painted details merge into one batch) ----
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const col = (hex: number, rough = 0.8, metal = 0, emissive = 0) => {
    const k = `${hex}-${rough}-${metal}-${emissive}`;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
      if (emissive) { m.emissive = new THREE.Color(hex); m.emissiveIntensity = emissive; }
      matCache.set(k, m);
    }
    return m;
  };
  const HAZARD = col(0xC9A227, 0.75), TEAM_A = col(0x3F7D4E), TEAM_B = col(0x8C3A2E);
  const GLOW = col(0xFFE2A8, 0.4, 0, 2.4), DARK = col(0x24262A, 0.65, 0.25), PAINT = col(0xE6E2D8, 0.7);
  const STEEL_RAIL = col(0x8E9499, 0.45, 0.4);
  const CONTAINERS = [col(0x2F6E7A, 0.7, 0.15), col(0x9A5330, 0.72, 0.15), col(0x5C6B3A, 0.75, 0.12), col(0x7A4B6B, 0.75, 0.12)];
  const accent = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const emissiveAccent = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, emissive: 0xffa65b, emissiveIntensity: 1.6 });

  function push(geo: THREE.BufferGeometry, m: THREE.Material) {
    if (geo.index) { const indexed = geo; geo = indexed.toNonIndexed(); indexed.dispose(); }
    if (m instanceof THREE.MeshStandardMaterial && !m.map && [...matCache.values()].includes(m)) {
      const c = m.color, colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      m = m.emissiveIntensity > 1 ? emissiveAccent : accent;
    }
    const arr = geosByMat.get(m);
    if (arr) arr.push(geo); else geosByMat.set(m, [geo]);
  }

  function box(cx: number, cy: number, cz: number, w: number, h: number, d: number, m: THREE.Material, collide = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv');
    const map = (m as THREE.MeshStandardMaterial).map;
    if (map) for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4), u = face < 2 ? d : w, v = face < 2 ? h : face < 4 ? d : h;
      uv.setXY(i, uv.getX(i) * u / 4 / map.repeat.x, uv.getY(i) * v / 4 / map.repeat.y);
    }
    g.translate(cx, cy, cz);
    push(g, m);
    if (collide) {
      const aabb = { minX: cx - w / 2, minY: cy - h / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxY: cy + h / 2, maxZ: cz + d / 2 };
      solids.push(aabb);
      // Surface bookkeeping drives impact sparks, footsteps, slide drag AND the
      // minimap paint: the yard must read as concrete, the crates as timber.
      if (m === timberMat) wood.push(aabb);
      else if (m !== bagMat) concrete.push(aabb);
    }
  }
  function shape(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    push(geo, m);
  }
  const cyl = (rt: number, rb: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number) =>
    shape(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);

  // ---- ground decals: newest plane wins, incumbents are carved up ----------
  type Patch = { x0: number; x1: number; z0: number; z1: number; y: number; m: THREE.Material };
  let patches: Patch[] = [];
  function ground(x: number, z: number, w: number, d: number, m: THREE.Material, y = 0.02) {
    const next: Patch[] = [];
    const fresh: Patch = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y, m };
    for (const old of patches) {
      if (old.m !== fresh.m || Math.abs(old.y - y) > 0.12 || old.x1 <= fresh.x0 || old.x0 >= fresh.x1 || old.z1 <= fresh.z0 || old.z0 >= fresh.z1) { next.push(old); continue; }
      const a = Math.max(old.x0, fresh.x0), b = Math.min(old.x1, fresh.x1), c = Math.max(old.z0, fresh.z0), e = Math.min(old.z1, fresh.z1);
      if (a > old.x0) next.push({ ...old, x1: a });
      if (b < old.x1) next.push({ ...old, x0: b });
      if (c > old.z0) next.push({ ...old, x0: a, x1: b, z1: c });
      if (e < old.z1) next.push({ ...old, x0: a, x1: b, z0: e });
    }
    next.push(fresh); patches = next;
  }
  const cover = (x: number, z: number, y = 0) => { coverNodes.push(new THREE.Vector3(x, y, z)); };
  /** Every obstacle is ringed by cover nodes so bots always have something to hug. */
  function coverRing(x: number, z: number, w: number, d: number, y = 0) {
    cover(x - w / 2 - 0.9, z, y); cover(x + w / 2 + 0.9, z, y);
    cover(x, z - d / 2 - 0.9, y); cover(x, z + d / 2 + 0.9, y);
  }

  /* ==================== GROUND ==================== */
  ground(0, 0, half * 2 + 12, half * 2 + 12, concreteMat, 0);
  ground(0, 0, 30, half * 2 - 6, asphaltMat, 0.02);            // north-south freight lane
  ground(0, 0, half * 2 - 6, 16, asphaltMat, 0.02);            // east-west freight lane
  ground(-10, 0, 42, 34, paverMat, 0.03);                      // warehouse apron
  ground(10, 0, 42, 34, paverMat, 0.03);
  for (const side of [-1, 1]) {
    ground(side * 38, 0, 12, 62, paverMat, 0.03);
    ground(side * 38, -30, 26, 14, asphaltMat, 0.02);
    ground(side * 38, 30, 26, 14, asphaltMat, 0.02);
  }
  for (let i = 0; i < 12; i++) {
    ground(-22 + i * 4, 34, 0.5, 11, HAZARD, 0.05);
    ground(-22 + i * 4, -34, 0.5, 11, HAZARD, 0.05);
  }

  /* ==================== OUTER SHELL ==================== */
  for (const side of [-1, 1]) {
    box(side * (half - WALL_T / 2), WALL_H / 2, 0, WALL_T, WALL_H, half * 2, concreteMat);
    box(0, WALL_H / 2, side * (half - WALL_T / 2), half * 2 - WALL_T * 2, WALL_H, WALL_T, concreteMat);
  }
  for (let i = -2; i <= 2; i++) for (const side of [-1, 1]) {
    box(side * (half - 2.5), 1.6, i * 20, 2.6, 3.2, 3.2, concreteMat);
    box(i * 20, 1.6, side * (half - 2.5), 3.2, 3.2, 2.6, concreteMat);
  }
  for (const side of [-1, 1]) {
    box(side * (half - 0.7), WALL_H - 0.9, 0, 0.25, 0.5, half * 2 - 2, HAZARD, false);
    box(0, WALL_H - 0.9, side * (half - 0.7), half * 2 - 2, 0.5, 0.25, HAZARD, false);
  }

  /* ==================== CRATES / PLANKS / BAGS ==================== */
  function crate(x: number, z: number, size = 1.2, y = 0, height = 0) {
    const h = height || size;
    box(x, y + h / 2, z, size, h, size, timberMat);
    for (const dy of [0.06, h - 0.06]) box(x, y + dy, z, size + 0.06, 0.08, size + 0.06, DARK, false);
    coverRing(x, z, size, size, y);
  }
  function plank(x: number, z: number, alongX: boolean) {
    box(x, 0.6, z, alongX ? 2.0 : 0.4, 1.2, alongX ? 0.4 : 2.0, timberMat);
    box(x, 1.24, z, alongX ? 2.1 : 0.5, 0.1, alongX ? 0.5 : 2.1, DARK, false);
    cover(x + (alongX ? 0 : 1.1), z + (alongX ? 1.1 : 0));
    cover(x - (alongX ? 0 : 1.1), z - (alongX ? 1.1 : 0));
  }
  function sandbags(x: number, z: number, alongX = true) {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 0.9 + (row % 2) * 0.15;
      box(x + (alongX ? off : 0), 0.18 + row * 0.31, z + (alongX ? 0 : off), alongX ? 0.86 : 0.66, 0.32, alongX ? 0.66 : 0.86, bagMat);
    }
    cover(x + (alongX ? 0 : 1.5), z + (alongX ? 1.5 : 0));
    cover(x - (alongX ? 0 : 1.5), z - (alongX ? 1.5 : 0));
  }

  /* ==================== WAREHOUSES (the landmark) ==================== */
  const doorW = 3.2, doorH = 4.2, wt = 0.3;
  /** Roll-up shutter look-alike, mounted on the yard side of a doorway. */
  function shutter(x: number, z: number, alongX: boolean) {
    box(x, doorH + 0.18, z, alongX ? 0.36 : doorW + 0.2, 0.36, alongX ? doorW + 0.2 : 0.36, DARK, false);
    for (const s of [-1, 1]) box(x + (alongX ? 0 : s * doorW / 2), doorH / 2, z + (alongX ? s * doorW / 2 : 0), alongX ? 0.22 : 0.16, doorH, alongX ? 0.16 : 0.22, DARK, false);
    box(x, doorH + 0.22, z, alongX ? 0.5 : doorW + 0.6, 0.14, alongX ? doorW + 0.6 : 0.5, HAZARD, false);
  }
  /** Long wall (runs in z) with one 3.2 m freight door punched through it. */
  function longWall(x: number, cx: number, outward: number) {
    const seg = (s: number, e: number, yb: number, yt: number) => {
      if (e - s < 0.05 || yt - yb < 0.05) return;
      box(x, (yb + yt) / 2, (s + e) / 2, wt, yt - yb, e - s, wallMat);
    };
    seg(zN, -doorW / 2, 0, whH); seg(doorW / 2, zS, 0, whH); seg(-doorW / 2, doorW / 2, doorH, whH);
    if (outward) shutter(x + outward * 0.24, 0, false);
    void cx;
  }
  /**
   * Short wall (runs in x) carrying two 3.2 m freight doors. The wall is authored
   * as the three piers *between* the doors, so the openings are real gaps in the
   * collision set — a wall that merely looked open would seal the AI's nav grid.
   */
  function shortWall(z: number, cx: number) {
    const x0 = cx - whWidth / 2, x1 = cx + whWidth / 2;
    const seg = (s: number, e: number, yb: number, yt: number) => {
      if (e - s < 0.05 || yt - yb < 0.05) return;
      box((s + e) / 2, (yb + yt) / 2, z, e - s, yt - yb, wt, wallMat);
    };
    const doors = [cx - 6.2, cx + 6.2].map(d => [d - doorW / 2, d + doorW / 2] as const).sort((a, b) => a[0] - b[0]);
    seg(x0, doors[0][0], 0, whH);
    seg(doors[0][1], doors[1][0], 0, whH);
    seg(doors[1][1], x1, 0, whH);
    for (const [d0, d1] of doors) {
      seg(d0, d1, 3.4, whH);                                  // lintel above the opening
      box((d0 + d1) / 2, 3.6, z, doorW + 0.4, 0.3, 0.4, DARK, false);
    }
  }
  /**
   * One warehouse: 16 × 22 m, 5.5 m tall, corrugated walls, steel roof, two big
   * roll-up doors per long side, two short-side doors, interior trusses + crate
   * cover, and a walkable roof deck ringed by a low lip.
   */
  function warehouse(cx: number, label: string, tint: THREE.Material) {
    longWall(cx - whWidth / 2, cx, -1);
    longWall(cx + whWidth / 2, cx, 1);
    shortWall(zN, cx); shortWall(zS, cx);
    // Roof deck (walkable at 5.5) + perimeter lip so nobody slides off.
    box(cx, whH + 0.1, 0, whWidth + 0.7, 0.2, whDepth + 0.7, roofMat);
    for (const [lx, lz, lw, ld] of [
      [cx, zN - 0.35, whWidth + 0.7, 0.3], [cx, zS + 0.35, whWidth + 0.7, 0.3],
      [cx - whWidth / 2 - 0.35, 0, 0.3, whDepth + 0.7], [cx + whWidth / 2 + 0.35, 0, 0.3, whDepth + 0.7],
    ] as const) box(lx, whH + 0.42, lz, lw, 0.44, ld, roofMat);
    for (const dz of [-6, 0, 6]) box(cx, whH + 0.24, dz, whWidth - 5, 0.12, 1.6, col(0x9FC4D8, 0.35, 0.1), false);
    for (const dz of [-8, 8]) { box(cx, whH + 0.75, dz, 1.6, 0.6, 1.6, DARK, false); cyl(0.5, 0.5, 0.5, 8, DARK, cx, whH + 1.3, dz); }
    // Interior slab, roof trusses, wall ribs, hanging lamps.
    ground(cx, 0, whWidth - 0.5, whDepth - 0.5, concreteMat, 0.05);
    for (let i = -2; i <= 2; i++) {
      box(cx, whH - 0.35, i * 4.4, whWidth - 0.2, 0.22, 0.3, DARK, false);
      box(cx, whH - 1.4, i * 4.4, 0.18, 1.9, 0.18, DARK, false);
      for (const s of [-1, 1]) box(cx + s * (whWidth / 2 - 0.25), whH - 1.2, i * 4.4, 0.1, 1.6, 0.1, DARK, false);
    }
    cyl(0.34, 0.34, 0.16, 10, GLOW, cx - 4, whH - 1.9, -5);
    cyl(0.34, 0.34, 0.16, 10, GLOW, cx + 4, whH - 1.9, 5);
    // Three crate clusters: mixed heights for crouch/stand peeking.
    crate(cx - 4.6, -6.8, 1.2); crate(cx - 3.2, -6.8, 1.2); crate(cx - 3.9, -6.8, 1.2, 1.2);
    crate(cx + 4.4, 6.4, 1.2); crate(cx + 4.4, 5.1, 1.2); crate(cx + 4.4, 6.4, 1.15, 1.2);
    crate(cx - 5.4, 7.6, 1.4); crate(cx + 5.2, -8.1, 1.4);
    for (const [px, pz] of [[cx - 1.4, -9.4], [cx + 1.6, 9.4]] as const) {
      box(px, 0.1, pz, 1.4, 0.2, 1.2, timberMat, false);
      box(px, 0.32, pz, 1.2, 0.24, 1.0, timberMat);
    }
    for (const [dx, dz] of [[2.4, -3.2], [3.1, -3.2]] as const) cyl(0.32, 0.32, 0.9, 12, CONTAINERS[2], cx + dx, 0.45, dz);
    interiors.push({ minX: cx - whWidth / 2, minY: 0, minZ: zN, maxX: cx + whWidth / 2, maxY: whH + 1.6, maxZ: zS });
    box(cx, whH + 0.24, tint === TEAM_A ? -8.4 : 8.4, whWidth - 7, 0.1, 1.2, tint, false);
    coverRing(cx - whWidth / 2 - 0.6, 0, 1.2, whDepth); coverRing(cx + whWidth / 2 + 0.6, 0, 1.2, whDepth);
    cover(cx, zN - 1.6); cover(cx, zS + 1.6);
    cover(cx - 4, 0, whH + 0.2); cover(cx + 4, 0, whH + 0.2); cover(cx, 8, whH + 0.2); cover(cx, -8, whH + 0.2);
    overlooks.push({
      name: `${label} roof`, at: new THREE.Vector3(cx, whH + 0.2, 0),
      approach: new THREE.Vector3(cx - 5.5, 0, zN - 8),
      route: [new THREE.Vector3(cx - 5.5, whH + 0.2, zN - 1), new THREE.Vector3(cx, whH + 0.2, 0)],
    });
  }
  warehouse(WAREHOUSE.centres[0], 'West warehouse', TEAM_A);
  warehouse(WAREHOUSE.centres[1], 'East warehouse', TEAM_B);
  // Load-bearing pier where the two inner walls meet, so they read as one block.
  box(0, whH / 2, 0, 0.3, whH, whDepth, wallMat, false);
  landmarks.push(
    { name: 'West warehouse', at: new THREE.Vector3(-10, whH + 1, 0) },
    { name: 'East warehouse', at: new THREE.Vector3(10, whH + 1, 0) },
  );

  /* ==================== CORRIDOR (4 × 6 m link) ==================== */
  {
    const { w, d, h } = CORRIDOR;
    ground(0, 0, w + 0.4, d + 0.4, concreteMat, 0.06);
    box(0, h / 2, -d / 2 + 0.15, w, h, 0.3, wallMat, false);
    box(0, h / 2, d / 2 - 0.15, w, h, 0.3, wallMat, false);
    box(0, h + 0.15, 0, w + 0.7, 0.3, d + 0.7, roofMat);
    for (const s of [-1, 1]) box(0, h + 0.35, s * (d / 2 + 0.5), w + 0.7, 0.4, 0.3, HAZARD, false);
    cyl(0.2, 0.2, 0.14, 10, GLOW, 0, h - 0.25, -1.7);
    cyl(0.2, 0.2, 0.14, 10, GLOW, 0, h - 0.25, 1.7);
    // Two small crates hug the corridor walls: cover to fight over, but the 4 m
    // alley stays a walkable lane instead of a sealed pocket.
    crate(1.5, 0, 0.9); crate(-1.5, 2.4, 0.9);
    cover(-w / 2 - 1.0, 0); cover(w / 2 + 1.0, 0);
    interiors.push({ minX: -w / 2, minY: 0, minZ: -d / 2, maxX: w / 2, maxY: h + 0.3, maxZ: d / 2 });
  }

  /* ==================== ROOF ACCESS ==================== */
  /**
   * External concrete stairs on the north face: eleven 0.5 m risers (steppable by
   * the player AND by bots), a landing beside the roof lip, then a 0.4 m pad that
   * clears the parapet. This is what makes the warehouse roofs real tactical
   * ground rather than decoration.
   */
  function roofStairs(x: number) {
    const risers = 11, rise = whH / risers, run = 0.64;
    for (let i = 0; i < risers; i++) {
      const top = rise * (i + 1);
      box(x, top / 2, zN - 0.5 - run * (risers - i), 3.2, top, run + 0.05, concreteMat);
    }
    box(x, whH / 2, zN - 0.45, 3.4, whH, 0.9, concreteMat);                    // top block at the lip
    for (const s of [-1, 1]) box(x + s * 1.68, whH - 0.35, zN - 0.5 - run * risers / 2, 0.15, 0.8, run * risers, DARK, false);
    box(x, 1.2, zN - 0.5 - run * risers - 1.2, 3.4, 2.4, 2.4, concreteMat);     // entry ramp block
    cover(x - 2.6, zN - 4); cover(x + 2.6, zN - 4);
  }
  roofStairs(-10 - 5.5); roofStairs(-10 + 5.5);
  roofStairs(10 - 5.5); roofStairs(10 + 5.5);

  /* ==================== CONTAINERS ==================== */
  const CW = 2.5, CH = 2.6, CL = 6.2;
  function container(x: number, z: number, alongZ: boolean, mat: THREE.Material, stacked = false) {
    const w = alongZ ? CW : CL, d = alongZ ? CL : CW;
    const body = (yb: number) => {
      box(x, yb + CH / 2, z, w, CH, d, mat);
      for (let i = 0; i < 7; i++) {
        const off = -CL / 2 + 0.45 + i * 0.9;
        if (alongZ) box(x + CW / 2 + 0.03, yb + CH / 2, z + off, 0.06, CH - 0.35, 0.42, DARK, false);
        else box(x + off, yb + CH / 2, z + CW / 2 + 0.03, 0.42, CH - 0.35, 0.06, DARK, false);
      }
      const ed = alongZ ? [x, z + CL / 2 + 0.04] : [x + CL / 2 + 0.04, z];
      box(ed[0], yb + CH / 2, ed[1], alongZ ? CW - 0.5 : 0.1, CH - 0.6, alongZ ? 0.1 : CW - 0.5, DARK, false);
    };
    body(0);
    if (stacked) body(CH);
    box(x, (stacked ? 2 * CH : CH) + 0.06, z, w + 0.14, 0.16, d + 0.14, stacked ? HAZARD : DARK, false);
    coverRing(x, z, w, d);
    if (stacked) { cover(x, z + 3.4, 2 * CH + 0.2); cover(x, z - 3.4, 2 * CH + 0.2); }
    return stacked ? 2 * CH : CH;
  }
  const containerSet: [number, number, boolean, boolean][] = [
    [-32, -28, true, false], [32, -28, true, false], [-32, 28, true, false], [32, 28, true, false],
    [-45, 0, false, true], [45, 0, false, true],
    [-24, -9, true, false], [24, 9, true, false], [-24, 9, true, false], [24, -9, true, false],
    [0, -30, false, false], [0, 30, false, false],
  ];
  containerSet.forEach(([x, z, alongZ, stacked], i) => container(x, z, alongZ, CONTAINERS[i % CONTAINERS.length], stacked));
  // Scaffold stairs beside each double stack: 0.52 m steps for players and bots.
  for (const x of [-45, 45]) {
    const inward = x < 0 ? 1 : -1;
    for (let i = 0; i < 10; i++) box(x + inward * 2.9, 0.52 * (i + 1) / 2, 3.4 - i * 0.62, 1.6, 0.52 * (i + 1), 0.64, concreteMat);
    box(x + inward * 2.9, 2.6, -2.4, 1.8, 5.2, 2.2, concreteMat);
    cover(x + inward * 5.0, 3.0); cover(x - inward * 4.6, -3.0);
  }
  landmarks.push({ name: 'Container stacks', at: new THREE.Vector3(45, 5.4, 0) });

  /* ==================== U-BARRIERS ==================== */
  /**
   * U-shaped concrete barrier: 3.2 m back + two 2.2 m returns, 1.8 m tall — the
   * white shapes on a PUBG minimap. `facing` picks which way the pocket opens.
   */
  function ubarrier(x: number, z: number, facing: 'n' | 's' | 'e' | 'w') {
    const t = 0.4, h = 1.8, back = 3.2, side = 2.2;
    if (facing === 'n' || facing === 's') {
      const zs = z + (facing === 's' ? side / 2 : -side / 2);
      box(x, h / 2, z, back, h, t, concreteMat);
      for (const s of [-1, 1]) box(x + s * (back / 2 - t / 2), h / 2, zs, t, h, side, concreteMat);
      box(x, h + 0.06, z, back + 0.2, 0.12, t + 0.2, DARK, false);
      box(x, h - 0.5, z + (facing === 's' ? 0.22 : -0.22), back - 0.5, 0.5, 0.06, HAZARD, false);
      cover(x, z + (facing === 's' ? side + 0.8 : -side - 0.8));
      cover(x + back / 2 + 0.9, z + (facing === 's' ? side : -side));
      cover(x - back / 2 - 0.9, z + (facing === 's' ? side : -side));
    } else {
      const xs = x + (facing === 'e' ? side / 2 : -side / 2);
      box(x, h / 2, z, t, h, back, concreteMat);
      for (const s of [-1, 1]) box(xs, h / 2, z + s * (back / 2 - t / 2), side, h, t, concreteMat);
      box(x, h + 0.06, z, t + 0.2, 0.12, back + 0.2, DARK, false);
      box(x + (facing === 'e' ? 0.22 : -0.22), h - 0.5, z, 0.06, 0.5, back - 0.5, HAZARD, false);
      cover(x + (facing === 'e' ? side + 0.8 : -side - 0.8), z);
      cover(x + (facing === 'e' ? side : -side), z - back / 2 - 0.9);
      cover(x + (facing === 'e' ? side : -side), z + back / 2 + 0.9);
    }
  }
  const barriers: [number, number, 'n' | 's' | 'e' | 'w'][] = [
    [-14, 0, 'w'], [14, 0, 'e'], [-7.5, -17, 'n'], [7.5, 17, 's'], [7.5, -17, 'n'], [-7.5, 17, 's'],
    [-30, -14, 's'], [30, 14, 'n'], [-30, 14, 'w'], [30, -14, 'e'],
    [-16, -26, 'n'], [16, 26, 's'], [16, -26, 's'], [-16, 26, 'n'],
    [-9, 36, 's'], [9, 36, 's'], [0, 47.5, 's'],
    [-9, -36, 'n'], [9, -36, 'n'], [0, -47.5, 'n'],
  ];
  for (const [x, z, f] of barriers) ubarrier(x, z, f);
  for (const [x, z, alongX] of [
    [-38, 12, true], [-38, -12, true], [38, 12, true], [38, -12, true],
    [-20, -40, true], [20, 40, true], [20, -40, true], [-20, 40, true],
  ] as const) {
    box(x, 0.55, z, alongX ? 3.6 : 0.55, 1.1, alongX ? 0.55 : 3.6, concreteMat);
    box(x, 1.02, z, alongX ? 3.2 : 0.7, 0.06, alongX ? 0.7 : 3.2, HAZARD, false);
    cover(x + (alongX ? 0 : 1.2), z + (alongX ? 1.2 : 0));
  }

  /* ==================== LANE DETAIL ==================== */
  for (const [x, z, n] of [[-6, -12, 3], [6, 12, 3], [-12, 7, 2], [12, -7, 2], [0, -9, 2], [0, 9, 2]] as const) {
    crate(x, z, 1.2);
    if (n > 1) crate(x + 1.4, z, 1.2);
    if (n > 2) crate(x + 0.7, z + 1.4, 1.2);
  }
  for (const [x, z] of [[-26, -22], [26, 22], [-26, 22], [26, -22], [-40, 18], [40, -18]] as const) crate(x, z, 1.4);
  for (const [x, z, ax] of [
    [-46, -20, false], [-46, 20, false], [46, -20, false], [46, 20, false],
    [-22, -34, true], [22, 34, true], [22, -34, true], [-22, 34, true],
    [-8, -24, true], [8, 24, true],
  ] as const) plank(x, z, ax);
  sandbags(-15, 44.5); sandbags(15, 44.5); sandbags(0, 47.5);
  sandbags(-15, -44.5); sandbags(15, -44.5); sandbags(0, -47.5);
  sandbags(-34, -40); sandbags(34, 40); sandbags(34, -40); sandbags(-34, 40);
  for (const [x, z, mat] of [[-15, 45.8, TEAM_A], [15, 45.8, TEAM_A], [-15, -45.8, TEAM_B], [15, -45.8, TEAM_B]] as const) {
    box(x, 1.5, z, 0.12, 3, 0.12, DARK, false);
    box(x, 2.5, z + (z > 0 ? -0.06 : 0.06), 1.4, 1.0, 0.08, mat, false);
  }
  // Loading dock on the west wall (raised deck + ramp) and utility sheds on the east.
  box(-52, 0.45, 0, 9, 0.9, 26, concreteMat);
  box(-52, 0.96, 0, 9.2, 0.12, 26.2, HAZARD, false);
  for (let i = 0; i < 6; i++) box(-46.4 + i * 0.75, 0.9 * (i + 1) / 6 / 2, 14.5 - i * 0.9, 1.2, 0.9 * (i + 1) / 6, 0.9, concreteMat);
  for (const z of [-8, 0, 8]) crate(-52, z + 2.6, 1.2, 0.9);
  box(-56.4, 4.4, 0, 0.7, 8.8, 0.7, DARK);
  box(-54.6, 8.2, 0, 4.2, 0.5, 0.5, DARK, false);
  cover(-48, -8); cover(-48, 8); cover(-48, 0, 0.9);
  for (const [x, z] of [[52, -14], [52, 14]] as const) {
    box(x, 1.5, z, 6, 3, 7, wallMat);
    box(x, 3.15, z, 6.6, 0.3, 7.6, roofMat);
    box(x - 3.05, 1.1, z, 0.2, 2.2, 2.4, DARK, false);
    interiors.push({ minX: x - 3, minY: 0, minZ: z - 3.5, maxX: x + 3, maxY: 3.6, maxZ: z + 3.5 });
    cover(x - 4.2, z); cover(x + 4.2, z); cover(x, z - 4.6); cover(x, z + 4.6);
  }
  for (const [x, z] of [[48, -24], [48, 24], [-48, -24], [-48, 24]] as const) {
    for (const [dx, dz] of [[0, 0], [0.8, 0.6], [-0.7, 0.7]] as const) cyl(0.34, 0.34, 1.0, 12, CONTAINERS[2], x + dx, 0.5, z + dz);
    cover(x + 1.6, z); cover(x - 1.6, z);
  }
  for (const [x, z] of [[-10, 20], [10, -20], [-34, -6], [34, 6]] as const) {
    box(x, 3.5, z, 0.3, 7, 0.3, DARK);
    box(x, 6.65, z, 2.4, 0.18, 0.2, DARK, false);
    for (const dx of [-1.0, 1.0]) shape(new THREE.BoxGeometry(0.5, 0.16, 0.36), GLOW, x + dx, 6.5, z);
    cover(x + 1.5, z);
  }
  lightSpots.push(
    new THREE.Vector3(-10, 4.6, 0), new THREE.Vector3(10, 4.6, 0), new THREE.Vector3(0, 2.6, 0),
    new THREE.Vector3(-30, 4.5, 22), new THREE.Vector3(30, 4.5, -22),
  );
  for (const [x, z, flip] of [[-20, 30, 1], [20, -30, -1]] as const) {
    ground(x, z, 3.2, 0.4, PAINT, 0.055);
    shape(new THREE.ConeGeometry(0.9, 1.4, 3), PAINT, x, 0.05, z + flip * 1.1, -Math.PI / 2, 0, flip > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  /* ==================== SKY BRIDGE + ROOF FURNITURE ==================== */
  /**
   * A steel catwalk spans the 3.3 m gap between the two warehouse roofs. It turns
   * two separate overlooks into one continuous high lane: you can cross the yard at
   * 5.5 m without ever touching the deck, and the corridor below becomes a kill box
   * that both sides fight over from above and below.
   */
  {
    const bw = 2.2;
    box(0, whH + 0.08, 0, CORRIDOR.w + 1.6, 0.16, bw, roofMat);
    for (const sgn of [-1, 1]) {
      box(0, whH + 0.62, sgn * bw / 2, CORRIDOR.w + 1.6, 0.1, 0.1, HAZARD, false);      // top rail
      box(0, whH + 0.34, sgn * bw / 2, CORRIDOR.w + 1.6, 0.08, 0.08, DARK, false);      // mid rail
      for (const px of [-1.4, 0, 1.4]) box(px, whH + 0.5, sgn * bw / 2, 0.09, 0.9, 0.09, DARK, false);
    }
    for (const sgn of [-1, 1]) box(sgn * (CORRIDOR.w / 2 + 0.7), whH - 1.1, 0, 0.22, 1.6, 0.22, DARK, false);
    cover(0, 0, whH + 0.2); cover(0, 1.1, whH + 0.2); cover(0, -1.1, whH + 0.2);
  }
  /** Roof detail: vents, duct runs, skylight panes and a perimeter rail. */
  for (const cx of WAREHOUSE.centres) {
    for (const [dx, dz, w, d] of [[-5.4, -3.2, 1.5, 1.5], [5.4, 3.2, 1.5, 1.5], [0, -7.6, 2.0, 1.1], [0, 7.6, 2.0, 1.1]] as const) {
      box(cx + dx, whH + 0.62, dz, w, 0.9, d, DARK, false);
      cyl(0.42, 0.5, 0.34, 10, DARK, cx + dx, whH + 1.2, dz);
    }
    box(cx, whH + 0.42, -9.6, whWidth - 3, 0.28, 0.5, DARK, false);
    box(cx, whH + 0.42, 9.6, whWidth - 3, 0.28, 0.5, DARK, false);
    for (const dz of [-4.6, 4.6]) shape(new THREE.BoxGeometry(whWidth - 6, 0.06, 3.0), col(0xBFD8E6, 0.25, 0.1, 0.25), cx, whH + 0.22, dz);
    for (let i = -2; i <= 2; i++) {
      for (const sgn of [-1, 1]) box(cx + sgn * (whWidth / 2 + 0.3), whH + 0.72, i * 4.2, 0.1, 0.6, 0.1, DARK, false);
      if (i < 2) for (const sgn of [-1, 1]) box(cx + sgn * (whWidth / 2 + 0.3), whH + 0.98, i * 4.2 + 2.1, 0.07, 0.07, 4.2, STEEL_RAIL, false);
    }
  }
  /** Utility run along the west dock wall: pipes, junction boxes, wall floodlights. */
  for (const z of [-22, -11, 0, 11, 22]) {
    box(-56.5, 3.1, z, 0.35, 0.35, 9, DARK, false);
    box(-56.5, 2.6, z, 0.22, 0.22, 9, HAZARD, false);
    box(-56.2, 3.9, z + 4, 0.5, 0.8, 0.7, DARK, false);
    box(-56.3, 5.2, z + 4, 0.4, 0.3, 1.5, GLOW, false);
  }

  /* ==================== MID-YARD FURNITURE ==================== */
  /** Tire stacks: 0.75 m of shootable, jumpable cover on the open lanes. */
  function tires(x: number, z: number, rows = 3) {
    for (let i = 0; i < rows; i++) {
      cyl(0.55, 0.55, 0.26, 12, DARK, x + (i % 2 ? 0.16 : -0.12), 0.13 + i * 0.25, z + (i % 2 ? -0.14 : 0.1));
      if (i > 0) cyl(0.34, 0.34, 0.26, 10, col(0x1A1C1E), x + (i % 2 ? 0.16 : -0.12), 0.13 + i * 0.25, z + (i % 2 ? -0.14 : 0.1));
    }
    solids.push({ minX: x - 0.7, minY: 0, minZ: z - 0.7, maxX: x + 0.7, maxY: 0.26 * rows, maxZ: z + 0.7 });
    cover(x + 1.3, z); cover(x - 1.3, z); cover(x, z + 1.3); cover(x, z - 1.3);
  }
  for (const [x, z, r] of [[-20, 22, 3], [20, -22, 3], [-22, -20, 2], [22, 20, 2], [-8, 30, 3], [8, -30, 3], [9, 30, 2], [-9, -30, 2]] as const) tires(x, z, r);
  /** Steel pipe racks + cable drums: industrial clutter that also breaks sightlines. */
  for (const [x, z, alongX] of [[-33, 6, false], [33, -6, false], [-12, 33, true], [12, -33, true]] as const) {
    for (const sgn of [-1, 1]) box(x + (alongX ? sgn * 1.6 : 0), 0.55, z + (alongX ? 0 : sgn * 1.6), alongX ? 0.18 : 0.18, 1.1, alongX ? 0.18 : 0.18, DARK, false);
    for (const y of [0.35, 0.95]) {
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.34;
        shape(new THREE.CylinderGeometry(0.16, 0.16, alongX ? 3.1 : 3.1, 10),
          i === 1 ? HAZARD : DARK, x + (alongX ? 0 : off), y, z + (alongX ? off : 0), 0, 0, alongX ? Math.PI / 2 : 0);
      }
    }
    solids.push({
      minX: x - (alongX ? 1.7 : 0.5), maxX: x + (alongX ? 1.7 : 0.5),
      minZ: z - (alongX ? 0.5 : 1.7), maxZ: z + (alongX ? 0.5 : 1.7), minY: 0, maxY: 1.15,
    });
    cover(x + 1.6, z + 1.6); cover(x - 1.6, z - 1.6);
  }
  /** Pallet stacks and pallet goods: waist-high cover on the flank lanes. */
  function pallets(x: number, z: number, alongX: boolean) {
    for (let i = 0; i < 3; i++) {
      box(x, 0.07 + i * 0.34, z, alongX ? 2.4 : 1.2, 0.12, alongX ? 1.2 : 2.4, timberMat);
      box(x + (alongX ? 0 : 0.1) * (i % 2 ? 1 : -1), 0.2 + i * 0.34, z, alongX ? 2.2 : 1.0, 0.16, alongX ? 1.0 : 2.2, DARK, false);
    }
    box(x, 1.24, z, alongX ? 2.6 : 1.3, 0.5, alongX ? 1.3 : 2.6, bagMat);
    cover(x + (alongX ? 0 : 1.5), z + (alongX ? 1.5 : 0));
    cover(x - (alongX ? 0 : 1.5), z - (alongX ? 1.5 : 0));
  }
  for (const [x, z, ax] of [[-30, 34, true], [30, -34, true], [-42, 12, false], [42, -12, false]] as const) pallets(x, z, ax);
  /**
   * Steel racking inside each warehouse: the interior is not an empty box. It hugs
   * the OUTER wall on purpose — an aisle of racking along the inner wall would wall
   * off the 3.2 m doorways that connect each building to the central corridor.
   */
  for (const cx of WAREHOUSE.centres) {
    const rx = cx + Math.sign(cx) * 6.4;
    for (let i = 0; i < 4; i++) box(rx, 1.35, -7.5 + i * 5, 0.2, 2.7, 0.2, DARK, false);
    for (const y of [0.9, 1.8, 2.6]) box(rx, y, -0.5, 1.1, 0.1, 20, DARK, false);
    for (let i = 0; i < 5; i++) crate(rx, -6.5 + i * 3, 1.1, 0.95);
    cover(rx + Math.sign(cx) * 1.4, 6);
  }
  /** Bollards and cones mark the freight lanes the forklifts use. */
  for (let i = -2; i <= 2; i++) {
    for (const sgn of [-1, 1]) {
      cyl(0.22, 0.26, 0.9, 8, HAZARD, sgn * 4.6, 0.45, i * 7.5 + sgn * 2);
      cyl(0.22, 0.26, 0.9, 8, HAZARD, i * 7.5 + sgn * 2, 0.45, sgn * 4.6);
    }
    if (i !== 0) crate(i * 9, 0, 1.0);          // the corridor mouth stays walkable
  }
  for (const [x, z] of [[-16, 8], [16, -8], [-6, -22], [6, 22]] as const) {
    shape(new THREE.ConeGeometry(0.3, 0.7, 8), HAZARD, x, 0.35, z);
    cover(x + 1.0, z);
  }

  /* ==================== MERGE + BVH ==================== */
  for (const patch of patches) {
    const g = new THREE.PlaneGeometry(patch.x1 - patch.x0, patch.z1 - patch.z0);
    const uv = g.getAttribute('uv');
    const map = (patch.m as THREE.MeshStandardMaterial).map;
    if (map) for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (patch.x0 + uv.getX(i) * (patch.x1 - patch.x0)) / 4 / map.repeat.x,
        (patch.z0 + uv.getY(i) * (patch.z1 - patch.z0)) / 4 / map.repeat.y);
    }
    shape(g, patch.m, (patch.x0 + patch.x1) / 2, patch.y, (patch.z0 + patch.z1) / 2, -Math.PI / 2);
  }
  for (const [m, geos] of geosByMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const g of geos) g.dispose();
    (merged as unknown as { computeBoundsTree(): void }).computeBoundsTree();
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    occluders.push(mesh);
  }
  scene.add(group);
  group.updateMatrixWorld(true);

  const groundHeight = () => 0;
  return {
    group, solids, occluders, coverNodes,
    playerSpawn: new THREE.Vector3(...TDM_SPAWNS.alpha[2]),
    interiors, concrete, wood, half, lightSpots,
    windows: [], glass: null,
    groundHeight, navigationHeight: groundHeight,
    detonate: () => false,
    changed: false,
    landmarks, overlooks,
    breakGlass: () => null,
  };
}
