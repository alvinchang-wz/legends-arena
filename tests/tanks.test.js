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

/* ---------------- Bastion ---------------- */

T.test('Bastion: base stats and skill numbers match the spec', () => {
  const d = bastion.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [740, 100, 240, 26, 52, 5.4, 24, 3.8, 17, 2.6, 88, 0.80, 248, 2]);
  const [s1, s2, s3] = d.skills;
  assert.deepEqual([s1.type, s1.cd, s1.mana, s1.radius, s1.dmg, s1.dmgLv, s1.scaleAd, s1.stun], ['nova', 8, 50, 230, 110, 14, 0.45, 0.6]);
  assert.deepEqual([s2.type, s2.cd, s2.mana, s2.length, s2.offset, s2.dur], ['barrier', 16, 70, 260, 90, 3.0]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.radius, s3.dmg, s3.dmgLv, s3.scaleAd, s3.knockback, s3.slowPct, s3.slowDur],
    ['nova', [40, 36, 32], 105, 320, 200, 28, 0.5, 70, 0.5, 1.5]);
  assert.equal(rankVal(s3, 'dmg', 3), 256);
  assert.equal(rankVal(s3, 'cd', 2), 36);
});

T.test('Bastion: Rampart shields allied heroes within 420 (himself included) for 8% of his max HP every 8 s', () => {
  reset();
  T.place(bastion, open.x, open.y);
  T.place(mira, open.x + 300, open.y);
  T.place(tide, open.x + 600, open.y);
  T.place(grom, open.x + 200, open.y);   // an enemy
  bastion.pv.t = 0.05;
  T.frames(G, 4);
  assert.equal(bastion.shields.length, 1, 'self');
  assert.equal(mira.shields.length, 1, 'ally within 420');
  assert.equal(tide.shields.length, 0, 'ally outside 420');
  assert.equal(grom.shields.length, 0, 'enemy');
  assert.ok(Math.abs(mira.shields[0].amount - bastion.maxHp * 0.08) < 1, `8% of Bastion's max HP: ${mira.shields[0].amount}`);
  assert.ok(mira.shields[0].t > 2.9 && mira.shields[0].t <= 3, 'for 3 s');
  assert.ok(bastion.pv.t > 7.8, 'next pulse in 8 s');
});

T.test('Bastion: Portcullis stuns 0.6 s around him; Hold the Line shoves 70 outward and slows 50% for 1.5 s', () => {
  reset();
  T.place(bastion, open.x, open.y);
  T.place(grom, open.x + 180, open.y);
  T.place(nyx, open.x - 280, open.y);
  T.place(zephyr, open.x + 400, open.y);
  assert.ok(bastion.castSkill(0, grom));
  const expectStun = 0.6 * (1 - Math.min(0.6, grom.attrs.get('tenacity')));   // Grom's emblem carries tenacity
  assert.ok(Math.abs(grom.cc.t.stun - expectStun) < 1e-6, `stun 0.6 before tenacity: ${grom.cc.t.stun} vs ${expectStun}`);
  assert.ok(grom.hp < grom.maxHp);
  assert.equal(nyx.cc.t.stun, 0, 'outside 230');
  assert.ok(bastion.castSkill(2, grom));
  assert.ok(nyx.hp < nyx.maxHp, 'inside 320');
  assert.equal(zephyr.hp, zephyr.maxHp, 'outside 320');
  assert.ok(Math.abs(nyx.cc.slowPct - 0.5) < 1e-9 && nyx.cc.t.slow > 1.45);
  assert.ok(nyx.forced && nyx.forced.mode === 'slide' && Math.abs(nyx.forced.dist - 70) < 1e-9, 'a 70 tween');
  T.frames(G, 20);
  assert.ok(nyx.x < open.x - 280 - 55, `pushed away on his side: ${open.x - 280 - nyx.x}`);
  assert.ok(grom.x > open.x + 180 + 55, `and on the other: ${grom.x - (open.x + 180)}`);
  assert.ok(bastion.mana < bastion.maxMana - 155 + 2, '50 + 105 mana paid');
  assert.ok(bastion.skillCd[2] > 31.5 && bastion.skillCd[2] <= 32, `rank-3 cooldown 32 (a third of a second in): ${bastion.skillCd[2]}`);
});

