# Bomb Defusal — Sirocco (5v5 competitive)

A CS2-style round-based mode: attackers carry a bomb to one of two sites, defenders hold
the sites or defuse. Money carries between rounds, guns survive with you, nobody respawns
inside a round, and the teams swap sides at halftime. You play one of ten combatants; the
other nine are bots driven by an objective director on top of the shared TDM combat brain.

**Menu path:** Home → **Arena Mode** → **01 SIROCCO · Bomb Defusal** → pick a side
(Attack / Defend / Random) and a length (Short = first to 7 of 12, Full = first to 13 of 24) → **Play**.

## Controls (in addition to the normal FPS controls)

| Key | Action |
| --- | --- |
| **B** | Buy menu (freeze time + first 15 s of the round, inside your spawn) — B again to close |
| **X** (hold) | Plant the bomb on a site (3.2 s) · defuse the planted bomb (10 s, 5 s with a kit) |
| **X** (tap) | Pick up the weapon at your feet |
| **Z** | Smoke grenade (blocks bot sight lines for ~18 s) |
| **5** | Drop the bomb for a teammate |
| **6 / 7** | Radio: call **A** / **B** (attack = re-route the squad, defend = rotate three bots) |
| **8** | Radio: follow me (toggle) |
| **Tab** | Scoreboard: money, K/A/D, ADR, HS%, MVPs, round history |
| **LMB / RMB** (dead) | Spectate next / previous teammate |

Buy menu: **1–6** pick a category, **1–9** buy inside it, **⌫** back, **A** auto-buy, **Esc** pauses.

## Round flow

| Phase | Time | Notes |
| --- | --- | --- |
| Freeze / buy | 10 s | Feet locked, no shooting, buy anywhere in the buy zone |
| Live round | 1:45 | Buying stays open for the first 15 s (buy zone only) |
| Bomb planted | 40 s fuse | Round clock is replaced by the C4 timer; beeps accelerate |
| Round end | 5 s | Exit frags allowed |
| Halftime | 6 s | Sides swap, everyone restarts on $800 with a 1911 |

A round ends when: every defender is dead (attack win), every attacker is dead **and the
bomb is not planted** (defend win), the bomb explodes (attack win), the bomb is defused
(defend win), or the clock expires without a plant (defend win).

## Economy (CS2 numbers — `src/game/defusal/rules.ts`)

| Item | Value |
| --- | --- |
| Start of each half | $800 |
| Money cap | $16,000 |
| Win: elimination / time | $3,250 |
| Win: bomb detonated / defused | $3,500 |
| Loss ladder | $1,400 → $1,900 → $2,400 → $2,900 → $3,400 |
| Pistol-round loser | already on the $1,900 tier (CS2 starts each half with one banked loss) |
| After a win | loss tier drops by **one**, not to zero |
| Plant, round lost | +$800 to every attacker |
| Planter / defuser | +$300 personal |
| Attackers alive at time-out | $0 |
| Kill rewards | pistol/rifle/LMG/grenade $300 · SMG $600 · shotgun $900 · AWM $100 |

## Shop (`src/game/defusal/shop.ts`)

| Category | Items |
| --- | --- |
| Pistols | 1911 $200 · Deagle $700 · MP (machine pistol) $1,050 |
| SMGs | Vector $1,250 |
| Rifles | AK-47 $2,700 (attack only) · M416 $3,100 (defend only) · SCAR $3,300 · AWM $4,750 |
| Heavy | SPAS $1,050 · M249 $5,200 |
| Gear | Kevlar $650 · Kevlar + helmet $1,000 ($350 upgrade) · Defuse kit $400 (defend only) |
| Grenades | Frag $300 (1) · Flash $200 (2) · Smoke $300 (1) — four grenades max |

Guns you own in the Armory are fielded **with your build** (attachments + finish); the rest
arrive factory-stock. Survive and you keep everything; die and you respawn with a 1911.
A replaced gun drops at your feet; dead players drop their best gun and bots loot upgrades.

## Damage model

