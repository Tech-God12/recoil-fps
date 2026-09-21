// Recoil FPS — DE_DUSTYARD: the CS2-style competitive map.
//
// A 144 × 144 m sun-baked desert compound laid out on the classic Dust2 flow,
// simplified to three lanes between two spawns:
//
//   north (z −58)  ALPHA / CT spawn  → exits: west junction to A Long, mid gate, B doors
//   west           A LONG            → 4 m-waisted corridor along the west wall
//   centre         MID               → Mid Doors (3 m gap), catwalk terrace 2.5 m to A Short
//   east           B TUNNELS         → 5 m corridor, 90° turn into the B site mouth
//   northwest      A SITE (−28,−28)  → 14 × 14 m warehouse, plant inside
//   northeast      B SITE ( 28,−28)  → open L of containers, plant among them
//   south (z +58)  BRAVO / T spawn   → two exits: outside long (west), tunnels (east)
//
// Flat ground (groundHeight === 0) so the 1 m NavGrid is exact, an intentional
// cover object at every angle (spec: "no open death field"), 14 m buy-zone discs
// at both spawns, painted A/B letters on the bombsites, and everything merged
// into one mesh per material with a BVH for cheap raycasts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getMaterials, type TextureSet } from '../textures';
import type { AABB, World } from '../world';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree ??= computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree?: typeof disposeBoundsTree }).disposeBoundsTree ??= disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const DUSTYARD_HALF = 72;
const WALL_H = 8, WALL_T = 2;                 // outer shell
const MASS_H = 6;                             // city-block filler buildings

export type SpawnPoint = [number, number, number];

/** Team spawns — alpha (CT) north, bravo (T) south. Five per side on a shallow arc. */
export const CS_SPAWNS: Record<'alpha' | 'bravo', readonly SpawnPoint[]> = {
  alpha: [[0, 0, -58], [-6, 0, -60], [6, 0, -60], [-12, 0, -57], [12, 0, -57]],
  bravo: [[0, 0, 58], [-6, 0, 60], [6, 0, 60], [-12, 0, 57], [12, 0, 57]],
};

/** 14 m buy zones: purchases only work inside your disc, during freeze time. */
export const CS_BUY_ZONES: Record<'alpha' | 'bravo', { x: number; z: number; r: number }> = {
  alpha: { x: 0, z: -61, r: 14 },
  bravo: { x: 0, z: 61, r: 14 },
};

/** Bombsites — 14 × 14 m planting triggers, exactly the spec's footprint. */
export interface Bombsite { name: 'A' | 'B'; x: number; z: number; bounds: AABB }
export const DUSTYARD_SITES: readonly Bombsite[] = [
  { name: 'A', x: -28, z: -28, bounds: { minX: -35, minY: 0, minZ: -35, maxX: -21, maxY: 5, maxZ: -21 } },
  { name: 'B', x: 28, z: -28, bounds: { minX: 21, minY: 0, minZ: -35, maxX: 35, maxY: 5, maxZ: -21 } },
];

/** Callout anchors the bots navigate between and the HUD can name. */
export const DUSTYARD_WAYPOINTS = {
  aLong: [-65, 0, 10], longJunction: [-52, 0, -32], aSite: [-28, 0, -28],
  aShort: [-10, 0, -34], midDoors: [0, 0, 0], midNorth: [0, 0, -30], midSouth: [0, 0, 30],
  bDoors: [17.5, 0, -50], bSite: [28, 0, -28], bTunnels: [61, 0, 8], tunnelsMouth: [48, 0, -20],
  tStrip: [0, 0, 46], southWalk: [-44, 0, 64], eastWalk: [40, 0, 64],
} as const;

/** Site-adjacent hold spots so defenders never stack in one pile. */
export const SITE_HOLDS = {
  alpha: [[-24, 0, -36], [-33, 0, -22], [32, 0, -24], [20, 0, -36], [0, 0, -30], [-10, 0, -34]],
  bravo: [[-24, 0, -20], [-32, 0, -36], [24, 0, -20], [33, 0, -34], [0, 0, 34], [-6, 0, 46]],
} as const;

