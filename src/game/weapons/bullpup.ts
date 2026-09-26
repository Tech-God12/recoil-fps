// Bullpup rifles. Gun-local convention: +Y up, -Z forward (muzzle), metres.
import * as THREE from 'three';
import { WM, type WeaponModel } from './core';
import { HALF_PI, WeaponAssembly, rail, screw, sideRail, stamp } from './furniture';

/**
 * Steyr AUG A3 — 5.56x45 NATO bullpup.
 *
 * Built from the real thing rather than a vibe: 715 mm overall on the 16" barrel,
 * Eloxal-coated cast-aluminium receiver carrying a full-length Picatinny rail, the
 * signature triangular barrel trunnion with its three bores (barrel, op rod,
 * charging rod), quarter-turn quick-change barrel behind a trunnion release button,
 * folding vertical foregrip, short-stroke gas piston, a 10-port muzzle brake and a
 * translucent 30-round polymer magazine sitting BEHIND the grip where a bullpup
 * keeps it. Ejection port is on the right, cocking slot and paddle on the left.
 *
 * Datum: bore axis at y = 0.013 like every other rifle in the roster, so optics,
 * muzzle devices and the viewmodel rig line up without special cases. Sight-over-bore
 * is deliberately tall (0.080) — that is the AUG's defining ergonomic quirk.
 */
