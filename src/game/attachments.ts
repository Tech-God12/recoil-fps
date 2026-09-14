// Recoil FPS — Armory attachment visuals: procedural parts that bolt onto gun sockets.
// Parts build in SOCKET space (origin = mount point, −Z toward the muzzle) and the
// attach() helper seats them on the live socket, hides stock meshes, and rewires
// muzzle/mag references. Shared WM materials are never disposed — only geometries.
import * as THREE from 'three';
import { GunBuilder, WM, type WeaponModel } from './models';
import { attachmentById, weaponById, type AttachSlot, type AttachmentCatalogEntry, type WeaponClass, type WeaponId } from './economy/catalog';
import type { WeaponBuild } from './economy/loadout';

export interface AttachContext {
  weapon: WeaponId;
  model: WeaponModel;
  cls: WeaponClass;
}

export type AttachmentBuilder = (ctx: AttachContext) => THREE.Object3D;

/** Muzzle-device scale per weapon class (no per-weapon hacks). */
const MUZZLE_SCALE: Record<WeaponClass, number> = {
  AR: 1, BR: 1, LMG: 1.05, SMG: 0.85, PDW: 0.85, SR: 1.15, SG: 1, PISTOL: 0.75,
};
const BARREL_LONG_EXT: Record<WeaponClass, number> = {
  AR: 0.12, BR: 0.12, LMG: 0.12, SMG: 0.11, PDW: 0.10, SR: 0.10, SG: 0.10, PISTOL: 0.06,
};
const BARREL_SHORT_RED: Record<WeaponClass, number> = {
  AR: 0.10, BR: 0.10, LMG: 0.10, SMG: 0.06, PDW: 0.06, SR: 0.06, SG: 0.06, PISTOL: 0.035,
};

function group(): THREE.Group {
  return new THREE.Group();
}

/* ================= MUZZLE ================= */

function flash_hider({ cls }: AttachContext): THREE.Object3D {
  const k = MUZZLE_SCALE[cls];
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.011, 0.011, 0.016, WM.darkSteel, 0, 0, -0.008, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    b.box(0.005, 0.005, 0.034, WM.steel, Math.cos(a) * 0.009, Math.sin(a) * 0.009, -0.032);
  }
  b.build(p);
  p.scale.setScalar(k);
  p.userData.length = 0.05 * k;
  return p;
}

function compensator({ cls }: AttachContext): THREE.Object3D {
  const k = MUZZLE_SCALE[cls];
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.013, 0.013, 0.050, WM.steel, 0, 0, -0.025, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    b.box(0.028, 0.006, 0.008, WM.dark, 0, 0.004, -0.012 - i * 0.013);
    b.box(0.028, 0.006, 0.008, WM.dark, 0, -0.004, -0.012 - i * 0.013);
  }
  b.cyl(0.014, 0.014, 0.006, WM.darkSteel, 0, 0, -0.003, Math.PI / 2);
  b.build(p);
  p.scale.setScalar(k);
  p.userData.length = 0.055 * k;
  return p;
}

function suppressor_long({ cls }: AttachContext): THREE.Object3D {
  const k = MUZZLE_SCALE[cls];
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.017, 0.017, 0.150, WM.darkSteel, 0, 0, -0.075, Math.PI / 2, 0, 0, 20);
  b.cyl(0.0185, 0.0185, 0.014, WM.dark, 0, 0, -0.020, Math.PI / 2, 0, 0, 20); // knurled ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(0.003, 0.003, 0.012, WM.darkSteel, Math.cos(a) * 0.018, Math.sin(a) * 0.018, -0.020);
  }
  b.cyl(0.012, 0.014, 0.012, WM.dark, 0, 0, -0.150, Math.PI / 2, 0, 0, 20);   // end cap
  b.cyl(0.005, 0.005, 0.014, WM.poly, 0, 0, -0.150, Math.PI / 2);             // bore
  b.box(0.020, 0.006, 0.060, WM.dark, 0, 0.016, -0.080);                      // top flat
  b.build(p);
  p.scale.setScalar(k);
  p.userData.length = 0.158 * k;
  return p;
}

