## 2026-09-23 — Bomb Defusal: round-based 5v5 competitive mode

New Arena mode alongside TDM, built on the Warehouse yard: CS-style Bomb Defusal. Two bomb sites (A · Wreck Yard, B · Crane Dock) with purpose-built cover (plant-stack crates, stacked back-wall containers, jersey-barrier lips), painted boundaries and big stencilled site letters on the floor and on signage. Attackers carry the C4 (a modelled prop on the carrier's back) and plant with X (3.2 s); defenders defuse with X (10 s, 5 s with a kit). The fuse is 40 s with CS-accelerating beeps and a blast that kills anything within the radius. One life per round: dead players get a chase-cam spectator (LMB/RMB to cycle).

Full match loop: 12 s freeze/buy phase, 1:45 rounds, halftime side swap with economy reset, match point, and a sudden-death decider at $10,000 each on a regulation tie. Formats are Short (first to 5, 8 rounds) and Competitive (first to 7, 12 rounds), and you pick your start side (attack, defend or random).

CS economy: $800 pistol rounds, a win reward per win condition, a 1400→3400 loss-bonus ladder (−1 notch per win), an $800 team plant bonus, the time-expiry "save tax" on surviving attackers, and per-weapon kill rewards (AWM $100 … SPAS $900). The in-match buy menu (B, inside the 20 s buy window) has 3D gun renders with damage/rate/control/mobility bars, two-level keyboard buying (category digit → item digit), side-locked items, a helmet-upgrade discount and AUTO-BUY. Bought guns spawn with your Armory attachments and finishes. H drops the bomb for a teammate.

Bot director, per round:
- Bots buy with team economy discipline (eco / force / full buy).
- Attackers split into yard and hall stacks, with a lurker. They execute a site, plant, and play post-plant crossfires.
- Defenders run a 2-2-1 setup and rotate on intel.
- Retakes are coordinated: defenders stage and swing in together instead of trickling in.
- Objective bots LOS-check up to 3 nearest enemies rather than only the closest, so they no longer ignore visible shooters.
- Bots hear running enemies within 12 m, while stationary angle-holders stay silent and get a reaction/accuracy edge, which recreates the CS peeker/holder asymmetry.

Balance was tuned with a headless full-match simulator (`scripts/defuse-sim.ts`): attack wins 54% over 237 simulated rounds, with elimination, bomb, defuse and time endings all occurring.

HUD:
- Round scorebar with ATK/DEF tags, alive pips (bomb carrier marked) and a clock that turns into a pulsing C4 + site letter once planted.
- Plant/defuse progress bar with a keypad readout and context hints.
- Carrier badge, buy chip and money pops.
- Round-start / GO / bomb event / clutch (1vN) banners.
- Round-end card with the reason, MVP, score and income.
- Screen-projected bomb marker and radar squad blips + C4.
- Tab board with cash, kit, K/A/D, ADR, HS%, MVPs and a round-history strip.

Results screen gets a match report (score, round history, full scoreboard with plants/defuses/clutches) and payouts for rounds won, MVPs and the match win. The Arena screen now has a TDM / Bomb Defusal mode picker with new key art. The loading screen and voice briefing adapt to the mode.

Also: bot unstick logic probes backwards as well as sideways (bots no longer grind inside U-barrier cups), and the four mid-yard U-barriers moved 1.5 m inboard, which removes the dead-end pocket they formed with the flank containers (affects TDM too).

Verification:
- `node scripts/validate.mjs`: lint and typecheck clean. 137 Node tests including 16 new `tests/defuse-rules.test.js`. The only failures are the 17 already failing on `main`.
- Production build.
- ~60 headless simulated matches.
- In-browser QA (headless Chromium): menu, buy menu, live HUD, player plant, player defuse, spectator, Tab board and results, plus a TDM launch regression check.

## 2026-09-16 — Tactical radar upgrade, armory stat ribbon, new key art

Minimap rebuilt into a real instrument: enemy blips are now directional wedges showing where each hostile is LOOKING (amber while unaware, burning red pulse once they have contact), the dish rim smoulders red during contact, a faint square grid + 45-degree rim ticks make the terrain read as a mapped instrument, north pops brass, an olive chevron rides the rim pointing at the objective even when it's off-dish, and a footer strip reads live bearing / objective distance / hostile count (goes CLEAR when quiet). Armory stage gained a key-figures ribbon under the gun (DMG/RPM/MAG/ADS/RELOAD/SUPPR at a glance). Map key art regenerated at higher fidelity: Sandblast now a golden-hour drone shot with both bridges, souk tarps and the rusted water tower; Town a dawn kasbah in valley mist with the signal keep, kilns and west gate — both graded to their in-game lighting.

Verification: full `node scripts/validate.mjs` (lint, typecheck, 90 Node tests, 34/34 mutations killed) plus production build.

## 2026-09-15 — Menu flow rebuild, cinematic loading, real recoil, distinct gun audio, AWM rework

Main menu rebuilt to the sketch: home screen is title + stacked Missions / Loadout / Settings with new operator character art on the right (maps no longer shown at start). Missions → pick-map screen with Town and Sandblast tiles — hovering a tile hands the ENTIRE screen to a live 3D orbit of that arena (the hovered tile becomes a glass frame, the other recedes); clicking a map opens its mission list (verb-chip objective cards, first one hot), then Deploy → new cinematic loading screen (full-bleed AO aerial with slow push-in, typed sitrep feed, progress rail) → straight into the game. Money counter fixed: the rolling-odometer CSS (.cash-digit/.cash-strip/.cash-sep + up/down flashes) had never shipped, so every digit rendered its whole 0-9 strip inline. Armory: attachment hardpoints are clickable on unowned guns (window shopping) with a proper "buy the gun first" toast on purchase attempts. Recoil made real: base kick nearly doubled, permanent-climb share raised, per-shot horizontal jitter, ADS reduction cut 0.6→0.88, magnified glass amplifies apparent kick by zoom (sqrt(70/fov)), slower 140 ms recovery spring, camera shake on big-bore single shots. Gun audio separated: per-shot pitch scatter everywhere; M416 bright/tight, AK dull sawtooth hammer + receiver rattle, AWM artillery boom with rolling echo + delayed whip-crack, MP paper zip, Vector dry double-tick, SCAR round 7.62 thud, M249 clanky belt rattle, SPAS broadband slam, 1911 mellow pop with slide clacks; new headshot "dink" rings on every head hit. Per-weapon reload choreography: AK rock-and-lock (mag pivots forward, seat-slap counter-rock), AWM roll-right + long bolt stroke, pistols muzzle-up fast drop + slide run, M249 sag + cover pop, PDW twitch reloads, AR tactical chest-height handling — the gun no longer just dips out of frame. Models: M4 magwell flare made flush (no more broken piece through drum mags) and buffer tube now seats into a receiver end plate; AK bayonet lug + cleaning-rod spike deleted and the stock boot now slots into the receiver tang; AWM rebuilt to the real Accuracy International silhouette (slab green stock halves with a daylight thumbhole, chassis spine, spacer-stacked buttpad, separate near-vertical grip, vented slab forend, huge side-ported brake, stubby single-stack mag). Scopes differentiated: 3x/4x/6x now render distinct sight pictures (prism chevron / duplex telescopic with BDC dots / fine mil-dot precision glass with tight exit pupil), per-tier tube masks and zoom tags, and the ADS gun-hide threshold widened (<45°) so a 4x no longer stares into the back of its own scope model. Headshots more forgiving: head sphere 0.24→0.31 plus a neck capsule that counts as head.

Verification: full `node scripts/validate.mjs` (lint, typecheck, 90 Node tests incl. updated home-menu/boot pins, 34/34 mutations killed), production build, and Node smoke-build of the three reworked gun models (all within draw/tri budgets).

## 2026-09-15 — Menu/Armory relayout, universal scopes, MP secondary, streak + hitmarker fixes

Main menu redesigned to fit one screen without scrolling: two large map tiles side by side (recon artwork that cross-fades into a LIVE camera slow-orbiting above the real arena on hover/selection), mission route list removed — objectives now live on the deploy loading screen together with the brief and a spoken mission briefing (Web Speech, unlocked by the Play click). Maps graded apart: Sandblast keeps its hot amber noon; Town gets a cool blue-grey morning (new sky dome ramp, closer haze, low pale sun, mirrored key light). Scope system overhauled PUBG-style: ACOG/Hybrid/Sniper Scope replaced by 2x/3x/4x/6x scopes that fit EVERY weapon and set an absolute ADS FOV (57/40/30/20° ≈ true 2/3/4/6× at 95° base) via the new `adsFovSet` stat; 6x renders the full scope picture on any gun. MP reclassed to the secondary slot (machine-pistol role). M416 spawns genuinely bare — the built-in holo glass/reticle meshes are gone, irons run through the diopter drum, and the HUD no longer paints a phantom red dot for opticless guns. Armory relayout: watermark and bottom chips footer removed, hardpoint slots live as a persistent list in the right panel, bigger stage and closer camera for the gun, "Fielded" renamed "Equipped", and rapid weapon clicks no longer leak a ghost gun (in-flight swap transitions are disposed). Testing economy: wallet topped to $9,999,999 on load. Gameplay polish: kill hitmarker can no longer stick to the screen (timeout + fade), minimap player marker is now a bright signal-orange arrow with a view cone, and streak callouts are specific — Double, Triple, Quad, Penta, Unstoppable.

Verification: full `node scripts/validate.mjs` (lint clean, typecheck, all Node tests incl. updated catalog/optic/menu pins, 34/34 mutations killed) plus production build.

