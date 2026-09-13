# OPERATION GROUND ZERO — MASSIVE MAP + MISSION OVERHAUL PROMPT

> **Role:** You are a AAA level designer, mission designer, and technical artist in one.
> Your job is to take *Recoil FPS* — a desert FPS whose two maps are procedurally tiled
> boxes and whose missions are a 5-step copy-paste template — and rebuild both maps and
> both missions from scratch to **shipped-game quality**.
>
> The user's words: *"The map is super trash and boring. Both the maps are super trash and
> boring, and the missions are also super boring. The game is still just the same."*
> Your response is not a patch. It is a rebuild. **Be ambitious. Be good.**
>
> Success = a Twitch viewer watching over the player's shoulder says "this looks like a
> real game", not "this looks like a student project with a green CI badge".

---

## 0. FIRST, BOOT IT (MANDATORY)

```bash
cd /home/user/recoil-fps
npm install
npm run build            # must pass before you touch anything
npm run dev -- --host 0.0.0.0 --port 5173   # bind to 0.0.0.0, open the preview
```

Play BOTH maps (AL-RASUL CROSSING and KASBAH RIDGE) on Normal before writing a line of
code. Do a full run each: Deploy → Advance → Clear → Destroy (hold X 2.5s) → Hold 60s →
Extract. Die once. Note every moment that feels flat. Then read this entire document
twice and execute every section.

---

## 1. CODEBASE MAP — KNOW EXACTLY WHAT YOU OWN

| File | Role | You may touch? |
|---|---|---|
| `src/game/world.ts` | Procedural map builder (`buildWorld(scene, mapId)`). All geometry, solids, cover, squad spawns, windows, glass | **YES — this is your main canvas** |
| `src/game/config/missions.json` | Mission definitions: phases, pressure, insertions, deployment | **YES — rewrite** |
| `src/game/systems/mission.ts` | Pure mission state machine + validation | Only if adding new phase types (see §8) |
| `src/game/systems/mission-runtime.ts` | Wires missions to AI/audio/markers | Only if adding new phase types |
| `src/game/systems/mission-markers.ts` | Cache prop + perimeter ring (budget: 4 draws / 512 tris) | Allowed, budget fixed |
| `src/game/systems/reinforcements.ts` | Pressure director, spawn-site selection | Read-only (rare tweaks if needed) |
| `src/game/ai.ts` | NavGrid (2m cells), squads, cover, zones, insertSquad | Careful edits only (squad spawns, zone names) |
| `src/game/engine.ts` | Gameplay: movement, weapons, fog/lights, vault, radio, detonate, map-image generator | Only for map-support changes (lights, fog, clouds) — **never weaken gameplay** |
| `src/game/textures.ts` | Procedural texture atlas (adobe, plaster, sand, asphalt…) | **YES — add new materials for new districts** |
| `src/ui/Screens.tsx` | Menu map cards, mission route list | Only to sync copy (route timings, desc) |
| `tests/*.test.js` | Budget + behavior contracts | Only the specific assertions listed in §4/§8 |
| `docs/`, `CHANGELOG.md` | Write your own changelog entry at the end | YES |

### 1.1 The `World` interface — the contract you must preserve

`buildWorld()` returns:
`group` (THREE.Group), `solids` (AABB collision), `occluders` (raycast targets),
`coverNodes` (Vector3[] the AI uses for cover), `squadSpawns` (5 initial squads:
`{ leader, a, b, patrol[] }`), `playerSpawn`, `interiors` (AABB), `concrete` (AABB —
footstep surfaces AND the radar map), `wood` (AABB), `half` (map half-extent in meters),
`lightSpots` (Vector3[] — engine keeps the 2 nearest as real point lights),
`windows` (WindowHole[] — **drives the SPACE-vault mechanic**: `{x,y,z,nx,nz}`),
`glass` (InstancedMesh) + `breakGlass(instanceId)`.

Everything the gameplay needs flows out of these arrays. Break one and you break the
game. The radar map generator (`engine.ts generateMapImage`) **reads `solids` and
`concrete` automatically** — so accurate map art is free as long as your geometry is in
those arrays.

### 1.2 Map builder toolkit you inherit (world.ts helpers)

