import * as THREE from 'three';
import { GunBuilder, type Point3, type Profile } from './geometry';
import { WM, attachArms, makeSocket, type ArmAnchors, type WeaponModel } from './core';
import type { AttachSlot } from '../economy/catalog';

export const HALF_PI = Math.PI / 2;
export interface AssemblyPart { group: THREE.Group; b: GunBuilder }

/** Explicit moving/removable assemblies prevent hidden stock parts reappearing through upgrades. */
export class WeaponAssembly {
  group = new THREE.Group();
  body = new GunBuilder();
  removable: WeaponModel['removable'] = {};
  adsHidden: THREE.Object3D[] = [];
  private parts: AssemblyPart[] = [];
  constructor(name: string) { this.group.name = name; }

  moving(name: string): AssemblyPart {
    const group = new THREE.Group(); group.name = name;
    this.group.add(group);
    const part = { group, b: new GunBuilder() };
    this.parts.push(part);
    return part;
  }

  part(slot: AttachSlot, name: string): AssemblyPart {
    const part = this.moving(name);
    (this.removable[slot] ??= []).push(part.group);
    return part;
  }

  finish(options: {
    mag: THREE.Object3D; handle?: THREE.Object3D; optic?: THREE.Object3D;
    sightY: number; sockets: Partial<Record<AttachSlot, Point3>>;
    muzzleTip: Point3; arms: ArmAnchors; pistol?: boolean;
  }): WeaponModel {
    const ids: Record<string, string> = { M416:'m4a1','AK-47':'ak47','M1911 A1':'m1911',AWM:'awm',MP7:'mp7','SCAR-H':'scar_h','KRISS Vector':'vector','SPAS-12':'spas12','Desert Eagle':'deagle','M249 SAW':'m249' };
    this.group.userData.weaponId = ids[this.group.name];
    this.body.build(this.group);
    for (const { b, group } of this.parts) b.build(group);
    const { lArm, keys } = attachArms(this.group, options.arms);
    const sockets: WeaponModel['sockets'] = {};
    for (const [slot, pos] of Object.entries(options.sockets)) {
      const socket = makeSocket(...pos);
      socket.name = `${slot} mount`;
      if (slot === 'rail') socket.rotation.z = options.pistol ? Math.PI : HALF_PI;
      this.group.add(socket);
      sockets[slot as AttachSlot] = socket;
    }
    const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle flash anchor';
    muzzle.position.set(...options.muzzleTip); this.group.add(muzzle);
    const handle = options.handle ?? new THREE.Group();
    if (!handle.parent) this.group.add(handle);
    handle.userData.homeZ = handle.position.z;
    handle.userData.homeY = handle.position.y;
    const optic = options.optic ?? new THREE.Group();
    if (!optic.parent) this.group.add(optic);
    options.mag.userData.homeY = options.mag.position.y;
    options.mag.userData.homeZ = options.mag.position.z;
    // Slide-mounted optics follow the slide, not a stationary point in mid-air.
    if (options.pistol && sockets.optic) handle.add(sockets.optic);
    return {
      group: this.group, mag: options.mag, chargingHandle: handle, muzzle,
      optic, sightY: options.sightY, lArm, lArmKeys: keys,
      adsHidden: this.adsHidden, sockets, removable: this.removable, attached: {},
    };
  }
}

/** Countersunk hardware sits slightly inside the surface, with an actual hex socket. */
export function screw(b: GunBuilder, x: number, y: number, z: number, radius = 0.0027) {
  const side = Math.sign(x) || 1;
  b.name('seated fastener rim').tube(radius, radius * 0.40, 0.0018, WM.steel, x, y, z, 0, 0, HALF_PI, 16);
  b.name('recessed hex socket').cyl(radius * 0.47, radius * 0.47, 0.00025, WM.dark, x + side * 0.0002, y, z, 0, 0, HALF_PI, 6);
}

