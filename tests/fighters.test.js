'use strict';
/* The six Fighter kits (docs/design/heroes.md, "Fighters"; docs/design/hero-kits.json):
   Torren, Brass, Omen, Karn, Tide, Cinder — passives, skill numbers, the
   engine behaviours each signature mechanic leans on, and the bot rules
   from their bot hints. */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim({ blueLineup: 'torren,brass,omen,zephyr,ignis', redLineup: 'karn,tide,cinder,vesper,sylva' });
const G = sim.Game;
const { rankVal } = require('../js/combat');
T.parkAll(G);

const torren = T.maxSkills(T.hero(G, 'torren', 0));
const brass = T.maxSkills(T.hero(G, 'brass', 0));
const omen = T.maxSkills(T.hero(G, 'omen', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const ignis = T.maxSkills(T.hero(G, 'ignis', 0));
const karn = T.maxSkills(T.hero(G, 'karn', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const cinder = T.maxSkills(T.hero(G, 'cinder', 1));
const vesper = T.maxSkills(T.hero(G, 'vesper', 1));
const sylva = T.maxSkills(T.hero(G, 'sylva', 1));
const ALL = [torren, brass, omen, zephyr, ignis, karn, tide, cinder, vesper, sylva];
const open = T.openSpot(G, 420);
const FAR = { x: open.x + 2200, y: open.y + 2200 };

function reset() {
  for (const h of ALL) {
    T.place(h, FAR.x, FAR.y);
    h.items.length = 0; h.gold = 0;
    h.hp = h.maxHp; h.mana = h.resource === 'heat' ? 0 : h.maxMana;
    h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.shields = []; h.untargetable = false; h.hot = null; h.buffAtkT = 0; h.buffState = null;
    h.lastTakedownT = -99; h.lastKillT = -99; h.lastDmgT = -99;
    if (h.pv && h.pv.n !== undefined) { h.pv.n = 0; h.pv.t = 0; }
    if (h.pv && h.pv.plates !== undefined) { h.pv.plates = 0; h.pv.plateT = 0; }
    h.recalcStats(false);
    h.hp = h.maxHp;
  }
  /* Lane waves wander past the open spot and shoot whatever they find;
     these tests are about kits, so the board starts empty of them. */
  G.minions.length = 0;
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
}
reset();
G.update(1 / 60); T.reveal(G);

/* ---------------- Torren ---------------- */

T.test('Torren: a cooldown-only hero (resource none): no bar, free skills, mana refunds ignored; base stats match the spec', () => {
  reset();
  const d = torren.def0;
  assert.equal(d.resource, 'none');
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [650, 88, 0, 0, 60, 6.8, 19, 3.0, 14, 2.2, 95, 1.02, 262]);
  assert.equal(torren.maxMana, 0); assert.equal(torren.mana, 0);
  assert.equal(torren.usesMana(), false);
  for (const s of torren.skills) { assert.equal(s.mana, 0); assert.equal(torren.costOf(s, 1), 0); assert.ok(torren.canAfford(s, 1)); }
  torren.gainMana(50);
  assert.equal(torren.mana, 0, 'a mana refund gives him nothing');
  T.place(torren, open.x, open.y); T.place(tide, open.x + 150, open.y);
  assert.ok(torren.castSkill(0, tide), 'a free cast at 0 mana');
  assert.equal(torren.mana, 0);
});

T.test('Torren: Bloodthirst is 8% lifesteal plus 1% per 3% missing HP, 35% at or below 20% HP', () => {
  reset();
  const ls = pct => { torren.hp = torren.maxHp * pct; torren.recalcStats(false); return torren.attrs.get('lifesteal'); };
  assert.ok(Math.abs(ls(1.0) - 0.08) < 1e-9, `full HP: ${ls(1.0)}`);
  assert.ok(Math.abs(ls(0.7) - 0.18) < 1e-9, `30% missing: ${ls(0.7)}`);
  assert.ok(Math.abs(ls(0.4) - 0.28) < 1e-9, `60% missing: ${ls(0.4)}`);
  assert.ok(Math.abs(ls(0.2) - 0.35) < 1e-9, `20% HP: ${ls(0.2)}`);
  assert.ok(Math.abs(ls(0.05) - 0.35) < 1e-9, `capped at 35%: ${ls(0.05)}`);
  torren.hp = torren.maxHp; torren.recalcStats(false);
});

T.test('Torren: Whirling Axe 110+13/rank (+55% ATK) grows +1% per 2% of his missing HP, max +30%; cd 8 -> 6.5', () => {
  reset();
  const s = torren.skills[0];
  assert.deepEqual([s.type, s.cd, s.cdLv, s.mana, s.radius, s.dmg, s.dmgLv, s.scaleAd], ['nova', 8, -0.3, 0, 220, 110, 13, 0.55]);
  assert.deepEqual(s.selfMissingBonus, { perPct: 0.01, per: 0.02, max: 0.3 });
  assert.equal(rankVal(s, 'dmg', 6), 175);
  assert.ok(Math.abs(torren.cooldownFor(s, 6) - 6.5) < 1e-9);
  const base = 110 + torren.curAtk() * 0.55;
  torren.hp = torren.maxHp;
  assert.ok(Math.abs(torren.skillDmg(s, 1) - base) < 1e-9, 'no bonus at full HP');
  torren.hp = torren.maxHp * 0.6;
  assert.ok(Math.abs(torren.skillDmg(s, 1) - base * 1.2) < 1e-6, `40% missing -> +20%: ${torren.skillDmg(s, 1) / base}`);
  torren.hp = torren.maxHp * 0.1;
  assert.ok(Math.abs(torren.skillDmg(s, 1) - base * 1.3) < 1e-6, `90% missing caps at +30%: ${torren.skillDmg(s, 1) / base}`);
  torren.hp = torren.maxHp;
});

T.test('Torren: War Leap is a leap to the aimed point (up to 340) that slams for 110+13/rank (+60% ATK) and slows 30% for 1.2 s', () => {
  reset();
  const s = torren.skills[1];
  assert.deepEqual([s.type, s.dashToPoint, s.cd, s.cdLv, s.mana, s.dist, s.speed, s.dmg], ['dash', true, 11, -0.3, 0, 340, 950, undefined]);
  assert.deepEqual(s.endNova, { radius: 180, dmgType: 'physical', dmg: 110, dmgLv: 13, scaleAd: 0.6, slowPct: 0.3, slowDur: 1.2 });
  T.place(torren, open.x, open.y);
  T.place(tide, open.x + 200, open.y);
  assert.ok(torren.castSkill(1, { x: open.x + 200, y: open.y }));
  assert.ok(torren.dashS && Math.abs(torren.dashS.remaining - 200) < 1e-9, 'stops at the aim point, not at 340');
  assert.equal(torren.dashS.dmg, 0, 'no path damage');
  assert.ok(torren.skillCd[1] > 9.4 && torren.skillCd[1] <= 9.5, `rank-6 cooldown 9.5: ${torren.skillCd[1]}`);
  T.seconds(G, 0.4);
  assert.equal(torren.dashS, null);
  assert.ok(Math.abs(torren.x - (open.x + 200)) < 2, `landed on the point: ${torren.x - open.x}`);
  assert.ok(tide.hp < tide.maxHp, 'slam damage');
  assert.ok(Math.abs(tide.cc.slowPct - 0.3) < 1e-9 && tide.cc.t.slow > 0.95 && tide.cc.t.slow <= 1.2, `slow 30% 1.2 s (0.2 s after landing): ${tide.cc.slowPct} ${tide.cc.t.slow}`);
  // a far aim caps at 340
  reset();
  T.place(torren, open.x, open.y);
  torren.castSkill(1, { x: open.x + 900, y: open.y });
  assert.ok(torren.dashS && Math.abs(torren.dashS.remaining - 340) < 1e-9);
  T.seconds(G, 0.5);
  assert.ok(Math.abs(torren.x - (open.x + 340)) < 2, `capped at 340: ${torren.x - open.x}`);
});

T.test("Torren: Reaver's Toll is 135/175/215 (+70% ATK) true damage plus 12/16/20% of his missing HP (cap 50% max HP), computed once at cast", () => {
  reset();
  const s = torren.skills[2];
  assert.deepEqual([s.type, s.cd, s.mana, s.radius, s.dmgType, s.dmg, s.scaleAd, s.selfMissingPct, s.selfMissingCap],
    ['nova', [42, 38, 34], 0, 260, 'true', [135, 175, 215], 0.7, [0.12, 0.16, 0.2], 0.5]);
  T.place(torren, open.x, open.y);
  T.place(tide, open.x + 200, open.y);
  T.place(vesper, open.x - 200, open.y);
  torren.hp = torren.maxHp * 0.3;   // 70% missing: the cap (50%) applies
  const expect = Math.round((215 + torren.curAtk() * 0.7 + torren.maxHp * 0.5 * 0.2) * G.rules.COMBAT.SKILL_DMG);
  assert.ok(torren.castSkill(2, tide));
  assert.equal(torren.skillCd[2], 34, 'rank-3 cooldown');
  const dTide = tide.maxHp - tide.hp, dVesper = vesper.maxHp - vesper.hp;
  assert.equal(dTide, expect, `true damage ignores MR: ${dTide} vs ${expect}`);
  assert.equal(dVesper, expect, 'the same slice for every victim: computed once at cast');
  // at 40% missing the term is uncapped: 0.4 x maxHp x 0.25
  reset();
  T.place(torren, open.x, open.y); T.place(tide, open.x + 200, open.y);
  torren.hp = torren.maxHp * 0.6;
  const e2 = Math.round((215 + torren.curAtk() * 0.7 + torren.maxHp * 0.4 * 0.2) * G.rules.COMBAT.SKILL_DMG);
  torren.castSkill(2, tide);
  assert.equal(tide.maxHp - tide.hp, e2);
  torren.hp = torren.maxHp;
});

T.test("Torren bot: War Leap lands short of the lowest-HP-percent hero within 340; Reaver's Toll under 50% HP with a hero inside 260, or on two heroes", () => {
  reset();
  T.place(torren, open.x, open.y);
  T.place(tide, open.x + 250, open.y);
  T.place(vesper, open.x, open.y + 300);
  T.place(karn, open.x + 600, open.y);   // out of leap range
  vesper.hp = vesper.maxHp * 0.5; karn.hp = karn.maxHp * 0.2;
  const pt = torren.dashPick(torren.skills[1], tide);
  assert.ok(Math.abs(pt.x - open.x) < 1 && Math.abs(pt.y - (open.y + 240)) < 1, `a point 60 short of Vesper: ${pt.x - open.x}, ${pt.y - open.y}`);
  assert.ok(torren.botSkillUrgency(1, tide, torren.distTo(tide), true, false) > 0, 'the leap is on');
  // the ult: one full-HP hero inside 260 is not enough while Torren is healthy
  T.place(vesper, open.x, open.y + 600); vesper.hp = vesper.maxHp;
  assert.equal(torren.botSkillUrgency(2, tide, torren.distTo(tide), true, false), 0);
  torren.hp = torren.maxHp * 0.45;
  assert.equal(torren.botSkillUrgency(2, tide, torren.distTo(tide), true, false), 860, 'under 50% HP with a hero inside 260');
  torren.hp = torren.maxHp;
  T.place(vesper, open.x - 200, open.y); vesper.hp = vesper.maxHp;
  assert.equal(torren.botSkillUrgency(2, tide, torren.distTo(tide), true, false), 880, 'two heroes inside 260');
});

/* ---------------- Brass ---------------- */

T.test('Brass: base stats and skill numbers match the spec; Rimguard takes 10% less from enemy heroes only', () => {
  reset();
  const d = brass.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [720, 98, 210, 22, 55, 6.0, 22, 3.3, 16, 2.5, 105, 0.95, 252]);
  const [s1, s2, s3] = brass.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAd, s1.selfShieldPct, s1.selfShieldDur, s1.slowPct],
    ['nova', 7, -0.3, 45, 3, 200, 120, 14, 0.55, 0.06, 3, undefined]);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.dist, s2.speed, s2.dmg, s2.dmgLv, s2.scaleAd, s2.stopOnHero, s2.stun],
    ['dash', 12, -0.5, 60, 340, 900, 100, 12, 0.5, true, 0.6]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.radius, s3.dmg, s3.scaleAd, s3.taunt, s3.armorAdd, s3.mrAdd, s3.buffDur],
    ['nova', [44, 40, 36], 120, 260, [220, 290, 360], 0.7, [0.8, 1.0, 1.2], 30, 30, 4]);
  assert.equal(rankVal(s1, 'mana', 6), 60); assert.equal(rankVal(s1, 'dmg', 6), 190);
  T.place(brass, open.x, open.y); T.place(karn, open.x + 200, open.y);
  // a hero's 100 lands as 90, a creep's as 100 (the target-side hook resolveDamage calls)
  assert.equal(brass.onIncomingDamage(karn, 100, { type: 'true' }), 90, 'Rimguard vs a hero');
  const m = G.minions.find(x => x.alive && x.team === 1) || { type: 'minion', team: 1 };
  assert.equal(brass.onIncomingDamage(m, 100, { type: 'true' }), 100, 'a creep hits full');
});

