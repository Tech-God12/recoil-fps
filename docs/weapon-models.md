# Weapon assemblies

All eleven viewmodels use the same procedural assemblies in gameplay and the Armory.
The public builders and `WeaponModel` interface remain available from
`src/game/models.ts`; existing platform stats, attachment compatibility and prices remain data-driven.
The geometry remains native Three.js; no third-party model pack is used.
`three-bvh-csg` supplies cached geometric machining (blind pockets and through cuts). Four optimized, generated material tiles are
checked in under `src/assets/weapons/` and embedded in the single-file build.

## Geometry and finish

| Weapon | Distinguishing geometry |
| --- | --- |
| M416 | Rounded bolt tunnel over a separate AR lower, flared/open magwell, hollow octagonal quad rail with cut vents, triangular stock, curved recessed-channel STANAG; bare handguard rather than an added factory foregrip |
| AK-47 | Domed stamped-cover ribs, rivets and recessed receiver dimples; genuinely varying-width walnut stock and handguards |
| 1911 | 24-step rounded blued slide crown, closed breech/stop plate, curved open trigger bow, sculpted diamond-checkered walnut, two slotted grip screws and genuinely cut rear serrations |
| AWM | Oval thumbhole, countersunk chassis wells, rounded cheekpiece, folded forward bipod, tapered hollow barrel and ring-mounted scope |
| MP7 | Layered moulded shell with recessed louvres/bolt opening, folding foregrip, grip-fed magazine and guided telescopic stock |
| SCAR | Broad monolithic upper with machined longitudinal raceways and oval vents, distinct bolt/mag catches, straight tan box magazine, stepped folding boot stock and tan contoured grip |
| MCX-SPEAR | Coyote monolithic upper, free-float M-LOK forend with recessed slots, non-reciprocating side charger, short-stroke piston hardware, 20-round AR-10 steel magazine and a hinged telescoping skeleton stock |
| Vector | Compound Super-V housing, inset service plates, machined shoulders, low bore and contoured backstrap |
| SPAS | Hollow slotted rolled heat shield, rounded ribbed pump and wrap-ribbed pistol grip, clean blued receiver without the red shell saddle, perforated folding stock |
| Deagle | Chamfered fixed barrel and reciprocating slide, frame scallops, broad textured grip, safety serrations and open crown |
| M249 | Sculpted front-hinged cover with underside pawls, layered feed tray, linked brass belt, stencilled olive box, rounded carry handle and waisted solid stock and folded bipod |

`src/game/weapons/geometry.ts` supplies multi-segment bevelled profiles, hollow
sections, annular tubes, turned surfaces, continuous variable-width furniture
lofts and endpoint-defined struts. Smoothing uses micrometre-scale position keys,
not the centimetre-scale quantization of the general-purpose Three utility.
Small machined hardware is tessellated less heavily than hero silhouettes.
`furniture.ts` contains continuous magazines, sights, rails, open guards,
countersunk fasteners and an engraving atlas.

### Machined shape revision

The receiver pass removes the broad, decorative side plates that made the AR and
SCAR read like the same extrusion. Their receiver cross-sections, magazine wells,
stocks and controls are independently modelled. A regression probes the AR's
curved upper versus the SCAR's broad sidewall, and the AR stock's open triangle
versus the SCAR's solid boot; this distinction does not depend on paint colour.

`GunBuilder.mill()` performs real Boolean removal on the last solid. Pocket walls
and floors carry their own cavity shading, while bevels retain polished edge wear.
Continuous curved magazine channels and pistol serrations are removed geometry,
not dark rectangles or raised strips. Results are cached by shape **and UVs**, with
a bounded 128-entry cache. Every caller owns a clone, so disposal/rebuilds cannot
corrupt another gun; no machining runs in the rendering loop. A small `MillingBrush`
adapter uses the existing BVH package's current API without patching dependencies.


`finish.ts` combines 1K colour/roughness tiles, 512² stipple/checkering, physical-scale
UV projection, per-piece tonal variation, cut-cavity shading, and **bevel-only, broken wear**.
`distress.ts` adds a shared deterministic scratch/handling-abrasion atlas. Broad
faces do not receive an all-over silver outline mask. Checkering has both relief
and dark cut valleys. `core.ts` defines the palette and skin roles.
`WeaponFinish` keeps its shader hooks on the prototype so ordinary material
`.clone()` calls in both the viewer and game preserve the finish while sharing maps.

### Deliberate quality-budget revision

The earlier **12k-triangle** pass was visually too flat. The reference-led pass
raised the factory geometry cap to **48,000 triangles**, while retaining the
original **44-draw** cap. Rounded furniture, proper openings and continuous bevels
receive the extra geometry; tiny rail teeth and fasteners use adaptive tessellation.
Each rigid assembly and each arm remain batched by material. The new machining
pass retains these caps; small internal bores and rail chamfers are adaptively
tessellated rather than raising the budget again.

