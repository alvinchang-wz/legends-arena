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
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
  for (let k = G.minions.length - 1; k >= 0; k--) if (G.minions[k]._test) { G.minions[k].alive = false; G.minions.splice(k, 1); }
}
reset();
G.update(1 / 60);

/* A creep of `team` parked at (x, y) for the rest of the test (reset removes it). */
function creep(team, x, y) {
  const m = new sim.context.Minion(team, 'mid', 'melee');
  m._test = true; T.place(m, x, y); G.minions.push(m);
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

T.test('Ignis: base stats and skill numbers match the spec (mage band: 500 HP, 250 speed, the only cone and the only consumeMark)', () => {
  reset();
  const d = ignis.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [500, 64, 300, 34, 46, 4.0, 10, 2.0, 12, 2.0, 330, 0.9, 250, 2]);
  assert.equal(d.passive.id, 'kindling');
  const [s1, s2, s3] = ignis.skills;
  assert.deepEqual([s1.type, s1.angle, s1.length, s1.dmg, s1.dmgLv, s1.scaleAp, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.applyMark],
    ['cone', 60, 480, 150, 20, 0.75, 6, -0.3, 45, 5, { tag: 'ember', max: 3, dur: 4, stacks: 1 }]);
  assert.equal(rankVal(s1, 'dmg', 6), 250); near(rankVal(s1, 'cd', 6), 4.5, 1e-9, 'Fan cd at rank 6'); assert.equal(rankVal(s1, 'mana', 6), 70);
  assert.deepEqual([s2.type, s2.radius, s2.dmg, s2.dmgLv, s2.scaleAp, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.consumeMark],
    ['nova', 260, 110, 15, 0.45, 9, -0.4, 60, 5, { tag: 'ember', dmg: 65, dmgLv: 0, scaleAp: 0.20, stunAtStacks: 3, stunDur: 0.6, stunLock: 1.5 }]);
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

T.test('Ignis: Flashburn consumes Embers per victim (+65 +20% MAGIC each), stuns 0.6 s at 3, sets a 1.5 s stunLockT that blocks the next stun, and deletes the mark', () => {
  reset();
  T.place(ignis, open.x, open.y); T.place(bastion, open.x + 200, open.y); T.place(nadir, open.x - 200, open.y);
  const s2 = ignis.skills[1], mp = ignis.magicPower();
  const base = rankVal(s2, 'dmg', 6) + 0.45 * mp;
  near(ignis.skillDmg(s2, 6, bastion), base, 1e-6, 'no Embers: base only');
  bastion.marks = { ember: 3, emberT: G.time + 4 }; nadir.marks = { ember: 1, emberT: G.time + 4 };
  near(ignis.skillDmg(s2, 6, bastion), base + 3 * (65 + 0.2 * mp), 1e-6, 'three Embers: +3 x (65 +20% MAGIC)');
  near(ignis.skillDmg(s2, 6, nadir), base + 1 * (65 + 0.2 * mp), 1e-6, 'one Ember: +1 x');
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
  G.update(1 / 60);   // vision
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
  for (let k = 0; k < 12; k++) Hero.prototype.botControl.call(ignis, 1 / 60);
  assert.ok(ignis.x < x0 - 5, `stepped away from the melee: ${ignis.x - x0}`);
});

T.done();
