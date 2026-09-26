// Recoil FPS — Armory attachment visuals: procedural parts that bolt onto gun sockets.
// Parts build in SOCKET space (origin = mount point, −Z toward the muzzle) and the
// attach() helper seats them on the live socket, hides stock meshes, and rewires
// muzzle/mag references. Shared WM materials are never disposed — only geometries.
import * as THREE from 'three';
import { GunBuilder, WM, type WeaponModel } from './models';
import { attachmentById, isCompatible, weaponById, type AttachSlot, type AttachmentCatalogEntry, type WeaponClass, type WeaponId } from './economy/catalog';
import { sanitizeBuild, type WeaponBuild } from './economy/loadout';
import { HALF_PI, magazine, screw, verticalGrip } from './weapons/furniture';
import { EQUIPMENT_BUILDERS } from './equipment-shapes';
import { batchRigidGroup } from './weapons/geometry';

export interface AttachContext {
  weapon: WeaponId;
  model: WeaponModel;
  cls: WeaponClass;
  entry?: AttachmentCatalogEntry;
}

export type AttachmentBuilder = (ctx: AttachContext) => THREE.Object3D;

/** Muzzle-device scale per weapon class (no per-weapon hacks). */
const MUZZLE_SCALE: Record<WeaponClass, number> = {
  AR: 1, BR: 1, LMG: 1.05, SMG: 0.85, PDW: 0.85, SR: 1.15, SG: 1, PISTOL: 0.75,
};
const BARREL_LONG_EXT: Record<WeaponClass, number> = {
  AR: 0.045, BR: 0.040, LMG: 0.055, SMG: 0.025, PDW: 0.020, SR: 0.05, SG: 0.02, PISTOL: 0.006,
};
const BARREL_SHORT_RED: Record<WeaponClass, number> = {
  AR: 0.045, BR: 0.040, LMG: 0.045, SMG: 0.024, PDW: 0.02, SR: 0.025, SG: 0.02, PISTOL: 0.012,
};

function group(): THREE.Group {
  return new THREE.Group();
}

/* ================= MUZZLE ================= */

function flash_hider({ cls }: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder(), k = MUZZLE_SCALE[cls];
  b.name('threaded muzzle collar').tube(0.011, 0.0045, 0.019, WM.darkSteel, 0, 0, -0.006);
  for (let i = 0; i < 3; i++) {
    const angle = i / 3 * Math.PI * 2;
    b.name('joined flash hider prong').box(0.005, 0.004, 0.035, WM.steel, Math.sin(angle) * 0.0085, Math.cos(angle) * 0.0085, -0.031, 0, 0, -angle);
  }
  b.build(p); p.scale.setScalar(k); p.userData.length = 0.049 * k;
  return p;
}

function compensator({ cls }: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder(), k = MUZZLE_SCALE[cls];
  b.name('compensator bore').tube(.012,.0048,.043,WM.darkSteel,0,0,-.0195).mill([-.012,-.026].map(z=>({x:0,y:0,z,w:.038,h:.008,d:.006,radius:.0012})));
  b.name('threaded collar').tube(0.014, 0.009, 0.009, WM.darkSteel, 0, 0, 0);
  for(const z of [-.012,-.026]) b.name('top gas vent').box(.004,.001,.005,WM.dark,0,.012,z);
  b.build(p); p.scale.setScalar(k); p.userData.length = 0.041 * k;
  return p;
}

function suppressor({ weapon }: AttachContext, _fat: boolean): THREE.Object3D {
  const p = group(), b = new GunBuilder(), k = 1;
  const [radius,length] = ({m4a1:[.0155,.110],scar_h:[.017,.118],spear:[.017,.120],m249:[.0175,.123],ak47:[.0165,.114],mp7:[.0125,.078],vector:[.014,.085],m1911:[.0128,.078],awm:[.0195,.138]} as Partial<Record<WeaponId,[number,number]>>)[weapon] ?? [.016,.110];
  p.userData.host=weapon;
  b.name('suppressor body').tube(radius, 0.005, length, WM.darkSteel, 0, 0, -length / 2 + 0.002, HALF_PI, 0, 0, 32);
  b.name('quick-detach collar').tube(radius + 0.0015, radius - 0.001, 0.014, WM.dark, 0, 0, -0.009);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    b.name('collar knurl').box(0.002, 0.002, 0.012, WM.darkSteel, Math.sin(angle) * (radius + 0.001), Math.cos(angle) * (radius + 0.001), -0.009, 0, 0, -angle);
  }
  b.name('recessed end cap').tube(radius * 0.97, 0.0045, 0.006, WM.dark, 0, 0, -length + 0.003, HALF_PI, 0, 0, 32);
  b.name('suppressor flat').box(radius, 0.002, 0.043, WM.dark, 0, radius - 0.001, -length * 0.55);
  b.build(p); p.scale.setScalar(k); p.userData.length = length * k;
  return p;
}
function suppressor_long(ctx: AttachContext): THREE.Object3D { return suppressor(ctx, false); }
function suppressor_fat(ctx: AttachContext): THREE.Object3D { return suppressor(ctx, true); }

