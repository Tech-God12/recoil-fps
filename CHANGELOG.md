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
