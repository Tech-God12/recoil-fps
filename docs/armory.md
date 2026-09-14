# Armory & Loadout System

Cash economy → post-mission Armory → click-to-customise 3D guns → attachments that
change both stats and meshes. Profile persists in `localStorage` (`recoilfps.profile.v1`).

## Cash flow

| Event | Cash | Where |
|---|---|---|
| Kill (body) | $100 | engine kill sites (bullet, grenade, Masterkey) |
| Kill (headshot) | $150 | bullet / Masterkey kill sites |
| Streak marks 3/4/5 | +$50 / +$100 / +$150, once per chain, $500/run cap | streak banner block |
| Phase complete | $200 | mission `scoreBonus` host callback |
| Extraction (win) | $750 | `endMatch(win=true)` |
| Grade bonus (win only) | S $600 / A $400 / B $200 / C $100 / D $0 | App debrief |
| Loss | keeps 100% of run cash, forfeits extraction + grade | App debrief |

Debrief: `earned = round(runCash × difficultyMul) + gradeBonus`, with Easy ×0.8 /
Normal ×1.0 / Hard ×1.25. `gradeFor` lives in `economy/rewards.ts` and is shared by
the Results stamp and the payout, so they cannot disagree.

Worked example (competent first run, Normal, B): 12×$100 + 3×$150 + $50 + $100
streaks + 3×$200 phases + $750 extraction = $3,150 × 1.0 + $200 = **$3,350**.
Full catalog ($65,600) unlocks in ~19–20 such runs.

Every award emits a `{ type: 'cash' }` event (HUD pop) and appends to `cashLog`,
which the Results screen itemises with staggered rows and a wallet tween.

## Controls

| Input | Action |
|---|---|
| 1 / 2 | Primary / sidearm |
| Q (tap) | Quick-swap to last weapon |
| Q (hold) / E | Lean left / right |
| B | Masterkey breacher (if fitted, 3-shell tube, 3.5 s reload) |
| V | LPVO low/high power toggle (if fitted) |
| R / G / F / C / X / Space | Unchanged (reload, frag, flash, crouch, plant, vault) |

**Binding change:** Q used to lean left only. It is now dual-purpose — tap swaps,
hold leans — because the two-gun loadout needs a fast swap key and every nearby
key was taken. The menu legend and onboarding strip document both beats.

## Files

- `src/game/economy/` — pure TS, Node-tested: `catalog.ts` (10 guns, 32 parts),
  `stats.ts` (resolution; flat mag adds apply before multipliers), `rewards.ts`
  (payouts, grades), `loadout.ts` (primary/secondary builds), `profile.ts`
  (wallet, per-weapon ownership, versioned persistence).
- `src/game/models.ts` — 10 procedural builders. Each returns sockets (muzzle,
  optic, magazine, underbarrel, stock, rail, barrel), removable stock-mesh groups,
  and a clean `attached` map. Magazines carry `homeY/homeZ` for the reload dip.
- `src/game/attachments.ts` — 32 part builders in socket space plus `attach` /
  `detach` / `applyBuild`. Muzzle parts reseat the muzzle anchor; barrel parts
  move the bore (cans follow); optics report `sightYOffset` for ADS alignment and
  join `adsHidden`; bipods expose folding leg pivots.
- `src/game/engine.ts` — builds the fielded pair from the Loadout, applies
  resolved stats (falloff, ADS time, recoil, noise, sway, flash, per-axis spread,
  move speed, swap time), drives slide/pump/cover/bipod animation, laser dot +
  flashlight, suppressor behaviour, Masterkey, LPVO, and the cash ledger.
- `src/ui/armory/` — `Armory.tsx` (terminal: click-to-preview rail, explicit buy,
  fielded-loadout strip, finish picker), `GunViewer.tsx` (orbit viewer with
  socket hotspots, click-the-gun picking, full-color locked previews with a
  lock note, attach fly-in, podium staging, and a light rig identical to the
  in-game viewmodel), `CashCounter.tsx` (odometer).
- `src/App.tsx`, `src/ui/Screens.tsx`, `src/ui/Hud.tsx` — armory phase, cash
  breakdown + OPEN ARMORY, cash counter/pops, weapon card, optic reticles.

Hidden balance affordance: open the menu with `#cash=50000` to grant it once.