function brake_heavy({ cls }: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder(), k = MUZZLE_SCALE[cls];
  b.name('brake top web').box(0.030, 0.005, 0.057, WM.darkSteel, 0, 0.011, -0.026);
  b.name('brake lower web').box(0.030, 0.005, 0.057, WM.darkSteel, 0, -0.011, -0.026);
  for (const z of [0, -0.020, -0.040, -0.052]) b.name('open brake baffle').section([[-0.015, -0.014], [0.015, -0.014], [0.015, 0.014], [-0.015, 0.014]], 0.006, WM.darkSteel, 0, 0, z, { y: 0, radius: 0.005 });
  b.name('brake shoulder').tube(0.012, 0.005, 0.012, WM.steel, 0, 0, 0);
  b.build(p); p.scale.setScalar(k); p.userData.length = 0.056 * k;
  return p;
}

function duckbill(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('duckbill shoulder').tube(0.013, 0.0075, 0.020, WM.darkSteel, 0, 0, -0.006);
  b.name('duckbill top').box(0.029, 0.004, 0.029, WM.darkSteel, 0, 0.007, -0.026);
  b.name('duckbill bottom').box(0.029, 0.004, 0.029, WM.darkSteel, 0, -0.007, -0.026);
  for (const side of [-1, 1]) b.name('duckbill sidewall').box(0.004, 0.014, 0.026, WM.darkSteel, side * 0.013, 0, -0.025);
  b.build(p); p.userData.length = 0.041;
  return p;
}

function choke(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('choke tube').tube(0.012, 0.007, 0.034, WM.steel, 0, 0, -0.014);
  for (let i = 0; i < 4; i++) b.name('choke knurled ring').tube(0.0126, 0.0117, 0.002, WM.darkSteel, 0, 0, -0.006 - i * 0.007);
  b.build(p); p.userData.length = 0.032;
  return p;
}

/* ================= OPTIC ================= */

function opticDot(p: THREE.Group, y: number, z: number, r: number): void {
  const dot = new THREE.Mesh(new THREE.CircleGeometry(r, 12), WM.reticle);
  dot.position.set(0, y, z);
  dot.userData.adsHide = true;
  p.add(dot);
}

function opticGlass(p: THREE.Group, w: number, h: number, y: number, z: number): void {
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), WM.glass);
  glass.position.set(0, y, z);
  p.add(glass);
}

function opticLens(p: THREE.Group, r: number, y: number, z: number): void {
  const glass = new THREE.Mesh(new THREE.CircleGeometry(r, 20), WM.glass);
  glass.position.set(0, y, z);
  p.add(glass);
}

function reddot(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.030, 0.008, 0.036, WM.dark, 0, 0.004, 0);          // mount
  b.box(0.026, 0.006, 0.030, WM.poly, 0, 0.009, 0);          // deck
  b.box(0.004, 0.022, 0.030, WM.poly, -0.011, 0.017, 0);     // post L
  b.box(0.004, 0.022, 0.030, WM.poly, 0.011, 0.017, 0);      // post R
  b.box(0.026, 0.004, 0.030, WM.poly, 0, 0.030, 0);          // bridge
  b.cyl(0.007, 0.007, 0.008, WM.dark, 0.016, 0.009, 0, 0, 0, Math.PI / 2); // battery cap
  b.build(p);
  opticGlass(p, 0.018, 0.018, 0.018, 0.014);
  opticDot(p, 0.018, 0.0135, 0.0016);
  p.userData.lensH = 0.018;
  return p;
}

function holo(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.034, 0.008, 0.044, WM.dark, 0, 0.004, 0);
  b.box(0.005, 0.026, 0.038, WM.dark, -0.016, 0.020, 0);     // hood L
  b.box(0.005, 0.026, 0.038, WM.dark, 0.016, 0.020, 0);      // hood R
  b.box(0.037, 0.005, 0.038, WM.dark, 0, 0.035, 0);          // hood top
  b.box(0.038, 0.012, 0.020, WM.dark, 0, 0.012, 0.014);      // battery housing
  b.build(p);
  opticGlass(p, 0.027, 0.022, 0.022, 0.018);
  opticDot(p, 0.022, 0.0175, 0.0015);
  p.userData.lensH = 0.022;
  return p;
}

function acog(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.034, 0.010, 0.070, WM.dark, 0, 0.005, 0);          // mount
  b.box(0.036, 0.010, 0.075, WM.dark, 0, 0.005, 0);          // channel floor (below the axis)
  b.box(0.006, 0.028, 0.075, WM.dark, -0.015, 0.022, 0);     // wall L (clear of the glass)
  b.box(0.006, 0.028, 0.075, WM.dark, 0.015, 0.022, 0);      // wall R
  b.box(0.036, 0.008, 0.075, WM.dark, 0, 0.040, 0);          // top cover
  b.box(0.010, 0.006, 0.058, WM.tritium, 0, 0.046, 0);       // glowing fibre
  b.tube(0.015, 0.013, 0.026, WM.dark, 0, 0.024, -0.048, Math.PI / 2, 0, 0, 18); // objective bell (open)
  b.build(p);
  opticLens(p, 0.013, 0.024, -0.060);
  opticLens(p, 0.011, 0.024, 0.036);
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.0022, 0.005, 4), WM.reticle);
  chev.position.set(0, 0.024, 0.035);
  chev.userData.adsHide = true;
  p.add(chev);
  p.userData.lensH = 0.024;
  return p;
}

