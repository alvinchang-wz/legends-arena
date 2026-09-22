'use strict';
/* F14 projectile bounce, F10 boomerang return projectile, F11 cone hitbox,
   F20 hero-only projectile and %-max-HP damage with caps
   (docs/design/heroes.md, "New engine features required"). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const { Minion } = sim.context;
T.parkAll(G);

const ignis = T.maxSkills(T.hero(G, 'ignis', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const sylva = T.maxSkills(T.hero(G, 'sylva', 1));
const open = T.openSpot(G, 420);

function ownSkill(h, i, def) {
  h.def0 = Object.assign({}, h.def0);
  h.def0.skills = h.def0.skills.map(s => Object.assign({}, s));
  const s = h.def0.skills[i];
  for (const k of Object.keys(s)) if (!['name', 'icon'].includes(k)) delete s[k];
  Object.assign(s, def);
  return s;
}
function reset() {
  T.place(ignis, open.x, open.y);
  T.place(zephyr, open.x - 300, open.y - 300);
  T.place(mira, open.x + 1400, open.y + 1400);
  T.place(tide, open.x + 1400, open.y + 1200);
  T.place(sylva, open.x + 1200, open.y + 1400);
  for (const h of [ignis, zephyr, mira, tide, sylva]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.spawnProtT = 0; h.stats.dmgTaken = 0;
    h.recalcStats(false);
  }
  G.projectiles.length = 0; G.tethers.length = 0;
  G.minions = G.minions.filter(m => !m._test);
}
/* A parked enemy minion for the hero-only and hero-bias cases. */
function minion(x, y) {
  const m = new Minion(1, 'mid', 'melee');
  m._test = true; m.update = () => {};
  T.place(m, x, y);
  G.minions.push(m);
  return m;
}
function shot(h, i, point) {
  assert.ok(h.castSkill(i, point), 'cast accepted');
  const p = G.projectiles[G.projectiles.length - 1];
  assert.ok(p && p.kind === 'skillshot');
  return p;
}
reset();
G.update(1 / 60);

T.test('F14: a bounce reaches a second target with decayed damage, prefers heroes over a nearer minion, dies with nothing in range', () => {
  reset();
  const s = ownSkill(ignis, 0, { type: 'skillshot', cd: 5, mana: 0, dmgType: 'true', dmg: 200, range: 680, speed: 1100, radius: 22,
    bounce: { count: 2, range: 320, decay: 0.75 } });
  T.place(mira, open.x + 300, open.y);
  T.place(tide, open.x + 300, open.y + 240);        // 240 from Mira: in bounce range
  const m = minion(open.x + 450, open.y + 120);     // a minion 192 from both: nearer to Mira than Tide is
  const p = shot(ignis, 0, { x: mira.x, y: mira.y });
  assert.equal(p.bounceLeft, 2);
  T.frames(G, 20);
  assert.ok(mira.stats.dmgTaken > 0, 'first target hit');
  assert.equal(p.bounceLeft, 1, 'one bounce spent');
  assert.equal(p.bounceTarget, tide, 'the hero is preferred over the nearer minion (bias 150)');
  assert.ok(!p.dead, 'still flying');
  let n = 0;
  while (!(tide.stats.dmgTaken > 0) && n++ < 40) G.update(1 / 60);
  assert.ok(tide.stats.dmgTaken > 0, 'second target hit');
  assert.equal(m.hp, m.maxHp, 'the minion was passed over on the way to the hero');
  const ratio = tide.stats.dmgTaken / mira.stats.dmgTaken;
  assert.ok(Math.abs(ratio - 0.75) < 0.02, `decayed to 0.75: ${ratio}`);
  // the third bounce: the minion is the only thing left in range
  assert.equal(p.bounceTarget, m, 'then the minion, being all that is left');
  T.frames(G, 20);
  assert.ok(m.hp < m.maxHp, 'third victim hit');
  assert.ok(p.dead, 'count exhausted: gone');
  assert.equal(p.bounceLeft, 0);
  // a lone target: the shot dies on the hit
  reset();
  T.place(mira, open.x + 300, open.y);
  const q = shot(ignis, 0, { x: mira.x, y: mira.y });
  T.frames(G, 20);
  assert.ok(q.dead, 'no second target: dead');
  assert.equal(q.bounceLeft, 2, 'no bounce was spent');
});

