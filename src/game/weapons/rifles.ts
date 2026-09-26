import { WM, type WeaponModel } from './core';
import { HALF_PI, WeaponAssembly, flashHider, ironSights, magazine, pistolGrip, rail, screw, sideRail, stamp, triggerGuard } from './furniture';

/** HK-pattern carbine: forged receivers, vented quad rail and telescopic stock. */
export function buildM4(): WeaponModel {
  const a = new WeaponAssembly('M416'), b = a.body;
  const stock = a.part('stock', 'telescopic stock'), barrel = a.part('barrel', 'barrel and gas block');
  const mag = a.part('magazine', 'STANAG magazine'), charging = a.moving('charging handle');
  // A rounded bolt tunnel over a separate, waisted AR lower. Not the SCAR's long box extrusion.
  const arch: [number, number][] = [[-0.018, -0.012], [0.018, -0.012], [0.019, -0.003]];
  for (let i = 0; i <= 20; i++) { const t = i / 20 * Math.PI; arch.push([0.019 * Math.cos(t), 0.001 + 0.016 * Math.sin(t)]); }
  b.name('AR cylindrical bolt housing').section(arch, 0.200, WM.darkSteel, 0, 0.020, -0.114)
    .mill([{ x: 0.020, y: 0.021, z: -0.111, w: 0.011, h: 0.015, d: 0.065, radius: 0.002 }]);
  b.name('AR forged lower').profile([[-0.211, 0.009], [-0.035, 0.009], [-0.016, 0.022], [-0.006, 0.020], [-0.007, -0.002], [-0.028, -0.018], [-0.050, -0.020], [-0.066, -0.030], [-0.109, -0.028], [-0.119, -0.043], [-0.207, -0.043]], 0.035, WM.darkSteel, 0, 0.0023);
  b.name('AR flared magazine well').profile([[-0.211, -0.003], [-0.122, -0.003], [-0.123, -0.032], [-0.130, -0.047], [-0.207, -0.044]], 0.042, WM.darkSteel, 0, 0.0020)
    .mill([{x:0,y:-0.040,z:-0.165,w:0.029,h:0.032,d:0.057,radius:0.0015}]);
  for (const side of [-1, 1]) {
    // Narrow raised forging fences, not a full-size decorative polygon glued to the receiver.
    b.name('AR magazine catch fence').profile([[-0.122, 0.001], [-0.097, 0.001], [-0.095, -0.011], [-0.112, -0.018], [-0.119, -0.014]], 0.004, WM.darkSteel, side * 0.017, 0.0007,
      [[[-0.116,-0.003],[-0.102,-0.003],[-0.101,-0.010],[-0.113,-0.013]]]);
    b.name('AR takedown pin boss').cyl(0.0052, 0.0052, 0.003, WM.darkSteel, side * 0.018, 0.001, -0.029, 0, 0, HALF_PI);
    screw(b, side * 0.0193, 0.001, -0.029, 0.0027);
    screw(b, side * 0.0205, -0.002, -0.201, 0.0029);
    b.name('AR selector drum').cyl(0.0047, 0.0047, 0.0035, WM.midSteel, side * 0.0182, -0.014, -0.067, 0, 0, HALF_PI);
    b.name('AR teardrop selector').profile([[-0.069,-0.009],[-0.063,-0.009],[-0.051,-0.018],[-0.051,-0.022],[-0.057,-0.021],[-0.070,-0.014]], 0.003, WM.darkSteel, side * 0.020, 0.0005);
    b.name('AR mag release button').box(0.004, 0.008, 0.016, WM.midSteel, side * 0.0185, -0.008, -0.106);
    for(let i=0;i<4;i++) b.name('release checkering').box(0.001,0.0007,0.012,WM.dark,side*0.0206,-0.0105+i*0.0017,-0.106);
    stamp(b, 14, side * 0.0212, -0.016, -0.164, 0.074, 0.022);
    stamp(b, 10, side * 0.0182, -0.005, -0.069, 0.037, 0.0035);
  }
  b.name('AR bolt catch').profile([[-0.102,-0.012],[-0.091,-0.012],[-0.093,0.014],[-0.104,0.014]],0.0045,WM.midSteel,-0.020,0.0008);
  b.name('AR bolt catch thumb pad').box(0.005,0.010,0.013,WM.darkSteel,-0.024,0.012,-0.099);
  b.name('AR exposed bolt').box(0.0018,0.010,0.051,WM.steel,0.0158,0.021,-0.111);
  b.name('AR ejection door').profile([[-0.144,0.011],[-0.079,0.011],[-0.079,0.001],[-0.144,0.001]],0.0022,WM.midSteel,0.0194,0.0004);
  b.name('AR door hinge').cyl(0.0017,0.0017,0.067,WM.steel,0.0202,0.011,-0.111,HALF_PI);
  b.name('AR brass deflector').loft([[-0.080,0.029,0.014,0.005],[-0.070,0.027,0.011,0.019],[-0.061,0.023,0.012,0.003]],WM.darkSteel,0.40,0.021);
  b.name('AR forward assist housing').cyl(0.006,0.0045,0.018,WM.darkSteel,0.025,0.022,-0.045,0,0,HALF_PI);
  b.name('AR forward assist cap').cyl(0.0065,0.006,0.0035,WM.midSteel,0.034,0.022,-0.045,0,0,HALF_PI);
  triggerGuard(b,-0.066,-0.121,-0.026,-0.062,WM.darkSteel,true);
  pistolGrip(b,-0.049,-0.022,0.090,0.032,WM.grip,0.024);
  rail(b,-0.018,-0.211,0.038,0.031);
  // A slim, hollow octagonal quad-rail handguard; round ports are actually machined through it.
  const oct: [number,number][]=[[-.017,-.022],[.017,-.022],[.025,-.012],[.025,.011],[.017,.023],[-.017,.023],[-.025,.011],[-.025,-.012]];
  b.name('M416 hollow quad rail core').section(oct,0.200,WM.darkSteel,0,0.013,-0.318,{y:0,radius:0.017})
    .mill(Array.from({length:9},(_,i)=>({x:0,y:0.027,z:-0.235-i*0.020,w:0.065,h:0.008,d:0.012,radius:0.0038})));
  b.name('AR barrel nut').tube(0.024,0.010,0.018,WM.midSteel,0,0.013,-0.215);
  for(let i=0;i<8;i++) b.name('barrel nut flute').box(0.002,0.003,0.018,WM.dark,Math.sin(i*Math.PI/4)*0.023,0.013+Math.cos(i*Math.PI/4)*0.023,-0.215,0,0,-i*Math.PI/4);
  b.name('seated free floating barrel').cyl(0.0085,0.0085,0.212,WM.darkSteel,0,0.013,-0.317,HALF_PI);
  rail(b,-0.217,-0.420,0.038,0.032);
  sideRail(b,-0.0255,0.004,-0.319,0.178); sideRail(b,0.0255,0.004,-0.319,0.178);
  b.name('handguard bottom spine').box(0.025,0.007,0.198,WM.darkSteel,0,-0.009,-0.318);
  for(let i=0;i<16;i++) b.name('lower dovetail lug').box(0.032,0.005,0.006,WM.darkSteel,0,-0.012,-0.230-i*0.0118);
  const s=stock.b;
  s.name('receiver end plate').box(0.034,0.039,0.007,WM.darkSteel,0,0.011,-0.007);
  s.name('buffer tube').cyl(0.013,0.013,0.171,WM.darkSteel,0,0.017,0.074,HALF_PI);
  s.name('castle nut').tube(0.0165,0.012,0.012,WM.midSteel,0,0.017,0.008);
  s.name('AR triangular stock frame').profile([[0.082,0.026],[0.207,0.026],[0.223,0.010],[0.222,-0.064],[0.207,-0.066],[0.086,-0.021],[0.078,-0.007]],0.029,WM.poly,0,0.0025,
    [[[0.105,-0.003],[0.193,-0.003],[0.207,-0.046],[0.129,-0.023]]]);
  s.name('stock cheek tube').loft([[0.078,0.034,0.009,0.029],[0.091,0.038,0.006,0.043],[0.199,0.035,0.005,0.042],[0.215,0.028,0.005,0.033]],WM.poly,0.38);
  for(const side of [-1,1]){
    s.name('stock release housing').profile([[.096,.005],[.137,.005],[.139,-.014],[.105,-.024],[.097,-.018]],.004,WM.poly,side*.014,.0007);
    s.name('stock latch pin').cyl(.003,.003,.002,WM.midSteel,side*.0165,-.007,.122,0,0,HALF_PI);
    s.name('stock sling slot').profile([[.195,.010],[.213,.007],[.214,-.029],[.205,-.027]],.003,WM.poly,side*.015,.0004,[[[.202,.002],[.209,.001],[.210,-.019],[.205,-.018]]]);
  }
  s.name('adjustment lever').box(.023,.005,.042,WM.darkSteel,0,-.018,.116,-.13);
  s.name('stock recoil pad').profile([[.218,.026],[.234,.021],[.235,-.066],[.218,-.069]],.038,WM.rubber,0,.002);
  for(let i=0;i<9;i++) s.name('buttpad traction rib').box(.033,.0025,.002,WM.grip,0,.016-i*.009,.235);
  const r=barrel.b;
  r.name('open free-float barrel').tube(.009,.004,.158,WM.darkSteel,0,.013,-.492);
  r.name('gas block').tube(.014,.008,.024,WM.darkSteel,0,.013,-.428);
  r.name('piston journal').cyl(.005,.005,.041,WM.darkSteel,0,.031,-.424,HALF_PI);
  r.name('gas block riser').box(.019,.026,.022,WM.darkSteel,0,.024,-.428);
  flashHider(a,-.568,.013,.043);
  ironSights(a,-.043,-.428,.046,.032,.078,true);
  charging.b.name('charging handle stem').box(.019,.005,.036,WM.darkSteel,0,.030,-.014);
  charging.b.name('charging handle wings').box(.049,.008,.012,WM.dark,0,.030,.001);
  magazine(mag.b,{width:.027,depth:.054,length:.140,bend:.022,material:WM.midSteel});
  mag.group.position.set(0,-.033,-.165);
  return a.finish({mag:mag.group,handle:charging.group,sightY:.078,
    sockets:{muzzle:[0,.013,-.568],barrel:[0,.013,-.416],optic:[0,.045,-.110],magazine:[0,-.033,-.165],underbarrel:[0,-.013,-.335],stock:[0,.017,-.013],rail:[-.030,.004,-.320]},
    muzzleTip:[0,.013,-.615],arms:{fore:[0,-.025,-.332],mag:[0,-.147,-.183],fa:[0,.030,0]}});
}

