// Recoil FPS — pooled particles, tracers, decals (zero per-frame allocation)
import * as THREE from 'three';

const MAX_BURSTS = 28;
const MAX_PARTICLES = 48;
const MAX_TRACERS = 20;

interface BurstSlot {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  pos: Float32Array;
  vel: Float32Array;
  life: number;
  maxLife: number;
  grav: number;
  count: number;
  active: boolean;
}

const decalGeo = new THREE.CircleGeometry(0.035, 8);
const bulletHoleMat = new THREE.MeshBasicMaterial({ color: 0x141210, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const bloodDecalMat = new THREE.MeshBasicMaterial({ color: 0x7A0A0A, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xFFC46B, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);

export class Effects {
  private bursts: BurstSlot[] = [];
  private burstIdx = 0;
  private tracers: { mesh: THREE.Mesh; life: number; active: boolean }[] = [];
  private tracerIdx = 0;
  private holes: THREE.Mesh[] = [];
  private holeIdx = 0;
  private bloods: THREE.Mesh[] = [];
  private bloodIdx = 0;
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private flashLight: THREE.PointLight;
  flashTimer = 0;
  // scratch (no alloc in hot paths)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 200; i++) {
      const m = new THREE.Mesh(decalGeo, bulletHoleMat);
      m.visible = false; m.renderOrder = 2;
      scene.add(m); this.holes.push(m);
    }
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.3 + Math.random() * 0.3, 10), bloodDecalMat);
      m.visible = false; m.renderOrder = 2;
      scene.add(m); this.bloods.push(m);
    }
    // preallocated burst pool — buffers reused forever, never disposed
    for (let i = 0; i < MAX_BURSTS; i++) {
      const pos = new Float32Array(MAX_PARTICLES * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0 });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      scene.add(points);
      this.bursts.push({ points, mat, pos, vel: new Float32Array(MAX_PARTICLES * 3), life: 0, maxLife: 1, grav: 0, count: 0, active: false });
    }
    // pooled tracers — shared geometry, scaled per shot
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, active: false });
    }
    // ambient ground-level sand drift
    const N = 320;
    const pos = new Float32Array(N * 3);
    this.dustVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 2.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
      this.dustVel[i * 3] = 1.5 + Math.random() * 2.5;
      this.dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xD8C090, size: 0.06, transparent: true, opacity: 0.45, sizeAttenuation: true }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);

    this.flashLight = new THREE.PointLight(0xFFB86A, 0, 12);
    scene.add(this.flashLight);
  }

  private burst(pos: THREE.Vector3, count: number, color: number, speed: number, life: number, grav: number, size = 0.05, spread = 1) {
    const s = this.bursts[this.burstIdx];
    this.burstIdx = (this.burstIdx + 1) % this.bursts.length;
    const n = Math.min(count, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      s.pos[i * 3] = pos.x; s.pos[i * 3 + 1] = pos.y; s.pos[i * 3 + 2] = pos.z;
      s.vel[i * 3] = (Math.random() - 0.5) * speed * spread;
      s.vel[i * 3 + 1] = Math.random() * speed;
      s.vel[i * 3 + 2] = (Math.random() - 0.5) * speed * spread;
    }
    s.count = n; s.life = life; s.maxLife = life; s.grav = grav; s.active = true;
    s.mat.color.setHex(color); s.mat.size = size; s.mat.opacity = 0.9;
    s.points.geometry.setDrawRange(0, n);
    s.points.geometry.attributes.position.needsUpdate = true;
    s.points.visible = true;
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3) {
    this._v1.copy(pos).addScaledVector(normal, 0.03);
    this.burst(this._v1, 8, 0xC8B080, 2.2, 0.4, 4);
    this.burst(this._v1, 5, 0xFFE9B0, 3.4, 0.12, 2, 0.08); // white-hot strike flash
    const m = this.holes[this.holeIdx];
    this.holeIdx = (this.holeIdx + 1) % this.holes.length;
    m.visible = true;
    m.position.copy(pos).addScaledVector(normal, 0.012);
    this._v2.copy(pos).add(normal);
    m.lookAt(this._v2);
  }

  glassShatter(pos: THREE.Vector3) {
    this.burst(pos, 26, 0xBFE4F7, 3.2, 0.9, 9, 0.07, 1.4);
    this.burst(pos, 10, 0xFFFFFF, 1.6, 0.4, 6, 0.05);
  }

  blood(pos: THREE.Vector3) {
    this.burst(pos, 12, 0x8C1010, 2.6, 0.45, 6, 0.06);
  }

  bloodDecal(pos: THREE.Vector3) {
    const m = this.bloods[this.bloodIdx];
    this.bloodIdx = (this.bloodIdx + 1) % this.bloods.length;
    m.visible = true;
    m.position.set(pos.x, 0.035, pos.z);
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
  }

  enemyMuzzle(pos: THREE.Vector3) {
    this.burst(pos, 5, 0xFFC060, 1.5, 0.08, 0, 0.09);
  }

  playerFlash(worldPos: THREE.Vector3) {
    this.flashLight.position.copy(worldPos);
    this.flashLight.intensity = 8;
    this.flashTimer = 0.045;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    this._v1.subVectors(to, from);
    const len = this._v1.length();
    if (len < 1) return;
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const l = Math.min(len, 4);
    t.mesh.position.copy(from).addScaledVector(this._v1.normalize(), l / 2);
    t.mesh.scale.set(1, 1, l);
    t.mesh.lookAt(to);
    t.mesh.visible = true;
    t.life = 0.09;
    t.active = true;
  }

  explosion(pos: THREE.Vector3) {
    this.burst(pos, 40, 0xFFA030, 9, 0.5, 9, 0.14);
    this.burst(pos, 30, 0x555048, 5, 1.4, 1.5, 0.22, 1.4);
    this.burst(pos, 20, 0x2A2620, 7, 0.8, 7, 0.1);
    this.flashLight.position.copy(pos).y += 0.5;
    this.flashLight.intensity = 30;
    this.flashTimer = 0.12;
  }

  footDust(pos: THREE.Vector3) {
    this.burst(pos, 3, 0xC8B080, 0.7, 0.35, 1.2, 0.05);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.points.visible = false; continue; }
      const arr = b.pos;
      for (let j = 0; j < b.count * 3; j += 3) {
        arr[j] += b.vel[j] * dt;
        arr[j + 1] += b.vel[j + 1] * dt;
        arr[j + 2] += b.vel[j + 2] * dt;
        b.vel[j + 1] -= b.grav * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.mat.opacity = 0.9 * (b.life / b.maxLife);
    }
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; t.mesh.visible = false; }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashLight.intensity = 0;
    }
    const arr = this.dust.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += this.dustVel[i] * dt;
      arr[i + 1] += this.dustVel[i + 1] * dt;
      arr[i + 2] += this.dustVel[i + 2] * dt;
      if (arr[i] - playerPos.x > 45) arr[i] -= 90;
      if (arr[i] - playerPos.x < -45) arr[i] += 90;
      if (arr[i + 2] - playerPos.z > 45) arr[i + 2] -= 90;
      if (arr[i + 2] - playerPos.z < -45) arr[i + 2] += 90;
      if (arr[i + 1] > 2.4) arr[i + 1] = 0.05;
      if (arr[i + 1] < 0) arr[i + 1] = 2.2;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
}
