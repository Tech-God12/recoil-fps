# Headline: Gunfeel (built 2026-09-24)

The audit's gunfeel chapter (G1–G9) plus the systems a shot touches on its way
out of the barrel: TTK balance, the viewmodel, per-shot effects, the mix, the
kill confirm, and the HUD states that lie about ammo. Ranked (U1/U2) came along
because the menu's OPERATION BLACKOUT entry was dead and its TDM/armor code
paths overlap the TTK work. No new dependencies; every number below is measured
headless (no browser in this environment) or pinned by a Node test.

> Rebased onto main `faa5214` (defusal update) before review. The defusal PR
> had independently landed four items from this build's list — the ranked
> imports, the debrief `outcome`, the comp `hud()` guard, and the 4-mode
> AI-roster pin — so those hunks were dropped in favor of upstream. The
> before/after table below is measured against `faa5214`, not the `5496df1`
> base the work started on.

## What shipped, by audit finding

- **G1 — AWM one-taps.** Damage 78 → 160 (`economy/catalog.ts`): one body shot
  anywhere inside falloff on 100 HP pools (160 × 0.85 = 136 at range), and the
  74-damage TDM cap no longer applies to bolt-actions (`engine.ts`), so TDM is
  1 tap vs armor-0 (160 vs 150), 2 taps vs armor-1/2 (140.8/124.8 vs 170/190),
  still 1 tap on a helmeted head (393.6 vs 190). Priced by 48 RPM, a 5-round
  mag, and a forced unscope per shot (G9, kept deliberately).
- **G2 — SCAR dethroned.** Damage 52 → 48: 3-shot body like the AK (0.20 s),
  keeps the 1-tap head and the 45 m × 0.9 falloff identity. DPS 520 → 480.
- **G3 — viewmodel rig.** `VIEWMODEL_RIG` (`engine.ts`, exported): scale
  1.95 → 1.35, hip (0.22, −0.19, −0.38), ADS depth −0.34, vm FOV 68 → 56.
  ADS math still derives from `sightY × scale`, so re-seating is automatic.
- **G4 — viewmodel fill light.** Cool `vmFill` (0xB9C8E8, 0.9) on the camera
  side; muzzle-flash key 1.6 → 1.2 (masterkey 1.1 → 0.95) so the gun stops
  swinging between silhouette and blowout.
- **G5 — smoke + brass.** 8-slot muzzle-smoke pool (4 particles, 1.1 s life,
  buoyant, throttled to 1 puff/70 ms) and a 12-ring brass `InstancedMesh`
  (1.7 m/s right + 2.0 up, 12 m/s² gravity, damped bounce on the footing
  plane, 1.6 s life, parked at scale 0). Zero draws until the first shot and
  zero again once the ring expires (`brass.count` gating); zero allocation
  in the hot path. Masterkey ejects brass too.
- **G6 — kill confirm.** 45 ms hitstop on direct gun kills (explosions/streaks
  skip it — they already shake the camera), plus a crosshair pulse (+8 px on
  hit, +14 on kill, gliding back over 160 ms via the new `Reticle` transition).
- **G7 — honest ammo states.** `shouldShowReload`/`isLowAmmo` (`ui/hud-math.ts`):
  `mag === 0 || mag/magSize < 0.25`. The AWM's full mag no longer blinks RELOAD.
- **G8 — tracers from the skip bubble.** Tracer origin moved out to the lean
  skip distance so leaning shots can't read as wallhacks.
- **J1 — earnable streaks.** 400/700/1000/1500/2500 → 300/600/850/1200/2000:
  UAV on the 3rd kill, airstrike 6th, sentry 9th, chopper 12th, nuke 20th
  (two headshots arm the UAV). Streak keys are dead in ranked.
- **D1 — master-bus glue.** `DynamicsCompressor` (−18 dB, 4:1, 3 ms attack,
  180 ms release) between master and destination, plus +1 dB makeup gain;
  gunshot stacks (1.0 + 0.68 + 0.42) stop hard-clipping.
- **D3 (part) — casing tink.** `fireCasing()`: 6.4 kHz ± 10%, highpassed at
  4.2 kHz, gain 0.1, landing 90 ms after the shot (eject + flight time).
- **U1 — ranked is reachable.** `onRanked` wired menu → setup → launch →
  debrief → re-queue; comp `start()` + `missionMap` guards fix the remaining
  crash sites (`missionRuntime` is undefined in ranked); the BLACKOUT results
  screen now itemizes cash via the shared `CashCard`. (The ranked imports,
  debrief `outcome`, and `hud()` comp guard landed upstream first and were
  kept as-is.)
