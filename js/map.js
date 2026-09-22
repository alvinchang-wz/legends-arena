'use strict';
/* ============================================================
   map.js — lanes, towers, bases, bushes, jungle camps, walls
   Blue base: bottom-left. Red base: top-right.
   Lane paths are ordered blue-base -> red-base.
   ============================================================ */

/* ---- walls ----
   A wall is a thick polyline: a list of points plus a radius. One shape covers
   both a straight ridge and an arc, and "am I in a wall?" is a single
   point-to-polyline distance, so terrain costs one cheap test per unit.

   Walls block walking and nothing else. Projectiles, skill shots and dashes
   all cross them — that is the MOBA idiom (a wall you can flicker over is an
   escape tool, a wall that eats skill shots is a different game), and it keeps
   terrain out of the combat and vision pipelines entirely. */
function segClosest(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 < 1e-6 ? 0 : clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1);
  return { x: ax + vx * t, y: ay + vy * t, t };
}

/* Closest point on a wall's spine, with the wall's radius there. Fat rock
   tapers, so a wall's points may each carry a radius; otherwise w.r. */
function wallClosest(w, x, y) {
  let best = null, bestD = Infinity, bi = 1;
  for (let i = 1; i < w.pts.length; i++) {
    const c = segClosest(x, y, w.pts[i - 1].x, w.pts[i - 1].y, w.pts[i].x, w.pts[i].y);
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    if (d < bestD) { bestD = d; best = c; bi = i; }
  }
  if (!best) return null;
  const a = w.pts[bi - 1], b = w.pts[bi];
  const ra = a.r !== undefined ? a.r : w.r, rb = b.r !== undefined ? b.r : w.r;
  best.r = ra + (rb - ra) * best.t;
  return best;
}

/* Would a body of radius `pad` centred at (x, y) overlap this wall? */
function wallBlocks(w, x, y, pad) {
  if (w.minX !== undefined && (x < w.minX - pad || x > w.maxX + pad || y < w.minY - pad || y > w.maxY + pad)) return false;
  const c = wallClosest(w, x, y);
  const r = c.r + pad;
  return (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y) < r * r;
}

/* Shared empty list for maps with no terrain, so the open-ground case never
   allocates on the movement hot path. */
const NO_WALLS = [];

/* A wall bent into an arc. Used for the duel shrine's pit, where the gaps
   between arcs are the entrances. */
function wallArc(cx, cy, radius, a0, a1, r, steps = 16) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * i / steps;
    pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return { pts, r };
}

function resamplePath(pts, step = 120) {
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push({ x: prev.x + (p.x - prev.x) * k / n, y: prev.y + (p.y - prev.y) * k / n });
    prev = p;
  }
  return out;
}

function pathPoint(pts, t) { // t in [0,1] by arc length
  const segs = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(total); }
  const target = clamp(t, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] >= target) {
      const segStart = i === 0 ? 0 : segs[i - 1];
      const f = (target - segStart) / (segs[i] - segStart || 1);
      return { x: lerp(pts[i].x, pts[i + 1].x, f), y: lerp(pts[i].y, pts[i + 1].y, f) };
    }
  }
  return { ...pts[pts.length - 1] };
}

/* The layout below is authored on a 3200-unit grid and scaled to WORLD, so the
   board can be grown or shrunk from data.js without re-tuning every coordinate.
   Absolute sizes (tower range, hero range, bush radius) deliberately do NOT
   scale — growing WORLD is exactly how you buy open ground between towers. */
const MAP_SCALE = WORLD / 3200;
const mp = (x, y) => ({ x: x * MAP_SCALE, y: y * MAP_SCALE });

/* Mirror across the anti-diagonal (x+y = WORLD) maps top lane -> bottom lane
   and keeps both bases fixed. Rotating 180° swaps the two teams' halves. */
const mirrorPt = p => ({ x: WORLD - p.y, y: WORLD - p.x });
const rotPt = p => ({ x: WORLD - p.x, y: WORLD - p.y });

/* ============================================================
   THE 5v5 BOARD — generated geometry.

   Every element comes from MAP_DATA (js/map-data.js), which
   docs/drafts/mlbb-clean.py writes from the surveyed reference map after
   cleaning: straight edge roads with rounded corners, a dead-straight mid,
   turrets snapped onto the lanes, walls as smooth thick polylines, bushes
   as circles or capsules, camps and pits at their measured spots. The data
   is authored in "map px" around its 180-degree symmetry centre; `mpx`
   scales that square onto WORLD. Blue base bottom-left, Red top-right.
   ============================================================ */