/** Stamped AK with a rounded dust cover, a true banana magazine and shaped walnut furniture. */
export function buildAK47(): WeaponModel {
  const a = new WeaponAssembly('AK-47'), b = a.body;
  const stock = a.part('stock', 'walnut buttstock');
  const barrel = a.part('barrel', 'barrel and gas assembly');
  const mag = a.part('magazine', 'curved steel magazine');
  const charging = a.moving('bolt handle');
  b.name('stamped receiver').profile([[-0.236, 0.026], [-0.009, 0.026], [-0.009, -0.019], [-0.207, -0.024], [-0.236, -0.012]], 0.035, WM.darkSteel, 0, 0.0014);
  for (const side of [-1, 1]) b.name('pressed receiver sidewall').profile([[-0.234, 0.025], [-0.010, 0.025], [-0.010, -0.018], [-0.205, -0.023], [-0.234, -0.011]], 0.0028, WM.darkSteel, side * 0.0182, 0.0005, [[[ -0.151, -0.004], [-0.192, -0.004], [-0.190, -0.015], [-0.154, -0.015]]]);
  b.name('front receiver trunnion').profile([[-.239,-.018],[-.211,-.024],[-.204,.024],[-.209,.035],[-.239,.030]],.041,WM.darkSteel,0,.0014);
  b.name('rear cover retaining block').box(.040,.038,.017,WM.darkSteel,0,.006,-.014);
  for(const side of [-1,1]) {
    b.name('AK stamped lower rim').profile([[-.212,-.023],[-.023,-.019],[-.023,-.016],[-.208,-.020]],.0022,WM.midSteel,side*.019,.00035);
    b.name('AK selector axis rivet').cyl(.0043,.0043,.002,WM.midSteel,side*.020,.013,-.041,0,0,HALF_PI);
  }
  b.name('rounded dust cover').cyl(0.020, 0.020, 0.224, WM.midSteel, 0, 0.025, -0.122, HALF_PI, 0, 0, 24);
  for (const z of [-0.051, -0.115, -0.186]) b.name('pressed dust-cover ridge').tube(0.021, 0.0194, 0.0032, WM.midSteel, 0, 0.025, z);
  b.name('cover lower seam').box(0.039, 0.003, 0.215, WM.dark, 0, 0.025, -0.120);
  b.name('cover release').box(0.012, 0.009, 0.010, WM.steel, 0, 0.031, -0.008);
  for (const side of [-1, 1]) {
    for (const [z, y] of [[-0.031, 0.010], [-0.047, -0.010], [-0.195, 0.010], [-0.216, 0.010], [-0.208, -0.013]]) b.name('domed receiver rivet').sph(0.0027, WM.midSteel, side * 0.0194, y, z, 0.36, 1, 1);
    stamp(b, 1, side * 0.0193, 0.005, -0.111, 0.070, 0.006);
  }
  b.name('selector lever').profile([[-0.042, 0.019], [-0.151, -0.003], [-0.152, -0.011], [-0.041, 0.007]], 0.0026, WM.midSteel, 0.020, 0.0003);
  screw(b, 0.021, 0.013, -0.042, 0.004);
  b.name('side dovetail').box(0.004, 0.010, 0.097, WM.dark, -0.021, 0.010, -0.112);
  b.name('ejection opening').box(0.002, 0.013, 0.075, WM.dark, 0.019, 0.029, -0.141);
  charging.b.name('bolt carrier').box(0.007, 0.010, 0.041, WM.steel, 0.020, 0.030, -0.103);
  charging.b.name('charging stem').box(0.022, 0.008, 0.009, WM.steel, 0.031, 0.029, -0.087);
  charging.b.name('charging tip').box(0.008, 0.012, 0.015, WM.darkSteel, 0.041, 0.029, -0.087);
  pistolGrip(b, -0.048, -0.018, 0.085, 0.031, WM.woodDark, 0.026);
  triggerGuard(b, -0.071, -0.139, -0.020, -0.059, WM.darkSteel);
  b.name('magazine latch').profile([[-0.137, -0.019], [-0.151, -0.019], [-0.152, -0.040], [-0.139, -0.044]], 0.012, WM.darkSteel);

  b.name('lower walnut handguard').loft([[-0.401, 0.010, -0.009, 0.035], [-0.389, 0.012, -0.020, 0.041], [-0.356, 0.010, -0.028, 0.046], [-0.290, 0.009, -0.026, 0.046], [-0.250, 0.011, -0.019, 0.043], [-0.235, 0.012, -0.011, 0.034]], WM.wood, 0.53).mill([-1,1].map(side=>({x:side*.022,y:-.007,z:-.320,w:.005,h:.009,d:.109,radius:.004})));
  b.name('upper walnut gas guard').loft([[-0.384, 0.038, 0.023, 0.025], [-0.373, 0.046, 0.022, 0.033], [-0.267, 0.046, 0.022, 0.033], [-0.253, 0.038, 0.023, 0.025]], WM.wood, 0.62);
  b.name('seated barrel under wood').cyl(0.009, 0.009, 0.177, WM.darkSteel, 0, 0.011, -0.318, HALF_PI);
  b.name('gas tube under guard').cyl(0.006, 0.006, 0.168, WM.darkSteel, 0, 0.034, -0.318, HALF_PI);
  for (const z of [-0.241, -0.394]) b.name('handguard ferrule').box(0.045, 0.032, 0.009, WM.darkSteel, 0, -0.001, z);

  const s = stock.b;
  s.name('walnut stock').loft([[-0.014, 0.023, -0.019, 0.035], [0.010, 0.023, -0.023, 0.033], [0.037, 0.022, -0.029, 0.034], [0.075, 0.021, -0.043, 0.040], [0.145, 0.020, -0.064, 0.044], [0.217, 0.018, -0.076, 0.042], [0.232, 0.014, -0.072, 0.037]], WM.wood, 0.43);
  s.name('stock tang').box(0.014, 0.003, 0.055, WM.darkSteel, 0, 0.023, 0.018);
  s.name('steel buttplate').profile([[0.224, 0.019], [0.234, 0.017], [0.239, -0.076], [0.230, -0.079]], 0.040, WM.darkSteel, 0, 0.001);
  s.name('sling escutcheon').box(0.003, 0.015, 0.027, WM.darkSteel, -0.020, -0.027, 0.159);
  screw(s, -0.021, -0.027, 0.151, 0.0021); screw(s, -0.021, -0.027, 0.168, 0.0021);

  const r = barrel.b;
  r.name('open AK barrel').tube(0.009, 0.0038, 0.235, WM.darkSteel, 0, 0.011, -0.505);
  r.name('exposed gas tube').cyl(0.006, 0.006, 0.058, WM.darkSteel, 0, 0.034, -0.414, HALF_PI);
  r.name('angled gas block').profile([[-0.425, 0.007], [-0.457, 0.007], [-0.449, 0.036], [-0.430, 0.041]], 0.020, WM.darkSteel);
  r.name('gas block collar').tube(0.013, 0.008, 0.023, WM.darkSteel, 0, 0.011, -0.444);
  r.name('front sight tower').profile([[-0.582, 0.004], [-0.608, 0.004], [-0.607, 0.044], [-0.600, 0.057], [-0.590, 0.057], [-0.583, 0.041]], 0.016, WM.darkSteel, 0, 0.0008);
  r.name('sight tower collar').tube(0.012, 0.008, 0.025, WM.darkSteel, 0, 0.011, -0.595);
  const front = a.part('optic', 'AK hooded front sight');
  (a.removable.barrel ??= []).push(front.group);
  front.b.name('hooded front sight').tube(0.0105, 0.0080, 0.013, WM.darkSteel, 0, 0.064, -0.595);
  front.b.name('front blade').box(0.0028, 0.013, 0.004, WM.dark, 0, 0.0585, -0.595);
  const rear = a.part('optic', 'tangent rear sight');
  rear.b.name('tangent sight block').profile([[-0.202, 0.030], [-0.249, 0.030], [-0.240, 0.052], [-0.205, 0.054]], 0.023, WM.darkSteel);
  rear.b.name('tangent leaf').box(0.018, 0.003, 0.054, WM.steel, 0, 0.055, -0.223);
  for (const side of [-1, 1]) rear.b.name('rear notch').box(0.007, 0.008, 0.005, WM.dark, side * 0.006, 0.060, -0.202);
  for (let i = 0; i < 5; i++) rear.b.name('sight range graduation').box(0.010, 0.0007, 0.001, WM.marking, 0, 0.0568, -0.212 - i * 0.006);
  flashHider(a, -0.619, 0.011, 0.039, 0.011);
  magazine(mag.b, { width: 0.029, depth: 0.054, length: 0.171, bend: 0.067, material: WM.darkSteel });
  mag.group.position.set(0, -0.025, -0.178);
  return a.finish({ mag: mag.group, handle: charging.group, sightY: 0.064,
    sockets: { muzzle: [0, 0.011, -0.619], barrel: [0, 0.011, -0.391], optic: [0, 0.054, -0.120], magazine: [0, -0.025, -0.178], underbarrel: [0, -0.024, -0.319], stock: [0, 0.003, -0.012], rail: [-0.023, -0.001, -0.300] },
    muzzleTip: [0, 0.011, -0.663], arms: { fore: [-0.008, -0.030, -0.314], mag: [0, -0.140, -0.210], fa: [0.041, 0.029, -0.087] },
  });
}

