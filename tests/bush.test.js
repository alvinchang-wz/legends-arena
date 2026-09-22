'use strict';
/*
 * Bush concealment, end to end (js/combat.js bushHides / Game.canSee).
 *
 * The rule is one line — a hero standing in a thicket is invisible to the
 * other team — but "invisible" only means something if every system that can
 * act on a hero agrees: bots, minions, turrets, shots already in the air,
 * the minimap and the vision grid. Each of those was its own bug once, so
 * each gets its own check here.
 */
const T = require('./helpers');
const { assert } = T;

const sim = T.makeSim();
const G = sim.Game;
const { Minion, Projectile } = sim.context;
T.parkAll(G);

const grom = T.maxSkills(T.hero(G, 'grom', 0));    // blue: the one who hides
const mira = T.maxSkills(T.hero(G, 'mira', 1));    // red: the one who looks
const tide = T.maxSkills(T.hero(G, 'tide', 1));
const BLUE = 0, RED = 1;

/* The centre of a bush, whatever shape it is. */
function bushCentre(b) {
  if (b.poly) {
    let sx = 0, sy = 0;
    for (const p of b.poly) { sx += p.x; sy += p.y; }
    return { x: sx / b.poly.length, y: sy / b.poly.length };
  }
  if (b.ax !== undefined) return { x: (b.ax + b.bx) / 2, y: (b.ay + b.by) / 2 };
  return { x: b.x, y: b.y };
}

/* A thicket well away from every structure, so no turret or fountain joins
   in, and its index — bushHides compares indices, not shapes. */
const bushes = G.bushes();
let BUSH_I = 0, BUSH_D = -1;
bushes.forEach((b, i) => {
  const c = bushCentre(b);
  let near = Infinity;
  for (const s of G.structures()) near = Math.min(near, Math.hypot(s.x - c.x, s.y - c.y));
  if (near > BUSH_D) { BUSH_D = near; BUSH_I = i; }
});
const BUSH = bushCentre(bushes[BUSH_I]);
const OPEN = T.openSpot(G, 320, { farFromBushes: 400 });

/* No wave, no stray shot: these checks are about one rule and nothing else. */
function quiet() { G.minions.length = 0; G.projectiles.length = 0; }
function frame(n = 1) { for (let i = 0; i < n; i++) { quiet(); G.update(1 / 60); } }

/* Everyone who is not part of a check waits in their own fountain, which is
   the one place on the board that is thousands of units from the thicket,
   the open spot and the turret used below — an extra hero within 72 of the
   hidden one would quietly reveal him and the check would pass for the
   wrong reason. Their own fountain, so nobody gets zapped as an intruder. */
function idle(h) {
  const f = G.fountain(h.team);
  T.place(h, f.x + (G.heroes.indexOf(h) % 3) * 40 - 40, f.y + Math.floor(G.heroes.indexOf(h) / 3) * 40);
}

function reset() {
  G.heroes.forEach((h) => {
    idle(h);
    h.hp = h.maxHp; h.mana = h.maxMana; h.cc.clear(); h.forced = null; h.dashS = null;
    h.dots = []; h.marks = {}; h.markTags = []; h.revealT = 0; h.concealT = 0;
    h.skillCd = [0, 0, 0]; h.buffs = {}; h.recentDmg = []; h.state = null;
    h.untargetable = false; h.aiTarget = null; h.lostTarget = null; h.curTarget = null;
    h.atkCd = 0; h.recalcStats(false);
  });
  quiet();
  G.zones.length = 0;
  G.objects.length = 0;
}

/* Put a hero in the thicket and refresh the frame-cached `bush` index. */
function hide(h) {
  T.place(h, BUSH.x, BUSH.y);
  frame();
  assert.equal(h.bush, BUSH_I, 'the hero really is standing in the test bush');
  h.revealT = 0;
  return h;
}

reset();
frame();

