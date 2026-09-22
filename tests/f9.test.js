'use strict';
/* F9 placed objects: trap, pulse and barrier modes (docs/design/heroes.md). */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const { Minion } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));
const zephyr = T.maxSkills(T.hero(G, 'zephyr', 0));
const mira = T.maxSkills(T.hero(G, 'mira', 1));
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const bastion = T.maxSkills(T.hero(G, 'bastion', 1));
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
  T.place(zephyr, open.x - 200, open.y - 200);
  T.place(mira, open.x + 1200, open.y + 1200);
  T.place(tide, open.x + 1300, open.y + 1200);
  T.place(bastion, open.x + 1400, open.y + 1300);
  for (const h of [grom, zephyr, mira, tide, bastion]) {
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.forced = null; h.dashS = null; h.shields = [];
    h.skillCd = [0, 0, 0]; h.marks = {}; h.revealT = 0; h.alive = true; h.respawnT = 0;
  }
  G.objects.length = 0; G.projectiles.length = 0;
}
reset();
G.update(1 / 60);

const trapDef = { type: 'trap', cd: 8, mana: 0, range: 540, triggerRadius: 110, armDelay: 0.7, lifetime: 20, maxActive: 3,
  heroOnly: true, revealDur: 2, dmgType: 'physical', dmg: 110, scaleAd: 0.5, immobilize: 1.0 };

T.test('F9 trap: arms after armDelay, then triggers on the first enemy hero and is spent', () => {
  reset();
  ownSkill(grom, 0, trapDef);
  const at = { x: open.x + 300, y: open.y };
  assert.ok(grom.castSkill(0, at));
  assert.equal(G.objects.length, 1);
  const trap = G.objects[0];
  assert.equal(trap.mode, 'trap');
  assert.ok(Math.abs(trap.x - at.x) < 1 && Math.abs(trap.y - at.y) < 1);
  assert.equal(trap.armed, false);
  T.place(tide, at.x, at.y);
  T.frames(G, 20);   // 0.33 s: still arming
  assert.equal(tide.hp, tide.maxHp, 'an unarmed trap does nothing');
  assert.equal(G.objects.length, 1);
  T.frames(G, 30);   // past 0.7 s
  assert.ok(tide.hp < tide.maxHp, 'trap damage');
  assert.ok(tide.cc.has('immobilize'), 'trap CC');
  assert.ok(tide.revealT > 1.5, 'revealed for revealDur');
  assert.equal(G.objects.length, 0, 'spent');
});

T.test('F9 trap: heroOnly ignores minions; it outlives its owner; maxActive drops the oldest', () => {
  reset();
  const at = { x: open.x + 300, y: open.y };
  assert.ok(grom.castSkill(0, at));
  const m = new Minion(1, 'mid', 'melee');
  T.place(m, at.x, at.y);
  G.minions.push(m);
  m.target = null; m.retargetT = 1e9; m.path = [];
  T.frames(G, 60);
  assert.equal(G.objects.length, 1, 'still there');
  assert.equal(m.hp, m.maxHp, 'the minion did not set it off');
  m.alive = false;
  grom.respawnT = 60; grom.alive = false;   // dead for a while (a respawnT of 0 would respawn him next frame)
  T.frames(G, 5);
  assert.equal(G.objects.length, 1, 'persists through owner death');
  grom.alive = true; grom.respawnT = 0;
  const first = G.objects[0];
  for (let k = 1; k <= 3; k++) {
    grom.skillCd[0] = 0;
    assert.ok(grom.castSkill(0, { x: open.x + 300, y: open.y + 150 * k }));
  }
  G.update(1 / 60);
  assert.equal(G.objects.filter(o => o.mode === 'trap' && o.owner === grom).length, 3, 'maxActive 3');
  assert.ok(first.dead && !G.objects.includes(first), 'the oldest was removed');
});