function lpvo(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.030, 0.008, 0.120, WM.dark, 0, 0.004, 0);
  b.tube(0.014, 0.0125, 0.130, WM.dark, 0, 0.024, 0, Math.PI / 2, 0, 0, 20); // tube (open)
  b.tube(0.016, 0.0135, 0.012, WM.darkSteel, 0, 0.024, -0.030, Math.PI / 2, 0, 0, 20); // ring F
  b.tube(0.016, 0.0135, 0.012, WM.darkSteel, 0, 0.024, 0.030, Math.PI / 2, 0, 0, 20);   // ring R
  for (const z of [-0.03, 0.03]) b.name('scope ring foot').box(0.020, 0.009, 0.014, WM.darkSteel, 0, 0.010, z);
  b.cyl(0.010, 0.010, 0.020, WM.dark, 0, 0.040, 0, 0, 0, 0);  // elevation turret
  b.build(p);
  opticLens(p, 0.0125, 0.024, -0.064);
  opticLens(p, 0.0125, 0.024, 0.064);
  opticDot(p, 0.024, 0.063, 0.0018);
  p.userData.lensH = 0.024;
  return p;
}

function scope_hp(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.030, 0.010, 0.150, WM.dark, 0, 0.005, 0);
  b.tube(0.016, 0.0145, 0.150, WM.dark, 0, 0.026, 0, Math.PI / 2, 0, 0, 22); // 34mm tube (open)
  b.turned([[0.016, -0.069], [0.026, -0.100], [0.026, -0.123], [0.024, -0.123], [0.024, -0.101], [0.0145, -0.069], [0.016, -0.069]], WM.dark, 0, 0.026, 0); // hollow objective bell
  b.turned([[0.016, 0.069], [0.020, 0.083], [0.020, 0.114], [0.018, 0.114], [0.018, 0.084], [0.0145, 0.069], [0.016, 0.069]], WM.dark, 0, 0.026, 0);
  for (const z of [-0.049, 0.049]) {
    b.name('scope ring foot').box(0.024, 0.012, 0.018, WM.darkSteel, 0, 0.010, z);
    b.name('annular scope ring').tube(0.018, 0.0155, 0.016, WM.darkSteel, 0, 0.026, z);
  }
  b.cyl(0.012, 0.012, 0.024, WM.darkSteel, 0, 0.046, 0, 0, 0, 0); // elevation
  b.cyl(0.012, 0.012, 0.024, WM.darkSteel, 0.026, 0.026, 0, 0, 0, Math.PI / 2); // windage
  b.build(p);
  opticLens(p, 0.024, 0.026, -0.121);
  opticLens(p, 0.0145, 0.026, 0.111);
  opticDot(p, 0.026, 0.110, 0.0016);
  p.userData.lensH = 0.026;
  return p;
}

function pistol_rmr(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.022, 0.006, 0.030, WM.dark, 0, 0.003, 0.005);       // plate
  b.box(0.020, 0.005, 0.026, WM.poly, 0, 0.0085, 0.005);     // deck
  b.box(0.003, 0.014, 0.026, WM.poly, -0.008, 0.016, 0.005); // post L
  b.box(0.003, 0.014, 0.026, WM.poly, 0.008, 0.016, 0.005);  // post R
  b.box(0.020, 0.003, 0.026, WM.poly, 0, 0.024, 0.005);      // bridge
  b.build(p);
  opticGlass(p, 0.013, 0.012, 0.016, 0.017);
  opticDot(p, 0.016, 0.0165, 0.0013);
  p.userData.lensH = 0.016;
  return p;
}

/* ================= MAGAZINE ================= */

// Feed-neck cross sections and rake follow the host's magazine well.
function magDimensions(weapon: WeaponId, extended = true) {
  switch (weapon) {
    case 'm1911': return { width: 0.019, depth: 0.026, length: extended ? 0.104 : 0.086, rake: extended ? 0.030 : 0.024, ribs: 0 };
    case 'deagle': return { width: 0.025, depth: 0.030, length: extended ? 0.112 : 0.094, rake: extended ? 0.032 : 0.027, ribs: 0 };
    case 'mp7': return { width: 0.023, depth: 0.029, length: extended ? 0.171 : 0.152, rake: extended ? 0.038 : 0.034, ribs: 2 };
    case 'vector': return { width: 0.026, depth: 0.037, length: extended ? 0.165 : 0.146, bend: 0.010, ribs: 2 };
    case 'ak47': return { width: 0.029, depth: 0.054, length: extended ? 0.198 : 0.171, bend: extended ? 0.080 : 0.067, ribs: 3 };
    case 'scar_h': case 'spear': return { width: weapon === 'spear' ? 0.033 : 0.031, depth: weapon === 'spear' ? 0.067 : 0.066, length: extended ? 0.139 : weapon === 'spear' ? 0.122 : 0.113, bend: 0.001, ribs: 2 };
    default: return { width: 0.027, depth: 0.054, length: extended ? 0.161 : 0.140, bend: 0.023, ribs: 3 };
  }
}

function mag_ext(ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  magazine(b, { ...magDimensions(ctx.weapon), material: (ctx.weapon==='scar_h'||ctx.weapon==='spear') ? WM.fde : ctx.weapon==='vector'||ctx.weapon==='mp7' ? WM.darkSteel : WM.midSteel });
  b.build(p); p.userData.variant = ctx.cls === 'PISTOL' ? 'pistol' : 'std';
  return p;
}

