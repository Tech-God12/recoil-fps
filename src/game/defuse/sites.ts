// Recoil FPS — Bomb Defusal: Warehouse bomb sites, tactical waypoints and site architecture.
// Attackers always spawn in the SOUTH yard (z ≈ +38) and defenders in the NORTH
// yard (z ≈ −38); teams swap spawns at halftime, the sites stay where they are.
import * as THREE from 'three';
import type { World } from '../world';
import { getMaterials } from '../textures';
import type { SiteId } from './rules';

export type XZ = [number, number];
export interface HoldSpot { at: XZ; look: XZ }

export interface BombSite {
  id: SiteId;
  name: string;
  center: XZ;
  /** Plantable footprint (the painted boundary). */
  zone: { minX: number; maxX: number; minZ: number; maxZ: number };
  plantSpots: XZ[];
  /** Defender setups: covered angles watching each entrance. */
  defend: HoldSpot[];
  /** Attacker positions once they have taken the site. */
  entry: XZ[];
  /** Attacker post-plant crossfire positions (look = toward the defender retake paths). */
  postPlant: HoldSpot[];
  /** Attacker staging points per route before the execute. */
  stage: { yard: XZ; hall: XZ };
  /** Defender retake assembly point when the bomb is down. */
  retake: XZ[];
}

export const ATTACK_SPAWNS: XZ[] = [[0, 36], [-12, 38], [12, 38], [-5, 41], [5, 41]];
export const DEFEND_SPAWNS: XZ[] = [[0, -38], [-10, -40], [10, -40], [-4, -42], [4, -42]];

export const SITES: Record<SiteId, BombSite> = {
  A: {
    id: 'A', name: 'A · Wreck Yard', center: [-30, -28],
    zone: { minX: -40, maxX: -21, minZ: -38, maxZ: -19 },
    plantSpots: [[-27.6, -27.2], [-31.5, -24.4], [-33.2, -31.0]],
    defend: [
      { at: [-27.5, -29.5], look: [-31, -12] },   // behind the crate stack, watching the yard lane
      { at: [-38.0, -33.0], look: [-30, -19] },   // deep corner behind the van
      { at: [-23.5, -34.5], look: [-12, -12] },   // back container, watching the west-hall exit
    ],
    entry: [[-30.5, -21.5], [-25, -24], [-35, -24], [-29, -32]],
    postPlant: [
      { at: [-38.5, -22], look: [-28, -28] },
      { at: [-22.5, -22], look: [-8, -34] },
      { at: [-33.5, -16], look: [-25, -30] },
    ],
    stage: { yard: [-32, 2], hall: [-10.5, 6] },
    retake: [[-12, -32], [-22, -40], [-16, -22]],
  },
  B: {
    id: 'B', name: 'B · Crane Dock', center: [28, -28],
    zone: { minX: 19, maxX: 40, minZ: -38, maxZ: -19 },
    plantSpots: [[25.6, -27.2], [30.2, -24.4], [32.2, -31.0]],
    defend: [
      { at: [25.5, -29.5], look: [30, -12] },
      { at: [38.4, -33.2], look: [29, -19] },
      { at: [21.5, -34.5], look: [11, -12] },
    ],
    entry: [[28.5, -21.5], [23, -24], [34, -24], [27, -32]],
    postPlant: [
      { at: [38.6, -22.5], look: [26, -28] },
      { at: [20.5, -22], look: [6, -34] },
      { at: [31.5, -16], look: [24, -30] },
    ],
    stage: { yard: [32, 2], hall: [10.5, 6] },
    retake: [[12, -32], [21, -40], [15, -22]],
  },
};

/** Mid control position between the halls (defender floater / attacker lurk). */
export const MID_HOLD: HoldSpot = { at: [0, -14], look: [0, 8] };
export const MID_LURK: XZ = [0, 1];

