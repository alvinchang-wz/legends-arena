# The 5v5 map

The board is generated geometry. `docs/drafts/mlbb-clean.py` reads the
survey of the reference map (`../dataset/world/handoff/` in the workspace,
or a private copy in `docs/mlbb-handoff/`, which is gitignored because it
contains stitched game screenshots) and writes `js/map-data.js`,
which `js/map.js` scales onto the engine's world. `js/mapart.js` paints it.

Layout: Blue base bottom-left, Red base top-right, mid on the diagonal, top
lane up the left edge and along the top, bottom lane along the bottom and up
the right edge, the river on the other diagonal with the Lord pit toward the
top-left and the Turtle pit toward the bottom-right. 180-degree point
symmetry: everything is authored on Blue's half and rotated.

What the pipeline does to the surveyed data:

- **Lanes** are rebuilt as straight edge roads with one rounded corner and a
  dead-straight mid, all the same width; the 18 turrets are snapped onto them.
- **Walls** come from the classified wall pixels: the surveyed half wins the
  symmetry, specks are dropped, near-touching rock is fused, corridors are
  widened to a minimum, corners are rounded, and the result is skeletonised
  into the engine's wall type (a thick polyline: points plus radius). Every
  camp and both pits get clean ring walls with the openings the data shows.
- **Bushes** come from the classified bush pixels, cleaned and fitted as
  circles or capsules, kept off walls and lane centres.
- **Camps, pits, bases** sit at their measured positions.

Regenerate after editing the pipeline:

```bash
python docs/drafts/mlbb-clean.py     # writes js/map-data.js and docs/drafts/draft-c.png
```

The blockout drafts in `docs/drafts/` record how the design got here: Draft A
is the user's own drawing, Draft B the raw survey, Draft C the cleaned map.
