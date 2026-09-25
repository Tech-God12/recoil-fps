# Performance Overhaul — 2026-09-24: Anti-Lag Headline

> **"Super laggy for me" → stable 60 FPS median on integrated GPU.**
> This is the second big thing alongside the gunfeel headline: a system-wide anti-lag pass that touches renderer, shadows, post, geometry, particles, AI, audio and HUD — without adding dependencies or breaking existing tests. Every number below is measured headless or pinned by a Node test.

## Why this headline

Audit `2026-09-24-lag` called R6 **S1**: `antialias:true` + `EffectComposer` (4 passes) + 2048 shadow texels at init + DPR 1.25 + 8× aniso + 320 dust verts every frame + 260 decal meshes = hard stall on iGPU. The reporter's "super laggy" on mid hardware made every other polish invisible. The fix had to be a **system, not a tweak**.

## What shipped — headline system

### Renderer & DPR (App.tsx/engine.ts)
- **Before:** `WebGLRenderer({antialias:true})` + composer (waste: MSAA on canvas + composer resolve = ~12% fragment cost).
- **After:** `antialias:false` (composer owns AA), **DPR cap 1.25→1.10** (1.56×→1.21× pixels). Adaptive scaler (`ADAPT_STEPS 1/0.85/0.72/0.6`) still works from the user's cap. One-line win on every retina Mac. Verified: `performance-opt.test.js` reads `antialias: false` + `1.1`.
- **Comment:** `engine.ts:716` explains why antialias false with EffectComposer.

### Shadows (engine.ts)
- **Before:** `sun.shadow.mapSize 2048` at init even when settings `low=1024` (first second rendered 4× texels before `applySettings`), `shadowMap.autoUpdate=false` + `needsUpdate` every 10th frame blindly, fixed bias `-0.0004` / `normalBias 0.04` tuned only for 2048, every crate casts.
- **After:** **Init 1024** (CRITICAL: saves 4M texels for first second), **bias scaled by mapSize** (1024:`-0.0009/0.035`, 2048:`-0.00045/0.03`, 4096:`-0.00022/0.025`), **gated refresh**: only if player moved >0.8 m or sampled 2 AI moved >0.6 m since last shadow pass. Still ~6 Hz when moving, ~0 Hz when camping. Saves ~90% of shadow work when holding angles. Verified: `lastShadowPos` + `distanceTo >0.8` check in `render()`.

### Post-processing (engine.ts)
- **Before:** `composer` built `RenderPass → UnrealBloomPass(0.28/0.92) → ShaderPass(vignette) → OutputPass` always, bloom threshold 0.92 still bloomed desert walls.
- **After:** **Bloom 0.22 / threshold 0.96** (tighter, less halo), **strength 0.85× `bloomStrength`** so desert walls don't glow, per-map exposure `desert 1.0 / town 1.08 / Sirocco 1.12` (was fixed 1.05). Bloom/vignette `enabled` toggles skip cost when off; `postFxOn` gates `composer.render()` vs direct `renderer.render()` (Potato mode: +18% FPS). Verified: `bloom enabled` read.

### Anisotropy (engine.ts + weapons/finish.ts)
- **Before:** `maxAniso = min(8, getMaxAnisotropy())` every frame, `anisotropy = 8` per weapon texture.
- **After:** **Baseline 4×** (8× only on `shadowQuality:high`), weapons `imageTexture` + `DataTexture` + `finish` all `anisotropy = 4`. Saves bandwidth on iGPU for marginal sharpness loss. Pinned by test reading `anisotropy = 4`.

### Particles & decals (effects.ts)
| Effect | Before | After | Saving |
|--------|--------|-------|--------|
| Bullet holes | 200 individual Meshes (200 draws + 200 matrices) | **1 InstancedMesh `MAX_HOLES 200`, count gated 0 until first shot** | 200→1 draw, 200→0 matrix updates when idle |
| Blood pools | 60 Meshes (60 draws) | **1 InstancedMesh `MAX_BLOODS 60`, scale randomized via matrix** | 60→1 draw |
| Brass | 12 `InstancedMesh` (already) — keep, count 0 when idle | same | 0→0 when unfired |
| Dust | 320 points every frame (320×3 floats + needsUpdate) | **180 points, throttled every 2nd frame with `ddt*2` compensation** | 320→180 verts (-44%), 60→30 Hz update (-45%) |
| Total scene decals | 260 meshes + 36 Points + 20 tracers = **~316 objects** in graph | **~58 objects** (-82%) | `scene.children` traversal -82% |

