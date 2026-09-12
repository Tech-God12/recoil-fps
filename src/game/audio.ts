// Recoil FPS — Spatial Audio Engine (Web Audio API with HRTF PannerNodes)
export class SpatialAudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  echoBus: DelayNode | null = null;
  echoFb: GainNode | null = null;
  echoGain: GainNode | null = null;
  indoor = false;
  private windStarted = false;
  private noiseBuf: AudioBuffer | null = null;

  ensure(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);

      // Reverb/Echo bus
      this.echoBus = this.ctx.createDelay(1.0);
      this.echoBus.delayTime.value = 0.16;
      this.echoFb = this.ctx.createGain();
      this.echoFb.gain.value = 0.24;
      this.echoGain = this.ctx.createGain();
      this.echoGain.gain.value = 0.32;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      this.echoBus.connect(this.echoFb);
      this.echoFb.connect(this.echoBus);
      this.echoBus.connect(lp);
      lp.connect(this.echoGain);
      this.echoGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.windStarted) {
      this.windStarted = true;
      this.startAmbientWind();
    }
    return this.ctx;
  }

  // Update Listener position & orientation for HRTF spatialization
  updateListener(posX: number, posY: number, posZ: number, fwdX: number, fwdY: number, fwdZ: number, upX = 0, upY = 1, upZ = 0) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(posX, t);
      l.positionY.setValueAtTime(posY, t);
      l.positionZ.setValueAtTime(posZ, t);
      l.forwardX.setValueAtTime(fwdX, t);
      l.forwardY.setValueAtTime(fwdY, t);
      l.forwardZ.setValueAtTime(fwdZ, t);
      l.upX.setValueAtTime(upX, t);
      l.upY.setValueAtTime(upY, t);
      l.upZ.setValueAtTime(upZ, t);
    } else {
      // Fallback for older Web Audio implementations
      l.setPosition(posX, posY, posZ);
      l.setOrientation(fwdX, fwdY, fwdZ, upX, upY, upZ);
    }
  }

  // Create standard HRTF PannerNode as specified:
  // panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 80, rolloffFactor: 2
  createSpatialPanner(x: number, y: number, z: number): PannerNode {
    const ctx = this.ensure();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 80;
    panner.rolloffFactor = 2;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;

    const t = ctx.currentTime;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(x, t);
      panner.positionY.setValueAtTime(y, t);
      panner.positionZ.setValueAtTime(z, t);
    } else {
      panner.setPosition(x, y, z);
    }
    panner.connect(this.master!);
    if (this.echoBus) {
      const eg = ctx.createGain();
      eg.gain.value = 0.25;
      panner.connect(eg);
      eg.connect(this.echoBus);
    }
    return panner;
  }

  setMasterVolume(v: number) {
    this.ensure();
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1.2, v)) * 0.85;
  }

  setIndoor(indoor: boolean) {
    if (!this.ctx || !this.echoBus || !this.echoFb) return;
    if (indoor === this.indoor) return;
    this.indoor = indoor;
    const t = this.ctx.currentTime;
    this.echoBus.delayTime.linearRampToValueAtTime(indoor ? 0.06 : 0.16, t + 0.15);
    this.echoFb.gain.linearRampToValueAtTime(indoor ? 0.42 : 0.22, t + 0.15);
  }

  private noise(): AudioBuffer {
    const ctx = this.ensure();
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  // 2D Ambient Desert Wind Layer (non-spatial)
  private startAmbientWind() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 280;
    const g = ctx.createGain();
    g.gain.value = 0.055;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
    lfo.start();
  }

  // ==================== WEAPON SOUNDS ====================
  fireM4() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    // Layer 1: Sharp transient punch
    this.burstDirect({ dur: 0.035, gain: 0.95, freq: 3400, q: 0.7, hp: 800 });
    // Layer 2: Mid body crack
    this.burstDirect({ dur: 0.11, gain: 0.75, freq: 950, q: 0.8, toEcho: 0.45 });
    // Layer 3: Bass thump / pressure wave
    this.burstDirect({ dur: 0.18, gain: 0.55, freq: 160, q: 0.6, type: 'lowpass' });
    // Layer 4: Sub harmonic punch
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.55, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og); og.connect(this.master!);
    o.start(t); o.stop(t + 0.11);
    // Bolt mechanical slap
    this.burstDirect({ dur: 0.045, gain: 0.18, freq: 4800, q: 2.2, when: 0.045 });
  }

  firePistol() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    this.burstDirect({ dur: 0.03, gain: 0.85, freq: 2800, q: 0.8, hp: 700 });
    this.burstDirect({ dur: 0.09, gain: 0.55, freq: 720, q: 0.9, toEcho: 0.35 });
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(og); og.connect(this.master!);
    o.start(t); o.stop(t + 0.095);
  }

  dryFire() {
    this.ensure();
    this.burstDirect({ dur: 0.025, gain: 0.4, freq: 2400, q: 3.5 });
  }

  // AK-47: deep, grittier 7.62x39 grind with a duller crack and more mid-body weight
  fireAK() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    this.burstDirect({ dur: 0.05, gain: 0.95, freq: 2300, q: 0.7, hp: 500 });
    this.burstDirect({ dur: 0.14, gain: 0.7, freq: 620, q: 0.8, toEcho: 0.4 });
    this.burstDirect({ dur: 0.22, gain: 0.6, freq: 120, q: 0.5, type: 'lowpass' });
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og); og.connect(this.master!); o.start(t); o.stop(t + 0.13);
    this.burstDirect({ dur: 0.05, gain: 0.16, freq: 4400, q: 1.8, when: 0.06 });
  }

  // AWM .338 Lapua: huge, distant boom + sharp supersonic crack
  fireSniper() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    this.burstDirect({ dur: 0.09, gain: 1.0, freq: 1800, q: 0.6, hp: 400 });
    this.burstDirect({ dur: 0.28, gain: 0.85, freq: 480, q: 0.7, toEcho: 0.5 });
    this.burstDirect({ dur: 0.5, gain: 0.7, freq: 80, q: 0.4, type: 'lowpass' });
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(og); og.connect(this.master!); o.start(t); o.stop(t + 0.46);
    // delayed supersonic crack
    this.burstDirect({ dur: 0.04, gain: 0.4, freq: 5200, q: 2, when: 0.07 });
  }

  // MP7A1 4.6mm: tight, fast, sharp PDW crack
  fireSMG() {
    this.ensure();
    this.burstDirect({ dur: 0.03, gain: 0.85, freq: 3800, q: 0.9, hp: 900 });
    this.burstDirect({ dur: 0.08, gain: 0.55, freq: 1050, q: 0.8, toEcho: 0.3 });
    this.burstDirect({ dur: 0.12, gain: 0.4, freq: 200, q: 0.5, type: 'lowpass' });
  }

  // SPATIAL: Enemy Gunfire with exact 3D HRTF Panning
  enemyFireSpatial(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;
    // Transient
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(bp);
    bp.connect(g);
    g.connect(panner);
    src.start(t);
    src.stop(t + 0.1);

    // Body thump
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(og);
    og.connect(panner);
    o.start(t);
    o.stop(t + 0.14);
  }

  // SPATIAL: Grenade Explosion with exact position
  explosionSpatial(wx: number, wy: number, wz: number, distToPlayer: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;

    // Heavy bass detonation
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.2, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(og);
    og.connect(panner);
    o.start(t);
    o.stop(t + 0.8);

    // Cracking debris & blast wave
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 550;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    src.connect(lp);
    lp.connect(g);
    g.connect(panner);
    src.start(t);
    src.stop(t + 0.85);

    // Hearing loss ringing if close
    if (distToPlayer < 10) {
      const ring = ctx.createOscillator();
      ring.frequency.value = 3600;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.2, t + 0.05);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      ring.connect(rg);
      rg.connect(this.master!);
      ring.start(t + 0.05);
      ring.stop(t + 2.9);
    }
  }

  // SPATIAL: Glass shatter — bright crack + tinkling shards
  glassBreakSpatial(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(hp); hp.connect(g); g.connect(panner); src.start(t); src.stop(t + 0.2);
    for (let i = 0; i < 9; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = 2400 + Math.random() * 4200; const st = t + 0.03 + Math.random() * 0.35;
      o.frequency.setValueAtTime(f, st); o.frequency.exponentialRampToValueAtTime(f * 0.7, st + 0.12);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.12, st); og.gain.exponentialRampToValueAtTime(0.001, st + 0.14);
      o.connect(og); og.connect(panner); o.start(st); o.stop(st + 0.15);
    }
  }

  // SPATIAL: Grenade bounce
  grenadeBounceSpatial(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(bp);
    bp.connect(g);
    g.connect(panner);
    src.start(t);
    src.stop(t + 0.05);
  }

  // Reload stages
  magOut() {
    this.ensure();
    this.burstDirect({ dur: 0.06, gain: 0.45, freq: 1200, q: 2.2 });
  }
  magIn() {
    this.ensure();
    this.burstDirect({ dur: 0.05, gain: 0.55, freq: 880, q: 2.5 });
  }
  boltRelease() {
    this.ensure();
    this.burstDirect({ dur: 0.055, gain: 0.65, freq: 2400, q: 1.8 });
  }
  forwardAssist() {
    this.ensure();
    this.burstDirect({ dur: 0.035, gain: 0.4, freq: 3000, q: 3 });
  }

  // Movement: Jump & Landing
  jumpGrunt() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + 0.15);
  }

  jumpLand(surface: 'sand' | 'concrete' | 'wood') {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + 0.17);

    const f = surface === 'concrete' ? 1800 : surface === 'wood' ? 650 : 850;
    this.burstDirect({ dur: 0.1, gain: 0.35, freq: f, q: 1.2 });
  }

  // Slide sound: cloth/body drag
  slideDrag(surface: 'sand' | 'concrete' | 'wood') {
    const f = surface === 'concrete' ? 1400 : surface === 'wood' ? 550 : 750;
    this.burstDirect({ dur: 0.55, gain: 0.28, freq: f, q: 0.8, attack: 0.05 });
  }

  // Hit & Kill Confirm (Iconic CoD ding)
  hitMarker() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2600, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + 0.055);
  }

  killConfirm() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    // Layer 1
    const o1 = ctx.createOscillator();
    o1.type = 'square';
    o1.frequency.setValueAtTime(1900, t);
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.3, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o1.connect(g1); g1.connect(this.master!);
    o1.start(t); o1.stop(t + 0.065);
    // Layer 2
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(2900, t + 0.04);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.28, t + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o2.connect(g2); g2.connect(this.master!);
    o2.start(t + 0.04); o2.stop(t + 0.13);
  }

  playerHurt() {
    this.ensure();
    this.burstDirect({ dur: 0.12, gain: 0.45, freq: 350, q: 0.8 });
  }

  footstep(surface: 'sand' | 'concrete' | 'wood', sprint: boolean, crouch = false) {
    const g = (sprint ? 0.15 : crouch ? 0.045 : 0.085);
    if (surface === 'sand') {
      this.burstDirect({ dur: 0.07, gain: g, freq: 850, q: 0.6 });
    } else if (surface === 'concrete') {
      this.burstDirect({ dur: 0.05, gain: g, freq: 1750, q: 1.4 });
    } else {
      this.burstDirect({ dur: 0.06, gain: g, freq: 620, q: 1.1 });
    }
  }

  pinPull() { this.ensure(); this.burstDirect({ dur: 0.035, gain: 0.35, freq: 3200, q: 3 }); }
  throwWhoosh() { this.ensure(); this.burstDirect({ dur: 0.16, gain: 0.2, freq: 950, q: 0.5, attack: 0.04 }); }

  fleshImpact(_pan = 0) {
    this.burstDirect({ dur: 0.06, gain: 0.45, freq: 520, q: 1.2 });
  }

  bulletImpact(_pan = 0, dist = 0) {
    const a = Math.max(0.1, 1 - dist / 50);
    this.burstDirect({ dur: 0.04, gain: 0.35 * a, freq: 2400, q: 1.6 });
  }

  flashRing() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const ring = ctx.createOscillator();
    ring.frequency.value = 3800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    ring.connect(g);
    g.connect(this.master!);
    ring.start(t);
    ring.stop(t + 2.3);
  }

  // Backwards-compatible aliases if invoked directly with distance/pan
  enemyFire(dist: number, _pan = 0) {
    const a = Math.max(0.1, 1 - dist / 80);
    this.burstDirect({ dur: 0.08, gain: 0.55 * a, freq: 1600, q: 1.0 });
  }

  explosion(distToPlayer: number, _pan = 0) {
    const a = Math.max(0.1, 1 - distToPlayer / 70);
    this.burstDirect({ dur: 0.7, gain: 1.1 * a, freq: 450, q: 0.6, type: 'lowpass' });
  }

  grenadeBounce(_pan = 0, dist = 0) {
    const a = Math.max(0.1, 1 - dist / 30);
    this.burstDirect({ dur: 0.05, gain: 0.35 * a, freq: 1500, q: 2 });
  }

  radioCallout(kind: string) {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    this.burstDirect({ dur: 0.04, gain: 0.14, freq: 2400, q: 4 });
    const notes: Record<string, number[]> = {
      contact: [550, 680, 550],
      flank: [460, 460, 640],
      grenade: [720, 720],
      mandown: [620, 440, 320],
      fallback: [400, 540, 400],
    };
    const seq = notes[kind] || [500, 600];
    seq.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t + 0.05 + i * 0.08);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.11 + i * 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, t + 0.05 + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + i * 0.08);
      o.connect(g); g.connect(this.master!);
      o.start(t + 0.05 + i * 0.08);
      o.stop(t + 0.13 + i * 0.08);
    });
  }

  private burstDirect(opts: {
    dur: number; gain: number; freq: number; q?: number; type?: BiquadFilterType;
    attack?: number; toEcho?: number; when?: number; hp?: number;
  }) {
    const ctx = this.ensure();
    const t = ctx.currentTime + (opts.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f);
    let out: AudioNode = f;
    if (opts.hp) {
      const h = ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = opts.hp;
      f.connect(h);
      out = h;
    }
    out.connect(g);
    g.connect(this.master!);
    if (opts.toEcho && this.echoBus) {
      const eg = ctx.createGain();
      eg.gain.value = opts.toEcho;
      g.connect(eg);
      eg.connect(this.echoBus);
    }
    src.start(t);
    src.stop(t + opts.dur + 0.05);
  }
}

export const audio = new SpatialAudioEngine();
