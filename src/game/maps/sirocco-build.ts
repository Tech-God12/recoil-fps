// Recoil FPS — SIROCCO geometry. Called from buildWorld() with the shared builder
// toolkit so every box lands in the same merged/BVH batches as the other maps.
//
// Building mass is derived, not hand-placed: every 1 m cell inside the perimeter
// that is not part of an authored open area becomes solid, greedily merged into
// rectangles and split into individual houses of varying height and plaster.
// Façades that face a lane get windows, shutters, doors and awnings; lanes get
// paving, props and cover; the two bomb sites get painted zones and stencils.
import * as THREE from 'three';
import type { TextureSet } from '../textures';
import type { AABB, ArenaFx, SoundTrap } from '../world';
import {
  SIROCCO_HALF, SIROCCO_OPEN, SITES, TUNNEL_ROOF, MID_DOORS, isOpen, type Rect, type FloorKind,
} from './sirocco';

export interface MapBuildApi {
  M: TextureSet;
  col: (hex: number, rough?: number, metal?: number, emissive?: number, side?: THREE.Side) => THREE.MeshStandardMaterial;
  METAL: THREE.Material; GLOW: THREE.Material; FROND: THREE.Material; ACC_TURQ: THREE.Material; ACC_TERRA: THREE.Material;
  FABRIC: THREE.Material[];
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, m: THREE.Material, collide?: boolean): void;
  shape(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number): void;
  dressing(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number): void;
  ground(x: number, z: number, w: number, d: number, m: THREE.Material, y?: number): void;
  cover(x: number, z: number): void;
  palm(x: number, z: number, s?: number): void;
  lamp(x: number, z: number): void;
  banner(x: number, z: number, y: number, color?: THREE.Material): void;
  sandbags(x: number, z: number, alongX?: boolean): void;
  terrain(size: number, inner: number): void;
  group: THREE.Group;
  solids: AABB[];
  interiors: AABB[];
  concrete: AABB[];
  lightSpots: THREE.Vector3[];
  landmarks: { name: string; at: THREE.Vector3 }[];
  soundTraps: SoundTrap[];
  arenaFx: ArenaFx;
  playerSpawn: THREE.Vector3;
  /** High detail may add only non-colliding silhouette dressing. */
  ornament: boolean;
}