T.test('Bastion: Gatehouse is a fixed 260 gate 90 ahead for 3 s that deletes enemy skillshots and arrows, not novas or units', () => {
  reset();
  T.place(bastion, open.x, open.y);
  T.place(zephyr, open.x + 500, open.y);   // enemy marksman behind the gate line
  T.place(mira, open.x - 150, open.y);     // the ally he stands in front of
  assert.ok(bastion.castSkill(1, zephyr));
  const gate = G.objects.find(o => o.owner === bastion && !o.dead);
  assert.ok(gate && gate.mode === 'barrier');
  assert.ok(Math.abs(gate.x - (open.x + 90)) < 1e-6 && Math.abs(gate.y - open.y) < 1e-6, 'centred 90 ahead');
  assert.ok(Math.abs(Math.hypot(gate.bx - gate.ax, gate.by - gate.ay) - 260) < 1e-6, '260 long');
  assert.ok(gate.t > 2.9 && gate.t <= 3, 'lasts 3 s');
  // an enemy skillshot and an enemy arrow both die on the gate
  const hp0 = mira.hp, bhp0 = bastion.hp;
  assert.ok(zephyr.castSkill(0, mira));
  zephyr.curTarget = bastion; zephyr.atkCd = 0; zephyr.tryAttack(bastion);
  assert.ok(G.projectiles.length >= 2, `a bolt and an arrow in flight: ${G.projectiles.length}`);
  T.seconds(G, 1.2);
  assert.equal(mira.hp, hp0, 'the bolt never crossed');
  assert.equal(bastion.hp, bhp0, 'nor the arrow');
  assert.equal(G.projectiles.filter(p => !p.dead).length, 0);
  // the gate is fixed: Bastion walking away leaves it where it was
  T.place(bastion, open.x - 400, open.y);
  G.update(1 / 60);
  assert.ok(Math.abs(gate.x - (open.x + 90)) < 1e-6);
  // an enemy nova goes through
  T.place(grom, open.x + 150, open.y + 40);
  T.place(bastion, open.x, open.y);
  const b1 = bastion.hp;
  assert.ok(grom.castSkill(0, bastion));
  assert.ok(bastion.hp < b1, 'Shockwave (a nova) ignores the gate');
  T.seconds(G, 2);
  assert.ok(gate.dead, 'expired');
});

T.test('Bastion bot: Gatehouse goes up against a ranged enemy within 700 who is on an ally, whatever his own target is', () => {
  reset();
  T.place(bastion, open.x, open.y);
  T.place(mira, open.x - 200, open.y);      // the carry he guards
  T.place(zephyr, open.x + 450, open.y);    // enemy marksman
  T.place(nyx, open.x + 300, open.y);       // enemy melee, his own target
  zephyr.curTarget = mira;
  assert.equal(bastion.barrierThreat(), zephyr);
  assert.equal(bastion.botSkillUrgency(1, nyx, bastion.distTo(nyx), true, false), 520, 'the archer aims at the ally');
  zephyr.curTarget = null;
  T.place(zephyr, open.x + 650, open.y);    // 850 from Mira, 650 from Bastion: attacking nobody in reach
  assert.equal(bastion.barrierThreat(), null, 'not threatening anyone');
  assert.equal(bastion.botSkillUrgency(1, nyx, bastion.distTo(nyx), true, false), 0);
  T.place(zephyr, open.x + 380, open.y);    // Bastion himself is now in her reach
  assert.equal(bastion.barrierThreat(), zephyr, 'an ally (himself) inside her range');
  T.place(zephyr, open.x + 750, open.y);
  zephyr.curTarget = mira;
  assert.equal(bastion.barrierThreat(), null, 'beyond 700');
  T.place(zephyr, FAR.x, FAR.y);
  assert.equal(bastion.botSkillUrgency(1, nyx, bastion.distTo(nyx), true, false), 0, 'a melee alone: nothing to block');
  // the gate is aimed at the archer, not at the melee target
  T.place(zephyr, open.x + 400, open.y + 400); zephyr.curTarget = mira;
  bastion.botFireSkill(1, nyx, bastion.distTo(nyx), true, false);
  const gate = G.objects.find(o => o.owner === bastion && !o.dead);
  assert.ok(gate);
  assert.ok(Math.abs(Math.atan2(gate.y - open.y, gate.x - open.x) - Math.PI / 4) < 1e-6, 'faces Zephyr');
});

