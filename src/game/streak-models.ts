// Recoil FPS — procedural scorestreak hardware (sentry gun, attack helicopter, strike
// jets, recon drone). Everything is a few dozen boxes/cylinders on shared materials so
// a helicopter over the map costs less than one soldier's shadow pass.
import * as THREE from 'three';

let mats: {
  gunmetal: THREE.MeshStandardMaterial; olive: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial; led: THREE.MeshStandardMaterial; blade: THREE.MeshStandardMaterial;
  blur: THREE.MeshBasicMaterial; warn: THREE.MeshStandardMaterial; grey: THREE.MeshStandardMaterial;
} | null = null;

function M() {
  if (mats) return mats;
  mats = {
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x3A3D40, roughness: 0.55, metalness: 0.75 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4F5A3C, roughness: 0.8, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1C1E20, roughness: 0.7, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1F3A4A, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.85 }),
    led: new THREE.MeshStandardMaterial({ color: 0xFF2A1A, emissive: 0xFF2A1A, emissiveIntensity: 2.2, roughness: 0.4 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x24262A, roughness: 0.6, metalness: 0.5 }),
    blur: new THREE.MeshBasicMaterial({ color: 0x202226, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    warn: new THREE.MeshStandardMaterial({ color: 0xD8B04A, roughness: 0.6, metalness: 0.3 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x8A8E90, roughness: 0.5, metalness: 0.7 }),
  };
  return mats;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = false;
  parent?.add(m);
  return m;
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent?.add(m);
  return m;
}

export interface SentryModel {
  group: THREE.Group;
  yawPivot: THREE.Group;
  pitchPivot: THREE.Group;
  muzzles: THREE.Object3D[];
  led: THREE.Mesh;
  flash: THREE.Mesh;
}

/** Tripod auto-turret: yaw ring on a tripod, pitching twin-barrel head with sensor eye. */
export function buildSentry(): SentryModel {
  const m = M();
  const group = new THREE.Group();
  // tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = cyl(0.03, 0.035, 0.9, m.gunmetal, Math.sin(a) * 0.32, 0.42, Math.cos(a) * 0.32, group, 6);
    leg.rotation.set(Math.cos(a) * 0.62, 0, -Math.sin(a) * 0.62);
    const foot = box(0.1, 0.03, 0.1, m.dark, Math.sin(a) * 0.62, 0.015, Math.cos(a) * 0.62, group);
    foot.rotation.y = a;
  }
  // column + yaw ring
  cyl(0.07, 0.09, 0.5, m.gunmetal, 0, 0.72, 0, group, 10);
  cyl(0.19, 0.19, 0.07, m.dark, 0, 0.95, 0, group, 14);
  const yawPivot = new THREE.Group(); yawPivot.position.y = 0.98; group.add(yawPivot);
  box(0.34, 0.14, 0.3, m.olive, 0, 0.08, 0, yawPivot);
  // trunnions
  box(0.06, 0.24, 0.16, m.gunmetal, -0.2, 0.22, 0, yawPivot);
  box(0.06, 0.24, 0.16, m.gunmetal, 0.2, 0.22, 0, yawPivot);
  const pitchPivot = new THREE.Group(); pitchPivot.position.y = 0.3; yawPivot.add(pitchPivot);
  // receiver
  box(0.3, 0.2, 0.46, m.olive, 0, 0, 0.02, pitchPivot);
  box(0.22, 0.12, 0.18, m.dark, 0, 0.16, -0.06, pitchPivot); // sensor housing
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), m.led);
  led.position.set(0, 0.16, -0.16); pitchPivot.add(led);
  // ammo box on the side
  box(0.14, 0.18, 0.24, m.warn, 0.23, -0.02, 0.02, pitchPivot);
  // twin barrels
  const muzzles: THREE.Object3D[] = [];
  for (const x of [-0.07, 0.07]) {
    const b = cyl(0.022, 0.026, 0.62, m.gunmetal, x, 0.0, -0.5, pitchPivot, 8);
    b.rotation.x = Math.PI / 2;
    const brake = cyl(0.03, 0.03, 0.08, m.dark, x, 0, -0.78, pitchPivot, 8);
    brake.rotation.x = Math.PI / 2;
    const mz = new THREE.Object3D(); mz.position.set(x, 0, -0.84); pitchPivot.add(mz); muzzles.push(mz);
  }
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xFFD08A, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, 0, -0.9); pitchPivot.add(flash);
  return { group, yawPivot, pitchPivot, muzzles, led, flash };
}

