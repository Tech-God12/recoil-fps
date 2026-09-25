// Recoil FPS — SIROCCO: purpose-built Bomb Defusal map (PURE layout data).
//
// An 88 m desert-town square built around the classic three-lane shape:
//   A LONG (west) · MID with SHORT and the B WINDOW market connector (centre) · B TUNNELS (east)
// Attackers deploy south (+z), defenders north (−z); CT spawn sits between both
// sites so defenders rotate in ~6 s while attackers need ~15 s to reach a site.
//
// The walkable space is authored as named rectangles. Everything else inside the
// perimeter becomes building mass (see maps/sirocco-build.ts), so the lanes the AI
// plans on and the collision the engine enforces can never drift apart.
// Coordinates are world metres: x west(−)→east(+), z north(−)→south(+).

export type Vec2 = [number, number];
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export type FloorKind = 'cobble' | 'pavers' | 'tile' | 'earth' | 'concrete' | 'sand';
export interface OpenArea { id: string; name: string; rect: Rect; floor: FloorKind }
export type SiteId = 'A' | 'B';

export const SIROCCO_HALF = 44;

export const SIROCCO_OPEN: OpenArea[] = [
  { id: 'tspawn', name: 'T SPAWN', rect: { x0: -12, x1: 12, z0: 26, z1: 41 }, floor: 'earth' },
  { id: 'talley', name: 'T ALLEY', rect: { x0: -27, x1: -12, z0: 30, z1: 38 }, floor: 'cobble' },
  { id: 'outlong', name: 'OUTSIDE LONG', rect: { x0: -41, x1: -27, z0: 26, z1: 41 }, floor: 'sand' },
  { id: 'longdoors', name: 'LONG DOORS', rect: { x0: -37, x1: -31, z0: 18, z1: 26 }, floor: 'cobble' },
  { id: 'along', name: 'A LONG', rect: { x0: -41, x1: -28, z0: -18, z1: 18 }, floor: 'cobble' },
  { id: 'asite', name: 'A SITE', rect: { x0: -41, x1: -19, z0: -41, z1: -18 }, floor: 'pavers' },
  { id: 'ashort', name: 'A SHORT', rect: { x0: -21, x1: -5, z0: -25, z1: -17 }, floor: 'cobble' },
  { id: 'mid', name: 'MID', rect: { x0: -5, x1: 5, z0: -27, z1: 26 }, floor: 'cobble' },
  { id: 'ctmid', name: 'CT MID', rect: { x0: -9, x1: 9, z0: -31, z1: -27 }, floor: 'pavers' },
  { id: 'ctspawn', name: 'CT SPAWN', rect: { x0: -11, x1: 11, z0: -41, z1: -31 }, floor: 'tile' },
  { id: 'aramp', name: 'A RAMP', rect: { x0: -21, x1: -9, z0: -39, z1: -31 }, floor: 'pavers' },
  { id: 'bramp', name: 'B RAMP', rect: { x0: 9, x1: 21, z0: -39, z1: -31 }, floor: 'pavers' },
  { id: 'bsite', name: 'B SITE', rect: { x0: 19, x1: 41, z0: -41, z1: -16 }, floor: 'tile' },
  { id: 'bwindow', name: 'B WINDOW', rect: { x0: 5, x1: 20, z0: -15, z1: -8 }, floor: 'cobble' },
  { id: 'bdoors', name: 'B DOORS', rect: { x0: 18, x1: 26, z0: -18, z1: -8 }, floor: 'pavers' },
  { id: 'ualley', name: 'UPPER ALLEY', rect: { x0: 12, x1: 28, z0: 30, z1: 38 }, floor: 'cobble' },
  { id: 'tyard', name: 'TUNNEL YARD', rect: { x0: 28, x1: 41, z0: 26, z1: 41 }, floor: 'sand' },
  { id: 'btunnels', name: 'B TUNNELS', rect: { x0: 32, x1: 41, z0: -18, z1: 26 }, floor: 'concrete' },
];

/** Roofed stretch of B tunnels (dark, echoing, overhead cover). */
export const TUNNEL_ROOF: Rect = { x0: 32, x1: 41, z0: -2, z1: 20 };
/** Mid doors: a wall across mid with a 5 m doorway. */
export const MID_DOORS = { z0: -4, z1: -3, gap: 2.5 };

export function inRect(x: number, z: number, r: Rect, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}
export function rectCenter(r: Rect): Vec2 { return [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]; }
export function isOpen(x: number, z: number): boolean { return SIROCCO_OPEN.some(a => inRect(x, z, a.rect)); }
export const openArea = (id: string): OpenArea => SIROCCO_OPEN.find(a => a.id === id)!;

