// Recoil FPS — Bomb Defusal props: the C4 charge and the smoke-cloud puff texture.
// Procedural geometry only (no assets), safe under the Node canvas stub.
import * as THREE from 'three';

export interface C4Model {
  group: THREE.Group;
  /** Red status LED — blink it in time with the beeps. */
  led: THREE.Mesh;
  /** Keypad screen (emissive while armed). */
  screen: THREE.MeshStandardMaterial;
}

/** Four taped explosive blocks on a base plate, keypad timer on top, three wires. */
export function buildC4(scale = 1): C4Model {
  const group = new THREE.Group();
  const block = new THREE.MeshStandardMaterial({ color: 0xB9A57A, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22221F, roughness: 0.6, metalness: 0.3 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x3B3A33, roughness: 0.9 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x1B2A1A, emissive: 0x6CFF6A, emissiveIntensity: 0.35, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.34, 0.025, 0.22), dark, 0, 0.0125, 0);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.075, 0.07, 0.2), block, -0.12 + i * 0.08, 0.06, 0);
  for (const x of [-0.1, 0.1]) add(new THREE.BoxGeometry(0.035, 0.078, 0.215), tape, x, 0.062, 0);
  add(new THREE.BoxGeometry(0.15, 0.03, 0.11), dark, 0.02, 0.11, 0);
  add(new THREE.BoxGeometry(0.085, 0.004, 0.034), screen, 0.02, 0.127, -0.02);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) add(new THREE.BoxGeometry(0.016, 0.006, 0.012), tape, -0.005 + c * 0.022, 0.127, 0.018 + r * 0.016);
  const wireCols = [0xC8321E, 0x2E6BA0, 0xE0B03A];
  wireCols.forEach((wc, i) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.05, 0.115, -0.03 + i * 0.03),
      new THREE.Vector3(-0.1, 0.14, -0.02 + i * 0.025),
      new THREE.Vector3(-0.14, 0.1, -0.01 + i * 0.02),
    ]);
    add(new THREE.TubeGeometry(curve, 8, 0.004, 5, false), new THREE.MeshStandardMaterial({ color: wc, roughness: 0.6 }), 0, 0, 0);
  });
  const led = add(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: 0xFF2A18 }), 0.075, 0.13, -0.035);
  led.castShadow = false;
  group.scale.setScalar(scale);
  return { group, led, screen };
}

let puffTex: THREE.CanvasTexture | null = null;
/** Soft, lumpy smoke puff (shared). */
export function smokePuffTexture(): THREE.CanvasTexture {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399, r = i === 0 ? 0 : 18 + (i % 3) * 7;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rad = i === 0 ? 58 : 34 + (i % 4) * 5;
    const g = ctx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, 'rgba(236,232,224,0.55)');
    g.addColorStop(0.55, 'rgba(214,208,198,0.28)');
    g.addColorStop(1, 'rgba(200,196,188,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

let glowTex: THREE.CanvasTexture | null = null;
export function redGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,90,60,1)');
  g.addColorStop(0.35, 'rgba(255,40,20,0.45)');
  g.addColorStop(1, 'rgba(255,20,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
