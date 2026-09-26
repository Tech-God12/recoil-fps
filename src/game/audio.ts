// Recoil FPS — Spatial Audio Engine (Web Audio API with HRTF PannerNodes)
export type StepSurface = 'sand' | 'concrete' | 'wood' | 'metal' | 'gravel' | 'grass';

export interface MixSettings {
  /** 0-1.5 weapon/world SFX trim. */
  sfx?: number;
  /** 0-1.5 footstep + foley trim. */
  footsteps?: number;
  /** 0-1 stingers and music beds. */
  music?: number;
  /** Output limiting: 'night' squashes hard for headphones after dark. */
  range?: 'night' | 'normal' | 'wide';
}

export class SpatialAudioEngine {
  ctx: AudioContext | null = null;
  /** SFX bus. Everything that is not a footstep or music connects here. */
  master: GainNode | null = null;
  /** True output trim, downstream of every bus — this is the master volume slider. */
  out: GainNode | null = null;
  /** Footsteps, foley and gear rattle. Separately mixable: players fight over this. */
  stepBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  comp: DynamicsCompressorNode | null = null;
  makeup: GainNode | null = null;
  /** Optional output limiter for the dynamic-range preset; bypassed on 'normal'. */
  rangeComp: DynamicsCompressorNode | null = null;
  echoBus: DelayNode | null = null;
  echoFb: GainNode | null = null;
  echoGain: GainNode | null = null;
  indoor = false;
  private windStarted = false;
  private noiseBuf: AudioBuffer | null = null;
  // Volume is stored even before the AudioContext exists: a settings tweak on the main
  // menu must not spin up the context (and the wind bed!) outside a live mission.
  private volume01 = 1;
  private mix: Required<MixSettings> = { sfx: 1, footsteps: 1, music: 0.6, range: 'normal' };
  private spatialVoices = new Map<PannerNode,{send:GainNode; expires:number}>();
  /** Which foot is next. Real walking alternates; identical repeats sound robotic. */
  private footLeft = false;

