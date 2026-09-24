# Fair redeployment — Warehouse TDM (2026-09-24)

## Player contract

Warehouse 5v5 TDM still has a **five-second** respawn. The landing search now considers both teams, the living player, navigable space, body clearance, enemy distance and actual wall sightlines. If an enemy can see a landing inside 30 m, or is closer than 8 m, the new arrival gets **1.6 seconds of damage immunity**. The player sees a teal countdown; bots carry a teal glow. The glow reuses each bot's existing ON FIRE sprite rather than allocating another world mesh. Shots still collide with a protected body but grant **no damage, hitmarker, blood, accuracy credit or kill**. Grenade splash and streak damage also respect the bot/player damage gates. Firing a real round, firing the Masterkey, releasing a frag, throwing a flash or successfully calling in a scorestreak ends the attacker's protection immediately; a dry click or unavailable streak does not. The shield counts simulation time, not time spent paused or away from the tab. A safe landing receives no shield. Ranked Search & Destroy and story missions receive neither this respawn nor its immunity.

## Algorithm and bounds

The five Alpha pads in `tdm.ts` are reflected through the centre to make Bravo's five pads. Each pad generates exactly **two** candidates: a 2–4 m jitter on the authored apron and an 8–10 m step **toward its own inner yard**. The latter creates a genuine escape if five opponents hold all five pads without spawning in the other team's base. Candidates are snapped to the 2 m `NavGrid`, validated against full-height solid collision (0.36 m capsule radius), then checked against the living bots and player (1.5 m minimum horizontal separation). Normal spawns evaluate **at most ten** choices; *only* if all ten are occupied, a bounded three-ring search checks at most **48 further nav cells**. Enemy-eye→landing-eye raycasts use the arena's actual occluders, stopping before the capsule. The safety tiers are: hidden and ≥8 m away, visible but ≥8 m away, hidden but too close, then visible and too close. Within each tier, fewer open sightlines and more distance win. Distance outranks a wall when the enemy is already inside one turn's reach. A forced ten-camper regression now clears a body rather than materializing inside it. If all 58 checks are unusable, the least-risk position still keeps the respawn clock bounded and is explicitly exposed; no guarantee is claimed for an impossibly saturated map. These numbers track the 30 m rifle engagement band, the five-second existing respawn, and the physical body radius, **not** a measured human reaction time.

Each bot uses the same selector, shield, and attack-cancellation state as the player. Ranked's round spawns explicitly do not grant it. Bot shield time advances once in the visual/simulation update; player shield time advances only in the active engine update. Death and disposal clear both. Protected enemy shots leave a tracer but not fake damage feedback. The existing 1.6-second period is deliberately shorter than the full respawn wait: it lets a player turn or leave a camped pad, not fight indefinitely while invulnerable.

## Before → after on the real Warehouse geometry

`node scripts/audit-play.mjs` seeds the headless 9-bot world and makes 80 fixed-position spawn decisions in **each** controlled stress scene. The original baseline is preserved in `docs/audit-2026-09-24.md`. This is a *worst-case fixture*, not a normal-match probability or a GPU frame-rate measurement.

| Controlled Alpha yard | Before: LOS ≤30 m | After: LOS ≤30 m | Before: <8 m | After: <8 m | Minimum enemy distance before → after | After: shielded / overlaps |
|---|---:|---:|---:|---:|---:|---:|
| Five enemies on approaches (z ≈ 26–30) | 80/80 | **80/80** | 0/80 | **0/80** | 8.1 → **8.1 m** | **80/80 / 0** |
| Five enemies on the spawn pads (z ≈ 37–40) | 76/80 | **44/80** | 80/80 | **0/80** | 1.0 → **8.1 m** | **44/80 / 0** |

The approach collapse **cannot be hidden by choosing among these ten points**: all 80 are still visible. The shield is the fallback, not a claimed geometry cure. For full occupation, 36/80 sampled landings had neither a near enemy nor an open sightline at selection time; all 44 exposed landings carried the shield. Bravo is evaluated by the same code with mirrored pads; 80 mirrored approaches were exercised for navigation, solids, side and occupancy in `tests/spawn-fairness.test.js`. One headless run advanced all nine real bot brains for 8 s and observed **22 reports, one score change, and ENGAGE/PUSH/FLANK**. CPU-only TDM ticks averaged ~0.40 ms with p95 ~0.84 ms in the final run versus ~0.38/~0.82 ms before; an earlier post-change run measured ~0.38/~1.13 ms. This variability does **not** establish a performance improvement or real FPS. World geometry remained **27 visible mesh draws / 43,666 triangles**, before and after; the already-instantiated bot glow is tinted rather than duplicated. Headless tests also check no additional sprite is allocated on protection, reciprocal hit/score gates, actual AI rifle and grenade paths, 1.6 s expiry, cancellation and disposal.

