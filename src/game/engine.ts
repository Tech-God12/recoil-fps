import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
// Recoil FPS — Core Engine V2.0
// Controllable recoil, full spatial audio listener, lean Q/E, slide, jump, sprint delays
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { buildWorld, pointInAABB, type World, type MapId, type AABB } from './world';
import { applySkin, buildM4, buildAK47, buildM1911, buildAWM, buildMP7, WEAPON_BUILDERS, type WeaponModel } from './models';
import { applyBuild } from './attachments';
import { attachmentById, weaponById, type WeaponId } from './economy/catalog';
import { resolveWeaponStats, type ScopeReticle } from './economy/stats';
import { REWARDS, difficultyMultiplier, streakAward } from './economy/rewards';
import { skinById } from './economy/skins';
import { sanitizeBuild, type Loadout, type WeaponBuild } from './economy/loadout';
import { clampScopePower, magnificationFov } from './economy/optics';
import { recoilImpulse, recoilRecovery } from './recoil';
import { Effects } from './effects';
import { audio } from './audio';
import { voice } from './voice';
import { AIManager, NavGrid, DIFFICULTIES, type AIContext, type Enemy } from './ai';
import { MissionRuntime, type MissionHud } from './systems/mission-runtime';
import type { MissionReport, MissionPhase } from './systems/mission';
import type { PressureStats } from './systems/reinforcements';
import {
  TDMManager, TDM_BASE_HP, TDM_HP_PER_ARMOR, TDM_DAMAGE_MUL, TDM_MATCH_SECONDS, TDM_RESPAWN_SECONDS,
  TDM_HEAD_REDUCTION, TDM_BODY_REDUCTION, TDM_ARMOR_ICONS,
  type TDMArmor, type TDMBot, type TDMContext, type TDMTeam,
} from './tdm';

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
  adaptiveResolution: boolean;
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
  adaptiveResolution: true,
  resolutionScale: 100,
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
  cash: number;
  secondaryWeapon: string;
  heldSlot: 'primary' | 'secondary';
  bipodDeployed: boolean;
  reticle: ScopeReticle;
  /** Effective FOV; optic identity is explicit and does not change with the zoom slider. */
  zoomFov: number;
  scopePower: number; scopeMinPower: number; scopeMaxPower: number; scopeAdjusting: boolean; canted: boolean;
  lpvoHigh: boolean;
  pumping: boolean;
  pings: { dir: number; age: number }[];
  grenadeDist?: number;
  grenadeAngle?: number;
  // Accurate tactical map (rendered from real world geometry)
  mapImage: string;
  playerMap: { nx: number; nz: number };
  enemiesMap: { nx: number; nz: number; yaw: number; hot: boolean }[];
  missionMap?: { nx: number; nz: number; ringPct: number; extract: boolean };
  fps: number;
  magSize: number;
  masterkey?: { shells: number; reloading: boolean };
  worldHalf: number;
  nearest?: { angle: number; dist: number; above: number };
  mission?: MissionHud;
  tdm?: TdmHud;
}

/** Warehouse TDM scoreboard payload — present only when the arena map is running. */
export interface TdmHud {
  alphaScore: number;
  bravoScore: number;
  timeLeft: number;
  playerKills: number;
  playerDead: boolean;
  respawnIn: number;
  maxHp: number;
  roster: TdmRosterEntry[];
}
export interface TdmRosterEntry {
  name: string;
  team: TDMTeam;
  dead: boolean;
  armorIcon: string;
  you?: boolean;
  kills: number;
  deaths: number;
  headshots: number;
}

export type GameEvent =
  | { type: 'graphics'; text: string }
  | { type: 'hit'; kill: boolean }
  | { type: 'kill'; name: string; weapon: string; headshot: boolean }
  | { type: 'damage'; dir: number; amount: number }
  | { type: 'flash'; power: number }
  | { type: 'callout'; text: string }
  | { type: 'streak'; label: string }
  | { type: 'objective'; phase: MissionPhase; index: number }
  | { type: 'cash'; amount: number; reason: string; total: number }
  | { type: 'tdmfeed'; killer: string; weapon: string; victim: string; headshot: boolean; killerTeam: TDMTeam; zone?: string }
  | { type: 'end'; win: boolean; kills: number; score: number; shots: number; hits: number; headshots: number; timeSec: number; mission: MissionReport; pressure: PressureStats; cash: number; cashLog: CashLogEntry[]; difficultyMul: number; tdm?: { alphaScore: number; bravoScore: number; playerKills: number; roster: TdmRosterEntry[] } };

export interface CashLogEntry { reason: string; amount: number; t: number }

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
  // Loadout-driven extras (optional so legacy stock defs keep compiling)
  falloffStart?: number;
  falloffMul?: number;
  adsTime?: number;
  recoilMul?: number;
  recoilBase?: number;
  scopePower?: number; scopeMinPower?: number; scopeMaxPower?: number;
  canted?: boolean;
  pellets?: number; bloomSpec?: { perShot: number; max: number; decay: number }; bloomNow?: number;
  noiseRadius?: number;
  swapTime?: number;
  spreadX?: number;
  spreadY?: number;
  flashMul?: number;
  swayMul?: number;
  swayMulCrouched?: number;
  recoilYawMul?: number;
  moveSpeedMul?: number;
  suppressed?: boolean;
  boltAction?: boolean;
  reticle?: ScopeReticle;
  lpvo?: boolean;
  lpvoHigh?: boolean;
  pumpShotgun?: boolean;
  audioTag?: 'm4' | 'ak' | 'pistol' | 'sniper' | 'smg' | 'shotgun' | 'scar' | 'vector' | 'lmg' | 'deagle';
  laser?: boolean;
  flashlight?: boolean;
  masterkey?: boolean;
}

interface Grenade {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  kind: 'frag' | 'flash';
  fromAI: boolean;
  /** TDM: which bot lobbed it (credits kills to the right team). */
  owner?: TDMBot;
}

const V = () => new THREE.Vector3();

/**
 * Two animation frames, not one: the first runs before the browser has painted, so a
 * single rAF does not guarantee the boot screen is actually on screen. Used to break
 * the staged mission build into chunks the main thread can breathe between.
 */
function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Hostiles cannot acquire the player during the opening seconds of a mission, so a
 * deployment is never met by squads that are already firing. Broken immediately if the
 * player shoots first — you do not get to fire into a crowd and still be "unseen".
 */
const OPENING_GRACE = 8;
/** Capsule heights used for AI movement. The crouch height is what lets a squad duck
 *  under a bridge deck instead of jamming on its underside. */
const AI_STAND_HEIGHT = 1.7;
const AI_CROUCH_HEIGHT = 1.15;

/**
 * Adaptive resolution. The scale is a discrete fraction of the user's cap so the
 * controller settles on a value instead of hunting: every change reallocates the
 * drawing buffer *and* every post-FX render target, which is a hard stall on the main
 * thread. The previous continuous 0.88/1.12 multipliers produced a fresh stall every
 * few seconds, and because the FPS reading that triggered the next change still
 * contained the cost of the last one, it could only ever ratchet downwards.
 */
const ADAPT_STEPS = [1, 0.85, 0.72, 0.6];
const ADAPT_DOWN_FPS = 45;
const ADAPT_UP_FPS = 57;
const ADAPT_EVAL_MS = 5000;
const ADAPT_LOCK_MS = 8000;
const ADAPT_DOWN_WINDOWS = 2;
const ADAPT_UP_WINDOWS = 3;
/** A frame longer than this is a hitch, not sustained throughput; it must not drive scaling. */
const ADAPT_STALL_SECONDS = 0.25;
// Maps armory weapon ids to the engine's legacy audio tags for loadout-built guns.
const LOADOUT_AUDIO: Record<WeaponId, NonNullable<WeaponDef['audioTag']>> = {
  m4a1: 'm4', ak47: 'ak', scar_h: 'scar', m249: 'lmg', vector: 'vector', mp7: 'smg',
  spas12: 'shotgun', awm: 'sniper', m1911: 'pistol', deagle: 'deagle',
};

export class Engine {
  // Assigned in init(), which Engine.create() awaits before handing the instance out.
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private vmScene = new THREE.Scene();
  private reflectionMap?: THREE.WebGLRenderTarget;
  private vmCamera!: THREE.PerspectiveCamera;
  private world!: World;
  private effects!: Effects;
  private ai!: AIManager;
  private missionRuntime!: MissionRuntime;
  // ---- Warehouse 5v5 TDM (arena map only) ----
  private isTDM = false;
  private tdm: TDMManager | null = null;
  private tdmArmor: TDMArmor = 1;
  private tdmPlayerDead = false;
  private tdmRespawnT = 0;
  private tdmPlayerKills = 0;
  private tdmPlayerDeaths = 0;
  private tdmRosterVersion = -1;
  private rosterVersion = -1;
  private started = false;
  private finishDelay = -1;
  private pendingResult: Extract<GameEvent, { type: 'end' }> | null = null;
  private onEvent!: (e: GameEvent) => void;
  // Part A polish timers
  private ambientT = 12 + Math.random()*8;
  private polishTime = 0;
  // Part B wounded (downed 4s crawl 1m/s no shoot, HUD bleedout 10s, execution/revive)
  private playerDowned = false;
  private downedTime = 0;
  private bleedout = 10;
  private execHold = 0;
  private reviveHold = 0;
  // Part C On Fire (3 kills/30s →15s +10%dmg +5%spd orange glow +always-hot 🔥, bots PUSH 2x within 50m, +$500 SHUT DOWN, 20s cd)
  private killTimes: number[] = [];
  private onFire = false;
  private onFireTime = 0;
  private onFireCD = 0;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private vignettePass!: ShaderPass;
  private sunLight!: THREE.DirectionalLight;
  private mapImage = '';
  private clouds = new THREE.Group();

  // Player state
  private pos!: THREE.Vector3;
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
  private walkBlend = 0;
  private staticTime = 0;
  private lastPos = V();
  private dead = false;
  /** Set the moment the player fires: ends the opening grace window immediately. */
  private graceBroken = false;
  private vx = 0;
  private vz = 0;
  private stepAcc = 0;
  private spreadNow = 0;
  private lastKillT = -9999;
  private streak = 0;
  private streakPaidMark = 0;
  private streakPaidRun = 0;
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
  scopeAdjusting = false;
  private recoilP = 0;
  private recoilY = 0;
  private shake = 0;
  private eyeH = 1.62;

  // Weapons
  private weapons!: WeaponDef[];
  private cur = 0;
  private lastCur = 1;
  private qDownT = -1;
  private slideKick = 0;
  private laserDot: THREE.Mesh | null = null;
  private laserBeam: THREE.Line | null = null;
  private torch: THREE.SpotLight | null = null;
  private cashEarned = 0;
  private cashLog: CashLogEntry[] = [];
  private runStartT = 0;
  private difficultyId = 'Normal';
  private pumpT = 0;
  private mkAmmo = 3;
  private mkReloadT = -1;
  private mags!: number[];
  private reserves!: number[];
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
  private muzzleFlash!: THREE.Mesh;
  private vmLight!: THREE.PointLight;

  // Grenades
  private frags = 5;
  private flashes = 2;
  private cooking = false;
  private cookT = 0;
  private grenades: Grenade[] = [];
  private arcPreview!: THREE.Points;

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
  private boltCycle = 0;
  private adaptiveEnabled = true;
  private appliedPR = -1;
  private graphicsLost = false;

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Building a mission is several hundred milliseconds of unavoidable work: procedural
   * textures, world geometry, the tactical map image, PMREM reflections, ten soldier
   * models and the first shader compile. It used to run in one synchronous block inside
   * the Deploy click, so the tab froze on a dead-looking menu before the boot screen
   * could even paint. create() stages it across frames and pre-compiles shaders off the
   * blocking path instead.
   */
  static async create(canvas: HTMLCanvasElement, difficulty: string, onEvent: (e: GameEvent) => void, mapId: MapId = 'alrasul', loadout: Loadout | null = null, tdmArmor: TDMArmor = 1): Promise<Engine> {
    const engine = new Engine(canvas);
    await engine.init(difficulty, onEvent, mapId, loadout, tdmArmor);
    return engine;
  }