/** Continuous rail spine supports every tooth. y is the surface it bolts onto. */
export function rail(b: GunBuilder, rear: number, front: number, y: number, width = 0.032, mat: THREE.Material = WM.dark) {
  const length = rear - front;
  b.name('rail spine').box(width * 0.8, 0.004, length, mat, 0, y + 0.0015, (rear + front) / 2);
  const count = Math.max(2, Math.floor(length / 0.0115));
  const pitch = (length - 0.006) / (count - 1);
  for (let i = 0; i < count; i++) b.name('rail tooth').section([[-width*.30,-.002],[width*.30,-.002],[width*.50,0],[width*.50,.0015],[width*.37,.0025],[-width*.37,.0025],[-width*.50,.0015],[-width*.50,0]],.0055,mat,0,y+.005,rear-.003-i*pitch);
}

export function sideRail(b: GunBuilder, x: number, y: number, z: number, length: number) {
  const side = Math.sign(x);
  b.name('side rail mount').box(0.004, 0.018, length, WM.darkSteel, x, y, z);
  const count = Math.max(2, Math.floor(length / 0.0125));
  for (let i = 0; i < count; i++) b.name('side rail tooth').box(0.004, 0.024, 0.006, WM.dark, x + side * 0.002, y, z - length / 2 + 0.006 + i * 0.0125);
  screw(b, x + side * 0.003, y, z - length * 0.32, 0.0022);
  screw(b, x + side * 0.003, y, z + length * 0.32, 0.0022);
}

export function pistolGrip(b: GunBuilder, z: number, top: number, length = 0.088, width = 0.030, mat: THREE.Material = WM.grip, rake = 0.023) {
  const down = -top;
  b.name('contoured grip core').loft([
    [down-.005,z+.015,z-.016,width*.78],
    [down+.008,z+.018,z-.020,width*.94],
    [down+.027,z+rake*.30+.015,z+rake*.12-.021,width*1.08],
    [down+length*.73,z+rake*.76+.018,z+rake*.68-.017,width],
    [down+length-.006,z+rake+.017,z+rake-.016,width*1.02],
    [down+length,z+rake+.013,z+rake-.013,width*.85],
  ],mat,.54,0,'y');
  // Rolled heel and an arched backstrap follow the actual grip volume.
  b.name('grip heel').loft([[down+length-.006,z+rake+.017,z+rake-.016,width*1.02],[down+length+.001,z+rake+.012,z+rake-.012,width*.88]],mat,.54,0,'y');
  for(const side of [-1,1]) screw(b,side*(width*.49),top-.027,z+rake*.22+.001,.0021);
}

/** Real open trigger guard, rooted at both ends in the lower frame. */
export function triggerGuard(b: GunBuilder, rear: number, front: number, top: number, bottom: number, mat: THREE.Material = WM.darkSteel, round = false) {
  let outer: Profile = [[rear, top], [front, top], [front - 0.003, bottom + 0.009], [front + 0.004, bottom], [rear - 0.004, bottom], [rear + 0.002, bottom + 0.009]];
  let inner: Profile = [[rear - 0.005, top - 0.004], [front + 0.004, top - 0.004], [front + 0.003, bottom + 0.009], [front + 0.007, bottom + 0.004], [rear - 0.007, bottom + 0.004]];
  if (round) {
    const cy = (top + bottom) / 2, rz = 0.016, ry = (top - bottom) / 2;
    const arc = (inset: number): [number, number][] => Array.from({ length: 17 }, (_, i) => {
      const t = i / 16 * Math.PI;
      return [front + rz - Math.sin(t) * (rz - inset), cy + Math.cos(t) * (ry - inset)];
    });
    outer = [[rear, top], ...arc(0), [rear - 0.002, bottom], [rear + 0.001, bottom + 0.006]];
    inner = [[rear - 0.005, top - 0.004], ...arc(0.004), [rear - 0.007, bottom + 0.004]];
  }
  b.name('continuous trigger guard').profile(outer, 0.009, mat, 0, round ? 0.00085 : 0.00065, [inner]);
  const z = rear - (rear - front) * 0.42;
  b.name('curved trigger').profile([[z, top + 0.003], [z - 0.006, top + 0.003], [z - 0.005, bottom + 0.015], [z - 0.010, bottom + 0.010], [z - 0.006, bottom + 0.008], [z + 0.001, bottom + 0.013]], 0.0045, WM.steel, 0, 0.0003);
}

