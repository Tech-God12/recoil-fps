# OPERATION ARMORY — ECONOMY, PROGRESSION, 3D LOADOUT & WEAPON COMPONENT SYSTEM

> **Role:** You are a senior gameplay engineer, technical artist and UI/motion designer executing a
> complete feature build on *Recoil FPS* (React 19 + Vite 7 + TypeScript 5.9 + three.js 0.185,
> procedural geometry only, no external 3D assets). Today the player spawns with every weapon
> unlocked and there is no progression, no economy, no customisation. You will replace that with a
> full **cash economy → post-mission Armory → click-to-customise 3D gun → attachments that
> physically bolt onto the model and change real gun stats** loop, plus **five new weapon models**.
>
> **THIS IS ONE DELIVERABLE. IMPLEMENT THE ENTIRE SPECIFICATION IN ONE PASS.** Do not split it into
> phases, do not deliver "part 1", do not stub anything as "TODO / later", do not ship a data model
> without the UI or a UI without the engine hooks. Every section of this document that says MUST is
> an acceptance criterion. When you finish, `node scripts/validate.mjs` MUST pass (lint, typecheck,
> Node tests, mutation checks) and `npm run build` MUST succeed.

---

## 0. READ THE CODEBASE FIRST — WHAT EXISTS TODAY

Before writing a line, open and read these files end-to-end. The spec below references their real
symbols; do not invent parallel systems where one already exists.

| File | What matters for this task |
|---|---|
| `src/game/engine.ts` (2225 lines) | `Engine` class. `WeaponDef` interface (~L121): `{ name, model, auto, rpm, damage, headMul, limbMul, magSize, reserve, hipSpread, adsSpread, pattern, adsFov, tacReload, emptyReload }`. Weapons array is hard-built in the constructor (~L400–470) with `buildM4/buildAK47/buildM1911/buildAWM/buildMP7`. `switchWeapon(i)` is bound to `Digit1..Digit5` (~L616). Fire logic (~L1180–1325): ADS spread forced to 0 when `this.ads > 0.65`; damage falloff `if (h.distance > 35) dmg *= 0.85`; recoil `kickP = pat[0]*0.0052*adsRecoilReduction`; **fire audio is switched on `this.cur` index** (`if (this.cur === 0) audio.fireM4() …`) — this MUST be refactored to key off weapon data; `this.ai.notifyGunshot(this.pos, 65)` is enemy hearing radius; sniper bolt cycle is `if (this.cur === 3)` — also index-coupled, MUST become data-driven. Score: `+100` kill / `+150` headshot (~L1257), `+100` grenade kill, `+1000` extraction. `GameEvent` union includes `{ type:'end'; win; kills; score; shots; hits; headshots; timeSec; mission; pressure }`. `hud(): HudState` (~L2131). `applySettings(s)`. Constructor signature: `new Engine(canvas, difficulty, onEvent, mapId)`. |
| `src/game/models.ts` (705 lines) | `WeaponModel { group, mag, chargingHandle, muzzle, sightY, optic, lArm, lArmKeys, adsHidden }`. `GunBuilder` merges geometry per material (`box/cyl/sph/build(parent)`), `WM` shared material palette (`poly, steel, darkSteel, tan, dark, wood, woodDark, grip, rubber, brass, sleeve, glove, glass, reticle, tritium`), `attachArms(gun, anchors)` builds procedural first-person arms + reload keyframes. Each weapon builder is ~60–100 lines of `b.box(...)`/`b.cyl(...)` calls in gun-local space (barrel points −Z, muzzle at z ≈ −0.3 … −0.72). **This is the visual style you must match** for the new guns and every attachment. |
| `src/game/ai.ts` | `Enemy.hear(pos, radius)`, `AIManager.notifyGunshot(pos, radius=60)`. Suppressors hook here. |
| `src/game/audio.ts` | `SpatialAudioEngine` with `fireM4/fireAK/firePistol/fireSniper/fireSMG`, `magOut/magIn/boltRelease/forwardAssist`, `burstDirect(...)` synth helper. Everything is procedural WebAudio; you will add new signatures the same way. |
| `src/App.tsx` | Phase machine `'menu' | 'playing' | 'paused' | 'results'`. `deploy()` constructs `Engine`, calls `applySettings`, `start()`, `requestLock()`. `'end'` event → `setResults` + `changePhase('results')`. Settings persisted at `localStorage['recoilfps.settings.v1']`. |
| `src/ui/Screens.tsx` | `MainMenu({ s, onDeploy, onSettings, onMap })`, `PauseMenu`, `ResultsScreen({ r, onRedeploy, onMenu })` (After-Action Report with grade stamp, stat cards, phase timeline), `BootScreen`. |
| `src/ui/components.tsx`, `src/index.css` (1050 lines) | "Volt Protocol" design language: `--bg #05070B`, `--bg2`, `--acc #F06A2E` (blaze orange), `--acc-2`, `--volt #3FD68E`, `--cyber #58BFE4`, `--danger`, `--warn`, `--panel`, `--line`, fonts Orbitron / Rajdhani / Share Tech Mono (`--mono`). Corner-bracket panels (`.brk-*`), hazard stripes, `.glitch`, `CountUp`. **Reuse this language; do not introduce a second visual style.** |
| `tests/*.test.js`, `tests/helpers/*`, `scripts/validate.mjs`, `scripts/mutate.mjs` | Node `--test` with a TS loader and a canvas stub (`installCanvasStub`). Tests import `.ts` directly. Some tests render React with `renderToStaticMarkup` — components MUST be SSR-safe at render time (no `window`/`document`/`localStorage` access during render; effects are fine). |
| `docs/ui-overhaul-prompt.md`, `docs/self-audit-prompt.md` | Prior prompts — read for tone and for the constraints the codebase already honours. |

---

## 1. NON-NEGOTIABLE CONSTRAINTS

1. **Zero external assets.** No GLTF/OBJ/FBX, no image downloads, no new npm dependencies. All gun
   and attachment geometry is built with `GunBuilder` primitives (RoundedBox / Cylinder / Sphere) the
   way `models.ts` already does. All new textures are canvas/DataTexture generated in code.
2. **Performance budget.** In-game each weapon stays ≤ 10 draw calls (one merged mesh per material,
   plus one merged mesh per *attached* component). The Armory 3D viewer must hold 60 fps on an
   integrated GPU: one gun, ≤ 30 draw calls, shadow map ≤ 1024, single `WebGLRenderer` that is
   created on Armory mount and **disposed on unmount** (renderer, render targets, geometries,
   materials you created — but never dispose the shared `WM` materials).
3. **Keep every existing public contract** unless this document explicitly changes it:
   `MainMenu`, `PauseMenu`, `Settings`, `Hud`, `MissionObjective` props are unchanged. `ResultsScreen`
   gains new props (see §7). `Engine` constructor gains a 5th argument (see §6.1). `HudState` gains
   fields (§6.6). `GameEvent` gains a `'cash'` event (§6.5).
4. **Existing tests must keep passing untouched** (`tests/*.test.js`). You may ADD tests. The main
   menu markup must still contain every mission phase title and `Reach the pickup to extract`, and
   must not contain `21 HOSTILES`.
5. **Persistence is `localStorage` only**, single key `recoilfps.profile.v1`, versioned, with a
   migration function and a guard for corrupt JSON (fall back to fresh profile, never crash).
   Reads/writes only inside effects/handlers — never during render.
6. **Determinism for tests.** All economy math, stat resolution, purchase validation and attachment
   compatibility live in pure, side-effect-free modules that import nothing from three.js or React,
   so Node tests can exercise them without a canvas.