  ensure(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mix.sfx;
      // Master bus glue: stacked gunshot bursts (gains 1.0 + 0.68 + 0.42) plus
      // explosions and callouts used to hard-clip the destination. Gentle 4:1
      // at −18 dB keeps transients punchy without the digital crunch.
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.18;
      // +1 dB makeup restores the body the glue takes; peaks stay controlled
      // because the squash happens before this gain stage, not after.
      this.makeup = this.ctx.createGain();
      this.makeup.gain.value = 1.12;
      // Bus tree: sfx / footsteps / music sum into `out` (the master volume), then
      // through the locked glue compressor and an optional dynamic-range limiter.
      this.out = this.ctx.createGain();
      this.out.gain.value = Math.max(0, Math.min(1.2, this.volume01)) * 0.85;
      this.stepBus = this.ctx.createGain();
      this.stepBus.gain.value = this.mix.footsteps;
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.mix.music;
      this.master.connect(this.out);
      this.stepBus.connect(this.out);
      this.musicBus.connect(this.out);
      this.out.connect(this.comp);
      this.comp.connect(this.makeup);
      this.rangeComp = this.ctx.createDynamicsCompressor();
      this.rangeComp.threshold.value = 0;
      this.rangeComp.ratio.value = 1;
      this.rangeComp.attack.value = 0.002;
      this.rangeComp.release.value = 0.25;
      this.makeup.connect(this.rangeComp);
      this.rangeComp.connect(this.ctx.destination);
      this.applyMix();

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
    for (const [node,voice] of this.spatialVoices) {
      if (voice.expires<=ctx.currentTime || this.spatialVoices.size>=24) {
        node.disconnect(); voice.send.disconnect(); this.spatialVoices.delete(node);
      }
    }
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
      this.spatialVoices.set(panner,{send:eg,expires:ctx.currentTime+3});
    }
    return panner;
  }

  setMasterVolume(v: number) {
    this.volume01 = Math.max(0, Math.min(1.2, v));
    // Deliberately does NOT call ensure(): adjusting volume from the menu before the
    // first deploy must not wake the AudioContext and start the ambient wind forever.
    if (this.ctx && this.out) this.out.gain.value = this.volume01 * 0.85;
  }

  /** Per-bus trims + output limiting. Same no-wake contract as setMasterVolume(). */
  setMix(m: MixSettings) {
    if (m.sfx !== undefined) this.mix.sfx = Math.max(0, Math.min(1.5, m.sfx));
    if (m.footsteps !== undefined) this.mix.footsteps = Math.max(0, Math.min(1.5, m.footsteps));
    if (m.music !== undefined) this.mix.music = Math.max(0, Math.min(1.5, m.music));
    if (m.range !== undefined) this.mix.range = m.range;
    this.applyMix();
  }

  private applyMix() {
    if (!this.ctx) return;
    if (this.master) this.master.gain.value = this.mix.sfx;
    if (this.stepBus) this.stepBus.gain.value = this.mix.footsteps;
    if (this.musicBus) this.musicBus.gain.value = this.mix.music;
    if (this.rangeComp) {
      // 'night' pulls quiet detail up and caps the gunfire; 'wide' gets out of the way.
      const r = this.mix.range;
      this.rangeComp.threshold.value = r === 'night' ? -30 : r === 'wide' ? 0 : -6;
      this.rangeComp.ratio.value = r === 'night' ? 8 : r === 'wide' ? 1 : 3;
    }
  }

  /** Freeze the whole audio bed (wind + echo + in-flight one-shots) while paused or between missions. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
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
  /** Per-shot frequency scatter so automatic fire never sounds like a loop pedal. */
  private rf(freq: number, spread = 0.10): number {
    return freq * (1 - spread / 2 + Math.random() * spread);
  }

  /** Pitched sub-thump shared by the rifle voices (each caller picks its own register). */
  private subThump(startHz: number, endHz: number, gain: number, dur: number, type: OscillatorType = 'triangle') {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(this.rf(startHz, 0.06), t);
    o.frequency.exponentialRampToValueAtTime(endHz, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
    o.connect(og); og.connect(this.master!);
    o.start(t); o.stop(t + dur * 1.2);
    o.onended = () => { o.disconnect(); og.disconnect(); };
  }

  // M416 5.56: bright, tight, FAST — all attack, short tail. The "sewing machine".
  fireM4() {
    this.burstDirect({ dur: 0.028, gain: 1.0, freq: this.rf(3900), q: 0.7, hp: 1100 });
    this.burstDirect({ dur: 0.09, gain: 0.68, freq: this.rf(1150), q: 0.9, toEcho: 0.35 });
    this.burstDirect({ dur: 0.13, gain: 0.42, freq: 190, q: 0.6, type: 'lowpass' });
    this.subThump(165, 55, 0.45, 0.08);
    // crisp bolt tick right behind the shot — the HK signature
    this.burstDirect({ dur: 0.030, gain: 0.22, freq: this.rf(5200), q: 2.6, when: 0.035 });
  }

  firePistol() {
    // 1911 .45 ACP: round, mellow POP with an audible slide clack-clack cycling.
    this.burstDirect({ dur: 0.03, gain: 0.85, freq: this.rf(2500), q: 0.8, hp: 600 });
    this.burstDirect({ dur: 0.10, gain: 0.6, freq: this.rf(650), q: 0.9, toEcho: 0.35 });
    this.subThump(135, 48, 0.5, 0.08);
    this.burstDirect({ dur: 0.02, gain: 0.16, freq: this.rf(4000), q: 2.4, when: 0.04 });
    this.burstDirect({ dur: 0.02, gain: 0.12, freq: this.rf(3100), q: 2.4, when: 0.075 });
  }

  dryFire() {
    this.ensure();
    this.burstDirect({ dur: 0.025, gain: 0.4, freq: 2400, q: 3.5 });
  }

  // AK-47 7.62×39: dull, angry HAMMER — way less treble than the M416, big
  // sawtooth mid-grind and a rattly stamped-receiver clank on every round.
  fireAK() {
    this.burstDirect({ dur: 0.06, gain: 0.85, freq: this.rf(1700), q: 0.6, hp: 350 });
    this.burstDirect({ dur: 0.17, gain: 0.85, freq: this.rf(520), q: 0.7, toEcho: 0.5 });
    this.burstDirect({ dur: 0.26, gain: 0.7, freq: 105, q: 0.5, type: 'lowpass' });
    this.subThump(110, 36, 0.6, 0.13, 'sawtooth');
    // loose parts rattle — two dirty metallic clicks trailing the report
    this.burstDirect({ dur: 0.04, gain: 0.20, freq: this.rf(3300), q: 1.6, when: 0.05 });
    this.burstDirect({ dur: 0.035, gain: 0.12, freq: this.rf(2500), q: 1.8, when: 0.09 });
  }

  // AWM .338 Lapua: an artillery-grade BOOM — long pressure wave, canyon echo,
  // then the supersonic crack snapping back a beat later. Nothing else comes close.
  fireSniper() {
    this.burstDirect({ dur: 0.10, gain: 1.0, freq: this.rf(1500, 0.05), q: 0.6, hp: 300 });
    this.burstDirect({ dur: 0.34, gain: 0.95, freq: this.rf(400, 0.05), q: 0.7, toEcho: 0.85 });
    this.burstDirect({ dur: 0.65, gain: 0.85, freq: 70, q: 0.4, type: 'lowpass' });
    this.subThump(85, 24, 0.9, 0.5);
    // supersonic whip-crack, delayed
    this.burstDirect({ dur: 0.035, gain: 0.5, freq: this.rf(5600), q: 2.2, when: 0.075 });
    // long rolling desert echo tail
    this.burstDirect({ dur: 0.5, gain: 0.22, freq: 300, q: 0.5, when: 0.16, type: 'lowpass', attack: 0.05, toEcho: 0.6 });
  }

  // MP7 4.6mm: papery, ultra-short ZIP — almost no low end, pure treble spit.
  fireSMG() {
    this.burstDirect({ dur: 0.018, gain: 0.72, freq: this.rf(4400), q: 1.0, hp: 1600 });
    this.burstDirect({ dur: 0.05, gain: 0.5, freq: this.rf(1400), q: 0.9, toEcho: 0.18 });
    this.burstDirect({ dur: 0.07, gain: 0.22, freq: 260, q: 0.5, type: 'lowpass' });
  }

  fireShotgun() {
    // SPAS-12: wide wall of blast — broadband roar, not a crack. Feels like a slam door.
    this.burstDirect({ dur: 0.07, gain: 1.0, freq: this.rf(2200, 0.06), q: 0.4, hp: 350 });
    this.burstDirect({ dur: 0.20, gain: 0.95, freq: this.rf(600, 0.06), q: 0.5, toEcho: 0.55 });
    this.burstDirect({ dur: 0.32, gain: 0.85, freq: 110, q: 0.5, type: 'lowpass' });
    this.subThump(115, 32, 0.7, 0.14);
    this.burstDirect({ dur: 0.05, gain: 0.22, freq: this.rf(3600), q: 2.0, when: 0.09 });
  }

  fireSuppressed() {
    // Suppressed: softened crack + sub thump, ~60% quieter than a rifle report.
    // The action slap stays loud — cans don't silence the bolt.
    this.burstDirect({ dur: 0.03, gain: 0.32, freq: 2400, q: 0.8, hp: 900 });
    this.burstDirect({ dur: 0.12, gain: 0.30, freq: 420, q: 0.7, type: 'lowpass' });
    this.burstDirect({ dur: 0.16, gain: 0.28, freq: 150, q: 0.6, type: 'lowpass' });
    this.burstDirect({ dur: 0.04, gain: 0.20, freq: 4800, q: 2.2, when: 0.045 });
  }

  pump() {
    // Pump-action cycle: back-clack + forward-slam.
    this.burstDirect({ dur: 0.03, gain: 0.30, freq: 1800, q: 1.6 });
    this.burstDirect({ dur: 0.035, gain: 0.36, freq: 2400, q: 1.6, when: 0.14 });
  }

  /** Steyr AUG A3, 5.56 from a 16" barrel with the chamber beside your cheek.
   *  Brighter and flatter than the M4 (shorter gas system, muzzle brake) with a
   *  hard mechanical clack layered in, because a bullpup's action is right at your
   *  ear and you hear the bolt as much as the powder. */
  fireAUG() {
    this.burstDirect({ dur: 0.024, gain: 1.0, freq: this.rf(4400), q: 0.65, hp: 1500 });
    this.burstDirect({ dur: 0.075, gain: 0.62, freq: this.rf(1450), q: 1.05, toEcho: 0.30 });
    this.burstDirect({ dur: 0.105, gain: 0.34, freq: 230, q: 0.6, type: 'lowpass' });
    this.subThump(180, 62, 0.38, 0.065);
    // Brake blast: the ten ports throw a bright sheet of gas sideways.
    this.burstDirect({ dur: 0.040, gain: 0.30, freq: this.rf(6100), q: 1.4, when: 0.006, hp: 3200 });
    // Action clack right at the cheek weld — the bullpup signature.
    this.burstDirect({ dur: 0.022, gain: 0.26, freq: this.rf(2700), q: 3.2, when: 0.028 });
  }

  fireSCAR() {
    // SCAR-H 7.62 NATO: between M4 and AK — full-power THUD with a clean crack
    // on top and a distinctly longer, rounder pressure tail than the 5.56.
    this.burstDirect({ dur: 0.045, gain: 1.0, freq: this.rf(2600), q: 0.6, hp: 550 });
    this.burstDirect({ dur: 0.16, gain: 0.85, freq: this.rf(700), q: 0.7, toEcho: 0.55 });
    this.burstDirect({ dur: 0.26, gain: 0.68, freq: 120, q: 0.6, type: 'lowpass' });
    this.subThump(125, 38, 0.65, 0.13);
    this.burstDirect({ dur: 0.045, gain: 0.2, freq: this.rf(4200), q: 2.0, when: 0.05 });
  }

  fireVector() {
    // Vector .45: dry double-tick "chatter" — brutal attack, dead tail, with a
    // tiny second click from the recoil-mitigation bolt bouncing.
    this.burstDirect({ dur: 0.016, gain: 0.85, freq: this.rf(3500), q: 1.1, hp: 1000 });
    this.burstDirect({ dur: 0.045, gain: 0.6, freq: this.rf(950), q: 1.0, toEcho: 0.12 });
    this.burstDirect({ dur: 0.09, gain: 0.4, freq: 240, q: 0.6, type: 'lowpass' });
    this.burstDirect({ dur: 0.014, gain: 0.3, freq: this.rf(5600), q: 2.6, when: 0.022 });
  }

  fireLMG() {
    // M249: industrial and CLANKY — heavy report buried under belt-link rattle
    // and receiver clatter. Sounds like a machine, not a rifle.
    this.burstDirect({ dur: 0.04, gain: 0.95, freq: this.rf(2700), q: 0.6, hp: 550 });
    this.burstDirect({ dur: 0.15, gain: 0.8, freq: this.rf(680), q: 0.7, toEcho: 0.45 });
    this.burstDirect({ dur: 0.24, gain: 0.65, freq: 135, q: 0.6, type: 'lowpass' });
    this.subThump(120, 40, 0.5, 0.11, 'sawtooth');
    this.burstDirect({ dur: 0.02, gain: 0.18, freq: this.rf(5200), q: 3.0, when: 0.04 });
    this.burstDirect({ dur: 0.02, gain: 0.14, freq: this.rf(4400), q: 3.0, when: 0.08 });
    this.burstDirect({ dur: 0.02, gain: 0.10, freq: this.rf(6000), q: 3.0, when: 0.12 });
  }

  fireDeagle() {
    // Deagle: huge low thump with a long metallic ring.
    const ctx = this.ensure();
    const t = ctx.currentTime;
    this.burstDirect({ dur: 0.05, gain: 1.0, freq: 2200, q: 0.6, hp: 400 });
    this.burstDirect({ dur: 0.2, gain: 0.85, freq: 600, q: 0.7, toEcho: 0.5 });
    this.burstDirect({ dur: 0.3, gain: 0.7, freq: 110, q: 0.6, type: 'lowpass' });
    this.burstDirect({ dur: 0.4, gain: 0.1, freq: 2400, q: 8, when: 0.02 });
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(100, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(og); og.connect(this.master!);
    o.start(t); o.stop(t + 0.2);
  }

  shellInsert() {
    // Single shell thumbed into the tube: click-clack.
    this.burstDirect({ dur: 0.02, gain: 0.3, freq: 2000, q: 1.8 });
    this.burstDirect({ dur: 0.025, gain: 0.35, freq: 2600, q: 1.8, when: 0.07 });
  }

  /** Supersonic bullet crack when a round passes <4 m — sharp band-passed snap
   *  with a whip-like 7 kHz transient. 2-D so it lands in both ears even under HRTF. */
  bulletCrack() {
    // G5: the "where did that come from?" cue PUBG/Apex rely on for readable fire.
    this.burstDirect({ dur: 0.038, gain: 0.68, freq: 7200, q: 1.8, hp: 4200 });
    this.burstDirect({ dur: 0.05, gain: 0.22, freq: 3800, q: 2.2, when: 0.012, hp: 2000 });
  }
  /** 3-D crack placed at the closest approach to the player — so the snap
   *  pans to the side the round actually passed on. */
  bulletCrackSpatial(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    panner.refDistance = 1.2; panner.rolloffFactor = 1.4;
    const when = ctx.currentTime;
    const mk = (freq: number, gain: number, dur: number, hp?: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.8;
      let out: AudioNode = bp;
      if (hp) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; bp.connect(h); out = h; }
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, when); g.gain.exponentialRampToValueAtTime(0.001, when + dur);
      src.connect(bp); out.connect(g); g.connect(panner);
      src.start(when); src.stop(when + dur + 0.02);
      src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); if (out!==bp) (out as BiquadFilterNode).disconnect(); };
    };
    mk(7200, 0.72, 0.04, 4200);
    mk(3800, 0.26, 0.055, 2000);
    // auto-clean panner after the transient
    setTimeout(() => { try { panner.disconnect(); } catch { /* already disconnected */ } }, 300);
  }

  /** Ejected casing: a bright delayed tink ~90 ms after the report, when brass
   *  meets ground. Quiet on purpose — it should be felt, not heard over the gun. */
  fireCasing() {
    this.burstDirect({ dur: 0.03, gain: 0.1, freq: this.rf(6400), q: 4, hp: 4200, when: 0.09 });
  }

  beltCoverOpen() {
    this.burstDirect({ dur: 0.03, gain: 0.35, freq: 1500, q: 1.4 });
    this.burstDirect({ dur: 0.05, gain: 0.25, freq: 900, q: 1.2, when: 0.08 });
  }

  beltCoverClose() {
    this.burstDirect({ dur: 0.04, gain: 0.4, freq: 1100, q: 1.4 });
    this.burstDirect({ dur: 0.03, gain: 0.35, freq: 2200, q: 1.6, when: 0.06 });
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
    o.onended=()=>{src.disconnect();bp.disconnect();g.disconnect();o.disconnect();og.disconnect();panner.disconnect();};
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

  /**
   * SPATIAL: a body hitting the floor. Low-passed noise thump (≈180 Hz body, 0.16 s)
   * under a short 70 Hz sine for weight. Quiet on purpose (0.42 peak vs 0.9 for glass):
   * it is a confirmation layer under the kill cue, not a new event to react to.
   */
  bodyFallSpatial(wx: number, wy: number, wz: number, heavy = false) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = heavy ? 150 : 190;
    const g = ctx.createGain(); g.gain.setValueAtTime(heavy ? 0.5 : 0.42, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(lp); lp.connect(g); g.connect(panner); src.start(t); src.stop(t + 0.18);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.28, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(og); og.connect(panner); o.start(t); o.stop(t + 0.14);
  }

  /** SPATIAL: a dropped rifle landing — two band-passed metallic ticks 40 ms apart
   *  (receiver, then barrel), quieter than a grenade bounce. */
  weaponClatterSpatial(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;
    for (const [dt, f, gain] of [[0, 1900, 0.26], [0.04, 2600, 0.16]] as const) {
      const src = ctx.createBufferSource(); src.buffer = this.noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t + dt); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.05);
      src.connect(bp); bp.connect(g); g.connect(panner); src.start(t + dt); src.stop(t + dt + 0.06);
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

  // ---- Reload stages -----------------------------------------------------
  // Each beat is layered rather than a single noise burst: a reload you hear
  // three times a minute is the most-repeated sound in the game, and one flat
  // click is what made the old one feel cheap.

  /** Catch paddle, then the magazine breaking free of the well. */
  magOut() {
    this.ensure();
    this.burstDirect({ dur: 0.022, gain: 0.34, freq: 2600, q: 3.2 });                 // paddle click
    this.burstDirect({ dur: 0.075, gain: 0.46, freq: 1150, q: 2.0, when: 0.018 });    // body sliding out
    this.burstDirect({ dur: 0.05, gain: 0.20, freq: 420, q: 1.4, when: 0.030 });      // low scrape
  }

  /** The discarded magazine tumbling onto the deck a beat later. */
  magDrop(indoor = false) {
    this.ensure();
    // Two bounces: the first sharp, the second softer and detuned.
    this.burstDirect({ dur: 0.075, gain: 0.30, freq: 760, q: 1.6, when: 0.0, toEcho: indoor ? 0.35 : 0.1 });
    this.subThump(150, 60, 0.20, 0.07);
    this.burstDirect({ dur: 0.055, gain: 0.16, freq: 640, q: 1.9, when: 0.105 });
    this.burstDirect({ dur: 0.04, gain: 0.08, freq: 900, q: 2.4, when: 0.175 });
  }

  /** Fresh magazine indexing on the well lip, then driven home with the palm. */
  magIn() {
    this.ensure();
    this.burstDirect({ dur: 0.030, gain: 0.26, freq: 1500, q: 2.8 });                 // lip index
    this.burstDirect({ dur: 0.06, gain: 0.58, freq: 820, q: 2.2, when: 0.045 });      // seated
    this.subThump(190, 85, 0.30, 0.055);                                              // weight of it
    this.burstDirect({ dur: 0.028, gain: 0.30, freq: 3100, q: 3.0, when: 0.072 });    // catch engages
  }

  /** Charging handle run back and released; the bolt rides forward and slams. */
  boltRelease() {
    this.ensure();
    this.burstDirect({ dur: 0.055, gain: 0.40, freq: 2100, q: 2.0 });                 // handle drawn
    this.burstDirect({ dur: 0.045, gain: 0.70, freq: 2600, q: 1.7, when: 0.055 });    // bolt home
    this.subThump(230, 95, 0.34, 0.05);
    this.burstDirect({ dur: 0.03, gain: 0.22, freq: 5200, q: 2.6, when: 0.062 });     // metallic ring
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

  jumpLand(surface: StepSurface, force = 1) {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const s = SpatialAudioEngine.STEP[surface] ?? SpatialAudioEngine.STEP.sand;
    const f = Math.max(0.35, Math.min(1.4, force));
    // Full body weight arriving: deeper and longer than a step's thump.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(118 * (0.95 + Math.random() * 0.1), t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.17);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.34 * f, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.stepBus ?? this.master!);
    o.start(t); o.stop(t + 0.19);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    // Boot slap + the material's own scatter, both louder than a walking step.
    this.burstDirect({ dur: s.tap[3] * 1.5, gain: 0.26 * f, freq: s.tap[0], q: s.tap[1], hp: s.tap[2], bus: 'step', toEcho: s.echo * (this.indoor ? 1.6 : 0.6) });
    this.burstDirect({ dur: s.tail[2] * 1.4, gain: 0.2 * f * s.tail[3], freq: s.tail[0], q: s.tail[1], when: 0.02, bus: 'step', attack: 0.01 });
    // Everything on the operator shifts at once.
    this.gearRattle(0.11 * f, 0.02);
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

  /** Headshot "DINK" — bright helmet-ping: two detuned metallic partials with a fast ring-out. */
  headshotDink() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    for (const [freq, gain, dur] of [[3150, 0.34, 0.16], [4230, 0.22, 0.11], [2350, 0.12, 0.20]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.94, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master!);
      o.start(t); o.stop(t + dur + 0.02);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    // tiny impact snap under the ring so it still reads as a bullet hit
    this.burstDirect({ dur: 0.025, gain: 0.3, freq: 5000, q: 2.0, hp: 2000 });
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

  // ==================== FOOTSTEPS ====================
  // A step is not one filtered noise burst. It is (1) the heel strike transient,
  // (2) the low thump of body mass loading the floor, (3) a surface-coloured
  // scatter tail — grit, sand, board resonance — and (4) the operator's own gear
  // rattling half a beat behind. Layering those four, alternating feet, and
  // jittering every parameter is the whole difference between "click" and "step".
  private static readonly STEP: Record<StepSurface, {
    /** heel transient: centre freq, Q, highpass, length */
    tap: [number, number, number, number];
    /** body thump: start freq, end freq, length, level */
    body: [number, number, number, number];
    /** scatter tail: centre freq, Q, length, level, delay */
    tail: [number, number, number, number, number];
    /** overall level trim + echo send */
    trim: number; echo: number;
  }> = {
    // Soft, dry, no transient to speak of — sand swallows the crack and hisses out.
    sand:     { tap: [780, 0.5, 260, 0.055], body: [120, 62, 0.085, 0.55], tail: [1850, 0.45, 0.16, 0.85, 0.012], trim: 1.0, echo: 0.05 },
    // Hard slap, short body, bright grit skitter. The loudest surface to walk on.
    concrete: { tap: [2400, 1.6, 900, 0.028], body: [150, 78, 0.06, 0.45], tail: [3400, 1.1, 0.075, 0.40, 0.016], trim: 1.12, echo: 0.30 },
    // Boards ring: low mid resonance and a longer decay, plus an occasional creak.
    wood:     { tap: [900, 1.3, 320, 0.04], body: [190, 96, 0.12, 0.75], tail: [1250, 2.2, 0.14, 0.35, 0.02], trim: 1.05, echo: 0.18 },
    // Sheet steel: a clang with real sustain, very little low end.
    metal:    { tap: [3100, 2.4, 1200, 0.035], body: [320, 168, 0.1, 0.4], tail: [2200, 6.0, 0.28, 0.5, 0.008], trim: 1.15, echo: 0.42 },
    // Loose stone scattering away from the boot — long, busy, unmistakable.
    gravel:   { tap: [1500, 0.8, 520, 0.05], body: [130, 70, 0.07, 0.4], tail: [2600, 0.5, 0.2, 1.0, 0.014], trim: 1.08, echo: 0.12 },
    // Dry scrub: soft brush, almost no impact.
    grass:    { tap: [620, 0.6, 200, 0.06], body: [110, 58, 0.07, 0.35], tail: [2900, 0.35, 0.18, 0.6, 0.01], trim: 0.9, echo: 0.04 },
  };

  footstep(surface: StepSurface, sprint: boolean, crouch = false) {
    const ctx = this.ensure();
    const s = SpatialAudioEngine.STEP[surface] ?? SpatialAudioEngine.STEP.sand;
    // Alternating feet: the right foot lands marginally harder and brighter than
    // the left for most people, and the ear reads that asymmetry as "a person".
    this.footLeft = !this.footLeft;
    const foot = this.footLeft ? 0.94 : 1.06;
    const jitter = 0.9 + Math.random() * 0.2;
    const level = (sprint ? 0.165 : crouch ? 0.042 : 0.092) * s.trim * foot;
    const bright = sprint ? 1.12 : crouch ? 0.82 : 1;
    const echo = s.echo * (this.indoor ? 1.8 : 0.5);
    const t0 = ctx.currentTime;

    // 1. heel strike
    this.burstDirect({
      dur: s.tap[3] * (crouch ? 1.2 : 1), gain: level, q: s.tap[1], bus: 'step',
      freq: s.tap[0] * bright * jitter, hp: s.tap[2], toEcho: echo, attack: 0.001,
    });
    // 2. body thump through the floor — a pitched sine, not noise
    if (!crouch || surface === 'wood' || surface === 'metal') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(s.body[0] * jitter, t0);
      o.frequency.exponentialRampToValueAtTime(s.body[1] * jitter, t0 + s.body[2]);
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * s.body[3] * (crouch ? 0.5 : 1), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + s.body[2]);
      o.connect(g); g.connect(this.stepBus ?? this.master!);
      o.start(t0); o.stop(t0 + s.body[2] + 0.02);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    // 3. scatter tail (grit / sand / board ring), swelling then falling
    this.burstDirect({
      dur: s.tail[2] * (sprint ? 1.15 : 1), gain: level * s.tail[3] * (crouch ? 0.7 : 1),
      freq: s.tail[1] > 3 ? s.tail[0] * jitter : s.tail[0] * bright * jitter,
      q: s.tail[1], when: s.tail[4], toEcho: echo * 0.6, attack: s.tail[2] * 0.22, bus: 'step',
    });
    // 4. gear: sling swivel, mag in the pouch, buckle. Only when actually moving fast,
    //    and only every other step or so, otherwise it becomes a metronome.
    if (!crouch && Math.random() < (sprint ? 0.85 : 0.35)) {
      this.gearRattle(level * (sprint ? 0.5 : 0.3), 0.03 + Math.random() * 0.04);
    }
  }

  /** Kit noise: two or three short metallic ticks, deliberately irregular. */
  private gearRattle(level: number, delay: number) {
    const ctx = this.ensure();
    const n = 2 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + delay + i * (0.012 + Math.random() * 0.03);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1800 + Math.random() * 2600, t);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 1800; bp.Q.value = 3.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * (0.5 + Math.random() * 0.5), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      o.connect(bp); bp.connect(g); g.connect(this.stepBus ?? this.master!);
      o.start(t); o.stop(t + 0.04);
      o.onended = () => { o.disconnect(); bp.disconnect(); g.disconnect(); };
    }
  }

  /** Boot scuff when a direction change drags the foot — pure texture, no impact. */
  footScuff(surface: StepSurface, intensity = 1) {
    const s = SpatialAudioEngine.STEP[surface] ?? SpatialAudioEngine.STEP.sand;
    this.burstDirect({
      dur: 0.13 + Math.random() * 0.06, gain: 0.05 * intensity * s.trim, bus: 'step',
      freq: s.tail[0] * 0.8, q: 0.5, attack: 0.05, toEcho: s.echo * 0.3,
    });
  }

  /** Sound-trap flooring: 1.8× louder than a normal step, with a distinct crunch.
   * Glass adds a shard tinkle; gravel gets a low scatter rumble. */
  footstepTrap(kind: 'glass' | 'gravel', sprint: boolean, crouch = false) {
    const g = (sprint ? 0.15 : crouch ? 0.045 : 0.085) * 1.8;
    if (kind === 'gravel') {
      this.burstDirect({ dur: 0.1, gain: g, freq: 640, q: 0.7, type: 'lowpass', bus: 'step' });
      this.burstDirect({ dur: 0.045, gain: g * 0.5, freq: 1500, q: 1.4, when: 0.03, bus: 'step' });
    } else {
      this.burstDirect({ dur: 0.06, gain: g, freq: 2600, q: 1.1, hp: 1400, bus: 'step' });
      // shard tinkle
      for (let i = 0; i < 2; i++) {
        const ctx = this.ensure();
        const t = ctx.currentTime + 0.02 + i * 0.05;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(3200 + Math.random() * 2800, t);
        const og = ctx.createGain();
        og.gain.setValueAtTime(g * 0.22, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(og); og.connect(this.stepBus ?? this.master!);
        o.start(t); o.stop(t + 0.1);
        o.onended = () => { o.disconnect(); og.disconnect(); };
      }
    }
  }

  /** Distant world ambience — dog bark, wind gust or metal creak. 2D, quiet,
   * scheduled by the engine every 12–20 s so the map feels lived beyond walls. */
  playAmbient() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const pick = Math.floor(Math.random() * 3);
    if (pick === 0) {
      // far-off dog: 2-3 short pitched bursts with a falling tail
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const st = t + i * 0.19;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(520 + Math.random() * 160, st);
        o.frequency.exponentialRampToValueAtTime(260, st + 0.13);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.13, st);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.15);
        o.connect(bp); bp.connect(g); g.connect(this.master!);
        o.start(st); o.stop(st + 0.17);
        o.onended = () => { o.disconnect(); bp.disconnect(); g.disconnect(); };
      }
    } else if (pick === 1) {
      // wind gust swelling over the yard
      const src = ctx.createBufferSource();
      src.buffer = this.noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.15, t + 1.1);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.8);
      src.connect(bp); bp.connect(g); g.connect(this.master!);
      src.start(t, Math.random() * 0.5); src.stop(t + 2.9);
      src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); };
    } else {
      // metal creak: slow bent saw with vibrato, lowpassed
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(165, t);
      o.frequency.linearRampToValueAtTime(120, t + 1.3);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 9;
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.25);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.45);
      o.connect(lp); lp.connect(g); g.connect(this.master!);
      o.start(t); o.stop(t + 1.5); lfo.start(t); lfo.stop(t + 1.5);
      o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); lfo.disconnect(); lfoG.disconnect(); };
    }
  }

  /** ON FIRE ignite: rising whoosh + crackle bed. */
  onFireIgnite() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.4);
    src.connect(bp); bp.connect(g); g.connect(this.master!);
    src.start(t, Math.random() * 0.4); src.stop(t + 1.45);
    src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); };
  }

  /** SHUT DOWN sting: the bounty is collected. */
  shutdown() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    for (const [f, when, dur] of [[740, 0, 0.1], [495, 0.09, 0.32]] as const) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t + when);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, t + when + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t + when);
      g.gain.exponentialRampToValueAtTime(0.0001, t + when + dur);
      o.connect(g); g.connect(this.master!);
      o.start(t + when); o.stop(t + when + dur + 0.02);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
  }

  // ==================== BOMB DEFUSAL ====================
  /** One oscillator note straight to the master bus (UI stingers, keypad). */
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, glideTo?: number) {
    const ctx = this.ensure();
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  /** Planted C4 chirp from the bomb itself. Carries much further than gunfire. */
  c4Beep(wx: number, wy: number, wz: number, urgency: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    panner.refDistance = 4; panner.rolloffFactor = 0.8;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2500 + urgency * 900, t);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2900; bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    o.connect(bp); bp.connect(g); g.connect(panner);
    o.start(t); o.stop(t + 0.1);
    o.onended = () => { o.disconnect(); bp.disconnect(); g.disconnect(); };
  }
  /** Keypad digit while arming. */
  c4Key(i: number) { this.tone(880 + (i % 4) * 190, 0.07, 0.12, 'square'); }
  /** Armed: the unmistakable double chirp. */
  c4Armed() { this.tone(1760, 0.09, 0.16, 'square'); this.tone(2350, 0.14, 0.16, 'square', 0.1); }
  /** Rising whine in the last second. */
  c4Whine(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    panner.refDistance = 5; panner.rolloffFactor = 0.7;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(3200, t + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    o.connect(g); g.connect(panner);
    o.start(t); o.stop(t + 1.1);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  /** The C4 blast: stacked sub drop, debris wash and a long rolling tail. */
  c4Explosion(wx: number, wy: number, wz: number, dist: number) {
    this.explosionSpatial(wx, wy, wz, dist);
    const a = Math.max(0.25, 1 - dist / 90);
    this.subThump(70, 16, 1.5 * a, 1.8, 'sine');
    this.burstDirect({ dur: 2.6, gain: 0.8 * a, freq: 260, q: 0.5, type: 'lowpass', attack: 0.01, toEcho: 0.6 });
    this.burstDirect({ dur: 0.9, gain: 0.5 * a, freq: 1400, q: 0.7, when: 0.05 });
  }
  defuseTick() { this.burstDirect({ dur: 0.03, gain: 0.18, freq: 3400, q: 4 }); }
  defused() { this.tone(1320, 0.12, 0.14, 'triangle'); this.tone(990, 0.12, 0.14, 'triangle', 0.12); this.tone(660, 0.3, 0.16, 'triangle', 0.24); }
  smokePop(wx: number, wy: number, wz: number) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(500, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(lp); lp.connect(g); g.connect(panner);
    src.start(t, Math.random() * 0.3); src.stop(t + 2.7);
    src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); };
  }
  buyClick() { this.burstDirect({ dur: 0.03, gain: 0.3, freq: 3600, q: 3 }); this.tone(1500, 0.06, 0.08, 'triangle', 0.02); }
  buyDenied() { this.tone(180, 0.16, 0.14, 'square'); }
  pickup() { this.burstDirect({ dur: 0.04, gain: 0.3, freq: 2200, q: 2 }); this.burstDirect({ dur: 0.05, gain: 0.25, freq: 900, q: 1.5, when: 0.05 }); }
  roundStartStinger() { this.tone(392, 0.18, 0.12, 'sawtooth'); this.tone(523, 0.32, 0.12, 'sawtooth', 0.16); }
  roundWinStinger() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 0.11, 'triangle', i * 0.09)); }
  roundLoseStinger() { [440, 349, 294].forEach((f, i) => this.tone(f, 0.34, 0.11, 'sawtooth', i * 0.14)); }

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

  // ==================== FIELD KITS ====================
  /** Spatial filtered-noise hit at a world point (kit hardware foley). */
  private spatialNoise(wx: number, wy: number, wz: number, o: { dur: number; gain: number; freq: number; q?: number; type?: BiquadFilterType; when?: number }) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime + (o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass'; f.frequency.value = o.freq; f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(panner);
    src.start(t, Math.random() * 0.4); src.stop(t + o.dur + 0.02);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); panner.disconnect(); };
  }

  /** Spatial oscillator sweep at a world point. */
  private spatialTone(wx: number, wy: number, wz: number, o: { from: number; to: number; dur: number; gain: number; type?: OscillatorType; when?: number }) {
    const ctx = this.ensure();
    const panner = this.createSpatialPanner(wx, wy, wz);
    const t = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(panner);
    osc.start(t); osc.stop(t + o.dur + 0.02);
    osc.onended = () => { osc.disconnect(); g.disconnect(); panner.disconnect(); };
  }

  /** Kit charged: two soft rising blips, lower than the streak chime so they never blur. */
  kitReady() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    [[520, 0], [780, 0.08]].forEach(([f, when]) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + when);
      g.gain.exponentialRampToValueAtTime(0.2, t + when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + when + 0.22);
      o.connect(g); g.connect(this.master!);
      o.start(t + when); o.stop(t + when + 0.24);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    });
  }

  /** Pressed Z on cooldown / refused placement: a dull double tick. */
  kitDenied() {
    this.burstDirect({ dur: 0.04, gain: 0.12, freq: 900, q: 3 });
    this.burstDirect({ dur: 0.04, gain: 0.1, freq: 700, q: 3, when: 0.07 });
  }

  /** Dart leaves the hand: short air whip. */
  dartThrow() {
    this.burstDirect({ dur: 0.16, gain: 0.16, freq: 1800, q: 0.8, attack: 0.03, hp: 900 });
  }

  /** Dart bites into a surface: tick + tiny metallic ring. */
  dartStick(wx: number, wy: number, wz: number) {
    this.spatialNoise(wx, wy, wz, { dur: 0.05, gain: 0.5, freq: 3200, q: 2 });
    this.spatialTone(wx, wy, wz, { from: 2400, to: 2200, dur: 0.18, gain: 0.12, type: 'triangle' });
  }

  /** Sonar pulse: descending sine "ping" with a watery tail; the last ping is doubled. */
  sonarPing(wx: number, wy: number, wz: number, last = false) {
    this.spatialTone(wx, wy, wz, { from: 1900, to: 1250, dur: 0.55, gain: 0.55 });
    this.spatialTone(wx, wy, wz, { from: 950, to: 620, dur: 0.7, gain: 0.25, type: 'triangle' });
    if (last) this.spatialTone(wx, wy, wz, { from: 1900, to: 1250, dur: 0.45, gain: 0.4, when: 0.16 });
  }

  /** Barricade unfolds: ratchet clacks and a heavy plate thump. */
  barricadeDeploy(wx: number, wy: number, wz: number) {
    for (let i = 0; i < 3; i++) this.spatialNoise(wx, wy, wz, { dur: 0.04, gain: 0.45, freq: 2600 - i * 300, q: 4, when: i * 0.06 });
    this.spatialTone(wx, wy, wz, { from: 130, to: 55, dur: 0.3, gain: 0.7, type: 'triangle', when: 0.2 });
    this.spatialNoise(wx, wy, wz, { dur: 0.2, gain: 0.35, freq: 400, q: 0.8, when: 0.2 });
  }

  /** A round spangs off the steel. */
  barricadeHit(wx: number, wy: number, wz: number) {
    this.spatialNoise(wx, wy, wz, { dur: 0.05, gain: 0.5, freq: this.rf(4200, 0.2), q: 3 });
    this.spatialTone(wx, wy, wz, { from: this.rf(1700, 0.2), to: 1300, dur: 0.22, gain: 0.14, type: 'square' });
  }

  /** Integrity gone: plates crash down. */
  barricadeBreak(wx: number, wy: number, wz: number) {
    this.spatialNoise(wx, wy, wz, { dur: 0.5, gain: 0.8, freq: 700, q: 0.6 });
    this.spatialNoise(wx, wy, wz, { dur: 0.3, gain: 0.5, freq: 2400, q: 1.5, when: 0.08 });
    this.spatialTone(wx, wy, wz, { from: 90, to: 40, dur: 0.45, gain: 0.8, type: 'triangle' });
  }

  /** Life expired: the wall folds itself away. */
  barricadeFold(wx: number, wy: number, wz: number) {
    for (let i = 0; i < 2; i++) this.spatialNoise(wx, wy, wz, { dur: 0.05, gain: 0.35, freq: 2000 + i * 400, q: 4, when: i * 0.08 });
    this.spatialTone(wx, wy, wz, { from: 110, to: 60, dur: 0.22, gain: 0.4, type: 'triangle', when: 0.16 });
  }

  /** Holo-decoy boots: rising digital sweep with a projector buzz. */
  decoyDeploy(wx: number, wy: number, wz: number) {
    this.spatialTone(wx, wy, wz, { from: 300, to: 1600, dur: 0.35, gain: 0.3, type: 'sawtooth' });
    this.spatialNoise(wx, wy, wz, { dur: 0.3, gain: 0.18, freq: 5200, q: 6 });
  }

  /**
   * Decoy blank: a rifle report built the same way as the hostile gun voice, so the AI's
   * ears and the player's ears both hear "a rifleman", just a touch brighter and dryer.
   */
  decoyFire(wx: number, wy: number, wz: number) {
    this.spatialNoise(wx, wy, wz, { dur: 0.09, gain: 0.85, freq: this.rf(1500), q: 0.7 });
    this.spatialTone(wx, wy, wz, { from: this.rf(160), to: 60, dur: 0.1, gain: 0.35, type: 'triangle' });
  }

  /** Decoy destroyed / expired: digital crackle collapse. */
  decoyPop(wx: number, wy: number, wz: number) {
    this.spatialTone(wx, wy, wz, { from: 1400, to: 180, dur: 0.3, gain: 0.3, type: 'square' });
    for (let i = 0; i < 4; i++) this.spatialNoise(wx, wy, wz, { dur: 0.03, gain: 0.3, freq: 3000 + i * 900, q: 5, when: i * 0.045 });
  }

  /** Decoy glitch burst: a sub-bass thump under a descending digital shriek and crackle. */
  decoyBurst(wx: number, wy: number, wz: number) {
    this.spatialTone(wx, wy, wz, { from: 110, to: 38, dur: 0.45, gain: 0.55, type: 'sine' });
    this.spatialTone(wx, wy, wz, { from: 2600, to: 240, dur: 0.38, gain: 0.26, type: 'sawtooth' });
    for (let i = 0; i < 7; i++) this.spatialNoise(wx, wy, wz, { dur: 0.025, gain: 0.34, freq: 1800 + (i % 3) * 1500, q: 6, when: 0.02 + i * 0.038 });
  }

  /** Barricade recalled: servo whine up, then two latch clicks. */
  barricadeRecall(wx: number, wy: number, wz: number) {
    this.spatialTone(wx, wy, wz, { from: 240, to: 720, dur: 0.28, gain: 0.22, type: 'triangle' });
    this.spatialNoise(wx, wy, wz, { dur: 0.03, gain: 0.4, freq: 2400, q: 4, when: 0.26 });
    this.spatialNoise(wx, wy, wz, { dur: 0.03, gain: 0.34, freq: 1900, q: 4, when: 0.34 });
  }

  /** Mine planted: a soft metal set-down and a latch click. */
  minePlant(wx: number, wy: number, wz: number) {
    this.spatialNoise(wx, wy, wz, { dur: 0.06, gain: 0.35, freq: 900, q: 1.2 });
    this.spatialNoise(wx, wy, wz, { dur: 0.03, gain: 0.3, freq: 3000, q: 4, when: 0.12 });
  }

  /** Mine armed: two short high chirps — quiet enough that hostiles don't hear it. */
  mineArm(wx: number, wy: number, wz: number) {
    this.spatialTone(wx, wy, wz, { from: 2600, to: 2600, dur: 0.05, gain: 0.14, type: 'square' });
    this.spatialTone(wx, wy, wz, { from: 3200, to: 3200, dur: 0.05, gain: 0.14, type: 'square', when: 0.09 });
  }

  /** Mine tripped: a fast rising beep just before it jumps. */
  mineTrip(wx: number, wy: number, wz: number) {
    this.spatialTone(wx, wy, wz, { from: 1800, to: 3600, dur: 0.22, gain: 0.3, type: 'square' });
    this.spatialNoise(wx, wy, wz, { dur: 0.05, gain: 0.4, freq: 600, q: 1, when: 0.24 });
  }

  /** Medkit opens: latches, then a warm rising two-tone. */
  medkitDeploy(wx: number, wy: number, wz: number) {
    this.spatialNoise(wx, wy, wz, { dur: 0.03, gain: 0.35, freq: 2200, q: 4 });
    this.spatialNoise(wx, wy, wz, { dur: 0.03, gain: 0.35, freq: 1800, q: 4, when: 0.07 });
    this.spatialTone(wx, wy, wz, { from: 520, to: 780, dur: 0.3, gain: 0.22, type: 'sine', when: 0.12 });
    this.spatialTone(wx, wy, wz, { from: 780, to: 1040, dur: 0.35, gain: 0.18, type: 'sine', when: 0.3 });
  }

  /** Medkit heal tick: a soft chime, pitched up as health refills. */
  medkitTick(pct: number) {
    this.burstDirect({ dur: 0.08, gain: 0.05, freq: 1400 + pct * 900, q: 8 });
  }

  /** Kits menu: purchase confirmed — register drawer plus a rising two-note seal. */
  kitPurchase() {
    this.burstDirect({ dur: 0.05, gain: 0.3, freq: 2600, q: 2 });
    this.burstDirect({ dur: 0.18, gain: 0.16, freq: 5200, q: 6, when: 0.05 });
    const ctx = this.ensure();
    const t = ctx.currentTime;
    [[440, 0.06], [660, 0.14], [990, 0.22]].forEach(([f, when]) => {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + when);
      g.gain.exponentialRampToValueAtTime(0.16, t + when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + when + 0.3);
      o.connect(g); g.connect(this.master!);
      o.start(t + when); o.stop(t + when + 0.32);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    });
  }

  /** Kits menu: moving the selection between kits — a dry mechanical tick. */
  kitSelect() {
    this.burstDirect({ dur: 0.025, gain: 0.12, freq: 3400, q: 5 });
  }

  private burstDirect(opts: {
    dur: number; gain: number; freq: number; q?: number; type?: BiquadFilterType;
    attack?: number; toEcho?: number; when?: number; hp?: number;
    /** Which mix bus to land on. Footsteps/foley must be separately trimmable. */
    bus?: 'sfx' | 'step' | 'music';
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
    let echoSend: GainNode | undefined;
    if (opts.hp) {
      const h = ctx.createBiquadFilter();
      h.type = 'highpass';
      h.frequency.value = opts.hp;
      f.connect(h);
      out = h;
    }
    out.connect(g);
    g.connect((opts.bus === 'step' ? this.stepBus : opts.bus === 'music' ? this.musicBus : this.master) ?? this.master!);
    if (opts.toEcho && this.echoBus) {
      const eg = ctx.createGain(); echoSend=eg;
      eg.gain.value = opts.toEcho;
      g.connect(eg);
      eg.connect(this.echoBus);
    }
    const nodes: AudioNode[]=[src,f,out,g,...(echoSend?[echoSend]:[])];
    src.onended=()=>nodes.forEach(node=>node.disconnect());
    // Random offset and slight pitch variation prevent the same noise attack
    // repeating like a machine loop, especially on the 900 RPM PDW.
    src.playbackRate.value=0.96+Math.random()*0.08;
    src.start(t,Math.random()*0.45);
    src.stop(t + opts.dur + 0.05);
  }
}

export const audio = new SpatialAudioEngine();