interface MagShape { width: number; depth: number; length: number; bend?: number; rake?: number; material?: THREE.Material; ribs?: number; ribMaterial?: THREE.Material }
/** A single curved shell; flutes follow its curve, not thirteen overlapping blocks. */
export function magazine(b: GunBuilder, { width, depth, length, bend = 0, rake = 0, material = WM.darkSteel, ribs = 3, ribMaterial: _ribMaterial = WM.midSteel }: MagShape) {
  const point = (t: number, offset: number): [number, number] => {
    const angle = Math.atan2(2 * bend * t - rake, length);
    return [-bend * t * t + rake * t + offset * Math.cos(angle), 0.008 - length * t - offset * Math.sin(angle)];
  };
  const band = (lo: number, hi: number, start = 0, end = 1, segments = 12): [number, number][] => {
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) points.push(point(start + (end - start) * i / segments, lo));
    for (let i = segments; i >= 0; i--) points.push(point(start + (end - start) * i / segments, hi));
    return points;
  };
  const cuts: import('./geometry').MillCut[] = [];
  for(const side of [-1,1]) for(let i=0;i<ribs;i++) {
    const offset=(i-(ribs-1)/2)*depth/(ribs+1);
    cuts.push({x:side*(width/2+.0004),y:0,z:0,w:.0028,h:0,d:0,radius:.0013,path:band(offset-depth*.036,offset+depth*.036,.19,.94,18)});
  }
  b.name('continuous magazine shell').profile(band(-depth/2,depth/2),width,material,0,.0010).mill(cuts);
  // Pressed lip and a folded heel catch the light around the recessed channels.
  b.name('magazine upper fold').profile(band(-depth/2-.0006,depth/2+.0006,.02,.07,1),width+.001,material,0,.0003);
  b.name('magazine floorplate').profile(band(-depth / 2 - 0.0015, depth / 2 + 0.0015, 0.96, 1.015, 1), width + 0.003, WM.dark, 0, 0.0005);
}

/** Sight bases are seated on surfaces, not positioned by a free-floating sight height. */
export function ironSights(a: WeaponAssembly, rearZ: number, frontZ: number, rearBase: number, frontBase: number, sightY: number, barrelDependent = false) {
  const rear = a.part('optic', 'rear iron sight');
  const front = a.part('optic', 'front iron sight');
  if (barrelDependent) (a.removable.barrel ??= []).push(front.group);
  const r = rear.b, f = front.b;
  r.name('rear sight shoe').box(0.026, 0.006, 0.022, WM.dark, 0, rearBase + 0.002, rearZ);
  r.name('aperture pedestal').box(0.016, sightY - rearBase - 0.007, 0.008, WM.darkSteel, 0, (rearBase + sightY - 0.007) / 2, rearZ);
  r.name('open rear aperture').tube(0.007, 0.003, 0.006, WM.darkSteel, 0, sightY, rearZ);
  screw(r, -0.013, rearBase + 0.004, rearZ, 0.0025);
  f.name('front sight shoe').box(0.025, 0.006, 0.020, WM.darkSteel, 0, frontBase + 0.002, frontZ);
  const foot = frontBase + 0.004;
  if (a.group.name === 'M416') {
    f.name('AR triangular sight tower').profile([[frontZ-.014,frontBase-.009],[frontZ+.014,frontBase-.009],[frontZ+.005,sightY-.011],[frontZ-.002,sightY-.011]],.011,WM.darkSteel,0,.0007,
      [[[frontZ-.009,frontBase-.003],[frontZ+.008,frontBase-.003],[frontZ+.002,sightY-.019]]]);
    f.name('AR sight transverse pin').cyl(.0024,.0024,.027,WM.midSteel,0,frontBase+.002,frontZ,0,0,HALF_PI);
  } else {
    f.name('front sight pedestal').profile([[frontZ-.008,foot],[frontZ+.008,foot],[frontZ+.005,sightY-.014],[frontZ-.005,sightY-.014]],.013,WM.darkSteel);
  }
  f.name('front blade').box(0.003, 0.016, 0.004, WM.dark, 0, sightY - 0.008, frontZ);
  for (const side of [-1, 1]) {
    f.name('protective sight ear').profile([[frontZ - 0.007, foot], [frontZ + 0.007, foot], [frontZ + 0.005, sightY + 0.002], [frontZ - 0.005, sightY + 0.002]], 0.003, WM.dark, side * 0.010, 0.0003);
  }
  return { rear: rear.group, front: front.group };
}

