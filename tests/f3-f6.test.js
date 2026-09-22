'use strict';
/* F3 resource framework, F4 energy pools, F5 heat gauge with overheat,
   F6 HP-cost casting (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const nyx = T.maxSkills(T.hero(G, 'nyx', 0));
const karn = T.maxSkills(T.hero(G, 'karn', 0));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const spot = T.openSpot(G);
T.place(grom, spot.x, spot.y);
T.place(zephyr, spot.x - 150, spot.y);
T.place(nyx, spot.x, spot.y - 150);
T.place(karn, spot.x - 150, spot.y - 150);
T.place(tide, spot.x + 80, spot.y);
G.update(1 / 60);

/* Give a hero its own def copy with a resource block, without touching the
   shared HEROES table (other heroes of the same id keep their kit). */
function giveResource(h, fields) {
  h.def0 = Object.assign({}, h.def0, fields);
  h.def0.skills = h.def0.skills.map(s => Object.assign({}, s));
  h.resource = h.def0.resource || 'mana';
  h.recalcStats(true);
  return h;
}
const minion = new sim.context.Minion(1, 'mid', 'melee');

T.test('F4: a battery pool is flat, charges while standing still after stillDelay and per basic', () => {
  giveResource(zephyr, { resource: 'energy', energy: { max: 100, regen: 0, perBasic: 20, stillRegen: 30, stillDelay: 0.5 } });
  assert.equal(zephyr.maxMana, 100);
  assert.equal(zephyr.mana, 100);
  zephyr.mana = 0;
  T.seconds(G, 1);          // parked: still the whole second
  assert.ok(zephyr.mana > 13 && zephyr.mana < 17, `0.5 s of 30/s after the delay: ${zephyr.mana}`);
  zephyr.mana = 0;
  zephyr.onBasicLanded(tide, 10);
  assert.equal(zephyr.mana, 20, 'perBasic');
  zephyr.mana = 0;
  for (let i = 0; i < 60; i++) { zephyr.x += 2; G.update(1 / 60); }   // walking: no battery charge
  assert.ok(zephyr.mana < 0.01, `moving hero charged ${zephyr.mana}`);
  zephyr.mana = 95; zephyr.onBasicLanded(tide, 10);
  assert.equal(zephyr.mana, 100, 'clamped to max');
});

T.test('F4: a fast pool regenerates on its own, ignores mana refunds and levels', () => {
  giveResource(nyx, { resource: 'energy', energy: { max: 100, regen: 8, perBasic: 0 } });
  nyx.mana = 0;
  T.seconds(G, 1);
  assert.ok(Math.abs(nyx.mana - 8) < 0.5, `regen 8/s: ${nyx.mana}`);
  nyx.gainMana(50);
  assert.ok(Math.abs(nyx.mana - 8) < 0.5, 'mana refunds do nothing to energy');
  nyx.level = 10; nyx.recalcStats(false);
  assert.equal(nyx.maxMana, 100, 'flat pool at any level');
});

T.test('F3: castSkill charges energy from s.energy and refuses when short', () => {
  nyx.skills[0].energy = 30;
  nyx.mana = 100; nyx.skillCd[0] = 0;
  assert.ok(nyx.castSkill(0, { x: nyx.x + 100, y: nyx.y }));
  assert.equal(nyx.mana, 70);
  nyx.mana = 20; nyx.skillCd[0] = 0;
  assert.equal(nyx.castSkill(0, { x: nyx.x + 100, y: nyx.y }), false);
  assert.equal(nyx.canAfford(nyx.skills[0]), false);
  nyx.dashS = null;
});

T.test('F5: heat starts at 0, gains per hit by target type, burns up on a burning enemy, decays out of combat', () => {
  giveResource(karn, { resource: 'heat', heat: { gainBasicHero: 8, gainBasic: 4, gainSkillHero: 8, gainSkill: 4, burnPerSec: 2, decay: 5, decayDelay: 4 } });
  assert.equal(karn.maxMana, 100);
  assert.equal(karn.mana, 0, 'a heat gauge starts empty');
  karn.onBasicLanded(tide, 10);
  assert.equal(karn.mana, 8);
  karn.onSkillLanded(minion, 10, karn.skills[0]);
  assert.equal(karn.mana, 12);
  karn.onSkillLanded(tide, 10, karn.skills[0]);
  assert.equal(karn.mana, 20);
  // decay only after decayDelay seconds without dealing or taking damage
  karn.lastDmgT = G.time;
  T.seconds(G, 1);
  assert.ok(Math.abs(karn.mana - 20) < 1e-6, `no decay inside the delay: ${karn.mana}`);
  karn.lastDmgT = -99;
  T.seconds(G, 1);
  assert.ok(Math.abs(karn.mana - 15) < 0.2, `5/s decay: ${karn.mana}`);
  // a burning enemy hero heats the caster instead
  tide.addDot({ src: karn, total: 10, dur: 5, type: 'magic', tag: 'burn' });
  T.seconds(G, 1);
  assert.ok(Math.abs(karn.mana - 17) < 0.3, `+2/s while the burn tag is on an enemy hero: ${karn.mana}`);
  tide.dots = [];
  karn.gainMana(50);
  assert.ok(karn.mana < 20, 'mana refunds never touch heat');
});