T.test('a hero standing in a bush is invisible to the other team and plainly visible to its own', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 700, BUSH.y);
  frame();
  grom.revealT = 0;
  assert.equal(G.canSee(RED, grom), false, 'the enemy team cannot see into the thicket');
  assert.equal(G.canSee(BLUE, grom), true, 'his own team always can');
  assert.equal(G.heroHidden(grom), true, 'and the renderer / HUD agree');
});

T.test('an enemy hero inside the same bush sees you', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 30, BUSH.y + 20);
  frame();
  grom.revealT = 0;
  assert.equal(mira.bush, BUSH_I, 'she walked into the same thicket');
  assert.equal(G.canSee(RED, grom), true, 'sharing a bush shares the sight line');
  assert.equal(G.heroHidden(grom), false);
});

T.test('an enemy hero within the reveal distance sees you, and one step further out does not', () => {
  reset();
  /* A small planted thicket, so "just outside the leaves but inside the
     reveal radius" is an exact statement rather than a guess at the shape
     of a hand-drawn polygon. BUSH_REVEAL_DIST is 72. */
  const spot = { x: OPEN.x, y: OPEN.y, r: 40 };
  bushes.push(spot);
  const idx = bushes.length - 1;
  try {
    T.place(grom, spot.x, spot.y);
    T.place(mira, spot.x + 65, spot.y);       // outside the leaves, inside the 72
    frame();
    grom.revealT = 0;
    assert.equal(grom.bush, idx, 'he is in the thicket');
    assert.equal(mira.bush, -1, 'she is not');
    assert.equal(G.canSee(RED, grom), true, 'an enemy 65 units away sees him anyway');

    T.place(mira, spot.x + 400, spot.y);
    frame();
    grom.revealT = 0;
    assert.equal(G.canSee(RED, grom), false, 'at 400 units she does not');
    assert.equal(G.visible(RED, grom.x, grom.y), true, 'though her vision still covers the ground');
  } finally {
    bushes.splice(idx, 1);
    for (const h of G.heroes) h.bush = -1;
  }
});

T.test('the vision grid does not leak a hidden hero: an enemy minion lighting the cell changes nothing', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 900, BUSH.y);
  const m = new Minion(RED, 'mid', 'melee', 0, 1);
  m.x = BUSH.x + 300; m.y = BUSH.y; m._px = m.x; m._py = m.y;
  m.path = [{ x: BUSH.x + 300, y: BUSH.y }];
  G.minions.push(m);
  G.update(1 / 60);                          // not `frame`: this one keeps the minion
  grom.revealT = 0;
  assert.equal(G.visible(RED, grom.x, grom.y), true, 'red minion vision does cover the cell');
  assert.equal(G.canSee(RED, grom), false, 'the bush rule still wins over the grid');
  quiet();
});

T.test('an enemy bot never acquires a hidden hero: microTarget, acquireTarget and opportunityAttack all pass him by', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 300, BUSH.y);
  T.place(tide, BUSH.x + 120, BUSH.y + 40);
  frame();
  grom.revealT = 0; tide.bush = -1;
  const proto = Object.getPrototypeOf(mira);
  assert.notEqual(proto.microTarget.call(mira), grom, 'the micro tick does not pick him');
  assert.notEqual(G.acquireTarget(mira, 900, 'hero'), grom, 'neither does the shared acquirer');
  const hp0 = grom.hp;
  tide.atkCd = 0;
  proto.opportunityAttack.call(tide);
  frame(20);
  assert.equal(grom.hp, hp0, 'and the free-swing pass leaves him alone');
});

