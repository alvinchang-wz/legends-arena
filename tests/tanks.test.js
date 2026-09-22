'use strict';
/* The four Tank kits (docs/design/heroes.md, "Tanks"; docs/design/hero-kits.json):
   Grom, Bastion, Marrow, Anchor — passives, skill numbers, the engine
   behaviours they lean on and the bot rules from their bot hints. */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim({ blueLineup: 'grom,zephyr,marrow,nyx,ignis', redLineup: 'bastion,anchor,mira,tide,sylva' });
const G = sim.Game;
const { rankVal } = require('../js/combat');   // the pure rank helper; combat.js exports it for Node
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const marrow = T.maxSkills(T.hero(G, 'marrow', 0));
const nyx = T.maxSkills(T.hero(G, 'nyx', 0));
const ignis = T.maxSkills(T.hero(G, 'ignis', 0));
const bastion = T.maxSkills(T.hero(G, 'bastion', 1));
const anchor = T.maxSkills(T.hero(G, 'anchor', 1));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const sylva = T.maxSkills(T.hero(G, 'sylva', 1));
const ALL = [grom, zephyr, marrow, nyx, ignis, bastion, anchor, mira, tide, sylva];
const open = T.openSpot(G, 420);
const FAR = { x: open.x + 2200, y: open.y + 2200 };

function reset() {
  for (const h of ALL) {
    T.place(h, FAR.x, FAR.y);
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.shields = []; h.untargetable = false;
    if (h.pv && h.pv.bank) h.pv.bank.length = 0;
    if (h.pv && h.pv.shieldCd !== undefined) h.pv.shieldCd = 99;
    h.recalcStats(false);
  }
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
}
reset();
G.update(1 / 60);

/* ---------------- Grom ---------------- */

T.test('Grom: Bulwark gives +5 armor / +5 MR per enemy hero within 420, five at most', () => {
  reset();
  T.place(grom, open.x, open.y);
  const enemies = [bastion, anchor, mira, tide, sylva];
  grom.recalcStats(false);
  const a0 = grom.attrs.bonus.armor, m0 = grom.attrs.bonus.mr, armor0 = grom.armorValue();   // items / emblem
  T.place(mira, open.x + 300, open.y);
  grom.recalcStats(false);
  assert.equal(grom.attrs.bonus.armor - a0, 5); assert.equal(grom.attrs.bonus.mr - m0, 5);
  enemies.forEach((e, i) => T.place(e, open.x + 200 + i * 30, open.y + 100));
  grom.recalcStats(false);
  assert.equal(grom.attrs.bonus.armor - a0, 25); assert.equal(grom.attrs.bonus.mr - m0, 25);
  assert.equal(grom.armorValue(), armor0 + 25);
  // the cap: a sixth body on him adds nothing
  const extra = { team: 1, alive: true, x: open.x + 100, y: open.y - 100 };
  G.heroes.push(extra);
  grom.recalcStats(false);
  assert.equal(grom.attrs.bonus.armor - a0, 25, 'max +25');
  G.heroes.pop();
  T.place(mira, open.x + 500, open.y);
  grom.recalcStats(false);
  assert.equal(grom.attrs.bonus.armor - a0, 20, 'outside 420 does not count');
});

T.test('Grom: Bulwark shields 12% max HP for 4 s below 40% HP, once per 35 s', () => {
  reset();
  T.place(grom, open.x, open.y);
  grom.pv.shieldCd = 0;
  grom.hp = grom.maxHp * 0.35;
  G.update(1 / 60);
  assert.ok(grom.shields.length === 1, 'shield up');
  assert.ok(Math.abs(grom.shields[0].amount - grom.maxHp * 0.12) < 1, `12% max HP: ${grom.shields[0].amount}`);
  assert.ok(grom.pv.shieldCd > 34.9);
  grom.shields = [];
  T.seconds(G, 1);
  assert.equal(grom.shields.length, 0, 'not again inside the 35 s');
});

T.test('Grom: Shockwave and Bull Charge carry the spec numbers; the charge stuns 0.7 s and shoves 90', () => {
  reset();
  const s1 = grom.skills[0], s2 = grom.skills[1], s3 = grom.skills[2];
  assert.deepEqual([s1.cd, s1.mana, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAd, s1.slowPct, s1.slowDur], [7, 45, 240, 120, 16, 0.6, 0.4, 1.5]);
  assert.deepEqual([s2.cd, s2.mana, s2.dist, s2.speed, s2.dmg, s2.dmgLv, s2.scaleAd, s2.stun, s2.knockback], [13, 60, 420, 950, 110, 14, 0.6, 0.7, 90]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.channel, s3.interruptRefund, s3.payload.radius, s3.payload.dmg, s3.payload.dmgLv, s3.payload.scaleAd, s3.payload.knockback, s3.payload.airborne],
    ['channel', [46, 42, 38], 110, 0.9, 0.5, 320, 280, 40, 0.9, -140, 0.9]);
  assert.equal(rankVal(s1, 'dmg', 6), 200);
  assert.equal(rankVal(s3.payload, 'dmg', 3), 360);
  T.place(grom, open.x, open.y);
  T.place(mira, open.x + 300, open.y);
  assert.ok(grom.castSkill(1, mira));
  T.seconds(G, 0.45);
  assert.ok(mira.hp < mira.maxHp, 'charge damage');
  assert.ok(mira.cc.t.stun > 0.4 && mira.cc.t.stun <= 0.7, `stun 0.7 s: ${mira.cc.t.stun}`);
  assert.ok(mira.x > open.x + 300 + 60, `shoved away from Grom: ${mira.x - (open.x + 300)}`);
  assert.ok(grom.mana < grom.maxMana - 60 + 2, `60 mana paid: ${grom.maxMana - grom.mana}`);
  assert.ok(grom.skillCd[1] > 12.5 && grom.skillCd[1] <= 13);
  // Shockwave slows 40% for 1.5 s
  grom.castSkill(0, mira);
  assert.ok(Math.abs(mira.cc.slowPct - 0.4) < 1e-9);
  assert.ok(mira.cc.t.slow > 1.45 && mira.cc.t.slow <= 1.5);
});

