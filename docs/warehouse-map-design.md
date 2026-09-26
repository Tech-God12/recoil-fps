# Warehouse — map art note

Warehouse remains a 112 m combat box with the existing balanced routes, but its authored
combat spaces now have a stronger industrial grammar. The retained four-sided wall is an
impassable safety boundary; rail sidings, a gatehouse, transformer fencing, pallet parks
and a silo explain what lies beyond it.

## Intent and palette

- The **west transit shed** is cool steel: racking, a conveyor spine, clerestory ribs,
  oil-polished concrete and hard monitor light. The **east goods store** uses warmer brick
  and timber silhouettes. Their travel and cover budgets stay balanced while the two spawn
  directions are visually distinct.
- Existing hall mezzanines now have stairs at both ends. Container and flatcar overlooks
  retain their authored stair approaches, so raised positions have an exit rather than
  becoming a camping perch.
- The three combat ranges are explicit: long marksman sightlines in the sidings, mid-range
  fights through the warehouse / dock doors, and tight container-and-rack angles around
  the side yards. Spawn screens still block a direct centre-to-spawn view.
- Bay marks, hazard paint, roof monitors, pallet labels and oil tracks are flat cached
  dressing. The two work lights per hall and dust motes continue to feed `arenaFx`; the
  engine's light pool still reduces the eight dressing lights to four shader lights.

The high-detail tier spends triangles on racks, gussets, roof ribs, fencing and boundary
silhouettes, using the existing flat batch so it does not add a draw call. Low detail keeps
the same colliders, cover nodes and 2 m nav cells. The offline review is
`docs/screenshots/maps/arena-elevation.png`.