T.test('F9 pulse: a lantern shields allies in allyRadius (refreshing, not stacking) and reveals enemies in revealRadius; dies with its owner', () => {
  reset();
  ownSkill(mira, 1, { type: 'object', cd: 13, mana: 0, range: 480, dur: 5, tick: 1, allyRadius: 300, shield: 45, shieldLv: 7,
    shieldScaleAp: 0.2, shieldDur: 2, revealRadius: 300 });
  T.place(tide, mira.x + 100, mira.y);
  T.place(grom, mira.x + 150, mira.y + 100);
  T.place(bastion, mira.x + 600, mira.y);
  assert.ok(mira.castSkill(1, { x: mira.x, y: mira.y }));
  assert.equal(G.objects.length, 1);
  assert.equal(G.objects[0].mode, 'pulse');
  G.update(1 / 60);
  const expect = 45 + 7 * (mira.skillRank[1] - 1) + mira.magicPower() * 0.2;
  const lantern = tide.shields.filter(sh => sh.tag === 'lantern');
  assert.equal(lantern.length, 1, 'ally shielded on the first tick');
  assert.ok(Math.abs(lantern[0].amount - expect) < 1e-6, `shield ${lantern[0].amount} vs ${expect}`);
  assert.ok(grom.revealT > 4, 'enemy hero revealed for the rest of the lantern');
  assert.ok(grom.marks.lanternRevealed > G.time);
  T.frames(G, 70);   // a second tick
  assert.equal(tide.shields.filter(sh => sh.tag === 'lantern').length, 1, 'refreshed, never stacked');
  assert.equal(bastion.shields.length, 0, 'out of allyRadius');
  mira.respawnT = 60; mira.alive = false;
  G.update(1 / 60);
  assert.equal(G.objects.length, 0, 'a lantern dies with its owner');
  mira.alive = true; mira.respawnT = 0;
});

T.test('F9 barrier: enemy projectiles crossing the segment are removed; own projectiles, novas and units are not', () => {
  reset();
  ownSkill(bastion, 1, { type: 'barrier', cd: 16, mana: 0, length: 260, offset: 90, dur: 3 });
  T.place(bastion, open.x, open.y);
  T.place(zephyr, open.x + 420, open.y);
  T.place(tide, open.x + 300, open.y + 900);
  assert.ok(bastion.castSkill(1, { x: bastion.x + 100, y: bastion.y }), 'raised facing +x');
  const b = G.objects[0];
  assert.equal(b.mode, 'barrier');
  assert.ok(Math.abs(b.x - (open.x + 90)) < 1e-6);
  assert.ok(Math.abs(Math.abs(b.ay - b.by) - 260) < 1e-6, 'segment across the aim direction');
  // an enemy skillshot flies into it
  zephyr.skillCd[0] = 0;
  assert.ok(zephyr.castSkill(0, { x: bastion.x, y: bastion.y }));
  assert.equal(G.projectiles.length, 1);
  T.frames(G, 40);
  assert.equal(bastion.hp, bastion.maxHp, 'the bolt never arrived');
  assert.equal(G.projectiles.length, 0, 'removed on crossing');
  // a ranged basic attack (homing projectile) is eaten too
  T.place(zephyr, open.x + 360, open.y);
  zephyr.atkCd = 0; zephyr.tryAttack(bastion);
  assert.equal(G.projectiles.length, 1);
  T.frames(G, 40);
  assert.equal(bastion.hp, bastion.maxHp, 'the arrow never arrived');
  // the owner's own side shoots through it
  T.place(mira, open.x - 200, open.y);
  mira.skillCd[0] = 0; mira.mana = mira.maxMana;
  const g0 = grom.hp;
  T.place(grom, open.x + 300, open.y);
  assert.ok(mira.castSkill(0, { x: grom.x, y: grom.y }));
  T.frames(G, 50);
  assert.ok(grom.hp < g0, 'an allied skillshot crossed the barrier');
  // a nova through the wall still lands, and units walk through
  grom.doNova({ type: 'nova', radius: 400, dmgType: 'physical', dmg: 50 }, 1);
  assert.ok(bastion.hp < bastion.maxHp, 'novas ignore the barrier');
  const bx = bastion.x;
  grom.cc.clear(); grom.forced = null;
  grom.moveToward(bastion.x, bastion.y, 1);
  assert.ok(grom.x < open.x + 300, 'units pass');
  assert.equal(bastion.x, bx);
  // and it dies with its owner
  bastion.respawnT = 60; bastion.alive = false; G.update(1 / 60);
  assert.equal(G.objects.length, 0);
  bastion.alive = true; bastion.respawnT = 0;
  // without the barrier the same bolt lands
  T.place(zephyr, open.x + 420, open.y);
  bastion.hp = bastion.maxHp;
  zephyr.skillCd[0] = 0;
  assert.ok(zephyr.castSkill(0, { x: bastion.x, y: bastion.y }));
  T.frames(G, 40);
  assert.ok(bastion.hp < bastion.maxHp, 'control: the bolt lands with no barrier');
});

T.done();
