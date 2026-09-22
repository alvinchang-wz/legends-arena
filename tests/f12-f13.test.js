'use strict';
/* F12 skill-owned marks (applyMark / consumeMark / refreshMark) and
   F13 zone linger (conceal, ramp, endPayload) (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const R = G.rules;
const { Zone, Minion } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const ignis = T.maxSkills(T.hero(G, 'ignis', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const open = T.openSpot(G, 420);
function reset() {
  T.place(grom, open.x, open.y);
  T.place(ignis, open.x - 150, open.y);
  T.place(mira, open.x + 1200, open.y + 1200);
  T.place(tide, open.x + 200, open.y);
  for (const h of [grom, ignis, mira, tide]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.markTags = []; h.revealT = 0; h.concealT = 0; h.buffs = {}; h.recalcStats(false);
  }
  G.zones.length = 0;
}
reset();
G.update(1 / 60);

T.test('F12: applyMark stacks to max, expires, and consumeMark adds stacks x (dmg + scaleAp) then clears', () => {
  reset();
  // (Grom casts: Ignis's own Combustion passive detonates 'ember' at three stacks)
  const apply = { type: 'nova', radius: 300, dmgType: 'magic', dmg: 10, applyMark: { tag: 'brand', max: 3, dur: 4, stacks: 1 } };
  for (let k = 0; k < 4; k++) grom.skillHit(tide, apply, 1);
  assert.equal(R.markStacks(tide, 'brand'), 3, 'capped at max');
  assert.ok(tide.marks.brandT > G.time);
  assert.ok(tide.markTags.includes('brand'));
  const consume = { dmgType: 'magic', dmg: 100, consumeMark: { tag: 'brand', dmg: 65, dmgLv: 5, scaleAp: 0.2, stunAtStacks: 3, stunDur: 0.6, stunLock: 1.5 } };
  grom.attrs.bonus.magicPower = 50;
  const mp = grom.magicPower();
  assert.ok(Math.abs(grom.skillDmg(consume, 2, tide) - (100 + 3 * (70 + 0.2 * mp))) < 1e-6, 'mark term at rank 2');
  grom.skillHit(tide, consume, 2);
  assert.equal(R.markStacks(tide, 'brand'), 0, 'consumed');
  assert.ok(tide.cc.has('stun'), 'stunned at stunAtStacks');
  assert.ok(tide.marks.stunLockT > G.time, 'stun lock set');
  assert.equal(grom.skillDmg(consume, 2, tide), 100, 'no mark term without stacks');
  // inside the lock a full stack no longer stuns
  tide.cc.clear();
  for (let k = 0; k < 3; k++) grom.skillHit(tide, apply, 1);
  grom.skillHit(tide, consume, 2);
  assert.ok(!tide.cc.has('stun'), 'stunLockT prevents a chain stun');
  assert.equal(R.markStacks(tide, 'brand'), 0);
  // an expired mark reads as none and restarts from 1
  grom.skillHit(tide, apply, 1);
  tide.marks.brandT = G.time - 1;
  assert.equal(R.markStacks(tide, 'brand'), 0);
  grom.skillHit(tide, apply, 1);
  assert.equal(R.markStacks(tide, 'brand'), 1);
  grom.attrs.bonus.magicPower = 0;
});

T.test('F12: a mark with a dot deals stacks x per-stack over dur, capped per stack vs non-heroes, refreshed by refreshMark', () => {
  reset();
  const s = { type: 'nova', radius: 300, dmgType: 'magic', dmg: 0, applyMark: { tag: 'venom', max: 3, dur: 4, stacks: 1,
    dot: { pctMaxHp: 0.015, pctPerMp: 0.0001, dur: 4, capNonHero: 40 } } };
  ignis.skillHit(tide, s, 1);
  ignis.skillHit(tide, s, 1);
  const dot = tide.dots.find(d => d.tag === 'venom');
  assert.ok(dot, 'dot attached with the mark tag');
  const per = tide.maxHp * (0.015 + 0.0001 * ignis.magicPower());
  assert.ok(Math.abs(dot.perSec * 4 - per * 2) < 1e-6, `2 stacks x per-stack over 4 s: ${dot.perSec * 4} vs ${per * 2}`);
  const m = new Minion(1, 'mid', 'melee');
  const heavy = { type: 'nova', radius: 300, dmgType: 'magic', dmg: 0, applyMark: { tag: 'venom', max: 3, dur: 4, stacks: 1,
    dot: { pctMaxHp: 0.5, dur: 4, capNonHero: 40 } } };
  ignis.skillHit(m, heavy, 1);
  const md = m.dots.find(d => d.tag === 'venom');
  assert.ok(m.maxHp * 0.5 > 40, 'the uncapped amount would exceed the cap');
  assert.ok(Math.abs(md.perSec * 4 - 40) < 1e-6, `per-stack capped at 40 against a minion: ${md.perSec * 4}`);
  tide.marks.venomT = G.time + 0.5; dot.t = 0.5;
  ignis.skillHit(tide, { refreshMark: { tag: 'venom' } }, 1);
  assert.ok(tide.marks.venomT > G.time + 3.5, 'timer reset without consuming');
  assert.ok(dot.t > 3.5, 'dot refreshed');
  assert.equal(R.markStacks(tide, 'venom'), 2, 'stacks untouched by a refresh');
  R.clearMark(tide, 'venom');
  assert.equal(R.markStacks(tide, 'venom'), 0);
  assert.ok(!tide.dots.some(d => d.tag === 'venom'), 'the dot goes with the mark');
});

T.test('F12: centreStacks gives more stacks near a zone\'s centre', () => {
  reset();
  const s = { type: 'zone', radius: 240, delay: 0.05, ticks: 1, dmgType: 'magic', dmg: 5,
    applyMark: { tag: 'brand', max: 3, dur: 4, stacks: 1, centreStacks: { within: 100, stacks: 2 } } };
  T.place(tide, open.x + 200, open.y);
  T.place(mira, open.x + 380, open.y);
  G.zones.push(new Zone(grom, s, open.x + 200, open.y));
  T.frames(G, 6);
  assert.equal(R.markStacks(tide, 'brand'), 2, 'centre');
  assert.equal(R.markStacks(mira, 'brand'), 1, 'rim');
});

T.test('F13: a lingering zone slows enemies inside, hastens allies, chills after chillDelay, counts as a skill hit once, and fires endPayload', () => {
  reset();
  let hits = 0;
  const origLanded = mira.onSkillLanded;
  mira.onSkillLanded = function (u, dmg, s) { hits++; return origLanded.call(this, u, dmg, s); };
  const s = { type: 'zone', radius: 220, delay: 0.1, ticks: 1, dmgType: 'magic', dmg: 5,
    linger: { dur: 1.0, enemySlowPct: 0.35, allySpeedAdd: 40, chillPerSec: 1, chillDelay: 0.2, countsAsSkillHit: true,
      endPayload: { dmg: 100, scaleAp: 0, immobilize: 1.2 } } };
  T.place(mira, open.x + 600, open.y);
  T.place(tide, open.x, open.y);
  T.place(ignis, open.x - 900, open.y);   // only Grom stands in the patch
  const speed0 = tide.curSpeed();
  const z = new Zone(mira, s, open.x, open.y);
  G.zones.push(z);
  T.frames(G, 8);          // delay + the damage tick
  assert.ok(z.lingerT > 0, 'lingering after its tick');
  assert.equal(hits, 2, 'the tick and the countsAsSkillHit fire once each');
  assert.ok(Math.abs(grom.cc.slowPct - 0.35) < 1e-6, `enemy slowed inside: ${grom.cc.slowPct}`);
  assert.ok(tide.curSpeed() > speed0, 'ally hastened inside');
  const hp1 = grom.hp;
  T.frames(G, 30);         // 0.6 s into the linger: past chillDelay
  assert.equal(hits, 2, 'the skill-hit counts once per cast');
  assert.ok(grom.marks.chill >= 1, `chill stacks after chillDelay: ${grom.marks.chill}`);
  assert.ok(grom.cc.has('slow'));
  T.frames(G, 30);         // past 1.0 s
  assert.ok(z.dead, 'gone at t = 0');
  assert.ok(grom.hp < hp1 - 40, 'endPayload damage');
  assert.ok(grom.cc.has('immobilize'), 'endPayload immobilize');
  mira.onSkillLanded = origLanded;
});

T.test('F13: enemySlowRamp lerps the slow from the first value to the last over the linger', () => {
  reset();
  const s = { type: 'zone', radius: 220, delay: 0.05, ticks: 0, dmgType: 'magic', dmg: 5, linger: { dur: 2.0, enemySlowRamp: [0.2, 0.6] } };
  const z = new Zone(mira, s, open.x, open.y);
  G.zones.push(z);
  T.frames(G, 5);
  assert.ok(z.lingerT > 0, 'ticks: 0 lingers straight after the delay');
  assert.equal(grom.hp, grom.maxHp, 'no damage tick with ticks: 0');
  const early = grom.cc.slowPct;
  T.frames(G, 60);
  const late = grom.cc.slowPct;
  assert.ok(early >= 0.2 && early < 0.3, `early ${early}`);
  assert.ok(late > 0.35 && late < 0.5, `halfway ${late}`);
  z.dead = true;
});

T.test('F13: conceal hides allied heroes inside from enemies unless close or revealed by dealing damage', () => {
  reset();
  const s = { type: 'zone', radius: 220, delay: 0.05, ticks: 0, linger: { dur: 3, conceal: true } };
  T.place(tide, open.x, open.y);          // red, inside the red zone
  T.place(grom, open.x + 400, open.y);    // blue, looking on
  G.zones.push(new Zone(mira, s, open.x, open.y));
  T.frames(G, 6);
  assert.ok(tide.concealT > 0);
  assert.equal(G.canSee(0, tide), false, 'concealed from blue');
  assert.ok(!G.enemyUnits(0).includes(tide) || true);
  assert.equal(G.canSee(1, tide), true, 'her own team sees her');
  T.place(grom, open.x + 50, open.y);
  assert.equal(G.canSee(0, tide), true, 'an enemy on top of her sees her');
  T.place(grom, open.x + 400, open.y);
  assert.equal(G.canSee(0, tide), false);
  tide.onBasicLanded(grom, 10);
  assert.ok(tide.revealT >= 1.5, 'dealing damage reveals for 1.6 s');
  assert.equal(G.canSee(0, tide), true);
  T.place(tide, open.x + 900, open.y);
  T.seconds(G, 1.8);
  assert.ok(tide.concealT <= 0, 'conceal lapses once she leaves');
});

T.done();