/* ---------------- Marrow ---------------- */

T.test('Marrow: an HP hero with no mana bar; base stats and skill numbers match the spec', () => {
  const d = marrow.def0;
  assert.equal(d.resource, 'hp'); assert.equal(d.hpFloor, 0);
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [750, 102, 0, 0, 50, 5.2, 19, 3.0, 20, 3.0, 85, 0.78, 244, 3]);
  assert.equal(marrow.resource, 'hp');
  assert.equal(marrow.maxMana, 0, 'no mana pool');
  const [s1, s2, s3] = d.skills;
  assert.deepEqual([s1.type, s1.cd, s1.hpCost, s1.mana, s1.radius, s1.dmgType, s1.dmg, s1.dmgLv, s1.scaleAd, s1.slowPct, s1.slowDur], ['nova', 6, 0.06, undefined, 220, 'magic', 120, 15, 0.55, 0.35, 1.5]);
  assert.deepEqual([s2.type, s2.cd, s2.hpCost, s2.heal, s2.healLv, s2.scaleAp, s2.radius, s2.shieldPct], ['heal', 12, 0.08, 100, 16, 0.35, 300, undefined]);
  assert.deepEqual([s3.type, s3.cd, s3.hpCost, s3.range, s3.radius, s3.delay, s3.dmg, s3.scaleAd, s3.airborne, s3.bank],
    ['zone', [42, 38, 34], 0.1, 480, 240, 0.7, [240, 275, 310], 0.7, 0.8, { window: 6, pct: 1.0, capMaxHpPct: 0.2 }]);
  assert.equal(rankVal(s2, 'heal', 6), 180);
  assert.equal(rankVal(s3, 'dmg', 2), 275);
  assert.equal(marrow.gainMana(50), undefined); assert.equal(marrow.mana, 0, 'mana refunds give him nothing');
});

T.test('Marrow: every cast costs a slice of max HP after the effect, never lethal; Ribcage slows, Splint heals the team', () => {
  reset();
  T.place(marrow, open.x, open.y);
  T.place(bastion, open.x + 150, open.y);
  T.place(zephyr, open.x - 200, open.y);
  zephyr.hp = zephyr.maxHp * 0.5;
  const hp0 = marrow.hp = marrow.maxHp;
  assert.ok(marrow.canAfford(marrow.skills[0], 6));
  assert.ok(marrow.castSkill(0, bastion));
  assert.ok(bastion.hp < bastion.maxHp && Math.abs(bastion.cc.slowPct - 0.35) < 1e-9, 'Ribcage lands and slows 35%');
  assert.equal(marrow.hp, hp0 - Math.floor(marrow.maxHp * 0.06), '6% max HP paid');
  assert.equal(marrow.pv.bank.length, 1, 'banked');
  assert.equal(marrow.pv.bank[0].amt, Math.floor(marrow.maxHp * 0.06));
  const z0 = zephyr.hp, m1 = marrow.hp;
  assert.ok(marrow.castSkill(1, null));
  const heal = 100 + 16 * 5 + marrow.magicPower() * 0.35;
  assert.ok(Math.abs(zephyr.hp - (z0 + heal)) < 1, `ally healed ${zephyr.hp - z0} (expected ${heal})`);
  assert.equal(zephyr.shields.length, 0, 'no shield on Splint');
  assert.ok(Math.abs(marrow.hp - (Math.min(marrow.maxHp, m1 + heal) - Math.floor(marrow.maxHp * 0.08))) < 1, 'healed himself (to the cap), then paid 8%');
  assert.equal(marrow.pv.bank.length, 2);
  // never lethal: at 3 HP a 10% cost leaves 1
  marrow.hp = 3;
  assert.ok(marrow.canAfford(marrow.skills[2], 3), 'hpFloor 0: castable at any HP');
  assert.ok(marrow.castSkill(2, bastion));
  assert.equal(marrow.hp, 1);
  assert.ok(marrow.alive);
  assert.equal(marrow.pv.bank.length, 3);
  G.zones.length = 0;
});

