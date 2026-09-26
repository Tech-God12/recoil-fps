// SIG MCX Spear (XM7) — the armory's hero rifle.
//
// Modelled from the left-side factory profile: coyote-anodised monolithic upper
// with an unbroken top rail, slim M-LOK handguard with the signature angled
// lightening cuts, two-position gas valve, ambidextrous controls, a
// non-reciprocating left-side charging handle, and a side-folding telescoping
// stock with an adjustable cheek riser.
//
// Gun-local convention: +Y up, −Z forward. Every dimension is metres.
import * as THREE from 'three';
import { WM, type WeaponModel } from './core';
import {
  HALF_PI, WeaponAssembly, magazine, pistolGrip, rail, screw, sideRail, stamp, triggerGuard,
} from './furniture';

/** Bore height above the gun origin — everything hangs off this one number. */
const BORE = 0.013;
/** Top of the monolithic rail: the flat the optic and BUIS bolt onto. */
const RAIL_Y = 0.038;

export function buildMCXSpear(): WeaponModel {
  const a = new WeaponAssembly('MCX Spear'), b = a.body;
  const stock = a.part('stock', 'folding telescopic stock');
  const barrel = a.part('barrel', 'barrel and gas system');
  const mag = a.part('magazine', '6.8 magazine');
  const charging = a.moving('charging handle');
  const sideCharger = a.moving('side charging handle');

  // ─────────────────────────── monolithic upper ───────────────────────────
  // The Spear's upper is one continuous billet: a rounded bolt tunnel that
  // transitions into a squared, chamfered rail deck. Built as a single swept
  // section so there is no seam where an AR would have an upper/handguard joint.
  const upper: [number, number][] = [
    [-0.021, -0.014], [0.021, -0.014], [0.023, -0.006],
    [0.023, 0.012], [0.019, 0.021], [0.015, 0.024],
    [-0.015, 0.024], [-0.019, 0.021], [-0.023, 0.012], [-0.023, -0.006],
  ];
  b.name('Spear monolithic upper').section(upper, 0.214, WM.fde, 0, 0.018, -0.120)
    // Ejection port, cut clean through the right wall.
    .mill([{ x: 0.022, y: 0.020, z: -0.112, w: 0.010, h: 0.017, d: 0.062, radius: 0.0025 }]);

  // Angled shoulder where the upper steps down onto the handguard — the single
  // most recognisable line on the rifle in profile.
  b.name('upper forward shoulder').profile(
    [[-0.212, 0.030], [-0.226, 0.018], [-0.226, -0.004], [-0.212, -0.004]], 0.044, WM.fde, 0, 0.0016);

  // Continuous top rail: upper deck + handguard deck share one unbroken run.
  rail(b, -0.016, -0.212, RAIL_Y, 0.032);
  rail(b, -0.216, -0.430, RAIL_Y, 0.032);

  // Rear receiver extension / stock housing with the Spear's stepped back plate.
  b.name('Spear rear receiver block').profile(
    [[-0.020, 0.034], [0.012, 0.034], [0.020, 0.026], [0.020, -0.016], [0.006, -0.026], [-0.020, -0.026]],
    0.042, WM.fde, 0, 0.0022);
  b.name('folding hinge boss').cyl(0.013, 0.013, 0.030, WM.fde, 0.000, 0.004, 0.016, 0, 0, HALF_PI, 20);
  b.name('hinge detent pin').cyl(0.0035, 0.0035, 0.034, WM.midSteel, 0, 0.004, 0.016, 0, 0, HALF_PI, 12);

  // ─────────────────────────── lower receiver ───────────────────────────
  b.name('Spear lower receiver').profile([
    [-0.208, 0.008], [-0.036, 0.008], [-0.018, 0.020], [-0.004, 0.018],
    [0.004, 0.002], [0.002, -0.020], [-0.026, -0.022], [-0.048, -0.024],
    [-0.064, -0.033], [-0.112, -0.031], [-0.122, -0.045], [-0.204, -0.045],
  ], 0.036, WM.fde, 0, 0.0024);

  // Flared magwell with the funnel actually milled out, not faked with a plate.
  b.name('Spear flared magwell').profile(
    [[-0.210, -0.002], [-0.124, -0.002], [-0.125, -0.034], [-0.133, -0.050], [-0.206, -0.046]],
    0.044, WM.fde, 0, 0.0021)
    .mill([{ x: 0, y: -0.042, z: -0.167, w: 0.030, h: 0.034, d: 0.059, radius: 0.0016 }]);

  // Ambidextrous controls — mirrored, because the real rifle is fully ambi.
  for (const side of [-1, 1]) {
    b.name('Spear selector drum').cyl(0.0050, 0.0050, 0.0036, WM.dark, side * 0.0186, -0.013, -0.066, 0, 0, HALF_PI);
    b.name('Spear selector paddle').profile(
      [[-0.068, -0.008], [-0.061, -0.008], [-0.048, -0.017], [-0.048, -0.022], [-0.055, -0.021], [-0.069, -0.013]],
      0.0032, WM.dark, side * 0.0206, 0.0005);
    b.name('Spear mag release').box(0.0042, 0.0085, 0.015, WM.dark, side * 0.0188, -0.008, -0.108);
    for (let i = 0; i < 4; i++) {
      b.name('mag release checkering').box(0.0011, 0.0007, 0.011, WM.grip, side * 0.0210, -0.0105 + i * 0.0017, -0.108);
    }
    b.name('Spear bolt catch paddle').profile(
      [[-0.101, -0.011], [-0.089, -0.011], [-0.091, 0.012], [-0.103, 0.012]], 0.0046, WM.dark, side * 0.0202, 0.0008);
    b.name('takedown pin head').cyl(0.0054, 0.0054, 0.0032, WM.fde, side * 0.0186, 0.000, -0.028, 0, 0, HALF_PI);
    screw(b, side * 0.0200, 0.000, -0.028, 0.0027);
    screw(b, side * 0.0208, -0.004, -0.198, 0.0029);
    b.name('Spear sling QD cup').tube(0.0055, 0.0030, 0.0040, WM.midSteel, side * 0.0190, -0.006, 0.006);
  }
  // Roll marks: caliber block on the magwell, selector legend above the grip.
  stamp(b, 16, 0.0218, -0.016, -0.166, 0.076, 0.022);
  stamp(b, 10, -0.0212, -0.004, -0.068, 0.037, 0.0035);
  stamp(b, 17, -0.0218, -0.016, -0.166, 0.076, 0.022);

  b.name('brass deflector').loft(
    [[-0.078, 0.030, 0.014, 0.005], [-0.068, 0.028, 0.011, 0.018], [-0.059, 0.024, 0.012, 0.003]], WM.fde, 0.40, 0.021);
  b.name('ejection port door').profile(
    [[-0.142, 0.012], [-0.080, 0.012], [-0.080, 0.002], [-0.142, 0.002]], 0.0022, WM.dark, 0.0234, 0.0004);
  b.name('port door hinge rod').cyl(0.0017, 0.0017, 0.064, WM.steel, 0.0242, 0.012, -0.111, HALF_PI);
  b.name('exposed bolt carrier').box(0.0020, 0.011, 0.050, WM.steel, 0.0162, 0.020, -0.111);

  triggerGuard(b, -0.065, -0.122, -0.025, -0.063, WM.fde, true);
  // The Spear grip has a pronounced beavertail and a deep finger swell.
  pistolGrip(b, -0.048, -0.021, 0.092, 0.033, WM.tanGrip, 0.026);
  b.name('grip beavertail').loft(
    [[-0.030, -0.014, -0.040, 0.030], [-0.020, -0.006, -0.036, 0.034], [-0.010, -0.002, -0.028, 0.030]], WM.fde, 0.5);

  // ─────────────────────────── M-LOK handguard ───────────────────────────
  // Slim hex tube. The M-LOK slots and the angled lightening cuts are milled
  // through the wall, so light passes and the barrel is visible behind them.
  const hex: [number, number][] = [
    [-0.0175, -0.021], [0.0175, -0.021], [0.0245, -0.011], [0.0245, 0.011],
    [0.0175, 0.022], [-0.0175, 0.022], [-0.0245, 0.011], [-0.0245, -0.011],
  ];
  const cuts: import('./geometry').MillCut[] = [];
  // Seven M-LOK slots per side, at 3 and 9 o'clock.
  for (let i = 0; i < 7; i++) {
    const z = -0.244 - i * 0.0245;
    for (const side of [-1, 1]) {
      cuts.push({ x: side * 0.024, y: 0.013, z, w: 0.010, h: 0.0072, d: 0.0175, radius: 0.0035 });
    }
    // 6 o'clock slots keep the underside from reading as a solid block.
    if (i < 6) cuts.push({ x: 0, y: -0.021, z: z - 0.012, w: 0.0072, h: 0.010, d: 0.0175, radius: 0.0035 });
  }
  // Signature angled lightening ports on the upper flanks.
  for (let i = 0; i < 6; i++) {
    const z = -0.252 - i * 0.0275;
    for (const side of [-1, 1]) {
      cuts.push({ x: side * 0.022, y: 0.0225, z, w: 0.012, h: 0.0065, d: 0.020, radius: 0.003, rx: side * 0.62 });
    }
  }
  b.name('Spear M-LOK handguard').section(hex, 0.208, WM.fde, 0, BORE, -0.322, { y: 0, radius: 0.0165 }).mill(cuts);
  b.name('handguard barrel nut').tube(0.0245, 0.0105, 0.017, WM.fde, 0, BORE, -0.220);
  for (let i = 0; i < 10; i++) {
    b.name('barrel nut flute').box(0.0018, 0.0028, 0.017, WM.dark,
      Math.sin(i * Math.PI / 5) * 0.0235, BORE + Math.cos(i * Math.PI / 5) * 0.0235, -0.220, 0, 0, -i * Math.PI / 5);
  }
  b.name('free-floated barrel under guard').cyl(0.0090, 0.0090, 0.206, WM.darkSteel, 0, BORE, -0.322, HALF_PI);
  b.name('handguard anti-rotation tab').box(0.030, 0.006, 0.020, WM.fde, 0, BORE + 0.024, -0.224);
  sideRail(b, -0.0252, 0.004, -0.320, 0.150);
  sideRail(b, 0.0252, 0.004, -0.320, 0.150);
  b.name('handguard QD socket').tube(0.0058, 0.0032, 0.0042, WM.midSteel, -0.0250, -0.008, -0.262, 0, 0, HALF_PI);

  // ─────────────────────── barrel, gas valve, muzzle ───────────────────────
  const r = barrel.b;
  r.name('exposed barrel shank').tube(0.0095, 0.0042, 0.070, WM.darkSteel, 0, BORE, -0.462);
  r.name('barrel shoulder step').tube(0.0112, 0.0090, 0.010, WM.darkSteel, 0, BORE, -0.432);
  // Two-position adjustable gas valve — the knurled knob under the handguard lip.
  r.name('gas block body').box(0.022, 0.026, 0.026, WM.dark, 0, BORE + 0.006, -0.437);
  r.name('gas valve knob').cyl(0.0072, 0.0072, 0.010, WM.midSteel, 0, BORE + 0.021, -0.437, 0, 0, 0, 16);
  for (let i = 0; i < 8; i++) {
    const t = i * Math.PI / 4;
    r.name('gas knob knurl').box(0.0016, 0.010, 0.0016, WM.dark,
      Math.sin(t) * 0.0068, BORE + 0.021, -0.437 + Math.cos(t) * 0.0068);
  }
  r.name('op-rod tube').cyl(0.0050, 0.0050, 0.092, WM.darkSteel, 0, BORE + 0.021, -0.390, HALF_PI);
  // Three-prong flash hider on a suppressor-mount collar, as issued.
  const muzzlePart = a.part('muzzle', 'three-prong flash hider');
  (a.removable.barrel ??= []).push(muzzlePart.group);
  const m = muzzlePart.b;
  m.name('suppressor mount collar').tube(0.0128, 0.0044, 0.014, WM.dark, 0, BORE, -0.500);
  for (let i = 0; i < 6; i++) {
    m.name('collar index tooth').box(0.0026, 0.0026, 0.013, WM.darkSteel,
      Math.sin(i * Math.PI / 3) * 0.0122, BORE + Math.cos(i * Math.PI / 3) * 0.0122, -0.500, 0, 0, -i * Math.PI / 3);
  }
  m.name('flash hider hub').tube(0.0122, 0.0044, 0.016, WM.dark, 0, BORE, -0.513);
  for (let i = 0; i < 3; i++) {
    const t = i * (Math.PI * 2 / 3) + Math.PI / 6;
    m.name('flash hider prong').box(0.0038, 0.0070, 0.030, WM.dark,
      Math.sin(t) * 0.0091, BORE + Math.cos(t) * 0.0091, -0.534, 0, 0, -t);
  }

  // ───────────────────── charging handles (two of them) ─────────────────────
  charging.b.name('ambi charging latch').box(0.020, 0.0055, 0.034, WM.dark, 0, 0.030, -0.012);
  charging.b.name('charging handle wings').box(0.052, 0.0085, 0.012, WM.dark, 0, 0.030, 0.002);
  for (const side of [-1, 1]) {
    charging.b.name('charging latch serration').box(0.0100, 0.0090, 0.0016, WM.grip, side * 0.021, 0.030, 0.002);
  }
  // Non-reciprocating left-side charger: the folding blade over the handguard joint.
  sideCharger.b.name('side charger shoe').box(0.008, 0.013, 0.030, WM.dark, -0.024, 0.014, -0.208);
  sideCharger.b.name('side charger blade').profile(
    [[-0.200, 0.020], [-0.214, 0.020], [-0.222, 0.006], [-0.210, 0.002], [-0.198, 0.010]], 0.0055, WM.dark, -0.030, 0.0009);
  sideCharger.group.position.set(0, 0, 0);
  sideCharger.group.userData.homeZ = 0;

  // ────────────────────── folding telescopic stock ──────────────────────
  const s = stock.b;
  s.name('stock folding knuckle').cyl(0.0125, 0.0125, 0.026, WM.fde, 0, 0.004, 0.030, 0, 0, HALF_PI, 20);
  s.name('stock receiver extension').box(0.030, 0.034, 0.088, WM.fde, 0, 0.010, 0.084);
  for (let i = 0; i < 5; i++) {
    s.name('length-of-pull detent').cyl(0.0032, 0.0032, 0.0022, WM.dark, 0, -0.008, 0.052 + i * 0.019, 0, 0, HALF_PI, 10);
  }
  // Skeleton frame with a genuine void, like the issued Spear buttstock.
  s.name('Spear stock frame').profile([
    [0.096, 0.030], [0.214, 0.030], [0.230, 0.014], [0.229, -0.060], [0.214, -0.062], [0.100, -0.024], [0.092, -0.008],
  ], 0.031, WM.fde, 0, 0.0026, [
    [[0.118, 0.000], [0.198, 0.000], [0.212, -0.042], [0.138, -0.020]],
  ]);
  // Adjustable cheek riser on its own posts.
  s.name('cheek riser').loft(
    [[0.098, 0.046, 0.010, 0.030], [0.112, 0.050, 0.006, 0.044], [0.206, 0.047, 0.006, 0.043], [0.222, 0.038, 0.006, 0.033]],
    WM.fde, 0.40);
  for (const z of [0.118, 0.198]) s.name('cheek riser post').cyl(0.0050, 0.0050, 0.014, WM.dark, 0, 0.036, z);
  s.name('cheek riser lock').box(0.020, 0.0075, 0.012, WM.dark, 0, 0.034, 0.158);
  for (const side of [-1, 1]) {
    s.name('stock sling slot').profile(
      [[0.202, 0.012], [0.220, 0.009], [0.221, -0.026], [0.212, -0.024]], 0.003, WM.fde, side * 0.016, 0.0004,
      [[[0.209, 0.004], [0.216, 0.003], [0.217, -0.017], [0.212, -0.016]]]);
    s.name('stock QD cup').tube(0.0055, 0.0030, 0.0040, WM.midSteel, side * 0.0155, -0.014, 0.106);
  }
  s.name('length adjustment lever').box(0.024, 0.0055, 0.044, WM.dark, 0, -0.020, 0.120, -0.14);
  s.name('rubber recoil pad').profile(
    [[0.226, 0.030], [0.243, 0.025], [0.244, -0.062], [0.226, -0.065]], 0.040, WM.rubber, 0, 0.0022);
  for (let i = 0; i < 9; i++) s.name('buttpad traction rib').box(0.035, 0.0026, 0.0022, WM.grip, 0, 0.020 - i * 0.0095, 0.244);

  // ───────────────────── backup iron sights (folding) ─────────────────────
  const buisRear = a.part('optic', 'folding rear sight');
  const buisFront = a.part('optic', 'folding front sight');
  const SIGHT_Y = 0.074;
  buisRear.b.name('rear BUIS base').box(0.026, 0.007, 0.024, WM.dark, 0, RAIL_Y + 0.004, -0.042);
  buisRear.b.name('rear BUIS leaf').profile(
    [[-0.046, RAIL_Y + 0.006], [-0.038, RAIL_Y + 0.006], [-0.038, SIGHT_Y], [-0.046, SIGHT_Y]], 0.017, WM.dark, 0, 0.0007);
  buisRear.b.name('rear BUIS aperture').tube(0.0062, 0.0028, 0.0050, WM.dark, 0, SIGHT_Y - 0.004, -0.042);
  screw(buisRear.b, -0.013, RAIL_Y + 0.005, -0.042, 0.0025);
  buisFront.b.name('front BUIS base').box(0.025, 0.007, 0.022, WM.dark, 0, RAIL_Y + 0.004, -0.404);
  buisFront.b.name('front BUIS post housing').profile(
    [[-0.410, RAIL_Y + 0.006], [-0.398, RAIL_Y + 0.006], [-0.400, SIGHT_Y], [-0.408, SIGHT_Y]], 0.014, WM.dark, 0, 0.0006);
  buisFront.b.name('front sight post').box(0.0026, 0.014, 0.0035, WM.dark, 0, SIGHT_Y - 0.008, -0.404);
  for (const side of [-1, 1]) {
    buisFront.b.name('front sight ear').profile(
      [[-0.411, RAIL_Y + 0.008], [-0.397, RAIL_Y + 0.008], [-0.399, SIGHT_Y + 0.002], [-0.409, SIGHT_Y + 0.002]],
      0.0028, WM.dark, side * 0.0098, 0.0003);
  }

  // ──────────────────────────── magazine ────────────────────────────
  // 6.8×51 is a fat, tall cartridge: the mag is deeper and less curved than a STANAG.
  magazine(mag.b, { width: 0.028, depth: 0.058, length: 0.138, bend: 0.016, material: WM.dark, ribs: 4 });
  mag.group.position.set(0, -0.034, -0.166);

  return a.finish({
    mag: mag.group,
    handle: charging.group,
    sightY: SIGHT_Y,
    sockets: {
      // Muzzle and underbarrel sockets sit a couple of millimetres INSIDE the
      // surface they bolt to (barrel shank ends at -0.497, handguard underside
      // at BORE-0.021). A socket flush with the surface leaves a hairline gap
      // once a part with its own mounting collar is fitted.
      muzzle: [0, BORE, -0.494],
      barrel: [0, BORE, -0.430],
      optic: [0, RAIL_Y + 0.007, -0.108],
      magazine: [0, -0.034, -0.166],
      underbarrel: [0, BORE - 0.019, -0.338],
      stock: [0, 0.010, -0.012],
      rail: [-0.030, 0.004, -0.320],
    },
    muzzleTip: [0, BORE, -0.552],
    // Support hand sits well forward on the long handguard; the mag well and the
    // ambi bolt release are where the reload keyframes send it.
    arms: { fore: [0, -0.026, -0.340], mag: [0, -0.148, -0.184], fa: [-0.006, 0.014, -0.096] },
  });
}

/** Exposed for the armory showcase so the Spear can be posed folded. */
export function foldSpearStock(model: WeaponModel, folded: boolean): void {
  const parts = model.removable.stock;
  if (!parts) return;
  for (const p of parts) p.rotation.y = folded ? -Math.PI * 0.92 : 0;
  model.group.updateMatrixWorld(true);
  void THREE;
}