T.test('Brass: Buckler hits everything within 200 with no slow and shields him for 6% max HP for 3 s', () => {
  reset();
  T.place(brass, open.x, open.y); T.place(karn, open.x + 180, open.y); T.place(tide, open.x - 300, open.y);
  assert.ok(brass.castSkill(0, karn));
  assert.ok(karn.hp < karn.maxHp, 'in radius: hit'); assert.equal(tide.hp, tide.maxHp, 'outside 200: not');
  assert.ok(!karn.cc.has('slow'), 'no slow');
  assert.equal(brass.shields.length, 1);
  assert.ok(Math.abs(brass.shields[0].amount - brass.maxHp * 0.06) < 1, `6% max HP: ${brass.shields[0].amount}`);
  assert.ok(Math.abs(brass.shields[0].t - 3) < 1e-9, 'for 3 s');
  assert.equal(brass.mana, brass.maxMana - 60, 'rank-6 cost 60');
});

T.test('Brass: Shoulder stops on the first hero and stuns 0.6 s; Call to the Rim taunts everyone within 260 for 1.2 s and gives +30 armor / MR for 4 s', () => {
  reset();
  T.place(brass, open.x, open.y); T.place(karn, open.x + 200, open.y); T.place(tide, open.x + 330, open.y);
  assert.ok(brass.castSkill(1, tide));
  T.seconds(G, 0.15);
  assert.ok(karn.cc.t.stun > 0.45 && karn.cc.t.stun <= 0.6, `stun 0.6: ${karn.cc.t.stun}`);
  T.seconds(G, 0.35);
  assert.equal(tide.hp, tide.maxHp, 'stopped on Karn, never reached Tide');
  assert.ok(brass.x < open.x + 200, `stopped at the first hero: ${brass.x - open.x}`);
  // the taunt
  reset();
  T.place(brass, open.x, open.y); T.place(karn, open.x + 220, open.y); T.place(tide, open.x, open.y - 200); T.place(vesper, open.x + 500, open.y);
  const armor0 = brass.armorValue(), mr0 = brass.mrValue();
  assert.ok(brass.castSkill(2, karn));
  assert.equal(brass.skillCd[2], 36); assert.equal(brass.mana, brass.maxMana - 120);
  for (const v of [karn, tide]) {
    assert.ok(v.hp < v.maxHp, `${v.name} struck`);
    assert.ok(Math.abs(v.cc.t.taunt - 1.2) < 1e-9, `${v.name} taunted 1.2 s: ${v.cc.t.taunt}`);
    assert.ok(v.forced && v.forced.mode === 'taunt' && v.forced.src === brass, `${v.name} walks at Brass`);
  }
  assert.equal(vesper.hp, vesper.maxHp, 'outside 260');
  assert.ok(!vesper.cc.has('taunt'));
  assert.equal(brass.armorValue(), armor0 + 30, '+30 armor'); assert.equal(brass.mrValue(), mr0 + 30, '+30 MR');
  assert.ok(Math.abs(brass.buffs.armor.t - 4) < 1e-9, 'for 4 s');
  // the victim closes in on Brass and swings at him
  const dk = karn.distTo(brass);
  T.seconds(G, 0.6);
  assert.ok(karn.distTo(brass) < dk - 40 && karn.inAttackRange(brass), `Karn walked into reach of Brass: ${dk} -> ${karn.distTo(brass)}`);
  assert.equal(karn.curTarget, brass);
  // Purify refuses it
  tide.cc.purify(1);
  assert.ok(!tide.cc.has('taunt') && !tide.forced, 'Purify ends the taunt');
  // tenacity shortens it
  reset();
  T.place(brass, open.x, open.y); T.place(karn, open.x + 200, open.y);
  karn.addTimedBuff('tenacity', 0.5, 5);
  brass.castSkill(2, karn);
  assert.ok(Math.abs(karn.cc.t.taunt - 0.6) < 1e-9, `50% tenacity: ${karn.cc.t.taunt}`);
  karn.buffs.tenacity = null; karn.recalcStats(false);
});

