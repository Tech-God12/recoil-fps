// Recoil FPS — Ground Zero: authored districts, climbable combat positions,
// terrain-aware wadi, BVH material batches, and event-driven route destruction.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getMaterials, type TextureSet } from './textures';

// Install BVH acceleration globally (huge raycast speed-up for merged meshes)
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type MapId = 'alrasul' | 'kasbah';
export const MAPS: { id: MapId; name: string; desc: string }[] = [
  { id: 'alrasul', name: 'Sandblast', desc: 'Two bridges. One dry river. A souk under siege in the shadow of the water tower.' },
  { id: 'kasbah', name: 'Town', desc: 'Six trades beneath a stone crown. Break the citadel, then disappear through the west gate.' },
];

export interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface WindowHole { x: number; y: number; z: number; nx: number; nz: number } // center + outward normal (horizontal)

export interface World {
  group: THREE.Group;
  solids: AABB[];
  occluders: THREE.Object3D[];
  coverNodes: THREE.Vector3[];
  playerSpawn: THREE.Vector3;
  interiors: AABB[];
  concrete: AABB[];
  wood: AABB[];
  half: number;
  lightSpots: THREE.Vector3[];
  windows: WindowHole[];
  glass: THREE.InstancedMesh | null;
  groundHeight(x: number, z: number): number;
  navigationHeight?(x: number, z: number): number;
  detonate(): boolean;
  readonly changed: boolean;
  landmarks: { name: string; at: THREE.Vector3 }[];
  overlooks: { name: string; at: THREE.Vector3; approach: THREE.Vector3; route: THREE.Vector3[] }[];
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
  let geoByMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const glassMats: THREE.Matrix4[] = [];
  const glassCenters: THREE.Vector3[] = [];
  const windows: WindowHole[] = [];
  const landmarks: World['landmarks'] = [];
  const overlooks: World['overlooks'] = [];
  let changed = false;
  const intactGroup = new THREE.Group(), wreckGroup = new THREE.Group();
  const intactSolids: AABB[] = [], wreckSolids: AABB[] = [];
  const intactMeshes: THREE.Object3D[] = [], wreckMeshes: THREE.Object3D[] = [];
  const stateGeometry: { geos: Map<THREE.Material, THREE.BufferGeometry[]>; group: THREE.Group; meshes: THREE.Object3D[] }[] = [];
  const stone = M.stoneBlock ?? M.adobeBrick, brick = M.firedBrick ?? M.adobeBrick;
  const earth = M.packedEarth ?? M.adobeWall, iron = M.corrugatedMetal ?? M.rustedMetal;
  const timber = M.roughTimber ?? M.wood, pavers = M.terracePavers ?? M.plaza;
  const cobble = M.cobbleLane ?? M.plaza, dryBed = M.wadiBed ?? M.sand;

  // ---- material cache for colored accents (shared instances so they merge) ----
  const isKasbah = mapId === 'kasbah';
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
  // Distinct palettes per map: alrasul = desert turquoise + sand, kasbah = fortified stone + terracotta + olive
  const ACC_TURQ = col(isKasbah ? 0x3A6A7A : 0x2C7C8E, 0.7);
  const ACC_TERRA = col(isKasbah ? 0x8B3A1A : 0x9A4A2E, isKasbah ? 0.8 : 0.85);
  const METAL = col(isKasbah ? 0x3A3A38 : 0x2C2C2A, 0.5, 0.7);
  const GLOW = col(isKasbah ? 0xFFD4A0 : 0xFFE2A8, 0.4, 0, isKasbah ? 2.0 : 2.4);
  const FROND = col(isKasbah ? 0x3D5A2E : 0x4E6B34, 0.85, 0, 0, THREE.DoubleSide);
  const FABRIC = (isKasbah
    ? [0x8B2E1E, 0x5A3A2A, 0x6B4A2A, 0x8C6A3A, 0x5A5A3A]
    : [0xB0402E, 0x2E6BA0, 0x3E7B52, 0xC7A24B, 0x8C4E86]
  ).map(c => col(c, 0.9, 0, 0, THREE.DoubleSide));