7. **No index-coupled weapon logic anywhere in `engine.ts` when you are done.** Every `if (this.cur === n)`
   becomes a lookup on the resolved weapon definition (`def().audio`, `def().boltAction`, …).
8. **Accessibility.** Every clickable 3D hotspot has a keyboard-reachable DOM twin (the slot list).
   `:focus-visible` outlines, `aria-pressed` on toggles, `role="dialog"` + `aria-labelledby` on the
   part menu, `prefers-reduced-motion` disables the camera auto-orbit and all decorative animation.
9. **Do not touch** map/mission/AI/reinforcement systems except the two explicit hooks
   (`notifyGunshot` radius; damage falloff) described below.

---

## 2. FILE PLAN (create exactly these; keep existing files where noted)

```
src/game/
  economy/
    profile.ts          # PlayerProfile type, DEFAULT_PROFILE, load/save/migrate, pure reducers
    catalog.ts          # WEAPON_CATALOG + ATTACHMENT_CATALOG (data only, no three.js)
    stats.ts            # resolveWeaponStats(baseId, equippedAttachments) → ResolvedWeaponStats
    rewards.ts          # cash formulas: per-kill, headshot, streak, mission phase, extraction, grade bonus
    loadout.ts          # Loadout type, validation (2 slots), default loadout, equip/unequip reducers
  models.ts             # KEEP. Add: exported builder registry, 5 new guns, attachment mount sockets
  attachments.ts        # NEW. Procedural 3D component builders + attach/detach onto a WeaponModel
  engine.ts             # MODIFY per §6
  audio.ts              # MODIFY: add fireSCAR/fireVector/fireShotgun/fireDeagle/fireLMG + suppressed variants
src/ui/
  armory/
    Armory.tsx          # Top-level Armory screen (route from Results + from Main Menu)
    GunViewer.tsx       # three.js canvas viewer, orbit, hotspots, live attach/detach
    SlotHotspots.tsx    # DOM overlays projected from 3D sockets (pulsing markers + labels)
    PartMenu.tsx        # Slide-in panel: attachments for a clicked slot, buy/equip, stat deltas
    WeaponRail.tsx      # Horizontal weapon carousel (owned/locked/price), primary/secondary tabs
    StatBars.tsx        # Animated stat bars with ghost "delta preview" segments
    CashCounter.tsx     # Rolling-odometer cash display with +/- flashes
    armory.css          # Scoped styles (imported by index.css or Armory.tsx)
  Screens.tsx           # MODIFY: ResultsScreen gets cash breakdown + "OPEN ARMORY" CTA; MainMenu gets "ARMORY" button + loadout preview
src/App.tsx             # MODIFY: new phase 'armory', profile state, pass loadout to Engine, handle 'cash' events
tests/
  economy.test.js       # rewards + profile reducers + persistence migration
  loadout.test.js       # loadout validation, compatibility matrix, stat resolution
  catalog.test.js       # catalog integrity (ids unique, every attachment has ≥1 compatible weapon, prices > 0, descriptions non-empty, every weapon has a builder)
  attachments.test.js   # with canvas stub: every (weapon × compatible attachment) attaches without throwing, socket exists, detach restores child count
docs/armory.md          # Short player-facing + dev-facing summary of the shipped system (write it last)
```

---

## 3. DATA MODEL (pure TypeScript, `src/game/economy/*`)

### 3.1 Identifiers
```ts
export type WeaponId =
  | 'm4a1' | 'ak47' | 'm1911' | 'awm' | 'mp7'                 // existing five
  | 'scar_h' | 'vector' | 'spas12' | 'deagle' | 'm249';        // five new
export type WeaponClass = 'AR' | 'BR' | 'SMG' | 'PDW' | 'SR' | 'SG' | 'LMG' | 'PISTOL';
export type SlotId = 'primary' | 'secondary';
export type AttachSlot = 'muzzle' | 'optic' | 'magazine' | 'underbarrel' | 'stock' | 'rail' | 'barrel';
export type AttachmentId = string; // see catalog §4.3, e.g. 'muz_suppressor_556'
```

### 3.2 Catalog entries
```ts
export interface WeaponCatalogEntry {
  id: WeaponId; name: string; short: string; cls: WeaponClass; slot: SlotId;
  price: number;                 // 0 for starter weapons
  starter: boolean;              // m4a1 + m1911 only
  blurb: string;                 // 1–2 sentence flavour + role, shown on the rail card
  base: BaseWeaponStats;         // the numbers today living in engine.ts WeaponDef + new ones
  slots: AttachSlot[];           // which sockets this weapon exposes
  audio: 'm4' | 'ak' | 'pistol' | 'sniper' | 'smg' | 'scar' | 'vector' | 'shotgun' | 'deagle' | 'lmg';
  boltAction?: boolean;          // awm true → engine bolt cycle
  pump?: boolean;                // spas12 true → pump cycle between shots (0.55s)
  pellets?: number;              // spas12: 8
}
export interface BaseWeaponStats {
  auto: boolean; rpm: number; damage: number; headMul: number; limbMul: number;
  magSize: number; reserve: number; hipSpread: number; adsSpread: number;
  pattern: [number, number][]; adsFov: number; tacReload: number; emptyReload: number;
  adsTime: number;               // seconds to full ADS (new; engine currently uses a fixed lerp — expose it)
  recoilMul: number;             // 1.0 default; scales kickP/kickY
  falloffStart: number;          // metres (35 today); beyond this dmg *= falloffMul
  falloffMul: number;            // 0.85 today
  noiseRadius: number;           // metres for ai.notifyGunshot (65 today)
  moveSpeedMul: number;          // 1.0; LMG 0.92, pistols 1.05
  swapTime: number;              // seconds for switchWeapon (130 ms today → data-driven)
}
export interface AttachmentCatalogEntry {
  id: AttachmentId; slot: AttachSlot; name: string; price: number;
  compat: WeaponId[] | 'all-with-slot';
  desc: string;                  // what it does, player-facing, 1–3 sentences
  pros: string[]; cons: string[];// bullet lists shown in PartMenu
  mods: StatMods;                // §3.3
  visual: string;                // builder key in attachments.ts (e.g. 'suppressor_long')
  tier: 1 | 2 | 3;               // drives price band + rarity colour (1 white, 2 cyber, 3 acc)
}
```

### 3.3 Stat modifiers & resolution (`stats.ts`)
```ts
export interface StatMods {
  damageMul?: number; rpmMul?: number; magAdd?: number; magMul?: number; reserveAdd?: number;
  hipSpreadMul?: number; adsSpreadAdd?: number; recoilMul?: number; adsTimeMul?: number;
  adsFovDelta?: number;          // negative = more zoom
  tacReloadMul?: number; emptyReloadMul?: number; falloffStartAdd?: number; falloffMulAdd?: number;
  noiseRadiusMul?: number; moveSpeedMul?: number; swapTimeMul?: number; headMulAdd?: number;
  autoOverride?: boolean;        // e.g. binary trigger kits – NOT used in v1, but supported
  laser?: boolean;               // engine renders a laser dot + 25 % hip-spread reduction (already in hipSpreadMul)
  flashlight?: boolean;          // spotlight child of muzzle in vmScene
  scopeReticle?: 'none'|'dot'|'holo'|'acog'|'sniper'; // HUD picks the ADS reticle
}
export interface ResolvedWeaponStats extends BaseWeaponStats { reticle: StatMods['scopeReticle']; laser: boolean; flashlight: boolean; }
export function resolveWeaponStats(base: BaseWeaponStats, mods: StatMods[]): ResolvedWeaponStats;
```
Resolution rules (MUST be tested):
- Multipliers multiply (order-independent), additives add, then clamp: `magSize ≥ 1`, `rpm ≥ 30`,
  `hipSpread ≥ 0`, `adsTime ∈ [0.08, 0.9]`, `noiseRadius ≥ 4`, `damage ≥ 1`.