const MAP_K = WORLD / (2 * MAP_DATA.frame.half);
const mpx = (x, y) => ({ x: (x - MAP_DATA.frame.cx) * MAP_K + WORLD / 2, y: (y - MAP_DATA.frame.cy) * MAP_K + WORLD / 2 });
const mpxs = list => list.map(([x, y]) => mpx(x, y));

const LANES = {          // blue -> red
  top: resamplePath(mpxs(MAP_DATA.lanes.top)),
  mid: resamplePath(mpxs(MAP_DATA.lanes.mid)),
  bot: resamplePath(mpxs(MAP_DATA.lanes.bot)),
};
const LANES_RED = {      // red -> blue
  top: LANES.top.slice().reverse(),
  mid: LANES.mid.slice().reverse(),
  bot: LANES.bot.slice().reverse(),
};
const LANE_WIDTH = MAP_DATA.laneWidth * MAP_K;

const BASES = mpxs(MAP_DATA.bases);
/* Fountains sit behind the bases (heal allies, zap intruders, respawn point). */
const FOUNTAINS = mpxs(MAP_DATA.fountains);

/* Compact arena used by the 1v1 duel mode. It occupies the middle half of the
   normal coordinate space so the existing renderer, aiming math and neural
   normalisation keep working unchanged, and it still has no structures, camps,
   minion waves or epic monsters. What it does have is terrain: a direct lane
   between the two bases, two flank routes that bow around it and a centre
   shrine — so a duel is fought over ground instead of in an empty box.

   Everything is authored on the arena's own unit square via `du(u, v)`, with
   (0,0) at the minX/minY corner, so the layout survives a change to WORLD.
   Rotating a point through the arena centre swaps the two duellists' halves,
   and every paired feature below is rotated — neither side gets a shorter
   walk to a flank or the shrine. */
const DUEL_MAP = (() => {
  const side = WORLD / 2;                       // the middle half of the board
  const minX = (WORLD - side) / 2, minY = minX;
  const bounds = { minX, minY, maxX: minX + side, maxY: minY + side };
  const du = (u, v) => ({ x: minX + u * side, y: minY + v * side });
  const rot = p => ({ x: bounds.minX + bounds.maxX - p.x, y: bounds.minY + bounds.maxY - p.y });
  /* 0.13 keeps each base's 300-unit recovery circle inside the arena walls,
     so backing off to heal never pushes you against an invisible edge. */
  const fountains = [du(0.13, 0.87), du(0.87, 0.13)];

  /* The direct lane is the short diagonal (2344 units). Each flank is the long
     way round, through a corner the diagonal ignores: 2824 units, 20% further,
     but it never crosses the shrine. That gap is the whole point — rotating is
     a real choice, not a detour. `flankBot` is `flankTop`
     rotated, then re-ordered so both flanks read blue-base -> red-base like
     every other lane in the game. */
  const laneMid   = resamplePath([fountains[0], du(0.5, 0.5), fountains[1]], 100);
  const flankTop  = resamplePath([fountains[0], du(0.16, 0.58), du(0.24, 0.28),
                                  du(0.28, 0.24), du(0.58, 0.16), fountains[1]], 100);
  const flankBot  = resamplePath(flankTop.map(rot).reverse(), 100);

  /* Bushes are intentionally disabled until their authored layout is rebuilt. */
  const bushes = [];

  /* The shrine: the one thing worth leaving your half for. It sits dead centre
     on the direct lane, so taking it means standing in the open. */
  const shrine = Object.assign(du(0.5, 0.5), { r: 110 });

  /* ---- walls ----
     Two groups, each a rotated pair, and both placed so that the lane and the
     two flanks stay walkable — the terrain shapes the routes without narrowing
     them.

     The pit: two arcs around the shrine leaving a mouth at each end of the
     direct lane. Contesting the rune now means committing through a doorway
     that the other duellist can hold — or dashing the wall, which is the whole
     reason dashes ignore terrain. */
  const LANE_ANG = Math.atan2(-1, 1);           // blue base -> red base
  /* 0.5 rad of half-mouth leaves a ~195-unit doorway between the arcs' rounded
     ends. Narrower reads better but starts catching units on the end caps as
     they round them; this is the value the arena plays cleanly at. */
  const MOUTH = 0.5;
  const pitArcs = [
    wallArc(shrine.x, shrine.y, 300, LANE_ANG + MOUTH, LANE_ANG + Math.PI - MOUTH, 46),
    wallArc(shrine.x, shrine.y, 300, LANE_ANG + Math.PI + MOUTH, LANE_ANG + TAU - MOUTH, 46),
  ];

  /* The outer shoulders: one ridge per side, in the dead pocket between a
     flank route and the arena's corner. They give the flank an outer edge so
     it reads as a corridor rather than as paint on open ground, and they turn
     each corner into a cul-de-sac — chase someone in there and you have to
     come back out the way you went in.

     Note what is deliberately *not* here: a ridge between the lane and the
     flank. The pit is 346 units of no-go from the centre and the island is
     only about 700 wide, so any such ridge either buries a bush or pinches the
     flank. The pit is the better feature; the island stays open ground. */
  const shoulder = [
    { pts: [du(0.10, 0.26), du(0.26, 0.10)], r: 40 },
  ];
  const walls = [
    ...pitArcs,
    ...shoulder.flatMap(w => [w, { pts: w.pts.map(rot), r: w.r }]),
  ];

  return {
    bounds, side, fountains, shrine, bushes, walls,
    bases: fountains.map(p => ({ ...p })),
    lanes:    { duel: laneMid, flankTop, flankBot },
    lanesRed: { duel: laneMid.slice().reverse(),
                flankTop: flankTop.slice().reverse(),
                flankBot: flankBot.slice().reverse() },
  };
})();