export function siteAt(x: number, z: number): SiteId | null {
  for (const s of Object.values(SITES)) {
    const b = s.zone;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return s.id;
  }
  return null;
}

// ============================ SITE ARCHITECTURE ============================
function uvBox(w: number, h: number, d: number, tile = 2): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  // Scale UVs per face to world metres so textures never smear on long boxes.
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faces[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su / tile, uv.getY(k) * sv / tile);
    }
  }
  return g;
}

function letterTexture(letter: string, ring: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  if (ring) {
    ctx.strokeStyle = 'rgba(235,196,64,0.92)';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(128, 128, 104, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(235,196,64,0.95)';
  ctx.font = 'bold 170px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(letter: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#E3B92F';
  ctx.fillRect(0, 0, 256, 256);
  // hazard stripes band
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 206, 256, 50); ctx.clip();
  for (let x = -60; x < 300; x += 36) {
    ctx.fillStyle = '#1B1A17';
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + 18, 256); ctx.lineTo(x + 58, 206); ctx.lineTo(x + 40, 206); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#1B1A17';
  ctx.font = 'bold 190px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 110);
  ctx.strokeStyle = '#1B1A17'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 246, 246);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Adds both bomb sites to the warehouse: hard cover (containers, crate stacks,
 * jersey barriers), painted boundaries + site letters, and wall-mounted site signs.
 * Every solid feeds collision, bullet/LOS occlusion, cover nodes and the tactical map.
 * Must run BEFORE the nav grid / solid grid / map image are built.
 */
export function buildSiteArchitecture(world: World): THREE.Group {
  const M = getMaterials();
  const group = new THREE.Group();
  group.name = 'bomb-sites';
  const wood = M.roughTimber ?? M.wood;
  const concrete = M.concrete;
  const metalSheet = M.corrugatedMetal ?? M.rustedMetal;
  const siteBlue = new THREE.MeshStandardMaterial({ color: 0x3F5E73, roughness: 0.72, metalness: 0.25 });
  const siteRust = new THREE.MeshStandardMaterial({ color: 0x8A4A2B, roughness: 0.8, metalness: 0.2 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2A2A28, roughness: 0.5, metalness: 0.7 });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xE0B530, roughness: 0.6 });

  const solid = (mesh: THREE.Mesh, cover = true) => {
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    group.add(mesh);
    world.occluders.push(mesh);
    const b = new THREE.Box3().setFromObject(mesh);
    world.solids.push({ minX: b.min.x, minY: b.min.y, minZ: b.min.z, maxX: b.max.x, maxY: b.max.y, maxZ: b.max.z });
    if (cover) {
      // Cover nodes on all four sides, 0.9 m off the faces.
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      world.coverNodes.push(
        new THREE.Vector3(b.min.x - 0.9, 0, cz), new THREE.Vector3(b.max.x + 0.9, 0, cz),
        new THREE.Vector3(cx, 0, b.min.z - 0.9), new THREE.Vector3(cx, 0, b.max.z + 0.9),
      );
    }
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, cover = true) => {
    const m = new THREE.Mesh(uvBox(w, h, d), mat);
    m.position.set(x, y, z);
    solid(m, cover);
    return m;
  };
  const crate = (x: number, z: number, s = 1.25, y = 0) => {
    box(x, y + s / 2, z, s, s, s, wood);
    // steel corner straps (visual only)
    const strap = new THREE.Mesh(new THREE.BoxGeometry(s + 0.04, 0.08, s + 0.04), frame);
    strap.position.set(x, y + s * 0.8, z);
    group.add(strap);
  };
  const container = (x: number, z: number, alongX: boolean, mat: THREE.Material, stacked = false) => {
    const w = alongX ? 6.2 : 2.5, d = alongX ? 2.5 : 6.2;
    box(x, 1.3, z, w, 2.6, d, mat);
    const ribs = alongX ? 9 : 4;
    for (let i = 0; i <= ribs; i++) {
      const t = -0.5 + i / ribs;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.06 : w + 0.05, 2.5, alongX ? d + 0.05 : 0.06), frame);
      rib.position.set(x + (alongX ? t * (w - 0.1) : 0), 1.3, z + (alongX ? 0 : t * (d - 0.1)));
      group.add(rib);
    }
    if (stacked) box(x + (alongX ? 0.35 : 0), 3.9, z + (alongX ? 0 : 0.35), w, 2.6, d, metalSheet, false);
  };
  const jersey = (x: number, z: number, alongX: boolean, len = 4) => {
    // Two-tier jersey barrier: wide foot + narrower cap, 1.1 m tall (crouch cover).
    box(x, 0.35, z, alongX ? len : 0.8, 0.7, alongX ? 0.8 : len, concrete);
    const cap = new THREE.Mesh(uvBox(alongX ? len : 0.42, 0.4, alongX ? 0.42 : len), concrete);
    cap.position.set(x, 0.9, z);
    solid(cap, false);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len * 0.96 : 0.44, 0.07, alongX ? 0.44 : len * 0.96), hazard);
    stripe.position.set(x, 1.1, z);
    group.add(stripe);
  };

  // ------------------------------ A · WRECK YARD ------------------------------
  container(-28.5, -37.2, true, siteRust, true);   // back wall container, stacked
  crate(-27.6, -25.6); crate(-26.35, -25.6); crate(-27.0, -25.6, 1.1, 1.25); // default-plant stack
  crate(-33.4, -29.4);                               // mid-site single
  crate(-23.4, -31.8, 1.35); crate(-23.6, -30.4, 1.0, 0); // ramp crates by the back container
  jersey(-32.6, -20.2, true, 4.6);                   // front lip facing the yard lane
  jersey(-21.6, -26.5, false, 3.6);                  // east flank facing the hall exit

  // ------------------------------ B · CRANE DOCK ------------------------------
  container(28.5, -37.2, true, siteBlue, true);
  crate(25.6, -25.6); crate(24.35, -25.6); crate(25.0, -25.6, 1.1, 1.25);
  crate(31.4, -29.4);
  crate(21.4, -31.8, 1.35); crate(21.6, -30.4, 1.0, 0);
  jersey(30.6, -20.2, true, 4.6);
  jersey(19.6, -26.5, false, 3.6);

  // ---------------- painted boundaries + site letters (decals) ----------------
  const paint = new THREE.MeshBasicMaterial({ color: 0xE3BC3A, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const s of Object.values(SITES)) {
    const { minX, maxX, minZ, maxZ } = s.zone;
    const edge = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.07, z);
      group.add(m);
    };
    // dashed boundary
    const dash = 1.6, gap = 1.0;
    for (let x = minX; x < maxX; x += dash + gap) {
      const w = Math.min(dash, maxX - x);
      edge(x + w / 2, minZ, w, 0.18); edge(x + w / 2, maxZ, w, 0.18);
    }
    for (let z = minZ; z < maxZ; z += dash + gap) {
      const d = Math.min(dash, maxZ - z);
      edge(minX, z + d / 2, 0.18, d); edge(maxX, z + d / 2, 0.18, d);
    }
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), new THREE.MeshBasicMaterial({
      map: letterTexture(s.id, true), transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }));
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.center[0], 0.075, s.center[1] + 2.5);
    group.add(letter);
    // wall-mounted site sign on the north perimeter wall (visible from spawn and site)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), new THREE.MeshStandardMaterial({ map: signTexture(s.id), roughness: 0.7 }));
    sign.position.set(s.center[0], 3.4, -45.35);
    group.add(sign);
    // and one on the back container facing the entrance
    const sign2 = sign.clone();
    sign2.scale.setScalar(0.62);
    sign2.position.set(s.center[0] + (s.id === 'A' ? 1.5 : -1.5), 1.45, -35.9);
    group.add(sign2);
  }
  world.group.add(group);
  return group;
}
