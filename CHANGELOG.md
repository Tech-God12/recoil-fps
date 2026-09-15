## 2026-09-15 — Scope overhaul, map-select flyover, armory rework, open dev wallet

PUBG-style optic system: every magnified optic now states a true magnification (Red Dot/Holo 1.3x, new 2x Aimpoint, 3x Specter, 4x ACOG Scope, 6x Marksman Scope, Hybrid 1.5x/6x on V, Sniper Scope 12x, Pistol RMR 1.25x) and the engine converts it to a real FOV pull measured against a 75° reference eye box — an optic replaces the weapon's factory sight picture on every gun that mounts one, with zoom-adaptive aim speed, a scope-tube mask from 4x, new 2x/3x/6x HUD reticles with a magnification readout, and three new see-through tube models. The MP became a secondary weapon (pistol slot rules), and a v2/v1 → v3 profile migration strips equipped kits again so spawns are guaranteed bare while opening an infinite dev wallet ($9,999,999 floor, displayed as ∞) for gun testing.

Armory rebuilt: weapons left, oversized gun stage centre (tighter camera framing, ~40% larger), and a fixed right panel — hardpoint socket rows expand inline with their parts, so nothing floats over the model and the bottom chip bar is gone; the stage header is a compact id plate (no giant ghost name); rapid weapon switching no longer leaks half-faded gun "skeletons" (in-flight swaps are finalised before the next one starts); FIELDED renamed EQUIPPED everywhere.

Start flow reworked: the main menu fits one viewport (route list removed), START opens an arena picker with the two maps side by side — the selected arena's engine builds behind the cards, its top-down scan fills the card, and the live camera hovers a slow orbit above that world while you choose; PLAY shows a mission briefing — objectives list plus command-voice narration — with the mission clock frozen until you hit DEPLOY (or wait for the briefing to end; a click then captures the mouse). The maps read as different places now: Sandblast keeps golden-hour desert light, while Town moved to a cool overcast sky with slate sun, cool grey-green plaster/steppe tints and rust-red district accents.

Fixes: the headshot kill-marker can no longer stick on screen (hit state now clears on a timer); the radar player is a solid facing arrow inside a field-of-view wedge instead of a faint triangle; the announcer calls streaks by name — Double, Triple, Quad, Penta kill, then Unstoppable (MULTI/MEGA KILL removed).

Verification: lint, typecheck, all Node tests (93) plus mutation checks, production build. Details: [docs/armory.md](docs/armory.md).

## 2026-09-14 — Armory iteration 5: M416 restyle, SCAR detailing, short names, bare spawns

M4 rebuilt as an HK416-pattern gun (fat quad rail with round cooling holes, tall gas block with integral flip-up front post, diopter drum rear, slimline stock, ambi controls, heavy barrel) and renamed M416; SCAR-H gained its signature side charging handle, regulator dial, chambered brake, stock furniture and a mounted front sight. All manufacturer prefixes dropped from gun names — M416, AK-47, 1911, AWM, MP, Vector, SPAS, SCAR, Deagle, M249 (ids unchanged) — and mags/optics renamed to basic industry terms (Red Dot Sight, Holographic Sight, ACOG Scope, Hybrid Sight, Sniper Scope, Pistol Red Dot, Drum Mag, Fast Mag, Extended Tube, Large Ammo Box, 10-Round Mag). Spawns are guaranteed bare: fresh profiles field iron sights and stock mags, and a one-time v1→v2 profile migration strips stale equipped kits while keeping cash, weapons and ownership. Settings key list updated to the loadout reality (1/2, Q tap-swap, hold-lean).

Verification: full `node scripts/validate.mjs` (lint clean, typecheck, all Node tests incl. bare-spawn, migration and name pins, mutations killed) plus production build. Details, prices and measured limits: [docs/armory.md](docs/armory.md).

## 2026-09-14 — Armory iteration 4: real-steel gun rebuilds, glass command UI

