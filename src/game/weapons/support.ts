import { WM, type WeaponModel } from './core';
import { HALF_PI, WeaponAssembly, bipod, flashHider, ironSights, magazine, pistolGrip, rail, screw, sideRail, stamp, telescopicSight, triggerGuard } from './furniture';

/** AWM: one contiguous thumbhole chassis, long free-float barrel and ring-mounted glass. */
export function buildAWM(): WeaponModel {
  const a = new WeaponAssembly('AWM'), b = a.body;
  const mag = a.part('magazine', '338 box magazine');
  const pod = a.part('underbarrel', 'AWM bipod');
  const optic = a.part('optic', 'AWM telescopic sight');
  const bolt = a.moving('AWM bolt and handle');
  const brake = a.part('muzzle', 'AI two-chamber muzzle brake');
  const thumbhole: [number,number][] = Array.from({length:40},(_,i)=>{const t=i/40*Math.PI*2;return [.065+Math.cos(t)*.032,-.039+Math.sin(t)*.026];});
  b.name('continuous thumbhole chassis').profile([[-0.451, -0.025], [-0.451, 0.009], [-0.430, 0.017], [-0.238, 0.017], [-0.219, 0.027], [-0.030, 0.027], [0.023, 0.018], [0.212, 0.018], [0.246, 0.025], [0.250, -0.080], [0.224, -0.083], [0.103, -0.053], [0.023, -0.096], [-0.017, -0.096], [-0.035, -0.035], [-0.221, -0.035], [-0.247, -0.025]], 0.040, WM.od, 0, 0.0045, [thumbhole]).mill([-1,1].flatMap(side=>[[-.420,-.013],[-.265,-.013],[-.177,-.015],[-.032,-.005],[.199,-.018]].map(([z,y])=>({x:side*.0205,y,z,w:.004,h:.010,d:.010,bore:true}))));
  b.name('chassis bedding spine').box(0.025, 0.013, 0.422, WM.darkSteel, 0, -0.019, -0.226);
  for (const side of [-1, 1]) {
    b.name('thumbhole grip panel').profile([[-0.016, -0.026], [0.010, -0.024], [0.022, -0.081], [0.012, -0.089], [-0.010, -0.088], [-0.021, -0.042]], 0.0018, WM.grip, side * 0.020, 0.0004);
    for (const [z, y] of [[-0.420, -0.013], [-0.265, -0.013], [-0.177, -0.015], [-0.032, -0.005], [0.199, -0.018], [0.014, -0.081]]) screw(b, side * (z===.014 ? .0204 : .0189), y, z, .0027);
    for (let i = 0; i < 3; i++) b.name('AI forend recessed vent').profile([[-0.280 - i * 0.053, 0.009], [-0.319 - i * 0.053, 0.009], [-0.318 - i * 0.053, -0.001], [-0.281 - i * 0.053, -0.001]], 0.001, WM.dark, side * 0.020, 0.0002);
    stamp(b, 3, side * 0.0203, 0.006, -0.150, 0.096, 0.006);
  }
  for (const side of [-1, 1]) {
    const ports = Array.from({ length: 3 }, (_, i) => [[-0.280 - i * 0.053, 0.009], [-0.319 - i * 0.053, 0.009], [-0.318 - i * 0.053, -0.001], [-0.281 - i * 0.053, -0.001]] as [number, number][]);
    b.name('sculpted AI forend shell').profile([[-0.444, -0.018], [-0.444, 0.010], [-0.432, 0.015], [-0.253, 0.013], [-0.242, 0.006], [-0.253, -0.018]], 0.0040, WM.od, side * 0.0202, 0.00075, ports);
    b.name('chassis moulded lower ridge').profile([[-0.438, -0.019], [-0.251, -0.019], [-0.244, -0.022], [-0.431, -0.024]], 0.0020, WM.od, side * 0.0201, 0.00035);
    b.name('rear stock sling escutcheon').tube(0.0052, 0.0032, 0.0024, WM.darkSteel, side * 0.0201, -0.045, 0.205, 0, 0, HALF_PI);
  }
  b.name('buttpad spacer').box(0.041, 0.102, 0.008, WM.darkSteel, 0, -0.027, 0.251);
  b.name('buttpad second spacer').box(0.042, 0.102, 0.007, WM.od, 0, -0.027, 0.258);
  b.name('recoil pad').box(0.044, 0.105, 0.023, WM.rubber, 0, -0.027, 0.272);
  for (const z of [0.080, 0.175]) b.name('cheekpiece support post').cyl(0.005, 0.005, 0.026, WM.darkSteel, 0, 0.026, z, 0, 0, 0, 16);
  b.name('adjustable cheekpiece').loft([[0.055, 0.044, 0.033, 0.028], [0.077, 0.056, 0.031, 0.043], [0.181, 0.054, 0.031, 0.043], [0.201, 0.041, 0.033, 0.031]], WM.od, 0.53);
  b.name('cheekpiece adjust wheel').cyl(0.0055, 0.0055, 0.045, WM.dark, 0, 0.013, 0.173, 0, 0, HALF_PI, 20);
  triggerGuard(b, -0.029, -0.109, -0.030, -0.068);
  b.name('magazine latch').box(0.009, 0.017, 0.014, WM.darkSteel, 0, -0.039, -0.111);

  b.name('cylindrical action').cyl(0.018, 0.018, 0.224, WM.darkSteel, 0, 0.035, -0.122, HALF_PI, 0, 0, 28);
  b.name('receiver rail bedding').box(0.026, 0.007, 0.211, WM.dark, 0, 0.050, -0.122);
  rail(b, -0.028, -0.214, 0.053, 0.030);
  b.name('ejection cutout').box(0.0014, 0.012, 0.058, WM.dark, 0.0177, 0.037, -0.116);
  b.name('bolt raceway').box(0.0014, 0.008, 0.047, WM.steel, 0.0183, 0.037, -0.115);
  b.name('barrel tenon').cyl(0.017, 0.014, 0.034, WM.darkSteel, 0, 0.035, -0.240, HALF_PI, 0, 0, 24);
  b.name('open tapered free-float barrel').turned([[0.010, -0.2455], [0.012, 0.2455], [0.0045, 0.2455], [0.0045, -0.2455], [0.010, -0.2455]], WM.steel, 0, 0.035, -0.484, 32);
  bolt.b.name('bolt shroud').cyl(0.014, 0.014, 0.028, WM.darkSteel, 0, 0.035, -0.004, HALF_PI, 0, 0, 24);
  bolt.b.name('bolt lever root').rod([0.009, 0.035, -0.030], [0.031, 0.028, -0.023], 0.0048, WM.steel);
  bolt.b.name('downturned bolt handle').rod([0.031, 0.028, -0.023], [0.044, 0.012, -0.019], 0.0048, WM.steel);
  bolt.b.name('bolt knob').sph(0.009, WM.dark, 0.045, 0.010, -0.018, 1, 1.2, 1);
  b.name('safety lever').box(0.004, 0.006, 0.020, WM.steel, -0.017, 0.040, -0.027);
  // Two open chambers between connected top/bottom webs; the bore is never a black cylinder cap.
  const r = brake.b;
  r.name('brake top web').box(0.032, 0.005, 0.071, WM.darkSteel, 0, 0.048, -0.759);
  r.name('brake lower web').box(0.032, 0.005, 0.071, WM.darkSteel, 0, 0.022, -0.759);
  for (const z of [-0.727, -0.748, -0.772, -0.791]) r.name('ported brake baffle').section([[-0.016, -0.014], [0.016, -0.014], [0.016, 0.014], [-0.016, 0.014]], 0.006, WM.darkSteel, 0, 0.035, z, { y: 0, radius: 0.0055 });
  r.name('brake shoulder').tube(0.014, 0.009, 0.010, WM.darkSteel, 0, 0.035, -0.724);
  bipod(pod.b, 0, 0, 0.120);
  pod.group.position.set(0,-.028,-.431); pod.group.rotation.x = HALF_PI;
  telescopicSight(optic.b, optic.group, 0.060, 0.097, -0.120, a.adsHidden);
  magazine(mag.b, { width: 0.027, depth: 0.068, length: 0.052, material: WM.darkSteel, ribs: 2 });
  mag.group.position.set(0, -0.026, -0.158);
  return a.finish({ mag: mag.group, handle: bolt.group, optic: optic.group, sightY: 0.097,
    sockets: { muzzle: [0, 0.035, -0.726], optic: [0, 0.060, -0.120], magazine: [0, -0.026, -0.158], underbarrel: [0, -0.028, -0.431], rail: [-0.022, -0.009, -0.329] },
    muzzleTip: [0, 0.035, -0.800], arms: { fore: [0, -0.030, -0.339], grip: [0.004, -0.064, 0.006], mag: [0, -0.071, -0.158], fa: [0.045, 0.010, -0.018] },
  });
}