/** SCAR-H: monolithic FDE upper, short 7.62 magazine and its characteristic boot stock. */
export function buildSCARH(): WeaponModel {
  const a = new WeaponAssembly('SCAR-H'), b = a.body;
  const stock = a.part('stock', 'folding boot stock');
  const barrel = a.part('barrel', 'SCAR barrel assembly');
  const mag = a.part('magazine', '7.62 box magazine');
  const charging = a.moving('reciprocating side charger');
  // The SCAR is an uninterrupted broad extruded upper, with machined longitudinal raceways.
  b.name('monolithic SCAR upper').profile([[-.011,-.013],[-.382,-.013],[-.392,.004],[-.389,.032],[-.376,.044],[-.027,.044],[-.011,.032]],.048,WM.fde,0,.0022)
    .mill([
      ...[-1,1].flatMap(side=>[
        {x:side*.024,y:.027,z:-.229,w:.0065,h:.006,d:.163,radius:.0027},
        {x:side*.024,y:-.003,z:-.338,w:.006,h:.013,d:.068,radius:.003},
        ...Array.from({length:4},(_,i)=>({x:side*.024,y:.037,z:-.351+i*.025,w:.010,h:.005,d:.018,radius:.0024})),
        ...[-.040,-.217,-.298,-.370].map(z=>({x:side*.024,y:.002,z,w:.005,h:.009,d:.009,bore:true})),
      ]),
      {x:.024,y:.014,z:-.165,w:.010,h:.016,d:.071,radius:.0025},
    ]);
  b.name('SCAR injection moulded lower').profile([[-.204,-.012],[-.028,-.011],[-.019,-.019],[-.026,-.028],[-.062,-.030],[-.078,-.036],[-.115,-.032],[-.124,-.047],[-.201,-.047]],.035,WM.tan,0,.0022);
  b.name('SCAR square magazine socket').profile([[-.203,-.014],[-.126,-.014],[-.125,-.044],[-.200,-.047]],.040,WM.tan,0,.0015)
    .mill([{x:0,y:-.047,z:-.163,w:.032,h:.028,d:.068,radius:.0012}]);
  b.name('barrel inside forend').cyl(0.009, 0.009, 0.185, WM.darkSteel, 0, 0.014, -0.304, HALF_PI);
  rail(b, -0.019, -0.383, 0.043, 0.032, WM.darkSteel);
  for (const side of [-1, 1]) {
    b.name('recessed receiver retaining pin').tube(0.0047, 0.0022, 0.0013, WM.darkSteel, side * 0.0244, 0.001, -0.042, 0, 0, HALF_PI);
    for (const [z, y] of [[-0.042, 0.001], [-0.221, -0.002], [-0.305, -0.002], [-0.370, -0.002]]) screw(b, side * 0.0232, y, z, 0.0031);
    b.name('ambi selector').cyl(0.004, 0.004, 0.003, WM.darkSteel, side * 0.019, -0.023, -0.068, 0, 0, HALF_PI, 16);
    b.box(0.0035, 0.004, 0.016, WM.darkSteel, side * 0.020, -0.025, -0.060, -0.2);
    stamp(b, 2, side * 0.0245, 0.016, -0.091, 0.105, 0.008);
  }
  b.name('bolt face in recess').box(0.0012, 0.010, 0.053, WM.steel, 0.0200, 0.014, -0.170);
  b.name('shell deflector').profile([[-0.130, 0.007], [-0.115, 0.008], [-0.115, 0.026], [-0.130, 0.028]], 0.008, WM.tan, 0.025, 0.0007);
  for(const side of [-1,1]) {
    b.name('SCAR bolt catch vertical lever').profile([[-.115,-.005],[-.104,-.005],[-.103,-.027],[-.108,-.035],[-.117,-.033]],.004,WM.darkSteel,side*.019,.0007);
    b.name('SCAR bolt catch textured pad').box(.005,.009,.015,WM.midSteel,side*.021,-.023,-.109);
    b.name('SCAR magazine catch surround').profile([[-.209,.002],[-.175,.002],[-.171,-.008],[-.178,-.013],[-.207,-.012]],.0035,WM.fde,side*.024,.0005);
    b.name('SCAR oval magazine button').profile([[-.203,-.001],[-.183,-.001],[-.180,-.005],[-.184,-.009],[-.203,-.009],[-.206,-.005]],.003,WM.midSteel,side*.026,.0005);
    stamp(b,15,side*.0246,.017,-.074,.081,.012);
    for(let i=0;i<5;i++) b.name('catch face serration').box(.001,.007,.001,WM.dark,side*.0276,-.005,-.201+i*.0038);
  }
  b.name('mag release').box(0.003, 0.008, 0.014, WM.darkSteel, 0.020, -0.024, -0.121);
  sideRail(b, -0.026, -0.002, -0.327, 0.115);
  sideRail(b, 0.026, -0.002, -0.327, 0.115);
  b.name('underbarrel dovetail').box(0.028, 0.006, 0.134, WM.darkSteel, 0, -0.015, -0.320);
  triggerGuard(b, -0.071, -0.123, -0.030, -0.065, WM.tan);
  pistolGrip(b, -0.051, -0.028, 0.086, 0.034, WM.tanGrip, 0.024);
  charging.b.name('charging stem').box(0.023, 0.007, 0.010, WM.steel, -0.030, 0.030, -0.232);
  charging.b.name('charging paddle').box(0.012, 0.010, 0.025, WM.dark, -0.043, 0.030, -0.232);

  const s = stock.b;
  s.name('stock hinge').box(0.042, 0.047, 0.020, WM.darkSteel, 0, 0.009, -0.003);
  s.name('hinge pin').cyl(0.005, 0.005, 0.052, WM.steel, -0.014, 0.009, -0.003, 0, 0, 0, 16);
  s.name('stock neck').profile([[0.000, 0.029], [0.097, 0.030], [0.102, -0.023], [0.060, -0.034], [0.004, -0.010]], 0.035, WM.tan, 0, 0.0031);
  s.name('SCAR stepped boot stock').profile([[.066,.029],[.210,.029],[.232,.013],[.232,-.077],[.211,-.080],[.194,-.055],[.178,-.028],[.083,-.023],[.066,-.015]],.042,WM.tan,0,.0032).mill([-1,1].map(side=>({x:side*.021,y:-.038,z:.209,w:.005,h:.025,d:.018,radius:.004})));
  s.name('adjustable cheekpiece').loft([[0.064, 0.039, 0.029, 0.028], [0.080, 0.047, 0.027, 0.042], [0.177, 0.046, 0.029, 0.042], [0.196, 0.035, 0.029, 0.031]], WM.tan, 0.50);
  s.name('rubber recoil pad').profile([[0.225, 0.025], [0.244, 0.019], [0.246, -0.073], [0.230, -0.080]], 0.043, WM.rubber, 0, 0.0014);
  for (const side of [-1, 1]) {
    b.name('rear sling point').box(0.004, 0.012, 0.017, WM.darkSteel, side * 0.025, 0.003, -0.021);
    screw(s, side * 0.021, -0.006, 0.202, 0.0045);
    s.name('stock adjustment button').box(.004,.011,.021,WM.darkSteel,side*.021,-.002,.208);
    s.name('stock hinge latch').profile([[.008,.024],[.028,.024],[.029,.008],[.012,.008]],.004,WM.darkSteel,side*.018,.0007,[[[.013,.020],[.023,.020],[.023,.012],[.014,.012]]]);
  }
  const r = barrel.b;
  r.name('open heavy SCAR barrel').tube(0.010, 0.004, 0.187, WM.darkSteel, 0, 0.014, -0.474);
  r.name('gas journal').tube(0.015, 0.009, 0.024, WM.darkSteel, 0, 0.014, -0.402);
  r.name('gas regulator tower').box(0.018, 0.024, 0.023, WM.darkSteel, 0, 0.030, -0.403);
  r.name('gas regulator dial').cyl(0.006, 0.006, 0.008, WM.steel, 0, 0.043, -0.403, 0, 0, 0, 12);
  flashHider(a, -0.564, 0.014, 0.049, 0.012);
  ironSights(a, -0.043, -0.372, 0.050, 0.050, 0.075);
  magazine(mag.b, { width: 0.031, depth: 0.066, length: 0.113, bend: 0.001, material: WM.fde, ribs: 2, ribMaterial: WM.tan });
  mag.group.position.set(0, -0.036, -0.163);
  return a.finish({ mag: mag.group, handle: charging.group, sightY: 0.075,
    sockets: { muzzle: [0, 0.014, -0.564], barrel: [0, 0.014, -0.385], optic: [0, 0.050, -0.134], magazine: [0, -0.036, -0.163], underbarrel: [0, -0.018, -0.321], stock: [0, 0.009, -0.014], rail: [-0.030, -0.002, -0.327] },
    muzzleTip: [0, 0.014, -0.617], arms: { fore: [0, -0.025, -0.319], mag: [0, -0.137, -0.167], fa: [-0.043, 0.030, -0.232] },
  });
}