function suppressor_fat(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.023, 0.023, 0.125, WM.darkSteel, 0, 0, -0.062, Math.PI / 2, 0, 0, 22);
  b.cyl(0.0245, 0.0245, 0.016, WM.dark, 0, 0, -0.024, Math.PI / 2, 0, 0, 22);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box(0.003, 0.003, 0.014, WM.darkSteel, Math.cos(a) * 0.024, Math.sin(a) * 0.024, -0.024);
  }
  b.cyl(0.016, 0.020, 0.014, WM.dark, 0, 0, -0.128, Math.PI / 2, 0, 0, 22);
  b.cyl(0.006, 0.006, 0.016, WM.poly, 0, 0, -0.128, Math.PI / 2);
  b.build(p);
  p.userData.length = 0.136;
  return p;
}

function brake_heavy({ cls }: AttachContext): THREE.Object3D {
  const k = MUZZLE_SCALE[cls];
  const p = group();
  const b = new GunBuilder();
  b.box(0.024, 0.024, 0.058, WM.darkSteel, 0, 0, -0.029);
  b.box(0.030, 0.012, 0.012, WM.poly, 0, 0, -0.018);   // chamber 1 port
  b.box(0.030, 0.012, 0.012, WM.poly, 0, 0, -0.040);   // chamber 2 port
  b.box(0.010, 0.006, 0.040, WM.dark, 0, 0.013, -0.029); // top ports
  b.cyl(0.008, 0.008, 0.060, WM.poly, 0, 0, -0.029, Math.PI / 2); // bore shadow
  b.build(p);
  p.scale.setScalar(k);
  p.userData.length = 0.06 * k;
  return p;
}

function duckbill(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.013, 0.013, 0.018, WM.darkSteel, 0, 0, -0.009, Math.PI / 2);
  b.box(0.034, 0.012, 0.026, WM.darkSteel, 0, 0, -0.030); // flared fan
  b.box(0.028, 0.004, 0.024, WM.poly, 0, 0, -0.031);      // slot
  b.build(p);
  p.userData.length = 0.044;
  return p;
}

function choke(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.012, 0.012, 0.030, WM.steel, 0, 0, -0.015, Math.PI / 2);
  for (let i = 0; i < 4; i++) b.cyl(0.0128, 0.0128, 0.003, WM.darkSteel, 0, 0, -0.006 - i * 0.007, Math.PI / 2);
  b.build(p);
  p.userData.length = 0.032;
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
  b.cyl(0.015, 0.015, 0.026, WM.dark, 0, 0.024, -0.048, Math.PI / 2, 0, 0, 18, true); // objective bell (open)
  b.cyl(0.0135, 0.0135, 0.026, WM.scopeInner, 0, 0.024, -0.048, Math.PI / 2, 0, 0, 18, true); // dark bore
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
  b.cyl(0.014, 0.014, 0.130, WM.dark, 0, 0.024, 0, Math.PI / 2, 0, 0, 20, true); // tube (open)
  b.cyl(0.0128, 0.0128, 0.130, WM.scopeInner, 0, 0.024, 0, Math.PI / 2, 0, 0, 20, true); // dark bore
  b.cyl(0.016, 0.016, 0.012, WM.darkSteel, 0, 0.024, -0.030, Math.PI / 2, 0, 0, 20, true); // ring F
  b.cyl(0.016, 0.016, 0.012, WM.darkSteel, 0, 0.024, 0.030, Math.PI / 2, 0, 0, 20, true);   // ring R
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
  b.cyl(0.016, 0.016, 0.150, WM.dark, 0, 0.026, 0, Math.PI / 2, 0, 0, 22, true); // 34mm tube (open)
  b.cyl(0.0148, 0.0148, 0.150, WM.scopeInner, 0, 0.026, 0, Math.PI / 2, 0, 0, 22, true); // dark bore
  b.cyl(0.026, 0.018, 0.055, WM.dark, 0, 0.026, -0.095, Math.PI / 2, 0, 0, 22, true); // 56mm objective
  b.cyl(0.0245, 0.0168, 0.055, WM.scopeInner, 0, 0.026, -0.095, Math.PI / 2, 0, 0, 22, true); // objective bore
  b.cyl(0.020, 0.016, 0.045, WM.dark, 0, 0.026, 0.090, Math.PI / 2, 0, 0, 22, true);  // ocular
  b.cyl(0.0188, 0.0148, 0.045, WM.scopeInner, 0, 0.026, 0.090, Math.PI / 2, 0, 0, 22, true); // ocular bore
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

