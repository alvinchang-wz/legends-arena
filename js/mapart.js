'use strict';
/* ============================================================
   mapart.js — painter for the 5v5 board.

   The geometry lives in js/map-data.js (generated) and map.js; this
   file only decides how it looks. The board is baked once into an
   offscreen canvas at boot, so nothing here costs anything per frame
   except drawWall(), which extrudes the collision ridges live.

   Look: a meadow with a darker jungle floor, three tiled roads, a
   blue river on the other diagonal with a pool at each pit, paved
   fortified bases, rock ridges (the walls) and reed thickets (the
   bushes). One light from the top-left; everything casts down-right.
   ============================================================ */

const MapArt = (() => {
  const PAL = {
    grassLit:   '#7db64a',
    grass:      '#65a03d',
    grassShade: '#4f8a33',
    jungleDark: '#2b5220',
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
  };

  const rng = seed => { let s = (seed | 0) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const lerpc = (a, b, t) => mixHex(a, b, t);
  const rot = p => ({ x: WORLD - p.x, y: WORLD - p.y });
  const BASE_R = 24 * MAP_K;            // paved plaza radius
  const RIVER = STREAMS[0];

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
  function bushDist(b, x, y) {
    if (b.ax === undefined) return Math.hypot(x - b.x, y - b.y);
    const c = segClosest(x, y, b.ax, b.ay, b.bx, b.by);
    return Math.hypot(x - c.x, y - c.y);
  }
  function blob(g, x, y, rx, ry, rnd, wob = 0.22, n = 9, rotA = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + rotA;
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

  /* The jungle floor: darker than the open ground, punched out where the
     roads, river, pits, plazas and camp clearings are. */
  function paintJungleFloor(g) {
    const rnd = rng(7331);
    // build the floor on its own layer so punching the open ground out of it
    // never punches through the meadow underneath
    const layer = document.createElement('canvas');
    layer.width = g.canvas.width; layer.height = g.canvas.height;
    const f = layer.getContext('2d');
    f.setTransform(g.getTransform());
    f.fillStyle = 'rgba(30, 66, 30, 0.55)';
    f.fillRect(0, 0, WORLD, WORLD);
    f.globalCompositeOperation = 'destination-out';
    f.lineCap = 'round'; f.lineJoin = 'round'; f.fillStyle = '#000'; f.strokeStyle = '#000';
    for (const lane of Object.values(LANES)) { f.lineWidth = LANE_WIDTH + 170; softPath(f, lane); f.stroke(); }
    f.lineWidth = RIVER_HALF_W * 2 + 200; softPath(f, RIVER); f.stroke();
    for (const p of POOLS) { f.beginPath(); f.arc(p.x, p.y, p.r + 140, 0, TAU); f.fill(); }
    for (const b of BASES) { f.beginPath(); f.arc(b.x, b.y, BASE_R + 160, 0, TAU); f.fill(); }
    for (const c of CAMPS) { f.beginPath(); f.arc(c.x, c.y, 210, 0, TAU); f.fill(); }
    // feather the punched edges so the floor fades into the open ground
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.filter = 'blur(22px)'; g.drawImage(layer, 0, 0); g.restore();
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD;
      g.fillStyle = rnd() > 0.6 ? `rgba(120,110,50,${0.08 + rnd() * 0.12})` : `rgba(20,50,20,${0.10 + rnd() * 0.12})`;
      g.beginPath(); g.ellipse(x, y, 8 + rnd() * 22, 5 + rnd() * 12, rnd() * TAU, 0, TAU); g.fill();
    }
  }

  /* ---------------------------------------------------------------- lanes */
  function paintLaneAO(g, pts, w) {
    strokePath(g, pts, w + 120, 'rgba(20, 40, 14, 0.38)');
    strokePath(g, pts, w + 44, 'rgba(24, 44, 16, 0.5)');
  }
  /* A tiled road: darker grout base, staggered flagstones, worn centre,
     pebbles and grass along the verge. */
  function paintLane(g, pts, w, seed) {
    const rnd = rng(seed);
    strokePath(g, pts, w + 16, PAL.laneEdge);
    strokePath(g, pts, w, PAL.laneBase);
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
          const x = cx + nx * off, y = cy + ny * off;
          const shade = rnd();
          g.fillStyle = lerpc(PAL.laneSand, PAL.laneLight, shade);
          g.save(); g.translate(x, y); g.rotate(ang + (rnd() - 0.5) * 0.06);
          const tw = tileL - 7, th = tileW - 7;
          g.beginPath(); g.roundRect(-tw / 2, -th / 2, tw, th, 5); g.fill();
          if (shade > 0.7) {
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
        tuft(g, x + nx * 28 * side, y + ny * 28 * side, 12 + rnd() * 10, rnd, true);
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
  function paintRiver(g) {
    const rnd = rng(6110);
    const W = RIVER_HALF_W * 2;
    strokePath(g, RIVER, W + 150, 'rgba(24, 48, 20, 0.45)');
    strokePath(g, RIVER, W + 90, PAL.bank);
    strokePath(g, RIVER, W + 40, PAL.bankWet);
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const col = t < 0.5 ? lerpc(PAL.riverShallow, PAL.river, t * 2) : lerpc(PAL.river, PAL.riverDeep, (t - 0.5) * 2);
      strokePath(g, RIVER, W * (1 - t * 0.62), col);
    }
    for (const p of POOLS) {
      const R = p.r;
      g.fillStyle = 'rgba(14, 30, 24, 0.5)';
      blob(g, p.x + 16, p.y + 20, R + 70, R + 56, rnd, 0.12, 14); g.fill();
      g.fillStyle = PAL.bankWet; blob(g, p.x, p.y, R + 44, R + 36, rnd, 0.12, 14); g.fill();
      g.fillStyle = PAL.riverShallow; blob(g, p.x, p.y, R + 6, R, rnd, 0.08, 14); g.fill();
      const deep = g.createRadialGradient(p.x, p.y, R * 0.12, p.x, p.y, R);
      deep.addColorStop(0, PAL.riverDeep); deep.addColorStop(0.55, PAL.river); deep.addColorStop(1, rgba(PAL.riverShallow, 0));
      g.fillStyle = deep; g.beginPath(); g.arc(p.x, p.y, R, 0, TAU); g.fill();
      // a stone island the monster stands on
      g.fillStyle = PAL.plaza; blob(g, p.x, p.y, R * 0.42, R * 0.4, rnd, 0.1, 14); g.fill();
      g.strokeStyle = rgba(PAL.plazaLight, 0.6); g.lineWidth = 6;
      blob(g, p.x, p.y, R * 0.34, R * 0.32, rnd, 0.06, 14); g.stroke();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 1100; i++) {
      const t = rnd();
      const p = pathPoint(RIVER, t), q = pathPoint(RIVER, Math.min(1, t + 0.005));
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      const off = (rnd() - 0.5) * W * 0.9;
      const x = p.x + nx * off, y = p.y + ny * off, L = 12 + rnd() * 34;
      g.strokeStyle = rnd() > 0.45 ? `rgba(220, 250, 255, ${0.10 + rnd() * 0.22})` : `rgba(10, 60, 90, ${0.08 + rnd() * 0.16})`;
      g.lineWidth = 1.5 + rnd() * 2.5;
      g.beginPath(); g.moveTo(x - ux * L, y - uy * L);
      g.quadraticCurveTo(x + nx * (rnd() - 0.5) * 8, y + ny * (rnd() - 0.5) * 8, x + ux * L, y + uy * L); g.stroke();
    }
    for (const p of POOLS) {
      for (let i = 0; i < 90; i++) {
        const a = rnd() * TAU, d = p.r * (0.5 + rnd() * 0.45);
        g.fillStyle = `rgba(230, 255, 255, ${0.12 + rnd() * 0.25})`;
        g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 6 + rnd() * 16, 2 + rnd() * 3, -Math.PI / 4, 0, TAU); g.fill();
      }
    }
    for (let i = 0; i < 28; i++) {
      const p = pathPoint(RIVER, 0.1 + rnd() * 0.8);
      if (POOLS.some(q => dist(p, q) < q.r + 90)) continue;
      const off = (rnd() - 0.5) * W * 0.8;
      rock(g, p.x + off, p.y - off, 12 + rnd() * 20, rnd, true);
    }
    for (let i = 0; i < 120; i++) {
      const p = pathPoint(RIVER, rnd());
      if (POOLS.some(q => dist(p, q) < q.r + 30)) continue;
      const side = rnd() > 0.5 ? 1 : -1;
      const off = (W / 2 + 34 + rnd() * 40) * side;
      tuft(g, p.x + off * 0.7, p.y - off * 0.7, 16 + rnd() * 14, rnd, false);
    }
    // objective sigils on the pit floors
    if (typeof Icons !== 'undefined') {
      for (const [p, key, col] of [[LORD_PIT, 'epic:lord', THEME.gold], [TURTLE_PIT, 'epic:turtle', '#5eead4']]) {
        const glow = g.createRadialGradient(p.x, p.y, 10, p.x, p.y, p.r || PIT_WALL_R * 0.6);
        glow.addColorStop(0, rgba(col, 0.35)); glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(p.x, p.y, PIT_WALL_R * 0.6, 0, TAU); g.fill();
        g.save(); g.globalAlpha = 0.4; Icons.paint(g, key, p.x, p.y, PIT_WALL_R * 0.48); g.restore();
      }
    }
  }

  /* ---------------------------------------------------------------- bases */
  function paintBase(g, t) {
    const b = BASES[t], f = FOUNTAINS[t];
    const rnd = rng(500 + t);
    const R = BASE_R;
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
    const isGate = a => gates.some(gA => Math.abs(Math.atan2(Math.sin(a - gA), Math.cos(a - gA))) < 0.3);
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
    for (const a of gates) for (const s of [-0.33, 0.33]) rock(g, b.x + Math.cos(a + s) * rr, b.y + Math.sin(a + s) * rr, 30, rnd, false);
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
    const rnd = rng(9100 + index * 97);
    const R = water ? 110 : c.kind === 'normal' ? 130 : 150;
    g.save(); g.translate(c.x, c.y);
    g.fillStyle = 'rgba(20,30,14,0.22)';
    g.beginPath(); g.ellipse(8, 12, R * 1.02, R * 0.9, 0, 0, TAU); g.fill();
    g.fillStyle = water ? PAL.bankWet : PAL.dirt;
    blob(g, 0, 0, R, R * 0.92, rnd, 0.12, 12); g.fill();
    const inner = c.kind === 'blueBuff' ? '#2f9aa0' : c.kind === 'redBuff' ? '#c9702c'
      : c.kind === 'litho' ? '#5eead4' : c.kind === 'crab' ? '#b8c2cc' : PAL.dirtLight;
    const bowl = g.createRadialGradient(-R * 0.2, -R * 0.2, 10, 0, 0, R);
    bowl.addColorStop(0, inner); bowl.addColorStop(0.5, rgba(inner, 0.35)); bowl.addColorStop(1, rgba(inner, 0));
    g.fillStyle = bowl; g.beginPath(); g.arc(0, 0, R * 0.9, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60, 40, 20, 0.28)'; g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.stroke();
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, d = R * (0.15 + rnd() * 0.7);
      g.fillStyle = `rgba(60, 40, 20, ${0.12 + rnd() * 0.15})`;
      g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.9, 9 + rnd() * 10, 5 + rnd() * 5, rnd() * TAU, 0, TAU); g.fill();
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
    const rotA = rnd() * TAU;
    g.fillStyle = 'rgba(10, 16, 10, 0.4)';
    blob(g, x + r * 0.25, y + r * 0.35, r * 1.05, r * 0.7, rnd, 0.2, 8, rotA); g.fill();
    g.fillStyle = wet ? PAL.rockShade : PAL.rockLit;
    blob(g, x, y, r, r * 0.78, rnd, 0.28, 8, rotA); g.fill();
    g.fillStyle = wet ? PAL.rockLit : PAL.rockTop;
    blob(g, x - r * 0.18, y - r * 0.22, r * 0.62, r * 0.42, rnd, 0.3, 7, rotA); g.fill();
    g.fillStyle = 'rgba(255,250,230,0.28)';
    blob(g, x - r * 0.32, y - r * 0.36, r * 0.26, r * 0.14, rnd, 0.3, 6, rotA); g.fill();
  }

  /* Reed thicket: blade strokes over a dark bed. A capsule bush is a row of
     beds along its axis, the same shape the concealment test uses. */
  function bush(g, b) {
    if (b.poly) {
      /* exact outline: the polygon is the bed. A ground shadow, the bed with a
         darkened rim, then tall grass blades clipped to the outline. */
      const rnd = rng((b.x * 31 + b.y * 17) | 0);
      const path = (dx, dy) => { g.beginPath(); b.poly.forEach((p, i) => i ? g.lineTo(p.x + dx, p.y + dy) : g.moveTo(p.x + dx, p.y + dy)); g.closePath(); };
      path(8, 12); g.fillStyle = 'rgba(6, 22, 8, 0.5)'; g.fill();
      path(0, 0); g.fillStyle = '#2a6132'; g.fill();
      g.save(); path(0, 0); g.clip();
      g.strokeStyle = 'rgba(8, 34, 14, 0.6)'; g.lineWidth = 30; g.lineJoin = 'round'; path(0, 0); g.stroke();
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      const n = Math.round((w * h) / 150);
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const px = b.minX + rnd() * w, py = b.minY + rnd() * h;
        if (!polyClosest(b.poly, px, py).inside) continue;
        const hgt = 14 + rnd() * 22;
        const lit = rnd() < 0.45;
        g.strokeStyle = lit ? `rgba(${110 + rnd() * 60 | 0},${190 + rnd() * 40 | 0},${70 + rnd() * 30 | 0},0.85)`
          : `rgba(${30 + rnd() * 30 | 0},${100 + rnd() * 50 | 0},${34 + rnd() * 20 | 0},0.85)`;
        g.lineWidth = 2.2 + rnd() * 1.6;
        g.beginPath(); g.moveTo(px, py + 3);
        g.quadraticCurveTo(px + (rnd() - 0.5) * 10, py - hgt * 0.5, px + (rnd() - 0.5) * 16, py - hgt);
        g.stroke();
      }
      g.restore();
      return;
    }
    bushBeds(g, b);
  }
  function bushBeds(g, b) {
    const rnd = rng((b.x * 31 + b.y * 17) | 0);
    const beds = [];
    if (b.ax === undefined) beds.push({ x: b.x, y: b.y });
    else {
      const len = Math.hypot(b.bx - b.ax, b.by - b.ay), n = Math.max(1, Math.round(len / (b.r * 0.8)));
      for (let i = 0; i <= n; i++) beds.push({ x: b.ax + (b.bx - b.ax) * i / n, y: b.ay + (b.by - b.ay) * i / n });
    }
    for (const c of beds) {
      g.fillStyle = 'rgba(6, 22, 8, 0.55)';
      blob(g, c.x + 10, c.y + 12, b.r * 1.2, b.r * 0.85, rnd, 0.2, 9); g.fill();
    }
    for (const c of beds) {
      g.fillStyle = '#245a2c';
      blob(g, c.x, c.y, b.r * 1.12, b.r * 0.8, rnd, 0.22, 9); g.fill();
    }
    g.lineCap = 'round';
    for (const c of beds) {
      for (let i = 0; i < 44; i++) {
        const a = rnd() * TAU, d = rnd() * b.r * 0.95;
        const px = c.x + Math.cos(a) * d, py = c.y + Math.sin(a) * d * 0.72;
        const h = b.r * (0.35 + rnd() * 0.5);
        const lit = px < c.x && py < c.y;
        g.strokeStyle = lit ? `rgba(${110 + rnd() * 60 | 0},${190 + rnd() * 40 | 0},${70 + rnd() * 30 | 0},0.85)`
          : `rgba(${30 + rnd() * 30 | 0},${100 + rnd() * 50 | 0},${34 + rnd() * 20 | 0},0.85)`;
        g.lineWidth = 2.4 + rnd() * 1.6;
        g.beginPath(); g.moveTo(px, py + 4);
        g.quadraticCurveTo(px + (rnd() - 0.5) * 10, py - h * 0.5, px + (rnd() - 0.5) * 16, py - h);
        g.stroke();
      }
    }
  }

  /* Cliff footprints under the live walls: a shadow and a scatter of boulders,
     so the extruded ridge stands on something instead of floating on grass. */
  function paintWallFootprints(g) {
    const rnd = rng(78123);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const segR = (a, b, w) => a.r !== undefined ? (a.r + b.r) / 2 : w.r;
    const eachSeg = fn => { for (const w of MAP_WALLS) { if (w.hidden || w.poly) continue; for (let i = 1; i < w.pts.length; i++) fn(w.pts[i - 1], w.pts[i], segR(w.pts[i - 1], w.pts[i], w)); } };
    const polyPath = (poly, dx, dy) => { g.beginPath(); poly.forEach((p, i) => i ? g.lineTo(p.x + dx, p.y + dy) : g.moveTo(p.x + dx, p.y + dy)); g.closePath(); };
    eachSeg((a, b, r) => {
      g.strokeStyle = 'rgba(10, 18, 10, 0.5)'; g.lineWidth = r * 2 + 40;
      g.beginPath(); g.moveTo(a.x + 14, a.y + 22); g.lineTo(b.x + 14, b.y + 22); g.stroke();
    });
    for (const w of MAP_WALLS) {
      if (w.hidden || !w.poly) continue;
      g.fillStyle = 'rgba(10, 18, 10, 0.5)'; g.strokeStyle = 'rgba(10, 18, 10, 0.5)'; g.lineWidth = 40;
      polyPath(w.poly, 14, 22); g.fill(); g.stroke();
    }
    eachSeg((a, b, r) => {
      g.strokeStyle = PAL.rockDark; g.lineWidth = r * 2 + 8;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    });
    for (const w of MAP_WALLS) {
      if (w.hidden || !w.poly) continue;
      g.fillStyle = PAL.rockDark; g.strokeStyle = PAL.rockDark; g.lineWidth = 8;
      polyPath(w.poly, 0, 0); g.fill(); g.stroke();
    }
    for (const w of MAP_WALLS) {
      if (w.hidden) continue;
      const step = Math.max(1, Math.floor(w.pts.length / 4));
      for (let i = 0; i < w.pts.length; i += step) {
        const p = w.pts[i], r = p.r !== undefined ? p.r : w.r;
        rock(g, p.x + (rnd() - 0.5) * r, p.y + r * 0.6 + rnd() * 10, Math.min(60, r * (0.3 + rnd() * 0.25)), rnd, false);
      }
    }
  }

  /* Undergrowth in the jungle: shrubs and flowers along the ridges, never
     in the corridors, so the walkable paths read as open floor. */
  function paintUndergrowth(g) {
    const rnd = rng(20260921);
    const nearWall = (x, y) => MAP_WALLS.some(w => x > w.minX - 90 && x < w.maxX + 90 && y > w.minY - 90 && y < w.maxY + 90 && !wallBlocks(w, x, y, 0) && wallBlocks(w, x, y, 70));
    const open = (x, y) => {
      for (const lane of Object.values(LANES)) if (distPoly(x, y, lane) < LANE_WIDTH / 2 + 40) return false;
      if (distPoly(x, y, RIVER) < RIVER_HALF_W + 60) return false;
      for (const p of POOLS) if (dist({ x, y }, p) < p.r + 70) return false;
      for (const c of CAMPS) if (dist({ x, y }, c) < 190) return false;
      for (const b of BASES) if (dist({ x, y }, b) < BASE_R + 100) return false;
      for (const t of TOWER_SPOTS) if (dist({ x, y }, t) < 140) return false;
      for (const b of BUSHES) if (bushDist(b, x, y) < b.r + 30) return false;
      return true;
    };
    let placed = 0;
    for (let i = 0; i < 6000 && placed < 900; i++) {
      const x = rnd() * WORLD, y = rnd() * WORLD;
      if (x + y > WORLD) continue;                                 // author one half, rotate
      if (!open(x, y) || !nearWall(x, y)) continue;
      const q = rot({ x, y });
      const s = 10 + rnd() * 16;
      for (const c of [{ x, y }, q]) {
        g.fillStyle = rnd() > 0.85 ? `rgba(${220 + rnd() * 30 | 0},${170 + rnd() * 60 | 0},90,0.8)` : lerpc('#3f8a35', '#7cc352', rnd());
        blob(g, c.x, c.y, s, s * 0.7, rnd, 0.3, 7); g.fill();
      }
      placed++;
    }
  }

  /* ---------------------------------------------------------------- edge
     The board is an island: sea beyond the border, a cliff rim along it. The
     baked layer extends MARGIN world units past the playable square so the
     camera never shows void near a base. */
  const MARGIN = 520;
  function paintSea(g) {
    const rnd = rng(31337);
    const sea = g.createRadialGradient(WORLD / 2, WORLD / 2, WORLD * 0.55, WORLD / 2, WORLD / 2, WORLD * 0.9);
    sea.addColorStop(0, '#15505f'); sea.addColorStop(1, '#0a2a36');
    g.fillStyle = sea; g.fillRect(-MARGIN, -MARGIN, WORLD + 2 * MARGIN, WORLD + 2 * MARGIN);
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = -MARGIN + rnd() * (WORLD + 2 * MARGIN), y = -MARGIN + rnd() * (WORLD + 2 * MARGIN);
      if (x > 40 && x < WORLD - 40 && y > 40 && y < WORLD - 40) continue;
      g.strokeStyle = `rgba(190, 235, 240, ${0.06 + rnd() * 0.16})`; g.lineWidth = 1.5 + rnd() * 2;
      const L = 14 + rnd() * 50;
      g.beginPath(); g.moveTo(x - L, y); g.quadraticCurveTo(x, y + (rnd() - 0.5) * 6, x + L, y); g.stroke();
    }
  }
  function paintRim(g) {
    const rnd = rng(4141);
    // foam where the water meets the rock, then the cliff face and its top
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(210, 245, 245, 0.25)'; g.lineWidth = 170; g.strokeRect(0, 0, WORLD, WORLD);
    g.strokeStyle = PAL.rockDark; g.lineWidth = 130; g.strokeRect(0, 0, WORLD, WORLD);
    g.strokeStyle = PAL.rockShade; g.lineWidth = 104; g.strokeRect(0, 0, WORLD, WORLD);
    g.strokeStyle = PAL.rockLit; g.lineWidth = 78; g.strokeRect(-6, -8, WORLD + 12, WORLD + 16);
    g.strokeStyle = PAL.rockTop; g.lineWidth = 50; g.strokeRect(-12, -16, WORLD + 24, WORLD + 32);
    g.strokeStyle = rgba(PAL.moss, 0.5); g.lineWidth = 12; g.strokeRect(24, 20, WORLD - 48, WORLD - 40);
    for (let i = 0; i < 260; i++) {                  // boulders along the rim
      const t = rnd(), side = (rnd() * 4) | 0;
      const p = side === 0 ? [t * WORLD, 0] : side === 1 ? [WORLD, t * WORLD] : side === 2 ? [t * WORLD, WORLD] : [0, t * WORLD];
      rock(g, p[0] + (rnd() - 0.5) * 70, p[1] + (rnd() - 0.5) * 70, 14 + rnd() * 26, rnd, false);
    }
  }

  /* ---------------------------------------------------------------- light */
  function paintLight(g) {
    const edge = g.createRadialGradient(WORLD / 2, WORLD / 2, WORLD * 0.3, WORLD / 2, WORLD / 2, WORLD * 0.76);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(4, 14, 8, 0.28)');
    g.fillStyle = edge; g.fillRect(0, 0, WORLD, WORLD);
    const sun = g.createLinearGradient(0, 0, WORLD, WORLD);
    sun.addColorStop(0, 'rgba(255, 240, 190, 0.18)'); sun.addColorStop(0.5, 'rgba(0,0,0,0)'); sun.addColorStop(1, 'rgba(8, 18, 40, 0.22)');
    g.fillStyle = sun; g.fillRect(0, 0, WORLD, WORLD);
  }

  /* ---------------------------------------------------------------- board */
  /* The two cut-off corners are not part of the board: open water with the
     same cliff edge the rim has, so the octagon reads as the island. */
  function paintCorners(g) {
    for (const poly of (typeof MAP_VOID !== 'undefined' ? MAP_VOID : [])) {
      g.beginPath(); g.moveTo(poly[0].x, poly[0].y);
      for (const p of poly) g.lineTo(p.x, p.y);
      g.closePath();
      g.fillStyle = '#123f4c'; g.fill();
      g.strokeStyle = PAL.rockShade; g.lineWidth = 60; g.lineJoin = 'round'; g.stroke();
      g.strokeStyle = PAL.rockDark; g.lineWidth = 14; g.stroke();
    }
  }

  /* One polygon rock: its footprint extruded upward in shade steps to a lit
     top. The outline is the reference's own, so nothing is invented. */
  function drawWallPoly(ctx, w) {
    const poly = w.poly, h = Math.min(130, w.r * 1.15 + 30);
    const path = (dx, dy) => { ctx.beginPath(); poly.forEach((p, i) => i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)); ctx.closePath(); };
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(6, 12, 8, 0.4)'; path(w.r * 0.2 + 8, w.r * 0.35 + 12); ctx.fill();
    ctx.fillStyle = PAL.rockDark; ctx.strokeStyle = PAL.rockDark; ctx.lineWidth = 8; path(0, 0); ctx.fill(); ctx.stroke();
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, col = mixHex(PAL.rockShade, PAL.rockLit, t);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 3; path(0, -h * t); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = PAL.rockTop; path(0, -h); ctx.fill();
    ctx.save(); path(0, -h); ctx.clip();
    ctx.strokeStyle = mixHex(PAL.rockTop, '#fff2d8', 0.22); ctx.lineWidth = 6; path(3, -h + 3); ctx.stroke();
    const rnd = rng(((w.minX * 73 + w.minY * 151) | 0) & 0x7fffffff);
    ctx.fillStyle = rgba(PAL.moss, 0.45);
    for (let i = 0; i < 3 + (poly.length / 12 | 0); i++) {
      const p = poly[(rnd() * poly.length) | 0];
      blob(ctx, p.x + (w.x - p.x) * 0.4 * rnd(), p.y - h + (w.y - p.y) * 0.4 * rnd(), 14 + rnd() * 24, 8 + rnd() * 12, rnd, 0.3, 7, rnd() * TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(30, 24, 16, 0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 2 + (poly.length / 16 | 0); i++) {        // short cracks running in from the edge
      const p = poly[(rnd() * poly.length) | 0], t = 0.15 + rnd() * 0.3;
      const mx_ = p.x + (w.x - p.x) * t, my_ = p.y + (w.y - p.y) * t;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - h); ctx.lineTo(mx_ + (rnd() - 0.5) * 20, my_ - h + (rnd() - 0.5) * 20); ctx.stroke();
    }
    ctx.restore();
  }

  function paintBoard(g) {
    paintSea(g);
    paintGround(g);
    paintCorners(g);
    paintJungleFloor(g);
    paintRiver(g);
    for (const lane of Object.values(LANES)) paintLaneAO(g, lane, LANE_WIDTH);
    let seed = 44001;
    for (const lane of Object.values(LANES)) paintLane(g, lane, LANE_WIDTH, seed++);
    paintTowerPads(g);
    CAMPS.forEach((c, i) => paintCamp(g, c, i));
    for (const t of [0, 1]) paintBase(g, t);
    paintWallFootprints(g);
    paintUndergrowth(g);
    for (const b of BUSHES) bush(g, b);
    paintLight(g);
    paintRim(g);
  }

  /* ---------------------------------------------------------------- walls
     Live extrusion of one wall segment inside the tilted world pass. The
     top outline wobbles per segment so ridges read as rock, not pipe. */
  function drawWall(ctx, a, b, r) { drawWallRun(ctx, [{ a, b, r }]); }

  /* A run is consecutive segments of one wall at about the same depth. Every
     layer is stroked across the whole run before the next layer starts, so
     fat rock sampled every few steps reads as one body instead of a stack
     of rings. Each segment keeps its own radius, so rock tapers. */
  function drawWallRun(ctx, segs) {
    const prep = segs.map(({ a, b, r }) => {
      const h = r * 1.15 + 30;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const n = Math.max(2, Math.min(9, Math.round(len / 40)));
      const rnd = rng(((a.x * 73 + a.y * 151 + b.x * 31) | 0) & 0x7fffffff);
      const wob = Array.from({ length: n + 1 }, () => (rnd() - 0.5) * r * 0.32);
      return { a, b, r, h, n, wob };
    });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const layer = (dyOf, wOf, colOf, wobble) => {
      for (const s of prep) {
        const dy = dyOf(s), w = wOf(s);
        ctx.strokeStyle = colOf(s); ctx.lineWidth = w * 2;
        ctx.beginPath();
        for (let i = 0; i <= s.n; i++) {
          const t = i / s.n;
          const x = s.a.x + (s.b.x - s.a.x) * t, y = s.a.y + (s.b.y - s.a.y) * t + dy + (wobble ? s.wob[i] : 0);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    layer(s => s.r * 0.35 + 12, s => s.r + 14, () => 'rgba(6, 12, 8, 0.4)', false);
    layer(() => 0, s => s.r + 4, () => PAL.rockDark, false);
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, col = mixHex(PAL.rockShade, PAL.rockLit, t);
      layer(s => -s.h * t, s => s.r * (1 - t * 0.16), () => col, t > 0.5);
    }
    layer(s => -s.h, s => s.r * 0.84, () => PAL.rockTop, true);
    layer(s => -s.h - 3, s => s.r * 0.5, () => mixHex(PAL.rockTop, '#fff2d8', 0.22), true);
    for (const s of prep) {
      ctx.strokeStyle = rgba(PAL.moss, 0.55); ctx.lineWidth = Math.max(3, s.r * 0.26);
      ctx.beginPath();
      for (let i = 0; i <= s.n; i++) {
        const t = i / s.n;
        const x = s.a.x + (s.b.x - s.a.x) * t - s.r * 0.3, y = s.a.y + (s.b.y - s.a.y) * t - s.h - s.r * 0.5 + s.wob[i] * 0.8;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(30, 24, 16, 0.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.a.x + s.r * 0.2, s.a.y - s.h + s.r * 0.15); ctx.lineTo(s.b.x - s.r * 0.2, s.b.y - s.h - s.r * 0.02); ctx.stroke();
    }
  }

  return { paintBoard, drawWall, drawWallRun, drawWallPoly, PAL, MARGIN };
})();