/** Native muzzle assembly can be hidden by either a barrel or muzzle replacement. */
export function flashHider(a: WeaponAssembly, shoulder: number, y: number, length = 0.038, radius = 0.0105, barrelDependent = true) {
  const part = a.part('muzzle', 'factory flash hider');
  if (barrelDependent) (a.removable.barrel ??= []).push(part.group);
  const b = part.b;
  b.name('muzzle collar').tube(radius + 0.001, radius * 0.43, 0.010, WM.darkSteel, 0, y, shoulder - 0.003);
  b.name('hollow muzzle body').tube(radius, radius * 0.43, length - 0.002, WM.darkSteel, 0, y, shoulder - length / 2);
  // Shallow, seated dark slots on the outside, never boxes cutting through the bore.
  for (let i = 0; i < 5; i++) {
    const theta = i / 5 * Math.PI * 2;
    b.name('flash hider flute').box(0.0035, 0.0012, length * 0.56, WM.dark,
      Math.sin(theta) * (radius - 0.00035), y + Math.cos(theta) * (radius - 0.00035), shoulder - length * 0.57, 0, 0, -theta);
  }
  return part.group;
}

export function verticalGrip(b: GunBuilder, z: number, y: number, length = 0.062) {
  b.name('foregrip clamp').box(0.025, 0.012, 0.034, WM.darkSteel, 0, y - 0.004, z);
  b.name('foregrip shell').profile([[z - 0.013, y - 0.008], [z + 0.013, y - 0.008], [z + 0.018, y - length + 0.005], [z + 0.012, y - length], [z - 0.010, y - length]], 0.022, WM.grip, 0, 0.0034);
  for (const side of [-1, 1]) screw(b, side * 0.013, y - 0.004, z, 0.003);
  for (let i = 0; i < 4; i++) b.name('foregrip checkering').box(0.0225, 0.002, 0.022, WM.poly, 0, y - 0.021 - i * 0.008, z + 0.002 + i * 0.0005);
}

/** Telescopic legs have shared endpoints and a transverse pivot through the mount. */
export function bipod(b: GunBuilder, z: number, y: number, length = 0.12) {
  b.name('bipod saddle').box(0.027, 0.018, 0.028, WM.darkSteel, 0, y - 0.005, z);
  b.name('bipod axle').cyl(0.006, 0.006, 0.044, WM.steel, 0, y - 0.012, z, 0, 0, HALF_PI, 16);
  for (const side of [-1, 1]) {
    const top: Point3 = [side * 0.018, y - 0.012, z];
    const mid: Point3 = [side * 0.031, y - length * 0.62, z - 0.008];
    const end: Point3 = [side * 0.041, y - length, z - 0.013];
    b.name('bipod upper leg').rod(top, mid, 0.005, WM.dark);
    b.name('bipod telescopic leg').rod(mid, end, 0.0035, WM.steel);
    b.name('bipod hinge cap').cyl(0.007, 0.007, 0.006, WM.darkSteel, ...top, 0, 0, HALF_PI, 16);
    b.name('bipod foot').box(0.016, 0.008, 0.022, WM.rubber, ...end);
  }
}