function mag_ext(ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  if (ctx.cls === 'PISTOL') {
    b.box(0.024, 0.055, 0.034, WM.steel, 0, -0.038, 0);      // upper (in grip)
    b.box(0.023, 0.055, 0.033, WM.steel, 0, -0.092, 0);      // stick extension
    for (let i = 0; i < 3; i++) b.box(0.025, 0.004, 0.035, WM.dark, 0, -0.075 - i * 0.016, 0);
    b.box(0.027, 0.010, 0.037, WM.dark, 0, -0.124, 0);       // baseplate
    b.build(p);
    p.userData.variant = 'pistol';
    return p;
  }
  p.userData.variant = 'std';
  b.box(0.028, 0.070, 0.056, WM.steel, 0, -0.045, 0, 0.10);   // upper (in well)
  b.box(0.027, 0.070, 0.054, WM.steel, 0, -0.110, 0.010, 0.16); // extension
  for (let i = 0; i < 4; i++) b.box(0.029, 0.004, 0.050, WM.dark, 0, -0.060 - i * 0.024, 0.004 + i * 0.003, 0.13);
  b.box(0.031, 0.010, 0.058, WM.dark, 0, -0.148, 0.016, 0.16); // baseplate
  b.build(p);
  return p;
}

function mag_drum(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.028, 0.050, 0.056, WM.steel, 0, -0.025, 0, 0.08);   // feed neck
  b.box(0.030, 0.012, 0.058, WM.darkSteel, 0, -0.052, 0.002, 0.08); // neck collar
  b.cyl(0.055, 0.055, 0.034, WM.darkSteel, 0, -0.095, 0.005, 0, 0, Math.PI / 2, 24); // shell
  b.cyl(0.046, 0.046, 0.036, WM.dark, 0, -0.095, 0.005, 0, 0, Math.PI / 2, 24);      // face plate
  b.cyl(0.036, 0.036, 0.038, WM.darkSteel, 0, -0.095, 0.005, 0, 0, Math.PI / 2, 24); // inner step
  for (const sx of [-1, 1]) for (let i = 0; i < 12; i++) {                          // radial ribs
    const a = (i / 12) * Math.PI * 2;
    b.box(0.003, 0.017, 0.006, WM.poly, sx * 0.0195, -0.095 + Math.cos(a) * 0.046, 0.005 + Math.sin(a) * 0.046, a, 0, 0);
  }
  b.cyl(0.020, 0.020, 0.042, WM.poly, 0, -0.095, 0.005, 0, 0, Math.PI / 2, 16);      // hub
  b.cyl(0.008, 0.008, 0.044, WM.darkSteel, 0, -0.095, 0.005, 0, 0, Math.PI / 2, 12); // hub cap
  b.box(0.010, 0.030, 0.010, WM.dark, 0, -0.095, -0.030);     // winder
  b.box(0.022, 0.008, 0.008, WM.poly, 0, -0.082, -0.030);     // winder key
  b.build(p);
  return p;
}

function mag_coupled(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.026, 0.110, 0.054, WM.steel, -0.015, -0.065, 0, 0.10); // mag A
  b.box(0.026, 0.110, 0.054, WM.steel, 0.015, -0.065, 0, 0.10);  // mag B
  b.box(0.058, 0.016, 0.058, WM.dark, 0, -0.060, 0.004, 0.10);   // clamp
  b.box(0.058, 0.016, 0.058, WM.dark, 0, -0.110, 0.012, 0.10);   // clamp 2
  b.box(0.028, 0.008, 0.056, WM.dark, -0.015, -0.122, 0.011, 0.10);
  b.build(p);
  return p;
}

function shell_tube(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.010, 0.010, 0.100, WM.steel, 0, 0, -0.050, Math.PI / 2); // extension
  b.cyl(0.012, 0.012, 0.020, WM.darkSteel, 0, 0, -0.100, Math.PI / 2); // cap
  b.box(0.016, 0.016, 0.030, WM.darkSteel, 0, 0, -0.005);         // collar
  b.build(p);
  return p;
}