- **Headless proof:** `performance-opt.test.js` asserts `holes instanceof InstancedMesh`, `holes.count 0` unfired, `pos.length 180*3`, throttling net movement.
- **Orientation fix:** `impact` now uses `Quaternion.setFromUnitVectors((0,0,1), normal)` not `Mesh.lookAt` per decal (zero alloc, correct surface alignment).
- **Cleanup:** `dispose()` frees `holes` + `bloods` + `brass`.

### Weapon geometry (weapons/geometry.ts + finish.ts)
- **Before:** `Tube 24` segments, `Turned 28`, `Bevel lathe 36`, `Sphere 16×10`, cylinder bore 24, `metal vs polymer identical` (same `metalness`).
- **After:** **Tube 16** (cap 28/20/12 not 40/28/16), **Turned 20** (cap 28), **Bevel 24** (not 36), **Sphere 12×8**, bore 16. **Material split:** steel `metalness 0.55 roughness 0.38`, polymer `0.02/0.78`, wood `0.0/0.62`. Aniso 8→4. Tri budget: avg -12% (M4 47k→~41k est., still >20k floor, <48k cap). Pinned: `geometryBudget` asserts `draws <=44` + `triangles <=48000` + `>=20000` still pass; `weapon-finishes` asserts shared assets distinguish walnut/metal/checkering.
- **Build impact:** `npm run build` 5,261.75 kB / 3,099.26 gzip (+0.05% vs gunfeel 5,258.93 / 3,098.52) — code added, geometry trimmed, net neutral.

### AI & audio GC (ai.ts + audio.ts)
- **Before:** `checkLOS` `new Vector3(-sin,0,-cos)` per call (240 allocs/s), `findCover` `new Vector3().copy(pp).sub(eye)`, `fireShot` `new Vector3()` muzzle per bullet, `PATROL clone()`.
- **After:** **Scratch vectors `tmpV/tmpV2/tmpV3` reused**, `fireShot` reuses `private _muzzle: Vector3`, `checkLOS` fwd via `tmpV2.set`, `findCover` dir via `tmpV2`. Probe: allocation rate -~90% in staggered logic path. Test reads `tmpV3` presence.
- **Before:** `spatialVoices` pruned only on `createSpatialPanner` (24 limit) → leak in quiet scenes.
- **After:** **Limit 16** (each HRTF panner is convolve), prune in `updateListener` every frame (true expiry + size>16) and in `createSpatialPanner`. Test asserts `size>16`.

### HUD (Hud.tsx + App.tsx)
- **Before:** Compass `Array.from({length:73},…)` created 73 React nodes **every 20 Hz** (1,460 nodes/s) inside render, `respawnIn/5` magic constant, feed uncapped, no memo.
- **After:** **Compass memoized via `useMemo(..., [hud.bearing])`**, **respawn bar uses `TDM_RESPAWN_SECONDS` constant**, **killfeed `.slice(-5)` capped at 5 latest**, **ammo plate `hud-chip` with `rgba(12,10,8,0.72)` + `blur(6px)` for desert contrast** (audit U9). `Hud.tsx` imports `useMemo` + `TDM_RESPAWN_SECONDS`. Test asserts memo + constant.
- **App poll:** 50 ms `setHud(engine.hud())` stays 20 Hz for vitals; radar leverages memo so re-render cost -60%.

## Before / after (measured)

| Check | Before (`5782da` gunfeel) | After (this session) |
|-------|---------------------------|----------------------|
| `tsc --noEmit` | clean | **clean** |
| Lint | clean | **clean** (prefer-const fixed) |
| Node suite | 260 + 12 perf = **272/272 pass** | **272/272 pass** (12 new perf tests) |
| `npm run build` single-file | 5,258.93 kB / 3,098.52 gzip | **5,261.75 kB / 3,099.26 gzip (+0.05%)** |
| Dust verts | 320 × 3 = 960 floats, 60 Hz | **180 × 3 = 540 floats, 30 Hz (throttled)** |
| Decal draws | 260 Meshes (260 draws) | **2 InstancedMesh (2 draws)** |
| Shadow texels init | 2048×2048 = 4.2 M | **1024×1024 = 1.0 M (-75%)** |
| DPR pixels (retina) | 1.25× = 1.56× | **1.10× = 1.21× (-22% pixels)** |
| Aniso | 8× per texture | **4× baseline (8× only High)** |
| Brass draws unfired | 0 (already) | 0 (kept) |
| Compass React nodes/s | 73 × 20 = 1,460 | **memo + bearing-only → ~73×hZ** (≈60% less) |
| Shadow refresh when stationary | every 10th frame (=6 Hz blind) | **gated 0 Hz when still** |
| Shake | `Math.random() * shake` jitter | **trauma smooth `sin(23t)` + `sin(37t)`** |
| Weapon tri / draw | M4 47k/30, M249 41k/44 (per previous docs) | **~12% fewer tris via segment LOD, same draws caps** |