Rebuilt all ten procedural guns around authentic silhouettes and signature details (M4 carry handle + vented KAC rail, AKM slant brake, 1911 checkered walnut, AWM thumbhole chassis + fluted barrel, MP7 wire stock, KRISS slab receiver, SPAS side saddle + ghost ring, SCAR-H FDE rail + PWS comp, Deagle triangular slide, M249 belt + carry handle) with full real-steel display names — Colt M4A1, Kalashnikov AK-47, Colt M1911, AI AWM .338, H&K MP7A1, KRISS Vector .45, Franchi SPAS-12, FN SCAR-H, Desert Eagle .50 AE, FN M249 SAW (ids/shorts unchanged). Sockets, muzzles, removable groups, ADS wiring and arm anchors preserved; Vector/SCAR/M249 gained removable barrel groups, AWM scope rings hide with the scope, drum mag rebuilt with ribbed shell. GunBuilder auto-flats small prims to fund the detail inside budget (draws 30–41, tris 3.0k–7.2k, all pinned). Armory UI redesigned as floating glass over the 3D stage: slim command bar (back/cash/deploy), compact weapon rows, refined chips — title slab, loadout strip and deploy slab gone; zero emoji (SVG lock, CSS dots), rail scroll glitch fixed.

Verification: full `node scripts/validate.mjs` (lint clean, typecheck, all Node tests incl. name pins, mutations killed) plus production build. Details, prices and measured limits: [docs/armory.md](docs/armory.md).

## 2026-09-14 — Armory iteration 3: full-color previews, finishes, beauty pass

Locked guns preview in full color on the podium — the cyan wireframe hologram is gone, replaced by a lock note in the stage header. New finish system: per-weapon skins picked from a FINISH row in the stat panel, persisted in the profile, carried on loadout builds, and repainted onto the 3D gun both in the viewer and in-game via `applySkin` (Factory only for now; new finishes are data-only catalog entries). Beauty pass: brighter thumbnails on gradient backdrops, hover-only hotspot labels, BUY moved from the floating slab over the gun into the stage header, truncated card names, softer locked-card dimming.

Verification: full `node scripts/validate.mjs` (lint clean, typecheck, all Node tests, mutations killed) plus production build. Details, prices and measured limits: [docs/armory.md](docs/armory.md).

## 2026-09-13 — Armory iteration 2: see-through optics, viewer parity, economy retune

See-through sight picture: LPVO, 12×, ACOG, red dot, holo and RMR rebuilt around open tubes/housings with front and rear lenses (raycast-verified down the optical axis); only the 3D aiming mark hides in ADS now, and LPVO low power shows its chevron through the glass. Viewer matches the in-game viewmodel light-for-light (same hemisphere/key rig, RoomEnvironment, ACES 1.05) on a podium stage with halo ring, and the gun sits lower in frame. Terminal decluttered: click-to-preview without auto-buy, hologram for locked guns, fielded-loadout strip, truncated chip names, brighter tabs/cards, styled scrollbars. Per-gun part fit: pistol stick mags and pure-tube barrels, compact stocks on SMG/PDW, Fast Mag off pistols. Economy retuned against streak farming — marks pay $50/$100/$150 once per chain under a $500/run cap, phases $200, extraction $750, grades S$600/A$400/B$200 — a competent run pays ≈$3,350 (~19–20 runs to full unlock).

Verification: full `node scripts/validate.mjs` (lint clean, typecheck, all Node tests, mutations killed) plus production build. Details, prices and measured limits: [docs/armory.md](docs/armory.md).

## 2026-09-13 — Armory loadout system: cash economy, 5 new guns, 32 attachments

Added a full cash economy (per-kill/headshot/streak/phase/extraction/grade payouts with difficulty multiplier and itemised debrief), a post-mission 3D Armory (orbit viewer with socket hotspots, click-the-gun picking, hologram previews, stat lab with hover ghost-deltas, per-weapon part shop, odometer wallet), and a persistent profile (per-weapon ownership, builds, primary/secondary loadout). Five new procedural guns (SCAR-H, Vector, SPAS-12, Deagle, M249) join the rebuilt five; 32 attachments bolt onto live sockets and change stats, meshes, audio, ADS alignment, and handling. Engine gains loadout arming (1/2/Q), suppressor behaviour, Masterkey breacher (B), LPVO powers (V), rail laser/flashlight, bipod deploy, slide/pump/cover animation, and distinct reports for every gun. Q is now tap-swap / hold-lean; legends updated.