function belt_box_large(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.095, 0.110, 0.120, WM.poly, 0, -0.075, 0);             // soft pack
  b.box(0.097, 0.014, 0.122, WM.dark, 0, -0.018, 0);             // lid
  b.box(0.020, 0.026, 0.012, WM.darkSteel, 0, -0.035, -0.062);   // latch
  for (let i = 0; i < 3; i++) b.box(0.097, 0.006, 0.110, WM.dark, 0, -0.055 - i * 0.028, 0);
  b.box(0.030, 0.020, 0.004, WM.dark, -0.025, -0.075, -0.062);    // window
  b.build(p);
  return p;
}

function mag_box_sr(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.030, 0.060, 0.072, WM.steel, 0, -0.045, 0);            // 10-rd box
  b.box(0.032, 0.010, 0.074, WM.dark, 0, -0.078, 0);             // baseplate
  for (let i = 0; i < 3; i++) b.box(0.031, 0.004, 0.060, WM.dark, 0, -0.030 - i * 0.018, 0);
  b.build(p);
  return p;
}

/* ================= UNDERBARREL ================= */

function vgrip(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.024, 0.020, 0.034, WM.dark, 0, -0.008, 0);             // mount
  b.box(0.022, 0.062, 0.028, WM.poly, 0, -0.048, 0, 0.06);
  for (let i = 0; i < 3; i++) b.cyl(0.013, 0.013, 0.026, WM.grip, 0, -0.032 - i * 0.016, 0.001 + i * 0.001, Math.PI / 2, 0, 0);
  b.box(0.024, 0.008, 0.030, WM.grip, 0, -0.082, 0.004, 0.06);   // base cap
  b.build(p);
  return p;
}

function agrip(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.024, 0.016, 0.040, WM.dark, 0, -0.006, 0);             // mount
  b.box(0.024, 0.034, 0.055, WM.poly, 0, -0.028, 0.004, 0.5);    // angled wedge
  for (let i = 0; i < 3; i++) b.box(0.025, 0.004, 0.040, WM.grip, 0, -0.024 - i * 0.009, 0.010 - i * 0.005, 0.5);
  b.build(p);
  return p;
}

function bipod(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.024, 0.018, 0.044, WM.dark, 0, -0.009, 0);             // mount
  b.build(p);
  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.010, -0.018, 0);
    const lb = new GunBuilder();
    lb.cyl(0.005, 0.004, 0.110, WM.steel, 0, -0.055, 0);         // leg
    lb.box(0.012, 0.010, 0.012, WM.rubber, 0, -0.112, 0);        // foot
    lb.build(pivot);
    pivot.rotation.z = side * 1.25;                              // folded up along the handguard
    p.add(pivot);
    legs.push(pivot);
  }
  p.userData.legs = legs;
  return p;
}

function masterkey(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.026, 0.020, 0.060, WM.dark, 0, -0.010, 0.02);          // mount
  b.cyl(0.009, 0.009, 0.170, WM.steel, 0, -0.032, -0.055, Math.PI / 2); // barrel
  b.cyl(0.008, 0.008, 0.120, WM.darkSteel, 0, -0.048, -0.045, Math.PI / 2); // tube
  b.box(0.022, 0.022, 0.050, WM.poly, 0, -0.040, -0.030);        // pump
  b.box(0.006, 0.014, 0.006, WM.darkSteel, 0, -0.026, 0.035);    // trigger
  b.cyl(0.010, 0.010, 0.016, WM.dark, 0, -0.032, -0.140, Math.PI / 2); // muzzle ring
  b.build(p);
  return p;
}

/* ================= STOCK ================= */

function stock_none(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  p.userData.empty = true;
  return p;
}