`box(cx,cy,cz,w,h,d,mat)` (pushes geometry + collision solid) ·
`shape(geo,mat,x,y,z,rx,ry,rz)` · `ground(x,z,w,d,mat,y,ry)` (flat decal plane) ·
`wallRun(alongX,x0,z0,len,height,thick,holes,mat,yb,addGlass)` (walls with door/window
holes + auto glass panes + `windows[]` vault entries) ·
`house(cx,cz,w,d,{floors,wallMat,roofAccess,door,light})` (multi-floor building with
windows/doors/roof stairs) · `compound(bx,bz,size,seed,mats)` (courtyard walled compound) ·
`mosque(cx,cz)` · `depot(cx,cz)` · `marketRows(cx,cz,rows,cols)` · `fountain(x,z)` ·
`palm(x,z)` · `lamp(x,z)` · `crate/barrel` · `cover(x,z,y)` (pushes AI cover node) ·
`terrain(size,inner)` (rolling sand plane) · `perimeter(half)` (boundary walls + corner
towers) · `street(alongX,pos,from,to,w)` (road + lamps + concrete AABB) ·
`col(hex)` material cache · `M.<name>` texture set (adobeWall, adobeWall2, adobeBrick,
plaster, whitewash, sand, asphalt, plaza, concrete, rustedMetal…).