function mag_drum(ctx: AttachContext): THREE.Object3D {
  const p=group(),b=new GunBuilder(),dimensions=magDimensions(ctx.weapon,false);
  const vector=ctx.weapon==='vector', ak=ctx.weapon==='ak47';
  const radius=ak?.050:vector?.038:.043;
  const neck=vector?.105:.053, centerY=-(neck+radius*.56), centerZ=ak?-.010:0;
  magazine(b,{...dimensions,length:neck,bend:0,rake:0,ribs:0});
  b.name('sealed host-specific drum').cyl(radius,radius,.034,WM.darkSteel,0,centerY,centerZ,0,0,HALF_PI,48);
  for(const side of [-1,1]) {
    b.name('drum face cover').cyl(radius*.93,radius*.93,.0025,ak?WM.midSteel:WM.poly,side*.017,centerY,centerZ,0,0,HALF_PI,48);
    b.name('drum cover seam').tube(radius*.97,radius*.93,.0018,WM.dark,side*.018,centerY,centerZ,0,0,HALF_PI,40);
    b.name('drum winding key').box(.002,.011,.024,WM.dark,side*.019,centerY,centerZ);
    for(const z of [-radius*.64,radius*.64]) screw(b,side*.019,centerY,centerZ+z,.0022);
  }
  b.build(p);p.userData.host=ctx.weapon;return p;
}

function mag_quick(ctx: AttachContext): THREE.Object3D {
  const p=group(),b=new GunBuilder(),dim=magDimensions(ctx.weapon,false);
  magazine(b,{...dim,material:WM.darkSteel});
  const y=.008-dim.length, z=(dim.rake??0)-(dim.bend??0);
  b.name('quick-pull magazine bumper').box(dim.width+.005,.009,dim.depth+.006,WM.rubber,0,y-.002,z);
  b.name('textured pull tab').profile([[z-.010,y],[z+.010,y],[z+.012,y-.014],[z-.010,y-.014]],dim.width*.65,WM.grip,0,.0012,[[[z-.005,y-.005],[z+.005,y-.005],[z+.005,y-.010],[z-.005,y-.010]]]);
  b.build(p);return p;
}

function mag_coupled(ctx: AttachContext): THREE.Object3D {
  const p = group(), dimensions = magDimensions(ctx.weapon, false);
  const gap = dimensions.width + 0.011;
  for (let i = 0; i < 2; i++) {
    const mag = group(), b = new GunBuilder(); mag.name = i ? 'coupled spare magazine' : 'seated magazine';
    magazine(b, dimensions); b.build(mag); mag.position.set(i * gap, i ? -0.028 : 0, 0); p.add(mag);
  }
  const b = new GunBuilder(), y = ctx.weapon === 'mp7' ? -0.117 : -0.085;
  const z = (dimensions.rake ?? 0) * 0.65 - (dimensions.bend ?? 0) * 0.4;
  b.name('magazine coupling clamp').box(gap + dimensions.width + 0.003, 0.018, dimensions.depth + 0.004, WM.dark, gap / 2, y, z);
  b.build(p); batchRigidGroup(p);
  return p;
}

function shell_tube(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('tube extension').cyl(0.010, 0.010, 0.054, WM.darkSteel, 0, 0, -0.025, HALF_PI, 0, 0, 24);
  b.name('tube collar').tube(0.012, 0.009, 0.015, WM.darkSteel, 0, 0, -0.003);
  b.name('tube end cap').cyl(0.011, 0.011, 0.013, WM.darkSteel, 0, 0, -0.054, HALF_PI, 0, 0, 24);
  b.build(p); p.userData.preserveReloadHandle = true;
  return p;
}

function belt_box_large(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('ammo pack hanger').box(0.031, 0.021, 0.075, WM.darkSteel, 0, 0.001, 0);
  b.name('large ammo box').profile([[-0.070, -0.005], [0.068, -0.005], [0.073, -0.112], [0.060, -0.123], [-0.063, -0.123], [-0.072, -0.105]], 0.094, WM.od, 0, 0.0020);
  b.name('ammo pack lid').box(0.096, 0.011, 0.146, WM.dark, 0, -0.004, 0);
  for (const side of [-1, 1]) {
    b.name('ammo pack seam').box(0.002, 0.004, 0.118, WM.darkSteel, side * 0.047, -0.099, 0);
    b.name('ammo pack latch').box(0.004, 0.028, 0.019, WM.darkSteel, side * 0.048, -0.018, 0.050);
  }
  b.name('feed guide').box(0.012, 0.035, 0.057, WM.darkSteel, -0.045, 0.005, 0.013);
  const path = [[-0.025, 0.055], [-0.032, 0.050], [-0.039, 0.042], [-0.045, 0.029], [-0.047, 0.014]];
  path.forEach(([x, y], i) => {
    b.name('belt cartridge').cyl(0.0035, 0.0035, 0.030, WM.brass, x, y, 0.015, HALF_PI, 0, 0, 12);
    b.name('belt link').box(0.008, 0.005, 0.007, WM.darkSteel, x, y, 0.022);
    if (i) b.name('belt connector').rod([path[i - 1][0], path[i - 1][1], 0.022], [x, y, 0.022], 0.0015, WM.darkSteel, 0.0015, 8);
  });
  b.build(p);
  return p;
}

function mag_box_sr(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  magazine(b, { width: 0.027, depth: 0.068, length: 0.083, ribs: 2 }); b.build(p);
  return p;
}

/* ================= UNDERBARREL ================= */

function vgrip(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder(); verticalGrip(b, 0, 0, 0.074); b.build(p); return p;
}