function stock_heavy(ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.026, 0.034, 0.026, WM.dark, 0, 0, 0.013);              // adapter
  b.cyl(0.007, 0.007, 0.110, WM.steel, -0.011, 0.006, 0.080, Math.PI / 2); // tube L
  b.cyl(0.007, 0.007, 0.110, WM.steel, 0.011, 0.006, 0.080, Math.PI / 2);  // tube R
  b.box(0.030, 0.018, 0.070, WM.poly, 0, 0.024, 0.070);          // cheek riser
  b.box(0.038, 0.066, 0.016, WM.rubber, 0, -0.002, 0.140);       // buttpad
  b.box(0.030, 0.010, 0.090, WM.poly, 0, -0.026, 0.085);         // toe
  b.cyl(0.006, 0.006, 0.004, WM.dark, -0.016, 0.002, 0.110, 0, 0, Math.PI / 2); // QD
  b.build(p);
  if (ctx.cls === 'SMG' || ctx.cls === 'PDW') p.scale.setScalar(0.9);
  p.userData.variant = (ctx.cls === 'SMG' || ctx.cls === 'PDW') ? 'compact' : 'std';
  return p;
}

function stock_folding(ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.024, 0.030, 0.022, WM.dark, 0, 0, 0.011);              // hinge
  b.cyl(0.006, 0.006, 0.030, WM.steel, 0, 0, 0.011, Math.PI / 2, 0, 0); // pin
  b.cyl(0.006, 0.006, 0.110, WM.steel, 0, 0.002, 0.077, Math.PI / 2);   // thin tube
  b.box(0.030, 0.052, 0.012, WM.poly, 0, -0.002, 0.136);         // pad
  b.box(0.008, 0.012, 0.018, WM.dark, -0.013, 0, 0.011);         // latch
  b.build(p);
  if (ctx.cls === 'SMG' || ctx.cls === 'PDW') p.scale.setScalar(0.9);
  p.userData.variant = (ctx.cls === 'SMG' || ctx.cls === 'PDW') ? 'compact' : 'std';
  return p;
}

/* ================= RAIL ================= */

function laser_box(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.020, 0.022, 0.055, WM.dark, 0, 0, 0);                  // housing
  b.box(0.022, 0.010, 0.040, WM.poly, 0, -0.014, 0);             // clamp
  b.cyl(0.006, 0.006, 0.006, WM.darkSteel, 0, 0.002, -0.029, Math.PI / 2); // emitter bezel
  b.build(p);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 10), new THREE.MeshBasicMaterial({ color: 0xFF2A2A }));
  lens.position.set(0, 0.002, -0.0325);
  lens.rotation.y = Math.PI;
  p.add(lens);
  p.userData.lensMesh = lens;
  return p;
}

function light_box(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.011, 0.011, 0.055, WM.dark, 0, 0, 0, Math.PI / 2, 0, 0, 14); // body
  b.cyl(0.014, 0.012, 0.020, WM.darkSteel, 0, 0, -0.036, Math.PI / 2, 0, 0, 14); // bezel
  b.box(0.020, 0.010, 0.030, WM.poly, 0, -0.014, 0.008);         // clamp
  b.cyl(0.008, 0.008, 0.008, WM.rubber, 0, 0, 0.030, Math.PI / 2); // tailcap
  b.build(p);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.009, 14), new THREE.MeshBasicMaterial({ color: 0xFFF4D6 }));
  lens.position.set(0, 0, -0.0465);
  lens.rotation.y = Math.PI;
  p.add(lens);
  p.userData.lensMesh = lens;
  return p;
}

function canted_irons(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.box(0.016, 0.014, 0.030, WM.dark, 0, 0.004, 0.030, 0, 0, -0.785);  // rear mount @45°
  b.box(0.004, 0.020, 0.004, WM.darkSteel, -0.006, 0.016, 0.030, 0, 0, -0.785); // rear post
  b.box(0.008, 0.010, 0.004, WM.dark, -0.009, 0.026, 0.030, 0, 0, -0.785);      // ghost ring
  b.box(0.016, 0.014, 0.024, WM.dark, 0, 0.004, -0.060, 0, 0, -0.785); // front mount
  b.box(0.003, 0.018, 0.003, WM.tritium, -0.006, 0.015, -0.060, 0, 0, -0.785);  // fibre post
  b.build(p);
  return p;
}

/* ================= BARREL ================= */

function barrelSpan(model: WeaponModel): { span: number; ext: number } {
  const bz = model.sockets.barrel?.position.z ?? -0.40;
  const mz = model.sockets.muzzle?.position.z ?? -0.60;
  return { span: Math.max(0.03, bz - mz), ext: 0 };
}

