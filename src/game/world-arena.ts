// Recoil FPS — Warehouse TDM arena (PUBG-style dual warehouses)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterials, type TextureSet } from './textures';
import type { AABB, World } from './world';

const HALF = 58;

export function buildArenaWorld(scene: THREE.Scene, materials?: TextureSet): World {
  const group = new THREE.Group();
  const solids: AABB[] = [];
  const occluders: THREE.Object3D[] = [];
  const coverNodes: THREE.Vector3[] = [];
  const interiors: AABB[] = [];
  const concrete: AABB[] = [];
  const wood: AABB[] = [];
  const lightSpots: THREE.Vector3[] = [];
  const M: TextureSet = materials ?? getMaterials();
  let geoByMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const landmarks: World['landmarks'] = [];
  const overlooks: World['overlooks'] = [];
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);

  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const col = (hex: number, rough = 0.85, metal = 0) => {
    const k = `${hex}-${rough}-${metal}`;
    let m = matCache.get(k);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }); matCache.set(k, m); }
    return m;
  };
  const METAL = col(0x3A3E42, 0.45, 0.75);
  const RUST = col(0x6A4A32, 0.7, 0.4);
  const CONC = M.concrete;
  const accent = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.83 });

  function push(geo: THREE.BufferGeometry, m: THREE.Material) {
    if (geo.index) { const indexed = geo; geo = indexed.toNonIndexed(); indexed.dispose(); }
    if (m instanceof THREE.MeshStandardMaterial && !m.map && [...matCache.values()].includes(m)) {
      const c = m.color, colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      m = accent;
    }
    let arr = geoByMat.get(m);
    if (!arr) { arr = []; geoByMat.set(m, arr); }
    arr.push(geo);
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
    if (collide) solids.push({ minX: cx - w / 2, minY: cy - h / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxY: cy + h / 2, maxZ: cz + d / 2 });
  }
  function shape(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(new THREE.Euler(rx, ry, rz));
    _m4.compose(new THREE.Vector3(x, y, z), _q, _s);
    geo.applyMatrix4(_m4);
    push(geo, m);
  }
  function ground(x: number, z: number, w: number, d: number, m: THREE.Material, y = 0.02) {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.getAttribute('uv'), map = (m as THREE.MeshStandardMaterial).map;
    if (map) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 4 / map.repeat.x, uv.getY(i) * d / 4 / map.repeat.y);
    shape(g, m, x, y, z, -Math.PI / 2);
  }
  function cover(x: number, z: number, y = 0) { coverNodes.push(new THREE.Vector3(x, y, z)); }

  // Floor
  ground(0, 0, HALF * 2 + 4, HALF * 2 + 4, CONC, 0.01);
  concrete.push({ minX: -HALF, minY: -1, minZ: -HALF, maxX: HALF, maxY: 0.2, maxZ: HALF });
  ground(0, 22, 28, 18, M.asphalt, 0.025);
  ground(0, -22, 28, 18, M.asphalt, 0.025);
  ground(-28, 0, 16, 40, M.terracePavers ?? CONC, 0.03);
  ground(28, 0, 16, 40, M.terracePavers ?? CONC, 0.03);

  // Outer 6m walls
  const wallH = 6, thick = 1.2;
  box(0, wallH / 2, -HALF, HALF * 2, wallH, thick, CONC);
  box(0, wallH / 2, HALF, HALF * 2, wallH, thick, CONC);
  box(-HALF, wallH / 2, 0, thick, wallH, HALF * 2, CONC);
  box(HALF, wallH / 2, 0, thick, wallH, HALF * 2, CONC);

  // Dual warehouses 16x22, 5.5m, side by side along X, connected by 4x6 corridor
  function warehouse(cx: number, cz: number) {
    const w = 16, d = 22, h = 5.5;
    // walls with large doors on long sides (Z)
    const doorW = 3.2, doorH = 3.2;
    // north/south walls
    const z0 = cz - d / 2, z1 = cz + d / 2, x0 = cx - w / 2, x1 = cx + w / 2;
    // north wall split around door
    box(cx - (doorW / 2 + (w - doorW) / 4), h / 2, z0, (w - doorW) / 2, h, 0.45, METAL);
    box(cx + (doorW / 2 + (w - doorW) / 4), h / 2, z0, (w - doorW) / 2, h, 0.45, METAL);
    box(cx, doorH + (h - doorH) / 2, z0, doorW, h - doorH, 0.45, METAL);
    box(cx - (doorW / 2 + (w - doorW) / 4), h / 2, z1, (w - doorW) / 2, h, 0.45, METAL);
    box(cx + (doorW / 2 + (w - doorW) / 4), h / 2, z1, (w - doorW) / 2, h, 0.45, METAL);
    box(cx, doorH + (h - doorH) / 2, z1, doorW, h - doorH, 0.45, METAL);
    box(x0, h / 2, cz, 0.45, h, d, METAL);
    box(x1, h / 2, cz, 0.45, h, d, METAL);
    box(cx, h + 0.12, cz, w + 0.6, 0.24, d + 0.6, RUST);
    // interior beams
    for (const bx of [cx - 4, cx, cx + 4]) box(bx, h - 0.4, cz, 0.18, 0.22, d - 1, METAL, false);
    // 3 crates
    for (const [ox, oz] of [[-4, -5], [3, 2], [-2, 6]] as const) {
      box(cx + ox, 0.7, cz + oz, 1.6, 1.4, 1.6, M.wood);
      cover(cx + ox + 1.4, cz + oz);
      cover(cx + ox - 1.4, cz + oz);
    }
    ground(cx, cz, w - 1, d - 1, CONC, 0.04);
    interiors.push({ minX: x0, minY: 0, minZ: z0, maxX: x1, maxY: h + 1, maxZ: z1 });
    lightSpots.push(new THREE.Vector3(cx, 3.2, cz));
    overlooks.push({
      name: 'Warehouse roof',
      at: new THREE.Vector3(cx, h + 0.3, cz),
      approach: new THREE.Vector3(cx, 0, cz + d / 2 + 2),
      route: [new THREE.Vector3(cx, h + 0.3, cz)],
    });
    cover(cx, z0 - 1.5); cover(cx, z1 + 1.5);
  }
  warehouse(-8.5, 0);
  warehouse(8.5, 0);
  // connecting corridor 4x6
  box(0, 2.6, -3.2, 4, 5.2, 0.35, METAL);
  box(0, 2.6, 3.2, 4, 5.2, 0.35, METAL);
  box(0, 5.35, 0, 4.2, 0.25, 6.6, RUST);
  ground(0, 0, 4, 6, CONC, 0.045);
  landmarks.push({ name: 'Twin warehouses', at: new THREE.Vector3(0, 6, 0) });

  // U-shaped barriers 1.8m, back 3.2 + sides 2.2
  function uBarrier(x: number, z: number, yaw: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const put = (lx: number, lz: number, w: number, d: number) => {
      const wx = x + lx * c - lz * s, wz = z + lx * s + lz * c;
      box(wx, 0.9, wz, Math.abs(c) > 0.7 ? w : d, 1.8, Math.abs(c) > 0.7 ? d : w, CONC);
      cover(wx + c * 1.4, wz + s * 1.4);
    };
    put(0, 0, 3.2, 0.4); // back
    put(-1.4, 1.1, 0.4, 2.2);
    put(1.4, 1.1, 0.4, 2.2);
  }
  uBarrier(0, 38, 0);
  uBarrier(0, -38, Math.PI);
  uBarrier(-22, 18, Math.PI / 2);
  uBarrier(22, 18, -Math.PI / 2);
  uBarrier(-22, -18, Math.PI / 2);
  uBarrier(22, -18, -Math.PI / 2);
  uBarrier(-16, 0, Math.PI / 2);
  uBarrier(16, 0, -Math.PI / 2);

  // Shipping containers 2.5 x 2.6 x 6.2
  function container(x: number, z: number, yaw = 0, stacked = false) {
    const alongX = Math.abs(Math.cos(yaw)) > 0.5;
    const w = alongX ? 6.2 : 2.5, d = alongX ? 2.5 : 6.2;
    box(x, 1.3, z, w, 2.6, d, stacked ? RUST : METAL);
    cover(x + (alongX ? 0 : 2.2), z + (alongX ? 2.2 : 0));
    cover(x - (alongX ? 0 : 2.2), z - (alongX ? 2.2 : 0));
    if (stacked) {
      box(x, 3.95, z, w, 2.6, d, METAL);
      overlooks.push({
        name: 'Container stack',
        at: new THREE.Vector3(x, 5.3, z),
        approach: new THREE.Vector3(x + 4, 0, z),
        route: [new THREE.Vector3(x, 5.3, z)],
      });
    }
  }
  container(-32, 28, 0);
  container(32, 28, 0, true);
  container(-32, -28, Math.PI / 2, true);
  container(32, -28, Math.PI / 2);
  container(-45, 0, Math.PI / 2);
  container(45, 0, Math.PI / 2, true);
  container(-32, 8, 0);
  container(32, -8, 0);

  // Wooden crates 1.2 cubes
  for (const [x, z] of [[-10, 16], [10, 16], [-10, -16], [10, -16], [0, 20], [0, -20], [18, 8], [-18, -8]] as const) {
    box(x, 0.6, z, 1.2, 1.2, 1.2, M.wood);
    cover(x + 1.3, z); cover(x - 1.3, z);
  }
  // Wooden planks
  for (const [x, z, along] of [[-40, 18, true], [40, -18, true], [-40, -18, false], [40, 18, false]] as const) {
    box(x, 0.6, z, along ? 2.0 : 0.4, 1.2, along ? 0.4 : 2.0, M.wood);
    cover(x, z + 1.4);
  }

  // Sandbags at spawns
  function sandbags(x: number, z: number, alongX = true) {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
      const offset = (i - 1.5) * 0.9 + (row % 2) * 0.15;
      box(x + (alongX ? offset : 0), 0.18 + row * 0.31, z + (alongX ? 0 : offset), alongX ? 0.86 : 0.65, 0.32, alongX ? 0.65 : 0.86, M.sandbag);
    }
    cover(x + (alongX ? 0 : 1.4), z + (alongX ? 1.4 : 0));
  }
  sandbags(0, 44, true);
  sandbags(-8, 42, true);
  sandbags(8, 42, true);
  sandbags(0, -44, true);
  sandbags(-8, -42, true);
  sandbags(8, -42, true);

  // Extra mid cover
  box(-6, 0.55, 12, 2.4, 1.1, 0.45, CONC);
  box(6, 0.55, -12, 2.4, 1.1, 0.45, CONC);
  cover(-6, 13.5); cover(6, -13.5);

  lightSpots.push(new THREE.Vector3(0, 4, 30), new THREE.Vector3(0, 4, -30), new THREE.Vector3(-30, 4, 0), new THREE.Vector3(30, 4, 0), new THREE.Vector3(0, 5, 0));

  for (const [m, geos] of geoByMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const g of geos) g.dispose();
    (merged as unknown as { computeBoundsTree(): void }).computeBoundsTree?.();
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    occluders.push(mesh);
  }

  const validCover = coverNodes.filter(p => !solids.some(b => b.minY < 1.7 && b.maxY > 0.34 && p.x + 0.4 > b.minX && p.x - 0.4 < b.maxX && p.z + 0.4 > b.minZ && p.z - 0.4 < b.maxZ));
  coverNodes.length = 0;
  coverNodes.push(...validCover);

  const playerSpawn = new THREE.Vector3(0, 0, 42);
  scene.add(group);
  group.updateMatrixWorld(true);
  const groundHeight = (_x: number, _z: number) => 0;
  return {
    group, solids, occluders, coverNodes, playerSpawn, interiors, concrete, wood, half: HALF,
    lightSpots, windows: [], glass: null, groundHeight, navigationHeight: groundHeight,
    detonate: () => false, get changed() { return false; }, landmarks, overlooks,
    breakGlass: () => null,
  };
}