/* Turrets: measured positions snapped onto the lanes. `frac` is the
   canonical tier value the HP and plating rules key on. */
const TOWER_TIERS = [
  { frac: 0.13, sidePos: 0.13, midPos: 0.11 },
  { frac: 0.27, sidePos: 0.23, midPos: 0.195 },
  { frac: 0.40, sidePos: 0.33, midPos: 0.28 },
];
const TOWER_SPOTS = MAP_DATA.towers.map(t => ({ ...mpx(t.x, t.y), team: t.team, lane: t.lane, frac: t.frac, posFrac: t.posFrac }));

/* ---- river and pits ----
   One river on the other diagonal, Lord's pit toward the top-left, Turtle's
   toward the bottom-right, both the same walk from either base. The current
   applies along the channel and inside both pools. */
const LORD_PIT   = mpx(...MAP_DATA.pits.lord);
const TURTLE_PIT = mpx(...MAP_DATA.pits.turtle);
const PIT_WALL_R = MAP_DATA.pits.r * MAP_K;
const STREAMS = [mpxs(MAP_DATA.river)];
const RIVER_HALF_W = MAP_DATA.riverHalf * MAP_K;
const POOLS = MAP_DATA.pools
  ? MAP_DATA.pools.map(p => ({ ...mpx(p.x, p.y), r: p.r * MAP_K }))   // lord, turtle, then any extra ponds
  : [{ ...LORD_PIT, r: PIT_WALL_R }, { ...TURTLE_PIT, r: PIT_WALL_R }];
const LAKE = POOLS[1];                           // older callers
const RIVER = { a: LORD_PIT, b: TURTLE_PIT };    // older callers

/* ---- jungle ---- */
const CAMPS = MAP_DATA.camps.map(c => ({ ...mpx(c.x, c.y), kind: c.kind }));

/* ---- walls ----
   Thick polylines (points + radius). Each carries its bounding box so the
   per-unit collision tests can skip the terrain that is nowhere near. */
const MAP_WALLS = MAP_DATA.walls.map(w => {
  const pts = mpxs(w.pts);
  if (w.rs) pts.forEach((p, i) => { p.r = w.rs[i] * MAP_K; });   // radius per point
  const r = (w.rs ? Math.max(...w.rs) : w.r) * MAP_K;             // the fattest point
  const wall = { pts, r, hidden: !!w.hidden, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    const pr = p.r !== undefined ? p.r : r;
    wall.minX = Math.min(wall.minX, p.x - pr); wall.maxX = Math.max(wall.maxX, p.x + pr);
    wall.minY = Math.min(wall.minY, p.y - pr); wall.maxY = Math.max(wall.maxY, p.y + pr);
  }
  return wall;
});

/* ---- bushes ----
   A bush is a circle {x, y, r} or a capsule {x, y, r, ax, ay, bx, by}: the
   concealing area is every point within r of the segment a-b. */