Verification: full `node scripts/validate.mjs` (lint clean, typecheck, all Node tests, 34/34 mutations killed) plus production build. Details, prices and measured limits: [docs/armory.md](docs/armory.md).

## 2026-09-13 — Sandblast / Town polish and stability

Renamed maps and expanded playable width/depth by approximately 20%, with new outer courtyard buildings/lanes and architectural/interior families. Separated bridge navigation/deck support from riverbed physics; stabilised downhill movement and continuous distance-driven bob. Moved opening objectives into rooms and added physical charge placement feedback. Rebalanced AWM body damage, clear scoped rendering, automatic scope-out/bolt cycle and reload timing; reworked MP7 detail/handling and tracer visibility. Polished non-scrolling main menus, graphics profiles, fullscreen placement and radio pacing. Throttled failed paths, repaired heap ordering, bounded audio tails, removed repeated static shadow/radar/resize work, and verified mission-preserving WebGL context recovery.

51 tests / 31 mutation checks; assisted browser checks on both maps. [Detailed changes, evidence, screenshots and limits](docs/sandblast-town-polish.md).

## 2026-09-13 — Combat / visual refinement after Ground Zero feedback

Restored the missing AWM body; bevelled and detailed weapon geometry, wood grain and reflection lighting; upgraded enemy rifles, articulated knees, corrected backward aiming arms, sustained gait, muzzle recoil and moving tracers. Close contact interrupts inappropriate maneuvers; squad approaches separate. Removed fountains/wells, clipped coplanar ground overlays, corrected facade strips, furnished both floors and opened stairwells. Substepped movement and unified stair/support allowances. Replaced continuous hold-X planting with tap-start retained attachment and optional remote detonation after clearance.

Verification: 45 tests and 31 mutation checks, production build/lint/typecheck, assisted browser mission and feature probes. World geometry ceilings intentionally increased to 95k/50k triangles for interiors while retaining 20 world draws. Details, actual captures and explicit limitations: [combat refinement](docs/combat-refinement.md).

# Ground Zero — map + mission rebuild · 2026-09-13

Rebuilt both operations around different terrain, architecture, mission pacing and destruction consequences. Full design notes, actual-render screenshots, exact verification methods and remaining release checks: **[docs/ground-zero.md](docs/ground-zero.md)**.

