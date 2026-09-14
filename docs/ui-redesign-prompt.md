# OPERATION FACELIFT — COMPLETE UI REDESIGN FOR RECOIL FPS

## 0. READ THIS FIRST — WHAT THIS DOCUMENT IS

You are a senior game-UI art director and front-end engineer. Your job is a
**complete visual redesign of every 2D interface in Recoil FPS** — main menu,
loading screen, pause menu, results/debrief, settings suite, in-game HUD, and
the 3D armory/loadout terminal. The player’s exact complaint, which is your
mission statement:

> “I don’t like how the UI currently looks; it looks so robotic and
> AI-generated.”

Your redesign must make the game look like a **shipped, art-directed FPS**,
not a neon template. Every screen, every component, every color, every
typeface choice is yours to remake — but **every feature, flow, data contract,
and test must keep working**. This document tells you what exists today
(§1), what is wrong with it (§2), the exact art direction to execute (§3),
screen-by-screen specs (§4), the component system to build (§5), the motion
language (§6), the file plan (§7), the tests you must add (§8), and the
acceptance checklist (§9). Read the whole thing before touching a file.

**Stack facts (do not change these without a written reason):**
React 19.2 · Vite 7.3 (build: `npm run build`, single-file `dist/index.html`)
· Tailwind CSS v4 via `@import "tailwindcss"` + `@tailwindcss/vite` 4.1.17 ·
three.js 0.185 (armory viewer + game world only, never for 2D chrome) ·
TypeScript strict-ish (see `tsconfig.json`) · Google Fonts via
`<link>` in `index.html` (currently Orbitron / Rajdhani / Share Tech Mono —
you WILL replace this) · no component library · all UI styles live in one
file, `src/index.css` (~1340 lines). Dev server: `npm run dev`.
Full gate: `node scripts/validate.mjs` (eslint 0 warnings + tsc clean + all
Node tests + mutation gate) and `npm run build`. Both must pass when you finish.

---

## 1. INVENTORY — WHAT EXISTS TODAY (read every file listed)

### 1.1 App shell & flow — `src/App.tsx` (275 lines)

Five phases, one canvas underneath everything:

| Phase | Renders | Notes |
|---|---|---|
| `menu` | `<canvas>` + `MainMenu` | Canvas sits behind the menu (menu has opaque bg layers). |
| `playing` / `paused` | `<canvas>` + `Hud` (+ `PauseMenu` when paused) | HUD polls `engine.hud()` on a **50 ms interval** — your HUD DOM must stay cheap (no layout thrash, no giant re-renders). |
| `results` | `ResultsScreen` | Engine is paused; pointer lock released. |
| `armory` | `Armory` | Its own three.js canvas; entered from menu or results. |

Always-on chrome: `Settings` overlay (any phase), fullscreen toggle button
(all phases except `playing`), error banner (`mission-error`, dismissible),
`BootScreen` while `launching`. Pointer-lock flow (`requestLock` on deploy /
resume, auto-pause on lock loss, `blur` handler) is load-bearing — do not
touch the logic, only the visuals of the surfaces it shows.

Hidden dev affordance you must keep: `#cash=50000` URL hash on the menu
grants wallet cash once per pageload. Do not ship a visible cheat button.

### 1.2 Screens — `src/ui/Screens.tsx` (347 lines)

- **`MainMenu`** — full-screen command deck. Ticker strip; wordmark header
  (`/// RECOIL` + SETTINGS util button); left column: eyebrow, giant title,
  op-chip (mission name), mission brief paragraph, START MISSION deploy
  button, ARMORY button (with wallet readout), fielded-loadout strip
  (`1 M416` / `2 1911`), SETTINGS button, key legend; right column: AREA OF
  OPERATIONS map cards (2 maps, selected state, scan/sel decorations),
  MISSION ROUTE phase list (numbered, per-type timing badges), rules line;
  footer bar (sector + difficulty/ammo/render).