export interface ChopperModel {
  group: THREE.Group;
  body: THREE.Group;
  rotor: THREE.Group;
  tailRotor: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  flash: THREE.Mesh;
  beacon: THREE.Mesh;
}

/** Attack helicopter: slab fuselage, tandem canopy, stub wings with rocket pods, chin gun. */
export function buildChopper(): ChopperModel {
  const m = M();
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  // fuselage (nose points -Z)
  box(1.5, 1.5, 4.6, m.olive, 0, 0, 0.2, body);
  const nose = cyl(0.75, 0.35, 1.6, m.olive, 0, -0.05, -2.9, body, 10); nose.rotation.x = Math.PI / 2;
  box(1.2, 0.9, 2.2, m.olive, 0, 1.05, 0.6, body); // engine deck
  box(1.05, 0.62, 1.6, m.glass, 0, 0.95, -1.35, body); // canopy
  box(0.9, 0.4, 0.8, m.glass, 0, 0.55, -2.35, body); // gunner glass
  box(0.3, 0.3, 1.2, m.dark, -0.85, 1.1, 0.4, body); box(0.3, 0.3, 1.2, m.dark, 0.85, 1.1, 0.4, body); // intakes
  // tail boom + fin
  const boom = box(0.5, 0.55, 5.2, m.olive, 0, 0.35, 5.0, body);
  boom.rotation.x = 0.03;
  box(0.12, 1.6, 0.9, m.olive, 0, 1.1, 7.6, body);
  box(1.6, 0.08, 0.5, m.olive, 0, 0.55, 6.8, body); // horizontal stabiliser
  // stub wings with pods
  for (const s of [-1, 1]) {
    box(2.0, 0.12, 0.8, m.olive, s * 1.6, -0.1, 0.1, body);
    const pod = cyl(0.22, 0.22, 1.3, m.gunmetal, s * 2.3, -0.4, 0.1, body, 10); pod.rotation.x = Math.PI / 2;
    cyl(0.16, 0.16, 0.05, m.dark, s * 2.3, -0.4, -0.58, body, 10).rotation.x = Math.PI / 2;
    // skids
    const skid = cyl(0.05, 0.05, 4.2, m.gunmetal, s * 0.85, -1.35, 0.1, body, 6); skid.rotation.x = Math.PI / 2;
    for (const z of [-1.2, 1.2]) box(0.06, 0.6, 0.06, m.gunmetal, s * 0.85, -1.05, z, body);
  }
  // main rotor
  cyl(0.12, 0.16, 0.5, m.gunmetal, 0, 1.7, 0.3, body, 8);
  const rotor = new THREE.Group(); rotor.position.set(0, 1.95, 0.3); body.add(rotor);
  cyl(0.28, 0.28, 0.16, m.dark, 0, 0, 0, rotor, 10);
  for (let i = 0; i < 4; i++) {
    const b = box(0.32, 0.05, 6.4, m.blade, 0, 0, 0, undefined, false);
    b.position.set(Math.sin(i * Math.PI / 2) * 3.2, 0, Math.cos(i * Math.PI / 2) * 3.2);
    b.rotation.y = i * Math.PI / 2;
    rotor.add(b);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(6.5, 24), m.blur);
  disc.rotation.x = -Math.PI / 2; disc.position.y = -0.02; rotor.add(disc);
  // tail rotor
  const tailRotor = new THREE.Group(); tailRotor.position.set(0.38, 1.3, 7.5); body.add(tailRotor);
  for (let i = 0; i < 2; i++) {
    const b = box(0.06, 1.7, 0.16, m.blade, 0, 0, 0, undefined, false);
    b.rotation.z = i * Math.PI / 2; tailRotor.add(b);
  }
  // chin gun
  const gun = new THREE.Group(); gun.position.set(0, -0.85, -2.3); body.add(gun);
  box(0.4, 0.3, 0.5, m.gunmetal, 0, 0, 0, gun);
  const barrels = cyl(0.09, 0.09, 1.3, m.dark, 0, 0, -0.8, gun, 8); barrels.rotation.x = Math.PI / 2;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -1.5); gun.add(muzzle);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ color: 0xFFD08A, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, 0, -1.6); gun.add(flash);
  // beacon
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), m.led);
  beacon.position.set(0, 0.7, 5.5); body.add(beacon);
  return { group, body, rotor, tailRotor, gun, muzzle, flash, beacon };
}