T.test('F10: a boomerang turns at max range, homes back to the caster, can hit on the way back with the return slow', () => {
  reset();
  ownSkill(ignis, 0, { type: 'skillshot', cd: 10, mana: 0, dmgType: 'physical', dmg: 80, scaleAd: 0.45, range: 400, speed: 850, radius: 28,
    boomerang: true, returnSlowPct: 0.4, returnSlowDur: 1.2 });
  T.place(mira, open.x + 200, open.y + 140);        // beside the line: missed on the way out
  const p = shot(ignis, 0, { x: open.x + 500, y: open.y });
  T.frames(G, 25);                                  // ~354 out
  assert.ok(!p.returning && !p.dead, 'still outbound');
  T.frames(G, 6);                                   // past 400
  assert.ok(p.returning, 'turned at max range');
  assert.equal(mira.stats.dmgTaken, 0, 'missed on the way out');
  // step onto the line: the return pass finds her
  T.place(mira, open.x + 200, open.y);
  T.frames(G, 20);
  assert.ok(mira.stats.dmgTaken > 0, 'hit on the way back');
  assert.ok(Math.abs(mira.cc.slowPct - 0.4) < 1e-9, 'return slow applied');
  assert.ok(mira.cc.t.slow > 1.0, 'for the return slow duration');
  assert.ok(p.spent, 'non-pierce: one hit per pass');
  assert.ok(!p.dead, 'still flying home');
  T.frames(G, 25);
  assert.ok(p.dead, 'gone once it reached the caster');
  // the caster moving: it follows him
  reset();
  const q = shot(ignis, 0, { x: open.x + 500, y: open.y });
  T.frames(G, 31);
  assert.ok(q.returning);
  T.place(ignis, open.x - 100, open.y + 300);
  T.frames(G, 40);
  assert.ok(q.dead, 'homed to the caster where he is now');
  // the caster dying removes it
  reset();
  const r = shot(ignis, 0, { x: open.x + 500, y: open.y });
  T.frames(G, 31);
  ignis.alive = false; ignis.respawnT = 60;
  G.update(1 / 60);
  assert.ok(r.dead, 'caster died: removed');
  ignis.alive = true; ignis.respawnT = 0;
});

T.test('F10: an outbound hit turns the boomerang instead of ending it; the hitSet is cleared so the same unit is hit again on the return', () => {
  reset();
  T.place(mira, open.x + 200, open.y);
  const p = shot(ignis, 0, { x: open.x + 500, y: open.y });
  let n = 0;
  while (!p.returning && n++ < 30) G.update(1 / 60);
  assert.ok(p.returning, 'turned on the first hit');
  assert.ok(n < 14, `turned early, on the hit, not at max range (${n} frames)`);
  const first = mira.stats.dmgTaken;
  assert.ok(first > 0);
  assert.equal(mira.cc.slowPct, 0, 'no slow on the outbound pass');
  assert.ok(!p.hitSet.has(mira), 'hitSet cleared on the turn');
  // it turned at the edge of her body; she steps into the return path
  T.place(mira, mira.x - 120, mira.y);
  T.frames(G, 8);
  assert.ok(mira.stats.dmgTaken > first, 'hit again on the return');
  assert.ok(Math.abs(mira.cc.slowPct - 0.4) < 1e-9, 'slowed by the return pass');
});

