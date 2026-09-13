// Recoil FPS — Core Engine V2.0
// Laser-accurate ballistics, full spatial audio listener, lean Q/E, slide, jump, sprint delays
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { buildWorld, pointInAABB, type World, type MapId, type AABB } from './world';
import { buildM4, buildAK47, buildM1911, buildAWM, buildMP7, type WeaponModel } from './models';
import { Effects } from './effects';
import { audio } from './audio';
import { voice } from './voice';
import { AIManager, DIFFICULTIES, type AIContext, type Enemy } from './ai';
import { MissionRuntime, type MissionHud } from './systems/mission-runtime';
import type { MissionReport, MissionPhase } from './systems/mission';
import type { PressureStats } from './systems/reinforcements';

export interface GameSettings {
  // Gameplay
  sensitivity: number;      // 0.5 - 10
  adsSensitivity: number;   // 0.2 - 1.5 multiplier
  invertY: boolean;
  adsToggle: boolean;       // click MMB to keep scoped instead of holding
  fov: number;              // 70 - 120
  difficulty: string;
  map: MapId;
  // Graphics
  resolutionScale: number;  // 50 - 100 (%)
  shadowQuality: 'off' | 'low' | 'medium' | 'high';
  bloom: boolean;
  bloomStrength: number;    // 0 - 100
  vignette: number;         // 0 - 100
  filmGrain: number;        // 0 - 100
  brightness: number;       // 80 - 160 (exposure %)
  cameraShake: number;      // 0 - 100
  showFps: boolean;
  // Audio
  masterVolume: number;     // 0 - 100
  voices: boolean;
  // Crosshair
  crosshairColor: string;
  crosshairSize: number;    // 4 - 20
  crosshairGap: number;     // 0 - 24
  crosshairThickness: number; // 1 - 5
  crosshairDot: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 2.2,
  adsSensitivity: 0.7,
  invertY: false,
  adsToggle: false,
  fov: 95,
  difficulty: 'Normal',
  map: 'alrasul',
  resolutionScale: 60,
  shadowQuality: 'low',
  bloom: false,
  bloomStrength: 22,
  vignette: 12,
  filmGrain: 0,
  brightness: 110,
  cameraShake: 100,
  showFps: true,
  masterVolume: 85,
  voices: true,
  crosshairColor: '#FF5C1A',
  crosshairSize: 9,
  crosshairGap: 8,
  crosshairThickness: 2,
  crosshairDot: true,
};

export interface HudState {
  hp: number;
  mag: number;
  weapon: string;
  reloading: boolean;
  reloadStage: 'idle' | 'magOut' | 'magIn' | 'ready';
  frags: number;
  flashes: number;
  bearing: number;
  kills: number;
  score: number;
  enemiesLeft: number;
  cooking: boolean;
  sprinting: boolean;
  canVault: boolean;
  ads: number;
  spread: number;
  pings: { dir: number; age: number }[];
  grenadeDist?: number;
  grenadeAngle?: number;
  // Accurate tactical map (rendered from real world geometry)
  mapImage: string;
  playerMap: { nx: number; nz: number };
  enemiesMap: { nx: number; nz: number }[];
  missionMap?: { nx: number; nz: number; ringPct: number; extract: boolean };
  fps: number;
  magSize: number;
  worldHalf: number;
  nearest?: { angle: number; dist: number; above: number };
  mission?: MissionHud;
}

export type GameEvent =
  | { type: 'hit'; kill: boolean }
  | { type: 'kill'; name: string; weapon: string; headshot: boolean }
  | { type: 'damage'; dir: number; amount: number }
  | { type: 'flash'; power: number }
  | { type: 'callout'; text: string }
  | { type: 'streak'; label: string }
  | { type: 'objective'; phase: MissionPhase; index: number }
  | { type: 'end'; win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number; mission: MissionReport; pressure: PressureStats };

interface WeaponDef {
  name: string;
  model: WeaponModel;
  auto: boolean;
  rpm: number;
  damage: number;
  headMul: number;
  limbMul: number;
  magSize: number;
  reserve: number;
  hipSpread: number;
  adsSpread: number;
  pattern: [number, number][];
  adsFov: number;      // FOV while ADS (lower = more zoom); sniper gets a real scope
  tacReload: number;
  emptyReload: number;
}

interface Grenade {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  kind: 'frag' | 'flash';
  fromAI: boolean;
}