/** SPAS: perforated heat shield above a single sliding ribbed pump; sheet-metal folding stock. */
export function buildSPAS12(): WeaponModel {
  const a = new WeaponAssembly('SPAS-12'), b = a.body;
  const stock = a.part('stock', 'SPAS folding stock');
  const pump = a.moving('sliding pump');
  const tubeCap = a.part('magazine', 'factory tube cap');
  b.name('SPAS receiver').profile([[-0.212, -0.029], [-0.212, 0.025], [-0.195, 0.041], [0.056, 0.041], [0.080, 0.022], [0.077, -0.021], [0.050, -0.030]], 0.050, WM.darkSteel, 0, 0.0031);
  b.name('receiver end plate').box(0.047, 0.048, 0.014, WM.midSteel, 0, 0.005, 0.080);
  b.name('SPAS optic saddle').box(.029,.009,.064,WM.darkSteel,0,.0445,-.074);
  b.name('SPAS rear sight dovetail').box(.026,.009,.027,WM.darkSteel,0,.0445,.020);
  for (const side of [-1, 1]) {
    for (const z of [-0.187, -0.043, 0.039]) screw(b, side * 0.0254, -0.012, z, 0.0030);
    stamp(b, 6, side * 0.0254, 0.028, -0.060, 0.114, 0.007);
  }
  b.name('ejection port recess').box(0.0016, 0.019, 0.082, WM.dark, 0.0254, 0.012, -0.120);
  b.name('bolt carrier').box(0.0014, 0.012, 0.067, WM.steel, 0.0262, 0.012, -0.123);
  b.name('charging handle stem').box(0.018, 0.009, 0.008, WM.steel, 0.033, 0.009, -0.090);
  b.name('charging knob').cyl(0.005, 0.005, 0.010, WM.darkSteel, 0.042, 0.009, -0.090, 0, 0, HALF_PI, 16);
  triggerGuard(b, -0.008, -0.080, -0.026, -0.066);
  pistolGrip(b, 0.023, -0.027, 0.097, 0.033, WM.grip, 0.029);
  for(let i=0;i<9;i++) {
    const y=-.049-i*.008, z=.023+.029*((-y-.027)/.097);
    b.name('SPAS grip wrap rib').loft([[-y-.0015,z+.018,z-.014,.035],[-y+.0015,z+.018,z-.014,.035]],WM.poly,.52,0,'y');
  }
  b.name('crossbolt safety').cyl(0.0038, 0.0038, 0.054, WM.steel, 0, -0.022, -0.028, 0, 0, HALF_PI, 16);
  const slots = Array.from({length:9},(_,i)=>({x:0,y:.030,z:-.232-i*.030,w:.060,h:.007,d:.023,radius:.0033}));
  const shield: [number,number][]=[[-.022,.007],[-.022,.025],[-.017,.038],[-.008,.043],[.008,.043],[.017,.038],[.022,.025],[.022,.007],[.018,.007],[.018,.024],[.013,.034],[.007,.038],[-.007,.038],[-.013,.034],[-.018,.024],[-.018,.007]];
  b.name('slotted rolled SPAS heat shield').section(shield,.305,WM.darkSteel,0,0,-.358).mill(slots);
  b.name('open shotgun barrel').tube(0.0115, 0.008, 0.427, WM.darkSteel, 0, 0.017, -0.411, HALF_PI, 0, 0, 28);
  b.name('magazine tube').cyl(0.010, 0.010, 0.391, WM.darkSteel, 0, -0.015, -0.395, HALF_PI, 0, 0, 24);
  tubeCap.b.name('magazine end cap').cyl(0.012, 0.012, 0.016, WM.dark, 0, -0.015, -0.590, HALF_PI, 0, 0, 24);
  b.name('front barrel/tube band').box(0.023, 0.050, 0.016, WM.darkSteel, 0, 0.003, -0.531);
  b.name('front sight saddle').box(0.018, 0.020, 0.021, WM.darkSteel, 0, 0.031, -0.531);
  const p = pump.b;
  p.name('continuous pump shell').loft([[-0.466, -0.008, -0.033, 0.035], [-0.449, -0.003, -0.055, 0.052], [-0.284, -0.003, -0.055, 0.052], [-0.268, -0.005, -0.047, 0.049], [-0.250, -0.008, -0.030, 0.033]], WM.grip, 0.45);
  for (let i = 0; i < 10; i++) {
    const z = -0.283 - i * 0.0175;
    p.name('rounded pump rib').loft([[z - 0.0035, -0.005, -0.054, 0.053], [z - 0.002, -0.002, -0.058, 0.058], [z + 0.002, -0.002, -0.058, 0.058], [z + 0.0035, -0.005, -0.054, 0.053]], WM.poly, 0.47);
  }
  for (const side of [-1, 1]) p.name('pump action bar').box(0.004, 0.006, 0.120, WM.steel, side * 0.018, -0.013, -0.253);
  // Factory SPAS reference: clean steel receiver, not an added bright-red shell saddle.
  b.name('bolt release rocker').profile([[-0.185, 0.005], [-0.166, 0.005], [-0.161, -0.010], [-0.171, -0.019], [-0.181, -0.013]], 0.0032, WM.midSteel, -0.025, 0.0006);
  screw(b, -0.026, -0.004, -0.174, 0.0038);
  b.name('safety lever').box(0.004, 0.007, 0.022, WM.darkSteel, -0.026, -0.014, -0.031, -0.20);
  for (const side of [-1, 1]) {
    b.name('receiver machined shoulder').profile([[-0.195, 0.030], [0.052, 0.030], [0.066, 0.017], [0.055, 0.034], [-0.187, 0.037]], 0.0020, WM.midSteel, side * 0.0243, 0.0003);
    b.name('trigger group seam').box(0.0013, 0.0017, 0.120, WM.midSteel, side * 0.025, -0.024, -0.039);
  }
  const s = stock.b;
  s.name('folding hinge').cyl(0.010, 0.010, 0.054, WM.steel, 0, 0.022, 0.087, 0, 0, HALF_PI, 20);
  for (const side of [-1, 1]) {
    s.name('perforated stock strut').profile([[0.076, 0.033], [0.268, 0.031], [0.298, 0.013], [0.299, -0.021], [0.275, -0.020], [0.080, 0.005]], 0.005, WM.midSteel, side * 0.020, 0.0005, [[[0.106,0.024],[0.253,0.021],[0.266,0.008],[0.256,0.002],[0.114,0.009]]]);
    screw(s, side * 0.027, 0.022, 0.087, 0.006);
  }
  s.name('stock buttplate').profile([[0.286, 0.025], [0.303, 0.019], [0.305, -0.065], [0.291, -0.066]], 0.045, WM.midSteel, 0, 0.001);
  s.name('rubber pad').box(0.039, 0.079, 0.010, WM.rubber, 0, -0.022, 0.305);
  flashHider(a, -0.620, 0.017, 0.015, 0.0125, false);
  ironSights(a, 0.020, -0.531, 0.048, 0.040, 0.073);
  const model = a.finish({ mag: pump.group, sightY: 0.073,
    sockets: { muzzle: [0, 0.017, -0.620], optic: [0, 0.048, -0.074], magazine: [0, -0.015, -0.589], underbarrel: [0, -0.053, -0.366], stock: [0, 0.022, 0.078], rail: [-0.023, 0.023, -0.482] },
    muzzleTip: [0, 0.017, -0.639], arms: { fore: [0, -0.041, -0.360], grip: [0.004, -0.082, 0.040], mag: [0, -0.028, -0.082], fa: [0.042, 0.009, -0.090] },
  });
  pump.group.add(model.sockets.underbarrel!);
  return model;
}