T.test('Grom: Earthsplitter channels 0.9 s, then drags everyone within 320 toward him and launches them 0.9 s', () => {
  reset();
  T.place(grom, open.x, open.y);
  T.place(mira, open.x + 280, open.y);
  T.place(tide, open.x - 250, open.y + 100);
  T.place(sylva, open.x + 600, open.y);
  assert.ok(grom.castSkill(2, mira));
  assert.ok(grom.channelS && Math.abs(grom.channelS.t - 0.9) < 1e-9, 'channel 0.9 s');
  assert.equal(grom.mana, grom.maxMana - 110);
  assert.equal(grom.skillCd[2], 38, 'rank-3 cooldown');
  // rooted and silent while channelling: a step input does nothing, a cast is refused
  grom.moveToward(grom.x + 300, grom.y, 1 / 60);
  assert.equal(grom.x, open.x);
  assert.equal(grom.castSkill(0, mira), false);
  T.frames(G, 30);   // 0.5 s: still channelling, nothing landed
  assert.ok(grom.channelS);
  assert.equal(mira.hp, mira.maxHp);
  T.frames(G, 26);   // past 0.9 s
  assert.equal(grom.channelS, null);
  assert.ok(mira.hp < mira.maxHp && tide.hp < tide.maxHp, 'both inside 320 were hit');
  assert.equal(sylva.hp, sylva.maxHp, 'outside 320 was not');
  assert.ok(mira.cc.t.airborne > 0.8, `airborne 0.9 (ignores tenacity): ${mira.cc.t.airborne}`);
  assert.ok(mira.forced && mira.forced.mode === 'slide', 'pull tween running');
  T.frames(G, 20);   // the 0.3 s pull finishes
  assert.ok(mira.x < open.x + 280 - 120, `dragged ~140 toward Grom: ${open.x + 280 - mira.x}`);
  assert.ok(tide.x > open.x - 250 + 100, `dragged from the other side too: ${tide.x - (open.x - 250)}`);
});

T.test('Grom: a stun interrupts the channel (mana kept, cooldown halved); a slow or root does not', () => {
  reset();
  T.place(grom, open.x, open.y);
  T.place(mira, open.x + 200, open.y);
  assert.ok(grom.castSkill(2, mira));
  grom.cc.applySlow(0.4, 1, 0);
  grom.cc.apply('immobilize', 1, 0);
  G.update(1 / 60);
  assert.ok(grom.channelS, 'slow and root do not break it');
  grom.cc.apply('stun', 0.3, 0);
  assert.equal(grom.channelS, null, 'stun breaks it');
  assert.equal(grom.skillCd[2], 19, 'half of the rank-3 cooldown');
  assert.ok(grom.mana < grom.maxMana - 110 + 1, 'mana is not refunded (a frame of regen aside)');
  T.seconds(G, 1);
  assert.equal(mira.hp, mira.maxHp, 'the payload never landed');
  // silence too
  reset();
  T.place(grom, open.x, open.y); T.place(mira, open.x + 200, open.y);
  grom.castSkill(2, mira);
  grom.cc.apply('silence', 0.3, 0);
  assert.equal(grom.channelS, null);
});

T.test('Grom bot: Earthsplitter only with 2+ enemy heroes within 320, never below 25% HP, not while an enemy stun is ready', () => {
  reset();
  T.place(grom, open.x, open.y);
  T.place(sylva, open.x + 200, open.y);          // her only hard CC is a root, which does not break a channel
  T.place(mira, open.x + 250, open.y + 50);      // Glacial Prison stuns
  mira.skillCd = [0, 0, 99];
  const d = grom.distTo(sylva);
  assert.equal(grom.botSkillUrgency(2, sylva, d, true, false), 860, 'two enemies inside, no stun ready');
  mira.skillCd[2] = 0;
  assert.equal(grom.botSkillUrgency(2, sylva, d, true, false), 0, 'Mira could interrupt');
  mira.cc.apply('stun', 1, 0);
  assert.equal(grom.botSkillUrgency(2, sylva, d, true, false), 860, 'a stunned Mira cannot');
  mira.cc.clear();
  T.place(mira, FAR.x, FAR.y);
  assert.equal(grom.botSkillUrgency(2, sylva, d, true, false), 0, 'one enemy is not a crowd');
  T.place(mira, open.x + 250, open.y + 50); mira.skillCd[2] = 99;
  grom.hp = grom.maxHp * 0.2;
  assert.equal(grom.botSkillUrgency(2, sylva, d, true, false), 0, 'never below 25% HP');
});

T.test('Grom bot: Bull Charge goes at the lowest-HP ranged hero it can reach', () => {
  reset();
  T.place(grom, open.x, open.y);
  T.place(tide, open.x + 200, open.y);           // melee, closest
  T.place(mira, open.x + 350, open.y + 60);      // ranged
  T.place(sylva, open.x + 380, open.y - 60);     // ranged, lowest HP
  sylva.hp = sylva.maxHp * 0.5;
  assert.equal(grom.dashPick(grom.skills[1], tide), sylva);
  T.place(sylva, FAR.x, FAR.y);
  assert.equal(grom.dashPick(grom.skills[1], tide), mira);
  T.place(mira, FAR.x, FAR.y);
  assert.equal(grom.dashPick(grom.skills[1], tide), tide, 'no ranged hero in reach: the target itself');
});

T.done();
