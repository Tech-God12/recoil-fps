// Recoil FPS — procedural Field Kit hardware: the Recon sonar dart, the Bulwark
// deployable barricade and the Phantom holo-decoy. Same construction rules as the
// scorestreak hardware — a few dozen boxes/cylinders on shared materials — so a
// deployed kit costs less than one soldier.
import * as THREE from 'three';

let mats: {
  steel: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; sand: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; ledCyan: THREE.MeshStandardMaterial;
  ledAmber: THREE.MeshStandardMaterial; stripe: THREE.MeshStandardMaterial;
} | null = null;

function M() {
  if (mats) return mats;
  mats = {
    steel: new THREE.MeshStandardMaterial({ color: 0x5A5F63, roughness: 0.5, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1E2022, roughness: 0.7, metalness: 0.4 }),
    // Barricade faces use the same khaki as the sandbag props so it reads as field kit, not sci-fi.
    sand: new THREE.MeshStandardMaterial({ color: 0x8C7A58, roughness: 0.9, metalness: 0.05 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xC89B5A, roughness: 0.4, metalness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2A4550, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.55 }),
    ledCyan: new THREE.MeshStandardMaterial({ color: 0x5FE3FF, emissive: 0x5FE3FF, emissiveIntensity: 2.4, roughness: 0.4 }),
    ledAmber: new THREE.MeshStandardMaterial({ color: 0xFFB030, emissive: 0xFFB030, emissiveIntensity: 2.2, roughness: 0.4 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xFF4D00, roughness: 0.6, metalness: 0.2 }),
  };
  return mats;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = false; m.receiveShadow = false;
  parent?.add(m);
  return m;
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  parent?.add(m);
  return m;
}

// ---------------------------------------------------------------------------------
// Recon: sonar dart
// ---------------------------------------------------------------------------------
export interface DartModel {
  group: THREE.Group;
  /** Blinking head LED — the engine pulses it with each sonar ping. */
  led: THREE.Mesh;
  /** Flat expanding ground ring shown for each pulse; scaled by the director. */
  ring: THREE.Mesh;
  /** Trailing echo ring (lags the main ring for a double-wave read). */
  echo: THREE.Mesh;
  /** Expanding wire dome — the pulse's 3-D reach, visible through haze. */
  dome: THREE.Mesh;
  /** Vertical beacon beam so teammates-of-one can find the dart at a glance. */
  beam: THREE.Mesh;
}

/** A 40 cm sensor dart: tungsten tip, sensor body, four fins, cyan emitter band. Nose along -Z. */
export function buildDart(): DartModel {
  const m = M();
  const group = new THREE.Group();
  const tip = cyl(0.0, 0.022, 0.1, m.steel, 0, 0, -0.2, group, 6); tip.rotation.x = -Math.PI / 2;
  const body = cyl(0.024, 0.024, 0.22, m.dark, 0, 0, -0.05, group, 8); body.rotation.x = Math.PI / 2;
  const band = cyl(0.027, 0.027, 0.03, m.brass, 0, 0, -0.12, group, 8); band.rotation.x = Math.PI / 2;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), m.ledCyan);
  led.position.set(0, 0, 0.02); group.add(led);
  for (let i = 0; i < 4; i++) {
    const fin = box(0.004, 0.07, 0.09, m.steel, 0, 0, 0.1, group);
    fin.rotation.z = i * Math.PI / 2;
    fin.position.set(Math.sin(i * Math.PI / 2) * 0.035, Math.cos(i * Math.PI / 2) * 0.035, 0.1);
  }
  // Sonar ring lives in world space (the director re-parents it to the scene on impact),
  // additive so it reads through haze without a real light.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0x5FE3FF, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  const echo = new THREE.Mesh(
    new THREE.RingGeometry(0.97, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xBFF6FF, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  echo.rotation.x = -Math.PI / 2;
  echo.visible = false;
  // Low-poly wire hemisphere: 20×8 segments reads as a sonar net without costing fill.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5FE3FF, wireframe: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  dome.visible = false;
  // 3 m additive beam, open-ended so it is only the glow shell.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.09, 3, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x5FE3FF, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  beam.visible = false;
  return { group, led, ring, echo, dome, beam };
}