/** Strike jet: delta wing, single fin, twin exhausts. Nose along -Z. */
export function buildJet(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  const fus = cyl(0.35, 0.5, 7, m.grey, 0, 0, 0, g, 10); fus.rotation.x = Math.PI / 2;
  const nose = cyl(0.05, 0.35, 2.2, m.grey, 0, 0, -4.6, g, 10); nose.rotation.x = Math.PI / 2;
  box(0.5, 0.38, 1.6, m.glass, 0, 0.42, -2.3, g);
  // delta wing
  const wing = new THREE.Mesh(new THREE.ConeGeometry(4.2, 5.5, 3), m.grey);
  wing.scale.set(1, 1, 0.05); wing.rotation.x = Math.PI / 2; wing.rotation.z = Math.PI; wing.position.set(0, -0.1, 1.0);
  wing.castShadow = true; g.add(wing);
  box(0.08, 1.6, 2.0, m.grey, 0, 0.9, 2.6, g); // fin
  for (const s of [-1, 1]) {
    cyl(0.28, 0.32, 0.8, m.dark, s * 0.38, -0.05, 3.7, g, 8).rotation.x = Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 10), new THREE.MeshBasicMaterial({ color: 0xFFA040 }));
    glow.position.set(s * 0.38, -0.05, 4.12); g.add(glow);
    // bombs under wing
    cyl(0.14, 0.14, 1.6, m.dark, s * 1.6, -0.55, 0.6, g, 8).rotation.x = Math.PI / 2;
  }
  return g;
}

/** Recon UAV: long slim wing, V-tail, ball sensor — circles high and slow. */
export function buildUav(): { group: THREE.Group; prop: THREE.Mesh } {
  const m = M();
  const g = new THREE.Group();
  const body = cyl(0.28, 0.42, 5.0, m.grey, 0, 0, 0, g, 10); body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), m.grey); nose.position.z = -2.5; g.add(nose);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), m.dark); eye.position.set(0, -0.5, -1.6); g.add(eye);
  box(12, 0.08, 1.1, m.grey, 0, 0.15, -0.4, g);
  for (const s of [-1, 1]) { const t = box(0.06, 1.6, 0.8, m.grey, s * 0.9, 0.55, 2.3, g); t.rotation.z = s * -0.6; }
  const prop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.12), m.blade); prop.position.z = 2.6; g.add(prop);
  return { group: g, prop };
}

/** Red diamond marker shown over hostiles while the UAV is up — drawn through walls. */
export function makeUavMarkerMaterial(): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.translate(32, 32); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(255,60,40,0.95)';
  ctx.strokeStyle = 'rgba(20,10,8,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.rect(-13, -13, 26, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,220,200,0.9)';
  ctx.fillRect(-4, -4, 8, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false });
}