- `magAdd` applies before `magMul`, result rounded to nearest int.
- Only one attachment per slot. `scopeReticle` comes from the optic or `'none'`.
- Returns a *new object*; never mutates the base.
- Provide `diffStats(a, b): StatDelta[]` returning `{ key, label, before, after, betterWhenHigher }`
  for the UI delta preview (e.g. `{ key:'noiseRadius', label:'NOISE', before:65, after:22, betterWhenHigher:false }`).

### 3.4 Profile & loadout (`profile.ts`, `loadout.ts`)
```ts
export interface WeaponBuild { weapon: WeaponId; attachments: Partial<Record<AttachSlot, AttachmentId>>; }
export interface Loadout { primary: WeaponBuild; secondary: WeaponBuild; }
export interface PlayerProfile {
  v: 1; cash: number; lifetimeCash: number; missions: number; kills: number;
  ownedWeapons: WeaponId[];                                       // starts ['m4a1','m1911']
  ownedAttachments: Partial<Record<WeaponId, AttachmentId[]>>;    // ownership is PER WEAPON
  builds: Partial<Record<WeaponId, WeaponBuild>>;                 // last saved config per weapon
  loadout: Loadout;                                               // starts M4A1 / M1911, no attachments
  seenArmoryTutorial: boolean;
}
export const PROFILE_KEY = 'recoilfps.profile.v1';
export function loadProfile(storage?: Pick<Storage,'getItem'|'setItem'>): PlayerProfile; // never throws
export function saveProfile(p, storage?): void;
export function migrateProfile(raw: unknown): PlayerProfile;      // validates every id against catalog, drops unknowns
// Pure reducers (return new profile or a typed error, never mutate):
export function buyWeapon(p, id): Result<PlayerProfile>;          // errors: 'ALREADY_OWNED' | 'INSUFFICIENT_FUNDS' | 'UNKNOWN'
export function buyAttachment(p, weapon, attachment): Result<PlayerProfile>; // + 'INCOMPATIBLE' | 'WEAPON_NOT_OWNED'
export function equipAttachment(p, weapon, attachment | null, slot): Result<PlayerProfile>; // null = strip slot; error 'NOT_OWNED'
export function setLoadoutWeapon(p, slot: SlotId, weapon): Result<PlayerProfile>; // enforces slot class: pistols → secondary only, everything else → primary only
export function grantCash(p, amount, reason): PlayerProfile;
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
```
Attachment ownership is **per weapon** (buying a suppressor for the M4 does not give it to the AK) —
this is what makes cash matter. Prices for the same attachment on a different weapon are the same.

---

## 4. CONTENT — WEAPONS & ATTACHMENTS (exact catalog to ship)

### 4.1 Economy tuning (`rewards.ts`)
| Event | Cash | Notes |
|---|---|---|
| Kill (body) | **$100** | mirrors score |
| Kill (headshot) | **$150** | |
| Grenade kill | **$100** | |
| Streak bonus | **+$50 × (streak−2)** at streak ≥ 3, cap +$250 | reuse the existing `'streak'` event trigger |
| Mission phase complete | **$250** | hook where `'objective'` events fire on completion |
| Extraction (win) | **$1,000** | |
| Grade bonus | S **$750** / A **$500** / B **$250** / C **$100** / D **$0** | computed from the same `gradeFor()` logic in `Screens.tsx` — **move `gradeFor` into `rewards.ts` and import it back into Screens** |
| Loss consolation | 35 % of in-run earnings retained? **No** — keep 100 % of earned cash on loss; the loss just forfeits extraction + grade bonus. | |
| Difficulty multiplier | recruit ×0.8, regular ×1.0, veteran ×1.25, (whatever the existing `settings.difficulty` ids are — read them) | applied to the *total* at debrief |

Target curve: a competent first run (≈15 kills, win, B grade) yields **≈ $3,900** → enough for the
first attachment or two, or most of a mid-tier gun by run two. Total catalog value should be
≈ $55,000–65,000 so a full unlock takes ~15–20 good runs.

### 4.2 Weapon catalog (10 weapons)
Existing five keep their current numbers as `base` (copy them out of `engine.ts` exactly), plus the
new fields: `adsTime` 0.22 (M4) / 0.25 (AK) / 0.16 (1911) / 0.42 (AWM) / 0.18 (MP7); `recoilMul` 1;
`falloffStart` 35; `falloffMul` 0.85; `noiseRadius` 65 (55 for MP7, 50 for 1911, 90 for AWM);
`moveSpeedMul` 1 (1.05 pistol, 0.96 AWM); `swapTime` 0.13.

| id | Name | Class | Slot | Price | Role & feel | Key base stats |
|---|---|---|---|---|---|---|
| `m4a1` | M4A1 SOPMOD | AR | primary | **starter** | all-rounder | existing |
| `m1911` | M1911 .45 | PISTOL | secondary | **starter** | existing | existing |
| `mp7` | MP7A1 PDW | PDW | primary | **$2,400** | cheap first buy, CQB | existing |
| `ak47` | AK-47 TACTICAL | AR | primary | **$3,800** | hard-hitting | existing |
| `vector` | KRISS VECTOR .45 | SMG | primary | **$4,600** | 1,100 rpm laser, weak per shot, huge recoil-control fantasy | auto, rpm 1100, dmg 24, head 2.0, limb 0.85, mag 25, reserve 175, hip 0.011, adsFov 62, tac 2.0, empty 2.5, adsTime 0.17, recoilMul 0.7, falloffStart 22, noise 58 |
| `spas12` | SPAS-12 COMBAT | SG | primary | **$5,200** | pump, 8 pellets × 14 dmg, devastating ≤ 12 m | semi (pump 0.55 s), rpm 80, dmg 14/pellet, head 1.6, limb 0.9, mag 8, reserve 40, hipSpread 0.045 (pellet cone; ADS cone 0.028 — **shotgun ignores the "ADS = 0 spread" rule**), adsFov 66, tac 3.2 (shell-by-shell: reload time scales with missing shells, 0.4 s each, interruptible by firing), adsTime 0.24, falloffStart 12, falloffMul 0.45, noise 80 |
| `scar_h` | SCAR-H 7.62 | BR | primary | **$6,400** | 2-tap battle rifle, slow, accurate, heavy recoil | auto, rpm 600, dmg 52, head 2.4, limb 0.85, mag 20, reserve 100, hip 0.010, adsFov 55, tac 2.3, empty 2.9, adsTime 0.26, recoilMul 1.35, falloffStart 45, falloffMul 0.9, noise 75 |
| `deagle` | DESERT EAGLE .50 | PISTOL | secondary | **$3,200** | hand cannon, 2-shot body kill, brutal kick | semi, rpm 240, dmg 62, head 2.8, limb 0.8, mag 7, reserve 35, hip 0.009, adsFov 64, tac 1.7, empty 2.0, adsTime 0.19, recoilMul 1.8, falloffStart 30, noise 85, moveSpeedMul 1.03 |
| `awm` | AWM .338 SNIPER | SR | primary | **$7,800** | existing | existing |
| `m249` | M249 SAW | LMG | primary | **$8,600** | 100-round belt, suppressive, slow everything | auto, rpm 800, dmg 36, head 2.2, limb 0.85, mag 100, reserve 200, hip 0.016 (hip bloom grows with sustained fire: +0.0006/shot to max +0.012, decays 0.03/s), adsFov 60, tac 5.4, empty 5.4 (belt reload is always the long one), adsTime 0.40, recoilMul 1.15, falloffStart 40, noise 80, moveSpeedMul 0.92, swapTime 0.32 |