T.test('Brass bot: Shoulder goes at the enemy hero attacking an allied hero within 340; Call to the Rim wants 2+ heroes inside 240 and an ally within 400', () => {
  reset();
  T.place(brass, open.x, open.y); T.place(zephyr, open.x - 250, open.y);
  T.place(karn, open.x + 260, open.y); T.place(tide, open.x + 200, open.y + 200);
  karn.hp = karn.maxHp * 0.5;
  tide.curTarget = zephyr;      // Tide is on the marksman
  assert.equal(brass.dashPick(brass.skills[1], karn), tide, 'the shoulder answers whoever is on the ally');
  assert.equal(brass.botSkillUrgency(1, karn, brass.distTo(karn), true, false), 800);
  tide.curTarget = null;
  assert.ok(brass.botSkillUrgency(1, karn, brass.distTo(karn), true, false) < 800, 'nobody on an ally: the ordinary dash rule');
  // the ult: one hero inside 260 is not a crowd, even with the taunt...
  T.place(zephyr, open.x - 700, open.y);
  T.place(tide, open.x - 600, open.y);
  assert.equal(brass.botSkillUrgency(2, karn, brass.distTo(karn), true, false), 0, 'one healthy hero inside, on nobody');
  // ...unless it is on an ally who is close enough to protect
  karn.curTarget = zephyr;
  assert.equal(brass.botSkillUrgency(2, karn, brass.distTo(karn), true, false), 0, 'the ally is 700 away');
  T.place(zephyr, open.x - 350, open.y);
  assert.equal(brass.botSkillUrgency(2, karn, brass.distTo(karn), true, false), 820, 'on an ally within 400');
  karn.curTarget = null;
  // two heroes inside 260 is the crowd it is for
  T.place(tide, open.x - 200, open.y);
  T.place(karn, open.x + 230, open.y);
  assert.equal(brass.botSkillUrgency(2, karn, brass.distTo(karn), true, false), 880, 'two inside 260');
});

/* ---------------- Omen ---------------- */

T.test('Omen: base stats and skill numbers match the spec; Cadence stacks +5% AS per basic (8 max), a Crosscut on a hero is worth 2', () => {
  reset();
  const d = omen.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [640, 88, 200, 22, 66, 7.6, 16, 2.6, 13, 2.0, 108, 1.06, 266]);
  const [s1, s2, s3] = omen.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAd, s1.canCrit],
    ['nova', 6, -0.3, 40, 3, 190, 120, 14, 0.68, true]);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.dist, s2.speed, s2.dmg, s2.dmgLv, s2.scaleAd, s2.resetOnKill, s2.resetOnAssist, s2.stun],
    ['dash', 10, -0.4, 45, 300, 1050, 90, 11, 0.6, 1, 0.5, undefined]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.dist, s3.speed, s3.stopOnHero, s3.dmg, s3.scaleAd, s3.stun, s3.resetOnKill],
    ['dash', [38, 34, 30], 120, 420, 1200, true, [220, 275, 330], 1.1, 0.8, 0.5]);
  assert.ok(Math.abs(omen.cooldownFor(s1, 6) - 4.5) < 1e-9); assert.ok(Math.abs(omen.cooldownFor(s2, 6) - 8) < 1e-9);
  // Cadence
  T.place(omen, open.x, open.y); T.place(tide, open.x + 120, open.y);
  const as0 = omen.curAtkSpd();
  omen.onBasicLanded(tide, 10);
  omen.recalcStats(false);
  assert.ok(Math.abs(omen.curAtkSpd() - as0 * 1.05) < 1e-9, `one stack: ${omen.curAtkSpd() / as0}`);
  assert.ok(omen.castSkill(0, tide));
  omen.recalcStats(false);
  assert.equal(omen.pv.n, 3, 'a Crosscut on a hero adds 2');
  assert.ok(Math.abs(omen.curAtkSpd() - as0 * 1.15) < 1e-9);
  for (let i = 0; i < 9; i++) omen.onBasicLanded(tide, 10);
  assert.equal(omen.pv.n, 8, 'capped at 8');
  T.seconds(G, 3.1);
  assert.equal(omen.pv.n, 0, 'gone after 3 s');
  // a Crosscut on creeps only grants nothing
  omen.skillCd[0] = 0; T.place(tide, open.x + 900, open.y);
  omen.castSkill(0, null);
  assert.equal(omen.pv.n, 0);
});

T.test('Omen: Crosscut crits with his crit chance, one roll for every victim of the cast', () => {
  reset();
  T.place(omen, open.x, open.y); T.place(tide, open.x + 150, open.y); T.place(karn, open.x - 150, open.y);
  omen.castSkill(0, tide);
  const plainT = tide.maxHp - tide.hp, plainK = karn.maxHp - karn.hp;
  assert.ok(plainT > 0 && plainK > 0);
  reset();
  T.place(omen, open.x, open.y); T.place(tide, open.x + 150, open.y); T.place(karn, open.x - 150, open.y);
  omen.attrs.bonus.critChance = 1;
  omen.castSkill(0, tide);
  omen.attrs.bonus.critChance = 0;
  const critT = tide.maxHp - tide.hp, critK = karn.maxHp - karn.hp;
  assert.ok(Math.abs(critT / plainT - 2) < 0.03, `a 200% crit on Tide: ${critT / plainT}`);
  assert.ok(Math.abs(critK / plainK - 2) < 0.03, `and the same roll on Karn: ${critK / plainK}`);
});

