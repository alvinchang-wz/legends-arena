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

/* ---------------- Vesper ---------------- */

T.test('Vesper: base stats and skill numbers match the spec; Fan the Hammer is the only charge skill', () => {
  reset();
  const d = vesper.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [535, 70, 190, 20, 66, 7.6, 12, 2.1, 10, 1.5, 330, 1.0, 252]);
  assert.equal(d.passive.id, 'lastlight');
  const [s1, s2, s3] = vesper.skills;
  assert.deepEqual([s1.type, s1.charges, s1.recharge, s1.rechargeLv, s1.castDelay, s1.cd, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAd, s1.range, s1.speed, s1.radius, s1.pierce],
    ['skillshot', 3, 9, -0.4, 0.6, undefined, 30, 3, 100, 14, 0.6, 560, 1300, 22, false]);
  assert.equal(vesper.rechargeFor(s1, 6), 7); assert.equal(rankVal(s1, 'dmg', 6), 170); assert.equal(rankVal(s1, 'mana', 6), 45);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.dist, s2.speed, s2.dmg, s2.buff], ['dash', 10, -0.3, 45, 250, 1150, undefined, undefined]);
  assert.deepEqual(s2.endNova, { radius: 170, dmgType: 'physical', dmg: 70, dmgLv: 10, scaleAd: 0.45, slowPct: 0.3, slowDur: 1.0 });
  assert.ok(Math.abs(vesper.cooldownFor(s2, 6) - 8.5) < 1e-9);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.dmg, s3.scaleAd, s3.range, s3.speed, s3.radius, s3.pierce],
    ['skillshot', [40, 35, 30], [100, 120, 140], [280, 380, 480], 1.1, 820, 1500, 20, false]);
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.charges)).length, 1, 'the only charge skill in the roster');
  for (const s of vesper.skills) assert.ok(s.desc && s.desc.length > 20);
});

T.test('Vesper: Fan the Hammer starts empty, refills one charge per 7 s ignoring cdr, fires one round per cast 0.6 s apart, and a creep blocks the round', () => {
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 300, open.y);
  assert.equal(vesper.skillCharges[0], 0);
  assert.equal(vesper.castSkill(0, grom), false, 'nothing banked');
  T.seconds(G, 7.05);
  assert.equal(vesper.skillCharges[0], 1, 'one charge after 7 s');
  T.seconds(G, 14.1);
  assert.equal(vesper.skillCharges[0], 3, 'full after 21 s');
  vesper.items.push({ id: 'test-cdr', stats: { cdr: 0.3 } }); vesper.recalcStats(false);
  vesper.mana = vesper.maxMana;
  const mana0 = vesper.mana;
  assert.ok(vesper.castSkill(0, grom));
  assert.equal(vesper.skillCharges[0], 2);
  assert.ok(Math.abs(vesper.mana - (mana0 - 45)) < 1e-9, 'rank-6 mana 45 per round');
  assert.ok(Math.abs(vesper.skillRecharge[0] - 7) < 1e-9, 'the recharge ignores cdr');
  assert.ok(Math.abs(vesper.skillCd[0] - 0.42) < 1e-9, 'castDelay 0.6 x (1 - cdr) between rounds');
  assert.equal(vesper.castSkill(0, grom), false, 'inside the castDelay');
  T.seconds(G, 0.45);
  assert.ok(vesper.castSkill(0, grom)); T.seconds(G, 0.45); assert.ok(vesper.castSkill(0, grom));
  assert.equal(vesper.skillCharges[0], 0, 'three separate casts');
  T.frames(G, 30);
  assert.ok(grom.stats.dmgTaken > 0, 'the rounds landed');
  vesper.items.length = 0; vesper.recalcStats(false);
  // a creep in front takes the round instead of the hero behind it
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 400, open.y);
  const m = creep(0, open.x + 200, open.y);
  vesper.skillCharges[0] = 3;
  const mhp = m.hp;
  assert.ok(vesper.castSkill(0, grom));
  T.frames(G, 30);
  assert.ok(m.hp < mhp, 'the creep took the round'); assert.equal(grom.stats.dmgTaken, 0, 'the hero behind it was not hit');
});