CS-style: per-weapon damage (armory stat mods such as a suppressor's −8% carry over), head
×4, legs ×0.75, and a per-weapon **armor ratio** — the share of damage that still reaches
health when the hit lands on kevlar (torso) or a helmet (head). Breakpoints the tests pin:
the AK and Deagle one-tap helmets, the M416 and 1911 do not, the AWM kills an unarmored
target with a body shot. No health regeneration.

## Sirocco

An 88 m desert town around the classic three lanes (T spawn south, CT spawn north):

```
   A SITE (plat, crates, car)     CT SPAWN          B SITE (pillared hall, stage)
        │  A RAMP ────────────────┤  ├──────────────── B RAMP  │
        │                       CT MID                          │ B DOORS
   A LONG      A SHORT ──── TOP MID ──── B WINDOW ─────────┘  B TUNNELS
   (container,             MID DOORS                          (roofed, dark)
    car, crates)              MID
   LONG DOORS                  │                                 TUNNEL YARD
   OUTSIDE LONG ── T ALLEY ── T SPAWN ── UPPER ALLEY ──────────────┘
```

* CT → site ≈ 35 m, T → site ≈ 95 m: defenders rotate in ~6 s, attackers need ~15 s.
* Screen walls in both spawns kill the spawn-to-spawn sightline down mid.
* Building mass is generated from the walkable rectangles in `maps/sirocco.ts`, so the lanes
  the AI plans on and the collision the engine enforces can never drift apart.
* Callouts (kill feed): A LONG, LONG DOORS, A PLAT, A SHORT, MID, MID DOORS, TOP MID, CT MID,
  A RAMP, B RAMP, B WINDOW, B DOORS, B TUNNELS, TUNNEL YARD, B STAGE, …

## Bots

* **Economy:** each team makes one call from its average bank — pistol, eco, force or full
  buy — and every bot shops for its role (entry, rifler, AWPer, support, lurker).
* **Attack plans:** execute, split, rush, default (map control → commit where the info is) or
  fake; bots walk real lanes, stage out of sight, throw execute smokes/flashes, the carrier
  plants, then everyone holds post-plant angles. A dropped bomb is fetched.
* **Defense:** 2-1-2 (or stack A / stack B / aggressive), anchors hold angles with a pre-aim
  reaction bonus, turn to nearby gunfire, step out of smokes, smoke the choke and **rotate**
  when they read a hit; after a plant they group, retake together, and defuse — or save if a
  defuse can no longer beat the fuse.
* **Sight:** a 190° vision cone, walls and smoke clouds block line of sight; the radar only
  shows enemies you or a teammate can actually see.

## Code map

| File | Role |
| --- | --- |
| `src/game/defusal/rules.ts` | Pure round/economy state machine, payouts, MVP |
| `src/game/defusal/shop.ts` | Pure shop, inventory, ballistics |
| `src/game/defusal/botplan.ts` | Pure team buy calls, bot purchases, attack plans |
| `src/game/defusal/mode.ts` | The live mode: combatants, bomb, smokes, drops, director |
| `src/game/defusal/bomb.ts` | Procedural C4 model and smoke textures |
| `src/game/maps/sirocco.ts` / `sirocco-build.ts` | Layout data / geometry |
| `src/game/tdm.ts` | Shared bot brain, now with director hooks, weapon profiles, sight cone |
| `src/ui/DefusalHud.tsx`, `src/ui/BuyMenu.tsx` | HUD layer, buy menu |

## Verification

* `tests/defusal-*.test.js` — rules, shop/ballistics/bot buys, map + nav + sightlines, live mode
  rounds (payouts, bomb drop/pickup, post-plant rule, defuse timing, halftime), SSR UI.
* `scripts/mutate.mjs` — ten defusal mutations (economy, halftime, helmets, kits, post-plant rule…).
* `node --import ./tests/helpers/register-json.js scripts/defusal-sim.ts [matches] [short|long] [seed]`
  — full bot-vs-bot matches on the real collision; `ABSENT=1` removes the stand-in player,
  `TRACE=<round>` prints the attackers' tasks, `FEED=1` the kill feed.
* `node --import ./tests/helpers/register-json.js scripts/defusal-engine-smoke.ts [seconds]` — boots the
  real `Engine` against a stub WebGL context and scripts plant / defuse / pickup / buy / spectate.