T.test('Omen: a hero kill resets Pass fully and refunds half of Duelist\'s End; an assist refunds half of Pass', () => {
  reset();
  const [, s2, s3] = omen.skills;
  omen.skillCd = [3, 8, 30];
  omen.fire('onAssist', tide);
  assert.ok(Math.abs(omen.skillCd[1] - 4) < 1e-9, `assist: 8 - 0.5 x 8 = 4: ${omen.skillCd[1]}`);
  assert.equal(omen.skillCd[2], 30, 'the ult has no assist refund');
  assert.equal(omen.skillCd[0], 3, 'Crosscut carries no reset');
  omen.skillCd = [3, 8, 30];
  omen.fire('onKill', tide);
  assert.equal(omen.skillCd[1], 0, 'a kill resets Pass');
  assert.ok(Math.abs(omen.skillCd[2] - 15) < 1e-9, `and refunds half of the ult (30 - 0.5 x 30): ${omen.skillCd[2]}`);
  assert.equal(omen.lastTakedownT, G.time, 'the takedown clock is set for the bot');
  // a real kill through the dash itself
  reset();
  T.place(omen, open.x, open.y); T.place(tide, open.x + 160, open.y);
  tide.hp = 1;
  assert.ok(omen.castSkill(1, tide));
  assert.ok(Math.abs(omen.skillCd[1] - 8) < 1e-9);
  T.seconds(G, 0.3);
  assert.ok(!tide.alive, 'Pass killed Tide');
  assert.equal(omen.skillCd[1], 0, 'and came straight back');
  tide.alive = true; tide.hp = tide.maxHp; tide.respawnT = 0;
});

T.test("Omen: Duelist's End stops on the first hero, 330 (+110% ATK) physical at rank 3, stun 0.8 s", () => {
  reset();
  T.place(omen, open.x, open.y); T.place(karn, open.x + 250, open.y); T.place(tide, open.x + 400, open.y);
  assert.ok(omen.castSkill(2, tide));
  assert.equal(omen.skillCd[2], 30); assert.equal(omen.mana, omen.maxMana - 120);
  assert.ok(Math.abs(omen.dashS.dmg - (330 + omen.curAtk() * 1.1)) < 1e-6, 'rank-3 damage');
  T.seconds(G, 0.2);
  assert.ok(karn.hp < karn.maxHp && karn.cc.t.stun > 0.6 && karn.cc.t.stun <= 0.8, `first hero struck and stunned 0.8: ${karn.cc.t.stun}`);
  assert.equal(tide.hp, tide.maxHp, 'stopped on Karn');
});

T.test("Omen bot: Duelist's End on a hero under 60% or when an ally has engaged; after a takedown Pass onto the lowest hero within 300; retreat under 40% with Pass down", () => {
  reset();
  T.place(omen, open.x, open.y); T.place(tide, open.x + 300, open.y); T.place(zephyr, open.x - 1200, open.y);
  tide.hp = tide.maxHp * 0.65;
  assert.equal(omen.botSkillUrgency(2, tide, omen.distTo(tide), true, false), 0, '65%, alone: hold');
  tide.hp = tide.maxHp * 0.55;
  assert.equal(omen.botSkillUrgency(2, tide, omen.distTo(tide), true, false), 780, 'under 60%: go');
  tide.hp = tide.maxHp * 0.9;
  T.place(zephyr, open.x + 500, open.y); zephyr.lastDmgT = G.time;
  assert.equal(omen.botSkillUrgency(2, tide, omen.distTo(tide), true, false), 780, 'an ally fighting next to the target: go');
  zephyr.lastDmgT = -99;
  assert.equal(omen.botSkillUrgency(2, tide, omen.distTo(tide), true, false), 0);
  // the chain: within 3 s of a takedown Pass goes through the lowest hero in 300
  T.place(karn, open.x, open.y + 250); karn.hp = karn.maxHp * 0.3;
  assert.equal(omen.dashPick(omen.skills[1], tide), tide, 'no takedown yet: the ordinary target');
  omen.lastTakedownT = G.time;
  assert.equal(omen.dashPick(omen.skills[1], tide), karn, 'fresh from a takedown: the lowest hero in reach');
  assert.equal(omen.botSkillUrgency(1, tide, omen.distTo(tide), true, false), 800);
  omen.lastTakedownT = -99;
  // the retreat threshold rises to 40% while Pass is on cooldown
  reset();
  T.place(omen, open.x, open.y);
  omen.hp = omen.maxHp * 0.35; omen.aiState = 'push';
  omen.heuristicStateStep();
  assert.equal(omen.aiState, 'push', 'Pass ready: 35% is still a fight');
  omen.skillCd[1] = 5;
  omen.heuristicStateStep();
  assert.equal(omen.aiState, 'retreat', 'Pass down and under 40%: fall back');
  omen.aiState = 'push'; omen.recallT = 0; omen.hp = omen.maxHp;
});

/* ---------------- Karn ---------------- */

T.test('Karn: base stats and skill numbers match the spec; Ironclad grants 4 armor per hero hit taken (5 plates) and basics cut 0.5 s off cooldowns', () => {
  reset();
  const d = karn.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [700, 96, 240, 26, 58, 6.4, 21, 3.0, 16, 2.5, 100, 0.90, 255]);
  const [s1, s2, s3] = karn.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAd, s1.range, s1.speed, s1.radius, s1.pierce, s1.hook, s1.suppress, s1.markOnHit],
    ['skillshot', 13, -0.5, 80, 5, 110, 14, 0.5, 640, 850, 26, false, true, 0.6, 'hooked']);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.radius, s2.dmg, s2.dmgLv, s2.scaleAd, s2.slowPct, s2.slowDur, s2.bonusVsMark],
    ['nova', 8, -0.4, 50, 240, 140, 17, 0.7, 0.4, 1.2, { tag: 'hooked', within: 2, mult: 1.5 }]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.tether.multi.radius, s3.tether.dur, s3.tether.breakRange, s3.tether.anchored, s3.tether.breakPayload],
    ['tether', [44, 40, 36], 120, 320, 2.5, 450, true, { dmg: [260, 340, 420], scaleAd: 1.0, stun: 1.0 }]);
  assert.ok(Math.abs(karn.cooldownFor(s1, 6) - 10.5) < 1e-9); assert.equal(rankVal(s1, 'mana', 6), 105);
  T.place(karn, open.x, open.y); T.place(torren, open.x + 150, open.y);
  const armor0 = karn.armorValue();
  karn.onIncomingDamage(torren, 10, {}); karn.recalcStats(false);
  assert.equal(karn.armorValue(), armor0 + 4, '+4 armor per plate');
  for (let i = 0; i < 6; i++) karn.onIncomingDamage(torren, 10, {});
  karn.recalcStats(false);
  assert.equal(karn.armorValue(), armor0 + 20, 'five plates at most');
  karn.skillCd = [5, 5, 5];
  karn.onBasicLanded(torren, 10);
  assert.deepEqual(karn.skillCd, [4.5, 4.5, 4.5]);
});