- **`BootScreen`** — deploy loading: radar rings anim, DEPLOYING title,
  cycling status line (5 lines), hazard progress bar, fake %, warning note.
- **`PauseMenu`** — SYSTEM PAUSE: 4 indexed actions (Resume / Settings /
  Restart / Abort), ESC hint, op card (mission name, clock, phase x/y,
  title, brief, progress bar, live readout value+label, “timers frozen”
  note). `aria-modal` dialog.
- **`ResultsScreen`** — after-action report: rotating grade stamp (S/A/B/C/D
  with tint), win/lose title, sub line, 5 stat cells (objectives, time,
  accuracy, eliminations, score) with count-ups, CASH EARNED card (grouped
  rows with stagger, difficulty row, grade-bonus row, wallet tween
  before → after), AFTER-ACTION TIMELINE (per-phase bars + statuses),
  pressure note, 3 actions (OPEN ARMORY / REDEPLOY / RETURN TO BASE).
  Win/lose re-themes via `.results-root.lose`.

### 1.3 HUD — `src/ui/Hud.tsx` (357 lines) + `MissionObjective.tsx` (70 lines)

`Hud` receives `{ hud: HudState; s: GameSettings; fx: HudFx }` and re-renders
at 20 Hz. Every element below must survive the redesign (position and style
may change; existence and data may not):

- Frame corners, red damage vignette (scales with missing HP, pulses < 35),
  white flashbang overlay.
- `MissionObjective` tracker (objective title/brief/readout — **pinned by
  tests**, see §2.1).
- Threat readout (nearest-enemy dot + range + ▲/▼) that dims in ADS.
- Compass: scrolling 5° ticks, N/E/S/W + intercardinal labels, objective
  marker, fading ping diamonds, center notch, bearing readout chip.
- Cash counter (mono, `$1,234`).
- Kill feed (YOU [WEAPON] victim + red `HS` tag on headshots), FPS chip
  (green/amber/red; only when `showFps`).
- Hip reticle: the shared `Reticle` component from `Settings.tsx` (user’s
  custom crosshair + live spread), hidden while sprinting / in ADS.
- ADS layer: scope darkening mask + one of four reticles — `sniper`
  (320px mil-dot tube), `dot`, `holo` (ring + dot), `acog` (chevron + BDC).
- `[SPACE] VAULT` chip, circular reload progress ring, X hitmarkers
  (white hit / red kill), directional damage arcs, GRENADE warning (arrow +
  distance), streak banner, RADIO callout, floating score pops
  (`+100` / `+150 HEADSHOT` / `+$50`), mission phase banner.
- Tactical radar: 60 m zoom dish, rotating world image, enemy blips,
  objective ring+dot (extract variant), N/S/E/W cards, sweep, player wedge,
  `60M` label. Driven by `mapImage`, `playerMap`, `enemiesMap`,
  `missionMap`, `bearing` — keep the math, reskin the dish.
- Ammo block: weapon name, 1/2 loadout card (held highlight), big mag
  count (red at 0, amber ≤ 5, `RELOAD` blink), `∞` reserve chip, mag
  segment pips, Masterkey shell pips + `[B]`, `BIPOD DEPLOYED` tag,
  G/F grenade row with keycaps, `COOKING` warning.
- Onboarding strip (first 12 s of a mission, fades).
- Vitals card: LIVE dot, big HP (red < 35), EKG polyline (faster when low),
  10-seg HP bar, ELIMINATIONS / HOSTILES / SCORE.

### 1.4 Settings — `src/ui/Settings.tsx` (204 lines)

