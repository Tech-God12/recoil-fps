import { WM, type WeaponModel } from './core';
import { HALF_PI, WeaponAssembly, flashHider, ironSights, magazine, pistolGrip, rail, screw, sideRail, stamp, triggerGuard, verticalGrip } from './furniture';

/** Compact MP7: grip-fed magazine, folding foregrip and inset telescopic rails. */
export function buildMP7(): WeaponModel {
  const a = new WeaponAssembly('MP7'), b = a.body;
  const stock = a.part('stock', 'retractable MP7 stock');
  const foregrip = a.part('underbarrel', 'folding foregrip');
  const mag = a.part('magazine', '4.6mm stick magazine');
  const charging = a.moving('MP7 T handle');
  b.name('moulded MP7 receiver').profile([[-0.243, -0.020], [-0.250, 0.012], [-0.232, 0.039], [-0.009, 0.042], [0.014, 0.027], [0.014, -0.010], [-0.091, -0.021]], 0.039, WM.poly, 0, 0.0028);
  for (const side of [-1, 1]) {
    const ports: [number, number][][] = Array.from({ length: 5 }, (_, i) => [[-0.149 - i * 0.015, 0.018], [-0.157 - i * 0.015, 0.018], [-0.154 - i * 0.015, 0.029], [-0.147 - i * 0.015, 0.029]]);
    if (side > 0) ports.push([[-0.093, 0.012], [-0.048, 0.012], [-0.048, 0.024], [-0.093, 0.024]]);
    b.name('moulded receiver side shell').profile([[-0.241, -0.018], [-0.247, 0.012], [-0.231, 0.037], [-0.009, 0.040], [0.012, 0.025], [0.012, -0.009], [-0.094, -0.018]], 0.0038, WM.poly, side * 0.0206, 0.0007, ports);
    b.name('recessed front lower moulding').profile([[-0.237, -0.014], [-0.138, -0.014], [-0.128, -0.026], [-0.222, -0.026], [-0.239, -0.022]], 0.0022, WM.poly, side * 0.0216, 0.0004);
    b.name('receiver upper shoulder').profile([[-0.222, 0.033], [-0.020, 0.035], [-0.013, 0.030], [-0.210, 0.031]], 0.0024, WM.poly, side * 0.0209, 0.0004);
    b.name('selector detent').cyl(0.0032, 0.0032, 0.0020, WM.midSteel, side * 0.0228, -0.003, -0.066, 0, 0, HALF_PI, 20);
    b.name('stock release button').box(0.0022, 0.006, 0.010, WM.darkSteel, side * 0.0230, -0.001, 0.003);
  }
  b.name('receiver lower web').profile([[-0.239, -0.015], [-0.117, -0.015], [-0.099, -0.029], [-0.223, -0.031], [-0.239, -0.025]], 0.036, WM.poly, 0, 0.001);
  rail(b, 0.001, -0.233, 0.040, 0.030);
  for (const side of [-1, 1]) {
    b.name('stock guide channel').box(0.002, 0.011, 0.105, WM.dark, side * 0.0223, 0.011, -0.035);
    b.name('upper mould seam').box(0.001, 0.002, 0.157, WM.midSteel, side * 0.0222, 0.025, -0.131);
    for (const z of [-0.021, -0.100, -0.211]) screw(b, side * 0.0223, -0.001, z, 0.0026);
    for (let i = 0; i < 5; i++) b.name('cooling louvre').profile([[-0.149 - i * 0.015, 0.018], [-0.157 - i * 0.015, 0.018], [-0.154 - i * 0.015, 0.029], [-0.147 - i * 0.015, 0.029]], 0.001, WM.dark, side * 0.0196, 0);
    b.name('selector lever').box(0.003, 0.005, 0.019, WM.darkSteel, side * 0.023, -0.004, -0.061, -0.23);
    stamp(b, 4, side * 0.0223, 0.031, -0.091, 0.071, 0.0055);
  }
  b.name('closed bolt face').box(0.0012, 0.008, 0.034, WM.midSteel, 0.0203, 0.017, -0.073);
  pistolGrip(b, -0.052, -0.018, 0.092, 0.029, WM.poly, 0.020);
  triggerGuard(b, -0.072, -0.129, -0.021, -0.058, WM.poly);
  b.name('paddle magazine release').box(0.032, 0.006, 0.010, WM.darkSteel, 0, -0.034, -0.069);
  sideRail(b, -0.0235, -0.005, -0.176, 0.082);
  sideRail(b, 0.0235, -0.005, -0.176, 0.082);
  verticalGrip(foregrip.b, -0.222, -0.025, 0.065);

  const s = stock.b;
  for (const side of [-1, 1]) {
    s.name('telescopic stock rail').cyl(0.0038, 0.0038, 0.190, WM.steel, side * 0.019, 0.011, 0.067, HALF_PI, 0, 0, 16);
    s.name('stock rail guide').box(0.009, 0.012, 0.032, WM.dark, side * 0.019, 0.011, 0.010);
  }
  s.name('connected stock heel').profile([[0.151, 0.035], [0.174, 0.035], [0.180, 0.024], [0.180, -0.044], [0.162, -0.047], [0.153, -0.031]], 0.037, WM.poly, 0, 0.0014);
  s.name('stock rubber pad').profile([[0.173, 0.027], [0.185, 0.024], [0.185, -0.043], [0.177, -0.045]], 0.033, WM.rubber, 0, 0.001);
  screw(s, -0.019, 0.010, 0.164, 0.0032);
  charging.b.name('charging stem').box(0.018, 0.007, 0.037, WM.darkSteel, 0, 0.030, 0.007);
  charging.b.name('charging T handle').box(0.049, 0.008, 0.012, WM.dark, 0, 0.030, 0.025);
  for (const side of [-1, 1]) charging.b.name('T handle latch').box(0.007, 0.011, 0.017, WM.midSteel, side * 0.022, 0.030, 0.023);
  b.name('barrel shoulder').cyl(0.013, 0.013, 0.035, WM.darkSteel, 0, 0.008, -0.249, HALF_PI);
  b.name('open short barrel').tube(0.007, 0.003, 0.057, WM.darkSteel, 0, 0.008, -0.276);
  flashHider(a, -0.299, 0.008, 0.029, 0.0095, false);
  ironSights(a, -0.021, -0.220, 0.047, 0.047, 0.072);
  magazine(mag.b, { width: 0.023, depth: 0.029, length: 0.152, rake: 0.034, material: WM.midSteel, ribs: 2 });
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) mag.b.name('magazine witness hole').cyl(0.0013, 0.0013, 0.0009, WM.dark, side * 0.0118, -0.089 - i * 0.011, 0.022 + i * 0.0025, 0, 0, HALF_PI, 10);
  mag.group.position.set(0, -0.032, -0.051);
  return a.finish({ mag: mag.group, handle: charging.group, sightY: 0.072,
    sockets: { muzzle: [0, 0.008, -0.299], optic: [0, 0.047, -0.120], magazine: [0, -0.032, -0.051], underbarrel: [0, -0.025, -0.222], stock: [0, 0.011, 0.010], rail: [-0.0275, -0.005, -0.176] },
    muzzleTip: [0, 0.008, -0.332], arms: { fore: [0, -0.060, -0.222], grip: [0.004, -0.072, -0.037], mag: [0, -0.160, -0.019], fa: [0, 0.030, 0.025] },
  });
}