function agrip(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('angled grip clamp').box(0.026, 0.013, 0.057, WM.darkSteel, 0, -0.004, 0);
  b.name('angled grip shell').profile([[-0.027, -0.008], [0.027, -0.008], [0.026, -0.026], [0.015, -0.029], [-0.029, -0.016]], 0.025, WM.poly, 0, 0.001, [[[-0.011, -0.011], [0.018, -0.011], [0.017, -0.021]]]);
  b.name('handstop').box(0.024, 0.025, 0.009, WM.grip, 0, -0.013, -0.028);
  b.build(p); return p;
}

function bipod(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('bipod shoe').box(0.028, 0.018, 0.037, WM.dark, 0, -0.007, 0);
  b.name('bipod cant axle').cyl(0.006, 0.006, 0.034, WM.steel, 0, -0.015, 0, 0, 0, HALF_PI, 16);
  b.build(p);
  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = group(), lb = new GunBuilder(); pivot.name = 'folding bipod leg';
    pivot.position.set(side * 0.013, -0.015, 0);
    lb.name('bipod hinge').cyl(0.006, 0.006, 0.009, WM.steel, 0, 0, 0, 0, 0, HALF_PI, 16);
    lb.name('telescopic leg').cyl(0.0045, 0.0035, 0.106, WM.steel, 0, -0.051, 0, 0, 0, 0, 16);
    lb.name('rubber foot').box(0.014, 0.011, 0.018, WM.rubber, 0, -0.106, 0);
    lb.build(pivot);
    pivot.rotation.set(HALF_PI, 0, side * 0.12); // folds FORWARD alongside the barrel, not sideways through the gun
    p.add(pivot); legs.push(pivot);
  }
  p.userData.legs = legs; p.userData.foldAxis = 'x';
  return p;
}

function masterkey(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('breacher mount').box(0.029, 0.019, 0.072, WM.dark, 0, -0.007, 0.012);
  b.name('breacher receiver').profile([[0.047, -0.014], [-0.033, -0.014], [-0.042, -0.050], [0.031, -0.056], [0.047, -0.040]], 0.026, WM.darkSteel, 0, 0.0008);
  b.name('breacher barrel').tube(0.010, 0.006, 0.160, WM.steel, 0, -0.029, -0.065);
  b.name('breacher tube').cyl(0.008, 0.008, 0.112, WM.darkSteel, 0, -0.047, -0.064, HALF_PI, 0, 0, 20);
  b.name('breacher barrel band').box(0.024, 0.036, 0.014, WM.darkSteel, 0, -0.038, -0.115);
  b.name('breacher pump').box(0.029, 0.025, 0.061, WM.poly, 0, -0.051, -0.061);
  for (let i = 0; i < 5; i++) b.name('pump texture rib').box(0.030, 0.024, 0.002, WM.dark, 0, -0.051, -0.084 + i * 0.011);
  b.build(p); return p;
}

/* ================= STOCK ================= */

function stock_none(_ctx: AttachContext): THREE.Object3D {
  const p = group(); p.userData.empty = true; return p;
}

function stock_heavy(ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('stock receiver adapter').box(0.032, 0.038, 0.032, WM.dark, 0, 0, 0.010);
  b.name('stock extension tube').cyl(0.012, 0.012, 0.139, WM.steel, 0, 0.004, 0.085, HALF_PI, 0, 0, 24);
  b.name('continuous stock shell').profile([[0.038, 0.015], [0.158, 0.015], [0.169, 0.003], [0.170, -0.061], [0.151, -0.063], [0.047, -0.026], [0.038, -0.014]], 0.033, WM.poly, 0, 0.0012, [[[0.072, -0.015], [0.141, -0.015], [0.153, -0.044], [0.089, -0.025]]]);
  b.name('supported cheek riser').profile([[0.037, 0.012], [0.148, 0.012], [0.153, 0.022], [0.048, 0.027], [0.037, 0.021]], 0.036, WM.poly, 0, 0.001);
  b.name('recoil pad').box(0.038, 0.082, 0.015, WM.rubber, 0, -0.023, 0.171);
  screw(b, -0.017, -0.020, 0.155, 0.0037);
  b.build(p);
  if (ctx.cls === 'SMG' || ctx.cls === 'PDW') p.scale.setScalar(0.9);
  p.userData.variant = ctx.cls === 'SMG' || ctx.cls === 'PDW' ? 'compact' : 'std';
  return p;
}

function stock_folding(ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('folding stock adapter').box(0.029, 0.034, 0.028, WM.dark, 0, 0, 0.008);
  b.name('stock hinge pin').cyl(0.0045, 0.0045, 0.036, WM.steel, -0.009, 0, 0.012, 0, 0, 0, 16);
  b.name('folding stock frame').profile([[0.014, 0.010], [0.142, 0.010], [0.152, -0.002], [0.152, -0.049], [0.137, -0.052], [0.024, -0.014]], 0.025, WM.darkSteel, 0, 0.001, [[[0.042, 0.001], [0.133, 0.001], [0.140, -0.036], [0.049, -0.010]]]);
  b.name('stock buttpad').box(0.031, 0.068, 0.013, WM.poly, 0, -0.021, 0.153);
  b.build(p);
  if (ctx.cls === 'SMG' || ctx.cls === 'PDW') p.scale.setScalar(0.9);
  p.userData.variant = ctx.cls === 'SMG' || ctx.cls === 'PDW' ? 'compact' : 'std';
  return p;
}

