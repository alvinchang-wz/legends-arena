'use strict';
/* The four Assassin and four Support kits (docs/design/heroes.md, "Assassins"
   and "Supports"; docs/design/hero-kits.json): Nyx, Wraith, Sable, Rook,
   Wick, Bell, Sylva, Pact — base stats and skill numbers, the engine
   behaviour each signature mechanic leans on, and the bot rules from their
   bot hints. */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim({ blueLineup: 'rook,nyx,wick,bell,grom', redLineup: 'wraith,sable,sylva,pact,bastion' });
const G = sim.Game;
const { rankVal, markStacks: markStacksAt } = require('../js/combat');
const { Hero, Projectile } = sim.context;
T.parkAll(G);

const rook = T.maxSkills(T.hero(G, 'rook', 0));
const nyx = T.maxSkills(T.hero(G, 'nyx', 0));
const wick = T.maxSkills(T.hero(G, 'wick', 0));
const bell = T.maxSkills(T.hero(G, 'bell', 0));
const grom = T.maxSkills(T.hero(G, 'grom', 0));
const wraith = T.maxSkills(T.hero(G, 'wraith', 1));
const sable = T.maxSkills(T.hero(G, 'sable', 1));
const sylva = T.maxSkills(T.hero(G, 'sylva', 1));
const pact = T.maxSkills(T.hero(G, 'pact', 1));
const bastion = T.maxSkills(T.hero(G, 'bastion', 1));
const ALL = [rook, nyx, wick, bell, grom, wraith, sable, sylva, pact, bastion];
const open = T.openSpot(G, 420);
const FAR = { x: open.x + 2200, y: open.y + 2200 };

function reset() {
  for (const h of ALL) {
    T.place(h, FAR.x, FAR.y);
    h.items.length = 0; h.gold = 0;
    h.hp = h.maxHp; h.mana = h.resource === 'heat' ? 0 : h.maxMana;
    h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.markTags = []; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.shields = []; h.untargetable = false; h.hot = null; h.buffAtkT = 0; h.buffAsT = 0; h.buffAsMult = 1; h.buffState = null;
    h.basicMod = null; h.basicRangeState = null; h.recast = null; h.aiTarget = null; h.aiState = 'push'; h.fleeT = 0;
    h.lastTakedownT = -99; h.lastKillT = -99; h.lastDmgT = -99; h.lastHurtT = -99; h.stats.dmgTaken = 0; h.stats.healDone = 0; h.stillT = 0;
    h.skillCharges = [0, 0, 0]; h.skillRecharge = [0, 0, 0]; h.revealT = 0; h.concealT = 0; h.lastTetherDone = null;
    h.recentDmg = []; h.vx = 0; h.vy = 0;
    if (h.pv && h.pv.until !== undefined) h.pv.until = 0;
    if (h.pv && h.pv.t !== undefined && h.pv.vamp !== undefined) { h.pv.vamp = 0; h.pv.t = 0; }
    h.recalcStats(false);
    h.hp = h.maxHp;
  }
  G.projectiles.length = 0; G.tethers.length = 0; G.zones.length = 0; G.objects.length = 0;
  for (let k = G.minions.length - 1; k >= 0; k--) if (G.minions[k]._test) { G.minions[k].alive = false; G.minions.splice(k, 1); }
}
reset();
G.update(1 / 60);

/* A creep of `team` parked at (x, y) for the rest of the test (reset removes
   it): it still runs CC, shields and dots, but never walks its lane. */
