'use strict';
/* ============================================================
   icons.js — hand-drawn vector icon set.

   Every hero portrait, skill, battle spell, emblem and HUD glyph
   is a small canvas drawing in a 100×100 box. No image assets:
   icons render crisp at any size, recolour with the theme, and
   work identically in the DOM (via cached data-URLs) and on the
   world canvas (via Icons.paint).

   Add an icon: GLYPHS['kind:id'] = g => { ...draw in 100×100... }
   ============================================================ */

const Icons = (() => {
  const T2 = Math.PI * 2;

  /* ---------- tiny drawing helpers (all coords in the 100 box) ---------- */
  const lg = (g, x0, y0, x1, y1, stops) => {
    const G = g.createLinearGradient(x0, y0, x1, y1);
    for (const [t, c] of stops) G.addColorStop(t, c);
    return G;
  };
  const rg = (g, x, y, r, stops) => {
    const G = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [t, c] of stops) G.addColorStop(t, c);
    return G;
  };
  const path = (g, pts, close = true) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (close) g.closePath();
  };
  const seg = (g, x0, y0, x1, y1, w, c) => {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.lineWidth = w; g.strokeStyle = c; g.lineCap = 'round'; g.stroke();
  };
  const ring = (g, x, y, r, w, c, a0 = 0, a1 = T2) => {
    g.beginPath(); g.arc(x, y, r, a0, a1);
    g.lineWidth = w; g.strokeStyle = c; g.lineCap = 'round'; g.stroke();
  };
  const dot = (g, x, y, r, c) => {
    g.beginPath(); g.arc(x, y, r, 0, T2); g.fillStyle = c; g.fill();
  };
  const rot = (g, x, y, a, fn) => {
    g.save(); g.translate(x, y); g.rotate(a); fn(); g.restore();
  };
  /* solid triangle pointing along `ang` */
  const tri = (g, x, y, size, ang, c) => {
    rot(g, x, y, ang, () => {
      path(g, [[size, 0], [-size * 0.7, -size * 0.62], [-size * 0.7, size * 0.62]]);
      g.fillStyle = c; g.fill();
    });
  };
  /* arrow = shaft + head, pointing x0y0 → x1y1 */
  const arrow = (g, x0, y0, x1, y1, w, c, head = 2.2) => {
    const a = Math.atan2(y1 - y0, x1 - x0);
    const hx = x1 - Math.cos(a) * w * head * 0.8, hy = y1 - Math.sin(a) * w * head * 0.8;
    seg(g, x0, y0, hx, hy, w, c);
    tri(g, x1, y1, w * head, a, c);
  };
  const chevron = (g, x, y, w, h, lw, c, ang = -Math.PI / 2) => {
    rot(g, x, y, ang + Math.PI / 2, () => {
      g.beginPath(); g.moveTo(-w, h / 2); g.lineTo(0, -h / 2); g.lineTo(w, h / 2);
      g.lineWidth = lw; g.strokeStyle = c; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    });
  };
  /* leaf: base at (x,y), pointing along ang */
  const leaf = (g, x, y, ang, len, wid, c0, c1) => {
    rot(g, x, y, ang, () => {
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.45, -wid, len, 0);
      g.quadraticCurveTo(len * 0.45, wid, 0, 0);
      g.fillStyle = lg(g, 0, 0, len, 0, [[0, c0], [1, c1]]);
      g.fill();
      seg(g, len * 0.12, 0, len * 0.82, 0, 1.6, 'rgba(6,52,28,0.55)');
    });
  };
  /* 4-point sparkle */
  const spark4 = (g, x, y, r, c) => {
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y);
    g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.fillStyle = c; g.fill();
  };
  /* faceted gem in a hexagon */
  const gem = (g, x, y, r, c0, c1, c2) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * T2 - Math.PI / 2;
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    path(g, pts);
    g.fillStyle = lg(g, x - r, y - r, x + r, y + r, [[0, c0], [0.55, c1], [1, c2]]);
    g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(10,16,28,0.7)'; g.stroke();
    // facets
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.5)';
    for (const [px, py] of [pts[0], pts[2], pts[4]]) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(px, py); g.stroke();
    }
    dot(g, x - r * 0.3, y - r * 0.35, r * 0.16, 'rgba(255,255,255,0.85)');
  };
  const skullMark = (g, x, y, r, c) => {
    g.beginPath(); g.arc(x, y - r * 0.15, r, Math.PI, 0);
    g.lineTo(x + r, y + r * 0.45); g.lineTo(x + r * 0.45, y + r * 0.45);
    g.lineTo(x + r * 0.3, y + r * 0.8); g.lineTo(x - r * 0.3, y + r * 0.8);
    g.lineTo(x - r * 0.45, y + r * 0.45); g.lineTo(x - r, y + r * 0.45);
    g.closePath(); g.fillStyle = c; g.fill();
    dot(g, x - r * 0.42, y - r * 0.05, r * 0.24, 'rgba(8,10,18,0.9)');
    dot(g, x + r * 0.42, y - r * 0.05, r * 0.24, 'rgba(8,10,18,0.9)');
  };
  /* two-tone rune blade pointing up, base at (x,y+len/2) */
  const blade = (g, x, y, len, wid, c0, c1, edge) => {
    path(g, [[x, y - len / 2], [x + wid / 2, y - len / 2 + wid], [x + wid * 0.36, y + len / 2],
             [x - wid * 0.36, y + len / 2], [x - wid / 2, y - len / 2 + wid]]);
    g.fillStyle = lg(g, x - wid, y, x + wid, y, [[0, c0], [1, c1]]);
    g.fill();
    g.lineWidth = 2; g.strokeStyle = edge; g.stroke();
    seg(g, x, y - len / 2 + wid * 0.8, x, y + len / 2 - 2, 1.4, 'rgba(10,14,24,0.4)');
  };

  /* ============================================================
     THE GLYPHS
     ============================================================ */
  const GLYPHS = {};

  /* ---------------- hero portraits ---------------- */
  GLYPHS['hero:zephyr'] = g => {                                  // wind archer
    ring(g, 34, 32, 15, 4, 'rgba(189,233,255,0.45)', -0.25 * Math.PI, 0.55 * Math.PI);
    ring(g, 28, 55, 10, 3.4, 'rgba(189,233,255,0.32)', -0.15 * Math.PI, 0.7 * Math.PI);
    ring(g, 58, 50, 34, 7, '#2f7ea8', 0.62 * Math.PI, 1.38 * Math.PI);   // bow limb
    ring(g, 58, 50, 34, 3.4, '#7dd3fc', 0.62 * Math.PI, 1.38 * Math.PI);
    seg(g, 44.5, 20, 44.5, 80, 2.4, 'rgba(219,234,254,0.85)');           // string
    seg(g, 30, 62, 40, 52, 4, '#bde9ff'); seg(g, 30, 50, 38, 56, 4, '#bde9ff'); // fletch
    arrow(g, 30, 50, 88, 50, 5, '#e8f7ff', 2.4);                          // arrow
    dot(g, 44.5, 50, 3.2, '#7dd3fc');
  };
  GLYPHS['hero:ignis'] = g => {                                   // living flame
    g.beginPath();
    g.moveTo(50, 10);
    g.bezierCurveTo(72, 30, 72, 52, 58, 62);
    g.bezierCurveTo(74, 60, 80, 50, 83, 44);
    g.bezierCurveTo(87, 68, 72, 88, 50, 90);
    g.bezierCurveTo(28, 88, 14, 70, 17, 48);
    g.bezierCurveTo(20, 56, 26, 60, 32, 60);
    g.bezierCurveTo(22, 44, 34, 24, 50, 10);
    g.closePath();
    g.fillStyle = lg(g, 50, 10, 50, 90, [[0, '#ffd166'], [0.5, '#fb923c'], [1, '#e0421b']]);
    g.fill();
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(124,45,18,0.55)'; g.stroke();
    g.beginPath();
    g.moveTo(50, 44);
    g.bezierCurveTo(62, 56, 62, 72, 50, 82);
    g.bezierCurveTo(38, 72, 38, 56, 50, 44);
    g.closePath();
    g.fillStyle = rg(g, 50, 66, 22, [[0, '#fff7d6'], [1, '#ffcf5c']]);
    g.fill();
  };
  GLYPHS['hero:grom'] = g => {                                    // kite shield
    g.beginPath();
    g.moveTo(50, 12); g.lineTo(79, 24);
    g.bezierCurveTo(79, 52, 70, 74, 50, 89);
    g.bezierCurveTo(30, 74, 21, 52, 21, 24);
    g.closePath();
    g.fillStyle = lg(g, 28, 16, 72, 86, [[0, '#dde5ef'], [0.5, '#94a3b8'], [1, '#54637a']]);
    g.fill();
    g.lineWidth = 4; g.strokeStyle = '#2f3d55'; g.stroke();
    chevron(g, 50, 44, 21, 13, 5.5, 'rgba(47,61,85,0.85)', Math.PI / 2);
    chevron(g, 50, 60, 16, 11, 4.5, 'rgba(47,61,85,0.6)', Math.PI / 2);
    dot(g, 50, 34, 7, '#e8eef7');
    ring(g, 50, 34, 7, 2.4, '#2f3d55');
    dot(g, 47.5, 31.5, 2, 'rgba(255,255,255,0.9)');
  };
  GLYPHS['hero:nyx'] = g => {                                     // dagger & moon
    g.save();
    g.beginPath(); g.arc(35, 33, 20, 0, T2); g.fillStyle = 'rgba(216,180,254,0.8)'; g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(43, 27, 17, 0, T2); g.fill();
    g.restore();
    rot(g, 50, 54, -0.72, () => {
      path(g, [[0, -36], [5, -28], [3, 26], [0, 32], [-3, 26], [-5, -28]]);
      g.fillStyle = lg(g, -5, 0, 5, 0, [[0, '#f3e8ff'], [1, '#a855f7']]);
      g.fill();
      g.lineWidth = 1.8; g.strokeStyle = 'rgba(30,10,60,0.7)'; g.stroke();
      g.fillStyle = '#7c3aed'; g.fillRect(-11, 26, 22, 5.5);
      g.fillStyle = '#2e1065'; g.fillRect(-3.4, 31.5, 6.8, 13);
      dot(g, 0, 47, 4, '#a855f7');
    });
    spark4(g, 74, 30, 5.5, 'rgba(233,213,255,0.9)');
    spark4(g, 66, 70, 4, 'rgba(233,213,255,0.6)');
  };
  GLYPHS['hero:sylva'] = g => {                                   // forest sprout
    g.beginPath(); g.moveTo(50, 88); g.quadraticCurveTo(46, 64, 50, 42);
    g.lineWidth = 5; g.strokeStyle = '#16a34a'; g.lineCap = 'round'; g.stroke();
    leaf(g, 49, 64, Math.PI * 0.82, 30, 10, '#86efac', '#22c55e');
    leaf(g, 50, 56, -Math.PI * 0.18, 32, 10.5, '#a7f3d0', '#34d399');
    leaf(g, 50, 42, -Math.PI / 2, 32, 11, '#bbf7d0', '#4ade80');
    spark4(g, 26, 34, 5, 'rgba(190,242,100,0.85)');
    spark4(g, 76, 46, 4, 'rgba(190,242,100,0.6)');
  };
  GLYPHS['hero:torren'] = g => {                                  // double-bit axe
    rot(g, 50, 55, -0.24, () => {
      g.fillStyle = lg(g, -4, 0, 4, 0, [[0, '#a16b45'], [1, '#6b4226']]);
      g.fillRect(-4, -32, 8, 72);
      g.lineWidth = 1.6; g.strokeStyle = '#3f2413'; g.strokeRect(-4, -32, 8, 72);
      seg(g, -4, 18, 4, 22, 2, '#3f2413'); seg(g, -4, 26, 4, 30, 2, '#3f2413');
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 5, -34);
        g.bezierCurveTo(s * 30, -46, s * 40, -26, s * 30, -4);
        g.bezierCurveTo(s * 22, -12, s * 12, -15, s * 5, -13);
        g.closePath();
        g.fillStyle = lg(g, 0, -44, 0, -4, [[0, '#fca5a5'], [0.55, '#ef4444'], [1, '#b91c1c']]);
        g.fill();
        g.lineWidth = 2.4; g.strokeStyle = '#7f1d1d'; g.stroke();
      }
      dot(g, 0, -22, 4.4, '#fde68a');
    });
  };
  GLYPHS['hero:mira'] = g => {                                    // snowflake
    ring(g, 50, 50, 33, 2, 'rgba(147,197,253,0.28)');
    for (let i = 0; i < 6; i++) {
      rot(g, 50, 50, i / 6 * T2, () => {
        seg(g, 0, 0, 0, -32, 4.6, '#bfdbfe');
        seg(g, 0, -20, -8, -27, 3.4, '#93c5fd');
        seg(g, 0, -20, 8, -27, 3.4, '#93c5fd');
        dot(g, 0, -32, 2.6, '#eff6ff');
      });
    }
    gem(g, 50, 50, 10, '#ffffff', '#bfdbfe', '#60a5fa');
  };
  GLYPHS['hero:karn'] = g => {                                    // hook & chain
    for (const [x, y] of [[27, 22], [38, 34], [49, 46]]) {
      rot(g, x, y, Math.PI / 4, () => {
        g.beginPath(); g.ellipse(0, 0, 8.5, 5.5, 0, 0, T2);
        g.lineWidth = 4.4; g.strokeStyle = '#b45309'; g.stroke();
        g.beginPath(); g.ellipse(0, 0, 8.5, 5.5, 0, 0, T2);
        g.lineWidth = 2; g.strokeStyle = '#fbbf24'; g.stroke();
      });
    }
    g.beginPath();
    g.moveTo(52, 49);
    g.bezierCurveTo(70, 58, 72, 76, 58, 84);
    g.bezierCurveTo(47, 89, 36, 84, 34, 74);
    g.lineWidth = 8; g.strokeStyle = '#b45309'; g.lineCap = 'round'; g.stroke();
    g.beginPath();
    g.moveTo(52, 49);
    g.bezierCurveTo(70, 58, 72, 76, 58, 84);
    g.bezierCurveTo(47, 89, 36, 84, 34, 74);
    g.lineWidth = 3.6; g.strokeStyle = '#fbbf24'; g.stroke();
    tri(g, 33, 71, 8, -Math.PI * 0.62, '#fbbf24');
  };

  /* ---------------- passives ---------------- */
  GLYPHS['passive:zephyr'] = g => {                               // tailwind
    for (const [y, l, a] of [[32, 46, 0.9], [50, 56, 1], [68, 40, 0.7]]) {
      g.beginPath(); g.moveTo(22, y); g.quadraticCurveTo(22 + l * 0.7, y - 8, 22 + l, y);
      g.lineWidth = 5; g.strokeStyle = `rgba(189,233,255,${a})`; g.lineCap = 'round'; g.stroke();
      dot(g, 22 + l, y, 3.4, '#e8f7ff');
    }
  };
  GLYPHS['passive:ignis'] = g => {                                // combustion embers
    dot(g, 32, 72, 7, '#fb923c'); dot(g, 50, 76, 8.5, '#f97316'); dot(g, 68, 72, 7, '#fb923c');
    g.beginPath();
    g.moveTo(50, 16); g.bezierCurveTo(64, 30, 62, 44, 50, 54);
    g.bezierCurveTo(38, 44, 36, 30, 50, 16);
    g.fillStyle = lg(g, 50, 16, 50, 54, [[0, '#ffd166'], [1, '#ef4444']]); g.fill();
  };
  GLYPHS['passive:grom'] = g => {                                 // bulwark
    g.beginPath();
    g.moveTo(50, 16); g.lineTo(76, 26); g.bezierCurveTo(76, 52, 68, 72, 50, 84);
    g.bezierCurveTo(32, 72, 24, 52, 24, 26); g.closePath();
    g.lineWidth = 6; g.strokeStyle = '#94a3b8'; g.stroke();
    seg(g, 50, 34, 50, 62, 6.5, '#cbd5e1'); seg(g, 36, 48, 64, 48, 6.5, '#cbd5e1');
  };
  GLYPHS['passive:nyx'] = g => {                                  // backstab
    chevron(g, 40, 50, 16, 26, 7, 'rgba(216,180,254,0.55)', 0);
    arrow(g, 84, 50, 56, 50, 5.5, '#c084fc', 2);
  };
  GLYPHS['passive:sylva'] = g => {                                // verdant gift
    g.beginPath(); g.moveTo(50, 82); g.quadraticCurveTo(48, 60, 50, 46);
    g.lineWidth = 4.4; g.strokeStyle = '#16a34a'; g.lineCap = 'round'; g.stroke();
    leaf(g, 50, 52, -Math.PI * 0.5, 26, 9, '#bbf7d0', '#4ade80');
    spark4(g, 30, 32, 6, '#bef264'); spark4(g, 70, 38, 4.6, 'rgba(190,242,100,0.7)');
  };
  GLYPHS['passive:torren'] = g => {                               // bloodthirst
    g.beginPath();
    g.moveTo(50, 14);
    g.bezierCurveTo(68, 40, 74, 54, 74, 64);
    g.arc(50, 64, 24, 0, Math.PI);
    g.bezierCurveTo(26, 54, 32, 40, 50, 14);
    g.fillStyle = lg(g, 50, 14, 50, 88, [[0, '#fca5a5'], [1, '#dc2626']]); g.fill();
    dot(g, 42, 60, 5, 'rgba(255,255,255,0.55)');
  };
  GLYPHS['passive:mira'] = g => {                                 // frostbite pips
    for (let i = 0; i < 4; i++) dot(g, 26 + i * 16, 76, 5, i < 3 ? '#93c5fd' : '#eff6ff');
    gem(g, 50, 40, 20, '#ffffff', '#bfdbfe', '#3b82f6');
  };
  GLYPHS['passive:karn'] = g => {                                 // ironclad gear
    for (let i = 0; i < 8; i++) {
      rot(g, 50, 50, i / 8 * T2, () => {
        g.fillStyle = '#b45309'; g.fillRect(-5, -34, 10, 12);
      });
    }
    ring(g, 50, 50, 24, 9, '#f59e0b');
    ring(g, 50, 50, 24, 3.4, '#fde68a');
    dot(g, 50, 50, 8, '#78350f');
  };

  /* ---------------- Zephyr skills ---------------- */
  GLYPHS['skill:zephyr:0'] = g => {                               // Piercing Bolt
    for (const x of [38, 60]) {
      ring(g, x, 50, 15, 4, 'rgba(125,211,252,0.5)', -1.1, 1.1);
      ring(g, x, 50, 15, 4, 'rgba(125,211,252,0.5)', Math.PI - 1.1, Math.PI + 1.1);
    }
    arrow(g, 12, 50, 90, 50, 5.5, '#e8f7ff', 2.2);
    seg(g, 16, 44, 24, 50, 4, '#7dd3fc'); seg(g, 16, 56, 24, 50, 4, '#7dd3fc');
  };
  GLYPHS['skill:zephyr:1'] = g => {                               // Agile Hop
    g.beginPath(); g.moveTo(20, 76); g.quadraticCurveTo(48, 12, 82, 42);
    g.lineWidth = 5; g.strokeStyle = 'rgba(125,211,252,0.85)';
    g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]);
    tri(g, 84, 44, 10, 0.7, '#e8f7ff');
    chevron(g, 26, 70, 12, 10, 5, 'rgba(189,233,255,0.7)', -Math.PI / 2);
    chevron(g, 26, 82, 12, 10, 5, 'rgba(189,233,255,0.4)', -Math.PI / 2);
  };
  GLYPHS['skill:zephyr:2'] = g => {                               // Arrow Storm
    g.beginPath(); g.ellipse(50, 78, 30, 9, 0, 0, T2);
    g.lineWidth = 3.4; g.strokeStyle = 'rgba(125,211,252,0.6)'; g.stroke();
    for (const [x, y] of [[34, 18], [52, 12], [70, 20]]) {
      arrow(g, x, y, x + 4, y + 46, 4.4, '#bde9ff', 2.1);
    }
  };
  /* ---------------- Ignis skills ---------------- */
  GLYPHS['skill:ignis:0'] = g => {                                // Fireball
    for (const [r, a] of [[34, 0.35], [42, 0.2]]) ring(g, 30, 58, r, 4, `rgba(251,146,60,${a})`, -0.8, 0.4);
    g.beginPath();
    g.moveTo(16, 76); g.quadraticCurveTo(40, 78, 58, 62);
    g.quadraticCurveTo(46, 78, 30, 82); g.closePath();
    g.fillStyle = 'rgba(251,146,60,0.55)'; g.fill();
    dot(g, 64, 40, 19, '#fb923c');
    g.beginPath(); g.arc(64, 40, 19, 0, T2);
    g.fillStyle = rg(g, 58, 34, 26, [[0, '#fff3c4'], [0.5, '#ffb066'], [1, 'rgba(239,68,68,0.9)']]);
    g.fill();
    ring(g, 64, 40, 19, 2.6, 'rgba(124,45,18,0.6)');
  };
  GLYPHS['skill:ignis:1'] = g => {                                // Blazing Ring
    ring(g, 50, 52, 27, 7, '#f97316');
    ring(g, 50, 52, 27, 3, '#ffd166');
    for (let i = 0; i < 6; i++) {
      rot(g, 50, 52, i / 6 * T2, () => {
        g.beginPath();
        g.moveTo(-5, -27); g.quadraticCurveTo(0, -46, 5, -27);
        g.closePath(); g.fillStyle = '#fb923c'; g.fill();
      });
    }
    dot(g, 50, 52, 8, 'rgba(255,209,102,0.75)');
  };
  GLYPHS['skill:ignis:2'] = g => {                                // Meteor
    // comet tail: flame wedge sweeping in from the top right
    g.beginPath();
    g.moveTo(92, 6);
    g.quadraticCurveTo(66, 16, 50, 38);
    g.quadraticCurveTo(60, 40, 66, 48);
    g.quadraticCurveTo(78, 28, 92, 6);
    g.closePath();
    g.fillStyle = lg(g, 92, 6, 52, 44, [[0, 'rgba(255,209,102,0.2)'], [0.6, 'rgba(251,146,60,0.7)'], [1, '#ef4444']]);
    g.fill();
    g.beginPath(); g.moveTo(80, 22); g.quadraticCurveTo(62, 32, 54, 44);
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,247,214,0.8)'; g.lineCap = 'round'; g.stroke();
    // the rock
    dot(g, 40, 58, 24, '#8a4a2b');
    g.beginPath(); g.arc(40, 58, 24, 0, T2);
    g.fillStyle = rg(g, 32, 50, 36, [[0, '#e09a63'], [1, '#5c2b12']]); g.fill();
    ring(g, 40, 58, 24, 3.4, '#ffb166');
    dot(g, 32, 52, 4, 'rgba(20,10,6,0.55)'); dot(g, 47, 64, 5, 'rgba(20,10,6,0.55)');
    dot(g, 38, 70, 3, 'rgba(20,10,6,0.5)');
    // impact sparks
    for (const [x0, y0, x1, y1] of [[10, 88, 20, 76], [34, 94, 38, 84], [60, 90, 54, 78]]) {
      seg(g, x0, y0, x1, y1, 4.4, 'rgba(255,209,102,0.9)');
    }
  };
  /* ---------------- Grom skills ---------------- */
  GLYPHS['skill:grom:0'] = g => {                                 // Shockwave
    // gauntlet slamming down
    g.fillStyle = lg(g, 38, 10, 62, 44, [[0, '#e2e8f0'], [1, '#7c8ba1']]);
    g.beginPath();
    if (g.roundRect) g.roundRect(36, 10, 28, 32, 7); else g.rect(36, 10, 28, 32);
    g.fill();
    g.lineWidth = 3; g.strokeStyle = '#2f3d55'; g.stroke();
    seg(g, 43, 16, 43, 34, 2.6, 'rgba(47,61,85,0.6)');
    seg(g, 51, 16, 51, 34, 2.6, 'rgba(47,61,85,0.6)');
    seg(g, 59, 16, 59, 34, 2.6, 'rgba(47,61,85,0.6)');
    spark4(g, 50, 52, 13, '#f1f5f9');
    for (const [r, a, w] of [[20, 1, 6], [32, 0.65, 5.5], [44, 0.35, 5]]) {
      ring(g, 50, 50, r, w, `rgba(203,213,225,${a})`, 0.12 * Math.PI, 0.88 * Math.PI);
    }
  };
  GLYPHS['skill:grom:1'] = g => {                                 // Bull Charge
    g.beginPath();
    g.moveTo(24, 32); g.bezierCurveTo(10, 22, 12, 40, 24, 46);
    g.lineWidth = 7; g.strokeStyle = '#cbd5e1'; g.lineCap = 'round'; g.stroke();
    g.beginPath();
    g.moveTo(24, 68); g.bezierCurveTo(10, 78, 12, 60, 24, 54);
    g.lineWidth = 7; g.strokeStyle = '#cbd5e1'; g.stroke();
    arrow(g, 20, 50, 88, 50, 9, '#94a3b8', 2);
    seg(g, 34, 38, 46, 50, 4, 'rgba(226,232,240,0.6)');
    seg(g, 34, 62, 46, 50, 4, 'rgba(226,232,240,0.6)');
  };
  GLYPHS['skill:grom:2'] = g => {                                 // Earthsplitter
    g.beginPath();
    g.moveTo(10, 74); g.lineTo(34, 74); g.lineTo(42, 62); g.lineTo(50, 78);
    g.lineTo(58, 62); g.lineTo(66, 74); g.lineTo(90, 74);
    g.lineWidth = 5.5; g.strokeStyle = '#94a3b8'; g.lineJoin = 'round'; g.stroke();
    path(g, [[42, 62], [50, 40], [58, 62]]);
    g.fillStyle = '#64748b'; g.fill();
    arrow(g, 30, 56, 30, 26, 5, '#cbd5e1', 2);
    arrow(g, 70, 56, 70, 26, 5, '#cbd5e1', 2);
  };
  /* ---------------- Nyx skills ---------------- */
  GLYPHS['skill:nyx:0'] = g => {                                  // Shadow Strike
    for (const [off, a] of [[16, 0.25], [8, 0.5]]) {
      seg(g, 18 + off, 82 - off, 78 + off, 22 - off, 7, `rgba(192,132,252,${a})`);
    }
    seg(g, 14, 86, 78, 22, 8, '#c084fc');
    tri(g, 82, 18, 11, -Math.PI / 4, '#e9d5ff');
  };
  GLYPHS['skill:nyx:1'] = g => {                                  // Fan of Knives
    for (let i = -2; i <= 2; i++) {
      rot(g, 50, 78, i * 0.42, () => {
        blade(g, 0, -34, 42, 11, '#e9d5ff', '#a855f7', 'rgba(46,16,101,0.8)');
      });
    }
  };
  GLYPHS['skill:nyx:2'] = g => {                                  // Deathmark
    ring(g, 50, 50, 30, 3.4, 'rgba(192,132,252,0.55)');
    for (let i = 0; i < 4; i++) {
      rot(g, 50, 50, i / 4 * T2 + Math.PI / 4, () => seg(g, 0, -24, 0, -36, 4.4, '#c084fc'));
    }
    skullMark(g, 50, 48, 15, '#e9d5ff');
  };
  /* ---------------- Sylva skills ---------------- */
  GLYPHS['skill:sylva:0'] = g => {                                // Thorn Volley
    arrow(g, 14, 62, 86, 34, 6, '#4ade80', 2.2);
    leaf(g, 26, 58, Math.PI * 0.75, 18, 6.5, '#bbf7d0', '#34d399');
    path(g, [[44, 50], [50, 38], [52, 50]]); g.fillStyle = '#166534'; g.fill();
    path(g, [[60, 44], [66, 32], [68, 44]]); g.fillStyle = '#166534'; g.fill();
  };
  GLYPHS['skill:sylva:1'] = g => {                                // Healing Bloom
    for (let i = 0; i < 5; i++) {
      rot(g, 50, 50, i / 5 * T2 - Math.PI / 2, () => {
        g.beginPath(); g.ellipse(0, -19, 10, 15, 0, 0, T2);
        g.fillStyle = lg(g, 0, -34, 0, -4, [[0, '#f0fdf4'], [1, '#4ade80']]);
        g.fill();
      });
    }
    dot(g, 50, 50, 10.5, '#fef9c3');
    seg(g, 50, 45, 50, 55, 4.4, '#16a34a'); seg(g, 45, 50, 55, 50, 4.4, '#16a34a');
  };
  GLYPHS['skill:sylva:2'] = g => {                                // Entangling Grove
    seg(g, 16, 84, 84, 84, 4.4, 'rgba(74,222,128,0.5)');
    for (const [x, dir] of [[30, -1], [50, 1], [70, -1]]) {
      g.beginPath();
      g.moveTo(x, 84);
      g.bezierCurveTo(x + 12 * dir, 62, x - 12 * dir, 44, x + 8 * dir, 22);
      g.lineWidth = 6.5; g.strokeStyle = '#22c55e'; g.lineCap = 'round'; g.stroke();
      dot(g, x + 8 * dir, 22, 4, '#bbf7d0');
    }
    ring(g, 50, 52, 24, 3.4, 'rgba(187,247,208,0.65)');
  };
  /* ---------------- Torren skills ---------------- */
  GLYPHS['skill:torren:0'] = g => {                               // Whirling Axe
    ring(g, 50, 50, 38, 5.5, 'rgba(248,113,113,0.6)', -0.15, 1.15);
    ring(g, 50, 50, 38, 5.5, 'rgba(248,113,113,0.6)', Math.PI - 0.15, Math.PI + 1.15);
    tri(g, 82, 73, 10, 1.95, '#fca5a5');
    tri(g, 18, 27, 10, -1.2, '#fca5a5');
    // upright double-bit axe in the eye of the spin
    g.fillStyle = lg(g, -3, 0, 3, 0, [[0, '#a16b45'], [1, '#6b4226']]);
    g.fillRect(46.5, 34, 7, 46);
    g.lineWidth = 1.6; g.strokeStyle = '#3f2413'; g.strokeRect(46.5, 34, 7, 46);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(50 + s * 4, 30);
      g.bezierCurveTo(50 + s * 27, 20, 50 + s * 34, 40, 50 + s * 24, 54);
      g.bezierCurveTo(50 + s * 16, 46, 50 + s * 8, 44, 50 + s * 4, 45);
      g.closePath();
      g.fillStyle = lg(g, 50, 18, 50, 54, [[0, '#fca5a5'], [0.55, '#ef4444'], [1, '#b91c1c']]);
      g.fill();
      g.lineWidth = 2.2; g.strokeStyle = '#7f1d1d'; g.stroke();
    }
    dot(g, 50, 30, 4, '#fde68a');
  };
  GLYPHS['skill:torren:1'] = g => {                               // War Leap
    g.beginPath(); g.moveTo(16, 34); g.quadraticCurveTo(52, 2, 72, 52);
    g.lineWidth = 5.5; g.strokeStyle = 'rgba(248,113,113,0.85)';
    g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]);
    tri(g, 73, 56, 10, Math.PI * 0.42, '#fca5a5');
    g.beginPath(); g.ellipse(68, 76, 24, 8, 0, 0, T2);
    g.lineWidth = 4; g.strokeStyle = '#f87171'; g.stroke();
    g.beginPath(); g.ellipse(68, 76, 13, 4.4, 0, 0, T2);
    g.fillStyle = 'rgba(248,113,113,0.4)'; g.fill();
  };
  GLYPHS['skill:torren:2'] = g => {                               // Rampage
    ring(g, 50, 56, 34, 4, 'rgba(248,113,113,0.4)', Math.PI * 1.1, Math.PI * 1.9);
    ring(g, 50, 60, 42, 4, 'rgba(248,113,113,0.25)', Math.PI * 1.15, Math.PI * 1.85);
    chevron(g, 50, 66, 17, 15, 8, '#dc2626');
    chevron(g, 50, 48, 17, 15, 8, '#ef4444');
    chevron(g, 50, 30, 17, 15, 8, '#fca5a5');
  };
  /* ---------------- Mira skills ---------------- */
  GLYPHS['skill:mira:0'] = g => {                                 // Frost Shard
    seg(g, 14, 62, 30, 58, 4, 'rgba(147,197,253,0.5)');
    seg(g, 12, 48, 26, 48, 4, 'rgba(147,197,253,0.35)');
    rot(g, 56, 48, 0.18, () => {
      path(g, [[-34, 0], [-10, -11], [34, -4], [42, 0], [34, 4], [-10, 11]]);
      g.fillStyle = lg(g, -30, 0, 40, 0, [[0, '#eff6ff'], [0.5, '#bfdbfe'], [1, '#60a5fa']]);
      g.fill();
      g.lineWidth = 2.4; g.strokeStyle = 'rgba(30,64,175,0.65)'; g.stroke();
      seg(g, -8, -4, 22, -1, 1.8, 'rgba(255,255,255,0.8)');
    });
  };
  GLYPHS['skill:mira:1'] = g => {                                 // Ice Nova
    ring(g, 50, 50, 27, 6, '#93c5fd');
    for (let i = 0; i < 8; i++) {
      rot(g, 50, 50, i / 8 * T2, () => {
        path(g, [[-4.4, -27], [0, -42], [4.4, -27]]);
        g.fillStyle = '#bfdbfe'; g.fill();
      });
    }
    gem(g, 50, 50, 11, '#ffffff', '#bfdbfe', '#3b82f6');
  };
  GLYPHS['skill:mira:2'] = g => {                                 // Glacial Prison
    path(g, [[50, 10], [82, 28], [82, 66], [50, 84], [18, 66], [18, 28]]);
    g.fillStyle = lg(g, 20, 12, 80, 84, [[0, 'rgba(239,246,255,0.95)'], [0.5, 'rgba(147,197,253,0.9)'], [1, 'rgba(59,130,246,0.9)']]);
    g.fill();
    g.lineWidth = 3.4; g.strokeStyle = '#1d4ed8'; g.stroke();
    seg(g, 50, 10, 50, 84, 2, 'rgba(255,255,255,0.65)');
    seg(g, 18, 28, 82, 66, 2, 'rgba(255,255,255,0.45)');
    seg(g, 82, 28, 18, 66, 2, 'rgba(255,255,255,0.45)');
    skullMark(g, 50, 46, 11, 'rgba(30,58,138,0.85)');
  };
  /* ---------------- Karn skills ---------------- */
  GLYPHS['skill:karn:0'] = g => {                                 // Chain Hook
    for (const [x, y] of [[18, 38], [32, 44], [46, 50]]) {
      rot(g, x, y, 0.42, () => {
        g.beginPath(); g.ellipse(0, 0, 8, 5.2, 0, 0, T2);
        g.lineWidth = 4, g.strokeStyle = '#b45309'; g.stroke();
        g.beginPath(); g.ellipse(0, 0, 8, 5.2, 0, 0, T2);
        g.lineWidth = 1.8, g.strokeStyle = '#fde68a'; g.stroke();
      });
    }
    g.beginPath();
    g.moveTo(52, 52);
    g.bezierCurveTo(76, 60, 82, 42, 70, 30);
    g.bezierCurveTo(62, 22, 52, 26, 50, 34);
    g.lineWidth = 8.5; g.strokeStyle = '#b45309'; g.lineCap = 'round'; g.stroke();
    g.beginPath();
    g.moveTo(52, 52);
    g.bezierCurveTo(76, 60, 82, 42, 70, 30);
    g.bezierCurveTo(62, 22, 52, 26, 50, 34);
    g.lineWidth = 4; g.strokeStyle = '#fbbf24'; g.stroke();
    tri(g, 50, 36, 9, Math.PI * 0.78, '#fbbf24');
  };
  GLYPHS['skill:karn:1'] = g => {                                 // Iron Slam
    g.fillStyle = lg(g, 30, 20, 70, 44, [[0, '#fde68a'], [0.5, '#f59e0b'], [1, '#92400e']]);
    g.beginPath();
    if (g.roundRect) g.roundRect(28, 18, 44, 27, 6); else g.rect(28, 18, 44, 27);
    g.fill();
    g.lineWidth = 3; g.strokeStyle = '#78350f'; g.stroke();
    g.fillStyle = '#8a5a3b'; g.fillRect(46, 45, 8, 25);
    for (const [r, a] of [[16, 0.9], [26, 0.55], [36, 0.3]]) {
      ring(g, 50, 78, r, 4.4, `rgba(251,191,36,${a})`, Math.PI * 1.08, Math.PI * 1.92);
    }
  };
  GLYPHS['skill:karn:2'] = g => {                                 // Groundbreaker
    for (let i = 0; i < 6; i++) {
      rot(g, 50, 52, i / 6 * T2 + 0.26, () => {
        g.beginPath(); g.moveTo(0, -12);
        g.lineTo(-4, -22); g.lineTo(2, -30); g.lineTo(-2, -40);
        g.lineWidth = 4; g.strokeStyle = '#f59e0b'; g.lineJoin = 'round'; g.stroke();
      });
    }
    for (let i = 0; i < 3; i++) {
      rot(g, 50, 52, i / 3 * T2 + Math.PI / 6, () => tri(g, 0, -44, 7.5, -Math.PI / 2, '#fde68a'));
    }
    dot(g, 50, 52, 12, '#b45309');
    ring(g, 50, 52, 12, 3.4, '#fde68a');
  };

  /* ---------------- new roster portraits ---------------- */
  GLYPHS['hero:vesper'] = g => {
    rot(g, 38, 58, -0.5, () => { g.fillStyle = '#78350f'; g.fillRect(-4, -6, 8, 28); path(g, [[-10, -8], [10, -8], [8, 8], [-8, 8]]); g.fillStyle = '#f4bf4f'; g.fill(); });
    rot(g, 62, 50, 0.35, () => { g.fillStyle = '#78350f'; g.fillRect(-4, -6, 8, 28); path(g, [[-10, -8], [10, -8], [8, 8], [-8, 8]]); g.fillStyle = '#ffe08a'; g.fill(); });
    spark4(g, 78, 28, 6, '#fff7d6');
  };
  GLYPHS['hero:quill'] = g => {
    ring(g, 50, 50, 28, 4, '#c4b581');
    for (let i = 0; i < 8; i++) rot(g, 50, 50, i / 8 * T2, () => tri(g, 0, -30, 6, -Math.PI / 2, '#e7d9a8'));
    dot(g, 50, 50, 8, '#78716c');
  };
  GLYPHS['hero:lumen'] = g => {
    ring(g, 50, 50, 16, 3, '#9ab6e8');
    for (let i = 0; i < 12; i++) rot(g, 50, 50, i / 12 * T2, () => seg(g, 0, -18, 0, -42, i % 2 ? 2 : 3.4, i % 2 ? 'rgba(219,231,255,0.5)' : '#e8f0ff'));
    dot(g, 50, 50, 6, '#ffffff');
  };
  GLYPHS['hero:volt'] = g => {
    path(g, [[42, 8], [62, 8], [48, 42], [68, 42], [36, 92], [46, 52], [28, 52]]);
    g.fillStyle = lg(g, 30, 8, 50, 92, [[0, '#fef9c3'], [1, '#eab308']]); g.fill();
    g.lineWidth = 2.4; g.strokeStyle = '#854d0e'; g.stroke();
  };
  GLYPHS['hero:nadir'] = g => {
    ring(g, 50, 50, 34, 4, '#7c3aed');
    ring(g, 50, 50, 22, 3, '#c4b5fd');
    dot(g, 50, 50, 10, '#2e1065');
    spark4(g, 50, 50, 5, '#ede9fe');
  };
  GLYPHS['hero:ashara'] = g => {
    g.beginPath(); g.moveTo(16, 78); g.quadraticCurveTo(50, 20, 84, 78); g.closePath();
    g.fillStyle = lg(g, 50, 24, 50, 78, [[0, '#f5d76e'], [1, '#b45309']]); g.fill();
    for (const x of [34, 50, 66]) { g.beginPath(); g.moveTo(x, 78); g.quadraticCurveTo(x + 6, 58, x - 4, 46); g.lineWidth = 3; g.strokeStyle = 'rgba(120,53,15,0.5)'; g.stroke(); }
  };
  GLYPHS['hero:hexa'] = g => {
    gem(g, 50, 48, 22, '#ede9fe', '#a78bfa', '#6d28d9');
    ring(g, 50, 48, 30, 2.4, 'rgba(167,139,250,0.55)');
    for (let i = 0; i < 3; i++) rot(g, 50, 48, i / 3 * T2, () => spark4(g, 0, -34, 4, '#ddd6fe'));
  };
  GLYPHS['hero:wraith'] = g => {
    g.globalAlpha = 0.35; g.beginPath(); g.ellipse(38, 58, 16, 28, -0.3, 0, T2); g.fillStyle = '#94a3b8'; g.fill();
    g.globalAlpha = 1; g.beginPath(); g.ellipse(54, 52, 18, 32, 0.15, 0, T2); g.fillStyle = lg(g, 40, 20, 70, 84, [[0, '#e2e8f0'], [1, '#475569']]); g.fill();
    dot(g, 48, 40, 3, '#0f172a'); dot(g, 60, 40, 3, '#0f172a');
  };
  GLYPHS['hero:sable'] = g => {
    path(g, [[50, 12], [62, 40], [88, 48], [62, 56], [50, 88], [38, 56], [12, 48], [38, 40]]);
    g.fillStyle = lg(g, 20, 12, 80, 88, [[0, '#86efac'], [1, '#166534']]); g.fill();
    g.lineWidth = 2.4; g.strokeStyle = '#14532d'; g.stroke();
    dot(g, 50, 48, 6, '#bbf7d0');
  };
  GLYPHS['hero:rook'] = g => {
    path(g, [[50, 14], [70, 38], [62, 38], [78, 70], [50, 54], [22, 70], [38, 38], [30, 38]]);
    g.fillStyle = lg(g, 50, 14, 50, 70, [[0, '#fecdd3'], [1, '#e11d48']]); g.fill();
    g.lineWidth = 2.2; g.strokeStyle = '#9f1239'; g.stroke();
    tri(g, 50, 78, 8, Math.PI / 2, '#fb7185');
  };
  GLYPHS['hero:brass'] = g => {
    g.beginPath(); g.arc(50, 50, 32, 0.15 * Math.PI, 1.85 * Math.PI); g.lineWidth = 10; g.strokeStyle = '#b45309'; g.stroke();
    g.beginPath(); g.arc(50, 50, 32, 0.15 * Math.PI, 1.85 * Math.PI); g.lineWidth = 5; g.strokeStyle = '#fbbf24'; g.stroke();
    dot(g, 50, 50, 10, '#fde68a');
  };
  GLYPHS['hero:omen'] = g => {
    rot(g, 40, 52, -0.5, () => blade(g, 0, 0, 54, 12, '#e2e8f0', '#64748b', '#0f172a'));
    rot(g, 62, 52, 0.5, () => blade(g, 0, 0, 54, 12, '#f8fafc', '#94a3b8', '#0f172a'));
  };
  GLYPHS['hero:tide'] = g => {
    for (const [y, a] of [[34, 1], [50, 0.75], [66, 0.5]]) {
      g.beginPath(); g.moveTo(14, y); g.quadraticCurveTo(32, y - 12, 50, y); g.quadraticCurveTo(68, y + 12, 86, y);
      g.lineWidth = 5; g.strokeStyle = `rgba(14,165,233,${a})`; g.lineCap = 'round'; g.stroke();
    }
  };
  GLYPHS['hero:cinder'] = g => {
    path(g, [[32, 78], [38, 40], [50, 18], [62, 40], [68, 78], [50, 70]]);
    g.fillStyle = lg(g, 50, 18, 50, 78, [[0, '#fed7aa'], [0.5, '#ea580c'], [1, '#7c2d12']]); g.fill();
    spark4(g, 50, 22, 8, '#ffedd5');
  };
  GLYPHS['hero:bastion'] = g => {
    path(g, [[22, 78], [22, 42], [38, 28], [50, 18], [62, 28], [78, 42], [78, 78]]);
    g.fillStyle = lg(g, 22, 18, 78, 78, [[0, '#d6d3d1'], [1, '#44403c']]); g.fill();
    g.lineWidth = 3; g.strokeStyle = '#1c1917'; g.stroke();
    g.fillStyle = '#292524'; g.fillRect(42, 48, 16, 30);
  };
  GLYPHS['hero:marrow'] = g => {
    g.fillStyle = '#e7e5e4'; g.fillRect(44, 18, 12, 64);
    g.beginPath(); g.ellipse(50, 22, 16, 10, 0, 0, T2); g.fill();
    g.beginPath(); g.ellipse(50, 78, 14, 8, 0, 0, T2); g.fill();
    for (const y of [38, 52, 66]) { g.fillRect(28, y, 16, 6); g.fillRect(56, y, 16, 6); }
    g.lineWidth = 2.4; g.strokeStyle = '#a8a29e'; g.strokeRect(44, 18, 12, 64);
  };
  GLYPHS['hero:anchor'] = g => {
    ring(g, 50, 28, 14, 7, '#1d4e89');
    ring(g, 50, 28, 14, 3, '#60a5fa');
    g.fillStyle = '#1d4e89'; g.fillRect(46, 40, 8, 28);
    path(g, [[28, 62], [50, 78], [72, 62], [64, 62], [50, 72], [36, 62]]); g.fill();
  };
  GLYPHS['hero:bell'] = g => {
    path(g, [[50, 18], [78, 36], [72, 70], [50, 84], [28, 70], [22, 36]]);
    g.fillStyle = lg(g, 30, 18, 70, 84, [[0, '#fdf4ff'], [1, '#d946ef']]); g.fill();
    g.lineWidth = 3; g.strokeStyle = '#86198f'; g.stroke();
    dot(g, 50, 88, 5, '#f5d0fe');
  };
  GLYPHS['hero:wick'] = g => {
    g.fillStyle = '#92400e'; g.fillRect(44, 48, 12, 36);
    g.beginPath(); g.ellipse(50, 48, 18, 8, 0, 0, T2); g.fillStyle = '#b45309'; g.fill();
    g.beginPath(); g.moveTo(50, 12); g.quadraticCurveTo(66, 32, 50, 48); g.quadraticCurveTo(34, 32, 50, 12);
    g.fillStyle = lg(g, 50, 12, 50, 48, [[0, '#fffbeb'], [1, '#f59e0b']]); g.fill();
  };
  GLYPHS['hero:pact'] = g => {
    g.beginPath(); g.moveTo(50, 86); g.bezierCurveTo(18, 58, 22, 28, 50, 36); g.bezierCurveTo(78, 28, 82, 58, 50, 86);
    g.fillStyle = lg(g, 50, 28, 50, 86, [[0, '#fb7185'], [1, '#9f1239']]); g.fill();
    g.lineWidth = 2.6; g.strokeStyle = '#4c0519'; g.stroke();
    spark4(g, 50, 48, 6, '#fecdd3');
  };

  const passRing = (g, c) => ring(g, 50, 50, 30, 5, c);
  GLYPHS['passive:vesper'] = g => { passRing(g, '#f4bf4f'); for (const a of [-0.4, 0.15, 0.7, 1.3]) rot(g, 50, 50, a, () => tri(g, 22, 0, 5, 0, '#ffe08a')); };
  GLYPHS['passive:quill'] = g => { for (let i = 0; i < 6; i++) rot(g, 50, 50, i / 6 * T2, () => tri(g, 0, -24, 7, -Math.PI / 2, '#c4b581')); dot(g, 50, 50, 8, '#78716c'); };
  GLYPHS['passive:lumen'] = g => { ring(g, 50, 50, 12, 3, '#9ab6e8'); for (let i = 0; i < 8; i++) rot(g, 50, 50, i / 8 * T2, () => seg(g, 0, -16, 0, -36, 3, '#dbe7ff')); };
  GLYPHS['passive:volt'] = g => { path(g, [[46, 16], [60, 16], [50, 46], [64, 46], [38, 84], [46, 54], [32, 54]]); g.fillStyle = '#fde047'; g.fill(); };
  GLYPHS['passive:nadir'] = g => { ring(g, 50, 50, 28, 4, '#7c3aed'); dot(g, 50, 50, 12, '#2e1065'); };
  GLYPHS['passive:ashara'] = g => { chevron(g, 50, 36, 18, 14, 6, '#d4a017'); chevron(g, 50, 58, 18, 14, 6, '#b45309'); };
  GLYPHS['passive:hexa'] = g => { gem(g, 50, 50, 18, '#ede9fe', '#a78bfa', '#5b21b6'); };
  GLYPHS['passive:wraith'] = g => { chevron(g, 42, 50, 14, 22, 6, 'rgba(148,163,184,0.5)', 0); chevron(g, 58, 50, 14, 22, 6, '#cbd5e1', 0); };
  GLYPHS['passive:sable'] = g => { path(g, [[50, 18], [62, 50], [50, 82], [38, 50]]); g.fillStyle = '#16a34a'; g.fill(); dot(g, 50, 50, 5, '#bbf7d0'); };
  GLYPHS['passive:rook'] = g => { tri(g, 50, 28, 16, -Math.PI / 2, '#fb7185'); arrow(g, 50, 40, 50, 82, 6, '#e11d48', 2); };
  GLYPHS['passive:brass'] = g => { ring(g, 50, 50, 26, 10, '#d97706'); ring(g, 50, 50, 26, 4, '#fde68a'); };
  GLYPHS['passive:omen'] = g => { for (let i = 0; i < 8; i++) rot(g, 50, 50, i / 8 * T2, () => chevron(g, 0, -22, 6, 8, 3, '#94a3b8')); };
  GLYPHS['passive:tide'] = g => { g.beginPath(); g.moveTo(18, 60); g.quadraticCurveTo(50, 20, 82, 60); g.lineWidth = 6; g.strokeStyle = '#0ea5e9'; g.stroke(); };
  GLYPHS['passive:cinder'] = g => { dot(g, 50, 58, 16, '#ea580c'); spark4(g, 50, 32, 10, '#fdba74'); };
  GLYPHS['passive:bastion'] = g => { path(g, [[50, 16], [76, 30], [76, 62], [50, 84], [24, 62], [24, 30]]); g.lineWidth = 5; g.strokeStyle = '#78716c'; g.stroke(); };
  GLYPHS['passive:marrow'] = g => { g.fillStyle = '#e7e5e4'; g.fillRect(46, 20, 8, 60); g.fillRect(28, 40, 44, 8); };
  GLYPHS['passive:anchor'] = g => { ring(g, 50, 32, 12, 6, '#1d4e89'); g.fillStyle = '#1d4e89'; g.fillRect(47, 42, 6, 24); path(g, [[32, 62], [50, 78], [68, 62]]); g.fill(); };
  GLYPHS['passive:bell'] = g => { for (const y of [32, 50, 68]) { g.beginPath(); g.moveTo(24, y); g.quadraticCurveTo(50, y - 10, 76, y); g.lineWidth = 4; g.strokeStyle = '#e879f9'; g.stroke(); } };
  GLYPHS['passive:wick'] = g => { path(g, [[36, 70], [50, 22], [64, 70]]); g.fillStyle = '#fcd34d'; g.fill(); g.fillStyle = '#92400e'; g.fillRect(46, 70, 8, 12); };
  GLYPHS['passive:pact'] = g => { g.beginPath(); g.moveTo(50, 78); g.bezierCurveTo(24, 54, 28, 30, 50, 38); g.bezierCurveTo(72, 30, 76, 54, 50, 78); g.fillStyle = '#9f1239'; g.fill(); };

  const shot = (g, c) => arrow(g, 12, 50, 88, 50, 6, c, 2.1);
  GLYPHS['skill:vesper:0'] = g => { arrow(g, 12, 42, 88, 42, 5, '#f4bf4f', 2); arrow(g, 12, 58, 88, 58, 5, '#ffe08a', 2); };
  GLYPHS['skill:vesper:1'] = g => { g.beginPath(); g.moveTo(20, 70); g.quadraticCurveTo(50, 20, 80, 50); g.setLineDash([8, 6]); g.lineWidth = 4; g.strokeStyle = '#f4bf4f'; g.stroke(); g.setLineDash([]); };
  GLYPHS['skill:vesper:2'] = g => { for (const y of [28, 50, 72]) shot(g, y === 50 ? '#f4bf4f' : 'rgba(244,191,79,0.5)'); };
  GLYPHS['skill:quill:0'] = g => { for (let i = 0; i < 7; i++) rot(g, 50, 62, i / 7 * T2, () => tri(g, 0, -18, 5, -Math.PI / 2, '#c4b581')); };
  GLYPHS['skill:quill:1'] = g => { ring(g, 58, 42, 16, 4, '#e7d9a8'); seg(g, 18, 70, 46, 50, 4, '#c4b581'); };
  GLYPHS['skill:quill:2'] = g => { ring(g, 50, 50, 28, 4, '#c4b581'); for (let i = 0; i < 6; i++) rot(g, 50, 50, i / 6 * T2, () => tri(g, 0, -28, 5, -Math.PI / 2, '#e7d9a8')); };
  GLYPHS['skill:lumen:0'] = g => { seg(g, 10, 50, 90, 50, 6, '#9ab6e8'); spark4(g, 78, 50, 8, '#ffffff'); };
  GLYPHS['skill:lumen:1'] = g => { chevron(g, 40, 50, 12, 18, 5, '#9ab6e8', 0); chevron(g, 62, 50, 12, 18, 5, '#dbe7ff', 0); };
  GLYPHS['skill:lumen:2'] = g => { ring(g, 28, 50, 10, 3, '#9ab6e8'); seg(g, 38, 50, 90, 50, 5, '#e8f0ff'); };
  GLYPHS['skill:volt:0'] = g => { path(g, [[16, 30], [40, 30], [30, 52], [54, 52], [22, 82], [36, 56], [18, 56]]); g.fillStyle = '#fde047'; g.fill(); };
  GLYPHS['skill:volt:1'] = g => { ring(g, 50, 50, 26, 5, '#eab308'); for (let i = 0; i < 6; i++) rot(g, 50, 50, i / 6 * T2, () => path(g, [[-4, -26], [0, -40], [4, -26]]) || (g.fillStyle = '#fde047', g.fill())); };
  GLYPHS['skill:volt:2'] = g => { ring(g, 50, 42, 22, 4, '#facc15'); for (const [x, y] of [[30, 70], [50, 78], [70, 70]]) tri(g, x, y, 6, Math.PI / 2, '#fde047'); };
  GLYPHS['skill:nadir:0'] = g => { ring(g, 62, 40, 16, 4, '#7c3aed'); dot(g, 62, 40, 7, '#2e1065'); };
  GLYPHS['skill:nadir:1'] = g => { for (let i = 0; i < 6; i++) rot(g, 50, 50, i / 6 * T2, () => arrow(g, 0, -34, 0, -14, 4, '#a78bfa', 1.6)); dot(g, 50, 50, 8, '#5b21b6'); };
  GLYPHS['skill:nadir:2'] = g => { ring(g, 50, 50, 30, 5, '#7c3aed'); ring(g, 50, 50, 16, 4, '#c4b5fd'); };
  GLYPHS['skill:ashara:0'] = g => { shot(g, '#d4a017'); };
  GLYPHS['skill:ashara:1'] = g => { ring(g, 50, 50, 28, 6, '#d4a017'); };
  GLYPHS['skill:ashara:2'] = g => { g.beginPath(); g.ellipse(50, 70, 28, 10, 0, 0, T2); g.strokeStyle = '#b45309'; g.lineWidth = 4; g.stroke(); g.beginPath(); g.moveTo(36, 70); g.quadraticCurveTo(50, 30, 64, 70); g.strokeStyle = '#f5d76e'; g.stroke(); };
  GLYPHS['skill:hexa:0'] = g => { gem(g, 62, 42, 12, '#fff', '#a78bfa', '#6d28d9'); shot(g, '#c4b5fd'); };
  GLYPHS['skill:hexa:1'] = g => { ring(g, 50, 50, 24, 5, '#a78bfa'); gem(g, 50, 50, 10, '#ede9fe', '#a78bfa', '#6d28d9'); };
  GLYPHS['skill:hexa:2'] = g => { for (let i = 3; i >= 0; i--) { ring(g, 50, 50, 12 + i * 7, 3, `rgba(167,139,250,${0.3 + i * 0.15})`); } };
  GLYPHS['skill:wraith:0'] = g => { seg(g, 18, 78, 78, 22, 7, '#64748b'); tri(g, 82, 18, 9, -Math.PI / 4, '#cbd5e1'); };
  GLYPHS['skill:wraith:1'] = g => { for (let i = -1; i <= 1; i++) rot(g, 50, 60, i * 0.4, () => blade(g, 0, -20, 36, 8, '#e2e8f0', '#64748b', '#0f172a')); };
  GLYPHS['skill:wraith:2'] = g => { skullMark(g, 50, 50, 16, '#cbd5e1'); };
  GLYPHS['skill:sable:0'] = g => { shot(g, '#16a34a'); };
  GLYPHS['skill:sable:1'] = g => { arrow(g, 18, 70, 82, 30, 6, '#22c55e', 2); };
  GLYPHS['skill:sable:2'] = g => { g.beginPath(); g.moveTo(50, 78); g.bezierCurveTo(24, 54, 30, 28, 50, 36); g.bezierCurveTo(70, 28, 76, 54, 50, 78); g.fillStyle = '#16a34a'; g.fill(); };
  GLYPHS['skill:rook:0'] = g => { arrow(g, 50, 18, 50, 82, 7, '#fb7185', 2); };
  GLYPHS['skill:rook:1'] = g => { for (let i = -2; i <= 2; i++) rot(g, 50, 70, i * 0.35, () => blade(g, 0, -28, 34, 8, '#fecdd3', '#e11d48', '#9f1239')); };
  GLYPHS['skill:rook:2'] = g => { path(g, [[50, 12], [66, 40], [50, 32], [34, 40]]); g.fillStyle = '#fb7185'; g.fill(); spark4(g, 50, 70, 12, '#fecdd3'); };
  GLYPHS['skill:brass:0'] = g => { ring(g, 50, 50, 26, 10, '#d97706'); };
  GLYPHS['skill:brass:1'] = g => { arrow(g, 16, 50, 84, 50, 8, '#fbbf24', 2); };
  GLYPHS['skill:brass:2'] = g => { path(g, [[50, 16], [78, 32], [78, 68], [50, 84], [22, 68], [22, 32]]); g.lineWidth = 5; g.strokeStyle = '#d97706'; g.stroke(); };
  GLYPHS['skill:omen:0'] = g => { rot(g, 50, 50, 0.4, () => blade(g, 0, 0, 50, 10, '#e2e8f0', '#64748b', '#0f172a')); rot(g, 50, 50, -0.4, () => blade(g, 0, 0, 50, 10, '#f8fafc', '#94a3b8', '#0f172a')); };
  GLYPHS['skill:omen:1'] = g => { arrow(g, 16, 62, 84, 38, 6, '#94a3b8', 2); };
  GLYPHS['skill:omen:2'] = g => { arrow(g, 14, 70, 86, 30, 8, '#e2e8f0', 2.2); tri(g, 50, 50, 8, -0.5, '#64748b'); };
  GLYPHS['skill:tide:0'] = g => { g.beginPath(); g.moveTo(12, 60); g.quadraticCurveTo(40, 20, 88, 50); g.lineWidth = 8; g.strokeStyle = '#0ea5e9'; g.stroke(); };
  GLYPHS['skill:tide:1'] = g => { ring(g, 50, 50, 28, 6, '#38bdf8'); };
  GLYPHS['skill:tide:2'] = g => { for (const [y, a] of [[40, 1], [58, 0.6], [74, 0.35]]) { g.beginPath(); g.ellipse(50, y, 30, 8, 0, 0, T2); g.strokeStyle = `rgba(14,165,233,${a})`; g.lineWidth = 4; g.stroke(); } };
  GLYPHS['skill:cinder:0'] = g => { path(g, [[30, 70], [42, 36], [50, 20], [58, 36], [70, 70]]); g.fillStyle = '#ea580c'; g.fill(); };
  GLYPHS['skill:cinder:1'] = g => { g.beginPath(); g.moveTo(18, 30); g.quadraticCurveTo(50, 10, 70, 60); g.setLineDash([8, 6]); g.lineWidth = 4; g.strokeStyle = '#ea580c'; g.stroke(); g.setLineDash([]); g.beginPath(); g.ellipse(70, 72, 16, 6, 0, 0, T2); g.stroke(); };
  GLYPHS['skill:cinder:2'] = g => { ring(g, 50, 58, 22, 5, '#ea580c'); spark4(g, 50, 28, 10, '#fdba74'); };
  GLYPHS['skill:bastion:0'] = g => { g.fillStyle = '#78716c'; g.fillRect(22, 30, 56, 12); g.fillRect(28, 42, 8, 32); g.fillRect(64, 42, 8, 32); };
  GLYPHS['skill:bastion:1'] = g => {                                 // Gatehouse: a raised gate that eats arrows
    g.fillStyle = '#78716c'; g.fillRect(18, 26, 10, 54); g.fillRect(72, 26, 10, 54); g.fillRect(18, 20, 64, 10);
    for (let x = 34; x <= 66; x += 8) { g.fillStyle = '#a8a29e'; g.fillRect(x - 2, 30, 4, 46); }
    seg(g, 6, 58, 30, 52, 4, '#d6d3d1'); spark4(g, 32, 52, 6, '#fafaf9');
  };
  GLYPHS['skill:bastion:2'] = g => { path(g, [[50, 14], [82, 32], [82, 68], [50, 86], [18, 68], [18, 32]]); g.lineWidth = 4; g.strokeStyle = '#78716c'; g.stroke(); g.fillStyle = 'rgba(120,113,108,0.3)'; g.fill(); };
  GLYPHS['skill:marrow:0'] = g => { for (let i = -2; i <= 2; i++) rot(g, 50, 70, i * 0.32, () => { g.fillStyle = '#e7e5e4'; g.fillRect(-3, -40, 6, 36); }); };
  GLYPHS['skill:marrow:1'] = g => { g.fillStyle = '#e7e5e4'; g.fillRect(46, 22, 8, 40); g.fillRect(30, 48, 40, 8); spark4(g, 50, 22, 7, '#fafaf9'); };
  GLYPHS['skill:marrow:2'] = g => { g.beginPath(); g.moveTo(14, 74); g.lineTo(36, 74); g.lineTo(50, 40); g.lineTo(64, 74); g.lineTo(86, 74); g.lineWidth = 5; g.strokeStyle = '#d6d3d1'; g.stroke(); };
  GLYPHS['skill:anchor:0'] = g => { seg(g, 16, 62, 70, 40, 5, '#1d4e89'); ring(g, 74, 36, 10, 5, '#60a5fa'); };
  GLYPHS['skill:anchor:1'] = g => {                                  // Weigh Anchor: planted, flukes in the ground
    ring(g, 50, 22, 8, 5, '#1d4e89');
    g.fillStyle = '#1d4e89'; g.fillRect(47, 30, 6, 40); g.fillRect(34, 40, 32, 5);
    path(g, [[26, 56], [50, 76], [74, 56]], false); g.lineWidth = 6; g.strokeStyle = '#1d4e89'; g.lineCap = 'round'; g.stroke();
    seg(g, 12, 84, 88, 84, 5, '#60a5fa');
  };
  GLYPHS['skill:anchor:2'] = g => { ring(g, 50, 50, 30, 6, '#1d4e89'); ring(g, 50, 50, 16, 4, '#60a5fa'); };
  GLYPHS['skill:bell:0'] = g => { g.beginPath(); g.moveTo(16, 60); g.quadraticCurveTo(50, 20, 84, 50); g.lineWidth = 5; g.strokeStyle = '#e879f9'; g.stroke(); };
  GLYPHS['skill:bell:1'] = g => { path(g, [[50, 20], [72, 40], [66, 70], [50, 82], [34, 70], [28, 40]]); g.fillStyle = '#f5d0fe'; g.fill(); spark4(g, 50, 48, 8, '#ffffff'); };
  GLYPHS['skill:bell:2'] = g => { path(g, [[50, 16], [74, 36], [68, 68], [50, 84], [32, 68], [26, 36]]); g.fillStyle = '#d946ef'; g.fill(); skullMark(g, 50, 48, 10, 'rgba(88,28,135,0.8)'); };
  GLYPHS['skill:wick:0'] = g => { spark4(g, 68, 36, 16, '#fcd34d'); shot(g, '#f59e0b'); };
  GLYPHS['skill:wick:1'] = g => { for (let i = 0; i < 6; i++) rot(g, 50, 50, i / 6 * T2, () => spark4(g, 0, -24, 6, '#fde68a')); dot(g, 50, 50, 10, '#f59e0b'); };
  GLYPHS['skill:wick:2'] = g => { ring(g, 50, 50, 26, 4, '#fcd34d'); g.fillStyle = '#92400e'; g.fillRect(46, 46, 8, 28); spark4(g, 50, 32, 8, '#fffbeb'); };
  GLYPHS['skill:pact:0'] = g => { shot(g, '#9f1239'); };
  GLYPHS['skill:pact:1'] = g => { g.beginPath(); g.moveTo(50, 78); g.bezierCurveTo(22, 52, 28, 26, 50, 34); g.bezierCurveTo(72, 26, 78, 52, 50, 78); g.fillStyle = '#fb7185'; g.fill(); };
  GLYPHS['skill:pact:2'] = g => { ring(g, 50, 50, 28, 5, '#9f1239'); skullMark(g, 50, 50, 12, '#fb7185'); };

  /* ---------------- battle spells ---------------- */
  GLYPHS['spell:flicker'] = g => {
    ring(g, 26, 60, 13, 3.4, 'rgba(167,139,250,0.5)');
    spark4(g, 66, 38, 26, '#c4b5fd');
    spark4(g, 66, 38, 12, '#ede9fe');
    arrow(g, 34, 56, 52, 46, 4.4, 'rgba(196,181,253,0.8)', 2);
  };
  GLYPHS['spell:execute'] = g => {
    path(g, [[58, 8], [30, 50], [46, 50], [38, 88], [72, 40], [54, 40]]);
    g.fillStyle = lg(g, 40, 8, 60, 88, [[0, '#fecaca'], [1, '#dc2626']]);
    g.fill();
    g.lineWidth = 2.4; g.strokeStyle = 'rgba(80,7,36,0.7)'; g.stroke();
  };
  GLYPHS['spell:retribution'] = g => {
    for (const x of [30, 48, 66]) {
      g.beginPath();
      g.moveTo(x, 14); g.quadraticCurveTo(x - 16, 50, x - 2, 86);
      g.lineWidth = 8; g.strokeStyle = '#f59e0b'; g.lineCap = 'round'; g.stroke();
      g.beginPath();
      g.moveTo(x, 14); g.quadraticCurveTo(x - 16, 50, x - 2, 86);
      g.lineWidth = 3.4; g.strokeStyle = '#fef3c7'; g.stroke();
    }
  };
  GLYPHS['spell:sprint'] = g => {
    chevron(g, 36, 50, 15, 30, 9, 'rgba(110,231,160,0.5)', 0);
    chevron(g, 54, 50, 15, 30, 9, 'rgba(110,231,160,0.8)', 0);
    chevron(g, 72, 50, 15, 30, 9, '#6ee7a0', 0);
  };
  GLYPHS['spell:purify'] = g => {
    for (let i = 0; i < 8; i++) {
      rot(g, 50, 50, i / 8 * T2, () => seg(g, 0, -20, 0, -37, 5, i % 2 ? '#fef9c3' : '#fde047'));
    }
    dot(g, 50, 50, 13, '#fefce8');
    ring(g, 50, 50, 13, 3, '#eab308');
  };
  GLYPHS['spell:inspire'] = g => {
    ring(g, 50, 50, 34, 4, 'rgba(251,191,36,0.5)');
    ring(g, 50, 50, 24, 3, 'rgba(251,191,36,0.75)');
    seg(g, 50, 8, 50, 26, 4, '#fbbf24'); seg(g, 50, 74, 50, 92, 4, '#fbbf24');
    seg(g, 8, 50, 26, 50, 4, '#fbbf24'); seg(g, 74, 50, 92, 50, 4, '#fbbf24');
    dot(g, 50, 50, 7, '#fde68a');
  };
  GLYPHS['spell:petrify'] = g => {
    path(g, [[28, 82], [20, 58], [34, 42], [52, 48], [56, 68], [46, 82]]);
    g.fillStyle = lg(g, 20, 42, 56, 82, [[0, '#a8a29e'], [1, '#57534e']]);
    g.fill(); g.lineWidth = 2.6; g.strokeStyle = '#292524'; g.stroke();
    path(g, [[56, 78], [54, 60], [68, 50], [82, 60], [78, 78]]);
    g.fillStyle = lg(g, 54, 50, 82, 78, [[0, '#d6d3d1'], [1, '#78716c']]);
    g.fill(); g.lineWidth = 2.6; g.strokeStyle = '#292524'; g.stroke();
    ring(g, 50, 40, 26, 3.4, 'rgba(255,214,102,0.85)', Math.PI * 1.05, Math.PI * 1.95);
    spark4(g, 28, 26, 6, '#ffd666'); spark4(g, 72, 26, 6, '#ffd666');
  };
  GLYPHS['spell:aegis'] = g => {
    g.beginPath(); g.arc(50, 52, 33, 0, T2);
    g.fillStyle = rg(g, 44, 42, 44, [[0, 'rgba(125,226,209,0.35)'], [1, 'rgba(94,234,212,0.08)']]);
    g.fill();
    ring(g, 50, 52, 33, 4.4, '#5eead4');
    ring(g, 50, 52, 25, 2.4, 'rgba(204,251,241,0.8)', Math.PI * 1.1, Math.PI * 1.7);
    g.beginPath();
    g.moveTo(50, 34); g.lineTo(64, 40); g.bezierCurveTo(64, 54, 60, 64, 50, 70);
    g.bezierCurveTo(40, 64, 36, 54, 36, 40); g.closePath();
    g.fillStyle = 'rgba(94,234,212,0.75)'; g.fill();
  };
  GLYPHS['spell:vengeance'] = g => {
    g.beginPath(); g.arc(50, 50, 27, -0.35 * Math.PI, 0.6 * Math.PI);
    g.lineWidth = 8; g.strokeStyle = '#f87171'; g.lineCap = 'round'; g.stroke();
    tri(g, 50 + 27 * Math.cos(0.6 * Math.PI), 50 + 27 * Math.sin(0.6 * Math.PI), 11, 0.6 * Math.PI + Math.PI / 2, '#fca5a5');
    g.beginPath(); g.arc(50, 50, 27, 0.65 * Math.PI, 1.6 * Math.PI);
    g.lineWidth = 8; g.strokeStyle = '#fecaca'; g.stroke();
    tri(g, 50 + 27 * Math.cos(1.6 * Math.PI), 50 + 27 * Math.sin(1.6 * Math.PI), 11, 1.6 * Math.PI + Math.PI / 2, '#fee2e2');
  };
  GLYPHS['spell:flameshot'] = g => {
    shot(g, '#fb923c');
    spark4(g, 72, 28, 14, '#fdba74');
    spark4(g, 78, 22, 7, '#fff7ed');
  };
  GLYPHS['spell:arrival'] = g => {
    ring(g, 50, 58, 22, 4, '#fbbf24');
    chevron(g, 50, 32, 12, 18, 8, '#fde68a', -Math.PI / 2);
    g.fillStyle = '#f59e0b'; g.fillRect(46, 48, 8, 28);
  };
  GLYPHS['spell:icequake'] = g => {
    path(g, [[18, 78], [50, 22], [82, 78]]);
    g.fillStyle = lg(g, 50, 22, 50, 78, [[0, '#e0f2fe'], [1, '#38bdf8']]); g.fill();
    spark4(g, 50, 48, 10, '#fff');
  };
  GLYPHS['spell:weaken'] = g => {
    chevron(g, 50, 38, 18, 22, 10, '#c4b5fd', Math.PI / 2);
    chevron(g, 50, 58, 18, 22, 10, '#a78bfa', Math.PI / 2);
  };
  GLYPHS['spell:revitalize'] = g => {
    g.beginPath(); g.moveTo(50, 78); g.bezierCurveTo(18, 52, 28, 22, 50, 36); g.bezierCurveTo(72, 22, 82, 52, 50, 78);
    g.fillStyle = '#4ade80'; g.fill();
    spark4(g, 50, 44, 8, '#dcfce7');
  };
  GLYPHS['ping:missing'] = g => {
    g.fillStyle = '#e879f9'; g.font = '800 54px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', 50, 54);
  };
  GLYPHS['ping:turtle'] = g => { ring(g, 50, 54, 28, 6, '#4ade80'); dot(g, 50, 50, 10, '#bbf7d0'); };
  GLYPHS['ping:lord'] = g => { spark4(g, 50, 48, 22, '#ffc94a'); dot(g, 50, 50, 8, '#fff7ed'); };
  GLYPHS['ping:careful'] = g => { ring(g, 50, 42, 16, 5, '#fbbf24'); g.fillStyle = '#fbbf24'; g.fillRect(47, 62, 6, 18); };

  /* ---------------- emblems (role sigils) ---------------- */
  GLYPHS['emblem:assassin'] = g => {
    ring(g, 50, 50, 36, 3.4, 'rgba(192,132,252,0.5)');
    rot(g, 50, 50, 0.5, () => blade(g, 0, -2, 56, 15, '#e9d5ff', '#a855f7', 'rgba(46,16,101,0.8)'));
  };
  GLYPHS['emblem:mage'] = g => {
    dot(g, 50, 46, 18, '#a5b4fc');
    g.beginPath(); g.arc(50, 46, 18, 0, T2);
    g.fillStyle = rg(g, 44, 40, 26, [[0, '#e0e7ff'], [1, '#6366f1']]); g.fill();
    g.beginPath(); g.ellipse(50, 52, 33, 11, -0.3, 0, T2);
    g.lineWidth = 3.4; g.strokeStyle = 'rgba(165,180,252,0.8)'; g.stroke();
    spark4(g, 76, 30, 6, '#e0e7ff');
  };
  GLYPHS['emblem:marksman'] = g => {
    ring(g, 50, 50, 30, 4, '#7dd3fc');
    seg(g, 50, 12, 50, 30, 4, '#7dd3fc'); seg(g, 50, 70, 50, 88, 4, '#7dd3fc');
    seg(g, 12, 50, 30, 50, 4, '#7dd3fc'); seg(g, 70, 50, 88, 50, 4, '#7dd3fc');
    tri(g, 50, 50, 10, -Math.PI / 4, '#e8f7ff');
  };
  GLYPHS['emblem:tank'] = g => {
    g.beginPath();
    g.moveTo(50, 12); g.lineTo(80, 24); g.bezierCurveTo(80, 52, 70, 76, 50, 88);
    g.bezierCurveTo(30, 76, 20, 52, 20, 24); g.closePath();
    g.fillStyle = lg(g, 26, 16, 74, 84, [[0, '#cbd5e1'], [1, '#475569']]);
    g.fill(); g.lineWidth = 4; g.strokeStyle = '#1e293b'; g.stroke();
    seg(g, 50, 26, 50, 74, 5.5, 'rgba(30,41,59,0.55)');
  };
  GLYPHS['emblem:support'] = g => {
    dot(g, 50, 50, 30, 'rgba(74,222,128,0.2)');
    ring(g, 50, 50, 30, 3.4, '#4ade80');
    seg(g, 50, 32, 50, 68, 9, '#bbf7d0');
    seg(g, 32, 50, 68, 50, 9, '#bbf7d0');
  };
  GLYPHS['emblem:fighter'] = g => {
    for (const s of [-1, 1]) {
      rot(g, 50, 52, s * 0.5, () => {
        g.fillStyle = '#8a5a3b'; g.fillRect(-3, -26, 6, 58);
        g.beginPath();
        g.moveTo(s * 3, -28);
        g.bezierCurveTo(s * 22, -36, s * 28, -18, s * 20, -4);
        g.bezierCurveTo(s * 13, -11, s * 7, -13, s * 3, -12);
        g.closePath();
        g.fillStyle = lg(g, 0, -36, 0, -4, [[0, '#fca5a5'], [1, '#dc2626']]);
        g.fill();
      });
    }
  };

  /* ---------------- HUD / misc ---------------- */
  GLYPHS['misc:attack'] = g => {
    for (const s of [-1, 1]) {
      rot(g, 50, 50, s * Math.PI / 4, () => {
        blade(g, 0, -8, 62, 13, '#fef3c7', '#f59e0b', 'rgba(120,53,15,0.8)');
        g.fillStyle = '#92400e'; g.fillRect(-12, 24, 24, 5.5);
        g.fillStyle = '#78350f'; g.fillRect(-3.4, 29.5, 6.8, 14);
        dot(g, 0, 46, 4, '#f59e0b');
      });
    }
  };
  GLYPHS['misc:recall'] = g => {
    g.beginPath(); g.ellipse(50, 78, 30, 9, 0, 0, T2);
    g.lineWidth = 4; g.strokeStyle = 'rgba(94,158,255,0.75)'; g.stroke();
    g.beginPath(); g.ellipse(50, 78, 17, 5, 0, 0, T2);
    g.fillStyle = 'rgba(94,158,255,0.35)'; g.fill();
    for (const [r, a] of [[26, 0.35], [18, 0.55], [10, 0.8]]) {
      ring(g, 50, 46 - r * 0.3, r, 4, `rgba(125,183,255,${a})`, Math.PI * 1.15, Math.PI * 1.85);
    }
    arrow(g, 50, 18, 50, 64, 6.5, '#bfdbff', 2);
  };
  GLYPHS['misc:shop'] = g => {
    for (const [x, y, r] of [[36, 66, 17], [62, 70, 14]]) {
      dot(g, x, y, r, '#f59e0b');
      ring(g, x, y, r, 3, '#92400e');
      ring(g, x, y, r * 0.62, 2, 'rgba(146,64,14,0.7)');
    }
    dot(g, 52, 38, 16, '#fbbf24');
    ring(g, 52, 38, 16, 3, '#92400e');
    ring(g, 52, 38, 10, 2, 'rgba(146,64,14,0.7)');
  };
  GLYPHS['misc:ping'] = g => {
    path(g, [[18, 42], [52, 24], [52, 72], [18, 56]]);
    g.fillStyle = lg(g, 18, 24, 52, 72, [[0, '#fde68a'], [1, '#f59e0b']]);
    g.fill(); g.lineWidth = 2.6; g.strokeStyle = '#92400e'; g.stroke();
    g.fillStyle = '#b45309'; g.fillRect(22, 56, 10, 20);
    for (const [r, a] of [[14, 0.9], [24, 0.6], [34, 0.35]]) {
      ring(g, 58, 48, r, 4.4, `rgba(253,230,138,${a})`, -0.6, 0.6);
    }
  };
  GLYPHS['misc:turret'] = g => {
    path(g, [[30, 84], [70, 84], [62, 70], [38, 70]]);
    g.fillStyle = '#475569'; g.fill();
    path(g, [[40, 70], [60, 70], [56, 30], [44, 30]]);
    g.fillStyle = lg(g, 40, 30, 60, 70, [[0, '#94a3b8'], [1, '#54637a']]);
    g.fill();
    path(g, [[38, 30], [62, 30], [58, 20], [42, 20]]);
    g.fillStyle = '#64748b'; g.fill();
    dot(g, 50, 14, 7, '#ffd666');
  };
  GLYPHS['misc:gate'] = g => {
    g.lineWidth = 5; g.strokeStyle = '#94a3b8';
    g.strokeRect(24, 26, 52, 58);
    for (const x of [37, 50, 63]) seg(g, x, 28, x, 82, 4, 'rgba(148,163,184,0.7)');
    seg(g, 26, 46, 74, 46, 4, 'rgba(148,163,184,0.7)');
  };

  /* ---------------- item templates ----------------
     Items share four motifs (blade / orb / shield / boot) recoloured and
     decorated per item, so the whole shop stays visually consistent. */
  const swordG = (g, c0, c1, edgeC, o = {}) => {
    rot(g, 50, 52, o.ang !== undefined ? o.ang : Math.PI / 4, () => {
      blade(g, 0, -10, o.len || 62, o.wid || 14, c0, c1, edgeC);
      g.fillStyle = o.guard || '#8892a8'; g.fillRect(-13, 21, 26, 6);
      g.fillStyle = o.grip || '#3a4358'; g.fillRect(-3.6, 27, 7.2, 15);
      dot(g, 0, 45, 4.4, o.guard || '#8892a8');
    });
  };
  const orbG = (g, c0, c1, c2) => {
    g.beginPath(); g.arc(50, 50, 25, 0, T2);
    g.fillStyle = rg(g, 42, 42, 36, [[0, c0], [0.6, c1], [1, c2]]);
    g.fill();
    ring(g, 50, 50, 25, 2.6, 'rgba(10,16,28,0.65)');
    dot(g, 41, 40, 5, 'rgba(255,255,255,0.7)');
  };
  const shieldG = (g, c0, c1, lineC) => {
    g.beginPath();
    g.moveTo(50, 12); g.lineTo(79, 24); g.bezierCurveTo(79, 52, 70, 75, 50, 88);
    g.bezierCurveTo(30, 75, 21, 52, 21, 24); g.closePath();
    g.fillStyle = lg(g, 26, 16, 74, 84, [[0, c0], [1, c1]]);
    g.fill(); g.lineWidth = 4; g.strokeStyle = lineC; g.stroke();
  };
  const bootG = (g, c0, c1) => {
    g.beginPath();
    g.moveTo(36, 12); g.lineTo(58, 12); g.lineTo(57, 50);
    g.quadraticCurveTo(70, 52, 79, 64); g.quadraticCurveTo(84, 73, 77, 78);
    g.lineTo(37, 78); g.quadraticCurveTo(30, 58, 36, 12);
    g.closePath();
    g.fillStyle = lg(g, 36, 12, 72, 78, [[0, c0], [1, c1]]);
    g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(22,14,8,0.75)'; g.stroke();
    g.fillStyle = 'rgba(22,14,8,0.55)';
    g.beginPath();
    if (g.roundRect) g.roundRect(33, 74, 48, 8, 3); else g.rect(33, 74, 48, 8);
    g.fill();
  };
  const heartG = (g, c0, c1) => {
    g.beginPath();
    g.moveTo(50, 82);
    g.bezierCurveTo(20, 58, 16, 34, 32, 24);
    g.bezierCurveTo(42, 18, 50, 26, 50, 34);
    g.bezierCurveTo(50, 26, 58, 18, 68, 24);
    g.bezierCurveTo(84, 34, 80, 58, 50, 82);
    g.closePath();
    g.fillStyle = lg(g, 30, 20, 70, 80, [[0, c0], [1, c1]]);
    g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(30,8,20,0.55)'; g.stroke();
    dot(g, 39, 36, 5, 'rgba(255,255,255,0.55)');
  };

  /* ---------------- components ---------------- */
  GLYPHS['item:longsword'] = g => swordG(g, '#f1f5f9', '#94a3b8', '#334155');
  GLYPHS['item:dagger'] = g => swordG(g, '#ccfbf1', '#2dd4bf', '#134e4a', { len: 46, wid: 12, ang: Math.PI / 3.2 });
  GLYPHS['item:chainmail'] = g => {
    for (const [x, y] of [[38, 38], [62, 38], [38, 62], [62, 62]]) {
      ring(g, x, y, 13, 6, '#64748b'); ring(g, x, y, 13, 2.4, '#cbd5e1');
    }
  };
  GLYPHS['item:cloak'] = g => {
    g.beginPath();
    g.moveTo(50, 12);
    g.quadraticCurveTo(78, 26, 76, 84);
    g.quadraticCurveTo(62, 76, 50, 84);
    g.quadraticCurveTo(38, 76, 24, 84);
    g.quadraticCurveTo(22, 26, 50, 12);
    g.closePath();
    g.fillStyle = lg(g, 26, 14, 74, 84, [[0, '#a78bfa'], [1, '#4c1d95']]);
    g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(30,15,70,0.8)'; g.stroke();
    g.beginPath(); g.moveTo(50, 22); g.quadraticCurveTo(46, 50, 50, 80);
    g.lineWidth = 2.4; g.strokeStyle = 'rgba(240,235,255,0.35)'; g.stroke();
    dot(g, 50, 24, 4, '#ede9fe');
  };
  GLYPHS['item:vitality'] = g => heartG(g, '#fda4af', '#e11d48');
  GLYPHS['item:focus'] = g => orbG(g, '#f5d0fe', '#c026d3', '#701a75');
  GLYPHS['item:boots'] = g => bootG(g, '#b98a5e', '#6b4226');
  GLYPHS['item:loop'] = g => {
    path(g, [[30, 16], [70, 16], [54, 48], [70, 82], [30, 82], [46, 48]]);
    g.fillStyle = 'rgba(125,183,255,0.16)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#7db7ff'; g.lineJoin = 'round'; g.stroke();
    path(g, [[40, 24], [60, 24], [50, 42]]); g.fillStyle = '#ffd666'; g.fill();
    path(g, [[42, 74], [58, 74], [50, 60]]); g.fillStyle = '#ffd666'; g.fill();
  };
  GLYPHS['item:whetstone'] = g => {
    g.beginPath(); g.ellipse(50, 58, 30, 20, -0.18, 0, T2);
    g.fillStyle = lg(g, 24, 40, 76, 76, [[0, '#a8a29e'], [1, '#57534e']]);
    g.fill(); g.lineWidth = 3; g.strokeStyle = '#292524'; g.stroke();
    seg(g, 28, 50, 70, 44, 2.4, 'rgba(255,255,255,0.4)');
    spark4(g, 72, 28, 8, '#fde047');
  };

  /* ---------------- finished items ---------------- */
  GLYPHS['item:ruin'] = g => {
    swordG(g, '#fecaca', '#dc2626', '#450a0a', { len: 70, wid: 16 });
    spark4(g, 24, 28, 6, 'rgba(254,202,202,0.8)');
  };
  GLYPHS['item:executioner'] = g => {                             // cleaver
    rot(g, 50, 50, 0.2, () => {
      path(g, [[-30, -22], [26, -22], [30, 6], [12, 10], [4, 4], [-6, 10], [-30, 4]]);
      g.fillStyle = lg(g, -30, -22, 30, 10, [[0, '#e2e8f0'], [1, '#64748b']]);
      g.fill(); g.lineWidth = 2.6; g.strokeStyle = '#1e293b'; g.stroke();
      g.fillStyle = '#7c2d12'; g.fillRect(24, -14, 22, 9);
    });
    seg(g, 24, 78, 76, 66, 4, 'rgba(248,113,113,0.7)');
  };
  GLYPHS['item:bloodthirster'] = g => {
    swordG(g, '#fecdd3', '#be123c', '#4c0519');
    g.beginPath();
    g.moveTo(76, 56); g.bezierCurveTo(84, 68, 84, 76, 76, 80);
    g.bezierCurveTo(68, 76, 68, 68, 76, 56);
    g.closePath(); g.fillStyle = '#ef4444'; g.fill();
  };
  GLYPHS['item:berserker'] = g => {                               // crit fang
    rot(g, 50, 52, Math.PI / 4, () => {
      path(g, [[0, -38], [7, -26], [2, -14], [8, 0], [3, 12], [5, 24], [-5, 24], [-3, 8], [-8, -6], [-2, -20], [-7, -30]]);
      g.fillStyle = lg(g, -8, 0, 8, 0, [[0, '#fff7ed'], [1, '#f97316']]);
      g.fill(); g.lineWidth = 2, g.strokeStyle = '#7c2d12'; g.stroke();
    });
    spark4(g, 74, 30, 9, '#fde047');
  };
  GLYPHS['item:windtalker'] = g => {
    swordG(g, '#cffafe', '#22d3ee', '#155e75', { len: 58, wid: 12 });
    ring(g, 32, 30, 14, 4, 'rgba(165,243,252,0.8)', -0.3 * Math.PI, 0.7 * Math.PI);
    ring(g, 72, 66, 11, 3.4, 'rgba(165,243,252,0.55)', 0.6 * Math.PI, 1.7 * Math.PI);
  };
  GLYPHS['item:demonhunter'] = g => {
    swordG(g, '#fbcfe8', '#be185d', '#500724', { len: 58 });
    g.beginPath(); g.ellipse(30, 30, 12, 7, -0.4, 0, T2);
    g.fillStyle = '#dc2626'; g.fill();
    dot(g, 30, 30, 3, '#0b0f1a');
  };
  GLYPHS['item:starfall'] = g => {
    path(g, [[24, 70], [76, 70], [80, 40], [64, 52], [50, 30], [36, 52], [20, 40]]);
    g.fillStyle = lg(g, 24, 30, 76, 70, [[0, '#ffe9a0'], [1, '#b8860b']]);
    g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(92,58,7,0.8)'; g.stroke();
    g.fillStyle = 'rgba(92,58,7,0.9)'; g.fillRect(24, 70, 52, 7);
    spark4(g, 50, 18, 9, '#fff7d6');
  };
  GLYPHS['item:voidsigil'] = g => {
    dot(g, 50, 50, 27, '#0b0716');
    ring(g, 50, 50, 27, 6, '#7c3aed');
    ring(g, 50, 50, 27, 2.4, '#c4b5fd');
    for (let i = 0; i < 4; i++) {
      rot(g, 50, 50, i / 4 * T2 + Math.PI / 4, () => seg(g, 0, -33, 0, -40, 4, '#a78bfa'));
    }
    dot(g, 50, 50, 6, '#c4b5fd');
  };
  GLYPHS['item:soulstealer'] = g => {                             // wisp
    g.beginPath();
    g.arc(48, 42, 22, Math.PI, 0);
    g.lineTo(70, 74); g.lineTo(60, 64); g.lineTo(52, 76); g.lineTo(44, 64); g.lineTo(34, 74);
    g.closePath();
    g.fillStyle = lg(g, 30, 20, 66, 76, [[0, '#e9d5ff'], [1, '#7e22ce']]);
    g.fill(); g.lineWidth = 2.6; g.strokeStyle = 'rgba(40,10,70,0.7)'; g.stroke();
    dot(g, 41, 42, 4, '#1e1033'); dot(g, 57, 42, 4, '#1e1033');
    spark4(g, 78, 30, 7, 'rgba(233,213,255,0.85)');
  };
  GLYPHS['item:chronomancer'] = g => {
    ring(g, 50, 50, 27, 6, '#4c6ef5');
    ring(g, 50, 50, 27, 2.4, '#bac8ff');
    dot(g, 50, 50, 21, 'rgba(76,110,245,0.14)');
    seg(g, 50, 50, 50, 34, 4, '#e5edff');
    seg(g, 50, 50, 62, 56, 4, '#e5edff');
    dot(g, 50, 50, 3.4, '#e5edff');
    for (let i = 0; i < 4; i++) {
      rot(g, 50, 50, i / 4 * T2, () => seg(g, 0, -23, 0, -19, 2.6, '#bac8ff'));
    }
  };
  GLYPHS['item:frostgale'] = g => {
    orbG(g, '#eff6ff', '#60a5fa', '#1e3a8a');
    for (let i = 0; i < 6; i++) {
      rot(g, 50, 50, i / 6 * T2, () => seg(g, 0, -12, 0, -20, 2.6, 'rgba(239,246,255,0.85)'));
    }
  };
  GLYPHS['item:lightbringer'] = g => {
    for (let i = 0; i < 8; i++) {
      rot(g, 50, 50, i / 8 * T2, () => seg(g, 0, -22, 0, i % 2 ? -32 : -40, 4.4, i % 2 ? '#fde68a' : '#facc15'));
    }
    dot(g, 50, 50, 15, '#fefce8');
    ring(g, 50, 50, 15, 3, '#eab308');
  };
  GLYPHS['item:ironhide'] = g => {
    shieldG(g, '#cbd5e1', '#475569', '#1e293b');
    for (const [x, y] of [[50, 26], [36, 40], [64, 40], [50, 56]]) dot(g, x, y, 3.4, '#1e293b');
  };
  GLYPHS['item:warden'] = g => {
    shieldG(g, '#cbd5e1', '#475569', '#1e293b');
    g.save(); g.translate(50, 48); g.scale(0.42, 0.42); g.translate(-50, -50);
    heartG(g, '#fda4af', '#e11d48');
    g.restore();
  };
  GLYPHS['item:aegis'] = g => {
    shieldG(g, '#99f6e4', '#0d9488', '#134e4a');
    spark4(g, 50, 44, 12, '#f0fdfa');
    spark4(g, 62, 60, 6, 'rgba(240,253,250,0.7)');
  };
  GLYPHS['item:nullstone'] = g => {
    path(g, [[50, 14], [78, 34], [70, 74], [30, 74], [22, 34]]);
    g.fillStyle = lg(g, 24, 16, 76, 74, [[0, '#c7d2fe'], [1, '#4338ca']]);
    g.fill(); g.lineWidth = 3; g.strokeStyle = '#1e1b4b'; g.stroke();
    ring(g, 50, 46, 13, 4, '#e0e7ff');
    seg(g, 41, 55, 59, 37, 4, '#e0e7ff');
  };
  GLYPHS['item:colossus'] = g => heartG(g, '#86efac', '#15803d');
  GLYPHS['item:bulwark'] = g => {
    shieldG(g, '#fde68a', '#b45309', '#78350f');
    chevron(g, 50, 42, 16, 12, 5.5, 'rgba(120,53,15,0.85)', Math.PI / 2);
    chevron(g, 50, 58, 16, 12, 5.5, 'rgba(120,53,15,0.6)', Math.PI / 2);
  };
  GLYPHS['item:swiftboots'] = g => {
    bootG(g, '#93c5fd', '#1d4ed8');
    for (const [y, l] of [[30, 20], [42, 26], [54, 18]]) seg(g, 8, y, 8 + l, y, 4, 'rgba(191,219,254,0.85)');
  };
  GLYPHS['item:arcaneboots'] = g => {
    bootG(g, '#c4b5fd', '#5b21b6');
    spark4(g, 47, 38, 8, '#ede9fe');
  };
  GLYPHS['item:warriorboots'] = g => {
    bootG(g, '#cbd5e1', '#475569');
    seg(g, 40, 26, 56, 26, 5, '#1e293b'); seg(g, 40, 38, 56, 38, 5, '#1e293b');
  };
  GLYPHS['item:toughboots'] = g => {
    bootG(g, '#99f6e4', '#0f766e');
    dot(g, 48, 34, 7, '#134e4a'); ring(g, 48, 34, 7, 2.2, '#ccfbf1');
  };
  GLYPHS['item:guardian'] = g => {                                // winged charm
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(50 + s * 6, 50);
      g.quadraticCurveTo(50 + s * 34, 26, 50 + s * 42, 44);
      g.quadraticCurveTo(50 + s * 30, 44, 50 + s * 24, 54);
      g.quadraticCurveTo(50 + s * 32, 52, 50 + s * 34, 60);
      g.quadraticCurveTo(50 + s * 20, 60, 50 + s * 8, 66);
      g.closePath();
      g.fillStyle = lg(g, 50, 26, 50 + s * 42, 66, [[0, '#fff'], [1, '#93c5fd']]);
      g.fill();
    }
    dot(g, 50, 56, 9, '#fde68a');
    ring(g, 50, 56, 9, 2.4, '#b45309');
    ring(g, 50, 30, 10, 3.4, '#fde68a', Math.PI * 1.1, Math.PI * 1.9);
  };
  GLYPHS['item:rally'] = g => {
    seg(g, 34, 12, 34, 86, 5, '#8a5a3b');
    g.beginPath();
    g.moveTo(37, 16); g.lineTo(80, 22); g.lineTo(70, 34); g.lineTo(80, 46); g.lineTo(37, 52);
    g.closePath();
    g.fillStyle = lg(g, 37, 16, 80, 52, [[0, '#fca5a5'], [1, '#b91c1c']]);
    g.fill(); g.lineWidth = 2.4; g.strokeStyle = '#7f1d1d'; g.stroke();
    spark4(g, 56, 33, 7, 'rgba(255,255,255,0.85)');
  };
  GLYPHS['item:beastbane'] = g => {                               // tusks
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(50 + s * 8, 82);
      g.bezierCurveTo(50 + s * 34, 70, 50 + s * 38, 40, 50 + s * 22, 16);
      g.bezierCurveTo(50 + s * 26, 44, 50 + s * 18, 62, 50 + s * 2, 72);
      g.closePath();
      g.fillStyle = lg(g, 50, 16, 50, 82, [[0, '#fff7ed'], [1, '#d6bf9e']]);
      g.fill(); g.lineWidth = 2.2; g.strokeStyle = '#57432b'; g.stroke();
    }
    dot(g, 50, 78, 5, '#7c2d12');
  };

  /* ---------------- pings ---------------- */
  GLYPHS['ping:danger'] = g => {
    path(g, [[50, 12], [90, 82], [10, 82]]);
    g.fillStyle = lg(g, 50, 12, 50, 82, [[0, '#ff8fa3'], [1, '#e5383b']]);
    g.fill(); g.lineWidth = 4; g.strokeStyle = '#590d22'; g.lineJoin = 'round'; g.stroke();
    seg(g, 50, 34, 50, 60, 8, '#fff0f3');
    dot(g, 50, 71, 4.6, '#fff0f3');
  };
  GLYPHS['ping:retreat'] = g => {
    g.beginPath(); g.arc(50, 46, 24, -Math.PI * 0.9, Math.PI * 0.35);
    g.lineWidth = 9; g.strokeStyle = '#fbbf24'; g.lineCap = 'round'; g.stroke();
    tri(g, 50 + 24 * Math.cos(-Math.PI * 0.9), 46 + 24 * Math.sin(-Math.PI * 0.9), 13, Math.PI * 0.62, '#fde68a');
  };
  GLYPHS['ping:attack'] = g => {
    for (const s of [-1, 1]) {
      rot(g, 50, 50, s * Math.PI / 4, () => {
        blade(g, 0, -6, 56, 12, '#ffe5d0', '#ff9d5c', 'rgba(124,45,18,0.85)');
        g.fillStyle = '#c2410c'; g.fillRect(-10, 23, 20, 5);
      });
    }
  };
  GLYPHS['ping:gather'] = g => {
    ring(g, 50, 50, 30, 5, '#4cc2ff');
    ring(g, 50, 50, 18, 4, 'rgba(76,194,255,0.6)');
    dot(g, 50, 50, 7, '#e0f4ff');
  };
  GLYPHS['ping:help'] = g => {
    for (let i = 0; i < 8; i++) {
      rot(g, 50, 50, i / 8 * T2, () => seg(g, 0, -26, 0, -36, 5, 'rgba(167,139,250,0.75)'));
    }
    dot(g, 50, 50, 20, '#a78bfa');
    seg(g, 50, 40, 50, 60, 6.5, '#f5f3ff'); seg(g, 40, 50, 60, 50, 6.5, '#f5f3ff');
  };
  GLYPHS['ping:omw'] = g => {
    chevron(g, 34, 50, 15, 34, 9, 'rgba(74,222,128,0.45)', 0);
    chevron(g, 54, 50, 15, 34, 9, 'rgba(74,222,128,0.75)', 0);
    chevron(g, 74, 50, 15, 34, 9, '#4ade80', 0);
  };

  /* ---------------- top bar chrome ---------------- */
  GLYPHS['misc:score'] = g => {
    seg(g, 16, 84, 84, 84, 4, 'rgba(148,163,184,0.6)');
    g.fillStyle = '#5e9eff'; g.fillRect(24, 46, 14, 34);
    g.fillStyle = '#ffd666'; g.fillRect(44, 24, 14, 56);
    g.fillStyle = '#ff4d6d'; g.fillRect(64, 56, 14, 24);
  };
  GLYPHS['misc:gear'] = g => {
    for (let i = 0; i < 8; i++) {
      rot(g, 50, 50, i / 8 * T2, () => { g.fillStyle = '#94a3b8'; g.fillRect(-6, -36, 12, 14); });
    }
    ring(g, 50, 50, 25, 10, '#94a3b8');
    ring(g, 50, 50, 25, 4, '#cbd5e1');
    dot(g, 50, 50, 9, '#334155');
  };
  GLYPHS['misc:sound'] = g => {
    path(g, [[16, 40], [34, 40], [52, 24], [52, 76], [34, 60], [16, 60]]);
    g.fillStyle = '#cbd5e1'; g.fill();
    for (const [r, a] of [[14, 0.9], [24, 0.6]]) {
      ring(g, 56, 50, r, 5, `rgba(203,213,225,${a})`, -0.55, 0.55);
    }
  };
  GLYPHS['misc:muted'] = g => {
    path(g, [[16, 40], [34, 40], [52, 24], [52, 76], [34, 60], [16, 60]]);
    g.fillStyle = 'rgba(203,213,225,0.5)'; g.fill();
    seg(g, 62, 40, 84, 62, 6, '#ff4d6d'); seg(g, 84, 40, 62, 62, 6, '#ff4d6d');
  };

  /* ---------------- world: runes / monsters ---------------- */
  GLYPHS['buff:blueBuff'] = g => {
    gem(g, 50, 50, 32, '#dbeafe', '#60a5fa', '#1d4ed8');
    spark4(g, 72, 28, 7, 'rgba(219,234,254,0.9)');
  };
  GLYPHS['buff:redBuff'] = g => {
    gem(g, 50, 52, 32, '#ffedd5', '#fb923c', '#c2410c');
    g.beginPath();
    g.moveTo(50, 30); g.bezierCurveTo(58, 40, 57, 50, 50, 56);
    g.bezierCurveTo(43, 50, 42, 40, 50, 30);
    g.fillStyle = '#fff7ed'; g.fill();
  };
  GLYPHS['buff:lord'] = GLYPHS['epic:lord'] = g => {              // crown
    path(g, [[20, 72], [80, 72], [84, 34], [66, 50], [50, 22], [34, 50], [16, 34]]);
    g.fillStyle = lg(g, 20, 22, 80, 72, [[0, '#ffe9a0'], [0.6, '#ffc94a'], [1, '#b8860b']]);
    g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(92,58,7,0.8)'; g.stroke();
    g.fillStyle = 'rgba(92,58,7,0.9)'; g.fillRect(20, 72, 60, 8);
    dot(g, 50, 60, 5.5, '#ef4444'); dot(g, 32, 62, 4, '#60a5fa'); dot(g, 68, 62, 4, '#60a5fa');
  };
  GLYPHS['buff:turtle'] = GLYPHS['epic:turtle'] = g => {          // shell dome
    g.beginPath(); g.arc(50, 56, 34, Math.PI, 0); g.closePath();
    g.fillStyle = lg(g, 20, 22, 80, 56, [[0, '#86efac'], [1, '#15803d']]);
    g.fill(); g.lineWidth = 3.4; g.strokeStyle = '#14532d'; g.stroke();
    g.lineWidth = 2.4; g.strokeStyle = 'rgba(20,83,45,0.7)';
    g.beginPath(); g.moveTo(50, 22); g.lineTo(50, 56); g.stroke();
    g.beginPath(); g.moveTo(30, 34); g.lineTo(70, 34); g.stroke();
    g.beginPath(); g.moveTo(24, 46); g.lineTo(76, 46); g.stroke();
    g.fillStyle = '#14532d'; g.fillRect(18, 56, 64, 7);
    dot(g, 84, 52, 7, '#4ade80');
  };
  GLYPHS['monster:jungle'] = g => {                               // horned mask
    dot(g, 50, 54, 26, '#6d5a4a');
    g.beginPath(); g.arc(50, 54, 26, 0, T2);
    g.fillStyle = rg(g, 42, 46, 36, [[0, '#8a7460'], [1, '#4a3b2e']]); g.fill();
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(50 + s * 18, 34);
      g.quadraticCurveTo(50 + s * 34, 18, 50 + s * 24, 8);
      g.quadraticCurveTo(50 + s * 22, 20, 50 + s * 10, 30);
      g.closePath(); g.fillStyle = '#d9cfc0'; g.fill();
    }
    dot(g, 41, 50, 4.4, '#ffd666'); dot(g, 59, 50, 4.4, '#ffd666');
    path(g, [[42, 66], [46, 61], [50, 66], [54, 61], [58, 66]], false);
    g.lineWidth = 3; g.strokeStyle = '#d9cfc0'; g.stroke();
  };
  GLYPHS['monster:crab'] = g => {
    g.beginPath(); g.ellipse(50, 58, 28, 18, 0, 0, T2);
    g.fillStyle = rg(g, 42, 50, 34, [[0, '#cbd5e1'], [1, '#475569']]); g.fill();
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(50 + s * 22, 52);
      g.quadraticCurveTo(50 + s * 48, 38, 50 + s * 40, 22);
      g.strokeStyle = '#94a3b8'; g.lineWidth = 5; g.stroke();
    }
    dot(g, 40, 54, 3.6, '#0f172a'); dot(g, 60, 54, 3.6, '#0f172a');
    g.beginPath(); g.moveTo(36, 66); g.lineTo(30, 80);
    g.moveTo(64, 66); g.lineTo(70, 80);
    g.strokeStyle = '#64748b'; g.lineWidth = 4; g.stroke();
  };
  GLYPHS['buff:litho'] = g => {
    path(g, [[28, 76], [50, 18], [72, 76]]);
    g.fillStyle = lg(g, 30, 20, 70, 76, [[0, '#ccfbf1'], [0.55, '#2dd4bf'], [1, '#0f766e']]);
    g.fill(); g.lineWidth = 3; g.strokeStyle = '#115e59'; g.stroke();
    g.fillStyle = 'rgba(204,251,241,0.7)';
    g.beginPath(); g.moveTo(50, 28); g.lineTo(58, 68); g.lineTo(42, 68); g.closePath(); g.fill();
  };

  /* ============================================================
     Renderer + caches
     ============================================================ */
  const cvCache = new Map();   // key@px -> canvas (world painting)
  const urlCache = new Map();  // key@px -> dataURL  (DOM)

  function renderTo(size, key, dpr) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.max(2, Math.round(size * dpr));
    const g = cv.getContext('2d');
    g.scale(cv.width / 100, cv.height / 100);
    g.lineJoin = 'round';
    GLYPHS[key](g);
    return cv;
  }

  return {
    GLYPHS,
    has(key) { return !!GLYPHS[key]; },

    /* draw centered at (x,y) on a live ctx, `size` in ctx units */
    paint(g, key, x, y, size) {
      if (!GLYPHS[key]) return false;
      const s = Math.max(8, Math.round(size / 4) * 4);
      const ck = key + '@' + s;
      let cv = cvCache.get(ck);
      if (!cv) { cv = renderTo(s, key, 3); cvCache.set(ck, cv); }
      g.drawImage(cv, x - size / 2, y - size / 2, size, size);
      return true;
    },

    /* cached data URL, for use inside HTML template strings */
    url(key, px = 32) {
      const ck = key + '@' + px;
      let u = urlCache.get(ck);
      if (!u) {
        u = renderTo(px, key, Math.min(3, (window.devicePixelRatio || 1) * 1.5)).toDataURL();
        urlCache.set(ck, u);
      }
      return u;
    },

    img(key, px = 32, cls = '') {
      if (!GLYPHS[key]) return '';
      return `<img class="vIcon${cls ? ' ' + cls : ''}" src="${this.url(key, px)}" width="${px}" height="${px}" alt="" draggable="false">`;
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Icons };
}
