'use strict';
/* F22 dash-to-point, dash-back, energy refund and recast Return; F24
   conditional cooldown reset; F26 ally-radius buff; F27 self shield and
   resist fields on damage skills; F21 missing-HP scaling
   (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const { Projectile, Minion } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const nyx = T.maxSkills(T.hero(G, 'nyx', 0));
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
  T.place(grom, open.x, open.y);
  T.place(zephyr, open.x - 300, open.y - 300);
  T.place(nyx, open.x - 300, open.y + 300);
  T.place(mira, open.x + 1400, open.y + 1400);
  T.place(tide, open.x + 1400, open.y + 1200);
  T.place(sylva, open.x + 1200, open.y + 1400);
  for (const h of [grom, zephyr, nyx, mira, tide, sylva]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.spawnProtT = 0; h.stats.dmgTaken = 0; h.basicMod = null; h.basicRangeState = null; h.recast = null; h.shields = [];
    h.buffAsT = 0; h.buffAsMult = 1; h.items = [];
    h.recalcStats(false);
  }
  G.projectiles.length = 0; G.tethers.length = 0;
  G.minions = G.minions.filter(m => !m._test);
}
reset();
G.update(1 / 60);

T.test('F22: dashToPoint stops at the aim point when nearer than dist; dashBack flies away from the aim and refunds energy on landing', () => {
  reset();
  ownSkill(grom, 1, { type: 'dash', cd: 11, mana: 0, dist: 340, speed: 950, dashToPoint: true,
    endNova: { radius: 180, dmgType: 'physical', dmg: 110, scaleAd: 0.6, slowPct: 0.3, slowDur: 1.2 } });
  const x0 = grom.x, y0 = grom.y;
  assert.ok(grom.castSkill(1, { x: x0 + 200, y: y0 }));
  assert.equal(grom.dashS.remaining, 200, 'a near aim: distance = aim distance');
  T.frames(G, 20);
  assert.equal(grom.dashS, null);
  assert.ok(Math.abs(grom.x - (x0 + 200)) < 2, `landed on the point: ${grom.x - x0}`);
  grom.skillCd[1] = 0; T.place(grom, x0, y0);
  assert.ok(grom.castSkill(1, { x: x0 + 900, y: y0 }));
  assert.equal(grom.dashS.remaining, 340, 'a far aim: capped at dist');
  T.frames(G, 30);
  assert.ok(Math.abs(grom.x - (x0 + 340)) < 2);
  // dashBack: aimed at the enemy, lands away from them; Focus back on landing
  reset();
  ownSkill(zephyr, 1, { type: 'dash', cd: 10, energy: 0, mana: 0, dist: 220, speed: 1000, dashBack: true, energyRefund: 20 });
  zephyr.resource = 'energy';
  zephyr.def0.energy = { max: 100, regen: 0 };
  zephyr.recalcStats(false);
  zephyr.mana = 50;
  T.place(zephyr, open.x, open.y);
  T.place(mira, open.x + 200, open.y);
  assert.ok(zephyr.castSkill(1, { x: mira.x, y: mira.y }));
  assert.ok(zephyr.dashS.dx < -0.99, 'direction inverted');
  assert.ok(Math.abs(zephyr.facing) < 0.01, 'still facing the aim');
  T.frames(G, 20);
  assert.equal(zephyr.dashS, null);
  assert.ok(Math.abs(zephyr.x - (open.x - 220)) < 2, `220 away from the aim: ${zephyr.x - open.x}`);
  assert.ok(Math.abs(zephyr.facing) < 0.01, 'a dashBack keeps facing the enemy');
  assert.ok(Math.abs(zephyr.mana - 70) < 1e-6, `energyRefund on landing: ${zephyr.mana}`);
  zephyr.resource = 'mana'; delete zephyr.def0.energy; zephyr.recalcStats(false);
  // bots aim a dashBack at the chaser so it carries them away from him
  T.place(zephyr, open.x, open.y);
  zephyr.skillCd[1] = 0;
  assert.ok(zephyr.botSkillUrgency(1, mira, 200, true, false) > 0, 'an enemy inside 260: hop');
  assert.equal(zephyr.botSkillUrgency(1, mira, 400, true, false), 0, 'nobody close: keep it');
});

T.test('F22: a recast Return dashes back to the takeoff point within the window, free, unhookable, and not after', () => {
  reset();
  ownSkill(nyx, 2, { type: 'blinkstrike', cd: [40, 36, 32], mana: 105, range: 540, dmgType: 'physical', dmg: [250, 290, 330], scaleAd: 0.9,
    airborne: 0.6, recast: { window: 3, speed: 1300, label: 'Return' } });
  T.place(nyx, open.x, open.y);
  T.place(mira, open.x + 400, open.y);
  const x0 = nyx.x, y0 = nyx.y, t0 = G.time;
  assert.ok(nyx.castSkill(2, mira));
  assert.ok(nyx.distTo(mira) < 120, 'blinked onto the target');
  assert.ok(mira.stats.dmgTaken > 0);
  assert.ok(nyx.recast && nyx.recast.skillIdx === 2, 'Return open');
  assert.ok(Math.abs(nyx.recast.x - x0) < 1e-9 && Math.abs(nyx.recast.y - y0) < 1e-9, 'takeoff point stored (before the blink)');
  assert.ok(Math.abs(nyx.recast.until - (t0 + 3)) < 1e-9, 'for the window');
  assert.ok(nyx.skillCd[2] > 30, 'cooldown started on the first cast');
  const cd = nyx.skillCd[2], mana = nyx.mana;
  T.frames(G, 30);
  // press it again: the dash back
  assert.ok(nyx.castSkill(2, mira), 'the Return is accepted while on cooldown');
  assert.ok(nyx.dashS && nyx.dashS.unhookable && nyx.dashS.speed === 1300 && nyx.dashS.dmg === 0, 'a plain, unhookable dash');
  assert.equal(nyx.recast, null, 'window closed by the press');
  assert.ok(nyx.mana >= mana - 1e-9, 'free (only regen moved the bar)');
  assert.ok(Math.abs(nyx.skillCd[2] - cd) < 0.6, 'no new cooldown');
  // a hook landing mid-return slides off her
  T.place(tide, nyx.x + 100, nyx.y);
  const hook = Projectile.skillshot(tide, { type: 'skillshot', hook: true, range: 600, speed: 5000, radius: 240, dmg: 0 }, { x: -1, y: 0 });
  G.projectiles.push(hook);
  G.update(1 / 60);
  assert.ok(hook.hitSet.has(nyx), 'the hook reached her');
  assert.equal(nyx.forced, null, 'and did not take hold');
  T.frames(G, 25);
  assert.equal(nyx.dashS, null);
  assert.ok(Math.hypot(nyx.x - x0, nyx.y - y0) < 3, `back where she took off: ${Math.hypot(nyx.x - x0, nyx.y - y0)}`);
  // the window expiring: nothing happens, and the button is a cooldown again
  reset();
  T.place(nyx, open.x, open.y);
  T.place(mira, open.x + 400, open.y);
  assert.ok(nyx.castSkill(2, mira));
  T.seconds(G, 3.1);
  assert.equal(nyx.recast, null, 'expired quietly');
  const here = { x: nyx.x, y: nyx.y };
  assert.equal(nyx.castSkill(2, mira), false, 'on cooldown: no Return, no cast');
  assert.equal(nyx.dashS, null);
  assert.ok(nyx.x === here.x && nyx.y === here.y);
  // a stunned hero cannot press it
  reset();
  T.place(nyx, open.x, open.y);
  T.place(mira, open.x + 400, open.y);
  assert.ok(nyx.castSkill(2, mira));
  nyx.cc.apply('stun', 1, 0);
  assert.equal(nyx.castSkill(2, mira), false, 'stunned');
  assert.ok(nyx.recast, 'still open');
  nyx.cc.clear();
  // bots: the Return is urgent when low or crowded, otherwise ignored
  nyx.hp = nyx.maxHp * 0.4;
  assert.equal(nyx.botSkillUrgency(2, mira, 60, true, false), 950, 'low: go home');
  nyx.hp = nyx.maxHp;
  assert.equal(nyx.botSkillUrgency(2, mira, 60, true, false), 0, 'healthy and alone: stay');
  T.place(tide, nyx.x + 100, nyx.y + 100);
  assert.equal(nyx.botSkillUrgency(2, mira, 60, true, false), 950, 'two on her: go home');
});

T.test('F24: a kill or assist takes the fraction of the full cooldown off every skill carrying the field', () => {
  reset();
  ownSkill(nyx, 1, { type: 'dash', cd: 10, cdLv: -0.4, mana: 45, dist: 300, speed: 1050, dmgType: 'physical', dmg: 90, scaleAd: 0.6,
    resetOnKill: 1.0, resetOnAssist: 0.5 });
  ownSkill(nyx, 2, { type: 'dash', cd: [38, 34, 30], mana: 120, dist: 420, speed: 1200, dmgType: 'physical', dmg: [240, 300, 360], scaleAd: 1.1,
    stun: 0.8, stopOnHero: true, resetOnKill: 0.5 });
  const full1 = nyx.cooldownFor(nyx.skills[1], 6), full2 = nyx.cooldownFor(nyx.skills[2], 3);
  assert.equal(full1, 8); assert.equal(full2, 30);
  nyx.skillCd = [5, 6, 25];
  nyx.fire('onKill', mira);
  assert.equal(nyx.skillCd[0], 5, 'S1 carries no field');
  assert.equal(nyx.skillCd[1], 0, 'Pass: 100% of 8 s comes off');
  assert.equal(nyx.skillCd[2], 10, 'ult: 50% of 30 s comes off');
  nyx.skillCd = [5, 6, 25];
  nyx.fire('onAssist', mira);
  assert.equal(nyx.skillCd[1], 2, 'Pass: 50% on an assist');
  assert.equal(nyx.skillCd[2], 25, 'the ult only resets on a kill');
  // a skill that is ready stays ready; nothing goes negative
  nyx.skillCd = [0, 1, 0];
  nyx.fire('onKill', mira);
  assert.deepEqual(nyx.skillCd, [0, 0, 0]);
  // through the real kill path: the victim's death credits the killer
  reset();
  T.place(mira, open.x + 200, open.y);
  nyx.skillCd = [5, 6, 25];
  mira.hp = 1;
  mira.die(nyx);
  assert.equal(nyx.skillCd[1], 0, 'reset on the kill');
  assert.equal(nyx.skillCd[2], 10);
  mira.alive = true; mira.respawnT = 0; mira.hp = mira.maxHp; mira.deaths = 0; nyx.kills = 0;
});

T.test('F26: allybuff hastens every allied hero in radius (incl. self); its attack speed is the max against a steroid, not stacked', () => {
  reset();
  ownSkill(sylva, 1, { type: 'allybuff', cd: 14, cdLv: -0.6, mana: 65, manaLv: 5, radius: 380, asAdd: 0.2, asAddLv: 0.02, spdAdd: 35, dur: 3.5 });
  T.place(sylva, open.x, open.y);
  T.place(mira, open.x + 300, open.y);     // inside
  T.place(tide, open.x + 600, open.y);     // outside
  const as = { s: sylva.curAtkSpd(), m: mira.curAtkSpd(), t: tide.curAtkSpd() };
  const sp = { s: sylva.curSpeed(), m: mira.curSpeed(), t: tide.curSpeed() };
  assert.ok(sylva.castSkill(1, null));
  assert.ok(Math.abs(sylva.curAtkSpd() - (as.s + 0.3)) < 1e-9, 'self: +0.30 at rank 6');
  assert.ok(Math.abs(mira.curAtkSpd() - (as.m + 0.3)) < 1e-9, 'ally in radius: +0.30');
  assert.ok(Math.abs(mira.curSpeed() - (sp.m + 35)) < 1e-9, 'ally: +35 speed');
  assert.ok(Math.abs(sylva.curSpeed() - (sp.s + 35)) < 1e-9);
  assert.ok(Math.abs(tide.curAtkSpd() - as.t) < 1e-9 && Math.abs(tide.curSpeed() - sp.t) < 1e-9, 'out of radius: nothing');
  assert.ok(Math.abs(mira.buffs.atkSpd.t - 3.5) < 1e-9, 'for dur');
  // a dash steroid on the buffed ally: the larger of x1.5 and +0.30, never x1.5 on top of +0.30
  const base = mira.attrs.get('atkSpd');
  mira.buffAsMult = 1.5; mira.buffAsT = 3;
  assert.ok(Math.abs(mira.curAtkSpd() - Math.max(base * 1.5, base + 0.3)) < 1e-9, 'max, not product');
  assert.ok(mira.curAtkSpd() < (base + 0.3) * 1.5 - 1e-6, 'not stacked');
  mira.buffAsMult = 1.05;
  assert.ok(Math.abs(mira.curAtkSpd() - (base + 0.3)) < 1e-9, 'a weaker steroid loses to the add');
  mira.buffAsT = 0;
  T.seconds(G, 3.6);
  assert.ok(Math.abs(mira.curAtkSpd() - as.m) < 1e-9, 'expired');
  assert.ok(Math.abs(mira.curSpeed() - sp.m) < 1e-9);
  // bots: cast when someone it reaches is on an enemy hero
  sylva.skillCd[1] = 0; sylva.mana = sylva.maxMana;
  T.place(mira, open.x + 300, open.y);
  T.place(nyx, open.x + 500, open.y);
  assert.ok(sylva.botSkillUrgency(1, nyx, 500, true, false) > 0, 'Mira is on Nyx: Carillon');
  T.place(nyx, open.x + 1300, open.y);
  assert.equal(sylva.botSkillUrgency(1, nyx, 1300, true, false), 0, 'nobody in a fight: hold');
});

T.test('F27: selfShieldPct shields the caster after a damage skill; armorAdd / mrAdd buff him for buffDur; a selfState keeps its own', () => {
  reset();
  ownSkill(grom, 0, { type: 'nova', cd: 7, mana: 45, radius: 200, dmgType: 'physical', dmg: 120, scaleAd: 0.55, selfShieldPct: 0.06, selfShieldDur: 3 });
  ownSkill(grom, 2, { type: 'nova', cd: [44, 40, 36], mana: 120, radius: 260, dmgType: 'physical', dmg: [220, 290, 360], scaleAd: 0.7,
    taunt: [0.8, 1.0, 1.2], armorAdd: 30, mrAdd: 30, buffDur: 4 });
  T.place(mira, grom.x + 150, grom.y);
  grom.mana = 400;               // room for both casts
  grom.recalcStats(false);       // Bulwark counts Mira as a nearby enemy: settle that before reading resists
  assert.ok(grom.castSkill(0, mira));
  assert.ok(mira.stats.dmgTaken > 0, 'the nova landed');
  assert.ok(Math.abs(grom.shieldTotal - grom.maxHp * 0.06) < 1e-6, 'shield of 6% max HP');
  assert.ok(Math.abs(grom.shields[0].t - 3) < 1e-9, 'for selfShieldDur');
  const armor0 = grom.armorValue(), mr0 = grom.mrValue();
  assert.ok(grom.castSkill(2, mira));
  assert.ok(mira.cc.has('taunt'), 'the ult taunted');
  assert.ok(Math.abs(grom.armorValue() - (armor0 + 30)) < 1e-9, `+30 armor: ${armor0} -> ${grom.armorValue()} (buffs ${JSON.stringify(grom.buffs)}, mana ${grom.mana})`);
  assert.ok(Math.abs(grom.mrValue() - (mr0 + 30)) < 1e-9, '+30 MR');
  assert.ok(Math.abs(grom.buffs.armor.t - 4) < 1e-9, 'for buffDur');
  T.seconds(G, 4.1);
  assert.ok(Math.abs(grom.armorValue() - armor0) < 1e-9, 'gone after buffDur');
  assert.equal(grom.shieldTotal, 0, 'the shield expired too');
  mira.cc.clear(); mira.forced = null;
  // a selfState's armorAdd is applied once (for its own dur), not again by the generic path
  reset();
  ownSkill(grom, 1, { type: 'selfState', cd: 11, mana: 0, dur: 1.5, selfRoot: true, armorAdd: 20 });
  const a0 = grom.armorValue();
  assert.ok(grom.castSkill(1, null));
  assert.ok(Math.abs(grom.armorValue() - (a0 + 20)) < 1e-9, 'exactly +20');
  assert.ok(Math.abs(grom.buffs.armor.t - 1.5) < 1e-9, 'for the state, not buffDur');
});

T.test('F21: target missing-HP terms per victim with a non-hero cap; the caster\'s own missing HP is computed once per cast', () => {
  reset();
  // Deathmark: 20/25/30% of the target's missing HP, at most 400 vs non-heroes
  const dm = ownSkill(nyx, 2, { type: 'blinkstrike', cd: [42, 38, 34], mana: 100, range: 500, dmgType: 'physical', dmg: [260, 300, 340], scaleAd: 1.0,
    missingPct: 0.2, missingPctLv: 0.05, missingCap: 400, physPenPct: 0.22 });
  mira.hp = mira.maxHp * 0.5;
  const base = 340 + nyx.curAtk();
  assert.ok(Math.abs(nyx.skillDmg(dm, 3, mira) - (base + mira.maxHp * 0.5 * 0.3)) < 1e-6, 'rank 3: 30% of missing');
  assert.ok(Math.abs(nyx.skillDmg(dm, 1, mira) - (base - 80 + mira.maxHp * 0.5 * 0.2)) < 1e-6, 'rank 1: 20% of missing');
  const m = new Minion(1, 'mid', 'melee'); m._test = true; m.update = () => {}; T.place(m, open.x + 900, open.y); G.minions.push(m);
  m.maxHp = 4000; m.hp = 1;
  assert.ok(Math.abs(nyx.skillDmg(dm, 3, m) - (base + 400)) < 1e-6, 'minion: capped at 400');
  const tower = G.towers.find(t => t.team === 1 && t.alive);
  assert.ok(Math.abs(nyx.skillDmg(dm, 3, tower) - base) < 1e-6, 'structure: no missing-HP term');
  assert.ok(Math.abs(nyx.skillDmg(dm, 3) - base) < 1e-6, 'no target: no term');
  // Reaver's Toll: 20/25/30% of Torren's own missing HP (cap 50% of max), once per cast
  reset();
  const toll = ownSkill(grom, 2, { type: 'nova', cd: [42, 38, 34], mana: 0, radius: 260, dmgType: 'true', dmg: [160, 220, 280], scaleAd: 0.7,
    selfMissingPct: [0.2, 0.25, 0.3], selfMissingCap: 0.5 });
  grom.hp = grom.maxHp * 0.3;
  const expect = 280 + grom.curAtk() * 0.7 + grom.maxHp * 0.5 * 0.3;   // missing 70%, capped at 50%
  assert.ok(Math.abs(grom.skillDmg(toll, 3) - expect) < 1e-6, 'capped self-missing term');
  assert.ok(Math.abs(grom.selfMissingAmount(toll, 3) - grom.maxHp * 0.15) < 1e-6);
  grom.hp = grom.maxHp * 0.7;
  assert.ok(Math.abs(grom.skillDmg(toll, 3) - (280 + grom.curAtk() * 0.7 + grom.maxHp * 0.3 * 0.3)) < 1e-6, 'under the cap: the real missing HP');
  // spell vamp heals him off the first victim; the second still takes the same amount
  grom.items.push({ id: 'test-vamp', stats: { spellVamp: 0.6 } });
  grom.recalcStats(false);
  grom.hp = grom.maxHp * 0.3;
  T.place(mira, grom.x + 150, grom.y);
  T.place(tide, grom.x - 150, grom.y);
  const hp0 = grom.hp;
  assert.ok(grom.castSkill(2, mira));
  assert.ok(grom.hp > hp0 + 50, 'he drained off the nova');
  assert.ok(mira.stats.dmgTaken > 0 && tide.stats.dmgTaken > 0);
  assert.equal(mira.stats.dmgTaken, tide.stats.dmgTaken, 'true damage, same self-missing term for both victims');
  grom.items = []; grom.recalcStats(false);
});

T.done();