Modal `Panel`: header (title + “Changes apply instantly” + × CLOSE), tab
rail (GAMEPLAY / GRAPHICS / AUDIO / RETICLE / CONTROLS + RESTORE DEFAULTS),
scrollable pane. Tabs own: aim/view sliders + invert + ADS toggle +
difficulty segmented + map picker (gameplay); 4 quality presets + resolution
/ shadows / adaptive-res / FPS counter + brightness / bloom(+strength) /
vignette / grain / shake (graphics); master volume + voices toggle + HRTF
info block (audio); color/length/gap/thickness/dot + LIVE PREVIEW box
(reticle — preview uses the shared `Reticle`, also rendered in-HUD);
fixed-binds reference grid (controls). Also exports `Reticle`.

### 1.5 Shared components — `src/ui/components.tsx` (189 lines)

`Panel` (bracketed card), `SectionTitle`, `CBtn` (ghost/danger),
`Slider`, `Toggle`, `Segmented`, `ColorPick`, `StatBar`, `CountUp`,
`Key` (keycap), `Ticker` (marquee), `Hex` (hex badge). You may rewrite every
one of these — but every call site must keep working with the same props.

### 1.6 Armory — `src/ui/armory/` (`Armory.tsx` 439, `GunViewer.tsx` 575, `CashCounter.tsx` 62)

Floating-glass command UI over a 3D stage. Keep the whole flow, reskin the
furniture: command bar (back / wallet / deploy), weapon rail (PRIMARY /
SECONDARY tabs, scrollable cards with keyboard ↑↓/Enter nav, locked states,
prices, `min-height: 0` scroll fix — DO NOT regress scrolling), 3D stage
(GunViewer: orbit/zoom, raycast click-picking, projected socket hotspot
buttons with labels, active ring, attach flash, auto-orbit that honours
`prefers-reduced-motion`), stat lab (stat bars with hover ghost-deltas),
finish picker, part menu (per-slot parts with tier pips, BUY/EQUIP/STRIP
states), equipped-chips bar, toast system, 4-step coach-mark tutorial with
spotlight rings. `CashCounter` is a rolling odometer — keep the roll,
reskin the digits. Gun display names are short and final: M416, AK-47, 1911,
AWM, MP, Vector, SPAS, SCAR, Deagle, M249 (shorts identical; engine shows
them uppercased).

### 1.7 Styles — `src/index.css` (~1340 lines) + `index.html` fonts

Tailwind v4 (`@import "tailwindcss"`) plus a hand-rolled “VOLT PROTOCOL”
system: tokens (`--bg #05070B`, `--bg2`, `--acc #F06A2E` blaze orange,
`--acc-2`, `--volt #3FD68E`, `--cyber #58BFE4`, `--danger`, `--warn`,
`--panel`, `--line`, `--mono`), cut-corner clip paths (`.cut/.cut-sm/.cut-xs`),
`.hex-grid`, `.scanlines`, `.noise-flicker`, `.hazard-fill/.hazard-edge`,
`.brk` corner brackets, `.panel-bg`, `.glow-*` text shadows, per-screen
sections (menu, boot, pause, results, settings, HUD + radar/scope/vitals/
ammo, armory + odometer/stage/rail/chips/scrollbars), two
`prefers-reduced-motion` blocks, 720p fit rules. §3 explains why nearly all
of this visual language must go. §7 tells you what to do with the file.

---

## 2. NON-NEGOTIABLE CONSTRAINTS

### 2.1 Functionality parity — change zero behaviour

- Every screen, button, slider, toggle, tab, chip, row, banner, and flow in
  §1 must exist and work after your redesign. If the player could do it
  before (buy, equip, strip, pick finishes, change maps/difficulty/volume/
  reticle, pause/resume/restart/abort, redeploy, open armory from two places,
  dismiss errors, toggle fullscreen), they can still do it, with the same
  props/state plumbing. Restyle, don’t rewire.
- Engine contracts are frozen: `HudState`, `HudFx`, `GameEvent`,
  `GameSettings` + `DEFAULT_SETTINGS` shapes; the 50 ms HUD poll; the
  pointer-lock/blur/phase logic in `App.tsx`; `armLoadout` naming
  (`entry.name.toUpperCase()`); profile key `recoilfps.profile.v2`;
  settings key `recoilfps.settings.v1`; the `#cash=` dev hash.
