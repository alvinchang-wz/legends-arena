'use strict';
/* F15 displacement tween with wall collision (docs/design/heroes.md):
   knockbacks and pulls are carried over frames, stop at rock with wallDmg /
   wallStun, ignore tenacity, respect Purify, wait for a dash, keep a hook. */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const R = G.rules;
const { Zone, Minion } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const open = T.openSpot(G, 300);
G.update(1 / 60);

function reset(x = open.x, y = open.y) {
  T.place(grom, x - 120, y);
  T.place(tide, x, y);
  tide.forced = null; tide.dashS = null; tide.cc.clear(); tide.cc.immuneT = 0;
  tide.hp = tide.maxHp; tide.marks = {};
}

T.test('F15: a knockback tweens over frames instead of teleporting', () => {
  reset();
  R.applySkillCC(grom, tide, { knockback: 200 }, 1);
  assert.ok(tide.forced && tide.forced.mode === 'slide');
  assert.equal(tide.x, open.x, 'nothing moved at the moment of the hit');
  G.update(1 / 60);
  const step1 = tide.x - open.x;
  assert.ok(step1 > 8 && step1 < 20, `one frame of a 0.25 s slide: ${step1}`);
  T.frames(G, 20);
  assert.ok(Math.abs(tide.x - (open.x + 200)) < 1.5, `landed at +200: ${tide.x - open.x}`);
  assert.ok(Math.abs(tide.y - open.y) < 1e-6);
  assert.equal(tide.forced, null, 'free the moment it stops');
  assert.ok(tide.marks.heavyUntil > G.time, 'heavy mark for Nadir');
});

T.test('F15: the tween ignores tenacity but is refused by Purify immunity', () => {
  reset();
  tide.addTimedBuff('tenacity', 0.6, 5);
  R.applySkillCC(grom, tide, { knockback: 200 }, 1);
  T.frames(G, 20);
  assert.ok(Math.abs(tide.x - (open.x + 200)) < 1.5, `full distance with 60% tenacity: ${tide.x - open.x}`);
  tide.buffs.tenacity = null; tide.recalcStats(false);
  reset();
  tide.cc.purify(1.0);
  assert.equal(R.applyKnockback(grom, tide, 200), false);
  assert.equal(tide.forced, null);
  T.frames(G, 5);
  assert.equal(tide.x, open.x);
  tide.cc.immuneT = 0;
});

T.test('F15: a slide stops at rock, applies wallDmg and wallStun; noWallCC fires only when nothing was hit', () => {
  const near = T.openSpot(G, 60, { nearWallDx: 140 });
  reset(near.x, near.y);
  const s = { knockback: 400, dmgType: 'magic', wallDmg: 100, wallScaleAp: 0.5, wallStun: 0.6, noWallCC: { airborne: 0.5 } };
  R.applySkillCC(grom, tide, s, 1);
  T.frames(G, 30);
  const moved = tide.x - near.x;
  assert.ok(moved > 0 && moved < 140, `stopped short of the rock: ${moved}`);
  assert.ok(!G.wallAt(tide.x, tide.y, tide.radius), 'never inside the wall');
  assert.ok(tide.hp < tide.maxHp, 'wallDmg landed');
  assert.ok(tide.cc.has('stun'), 'wallStun landed');
  assert.ok(!tide.cc.has('airborne'), 'noWallCC does not fire on a wall hit');
  assert.equal(tide.forced, null);
  // in the open the same skill launches instead (shorter shove: the spot is clear for 300)
  reset();
  R.applySkillCC(grom, tide, Object.assign({}, s, { knockback: 220 }), 1);
  T.frames(G, 30);
  assert.ok(Math.abs(tide.x - (open.x + 220)) < 1.5, `open-air shove ${tide.x - open.x}`);
  assert.ok(tide.cc.has('airborne'), 'noWallCC airborne when no wall stopped it');
  assert.ok(!tide.cc.has('stun'));
  assert.equal(tide.hp, tide.maxHp, 'no wallDmg without a wall');
});

