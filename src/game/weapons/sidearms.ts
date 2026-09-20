import * as THREE from 'three';
import { WM, type WeaponModel } from './core';
import { HALF_PI, WeaponAssembly, magazine, screw, stamp, triggerGuard } from './furniture';

function slideCuts(halfWidth: number, top: number, z: number, count: number, step = .0034): import('./geometry').MillCut[] {
  return [-1,1].flatMap(side=>Array.from({length:count},(_,i)=>({x:side*(halfWidth+.0003),y:top-.009,z:z+i*step,w:.0028,h:.020,d:.0015,radius:.0003,rx:.10})));
}

function sights(a: WeaponAssembly, slide: THREE.Group, frontParent: THREE.Group, rearZ: number, frontZ: number, baseY: number, sightY: number, rearBase = baseY) {
  const rear = a.part('optic', 'slide-mounted rear sight'); slide.add(rear.group);
  rear.b.name('rear dovetail').box(0.023, 0.004, 0.009, WM.darkSteel, 0, rearBase + 0.001, rearZ);
  for (const side of [-1, 1]) {
    rear.b.name('rear notch wing').box(0.007, sightY - rearBase, 0.007, WM.dark, side * 0.007, (sightY + rearBase) / 2, rearZ);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 10), WM.tritium);
    dot.name = 'inlaid rear sight dot'; dot.position.set(side * 0.007, sightY - 0.003, rearZ + 0.0036);
    rear.group.add(dot); a.adsHidden.push(dot);
  }
  const front = a.part('optic', 'front sight blade'); frontParent.add(front.group);
  front.b.name('front dovetail').box(0.011, 0.003, 0.012, WM.darkSteel, 0, baseY + 0.001, frontZ);
  front.b.name('front blade').box(0.0038, sightY - baseY, 0.006, WM.dark, 0, (baseY + sightY) / 2, frontZ);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.001, 12), WM.tritium);
  dot.name = 'inlaid front sight dot'; dot.position.set(0, sightY - 0.0025, frontZ + 0.0031);
  front.group.add(dot); a.adsHidden.push(dot);
}