- **U2 — restart preserves mode.** Pause → Restart and results → RE-QUEUE
  replay the same mode (mission, TDM, ranked, or defusal) instead of always
  launching a mission; the map follows the live setting.
- **U3 (part) — threat readout gated.** Shows only past 12 m without line of
  sight (`tdm.seesPlayer()`); the through-wall centre-screen intel is gone.
  Directional offset still open.
- **U4/U5 — binds + menu nav.** Complete 22-row bind reference
  (`ui/bindings.ts`, tested) and a wraparound `menuStep` so keyboard nav
  reaches all 5 menu entries.
- **R1 (part) — shadows refresh.** Shadow map re-renders every 10th frame
  instead of freezing after frame 1 (full cascade work still open).
- **C1 — honest headshots.** `damagePlayerTDM` takes an explicit `isHead`;
  frag/streak damage ≥ 40 no longer reports as a headshot in feed + stats.
- **Build-found: masterkey matches spec.** Engine fired 7 pellets × 13 dmg;
  spec is 8 × 12 — both paths fixed, pinned by existing tests.
- **Repo hygiene (already upstream):** the tracked self-referential
  `node_modules` symlink and the stale AI-roster pin were both resolved by the
  defusal update before this branch was rebased — noted here only because the
  audit flagged them.

## Before / after (measured)

| Check | Before (`faa5214`) | After |
|---|---|---|
| `tsc --noEmit` | clean | **clean** |
| Node suite | 228/228 | **260/260** (32 new) |
| `validate.mjs` | pass (34 checks at the time) | **pass**: lint + typecheck + tests + 44/44 mutations |
| `npm run build` | 5,254.54 kB / 3,097.33 gzip | 5,258.93 kB / 3,098.52 gzip (**+0.08%**) |
| AWM mission TTK (body) | 2 shots, 1.25 s | **1 shot, 0.00 s** |
| AWM TDM (armor 0/1/2, close) | 3 / 3 / 3 (capped @74) | **1 / 2 / 2** (bolt-exempt) |
| SCAR mission TTK (body) | 2 shots, 0.10 s | 3 shots, 0.20 s (AK parity) |
| Streak kills-to-earn | 4/7/10/15/25 | **3/6/9/12/20** |
| Viewmodel scale | 1.95 | 1.35, ADS-aligned per gun (11/11 rig tests) |
| Idle scene draws (effects) | 0 | 0 (brass ring gated to `count = 0` when empty) |
| Ranked reachability | dead button (wired code, no `onRanked`) + 2 crash sites | menu → setup → launch → debrief → re-queue |

Note: the Phase-1 probe's TDM150 column still models the old capped-74
sniper (3 shots); the engine path it models no longer exists for
bolt-actions — `tests/ttk-bands.test.js` pins the real TDM armor math instead.

## How it was verified (no browser)

- 6 new/changed test files, all headless against real game code: `ttk-bands`
  (TTK floors, caps, armor curves), `viewmodel-rig` (ADS geometry for all 10
  guns), `effects-gunfeel` (smoke throttle/buoyancy/expiry, brass ballistics/
  bounce/parking), `audio-mix` (compressor settings, casing schedule),
  `ui-binds` (bind coverage, menu wrap, relative ammo), streak earnability
  (+2 tests: kill-count ladder, headshot acceleration).
- `node scripts/validate.mjs`: lint + typecheck + full suite + 34/34
  mutation kills. `npm run build`: single-file production bundle.
- Audit probe re-run after the change for the TTK/world/model tables above.

## Blind spots (read before trusting your eyes)

- Viewmodel scale/light/ADS pose were tuned **without a renderer**. The
  geometry is proven (muzzles clear of the near plane, sights below centre at
  the hip, exact centre at ADS), but "does it look good" needs a human and a
  GPU. Same for smoke density, brass visibility, hitstop feel, and the
  compressor settings — all constants are commented and one-line tunable.
- G9 (bolt unscope), U3-direction, U6/U7/U8, D2/D4/D5, J2–J5, W1/W2/W4/W5,
  A1–A6, F1–F3, R1-cascades were explicitly **not** attempted this session
  (see audit severities): hands, ragdoll, killcam, crack-bys, decimation, and
  lane/pattern retunes need eyes or are L-effort.