- Test-pinned strings (from `tests/mission-integration.test.js` — these
  exact substrings must remain in SSR markup): the objective title + brief,
  `Current mission objective`, the map name, every mission phase title in
  the menu, `Reach the pickup to extract`; and the menu must NOT contain
  `21 HOSTILES`. Other tests pin economy/geometry/mission logic you won’t
  touch — keep them green regardless.
- The 3D stays: GunViewer’s three.js scene (lights, orbit, picking,
  hotspots-as-projected-DOM) and the game world renderer are out of scope
  except for the DOM/CSS around them. You may adjust hotspot/chrome styling
  but not the projection math, raycast, or disposal logic.
- Reduced motion: both existing `prefers-reduced-motion` blocks must
  survive in spirit — every animation you add needs a reduced-motion
  fallback (see §6.4), and GunViewer’s `matchMedia` auto-orbit kill stays.
- No emoji, anywhere, ever — no `🔒`, no `✓`, no glyphs that render as
  color emoji on any platform. Status = CSS/SVG/text. (Geometric text glyphs
  already in use — `● ○ ◉ ▲ ▼ ◆ ◈ ⌨ ▸ × +` — are acceptable because they
  render monochrome, but prefer inline SVG for anything load-bearing.)
- Responsive floor: everything must remain reachable and unclipped at
  1280×720 (the existing 720p comments mark past battles — menu route list,
  six-phase timelines, armory grid). Test 1920×1080 and 1280×720.
- Performance: HUD re-renders 20×/second. No backdrop-blur the size of the
  viewport, no animating `box-shadow`/`filter` on persistent elements, no
  per-frame layout reads. Prefer `transform`/`opacity` animation only.
- Accessibility: keep all `role`/`aria-*` attributes and `aria-modal`
  dialogs; visible focus states on everything interactive (restyle
  `:focus-visible`, don’t remove it); keyboard-only flows keep working
  (armory rail nav, modal close, menu buttons); color is never the ONLY
  signal (pair it with text/shape).

### 2.2 Engineering constraints

- No new runtime dependencies unless you justify them in your final report
  (a fontsource package or a tiny utility is fine; a component framework is
  not). Google-Fonts `<link>` swaps are free.
- `node scripts/validate.mjs` must pass (0 eslint warnings, tsc clean, all
  tests, mutation gate) and `npm run build` must pass with no console
  errors/warnings in dev. Run both before you declare done.
- No `TODO`/`FIXME`/`phase 2`/“later” anywhere in the diff. No dead CSS
  (if you orphan 200 selectors, delete them). No `!important` wars — if you
  need one, you’ve lost the cascade; restructure instead.

---

## 3. DIAGNOSIS — WHY IT LOOKS “ROBOTIC AND AI-GENERATED”

Study this list; your redesign must eliminate every item. References are to
`src/index.css` unless noted.

1. **Motif soup.** Hex grids + scanlines + noise flicker + corner brackets +
   hazard stripes + glitch text + cut corners + ticker marquee appear on
   nearly EVERY screen (menu bg, pause layer, results, boot, settings
   preview, armory glow). Real game UI picks ONE material language per
   surface. When everything shouts, nothing does — and the combination
   (neon + hex + scanlines + glitch) is the single most recognisable
   “AI-generated gamer UI” fingerprint in existence.
2. **The neon-on-carbon cliché.** Carbon black + blaze orange + volt green +
   cyber cyan + hot red, all at full saturation, all glowing
   (`.glow-acc/.glow-volt/.glow-cyber/.glow-red`, half the HUD). It looks
   like a cyberpunk template, not a military shooter. Orange means nothing
   when it’s also the border, the text glow, the progress fill, the bracket,
   the stripe, and the button.
