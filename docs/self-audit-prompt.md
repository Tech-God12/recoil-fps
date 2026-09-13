# Self-Audit Prompt (the massive prompt I wrote for myself before touching code)

> Read this repo like a hostile playtester, not like a CI bot. CI is already green; that proves nothing.
> Play the whole loop in your head — menu → deploy → pause → settings → aim → sprint → slide → vault →
> shoot → get lit up by AI → nade → plant → hold → extract → death → debrief → quit → redeploy —
> on BOTH maps, on the THREE post-processing paths, at 40 FPS and 140 FPS, and hunt only for things a
> real human would call "that's annoying" or "that's broken". For every candidate flaw:
> (a) prove it in the source or with a headless probe (grep, Node simulation, geometry flood-fill),
> (b) fix or improve it in the same style as the surrounding code,
> (c) never violate the locked contracts: infinite ammo, 5 frags/2 flashes, zero recoil-pattern arrays
> (`pattern: [[0, 0]]` exactly 5 times in engine.ts — a test asserts this), empty AI roster at t=0,
> live cap 10, simulation-time mission clocks, marker budget (4 draws/512 tris), soldier budget
> (36 draws/9000 tris), SSR strings the integration test matches ('Reach the market', 'SANDGLASS',
> 'Current mission objective', phase titles, 'Reach the pickup to extract', no '21 HOSTILES').
>
> Specifically verify and kill these suspects, then sweep for anything else you find:
>
> 1. RESOLUTION SCALE & ADAPTIVE RES MUST ACTUALLY WORK. The app runs EffectComposer whenever
>    vignette/bloom/grain is on (default vignette 18 ⇒ always). EffectComposer caches `_pixelRatio`
>    at construction and never re-reads it on resize; engine only calls `renderer.setPixelRatio`,
>    so the "biggest FPS lever" slider and the adaptive scaler do nothing to the main scene render.
>    Sync `composer.setPixelRatio()` everywhere the renderer ratio changes (applySettings,
>    adaptResolution). Prove it by reading node_modules/three EffectComposer source.
> 2. THE TACTICAL MAP IS COMPUTED BUT NEVER DISPLAYED. Engine generates a 256px accurate map image
>    per mission and tracks playerMap/enemiesMap every HUD tick; no component renders them. Wire the
>    existing data into a live corner minimap (player heading arrow, enemy blips, objective ring/dot,
>    extraction color). Reuse radarEnemies? No — delete dead ones instead.
> 3. ENEMY VOICE CHATTER IS ADVERTISED BUT NEVER PLAYED. voice.enemyCallout() is dead code; the
>    Settings tab promises "announcer callouts and enemy squad chatter". Wire it into the engine's
>    onCallout path with the existing proximity gate and anti-spam cooldown.
> 4. HUD ELEMENT COLLISIONS. The always-on FULLSCREEN button (top:12 right:16, z-50) sits on top of
>    the kill feed (top:20 right:24) and the FPS chip column. Re-lay the right edge; move the FPS
>    chip out of the feed column.
> 5. FAKE SCORE POPS. Kills spawn '+100 / +150 HEADSHOT' floating text but there is no score, in HUD
>    or debrief. Either make it real (score = kills + headshot bonus + objective + extraction) or stop
>    lying. Make it real, surface it in vitals and the debrief summary.
> 6. MISLEADING 'X LEFT' COUNTERS. enemiesLeft is live cap pressure (refills forever), not remaining
>    enemies; '6 LEFT' after 40 kills reads broken. Rename to ACTIVE everywhere.
> 7. VAULT PHASES THROUGH CLOSED WINDOWS. windows[i] and glass instance i are index-aligned (prove:
>    counts match per map, pushed together in wallRun); climbing through should break the pane.
> 8. GRENADE SELF-INFLICTED SPAWNS + UNPAUSED KEYUP. onKeyUp throws a live frag with zero
>    paused/dead/ended guards (release G after ESC = grenade while paused); throw origin is blindly
>  eye+dir*0.5 and can spawn inside a wall facing it (bounce into own face). Add guards and a safe
>    origin probe using the existing solid hash.
> 9. AUDIO/VOICE LEAKS ACROSS STATE. setMasterVolume() calls ensure() — opening Settings on the menu
>    before any deploy spins up the AudioContext and starts the desert wind forever; pause doesn't
>    freeze the TTS queue; quit leaves wind blowing behind the main menu. Volume must apply without
>    ensuring a context (store + apply on ensure); pause ⇒ suspend AudioContext + speechSynthesis;
>    dispose ⇒ cancel voice + suspend; deploy ⇒ resume.
> 10. KASBAH DATA DEFECTS. (a) clear-zone center [-42,0,25] lands inside a market stall column —
>     nav-blocked; move to the free lane [-42,0,27.5] (probe first). (b) insertion 'ridge-outer-south'
>     [0,0,64] is permanently unwalkable (probe-verified) — relocate to [0,0,66]. (c) mission brief
>     says "without crossing the citadel square" while deployment [0,0,30] starts INSIDE the citadel
>     square — deploy on the outer south ring [0,0,66] instead (also matches docs/phase-1.md which
>     claimed the outer-ring deployment the JSON never had); prove ground-level flood-fill still
>     reaches every objective (the world test does exactly that).
> 11. DEAD BLOOD DECALS ON STAIRS/CRATES. bloodDecal pins every corpse stain to y=0.035 ground plane.
>     Sit it on the actual support surface under the kill (scan ctx.solids once per death).
> 12. SNIPER SCOPE IS A FLOATING RING. AWM ADS (fov 22) draws a 320px circle overlay with the world
>     fully visible outside it. Add the classic box-shadow mask so the scope actually scopes.
> 13. ADS IS HOLD-ONLY. Add an optional 'adsToggle' setting (click MMB to keep scope), applied live,
>     persisted, with the sprint-cancel only on press-to-aim.
> 14. DEAD CODE / DEAD CSS SWEEP: GrenadeWarn event, HudState.reserve/radarEnemies/interacting,
>     world.squadSpawns + SquadSpawn + MAPS.enemies, voice.missionStart/halfway/victory,
>     engine.setVoiceEnabled/voiceOn, StatBar/CountUp/Key exports, unused CSS (.radar-sweep, .blip,
>     .live-dot, .hud-frame, .mapcard*, .wcard*, .glitch, .shutter*, .load-bar, .kenburns, .scanlines,
>     .rank-slam, .menu-link*, .underline-fx, .callout) — grep each before deleting; keep what's used.
> 15. Browser-noise polish: no favicon ⇒ console 404 per load; inline an SVG data-URI.
> 16. After every change: npx eslint, npx tsc --noEmit, node --test tests/*.test.js,
>     node scripts/validate.mjs (incl. mutation suite), npm run build. Any 'improvement' that makes
>     a locked contract red is a regression, not an improvement.