/** Padding follows the host's exact native stock geometry in socket space. */
function stock_fit(ctx:AttachContext, light=false): THREE.Object3D {
  const p=group(),b=new GunBuilder(),socket=ctx.model.sockets.stock;
  if(!socket)return p;
  ctx.model.group.updateWorldMatrix(true,true);
  const inv=socket.matrixWorld.clone().invert();
  for(const stock of ctx.model.removable.stock??[])stock.traverse(o=>{
    const mesh=o as THREE.Mesh;
    if(!mesh.isMesh)return;
    const pieces=mesh.geometry.userData.pieces as {name:string;start:number;count:number}[]|undefined;
    for(const piece of pieces??[]){
      const match=light ? /cheek|recoil pad|rubber pad/.test(piece.name) : /cheek|buttpad|recoil pad|rubber.*pad|stock.*pad/.test(piece.name);
      if(!match)continue;
      const geo=new THREE.BufferGeometry();
      for(const [key,attr]of Object.entries(mesh.geometry.attributes)) {
        geo.setAttribute(key,new THREE.Float32BufferAttribute(attr.array.slice(piece.start*attr.itemSize,(piece.start+piece.count)*attr.itemSize),attr.itemSize));
      }
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,mesh.matrixWorld));geo.computeBoundingBox();
      const center=geo.boundingBox!.getCenter(new THREE.Vector3());
      geo.translate(-center.x,-center.y,-center.z);geo.scale(1.025,1.018,1.018);geo.translate(center.x,center.y,center.z);
      b.name(light?'fitted lightweight sleeve':'native-stock recoil padding').surface(geo,WM.grip,0,0,0);
    }
  });
  b.build(p);p.userData.keepFactoryStock=true;p.userData.host=ctx.weapon;return p;
}

function ak_brake(_ctx:AttachContext):THREE.Object3D {
  const p=group(),b=new GunBuilder();
  b.name('AK threaded slant brake').tube(.012,.0045,.034,WM.darkSteel,0,0,-.014).mill([{x:0,y:-.012,z:-.031,w:.032,h:.026,d:.010,rx:.40,radius:.001}]);
  b.name('AK brake threaded shoulder').tube(.0125,.008,.010,WM.midSteel,0,0,-.001);
  b.build(p);p.userData.length=.031;return p;
}
function pistol_brake(_ctx:AttachContext):THREE.Object3D {
  const p=group(),b=new GunBuilder();
  b.name('Eagle profile brake').section([[-.014,-.010],[.014,-.010],[.014,.004],[.008,.013],[-.008,.013],[-.014,.004]],.027,WM.darkSteel,0,0,-.011,{y:0,radius:.0055})
    .mill([-.007,-.018].map(z=>({x:0,y:.003,z,w:.039,h:.005,d:.004,radius:.001})));
  b.build(p);p.userData.length=.025;return p;
}

/* ================= RAIL ================= */

function laser_box(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('rail clamp shoe').box(0.024, 0.006, 0.036, WM.darkSteel, 0, 0.001, 0);
  b.name('rail clamp').box(0.022, 0.010, 0.040, WM.poly, 0, 0.006, 0);
  b.name('laser housing').box(0.020, 0.022, 0.055, WM.dark, 0, 0.021, 0);
  b.name('emitter bezel').tube(0.006, 0.0032, 0.007, WM.darkSteel, 0, 0.023, -0.029);
  b.name('laser control button').box(0.008, 0.002, 0.013, WM.poly, 0, 0.032, 0.008);
  b.build(p);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0033, 16), WM.reticle);
  lens.position.set(0, 0.023, -0.031); lens.rotation.y = Math.PI;
  p.add(lens); p.userData.lensMesh = lens;
  return p;
}

function light_box(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  b.name('light mounting shoe').box(0.024, 0.006, 0.037, WM.darkSteel, 0, 0.001, 0.008);
  b.name('light clamp').box(0.020, 0.014, 0.030, WM.poly, 0, 0.010, 0.008);
  b.name('light body').cyl(0.011, 0.011, 0.055, WM.dark, 0, 0.024, 0, HALF_PI, 0, 0, 24);
  b.name('light bezel').tube(0.014, 0.010, 0.022, WM.darkSteel, 0, 0.024, -0.034);
  b.name('tail switch').cyl(0.008, 0.008, 0.008, WM.rubber, 0, 0.024, 0.030, HALF_PI, 0, 0, 16);
  b.build(p);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0103, 24), WM.tritium);
  lens.position.set(0, 0.024, -0.043); lens.rotation.y = Math.PI;
  p.add(lens); p.userData.lensMesh = lens;
  return p;
}

function canted_irons(_ctx: AttachContext): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  for (const z of [-0.054, 0.034]) {
    b.name('canted sight clamp').box(0.017, 0.008, 0.021, WM.dark, 0, 0.002, z);
    b.name('offset sight stalk').rod([0, 0.004, z], z < 0 ? [0.014, 0.024, z] : [0.013, 0.021, z], 0.0035, WM.darkSteel);
  }
  b.name('canted rear aperture').tube(0.006, 0.003, 0.006, WM.darkSteel, 0.015, 0.024, 0.034);
  b.name('canted front blade').box(0.003, 0.007, 0.003, WM.darkSteel, 0.015, 0.025, -0.054, 0, 0, -Math.PI / 4);
  b.build(p); const aim=new THREE.Object3D();aim.position.set(.015,.024,.034);p.add(aim);p.userData.aim=aim;return p;
}

/* ================= BARREL ================= */

function barrelSpan(model: WeaponModel): number {
  const bz = model.sockets.barrel?.position.z ?? -0.40;
  const socket = model.sockets.muzzle;
  const mz = (socket?.userData.homeZ as number | undefined) ?? socket?.position.z ?? -0.60;
  return Math.max(0.015, bz - mz);
}