/** Vector's angular Super-V lower and low bore axis are modelled, not a generic SMG slab. */
export function buildVector(): WeaponModel {
  const a = new WeaponAssembly('KRISS Vector'), b = a.body;
  const stock = a.part('stock', 'Vector folding stock');
  const barrel = a.part('barrel', 'low-axis barrel');
  const mag = a.part('magazine', '45 ACP stick magazine');
  const foregrip = a.part('underbarrel', 'Vector foregrip');
  const charging = a.moving('folding side charger');
  b.name('Vector upper receiver').profile([[-0.278, 0.040], [-0.265, 0.050], [0.020, 0.050], [0.034, 0.034], [0.032, -0.025], [-0.058, -0.026], [-0.089, -0.005], [-0.278, -0.010]], 0.043, WM.poly, 0, 0.0033).mill([{x:.022,y:.020,z:-.190,w:.008,h:.017,d:.060,radius:.003},{x:-.022,y:.025,z:-.095,w:.006,h:.007,d:.058,radius:.002}]);
  b.name('Super-V lower housing').profile([[-0.278, 0.010], [-0.096, 0.010], [-0.055, -0.036], [-0.070, -0.111], [-0.118, -0.111], [-0.146, -0.066], [-0.249, -0.066], [-0.278, -0.048]], 0.049, WM.poly, 0, 0.0034).mill([-1,1].map(side=>({x:side*.0245,y:-.038,z:-.196,w:.004,h:.021,d:.107,radius:.004})));
  rail(b, 0.019, -0.267, 0.050, 0.030);
  for (const side of [-1, 1]) {
    for (const [z, y] of [[0.009, 0.014], [-0.075, 0.013], [-0.236, 0.004], [-0.092, -0.078], [-0.247, -0.043]]) screw(b, side * (y < 0.005 ? 0.0248 : 0.022), y, z, 0.0030);
    b.name('receiver mould seam').box(0.0014, 0.0018, 0.186, WM.midSteel, side * 0.0216, 0.036, -0.124);
    stamp(b, 5, side * 0.0218, 0.041, -0.154, 0.131, 0.0068);
  }
  for (const side of [-1, 1]) {
    b.name('upper receiver machined shoulder').profile([[-0.265, 0.038], [0.014, 0.038], [0.023, 0.030], [0.015, 0.044], [-0.257, 0.044]], 0.0022, WM.poly, side * 0.0208, 0.0004);
    b.name('Super-V ribbed forward shoulder').profile([[-0.271, -0.013], [-0.259, -0.015], [-0.259, -0.051], [-0.269, -0.042]], 0.0026, WM.poly, side * 0.0240, 0.0005);
    b.name('lower service plate reinforcing land').profile([[-0.117, -0.060], [-0.089, -0.062], [-0.093, -0.084], [-0.112, -0.087]], 0.0018, WM.midSteel, side * 0.0243, 0.0003);
    b.name('receiver lock pin').cyl(0.0033, 0.0033, 0.0022, WM.midSteel, side * 0.023, 0.018, 0.013, 0, 0, HALF_PI, 20);
    stamp(b, 10, side * 0.0224, 0.009, -0.035, 0.032, 0.0037);
  }
  b.name('bolt release pad').profile([[-0.181, -0.032], [-0.153, -0.032], [-0.153, -0.025], [-0.177, -0.021]], 0.0040, WM.darkSteel, -0.026, 0.0007);
  for (let i = 0; i < 4; i++) b.name('bolt release serration').box(0.0011, 0.007, 0.0015, WM.midSteel, -0.028, -0.028, -0.177 + i * 0.006);
  b.name('contoured grip backstrap').loft([[0.044, 0.029, 0.020, 0.026], [0.090, 0.044, 0.035, 0.029], [0.114, 0.047, 0.038, 0.029]], WM.grip, 0.57, 0, 'y');
  b.name('ejection port carrier').box(0.0012, 0.012, 0.045, WM.midSteel, 0.0184, 0.019, -0.193);
  b.name('bolt release').box(0.004, 0.016, 0.023, WM.darkSteel, -0.026, -0.033, -0.165);
  b.name('selector pivot').cyl(0.004, 0.004, 0.003, WM.steel, -0.0225, 0.003, -0.009, 0, 0, HALF_PI, 16);
  b.name('selector lever').box(0.003, 0.004, 0.018, WM.darkSteel, -0.023, -0.001, -0.005, 0.45);
  pistolGrip(b, 0.007, -0.023, 0.096, 0.032, WM.grip, 0.020);
  triggerGuard(b, -0.014, -0.083, -0.025, -0.078, WM.poly);
  sideRail(b, -0.023, 0.016, -0.241, 0.058);
  sideRail(b, 0.023, 0.016, -0.241, 0.058);
  verticalGrip(foregrip.b, -0.265, -0.054, 0.066);
  charging.b.name('charging track').box(0.002, 0.006, 0.055, WM.dark, -0.022, 0.025, -0.095);
  charging.b.name('charging hinge').cyl(0.005, 0.005, 0.013, WM.darkSteel, -0.027, 0.025, -0.074, 0, 0, HALF_PI, 16);
  charging.b.name('charging paddle').box(0.014, 0.012, 0.028, WM.dark, -0.034, 0.024, -0.072);

  const s = stock.b;
  s.name('sidefold hinge').box(0.038, 0.040, 0.020, WM.darkSteel, 0, 0.013, 0.032);
  s.name('hinge pin').cyl(0.005, 0.005, 0.045, WM.steel, -0.012, 0.013, 0.033, 0, 0, 0, 16);
  s.name('continuous skeleton stock').profile([[0.035, 0.033], [0.210, 0.033], [0.224, 0.017], [0.224, -0.054], [0.201, -0.055], [0.043, -0.012]], 0.030, WM.poly, 0, 0.0027, [[[0.067, 0.018], [0.196, 0.018], [0.207, -0.033], [0.073, -0.002]]]);
  s.name('supported cheek rest').profile([[0.067, 0.029], [0.187, 0.029], [0.196, 0.038], [0.083, 0.042], [0.067, 0.038]], 0.033, WM.grip, 0, 0.001);
  s.name('stock recoil pad').profile([[0.217, 0.029], [0.233, 0.023], [0.237, -0.055], [0.222, -0.059]], 0.034, WM.rubber, 0, 0.0014);
  screw(s, -0.0158, -0.013, 0.211, 0.004);

  barrel.b.name('low bore shroud').tube(0.016, 0.009, 0.041, WM.darkSteel, 0, -0.014, -0.283);
  barrel.b.name('threaded barrel').tube(0.009, 0.0045, 0.069, WM.darkSteel, 0, -0.014, -0.303);
  flashHider(a, -0.335, -0.014, 0.018, 0.0105);
  ironSights(a, -0.007, -0.257, 0.057, 0.057, 0.082);
  magazine(mag.b, { width: 0.026, depth: 0.037, length: 0.146, bend: 0.008, material: WM.darkSteel, ribs: 2 });
  mag.group.position.set(0, -0.053, -0.200);
  return a.finish({ mag: mag.group, handle: charging.group, sightY: 0.082,
    sockets: { muzzle: [0, -0.014, -0.335], barrel: [0, -0.014, -0.278], optic: [0, 0.057, -0.120], magazine: [0, -0.053, -0.200], underbarrel: [0, -0.054, -0.265], stock: [0, 0.013, 0.025], rail: [-0.027, 0.016, -0.241] },
    muzzleTip: [0, -0.014, -0.357], arms: { fore: [0, -0.086, -0.265], grip: [0.004, -0.080, 0.020], mag: [0, -0.173, -0.205], fa: [-0.034, 0.024, -0.072] },
  });
}