/** Slim single-stack frame, rounded slide, checkered walnut panels, open trigger bow. */
export function buildM1911(): WeaponModel {
  const a = new WeaponAssembly('M1911 A1'), b = a.body;
  const slide = a.moving('reciprocating 1911 slide');
  const barrel = a.part('barrel', '1911 barrel');
  const mag = a.part('magazine', 'single-stack magazine');
  const s = slide.b;
  const slideSection: [number, number][] = [[-0.014, -0.016], [0.014, -0.016]];
  for (let i = 0; i <= 24; i++) {
    const theta = i / 24 * Math.PI;
    slideSection.push([0.014 * Math.cos(theta), 0.004 + 0.012 * Math.sin(theta)]);
  }
  s.name('rounded 1911 slide').section(slideSection, 0.204, WM.darkSteel, 0, 0.026, -0.051, { y: 0, radius: 0.0073 }).mill(slideCuts(.014,.030,.008,12));
  // The muzzle is open, but the breech is not a second barrel opening at the back of the slide.
  s.name('closed 1911 breech face').section(slideSection, 0.005, WM.darkSteel, 0, 0.026, 0.0485);
  s.name('firing pin stop plate').box(0.014, 0.023, 0.0013, WM.midSteel, 0, 0.024, 0.0513);
  s.name('recessed firing pin').cyl(0.0016, 0.0016, 0.00065, WM.dark, 0, 0.029, 0.052, HALF_PI, 0, 0, 20);
  s.name('bushing').tube(0.010, 0.0071, 0.004, WM.midSteel, 0, 0.026, -0.152);
  s.name('recoil spring plug').cyl(0.0045, 0.0045, 0.006, WM.darkSteel, 0, 0.014, -0.151, HALF_PI, 0, 0, 20);
  s.name('ejection port rim').box(0.0013, 0.011, 0.038, WM.dark, 0.0141, 0.028, -0.048);
  s.name('chamber hood').box(0.0012, 0.0075, 0.029, WM.chrome, 0.0145, 0.028, -0.051);
  s.name('extractor').box(0.0015, 0.004, 0.025, WM.darkSteel, 0.0143, 0.024, -0.015);
  stamp(s, 8, -0.0142, 0.026, -0.056, 0.108, 0.007);
  stamp(s, 11, 0.0142, 0.018, -0.092, 0.045, 0.0035);

  b.name('1911 frame and grip tang').profile([[-0.132, 0.011], [0.040, 0.011], [0.051, -0.008], [0.039, -0.021], [0.056, -0.088], [0.047, -0.097], [0.009, -0.097], [-0.013, -0.028], [-0.064, -0.013], [-0.132, -0.011]], 0.025, WM.darkSteel, 0, 0.0019);
  b.name('rounded recoil spring dust cover').cyl(.009,.009,.089,WM.darkSteel,0,.001,-.097,HALF_PI,0,0,36);
  b.name('slide/frame seam').box(0.026, 0.002, 0.166, WM.dark, 0, 0.009, -0.047);
  triggerGuard(b, -0.006, -0.065, -0.012, -0.047, WM.darkSteel, true);
  for (const side of [-1, 1]) {
    b.name('sculpted checkered walnut grip').loft([[.020,.033,.002,.003],[.028,.037,-.001,.006],[.057,.045,.007,.007],[.079,.049,.014,.006],[.090,.040,.020,.003]], WM.woodDark, 0.54, side * 0.0132, 'y');
    for (const [z, y] of [[0.016, -0.027], [0.032, -0.079]]) {
      b.name('smooth diamond screw escutcheon').profile([[z, y + 0.006], [z + 0.0042, y], [z, y - 0.006], [z - 0.0042, y]], 0.0011, WM.wood, side * 0.0161, 0.00015);
      b.name('slotted walnut grip screw').cyl(.0034,.0034,.0013,WM.steel,side*.0169,y,z,0,0,HALF_PI,24).mill([{x:side*.0175,y,z,w:.0012,h:.0011,d:.0053,rx:.7,radius:.0001}]);
    }
    b.name('frame reinforcement above grip').profile([[0.002, -0.016], [0.030, -0.019], [0.040, -0.010], [0.035, 0.006], [0.001, 0.005], [-0.011, -0.004]], 0.0018, WM.darkSteel, side * 0.0121, 0.0003);
    b.name('frame rail ledge').box(0.0015, 0.0022, 0.147, WM.midSteel, side * 0.0124, 0.007, -0.045);
    b.name('hammer axis pin').cyl(0.0018, 0.0018, 0.0011, WM.midSteel, side * 0.013, -0.006, 0.032, 0, 0, HALF_PI, 18);
    b.name('sear axis pin').cyl(0.00135, 0.00135, 0.0011, WM.midSteel, side * 0.013, -0.007, 0.020, 0, 0, HALF_PI, 18);
  }
  b.name('grip safety beavertail').profile([[0.026, 0.007], [0.059, 0.004], [0.064, -0.002], [0.052, -0.009], [0.037, -0.009]], 0.013, WM.darkSteel, 0, 0.0018);
  b.name('skeleton hammer').profile([[0.041, 0.006], [0.049, 0.012], [0.053, 0.030], [0.064, 0.030], [0.068, 0.024], [0.059, 0.010], [0.050, 0.004]], 0.007, WM.darkSteel, 0, 0.0004, [[[0.057, 0.025], [0.062, 0.025], [0.063, 0.022], [0.056, 0.015]]]);
  b.name('slide stop').box(0.004, 0.006, 0.039, WM.midSteel, -0.013, -0.002, -0.039);
  b.name('thumb safety').box(0.004, 0.005, 0.022, WM.midSteel, -0.013, 0.001, 0.018);
  screw(b, -0.013, -0.013, -0.004, 0.0031);
  b.name('safety detent housing').cyl(0.0018, 0.0018, 0.040, WM.midSteel, -0.0134, -0.005, -0.007, HALF_PI, 0, 0, 20);
  for (let i = 0; i < 5; i++) b.name('thumb safety serration').box(0.0010, 0.004, 0.0012, WM.darkSteel, -0.0153, 0.0015, 0.010 + i * 0.003);

  b.name('mainspring housing').profile([[0.039, -0.036], [0.044, -0.036], [0.057, -0.086], [0.048, -0.090]], 0.019, WM.grip, 0, 0.0005);
  for (let i = 0; i < 7; i++) b.name('front strap checkering').box(0.020, 0.0015, 0.002, WM.grip, 0, -0.036 - i * 0.007, -0.008 + i * 0.0023);
  barrel.b.name('open 45 barrel').tube(0.0069, 0.0036, 0.060, WM.steel, 0, 0.026, -0.128);
  sights(a, slide.group, slide.group, 0.031, -0.137, 0.042, 0.051);
  magazine(mag.b, { width: 0.019, depth: 0.026, length: 0.086, rake: 0.024, material: WM.steel, ribs: 0 });
  mag.group.position.set(0, -0.017, 0.007);
  return a.finish({ mag: mag.group, handle: slide.group, sightY: 0.051, pistol: true,
    sockets: { muzzle: [0, 0.026, -0.157], barrel: [0, 0.026, -0.128], optic: [0, 0.042, 0.018], magazine: [0, -0.017, 0.007], rail: [0, -0.012, -0.107] },
    muzzleTip: [0, 0.026, -0.161], arms: { fore: [-0.004, -0.055, 0.025], grip: [0.004, -0.054, 0.028], mag: [0, -0.098, 0.031], fa: [0, 0.026, 0.020] },
  });
}