T.test('a bot already fighting drops a hero who ducks into a bush and walks to the last sighting, not to the hero', () => {
  reset();
  T.place(grom, OPEN.x, OPEN.y);
  T.place(mira, OPEN.x + 320, OPEN.y);
  frame();
  G.brains[RED].updateMemory();
  const proto = Object.getPrototypeOf(mira);
  proto.microThink.call(mira);
  assert.equal(mira.aiTarget, grom, 'out in the open she is fighting him');

  hide(grom);                                 // he steps into the thicket
  proto.microThink.call(mira);
  assert.equal(mira.aiTarget, null, 'the committed target is dropped');
  assert.equal(mira.lostTarget, grom, 'and remembered as lost');
  const mp = mira.micro.movePoint;
  assert.ok(mp, 'she still has somewhere to go');
  assert.ok(Math.hypot(mp.x - OPEN.x, mp.y - OPEN.y) < 90,
    `she walks to where she last saw him (${Math.round(mp.x)},${Math.round(mp.y)} vs ${Math.round(OPEN.x)},${Math.round(OPEN.y)})`);
  assert.ok(Math.hypot(mp.x - grom.x, mp.y - grom.y) > 300, 'never to where he actually is');

  mira.lostTargetT = G.time - 5;              // and she gives up on it
  proto.microThink.call(mira);
  const after = mira.micro.movePoint;
  assert.ok(!after || Math.hypot(after.x - OPEN.x, after.y - OPEN.y) > 90, 'the hunt expires');
});

T.test('a minion does not target a hidden hero, and drops one that hides mid-swing', () => {
  reset();
  T.place(grom, BUSH.x + 260, BUSH.y);
  T.place(mira, BUSH.x + 700, BUSH.y);        // far enough not to reveal him, close enough to light the ground
  frame();
  const m = new Minion(RED, 'mid', 'melee', 0, 1);
  m.x = BUSH.x + 300; m.y = BUSH.y; m._px = m.x; m._py = m.y;
  m.path = [{ x: BUSH.x, y: BUSH.y }, { x: BUSH.x + 600, y: BUSH.y }];
  G.minions.push(m);
  assert.equal(m.pickMinionTarget(), grom, 'in the open the wave does aggro him');
  m.target = grom;

  T.place(grom, BUSH.x, BUSH.y);
  G.update(1 / 60);
  grom.revealT = 0;
  assert.equal(grom.bush, BUSH_I);
  assert.equal(m.pickMinionTarget(), null, 'in the bush he is not on the wave list');
  m.retargetT = 3;                            // no retarget tick: the held target must go on its own
  const hp0 = grom.hp;
  for (let i = 0; i < 60; i++) { G.update(1 / 60); grom.revealT = 0; }
  assert.equal(m.target, null, 'the minion lets go of him');
  assert.equal(grom.hp, hp0, 'and never lands a hit that would reveal him');
  quiet();
});

T.test('a turret does not shoot a hidden hero, and drops one that steps into a bush inside its ring', () => {
  reset();
  const tower = G.structures().find(s => s.team === RED && s.alive && !s.isBase);
  /* No thicket on the 5v5 board sits inside a turret ring, so the test
     plants one there and takes it away again. Game.update assigns the bush
     index from it exactly as it would for any other bush. */
  const spot = { x: tower.x + 200, y: tower.y, r: 130 };
  bushes.push(spot);
  const idx = bushes.length - 1;
  try {
    T.place(grom, tower.x + 200, tower.y + 260);   // inside the ring, outside the thicket
    frame();
    tower.target = null; tower.atkCd = 0; tower.disabledT = 0;
    tower.update(1 / 60);
    assert.equal(tower.target, grom, 'standing in the open under it, he is the target');

    T.place(grom, spot.x, spot.y);
    frame();
    grom.revealT = 0;
    assert.equal(grom.bush, idx, 'he is in the planted thicket');
    assert.equal(G.canSee(RED, grom), false);
    tower.update(1 / 60);
    assert.equal(tower.target, null, 'a turret cannot shoot what its team cannot see');
    const hp0 = grom.hp;
    for (let i = 0; i < 90; i++) { quiet(); G.update(1 / 60); grom.revealT = 0; }
    assert.equal(grom.hp, hp0, 'and it never chips him while he waits');
  } finally {
    bushes.splice(idx, 1);
    for (const h of G.heroes) h.bush = -1;
  }
});

