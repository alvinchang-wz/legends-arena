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
  return { x: ax + vx * t, y: ay + vy * t };
}

/* Closest point on a wall's centreline. */
function wallClosest(w, x, y) {
  let best = null, bestD = Infinity;
  for (let i = 1; i < w.pts.length; i++) {
    const c = segClosest(x, y, w.pts[i - 1].x, w.pts[i - 1].y, w.pts[i].x, w.pts[i].y);
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/* Would a body of radius `pad` centred at (x, y) overlap this wall? */
function wallBlocks(w, x, y, pad) {
  const c = wallClosest(w, x, y);
  const r = w.r + pad;
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

const TOP_CONTROL = [
  mp(430, 2770), mp(350, 2500), mp(305, 2140), mp(300, 1760),
  mp(315, 1370), mp(350, 1010), mp(430, 720), mp(560, 560),
  mp(720, 430), mp(1010, 350), mp(1370, 315), mp(1760, 300),
  mp(2140, 305), mp(2500, 350), mp(2770, 430),
];
const MID_CONTROL = [
  mp(470, 2730), mp(790, 2460), mp(1030, 2140), mp(1350, 1840),
  mp(1600, 1600), mp(1850, 1360), mp(2170, 1060), mp(2410, 740),
  mp(2730, 470),
];
const BOT_CONTROL = TOP_CONTROL.map(mirrorPt);

const LANES = {          // blue -> red
  top: resamplePath(TOP_CONTROL),
  mid: resamplePath(MID_CONTROL),
  bot: resamplePath(BOT_CONTROL),
};
const LANES_RED = {      // red -> blue
  top: LANES.top.slice().reverse(),
  mid: LANES.mid.slice().reverse(),
  bot: LANES.bot.slice().reverse(),
};

const BASES = [mp(330, 2870), mp(2870, 330)];
/* Fountains sit behind the bases (heal allies, zap intruders, respawn point). */
const FOUNTAINS = [mp(150, 3050), mp(3050, 150)];

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

/* Three defensive tiers per lane, matching the macro rhythm of established
   mobile MOBAs: outer towers own the lane, middle towers protect rotations,
   and inner towers create high ground. Physical positions are pulled back
   from the river so the two outer threat circles leave a genuine teamfight
   field between them. Mid is shorter, so each of its tiers uses a slightly
   tighter spacing. Canonical `frac` values stay unchanged for tier rules. */
const TOWER_TIERS = [
  { frac: 0.13, sidePos: 0.13, midPos: 0.11 },
  { frac: 0.27, sidePos: 0.23, midPos: 0.195 },
  { frac: 0.40, sidePos: 0.33, midPos: 0.28 },
];
const TOWER_SPOTS = [];
for (const lane of ['top', 'mid', 'bot']) {
  for (const tier of TOWER_TIERS) {
    const pos = lane === 'mid' ? tier.midPos : tier.sidePos;
    // `frac` is kept on the spot so health and shielding can distinguish the
    // 0.13 inner, 0.27 middle and 0.40 outer tiers without re-deriving position.
    TOWER_SPOTS.push({ ...pathPoint(LANES[lane], pos), team: TEAM_BLUE, lane, frac: tier.frac, posFrac: pos });
    TOWER_SPOTS.push({ ...pathPoint(LANES[lane], 1 - pos), team: TEAM_RED, lane, frac: tier.frac, posFrac: pos });
  }
}

/* Imperial Sanctuary jungle: each quadrant holds one major buff and four
   lizard camps. Mirroring Sage's pocket onto gold gives Fury; rotating the
   whole blue half stamps red's identical jungle. River camps sit outside that
   loop so Lithowanderers and scavenger crabs do not get duplicated onto the
   diagonal. */
const sageBuff = mp(650, 1580);
const expLizards = [
  mp(470, 1320),   // river pocket, first-clear camp
  mp(900, 1900),   // inner corridor toward mid
  mp(530, 1860),   // EXP-lane gank camp
  mp(700, 2160),   // high-ground pocket near the base exit
];
const BLUE_CAMPS = [
  { ...sageBuff, kind: 'blueBuff' },
  ...expLizards.map(p => ({ ...p, kind: 'normal' })),
  { ...mirrorPt(sageBuff), kind: 'redBuff' },
  ...expLizards.map(p => ({ ...mirrorPt(p), kind: 'normal' })),
];
const jungleCamps = BLUE_CAMPS.flatMap(c => [c, { ...rotPt(c), kind: c.kind }]);

/* Two Lithowanderers patrol the river banks between the pits (rotated pair).
   Four scavenger crabs sit at the gold/EXP river mouths — authored on gold,
   mirrored to EXP, then rotated to red. */
const litho = { ...mp(1280, 1580), kind: 'litho' };
const scavenger = { ...mp(580, 1120), kind: 'crab' };
const CAMPS = [
  ...jungleCamps,
  litho, { ...rotPt(litho), kind: 'litho' },
  scavenger,
  { ...mirrorPt(scavenger), kind: 'crab' },
  { ...rotPt(scavenger), kind: 'crab' },
  { ...rotPt(mirrorPt(scavenger)), kind: 'crab' },
];

const RIVER = { a: mp(540, 540), b: mp(2660, 2660) };

/* Epic-objective pits, at opposite ends of the river so contesting one concedes
   map position near the other. Both sit off the mid-lane diagonal by design — a
   pit sitting on the lane would be farmed by minions.

   They sit ON the river line (x == y) for a reason that is pure balance: the
   bases are reflections of each other across that line, so any point on it is
   the same walk from both. The old hand-placed pits were off it, which put Lord
   677 units nearer red's base and Turtle 580 nearer blue's — and since Lord is
   the objective that ends games, that asymmetry was worth more to red. Keeping
   them a rotated pair of each other keeps the whole board symmetric. */
/* Anywhere on x == y is equally fair, so the exact spot along the river is free
   to choose — and it was chosen for elbow room. At 1090 a walled pit clears the
   nearest jungle camp by 81 and the nearest bush by 42; slide it down toward
   880 and the ring starts swallowing a camp. */
const LORD_PIT   = mp(1100, 1100);
const TURTLE_PIT = rotPt(LORD_PIT);

/* ---- pit walls ----
   Turtle and Lord are the two fights worth losing map position over, and until
   now they happened on open ground with a dashed circle painted on it. Walling
   each pit turns "we are doing Lord" into a position rather than a place: you
   commit through one of two doorways, the team holding them decides the terms,
   and the Retribution steal is a real risk instead of a formality.

   The mouths open ALONG the river, not toward the bases. Facing them at the
   bases is the obvious choice and it is wrong: both pits sit on the river, so
   base-facing doors put a solid wall across the one route the Aether Current
   exists to make attractive, and rotating down the river would mean climbing
   out of it twice. Opening them along the river instead keeps that route whole
   and hands the walls to the jungles either side — approach from your own half
   and you have to come round to a river mouth. Both doorways still sit on the
   line that is equidistant from the two bases, so neither team is nearer one,
   and a 180° turn maps each pit's doors onto the other's.

   Everything else on the 5v5 board is deliberately still open ground: these sit
   ~580 units off the nearest lane, far enough that no wave paths near them. */
/* Three-door objective pits. Two mouths connect the river and the narrower
   rear mouth connects the adjacent jungle — a steal or collapse can now come
   from a meaningfully different angle instead of from either end of one tube. */
const PIT_WALL_R = 340;
const RIVER_ANG = Math.atan2(1, 1);
function ringWallsWithGaps(pit, gaps) {
  const sorted = gaps.map(g => ({ a: (g.a % TAU + TAU) % TAU, half: g.half }))
    .sort((a, b) => a.a - b.a);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i], next = sorted[(i + 1) % sorted.length];
    const start = g.a + g.half;
    let end = next.a - next.half;
    if (i === sorted.length - 1) end += TAU;
    if (end - start > 0.12) out.push(wallArc(pit.x, pit.y, PIT_WALL_R, start, end, 46, 12));
  }
  return out;
}
const lordGaps = [
  { a: RIVER_ANG, half: 0.40 },
  { a: RIVER_ANG + Math.PI, half: 0.40 },
  { a: RIVER_ANG + Math.PI / 2, half: 0.27 },
];
const EPIC_WALLS = [
  ...ringWallsWithGaps(LORD_PIT, lordGaps),
  ...ringWallsWithGaps(TURTLE_PIT, lordGaps.map(g => ({ a: g.a + Math.PI, half: g.half }))),
];

/* Jungle ridges turn the four forests into the dense, nested camp corridors of
   the reference board. These six live in Blue's upper jungle; reflecting them
   across the anti-diagonal supplies Blue's lower jungle, and rotating both
   through the centre supplies Red's two jungles. Every visible formation is
   therefore also real collision terrain and every side receives the same
   routes, camp pockets and invade entrances. */
const authoredJungleWalls = [
  { pts: [mp(430, 2390), mp(500, 2290), mp(525, 2140)], r: 52 },
  { pts: [mp(585, 1190), mp(700, 1230), mp(780, 1360)], r: 54 },
  { pts: [mp(485, 1690), mp(590, 1770), mp(720, 1785)], r: 56 },
  { pts: [mp(825, 1540), mp(950, 1470), mp(1080, 1480)], r: 54 },
  { pts: [mp(1040, 1920), mp(1160, 1850), mp(1230, 1730)], r: 56 },
  { pts: [mp(470, 965), mp(570, 855), mp(715, 800)], r: 52 },
  { pts: [mp(395, 1780), mp(415, 1960), mp(430, 2120)], r: 46 },
  { pts: [mp(820, 2220), mp(940, 2180), mp(1020, 2060)], r: 50 },
];
const mapWall = (w, fn) => ({ pts: w.pts.map(fn), r: w.r });
const JUNGLE_WALLS = authoredJungleWalls.flatMap(w => {
  const m = mapWall(w, mirrorPt);
  return [w, m, mapWall(w, rotPt), mapWall(m, rotPt)];
});

/* Two stone shoulders split each base entrance into the three lane funnels
   familiar from high-ground defence, without crossing any minion path. */
const blueBaseShoulder = { pts: [mp(480, 2550), mp(560, 2470)], r: 52 };
const blueBaseShoulderMirror = mapWall(blueBaseShoulder, mirrorPt);
const BASE_WALLS = [
  blueBaseShoulder, blueBaseShoulderMirror,
  mapWall(blueBaseShoulder, rotPt), mapWall(blueBaseShoulderMirror, rotPt),
];

const MAP_WALLS = [...EPIC_WALLS, ...JUNGLE_WALLS, ...BASE_WALLS];

/* Tall-grass thickets along river crossings, jungle pockets and lane
   approaches — the concealing beds of the reference board. Authored on
   Blue's gold-side, then mirrored to EXP and rotated to Red so every
   patch has a 180° twin. Occupancy only tints the hero; vision is still
   the fog grid (walls stay out of that pipeline). */
const authoredBushes = [
  { ...mp(430, 920), r: 82 },   // gold-lane river thicket
  { ...mp(700, 640), r: 74 },   // gold elbow, jungle side
  { ...mp(380, 1420), r: 68 },  // gold-lane jungle lip
  { ...mp(1240, 1510), r: 72 }, // mid-river approach
  { ...mp(980, 1280), r: 70 },  // river bank toward Lord
  { ...mp(780, 1720), r: 66 },  // jungle near Sage
  { ...mp(1080, 1860), r: 64 }, // jungle corridor
  { ...mp(540, 2280), r: 72 },  // inner gold, base exit
  { ...mp(620, 1240), r: 70 },  // scavenger-crab river mouth
  { ...mp(510, 1760), r: 66 },  // EXP gank thicket
  { ...mp(1320, 1680), r: 68 }, // lithowanderer bank
  { ...mp(860, 760), r: 72 },   // gold-river outer bank
  { ...mp(1100, 1020), r: 66 }, // river path toward Lord
  { ...mp(640, 2480), r: 70 },  // inner jungle, high ground
];
const BUSHES = (() => {
  const seeds = authoredBushes.filter(b =>
    !MAP_WALLS.some(w => wallBlocks(w, b.x, b.y, b.r * 0.4)));
  const out = [];
  const add = b => {
    if (out.some(p => dist(p, b) < 12)) return;
    out.push(b);
  };
  for (const b of seeds) {
    add(b);
    add({ ...mirrorPt(b), r: b.r });
    add({ ...rotPt(b), r: b.r });
    add({ ...rotPt(mirrorPt(b)), r: b.r });
  }
  return out;
})();

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