export function buildDustyard(scene: THREE.Scene, materials?: TextureSet): World {
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

  const half = DUSTYARD_HALF;
  const dustMat = M.concrete;
  const laneMat = M.asphalt ?? M.concrete;
  const blockMat = M.adobeBrick;
  const paverMat = M.terracePavers ?? M.plaza;
  const wallMat = M.stoneBlock ?? M.adobeBrick;
  const crateMat = M.roughTimber ?? M.wood;
  const bagMat = M.sandbag;
  const metalMat = M.corrugatedMetal ?? M.rustedMetal;

  // ---- accent materials (shared instances so painted details merge) ----
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
  const HAZARD = col(0xC9A227, 0.75), CT_BLUE = col(0x2C5F8E, 0.7), T_RED = col(0x8E3A2A, 0.7);
  const DARK = col(0x24262A, 0.65, 0.25), PAINT = col(0xE6E2D8, 0.7);
  const GLOW = col(0xFFE2A8, 0.4, 0, 2.4);
  const CONTAINERS = [col(0x2F6E7A, 0.7, 0.15), col(0x9A5330, 0.72, 0.15), col(0x5C6B3A, 0.75, 0.12)];
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
      if (m === crateMat) wood.push(aabb);
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

  // ---- ground decals: newest plane wins, incumbents are carved up ----
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
  function coverRing(x: number, z: number, w: number, d: number, y = 0) {
    cover(x - w / 2 - 0.9, z, y); cover(x + w / 2 + 0.9, z, y);
    cover(x, z - d / 2 - 0.9, y); cover(x, z + d / 2 + 0.9, y);
  }

  /* ==================== GROUND & LANES ==================== */
  ground(0, 0, half * 2 + 8, half * 2 + 8, dustMat, 0);
  // The three lanes read as beaten tracks; sites get paved aprons.
  ground(-65, 16, 10, 84, laneMat, 0.025);              // A Long
  ground(0, 0, 10, 88, laneMat, 0.025);                 // Mid
  ground(61, 17, 6, 82, laneMat, 0.025);                // B Tunnels
  ground(49, -20, 30, 8, laneMat, 0.025);               // tunnels turn
  ground(-9.5, -34, 13, 20, laneMat, 0.025);            // A Short
  ground(-53, -40, 36, 34, laneMat, 0.02);              // long junction
  ground(17.5, -49, 9, 16, laneMat, 0.025);             // B doors
  ground(-45, 64, 52, 14, laneMat, 0.02);               // south walk
  ground(44, 64, 54, 14, laneMat, 0.02);                // east walk
  ground(-28, -28, 32, 32, paverMat, 0.03);             // A site apron
  ground(28, -28, 32, 32, paverMat, 0.03);              // B site apron
  ground(0, -62, 46, 18, paverMat, 0.03);               // CT pad
  ground(0, 62, 46, 18, paverMat, 0.03);                // T pad
  // Hazard chevrons mark each spawn exit and the long dash so lanes read at a glance.
  for (let i = 0; i < 7; i++) ground(-65, 40 - i * 5, 0.5, 2.2, HAZARD, 0.05);
  for (let i = 0; i < 5; i++) { ground(-14 + i * 4, 51, 2, 0.5, HAZARD, 0.05); ground(14 - i * 4, -51, 2, 0.5, HAZARD, 0.05); }
  for (const [x, z, w, d] of [[-4, 0, 0.5, 8], [4, 0, 0.5, 8]] as const) ground(x, z, w, d, PAINT, 0.05);

  /* ==================== OUTER SHELL (8 m concrete) ==================== */
  for (const side of [-1, 1]) {
    box(side * (half - WALL_T / 2), WALL_H / 2, 0, WALL_T, WALL_H, half * 2, wallMat);
    box(0, WALL_H / 2, side * (half - WALL_T / 2), half * 2, WALL_H, WALL_T, wallMat);
  }
  // Buttresses break the wall run and give the perimeter a silhouette.
  for (let i = -3; i <= 3; i++) for (const side of [-1, 1]) {
    box(side * (half - 2.6), 2, i * 19, 2.8, 4, 3.4, blockMat);
    box(i * 19, 2, side * (half - 2.6), 3.4, 4, 2.8, blockMat);
  }
  for (const side of [-1, 1]) {
    box(side * (half - 0.8), WALL_H - 1, 0, 0.3, 0.6, half * 2 - 3, HAZARD, false);
    box(0, WALL_H - 1, side * (half - 0.8), half * 2 - 3, 0.6, 0.3, HAZARD, false);
  }

  /* ==================== CITY-BLOCK MASSES (the lanes are what is left) ==================== */
  // Every mass below is the complement of the Dustyard flow map — nothing here is
  // decorative filler; each face is a wall a lane fights along.
  const mass = (x0: number, z0: number, x1: number, z1: number, h = MASS_H, m: THREE.Material = blockMat) =>
    box((x0 + x1) / 2, h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0, m);
  mass(-60, -26, -5, 44);            // central-west mega block (mid west wall, A Long east wall)
  mass(-60, -24, -44, -14);          // between junction and A site west ring
  mass(-40, -56, -5, -40);           // CT plaza south face, west of the mid gate
  mass(5, -56, 14, -44);             // between mid gate and B doors
  mass(21, -56, 70, -44);            // east of B doors
  mass(22, -70, 70, -56, 7);         // NE corner
  mass(44, -44, 58, -24);            // east of B site, west of tunnels (north of the turn)
  mass(5, -14, 36, 44);              // mid east wall / B site south
  mass(36, -16, 58, 44);             // tunnels turn south wall
  mass(-60, 36, -22, 58);            // SW block (outside long / T strip divider)
  mass(22, 36, 58, 58);              // SE block (outside tunnels / T strip divider)
  mass(64, -24, 70, 58);             // east slab — the tunnels' inner wall
  // T spawn wall row: one wide plaza, exactly two exits (west long, east tunnels)
  // plus the centre mid gate.
  box(-13, 2.5, 51, 18, 5, 2, blockMat);
  box(13, 2.5, 51, 18, 5, 2, blockMat);
  // Catwalk terrace: 2.5 m deck in A Short, stairs from Mid and from the site.
  mass(-16, -26, -5, -14, 2.5, concrete_());
  function concrete_() { return M.concrete; }

  /* ==================== COVER HELPERS ==================== */
  function crate(x: number, z: number, size = 1.3, y = 0, stacked = false) {
    const h = size;
    box(x, y + h / 2, z, size, h, size, crateMat);
    if (stacked) box(x, y + h * 1.5, z, size * 0.9, h, size * 0.9, crateMat);
    for (const dy of [0.06, h - 0.06]) box(x, y + dy, z, size + 0.06, 0.08, size + 0.06, DARK, false);
    coverRing(x, z, size, size, y);
    if (stacked) cover(x, z + size + 0.8, y + h);
  }
  function sandbags(x: number, z: number, alongX = true) {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 0.9 + (row % 2) * 0.15;
      box(x + (alongX ? off : 0), 0.18 + row * 0.31, z + (alongX ? 0 : off), alongX ? 0.86 : 0.66, 0.32, alongX ? 0.66 : 0.86, bagMat);
    }
    cover(x + (alongX ? 0 : 1.5), z + (alongX ? 1.5 : 0));
    cover(x - (alongX ? 0 : 1.5), z - (alongX ? 1.5 : 0));
  }
  /** U-shaped concrete barrier — the Dustyard signature cover piece. */
  function ubarrier(x: number, z: number, facing: 'n' | 's' | 'e' | 'w') {
    const t = 0.4, h = 1.8, back = 3.2, side = 2.2;
    if (facing === 'n' || facing === 's') {
      const zs = z + (facing === 's' ? side / 2 : -side / 2);
      box(x, h / 2, z, back, h, t, M.concrete);
      for (const s of [-1, 1]) box(x + s * (back / 2 - t / 2), h / 2, zs, t, h, side, M.concrete);
      box(x, h + 0.06, z, back + 0.2, 0.12, t + 0.2, DARK, false);
      cover(x, z + (facing === 's' ? side + 0.8 : -side - 0.8));
      cover(x + back / 2 + 0.9, z + (facing === 's' ? side : -side));
      cover(x - back / 2 - 0.9, z + (facing === 's' ? side : -side));
    } else {
      const xs = x + (facing === 'e' ? side / 2 : -side / 2);
      box(x, h / 2, z, t, h, back, M.concrete);
      for (const s of [-1, 1]) box(xs, h / 2, z + s * (back / 2 - t / 2), side, h, t, M.concrete);
      box(x, h + 0.06, z, t + 0.2, 0.12, back + 0.2, DARK, false);
      cover(x + (facing === 'e' ? side + 0.8 : -side - 0.8), z);
      cover(x + (facing === 'e' ? side : -side), z - back / 2 - 0.9);
      cover(x + (facing === 'e' ? side : -side), z + back / 2 + 0.9);
    }
  }
  /** Wrecked sedan — the spec's 2 × 4 m metal-box car. */
  function car(x: number, z: number, alongZ = true, mat = metalMat) {
    const w = alongZ ? 2 : 4, d = alongZ ? 4 : 2;
    box(x, 0.62, z, w, 1.24, d, mat);
    box(x, 1.42, z, w - 0.3, 0.5, d - 1.1, col(0x3A4A52, 0.4, 0.3));
    for (const [ox, oz] of alongZ ? [[-1.05, -1.3], [1.05, -1.3], [-1.05, 1.3], [1.05, 1.3]] : [[-1.3, -1.05], [1.3, -1.05], [-1.3, 1.05], [1.3, 1.05]]) {
      cyl(0.34, 0.34, 0.24, 10, DARK, x + ox, 0.17, z + oz);
    }
    coverRing(x, z, w, d);
  }
  function container(x: number, z: number, alongZ: boolean, mat: THREE.Material, stacked = false) {
    const CW = 2.5, CH = 2.6, CL = 6.2;
    const w = alongZ ? CW : CL, d = alongZ ? CL : CW;
    const body = (yb: number) => {
      box(x, yb + CH / 2, z, w, CH, d, mat);
      for (let i = 0; i < 7; i++) {
        const off = -CL / 2 + 0.45 + i * 0.9;
        if (alongZ) box(x + CW / 2 + 0.03, yb + CH / 2, z + off, 0.06, CH - 0.35, 0.42, DARK, false);
        else box(x + off, yb + CH / 2, z + CW / 2 + 0.03, 0.42, CH - 0.35, 0.06, DARK, false);
      }
    };
    body(0);
    if (stacked) body(CH);
    box(x, (stacked ? 2 * CH : CH) + 0.06, z, w + 0.14, 0.16, d + 0.14, stacked ? HAZARD : DARK, false);
    coverRing(x, z, w, d);
    if (stacked) { cover(x, z + 3.4, 2 * CH); cover(x, z - 3.4, 2 * CH); }
  }
  function stairs(x: number, z: number, height: number, width = 3, axis: 'x' | 'z' = 'z', dir = 1) {
    const n = Math.ceil(height / 0.28), run = height * 2.5 / n;
    for (let i = 0; i < n; i++) {
      const h = height * (n - i) / n;
      const px = axis === 'x' ? x + dir * i * run : x;
      const pz = axis === 'z' ? z + dir * i * run : z;
      box(px, h / 2, pz, axis === 'x' ? run + 0.04 : width, h, axis === 'z' ? run + 0.04 : width, M.concrete);
    }
  }

  /* ==================== MID DOORS ==================== */
  // Wall across mid with the spec's 3 m gap. The header keeps it a DOORWAY.
  box(-3.25, 2, 0, 3.5, 4, 0.6, wallMat);
  box(3.25, 2, 0, 3.5, 4, 0.6, wallMat);
  box(0, 3.65, 0, 3.2, 0.7, 0.6, wallMat);
  for (const s of [-1, 1]) box(s * 2.4, 3.4, 0.35, 0.9, 0.5, 0.1, HAZARD, false);
  crate(0, -16, 1.4); crate(0, 18, 1.4);
  sandbags(0, -8, true);
  cover(-1.8, 1.6); cover(1.8, -1.6);
  landmarks.push({ name: 'Mid Doors', at: new THREE.Vector3(0, 4.4, 0) });

  /* ==================== CATWALK (A SHORT) ==================== */
  // Terrace deck at 2.5 m (built above), railings, and two stair runs.
  for (const [rx, rz, w, d] of [[-10.5, -26.15, 11, 0.3], [-15.85, -20, 0.3, 12], [-5.15, -20, 0.3, 12]] as const) {
    box(rx, 2.95, rz, w, 0.9, d, DARK);
  }
  for (const [px, pz] of [[-15, -25.9], [-12, -25.9], [-9, -25.9], [-6, -25.9], [-15.7, -22], [-15.7, -18], [-5.3, -22], [-5.3, -18]] as const) {
    box(px, 3.35, pz, 0.12, 1.1, 0.12, DARK, false);
  }
  stairs(-6.8, -24, 2.5, 4, 'x', -1);          // from Mid, climbing west onto the deck
  stairs(-17.6, -20, 2.5, 4, 'x', -1);         // from the A site floor, climbing east
  cover(-8, -30); cover(-12, -22, 2.5);
  crate(-11, -40, 1.3); crate(-13.4, -31, 1.3);
  landmarks.push({ name: 'Catwalk', at: new THREE.Vector3(-10, 4.4, -20) });
  overlooks.push({
    name: 'Catwalk', at: new THREE.Vector3(-10.5, 2.5, -20),
    approach: new THREE.Vector3(-4, 0, -20),
    route: [new THREE.Vector3(-6.8, 2.5, -24), new THREE.Vector3(-10.5, 2.5, -20)],
  });

  /* ==================== A SITE (NW) ==================== */
  // 14 × 14 m warehouse shell, 5 m tall: door gaps west (from Long/junction),
  // north (from CT ramp), east (from A Short); the south wall stays solid.
  const AW = 14, AH = 5, AT = 0.5, ax = -28, az = -28;
  const whSeg = (x: number, z: number, w: number, d: number) => box(x, AH / 2, z, w, AH, d, metalMat);
  const whLintel = (x: number, z: number, w: number, d: number) => box(x, 4.3, z, w, 1.4, d, metalMat, false);
  // west wall: gap z −31…−25
  whSeg(ax - AW / 2 + AT / 2, -33, AT, 4);
  whSeg(ax - AW / 2 + AT / 2, -23, AT, 4);
  whLintel(ax - AW / 2 + AT / 2, -28, AT + 0.2, 6);
  // north wall: gap x −31…−25
  whSeg(-33, az - AW / 2 + AT / 2, 4, AT);
  whSeg(-23, az - AW / 2 + AT / 2, 4, AT);
  whLintel(-28, az - AW / 2 + AT / 2, 6, AT + 0.2);
  // east wall: gap z −29…−23
  whSeg(ax + AW / 2 - AT / 2, -32, AT, 6);
  whSeg(ax + AW / 2 - AT / 2, -22, AT, 2);
  whLintel(ax + AW / 2 - AT / 2, -26, AT + 0.2, 6);
  // south wall solid
  whSeg(ax, az + AW / 2 - AT / 2, AW - AT, AT);
  // roof deck + lip
  box(ax, AH + 0.12, az, AW + 0.8, 0.24, AW + 0.8, metalMat);
  for (const [lx, lz, lw, ld] of [[ax, az - AW / 2 - 0.35, AW + 0.8, 0.3], [ax, az + AW / 2 + 0.35, AW + 0.8, 0.3], [ax - AW / 2 - 0.35, az, 0.3, AW + 0.8], [ax + AW / 2 + 0.35, az, 0.3, AW + 0.8]] as const) {
    box(lx, AH + 0.45, lz, lw, 0.5, ld, metalMat);
  }
  // interior: two stacked crates, U-barrier covering the plant, the car
  crate(ax - 0.6, az - 4.6, 1.4, 0, true); crate(ax + 1, az - 4.6, 1.4);
  ubarrier(ax + 2.6, az + 4.4, 's');
  car(ax - 4.6, az + 1.2, false);
  cyl(0.34, 0.34, 0.95, 12, CONTAINERS[2], ax + 4.4, 0.48, az - 1.6);
  cyl(0.3, 0.3, 0.8, 10, CONTAINERS[0], ax + 4.9, 0.4, az - 0.4);
  lightSpots.push(new THREE.Vector3(ax, 4.2, az));
  cover(ax - 8, az); cover(ax + 8, az); cover(ax, az - 9); cover(ax, az + 9);
  interiors.push({ minX: ax - AW / 2, minY: 0, minZ: az - AW / 2, maxX: ax + AW / 2, maxY: AH + 1, maxZ: az + AW / 2 });
  landmarks.push({ name: 'A Site', at: new THREE.Vector3(ax, AH + 1.2, az) });
  // site ring cover (the approach lanes fight through this)
  crate(-19, -18, 1.3); crate(-40, -18, 1.3); sandbags(-41, -34, false); sandbags(-24, -40, true);
  crate(-48, -36, 1.3); crate(-46.6, -36, 1.3);
  ubarrier(-52, -28, 'n');
  car(-64.5, -44, true);

  /* ==================== B SITE (NE) ==================== */
  container(22, -25, true, CONTAINERS[0]);
  container(22, -32.4, true, CONTAINERS[1]);
  container(28.5, -37, false, CONTAINERS[2]);
  sandbags(33, -27, true);
  crate(18, -20, 1.3); crate(32.5, -21.5, 1.3);
  cyl(0.36, 0.36, 1, 12, CONTAINERS[1], 36, 0.5, -30);
  lightSpots.push(new THREE.Vector3(28, 4.2, -28));
  cover(22, -21); cover(30, -33); cover(37, -24); cover(18, -38);
  landmarks.push({ name: 'B Site', at: new THREE.Vector3(28, 3.2, -28) });
  // B doors approach cover
  crate(17.5, -52, 1.3); sandbags(11, -49, true);

  /* ==================== A LONG ==================== */
  ubarrier(-65, 24, 'e');
  car(-65.2, 8, true);
  ubarrier(-65, -12, 'e');
  crate(-66.8, 40, 1.3); crate(-63.4, 44, 1.3);
  sandbags(-64, 54, true);
  cover(-64, 0); cover(-66, 16); cover(-63, 30);
  landmarks.push({ name: 'A Long', at: new THREE.Vector3(-65, 5, 10) });

  /* ==================== B TUNNELS ==================== */
  // The 3 m-tall tunnel walls are the corridor masses themselves; this adds the
  // roofed feel at the corner with a turn crate (spec) plus junction clutter.
  box(61, 1.5, -8, 6, 3, 6, blockMat);           // corner pier — forces the 90°
  crate(61, -20, 1.3);
  crate(59.5, 26, 1.2); cyl(0.4, 0.42, 1.05, 12, CONTAINERS[0], 62.5, 0.52, 14);
  lightSpots.push(new THREE.Vector3(61, 2.6, 8));
  cover(59, -18); cover(62, 2); cover(60, 22);
  landmarks.push({ name: 'B Tunnels', at: new THREE.Vector3(61, 4.5, 8) });

  /* ==================== CT & T PADS ==================== */
  sandbags(-8, -54, true); sandbags(9, -55, true);
  crate(-16, -62, 1.3); crate(7, -64, 1.3);
  sandbags(-9, 55, true); sandbags(10, 54, true);
  crate(-15, 63, 1.3); crate(14, 64, 1.3);
  for (const [x, z, mat] of [[-14, -50, CT_BLUE], [14, -50, CT_BLUE], [-14, 51, T_RED], [14, 51, T_RED]] as const) {
    box(x, 1.6, z, 0.12, 3.2, 0.12, DARK, false);
    box(x, 2.7, z, 1.5, 1.0, 0.09, mat, false);
  }
  crate(-34, 64, 1.3); car(-48, 65, true);
  crate(34, 64, 1.3); car(50, 66, true);
  sandbags(-44, 58, true); sandbags(44, 58, true);
  ubarrier(0, 45, 's'); crate(-8, 47, 1.2); crate(8, 47, 1.2);

  /* ==================== BUY ZONES & SITE LETTERS ==================== */
  const zoneDisc = (x: number, z: number, mat: THREE.Material) => {
    shape(new THREE.CircleGeometry(14, 40), mat, x, 0.035, z, -Math.PI / 2);
    shape(new THREE.RingGeometry(13.4, 14, 48), col(0xE6E2D8, 0.6), x, 0.045, z, -Math.PI / 2);
  };
  const buyBlue = new THREE.MeshStandardMaterial({ color: 0x2C5F8E, transparent: true, opacity: 0.32, roughness: 0.9, depthWrite: false });
  const buyRed = new THREE.MeshStandardMaterial({ color: 0x8E3A2A, transparent: true, opacity: 0.32, roughness: 0.9, depthWrite: false });
  zoneDisc(CS_BUY_ZONES.alpha.x, CS_BUY_ZONES.alpha.z, buyBlue);
  zoneDisc(CS_BUY_ZONES.bravo.x, CS_BUY_ZONES.bravo.z, buyRed);

  /** Painted site letters — a canvas texture on a ground quad, no collision. */
  const letterMat = (letter: string, color: string) => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.translate(128, 128);
    ctx.font = '900 190px "Arial Black", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(letter, 0, 8);
    ctx.fillStyle = color;
    ctx.fillText(letter, 0, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  };
  for (const site of DUSTYARD_SITES) {
    shape(new THREE.PlaneGeometry(11, 11), letterMat(site.name, site.name === 'A' ? '#E8A33D' : '#4FA3D8'),
      site.x, 0.05, site.z, -Math.PI / 2);
    shape(new THREE.RingGeometry(6.7, 7, 40), PAINT, site.x, 0.045, site.z, -Math.PI / 2);
  }

  /* ==================== LIGHTS & FLAVOUR ==================== */
  lightSpots.push(
    new THREE.Vector3(0, 3.4, -60), new THREE.Vector3(0, 3.4, 60),
    new THREE.Vector3(0, 3.2, -22), new THREE.Vector3(0, 3.2, 22),
    new THREE.Vector3(-65, 3, 12), new THREE.Vector3(-28, 4.2, -28),
    new THREE.Vector3(61, 2.6, 8), new THREE.Vector3(28, 4.2, -28),
  );
  // Droplight posts at the spawns and the lanes (visual bulbs only — the sun does the work).
  for (const [x, z] of [[-10, -66], [10, -66], [-10, 66], [10, 66], [-61, -20], [-61, 40], [61, -18], [61, 40], [-4, -30], [4, 30]] as const) {
    box(x, 2.6, z, 0.22, 5.2, 0.22, DARK, false);
    box(x, 5.0, z, 1.1, 0.16, 0.16, DARK, false);
    shape(new THREE.SphereGeometry(0.15, 8, 6), GLOW, x + 0.5, 4.9, z);
  }
  // Awning + barrels on the T strip, telegraph poles on the walks.
  for (let i = 0; i < 5; i++) shape(new THREE.PlaneGeometry(3.2, 2.2), col([0xB0402E, 0x2E6BA0, 0x3E7B52, 0xC7A24B, 0x8C4E86][i], 0.9), -18 + i * 9, 2.6, 43.6, -Math.PI / 2 + 0.12);
  for (const [x, z] of [[-30, 43], [-12, 43], [12, 43], [30, 43]] as const) cyl(0.4, 0.44, 1.05, 12, CONTAINERS[2], x, 0.52, z);
  for (const z of [-46, 58]) box(-69, 4, z, 0.3, 8, 0.3, DARK);

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
    playerSpawn: new THREE.Vector3(...CS_SPAWNS.alpha[0]),
    interiors, concrete, wood, half, lightSpots,
    windows: [], glass: null,
    groundHeight, navigationHeight: groundHeight,
    detonate: () => false,
    changed: false,
    landmarks, overlooks,
    breakGlass: () => null,
  };
}