  const accent = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.83, side: THREE.DoubleSide });
  const emissiveAccent = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, emissive: 0xffa65b, emissiveIntensity: 1.6 });
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: 0x8b8477, transparent: true, opacity: 0.23, depthWrite: false, roughness: 1 });
  // ---- geometry collection ----
  function push(geo: THREE.BufferGeometry, m: THREE.Material) {
    if (geo.index) { const indexed = geo; geo = indexed.toNonIndexed(); indexed.dispose(); }
    if (m instanceof THREE.MeshStandardMaterial && !m.map && [...matCache.values()].includes(m)) {
      const c = m.color, colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      m = m.emissiveIntensity > 1 ? emissiveAccent : accent;
    }
    let arr = geoByMat.get(m);
    if (!arr) { arr = []; geoByMat.set(m, arr); }
    arr.push(geo);
  }
  function box(cx: number, cy: number, cz: number, w: number, h: number, d: number, m: THREE.Material, collide = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv=g.getAttribute('uv');
    const map=(m as THREE.MeshStandardMaterial).map;
    if (map) for (let i=0;i<uv.count;i++) {
      const face=Math.floor(i/4),u=face<2?d:w,v=face<2?h:face<4?d:h;
      uv.setXY(i,uv.getX(i)*u/4/map.repeat.x,uv.getY(i)*v/4/map.repeat.y);
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
  type GroundPatch = { x0:number; x1:number; z0:number; z1:number; y:number; m:THREE.Material; batch:typeof geoByMat };
  let groundPatches: GroundPatch[] = [];
  function ground(x: number, z: number, w: number, d: number, m: THREE.Material, y = 0.02, ry = 0) {
    if (Math.abs(Math.sin(ry)) > 0.5) [w,d]=[d,w];
    const patch:GroundPatch={x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2,y,m,batch:geoByMat};
    const next:GroundPatch[]=[];
    for (const old of groundPatches) {
      if (old.batch!==patch.batch || Math.abs(old.y-y)>0.12 || old.x1<=patch.x0 || old.x0>=patch.x1 || old.z1<=patch.z0 || old.z0>=patch.z1) { next.push(old); continue; }
      const a=Math.max(old.x0,patch.x0),b=Math.min(old.x1,patch.x1),c=Math.max(old.z0,patch.z0),d0=Math.min(old.z1,patch.z1);
      if (a>old.x0) next.push({...old,x1:a});
      if (b<old.x1) next.push({...old,x0:b});
      if (c>old.z0) next.push({...old,x0:a,x1:b,z1:c});
      if (d0<old.z1) next.push({...old,x0:a,x1:b,z0:d0});
    }
    next.push(patch); groundPatches=next;
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
  function house(cx: number, cz: number, w: number, d: number, o: HouseOpts = {}) {
    const floors = o.floors ?? 1, fh = 3.2, H = floors * fh;
    const wm = o.wallMat ?? M.adobeWall;
    const x0 = cx - w / 2, z0 = cz - d / 2;
    const style = Math.abs(Math.round(cx*7+cz*11))%4;
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
      const n = g0 && (door === 'north' || door === 'south') ? [...noDoorOverlap(winRow(w), w), doorHole(w)] : winRow(w);
      const s = g0 && (door === 'north' || door === 'south') ? [...noDoorOverlap(winRow(w), w), doorHole(w)] : winRow(w);
      const ww = g0 && (door === 'west' || door === 'east') ? [...noDoorOverlap(winRow(d), d), doorHole(d)] : winRow(d);
      const e = g0 && (door === 'west' || door === 'east') ? [...noDoorOverlap(winRow(d), d), doorHole(d)] : winRow(d);
      const wi = windows.length;
      wallRun(true, x0, z0, w, fh, 0.5, n, wm, yb);
      for (let j = wi; j < windows.length; j++) windows[j].nz = -1;
      wallRun(true, x0, z0 + d, w, fh, 0.5, s, wm, yb);
      wallRun(false, x0, z0, d, fh, 0.5, ww, wm, yb);
      const ei = windows.length;
      wallRun(false, x0 + w, z0, d, fh, 0.5, e, wm, yb);
      for (let j = ei; j < windows.length; j++) windows[j].nx = 1;
      if (f > 0) {
        // West-wall stairwell is an actual opening, not a staircase into a solid slab.
        box(x0+2.9+(w-3.2)/2, yb + 0.12, cz, w-3.2, 0.24, d-0.6, M.concrete);
        box(x0+1.5,yb+0.12,z0+d-0.95,2.2,0.24,1.3,M.concrete);
        wood.push({ minX: x0, minY: yb - 0.2, minZ: z0, maxX: x0 + w, maxY: yb + 3, maxZ: z0 + d });
        // interior stair to upper floor (along west wall)
        // Exterior-style stair: large overlapping treads (0.22 rise, 0.55 run) so the player never wedges between steps
        const count=Math.ceil((fh+0.24)/0.22),rise=(fh+0.24)/count,run=(d-2.3)/count;
        for (let i=0;i<count;i++) box(x0+1.5,(f-1)*fh+(i+0.5)*rise,z0+0.7+i*run,2.2,rise,run+0.03,M.concrete);
      }
    }
    ground(cx, cz, w - 0.8, d - 0.8, M.tileFloor, 0.04);
    // Furnished corners leave the opposing doors and west stairwell clear.
    for (let f=0;f<floors;f++) {
      const fy=f ? f*fh+0.24 : 0.05;
      const bx=x0+w-1.35,bz=z0+1.65;
      const fabric=FABRIC[Math.abs(Math.round(cx+cz))%FABRIC.length];
      // Room identity follows the building, not a universal bedroom prefab.
      // Workshops get a workbench/tool chest; homes retain upholstered divans.
      if (style === 1 || style === 3) {
        box(bx,fy+0.85,bz,1.55,0.12,2.2,timber);
        for(const dx of [-0.6,0.6]) for(const dz of [-0.9,0.9]) box(bx+dx,fy+0.4,bz+dz,0.1,0.8,0.1,METAL,false);
        box(bx,fy+1.04,bz,0.7,0.25,0.6,style===1?METAL:M.sandbag,false);
        for(const dz of [-0.65,0.65]) shape(new THREE.CylinderGeometry(0.15,0.2,0.32,8),ACC_TERRA,bx,fy+1.07,bz+dz);
      } else {
      // Divan: raised wooden frame, thick upholstered cushion and pillows.
      box(bx,fy+0.22,bz,1.55,0.25,2.2,timber);
      box(bx,fy+0.42,bz,1.48,0.18,2.12,fabric);
      for (const dz of [-0.72,0.72]) box(bx,fy+0.57,bz+dz,1.28,0.18,0.46,M.sandbag,false);
      }
      // Writing table has open space below it, rather than a waist-high crate.
      const tx=x0+w-1.7,tz=z0+d-1.4;
      box(tx,fy+0.8,tz,2.0,0.10,0.9,timber);
      for (const dx of [-0.85,0.85]) for (const dz of [-0.32,0.32]) box(tx+dx,fy+0.38,tz+dz,0.10,0.76,0.10,timber,false);
      box(tx,fy+0.87,tz,0.62,0.025,0.42,M.concrete,false); // papers
      shape(new THREE.CylinderGeometry(0.08,0.07,0.15,10),METAL,tx+0.65,fy+0.92,tz);
      box(tx-0.3,fy+0.46,tz-0.9,0.55,0.10,0.55,timber);
      box(tx-0.3,fy+0.73,tz-1.14,0.55,0.52,0.07,timber,false);
      for (const dx of [-0.5,-0.1]) for (const dz of [-0.7,-1.1]) box(tx+dx,fy+0.21,tz+dz,0.07,0.42,0.07,timber,false);
      // Open bookcase: shelves, uprights, individually coloured books and clay pots.
      const sx=x0+w-0.48,sz=cz+((door==='east'||door==='west')?2.1:0);
      for (const dz of [-0.74,0.74]) box(sx,fy+0.95,sz+dz,0.36,1.9,0.08,timber);
      for (let row=0;row<4;row++) {
        box(sx,fy+0.15+row*0.52,sz,0.38,0.06,1.5,timber,false);
        for(let j=0;j<4;j++) box(sx,fy+0.32+row*0.52,sz-0.52+j*0.25,0.26,0.24+(j%2)*0.05,0.13,[timber,M.sandbag,fabric,METAL][(row+j)%4],false);
      }
      ground(cx+0.4,cz,Math.min(2.6,w-4),Math.min(3,d-4),fabric,fy+0.014);
      const rw=Math.min(2.6,w-4),rd=Math.min(3,d-4);
      for (const sign of [-1,1]) {
        shape(new THREE.PlaneGeometry(rw-0.12,0.045),M.sandbag,cx+0.4,fy+0.018,cz+sign*(rd/2-0.12),-Math.PI/2);
        shape(new THREE.PlaneGeometry(0.045,rd-0.12),M.sandbag,cx+0.4+sign*(rw/2-0.12),fy+0.018,cz,-Math.PI/2);
      }
      for(let i=-2;i<=2;i++) shape(new THREE.PlaneGeometry(0.23,0.23),M.sandbag,cx+0.4,fy+0.019,cz+i*0.4,-Math.PI/2,0,Math.PI/4);
      box(cx,fy+2.72,cz,0.13,0.13,d-0.5,timber,false);
      shape(new THREE.SphereGeometry(0.13,8,6),GLOW,cx,fy+2.54,cz);
    }
    // Architectural families: shaded shopfronts, shuttered homes, roof tanks and
    // brick arcades. Added parts stay outside existing doors and access stairs.
    const front=z0+d+0.34;
    if ((style===0 || style===2) && w>=10) {
      const n=Math.max(1,Math.floor(w/4)),gap=w/n;
      for(let j=0;j<n;j++) {
        const wx=x0+gap*(j+0.5);
        if ((door==='north'||door==='south') && Math.abs(wx-cx)<=2.2) continue;
        for(const side of [-1,1]) {
          box(wx+side*0.99,1.72,front,0.42,1.3,0.10,style===0?ACC_TURQ:timber,false);
          for(let i=0;i<3;i++) box(wx+side*0.99,1.30+i*0.40,front+0.065,0.40,0.06,0.035,METAL,false);
        }
      }
    } else {
      shape(new THREE.PlaneGeometry(w-1,2.2),FABRIC[style],cx,2.9,front+0.8,-Math.PI/2+0.14);
      for(const dx of [-w/2+0.8,w/2-0.8]) box(cx+dx,1.35,front+1.5,0.12,2.7,0.12,timber);
      box(cx,0.09,front+0.7,w-0.5,0.18,1.8,M.concrete);
    }
    if (style===2 && !o.roofAccess) {
      shape(new THREE.CylinderGeometry(0.85,0.85,1.6,12),ACC_TURQ,cx+w*0.22,H+1.1,cz);
      box(cx+w*0.22,H+0.3,cz,1.9,0.3,1.9,M.concrete);
    }
    if(style===3) for(let i=0;i<Math.floor(w/1.2);i++) box(x0+0.6+i*1.2,H+0.9,z0,0.6,0.55,0.45,earth);
    // cornice + parapet + door lintel
    box(cx, H + 0.15, cz, w + 0.5, 0.3, d + 0.5, M.concrete);
    box(cx, H + 0.65, z0, w + 0.5, 0.7, 0.35, earth);
    box(cx, H + 0.65, z0 + d, w + 0.5, 0.7, 0.35, earth);
    if (!o.roofAccess) box(x0, H + 0.65, cz, 0.35, 0.7, d + 0.5, earth);
    box(x0 + w, H + 0.65, cz, 0.35, 0.7, d + 0.5, earth);
    const lint = (x: number, z: number, lw: number, ld: number) => box(x, 2.68, z, lw, 0.22, ld, timber, false);
    if (door === 'south') lint(cx, z0 + d, 2.8, 0.7); if (door === 'north') lint(cx, z0, 2.8, 0.7);
    if (door === 'east') lint(x0 + w, cz, 0.7, 2.8); if (door === 'west') lint(x0, cz, 0.7, 2.8);
    box(cx, fh - 0.3, z0 - 0.28, w + 0.5, 0.18, 0.06, ACC_TURQ, false);
    box(cx, fh - 0.3, z0 + d + 0.28, w + 0.5, 0.18, 0.06, ACC_TERRA, false);
    if (o.roofAccess) {
      stairs(x0 - 1.6, z0 + 2, H + 0.3, 2.8, 'z');
      box(x0 - 0.9, H + 0.16, z0 + 2, 2.8, 0.28, 3, M.concrete);
      overlooks.push({ name: 'Souk roof', at: new THREE.Vector3(cx, H + 0.3, cz), approach: new THREE.Vector3(x0 - 1.6, 0, z0 + 2 + (H + 0.3) * 2.5 + 1), route: [new THREE.Vector3(x0 - 1.6, H + 0.3, z0 + 2), new THREE.Vector3(cx,H + 0.3,cz)] });
    }
    interiors.push({ minX: x0, minY: 0, minZ: z0, maxX: x0 + w, maxY: H + 2, maxZ: z0 + d });
    if (o.light !== false) lightSpots.push(new THREE.Vector3(cx, 2.4, cz));

    cover(x0 - 1, cz); cover(x0 + w + 1, cz); cover(cx, z0 - 1); cover(cx, z0 + d + 1);
    return { x0, z0, H };
  }

  // ---- props ----
  function lamp(x: number, z: number) {
    shape(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), METAL, x, 1.8, z);
    solids.push({ minX: x - .1, minY: 0, minZ: z - .1, maxX: x + .1, maxY: 3.6, maxZ: z + .1 });
    box(x + 0.45, 3.5, z, 0.9, 0.05, 0.05, METAL, false);
    shape(new THREE.SphereGeometry(0.14, 10, 8), GLOW, x + 0.88, 3.45, z);
  }
  function palm(x: number, z: number, s = 1) {
    shape(new THREE.CylinderGeometry(0.18 * s, 0.3 * s, 6 * s, 8), timber, x, 3 * s, z, 0, 0, 0.05);
    solids.push({ minX: x - .35, minY: 0, minZ: z - .35, maxX: x + .35, maxY: 5.5 * s, maxZ: z + .35 });
    for (let f = 0; f < 7; f++) shape(new THREE.PlaneGeometry(3 * s, 0.6 * s), FROND, x, 6 * s, z, 0, (f / 7) * Math.PI * 2, -0.55);
    shape(new THREE.SphereGeometry(0.35 * s, 8, 6), col(0x5A3A1A), x, 5.9 * s, z);
  }
  function marketRows(baseX: number, baseZ: number, rows = 2, perRow = 4, spacing = 6) {
    ground(baseX, baseZ + (rows - 1) * 3, perRow * spacing + 4, rows * 6 + 6, pavers, 0.025);
    for (let r = 0; r < rows; r++) for (let s = 0; s < perRow; s++) {
      const sx = baseX - ((perRow - 1) * spacing) / 2 + s * spacing, rz = baseZ + r * 6;
      box(sx, 0.55, rz, 2.6, 1.1, 1.4, timber);
      for (const [ox, oz] of [[-1.4, -.9], [1.4, -.9], [-1.4, .9], [1.4, .9]] as const) shape(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), METAL, sx + ox, 1.3, rz + oz);
      shape(new THREE.PlaneGeometry(3.2, 2.4), FABRIC[(r * perRow + s) % FABRIC.length], sx, 2.55, rz, -Math.PI / 2 + 0.12);
      for (let g = 0; g < 3; g++) shape(new THREE.SphereGeometry(0.16, 6, 5), col(0xC7A24B + g * 0x102030), sx - 0.6 + g * 0.6, 1.2, rz);
      cover(sx, rz + 2.2);
    }
    lightSpots.push(new THREE.Vector3(baseX, 2.4, baseZ + 3));
  }
  function mosque(mx: number, mz: number) {
    const w = 14, d = 13, h = 4.8;
    const northWindows = windows.length;
    wallRun(true, mx - w / 2, mz - d / 2, w, h, 0.6, [[4, 7, 0, 3.0], [10, 12, 1.2, 2.8]], M.whitewash, 0, true);
    for (let i = northWindows; i < windows.length; i++) windows[i].nz = -1;
    wallRun(true, mx - w / 2, mz + d / 2, w, h, 0.6, [[5.5, 8.5, 0, 3.2]], M.whitewash);
    wallRun(false, mx - w / 2, mz - d / 2, d, h, 0.6, [[4.5, 7.5, 1.2, 2.8]], M.whitewash);
    const eastWindows = windows.length;
    wallRun(false, mx + w / 2, mz - d / 2, d, h, 0.6, [[4.5, 7.5, 1.2, 2.8]], M.whitewash);
    for (let i = eastWindows; i < windows.length; i++) windows[i].nx = 1;
    ground(mx, mz, w - 1, d - 1, M.tileFloor, 0.04);
    box(mx, h + 0.2, mz, w + 0.6, 0.35, d + 0.6, M.concrete);
    shape(new THREE.SphereGeometry(4.8, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), ACC_TURQ, mx, h + 0.1, mz);
    shape(new THREE.ConeGeometry(0.5, 1.2, 12), GLOW, mx, h + 5.1, mz);
    for (const [tx, tz] of [[mx - w / 2 - 1.6, mz - d / 2 - 1.6], [mx + w / 2 + 1.6, mz + d / 2 + 1.6]] as const) {
      box(tx, 4.4, tz, 1.1, 8.8, 1.1, M.whitewash);
      shape(new THREE.ConeGeometry(0.8, 1.4, 10), ACC_TURQ, tx, 9.5, tz);
      shape(new THREE.SphereGeometry(0.18, 8, 6), GLOW, tx, 9.1, tz);
    }
    box(mx + 3.5, 0.5, mz - 2.5, 1.8, 1.0, 1.0, timber); box(mx - 3.5, 0.5, mz + 2.5, 1.8, 1.0, 1.0, M.sandbag);
    interiors.push({ minX: mx - w / 2, minY: 0, minZ: mz - d / 2, maxX: mx + w / 2, maxY: h + 4, maxZ: mz + d / 2 });
    lightSpots.push(new THREE.Vector3(mx, 3, mz));
    cover(mx + 3.5, mz - 1); cover(mx - 3.5, mz + 1); cover(mx - w / 2 - 1.2, mz); cover(mx + w / 2 + 1.2, mz);
  }
  // ---- streets ----
  function street(alongX: boolean, pos: number, from: number, to: number, w = 12) {
    const len = to - from, mid = (from + to) / 2;
    if (alongX) {
      ground(mid, pos, w, len, M.asphalt, 0.02, Math.PI / 2);
      concrete.push({ minX: from, minY: -1, minZ: pos - w / 2, maxX: to, maxY: 3, maxZ: pos + w / 2 });
    } else {
      ground(pos, mid, w, len, M.asphalt, 0.02);
      concrete.push({ minX: pos - w / 2, minY: -1, minZ: from, maxX: pos + w / 2, maxY: 3, maxZ: to });
    }
    // lamps on the verge, every 32m — never on the carriageway
    for (let s = from + 16; s < to - 8; s += 32) {
      if (alongX) { lamp(s, pos - w / 2 - 1.6); lamp(s + 16, pos + w / 2 + 1.6); }
      else { lamp(pos - w / 2 - 1.6, s); lamp(pos + w / 2 + 1.6, s + 16); }
    }
  }
  function terrain(size: number, inner: number) {
    const coordinates: number[] = [];
    if (mapId === 'kasbah') {
      for (let i = 0; i <= 48; i++) coordinates.push(i * size / 48 - size / 2);
    } else {
      for (let x = -size / 2; x <= size / 2; x += 2) if (Math.abs(x) <= 120 || x % 20 === 0) coordinates.push(x);
    }
    const n = coordinates.length - 1;
    const g = new THREE.PlaneGeometry(size, size, n, n);
    for (let row = 0; row <= n; row++) for (let column = 0; column <= n; column++) {
      g.attributes.position.setXY(row * (n + 1) + column, coordinates[column], -coordinates[row]);
    }
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), r = Math.max(Math.abs(x), Math.abs(y));
      const e = Math.max(0, (r - inner) / 60);
      p.setZ(i, terrainHeight(x, -y) + e * (Math.sin(x * 0.04) * 1.5 + Math.cos(y * 0.045) * 1.7 + e * 1.8));
    }
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);
    // Distinct ground: alrasul = sand/wadi, kasbah = stone/rocky terrace
    push(g, isKasbah ? (M.stoneBlock ?? M.sand) : M.sand);
  }
  function perimeter(half: number) {
    const pm = M.adobeBrick;
    box(-half / 2 - 4, 2.6, -half, half - 8, 5.2, 1.8, pm); box(half / 2 + 4, 2.6, -half, half - 8, 5.2, 1.8, pm);
    box(-half / 2 - 4, 2.6, half, half - 8, 5.2, 1.8, pm); box(half / 2 + 4, 2.6, half, half - 8, 5.2, 1.8, pm);
    box(-half, 2.6, 0, 1.8, 5.2, 2 * half, pm); box(half, 2.6, 0, 1.8, 5.2, 2 * half, pm);
    for (const [tx, tz] of [[-8, -half], [8, -half], [-8, half], [8, half]] as const) { box(tx, 3.8, tz, 3.2, 7.6, 3.2, pm); box(tx, 7.8, tz, 3.8, 0.7, 3.8, earth); }
    for (const [tx, tz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) box(tx, 4.2, tz, 4, 8.4, 4, pm);
  }

  // Authored elevation: objective corridors stay ground-connected; player-only terraces
  // surround them. The riverbed has a continuous ramped profile, shared with physics.
  const terrainHeight = (x: number, z: number) => {
    if (mapId !== 'alrasul') return 0;
    const edgeFade=Math.max(0,Math.min(1,(118-Math.abs(x))/14));
    if(edgeFade===0) return 0;
    const distance = Math.abs(z + 0.22 * x);
    return -2.5 * edgeFade * Math.max(0, Math.min(1, (12 - distance) / 5));
  };
  const groundHeight = terrainHeight;
  const navigationHeight = (x: number, z: number) => {
    if (mapId === 'alrasul' && (Math.abs(x + 12) < 6.5 || (!changed && Math.abs(x - 48) < 2))) return 0;
    return terrainHeight(x, z);
  };
  function state(wreck: boolean, build: () => void) {
    const previous = geoByMat;
    const destination = wreck ? wreckGroup : intactGroup;
    let batch = stateGeometry.find(b => b.group === destination);
    if (!batch) { batch = { geos: new Map(), group: destination, meshes: wreck ? wreckMeshes : intactMeshes }; stateGeometry.push(batch); }
    geoByMat = batch.geos;
    const start = solids.length;
    build();
    (wreck ? wreckSolids : intactSolids).push(...solids.slice(start));
    geoByMat = previous;
  }
  function paved(x: number, z: number, w: number, d: number, m = pavers, y = 0.035) {
    ground(x, z, w, d, m, y);
    concrete.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y - 0.2, maxY: y + 2 });
  }
  // One continuous climb with a landing, not a decorative ladder you cannot use.
  function stairs(x: number, z: number, height: number, width = 3, axis: 'x' | 'z' = 'z', base = 0) {
    const n = Math.ceil(height / 0.28), run = height * 2.5 / n;
    for (let i = 0; i < n; i++) {
      const h = height * (n - i) / n;
      box(x + (axis === 'x' ? i * run : 0), base + h / 2, z + (axis === 'z' ? i * run : 0), axis === 'x' ? run + 0.03 : width, h, axis === 'z' ? run + 0.03 : width, M.concrete);
    }
  }
  function sign(x: number, y: number, z: number, index: number, width = 5, angle = 0) {
    const g = new THREE.PlaneGeometry(width, width * 78 / 512);
    const uv = g.attributes.uv;
    for (let i=0;i<uv.count;i++) uv.setXY(i, (index%2 + uv.getX(i))/2, 1 - (Math.floor(index/2)*80 + (1-uv.getY(i))*78)/512);
    shape(g, M.signage ?? ACC_TURQ, x, y, z, 0, angle);
  }
  function banner(x: number, z: number, y: number, color = ACC_TURQ) {
    box(x, y + 1.5, z, 0.09, 4, 0.09, METAL, false);
    // A folded, not perfectly flat, cloth silhouette; baked into the accent batch.
    for (let i = 0; i < 6; i++) {
      shape(new THREE.PlaneGeometry(0.45, 2.2), color, x + 0.2 + i * 0.4, y + 2, z + Math.sin(i * 1.7) * 0.13, 0, Math.sin(i) * 0.2);
    }
  }
  function archway(x: number, z: number, width = 6, depth = 1.5, material = stone, base = 0) {
    const r = width / 2;
    box(x - r - 0.7, base + 2, z, 1.4, 4, depth, material);
    box(x + r + 0.7, base + 2, z, 1.4, 4, depth, material);
    // Voussoirs carry the silhouette; collision lintel clears the full player capsule.
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
      const sh = new THREE.Shape();
      sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      sh.lineTo(Math.cos(a) * (r + 0.7), Math.sin(a) * (r + 0.7));
      sh.lineTo(Math.cos(b) * (r + 0.7), Math.sin(b) * (r + 0.7));
      sh.lineTo(Math.cos(b) * r, Math.sin(b) * r); sh.closePath();
      shape(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), material, x, base + 3, z - depth / 2);
    }
    box(x, base + r + 3.6, z, width + 2.8, 0.4, depth + 0.2, material);
  }
  function sandbags(x: number, z: number, alongX = true) {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
      const offset = (i - 1.5) * 0.9 + (row % 2) * 0.15;
      box(x + (alongX ? offset : 0), 0.18 + row * 0.31, z + (alongX ? 0 : offset), alongX ? 0.86 : 0.65, 0.32, alongX ? 0.65 : 0.86, M.sandbag);
    }
    cover(x + (alongX ? 0 : 1.4), z + (alongX ? 1.4 : 0));
    cover(x - (alongX ? 0 : 1.4), z - (alongX ? 1.4 : 0));
  }
  function overlook(name: string, x: number, z: number, h: number, w = 7, d = 7, material = stone, access: 'south' | 'east' | 'south-east' = 'south') {
    box(x, h / 2, z, w, h, d, material);
    box(x, h + 0.5, z - d / 2, w, 1, 0.55, material);
    if (access !== 'east') box(x + w / 2, h + 0.5, z, 0.55, 1, d, material);
    const sx = access === 'east' ? x + w / 2 + 0.1 : access === 'south-east' ? x + w / 2 - 1.6 : x - w / 2 + 1.6;
    const sz = access === 'east' ? z : z + d / 2 + 0.1;
    stairs(sx, sz, h, 3, access === 'east' ? 'x' : 'z');
    overlooks.push({ name, at: new THREE.Vector3(x, h, z), approach: new THREE.Vector3(sx + (access === 'east' ? h*2.5+1 : 0), 0, sz + (access === 'east' ? 0 : h*2.5+1)), route: [new THREE.Vector3(sx,h,sz),new THREE.Vector3(x,h,z)] });
    banner(x + w / 2, z - d / 2, h);
  }
  function courtyardShelter(x: number, z: number) {
    for (const dx of [-2,2]) for (const dz of [-1.2,1.2]) box(x+dx,1.5,z+dz,0.16,3,0.16,timber);
    shape(new THREE.PlaneGeometry(4.6,3.1),FABRIC[0],x,3,z,-Math.PI/2+0.08);
    box(x,0.48,z+1,3.4,0.16,0.6,timber);
    for (const dx of [-1.35,1.35]) box(x+dx,0.22,z+1,0.15,0.44,0.5,timber);
    cover(x-2.6,z); cover(x+2.6,z);
  }
  function mast(x: number, z: number, y: number, h: number) {
    for (const dx of [-0.7, 0.7]) box(x + dx, y + h / 2, z, 0.18, h, 0.18, METAL);
    for (let i = 0; i < h; i += 2) {
      shape(new THREE.BoxGeometry(2.3, 0.1, 0.12), METAL, x, y + i + 0.8, z, 0, 0, i % 4 ? 0.9 : -0.9);
    }
    box(x, y + h - 2, z, 6, 0.15, 0.15, METAL, false);
    shape(new THREE.SphereGeometry(0.3, 8, 6), GLOW, x, y + h, z);
  }
  function smoke(x: number, z: number, y: number, large = false) {
    // Static dust/smoke plume, no particles, lights or update allocations.
    for (let i = 0; i < 5; i++) {
      const r = (large ? 1.5 : 0.65) + i * 0.35;
      shape(new THREE.IcosahedronGeometry(r, 1), smokeMaterial, x + i * 0.6, y + i * 1.6, z + i * 0.15);
    }
  }
  function kiln(x: number, z: number) {
    shape(new THREE.CylinderGeometry(1.7, 2.4, 3, 12), brick, x, 1.5, z);
    solids.push({ minX: x - 2, maxX: x + 2, minY: 0, maxY: 3, minZ: z - 2, maxZ: z + 2 });
    box(x, 0.8, z + 2, 1.3, 1.3, 0.12, METAL, false);
    box(x, 0.55, z + 2.09, 1, 0.5, 0.08, col(0xff5a1e, 0.8, 0, 2), false);
    shape(new THREE.CylinderGeometry(0.6, 0.9, 5, 10), brick, x, 5.2, z);
    smoke(x, z, 8);
    cover(x + 3.5, z); cover(x - 3.5, z);
  }
  function wagon(x: number, z: number, color: THREE.Material) {
    box(x, 1.9, z, 4, 3, 12, color);
    box(x, 3.5, z, 4.3, 0.22, 12.2, iron);
    for (const dz of [-4, 4]) for (const dx of [-2, 2]) shape(new THREE.CylinderGeometry(0.65, 0.65, 0.3, 10), METAL, x + dx, 0.65, z + dz, 0, 0, Math.PI / 2);
    for (let dz = -5; dz <= 5; dz += 2) box(x + 2.02, 1.9, z + dz, 0.08, 2.8, 0.12, METAL, false);
    cover(x - 3.5, z); cover(x + 3.5, z);
  }

  const playerSpawn = new THREE.Vector3();
  const half = mapId === 'alrasul' ? 124 : 134;
  terrain(520, half + 12);
  perimeter(half);
  for (const side of [-1,1]) {
    const edge=side*(half-12);
    for(const z of [-65,58]) {
      house(edge,z,11,13,{floors:2,wallMat:side<0?M.whitewash:earth,door:side<0?'east':'west'});
      paved(edge-side*9,z,7,19,cobble);
      for(const dz of [-5,5]) { box(edge-side*8,0.32,z+dz,1.5,0.64,1.1,timber); cover(edge-side*10,z+dz); }
      lamp(edge-side*10,z-8);
    }
    // New connecting lanes run outside the old built-up district.
    const laneX=side*(half-23),end=half*0.8;
    if(mapId==='alrasul') {
      const centre=-0.22*laneX;
      // End paving at the banks; never suspend a non-colliding road over the wadi.
      paved(laneX,(-end+centre-14)/2,7,centre-14+end,cobble);
      paved(laneX,(end+centre+14)/2,7,end-centre-14,cobble);
    } else paved(laneX,0,7,half*1.6,cobble);
  }


  if (mapId === 'alrasul') {
    playerSpawn.set(-12, 0, 94);
    // Inhabited edges, authored in small offset clusters rather than a repeating tile grid.
    for (const [x,z,w,d] of [[-86,-88,12,12],[-63,-89,12,12],[-32,-68,10,9],[-7,-59,8,12],[22,-60,10,10],[45,-85,12,12],[88,-48,12,14],[62,-43,12,12],[72,-18,12,10],[-87,-8,12,12],[-60,-10,12,10],[-36,-17,10,8],[-57,37,12,13],[-54,67,11,12],[-87,43,12,12],[-87,77,11,13],[-36,26,10,11],[1,82,10,12]] as const) {
      house(x,z,w,d,{wallMat: x < -50 ? earth : M.whitewash, door: z < 0 ? 'south' : 'east'});
    }
    // Infiltration grammar: checkpoint -> road bridge -> the old town's teal dome.
    street(false, -12, 16, 102, 10);
    street(false, -12, -98, -14, 9);
    street(true, 72, -18, 93, 10);
    ground(-61,57,26,5,M.dirtPath ?? earth,0.025);
    paved(-12, 21, 32, 22);
    // Wadi sediment follows the diagonal bed; the banks themselves are terrain, not a decal illusion.
    for (let x = -100; x <= 100; x += 4) {
      ground(x, -0.22 * x, 4.1, 13, dryBed, -2.46);
      concrete.push({ minX: x - 2, maxX: x + 2, minZ: -0.22 * x - 7, maxZ: -0.22 * x + 7, minY: -2.6, maxY: -0.5 });
      if (x % 20 === 0 && Math.abs(x + 12) > 12 && Math.abs(x - 48) > 8) {
        shape(new THREE.DodecahedronGeometry(1.1, 0), stone, x, -1.8, -0.22 * x + 3);
      }
    }
    // Road bridge is supported at grade; enemy nav stays on its ordinary 2m grid.
    box(-12, -0.35, 2.64, 13, 0.7, 28, M.concrete);
    for (const x of [-17.7,-6.3]) for(const z of [-5,10]) box(x,-1.45,z,0.8,1.5,1.1,stone);
    for (const x of [-18.2, -5.8]) for (const z of [-8, -2, 4, 10, 16]) box(x, 0.55, z, 0.65, 1.1, 4.8, stone);
    for (const x of [-19, -5]) { lamp(x, -12); lamp(x, 18); }
    paved(-12, 2.6, 11, 28, cobble, 0.025);
    // A fragile, deliberately exposed second crossing, destroyed in one event.
    state(false, () => {
      box(48, -0.2, -10.56, 4, 0.4, 28, timber);
      for (let z = -24; z <= 3; z += 3) for (const x of [46.1, 49.9]) box(x, 0.65, z, 0.12, 1.3, 0.12, ACC_TERRA, false);
      for (const x of [46.1, 49.9]) box(x, 1.15, -10.56, 0.09, 0.09, 28, ACC_TERRA, false);
    });
    wood.push({ minX: 46, maxX: 50, minZ: -25, maxZ: 4, minY: -0.3, maxY: 2 });
    state(true, () => {
      for (let i = 0; i < 7; i++) shape(new THREE.BoxGeometry(3.5, 0.25, 2.8), ACC_TERRA, 47 + Math.sin(i) * 1.8, -1.7 + i % 2 * 0.3, -20 + i * 3, 0, i * 0.5, 0.25);
      box(48, -1.7, -10, 3.5, 1.5, 4, ACC_TERRA);
      smoke(48, -10, -0.5, true);
    });
    // Old souk: varying-width covered streets, a well plaza and through-house flanks.
    paved(-29, -43, 45, 33, cobble);
    courtyardShelter(-29, -43);
    marketRows(-31, -57, 2, 5, 6);
    marketRows(5, -43, 3, 3, 6);
    mosque(-60, -43);
    archway(-60, -34, 5, 1, M.whitewash);
    mast(-70, -49, 8, 10);
    for (const [x, z, w, d] of [[-47, -78, 13, 12], [-17, -81, 12, 10], [17, -76, 14, 12]] as const) house(x, z, w, d, { roofAccess: true, wallMat: earth, door: 'south' });
    house(-77, -73, 12, 12, { wallMat: M.whitewash, door: 'east' });
    house(41, -53, 12, 14, { wallMat: M.whitewash, door: 'south' });
    house(72, -71, 16, 14, { wallMat: earth, door: 'west' });
    // Arched, open colonnade frames the well; no collision across the aisle.
    for (let x = -43; x <= -19; x += 8) archway(x, -29, 5, 2, earth);
    for (const [x,z] of [[-45,-39],[-18,-33],[14,-53],[37,-73],[-78,-21]]) { palm(x,z); banner(x+2,z,1); }
    // Garrison: L-shaped armory approach, broad gate, two usable ramparts.
    paved(33, 39, 48, 40, M.concrete);
    wallRun(true, 10, 20, 48, 4.5, 1.2, [[8, 17, 0, 4.5]], M.adobeBrick, 0, false);
    archway(22.5, 20, 7.6, 2.5, M.adobeBrick);
    wallRun(true, 10, 60, 48, 4.5, 1.2, [[20, 28, 0, 4.5]], M.adobeBrick, 0, false);
    wallRun(false, 10, 20, 40, 4.5, 1.2, [[19, 27, 0, 4.5]], M.adobeBrick, 0, false);
    wallRun(false, 58, 20, 40, 4.5, 1.2, [[22, 30, 0, 4.5]], M.adobeBrick, 0, false);
    overlook('Fort west rampart', 7, 22, 4.5, 7, 8, M.adobeBrick);
    overlook('Fort east watchtower', 60, 18, 6, 7, 8, M.adobeBrick, 'south-east');
    // Armory is a real lit shelter, wide open on two sides, objective clear of furniture.
    box(43, 3.9, 38, 18, 0.3, 13, iron);
    box(43, 1.9, 31.5, 18, 3.8, 0.5, iron);
    box(52, 1.9, 38, 0.5, 3.8, 13, iron);
    box(39, 0.7, 40, 3, 1.4, 1, timber);
    lightSpots.push(new THREE.Vector3(45, 2.8, 36));
    box(44, 3.5, 36, 1.5, 0.12, 0.12, GLOW, false);
    interiors.push({ minX:34,maxX:52,minZ:31,maxZ:45,minY:0,maxY:4 });
    sandbags(25, 33); sandbags(33, 53); banner(11,20,5,ACC_TERRA);
    // Rail depot: three freight lanes, loading deck and crane, leaving a clear LZ exit.
    paved(77, 43, 35, 46, M.concrete);
    for (const x of [68, 79, 90]) {
      for (const dx of [-1.1, 1.1]) box(x + dx, 0.06, 46, 0.1, 0.12, 47, METAL, false);
      for (let z = 23; z < 70; z += 2) box(x, 0.035, z, 3.5, 0.07, 0.24, timber, false);
      wagon(x, x === 79 ? 50 : 36, x === 79 ? ACC_TURQ : ACC_TERRA);
    }
    overlook('Depot loading crane', 91, 61, 3.4, 6, 8, M.concrete);
    mast(94,61,3.4,13); box(88,15,61,16,0.5,0.5,METAL,false);
    box(81,11.2,61,0.08,7.5,0.08,METAL,false);
    // Icon: a 25m municipal tank on braced legs, with exposed stair-access gallery.
    const tx = 52, tz = 83;
    for (const dx of [-4,4]) for (const dz of [-4,4]) {
      box(tx+dx,8,tz+dz,0.6,16,0.6,METAL);
      shape(new THREE.BoxGeometry(0.18,11.4,0.18),METAL,tx,5.5,tz+dz,0,0,dx>0?0.8:-0.8);
    }
    box(tx,8,tz,10,0.35,10,METAL);
    stairs(tx+5.1,tz,8.175,3,'x');
    overlooks.push({name:'Water tower gallery',at:new THREE.Vector3(tx,8.175,tz),approach:new THREE.Vector3(tx+27,0,tz),route:[new THREE.Vector3(tx+5.1,8.175,tz),new THREE.Vector3(tx,8.175,tz)]});
    box(tx-3,8,tz+4.5,3,0.35,3,METAL);
    box(tx-4.8,8.7,tz,0.12,1.2,10,METAL);
    for (const z of [tz-3.5,tz+3.5]) box(tx+4.8,8.7,z,0.12,1.2,3,METAL);
    shape(new THREE.CylinderGeometry(5.8,5.8,6.5,24),ACC_TURQ,tx,19,tz);
    shape(new THREE.ConeGeometry(6.1,2.2,24),iron,tx,23.3,tz);
    for (const y of [16,19,22]) shape(new THREE.TorusGeometry(5.85,0.12,6,24),METAL,tx,y,tz,Math.PI/2);
    box(tx+5.9,17.5,tz,0.18,17,0.18,METAL,false);
    banner(tx-4,tz-4,10,ACC_TERRA);
    // Municipal paint bands and a readable serial make the tank a navigational identity.
    shape(new THREE.CylinderGeometry(5.88,5.88,1.1,24,1,true),col(0xd8ccb2),tx,20.3,tz);
    sign(tx,18.6,tz+5.9,0,9);
    sign(tx,18.6,tz-5.9,0,9,Math.PI);
    sign(22.5,6.8,21.5,1,7);
    sign(-29,6.8,-27.8,2,7);
    sign(69,4.5,69,11,6);
    sign(52,2,73,3,6);
    // A painted, collision-free LZ and a windsock signal the alternate exit.
    shape(new THREE.RingGeometry(4.6,4.8,32),col(0xd8ccb2),53,0.05,73,-Math.PI/2);
    for (const x of [51.8,54.2]) ground(x,73,0.25,3,col(0xd8ccb2),0.055);
    ground(53,73,2.5,0.25,col(0xd8ccb2),0.055);
    mast(61,74,0,6); shape(new THREE.ConeGeometry(0.5,2.3,8,1,true),ACC_TERRA,61.9,5.9,74,0,0,-Math.PI/2);
    landmarks.push({name:'Water tower',at:new THREE.Vector3(tx,24,tz)},{name:'Old souk',at:new THREE.Vector3(-60,10,-43)});
    // Quiet checkpoint, wreck and telegraph poles on the insertion road.
    house(-31,68,10,10,{wallMat:M.whitewash,door:'east'});
    box(-27.7,0.98,71.6,0.58,0.16,0.38,METAL,false);
    box(-27.7,1.065,71.6,0.4,0.015,0.25,ACC_TURQ,false);
    sandbags(-23,57); sandbags(-3,57);
    wagon(-37,88,ACC_TERRA);
    for (const z of [45,72,94]) { mast(-23,z,0,7); }
    for (const [x,z] of [[-48,37],[-71,59],[-76,89]]) house(x,z,12,12,{wallMat:earth,door:'east'});
    for (const [x,z] of [[-22,23],[0,26],[-35,-22],[-8,-33],[18,-22],[41,5],[77,76],[-52,24]]) sandbags(x,z);
    state(true, () => { ground(46,36,11,9,col(0x39352e),0.07); smoke(46,36,3,true); });
  } else {
    playerSpawn.set(0,0,100);
    // Residential shoulders enclose the industries without paving over their trades.
    for(const [x,z,w,d] of [[-95,85,12,12],[-73,91,11,10],[-93,52,11,13],[-95,-70,12,12],[-77,-88,12,12],[-49,-91,13,11],[45,-96,10,12],[93,-83,12,13],[99,-5,10,14],[85,18,12,10],[62,94,13,10],[20,80,10,10],[-18,57,10,12]] as const) {
      house(x,z,w,d,{wallMat: z < 0 ? earth : brick,door: x < 0 ? 'east' : 'west'});
    }
    box(-14.7,0.98,61.6,0.58,0.16,0.38,METAL,false);
    box(-14.7,1.065,61.6,0.4,0.015,0.25,ACC_TURQ,false);
    // Roads are authored switchbacks, not concentric circular decals with square radar bounds.
    ground(-52,64,28,6,M.dirtPath ?? earth,0.025);
    paved(0,76,10,63,cobble); paved(24,49,58,10,cobble);
    paved(49,13,10,80,cobble); paved(21,-23,64,10,cobble);
    paved(0,-51,10,62,cobble); paved(-47,-74,100,9,cobble);
    paved(-67,-37,10,77,cobble); paved(-76,0,68,10,cobble);
    paved(-35,8,10,57,cobble); paved(-16,34,46,10,cobble);
    // Citadel: raised stone shoulders around a navigable ground-floor ravine court.
    // This deliberately preserves ground-only mission/nav contracts while giving real 2.5/5m terraces.
    overlook('Citadel south terrace',20,17,2.5,18,15);
    overlook('Citadel east rampart',29,-5,5,9,18,stone,'east');
    overlook('Citadel west rampart',-23,-7,5,9,20);
    paved(0,3,34,42,pavers);
    // Open courtyard: the fountain and its oversized collision box are gone.
    marketRows(-8, 16, 1, 2, 7);
    house(0,-21,24,14,{floors:2,wallMat:stone,door:'south'});
    // The keep crown rises above the upper terrace. Crenellations break the skyline.
    box(0,10.5,-23,26,8,12,stone);
    for (const x of [-14,14]) {
      box(x,10,-27,6,20,6,stone);
      for (const dx of [-2,0,2]) box(x+dx,20.6,-29,1,1.2,1,stone);
      banner(x-2,-24,17,ACC_TURQ);
    }
    for (let x=-11;x<=11;x+=2.5) box(x,15,-28,1.2,1.2,0.9,stone);
    archway(0,-12,7,2,stone);
    mast(0,-25,14.5,16);
    for (const x of [-10,-6,6,10]) box(x,2.5,-13.3,1.2,5,1.6,stone);
    sign(0,9.3,-16.9,4,11);
    landmarks.push({name:'Citadel signal keep' ,at:new THREE.Vector3(0,31,-25)});
    overlook('Signal terrace',18,-40,7.5,12,10,stone,'east');
    // Ground armory side court, lit and open to the south and east.
    box(15,3.6,-11,8,0.35,9,iron);
    box(15,1.8,-15.5,8,3.6,0.6,stone);
    lightSpots.push(new THREE.Vector3(17,2.8,-10));
    box(16,3.2,-11,1.4,0.12,0.12,GLOW,false);
    sandbags(7,18); sandbags(-11,-2);
    // SW / kiln quarter: broken orange silhouettes, stacked brick and glowing fire mouths.
    for (const [x,z] of [[-49,53],[-66,62],[-46,77]]) kiln(x,z);
    for (const [x,z] of [[-58,45],[-72,78],[-35,65]]) { box(x,0.7,z,5,1.4,2,brick);cover(x,z+2.5); }
    overlook('Kiln terrace',-77,36,2.5,20,13,brick);
    banner(-58,55,1,ACC_TERRA);
    // W / caravanserai: teal arcades, a generous well court and covered stables.
    paved(-63,3,33,34,pavers); courtyardShelter(-63,3);
    for (const z of [-11,17]) {
      for (const x of [-76,-66,-56]) archway(x,z,7,3,stone);
      box(-66,7,z,32,0.35,7,stone);
    }
    for (const x of [-79,-47]) wallRun(false,x,-8,22,4.8,0.8,[[4,12,0,3.4]],earth,0,false);
    banner(-78,-12,6); banner(-48,17,5);
    lightSpots.push(new THREE.Vector3(-65,3,-10));
    overlook('Caravan gallery',-84,-35,5,8,16);
    // NW / granary: three silo domes, ochre bands, a hoist over the shortcut.
    paved(-46,-48,34,28,cobble);
    for (const x of [-56,-44,-32]) {
      shape(new THREE.CylinderGeometry(4,4.8,8,16),earth,x,4,-52);
      shape(new THREE.SphereGeometry(4.05,16,8,0,Math.PI*2,0,Math.PI/2),FABRIC[3],x,8,-52);
      solids.push({minX:x-4.5,maxX:x+4.5,minZ:-56.5,maxZ:-47.5,minY:0,maxY:9});
      shape(new THREE.TorusGeometry(4.2,0.12,6,16),ACC_TERRA,x,6,-52,Math.PI/2);
      cover(x,-45);
    }
    banner(-32,-43,3,FABRIC[3]);
    // Hoist falls across a shortcut; the wider west switchback remains connected.
    state(false,()=>{
      box(-49,5,-27,0.7,10,0.7,ACC_TERRA);
      box(-43,9.7,-27,13,0.6,0.6,ACC_TERRA);
      box(-38,6,-27,0.08,7,0.08,METAL,false);
      box(-38,3.1,-27,2.6,1.5,2.6,ACC_TERRA);
    });
    state(true,()=>{
      box(-43,1.2,-27,14,2.4,3.2,ACC_TERRA);
      for(let i=0;i<5;i++) shape(new THREE.BoxGeometry(2,0.5,2),FABRIC[3],-48+i*2.5,2,-27,0,i*0.4,0.3);
      smoke(-44,-27,2,true);
    });
    // N / covered market: three dense rows, indigo/ochre canopies, lit transverse alleys.
    paved(14,-73,44,35,cobble);
    marketRows(16,-86,3,5,6);
    house(-15,-87,12,12,{roofAccess:true,wallMat:earth,door:'south'});
    for(const x of [4,16,28]) banner(x,-91,2,FABRIC[1]);
    // NE / tannery: open dye vats, plum drying cloth, low cover and long exposed lanes.
    paved(68,-53,38,34,pavers);
    for(const x of [58,70,82]) for(const z of [-62,-49]) {
      shape(new THREE.CylinderGeometry(3.3,3.3,0.65,12),stone,x,0.325,z);
      shape(new THREE.CircleGeometry(2.9,16),FABRIC[4],x,0.66,z,-Math.PI/2);
      solids.push({minX:x-3,maxX:x+3,minZ:z-3,maxZ:z+3,minY:0,maxY:0.65});
      cover(x,z+4.5);
    }
    for(const x of [56,68,80]) { banner(x,-35,1,FABRIC[4]);box(x,1.4,-35,4,0.14,0.14,timber,false); }
    overlook('Tannery drying terrace',85,-19,2.5,16,13);
    // SE / potters: open workshops and rows of amphorae, not another mosque prefab.
    for(const [x,z] of [[69,37],[88,55]]) {
      house(x,z,13,12,{wallMat:brick,door:'south'});
      for(let i=0;i<8;i++) {
        shape(new THREE.SphereGeometry(0.5,8,6),ACC_TERRA,x-5+i*1.4,0.65,z+8);
        shape(new THREE.CylinderGeometry(0.2,0.32,0.45,8),ACC_TERRA,x-5+i*1.4,1.2,z+8);
      }
    }
    kiln(77,77); overlook('Potters terrace',40,75,2.5,16,12,brick);
    // Extraction tunnel, 25m of overhead cover, gate towers and open wooden leaves.
    box(-96,2.6,-5.5,27,5.2,1.4,stone);box(-96,2.6,5.5,27,5.2,1.4,stone);
    box(-96,5.3,0,27,0.5,12,stone);
    for(const x of [-108,-84]) {
      // The arch runs across z; rotate geometry and bounds together with a dedicated end facade.
      box(x,4.1,0,1.4,1,10,stone);
      for(const z of [-7.5,7.5]) box(x,4,z,5,8,5,stone);
      for(const z of [-4.5,4.5]) box(x,1.6,z,4,3.2,0.3,timber);
    }
    lightSpots.push(new THREE.Vector3(-96,3.8,0));
    for(const x of [-102,-93,-85]) box(x,4.8,0,0.4,0.2,0.4,GLOW,false);
    banner(-84,8,7); sandbags(-78,10);
    sign(-82.9,4.1,0,5,7,Math.PI/2);
    sign(-66,7.6,20.6,6,8);
    sign(-44,6.5,-47.6,7,7);
    sign(-49,3.2,55.2,8,4);
    sign(71,3.1,-34.9,9,6);
    sign(69,3.1,43.3,10,6);
    // Outer overlooks and checkpoint break the otherwise empty wall band.
    overlook('North wall lookout',65,-96,5,8,7);
    overlook('South wall lookout',-23,88,5,8,7);
    house(19,94,10,10,{wallMat:M.whitewash,door:'west'});
    for(const [x,z] of [[-8,64],[13,47],[37,32],[37,-29],[-20,32],[-54,-33],[10,-55],[44,-68]]) sandbags(x,z);
    for(const [x,z] of [[-89,65],[33,62],[-86,-70],[39,-94]]) palm(x,z,0.9);
    state(true,()=>{ground(17,-10,10,9,col(0x39352e),0.075);smoke(17,-10,3,true);});
  }

  // =====================================================================
  // MERGE → one mesh per material (+ BVH for fast raycasts)
  // =====================================================================
  // Emit non-overlapping surface patches into their original intact/wreck batches.
  for (const patch of groundPatches) {
    const previous=geoByMat; geoByMat=patch.batch;
    const g=new THREE.PlaneGeometry(patch.x1-patch.x0,patch.z1-patch.z0);
    const uv=g.getAttribute('uv'),map=(patch.m as THREE.MeshStandardMaterial).map;
    if (map) for(let i=0;i<uv.count;i++) uv.setXY(i,(patch.x0+uv.getX(i)*(patch.x1-patch.x0))/4/map.repeat.x,(patch.z0+uv.getY(i)*(patch.z1-patch.z0))/4/map.repeat.y);
    shape(g,patch.m,(patch.x0+patch.x1)/2,patch.y,(patch.z0+patch.z1)/2,-Math.PI/2);
    geoByMat=previous;
  }
  for (const batch of [{ geos: geoByMat, group, meshes: occluders }, ...stateGeometry]) for (const [m, geos] of batch.geos) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const g of geos) g.dispose();
    (merged as unknown as { computeBoundsTree(): void }).computeBoundsTree();
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = m !== smokeMaterial; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    batch.group.add(mesh);
    if (m !== smokeMaterial) batch.meshes.push(mesh);
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

  group.add(intactGroup, wreckGroup);
  wreckGroup.visible = false;
  occluders.push(...intactMeshes);
  for (const b of wreckSolids) { b.minY += 10000; b.maxY += 10000; }
  const detonate = () => {
    if (changed) return false;
    changed = true;
    if (mapId === 'alrasul') for (const b of wood) {
      if (b.minX === 46 && b.maxX === 50) { b.minY += 10000; b.maxY += 10000; }
    }
    intactGroup.visible = false; wreckGroup.visible = true;
    for (const b of intactSolids) { b.minY += 10000; b.maxY += 10000; }
    for (const b of wreckSolids) { b.minY -= 10000; b.maxY -= 10000; }
    for (const mesh of intactMeshes) { const i = occluders.indexOf(mesh); if (i >= 0) occluders.splice(i, 1); }
    occluders.push(...wreckMeshes);
    group.updateMatrixWorld(true);
    return true;
  };
  // AI cover belongs beside obstacles, never inside them or on inaccessible roofs.
  const validCover = coverNodes.filter(p => p.y === 0 && !solids.some(b => b.minY < 1.7 && b.maxY > 0.34 && p.x + 0.5 > b.minX && p.x - 0.5 < b.maxX && p.z + 0.5 > b.minZ && p.z - 0.5 < b.maxZ));
  coverNodes.length = 0;
  // Evenly retain cover across the authored arenas rather than biasing the first district.
  for (let i = 0; i < Math.min(40, validCover.length); i++) coverNodes.push(validCover[Math.floor(i * validCover.length / Math.min(40, validCover.length))]);
  scene.add(group);
  group.updateMatrixWorld(true);
  return { groundHeight, navigationHeight, detonate, get changed() { return changed; }, landmarks, overlooks, group, solids, occluders, coverNodes, playerSpawn, interiors, concrete, wood, half, lightSpots, windows, glass, breakGlass };
}

export function pointInAABB(x: number, y: number, z: number, b: AABB): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}