  private async init(difficulty: string, onEvent: (e: GameEvent) => void, mapId: MapId = 'alrasul', loadout: Loadout | null = null, tdmArmor: TDMArmor = 1) {
    this.onEvent = onEvent;
    this.isTDM = mapId === 'arena';
    this.tdmArmor = tdmArmor;
    if (this.isTDM) {
      this.hp = TDM_BASE_HP + tdmArmor * TDM_HP_PER_ARMOR;
      this.frags = 3; this.flashes = 1;
    }
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    // Cap pixel ratio at 1.25 — the single biggest FPS win on high-DPI screens
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCF (not Soft) — ~2x cheaper
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(this.fovSetting, 1, 0.12, 500);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 5);

    // Per-map colour grading so the two arenas read instantly different:
    // Sandblast = hot amber desert noon; Town = cooler hazy hill morning.
    const desert = mapId === 'alrasul';
    this.scene.background = new THREE.Color(desert ? 0xC3CBD2 : 0xAAB9C4);
    this.scene.fog = desert
      ? new THREE.Fog(0xC6B89C, 130, 430)
      : new THREE.Fog(0xA9B8BE, 95, 340); // closer, bluer haze on the hill town
    // strong sky fill so shadowed faces stay readable
    const hemi = new THREE.HemisphereLight(desert ? 0xCFE0EE : 0xC2D4E2, desert ? 0x8C765A : 0x6E7568, desert ? 0.65 : 0.75);
    this.scene.add(hemi);
    // key sun — desert gets a hard warm noon sun, the town a lower cooler morning key
    const sun = new THREE.DirectionalLight(desert ? 0xFFE4BE : 0xF2E9D8, desert ? 3.0 : 2.5);
    if (desert) sun.position.set(-65, 52, 40);
    else sun.position.set(55, 38, -50);
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
    const fill = new THREE.DirectionalLight(0xAFC6DC, desert ? 0.22 : 0.3);
    fill.position.set(desert ? 55 : -55, 30, desert ? -45 : 45);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(desert ? 0x8A7A60 : 0x707A78, 0.12));

    this.addSkyDome(mapId);

    // Heaviest single stage: procedural texture set plus all world geometry.
    await nextFrame();
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
    await nextFrame();

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
    await nextFrame();
    this.mapImage = this.generateMapImage();
    this.pos = this.world.playerSpawn.clone();
    this.lastPos.copy(this.pos);

    // Viewmodel lighting — PMREM renders a whole environment scene, so give the
    // browser a frame either side of it.
    await nextFrame();
    this.createReflections();
    this.canvas.addEventListener('webglcontextlost',this.onGraphicsLost);
    this.canvas.addEventListener('webglcontextrestored',this.onGraphicsRestored);
    const vmHemi = new THREE.HemisphereLight(0xF0F4FA, 0x8A7450, 1.2);
    this.vmScene.add(vmHemi);
    const vmSun = new THREE.DirectionalLight(0xFFF2D6, 1.7);
    vmSun.position.set(1.5, 2.5, 0.8);
    this.vmScene.add(vmSun);
    this.vmLight = new THREE.PointLight(0xFFC070, 0, 4);
    this.vmScene.add(this.vmLight);

    // Weapons: 1. M416, 2. AK-47, 3. 1911, 4. AWM, 5. MP
    await nextFrame();
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
        name: 'M416',
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
        pattern: weaponById('m4a1')!.base.pattern.map(p=>[...p] as [number,number]),
        adsFov: 56,
        tacReload: 2.1,
        emptyReload: 2.7,
      },
      {
        name: 'AK-47',
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
        pattern: weaponById('ak47')!.base.pattern.map(p=>[...p] as [number,number]),
        adsFov: 58,
        tacReload: 2.4,
        emptyReload: 3.0,
      },
      {
        name: '1911',
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
        pattern: weaponById('m1911')!.base.pattern.map(p=>[...p] as [number,number]),
        adsFov: 64,
        tacReload: 1.5,
        emptyReload: 1.8,
      },
      {
        name: 'AWM',
        model: awm,
        auto: false,
        rpm: 48,
        damage: 78,
        headMul: 3.0,
        limbMul: 1.0,
        magSize: 5,
        reserve: 25,
        hipSpread: 0.045,
        adsSpread: 0.000,
        pattern: weaponById('awm')!.base.pattern.map(p=>[...p] as [number,number]),
        adsFov: 22,
        tacReload: 2.25,
        emptyReload: 2.7,
      },
      {
        name: 'MP',
        model: mp7,
        auto: true,
        rpm: 900,
        damage: 24,
        headMul: 2.2,
        limbMul: 0.8,
        magSize: 40,
        reserve: 200,
        hipSpread: 0.011,
        adsSpread: 0.000,
        pattern: [[0.6,0.15],[0.75,-0.2],[0.85,0.25],[0.9,-0.1]],
        adsFov: 60,
        tacReload: 1.9,
        emptyReload: 2.3,
      },
    ];
    this.weapons.forEach((weapon,index)=>{
      const entry=weaponById((['m4a1','ak47','m1911','awm','mp7'] as WeaponId[])[index])!;
      weapon.pattern=entry.base.pattern.map(p=>[...p] as [number,number]);
      weapon.recoilBase=weapon.recoilMul=entry.base.recoilMul;
      weapon.adsSpread=entry.base.adsSpread;
      if(entry.scoped){weapon.reticle='sniper';weapon.scopePower=weapon.scopeMinPower=weapon.scopeMaxPower=6;}
    });
    this.mags = [30, 30, 8, 5, 40];
    this.reserves = [Infinity, Infinity, Infinity, Infinity, Infinity];
    this.difficultyId = difficulty;
    if (loadout) this.armLoadout(loadout);

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
      groundHeight: this.world.navigationHeight ?? this.world.groundHeight,
      moveCollide: (p, dx, dz, r) => {
        const ox = p.x, oz = p.z;
        this.moveAxis(p, dx, dz, r, AI_STAND_HEIGHT);
        // The bridge decks hang barely 1.6m over the dry riverbed, so a squad walking
        // the sand underneath used to jam on the deck's underside and shuffle in place.
        // If a crouched actor genuinely fits, duck and carry on.
        const want = Math.hypot(dx, dz);
        if (want > 0 && Math.hypot(p.x - ox, p.z - oz) < want * 0.5 && this.headroomAt(p, r) >= AI_CROUCH_HEIGHT) {
          p.x = ox; p.z = oz;
          this.moveAxis(p, dx, dz, r, AI_CROUCH_HEIGHT);
        }
        // Ground-based squads follow the same continuous wadi bed as the player.
        p.y = this.supportHeight(p, r);
      },
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
      canAcquire: () => this.isTDM || this.graceBroken || this.missionRuntime.mission.elapsed >= OPENING_GRACE,
    };

    // Ten pooled soldier models plus the nav grid over the whole sector.
    await nextFrame();
    if (this.isTDM) {
      // ---- Warehouse TDM: no mission runtime, no pressure director. A single
      // TDMManager owns both five-man teams and the match clock. ----
      const tdmCtx: TDMContext = {
        scene: this.scene,
        occluders: this.world.occluders,
        coverNodes: this.world.coverNodes,
        solids: this.world.solids,
        half: this.world.half,
        groundHeight: (x, z) => (this.world.navigationHeight ?? this.world.groundHeight)(x, z),
        effects: this.effects,
        playerPos: () => this.eyePos(),
        playerFeet: () => this.pos.clone(),
        playerAlive: () => !this.dead,
        damagePlayer: (a, f, killer) => this.damagePlayerTDM(a, f, killer),
        moveCollide: ctx.moveCollide,
        onCallout: (k, p, team) => {
          if (team === 'bravo' && p.distanceTo(this.pos) < 42) {
            const labels: Record<string, string> = { grenade: 'Frag out!', push: 'They are pushing!', flank: 'Hostiles flanking!', fallback: 'They are falling back!' };
            this.onEvent({ type: 'callout', text: labels[k] ?? 'Contact!' });
            voice.enemyCallout(k);
          }
        },
        throwGrenade: (from, target, owner) => this.spawnGrenade(from, target, true, 'frag', owner),
        onBotFire: (p, team) => {
          audio.enemyFireSpatial(p.x, p.y, p.z);
          if (team === 'bravo') this.addPing(p);
        },
        onFeed: (killer, weapon, victim, headshot, killerTeam) => {
          let zone: string | undefined;
          let vx:number|undefined, vz:number|undefined;
          if (victim === 'YOU') { vx=this.pos.x; vz=this.pos.z; }
          else { const b=this.tdm?.bots.find(b=>b.name===victim); if(b){vx=b.pos.x; vz=b.pos.z;} }
          if (vx!==undefined && vz!==undefined && this.world?.zones) {
            for(const zz of this.world.zones){ if(vx>=zz.minX&&vx<=zz.maxX&&vz>=zz.minZ&&vz<=zz.maxZ){ zone=zz.name; break; } }
          }
          this.onEvent({ type: 'tdmfeed', killer, weapon, victim, headshot, killerTeam, zone } as any);
        },
        onScore: () => { /* scoreboard reads live values from hud() */ },
      };
      this.tdm = new TDMManager(tdmCtx, tdmArmor);
      this.ai = new AIManager(ctx, []); // empty roster: keeps every mission-path callsite alive
      this.pos.copy(this.tdm.getSpawn('alpha'));
      this.yaw = Math.atan2(this.pos.x - 0, this.pos.z - 0);
      this.buildSolidGrid();
      this.renderer.shadowMap.needsUpdate = true;
      this.rebuildHittables();
    } else {
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
      scoreBonus: pts => { this.score += pts; this.earnCash(REWARDS.phase, 'phase'); },
      detonate: at => {
        // Use the existing blast resolution for damage, glass, particles and spatial audio.
        this.explode({ mesh: this.missionRuntime.markers.cache, pos: at, vel: new THREE.Vector3(), fuse: 0, kind: 'frag', fromAI: false });
        // World event has toggled preallocated bounds. Refresh all derived caches
        // once, preserving the NavGrid object referenced by pooled enemies.
        this.buildSolidGrid();
        this.ai.nav.blocked.set(new NavGrid(this.world.solids, this.world.half, this.world.navigationHeight ?? this.world.groundHeight).blocked);
        this.renderer.shadowMap.needsUpdate = true;
        this.ai.invalidatePaths();
        this.mapImage = this.generateMapImage();
        this.rebuildHittables();
      },
      finish: win => this.endMatch(win),
    }, mapId);
    this.buildSolidGrid();
    this.ai.nav.blocked.set(new NavGrid(this.world.solids, this.world.half, this.world.navigationHeight ?? this.world.groundHeight).blocked);
        this.renderer.shadowMap.needsUpdate = true;
    const first = this.missionRuntime.mission.current.at;
    this.yaw = Math.atan2(this.pos.x - first[0], this.pos.z - first[2]);
    this.rebuildHittables();
    }

    this.bindInput();
    this.resize();
    this.composeCamera(1 / 60);
    this.animateViewmodel(1 / 60);
    this.camera.updateMatrixWorld(true);
    // Pre-compile every shader variant off the blocking path. The single synchronous
    // render() this replaces linked dozens of programs inside the deploy click, and
    // program linking was the largest slice of the spawn freeze.
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.renderer.compileAsync(this.vmScene, this.vmCamera);
    await nextFrame();
    this.render();
    window.addEventListener('resize', this.resize);
    this.lastT = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ==================== INPUT HANDLING ====================
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || this.paused || this.dead || this.ended || !this.started || document.pointerLockElement !== this.canvas) return;
    if (this.scopeAdjusting) return;
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyX') e.preventDefault();

    if (e.code === 'KeyR') this.startReload();
    if (e.code === 'Digit1') this.switchWeapon(0);
    if (e.code === 'Digit2') this.switchWeapon(1);
    if (e.code === 'Digit3') this.switchWeapon(2);
    if (e.code === 'Digit4') this.switchWeapon(3);
    if (e.code === 'Digit5') this.switchWeapon(4);
    if (e.code === 'KeyQ' && !e.repeat) this.qDownT = performance.now();
    if (e.code === 'KeyB') this.fireMasterkey();
    if (e.code === 'KeyV' && this.variableScope() && this.ads > .65) { this.beginScopeAdjustment(); return; }
    if (e.code === 'KeyV' && this.def().lpvo) this.def().lpvoHigh = !this.def().lpvoHigh;
    if (this.ads > .65 && (e.code === 'BracketLeft' || e.code === 'BracketRight')) this.setScopePower((this.def().scopePower ?? 6) + (e.code === 'BracketRight' ? .2 : -.2));

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
    // Q is dual-purpose: tap = quick-swap to last weapon, hold = lean left.
    if (e.code === 'KeyQ' && this.qDownT >= 0 && !this.paused && !this.dead && !this.ended) {
      if (performance.now() - this.qDownT < 220 && Math.abs(this.lean) < 0.15) this.switchWeapon(this.lastCur);
      this.qDownT = -1;
    }
    // Never let a frag loose on a key release that arrives while paused, dead or
    // between missions (ESC mid-cook used to throw into the pause menu).
    if (e.code === 'KeyG' && this.cooking && !this.paused && !this.dead && !this.ended
      && document.pointerLockElement === this.canvas) this.throwFrag();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas || this.paused || this.dead || this.scopeAdjusting) return;
    const zoomSensitivity = Math.tan(this.adsFovEff()*Math.PI/360)/Math.tan(this.fovSetting*Math.PI/360);
    const sens = this.mouseSens * (this.ads > 0.5 ? this.adsSensMul * Math.max(.12,zoomSensitivity) : 1);
    this.yaw -= e.movementX * sens;
    this.pitch -= (this.invertY ? -e.movementY : e.movementY) * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  };

  private onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas || this.paused || this.dead || this.scopeAdjusting) return;
    if (e.button === 0) {
      this.triggerHeld = true;
      this.tryFire();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.triggerHeld = false;
  };

  private onMouseDown2 = (e: MouseEvent) => {
    if (e.button === 2 && !this.scopeAdjusting && !this.paused && !this.dead && !this.ended && document.pointerLockElement === this.canvas) {
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
    if (e.button === 2 && !this.adsToggle && !this.scopeAdjusting) this.rmb = false;
  };

  private onScopeWheel = (e: WheelEvent) => {
    if (document.pointerLockElement !== this.canvas || this.paused || this.dead || this.ended || this.ads < .65 || !this.variableScope() || this.cantedActive()) return;
    e.preventDefault();
    this.setScopePower((this.def().scopePower ?? 6) - Math.sign(e.deltaY) * .2);
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
    window.addEventListener('wheel', this.onScopeWheel, { passive:false });
  }

  async requestLock() {
    if (!this.canvas.requestPointerLock) throw new Error('Mouse capture is unavailable in this browser.');
    await this.canvas.requestPointerLock();
  }

  private createReflections() {
    this.reflectionMap?.dispose();
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.reflectionMap = pmrem.fromScene(environment,0.04);
    this.vmScene.environment = this.reflectionMap.texture;
    this.vmScene.environmentIntensity = 0.65;
    this.scene.environment = this.reflectionMap.texture;
    this.scene.environmentIntensity = 0.25;
    environment.dispose(); pmrem.dispose();
  }

  private onGraphicsLost = (event: Event) => {
    event.preventDefault(); this.graphicsLost=true; this.setPaused(true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onEvent({type:'graphics',text:'Graphics connection interrupted. Your mission is paused while the browser restores it.'});
  };
  private onGraphicsRestored = () => {
    if (this.disposed) return;
    this.graphicsLost=false; this.appliedPR=-1;
    // Re-uploaded GPU state is expensive for a while: resume one ladder step down,
    // staying on the ladder so the scaler can climb back without hunting.
    this.adaptStep = Math.max(this.adaptStep, 1);
    this.dynPR = this.userPR * ADAPT_STEPS[this.adaptStep];
    this.adaptLow = 0; this.adaptHigh = 0; this.adaptLockUntil = 0; this.adaptSamples.length = 0;
    this.syncPixelRatio(); this.createReflections(); this.renderer.shadowMap.needsUpdate=true;
    this.onEvent({type:'graphics',text:'Graphics restored. Your mission is preserved; select Resume to continue.'});
  };

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
    const pr = Math.min(window.devicePixelRatio || 1, this.dynPR);
    if (Math.abs(pr-this.appliedPR)<0.015) return;
    this.appliedPR=pr;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
  }

  /** Gradient sky dome + sun glow + drifting clouds (cheap, huge visual payoff) */
  private addSkyDome(mapId: MapId) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    if (mapId === 'kasbah') {
      // Cool hazy hill-town morning: blue-grey dome, pale horizon, no amber base.
      grad.addColorStop(0, '#3E668F');
      grad.addColorStop(0.4, '#87A6BC');
      grad.addColorStop(0.58, '#B7C5CC');
      grad.addColorStop(0.72, '#D3D6CE');
      grad.addColorStop(0.85, '#DFD9C6');
      grad.addColorStop(1, '#D8CCB4');
    } else {
      // Hot desert noon: deep zenith blue burning into an amber horizon.
      grad.addColorStop(0, '#4A78A6');
      grad.addColorStop(0.4, '#93B6C8');
      grad.addColorStop(0.58, '#D8C7A0');
      grad.addColorStop(0.72, '#F0D6A2');
      grad.addColorStop(0.85, '#F6C888');
      grad.addColorStop(1, '#EAB878');
    }
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
    if (mapId === 'kasbah') { sunSpr.position.set(200, 150, -180); sunSpr.scale.setScalar(84); } // lower, paler morning sun
    else { sunSpr.position.set(-220, 200, 150); sunSpr.scale.setScalar(110); }
    this.scene.add(sunSpr);
    this.scene.add(this.clouds);
    // A few flat drifting clouds
    const [cc, cctx] = this.makeCanvas(256, 128);
    for (let i = 0; i < 8; i++) {
      const x = 35 + i * 25, y = 65 + Math.sin(i * 1.9) * 13, r = 24 + (i % 3) * 6;
      const gradient = cctx.createRadialGradient(x,y,3,x,y,r);
      gradient.addColorStop(0,'rgba(255,251,238,.5)');
      gradient.addColorStop(.55,'rgba(245,237,216,.3)');
      gradient.addColorStop(1,'rgba(245,237,216,0)');
      cctx.fillStyle = gradient; cctx.fillRect(x-r,y-r,r*2,r*2);
    }
    const cloudTexture = new THREE.CanvasTexture(cc);
    cloudTexture.colorSpace = THREE.SRGBColorSpace;
    const cloudMat = new THREE.SpriteMaterial({ map:cloudTexture, color:0xffffff, transparent:true, opacity:0.7, fog:false, depthWrite:false });
    for (let i = 0; i < 7; i++) {
      const cl = new THREE.Sprite(cloudMat);
      const a = i * 2.39996;
      cl.position.set(Math.cos(a)*230,100+(i%3)*16,Math.sin(a)*230);
      cl.scale.set(110+(i%3)*20,45,1);
      this.clouds.add(cl);
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
    for (const b of blockers) {
      ctx.fillRect(Math.floor(px(b.minX)/STEP)*STEP,Math.floor(pz(b.minZ)/STEP)*STEP,
        Math.ceil((b.maxX-b.minX)*scale/STEP)*STEP,Math.ceil((b.maxZ-b.minZ)*scale/STEP)*STEP);
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

    // Wood crossings and sunken channel use their actual support elevation.
    for (const b of this.world.wood) {
      if (b.minY > 9000) continue;
      ctx.fillStyle = '#998060';
      ctx.fillRect(px(b.minX), pz(b.minZ), (b.maxX-b.minX)*scale, (b.maxZ-b.minZ)*scale);
    }
    for (let z = 0; z < S; z += 3) for (let x = 0; x < S; x += 3) {
      const height = this.world.groundHeight(x / scale - span/2, z / scale - span/2);
      if (height < -0.5) { ctx.fillStyle = height < -2 ? '#675e4a' : '#928268'; ctx.fillRect(x,z,3,3); }
    }
    // --- faint survey grid ---
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= S; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
    }

    // --- building & cover footprints, low → tall so heights stack correctly ---
    const sorted = this.world.solids.filter(b => b.minY < 1.75 && b.maxY > 0.34).sort((a, b) => a.maxY - b.maxY);
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
        if (b.maxY <= p.y + 0.55) continue;                 // Steppable curb/stair
        if (b.minY >= p.y + height) continue;
        if (nx + radius > b.minX && nx - radius < b.maxX && nz + radius > b.minZ && nz - radius < b.maxZ) return false;
      }
      return true;
    };
    const steps = Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dz))/Math.max(0.08,radius*0.5)));
    for (let step=0;step<steps;step++) {
      if (tryMove(p.x + dx/steps,p.z)) p.x += dx/steps;
      if (tryMove(p.x,p.z + dz/steps)) p.z += dz/steps;
    }
    const lim = this.world.half - 2.5;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
  }

  private supportHeight(p: THREE.Vector3, radius: number): number {
    let s = this.world.groundHeight(p.x, p.z);
    for (const b of this.world.solids) {
      if (b.maxY > p.y + 0.55) continue;
      if (p.x + radius > b.minX && p.x - radius < b.maxX && p.z + radius > b.minZ && p.z - radius < b.maxZ) {
        if (b.maxY > s) s = b.maxY;
      }
    }
    return s;
  }

  /**
   * Vertical clearance between the actor's feet and the first obstruction overhead,
   * capped at a standing capsule. Used to decide whether an AI can duck under a low
   * bridge deck rather than grinding into it.
   */
  private headroomAt(p: THREE.Vector3, radius: number): number {
    const near = this.nearSolids(p.x, p.z, radius + 0.1);
    let top = AI_STAND_HEIGHT;
    for (let i = 0; i < near.length; i++) {
      const b = near[i];
      if (b.maxY <= p.y + 0.55) continue;                       // underfoot / steppable
      if (p.x + radius <= b.minX || p.x - radius >= b.maxX) continue;
      if (p.z + radius <= b.minZ || p.z - radius >= b.maxZ) continue;
      const gap = b.minY - p.y;
      if (gap < top) top = gap;
    }
    return top;
  }

  private surfaceAt(): 'sand' | 'concrete' | 'wood' {
    for (const b of this.world.wood) if (pointInAABB(this.pos.x, this.pos.y + 0.5, this.pos.z, b)) return 'wood';
    for (const b of this.world.interiors) if (pointInAABB(this.pos.x, this.pos.y + 0.5, this.pos.z, b)) return 'concrete';
    for (const b of this.world.concrete) if (pointInAABB(this.pos.x, this.pos.y + 0.5, this.pos.z, b)) return 'concrete';
    return 'sand';
  }

  private def() { return this.weapons[this.cur]; }

  private switchWeapon(i: number) {
    if (this.scopeAdjusting || i === this.cur || this.switchT >= 0 || this.reloadT >= 0 || i >= this.weapons.length || i < 0) return;
    this.switchT = 0;
    this.cooking = false;
    const from = this.cur;
    const ms = Math.round((this.def().swapTime ?? 0.13) * 1000);
    setTimeout(() => {
      if (this.disposed || this.ended) return;
      this.weapons[from].model.group.visible = false;
      this.lastCur = from;
      this.cur = i;
      this.shotIdx = 0; this.shotResetT = 0;
      this.weapons[i].model.group.visible = true;
    }, ms);
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
    if (d.pumpShotgun) {
      // Shell-by-shell loading clicks across the reload.
      for (const ms of [420, 700, 980, 1260]) {
        setTimeout(() => { if (!this.disposed && !this.ended && this.reloadT >= 0) audio.shellInsert(); }, ms);
      }
    }

    const stages: { t: number; stage: HudState['reloadStage']; fn: () => void }[] = [
      {
        t: 0.28, stage: 'magOut', fn: () => {
          this.currentReloadStage = 'magOut';
          if (d.audioTag === 'lmg') audio.beltCoverOpen(); else audio.magOut();
        },
      },
      {
        t: this.reloadDur * 0.55, stage: 'magIn', fn: () => {
          this.currentReloadStage = 'magIn';
          if (d.audioTag === 'lmg') audio.beltCoverClose();
          else if (d.pumpShotgun) audio.shellInsert();
          else audio.magIn();
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

  // ==================== AIMED BALLISTICS / RECOIL ====================
  private tryFire() {
    if (this.paused || this.dead || this.ended || !this.started || this.scopeAdjusting) return;
    if (this.fireCD > 0 || this.reloadT >= 0 || this.switchT >= 0 || this.cooking) return;
    if (this.sprinting || this.sprintToFireDelay > 0) return; // Cannot fire during sprint
    if (this.sliding) return; // Cannot fire during slide
    // Firing ends the opening grace window — hostiles are allowed to see you now.
    this.graceBroken = true;

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
    if (d.boltAction ?? this.cur === 3) { this.boltCycle = 1.25; this.rmb = false; }
    this.shotResetT = 0.28;
    if (d.pumpShotgun) {
      this.pumpT = 0.5;
      setTimeout(() => { if (!this.disposed && !this.ended) audio.pump(); }, 200);
    }
    if (d.audioTag === 'pistol' || d.audioTag === 'deagle' || d.audioTag === 'scar') this.slideKick = 1;

    // 1. CALCULATE EXACT BULLET TRAJECTORY FIRST BEFORE RECOIL
    // Small calibrated dispersion in ADS; recoil moves the camera/aim between shots.
    const isAds = this.ads > 0.65;
    let spread = THREE.MathUtils.lerp(d.hipSpread, d.adsSpread, this.ads) + (d.bloomNow ?? 0) * (isAds ? .45 : 1);
    if (this.bipodDeployed()) spread *= .72;
    if (!isAds) {
      if (this.inputMoving()) spread *= 1.2;
      if (this.crouched) spread *= 0.7;
    }
    this.spreadNow = spread;

    const aimDirection = this.camera.getWorldDirection(new THREE.Vector3());
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0);
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
    const origin = this._t2.copy(this.camera.position), dir = this._t1;
    let shotHit = false;
    for (let pellet=0;pellet<(d.pellets ?? 1);pellet++) {
    // Bullet = exact screen-center ray. Origin MUST be the real camera position
    // (includes lean offset, bob, shake) — using feet+eyeH here was offsetting
    // every shot sideways whenever leaning or moving.
    dir.copy(aimDirection);
    if (spread > 0) {
      const angle = Math.random()*Math.PI*2, radius = Math.sqrt(Math.random()) * spread;
      dir.addScaledVector(cameraRight, Math.cos(angle)*radius*(d.spreadX??1));
      dir.addScaledVector(cameraUp, Math.sin(angle)*radius*(d.spreadY??1));
      dir.normalize();
    }

    // When leaning, skip nearby world geometry so peeking around a corner works.
    // Recomputed from the LIVE smoothed lean every shot — never stale.
    const skip = 0.55 + Math.abs(this.lean) * 0.95;
    this.raycaster.set(origin, dir);
    this.raycaster.far = 300;
    const rawHits = this.raycaster.intersectObjects(this.hittables, false);
    // Ignore world geometry inside the skip bubble (leaning against a wall must
    // never eat your own bullet) — but never ignore an enemy, even point-blank.
    let h: THREE.Intersection | null = null;
    for (const cand of rawHits) {
      const isEnemy = cand.object.userData.enemy !== undefined || cand.object.userData.tdmBot !== undefined;
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
      h = rawHits.find(x => x !== h && !(x.object.userData.glass) && (x.distance >= skip || x.object.userData.enemy || x.object.userData.tdmBot)) ?? null;
    }

    if (h) {
      if (!d.suppressed) this.effects.tracer(muzzleWorld, h.point);
      const tdmBot = (h.object.userData.tdmBot as TDMBot | undefined);
      if (tdmBot && !tdmBot.dead && this.isTDM && this.tdm) {
        const part = h.object.userData.part as string;
        let dmg = d.damage * TDM_DAMAGE_MUL;
        if (part === 'head') dmg *= d.headMul;
        else if (part === 'limb') dmg *= d.limbMul;
        if (h.distance > (d.falloffStart ?? 35)) dmg *= (d.falloffMul ?? 0.85);
        // TTK floor: no weapon may two-tap the 150 HP base pool (3+ headshots always)
        dmg = Math.min(dmg, 74);
        if (!shotHit) { this.hits++; shotHit = true; }
        this.effects.blood(h.point);
        audio.fleshImpact(0);
        if (part === 'head') audio.headshotDink();
        const killed = tdmBot.takeDamage(dmg, part === 'head', 'player');
        if (killed) {
          this.tdmPlayerKills++;
          this.kills++;
          this.score += part === 'head' ? 150 : 100;
          audio.killConfirm();
          if (part === 'head') { this.headshots++; voice.headshot(); }
          this.tdm.handleKill('player', tdmBot, part === 'head', d.name);
          this.onEvent({ type: 'hit', kill: true });
          this.rebuildHittables();
        } else {
          audio.hitMarker();
          this.onEvent({ type: 'hit', kill: false });
        }
        continue;
      }
      const enemy = (h.object.userData.enemy as Enemy | undefined);
      if (enemy && !enemy.dead) {
        const part = h.object.userData.part as string;
        let dmg = d.damage;
        if (part === 'head') dmg *= d.headMul;
        else if (part === 'limb') dmg *= d.limbMul;
        if (h.distance > (d.falloffStart ?? 35)) dmg *= (d.falloffMul ?? 0.85);
        if (!shotHit) { this.hits++; shotHit = true; }
        this.effects.blood(h.point);
        audio.fleshImpact(0);
        // Headshot "dink" rings on EVERY head hit — the reward cue lands even
        // when the target survives (and stacks under the kill confirm when not).
        if (part === 'head') audio.headshotDink();
        const killed = enemy.takeDamage(dmg, part === 'head');
        if (killed) {
          this.kills++;
          // Matches the HUD score popups exactly: 100 per elimination, 150 for a headshot.
          this.score += part === 'head' ? 150 : 100;
          this.earnCash(part === 'head' ? REWARDS.headshot : REWARDS.kill, part === 'head' ? 'headshot' : 'kill');
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
          else { this.streak = 1; this.streakPaidMark = 0; }
          this.lastKillT = now;
          if (this.streak >= 2) {
            const label = this.streak >= 6 ? 'UNSTOPPABLE'
              : this.streak === 5 ? 'PENTA KILL'
                : this.streak === 4 ? 'QUAD KILL'
                  : this.streak === 3 ? 'TRIPLE KILL' : 'DOUBLE KILL';
            voice.streak(label);
            this.onEvent({ type: 'streak', label });
            const sb = streakAward(this.streak, this.streakPaidMark, 500 - this.streakPaidRun);
            if (sb > 0) {
              this.streakPaidMark = this.streak;
              this.streakPaidRun += sb;
              this.earnCash(sb, 'streak');
            }
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

    }
    if (d.bloomSpec) d.bloomNow = Math.min(d.bloomSpec.max,(d.bloomNow??0)+d.bloomSpec.perShot);

    const kick = recoilImpulse({ pattern:d.pattern, shot:this.shotIdx++, recoil:d.recoilMul??1,
      baseRecoil:d.recoilBase??1, horizontal:d.recoilYawMul??1, aiming:isAds,
      crouched:this.crouched, supported:this.bipodDeployed(), random:Math.random() });
    this.pitch = THREE.MathUtils.clamp(this.pitch + kick.aimPitch,-1.45,1.45);
    this.yaw += kick.aimYaw;
    this.recoilP += kick.springPitch;
    this.recoilY += kick.springYaw;
    if (!d.auto && kick.rise > .025) this.shake = Math.min(1,this.shake + kick.rise * 3);
    this.vmKick = 1;
    this.vmKickRot = 1;

    // Audio & Muzzle Flash — each weapon gets its own signature report
    if (d.suppressed) audio.fireSuppressed();
    else {
      const tag = d.audioTag ?? (['m4', 'ak', 'pistol', 'sniper', 'smg'] as const)[this.cur] ?? 'm4';
      if (tag === 'm4') audio.fireM4();
      else if (tag === 'ak') audio.fireAK();
      else if (tag === 'pistol') audio.firePistol();
      else if (tag === 'sniper') audio.fireSniper();
      else if (tag === 'shotgun') audio.fireShotgun();
      else if (tag === 'scar') audio.fireSCAR();
      else if (tag === 'vector') audio.fireVector();
      else if (tag === 'lmg') audio.fireLMG();
      else if (tag === 'deagle') audio.fireDeagle();
      else audio.fireSMG();
    }

    const mf = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    mf.opacity = 1;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleFlash.scale.setScalar((0.85 + Math.random() * 0.5) * (d.suppressed ? 0.45 : 1.6) * (d.flashMul ?? 1));
    this.vmLight.intensity = d.suppressed ? 1.2 : 3.5;
    if (!d.suppressed) this.effects.playerFlash(origin.clone().addScaledVector(dir, 1.0));
    this.ai.notifyGunshot(this.pos, d.noiseRadius ?? 65);
    this.tdm?.notifyGunshot(this.pos, d.noiseRadius ?? 65);
    this.staticTime = 0;
  }

  /** Replace the stock arsenal with the player's armory loadout (primary + sidearm). */
  private armLoadout(loadout: Loadout): void {
    for (const w of this.weapons) this.vmScene.remove(w.model.group);
    this.weapons = [this.buildLoadoutWeapon(loadout.primary), this.buildLoadoutWeapon(loadout.secondary)];
    for (const w of this.weapons) this.vmScene.add(w.model.group);
    this.weapons[1].model.group.visible = false;
    this.mags = this.weapons.map(w => w.magSize);
    this.reserves = this.weapons.map(() => Infinity);
    this.cur = 0;
    this.lastCur = 1;
  }

  private buildLoadoutWeapon(build: WeaponBuild): WeaponDef {
    build = sanitizeBuild(build);
    const id: WeaponId = build.weapon;
    const entry = weaponById(id) ?? weaponById('m4a1')!;
    const mods = Object.values(build.attachments)
      .map(aid => attachmentById(aid)?.mods)
      .filter((m): m is NonNullable<typeof m> => !!m);
    const stats = resolveWeaponStats(entry.base, mods);
    const model = (WEAPON_BUILDERS[id] ?? WEAPON_BUILDERS.m4a1)();
    applyBuild(model, build);
    // Finishes need per-gun materials — clone once, then paint the chosen skin.
    const owned = new Map<THREE.Material, THREE.Material>();
    model.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const m = mesh.material as THREE.Material;
      if (!owned.has(m)) owned.set(m, m.clone());
      mesh.material = owned.get(m)!;
    });
    applySkin(model.group, skinById(build.skin ?? 'factory'));
    return {
      name: entry.name.toUpperCase(),
      model,
      auto: stats.auto, rpm: stats.rpm, damage: stats.damage,
      headMul: stats.headMul, limbMul: stats.limbMul,
      magSize: stats.magSize, reserve: stats.reserve,
      hipSpread: stats.hipSpread, adsSpread: stats.adsSpread,
      pattern: stats.pattern.map(pat => [...pat] as [number, number]),
      adsFov: stats.adsFov, tacReload: stats.tacReload, emptyReload: stats.emptyReload,
      falloffStart: stats.falloffStart, falloffMul: stats.falloffMul,
      adsTime: stats.adsTime, recoilMul: stats.recoilMul, recoilBase:entry.base.recoilMul,
      noiseRadius: stats.noiseRadius, swapTime: stats.swapTime,
      spreadX: stats.spreadXMul, spreadY: stats.spreadYMul, flashMul: stats.flashMul,
      swayMul: stats.swayMul, swayMulCrouched: stats.swayMulCrouched,
      recoilYawMul: stats.recoilYawMul, moveSpeedMul: stats.moveSpeedMul,
      suppressed: stats.suppressed,
      boltAction: id === 'awm', audioTag: LOADOUT_AUDIO[id], masterkey: stats.masterkey,
      reticle: stats.reticle === 'none' && entry.scoped ? 'sniper' : stats.reticle,
      scopePower: stats.reticle === 'none' && entry.scoped ? 6 : stats.scopePower,
      scopeMaxPower: stats.reticle === 'none' && entry.scoped ? 6 : stats.scopePower,
      scopeMinPower: stats.reticle === 'none' && entry.scoped ? 6 : stats.scopeMinPower,
      canted:stats.canted, pellets:entry.pellets, bloomSpec:entry.bloom, bloomNow:0,
      lpvo: stats.lpvo, pumpShotgun: id === 'spas12',
      laser: stats.laser, flashlight: stats.flashlight,
    };
  }

  /** Cash ledger: every paid event flows through here so HUD toasts and the debrief agree. */
  private earnCash(amount: number, reason: string): void {
    this.cashEarned += amount;
    this.cashLog.push({ reason, amount, t: (performance.now() - this.runStartT) / 1000 });
    this.onEvent({ type: 'cash', amount, reason, total: this.cashEarned });
  }

  private cantedActive(): boolean { return !!this.def().canted && this.keys.has('KeyT') && (this.def().scopeMaxPower??1)>1; }
  private variableScope(): boolean { const w=this.def(); return (w.scopeMaxPower??1)>(w.scopeMinPower??1); }

  /** The scope keeps its reticle/identity at every zoom setting. */
  private adsFovEff(): number {
    const w=this.def();
    if (this.cantedActive()) return this.fovSetting;
    if (w.scopePower !== undefined && w.reticle !== 'none') return magnificationFov(this.fovSetting,w.scopePower);
    return w.lpvo && w.lpvoHigh ? w.adsFov*.55 : w.adsFov;
  }
  setScopePower(power: number): void {
    if (this.dead || this.ended || !this.variableScope()) return;
    const w=this.def(); w.scopePower=clampScopePower(power,w.scopeMinPower!,w.scopeMaxPower!);
  }
  beginScopeAdjustment(): void {
    if (!this.variableScope() || this.ads<.65 || this.paused || this.dead || this.ended || this.cantedActive()) return;
    this.scopeAdjusting=true; this.keys.clear(); this.qDownT=-1; this.triggerHeld=false; this.rmb=true;
    if (document.pointerLockElement===this.canvas) document.exitPointerLock();
  }
  cancelScopeAdjustment(): void { this.scopeAdjusting=false; this.triggerHeld=false; this.rmb=false; }
  async finishScopeAdjustment(): Promise<void> {
    if (this.dead || this.ended || this.paused) { this.cancelScopeAdjustment(); return; }
    await this.requestLock();
    if (document.pointerLockElement===this.canvas) { this.scopeAdjusting=false; this.rmb=true; }
  }

  /** Bipod counts as deployed when prone and still with legs fitted (hip or ADS). */
  private bipodDeployed(): boolean {
    return this.crouched && this.grounded && Math.hypot(this.vx, this.vz) < 0.6 && !!this.def().model.attached.underbarrel?.userData.legs;
  }

  /** Masterkey underbarrel shotgun (B): 7-pellet cone with its own 3-shell tube. */
  private fireMasterkey(): void {
    const d = this.def();
    if (!d.masterkey || this.mkReloadT >= 0 || this.reloadT >= 0 || this.switchT >= 0 || this.dead || this.ended) return;
    if (this.mkAmmo <= 0) { audio.dryFire(); return; }
    this.mkAmmo--;
    if (this.mkAmmo <= 0) this.mkReloadT = 0;
    audio.fireShotgun();
    this.shots++;
    const mf = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    mf.opacity = 1;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleFlash.scale.setScalar(1.1);
    this.vmLight.intensity = 3;
    this.pitch += 0.014;
    this.recoilP += 0.02;
    this.vmKick = 1;
    this.vmKickRot = 1;
    const skip = 0.55 + Math.abs(this.lean) * 0.95;
    const origin = this._t2.copy(this.camera.position);
    const base = this._t1;
    this.camera.getWorldDirection(base);
    const me = this.camera.matrix.elements;
    let anyHit = false;
    let anyKill = false;
    for (let i = 0; i < 7; i++) {
      const dir = new THREE.Vector3(
        base.x + (Math.random() - 0.5) * 0.09 * (d.spreadX ?? 1),
        base.y + (Math.random() - 0.5) * 0.09 * (d.spreadY ?? 1),
        base.z + (Math.random() - 0.5) * 0.09,
      ).normalize();
      this.raycaster.set(origin, dir);
      this.raycaster.far = 60;
      const rawHits = this.raycaster.intersectObjects(this.hittables, false);
      let h: THREE.Intersection | null = null;
      for (const cand of rawHits) {
        const isEnemy = cand.object.userData.enemy !== undefined || cand.object.userData.tdmBot !== undefined;
        if (!isEnemy && cand.distance < skip) continue;
        h = cand;
        break;
      }
      const mw = this._t3.copy(origin).addScaledVector(dir, 0.55);
      mw.x += me[0] * 0.09 + me[4] * -0.07;
      mw.y += me[1] * 0.09 + me[5] * -0.07;
      mw.z += me[2] * 0.09 + me[6] * -0.07;
      if (!h) {
        this.effects.tracer(mw, origin.clone().addScaledVector(dir, 40));
        continue;
      }
      this.effects.tracer(mw, h.point);
      const mkBot = (h.object.userData.tdmBot as TDMBot | undefined);
      if (mkBot && !mkBot.dead && this.isTDM && this.tdm) {
        const part = h.object.userData.part as string;
        let dmg = 13 * TDM_DAMAGE_MUL;
        if (part === 'head') dmg *= d.headMul;
        else if (part === 'limb') dmg *= d.limbMul;
        if (h.distance > 14) dmg *= 0.4;
        this.hits++;
        anyHit = true;
        this.effects.blood(h.point);
        audio.fleshImpact(0);
        if (mkBot.takeDamage(dmg, part === 'head', 'player')) {
          this.tdmPlayerKills++;
          this.kills++;
          this.score += 100;
          audio.killConfirm();
          this.tdm.handleKill('player', mkBot, part === 'head', 'MASTERKEY');
          anyKill = true;
        }
        continue;
      }
      const enemy = (h.object.userData.enemy as Enemy | undefined);
      if (!enemy || enemy.dead) continue;
      const part = h.object.userData.part as string;
      let dmg = 13;
      if (part === 'head') dmg *= d.headMul;
      else if (part === 'limb') dmg *= d.limbMul;
      if (h.distance > 14) dmg *= 0.4;
      this.hits++;
      anyHit = true;
      this.effects.blood(h.point);
      audio.fleshImpact(0);
      const isHead = part === 'head';
      if (enemy.takeDamage(dmg, isHead)) {
        this.kills++;
        this.score += 100;
        this.earnCash(isHead ? REWARDS.headshot : REWARDS.kill, isHead ? 'headshot' : 'kill');
        audio.killConfirm();
        if (isHead) { this.headshots++; voice.headshot(); }
        if (this.kills === 1) voice.firstBlood();
        if (this.kills % 3 === 0) {
          this.frags = Math.min(5, this.frags + 1);
          this.flashes = Math.min(2, this.flashes + 1);
        }
        this.onEvent({ type: 'kill', name: enemy.name, weapon: 'MASTERKEY', headshot: isHead });
        anyKill = true;
      }
    }
    this.raycaster.far = 300;
    if (anyHit && !anyKill) { audio.hitMarker(); this.onEvent({ type: 'hit', kill: false }); }
    if (anyKill) { this.onEvent({ type: 'hit', kill: true }); this.rebuildHittables(); }
    this.ai.notifyGunshot(this.pos, 70);
    this.tdm?.notifyGunshot(this.pos, 70);
  }

  private rebuildHittables() {
    this.hittables = [...this.world.occluders];
    if (this.world.glass) this.hittables.push(this.world.glass);
    for (const e of this.ai.enemies) {
      if (!e.dead) this.hittables.push(...e.model.hitMeshes);
    }
    if (this.isTDM && this.tdm) this.hittables.push(...this.tdm.getHittables());
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

  private spawnGrenade(from: THREE.Vector3, target: THREE.Vector3, fromAI: boolean, kind: 'frag' | 'flash' = 'frag', owner?: TDMBot) {
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
      owner,
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
        if (this.isTDM) {
          // grenades from your own team never hurt you in the arena
          if (!g.owner || g.owner.team === 'bravo') this.damagePlayerTDM(dmg, g.pos, g.owner ?? null);
        } else this.damagePlayer(dmg, g.pos);
      }
      // TDM: splash resolves against every bot on both teams, with armor applied
      if (this.isTDM && this.tdm) {
        for (const bot of this.tdm.bots) {
          if (bot.dead) continue;
          if (g.owner && g.owner.team === bot.team) continue;          // no team kills
          if (!g.owner && !g.fromAI && bot.team === 'alpha') continue; // player frag spares allies
          const d = bot.pos.distanceTo(g.pos);
          if (d < 7) {
            // scaled for the bigger TDM health pools — a close frag finishes fights
            const dmg = (d < 3.5 ? 170 : THREE.MathUtils.lerp(140, 35, (d - 3.5) / 3.5));
            const killed = bot.takeDamage(dmg, false, g.owner ?? 'player');
            if (killed) {
              if (g.owner) this.tdm.handleKill(g.owner, bot, false, 'FRAG');
              else {
                this.tdmPlayerKills++;
                this.kills++;
                this.score += 100;
                this.tdm.handleKill('player', bot, false, 'FRAG');
                audio.killConfirm();
                this.onEvent({ type: 'hit', kill: true });
              }
              this.rebuildHittables();
            }
          }
        }
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
            this.earnCash(REWARDS.grenadeKill, 'grenade');
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
      if (this.isTDM && this.tdm) {
        for (const bot of this.tdm.bots) {
          if (!bot.dead && bot.pos.distanceTo(g.pos) < 12) bot.applyStun(4.0);
        }
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
      const ground = this.world.groundHeight(g.pos.x, g.pos.z) + 0.08;
      if (g.pos.y < ground) {
        g.pos.y = ground;
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
        p.y = Math.max(p.y, this.world.groundHeight(p.x, p.z) + 0.05);
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

  /** TDM player damage: armor reduction, then death → 5s respawn (not match end). */
  private damagePlayerTDM(amount: number, from: THREE.Vector3, killer: TDMBot | null) {
    if (this.dead || this.ended) return;
    const isHead = amount >= 40; // bot headshot rounds arrive at 44
    const reduced = amount * (1 - (isHead ? TDM_HEAD_REDUCTION[this.tdmArmor] : TDM_BODY_REDUCTION[this.tdmArmor]));
    this.hp -= reduced;
    this.lastDamageT = 0;
    this.shake = Math.max(this.shake, Math.min(0.7, reduced / 35));
    audio.playerHurt();
    this.onEvent({ type: 'damage', dir: this.dirToScreenDeg(from), amount: reduced });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.tdmPlayerDead = true;
      this.tdmPlayerDeaths++;
      this.tdmRespawnT = TDM_RESPAWN_SECONDS;
      this.triggerHeld = false; this.rmb = false; this.cooking = false; this.keys.clear();
      if (this.tdm && killer) this.tdm.handleKill(killer, 'player', false, 'RIFLE');
      voice.defeat();
    }
  }

  /** Redeploy the player at a protected pad with full HP and fresh utility. */
  private tdmRespawnPlayer() {
    if (!this.tdm || this.ended) return;
    this.tdmPlayerDead = false;
    this.dead = false;
    this.hp = TDM_BASE_HP + this.tdmArmor * TDM_HP_PER_ARMOR;
    this.frags = 3; this.flashes = 1;
    this.pos.copy(this.tdm.getSpawn('alpha'));
    this.vel.set(0, 0, 0); this.vx = 0; this.vz = 0;
    this.yaw = Math.atan2(this.pos.x, this.pos.z); // face mid
    this.pitch = 0;
    // top up mags so a respawn is never a dry spawn
    for (let i = 0; i < this.weapons.length; i++) this.mags[i] = this.weapons[i].magSize;
    this.reloadT = -1; this.reloadStages = []; this.currentReloadStage = 'idle';
  }

  private endTDMMatch() {
    if (this.ended || !this.tdm) return;
    this.ended = true;
    const win = this.tdm.alphaScore > this.tdm.bravoScore;
    if (win) this.score += 500; // match victory bonus
    const mission: MissionReport = {
      id: 'tdm-warehouse', name: 'Warehouse TDM', map: 'arena',
      status: win ? 'complete' : 'failed', duration: TDM_MATCH_SECONDS - this.tdm.timeLeft,
      phases: [],
    };
    const pressure: PressureStats = { totalSpawned: 10, peakLive: 10, retired: 0, pending: 0, candidateChecks: 0, sightChecks: 0, deferred: 0 };
    this.pendingResult = {
      type: 'end', win, kills: this.tdmPlayerKills, score: this.score, shots: this.shots, hits: this.hits,
      headshots: this.headshots, timeSec: mission.duration,
      cash: this.cashEarned, cashLog: [...this.cashLog], difficultyMul: difficultyMultiplier(this.difficultyId),
      mission, pressure,
      tdm: {
        alphaScore: this.tdm.alphaScore, bravoScore: this.tdm.bravoScore, playerKills: this.tdmPlayerKills,
        roster: [
          { name: 'YOU', team: 'alpha' as TDMTeam, dead: this.tdmPlayerDead, armorIcon: TDM_ARMOR_ICONS[this.tdmArmor], you: true, kills: this.tdmPlayerKills, deaths: this.tdmPlayerDeaths, headshots: this.headshots },
          ...this.tdm.bots.map(b => ({ name: b.name, team: b.team, dead: b.dead, armorIcon: TDM_ARMOR_ICONS[b.armor], kills: b.kills, deaths: b.deaths, headshots: b.headshots })),
        ],
      },
    };
    this.finishDelay = 1.2;
    this.triggerHeld = false; this.rmb = false; this.keys.clear();
    if (win) voice.objective('Match over. Alpha squad takes the yard.');
    else voice.defeat();
  }

  private endMatch(win: boolean) {
    if (this.ended) return;
    if (this.isTDM) { this.endTDMMatch(); return; }
    if (win && this.missionRuntime.mission.status !== 'complete') return;
    this.ended = true;
    if (!win) this.missionRuntime.mission.fail();
    if (win) this.score += 1000; // extraction bonus, mirrors the debrief footnote
    if (win) this.earnCash(REWARDS.extraction, 'extraction');
    const mission = this.missionRuntime.mission.report();
    this.pendingResult = {
      type: 'end', win, kills: this.kills, score: this.score, shots: this.shots, hits: this.hits,
      headshots: this.headshots, timeSec: mission.duration,
      cash: this.cashEarned, cashLog: [...this.cashLog], difficultyMul: difficultyMultiplier(this.difficultyId),
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
    const frameSeconds = Math.max(0, (t - this.lastT) / 1000);
    const dt = Math.min(0.05, frameSeconds);
    this.lastT = t;
    // rolling FPS meter (true reading, including hitches — this is what the HUD shows)
    this.fpsAcc += frameSeconds; this.fpsFrames++;
    if (this.fpsAcc >= 0.25) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    // A separate, hitch-immune sample drives resolution scaling only.
    this.recordFrameForScaling(frameSeconds);
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
    this.clouds.rotation.y += dt * 0.0012;
    const k = this.keys;

    // Animated film grain
    this.vignettePass.uniforms.uTime.value = performance.now() / 1000;

    // --- Part A polish tick (arena only) ---
    // use stubs to satisfy noUnusedLocals
    void this.playerDowned; void this.downedTime; void this.bleedout; void this.execHold; void this.reviveHold;
    void this.killTimes; void this.onFire; void this.onFireTime; void this.onFireCD;
    if (this.isTDM && !this.paused) {
      this.polishTime += dt;
      // ambient every 12-20s at vol 0.15 2D
      this.ambientT -= dt;
      if (this.ambientT <= 0) {
        audio.playAmbient();
        this.ambientT = 12 + Math.random()*8;
      }
      // flicker: Math.sin(t*8)*0.3+0.7 on warehouse lights (those with userData.phase)
      for (const fl of this.world.flickerLights) {
        if ((fl.userData as unknown as {phase:number}).phase !== undefined) {
          const phase = (fl.userData as unknown as {phase:number}).phase;
          fl.intensity = Math.sin(this.polishTime*8 + phase)*0.3 + 0.7;
        }
      }
      // dust motes drift
      for (const pts of this.world.dustMotes) {
        const pos = (pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        const vel = pts.userData.vel as Float32Array;
        for (let i=0;i<pos.length;i+=3) {
          pos[i] += vel[i]*dt;
          pos[i+1] += vel[i+1]*dt;
          pos[i+2] += vel[i+2]*dt;
          // wrap Y within 1.2-4.6
          if (pos[i+1] > 4.6) pos[i+1]=1.4;
          if (pos[i+1] < 1.2) pos[i+1]=4.5;
          // wrap XZ within 2.2 range around initial
          // soft bounds bounce
          const dx = pos[i] - pts.position.x; // not used, simply bounce if out of expected
          void dx;
        }
        (pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (pts.material as THREE.PointsMaterial).opacity = 0.55;
        // gentle slow rotation
        pts.rotation.y += dt*0.04;
      }
    }

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
    if (this.boltCycle>0.3 && this.boltCycle-dt<=0.3) audio.boltRelease();
    this.boltCycle = Math.max(0,this.boltCycle-dt);
    const wantAds = this.rmb && this.boltCycle <= 0 && !this.sprinting && this.reloadT < 0 && this.switchT < 0 && !this.cooking && !this.sliding;
    this.sprintToAdsDelay = Math.max(0, this.sprintToAdsDelay - dt);
    this.sprintToFireDelay = Math.max(0, this.sprintToFireDelay - dt);

    // Smooth, frame-rate independent scope-in/out (fast attack, soft settle — no linear snap)
    {
      const target = wantAds && this.sprintToAdsDelay <= 0 ? 1 : 0;
      const rate = target ? 3.2 / (this.def().adsTime ?? 0.22) : 18;
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
    speed *= this.def().moveSpeedMul ?? 1;

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
    const previousX=this.pos.x,previousZ=this.pos.z;
    // Slim 0.33 capsule slips through doorways instead of snagging on frames
    this.moveAxis(this.pos, dxm, dzm, 0.33, this.crouched ? 1.2 : 1.75);

    // Drive pose and footsteps from actual displacement, not input against a wall.
    const travelled=Math.hypot(this.pos.x-previousX,this.pos.z-previousZ);
    this.walkBlend += (Math.min(1,travelled/Math.max(dt,0.001)/2)-this.walkBlend)*(1-Math.exp(-dt*10));
    if (this.grounded && travelled>0.0005) {
      this.stepAcc += travelled;
      const stride = this.sprinting ? 0.95 : this.sliding ? 1.8 : this.crouched ? 0.55 : 0.68;
      this.footPhase=(this.footPhase+travelled*Math.PI/stride)%(Math.PI*2);
      while (this.stepAcc >= stride) {
        this.stepAcc -= stride;

        const surf = this.surfaceAt();
        const inTrap = this.isTDM && this.world.soundTraps.some(t=> this.pos.x>=t.minX && this.pos.x<=t.maxX && this.pos.z>=t.minZ && this.pos.z<=t.maxZ);
        audio.footstep(surf, this.sprinting, this.crouched, inTrap ? 1.8 : 1);
        if ((surf === 'sand' && !this.crouched) || inTrap) {
          // extra dust when in trap — always dust, more visible
          const dpos = V().set(this.pos.x, this.pos.y + 0.04, this.pos.z);
          this.effects.footDust(dpos);
          if (inTrap) this.effects.footDust(dpos); // double puff for trap
        }
        if (!this.crouched) {
          // sound traps notify farther (already louder): give 1.6x radius
          const rad = this.sprinting ? 14 : 8;
          this.ai.notifyGunshot(this.pos, inTrap ? rad*1.6 : rad);
          this.tdm?.notifyGunshot(this.pos, inTrap ? rad*1.6 : rad);
        }
      }
    }

    this.slideCD = Math.max(0, this.slideCD - dt);
    this.jumpCD = Math.max(0, this.jumpCD - dt);

    // Gravity & Jump Landing Dip (0.08m over 80ms, spring back 150ms)
    const support = this.supportHeight(this.pos, 0.4);
    // Follow walkable downhill slopes without repeatedly becoming airborne and
    // replaying the landing dip on every terrain triangle.
    if (this.grounded && this.vel.y <= 0 && this.pos.y-support >= 0 && this.pos.y-support < 0.48) {
      this.pos.y = support; this.vel.y = 0;
    } else if (this.pos.y > support + 0.001) {
      this.vel.y -= 18.5 * dt;
      this.pos.y += this.vel.y * dt;
      this.grounded = false;
      if (this.pos.y <= support) {
        this.pos.y = support;
        if (this.vel.y < -3) { audio.jumpLand(this.surfaceAt()); this.landDip = Math.min(0.08,-this.vel.y*0.008); }
        this.vel.y = 0;
        this.grounded = true;
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

    // Health regen (to 50 HP after 5s; TDM regenerates to 40% of the armored pool)
    this.lastDamageT += dt;
    const regenCap = this.isTDM ? Math.round((TDM_BASE_HP + this.tdmArmor * TDM_HP_PER_ARMOR) * 0.4) : 50;
    if (!this.dead && this.lastDamageT > 5 && this.hp < regenCap) {
      this.hp = Math.min(regenCap, this.hp + dt * 10);
    }

    // Auto weapon fire
    this.fireCD -= dt;
    if (this.triggerHeld && this.def().auto) this.tryFire();
    this.shotResetT -= dt;
    if (this.shotResetT <= 0) this.shotIdx = 0;

    // Recoil recovery — a real spring, not an instant snap. The sight settles
    // over ~140 ms so sustained fire visibly stacks climb before recovery wins.
    const rec = recoilRecovery(dt);
    this.recoilP *= rec; this.recoilY *= rec;
    for (const weapon of this.weapons) if (weapon.bloomSpec) weapon.bloomNow=Math.max(0,(weapon.bloomNow??0)-weapon.bloomSpec.decay*dt);

    // Staged reload
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      while (this.reloadStages.length && this.reloadT >= this.reloadStages[0].t) {
        this.reloadStages.shift()!.fn();
      }
    }
    if (this.pumpT > 0) this.pumpT = Math.max(0, this.pumpT - dt);
    // Masterkey tube reload (3 shells, 3.5 s)
    if (this.mkReloadT >= 0) {
      this.mkReloadT += dt;
      if (this.mkReloadT >= 3.5) {
        this.mkReloadT = -1;
        this.mkAmmo = 3;
        audio.magIn();
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
    if (this.isTDM && this.tdm) {
      this.tdm.update(dt);
      // player respawn cooldown
      if (this.tdmPlayerDead && !this.ended) {
        this.tdmRespawnT -= dt;
        if (this.tdmRespawnT <= 0 && this.tdm.timeLeft > 2) this.tdmRespawnPlayer();
      }
      // match clock
      if (this.tdm.timeLeft <= 0 && !this.ended) this.endTDMMatch();
      if (this.tdm.rosterVersion !== this.tdmRosterVersion) {
        this.tdmRosterVersion = this.tdm.rosterVersion;
        this.rebuildHittables();
      }
    } else {
      this.missionRuntime.update(dt, this.keys.has('KeyX') && this.reloadT < 0 && !this.cooking && !this.sprinting);
    }
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
    const bob = Math.sin(this.footPhase) * bobAmp * this.walkBlend * (this.grounded ? 1 : 0);
    eye.y += bob;

    // Camera shake (scaled by user setting)
    if (this.shake > 0.001) {
      const k = this.motionBlurAmount;
      eye.x += (Math.random() - 0.5) * this.shake * 0.14 * k;
      eye.y += (Math.random() - 0.5) * this.shake * 0.14 * k;
    }

    const weapon=this.def(), time=performance.now()/1000;
    const sway=(this.ads>.5 ? this.ads : 0) * (weapon.swayMul??1) * (this.crouched ? (weapon.swayMulCrouched??1)*.65 : 1) * (this.bipodDeployed() ? .55 : 1);
    const swayPitch=Math.sin(time*1.53)*.00095*sway, swayYaw=Math.sin(time*1.17+.7)*.00065*sway;
    this.camera.position.copy(eye);
    this.camera.rotation.set(
      this.pitch + this.recoilP + swayPitch + (this.sprinting ? -0.02 : 0) + (this.shake > 0.001 ? (Math.random() - 0.5) * this.shake * 0.05 * this.motionBlurAmount : 0),
      this.yaw + this.recoilY + swayYaw,
      roll
    );

    // Smooth FOV — per-weapon ADS zoom (sniper gets a strong scope, others a modest pull-in)
    const adsFov = this.adsFovEff();
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
    // Scope overlay owns the whole view; receiver rings/arms must not intrude.
    // Threshold 45° covers 3x/4x/6x glass — the old <30 cut left the 4x (30°)
    // player staring into the BACK of the scope tube model while zoomed.
    const canted = !!d.canted && !!this.keys?.has('KeyT') && (d.scopeMaxPower??1)>1;
    const hideInAds = inAds && !canted && ((d.scopePower??1)>1 || (d.scopePower===undefined && this.adsFovEff()<45));
    g.visible = !hideInAds;
    this.muzzleFlash.visible = !hideInAds;
    const hip = { x: 0.22, y: -0.19, z: -0.38, ry: 0.035 };
    const opticPart = d.model.attached.optic;
    let adsX = 0;
    let adsY = -(d.model.sightY + ((opticPart?.userData.sightYOffset as number | undefined) ?? 0)) * S;
    const cantRoll=canted ? Math.PI/4 : 0;
    const cantAim=d.model.attached.rail?.userData.aim as THREE.Object3D | undefined;
    if (canted && cantAim) {
      g.updateWorldMatrix(true,true);
      const aim=g.worldToLocal(cantAim.getWorldPosition(new THREE.Vector3())).applyAxisAngle(new THREE.Vector3(0,0,1),cantRoll);
      adsX=-aim.x*S; adsY=-aim.y*S;
    }
    let px = THREE.MathUtils.lerp(hip.x, adsX, a);
    let py = THREE.MathUtils.lerp(hip.y, adsY, a);
    let pz = THREE.MathUtils.lerp(hip.z, -0.34, a);
    let rx = 0;
    let ry = THREE.MathUtils.lerp(hip.ry, 0, a);
    let rz = cantRoll*a;

    // Idle sway
    const swayM = (1 - a * 0.95) * (d.swayMul ?? 1) * (this.crouched ? (d.swayMulCrouched ?? 1) : 1);
    px += Math.sin(t * Math.PI) * 0.004 * S * swayM;
    py += Math.sin(t * Math.PI * 2 + 1) * 0.0035 * S * swayM;

    // Walk bob
    const bobM = this.grounded ? this.walkBlend : 0;
    px += Math.sin(this.footPhase) * 0.01 * S * bobM * swayM;
    py -= Math.abs(Math.cos(this.footPhase)) * 0.007 * S * bobM * swayM;
    rz += Math.sin(this.footPhase) * 0.012 * S * bobM * swayM;

    // Sprint lower weapon
    if (this.sprinting) this.sprintPose = Math.min(1, this.sprintPose + dt / 0.15);
    else this.sprintPose = Math.max(0, this.sprintPose - dt / 0.12);
    const sp = this.sprintPose;
    px += sp * 0.08 * S; py -= sp * 0.13 * S; pz -= sp * 0.04;
    rx += sp * 0.35; ry -= sp * 0.32; rz += sp * 0.18;
    px += Math.sin(t*10)*sp*0.012; py += Math.cos(t*20)*sp*0.006;

    // Fire kick (halved in ADS so the sight picture stays on target)
    const kickM = 1 - a * 0.55;
    pz += this.vmKick * 0.05 * S * kickM;
    rx += this.vmKickRot * 0.075 * kickM;

    if ((d.boltAction ?? this.cur === 3) && this.boltCycle > 0) {
      const cycle=1-this.boltCycle/1.25, lift=Math.sin(cycle*Math.PI);
      py -= lift*0.035; rz += lift*0.12;
      d.model.chargingHandle.position.z = Math.sin(Math.max(0,Math.min(1,(cycle-0.2)/0.6))*Math.PI)*0.055;
    }

    // Reload animation — every weapon family has its own tactical handling.
    // The gun stays UP in the workspace (chest height, canted toward the eyes)
    // instead of dropping out of frame; the mag physically leaves and returns.
    const magObj = d.model.mag;
    const magHomeY = (magObj.userData.homeY as number | undefined) ?? 0;
    const magHomeZ = (magObj.userData.homeZ as number | undefined) ?? 0;
    if (this.reloadT >= 0) {
      const rt = this.reloadT / this.reloadDur;
      const dip = Math.sin(Math.min(1, rt) * Math.PI);
      const tag = d.audioTag ?? 'm4';
      if (tag === 'ak') {
        // AK: rock-and-lock — the rifle rolls hard left and NOSES UP while the
        // mag pivots out forward, then slams back with a visible counter-rock.
        py -= dip * 0.06 * S; rx -= dip * 0.28; rz += dip * 0.45; ry -= dip * 0.10;
        const rock = rt > 0.5 && rt < 0.62 ? Math.sin(((rt - 0.5) / 0.12) * Math.PI) : 0;
        rz -= rock * 0.12; // the slap when the fresh mag seats
      } else if (tag === 'sniper') {
        // AWM: roll right into the workspace, feed the stubby mag from below,
        // then a long bolt stroke re-cocks (chargingHandle slides back).
        py -= dip * 0.08 * S; rx -= dip * 0.30; rz -= dip * 0.35; ry += dip * 0.08;
        const boltP = rt > 0.72 ? Math.sin(Math.min(1, (rt - 0.72) / 0.24) * Math.PI) : 0;
        d.model.chargingHandle.position.z = boltP * 0.06;
      } else if (tag === 'pistol' || tag === 'deagle') {
        // Pistols: muzzle tips up near the face, mag drops fast, slide runs.
        py -= dip * 0.05 * S; rx += dip * 0.22; rz += dip * 0.18; pz -= dip * 0.02;
        const slideP = rt > 0.78 ? Math.sin(Math.min(1, (rt - 0.78) / 0.2) * Math.PI) : 0;
        d.model.chargingHandle.position.z = slideP * 0.04;
      } else if (tag === 'lmg') {
        // Cradle the SAW in frame so its hinged cover and feed tray stay readable.
        py -= dip * 0.04 * S; rz += dip * 0.30; rx += dip * 0.18;
        d.model.chargingHandle.rotation.x = -dip * 1.15; // cover stays on its front hinge
      } else if (tag === 'shotgun') {
        // SPAS: cradled low and rolled, shells thumbed into the tube.
        py -= dip * 0.07 * S; rx -= dip * 0.30; rz += dip * 0.30;
      } else if (tag === 'smg' || tag === 'vector') {
        // PDWs: fast, twitchy — sharp cant, quick mag punch, minimal dip.
        py -= dip * 0.055 * S; rx -= dip * 0.30; rz += dip * 0.32; ry += dip * 0.06;
      } else {
        // AR family (M416/SCAR): controlled tactical reload at chest height.
        py -= dip * 0.08 * S; rx -= dip * 0.40; rz += dip * 0.24;
      }
      if (!d.pumpShotgun) {
        // Mag travel: straight drop for STANAG guns, forward pivot for the AK rock.
        const out = rt > 0.14 && rt < 0.58 ? Math.sin(((rt - 0.14) / 0.44) * Math.PI) : 0;
        magObj.position.y = magHomeY - out * 0.17 * S;
        if (tag === 'ak') {
          magObj.position.z = magHomeZ - out * 0.05 * S;
          magObj.rotation.x = out * 0.5;
        }
      }
      this.poseLArm(d, rt);
    } else {
      magObj.position.y = magHomeY;
      if (d.audioTag === 'ak') { magObj.position.z = magHomeZ; magObj.rotation.x = 0; }
      if (d.audioTag === 'lmg') d.model.chargingHandle.rotation.x *= 1 - Math.min(1, dt * 10);
      if ((d.boltAction ?? this.cur === 3) && this.boltCycle <= 0) d.model.chargingHandle.position.z = (d.model.chargingHandle.userData.homeZ as number | undefined) ?? 0;
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

    // Bipod legs swing down when prone-ADS (deployed), fold otherwise.
    const legs = d.model.attached.underbarrel?.userData.legs as THREE.Object3D[] | undefined;
    if (legs) {
      const folded = this.bipodDeployed() ? 0 : Math.PI / 2;
      for (const leg of legs) leg.rotation.x += (folded - leg.rotation.x) * Math.min(1, dt * 10);
    }

    // Pump stroke: the whole gun dips and rolls as the forend cycles.
    if (this.pumpT > 0) {
      const pk = Math.sin((1 - this.pumpT / 0.5) * Math.PI);
      py -= pk * 0.035 * S;
      rx += pk * 0.10;
      rz += pk * 0.05;
      if (d.pumpShotgun) magObj.position.z = magHomeZ + pk * 0.055;
    } else if (d.pumpShotgun) {
      magObj.position.z = magHomeZ;
    }
    // Reciprocating slide / bolt (pistols + SCAR): snap back, spring home.
    // (Skipped mid-reload — the reload keyframes own the slide then.)
    if ((d.audioTag === 'pistol' || d.audioTag === 'deagle' || d.audioTag === 'scar') && this.reloadT < 0) {
      this.slideKick = Math.max(0, this.slideKick - dt * 9);
      d.model.chargingHandle.position.z = ((d.model.chargingHandle.userData.homeZ as number | undefined) ?? 0) + this.slideKick * this.slideKick * 0.038;
    }

    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);

    const mw = V();
    d.model.muzzle.getWorldPosition(mw);
    this.muzzleFlash.position.copy(mw);
    this.vmLight.position.copy(mw);
    this.updateTactical(d);
  }
  /** Rail laser dot + weapon flashlight, driven by the fitted rail box. */
  private updateTactical(d: WeaponDef): void {
    const wantLaser = !!d.laser && !this.dead && !this.ended;
    const wantLight = !!d.flashlight && !this.dead && !this.ended;
    if (wantLaser && !this.laserDot) {
      this.laserDot = new THREE.Mesh(
        new THREE.CircleGeometry(0.02, 12),
        new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
      );
      this.laserDot.renderOrder = 999;
      this.laserBeam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.laserBeam.frustumCulled = false;
      this.scene.add(this.laserDot, this.laserBeam);
    }
    if (wantLight && !this.torch) {
      this.torch = new THREE.SpotLight(0xfff2d8, 100, 50, 0.45, 0.5, 1.5);
      this.scene.add(this.torch);
      this.scene.add(this.torch.target);
    }
    if (this.laserDot) this.laserDot.visible = wantLaser;
    if (this.laserBeam) this.laserBeam.visible = wantLaser;
    if (this.torch) this.torch.visible = wantLight;
    if (!wantLaser && !wantLight) return;
    const dir = this._t1;
    this.camera.getWorldDirection(dir);
    const origin = this._t2.copy(this.camera.position);
    if (wantLight && this.torch) {
      this.torch.position.copy(origin);
      this.torch.target.position.copy(origin).addScaledVector(dir, 18);
    }
    if (wantLaser && this.laserDot && this.laserBeam) {
      this.raycaster.set(origin, dir);
      this.raycaster.far = 120;
      const hit = this.raycaster.intersectObjects(this.hittables, false)[0];
      const end = hit ? hit.point : this._t3.copy(origin).addScaledVector(dir, 80);
      this.laserDot.position.copy(end);
      this.laserDot.lookAt(this.camera.position);
      this.laserDot.scale.setScalar(((hit ? hit.distance : 80) * 0.004 + 0.008) / 0.02);
      const pos = this.laserBeam.geometry.attributes.position as THREE.BufferAttribute;
      const me = this.camera.matrix.elements;
      pos.setXYZ(0, origin.x + me[0] * 0.09 + me[4] * -0.07, origin.y + me[1] * 0.09 + me[5] * -0.07, origin.z + me[2] * 0.09 + me[6] * -0.07);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      this.raycaster.far = 300;
    }
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
    // Static architecture shadows refresh only on construction/settings/destruction.
    this.frameNo++;
    this.renderer.shadowMap.autoUpdate = false;
    if (this.frameNo <= 1) this.renderer.shadowMap.needsUpdate = true;
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
    this.runStartT = performance.now();
    audio.ensure();
    voice.unlock();
    this.started = true;
    if (this.isTDM) {
      this.onEvent({ type: 'callout', text: 'Warehouse TDM — most kills at 2:30 wins.' });
      voice.objective('Weapons free. Take the yard.');
      return;
    }
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
    this.adaptiveEnabled = s.adaptiveResolution ?? true;
    this.userPR = cap * Math.min(window.devicePixelRatio || 1,1.25);
    this.adaptStep = 0;
    this.dynPR = this.userPR * ADAPT_STEPS[0];
    this.adaptLow = 0; this.adaptHigh = 0; this.adaptLockUntil = 0; this.adaptSamples.length = 0;
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
  private adaptStep = 0;
  private adaptLow = 0;
  private adaptHigh = 0;
  private adaptLockUntil = 0;
  private adaptSamples: number[] = [];

  private adaptResolution(t: number) {
    if (!this.adaptiveEnabled || this.paused || document.hidden) return;
    if (t - this.lastAdaptT < ADAPT_EVAL_MS) return;
    // Do not re-judge on a window that still contains the cost of the last change.
    if (t < this.adaptLockUntil) { this.lastAdaptT = t; this.adaptSamples.length = 0; return; }
    this.lastAdaptT = t;
    const fps = this.stableFps();
    this.adaptSamples.length = 0;
    if (fps < 0) return;
    const maxStep = ADAPT_STEPS.length - 1;
    if (fps < ADAPT_DOWN_FPS && this.adaptStep < maxStep) {
      this.adaptHigh = 0;
      if (++this.adaptLow < ADAPT_DOWN_WINDOWS) return;
      this.adaptLow = 0;
      this.applyAdaptStep(this.adaptStep + 1, t);
    } else if (fps > ADAPT_UP_FPS && this.adaptStep > 0) {
      this.adaptLow = 0;
      if (++this.adaptHigh < ADAPT_UP_WINDOWS) return;
      this.adaptHigh = 0;
      this.applyAdaptStep(this.adaptStep - 1, t);
    } else {
      this.adaptLow = 0; this.adaptHigh = 0;
    }
  }

  private applyAdaptStep(step: number, t: number) {
    this.adaptStep = step;
    this.dynPR = this.userPR * ADAPT_STEPS[step];
    this.syncPixelRatio();
    this.adaptLockUntil = t + ADAPT_LOCK_MS;
    this.adaptSamples.length = 0;
  }

  /**
   * Median frame rate over the clean frames since the last evaluation. A median is
   * immune to the odd multi-second hitch, which a mean is not — and a mean is exactly
   * what used to make one stall look like a permanently slow GPU.
   * Returns -1 when there is not enough clean data to judge.
   */
  private stableFps(): number {
    const n = this.adaptSamples.length;
    if (n < 30) return -1;
    const sorted = this.adaptSamples.slice().sort((a, b) => a - b);
    const median = sorted[n >> 1];
    return median > 0 ? 1 / median : -1;
  }

  private recordFrameForScaling(frameSeconds: number) {
    if (frameSeconds <= 0 || frameSeconds > ADAPT_STALL_SECONDS) return;
    if (this.adaptSamples.length < 480) this.adaptSamples.push(frameSeconds);
  }

  setPaused(p: boolean) {
    if (!p && this.graphicsLost) return;
    this.paused = p;
    if (p) {
      this.cancelScopeAdjustment();
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
    if (this.isTDM && this.tdm) {
      for (const b of this.tdm.bots) {
        if (b.dead || b.team !== 'bravo') continue;
        const d = b.pos.distanceTo(this.pos);
        if (d < nd) { nd = d; nearest = { angle: this.dirToScreenDeg(b.pos), dist: d, above: b.pos.y - this.pos.y }; }
      }
    }
    return {
      hp: Math.round(this.hp),
      mag: this.mags[this.cur],
      weapon: this.def().name,
      masterkey: this.def().masterkey ? { shells: this.mkAmmo, reloading: this.mkReloadT >= 0 } : undefined,
      cash: this.cashEarned,
      secondaryWeapon: (this.weapons.length === 2 ? this.weapons[this.cur === 0 ? 1 : 0] : this.weapons[this.cur === 2 ? 0 : 2])?.name ?? '',
      heldSlot: (this.weapons.length === 2 ? this.cur === 0 : this.cur !== 2) ? 'primary' : 'secondary',
      bipodDeployed: this.bipodDeployed(),
      reticle: this.cantedActive() ? 'none' : this.def().reticle ?? (this.cur===3 ? 'sniper' : 'none'),
      zoomFov: this.adsFovEff(),
      scopePower: this.cantedActive() ? 1 : this.def().scopePower ?? 1,
      scopeMinPower: this.def().scopeMinPower ?? 1,
      scopeMaxPower: this.def().scopeMaxPower ?? 1,
      scopeAdjusting: this.scopeAdjusting,
      canted: this.cantedActive(),
      lpvoHigh: this.def().lpvoHigh ?? false,
      pumping: this.pumpT > 0,
      reloading: this.reloadT >= 0,
      reloadStage: this.currentReloadStage,
      frags: this.frags,
      flashes: this.flashes,
      bearing: ((-this.yaw * 180 / Math.PI) % 360 + 360) % 360,
      kills: this.isTDM ? this.tdmPlayerKills : this.kills,
      score: this.score,
      enemiesLeft: this.isTDM && this.tdm ? this.tdm.aliveCount('bravo') : this.ai.aliveCount(),
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
      enemiesMap: this.isTDM && this.tdm
        ? this.tdm.bots
          .filter(b => !b.dead && b.team === 'bravo')
          .map(b => ({
            nx: (b.pos.x + H) / (2 * H), nz: (b.pos.z + H) / (2 * H),
            yaw: -b.yaw * 180 / Math.PI,
            hot: b.state === 'ENGAGE' || b.state === 'PUSH' || b.state === 'FLANK',
          }))
        : this.ai.enemies
          .filter(e => !e.dead)
          .map(e => ({
            nx: (e.pos.x + H) / (2 * H), nz: (e.pos.z + H) / (2 * H),
            // Heading (deg) + engagement state let the radar draw directional
            // wedges and burn hostiles red the moment they have eyes on you.
            yaw: -e.yaw * 180 / Math.PI,
            hot: e.seesPlayer || e.state === 'ENGAGE' || e.state === 'SUPPRESS' || e.state === 'FLANK' || e.state === 'ADVANCE',
          })),
      missionMap: (() => {
        if (this.isTDM) return undefined;
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
      mission: this.isTDM ? undefined : this.missionRuntime.hud(((-this.yaw * 180 / Math.PI) % 360 + 360) % 360),
      tdm: this.isTDM && this.tdm ? {
        alphaScore: this.tdm.alphaScore,
        bravoScore: this.tdm.bravoScore,
        timeLeft: this.tdm.timeLeft,
        playerKills: this.tdmPlayerKills,
        playerDead: this.tdmPlayerDead,
        respawnIn: Math.max(0, this.tdmRespawnT),
        maxHp: TDM_BASE_HP + this.tdmArmor * TDM_HP_PER_ARMOR,
        roster: [
          { name: 'YOU', team: 'alpha' as TDMTeam, dead: this.tdmPlayerDead, armorIcon: TDM_ARMOR_ICONS[this.tdmArmor], you: true, kills: this.tdmPlayerKills, deaths: this.tdmPlayerDeaths, headshots: this.headshots },
          ...this.tdm.bots.map(b => ({ name: b.name, team: b.team, dead: b.dead, armorIcon: TDM_ARMOR_ICONS[b.armor], kills: b.kills, deaths: b.deaths, headshots: b.headshots })),
        ],
      } : undefined,
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
    window.removeEventListener('wheel', this.onScopeWheel);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost',this.onGraphicsLost);
    this.canvas.removeEventListener('webglcontextrestored',this.onGraphicsRestored);
    const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    for (const scene of [this.scene,this.vmScene]) scene.traverse(object=>{
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        for(const mat of Array.isArray(object.material)?object.material:[object.material]) materials.add(mat);
      }
    });
    for(const material of materials) {
      for(const value of Object.values(material)) if(value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    for(const texture of textures) texture.dispose();
    this.missionRuntime?.dispose();
    this.tdm?.dispose();
    this.ai.dispose();
    this.composer.dispose();
    this.bloom.dispose();
    this.vignettePass.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    for (const scene of [this.scene, this.vmScene]) scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) geometries.add(object.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    this.reflectionMap?.dispose();
    this.renderer.dispose();
  }
}
