# Recoil FPS: Phase 1 Mission Structure

## Scope

This change implements the first phase of the supplied brief, in isolation. It does not claim completion of Phases 2-6.

The provided checkout is a React/TypeScript Vite application with `src/game/engine.ts` as its game engine and `src/App.tsx` as its entry component. It is not the `client/js/main.js` / Express repository mentioned in the brief. No Git fetch or commits were possible with the available tools. Existing map geometry, soldier geometry, textures, lighting, bloom, grain, and aberration have not been redesigned in this change.

## Mission Rules

`src/game/config/missions.json` defines SANDGLASS (Al-Rasul) and RIDGELINE (Kasbah). Both use five ordered objectives:

1. Advance: reach the marked approach. An empty enemy roster cannot complete it.
2. Clear: neutralise six designated defenders or hostiles inside the named combat zone. A victim is credited only once. Defenders killed during the approach still count.
3. Destroy: hold X for 2.5 uninterrupted seconds at the visible cache. A dedicated demolition charge then runs a 25-second fuse, independent of the player's grenade inventory. Leaving the area does not stop an armed fuse.
4. Hold: accumulate 60 seconds inside the marked perimeter. Leaving pauses, rather than resets, the hold timer. Pressure requests rise at 15, 30, and 45 seconds.
5. Extract: reach the pickup alive. This is the only success condition. It does not require killing every remaining hostile.

All objective clocks use simulation time. Pausing, opening settings from pause, losing focus, and waiting for pointer lock do not advance mission time. Defeat freezes the report. Phase changes produce an event once; rendering and consequences consume the same event stream.

The cache and hold positions intentionally use accessible ground-level courtyards. A rooftop hold is deferred until Phase 2's stair and room reachability work is verified. Kasbah deploys on the outer ring at `[0, 0, 64]` rather than inside the old southern compound.

## Reinforcement Pressure

`src/game/systems/reinforcements.ts` owns insertion and retirement decisions. `AIManager` allocates ten reusable soldiers, starts with no active roster, and inserts squads of three when requested.

- Hard live cap: 10. With full three-soldier squads, the normal peak target is 9.
- Phase targets: 3 / 6 / 6 / 9 / 6. Hold has the shortest spawn interval.
- Every member must be at least 25 metres from the player, outside the full camera frustum, on navigable ground, and occluded at both head and torso heights.
- A missing safe site defers insertion; it does not weaken any gate. A radio notice and compass contact occur only after a squad is actually inserted.
- A living actor may retire only after 20 continuous seconds beyond 90 metres, outside the player view, with no geometric LOS and no cached player sighting. Retirement never earns a kill.
- Reused actors receive fresh IDs and reset health, targeting, pose, path, and combat timers. Dead models are retained for at least six seconds before becoming reusable.

The previous double increment of AI state timers was removed because it made reinforcement pacing and AI timers run on different clocks. No additional tactical state or soldier animation was introduced.

This checkout also still had nonzero camera recoil arrays, finite reserves, and a two-frag starting inventory despite earlier descriptions. The patch restores zero recoil arrays, unlimited reserves, and five starting frags so the longer missions do not reverse those standing requirements. Weapon geometry and the existing arm animations are unchanged.

## Resource Contracts

The following assertions are included, but their execution is **not yet verified** in this session:

| System | Contract | Test |
| --- | --- | --- |
| Mission state | At most 8 phases, 64 queued events, and bounded per-objective victim credits | `tests/mission.test.js` |
| Pressure director | At most 8 candidate sites and 32 LOS probes per 0.5-second evaluation | `tests/reinforcements.test.js` |
| Active roster | At most 10 live actors and 10 allocated soldier models | `tests/mission-integration.test.js` |
| Mission objects | At most 4 draws and 512 triangles | `tests/mission-integration.test.js` |
| Existing soldier | At most 36 draws and 9000 triangles, geometry-only audit | `tests/mission-integration.test.js` |
| Mission sites | Ground-level flood-fill reachability using actual collider geometry | `tests/mission-world.test.js` |
| Long session bookkeeping | Bounded counters and query work over 20 simulated minutes | `tests/mission-budget.test.js` |

The 11.5 ms worst-case `ai.update` limit from the supplied, different repository has not been reproduced or measured here. The pressure test's elapsed time is a diagnostic of the pure mission/director simulation, not an AI or GPU benchmark. No FPS improvement is claimed.

## Validation

No browser, screenshots, headless renderer, or browser automation were used. Geometry tests construct Three.js objects in Node without a renderer; the tiny canvas stand-in exists only so the existing procedural soldier geometry can be instantiated. It is not a visual test.

The environment prohibits direct edits to `package.json` and `vite.config.ts`. Therefore no `npm run validate` script was added. A standalone equivalent is provided:

`node scripts/validate.mjs`

It runs ESLint, a full TypeScript check, Node's test runner, and mutation checks in that order. ESLint uses its recommended rules plus TypeScript's recommended rules, not an unavailable pre-existing Airbnb configuration.

To run just the Node tests:

`node --test --test-concurrency=1 tests/mission.test.js tests/reinforcements.test.js tests/mission-integration.test.js tests/mission-world.test.js tests/mission-budget.test.js`

Each test imports `tests/helpers/register-json.js` before dynamically loading the tested TypeScript graph. This handles both TypeScript and JSON without `with { type: 'json' }`. Node 20.19+ is required.

`node scripts/mutate.mjs` first requires a green baseline, applies one source mutation at a time, demands an assertion failure, restores the exact original source in a `finally` block, and requires another green baseline after all mutations. A syntax failure or import failure is not credited as a killed mutation. Do not interrupt the process while it is editing a source file.

Mutations target spatial predicates, kill quota/zone/deduplication limits, planting/LOS/fuse timing, hold timing, pause/death/terminal guards, insertion range/frustum/LOS/walkability, the live cap, spawn work limits, retirement age, the old fixed roster, double-counted AI ticks, and marker geometry growth.

## Verification Status

- Production build: `npm run build` executed successfully through the provided build tool.
- Lint and standalone typecheck: not executed; no shell execution tool is available.
- Node tests and mutation cycle: authored, not executed in this session. They must pass before this phase is accepted or Phase 2 begins.
- Real map traversal, combat pacing, player-held perimeter balance, and the 11.5 ms AI timing gate: unverified.
- External `/api/*`, SQLite, and Express: not present in this checkout and not introduced. Missions need no server.
- Dependency installation reported two audit advisories (one low, one high). An audit investigation was not available; no forced dependency updates were performed.

## Next Gate

Run the standalone validation and review its real output. Resolve any failed arithmetic probes before proceeding. Then start Phase 2.1 as a separate series: district-authored placement, OBB-aware collisions, and tested passage/entrance connectivity. The existing grid layouts and stair defects remain outside this Phase 1 change.