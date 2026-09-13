# OPERATION OVERKILL — MASSIVE UI OVERHAUL PROMPT

> **Role:** You are a senior game-UI engineer and motion designer executing a total visual
> overhaul of *Recoil FPS*. The existing interface is a muted olive/sand "quiet ops board".
> It is boring. Erase it. Replace it with a loud, aggressive, high-contrast combat terminal.
> This document is the complete spec. Implement all of it. Do not half-execute.

---

## 0. NON-NEGOTIABLE CONSTRAINTS

1. **Do not touch gameplay logic.** You may restyle any UI file. You may NOT change engine
   mechanics, pointer-lock flow, mission systems, AI, audio, or physics. `src/game/**` is
   off-limits except for a single allowed change: the default crosshair color
   (`DEFAULT_SETTINGS.crosshairColor`) may be updated to the new brand accent.
2. **Keep the public component contracts.**
   - `MainMenu` props: `{ s, onDeploy, onSettings, onMap }` (unchanged).
   - `PauseMenu` props: `{ mission, onResume, onRestart, onSettings, onQuit }` (unchanged).
   - `ResultsScreen` props: `{ r, onRedeploy, onMenu }` (unchanged).
   - `Settings` props: `{ s, set, onClose }` (unchanged). `Reticle` must still be exported.
   - `MissionObjective` props: `{ mission }` (unchanged). Must keep
     `aria-label="Current mission objective"` and render `mission.name`.
   - `Hud` props: `{ hud, s, fx }` (unchanged). `HudFx` type unchanged.