/** Disposes the dart's world-space pulse meshes (they own their geometry + material). */
export function disposeDartFx(m: DartModel) {
  for (const o of [m.ring, m.echo, m.dome, m.beam]) {
    o.removeFromParent();
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------------
// Sonar tag: through-wall body silhouette
// ---------------------------------------------------------------------------------
export interface TagGhost {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}

/**
 * A soldier-height cyan silhouette drawn with depthTest off, so a tagged hostile is
 * visible as a body (stance, facing, crouch height) through walls — far more useful
 * than a floating dot. Pooled by the director; one shared material per ghost so each
 * can fade on its own clock.
 */
export function buildTagGhost(): TagGhost {
  const mat = new THREE.MeshBasicMaterial({ color: 0x5FE3FF, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.9, 3, 8), mat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat);
  head.position.y = 1.68;
  group.add(body, head);
  group.traverse(o => { o.renderOrder = 50; o.frustumCulled = false; });
  group.visible = false;
  return { group, mat };
}

// ---------------------------------------------------------------------------------
// Bulwark: deployable ballistic barricade
// ---------------------------------------------------------------------------------
export interface BarricadeModel {
  group: THREE.Group;
  /** The meshes bullets and AI line-of-sight stop against (registered as occluders). */
  plates: THREE.Mesh[];
  /** Amber status lamp: steady when healthy, flickers under 35 % integrity. */
  lamp: THREE.Mesh;
  /** Hinge pivots of the two wing plates: rotated ±90° when folded, 0 when deployed. */
  wings: THREE.Group[];
  /** Per-barricade plate material: tinted toward scorched steel as integrity drops. */
  plateMat: THREE.MeshStandardMaterial;
}

/**
 * A folding steel barricade `width` wide and `height` tall, facing local -Z (the side
 * the threat is on). Three hinged plates, a glass vision block, kick-stand legs, and
 * orange hazard stripes so a new player can tell it apart from world cover.
 */
export function buildBarricade(width: number, height: number, depth: number): BarricadeModel {
  const m = M();
  const group = new THREE.Group();
  const plates: THREE.Mesh[] = [];
  const wings: THREE.Group[] = [];
  // Own material so damage tint and hit flashes never leak into other barricades.
  const plateMat = m.sand.clone();
  const pw = width / 3;
  for (let i = 0; i < 3; i++) {
    // Wing plates hang off a hinge pivot at the centre plate's edge so the deploy
    // animation can swing them open like a real folding shield.
    const hingeX = i === 0 ? -pw / 2 : pw / 2;
    const parent = i === 1 ? group : new THREE.Group();
    if (i !== 1) { parent.position.set(hingeX, 0, 0); group.add(parent); wings.push(parent as THREE.Group); }
    const x = i === 1 ? 0 : (i === 0 ? -pw / 2 : pw / 2);
    // Middle plate is taller: the vision block sits in its top.
    const h = i === 1 ? height : height * 0.93;
    const p = box(pw - 0.02, h, depth, plateMat, x, h / 2, 0, parent);
    p.receiveShadow = true;
    plates.push(p);
    box(pw - 0.06, 0.06, depth + 0.012, m.stripe, x, h - 0.12, 0, parent);
    // Two horizontal ribs per plate: reads as stamped armour, not a flat board.
    box(pw - 0.1, 0.035, depth + 0.02, m.steel, x, h * 0.32, 0, parent);
    box(pw - 0.1, 0.035, depth + 0.02, m.steel, x, h * 0.62, 0, parent);
    box(0.05, h * 0.9, depth + 0.02, m.steel, x - pw / 2 + 0.01, h * 0.47, 0, parent); // hinge post
  }
  // vision block (glass), set into the centre plate — purely visual, the plate behind it stops rounds
  box(0.34, 0.12, depth + 0.02, m.glass, 0, height - 0.26, 0, group);
  // kick-stand legs on the friendly (+Z) side
  for (const x of [-width / 2 + 0.25, width / 2 - 0.25]) {
    const leg = box(0.05, 0.05, 0.62, m.steel, x, 0.24, 0.3, group);
    leg.rotation.x = 0.62;
  }
  // base skid
  box(width, 0.06, 0.22, m.dark, 0, 0.03, 0.02, group);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), m.ledAmber);
  lamp.position.set(0.3, height + 0.03, 0.04); group.add(lamp);
  return { group, plates, lamp, wings, plateMat };
}

// ---------------------------------------------------------------------------------
// Phantom: holo-decoy
// ---------------------------------------------------------------------------------
export interface DecoyModel {
  group: THREE.Group;
  lLeg: THREE.Object3D; rLeg: THREE.Object3D;
  lArm: THREE.Object3D; rArm: THREE.Object3D;
  /** Muzzle socket for the fake shots. */
  muzzle: THREE.Object3D;
  /** The shared hologram material; the director drives its opacity for flicker. */
  mat: THREE.MeshBasicMaterial;
  /** Ground emitter puck under the hologram. */
  puck: THREE.Mesh;
  /** Projector cone from the puck up through the body (additive). */
  cone: THREE.Mesh;
  /** Horizontal scan ring that sweeps up the body while it materialises. */
  scan: THREE.Mesh;
  /** Upper body pivot (glitch slices offset it sideways for a frame). */
  torso: THREE.Group;
  /** Scanline texture scrolled every frame. */
  lines: THREE.CanvasTexture | null;
}

