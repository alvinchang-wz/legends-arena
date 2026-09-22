'use strict';
/* F1 per-rank scaling, F2 target-aware skill damage, F28 airborne rework,
   CC locks, slowPctLv and canCrit (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const R = G.rules;
const { Zone } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const spot = T.openSpot(G);
T.place(grom, spot.x, spot.y);
T.place(tide, spot.x + 60, spot.y);
T.place(mira, spot.x - 60, spot.y);
G.update(1 / 60);   // one frame so vision / bush state exist

T.test('F1: rankVal reads an array by rank and a scalar with a cdLv delta', () => {
  assert.equal(R.rankVal({ cd: [46, 42, 38] }, 'cd', 1), 46);
  assert.equal(R.rankVal({ cd: [46, 42, 38] }, 'cd', 2), 42);
  assert.equal(R.rankVal({ cd: [46, 42, 38] }, 'cd', 3), 38);
  assert.equal(R.rankVal({ cd: [46, 42, 38] }, 'cd', 9), 38, 'rank past the array clamps to the last entry');
  assert.equal(R.rankVal({ cd: [46, 42, 38] }, 'cd', 0), 46, 'rank 0 reads as rank 1');
  assert.ok(Math.abs(R.rankVal({ cd: 8, cdLv: -0.4 }, 'cd', 6) - 6) < 1e-9);
  assert.equal(R.rankVal({ cd: 8, cdLv: -0.4 }, 'cd', 1), 8);
  assert.equal(R.rankVal({ mana: 45, manaLv: 4 }, 'mana', 3), 53);
  assert.equal(R.rankVal({ slowPct: 0.1, slowPctLv: 0.08 }, 'slowPct', 4), 0.1, 'slowPctLv is per tick, not per rank');
  assert.equal(R.rankVal({ stun: 1 }, 'stun', 3), 1);
  assert.equal(R.rankVal({}, 'cd', 3), undefined);
});

T.test('F1: Hero.cooldownFor resolves the rank, applies cdr and never drops under 1 s', () => {
  const s = { cd: [46, 42, 38] };
  assert.equal(grom.cooldownFor(s, 2), 42 * (1 - grom.cdr()));
  grom.attrs.bonus.cdr = 0.4;
  assert.ok(Math.abs(grom.cooldownFor({ cd: 8, cdLv: -0.4 }, 6) - 6 * 0.6) < 1e-9);
  assert.equal(grom.cooldownFor({ cd: 1.2 }, 1), 1, 'clamped to 1.0');
  grom.attrs.bonus.cdr = 0;
});

T.test('F1: castSkill sets the cooldown at the skill rank', () => {
  const s0 = grom.skills[0];
  const cdSave = s0.cd, lvSave = s0.cdLv;
  s0.cd = 10; s0.cdLv = -1;
  grom.skillRank[0] = 4;
  grom.skillCd[0] = 0; grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(0, { x: grom.x + 100, y: grom.y }));
  assert.ok(Math.abs(grom.skillCd[0] - 7 * (1 - grom.cdr())) < 1e-9, `cd was ${grom.skillCd[0]}`);
  s0.cd = cdSave; if (lvSave === undefined) delete s0.cdLv; else s0.cdLv = lvSave;
  grom.skillRank[0] = 6; grom.skillCd[0] = 0;
});

T.test('F1: applySkillCC resolves a per-rank CC array before applying', () => {
  tide.cc.clear();
  R.applySkillCC(grom, tide, { stun: [0.5, 1.0, 1.5] }, 3);
  assert.ok(Math.abs(tide.cc.t.stun - 1.5) < 1e-9, `stun ${tide.cc.t.stun}`);
  tide.cc.clear();
  R.applySkillCC(grom, tide, { stun: [0.5, 1.0, 1.5] }, 1);
  assert.ok(Math.abs(tide.cc.t.stun - 0.5) < 1e-9);
  tide.cc.clear();
});

T.test('F2: skillDmg adds the missing-HP term and caps it against non-heroes, never structures', () => {
  const s = { dmg: 100, missingPct: 0.2, missingCap: 50 };
  tide.hp = tide.maxHp - 1000;
  assert.equal(grom.skillDmg(s, 1, tide), 100 + 200);
  const minion = G.minions[0] || new sim.context.Minion(1, 'mid', 'melee');
  minion.hp = minion.maxHp - 400;
  assert.equal(grom.skillDmg(s, 1, minion), 100 + 50, 'capped vs a minion');
  const tower = G.towers.find(t => t.team === 1);
  tower.hp = tower.maxHp * 0.5;
  assert.equal(grom.skillDmg(s, 1, tower), 100, 'no missing-HP term against structures');
  tower.hp = tower.maxHp;
  tide.hp = tide.maxHp;
});

T.test('F2: missingPctLv scales per rank; pctMaxHp is capped vs non-heroes', () => {
  const s = { dmg: 0, missingPct: 0.2, missingPctLv: 0.05 };
  tide.hp = tide.maxHp - 1000;
  assert.ok(Math.abs(grom.skillDmg(s, 3, tide) - 300) < 1e-9);
  tide.hp = tide.maxHp;
  const p = { dmg: 0, pctMaxHp: 0.1, pctMaxHpCap: 30 };
  assert.ok(Math.abs(grom.skillDmg(p, 1, tide) - tide.maxHp * 0.1) < 1e-9);
  const minion = G.minions[0] || new sim.context.Minion(1, 'mid', 'melee');
  assert.equal(grom.skillDmg(p, 1, minion), 30);
});

T.test('F2: selfMissingBonus multiplies by the caster\'s own missing HP (capped)', () => {
  const s = { dmg: 100, selfMissingBonus: { perPct: 0.01, per: 0.02, max: 0.4 } };
  grom.hp = grom.maxHp;
  assert.equal(grom.skillDmg(s, 1, tide), 100);
  grom.hp = grom.maxHp * 0.5;
  assert.ok(Math.abs(grom.skillDmg(s, 1, tide) - 125) < 1e-6);
  grom.hp = grom.maxHp * 0.01;
  assert.ok(Math.abs(grom.skillDmg(s, 1, tide) - 140) < 1e-6, 'capped at +40%');
  grom.hp = grom.maxHp;
});

T.test('F2: selfMissingPct (array by rank) adds the caster\'s missing HP, capped by selfMissingCap', () => {
  const s = { dmg: 0, selfMissingPct: [0.2, 0.25, 0.3], selfMissingCap: 0.5 };
  grom.hp = grom.maxHp * 0.7;
  assert.ok(Math.abs(grom.skillDmg(s, 2, tide) - grom.maxHp * 0.3 * 0.25) < 1e-6);
  grom.hp = 1;
  assert.ok(Math.abs(grom.skillDmg(s, 3, tide) - grom.maxHp * 0.5 * 0.3) < 1e-6, 'capped at 50% of max');
  grom.hp = grom.maxHp;
});

T.test('F28: airborne ignores tenacity, a stun does not', () => {
  tide.cc.clear();
  tide.addTimedBuff('tenacity', 0.3, 5);
  const ten = tide.attrs.get('tenacity');
  assert.ok(ten >= 0.3);
  assert.ok(Math.abs(tide.cc.apply('airborne', 1.0, ten) - 1.0) < 1e-9);
  assert.ok(Math.abs(tide.cc.apply('stun', 1.0, ten) - 0.7) < 1e-9);
  tide.cc.clear();
  tide.buffs.tenacity = null;
  tide.recalcStats(false);
});

T.test('F28: airborne clears a dash in progress on the victim', () => {
  tide.dashS = { dx: 1, dy: 0, remaining: 300, speed: 1000, dmg: 0, hitSet: new Set(), s: tide.skills[1], rank: 1 };
  R.applySkillCC(grom, tide, { airborne: 0.5 }, 1);
  assert.equal(tide.dashS, null);
  assert.ok(tide.cc.has('airborne'));
  tide.cc.clear();
});

T.test('F28: airborne is still refused by Purify immunity', () => {
  tide.cc.purify(1.0);
  assert.equal(tide.cc.apply('airborne', 1.0, 0), 0);
  tide.cc.immuneT = 0;
});

T.test('F28: chillImmuneT blocks a new Chill stack; stacks apply otherwise', () => {
  grom.marks = {};
  grom.marks.chillImmuneT = G.time + 5;
  mira.fire('onSkillHit', grom, 10, mira.skills[0]);
  assert.ok(!grom.marks.chill, 'locked target takes no chill');
  grom.marks.chillImmuneT = 0;
  mira.fire('onSkillHit', grom, 10, mira.skills[0]);
  assert.equal(grom.marks.chill, 1);
  assert.ok(grom.cc.has('slow'));
  grom.marks = {}; grom.cc.clear();
});

T.test('F28: slowPctLv ramps a multi-tick zone\'s slow per tick', () => {
  const s = { type: 'zone', radius: 200, delay: 0, ticks: 3, interval: 0.1, dmg: 1, slowPct: 0.1, slowPctLv: 0.08, slowDur: 5 };
  const z = new Zone(grom, s, tide.x, tide.y);
  tide.cc.clear();
  z.tick(); assert.ok(Math.abs(tide.cc.slowPct - 0.10) < 1e-9, `tick 1 ${tide.cc.slowPct}`);
  z.tick(); assert.ok(Math.abs(tide.cc.slowPct - 0.18) < 1e-9, `tick 2 ${tide.cc.slowPct}`);
  z.tick(); assert.ok(Math.abs(tide.cc.slowPct - 0.26) < 1e-9, `tick 3 ${tide.cc.slowPct}`);
  tide.cc.clear(); tide.hp = tide.maxHp;
});

T.test('F28: canCrit rolls once per cast and doubles a nova', () => {
  const s = { type: 'nova', radius: 300, dmgType: 'physical', dmg: 200, canCrit: true };
  tide.hp = tide.maxHp;
  grom.attrs.bonus.critChance = 0;
  grom.doNova(s, 1);
  const plain = tide.maxHp - tide.hp;
  tide.hp = tide.maxHp;
  grom.attrs.bonus.critChance = 1;
  grom.doNova(s, 1);
  const crit = tide.maxHp - tide.hp;
  grom.attrs.bonus.critChance = 0;
  tide.hp = tide.maxHp;
  assert.ok(plain > 0);
  assert.ok(Math.abs(crit / plain - 2) < 0.05, `crit ${crit} vs plain ${plain}`);
});

T.done();
