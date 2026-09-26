// Recoil FPS — pooled particles, tracers, decals (zero per-frame allocation)
import * as THREE from 'three';

const MAX_BURSTS = 28;
const MAX_PARTICLES = 48;
const MAX_TRACERS = 20;
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

const decalGeo = new THREE.CircleGeometry(0.035, 10);
const bulletHoleMat = new THREE.MeshBasicMaterial({ color: 0x141210, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const bloodDecalMat = new THREE.MeshBasicMaterial({ color: 0x7A0A0A, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const bloodGeo = new THREE.CircleGeometry(1, 10);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xFFC46B, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);

export class Effects {
  private bursts: BurstSlot[] = [];
  private burstIdx = 0;
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
  // Bullet holes + blood are now instanced (2 draws total, not 260). Each instance
  // is parked at scale 0 below the world when unused, so an empty match costs
  // zero visible fragments and zero graph traversal.
  private holesMesh!: THREE.InstancedMesh;
  private bloodMesh!: THREE.InstancedMesh;
  private holeIdx = 0;
  private bloodIdx = 0;
  /** Legacy array exposure for any external count checks — kept as getters below. */
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private flashLight: THREE.PointLight;
  flashTimer = 0;
  // scratch (no alloc in hot paths)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _upZ = new THREE.Vector3(0, 0, 1);
  private readonly _scale = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Holes: one InstancedMesh, 200 instances. Hidden instances sit at scale 0
    // 100 m below the map (never frustum-culled, still batched).
    this.holesMesh = new THREE.InstancedMesh(decalGeo, bulletHoleMat, 200);
    this.holesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.holesMesh.frustumCulled = false;
    this.holesMesh.renderOrder = 2;
    this.holesMesh.count = 200;
    this._m4.compose(this._bp.set(0, -100, 0), this._q.identity(), this._zero);
    for (let i = 0; i < 200; i++) this.holesMesh.setMatrixAt(i, this._m4);
    this.holesMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.holesMesh);
    // Blood: one InstancedMesh, 60 instances, unit disc scaled per splat so
    // the random radius (0.3–0.6) lives in the matrix, not in 60 geometries.
    this.bloodMesh = new THREE.InstancedMesh(bloodGeo, bloodDecalMat, 60);
    this.bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bloodMesh.frustumCulled = false;
    this.bloodMesh.renderOrder = 2;
    this.bloodMesh.count = 60;
    for (let i = 0; i < 60; i++) this.bloodMesh.setMatrixAt(i, this._m4);
    this.bloodMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.bloodMesh);
    // preallocated burst pool — buffers reused forever, never disposed
    for (let i = 0; i < MAX_BURSTS; i++) this.bursts.push(Effects.makeSlot(scene));
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

  /**
   * Tiny muzzle residue: one short-lived grey-amber particle using the existing
   * burst pool. It reads as hot propellant without becoming a sight-obscuring
   * smoke cloud or allocating a second particle system per shot.
   */
  gunSmoke(pos: THREE.Vector3) {
    this.burst(pos, 1, 0xC8B88D, 0.16, 0.08, -0.05, 0.025, 0.2);
  }

  /** Eject a casing right-and-up with a fast tumble; it bounces once on the
   * player's footing plane and dies after 1.6 s. Ring-buffered, zero alloc. */
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

  /** Release instance buffers. Geometries/materials are owned by the engine's
   *  dispose traversal; only InstancedMeshes need an explicit dispose. */
  dispose() {
    this.brass.dispose();
    this.holesMesh.dispose();
    this.bloodMesh.dispose();
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3) {
    this._v1.copy(pos).addScaledVector(normal, 0.03);
    this.burst(this._v1, 8, 0xC8B080, 2.2, 0.4, 4);
    this.burst(this._v1, 5, 0xFFE9B0, 3.4, 0.12, 2, 0.08); // white-hot strike flash
    // orient the disc so its +Z faces the surface normal (CircleGeometry lies in XY)
    this._v3.copy(pos).addScaledVector(normal, 0.012);
    // normal may be zero if the caller passed a degenerate — guard against NaN quat
    const nlen = normal.lengthSq();
    if (nlen > 1e-6) this._q.setFromUnitVectors(this._upZ, this._v2.copy(normal).normalize());
    else this._q.identity();
    this._m4.compose(this._v3, this._q, this._one);
    this.holesMesh.setMatrixAt(this.holeIdx, this._m4);
    this.holesMesh.instanceMatrix.needsUpdate = true;
    this.holeIdx = (this.holeIdx + 1) % 200;
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
    const r = 0.30 + Math.random() * 0.30;
    this._v3.set(pos.x, surfaceY + 0.035, pos.z);
    this._e.set(-Math.PI / 2, 0, Math.random() * Math.PI);
    this._q.setFromEuler(this._e);
    this._scale.set(r, r, 1);
    this._m4.compose(this._v3, this._q, this._scale);
    this.bloodMesh.setMatrixAt(this.bloodIdx, this._m4);
    this.bloodMesh.instanceMatrix.needsUpdate = true;
    this.bloodIdx = (this.bloodIdx + 1) % 60;
  }

  enemyMuzzle(pos: THREE.Vector3) {
    this.burst(pos, 9, 0xFFE7A0, 0.6, 0.14, 0, 0.24);
    this.burst(pos, 4, 0xD1C7B5, 0.8, 0.32, -0.3, 0.12);
  }

  playerFlash(worldPos: THREE.Vector3) {
    this.flashLight.position.copy(worldPos);
    this.flashLight.color.setHex(0xFFB86A);
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
    this.flashLight.color.setHex(0xFFB86A);
    this.flashLight.intensity = 30;
    this.flashTimer = 0.12;
  }

  // ---- Field kit effects: same burst pool, kit-specific colours and motion. ----

  /** Hot metal sparks off a barricade plate: fast, short, heavy gravity. */
  sparks(pos: THREE.Vector3) {
    this.burst(pos, 14, 0xFFC060, 5.2, 0.32, 14, 0.045, 1.6);
    this.burst(pos, 4, 0xFFF4D0, 2.4, 0.08, 0, 0.1); // white strike flash
  }

  /** Dust ring kicked up when the barricade slams down. */
  slamDust(pos: THREE.Vector3) {
    this.burst(pos, 30, 0xC8B080, 3.4, 0.9, 2.2, 0.09, 2.2);
    this.burst(pos, 12, 0x8C7A58, 1.6, 1.3, 0.6, 0.16, 2.6);
  }

  /** Sonar ping at the dart: cyan motes thrown up, plus a cold light flash. */
  sonarPulse(pos: THREE.Vector3) {
    this.burst(pos, 18, 0x5FE3FF, 2.6, 0.7, -0.8, 0.06, 1.8);
    this.kitFlash(pos, 0x5FE3FF, 9, 0.16);
  }

  /** Hologram materialise / glitch-out: cyan shards spraying outward. */
  holoBurst(pos: THREE.Vector3, big = false) {
    this.burst(pos, big ? 40 : 22, 0x6FE8FF, big ? 6.5 : 3.2, big ? 0.6 : 0.45, 0.5, big ? 0.09 : 0.06, 2.4);
    this.burst(pos, big ? 16 : 8, 0xE8FDFF, big ? 3 : 1.6, 0.25, 0, 0.12);
    this.kitFlash(pos, 0x6FE8FF, big ? 26 : 10, big ? 0.22 : 0.12);
  }

  /** Mine jumps out of the ground: a puff of dirt before the blast. */
  mineKick(pos: THREE.Vector3) {
    this.burst(pos, 16, 0x8C7A58, 2.8, 0.6, 5, 0.08, 1.2);
  }

  /** Med field pulse: green motes drifting up out of the ring. */
  healMotes(pos: THREE.Vector3) {
    this.burst(pos, 12, 0x6CFF9A, 1.1, 1.2, -1.2, 0.05, 2.4);
  }

  /** Coloured point-light pop for kit events (shares the muzzle/explosion light). */
  kitFlash(pos: THREE.Vector3, color: number, intensity: number, seconds: number) {
    this.flashLight.position.copy(pos);
    this.flashLight.color.setHex(color);
    this.flashLight.intensity = intensity;
    this.flashTimer = seconds;
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
    this.updateBrass(dt, playerPos.y + 0.012);
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
