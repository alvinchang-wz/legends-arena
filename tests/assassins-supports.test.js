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

T.done();