T.test('Marrow: Catacomb launches 0.8 s after a 0.7 s telegraph and adds the HP paid in the last 6 s, capped at 20% max HP', () => {
  reset();
  T.place(marrow, open.x, open.y);
  T.place(bastion, open.x + 300, open.y);
  T.place(tide, open.x + 300, open.y + 60);
  marrow.hp = marrow.maxHp;
  const s3 = marrow.skills[2];
  // no bank: the zone's damage is the plain rank-3 number
  const plain = 310 + marrow.curAtk() * 0.7;
  assert.ok(Math.abs(marrow.skillDmg(s3, 3) - plain) < 1e-6);
  // two casts just before: 6% + 8% banked, then the ult's own 10% -> 24% capped at 20%
  marrow.castSkill(0, bastion); marrow.castSkill(1, null);
  assert.ok(marrow.castSkill(2, { x: open.x + 300, y: open.y }));
  const cap = marrow.maxHp * 0.2;
  const paid = marrow.pv.bank.reduce((a, e) => a + e.amt, 0);
  assert.ok(paid > cap, `24% paid (${paid}) exceeds the 20% cap (${cap})`);
  assert.ok(Math.abs(marrow.skillDmg(s3, 3) - (plain + cap)) < 1e-6, `banked bonus at the cap: ${marrow.skillDmg(s3, 3) - plain} vs ${cap}`);
  assert.equal(G.zones.length, 1);
  T.frames(G, 30);   // 0.5 s: still winding up
  assert.equal(bastion.hp, bastion.maxHp);
  T.frames(G, 15);   // past 0.7 s
  assert.ok(bastion.hp < bastion.maxHp && tide.hp < tide.maxHp, 'both launched');
  assert.ok(bastion.cc.t.airborne > 0.7 && bastion.cc.t.airborne <= 0.8, `airborne 0.8: ${bastion.cc.t.airborne}`);
  // the bank forgets after 6 s
  marrow.pv.bank[0].t -= 7; marrow.pv.bank[1].t -= 7; marrow.pv.bank[2].t -= 7;
  assert.ok(Math.abs(marrow.skillDmg(s3, 3) - plain) < 1e-6, 'nothing banked in the window');
  assert.ok(marrow.skillCd[2] > 33 && marrow.skillCd[2] <= 34, 'rank-3 cooldown 34');
});