function creep(team, x, y) {
  const m = new sim.context.Minion(team, 'mid', 'melee');
  m._test = true; T.place(m, x, y); G.minions.push(m);
  m.update = function (dt) { this.baseUpdate(dt); if (this.forced) this.updateForced(dt); };
  return m;
}
/* Fire one basic from `h` at `t` and let it land. */
function basic(h, t) {
  h.atkCd = 0;
  h.tryAttack(t);
  T.frames(G, 40);
}
/* An enemy skillshot flying from `from` at `to` (100 damage, 600 range at `speed`). */
function shotAt(from, to, speed = 800) {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const p = Projectile.skillshot(from, { type: 'skillshot', range: 600, speed, radius: 24, dmgType: 'magic', dmg: 100 }, { x: (to.x - from.x) / d, y: (to.y - from.y) / d });
  G.projectiles.push(p);
  return p;
}
/* Live stacks of a mark on a unit (combat.js markStacks reads the sim's clock). */
const markStacks = (u, tag) => (u.marks && u.marks[tag] > 0 && u.marks[tag + 'T'] > G.time) ? u.marks[tag] : 0;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''}: ${a} vs ${b}`);

/* ---------------- Nyx ---------------- */

T.test('Nyx: base stats and skill numbers match the spec (the execute assassin: target-missing-HP Deathmark with no CC, the only untargetable state)', () => {
  reset();
  const d = nyx.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [515, 68, 230, 25, 68, 8.0, 12, 2.0, 10, 1.6, 95, 1.15, 275, 3]);
  assert.equal(d.passive.id, 'backstab');
  const [s1, s2, s3] = nyx.skills;
  assert.deepEqual([s1.type, s1.dist, s1.speed, s1.dmgType, s1.dmg, s1.dmgLv, s1.scaleAd, s1.cd, s1.mana], ['dash', 340, 1100, 'physical', 130, 16, 0.7, 8, 45]);
  assert.equal(rankVal(s1, 'dmg', 6), 210);
  assert.deepEqual([s2.type, s2.dur, s2.untargetable, s2.speedPct, s2.noAttack, s2.cd, s2.mana], ['selfState', 0.8, true, 0.3, true, 12, 40]);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.range, s3.dmg, s3.dmgLv, s3.scaleAd, s3.missingPct, s3.missingPctLv, s3.missingCap, s3.physPenPct],
    ['blinkstrike', [42, 38, 34], 100, 500, 260, 40, 1.0, 0.2, 0.05, 400, 0.22]);
  assert.equal(rankVal(s3, 'dmg', 3), 340); near(rankVal(s3, 'missingPct', 3), 0.3, 1e-9, 'Deathmark missing share at rank 3');
  assert.ok(!s3.silence && !s3.stun, 'Deathmark carries no CC');
  for (const s of nyx.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Nyx: Shade Step makes her untargetable 0.8 s (+30% speed, no attacks or casts): skillshots fly through, novas skip her, nobody can see her, dots keep ticking', () => {
  reset();
  T.place(nyx, open.x, open.y);
  T.place(bastion, open.x + 120, open.y);
  const speed0 = nyx.curSpeed();
  assert.ok(nyx.castSkill(1, null));
  assert.ok(nyx.state && nyx.state.s.untargetable && Math.abs(nyx.state.t - 0.8) < 1e-9, 'the state runs 0.8 s');
  assert.equal(nyx.untargetable, true);
  near(nyx.curSpeed(), speed0 * 1.3, 1e-6, '+30% move speed');
  assert.equal(G.canSee(1, nyx), false, 'nobody can see her');
  assert.equal(nyx.castSkill(0, { x: nyx.x + 100, y: nyx.y }), false, 'cannot cast');
  const shot = shotAt(bastion, nyx, 2000);
  assert.ok(bastion.castSkill(0, null), 'Portcullis around her');
  T.frames(G, 12);
  assert.ok(!shot.hitSet.has(nyx), 'the skillshot flew through');
  assert.equal(nyx.stats.dmgTaken, 0, 'the nova skipped her');
  assert.ok(!nyx.cc.has('stun'), 'no stun landed');
  const hp0 = nyx.hp;
  nyx.addDot({ src: bastion, total: 120, dur: 1, type: 'true', color: '#fff', tag: 'test' });
  T.frames(G, 18);
  assert.ok(nyx.hp < hp0 - 10, `the dot kept ticking: ${hp0 - nyx.hp}`);
  T.seconds(G, 0.8);
  assert.equal(nyx.state, null, 'over');
  assert.equal(nyx.untargetable, false);
  assert.equal(G.canSee(1, nyx), true);
});

T.test('Nyx: Deathmark blinks behind the target and adds 20/25/30% of its missing HP (cap 400 vs non-heroes) behind 22% armor penetration, with no CC', () => {
  reset();
  const s3 = nyx.skills[2];
  T.place(nyx, open.x, open.y);
  T.place(bastion, open.x + 300, open.y);
  near(nyx.skillDmg(s3, 3, bastion), 340 + nyx.curAtk(), 1e-6, 'full HP: base only');
  assert.ok(nyx.castSkill(2, bastion));
  const full = bastion.stats.dmgTaken;
  assert.ok(full > 0 && nyx.distTo(bastion) < 120, 'blinked onto him and struck');
  assert.equal(bastion.cc.active, 0, 'no CC at all');
  reset();
  T.place(nyx, open.x, open.y);
  T.place(bastion, open.x + 300, open.y);
  bastion.hp = bastion.maxHp * 0.5;
  near(nyx.skillDmg(s3, 3, bastion), 340 + nyx.curAtk() + 0.3 * bastion.maxHp * 0.5, 1e-6, 'half HP: +30% of the missing HP');
  assert.ok(nyx.castSkill(2, bastion));
  assert.ok(bastion.stats.dmgTaken > full * 1.3, `the execute grows: ${bastion.stats.dmgTaken} vs ${full} at full HP`);
  // rank 1 reads 20%, rank 2 25% (of whatever is missing now, after the strike)
  const missing = bastion.maxHp - bastion.hp;
  near(nyx.skillDmg(s3, 1, bastion), 260 + nyx.curAtk() + 0.2 * missing, 1e-6, 'rank 1');
  near(nyx.skillDmg(s3, 2, bastion), 300 + nyx.curAtk() + 0.25 * missing, 1e-6, 'rank 2');
  // the cap against a creep or monster
  const mo = creep(1, open.x + 600, open.y);
  mo.maxHp = 3000; mo.hp = 1;
  near(nyx.skillDmg(s3, 3, mo), 340 + nyx.curAtk() + 400, 1e-6, 'capped at 400 vs a non-hero');
});

T.test('Nyx bot: Deathmark is held above 70% whatever the crowd and thrown under 50%; Shade Step goes through an incoming skillshot, closes the last 200 on a low hero who is leaving, and is her exit when the dash is down', () => {
  reset();
  T.place(nyx, open.x, open.y);
  T.place(rook, open.x - 60, open.y + 80); T.place(grom, open.x - 80, open.y - 60);
  T.place(bastion, open.x + 380, open.y);
  T.place(sable, open.x + 380, open.y + 150);   // 408 from her: inside the 420 crowd ring
  assert.equal(nyx.botSkillUrgency(2, bastion, 380, true, false), 0, 'a full-HP hero, even with two in reach: held');
  bastion.hp = bastion.maxHp * 0.75;
  assert.equal(nyx.botSkillUrgency(2, bastion, 380, true, false), 0, '75% with a crowd: never above 70%');
  bastion.hp = bastion.maxHp * 0.6;
  assert.equal(nyx.botSkillUrgency(2, bastion, 380, true, false), 540, '60% with a crowd: allowed');
  T.place(sable, FAR.x, FAR.y);
  assert.equal(nyx.botSkillUrgency(2, bastion, 380, true, false), 0, '60% alone: held for 50%');
  bastion.hp = bastion.maxHp * 0.45;
  assert.equal(nyx.botSkillUrgency(2, bastion, 380, true, false), 540, 'under 50%: thrown');
  bastion.hp = bastion.maxHp * 0.3;
  assert.equal(nyx.botSkillUrgency(2, bastion, 380, true, false), 870, 'under 35%: the execute');
  bastion.hp = bastion.maxHp;
  // Shade Step
  assert.equal(nyx.botSkillUrgency(1, bastion, 380, true, false), 0, 'nothing to dodge, nobody to chase: held');
  const shot = shotAt(bastion, nyx, 800);
  assert.equal(nyx.botSkillUrgency(1, bastion, 380, true, false), 820, 'a skillshot about to land: vanish');
  shot.dead = true; G.projectiles.length = 0;
  bastion.hp = bastion.maxHp * 0.4; bastion.vx = 240; bastion.vy = 0;   // walking away, low
  T.place(bastion, open.x + 300, open.y); bastion.vx = 240;
  assert.equal(nyx.botSkillUrgency(1, bastion, 300, true, false), 600, 'a low hero getting away inside 350: close the gap');
  bastion.vx = -240;
  assert.equal(nyx.botSkillUrgency(1, bastion, 300, true, false), 0, 'walking in: no need');
  bastion.vx = 0; bastion.hp = bastion.maxHp;
  nyx.hp = nyx.maxHp * 0.4;
  assert.equal(nyx.botSkillUrgency(1, bastion, 300, true, false), 760, 'she is low with him close: vanish');
  // the exit: retreating with the dash on cooldown, a chaser inside 500
  nyx.skillCd[0] = 5;
  nyx.botEscapeCast();
  assert.ok(nyx.state && nyx.state.s.untargetable, 'Shade Step cast to escape');
});

/* ---------------- Wraith ---------------- */

T.test('Wraith: base stats and skill numbers match the spec (the fast energy pool, the only basicRange state)', () => {
  reset();
  const d = wraith.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [500, 65, 0, 0, 66, 7.6, 11, 1.9, 9, 1.5, 90, 1.18, 280, 2]);
  assert.equal(d.resource, 'energy');
  assert.deepEqual([d.energy.max, d.energy.regen, d.energy.perBasic], [100, 8, 0]);
  assert.equal(d.passive.id, 'afterimage');
  const [s1, s2, s3] = wraith.skills;
  assert.deepEqual([s1.type, s1.cd, s1.energy, s1.dist, s1.speed, s1.dmg, s1.dmgLv, s1.scaleAd], ['dash', 5, 25, 360, 1200, 100, 14, 0.6]);
  assert.equal(rankVal(s1, 'dmg', 6), 170);
  assert.deepEqual([s2.type, s2.cd, s2.energy, s2.rangeSet, s2.count, s2.dur, s2.bonusDmg, s2.bonusDmgLv, s2.bonusScaleAd], ['basicRange', 8, 30, 300, 3, 4, 20, 3, 0.15]);
  assert.deepEqual([s3.type, s3.cd, s3.energy, s3.range, s3.dmg, s3.dmgLv, s3.scaleAd, s3.silence], ['blinkstrike', [30, 27, 24], 40, 460, 240, 40, 0.85, 0.5]);
  for (const s of wraith.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Wraith: energy is a flat 100 whatever the level, regenerates 8/s, ignores mana refunds; Phase Cut costs 25 and is refused short; Afterimage empowers the next basic +30% and returns 10 energy on a hero', () => {
  reset();
  assert.equal(wraith.maxMana, 100);
  const lv = wraith.level; wraith.level = 12; wraith.recalcStats(false);
  assert.equal(wraith.maxMana, 100, 'still 100 at level 12');
  wraith.level = lv; wraith.recalcStats(false);
  wraith.mana = 50;
  T.seconds(G, 1);
  near(wraith.mana, 58, 0.5, '8 per second');
  wraith.gainMana(30);
  near(wraith.mana, 58, 0.5, 'a mana refund does nothing');
  T.place(wraith, open.x, open.y);
  T.place(grom, open.x + 200, open.y);
  wraith.mana = 20;
  assert.equal(wraith.castSkill(0, grom), false, '20 energy: no Phase Cut');
  wraith.mana = 50;
  assert.ok(wraith.castSkill(0, grom));
  near(wraith.mana, 25, 1e-9, '25 paid');
  T.frames(G, 25);   // the dash carries her through him
  assert.ok(grom.stats.dmgTaken > 0, 'Phase Cut hit');
  assert.ok(wraith.pv.until > G.time, 'Afterimage window open');
  T.place(wraith, grom.x - 100, grom.y); wraith.dashS = null;
  const before = grom.stats.dmgTaken, e0 = wraith.mana;
  basic(wraith, grom);
  const empowered = grom.stats.dmgTaken - before;
  assert.ok(wraith.mana > e0 + 10 - 1e-6 && wraith.mana < e0 + 10 + 8, `10 energy back (plus the regen of the swing): ${wraith.mana - e0}`);
  assert.ok(!(wraith.pv.until > G.time), 'window spent');
  const before2 = grom.stats.dmgTaken;
  basic(wraith, grom);
  const plain = grom.stats.dmgTaken - before2;
  near(empowered / plain, 1.3, 0.03, 'the empowered swing dealt +30%');
});

T.test('Wraith: Phantom Blades sets her range to 300 for 3 thrown basics carrying +20 +3/rank (+15% ATK), then ends; Haunt lands on the aimed hero, silences 0.5 s and costs 40 energy', () => {
  reset();
  T.place(wraith, open.x, open.y);
  T.place(grom, open.x + 250, open.y);
  assert.equal(wraith.range, 90);
  assert.ok(wraith.castSkill(1, null));
  assert.equal(wraith.range, 300, 'range reads 300');
  assert.equal(wraith.basicRangeState.count, 3);
  near(wraith.mana, 70, 1e-9, '30 energy');
  wraith.atkCd = 0; wraith.tryAttack(grom);
  const p = G.projectiles.find(q => q.src === wraith && q.kind === 'homing');
  assert.ok(p, 'a thrown blade');
  near(p.packet.amount, wraith.curAtk() * 1.15 + 20 + 3 * 5, 1e-6, 'the bonus at rank 6 folded into the basic');
  assert.equal(wraith.basicRangeState.count, 2);
  T.frames(G, 30);
  assert.ok(grom.stats.dmgTaken > 0, 'it landed');
  basic(wraith, grom); basic(wraith, grom);
  assert.equal(wraith.basicRangeState, null, 'three thrown: over');
  assert.equal(wraith.range, 90);
  // Haunt on the aimed hero, not the nearest
  reset();
  T.place(wraith, open.x, open.y);
  T.place(grom, open.x + 200, open.y);
  T.place(nyx, open.x + 400, open.y);
  nyx.hp = nyx.maxHp * 0.3;
  wraith.botFireSkill(2, grom, 200, true, false);
  assert.ok(wraith.distTo(nyx) < 120, 'blinked onto the lowest hero in reach');
  assert.ok(nyx.stats.dmgTaken > 0 && nyx.cc.has('silence'), 'struck and silenced');
  assert.equal(grom.stats.dmgTaken, 0);
  near(wraith.mana, 60, 1e-9, '40 energy');
});

T.test('Wraith bot: Phase Cut only from 55 energy; Phantom Blades for a target 150-300 away; Haunt on a low hero; under 30 energy with a hero inside 400 she backs off for a moment', () => {
  reset();
  T.place(wraith, open.x, open.y);
  T.place(grom, open.x + 300, open.y);
  wraith.mana = 50;
  assert.equal(wraith.botSkillUrgency(0, grom, 300, true, false), 0, '50 energy: Phase Cut held');
  wraith.mana = 60;
  assert.equal(wraith.botSkillUrgency(0, grom, 300, true, false), 360, '60 energy: a routine dash');
  wraith.mana = 100;
  assert.equal(wraith.botSkillUrgency(1, grom, 100, true, false), 0, 'in melee reach: no blades');
  assert.equal(wraith.botSkillUrgency(1, grom, 200, true, false), 560, '200 away: blades');
  assert.equal(wraith.botSkillUrgency(1, grom, 320, true, false), 0, 'past 300: none');
  assert.equal(wraith.botSkillUrgency(2, grom, 400, true, false), 0, 'a healthy lone hero: Haunt held');
  grom.hp = grom.maxHp * 0.3;
  assert.equal(wraith.botSkillUrgency(2, grom, 400, true, false), 870, 'a low hero: Haunt');
  grom.hp = grom.maxHp;
  // the energy retreat
  wraith.mana = 20; wraith.aiTarget = grom;
  assert.ok(wraith.heuristicStateStep(), 'under 30 energy with a hero inside 400: step back');
  assert.ok(wraith.fleeT > 0 && wraith.aiTarget === null);
  wraith.fleeT = 0; wraith.mana = 60;
  assert.equal(wraith.heuristicStateStep(), false, 'with energy back: fights');
});

/* ---------------- Sable ---------------- */

T.test('Sable: base stats and skill numbers match the spec (the only hero-only projectile, the only %-max-HP kit, Venom marks that refresh instead of consuming)', () => {
  reset();
  const d = sable.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [508, 67, 240, 26, 60, 6.4, 12, 2.0, 12, 1.8, 92, 1.12, 272, 3]);
  assert.equal(d.passive.id, 'venom');
  const [s1, s2, s3] = sable.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.heroOnly, s1.dmg, s1.dmgLv, s1.scaleAp, s1.range, s1.speed, s1.radius, s1.pierce],
    ['skillshot', 5, -0.2, 40, true, 90, 12, 0.5, 560, 1000, 20, false]);
  assert.deepEqual(s1.applyMark, { tag: 'venom', max: 3, dur: 4, stacks: 1, dot: { pctMaxHp: 0.015, pctPerMp: 0.0001, perSec: true, dur: 4, capNonHero: 40 } });
  assert.equal(rankVal(s1, 'dmg', 6), 150); near(rankVal(s1, 'cd', 6), 4, 1e-9, 'Needle cd at rank 6');
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.dist, s2.speed, s2.dmg, s2.dmgLv, s2.scaleAp],
    ['dash', 9, -0.3, 45, 300, 1100, 110, 14, 0.5]);
  assert.equal(s2.applyMark, s1.applyMark, 'Lunge applies the same Venom (one stack, the same dot)');
  assert.equal(rankVal(s2, 'dmg', 6), 180); near(rankVal(s2, 'cd', 6), 7.5, 1e-9, 'Lunge cd at rank 6');
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.range, s3.dmg, s3.dmgLv, s3.scaleAp, s3.pctMaxHp, s3.pctMaxHpCap, s3.slowPct, s3.slowDur, s3.refreshMark],
    ['blinkstrike', [38, 34, 30], 100, 460, 220, 40, 0.7, [0.08, 0.10, 0.12], 500, 0.5, 1.5, { tag: 'venom' }]);
  assert.ok(!s3.consumeMark, 'Kiss refreshes, never consumes');
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.type === 'skillshot' && s.heroOnly)).length, 1, 'the only hero-only projectile');
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.pctMaxHp)).length, 1, 'the only %-max-HP skill');
  for (const s of sable.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Sable: Needle flies through a creep to the hero behind it and applies Venom, a dot of 1.5% (+0.01% per MAGIC) of max HP per second per stack (cap 40/s vs non-heroes); Lunge adds a stack; three at most; basics refresh the timer once per stack lifetime', () => {
  reset();
  T.place(sable, open.x, open.y);
  const m = creep(0, open.x + 200, open.y);
  T.place(grom, open.x + 420, open.y);
  assert.ok(sable.castSkill(0, grom));
  T.frames(G, 30);
  assert.equal(m.stats ? m.stats.dmgTaken : m.hp < m.maxHp, false, 'the creep on the line was not touched');
  assert.ok(grom.stats.dmgTaken > 0, 'the hero behind it was hit');
  assert.equal(markStacks(grom, 'venom'), 1);
  let dot = grom.dots.find(x => x.tag === 'venom');
  assert.ok(dot, 'a Venom dot');
  near(dot.perSec, grom.maxHp * 0.015, 1e-6, '1.5% of max HP per second at one stack, no MAGIC');
  // Lunge: a second stack, the dot doubled
  T.place(sable, grom.x - 150, grom.y);
  assert.ok(sable.castSkill(1, grom));
  T.frames(G, 20);
  assert.equal(markStacks(grom, 'venom'), 2);
  dot = grom.dots.find(x => x.tag === 'venom');
  near(dot.perSec, grom.maxHp * 0.03, 1e-6, 'two stacks: 3% per second');
  // a third, then the cap
  sable.dashS = null; T.place(sable, grom.x - 300, grom.y);
  sable.skillCd[0] = 0; assert.ok(sable.castSkill(0, grom)); T.frames(G, 25);
  assert.equal(markStacks(grom, 'venom'), 3);
  sable.skillCd[0] = 0; assert.ok(sable.castSkill(0, grom)); T.frames(G, 25);
  assert.equal(markStacks(grom, 'venom'), 3, 'capped at three');
  dot = grom.dots.find(x => x.tag === 'venom');
  near(dot.perSec, grom.maxHp * 0.045, 1e-6, 'three stacks: 4.5% per second');
  // the passive: a basic refreshes the timer once per stack lifetime
  T.seconds(G, 2);
  const tBefore = grom.marks.venomT;
  T.place(sable, grom.x - 100, grom.y);
  basic(sable, grom);
  assert.ok(grom.marks.venomT > tBefore + 1.5, 'the basic refreshed the Venom timer');
  assert.ok(grom.dots.find(x => x.tag === 'venom').t > 3.0, `and its dot: ${grom.dots.find(x => x.tag === 'venom').t}`);
  const tAfter = grom.marks.venomT;
  basic(sable, grom);
  assert.equal(grom.marks.venomT, tAfter, 'a second basic in the same stack lifetime does not');
  sable.skillCd[0] = 0; assert.ok(sable.castSkill(0, grom)); T.frames(G, 20);   // a new stack: a new lifetime
  T.seconds(G, 1);
  const t2 = grom.marks.venomT;
  basic(sable, grom);
  assert.ok(grom.marks.venomT > t2 + 0.5, 'a fresh application allows the next refresh');
  // the cap against a creep: 40/s per stack
  reset();
  T.place(sable, open.x, open.y);
  const big = creep(0, open.x + 150, open.y);
  big.maxHp = 9000; big.hp = 9000;
  assert.ok(sable.castSkill(1, big)); T.frames(G, 20);
  const cdot = big.dots.find(x => x.tag === 'venom');
  assert.ok(cdot, 'Lunge Venoms a creep too');
  near(cdot.perSec, 40, 1e-6, 'capped at 40 per second per stack against a non-hero');
});

T.test('Sable: Kiss blinks in for base + 8/10/12% of max HP (cap 500 vs non-heroes), slows 50% for 1.5 s and refreshes every Venom stack to full without consuming them', () => {
  reset();
  const s3 = sable.skills[2];
  T.place(sable, open.x, open.y);
  T.place(grom, open.x + 300, open.y);
  near(sable.skillDmg(s3, 3, grom), 300 + sable.magicPower() * 0.7 + 0.12 * grom.maxHp, 1e-6, 'rank 3: 12% of max HP');
  near(sable.skillDmg(s3, 1, grom), 220 + sable.magicPower() * 0.7 + 0.08 * grom.maxHp, 1e-6, 'rank 1: 8%');
  const big = creep(0, open.x + 600, open.y);
  big.maxHp = 9000; big.hp = 9000;
  near(sable.skillDmg(s3, 3, big), 300 + sable.magicPower() * 0.7 + 500, 1e-6, 'capped at 500 vs a non-hero');
  // three Venom, aged 3 s, then the Kiss
  for (let k = 0; k < 3; k++) { sable.skillCd[0] = 0; assert.ok(sable.castSkill(0, grom)); T.frames(G, 25); }
  assert.equal(markStacks(grom, 'venom'), 3);
  T.seconds(G, 3);
  assert.ok(grom.marks.venomT - G.time < 1.2, 'nearly lapsed');
  const hp0 = grom.hp;
  assert.ok(sable.castSkill(2, grom));
  assert.ok(sable.distTo(grom) < 120 && grom.hp < hp0, 'blinked in and bit');
  assert.equal(markStacks(grom, 'venom'), 3, 'stacks kept');
  near(grom.marks.venomT - G.time, 4, 1e-6, 'refreshed to full');
  assert.ok(grom.dots.find(x => x.tag === 'venom').t > 3.9, 'the dot too');
  assert.ok(grom.cc.has('slow') && Math.abs(grom.cc.slowPct - 0.5) < 1e-9, 'slowed 50%');
});

T.test('Sable bot: Needle never at creeps; Lunge for the third Venom (760 at two) and kept for the exit at three; Kiss at 900 on the hero carrying three, aimed at that hero; she prefers the biggest hero of two equally reachable', () => {
  reset();
  T.place(sable, open.x, open.y);
  T.place(grom, open.x + 300, open.y);
  const m = creep(0, open.x + 250, open.y + 100);
  assert.equal(sable.botSkillUrgency(0, m, 270, false, true), 0, 'Needle is held against a creep even when farming');
  assert.equal(sable.botSkillUrgency(0, grom, 300, true, false), 500, 'Needle at a hero');
  assert.equal(sable.botSkillUrgency(1, grom, 300, true, false), 360, 'no Venom: a routine Lunge');
  grom.marks = { venom: 2, venomT: G.time + 4, venomAt: G.time };
  assert.equal(sable.botSkillUrgency(1, grom, 300, true, false), 760, 'two Venom: Lunge for the third');
  assert.equal(sable.botSkillUrgency(2, grom, 300, true, false), 0, 'two Venom on a healthy lone hero: Kiss held');
  grom.marks.venom = 3;
  assert.equal(sable.botSkillUrgency(1, grom, 300, true, false), 0, 'three Venom: Lunge kept for the exit');
  assert.equal(sable.botSkillUrgency(2, grom, 300, true, false), 900, 'three Venom: Kiss at once');
  // aimed at the Venomed hero, not the nearest
  T.place(nyx, open.x + 150, open.y);
  sable.botFireSkill(2, nyx, 150, true, false);
  assert.ok(sable.distTo(grom) < 120, 'Kiss landed on the hero carrying three Venom');
  assert.equal(nyx.stats.dmgTaken, 0);
  // target choice: the biggest hero of two at the same distance
  reset();
  T.place(sable, open.x, open.y);
  T.place(grom, open.x + 300, open.y);
  T.place(nyx, open.x - 300, open.y);
  nyx.level = 6; nyx.recalcStats(true);   // no longer a one-rotation kill: a fair comparison
  G.update(1 / 60);
  sable.aiTarget = null;
  assert.equal(sable.botCanKill(nyx), false);
  sable.def0.botTargetMaxHp = false;
  assert.equal(sable.heuristicSelectTarget(), nyx, 'a plain assassin takes the squishy one');
  sable.def0.botTargetMaxHp = true;
  assert.equal(sable.heuristicSelectTarget(), grom, 'Sable takes the tank');
  nyx.level = 1; nyx.recalcStats(true);
});

/* ---------------- Rook ---------------- */

T.test('Rook: base stats and skill numbers match the spec (airborne on both gap-closers, the only recast skill)', () => {
  reset();
  const d = rook.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [530, 70, 200, 22, 64, 7.0, 13, 2.1, 10, 1.6, 98, 1.05, 278, 3]);
  assert.equal(d.passive.id, 'stoop');
  const [s1, s2, s3] = rook.skills;
  assert.deepEqual([s1.type, s1.cd, s1.mana, s1.dist, s1.speed, s1.stopOnHero, s1.dmg, s1.dmgLv, s1.scaleAd, s1.airborne], ['dash', 10, 45, 380, 1150, true, 120, 15, 0.6, 0.5]);
  assert.equal(rankVal(s1, 'dmg', 6), 195);
  assert.deepEqual([s2.type, s2.cd, s2.mana, s2.radius, s2.dmg, s2.dmgLv, s2.scaleAd, s2.stun, s2.airborne], ['nova', 7, 40, 210, 115, 14, 0.6, undefined, undefined]);
  assert.equal(rankVal(s2, 'dmg', 6), 185);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.range, s3.dmg, s3.dmgLv, s3.scaleAd, s3.airborne, s3.recast],
    ['blinkstrike', [40, 36, 32], 105, 540, 250, 40, 0.9, 0.6, { window: 3.0, speed: 1300, label: 'Return' }]);
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.recast)).length, 1, 'the only recast skill');
  for (const s of rook.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Rook: Dive stops on the first hero and launches it 0.5 s; Stoop on a hero landing gives +40 speed 2 s and loads the next basic with +50% ATK; Talon Fan and creeps do not', () => {
  reset();
  T.place(rook, open.x, open.y);
  T.place(bastion, open.x + 250, open.y);
  T.place(wraith, open.x + 370, open.y + 10);   // behind him on the line: the dive stops before her
  const speed0 = rook.attrs.get('speed');
  assert.ok(rook.castSkill(0, bastion));
  T.frames(G, 20);
  assert.equal(rook.dashS, null, 'the dive ended on him');
  assert.ok(rook.distTo(bastion) < 200, 'stopped on the first hero');
  assert.ok(bastion.stats.dmgTaken > 0 && bastion.cc.has('airborne'), 'struck and launched');
  assert.equal(wraith.stats.dmgTaken, 0, 'the hero behind him was never reached');
  near(rook.attrs.get('speed'), speed0 + 40, 1e-6, 'Stoop: +40 move speed');
  assert.ok(rook.pv.until > G.time, 'the next basic is loaded');
  T.place(rook, bastion.x - 100, bastion.y);
  let before = bastion.stats.dmgTaken;
  basic(rook, bastion);
  const loaded = bastion.stats.dmgTaken - before;
  assert.ok(!(rook.pv.until > G.time), 'spent');
  before = bastion.stats.dmgTaken;
  basic(rook, bastion);
  const plain = bastion.stats.dmgTaken - before;
  near(loaded / plain, 1.5, 0.04, 'the loaded swing carried +50% ATK');
  // Talon Fan: damage, no CC, no Stoop
  assert.ok(rook.castSkill(1, null));
  assert.ok(!(rook.pv.until > G.time), 'Talon Fan does not load Stoop');
  assert.equal(bastion.cc.has('stun') || bastion.cc.has('immobilize'), false, 'no CC');
  // a creep hit by Dive: no Stoop
  reset();
  T.place(rook, open.x, open.y);
  const m = creep(1, open.x + 200, open.y);
  assert.ok(rook.castSkill(0, m));
  T.frames(G, 25);
  assert.ok(m.hp < m.maxHp, 'the creep was cut');
  assert.ok(!(rook.pv.until > G.time) && !(rook.buffs.speed && rook.buffs.speed.t > 0), 'no Stoop off a creep');
});

T.test('Rook: Skyfall slams the target airborne 0.6 s and opens a 3 s Return: a free, unhookable 1300 leap back to the takeoff point, the cooldown running from the first cast; other skills may be cast inside the window', () => {
  reset();
  T.place(rook, open.x, open.y);
  T.place(bastion, open.x + 400, open.y);
  const x0 = rook.x, y0 = rook.y, mana0 = rook.mana;
  assert.ok(rook.castSkill(2, bastion));
  assert.ok(rook.distTo(bastion) < 120 && bastion.cc.has('airborne') && Math.abs(bastion.cc.t.airborne - 0.6) < 1e-9, 'slammed airborne 0.6 s');
  assert.ok(rook.recast && rook.recast.skillIdx === 2 && Math.abs(rook.recast.x - x0) < 1e-9, 'Return open at the takeoff point');
  assert.ok(rook.skillCd[2] >= 32 - 1e-9, 'the cooldown started on the cast');
  near(rook.mana, mana0 - 105, 1e-9, '105 mana');
  assert.ok(rook.castSkill(1, null), 'Talon Fan inside the window');
  assert.ok(rook.pv.until > G.time, 'Stoop loaded by the Skyfall landing');
  T.frames(G, 20);
  const cd = rook.skillCd[2], mana = rook.mana;
  assert.ok(rook.castSkill(2, bastion), 'the button is the Return');
  assert.ok(rook.dashS && rook.dashS.speed === 1300 && rook.dashS.unhookable && rook.dashS.dmg === 0, 'a plain unhookable leap');
  assert.equal(rook.recast, null);
  assert.ok(rook.mana >= mana - 1e-9, 'free');
  assert.ok(Math.abs(rook.skillCd[2] - cd) < 0.5, 'no new cooldown');
  T.frames(G, 30);
  assert.ok(Math.hypot(rook.x - x0, rook.y - y0) < 3, 'back where she took off');
});

T.test('Rook bot: Dive only with an ally within 400, at the lowest ranged hero in reach; Skyfall at the marksman or mage in reach whatever its health; the Return under 45% HP or with 2+ enemies inside 300, and as the escape', () => {
  reset();
  T.place(rook, open.x, open.y);
  T.place(bastion, open.x + 250, open.y);
  T.place(sylva, open.x + 300, open.y + 60);
  assert.equal(rook.botSkillUrgency(0, bastion, 250, true, false), 0, 'no ally within 400: no Dive');
  T.place(nyx, open.x - 200, open.y);
  assert.equal(rook.botSkillUrgency(0, bastion, 250, true, false), 780, 'an ally close: Dive (it launches)');
  assert.equal(rook.dashPick(rook.skills[0], bastion), sylva, 'aimed at the ranged hero, not the tank in front');
  // Skyfall: a healthy lone tank is held; a healthy mage in reach is taken
  T.place(sylva, FAR.x, FAR.y);
  assert.equal(rook.botSkillUrgency(2, bastion, 250, true, false), 0, 'a healthy lone tank: held');
  T.place(sylva, open.x + 400, open.y);
  const def0 = sylva.def0;
  sylva.def0 = Object.assign({}, def0, { role: 'Mage' });   // this lineup has no red marksman or mage
  assert.equal(rook.botSkillUrgency(2, bastion, 250, true, false), 720, 'a mage in reach: Skyfall');
  rook.botFireSkill(2, bastion, 250, true, false);
  assert.ok(rook.distTo(sylva) < 120, 'landed on the mage, not the tank she was fighting');
  sylva.def0 = def0;
  // the Return
  assert.ok(rook.recast, 'open');
  T.place(bastion, FAR.x, FAR.y);
  assert.equal(rook.botSkillUrgency(2, sylva, 60, true, false), 0, 'healthy with one enemy near: stay');
  rook.hp = rook.maxHp * 0.4;
  assert.equal(rook.botSkillUrgency(2, sylva, 60, true, false), 950, 'under 45%: go home');
  rook.hp = rook.maxHp;
  T.place(bastion, rook.x + 150, rook.y + 100);
  assert.equal(rook.botSkillUrgency(2, sylva, 60, true, false), 950, 'two enemies inside 300: go home');
  rook.botEscapeCast();
  assert.ok(rook.dashS && rook.dashS.unhookable && rook.recast === null, 'the escape pressed the Return');
});

/* ---------------- Wick ---------------- */

T.test('Wick: base stats and skill numbers match the spec (the only pulse object and the only skill-based vision; the most durable support)', () => {
  reset();
  const d = wick.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [575, 76, 310, 34, 48, 4.4, 15, 2.7, 15, 2.4, 290, 0.95, 244, 1]);
  assert.equal(d.passive.id, 'lampglass');
  const [s1, s2, s3] = wick.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAp, s1.range, s1.speed, s1.radius, s1.slowPct, s1.slowDur],
    ['skillshot', 6, -0.3, 40, 4, 125, 15, 0.5, 640, 900, 22, 0.25, 1.0]);
  assert.equal(rankVal(s1, 'dmg', 6), 200); near(rankVal(s1, 'cd', 6), 4.5, 1e-9, 'Spark cd at rank 6');
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.range, s2.dur, s2.tick, s2.allyRadius, s2.shield, s2.shieldLv, s2.shieldScaleAp, s2.shieldDur, s2.revealRadius, s2.revealBasicBonus, s2.slowPct],
    ['object', 13, -0.6, 60, 4, 480, 5, 1.0, 300, 45, 7, 0.2, 2.0, 300, 0.15, undefined]);
  near(rankVal(s2, 'cd', 6), 10, 1e-9, 'Lantern cd at rank 6'); assert.equal(rankVal(s2, 'mana', 6), 80);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.heal, s3.scaleAp, s3.radius, s3.shieldPct], ['heal', [48, 42, 36], [110, 140, 170], [170, 230, 290], 0.55, 320, 0.08]);
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.type === 'object')).length, 1, 'the only pulse object');
  assert.ok(sim.context.HEROES.filter(h => h.role === 'Support').every(h => h.hp <= d.hp && h.armor <= d.armor), 'the most durable support');
  for (const s of wick.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Wick: the Lantern pulses a refreshing lantern-tagged shield on allies within 300 every second for 5 s, reveals enemy heroes within 300 for the whole duration, and her basics on a revealed enemy deal +15%', () => {
  reset();
  T.place(wick, open.x, open.y);
  T.place(rook, open.x + 100, open.y);
  T.place(bastion, open.x + 200, open.y);
  T.place(wraith, open.x + 700, open.y);
  const mana0 = wick.mana;
  assert.ok(wick.castSkill(1, { x: wick.x, y: wick.y }));
  assert.equal(G.objects.length, 1); assert.equal(G.objects[0].mode, 'pulse');
  near(wick.mana, mana0 - 80, 1e-9, '60 +4/rank mana');
  G.update(1 / 60);
  const expect = 45 + 7 * 5 + wick.magicPower() * 0.2;
  for (const a of [rook, wick]) {
    const sh = a.shields.filter(x => x.tag === 'lantern');
    assert.equal(sh.length, 1, `${a.name} shielded on the first pulse`);
    near(sh[0].amount, expect, 1e-6, 'the shield at rank 6');
    near(sh[0].t, 2.0, 1e-6, 'for 2 s');
  }
  assert.ok(bastion.revealT > 4.5 && bastion.marks.lanternRevealed > G.time + 4.5, 'the enemy inside 300 is revealed for the rest of the lantern');
  assert.equal(wraith.revealT, 0, 'outside 300: not revealed');
  T.frames(G, 62);   // the second pulse
  assert.equal(rook.shields.filter(x => x.tag === 'lantern').length, 1, 'refreshed, never stacked');
  assert.ok(rook.shields.find(x => x.tag === 'lantern').t > 1.5, 'the timer refreshed');
  // +15% basics on the revealed enemy (the attacker-side modifier, before mitigation and rounding)
  near(wick.onDealDamage(bastion, 100, { isBasic: true }), 115, 1e-9, 'a basic on the revealed enemy: +15%');
  near(wick.onDealDamage(bastion, 100, { skill: {} }), 100, 1e-9, 'a skill: unchanged');
  near(wick.onDealDamage(wraith, 100, { isBasic: true }), 100, 1e-9, 'an unrevealed enemy: unchanged');
  T.place(wick, bastion.x - 200, bastion.y);
  const before = bastion.stats.dmgTaken;
  basic(wick, bastion);
  assert.ok(bastion.stats.dmgTaken > before, 'the swing landed');
  T.seconds(G, 5);
  assert.equal(G.objects.length, 0, 'gone after 5 s');
});

T.test('Wick: Warding Glow heals allies within 320 for 170/230/290 (+55% MAGIC) with an 8% max-HP shield for 3 s, plus the Lampglass shield of 40% of the heal', () => {
  reset();
  T.place(wick, open.x, open.y);
  T.place(rook, open.x + 200, open.y);
  T.place(grom, open.x + 400, open.y);   // past 320
  rook.hp = rook.maxHp * 0.5; grom.hp = grom.maxHp * 0.5;
  const mana0 = wick.mana;
  assert.ok(wick.castSkill(2, null));
  near(wick.mana, mana0 - 170, 1e-9, '170 mana at rank 3');
  const heal = 290 + wick.magicPower() * 0.55;
  near(rook.hp, rook.maxHp * 0.5 + heal, 1e-6, 'healed 290 (+55% MAGIC)');
  assert.equal(grom.hp, grom.maxHp * 0.5, 'past 320: nothing');
  const pct = rook.shields.find(x => Math.abs(x.amount - rook.maxHp * 0.08) < 1e-6);
  assert.ok(pct && Math.abs(pct.t - 3) < 1e-6, 'an 8% max-HP shield for 3 s');
  const lamp = rook.shields.find(x => Math.abs(x.amount - heal * 0.4) < 1e-6);
  assert.ok(lamp && Math.abs(lamp.t - 2.5) < 1e-6, 'and Lampglass: 40% of the heal for 2.5 s');
});

T.test('Wick bot: the Lantern goes under the allied frontliner when 2+ enemy heroes are within 500 of an ally, then she stands within 250 of it; Warding Glow when an ally within 320 is under 45% or three allies are fighting in range', () => {
  reset();
  const s2 = wick.skills[1];
  T.place(wick, open.x, open.y);
  T.place(rook, open.x + 250, open.y);
  T.place(grom, open.x + 300, open.y + 60);
  T.place(bastion, open.x + 600, open.y);
  wick.aiTarget = bastion;
  assert.equal(wick.botSkillUrgency(1, bastion, 600, true, false), 0, 'one enemy, nobody fighting: held');
  wick.lastDmgT = G.time;   // she is in the fight: a routine drop under the ally nearest the enemy
  assert.equal(wick.botSkillUrgency(1, bastion, 600, true, false), 350);
  assert.equal(wick.lanternSpot(s2, false), grom, 'the ally nearest the enemy');
  T.place(sable, open.x + 650, open.y + 100);
  assert.equal(wick.botSkillUrgency(1, bastion, 600, true, false), 720, 'two enemy heroes within 500 of an ally: the lantern goes down');
  assert.equal(wick.lanternSpot(s2, true), grom, 'under the frontliner (the Tank) rather than the assassin');
  wick.botFireSkill(1, bastion, 600, true, false);
  const lamp = G.objects[0];
  assert.ok(lamp && Math.hypot(lamp.x - grom.x, lamp.y - grom.y) < 5, 'planted under him');
  const cp = wick.chooseCombatPoint(bastion);
  assert.ok(Math.hypot(cp.x - lamp.x, cp.y - lamp.y) <= 250 + 60, `she fights within 250 of it: ${Math.hypot(cp.x - lamp.x, cp.y - lamp.y)}`);
  // Warding Glow
  G.objects.length = 0;
  assert.equal(wick.botSkillUrgency(2, bastion, 600, true, false), 0, 'everyone healthy: held');
  rook.hp = rook.maxHp * 0.5;
  assert.equal(wick.botSkillUrgency(2, bastion, 600, true, false), 0, 'an ally at 50%: still held (45%)');
  rook.hp = rook.maxHp * 0.35;
  assert.equal(wick.botSkillUrgency(2, bastion, 600, true, false), 980, 'an ally under 45% within 320: the Glow');
  rook.hp = rook.maxHp;
  for (const a of [wick, rook, grom]) a.lastDmgT = G.time;
  assert.equal(wick.botSkillUrgency(2, bastion, 600, true, false), 900, 'three allies fighting in range: the Glow');
  assert.equal(wick.botSkillUrgency(2, creep(1, open.x + 500, open.y), 500, false, true), 900, 'a heal ultimate needs no hero target');
});

/* ---------------- Bell ---------------- */

T.test('Bell: base stats and skill numbers match the spec (the only allybuff; Chime pierces with no slow; Knell silences and slows)', () => {
  reset();
  const d = bell.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [560, 74, 300, 34, 46, 4.2, 13, 2.4, 15, 2.3, 300, 0.95, 250, 2]);
  assert.equal(d.passive.id, 'peal');
  const [s1, s2, s3] = bell.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAp, s1.range, s1.speed, s1.radius, s1.pierce, s1.slowPct],
    ['skillshot', 6, -0.3, 40, 4, 115, 14, 0.5, 620, 800, 28, true, undefined]);
  assert.equal(rankVal(s1, 'dmg', 6), 185);
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.radius, s2.asAdd, s2.asAddLv, s2.spdAdd, s2.dur], ['allybuff', 14, -0.6, 65, 5, 380, 0.2, 0.02, 35, 3.5]);
  near(rankVal(s2, 'asAdd', 6), 0.3, 1e-9, 'Carillon +0.30 at rank 6'); near(rankVal(s2, 'cd', 6), 11, 1e-9, 'Carillon cd at rank 6'); assert.equal(rankVal(s2, 'mana', 6), 90);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.range, s3.radius, s3.delay, s3.ticks, s3.dmg, s3.scaleAp, s3.silence, s3.slowPct, s3.slowDur],
    ['zone', [46, 40, 34], [100, 125, 150], 540, 220, 0.5, 1, [200, 260, 320], 0.6, 1.2, 0.4, 1.5]);
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.type === 'allybuff')).length, 1, 'the only allybuff');
  assert.ok(!bell.skills.some(s => s.type === 'heal' || s.heal), 'heals nothing');
  for (const s of bell.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Bell: Carillon gives every ally within 380 (herself included) +0.30 attack speed and +35 move speed for 3.5 s, the attack speed taken as the max against a dash steroid; Peal hastens allies within 420 every 6 s', () => {
  reset();
  T.place(bell, open.x, open.y);
  T.place(rook, open.x + 200, open.y);
  T.place(grom, open.x + 500, open.y);
  const as0 = rook.curAtkSpd(), sp0 = rook.attrs.get('speed'), bas0 = bell.curAtkSpd();
  assert.ok(bell.castSkill(1, null));
  near(rook.curAtkSpd(), as0 + 0.3, 1e-9, '+0.30 attack speed');
  near(rook.attrs.get('speed'), sp0 + 35, 1e-9, '+35 move speed');
  near(rook.buffs.atkSpd.t, 3.5, 1e-9, 'for 3.5 s');
  near(bell.curAtkSpd(), bas0 + 0.3, 1e-9, 'Bell too');
  assert.ok(!grom.buffs.atkSpd, 'past 380: nothing');
  rook.buffAsMult = 1.5; rook.buffAsT = 3;   // a dash steroid on top: the larger wins, not the sum
  near(rook.curAtkSpd(), Math.max(as0 * 1.5, as0 + 0.3), 1e-9, 'the max against a steroid');
  rook.buffAsT = 0;
  T.seconds(G, 3.6);
  assert.ok(!(rook.buffs.atkSpd && rook.buffs.atkSpd.t > 0), 'over');
  // Peal
  bell.pv.t = 0.05; rook.buffs = {}; rook.recalcStats(false);
  const sp1 = rook.attrs.get('speed');
  T.frames(G, 6);
  near(rook.attrs.get('speed'), sp1 + 50, 1e-9, 'Peal: +50 move speed');
});

T.test('Bell: Chime pierces every enemy on its line and slows nobody; Knell lands after 0.5 s with a 1.2 s silence and a 40% slow', () => {
  reset();
  T.place(bell, open.x, open.y);
  T.place(bastion, open.x + 200, open.y);
  T.place(wraith, open.x + 540, open.y + 10);   // 340 behind him: on the line, outside the Knell
  assert.ok(bell.castSkill(0, { x: open.x + 600, y: open.y }));
  T.frames(G, 50);
  assert.ok(bastion.stats.dmgTaken > 0 && wraith.stats.dmgTaken > 0, 'both on the line were rung');
  assert.ok(!bastion.cc.has('slow') && !wraith.cc.has('slow'), 'no slow');
  assert.ok(bell.castSkill(2, bastion));
  assert.equal(G.zones.length, 1);
  T.seconds(G, 0.6);
  assert.ok(bastion.cc.has('silence') && bastion.cc.t.silence > 0.85, `silenced 1.2 s (landed ~0.55 s in): ${bastion.cc.t.silence}`);
  assert.ok(bastion.cc.has('slow') && Math.abs(bastion.cc.slowPct - 0.4) < 1e-9, 'slowed 40%');
  assert.ok(!wraith.cc.has('silence'), 'outside 220: not silenced');
});

T.test('Bell bot: she shadows the allied marksman; Carillon when an ally in reach is basic-attacking an enemy hero; Knell on 2+ heroes or a lone enemy Mage or Support', () => {
  reset();
  T.place(bell, open.x, open.y);
  T.place(rook, open.x + 300, open.y);      // inside Carillon's 380
  T.place(bastion, open.x + 900, open.y);   // 600 from the ally: nobody is on him
  bell.aiTarget = bastion;
  assert.equal(bell.botSkillUrgency(1, bastion, 900, true, false), 0, 'nobody on him: Carillon held');
  T.place(bastion, open.x + 700, open.y);
  assert.equal(bell.botSkillUrgency(1, bastion, 700, true, false), 520, 'an ally within 520 of him: a routine ring');
  T.place(bastion, open.x + 400, open.y); rook.curTarget = bastion;
  assert.equal(bell.botSkillUrgency(1, bastion, 400, true, false), 700, 'an ally in reach basic-attacking him: Carillon');
  rook.curTarget = null;
  // Knell
  T.place(bastion, open.x + 400, open.y);
  assert.equal(bell.botSkillUrgency(2, bastion, 400, true, false), 0, 'a lone healthy tank: held');
  T.place(bastion, FAR.x, FAR.y);
  T.place(sylva, open.x + 400, open.y + 120);
  assert.equal(bell.botSkillUrgency(2, sylva, 420, true, false), 820, 'a Support alone: Knell');
  T.place(sylva, FAR.x, FAR.y);
  T.place(bastion, open.x + 400, open.y);
  T.place(wraith, open.x + 480, open.y + 100);
  assert.equal(bell.botSkillUrgency(2, bastion, 400, true, false), 880, 'two heroes inside 220 of the target: Knell');
  // the shadow: with nobody under threat the roam anchor is the allied marksman
  reset();
  T.place(bell, open.x, open.y); T.place(rook, open.x + 300, open.y); T.place(nyx, open.x + 100, open.y); T.place(grom, open.x + 150, open.y);
  T.place(wick, open.x + 120, open.y + 80);   // nobody left parked next to the enemy team (that would read as an ally under threat)
  const lane0 = bell.lane; bell.lane = 'roam';
  const def0 = rook.def0; rook.def0 = Object.assign({}, def0, { role: 'Marksman' });   // this lineup has no blue marksman
  assert.equal(bell.roamAnchor(), rook, 'shadows the marksman');
  rook.def0 = def0; bell.lane = lane0;
});

/* ---------------- Sylva ---------------- */

T.test('Sylva: base stats and skill numbers match the spec (the only single-ally targeted skill and the only friendly tether)', () => {
  reset();
  const d = sylva.def0;
  assert.deepEqual([d.hp, d.hpLv, d.mp, d.mpLv, d.atk, d.atkLv, d.armor, d.armorLv, d.mr, d.mrLv, d.range, d.atkSpd, d.speed, d.difficulty],
    [545, 70, 330, 36, 48, 4.4, 12, 2.4, 15, 2.3, 330, 0.95, 242, 2]);
  assert.equal(d.passive.id, 'verdant');
  const [s1, s2, s3] = sylva.skills;
  assert.deepEqual([s1.type, s1.cd, s1.cdLv, s1.mana, s1.manaLv, s1.dmg, s1.dmgLv, s1.scaleAp, s1.range, s1.speed, s1.radius, s1.slowPct, s1.slowDur],
    ['skillshot', 7, -0.4, 45, 4, 130, 16, 0.6, 680, 850, 26, 0.3, 1.5]);
  assert.equal(rankVal(s1, 'dmg', 6), 210); near(rankVal(s1, 'cd', 6), 5, 1e-9, 'Thorn Volley cd at rank 6');
  assert.deepEqual([s2.type, s2.cd, s2.cdLv, s2.mana, s2.manaLv, s2.allyTarget, s2.heal, s2.healLv, s2.scaleAp],
    ['link', 11, -0.6, 70, 5, { range: 520, self: false }, 110, 18, 0.55]);
  assert.deepEqual(s2.link, { dur: 4, interval: 0.5, tickHeal: 25, tickHealLv: 4, tickScaleAp: 0.15, targetSpeedAdd: 40, casterArmorAdd: 12, casterMrAdd: 12, breakRange: 650 });
  assert.equal(rankVal(s2, 'heal', 6), 200); near(rankVal(s2, 'cd', 6), 8, 1e-9, 'Vine Link cd at rank 6'); assert.equal(rankVal(s2, 'mana', 6), 95);
  assert.deepEqual([s3.type, s3.cd, s3.mana, s3.heal, s3.scaleAp, s3.radius], ['heal', [55, 48, 41], [120, 150, 180], [150, 210, 270], 0.5, 420]);
  assert.deepEqual(s3.link, { all: true, dur: 6, interval: 0.5, tickHeal: [16, 22, 28], tickScaleAp: 0.08, targetSpeedAdd: 40, breakRange: 550 });
  assert.equal(sim.context.HEROES.filter(h => h.skills.some(s => s.type === 'link')).length, 1, 'the only ally link');
  assert.ok(!sylva.skills.some(s => s.stun || s.immobilize || s.silence || s.airborne || s.shieldPct), 'no hard CC, no shield');
  for (const s of sylva.skills) assert.ok(s.desc && s.desc.length > 20, `${s.name} has a description`);
});

T.test('Sylva: Vine Link heals the chosen ally at once (Verdant Gift: +60 speed, 12 mana back), then ticks 8 times over 4 s without the passive, hastens them and armours her while they stay within 650; recasting replaces it', () => {
  reset();
  T.place(sylva, open.x, open.y);
  T.place(pact, open.x + 200, open.y);
  T.place(wraith, open.x + 250, open.y + 60);
  pact.hp = pact.maxHp * 0.4;
  sylva.mana = 200;   // below the cap, so the refund (which lands before the cost is paid) is visible
  const mana0 = sylva.mana, armor0 = sylva.armorValue(), mr0 = sylva.mrValue(), psp0 = pact.attrs.get('speed');
  let heals = 0;
  const fire = sylva.fire.bind(sylva);
  sylva.fire = (hook, ...a) => { if (hook === 'onHealAlly') heals++; return fire(hook, ...a); };
  assert.ok(sylva.castSkill(1, null), 'no aim: the lowest ally');
  const heal = 200 + sylva.magicPower() * 0.55;
  near(pact.hp, pact.maxHp * 0.4 + heal, 1e-6, 'healed 200 (+55% MAGIC) at once');
  near(sylva.mana, mana0 - 95 + 12, 1e-6, '95 mana paid, 12 back from Verdant Gift');
  assert.ok(pact.buffs.speed && pact.buffs.speed.value >= 60, 'Verdant Gift: +60 move speed');
  assert.equal(heals, 1);
  const link = G.tethers.find(t => !t.dead && t.src === sylva);
  assert.ok(link && !link.hostile && link.target === pact && Math.abs(link.t - 4) < 1e-9, 'a 4 s friendly link');
  const tick = 25 + 4 * 5 + sylva.magicPower() * 0.15;
  const hp1 = pact.hp;
  T.frames(G, 33);
  assert.ok(pact.hp >= hp1 + tick - 1, `a tick of 45 (+15% MAGIC): ${pact.hp - hp1}`);
  assert.equal(heals, 1, 'link ticks skip the passive');
  assert.ok(pact.attrs.get('speed') >= psp0 + 40, 'the ally +40 speed while linked');
  assert.ok(sylva.armorValue() >= armor0 + 12 - 1e-6 && sylva.mrValue() >= mr0 + 12 - 1e-6, 'Sylva +12 armor and MR while linked');
  const hp2 = pact.hp;
  T.seconds(G, 3.6);
  assert.ok(link.dead, 'ran its course');
  assert.ok(pact.hp - hp2 >= 6 * tick - 2 || pact.hp >= pact.maxHp - 1, 'the remaining ticks landed');
  // breakRange: the ally walking off snaps it quietly
  sylva.skillCd[1] = 0; pact.hp = pact.maxHp * 0.5; sylva.mana = sylva.maxMana;
  assert.ok(sylva.castSkill(1, null));
  T.place(pact, open.x + 900, open.y);
  G.update(1 / 60);
  assert.ok(!G.tethers.some(t => !t.dead && t.src === sylva), 'snapped past 650');
  // recasting replaces: the aim picks the ally nearest the point
  T.place(pact, open.x + 200, open.y);
  sylva.skillCd[1] = 0;
  assert.ok(sylva.castSkill(1, null));
  const first = G.tethers.find(t => !t.dead && t.src === sylva);
  sylva.skillCd[1] = 0; wraith.hp = wraith.maxHp * 0.9;
  assert.ok(sylva.castSkill(1, { x: wraith.x, y: wraith.y }));
  assert.ok(first.dead, 'the old vine is gone');
  const second = G.tethers.find(t => !t.dead && t.src === sylva);
  assert.ok(second && second.target === wraith, 'the new one on the aimed ally');
  assert.equal(G.tethers.filter(t => !t.dead && t.src === sylva).length, 1, 'one vine at a time');
  // no ally in reach: no cast, no cost
  T.place(pact, FAR.x, FAR.y); T.place(wraith, FAR.x, FAR.y);
  sylva.skillCd[1] = 0; const m = sylva.mana;
  assert.equal(sylva.castSkill(1, null), false);
  assert.equal(sylva.mana, m);
  sylva.fire = fire;
});

T.test('Sylva: Canopy heals every allied hero within 420 and links them all, herself included, for 6 s of 28 (+8% MAGIC) ticks; a Canopy vine never replaces a stronger Vine Link', () => {
  reset();
  T.place(sylva, open.x, open.y);
  T.place(pact, open.x + 200, open.y);
  T.place(wraith, open.x + 300, open.y + 50);
  T.place(bastion, open.x + 600, open.y);
  for (const h of [sylva, pact, wraith, bastion]) h.hp = h.maxHp * 0.5;
  pact.hp = pact.maxHp * 0.4;   // the lowest: the Vine Link goes on him
  assert.ok(sylva.castSkill(1, null), 'a Vine Link on the lowest first');
  const vine = G.tethers.find(t => !t.dead && t.src === sylva);
  assert.equal(vine.target, pact);
  const mana0 = sylva.mana;
  assert.ok(sylva.castSkill(2, null));
  near(sylva.mana, mana0 - 180 + 12 * 3, 1e-6, '180 mana at rank 3, Verdant Gift per hero healed (herself included)');
  const heal = 270 + sylva.magicPower() * 0.5;
  assert.ok(Math.abs(pact.hp - Math.min(pact.maxHp, pact.maxHp * 0.4 + (200 + sylva.magicPower() * 0.55) + heal)) < 1e-6, `the vined ally healed again: ${pact.hp} of ${pact.maxHp}`);
  near(wraith.hp, wraith.maxHp * 0.5 + heal, 1e-6, '270 (+50% MAGIC) to an ally in 420');
  assert.ok(Math.abs(sylva.hp - (sylva.maxHp * 0.5 + heal)) < 1e-6, 'and herself');
  assert.equal(bastion.hp, bastion.maxHp * 0.5, 'past 420: nothing');
  const links = G.tethers.filter(t => !t.dead && t.src === sylva);
  assert.equal(links.length, 3, 'a vine on each ally healed, herself included');
  assert.ok(links.some(t => t.target === sylva), 'self linked');
  assert.ok(!vine.dead && links.includes(vine), 'the stronger Vine Link on the first ally was kept');
  const canopy = links.find(t => t.target === wraith);
  near(canopy.tickHeal, 28 + sylva.magicPower() * 0.08, 1e-6, 'Canopy ticks 28 (+8% MAGIC) at rank 3');
  near(canopy.t, 6, 1e-9, 'for 6 s'); assert.equal(canopy.breakRange, 550);
  const w0 = wraith.hp; wraith.hp = wraith.maxHp * 0.5;
  T.frames(G, 33);
  assert.ok(wraith.hp >= wraith.maxHp * 0.5 + canopy.tickHeal - 1, 'a tick landed');
  void w0;
});

T.test('Sylva bot: she stands 350 behind the ally nearest her target; Vine Link goes on the ally hurt most recently (lowest HP first); Thorn Volley at an enemy chasing an ally; Canopy when 2+ allies within 420 are under 55%', () => {
  reset();
  T.place(sylva, open.x, open.y);
  T.place(pact, open.x + 300, open.y);
  T.place(wraith, open.x + 250, open.y + 80);
  T.place(grom, open.x + 400, open.y);
  sylva.aiTarget = grom;
  const cp = sylva.chooseCombatPoint(grom);
  near(Math.hypot(cp.x - grom.x, cp.y - grom.y), 450, 45, '100 from the ally to the target: she holds about 450 (350 behind him)');
  // Vine Link: the lowest ally, or the one hurt just now
  assert.equal(sylva.botSkillUrgency(1, grom, 400, true, false), 0, 'everyone healthy: no vine');
  pact.hp = pact.maxHp * 0.6;
  assert.equal(sylva.botSkillUrgency(1, grom, 400, true, false), 620, 'an ally at 60%: vine');
  pact.hp = pact.maxHp * 0.4;
  assert.equal(sylva.botSkillUrgency(1, grom, 400, true, false), 900, 'an ally at 40%: vine now');
  wraith.hp = wraith.maxHp * 0.7; wraith.lastHurtT = G.time; pact.lastHurtT = G.time - 10;
  assert.equal(sylva.hurtAllyWithin(520, 0.8), wraith, 'the one hurt most recently');
  sylva.botFireSkill(1, grom, 400, true, false);
  const link = G.tethers.find(t => !t.dead && t.src === sylva);
  assert.ok(link && link.target === wraith, 'the vine went on the ally hurt most recently');
  // Thorn Volley
  assert.equal(sylva.botSkillUrgency(0, grom, 400, true, false), 500, 'an enemy minding his own business: a poke');
  grom.curTarget = pact;
  assert.equal(sylva.botSkillUrgency(0, grom, 400, true, false), 700, 'an enemy chasing an ally: the thorn');
  grom.curTarget = null;
  // Canopy
  wraith.hp = wraith.maxHp; pact.hp = pact.maxHp;
  assert.equal(sylva.botSkillUrgency(2, grom, 400, true, false), 0, 'everyone healthy: held');
  pact.hp = pact.maxHp * 0.5;
  assert.equal(sylva.botSkillUrgency(2, grom, 400, true, false), 0, 'one ally at 50%: held for the crowd');
  wraith.hp = wraith.maxHp * 0.5;
  assert.equal(sylva.botSkillUrgency(2, grom, 400, true, false), 920, 'two allies within 420 under 55%: Canopy');
  wraith.hp = wraith.maxHp; pact.hp = pact.maxHp * 0.3;
  assert.equal(sylva.botSkillUrgency(2, grom, 400, true, false), 980, 'one ally under 35%: a lifeline is still a lifeline');
});

T.done();