3. **SSR safety.** `tests/mission-integration.test.js` renders `MainMenu` and
   `MissionObjective` with `renderToStaticMarkup`. These components must not touch
   `window`, `document`, `localStorage`, or `requestAnimationFrame` at render time.
   Effects are fine (they don't run during SSR).
4. **String assertions in tests.** The main-menu markup must contain every mission phase
   title, must contain the exact string `Reach the pickup to extract`, and must NOT contain
   `21 HOSTILES`. Never hard-code a hostile count anywhere in menu text.
5. **Performance.** The HUD re-renders ~20×/second. Avoid expensive work in render:
   precompute arrays outside JSX, avoid inline `new Date()`, avoid layout thrash. CSS
   animations must use `transform`/`opacity` only (no animated `width`/`top` on hot paths).
6. **Accessibility & polish.**
   - Respect `prefers-reduced-motion` (global media query kills animations).
   - `:focus-visible` outlines on every interactive control.
   - `aria-pressed`, `aria-label`, `role="status"`/`role="alert"` where they already exist.
7. **Never leak the full HUD during `paused` if it would obscure the pause menu** — the
   pause menu renders above the HUD; do not change the layering contract.
8. **Fonts.** Keep Orbitron (display) + Rajdhani (body). ADD "Share Tech Mono" for terminal
   readouts, ticker text, and status lines. All three load via the existing Google Fonts
   `<link>` in `index.html`.

---

## 1. NEW DESIGN LANGUAGE — "VOLT PROTOCOL"

The game must now look like a high-end arcade combat terminal: carbon black, molten blaze
orange, volt green, electric cyan, hot red. Industrial, angular, glowing, loud.

### 1.1 Palette (CSS variables)

| Token       | Value      | Use                                              |
|-------------|------------|--------------------------------------------------|
| `--bg`      | `#04060A`  | Root background, deepest shadows                 |
| `--bg2`     | `#0A0F16`  | Elevated surfaces                                |
| `--acc`     | `#FF5C1A`  | Brand accent: CTAs, selection, key highlights    |
| `--acc-2`   | `#FF8A3D`  | Accent highlights / gradients                    |
| `--volt`    | `#38FF9B`  | Health, success, "live" state                    |
| `--cyber`   | `#00E0FF`  | Tech readouts, info, cyan secondary accents      |
| `--danger`  | `#FF2E4D`  | Damage, hostiles, kill confirms                  |
| `--warn`    | `#FFC400`  | Warnings, low ammo, timers                       |
| `--panel`   | `rgba(8,12,18,.8)` | Panel fill with backdrop blur          |
| `--line`    | `rgba(255,255,255,.12)` | Hairline borders                    |

Every screen mixes **orange (brand) + cyan (tech) + volt (life) + red (danger)**. Never let
a screen be monochrome. The old beige `#ddc49b` / olive `#101c17` palette is deleted.

### 1.2 Typography

- **Orbitron 900/700** — giant display numerals (HP, ammo, countdowns, stats, titles).
- **Rajdhani 600/700** — labels, body copy, buttons, briefs. Heavy tracking (0.18–0.35em).
- **Share Tech Mono** — ticker tape, `SYS://` labels, status logs, small tabular readouts.
- ALL-CAPS everywhere except mission prose. Numbers always tabular.

### 1.3 Shape & texture language

- **Chamfered corners** everywhere (clip-path polygons) — `.cut`, `.cut-sm`, `.cut-xs`.
- **Corner brackets** on every panel: notched L-brackets with glow (`filter: drop-shadow`).
- **Hazard stripes**: `repeating-linear-gradient(45deg, var(--acc) 0 8px, transparent 8px 16px)`
  used on loading bars, deploy button sweep, warning edges. This is a signature motif.
- **Hex-dot grid** on menu backdrops and empty preview areas.
- **Scanlines + noise flicker** overlays on full-screen layers (very subtle in HUD).
- **Angular dividers**: diagonal slashes, stepped section labels (`// SECTION — 01`).

### 1.4 Motion vocabulary

- **Shutter wipe** on scene transitions (two half-screen black bars closing/opening).
- **Staggered entrance** on menus: children rise + fade with 40–70ms delays.
- **Glitch** on the wordmark and result headline (clip-path slice animation).
- **Ticker marquees** (CSS keyframe translate, content duplicated ×2 for seamless loop).
- **Pulse/glow** on interactive selection; hover lifts elements 2–3px with border glow.
- **Shine sweep** across primary buttons (pseudo-element gradient that slides on hover).
- All game-critical warnings (grenade, low HP, low ammo) use fast 0.45–1s pulses.
- The old "deliberately quiet" philosophy is gone. The HUD is alive.

---

## 2. SCREEN-BY-SCREEN SPEC

### 2.1 MAIN MENU — "COMMAND DECK"

**Composition (layers, bottom → top):**
1. Background image (`public/menu-bg-2.jpg`) with slow Ken Burns pan (20s alternate),
   desaturated + dark gradient overlay, plus animated hex-grid tint and vignette.
2. Full-screen scanline + flicker overlay (opacity ≤ 0.07).
3. **Top ticker tape**: full-width, 34px, `Share Tech Mono`, scrolling forever:
   items like `RECOIL FPS // SECTOR AL-RASUL // THREAT LEVEL: VETERAN // UNLIMITED AMMO
   SUPPLIED // COMMAND LINK: STABLE // BUILD 2.1.0 //` separated by hazard-stripe slashes.
4. **Header row**: wordmark left — glitch-animated `/// RECOIL` in Orbitron 900 with an
   orange slash-mark; right side: `FULLSCREEN` utility button + `SETTINGS` utility button +
   a small `SYS LINK` chip with a pulsing volt dot.
5. **Main grid** (2 columns, centered, max-width 1340px):
   - **Left — Operation brief:**
     - Eyebrow: `// OPERATION BRIEF` with a blinking block cursor (`▮`).
     - Massive title: `RECOIL` (Orbitron 900, clamp 56–112px, near-white with subtle
       gradient) and `FPS` beneath in smaller tracked letters with hazard-stripe underline.
     - Operation name chip: `OP.` + mission name (Orbitron).
     - Mission brief paragraph (Rajdhani 17px, muted).
     - **DEPLOY** primary button: full-width ≤ 320px, chamfered, hazard-stripe accent bar,
       hover = orange glow + arrow slide + shine sweep. Label: `START MISSION`.
     - Secondary text button `SETTINGS — CONTROLS, AUDIO & GRAPHICS`.
     - Input legend row of keycaps: `WASD` `RMB` `1-5` `G` `X` `ESC`.
   - **Right — Operation select:**
     - Section label `// AREA OF OPERATIONS` + `01 / 02` counter.
     - Two **map cards** (al-rasul, kasbah): chamfered, numbered `01/02`, map name
       (Orbitron), mission type line, difficulty tag chip, animated corner brackets when
       selected + volt `SELECTED` indicator; hover = lift + cyan edge glow. Selected card
       gets an animated scanning line across it.
     - **MISSION ROUTE** vertical timeline: connected line with node dots per phase; each
       row = hex number chip, phase title, location, timing chip (`60 SEC`, `25 SEC FUSE`).
       Completed node styling must not be needed here (menu always shows all pending) but
       rows should pulse subtly on hover.
     - Rules line (exact string preserved): `Reach the pickup to extract. Clearing the map
       is not the objective.`
6. **Footer bar**: left `ACTIVE SECTOR: {map name}`, right `{DIFFICULTY} DIFFICULTY ///
   UNLIMITED AMMO /// RENDER: WEBGL`.
7. **Entrance choreography**: shutter bars open over 0.6s, then staggered `seq` rises:
   eyebrow → title → buttons → right column (delays 0.05/0.12/0.22/0.3s). Wordmark glitches
   once on mount.

### 2.2 LOADING — "DEPLOY SEQUENCE"

Fullscreen overlay while `launching`:
- Carbon backdrop + hex grid + vignette + scanlines.
- Center stack: rotating radar sweep ring (CSS conic sweep), pulsing `DEPLOYING // `
  prefix, cycling status lines (`CALIBRATING OPTICS`, `ARMING REINFORCEMENTS`,
  `LINKING COMMAND SAT`, `SYNCING SECTOR GRID`, `SPOOLING WEAPON SYSTEMS`), a hazard-stripe
  progress bar with looping fill and a `Share Tech Mono` percentage readout that counts
  0→100 over ~6s and loops.
- Bottom: `ESC` hint `ESC TO ABORT` is not wired — do not claim it; instead show
  `DO NOT POWER OFF TERMINAL` joke line in mono.

### 2.3 PAUSE — "OPERATION SUSPENDED"

- Fullscreen dim layer: `rgba(4,6,10,.82)` + heavy backdrop blur + grid + scanlines.
- **Left column:**
  - Eyebrow `// SYSTEM PAUSE`, giant `PAUSED` (Orbitron 900, 64px) with a slow glitch.
  - Action list (numbered `01–04`, hover slides right + orange bar):
    `RESUME MISSION`, `SETTINGS`, `RESTART MISSION`, `ABORT TO MENU` (danger styled).
    Resume is visually primary (chamfered filled).
  - ESC keycap hint chip.
- **Right column — current operation card** (chamfered panel with corner brackets):
  - Header: `OPERATION {name}` + frozen clock (`missionClock`).
  - Big phase index `01 / 05`, phase title, brief.
  - Progress bar with hazard-stripe fill at `mission.progress`.
  - Objective readout (value + label), `TIMERS FROZEN` mono note.

### 2.4 RESULTS — "AFTER-ACTION REPORT"

- Fullscreen backdrop like pause but with **win/lose tint** (volt-ish dark on win, red-dark
  on loss).
- **Rank stamp** (computed from win + kills + accuracy, grades S/A/B/C/D): a big circular
  seal with double ring + cross-hatch, stamped in at 45° rotation with `rank-slam` animation
  and `/// GRADE S ///` in mono underneath.
- Headline: `EXTRACTION COMPLETE` (volt) or `MISSION FAILED` (danger), Orbitron 900
  clamp(32–58px), with one-shot glitch.
- **Stats grid** (4 cells): OBJECTIVES `x/5`, MISSION TIME `mm:ss`, ACCURACY `xx%`,
  ELIMINATIONS `n` — animated with `CountUp`, dividers between cells.
- **Timeline**: phase rows with animated fill bars (width transitions), status chips
  (`COMPLETE` volt / `INTERRUPTED` warn / `NOT REACHED` dim), elapsed time per phase.
- Footnote (pressure stats, headshots) in mono.
- Actions: `REDEPLOY` primary + `RETURN TO BASE` ghost.

### 2.5 SETTINGS — "SYSTEM CONFIGURATION"

- Fullscreen dim + blur. Centered chamfered panel (max-w-5xl) with glowing corner brackets
  and a header: `SYSTEM CONFIGURATION` + mono subtitle `OPERATOR PREFERENCES // LIVE APPLY`.
- **Tab rail** (left): icons in hex chips, label, active state = orange left bar + glow +
  `▸`. `RESTORE DEFAULTS` danger button below.
- **Panes** (right, scrollable, thin orange scrollbar):
  - **GAMEPLAY**: sliders (sensitivity, ADS multiplier, FOV), invert toggle, difficulty
    segmented chips, map cards (restyled to match menu cards, compact).
  - **GRAPHICS**: 4 quality preset chips (`PERFORMANCE/BALANCED/QUALITY/ULTRA` with
    `DEFAULT`/`FPS`/`GPU`/`MAX` tags), sliders (resolution scale, brightness, bloom,
    vignette, film grain, camera shake), segmented shadow quality, FPS counter toggle.
  - **AUDIO**: master volume slider (hazard fill), voices toggle, mono spec block about
    HRTF audio with a pulsing waveform decoration.
  - **RETICLE**: color swatches (hex, glow on selection), length/gap/thickness sliders,
    center-dot toggle, live preview panel (hex grid, animated crosshair drift on hover).
  - **CONTROLS**: two-column key-binding reference table, keys rendered as keycaps.
- **Sliders**: 3px track, hazard-stripe fill portion, 14px square thumb with glow that
  scales 1.25× on hover/drag, tick marks at quartiles, value badge right-aligned in mono.
- **Toggles**: 38×18 pill, knob slides with spring easing, on = orange glow.
- **Segmented**: chamfered chips, active = orange fill + glow + dark text.

### 2.6 IN-GAME HUD

All elements pointer-events-none. Palette per function: volt = life, orange = brand/ammo,
cyan = tech, red = danger. Every element must visibly glow (drop-shadows) over the 3D world.

**Global layers:**
- Four **frame corner brackets** (fixed corners, orange, subtle) — HUD "frame".
- Ultra-subtle scanline overlay (opacity 0.04) + existing damage vignette + flash overlay.

**Top-center — Compass:**
- 460px wide strip, tick marks every 5°, cardinal letters N/E/S/W (Orbitron), intercardinals
  dimmed, degree readout chip beneath (`000°`, mono, orange), objective bearing chevron
  (volt diamond with glow), ping indicators (red diamonds), center notch in orange.

**Top-left — Objective tracker** (panel with corner brackets, orange left edge bar):
- Kicker: `{mission.name}` mono + `01/05` counter.
- Phase progress pips (done = volt, current = orange glow, pending = dim).
- Title (Orbitron 700), brief (Rajdhani).
- Readout: big value (Orbitron 21px, orange) + label; timed missions get a progress ring.
- Progress bar (clear/destroy) with hazard-stripe fill; warning state pulses red.
- Location row: rotating bearing arrow + name + distance.

**Top-right — Kill feed:**
- Rows slide in from right (transform+opacity), chamfered dark chips, left border orange;
  `YOU` in orange, weapon in cyan mono, victim in white, skull `☠` in red for headshots.
- FPS chip below when `showFps`: volt ≥55, warn 35–54, red <35.

**Bottom-left — Vitals:**
- Framed panel: `VITALS` mono label + blinking volt dot.
- HP number (Orbitron 900, 30px, volt; red when <35 with shake pulse) + animated EKG
  polyline (volt, red when low, dash-run animation).
- 10-segment HP bar (volt→warn→red as HP drops).
- `ELIMINATIONS {n}` and `HOSTILES {n}` (red) readouts in mono.

**Bottom-right — Ammo:**
- Weapon name mono (orange), giant magazine number (Orbitron 900, 48px) with per-change
  tick animation; `∞` reserve chip (volt outline); empty = red shake, low = amber pulse.
- Magazine segments (up to 30, triangular chamfer, orange, red when ≤5) with stagger fill
  on reload.
- Grenade row: `[G] FRAG ×n` + `[F] FLASH ×n` with keycaps; cooking = red blink
  `◉ COOKING — RELEASE G`; `RELOAD` blink when mag ≤5.

**Bottom-center — NEW Tactical Radar (this did not exist before; you must add it):**
- Circular 168px dish, chamfered outer ring, clipped to circle.
- Inside: the real top-down map image (`hud.mapImage`) rotated by `-hud.bearing` so
  up = player forward, translated by `playerMap` so the player stays centered; enemy
  markers (`enemiesMap`) as pulsing red diamonds on the rotating layer; rotating conic
  sweep; range rings + cardinal ticks; fixed volt player arrow at center pointing up;
  `60M RANGE` mono label. Render only when `hud.mapImage` is non-empty. Cheap: it re-renders
  with the HUD tick but only transforms via GPU-friendly CSS.

**Center stack (unchanged logic, restyled):**
- Crosshair from settings with spread expansion; ADS reflex dot (orange glow); sniper scope
  (dark ring, mil-dots, red center dot) with vignette.
- Hitmarker: white X slashes, pop animation; kill = red + larger + `hm-kill` burst.
- Damage arcs: red radial glow clipped wedge, direction-aware, 1.5s fade.
- Flashbang overlay (existing) + slight cyan fringe tint.
- Grenade warning: `GRENADE` (Orbitron 900, red, pulsing) + rotating arrow + distance,
  nade-pulse 0.45s.
- Streak banners: Orbitron 900, 40px, orange glow, lines sweep out both sides, glitch-in.
- Score pops: `+100` orange / `+150 HEADSHOT` red, float-up fade.
- Mission phase banner: full-width center band with hazard-stripe edges, wipe animation,
  mono index `01` + title (Orbitron).
- Radio callout: bottom 19%, mono `RADIO` prefix, text-shadowed prose.
- Vault prompt `[SPACE] VAULT` chip; plant-charge prompt with hold progress (existing).
- Reload ring: circular progress (SVG dash) in orange around center.
- Proximity indicator: ring 92px around crosshair, arrow at nearest hostile (red <12m,
  warn <30m, dim otherwise), range chip + `{enemiesLeft} LEFT` under crosshair.

---

## 3. COMPONENT INVENTORY (shared primitives, `src/ui/components.tsx`)

| Component  | Purpose                                                          |
|------------|------------------------------------------------------------------|
| `Panel`    | Chamfered glass panel + glowing corner brackets + optional hex texture |
| `SectionTitle` | `// LABEL` mono eyebrow + gradient rule + optional sub-line  |
| `CBtn`     | Chamfered button, variants ghost/primary/danger, left accent bar, shine sweep |
| `Slider`   | Hazard-fill range with tick marks, square glowing thumb, mono value badge |
| `Toggle`   | Spring knob pill switch                                          |
| `Segmented`| Chamfered chip group, active glow                                |
| `ColorPick`| Hex swatches with glow ring                                      |
| `StatBar`  | Animated stat bar (used by timeline rows too)                    |
| `CountUp`  | Eased number counter (keep)                                      |
| `Key`      | Keycap glyph (keep)                                              |
| `Ticker`   | NEW — seamless marquee tape (duplicates children, CSS animation) |
| `GlitchText`| NEW — data-text glitch heading with layered clip-path slices    |
| `Hex`      | NEW — hexagon chip (icons, numbers, steps)                       |
| `Radar`    | NEW — the tactical radar dish described in §2.6                  |

## 4. ACCEPTANCE CRITERIA (verify before you stop)

1. `npm run build` passes with zero TypeScript errors.
2. `node --test` passes — including SSR render of `MainMenu` / `MissionObjective` and all
   string assertions.
3. No leftover references to old theme classes that no longer exist in CSS (grep for
   `chamfer-`, `operations-`, `mission-` legacy names and remove/replace).
4. Menu contains every phase title and the exact rules string; no hostile counts.
5. HUD renders at 60fps target — no per-frame style recalculations beyond transform/opacity.
6. Reduced-motion users get a static, still-legible UI.
7. All screens legible at 1280×720 and up; menu collapses to single column under 900px.
8. The user can deploy, play, pause, restart, finish, and redeploy without UI errors.

## 5. DELIVERY

Rewrite, in order: `src/index.css`, `src/ui/components.tsx`, `src/ui/Screens.tsx`,
`src/ui/Settings.tsx`, `src/ui/MissionObjective.tsx`, `src/ui/Hud.tsx`, `src/App.tsx`
(loading overlay, error toast, utility buttons — logic untouched), `index.html` (fonts,
favicon, title), `DEFAULT_SETTINGS.crosshairColor`, and add a new menu background asset
`public/menu-bg-2.jpg` referenced by the CSS. Then build, test, and commit.

The result must make a player say: *this looks like a AAA combat terminal, not a beige
spreadsheet.* Go.
