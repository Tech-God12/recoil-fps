# Phase 2 — Self-Audit Remediation (see docs/self-audit-prompt.md for the full flaw list)

Gameplay-first audit of RECOIL: every flaw was found by playing/reading the game, not by chasing CI.
All fixes below keep the locked design intact (infinite ammo, `pattern: [[0, 0]]` ×5, empty
frame-zero roster, live cap 10, simulation-time clocks) and all 25 Node tests + mutation
harness stay green.

## Engine / correctness

- **Resolution scale was placebo.** `EffectComposer` cached a stale pixel ratio; resolution
  changes and adaptive downscaling only affected the base renderer. Added `syncPixelRatio()`
  (applies `min(devicePixelRatio, dynPR)` to renderer *and* composer) used by `applySettings`
  and `adaptResolution`.
- **Grenades could spawn inside walls.** `throwOrigin(dir)` probes 0.5 / 0.28 / 0.12 m in front
  of the eye against `pointInSolid()` and only falls back to a safe shoulder origin; used for
  both frag and flash throws.
- **Input leaks in non-playing states.** `G` (cook/throw) is ignored while paused/dead/ended or
  without pointer lock; firing while the pause menu is up was already blocked, now consistently.
- **ADS toggle.** New `adsToggle` setting (default: hold). RMB click toggles scope when on;
  sprint cancellation only fires when aiming actually engages.
- **Vault a window → the window shatters.** Vault now resolves the nearest pane via
  `nearestWindow()` (index-aligned `world.windows[i]` ↔ glass `InstancedMesh[i]`), calls
  `world.breakGlass(i)`, `effects.glassShatter(center)` and positional `audio.glassBreakSpatial`
  at the pane center — previously you silently clipped through intact glass.
- **Enemy callouts are voiced.** Proximity callout events feed `voice.enemyCallout(kind)`
  (9 s cooldown inside the voice module).

## Score economy (new, wired end-to-end)

+100 elimination, +150 headshot, +100 frag kill, +250 per completed phase (via optional
`MissionHost.scoreBonus`, called from `mission-runtime` on `phase-completed`), +1000 extraction.
Shown as a SCORE row in the HUD vitals block (tabular numerals, `toLocaleString`) and as a 5th
debrief summary cell; the `end` event carries the total so the debrief always matches the in-game
+100/+150 popups. Removed the fake `reserve`/`interacting`/`radarEnemies` fields from `HudState`
(half-plumbed leftovers), so no UI element can lie about state again.

## Audio / pause semantics

- Menu no longer spins up an `AudioContext` just to store master volume (`setMasterVolume` is
  values-only until `ensure()`; volume re-applied on context creation).
- `setPaused(true)` suspends both the AudioContext and speech synthesis (skipped once the match
  ended, so the victory line plays over the debrief); resume restores both. `dispose()` cancels
  in-flight speech and suspends audio instead of leaving wind hum behind on quit.
- Dead voice cues (`missionStart`, `halfway`, `victory`) removed — they double-spoke the
  mission-runtime radio.

## AI / world / mission data

- Corpse blood now pools on the supporting surface: `AIManager.die()` scans solids for the
  topmost surface under the body (`effects.bloodDecal(pos, surfaceY)`), so kills on ramps and
  rooftops don't drip blood on the street 6 m below.
- Removed dead world data: `squadSpawns`, `SquadSpawn`, `MAPS.enemies` (spawn placement is fully
  owned by the mission director / pressure system).
- **Kasbah fixes (missions.json):** deploy point moved to the *outer ring south* `[0, 0, 66]`,
  matching the briefing text (it previously deployed you inside the market); the west-market
  clear point moved to the stall aisle `[-42, 0, 27.5]` (both nav-grid and capsule checks pass;
  the old cell was walkable on the nav grid but fused with a stall collider); insertion
  ridge-outer-south spawn aligned to the new deploy.

## UI polish

- **Sniper ADS is a real scope:** black tube mask (radial-gradient) covers the world outside the
  320 px optic circle; mil-dots + center dot inside; opacity crossfades with the ADS lerp.
- **Live tactical minimap** (bottom-left, above vitals): pre-baked `mapImage`, player arrow
  rotated by bearing, objective ring/dot (amber = action, teal = extract), hostile pips —
  derived from the same normalized transform as the compass, no fake data. Hidden below 660 px
  viewport height to avoid crowding.
- Kill feed moved under the FULLSCREEN utility button (no more overlap); FPS chip relocated to
  bottom-center; vitals block now shows ELIMINATIONS / ACTIVE HOSTILES / SCORE.
- Debrief gains the SCORE cell (5-column summary) and a footnote explaining the exact scoring.
- Removed dead components (`StatBar`, `CountUp`, `Key`) and ~64 lines of dead CSS (old radar,
  mapcards, glitch/shutter/kenburns menu-era styles). `hud.mission` remains the single source of
  truth for objective UI.
- `index.html`: favicon (inline SVG reticle), `theme-color`, description meta, `viewport-fit=cover`.
