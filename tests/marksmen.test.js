'use strict';
/* The four Marksman kits (docs/design/heroes.md, "Marksmen"; docs/design/hero-kits.json):
   Zephyr, Vesper, Quill, Lumen — passives, skill numbers, the engine
   behaviours each signature mechanic leans on, and the bot rules from their
   bot hints. */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim({ blueLineup: 'zephyr,quill,grom,ignis,torren', redLineup: 'vesper,lumen,bastion,mira,brass' });
const G = sim.Game;
const { rankVal } = require('../js/combat');
const { Hero } = sim.context;
T.parkAll(G);

const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const quill = T.maxSkills(T.hero(G, 'quill', 0));
const grom = T.maxSkills(T.hero(G, 'grom', 0));
const ignis = T.maxSkills(T.hero(G, 'ignis', 0));
const torren = T.maxSkills(T.hero(G, 'torren', 0));
const vesper = T.maxSkills(T.hero(G, 'vesper', 1));
const lumen = T.maxSkills(T.hero(G, 'lumen', 1));
const bastion = T.maxSkills(T.hero(G, 'bastion', 1));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const brass = T.maxSkills(T.hero(G, 'brass', 1));
const ALL = [zephyr, quill, grom, ignis, torren, vesper, lumen, bastion, mira, brass];
const open = T.openSpot(G, 420);
const FAR = { x: open.x + 2200, y: open.y + 2200 };

function reset() {
  for (const h of ALL) {
    T.place(h, FAR.x, FAR.y);
    h.items.length = 0; h.gold = 0;
    h.hp = h.maxHp; h.mana = h.resource === 'heat' ? 0 : h.maxMana;
    h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.shields = []; h.untargetable = false; h.hot = null; h.buffAtkT = 0; h.buffAsT = 0; h.buffAsMult = 1; h.buffState = null;
    h.basicMod = null; h.basicRangeState = null; h.recast = null; h.aiTarget = null; h.aiState = 'push'; h.fleeT = 0;
    h.lastTakedownT = -99; h.lastKillT = -99; h.lastDmgT = -99; h.stats.dmgTaken = 0; h.stillT = 0;
    h.skillCharges = [0, 0, 0]; h.skillRecharge = [0, 0, 0];
    if (h.pv && h.pv.stacks !== undefined) { h.pv.stacks = 0; h.pv.t = 0; }
    if (h.pv && h.pv.n !== undefined) { h.pv.n = 0; h.pv.t = 0; }
    if (h.pv && h.pv.refundT !== undefined) h.pv.refundT = -99;
    h.recalcStats(false);
    h.hp = h.maxHp;
  }
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
}
reset();
G.update(1 / 60);

/* Fire one basic from `h` at `t` and let the arrow land. */
function basic(h, t) {
  h.atkCd = 0;
  h.tryAttack(t);
  T.frames(G, 40);
}

/* ---------------- Zephyr ---------------- */

