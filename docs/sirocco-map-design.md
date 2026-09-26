# Sirocco — map art note

Sirocco's 88 m three-lane layout remains authored by `src/game/maps/sirocco.ts`; no
walkable rectangle was moved. The build pass treats the complement of those rectangles
as the town mass, so art and navigation continue to share one source of truth.

## Intent and palette

- **A LONG / A SITE:** bleached plaster and limestone trim, shuttered openings, arcades,
  projecting sills and a warm paver plaza. Low-angle golden light catches the deep reveals.
- **MID / CT MID:** a civic spine with formal paving, a cistern, colonnade, directional
  signage and the minaret landmark. The centre reads as public space rather than another
  anonymous alley.
- **B TUNNELS / TUNNEL YARD:** cold poured concrete, service cable runs, roof beams and
  stained grey infrastructure under the existing tunnel roof. Two flickering lights keep
  the echoing route readable without exceeding the light pool.
- **B SITE / B DOORS:** a tiled market edge with striped awnings, stall posts and hanging
  goods. The canopy and market bell announce the entry without closing the competitive lane.
- **T SPAWN / T ALLEY / UPPER ALLEY:** mud-brick residential edges, laundry, painted
  thresholds and satellite silhouettes. They frame the attack routes without adding solids
  to UPPER ALLEY, B DOORS, A SHORT or B WINDOW.

High detail adds deep-window modules, mashrabiya slats, roof coping, cables and cloth as
non-colliding dressing. Low detail retains exactly the same solids, cover nodes and nav
cells. The additional triangle budget is spent on silhouette and shadow shape, not new
draw materials; the elevation plate is `docs/screenshots/maps/sirocco-elevation.png`.

## Orientation

Each lane now has an architectural endpoint: the limestone arch and minaret on A, the
civic cistern and south gate in mid, and the tunnel service portal / market bell on B.
These are also registered as world landmarks for bot callouts and the compass.
