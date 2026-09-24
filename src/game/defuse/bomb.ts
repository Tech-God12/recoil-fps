// Recoil FPS — Bomb Defusal: the C4 prop (world model + blinking LED glow).
import * as THREE from 'three';

let glowTex: THREE.CanvasTexture | null = null;
function ledGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,90,70,1)');
  g.addColorStop(0.25, 'rgba(255,40,30,0.7)');
  g.addColorStop(1, 'rgba(255,20,10,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function lcdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0E2A12'; ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = '#6BFF7A';
  ctx.font = 'bold 30px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('*******', 64, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type BombMode = 'hidden' | 'carried' | 'ground' | 'planted';

/** A taped C4 brick with keypad, LCD, wiring and a status LED. */
export class BombProp {
  readonly group = new THREE.Group();
  private glow: THREE.Sprite;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private ledMat: THREE.MeshBasicMaterial;
  private mode: BombMode = 'hidden';
  private blink = 0;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const olive = new THREE.MeshStandardMaterial({ color: 0x6B6A3E, roughness: 0.85 });
    const tape = new THREE.MeshStandardMaterial({ color: 0x3C3A33, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.45, metalness: 0.3 });
    const red = new THREE.MeshStandardMaterial({ color: 0xB0231B, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x2146A8, roughness: 0.5 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    // four blocks, two tape bands
    for (const [x, z] of [[-0.065, -0.1], [0.065, -0.1], [-0.065, 0.1], [0.065, 0.1]] as const)
      add(new THREE.BoxGeometry(0.125, 0.065, 0.19), olive, x, 0.0325, z);
    for (const z of [-0.12, 0.12]) add(new THREE.BoxGeometry(0.27, 0.07, 0.035), tape, 0, 0.034, z);
    // keypad housing + LCD + keys
    add(new THREE.BoxGeometry(0.15, 0.03, 0.12), black, 0, 0.08, 0.01);
    const lcd = add(new THREE.PlaneGeometry(0.11, 0.035), new THREE.MeshBasicMaterial({ map: lcdTexture() }), 0, 0.0955, -0.02, -Math.PI / 2);
    lcd.castShadow = false;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++)
      add(new THREE.BoxGeometry(0.022, 0.008, 0.016), tape, -0.03 + k * 0.03, 0.098, 0.02 + r * 0.022);
    // wires
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 5), red, 0.09, 0.075, 0, Math.PI / 2, 0, 0.2);
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 5), blue, -0.09, 0.075, 0, Math.PI / 2, 0, -0.2);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 5), black, 0.06, 0.14, 0.05, 0.3);
    // LED + additive glow
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x3A0A08 });
    add(new THREE.SphereGeometry(0.011, 8, 6), this.ledMat, 0.05, 0.1, -0.045);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ledGlowTexture(), color: 0xFF4030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.set(0.5, 0.5, 1);
    this.glow.position.set(0.05, 0.11, -0.045);
    this.glow.material.opacity = 0;
    this.group.add(this.glow);
    // planted: faint red ground ring so the bomb reads at distance
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 28), new THREE.MeshBasicMaterial({ color: 0xFF3A28, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    this.group.add(this.ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  get currentMode() { return this.mode; }

  /** Drop / plant at a world position. */
  placeAt(pos: THREE.Vector3, mode: 'ground' | 'planted', yaw = 0) {
    if (this.group.parent !== this.scene) this.scene.add(this.group);
    this.group.position.copy(pos);
    this.group.rotation.set(0, yaw, mode === 'ground' ? 0.12 : 0);
    this.group.scale.setScalar(mode === 'planted' ? 1.25 : 1.1);
    this.group.visible = true;
    this.mode = mode;
    this.blink = 0;
  }

  /** Strap to a carrier's back (bot torso). */
  carryOn(parent: THREE.Object3D) {
    parent.add(this.group);
    this.group.position.set(0, 0.36, 0.34);
    this.group.rotation.set(-Math.PI / 2, 0, 0);
    this.group.scale.setScalar(1.15);
    this.group.visible = true;
    this.mode = 'carried';
    this.ring.material.opacity = 0;
    this.glow.material.opacity = 0;
  }

  hide() {
    if (this.group.parent !== this.scene) this.scene.add(this.group);
    this.group.visible = false;
    this.mode = 'hidden';
  }

  /** Called each time the planted bomb beeps: flash the LED. */
  pulse() { this.blink = 1; }

  update(dt: number) {
    this.blink = Math.max(0, this.blink - dt * 7);
    const planted = this.mode === 'planted';
    const idle = this.mode === 'ground' ? 0.25 + 0.25 * Math.sin(performance.now() * 0.004) : 0;
    const k = planted ? this.blink : idle;
    this.ledMat.color.setRGB(0.23 + k * 0.77, 0.04 + k * 0.2, 0.03 + k * 0.15);
    this.glow.material.opacity = k * (planted ? 1 : 0.6);
    this.ring.material.opacity = planted ? 0.22 + this.blink * 0.5 : this.mode === 'ground' ? 0.2 : 0;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
}