T.test('Zephyr: base stats and skill numbers match the spec (marksman band: lowest HP, highest attack speed)', () => {
  reset();
  const d = zephyr.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [520, 68, 200, 22, 60, 7.0, 12, 2.2, 10, 1.6, 345, 1.12, 248]);
  assert.equal(d.passive.id, 'slipstream');
  const [s1, s2, s3] = zephyr.skills;
  assert.deepEqual([s1.type, s1.pierce, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAd, s1.range, s1.speed, s1.radius],
    ['skillshot', true, 7, -0.3, 40, 4, 110, 16, 0.75, 700, 1000, 26]);
  assert.equal(rankVal(s1, 'dmg', 6), 190); assert.equal(rankVal(s1, 'mana', 6), 60);
  assert.ok(Math.abs(zephyr.cooldownFor(s1, 6) - 5.5) < 1e-9);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.dist, s2.speed, s2.dmg, s2.buff], ['dash', 11, -0.4, 50, 260, 1100, undefined, { asMult: 1.5, dur: 3 }]);
  assert.ok(Math.abs(zephyr.cooldownFor(s2, 6) - 9) < 1e-9);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.dur, s3.lineRange, s3.radius, s3.pierce, s3.bonusDmg, s3.bonusDmgLv, s3.bonusScaleAd, s3.asMult],
    ['basicMod', [48, 42, 36], [100, 120, 140], 6, 420, 30, true, 40, 25, 0.25, [1.3, 1.4, 1.5]]);
  assert.deepEqual([1, 2, 3].map(r => rankVal(s3, 'bonusDmg', r)), [40, 65, 90]);
  for (const s of zephyr.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Zephyr: Slipstream stacks +6% move speed per basic hit to 5 (30%), drops together after 2 s, and adds +18 (+12% ATK) to basics at 5 stacks', () => {
  reset();
  T.place(zephyr, open.x, open.y); T.place(bastion, open.x + 250, open.y);
  G.update(1 / 60);   // settle the terrain flags (river) before reading the speed
  const spd0 = zephyr.curSpeed();
  basic(zephyr, bastion);
  assert.equal(zephyr.pv.stacks, 1, 'one stack per basic that lands');
  assert.ok(Math.abs(zephyr.curSpeed() / spd0 - 1.06) < 1e-6, `+6%: ${zephyr.curSpeed() / spd0}`);
  assert.equal(zephyr.onDealDamage(bastion, 100, { isBasic: true }), 100, 'no damage bonus under 5 stacks');
  for (let k = 0; k < 6; k++) basic(zephyr, bastion);
  assert.equal(zephyr.pv.stacks, 5, 'capped at 5');
  assert.ok(Math.abs(zephyr.curSpeed() / spd0 - 1.30) < 1e-6, `+30%: ${zephyr.curSpeed() / spd0}`);
  const bonus = 18 + zephyr.curAtk() * 0.12;
  assert.ok(Math.abs(zephyr.onDealDamage(bastion, 100, { isBasic: true }) - (100 + bonus)) < 1e-6, 'five stacks: +18 +12% ATK on a basic');
  assert.equal(zephyr.onDealDamage(bastion, 100, { skill: zephyr.skills[0] }), 100, 'skills get nothing');
  T.seconds(G, 2.1);
  assert.equal(zephyr.pv.stacks, 0, 'all five drop together when the timer lapses');
  assert.ok(Math.abs(zephyr.curSpeed() - spd0) < 1e-6, 'speed back to base');
  // a Gale Shot through two heroes is one stack, a creep hit none
  reset();
  T.place(zephyr, open.x, open.y); T.place(bastion, open.x + 250, open.y); T.place(mira, open.x + 420, open.y);
  assert.ok(zephyr.castSkill(0, { x: open.x + 500, y: open.y }));
  T.frames(G, 40);
  assert.ok(bastion.stats.dmgTaken > 0 && mira.stats.dmgTaken > 0, 'pierced both');
  assert.equal(zephyr.pv.stacks, 1, 'one Slipstream stack per Gale Shot cast that hits a hero');
});

T.test('Zephyr: Updraft dashes 260 with +50% attack speed for 3 s; Storm Volley pierces a 420 line for 6 s with +90 (+25% ATK) at rank 3, attack speed the max of the two', () => {
  reset();
  T.place(zephyr, open.x, open.y); T.place(bastion, open.x + 250, open.y); T.place(mira, open.x + 400, open.y); T.place(brass, open.x + 400, open.y + 160);
  const as0 = zephyr.curAtkSpd();
  assert.ok(zephyr.castSkill(1, { x: open.x - 300, y: open.y }));
  assert.ok(zephyr.dashS && Math.abs(zephyr.dashS.remaining - 260) < 1e-9 && zephyr.dashS.dmg === 0, 'a 260 hop with no damage');
  assert.ok(Math.abs(zephyr.curAtkSpd() - as0 * 1.5) < 1e-9, 'x1.5 attack speed');
  assert.ok(Math.abs(zephyr.buffAsT - 3) < 1e-9, 'for 3 s');
  assert.equal(zephyr.mana, zephyr.maxMana - 50);
  T.seconds(G, 0.4);
  assert.equal(zephyr.dashS, null);
  T.place(zephyr, open.x, open.y);
  const mana0 = zephyr.mana;
  assert.ok(zephyr.castSkill(2, bastion));
  assert.equal(zephyr.skillCd[2], 36); assert.ok(Math.abs(zephyr.mana - (mana0 - 140)) < 1e-9, 'rank-3 cost 140');
  assert.ok(zephyr.basicMod && Math.abs(zephyr.basicMod.t - 6) < 1e-9 && zephyr.basicMod.asMult === 1.5);
  assert.ok(Math.abs(zephyr.curAtkSpd() - as0 * 1.5) < 1e-9, 'max(1.5, 1.5), not x2.25');
  zephyr.buffAsT = 0;
  assert.ok(Math.abs(zephyr.curAtkSpd() - as0 * 1.5) < 1e-9, 'the volley alone is x1.5 at rank 3');
  zephyr.atkCd = 0; G.projectiles.length = 0;
  zephyr.tryAttack(bastion);
  const v = G.projectiles[G.projectiles.length - 1];
  assert.equal(v.kind, 'volley'); assert.equal(v.maxDist, 420); assert.equal(v.radius, 30);
  assert.ok(Math.abs(v.bonus - (90 + zephyr.curAtk() * 0.25)) < 1e-6, 'rank-3 bonus per enemy hit');
  T.frames(G, 30);
  assert.ok(bastion.stats.dmgTaken > 0 && mira.stats.dmgTaken > 0, 'the line behind the target is pierced');
  assert.equal(brass.stats.dmgTaken, 0, 'off the line');
  assert.equal(zephyr.pv.stacks, 1, 'a volley is one Slipstream stack whatever it pierced');
  zephyr.mana = zephyr.maxMana;
  assert.ok(zephyr.castSkill(0, bastion) && zephyr.basicMod, 'casting a skill does not end it');
  T.seconds(G, 6);
  assert.equal(zephyr.basicMod, null, 'ends after 6 s');
});

