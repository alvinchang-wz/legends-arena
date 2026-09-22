'use strict';
/* F16 tether entity (hostile and friendly payloads) and F17 ally targeting
   (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const karn = T.maxSkills(T.hero(G, 'karn', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const sylva = T.maxSkills(T.hero(G, 'sylva', 1));
const bastion = T.maxSkills(T.hero(G, 'bastion', 1));
const open = T.openSpot(G, 320);
function reset() {
  T.place(grom, open.x, open.y);
  T.place(karn, open.x - 200, open.y + 200);
  T.place(tide, open.x + 200, open.y);
  T.place(mira, open.x + 200, open.y + 150);
  T.place(sylva, open.x + 500, open.y - 150);   // 427 from Karn's cast spot: outside a 320 multi radius
  T.place(bastion, open.x + 1400, open.y - 1400);
  for (const h of [grom, karn, tide, mira, sylva, bastion]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null;
    h.skillCd = [0, 0, 0]; h.buffs = {}; h.recalcStats(false);
  }
  G.tethers.length = 0;
}
reset();
G.update(1 / 60);

/* a private copy of skill 0 so the shared kit is untouched */
function ownSkill(h, i, def) {
  h.def0 = Object.assign({}, h.def0);
  h.def0.skills = h.def0.skills.map(s => Object.assign({}, s));
  const s = h.def0.skills[i];
  for (const k of Object.keys(s)) if (!['name', 'icon'].includes(k)) delete s[k];
  Object.assign(s, def);
  return s;
}

T.test('F16: a tether breaks past breakRange and fires onBreak, not onComplete', () => {
  reset();
  let broke = 0, completed = 0;
  G.addTether({ src: grom, target: tide, hostile: true, t: 3, breakRange: 300, onBreak() { broke++; }, onComplete() { completed++; } });
  T.frames(G, 5);
  assert.equal(G.tethers.length, 1);
  T.place(tide, open.x + 400, open.y);
  G.update(1 / 60);
  assert.equal(broke, 1);
  assert.equal(completed, 0);
  assert.equal(G.tethers.length, 0, 'removed after the break');
  // a tether that runs out completes instead
  G.addTether({ src: grom, target: tide, hostile: true, t: 0.2, breakRange: Infinity, onBreak() { broke++; }, onComplete() { completed++; } });
  T.frames(G, 14);
  assert.equal(completed, 1);
  assert.equal(broke, 1);
});

T.test('F16: a hostile tether snaps when its source is stunned unless anchored; the target Purifying snaps it', () => {
  reset();
  let broke = 0;
  G.addTether({ src: grom, target: tide, hostile: true, t: 3, onBreak() { broke++; } });
  G.addTether({ src: grom, target: mira, hostile: true, anchored: true, t: 3, onBreak() { broke += 10; } });
  grom.cc.apply('stun', 0.5, 0);
  G.update(1 / 60);
  assert.equal(broke, 1, 'the unanchored chain snapped, the anchored one held');
  assert.equal(G.tethers.length, 1);
  mira.cc.purify(1);
  assert.equal(broke, 11, 'Purify on the target snaps even an anchored chain');
  assert.equal(G.tethers.filter(t => !t.dead).length, 0);
  grom.cc.clear(); mira.cc.immuneT = 0;
});

T.test('F16: a skill tether slows over its life, ticks damage with healPct, and lands its payload', () => {
  reset();
  const s = ownSkill(grom, 0, {
    type: 'tether', cd: 10, mana: 0, targetRange: 520, targetCone: 60, dmgType: 'magic',
    tether: { dur: 1.0, breakRange: 900, slowStart: 0.2, slowEnd: 0.6, interval: 0.4, tickDmg: 40, tickScaleAp: 0, healPct: 1.0,
      payload: { dmg: 100, scaleAd: 0, immobilize: 1.3 } },
  });
  grom.hp = grom.maxHp * 0.5;
  assert.ok(grom.castSkill(0, tide));
  assert.equal(G.tethers.length, 1);
  assert.equal(G.tethers[0].target, tide);
  G.update(1 / 60);
  assert.ok(Math.abs(tide.cc.slowPct - 0.2) < 0.02, `slowStart ${tide.cc.slowPct}`);
  T.frames(G, 30);   // ~0.5 s: one tick landed
  assert.ok(tide.hp < tide.maxHp, 'tick damage');
  assert.ok(grom.hp > grom.maxHp * 0.5, 'healPct returned the tick to the caster');
  assert.ok(tide.cc.slowPct > 0.35 && tide.cc.slowPct < 0.5, `slow lerps toward slowEnd: ${tide.cc.slowPct}`);
  const hpBeforePayload = tide.hp;
  T.frames(G, 32);   // past 1.0 s
  assert.equal(G.tethers.length, 0);
  assert.ok(tide.hp < hpBeforePayload - 50, 'payload damage');
  assert.ok(tide.cc.has('immobilize'), 'payload immobilize');
});

T.test('F16: an aimed tether refuses (no cost) with no hero in the cone', () => {
  reset();
  grom.skillCd[0] = 0; grom.mana = 100;
  grom.skills[0].mana = 20;
  const away = { x: grom.x - 300, y: grom.y };   // every enemy is on the other side
  assert.equal(grom.castSkill(0, away), false);
  assert.equal(grom.mana, 100);
  assert.equal(grom.skillCd[0], 0);
  assert.equal(G.tethers.length, 0);
  grom.skills[0].mana = 0;
});