T.test('Karn: Chain Hook stops on the first body, reels a hero in under a 0.6 s suppression and marks it; Iron Slam within 2 s does +50%', () => {
  reset();
  T.place(karn, open.x, open.y); T.place(zephyr, open.x + 500, open.y);
  assert.ok(karn.castSkill(0, zephyr));
  assert.equal(karn.mana, karn.maxMana - 105, 'rank-6 cost');
  let n = 0;
  while (!(zephyr.forced && zephyr.forced.mode === 'hook') && n++ < 60) G.update(1 / 60); T.reveal(G);
  assert.ok(zephyr.forced && zephyr.forced.mode === 'hook', 'hooked');
  assert.ok(zephyr.cc.has('suppress') && zephyr.cc.t.suppress <= 0.6, `suppressed 0.6: ${zephyr.cc.t.suppress}`);
  assert.equal(zephyr.marks.hookedAt, G.time, 'the hook mark');
  const before = zephyr.hp;
  T.seconds(G, 0.5);
  assert.ok(zephyr.distTo(karn) < 120, `reeled in: ${zephyr.distTo(karn)}`);
  // Iron Slam: 1.5x while the mark is fresh
  const s2 = karn.skills[1];
  const plain = karn.skillDmg(s2, 6);
  assert.ok(Math.abs(karn.skillDmg(s2, 6, zephyr) - plain * 1.5) < 1e-6, 'hooked within 2 s: +50%');
  assert.ok(Math.abs(karn.skillDmg(s2, 6, torren) - plain) < 1e-9, 'an unhooked target: normal');
  zephyr.marks.hookedAt = G.time - 2.5;
  assert.ok(Math.abs(karn.skillDmg(s2, 6, zephyr) - plain) < 1e-9, 'past 2 s: normal');
  assert.ok(zephyr.hp < before || zephyr.hp < zephyr.maxHp, 'the hook itself hurt');
  // a creep on the line takes the hook instead
  reset();
  T.place(karn, open.x, open.y); T.place(zephyr, open.x + 500, open.y);
  const m = new sim.context.Minion(0, 'mid', 'melee');
  T.place(m, open.x + 250, open.y); G.minions.push(m);
  m.update = () => {};   // a creep standing still on the line
  assert.ok(karn.castSkill(0, zephyr));
  T.seconds(G, 0.8);
  assert.ok(m.hp < m.maxHp, 'the creep took the hook');
  assert.equal(zephyr.hp, zephyr.maxHp, 'the hero behind it was not touched');
  assert.ok(!zephyr.forced, 'and not dragged');
  m.alive = false; G.minions.splice(G.minions.indexOf(m), 1);
});

T.test('Karn: Gaol chains every hero within 320 for 2.5 s; crossing 450 snaps the chain for 420 (+100% ATK) and a 1 s stun; staying costs nothing; a stun on Karn does not cut it; Purify releases it', () => {
  reset();
  T.place(karn, open.x, open.y); T.place(zephyr, open.x + 300, open.y); T.place(torren, open.x - 250, open.y); T.place(brass, open.x, open.y + 600);
  assert.ok(karn.castSkill(2, zephyr));
  assert.equal(karn.skillCd[2], 36); assert.equal(karn.mana, karn.maxMana - 120);
  const chains = G.tethers.filter(t => !t.dead && t.src === karn);
  assert.equal(chains.length, 2, 'two heroes inside 320 chained');
  assert.ok(chains.every(t => t.anchored && t.multi && Math.abs(t.t - 2.5) < 1e-9 && t.breakRange === 450));
  assert.ok(!chains.some(t => t.target === brass), 'outside 320: free');
  assert.equal(zephyr.hp, zephyr.maxHp, 'the chain itself does no damage');
  // a stun on Karn does not cut the chains (anchored)
  karn.cc.apply('stun', 0.3, 0);
  G.update(1 / 60); T.reveal(G);
  assert.equal(G.tethers.filter(t => !t.dead && t.src === karn).length, 2);
  // Zephyr walks out past 450: struck and stunned
  const expect = Math.round((420 + karn.curAtk() * 1.0) * G.rules.COMBAT.SKILL_DMG);
  T.place(zephyr, open.x + 470, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.ok(zephyr.hp < zephyr.maxHp, 'snapped');
  assert.ok(Math.abs((zephyr.maxHp - zephyr.hp) - expect * G.rules.COMBAT.DEF_K / (G.rules.COMBAT.DEF_K + zephyr.armorValue())) < 2, `420 (+100% ATK) physical: ${zephyr.maxHp - zephyr.hp}`);
  assert.ok(Math.abs(zephyr.cc.t.stun - 1.0) < 1e-9, `stun 1.0: ${zephyr.cc.t.stun}`);
  // Torren stays: the chain ends quietly at 2.5 s
  T.seconds(G, 2.6);
  assert.equal(G.tethers.filter(t => !t.dead && t.src === karn).length, 0, 'over');
  assert.equal(torren.hp, torren.maxHp, 'staying costs nothing');
  assert.ok(!torren.cc.has('stun'));
  // Purify releases the chain without the payload
  reset();
  T.place(karn, open.x, open.y); T.place(zephyr, open.x + 300, open.y);
  karn.castSkill(2, zephyr);
  zephyr.cc.purify(1);
  assert.equal(G.tethers.filter(t => !t.dead && t.src === karn).length, 0, 'released');
  T.place(zephyr, open.x + 600, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(zephyr.hp, zephyr.maxHp, 'no break payload after a Purify');
  zephyr.cc.immuneT = 0;
  // Karn dying ends the chains quietly
  reset();
  T.place(karn, open.x, open.y); T.place(zephyr, open.x + 300, open.y);
  karn.castSkill(2, zephyr);
  karn.hp = 0; karn.die(null);
  T.place(zephyr, open.x + 600, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(zephyr.hp, zephyr.maxHp, 'chains die with Karn');
  karn.alive = true; karn.hp = karn.maxHp; karn.respawnT = 0;
});

T.test('Karn bot: the hook waits for an unblocked, isolated hero (carries first); Iron Slam right after a hook; Gaol on 2+ heroes inside 300 with one leaving', () => {
  reset();
  T.place(karn, open.x, open.y); T.place(zephyr, open.x + 450, open.y); T.place(torren, open.x + 300, open.y + 250);
  torren.hp = torren.maxHp * 0.3;
  G.update(1 / 60); T.reveal(G);   // vision follows the placements
  const s1 = karn.skills[0];
  assert.equal(karn.hookPick(s1), null, 'Zephyr has Torren within 400: nobody is isolated');
  assert.equal(karn.botSkillUrgency(0, zephyr, karn.distTo(zephyr), true, false), 0, 'the hook is held');
  T.place(torren, open.x - 300, open.y + 250);
  G.update(1 / 60); T.reveal(G);
  assert.equal(karn.hookPick(s1), zephyr, 'both isolated: the marksman before the lower-HP fighter');
  assert.equal(karn.botSkillUrgency(0, torren, karn.distTo(torren), true, false), 840, 'and the urgency follows the pick, not the target');
  const m = new sim.context.Minion(0, 'mid', 'melee');
  T.place(m, open.x + 220, open.y); G.minions.push(m);
  m.update = () => {};
  assert.equal(karn.hookPick(s1), torren, 'a creep on the line to Zephyr: Torren instead');
  m.alive = false; G.minions.splice(G.minions.indexOf(m), 1);
  // Iron Slam: 900 while a hooked hero is inside the ring
  T.place(zephyr, open.x + 150, open.y);
  G.update(1 / 60); T.reveal(G);
  zephyr.marks.hookedAt = G.time;
  assert.equal(karn.botSkillUrgency(1, zephyr, karn.distTo(zephyr), true, false), 900);
  zephyr.marks.hookedAt = G.time - 3;
  assert.ok(karn.botSkillUrgency(1, zephyr, karn.distTo(zephyr), true, false) < 900);
  // Gaol: two inside 300, one of them moving away
  T.place(torren, open.x - 200, open.y); torren.hp = torren.maxHp;
  assert.equal(karn.botSkillUrgency(2, zephyr, karn.distTo(zephyr), true, false), 720, 'two inside, nobody leaving yet: worth chaining');
  torren.vx = -200; torren.vy = 0;
  assert.equal(karn.botSkillUrgency(2, zephyr, karn.distTo(zephyr), true, false), 880, 'Torren backing off: chain them');
  T.place(torren, open.x - 310, open.y);
  assert.equal(karn.botSkillUrgency(2, zephyr, karn.distTo(zephyr), true, false), 0, 'outside 300 does not count');
  torren.vx = 0;
  // a lone hero inside 300 who is running is chained too: nobody leaves
  T.place(torren, open.x - 900, open.y);
  zephyr.hp = zephyr.maxHp;
  assert.equal(karn.botSkillUrgency(2, zephyr, karn.distTo(zephyr), true, false), 0, 'one hero standing his ground: hold');
  zephyr.vx = 300;
  assert.equal(karn.botSkillUrgency(2, zephyr, karn.distTo(zephyr), true, false), 840, 'one hero leaving: chain him');
  zephyr.vx = 0;
});

/* ---------------- Tide ---------------- */

T.test('Tide: base stats and skill numbers match the spec; Undertow slows 12% on basics and adds 8% to slowed heroes', () => {
  reset();
  const d = tide.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [670, 92, 240, 26, 56, 6.0, 17, 2.8, 17, 2.6, 112, 0.98, 256]);
  const [s1, s2, s3] = tide.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAp, s1.range, s1.speed, s1.radius, s1.pierce, s1.knockback, s1.wallDmg, s1.wallScaleAp, s1.wallStun],
    ['skillshot', 7.5, -0.4, 55, 4, 145, 18, 0.7, 560, 850, 32, true, 120, 80, 0.3, 0.6]);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.dist, s2.speed, s2.dmg, s2.dmgLv, s2.scaleAp, s2.slowPct, s2.slowDur],
    ['dash', 10, -0.4, 55, 320, 950, 105, 13, 0.45, 0.3, 1.2]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.range, s3.radius, s3.delay, s3.ticks, s3.dmg, s3.scaleAp, s3.knockback, s3.wallDmg, s3.wallScaleAp, s3.wallStun, s3.noWallCC],
    ['zone', [40, 36, 32], 120, 480, 250, 0.5, 1, [270, 350, 430], 0.8, 130, 120, 0.4, 0.7, { airborne: 0.5 }]);
  assert.ok(Math.abs(tide.cooldownFor(s1, 6) - 5.5) < 1e-9); assert.equal(rankVal(s1, 'mana', 6), 75);
  T.place(tide, open.x, open.y); T.place(torren, open.x + 120, open.y);
  tide.onBasicLanded(torren, 10);
  assert.ok(Math.abs(torren.cc.slowPct - 0.12) < 1e-9 && torren.cc.t.slow <= 1, 'basics slow 12% for 1 s');
  assert.ok(Math.abs(tide.onDealDamage(torren, 100, { type: 'magic' }) - 108) < 1e-9, '+8% on a slowed hero');
  torren.cc.clear();
  assert.ok(Math.abs(tide.onDealDamage(torren, 100, { type: 'magic' }) - 100) < 1e-9);
});