export function buildAUG(): WeaponModel {
  const a = new WeaponAssembly('AUG A3'), b = a.body;
  const BORE = 0.013;
  const stock = a.part('stock', 'bullpup stock shell');
  const barrel = a.part('barrel', 'quick-change barrel');
  const mag = a.part('magazine', 'translucent 30-round magazine');
  const charging = a.moving('cocking handle');
  const fore = a.part('underbarrel', 'folding vertical foregrip');
  const s = stock.b, r = barrel.b, g = fore.b;

  // ==================== POLYMER STOCK SHELL ====================
  // One continuous moulding from buttplate to the front of the trigger housing.
  // Modelled as three interlocking extrusions that share their seam planes, so the
  // silhouette is unbroken and there are no gaps where sections meet.
  const BUTT_W = 0.044, MID_W = 0.042, GRIP_W = 0.030;

  // Butt section: raked buttplate, pronounced toe hook, raised comb over the receiver.
  s.name('AUG butt housing').profile([
    [0.236, 0.048], [0.234, 0.006], [0.229, -0.028], [0.225, -0.058],
    [0.196, -0.055], [0.152, -0.044], [0.113, -0.034], [0.100, -0.028],
    [0.098, 0.030], [0.104, 0.052], [0.150, 0.062], [0.198, 0.060],
  ], BUTT_W, WM.od, 0, 0.0035);
  // Mid section: houses the magazine well and the hammer pack.
  s.name('AUG magazine housing').profile([
    [0.102, 0.052], [0.102, -0.030], [0.074, -0.034], [0.016, -0.034],
    [0.010, -0.010], [0.008, 0.046], [0.060, 0.052],
  ], MID_W, WM.od, 0, 0.0030);
  // Grip + the AUG's full-hand trigger-guard loop, which is part of the same shell.
  s.name('AUG grip and guard shell').profile([
    [0.012, 0.030], [0.012, -0.030], [0.006, -0.058], [-0.004, -0.098],
    [-0.020, -0.128], [-0.044, -0.136], [-0.062, -0.126], [-0.068, -0.100],
    [-0.062, -0.070], [-0.070, -0.066], [-0.112, -0.080], [-0.146, -0.094],
    [-0.168, -0.094], [-0.176, -0.078], [-0.170, -0.060], [-0.150, -0.046],
    [-0.150, -0.020], [-0.150, 0.026], [-0.100, 0.040], [-0.040, 0.040],
  ], GRIP_W, WM.od, 0, 0.0032, [
    // The open loop: a genuine hole through the shell, not a painted-on shape.
    [[-0.020, -0.060], [-0.052, -0.066], [-0.088, -0.070], [-0.128, -0.078],
    [-0.140, -0.070], [-0.138, -0.040], [-0.100, -0.030], [-0.040, -0.028]],
  ]);
  // Trigger housing roof ties the grip shell to the mag housing with no seam gap.
  s.name('AUG trigger housing roof').box(MID_W, 0.028, 0.170, WM.od, 0, 0.032, -0.070);

  // Raised comb / cheek weld, lofted so it blends into the butt instead of stepping.
  s.name('AUG cheek comb').loft([
    [0.098, 0.052, 0.040, 0.034],
    [0.124, 0.064, 0.044, 0.042],
    [0.186, 0.066, 0.046, 0.042],
    [0.226, 0.056, 0.044, 0.033],
  ], WM.od, 0.42);

  // Buttplate: rubber pad with the AUG's hooked toe and a sling loop above it.
  s.name('AUG recoil pad').profile([
    [0.238, 0.046], [0.249, 0.038], [0.248, -0.020], [0.240, -0.052], [0.228, -0.058], [0.230, 0.040],
  ], BUTT_W - 0.002, WM.rubber, 0, 0.0018);
  for (let i = 0; i < 7; i++) s.name('recoil pad rib').box(BUTT_W - 0.008, 0.0025, 0.002, WM.grip, 0, 0.036 - i * 0.013, 0.2455);
  s.name('sling loop bar').cyl(0.0025, 0.0025, 0.018, WM.midSteel, 0, 0.040, 0.219, 0, 0, HALF_PI, 8);
  s.name('sling loop plate').profile([[0.212, 0.048], [0.228, 0.048], [0.228, 0.030], [0.212, 0.030]], 0.020, WM.dark, 0, 0.0006,
    [[[0.216, 0.045], [0.224, 0.045], [0.224, 0.034], [0.216, 0.034]]]);

  // Side furniture: takedown pin, trunnion release, selector cross-bolt, mag paddle.
  for (const side of [-1, 1]) {
    const x = side * (BUTT_W / 2);
    s.name('stock moulding seam').box(0.0016, 0.052, 0.128, WM.poly, x + side * 0.0006, 0.018, 0.166);
    s.name('takedown pin boss').cyl(0.0072, 0.0072, 0.0035, WM.dark, x - side * 0.0004, 0.008, 0.118, 0, 0, HALF_PI, 14);
    screw(s, x + side * 0.001, 0.008, 0.118, 0.0034);
    s.name('hammer pack pin').cyl(0.0048, 0.0048, 0.003, WM.dark, side * (MID_W / 2), 0.004, 0.058, 0, 0, HALF_PI, 12);
    // Cross-bolt safety through the web of the grip — push-through, both ends visible.
    s.name('cross-bolt safety').cyl(0.0052, 0.0052, GRIP_W + 0.004, WM.dark, 0, 0.012, -0.020, 0, 0, HALF_PI, 12);
    s.name('safety button face').cyl(0.0056, 0.0052, 0.0022, side < 0 ? WM.red : WM.midSteel, side * (GRIP_W / 2 + 0.002), 0.012, -0.020, 0, 0, HALF_PI, 12);
    // Ambidextrous magazine release paddle, just behind the well.
    s.name('magazine release paddle').profile([[0.086, -0.016], [0.100, -0.014], [0.102, -0.030], [0.084, -0.030]], 0.005, WM.dark, side * (MID_W / 2 + 0.002), 0.0008);
    s.name('sling swivel plate').box(0.004, 0.014, 0.020, WM.dark, side * (MID_W / 2 + 0.001), -0.020, 0.030);
  }
  stamp(s, 10, BUTT_W / 2 + 0.001, 0.034, 0.150, 0.062, 0.006);      // SAFE / SEMI / AUTO
  stamp(s, 11, -(BUTT_W / 2) - 0.001, 0.032, 0.152, 0.058, 0.005);   // serial

  // Trigger: a simple blade inside the big loop. The guard itself is the shell hole.
  b.name('AUG trigger blade').profile([
    [-0.030, -0.012], [-0.038, -0.014], [-0.040, -0.040], [-0.046, -0.048],
    [-0.038, -0.052], [-0.030, -0.044],
  ], 0.0055, WM.midSteel, 0, 0.0005);
  b.name('trigger pivot pin').cyl(0.0022, 0.0022, 0.009, WM.steel, 0, -0.012, -0.031, 0, 0, HALF_PI, 8);

  // ==================== ALUMINIUM RECEIVER ====================
  // Cast, Eloxal-coated, and unmistakably a separate black component sitting in the
  // green shell. Its top face carries the rail for the whole length of the housing.
  const RX0 = 0.104, RX1 = -0.196;   // rear, front in z
  b.name('AUG receiver casting').section([
    [-0.020, -0.018], [0.020, -0.018], [0.023, -0.010], [0.023, 0.020],
    [0.018, 0.030], [-0.018, 0.030], [-0.023, 0.020], [-0.023, -0.010],
  ], RX0 - RX1, WM.dark, 0, BORE + 0.010, (RX0 + RX1) / 2);
  // Machined lightening flat down each side of the casting.
  for (const side of [-1, 1]) {
    b.name('receiver relief flat').box(0.003, 0.016, 0.176, WM.darkSteel, side * 0.0215, BORE + 0.012, -0.060);
    b.name('receiver rib').box(0.002, 0.004, 0.230, WM.dark, side * 0.0235, BORE + 0.030, -0.046);
  }
  // Right-hand ejection port with a real recess and a hinged dust deflector.
  b.name('ejection port recess').box(0.005, 0.021, 0.062, WM.dark, 0.0215, BORE + 0.016, 0.006);
  b.name('ejection port lip').profile([[0.040, 0.034], [-0.028, 0.034], [-0.030, 0.029], [0.038, 0.029]], 0.004, WM.darkSteel, 0.0235, 0.0006);
  b.name('brass deflector').loft([
    [0.030, BORE + 0.030, BORE + 0.016, 0.004],
    [0.018, BORE + 0.028, BORE + 0.012, 0.016],
    [0.004, BORE + 0.024, BORE + 0.014, 0.004],
  ], WM.darkSteel, 0.40, 0.022);
  // Left-hand cocking slot the handle actually travels in.
  b.name('cocking slot').box(0.004, 0.008, 0.150, WM.dark, -0.0225, BORE + 0.024, -0.096);
  b.name('cocking slot rail').box(0.003, 0.003, 0.152, WM.midSteel, -0.0235, BORE + 0.030, -0.096);

  // Full-length Picatinny — the A3's headline change over the A1/A2 optic hump.
  rail(b, RX0 - 0.010, RX1 + 0.004, BORE + 0.040, 0.030);
  // Rail hardware bites into the machined side flat, where a real clamp screw goes.
  for (const side of [-1, 1]) {
    screw(b, side * 0.0225, BORE + 0.012, -0.120, 0.0030);
    screw(b, side * 0.0225, BORE + 0.012, 0.006, 0.0030);
  }
  stamp(b, 14, 0.0245, BORE + 0.014, -0.090, 0.070, 0.006);

  // ==================== TRIANGULAR TRUNNION ====================
  // The AUG's most recognisable single part: a triangular alloy sleeve carrying three
  // bores — barrel, gas/op rod (upper right) and charging rod (upper left) — with the
  // quarter-turn barrel release button on its left face.
  const TZ = -0.214;
  b.name('trunnion block').section([
    [-0.026, -0.016], [0.026, -0.016], [0.030, -0.008], [0.014, 0.026],
    [-0.014, 0.026], [-0.030, -0.008],
  ], 0.052, WM.darkSteel, 0, BORE + 0.004, TZ);
  b.name('trunnion barrel bore').tube(0.0135, 0.0088, 0.054, WM.dark, 0, BORE, TZ);
  b.name('op rod bore').tube(0.0072, 0.0046, 0.054, WM.dark, 0.0145, BORE + 0.020, TZ);
  b.name('charging rod bore').tube(0.0062, 0.0038, 0.054, WM.dark, -0.0145, BORE + 0.020, TZ);
  b.name('barrel release button').cyl(0.0068, 0.0068, 0.0055, WM.midSteel, -0.0285, BORE + 0.002, TZ - 0.008, 0, 0, HALF_PI, 14);
  b.name('barrel release collar').tube(0.0092, 0.0068, 0.003, WM.dark, -0.0272, BORE + 0.002, TZ - 0.008, 0, 0, HALF_PI, 14);
  for (const side of [-1, 1]) screw(b, side * 0.028, BORE - 0.010, TZ + 0.020, 0.0026);
  // Sling swivel loop under the trunnion.
  b.name('front sling loop').tube(0.0082, 0.0050, 0.004, WM.midSteel, 0, BORE - 0.014, TZ + 0.012, HALF_PI);

  // ==================== BARREL GROUP (quick-change) ====================
  const MUZ = -0.485;
  r.name('barrel shank').tube(0.0128, 0.0088, 0.034, WM.darkSteel, 0, BORE, -0.252);
  // Fluted section right ahead of the trunnion — a real AUG signature.
  r.name('fluted barrel section').tube(0.0108, 0.0088, 0.048, WM.darkSteel, 0, BORE, -0.293);
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    r.name('barrel flute').box(0.0026, 0.0011, 0.046, WM.dark,
      Math.sin(t) * 0.0103, BORE + Math.cos(t) * 0.0103, -0.293, 0, 0, -t);
  }
  r.name('barrel step').turned([
    [0.0100, -0.317], [0.0100, -0.330], [0.0082, -0.338], [0.0082, -0.446],
    [0.0062, -0.446], [0.0062, -0.330], [0.0082, -0.320], [0.0082, -0.317],
  ], WM.darkSteel, 0, BORE, 0);
  r.name('barrel forward journal').tube(0.0082, 0.0058, 0.108, WM.darkSteel, 0, BORE, -0.392);
  // Short-stroke gas piston and its cylinder, above and right of the bore.
  r.name('gas cylinder').tube(0.0060, 0.0036, 0.086, WM.darkSteel, 0.0145, BORE + 0.020, -0.290);
  r.name('gas regulator drum').cyl(0.0082, 0.0082, 0.014, WM.midSteel, 0.0145, BORE + 0.020, -0.336, HALF_PI, 0, 0, 12);
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    r.name('regulator detent').box(0.0018, 0.0018, 0.013, WM.dark, 0.0145 + Math.sin(t) * 0.008, BORE + 0.020 + Math.cos(t) * 0.008, -0.336, 0, 0, -t);
  }
  r.name('gas port block').box(0.020, 0.016, 0.022, WM.darkSteel, 0.008, BORE + 0.014, -0.336);
  r.name('charging rod').cyl(0.0034, 0.0034, 0.096, WM.steel, -0.0145, BORE + 0.020, -0.286, HALF_PI);
  r.name('charging rod guide').tube(0.0056, 0.0036, 0.016, WM.darkSteel, -0.0145, BORE + 0.020, -0.330);

  // 10-port muzzle brake with a genuinely open bore.
  const brake = a.part('muzzle', 'ten-port muzzle brake');
  (a.removable.barrel ??= []).push(brake.group);
  const m = brake.b;
  m.name('brake collar').tube(0.0112, 0.0062, 0.009, WM.darkSteel, 0, BORE, -0.450);
  m.name('brake body').tube(0.0104, 0.0062, 0.036, WM.darkSteel, 0, BORE, MUZ + 0.018);
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) {
      m.name('brake port').box(0.0030, 0.0062, 0.0042, WM.dark, side * 0.0092, BORE + 0.0035, -0.456 - i * 0.0062, 0, 0, side * 0.35);
    }
  }
  m.name('brake crown').tube(0.0112, 0.0062, 0.005, WM.dark, 0, BORE, MUZ + 0.002);

  // ==================== FOLDING VERTICAL FOREGRIP ====================
  // Deployed. Hinge block, knuckle pin and a detent button, so it reads as a part
  // that folds rather than a handle glued under the trunnion.
  g.name('foregrip hinge block').box(0.026, 0.014, 0.030, WM.darkSteel, 0, BORE - 0.020, -0.226);
  g.name('foregrip knuckle').cyl(0.0068, 0.0068, 0.029, WM.midSteel, 0, BORE - 0.026, -0.226, 0, 0, HALF_PI, 14);
  g.name('foregrip detent').cyl(0.0032, 0.0032, 0.031, WM.dark, 0, BORE - 0.026, -0.226, 0, 0, HALF_PI, 10);
  // loft(axis:'y') stations are [downwardDistance, zRear, zFront, width] — the first
  // component is negated into world Y, so it is a depth, not a height.
  g.name('foregrip column').loft([
    [0.004, -0.212, -0.242, 0.026],
    [0.024, -0.212, -0.244, 0.030],
    [0.074, -0.214, -0.246, 0.031],
    [0.110, -0.216, -0.243, 0.028],
    [0.130, -0.222, -0.238, 0.020],
  ], WM.od, 0.46, 0, 'y');
  for (let i = 0; i < 6; i++) g.name('foregrip finger groove').box(0.030, 0.0026, 0.0030, WM.poly, 0, -0.030 - i * 0.015, -0.2435 + i * 0.0005);
  g.name('foregrip cap').cyl(0.0125, 0.0105, 0.004, WM.dark, 0, -0.129, -0.229, 0, 0, 0, 14);

  // ==================== COCKING HANDLE (moving) ====================
  // Rides the left cocking slot. The paddle folds out; a bolt-catch notch is cut
  // into its heel because on an AUG that notch is how you lock the bolt back.
  const c = charging.b;
  c.name('cocking handle carrier').box(0.010, 0.013, 0.030, WM.darkSteel, -0.024, BORE + 0.024, 0);
  c.name('cocking handle stem').box(0.014, 0.010, 0.012, WM.darkSteel, -0.032, BORE + 0.024, -0.004);
  c.name('cocking handle paddle').profile([
    [0.012, 0.030], [0.012, -0.004], [0.002, -0.014], [-0.016, -0.014],
    [-0.020, -0.004], [-0.020, 0.024], [-0.008, 0.032],
  ], 0.009, WM.od, -0.041, 0.0016);
  for (let i = 0; i < 4; i++) c.name('paddle grip rib').box(0.010, 0.0022, 0.0024, WM.poly, -0.041, BORE + 0.030 - i * 0.006, -0.008);
  c.name('bolt catch notch').box(0.011, 0.004, 0.006, WM.dark, -0.036, BORE + 0.013, 0.012);
  charging.group.position.set(0, 0, -0.104);

  // ==================== MAGAZINE ====================
  // Straight 30-round polymer box in translucent smoke, with the AUG's witness
  // slots and a ribbed floorplate. Bullpup: it sits behind the grip.
  const mb = mag.b;
  const MW = 0.026, MD = 0.048, ML = 0.128;
  mb.name('magazine body').profile([
    [MD / 2, 0.008], [MD / 2 - 0.004, 0.008 - ML], [-MD / 2 + 0.006, 0.008 - ML], [-MD / 2, 0.008],
  ], MW, WM.poly, 0, 0.0016);
  mb.name('magazine feed lips').profile([
    [MD / 2 + 0.001, 0.014], [MD / 2 + 0.001, 0.004], [-MD / 2 - 0.001, 0.004], [-MD / 2 - 0.001, 0.014],
  ], MW + 0.002, WM.dark, 0, 0.0006, [[[MD / 2 - 0.004, 0.012], [MD / 2 - 0.004, 0.006], [-MD / 2 + 0.004, 0.006], [-MD / 2 + 0.004, 0.012]]]);
  for (const side of [-1, 1]) {
    // Witness slots down the side: three per column, cut through to a dark interior.
    for (let i = 0; i < 4; i++) {
      mb.name('witness slot').box(0.0026, 0.016, 0.026, WM.dark, side * (MW / 2 - 0.0004), -0.020 - i * 0.028, 0);
    }
    mb.name('magazine side rib').box(0.0022, ML - 0.020, 0.0035, WM.dark, side * (MW / 2 + 0.0008), 0.008 - ML / 2, MD / 2 - 0.010);
  }
  mb.name('magazine floorplate').profile([
    [MD / 2 - 0.002, 0.014 - ML], [MD / 2 - 0.004, 0.002 - ML], [-MD / 2 + 0.006, 0.002 - ML], [-MD / 2 + 0.002, 0.014 - ML],
  ], MW + 0.003, WM.dark, 0, 0.0008);
  for (let i = 0; i < 5; i++) mb.name('floorplate rib').box(MW + 0.001, 0.0022, 0.0026, WM.grip, 0, 0.004 - ML, MD / 2 - 0.008 - i * 0.008);
  mag.group.position.set(0, -0.026, 0.040);

  // Magazine well mouth on the shell, sized so the magazine seats with no gap.
  s.name('magazine well mouth').profile([
    [0.074, -0.022], [0.074, -0.036], [0.014, -0.036], [0.014, -0.022],
  ], MW + 0.010, WM.od, 0, 0.0010, [[[0.068, -0.026], [0.068, -0.033], [0.020, -0.033], [0.020, -0.026]]]);

  // Side rails on the receiver for lasers/lights, matching the rest of the roster.
  sideRail(b, -0.0245, BORE + 0.006, -0.140, 0.086);
  sideRail(b, 0.0245, BORE + 0.006, -0.140, 0.086);

  return a.finish({
    mag: mag.group, handle: charging.group, sightY: 0.080,
    sockets: {
      // Muzzle sits ON the barrel crown, not 4 mm in front of it, so replacement
      // devices weld to the bore instead of hovering.
      muzzle: [0, BORE, -0.4455],
      // Quick-change barrels index into the trunnion — which is literally how the
      // real AUG works, and it also keeps the replacement shoulder inside solid metal.
      barrel: [0, BORE, -0.2255],
      optic: [0, BORE + 0.047, -0.060],
      magazine: [0, -0.026, 0.040],
      underbarrel: [0, BORE - 0.010, -0.226],
      stock: [0, 0.020, 0.140],
      rail: [-0.0265, BORE + 0.006, -0.150],
    },
    muzzleTip: [0, BORE, MUZ - 0.004],
    arms: { fore: [0, BORE - 0.062, -0.228], mag: [0, -0.150, 0.042], fa: [0, BORE + 0.030, -0.104] },
  });
}

/** Debug aid used by the model tests: the anchors that must not float in mid-air. */
export const AUG_CONTACTS: Record<string, THREE.Vector3> = {
  trunnionToBarrel: new THREE.Vector3(0, 0.013, -0.240),
  trunnionToReceiver: new THREE.Vector3(0, 0.013, -0.196),
  magazineToWell: new THREE.Vector3(0, -0.018, 0.040),
  foregripToTrunnion: new THREE.Vector3(0, -0.007, -0.226),
  brakeToBarrel: new THREE.Vector3(0, 0.013, -0.446),
  railToReceiver: new THREE.Vector3(0, 0.053, -0.060),
};
