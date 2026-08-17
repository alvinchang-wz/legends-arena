'use strict';
/* ============================================================
   theme.js — the single source of truth for colour.

   CSS owns the DOM half of the UI, canvas owns the world half, and
   before this file they each carried their own hardcoded hex values.
   THEME below is mirrored one-for-one by the :root block in
   css/style.css; `applyThemeToCSS()` pushes these values into that
   block at boot so the two can never drift.

   Art direction: vector/neon on a faked-3D stage. The world renders
   under a tilted-camera squash (see TILT in main.js) with upright,
   volume-shaded figures, extruded terrain, and one key light from the
   top-left. Everything is still drawn procedurally — there are no
   image assets to match against.
   ============================================================ */

const THEME = {
  /* --- surfaces (dark, cool, low chroma so neon reads against it) --- */
  void:      '#05080f',   // behind everything
  surface0:  '#0a1120',   // panel base
  surface1:  '#111c33',   // raised panel
  surface2:  '#1a2947',   // control
  surface3:  '#24375c',   // hovered control
  line:      '#2c4368',   // hairline border
  lineSoft:  'rgba(140,180,240,0.14)',

  /* --- text --- */
  text:      '#e8eefb',
  textDim:   '#9fb3d0',
  textFaint: '#6b809c',
  textInk:   '#0a1120',   // on gold/bright fills

  /* --- teams --- */
  blue:      '#4cc2ff',
  blueDeep:  '#1d5f96',
  blueGlow:  'rgba(76,194,255,0.55)',
  red:       '#ff4d6d',
  redDeep:   '#8f2338',
  redGlow:   'rgba(255,77,109,0.55)',
  neutral:   '#a78bfa',
  neutralDeep: '#553c8b',

  /* --- accent / gold --- */
  gold:      '#ffc94a',
  goldDeep:  '#c8890d',
  goldGlow:  'rgba(255,201,74,0.5)',

  /* --- resources --- */
  hp:        '#4ade80',
  hpLow:     '#ef4444',
  hpMid:     '#facc15',
  mana:      '#60a5fa',
  shield:    '#e2e8f0',
  xp:        '#c084fc',

  /* --- damage types (also used by floating numbers) --- */
  physical:  '#ff9d5c',
  magic:     '#a78bfa',
  true:      '#f1f5f9',
  heal:      '#4ade80',
  crit:      '#fff3c4',   // emphasis layered over a damage type, not a type itself

  /* --- crowd control --- */
  ccStun:      '#fde047',
  ccSilence:   '#c084fc',
  ccImmobilize:'#84cc16',
  ccSlow:      '#7dd3fc',
  ccAirborne:  '#fb923c',
  ccSuppress:  '#f43f5e',
  ccKnockback: '#fb7185',

  /* --- world --- */
  /* Land of Dawn: lush forest canopy, beige cobble lanes, teal river.
     Team ownership stays on structures and fountain light, not the grass. */
  groundBlue:  '#34803a',
  groundRed:   '#3d7a34',
  groundMid:   '#3a8238',
  lane:        '#ddd6bc',
  laneEdge:    '#8a866c',
  dirt:        '#8a6436',
  dirtLight:   '#c09252',
  cobble:      '#e4dec6',
  canopy:      '#2e8a34',
  canopyDark:  '#14501c',
  river:       '#14a8a0',
  riverLight:  '#5ee8dc',
  bush:        '#227040',
  bushLight:   '#4caa4e',
  /* Grey stone ridges, like the rocky outcrops on the reference board. */
  wall:        '#5c625c',
  wallLight:   '#8b9288',
  fog:         'rgba(3,6,12,0.72)',

  /* --- feedback --- */
  danger:    '#ff4d6d',
  warn:      '#fbbf24',
  good:      '#4ade80',
};

/* Motion language. Durations in ms, easings as CSS timing functions.
   Canvas animations use the seconds mirror (`SEC`). */
const MOTION = {
  instant: 90,
  quick:   150,   // control feedback: button press, hover
  normal:  260,   // panel in/out, tooltip
  slow:    400,   // screen transitions
  banner:  520,   // announcements, kill banners
  easeOut:  'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn:   'cubic-bezier(0.7, 0, 0.84, 0)',
  easeBoth: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring:   'cubic-bezier(0.34, 1.56, 0.64, 1)',
};
MOTION.SEC = { instant: 0.09, quick: 0.15, normal: 0.26, slow: 0.4, banner: 0.52 };

