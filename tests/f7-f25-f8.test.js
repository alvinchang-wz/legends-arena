'use strict';
/* F7 basic-attack replacement state (basicMod volley), F25 basic-range
   state (basicRange), F8 charge skills (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const R = G.rules;
T.parkAll(G);

const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const nyx = T.maxSkills(T.hero(G, 'nyx', 0));
const grom = T.maxSkills(T.hero(G, 'grom', 0));
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
  T.place(zephyr, open.x, open.y);
  T.place(nyx, open.x - 300, open.y - 300);
  T.place(grom, open.x - 300, open.y + 300);
  T.place(mira, open.x + 1400, open.y + 1400);
  T.place(tide, open.x + 1400, open.y + 1200);
  T.place(sylva, open.x + 1200, open.y + 1400);
  for (const h of [zephyr, nyx, grom, mira, tide, sylva]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.spawnProtT = 0; h.stats.dmgTaken = 0; h.basicMod = null; h.basicRangeState = null;
    h.buffAsT = 0; h.buffAsMult = 1; h.items = [];
    h.skillCharges = [0, 0, 0]; h.skillRecharge = [0, 0, 0];
    h.recalcStats(false);
  }
  G.projectiles.length = 0; G.tethers.length = 0;
}
reset();
G.update(1 / 60);

const STORM = { type: 'basicMod', cd: [48, 42, 36], mana: [100, 120, 140], dur: 6, lineRange: 420, radius: 30,
  bonusDmg: [40, 65, 90], bonusScaleAd: 0.25, asMult: [1.3, 1.4, 1.5] };

/* One Storm Volley basic at Mira with Tide behind her in the line and Sylva
   beside it. Returns the damage each took. */
function volley() {
  T.place(mira, open.x + 250, open.y);
  T.place(tide, open.x + 380, open.y);
  T.place(sylva, open.x + 380, open.y + 140);
  for (const h of [mira, tide, sylva]) { h.hp = h.maxHp; h.stats.dmgTaken = 0; h.recalcStats(false); }
  zephyr.atkCd = 0;
  zephyr.tryAttack(mira);
  const p = G.projectiles[G.projectiles.length - 1];
  assert.ok(p && p.kind === 'volley', 'a volley was fired');
  T.frames(G, 25);
  assert.ok(p.dead, 'flew its line');
  return { mira: mira.stats.dmgTaken, tide: tide.stats.dmgTaken, sylva: sylva.stats.dmgTaken, p };
}

T.test('F7: under basicMod every basic is a piercing volley: the aimed target is the primary hit, the line behind takes a secondary hit', () => {
  reset();
  ownSkill(zephyr, 2, STORM);
  const as0 = zephyr.curAtkSpd();
  assert.ok(zephyr.castSkill(2, { x: open.x + 300, y: open.y }));
  assert.ok(zephyr.basicMod && Math.abs(zephyr.basicMod.t - 6) < 1e-9, 'state set for dur');
  assert.equal(zephyr.basicMod.asMult, 1.5, 'rank-3 asMult');
  assert.ok(Math.abs(zephyr.curAtkSpd() - as0 * 1.5) < 1e-9, 'attack speed x1.5');
  zephyr.pv.stacks = 0; zephyr.pv.t = 0;
  const r = volley();
  assert.ok(r.mira > 0, 'primary hit');
  assert.ok(r.tide > 0, 'the hero behind her in the line was pierced');
  assert.equal(r.sylva, 0, 'off the line: untouched');
  assert.equal(zephyr.pv.stacks, 1, 'onBasicHit fired once, for the primary only');
  assert.equal(r.p.primaryDone, true);
  // the bonus is in every hit: the secondary is AD + bonus, not a bare AD
  const bonus = 90 + zephyr.curAtk() * 0.25;
  assert.ok(Math.abs(r.p.bonus - bonus) < 1e-6, 'rank-3 bonus +25% AD');
  assert.ok(r.p.atk + r.p.bonus > zephyr.curAtk() * 1.4, 'a volley hit carries the bonus');
  // casting another skill does not end it; expiry does
  assert.ok(zephyr.castSkill(0, { x: open.x + 300, y: open.y }), 'S1 cast');
  assert.ok(zephyr.basicMod, 'still active after a cast');
  T.seconds(G, 6.1);
  assert.equal(zephyr.basicMod, null, 'expired');
  zephyr.atkCd = 0; G.projectiles.length = 0;
  zephyr.tryAttack(mira);
  assert.equal(G.projectiles[G.projectiles.length - 1].kind, 'homing', 'a plain arrow again');
  // death ends it
  zephyr.skillCd[2] = 0; zephyr.mana = zephyr.maxMana;
  assert.ok(zephyr.castSkill(2, { x: open.x + 300, y: open.y }));
  zephyr.hp = 1; zephyr.die(mira);
  assert.equal(zephyr.basicMod, null, 'gone on death');
  zephyr.alive = true; zephyr.respawnT = 0; zephyr.hp = zephyr.maxHp;
});