T.test('attacking from a bush reveals the attacker for the reveal duration, and the cover comes back after it', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 200, BUSH.y);
  frame();
  grom.revealT = 0; grom.bush = BUSH_I;
  assert.equal(G.canSee(RED, grom), false, 'quiet in the bush: unseen');

  grom.atkCd = 0;
  grom.tryAttack(mira);                        // Grom is melee: the hit lands now
  frame(3);
  grom.bush = BUSH_I;
  assert.ok(mira.hp < mira.maxHp, 'the swing connected');
  assert.ok(grom.revealT > 1.4, `a basic gives him away (revealT ${grom.revealT.toFixed(2)})`);
  assert.equal(G.canSee(RED, grom), true, 'and the enemy team sees him while it runs');

  T.seconds(G, 1.7);
  grom.bush = BUSH_I;
  assert.ok(grom.revealT <= 0, 'the reveal expires');
  assert.equal(G.canSee(RED, grom), false, 'back in the dark');
});

T.test('casting from a bush reveals too, damage or no damage', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 120, BUSH.y);
  frame();
  grom.revealT = 0; grom.bush = BUSH_I; grom.skillCd = [0, 0, 0]; grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(0, { x: mira.x, y: mira.y }), 'the skill went off');
  assert.ok(grom.revealT > 1.4, `casting gives him away (revealT ${grom.revealT.toFixed(2)})`);

  reset();
  hide(grom);
  T.place(mira, BUSH.x + 3000, BUSH.y);
  frame();
  grom.revealT = 0; grom.bush = BUSH_I; grom.skillCd = [0, 0, 0]; grom.mana = grom.maxMana;
  assert.ok(grom.castSkill(0, { x: BUSH.x + 300, y: BUSH.y }), 'cast into empty air');
  assert.ok(grom.revealT > 1.4, 'still revealed: the cast is the tell, not the hit');
});

T.test('a shot already in the air stops homing when its target ducks into a bush and falls on the last sighting', () => {
  reset();
  T.place(grom, BUSH.x + 700, BUSH.y);
  T.place(mira, BUSH.x + 1400, BUSH.y);
  frame();
  const lastSeen = { x: grom.x, y: grom.y };
  const shot = Projectile.homing(mira, grom, { amount: 40, type: 'physical' });
  G.projectiles.push(shot);
  const hp0 = grom.hp;
  T.place(grom, BUSH.x, BUSH.y);               // he ducks in as it flies
  G.update(1 / 60);
  grom.revealT = 0;
  assert.equal(G.canSee(RED, grom), false);
  for (let i = 0; i < 180 && !shot.dead; i++) {
    G.minions.length = 0;
    G.update(1 / 60);
    grom.revealT = 0;
  }
  assert.ok(shot.dead, 'the shot resolved');
  assert.equal(grom.hp, hp0, 'it did not follow him into the thicket');
  assert.ok(Math.hypot(shot.x - lastSeen.x, shot.y - lastSeen.y) < 160,
    'it died about where it last saw him');
  quiet();
});

T.test('a hidden hero is absent from the enemy minimap data, and back on it the moment he is seen', () => {
  reset();
  hide(grom);
  T.place(mira, BUSH.x + 800, BUSH.y);
  frame();
  grom.revealT = 0; grom.bush = BUSH_I;
  const red = G.minimapHeroes(RED);
  assert.ok(!red.includes(grom), 'red does not get a dot for a hero in a bush');
  assert.ok(red.includes(mira), 'its own heroes are still there');
  assert.ok(G.minimapHeroes(BLUE).includes(grom), 'blue sees its own man');

  grom.revealT = 1.6;                          // he swings, so he shows
  assert.ok(G.minimapHeroes(RED).includes(grom), 'a revealed hero is back on the map');
});

T.done();