/* Type scale (px at hud-scale 1). Five steps, nothing in between. */
const TYPE = { xs: 10.5, sm: 12, md: 14, lg: 18, xl: 26, display: 44 };

/* Radii and elevation, mirrored into CSS. */
const SHAPE = {
  r1: 6, r2: 10, r3: 14, rFull: 999,
  shadow1: '0 2px 8px rgba(0,0,0,0.45)',
  shadow2: '0 6px 22px rgba(0,0,0,0.6)',
  shadow3: '0 12px 40px rgba(0,0,0,0.7)',
};

/* Team colour by index, kept as an array because the rest of the codebase
   indexes it with a team id. Replaces the old TEAM_COLORS literal. */
const TEAM_COLORS = [THEME.blue, THEME.red];
const TEAM_DEEP   = [THEME.blueDeep, THEME.redDeep];
const TEAM_GLOW   = [THEME.blueGlow, THEME.redGlow];

/* Damage-type -> colour, used by both the floater renderer and the tooltips. */
const DMG_COLORS = {
  physical: THEME.physical,
  magic: THEME.magic,
  true: THEME.true,
};

/* ---- helpers shared by every canvas drawing routine ---- */

/* Hex -> rgba() at an arbitrary alpha, so the theme can stay a flat list of
   hex strings instead of carrying a pre-baked alpha variant of every colour. */
const _rgbCache = new Map();
function rgba(hex, a) {
  let rgb = _rgbCache.get(hex);
  if (!rgb) {
    rgb = _mixParse(hex);
    _rgbCache.set(hex, rgb);
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/* Mix two hex colours, t in [0,1]. Used for HP bars shifting green->red. */
function mixHex(a, b, t) {
  const m = _mixParse(a).map((v, i) => Math.round(v + (_mixParse(b)[i] - v) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

/* mixHex output feeds back into mixHex (shading a shaded colour), so this
   accepts both '#rrggbb' / '#rgb' and the 'rgb(r,g,b)' strings it returns. */
function _mixParse(c) {
  if (c[0] !== '#') {
    const n = c.match(/[\d.]+/g);
    return n ? [+n[0], +n[1], +n[2]] : [128, 128, 128];
  }
  let h = c.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/* HP bar colour: green while healthy, amber at half, red when critical. */
function hpColor(pct) {
  if (pct > 0.5) return mixHex(THEME.hpMid, THEME.hp, (pct - 0.5) / 0.5);
  return mixHex(THEME.hpLow, THEME.hpMid, clamp(pct, 0, 0.5) / 0.5);
}

/* Push the JS theme into CSS custom properties so stylesheets can use
   var(--blue) etc. without a second copy of the palette. Called at boot. */
function applyThemeToCSS() {
  const r = document.documentElement.style;
  const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  for (const [k, v] of Object.entries(THEME)) r.setProperty('--' + kebab(k), v);
  for (const [k, v] of Object.entries(TYPE)) r.setProperty('--fs-' + k, v + 'px');
  for (const [k, v] of Object.entries(SHAPE)) r.setProperty('--' + kebab(k), typeof v === 'number' ? v + 'px' : v);
  for (const [k, v] of Object.entries(MOTION)) {
    if (typeof v === 'number') r.setProperty('--dur-' + kebab(k), v + 'ms');
    else if (typeof v === 'string') r.setProperty('--ease-' + kebab(k).replace(/^ease-/, ''), v);
  }
  r.setProperty('--team-blue', THEME.blue);
  r.setProperty('--team-red', THEME.red);
}

/* ---- HUD scale ----
   Every HUD size is authored at scale 1 against a 1280x720 landscape
   viewport and multiplied by this factor, so a phone and a desktop get
   proportionally the same controls instead of the same pixel counts.
   The user preference (S/M/L) multiplies on top. */
const HudScale = {
  pref: 1,
  value: 1,
  compute() {
    const w = window.innerWidth, h = window.innerHeight;
    // drive off the short edge: thumbs sit relative to screen height in
    // landscape, and controls must not overflow it on small phones
    const base = clamp(Math.min(h / 720, w / 1280), 0.62, 1.35);
    this.value = clamp(base * this.pref, 0.55, 1.7);
    document.documentElement.style.setProperty('--hud-scale', this.value.toFixed(3));
    return this.value;
  },
  setPref(p) { this.pref = p; this.compute(); },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { THEME, MOTION, TYPE, SHAPE, TEAM_COLORS, DMG_COLORS, rgba, mixHex, hpColor };
}