export interface SiteDef {
  id: SiteId;
  /** Painted bomb zone — the bomb can only be planted inside. */
  zone: Rect;
  center: Vec2;
  plantSpots: Vec2[];
  /** Attackers holding a planted bomb: position + where to watch. */
  postPlant: { at: Vec2; face: Vec2 }[];
  /** Defender retake: stage points out of sight of the site, then entry lanes. */
  retakeStage: Vec2[];
  retakeClear: Vec2[];
  /** Regions where spotting attackers means "they are hitting this site". */
  approach: Rect[];
  execSmokes: Vec2[];
  retakeSmoke: Vec2;
}

export const SITES: Record<SiteId, SiteDef> = {
  A: {
    id: 'A',
    zone: { x0: -39, x1: -23, z0: -39, z1: -21 },
    center: [-31, -30],
    plantSpots: [[-29, -32.6], [-34.5, -28.5], [-36, -36.6], [-25, -35]],
    postPlant: [
      { at: [-38.5, -24.5], face: [-20, -34] },
      { at: [-36.8, -37.8], face: [-20, -35] },
      { at: [-24, -22.5], face: [-20, -36] },
      { at: [-32.5, -20.2], face: [-22, -34] },
      { at: [-38.8, -30], face: [-21, -30] },
    ],
    retakeStage: [[-13.5, -35.5], [-8, -21.5]],
    retakeClear: [[-22, -35], [-25, -27], [-30, -33], [-33, -21.6]],
    approach: [
      { x0: -41, x1: -28, z0: -18, z1: 18 },
      { x0: -37, x1: -31, z0: 18, z1: 26 },
      { x0: -41, x1: -27, z0: 26, z1: 41 },
      { x0: -21, x1: -5, z0: -25, z1: -17 },
    ],
    execSmokes: [[-20.5, -35], [-36.5, -38]],
    retakeSmoke: [-33, -21],
  },
  B: {
    id: 'B',
    zone: { x0: 23, x1: 39, z0: -38, z1: -20 },
    center: [31, -29],
    plantSpots: [[30.5, -31.6], [35, -26.5], [25.5, -26.6], [35.6, -36.3]],
    postPlant: [
      { at: [38.5, -21.5], face: [20, -35] },
      { at: [37.2, -38.5], face: [20, -34] },
      { at: [23, -22], face: [20, -36] },
      { at: [29, -38.5], face: [21, -30] },
      { at: [34, -19], face: [22, -35] },
    ],
    retakeStage: [[14.5, -35.5], [12, -11.5]],
    retakeClear: [[22, -35], [22.5, -20], [30, -29], [36, -24]],
    approach: [
      { x0: 32, x1: 41, z0: -18, z1: 26 },
      { x0: 28, x1: 41, z0: 26, z1: 41 },
      { x0: 5, x1: 20, z0: -15, z1: -8 },
      { x0: 18, x1: 26, z0: -18, z1: -8 },
    ],
    execSmokes: [[20.5, -35], [22, -17]],
    retakeSmoke: [36.5, -17.5],
  },
};

export const SPAWNS: Record<'attack' | 'defend', Vec2[]> = {
  attack: [[0, 35], [-5, 37.5], [5, 37.5], [-9, 33.5], [9, 33.5]],
  defend: [[0, -36], [-5, -38], [5, -38], [-8, -35], [8, -35]],
};
export const BUY_ZONES: Record<'attack' | 'defend', Rect> = {
  attack: { x0: -12, x1: 12, z0: 26, z1: 41 },
  defend: { x0: -11, x1: 11, z0: -41, z1: -31 },
};