/* The cut-off corners beyond the lane chamfers: solid plateau, painted flat
   by the board painter; hidden walls inside them do the blocking. */
const MAP_CORNERS = (MAP_DATA.corners || []).map(poly => mpxs(poly));

const BUSHES = MAP_DATA.bushes.map(b => {
  const c = mpx(b.x, b.y), out = { x: c.x, y: c.y, r: b.r * MAP_K };
  if (b.ax !== undefined) {
    const a = mpx(b.ax, b.ay), q = mpx(b.bx, b.by);
    out.ax = a.x; out.ay = a.y; out.bx = q.x; out.by = q.y;
  }
  return out;
});
function inBush(b, x, y) {
  if (b.ax === undefined) return (x - b.x) * (x - b.x) + (y - b.y) * (y - b.y) <= b.r * b.r;
  const c = segClosest(x, y, b.ax, b.ay, b.bx, b.by);
  return (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= b.r * b.r;
}

/* Inhibitors: one per lane per team, in front of the base ring. Losing one
   opens that lane to super minions. 0.085 puts them inside the base's own
   defensive perimeter but still individually siegeable. */
const INHIBITOR_FRAC = 0.085;
const INHIBITOR_SPOTS = [];
for (const lane of ['top', 'mid', 'bot']) {
  INHIBITOR_SPOTS.push({ ...pathPoint(LANES[lane], INHIBITOR_FRAC), team: TEAM_BLUE, lane });
  INHIBITOR_SPOTS.push({ ...pathPoint(LANES[lane], 1 - INHIBITOR_FRAC), team: TEAM_RED, lane });
}

/* ============================================================
   TEN_MAP — The Auric Caldera, a 10v10 board designed from scratch.

   Nothing here is the 5v5 layout. Bases sit north and south, not on the
   diagonal. There is no three-lane river. Four outer roads wrap a molten
   crater that minions never walk — the crater is a fight, not a highway.

     dusk  west   [CRATER]   east  dawn
                   Colossus
     (south citadel / blue)          (north citadel / red)

   180° rotation through the centre swaps the two teams. Mirroring across
   the vertical midline swaps dusk↔dawn and west↔east, so both wings of a
   given side are the same walk.
   ============================================================ */
const TEN_MAP = (() => {
  const world = 7200;
  const G = 4000;
  const sc = world / G;
  const p = (x, y) => ({ x: x * sc, y: y * sc });
  const rot = q => ({ x: world - q.x, y: world - q.y });
  const flipX = q => ({ x: world - q.x, y: q.y });

  const fountains = [p(2000, 3880), p(2000, 120)];
  const bases = [p(2000, 3610), p(2000, 390)];

  /* Four roads leave the southern citadel and meet again at the northern
     one. Dusk/dawn are the long cliff roads; west/east hug the crater. */
  const duskCtrl = [
    p(2000, 3610), p(780, 3240), p(500, 2680), p(430, 2000),
    p(500, 1320), p(780, 760), p(2000, 390),
  ];
  const westCtrl = [
    p(2000, 3610), p(1480, 3240), p(1220, 2620), p(1160, 2000),
    p(1220, 1380), p(1480, 760), p(2000, 390),
  ];
  const dusk = resamplePath(duskCtrl);
  const west = resamplePath(westCtrl);
  const east = resamplePath(westCtrl.map(flipX));
  const dawn = resamplePath(duskCtrl.map(flipX));
  const lanes = { dusk, west, east, dawn };
  const lanesRed = {
    dusk: dusk.slice().reverse(),
    west: west.slice().reverse(),
    east: east.slice().reverse(),
    dawn: dawn.slice().reverse(),
  };
  const pushLanes = ['dusk', 'west', 'east', 'dawn'];

  const tiers = [
    { frac: 0.12, pos: 0.10 },
    { frac: 0.26, pos: 0.21 },
    { frac: 0.40, pos: 0.33 },
  ];
  const towers = [];
  for (const lane of pushLanes) {
    for (const tier of tiers) {
      towers.push({ ...pathPoint(lanes[lane], tier.pos), team: TEAM_BLUE, lane, frac: tier.frac, posFrac: tier.pos });
      towers.push({ ...pathPoint(lanes[lane], 1 - tier.pos), team: TEAM_RED, lane, frac: tier.frac, posFrac: tier.pos });
    }
  }
  const inhibFrac = 0.07;
  const inhibitors = [];
  for (const lane of pushLanes) {
    inhibitors.push({ ...pathPoint(lanes[lane], inhibFrac), team: TEAM_BLUE, lane });
    inhibitors.push({ ...pathPoint(lanes[lane], 1 - inhibFrac), team: TEAM_RED, lane });
  }

  const crater = p(2000, 2000);
  const beaconWest = p(980, 2000);
  const beaconEast = rot(beaconWest);

  /* South-west pocket, then flip across the spine, then rotate to the north. */
  const swCamps = [
    { ...p(680, 2720), kind: 'blueBuff' },
    { ...p(1360, 2580), kind: 'redBuff' },
    { ...p(540, 3080), kind: 'normal' },
    { ...p(1080, 2940), kind: 'normal' },
    { ...p(820, 2320), kind: 'normal' },
    { ...p(1500, 3040), kind: 'normal' },
  ];
  const southCamps = swCamps.flatMap(c => [c, { ...flipX(c), kind: c.kind }]);
  const camps = southCamps.flatMap(c => [c, { ...rot(c), kind: c.kind }]);

  const swBushes = [
    { ...p(560, 2480), r: 88 },
    { ...p(1180, 2360), r: 78 },
    { ...p(900, 3180), r: 74 },
    { ...p(1540, 2280), r: 70 },
    { ...p(430, 1840), r: 82 },
    { ...p(1280, 1760), r: 76 },
  ];
  const bushes = [];
  const addBush = b => {
    if (bushes.some(q => dist(q, b) < 16)) return;
    bushes.push(b);
  };
  for (const b of swBushes) {
    addBush(b);
    addBush({ ...flipX(b), r: b.r });
    addBush({ ...rot(b), r: b.r });
    addBush({ ...rot(flipX(b)), r: b.r });
  }

  const craterR = 540;
  const craterGaps = [
    { a: Math.PI / 2, half: 0.42 },
    { a: -Math.PI / 2, half: 0.42 },
    { a: 0, half: 0.34 },
    { a: Math.PI, half: 0.34 },
  ];
  const ringGaps = (pit, radius, gaps, thick) => {
    const sorted = gaps.map(g => ({ a: (g.a % TAU + TAU) % TAU, half: g.half }))
      .sort((a, b) => a.a - b.a);
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const g = sorted[i], next = sorted[(i + 1) % sorted.length];
      const start = g.a + g.half;
      let end = next.a - next.half;
      if (i === sorted.length - 1) end += TAU;
      if (end - start > 0.12) out.push(wallArc(pit.x, pit.y, radius, start, end, thick, 14));
    }
    return out;
  };
  const craterWalls = ringGaps(crater, craterR, craterGaps, 50);

  const swRidges = [
    { pts: [p(860, 3120), p(940, 2920), p(900, 2720)], r: 56 },
    { pts: [p(1520, 2860), p(1600, 2680), p(1540, 2480)], r: 54 },
    { pts: [p(720, 2280), p(840, 2160), p(960, 2120)], r: 50 },
  ];
  const mapW = (w, fn) => ({ pts: w.pts.map(fn), r: w.r });
  const jungleWalls = swRidges.flatMap(w => {
    const f = mapW(w, flipX);
    return [w, f, mapW(w, rot), mapW(f, rot)];
  });
  const southShoulder = { pts: [p(1680, 3750), p(1760, 3680)], r: 48 };
  const baseWalls = [
    southShoulder, mapW(southShoulder, flipX),
    mapW(southShoulder, rot), mapW(mapW(southShoulder, flipX), rot),
  ];
  const walls = [...craterWalls, ...jungleWalls, ...baseWalls];

  /* Ember vein: a ring around the crater. Standing on it is the Caldera's
     movement current — not a river, and not the 5v5 diagonal. */
  const vein = [];
  const veinR = 860 * sc;
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * TAU;
    vein.push({ x: crater.x + Math.cos(a) * veinR, y: crater.y + Math.sin(a) * veinR });
  }

  return {
    world, name: 'Auric Caldera',
    fountains, bases, lanes, lanesRed, pushLanes,
    towers, inhibitors, camps, bushes, walls,
    crater, craterR, beaconWest, beaconEast, vein,
    goldLane: 'dusk', expLane: 'dawn',
    bounds: { minX: 0, minY: 0, maxX: world, maxY: world },
  };
})();