**You may add new helpers.** Suggested toolbox for the rebuild (build them):
`archway`, `colonnade`, `stallAwning`, `sandbags(cx,cz,rot)`, `wreckedVehicle`,
`waterTower`, `minaret`, `well`, `silo`, `kilnStack` (emissive coals), `retainingWall`,
`staircase` (visual only — AI can't climb), `gateHouse`, `radioMast`, `banner(pole,color)`,
`hangingLamp`, `planter`, `rampart`, `tunnelMouth`, `watchTower`.

---

## 2. THE AUTOPSY — WHY IT IS BORING (evidence, so you fix the real disease)

1. **Both maps are the same map wearing a different hat.** AL-RASUL is a flat 3×3 street
   grid with 5 prefab landmarks scattered on it. KASBAH is the same landmarks arranged on
   concentric circles. Same mosque, same market rows, same depot, same house, same
   compounds, same fountain, same palette. No map has a *place you remember*.
2. **Zero elevation.** `terrain()` only rolls the sand *outside* the town. The entire
   playable space is y=0 flat. No rooftops that matter, no overlooks, no trenches, no
   terraces. Every fight happens in the same 2D plane.
3. **No interiors that matter.** Doors/windows exist, but nothing invites you in; no
   light, no reward, no sightline value. Interiors are dead ends.
4. **Grid monotony.** Streets are straight, uniform width, evenly lamped. No chokepoints,
   no ambush corners, no long sightlines to be afraid of, no covered approach to feel
   smart about.
5. **Missions are literally identical on both maps** — advance → clear 6 → plant → hold
   60 → run back. Same pressure numbers `[3,6,6,9,6]`, same 25s fuse, same beats. The
   only difference is coordinate strings. That is *not* a mission, it's a template.
6. **No story, no escalation, no identity.** "Reach the market", "Break the market
   defence". The radio is a rules reminder, not a narrator. The hold phase is standing in
   a circle; the extract is a jog.
7. **Enemy presence is uniform mush.** Five initial squads patrol loops; reinforcements
   trickle from a symmetric ring of identical insertion points. No defending *place*,
   no front line, no flanks that mean anything.
8. **Nothing dies.** The cache detonates with an effect and then the map is… the same.
   No gates blown open, no route changed, no world state, no payoff.

**Your job: eliminate all eight, not wallpaper over them.**

---

## 3. DESIGN PILLARS (non-negotiable ambition targets)

1. **Every map gets ONE iconic silhouette** you can navigate by without any HUD —
   a landmark visible from 70% of the playable area. AL-RASUL: the **water tower**.
   KASBAH: the **citadel keep**.
2. **Verticality must change combat.** At least 6 genuinely useful elevated positions per
   map (roofs, ramparts, tower decks, terraces) reachable by the player, with cover up
   top, sightlines down into kill zones. AI stays ground-based (see §9) — that's fine,
   you design *against* that asymmetry: elevated spots must expose you to at least one
   ground angle so they never become free win buttons.
3. **Every district must be visually and functionally distinct** — different material
   set, different silhouette density, different combat rhythm (long lanes vs rat-runs vs
   courtyards). A player screenshot from anywhere on the map should be locatable.
4. **Chokepoints with intent.** Each map needs 2–3 hard chokepoints (bridge, gate,
   breach, tunnel) where the AI's reinforcement flow and the mission's beats collide
   on purpose.
5. **The mission must be a story with a shape:** quiet entry → first contact →
   escalation → betrayal moment (a flank) → crescendo → desperate exit. Radio lines
   carry it (see §7).
6. **World state must change during the mission.** Gates open/close, a tower falls, a
   bridge section collapses after the detonation, extraction route is *different* from
   the infiltration route (no same-road backtracking).
7. **Five-second test:** a new player must immediately know where to go (silhouette +
   waypoint + road grammar), what to shoot (readable enemies), and whether they hit
   (hitmarker). If not, redesign.
8. **60fps on integrated GPU.** Merged geometry, one draw call per material, no new
   per-frame CPU work, ≤2 extra real lights (see §9).

---

## 4. THE IRON RULES — BREAK NONE OF THESE

### 4.1 Automated gates (all must pass at the end)
`npm run build` · `npx tsc --noEmit` · `node --test` · `node scripts/validate.mjs`
(lint + typecheck + tests + mutation checks). The tests are **behavioral contracts**,
not busywork. Read them before editing anything.

### 4.2 Budgets (enforced by tests)
- Enemy pool: **10 alive max** (`PRESSURE_BUDGET.liveCap`), 3 per reinforcement squad.
- Soldier models: **≤36 draw calls, ≤9000 triangles** (`tests/mission-integration.test.js`
  `geometryBudget`). Do not add geometry to soldiers.
- Mission markers (cache + perimeter): **4 draws, 512 triangles** (`MISSION_VISUAL_BUDGET`).
- Mission events: **≤64** per mission (`MISSION_BUDGET.maxEvents`); phases **≤8**;
  clear count **≤30**; hold **≤300s**; insertions **≤64**; plant 1–10s; fuse 1–180s.
- World geometry: **merged per material** (the existing `geoByMat` + `mergeGeometries` +
  BVH pattern). Never add loose meshes to the scene except the instanced glass and the
  markers group. Keep total materials sane (a handful of new district materials is fine;
  hundreds is not).

### 4.3 Hard-pinned test assertions — READ CAREFULLY
These exact assertions exist today. If you change the thing they assert, you must update
the test to a **strictly stronger or equal** contract, and every other test must still
pass:

- `tests/mission.test.js:145` — `definition.phases.map(p => p.pressure.target)` must
  equal `[3, 6, 6, 9, 6]` for BOTH maps. Also `:128` and `mission-budget.test.js:37`
  assert **5 phases** for the shipped missions; `mission.test.js:128` asserts all 5
  complete in sequence.
- `tests/mission-integration.test.js:70` — uses `getMission('alrasul').phases[3]` as the
  hold phase and `phases[1]` as the clear phase; `:66` builds markers from the alrasul
  destroy phase.
- `tests/mission-world.test.js` — flood-fill from deployment: **every phase location must
  be reachable at ground level (no stairs allowed)** and **≥6 insertion sites must be
  ground-connected**. Your new maps MUST satisfy this. Any elevated objective needs a
  ground-level alternative location for the phase target (put the *marker* on the ground
  floor; stairs are flavor, never required).
- `tests/mission-integration.test.js:138-147` — SSR render of the menu: the menu must
  contain **every phase title** and the exact string `Reach the pickup to extract`, and
  must NOT contain `21 HOSTILES`. That string lives in `src/ui/Screens.tsx` (menu rules
  line) — do not remove it, and never render enemy counts in menu markup.
- `tests/mission.test.js` validates both shipped definitions with `validateMission` —
  they must stay valid per §4.4.

### 4.4 Mission schema rules (`validateMission`)
1–8 phases · phase IDs unique · **exactly one `destroy`** · **terminal phase must be
`extract`** · pressure `target` integer 0–10, `interval ≥ 0.5` · `clear` requires `zone`
+ `count` 1–30 + pressure target ≥3 · `destroy` requires `plantSeconds` 1–10 and `fuse`
1–180 · `hold` 1–300s with optional `escalate {every≥1, count≥1}` · 1–64 insertions,
each `{id, from, at:[x,y,z]}` and optional `members` = exactly 3 positions.

### 4.5 Gameplay contracts you must not break
- **Vault**: `world.windows` drives it. Every map needs plenty of windows on ground-floor
  walls, with outward normals set correctly by `wallRun`.
- **Lean**: `engine.clampLeanByWall` tests head clearance against `world.solids`. Keep
  cover near walls sane (≥0.5m clearance around lean spots).
- **Footsteps/radar**: `world.concrete` and `world.wood` drive surface sounds and radar
  shading — keep them accurate.
- **AI nav**: NavGrid is 2D (2m cells) built from `solids` at y 0.55–1.7. Anything with
  collision in that band blocks nav. Props like crates must be *cover* (`cover()`), not
  nav-blockers, unless you want them as real walls. Keep 2m-wide walkable lanes everywhere
  AI must go; do not wedge AI squads into sub-2m gaps.
- **Spawning**: `world.squadSpawns` = exactly 5 initial squads with `leader/a/b` positions
  and a patrol loop of ≥3 ground-reachable points. Reinforcements arrive via
  `missions.json insertions` — every insertion `at` must be ground-reachable and outside
  the player's deployment sightline (no spawn-kill deaths, ever).
- **Radar**: engine auto-generates the top-down map from `solids`/`concrete`. After your
  rebuild, verify the radar reads correctly (it is the player's primary navigation tool).

---

## 5. MAP 1 — REBUILD SPEC: **AL-RASUL CROSSING → "AL-RASUL FALLS"**

*Concept: a desert river-crossing town. The wadi (dry riverbed) cuts the town in two.
North bank: old mud-brick souk town. South bank: the colonial-era garrison fort, rail
depot and service quarter. Two bridges — one wide road bridge, one narrow pedestrian
footbridge — are the only crossings. The water tower looms over everything.*

### 5.1 Layout (half = 104 stays)
- **The Wadi**: a 16–20m-wide sunken channel running roughly diagonal (SW→NE) through the
  map, 2.5m below grade, with steep ramped banks every ~40m. The bed is packed earth
  (`concrete` AABB for footsteps), scattered with boulders/rocks (cover), a few pools.
  It is a **flanking lane**: full cover from street level, exposed from the bridges and
  bank tops. Crossing the bed is fast and dangerous; using it is the smart play.
- **Two bridges**: the **Road Bridge** (wide, two lanes, chest-high parapet cover, lamps)
  at the main axis; the **Footbridge** (narrow wood, no cover, creaks) 60m east.
- **North bank — Old Souk Town** (grid alleys, high density): the mosque with a **real
  minaret** (tall landmark, ground-floor archway + interior prayer hall with lightSpots),
  the covered market (canopy stalls with awning fabric colors), tight residential alleys
  (2–3m wide), a well plaza. Palette: adobe + whitewash + plaster + faded fabric awnings
  (turquoise/terracotta). Rhythm: rat-runs and ambush corners.
- **South bank — Garrison & Service Quarter** (wide streets, sightlines): the **fort**
  (walled compound: gatehouse with arched entrance, corner watchtowers with **climbable
  deck via rampart stairs**, parade ground, the cache site inside an **armory shed**);
  the **rail depot** (freight wagons as cover rows, loading platform, crane silhouette);
  the **water tower** on a low rise at the south edge — tall legs + tank, ladder up to a
  **sniper deck** that sees most of the south bank but is exposed to the fort ramparts.
- **Periphery**: checkpoint shacks on the two entry roads, residential compounds in the
  far corners, outer wall + corner towers (keep `perimeter()`), scattered palms and
  telegraph poles along roads.

### 5.2 Combat spaces (design these on purpose)
1. **Bridge standoff** — long lane, parapet cover every 6m, no flanking lane on the
   bridge itself (the wadi IS the flank). → The hold-phase arena.
2. **Souk rat-run** — 2m alleys, stall covers, a courtyard in the middle with the well as
   the only hard cover. → The clear-phase arena.
3. **Fort breach** — gatehouse approach (open, 70m sightline from the ramparts), then a
   tight L-shaped interior to the armory. → The destroy-phase approach.
4. **Depot lanes** — freight wagons create 3 parallel lanes; the crane platform gives a
   high overwatch that can't see into lane 1 (wagon roof blocks it). → flank/rear-guard
   fights during extract.

### 5.3 Verticality
- Fort ramparts + 2 watchtower decks (stairs visual; marker phases stay ground-level).
- Water tower deck (ladder), sees south bank; exposed to ramparts and depot crane.
- 3 roof-access houses in the souk (existing `roofAccess` option), overlooking alleys.
- Wadi banks as low-high: height advantage without elevation geometry.

### 5.4 Mission on AL-RASUL FALLS — **"OPERATION SANDBLAST"** (§7 has the full table)
Infiltration from the south checkpoint → cross the **Road Bridge** under fire → clear the
**souk defenders** → plant at the **armory cache** → the detonation **collapses the
footbridge** (world-state payoff: the old crossing is gone, radio reacts) → hold the
**bridge plaza** while Nomad lands → extract at the **water tower LZ**, chased through the
depot lanes by reinforcements from the north bank (the long way around via the road
bridge — you came in the front door, you leave through the service quarter).

---

## 6. MAP 2 — REBUILD SPEC: **KASBAH RIDGE → "KASBAH CITADEL"**

*Concept: a terraced hill-fortress. The citadel keep crowns a real hill; the town
descends in stepped terraces held back by stone retaining walls; six wedge districts ring
the hill, each with a distinct industry. One switchback road spirals up; the west gate is
the only breach in the outer wall.*

### 6.1 Layout (half = 112 stays)
- **Real elevation**: rewrite `terrain()` usage so the hill actually rises toward the
  citadel: grade increases in **stepped terraces** (2.5m high retaining walls between
  rings instead of flat rings). The existing ring roads become **terrace roads** along the
  terrace edges; retaining walls double as cover + climbable ledges (visual stairs at the
  switchbacks).
- **The Citadel** (top): walled keep (reuse/expand the 24×20 house as the keep with a
  gatehouse facing south), corner towers, a courtyard with the **armory cache** in a
  side court, and a **signal mast** — the tallest object on the map, visible from every
  terrace.
- **Six wedge districts** — no more copy-paste houses. Give each one a purpose and a
  distinct material/color story (see §9 textures):
  1. **Kiln quarter** (SW): squat brick kilns with **emissive coals**, smoke columns
     (static geometry), ash mounds — orange story.
  2. **Caravanserai** (W): arcaded courtyard with colonnade, stables, the well — arch
     shadows, long covered gallery, teal story.
  3. **Granary** (NW): 3 fat silos + loading hoist, grain sacks — ochre story.
  4. **Market wedge** (N): keep marketRows but make it *the* big one — 3 rows deep, awnings
     overlapping to form a covered street, the main cross-terrace path.
  5. **Tannery** (NE): shallow vats (dark water material), drying racks, reeking smoke —
     dark plum story.
  6. **Potter's quarter** (SE): open workshops, kiln lids, stacked amphorae, terracotta
     story.
- **The West Gate**: a real gate — two gate towers, a short **tunnel through the wall**
  (roof over the lane), a wooden door pair. The extraction choke.
- **Outer band**: compounds and the switchback road spiraling up between districts,
  the perimeter wall + towers, and **lookout posts** on the wall at the 4 cardinal
  points (climbable via wall stairs; see the whole outer band).

### 6.2 Combat spaces
1. **Gate tunnel** — narrow, dark, echoey, 25m long; the only west exit. → extract choke.
2. **Citadel courtyard** — the keep walls overlook a parade ground with fountain cover;
   rampart positions fire down. → hold-phase arena.
3. **Market covered street** — overlapping awnings make a long dark lane with side
   alleys into the wedge. → clear-phase arena.
4. **Kiln quarter** — glowing stacks as landmarks, heat shimmer (emissive), walls of
   brick piles — ambush corners around every kiln.
5. **Terrace edges** — every retaining wall is a firing line with a fall-off behind it;
   dropping a terrace to escape is a real maneuver (2.5m drop, no fall damage — verify
   with the engine's movement code before shipping this as a feature).

### 6.3 Verticality
- Citadel ramparts + corner towers + signal mast platform (the best view, the most
  exposed).
- Terrace switchbacks: each bend has a rock outcrop / sandbag emplacement with a down-
  slope sightline.
- Lookout posts on the outer wall (4).
- One **cliff-side staircase** (visual) connecting the granary terrace down to the
  caravanserai — a shortcut with zero cover.

### 6.4 Mission on KASBAH CITADEL — **"OPERATION RIDGELINE"** (§7 table)
Deploy at the south terraces → ascend the **switchback road** (advance, fighting
uphill — the pressure comes *down* at you) → clear the **market covered street** →
plant at the **citadel armory** → detonation **drops the granary hoist** (world-state
payoff: a lane closes) → hold the **citadel courtyard** against the counterattack while
Nomad clears the LZ → extract **through the west gate tunnel** with reinforcements
pinching from both ring roads.

---

## 7. MISSION DESIGN SPEC — THE BEATS, THE PRESSURE, THE WORDS

### 7.1 Safe path vs ambitious path
- **SAFE (Option A)**: keep the 5-phase skeleton (advance → clear → destroy → hold →
  extract) and pressure targets `[3,6,6,9,6]`. Redesign every other field: titles,
  locations, briefs, radii, zones, insertions, escalation, and the *map geometry the
  mission flows through*. All pinned tests pass untouched. **Do this if you want zero
  risk.**
- **AMBITIOUS (Option B — preferred)**: extend the mission engine with **one new phase
  type**, then update the pinned assertions (§4.3) to the new structure while keeping
  every other test green and adding new tests for the new type. Details in §8.

Either way, the mission *experience* must follow this shape (non-negotiable):

| Beat | Emotion | Mechanics |
|---|---|---|
| 1. Entry | Curiosity | Long sightline to the landmark, no enemies in the first 40m, radio sets the story |
| 2. First contact | Tension | 3 defenders at a checkpoint; the fight is winnable blind |
| 3. Escalation | Pressure | Zone alert (`onComplete.alert`) wakes the district; reinforcements start |
| 4. The work | Focus | Clear/plant under pressure, cover choices matter |
| 5. Betrayal | Panic | A flank spawn (`reinforce + from`) hits from the side you aren't watching |
| 6. Crescendo | Power | Detonation changes the world (bridge/hoist collapses, radio reacts); the hold is a *defense*, not a wait |
| 7. Escape | Desperation | Extract uses a *different route* than entry, rear-guard pressure the whole way |

### 7.2 Per-map mission tables (fill these into `missions.json`)

**AL-RASUL FALLS — OPERATION SANDBLAST** (`id: "sandblast"`, callsign `Nomad`)

| # | type | title | at (ground!) | radius | pressure | extras |
|---|---|---|---|---|---|---|
| 1 | advance | "Take the south checkpoint" | on the entry road, ~40m from deploy | 6 | t3/i12 | `onComplete: {alert:"checkpoint"}` |
| 2 | clear | "Clear the souk defenders" | well plaza, souk center | 18 | t6/i8 | `zone:"souk"`, count 6, `onComplete:{reinforce:3, from:"west", resupply:true}` |
| 3 | destroy | "Sabotage the garrison armory" | armory shed, inside fort | 3 | t6/i9 | plant 2.5, fuse 25, `onComplete:{alert:"all", reinforce:6}` |
| 4 | hold | "Hold the bridge plaza" | road bridge, south head | 15 | t9/i4.5 | 60s, `escalate:{every:15,count:3}` |
| 5 | extract | "Extract at the water tower" | water tower base, south | 6 | t6/i10 | — |

Insertions (~14): 6 on the north bank approaches, 4 on the wadi banks (they flank the
bridge hold!), 2 in the depot (rear-guard during extract), 2 at the far south road.
**Do not spawn inside the player's deployment sightline.**

**KASBAH CITADEL — OPERATION RIDGELINE** (`id: "ridgeline"`, callsign `Nomad`)

| # | type | title | at | radius | pressure | extras |
|---|---|---|---|---|---|---|
| 1 | advance | "Ascend the switchback" | first terrace bend, on the road | 6 | t3/i12 | `onComplete:{alert:"terraces"}` |
| 2 | clear | "Clear the market street" | covered market, north wedge | 16 | t6/i8 | `zone:"market"`, count 6, `onComplete:{reinforce:3, from:"south", resupply:true}` |
| 3 | destroy | "Destroy the citadel armory" | armory court, citadel | 3 | t6/i9 | plant 2.5, fuse 25, `onComplete:{alert:"all", reinforce:6}` |
| 4 | hold | "Defend the citadel courtyard" | courtyard, inside walls | 14 | t9/i4.5 | 60s, `escalate:{every:15,count:3}` |
| 5 | extract | "Break out through the west gate" | gate tunnel mouth, west | 6 | t6/i10 | — |

Insertions (~14): 4 at the outer ring gates, 4 at terrace switchbacks (downhill pressure
during the hold!), 2 at the gate tunnel far side, 2 near the granary (closed by the
detonation in the fiction), 2 south.

### 7.3 Radio script (write these `brief` lines; the engine voices them)
Rules: short (≤140 chars), present tense, second person, tell the *story* — never repeat
a mechanic the onboarding strip already teaches. Example quality bar:

- Entry (sandblast): "Wadi's dry this season. Two bridges, one way in. Cross the road
  bridge and keep low — they watch it from the souk rooftops."
- Betrayal (clear complete): "They're not breaking. More are coming over the footbridge.
  Watch your west."
- Detonation: "Armory's gone. The footbridge just dropped into the wadi — that crossing
  is finished."
- Hold start: "Nomad needs a clean plaza. The wadi banks are the danger — they'll flank
  from below."
- Extract start: "Change of plan. Nomad's setting down at the water tower. Move through
  the depot lanes — and do not look back."

Write 5–7 lines per mission. `radio(text, at)` already exists; the phase `brief` field IS
the radio line. Kill lines that sound like tutorials.

### 7.4 Squads & patrols
Rewrite `squadSpawns` for both maps: initial squads must **own territory** (one per
district/choke, not random loops) — a squad at the checkpoint, one holding the bridge
head, one patrolling the souk perimeter, one on the ramparts approach, one reserve.
Patrol loops must stay on 2m-nav-free ground, ≥3 points, and must not patrol through
the player's deploy sightline for the first 20s.

---

## 8. OPTION B — NEW PHASE TYPES (the ambitious path)

The engine's phase switch is small and pure (`mission.ts update()`), so extension is
safe if you follow this recipe:

1. **Add the type** to `PhaseType` and validation in `mission.ts`. Proposed new type:
   **`"defend"`** — *inverse hold*: an objective position must NOT be overrun. During
   the phase, hostiles within `radius` of the objective reduce a `defense` pool; the
   phase completes when `seconds` elapse with the pool > 0, and fails (mission failed →
   results screen already supports it) when the pool empties. Add `required`-style
   readout to `MissionSnapshot`/HUD. Alternative candidate: **`"breach"`** — hold X at a
   gate for `plantSeconds` (no explosion), then the gate becomes passable (world state:
   remove a solid, add a passage — implement via a pre-placed "gate" AABB you toggle
   exactly like `destroyCache` toggles the cache solid).
2. **Update `validateMission`** with the new field rules (integers, ranges) and keep the
   "exactly one destroy, terminal extract" rules.
3. **Update the pinned tests**: `tests/mission.test.js:145` pressure array, `:128` phase
   count, `mission-budget.test.js:37`, `mission-integration.test.js:70/66` indexes, and
   **add new tests** for the new type (complete path, failure path, budget path in the
   20-minute simulation). The mutation runner (`scripts/mutate.mjs`) will exercise your
   new logic — make it honest.
4. **Runtime + markers + HUD**: extend `mission-runtime.ts` event handling, the
   `objectiveReadout` switch in `src/ui/MissionObjective.tsx`, and (for defend) add a
   marker state. Stay inside the 4-draw/512-tri marker budget.
5. If you cannot keep every other test green with the new type, **fall back to Option A**
   and note why in your changelog. A boring-but-green submission beats a broken one — but
   Option B done right is the one that earns "ambitious".

Also allowed under Option A/B: per-map `insertions` can use the `members` override
(3 explicit positions) for *named* set-piece squads (e.g. a marksman trio on the
ramparts) — but remember the 10-alive cap and that `insertSquad` retires dormant actors.

---

## 9. TECHNICAL RULES FOR THE REBUILD

### 9.1 Textures & materials
Add to `textures.ts` (procedural, no external assets unless bundled and licensed):
- New wall sets: **stone block** (citadel), **fired brick** (kilns), **packed-earth
  render** (souk), **corrugated metal** (depot/fort sheds), **rough timber** (bridges,
  footbridge, stalls).
- New ground decals: **wadi bed** (cracked earth), **cobble lane**, **trampled dirt
  path**, **stone terrace pavers**.
- Colored awning fabrics (4–5 colors) for stalls; faded banner materials (the banner
  colors become the district color-coding: teal = caravanserai, ochre = granary, etc.).
- Emissive variants: kiln coals (`col(0xFF5A1E, ..., emissive 2)`), lanterns, signal
  mast beacon.

### 9.2 Lighting & atmosphere
- `world.lightSpots` → engine keeps the nearest 2 as point lights. Place lightSpots
  *strategically* (fort interior, souk prayer hall, gate tunnel, caravanserai gallery) —
  interiors must not be caves. If you raise the engine's slice(0,2) to slice(0,4),
  justify it with perf numbers in your changelog (2 is the safe default).
- Sky: the engine already has a sky dome + sun sprite + static cloud meshes
  (`cloudMat` in engine.ts ~line 733). **Make the clouds drift** (tiny per-frame rotation
  or position lerp in the existing cloud update code — GPU cost ≈ 0) and, if cheap,
  add a second cloud layer for parallax.
- Keep the desert daylight (readability is a pillar) but push the horizon color slightly
  dustier per map: warm ochre for AL-RASUL, cooler haze for KASBAH's hilltop.
- The **detonation payoff**: `engine.detonate(at)` exists. Extend its *visual* only
  (dirt plume, lasting smoke, scorch decal on the ground) and use it on both maps.

### 9.3 World-state changes (the "nothing dies" fix)
Implement at least one *real* map change per mission, toggled exactly like
`MissionMarkers.destroyCache` toggles a solid:
- AL-RASUL: the **footbridge collapses** after the detonation (mark its solids
  `minY=10000`-style, hide its mesh, add a rubble pile that is now cover; radio line).
- KASBAH: the **granary hoist falls** and blocks the granary→caravanserai lane (add a
  solid + wreck mesh on the event).
Both are event-driven, zero per-frame cost, and make the world feel alive.

### 9.4 Nav / AI safety
- Keep ≥2m-wide lanes everywhere AI paths (NavGrid cell = 2). Test every squad patrol
  with the flood-reachability helper pattern used in `tests/mission-world.test.js`.
- Place 25–40 `coverNodes` per map *along* fight lanes and courtyards (AI picks cover
  from this list); clusters of 3–5 around each arena, none inside solid geometry.
- Terrace drops / wadi banks: AI stays on flat ground — fine. Just never put an
  insertion point, patrol point, or phase marker where the flood-fill can't reach it.

### 9.5 Performance
- Everything merged per material (the existing pattern). New materials = new merged
  meshes — keep the total ≤ ~20 draw calls for the world group.
- No per-frame CPU work in world code. Emissive = static. Smoke = static geometry.
- `frustumCulled=false` on merged meshes is the existing pattern — keep BVH; do not
  subdivide the world into many small meshes to "fix" culling (raycasts depend on
  `occluders`).
- After the rebuild, sprint through each map's densest plaza and record the FPS counter:
  must stay >55 on the dev machine.

### 9.6 UI sync (small but required)
- `MAPS` copy in `world.ts` (name/desc) feeds the menu cards — write premium one-liners.
- `Screens.tsx` route timing chips are hardcoded (`60 SEC`, `25 SEC FUSE`) — update if
  your hold/fuse numbers change.
- Verify the **radar** (bottom-left) reads your new map correctly at its 60m zoom and
  that the map image generator's walkability shading matches reality (it samples
  `world.solids` — accurate geometry = accurate radar, free).

---

## 10. VERIFICATION PROTOCOL (do all of it, report all of it)

1. **Automated**: `npm run build` + `npx tsc --noEmit` + `node --test` + `node scripts/validate.mjs`
   all green.
2. **Playthrough ×2** (both maps, Normal): deploy → advance → clear → destroy → hold →
   extract, plus: die once per map, vault through a window, lean Q/E at 3 spots, slide,
   frag (G hold), flash (F), all 5 weapons, pause/resume, settings, redeploy, results.
3. **The 5-second test** (both maps): from spawn, without touching the HUD, where do you
   go? The landmark silhouette + road grammar must answer it.
4. **Radar check**: radar art matches the streets you walk; no phantom walls; the 60m
   window is readable at a glance.
5. **AI check**: no squad stuck on props for 30s; reinforcements arrive from believable
   directions; nobody spawns on screen.
6. **Budgets**: FPS >55 sprinting the densest plaza; no draw-call regressions
   (compare `renderer.info` if you instrument it); soldiers and markers untouched
   budgets.
7. **Screenshots**: capture menu + one mid-fight + one landmark shot per map. If a
   screenshot isn't instantly recognizable as *that map*, you failed pillar 3.
8. **Write `CHANGELOG.md`**: table of Flaw → Severity → What you built → Result, with
   the two map playthrough notes.

## 11. DELIVERABLES

1. Rebuilt `world.ts` (both maps + new helpers + new districts + world-state hooks).
2. Rewritten `missions.json` (both operations, new insertions, new radio script).
3. New textures in `textures.ts` + any engine.ts atmosphere/lights/cloud/detonation
   visuals (gameplay untouched).
4. Optionally (§8): the `defend`/`breach` phase type with engine, HUD, markers, and
   **stronger tests**.
5. Updated UI copy (menu map cards, route chips) and the radar-accuracy verification.
6. A `CHANGELOG.md` audit table + playthrough notes.
7. Everything committed on the working branch with a descriptive message.

## 12. THE CREED

> Every district must have a purpose, every sightline a threat, every phase a reason to
> exist, every detonation a consequence. If the player can describe your map in one
> sentence that doesn't mention rectangles, and can't wait to see what the next phase
> throws at them — you're done. If not, keep going.