T.test('Tide: Breaker carries everyone on its line 120 along the wave; a victim that meets rock stops, takes +80 (+30% MAGIC) and is stunned 0.6 s', () => {
  reset();
  // in the open: two heroes on the line both slide 120 along the wave direction, not away from Tide
  T.place(tide, open.x, open.y); T.place(torren, open.x + 150, open.y + 20); T.place(brass, open.x + 260, open.y - 20);
  assert.ok(tide.castSkill(0, { x: open.x + 500, y: open.y }));
  assert.equal(tide.mana, tide.maxMana - 75);
  T.seconds(G, 0.9);
  assert.ok(torren.hp < torren.maxHp && brass.hp < brass.maxHp, 'the wave pierces both');
  assert.ok(Math.abs(torren.x - (open.x + 270)) < 3 && Math.abs(torren.y - (open.y + 20)) < 3, `Torren slid 120 along the wave: ${torren.x - open.x}, ${torren.y - open.y}`);
  assert.ok(Math.abs(brass.x - (open.x + 380)) < 3 && Math.abs(brass.y - (open.y - 20)) < 3, `Brass too: ${brass.x - open.x}, ${brass.y - open.y}`);
  assert.ok(!torren.cc.has('stun') && !brass.cc.has('stun'), 'no wall, no stun');
  // against a wall: the slide stops at the rock, the bonus lands and the victim is stunned
  reset();
  const near = T.openSpot(G, 60, { nearWallDx: 140 });
  T.place(torren, near.x, near.y); T.place(tide, near.x - 300, near.y);
  torren.stats.dmgTaken = 0;
  assert.ok(tide.castSkill(0, { x: near.x + 200, y: near.y }));
  T.seconds(G, 1.0);
  assert.ok(torren.x - near.x < 120 && torren.x > near.x, `stopped short of the rock: ${torren.x - near.x}`);
  assert.ok(!G.wallAt(torren.x, torren.y, torren.radius), 'never inside the wall');
  assert.ok(torren.cc.t.stun > 0 && torren.cc.t.stun <= 0.6, `wall stun 0.6: ${torren.cc.t.stun}`);
  const wave = Math.round(tide.skillDmg(tide.skills[0], 6) * G.rules.COMBAT.SKILL_DMG * G.rules.COMBAT.DEF_K / (G.rules.COMBAT.DEF_K + torren.mrValue()));
  const wall = Math.round((80 + tide.magicPower() * 0.3) * G.rules.COMBAT.SKILL_DMG * G.rules.COMBAT.DEF_K / (G.rules.COMBAT.DEF_K + torren.mrValue()));
  assert.ok(Math.abs(torren.stats.dmgTaken - (wave + wall)) <= 2, `wave ${wave} + wall ${wall} = ${torren.stats.dmgTaken}`);
});