T.test('Marrow: Ossify reduces damage linearly from 0% at full HP to 25% at or below 25% HP, never true damage', () => {
  reset();
  T.place(marrow, open.x, open.y);
  T.place(bastion, open.x + 100, open.y);
  /* the target-side hook resolveDamage calls after mitigation, fed 100 post-mitigation damage */
  const hit = (hpPct, type) => {
    marrow.hp = marrow.maxHp * hpPct;
    return marrow.onIncomingDamage(bastion, 100, { amount: 100, type, noPassive: true, lifestealMult: 0 });
  };
  assert.ok(Math.abs(hit(1.0, 'magic') - 100) < 1e-9, 'full HP: no reduction');
  assert.ok(Math.abs(hit(0.625, 'magic') - 87.5) < 1e-9, 'halfway down the band: 12.5%');
  assert.ok(Math.abs(hit(0.25, 'magic') - 75) < 1e-9, '25% HP: 25%');
  assert.ok(Math.abs(hit(0.05, 'physical') - 75) < 1e-9, 'below 25% HP stays at 25%');
  assert.ok(Math.abs(hit(0.05, 'true') - 100) < 1e-9, 'true damage is not reduced');
});

T.test('Marrow bot: never Ribcage below 20% HP; Splint when an ally within 300 is under 60%; Catacomb wants 2+ heroes in it, best after two casts', () => {
  reset();
  T.place(marrow, open.x, open.y);
  T.place(bastion, open.x + 150, open.y);
  T.place(tide, open.x + 200, open.y + 60);
  T.place(zephyr, open.x - 200, open.y);
  const d = marrow.distTo(bastion);
  assert.ok(marrow.botSkillUrgency(0, bastion, d, true, false) > 0, 'Ribcage on a hero in reach');
  marrow.hp = marrow.maxHp * 0.15;
  assert.equal(marrow.botSkillUrgency(0, bastion, d, true, false), 0, 'not below 20% HP');
  marrow.hp = marrow.maxHp;
  zephyr.hp = zephyr.maxHp * 0.65;
  assert.equal(marrow.botSkillUrgency(1, bastion, d, true, false), 0, 'ally at 65%: no Splint');
  zephyr.hp = zephyr.maxHp * 0.55;
  assert.equal(marrow.botSkillUrgency(1, bastion, d, true, false), 900, 'ally under 60%');
  T.place(zephyr, open.x - 400, open.y);
  assert.equal(marrow.botSkillUrgency(1, bastion, d, true, false), 0, 'ally outside 300');
  // Catacomb: two heroes in its 240 -> 720, and 880 within 6 s of two other casts
  marrow.pv.bank.length = 0;
  assert.equal(marrow.botSkillUrgency(2, bastion, d, true, false), 720);
  marrow.castSkill(0, bastion); marrow.castSkill(1, null);
  assert.equal(marrow.botSkillUrgency(2, bastion, d, true, false), 880, 'two casts banked');
  T.place(tide, FAR.x, FAR.y);
  assert.equal(marrow.botSkillUrgency(2, bastion, d, true, false), 0, 'one healthy hero is not enough');
  bastion.hp = bastion.maxHp * 0.3;
  assert.equal(marrow.botSkillUrgency(2, bastion, d, true, false), 880, 'unless it is an execute');
});

/* ---------------- Anchor ---------------- */

T.test('Anchor: base stats and skill numbers match the spec', () => {
  const d = anchor.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [730, 98, 220, 24, 54, 5.8, 23, 3.3, 16, 2.5, 102, 0.84, 241, 2]);
  const [s1, s2, s3] = d.skills;
  assert.deepEqual([s1.type, s1.cd, s1.mana, s1.dmg, s1.dmgLv, s1.scaleAd, s1.range, s1.speed, s1.radius, s1.pierce], ['skillshot', 12, 60, 90, 12, 0.4, 580, 760, 26, false]);
  assert.deepEqual(s1.tether, { dur: 2.0, breakRange: 560, slowStart: 0.25, slowEnd: 0.5, payload: { dmg: 130, dmgLv: 16, scaleAd: 0.5, immobilize: 1.3 } });
  assert.deepEqual([s2.type, s2.cd, s2.mana, s2.dur, s2.selfRoot, s2.ccImmune, s2.armorAdd, s2.mrAdd, s2.tetherSlowMult, s2.recastCancel],
    ['selfState', 11, 50, 1.5, true, ['slow', 'displacement'], 20, 20, 2.0, true]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.radius, s3.dmg, s3.dmgLv, s3.scaleAd, s3.slowPct, s3.slowDur], ['nova', [40, 36, 32], 105, 320, 230, 32, 0.55, 0.55, 2.0]);
  assert.equal(rankVal(s1.tether.payload, 'dmg', 6), 210);
  assert.equal(rankVal(s3, 'dmg', 3), 294);
});

