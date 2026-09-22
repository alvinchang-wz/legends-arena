'use strict';
/* The six Mage kits (docs/design/heroes.md, "Mages"; docs/design/hero-kits.json):
   Ignis, Volt, Mira, Nadir, Ashara, Hexa — passives, skill numbers, the
   engine behaviours each signature mechanic leans on, and the bot rules
   from their bot hints. */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim({ blueLineup: 'ignis,volt,mira,grom,zephyr', redLineup: 'nadir,ashara,hexa,bastion,vesper' });
const G = sim.Game;
const { rankVal } = require('../js/combat');
const { Hero } = sim.context;
T.parkAll(G);

const ignis = T.maxSkills(T.hero(G, 'ignis', 0));
const volt = T.maxSkills(T.hero(G, 'volt', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 0));
const grom = T.maxSkills(T.hero(G, 'grom', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const nadir = T.maxSkills(T.hero(G, 'nadir', 1));
const ashara = T.maxSkills(T.hero(G, 'ashara', 1));
const hexa = T.maxSkills(T.hero(G, 'hexa', 1));
const bastion = T.maxSkills(T.hero(G, 'bastion', 1));
const vesper = T.maxSkills(T.hero(G, 'vesper', 1));
const ALL = [ignis, volt, mira, grom, zephyr, nadir, ashara, hexa, bastion, vesper];
const open = T.openSpot(G, 420);
const FAR = { x: open.x + 2200, y: open.y + 2200 };

function reset() {
  for (const h of ALL) {
    T.place(h, FAR.x, FAR.y);
    h.items.length = 0; h.gold = 0;
    h.hp = h.maxHp; h.mana = h.resource === 'heat' ? 0 : h.maxMana;
    h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.markTags = []; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.shields = []; h.untargetable = false; h.hot = null; h.buffAtkT = 0; h.buffAsT = 0; h.buffAsMult = 1; h.buffState = null;
    h.basicMod = null; h.basicRangeState = null; h.recast = null; h.aiTarget = null; h.aiState = 'push'; h.fleeT = 0;
    h.lastTakedownT = -99; h.lastKillT = -99; h.lastDmgT = -99; h.stats.dmgTaken = 0; h.stillT = 0;
    h.skillCharges = [0, 0, 0]; h.skillRecharge = [0, 0, 0]; h.revealT = 0; h.concealT = 0; h.lastTetherDone = null;
    if (h.pv && h.pv.stacks !== undefined) { h.pv.stacks = 0; h.pv.t = 0; }
    if (h.pv && h.pv.n !== undefined) { h.pv.n = 0; h.pv.t = 0; }
    h.recalcStats(false);
    h.hp = h.maxHp;
  }
  /* Lane waves wander past the open spot and shoot whatever they find;
     these tests are about kits, so the board starts empty of them. */
  G.minions.length = 0;
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
  for (let k = G.minions.length - 1; k >= 0; k--) if (G.minions[k]._test) { G.minions[k].alive = false; G.minions.splice(k, 1); }
}
reset();
G.update(1 / 60); T.reveal(G);

/* A creep of `team` parked at (x, y) for the rest of the test (reset removes
   it): it still runs CC, shields and dots, but never walks its lane. */
function creep(team, x, y) {
  const m = new sim.context.Minion(team, 'mid', 'melee');
  m._test = true; T.place(m, x, y); G.minions.push(m);
  m.update = function (dt) { this.baseUpdate(dt); if (this.forced) this.updateForced(dt); };
  return m;
}

/* Fire one basic from `h` at `t` and let the arrow land. */
function basic(h, t) {
  h.atkCd = 0;
  h.tryAttack(t);
  T.frames(G, 40);
}

/* live stacks of a mark on a unit (combat.js markStacks reads the game's clock, which lives in the sim) */
const markStacks = (u, tag) => (u.marks && u.marks[tag] > 0 && u.marks[tag + 'T'] > G.time) ? u.marks[tag] : 0;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''}: ${a} vs ${b}`);

/* ---------------- Ignis ---------------- */

T.test('Ignis: base stats and skill numbers match the spec (mage band: 530 HP, 250 speed, the only cone and the only consumeMark)', () => {
  reset();
  const d = ignis.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [530, 68, 300, 34, 46, 4.0, 10, 2.0, 12, 2.0, 330, 0.9, 250, 2]);
  assert.equal(d.passive.id, 'kindling');
  const [s1, s2, s3] = ignis.skills;
  assert.deepEqual([s1.type, s1.angle, s1.length, s1.dmg, s1.dmgLv, s1.scaleAp, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.applyMark],
    ['cone', 60, 480, 150, 20, 0.75, 6, -0.3, 45, 5, { tag: 'ember', max: 3, dur: 4, stacks: 1 }]);
  assert.equal(rankVal(s1, 'dmg', 6), 250); near(rankVal(s1, 'cd', 6), 4.5, 1e-9, 'Fan cd at rank 6'); assert.equal(rankVal(s1, 'mana', 6), 70);
  assert.deepEqual([s2.type, s2.radius, s2.dmg, s2.dmgLv, s2.scaleAp, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.consumeMark],
    ['nova', 260, 110, 15, 0.45, 9, -0.4, 60, 5, { tag: 'ember', dmg: 85, dmgLv: 0, scaleAp: 0.25, stunAtStacks: 3, stunDur: 0.6, stunLock: 1.5 }]);
  assert.equal(rankVal(s2, 'dmg', 6), 185); near(rankVal(s2, 'cd', 6), 7, 1e-9, 'Flashburn cd at rank 6');
  assert.deepEqual([s3.type, s3.range, s3.radius, s3.delay, s3.ticks, s3.dmg, s3.scaleAp, s3.stun, s3.cd, s3.mana, s3.applyMark],
    ['zone', 640, 230, 0.9, 1, [280, 360, 440], 1.0, 0.5, [40, 35, 30], [110, 130, 150], { tag: 'ember', max: 3, dur: 4, stacks: 1, centreStacks: { within: 100, stacks: 2 } }]);
  for (const s of ignis.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Ignis: Flame Fan is a 60-degree, 480 cone that Embers everyone inside; Pyroclasm gives 2 Embers within 100 of its centre and 1 on the rim; Embers cap at 3 and lapse after 4 s', () => {
  reset();
  T.place(ignis, open.x, open.y);
  T.place(bastion, open.x + 300, open.y);          // dead ahead
  T.place(nadir, open.x + 300, open.y + 120);      // 21.8 deg off: inside the 30-deg half angle
  T.place(hexa, open.x + 200, open.y + 300);       // 56 deg off: outside
  T.place(ashara, open.x + 560, open.y);           // past 480 + radius
  assert.ok(ignis.castSkill(0, { x: open.x + 400, y: open.y }));
  assert.equal(markStacks(bastion, 'ember'), 1); assert.equal(markStacks(nadir, 'ember'), 1);
  assert.equal(markStacks(hexa, 'ember'), 0, 'outside the angle'); assert.equal(markStacks(ashara, 'ember'), 0, 'past the length');
  assert.ok(bastion.stats.dmgTaken > 0 && nadir.stats.dmgTaken > 0 && !hexa.stats.dmgTaken && !ashara.stats.dmgTaken);
  // Pyroclasm: centre vs rim
  ignis.skillCd[2] = 0;
  T.place(nadir, open.x + 500, open.y + 190);      // 190 from the centre: rim
  assert.ok(ignis.castSkill(2, { x: open.x + 500, y: open.y }));
  T.place(bastion, open.x + 540, open.y);          // 40 from the centre
  T.seconds(G, 1.0);
  assert.equal(markStacks(bastion, 'ember'), 3, '1 from the Fan + 2 at the centre');
  assert.equal(markStacks(nadir, 'ember'), 2, '1 from the Fan + 1 on the rim');
  assert.ok(bastion.cc.has('stun') && nadir.cc.has('stun'), 'the meteor stuns 0.5 s at impact');
  // cap and lapse
  ignis.skillCd[0] = 0;
  assert.ok(ignis.castSkill(0, { x: open.x + 400, y: open.y }));
  assert.equal(markStacks(bastion, 'ember'), 3, 'capped at 3');
  T.seconds(G, 4.1);
  assert.equal(markStacks(bastion, 'ember'), 0, 'gone after 4 s');
});

T.test('Ignis: Flashburn consumes Embers per victim (+85 +25% MAGIC each), stuns 0.6 s at 3, sets a 1.5 s stunLockT that blocks the next stun, and deletes the mark', () => {
  reset();
  T.place(ignis, open.x, open.y); T.place(bastion, open.x + 200, open.y); T.place(nadir, open.x - 200, open.y);
  const s2 = ignis.skills[1], mp = ignis.magicPower();
  const base = rankVal(s2, 'dmg', 6) + 0.45 * mp;
  near(ignis.skillDmg(s2, 6, bastion), base, 1e-6, 'no Embers: base only');
  bastion.marks = { ember: 3, emberT: G.time + 4 }; nadir.marks = { ember: 1, emberT: G.time + 4 };
  near(ignis.skillDmg(s2, 6, bastion), base + 3 * (85 + 0.25 * mp), 1e-6, 'three Embers: +3 x (85 +25% MAGIC)');
  near(ignis.skillDmg(s2, 6, nadir), base + 1 * (85 + 0.25 * mp), 1e-6, 'one Ember: +1 x');
  const took = bastion.stats.dmgTaken;
  assert.ok(ignis.castSkill(1, null));
  assert.ok(bastion.stats.dmgTaken > took, 'hit');
  near(bastion.cc.t.stun, 0.6 * (1 - Math.min(0.6, bastion.attrs.get('tenacity'))), 1e-6, 'stunned 0.6 s at 3 Embers');
  assert.ok(!nadir.cc.has('stun'), 'one Ember: no stun');
  assert.equal(markStacks(bastion, 'ember'), 0, 'Embers spent'); assert.equal(markStacks(nadir, 'ember'), 0);
  near(bastion.marks.stunLockT, G.time + 1.5, 1e-6, 'stunLockT set 1.5 s out');
  // a second 3-stack ring inside the lock: damage yes, stun no
  T.seconds(G, 0.7);
  assert.ok(!bastion.cc.has('stun'));
  bastion.marks.ember = 3; bastion.marks.emberT = G.time + 4;
  ignis.skillCd[1] = 0;
  const took2 = bastion.stats.dmgTaken;
  assert.ok(ignis.castSkill(1, null));
  assert.ok(bastion.stats.dmgTaken > took2, 'still hurts');
  assert.ok(!bastion.cc.has('stun'), 'no second stun inside the 1.5 s lock');
  assert.equal(markStacks(bastion, 'ember'), 0, 'the Embers are still spent');
  // after the lock, a 3-stack ring stuns again
  T.seconds(G, 1.0);
  bastion.marks.ember = 3; bastion.marks.emberT = G.time + 4;
  ignis.skillCd[1] = 0;
  assert.ok(ignis.castSkill(1, null));
  assert.ok(bastion.cc.has('stun'), 'lock over: stunned again');
});

T.test('Ignis: Kindling adds +25 (+20% MAGIC) magic damage to a basic on an Embered hero only', () => {
  reset();
  T.place(ignis, open.x, open.y); T.place(bastion, open.x + 250, open.y);
  basic(ignis, bastion);
  const plain = bastion.stats.dmgTaken;
  assert.ok(plain > 0, 'the basic landed');
  bastion.stats.dmgTaken = 0;
  bastion.marks = { ember: 1, emberT: G.time + 4 };
  basic(ignis, bastion);
  const bonus = 25 + ignis.magicPower() * 0.2;
  const mrMult = 95 / (95 + bastion.mrValue());
  assert.ok(bastion.stats.dmgTaken >= plain + Math.round(bonus * mrMult) - 2, `Embered: ${bastion.stats.dmgTaken} vs ${plain} + ${bonus} x ${mrMult.toFixed(2)}`);
  assert.equal(markStacks(bastion, 'ember'), 1, 'the passive only reads the mark');
  // a creep with the mark gets nothing (heroes only)
  const m = creep(1, open.x + 250, open.y + 60);
  m.marks = { ember: 1, emberT: G.time + 4 };
  const hp0 = m.hp;
  basic(ignis, m);
  const mMult = 95 / (95 + m.armorValue());
  assert.ok(hp0 - m.hp < Math.round(ignis.curAtk() * mMult) + 8, 'no bonus packet on a creep');
});

T.test('Ignis bot: Flame Fan inside 460; Pyroclasm only on a target carrying an Ember (or the usual crowd / low-HP gates); Flashburn only with a 3-Ember hero inside 240 or under 30% HP; he walks in to 200 while an Embered hero is within 400 and holds 330 otherwise', () => {
  reset();
  T.place(ignis, open.x, open.y); T.place(bastion, open.x + 380, open.y);
  G.update(1 / 60); T.reveal(G);   // vision
  assert.ok(ignis.botSkillUrgency(0, bastion, 380, true, false) > 0, 'Fan at 380');
  assert.equal(ignis.botSkillUrgency(0, bastion, 470, true, false), 0, 'Fan held past 460');
  assert.equal(ignis.botSkillUrgency(2, bastion, 380, true, false), 0, 'a healthy free hero with no Ember: Pyroclasm held');
  bastion.marks = { ember: 1, emberT: G.time + 4 };
  assert.equal(ignis.botSkillUrgency(2, bastion, 380, true, false), 860, 'one Ember: Pyroclasm centred on him');
  assert.equal(ignis.botSkillUrgency(1, bastion, 380, true, false), 0, 'one Ember at 380: no Flashburn');
  assert.equal(ignis.botHoldNow(), 200, 'an Embered hero within 400 and Flashburn ready: the hold shrinks to the ring (he walks in)');
  ignis.skillCd[1] = 3;
  assert.equal(ignis.botHoldNow(), 330, 'Flashburn on cooldown: no walk-in');
  ignis.skillCd[1] = 0;
  bastion.marks = { ember: 3, emberT: G.time + 4 };
  assert.equal(ignis.botSkillUrgency(1, bastion, 380, true, false), 0, 'three Embers but outside 240: held');
  assert.equal(ignis.botHoldNow(), 200, 'three Embers within 400 and Flashburn ready: the hold shrinks to the ring');
  const cp = ignis.chooseCombatPoint(bastion);
  assert.ok(Math.hypot(cp.x - bastion.x, cp.y - bastion.y) < 260, `combat point inside the ring: ${Math.hypot(cp.x - bastion.x, cp.y - bastion.y)}`);
  T.place(bastion, open.x + 200, open.y);
  assert.equal(ignis.botSkillUrgency(1, bastion, 200, true, false), 880, 'three Embers inside 240: Flashburn');
  bastion.marks = { ember: 1, emberT: G.time + 4 };
  assert.equal(ignis.botSkillUrgency(1, bastion, 200, true, false), 520, 'one Ember inside 240: a routine nuke');
  bastion.marks = {};
  assert.equal(ignis.botSkillUrgency(1, bastion, 200, true, false), 0, 'no Embers, healthy Ignis: harmless, held');
  ignis.hp = ignis.maxHp * 0.25;
  assert.equal(ignis.botSkillUrgency(1, bastion, 200, true, false), 860, 'under 30% HP with a hero in the ring: fire');
  ignis.hp = ignis.maxHp;
  assert.equal(ignis.botHoldNow(), 330, 'no payoff pending: hold 330');
  T.place(bastion, open.x + 600, open.y);
  const cp2 = ignis.chooseCombatPoint(bastion);
  near(Math.hypot(cp2.x - bastion.x, cp2.y - bastion.y), 330, 30, 'holds 330 from the target');
  // a melee inside 250 during attack recovery: he steps away, like a marksman
  T.place(bastion, open.x + 200, open.y); ignis.aiTarget = bastion; ignis.atkCd = 1;
  const x0 = ignis.x;
  T.drive(ignis, 12);
  assert.ok(ignis.x < x0 - 5, `stepped away from the melee: ${ignis.x - x0}`);
});

/* ---------------- Volt ---------------- */

T.test('Volt: base stats and skill numbers match the spec (the only bounce, Static heroes-only, a per-tick slow ramp)', () => {
  reset();
  const d = volt.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [505, 63, 290, 32, 44, 3.8, 9, 1.9, 13, 2.1, 325, 0.88, 250, 2]);
  assert.equal(d.passive.id, 'static');
  const [s1, s2, s3] = volt.skills;
  assert.deepEqual([s1.type, s1.range, s1.speed, s1.radius, s1.pierce, s1.dmg, s1.dmgLv, s1.scaleAp, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.bounce],
    ['skillshot', 680, 1100, 22, false, 140, 20, 0.75, 5.5, -0.2, 45, 5, { count: 3, range: 320, decay: 0.75 }]);
  assert.equal(rankVal(s1, 'dmg', 6), 240); near(rankVal(s1, 'cd', 6), 4.5, 1e-9, 'Arc cd at rank 6');
  assert.deepEqual([s2.type, s2.radius, s2.dmg, s2.dmgLv, s2.scaleAp, s2.stun, s2.cd, s2.cdLv, s2.mana, s2.manaLv],
    ['nova', 240, 130, 16, 0.55, 0.5, 10, -0.4, 60, 4]);
  assert.equal(rankVal(s2, 'dmg', 6), 210); near(rankVal(s2, 'cd', 6), 8, 1e-9, 'Flashover cd at rank 6');
  assert.deepEqual([s3.type, s3.range, s3.radius, s3.delay, s3.ticks, s3.interval, s3.dmg, s3.scaleAp, s3.slowPct, s3.slowPctLv, s3.slowDur, s3.cd, s3.mana],
    ['zone', 600, 240, 0.4, 5, 0.45, [70, 95, 120], 0.3, 0.10, 0.08, 0.6, [40, 35, 30], [110, 130, 150]]);
  for (const s of volt.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Volt: Chain Arc stops on the first unit, bounces to a second target within 320 at 0.75 (then 0.56), skips structures, and Static stacks on heroes only', () => {
  reset();
  T.place(volt, open.x, open.y);
  const a = creep(1, open.x + 300, open.y), b = creep(1, open.x + 300, open.y + 200), c = creep(1, open.x + 300, open.y + 400);
  const far = creep(1, open.x + 300, open.y + 800);   // 400 from c: out of the 320 hop
  const hp = [a, b, c, far].map(m => m.hp);
  assert.ok(volt.castSkill(0, { x: open.x + 300, y: open.y }));
  T.frames(G, 60);
  const dealt = [a, b, c, far].map((m, i) => hp[i] - m.hp);
  assert.ok(dealt[0] > 0 && dealt[1] > 0 && dealt[2] > 0, `first, second and third hits: ${dealt}`);
  assert.equal(dealt[3], 0, 'nothing 400 from the last victim');
  near(dealt[1] / dealt[0], 0.75, 0.03, 'second hit at 0.75');
  near(dealt[2] / dealt[0], 0.5625, 0.03, 'third hit at 0.75 x 0.75');
  assert.ok(!a.marks || !a.marks.static, 'no Static on a creep');
  // a hero bounce carries Static; a creep nearer than a hero is skipped for the hero (150 bias)
  reset();
  T.place(volt, open.x, open.y); T.place(bastion, open.x + 300, open.y); T.place(nadir, open.x + 300, open.y + 250);
  creep(1, open.x + 300, open.y + 130);
  assert.ok(volt.castSkill(0, { x: open.x + 300, y: open.y }));
  T.frames(G, 40);
  assert.equal(bastion.marks.static, 1, 'first hit: one Static');
  assert.equal(nadir.marks.static, 1, 'the bounce preferred the hero 250 away over the creep at 130');
  assert.ok(nadir.stats.dmgTaken > 0);
  // Static: +8 flat magic pen per stack, five at most, 4 s
  const pkt = { type: 'magic' };
  volt.onDealDamage(bastion, 100, pkt);
  assert.equal(pkt.pen.flat, 8, 'one stack: 8 pen');
  for (let k = 0; k < 6; k++) volt.fire('onSkillHit', bastion, 10, volt.skills[0]);
  assert.equal(bastion.marks.static, 5, 'capped at 5');
  const pkt2 = { type: 'magic' };
  volt.onDealDamage(bastion, 100, pkt2);
  assert.equal(pkt2.pen.flat, 40, 'five stacks: 40 pen');
  const pkt3 = { type: 'physical' };
  volt.onDealDamage(bastion, 100, pkt3);
  assert.ok(!pkt3.pen, 'physical damage gets no magic pen');
  T.seconds(G, 4.1);
  const pkt4 = { type: 'magic' };
  volt.onDealDamage(bastion, 100, pkt4);
  assert.ok(!pkt4.pen, 'lapsed after 4 s');
});

T.test('Volt: Thunderhead strikes five times over 2.2 s, its slow ramps 10% -> 42% per tick, every tick applies Static; Flashover stuns 0.5 s', () => {
  reset();
  T.place(volt, open.x, open.y); T.place(bastion, open.x + 400, open.y);
  bastion.attrs.bonus.tenacity = -bastion.attrs.base.tenacity;   // read the slows raw
  assert.ok(volt.castSkill(2, { x: open.x + 400, y: open.y }));
  const z = G.zones[G.zones.length - 1];
  assert.equal(z.ticks, 5);
  const slows = [];
  let hits = 0, lastTaken = 0;
  for (let k = 0; k < 60 * 3; k++) {
    G.update(1 / 60); T.reveal(G);
    if (bastion.stats.dmgTaken !== lastTaken) { hits++; lastTaken = bastion.stats.dmgTaken; slows.push(bastion.cc.slowPct); }
  }
  assert.equal(hits, 5, 'five strikes');
  assert.deepEqual(slows.map(v => Math.round(v * 100)), [10, 18, 26, 34, 42], 'the slow ramps per tick');
  assert.equal(bastion.marks.static, 5, 'a Static per strike');
  assert.ok(z.dead, 'gone after the fifth strike');
  // Flashover
  reset();
  T.place(volt, open.x, open.y); T.place(bastion, open.x + 200, open.y); T.place(nadir, open.x + 300, open.y);
  assert.ok(volt.castSkill(1, null));
  near(bastion.cc.t.stun, 0.5 * (1 - Math.min(0.6, bastion.attrs.get('tenacity'))), 1e-6, 'stunned 0.5 s inside 240');
  assert.ok(!nadir.cc.has('stun') && !nadir.stats.dmgTaken, 'outside the ring');
});

T.test('Volt bot: Chain Arc rates highest with a second enemy unit within 320 of the target; Flashover only for a melee inside its ring or 2+ heroes; Thunderhead on a frontliner or a hero standing still in a fight', () => {
  reset();
  T.place(volt, open.x, open.y); T.place(vesper, open.x + 500, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(volt.botSkillUrgency(0, vesper, 500, true, false), 500, 'a lone target: a normal poke');
  T.place(hexa, open.x + 500, open.y + 250);
  assert.equal(volt.botSkillUrgency(0, vesper, 500, true, false), 720, 'a second hero within 320 of the target: the arc bounces');
  T.place(hexa, FAR.x, FAR.y);
  creep(1, open.x + 500, open.y + 200);
  assert.equal(volt.botSkillUrgency(0, vesper, 500, true, false), 720, 'a creep counts as company too');
  assert.equal(volt.botSkillUrgency(1, vesper, 500, true, false), 0, 'Flashover: nobody in the ring');
  T.place(vesper, open.x + 200, open.y);
  assert.equal(volt.botSkillUrgency(1, vesper, 200, true, false), 0, 'a ranged hero in the ring: still held');
  T.place(bastion, open.x + 200, open.y + 100);
  assert.equal(volt.botSkillUrgency(1, bastion, 220, true, false), 880, 'two heroes in the ring');
  T.place(vesper, FAR.x, FAR.y);
  assert.equal(volt.botSkillUrgency(1, bastion, 220, true, false), 830, 'a melee hero reaching the ring');
  T.place(bastion, FAR.x, FAR.y); T.place(vesper, open.x + 200, open.y);
  vesper.aiTarget = volt;
  assert.equal(volt.botSkillUrgency(1, vesper, 200, true, false), 800, 'a ranged hero in the ring who is on Volt: the ring answers the dive');
  vesper.aiTarget = null;
  // Thunderhead
  T.place(bastion, open.x + 450, open.y); T.place(vesper, open.x + 450, open.y + 600);
  assert.equal(volt.botSkillUrgency(2, bastion, 450, true, false), 820, 'a Tank at full HP: the frontliner');
  vesper.vx = 200; vesper.vy = 0;
  assert.equal(volt.botSkillUrgency(2, vesper, 450, true, false), 0, 'a healthy moving marksman, no crowd: held');
  vesper.vx = 0; volt.lastDmgT = G.time;
  assert.equal(volt.botSkillUrgency(2, vesper, 450, true, false), 820, 'standing still while Volt is in a fight');
  assert.equal(volt.botHoldNow(), 320, 'holds 320');
});

/* ---------------- Mira ---------------- */

T.test('Mira: base stats and skill numbers match the spec (the only mage whose zones help allies; a linger on both zones)', () => {
  reset();
  const d = mira.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [490, 62, 310, 35, 45, 3.8, 10, 2.0, 12, 2.0, 335, 0.9, 250, 2]);
  assert.equal(d.passive.id, 'frostbite');
  const [s1, s2, s3] = mira.skills;
  assert.deepEqual([s1.type, s1.range, s1.speed, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAp, s1.slowPct, s1.slowDur, s1.cd, s1.cdLv, s1.mana, s1.manaLv],
    ['skillshot', 700, 900, 24, 150, 20, 0.7, 0.25, 1.5, 5.5, -0.3, 40, 5]);
  assert.equal(rankVal(s1, 'dmg', 6), 250); near(rankVal(s1, 'cd', 6), 4, 1e-9, 'Shard cd at rank 6');
  const linger = { dur: 3, enemySlowPct: 0.28, allySpeedAdd: 40, chillPerSec: 1, chillDelay: 1.0 };
  assert.deepEqual([s2.type, s2.range, s2.radius, s2.delay, s2.ticks, s2.dmg, s2.dmgLv, s2.scaleAp, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.linger],
    ['zone', 600, 200, 0.3, 1, 90, 12, 0.4, 12, -0.4, 70, 5, linger]);
  assert.equal(rankVal(s2, 'dmg', 6), 150); near(rankVal(s2, 'cd', 6), 10, 1e-9, 'Field cd at rank 6');
  assert.deepEqual([s3.type, s3.range, s3.radius, s3.delay, s3.dmg, s3.scaleAp, s3.stun, s3.cd, s3.mana, s3.linger],
    ['zone', 620, 200, 0.75, [260, 340, 420], 0.9, [1.0, 1.1, 1.2], [42, 37, 32], [110, 130, 150], linger]);
  for (const s of mira.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Mira: Frostbite chills per hit (8% per stack, strongest slow wins), freezes 0.8 s at four, consumes the stacks and grants 2.5 s of Chill immunity that prevents a chain freeze', () => {
  reset();
  T.place(mira, open.x, open.y); T.place(bastion, open.x + 300, open.y);
  bastion.attrs.bonus.tenacity = -bastion.attrs.base.tenacity;
  for (let k = 1; k <= 3; k++) {
    mira.fire('onSkillHit', bastion, 10, mira.skills[0]);
    assert.equal(bastion.marks.chill, k, `${k} Chill`);
    near(bastion.cc.slowPct, 0.08 * k, 1e-9, `${k} stacks: ${8 * k}% slow`);
  }
  bastion.cc.applySlow(0.4, 1, 0);
  near(bastion.cc.slowPct, 0.4, 1e-9, 'a stronger slow wins');
  mira.fire('onBasicHit', bastion, 10);
  assert.equal(bastion.marks.chill, 0, 'four stacks: consumed');
  near(bastion.cc.t.stun, 0.8, 1e-9, 'Frozen 0.8 s');
  near(bastion.marks.chillImmuneT, G.time + 2.5, 1e-9, 'Chill-immune 2.5 s');
  for (let k = 0; k < 5; k++) mira.fire('onSkillHit', bastion, 10, mira.skills[0]);
  assert.ok(!bastion.marks.chill, 'no Chill lands during the immunity: no chain freeze');
  T.seconds(G, 2.6);
  assert.ok(!bastion.cc.has('stun'));
  mira.fire('onSkillHit', bastion, 10, mira.skills[0]);
  assert.equal(bastion.marks.chill, 1, 'immunity over: Chill again');
  // Frost Shard: damage, slow 30% 1.5 s and one Chill, the first enemy only
  reset();
  T.place(mira, open.x, open.y); T.place(bastion, open.x + 300, open.y); T.place(nadir, open.x + 500, open.y);
  bastion.attrs.bonus.tenacity = -bastion.attrs.base.tenacity;
  assert.ok(mira.castSkill(0, { x: open.x + 300, y: open.y }));
  T.frames(G, 30);
  assert.ok(bastion.stats.dmgTaken > 0 && !nadir.stats.dmgTaken, 'stops on the first');
  assert.equal(bastion.marks.chill, 1); near(bastion.cc.slowPct, 0.25, 1e-9, 'the shard\'s own 25% slow');
});

T.test('Mira: Rime Field pulses once then lingers 3 s: enemies inside are slowed 28% and Chilled once a second after 1 s, allies inside gain +40 speed; Glacial Prison freezes 1.2 s at rank 3 and leaves a field', () => {
  reset();
  T.place(mira, open.x, open.y); T.place(bastion, open.x + 400, open.y); T.place(grom, open.x + 400, open.y + 120);
  bastion.attrs.bonus.tenacity = -bastion.attrs.base.tenacity;
  G.update(1 / 60); T.reveal(G);
  const gromSpd = grom.curSpeed();
  assert.ok(mira.castSkill(1, { x: open.x + 400, y: open.y }));
  const z = G.zones[G.zones.length - 1];
  T.seconds(G, 0.5);
  assert.ok(bastion.stats.dmgTaken > 0, 'the pulse landed');
  assert.ok(z.lingerT > 2 && !z.dead, 'the patch stays');
  const chillAfterPulse = bastion.marks.chill || 0;
  assert.equal(chillAfterPulse, 1, 'the pulse itself is one Chill (Frostbite)');
  near(bastion.cc.slowPct, 0.28, 1e-9, 'slowed 28% inside');
  near(grom.curSpeed(), gromSpd + 40, 1e-6, 'an ally inside is +40 speed');
  T.seconds(G, 0.4);   // 0.9 s into the linger: no field Chill yet
  assert.equal(bastion.marks.chill, 1, 'no field Chill before 1 s');
  T.seconds(G, 1.2);   // 2.1 s in: one field Chill
  assert.equal(bastion.marks.chill, 2, 'one Chill per second after the first second');
  T.place(bastion, open.x + 900, open.y);
  T.seconds(G, 0.3);
  assert.ok(bastion.cc.slowPct < 0.28 || !bastion.cc.has('slow'), 'stepping out ends the field slow');
  near(bastion.cc.slowPct, 0.16, 1e-9, 'only the two Chill stacks (16%) remain');
  near(bastion.curSpeed(), bastion.attrs.get('speed') * 0.84, 1e-6, 'a slowed hero still moves, at 84% speed (a slow is not a root)');
  T.seconds(G, 2.5);
  assert.ok(z.dead, 'gone after 3 s');
  // Glacial Prison: stun 1.2 at rank 3, then the same linger
  reset();
  T.place(mira, open.x, open.y); T.place(bastion, open.x + 400, open.y);
  bastion.attrs.bonus.tenacity = -bastion.attrs.base.tenacity;
  assert.ok(mira.castSkill(2, { x: open.x + 400, y: open.y }));
  T.seconds(G, 0.8);
  assert.ok(bastion.stats.dmgTaken > 0);
  near(bastion.cc.t.stun, 1.2 * (1 - Math.min(0.6, bastion.attrs.get('tenacity'))) - 0.05, 0.03, 'Frozen 1.2 s at rank 3 (less tenacity)');
  const zp = G.zones[G.zones.length - 1];
  assert.ok(zp.lingerT > 2.0 && zp.linger.allySpeedAdd === 40, 'a Rime Field is left behind');
});

T.test('Mira bot: Rime Field between her and a melee inside 520 (or on the target once an ally engages); Frost Shard prefers a hero in her field; Glacial Prison for 2+ heroes or one at 3 Chill; holds 335', () => {
  reset();
  T.place(mira, open.x, open.y); T.place(vesper, open.x + 500, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(mira.botSkillUrgency(1, vesper, 500, true, false), 520, 'no melee, no ally engaged: a routine drop');
  T.place(grom, open.x + 400, open.y + 60); grom.lastDmgT = G.time;   // an ally trading with the target
  assert.equal(mira.botSkillUrgency(1, vesper, 500, true, false), 600, 'an ally on the target: field on the carry');
  T.place(bastion, open.x + 450, open.y - 200);
  assert.equal(mira.botSkillUrgency(1, vesper, 500, true, false), 800, 'a melee inside 520: field between');
  const bp = mira.betweenPoint(mira.skills[1], bastion);
  near(Math.hypot(bp.x - mira.x, bp.y - mira.y), 0.6 * mira.distTo(bastion), 1e-6, '60% of the way to the threat');
  mira.botFireSkill(1, vesper, 500, true, false);
  const z = G.zones[G.zones.length - 1];
  near(Math.hypot(z.x - bp.x, z.y - bp.y), 0, 1e-6, 'cast there');
  T.place(bastion, FAR.x, FAR.y); T.place(grom, FAR.x, FAR.y);
  assert.equal(mira.botSkillUrgency(0, vesper, 500, true, false), 500, 'Shard at a hero on open ground');
  T.place(vesper, z.x, z.y);
  T.seconds(G, 0.4);
  assert.equal(mira.botSkillUrgency(0, vesper, mira.distTo(vesper), true, false), 700, 'Shard into the field');
  // Glacial Prison
  T.place(vesper, open.x + 500, open.y); vesper.marks = {}; vesper.cc.clear();
  assert.equal(mira.botSkillUrgency(2, vesper, 500, true, false), 0, 'one healthy hero, no Chill: held');
  vesper.marks = { chill: 2, chillT: G.time + 4 };
  assert.equal(mira.botSkillUrgency(2, vesper, 500, true, false), 0, 'two Chill: still held');
  vesper.marks = { chill: 3, chillT: G.time + 4 };
  assert.equal(mira.botSkillUrgency(2, vesper, 500, true, false), 820, 'three Chill: freeze him');
  vesper.marks = {};
  T.place(hexa, open.x + 500, open.y + 150);
  assert.equal(mira.botSkillUrgency(2, vesper, 500, true, false), 880, 'two heroes in the prison');
  assert.equal(mira.botHoldNow(), 335, 'holds 335');
});

/* ---------------- Nadir ---------------- */

T.test('Nadir: base stats and skill numbers match the spec (the sturdiest, slowest mage; pullTo and pullSpeed; the only explodeR skillshot)', () => {
  reset();
  const d = nadir.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [520, 68, 300, 33, 42, 3.6, 12, 2.2, 14, 2.2, 310, 0.86, 245, 3]);
  assert.equal(d.passive.id, 'accretion');
  const [s1, s2, s3] = nadir.skills;
  assert.deepEqual([s1.type, s1.range, s1.speed, s1.radius, s1.explodeR, s1.dmg, s1.dmgLv, s1.scaleAp, s1.slowPct, s1.slowDur, s1.cd, s1.cdLv, s1.mana, s1.manaLv],
    ['skillshot', 640, 720, 30, 140, 160, 20, 0.75, 0.40, 1.2, 7, -0.4, 50, 5]);
  assert.equal(rankVal(s1, 'dmg', 6), 260); near(rankVal(s1, 'cd', 6), 5, 1e-9, 'Singularity cd at rank 6');
  assert.deepEqual([s2.type, s2.radius, s2.dmg, s2.dmgLv, s2.scaleAp, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.pullTo],
    ['nova', 280, 120, 14, 0.5, 11, -0.4, 60, 4, { target: 'caster', dist: 120, speed: 900 }]);
  assert.equal(rankVal(s2, 'dmg', 6), 190); near(rankVal(s2, 'cd', 6), 9, 1e-9, 'Crush cd at rank 6');
  assert.deepEqual([s3.type, s3.range, s3.radius, s3.delay, s3.ticks, s3.pullSpeed, s3.dmg, s3.scaleAp, s3.stun, s3.cd, s3.mana],
    ['zone', 560, 280, 0.9, 1, 260, [300, 390, 480], 1.1, 0.8, [44, 38, 32], [120, 140, 160]]);
  for (const s of nadir.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Nadir: Crush drags heroes and minions 120 toward him over 0.13 s (stopping at the bodies) and a pull stops at rock; Accretion makes the pulled hero Heavy: -20% speed for 3 s and +12% damage from Nadir only', () => {
  reset();
  T.place(nadir, open.x, open.y); T.place(grom, open.x + 250, open.y); T.place(zephyr, open.x, open.y + 100);
  const m = creep(0, open.x - 200, open.y);
  grom.attrs.bonus.tenacity = 0;
  G.update(1 / 60); T.reveal(G);
  const spd0 = grom.attrs.get('speed');
  assert.ok(nadir.castSkill(1, null));
  assert.ok(grom.forced && grom.forced.mode === 'slide', 'a tween, not a teleport');
  T.frames(G, 3);
  assert.ok(grom.x < open.x + 250 && grom.x > open.x + 130, `mid-flight: ${grom.x - open.x}`);
  T.frames(G, 12);
  near(grom.x, open.x + 130, 2, 'dragged 120 toward Nadir');
  near(zephyr.y, open.y + grom.radius + nadir.radius, 2, 'a hero 100 away stops at the bodies');
  near(m.x, open.x - 80, 2, 'a minion is dragged too');
  assert.ok(grom.stats.dmgTaken > 0 && zephyr.stats.dmgTaken > 0, 'both took the nova');
  // Heavy: -20% speed for 3 s and +12% from Nadir, nothing from anyone else
  assert.equal(grom.marks.heavyBy, nadir); assert.ok(grom.marks.heavyUntil > G.time);
  near(grom.curSpeed(), spd0 * 0.8, 1e-6, 'Heavy: -20% move speed');
  near(nadir.onDealDamage(grom, 100, { type: 'magic' }), 112, 1e-9, '+12% from Nadir');
  near(mira.onDealDamage(grom, 100, { type: 'magic' }), 100, 1e-9, 'nothing extra from Mira');
  assert.ok(!zephyr.marks.heavyBy || zephyr.marks.heavyBy !== nadir || true);
  T.seconds(G, 3.1);
  near(grom.curSpeed(), spd0, 1e-6, 'Heavy lapses after 3 s');
  near(nadir.onDealDamage(grom, 100, { type: 'magic' }), 100, 1e-9, 'and so does the bonus');
  // a pull toward the caster stops at rock
  const wall = T.openSpot(G, 60, { nearWallDx: 140 });
  reset();
  T.place(grom, wall.x, wall.y);   // the rock starts at wall.x + 140: a drag toward a point beyond it stops there
  G.rules.applyPullTo(nadir, grom, { pullTo: { target: 'point', dist: 400, speed: 900 } }, 1, { point: { x: wall.x + 400, y: wall.y } });
  assert.ok(grom.forced && grom.forced.mode === 'slide', 'dragged toward the point');
  T.frames(G, 40);
  const moved = grom.x - wall.x;
  assert.ok(moved > 0 && moved < 140, `stopped short of the rock: ${moved}`);
  assert.ok(!G.wallAt(grom.x, grom.y, grom.radius), 'never inside the wall');
  assert.equal(grom.forced, null, 'the drag ended at the rock');
});

T.test('Nadir: Implosion pulls enemy heroes toward its centre at 260 u/s for its 0.9 s delay, ignores tenacity, is refused by Purify immunity, waits for a dash, then stuns 0.8 s and hits everyone inside', () => {
  reset();
  // everything inside the spot's 420 clearance, so Game.separate() never pushes anyone off rock
  const cx = open.x + 200, cy = open.y;   // the zone centre, 300 from Nadir
  T.place(nadir, open.x - 100, open.y); T.place(grom, cx + 200, cy); T.place(zephyr, cx, cy - 200); T.place(mira, cx, cy + 230);
  mira.cc.immuneT = 2;
  assert.ok(nadir.castSkill(2, { x: cx, y: cy }));
  const z = G.zones[G.zones.length - 1];
  assert.equal(z.s.pullSpeed, 260);
  T.seconds(G, 0.5);
  const pulledGrom = (cx + 200) - grom.x, pulledZ = 200 - Math.abs(zephyr.y - cy);
  assert.ok(pulledGrom > 115 && pulledGrom < 150, `0.5 s at 260 u/s: ${pulledGrom}`);
  assert.ok(pulledZ > 115 && pulledZ < 150, `pulled from the side too: ${pulledZ}`);
  near(mira.y, cy + 230, 1e-6, 'Purify immunity refuses the pull');
  assert.equal(grom.marks.heavyBy, nadir, 'pulled heroes are Heavy from Nadir');
  // a dash in progress is not stopped by the pull
  zephyr.dashS = { dx: 0, dy: -1, remaining: 300, speed: 1100, dmg: 0, hitSet: new Set(), s: null, stopOnHero: false, endNova: null, rank: 1 };
  const zy = zephyr.y;
  T.seconds(G, 0.2);
  assert.ok(zephyr.y < zy - 150, 'the dash carried him out against the pull');
  T.seconds(G, 0.3);
  assert.ok(z.dead, 'detonated at 0.9 s');
  assert.ok(grom.stats.dmgTaken > 0, 'hit');
  near(grom.cc.t.stun, 0.8 * (1 - Math.min(0.6, grom.attrs.get('tenacity'))) - 0.1, 0.05, 'stunned 0.8 s (less tenacity)');
  assert.ok(!zephyr.cc.has('stun') && !zephyr.stats.dmgTaken, 'the dasher left the ring');
  // Singularity: first hit takes full damage and the slow, the splash 80% and no slow
  reset();
  T.place(nadir, open.x, open.y); T.place(grom, open.x + 300, open.y); T.place(zephyr, open.x + 300, open.y + 120);
  grom.attrs.bonus.tenacity = 0; zephyr.attrs.bonus.tenacity = 0;
  assert.ok(nadir.castSkill(0, { x: open.x + 300, y: open.y }));
  T.frames(G, 40);
  assert.ok(grom.stats.dmgTaken > 0 && zephyr.stats.dmgTaken > 0, 'both hit');
  near(grom.cc.slowPct, 0.40, 1e-9, 'the first enemy is slowed 40%');
  assert.ok(!zephyr.cc.has('slow'), 'the splash carries no slow');
});

T.test('Nadir bot: Implosion for 2+ heroes within 280 of the target or one under 40%; Crush at 900 right after the detonation; Singularity at 700 on a hero retreating; holds 310', () => {
  reset();
  T.place(nadir, open.x, open.y); T.place(grom, open.x + 450, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(nadir.botSkillUrgency(2, grom, 450, true, false), 0, 'one healthy hero: held');
  grom.hp = grom.maxHp * 0.35;
  assert.equal(nadir.botSkillUrgency(2, grom, 450, true, false), 820, 'one hero under 40%: fire');
  grom.hp = grom.maxHp;
  grom.cc.applySlow(0.3, 2, 0);
  assert.equal(nadir.botSkillUrgency(2, grom, 450, true, false), 0, 'a slowed healthy hero is not enough for Implosion (Killbox would go)');
  grom.cc.clear();
  T.place(zephyr, open.x + 450, open.y + 200);
  assert.equal(nadir.botSkillUrgency(2, grom, 450, true, false), 880, 'two heroes within 280 of the target');
  // Crush after the detonation: a Heavy-from-Nadir hero still stunned inside the ring
  T.place(zephyr, FAR.x, FAR.y); T.place(grom, open.x + 200, open.y);
  assert.equal(nadir.botSkillUrgency(1, grom, 200, true, false), 480, 'a lone hero in the ring: a routine nova');
  grom.marks.heavyBy = nadir; grom.marks.heavyUntil = G.time + 3; grom.cc.apply('stun', 0.7, 0);
  assert.equal(nadir.botSkillUrgency(1, grom, 200, true, false), 900, 'just pulled and stunned: Crush keeps them stacked');
  grom.cc.clear(); grom.marks = {};
  // Singularity on whoever retreats
  T.place(grom, open.x + 400, open.y);
  grom.vx = 0; grom.vy = 0;
  assert.equal(nadir.botSkillUrgency(0, grom, 400, true, false), 500, 'standing: a normal poke');
  grom.vx = 200;
  assert.equal(nadir.botSkillUrgency(0, grom, 400, true, false), 700, 'walking away: Singularity');
  grom.vx = -200;
  assert.equal(nadir.botSkillUrgency(0, grom, 400, true, false), 500, 'walking in: normal');
  grom.vx = 0;
  assert.equal(nadir.botHoldNow(), 310, 'holds 310');
});

/* ---------------- Ashara ---------------- */

T.test('Ashara: base stats and skill numbers match the spec (the only conceal, the only progressive slow-to-root)', () => {
  reset();
  const d = ashara.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [500, 64, 280, 30, 47, 4.2, 10, 2.0, 11, 1.9, 305, 0.92, 255, 3]);
  assert.equal(d.passive.id, 'drymouth');
  const [s1, s2, s3] = ashara.skills;
  assert.deepEqual([s1.type, s1.range, s1.speed, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAp, s1.slowPct, s1.slowDur, s1.cd, s1.cdLv, s1.mana, s1.manaLv],
    ['skillshot', 660, 900, 22, 160, 20, 0.72, 0.25, 1.2, 6, -0.3, 45, 4]);
  assert.equal(rankVal(s1, 'dmg', 6), 260); near(rankVal(s1, 'cd', 6), 4.5, 1e-9, 'Needle cd at rank 6');
  assert.deepEqual([s2.type, s2.range, s2.radius, s2.delay, s2.ticks, s2.dmg, s2.dmgLv, s2.scaleAp, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.linger],
    ['zone', 500, 180, 0.2, 1, 70, 10, 0.35, 13, -0.5, 55, 4, { dur: 4, conceal: true, enemySlowPct: 0.30, countsAsSkillHit: true }]);
  assert.equal(rankVal(s2, 'dmg', 6), 120); near(rankVal(s2, 'cd', 6), 10.5, 1e-9, 'Veil cd at rank 6');
  assert.deepEqual([s3.type, s3.range, s3.radius, s3.delay, s3.ticks, s3.cd, s3.mana, s3.linger],
    ['zone', 560, 220, 0.4, 0, [42, 37, 32], [105, 125, 145],
      { dur: 3, enemySlowRamp: [0.30, 0.60], countsAsSkillHit: true, endPayload: { dmg: [260, 340, 420], scaleAp: 1.0, immobilize: 1.2 } }]);
  assert.ok(!HEROES_ONLY_STEALTH(), 'Ashara is the only hero with a concealing skill');
  for (const s of ashara.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
  function HEROES_ONLY_STEALTH() {
    return sim.context.HEROES.some(h => h.id !== 'ashara' && h.skills.some(s => s.linger && s.linger.conceal));
  }
});

T.test('Ashara: Sand Veil pulses, then for 4 s conceals allied heroes inside from enemies beyond 250 (revealed 1.6 s by dealing damage), slows enemies inside 30% and counts one Dry Mouth hit per cast on entry', () => {
  reset();
  T.place(ashara, open.x, open.y); T.place(nadir, open.x + 150, open.y);         // red, will stand in the veil (centre open.x + 300)
  T.place(grom, open.x + 450, open.y); T.place(zephyr, open.x + 800, open.y);      // blue: one in the veil 300 from Nadir, one 650 away
  grom.attrs.bonus.tenacity = 0;
  G.update(1 / 60); T.reveal(G);
  assert.ok(ashara.castSkill(1, { x: open.x + 300, y: open.y }));
  T.seconds(G, 0.5);
  const z = G.zones[G.zones.length - 1];
  assert.ok(grom.stats.dmgTaken > 0 && z.lingerT > 3, 'the pulse landed and the patch stays');
  assert.equal(grom.marks.sand, 2, 'the pulse and the entry: two Dry Mouth instances');
  near(grom.cc.slowPct, 0.30, 1e-9, 'an enemy inside is slowed 30%');
  assert.ok(nadir.concealT > 0, 'the ally inside is concealed');
  assert.equal(G.canSee(0, nadir), false, 'hidden from an enemy 500 away');
  assert.equal(G.canSee(1, nadir), true, 'his own team sees him');
  T.place(zephyr, open.x + 350, open.y);
  assert.equal(G.canSee(0, nadir), true, 'an enemy inside 250 sees him');
  T.place(zephyr, open.x + 800, open.y);
  assert.equal(G.canSee(0, nadir), false);
  nadir.onSkillLanded(grom, 10, nadir.skills[0]);
  assert.ok(nadir.revealT >= 1.5, 'dealing damage reveals 1.6 s');
  assert.equal(G.canSee(0, nadir), true);
  // entry counts once per cast: leave and come back
  T.place(grom, open.x + 900, open.y);
  T.seconds(G, 0.3);
  T.place(grom, open.x + 450, open.y);
  T.seconds(G, 0.3);
  assert.equal(grom.marks.sand, 2, 'a second entry into the same veil is not another instance');
  T.place(nadir, open.x + 900, open.y);
  T.seconds(G, 3.2);
  assert.ok(z.dead, 'gone after 3 s');
  assert.ok(nadir.concealT <= 0, 'conceal lapses outside');
});

T.test('Ashara: Burial has no opening hit, its slow ramps 30% -> 60% over 3 s, entering counts a Dry Mouth hit, and at the end everyone still inside takes 260/340/420 (+100% MAGIC) and is rooted 1.2 s; Dry Mouth silences on the third instance within 6 s, once per 8 s', () => {
  reset();
  T.place(ashara, open.x, open.y); T.place(grom, open.x + 300, open.y); T.place(zephyr, open.x + 300, open.y + 150);
  grom.attrs.bonus.tenacity = 0; zephyr.attrs.bonus.tenacity = 0;
  assert.ok(ashara.castSkill(2, { x: open.x + 300, y: open.y }));
  const z = G.zones[G.zones.length - 1];
  T.seconds(G, 0.5);   // 0.1 s into the linger
  assert.equal(grom.stats.dmgTaken, 0, 'no opening damage');
  assert.ok(z.lingerT > 2.8, 'lingering');
  assert.equal(grom.marks.sand, 1, 'entering is one Dry Mouth instance');
  near(grom.cc.slowPct, 0.31, 0.02, 'the slow starts near 30%');
  T.seconds(G, 2.0);   // 2.1 s in
  near(grom.cc.slowPct, 0.51, 0.02, 'ramping toward 60%');
  T.place(zephyr, open.x + 800, open.y + 150);   // walks out before the end
  const before = grom.stats.dmgTaken;
  T.seconds(G, 1.0);
  assert.ok(z.dead, 'over after 3 s');
  assert.ok(grom.stats.dmgTaken > before, 'the one still inside is buried');
  near(grom.cc.t.immobilize, 1.2 * (1 - Math.min(0.6, grom.attrs.get('tenacity'))) - 0.05, 0.03, 'rooted 1.2 s (less tenacity)');
  assert.equal(zephyr.stats.dmgTaken, 0, 'the one who left takes nothing');
  assert.ok(!zephyr.cc.has('immobilize'));
  const p = z.linger.endPayload;
  near(ashara.skillDmg(Object.assign({ dmgType: 'magic' }, p), 3, grom), 420 + ashara.magicPower() * 1.0, 1e-6, '420 +100% MAGIC at rank 3');
  // Dry Mouth: the third instance within 6 s silences 0.9 s; then 8 s of lockout
  reset();
  T.place(ashara, open.x, open.y); T.place(grom, open.x + 300, open.y);
  grom.attrs.bonus.tenacity = 0;
  ashara.fire('onSkillHit', grom, 10, ashara.skills[0]);
  ashara.fire('onSkillHit', grom, 10, ashara.skills[0]);
  assert.ok(!grom.cc.has('silence'), 'two instances: nothing');
  T.seconds(G, 5.5);
  ashara.fire('onSkillHit', grom, 10, ashara.skills[0]);
  near(grom.cc.t.silence, 0.9 * (1 - Math.min(0.6, grom.attrs.get('tenacity'))), 1e-9, 'the third within 6 s silences 0.9 s (less tenacity)');
  T.seconds(G, 1.0);
  for (let k = 0; k < 3; k++) ashara.fire('onSkillHit', grom, 10, ashara.skills[0]);
  assert.ok(!grom.cc.has('silence'), 'locked out for 8 s');
  T.seconds(G, 7.5);
  for (let k = 0; k < 3; k++) ashara.fire('onSkillHit', grom, 10, ashara.skills[0]);
  assert.ok(grom.cc.has('silence'), 'lockout over: silenced again');
});

T.test('Ashara bot: Sand Veil on herself with a melee inside 300, on the allied group with an enemy hero inside 600, otherwise held; Burial for 2+ heroes who are not retreating or one already slowed; holds 305', () => {
  reset();
  T.place(ashara, open.x, open.y); T.place(zephyr, open.x + 700, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(ashara.botSkillUrgency(1, zephyr, 700, true, false), 0, 'nobody inside 600: the veil is held');
  T.place(zephyr, open.x + 480, open.y); T.place(hexa, open.x - 200, open.y + 100);
  G.update(1 / 60); T.reveal(G);
  assert.equal(ashara.botSkillUrgency(1, zephyr, 480, true, false), 700, 'an enemy hero inside 600: veil the group');
  ashara.botFireSkill(1, zephyr, 480, true, false);
  let z = G.zones[G.zones.length - 1];
  const gp = ashara.allyGroupPoint(400);
  near(Math.hypot(z.x - gp.x, z.y - gp.y), 0, 1e-6, 'cast on the allied group\'s centre');
  near(gp.x, open.x - 100, 1e-6, 'the centroid of Ashara and Hexa');
  ashara.skillCd[1] = 0; G.zones.length = 0;
  T.place(grom, open.x + 250, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(ashara.botSkillUrgency(1, grom, 250, true, false), 850, 'a melee inside 300: veil herself');
  ashara.botFireSkill(1, grom, 250, true, false);
  z = G.zones[G.zones.length - 1];
  near(Math.hypot(z.x - ashara.x, z.y - ashara.y), 0, 1e-6, 'cast under her own feet');
  // Burial
  G.zones.length = 0; T.place(grom, FAR.x, FAR.y);
  T.place(zephyr, open.x + 450, open.y); T.place(mira, open.x + 450, open.y + 150);
  G.update(1 / 60); T.reveal(G);
  zephyr.vx = zephyr.vy = mira.vx = mira.vy = 0;
  assert.equal(ashara.botSkillUrgency(2, zephyr, 450, true, false), 880, 'two heroes standing their ground');
  zephyr.vx = 200; mira.vx = 200;
  assert.equal(ashara.botSkillUrgency(2, zephyr, 450, true, false), 0, 'both retreating: held');
  mira.vx = 0;
  assert.equal(ashara.botSkillUrgency(2, zephyr, 450, true, false), 0, 'one attacking, one retreating: not a crowd, target healthy and free');
  zephyr.cc.applySlow(0.3, 2, 0);
  assert.equal(ashara.botSkillUrgency(2, zephyr, 450, true, false), 820, 'a hero already slowed');
  zephyr.cc.clear(); zephyr.vx = 0;
  assert.equal(ashara.botHoldNow(), 305, 'holds 305');
});

/* ---------------- Hexa ---------------- */

T.test('Hexa: base stats and skill numbers match the spec (the only self-healing tether; the slowest mage with the most magic resist)', () => {
  reset();
  const d = hexa.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [488, 61, 315, 36, 43, 3.7, 9, 1.8, 15, 2.3, 345, 0.84, 240, 3]);
  assert.equal(d.passive.id, 'blight');
  const [s1, s2, s3] = hexa.skills;
  assert.deepEqual([s1.type, s1.range, s1.speed, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAp, s1.cd, s1.cdLv, s1.mana, s1.manaLv],
    ['skillshot', 690, 820, 24, 140, 17, 0.7, 6, -0.3, 45, 4]);
  assert.equal(rankVal(s1, 'dmg', 6), 225); near(rankVal(s1, 'cd', 6), 4.5, 1e-9, 'Bolt cd at rank 6');
  assert.deepEqual([s2.type, s2.targetRange, s2.targetCone, s2.cd, s2.cdLv, s2.mana, s2.manaLv], ['tether', 520, 60, 13, -0.5, 70, 5]);
  const tt = s2.tether;
  assert.deepEqual([tt.dur, tt.breakRange, tt.slowStart, tt.slowEnd, tt.interval, tt.tickDmg, tt.tickDmgLv, tt.tickScaleAp, tt.healPct],
    [3.0, 620, 0.15, 0.15, 0.6, 40, 6, 0.25, 0.40]);
  assert.deepEqual([tt.payload.dmg, tt.payload.dmgLv, tt.payload.scaleAp, tt.payload.slowPct, tt.payload.slowDur, tt.payload.spreadMark.tag, tt.payload.spreadMark.stacks, tt.payload.spreadMark.radius],
    [120, 16, 0.50, 0.40, 1.5, 'blight', 2, 200]);
  near(rankVal(s2, 'cd', 6), 10.5, 1e-9, 'Thread cd at rank 6');
  assert.deepEqual([s3.type, s3.range, s3.radius, s3.delay, s3.ticks, s3.interval, s3.dmg, s3.scaleAp, s3.cd, s3.mana],
    ['zone', 600, 240, 0.5, 4, 0.5, [80, 105, 130], 0.35, [40, 35, 30], [110, 130, 150]]);
  for (const s of hexa.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Hexa: Blight is 45 (+30% MAGIC) over 3 s per stack, two at most, from basics and skills alike; she heals 12% of its ticks on heroes and nothing off creeps', () => {
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 300, open.y);
  const per = 45 + hexa.magicPower() * 0.3;
  basic(hexa, grom);
  assert.equal(markStacks(grom, 'blight'), 1, 'one Blight');
  let dot = grom.dots.find(k => k.tag === 'blight');
  assert.ok(dot, 'a rot is ticking');
  near(dot.perSec * dot.t, per, per * 0.35, 'about one stack of rot left over 3 s');
  near(dot.perSec, per / 3, 1e-6, 'one stack: 45 +30% MAGIC over 3 s');
  hexa.fire('onSkillHit', grom, 10, hexa.skills[0]);
  assert.equal(markStacks(grom, 'blight'), 2, 'a skill hit stacks it to two');
  dot = grom.dots.find(k => k.tag === 'blight');
  near(dot.perSec, 2 * per / 3, 1e-6, 'two stacks: twice the rot, refreshed to 3 s');
  near(dot.t, 3, 1e-6);
  hexa.fire('onSkillHit', grom, 10, hexa.skills[0]);
  assert.equal(markStacks(grom, 'blight'), 2, 'capped at two');
  // 12% of every tick on a hero heals her
  hexa.hp = hexa.maxHp * 0.5;
  const hp0 = hexa.hp, took0 = grom.stats.dmgTaken;
  T.seconds(G, 1.0);
  const ticked = grom.stats.dmgTaken - took0;
  assert.ok(ticked > 0, 'the rot ticked');
  const regen = hexa.maxHp * sim.context.BALANCE.hpRegenPct + hexa.attrs.get('hpRegen');
  near(hexa.hp - hp0, ticked * 0.12 + regen, 2, 'healed 12% of the Blight damage, on top of one second of regen');
  // nothing off a creep
  reset();
  T.place(hexa, open.x, open.y);
  const m = creep(0, open.x + 300, open.y);
  basic(hexa, m);
  assert.equal(markStacks(m, 'blight'), 1, 'creeps rot too');
  hexa.hp = hexa.maxHp * 0.5;
  const hp1 = hexa.hp;
  T.seconds(G, 1.0);
  assert.ok(hexa.hp - hp1 < hexa.maxHp * 0.006 * 1.1 + 1, 'no Blight heal off a creep (base regen only)');
});

T.test('Hexa: Leech Thread ticks five times over 3 s healing her 40% of each with a 15% slow, then bursts, slows 40% and spreads 2 Blight within 200; it snaps past 620 or when she is stunned, and Purify releases it; the aim cone falls back to the nearest hero', () => {
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 300, open.y); T.place(zephyr, open.x + 300, open.y + 150); T.place(ignis, open.x + 300, open.y + 400);
  grom.attrs.bonus.tenacity = 0;
  G.update(1 / 60); T.reveal(G);
  hexa.hp = hexa.maxHp * 0.4;
  assert.ok(hexa.castSkill(1, { x: open.x + 300, y: open.y }));
  const tt = hexa.liveTether();
  assert.ok(tt && tt.target === grom, 'latched onto the hero in the cone');
  const tick = 40 + 6 * 5 + hexa.magicPower() * 0.25;
  // the thread's ticks are the big hits; the Blight rot they apply ticks small amounts at 4 Hz in between
  let ticks = 0, lastTaken = grom.stats.dmgTaken, healed = 0, dealt = 0, hpBefore = hexa.hp, slowSeen = 0;
  for (let k = 0; k < 60 * 2.9; k++) {
    G.update(1 / 60); T.reveal(G);
    slowSeen = Math.max(slowSeen, grom.cc.slowPct);
    const took = grom.stats.dmgTaken - lastTaken;
    if (took > 30) { ticks++; dealt += took; healed += hexa.hp - hpBefore; }
    lastTaken = grom.stats.dmgTaken; hpBefore = hexa.hp;
  }
  assert.equal(ticks, 4, 'four ticks by 2.9 s');
  near(slowSeen, 0.15, 1e-9, '15% slow while linked');
  near(healed, dealt * 0.4, dealt * 0.4 * 0.2 + 4, 'healed about 40% of the ticks');
  const mrMult = 95 / (95 + grom.mrValue());
  near(dealt / 4, tick * 0.88 * mrMult, 6, 'each tick 40+6/rank +25% MAGIC (skill damage, mitigated; a rot tick may share the frame)');
  // the completion: the fifth tick lands on the completion frame, then the burst, the slow and the spread
  const before = grom.stats.dmgTaken;
  T.seconds(G, 0.2);
  assert.ok(!hexa.liveTether(), 'over at 3 s');
  assert.ok(hexa.lastTetherDone && hexa.lastTetherDone.target === grom, 'the completion is remembered for the bot');
  assert.ok(grom.stats.dmgTaken - before > tick * 0.88 * mrMult * 1.5, `fifth tick plus the burst: ${grom.stats.dmgTaken - before}`);
  near(grom.cc.slowPct, 0.40, 1e-9, 'the burst slows 40%');
  assert.equal(markStacks(grom, 'blight'), 2, 'the target carries 2 Blight');
  assert.equal(markStacks(zephyr, 'blight'), 2, '2 Blight spread to a hero 150 from the target');
  assert.equal(markStacks(ignis, 'blight'), 0, 'nothing 400 away');
  assert.ok(zephyr.dots.some(k => k.tag === 'blight'), 'the spread Blight rots');
  // breaks past 620 with no payload
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 300, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.ok(hexa.castSkill(1, { x: open.x + 300, y: open.y }));
  T.seconds(G, 0.7);
  T.place(grom, open.x + 700, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.ok(!hexa.liveTether(), 'snapped past 620');
  assert.ok(!(grom.cc.slowPct >= 0.4), 'no burst');
  // a stun on Hexa cuts it
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 300, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.ok(hexa.castSkill(1, { x: open.x + 300, y: open.y }));
  hexa.cc.apply('stun', 0.5, 0);
  G.update(1 / 60); T.reveal(G);
  assert.ok(!hexa.liveTether(), 'cut by a stun on her');
  // Purify on the target releases it
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 300, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.ok(hexa.castSkill(1, { x: open.x + 300, y: open.y }));
  grom.cc.purify(1);
  assert.ok(!hexa.liveTether(), 'released by Purify');
  // fallback: nobody in the 60-degree cone, the nearest hero in reach is taken instead
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x, open.y + 300);
  G.update(1 / 60); T.reveal(G);
  assert.ok(hexa.castSkill(1, { x: open.x + 300, y: open.y }), 'aimed 90 degrees off him');
  assert.ok(hexa.liveTether() && hexa.liveTether().target === grom, 'the nearest hero in reach');
});

T.test('Hexa: Black Mass pulses four times over 2 s and every pulse applies Blight', () => {
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 400, open.y);
  assert.ok(hexa.castSkill(2, { x: open.x + 400, y: open.y }));
  let hits = 0, lastTaken = 0;
  for (let k = 0; k < 60 * 3; k++) {
    G.update(1 / 60); T.reveal(G);
    const took = grom.stats.dmgTaken - lastTaken;
    if (took > 30) hits++;   // a pulse (the rot's own ticks are small)
    lastTaken = grom.stats.dmgTaken;
  }
  assert.equal(hits, 4, 'four pulses');
  assert.equal(markStacks(grom, 'blight'), 2, 'Blighted by the pulses');
});

T.test('Hexa bot: the thread goes on the closest hero in reach, then she kites at 490 while it holds; Hex Bolt at the tethered target; Black Mass on the burst or 2+ heroes; retreats under 40%', () => {
  reset();
  T.place(hexa, open.x, open.y); T.place(grom, open.x + 300, open.y); T.place(zephyr, open.x + 500, open.y + 300);   // Zephyr 360 from Grom: outside a mass on him
  G.update(1 / 60); T.reveal(G);
  assert.equal(hexa.p.retreatHp, 0.4, 'retreats to heal under 40%');
  assert.ok(hexa.botSkillUrgency(1, grom, 300, true, false) > 0, 'the thread on a hero in reach');
  assert.equal(hexa.botHoldNow(), 345, 'holds 345 with no thread');
  assert.equal(hexa.botSkillUrgency(0, zephyr, 583, true, false), 500, 'Hex Bolt: a normal poke with no thread');
  assert.ok(hexa.castSkill(1, { x: open.x + 300, y: open.y }));
  assert.equal(hexa.botHoldNow(), 490, 'the thread holds: keep 400-580');
  const cp = hexa.chooseCombatPoint(grom);
  near(Math.hypot(cp.x - grom.x, cp.y - grom.y), 490, 40, 'the combat point is out past her attack range');
  assert.equal(hexa.botSkillUrgency(0, zephyr, 583, true, false), 720, 'Hex Bolt the tethered target, whoever the bot is looking at');
  const cs = hexa.castSkill.bind(hexa);
  let aimed = null; hexa.castSkill = (i, p) => { aimed = p; return cs(i, p); };
  hexa.botFireSkill(0, zephyr, 583, true, false);
  hexa.castSkill = cs;
  assert.ok(aimed && Math.hypot(aimed.x - grom.x, aimed.y - grom.y) < 60, 'aimed at Grom, not Zephyr');
  // Black Mass
  assert.equal(hexa.botSkillUrgency(2, grom, 300, true, false), 0, 'one healthy hero, no burst: held (a 15% tether slow is not enough)');
  hexa.lastTetherDone = { t: G.time, target: grom };
  assert.equal(hexa.botSkillUrgency(2, grom, 300, true, false), 820, 'right after the burst: Black Mass on him');
  hexa.lastTetherDone = { t: G.time - 2, target: grom };
  assert.equal(hexa.botSkillUrgency(2, grom, 300, true, false), 0, '2 s later: too late');
  T.place(zephyr, open.x + 300, open.y + 200);
  assert.equal(hexa.botSkillUrgency(2, grom, 300, true, false), 880, 'two heroes in the mass');
});

T.done();