export type Lane = 'long' | 'short' | 'tunnels' | 'window' | 'mid';
export interface AttackRoute {
  lane: Lane;
  site: SiteId;
  /** Waypoints from T spawn; `stage` is where the squad waits for the execute call. */
  points: Vec2[];
  stage: number;
}
export const ATTACK_ROUTES: AttackRoute[] = [
  { lane: 'long', site: 'A', points: [[-6, 34], [-20, 34], [-34, 32], [-34, 21], [-34, 9], [-34.5, -7], [-33.5, -19], [-30, -27]], stage: 4 },
  { lane: 'short', site: 'A', points: [[-8.5, 31], [-2, 24.5], [0, 12], [0.5, -9], [-3, -20.5], [-11, -21], [-20.5, -22.5], [-27, -28]], stage: 5 },
  { lane: 'tunnels', site: 'B', points: [[6, 34], [20, 34], [34.5, 32], [36.5, 22], [36.5, 6], [36.5, -8], [35.5, -19], [31, -28]], stage: 5 },
  { lane: 'window', site: 'B', points: [[8.5, 31], [2, 24.5], [0, 12], [0.5, -6], [2.5, -11.5], [11, -11.5], [16, -11.5], [22, -15], [28, -26]], stage: 6 },
];
/** Map-control spots for 'default' rounds and lurkers: [position, face]. */
export const CONTROL_SPOTS: { lane: Lane; at: Vec2; face: Vec2 }[] = [
  { lane: 'long', at: [-34, 21.5], face: [-34, 0] },
  { lane: 'mid', at: [-2.5, 6], face: [0, -20] },
  { lane: 'short', at: [-4, -12], face: [-14, -21] },
  { lane: 'tunnels', at: [36.5, 16], face: [36.5, -10] },
  { lane: 'window', at: [2.8, -9.5], face: [14, -11.5] },
];

export type PostId = 'A_ANCHOR' | 'A_LONG' | 'A_SHORT' | 'MID' | 'MID_DOORS' | 'B_ANCHOR' | 'B_DOORS' | 'B_TUNNEL' | 'LONG_PUSH';
export interface DefensePost { id: PostId; site: SiteId | 'mid'; at: Vec2; face: Vec2; anchor: boolean }
export const DEFENSE_POSTS: Record<PostId, DefensePost> = {
  A_ANCHOR: { id: 'A_ANCHOR', site: 'A', at: [-36.4, -37.2], face: [-33, -18], anchor: true },
  A_LONG: { id: 'A_LONG', site: 'A', at: [-38.5, -25.5], face: [-34.5, 12], anchor: true },
  A_SHORT: { id: 'A_SHORT', site: 'A', at: [-23.5, -28.5], face: [-10, -21], anchor: true },
  MID: { id: 'MID', site: 'mid', at: [2.8, -25.5], face: [0, 22], anchor: false },
  MID_DOORS: { id: 'MID_DOORS', site: 'mid', at: [3.6, -6.5], face: [0, 20], anchor: false },
  B_ANCHOR: { id: 'B_ANCHOR', site: 'B', at: [36.4, -36.4], face: [36.5, -16], anchor: true },
  B_DOORS: { id: 'B_DOORS', site: 'B', at: [22, -29], face: [22, -10], anchor: true },
  B_TUNNEL: { id: 'B_TUNNEL', site: 'B', at: [38.5, -22.8], face: [36.5, 4], anchor: true },
  LONG_PUSH: { id: 'LONG_PUSH', site: 'A', at: [-39, 12.5], face: [-34, 25], anchor: false },
};
export const DEFENSE_SETUPS: Record<'standard' | 'stackA' | 'stackB' | 'aggressive', PostId[]> = {
  standard: ['A_ANCHOR', 'A_LONG', 'MID', 'B_ANCHOR', 'B_DOORS'],
  stackA: ['A_ANCHOR', 'A_LONG', 'A_SHORT', 'MID', 'B_ANCHOR'],
  stackB: ['A_ANCHOR', 'MID', 'B_ANCHOR', 'B_DOORS', 'B_TUNNEL'],
  aggressive: ['LONG_PUSH', 'MID_DOORS', 'A_ANCHOR', 'B_ANCHOR', 'B_TUNNEL'],
};

/** Kill-feed callouts: specific zones first (first match wins). */
export const SIROCCO_ZONES: { name: string; rect: Rect }[] = [
  { name: 'A PLAT', rect: { x0: -41, x1: -31, z0: -41, z1: -33 } },
  { name: 'B STAGE', rect: { x0: 35, x1: 41, z0: -41, z1: -33 } },
  { name: 'MID DOORS', rect: { x0: -5, x1: 5, z0: -7, z1: 0 } },
  { name: 'TOP MID', rect: { x0: -5, x1: 5, z0: -27, z1: -7 } },
  ...SIROCCO_OPEN.map(a => ({ name: a.name, rect: a.rect })),
];
export function siroccoZoneAt(x: number, z: number): string {
  for (const zn of SIROCCO_ZONES) if (inRect(x, z, zn.rect)) return zn.name;
  return 'SIROCCO';
}

export function siteAt(x: number, z: number): SiteId | null {
  if (inRect(x, z, SITES.A.zone)) return 'A';
  if (inRect(x, z, SITES.B.zone)) return 'B';
  return null;
}
