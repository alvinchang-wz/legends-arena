# The 5v5 map

The board is generated geometry. `docs/drafts/draft-d.py` writes `js/map-data.js`,
which `js/map.js` scales onto the engine's world; `js/mapart.js` paints it.
Never edit `js/map-data.js` by hand: change the pipeline and rerun it.

## Sources

Two measurements of the real Land of Dawn are combined, both in the survey's
"map px" frame (the 520 x 478 minimap crop; symmetry centre (250.5, 222.0);
the playable square is 436 px on a side, so one map px is about 14.7 world units).

- **The survey** (`../dataset/world/handoff/` in the workspace, or a private
  gitignored copy in `docs/mlbb-handoff/`): the phone agent walked the map in
  practice mode. It gives the positions of both bases, all 18 turrets, the 14
  camps and the two pits, plus the hero speed (about 22.5 map px per second).
- **The reference minimap** (`../dataset/world/reference/Minimap.png`, the
  wiki's 512 px top-down minimap): the shapes of every rock and bush.
  `docs/drafts/ref-align.py` clusters its colours into wall / bush / river /
  lane layers, pins its own point-symmetry centre onto the survey's, fits the
  two scales against the survey's walls, and keeps only rock that agrees with
  its 180-degree rotation (the minimap draws a drop shadow at the bottom-right
  of every rock, which the rotation test cancels). Output: `minimap_layers.npz`.

## What the pipeline does

1. **Lanes**: three polylines, width 38 map px (measured). Top and bottom run
   along the board edges (centrelines at x = 51 and y = 24) with a chamfered
   corner between them; mid is dead straight through the centre. Turrets are
   the survey's positions snapped onto the lanes.
2. **Walls**: the aligned minimap's rock layer, symmetrised, with the lanes,
   bases, camp floors and turret pads carved free, specks removed and every
   corridor widened to at least 5.5 map px. Each rock is then an exact
   polygon: the blob's outline traced at 2 raster px per map px and
   simplified by a third of a map px (`poly`, plus `r`, the largest inscribed
   radius, which sets its height). Overlap with the reference mask is 0.99.
3. **Corners**: the two cut-off corners beyond the lane chamfers are void
   (`void` polygons): the painter shows water there and a hidden polygon
   wall keeps units out.
4. **Bushes**: the aligned minimap's bush layer, symmetrised, as exact
   polygons the same way. 32 bushes.
5. **River**: a channel of half-width 10 from the Lord pit through the centre
   to the Turtle pit, with pools at both pits (r 25) and a pond at the mid
   crossing (r 30) that the lane bridges.
6. **Checks**: every camp and turret reachable from the blue base, no enclosed
   free pockets.

The blockout `docs/drafts/draft-d.png` is the same data drawn flat.
`docs/map-overview.jpg` is the engine's own bake.

## In the engine

- Polygon walls: `wallClosest` returns the closest point on the outline and
  whether the point is inside; `wallBlocks`, `separate()` (which ejects an
  inside unit through the nearest edge), `inBush` and the painters all use
  the same polygons, so collision and visuals are the same shape. Capsule
  chains (`pts` + `rs`) are still supported for the other modes.
- A polygon rock is painted as its footprint extruded upward in shade steps
  to a lit top (`MapArt.drawWallPoly`), depth-sorted by its lowest edge.
- `hidden` walls block but are not drawn; `MAP_VOID` are the corner polygons.
- `POOLS` comes from `pools` in the data (lord, turtle, centre pond).

## Provisional values

Turret range (30 map px) is not in either source. Hero speed relative to the
board is untuned: the reference walks about 25 percent faster than ours.

## Drafts

- Draft A: the user's 8-slice design, cleaned in several passes (`draft-a*.png`).
- Draft B: the Mobile Legends blockout drawn from the survey (`mlbb-blockout.py`).
- Draft C: Draft B cleaned by `mlbb-clean.py` (walls from the walked classification).
- Draft D (current): walls and bushes from the reference minimap (`draft-d.py`).