3. **Typography shouting.** Orbitron (a novelty display face) is used for
   body-adjacent content (`h1,h2,h3,.tabnum,.ammo-num,.mono,…`), nearly
   everything is ALL-CAPS with wide tracking, and three “techy” families
   fight on one screen. Real FPS UI pairs ONE condensed display face with a
   quiet grotesque and uses mono ONLY for numerals/readouts.
4. **Decoration instead of hierarchy.** `///` slashes, `//` comments-as-copy
   (`BUILD 3.0.0 // GROUND ZERO`), `▸` chevrons, `◈◆` tab icons, stamped
   `/// GRADE B ///` labels, diamond pings, bracket corners on every card.
   Ornament is doing the job that spacing, scale, and weight should do.
5. **Glassmorphism defaults.** `panel-bg` (blur + 1px line + big soft
   shadow) is stamped on pause cards, settings, armory panels alike — the
   mid-2020s AI-UI default. Frosted glass over a busy 3D scene also hurts
   readability; it should be the exception (armory stage), never the rule.
6. **Copy that performs “military” instead of informing.** `OPERATION BRIEF`,
   `DO NOT POWER OFF TERMINAL`, `ALL MISSION TIMERS FROZEN`,
   `SUPPLY UNLIMITED AMMO`, `LINKING COMMAND SAT`. A touch of flavor is good, but when every label cosplays as a terminal it becomes noise. (You may rewrite copy
   where it doesn’t break §2.1 pinned strings — keep it terse and human.)
7. **Inconsistent light logic.** HUD glows cyan, menus glow orange, results
   glow green-or-red, armory glows violet-blue. There is no single light
   source or signal-color grammar. Pick one (§4 in §3’s replacement below).

If your redesign keeps scanlines, hex grids, glitch titles, hazard-stripe
progress bars, or glowing neon text as load-bearing decoration, you have
failed this brief no matter how pretty it is.

---

## 4. TARGET ART DIRECTION — “PRINT ROOM AT A FORWARD OPERATING BASE”

This is a decision, not a suggestion. Execute exactly this direction unless
you can articulate a better one in your final report AND it still satisfies
every anti-slop rule below.

### 4.1 The fantasy

The UI is printed matter and painted steel in a field headquarters: stencilled
crates, ops-board printouts, grease-pencilled acetate over a map, a warm task
lamp over the workbench. Surfaces are SOLID and tactile, not glassy. Light is
warm tungsten from above, not cyan from everywhere. Information is set like a
well-designed field manual: big condensed headlines, quiet grotesque body,
tabular numerals, hairline rules, generous whitespace. The armory is a
workbench under that lamp — dark oiled steel, brass screws, stencil labels —
with the 3D gun lit like a product on the bench.

### 4.2 Palette (light Values are sRGB hex — use these, not vibes)

- `--ink: #12100C` — page black (warm, not blue-black). Primary surfaces.
- `--ink-2: #1B1813` — raised surfaces, cards, wells.
- `--bone: #EDE4D3` — primary text. Warm paper white.
- `--bone-dim: #A79E8B` — secondary text. Warm gray.
- `--signal: #FF4D00` — international orange. THE action color: primary
  buttons, live dots, warnings-that-need-action, the deploy CTA, kill
  confirmations. If it isn’t clickable-or-critical, it isn’t orange.
- `--brass: #C89B5A` — metallics, dividers, premium accents (armory trim,
  grade stamp ring, slider fills). Never for text on dark below 14px.
- `--olive: #7A7A52` — success/complete/ally states, HP-high, objective
  markers. Muted, never neon.
- `--blood: #C8321E` — damage, failure, low HP, enemy blips. Deep red, no glow.
- `--steel: #8B93A0` — HUD glass text over 3D, radar furniture, disabled
  states. Cool gray ONLY for in-world overlay legibility.
