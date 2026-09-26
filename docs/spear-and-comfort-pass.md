# SPEAR & Comfort Pass — 2026-09-26

This pass extends the existing world, armory and performance work without adding a
third-party model pack or an expensive per-frame system.

## New armory platform: MCX-SPEAR

The new **MCX-SPEAR** is a 6.8×51 battle rifle: a disciplined 20-round magazine,
a deliberate 675 RPM cadence, long-lane falloff tuning, and a balanced high-power recoil impulse. It is purchasable
in the Armory and in Sirocco's rifle category, appears in loadout thumbnails, uses the
same attachment/finish path as every other gun, and has a dedicated layered report
instead of borrowing the SCAR sound.

### Reference-led visual brief

The visual model was researched against the public 16-inch MCX-SPEAR product
specifications, which call out the **20-round AR-10 magazine, free-floating M-LOK
handguard, two-position adjustable gas valve, non-reciprocating side charging handle,
ambidextrous controls, and folding telescoping stock**:

- [SIG MCX-SPEAR product overview](https://www.sigsauer.com/mcx-spear.html)
- [Detailed platform specification](https://www.provenoutfitters.com/sig-sauer/mcx-spear-6-8x51-16-rifle-coy-3128)

It is a native, procedural Three.js assembly — not a downloaded game rip. The coyote
upper/lower, AR-10 magwell, piston and barrel, flash hider, handguard, folding hinge,
stock rails and buttpad are separately authored but physically seated. The sight rail,
front-sight bridge, barrel crown and stock hinge were adjusted against the repository's
BVH contact audit until there were **no disconnected solid pieces**. The full factory
and attachment test path also validates muzzle bores, reload anchors, Armory bounds,
ADS geometry, clearance and render budgets.

## New quality-of-life and accessibility controls

All controls persist safely and apply live. The pass now offers more than the five
requested player-facing improvements:

1. **Auto sprint** — forward movement sprints whenever the weapon is ready; sprint,
   ADS, crouch, reload, slide and lean safety gates still apply.
2. **Auto reload on empty** — chambers the next magazine immediately after the final
   round; turn it off for deliberate magazine management.
3. **Crouch mode** — choose familiar toggle crouch or hold-to-crouch on C / Ctrl.
4. **Reduced motion** — caps camera shake, damps weapon sway/walk bob, and removes
   nonessential UI motion without weakening aim or recoil input.
5. **HUD scale** — scales combat information independently of render resolution.
6. **Color-vision profiles** — semantic HUD, radar, team and damage colors update for
   protan, deutan and tritan profiles.
7. **Compact tactical HUD** — hides the lower radar for an unobstructed screen while
   keeping the full planning map available.
8. **High-contrast HUD** — more opaque panel surfaces and stronger edges in sunlit scenes.
9. **Live tactical map** — M opens the authoritative full-map view without pausing.

## Audio / effects repair

Muzzle smoke had regressed into the generic impact-particle pool. It now has a
separate eight-slot, 70 ms-throttled pool: smoke rises and clears in about 1.1 seconds,
while blood and impact bursts never get evicted during automatic fire. The MCX-SPEAR
report adds a compact 6.8 pressure crack, echo body, low thump, piston clack and
late mechanical tick. Dedicated effects, footsteps and ambience buses let players
raise critical sole/surface cues without making wind or gunfire overpowering.

## Verification

- TypeScript: `npx tsc --noEmit`
- Effects: `node --test tests/effects-gunfeel.test.js`
- Armory contact/bore/attachment audit: `node --test --test-concurrency=1 tests/weapon-assembly.test.js`
- Catalog, settings and shop tests cover the new weapon, saved comfort preferences and
  live Sirocco availability.