T.test('F7: crit is rolled once per volley and shared by every hit; secondaries drain 40%; asMult takes the max with a dash steroid', () => {
  reset();
  ownSkill(zephyr, 2, STORM);
  assert.ok(zephyr.castSkill(2, { x: open.x + 300, y: open.y }));
  zephyr.pv.stacks = 0; zephyr.pv.t = 0;   // keep Slipstream's five-stack bonus out of the ratios
  const plain = volley();
  assert.equal(plain.p.crit, false);
  // guaranteed crit: every hit doubles
  zephyr.items.push({ id: 'test-crit', stats: { critChance: 1, lifesteal: 0.3 } });
  zephyr.recalcStats(false);
  zephyr.hp = Math.round(zephyr.maxHp * 0.25);   // room for the drain (her level-1 pool is 575 since the Marksmen pass)
  const hp0 = zephyr.hp;
  zephyr.pv.stacks = 0; zephyr.pv.t = 0;
  const crit = volley();
  assert.equal(crit.p.crit, true);
  assert.ok(Math.abs(crit.mira / plain.mira - 2.0) < 0.03, `primary crit x2: ${crit.mira / plain.mira}`);
  assert.ok(Math.abs(crit.tide / plain.tide - 2.0) < 0.03, `secondary shares the roll: ${crit.tide / plain.tide}`);
  // lifesteal (the item's 30% plus whatever emblem the bot picked): all of it on the
  // primary, 40% of it on the secondary, plus a sliver of regen over 25 frames
  const ls = zephyr.attrs.get('lifesteal');
  assert.ok(ls >= 0.3);
  const expect = ls * crit.mira + ls * 0.4 * crit.tide;
  const healed = zephyr.hp - hp0;
  const regen = (zephyr.maxHp * 0.006 + zephyr.attrs.get('hpRegen')) * 26 / 60;
  assert.ok(healed >= expect - 3 && healed <= expect + regen + 3, `drained ${healed} for ${expect} (+regen ${regen.toFixed(1)})`);
  // an Agile Hop steroid (x1.7) with the volley (x1.5): the larger one, not x2.55
  const base = zephyr.attrs.get('atkSpd');
  zephyr.buffAsMult = 1.7; zephyr.buffAsT = 3;
  assert.ok(Math.abs(zephyr.curAtkSpd() - base * 1.7) < 1e-9, 'max(1.7, 1.5)');
  zephyr.buffAsMult = 1.2;
  assert.ok(Math.abs(zephyr.curAtkSpd() - base * 1.5) < 1e-9, 'max(1.2, 1.5)');
});