- Rules: bone text on ink (never pure white on pure black); ONE signal
  color per screen region; olive/blood are state-only; brass is trim-only;
  steel appears ONLY in the HUD and radar. No gradients except subtle
  top-light on solid panels (`linear-gradient(rgba(255,244,230,.05),
  transparent 40%)` max) and the vignette. No purple, no cyan glow, no volt
  green — those tokens get deleted.

### 4.3 Typography (swap the Google Fonts link)

- Display: a condensed grotesque with real weights — **Barlow Condensed**
  (600/700, auto `font-stretch` where supported) or Oswald. All headlines,
  buttons, stat numerals, menu titles. Uppercase with 0.04–0.10em tracking.
- Body/UI: a quiet humanist sans — **Inter** or system stack. Briefs,
  descriptions, settings hints, tooltips, timeline text. Sentence case.
- Numerals: tabular figures everywhere numbers appear
  (`font-variant-numeric: tabular-nums`). Mono (ui-monospace stack — DROP
  the webfont mono) ONLY for: cash values, clock readouts, bearing/range,
  version/build stamps. Never for labels or buttons.
- Scale (1080p reference): hero 64–96 / section 20–28 / body 15–16 /
  micro-label 11–12 tracked caps. Enforce a modular rhythm; kill the
  current 9px-micro-label-everywhere habit (minimum 11px for labels,
  13px for interactive text).
- Copy voice: terse, dry, human. “Resume” beats “RESUME MISSION” when the
  header already says Paused. Cut every `///`, `//`, `[BRACKETS AS DECOR]`,
  and terminal cosplay that isn’t a pinned string.

### 4.4 Material, depth, light

- Surfaces are solid ink/ink-2 with 1px `--line: rgba(237,228,211,.12)`
  hairlines — no blur panels except directly over 3D (armory stage glass,
  HUD chips). Depth = layered solids + top-light + hard offset shadows
  (`0 2px 0 rgba(0,0,0,.6)`), never soft 60px blurs.
- Texture: ONE subtle grain overlay (`feTurbulence` SVG data-URI at 3–4%
  opacity) on menu/results/pause backdrops — paper, not scanlines.
- Stencil labels: micro caps with letterspacing and a hairline rule, flat
  bone-dim, NO glow, NO brackets. Corners: 2–3px radius on cards, sharp on
  chips/buttons (keep ONE corner language — pick sharp-with-2px, delete the
  three clip-path `.cut` variants or keep exactly one for tags).
- The 3D armory stage keeps its vignette + task-lamp gradient but loses the
  violet glow; hotspot buttons become brass-ringed steel pins with stencil
  labels.

### 4.5 Anti-slop rules (violating ANY of these fails review)

1. No purple/blue/cyan gradients, glows, or “cyber” anything.
2. No hex grids, dot grids, scanlines, noise-flicker, or glitch effects.
3. No hazard stripes, caution tape, or corner brackets as decoration
   (brackets may survive ONLY as focus/selection affordances if restyled).
4. No glassmorphism cards (blur + translucency + soft shadow) except the two
   sanctioned over-3D cases in §4.4.
5. No Orbitron, Rajdhani, or Share Tech Mono anywhere after you finish.
6. No uppercase-everything: body copy, hints, and descriptions in sentence
   case; caps reserved for display type and micro-labels.
7. No emoji and no emoji-adjacent glyphs (see §2.1); tab icons become inline
   SVG or clean geometric pins.
8. No lorem ipsum, no placeholder copy, no `TODO` visuals.
9. No new motif shall appear on more than two screens unless it’s the
   stencil label, the hairline rule, or the signal color.
10. Every screen must pass the “screenshot test”: a 1080p capture should
    look like one coherent product — same type, same palette, same spacing
    rhythm — not five templates stitched together.