T.test('F16: a multi tether chains every enemy hero in radius, holds through hard CC, and breakPayload punishes leaving', () => {
  reset();
  const s = ownSkill(karn, 2, {
    type: 'tether', cd: 40, mana: 0, dmgType: 'physical',
    tether: { multi: { radius: 320 }, dur: 2.5, breakRange: 450, anchored: true, breakPayload: { dmg: [260, 340, 420], scaleAd: 0, stun: 1.0 } },
  });
  T.place(karn, open.x + 100, open.y);
  assert.ok(karn.castSkill(2, tide));
  const mine = G.tethers.filter(t => t.src === karn);
  assert.equal(mine.length, 2, 'tide and mira are within 320; sylva is not');
  karn.cc.apply('stun', 0.4, 0);
  G.update(1 / 60);
  assert.equal(G.tethers.filter(t => t.src === karn && !t.dead).length, 2, 'anchored chains survive a stun on Karn');
  T.place(tide, open.x + 700, open.y);
  G.update(1 / 60);
  assert.ok(tide.hp < tide.maxHp, 'breakPayload damage');
  assert.ok(tide.cc.has('stun'), 'breakPayload stun');
  assert.equal(G.tethers.filter(t => t.src === karn && !t.dead).length, 1);
  karn.cc.clear();
});

T.test('F17: allyTarget picks the ally nearest the aim point, the lowest-HP ally with no aim, never self when self: false', () => {
  reset();
  const s = { allyTarget: { range: 520, self: false } };
  tide.hp = tide.maxHp * 0.3;
  assert.equal(sylva.pickAllyTarget(s, null), tide, 'lowest HP with no aim');
  assert.equal(sylva.pickAllyTarget(s, { x: mira.x, y: mira.y }), mira, 'nearest the aim point');
  sylva.hp = sylva.maxHp * 0.1;
  assert.equal(sylva.pickAllyTarget(s, null), tide, 'self excluded');
  assert.equal(sylva.pickAllyTarget({ allyTarget: { range: 520, self: true } }, null), sylva);
  T.place(tide, open.x + 2000, open.y + 2000); T.place(mira, open.x + 2000, open.y + 2100);
  assert.equal(sylva.pickAllyTarget(s, null), null, 'nobody in range');
});

T.test('F17: an ally-targeted heal lands on that ally only and refuses with no ally in range (no cost)', () => {
  reset();
  const s = ownSkill(sylva, 1, { type: 'heal', cd: 11, mana: 40, heal: 200, radius: 300, allyTarget: { range: 520, self: false } });
  tide.hp = tide.maxHp * 0.4; mira.hp = mira.maxHp * 0.5; sylva.hp = sylva.maxHp * 0.3;
  sylva.mana = 100;
  assert.ok(sylva.castSkill(1, null));
  assert.equal(sylva.mana, 72, '40 paid, 12 back from Verdant (her passive refunds mana per heal)');
  assert.ok(tide.hp > tide.maxHp * 0.4 + 100, 'the lowest-HP ally was healed');
  assert.equal(mira.hp, mira.maxHp * 0.5, 'nobody else was');
  assert.equal(sylva.hp, sylva.maxHp * 0.3, 'self excluded even at the lowest HP');
  T.place(tide, open.x + 2000, open.y + 2000); T.place(mira, open.x + 2000, open.y + 2100);
  sylva.skillCd[1] = 0;
  assert.equal(sylva.castSkill(1, null), false);
  assert.equal(sylva.mana, 72, 'no cost without a target');
  assert.equal(sylva.skillCd[1], 0);
});

T.test('F16: a friendly link heals on a beat, hastens the ally, armours the caster, and the larger tick wins', () => {
  reset();
  const s = ownSkill(sylva, 1, {
    type: 'link', cd: 11, mana: 0, heal: 100, allyTarget: { range: 520, self: false },
    link: { dur: 2, interval: 0.5, tickHeal: 25, tickHealLv: 4, tickScaleAp: 0, targetSpeedAdd: 40, casterArmorAdd: 12, casterMrAdd: 12, breakRange: 650 },
  });
  tide.hp = tide.maxHp * 0.5;
  const speed0 = tide.curSpeed(), armor0 = sylva.armorValue();
  assert.ok(sylva.castSkill(1, { x: tide.x, y: tide.y }));
  assert.equal(tide.hp, tide.maxHp * 0.5 + 100, 'immediate heal');
  assert.equal(G.tethers.length, 1);
  assert.equal(G.tethers[0].hostile, false);
  T.frames(G, 33);   // one 0.5 s beat
  const expectTick = 25 + 4 * (sylva.skillRank[1] - 1);
  assert.ok(tide.hp >= tide.maxHp * 0.5 + 100 + expectTick - 1, `tick heal at rank: ${tide.hp - tide.maxHp * 0.5}`);
  assert.ok(tide.curSpeed() > speed0, 'ally hastened');
  assert.ok(sylva.armorValue() > armor0, 'caster armoured');
  const first = G.tethers[0];
  assert.equal(sylva.linkTo(tide, { link: { dur: 2, interval: 0.5, tickHeal: 5 } }, 1), first, 'a smaller tick does not replace the link');
  const bigger = sylva.linkTo(tide, { link: { dur: 2, interval: 0.5, tickHeal: 99 } }, 1);
  assert.notEqual(bigger, first);
  assert.ok(first.dead, 'the larger tick replaced it');
});

T.test('F16: a friendly link is removed when the two part beyond breakRange', () => {
  reset();
  sylva.linkTo(tide, { link: { dur: 5, interval: 0.5, tickHeal: 10, breakRange: 400 } }, 1);
  assert.equal(G.tethers.length, 1);
  T.place(tide, open.x + 900, open.y);
  G.update(1 / 60);
  assert.equal(G.tethers.length, 0);
});

T.done();
