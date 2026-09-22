'use strict';
/*
 * Shared scaffolding for the engine feature tests (docs/design/heroes.md,
 * "New engine features required"). Every test loads the real game through
 * headless/runtime.js and drives units directly: heroes are parked
 * (no bot thinking, no auto-attacks) and placed by hand, then the real
 * Game.update() advances the world one fixed 60 Hz step at a time.
 *
 *   const T = require('./helpers');
 *   T.test('name', () => { ... assert ... });
 *   T.done();
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSimulator } = require(path.join(__dirname, '..', 'headless', 'runtime'));

const LINEUP_BLUE = 'grom,ignis,zephyr,nyx,karn';
const LINEUP_RED = 'mira,tide,sylva,bastion,nadir';

function makeSim(opts = {}) {
  return createSimulator(Object.assign({
    seed: 1, intervalMs: 50, stats: false,
    blueLineup: LINEUP_BLUE, redLineup: LINEUP_RED,
  }, opts));
}

/* Park a hero: it still runs regen, CC, dashes, forced movement, channels,
   but never thinks, walks or swings on its own. */
function park(h) {
  h.aiTimer = 1e9;
  h.botThink = () => {};
  h.botControl = () => {};
  h.attackOnMove = false;
  h.recallT = 0;
  return h;
}
function parkAll(G) { for (const h of G.heroes) park(h); }

function place(u, x, y) {
  u.x = x; u.y = y; u._px = x; u._py = y; u.vx = 0; u.vy = 0;
  if (u.nav) { u.nav.path.length = 0; u.nav.gx = u.nav.gy = NaN; }
  return u;
}

function hero(G, id, team) {
  const h = G.heroes.find(x => x.def0.id === id && (team === undefined || x.team === team));
  if (!h) throw new Error(`no hero ${id} on team ${team}`);
  return h;
}

/* Fully learn every skill so casts never fail on rank. */
function maxSkills(h) {
  h.skillRank = [6, 6, 3];
  h.skillPoints = 0;
  return h;
}

function frames(G, n, dt = 1 / 60) { for (let i = 0; i < n; i++) G.update(dt); }
function seconds(G, s) { frames(G, Math.round(s * 60)); }

/* An open patch of ground: no wall or structure within `clear` of it, on the
   5v5 map, well away from every lane's first minion clash. Scans a grid so
   the answer does not depend on hand-picked coordinates. */
function openSpot(G, clear = 260, opts = {}) {
  const W = G.worldSize();
  for (let y = 600; y < W - 600; y += 80) {
    for (let x = 600; x < W - 600; x += 80) {
      if (G.wallAt(x, y, clear)) continue;
      if (opts.nearWallDx) {
        const w = G.wallAt(x + opts.nearWallDx, y, 38);
        if (!w || w.circle) continue;          // want rock, not a turret
        if (G.wallAt(x + opts.nearWallDx * 0.45, y, 38)) continue;
      }
      if (opts.pred && !opts.pred(x, y)) continue;
      return { x, y };
    }
  }
  throw new Error('no open spot found');
}

let failures = 0, passes = 0;
function test(name, fn) {
  try {
    fn();
    passes++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')}`);
  }
}
function done() {
  const file = path.basename(process.argv[1] || 'test');
  console.log(`${file}: ${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}

module.exports = {
  assert, makeSim, park, parkAll, place, hero, maxSkills, frames, seconds, openSpot, test, done,
  LINEUP_BLUE, LINEUP_RED,
};