T.test('Anchor: Hawser hits, ties the hero to him for 2 s with a 25% -> 50% slow, then roots 1.3 s and strikes again', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(zephyr, open.x + 300, open.y);
  assert.ok(anchor.castSkill(0, zephyr));
  assert.ok(anchor.mana < anchor.maxMana - 60 + 1);
  T.frames(G, 30);   // 0.5 s: the line (760 u/s) has reached her
  assert.ok(zephyr.hp < zephyr.maxHp, 'hit damage');
  const tt = anchor.liveTether();
  assert.ok(tt && tt.target === zephyr, 'tethered');
  assert.equal(tt.breakRange, 560);
  assert.ok(tt.dur === 2.0);
  assert.ok(zephyr.cc.slowPct >= 0.25 && zephyr.cc.slowPct < 0.35, `slow starts at 25%: ${zephyr.cc.slowPct}`);
  const hpMid = zephyr.hp;
  T.frames(G, 60);   // 1 s in
  assert.ok(zephyr.cc.slowPct > 0.35 && zephyr.cc.slowPct < 0.5, `ramps toward 50%: ${zephyr.cc.slowPct}`);
  assert.ok(zephyr.hp >= hpMid - 1, 'no tick damage on the line (regen aside)');
  T.frames(G, 70);   // past 2 s
  assert.equal(anchor.liveTether(), null, 'completed');
  assert.ok(zephyr.hp < hpMid - 100, 'completion strike');
  assert.ok(zephyr.cc.t.immobilize > 0.8, `rooted 1.3 s (tenacity and the frames since completion aside): ${zephyr.cc.t.immobilize}`);
  assert.ok(anchor.skillCd[0] > 9 && anchor.skillCd[0] <= 12);
});

T.test('Anchor: the line snaps past 560, when Anchor is stunned, and a creep on the line blocks it (hit, no tether)', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(zephyr, open.x + 300, open.y);
  anchor.castSkill(0, zephyr);
  T.frames(G, 30);
  assert.ok(anchor.liveTether());
  T.place(zephyr, open.x + 600, open.y);
  G.update(1 / 60);
  assert.equal(anchor.liveTether(), null, 'snapped past 560');
  assert.ok(!zephyr.cc.has('immobilize'), 'no root on a snap');
  // a stun on Anchor cuts it
  reset();
  T.place(anchor, open.x, open.y); T.place(zephyr, open.x + 300, open.y);
  anchor.castSkill(0, zephyr);
  T.frames(G, 30);
  anchor.cc.apply('stun', 0.5, 0);
  G.update(1 / 60);
  assert.equal(anchor.liveTether(), null, 'a hard CC on Anchor cuts the line');
  anchor.cc.clear();
  // a creep on the line takes the hit; no tether
  reset();
  T.place(anchor, open.x, open.y); T.place(zephyr, open.x + 300, open.y);
  const m = new sim.context.Minion(0, 'mid', 'melee');
  T.place(m, open.x + 150, open.y);
  G.minions.push(m);
  const mhp = m.hp;
  assert.ok(anchor.lineBlocked(zephyr, anchor.skills[0]), 'the bot sees the creep on the line');
  anchor.castSkill(0, zephyr);
  T.frames(G, 30);
  assert.ok(m.hp < mhp, 'the creep took the line');
  assert.equal(zephyr.hp, zephyr.maxHp, 'Zephyr did not');
  assert.equal(anchor.liveTether(), null, 'no tether on a creep');
  m.alive = false; G.minions.splice(G.minions.indexOf(m), 1);
});

