'use strict';
/* F19 self states (ccImmune, selfRoot, untargetable, noAttack, recastCancel),
   F18 channel skill with interruptRefund, F23 taunt CC with forced movement
   (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const R = G.rules;
const { Projectile } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const nyx = T.maxSkills(T.hero(G, 'nyx', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
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
  T.place(zephyr, open.x - 200, open.y + 100);
  T.place(nyx, open.x + 100, open.y - 200);
  T.place(mira, open.x + 1200, open.y + 1200);
  T.place(tide, open.x + 250, open.y);
  for (const h of [grom, zephyr, nyx, mira, tide]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.cc.immuneT = 0; h.forced = null; h.dashS = null; h.dots = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.buffs = {}; h.state = null; h.channelS = null; h.curTarget = null; h.atkCd = 0;
    h.recalcStats(false);
  }
  G.projectiles.length = 0; G.tethers.length = 0;
}
reset();
G.update(1 / 60);

T.test('F19: an untargetable hero is skipped by targeting, projectiles, novas and vision, while dots keep ticking', () => {
  reset();
  ownSkill(nyx, 1, { type: 'selfState', cd: 12, mana: 0, dur: 0.8, untargetable: true, speedPct: 0.3, noAttack: true });
  T.place(nyx, open.x + 100, open.y);
  T.place(tide, open.x + 250, open.y);
  const speed0 = nyx.curSpeed();
  nyx.addDot({ src: tide, total: 60, dur: 2, type: 'magic', tag: 'burn' });
  // an arrow already in flight
  const arrow = Projectile.homing(tide, nyx, tide.attackPacket(nyx));
  G.projectiles.push(arrow);
  assert.ok(nyx.castSkill(1, null));
  assert.ok(nyx.untargetable);
  assert.ok(nyx.curSpeed() > speed0 * 1.25, 'speedPct applied');
  assert.ok(!G.enemyUnits(1).includes(nyx), 'not in enemyUnits');
  assert.equal(G.canSee(1, nyx), false, 'not visible to the enemy');
  assert.notEqual(G.acquireTarget(tide, 800), nyx, 'never acquired (Grom, further away, is)');
  G.update(1 / 60);
  assert.ok(arrow.dead, 'the arrow in flight misses');
  const hp = nyx.hp, taken = nyx.stats.dmgTaken;
  tide.doNova({ type: 'nova', radius: 400, dmgType: 'magic', dmg: 100 }, 1);
  assert.equal(nyx.hp, hp, 'a nova passes through her');
  T.frames(G, 20);   // past the next 4 Hz dot tick
  assert.ok(nyx.stats.dmgTaken > taken, 'the dot kept ticking');
  // noAttack: no basics, no casts
  nyx.atkCd = 0; const th = tide.hp;
  nyx.tryAttack(tide);
  assert.equal(tide.hp, th);
  assert.equal(nyx.castSkill(0, tide), false, 'noAttack blocks casts');
  T.frames(G, 40);
  assert.equal(nyx.state, null, 'expired');
  assert.ok(!nyx.untargetable);
  assert.ok(G.enemyUnits(1).includes(nyx));
});

T.test('F19: ccImmune refuses the listed kinds, selfRoot blocks walking, resist buffs apply, recastCancel ends it free', () => {
  reset();
  const s = ownSkill(grom, 1, { type: 'selfState', cd: 11, mana: 0, dur: 1.5, selfRoot: true, ccImmune: ['slow', 'displacement'],
    armorAdd: 20, mrAdd: 20, tetherSlowMult: 2.0, recastCancel: true });
  const armor0 = grom.armorValue();
  assert.ok(grom.castSkill(1, null));
  assert.ok(grom.state && grom.state.s === s);
  assert.ok(grom.armorValue() >= armor0 + 20, 'armorAdd');
  assert.equal(grom.cc.applySlow(0.4, 2, 0), 0, 'slow refused');
  assert.equal(grom.cc.slowPct, 0);
  assert.equal(R.applyKnockback(tide, grom, 200), false, 'displacement refused');
  assert.equal(grom.forced, null);
  assert.ok(grom.cc.apply('stun', 0.3, 0) > 0, 'a stun still lands (not listed)');
  grom.cc.clear();
  const x0 = grom.x;
  grom.moveToward(grom.x + 300, grom.y, 0.5);
  assert.equal(grom.x, x0, 'rooted');
  assert.ok(grom.tryAttack !== undefined);
  // the cooldown was set by the first cast; the recast is free and ends the state
  const cd = grom.skillCd[1];
  assert.ok(cd > 0);
  assert.ok(grom.castSkill(1, null), 'recast accepted');
  assert.equal(grom.state, null, 'recastCancel ended the state');
  assert.equal(grom.skillCd[1], cd, 'no new cooldown');
  assert.ok(grom.armorValue() < armor0 + 20, 'the resist buff went with it');
  grom.moveToward(grom.x + 300, grom.y, 0.5);
  assert.ok(grom.x > x0, 'free to walk again');
});

T.test('F18: a channel roots and silences the caster, then lands its payload nova', () => {
  reset();
  ownSkill(grom, 2, { type: 'channel', cd: 46, mana: 110, channel: 0.9, interruptRefund: 0.5,
    payload: { type: 'nova', radius: 320, dmgType: 'physical', dmg: 280, scaleAd: 0, knockback: -140, airborne: 0.9 } });
  grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(2, tide));
  assert.ok(grom.channelS, 'channelling');
  assert.equal(grom.mana, grom.maxMana - 110, 'cost paid at cast');
  assert.ok(grom.skillCd[2] > 40, 'cooldown started at cast');
  const x0 = grom.x, th = tide.hp;
  grom.moveToward(grom.x + 300, grom.y, 0.5);
  assert.equal(grom.x, x0, 'rooted');
  assert.equal(grom.castSkill(0, tide), false, 'cannot cast');
  grom.atkCd = 0; grom.tryAttack(tide);
  assert.equal(tide.hp, th, 'cannot basic');
  T.frames(G, 40);   // 0.67 s
  assert.ok(grom.channelS, 'still going');
  assert.equal(tide.hp, th);
  T.frames(G, 20);   // past 0.9 s
  assert.equal(grom.channelS, null);
  assert.ok(tide.hp < th, 'payload landed');
  assert.ok(tide.cc.has('airborne'), 'payload airborne');
  assert.ok(tide.forced && tide.forced.mode === 'slide', 'payload pull tweens');
});

T.test('F18: a stun cancels the channel with the cooldown refund; a slow does not; Purify cast cancels', () => {
  reset();
  grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(2, tide));
  const full = grom.cooldownFor(grom.skills[2], grom.skillRank[2]);
  grom.cc.applySlow(0.5, 1, 0);
  G.update(1 / 60);
  assert.ok(grom.channelS, 'a slow does not interrupt');
  grom.cc.apply('stun', 0.2, 0);
  assert.equal(grom.channelS, null, 'stunned: cancelled');
  assert.ok(Math.abs(grom.skillCd[2] - full * 0.5) < 1e-6, `cd = fullCd x interruptRefund: ${grom.skillCd[2]} vs ${full * 0.5}`);
  assert.ok(grom.mana < grom.maxMana - 100, 'mana stays paid (only a frame of regen came back)');
  const th = tide.hp;
  T.frames(G, 70);
  assert.equal(tide.hp, th, 'no payload after an interrupt');
  // airborne cancels too
  grom.cc.clear(); grom.skillCd[2] = 0; grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(2, tide));
  grom.cc.apply('airborne', 0.3, 0);
  assert.equal(grom.channelS, null);
  // a Purify cast is the player's own choice to stop
  grom.cc.clear(); grom.skillCd[2] = 0; grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(2, tide));
  grom.spell = sim.context.BATTLE_SPELLS.find(sp => sp.id === 'purify');
  grom.spellCd = 0;
  assert.ok(grom.castSpell(null));
  assert.equal(grom.channelS, null, 'Purify cast cancelled the channel');
  assert.ok(Math.abs(grom.skillCd[2] - full * 0.5) < 1e-6);
  grom.cc.immuneT = 0;
});

T.test('F23: a taunted unit walks toward the source and attacks it; tenacity shortens; Purify and the source dying end it', () => {
  reset();
  T.place(tide, open.x + 400, open.y);
  const d0 = tide.distTo(grom);
  R.applySkillCC(grom, tide, { taunt: [0.8, 1.0, 1.2] }, 3);
  assert.ok(Math.abs(tide.cc.t.taunt - 1.2) < 1e-9, 'rank 3 taunt');
  assert.ok(tide.forced && tide.forced.mode === 'taunt' && tide.forced.src === grom);
  assert.equal(tide.cc.dominant, 'taunt');
  assert.equal(tide.castSkill(0, grom), false, 'no casting while taunted');
  T.frames(G, 30);
  assert.ok(tide.distTo(grom) < d0 - 80, `walked toward Grom: ${d0} -> ${tide.distTo(grom)}`);
  const gh = grom.hp;
  T.frames(G, 40);
  assert.ok(grom.hp < gh, 'swung at Grom once in reach');
  T.frames(G, 20);
  assert.equal(tide.forced, null, 'released when the timer ran out');
  assert.ok(!tide.cc.has('taunt'));
  // tenacity shortens it
  tide.addTimedBuff('tenacity', 0.3, 5);
  R.applySkillCC(grom, tide, { taunt: 1.0 }, 1);
  assert.ok(Math.abs(tide.cc.t.taunt - 0.7) < 1e-9);
  tide.cc.purify(0.5);
  assert.equal(tide.forced, null, 'Purify ends the walk');
  tide.cc.immuneT = 0; tide.buffs.tenacity = null; tide.recalcStats(false);
  // the source dying frees the victim
  R.applySkillCC(grom, tide, { taunt: 1.0 }, 1);
  assert.ok(tide.forced);
  grom.respawnT = 60; grom.alive = false;
  G.update(1 / 60);
  assert.equal(tide.forced, null);
  assert.ok(!tide.cc.has('taunt'));
  grom.alive = true; grom.respawnT = 0;
});

T.test('F23: a shove in progress finishes first, then the taunt takes over; Purify immunity refuses a taunt', () => {
  reset();
  T.place(tide, open.x + 300, open.y);
  R.applySkillCC(grom, tide, { knockback: 150 }, 1);
  assert.equal(tide.forced.mode, 'slide');
  R.applySkillCC(grom, tide, { taunt: 1.5 }, 1);
  assert.equal(tide.forced.mode, 'slide', 'the slide keeps the unit');
  assert.ok(tide.forced.prev && tide.forced.prev.mode === 'taunt', 'the taunt waits behind it');
  T.frames(G, 16);
  assert.ok(tide.forced && tide.forced.mode === 'taunt', 'restored after the slide');
  tide.cc.clear(); tide.forced = null;
  tide.cc.purify(1);
  assert.equal(R.applyTaunt(grom, tide, 1.0, 0), 0);
  assert.equal(tide.forced, null);
  tide.cc.immuneT = 0;
});

T.done();