/** M249: actual removable ammunition box, hinged cover, linked rounds and supported carry handle. */
export function buildM249(): WeaponModel {
  const a = new WeaponAssembly('M249 SAW'), b = a.body;
  const stock = a.part('stock', 'M249 stock');
  const barrel = a.part('barrel', 'quick-change barrel');
  const pod = a.part('underbarrel', 'SAW bipod');
  const mag = a.part('magazine', 'ammunition box and belt');
  const cover = a.moving('hinged feed cover');
  b.name('stamped SAW receiver').profile([[-0.288, -0.030], [-0.288, 0.026], [-0.267, 0.038], [0.031, 0.038], [0.049, 0.020], [0.049, -0.023], [-0.008, -0.030]], 0.052, WM.darkSteel, 0, 0.0014);
  b.name('feed tray').box(0.062, 0.006, 0.139, WM.midSteel, 0, 0.034, -0.125);
  b.name('recessed feed tray liner').box(0.037, 0.0018, 0.153, WM.dark, 0, 0.0385, -0.133);
  for (const side of [-1, 1]) {
    b.name('feed tray guide rail').box(0.003, 0.004, 0.145, WM.midSteel, side * 0.019, 0.0394, -0.132);
    b.name('feed guide stop').box(0.009, 0.005, 0.012, WM.darkSteel, side * 0.017, 0.040, -0.062);
  }
  b.name('feed tray cartridge channel').box(0.010, 0.0014, 0.112, WM.midSteel, 0, 0.0395, -0.134);
  b.name('feed throat').box(0.018, 0.023, 0.072, WM.dark, -0.031, 0.019, -0.140);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) screw(b, side * 0.0264, -0.009, 0.008 - i * 0.049, 0.0026);
    b.name('stamped receiver rib').box(0.002, 0.005, 0.244, WM.midSteel, side * 0.026, 0.009, -0.125);
    stamp(b, 7, side * 0.0265, 0.022, -0.035, 0.080, 0.006);
  }
  for (const side of [-1, 1]) {
    b.name('SAW receiver lower stamping').profile([[-0.279, -0.016], [-0.017, -0.016], [0.034, -0.012], [0.027, -0.025], [-0.267, -0.029]], 0.0026, WM.midSteel, side * 0.0252, 0.0005);
    b.name('feed tray guide flange').profile([[-0.220, 0.031], [-0.062, 0.031], [-0.059, 0.021], [-0.218, 0.021]], 0.0045, WM.darkSteel, side * 0.027, 0.0008);
    b.name('feed mechanism hinge').cyl(0.005, 0.005, 0.004, WM.midSteel, side * 0.0275, 0.030, -0.229, 0, 0, HALF_PI, 24);
    screw(b, side * 0.0272, -0.020, -0.255, 0.0030);
  }
  b.name('right ejection port').box(0.002, 0.020, 0.077, WM.dark, 0.0264, 0.010, -0.146);
  b.name('ejection shutter').box(0.0016, 0.008, 0.073, WM.midSteel, 0.0273, 0.002, -0.146);
  b.name('charging handle track').box(0.002, 0.005, 0.077, WM.dark, 0.0263, -0.015, -0.062);
  b.name('charging handle stem').box(0.022, 0.007, 0.011, WM.steel, 0.034, -0.015, -0.030);
  b.name('charging handle grip').box(0.012, 0.015, 0.020, WM.grip, 0.044, -0.018, -0.030);
  triggerGuard(b, -0.009, -0.083, -0.028, -0.066);
  pistolGrip(b, 0.018, -0.026, 0.090, 0.033, WM.grip, 0.025);
  b.name('receiver end plate').box(0.048, 0.053, 0.014, WM.darkSteel, 0, 0.002, 0.050);
  b.name('box hanger').box(0.030, 0.016, 0.077, WM.midSteel, 0, -0.031, -0.160);
  // Cover pivot is at its front hinge. The engine rotates it instead of detaching it vertically.
  cover.group.position.set(0, 0.040, -0.238);
  cover.group.userData.hinged = true;
  cover.b.name('feed cover shell').loft([[0, 0.010, -0.004, 0.044], [0.016, 0.020, -0.004, 0.052], [0.153, 0.019, -0.004, 0.051], [0.188, 0.015, -0.004, 0.047], [0.202, 0.009, -0.003, 0.037]], WM.darkSteel, 0.40);
  cover.b.name('cover hinge pin').cyl(0.005, 0.005, 0.057, WM.steel, 0, 0, 0, 0, 0, HALF_PI, 16);
  rail(cover.b, 0.189, 0.010, 0.017, 0.031);
  // The lid's underside is visible during reload: retain the feed-pawl plate and mechanism.
  cover.b.name('feed cover inner plate').box(0.036, 0.003, 0.157, WM.midSteel, 0, -0.0045, 0.105);
  for (const side of [-1, 1]) {
    cover.b.name('underside stiffening rail').box(0.0035, 0.005, 0.147, WM.darkSteel, side * 0.018, -0.005, 0.105);
    cover.b.name('feed pawl').profile([[0.040, -0.005], [0.083, -0.005], [0.089, -0.011], [0.082, -0.017], [0.073, -0.014], [0.048, -0.013]], 0.007, WM.darkSteel, side * 0.010, 0.0008);
    cover.b.name('feed pawl stop').box(0.008, 0.004, 0.009, WM.steel, side * 0.010, -0.015, 0.078);
  }
  cover.b.name('feed lever pivot').cyl(0.004, 0.004, 0.033, WM.steel, 0, -0.008, 0.050, 0, 0, HALF_PI, 24);
  cover.b.name('feed lever').profile([[0.100, -0.006], [0.171, -0.006], [0.173, -0.011], [0.116, -0.013], [0.098, -0.010]], 0.010, WM.darkSteel, 0, 0.0007);
  cover.b.name('cover latch').box(0.022, 0.013, 0.014, WM.darkSteel, 0, 0.006, 0.195);

  const m = mag.b;
  m.name('ammo box shell').profile([[-0.066, 0.003], [0.063, 0.003], [0.069, -0.088], [0.054, -0.101], [-0.062, -0.101], [-0.068, -0.085]], 0.084, WM.od, 0, 0.0032);
  m.name('box lid').box(0.087, 0.009, 0.139, WM.darkSteel, 0, 0.001, 0);
  m.name('box belly seam').box(0.085, 0.004, 0.131, WM.dark, 0, -0.085, 0);
  for (const side of [-1, 1]) {
    m.name('ammo box pressed panel').profile([[-0.051, -0.018], [0.049, -0.018], [0.048, -0.077], [-0.051, -0.077]], 0.0024, WM.od, side * 0.042, 0.00045);
    m.name('box latch').box(0.004, 0.025, 0.013, WM.steel, side * 0.043, -0.014, 0.044);
  }
  for (const side of [-1, 1]) {
    m.name('ammo can pressed upper seam').box(0.0016, 0.002, 0.113, WM.tan, side * 0.0431, -0.014, 0);
    stamp(m, 12, side * 0.0433, -0.035, 0, 0.100, 0.009);
    stamp(m, 13, side * 0.0433, -0.052, 0, 0.083, 0.006);
  }
  mag.group.position.set(0, -0.037, -0.160);
  // Curved linked belt ends at the box's lip; each round is joined to its neighbours.
  const path: [number, number][] = [[-0.025, 0.055], [-0.036, 0.057], [-0.047, 0.051], [-0.055, 0.041], [-0.059, 0.029], [-0.058, 0.017], [-0.051, 0.008]];
  path.forEach(([x, y], i) => {
    m.name('belt cartridge').cyl(0.0035, 0.0035, 0.030, WM.brass, x, y, 0.015, HALF_PI, 0, 0, 12);
    m.name('belt projectile').cyl(0.0006, 0.0035, 0.011, WM.steel, x, y, -0.005, -HALF_PI, 0, 0, 12);
    m.name('belt link').box(0.008, 0.005, 0.007, WM.darkSteel, x, y, 0.022);
    if (i) m.name('connected belt link').rod([path[i - 1][0], path[i - 1][1], 0.022], [x, y, 0.022], 0.0015, WM.darkSteel, 0.0015, 8);
  });
  m.name('belt box feed guide').box(0.009, 0.026, 0.052, WM.darkSteel, -0.043, 0.007, 0.013);

  const vents = Array.from({ length: 4 }, (_, i) => {
    const z = -0.307 - i * 0.032;
    return [[z + 0.009, -0.016], [z - 0.009, -0.016], [z - 0.009, -0.028], [z + 0.009, -0.028]] as [number, number][];
  });
  b.name('vented SAW forend').profile([[-0.276, -0.004], [-0.435, -0.004], [-0.443, -0.024], [-0.427, -0.044], [-0.292, -0.044], [-0.276, -0.030]], 0.049, WM.poly, 0, 0.0014, vents);
  for(const side of [-1,1]) {
    for(let i=0;i<3;i++) b.name('SAW horizontal pressed reinforcement').profile([[-.429,-.010-i*.010],[-.298,-.010-i*.010],[-.290,-.014-i*.010],[-.418,-.015-i*.010]],.003,WM.darkSteel,side*.024,.0005);
    b.name('SAW trunnion plate').profile([[-.298,.033],[-.270,.030],[-.271,-.038],[-.298,-.038]],.005,WM.midSteel,side*.026,.0008);
    for(const y of [.023,-.027]) screw(b,side*.028,y,-.285,.0037);
  }
  b.name('fixed barrel trunnion').cyl(0.017, 0.017, 0.029, WM.darkSteel, 0, 0.016, -0.286, HALF_PI, 0, 0, 24);
  const r = barrel.b;
  r.name('open quick-change barrel').tube(0.011, 0.004, 0.346, WM.darkSteel, 0, 0.016, -0.453, HALF_PI, 0, 0, 28);
  r.name('gas piston tube').cyl(0.006, 0.006, 0.245, WM.darkSteel, 0, -0.010, -0.418, HALF_PI, 0, 0, 20);
  r.name('gas block').box(0.024, 0.039, 0.027, WM.darkSteel, 0, 0.009, -0.546);
  r.name('gas regulator').cyl(0.005, 0.005, 0.013, WM.steel, 0, 0.030, -0.546, 0, 0, 0, 16);
  r.name('carry handle journal').tube(0.015, 0.009, 0.018, WM.darkSteel, 0, 0.016, -0.347);
  r.name('carry handle arm').rod([0.006, 0.026, -0.347], [0.023, 0.058, -0.354], 0.0045, WM.steel);
  r.name('carry handle grip').loft([[-0.441, 0.063, 0.053, 0.012], [-0.434, 0.066, 0.050, 0.018], [-0.359, 0.066, 0.050, 0.018], [-0.350, 0.063, 0.053, 0.012]], WM.grip, 0.6, 0.023);
  for (let i = 0; i < 5; i++) r.name('carry handle groove').box(0.017, 0.014, 0.002, WM.dark, 0.023, 0.058, -0.365 - i * 0.014);
  bipod(pod.b,0,0,.132); pod.group.position.set(0,-.041,-.424); pod.group.rotation.x=HALF_PI;
  sideRail(b, -0.026, -0.017, -0.367, 0.106);
  const sights = ironSights(a, -0.060, -0.546, 0.064, 0.030, 0.087, true);
  cover.group.attach(sights.rear);
  // attach() preserves world space; matrices must be current before the reparent.
  sights.rear.position.set(0, -0.040, 0.238);
  flashHider(a, -0.624, 0.016, 0.043, 0.012);
  const s = stock.b;
  s.name('stock shoulder').box(0.040, 0.045, 0.029, WM.darkSteel, 0, 0.003, 0.057);
  s.name('solid sculpted SAW stock').loft([[.068,.025,-.023,.039],[.092,.014,-.028,.030],[.126,.007,-.032,.028],[.166,.009,-.043,.036],[.207,.031,-.067,.050],[.247,.014,-.063,.043]],WM.poly,.50);
  s.name('rubber stock pad').profile([[0.239, 0.024], [0.255, 0.017], [0.258, -0.065], [0.242, -0.069]], 0.050, WM.rubber, 0, 0.0023);
  screw(s, -0.0235, -0.014, 0.235, 0.004);
  s.name('stock sling socket').tube(0.0058, 0.0036, 0.004, WM.darkSteel, -0.0240, -0.042, 0.201, 0, 0, HALF_PI);
  const model = a.finish({ mag: mag.group, handle: cover.group, sightY: 0.087,
    sockets: { muzzle: [0, 0.016, -0.624], barrel: [0, 0.016, -0.282], optic: [0, 0.064, -0.141], magazine: [0, -0.037, -0.160], underbarrel: [0, -0.041, -0.424], stock: [0, 0.003, 0.045], rail: [-0.030, -0.017, -0.367] },
    muzzleTip: [0, 0.016, -0.672], arms: { fore: [0, -0.048, -0.352], grip: [0.004, -0.080, 0.033], mag: [0, -0.111, -0.160], fa: [0, 0.052, -0.080] },
  });
  model.group.updateMatrixWorld(true);
  cover.group.attach(model.sockets.optic!);
  return model;
}