/** Gas-operated hand cannon: fixed polygonal barrel, triangular slide, broad rubber grip. */
export function buildDeagle(): WeaponModel {
  const a = new WeaponAssembly('Desert Eagle'), b = a.body;
  const slide = a.moving('reciprocating Eagle slide');
  const barrel = a.part('barrel', 'fixed polygonal barrel');
  const mag = a.part('magazine', '50 AE magazine');
  const s = slide.b, r = barrel.b;
  s.name('faceted slide').section([[-0.020, -0.018], [0.020, -0.018], [0.020, 0.006], [0.011, 0.022], [-0.011, 0.022], [-0.020, 0.006]], 0.144, WM.steel, 0, 0.031, -0.009).mill(slideCuts(.020,.035,.015,9,.004));
  s.name('Eagle firing pin stop').box(0.019, 0.024, 0.0012, WM.darkSteel, 0, 0.027, 0.0632);
  s.name('Eagle firing pin').cyl(0.0018, 0.0018, 0.0007, WM.midSteel, 0, 0.032, 0.0638, HALF_PI, 0, 0, 20);
  s.name('rotating bolt chamber').box(0.0015, 0.011, 0.036, WM.dark, 0.0203, 0.028, -0.041);
  s.name('chamber hood').box(0.0013, 0.007, 0.026, WM.chrome, 0.0208, 0.028, -0.044);
  s.name('ambidextrous safety shaft').cyl(0.004, 0.004, 0.045, WM.darkSteel, 0, 0.032, 0.043, 0, 0, HALF_PI, 16);
  for (const side of [-1, 1]) s.name('slide safety paddle').box(0.004, 0.005, 0.017, WM.darkSteel, side * 0.022, 0.029, 0.038, 0.28);
  stamp(s, 9, -0.0202, 0.026, -0.015, 0.115, 0.007);
  r.name('polygonal fixed barrel').section([[-0.019, -0.019], [0.019, -0.019], [0.019, 0.007], [0.009, 0.024], [-0.009, 0.024], [-0.019, 0.007]], 0.140, WM.steel, 0, 0.031, -0.141, { y: 0, radius: 0.0058 });
  r.name('barrel crown').tube(0.0085, 0.0056, 0.003, WM.chrome, 0, 0.031, -0.211);
  r.name('gas piston housing').box(0.024, 0.015, 0.112, WM.midSteel, 0, 0.008, -0.145);
  r.name('integral barrel rib').box(0.018, 0.003, 0.137, WM.midSteel, 0, 0.055, -0.142);
  for (let i = 0; i < 3; i++) r.name('barrel rail groove').box(0.0185, 0.001, 0.006, WM.dark, 0, 0.0566, -0.129 - i * 0.018);

  b.name('Eagle frame').profile([[-0.184, 0.011], [0.039, 0.013], [0.062, -0.010], [0.045, -0.023], [0.067, -0.091], [0.057, -0.106], [0.014, -0.106], [-0.014, -0.028], [-0.085, -0.018], [-0.179, -0.010]], 0.033, WM.steel, 0, 0.0023);
  b.name('slide seam').box(0.034, 0.002, 0.210, WM.dark, 0, 0.012, -0.058);
  triggerGuard(b, -0.009, -0.079, -0.017, -0.055, WM.steel);
  for (const side of [-1, 1]) {
    b.name('wraparound rubber grip').profile([[0.008, -0.022], [0.037, -0.022], [0.058, -0.090], [0.051, -0.099], [0.021, -0.099], [0.001, -0.037]], 0.008, WM.grip, side * 0.016, 0.0016);
    b.name('frame scallop').profile([[-0.012, 0.005], [0.028, 0.005], [0.041, -0.005], [0.037, -0.017], [0.010, -0.019], [-0.010, -0.010]], 0.0020, WM.midSteel, side * 0.0160, 0.00035);
    b.name('frame takedown pin').cyl(0.0026, 0.0026, 0.0014, WM.darkSteel, side * 0.0172, -0.003, -0.079, 0, 0, HALF_PI, 20);
    b.name('grip medallion').cyl(0.006, 0.006, 0.0009, WM.darkSteel, side * 0.0202, -0.056, 0.028, 0, 0, HALF_PI, 20);
    screw(b, side * 0.0202, -0.083, 0.037, 0.0028);
  }
  b.name('backstrap').profile([[0.039, -0.025], [0.047, -0.023], [0.068, -0.091], [0.057, -0.098]], 0.029, WM.grip, 0, 0.0008);
  b.name('slide release').box(0.004, 0.007, 0.030, WM.darkSteel, -0.017, -0.002, -0.037);
  screw(b, -0.017, -0.016, -0.002, 0.0035);
  b.name('exposed hammer').profile([[0.045, 0.009], [0.059, 0.008], [0.072, 0.026], [0.068, 0.035], [0.059, 0.033]], 0.009, WM.darkSteel, 0, 0.0007);
  for (const side of [-1, 1]) {
    b.name('frame dustcover machining line').box(0.0013, 0.002, 0.092, WM.midSteel, side * 0.0164, -0.006, -0.131);
    for (let i = 0; i < 5; i++) b.name('safety paddle serration').box(0.0011, 0.004, 0.0012, WM.midSteel, side * 0.0240, 0.029, 0.032 + i * 0.0025);
  }
  b.name('accessory rail').box(0.026, 0.004, 0.067, WM.darkSteel, 0, -0.013, -0.141);
  for (let i = 0; i < 3; i++) b.name('underframe rail lug').box(0.030, 0.004, 0.009, WM.midSteel, 0, -0.016, -0.120 - i * 0.020);
  sights(a, slide.group, barrel.group, 0.047, -0.193, 0.055, 0.064, 0.053);
  magazine(mag.b, { width: 0.025, depth: 0.030, length: 0.094, rake: 0.027, material: WM.darkSteel, ribs: 0 });
  mag.group.position.set(0, -0.017, 0.010);
  return a.finish({ mag: mag.group, handle: slide.group, sightY: 0.064, pistol: true,
    sockets: { muzzle: [0, 0.031, -0.212], barrel: [0, 0.031, -0.078], optic: [0, 0.053, 0.011], magazine: [0, -0.017, 0.010], rail: [0, -0.018, -0.142] },
    muzzleTip: [0, 0.031, -0.217], arms: { fore: [-0.004, -0.059, 0.029], grip: [0.004, -0.060, 0.034], mag: [0, -0.108, 0.037], fa: [0, 0.031, 0.030] },
  });
}