const V = () => new THREE.Vector3();

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private vmScene = new THREE.Scene();
  private vmCamera: THREE.PerspectiveCamera;
  private world: World;
  private effects: Effects;
  private ai: AIManager;
  private missionRuntime!: MissionRuntime;
  private rosterVersion = -1;
  private started = false;
  private finishDelay = -1;
  private pendingResult: Extract<GameEvent, { type: 'end' }> | null = null;
  private onEvent: (e: GameEvent) => void;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private vignettePass: ShaderPass;
  private sunLight!: THREE.DirectionalLight;
  private mapImage = '';

  // Player state
  private pos: THREE.Vector3;
  private vel = V();
  private yaw = Math.PI / 2 + 0.6;
  private pitch = 0;
  private hp = 100;
  private lastDamageT = 0;
  private grounded = true;
  private crouched = false;
  private crouchT = 0; // for 180ms ease-out
  private sliding = false;
  private slideT = 0;
  private slideCD = 0;
  private slideDir = V();
  private jumpCD = 0;
  private landDip = 0;
  private lean = 0; // -1 (Left), 0 (Center), +1 (Right)
  private leanTarget = 0;
  private ads = 0;
  private sprinting = false;
  private sprintToFireDelay = 0;
  private sprintToAdsDelay = 0;
  private footPhase = 0;
  private staticTime = 0;
  private lastPos = V();
  private dead = false;
  private vx = 0;
  private vz = 0;
  private stepAcc = 0;
  private spreadNow = 0;
  private lastKillT = -9999;
  private streak = 0;
  private headshots = 0;
  private readonly VM_S = 1.95;
  // Scratch vectors — hot paths must not allocate per frame
  private readonly _t1 = new THREE.Vector3();
  private readonly _t2 = new THREE.Vector3();
  private readonly _t3 = new THREE.Vector3();
  // Spatial hash over world solids (cell 4m) — collision queries check a few
  // nearby boxes instead of scanning the whole map every frame.
  private solidGrid = new Map<string, AABB[]>();
  private readonly GRID_CELL = 4;
  private scratch: AABB[] = [];
  // INFINITE AMMO: reserves never deplete — the fight never pauses for scavenging
  private readonly INFINITE_AMMO = true;

  // Camera Shake & Recoil
  private recoilP = 0;
  private recoilY = 0;
  private shake = 0;
  private eyeH = 1.62;

  // Weapons
  private weapons: WeaponDef[];
  private cur = 0;
  private mags: number[];
  private reserves: number[];
  private fireCD = 0;
  private shotIdx = 0;
  private shotResetT = 0;
  private triggerHeld = false;
  private reloadT = -1;
  private reloadStages: { t: number; stage: HudState['reloadStage']; fn: () => void }[] = [];
  private reloadDur = 0;
  private currentReloadStage: HudState['reloadStage'] = 'idle';
  private switchT = -1;
  private vmKick = 0;
  private vmKickRot = 0;
  private muzzleFlash: THREE.Mesh;
  private vmLight: THREE.PointLight;

  // Grenades
  private frags = 5;
  private flashes = 2;
  private cooking = false;
  private cookT = 0;
  private grenades: Grenade[] = [];
  private arcPreview: THREE.Points;

  // Settings
  mouseSens = 0.0022;
  fovSetting = 95;
  adsSensMul = 0.7;
  invertY = false;
  private adsToggle = false;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;

  // Input
  private keys = new Set<string>();
  private canvas: HTMLCanvasElement;
  paused = true;
  private disposed = false;
  private lastT = 0;

  // Stats
  private kills = 0;
  private score = 0;
  private shots = 0;
  private hits = 0;
  private ended = false;
  private pings: { dir: number; age: number }[] = [];
  private hittables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private rmb = false;

  constructor(canvas: HTMLCanvasElement, difficulty: string, onEvent: (e: GameEvent) => void, mapId: MapId = 'alrasul') {
    this.canvas = canvas;
    this.onEvent = onEvent;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Cap pixel ratio at 1.25 — the single biggest FPS win on high-DPI screens
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCF (not Soft) — ~2x cheaper
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(this.fovSetting, 1, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 5);

    // Clear bright desert daylight — high visibility, light fog only at distance.
    // Slightly desaturated so enemy silhouettes stay readable instead of washing out.
    this.scene.background = new THREE.Color(0xB8CCDA);
    this.scene.fog = new THREE.Fog(0xC6BEA8, 130, 430);
    // strong sky fill so shadowed faces stay readable
    const hemi = new THREE.HemisphereLight(0xCFE0EE, 0xB89A66, 1.15);
    this.scene.add(hemi);
    // key sun — high and bright, crisp shadows
    const sun = new THREE.DirectionalLight(0xFFF4DE, 2.6);
    sun.position.set(-45, 80, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); // 4x fewer shadow texels than 4096 — big FPS win
    sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.sunLight = sun;
    // gentle cool fill from the opposite side
    const fill = new THREE.DirectionalLight(0xAFC6DC, 0.45);
    fill.position.set(55, 30, -45);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x8A7A60, 0.4));

    this.addSkyDome();

    this.world = buildWorld(this.scene, mapId);
    this.buildSolidGrid();
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.world.group.traverse(o => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!mat) return;
      const m = mat as unknown as { map?: THREE.Texture; bumpMap?: THREE.Texture };
      if (m.map) m.map.anisotropy = maxAniso;
      if (m.bumpMap) m.bumpMap.anisotropy = maxAniso;
    });
    // Warm interior point lights near the map centre (capped at 2 — each one re-lights every merged mesh)
    const spots = [...this.world.lightSpots].sort((a, b) => a.length() - b.length()).slice(0, 2);
    for (const s of spots) {
      const pl = new THREE.PointLight(0xFFD9A0, 14, 16, 1.8);
      pl.position.copy(s);
      this.scene.add(pl);
    }
    this.effects = new Effects(this.scene);

    // ==================== AAA POST-PROCESSING (bloom + tone-mapped output) ====================
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom at HALF resolution and only on genuinely bright pixels (threshold 0.92) — cheap and clean
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.28, 0.4, 0.92);
    this.composer.addPass(this.bloom);
    // Light finishing pass: barely-there vignette, no film grain (grain was killing clarity)
    this.vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uVignette: { value: 0.18 },
        uGrain: { value: 0.0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 uv = vUv - 0.5;
  float d = length(uv);
  float vig = smoothstep(0.85, 0.28, d);
  c.rgb *= mix(1.0 - uVignette, 1.0, vig);
  if (uGrain > 0.0) {
    float g = (fract(sin(dot(vUv + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uGrain;
    c.rgb += g;
  }
  // mild clarity boost — slight contrast, neutral color (no warm tint muddying the image)
  c.rgb = (c.rgb - 0.5) * 1.04 + 0.5;
  gl_FragColor = c;
}`,
    });
    this.composer.addPass(this.vignettePass);
    this.composer.addPass(new OutputPass());

    // Accurate tactical map rendered from the real world collision geometry
    this.mapImage = this.generateMapImage();
    this.pos = this.world.playerSpawn.clone();
    this.lastPos.copy(this.pos);

    // Viewmodel lighting
    const vmHemi = new THREE.HemisphereLight(0xF0F4FA, 0x8A7450, 1.2);
    this.vmScene.add(vmHemi);
    const vmSun = new THREE.DirectionalLight(0xFFF2D6, 1.7);
    vmSun.position.set(1.5, 2.5, 0.8);
    this.vmScene.add(vmSun);
    this.vmLight = new THREE.PointLight(0xFFC070, 0, 4);
    this.vmScene.add(this.vmLight);

    // Weapons: 1. M4A1 SOPMOD, 2. AK-47, 3. M1911, 4. AWM Sniper, 5. MP7A1 PDW
    const m4 = buildM4();
    const ak = buildAK47();
    const m1911 = buildM1911();
    const awm = buildAWM();
    const mp7 = buildMP7();
    this.vmScene.add(m4.group, ak.group, m1911.group, awm.group, mp7.group);
    ak.group.visible = false;
    m1911.group.visible = false;
    awm.group.visible = false;
    mp7.group.visible = false;

    this.weapons = [
      {
        name: 'M4A1 SOPMOD',
        model: m4,
        auto: true,
        rpm: 780,
        damage: 34,
        headMul: 2.3,
        limbMul: 0.85,
        magSize: 30,
        reserve: 150,
        hipSpread: 0.008,
        adsSpread: 0.000,
        pattern: [[0, 0]],
        adsFov: 56,
        tacReload: 2.1,
        emptyReload: 2.7,
      },
      {
        name: 'AK-47 TACTICAL',
        model: ak,
        auto: true,
        rpm: 600,
        damage: 46,
        headMul: 2.5,
        limbMul: 0.8,
        magSize: 30,
        reserve: 120,
        hipSpread: 0.010,
        adsSpread: 0.000,
        pattern: [[0, 0]],
        adsFov: 58,
        tacReload: 2.4,
        emptyReload: 3.0,
      },
      {
        name: 'M1911 .45',
        model: m1911,
        auto: false,
        rpm: 420,
        damage: 42,
        headMul: 2.6,
        limbMul: 0.85,
        magSize: 8,
        reserve: 48,
        hipSpread: 0.006,
        adsSpread: 0.000,
        pattern: [[0, 0]],
        adsFov: 64,
        tacReload: 1.5,
        emptyReload: 1.8,
      },
      {
        name: 'AWM .338 SNIPER',
        model: awm,
        auto: false,
        rpm: 52,
        damage: 135,
        headMul: 3.0,
        limbMul: 1.0,
        magSize: 5,
        reserve: 25,
        hipSpread: 0.045,
        adsSpread: 0.000,
        pattern: [[0, 0]],
        adsFov: 22,
        tacReload: 2.8,
        emptyReload: 3.4,
      },
      {
        name: 'MP7A1 PDW',
        model: mp7,
        auto: true,
        rpm: 950,
        damage: 24,
        headMul: 2.2,
        limbMul: 0.8,
        magSize: 40,
        reserve: 200,
        hipSpread: 0.007,
        adsSpread: 0.000,
        pattern: [[0, 0]],
        adsFov: 60,
        tacReload: 1.9,
        emptyReload: 2.3,
      },
    ];
    this.mags = [30, 30, 8, 5, 40];
    this.reserves = [Infinity, Infinity, Infinity, Infinity, Infinity];

    // Muzzle Flash
    const fm = new THREE.MeshBasicMaterial({
      color: 0xFFD280,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), fm);
    this.vmScene.add(this.muzzleFlash);

    // Grenade arc preview dots
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    this.arcPreview = new THREE.Points(
      ag,
      new THREE.PointsMaterial({ color: 0xFF4422, size: 0.08, transparent: true, opacity: 0.85 })
    );
    this.arcPreview.visible = false;
    this.scene.add(this.arcPreview);

    // AI Context with full HRTF Spatial Audio Integration
    const ctx: AIContext = {
      scene: this.scene,
      occluders: this.world.occluders,
      coverNodes: this.world.coverNodes,
      solids: this.world.solids,
      half: this.world.half,
      playerVel: () => Math.hypot(this.vx, this.vz),
      effects: this.effects,
      difficulty: DIFFICULTIES[difficulty] ?? DIFFICULTIES.Normal,
      playerPos: () => this.eyePos(),
      playerFeet: () => this.pos.clone(),
      playerAlive: () => !this.dead,
      playerStaticTime: () => this.staticTime,
      damagePlayer: (a, f) => this.damagePlayer(a, f),
      moveCollide: (p, dx, dz, r) => this.moveAxis(p, dx, dz, r, 1.7),
      onCallout: (k, p) => {
        // Enemy barks stay subtle: only audible voices + a short HUD hint, no radio click spam.
        if (p.distanceTo(this.pos) < 40) {
          const labels: Record<string, string> = {
            contact: 'Contact — ahead!', flank: 'Hostiles flanking!', grenade: 'Frag out!',
            mandown: 'Contact down!', fallback: 'They are falling back!', push: 'They are pushing!',
          };
          this.onEvent({ type: 'callout', text: labels[k] || 'Contact!' });
          // The settings menu advertises "enemy squad chatter" — actually speak the barks.
          // voice.enemyCallout carries its own 9s anti-spam cooldown.
          voice.enemyCallout(k);
        }
      },
      aiThrowGrenade: (from, target) => this.spawnGrenade(from, target, true),
      onEnemyFire: (p) => {
        audio.enemyFireSpatial(p.x, p.y, p.z);
        this.addPing(p);
      },
      onEliminated: enemy => this.missionRuntime?.recordElimination(enemy),
    };

    this.ai = new AIManager(ctx, []);
    this.missionRuntime = new MissionRuntime({
      scene: this.scene, world: this.world, camera: this.camera, ai: this.ai, player: this.pos,
      isAlive: () => !this.dead,
      phaseChanged: (phase, index) => this.onEvent({ type: 'objective', phase, index }),
      radio: (text, at) => {
        if (at) { this.addPing(at); audio.radioCallout('contact'); }
        voice.objective(text);
        if (text !== this.missionRuntime.mission.current.brief) this.onEvent({ type: 'callout', text });
      },
      resupply: () => { this.hp = 100; this.frags = 5; this.flashes = 2; },
      scoreBonus: pts => { this.score += pts; },
      detonate: at => {
        // Use the existing blast resolution for damage, glass, particles and spatial audio.
        this.explode({ mesh: this.missionRuntime.markers.cache, pos: at, vel: new THREE.Vector3(), fuse: 0, kind: 'frag', fromAI: false });
        this.rebuildHittables();
      },
      finish: win => this.endMatch(win),
    }, mapId);
    this.buildSolidGrid();
    const first = this.missionRuntime.mission.current.at;
    this.yaw = Math.atan2(this.pos.x - first[0], this.pos.z - first[2]);
    this.rebuildHittables();

    this.bindInput();
    this.resize();
    this.composeCamera(1 / 60);
    this.animateViewmodel(1 / 60);
    this.camera.updateMatrixWorld(true);
    this.render();
    window.addEventListener('resize', this.resize);
    this.lastT = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ==================== INPUT HANDLING ====================
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || this.paused || this.dead || this.ended || !this.started || document.pointerLockElement !== this.canvas) return;
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyX') e.preventDefault();

    if (e.code === 'KeyR') this.startReload();
    if (e.code === 'Digit1') this.switchWeapon(0);
    if (e.code === 'Digit2') this.switchWeapon(1);
    if (e.code === 'Digit3') this.switchWeapon(2);
    if (e.code === 'Digit4') this.switchWeapon(3);
    if (e.code === 'Digit5') this.switchWeapon(4);

    // GRENADES
    if (e.code === 'KeyG' && this.frags > 0 && !this.cooking && this.reloadT < 0) {
      this.cooking = true;
      this.cookT = 0;
      audio.pinPull();
    }
    if (e.code === 'KeyF' && this.flashes > 0 && this.reloadT < 0) {
      this.flashes--;
      const dir = this.camDir();
      this.spawnGrenade(this.throwOrigin(dir), this.eyePos().addScaledVector(dir, 20), false, 'flash');
      audio.throwWhoosh();
    }

    // CROUCH & SLIDE MECHANIC
    if (e.code === 'KeyC' || e.code === 'ControlLeft') {
      // Trigger slide: sprint + crouch input simultaneously
      if (this.sprinting && this.grounded && !this.sliding && this.slideCD <= 0) {
        this.startSlide();
      } else {
        if (!this.sliding) {
          this.crouched = !this.crouched;
          this.crouchT = 0;
          if (this.crouched) this.sprinting = false;
        }
      }
    }

    // JUMP: 1.1m height, 0.47s air time. Cannot jump during slide or lean, 0.3s floor contact cooldown
    if (e.code === 'Space') {
      if (this.tryVault()) {
        // vaulted through a window
      } else if (this.grounded && !this.sliding && Math.abs(this.lean) < 0.2 && this.jumpCD <= 0) {
        this.vel.y = 6.2;
        this.grounded = false;
        this.crouched = false;
        this.jumpCD = 0.3;
        audio.jumpGrunt();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    // Never let a frag loose on a key release that arrives while paused, dead or
    // between missions (ESC mid-cook used to throw into the pause menu).
    if (e.code === 'KeyG' && this.cooking && !this.paused && !this.dead && !this.ended
      && document.pointerLockElement === this.canvas) this.throwFrag();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas || this.paused || this.dead) return;
    const sens = this.mouseSens * (this.ads > 0.5 ? this.adsSensMul : 1);
    this.yaw -= e.movementX * sens;
    this.pitch -= (this.invertY ? -e.movementY : e.movementY) * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  };

  private onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas || this.paused || this.dead) return;
    if (e.button === 0) {
      this.triggerHeld = true;
      this.tryFire();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.triggerHeld = false;
  };

  private onMouseDown2 = (e: MouseEvent) => {
    if (e.button === 2 && !this.paused && !this.dead && !this.ended && document.pointerLockElement === this.canvas) {
      // ADS toggle mode: MMB click keeps the scope in until the next MMB click.
      const want = this.adsToggle ? !this.rmb : true;
      this.rmb = want;
      // Cannot sprint while aiming down sights
      if (want && this.sprinting) {
        this.sprinting = false;
        this.sprintToAdsDelay = 0.2; // 200ms delay
      }
    }
  };

  private onMouseUp2 = (e: MouseEvent) => {
    if (e.button === 2 && !this.adsToggle) this.rmb = false;
  };

  private onContext = (e: Event) => e.preventDefault();

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousedown', this.onMouseDown2);
    window.addEventListener('mouseup', this.onMouseUp2);
    window.addEventListener('contextmenu', this.onContext);
  }

  async requestLock() {
    if (!this.canvas.requestPointerLock) throw new Error('Mouse capture is unavailable in this browser.');
    await this.canvas.requestPointerLock();
  }

  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  };

  /**
   * Single source of truth for render resolution. The EffectComposer caches its own
   * pixel ratio at construction and only updates it through setPixelRatio() — without
   * this, the resolution-scale slider and the adaptive scaler changed the canvas buffer
   * while the whole post-FX chain (scene + bloom + vignette) kept rendering at the old
   * full resolution, i.e. the "biggest FPS lever" was a placebo.
   */
  private syncPixelRatio() {
    const pr = Math.min(window.devicePixelRatio, this.dynPR);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
  }

  /** Gradient sky dome + sun glow + drifting clouds (cheap, huge visual payoff) */
  private addSkyDome() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#4A78A6');   // zenith blue
    grad.addColorStop(0.4, '#93B6C8');
    grad.addColorStop(0.58, '#D8C7A0'); // haze band
    grad.addColorStop(0.72, '#F0D6A2'); // warm horizon
    grad.addColorStop(0.85, '#F6C888');
    grad.addColorStop(1, '#EAB878');    // sun-warmed base
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(420, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    dome.renderOrder = -10;
    this.scene.add(dome);
    // Sun glow billboard
    const sc = document.createElement('canvas');
    sc.width = 128; sc.height = 128;
    const sctx = sc.getContext('2d')!;
    const rg = sctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,250,230,1)');
    rg.addColorStop(0.25, 'rgba(255,240,200,0.85)');
    rg.addColorStop(1, 'rgba(255,240,200,0)');
    sctx.fillStyle = rg;
    sctx.fillRect(0, 0, 128, 128);
    const sunTex = new THREE.CanvasTexture(sc);
    const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true }));
    sunSpr.position.set(-220, 200, 150);
    sunSpr.scale.setScalar(110);
    this.scene.add(sunSpr);
    // A few flat drifting clouds
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xF4EAD2, transparent: true, opacity: 0.75, fog: false, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const cl = new THREE.Mesh(new THREE.SphereGeometry(14 + Math.random() * 16, 10, 6), cloudMat);
      cl.position.set((Math.random() - 0.5) * 560, 130 + Math.random() * 60, (Math.random() - 0.5) * 560);
      cl.scale.y = 0.28;
      this.scene.add(cl);
    }
  }



  private eyePos(): THREE.Vector3 { return V().set(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }
  private camDir(): THREE.Vector3 { const d = V(); this.camera.getWorldDirection(d); return d; }

  private nearestWindow(): { w: { x: number; y: number; z: number }; glassIndex: number } | null {
    let best: { w: { x: number; y: number; z: number }; glassIndex: number } | null = null;
    let bd = 1.55;
    const ey = this.pos.y + this.eyeH;
    // world.windows and the glass InstancedMesh are index-aligned (both pushed together
    // in buildWorld's wallRun) — so the pane index lets a vault shatter its own glass.
    for (let i = 0; i < this.world.windows.length; i++) {
      const w = this.world.windows[i];
      if (Math.abs(w.y - ey) > 1.1) continue;
      const d = Math.hypot(w.x - this.pos.x, w.z - this.pos.z);
      if (d < bd) { bd = d; best = { w, glassIndex: i }; }
    }
    return best;
  }

  private tryVault(): boolean {
    const hit = this.nearestWindow();
    if (!hit) return false;
    const w = hit.w;
    // Climbing through a closed window should break the pane, not phase through it.
    const center = this.world.breakGlass(hit.glassIndex);
    if (center) { this.effects.glassShatter(center); audio.glassBreakSpatial(center.x, center.y, center.z); }
    const dx = w.x - this.pos.x, dz = w.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.pos.x = w.x + (dx / len) * 1.5;
    this.pos.z = w.z + (dz / len) * 1.5;
    this.vel.y = 3.6;
    this.grounded = false;
    this.crouched = false;
    this.jumpCD = 0.45;
    audio.jumpGrunt();
    return true;
  }

  /**
   * Renders an ACCURATE top-down tactical map from the real collision data.
   * World X maps to canvas X, world Z maps to canvas Y.
   */
  private generateMapImage(): string {
    const S = 512;
    const span = this.world.half * 2;
    const scale = S / span;
    const px = (wx: number) => (wx + span / 2) * scale;
    const pz = (wz: number) => (wz + span / 2) * scale;
    const [c, ctx] = this.makeCanvas(S, S);

    // --- terrain base: packed desert sand ---
    ctx.fillStyle = '#7D735A';
    ctx.fillRect(0, 0, S, S);
    // subtle large-scale mottling
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 26; i++) {
      const r = 28 + Math.random() * 70;
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- walkability shading (real solids: dark where you cannot walk) ---
    const blockers = this.world.solids.filter(b => b.maxY > 1.35 && b.minY < 1.75);
    const STEP = 4; // 512px / 4 = 128 samples per axis ≈ 1.7m per cell
    ctx.fillStyle = 'rgba(24,21,16,0.5)';
    for (let gy = 0; gy < S; gy += STEP) {
      for (let gx = 0; gx < S; gx += STEP) {
        const wx = (gx + STEP / 2) / scale - span / 2;
        const wz = (gy + STEP / 2) / scale - span / 2;
        let blocked = false;
        for (const b of blockers) {
          if (wx > b.minX && wx < b.maxX && wz > b.minZ && wz < b.maxZ) { blocked = true; break; }
        }
        if (blocked) ctx.fillRect(gx, gy, STEP, STEP);
      }
    }

    // --- roads / paved zones ---
    ctx.fillStyle = '#8C8877';
    for (const b of this.world.concrete) {
      ctx.fillRect(px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (const b of this.world.concrete) {
      ctx.fillRect(px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    }

    // --- faint survey grid ---
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= S; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
    }

    // --- building & cover footprints, low → tall so heights stack correctly ---
    const sorted = [...this.world.solids].sort((a, b) => a.maxY - b.maxY);
    for (const b of sorted) {
      const x = px(b.minX), y = pz(b.minZ);
      const w = Math.max(2.5, (b.maxX - b.minX) * scale);
      const h = Math.max(2.5, (b.maxZ - b.minZ) * scale);
      const tall = b.maxY > 3.4;
      const mid = !tall && b.maxY > 1.9;
      // drop shadow for depth
      ctx.fillStyle = 'rgba(20,16,10,0.35)';
      ctx.fillRect(x + 3, y + 3, w, h);
      // body colour by height class
      ctx.fillStyle = tall ? '#A98D68' : mid ? '#7C7558' : '#5E5A4B';
      ctx.fillRect(x, y, w, h);
      // sunlit top edge + shaded bottom edge for readable 3D-ish footprint
      ctx.fillStyle = 'rgba(255,244,214,0.28)';
      ctx.fillRect(x, y, w, Math.max(2, Math.min(4, h * 0.16)));
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + h - Math.max(2, Math.min(4, h * 0.16)), w, Math.max(2, Math.min(4, h * 0.16)));
      // crisp outline
      ctx.strokeStyle = 'rgba(12,9,5,0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
    }

    // --- border ---
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, S, S);
    return c.toDataURL();
  }

  private makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')!];
  }

  /** Returns the largest-magnitude lean in [-1,1] whose head position stays out of geometry */
  private clampLeanByWall(want: number): number {
    if (Math.abs(want) < 0.01) return want;
    const eye = this.eyePos();
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    const headR = 0.16;
    // Step down from the desired lean until the head sphere is clear
    for (let t = Math.abs(want); t >= 0; t -= 0.1) {
      const off = Math.sign(want) * t * 0.35;
      const hx = eye.x + rightX * off, hz = eye.z + rightZ * off;
      let clear = true;
      for (const b of this.world.solids) {
        if (b.maxY <= eye.y - 0.2 || b.minY >= eye.y + 0.2) continue;
        if (hx + headR > b.minX && hx - headR < b.maxX && hz + headR > b.minZ && hz - headR < b.maxZ) {
          clear = false;
          break;
        }
      }
      if (clear) return Math.sign(want) * t;
    }
    return 0;
  }

  private dirToScreenDeg(worldPos: THREE.Vector3): number {
    const dx = worldPos.x - this.pos.x, dz = worldPos.z - this.pos.z;
    const ang = Math.atan2(dx, dz);
    let rel = ang - this.yaw - Math.PI;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return -rel * 180 / Math.PI;
  }

  private addPing(p: THREE.Vector3) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    this.pings.push({ dir: bearing, age: 0 });
    if (this.pings.length > 14) this.pings.shift();
  }

  /** Build the solids spatial hash once per map load. */
  private buildSolidGrid() {
    this.solidGrid.clear();
    const c = this.GRID_CELL;
    for (const b of this.world.solids) {
      const x0 = Math.floor(b.minX / c), x1 = Math.floor(b.maxX / c);
      const z0 = Math.floor(b.minZ / c), z1 = Math.floor(b.maxZ / c);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x + ',' + z;
        let a = this.solidGrid.get(k);
        if (!a) { a = []; this.solidGrid.set(k, a); }
        a.push(b);
      }
    }
  }

  /** Collect solids near (x,z) within radius into a reused scratch array. */
  private nearSolids(x: number, z: number, r: number): AABB[] {
    const out = this.scratch;
    out.length = 0;
    const c = this.GRID_CELL;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const a = this.solidGrid.get(gx + ',' + gz);
      if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
    }
    return out;
  }

  private moveAxis(p: THREE.Vector3, dx: number, dz: number, radius: number, height: number) {
    const near = this.nearSolids(p.x, p.z, radius + Math.abs(dx) + Math.abs(dz) + 0.1);
    const tryMove = (nx: number, nz: number) => {
      for (let i = 0; i < near.length; i++) {
        const b = near[i];
        if (b.maxY <= p.y + 0.58) continue;                 // Steppable curb/stair
        if (b.minY >= p.y + height) continue;
        if (nx + radius > b.minX && nx - radius < b.maxX && nz + radius > b.minZ && nz - radius < b.maxZ) return false;
      }
      return true;
    };
    if (tryMove(p.x + dx, p.z)) p.x += dx;
    if (tryMove(p.x, p.z + dz)) p.z += dz;
    const lim = this.world.half - 2.5;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
  }

  private supportHeight(p: THREE.Vector3, radius: number): number {
    let s = 0;
    for (const b of this.world.solids) {
      if (b.maxY > p.y + 0.5) continue;
      if (p.x + radius * 0.6 > b.minX && p.x - radius * 0.6 < b.maxX && p.z + radius * 0.6 > b.minZ && p.z - radius * 0.6 < b.maxZ) {
        if (b.maxY > s) s = b.maxY;
      }
    }
    return s;
  }

  private surfaceAt(): 'sand' | 'concrete' | 'wood' {
    for (const b of this.world.wood) if (pointInAABB(this.pos.x, this.pos.y + 0.5, this.pos.z, b)) return 'wood';
    for (const b of this.world.interiors) if (pointInAABB(this.pos.x, this.pos.y + 0.5, this.pos.z, b)) return 'concrete';
    for (const b of this.world.concrete) if (pointInAABB(this.pos.x, this.pos.y + 0.5, this.pos.z, b)) return 'concrete';
    return 'sand';
  }

  private def() { return this.weapons[this.cur]; }

  private switchWeapon(i: number) {
    if (i === this.cur || this.switchT >= 0 || this.reloadT >= 0 || i >= this.weapons.length) return;
    this.switchT = 0;
    this.cooking = false;
    setTimeout(() => {
      if (this.disposed || this.ended) return;
      this.weapons[this.cur].model.group.visible = false;
      this.cur = i;
      this.weapons[i].model.group.visible = true;
    }, 130);
  }

  private startReload() {
    const d = this.def();
    if (this.reloadT >= 0 || this.mags[this.cur] >= d.magSize) return;
    if (!this.INFINITE_AMMO && this.reserves[this.cur] <= 0) return;
    if (this.mags[this.cur] === 0) voice.lowAmmo();
    const empty = this.mags[this.cur] === 0;
    this.reloadDur = empty ? d.emptyReload : d.tacReload;
    this.reloadT = 0;
    this.currentReloadStage = 'idle';

    const stages: { t: number; stage: HudState['reloadStage']; fn: () => void }[] = [
      {
        t: 0.28, stage: 'magOut', fn: () => {
          this.currentReloadStage = 'magOut';
          audio.magOut();
        },
      },
      {
        t: this.reloadDur * 0.55, stage: 'magIn', fn: () => {
          this.currentReloadStage = 'magIn';
          audio.magIn();
          // Counter jumps to new count on magazine in.
          // INFINITE AMMO: always refill to full; never let reserve drift to a finite number.
          const need = d.magSize - this.mags[this.cur];
          if (this.INFINITE_AMMO) {
            this.mags[this.cur] = d.magSize;
            this.reserves[this.cur] = Infinity;
          } else {
            const take = Math.min(need, this.reserves[this.cur]);
            this.mags[this.cur] += take;
            this.reserves[this.cur] -= take;
          }
        },
      },
    ];
    if (empty) {
      stages.push({
        t: this.reloadDur * 0.82, stage: 'ready', fn: () => {
          this.currentReloadStage = 'ready';
          audio.boltRelease();
        },
      });
    } else {
      stages.push({
        t: this.reloadDur * 0.8, stage: 'ready', fn: () => {
          this.currentReloadStage = 'ready';
          audio.forwardAssist();
        },
      });
    }
    stages.push({
      t: this.reloadDur, stage: 'ready', fn: () => {
        this.currentReloadStage = 'ready';
        this.reloadT = -1;
      },
    });
    this.reloadStages = stages;
  }

  // ==================== SLIDE MECHANIC ====================
  // Trigger: sprint + crouch input simultaneously
  // Start speed: 7.2 m/s. Decelerates to 0 over 0.8s.
  // Cannot fire or ADS during slide. Cooldown: 1.2s.
  private startSlide() {
    this.sliding = true;
    this.slideT = 0;
    this.crouched = false;
    this.slideCD = 1.2;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.slideDir.set(-sin, 0, -cos);
    audio.slideDrag(this.surfaceAt());
  }

  // ==================== 100% ACCURATE LASER BALLISTICS ====================
  private tryFire() {
    if (this.paused || this.dead || this.ended || !this.started) return;
    if (this.fireCD > 0 || this.reloadT >= 0 || this.switchT >= 0 || this.cooking) return;
    if (this.sprinting || this.sprintToFireDelay > 0) return; // Cannot fire during sprint
    if (this.sliding) return; // Cannot fire during slide

    const d = this.def();
    if (this.mags[this.cur] <= 0) {
      audio.dryFire();
      this.fireCD = 0.22;
      if (this.reserves[this.cur] > 0) this.startReload();
      return;
    }
    this.mags[this.cur]--;
    this.fireCD = 60 / d.rpm;
    this.shots++;
    this.shotResetT = 0.28;

    // 1. CALCULATE EXACT BULLET TRAJECTORY FIRST BEFORE RECOIL
    // In ADS: spread is 0.000 — 100% exact center of your sight picture
    const isAds = this.ads > 0.65;
    let spread = isAds ? 0.0 : THREE.MathUtils.lerp(d.hipSpread, d.adsSpread, this.ads);
    if (!isAds) {
      if (this.inputMoving()) spread *= 1.2;
      if (this.crouched) spread *= 0.7;
    }
    this.spreadNow = spread;

    // Bullet = exact screen-center ray. Origin MUST be the real camera position
    // (includes lean offset, bob, shake) — using feet+eyeH here was offsetting
    // every shot sideways whenever leaning or moving.
    const dir = this._t1;
    this.camera.getWorldDirection(dir);
    if (spread > 0.0001) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }

    // When leaning, skip nearby world geometry so peeking around a corner works.
    // Recomputed from the LIVE smoothed lean every shot — never stale.
    const skip = 0.55 + Math.abs(this.lean) * 0.95;
    const origin = this._t2.copy(this.camera.position);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 300;
    const rawHits = this.raycaster.intersectObjects(this.hittables, false);
    // Ignore world geometry inside the skip bubble (leaning against a wall must
    // never eat your own bullet) — but never ignore an enemy, even point-blank.
    let h: THREE.Intersection | null = null;
    for (const cand of rawHits) {
      const isEnemy = (cand.object.userData.enemy as Enemy | undefined) !== undefined;
      if (!isEnemy && cand.distance < skip) continue;
      h = cand;
      break;
    }
    // Tracer starts just off the camera (gun-side) so it reads as coming from
    // the rifle but converges onto the crosshair ray instead of flying sideways.
    const me = this.camera.matrix.elements;
    const muzzleWorld = this._t3.copy(origin).addScaledVector(dir, 0.55);
    muzzleWorld.x += me[0] * 0.09 + me[4] * -0.07;
    muzzleWorld.y += me[1] * 0.09 + me[5] * -0.07;
    muzzleWorld.z += me[2] * 0.09 + me[6] * -0.07;

    // Destructible glass: shatter and let the bullet continue to the next hit
    if (h && h.object.userData.glass && h.instanceId !== undefined) {
      const c = this.world.breakGlass(h.instanceId);
      if (c) { this.effects.glassShatter(c); audio.glassBreakSpatial(c.x, c.y, c.z); }
      h = rawHits.find(x => x !== h && !(x.object.userData.glass) && (x.distance >= skip || x.object.userData.enemy)) ?? null;
    }

    if (h) {
      this.effects.tracer(muzzleWorld, h.point);
      const enemy = (h.object.userData.enemy as Enemy | undefined);
      if (enemy && !enemy.dead) {
        const part = h.object.userData.part as string;
        let dmg = d.damage;
        if (part === 'head') dmg *= d.headMul;
        else if (part === 'limb') dmg *= d.limbMul;
        if (h.distance > 35) dmg *= 0.85;
        this.hits++;
        this.effects.blood(h.point);
        audio.fleshImpact(0);
        const killed = enemy.takeDamage(dmg, part === 'head');
        if (killed) {
          this.kills++;
          // Matches the HUD score popups exactly: 100 per elimination, 150 for a headshot.
          this.score += part === 'head' ? 150 : 100;
          audio.killConfirm();
          const isHead = part === 'head';
          if (isHead) {
            this.headshots++;
            voice.headshot();
          }
          if (this.kills === 1) voice.firstBlood();
          // Field resupply: every 3rd kill restocks a grenade so utility never runs dry
          if (this.kills % 3 === 0) {
            this.frags = Math.min(5, this.frags + 1);
            this.flashes = Math.min(2, this.flashes + 1);
          }
          const now = performance.now();
          if (now - this.lastKillT < 2600) this.streak++;
          else this.streak = 1;
          this.lastKillT = now;
          if (this.streak >= 2) {
            const label = this.streak >= 5 ? 'UNSTOPPABLE' : this.streak === 4 ? 'MEGA KILL' : this.streak === 3 ? 'MULTI KILL' : 'DOUBLE KILL';
            voice.streak(label);
            this.onEvent({ type: 'streak', label });
          }
          this.onEvent({ type: 'hit', kill: true });
          this.onEvent({ type: 'kill', name: enemy.name, weapon: d.name, headshot: part === 'head' });
          this.rebuildHittables();
        } else {
          audio.hitMarker();
          this.onEvent({ type: 'hit', kill: false });
        }
      } else {
        const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
        this.effects.impact(h.point, n);
        audio.bulletImpact(0, h.distance);
      }
    } else {
      this.effects.tracer(muzzleWorld, origin.clone().addScaledVector(dir, 140));
    }

    // 2. NOW APPLY SOFTENED RECOIL AFTER THE BULLET HAS BEEN FIRED
    // (~40% gentler than before — present but never annoying)
    const pat = d.pattern[Math.min(this.shotIdx, d.pattern.length - 1)];
    this.shotIdx++;
    const adsRecoilReduction = isAds ? 0.6 : 1.0;
    const kickP = pat[0] * 0.0052 * adsRecoilReduction;
    const kickY = pat[1] * 0.0032 * adsRecoilReduction;
    this.pitch += kickP * 0.32;
    this.yaw += kickY * 0.32;
    this.recoilP += kickP * 0.45;
    this.recoilY += kickY * 0.45;
    this.vmKick = 1;
    this.vmKickRot = 1;

    // Audio & Muzzle Flash — each weapon gets its own signature report
    if (this.cur === 0) audio.fireM4();
    else if (this.cur === 1) audio.fireAK();
    else if (this.cur === 2) audio.firePistol();
    else if (this.cur === 3) audio.fireSniper();
    else audio.fireSMG();

    const mf = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    mf.opacity = 1;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleFlash.scale.setScalar((0.85 + Math.random() * 0.5) * 1.6);
    this.vmLight.intensity = 3.5;
    this.effects.playerFlash(origin.clone().addScaledVector(dir, 1.0));
    this.ai.notifyGunshot(this.pos, 65);
    this.staticTime = 0;
  }

  private rebuildHittables() {
    this.hittables = [...this.world.occluders];
    if (this.world.glass) this.hittables.push(this.world.glass);
    for (const e of this.ai.enemies) {
      if (!e.dead) this.hittables.push(...e.model.hitMeshes);
    }
  }

  // ==================== GRENADE SYSTEM ====================
  private grenadeLaunchVel(from: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const flat = V().set(target.x - from.x, 0, target.z - from.z);
    const dist = flat.length();
    flat.normalize();
    const speed = Math.min(19, 7.5 + dist * 0.46);
    const v = flat.multiplyScalar(speed);
    v.y = 4.8 + dist * 0.18;
    return v;
  }

  private spawnGrenade(from: THREE.Vector3, target: THREE.Vector3, fromAI: boolean, kind: 'frag' | 'flash' = 'frag') {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 8),
      new THREE.MeshStandardMaterial({ color: kind === 'frag' ? 0x243224 : 0x2A2A38, roughness: 0.5, metalness: 0.6 })
    );
    mesh.castShadow = true;
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.grenades.push({
      mesh,
      pos: from.clone(),
      vel: this.grenadeLaunchVel(from, target),
      fuse: fromAI ? 3.2 : (kind === 'flash' ? 1.8 : Math.max(0.3, 4 - this.cookT)),
      kind,
      fromAI,
    });
  }

  /** Eye-height throw origin that refuses to spawn a grenade inside a wall. */
  private throwOrigin(dir: THREE.Vector3): THREE.Vector3 {
    const eye = this.eyePos();
    for (const d of [0.5, 0.28, 0.12]) {
      const p = eye.clone().addScaledVector(dir, d);
      if (!this.pointInSolid(p, 0.12)) return p;
    }
    return eye;
  }

  private pointInSolid(p: THREE.Vector3, r: number): boolean {
    const near = this.nearSolids(p.x, p.z, r + 0.2);
    for (let i = 0; i < near.length; i++) {
      const b = near[i];
      if (p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ && p.y > b.minY && p.y < b.maxY) return true;
    }
    return false;
  }

  private throwFrag() {
    if (!this.cooking) return;
    this.cooking = false;
    this.frags--;
    this.arcPreview.visible = false;
    // Overhand throw: velocity follows the camera's pitch, so looking up lofts it
    // into an arc and looking down throws it flat/low. This reads as a real throw.
    const dir = this.camDir();
    const v = new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(17);
    v.y += 5.2;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x2E382E, roughness: 0.55, metalness: 0.55 })
    );
    mesh.castShadow = true;
    const from = this.throwOrigin(dir);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.grenades.push({
      mesh, pos: from.clone(), vel: v, fuse: Math.max(0.4, 4 - this.cookT), kind: 'frag', fromAI: false,
    });
    audio.throwWhoosh();
    this.staticTime = 0;
  }

  private explode(g: Grenade) {
    const distP = g.pos.distanceTo(this.eyePos());
    if (g.kind === 'frag') {
      this.effects.explosion(g.pos);
      // blast wave blows out nearby windows
      if (this.world.glass) {
        const m = new THREE.Matrix4(), p = new THREE.Vector3();
        for (let i = 0; i < this.world.glass.count; i++) {
          this.world.glass.getMatrixAt(i, m); p.setFromMatrixPosition(m);
          if (p.distanceTo(g.pos) < 9) { const c = this.world.breakGlass(i); if (c) this.effects.glassShatter(c); }
        }
        audio.glassBreakSpatial(g.pos.x, g.pos.y + 1, g.pos.z);
      }
      // FULL POSITION-ACCURATE HRTF SPATIAL AUDIO
      audio.explosionSpatial(g.pos.x, g.pos.y, g.pos.z, distP);
      this.shake = Math.max(this.shake, Math.min(1.1, 9 / Math.max(2.5, distP)));
      if (distP < 6.5) {
        const dmg = distP < 3.2 ? 95 : THREE.MathUtils.lerp(95, 20, (distP - 3.2) / 3.3);
        this.damagePlayer(dmg, g.pos);
      }
      for (const e of this.ai.enemies) {
        if (e.dead) continue;
        const d = e.pos.distanceTo(g.pos);
        if (d < 7) {
          const dmg = d < 3.5 ? 130 : THREE.MathUtils.lerp(110, 30, (d - 3.5) / 3.5);
          const killed = e.takeDamage(dmg, false);
          if (killed && !g.fromAI) {
            this.kills++;
            this.score += 100;
            if (this.kills === 1) voice.firstBlood();
            if (this.kills % 3 === 0) {
              this.frags = Math.min(5, this.frags + 1);
              this.flashes = Math.min(2, this.flashes + 1);
            }
            audio.killConfirm();
            this.onEvent({ type: 'kill', name: e.name, weapon: 'FRAG', headshot: false });
            this.rebuildHittables();
          }
        }
      }
    } else {
      audio.explosionSpatial(g.pos.x, g.pos.y, g.pos.z, Math.max(distP, 12));
      audio.flashRing();
      if (distP < 16 && !this.dead) {
        const toG = g.pos.clone().sub(this.eyePos()).normalize();
        const facing = this.camDir().dot(toG);
        if (facing > -0.1) {
          const power = Math.min(1, (1 - distP / 16) * (0.4 + facing * 0.6) + 0.25);
          this.onEvent({ type: 'flash', power });
        }
      }
      for (const e of this.ai.enemies) {
        if (!e.dead && e.pos.distanceTo(g.pos) < 12) e.applyStun(4.0);
      }
    }
    this.scene.remove(g.mesh);
    g.mesh.geometry.dispose();
  }

  private updateGrenades(dt: number) {
    let closestDist = 999;
    let closestAngle = 0;

    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 16.5 * dt;
      const nx = g.pos.x + g.vel.x * dt;
      const ny = g.pos.y + g.vel.y * dt;
      const nz = g.pos.z + g.vel.z * dt;

      // Solid collision & bounce (hashed lookup)
      let bounced = false;
      const near = this.nearSolids(nx, nz, 0.4);
      for (let bi = 0; bi < near.length; bi++) {
        const b = near[bi];
        if (nx > b.minX - 0.08 && nx < b.maxX + 0.08 && nz > b.minZ - 0.08 && nz < b.maxZ + 0.08 && ny > b.minY && ny < b.maxY) {
          if (g.pos.x <= b.minX - 0.06 || g.pos.x >= b.maxX + 0.06) { g.vel.x *= -0.4; bounced = true; }
          else if (g.pos.z <= b.minZ - 0.06 || g.pos.z >= b.maxZ + 0.06) { g.vel.z *= -0.4; bounced = true; }
          else if (g.pos.y >= b.maxY) {
            g.vel.y = Math.abs(g.vel.y) * -0.38;
            g.pos.y = b.maxY + 0.08;
            g.vel.x *= 0.6;
            g.vel.z *= 0.6;
            bounced = true;
          }
          break;
        }
      }
      if (!bounced) g.pos.set(nx, ny, nz);
      if (g.pos.y < 0.08) {
        g.pos.y = 0.08;
        if (Math.abs(g.vel.y) > 0.8) {
          g.vel.y = Math.abs(g.vel.y) * 0.35;
          audio.grenadeBounceSpatial(g.pos.x, g.pos.y, g.pos.z);
        } else {
          g.vel.y = 0;
        }
        g.vel.x *= 0.82;
        g.vel.z *= 0.82;
      }
      g.mesh.position.copy(g.pos);

      // REAL-TIME GRENADE INDICATOR: Appears when within 12m
      const dist = g.pos.distanceTo(this.pos);
      if (dist < 12 && g.fuse > 0.1) {
        if (dist < closestDist) {
          closestDist = dist;
          closestAngle = this.dirToScreenDeg(g.pos);
        }
      }

      if (g.fuse <= 0) {
        this.explode(g);
        this.grenades.splice(i, 1);
      }
    }

    if (closestDist <= 12) {
      this.lastGrenadeDist = closestDist;
      this.lastGrenadeAngle = closestAngle;
    } else {
      this.lastGrenadeDist = undefined;
      this.lastGrenadeAngle = undefined;
    }

    // Cook arc trajectory preview
    if (this.cooking) {
      this.cookT += dt;
      if (this.cookT >= 3.7) this.throwFrag();
      const dir = this.camDir();
      const target = this.eyePos().addScaledVector(dir, 5 + 22 * Math.max(0.15, dir.y * 0.5 + 0.75));
      const v = this.grenadeLaunchVel(this.eyePos(), target);
      const p = this.eyePos().addScaledVector(dir, 0.4);
      const arr = this.arcPreview.geometry.attributes.position.array as Float32Array;
      const step = 0.075;
      for (let k = 0; k < 40; k++) {
        arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z;
        v.y -= 16.5 * step;
        p.addScaledVector(v, step);
        if (p.y < 0.05) p.y = 0.05;
      }
      this.arcPreview.geometry.attributes.position.needsUpdate = true;
      this.arcPreview.visible = true;
    } else {
      this.arcPreview.visible = false;
    }
  }

  private lastGrenadeDist?: number;
  private lastGrenadeAngle?: number;

  private damagePlayer(amount: number, from: THREE.Vector3) {
    if (this.dead) return;
    this.hp -= amount;
    this.lastDamageT = 0;
    this.shake = Math.max(this.shake, Math.min(0.7, amount / 35));
    audio.playerHurt();
    // DIRECTIONAL DAMAGE ARCS: Scaled by damage amount
    this.onEvent({ type: 'damage', dir: this.dirToScreenDeg(from), amount });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.endMatch(false);
    }
  }

  private endMatch(win: boolean) {
    if (this.ended) return;
    if (win && this.missionRuntime.mission.status !== 'complete') return;
    this.ended = true;
    if (!win) this.missionRuntime.mission.fail();
    if (win) this.score += 1000; // extraction bonus, mirrors the debrief footnote
    const mission = this.missionRuntime.mission.report();
    this.pendingResult = {
      type: 'end', win, kills: this.kills, score: this.score, shots: this.shots, hits: this.hits,
      headshots: this.headshots, timeSec: mission.duration,
      mission, pressure: this.missionRuntime.pressure.stats(),
    };
    this.finishDelay = win ? 0.6 : 0.8;
    this.triggerHeld = false; this.rmb = false; this.keys.clear();
    if (win) voice.objective('Extraction complete. Nomad has you.');
    else voice.defeat();
  }

  private inputMoving(): boolean {
    const k = this.keys;
    return k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD');
  }

  // ==================== MAIN GAME LOOP ====================
  private frame = (t: number) => {
    if (this.disposed) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    // rolling FPS meter
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.25) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    this.adaptResolution(t);
    if (this.paused) return;
    if (this.ended) {
      this.finishDelay -= dt;
      if (this.finishDelay <= 0 && this.pendingResult) {
        const result = this.pendingResult; this.pendingResult = null;
        this.onEvent(result);
      }
      return;
    }
    this.update(dt);
    this.render();
  };

  private update(dt: number) {
    const k = this.keys;

    // Animated film grain
    this.vignettePass.uniforms.uTime.value = performance.now() / 1000;

    // UPDATE SPATIAL AUDIO LISTENER POSITION & FORWARD/UP ORIENTATION
    const eye = this.eyePos();
    const camDir = this.camDir();
    audio.updateListener(eye.x, eye.y, eye.z, camDir.x, camDir.y, camDir.z, 0, 1, 0);

    // ==================== BUTTERY LEAN Q/E SYSTEM ====================
    // Q = Lean Left (-1), E = Lean Right (+1)
    // Critically-damped exponential smoothing (~260ms settle, zero snap),
    // with lateral translation clamped so you can never lean inside a wall.
    let wantLean = 0;
    if (k.has('KeyQ')) wantLean -= 1;
    if (k.has('KeyE')) wantLean += 1;
    if (this.sprinting || this.sliding) wantLean = 0;
    this.leanTarget = wantLean;

    // Exponential smoothing — fast attack, soft landing, no visible steps
    const leanK = 1 - Math.exp(-dt * 9);
    this.lean += (this.leanTarget - this.lean) * leanK;
    if (Math.abs(this.leanTarget - this.lean) < 0.002) this.lean = this.leanTarget;
    // Never lean your head through geometry
    this.lean = this.clampLeanByWall(this.lean);

    // ADS TRANSITION (160ms ease-out)
    const wantAds = this.rmb && !this.sprinting && this.reloadT < 0 && this.switchT < 0 && !this.cooking && !this.sliding;
    this.sprintToAdsDelay = Math.max(0, this.sprintToAdsDelay - dt);
    this.sprintToFireDelay = Math.max(0, this.sprintToFireDelay - dt);

    // Smooth, frame-rate independent scope-in/out (fast attack, soft settle — no linear snap)
    {
      const target = wantAds && this.sprintToAdsDelay <= 0 ? 1 : 0;
      const rate = target ? 15 : 18;
      this.ads += (target - this.ads) * (1 - Math.exp(-dt * rate));
      if (Math.abs(target - this.ads) < 0.004) this.ads = target;
    }

    // ==================== MOVEMENT SPEED & SPRINT DELAYS ====================
    // WALK: 4.2 m/s. SPRINT: 6.8 m/s. CROUCH: 2.8 m/s. ADS: 2.8 m/s. LEAN: 3.4 m/s.
    let ix = 0, iz = 0;
    if (k.has('KeyW')) iz -= 1;
    if (k.has('KeyS')) iz += 1;
    if (k.has('KeyA')) ix -= 1;
    if (k.has('KeyD')) ix += 1;
    const moving = ix !== 0 || iz !== 0;

    const wasSprinting = this.sprinting;
    // Cannot sprint from crouch without standing first
    // Cannot sprint while aiming down sights or while leaning
    this.sprinting = k.has('ShiftLeft') && !this.rmb && iz < 0 && !this.crouched && !this.sliding
      && this.ads < 0.25 && this.reloadT < 0 && this.switchT < 0 && Math.abs(this.lean) < 0.25 && moving;

    if (wasSprinting && !this.sprinting) {
      this.sprintToFireDelay = 0.2; // 200ms sprint-to-fire delay
      this.sprintToAdsDelay = 0.2;  // 200ms sprint-to-ads delay
    }

    let speed = 0;
    if (!this.sliding && !this.dead) {
      if (this.sprinting) speed = 6.8;
      else if (this.crouched) speed = 2.8;
      else if (this.ads > 0.5) speed = 2.8;
      else if (Math.abs(this.lean) > 0.3) speed = 3.4;
      else if (moving) speed = 4.2;
    }

    // Slide physics: Decelerates from 7.2 m/s to 0 over 0.8s
    if (this.sliding) {
      this.slideT += dt;
      const sp = THREE.MathUtils.lerp(7.2, 0.5, Math.min(1, this.slideT / 0.8));
      this.vx = this.slideDir.x * sp;
      this.vz = this.slideDir.z * sp;
      if (this.slideT >= 0.8) {
        this.sliding = false;
        this.crouched = true; // Transitions to crouch at slide end
      }
    } else if (moving && !this.dead) {
      const len = Math.hypot(ix, iz) || 1;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const dx = (ix * cos + iz * sin) / len;
      const dz = (-ix * sin + iz * cos) / len;
      const air = this.grounded ? 1 : 0.35;
      const accel = Math.min(1, dt * (this.grounded ? 15 : 6));
      this.vx += (dx * speed * air - this.vx) * accel;
      this.vz += (dz * speed * air - this.vz) * accel;
    } else {
      const f = Math.min(1, dt * 18);
      this.vx *= 1 - f;
      this.vz *= 1 - f;
    }

    const dxm = this.vx * dt, dzm = this.vz * dt;
    // Slim 0.33 capsule slips through doorways instead of snagging on frames
    this.moveAxis(this.pos, dxm, dzm, 0.33, this.crouched ? 1.2 : 1.75);

    // Stride-based footsteps
    if (this.grounded && (Math.abs(dxm) > 0.0005 || Math.abs(dzm) > 0.0005)) {
      this.stepAcc += Math.hypot(dxm, dzm);
      const stride = this.sprinting ? 0.95 : this.sliding ? 1.8 : this.crouched ? 0.55 : 0.68;
      while (this.stepAcc >= stride) {
        this.stepAcc -= stride;
        this.footPhase += Math.PI;
        const surf = this.surfaceAt();
        audio.footstep(surf, this.sprinting, this.crouched);
        if (surf === 'sand' && !this.crouched) {
          this.effects.footDust(V().set(this.pos.x, this.pos.y + 0.04, this.pos.z));
        }
        if (!this.crouched) {
          this.ai.notifyGunshot(this.pos, this.sprinting ? 14 : 8);
        }
      }
    }

    this.slideCD = Math.max(0, this.slideCD - dt);
    this.jumpCD = Math.max(0, this.jumpCD - dt);

    // Gravity & Jump Landing Dip (0.08m over 80ms, spring back 150ms)
    const support = this.supportHeight(this.pos, 0.4);
    if (this.pos.y > support + 0.001) {
      this.vel.y -= 18.5 * dt;
      this.pos.y += this.vel.y * dt;
      this.grounded = false;
      if (this.pos.y <= support) {
        this.pos.y = support;
        this.vel.y = 0;
        this.grounded = true;
        // Landing audio + camera dip
        audio.jumpLand(this.surfaceAt());
        this.landDip = 0.08;
      }
    } else {
      this.pos.y += Math.min(support - this.pos.y, dt * 8);
      this.grounded = true;
      if (this.vel.y > 0) {
        this.pos.y += this.vel.y * dt;
        this.vel.y -= 18.5 * dt;
        this.grounded = false;
      }
    }

    // Recover landing dip
    if (this.landDip > 0) {
      this.landDip = Math.max(0, this.landDip - dt * (0.08 / 0.15));
    }

    // CROUCH CAMERA HEIGHT: -0.4m from stand height (180ms ease-out)
    this.crouchT = Math.min(1, this.crouchT + dt / 0.18);
    const targetEye = this.dead ? 0.35 : (this.sliding || this.crouched) ? 1.22 : 1.62;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 11);

    // Static time for AI flush
    if (this.pos.distanceTo(this.lastPos) < 0.4) this.staticTime += dt;
    else { this.staticTime = 0; this.lastPos.copy(this.pos); }

    // Health regen (to 50 HP after 5s)
    this.lastDamageT += dt;
    if (!this.dead && this.lastDamageT > 5 && this.hp < 50) {
      this.hp = Math.min(50, this.hp + dt * 10);
    }

    // Auto weapon fire
    this.fireCD -= dt;
    if (this.triggerHeld && this.def().auto) this.tryFire();
    this.shotResetT -= dt;
    if (this.shotResetT <= 0) this.shotIdx = 0;

    // Recoil recovery (80ms snappy return)
    const rec = Math.min(1, dt / 0.08);
    this.recoilP *= 1 - rec;
    this.recoilY *= 1 - rec;

    // Staged reload
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      while (this.reloadStages.length && this.reloadT >= this.reloadStages[0].t) {
        this.reloadStages.shift()!.fn();
      }
    }
    if (this.switchT >= 0) {
      this.switchT += dt;
      if (this.switchT > 0.28) this.switchT = -1;
    }

    // Decay visual effects
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.vmKick = Math.max(0, this.vmKick - dt / 0.08);
    this.vmKickRot = Math.max(0, this.vmKickRot - dt / 0.12);
    const mf = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    mf.opacity = Math.max(0, mf.opacity - dt * 25);
    this.vmLight.intensity = Math.max(0, this.vmLight.intensity - dt * 65);

    // Indoor echo check
    let isIndoor = false;
    for (const b of this.world.interiors) {
      if (pointInAABB(this.pos.x, this.pos.y + 1, this.pos.z, b)) { isIndoor = true; break; }
    }
    audio.setIndoor(isIndoor);

    // Age pings
    for (const p of this.pings) p.age += dt;
    this.pings = this.pings.filter(p => p.age < 3.2);

    this.updateGrenades(dt);
    this.ai.update(dt);
    this.effects.update(dt, this.pos);
    this.composeCamera(dt);
    this.animateViewmodel(dt);
    this.camera.updateMatrixWorld(true);
    this.missionRuntime.update(dt, this.keys.has('KeyX') && this.reloadT < 0 && !this.cooking && !this.sprinting);
    if (this.ai.rosterVersion !== this.rosterVersion) {
      this.rosterVersion = this.ai.rosterVersion;
      this.rebuildHittables();
    }
  }

  // ==================== CAMERA POSITION & LEAN ====================
  private composeCamera(dt: number) {
    void dt;
    const eye = this.eyePos();
    eye.y -= this.landDip;

    // LEAN SPECIFICATION:
    // Q (lean -1): Camera rolls -35 deg on Z-axis, translates left +0.35m in camera lateral axis
    // E (lean +1): Mirror of lean left (+35 deg, translate right)
    const roll = -this.lean * (35 * Math.PI / 180);
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    eye.x += rightX * this.lean * 0.35;
    eye.z += rightZ * this.lean * 0.35;

    // Stride bob
    const bobAmp = this.sprinting ? 0.022 : 0.012;
    const bob = Math.sin(this.footPhase) * bobAmp * (this.grounded ? 1 : 0);
    eye.y += bob;

    // Camera shake (scaled by user setting)
    if (this.shake > 0.001) {
      const k = this.motionBlurAmount;
      eye.x += (Math.random() - 0.5) * this.shake * 0.14 * k;
      eye.y += (Math.random() - 0.5) * this.shake * 0.14 * k;
    }

    this.camera.position.copy(eye);
    this.camera.rotation.set(
      this.pitch + this.recoilP + (this.sprinting ? -0.02 : 0) + (this.shake > 0.001 ? (Math.random() - 0.5) * this.shake * 0.05 : 0),
      this.yaw + this.recoilY,
      roll
    );

    // Smooth FOV — per-weapon ADS zoom (sniper gets a strong scope, others a modest pull-in)
    const adsFov = this.def().adsFov;
    const targetFov = THREE.MathUtils.lerp(this.sprinting ? this.fovSetting + 5 : this.fovSetting, adsFov, this.ads);
    const fk = 1 - Math.exp(-dt * 16);
    this.camera.fov += (targetFov - this.camera.fov) * fk;
    this.camera.updateProjectionMatrix();

    const vmFov = THREE.MathUtils.lerp(68, 56, this.ads);
    this.vmCamera.fov += (vmFov - this.vmCamera.fov) * fk;
    this.vmCamera.updateProjectionMatrix();
  }

  // ==================== VIEWMODEL ANIMATION ====================
  private animateViewmodel(dt: number) {
    const S = this.VM_S;
    const d = this.def();
    const g = d.model.group;
    g.scale.setScalar(S);

    const t = performance.now() / 1000;
    const a = this.ads;

    // ADS: put the sight line EXACTLY on screen center — sight height above the
    // gun origin, scaled. In-model reticles/lenses hide so the HUD draws ONE crisp
    // sight (and the sniper scope tube stops blocking the view).
    const inAds = a > 0.4;
    for (const obj of d.model.adsHidden) obj.visible = !inAds;
    const hip = { x: 0.22, y: -0.19, z: -0.38, ry: 0.035 };
    const adsY = -d.model.sightY * S;
    let px = THREE.MathUtils.lerp(hip.x, 0, a);
    let py = THREE.MathUtils.lerp(hip.y, adsY, a);
    let pz = THREE.MathUtils.lerp(hip.z, -0.34, a);
    let rx = 0;
    let ry = THREE.MathUtils.lerp(hip.ry, 0, a);
    let rz = 0;

    // Idle sway
    const swayM = 1 - a * 0.95;
    px += Math.sin(t * Math.PI) * 0.004 * S * swayM;
    py += Math.sin(t * Math.PI * 2 + 1) * 0.0035 * S * swayM;

    // Walk bob
    const bobM = this.inputMoving() && this.grounded ? 1 : 0;
    px += Math.sin(this.footPhase) * 0.01 * S * bobM * swayM;
    py -= Math.abs(Math.cos(this.footPhase)) * 0.007 * S * bobM * swayM;
    rz += Math.sin(this.footPhase) * 0.012 * S * bobM * swayM;

    // Sprint lower weapon
    if (this.sprinting) this.sprintPose = Math.min(1, this.sprintPose + dt / 0.15);
    else this.sprintPose = Math.max(0, this.sprintPose - dt / 0.12);
    const sp = this.sprintPose;
    px += sp * 0.08 * S; py -= sp * 0.13 * S; pz -= sp * 0.04;
    rx += sp * 0.52; ry -= sp * 0.45; rz += sp * 0.26;

    // Fire kick (halved in ADS so the sight picture stays on target)
    const kickM = 1 - a * 0.55;
    pz += this.vmKick * 0.05 * S * kickM;
    rx += this.vmKickRot * 0.075 * kickM;

    // Reload animation — gun dips/tilts, mag drops, LEFT HAND works the reload
    const magObj = d.model.mag;
    if (this.reloadT >= 0) {
      const rt = this.reloadT / this.reloadDur;
      const dip = Math.sin(Math.min(1, rt) * Math.PI);
      py -= dip * 0.10 * S;
      rx -= dip * 0.5;
      rz += dip * 0.22;
      const out = rt > 0.14 && rt < 0.58 ? Math.sin(((rt - 0.14) / 0.44) * Math.PI) : 0;
      magObj.position.y = (this.cur === 2 ? 0 : -0.03) - out * 0.17 * S;
      this.poseLArm(d, rt);
    } else {
      magObj.position.y = this.cur === 0 || this.cur === 1 || this.cur === 4 ? -0.03 : 0;
      if (d.model.lArm) {
        d.model.lArm.position.multiplyScalar(1 - Math.min(1, dt * 14));
        d.model.lArm.rotation.x *= 1 - Math.min(1, dt * 14);
        d.model.lArm.rotation.z *= 1 - Math.min(1, dt * 14);
      }
    }

    // Switch raise
    if (this.switchT >= 0) {
      const dip2 = Math.sin((this.switchT / 0.28) * Math.PI);
      py -= dip2 * 0.26 * S;
      rx -= dip2 * 0.75;
    }

    // Grenade cooking pose
    if (this.cooking) {
      px += 0.12 * S; py -= 0.09 * S; rz += 0.32; rx += 0.18;
    }

    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);

    const mw = V();
    d.model.muzzle.getWorldPosition(mw);
    this.muzzleFlash.position.copy(mw);
    this.vmLight.position.copy(mw);
  }
  private sprintPose = 0;

  /** Drives the viewmodel left arm through reload keyframes (mag grab → pull → seat → tap). */
  private poseLArm(d: { model: { lArm: THREE.Object3D | null; lArmKeys: { t: number; p: [number, number, number]; r: [number, number, number] }[] } }, rt: number) {
    const arm = d.model.lArm;
    const keys = d.model.lArmKeys;
    if (!arm || !keys.length) return;
    let i = 0;
    while (i < keys.length - 2 && rt > keys[i + 1].t) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const f = Math.max(0, Math.min(1, (rt - k0.t) / Math.max(0.0001, k1.t - k0.t)));
    const s = f * f * (3 - 2 * f); // smoothstep — no snapping between keys
    arm.position.set(
      k0.p[0] + (k1.p[0] - k0.p[0]) * s,
      k0.p[1] + (k1.p[1] - k0.p[1]) * s,
      k0.p[2] + (k1.p[2] - k0.p[2]) * s,
    );
    arm.rotation.set(
      k0.r[0] + (k1.r[0] - k0.r[0]) * s,
      k0.r[1] + (k1.r[1] - k0.r[1]) * s,
      k0.r[2] + (k1.r[2] - k0.r[2]) * s,
    );
  }

  private render() {
    // Shadow map refresh every 3rd frame (world is static; only enemies move)
    this.frameNo++;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = (this.frameNo % 3) === 0;
    if (this.postFxOn) {
      this.composer.render();
    } else {
      // No post FX active — render direct, skipping 3 fullscreen passes entirely
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera);
    }
    // Overlay the viewmodel as a clean second pass (depth-relative, clip-safe)
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  // ==================== EXTERNAL API ====================
  start() {
    audio.ensure();
    voice.unlock();
    this.started = true;
    this.missionRuntime.start();
  }

  /** Live-apply graphics/gameplay settings (safe to call any time, including mid-match) */
  applySettings(s: GameSettings) {
    this.mouseSens = s.sensitivity * 0.001;
    this.adsSensMul = s.adsSensitivity;
    this.invertY = s.invertY;
    this.adsToggle = s.adsToggle;
    this.fovSetting = s.fov;
    voice.setEnabled(s.voices);
    audio.setMasterVolume(s.masterVolume / 100);

    // Resolution scale (biggest perf lever) — adaptive scaler works down from here.
    // NOTE: must go through syncPixelRatio so the composer (post-FX) follows too —
    // otherwise this slider only resized the canvas buffer while the whole
    // post-processed scene kept rendering at the stale cached resolution.
    const cap = s.resolutionScale / 100;
    this.userPR = cap * 2;
    this.dynPR = this.userPR;
    this.goodStreak = 0;
    this.syncPixelRatio();

    // Shadows
    const shadowSize = s.shadowQuality === 'off' ? 0 : s.shadowQuality === 'low' ? 1024 : s.shadowQuality === 'medium' ? 2048 : 4096;
    this.renderer.shadowMap.enabled = shadowSize > 0;
    if (this.sunLight) {
      this.sunLight.castShadow = shadowSize > 0;
      if (shadowSize > 0 && this.sunLight.shadow.mapSize.width !== shadowSize) {
        this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    }
    this.renderer.shadowMap.needsUpdate = true;

    // Post FX
    this.bloom.enabled = s.bloom;
    this.bloom.strength = s.bloomStrength / 100;
    this.vignettePass.uniforms.uVignette.value = s.vignette / 100;
    this.vignettePass.uniforms.uGrain.value = s.filmGrain / 100 * 0.06;
    this.vignettePass.enabled = s.vignette > 0 || s.filmGrain > 0;
    this.postFxOn = s.bloom || s.vignette > 0 || s.filmGrain > 0;
    this.renderer.toneMappingExposure = s.brightness / 100;
    this.motionBlurAmount = s.cameraShake / 100;
  }

  motionBlurAmount = 1;
  private frameNo = 0;
  private postFxOn = true;
  // Adaptive resolution: holds FPS by scaling render resolution within the user's cap
  private userPR = 1;
  private dynPR = 1;
  private lastAdaptT = 0;
  private goodStreak = 0;

  private adaptResolution(t: number) {
    if (t - this.lastAdaptT < 2500) return;
    this.lastAdaptT = t;
    if (this.fps < 45 && this.dynPR > 0.6) {
      this.dynPR = Math.max(0.6, this.dynPR * 0.88);
      this.syncPixelRatio();
      this.goodStreak = 0;
    } else if (this.fps > 57 && this.dynPR < this.userPR) {
      if (++this.goodStreak >= 2) {
        this.goodStreak = 0;
        this.dynPR = Math.min(this.userPR, this.dynPR * 1.12);
        this.syncPixelRatio();
      }
    } else {
      this.goodStreak = 0;
    }
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      this.keys.clear();
      this.triggerHeld = false;
      this.rmb = false;
      // Freeze every sound source while paused (wind bed, queued TTS), but never the
      // tail of the end-of-match line — the results flow manages its own timing.
      if (!this.ended) { audio.suspend(); voice.suspend(); }
    } else {
      audio.resume();
      voice.resume();
      this.lastT = performance.now();
    }
  }

  hud(): HudState {
    const H = this.world.half;
    // Proximity indicator: closest living hostile — screen-relative bearing + range
    let nearest: HudState['nearest'];
    let nd = Infinity;
    for (const e of this.ai.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d < nd) { nd = d; nearest = { angle: this.dirToScreenDeg(e.pos), dist: d, above: e.pos.y - this.pos.y }; }
    }
    return {
      hp: Math.round(this.hp),
      mag: this.mags[this.cur],
      weapon: this.def().name,
      reloading: this.reloadT >= 0,
      reloadStage: this.currentReloadStage,
      frags: this.frags,
      flashes: this.flashes,
      bearing: ((-this.yaw * 180 / Math.PI) % 360 + 360) % 360,
      kills: this.kills,
      score: this.score,
      enemiesLeft: this.ai.aliveCount(),
      cooking: this.cooking,
      sprinting: this.sprinting,
      ads: this.ads,
      spread: this.spreadNow,
      pings: this.pings.map(p => ({ dir: p.dir, age: p.age })),
      grenadeDist: this.lastGrenadeDist,
      grenadeAngle: this.lastGrenadeAngle,
      // Accurate map data (consumed by the HUD tactical radar)
      mapImage: this.mapImage,
      playerMap: { nx: (this.pos.x + H) / (2 * H), nz: (this.pos.z + H) / (2 * H) },
      enemiesMap: this.ai.enemies
        .filter(e => !e.dead)
        .map(e => ({ nx: (e.pos.x + H) / (2 * H), nz: (e.pos.z + H) / (2 * H) })),
      missionMap: (() => {
        const phase = this.missionRuntime.mission.current;
        if (!phase) return undefined;
        return {
          nx: (phase.at[0] + H) / (2 * H), nz: (phase.at[2] + H) / (2 * H),
          ringPct: (phase.radius / (2 * H)) * 100,
          extract: phase.type === 'extract',
        };
      })(),
      nearest,
      fps: Math.round(this.fps),
      magSize: this.def().magSize,
      worldHalf: this.world.half,
      canVault: !!this.nearestWindow(),
      mission: this.missionRuntime.hud(((-this.yaw * 180 / Math.PI) % 360 + 360) % 360),
    };
  }

  dispose() {
    this.disposed = true;
    this.pendingResult = null;
    // Leaving a mission must not leave wind or queued radio lines playing behind the menu.
    voice.cancel();
    audio.suspend();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousedown', this.onMouseDown2);
    window.removeEventListener('mouseup', this.onMouseUp2);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('resize', this.resize);
    this.missionRuntime.dispose();
    this.ai.dispose();
    this.composer.dispose();
    this.bloom.dispose();
    this.vignettePass.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    for (const scene of [this.scene, this.vmScene]) scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) geometries.add(object.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    this.renderer.dispose();
  }
}