T.test('Anchor: Deadweight adds 15% to skill hits on slowed, rooted, stunned or airborne enemies', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(zephyr, open.x + 200, open.y);
  const pkt = { skill: anchor.skills[2] };
  assert.equal(anchor.onDealDamage(zephyr, 100, pkt), 100);
  zephyr.cc.apply('airborne', 0.5, 0);
  assert.ok(Math.abs(anchor.onDealDamage(zephyr, 100, pkt) - 115) < 1e-9, 'airborne');
  zephyr.cc.clear(); zephyr.cc.applySlow(0.3, 1, 0);
  assert.ok(Math.abs(anchor.onDealDamage(zephyr, 100, pkt) - 115) < 1e-9, 'slowed');
  zephyr.cc.clear();
  assert.equal(anchor.onDealDamage(zephyr, 100, { isBasic: true }), 100, 'basics never');
});

T.test('Anchor: Weigh Anchor roots him 1.5 s, refuses slows, shoves, pulls and hooks, adds 20 armor / 20 MR, doubles a live tether slow to 80%, and a recast ends it', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(zephyr, open.x + 300, open.y);
  T.place(grom, open.x - 200, open.y);
  const armor0 = anchor.armorValue(), mr0 = anchor.mrValue();
  anchor.castSkill(0, zephyr);
  T.frames(G, 30);
  assert.ok(anchor.liveTether());
  assert.ok(anchor.castSkill(1, null));
  assert.ok(anchor.state && Math.abs(anchor.state.t - 1.5) < 1e-9);
  assert.equal(anchor.armorValue(), armor0 + 20); assert.equal(anchor.mrValue(), mr0 + 20);
  anchor.moveToward(anchor.x - 200, anchor.y, 1 / 60);
  assert.equal(anchor.x, open.x, 'self-rooted');
  assert.equal(anchor.cc.applySlow(0.5, 2, 0), 0, 'slow refused');
  assert.equal(grom.castSkill(1, anchor), true);   // Bull Charge: stun + shove
  T.seconds(G, 0.4);
  assert.ok(anchor.cc.has('stun') || anchor.cc.t.stun === 0, 'stuns still apply (or already ran out)');
  assert.equal(anchor.x, open.x, 'the shove was refused');
  assert.equal(anchor.y, open.y);
  // a hook (Karn's) does not drag him either
  const hook = sim.context.Projectile.skillshot(grom, { type: 'skillshot', range: 600, speed: 800, radius: 28, hook: true, dmg: 1, dmgType: 'physical' }, { x: 1, y: 0 });
  hook.x = anchor.x - 30; hook.y = anchor.y; hook.rank = 1;
  G.projectiles.push(hook);
  anchor.cc.clear();
  G.update(1 / 60);
  assert.ok(!anchor.forced || anchor.forced.mode !== 'hook', 'not hooked');
  assert.equal(anchor.liveTether(), null, 'the stun on Anchor had cut his own line');
  T.seconds(G, 1.2);
  assert.equal(anchor.state, null, 'expired after 1.5 s');
  assert.equal(anchor.armorValue(), armor0, 'the resists went with it');
});

T.test('Anchor: Weigh Anchor doubles the live Hawser slow (cap 80%) and a recast cancels it early', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(zephyr, open.x + 300, open.y);
  anchor.castSkill(0, zephyr);
  T.frames(G, 30);
  const tt = anchor.liveTether();
  assert.ok(tt);
  T.frames(G, 60);   // ~1.5 s in: base slow ~0.44
  const base = zephyr.cc.slowPct;
  assert.ok(base > 0.4 && base < 0.5, `base ${base}`);
  assert.ok(anchor.castSkill(1, null));
  G.update(1 / 60);
  assert.ok(Math.abs(zephyr.cc.slowPct - Math.min(0.8, base * 2)) < 0.03, `doubled: ${zephyr.cc.slowPct}`);
  T.frames(G, 25);   // the line completes at 2 s with the slow at 50% x 2 = 100% -> capped 80%
  assert.ok(anchor.state, 'state still up');
  assert.ok(anchor.castSkill(1, null), 'recast to cancel');
  assert.equal(anchor.state, null);
  assert.ok(anchor.skillCd[1] > 0, 'the cooldown from the first cast stands');
});