Measured factory geometry, **including arms** (not an FPS benchmark or a count of
shadow/postprocessing passes):

| ID | Draws | Triangles |
| --- | ---: | ---: |
| m4a1 | 30 | 47,217 |
| ak47 | 30 | 31,607 |
| m1911 | 28 | 18,684 |
| awm | 31 | 40,792 |
| mp7 | 33 | 30,847 |
| scar_h | 32 | 37,005 |
| mcx_spear | ≤44 | ≤48,000 |
| vector | 36 | 29,231 |
| spas12 | 28 | 36,742 |
| deagle | 30 | 13,906 |
| m249 | 44 | 41,676 |

Shared image assets total **~787 KiB**; there is no per-gun image duplication.
The soldier's smaller world rifle still uses a lower-cost connected silhouette.

### Viewer / texture readiness

The Armory awaits `weaponTexturesReady` and yields between thumbnails rather than
permanently caching untextured first renders or blocking the UI with eleven builds.
The main viewer uses self-shadows; its 2048² shadow map refreshes for a refit or swap
transition, not for every camera-only orbit frame. The large plinth is hidden so the
reference-style backdrop and complete weapon silhouette stay unobstructed. Live clones, attachment pulses,
visible bounds and picking retain their existing ownership / mounting contracts.

### MCX-SPEAR research and implementation

The MCX-SPEAR visual design was researched against public product specifications: the
[16-inch 6.8×51 configuration](https://www.sigsauer.com/mcx-spear.html) and a detailed
[platform specification](https://www.provenoutfitters.com/sig-sauer/mcx-spear-6-8x51-16-rifle-coy-3128)
identify the AR-10 20-round magazine, free-floating M-LOK handguard, adjustable
short-stroke piston, ambidextrous controls, non-reciprocating side charger and folding
telescoping stock. The game model builds each of those as joined geometry, rather than
adding a flat texture or importing a third-party mesh. It has a dedicated 6.8×51 report
and is available in both the Armory and Sirocco buy menu.

## Mounting and animation invariants

- Weapon coordinates: **−Z forward, +Y up**. Copy both a socket's position and
  quaternion, and attach to its **parent**, not unconditionally to the gun root.
- Pistol optics follow the slide. M249 optics/rear sight follow its hinged cover.
  The SPAS underbarrel mount follows its pump; a tube extension must not replace
  that pump as the reload handle.
- Attachment removal uses the union of all active replacements. Stripping an
  optic/barrel/muzzle must not resurrect a factory piece another slot still hides.
- Muzzle position is recomputed from home anchors, barrel length and device length;
  repeated swaps must not accumulate offsets.
- Magazines fit their host's well. The coupled magazine keeps the feeding shell
  centred. The Vector drum sits below, not through, its foregrip.
- Sliding parts preserve their home transform; the M249 cover rotates about a
  fixed hinge. Attachment bipods fold forward about X-axis pivots.
- Weapon previews use visible, gun-local bounds, excluding arms and removed parts.
  Fitting feedback is an emissive pulse, never a floating/exploded part animation.
- Shared `WM` materials/textures are not owned by a single gun. Viewer/engine finish
  clones are owned by their caller and must be released without disposing shared assets.

## Regression checks

```sh
node --test --test-concurrency=1 tests/armory-models.test.js tests/weapon-assembly.test.js tests/weapon-animation.test.js tests/weapon-finishes.test.js tests/weapon-machining.test.js
node scripts/validate.mjs
npm run build
```

The assembly suite checks every factory gun and all **144 supported single-part
pairings**, plus 40 sampled fully equipped builds and restoration in reverse order.
Named source-solid ranges survive batching, so the contact audit checks actual
triangles with a BVH, not just scene parenting or overlapping bounding boxes.
Symmetric nearest-surface checks handle coplanar contacts; enclosed pins count as
seated. A **0.55 mm** contact tolerance permits bevel/float rounding. Arms, optical
surfaces and engraving decals are excluded from the solid-contact graph.

Separate geometry checks cover magazine/foregrip clearance, real trigger openings,
open muzzle bores with closed pistol breeches, uninterrupted magazine shells and a clear scope axis. Negative
controls deliberately detach a stock and move a drum through a grip, ensuring the
checks actually detect those faults. Animation tests exercise the engine's slide,
cover and bipod transforms. Surface regressions cover clone-safe shader hooks,
shared texture ownership, restoring Factory after a test coat, metre-scaled UVs,
flat-face wear exclusion, variable-width lofts and reference-specific factory details.

These are visual game assemblies, not CAD solids: deliberate seating overlaps are
normal. The clearance suite checks magazines against supported underbarrels, not
every possible pair of surfaces during every animation.

For visual review, open **Loadout**, orbit/zoom each gun, and fit/strip barrel,
muzzle, optic and magazine combinations. Deploy to check hip fire, ADS, firing,
reload and switching. Pay particular attention to slide-mounted pistol optics,
the SPAS pump/tube extension, Vector drum clearance and the M249 cover hinge.
