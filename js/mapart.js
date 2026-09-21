'use strict';
/* ============================================================
   mapart.js — painter for the Sundered Crown (the 5v5 board).

   The layout lives in map.js; this file only decides how it looks.
   The board is baked once into an offscreen canvas at boot, so
   nothing here costs anything per frame except drawWall(), which
   extrudes the collision ridges in the live world pass.

   Theme: a drowned ancient kingdom. The cliff corner holds the old
   fortifications and the Warden's fort; the plateau carries the
   causeway and the Crown Isle with its sunken throne; the marsh
   corner is flooded ruin, reeds and the Leviathan's lake. One light
   from the top-left; everything casts down-right.
   ============================================================ */

const MapArt = (() => {
  const PAL = {
    grassLit:   '#7db64a',
    grass:      '#65a03d',
    grassShade: '#4f8a33',
    jungle:     '#3d6d2c',
    jungleDark: '#2b5220',
    cliffGround:'#8f8b6f',
    cliffGrass: '#9bb25a',
    marshGround:'#3f6b4a',
    marshDark:  '#2c5238',
    marshMud:   '#5c5a3a',
    laneBase:   '#b7a577',
    laneSand:   '#d3c294',
    laneLight:  '#ebdfb8',
    laneEdge:   '#a4946b',
    laneStone:  '#cdbd90',
    dirt:       '#8b6a3e',
    dirtLight:  '#b48d57',
    riverDeep:  '#136382',
    river:      '#2694b0',
    riverShallow: '#7fd8e0',
    marshWater: '#2f7f7a',
    bank:       '#cdbd90',
    bankWet:    '#a39b72',
    rockTop:    '#8a8570',
    rockLit:    '#6e6555',
    rockShade:  '#4a4236',
    rockDark:   '#2f2a22',
    moss:       '#6f9f3c',
    plaza:      '#8f8c86',
    plazaLight: '#b8b4ab',
    plazaDark:  '#5d5a55',
    rampart:    '#7c766b',
    rampartTop: '#a49d8f',
    ruin:       '#9a948a',
  };

  const rng = seed => { let s = (seed | 0) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const lerpc = (a, b, t) => mixHex(a, b, t);
  /* Which band a point is in: cliffs toward the top-left corner, marsh toward
     the bottom-right, plateau between. The mid lane is x + y == WORLD. */
  const CLIFF_LINE = 4700, MARSH_LINE = 8100, FLOOD_LINE = 9700;
  const band = (x, y) => (x + y < CLIFF_LINE ? 'cliff' : x + y > MARSH_LINE ? 'marsh' : 'plateau');

  function softPath(g, pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], n = pts[i + 1];
      g.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
    }
    g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  function strokePath(g, pts, w, col, dash) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = col; g.lineWidth = w;
    if (dash) g.setLineDash(dash);
    softPath(g, pts); g.stroke();
    if (dash) g.setLineDash([]);
  }
  function distPoly(x, y, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const c = segClosest(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  function blob(g, x, y, rx, ry, rnd, wob = 0.22, n = 9, rot = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + rot;
      const k = 1 - wob / 2 + rnd() * wob;
      pts.push({ x: x + Math.cos(a) * rx * k, y: y + Math.sin(a) * ry * k });
    }
    g.beginPath();
    g.moveTo((pts[0].x + pts[n - 1].x) / 2, (pts[0].y + pts[n - 1].y) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      g.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    g.closePath();
  }
  /* Half-plane x + y < c (or > c) clipped to the board, as a path. */
  function bandPath(g, c, lessThan) {
    g.beginPath();
    if (lessThan) { g.moveTo(0, 0); g.lineTo(c, 0); g.lineTo(0, c); }
    else { g.moveTo(WORLD, WORLD); g.lineTo(c - WORLD, WORLD); g.lineTo(WORLD, c - WORLD); }
    g.closePath();
  }

  const STREAM_W = 150 * MAP_SCALE;

  /* ---------------------------------------------------------------- ground */
  function paintGround(g) {
    const base = g.createLinearGradient(0, 0, WORLD, WORLD);
    base.addColorStop(0, PAL.grassLit);
    base.addColorStop(0.5, PAL.grass);
    base.addColorStop(1, PAL.grassShade);
    g.fillStyle = base;
    g.fillRect(0, 0, WORLD, WORLD);
    const rnd = rng(9001);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD, r = 220 + rnd() * 520;
      g.fillStyle = rnd() > 0.5 ? `rgba(190,210,90,${0.05 + rnd() * 0.07})` : `rgba(30,90,40,${0.06 + rnd() * 0.08})`;
      blob(g, x, y, r, r * (0.6 + rnd() * 0.5), rnd, 0.3, 8, rnd() * TAU); g.fill();
    }
    g.lineCap = 'round'; g.lineWidth = 3;
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD, len = 6 + rnd() * 10;
      g.strokeStyle = rnd() > 0.5 ? `rgba(150,200,80,${0.10 + rnd() * 0.12})` : `rgba(30,70,30,${0.10 + rnd() * 0.12})`;
      g.beginPath(); g.moveTo(x, y + len * 0.5); g.lineTo(x + (rnd() - 0.5) * 4, y - len * 0.5); g.stroke();
    }
  }

  /* The cliff corner: stony ground, paler dry grass, scattered boulders and
     the odd ruined wall stub. The marsh corner: dark wet ground, mud, puddles. */
  function paintBands(g) {
    const rnd = rng(4242);
    // cliffs
    g.save();
    bandPath(g, CLIFF_LINE, true); g.clip();
    g.fillStyle = rgba(PAL.cliffGround, 0.55); g.fillRect(0, 0, WORLD, WORLD);
    for (let i = 0; i < 700; i++) {
      const x = rnd() * CLIFF_LINE, y = rnd() * (CLIFF_LINE - x);
      g.fillStyle = rnd() > 0.5 ? rgba(PAL.cliffGrass, 0.25 + rnd() * 0.3) : rgba(PAL.rockTop, 0.2 + rnd() * 0.3);
      blob(g, x, y, 30 + rnd() * 90, 18 + rnd() * 50, rnd, 0.3, 7, rnd() * TAU); g.fill();
    }
    for (let i = 0; i < 160; i++) {
      const x = rnd() * CLIFF_LINE, y = rnd() * (CLIFF_LINE - x);
      rock(g, x, y, 10 + rnd() * 26, rnd, false);
    }
    g.restore();
    // marsh
    g.save();
    bandPath(g, MARSH_LINE, false); g.clip();
    g.fillStyle = rgba(PAL.marshGround, 0.62); g.fillRect(0, 0, WORLD, WORLD);
    for (let i = 0; i < 700; i++) {
      const x = WORLD - rnd() * (2 * WORLD - MARSH_LINE), y = MARSH_LINE - x + rnd() * (2 * WORLD - MARSH_LINE);
      g.fillStyle = rnd() > 0.5 ? rgba(PAL.marshMud, 0.25 + rnd() * 0.3) : rgba(PAL.marshDark, 0.25 + rnd() * 0.3);
      blob(g, x, y, 30 + rnd() * 100, 18 + rnd() * 50, rnd, 0.3, 7, rnd() * TAU); g.fill();
    }
    for (let i = 0; i < 260; i++) {                  // puddles
      const x = WORLD - rnd() * (2 * WORLD - MARSH_LINE), y = MARSH_LINE - x + rnd() * (2 * WORLD - MARSH_LINE);
      g.fillStyle = rgba(PAL.marshWater, 0.35 + rnd() * 0.35);
      blob(g, x, y, 14 + rnd() * 40, 8 + rnd() * 20, rnd, 0.3, 7, rnd() * TAU); g.fill();
      g.fillStyle = 'rgba(220,255,250,0.25)';
      blob(g, x - 6, y - 5, 5 + rnd() * 8, 2 + rnd() * 3, rnd, 0.3, 5); g.fill();
    }
    g.restore();
    // the drowned corner: beyond the marsh road the old city is under water.
    // Scenery only — no lane, camp or path goes there.
    g.save();
    bandPath(g, FLOOD_LINE, false); g.clip();
    const fl = g.createLinearGradient(FLOOD_LINE / 2, FLOOD_LINE / 2, WORLD, WORLD);
    fl.addColorStop(0, PAL.marshWater); fl.addColorStop(1, PAL.riverDeep);
    g.fillStyle = fl; g.fillRect(0, 0, WORLD, WORLD);
    for (let i = 0; i < 400; i++) {
      const x = WORLD - rnd() * (2 * WORLD - FLOOD_LINE), y = FLOOD_LINE - x + rnd() * (2 * WORLD - FLOOD_LINE);
      g.fillStyle = `rgba(220, 255, 250, ${0.08 + rnd() * 0.18})`;
      g.beginPath(); g.ellipse(x, y, 8 + rnd() * 30, 3 + rnd() * 4, -Math.PI / 4, 0, TAU); g.fill();
    }
    for (let i = 0; i < 70; i++) {                   // drowned rooftops and pillars
      const x = WORLD - rnd() * (2 * WORLD - FLOOD_LINE - 300), y = FLOOD_LINE + 150 - x + rnd() * (2 * WORLD - FLOOD_LINE - 300);
      if (x + y < FLOOD_LINE + 150) continue;
      if (rnd() > 0.5) ruin(g, x, y, 26 + rnd() * 30, rnd);
      else { g.fillStyle = rgba(PAL.ruin, 0.6); blob(g, x, y, 30 + rnd() * 50, 18 + rnd() * 26, rnd, 0.2, 7, rnd() * TAU); g.fill(); }
    }
    g.restore();
    g.save();
    g.lineWidth = 260; g.lineCap = 'butt';
    for (const c of [CLIFF_LINE, MARSH_LINE]) {
      g.strokeStyle = 'rgba(20, 30, 14, 0.14)';
      g.beginPath(); g.moveTo(0, c); g.lineTo(c, 0); g.stroke();
    }
    g.restore();
  }

  /* Everything the canopy will stand on is darker than the open ground. */
  function paintJungleFloor(g, openAt) {
    const rnd = rng(7331);
    g.save();
    g.fillStyle = 'rgba(38, 78, 34, 0.5)';
    g.fillRect(0, 0, WORLD, WORLD);
    g.globalCompositeOperation = 'destination-out';
    openAt(g);
    g.restore();
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD;
      g.fillStyle = rnd() > 0.6 ? `rgba(120,110,50,${0.08 + rnd() * 0.12})` : `rgba(20,50,20,${0.10 + rnd() * 0.12})`;
      g.beginPath(); g.ellipse(x, y, 8 + rnd() * 22, 5 + rnd() * 12, rnd() * TAU, 0, TAU); g.fill();
    }
  }

  /* ---------------------------------------------------------------- lanes */
  function laneWidth(lane) { return lane === 'mid' ? 128 * MAP_SCALE : 118 * MAP_SCALE; }

  function paintLaneAO(g, pts, w) {
    strokePath(g, pts, w + 120, 'rgba(20, 40, 14, 0.38)');
    strokePath(g, pts, w + 44, 'rgba(24, 44, 16, 0.5)');
  }

  /* A tiled road: darker grout base, staggered flagstones, worn centre,
     pebbles and grass along the verge. The marsh road is older and wetter:
     more cracked tiles and darker stone. */
  function paintLane(g, pts, w, seed, marsh) {
    const rnd = rng(seed);
    strokePath(g, pts, w + 16, marsh ? PAL.bankWet : PAL.laneEdge);
    strokePath(g, pts, w, marsh ? lerpc(PAL.laneBase, PAL.marshMud, 0.35) : PAL.laneBase);
    const tileL = 58, tileW = w / 3;
    let row = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const ang = Math.atan2(dy, dx);
      const rows = Math.max(1, Math.round(len / tileL));
      for (let k = 0; k < rows; k++, row++) {
        const t = (k + 0.5) / rows;
        const cx = a.x + dx * t, cy = a.y + dy * t;
        const stagger = row % 2 ? 0.5 : 0;
        for (let c = -2; c <= 2; c++) {
          const off = (c + stagger) * tileW;
          if (Math.abs(off) > w / 2 - tileW * 0.3) continue;
          if (marsh && rnd() < 0.12) continue;                 // missing tiles
          const x = cx + nx * off, y = cy + ny * off;
          const shade = rnd();
          g.fillStyle = marsh ? lerpc(PAL.laneStone, PAL.bankWet, shade * 0.7) : lerpc(PAL.laneSand, PAL.laneLight, shade);
          g.save(); g.translate(x, y); g.rotate(ang + (rnd() - 0.5) * (marsh ? 0.12 : 0.06));
          const tw = tileL - 7, th = tileW - 7;
          g.beginPath(); g.roundRect(-tw / 2, -th / 2, tw, th, 5); g.fill();
          if (shade > (marsh ? 0.5 : 0.7)) {
            g.strokeStyle = 'rgba(90, 70, 40, 0.35)'; g.lineWidth = 1.5;
            g.beginPath(); g.moveTo(-tw * 0.3, -th * 0.2 + (rnd() - 0.5) * 6); g.lineTo(tw * 0.2, th * 0.3); g.stroke();
          }
          g.restore();
        }
      }
    }
    strokePath(g, pts, w * 0.42, 'rgba(120, 100, 60, 0.14)');
    strokePath(g, pts, 5, 'rgba(255, 250, 230, 0.12)');
    for (let i = 1; i < pts.length; i += 2) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      for (const side of [-1, 1]) {
        if (rnd() < 0.45) continue;
        const d = w / 2 + 10 + rnd() * 12;
        const x = b.x + nx * d * side, y = b.y + ny * d * side;
        g.fillStyle = rnd() > 0.5 ? PAL.rockLit : PAL.rockTop;
        g.beginPath(); g.ellipse(x, y, 6 + rnd() * 7, 4 + rnd() * 4, rnd() * TAU, 0, TAU); g.fill();
        tuft(g, x + nx * 28 * side, y + ny * 28 * side, 12 + rnd() * 10, rnd, !marsh);
      }
    }
  }

  function tuft(g, x, y, s, rnd, lit) {
    g.lineCap = 'round'; g.lineWidth = 2.2;
    for (let i = -2; i <= 2; i++) {
      g.strokeStyle = lit ? `rgba(${120 + rnd() * 60 | 0},${180 + rnd() * 50 | 0},${60 + rnd() * 30 | 0},0.6)`
        : `rgba(${30 + rnd() * 30 | 0},${90 + rnd() * 40 | 0},${30 + rnd() * 20 | 0},0.6)`;
      g.beginPath();
      g.moveTo(x + i * s * 0.22, y + s * 0.2);
      g.quadraticCurveTo(x + i * s * 0.3, y - s * 0.4, x + i * s * 0.2 + (rnd() - 0.5) * 4, y - s);
      g.stroke();
    }
  }

  function paintTowerPads(g) {
    for (const t of TOWER_SPOTS) {
      const R = 92;
      g.fillStyle = 'rgba(20, 30, 14, 0.35)';
      g.beginPath(); g.ellipse(t.x + 10, t.y + 14, R * 1.08, R * 0.9, 0, 0, TAU); g.fill();
      g.fillStyle = PAL.plazaDark;
      g.beginPath(); g.arc(t.x, t.y, R, 0, TAU); g.fill();
      g.fillStyle = PAL.plaza;
      g.beginPath(); g.arc(t.x, t.y, R - 12, 0, TAU); g.fill();
      g.strokeStyle = rgba(PAL.plazaLight, 0.5); g.lineWidth = 3;
      for (let rr = 22; rr < R - 12; rr += 22) { g.beginPath(); g.arc(t.x, t.y, rr, 0, TAU); g.stroke(); }
      g.strokeStyle = rgba(TEAM_COLORS[t.team], 0.45); g.lineWidth = 6;
      g.beginPath(); g.arc(t.x, t.y, R - 4, 0, TAU); g.stroke();
    }
  }

  /* ---------------------------------------------------------------- water */
  function paintStream(g, course, rnd) {
    const W = STREAM_W;
    strokePath(g, course, W + 150, 'rgba(24, 48, 20, 0.45)');
    strokePath(g, course, W + 90, PAL.bank);
    strokePath(g, course, W + 40, PAL.bankWet);
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const col = t < 0.5 ? lerpc(PAL.riverShallow, PAL.river, t * 2) : lerpc(PAL.river, PAL.riverDeep, (t - 0.5) * 2);
      strokePath(g, course, W * (1 - t * 0.62), col);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 700; i++) {
      const t = rnd();
      const p = pathPoint(course, t), q = pathPoint(course, Math.min(1, t + 0.005));
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      const off = (rnd() - 0.5) * W * 0.9;
      const x = p.x + nx * off, y = p.y + ny * off, L = 12 + rnd() * 34;
      g.strokeStyle = rnd() > 0.45 ? `rgba(220, 250, 255, ${0.10 + rnd() * 0.22})` : `rgba(10, 60, 90, ${0.08 + rnd() * 0.16})`;
      g.lineWidth = 1.5 + rnd() * 2.5;
      g.beginPath(); g.moveTo(x - ux * L, y - uy * L);
      g.quadraticCurveTo(x + nx * (rnd() - 0.5) * 8, y + ny * (rnd() - 0.5) * 8, x + ux * L, y + uy * L); g.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const p = pathPoint(course, 0.08 + rnd() * 0.84);
      if (dist(p, LAKE) < LAKE.r + 100 || dist(p, ISLE) < ISLE.r + 60) continue;
      const off = (rnd() - 0.5) * W * 0.8;
      rock(g, p.x + off, p.y - off, 12 + rnd() * 20, rnd, true);
    }
    for (let i = 0; i < 90; i++) {
      const p = pathPoint(course, rnd());
      if (dist(p, LAKE) < LAKE.r + 40) continue;
      const side = rnd() > 0.5 ? 1 : -1;
      const off = (W / 2 + 34 + rnd() * 40) * side;
      tuft(g, p.x + off * 0.7, p.y - off * 0.7, 16 + rnd() * 14, rnd, false);
    }
    // the spring: a small pool where the stream rises from the cliff
    const s0 = course[0];
    g.fillStyle = PAL.rockShade; blob(g, s0.x, s0.y, W * 0.9, W * 0.7, rnd, 0.2, 10); g.fill();
    g.fillStyle = PAL.riverShallow; blob(g, s0.x, s0.y, W * 0.7, W * 0.52, rnd, 0.2, 10); g.fill();
    g.fillStyle = 'rgba(235,255,255,0.4)'; blob(g, s0.x - W * 0.2, s0.y - W * 0.15, W * 0.22, W * 0.12, rnd, 0.3, 6); g.fill();
  }

  function paintLake(g) {
    const rnd = rng(43);
    const p = LAKE, R = LAKE.r;
    g.fillStyle = 'rgba(14, 30, 24, 0.5)';
    blob(g, p.x + 16, p.y + 20, R + 90, R + 70, rnd, 0.14, 14); g.fill();
    g.fillStyle = PAL.bankWet; blob(g, p.x, p.y, R + 60, R + 50, rnd, 0.14, 14); g.fill();
    g.fillStyle = PAL.riverShallow; blob(g, p.x, p.y, R + 10, R, rnd, 0.1, 14); g.fill();
    const deep = g.createRadialGradient(p.x, p.y, R * 0.12, p.x, p.y, R);
    deep.addColorStop(0, PAL.riverDeep); deep.addColorStop(0.55, PAL.river); deep.addColorStop(1, rgba(PAL.riverShallow, 0));
    g.fillStyle = deep; g.beginPath(); g.arc(p.x, p.y, R, 0, TAU); g.fill();
    // drowned ruin: a ring of broken pillars just under the surface
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + rnd() * 0.3, d = R * (0.55 + rnd() * 0.25);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      g.fillStyle = rgba(PAL.ruin, 0.55);
      blob(g, x, y, 22 + rnd() * 14, 14 + rnd() * 8, rnd, 0.25, 7); g.fill();
    }
    for (let i = 0; i < 120; i++) {
      const a = rnd() * TAU, d = rnd() * R;
      g.fillStyle = `rgba(230, 255, 255, ${0.12 + rnd() * 0.25})`;
      g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 6 + rnd() * 16, 2 + rnd() * 3, -Math.PI / 4, 0, TAU); g.fill();
    }
    const glow = g.createRadialGradient(p.x, p.y, 10, p.x, p.y, R * 0.6);
    glow.addColorStop(0, 'rgba(94, 234, 212, 0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(p.x, p.y, R * 0.6, 0, TAU); g.fill();
    if (typeof Icons !== 'undefined') {
      g.save(); g.globalAlpha = 0.4; Icons.paint(g, 'epic:turtle', p.x, p.y, 120 * MAP_SCALE); g.restore();
    }
    for (let i = 0; i < 40; i++) {
      const a = rnd() * TAU, d = R + 20 + rnd() * 60;
      tuft(g, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.9, 16 + rnd() * 16, rnd, false);
    }
  }

  /* The Warden's fort: a paved stone yard on the cliff top inside its ring
     wall (the wall itself is live terrain), broken statues at the corners
     and the objective sigil in the middle. */
  function paintFort(g) {
    const rnd = rng(41);
    const p = LORD_PIT, R = PIT_WALL_R;
    g.fillStyle = 'rgba(14, 20, 14, 0.5)';
    g.beginPath(); g.arc(p.x + 14, p.y + 18, R + 30, 0, TAU); g.fill();
    g.fillStyle = PAL.plazaDark; g.beginPath(); g.arc(p.x, p.y, R + 16, 0, TAU); g.fill();
    g.fillStyle = PAL.plaza; g.beginPath(); g.arc(p.x, p.y, R - 20, 0, TAU); g.fill();
    for (let rr = 50; rr < R - 24; rr += 40) {
      const n = Math.round(rr / 18);
      for (let i = 0; i < n; i++) {
        const a0 = i / n * TAU, a1 = (i + 0.88) / n * TAU;
        g.fillStyle = lerpc(PAL.plazaLight, PAL.rockTop, rnd() * 0.5);
        g.globalAlpha = 0.5 + rnd() * 0.35;
        g.beginPath(); g.arc(p.x, p.y, rr + 17, a0, a1); g.arc(p.x, p.y, rr - 17, a1, a0, true); g.closePath(); g.fill();
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.5, d = R * 0.72;
      rock(g, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 26 + rnd() * 10, rnd, false);
    }
    const glow = g.createRadialGradient(p.x, p.y, 10, p.x, p.y, R * 0.55);
    glow.addColorStop(0, rgba(THEME.gold, 0.35)); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(p.x, p.y, R * 0.55, 0, TAU); g.fill();
    g.strokeStyle = rgba(THEME.gold, 0.35); g.lineWidth = 6;
    g.beginPath(); g.arc(p.x, p.y, R * 0.4, 0, TAU); g.stroke();
    if (typeof Icons !== 'undefined') {
      g.save(); g.globalAlpha = 0.42; Icons.paint(g, 'epic:lord', p.x, p.y, 120 * MAP_SCALE); g.restore();
    }
  }

  /* The Crown Isle: a paved plaza with the sunken throne, on the mid lane
     between the two fords. Its ruined ring wall is live terrain. */
  function paintIsle(g) {
    const rnd = rng(1600);
    const p = ISLE, R = ISLE.r;
    g.fillStyle = 'rgba(14, 24, 14, 0.5)';
    g.beginPath(); g.arc(p.x + 14, p.y + 18, R + 40, 0, TAU); g.fill();
    g.fillStyle = PAL.plazaDark; g.beginPath(); g.arc(p.x, p.y, R + 26, 0, TAU); g.fill();
    g.fillStyle = PAL.plaza; g.beginPath(); g.arc(p.x, p.y, R - 6, 0, TAU); g.fill();
    for (let rr = 60; rr < R - 12; rr += 44) {
      const n = Math.round(rr / 20);
      for (let i = 0; i < n; i++) {
        const a0 = i / n * TAU, a1 = (i + 0.9) / n * TAU;
        g.fillStyle = lerpc(PAL.plazaLight, THEME.gold, 0.08 + rnd() * 0.08);
        g.globalAlpha = 0.5 + rnd() * 0.35;
        g.beginPath(); g.arc(p.x, p.y, rr + 20, a0, a1); g.arc(p.x, p.y, rr - 20, a1, a0, true); g.closePath(); g.fill();
      }
    }
    g.globalAlpha = 1;
    // the throne dais: a raised octagon with the crown sigil
    g.save(); g.translate(p.x, p.y);
    g.fillStyle = PAL.plazaDark;
    g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; g.lineTo(Math.cos(a) * 92, Math.sin(a) * 92); } g.closePath(); g.fill();
    g.fillStyle = PAL.plazaLight;
    g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; g.lineTo(Math.cos(a) * 72, Math.sin(a) * 72); } g.closePath(); g.fill();
    g.strokeStyle = rgba(THEME.gold, 0.7); g.lineWidth = 5;
    g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(-26, 12); g.lineTo(-18, -14); g.lineTo(-8, 6); g.lineTo(0, -20); g.lineTo(8, 6); g.lineTo(18, -14); g.lineTo(26, 12); g.closePath(); g.stroke();
    g.restore();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.2, d = R * 0.78;
      rock(g, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 20 + rnd() * 10, rnd, false);
    }
  }

  /* Ford crossings: a short stone slab where the causeway meets each stream. */
  function paintFords(g) {
    const rnd = rng(77);
    for (const f of FORDS) {
      g.save(); g.translate(f.x, f.y); g.rotate(-Math.PI / 4);
      const L = 120 * MAP_SCALE, Wd = laneWidth('mid') / 2 + 10;
      g.fillStyle = 'rgba(10, 30, 30, 0.4)'; g.fillRect(-L, -Wd + 14, L * 2, Wd * 2 + 8);
      g.fillStyle = PAL.plazaDark; g.fillRect(-L, -Wd, L * 2, Wd * 2);
      for (let x = -L + 6; x < L - 6; x += 30) {
        g.fillStyle = lerpc(PAL.laneStone, PAL.bankWet, rnd() * 0.5);
        g.fillRect(x, -Wd + 10, 26, Wd * 2 - 20);
      }
      g.fillStyle = PAL.rampartTop;
      for (const s of [-1, 1]) for (let x = -L + 10; x < L - 8; x += 40) g.fillRect(x, s * (Wd - 4) - 10, 16, 20);
      g.restore();
    }
  }

  /* ---------------------------------------------------------------- bases */
  function paintBase(g, t) {
    const b = BASES[t], f = FOUNTAINS[t];
    const rnd = rng(500 + t);
    const R = 300 * MAP_SCALE;
    const toCentre = Math.atan2(WORLD / 2 - b.y, WORLD / 2 - b.x);
    g.fillStyle = 'rgba(16, 26, 12, 0.5)';
    g.beginPath(); g.arc(b.x + 16, b.y + 22, R + 60, 0, TAU); g.fill();
    g.fillStyle = PAL.plazaDark; g.beginPath(); g.arc(b.x, b.y, R + 30, 0, TAU); g.fill();
    g.fillStyle = PAL.plaza; g.beginPath(); g.arc(b.x, b.y, R, 0, TAU); g.fill();
    for (let rr = 70; rr < R - 10; rr += 46) {
      const n = Math.round(rr / 20);
      for (let i = 0; i < n; i++) {
        const a0 = i / n * TAU, a1 = (i + 0.9) / n * TAU;
        g.fillStyle = lerpc(PAL.plazaLight, TEAM_COLORS[t], 0.12 + rnd() * 0.1);
        g.globalAlpha = 0.55 + rnd() * 0.3;
        g.beginPath(); g.arc(b.x, b.y, rr + 20, a0, a1); g.arc(b.x, b.y, rr - 20, a1, a0, true); g.closePath(); g.fill();
      }
    }
    g.globalAlpha = 1;
    g.strokeStyle = rgba(TEAM_COLORS[t], 0.65); g.lineWidth = 12;
    g.beginPath(); g.arc(b.x, b.y, R * 0.36, 0, TAU); g.stroke();
    const tint = g.createRadialGradient(b.x, b.y, 10, b.x, b.y, R);
    tint.addColorStop(0, rgba(TEAM_COLORS[t], 0.3)); tint.addColorStop(1, rgba(TEAM_COLORS[t], 0));
    g.fillStyle = tint; g.beginPath(); g.arc(b.x, b.y, R, 0, TAU); g.fill();
    const gates = [];
    for (const lane of Object.values(LANES)) {
      const p = pathPoint(lane, t === 0 ? 0.07 : 0.93);
      gates.push(Math.atan2(p.y - b.y, p.x - b.x));
    }
    gates.push(Math.atan2(f.y - b.y, f.x - b.x));
    const isGate = a => gates.some(gA => Math.abs(Math.atan2(Math.sin(a - gA), Math.cos(a - gA))) < 0.27);
    const rr = R + 18, thick = 40;
    for (let i = 0; i < 96; i++) {
      const a0 = i / 96 * TAU, a1 = (i + 1) / 96 * TAU, am = (a0 + a1) / 2;
      if (isGate(am)) continue;
      g.strokeStyle = PAL.rockDark; g.lineWidth = thick + 12;
      g.beginPath(); g.arc(b.x + 6, b.y + 12, rr, a0, a1 + 0.02); g.stroke();
      g.strokeStyle = PAL.rampart; g.lineWidth = thick;
      g.beginPath(); g.arc(b.x, b.y, rr, a0, a1 + 0.02); g.stroke();
      g.strokeStyle = PAL.rampartTop; g.lineWidth = thick * 0.5;
      g.beginPath(); g.arc(b.x, b.y, rr - 6, a0, a1 + 0.02); g.stroke();
      if (i % 2 === 0) {
        g.fillStyle = PAL.rampartTop;
        g.beginPath(); g.arc(b.x + Math.cos(am) * (rr - 4), b.y + Math.sin(am) * (rr - 4), 11, 0, TAU); g.fill();
      }
    }
    for (const a of gates) for (const s of [-0.31, 0.31]) rock(g, b.x + Math.cos(a + s) * rr, b.y + Math.sin(a + s) * rr, 30, rnd, false);
    g.save(); g.translate(b.x, b.y); g.rotate(toCentre + Math.PI);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? PAL.plazaLight : PAL.plaza;
      g.fillRect(R * 0.55 + i * 24, -70 - i * 10, 20, 140 + i * 20);
    }
    g.restore();
    g.fillStyle = PAL.plazaDark; g.beginPath(); g.arc(f.x, f.y, 150, 0, TAU); g.fill();
    g.fillStyle = PAL.plaza; g.beginPath(); g.arc(f.x, f.y, 130, 0, TAU); g.fill();
    const fg = g.createRadialGradient(f.x, f.y, 8, f.x, f.y, 300);
    fg.addColorStop(0, rgba(TEAM_COLORS[t], 0.75)); fg.addColorStop(0.45, rgba(TEAM_COLORS[t], 0.25)); fg.addColorStop(1, rgba(TEAM_COLORS[t], 0));
    g.fillStyle = fg; g.beginPath(); g.arc(f.x, f.y, 300, 0, TAU); g.fill();
    g.strokeStyle = rgba(TEAM_COLORS[t], 0.8); g.lineWidth = 6;
    g.beginPath(); g.arc(f.x, f.y, 96, 0, TAU); g.stroke();
    g.save(); g.translate(f.x, f.y); g.scale(1, 1 / TILT);
    g.fillStyle = 'rgba(4,8,10,0.35)'; g.beginPath(); g.ellipse(0, 26, 34, 11, 0, 0, TAU); g.fill();
    g.translate(0, -18);
    g.fillStyle = TEAM_COLORS[t]; g.globalAlpha = 0.92;
    g.beginPath(); g.moveTo(0, -64); g.lineTo(26, 0); g.lineTo(0, 48); g.lineTo(-26, 0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(0, -64); g.lineTo(-26, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.globalAlpha = 1;
    g.beginPath(); g.moveTo(0, -64); g.lineTo(26, 0); g.lineTo(0, 48); g.lineTo(-26, 0); g.closePath(); g.stroke();
    g.restore();
  }

  /* ---------------------------------------------------------------- camps */
  function paintCamp(g, c, index) {
    const water = c.kind === 'crab' || c.kind === 'litho';
    const marsh = band(c.x, c.y) === 'marsh';
    const rnd = rng(9100 + index * 97);
    const R = water ? 118 : 165;
    g.save(); g.translate(c.x, c.y);
    g.fillStyle = 'rgba(20,30,14,0.45)';
    g.beginPath(); g.ellipse(10, 16, R * 1.06, R * 0.92, 0, 0, TAU); g.fill();
    g.fillStyle = water ? PAL.bankWet : marsh ? PAL.marshMud : PAL.dirt;
    blob(g, 0, 0, R, R * 0.92, rnd, 0.12, 12); g.fill();
    const inner = c.kind === 'blueBuff' ? '#2f9aa0' : c.kind === 'redBuff' ? '#c9702c'
      : c.kind === 'litho' ? '#5eead4' : c.kind === 'crab' ? '#b8c2cc' : marsh ? PAL.marshDark : PAL.dirtLight;
    const bowl = g.createRadialGradient(-R * 0.2, -R * 0.2, 10, 0, 0, R);
    bowl.addColorStop(0, inner); bowl.addColorStop(0.5, rgba(inner, 0.35)); bowl.addColorStop(1, rgba(inner, 0));
    g.fillStyle = bowl; g.beginPath(); g.arc(0, 0, R * 0.9, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60, 40, 20, 0.28)'; g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.stroke();
    for (let i = 0; i < 18; i++) {
      const a = rnd() * TAU, d = R * (0.15 + rnd() * 0.7);
      g.fillStyle = `rgba(60, 40, 20, ${0.12 + rnd() * 0.15})`;
      g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.9, 9 + rnd() * 10, 5 + rnd() * 5, rnd() * TAU, 0, TAU); g.fill();
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + rnd() * 0.5;
      rock(g, Math.cos(a) * (R - 10), Math.sin(a) * (R - 10) * 0.92, 18 + rnd() * 16, rnd, marsh);
    }
    if (!water) {
      for (let i = 0; i < 4; i++) {
        const a = rnd() * TAU, d = R * (0.3 + rnd() * 0.45);
        g.fillStyle = rnd() > 0.5 ? 'rgba(235,225,200,0.7)' : 'rgba(200,90,70,0.7)';
        g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, 6 + rnd() * 5, 3 + rnd() * 2, rnd() * TAU, 0, TAU); g.fill();
      }
    }
    const col = c.kind === 'blueBuff' ? THEME.blue : c.kind === 'redBuff' ? '#fb923c'
      : c.kind === 'litho' ? '#5eead4' : c.kind === 'crab' ? '#cbd5e1' : '#d8c8a0';
    g.strokeStyle = rgba(col, c.kind === 'normal' ? 0.3 : 0.6); g.lineWidth = 5; g.setLineDash([16, 12]);
    g.beginPath(); g.arc(0, 0, 88, 0, TAU); g.stroke(); g.setLineDash([]);
    g.restore();
  }

  /* ---------------------------------------------------------------- props */
  function rock(g, x, y, r, rnd, wet) {
    const rot = rnd() * TAU;
    g.fillStyle = 'rgba(10, 16, 10, 0.4)';
    blob(g, x + r * 0.25, y + r * 0.35, r * 1.05, r * 0.7, rnd, 0.2, 8, rot); g.fill();
    g.fillStyle = wet ? PAL.rockShade : PAL.rockLit;
    blob(g, x, y, r, r * 0.78, rnd, 0.28, 8, rot); g.fill();
    g.fillStyle = wet ? PAL.rockLit : PAL.rockTop;
    blob(g, x - r * 0.18, y - r * 0.22, r * 0.62, r * 0.42, rnd, 0.3, 7, rot); g.fill();
    g.fillStyle = 'rgba(255,250,230,0.28)';
    blob(g, x - r * 0.32, y - r * 0.36, r * 0.26, r * 0.14, rnd, 0.3, 6, rot); g.fill();
  }

  /* A broken pillar or wall stub: the drowned kingdom's leftovers. */
  function ruin(g, x, y, s, rnd) {
    g.fillStyle = 'rgba(8, 14, 8, 0.4)';
    blob(g, x + s * 0.3, y + s * 0.25, s * 0.8, s * 0.35, rnd, 0.2, 7); g.fill();
    g.fillStyle = PAL.rockShade; g.fillRect(x - s * 0.22, y - s * 0.9, s * 0.44, s * 0.98);
    g.fillStyle = PAL.ruin; g.fillRect(x - s * 0.22, y - s * 0.9, s * 0.26, s * 0.98);
    g.fillStyle = PAL.plazaLight; g.fillRect(x - s * 0.3, y - s * 1.0, s * 0.6, s * 0.14);
    g.fillStyle = rgba(PAL.moss, 0.5); g.fillRect(x - s * 0.22, y - s * 0.3, s * 0.2, s * 0.38);
  }

  function tree(g, x, y, s, rnd, species) {
    g.fillStyle = 'rgba(8, 24, 8, 0.45)';
    blob(g, x + s * 0.42, y + s * 0.2, s * 0.95, s * 0.36, rnd, 0.15, 8); g.fill();
    const lift = species === 'pine' ? -s * 0.55 : species === 'broad' ? -s * 0.5 : -s * 0.72;
    g.fillStyle = '#4a3318';
    g.beginPath(); g.moveTo(x - s * 0.1, y + s * 0.08); g.lineTo(x + s * 0.1, y + s * 0.08);
    g.lineTo(x + s * 0.05, y + lift * 0.9); g.lineTo(x - s * 0.05, y + lift * 0.9); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.moveTo(x + s * 0.02, y + s * 0.08); g.lineTo(x + s * 0.1, y + s * 0.08);
    g.lineTo(x + s * 0.05, y + lift * 0.9); g.lineTo(x + s * 0.01, y + lift * 0.9); g.closePath(); g.fill();
    const cy = y + lift;
    if (species === 'pine') {
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const w = s * (0.78 - t * 0.5), h = s * 0.42, ty = cy + s * 0.32 - i * s * 0.26;
        g.fillStyle = lerpc('#1f5a24', '#3f8a35', t * 0.6 + rnd() * 0.15);
        g.beginPath(); g.moveTo(x, ty - h); g.lineTo(x + w, ty); g.lineTo(x - w, ty); g.closePath(); g.fill();
        g.fillStyle = 'rgba(160, 220, 110, 0.28)';
        g.beginPath(); g.moveTo(x, ty - h); g.lineTo(x - w * 0.55, ty - h * 0.15); g.lineTo(x - w * 0.15, ty - h * 0.05); g.closePath(); g.fill();
      }
      return;
    }
    const wide = species === 'broad';
    const lobes = wide
      ? [[-0.42, 0.1, 0.62, 0.42], [0.4, 0.06, 0.6, 0.4], [0, -0.16, 0.66, 0.44], [-0.18, 0.18, 0.5, 0.34], [0.2, 0.2, 0.48, 0.32]]
      : [[-0.3, 0.14, 0.62, 0.54], [0.3, 0.1, 0.6, 0.52], [0.02, -0.3, 0.58, 0.52], [-0.16, -0.06, 0.48, 0.42], [0.18, 0.24, 0.44, 0.36]];
    const dark = species === 'willow' ? '#1f4a2c' : PAL.jungleDark;
    const mid = species === 'willow' ? ['#2f6f45', '#4a8a5a'] : ['#3f8a35', '#5aa845'];
    const lit = species === 'willow' ? ['#6fa870', '#9cc48a'] : ['#7cc352', '#a8dc6a'];
    for (const [ox, oy, rx, ry] of lobes) {
      g.fillStyle = lerpc(dark, '#1e4a1e', rnd() * 0.5);
      blob(g, x + ox * s + s * 0.08, cy + oy * s + s * 0.1, rx * s, ry * s, rnd, 0.25, 8); g.fill();
    }
    for (const [ox, oy, rx, ry] of lobes) {
      g.fillStyle = lerpc(mid[0], mid[1], rnd());
      blob(g, x + ox * s, cy + oy * s, rx * s * 0.92, ry * s * 0.92, rnd, 0.25, 8); g.fill();
    }
    for (const [ox, oy, rx, ry] of lobes.slice(0, 3)) {
      g.fillStyle = lerpc(lit[0], lit[1], rnd());
      blob(g, x + ox * s - s * 0.12, cy + oy * s - s * 0.14, rx * s * 0.55, ry * s * 0.5, rnd, 0.3, 7); g.fill();
    }
    g.fillStyle = 'rgba(255, 250, 200, 0.22)';
    blob(g, x - s * 0.28, cy - s * 0.36, s * 0.22, s * 0.13, rnd, 0.3, 6); g.fill();
    if (species === 'willow') {                 // hanging fronds
      g.strokeStyle = 'rgba(60, 120, 70, 0.6)'; g.lineWidth = 2; g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const fx = x + (rnd() - 0.5) * s * 1.1, fy = cy + s * 0.2;
        g.beginPath(); g.moveTo(fx, fy); g.quadraticCurveTo(fx + 4, fy + s * 0.3, fx - 3, fy + s * 0.55); g.stroke();
      }
    }
  }

  function bush(g, b) {
    const rnd = rng((b.x * 31 + b.y * 17) | 0);
    const marsh = band(b.x, b.y) === 'marsh';
    g.fillStyle = 'rgba(6, 22, 8, 0.55)';
    blob(g, b.x + 10, b.y + 12, b.r * 1.25, b.r * 0.82, rnd, 0.2, 9); g.fill();
    g.fillStyle = marsh ? '#1f4d32' : '#245a2c';
    blob(g, b.x, b.y, b.r * 1.15, b.r * 0.78, rnd, 0.22, 9); g.fill();
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const a = rnd() * TAU, d = rnd() * b.r * 0.95;
      const px = b.x + Math.cos(a) * d, py = b.y + Math.sin(a) * d * 0.7;
      const h = b.r * (marsh ? 0.5 + rnd() * 0.6 : 0.35 + rnd() * 0.5);
      const lit = px < b.x && py < b.y;
      g.strokeStyle = lit ? `rgba(${110 + rnd() * 60 | 0},${190 + rnd() * 40 | 0},${70 + rnd() * 30 | 0},0.85)`
        : `rgba(${30 + rnd() * 30 | 0},${100 + rnd() * 50 | 0},${34 + rnd() * 20 | 0},0.85)`;
      g.lineWidth = marsh ? 1.8 + rnd() * 1.2 : 2.4 + rnd() * 1.6;
      g.beginPath(); g.moveTo(px, py + 4);
      g.quadraticCurveTo(px + (rnd() - 0.5) * 10, py - h * 0.5, px + (rnd() - 0.5) * 16, py - h);
      g.stroke();
    }
  }

  function paintWallFootprints(g) {
    const rnd = rng(78123);
    for (const w of MAP_WALLS) {
      g.strokeStyle = 'rgba(10, 18, 10, 0.5)'; g.lineWidth = w.r * 2 + 40; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(w.pts[0].x + 14, w.pts[0].y + 22);
      for (const p of w.pts) g.lineTo(p.x + 14, p.y + 22);
      g.stroke();
      g.strokeStyle = PAL.rockDark; g.lineWidth = w.r * 2 + 8;
      g.beginPath(); g.moveTo(w.pts[0].x, w.pts[0].y);
      for (const p of w.pts) g.lineTo(p.x, p.y);
      g.stroke();
      const step = Math.max(1, Math.floor(w.pts.length / 6));
      for (let i = 0; i < w.pts.length; i += step) {
        const p = w.pts[i];
        rock(g, p.x + (rnd() - 0.5) * w.r, p.y + w.r * 0.6 + rnd() * 10, w.r * (0.35 + rnd() * 0.3), rnd, false);
      }
    }
  }

  /* ---------------------------------------------------------------- trees */
  function paintForest(g, dirtSegs) {
    const open = (x, y) => {
      if (x + y > FLOOD_LINE - 140) return false;          // under water
      for (const [name, lane] of Object.entries(LANES)) if (distPoly(x, y, lane) < laneWidth(name) / 2 + 76) return false;
      for (const s of STREAMS) if (distPoly(x, y, s) < STREAM_W / 2 + 110) return false;
      if (dist({ x, y }, LAKE) < LAKE.r + 120) return false;
      if (dist({ x, y }, ISLE) < ISLE.r + 90) return false;
      if (dist({ x, y }, LORD_PIT) < PIT_WALL_R + 50) return false;
      for (const c of CAMPS) if (dist({ x, y }, c) < 210) return false;
      for (const b of BASES) if (dist({ x, y }, b) < 300 * MAP_SCALE + 110) return false;
      for (const f of FOUNTAINS) if (dist({ x, y }, f) < 260) return false;
      for (const t of TOWER_SPOTS) if (dist({ x, y }, t) < 150) return false;
      for (const b of BUSHES) if (dist({ x, y }, b) < b.r + 40) return false;
      for (const w of MAP_WALLS) if (wallBlocks(w, x, y, 34)) return false;
      for (const [ax, ay, bx, by] of dirtSegs) {
        const c = segClosest(x, y, ax, ay, bx, by);
        if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) < 60 * 60) return false;
      }
      return true;
    };
    const rnd = rng(20260921);
    const trees = [], ruins = [];
    const spacing = 74;
    for (let gy = 40; gy < WORLD - 40; gy += spacing) {
      for (let gx = 40; gx < WORLD - 40; gx += spacing) {
        if (gy < gx) continue;                            // author Blue's half, swap for Red
        const x = gx + (rnd() - 0.5) * 54, y = gy + (rnd() - 0.5) * 54;
        if (y < x || !open(x, y)) continue;
        const zone = band(x, y);
        // the cliffs are sparse and stony, the marsh is thick with willows
        if (rnd() < (zone === 'cliff' ? 0.4 : zone === 'marsh' ? 0.06 : 0.12)) {
          if (zone === 'cliff' && rnd() < 0.18) ruins.push({ x, y, s: 30 + rnd() * 26, seed: (rnd() * 1e6) | 0 });
          continue;
        }
        const roll = rnd();
        const species = zone === 'cliff' ? (roll < 0.7 ? 'pine' : 'round')
          : zone === 'marsh' ? (roll < 0.55 ? 'willow' : roll < 0.8 ? 'broad' : 'round')
          : (roll < 0.14 ? 'pine' : roll < 0.34 ? 'broad' : 'round');
        const s = (species === 'pine' ? 46 : 52) + rnd() * 50;
        const seed = (rnd() * 1e6) | 0;
        trees.push({ x, y, s, seed, species });
        const tw = swapPt({ x, y });
        if (dist(tw, { x, y }) > 8) trees.push({ x: tw.x, y: tw.y, s, seed, species });
      }
    }
    for (const r of ruins) { ruin(g, r.x, r.y, r.s, rng(r.seed)); const q = swapPt(r); ruin(g, q.x, q.y, r.s, rng(r.seed)); }
    trees.sort((a, b) => a.y - b.y);
    for (const t of trees) tree(g, t.x, t.y, t.s, rng(t.seed), t.species);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD;
      if (!open(x, y)) continue;
      const zone = band(x, y);
      g.fillStyle = zone === 'marsh' ? lerpc('#2f6f45', '#6fa870', rnd())
        : rnd() > 0.85 ? `rgba(${220 + rnd() * 30 | 0},${170 + rnd() * 60 | 0},90,0.8)` : lerpc('#3f8a35', '#7cc352', rnd());
      blob(g, x, y, 10 + rnd() * 18, 7 + rnd() * 10, rnd, 0.3, 7); g.fill();
    }
  }

  /* ---------------------------------------------------------------- light */
  function paintLight(g) {
    g.strokeStyle = 'rgba(16, 28, 14, 0.9)'; g.lineWidth = 90; g.strokeRect(0, 0, WORLD, WORLD);
    g.strokeStyle = rgba(PAL.rockTop, 0.45); g.lineWidth = 10; g.strokeRect(48, 48, WORLD - 96, WORLD - 96);
    const edge = g.createRadialGradient(WORLD / 2, WORLD / 2, WORLD * 0.3, WORLD / 2, WORLD / 2, WORLD * 0.76);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(4, 14, 8, 0.28)');
    g.fillStyle = edge; g.fillRect(0, 0, WORLD, WORLD);
    const sun = g.createLinearGradient(0, 0, WORLD, WORLD);
    sun.addColorStop(0, 'rgba(255, 240, 190, 0.18)'); sun.addColorStop(0.5, 'rgba(0,0,0,0)'); sun.addColorStop(1, 'rgba(8, 18, 40, 0.22)');
    g.fillStyle = sun; g.fillRect(0, 0, WORLD, WORLD);
  }

  /* ---------------------------------------------------------------- board */
  function paintCrown(g) {
    paintGround(g);
    paintBands(g);

    const dirtSegs = [];
    const jungleCamps = CAMPS.filter(c => c.kind !== 'crab' && c.kind !== 'litho');
    const nearestLane = (x, y) => {
      let best = null, bd = Infinity;
      for (const lane of Object.values(LANES)) {
        for (let i = 1; i < lane.length; i++) {
          const c = segClosest(x, y, lane[i - 1].x, lane[i - 1].y, lane[i].x, lane[i].y);
          const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
          if (d < bd) { bd = d; best = c; }
        }
      }
      return { p: best, d: Math.sqrt(bd) };
    };
    for (const c of jungleCamps) {
      const { p, d } = nearestLane(c.x, c.y);
      if (d < 40) continue;
      const t = Math.max(0.15, (d - 140) / d);
      dirtSegs.push([c.x, c.y, c.x + (p.x - c.x) * t, c.y + (p.y - c.y) * t]);
    }
    for (let i = 0; i < jungleCamps.length; i++) {
      for (let j = i + 1; j < jungleCamps.length; j++) {
        const a = jungleCamps[i], b = jungleCamps[j], d = dist(a, b);
        if (d < 620 && d > 120) dirtSegs.push([a.x, a.y, b.x, b.y]);
      }
    }

    paintJungleFloor(g, gg => {
      gg.lineCap = 'round'; gg.lineJoin = 'round'; gg.fillStyle = 'rgba(0,0,0,1)'; gg.strokeStyle = 'rgba(0,0,0,1)';
      for (const [name, lane] of Object.entries(LANES)) { gg.lineWidth = laneWidth(name) + 210; softPath(gg, lane); gg.stroke(); }
      for (const s of STREAMS) { gg.lineWidth = STREAM_W + 240; softPath(gg, s); gg.stroke(); }
      gg.beginPath(); gg.arc(LAKE.x, LAKE.y, LAKE.r + 200, 0, TAU); gg.fill();
      gg.beginPath(); gg.arc(ISLE.x, ISLE.y, ISLE.r + 160, 0, TAU); gg.fill();
      gg.beginPath(); gg.arc(LORD_PIT.x, LORD_PIT.y, PIT_WALL_R + 140, 0, TAU); gg.fill();
      for (const b of BASES) { gg.beginPath(); gg.arc(b.x, b.y, 300 * MAP_SCALE + 160, 0, TAU); gg.fill(); }
      for (const [ax, ay, bx, by] of dirtSegs) { gg.lineWidth = 150; gg.beginPath(); gg.moveTo(ax, ay); gg.lineTo(bx, by); gg.stroke(); }
      for (const c of CAMPS) { gg.beginPath(); gg.arc(c.x, c.y, 230, 0, TAU); gg.fill(); }
    });

    g.lineCap = 'round';
    for (const [ax, ay, bx, by] of dirtSegs) {
      const marsh = band((ax + bx) / 2, (ay + by) / 2) === 'marsh';
      g.strokeStyle = 'rgba(30, 22, 10, 0.45)'; g.lineWidth = 84; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = marsh ? PAL.marshMud : PAL.dirt; g.lineWidth = 62; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = rgba(marsh ? PAL.bankWet : PAL.dirtLight, 0.5); g.lineWidth = 24; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }

    const rndW = rng(6110);
    for (const s of STREAMS) paintStream(g, s, rndW);
    paintLake(g);
    for (const [name, lane] of Object.entries(LANES)) paintLaneAO(g, lane, laneWidth(name));
    let seed = 44001;
    for (const [name, lane] of Object.entries(LANES)) paintLane(g, lane, laneWidth(name), seed++, name === 'bot');
    paintFords(g);
    paintIsle(g);
    paintFort(g);
    paintTowerPads(g);
    CAMPS.forEach((c, i) => paintCamp(g, c, i));
    for (const t of [0, 1]) paintBase(g, t);
    paintWallFootprints(g);
    paintForest(g, dirtSegs);
    for (const b of BUSHES) bush(g, b);
    paintLight(g);
  }

  /* ---------------------------------------------------------------- walls
     Live extrusion of one wall segment inside the tilted world pass. The
     top outline wobbles per segment so ridges read as rock, not pipe. */
  function drawWall(ctx, a, b, r) {
    const h = r * 1.15 + 30;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = Math.max(2, Math.min(9, Math.round(len / 40)));
    const seed = ((a.x * 73 + a.y * 151 + b.x * 31) | 0) & 0x7fffffff;
    const rnd = rng(seed);
    const wob = Array.from({ length: n + 1 }, () => (rnd() - 0.5) * r * 0.32);
    const marsh = band(a.x, a.y) === 'marsh';
    const top = marsh ? lerpc(PAL.rockTop, PAL.moss, 0.35) : PAL.rockTop;
    const ridge = (dy, w, col, wobble) => {
      ctx.strokeStyle = col; ctx.lineWidth = w * 2;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t + dy + (wobble ? wob[i] : 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ridge(r * 0.35 + 12, r + 14, 'rgba(6, 12, 8, 0.4)', false);
    ridge(0, r + 4, PAL.rockDark, false);
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      ridge(-h * t, r * (1 - t * 0.16), mixHex(PAL.rockShade, PAL.rockLit, t), t > 0.5);
    }
    ridge(-h, r * 0.84, top, true);
    ridge(-h - 3, r * 0.5, mixHex(top, '#fff2d8', 0.22), true);
    ctx.strokeStyle = rgba(PAL.moss, marsh ? 0.75 : 0.55); ctx.lineWidth = Math.max(3, r * 0.26);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t - r * 0.3, y = a.y + (b.y - a.y) * t - h - r * 0.5 + wob[i] * 0.8;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30, 24, 16, 0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x + r * 0.2, a.y - h + r * 0.15); ctx.lineTo(b.x - r * 0.2, b.y - h - r * 0.02); ctx.stroke();
  }

  return { paintCrown, drawWall, PAL, band };
})();