function replacementBarrel(ctx: AttachContext, length: number, shift: number, ported = false): THREE.Object3D {
  const p = group(), b = new GunBuilder();
  p.userData.variant = ctx.cls === 'PISTOL' ? 'pistol' : 'std';
  p.userData.muzzleShift = shift;
  const pistol = ctx.cls === 'PISTOL', radius = ctx.weapon === 'm1911' ? 0.0069 : 0.009;
  b.name('replacement barrel').tube(radius, pistol ? radius * 0.54 : 0.0042, length + 0.005, WM.steel, 0, 0, -length / 2 + 0.0025, HALF_PI, 0, 0, 28);
  b.name('barrel shoulder').tube(pistol ? 0.010 : 0.014, radius - 0.001, 0.015, WM.darkSteel, 0, 0, 0);
  b.name('thread protector').tube(radius + 0.0012, radius - 0.001, 0.011, WM.darkSteel, 0, 0, -length + 0.0055);
  if (ctx.weapon === 'deagle') {
    b.name('Eagle polygonal barrel jacket').section([[-0.019, -0.019], [0.019, -0.019], [0.019, 0.007], [0.009, 0.024], [-0.009, 0.024], [-0.019, 0.007]], length - 0.009, WM.steel, 0, 0, -length / 2 + 0.001, { y: 0, radius: 0.0092 });
    b.name('Eagle gas housing').box(0.024, 0.014, length - 0.014, WM.darkSteel, 0, -0.021, -length / 2 + 0.003);
  }
  if (ctx.weapon === 'deagle') {
    const front = group(), fb = new GunBuilder(); front.name = 'replacement pistol sight';
    fb.name('connected front blade').box(0.0038, 0.011, 0.006, WM.darkSteel, 0, 0.028, -length + 0.017);
    fb.build(front); p.add(front); p.userData.barrelSight = front;
  }
  if (!pistol) {
    b.name('seated barrel shroud').tube(0.015, radius - 0.001, Math.min(length, 0.058), WM.poly, 0, 0, -Math.min(length, 0.058) / 2 + 0.003);
    b.name('gas journal').box(0.020, 0.018, 0.020, WM.darkSteel, 0, 0.005, -length * 0.38);
    if (['m4a1', 'ak47', 'm249'].includes(ctx.weapon)) {
      const sights = group(), sb = new GunBuilder(); sights.name = 'replacement barrel front sight';
      const height = ctx.model.sightY - (ctx.model.sockets.barrel?.position.y ?? 0);
      const z = -length + 0.026;
      sb.name('front sight sleeve').tube(0.012, radius - 0.001, 0.022, WM.darkSteel, 0, 0, z);
      sb.name('connected sight tower').profile([[z - 0.010, 0.004], [z + 0.010, 0.004], [z + 0.006, height - 0.012], [z - 0.006, height - 0.012]], 0.012, WM.darkSteel, 0, 0.0006);
      sb.name('front sight blade').box(0.003, 0.016, 0.004, WM.dark, 0, height - 0.008, z);
      sb.build(sights); p.add(sights); p.userData.barrelSight = sights;
    }
  }
  if (ported) for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const x = ctx.weapon === 'deagle' ? 0.019 : radius;
    b.name('barrel port recess').box(0.001, 0.005, 0.006, WM.darkSteel, side * x, 0, -length + 0.013 + i * 0.010);
  }
  b.build(p);
  return p;
}

function barrel_long(ctx: AttachContext): THREE.Object3D {
  const ext = BARREL_LONG_EXT[ctx.cls];
  return replacementBarrel(ctx, barrelSpan(ctx.model) + ext, -ext);
}

function barrel_short(ctx: AttachContext): THREE.Object3D {
  // Pistol muzzles must remain in front of the fixed slide/frame, not buried inside it.
  const clearance = ctx.weapon === 'm1911' ? 0.002 : ctx.weapon === 'deagle' ? 0.023 : BARREL_SHORT_RED[ctx.cls];
  const span = barrelSpan(ctx.model), reduction = Math.min(clearance, span - 0.015);
  return replacementBarrel(ctx, span - reduction, reduction);
}

function ported_slide(ctx: AttachContext): THREE.Object3D {
  return replacementBarrel(ctx, barrelSpan(ctx.model), 0, true);
}

/* ================= REGISTRY + MOUNT OPS ================= */

export const ATTACHMENT_BUILDERS: Record<string, AttachmentBuilder> = {
  flash_hider, compensator, suppressor_long, suppressor_fat, brake_heavy, duckbill, choke,
  reddot, holo, acog, lpvo, scope_hp, pistol_rmr,
  mag_ext, mag_drum, mag_coupled, shell_tube, belt_box_large, mag_box_sr,
  vgrip, agrip, bipod, masterkey,
  stock_none, stock_heavy, stock_folding,
  laser_box, light_box, canted_irons,
  barrel_long, barrel_short, ported_slide,
  ak_brake, pistol_brake, mag_quick,
  stock_fit:ctx=>stock_fit(ctx), stock_light:ctx=>stock_fit(ctx,true),
  ...EQUIPMENT_BUILDERS,
};

/** Barrel seats before muzzle so cans land on the new bore end. */
export const ATTACH_ORDER: AttachSlot[] = ['barrel', 'muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail'];

const originalMag = new WeakMap<WeaponModel, THREE.Object3D>();