Total weapon value: **$42,000**.

### 4.3 Attachment catalog (ship ALL of these — 27 attachments across 7 slots)
`compat` uses class shorthand here; expand to explicit `WeaponId[]` in code. Prices are per weapon.

**MUZZLE** (`muzzle`) — every weapon has this slot.
| id | Name | Price | Compat | Effect (mods) | Visual key |
|---|---|---|---|---|---|
| `muz_flash_hider` | Flash Hider | $350 | all | Muzzle flash sprite scale ×0.35, `noiseRadiusMul` 0.9. **No downside.** | `flash_hider` (3-prong steel) |
| `muz_compensator` | Compensator | $650 | all except SG | `recoilMul` 0.8 (horizontal component ×0.65), `noiseRadiusMul` 1.15 | `compensator` (ported cylinder, side vents) |
| `muz_suppressor` | Tactical Suppressor | $1,100 | AR, BR, SMG, PDW, PISTOL | `noiseRadiusMul` 0.3, `damageMul` 0.92, `falloffStartAdd` −8, `adsTimeMul` 1.08, muzzle flash ×0.15, suppressed fire audio variant, hides kill-feed direction pings for enemies beyond 20 m (they don't get `hear()`) | `suppressor_long` (long matte can w/ knurled ring) |
| `muz_suppressor_sr` | .338 Sound Moderator | $1,600 | SR | as above but `damageMul` 0.95 | `suppressor_fat` |
| `muz_brake_heavy` | Heavy Muzzle Brake | $900 | BR, SR, LMG, PISTOL(deagle only) | `recoilMul` 0.7, `noiseRadiusMul` 1.3, flash ×1.4 | `brake_heavy` (2-chamber, like the AWM's existing brake) |
| `muz_duckbill` | Duckbill Choke | $700 | SG | pellet cone becomes horizontal ellipse (spread x ×1.6, y ×0.5) | `duckbill` |
| `muz_full_choke` | Full Choke | $800 | SG | hip/ADS cone ×0.7, `falloffStartAdd` +4 | `choke` (short threaded collar) |

**OPTIC** (`optic`) — all except `m1911`/`deagle` (pistols use `rail` for a mini red-dot instead).
| id | Name | Price | Compat | Effect | Visual |
|---|---|---|---|---|---|
| `opt_reddot` | RMR Red Dot | $600 | AR, BR, SMG, PDW, SG, LMG | `scopeReticle:'dot'`, `adsTimeMul` 0.95, `adsFovDelta` 0 | `reddot` (small housing + emissive tritium dot) |
| `opt_holo` | EOTech Holo | $900 | AR, BR, SMG, PDW, SG, LMG | `'holo'` ring reticle, `adsTimeMul` 0.97, `hipSpreadMul` 0.95 | `holo` (rectangular hood, glass) |
| `opt_acog` | ACOG 4× | $1,400 | AR, BR, LMG | `'acog'` chevron, `adsFovDelta` −22, `adsTimeMul` 1.2, `falloffStartAdd` +10 | `acog` (fibre-optic tube, chunky) |
| `opt_hybrid` | LPVO 1–6× | $1,900 | AR, BR | `'acog'`, `adsFovDelta` −14, `adsTimeMul` 1.1; **tap the ADS toggle key (`T`) while scoped to cycle 1×/6×** (adsFovDelta 0 ↔ −30) | `lpvo` (long tube, two rings) |
| `opt_sniper_hp` | High-Power 12× | $2,200 | SR | `adsFovDelta` −8 vs the AWM's own scope, sway ×0.7 while crouched | `scope_hp` (replaces the built-in scope tube — see §5.4) |
| `opt_pistol_rmr` | Slide-Mount Micro Dot | $700 | PISTOL | `'dot'`, `adsTimeMul` 0.92 | `pistol_rmr` (mounted on slide rear) — *slot is `optic` on pistols too; just no iron-sight removal needed* |

**MAGAZINE** (`magazine`) — all.
| id | Name | Price | Compat | Effect | Visual |
|---|---|---|---|---|---|
| `mag_extended` | Extended Mag | $800 | AR, BR, SMG, PDW, PISTOL | `magMul` 1.5 (M4 30→45, SCAR 20→30, 1911 8→12, Deagle 7→10), `reserveAdd` +30, `tacReloadMul` 1.12, `adsTimeMul` 1.04, `moveSpeedMul` 0.99 | `mag_ext` (taller mag, same width) |
| `mag_drum` | Drum Magazine | $1,800 | AR, SMG (vector) | `magMul` 2.5 (M4 75, AK 75, Vector 62), `tacReloadMul` 1.45, `emptyReloadMul` 1.4, `adsTimeMul` 1.12, `moveSpeedMul` 0.97 | `mag_drum` (cylinder drum under receiver) |
| `mag_fast` | Fast Mag (Coupled) | $950 | AR, SMG, PDW, PISTOL | `tacReloadMul` 0.72, `emptyReloadMul` 0.8, no size change | `mag_coupled` (two mags side-by-side, clamp) |
| `mag_shell_tube` | Extended Tube (+4) | $900 | SG | `magAdd` +4 | `shell_tube` (longer tube under barrel) |
| `mag_belt_box` | 200-Round Soft Pack | $1,700 | LMG | `magMul` 2, `emptyReloadMul` 1.35, `moveSpeedMul` 0.96 | `belt_box_large` |
| `mag_sr_10` | 10-Round Detachable Box | $1,000 | SR | `magMul` 2 (5→10), `tacReloadMul` 1.1 | `mag_box_sr` |

**UNDERBARREL** (`underbarrel`) — AR, BR, SMG, PDW, SG, LMG.
| id | Name | Price | Effect | Visual |
|---|---|---|---|---|
| `ub_vert_grip` | Vertical Grip | $500 | `recoilMul` 0.88 (vertical), `hipSpreadMul` 1.05 | `vgrip` |
| `ub_angled_grip` | Angled Foregrip | $650 | `adsTimeMul` 0.85, `recoilMul` 0.96 | `agrip` |
| `ub_bipod` | Bipod | $750 (BR, SR, LMG only) | when **crouched and stationary**: `recoilMul` 0.5, `hipSpreadMul` 0.5; otherwise `adsTimeMul` 1.06, `moveSpeedMul` 0.98. Engine exposes `bipodDeployed` in HudState; legs visibly fold down in the viewmodel when deployed. | `bipod` (two folding legs; animate rotation on deploy) |
| `ub_shotgun_m26` | Masterkey Breacher | $2,400 (AR only: m4a1, scar_h) | **Secondary fire on key `B`**: 1 shell of 8 × 12 dmg pellets, 3-shell tube, 3.5 s reload, uses its own ammo pool; mounts a mini shotgun under the handguard. | `masterkey` |

**STOCK** (`stock`) — AR, BR, SMG, PDW, SG, LMG.
| id | Name | Price | Effect | Visual |
|---|---|---|---|---|
| `stk_none` | No Stock (Stripped) | $400 | `moveSpeedMul` 1.05, `adsTimeMul` 0.85, `swapTimeMul` 0.8, `recoilMul` 1.3, `hipSpreadMul` 1.15 | *removes* the stock group |
| `stk_heavy` | Precision Heavy Stock | $850 | `recoilMul` 0.82, `adsTimeMul` 1.1, `moveSpeedMul` 0.98, sway ×0.8 | `stock_heavy` (skeletonised with cheek riser) |
| `stk_folding` | Side-Folding Stock | $700 | `swapTimeMul` 0.75, `adsTimeMul` 0.92, `recoilMul` 1.08 | `stock_folding` (hinged, thin tube) |

**RAIL** (`rail`) — side/bottom accessory; all weapons.
| id | Name | Price | Effect | Visual |
|---|---|---|---|---|
| `rail_laser` | Tactical Laser (Red) | $600 | `laser:true`, `hipSpreadMul` 0.75; **visible red dot in the world** where the muzzle ray lands (small emissive sprite raycast every frame, cheap); enemies within 30 m facing you can spot the laser → +15 % detection speed | `laser_box` + beam sprite |
| `rail_flashlight` | Weapon Light | $450 | `flashlight:true` spotlight (angle 0.35, intensity 6, distance 28) child of `muzzle` in main scene; enemies illuminated inside cone at ≤ 10 m get a 0.6 s stun (reuse the existing flash mechanic at reduced power) | `light_box` |
| `rail_canted` | 45° Canted Irons | $550 (AR, BR only) | when an ACOG/LPVO is equipped, holding `T`+ADS uses canted irons at 1× with `adsTimeMul` 0.7 for that ADS | `canted_irons` |

**BARREL** (`barrel`) — AR, BR, SMG, LMG, PISTOL.
| id | Name | Price | Effect | Visual |
|---|---|---|---|---|
| `brl_long` | Long Barrel | $1,000 | `falloffStartAdd` +15, `damageMul` 1.04, `adsTimeMul` 1.1, `moveSpeedMul` 0.98 | extends barrel & handguard; muzzle socket moves forward |
| `brl_short` | CQB Short Barrel | $900 | `adsTimeMul` 0.85, `swapTimeMul` 0.85, `moveSpeedMul` 1.03, `falloffStartAdd` −10, `hipSpreadMul` 1.1 | shortens barrel; muzzle socket moves back |
| `brl_ported` | Ported Slide/Barrel | $750 (PISTOL only) | `recoilMul` 0.8, muzzle flash ×1.3 | `ported_slide` |

Total attachment catalog value (unique) ≈ $27k; per-weapon ownership multiplies this, which is the
intended long tail. Every attachment MUST have `desc`, `pros[]`, `cons[]` written in the game's
terse tactical voice (e.g. *"Baffle-stack can. Kills the report and the flash — hostiles past 20 m
won't hear the shot. Costs you a little velocity."*).

---

## 5. 3D — NEW GUN MODELS, SOCKETS & ATTACHMENT GEOMETRY

### 5.1 Five new gun builders in `models.ts` (match existing quality bar)
Each is a `buildX(): WeaponModel` of **≥ 70 primitive calls**, same coordinate conventions (barrel
along −Z, grip near origin, muzzle `Object3D` at the bore end, `sightY` at the iron-sight plane),
uses the `WM` palette plus **at most two new materials per gun**, calls `attachArms` with sensible
anchors, and populates `adsHidden` for in-model sights so the HUD reticle owns ADS. Required
silhouette details (this is what "high quality, fits the existing style" means here):

- **`buildSCARH`**: tan upper (`WM.tan` + new `WM.fde` #9B7E55), monolithic top rail with 14 rail
  slats, side-folding polymer stock with cheek riser, reciprocating charging handle on left,
  long 16" barrel with 3-prong hider, 20-rd straight steel mag, angled trigger guard, flip-up irons.
- **`buildVector`**: Super-V block *below* the bore (the body drops behind the grip), squared
  polymer shell, short 5.5" barrel with threaded muzzle, top rail, glock-style 25-rd mag inserted in
  the grip, folding stock, 3-slot rail on the side.
- **`buildSPAS12`**: dual-tone black, distinctive **perforated barrel shroud** (cylinder with 6 rows
  of holes = small dark cylinders inset), pump forend (this is the animated `mag` object — reload
  keyframes insert shells at the loading port; the *pump* slides on fire), folding hook stock,
  tube magazine under barrel, brass shell visible in port.
- **`buildDeagle`**: massive triangular slide with flat top, polygonal barrel with rail atop,
  exposed hammer, gas piston bulge under the barrel, thick grip, brushed `WM.steel` with a
  new `WM.chrome` (metalness 1, roughness 0.15) slide. Slide MUST reciprocate on fire (reuse the
  1911's slide animation if it exists; otherwise implement `slide` as `chargingHandle`).
- **`buildM249`**: box belt container hanging under receiver (this is `mag`), top feed cover that
  hinges open on reload (animate `chargingHandle` rotation via existing reload timeline), quick-change
  barrel with carry handle, bipod folded under the gas tube (this is the *fixed* one; the attachment
  bipod replaces it), skeletal stock, 150 mm heat shield with slots.

Every builder is registered in an exported map:
```ts
export const WEAPON_BUILDERS: Record<WeaponId, () => WeaponModel> = { m4a1: buildM4, ak47: buildAK47, m1911: buildM1911, awm: buildAWM, mp7: buildMP7, scar_h: buildSCARH, vector: buildVector, spas12: buildSPAS12, deagle: buildDeagle, m249: buildM249 };
```

### 5.2 Sockets — extend `WeaponModel`
```ts
export interface WeaponModel {
  …existing…
  sockets: Partial<Record<AttachSlot, THREE.Object3D>>;   // empty Object3D, positioned+rotated where the part mounts
  removable: Partial<Record<AttachSlot, THREE.Object3D[]>>;// stock meshes hidden when a replacement is equipped (e.g. default stock, default mag, default iron sights, AWM scope, fixed bipod)
  attached: Partial<Record<AttachSlot, THREE.Object3D>>;   // currently mounted component (runtime)
}
```
Every one of the 10 builders MUST define sockets for every slot in its catalog `slots[]`. Conventions:
- `muzzle` socket at the bore end, +Z of socket faces the shooter (parts extend along −Z from it).
- `optic` socket on the top rail centre, its `y` = rail top. Optic builders place their lens axis at
  `sightY + optic.heightOffset` and the engine MUST use the **resolved sightY** (`model.sightY +
  (attached.optic?.userData.sightYOffset ?? 0)`) for ADS alignment so the sight picture stays on axis.
- `magazine` socket at the magwell; the *default* mag mesh is listed in `removable.magazine` and the
  attached mag replaces `model.mag` for the reload animation (engine must read `model.mag` each frame,
  not cache it).
- `underbarrel` socket bottom of handguard, `rail` socket left side of handguard (right for pistols'
  under-dust-cover rail), `stock` socket at receiver rear, `barrel` socket at barrel root (barrel
  attachments scale/translate the barrel meshes and **re-position the muzzle socket + `model.muzzle`**).

### 5.3 Attachment builders — `src/game/attachments.ts`
```ts
export type AttachmentBuilder = (ctx: { weapon: WeaponId; model: WeaponModel; cls: WeaponClass }) => THREE.Object3D;
export const ATTACHMENT_BUILDERS: Record<string /*visual key*/, AttachmentBuilder>;
export function attach(model: WeaponModel, entry: AttachmentCatalogEntry, weapon: WeaponId): void; // idempotent per slot; detaches previous; hides removable[]
export function detach(model: WeaponModel, slot: AttachSlot): void;                                  // restores removable[], disposes built geometry (not shared materials)
export function applyBuild(model: WeaponModel, build: WeaponBuild): void;                             // detach all → attach each
```
Each builder uses `GunBuilder` and merges into ≤ 2 meshes. Builders may inspect `ctx.cls` to scale
(a suppressor on the Vector is shorter/thinner than on the SCAR: scale factor from a per-class
table, not per-weapon hacks). Visual details required: knurling rings on suppressors (thin torus
rows), emissive dots on red-dot/holo (`WM.tritium` / `WM.reticle`, added to `adsHidden` so the HUD
reticle takes over), glass discs on scopes (`WM.glass`), drum mag with ribbed edges, bipod legs as
two child pivots (`userData.legs`) that the engine rotates when `bipodDeployed`.

**Attachment tests (`tests/attachments.test.js`)**: with `installCanvasStub()`, for every weapon ×
every compatible attachment: `attach` does not throw, `model.sockets[slot]` exists, child count
increases, `detach` restores the exact previous child count and `removable[]` visibility, and
`applyBuild` with a full build then an empty build leaves the group identical in child count.

### 5.4 Removal semantics
- Optics on AR/BR/SMG/PDW/SG/LMG hide the built-in rear/front iron sight meshes (`removable.optic`).
- `opt_sniper_hp` hides the AWM's stock scope group (already `optic` in the model) and mounts a
  larger tube; `adsHidden` must include the new lens.
- `stk_none` hides `removable.stock` and mounts nothing (the builder returns an empty group).
- Barrel attachments hide `removable.barrel` (the default barrel tube + gas block) and add a
  longer/shorter one; they call `model.muzzle.position.z = socketZ` so muzzle flash and tracers
  originate correctly, and `sockets.muzzle` moves with it (so a suppressor re-attaches at the new
  end — `applyBuild` MUST apply `barrel` before `muzzle`).

---

## 6. ENGINE INTEGRATION (`src/game/engine.ts`)

### 6.1 Construction
```ts
constructor(canvas, difficulty, onEvent, mapId: MapId = 'alrasul', loadout: Loadout = DEFAULT_LOADOUT)
```
- Build exactly two `WeaponDef`s from the loadout: `[primary, secondary]`. `WeaponDef` becomes
  `{ id: WeaponId; name; model; stats: ResolvedWeaponStats; audio; boltAction; pump; pellets; masterkey?: {...} }`
  and **all** fire/reload/ADS code reads from `def().stats`. Delete the hard-coded five-weapon array.
- `applyBuild(model, build)` before adding to `vmScene`.
- Ammo pools: `mags[]`/`reserves[]` sized from resolved `magSize`/`reserve`.

### 6.2 Input
- `Digit1` → primary, `Digit2` → secondary, `KeyQ` → quick swap (toggle). Remove `Digit3–5`. Update
  the on-screen key hints in the HUD / pause screen if they list 1–5.
- `KeyB` → Masterkey fire when equipped (respects reload/ADS/sprint the same as primary fire).
- `KeyT` while ADS → LPVO zoom toggle / canted irons (when those attachments are equipped). Do not
  collide with existing bindings (audit `onKey` first; if `T` is taken, use `V` and document it).

### 6.3 Ballistics & feel (replace every literal with the resolved stat)
- `60 / d.rpm` → `60 / stats.rpm`; recoil `kickP = pat[0] * 0.0052 * adsRecoilReduction * stats.recoilMul`
  (compensator's horizontal-only reduction: multiply `kickY` by an extra 0.65 when `muz_compensator` is
  equipped — put a `recoilYawMul` in `StatMods` rather than special-casing the id).
- Falloff: `if (h.distance > stats.falloffStart) dmg *= stats.falloffMul`.
- Hearing: `this.ai.notifyGunshot(this.pos, stats.noiseRadius)`.
- ADS: replace the fixed lerp constant with `dt / stats.adsTime`. FOV: `stats.adsFov + (lpvoHigh ? −30 : 0)`.
- Move speed: multiply the player's walk/sprint speed by `stats.moveSpeedMul` of the *held* weapon.
- Swap: `setTimeout(…, stats.swapTime * 1000)` and the viewmodel lower/raise animation duration
  follows it.
- **Shotgun**: fire `pellets` rays in a cone of `hipSpread`/`adsSpread` (ADS still applies a cone —
  do NOT zero it for `pellets > 1`), sum damage per enemy per shot, one hitmarker, one `'hit'` event
  with `kill` if any pellet killed. Pump: after each shot `pumpT = 0.55`, animate `model.mag` (the
  forend) back/forward, block fire until done, play `audio.pump()`. Shell-by-shell reload: loop
  0.4 s per shell, cancel on LMB.
- **Bipod**: `bipodDeployed = crouched && !moving && hasBipod`; drives multipliers + leg animation.
- **LMG bloom**: implement per §4.2.
- **Laser**: each frame if `stats.laser`, raycast from muzzle along camera forward against
  `hittables`, place an additive sprite (size 0.03, colour `#FF2A2A`) at the hit point; hide in ADS
  > 0.5. Use the existing raycaster; skip when the pointer is unlocked.
- **Flashlight**: a `THREE.SpotLight` parented to the *world-space* muzzle proxy (the vm scene is
  separate — compute the muzzle world position each frame and copy it). Toggle with the existing
  flashlight key if one exists; otherwise always on when equipped.
- **Suppressed audio**: `audio.fire(def.audio, suppressed: boolean)` — a single dispatcher replaces
  the `if (this.cur === n)` ladder. Add procedural variants: suppressed = low-passed at 1.8 kHz,
  shorter decay, +click transient. New signatures: `scar` (deeper M4), `vector` (fast dry snap),
  `shotgun` (broadband boom 90 ms + mechanical pump), `deagle` (huge low thump + long ring),
  `lmg` (AK-ish with metallic link rattle). Add `pump()`, `shellInsert()`, `beltCoverOpen()`, `beltCoverClose()`.
- **Muzzle flash**: `this.muzzleFlash.scale *= stats.flashMul` (add `flashMul` to StatMods/resolved, default 1).
- Bolt-action: `if (def.boltAction) { this.boltCycle = 1.25; this.rmb = false; }`.

### 6.4 Cash accounting during a run
Engine tracks `cashEarned` and a `cashLog: { reason: string; amount: number; t: number }[]`. Award
per §4.1 at the same places score is awarded. Do **not** persist from the engine — it only reports.

### 6.5 Events
Add `{ type: 'cash'; amount: number; reason: string; total: number }` (fired on each award so the
HUD can pop it) and extend `'end'` with `cash: number; cashLog: CashLogEntry[]; difficultyMul: number`.

### 6.6 HUD
`HudState` gains `cash: number; secondaryWeapon: string; heldSlot: 'primary'|'secondary';
bipodDeployed: boolean; masterkey?: { shells: number; reloading: boolean }; reticle: StatMods['scopeReticle'];
lpvoHigh: boolean; pumping: boolean`. `Hud.tsx`: show the cash counter (top-right, mono, `--volt`,
brief `+$150` pop on award, reuse `scorePops` machinery), draw the ADS reticle by `reticle`
(`dot` = 2 px dot; `holo` = 68 MOA ring + 1 MOA dot; `acog` = chevron with BDC ticks; `sniper` =
existing scope overlay), and show a small weapon card with primary/secondary names, held one highlighted.

---

## 7. THE ARMORY — UI/UX SPEC (`src/ui/armory/*`)

### 7.1 Navigation & flow
- New app phase `'armory'`. Entry points: **`ResultsScreen` → "OPEN ARMORY" primary CTA** (replaces
  nothing; sits beside REDEPLOY/MENU, becomes the *primary* button), and **`MainMenu` → "ARMORY"**
  button next to DEPLOY. Exit: "DEPLOY" (goes straight to `deploy()` with the saved loadout) or
  "BACK".
- `ResultsScreen` gains a **CASH EARNED** card: rolling odometer of the run's cash, then an
  itemised breakdown list (kills, headshots, streaks, phases, extraction, grade bonus, difficulty
  multiplier) with staggered fade-in (80 ms apart), and finally "WALLET: $X → $Y" tween. Props:
  `ResultsScreen({ r, profile, onRedeploy, onMenu, onArmory })`. `Results` type gains `cash`,
  `cashLog`, `difficultyMul`.
- First open ever (`!profile.seenArmoryTutorial`): 3-step coach-marks (rail → gun hotspot → part
  menu), dismiss on any click; set flag.

### 7.2 Layout (1920×1080 reference, fluid down to 1280×720)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ARMORY  ///  LOADOUT TERMINAL             WALLET $12,450   [BACK] [DEPLOY]  │ ← header, cash odometer, brackets
├──────────────┬──────────────────────────────────────────────┬────────────────┤
│ PRIMARY ▸    │                                              │  STAT PANEL    │
│ SECONDARY    │        3D GUN (GunViewer, full bleed)        │  DAMAGE ████░  │
│              │   ● muzzle   ● optic   ● mag  ● grip …       │  RPM    ██████ │
│ WEAPON RAIL  │   (pulsing hotspots projected from sockets)  │  RANGE  ███░░  │
│ [M4A1 ✓]     │                                              │  CONTROL██░░░  │
│ [AK-47 $3.8k]│                                              │  HANDLING███░  │
│ [SCAR-H  🔒] │                                              │  NOISE  ██░░░  │
│ …            │                                              │  MAG    30     │
├──────────────┴──────────────────────────────────────────────┴────────────────┤
│  EQUIPPED: FLASH HIDER · RMR · EXT MAG · —  · —  · LASER · —      (slot chips)│
└──────────────────────────────────────────────────────────────────────────────┘
       ↳ clicking a hotspot/chip slides PartMenu in from the right over the stat panel
```
- **Background**: `--bg` with the existing hex-grid, plus a slow-drifting radial glow behind the gun
  in `--acc` at 8 % (CSS only). A subtle floor grid in the 3D scene (`GridHelper`, 20×20, colours
  `#12202A`/`#0B1218`) fading with fog.
- **Header** re-uses `.panel` + `.brk-*` brackets. WALLET uses `CashCounter` (odometer digits roll
  individually, `--volt`; on spend it flashes `--danger` and rolls down).
- **Weapon rail** (left, 280 px): tabs PRIMARY / SECONDARY. Cards: thumbnail = live-rendered
  128×64 snapshot of that gun (render once per gun with an offscreen camera on mount into a
  `dataURL` cache — 10 renders, cheap), name, class tag, price or ✓ OWNED, lock icon; selected card
  has the orange left bar + glow; locked cards are desaturated with a hazard-stripe corner. Hover
  scales 1.02 with `transform` only. Keyboard: ↑/↓ to move, Enter to select/buy.
- **Stat panel** (right, 300 px): 7 bars (`StatBars`): DAMAGE, FIRE RATE, RANGE, CONTROL (inverse
  recoil), HANDLING (inverse adsTime+swap), NOISE (inverse), MOBILITY; plus numeric readouts MAG /
  RESERVE / RELOAD. Bars animate width via `transform: scaleX` (not `width`). While hovering an
  attachment in the PartMenu, each bar shows a **ghost delta segment** (green for improvement, red
  for regression) and the numeric readouts show `30 → 45`. Normalisation constants live in
  `stats.ts` (`STAT_BAR_RANGES`) so tests can pin them.
- **Equipped chips** row (bottom): one chip per slot the weapon supports; empty slots read `—`;
  click = same as clicking the hotspot.

### 7.3 GunViewer (three.js)
- Own `WebGLRenderer` (`antialias:true`, `alpha:true`, pixelRatio ≤ 2), `PerspectiveCamera` fov 32,
  `ACESFilmicToneMapping`, exposure 1.05. Lighting: key `DirectionalLight` (1.6, warm 0xFFE2C0,
  castShadow 1024), rim `DirectionalLight` from behind-left (0.9, `--cyber` tint 0x58BFE4), fill
  `HemisphereLight` 0.35, plus an `Environment`-like reflection: build a tiny procedural PMREM from
  a 6-colour gradient cube (no HDR file) so `WM.steel`/`WM.chrome` actually reflect.
- Gun is a fresh `WEAPON_BUILDERS[id]()` per selection, **with arms removed** (`lArm` and the right
  arm group set `visible=false` — expose `armsGroup` on `WeaponModel` or tag arm groups with
  `userData.arm = true` so the viewer can hide them), scaled to fit a bounding sphere of radius 0.42
  units, centred on its bbox centre.
- Idle: slow auto-orbit (0.15 rad/s) that pauses for 4 s after user input; drag to orbit (yaw
  unlimited, pitch ±35°), wheel to zoom (0.7×–1.6×), damping 0.12. Implement a tiny orbit controller
  by hand (do not import `OrbitControls`, it fights the hotspot picking) — 60 lines max.
- **Weapon switch transition**: current gun slides out −X with a 180 ms opacity fade (materials
  cloned per viewer so `transparent` toggling doesn't leak into the game's shared `WM`), new gun slides
  in from +X with a 220 ms ease-out overshoot, plus a "scanline" sweep — a thin additive plane that
  moves along the gun's length once (`--cyber`). Play `audio.uiSwap()` (new short synth tick).
- **Hotspots** (`SlotHotspots.tsx`): for each `sockets[slot]`, project its world position to
  screen each frame (`Vector3.project`), render a DOM marker: 14 px ring, pulsing 1.6 s, colour
  `--cyber` empty / `--volt` equipped / `--acc` when it's the open slot; label appears on hover
  (`MUZZLE`, `OPTIC`, …) with a 1 px leader line to the marker. Occlusion: raycast from camera to
  socket; if a gun mesh is hit first with distance < socketDistance − 0.02, dim marker to 35 %.
  Clicking a marker opens `PartMenu` for that slot. Clicking the gun mesh itself also works: raycast
  against the gun, pick the **nearest socket** to the hit point (max 0.12 units) — this makes "click the
  silencer to change the silencer" work naturally.
- **Live attach**: on equip, call `attach()` on the *viewer's* model instantly, then animate the new
  part: it starts at `socket + 0.12` along its mount normal at scale 0.85 and eases into place over
  260 ms (`easeOutBack`) with a brief emissive flash (clone material, lerp `emissive` from
  `--acc` to black over 400 ms). On unequip play the reverse (ease-in, 180 ms) *then* `detach()`.
  Camera does a gentle 12° "look-at-slot" nudge toward the socket while the menu is open, returning
  on close. Play `audio.uiEquip()` (metallic click) / `audio.uiBuy()` (two-tone confirm) /
  `audio.uiDeny()` (buzz) — all procedural.
- Also reflect changes to the *stats* immediately (the viewer's `WeaponModel` and the resolved stats
  both derive from the same `WeaponBuild` in React state; no dual source of truth).

### 7.4 PartMenu
- Slides in from the right (transform, 220 ms), `role="dialog"`, title `SLOT // MUZZLE`, close
  button + `Esc`. Lists every catalog attachment for this slot compatible with the weapon, in tier
  order, plus a first row **"NONE / STRIPPED"** (equip null).
- Each row: name, tier colour bar, price or OWNED/EQUIPPED, one-line `desc`; expanding (click or ▸)
  reveals `pros`/`cons` lists and a 3-line detailed description. Hover → stat ghost deltas in the
  StatPanel. Row buttons: **BUY $X** (disabled + tooltip "INSUFFICIENT FUNDS — need $Y more" when
  short; button shows a red shake animation on click while disabled), **EQUIP**, **UNEQUIP**.
- Buying auto-equips. Confirmation for tier-3 purchases (≥ $1,500): inline "CONFIRM $X?" state on
  the same button for 3 s rather than a modal.
- Money changes go through the pure reducers; the UI never mutates the profile directly. Persist
  after every successful reducer call (`saveProfile`).

### 7.5 Weapon purchase & loadout
- Selecting a locked weapon shows it in the viewer with a **hologram material** (clone geometry into a
  `MeshBasicMaterial({ color: 0x58BFE4, wireframe:false, transparent:true, opacity:0.28 })` overlay +
  a slow vertical scan band in the shader via `onBeforeCompile` — or, simpler and acceptable, an
  additive wireframe duplicate) and the stat panel shows real numbers; a large **PURCHASE $X** button
  appears over the bottom chips. Buying plays the equip flash across the whole gun and swaps to
  solid materials.
- Selecting an owned weapon in the active tab sets it as that slot's loadout weapon immediately (the
  rail card gets an "EQUIPPED" tag). Class rules enforced via `setLoadoutWeapon`.
- Each weapon remembers its own build (`profile.builds[weapon]`); switching weapons never loses
  attachments.

### 7.6 Motion & polish checklist (all MUST be present)
- Header brackets draw-in on mount (existing `.brk-*` with a `scaleX/scaleY` keyframe).
- Rail cards stagger in 40 ms apart (`translateY(8px)→0`, opacity).
- Stat bars fill from 0 on first mount and tween on changes (`transition: transform 320ms cubic-bezier(.2,.8,.2,1)`).
- Cash odometer: per-digit vertical roll, 380 ms, `--volt`; spend flashes `--danger`.
- Hotspot rings pulse; the hovered one shows the leader line + label; open one turns `--acc` and stops pulsing.
- Part equip: fly-in + emissive flash + camera nudge + click SFX.
- Locked weapons: hologram overlay + scan band.
- `prefers-reduced-motion`: no auto-orbit, no pulses, no fly-in (parts just appear), no odometer roll.
- Every state has an empty/disabled treatment (no attachments compatible → "NO COMPATIBLE PARTS"; $0 wallet → buy buttons disabled with tooltip).

---

## 8. APP WIRING (`src/App.tsx`)
- `profile` state initialised lazily from `loadProfile()` inside `useEffect` (SSR-safe default =
  `DEFAULT_PROFILE`, then hydrate).
- `deploy()` passes `profile.loadout` to `new Engine(...)`.
- On `'cash'` events: push a HUD pop (`fx.cashPops` or reuse `scorePops` with a `$` prefix flag).
- On `'end'`: compute `earned = Math.round(r.cash * difficultyMul)`, `grantCash(profile, earned,
  'MISSION')`, bump `missions`/`kills`/`lifetimeCash`, save, then `setResults` with both the
  pre- and post-wallet numbers so the Results card can tween.
- Phase `'armory'` renders `<Armory profile setProfile onDeploy onBack />`. Entering the Armory from
  Results disposes the engine (same as `quit()`), because the viewer needs the GPU.
- Add a hidden dev affordance for testing balance: URL hash `#cash=50000` on the menu grants that
  wallet once (only when `import.meta.env.DEV`). Do not ship a visible cheat button.

---

## 9. TESTS YOU MUST ADD (Node, no browser)
1. `tests/catalog.test.js` — unique ids; every attachment's `compat` resolves to ≥ 1 weapon that
   lists that slot; every weapon in `WEAPON_CATALOG` has a builder in `WEAPON_BUILDERS`; prices > 0
   for non-starters; starters are exactly `m4a1` + `m1911`; total catalog value between $60k and $75k
   (weapons + unique attachments); all `desc/pros/cons` non-empty; pistols are `secondary`, everything
   else `primary`.
2. `tests/economy.test.js` — `rewardFor` table matches §4.1; `gradeFor` unchanged for existing
   inputs (pin S/A/B/C/D thresholds); `grantCash` immutability; `buyWeapon` insufficient funds path;
   per-weapon attachment ownership (buying for M4 does not own for AK); `migrateProfile` drops
   unknown ids and repairs an invalid loadout (e.g. pistol in primary → reset to defaults) without
   throwing on `undefined`, `'{}'`, `'garbage'`, and a v0-shaped object.
3. `tests/loadout.test.js` — `resolveWeaponStats` order independence, clamps, `magAdd` before
   `magMul`, ext-mag M4 = 45 / 1911 = 12 / SCAR = 30, drum M4 = 75, suppressor noise 65 → 19.5,
   `diffStats` labels; `stk_none` + `opt_acog` compose; a full 7-slot build resolves without NaN.
4. `tests/attachments.test.js` — per §5.3, under `installCanvasStub()`; additionally assert the
   barrel attachments move `model.muzzle.position.z` (long → more negative, short → less negative)
   and that `applyBuild` applies barrel before muzzle (suppressor ends up at the new muzzle z).
5. Extend `tests/mission-integration.test.js`-style SSR check: `renderToStaticMarkup(<Armory
   profile={DEFAULT_PROFILE} …/>)` does not throw (the 3D canvas mounts only in an effect) and the
   markup contains `ARMORY`, `PRIMARY`, `SECONDARY`, and each owned weapon's name.
6. Add mutation targets to `scripts/mutate.mjs` following its existing pattern for at least: the
   suppressor `noiseRadiusMul`, the per-kill cash constant, and the `magAdd`-before-`magMul` order.

---

## 10. ACCEPTANCE CHECKLIST (verify every line before you say you are done)
- [ ] Fresh profile: menu shows loadout M4A1 / M1911; in game only keys 1/2/Q switch; no other guns present.
- [ ] Kill an enemy → `+$100` pops on HUD; headshot `+$150`; HUD cash counter increments.
- [ ] Finish a run → Results shows itemised cash breakdown, wallet tween, OPEN ARMORY CTA.
- [ ] Armory: 3D gun visible, lit, reflective, auto-orbiting; drag/zoom works; hotspots track sockets
      through orbit; clicking the gun near a socket opens the right slot menu.
- [ ] Buying a suppressor: wallet decrements with red flash, part flies onto the muzzle, NOISE bar
      drops, DAMAGE bar dips, chip row updates, profile persists across reload (F5).
- [ ] Equip Extended Mag → the *mag mesh* changes in the viewer AND in the first-person viewmodel next
      run, and the HUD ammo shows 45/… for the M4.
- [ ] Long Barrel + Suppressor: suppressor sits at the new, longer muzzle in both viewer and game.
- [ ] Locked weapon renders as hologram with real stats; PURCHASE converts it; class rule prevents
      putting a Deagle in primary.
- [ ] All five new guns: buildable, ≥ 70 primitives each, ≤ 10 draw calls, arms attach, reload
      animation works, their unique fire audio plays; SPAS pumps and shell-loads; M249 belt cover
      animates; Deagle slide reciprocates.
- [ ] Every attachment in §4.3 exists, is buyable, has a visual, and its stat effect is observable.
- [ ] `stk_none` removes the stock; ACOG hides irons; AWM 12× replaces scope; LPVO toggles zoom.
- [ ] Laser dot visible in world; flashlight lights geometry; bipod legs deploy when crouched still.
- [ ] `prefers-reduced-motion` honoured; keyboard-only navigation can buy and equip everything.
- [ ] `node scripts/validate.mjs` passes (lint 0 warnings, tsc clean, all old + new tests, mutation gate).
- [ ] `npm run build` passes; no console errors/warnings in dev.
- [ ] `docs/armory.md` written; `CHANGELOG.md` gets a new top entry describing the system.
- [ ] No `TODO`, `FIXME`, `phase 2`, or "will be implemented later" anywhere in the diff.

Deliver the complete implementation, then finish your response with: (1) a list of every file
created/modified, (2) the validate.mjs and build output, (3) a short table of the final catalog
prices, and (4) any binding you changed and why.