T.test('Zephyr bot: Storm Volley on 2+ heroes inside 420 (best in a line), never on a lone healthy hero; Updraft away from a melee within 200, toward the target only once an ally has engaged', () => {
  reset();
  T.place(zephyr, open.x, open.y); T.place(bastion, open.x + 300, open.y);
  const s3 = zephyr.skills[2], s2 = zephyr.skills[1];
  assert.equal(zephyr.botSkillUrgency(2, bastion, 300, true, false), 0, 'one full-HP hero: held');
  bastion.hp = bastion.maxHp * 0.5;
  assert.equal(zephyr.botSkillUrgency(2, bastion, 300, true, false), 560, 'a lone hero the volley can finish');
  bastion.hp = bastion.maxHp;
  T.place(mira, open.x + 200, open.y + 300);   // second hero, well off the line
  assert.equal(zephyr.botSkillUrgency(2, bastion, 300, true, false), 640, 'two heroes, not lined up');
  T.place(mira, open.x + 400, open.y + 60);    // roughly behind Bastion
  assert.equal(zephyr.botSkillUrgency(2, bastion, 300, true, false), 900, 'two heroes in a rough line');
  assert.ok(s3.type === 'basicMod');
  // Updraft: no ally engaged, a ranged target at 300: held
  reset();
  T.place(zephyr, open.x, open.y); T.place(mira, open.x + 300, open.y);
  assert.equal(zephyr.botSkillUrgency(1, mira, 300, true, false), 0, 'no ally on the target: no engage dash');
  T.place(grom, open.x + 400, open.y); grom.lastDmgT = G.time;   // Grom is fighting next to her
  assert.equal(zephyr.botSkillUrgency(1, mira, 300, true, false), 360, 'an ally has engaged: Updraft in');
  // a melee hero inside 200: the hop goes away from him, whatever the target
  T.place(brass, open.x + 150, open.y);
  assert.equal(zephyr.botSkillUrgency(1, mira, 300, true, false), 800, 'melee within 200: hop away');
  const pt = zephyr.dashPick(s2, mira);
  assert.ok(pt.x < open.x - 150, `lands away from Brass: ${pt.x - open.x}`);
  assert.ok(Math.abs(Math.hypot(pt.x - open.x, pt.y - open.y) - 260) < 1, 'a full 260 hop');
});

T.test('Marksman bots kite: during attack recovery a marksman steps straight away from a melee hero inside 250', () => {
  reset();
  T.place(zephyr, open.x, open.y); T.place(mira, open.x + 300, open.y); T.place(brass, open.x - 150, open.y);
  zephyr.aiTarget = mira; zephyr.atkCd = 0.9; zephyr.combatPoint = null;
  const d0 = zephyr.distTo(brass);
  for (let k = 0; k < 12; k++) Hero.prototype.botControl.call(zephyr, 1 / 60);
  assert.ok(zephyr.distTo(brass) > d0 + 40, `stepped away from the melee: ${zephyr.distTo(brass) - d0}`);
  assert.ok(zephyr.x > open.x + 40 && Math.abs(zephyr.y - open.y) < 5, 'straight away from Brass');
  // no melee near: the usual orbit point around the target instead
  reset();
  T.place(zephyr, open.x, open.y); T.place(mira, open.x + 300, open.y); T.place(brass, open.x - 600, open.y);
  zephyr.aiTarget = mira; zephyr.atkCd = 0.9; zephyr.combatPoint = null;
  for (let k = 0; k < 12; k++) Hero.prototype.botControl.call(zephyr, 1 / 60);
  assert.ok(zephyr.combatPoint, 'orbit point chosen');
  assert.equal(zephyr.meleeThreat(250), null);
});

T.done();