T.test('F25: basicRange sets Stats.range to rangeSet, throws projectile basics with the bonus, and ends after count or expiry', () => {
  reset();
  const s = ownSkill(nyx, 1, { type: 'basicRange', cd: 8, mana: 30, rangeSet: 300, count: 3, dur: 4, bonusDmg: 20, bonusDmgLv: 3, bonusScaleAd: 0.15 });
  const range0 = nyx.range;
  assert.ok(range0 < 150, 'Nyx is melee');
  T.place(mira, nyx.x + 250, nyx.y);
  assert.ok(!nyx.inAttackRange(mira), 'out of melee reach');
  assert.ok(nyx.castSkill(1, null));
  assert.ok(nyx.basicRangeState && nyx.basicRangeState.count === 3);
  assert.equal(nyx.range, 300, 'range reads rangeSet');
  assert.equal(nyx.attrs.get('range'), 300, 'Stats.range reads rangeSet');
  assert.ok(nyx.inAttackRange(mira), 'now in reach');
  nyx.atkCd = 0; G.projectiles.length = 0;
  nyx.tryAttack(mira);
  const p = G.projectiles[G.projectiles.length - 1];
  assert.ok(p && p.kind === 'homing', 'a thrown blade (ranged path)');
  const bonus = 20 + 3 * 5 + nyx.curAtk() * 0.15;
  assert.ok(Math.abs(p.packet.amount - (nyx.curAtk() + bonus)) < 1e-6, 'AD + rank-6 bonus');
  assert.equal(p.packet.isBasic, true);
  assert.equal(nyx.basicRangeState.count, 2, 'one spent');
  T.frames(G, 20);
  assert.ok(mira.stats.dmgTaken > 0, 'it landed');
  nyx.atkCd = 0; nyx.tryAttack(mira);
  assert.equal(nyx.basicRangeState.count, 1);
  nyx.atkCd = 0; nyx.tryAttack(mira);
  assert.equal(nyx.basicRangeState, null, 'ended at count 0');
  assert.equal(nyx.range, range0, 'range restored');
  assert.equal(nyx.attrs.get('range'), range0);
  // a recalc mid-state keeps rangeSet
  nyx.skillCd[1] = 0; nyx.mana = nyx.maxMana;
  assert.ok(nyx.castSkill(1, null));
  nyx.recalcStats(false);
  assert.equal(nyx.range, 300);
  // expiry
  T.seconds(G, 4.1);
  assert.equal(nyx.basicRangeState, null, 'expired');
  assert.equal(nyx.range, range0);
  // an airborne drops it (F28)
  nyx.skillCd[1] = 0; nyx.mana = nyx.maxMana;
  assert.ok(nyx.castSkill(1, null));
  nyx.cc.apply('airborne', 0.5, 0);
  assert.equal(nyx.basicRangeState, null, 'airborne cancelled it');
  assert.equal(nyx.range, range0);
  nyx.cc.clear();
  assert.ok(s.rangeSet === 300);
});