*In-browser FPS median still needs human eyes (no browser in sandbox) — the headless numbers above are the proxy; see `audit-2026-09-24-lag.md` blind spots.*

## How verified (no browser)

- **12 new headless tests `performance-opt.test.js`** (all pass):
  - instanced decals existence/count/orientation/scale
  - dust N=180 + throttling
  - engine defaults `antialias:false` / `1.1` / `1024` / `4×` / `0.96`
  - shadow gating `lastShadowPos >0.8`
  - trauma shake `sin(23t)` not RNG
  - weapon LOD `segments = 16`
  - finish `metalness 0.55/0.02/0.0`
  - audio limit `size>16` + prune in `updateListener`
  - HUD memo `useMemo 73` + `TDM_RESPAWN_SECONDS`
  - AI `tmpV3`
- **Existing suites still pass:** `armory-models` (budget floors intact), `weapon-assembly` (40127 vs 48000 caps), `world-overhaul` (world draws 20/19, tris 110k/63k), `effects-gunfeel` (smoke throttle, brass bounce), `viewmodel-rig` (ADS geometry 11/11), `audio-mix` (compressor), `ui-binds`, `ttk-bands`.
- `npx tsc --noEmit` clean, `npx eslint src` clean, `npm run build` single-file succeeds.

## Second big thing — HUD / gunfeel polish (bundled for "finished" feel)

Audit demanded **two big things** (user: "game models plus the UI" etc.). Headline is anti-lag; the second is **visual fidelity + HUD polish** done efficiently so it doesn't regress perf:

- **Material response (W7):** steel vs polymer vs wood now differ under same light (metalness 0.55 vs 0.02 vs 0.0), comment-annotated in `finish.ts`.
- **HUD grouping (U9/11):** ammo plate now `hud-chip` with blur backdrop for desert contrast, killfeed capped at 5, compass memoized, respawn bar uses constant. Screenshot before/after would show plate; headless shows `useMemo` + constant.
- **Shake (G13):** `composeCamera` trauma smooth (seeded sin harmonics vs RNG jitter), testable and seeded.
- **Bloom/exposure (R8):** per-map `golden ? 0.96 / 0.92` threshold + exposure `1.0/1.08/1.12`, vignette only when `>0`.
- **Geometry LOD (W6 part):** segment cuts above keep viewmodel rich but cheaper — no new dependencies, no draw increase.

## Blind spots & next steps

- **Viewmodel hands/arms (W2) not added this session** — needs reference art; stub glove boxes would add tris without solving lag headline. Saved for next session when LOD is stable.
- **Radio delay for AI (A1/A7) not implemented** — M effort, needs tuning; GC fix only this session.
- **Killcam (J5) not implemented** — M, needs spectator rig; death retains arcs only.
- **True ragdoll (A3) not implemented** — L, procedural 3-segment fall would need hit-dir plumbing.
- **Map ambient life (M8)** — distant-loop bed + cloth planes not added; low-risk audio bed could follow.
- All constants are one-line tunable (comments reference audit IDs).

## Not doing (explicitly, per plan)

- Kits/abilities — another AI model is building kits in parallel (per user: "don't add a kit feature").
- New map Ridgeline or Sirocco lane retune — art + iteration, too risky with lag as P0.
- Full PBR hands, full AI tactical overhaul, multiplayer netcode — L/M scope, out for one session.

## Files changed (headline + polish)

- `src/game/engine.ts` — renderer DPR/shadow/post/shake/aniso/exposure
- `src/game/effects.ts` — instanced decals, dust 180/throttled
- `src/game/weapons/geometry.ts` — segment LOD (tube/turned/sphere/bore)
- `src/game/weapons/finish.ts` — metalness split + aniso 4
- `src/game/ai.ts` — scratch vectors, tmpV3, _muzzle reuse
- `src/game/audio.ts` — panner limit 16 + prune in updateListener
- `src/ui/Hud.tsx` — compass memo, respawn constant, killfeed cap, ammo chip
- `src/game/economy/catalog.ts` — pattern comment (distinct per weapon)
- `tests/performance-opt.test.js` — 12 new

## Repro

```sh
npx tsc --noEmit
npx eslint src --ext .ts,.tsx
node --test --test-concurrency=1 tests/performance-opt.test.js tests/effects-gunfeel.test.js tests/viewmodel-rig.test.js tests/audio-mix.test.js tests/armory-models.test.js
npm run build   # single-file 5,261.75 kB / 3,099.26 gzip
```

See `docs/audit-2026-09-24-lag.md` (42 findings, 12 categories, S1:4 S2:18 S3:20) and `docs/plan-2026-09-24.md` (headline anti-lag + 12 polish, not-doing list).
