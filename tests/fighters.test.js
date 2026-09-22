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
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
}
reset();
G.update(1 / 60);

/* ---------------- Torren ---------------- */

T.test('Torren: a cooldown-only hero (resource none): no bar, free skills, mana refunds ignored; base stats match the spec', () => {
  reset();
  const d = torren.def0;
  assert.equal(d.resource, 'none');
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed],
    [690, 96, 0, 0, 63, 7.4, 19, 3.0, 14, 2.2, 95, 1.02, 262]);
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

T.test('Torren: Whirling Axe 130+16/rank (+80% ATK) grows +1% per 2% of his missing HP, max +40%; cd 7 -> 5.5', () => {
  reset();
  const s = torren.skills[0];
  assert.deepEqual([s.type, s.cd, s.cdLv, s.mana, s.radius, s.dmg, s.dmgLv, s.scaleAd], ['nova', 7, -0.3, 0, 220, 130, 16, 0.8]);
  assert.deepEqual(s.selfMissingBonus, { perPct: 0.01, per: 0.02, max: 0.4 });
  assert.equal(rankVal(s, 'dmg', 6), 210);
  assert.ok(Math.abs(torren.cooldownFor(s, 6) - 5.5) < 1e-9);
  const base = 130 + torren.curAtk() * 0.8;
  torren.hp = torren.maxHp;
  assert.ok(Math.abs(torren.skillDmg(s, 1) - base) < 1e-9, 'no bonus at full HP');
  torren.hp = torren.maxHp * 0.6;
  assert.ok(Math.abs(torren.skillDmg(s, 1) - base * 1.2) < 1e-6, `40% missing -> +20%: ${torren.skillDmg(s, 1) / base}`);
  torren.hp = torren.maxHp * 0.1;
  assert.ok(Math.abs(torren.skillDmg(s, 1) - base * 1.4) < 1e-6, `90% missing caps at +40%: ${torren.skillDmg(s, 1) / base}`);
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

T.test("Torren: Reaver's Toll is 160/220/280 (+70% ATK) true damage plus 20/25/30% of his missing HP (cap 50% max HP), computed once at cast", () => {
  reset();
  const s = torren.skills[2];
  assert.deepEqual([s.type, s.cd, s.mana, s.radius, s.dmgType, s.dmg, s.scaleAd, s.selfMissingPct, s.selfMissingCap],
    ['nova', [42, 38, 34], 0, 260, 'true', [160, 220, 280], 0.7, [0.2, 0.25, 0.3], 0.5]);
  T.place(torren, open.x, open.y);
  T.place(tide, open.x + 200, open.y);
  T.place(vesper, open.x - 200, open.y);
  torren.hp = torren.maxHp * 0.3;   // 70% missing: the cap (50%) applies
  const expect = Math.round((280 + torren.curAtk() * 0.7 + torren.maxHp * 0.5 * 0.3) * G.rules.COMBAT.SKILL_DMG);
  assert.ok(torren.castSkill(2, tide));
  assert.equal(torren.skillCd[2], 34, 'rank-3 cooldown');
  const dTide = tide.maxHp - tide.hp, dVesper = vesper.maxHp - vesper.hp;
  assert.equal(dTide, expect, `true damage ignores MR: ${dTide} vs ${expect}`);
  assert.equal(dVesper, expect, 'the same slice for every victim: computed once at cast');
  // at 40% missing the term is uncapped: 0.4 x maxHp x 0.3
  reset();
  T.place(torren, open.x, open.y); T.place(tide, open.x + 200, open.y);
  torren.hp = torren.maxHp * 0.6;
  const e2 = Math.round((280 + torren.curAtk() * 0.7 + torren.maxHp * 0.4 * 0.3) * G.rules.COMBAT.SKILL_DMG);
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

T.done();
