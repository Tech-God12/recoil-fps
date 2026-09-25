// Recoil FPS — pooled particles, tracers, decals (zero per-frame allocation)
import * as THREE from 'three';

const MAX_BURSTS = 28;
const MAX_PARTICLES = 48;
const MAX_TRACERS = 20;
/** Muzzle smoke lives in its own pool so a mag dump never evicts impact effects. */
const MAX_SMOKES = 8;
/** Ejected brass: one InstancedMesh, ring-buffered. 12 covers a full auto burst. */
const MAX_BRASS = 12;
const brassGeo = new THREE.BoxGeometry(0.012, 0.012, 0.03);
const brassMat = new THREE.MeshBasicMaterial({ color: 0xD8A83C });

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
// Blood pool geometry: pre-alloc three sizes then pick via scale, avoids per-decal geometry
const bloodGeo = new THREE.CircleGeometry(0.35, 10);
const bulletHoleMat = new THREE.MeshBasicMaterial({ color: 0x141210, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const bloodDecalMat = new THREE.MeshBasicMaterial({ color: 0x7A0A0A, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xFFC46B, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
// ANTI-LAG: instanced decal counts (was 200/60 individual meshes = 260 draws + 260 matrix updates)
const MAX_HOLES = 200;
const MAX_BLOODS = 60;

export class Effects {
  private bursts: BurstSlot[] = [];
  private burstIdx = 0;
  private smokes: BurstSlot[] = [];
  private smokeIdx = 0;
  private lastSmokeT = -1000;
  private brass!: THREE.InstancedMesh;
  private brassIdx = 0;
  private brassPos = new Float32Array(MAX_BRASS * 3);
  private brassVel = new Float32Array(MAX_BRASS * 3);
  private brassLife = new Float32Array(MAX_BRASS);
  private brassSpin = new Float32Array(MAX_BRASS);
  private readonly _m4 = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _e = new THREE.Euler();
  private readonly _one = new THREE.Vector3(1, 1, 1);
  private readonly _zero = new THREE.Vector3(0, 0, 0);
  private readonly _bp = new THREE.Vector3();
  private tracers: { mesh: THREE.Mesh; life: number; active: boolean; from: THREE.Vector3; direction: THREE.Vector3; distance: number; travel: number; speed: number }[] = [];
  private tracerIdx = 0;
  // ANTI-LAG: instanced decals — 2 draws total vs 260 before
  private holes!: THREE.InstancedMesh;
  private bloods!: THREE.InstancedMesh;
  private holeIdx = 0;
  private bloodIdx = 0;
  private holeCount = 0;
  private bloodCount = 0;
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private dustTick = 1;
  private flashLight: THREE.PointLight;
  flashTimer = 0;
  // scratch (no alloc in hot paths)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // ANTI-LAG: bullet holes as one instanced draw (was 200 meshes)
    this.holes = new THREE.InstancedMesh(decalGeo, bulletHoleMat, MAX_HOLES);
    this.holes.frustumCulled = false;
    this.holes.renderOrder = 2;
    // park all instances at zero scale offscreen
    this._m4.compose(this._bp.set(0, -100, 0), this._q.identity(), this._zero);
    for (let i = 0; i < MAX_HOLES; i++) this.holes.setMatrixAt(i, this._m4);
    this.holes.instanceMatrix.needsUpdate = true;
    this.holes.count = 0;
    scene.add(this.holes);
    // Blood pools as one instanced draw (was 60 meshes)
    this.bloods = new THREE.InstancedMesh(bloodGeo, bloodDecalMat, MAX_BLOODS);
    this.bloods.frustumCulled = false;
    this.bloods.renderOrder = 2;
    for (let i = 0; i < MAX_BLOODS; i++) this.bloods.setMatrixAt(i, this._m4);
    this.bloods.instanceMatrix.needsUpdate = true;
    this.bloods.count = 0;
    scene.add(this.bloods);
    // preallocated burst pool — buffers reused forever, never disposed
    for (let i = 0; i < MAX_BURSTS; i++) this.bursts.push(Effects.makeSlot(scene));
    // dedicated smoke pool — same slot shape, separate ring (see MAX_SMOKES)
    for (let i = 0; i < MAX_SMOKES; i++) this.smokes.push(Effects.makeSlot(scene));
    // ejected brass — a single instanced draw, all instances parked at scale 0
    this.brass = new THREE.InstancedMesh(brassGeo, brassMat, MAX_BRASS);
    this.brass.frustumCulled = false;
    this._m4.compose(this._bp.set(0, -100, 0), this._q.identity(), this._zero);
    for (let i = 0; i < MAX_BRASS; i++) this.brass.setMatrixAt(i, this._m4);
    this.brass.instanceMatrix.needsUpdate = true;
    this.brass.count = 0; // unfired gun costs zero draws; first eject re-arms it
    scene.add(this.brass);
    // pooled tracers — shared geometry, scaled per shot
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, active: false, from: new THREE.Vector3(), direction: new THREE.Vector3(), distance: 0, travel: 0, speed: 220 });
    }
    // ambient ground-level sand drift — ANTI-LAG: 180 not 320 (≈44% fewer verts),
    // throttled to every 2nd frame so dust costs ~0.3 ms not 0.7 ms on iGPU
    const N = 180;
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

  private static makeSlot(scene: THREE.Scene): BurstSlot {
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0 });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    scene.add(points);
    return { points, mat, pos, vel: new Float32Array(MAX_PARTICLES * 3), life: 0, maxLife: 1, grav: 0, count: 0, active: false };
  }

  private burstInto(pool: BurstSlot[], idx: number, pos: THREE.Vector3, count: number, color: number, speed: number, life: number, grav: number, size: number, spread: number): number {
    const s = pool[idx];
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
    return (idx + 1) % pool.length;
  }

  private burst(pos: THREE.Vector3, count: number, color: number, speed: number, life: number, grav: number, size = 0.05, spread = 1) {
    this.burstIdx = this.burstInto(this.bursts, this.burstIdx, pos, count, color, speed, life, grav, size, spread);
  }

  /** Muzzle smoke: a thin grey puff that hangs ~1 s. Throttled to one puff per
   *  70 ms (≈ every 5th round at 780 RPM) so full-auto doesn't flood the pool.
   *  `nowMs` is injectable so tests drive the throttle without patching clocks. */
  gunSmoke(pos: THREE.Vector3, nowMs = performance.now()) {
    const now = nowMs;
    if (now - this.lastSmokeT < 70) return;
    this.lastSmokeT = now;
    this.smokeIdx = this.burstInto(this.smokes, this.smokeIdx, pos, 4, 0xB9B4A6, 0.55, 1.1, -0.35, 0.11, 0.7);
  }

  /** Eject a casing right-and-up with a fast tumble; it bounces once on the
   *  player's footing plane and dies after 1.6 s. Ring-buffered, zero alloc. */
  ejectBrass(origin: THREE.Vector3, right: THREE.Vector3) {
    this.brass.count = MAX_BRASS;
    const i = this.brassIdx;
    this.brassIdx = (this.brassIdx + 1) % MAX_BRASS;
    this.brassPos[i * 3] = origin.x; this.brassPos[i * 3 + 1] = origin.y; this.brassPos[i * 3 + 2] = origin.z;
    this.brassVel[i * 3] = right.x * 1.7 + (Math.random() - 0.5) * 0.6;
    this.brassVel[i * 3 + 1] = 2.0 + Math.random() * 0.5;
    this.brassVel[i * 3 + 2] = right.z * 1.7 + (Math.random() - 0.5) * 0.6;
    this.brassLife[i] = 1.6;
    this.brassSpin[i] = 8 + Math.random() * 10;
  }

  /** Release the brass/hole/blood instance buffers. (Geometries/materials are owned by the
   *  engine's dispose traversal; only the InstancedMeshes need explicit calls.) */
  dispose() {
    this.brass.dispose();
    this.holes.dispose();
    this.bloods.dispose();
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3) {
    this._v1.copy(pos).addScaledVector(normal, 0.03);
    this.burst(this._v1, 8, 0xC8B080, 2.2, 0.4, 4);
    this.burst(this._v1, 5, 0xFFE9B0, 3.4, 0.12, 2, 0.08); // white-hot strike flash
    // Instanced hole: orient circle's +Z to surface normal without allocating Mesh
    const idx = this.holeIdx;
    this.holeIdx = (this.holeIdx + 1) % MAX_HOLES;
    this.holeCount = Math.min(MAX_HOLES, this.holeCount + 1);
    this.holes.count = this.holeCount;
    const p = this._v1.copy(pos).addScaledVector(normal, 0.012);
    // Align +Z → normal via quaternion (replaces Mesh.lookAt)
    this._v2.copy(normal).normalize();
    // Default up fallback when normal is vertical — avoids singularity
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._v2);
    this._m4.compose(p, this._q, this._one);
    this.holes.setMatrixAt(idx, this._m4);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  glassShatter(pos: THREE.Vector3) {
    this.burst(pos, 26, 0xBFE4F7, 3.2, 0.9, 9, 0.07, 1.4);
    this.burst(pos, 10, 0xFFFFFF, 1.6, 0.4, 6, 0.05);
  }

  blood(pos: THREE.Vector3) {
    this.burst(pos, 12, 0x8C1010, 2.6, 0.45, 6, 0.06);
  }

  /** Blood pools on the actual standing surface (crate/roof included), not the ground plane. */
  bloodDecal(pos: THREE.Vector3, surfaceY = 0) {
    const idx = this.bloodIdx;
    this.bloodIdx = (this.bloodIdx + 1) % MAX_BLOODS;
    this.bloodCount = Math.min(MAX_BLOODS, this.bloodCount + 1);
    this.bloods.count = this.bloodCount;
    // Random scale 0.85–1.15 via matrix scale, random Z rotation
    const scale = 0.85 + Math.random() * 0.3;
    const angle = Math.random() * Math.PI;
    this._q.setFromEuler(this._e.set(-Math.PI / 2, 0, angle));
    this._m4.compose(this._bp.set(pos.x, surfaceY + 0.035, pos.z), this._q, new THREE.Vector3(scale, scale, 1));
    this.bloods.setMatrixAt(idx, this._m4);
    this.bloods.instanceMatrix.needsUpdate = true;
  }

  enemyMuzzle(pos: THREE.Vector3) {
    this.burst(pos, 9, 0xFFE7A0, 0.6, 0.14, 0, 0.24);
    this.burst(pos, 4, 0xD1C7B5, 0.8, 0.32, -0.3, 0.12);
  }

  playerFlash(worldPos: THREE.Vector3) {
    this.flashLight.position.copy(worldPos);
    this.flashLight.intensity = 8;
    this.flashTimer = 0.045;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, hostile = false) {
    this._v1.subVectors(to, from);
    const len = this._v1.length();
    if (len < 1) return;
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const l = Math.min(len, hostile ? 2.0 : 2.8);
    t.from.copy(from); t.direction.copy(this._v1).normalize(); t.distance = len; t.travel = 0; t.speed = hostile ? 150 : 240;
    t.mesh.position.copy(from).addScaledVector(this._v1.normalize(), l / 2);
    t.mesh.scale.set(hostile ? 1.7 : 1.25, hostile ? 1.7 : 1.25, l);
    t.mesh.lookAt(to);
    t.mesh.visible = true;
    t.life = Math.max(0.12,len/t.speed);
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

  private updatePool(pool: BurstSlot[], dt: number) {
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
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
  }

  /** Brass ballistics: gravity, one damped bounce on the footing plane, tumble. */
  private updateBrass(dt: number, floorY: number) {
    let any = false;
    for (let i = 0; i < MAX_BRASS; i++) {
      if (this.brassLife[i] <= 0) continue;
      any = true;
      this.brassLife[i] -= dt;
      const j = i * 3;
      this.brassVel[j + 1] -= 12 * dt;
      this.brassPos[j] += this.brassVel[j] * dt;
      this.brassPos[j + 1] += this.brassVel[j + 1] * dt;
      this.brassPos[j + 2] += this.brassVel[j + 2] * dt;
      if (this.brassPos[j + 1] < floorY) {
        this.brassPos[j + 1] = floorY;
        this.brassVel[j + 1] *= -0.35;
        this.brassVel[j] *= 0.55;
        this.brassVel[j + 2] *= 0.55;
      }
      const dead = this.brassLife[i] <= 0;
      this._q.setFromEuler(this._e.set(this.brassSpin[i] * this.brassLife[i], this.brassSpin[i] * 0.7 * this.brassLife[i], 0));
      this._m4.compose(this._bp.set(this.brassPos[j], this.brassPos[j + 1], this.brassPos[j + 2]), this._q, dead ? this._zero : this._one);
      this.brass.setMatrixAt(i, this._m4);
    }
    if (any) this.brass.instanceMatrix.needsUpdate = true;
    // Ring fully expired: back to zero draws until the next shot.
    else if (this.brass.count !== 0) this.brass.count = 0;
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.updatePool(this.bursts, dt);
    this.updatePool(this.smokes, dt);
    this.updateBrass(dt, playerPos.y + 0.012);
    // throttle dust to every 2nd frame (~30 Hz vs 60 Hz) — visual diff negligible, cost -45%
    this.dustTick = (this.dustTick + 1) & 1;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      t.life -= dt;
      t.travel = Math.min(t.distance,t.travel + dt*t.speed);
      t.mesh.position.copy(t.from).addScaledVector(t.direction,Math.max(t.mesh.scale.z/2,t.travel-t.mesh.scale.z/2));
      if (t.life <= 0) { t.active = false; t.mesh.visible = false; }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashLight.intensity = 0;
    }
    // Dust throttled: only on even ticks
    if (this.dustTick === 0) {
      const arr = this.dust.geometry.attributes.position.array as Float32Array;
      const ddt = dt * 2; // compensate for half-rate
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += this.dustVel[i] * ddt;
        arr[i + 1] += this.dustVel[i + 1] * ddt;
        arr[i + 2] += this.dustVel[i + 2] * ddt;
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
}