function barrel_long({ model, cls }: AttachContext): THREE.Object3D {
  const ext = BARREL_LONG_EXT[cls];
  const { span } = barrelSpan(model);
  const len = span + ext;
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.0085, 0.0085, len, WM.steel, 0, 0, -len / 2, Math.PI / 2);
  if (cls === 'PISTOL') {
    b.cyl(0.011, 0.011, 0.014, WM.darkSteel, 0, 0, -0.007, Math.PI / 2); // slide collar
    b.cyl(0.0085, 0.0085, 0.016, WM.darkSteel, 0, 0, -len + 0.008, Math.PI / 2); // thread protector
    b.build(p);
    p.userData.muzzleShift = -ext;
    p.userData.variant = 'pistol';
    return p;
  }
  p.userData.variant = 'std';
  b.cyl(0.014, 0.014, Math.min(0.12, span), WM.poly, 0, 0, -Math.min(0.06, span / 2), Math.PI / 2, 0, 0, 10); // shroud
  b.box(0.018, 0.020, 0.022, WM.darkSteel, 0, 0.006, -span * 0.35); // gas block
  b.cyl(0.004, 0.004, span * 0.5, WM.steel, 0, 0.014, -span * 0.25, Math.PI / 2); // gas tube
  b.box(0.005, 0.026, 0.005, WM.dark, 0, 0.036, -len + 0.02);     // front post
  b.cyl(0.010, 0.010, 0.020, WM.darkSteel, 0, 0, -len + 0.008, Math.PI / 2); // muzzle collar
  b.build(p);
  p.userData.muzzleShift = -ext;
  return p;
}

function barrel_short({ model, cls }: AttachContext): THREE.Object3D {
  const red = Math.min(BARREL_SHORT_RED[cls], barrelSpan(model).span - 0.015);
  const { span } = barrelSpan(model);
  const len = Math.max(0.015, span - red);
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.0095, 0.0095, len, WM.steel, 0, 0, -len / 2, Math.PI / 2);
  if (cls === 'PISTOL') {
    b.cyl(0.0105, 0.0105, 0.020, WM.darkSteel, 0, 0, -len + 0.009, Math.PI / 2); // flush collar
    b.build(p);
    p.userData.muzzleShift = red;
    p.userData.variant = 'pistol';
    return p;
  }
  p.userData.variant = 'std';
  b.box(0.018, 0.020, 0.022, WM.darkSteel, 0, 0.006, -len * 0.3); // gas block
  b.cyl(0.012, 0.012, 0.022, WM.dark, 0, 0, -len + 0.008, Math.PI / 2); // stub hider
  for (let i = 0; i < 3; i++) b.box(0.004, 0.004, 0.016, WM.poly, 0.011, 0, -len + 0.008);
  b.build(p);
  p.userData.muzzleShift = red;
  return p;
}

function ported_slide(_ctx: AttachContext): THREE.Object3D {
  const p = group();
  const b = new GunBuilder();
  b.cyl(0.008, 0.008, 0.030, WM.steel, 0, 0, -0.030, Math.PI / 2); // extended barrel
  b.cyl(0.010, 0.010, 0.012, WM.darkSteel, 0, 0, -0.045, Math.PI / 2); // collar
  for (let i = 0; i < 3; i++) b.box(0.006, 0.004, 0.010, WM.poly, 0, 0.010, -0.016 - i * 0.013); // top ports
  b.build(p);
  p.userData.muzzleShift = 0;
  return p;
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
};

/** Barrel seats before muzzle so cans land on the new bore end. */
export const ATTACH_ORDER: AttachSlot[] = ['barrel', 'muzzle', 'optic', 'magazine', 'underbarrel', 'stock', 'rail'];

const originalMag = new WeakMap<WeaponModel, THREE.Object3D>();

function disposePart(part: THREE.Object3D): void {
  part.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
    // Shared WM materials are never disposed; wholly-owned lens materials are tiny
    // and intentionally left alive (fewer branches than ownership tracking).
  });
}

