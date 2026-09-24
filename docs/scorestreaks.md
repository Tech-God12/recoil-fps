# Scorestreaks

A Call of Duty-style scorestreak ladder, live in both Missions and Warehouse TDM.

## The ladder

| Key | Streak | Cost | What it does |
| --- | --- | --- | --- |
| 3 | **UAV** | 400 | Recon drone circles at 70 m for 30 s. Every hostile is painted on the radar (fast red sweep, `PAINTED` counter) **and** in the world with a red diamond drawn through walls. Calling a second UAV while one is up extends it. |
| 4 | **Precision Airstrike** | 700 | Enters *designation mode*: reticle changes to red brackets, LMB confirms the point under the crosshair (building or ground), RMB or tapping 4 again aborts. Two jets streak across your line of sight at 48 m and walk seven Mk82s along a 30 m line through the target. Danger-close is enforced at 16 m — the line never comes back toward you. Bombs hurt you too. |
| 5 | **Sentry Gun** | 1000 | Tripod auto-turret placed 1.9 m ahead on clear ground (placement is refused — and the streak kept — if the spot is blocked). 660 RPM twin barrels, 42 m range, true line-of-sight checks against world occluders, physical yaw/pitch tracking, 60 s life. Up to two on the field. |
| 6 | **Attack Helicopter** | 1500 | Gunship enters from the map edge, banks into a 24 m orbit over your position (the orbit follows you), and works any hostile it can see from the air with a chin gun in 10–15 round bursts. 45 s on station. Spatialised rotor loop tracks the airframe. |
| 7 | **Tactical Nuke** | 2500 | 10 s countdown with siren. On zero: whiteout, everything hostile on the field dies. In the arena the match ends as an Alpha win regardless of score. |

With the legacy five-gun kit (no armory loadout) the keys shift to 6 / 7 / 8 / 9 / 0.

## Rules (CoD)

- **Points**: kill 100, headshot 150, mission objective 250. Grenade kills count.
- **Kills made by streaks never feed the next streak.** You earn the chopper with your rifle, not the sentry. Streak kills still pay score, cash and the feed (`SENTRY`, `GUNSHIP`, `AIRSTRIKE`, `NUKE`).
- **Each tier arms once per life.** Progress resets to 0 on death (TDM). **Armed streaks survive death** and stay in your pocket until you call them in.
- A tier you already hold is not duplicated; a tier you spent can be earned again next life.

## Radar change

Hostiles now appear on the radar only when they are **engaging**, **within 22 m**, or **UAV-painted**. Quiet, distant patrols stay dark — that is what the UAV buys you. Contact wedges, heading and the objective chevron are unchanged.

## HUD

- Bottom-centre **streak rail**: five slots with key, cost and state (locked / used / READY with brass glow / LIVE in red), plus a progress bar to the next tier.
- Under the radar: **live chips** for every active streak with countdown and kill tally.
- Top ticker: `UAV ONLINE — HOSTILES PAINTED`, `GUNSHIP RTB — 4 KILLS`, etc., with spoken announcer lines.
- Pause menu: a reference card listing the ladder, your points this life and each tier's state.

## Implementation

- `src/game/streaks.ts` — `StreakLadder` (pure, unit-tested progression) and `StreakDirector` (owns Sentry / Chopper / Airstrike / Uav entities and the nuke timer). The director talks to the engine through a small `StreakContext` (targets, blast, aim point, placement check, announce) so it is mode-agnostic.
- `src/game/streak-models.ts` — procedural hardware: sentry, gunship (4-blade rotor + blur disc, tail rotor, stub wings, chin gun), strike jet, recon drone, through-wall marker sprite. Each model is < 4 k triangles.
- `src/game/engine.ts` — `streakTargets()` wraps mission `Enemy` and TDM `TDMBot` behind one interface; `streakBlast()` resolves bombs (targets, player, glass, particles, spatial audio, shake); `resolveNuke()`; hotkeys; designation on LMB/RMB; radar filtering.
- `src/game/audio.ts` — ready chime, deploy sting, sentry and chopper gun voices, looping spatial rotor bed, jet Doppler pass, bomb whistle, nuke siren and blast.
- `src/ui/Streaks.tsx` — rail, live chips, designation overlay, nuke countdown, ticker.

## Tests

`tests/streaks.test.js` covers the ladder rules, geometry budgets, a headless 90 s engagement (sentry + UAV + chopper + airstrike vs six fake hostiles, full scene clean-up), the nuke timer, refused placement, **barrel/target alignment in world space** and the airstrike's danger-close / cross-view line geometry.