T.test('Vesper: Last Light adds 20% to basics and Deadeye on a hero under 40% (not to Fan the Hammer) and a critical basic refunds 1 s of the recharge once per 2.5 s', () => {
  reset();
  grom.hp = grom.maxHp * 0.3;
  assert.ok(Math.abs(vesper.onDealDamage(grom, 100, { isBasic: true }) - 120) < 1e-9, 'a basic on a hero under 40%');
  assert.ok(Math.abs(vesper.onDealDamage(grom, 100, { skill: vesper.skills[2] }) - 120) < 1e-9, 'Deadeye Round too');
  assert.equal(vesper.onDealDamage(grom, 100, { skill: vesper.skills[0] }), 100, 'Fan the Hammer does not benefit');
  grom.hp = grom.maxHp * 0.5;
  assert.equal(vesper.onDealDamage(grom, 100, { isBasic: true }), 100, 'above 40%: nothing');
  const m = creep(0, open.x + 200, open.y); m.hp = m.maxHp * 0.1;
  assert.equal(vesper.onDealDamage(m, 100, { isBasic: true }), 100, 'creeps never');
  // the refund
  vesper.skillCharges[0] = 1; vesper.skillRecharge[0] = 5;
  vesper.onBasicLanded(grom, 50, { isBasic: true, crit: false });
  assert.equal(vesper.skillRecharge[0], 5, 'no crit: no refund');
  vesper.onBasicLanded(grom, 50, { isBasic: true, crit: true });
  assert.ok(Math.abs(vesper.skillRecharge[0] - 4) < 1e-9, 'a crit: 1.0 s off the running recharge');
  vesper.onBasicLanded(grom, 50, { isBasic: true, crit: true });
  assert.ok(Math.abs(vesper.skillRecharge[0] - 4) < 1e-9, 'once per 2.5 s');
  vesper.onBasicLanded(m, 50, { isBasic: true, crit: true });
  vesper.pv.refundT = -99;
  vesper.onBasicLanded(m, 50, { isBasic: true, crit: true });
  assert.ok(Math.abs(vesper.skillRecharge[0] - 4) < 1e-9, 'a crit on a creep refunds nothing');
  vesper.onBasicLanded(grom, 50, { isBasic: true, crit: true });
  assert.ok(Math.abs(vesper.skillRecharge[0] - 3) < 1e-9, 'after the lockout: again');
  // a real critical arrow carries pkt.crit through resolveDamage
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 250, open.y);
  vesper.items.push({ id: 'test-crit', stats: { critChance: 1 } }); vesper.recalcStats(false);
  vesper.skillCharges[0] = 0; vesper.skillRecharge[0] = 6;
  basic(vesper, grom);
  assert.ok(vesper.skillRecharge[0] < 6 - 1 - 0.6 && vesper.skillRecharge[0] > 6 - 1 - 0.75, `the arrow's crit refunded 1 s (plus the frames elapsed): ${vesper.skillRecharge[0]}`);
  vesper.items.length = 0; vesper.recalcStats(false);
});

T.test('Vesper: Sidestep slides 250 and bursts 170 around the landing (slow 30% for 1 s); Deadeye Round stops on the first unit for 480 (+110% ATK) at rank 3', () => {
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 350, open.y); T.place(ignis, open.x + 600, open.y);
  assert.ok(vesper.castSkill(1, grom));
  assert.ok(vesper.dashS && Math.abs(vesper.dashS.remaining - 250) < 1e-9 && vesper.dashS.dmg === 0, 'a 250 slide with no path damage');
  assert.ok(Math.abs(vesper.skillCd[1] - 8.5) < 1e-9, 'rank-6 cooldown 8.5');
  T.seconds(G, 0.3);
  assert.equal(vesper.dashS, null);
  assert.ok(grom.stats.dmgTaken > 0, 'the burst hit Grom (100 from the landing)');
  assert.equal(ignis.stats.dmgTaken, 0, 'Ignis at 350 was outside 170');
  assert.ok(Math.abs(grom.cc.slowPct - 0.3) < 1e-9 && grom.cc.t.slow > 0.7 && grom.cc.t.slow <= 1.0, `slow 30% for 1 s (the slide took 0.22 s of the 0.3): ${grom.cc.slowPct} ${grom.cc.t.slow}`);
  // Deadeye: the first unit on the line takes it, the one behind does not
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 300, open.y); T.place(ignis, open.x + 500, open.y);
  const mana0 = vesper.mana;
  assert.ok(vesper.castSkill(2, ignis));
  assert.equal(vesper.skillCd[2], 30); assert.ok(Math.abs(vesper.mana - (mana0 - 140)) < 1e-9);
  const p = G.projectiles[G.projectiles.length - 1];
  assert.ok(Math.abs(p.dmg - (480 + vesper.curAtk() * 1.1)) < 1e-6, 'rank-3 damage before mitigation');
  assert.equal(p.pierce, false); assert.equal(p.maxDist, 820);
  T.frames(G, 40);
  assert.ok(grom.stats.dmgTaken > 0, 'Grom in front took it'); assert.equal(ignis.stats.dmgTaken, 0, 'Ignis behind him did not');
});