/** Mount a part: idempotent per slot, hides stock meshes, rewires muzzle/mag. */
export function attach(model: WeaponModel, entry: AttachmentCatalogEntry, weapon: WeaponId): void {
  const slot = entry.slot;
  detach(model, slot);
  const socket = model.sockets[slot];
  const builder = ATTACHMENT_BUILDERS[entry.visual];
  if (!socket || !builder) return;
  const cls = weaponById(weapon)?.cls ?? 'AR';
  const part = builder({ weapon, model, cls });
  part.position.copy(socket.position);
  model.group.add(part);
  model.attached[slot] = part;
  for (const o of model.removable[slot] ?? []) o.visible = false;
  if (slot === 'optic') {
    const lensH = (part.userData.lensH as number | undefined) ?? 0.022;
    part.userData.sightYOffset = socket.position.y + lensH - model.sightY;
    part.traverse(o => { if (o.userData.adsHide) model.adsHidden.push(o); });
  }
  if (slot === 'magazine') {
    if (!originalMag.has(model)) originalMag.set(model, model.mag);
    part.userData.homeY = socket.position.y;
    part.userData.homeZ = socket.position.z;
    model.mag = part;
  }
  if (slot === 'muzzle') {
    const len = (part.userData.length as number | undefined) ?? 0.05;
    if (model.muzzle.userData.homeZ === undefined) model.muzzle.userData.homeZ = model.muzzle.position.z;
    model.muzzle.position.z = socket.position.z - len;
  }
  if (slot === 'barrel') {
    const shift = (part.userData.muzzleShift as number | undefined) ?? 0;
    const mz = model.sockets.muzzle;
    if (mz) {
      if (mz.userData.homeZ === undefined) mz.userData.homeZ = mz.position.z;
      if (model.muzzle.userData.homeZ === undefined) model.muzzle.userData.homeZ = model.muzzle.position.z;
      mz.position.z += shift;
      model.muzzle.position.z = mz.position.z - 0.005;
      const seated = model.attached.muzzle;
      if (seated) {
        seated.position.copy(mz.position);
        model.muzzle.position.z = mz.position.z - ((seated.userData.length as number | undefined) ?? 0.05);
      }
    }
  }
}

/** Unmount a slot's part and restore stock meshes, mag and muzzle references. */
export function detach(model: WeaponModel, slot: AttachSlot): void {
  const part = model.attached[slot];
  if (part) {
    part.traverse(o => {
      if (o.userData.adsHide) {
        const i = model.adsHidden.indexOf(o);
        if (i >= 0) model.adsHidden.splice(i, 1);
      }
    });
    model.group.remove(part);
    disposePart(part);
    delete model.attached[slot];
  }
  for (const o of model.removable[slot] ?? []) o.visible = true;
  if (slot === 'magazine') {
    const orig = originalMag.get(model);
    if (orig) model.mag = orig;
  }
  if (slot === 'muzzle' && model.muzzle.userData.homeZ !== undefined) {
    model.muzzle.position.z = model.muzzle.userData.homeZ as number;
  }
  if (slot === 'barrel') {
    const mz = model.sockets.muzzle;
    if (mz && mz.userData.homeZ !== undefined) {
      mz.position.z = mz.userData.homeZ as number;
      const seated = model.attached.muzzle;
      if (seated) {
        seated.position.copy(mz.position);
        model.muzzle.position.z = mz.position.z - ((seated.userData.length as number | undefined) ?? 0.05);
      } else if (model.muzzle.userData.homeZ !== undefined) {
        model.muzzle.position.z = model.muzzle.userData.homeZ as number;
      }
    }
  }
}

/** Detach everything, then mount the full build (barrel before muzzle, always). */
export function applyBuild(model: WeaponModel, build: WeaponBuild): void {
  const slots = new Set<AttachSlot>([
    ...(Object.keys(model.attached) as AttachSlot[]),
    ...(Object.keys(build.attachments) as AttachSlot[]),
  ]);
  for (const s of slots) detach(model, s);
  for (const s of ATTACH_ORDER) {
    const id = build.attachments[s];
    if (!id) continue;
    const entry = attachmentById(id);
    if (entry && entry.slot === s) attach(model, entry, build.weapon);
  }
}