/**
 * MCX-SPEAR: a modern coyote 6.8 battle rifle built around the details that make
 * the platform readable at first-person distance — one-piece upper, AR-10 steel
 * magazine, short-stroke piston hardware, side charger, folding/telescoping stock
 * and a free-floating M-LOK handguard.  The all-important silhouette stays distinct
 * from the SCAR: narrower receiver, longer ventilated forend, and a skeleton stock.
 */
export function buildMCXSpear(): WeaponModel {
  const a = new WeaponAssembly('MCX-SPEAR'), b = a.body;
  const stock = a.part('stock', 'folding telescopic coyote stock');
  const barrel = a.part('barrel', '16 inch piston barrel assembly');
  const mag = a.part('magazine', '20 round steel AR-10 magazine');
  const charging = a.moving('non reciprocating side charger');

  // Receiver: a low, continuous coyote upper surrounded by a separate forged lower.
  b.name('MCX monolithic upper receiver').profile([
    [-0.384, -0.010], [-0.030, -0.010], [-0.014, 0.003], [-0.016, 0.039],
    [-0.031, 0.050], [-0.358, 0.050], [-0.382, 0.039],
  ], 0.050, WM.fde, 0, 0.0024)
    .mill([
      { x: 0.025, y: 0.021, z: -0.150, w: 0.013, h: 0.019, d: 0.076, radius: 0.0025 },
      { x: -0.025, y: 0.012, z: -0.274, w: 0.012, h: 0.018, d: 0.042, radius: 0.0022 },
    ]);
  b.name('MCX forged lower receiver').profile([
    [-0.225, -0.007], [-0.034, -0.007], [-0.022, -0.016], [-0.030, -0.031],
    [-0.058, -0.035], [-0.076, -0.048], [-0.197, -0.047], [-0.221, -0.033],
  ], 0.044, WM.fde, 0, 0.0021);
  b.name('MCX flared AR10 magazine well').profile([
    [-0.222, -0.014], [-0.120, -0.014], [-0.121, -0.049], [-0.133, -0.064],
    [-0.209, -0.059], [-0.228, -0.042],
  ], 0.049, WM.fde, 0, 0.0020)
    .mill([{ x: 0, y: -0.055, z: -0.173, w: 0.035, h: 0.032, d: 0.069, radius: 0.0017 }]);
  b.name('MCX ejection port interior').box(0.002, 0.016, 0.070, WM.dark, 0.026, 0.026, -0.151);
  b.name('MCX steel bolt through port').box(0.0024, 0.010, 0.047, WM.steel, 0.0255, 0.025, -0.151);
  b.name('MCX shell deflector').loft([
    [-0.115, 0.036, 0.021, 0.004], [-0.100, 0.041, 0.019, 0.019], [-0.087, 0.034, 0.019, 0.005],
  ], WM.fde, 0.42, 0.027);
  b.name('MCX forward assist delete plate').profile([
    [-0.066, 0.011], [-0.042, 0.011], [-0.037, 0.025], [-0.061, 0.029],
  ], 0.004, WM.darkSteel, 0.026, 0.0007);
  for (const side of [-1, 1]) {
    b.name('MCX ambidextrous selector drum').cyl(0.005, 0.005, 0.0035, WM.midSteel, side * 0.024, -0.014, -0.071, 0, 0, HALF_PI);
    b.name('MCX ambidextrous selector lever').profile([
      [-0.076, -0.010], [-0.066, -0.010], [-0.052, -0.018], [-0.051, -0.023], [-0.058, -0.021], [-0.076, -0.014],
    ], 0.0035, WM.darkSteel, side * 0.026, 0.00045);
    b.name('MCX magazine release paddle').profile([
      [-0.129, -0.012], [-0.107, -0.012], [-0.106, -0.025], [-0.119, -0.030], [-0.132, -0.024],
    ], 0.0032, WM.midSteel, side * 0.026, 0.00055);
    b.name('MCX bolt catch').profile([
      [-0.113, 0.004], [-0.099, 0.004], [-0.099, -0.030], [-0.107, -0.037], [-0.115, -0.029],
    ], 0.0034, WM.darkSteel, side * 0.0245, 0.0006);
    b.name('MCX takedown pin').cyl(0.005, 0.005, 0.003, WM.midSteel, side * 0.025, 0.004, -0.033, 0, 0, HALF_PI);
    screw(b, side * 0.026, 0.002, -0.199, 0.003);
    screw(b, side * 0.026, 0.002, -0.032, 0.0028);
    stamp(b, side === 1 ? 16 : 15, side * 0.0263, 0.010, -0.169, 0.075, 0.008);
  }
  triggerGuard(b, -0.066, -0.128, -0.030, -0.071, WM.darkSteel, true);
  pistolGrip(b, -0.053, -0.028, 0.089, 0.036, WM.tanGrip, 0.018);

  // Continuous optic rail lets users mount a scope without a floating adapter.
  rail(b, -0.027, -0.356, 0.051, 0.036, WM.darkSteel);
  b.name('MCX barrel extension').tube(0.019, 0.010, 0.034, WM.darkSteel, 0, 0.012, -0.363);
  // The M-LOK forend has a hollow bore and recessed oblong mounting windows.
  const mlok: [number, number][] = [
    [-0.024, -0.019], [0.024, -0.019], [0.031, -0.010], [0.031, 0.020],
    [0.023, 0.032], [-0.023, 0.032], [-0.031, 0.020], [-0.031, -0.010],
  ];
  b.name('MCX free float MLOK handguard').section(mlok, 0.238, WM.fde, 0, 0.006, -0.477, { y: 0.005, radius: 0.015 })
    .mill(Array.from({ length: 7 }, (_, i) => ({ x: 0, y: 0.026, z: -0.380 - i * 0.027, w: 0.070, h: 0.008, d: 0.012, radius: 0.004 })));
  // Recessed M-LOK slot shadows on both flanks give the forend physical rhythm.
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    const z = -0.403 - i * 0.031;
    b.name('MLOK side slot recess').box(0.0015, 0.006, 0.014, WM.dark, side * 0.031, 0.005, z);
    b.name('MLOK slot bridge').box(0.0025, 0.003, 0.003, WM.midSteel, side * 0.031, 0.005, z);
  }
  b.name('MCX handguard lower spine').box(0.028, 0.010, 0.217, WM.darkSteel, 0, -0.016, -0.480);
  sideRail(b, -0.032, 0.004, -0.484, 0.090);
  sideRail(b, 0.032, 0.004, -0.484, 0.090);

  // The left-side charging handle rides in a real slot but never follows the bolt.
  charging.b.name('MCX side charging rail').box(0.005, 0.010, 0.070, WM.steel, -0.029, 0.026, -0.160);
  charging.b.name('MCX folding charging handle stem').box(0.013, 0.006, 0.017, WM.darkSteel, -0.034, 0.026, -0.166);
  charging.b.name('MCX charging handle knuckle').loft([
    [-0.173, 0.037, 0.021, 0.018], [-0.165, 0.042, 0.018, 0.026], [-0.151, 0.039, 0.018, 0.019],
  ], WM.darkSteel, 0.55, -0.037);

  // Hinge, twin guide rails and skeleton stock make the rear assembly explicitly foldable.
  const s = stock.b;
  // The hinge overlaps the receiver's rear trunnion; this is a physical bridge,
  // not a stock assembly parented in space.
  s.name('MCX push button hinge block').box(0.052, 0.052, 0.045, WM.darkSteel, 0, 0.010, 0.004);
  s.name('MCX hinge pin').cyl(0.006, 0.006, 0.060, WM.steel, 0, 0.010, 0.004, 0, 0, 0, 16);
  s.name('MCX folding latch').box(0.010, 0.015, 0.023, WM.midSteel, -0.027, 0.010, 0.016);
  for (const x of [-0.014, 0.014]) {
    s.name('MCX telescoping stock guide').box(0.008, 0.012, 0.151, WM.darkSteel, x, 0.013, 0.084);
    s.name('MCX stock guide collar').box(0.014, 0.019, 0.014, WM.midSteel, x, 0.013, 0.034);
  }
  s.name('MCX skeleton cheek riser').profile([
    [0.027, 0.035], [0.156, 0.035], [0.182, 0.018], [0.179, -0.003], [0.063, -0.002], [0.028, 0.013],
  ], 0.032, WM.fde, 0, 0.0022, [[[0.066, 0.014], [0.145, 0.014], [0.160, 0.006], [0.079, 0.007]]]);
  s.name('MCX adjustable buttstock body').profile([
    [0.142, 0.028], [0.220, 0.025], [0.235, 0.010], [0.234, -0.073], [0.215, -0.079], [0.187, -0.047], [0.143, -0.018],
  ], 0.040, WM.fde, 0, 0.0026);
  s.name('MCX recoil pad').profile([[0.228, 0.024], [0.245, 0.018], [0.246, -0.072], [0.230, -0.080]], 0.043, WM.rubber, 0, 0.0015);
  // This latch keys into both telescoping guide rails instead of hovering below them.
  s.name('MCX stock adjustment latch').box(0.025, 0.016, 0.030, WM.darkSteel, 0, 0.006, 0.112, -0.22);
  // Countersunk screws are seated inside the buttstock shell, not pasted over its edge.
  for (const side of [-1, 1]) screw(s, side * 0.018, -0.010, 0.205, 0.003);

  const r = barrel.b;
  r.name('MCX cold hammer forged barrel').tube(0.010, 0.0044, 0.281, WM.darkSteel, 0, 0.008, -0.512);
  r.name('MCX two position gas block').tube(0.016, 0.009, 0.027, WM.darkSteel, 0, 0.008, -0.426);
  r.name('MCX adjustable gas valve').cyl(0.0065, 0.0065, 0.012, WM.steel, 0, 0.040, -0.426, 0, 0, 0, 16);
  r.name('MCX piston rod').cyl(0.005, 0.005, 0.170, WM.darkSteel, 0, 0.035, -0.469, HALF_PI);
  r.name('MCX muzzle collar').tube(0.014, 0.009, 0.020, WM.midSteel, 0, 0.008, -0.636);
  // Seat the QD flash hider over the barrel crown — no seam at the muzzle.
  flashHider(a, -0.653, 0.008, 0.050, 0.012);
  // A low pedestal intersects the handguard top rail under the folding front sight.
  b.name('MCX front sight rail bridge').box(0.028, 0.018, 0.026, WM.darkSteel, 0, 0.041, -0.574);
  ironSights(a, -0.075, -0.574, 0.051, 0.039, 0.077);
  magazine(mag.b, { width: 0.033, depth: 0.066, length: 0.123, bend: 0.001, material: WM.darkSteel, ribs: 2 });
  mag.group.position.set(0, -0.048, -0.168);

  return a.finish({
    mag: mag.group, handle: charging.group, sightY: 0.077,
    sockets: {
      muzzle: [0, 0.008, -0.653], barrel: [0, 0.008, -0.399], optic: [0, 0.055, -0.177],
      magazine: [0, -0.048, -0.168], underbarrel: [0, -0.021, -0.486], stock: [0, 0.010, 0.005], rail: [-0.035, 0.005, -0.485],
    },
    muzzleTip: [0, 0.008, -0.703],
    arms: { fore: [0, -0.029, -0.479], mag: [0, -0.148, -0.180], fa: [-0.039, 0.030, -0.163] },
  });
}