T.test('Tide: Surge slows 30% for 1.2 s along its path; High Water throws everyone 130 outward after 0.5 s, wall hits are stunned 0.7 s, the rest are airborne 0.5 s', () => {
  reset();
  T.place(tide, open.x, open.y); T.place(torren, open.x + 200, open.y);
  assert.ok(tide.castSkill(1, torren));
  T.seconds(G, 0.4);
  assert.ok(torren.hp < torren.maxHp && Math.abs(torren.cc.slowPct - 0.3) < 1e-9, 'slowed 30%');
  // High Water in the open: launched, not stunned
  reset();
  T.place(tide, open.x, open.y); T.place(torren, open.x + 300, open.y + 60); T.place(brass, open.x + 300, open.y - 60);
  assert.ok(tide.castSkill(2, { x: open.x + 300, y: open.y }));
  assert.equal(tide.skillCd[2], 32); assert.equal(tide.mana, tide.maxMana - 120);
  assert.equal(G.zones.length, 1);
  T.seconds(G, 0.45);
  assert.equal(torren.hp, torren.maxHp, 'nothing before the 0.5 s telegraph');
  T.seconds(G, 0.5);
  assert.ok(torren.hp < torren.maxHp && brass.hp < brass.maxHp, 'both inside 250 struck');
  assert.ok(torren.y - (open.y + 60) > 100, `Torren thrown outward from the centre: ${torren.y - (open.y + 60)}`);
  assert.ok(brass.y - (open.y - 60) < -100, `Brass the other way: ${brass.y - (open.y - 60)}`);
  assert.ok(torren.cc.has('airborne') && torren.cc.t.airborne <= 0.5 && !torren.cc.has('stun'), 'airborne 0.5 in the open');
  // against a wall: the throw stops at the rock, +120 (+40% MAGIC) and a 0.7 s stun, no launch
  reset();
  const near = T.openSpot(G, 60, { nearWallDx: 140 });
  T.place(torren, near.x, near.y); T.place(tide, near.x - 400, near.y);
  torren.stats.dmgTaken = 0;
  assert.ok(tide.castSkill(2, { x: near.x - 100, y: near.y }));
  T.seconds(G, 1.0);
  assert.ok(torren.x - near.x < 130 && !G.wallAt(torren.x, torren.y, torren.radius), `stopped at the rock: ${torren.x - near.x}`);
  assert.ok(torren.cc.t.stun > 0 && torren.cc.t.stun <= 0.7, `wall stun 0.7: ${torren.cc.t.stun}`);
  assert.ok(!torren.cc.has('airborne'), 'a wall hit is not launched');
  const zone = Math.round(tide.skillDmg(tide.skills[2], 3) * G.rules.COMBAT.SKILL_DMG * G.rules.COMBAT.DEF_K / (G.rules.COMBAT.DEF_K + torren.mrValue()));
  const wall = Math.round((120 + tide.magicPower() * 0.4) * G.rules.COMBAT.SKILL_DMG * G.rules.COMBAT.DEF_K / (G.rules.COMBAT.DEF_K + torren.mrValue()));
  assert.ok(Math.abs(torren.stats.dmgTaken - (zone + wall)) <= 2, `zone ${zone} + wall ${wall} = ${torren.stats.dmgTaken}`);
});

T.test('Tide bot: Breaker and High Water prefer a target with a wall behind the push; High Water is centred to throw at the rock; Surge lands on the open side', () => {
  reset();
  const near = T.openSpot(G, 60, { nearWallDx: 140 });
  T.place(torren, near.x, near.y); T.place(tide, near.x - 300, near.y);
  G.update(1 / 60); T.reveal(G);
  const [s1, s2, s3] = tide.skills;
  assert.ok(tide.wallBehind(torren, 1, 0, 130), 'rock within 130 to the right of Torren');
  assert.ok(!tide.wallBehind(torren, -1, 0, 130), 'open to the left');
  assert.equal(tide.botSkillUrgency(0, torren, tide.distTo(torren), true, false), 850, 'the wave pushes him into it');
  assert.equal(tide.botSkillUrgency(2, torren, tide.distTo(torren), true, false), 850, 'so does High Water');
  const w = tide.wallShoveDir(torren, 140);
  assert.ok(w && w.x > 0.9, `the shove direction points at the rock: ${w && w.x}, ${w && w.y}`);
  // the zone is centred 100 on the far side of the target so the outward throw goes at the wall
  let aimed = null;
  const orig = tide.castSkill.bind(tide);
  tide.castSkill = (i, p) => { aimed = p; return orig(i, p); };
  tide.botFireSkill(2, torren, tide.distTo(torren), true, false);
  tide.castSkill = orig;
  assert.ok(aimed && Math.abs(aimed.x - (near.x - 100)) < 1 && Math.abs(aimed.y - near.y) < 1, `centred behind the target: ${aimed && (aimed.x - near.x)}`);
  // Surge lands on the open side: the target ends up between Tide and the rock
  const pt = tide.dashPick(s2, torren);
  assert.ok(pt !== torren && Math.abs(pt.x - (near.x - 140)) < 1, `open-side landing 140 short of the wall side: ${pt.x - near.x}`);
  // in the open (no rock within 170 + a body of the target) the wave is an ordinary skillshot and Surge goes straight at him
  reset();
  T.place(tide, open.x, open.y); T.place(torren, open.x + 200, open.y);
  G.update(1 / 60); T.reveal(G);
  assert.equal(tide.botSkillUrgency(0, torren, tide.distTo(torren), true, false), 500);
  assert.equal(tide.wallShoveDir(torren, 140), null);
  assert.equal(tide.dashPick(s2, torren), torren);
  void s1; void s3;
});

/* ---------------- Cinder ---------------- */

T.test('Cinder: a Heat hero (0-100, free skills) whose gauge gains per hit, burns up on a burning enemy and decays out of combat; base stats match the spec', () => {
  reset();
  const d = cinder.def0;
  assert.equal(d.resource, 'heat');
  assert.deepEqual(d.heat, { gainBasicHero: 8, gainBasic: 4, gainSkillHero: 8, gainSkill: 4, burnPerSec: 2, decay: 5, decayDelay: 4, burnTag: 'coal' });
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [660, 88, 0, 0, 58, 6.4, 16, 2.6, 15, 2.3, 118, 1.06, 250]);
  assert.equal(cinder.maxMana, 100); assert.equal(cinder.mana, 0, 'starts cold');
  for (const s of cinder.skills) { assert.equal(s.mana, 0); assert.equal(cinder.costOf(s, 1), 0); assert.ok(cinder.canAfford(s, 1)); }
  cinder.gainMana(50);
  assert.equal(cinder.mana, 0, 'mana refunds never touch Heat');
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 120, open.y);
  cinder.onBasicLanded(torren, 10);
  assert.equal(cinder.mana, 8, '+8 per basic on a hero');
  const m = new sim.context.Minion(0, 'mid', 'melee');
  T.place(m, open.x - 120, open.y); G.minions.push(m); m.update = () => {};
  cinder.onBasicLanded(m, 10);
  assert.equal(cinder.mana, 12, '+4 on a creep');
  cinder.dots = []; torren.dots = [];
  assert.ok(cinder.castSkill(0, torren));
  assert.equal(cinder.mana, 12 + 8 + 4, '+8 for the skill hit on the hero, +4 on the creep');
  assert.ok(torren.dots.some(x => x.tag === 'coal' && x.src === cinder), 'Live Coal burn on the hero');
  // burn-up: +2/s while an enemy hero carries her burn, no decay meanwhile
  const h0 = cinder.mana;
  T.seconds(G, 1);
  assert.ok(Math.abs(cinder.mana - (h0 + 2)) < 0.3, `+2/s while Torren burns: ${cinder.mana - h0}`);
  // decay: 5/s once 4 s have passed with no damage dealt or taken and nothing burning
  torren.dots = []; cinder.lastDmgT = G.time - 4.5;
  const h1 = cinder.mana;
  T.seconds(G, 1);
  assert.ok(Math.abs(cinder.mana - (h1 - 5)) < 0.3, `-5/s out of combat: ${cinder.mana - h1}`);
  m.alive = false; G.minions.splice(G.minions.indexOf(m), 1);
});