function disposePart(part: THREE.Object3D): void {
  part.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
    // Builders use shared WM materials. The viewer/engine own and release their clones.
  });
}

/** A component shared by two replaceable assemblies stays hidden until BOTH are stripped. */
function refreshStockVisibility(model: WeaponModel): void {
  const hidden = new Set<THREE.Object3D>();
  for (const slot of Object.keys(model.attached) as AttachSlot[]) {
    if (slot==='stock' && model.attached.stock?.userData.keepFactoryStock) continue;
    for (const object of model.removable[slot] ?? []) hidden.add(object);
  }
  for (const list of Object.values(model.removable)) for (const object of list ?? []) object.visible = !hidden.has(object);
  const sight = model.attached.barrel?.userData.barrelSight as THREE.Object3D | undefined;
  if (sight) sight.visible = !model.attached.optic;
}

/** Recompute from home anchors rather than accumulating offsets as slots are swapped. */
function refreshMuzzle(model: WeaponModel): void {
  const socket = model.sockets.muzzle;
  if (!socket) return;
  socket.userData.homeZ ??= socket.position.z;
  model.muzzle.userData.homeZ ??= model.muzzle.position.z;
  const barrel = model.attached.barrel;
  socket.position.z = (socket.userData.homeZ as number) + ((barrel?.userData.muzzleShift as number | undefined) ?? 0);
  const device = model.attached.muzzle;
  if (device) {
    device.position.copy(socket.position);
    model.muzzle.position.z = socket.position.z - (device.userData.length as number);
  } else model.muzzle.position.z = barrel ? socket.position.z - 0.004 : model.muzzle.userData.homeZ as number;
}

/** The AK's receiver-side dovetail needs a real cantilever, not an optic hovering above the cover. */
function addMountAdapter(part: THREE.Object3D, weapon: WeaponId, slot: AttachSlot): void {
  if (weapon !== 'ak47' || slot !== 'optic') return;
  const b = new GunBuilder();
  b.name('AK dovetail clamp').box(0.012, 0.014, 0.080, WM.darkSteel, -0.025, -0.044, 0);
  b.name('AK side-mount upright').box(0.008, 0.046, 0.053, WM.darkSteel, -0.026, -0.028, 0);
  b.name('AK cantilever deck').box(0.043, 0.008, 0.083, WM.darkSteel, -0.009, -0.0036, 0);
  b.name('AK dovetail locking lever').box(0.004, 0.007, 0.050, WM.dark, -0.032, -0.043, 0.012);
  b.build(part);
}

/** Mount in the socket's reference frame, including side rails and reciprocating slides. */
export function attach(model: WeaponModel, entry: AttachmentCatalogEntry, weapon: WeaponId): boolean {
  if (!isCompatible(entry, weapon) || (model.group.userData.weaponId && model.group.userData.weaponId !== weapon)) return false;
  const slot = entry.slot;
  const socket = model.sockets[slot], builder = ATTACHMENT_BUILDERS[entry.visual];
  if (!socket || !builder) return false;
  detach(model, slot);
  const part = builder({ weapon, model, entry, cls: weaponById(weapon)?.cls ?? 'AR' });
  part.name = entry.name;
  addMountAdapter(part, weapon, slot);
  part.position.copy(socket.position);
  part.quaternion.copy(socket.quaternion);
  (socket.parent ?? model.group).add(part);
  model.attached[slot] = part;
  refreshStockVisibility(model);
  if (slot === 'optic') {
    model.group.updateWorldMatrix(true, true);
    const mount = model.group.worldToLocal(socket.getWorldPosition(new THREE.Vector3()));
    part.userData.sightYOffset = mount.y + ((part.userData.lensH as number | undefined) ?? 0.022) - model.sightY;
    part.traverse(o => { if (o.userData.adsHide) model.adsHidden.push(o); });
  }
  if (slot === 'magazine' && !part.userData.preserveReloadHandle) {
    if (!originalMag.has(model)) originalMag.set(model, model.mag);
    part.userData.homeY = socket.position.y;
    part.userData.homeZ = socket.position.z;
    model.mag = part;
  }
  if (slot === 'barrel' || slot === 'muzzle') refreshMuzzle(model);
  return true;
}

/** Unmount without resurrecting hidden irons, orphaning a slide optic, or moving a live muzzle. */
export function detach(model: WeaponModel, slot: AttachSlot): void {
  const part = model.attached[slot];
  if (part) {
    part.traverse(o => {
      const i = model.adsHidden.indexOf(o);
      if (i >= 0) model.adsHidden.splice(i, 1);
    });
    part.removeFromParent();
    disposePart(part);
    delete model.attached[slot];
  }
  if (slot === 'magazine' && originalMag.has(model)) model.mag = originalMag.get(model)!;
  refreshStockVisibility(model);
  if (slot === 'barrel' || slot === 'muzzle') refreshMuzzle(model);
}

/** Detach everything, then mount the full build (barrel before muzzle, always). */
export function applyBuild(model: WeaponModel, build: WeaponBuild): void {
  if (model.group.userData.weaponId && model.group.userData.weaponId !== build.weapon) return;
  build = sanitizeBuild(build);
  for (const slot of Object.keys(model.attached) as AttachSlot[]) detach(model, slot);
  for (const slot of ATTACH_ORDER) {
    const id = build.attachments[slot];
    if (!id) continue;
    const entry = attachmentById(id);
    if (entry && entry.slot === slot) attach(model, entry, build.weapon);
  }
}