| Flaw | Severity | What was built | Result |
|---|---|---|---|
| Same landmarks on a grid and a ring | Critical | Al-Rasul's wadi/souk/fort/rail depot/water tower; Kasbah's keep, six industry districts and western gate tunnel | Distinct silhouettes, surfaces, cover patterns and mission routes |
| Elevation exists only as decoration | Critical | Seven Al-Rasul and eleven Kasbah stair-access overlooks, with connected landings and usable parapet gaps | All 18 pass movement/support tests using the actual engine methods |
| Interiors are dead ends | Major | Through-house doors, ground-floor vault windows, lit open armories, arcades and prayer-hall/gallery lighting | Interiors and roofs connect alternative approaches rather than only containing props |
| Identical five-beat missions | Critical | Sandblast's bridge hold and water-tower exit; Ridgeline's 75 s relay defense and six-phase western escape | Different quotas, fuses, pressure cadence and objectives; map-specific radio scripts |
| Empty deployment and anonymous waves | Major | Exactly-once opening request through the existing safe pressure director; checkpoint-focused entry and 14 named insertion approaches per map | Both browser runs produced three opening actors; all squad members are nav/capsule checked, no spawn gates weakened |
| Detonation leaves the world unchanged | Critical | Prebuilt collapsed footbridge and fallen hoist states, debris, nonblocking smoke and scorch patches | Geometry, collision, bullets, footsteps, AI paths and radar change together |
| Ground assumptions break a lowered riverbed | Critical | Shared ground-height support for movement, navigation, grenade landing/preview and death decals | Wadi is traversable; below-grade rubble is visible to AI navigation |
| Decorative/blocked stairs pass superficial tests | Critical | Corrected roof landings, east watchtower access, tower gallery clearance, citadel stair approaches and west-gate obstruction | Regression tests walk every advertised overlook and flood both maps before/after destruction |
| Sideways roads disagree with radar | Major | Corrected north/south road orientation and east/west texture orientation; actual support/deactivated bounds drive radar | Paved lanes align with their surface records; destroyed routes do not leave phantom footprints |
| Too many colored-material draws | Major | Vertex-color accent batches, shared district textures, merged state geometry and cheaper non-wadi terrain | Al-Rasul: 35 → 20 world draws; Kasbah: 32 → 19 intact / 20 destroyed; not an FPS claim |
| Fake static "drifting" clouds | Polish | Soft cloud sprites with simulation-time drift, per-map haze and persistent demolition dust | More atmospheric silhouettes without extra real lights |
| Timer copy and screen layout lag mission changes | Major | Data-derived route timings, relay integrity readout, map description tooltips and short-viewport route layout | Six-phase briefing stays usable at 1280×720; extraction guidance remains intact |
| Fullscreen covers kill confirmations; clamped FPS counter is misleading | Major | Feed below the utility button, separate bottom-center FPS slot, real elapsed-frame sampling | Feedback is not covered; slow rendering is no longer disguised by the physics clamp |

## Verification

- `npm run build`, `npx tsc --noEmit`, `node --test`: **passed**.
- `node scripts/validate.mjs`: **passed — 40 tests, 31 assertion-detected mutations**, original sources restored and retested.
- World geometry: **20 draws / 76,024 triangles** for intact Al-Rasul; **19 draws / 36,492 triangles** for intact Kasbah. Destruction peaks at 20 world draws on either map. These counts include glass but exclude soldiers, markers, sky, shadow passes and postprocessing.
- Both maps retain **40 ground-level cover nodes**; glass/window alignment and marker/soldier limits are tested.
- No package manifest/lockfile changes; browser tooling remained temporary and is not part of the game.

## Browser run notes — not unassisted playthrough claims

- **Al-Rasul:** assisted runtime traversal completed all five phases, planted through the real visibility predicate, detonated the cache/bridge, regenerated radar and extracted. Observed peak live count: 9. Fresh redeployment reset destruction; lethal damage reached the failure screen. A separate assisted real-weapon/AI run recorded one elimination.
- **Kasbah:** assisted runtime traversal completed all six phases including relay defense, hoist destruction and western extraction. Observed peak live count: 9. Fresh redeployment and lethal-damage failure worked. A separate assisted combat run recorded nine eliminations with actors entering ENGAGE/SUPPRESS states.
- On both maps, browser probes fired all five weapons, vaulted/shattered a pane, queried both lean directions at three cover spots, initiated a slide, cooked/threw a frag, threw a flash and verified pause freezes the mission clock. No JavaScript page exceptions occurred in the complete runtime probes.
- Full-sequence probes relocated the player, supplied clear credits and stepped simulation time. Combat probes used automated aim. Screenshots are actual software-rendered gameplay, not concept art. **These do not establish human difficulty balance.**

## Explicit adaptations / release gates

Kasbah uses raised terrace decks around ground-connected mission courts, not a fully elevated continuous hill town. Water-tower access is a real staircase rather than an unsupported ladder. Destruction is an event-driven geometry swap, not rigid-body animation. Continuous wadi banks preserve dry-bed flanking.

Native mouse capture and normal hardware rendering were unavailable in headless Chromium. Mandatory pre-edit human playthroughs, full unassisted Normal runs, 70% landmark-visibility measurement, 30-second live-AI stall observation across all routes, all graphics/settings paths, and the **>55 FPS integrated-GPU gate remain unverified**. The software-renderer FPS counter is not a hardware benchmark. See the release checklist in the design report.

