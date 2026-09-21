# The Sundered Crown — the 5v5 map

Designed from scratch on 2026-09-21. Not a copy of any existing MOBA map; it
keeps only the three-lanes-and-a-jungle skeleton. Layout: `js/map.js`.
Painting: `js/mapart.js`. Overview: `sundered-crown-overview.jpg`.

## Symmetry

Blue base bottom-left, Red base top-right, mid lane on the diagonal. The
board mirrors across the *other* diagonal (`swapPt`, y = x). That swaps the
two bases while keeping each side lane what it is, so both teams walk the
same two roads — and the two roads are deliberately different.

## The two roads

- **Cliff Road (top).** Long, hugs the board edge, pines and stone, only two
  thickets per team. The safe farming lane; ganks are visible coming.
- **Marsh Road (bot).** Short, cuts the corner, missing tiles, willows and
  standing water, six thickets per team. The ambush lane. Waves meet sooner.

Because the lanes differ in length, the two lanes have different wave
timings and gank windows, which is the point: choosing a lane is a decision.

## Centre

- **Crown Isle.** A walled plaza on mid between the two fords, with the
  sunken throne. Its ruined ring has doors along mid and toward each
  objective. Mid teamfights happen here.
- **Two streams.** Rise beside the Warden's fort, cross mid at the West and
  East fords, merge in the marsh lake. Water carries the movement current.

## Objectives (both on y = x, equidistant from the bases)

- **The Leviathan** — marsh lake, early game, respawning. Currently uses the
  turtle mechanics (buff: Tidewave).
- **The Warden** — cliff fort, late game. Currently uses the lord mechanics
  (buff: Crown's Sight; kills send the Warden's host down a lane).

## Jungle

Each side: a cliff pocket (Ridge buff + 3 camps) and a marsh pocket (Bog
buff + 3 camps), a crab at its ford and a stream patrol. Camps use the
existing blueBuff / redBuff / normal / crab / litho kinds.

## Deferred

Height (cliffs see the plateau, one-way ledge drops) was designed and set
aside; the marsh corner beyond the road is flooded scenery only.