T.test('F5: at 100 heat the cast uses the overheat variant (dmgMult) and empties the gauge', () => {
  const s = karn.skills[0];
  Object.assign(s, { type: 'nova', radius: 300, dmgType: 'physical', dmg: 200, scaleAd: 0, overheat: { dmgMult: 1.5, radius: 400 } });
  karn.mana = 50; karn.skillCd[0] = 0; tide.hp = tide.maxHp;
  assert.ok(karn.castSkill(0, tide));
  const plain = tide.maxHp - tide.hp;
  assert.ok(plain > 0);
  assert.ok(Math.abs(karn.mana - (50 + 8)) < 1e-6, 'a normal cast just adds skill heat');
  karn.mana = 100; karn.skillCd[0] = 0; tide.hp = tide.maxHp;
  assert.ok(karn.castSkill(0, tide));
  const hot = tide.maxHp - tide.hp;
  assert.ok(Math.abs(hot / plain - 1.5) < 0.05, `overheat ${hot} vs ${plain}`);
  assert.equal(karn.mana, 0, 'gauge emptied by the overheat cast');
  assert.ok(Math.abs(karn.skillCd[0] - karn.cooldownFor(s)) < 1e-9, 'cooldown from the base skill');
  tide.hp = tide.maxHp;
});

T.test('F6: an HP cost is paid after the effect, never kills, and respects hpFloor', () => {
  giveResource(grom, { resource: 'hp', hpFloor: 0.25 });
  const s = grom.skills[0];
  Object.assign(s, { type: 'nova', radius: 300, dmgType: 'physical', dmg: 50, hpCost: 0.12 });
  grom.hp = grom.maxHp; grom.skillCd[0] = 0;
  const manaBefore = grom.mana;
  assert.ok(grom.castSkill(0, tide));
  assert.equal(grom.hp, grom.maxHp - Math.floor(grom.maxHp * 0.12));
  assert.equal(grom.mana, manaBefore, 'no mana taken for an hpCost skill');
  grom.hp = grom.maxHp * 0.2; grom.skillCd[0] = 0;
  assert.equal(grom.canAfford(s), false);
  assert.equal(grom.castSkill(0, tide), false, 'refused under the floor');
  // Marrow-style: floor 0 means the cost can take the hero to 1 HP but never kill
  grom.def0.hpFloor = 0;
  grom.hp = 5; grom.skillCd[0] = 0;
  assert.ok(grom.castSkill(0, tide));
  assert.equal(grom.hp, 1);
  assert.ok(grom.alive);
  assert.equal(grom.deaths, 0);
  grom.hp = grom.maxHp;
});

T.test('F6: a hybrid hp hero still pays mana on skills without hpCost; the bank records payments', () => {
  const s1 = grom.skills[1];
  delete s1.hpCost;
  grom.mana = grom.maxMana; grom.skillCd[1] = 0;
  const cost = grom.costOf(s1);
  assert.ok(cost > 0);
  assert.ok(grom.castSkill(1, { x: grom.x + 50, y: grom.y }));
  assert.equal(grom.mana, grom.maxMana - cost);
  grom.dashS = null;
  const pv0 = grom.pv;
  grom.pv = { shieldCd: 99, bank: [] };
  grom.hp = grom.maxHp; grom.skillCd[0] = 0;
  assert.ok(grom.castSkill(0, tide));
  assert.equal(grom.pv.bank.length, 1);
  assert.equal(grom.pv.bank[0].amt, Math.floor(grom.maxHp * 0.12));
  grom.pv = pv0;
});

T.test('F3: a cooldown-only hero has no bar and casts for free; mana regen/refunds are skipped', () => {
  giveResource(karn, { resource: 'none' });
  assert.equal(karn.maxMana, 0);
  assert.equal(karn.mana, 0);
  karn.skills[0].mana = 999;
  karn.skillCd[0] = 0;
  assert.ok(karn.canAfford(karn.skills[0]));
  assert.ok(karn.castSkill(0, tide));
  T.seconds(G, 1);
  assert.equal(karn.mana, 0);
  karn.gainMana(40);
  assert.equal(karn.mana, 0);
  assert.equal(karn.usesMana(), false);
  tide.hp = tide.maxHp;
});

T.done();