T.test('F11: a cone hits every enemy inside its angle and length, per victim, and nothing outside', () => {
  reset();
  const s = ownSkill(ignis, 0, { type: 'cone', cd: 6, mana: 45, dmgType: 'magic', dmg: 150, scaleAp: 0.75, angle: 60, length: 480,
    applyMark: { tag: 'cinder', max: 3, dur: 4 } });
  T.place(mira, open.x + 300, open.y);                                     // dead ahead
  const a = 50 * Math.PI / 180;
  T.place(tide, open.x + Math.cos(a) * 300, open.y + Math.sin(a) * 300);   // 50 degrees off: outside a 60 degree fan
  T.place(sylva, open.x + 600, open.y);                                    // beyond the length
  const b = 28 * Math.PI / 180;
  T.place(zephyr, open.x + Math.cos(b) * 200, open.y + Math.sin(b) * 200);  // an ally: never
  const mana0 = ignis.mana;
  assert.ok(ignis.castSkill(0, { x: open.x + 400, y: open.y }));
  assert.equal(ignis.mana, mana0 - 45);
  assert.ok(mira.stats.dmgTaken > 0, 'inside: hit');
  assert.equal(G.rules.markStacks(mira, 'cinder'), 1, 'applyMark landed');
  assert.equal(tide.stats.dmgTaken, 0, 'outside the angle: missed');
  assert.equal(sylva.stats.dmgTaken, 0, 'beyond the length: missed');
  assert.equal(zephyr.stats.dmgTaken, 0, 'allies are not victims');
  // a body straddling the edge counts: 33 degrees off with a 38 radius at 200 (asin(38/200) = 11 degrees)
  reset();
  const c = 33 * Math.PI / 180;
  T.place(tide, open.x + Math.cos(c) * 200, open.y + Math.sin(c) * 200);
  assert.ok(ignis.castSkill(0, { x: open.x + 400, y: open.y }));
  assert.ok(tide.stats.dmgTaken > 0, 'edge body hit');
  // instant: nothing is left in flight, and it is per victim (Ember stacks read per target)
  assert.equal(G.projectiles.length, 0);
  assert.equal(ignis.doCone(s, 6, { x: 1, y: 0 }), 1, 'doCone reports one victim');
});

T.test('F20: a hero-only shot flies through minions to the hero behind them; pctMaxHp is capped against non-heroes', () => {
  reset();
  const s = ownSkill(ignis, 0, { type: 'skillshot', cd: 5, mana: 0, dmgType: 'magic', dmg: 90, scaleAp: 0.5, range: 560, speed: 1000, radius: 20,
    heroOnly: true, pctMaxHp: 0.1, pctMaxHpCap: 60 });
  const m = minion(open.x + 150, open.y);
  T.place(mira, open.x + 400, open.y);
  const p = shot(ignis, 0, { x: mira.x, y: mira.y });
  T.frames(G, 30);
  assert.ok(p.dead, 'landed');
  assert.equal(m.hp, m.maxHp, 'the minion in front was ignored');
  assert.ok(mira.stats.dmgTaken > 0, 'the hero behind it was hit');
  // %-max-HP: full against a hero, capped against a minion, never against a structure
  const base = 90 + ignis.magicPower() * 0.5;
  assert.ok(Math.abs(ignis.skillDmg(s, 1, mira) - (base + mira.maxHp * 0.1)) < 1e-6, 'hero: +10% max HP');
  assert.ok(Math.abs(ignis.skillDmg(s, 1, m) - (base + Math.min(60, m.maxHp * 0.1))) < 1e-6, 'minion: capped');
  const tower = G.towers.find(t => t.team === 1 && t.alive);
  assert.ok(Math.abs(ignis.skillDmg(s, 1, tower) - base) < 1e-6, 'structure: no %-HP term');
  // a %-max-HP dot from applyMark is capped per stack against non-heroes too
  const mk = { applyMark: { tag: 'venom', max: 3, dur: 4, dot: { pctMaxHp: 0.015, dur: 4, capNonHero: 40 } } };
  G.rules.applyMark(ignis, mira, mk, 1);
  G.rules.applyMark(ignis, m, mk, 1);
  const dh = mira.dots.find(d => d.tag === 'venom'), dm = m.dots.find(d => d.tag === 'venom');
  assert.ok(Math.abs(dh.perSec * 4 - mira.maxHp * 0.015) < 1e-6, 'hero dot: 1.5% max HP per stack');
  assert.ok(Math.abs(dm.perSec * 4 - Math.min(40, m.maxHp * 0.015)) < 1e-6, 'minion dot: capped');
  // a non-hero-only shot still stops on the minion
  reset();
  delete s.heroOnly;
  const m2 = minion(open.x + 150, open.y);
  T.place(mira, open.x + 400, open.y);
  const q = shot(ignis, 0, { x: mira.x, y: mira.y });
  T.frames(G, 30);
  assert.ok(q.dead);
  assert.ok(m2.hp < m2.maxHp, 'the minion took it');
  assert.equal(mira.stats.dmgTaken, 0, 'the hero did not');
});

T.done();