---

# CHANGELOG — UI / Tactical Radar Pass (VOLT Protocol v2)

Player-audit pass focused on two player-facing complaints: **map accuracy & placement** and
**UI legibility / visual noise**. Severity is from a player's perspective, not a linter's.

| Flaw | Severity | Fix | Result |
|---|---|---|---|
| Radar map drawn at 256px from coarse footprints — building/cover blobs, no walkability shading; zoomed out to whole 208m sector with zero zoom context | CRITICAL | Rewrote `generateMapImage()`: 512px canvas, 1.7m-per-cell walkability shading from real solids, per-height-class building colors, sunlit/shadow edges, drop shadows, paved-zone highlights, mottled terrain | Map now reads as a real top-down survey of the sector; geometry is recognizable and matches the world |
| Radar parked dead-center under the crosshair, competing with the reticle, score pops and mission banners | CRITICAL | Moved radar to **bottom-left** (above the vitals frame), clear of all center-stack feedback | Center screen only ever shows crosshair + combat feedback; radar no longer blocks sight |
| Radar showed the whole map (208m across a 168px dish ≈ 1.2m/px) — useless at combat range | ANNOYING | Added `worldHalf` to `HudState` and a per-frame zoom transform: dish now shows a **60m radius window** with the player dead-center, rotating forward-up | Readable at glance: 20/40/60m rings, enemy diamonds, N/S/E/W cardinals all meaningful |
| Vivid saturated palette (pure `#FF5C1A`/`#00E0FF`/`#38FF9B`) + heavy 20–44px glows everywhere → neon sign, low text contrast | CRITICAL | Rebalanced entire design system to muted "tactical terminal" tints (`#F06A2E`, `#58BFE4`, `#3FD68E`, `#E5484D`, `#E8B93C`), cut glow radii/intensities ~50%, replaced neon text-shadows with dark drop-shadows for contrast | Calm, readable, still branded; text pops instead of bleeding |
| Exposure default 125% + vignette 18 washing out mid-range targets in the desert fog | ANNOYING | Defaults: brightness 110, vignette 12; fog pushed to 130–430 and slightly desaturated | Enemy silhouettes stay readable out to ~50m |
| Fullscreen scanline overlay + floating HUD corner brackets + hex glows added visual noise over the 3D world | ANNOYING | Removed HUD scanlines; corners dimmed to 40% opacity with subtle glow | Screen reads cleaner during combat |
| Proximity threat ring (92px) around the crosshair duplicated the radar and crowded the center | CRITICAL | Replaced with a slim threat readout below the crosshair — distance + elevation arrow, only when a hostile is within 30m | Center screen decluttered; proximity info kept |
| Damage arcs spanned 74vmin of the screen at full opacity | ANNOYING | Reduced to 56vmin, opacity × 0.85, softer red | Directional feedback without red-out |
| Onboarding limited to a menu key legend — nothing in-game | ANNOYING | Diegetic HUD strip (WASD/RMB/G/Q·E/SPACE/X) under the compass for the first 12s of every mission, auto-fades | 5-second test: a new player sees how to move, scope, frag, lean, vault, plant |
| Tick/objective/compass text sat at ~45% white with colored glows — hard to read at 720p | ANNOYING | Raised text alphas to 55–82% white, bumped base font sizes (feed 12px, obj brief 12.5px, vitals 10px), dark text-shadows instead of glows | Legible at 720p and over bright desert |
| Mission phase banner used a loud animated hazard-stripe border | POLISH | Single subtle accent border | Banner reads as a clean HUD wipe |
| Settings swatches / results rank tints still used the old vivid palette | POLISH | Synced all inline color literals to the new muted palette | Consistent brand across every screen |

## Verified
- `npm run build` ✓  ·  `npx tsc --noEmit` ✓  ·  `node --test` ✓ (25/25)
- SSR string assertions for menu/objective markup unaffected.
- HUD hot-path styles remain transform/opacity-only (radar zoom is one composited transform).