T.test('Vesper bot: rounds are held on a blocked line and banked to two out of a fight; Deadeye only under 45%; Sidestep opens the line, or away from a melee once the hammer is empty', () => {
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 400, open.y);
  const [s1, s2] = vesper.skills;
  vesper.skillCharges[0] = 3;
  assert.ok(vesper.botSkillUrgency(0, grom, 400, true, false) > 0, 'three charges, clear line: poke');
  vesper.skillCharges[0] = 2;
  assert.equal(vesper.botSkillUrgency(0, grom, 400, true, false), 0, 'two charges out of a fight: banked');
  vesper.lastDmgT = G.time;   // she traded a moment ago: in a fight
  assert.ok(vesper.botSkillUrgency(0, grom, 400, true, false) > 0, 'in a fight: dump them');
  vesper.skillCharges[0] = 1;
  assert.ok(vesper.botSkillUrgency(0, grom, 400, true, false) > 0);
  const m = creep(0, open.x + 200, open.y);
  assert.equal(vesper.botSkillUrgency(0, grom, 400, true, false), 0, 'a creep on the line: held');
  assert.equal(vesper.botSkillUrgency(2, grom, 400, true, false), 0, 'Deadeye too');
  // Sidestep to a spot with a clear line, and it lands there
  assert.equal(vesper.botSkillUrgency(1, grom, 400, true, false), 760, 'Sidestep for a clear line');
  const pt = vesper.dashPick(s2, grom);
  assert.ok(Math.abs(Math.hypot(pt.x - open.x, pt.y - open.y) - 250) < 1, 'a full slide');
  assert.ok(!vesper.lineBlockedFrom(pt.x, pt.y, grom, s1), 'the line from the landing is clear');
  vesper.skillCharges[0] = 0;
  assert.equal(vesper.clearLinePoint(s2, grom), null, 'no charge to shoot with: no need');
  // Deadeye: an execute only, whatever the crowd around her
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 400, open.y); T.place(ignis, open.x + 300, open.y + 200); T.place(torren, open.x - 300, open.y);
  grom.hp = grom.maxHp * 0.6;
  assert.equal(vesper.botSkillUrgency(2, grom, 400, true, false), 0, '60%: held even with three heroes about');
  grom.hp = grom.maxHp * 0.44;
  assert.ok(vesper.botSkillUrgency(2, grom, 400, true, false) > 0, 'under 45%: fire');
  // a melee inside 220: Sidestep away only once the hammer is empty
  reset();
  T.place(vesper, open.x, open.y); T.place(grom, open.x + 400, open.y); T.place(torren, open.x - 180, open.y);
  vesper.skillCharges[0] = 1;
  assert.equal(vesper.kiteThreat(s2), null, 'a charge left: shoot him instead');
  vesper.skillCharges[0] = 0;
  assert.equal(vesper.kiteThreat(s2), torren);
  assert.equal(vesper.botSkillUrgency(1, grom, 400, true, false), 800, 'empty: hop away');
  const away = vesper.dashPick(s2, grom);
  assert.ok(away.x > open.x + 150, `lands away from Torren: ${away.x - open.x}`);
});

T.done();