## Catalog prices

Weapons: M4A1 / M1911 starter · MP7 $2,400 · Deagle $3,200 · AK-47 $3,800 ·
Vector $4,600 · SPAS-12 $5,200 · SCAR-H $6,400 · AWM $7,800 · M249 $8,600.

Attachments: Flash Hider $250 · Compensator $500 · Suppressor $800 · SR Moderator
$1,200 · Heavy Brake $700 · Duckbill $500 · Full Choke $600 · Red Dot $450 ·
Holo $700 · ACOG $1,050 · LPVO $1,400 · HP 12× $1,650 · Micro Dot $500 · Ext Mag
$600 · Drum $1,350 · Fast Mag $700 · Shell Tube $700 · Belt Box $1,300 · SR Box
$750 · V-Grip $400 · Angled $500 · Bipod $550 · Masterkey $1,800 · No Stock $300
· Heavy Stock $650 · Folding $700 · Laser $450 · Light $350 · Canteds $400 ·
Long Barrel $750 · Short Barrel $700 · Ported $550.

## Finishes

Per-weapon finishes ride `WeaponBuild.skin`: `economy/skins.ts` (catalog) →
`profile.skins` + `setWeaponSkin` → `applySkin` repaints the 3D gun in the
viewer and in-game (both clone materials per gun first, so shared WM never
changes). Only the Factory finish ships; locked guns can still pick, and the
choice applies on purchase. New finishes are data-only: one catalog entry with
per-role coats for the metal/polymer/wood palette — arms, ammo, rubber, glass
and emissive marks are never repainted.

## Procedural gun models (iteration 4 rebuild)

All ten guns were rebuilt from reference silhouettes — M4 carry handle + KAC
rail with vented handguard, AKM slant brake + ribbed dust cover, 1911 beavertail
+ diamond-checkered walnut, AWM olive thumbhole chassis + fluted barrel, MP7
wire stock + side plates, KRISS slab receiver, SPAS-12 side saddle + ghost ring,
SCAR-H FDE rail + PWS comp, Deagle triangular slide + gas housing, M249 belt +
carry handle + QD barrel. Display names are full real-steel (ids and shorts
unchanged): Colt M4A1, Kalashnikov AK-47, Colt M1911, AI AWM .338, H&K MP7A1,
KRISS Vector .45, Franchi SPAS-12, FN SCAR-H, Desert Eagle .50 AE, FN M249 SAW.

Rebuild rules, all covered by tests: socket names/positions, muzzle, removable
groups, `adsHidden`, `sightY` and arm anchors are preserved so every attachment
still seats; new `midSteel`/`od` materials feed the skin system. `GunBuilder`
auto-flats prims under 0.035 m to plain boxes (12 tris vs ~150), which funds
rail teeth, vents, ribs and pins inside the budgets above. Vector/SCAR/M249
gained proper removable barrel groups; the AWM scope rings now hide with the
scope instead of clipping fitted optics, and its forend reaches the bipod
spigot. The armory UI is a floating-glass command bar over the 3D stage (no
title slab, no loadout strip); no emoji anywhere in UI chrome — SVG lock, CSS
status dots, text glyphs.

## Measured deviations from the prompt draft

- Draw calls run 30–41 per gun (merged bucket per material per subgroup), not ≤10;
  triangles 3.0k–7.2k. Both are pinned by tests as regression budgets
  (draws ≤ 44, tris 5k–12k primaries / 2.5k–12k secondaries).
- Catalog totals $65,600 (prompt suggested $55–65k); the pacing intent holds at
  ~19–20 runs to full unlock.
- Bipod "prone" is crouch + grounded + near-stationary; it works at hip and ADS.
- Laser and flashlight are always on while fitted (no toggle key, no battery).
- Slide animation covers pistols and the SCAR (reciprocating designs); the M249
  cover pops vertically on reload rather than hinging; SPAS shell-loading is a
  forend pump plus timed shell clicks, not per-shell meshes.
- Optic tubes and housings are genuinely see-through (open bores, front + rear
  lenses). Only the 3D aiming mark hides in ADS; the glass stays, and the HUD
  reticle (dot / holo ring / ACOG chevron / scope) is the single source of
  truth. LPVO low power shows the chevron through the tube (V toggles 6×).
