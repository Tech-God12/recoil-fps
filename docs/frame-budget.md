# Frame Budget (performance overhaul, 2026-09-24)

Player report: "everything is super laggy." This pass makes the per-frame GPU/CPU
cost stop scaling with map dressing and removes work that bought nothing.

## What changed

| Area | Before | After | Where |
| --- | --- | --- | --- |
| Decorative point lights | every lamp a real `PointLight` (Warehouse: 8 evaluated per pixel) | virtual sources served by a fixed pool of `LIGHT_POOL_SIZE = 2` real lights, re-assigned to the nearest sources every 0.2 s with 0.25 s cross-fades | `src/game/light-budget.ts` |
| Post chain | vignette alone forced the full EffectComposer path (off-screen target, 2 fullscreen passes, **no MSAA**) | vignette is a CSS overlay; post runs only for bloom / film grain (`usesPostChain`). Default settings render straight to the multisampled canvas | `engine.ts`, `App.tsx` |
| Sun shadow | fixed ±80 m box over the map centre | ±50 m box follows the player, biased 40 % toward the view direction and texel-snapped (no shimmer); re-aimed only on shadow-refresh frames | `src/game/shadow-fit.ts` |
| Terrain | 36 k-tri sheet cast shadows | receive-only | `world.ts` |
| Bot rifles | full GunBuilder rifle at any distance | one-draw low-poly rifle past `WEAPON_LOD_DISTANCE = 14` m | `models.ts` |
| Hit proxies | invisible basic-material meshes still issued draws | shared `HIT_PROXY_MAT`, excluded from rendering | `models.ts` |
| AI hot path | `checkLOS` / `doPatrol` allocated vectors every tick per bot | module/instance scratch vectors | `ai.ts` |
| Guidance | no hint which knob matters; FPS chip hid adaptive scale | "biggest FPS levers" line in Settings; FPS chip shows `· 72%` when scaled | `Settings.tsx`, `Hud.tsx` |

## Measurements

`scripts/perf-probe.ts` boots the real Engine on a stub WebGL2 context, runs 600
frames at 60 fps per map (RNG reseeded per map) and counts renderer calls. Stub GL
means ms numbers are CPU-side only; draw calls, triangles and light counts are exact.

| map | draw calls median/max | triangles median/max | frame ms mean/p99 | lights |
| --- | --- | --- | --- | --- |
| alrasul | 54/72 | 224,487/364,719 | 1.206/7.320 | 7 |
| kasbah | 67/103 | 163,381/273,319 | 1.043/3.821 | 7 |
| arena | 165/194 | 103,293/110,415 | 1.707/2.763 | 8 |
| sirocco | 115/130 | 86,706/110,774 | 1.346/2.864 | 8 |

Final rerun after the Warehouse/Kasbah and Arena container-yard polish on 2026-09-29:
600 frames per map at 60 fps with the headless WebGL2 probe, RNG reseeded per map.
The stub reports CPU-side timing; draw calls, triangles, and light counts are the
useful repeatable budgets. Peak CPU frame time was 9.976 ms on alrasul and 6.106 ms
on sirocco; no map exceeded the 16.67 ms 60-fps frame interval in this probe.

Per-pixel point lights on Arena: 8 → 4. With default settings the two fullscreen
post passes and the full-resolution render target are gone entirely — the biggest
GPU win, but one a stub context cannot time. Reproduce:

    node --import ./tests/helpers/register-json.js scripts/perf-probe.ts 600 /tmp/perf.json

## Tests

`tests/frame-budget.test.js` (pool assignment, fades, dispose, shadow texel
snapping/coverage, post-chain gate, vignette CSS, weapon LOD switching).

## Blind spots

No real GPU was available. Real fill-rate savings (post chain removal, MSAA path)
and the light-pool cross-fade look need a human in a browser. The viewmodel is
still ~66 k triangles (audit W1) and is the largest single remaining cost.
