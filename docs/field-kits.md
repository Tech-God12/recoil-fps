# Field Kits

One tactical ability per deployment, on a cooldown, bound to **Z**. It works in Missions and Warehouse TDM. Competitive (Search & Destroy) turns it off, because that mode's utility comes from the buy menu.

You pick the kit on the main menu (mission card) or on the TDM setup screen. You can swap it from the pause menu, and the new kit starts on a full cooldown. The choice is saved in settings as `fieldKit`.

## The kits

| Kit | Ability | Cooldown | What it does | The catch |
| --- | --- | --- | --- | --- |
| **RECON** | Sonar Dart | 30 s | Throws a fin-stabilised dart (26 m/s, 55 % gravity) that sticks where it lands. It fires 3 pings, 2.5 s apart, starting 0.4 s after impact. Each ping tags every hostile within **24 m** through walls for 3.2 s (red world marker + radar contact). | Each ping can be heard within **14 m**. Hostiles in that range walk over to look for the dart. |
| **BULWARK** | Barricade | 40 s | Plants a steel wall 1.7 m ahead of you, snapped to the nearest axis you are facing. It is 2.4 m wide, **1.4 m** tall and has **450 HP**. It blocks bullets and sight-lines both ways, blocks movement, and AI path around it. It lasts 22 s. | A crouched eye (1.22 m) is covered; a standing eye (1.62 m) is exposed. Crouch to be safe, stand to shoot over it. Hostile fire wears it down, and each hostile frag deals up to 260. If the spot is blocked, placement is refused and you keep the charge. |
| **PHANTOM** | Holo-Decoy | 35 s | Sends a hologram of an operator jogging 3.6 m/s along your aim for 2.6 s (≈9 m). It then holds position and fires blanks every 0.55–1.1 s for the rest of its 10 s life. Any hostile inside **32 m** with line of sight to it targets it **instead of you**. | 120 HP, so one volley pops it. The blanks can be heard within 28 m. If you shoot a lured hostile, there is a **50 %** chance it snaps out of it and turns on you (TDM bots are then immune for 3 s). |

**Kill refund:** each kill you make takes **20 %** of the full cooldown off your kit (6 s for Recon). Streak kills don't count, which matches the scorestreak rule that streaks don't chain.

## What it changes moment to moment

- **Recon:** throw before you peek. Now you know how many are in the room, but they may come to you.
- **Bulwark:** make cover in an open lane, then keep choosing between crouching safely and standing to shoot over it while it takes damage.
- **Phantom:** draw fire across a sight-line, then flank the hostiles shooting at the decoy. Shooting a lured hostile has a 50 % chance to break the lure.

## HUD & discoverability

- **Kit slot** next to the vitals: a conic cooldown dial with the kit icon, a **Z** keycap and READY / CHARGING state. While a dart is pinging it also shows a TAGGED count.
- **Live chips** above the slot for each deployed object: dart pings (`PING 2/3`), barricade and decoy health bars, and time left.
- **Ticker** (top centre) for events: `SONAR — 3 HOSTILES TAGGED`, `BARRICADE DESTROYED`, `DECOY DOWN`, `… READY — PRESS Z`, and refusals.
- **Onboarding:** a `Press Z` prompt stays up until you use the kit for the first time. The first-run control strip lists `Z FIELD KIT`, and there is a boot-screen tip.
- **Menus:** a kit picker on the mission card and TDM setup, a rule line on TDM setup, and a pause-menu card with the equipped kit's rules plus swap buttons.

## Audio

All sounds come from the existing spatial synth (`audio.ts`), with no sample files. They are: the dart throw whoosh, a thunk on impact, a positional sonar ping (sine chirp + echo tap), the barricade slam and a metal ping on each hit, a crash when it breaks, the decoy's shimmer on spawn, blank bursts at its position, a glitch-out when it dies, and a two-note chime when the kit is ready.

## Models

Procedural, in the same style as `streak-models.ts` (`kit-models.ts`). The dart is a body, fins and an emissive sensor ring. The barricade is three plated panels on kick-stands with hazard edging and a damage tint. The decoy is a translucent scan-lined operator with a rifle silhouette and a base ring. Geometry budgets are enforced in tests.

## Code map

- `src/game/kits.ts`: tuning table, `KitCharge`, pure helpers (`snapCardinal`, `barricadePlacement`, `sonarTagged`, `chooseLure`) and `KitDirector` (it owns the dart, barricade and decoy entities, and is mode-agnostic through `KitContext`).
- `src/game/kit-models.ts`: meshes.
- `src/game/ai.ts`: `Enemy.lure` redirects look, aim and fire at the decoy. Rounds that stop on a barricade plate damage it.
- `src/game/tdm.ts`: bravo bots prefer a visible decoy in `acquireTarget`, `fireShot` routes damage to the decoy or barricade, and `lureImmuneT` handles the lure break.
- `src/game/engine.ts`: `kitContext()` bridge (placement vs solids, blocker/occluder/nav-grid refresh, hearing alerts), Z key, kill refunds, frag damage to barricades, HUD snapshot, cleanup on death, match end and dispose.
- `src/ui/Kits.tsx` + `index.css` (FIELD KITS section): slot, chips, hint, ticker, picker and pause card.
- `tests/field-kits.test.js`: 16 tests. Pure logic, geometry budgets, headless director sims for each kit (spawn → act → cleanup), real `Enemy` and `TDMBot` lure and barricade tests, engine wiring on the real warehouse map, and UI render.

## Limitations

- Friendly TDM bots (alpha) don't use kits, and bravo bots don't have kits of their own.
- Mission AI can't tell a decoy is fake except through the 50 % break when shot. They don't learn it across encounters.
- Barricades are axis-snapped slabs, so they can't be placed at an angle.
- No human playtest or browser/hardware check was done. The numbers above come from reasoning and headless simulation.