/** Telescope with annular rings, supported saddles and genuinely open optical axis. */
export function telescopicSight(b: GunBuilder, parent: THREE.Group, baseY: number, axisY: number, z: number, adsHidden: THREE.Object3D[]) {
  b.name('scope dovetail base').box(0.032, 0.008, 0.172, WM.dark, 0, baseY + 0.003, z);
  for (const offset of [-0.061, 0.054]) {
    b.name('scope ring pedestal').box(0.024, axisY - baseY - 0.013, 0.019, WM.darkSteel, 0, (axisY - 0.013 + baseY) / 2, z + offset);
    b.name('annular scope ring').tube(0.019, 0.0158, 0.018, WM.darkSteel, 0, axisY, z + offset);
    for (const side of [-1, 1]) {
      b.name('scope ring clamp').box(0.006, 0.006, 0.018, WM.darkSteel, side * 0.018, axisY, z + offset);
      screw(b, side * 0.021, axisY, z + offset, 0.0022);
    }
  }
  b.name('scope tube').tube(0.016, 0.0145, 0.180, WM.dark, 0, axisY, z);
  b.name('objective bell').turned([[0.0158, -0.080], [0.0245, -0.116], [0.0245, -0.152], [0.0227, -0.152], [0.0227, -0.117], [0.0145, -0.080], [0.0158, -0.080]], WM.dark, 0, axisY, z);
  b.name('ocular bell').turned([[0.016, 0.075], [0.020, 0.090], [0.020, 0.137], [0.0179, 0.137], [0.0179, 0.092], [0.0145, 0.075], [0.016, 0.075]], WM.dark, 0, axisY, z);
  b.name('turret saddle').tube(0.018, 0.0145, 0.030, WM.dark, 0, axisY, z - 0.007);
  b.name('elevation turret').cyl(0.011, 0.011, 0.019, WM.darkSteel, 0, axisY + 0.021, z - 0.007, 0, 0, 0, 24);
  b.name('windage turret').cyl(0.010, 0.010, 0.018, WM.darkSteel, 0.022, axisY, z - 0.007, 0, 0, HALF_PI, 24);
  for (let i = 0; i < 10; i++) {
    const t = i / 10 * Math.PI * 2;
    b.name('turret knurl').box(0.002, 0.011, 0.002, WM.poly, Math.sin(t) * 0.0105, axisY + 0.024, z - 0.007 + Math.cos(t) * 0.0105);
  }
  for (let i = 0; i < 6; i++) b.name('focus ring knurl').tube(0.0206, 0.0192, 0.002, WM.darkSteel, 0, axisY, z + 0.091 + i * 0.006);
  for (const [offset, radius] of [[-0.150, 0.0228], [0.134, 0.0180]]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), WM.glass);
    lens.name = 'seated optical glass'; lens.position.set(0, axisY, z + offset);
    parent.add(lens);
  }
  const crosshair = new THREE.Group(); crosshair.name = 'etched optical reticle';
  for (const [w, h] of [[0.029, 0.00035], [0.00035, 0.029]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), WM.marking);
    line.position.set(0, axisY, z + 0.132); crosshair.add(line);
  }
  parent.add(crosshair); adsHidden.push(crosshair);
}

const MARKS = ['M416  /  5.56 x 45', 'AK-47  /  7.62', 'SCAR-H  /  7.62 x 51', 'AWM  /  .338', 'MP7  /  4.6 x 30', 'KRISS VECTOR  /  .45', 'SPAS 12  /  12 GA', 'M249  /  5.56', 'M1911 A1  /  .45 AUTO', 'DESERT EAGLE  /  .50 AE', 'SAFE     SEMI     AUTO', 'SERIAL  026-4917', '200 RDS  5.56 x 45', 'LINKED  /  LOT 249-06', 'M416   5.56 mm   /   047126', 'SCAR H   7.62 x 51   /   090781'];
let markingMat: THREE.MeshStandardMaterial | undefined;
/** One tiny shared engraving atlas. Node geometry tests do not require a DOM. */
function markings(): THREE.MeshStandardMaterial {
  if (markingMat) return markingMat;
  let texture: THREE.Texture;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c3c8c6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    MARKS.forEach((text, i) => {
      ctx.font = i === 11 ? '22px monospace' : '600 27px monospace';
      ctx.fillText(text, 512, i * 40 + 20);
    });
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.DataTexture(new Uint8Array([195, 200, 198, 255]), 1, 1); texture.needsUpdate = true;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  markingMat = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.1, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  markingMat.name = 'receiver engravings';
  return markingMat;
}

export function stamp(b: GunBuilder, row: number, x: number, y: number, z: number, width = 0.082, height = 0.007) {
  const geo = new THREE.PlaneGeometry(width, height);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row * 40 + (1 - uv.getY(i)) * 40) / 1024);
  b.name('surface engraving').surface(geo, markings(), x, y, z, 0, x < 0 ? -HALF_PI : HALF_PI);
}