T.test('F15: a negative knockback pulls toward the caster and stops at the bodies', () => {
  reset();
  T.place(tide, open.x + 200, open.y);
  T.place(grom, open.x, open.y);
  R.applySkillCC(grom, tide, { knockback: -80 }, 1);
  T.frames(G, 25);
  assert.ok(Math.abs(tide.x - (open.x + 120)) < 1.5, `pulled 80: ${tide.x - open.x}`);
  T.place(tide, open.x + 90, open.y);
  R.applySkillCC(grom, tide, { knockback: -140 }, 1);
  T.frames(G, 25);
  const gap = tide.x - open.x;
  assert.ok(Math.abs(gap - (grom.radius + tide.radius)) < 1.5, `stops at the bodies: ${gap}`);
});

T.test('F15: pullTo drags toward the caster by dist at speed', () => {
  reset();
  T.place(tide, open.x + 300, open.y);
  T.place(grom, open.x, open.y);
  R.applySkillCC(grom, tide, { pullTo: { target: 'caster', dist: 120, speed: 900 } }, 1);
  T.frames(G, 3);
  assert.ok(tide.forced, 'still travelling after 3 frames at 900 u/s');
  T.frames(G, 12);
  assert.ok(Math.abs(tide.x - (open.x + 180)) < 1.5, `pulled 120: ${tide.x - open.x}`);
  assert.equal(tide.forced, null);
});

T.test('F15: a dash in progress finishes first, then the shove resumes with the time it has left', () => {
  reset();
  tide.dashS = { dx: 0, dy: 1, remaining: 100, speed: 1000, dmg: 0, hitSet: new Set(), s: tide.skills[1], rank: 1 };
  R.applySkillCC(grom, tide, { knockback: 200 }, 1);
  T.frames(G, 3);
  assert.ok(tide.forced, 'the shove is pending while the dash runs');
  assert.equal(tide.x, open.x, 'no sideways movement during the dash');
  assert.ok(tide.y > open.y + 40, 'the dash moved the hero');
  T.frames(G, 25);
  assert.ok(Math.abs(tide.y - (open.y + 100)) < 1.5, 'dash completed');
  const slid = tide.x - open.x;
  assert.ok(slid > 80 && slid < 200, `the remaining slide time carried it ${slid}`);
  assert.equal(tide.forced, null);
});

T.test('F15: a unit already dragged by a hook keeps the hook', () => {
  reset();
  tide.forced = { mode: 'hook', src: grom, t: 0.6 };
  assert.equal(R.applyKnockback(grom, tide, 200), false);
  assert.equal(tide.forced.mode, 'hook');
  tide.forced = null;
});

T.test('F15: minions are shoved by the same tween; structures never are', () => {
  const m = new Minion(1, 'mid', 'melee');
  T.place(m, open.x, open.y + 100);
  G.minions.push(m);
  T.place(grom, open.x - 120, open.y + 100);
  R.applySkillCC(grom, m, { knockback: 150 }, 1);
  assert.ok(m.forced);
  T.frames(G, 15);   // exactly the 0.25 s slide; afterwards the minion walks its lane again
  assert.ok(Math.abs(m.x - (open.x + 150)) < 4, `minion moved ${m.x - open.x}`);
  assert.equal(m.forced, null);
  m.alive = false;
  const tower = G.towers.find(t => t.team === 1);
  const tx = tower.x;
  assert.equal(R.applyKnockback(grom, tower, 150), false);
  assert.equal(tower.x, tx);
});

T.test('F15: a zone with pullSpeed drags enemy heroes toward its centre while it arms', () => {
  reset();
  const s = { type: 'zone', radius: 280, delay: 0.9, ticks: 1, dmg: 1, pullSpeed: 260 };
  const z = new Zone(grom, s, open.x - 200, open.y);
  G.zones.push(z);
  T.frames(G, 30);   // 0.5 s
  const pulled = open.x - tide.x;
  assert.ok(pulled > 110 && pulled < 150, `0.5 s at 260 u/s: ${pulled}`);
  assert.ok(tide.marks.heavyUntil > G.time);
  z.dead = true;
});

T.done();