T.test('Anchor: Harbour slows everyone within 320 by 55% for 2 s', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(zephyr, open.x + 300, open.y);
  T.place(nyx, open.x - 250, open.y + 100);
  T.place(ignis, open.x + 420, open.y);
  assert.ok(anchor.castSkill(2, zephyr));
  assert.ok(zephyr.hp < zephyr.maxHp && nyx.hp < nyx.maxHp);
  assert.equal(ignis.hp, ignis.maxHp, 'outside 320');
  assert.ok(Math.abs(zephyr.cc.slowPct - 0.55) < 1e-9 && zephyr.cc.t.slow > 1.9, `55% for 2 s: ${zephyr.cc.slowPct} / ${zephyr.cc.t.slow}`);
  assert.equal(anchor.skillCd[2], 32);
});

T.test('Anchor bot: Hawser only at a hero inside 500 on a clear line, one at a time, at the most mobile hero; Weigh Anchor when the tethered target is slowed inside 400; Harbour when it slips', () => {
  reset();
  T.place(anchor, open.x, open.y);
  T.place(ignis, open.x + 300, open.y);       // no dash
  T.place(nyx, open.x + 350, open.y + 200);   // dash + blinkstrike
  const s1 = anchor.skills[0];
  assert.equal(anchor.tetherPick(s1, ignis), nyx, 'the hero with the most dashes');
  assert.equal(anchor.botSkillUrgency(0, ignis, anchor.distTo(ignis), true, false), 820);
  T.place(nyx, FAR.x, FAR.y);
  assert.equal(anchor.tetherPick(s1, ignis), ignis);
  T.place(ignis, open.x + 540, open.y);
  assert.equal(anchor.botSkillUrgency(0, ignis, anchor.distTo(ignis), true, false), 0, 'beyond 500');
  T.place(ignis, open.x + 300, open.y);
  const m = new sim.context.Minion(0, 'mid', 'melee');
  T.place(m, open.x + 150, open.y); G.minions.push(m);
  assert.equal(anchor.botSkillUrgency(0, ignis, anchor.distTo(ignis), true, false), 0, 'a creep on the line');
  G.minions.splice(G.minions.indexOf(m), 1);
  assert.equal(anchor.botSkillUrgency(1, ignis, anchor.distTo(ignis), true, false), 0, 'no tether: no Weigh Anchor');
  anchor.castSkill(0, ignis);
  T.frames(G, 30);
  assert.ok(anchor.liveTether());
  anchor.skillCd[0] = 0;
  assert.equal(anchor.botSkillUrgency(0, ignis, anchor.distTo(ignis), true, false), 0, 'one line at a time');
  assert.equal(anchor.botSkillUrgency(1, ignis, anchor.distTo(ignis), true, false), 760, 'tethered, slowed, inside 400');
  T.place(ignis, open.x + 450, open.y);
  assert.equal(anchor.botSkillUrgency(1, ignis, anchor.distTo(ignis), true, false), 0, 'outside 400');
  // Harbour on a tethered target slipping away: inside 320, past half the break range and moving out
  T.place(ignis, open.x + 330, open.y);
  ignis.vx = 200; ignis.vy = 0;
  assert.ok(anchor.liveTether(), 'still tied');
  assert.ok(anchor.tetherEscaping(320));
  assert.equal(anchor.botSkillUrgency(2, ignis, anchor.distTo(ignis), true, false), 880, 'Harbour to keep him');
  ignis.vx = -200;
  assert.ok(!anchor.tetherEscaping(320), 'walking back in is not escaping');
});

T.done();