/** 4×64 scanline strip: bright rows with dark gaps, tiled up the body. */
function scanlineTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  for (let y = 0; y < 64; y++) {
    // 3 bright rows, 1 dim row, and a faint band every 16 rows.
    const v = y % 4 === 3 ? 60 : (y % 16 < 2 ? 255 : 200);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, 4, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  return tex;
}

/**
 * Soldier-silhouette hologram (≈ the enemy soldier's proportions so AI and players
 * read it as a person at range), additive cyan with a projector puck at its feet.
 * Faces -Z like every other actor model.
 */
export function buildDecoy(): DecoyModel {
  const m = M();
  const lines = scanlineTexture();
  const mat = new THREE.MeshBasicMaterial({ color: 0x6FE8FF, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, map: lines });
  const group = new THREE.Group();
  const torso = new THREE.Group(); torso.position.y = 0.95; group.add(torso);
  box(0.42, 0.56, 0.26, mat, 0, 0.3, 0, torso);
  box(0.2, 0.22, 0.22, mat, 0, 0.74, 0, torso); // head
  box(0.24, 0.07, 0.25, mat, 0, 0.86, 0, torso); // helmet brim
  const mkLimb = (x: number, y: number, len: number, w: number, parent: THREE.Object3D) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); parent.add(pivot);
    box(w, len, w, mat, 0, -len / 2, 0, pivot);
    return pivot;
  };
  const lLeg = mkLimb(-0.11, 0.95, 0.9, 0.15, group);
  const rLeg = mkLimb(0.11, 0.95, 0.9, 0.15, group);
  const lArm = mkLimb(-0.27, 0.54, 0.5, 0.1, torso);
  const rArm = mkLimb(0.27, 0.54, 0.5, 0.1, torso);
  lArm.rotation.x = -1.1; rArm.rotation.x = -1.25;
  // rifle held across the chest, pointing -Z
  const rifle = box(0.06, 0.1, 0.78, mat, 0.08, 0.36, -0.3, torso);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -0.42); rifle.add(muzzle);
  const puck = cyl(0.2, 0.24, 0.05, m.dark, 0, 0.025, 0, group, 12);
  cyl(0.16, 0.16, 0.012, m.ledCyan, 0, 0.056, 0, group, 12);
  // Projector cone: narrow at the puck, 0.55 m wide at head height.
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x6FE8FF, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.16, 1.9, 16, 1, true), coneMat);
  cone.position.y = 1.0;
  group.add(cone);
  const scanMat = new THREE.MeshBasicMaterial({ color: 0xE8FDFF, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const scan = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 24), scanMat);
  scan.rotation.x = -Math.PI / 2;
  group.add(scan);
  return { group, lLeg, rLeg, lArm, rArm, muzzle, mat, puck, cone, scan, torso, lines };
}

// ---------------------------------------------------------------------------------
// Reveal marker (through-wall sonar tag)
// ---------------------------------------------------------------------------------
/** Cyan hollow diamond, distinct from the red UAV marker so the two intel sources never blur. */
export function makeSonarMarkerMaterial(): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.translate(32, 32); ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = 'rgba(10,20,24,0.9)';
  ctx.lineWidth = 9;
  ctx.strokeRect(-14, -14, 28, 28);
  ctx.strokeStyle = 'rgba(95,227,255,0.98)';
  ctx.lineWidth = 5;
  ctx.strokeRect(-14, -14, 28, 28);
  ctx.fillStyle = 'rgba(95,227,255,0.9)';
  ctx.fillRect(-4, -4, 8, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false });
}

/** Disposes geometries under a kit object (materials are shared module-wide, except the decoy's). */
export function disposeKitObject(o: THREE.Object3D) {
  o.traverse(c => { if (c instanceof THREE.Mesh) c.geometry.dispose(); });
}

/** Everything the decoy owns beyond geometry: its hologram, cone and scan materials and the scanline texture. */
export function disposeDecoy(m: DecoyModel) {
  disposeKitObject(m.group);
  m.mat.dispose();
  (m.cone.material as THREE.Material).dispose();
  (m.scan.material as THREE.Material).dispose();
  m.lines?.dispose();
}