Reference shelf (study before designing): Call of Duty HQ / Gunsmith menus
(typographic restraint, single-accent economy); Hell Let Loose deploy + map
screens (print/pin-board tactility); Escape from Tarkov trader services
(dense utilitarian commerce without neon); Squad spawn screen (earnest
military plainness). Anti-reference: any “futuristic HUD pack”, Valorant
clones, Valorant-agent-select pastels, fibre-optic dashboards.

---

## 5. SCREEN-BY-SCREEN SPEC

General: keep every DOM id/role/aria hook and every data field; you are
free to reorder layout, rewrite CSS, and restructure TSX as long as
behaviour and §2.1 pinned strings survive. All sizes are 1080p reference;
verify 720p.

### 5.1 Main menu (`MainMenu`)

Keep: ticker content (or a worthier ambient strip), wordmark, mission
brief + op name, START MISSION, ARMORY + wallet, loadout strip, settings
entry, key legend, 2 map cards with selection, mission-route list with
per-type timing, rules line, footer facts. Kill: scanlines/hex/shutters/
glitch wordmark, `///`, giant stacked novelty title, decorative chevrons.
New composition: a two-column ops board — left: stencil eyebrow, ONE strong
condensed headline (mission name, not the word RECOIL twice), brief in body
sans (max 60ch), a single signal-orange START MISSION bar with keyboard
hint, quiet secondary row (Armory with wallet chip, Settings), loadout as a
proper “FIELD KIT” card (slot numerals, gun names, view-loadout affordance);
right: map cards as dossier plates (name, terrain, phase count, selected =
brass spine + filled pin, not glow), route as a ruled manifest with phase
 numerals and timing right-aligned; footer as a thin status rule. The key
legend becomes a single muted row with real keycaps. Background: layered
ink solids + paper grain + a faint oversized stencil numeral of the
operation number — no grids, no flicker.

### 5.2 Boot / deploy (`BootScreen`)

Keep: status line cycling, progress bar + %, the 5 boot lines (rewrite the
copy drier: `ZEROING OPTICS`, `MUSTERING SQUAD`, `UPLINK HANDSHAKE`,
`GRID SYNC`, `ARMING WEAPONS`). Kill: radar rings, glitch title, hazard
bar, `DO NOT POWER OFF TERMINAL` (replace with something human or drop).
New: near-black screen, centered stencil plate — mission name in display
type, a hairline progress rule with a brass fill and tabular %, status line
in body sans, small animated stencil ellipsis (steps, reduced-motion-safe).
It should feel like a stencil being stamped, not a terminal being hacked.

### 5.3 Pause (`PauseMenu`)

Keep: 4 actions + indices, ESC hint, op card (name/clock/phase/title/
brief/progress/readout/frozen-timers note). Kill: hex/scanlines, glitch
title, bracket corners, hazard progress. New: dim the frozen world
slightly, float ONE ink-2 card left (PAUSED stencil + action stack as full-
bleed rows with index numerals and hover brass spine) and the op card right
(ruled manifest style, tabular clock, thin brass progress rule). Resume is
the only signal-orange row. The whole layer must read in under a second.

### 5.4 Results (`ResultsScreen`)

Keep: grade + tint logic, title/sub, all 5 stat cells + count-ups, cash
card (grouped rows + stagger + difficulty + grade bonus + wallet tween),
timeline bars + statuses, pressure note, 3 actions, win/lose theming.
Kill: stamp rings + glow grade, glitch title, hex bg, hazard fills,
`/// GRADE ///` label. New: an after-action REPORT — bone paper? No: keep
it dark (it follows gameplay), but set it like print: grade as a large
stencil letter with a brass ring (no glow, tint only the letter), title in
display caps, stats as a ruled 5-column table (label micro-caps above,
tabular numerals below, hairline dividers), cash card as a ledger (rows
with dotted leaders, totals rule, wallet line with the odometer kept),
timeline as a manifest with thin status bars (olive complete / steel
pending / blood interrupted). Win = olive accents; lose = blood accents;
signal orange appears ONLY on the primary action (OPEN ARMORY on win,
REDEPLOY on loss — keep both buttons’ existence, restyle emphasis).

