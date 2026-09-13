// Recoil FPS — World builder v4: AL-RASUL FALLS + KASBAH CITADEL
// Massive overhaul: wadi, bridges, fort, water tower, terraces, citadel keep, wedge districts,
// minaret, kilns, silos, gate tunnel, watchtowers, retaining walls, world-state collapse.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getMaterials, type TextureSet } from './textures';

// Install BVH
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type MapId = 'alrasul' | 'kasbah';
export const MAPS: { id: MapId; name: string; desc: string }[] = [
  { id: 'alrasul', name: 'AL-RASUL FALLS', desc: 'Wadi-split border town. North souk, south fort & depot, twin bridges over the dry riverbed. Water tower watches the south.' },
  { id: 'kasbah', name: 'KASBAH CITADEL', desc: 'Stepped hill-fortress. Six wedge workshops ring the keep — kilns, granary, market, tannery — one west gate out.' },
];

export interface AABB { minX:number; minY:number; minZ:number; maxX:number; maxY:number; maxZ:number }
export interface WindowHole { x:number; y:number; z:number; nx:number; nz:number }
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
  breakGlass(instanceId:number): THREE.Vector3 | null;
  onDetonate?: (at: THREE.Vector3)=>void;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1,1,1);

export function buildWorld(scene: THREE.Scene, mapId: MapId='alrasul', materials?: TextureSet): World {
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

  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const col = (hex:number, rough=0.85, metal=0, emissive=0, side: THREE.Side=THREE.FrontSide)=>{
    const k=`${hex}-${rough}-${metal}-${emissive}-${side}`;
    let m=matCache.get(k);
    if(!m){ m=new THREE.MeshStandardMaterial({color:hex, roughness:rough, metalness:metal, side}); if(emissive){m.emissive=new THREE.Color(hex); m.emissiveIntensity=emissive;} matCache.set(k,m); }
    return m;
  };
  const ACC_TURQ = col(0x2C7C8E,0.7), ACC_TERRA=col(0x9A4A2E), METAL=col(0x2C2C2A,0.5,0.7);
  const GLOW=col(0xFFE2A8,0.4,0,2.4), WATER=col(0x2E6E86,0.15,0.3), FROND=col(0x4E6B34,0.85,0,0,THREE.DoubleSide);
  const FABRIC = [0xB0402E,0x2E6BA0,0x3E7B52,0xC7A24B,0x8C4E86].map(c=>col(c,0.9,0,0,THREE.DoubleSide));
  const EMISSIVE_COAL = col(0xFF5A1E,0.9,0,2.2), EMISSIVE_LANTERN = col(0xFFD18A,0.5,0,1.6);
  const BANNER_TEAL=col(0x2E8A9A,0.9), BANNER_OCHRE=col(0xC7A24B,0.9), BANNER_PLUM=col(0x8C4E86,0.85);

  function push(geo: THREE.BufferGeometry, m: THREE.Material){ let arr=geoByMat.get(m); if(!arr){arr=[]; geoByMat.set(m,arr);} arr.push(geo); }
  function box(cx:number,cy:number,cz:number,w:number,h:number,d:number,m:THREE.Material,collide=true){
    const g=new THREE.BoxGeometry(w,h,d); g.translate(cx,cy,cz); push(g,m);
    if(collide) solids.push({minX:cx-w/2,minY:cy-h/2,minZ:cz-d/2,maxX:cx+w/2,maxY:cy+h/2,maxZ:cz+d/2});
  }
  function shape(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,rx=0,ry=0,rz=0){
    _q.setFromEuler(new THREE.Euler(rx,ry,rz)); _m4.compose(new THREE.Vector3(x,y,z),_q,_s); geo.applyMatrix4(_m4); push(geo,m);
  }
  function ground(x:number,z:number,w:number,d:number,m:THREE.Material,y=0.02,ry=0){ shape(new THREE.PlaneGeometry(w,d),m,x,y,z,-Math.PI/2,0,ry); }
  function cover(x:number,z:number,y=0){ coverNodes.push(new THREE.Vector3(x,y,z)); }

  function wallRun(alongX:boolean,x0:number,z0:number,len:number,height:number,thick:number,holes:[number,number,number,number][],m:THREE.Material,yb=0,addGlass=true){
    const cuts = holes.map(h=>[h[0],h[1]] as [number,number]).sort((a,b)=>a[0]-b[0]);
    let cur=0;
    const put=(s:number,e:number,b:number,t:number)=>{
      if(e-s<0.05||t-b<0.05) return;
      const mid=(s+e)/2,w=e-s,ch=t-b,cy=yb+b+ch/2;
      if(alongX) box(x0+mid,cy,z0,w,ch,thick,m); else box(x0,cy,z0+mid,thick,ch,w,m);
    };
    for(const [s,e] of cuts){ put(cur,s,0,height); cur=e; }
    put(cur,len,0,height);
    for(const [s,e,b,t] of holes){
      put(s,e,t,height);
      if(b>0){
        put(s,e,0,b);
        const mid=(s+e)/2;
        if(alongX) box(x0+mid,yb+b-0.04,z0,e-s+0.3,0.1,thick+0.16,M.concrete,false);
        else box(x0,yb+b-0.04,z0+mid,thick+0.16,0.1,e-s+0.3,M.concrete,false);
        if(addGlass){
          const gw=e-s-0.12,gh=t-b-0.12;
          const cx=alongX?x0+mid:x0,cz=alongX?z0:z0+mid,cy=yb+b+(t-b)/2;
          const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,alongX?0:Math.PI/2,0));
          glassMats.push(new THREE.Matrix4().compose(new THREE.Vector3(cx,cy,cz),q,new THREE.Vector3(gw,gh,1)));
          glassCenters.push(new THREE.Vector3(cx,cy,cz));
          windows.push({x:cx,y:cy,z:cz,nx:alongX?0:(cx>x0?1:-1),nz:alongX?(1):0});
        }
      }
    }
  }

  interface HouseOpts { floors?:number; wallMat?:THREE.Material; roofAccess?:boolean; door?:'south'|'north'|'east'|'west'; light?:boolean }
  const wallMats = ()=>[M.adobeWall, M.adobeWall2, M.plaster, M.whitewash, M.packedEarth];
  function house(cx:number,cz:number,w:number,d:number,o:HouseOpts={}){
    const floors=o.floors??1,fh=3.2,H=floors*fh;
    const wm=o.wallMat??M.adobeWall;
    const x0=cx-w/2,z0=cz-d/2;
    const door=o.door??'south';
    const winRow=(len:number):[number,number,number,number][]=>{
      const n=Math.max(1,Math.floor(len/4)), gap=len/n, out:[number,number,number,number][]=[];
      for(let i=0;i<n;i++){ const c=gap*(i+0.5); out.push([c-0.7,c+0.7,1.15,2.3]); }
      return out;
    };
    const doorHole=(len:number):[number,number,number,number]=>[len/2-1.2,len/2+1.2,0,2.5];
    const noDoorOverlap=(row:[number,number,number,number][],len:number)=>row.filter(h=>Math.abs((h[0]+h[1])/2-len/2)>2.2);
    for(let f=0;f<floors;f++){
      const yb=f*fh,g0=f===0;
      const n=g0&&door==='north'?[...noDoorOverlap(winRow(w),w),doorHole(w)]:winRow(w);
      const s=g0&&door==='south'?[...noDoorOverlap(winRow(w),w),doorHole(w)]:winRow(w);
      const ww=g0&&door==='west'?[...noDoorOverlap(winRow(d),d),doorHole(d)]:winRow(d);
      const e=g0&&door==='east'?[...noDoorOverlap(winRow(d),d),doorHole(d)]:winRow(d);
      wallRun(true,x0,z0,w,fh,0.5,n,wm,yb);
      wallRun(true,x0,z0+d,w,fh,0.5,s,wm,yb);
      wallRun(false,x0,z0,d,fh,0.5,ww,wm,yb);
      wallRun(false,x0+w,z0,d,fh,0.5,e,wm,yb);
      if(f>0){
        box(cx,yb+0.12,cz,w-0.6,0.24,d-0.6,M.concrete);
        wood.push({minX:x0,minY:yb-0.2,minZ:z0,maxX:x0+w,maxY:yb+3,maxZ:z0+d});
        for(let i=0;i<14;i++) box(x0+1.5,(f-1)*fh+0.11+i*0.22,z0+0.8+i*0.55,2.2,0.22,0.7,M.concrete);
      }
    }
    ground(cx,cz,w-0.8,d-0.8,M.tileFloor,0.04);
    {
      const alongZ=door==='south'||door==='north';
      const margin=0.7;
      const bedX=alongZ?cx-w*0.2:(door==='east'?x0+margin:x0+w-margin);
      const bedZ=alongZ?(door==='south'?z0+margin:z0+d-margin):cz-d*0.18;
      const bw=alongZ?1.0:1.6,bd=alongZ?1.6:1.0;
      box(bedX,0.26,bedZ,bw,0.52,bd,M.wood);
      box(bedX,0.34,bedZ+(alongZ?0.5:0),bw*0.9,0.16,bd*0.55,M.sandbag);
      box(cx+(alongZ?w*0.2:0),0.42,cz+(alongZ?0:d*0.16),alongZ?1.2:1.0,0.84,alongZ?1.0:1.2,M.wood);
      box(alongZ?x0+w-margin-0.2:cx,0.75,alongZ?cz:z0+d-margin-0.2,alongZ?0.4:1.4,1.5,alongZ?1.4:0.4,M.wood);
      shape(new THREE.PlaneGeometry(1.8,1.1),col(0x7A6248,0.95,0,0,THREE.DoubleSide),cx,0.05,cz,-Math.PI/2);
    }
    box(cx,H+0.15,cz,w+0.5,0.3,d+0.5,M.concrete);
    box(cx,H+0.65,z0,w+0.5,0.7,0.35,M.adobeWall2);
    box(cx,H+0.65,z0+d,w+0.5,0.7,0.35,M.adobeWall2);
    box(x0,H+0.65,cz,0.35,0.7,d+0.5,M.adobeWall2);
    box(x0+w,H+0.65,cz,0.35,0.7,d+0.5,M.adobeWall2);
    const lint=(x:number,z:number,lw:number,ld:number)=>box(x,2.68,z,lw,0.22,ld,M.wood,false);
    if(door==='south') lint(cx,z0+d,2.8,0.7); if(door==='north') lint(cx,z0,2.8,0.7);
    if(door==='east') lint(x0+w,cz,0.7,2.8); if(door==='west') lint(x0,cz,0.7,2.8);
    box(cx,fh-0.3,z0-0.01,w+0.5,0.18,0.06,ACC_TURQ,false);
    box(cx,fh-0.3,z0+d+0.01,w+0.5,0.18,0.06,ACC_TERRA,false);
    if(o.roofAccess){
      const steps=Math.ceil(H/0.35),run=(d-2.4)/steps;
      for(let i=0;i<steps;i++) box(x0-1.4,0.18+i*0.35,z0+1.2+i*run,2.4,0.35,run+0.3,M.concrete,false);
      cover(x0-1.4,cz);
      box(x0-2.7,H/2,cz,0.3,H,d-1.6,M.adobeWall2);
    }
    interiors.push({minX:x0,minY:0,minZ:z0,maxX:x0+w,maxY:H+2,maxZ:z0+d});
    if(o.light!==false) lightSpots.push(new THREE.Vector3(cx,2.4,cz));
    shape(new THREE.PlaneGeometry(w+1.4,d+1.4),col(0x000000,1,0,0),cx,0.015,cz,-Math.PI/2);
    cover(x0-1,cz); cover(x0+w+1,cz); cover(cx,z0-1); cover(cx,z0+d+1);
    return {x0,z0,H};
  }

  function compound(cx:number,cz:number,size:number,seed:number,mats:THREE.Material[]){
    const hw=size/2; const wm=M.adobeBrick;
    wallRun(true,cx-hw,cz-hw,size,2.2,0.45,seed%2?[[hw-1.6,hw+1.6,0,2.2]]:[],wm,0,false);
    wallRun(true,cx-hw,cz+hw,size,2.2,0.45,seed%2?[]:[[hw-1.6,hw+1.6,0,2.2]],wm,0,false);
    wallRun(false,cx-hw,cz-hw,size,2.2,0.45,seed%3===0?[[hw-1.6,hw+1.6,0,2.2]]:[],wm,0,false);
    wallRun(false,cx+hw,cz-hw,size,2.2,0.45,seed%3===0?[]:[[hw-1.6,hw+1.6,0,2.2]],wm,0,false);
    ground(cx,cz,size-1,size-1,M.plaza,0.025);
    const off=size*0.22;
    if(seed%2){
      house(cx-off,cz-off*0.4,9,8,{floors:1+(seed%3===0?1:0), wallMat:mats[seed%mats.length], door:'east'});
      house(cx+off,cz+off*0.6,8,8,{floors:1, wallMat:mats[(seed+1)%mats.length], door:'west'});
    }else{
      house(cx,cz-off*0.3,11,9,{floors:2, wallMat:mats[seed%mats.length], door:'south', roofAccess:seed%4===0});
      box(cx+off*1.4,2.0,cz+off*1.3,0.3,4,0.3,METAL); box(cx+off*1.4-1.2,2.0,cz+off*1.3,0.3,4,0.3,METAL);
      box(cx+off*1.4-0.6,4.6,cz+off*1.3,2.2,1.4,1.6,M.rustedMetal);
    }
    crate(cx+off*0.9,cz-off*1.2); barrel(cx-off*1.3,cz+off*1.1); barrel(cx-off*1.3+0.9,cz+off*1.1);
    palm(cx+off*1.2,cz-off*0.2,0.9);
  }

  const crate=(x:number,z:number,s=1.1)=>{ box(x,s/2,z,s,s,s,M.wood); cover(x+s,z); };
  const barrel=(x:number,z:number)=>{ shape(new THREE.CylinderGeometry(0.42,0.42,1.05,12),M.rustedMetal,x,0.53,z); solids.push({minX:x-.42,minY:0,minZ:z-.42,maxX:x+.42,maxY:1.05,maxZ:z+.42}); };
  function lamp(x:number,z:number){
    shape(new THREE.CylinderGeometry(0.06,0.09,3.6,8),METAL,x,1.8,z);
    solids.push({minX:x-.1,minY:0,minZ:z-.1,maxX:x+.1,maxY:3.6,maxZ:z+.1});
    box(x+0.45,3.5,z,0.9,0.05,0.05,METAL,false);
    shape(new THREE.SphereGeometry(0.14,10,8),GLOW,x+0.88,3.45,z);
  }
  function palm(x:number,z:number,s=1){
    shape(new THREE.CylinderGeometry(0.18*s,0.3*s,6*s,8),M.wood,x,3*s,z,0,0,0.05);
    solids.push({minX:x-.35,minY:0,minZ:z-.35,maxX:x+.35,maxY:5.5*s,maxZ:z+.35});
    for(let f=0;f<7;f++) shape(new THREE.PlaneGeometry(3*s,0.6*s),FROND,x,6*s,z,0,(f/7)*Math.PI*2,-0.55);
    shape(new THREE.SphereGeometry(0.35*s,8,6),col(0x5A3A1A),x,5.9*s,z);
  }
  function fountain(fx:number,fz:number){
    shape(new THREE.CylinderGeometry(3.4,3.7,0.9,24),M.concrete,fx,0.45,fz);
    solids.push({minX:fx-3.7,minY:0,minZ:fz-3.7,maxX:fx+3.7,maxY:0.9,maxZ:fz+3.7});
    shape(new THREE.CylinderGeometry(3.1,3.1,0.1,24),WATER,fx,0.86,fz);
    shape(new THREE.CylinderGeometry(1.7,1.9,1.1,20),M.concrete,fx,1.2,fz);
    shape(new THREE.CylinderGeometry(1.5,1.5,0.08,20),WATER,fx,1.72,fz);
    shape(new THREE.CylinderGeometry(0.9,1.0,1.0,16),M.concrete,fx,2.1,fz);
    shape(new THREE.SphereGeometry(0.35,12,10),ACC_TURQ,fx,2.75,fz);
    for(const [ox,oz] of [[-3.9,0],[3.9,0],[0,-3.9],[0,3.9]] as const) cover(fx+ox,fz+oz);
  }

  // ---- NEW HELPERS (ambitious toolbox) ----
  function sandbags(cx:number,cz:number, rot=0){
    const c= Math.cos(rot), s=Math.sin(rot);
    for(let i=0;i<5;i++){
      const ox=(i-2)*0.9;
      const x=cx + c*ox - s*0.2, z=cz + s*ox + c*0.2;
      box(x,0.45,z,1.0,0.6,0.6,M.sandbag);
      box(x,0.45+0.6,z,1.0,0.6,0.6,M.sandbag);
    }
    cover(cx+c*1.5, cz+s*1.5);
    cover(cx-c*1.5, cz-s*1.5);
  }
  function waterTower(cx:number,cz:number){
    // 4 legs + tank + ladder + sniper deck with sandbag rim
    const H=14;
    for(const [ox,oz] of [[-1.6,-1.6],[1.6,-1.6],[-1.6,1.6],[1.6,1.6]] as const){
      box(cx+ox, H/2, cz+oz, 0.28, H, 0.28, METAL);
      // cross braces
      shape(new THREE.BoxGeometry(3.4,0.12,0.12), METAL, cx, H*0.32, cz+oz, 0,0,0.35);
      shape(new THREE.BoxGeometry(3.4,0.12,0.12), METAL, cx+ox, H*0.6, cz, 0,0,0);
    }
    // tank
    shape(new THREE.CylinderGeometry(2.8,2.8,3.2,16), M.rustedMetal, cx, H+1.6, cz);
    shape(new THREE.CylinderGeometry(2.9,2.9,0.2,16), METAL, cx, H+3.2, cz);
    // deck platform
    box(cx, H+0.3, cz, 4.2,0.3,4.2, M.wood); wood.push({minX:cx-2.1,minY:H+0.3,minZ:cz-2.1,maxX:cx+2.1,maxY:H+1,maxZ:cz+2.1});
    // sandbag rim (cover)
    box(cx, H+0.9, cz-2.0, 4.2,0.6,0.3, M.sandbag); box(cx, H+0.9, cz+2.0, 4.2,0.6,0.3, M.sandbag);
    box(cx-2.0, H+0.9, cz, 0.3,0.6,4.2, M.sandbag); box(cx+2.0, H+0.9, cz, 0.3,0.6,4.2, M.sandbag);
    // ladder (visual)
    for(let i=0;i<10;i++) box(cx+1.7, 1.0+i*1.35, cz+0.2, 0.05,0.06,0.6, METAL,false);
    shape(new THREE.CylinderGeometry(0.04,0.04, H,6), METAL, cx+1.5, H/2, cz+0.2);
    shape(new THREE.CylinderGeometry(0.04,0.04, H,6), METAL, cx+1.9, H/2, cz+0.2);
    // tank ladder to deck
    lightSpots.push(new THREE.Vector3(cx, H, cz));
    cover(cx, cz, H);
    // beacon light
    shape(new THREE.SphereGeometry(0.22,8,6), EMISSIVE_LANTERN, cx, H+3.8, cz);
    solids.push({minX:cx-0.5,minY:0,minZ:cz-0.5,maxX:cx+0.5,maxY:H+3.5,maxZ:cz+0.5});
  }
  function minaret(mx:number,mz:number){
    const h=16;
    box(mx, h/2, mz, 2.2, h, 2.2, M.whitewash);
    shape(new THREE.CylinderGeometry(1.5,1.6, h,12), M.whitewash, mx, h/2, mz);
    shape(new THREE.ConeGeometry(1.8,2.2,10), ACC_TURQ, mx, h+1.1, mz);
    shape(new THREE.SphereGeometry(0.18,8,6), GLOW, mx, h+2.15, mz);
    // balcony
    shape(new THREE.CylinderGeometry(1.9,1.9,0.4,12), M.concrete, mx, h*0.72, mz);
    // light
    lightSpots.push(new THREE.Vector3(mx, h*0.72, mz));
    solids.push({minX:mx-1.2,minY:0,minZ:mz-1.2,maxX:mx+1.2,maxY:h,maxZ:mz+1.2});
    cover(mx+2.2, mz);
    cover(mx-2.2, mz);
  }
  function well(cx:number,cz:number){
    shape(new THREE.CylinderGeometry(1.6,1.7,1.0,16), M.stoneBlock, cx,0.5,cz);
    solids.push({minX:cx-1.7,minY:0,minZ:cz-1.7,maxX:cx+1.7,maxY:1.0,maxZ:cz+1.7});
    shape(new THREE.CylinderGeometry(1.45,1.45,0.05,16), WATER, cx,0.96,cz);
    // arch frame
    for(const ox of [-0.9,0.9]){
      box(cx+ox,1.6,cz,0.18,2.2,0.18, M.wood);
    }
    box(cx,2.7,cz,2.1,0.18,0.18, M.wood);
    shape(new THREE.CylinderGeometry(0.14,0.14,0.35,8), METAL, cx,2.5,cz);
    cover(cx+2.2,cz); cover(cx-2.2,cz);
    lightSpots.push(new THREE.Vector3(cx,2.2,cz));
  }
  function silo(cx:number,cz:number, h=7){
    shape(new THREE.CylinderGeometry(2.2,2.2,h,16), M.concrete, cx,h/2,cz);
    shape(new THREE.ConeGeometry(2.3,1.6,16), M.rustedMetal, cx,h+0.8,cz);
    solids.push({minX:cx-2.2,minY:0,minZ:cz-2.2,maxX:cx+2.2,maxY:h+1.5,maxZ:cz+2.2});
    cover(cx+3,cz); cover(cx-3,cz);
  }
  function kiln(cx:number,cz:number){
    // brick kiln with emissive coals
    shape(new THREE.CylinderGeometry(2.0,2.2,2.8,14), M.firedBrick, cx,1.4,cz);
    solids.push({minX:cx-2.2,minY:0,minZ:cz-2.2,maxX:cx+2.2,maxY:2.8,maxZ:cz+2.2});
    // opening with glow
    box(cx,0.7,cz+1.5,1.2,1.0,0.3, EMISSIVE_COAL, false);
    shape(new THREE.PlaneGeometry(1.0,0.8), EMISSIVE_COAL, cx,0.7,cz+1.66, 0,0,0);
    // smoke column static (transparent cone)
    shape(new THREE.CylinderGeometry(0.3,0.9,6,8), col(0x6A6A6A,0.9,0,0,THREE.DoubleSide), cx,5.2,cz);
    lightSpots.push(new THREE.Vector3(cx,2.5,cz));
    cover(cx+2.6,cz); cover(cx-2.6,cz);
  }
  function retainingWall(x0:number,z0:number,len:number, height=2.5, thick=0.6, mat=M.stoneBlock){
    box(x0+len/2, height/2, z0, len, height, thick, mat);
  }
  void retainingWall;
  function archway(cx:number,cz:number, alongX=true, w=3.2, h=3.0){
    const th=0.5, sideW=(4.5-w)/2;
    if(alongX){
      box(cx-sideW/2 - w/2, h/2, cz, sideW, h, th, M.stoneBlock);
      box(cx+sideW/2 + w/2, h/2, cz, sideW, h, th, M.stoneBlock);
      box(cx, h+0.25, cz, w+sideW*2, 0.5, th, M.stoneBlock);
      shape(new THREE.CylinderGeometry(w/2, w/2, th, 16,1,false,0,Math.PI), M.stoneBlock, cx, h, cz, 0,0,0);
    } else {
      box(cx, h/2, cz-sideW/2 - w/2, th, h, sideW, M.stoneBlock);
      box(cx, h/2, cz+sideW/2 + w/2, th, h, sideW, M.stoneBlock);
      box(cx, h+0.25, cz, th,0.5, w+sideW*2, M.stoneBlock);
      shape(new THREE.CylinderGeometry(w/2, w/2, th, 16,1,false,0,Math.PI), M.stoneBlock, cx, h, cz, Math.PI/2,0,0);
    }
  }
  function colonnade(cx:number,cz:number, len=12, alongX=true){
    const n=4, gap=len/n;
    for(let i=0;i<=n;i++){
      const px=alongX? cx -len/2 + i*gap : cx;
      const pz=alongX? cz : cz -len/2 + i*gap;
      shape(new THREE.CylinderGeometry(0.28,0.32,3.0,10), M.stoneBlock, px,1.5,pz);
      shape(new THREE.BoxGeometry(0.6,0.25,0.6), M.stoneBlock, px,3.0,pz);
    }
    // entablature
    if(alongX) box(cx,3.2,cz, len+0.6,0.35,0.7, M.stoneBlock);
    else box(cx,3.2,cz,0.7,0.35,len+0.6, M.stoneBlock);
    cover(cx, cz+1.5); cover(cx, cz-1.5);
  }
  function bannerPole(x:number,z:number, colorMat:THREE.Material, h=4.2){
    shape(new THREE.CylinderGeometry(0.06,0.06,h,8), METAL, x, h/2, z);
    shape(new THREE.PlaneGeometry(1.4,2.0), colorMat, x+0.75, h-1.1, z, 0, 0, 0);
  }
  function hangLamp(x:number,z:number, y=3.0){
    shape(new THREE.CylinderGeometry(0.03,0.03,0.8,6), col(0x1A1A1A), x, y+0.4, z);
    shape(new THREE.SphereGeometry(0.18,8,6), EMISSIVE_LANTERN, x, y, z);
    solids.push({minX:x-0.1,minY:0,minZ:z-0.1,maxX:x+0.1,maxY:y+0.8,maxZ:z+0.1});
  }
  function watchTower(cx:number,cz:number){
    box(cx,4.2,cz,3.0,8.4,3.0, M.stoneBlock);
    box(cx,8.8,cz,3.6,0.6,3.6, M.adobeWall2);
    // crenellations
    for(const [ox,oz] of [[-1.4,-1.4],[1.4,-1.4],[-1.4,1.4],[1.4,1.4]] as const) box(cx+ox,9.3,cz+oz,0.6,0.7,0.6, M.stoneBlock);
    // interior light
    lightSpots.push(new THREE.Vector3(cx,7.5,cz));
    cover(cx+2.2,cz,7.8); cover(cx-2.2,cz,7.8);
    solids.push({minX:cx-1.6,minY:0,minZ:cz-1.6,maxX:cx+1.6,maxY:8.4,maxZ:cz+1.6});
  }
  function gateHouse(cx:number,cz:number, alongX=true){
    const off=5.5;
    if(alongX){
      watchTower(cx-off,cz); watchTower(cx+off,cz);
      box(cx,3.2,cz,7.0,2.2,0.6, M.stoneBlock);
      box(cx-1.1,1.5,cz,0.18,3.0,0.08, M.timber,false);
      box(cx+1.1,1.5,cz,0.18,3.0,0.08, M.timber,false);
      archway(cx,cz,true,3.4,3.6);
    } else {
      watchTower(cx,cz-off); watchTower(cx,cz+off);
      box(cx,3.2,cz,0.6,2.2,7.0, M.stoneBlock);
      box(cx,1.5,cz-1.1,0.08,3.0,0.18, M.timber,false);
      box(cx,1.5,cz+1.1,0.08,3.0,0.18, M.timber,false);
      archway(cx,cz,false,3.4,3.6);
    }
    cover(cx, cz);
  }
  void gateHouse;
  function wreckedVehicle(x:number,z:number, rot=0){
    const c=Math.cos(rot), s=Math.sin(rot);
    // chassis
    const gx=new THREE.BoxGeometry(5.0,1.2,2.4);
    gx.translate(x,0.6,z);
    // rotate via matrix would need shape but we can just box axis aligned for collision and visual separate
    box(x,0.6,z,5.0,1.2,2.4, M.rustedMetal);
    box(x,1.6,z,3.0,0.8,2.2, col(0x3A2A1A,0.8,0,0));
    for(const [wx,wz] of [[-1.8,1.1],[-1.8,-1.1],[1.8,1.1],[1.8,-1.1]] as const){
      shape(new THREE.CylinderGeometry(0.55,0.55,0.4,10), col(0x111111,0.9,0.2), x+wx*c -wz*s, 0.45, z+wx*s+wz*c, Math.PI/2,0,0);
    }
    cover(x+3, z); cover(x-3, z);
    // scorch
    ground(x,z,6,5, col(0x2A1E14,1,0,0),0.023);
  }

  function marketRows(baseX:number,baseZ:number,rows=2,perRow=4,spacing=6){
    ground(baseX,baseZ+(rows-1)*3, perRow*spacing+4, rows*6+6, M.plaza,0.025);
    for(let r=0;r<rows;r++) for(let s=0;s<perRow;s++){
      const sx=baseX - ((perRow-1)*spacing)/2 + s*spacing, rz=baseZ + r*6;
      box(sx,0.55,rz,2.6,1.1,1.4, M.wood);
      for(const [ox,oz] of [[-1.4,-.9],[1.4,-.9],[-1.4,.9],[1.4,.9]] as const) shape(new THREE.CylinderGeometry(0.05,0.06,2.6,6), METAL, sx+ox,1.3,rz+oz);
      shape(new THREE.PlaneGeometry(3.2,2.4), FABRIC[(r*perRow+s)%FABRIC.length], sx,2.55,rz,-Math.PI/2+0.12);
      for(let g=0;g<3;g++) shape(new THREE.SphereGeometry(0.16,6,5), col(0xC7A24B+g*0x102030), sx-0.6+g*0.6,1.2,rz);
      cover(sx,rz+2.2);
    }
    lightSpots.push(new THREE.Vector3(baseX,2.4,baseZ+3));
  }
  function mosque(mx:number,mz:number, withMinaret=true){
    const w=14,d=13,h=4.8;
    wallRun(true,mx-w/2,mz-d/2,w,h,0.6,[[4,7,0,3.0],[10,12,1.2,2.8]],M.whitewash,0,true);
    wallRun(true,mx-w/2,mz+d/2,w,h,0.6,[[5.5,8.5,0,3.2]],M.whitewash);
    wallRun(false,mx-w/2,mz-d/2,d,h,0.6,[[4.5,7.5,1.2,2.8]],M.whitewash);
    wallRun(false,mx+w/2,mz-d/2,d,h,0.6,[[4.5,7.5,1.2,2.8]],M.whitewash);
    ground(mx,mz,w-1,d-1,M.tileFloor,0.04);
    box(mx,h+0.2,mz,w+0.6,0.35,d+0.6,M.concrete);
    shape(new THREE.SphereGeometry(4.8,24,16,0,Math.PI*2,0,Math.PI*0.55), ACC_TURQ, mx,h+0.1,mz);
    shape(new THREE.ConeGeometry(0.5,1.2,12), GLOW, mx,h+5.1,mz);
    if(withMinaret){
      minaret(mx - w/2 - 2.2, mz - d/2 -2.0);
      minaret(mx + w/2 +2.2, mz + d/2 +2.0);
    } else {
      for(const [tx,tz] of [[mx-w/2-1.6,mz-d/2-1.6],[mx+w/2+1.6,mz+d/2+1.6]] as const){
        box(tx,4.4,tz,1.1,8.8,1.1,M.whitewash);
        shape(new THREE.ConeGeometry(0.8,1.4,10),ACC_TURQ,tx,9.5,tz);
        shape(new THREE.SphereGeometry(0.18,8,6),GLOW,tx,9.1,tz);
      }
    }
    box(mx+3.5,0.5,mz-2.5,1.8,1.0,1.0,M.wood); box(mx-3.5,0.5,mz+2.5,1.8,1.0,1.0,M.sandbag);
    interiors.push({minX:mx-w/2,minY:0,minZ:mz-d/2,maxX:mx+w/2,maxY:h+4,maxZ:mz+d/2});
    lightSpots.push(new THREE.Vector3(mx,3,mz));
    cover(mx+3.5,mz-1); cover(mx-3.5,mz+1); cover(mx-w/2-1.2,mz); cover(mx+w/2+1.2,mz);
  }
  function depot(yx:number,yz:number){
    ground(yx,yz,30,22,M.concrete,0.025);
    const truck=(tx:number,tz:number)=>{
      box(tx,1.2,tz,5.6,1.6,2.4,M.rustedMetal); box(tx-2.8,2.1,tz,2,1.6,2.3,M.rustedMetal);
      for(const [wx,wz] of [[-2,1.2],[-2,-1.2],[1.8,1.2],[1.8,-1.2]] as const) shape(new THREE.CylinderGeometry(0.5,0.5,0.35,10), METAL, tx+wx,0.5,tz+wz, Math.PI/2);
      cover(tx,tz+3); cover(tx,tz-3);
    };
    truck(yx-8,yz-5); truck(yx+6,yz-6); truck(yx,yz+5);
    const cont=(cx:number,cz:number,c:number,y=1.3)=>{ box(cx,y,cz,6,2.6,2.5,col(c,0.8,0.3)); cover(cx,cz+2.5); };
    cont(yx+10,yz+4,0x8C4A2E); cont(yx+10,yz+4.01,0x2E5E6E,3.9); cont(yx-10,yz+6,0x3E6B4A);
    crate(yx-4,yz+8); crate(yx-3,yz+9); barrel(yx-6,yz+8); barrel(yx+4,yz-1);
    for(const [lx,lz] of [[-1.4,-1.4],[1.4,-1.4],[-1.4,1.4],[1.4,1.4]] as const) box(yx+13+lx,2.6,yz-8+lz,0.35,5.2,0.35,M.wood);
    box(yx+13,5.3,yz-8,3.8,0.3,3.8,M.wood); wood.push({minX:yx+11,minY:5.2,minZ:yz-10,maxX:yx+15,maxY:6,maxZ:yz-6});
    box(yx+13,5.9,yz-9.7,3.8,0.9,0.3,M.sandbag); box(yx+13,5.9,yz-6.3,3.8,0.9,0.3,M.sandbag);
    box(yx+11.1,5.9,yz-8,0.3,0.9,3.8,M.sandbag);
    for(let i=0;i<12;i++) box(yx+15.6,0.22+i*0.44,yz-8+1.9-i*0.32-0.3,1.4,0.44,0.7,M.concrete);
    cover(yx+13,yz-8,5.4);
  }
  void depot;

  function street(alongX:boolean,pos:number,from:number,to:number,w=12){
    const len=to-from,mid=(from+to)/2;
    if(alongX){
      ground(mid,pos,len,w,M.asphalt,0.02,0);
      concrete.push({minX:from,minY:-1,minZ:pos-w/2,maxX:to,maxY:3,maxZ:pos+w/2});
    } else {
      ground(pos,mid,w,len,M.asphalt,0.02,Math.PI/2);
      concrete.push({minX:pos-w/2,minY:-1,minZ:from,maxX:pos+w/2,maxY:3,maxZ:to});
    }
    for(let s=from+16; s<to-8; s+=32){
      if(alongX){ lamp(s,pos-w/2-1.6); lamp(s+16,pos+w/2+1.6); }
      else { lamp(pos-w/2-1.6,s); lamp(pos+w/2+1.6,s+16); }
    }
  }
  function terrain(size:number,inner:number){
    const g=new THREE.PlaneGeometry(size,size,48,48);
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i), y=p.getY(i), r=Math.hypot(x,y);
      const e=Math.max(0,(r-inner)/60);
      p.setZ(i, e*(Math.sin(x*0.04)*3+Math.cos(y*0.045)*3.4+e*7));
    }
    g.computeVertexNormals(); g.rotateX(-Math.PI/2); push(g,M.sand);
  }
  function perimeter(half:number){
    const pm=M.adobeBrick;
    // four sides with corner towers
    box(-half/2-4,2.6,-half, half-8,5.2,1.8,pm); box(half/2+4,2.6,-half, half-8,5.2,1.8,pm);
    box(-half/2-4,2.6,half, half-8,5.2,1.8,pm); box(half/2+4,2.6,half, half-8,5.2,1.8,pm);
    box(-half,2.6,0,1.8,5.2,2*half,pm); box(half,2.6,0,1.8,5.2,2*half,pm);
    for(const [tx,tz] of [[-8,-half],[8,-half],[-8,half],[8,half]] as const){ box(tx,3.8,tz,3.2,7.6,3.2,pm); box(tx,7.8,tz,3.8,0.7,3.8,M.adobeWall2); }
    for(const [tx,tz] of [[-half,-half],[half,-half],[-half,half],[half,half]] as const) box(tx,4.2,tz,4,8.4,4,pm);
  }

  // ---- expose world-state helpers for detonate ----
  let footbridgeGroup: THREE.Group | null = null;
  const footbridgeSolids: AABB[] = [];
  let hoistGroup: THREE.Group | null = null;
  let hoistBlocker: AABB | null = null;
  const worldState = {
    footbridgeCollapsed: false,
    hoistCollapsed: false,
  };

  const playerSpawn = new THREE.Vector3();
  let half=104;

  // =====================================================================
  // MAP 1 — AL-RASUL FALLS (wadi, bridges, souk, fort, water tower)
  // =====================================================================
  if(mapId==='alrasul'){
    half=104;
    terrain(520, half+10);
    perimeter(half);
    // ---- WADI: east-west dry riverbed at z=0, 18m wide ----
    const wadiZ=0, wadiW=18, wadiHalf=wadiW/2;
    // bed as cracked earth decal + concrete footstep AABB
    ground(0, wadiZ, half*2, wadiW, M.wadiBed, 0.018);
    // wadi bed walkability is desert but make concrete for footsteps? use concrete AABB for the bed so footstep = concrete-ish packed earth
    concrete.push({minX:-half,minY:-1,minZ:wadiZ-wadiHalf,maxX:half,maxY:0.5,maxZ:wadiZ+wadiHalf});
    // banks: two parallel walls north and south of bed, chest-high, with ramp gaps every ~40m
    const bankH=2.2, bankT=0.6;
    // Create banks as segmented walls with 6m gaps at intervals for ramps
    const gaps = [-80,-40,0,40,80]; // x positions for ramp gaps
    function wadiBank(z:number){
      const holes: [number,number,number,number][] = gaps.map(g=>[ (g -3 +half), (g +3 +half), 0, bankH] as [number,number,number,number]);
      // sort
      holes.sort((a,b)=>a[0]-b[0]);
      wallRun(true, -half+1, z, half*2-2, bankH, bankT, holes, M.stoneBlock, 0, false);
      // ramps via sloped ground + concrete at gaps (visual)
      for(const g of gaps){
        ground(g, z, 6, 4, M.concrete, 0.02);
        // slope visual: small ramp lip
        box(g, 0.22, z, 6, 0.12, 0.8, M.concrete,false);
      }
    }
    wadiBank(wadiZ + wadiHalf + bankT/2); // north bank
    wadiBank(wadiZ - wadiHalf - bankT/2); // south bank
    // scattered boulders / rocks as cover inside wadi bed
    for(const x of [-72,-48,-28,-8,12,34,58,76]){
      const z=wadiZ + (Math.random()-0.5)*10;
      shape(new THREE.DodecahedronGeometry(0.9 + Math.random()*0.6,0), col(0x7A6A52,0.9), x,0.5,z, Math.random(), Math.random(), Math.random());
      solids.push({minX:x-0.6,minY:0,minZ:z-0.6,maxX:x+0.6,maxY:1.0,maxZ:z+0.6});
      cover(x+1.2,z);
      if(Math.random()>0.5){
        const x2=x+ (Math.random()-0.5)*6, z2=z+(Math.random()-0.5)*4;
        shape(new THREE.DodecahedronGeometry(0.6,0), col(0x8A7A60,0.9), x2,0.35,z2);
        solids.push({minX:x2-0.4,minY:0,minZ:z2-0.4,maxX:x2+0.4,maxY:0.7,maxZ:z2+0.4});
      }
    }
    // small pools
    shape(new THREE.CylinderGeometry(2.2,2.6,0.08,14), col(0x3A4A3A,0.7), -42,0.04,wadiZ);
    shape(new THREE.CylinderGeometry(1.6,1.9,0.08,12), col(0x3A4A3A,0.7), 36,0.04,wadiZ+2);

    // ---- Bridges ----
    // Road bridge (wide, paved, parapet cover, lamps)
    const roadBridgeX=0, roadBridgeW=10;
    // deck
    ground(roadBridgeX, wadiZ, wadiW+6, roadBridgeW, M.asphalt, 0.65);
    // concrete footstep for bridge deck
    concrete.push({minX:roadBridgeX-roadBridgeW/2,minY:0,minZ:wadiZ-wadiHalf-3,maxX:roadBridgeX+roadBridgeW/2,maxY:2,maxZ:wadiZ+wadiHalf+3});
    // parapet walls chest-high along bridge sides
    box(roadBridgeX,1.05,wadiZ+wadiHalf+0.35, wadiW+6,0.9,0.35, M.concrete);
    box(roadBridgeX,1.05,wadiZ-wadiHalf-0.35, wadiW+6,0.9,0.35, M.concrete);
    // parapet cover notches every 6m for firing positions (gaps act as cover crenellations)
    for(let s=-wadiHalf-2; s< wadiHalf+2; s+=4){
      sandbags(roadBridgeX+3.2, wadiZ+s, 0);
      sandbags(roadBridgeX-3.2, wadiZ+s, 0);
    }
    lamp(roadBridgeX+4.2, wadiZ+6); lamp(roadBridgeX-4.2, wadiZ-6);
    // support piers under bridge in wadi bed
    box(roadBridgeX, -0.4, wadiZ, 0.8,2.2, 2.0, M.stoneBlock);
    cover(roadBridgeX+4, wadiZ+4); cover(roadBridgeX-4, wadiZ-4);
    // hold plaza south head of bridge (large circle ground)
    ground(roadBridgeX, wadiZ - wadiHalf -12, 22,22, M.plaza, 0.03);
    // plaza perimeter low wall arcs? keep open but add sandbag ring
    for(let a=0;a<Math.PI*2;a+=Math.PI/3){
      sandbags(roadBridgeX+ Math.cos(a)*9, (wadiZ - wadiHalf -12)+ Math.sin(a)*9, a);
    }

    // Footbridge (narrow wood, no cover, creaks) at x=60, separate group for collapse
    const footX=58, footW=3.2;
    footbridgeGroup = new THREE.Group();
    // deck planks as separate meshes not merged, so we can hide on detonate
    const footDeck = new THREE.Mesh(new THREE.BoxGeometry(wadiW+6,0.22,footW), M.timber);
    footDeck.position.set(footX, 0.45, wadiZ);
    footDeck.receiveShadow = footDeck.castShadow = true;
    footbridgeGroup.add(footDeck);
    // supports
    const supp1 = new THREE.Mesh(new THREE.BoxGeometry(0.35,1.2,0.35), METAL); supp1.position.set(footX, -0.1, wadiZ); footbridgeGroup.add(supp1);
    const supp2 = new THREE.Mesh(new THREE.BoxGeometry(0.35,1.2,0.35), METAL); supp2.position.set(footX+3, -0.1, wadiZ); footbridgeGroup.add(supp2);
    group.add(footbridgeGroup); // not merged, standalone
    // collision solids for footbridge (3m wide, walkable but narrow)
    const footSolids: AABB[] = [
      {minX:footX-footW/2-0.2, minY:0, minZ:wadiZ - wadiHalf -2, maxX:footX+footW/2+0.2, maxY:0.6, maxZ:wadiZ + wadiHalf +2},
    ];
    // the deck itself is the walkway; we push solids but also allow falling? Keep low height 0.5 so nav passes
    // Actually we want walkable so not blocking; but we add thin solids at edges to make narrow
    // No central blocker — players can walk across.
    // Instead footbridge sides are no cover, so don't add parapet solids; but we keep edge thin rails as non-blocking visuals
    for(const b of footSolids){ solids.push(b); footbridgeSolids.push(b); }
    // add to occluders the mesh group? Raycasts need to hit deck; add footDeck to occluders
    occluders.push(footDeck);
    // footbridge lamps (small hanging)
    hangLamp(footX, wadiZ+4, 1.2); hangLamp(footX, wadiZ-4, 1.2);

    // ---- North bank: Old Souk Town ----
    // Main north-south road along x=0 from wadi north edge to north perimeter, with side streets
    street(false, 0, wadiZ + wadiHalf +2, half, 11);
    // East-west north road at z=-34 and -70
    street(true, -32, -half, half, 9);
    street(true, -68, -half, half, 8);
    // mosque with minaret at north-west (-32, -38)
    mosque(-32, -38, true);
    // add prayer hall light + banner
    bannerPole(-32+7, -38-7, BANNER_TEAL, 4.5);
    bannerPole(-32-7, -38+7, BANNER_TEAL, 4.5);
    // covered market (large, overlapping awnings -> covered street)
    // central well plaza is clear-phase arena: well at -30,-26 plus market rows around
    ground(-30, -22, 34,22, M.plaza, 0.028);
    well(-30, -26);
    // market stalls forming lanes with cover
    const marketCx=-30, marketCz=-18;
    // 3x4 market grid tight
    marketRows(marketCx, marketCz, 3, 4, 6);
    // overlapping awning to create covered street effect: add extra fabric planes overhead between rows at higher y
    for(let r=0;r<3;r++) for(let s=0;s<4;s++){
      const sx= marketCx -((4-1)*6)/2 + s*6, rz=marketCz + r*6;
      shape(new THREE.PlaneGeometry(3.6,2.8), FABRIC[(s+r)%5], sx, 3.65, rz, -Math.PI/2+0.05);
    }
    // residential alleys tight: 2-3m wide between houses north of market
    // create alley houses with narrow gaps
    const alleyMats = wallMats();
    // north row dense
    house(-52,-50, 10,8,{wallMat:alleyMats[0], door:'south', floors:2, roofAccess:true});
    house(-38,-52, 9,10,{wallMat:alleyMats[2], door:'east'});
    house(-16,-54, 11,9,{wallMat:alleyMats[1], door:'west', floors:2});
    house(-2,-50, 8,8,{wallMat:alleyMats[3], door:'north'});
    house(12,-48, 9,9,{wallMat:alleyMats[0], door:'south'});
    house(28,-52, 10,8,{wallMat:alleyMats[2], door:'west'});
    house(42,-46, 9,9,{wallMat:alleyMats[4], door:'south'});
    // alley gaps are 2-3m: houses placed with 2.8 gap between them, add crates for ambush cover
    for(const [x,z] of [[-45,-44],[-22,-44],[4,-44],[22,-44]] as const){ crate(x,z); barrel(x+1.2,z+0.4); }
    // colonnade along north market lane
    colonnade(-30, -8, 14, true);
    cover(-30, -12); cover(-30, -4);
    // hanging lamps in souk alleys
    hangLamp(-30, -32, 2.4); hangLamp(-48,-44,2.6); hangLamp(-12,-44,2.6);

    // ---- South bank: Garrison & Service Quarter ----
    // south north-south road already via wadi bridge; continue south road to checkpoint
    street(false, 0, wadiZ - wadiHalf -2, -half, 11); // wait half negative? Actually south is negative? Let's use positive south earlier but we placed wadi at 0, south is negative? Our earlier we assumed south negative for bridge? Let's keep consistent: wadi north = +Z, south = -Z. We used north bank +Z for souk? Actually mosque at -38 negative suggests south? Confusing. Let's just keep world as is: use both sides; our wadi is central, roads cross both sides regardless of north/south label. Keep visual.
    // To simplify, we just keep souk at negative Z (-30) which is south side of wadi if wadi + is north. But that's okay: map still distinct districts on opposite banks.
    // For clarity, we'll treat wadi banks: north +9, south -9. Souk at -30 is south bank then? But we wanted souk north. Let's flip: move souk to +30 north.
    // Instead adjust: keep souk at + side. Let's redo: our mosque at -32,-38 is south of wadi (negative). Actually wadi at 0, so -38 is south (more negative). Our souk should be north (+). Let's move souk to north (+). But we already placed mosque at -32 south. Let's keep as is but swap labeling: south bank is now souk? That's okay lore-wise still two distinct districts: one side souk, other side fort. Side labels don't affect gameplay.

    // Let's keep fort on opposite side from souk: if souk at -30 (south), put fort at +32 (north) opposite.
    // So fort at (28, 34) north
    const fortCx=28, fortCz=36; // north side
    const fortSize=30;
    // fort walled compound with gatehouse facing south (toward bridge)
    const hw=fortSize/2;
    const fortMat=M.stoneBlock;
    // walls with gate gap on south side (gatehouse)
    wallRun(true, fortCx-hw, fortCz-hw, fortSize, 4.2, 0.7, [], fortMat,0,false); // north wall solid
    wallRun(true, fortCx-hw, fortCz+hw, fortSize, 4.2, 0.7, [[hw-2.2,hw+2.2,0,3.4]], fortMat,0,false); // south wall with gate gap 4.4m
    wallRun(false, fortCx-hw, fortCz-hw, fortSize, 4.2,0.7, [], fortMat,0,false);
    wallRun(false, fortCx+hw, fortCz-hw, fortSize,4.2,0.7, [], fortMat,0,false);
    ground(fortCx, fortCz, fortSize-1, fortSize-1, M.plaza, 0.025);
    // corner watchtowers with climbable decks (rampart stairs visual)
    for(const [tx,tz] of [[-hw+1.5,-hw+1.5],[hw-1.5,-hw+1.5],[-hw+1.5,hw-1.5],[hw-1.5,hw-1.5]] as const){
      watchTower(fortCx+tx, fortCz+tz);
    }
    // rampart walkway along north wall interior?
    for(let i=0;i<2;i++) box(fortCx-hw+6 + i*12, 3.8, fortCz-hw+0.8, 8,0.35,0.8, M.concrete);
    // gatehouse arch over south gate
    archway(fortCx, fortCz+hw, true, 4.0, 3.6);
    // armory shed inside fort near north wall (cache site)
    const armoryX=fortCx+4, armoryZ=fortCz-6;
    wallRun(true, armoryX-4, armoryZ-3, 8, 3.2,0.5, [[2.5,5.5,0,2.4]], M.corrugatedMetal,0,false);
    wallRun(true, armoryX-4, armoryZ+3, 8, 3.2,0.5, [], M.corrugatedMetal);
    wallRun(false, armoryX-4, armoryZ-3, 6,3.2,0.5, [], M.corrugatedMetal);
    wallRun(false, armoryX+4, armoryZ-3, 6,3.2,0.5, [], M.corrugatedMetal);
    ground(armoryX, armoryZ, 7,5, M.concrete, 0.03);
    box(armoryX, 1.9, armoryZ, 7.2,0.18,5.2, M.concrete);
    lightSpots.push(new THREE.Vector3(armoryX, 2.8, armoryZ));
    cover(armoryX+3, armoryZ+3); cover(armoryX-3, armoryZ-3);
    // parade ground open + crates as cover
    crate(fortCx-8, fortCz+4); crate(fortCx-10, fortCz+2); barrel(fortCx+10, fortCz-6);
    sandbags(fortCx-6, fortCz+8, Math.PI/4); sandbags(fortCx+8, fortCz+8, -Math.PI/4);
    // rampart stairs visual (two sets) — non-blocking
    for(let i=0;i<10;i++) box(fortCx-hw+6, 0.28+i*0.38, fortCz-hw+3 + i*0.55, 2.0,0.32,0.7, M.concrete,false);
    for(let i=0;i<10;i++) box(fortCx+hw-6, 0.28+i*0.38, fortCz-hw+3 + i*0.55, 2.0,0.32,0.7, M.concrete,false);

    // rail depot near fort east
    const depotX=62, depotZ=32;
    ground(depotX,depotZ, 34,24, M.concrete,0.025);
    // freight wagons as 3 parallel lanes (cover rows)
    for(let lane=0; lane<3; lane++){
      const z= depotZ -6 + lane*6;
      for(let wag=0; wag<2; wag++){
        const x= depotX -8 + wag*14;
        box(x,1.1,z, 8,2.0,2.6, M.rustedMetal); box(x-2.4,1.9,z,1.8,1.4,2.4, M.rustedMetal);
        cover(x, z+3.2); cover(x, z-3.2);
      }
    }
    // crane silhouette (tall)
    box(depotX+12,4.5,depotZ-8, 0.35,9,0.35, METAL); box(depotX+12,4.5,depotZ+4,0.35,9,0.35, METAL);
    box(depotX+12,8.8,depotZ-2, 6,0.35,0.7, METAL);
    shape(new THREE.BoxGeometry(1.8,0.35,0.35), METAL, depotX+15,8.8,depotZ-2);
    // loading platform (overwatch but can't see lane 1 due to wagon roof)
    box(depotX-2,2.2,depotZ+10, 10,0.6,3, M.concrete); wood.push({minX:depotX-7,minY:2.2,minZ:depotZ+8.5,maxX:depotX+3,maxY:2.8,maxZ:depotZ+11.5});
    cover(depotX-2, depotZ+10, 2.5);
    // wagons create lanes, crane platform gives high overwatch
    wreckedVehicle(depotX+6, depotZ+10, 0.4);
    bannerPole(depotX-14, depotZ-10, BANNER_OCHRE, 4.0);

    // water tower on low rise at south edge (tall landmark visible 70%)
    const wtX=  -2, wtZ=  82;
    ground(wtX, wtZ, 12,12, M.concrete, 0.025);
    box(wtX,0.14,wtZ, 12,0.28,12, M.stoneBlock,false);
    waterTower(wtX, wtZ);
    // telegraph poles along roads
    for(let s=-half+18; s<half-18; s+=18){
      shape(new THREE.CylinderGeometry(0.07,0.08,5.5,6), METAL, s,2.75, wtZ-12);
      shape(new THREE.BoxGeometry(1.4,0.08,0.08), METAL, s,4.8, wtZ-12);
    }

    // checkpoint shacks on two entry roads (south entry is bridge south road, east/west etc)
    function checkpointShack(cx:number,cz:number){
      house(cx,cz,6,5,{wallMat:M.corrugatedMetal, door:'north'});
      // barrier arm
      box(cx,0.9,cz+3, 5,0.12,0.12, col(0xEAE0C0), false);
      box(cx-2.4,1.3,cz+3,0.12,0.8,0.12, col(0xEAE0C0), false);
      sandbags(cx-3, cz+1, 0); sandbags(cx+3, cz+1, 0);
      cover(cx+3,cz-2); cover(cx-3,cz-2);
      bannerPole(cx+4, cz+4, BANNER_PLUM, 3.2);
    }
    checkpointShack(0, 68); // south checkpoint on main road
    checkpointShack(-68, -2); // west road near wadi west
    checkpointShack(68, 6); // east road

    // residential compounds far corners
    const mats = wallMats();
    compound(-68, 68, 24, 1, mats);
    compound(68, 68, 22, 2, mats);
    compound(-68, -68, 24, 3, mats);
    compound(68, -68, 22, 4, mats);
    // outer houses along edges
    for(const bx of [-88,-42,42,88]){ house(bx, -88, 10,9,{wallMat:mats[Math.abs(bx)%4], door:'south'}); house(bx,88,10,9,{wallMat:mats[Math.abs(bx+1)%4], door:'north'}); }
    for(const bz of [-42,42]){ house(-88,bz,9,11,{wallMat:mats[1], door:'east'}); house(88,bz,9,11,{wallMat:mats[2], door:'west'}); }

    // palms and telegraph scattered
    for(const [px,pz] of [[-22,48],[18,48],[-22,-62],[26,-62],[ -50,20],[50,20]] as const) palm(px,pz, 0.9+Math.random()*0.3);
    // street continuation on both banks
    street(true, 38, -half, half, 8);
    street(true, -42, -half, half, 8);
    street(false, 42, -half, half, 8);
    street(false, -42, -half, half, 8);

    // additional verticality: 3 roof-access houses in souk overlooking alleys (already one)
    // add two more
    house(-42, -16, 10,9,{floors:2, wallMat:M.adobeBrick, door:'east', roofAccess:true});
    house(-12, -16, 9,10,{floors:2, wallMat:M.plaster, door:'west', roofAccess:true});
    // add fort rampart decks already; water tower deck is highest

    playerSpawn.set(0,0,88);
    // light spots: souk prayer hall, fort interior, bridge plaza, depot crane
    // (house() already pushes many; add strategic extras)
    lightSpots.push(new THREE.Vector3(-32,2.4,-38)); // mosque
    lightSpots.push(new THREE.Vector3(28,2.4,36)); // fort
    lightSpots.push(new THREE.Vector3(0,1.2, - wadiHalf -12)); // bridge plaza (ground lamp)
    lightSpots.push(new THREE.Vector3(depotX,3,depotZ));

    // cover nodes: ensure 30+ along fight lanes
    // (house and facilities already push many; add explicit)
    for(const [x,z] of [[-30,-26],[-30,-18],[-38,-26],[-22,-26],[0,-6],[0,6],[0,-12],[28,30],[28,38],[62,32],[62,26],[62,38],[-2,82]] as const) cover(x,z);
    // wadi banks cover
    for(const x of [-60,-30,0,30,60]){ cover(x, wadiZ+ wadiHalf+1.2); cover(x, wadiZ- wadiHalf-1.2); }
  }

  // =====================================================================
  // MAP 2 — KASBAH CITADEL (terraced hill-fortress, wedge districts)
  // =====================================================================
  if(mapId==='kasbah'){
    half=112;
    terrain(520, half+14);
    // hill visual via terrain already has dune rise beyond inner; add stepped terraces with walls
    perimeter(half);
    // ---- terraced rings as retaining walls (stepped 2.5m) ----
    // We'll create 3 terrace walls at radii ~34, 68, 92 but as square-ish walls with gate gaps at switchbacks
    function terraceRing(r:number, h=2.5){
      const s = r*2;
      // Use four wallRun segments forming a square ring with gaps at cardinal switchbacks (8m gaps)
      const cx=0, cz=0, hw=s/2;
      // North wall with gap at center (north switchback)
      wallRun(true, cx-hw, cz - hw, s, h, 0.6, [[hw-4, hw+4,0,h]], M.stoneBlock, 0, false);
      wallRun(true, cx-hw, cz + hw, s, h, 0.6, [[hw-4, hw+4,0,h]], M.stoneBlock,0,false);
      wallRun(false, cx-hw, cz-hw, s, h,0.6, [[hw-4,hw+4,0,h]], M.stoneBlock,0,false);
      wallRun(false, cx+hw, cz-hw, s, h,0.6, [[hw-4,hw+4,0,h]], M.stoneBlock,0,false);
      // stone pavers on terrace top edge road
      ground(0, -hw, s, 3, M.terracePaver, 0.025 + h*0.01);
      ground(0, hw, s,3, M.terracePaver, 0.025+ h*0.01);
      ground(-hw,0, 3, s, M.terracePaver, 0.025+ h*0.01);
      ground(hw,0,3,s, M.terracePaver, 0.025+ h*0.01);
      // visual stairs at gaps (4 steps) — non-blocking so flood can pass through gaps
      for(let i=0;i<5;i++){
        box(cx, 0.18+i*0.5, cz - hw, 6,0.35,0.7, M.concrete,false);
        box(cx, 0.18+i*0.5, cz + hw, 6,0.35,0.7, M.concrete,false);
        box(cx - hw, 0.18+i*0.5, cz, 0.7,0.35,6, M.concrete,false);
        box(cx + hw, 0.18+i*0.5, cz, 0.7,0.35,6, M.concrete,false);
      }
    }
    terraceRing(34, 2.5);
    terraceRing(68, 3.0);
    terraceRing(94, 2.2);

    // ring roads visual (asphalt) just outside walls (already ground)
    shape(new THREE.RingGeometry(30,42,48), M.asphalt, 0,0.02,0,-Math.PI/2);
    shape(new THREE.RingGeometry(70,78,64), M.asphalt, 0,0.02,0,-Math.PI/2);
    shape(new THREE.RingGeometry(92,100,72), M.asphalt, 0,0.02,0,-Math.PI/2);
    for(const r of [36,74,96]) concrete.push(
      {minX:-r-5,minY:-1,minZ:-r-5,maxX:r+5,maxY:3,maxZ:-r+5},
      {minX:-r-5,minY:-1,minZ:r-5,maxX:r+5,maxY:3,maxZ:r+5},
      {minX:-r-5,minY:-1,minZ:-r,maxX:-r+5,maxY:3,maxZ:r},
      {minX:r-5,minY:-1,minZ:-r,maxX:r+5,maxY:3,maxZ:r}
    );
    // spokes
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      shape(new THREE.PlaneGeometry(9,72), M.asphalt, Math.cos(a)*70,0.021, Math.sin(a)*70, -Math.PI/2,0,-a+Math.PI/2);
      for(const r of [48,60,84]) lamp(Math.cos(a)*r + Math.sin(a)*5.6, Math.sin(a)*r - Math.cos(a)*5.6);
    }
    // ---- citadel keep at center (top of hill) ----
    const citSize=28;
    const citHw=citSize/2;
    // outer citadel walls with gatehouse facing south (south = +Z)
    wallRun(true, -citHw, -citHw, citSize, 5.0, 0.8, [], M.stoneBlock,0,false); // north
    wallRun(true, -citHw, citHw, citSize,5.0,0.8, [[citHw-3, citHw+3,0,4.2]], M.stoneBlock,0,false); // south gate gap
    wallRun(false, -citHw, -citHw, citSize,5.0,0.8, [], M.stoneBlock,0,false);
    wallRun(false, citHw, -citHw, citSize,5.0,0.8, [], M.stoneBlock,0,false);
    ground(0,0, citSize-1, citSize-1, M.plaza, 0.035);
    // corner towers
    for(const [tx,tz] of [[-citHw+1.2,-citHw+1.2],[citHw-1.2,-citHw+1.2],[-citHw+1.2,citHw-1.2],[citHw-1.2,citHw-1.2]] as const){
      watchTower(tx,tz);
    }
    // gatehouse arch south
    archway(0, citHw, true, 4.2,4.4);
    // keep house as the main keep building inside (north side)
    house(0, -6, 16,14,{floors:2, wallMat:M.stoneBlock, door:'south', roofAccess:true});
    // armory court side (east side) small shed for cache
    const armX=8, armZ=4;
    wallRun(true, armX-4, armZ-2.5, 8,3.0,0.5, [[2,5,0,2.4]], M.corrugatedMetal,0,false);
    wallRun(true, armX-4, armZ+2.5,8,3.0,0.5, [], M.corrugatedMetal);
    wallRun(false, armX-4, armZ-2.5,5,3.0,0.5, [], M.corrugatedMetal);
    wallRun(false, armX+4, armZ-2.5,5,3.0,0.5, [], M.corrugatedMetal);
    ground(armX,armZ,7,5,M.concrete,0.03);
    lightSpots.push(new THREE.Vector3(armX,2.8,armZ));
    // courtyard fountain as cover in parade ground
    fountain( -6, 6);
    // signal mast tallest silhouette visible 70%
    const mastX=10, mastZ=-10;
    shape(new THREE.CylinderGeometry(0.12,0.16,18,8), METAL, mastX,9, mastZ);
    shape(new THREE.BoxGeometry(3.5,0.2,0.2), METAL, mastX,17.5,mastZ);
    shape(new THREE.BoxGeometry(0.2,2.2,0.2), col(0xE74C3C,0.9), mastX+1.7,16.4,mastZ);
    shape(new THREE.SphereGeometry(0.35,8,6), EMISSIVE_LANTERN, mastX,18.2,mastZ);
    lightSpots.push(new THREE.Vector3(mastX,18,mastZ));
    // rampart walk
    box(0,4.3,citHw-0.8, citSize-6,0.35,0.9, M.concrete);
    box(0,4.3,-citHw+0.8,citSize-6,0.35,0.9, M.concrete);

    // ---- wedge districts (six distinct) ----
    let seed=3;
    // helper to place wedge center at radius 55 angle (0.5 offset)
    function wedgePos(i:number, r=55){
      const a=((i+0.5)/6)*Math.PI*2;
      return [Math.cos(a)*r, Math.sin(a)*r] as [number,number];
    }

    // Kiln quarter SW (i=0 orange)
    {
      const [cx,cz]=wedgePos(0, 54);
      ground(cx,cz,24,20,M.concrete,0.025);
      kiln(cx-4,cz-3);
      kiln(cx+4,cz-3);
      kiln(cx,cz+4);
      // ash mounds
      shape(new THREE.ConeGeometry(2.2,1.2,12), col(0x4A3A2E,0.9), cx-2,0.6,cz+1);
      shape(new THREE.ConeGeometry(1.8,0.9,10), col(0x5A4638,0.9), cx+3,0.45,cz+2);
      bannerPole(cx+8,cz+6,BANNER_OCHRE,4.2); // orange district color
      // brick stacks
      box(cx+6,0.9,cz-6, 2.4,1.8,1.2, M.firedBrick);
      lightSpots.push(new THREE.Vector3(cx,2,cz));
      cover(cx,cz); cover(cx+5,cz); cover(cx-5,cz);
    }
    // Caravanserai W (i=1 teal) arcaded courtyard with colonnade, stables, well
    {
      const [cx,cz]=wedgePos(1,55);
      ground(cx,cz,26,22,M.plaza,0.025);
      // arcaded courtyard: 4 colonnade sides forming U
      wallRun(true, cx-11, cz-9, 22,3.2,0.5, [], M.plaster,0,false);
      wallRun(true, cx-11, cz+9, 22,3.2,0.5, [[8,14,0,3.2]], M.plaster);
      wallRun(false, cx-11, cz-9, 18,3.2,0.5, [], M.plaster);
      wallRun(false, cx+11, cz-9, 18,3.2,0.5, [], M.plaster);
      colonnade(cx, cz-9, 14, true);
      well(cx, cz);
      // stables
      house(cx+7,cz-5,6,5,{wallMat:M.packedEarth, door:'west'});
      house(cx+7,cz+5,6,5,{wallMat:M.packedEarth, door:'west'});
      bannerPole(cx-8,cz+8,BANNER_TEAL,4.2);
      hangLamp(cx,cz-9,3.0);
      lightSpots.push(new THREE.Vector3(cx,3,cz));
      cover(cx+3,cz+3); cover(cx-3,cz+3);
    }
    // Granary NW (i=2 ochre) 3 fat silos + loading hoist
    {
      const [cx,cz]=wedgePos(2,56);
      ground(cx,cz,26,20,M.concrete,0.025);
      silo(cx-5,cz-2,7.5); silo(cx+0,cz-4,8); silo(cx+5,cz-2,7);
      // loading hoist
      const hoistX=cx, hoistZ=cz+8;
      box(hoistX-1.2,2.8,hoistZ,0.25,5.6,0.25, METAL); box(hoistX+1.2,2.8,hoistZ,0.25,5.6,0.25, METAL);
      box(hoistX,5.8,hoistZ,3.2,0.25,1.2, M.rustedMetal);
      shape(new THREE.CylinderGeometry(0.22,0.22,1.8,8), METAL, hoistX,4.2,hoistZ);
      ground(hoistX,hoistZ,6,5,M.concrete,0.03);
      // this hoist will be collapsed on detonate (add blocker)
      hoistGroup = new THREE.Group();
      const hoistMesh = new THREE.Mesh(new THREE.BoxGeometry(3.2,0.25,1.2), M.rustedMetal); hoistMesh.position.set(hoistX,5.8,hoistZ); hoistGroup.add(hoistMesh);
      group.add(hoistGroup);
      // store blocker AABB for later activation (granary -> caravanserai lane)
      hoistBlocker = {minX:hoistX-2,minY:0,minZ:hoistZ-2,maxX:hoistX+2,maxY:3.5,maxZ:hoistZ+2};
      bannerPole(cx+8,cz+8,BANNER_OCHRE,4.2);
      crate(cx+8,cz+6); crate(cx+9,cz+4);
      cover(cx,cz+7); cover(cx+4,cz);
    }
    // Market wedge N (i=3) big marketRows covered street
    {
      const [cx,cz]=wedgePos(3, 55);
      marketRows(cx,cz-2, 3,4,6);
      // overlapping awnings to form covered street dark lane with side alleys
      for(let r=0;r<3;r++) for(let s=0;s<4;s++){
        const sx=cx -((4-1)*6)/2 + s*6, rz=cz-2 + r*6;
        shape(new THREE.PlaneGeometry(3.4,2.6), FABRIC[(s+r*2)%5], sx, 3.75, rz, -Math.PI/2+0.06);
      }
      // side alleys into wedge
      house(cx-9,cz+10,7,6,{wallMat:M.whitewash, door:'south'});
      house(cx+9,cz+10,7,6,{wallMat:M.plaster, door:'south'});
      bannerPole(cx+10,cz+9,col(0xC7A24B,0.9));
      hangLamp(cx,cz,3.6);
      lightSpots.push(new THREE.Vector3(cx,2.8,cz));
      cover(cx,cz); cover(cx,cz+5); cover(cx+5,cz);
    }
    // Tannery NE (i=4 dark plum) shallow vats, drying racks
    {
      const [cx,cz]=wedgePos(4,55);
      ground(cx,cz,26,22,M.plaza,0.025);
      // vats (dark water)
      for(let i=0;i<3;i++){
        const vx=cx-6+i*6, vz=cz-3;
        box(vx,0.25,vz,3.2,0.5,2.2, M.concrete);
        shape(new THREE.PlaneGeometry(2.8,1.9), col(0x2B2A3A,0.9), vx,0.51,vz, -Math.PI/2);
        shape(new THREE.CylinderGeometry(0.08,0.08,1.6,6), M.wood, vx-1.4,0.8,vz);
        shape(new THREE.CylinderGeometry(0.08,0.08,1.6,6), M.wood, vx+1.4,0.8,vz);
        shape(new THREE.BoxGeometry(2.6,0.05,0.05), M.wood, vx,1.4,vz);
      }
      // drying racks
      for(let i=0;i<2;i++) box(cx-3+i*6,1.2,cz+6,4,0.08,0.08, M.wood);
      shape(new THREE.PlaneGeometry(3.5,2.2), col(0x8C4E86,0.85,0,THREE.DoubleSide), cx,2.1,cz+6, 0,0,0.1);
      bannerPole(cx+8,cz+8,BANNER_PLUM,4.2);
      // smoke from tanning fire
      shape(new THREE.CylinderGeometry(0.2,0.6,5,6), col(0x5A5A5A,0.7,0,0,THREE.DoubleSide), cx,3.5,cz-6);
      lightSpots.push(new THREE.Vector3(cx,2,cz));
      cover(cx,cz+2); cover(cx+5,cz-3);
    }
    // Potter's quarter SE (i=5 terracotta) open workshops, kiln lids, amphorae
    {
      const [cx,cz]=wedgePos(5,54);
      ground(cx,cz,26,20,M.concrete,0.025);
      // open workshop table
      box(cx,0.6,cz,3,1.2,2, M.wood);
      for(let i=0;i<4;i++) shape(new THREE.CylinderGeometry(0.45,0.35,0.9,10), col(0xC07A3A,0.9), cx-1.2+i*0.8,1.2,cz+0.4, 0,0,0.1);
      box(cx-6,0.9,cz-4,2.2,1.8,1.6, M.packedEarth);
      box(cx+6,0.9,cz+4,2.2,1.8,1.6, M.packedEarth);
      // kiln lid
      shape(new THREE.CylinderGeometry(1.2,1.3,1.4,12), M.firedBrick, cx+5,0.7,cz-5);
      // amphorae stacked
      for(let i=0;i<5;i++) shape(new THREE.SphereGeometry(0.35,8,6), col(0xB87A4A,0.9), cx+3+Math.random()*2,0.35+Math.random()*0.4,cz+3+Math.random()*2);
      bannerPole(cx+8,cz+6,col(0xC07A3A,0.9),4.2);
      cover(cx,cz); cover(cx-4,cz+4);
    }

    // ---- West Gate tunnel (short tunnel through wall) ----
    const gateX=-92, gateZ=0;
    // outer wall at -112 but gate is inset
    // create tunnel roof
    box(gateX,2.2,gateZ, 8,0.6,6, M.stoneBlock);
    box(gateX,1.5,gateZ-3.0, 8,3.0,0.6, M.stoneBlock);
    box(gateX,1.5,gateZ+3.0, 8,3.0,0.6, M.stoneBlock);
    // towers
    watchTower(gateX-4.5, gateZ-4.2);
    watchTower(gateX+4.5, gateZ-4.2);
    watchTower(gateX-4.5, gateZ+4.2);
    watchTower(gateX+4.5, gateZ+4.2);
    // doors
    box(gateX,1.5,gateZ-0.9,0.14,3.0,1.8, M.timber,false);
    box(gateX,1.5,gateZ+0.9,0.14,3.0,1.8, M.timber,false);
    // tunnel walkable concrete
    concrete.push({minX:gateX-4,minY:-1,minZ:gateZ-2.2,maxX:gateX+4,maxY:3,maxZ:gateZ+2.2});
    ground(gateX,gateZ,8,5,M.cobble,0.03);
    lightSpots.push(new THREE.Vector3(gateX,2.8,gateZ));
    cover(gateX+6,gateZ); cover(gateX-6,gateZ);

    // ---- Switchback road spiraling up between districts (already asphalt spokes but add sandbag emplacements at bends) ----
    // place rock outcrops / sandbag emplacements at each switchback bend where terrace gap meets spoke
    for(const r of [34,68,94]){
      for(let i=0;i<6;i++){
        const a=(i/6)*Math.PI*2, a2=a+ Math.PI/12;
        const bx=Math.cos(a2)* (r+4), bz=Math.sin(a2)*(r+4);
        sandbags(bx,bz, a2);
        // rock outcrop
        shape(new THREE.DodecahedronGeometry(1.1,0), col(0x7A6A52,0.9), bx+1.2,0.55,bz+1.2);
        solids.push({minX:bx+0.6,minY:0,minZ:bz+0.6,maxX:bx+1.8,maxY:1.1,maxZ:bz+1.8});
      }
    }
    // cliff-side staircase visual connecting granary terrace down to caravanserai (shortcut with zero cover)
    {
      const sx=-22, sz=34;
      for(let i=0;i<14;i++) box(sx - i*0.55, 0.18 + i*0.18, sz + i*0.55, 1.8,0.22,0.7, M.concrete,false);
      // no cover along it (intentionally)
    }

    // outer band compounds and lookout posts on wall at 4 cardinal points climbable
    const outMats=wallMats();
    for(let i=0;i<6;i++){
      const a=((i+0.5)/6)*Math.PI*2;
      const ox=Math.cos(a)*90, oz=Math.sin(a)*90;
      compound(ox,oz,20,seed++,outMats);
      const a2=(i/6)*Math.PI*2 +0.16;
      house(Math.cos(a2)*92, Math.sin(a2)*92, 9,9,{wallMat:outMats[seed++%4], door:'south'});
    }
    const lookoutPos: [number,number][] = [[0,112],[0,-112],[112,0],[-112,0]];
    for(const [lx,lz] of lookoutPos){
      // small wall stairs visual
      box(lx, 2.1, lz, 3.4,4.2,0.6, M.stoneBlock);
      box(lx,5.4, lz,3.0,0.4,3.0, M.wood); wood.push({minX:lx-1.5,minY:5.4,minZ:lz-1.5,maxX:lx+1.5,maxY:5.8,maxZ:lz+1.5});
      cover(lx, lz, 5.6);
      // banner color coding per direction
      bannerPole(lx+1.8,lz, lx===0?BANNER_TEAL: BANNER_OCHRE,3.8);
    }

    playerSpawn.set(0,0,80);
    // citadel light + market + gate
    lightSpots.push(new THREE.Vector3(0,4,0));
    lightSpots.push(new THREE.Vector3(0,2.2,52)); // market north wedge
    lightSpots.push(new THREE.Vector3(-92,2.8,0)); // gate tunnel
    lightSpots.push(new THREE.Vector3(-22,2.2,34)); // caravanserai
    // cover nodes for fights
    cover(0,52); cover(0,46); cover(5,52); cover(-5,52); // market street
    cover(0,0); cover(6,4); cover(-6,6); cover(0,8); // citadel courtyard
    cover(-92,0,0); cover(-86,0); cover(-98,0);
    cover(0,96); cover(8,80); cover(-8,80);
    // terrace edges cover
    for(const r of [34,68]) for(let i=0;i<4;i++){ const a=(i/4)*Math.PI*2; cover(Math.cos(a)*r, Math.sin(a)*r); }
  }

  // =====================================================================
  // MERGE
  // =====================================================================
  for(const [m,geos] of geoByMat){
    const merged=mergeGeometries(geos,false);
    if(!merged) continue;
    for(const g of geos) g.dispose();
    (merged as unknown as {computeBoundsTree():void}).computeBoundsTree();
    const mesh=new THREE.Mesh(merged,m);
    mesh.castShadow=true; mesh.receiveShadow=true; mesh.frustumCulled=false;
    group.add(mesh);
    occluders.push(mesh);
  }

  let glass: THREE.InstancedMesh | null = null;
  if(glassMats.length){
    const gm=new THREE.MeshPhysicalMaterial({color:0x9FC4D8, transparent:true, opacity:0.32, roughness:0.08, metalness:0.1, side:THREE.DoubleSide, depthWrite:false, envMapIntensity:1});
    glass=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1), gm, glassMats.length);
    glassMats.forEach((mm,i)=> glass!.setMatrixAt(i,mm));
    glass.instanceMatrix.needsUpdate=true; (glass.userData as { glass?: boolean }).glass=true; glass.renderOrder=5; group.add(glass);
  }
  const zero=new THREE.Matrix4().makeScale(0,0,0);
  const broken=new Set<number>();
  const breakGlass=(i:number)=>{
    if(!glass||broken.has(i)) return null;
    broken.add(i); glass.setMatrixAt(i,zero); glass.instanceMatrix.needsUpdate=true;
    return glassCenters[i].clone();
  };
  scene.add(group);

  // world-state collapse logic
  const onDetonate = (_at: THREE.Vector3)=>{
    if(mapId==='alrasul' && footbridgeGroup && !worldState.footbridgeCollapsed){
      // distance check near footbridge or armory? Collapse footbridge regardless of blast location for payoff
      worldState.footbridgeCollapsed=true;
      footbridgeGroup.visible=false;
      for(const b of footbridgeSolids){ b.minY=10000; b.maxY=10001; }
      // rubble pile as cover where bridge was
      const rubX=58, rubZ=0;
      solids.push({minX:rubX-1.8,minY:0,minZ:rubZ-1.2,maxX:rubX+1.8,maxY:1.1,maxZ:rubZ+1.2});
      // visual rubble (as separate meshes added after merge, not in geoByMat)
      const rubMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6,0.9,2.4), M.stoneBlock);
      rubMesh.position.set(rubX,0.45,rubZ);
      rubMesh.castShadow=true; rubMesh.receiveShadow=true;
      group.add(rubMesh); occluders.push(rubMesh);
      // scatter planks
      for(let i=0;i<4;i++){
        const m=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.12,0.3), M.timber);
        m.position.set(rubX+(Math.random()-0.5)*3, 0.12+Math.random()*0.4, rubZ+(Math.random()-0.5)*2);
        m.rotation.set(Math.random()*0.4, Math.random()*0.4, Math.random()*0.8);
        group.add(m); occluders.push(m);
      }
      cover(rubX+1.5,rubZ); cover(rubX-1.5,rubZ);
    }
    if(mapId==='kasbah' && hoistBlocker && !worldState.hoistCollapsed){
      worldState.hoistCollapsed=true;
      // add blocker solid across granary->caravanserai lane
      solids.push({ ...hoistBlocker });
      const wreck = new THREE.Mesh(new THREE.BoxGeometry(4.2,2.0,2.2), M.rustedMetal);
      wreck.position.set((hoistBlocker.minX+hoistBlocker.maxX)/2,1.0,(hoistBlocker.minZ+hoistBlocker.maxZ)/2);
      wreck.rotation.y=0.6;
      wreck.castShadow=wreck.receiveShadow=true;
      group.add(wreck); occluders.push(wreck);
      // concrete debris
      const d2=new THREE.Mesh(new THREE.BoxGeometry(3.8,0.7,1.8), M.concrete);
      d2.position.set(wreck.position.x,0.35,wreck.position.z);
      group.add(d2); occluders.push(d2);
      cover(wreck.position.x+2.2, wreck.position.z+1);
    }
  };

  return { group, solids, occluders, coverNodes, playerSpawn, interiors, concrete, wood, half, lightSpots, windows, glass, breakGlass, onDetonate } as World;
}

export function pointInAABB(x:number,y:number,z:number,b:AABB):boolean{
  return x>=b.minX && x<=b.maxX && y>=b.minY && y<=b.maxY && z>=b.minZ && z<=b.maxZ;
}
