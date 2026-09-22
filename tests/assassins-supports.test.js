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

T.done();