T.test('Cinder: skill numbers match the spec; at 100 Heat Haymaker overheats (260, x1.4, slow 40% 1.5 s) and the gauge empties', () => {
  reset();
  const [s1, s2, s3] = cinder.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAp, s1.overheat], ['nova', 7, -0.4, 200, 152, 18, 0.55, { radius: 260, dmgMult: 1.4, slowPct: 0.4, slowDur: 1.5 }]);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.dist, s2.speed, s2.dmg, s2.endNova, s2.overheat.endNova],
    ['dash', 10, -0.4, 320, 980, undefined, { radius: 170, dmgType: 'magic', dmg: 115, dmgLv: 14, scaleAp: 0.4 }, { radius: 220, dmgType: 'magic', dmg: 115, dmgLv: 14, scaleAp: 0.4, stun: 0.5 }]);
  assert.deepEqual([s3.type, s3.cd, s3.atkMult, s3.spdAdd, s3.hotPct, s3.dur, s3.burnUpgrade, s3.overheat], ['buff', [42, 38, 34], 1.25, 50, 0.18, 6, true, { dur: 9, tenacityAdd: 0.35 }]);
  assert.ok(Math.abs(cinder.cooldownFor(s1, 6) - 5) < 1e-9); assert.ok(Math.abs(cinder.cooldownFor(s2, 6) - 8) < 1e-9);
  // a cold Haymaker: 200 radius, no slow
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 150, open.y); T.place(brass, open.x - 250, open.y);
  assert.ok(cinder.castSkill(0, torren));
  const plain = torren.maxHp - torren.hp;
  assert.ok(plain > 0 && brass.hp === brass.maxHp && !torren.cc.has('slow'), 'cold: 200 radius, no slow');
  assert.equal(cinder.mana, 8 + 0, 'a normal cast just adds its hit');
  // hot: wider, harder, slowing, and the gauge resets
  reset();
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 150, open.y); T.place(brass, open.x - 250, open.y);
  cinder.mana = 100;
  assert.ok(cinder.castSkill(0, torren));
  const hot = torren.maxHp - torren.hp;
  assert.ok(Math.abs(hot / plain - 1.4) < 0.03, `x1.4: ${hot / plain}`);
  assert.ok(brass.hp < brass.maxHp, 'Brass at 250 is inside the 260 ring');
  assert.ok(Math.abs(torren.cc.slowPct - 0.4) < 1e-9 && torren.cc.t.slow > 1.4 && torren.cc.t.slow <= 1.5, 'slow 40% 1.5 s');
  assert.equal(cinder.mana, 0, 'the gauge empties on an overheat');
  assert.ok(cinder.skillCd[0] > 4.9 && cinder.skillCd[0] <= 5, 'cooldown from the base skill');
});

T.test('Cinder: Coal Dash slams 170 on landing with no CC; overheated it is a 220 blast that stuns 0.5 s', () => {
  reset();
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 320, open.y + 240);   // 240 off the landing: only the hot 220 (+ body) blast reaches
  assert.ok(cinder.castSkill(1, { x: open.x + 320, y: open.y }));
  assert.equal(cinder.dashS.dmg, 0, 'no path damage');
  T.seconds(G, 0.5);
  assert.equal(torren.hp, torren.maxHp, 'cold: 170 does not reach 240 away');
  reset();
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 320, open.y + 240);
  cinder.mana = 100;
  assert.ok(cinder.castSkill(1, { x: open.x + 320, y: open.y }));
  assert.equal(cinder.mana, 0);
  T.seconds(G, 0.5);
  assert.ok(torren.hp < torren.maxHp, 'hot: the 220 blast reaches');
  assert.ok(torren.cc.t.stun > 0.3 && torren.cc.t.stun <= 0.5, `stun 0.5: ${torren.cc.t.stun}`);
  assert.ok(cinder.mana >= 8 && cinder.mana < 9, `the landing hit re-heats her (+8, then +2/s while he burns): ${cinder.mana}`);
});

T.test('Cinder: Furnace gives +25% basic damage, +50 speed, 18% max HP over 6 s and doubles the burn; overheated it runs 9 s with +35% tenacity', () => {
  reset();
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 150, open.y);
  const spd0 = cinder.curSpeed(), atk0 = cinder.curAtk();
  assert.ok(cinder.castSkill(2, null));
  assert.equal(cinder.skillCd[2], 34);
  assert.ok(Math.abs(cinder.curAtk() - atk0 * 1.25) < 1e-6, '+25% attack');
  assert.ok(Math.abs(cinder.curSpeed() - (spd0 + 50)) < 1e-6, '+50 speed');
  assert.ok(cinder.hot && Math.abs(cinder.hot.rate * 6 - cinder.maxHp * 0.18) < 1, '18% max HP over 6 s');
  assert.ok(cinder.buffState && Math.abs(cinder.buffState.t - 6) < 1e-9 && cinder.buffState.s.burnUpgrade, 'the furnace state runs 6 s');
  assert.equal(cinder.attrs.get('tenacity'), 0, 'no tenacity when cold');
  torren.dots = [];
  cinder.onBasicLanded(torren, 10);
  const burn = torren.dots.find(x => x.tag === 'coal');
  assert.ok(Math.abs(burn.perSec * 3 - (50 + cinder.magicPower() * 0.4)) < 1e-6, `burn 50 (+40% MAGIC) over 3 s during Furnace: ${burn.perSec * 3}`);
  T.seconds(G, 6.1);
  assert.equal(cinder.buffState, null, 'over after 6 s');
  torren.dots = [];
  cinder.onBasicLanded(torren, 10);
  assert.ok(Math.abs(torren.dots.find(x => x.tag === 'coal').perSec * 3 - (25 + cinder.magicPower() * 0.2)) < 1e-6, 'back to 25 (+20% MAGIC)');
  // overheated: 9 s and tenacity
  reset();
  T.place(cinder, open.x, open.y);
  cinder.mana = 100;
  assert.ok(cinder.castSkill(2, null));
  assert.ok(cinder.buffState && Math.abs(cinder.buffState.t - 9) < 1e-9, '9 s');
  assert.ok(Math.abs(cinder.attrs.get('tenacity') - 0.35) < 1e-9, '+35% tenacity');
  assert.ok(cinder.hot && Math.abs(cinder.hot.t - 9) < 1e-9);
  assert.equal(cinder.mana, 0);
});

T.test('Cinder bot: at 100 Heat, Haymaker on 2+ heroes inside 260, else Coal Dash onto the nearest marksman or mage within 320; Furnace once under 60% HP', () => {
  reset();
  T.place(cinder, open.x, open.y); T.place(torren, open.x + 150, open.y); T.place(zephyr, open.x, open.y + 310);   // outside the hot ring (260 + a body), inside the dash
  G.update(1 / 60); T.reveal(G);
  cinder.mana = 50;
  assert.ok(cinder.botSkillUrgency(0, torren, cinder.distTo(torren), true, false) > 0 && cinder.botSkillUrgency(0, torren, cinder.distTo(torren), true, false) < 900, 'cold: the ordinary nova rule');
  cinder.mana = 100;
  assert.equal(cinder.botSkillUrgency(0, torren, cinder.distTo(torren), true, false), 0, 'hot with one hero in the ring and a marksman in dash reach: hold the Haymaker');
  assert.equal(cinder.botSkillUrgency(1, torren, cinder.distTo(torren), true, false), 850, 'the Overheated dash goes for the marksman');
  assert.equal(cinder.dashPick(cinder.skills[1], torren), zephyr);
  T.place(zephyr, open.x, open.y + 240);
  assert.equal(cinder.botSkillUrgency(0, torren, cinder.distTo(torren), true, false), 900, 'two heroes inside the hot 260 ring: Haymaker');
  T.place(zephyr, open.x, open.y + 900);
  assert.ok(cinder.botSkillUrgency(0, torren, cinder.distTo(torren), true, false) > 0, 'nobody to dash onto: the Haymaker is not wasted forever');
  // Furnace waits for 60%
  assert.equal(cinder.botSkillUrgency(2, torren, cinder.distTo(torren), true, false), 0, 'healthy: hold');
  cinder.hp = cinder.maxHp * 0.55;
  assert.equal(cinder.botSkillUrgency(2, torren, cinder.distTo(torren), true, false), 720, 'under 60% in a fight: stoke it');
  cinder.hp = cinder.maxHp; cinder.mana = 0;
});

T.done();