## Session polish scorecard (headless/SSR evidence, not a visual or listening review)

| Item | Before | After and verification |
|---|---|---|
| P0 — developer preflight | Tracked self-referential `node_modules` link prevented Vite startup; stale test asserted 2 AI setup sites although there are 3. | Link removed from Git; ignored `npm ci` works. Test asserts the **story, TDM and ranked** empty-roster branches separately. |
| P1 — ranked path | Five-action home rendered a dead ranked option; 3 baseline TS errors; completed rating not saved. | Menu→ranked setup→one competitive launch/re-queue wired; Armory return preserves its mode. Simulated ranked match produces a typed result, saves and reloads rating/record; **0** extra story missions, **0** story-grade bonus, no second payout. |
| P2 — keyboard menu | Only 4/5 actions accessible when wrapping modulo four. | Both directions reach **5/5** actions, then return to start; Enter uses selected action. |
| P3 — pause rail | Pause SSR had **0** ladder rows despite a working component. | When supplied a live HUD, pause SSR has **5/5** rows and an earned READY label. |
| P4 — head hitmarker | Nonlethal head and body hits both made a white X. | Nonlethal head = amber diamond, body = white X, kill = red X in three SSR assertions. |
| P5 — ammo family | HUD showed **0/10** authored cartridge labels. | **10/10** catalog IDs render the same caliber text used by armory and setup; renamed guns still resolve by stable ID. |
| P6 — TDM debrief | A win stamped `B · Grade B`; TDM draw alone was special-cased. | TDM win/loss/draw stamp **W/L/=** and match label; story still has a grade. Existing TDM bonus accounting is unchanged. |
| P7 — TDM opening | Story had a 12 s controls strip; TDM had none. | Arena-only goal/Tab/frag/streak strip for its first **8 simulation seconds**, then gone; no second mission banner. Below 650 px the controls wrap instead of forcing a single clipped line (CSS/SSR evidence, not a screen capture). |
| P8 — MP7 | `mp7` was shown as `MP`. | Catalog, HUD and menu say **MP7**; save ID still `mp7`, model still **33 draws / 30,847 triangles**. |
| P9 — graphics setting | High shadow map 4096² (16.78m texels); an audio change reset adaptive step/history. | High 3072² (9.44m, **43.75% fewer texels**); fake-renderer test keeps step 2 and three frame samples on sound/crosshair changes, but resets on a real scale/toggle. **Not a GPU FPS claim.** |
| P10 — shell foley | No independent casing landing layer. | One Web Audio high-passed noise tick per real report, 18 ms, 0.07 gain, ~0.18–0.26 s later for a self-loader; delayed for manual actions. Fake-audio test verifies scheduling, gain, stop and disconnect. **Not a listening test.** |

## Complete-diff self-review: five further fixes

After a green initial validation, I reread the complete production/test diff and identified five follow-ups. **All five were addressed** before final checks:

1. **Crowded fallback could overlap a live capsule.** A new adversarial test first failed with `landing must clear both enemy and friendly body capsules` when all ten primary positions were occupied. The bounded three-ring search now finds a clear cell; the identical test passes. The genuinely all-cells-saturated fallback still has the limitation stated above.
2. **Spawn grace covered offensive scorestreak use.** An actual armed call/strike confirmation now cancels grace. Unavailable streaks and failed designations leave the shield intact; the input wiring and shield operation are tested.
3. **Armory play could route a ranked result into an Arena story mission.** Armory now chooses the prior results mode before the saved map, and its deploy hint matches ranked/TDM/story; five route combinations are tested.
4. **The opening controls strip was too wide for a phone.** A ≤650 px CSS layout wraps controls inside the viewport; the rule is asserted, but a real-device visual check remains necessary.
5. **Headless audit cleanup only ran on success.** World materials/geometry, bot manager and mission AI now dispose from `finally`. Forced failures during a live TDM stress and a live mission-AI measurement both demonstrate disposal and global-stub restoration.

## How to verify and limits

Run `npm ci`, `node scripts/audit-play.mjs`, `node scripts/validate.mjs`, then `npm run build`. Focused reproduction: `node --test tests/spawn-fairness.test.js tests/ui-session-polish.test.js tests/ranked-session-flow.test.js tests/audio-settings-session.test.js`. The broader suite covers unchanged story mission accounting and ranked round rules. No new dependency was added.

There was **no usable browser or audio output** in this environment. Headless raycasts, AI updates, synthetic audio nodes and server-rendered React confirm logic and markup, not on-screen contrast, spatial audio quality, shadow quality on a real GPU, network latency or live player fairness. A human 5v5 playtest should pressure both camps, try firing/throwing during grace, watch glow legibility on a real screen, and listen to casing timbre before claiming presentation sign-off.