T.test('F8: charges recharge one at a time, ignoring cdr; a cast spends one and is gated by castDelay; learning starts empty', () => {
  reset();
  const s = ownSkill(zephyr, 0, { type: 'skillshot', charges: 3, recharge: 9, rechargeLv: -0.4, castDelay: 0.6, mana: 30, manaLv: 3,
    dmgType: 'physical', dmg: 100, dmgLv: 14, scaleAd: 0.6, range: 560, speed: 1300, radius: 22 });
  assert.equal(zephyr.rechargeFor(s, 6), 7, 'rank-6 recharge');
  assert.equal(zephyr.skillCharges[0], 0);
  assert.equal(zephyr.castSkill(0, { x: open.x + 300, y: open.y }), false, 'nothing banked: refused');
  G.update(1 / 60);
  assert.ok(zephyr.skillRecharge[0] > 6.9 && zephyr.skillRecharge[0] < 7, 'the first charge started recharging on its own');
  T.seconds(G, 7);
  assert.equal(zephyr.skillCharges[0], 1, 'one charge after 7 s');
  assert.ok(zephyr.skillRecharge[0] > 6.5, 'the next one started, from the full time');
  T.seconds(G, 3.5);
  assert.equal(zephyr.skillCharges[0], 1, 'only one recharges at a time: 10.5 s is still one charge');
  T.seconds(G, 3.6);
  assert.equal(zephyr.skillCharges[0], 2);
  T.seconds(G, 7.1);
  assert.equal(zephyr.skillCharges[0], 3, 'full');
  assert.equal(zephyr.skillRecharge[0], 0, 'idle at max');
  T.seconds(G, 2);
  assert.equal(zephyr.skillCharges[0], 3, 'never above max');
  // a cast spends one and starts the recharge; castDelay gates the next
  zephyr.mana = zephyr.maxMana;
  assert.ok(zephyr.castSkill(0, { x: open.x + 300, y: open.y }));
  assert.equal(zephyr.skillCharges[0], 2);
  assert.ok(Math.abs(zephyr.skillCd[0] - 0.6) < 1e-9, 'castDelay, not a cooldown');
  assert.ok(Math.abs(zephyr.skillRecharge[0] - 7) < 1e-9, 'recharge started');
  assert.equal(zephyr.mana, zephyr.maxMana - 45, 'mana per shot (30 + 3 x 5)');
  assert.equal(zephyr.castSkill(0, { x: open.x + 300, y: open.y }), false, 'inside castDelay');
  T.frames(G, 40);
  assert.ok(zephyr.castSkill(0, { x: open.x + 300, y: open.y }), 'after castDelay');
  assert.equal(zephyr.skillCharges[0], 1);
  assert.ok(zephyr.skillRecharge[0] < 6.5 && zephyr.skillRecharge[0] > 6, 'the running recharge was not restarted');
  // cdr shortens the castDelay but never the recharge
  zephyr.items.push({ id: 'test-cdr', stats: { cdr: 0.3 } });
  zephyr.recalcStats(false);
  zephyr.skillCharges[0] = 1; zephyr.skillRecharge[0] = 0; zephyr.skillCd[0] = 0;
  G.update(1 / 60);
  assert.ok(zephyr.skillRecharge[0] > 6.9, 'recharge ignores cdr');
  assert.ok(zephyr.castSkill(0, { x: open.x + 300, y: open.y }));
  assert.ok(Math.abs(zephyr.skillCd[0] - 0.42) < 1e-9, 'castDelay x (1 - cdr)');
  // refundRecharge takes seconds off the charge on its way
  const before = zephyr.skillRecharge[0];
  assert.ok(R.refundRecharge(zephyr, 0, 1.0));
  assert.ok(Math.abs(zephyr.skillRecharge[0] - (before - 1)) < 1e-9);
  R.refundRecharge(zephyr, 0, 100);
  G.update(1 / 60);
  assert.equal(zephyr.skillCharges[0], 1, 'a refund past zero grants the charge rather than restarting');
  // learning: rank 0 -> 1 sets 0 charges and starts the (rank-1) recharge
  zephyr.skillRank[0] = 0; zephyr.skillPoints = 1; zephyr.skillCharges[0] = 3; zephyr.skillRecharge[0] = 0;
  assert.ok(zephyr.rankUp(0));
  assert.equal(zephyr.skillCharges[0], 0, 'learned empty');
  assert.equal(zephyr.skillRecharge[0], 9, 'rank-1 recharge running');
  // bots never try to fire an empty charge skill
  zephyr.skillRank[0] = 6;
  T.place(mira, open.x + 300, open.y);
  assert.equal(zephyr.botSkillUrgency(0, mira, 300, true, false), 0, 'no charge: no urgency');
  zephyr.skillCharges[0] = 1; zephyr.skillCd[0] = 0;
  assert.ok(zephyr.botSkillUrgency(0, mira, 300, true, false) > 0, 'a charge: fires');
  zephyr.items = []; zephyr.recalcStats(false);
});

T.done();