### 5.5 Settings (`Settings`, all five tabs + `Reticle`)

Keep: every control and its exact setting key (sensitivity, adsSensitivity,
fov, invertY, adsToggle, difficulty, map, 4 presets, resolutionScale,
shadowQuality, adaptiveResolution, showFps, brightness, bloom,
bloomStrength, vignette, filmGrain, cameraShake, masterVolume, voices,
crosshairColor/Size/Gap/Thickness/Dot, RESTORE DEFAULTS, live preview,
binds grid). Kill: `◈◆◉⌨▸` tab glyphs (inline SVG icons), bracket corners,
scanline preview bg, SHOUTING hints. New: a proper preferences panel — tab
rail as quiet rows with SVG icons and a brass active spine; panes with
section titles (display caps + hairline), controls on a 8px rhythm grid;
sliders = thin steel track + brass fill + square thumb with tabular value;
toggles = steel/bone switches (no neon); segmented = joined steel buttons;
presets = 4 dossier plates with radio semantics; map picker = 2 plates with
terrain + objectives; reticle preview = dark well with crosshair grid
furniture (keep the shared `Reticle` component pixel-behaviour identical);
binds = two-column ledger with real keycaps. Hints in sentence-case body
sans, 13px minimum.

### 5.6 HUD (`Hud` + `MissionObjective` + `Reticle`)

The hardest surface: it must be beautiful AND instantly readable over a
bright desert at 20 Hz. Keep every element and data binding in §1.3.
General rules: HUD chrome is steel-on-dark-translucent (`rgba(10,9,7,.55)`
chips, NO blur except the radar dish and scope mask), bone/steel text,
signal orange ONLY for (a) hitmarker kills? No — kills stay blood red;
orange is for (b) the live objective marker/pips, (c) the vault + reload
urgency states, (d) score pops for cash? No — cash pops stay bone, kills
stay blood. Concretely: orange = “act now / you did the thing” (vault,
reload ring, streak label, mission banner numeral). Everything else goes
steel/bone/olive/blood per §4.2. Kill ALL glows except a 1px legibility
shadow (`0 1px 2px rgba(0,0,0,.8)`) on text over 3D. Compass: thin steel
ticks, bone cardinals, brass objective diamond, blood ping diamonds that
fade — no glow. Reticles: keep all four geometries EXACT (sniper mil-dots,
dot, holo ring, ACOG chevron+BDC) — recolor only (bone/black with blood
center pip; holo ring brass?). Radar: restyle the dish as a steel-ringed
instrument (thin rings, brass sweep, bone cards, blood blips, olive
objective ring, bone extract ring) — keep the zoom math and 60M label.
Ammo block: weapon name in display caps, mag numeral HUGE tabular bone
(blood at 0, signal at ≤5 with stencil RELOAD), pips as steel ticks with
olive fill (blood when low), keycaps square steel. Vitals: ink chip,
tabular HP, EKG in olive (blood when low — keep the speed-up), 10-tick HP
bar, stats as micro-ledger. Killfeed: quiet rows (bone text, blood HS tag,
steel weapon chip). Streak/callout/score/mission banners: stencil plates,
center-top stack with clear priority (mission > streak), mechanical
in/out (see §6). Damage arcs + vignette + flash: keep behaviour, retune
colors into the blood ramp. Onboarding strip + grenade warning + cooking:
restyle into the same chip language.

### 5.7 Armory (`Armory` + `GunViewer` + `CashCounter`)

Keep the entire flow and every behavior in §1.6 (tabs, scroll+keyboard
nav, orbit/pick/hotspots/flash, ghost deltas, tiers, buy/equip/strip,
finishes, chips, toasts, 4-step tutorial, deplo
...[truncated 16395 chars]