/** Deterministic 0..1 hash so the town looks the same every match. */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function stencilTexture(label: string, color: string, arrow = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(30,20,10,0.35)';
  ctx.lineWidth = 6;
  ctx.font = '900 200px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (arrow) {
    ctx.font = '900 150px "Barlow Condensed", Impact, sans-serif';
    ctx.fillText(label, arrow > 0 ? 90 : 166, 128);
    ctx.beginPath();
    const x = arrow > 0 ? 170 : 86, d = arrow > 0 ? 1 : -1;
    ctx.moveTo(x - d * 20, 92); ctx.lineTo(x + d * 42, 128); ctx.lineTo(x - d * 20, 164); ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeText(label, 128, 138);
    ctx.fillText(label, 128, 138);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSirocco(api: MapBuildApi): void {
  const { M, col, box, shape, dressing, ground, cover, METAL, GLOW, FABRIC, ornament } = api;
  const H = SIROCCO_HALF;
  api.playerSpawn.set(0, 0, 35);

  const stone = M.stoneBlock ?? M.adobeBrick, brick = M.firedBrick ?? M.adobeBrick;
  const earth = M.packedEarth ?? M.adobeWall, timber = M.roughTimber ?? M.wood;
  const pavers = M.terracePavers ?? M.plaza, cobble = M.cobbleLane ?? M.plaza;
  const wallMats = [M.adobeWall, M.adobeWall2, M.whitewash, M.plaster, stone, earth, M.adobeWall, brick];
  const trimMats = [stone, M.plaster, M.whitewash, earth];
  const shutterMats = [col(0x2F6F8F, 0.8), col(0x3E8A7E, 0.8), col(0x8C3B2E, 0.85), col(0x5B4630, 0.9), col(0x2E6BA0, 0.8)];
  const recess = col(0x15130F, 0.95);
  const frameMat = col(0xCDBB98, 0.9);
  const hazard = col(0xE0A526, 0.7);
  const crateMat = timber, barrelMat = col(0x6E3B25, 0.7, 0.3), barrelBlue = col(0x2D4F6B, 0.7, 0.3);

  // Desert apron beyond the walls so the horizon is never a void.
  api.terrain(520, H + 8);
  ground(0, 0, H * 2, H * 2, M.sand, 0.012);

  // ---------------- lane floors ----------------
  const floorMat: Record<FloorKind, THREE.Material> = {
    cobble, pavers, tile: M.marketTile ?? M.tileFloor, earth, concrete: M.concrete, sand: M.sand,
  };
  const floorY: Record<FloorKind, number> = { sand: 0.018, earth: 0.024, cobble: 0.03, pavers: 0.034, tile: 0.038, concrete: 0.036 };
  for (const a of SIROCCO_OPEN) {
    const r = a.rect;
    ground((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, r.z1 - r.z0, floorMat[a.floor], floorY[a.floor]);
    if (a.floor !== 'sand' && a.floor !== 'earth') api.concrete.push({ minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1, minY: -1, maxY: 3 });
  }

  // ---------------- building mass (complement of the open areas) ----------------
  const N = H * 2;
  const solidCell = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    solidCell[j * N + i] = isOpen(-H + i + 0.5, -H + j + 0.5) ? 0 : 1;
  }
  const openAt = (x: number, z: number) => {
    const i = Math.floor(x + H), j = Math.floor(z + H);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return !solidCell[j * N + i];
  };
  const used = new Uint8Array(N * N);
  const blocks: Rect[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (!solidCell[k] || used[k]) continue;
    let w = 1;
    while (i + w < N && solidCell[k + w] && !used[k + w]) w++;
    let h = 1;
    grow: while (j + h < N) {
      for (let q = 0; q < w; q++) { const kk = (j + h) * N + i + q; if (!solidCell[kk] || used[kk]) break grow; }
      h++;
    }
    for (let dz = 0; dz < h; dz++) for (let q = 0; q < w; q++) used[(j + dz) * N + i + q] = 1;
    blocks.push({ x0: -H + i, x1: -H + i + w, z0: -H + j, z1: -H + j + h });
  }
  // Split long masses into individual houses so the skyline steps.
  const houses: Rect[] = [];
  for (const b of blocks) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const nx = Math.max(1, Math.round(w / 12)), nz = Math.max(1, Math.round(d / 12));
    for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
      houses.push({
        x0: b.x0 + Math.round((w * a) / nx), x1: b.x0 + Math.round((w * (a + 1)) / nx),
        z0: b.z0 + Math.round((d * c) / nz), z1: b.z0 + Math.round((d * (c + 1)) / nz),
      });
    }
  }

  let doorCount = 0;
  for (const hs of houses) {
    const w = hs.x1 - hs.x0, d = hs.z1 - hs.z0;
    if (w <= 0 || d <= 0) continue;
    const cx = (hs.x0 + hs.x1) / 2, cz = (hs.z0 + hs.z1) / 2;
    const r1 = hash(cx, cz), r2 = hash(cz, cx + 3.3), r3 = hash(cx * 0.7, cz * 1.3 + 9);
    // Lane-facing edge length decides how "public" the house is.
    let frontage = 0;
    for (let x = hs.x0; x < hs.x1; x++) { if (openAt(x + 0.5, hs.z0 - 0.5)) frontage++; if (openAt(x + 0.5, hs.z1 + 0.5)) frontage++; }
    for (let z = hs.z0; z < hs.z1; z++) { if (openAt(hs.x0 - 0.5, z + 0.5)) frontage++; if (openAt(hs.x1 + 0.5, z + 0.5)) frontage++; }
    const edge = Math.abs(cx) > H - 3 || Math.abs(cz) > H - 3;
    const height = edge ? 7.5 + r1 * 2 : frontage === 0 ? 4.6 + r1 * 3.5 : 5.2 + r1 * 3.6;
    const wm = wallMats[Math.floor(r2 * wallMats.length) % wallMats.length];
    box(cx, height / 2, cz, w, height, d, wm);
    // parapet + roof lip in a contrasting plaster
    const trim = trimMats[Math.floor(r3 * trimMats.length) % trimMats.length];
    box(cx, height + 0.22, cz, w + 0.24, 0.44, d + 0.24, trim, false);
    box(cx, 0.35, cz, w + 0.12, 0.7, d + 0.12, trim, false); // plinth band
    if (frontage === 0 && !edge) continue;
    // rooftop clutter on some houses (above every sightline that matters)
    if (r3 > 0.62 && w > 3 && d > 3) {
      shape(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 10), col(0xDAD4C6, 0.6, 0.2), cx + (r1 - 0.5) * (w - 2), height + 1.1, cz + (r2 - 0.5) * (d - 2));
      box(cx - (r2 - 0.5) * (w - 2), height + 0.75, cz - (r1 - 0.5) * (d - 2), 1.1, 0.7, 0.8, METAL, false);
    } else if (r3 < 0.18 && w > 4 && d > 4) {
      // stair kiosk / roof room
      box(cx, height + 1.2, cz, Math.min(3, w - 1.5), 2.4, Math.min(3, d - 1.5), wm, false);
    }
    // ---- façades: walk every edge cell, decorate runs that face open ground ----
    const sides: { along: 'x' | 'z'; fixed: number; out: number; from: number; to: number }[] = [
      { along: 'x', fixed: hs.z0, out: -1, from: hs.x0, to: hs.x1 },
      { along: 'x', fixed: hs.z1, out: 1, from: hs.x0, to: hs.x1 },
      { along: 'z', fixed: hs.x0, out: -1, from: hs.z0, to: hs.z1 },
      { along: 'z', fixed: hs.x1, out: 1, from: hs.z0, to: hs.z1 },
    ];
    for (const s of sides) {
      let runStart = -1;
      for (let t = s.from; t <= s.to; t++) {
        const facing = t < s.to && (s.along === 'x' ? openAt(t + 0.5, s.fixed + s.out * 0.5) : openAt(s.fixed + s.out * 0.5, t + 0.5));
        if (facing && runStart < 0) runStart = t;
        if (!facing && runStart >= 0) {
          if (t - runStart >= 2.4) decorateRun(s.along, s.fixed, s.out, runStart, t, height, hash(runStart, s.fixed));
          runStart = -1;
        }
      }
    }
  }

  function decorateRun(along: 'x' | 'z', fixed: number, out: number, a: number, b: number, height: number, seed: number) {
    const len = b - a;
    const n = Math.max(1, Math.floor(len / 3.4));
    const step = len / n;
    const ry = along === 'x' ? (out > 0 ? 0 : Math.PI) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
    const place = (t: number, off: number): [number, number] => along === 'x' ? [t, fixed + out * off] : [fixed + out * off, t];
    const shutter = shutterMats[Math.floor(seed * shutterMats.length) % shutterMats.length];
    for (let i = 0; i < n; i++) {
      const t = a + step * (i + 0.5);
      const pick = hash(t, fixed + seed * 10);
      const door = (i === Math.floor(n / 2) && len > 6 && pick < 0.55) || (n === 1 && pick < 0.3);
      if (door) {
        doorCount++;
        const blue = doorCount % 3 === 0;
        const [dx, dz] = place(t, 0.05);
        shape(new THREE.BoxGeometry(1.5, 2.45, 0.1), blue ? shutterMats[4] : timber, dx, 1.225, dz, 0, ry);
        const [fx, fz] = place(t, 0.07);
        shape(new THREE.BoxGeometry(1.9, 0.22, 0.14), frameMat, fx, 2.56, fz, 0, ry);
        // plank seams on the door leaf
        for (const o of [-0.38, 0, 0.38]) {
          const [sx, sz] = along === 'x' ? [dx + o, dz + out * 0.052] : [dx + out * 0.052, dz + o];
          dressing(new THREE.PlaneGeometry(0.03, 2.3), recess, sx, 1.2, sz, 0, ry);
        }
        if (pick < 0.32) {
          // Awning: tilt baked into the geometry first (slopes down away from the
          // wall), then yawed onto the façade — Euler order would tilt it wrongly.
          const g = new THREE.PlaneGeometry(2.3, 1.3);
          g.rotateX(-Math.PI / 2 + 0.35);
          const [ax, az] = place(t, 0.62);
          shape(g, FABRIC[Math.floor(pick * 97) % FABRIC.length], ax, 2.95, az, 0, ry, 0);
        }
      } else if (height > 3.6) {
        windowAt(t, 2.35, pick);
      }
      if (height > 6.6) windowAt(t, 5.05, hash(t + 1, fixed));
    }
    function windowAt(t: number, y: number, r: number) {
      const [wx, wz] = place(t, 0.03);
      dressing(new THREE.PlaneGeometry(0.95, 1.25), recess, wx, y, wz, 0, ry);
      const [fx, fz] = place(t, 0.05);
      shape(new THREE.BoxGeometry(1.25, 0.12, 0.16), frameMat, fx, y - 0.7, fz, 0, ry);   // sill
      shape(new THREE.BoxGeometry(1.15, 0.1, 0.1), frameMat, fx, y + 0.68, fz, 0, ry);    // lintel
      if (r < 0.7) {
        // open shutters, splayed either side of the frame
        for (const side of [-1, 1]) {
          const [sx, sz] = along === 'x' ? [wx + side * 0.78, wz + out * 0.06] : [wx + out * 0.06, wz + side * 0.78];
          shape(new THREE.BoxGeometry(0.55, 1.28, 0.05), shutter, sx, y, sz, 0, ry);
        }
      } else {
        // iron grille
        for (const o of [-0.3, 0, 0.3]) {
          const [gx, gz] = along === 'x' ? [wx + o, wz + out * 0.05] : [wx + out * 0.05, wz + o];
          shape(new THREE.BoxGeometry(0.03, 1.2, 0.03), METAL, gx, y, gz, 0, ry);
        }
      }
    }
  }

  // ---------------- props ----------------
  const crate = (x: number, z: number, s = 1.25, y = 0, rot = 0) => {
    shape(new THREE.BoxGeometry(s, s, s), crateMat, x, y + s / 2, z, 0, rot);
    // steel corner straps read as a proper shipping crate
    shape(new THREE.BoxGeometry(s + 0.02, 0.08, s + 0.02), METAL, x, y + s * 0.18, z, 0, rot);
    shape(new THREE.BoxGeometry(s + 0.02, 0.08, s + 0.02), METAL, x, y + s * 0.82, z, 0, rot);
    const e = s / 2 + (rot ? 0.15 : 0);
    api.solids.push({ minX: x - e, maxX: x + e, minY: y, maxY: y + s, minZ: z - e, maxZ: z + e });
  };
  const barrel = (x: number, z: number, blue = false) => {
    shape(new THREE.CylinderGeometry(0.34, 0.34, 1.0, 12), blue ? barrelBlue : barrelMat, x, 0.5, z);
    shape(new THREE.TorusGeometry(0.345, 0.025, 4, 14), METAL, x, 0.3, z, Math.PI / 2);
    shape(new THREE.TorusGeometry(0.345, 0.025, 4, 14), METAL, x, 0.72, z, Math.PI / 2);
    api.solids.push({ minX: x - 0.36, maxX: x + 0.36, minY: 0, maxY: 1.0, minZ: z - 0.36, maxZ: z + 0.36 });
  };
  /** Low wall / planter (collides). */
  const lowWall = (x0: number, x1: number, z0: number, z1: number, h: number, m: THREE.Material = stone) => {
    box((x0 + x1) / 2, h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0, m);
    box((x0 + x1) / 2, h + 0.05, (z0 + z1) / 2, x1 - x0 + 0.1, 0.1, z1 - z0 + 0.1, M.plaster, false);
  };
  /** Steppable 0.45 m deck. */
  const deck = (x0: number, x1: number, z0: number, z1: number, m: THREE.Material = stone) => {
    box((x0 + x1) / 2, 0.225, (z0 + z1) / 2, x1 - x0, 0.45, z1 - z0, m);
    ground((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 - 0.2, z1 - z0 - 0.2, pavers, 0.46);
  };
  const car = (x: number, z: number, alongX: boolean, paint: number) => {
    const body = col(paint, 0.55, 0.35), glass = col(0x202A30, 0.2, 0.6);
    const L = 4.3, W = 1.85;
    const [w, d] = alongX ? [L, W] : [W, L];
    box(x, 0.75, z, w, 0.9, d, body);
    const [cw, cd] = alongX ? [2.2, W - 0.12] : [W - 0.12, 2.2];
    box(x, 1.42, z, cw, 0.5, cd, glass, false);
    box(x, 1.7, z, cw - 0.1, 0.06, cd - 0.05, body, false);
    for (const u of [-1.35, 1.35]) for (const v of [-0.9, 0.9]) {
      const [wx, wz] = alongX ? [x + u, z + v] : [x + v, z + u];
      shape(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), col(0x1A1A1A, 0.9), wx, 0.34, wz, alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2);
    }
    api.solids.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: 1.72, minZ: z - d / 2, maxZ: z + d / 2 });
    cover(alongX ? x : x + (W / 2 + 0.9), alongX ? z + (W / 2 + 0.9) : z);
    cover(alongX ? x : x - (W / 2 + 0.9), alongX ? z - (W / 2 + 0.9) : z);
  };
  /** Decorative arch spanning a lane: lintel above head height + voussoirs (non-blocking for nav). */
  const gate = (alongX: boolean, pos: number, from: number, to: number, y = 3.5, m: THREE.Material = stone) => {
    const span = to - from, mid = (from + to) / 2;
    if (alongX) box(pos, y + 0.55, mid, 1.2, 1.1, span, m);
    else box(mid, y + 0.55, pos, span, 1.1, 1.2, m);
    const r = span / 2;
    for (let i = 1; i < 10; i++) {
      const a0 = (i / 10) * Math.PI;
      const px = Math.cos(a0) * r, py = Math.sin(a0) * Math.min(1.1, r * 0.35);
      const sx = alongX ? pos : mid + px, sz = alongX ? mid + px : pos;
      shape(new THREE.BoxGeometry(alongX ? 1.1 : 0.5, 0.35, alongX ? 0.5 : 1.1), m, sx, y - 0.1 + py * 0.25, sz);
    }
  };

  // ---- T spawn ----
  api.palm(-10.8, 40.2); api.palm(10.8, 40.2, 1.1); api.palm(-10.5, 27.2, 0.9);
  // pickup truck
  box(7.4, 0.95, 28.4, 4.6, 1.1, 2.0, col(0xB9A27A, 0.6, 0.3));
  box(8.7, 1.8, 28.4, 1.9, 0.7, 1.9, col(0x20272C, 0.25, 0.6), false);
  box(6.2, 1.62, 28.4, 2.2, 0.25, 2.0, col(0x7C6A4E, 0.6, 0.3), false);
  for (const u of [-1.5, 1.5]) for (const v of [-0.95, 0.95]) shape(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 10), col(0x1A1A1A, 0.9), 7.4 + u, 0.38, 28.4 + v, Math.PI / 2);
  crate(-8.2, 28.4); crate(-6.9, 28.4); crate(-7.55, 28.4, 1.2, 1.25, 0.3);
  // Spawn screen: a plastered wall between the spawn pads and the mid mouth, so the
  // 70 m spawn-to-spawn axis down mid is never an open sightline.
  lowWall(-6, 6, 28.7, 29.4, 3.2, M.plaster);
  for (const x of [-6.2, 6.2]) box(x, 1.8, 29.05, 0.9, 3.6, 1.1, stone);
  api.banner(-3, 29.4, 2.4, api.ACC_TERRA);
  api.lamp(-11.2, 33); api.lamp(11.2, 33);
  api.banner(0, 40.6, 3.2, api.ACC_TERRA);
  // gates out of spawn
  gate(true, -12, 30, 38); gate(true, 12, 30, 38); gate(false, 26, -5, 5, 3.8);

  // ---- T alley / outside long ----
  barrel(-20, 37.2); barrel(-19.2, 37.4, true); crate(-24.5, 30.8);
  // market stalls along the south wall of outside long
  for (const [sx, sz, fab] of [[-38, 39, 0], [-31.5, 39, 3]] as const) {
    box(sx, 0.55, sz, 2.8, 1.1, 1.4, timber);
    for (const [ox, oz] of [[-1.45, -0.8], [1.45, -0.8], [-1.45, 0.8], [1.45, 0.8]] as const) shape(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), METAL, sx + ox, 1.3, sz + oz);
    shape(new THREE.PlaneGeometry(3.3, 2.4), FABRIC[fab], sx, 2.6, sz, -Math.PI / 2 + 0.14);
    for (let g = 0; g < 4; g++) shape(new THREE.SphereGeometry(0.15, 6, 5), col(0xC7A24B + g * 0x0a1020), sx - 0.9 + g * 0.6, 1.2, sz);
    cover(sx, sz - 2);
  }
  api.palm(-39.2, 27.8, 0.85);
  crate(-29.2, 27.6); barrel(-40, 32);
  api.soundTraps.push({ minX: -36, maxX: -32, minZ: 28, maxZ: 32, kind: 'gravel' });
  // long doors: frame + two open wooden leaves against the walls
  gate(false, 18.6, -37, -31, 3.2, timber);
  for (const side of [-1, 1]) shape(new THREE.BoxGeometry(0.12, 2.9, 2.6), timber, -34 + side * 2.9, 1.45, 20.2, 0, 0);

  // ---- A long ----
  // blue container hugging the west wall
  box(-39.7, 1.3, 5, 2.5, 2.6, 6.2, col(0x2E5E86, 0.75, 0.35));
  for (const dz of [-2.6, -1.3, 0, 1.3, 2.6]) box(-38.43, 1.3, 5 + dz, 0.06, 2.4, 0.12, col(0x24496A, 0.7, 0.4), false);
  cover(-37.4, 5); cover(-39.6, 9.2);
  car(-30.9, -4, false, 0x8C4B2E);
  crate(-39.6, -11.5); crate(-39.6, -10.2); crate(-39.6, -10.85, 1.2, 1.25, 0.25);
  barrel(-29, 13); barrel(-29.3, 14);
  api.lamp(-28.4, 0);

  // ---- A site ----
  deck(-40.6, -31, -40.6, -33.2);
  // platform: a crate wall along the deck's front edge, the anchor hides behind it
  crate(-36.5, -34.4, 1.25, 0.45); crate(-35.25, -34.4, 1.25, 0.45); crate(-35.9, -34.4, 1.2, 1.7, 0.2);
  crate(-39.6, -39.6, 1.25, 0.45);
  crate(-27.4, -29.6); crate(-26.15, -29.6); crate(-26.8, -29.6, 1.2, 1.25, 0.3);
  lowWall(-41, -37, -22.4, -21.8, 1.05);        // "goose"
  car(-33, -24.5, true, 0x6F7A6B);
  box(-22.6, 2.3, -38.6, 1.1, 4.6, 1.1, stone); // pillar
  barrel(-20.6, -20.4); barrel(-21.4, -19.8, true);
  cover(-29, -31.6); cover(-35.5, -33); cover(-24.8, -28);

  // ---- A short ----
  crate(-14.2, -24.3); crate(-12.95, -24.3);
  api.soundTraps.push({ minX: -17.5, maxX: -15, minZ: -20.5, maxZ: -18, kind: 'glass' });
  gate(true, -5, -25, -17, 3.4);

  // ---- mid ----
  crate(-2.4, 12.2, 1.4);                        // "xbox"
  cover(-2.4, 14); cover(-2.4, 10.4);
  // mid doors: wall across mid with a 5 m doorway + lintel + a swung-open leaf
  {
    const { z0, z1, gap } = MID_DOORS;
    const mz = (z0 + z1) / 2, dz = z1 - z0;
    box((-5 - gap) / 2, 1.7, mz, 5 - gap, 3.4, dz, stone);
    box((5 + gap) / 2, 1.7, mz, 5 - gap, 3.4, dz, stone);
    box(0, 3.15, mz, gap * 2, 0.5, dz, timber);
    shape(new THREE.BoxGeometry(0.1, 2.7, 2.3), timber, gap - 0.1, 1.35, mz + 1.25, 0, 0.35);
    cover(-3.5, mz + 1.5); cover(3.5, mz - 1.5);
  }
  barrel(4.1, 21); barrel(3.4, 21.6, true);
  api.lamp(-4.6, -20);

  // ---- CT spawn and ramps ----
  car(0, -40, true, 0x55603A);
  // CT screen wall: same job as the T-spawn wall, sandbagged on the mid side.
  lowWall(-5, 5, -33.1, -32.4, 2.6, M.plaster);
  api.sandbags(-2, -31.7); api.sandbags(2.4, -31.7);
  crate(8.2, -39.3); crate(9.45, -39.3); crate(8.8, -39.3, 1.2, 1.25, 0.2);
  box(0, 4, -40.4, 0.14, 8, 0.14, METAL, false);
  shape(new THREE.PlaneGeometry(2.4, 1.5), api.ACC_TURQ, 1.25, 7.1, -40.4);
  crate(-15.2, -38.3); barrel(14.6, -38.3); barrel(15.4, -38.1, true);
  api.palm(-10.4, -31.6, 0.9); api.palm(10.4, -31.6, 0.9);

  // ---- B site ----
  deck(35.4, 40.6, -40.6, -33.6);
  crate(37, -34.8, 1.25, 0.45); crate(38.25, -34.8, 1.25, 0.45); crate(37.6, -34.8, 1.2, 1.7, 0.25);
  crate(39.6, -39.6, 1.25, 0.45);
  crate(30.2, -34.4); crate(31.45, -34.4); crate(30.8, -34.4, 1.2, 1.25, 0.2);
  // market hall: four pillars + beams + fabric canopy
  const hall = [[25.8, -31.2], [33.2, -31.2], [25.8, -23.8], [33.2, -23.8]] as const;
  for (const [px, pz] of hall) { box(px, 2.2, pz, 0.9, 4.4, 0.9, stone); cover(px + 1.2, pz); }
  box(29.5, 4.55, -31.2, 8.3, 0.3, 0.5, timber, false); box(29.5, 4.55, -23.8, 8.3, 0.3, 0.5, timber, false);
  box(25.8, 4.55, -27.5, 0.5, 0.3, 7.9, timber, false); box(33.2, 4.55, -27.5, 0.5, 0.3, 7.9, timber, false);
  for (let i = 0; i < 4; i++) dressing(new THREE.PlaneGeometry(1.9, 7.2), FABRIC[i % 2 === 0 ? 1 : 3], 26.8 + i * 1.9, 4.75, -27.5, -Math.PI / 2 + (i % 2 ? 0.08 : -0.08));
  box(39.8, 1.1, -16.7, 2.4, 2.2, 1.6, stone); // broken wall at the tunnel exit
  box(40.4, 2.6, -16.7, 1.2, 0.8, 1.6, stone, false);
  barrel(39.6, -27.4); barrel(39.9, -28.3, true);
  crate(20.6, -20.8);
  cover(29.2, -33); cover(24.4, -22.5); cover(36.5, -33);

  // ---- B window / B doors ----
  crate(12, -14.2); crate(13.25, -14.2);
  gate(true, 5, -15, -8, 3.4);
  gate(false, -17.4, 18, 26, 3.3, timber);
  for (const side of [-1, 1]) shape(new THREE.BoxGeometry(0.12, 2.9, 2.4), timber, 22 + side * 3.85, 1.45, -16.2);

  // ---- upper alley, tunnel yard ----
  barrel(18, 37.2); crate(26.2, 31); crate(26.2, 32.25);
  // laundry lines between the alley houses
  for (const lx of [16, 21, 25]) {
    box(lx, 4.3, 34, 0.03, 0.03, 8, METAL, false);
    for (let i = 0; i < 4; i++) dressing(new THREE.PlaneGeometry(0.7, 0.9), FABRIC[(lx + i) % FABRIC.length], lx, 3.8, 31 + i * 2, 0, Math.PI / 2);
  }
  car(30.2, 38.6, true, 0x9A8A6A);
  crate(39.8, 28); barrel(39.6, 30.2);
  api.soundTraps.push({ minX: 33, maxX: 37, minZ: 27, maxZ: 31, kind: 'gravel' });
  gate(false, 26.5, 32, 41, 3.8);

  // ---- B tunnels: roof, beams, lamps (flicker), crates ----
  {
    const r = TUNNEL_ROOF, cxr = (r.x0 + r.x1) / 2, czr = (r.z0 + r.z1) / 2;
    box(cxr, 4.6, czr, r.x1 - r.x0 + 0.6, 0.5, r.z1 - r.z0, stone);
    for (let z = r.z0 + 1; z < r.z1; z += 4) box(cxr, 4.25, z, r.x1 - r.x0, 0.3, 0.4, timber, false);
    api.interiors.push({ minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1, minY: 0, maxY: 4.4 });
    for (const [lx, lz] of [[36.5, 3], [36.5, 15]] as const) {
      shape(new THREE.SphereGeometry(0.12, 8, 6), GLOW, lx, 4.0, lz);
      box(lx, 4.2, lz, 0.05, 0.3, 0.05, METAL, false);
      const light = new THREE.PointLight(0xFFC58A, 4, 12, 1.8);
      light.position.set(lx, 3.8, lz);
      api.group.add(light);
      api.arenaFx.flicker.push({ light, base: 4, seed: lx + lz * 1.7 });
    }
    crate(40.1, 9); crate(40.1, 10.25); crate(33, 1.5);
    barrel(33.2, 16.5); barrel(40, -6.5, true);
    cover(38.5, 10); cover(34.5, 1.5);
  }

  // ---------------- landmark minaret (orientation from anywhere) ----------------
  {
    const mx = 18.5, mz = 9;
    shape(new THREE.CylinderGeometry(1.5, 1.8, 18, 14), M.whitewash, mx, 9, mz);
    shape(new THREE.CylinderGeometry(2.3, 2.3, 0.5, 16), stone, mx, 14.6, mz);
    shape(new THREE.CylinderGeometry(1.2, 1.4, 3.2, 12), M.whitewash, mx, 19.4, mz);
    shape(new THREE.SphereGeometry(1.35, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), api.ACC_TURQ, mx, 21, mz);
    shape(new THREE.ConeGeometry(0.2, 1.4, 8), GLOW, mx, 22.9, mz);
    api.landmarks.push({ name: 'Minaret', at: new THREE.Vector3(mx, 23, mz) });
  }

  // ---------------- bomb sites: painted zones + stencils ----------------
  for (const id of ['A', 'B'] as const) {
    const s = SITES[id], z = s.zone;
    const w = z.x1 - z.x0, d = z.z1 - z.z0, cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
    for (const [x, zz, lw, ld] of [[cx, z.z0, w, 0.16], [cx, z.z1, w, 0.16], [z.x0, cz, 0.16, d], [z.x1, cz, 0.16, d]] as const) {
      dressing(new THREE.PlaneGeometry(lw, ld), hazard, x, 0.07, zz, -Math.PI / 2);
    }
    const tex = stencilTexture(id, '#E8672B');
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false });
    dressing(new THREE.PlaneGeometry(4.2, 4.2), mat, s.center[0], 0.075, s.center[1], -Math.PI / 2);
    const wallMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, depthWrite: false });
    if (id === 'A') dressing(new THREE.PlaneGeometry(3.6, 3.6), wallMat, -30, 3.1, -40.93);
    else dressing(new THREE.PlaneGeometry(3.6, 3.6), wallMat, 40.93, 3.1, -28.5, 0, -Math.PI / 2);
  }
  // directional stencils at the lane splits
  const arrowMat = (label: string, dir: number) => new THREE.MeshBasicMaterial({ map: stencilTexture(label, '#D9CBB0', dir), transparent: true, opacity: 0.85, depthWrite: false });
  // Plane +x maps to world −z on a west wall (ry=+π/2) and to +z on an east wall
  // (ry=−π/2), so "towards north" is arrow +1 on the west wall and −1 on the east.
  const aLeft = arrowMat('A', -1), bRight = arrowMat('B', 1);
  dressing(new THREE.PlaneGeometry(2, 2), arrowMat('A', 1), -4.95, 2.4, -14, 0, Math.PI / 2);   // mid → short (north)
  dressing(new THREE.PlaneGeometry(2, 2), arrowMat('B', -1), 4.95, 2.4, -5.5, 0, -Math.PI / 2); // mid → B window (north)
  dressing(new THREE.PlaneGeometry(2, 2), aLeft, -8, 2.4, 26.05);                               // T spawn north wall
  dressing(new THREE.PlaneGeometry(2, 2), bRight, 8, 2.4, 26.05);
  api.lightSpots.push(new THREE.Vector3(0, 3.2, -3.5), new THREE.Vector3(36.5, 3.6, 9));

  // ---------------- architectural ornament pass ----------------
  // Low detail keeps the exact same walkable solids and cover. High detail adds
  // only merged dressing: the player reads the district from its shadow shapes,
  // not from a second collision map.
  if (ornament) {
    const ornamentMat = hazard; // already present in the site stencil batch; no extra draw
    // All high-tier façade pieces share one cached material. This is intentional:
    // triangles buy silhouette, while extra mapped materials would buy draws.
    const limestone = ornamentMat;
    const woodTrim = ornamentMat;
    const marketCloth = [ornamentMat];
    const shadow = ornamentMat;

    // Repeated window modules give each frontage a real construction language:
    // deep reveal, sill, lintel and a projecting mashrabiya grille on the upper row.
    const frontage = (x: number, z: number, alongX: boolean, count: number, wall: THREE.Material) => {
      for (let i = 0; i < count; i++) {
        const t = (i - (count - 1) / 2) * 2.25;
        const px = alongX ? x + t : x, pz = alongX ? z : z + t;
        const ry = alongX ? 0 : Math.PI / 2;
        dressing(new THREE.BoxGeometry(1.15, 1.55, 0.08), shadow, px, 2.05, pz, 0, ry);
        dressing(new THREE.BoxGeometry(1.45, 0.12, 0.18), limestone, px, 1.23, pz, 0, ry);
        dressing(new THREE.BoxGeometry(1.35, 0.12, 0.18), limestone, px, 2.88, pz, 0, ry);
        dressing(new THREE.BoxGeometry(1.5, 0.18, 0.28), wall, px, 3.15, pz, 0, ry);
        // Three-dimensional upper-storey screen: slats project into raking light.
        for (let bar = -3; bar <= 3; bar++) {
          const bx = alongX ? px + bar * 0.18 : px;
          const bz = alongX ? pz : pz + bar * 0.18;
          dressing(new THREE.BoxGeometry(0.07, 1.45, 0.07), wall, bx, 5.1, bz, 0, ry);
        }
        for (const side of [-1, 1]) {
          dressing(new THREE.BoxGeometry(0.10, 1.55, 0.10), limestone, alongX ? px + side * 0.72 : px, 5.1, alongX ? pz : pz + side * 0.72, 0, ry);
        }
      }
    };
    // A LONG / A SITE: bleached limestone arcades and wide shaded windows.
    frontage(-40.68, 8, false, 6, limestone);
    frontage(-30, -40.68, true, 8, limestone);
    for (const x of [-39, -35, -31, -27, -23]) {
      dressing(new THREE.CylinderGeometry(0.23, 0.28, 3.4, 10), limestone, x, 1.7, -18.1);
      dressing(new THREE.TorusGeometry(0.32, 0.06, 6, 10), limestone, x, 3.38, -18.1, Math.PI / 2);
    }
    // MID / CT MID: civic paving pattern, cistern lip and a colonnade announce the split.
    for (let x = -4; x <= 4; x += 2) {
      dressing(new THREE.BoxGeometry(0.12, 0.035, 6), limestone, x, 0.07, 22);
      dressing(new THREE.BoxGeometry(1.2, 0.035, 0.12), limestone, x, 0.075, 19 + Math.abs(x));
    }
    dressing(new THREE.CylinderGeometry(1.35, 1.5, 0.55, 20), limestone, 0, 0.3, 17);
    dressing(new THREE.CylinderGeometry(1.05, 1.05, 0.12, 20), ornamentMat, 0, 0.64, 17);
    dressing(new THREE.CylinderGeometry(0.12, 0.12, 2.0, 8), limestone, 0, 1.45, 17);
    for (const x of [-7, -3.5, 3.5, 7]) {
      dressing(new THREE.CylinderGeometry(0.18, 0.22, 3.5, 8), limestone, x, 1.75, -29.2);
      dressing(new THREE.BoxGeometry(2.6, 0.18, 0.18), limestone, x, 3.5, -29.2);
    }
    // B TUNNELS / TUNNEL YARD: cold service infrastructure, cable trays and water stains.
    for (const z of [-1, 3, 7, 11, 15, 19]) {
      dressing(new THREE.BoxGeometry(0.12, 0.12, 3.8), ornamentMat, 32.35, 2.6, z);
      dressing(new THREE.BoxGeometry(0.12, 0.12, 3.8), ornamentMat, 40.65, 2.6, z);
      dressing(new THREE.CylinderGeometry(0.055, 0.055, 8, 6), ornamentMat, 36.5, 3.25, z, 0, 0, Math.PI / 2);
    }
    for (let z = -15; z <= 21; z += 4) {
      const stain = ornamentMat;
      dressing(new THREE.PlaneGeometry(0.45 + hash(z, 8) * 0.3, 2.2), stain, 32.1, 1.1, z, 0, Math.PI / 2);
    }
    // B SITE / B DOORS: a covered market with tiled-looking awnings and hanging goods.
    for (let x = 21; x <= 39; x += 3) {
      const fabric = marketCloth[Math.floor((x + 21) / 3) % marketCloth.length];
      dressing(new THREE.PlaneGeometry(2.5, 1.1), fabric, x, 3.2, -18.7, -Math.PI / 2 + 0.22);
      dressing(new THREE.BoxGeometry(0.09, 2.4, 0.09), woodTrim, x - 1.05, 1.35, -18.1);
      dressing(new THREE.BoxGeometry(0.09, 2.4, 0.09), woodTrim, x + 1.05, 1.35, -18.1);
      for (let g = -1; g <= 1; g++) dressing(new THREE.SphereGeometry(0.13, 8, 6), fabric, x + g * 0.35, 2.05, -18.0);
    }
    // Residential spawn shoulders: laundry, satellite dishes and painted thresholds.
    for (const x of [-9, -3, 3, 9]) {
      dressing(new THREE.CylinderGeometry(0.025, 0.025, 7, 6), ornamentMat, x, 3.7, 33);
      for (let i = 0; i < 4; i++) dressing(new THREE.PlaneGeometry(0.65, 0.8), marketCloth[(i + Math.abs(x)) % marketCloth.length], x, 3.35, 30 + i * 1.8, 0, Math.PI / 2);
      dressing(new THREE.BoxGeometry(1.1, 0.07, 0.12), ornamentMat, x, 0.05, 26.2);
    }
    for (const [x, z] of [[-8, 31], [8, 31], [-37, 12], [-37, -12], [37, -12], [37, 12]] as const) {
      dressing(new THREE.ConeGeometry(0.8, 0.12, 16), limestone, x, 5.4, z, Math.PI / 2);
      dressing(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), ornamentMat, x, 5.85, z, 0, 0, Math.PI / 2);
    }
    // Coping stones and roof teeth break up the generated block mass. They are
    // intentionally tiny, non-colliding silhouette pieces: a low-detail player
    // still gets the same cover and the same nav grid.
    for (const row of [-1, 1]) for (let i = 0; i < 10; i++) {
      const x = -40 + i * 4.4;
      for (let j = 0; j < 3; j++) {
        dressing(new THREE.BoxGeometry(0.75, 0.34, 0.46), limestone, x + (j - 1) * 0.9, 6.1 + (i % 3) * 0.18, row * 20 + (i % 2) * 0.2);
        dressing(new THREE.BoxGeometry(0.18, 0.7, 0.18), limestone, x + (j - 1) * 0.9, 6.55 + (i % 2) * 0.12, row * 20);
      }
    }
    // A second coping course gives the high tier enough overhead silhouette to
    // justify itself on integrated GPUs: many tiny pieces, one cached draw.
    for (const row of [-1, 1]) for (let i = 0; i < 38; i++) for (let j = 0; j < 5; j++) {
      dressing(new THREE.BoxGeometry(0.42, 0.28, 0.35), limestone, -42 + i * 2.2, 6.9 + (j % 2) * 0.14, row * (26 + (j % 3) * 0.3));
    }
    api.landmarks.push(
      { name: 'Limestone Arch', at: new THREE.Vector3(-34, 3.6, 17) },
      { name: 'Civic Cistern', at: new THREE.Vector3(0, 1.5, 17) },
      { name: 'South Gate', at: new THREE.Vector3(0, 4, 29) },
      { name: 'Tunnel Service Portal', at: new THREE.Vector3(36.5, 5, 20) },
      { name: 'Market Bell', at: new THREE.Vector3(31, 5, -18) },
      { name: 'B Site Canopy', at: new THREE.Vector3(31, 4, -29) },
    );
  }

  // ---------------- distant skyline (non-colliding, outside the playable box) ----------------
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + hash(i, 2) * 0.2;
    const r = 58 + hash(i, 5) * 22;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 6 + hash(i, 7) * 10, d = 6 + hash(i, 9) * 10, h = 5 + hash(i, 11) * 9;
    shape(new THREE.BoxGeometry(w, h, d), wallMats[i % wallMats.length], x, h / 2 - 0.4, z, 0, a);
    if (i % 5 === 0) shape(new THREE.SphereGeometry(Math.min(w, d) * 0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), api.ACC_TURQ, x, h - 0.4, z);
  }
}
