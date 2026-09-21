'use strict';
/* ============================================================
   tests.js — focused deterministic scenario tests for the AI layer.
   Run from the harness page ("Run tests").
   ============================================================ */

function runAITests(log) {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; log(`  PASS  ${name}`); }
    else { fail++; log(`  FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
  };
  const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-3);

  /* start a clean deterministic match and return a blue bot hero */
  function freshMatch(seed) {
    RNG.seed(seed || 42);
    Recorder.enabled = false;
    Game.mode = 'standard';
    Game.experiment = { lineup: LINEUP_IDS.map(id => HEROES.find(h => h.id === id)),
      botTypes: ['heuristic', 'heuristic'] };
    Game.start(null);
    return Game.heroes.find(h => h.team === TEAM_BLUE);
  }
  /* empty the field around a hero so target tests are unambiguous */
  function isolate(hero, { keepStructures = false } = {}) {
    Game.minions.length = 0;
    Game.monsters.length = 0;
    if (!keepStructures) for (const s of Game.structures()) s.alive = false;
    for (const h of Game.heroes) if (h !== hero) { h.x = 3150; h.y = 3150; h.bush = -1; }
    hero.x = 1600; hero.y = 1600; hero.aiTarget = null; hero.aiState = 'push';
    hero.hp = hero.maxHp; hero.mana = hero.maxMana; hero.adapt.caution = 0;
    /* Teleporting everyone leaves the vision grid describing where they USED to
       stand, and canSee() reads that grid — so a target moved into plain sight
       stays invisible until the next update. Without this, tests that check
       target selection pass or fail on what the previous section happened to
       leave behind. */
    Game.updateVision();
  }
  function makeMinion(team, x, y) {
    const m = new Minion(team, 'mid', 'melee');
    m.x = x; m.y = y; m.alive = true; m.hp = m.maxHp;
    Game.minions.push(m);
    return m;
  }
  function enemyHeroFor(hero) { return Game.heroes.find(h => h.team !== hero.team); }

  log('=== AI layer tests ===\n');

  // ---- 1. low-health retreat + observation correctness ----
  {
    const h = freshMatch(1); isolate(h);
    h.hp = h.maxHp * 0.30; h.aiState = 'push';
    const obs = Observation.encode(h);
    const hpOk = near(obs.self[0], 0.30, 0.02);
    const stateOk = obs.self[2] === 0;               // still pushing at observation time
    const early = h.heuristicStateStep();
    ok('1a obs encodes health fraction', hpOk, `got ${obs.self[0].toFixed(3)}`);
    ok('1b obs encodes previous state', stateOk);
    ok('1c teacher enters retreat below 36%', h.aiState === 'retreat' && early === true);
  }

  // ---- 2. retreat hysteresis ----
  {
    const h = freshMatch(2); isolate(h);
    h.hp = h.maxHp * 0.5; h.aiState = 'retreat';
    h.heuristicStateStep();
    ok('2a retreating at 50% stays retreating', h.aiState === 'retreat');
    h.aiState = 'push'; h.hp = h.maxHp * 0.5;
    h.heuristicStateStep();
    ok('2b pushing at 50% stays pushing', h.aiState === 'push');
    h.aiState = 'retreat'; h.hp = h.maxHp * 0.9;
    h.heuristicStateStep();
    ok('2c retreating above 85% resumes pushing', h.aiState === 'push');
  }

  // ---- 3. target preference ----
  {
    let h = freshMatch(3); isolate(h);
    const e = enemyHeroFor(h);
    e.x = h.x + 400; e.y = h.y; e.hp = e.maxHp; e.bush = -1;
    makeMinion(TEAM_RED, h.x + 300, h.y);
    ok('3a full-hp hero outranks a closer minion', h.heuristicSelectTarget() === e);

    h = freshMatch(3); isolate(h);
    const e2 = enemyHeroFor(h);
    e2.x = h.x + 400; e2.y = h.y; e2.hp = e2.maxHp * 0.2; e2.bush = -1;
    const m2 = makeMinion(TEAM_RED, h.x + 200, h.y);
    ok('3b wounded hero outranks an even closer minion', h.heuristicSelectTarget() === e2,
       `chose ${h.heuristicSelectTarget() === m2 ? 'minion' : 'other'}`);

    h = freshMatch(3); isolate(h, { keepStructures: true });
    for (const s of Game.structures()) s.alive = false;
    const tower = Game.towers[0];
    tower.alive = true; tower.hp = tower.maxHp; tower.x = h.x + 200; tower.y = h.y;
    tower.team = TEAM_RED;
    makeMinion(TEAM_RED, h.x + 250, h.y);
    makeMinion(TEAM_BLUE, h.x + 210, h.y);            // cover, so the veto does not fire
    const pick = h.heuristicSelectTarget();
    ok('3c structures are deprioritized vs a similar-distance minion', pick && pick.type === 'minion',
       `chose ${pick && pick.type}`);
  }

  // ---- 4. visibility ----
  {
    const h = freshMatch(4); isolate(h);
    const e = enemyHeroFor(h);
    e.x = h.x + 400; e.y = h.y; e.bush = -1;
    Game.updateVision();
    const cands = Observation.buildCandidates(h);
    ok('4a the standard map has concealing bushes', BUSHES.length >= 8 && Game.bushes().length === BUSHES.length);
    ok('4b the duel arena exposes no bushes', DUEL_MAP.bushes.length === 0);
    ok('4c an enemy in ordinary vision remains targetable',
      cands.some(c => c.u === e) && h.heuristicSelectTarget() === e);
  }

  // ---- 5. tower safety ----
  {
    const h = freshMatch(5); isolate(h, { keepStructures: true });
    for (const s of Game.structures()) s.alive = false;
    const tower = Game.towers[0];
    tower.alive = true; tower.hp = tower.maxHp; tower.team = TEAM_RED;
    tower.x = h.x + 200; tower.y = h.y;
    h.hp = h.maxHp * 0.8;                              // below diveHp 0.95
    let cands = Observation.buildCandidates(h);
    let idx = cands.findIndex(c => c.u === tower);
    let obs = Observation.encode(h);
    ok('5a uncovered structure encodes minionCover = 0',
       idx >= 0 && obs.cand[idx * OBS.CAND_DIM + 12] === 0);
    ok('5b teacher refuses an uncovered tower', h.heuristicSelectTarget() !== tower);

    makeMinion(TEAM_BLUE, tower.x + 100, tower.y);     // now covered
    cands = Observation.buildCandidates(h);
    idx = cands.findIndex(c => c.u === tower);
    obs = Observation.encode(h);
    ok('5c covered structure encodes minionCover = 1',
       idx >= 0 && obs.cand[idx * OBS.CAND_DIM + 12] === 1);

    // neural controller must apply the same hard safety rule
    Game.minions.length = 0;                            // uncover again
    const saved = { ready: NeuralRuntime.ready, score: NeuralRuntime.scoreTargets };
    const towerIdx = Observation.buildCandidates(h).findIndex(c => c.u === tower);
    NeuralRuntime.ready = true;
    NeuralRuntime.scoreTargets = () => {                // pretend the model loves the tower
      const s = new Float32Array(OBS.K + 1).fill(-10);
      s[towerIdx] = 99;
      return s;
    };
    NeuralController.sampling = false;
    const nPick = NeuralController.selectTarget(h);
    ok('5d neural pick of an uncovered tower is rejected', nPick === null, `got ${nPick && nPick.type}`);
    NeuralRuntime.ready = saved.ready; NeuralRuntime.scoreTargets = saved.score;
  }

  // ---- 6. acquisition vs chase are distinct ----
  {
    const h = freshMatch(6); isolate(h);
    const p = h.p;
    ok('6a chase radius exceeds acquire radius', p.chaseRange > p.acquireRange);
    ok('6b candidate radius covers both', OBS.MAX_DIST >= p.chaseRange);
    const e = enemyHeroFor(h);
    e.x = h.x + 600; e.y = h.y; e.bush = -1;            // outside acquire(560), inside chase(720)
    ok('6c enemy beyond acquire radius is not newly acquired', h.heuristicSelectTarget() !== e);
    const cands = Observation.buildCandidates(h);
    const i = cands.findIndex(c => c.u === e);
    const obs = Observation.encode(h);
    ok('6d candidate encodes inNotice=0 / inChase=1 at 600 units',
       i >= 0 && obs.cand[i * OBS.CAND_DIM + 10] === 0 && obs.cand[i * OBS.CAND_DIM + 11] === 1);
    h.aiTarget = e;                                     // already committed: chase keeps it
    h.botControl(1 / 60);
    ok('6e committed target within chase radius is retained', h.aiTarget === e);
    h.aiTarget = e; e.x = h.x + 800;                    // beyond chase 720 -> dropped
    h.botControl(1 / 60);
    ok('6f target beyond chase radius is dropped', h.aiTarget === null);
  }

  // ---- 7. skill eligibility labels ----
  {
    const h = freshMatch(7); isolate(h);
    const e = enemyHeroFor(h);
    e.x = h.x + 120; e.y = h.y; e.hp = e.maxHp * 0.2; e.bush = -1;
    h.skillCd = [9, 9, 9];
    let el = Observation.skillEligibility(h, e);
    ok('7a skills on cooldown are ineligible', el[0] === 0 && el[1] === 0 && el[2] === 0);
    h.skillCd = [0, 0, 0]; h.mana = h.maxMana;
    el = Observation.skillEligibility(h, e);
    ok('7b a ready skill against an in-range hero is eligible', el[0] + el[1] + el[2] > 0,
       `got ${JSON.stringify(el)}`);
    h.mana = 0;
    el = Observation.skillEligibility(h, e);
    ok('7c unaffordable skills are ineligible', el[0] === 0 && el[1] === 0 && el[2] === 0);
    ok('7d no target means no eligibility',
       Observation.skillEligibility(h, null).every(v => v === 0));
  }

  // ---- 8. model failure -> safe fallback ----
  {
    const h = freshMatch(8); isolate(h);
    const e = enemyHeroFor(h);
    e.x = h.x + 300; e.y = h.y; e.bush = -1;

    const badNaN = { schemaVersion: NEURAL_MODEL_SCHEMA, obsVersion: NEURAL_OBSERVATION_VERSION,
      config: { K: OBS.K, selfDim: OBS.SELF_DIM, candDim: OBS.CAND_DIM, hidden: 8 },
      params: { se0w: [NaN], se0b: [0] } };
    ok('8a NaN weights are rejected', NeuralRuntime.loadFromObject(badNaN) === false);

    const badVer = { schemaVersion: NEURAL_MODEL_SCHEMA, obsVersion: 999,
      config: { K: OBS.K, selfDim: OBS.SELF_DIM, candDim: OBS.CAND_DIM, hidden: 8 }, params: {} };
    ok('8b wrong observation version is rejected', NeuralRuntime.loadFromObject(badVer) === false);

    const badDim = { schemaVersion: NEURAL_MODEL_SCHEMA, obsVersion: NEURAL_OBSERVATION_VERSION,
      config: { K: OBS.K, selfDim: OBS.SELF_DIM + 3, candDim: OBS.CAND_DIM, hidden: 8 }, params: {} };
    ok('8c mismatched observation size is rejected', NeuralRuntime.loadFromObject(badDim) === false);

    NeuralRuntime.ready = false;
    h.botType = 'neural';
    h.neuralThink();
    ok('8d neural bot with no model falls back to the teacher target', h.aiTarget === e,
       `got ${h.aiTarget && h.aiTarget.type}`);

    const savedScore = NeuralRuntime.scoreTargets;
    NeuralRuntime.ready = true;
    NeuralRuntime.scoreTargets = () => { throw new Error('boom'); };
    h.aiTarget = null;
    h.neuralThink();
    ok('8e inference exception falls back to the teacher target', h.aiTarget === e);
    ok('8f runtime disables itself after an exception', NeuralRuntime.ready === false);
    NeuralRuntime.scoreTargets = savedScore;
    h.botType = 'heuristic';
  }

  // ---- 9. mixed heuristic + neural match ----
  {
    RNG.seed(9);
    NeuralController.resetStats();
    Game.experiment = { lineup: LINEUP_IDS.map(id => HEROES.find(h => h.id === id)),
      botTypes: ['neural', 'heuristic'] };
    Game.start(null);
    const blueNeural = Game.heroes.filter(h => h.team === TEAM_BLUE && h.botType === 'neural').length;
    const redHeur = Game.heroes.filter(h => h.team === TEAM_RED && h.botType === 'heuristic').length;
    ok('9a bot types are assigned per team', blueNeural === 5 && redHeur === 5);
    let threw = null;
    try { for (let i = 0; i < 4000 && Game.state === 'play'; i++) Game.update(1 / 60); }
    catch (err) { threw = err.message; }
    ok('9b mixed match runs without errors', threw === null, threw);
    ok('9c heroes stayed inside the world', Game.heroes.every(h =>
      h.x >= 0 && h.x <= WORLD && h.y >= 0 && h.y <= WORLD));
    ok('9d hp/mana stayed within bounds', Game.heroes.every(h =>
      h.hp <= h.maxHp + 1e-6 && h.mana <= h.maxMana + 1e-6 && h.hp >= 0));
    ok('9e bot types did not leak between heroes',
      Game.heroes.filter(h => h.botType === 'neural').every(h => h.team === TEAM_BLUE));
    Game.experiment = null;
    RNG.restore();
  }

  // ---- 10. determinism ----
  {
    const run = () => {
      RNG.seed(777);
      Game.mode = 'standard';
      Game.experiment = { lineup: LINEUP_IDS.map(id => HEROES.find(h => h.id === id)),
        botTypes: ['heuristic', 'heuristic'] };
      Game.start(null);
      for (let i = 0; i < 3000; i++) Game.update(1 / 60);
      const sig = Game.heroes.map(h => `${Math.round(h.x)},${Math.round(h.y)},${Math.round(h.hp)}`).join('|');
      Game.experiment = null; RNG.restore();
      return sig;
    };
    ok('10a same seed reproduces the same match state', run() === run());
  }

  /* ---- 10b. the 5v5 board is fair ----
     A 180° turn through the centre swaps the two bases, so it must map every
     feature of the map onto an identical one. Anything that fails these is a
     side advantage no amount of hero tuning can compensate for, and all of it
     is invisible in play — you would only ever see it as a win-rate drift. */
  {
    const rot = p => ({ x: WORLD - p.x, y: WORLD - p.y });
    const twin = (list, p, same = () => true) =>
      list.some(o => dist(o, rot(p)) < 1 && same(o));

    ok('10b bases are a rotated pair', twin(BASES, BASES[0]));
    ok('10c every bush has a rotated twin of the same radius',
      BUSHES.length >= 8 && BUSHES.every(b => twin(BUSHES, b, o => Math.abs(o.r - b.r) < 1)));
    ok('10d every turret has a rotated twin on the other team',
      TOWER_SPOTS.every(t => twin(TOWER_SPOTS, t, o => o.team !== t.team && o.frac === t.frac)));
    ok('10e every inhibitor has a rotated twin on the other team',
      INHIBITOR_SPOTS.every(t => twin(INHIBITOR_SPOTS, t, o => o.team !== t.team)));

    /* The one that actually bit: camp kinds were assigned by index *after* the
       mirroring, so each camp's rotated twin held the opposite buff and one
       team's whole jungle was Sage while the other's was Fury. */
    ok('10f every camp has a rotated twin granting the SAME buff',
      CAMPS.every(c => twin(CAMPS, c, o => o.kind === c.kind)));
    const half = c => dist(c, BASES[0]) < dist(c, BASES[1]) ? 0 : 1;
    const perHalf = [{}, {}];
    for (const c of CAMPS) perHalf[half(c)][c.kind] = (perHalf[half(c)][c.kind] || 0) + 1;
    ok('10g both jungles hold matching buffs, lizards, crabs and a litho',
      JSON.stringify(perHalf[0]) === JSON.stringify(perHalf[1]) &&
      perHalf[0].blueBuff === 1 && perHalf[0].redBuff === 1 &&
      perHalf[0].normal === 8 && perHalf[0].crab === 2 && perHalf[0].litho === 1,
      JSON.stringify(perHalf));

    const pathLen = path => path.slice(1).reduce((sum, p, i) => sum + dist(path[i], p), 0);
    const midLen = pathLen(LANES.mid);
    const sideRatio = Math.max(pathLen(LANES.top), pathLen(LANES.bot)) / midLen;
    ok('10ga square side lanes stay within 48% of mid-lane travel time',
      sideRatio > 1.22 && sideRatio < 1.48, `ratio ${sideRatio.toFixed(2)}`);
    ok('10gb every lane has three turret tiers per team',
      ['top', 'mid', 'bot'].every(lane => [TEAM_BLUE, TEAM_RED].every(team =>
        TOWER_SPOTS.filter(t => t.lane === lane && t.team === team).length === 3)));
    const outerByLane = lane => TOWER_SPOTS.filter(t => t.lane === lane && t.frac >= 0.39);
    const towerThreatRadius = 340 + 42;
    const laneGaps = ['top', 'mid', 'bot'].map(lane => {
      const pair = outerByLane(lane);
      return pair.length === 2 ? dist(pair[0], pair[1]) - towerThreatRadius * 2 : -1;
    });
    ok('10gc every lane leaves a large neutral fighting pocket between outer turrets',
      laneGaps.every(gap => gap > 1100), `safe gaps ${laneGaps.map(x => x.toFixed(0)).join(', ')}`);

    const liveTiers = TOWER_SPOTS.map(s => {
      const t = new Tower(s.x, s.y, s.team, false);
      const hp = s.frac >= 0.39 ? 3200 : s.frac >= 0.26 ? 3700 : 4400;
      t.maxHp = t.hp = hp; t.attrs.base.maxHp = hp;
      return t;
    });
    ok('10gd turret tiers have siege-level health and 45 points of both defenses',
      liveTiers.every(t => t.maxHp >= 3200 && t.armorValue() >= 45 && t.mrValue() >= 45));
    const rampTower = liveTiers[0], dummyHero = { type: 'hero' };
    const towerShots = [0, 1, 2, 3, 4].map(() => rampTower.attackPacket(dummyHero).amount);
    ok('10ge consecutive turret shots punish a hero who stays under fire',
      towerShots[4] > towerShots[0] * 1.8,
      towerShots.map(x => x.toFixed(0)).join(' -> '));

    /* Epic pits sit on the river line, which is the perpendicular bisector of
       the two bases — the only place a shared objective can be neutral. */
    for (const [name, pit] of [['Lord', LORD_PIT], ['Turtle', TURTLE_PIT]]) {
      const db = dist(BASES[0], pit), dr = dist(BASES[1], pit);
      ok(`10h the ${name} pit is the same walk from both bases`,
        Math.abs(db - dr) < 1, `blue ${db.toFixed(0)} vs red ${dr.toFixed(0)}`);
    }
    ok('10i the two epic pits are a rotated pair', dist(rot(LORD_PIT), TURTLE_PIT) < 1);
    // ...and far enough off-lane that a passing wave cannot farm them
    const laneGap = p => Math.min(...Object.values(LANES).flatMap(L => L.map(q => dist(q, p))));
    ok('10j epic pits sit clear of the lanes',
      Math.min(laneGap(LORD_PIT), laneGap(TURTLE_PIT)) > 500);

    /* The pit walls. Same contract as the duel arena's: shape the fight, never
       block the board. Terrain this far from a lane cannot disturb a wave, but
       it CAN swallow a jungle camp — which is exactly what the first placement
       did before these numbers were checked. */
    const wallFace = (walls, x, y) => Math.min(...walls.map(w => {
      const c = wallClosest(w, x, y);
      return Math.hypot(c.x - x, c.y - y) - w.r;
    }));
    const face = (x, y) => wallFace(MAP_WALLS, x, y);
    const epicFace = (x, y) => wallFace(EPIC_WALLS, x, y);
    const nearestWall = p => MAP_WALLS.reduce((best, w, i) => {
      const c = wallClosest(w, p.x, p.y);
      const gap = Math.hypot(c.x - p.x, c.y - p.y) - w.r;
      return gap < best.gap ? { i, gap } : best;
    }, { i: -1, gap: Infinity });
    ok('10o both three-door objective pits are rotated twins', EPIC_WALLS.length === 6 &&
      EPIC_WALLS.every(w => EPIC_WALLS.some(o =>
      o !== w && o.r === w.r && w.pts.every(p => o.pts.some(q => dist(q, rot(p)) < 1)))));
    let worstLane = Infinity, worstLaneInfo = '';
    for (const [laneName, L] of Object.entries(LANES)) for (const p of L) {
      for (let wi = 0; wi < MAP_WALLS.length; wi++) {
        const c = wallClosest(MAP_WALLS[wi], p.x, p.y);
        const gap = Math.hypot(c.x - p.x, c.y - p.y) - MAP_WALLS[wi].r;
        if (gap < worstLane) { worstLane = gap; worstLaneInfo = `${laneName} wall ${wi} @ ${p.x.toFixed(0)},${p.y.toFixed(0)}`; }
      }
    }
    ok('10p terrain leaves every minion route clear', worstLane > 25,
      `nearest ${worstLane.toFixed(0)} (${worstLaneInfo})`);
    ok('10q terrain swallows no camp or turret',
      Math.min(...CAMPS.map(c => face(c.x, c.y) - 40)) > 20 &&
      Math.min(...TOWER_SPOTS.map(t => face(t.x, t.y) - 40)) > 20,
      `camp ${Math.min(...CAMPS.map(c => face(c.x, c.y) - 40)).toFixed(0)} #${CAMPS.reduce((bi,c,i,a) => face(c.x,c.y)-40 < face(a[bi].x,a[bi].y)-40 ? i : bi, 0)} wall ${nearestWall(CAMPS[CAMPS.reduce((bi,c,i,a) => face(c.x,c.y)-40 < face(a[bi].x,a[bi].y)-40 ? i : bi, 0)]).i}, ` +
      `tower ${Math.min(...TOWER_SPOTS.map(t => face(t.x, t.y) - 40)).toFixed(0)}`);
    ok('10r each pit still contains its own centre',
      [LORD_PIT, TURTLE_PIT].every(p => epicFace(p.x, p.y) > 0));
    ok('10ra dense jungle and high-ground terrain exist in symmetric pairs',
      JUNGLE_WALLS.length === 32 && BASE_WALLS.length === 4 &&
      [...JUNGLE_WALLS, ...BASE_WALLS].every(w => MAP_WALLS.some(o => o !== w &&
        o.r === w.r && w.pts.every(p => o.pts.some(q => dist(q, rot(p)) < 1)))));

    /* Walling an objective is only an improvement if you can still get to it.
       A 40-unit flood fill from blue's base has to reach everything that
       matters, or a wall has quietly cut the board in two. */
    const S = 40, N = Math.ceil(WORLD / S), seen = new Uint8Array(N * N), at2 = (i, j) => j * N + i;
    const open = (i, j) => !MAP_WALLS.some(w => wallBlocks(w, i * S + S / 2, j * S + S / 2, 26));
    const stack = [[Math.round(BASES[0].x / S), Math.round(BASES[0].y / S)]];
    seen[at2(stack[0][0], stack[0][1])] = 1;
    while (stack.length) {
      const [i, j] = stack.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N || seen[at2(a, b)] || !open(a, b)) continue;
        seen[at2(a, b)] = 1; stack.push([a, b]);
      }
    }
    const reached = p => !!seen[at2(Math.round(p.x / S), Math.round(p.y / S))];
    ok('10s every objective is still walkable from the enemy base',
      reached(BASES[1]) && reached(LORD_PIT) && reached(TURTLE_PIT) && CAMPS.every(reached),
      `base ${reached(BASES[1])} lord ${reached(LORD_PIT)} turtle ${reached(TURTLE_PIT)} camps ${CAMPS.map((c,i) => `${i}:${c.kind}:${reached(c)}@${Math.round(c.x)},${Math.round(c.y)}`).join(' ')}`);
  }

  /* ---- 10k. role archetypes are honoured ----
     Roles only mean something if they trade. Nyx used to beat the Marksman on
     health, armour, attack, attack speed and move speed at once while topping
     the game in burst, which made the Marksman a strictly worse pick. */
  {
    const at = (id, lv = 15) => {
      const h = new Hero(HEROES.find(x => x.id === id), TEAM_BLUE, false, 'mid');
      h.level = lv; h.skillRank = [4, 4, 3]; h.recalcStats(true);
      return h;
    };
    const ehp = h => h.attrs.get('maxHp') * (1 + h.attrs.get('armor') / 100);
    const [tank, fighter, marksman, support, assassin, mage] =
      ['grom', 'karn', 'zephyr', 'sylva', 'nyx', 'ignis'].map(id => at(id));

    ok('10k the Tank is the most durable hero and the Fighter is next',
      ehp(tank) > ehp(fighter) && ehp(fighter) > ehp(marksman));
    ok('10l the Assassin buys its damage with durability',
      ehp(assassin) < ehp(marksman) && ehp(assassin) < ehp(support) && ehp(assassin) > ehp(mage));
    const dmgStat = h => h.attrs.get('physAtk') * h.attrs.get('atkSpd');
    ok('10m the Assassin still out-damages the Marksman it gave up health to',
      dmgStat(assassin) > dmgStat(marksman));
    /* "Dominated pick" has to be judged on every axis a hero actually trades
       on. Body stats alone would flag every Fighter for out-statting every
       Mage, which is the correct shape of the game — the Mage pays for its
       paper body with range and skill damage. Include those two and the claim
       becomes the real one: no hero is a strictly worse choice than another. */
    const rotation = h => h.skills.slice(0, 2)
      .reduce((s, sk, i) => s + (h.skillDmg(sk, h.skillRank[i]) || 0) * (sk.ticks || 1), 0);
    const axes = h => [h.attrs.get('maxHp'), h.attrs.get('armor'), h.attrs.get('mr'),
      h.attrs.get('physAtk'), h.attrs.get('atkSpd'), h.attrs.get('speed'), h.range, rotation(h)];
    const dominated = [];
    for (const a of HEROES) for (const b of HEROES) {
      if (a === b) continue;
      const A = axes(at(a.id)), B = axes(at(b.id));
      if (A.every((v, i) => v >= B[i])) dominated.push(`${a.name} > ${b.name}`);
    }
    ok('10n no hero is a strictly worse pick than another', dominated.length === 0, dominated.join(', '));
    ok('10na every hero has a unique id, name and passive',
      new Set(HEROES.map(h => h.id)).size === HEROES.length &&
      new Set(HEROES.map(h => h.name)).size === HEROES.length &&
      new Set(HEROES.map(h => h.passive && h.passive.id)).size === HEROES.length);
    ok('10nb the roster is twenty-eight unique heroes', HEROES.length === 28);
  }

  // ---- 11. compact 1v1 duel mode ----
  {
    RNG.seed(111);
    Recorder.enabled = false;
    Game.experiment = null;
    Game.mode = 'duel';
    Game.draft = [[HEROES[0], null, null, null, null], [HEROES[1], null, null, null, null]];
    Game.start(HEROES[0]);
    const bounds = Game.mapBounds();
    ok('11a duel spawns exactly one hero per team',
      Game.heroes.length === 2 && Game.heroes[0].team !== Game.heroes[1].team);
    ok('11b duel removes non-hero map entities',
      Game.minions.length === 0 && Game.monsters.length === 0 && Game.structures().length === 0 && !Game.epics);
    for (let i = 0; i < 240 && Game.state === 'play'; i++) Game.update(1 / 60);
    ok('11c duel never spawns a minion wave', Game.minions.length === 0);
    ok('11d duel heroes stay inside compact bounds', Game.heroes.every(h =>
      h.x >= bounds.minX && h.x <= bounds.maxX && h.y >= bounds.minY && h.y <= bounds.maxY));
    const blue = Game.heroes.find(h => h.team === TEAM_BLUE);
    const red = Game.heroes.find(h => h.team === TEAM_RED);
    const blueBase = Game.fountain(TEAM_BLUE);
    blue.x = blueBase.x; blue.y = blueBase.y;
    blue.hp = blue.maxHp * 0.5; blue.mana = blue.maxMana * 0.5;
    const hpBefore = blue.hp, manaBefore = blue.mana;
    Game.update(0.5);
    ok('11e standing in your duel base restores health and mana',
      blue.hp > hpBefore + blue.maxHp * 0.02 && blue.mana > manaBefore + blue.maxMana * 0.02);

    red.die(blue);
    ok('11f a takedown updates the score without ending the duel',
      Game.state === 'play' && Game.kills[TEAM_BLUE] === 1 && !red.alive);
    for (let i = 0; i < 1000 && !red.alive; i++) Game.update(1 / 60);
    ok('11g the defeated duelist respawns at their base',
      red.alive && dist(red, Game.fountain(TEAM_RED)) < 120);
    Game.time = 301;
    Game.update(1 / 60);
    ok('11h the practice duel has no five-minute forced ending', Game.state === 'play');
    Game.mode = 'standard'; Game.draft = null;
    $('end').classList.add('hidden');
    RNG.restore();
  }

  // ---- 11b. duel arena terrain and the centre shrine ----
  {
    RNG.seed(113);
    Recorder.enabled = false;
    Game.experiment = null;
    Game.mode = 'duel';
    Game.draft = [[HEROES[0], null, null, null, null], [HEROES[1], null, null, null, null]];
    Game.start(HEROES[0]);
    const blue = Game.heroes.find(h => h.team === TEAM_BLUE);
    const red = Game.heroes.find(h => h.team === TEAM_RED);
    const b = Game.mapBounds();
    const shrine = DUEL_MAP.shrine;
    const runeAtStart = { ...Game.duelRune };

    /* The arena is symmetric under a 180° turn through its centre: for every
       feature there is a twin the same distance from the other base. Without
       this, one duellist simply has the better half. */
    const twin = p => ({ x: b.minX + b.maxX - p.x, y: b.minY + b.maxY - p.y });
    const hasFeature = (list, p) => list.some(q => dist(q, p) < 1);
    ok('11i the duel arena has no bushes', DUEL_MAP.bushes.length === 0);
    ok('11j the two duel bases are twins and the shrine sits between them',
      hasFeature(DUEL_MAP.fountains, twin(DUEL_MAP.fountains[0])) &&
      near(dist(DUEL_MAP.fountains[0], shrine), dist(DUEL_MAP.fountains[1], shrine), 1));
    ok('11k every duel feature is inside the arena bounds',
      DUEL_MAP.bushes.concat([shrine], DUEL_MAP.fountains).every(p =>
        p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY));

    // With bushes disabled, duelists never acquire concealment and the arena's
    // normal no-fog rule keeps opponents visible.
    blue.x = shrine.x - 350; blue.y = shrine.y;
    red.x = shrine.x + 350; red.y = shrine.y;
    Game.update(1 / 60);
    ok('11l a duellist never acquires bush occupancy', blue.bush === -1 && red.bush === -1);
    ok('11m opponents remain visible across the arena', Game.canSee(TEAM_RED, blue));
    blue.x = shrine.x; blue.y = shrine.y - 600;
    Game.update(1 / 60);
    ok('11n moving around cannot create hidden bush state',
      blue.bush === -1 && Game.canSee(TEAM_RED, blue));

    // the shrine rune: spawns on a clock, is taken by standing on it, and the
    // next one is a different rune
    ok('11o the shrine rune starts on a clock, not on the ground',
      !runeAtStart.up && runeAtStart.next === Game.SHRINE_FIRST &&
      !Game.duelRune.up && Game.duelRune.next < runeAtStart.next &&
      Game.objectiveState()[0].key === 'shrine');
    blue.x = b.minX + 60; blue.y = b.maxY - 60;
    red.x = b.maxX - 60; red.y = b.minY + 60;
    Game.duelRune.next = 1 / 120;
    Game.update(1 / 60);
    const firstKind = Game.duelRune.kind;
    ok('11p the rune appears when its clock runs out', Game.duelRune.up);
    Game.update(1 / 60);
    ok('11q the rune waits on the shrine until someone stands on it',
      Game.duelRune.up && !Object.keys(blue.runes).length && !Object.keys(red.runes).length);
    red.x = shrine.x; red.y = shrine.y;
    Game.update(1 / 60);
    ok('11r walking onto the shrine takes the rune, on the duel\'s short timer',
      !Game.duelRune.up && near(red.runes[firstKind], Game.SHRINE_DUR, 0.05) &&
      near(Game.duelRune.next, Game.SHRINE_RESPAWN, 0.05));
    ok('11s the shrine alternates runes, so it is not the same buff twice',
      Game.duelRune.kind !== firstKind && JUNGLE_BUFFS[Game.duelRune.kind]);
    ok('11t the rune the shrine granted actually buffs its taker',
      red.attrs.get('physAtk') > new Hero(red.def0, TEAM_RED, false, 'duel').attrs.get('physAtk'));

    // a bot with nothing to fight walks to a live rune rather than past it
    Game.duelRune.up = true;
    red.x = shrine.x + 900; red.y = shrine.y + 900;
    red.hp = red.maxHp; red.aiTarget = null; red.aiState = 'push';
    blue.x = b.minX + 60; blue.y = b.maxY - 60;   // far away, nothing to chase
    const before = dist(red, shrine);
    for (let i = 0; i < 90; i++) { red.aiTarget = null; Game.update(1 / 60); }
    ok('11u an idle duel bot walks to a live shrine rune',
      dist(red, shrine) < before - 60, `${before.toFixed(0)} -> ${dist(red, shrine).toFixed(0)}`);

    Game.mode = 'standard'; Game.draft = null;
    $('end').classList.add('hidden');
    RNG.restore();
  }

  // ---- 11c. duel arena walls ----
  {
    RNG.seed(114);
    Recorder.enabled = false;
    Game.experiment = null;
    Game.mode = 'duel';
    Game.draft = [[HEROES[0], null, null, null, null], [HEROES[1], null, null, null, null]];
    Game.start(HEROES[0]);
    const hero = Game.heroes.find(h => h.team === TEAM_BLUE);
    const foe = Game.heroes.find(h => h.team === TEAM_RED);
    const S = DUEL_MAP.shrine;
    const W = Game.walls();
    /* Distance from a point to the nearest wall *face* (negative = inside it). */
    const faceDist = (x, y) => Math.min(...W.map(w => {
      const c = wallClosest(w, x, y);
      return Math.hypot(c.x - x, c.y - y) - w.r;
    }));
    const park = u => { u.x = DUEL_MAP.bounds.minX + 60; u.y = DUEL_MAP.bounds.maxY - 60; };

    ok('11v both boards carry terrain, and each gets its own set',
      W.length === 4 && W !== MAP_WALLS &&
      (Game.mode = 'standard', Game.walls() === MAP_WALLS && MAP_WALLS.length >= 20));
    Game.mode = 'duel';

    /* The layout constraints that are easy to break by nudging one number:
       terrain must not narrow a route below a hero's width, and must not eat
       the shrine or a base. */
    let worstLane = Infinity;
    for (const path of Object.values(DUEL_MAP.lanes))
      for (const p of path) worstLane = Math.min(worstLane, faceDist(p.x, p.y));
    ok('11w walls leave every route walkable', worstLane > hero.radius + 40,
      `narrowest half-corridor ${worstLane.toFixed(0)} vs hero radius ${hero.radius}`);
    ok('11x walls do not overlap the shrine or a base',
      faceDist(S.x, S.y) > S.r &&
      DUEL_MAP.fountains.every(f => faceDist(f.x, f.y) > 300));
    ok('11y each wall has a 180°-rotated twin',
      W.every(w => W.some(o => o !== w && o.r === w.r && w.pts.every(p =>
        o.pts.some(q => dist(q, { x: DUEL_MAP.bounds.minX + DUEL_MAP.bounds.maxX - p.x,
                                  y: DUEL_MAP.bounds.minY + DUEL_MAP.bounds.maxY - p.y }) < 1)))));

    // walking into a wall stops you, and does not put you inside it
    park(foe);
    const arc = W[0], mid = arc.pts[Math.floor(arc.pts.length / 2)];
    hero.x = mid.x + (mid.x - S.x); hero.y = mid.y + (mid.y - S.y);
    hero.slideDir = null;
    for (let i = 0; i < 60; i++) { hero.moveToward(S.x, S.y, 1 / 60); Game.separate(); }
    ok('11z a wall stops a hero walking into it',
      dist(hero, S) > 300 && !Game.wallAt(hero.x, hero.y, hero.radius));

    /* ...but it must not trap them. A hero pushing at any point of the pit has
       to find a doorway, or a duel ends with someone stuck on a rock. */
    const times = [];
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8;
      hero.x = S.x + Math.cos(a) * 640; hero.y = S.y + Math.sin(a) * 640;
      hero.slideDir = null;
      let t = -1;
      for (let f = 0; f < 900; f++) {
        hero.moveToward(S.x, S.y, 1 / 60); Game.separate();
        if (dist(hero, S) < S.r) { t = f; break; }
      }
      times.push(t);
    }
    ok('11aa a hero walking at the shrine always finds a way into the pit',
      times.every(t => t >= 0), `frames: ${times.join(',')}`);
    ok('11ab entering the pit off the lane axis costs real time',
      Math.max(...times) > Math.min(...times) * 1.5);

    // dashes ignore terrain — that is what makes a wall an escape tool
    hero.x = mid.x + (mid.x - S.x); hero.y = mid.y + (mid.y - S.y);
    const d0 = dist(hero, S);
    const dir = { x: (S.x - hero.x) / d0, y: (S.y - hero.y) / d0 };
    hero.dashS = { dx: dir.x, dy: dir.y, speed: 1200, remaining: 520, hitSet: new Set(), s: {} };
    for (let i = 0; i < 120 && hero.dashS; i++) Game.update(1 / 60);
    ok('11ac a dash crosses a wall the same hero could not walk through',
      dist(hero, S) < 300 && !Game.wallAt(hero.x, hero.y, hero.radius));

    Game.mode = 'standard'; Game.draft = null;
    $('end').classList.add('hidden');
    RNG.restore();
  }

  // ---- 12. keyboard release-to-cast controls ----
  {
    RNG.seed(112);
    Game.mode = 'duel';
    Game.draft = [[HEROES[0], null, null, null, null], [HEROES[1], null, null, null, null]];
    Game.start(HEROES[0]);
    Input.casts.length = 0;
    Input.spellQueued = null;
    Input.mouse.seen = false;
    Input.releaseAim = true;

    Input.beginKeyboardAim(0, 'Digit1');
    ok('12a holding a skill key starts aiming without casting',
      Input.aim.active && Input.aim.skill === 0 && Input.casts.length === 0);
    Input.finishKeyboardAim('Digit1');
    ok('12b a quick skill tap keeps normal auto-aim casting',
      !Input.aim.active && Input.casts.length === 1 && Input.casts[0].dir === null);

    Input.casts.length = 0;
    Input.beginKeyboardAim(0, 'Digit1');
    Input.aim.startedAt -= Input.QUICK_CAST_MS + 1;
    Input.finishKeyboardAim('Digit1');
    ok('12c a held skill uses the mouse aim on release',
      Input.casts.length === 1 && Input.casts[0].dir);

    Input.beginKeyboardAim(-1, 'KeyF', true);
    ok('12d holding F starts battle-spell aiming without casting',
      Input.aim.active && Input.aim.spell && Input.spellQueued === null);
    Input.aim.startedAt -= Input.QUICK_CAST_MS + 1;
    Input.finishKeyboardAim('KeyF');
    ok('12e releasing held F queues the aimed battle spell',
      !Input.aim.active && Input.spellQueued && Input.spellQueued.dir);

    Input.spellQueued = null;
    Input.beginKeyboardAim(-1, 'KeyF', true);
    Input.finishKeyboardAim('KeyF');
    ok('12f a quick F tap keeps normal battle-spell targeting',
      Input.spellQueued && Input.spellQueued.dir === null);

    Input.casts.length = 0;
    Input.beginKeyboardAim(1, 'Digit2');
    Input.cancelAim();
    Input.finishKeyboardAim('Digit2');
    ok('12g cancelling an aimed skill prevents its key release from casting',
      !Input.aim.active && Input.casts.length === 0);

    Input.spellQueued = null;
    Input.beginKeyboardAim(-1, 'KeyF', true);
    Input.cancelAim();
    Input.finishKeyboardAim('KeyF');
    ok('12h cancelling an aimed battle spell prevents it from casting',
      !Input.aim.active && Input.spellQueued === null);

    Input.casts.length = 0;
    Input.spellQueued = null;
    Input.releaseAim = false;
    Game.mode = 'standard'; Game.draft = null;
    RNG.restore();
  }

  // ---- 13. precision targeting, build guidance, and terrain modifier ----
  {
    const h = freshMatch(130); isolate(h);
    const enemies = Game.heroes.filter(x => x.team !== h.team);
    const close = enemies[0], wounded = enemies[1];
    close.x = h.x + 250; close.y = h.y; close.hp = close.maxHp; close.bush = -1;
    wounded.x = h.x + 560; wounded.y = h.y; wounded.hp = wounded.maxHp * 0.08; wounded.bush = -1;
    const minion = makeMinion(TEAM_RED, h.x + 100, h.y);
    Game.updateVision();

    ok('13a HERO attack excludes a closer minion',
      Game.acquireTarget(h, 800, 'hero', 'nearest') === close);
    ok('13b lowest-HP targeting prefers a wounded hero farther away',
      Game.acquireTarget(h, 800, 'hero', 'lowHp') === wounded);
    ok('13c nearest targeting prefers the closer hero',
      Game.acquireTarget(h, 800, 'hero', 'nearest') === close);
    ok('13d LANE attack excludes heroes',
      Game.acquireTarget(h, 800, 'lane', 'nearest') === minion);
    ok('13e a visible nearby hero is a valid portrait lock',
      Game.validLockedTarget(h, wounded, 700) && !Game.validLockedTarget(h, wounded, 400));
    ok('13k mouse over a minion attacks that minion, not the low-HP hero',
      Game.acquireTarget(h, 800, 'auto', 'lowHp', { x: minion.x, y: minion.y }) === minion);
    ok('13l mouse over a distant hero attacks that hero, not the closer one',
      Game.acquireTarget(h, 800, 'auto', 'nearest', { x: wounded.x, y: wounded.y }) === wounded);

    const hit = Game.basicAttackDamage(h, minion);
    minion.hp = hit;
    ok('13f last-hit guidance uses post-armor attack damage', Game.canLastHit(h, minion));
    minion.hp = hit + 1;
    ok('13g last-hit guidance does not mark a surviving minion', !Game.canLastHit(h, minion));

    h.items.length = 0; h.gold = 10000; h.recalcStats(false);
    const first = ItemAI.recommend(h, true);
    ok('13h Quick Buy produces an affordable role-aware item', first && first.cost <= h.gold);
    h.buyItem(first);
    const second = ItemAI.recommend(h, true);
    ok('13i Quick Buy never recommends an owned duplicate', second && second.id !== first.id);

    Game.mode = 'standard'; h.inRiver = false;
    const landSpeed = h.curSpeed();
    h.inRiver = true;
    ok('13j Aether Current grants exactly 12% movement speed', near(h.curSpeed() / landSpeed, 1.12, 0.001));
    Game.draft = null;
    RNG.restore();
  }

  /* ---- 14. tactical bot behaviour: telegraphs and escapes ---- */
  {
    const h = freshMatch(14); isolate(h);
    const foe = enemyHeroFor(h);
    foe.x = h.x + 900; foe.y = h.y;
    const zone = (owner, opts, x, y) => {
      Game.zones.length = 0;
      const z = new Zone(owner, { radius: 200, delay: 0.9, dmgType: 'magic', dmg: 100, ...opts }, x, y);
      Game.zones.push(z);
      return z;
    };
    h.avoidsZones = true;

    // near the edge of a telegraph, with time to walk out: go
    zone(foe, {}, h.x + 150, h.y);
    ok('14a a bot steps out of a telegraph it can clear in time', h.dodgeZones(1 / 60) === true);
    const escaping = zone(foe, {}, h.x + 150, h.y);
    const startD = dist(h, escaping);
    for (let i = 0; i < 54; i++) h.dodgeZones(1 / 60);      // the 0.9s warning
    ok('14b ...and is outside the circle by the time it fires',
      dist(h, escaping) > startD && dist(h, escaping) > escaping.radius + h.radius,
      `${startD.toFixed(0)} -> ${dist(h, escaping).toFixed(0)} vs radius ${escaping.radius}`);

    isolate(h);
    /* A hit is binary, so a dodge that half-works costs the same seconds and
       still eats the damage. Dead centre of a circle far wider than the bot can
       cross, it should keep doing something useful instead. */
    zone(foe, { radius: 900, delay: 0.2 }, h.x, h.y);
    ok('14c a bot does not chase a telegraph it cannot escape', h.dodgeZones(1 / 60) === false);
    zone(foe, { delay: 0 }, h.x, h.y);
    ok('14d a zone already firing is not worth dodging', h.dodgeZones(1 / 60) === false);
    zone(h, {}, h.x, h.y);
    ok('14e a bot does not flee its own zone', h.dodgeZones(1 / 60) === false);
    zone(foe, {}, h.x + 150, h.y);
    h.avoidsZones = false;
    ok('14f the dodge is switchable, so a mirrored A/B can price it',
      h.dodgeZones(1 / 60) === false);
    h.avoidsZones = true;
    Game.zones.length = 0;

    /* Escapes. botCast is only reached with a target and a retreating bot has
       none, so without this a fleeing hero dies holding an unused dash. */
    const runner = Game.heroes.find(x => x.team === TEAM_BLUE && x.skills.some(s => s.type === 'dash'));
    const dashIdx = runner.skills.findIndex(s => s.type === 'dash');
    const setupFlight = () => {
      isolate(runner);
      runner.skillRank = [1, 1, 0]; runner.skillCd = [0, 0, 0];
      runner.mana = runner.maxMana; runner.dashS = null;
      runner.hp = runner.maxHp * 0.2; runner.aiState = 'push';
      const chaser = enemyHeroFor(runner);
      chaser.x = runner.x - 300; chaser.y = runner.y; chaser.alive = true;
      Game.updateVision();
      return chaser;
    };
    const chaser = setupFlight();
    runner.escapeCasts = true;
    runner.heuristicStateStep();
    ok('14g a retreating bot spends its dash instead of dying with it ready',
      runner.aiState === 'retreat' && runner.skillCd[dashIdx] > 0);
    ok('14h ...and dashes away from the chaser, not into it',
      runner.dashS && runner.dashS.dx * Math.sign(runner.x - chaser.x) > 0,
      runner.dashS ? `dx ${runner.dashS.dx.toFixed(2)}` : 'no dash');

    setupFlight();
    runner.escapeCasts = false;
    runner.heuristicStateStep();
    ok('14i the escape is switchable too', runner.skillCd[dashIdx] === 0);
    runner.escapeCasts = true;

    /* The battle spell had the same never-reached bug as the skills: its only
       other call site is inside botCast, which needs a target a retreating bot
       does not have. Flicker is the clearest case — a survival tool held to
       the grave. */
    const flee = setupFlight();
    runner.spell = SPELL_BY_ID.flicker;
    runner.spellCd = 0;
    runner.hp = runner.maxHp * 0.15;                // below the spell's own gate
    runner.heuristicStateStep();
    ok('14j a retreating bot reaches for its battle spell too',
      runner.spellCd > 0, `spellCd ${runner.spellCd}`);

    setupFlight();
    runner.spell = SPELL_BY_ID.flicker;
    runner.spellCd = 0; runner.hp = runner.maxHp * 0.15;
    runner.escapeCasts = false;
    runner.heuristicStateStep();
    ok('14k ...and that is switchable with the rest of the escape kit',
      runner.spellCd === 0);
    runner.escapeCasts = true;
    Game.zones.length = 0;

    /* ---- terrain awareness ----
       Dashes ignore walls, which is the whole reason a wall is an escape tool.
       A bot that only ever dashes straight away wastes that: the same distance
       spent crossing a rock makes the chaser walk round it. Set the chaser
       ALONGSIDE a wall, so the straight-away direction runs parallel to it and
       only a scored choice finds the crossing. */
    if (MAP_WALLS.length) {
      const w = MAP_WALLS[0];
      const i = Math.floor(w.pts.length / 2);
      const a0 = w.pts[i], a1 = w.pts[Math.min(i + 1, w.pts.length - 1)];
      const tx = a1.x - a0.x, ty = a1.y - a0.y, m = Math.hypot(tx, ty) || 1;
      const ux = tx / m, uy = ty / m, nx = -uy, ny = ux;
      isolate(runner);
      runner.skillRank = [1, 1, 0]; runner.skillCd = [0, 0, 0];
      runner.mana = runner.maxMana; runner.dashS = null;
      runner.hp = runner.maxHp * 0.2; runner.aiState = 'push';
      runner.x = a0.x + nx * (w.r + 70); runner.y = a0.y + ny * (w.r + 70);
      const near = enemyHeroFor(runner);
      near.x = runner.x + ux * 300; near.y = runner.y + uy * 300; near.alive = true;
      Game.updateVision();
      runner.heuristicStateStep();
      const D = runner.skills[dashIdx].dist;
      const lx = runner.x + (runner.dashS ? runner.dashS.dx : 0) * D;
      const ly = runner.y + (runner.dashS ? runner.dashS.dy : 0) * D;
      ok('14l a fleeing bot dashes ACROSS terrain to break the chase',
        runner.dashS && !!Game.wallOnSegment(lx, ly, near.x, near.y, near.radius, 900));
      ok('14m ...and never lands inside the wall it crossed',
        runner.dashS && !Game.wallAt(lx, ly, runner.radius));
    }

    /* Routing is a rescue, not a plan: a bot only goes round a wall's end once
       sliding along it has stopped closing the distance. Routing on every
       blocked sight-line measured WORSE (24/40 journeys completed vs 34/40). */
    {
      isolate(runner);
      /* The revamped centre contains real objective terrain, so find an
         actually open bearing instead of assuming due-east is empty. */
      let goal = null;
      for (let i = 0; i < 16 && !goal; i++) {
        const a = i * TAU / 16;
        const p = { x: runner.x + Math.cos(a) * 400, y: runner.y + Math.sin(a) * 400 };
        if (Game.navSegmentClear(runner, runner, p, { avoidTowers: false })) goal = p;
      }
      runner.routeVia = null;
      runner.botMoveTo(goal.x, goal.y, 1 / 60);
      ok('14n a bot with a clear path just walks it',
        goal && runner.routeVia && runner.routeVia.aim === null);
    }

    /* Dense jungle travel needs a complete route, not a collision response.
       Put the bot directly across one ridge: A* must immediately choose a legal
       end, and following that route must actually deliver the hero. */
    {
      isolate(runner);
      const w = JUNGLE_WALLS[0];
      const a = w.pts[0], b = w.pts[w.pts.length - 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y, dm = Math.hypot(dx, dy) || 1;
      const nx = -dy / dm, ny = dx / dm, side = w.r + runner.radius + 150;
      runner.x = mx + nx * side; runner.y = my + ny * side;
      const goal = { x: mx - nx * side, y: my - ny * side };
      runner.nav.path.length = 0; runner.nav.gx = runner.nav.gy = NaN; runner.nav.repath = 0;
      const blocked = !!Game.wallOnSegment(runner.x, runner.y, goal.x, goal.y, runner.radius + 8, 1000);
      const route = Game.findNavPath(runner, goal, { avoidTowers: false });
      ok('14o a blocked journey produces a complete map-aware route immediately',
        blocked && route.length >= 2, `blocked ${blocked}, waypoints ${route.length}`);
      ok('14p every planned waypoint has hero-sized wall clearance',
        route.every(p => !Game.wallAt(p.x, p.y, runner.radius + 4)));
      const before = dist(runner, goal);
      for (let i = 0; i < 720 && dist(runner, goal) > 70; i++) {
        runner.botMoveTo(goal.x, goal.y, 1 / 60, { avoidTowers: false });
        Game.separate();
      }
      ok('14q the bot follows that route around the ridge instead of sticking to it',
        dist(runner, goal) < 70, `${before.toFixed(0)} -> ${dist(runner, goal).toFixed(0)}`);
    }
  }

  /* ---- 15. advanced bot decisions: power, economy, focus and secures ---- */
  {
    // Fight strength: two healthy enemies are dangerous; two nearly dead
    // enemies are an opportunity, even though the raw headcount is identical.
    let h = freshMatch(150); isolate(h);
    let enemies = Game.heroes.filter(x => x.team !== h.team);
    for (let i = 0; i < 2; i++) {
      enemies[i].x = h.x + 260 + i * 60; enemies[i].y = h.y;
      enemies[i].hp = enemies[i].maxHp; enemies[i].bush = -1;
    }
    Game.updateVision();
    ok('15a a lone bot disengages from two healthy visible enemies',
      h.heuristicStateStep() && h.fleeT > 0);
    h.fleeT = 0;
    for (let i = 0; i < 2; i++) enemies[i].hp = enemies[i].maxHp * 0.02;
    ok('15b power evaluation does not flee the same two enemies at critical HP',
      h.heuristicStateStep() === false && h.fleeT === 0);

    // Focus fire and target stickiness prevent five independent duels and
    // target thrashing inside one teamfight.
    h = freshMatch(151); isolate(h);
    enemies = Game.heroes.filter(x => x.team !== h.team);
    const nearEnemy = enemies[0], focusedEnemy = enemies[1];
    nearEnemy.x = h.x + 280; nearEnemy.y = h.y; nearEnemy.hp = nearEnemy.maxHp; nearEnemy.bush = -1;
    focusedEnemy.x = h.x + 330; focusedEnemy.y = h.y; focusedEnemy.hp = focusedEnemy.maxHp; focusedEnemy.bush = -1;
    const ally = Game.heroes.find(x => x !== h && x.team === h.team);
    ally.x = h.x - 80; ally.y = h.y; ally.aiTarget = focusedEnemy; ally.hp = ally.maxHp;
    Game.updateVision();
    ok('15c a bot joins an ally\'s focus target instead of starting another duel',
      h.heuristicSelectTarget() === focusedEnemy);
    ally.aiTarget = null; h.aiTarget = focusedEnemy;
    ok('15d target stickiness prevents a trivial distance-based target switch',
      h.heuristicSelectTarget() === focusedEnemy);

    // Wave intelligence: take the actual last hit over a nearer healthy minion.
    for (const e of enemies) { e.x = 3400; e.y = 3400; }
    h.aiTarget = null; Game.minions.length = 0;
    const healthyMinion = makeMinion(TEAM_RED, h.x + 170, h.y);
    const killableMinion = makeMinion(TEAM_RED, h.x + 310, h.y);
    killableMinion.hp = Game.basicAttackDamage(h, killableMinion);
    Game.updateVision();
    ok('15e a bot secures a killable minion instead of hitting the nearest healthy one',
      h.heuristicSelectTarget() === killableMinion && healthyMinion.alive);

    // Tower discipline applies to heroes as well as the structure itself.
    h = freshMatch(152); isolate(h, { keepStructures: true });
    for (const s of Game.structures()) s.alive = false;
    const tower = Game.towers[0];
    tower.alive = true; tower.hp = tower.maxHp; tower.team = TEAM_RED;
    tower.x = h.x + 330; tower.y = h.y;
    const guarded = enemyHeroFor(h);
    guarded.x = tower.x + 30; guarded.y = tower.y; guarded.hp = guarded.maxHp; guarded.bush = -1;
    Game.updateVision();
    ok('15f a bot refuses to chase a healthy hero under an uncovered turret',
      h.heuristicSelectTarget() !== guarded);
    makeMinion(TEAM_BLUE, tower.x + 40, tower.y);
    ok('15g an allied wave makes that same turret fight legal', h.heuristicSelectTarget() === guarded);

    // Economy: recall when a complete item is affordable, but never channel in
    // front of an enemy. The purchase still occurs through the normal shop AI.
    h = freshMatch(153); isolate(h);
    Game.time = 60;
    const nextItem = ItemAI.recommend(h);
    h.gold = Math.max(h.p.shopRecallMinGold, nextItem.cost);
    Game.updateVision();
    ok('15h a safe bot recalls to convert banked gold into an item',
      h.heuristicStateStep() && h.recallT > 0);
    h.recallT = 0;
    const pressure = enemyHeroFor(h);
    pressure.x = h.x + 350; pressure.y = h.y; pressure.hp = pressure.maxHp; pressure.bush = -1;
    Game.updateVision();
    ok('15i visible enemy pressure prevents an economy recall', !h.shouldEconomyRecall());
    pressure.x = 3400; pressure.y = 3400;
    const fountain = Game.fountain(h.team); h.x = fountain.x; h.y = fountain.y;
    const slotsBefore = h.items.length;
    ok('15j arriving home converts that gold through the normal item AI',
      ItemAI.tryBuy(h) && h.items.length === slotsBefore + 1);

    // Supports read ally health, not only their own bar.
    h = freshMatch(154); isolate(h);
    const healer = new Hero(HEROES.find(x => x.id === 'sylva'), h.team, false, 'mid');
    healer.x = h.x + 30; healer.y = h.y; healer.skillRank = [1, 1, 0]; healer.skillCd = [0, 0, 0];
    healer.mana = healer.maxMana; healer.p.castChance = 1; healer.advancedAI = true;
    Game.heroes.push(healer);
    h.hp = h.maxHp * 0.3;
    const foe = enemyHeroFor(h); foe.x = healer.x + 220; foe.y = healer.y; foe.bush = -1;
    const healIdx = healer.skills.findIndex(s => s.type === 'heal');
    const allyHpBefore = h.hp;
    healer.botCast(foe);
    ok('15k a support heals a wounded ally while personally healthy',
      healer.skillCd[healIdx] > 0 && h.hp > allyHpBefore);

    // Objective spell timing is based on exact damage and explicitly targets
    // the epic, even if a normal camp is physically closer.
    h = freshMatch(155); isolate(h);
    h.spell = SPELL_BY_ID.retribution; h.spellCd = 0;
    const normal = new Monster({ x: h.x + 80, y: h.y }); normal.hp = 400;
    const epic = new EpicMonster('turtle', { x: h.x + 180, y: h.y }); epic.hp = 700;
    Game.monsters = [normal, epic];
    h.botCastSpell(epic);
    ok('15l Retribution secures the epic instead of the closer normal camp',
      !epic.alive && normal.hp === 400 && h.spellCd > 0);
    const early = new EpicMonster('turtle', { x: h.x + 180, y: h.y }); early.hp = 801;
    Game.monsters = [early]; h.spellCd = 0;
    h.botCastSpell(early);
    ok('15m Retribution is held one HP outside its exact secure threshold',
      early.alive && early.hp === 801 && h.spellCd === 0);

    // Purify must be usable during the disable it exists to answer.
    h.spell = SPELL_BY_ID.purify; h.spellCd = 0;
    h.cc.apply('stun', 1, 0);
    h.update(1 / 60);
    ok('15n a stunned bot immediately spends Purify and resumes acting',
      h.spellCd > 0 && h.cc.canAct);

    Game.mode = 'standard'; Game.draft = null; Game.monsters.length = 0;
    RNG.restore();
  }

  /* ---- 16. anti-snowball economy ---- */
  {
    const maxLevelVictim = { level: BALANCE.maxLevel };
    ok('16a a max-level base kill is capped at 310 gold',
      BALANCE.heroKillGold(maxLevelVictim) === 310);
    ok('16b four assists split one fixed pool instead of multiplying team gold',
      near(BALANCE.assistGoldPool / 4 * 4, 110));
    ok('16c a seven-kill streak carries the capped 280 shutdown bounty',
      BALANCE.shutdownGold(7) === 280 && BALANCE.shutdownGold(20) === 280);

    let killer = freshMatch(160); isolate(killer);
    let victim = enemyHeroFor(killer);
    victim.level = BALANCE.maxLevel; victim.deathStreak = 4; victim.streak = 0;
    const feedBefore = killer.goldEarned;
    victim.die(killer);
    ok('16d repeatedly farming one victim falls to the 50% reward floor',
      near(killer.goldEarned - feedBefore, BALANCE.heroKillGold(maxLevelVictim) * BALANCE.repeatDeathFloor));

    killer = freshMatch(161); isolate(killer);
    victim = enemyHeroFor(killer);
    victim.level = BALANCE.maxLevel; victim.streak = 7; victim.deathStreak = 0;
    killer.deathStreak = 3;
    const shutdownBefore = killer.goldEarned;
    victim.die(killer);
    ok('16e ending a fed streak pays a meaningful but bounded shutdown',
      near(killer.goldEarned - shutdownBefore, 700) && killer.deathStreak === 0);

    killer = freshMatch(162); isolate(killer);
    victim = enemyHeroFor(killer);
    const assisters = Game.heroes.filter(h => h.team === killer.team && h !== killer).slice(0, 4);
    victim.recentDmg = [{ h: killer, t: Game.time },
      ...assisters.map(h => ({ h, t: Game.time }))];
    const assistBefore = assisters.map(h => h.goldEarned);
    victim.die(killer);
    const assistTotal = assisters.reduce((sum, h, i) => sum + h.goldEarned - assistBefore[i], 0);
    ok('16f a real four-player assist awards exactly one 110-gold team pool',
      near(assistTotal, BALANCE.assistGoldPool) && assisters.every(h => h.assists === 1));

    freshMatch(163);
    Game.mode = 'standard';
    for (const h of Game.heroes) h.goldEarned = h.team === TEAM_RED ? 1600 : 0;
    ok('16g passive comeback income starts only after a 2k deficit and caps at 0.45/s',
      near(Game.comebackGoldRate(TEAM_BLUE), 0.45) && Game.comebackGoldRate(TEAM_RED) === 0);
    ok('16h an underdog objective is capped at a 50% reward premium',
      near(Game.objectiveGoldPerHero(TEAM_BLUE, 100), 150));
    Game.mode = 'duel';
    ok('16i 1v1 mode has no hidden comeback income or objective multiplier',
      Game.comebackGoldRate(TEAM_BLUE) === 0 && Game.objectiveGoldPerHero(TEAM_BLUE, 100) === 100);

    Game.mode = 'standard';
    for (const h of Game.heroes) h.goldEarned = 0;
    const deadHero = Game.heroes[0];
    deadHero.alive = false; deadHero.respawnT = 10;
    const deadGold = deadHero.goldEarned;
    deadHero.update(1);
    ok('16j passive gold continues during a respawn timer',
      near(deadHero.goldEarned - deadGold, BALANCE.passiveGoldPerSec));

    Game.mode = 'standard'; Game.draft = null;
    RNG.restore();
  }

  /* ---- 17. farming with the kit ----
     Damage skills used to be gated on the target being a hero, so bots
     auto-attacked 1250-HP camps with a full rotation off cooldown. The two
     guards below are the whole design: a skill is never spent on a creep with
     a fight in sight, or with the mana that fight will need. */
  {
    freshMatch(17);
    // pick a blue hero that actually owns a skillshot — the lineup's first does not
    const h = Game.heroes.find(x => x.team === TEAM_BLUE && x.skills.some(s => s.type === 'skillshot'))
      || Game.heroes.find(x => x.team === TEAM_BLUE);
    isolate(h);
    const foe = enemyHeroFor(h);
    const shotIdx = h.skills.findIndex(s => s.type === 'skillshot');
    const arm = () => {
      isolate(h);
      h.skillRank = [1, 1, 0]; h.skillCd = [0, 0, 0];
      h.mana = h.maxMana; h.farmsWithSkills = true;
      h.p.castChance = 1;                       // remove the per-tick roll from the test
      const m = makeMinion(TEAM_RED, h.x + 150, h.y);
      foe.x = 3150; foe.y = 3150;               // out of sight and out of range
      Game.updateVision();
      return m;
    };

    if (shotIdx < 0) {
      ok('17a (skipped: no skillshot hero available)', true);
    } else {
      let m = arm();
      h.botCast(m);
      ok('17a a bot spends a skillshot clearing a wave', h.skillCd[shotIdx] > 0);

      // ...but not with an enemy hero close enough to matter
      m = arm();
      foe.x = h.x + 300; foe.y = h.y; foe.alive = true;
      Game.updateVision();
      h.botCast(m);
      ok('17b it holds the skill when an enemy hero is in sight',
        h.skillCd[shotIdx] === 0);

      // ...and not down to empty, or the fight it farmed for finds it dry
      m = arm();
      h.mana = h.maxMana * (h.p.farmManaFloor - 0.05);
      h.botCast(m);
      ok('17c it stops farming with skills below the mana floor',
        h.skillCd[shotIdx] === 0);

      m = arm();
      h.farmsWithSkills = false;
      h.botCast(m);
      ok('17d farming with skills is switchable for a mirrored A/B',
        h.skillCd[shotIdx] === 0);
      h.farmsWithSkills = true;

      // a hero target is never subject to any of the farm guards
      isolate(h);
      h.skillRank = [1, 1, 0]; h.skillCd = [0, 0, 0]; h.mana = h.maxMana;
      h.p.castChance = 1;
      foe.x = h.x + 250; foe.y = h.y; foe.alive = true; foe.bush = -1;
      Game.updateVision();
      h.botCast(foe);
      ok('17e a hero in range is still worth the whole rotation', h.skillCd[shotIdx] > 0);
    }
    h.p.castChance = BOT_PARAMS.castChance;
  }

  /* ---- 18. spectator map-fit zoom ---- */
  {
    Game.mode = 'standard';
    const viewW = 1280, viewH = 720;
    const fit = Game.spectatorMinZoom(viewW, viewH);
    ok('18a spectator zoom can go below the old fixed 0.3x floor', fit < 0.3);
    ok('18b maximum zoom-out fits the full map vertically with a border',
      viewH / fit >= WORLD + 180 - 0.01,
      `${(viewH / fit).toFixed(0)} visible vs ${WORLD} map units`);

    Game.cam.zoom = fit; Game.cam.x = 0; Game.cam.y = WORLD;
    Game.clampSpectatorCamera(viewW, viewH);
    ok('18c a fully zoomed-out camera centres the whole battlefield',
      near(Game.cam.x, WORLD / 2) && near(Game.cam.y, WORLD / 2));
    Game.draft = null;
  }

  // ---- 19. battlefield roles, opening economy and late-game evolution ----
  {
    let h = freshMatch(190);
    const blue = Game.heroes.filter(x => x.team === TEAM_BLUE);
    const red = Game.heroes.filter(x => x.team === TEAM_RED);
    const positions = xs => xs.map(x => x.lane).sort().join(',');
    const fullPositions = ['bot', 'jungle', 'mid', 'roam', 'top'].sort().join(',');
    ok('19a bot teams field one laner, jungler and roamer in every position',
      positions(blue) === fullPositions && positions(red) === fullPositions,
      `blue ${positions(blue)} red ${positions(red)}`);

    const jungler = blue.find(x => x.lane === 'jungle');
    ok('19b the designated jungler always carries Retribution',
      jungler && jungler.spell && jungler.spell.id === 'retribution');
    const firstCamp = jungler && jungler.pickJungleCamp();
    ok('19c the jungler plans an allied-side clear beyond idle range', firstCamp &&
      dist(firstCamp.home || firstCamp, Game.basePoint(TEAM_BLUE)) <=
      dist(firstCamp.home || firstCamp, Game.basePoint(TEAM_RED)));

    const roamer = blue.find(x => x.lane === 'roam');
    ok('19d the roamer begins by rotating to a real lane ally',
      roamer && roamer.roamAnchor() && ['top', 'mid', 'bot'].includes(roamer.roamAnchor().lane));

    h = freshMatch(191); isolate(h);
    Game.time = 100;
    let m = new Minion(TEAM_RED, 'top', 'melee');
    m.x = h.x; m.y = h.y;
    const gold0 = h.goldEarned;
    m.die(h);
    ok('19e Gold Lane pays 25% more last-hit gold during the opening',
      near(h.goldEarned - gold0, m.goldValue * BALANCE.goldLaneMult));

    h = freshMatch(1911); isolate(h);
    Game.time = 100;
    m = new Minion(TEAM_RED, 'bot', 'melee');
    m.x = h.x; m.y = h.y;
    const xp0 = h.xp;
    m.die(h);
    ok('19f EXP Lane pays 25% more minion XP during the opening',
      near(h.xp - xp0, m.xpValue * BALANCE.expLaneMult));

    h = freshMatch(192); isolate(h, { keepStructures: true });
    for (const s of Game.structures()) s.alive = false;
    const outer = Game.towers.find(t => t.team === TEAM_RED && t.frac >= 0.39);
    outer.alive = true; outer.x = h.x + 100; outer.y = h.y;
    outer.plates = 3; outer.plateMaxHp = outer.maxHp; outer.hp = outer.maxHp * 0.74;
    Game.time = 100;
    const plateGold0 = h.goldEarned;
    outer.onDamaged(h, 100, {});
    ok('19g an opening turret plate breaks once and pays local gold',
      outer.plates === 2 && near(h.goldEarned - plateGold0, BALANCE.towerPlateGold));
    outer.plates = 3; outer.hp = outer.maxHp * 0.74; Game.time = BALANCE.laneBonusEnd + 1;
    const latePlateGold = h.goldEarned;
    outer.onDamaged(h, 100, {});
    ok('19h turret plating and its gold expire after five minutes',
      outer.plates === 3 && near(h.goldEarned, latePlateGold));

    freshMatch(193);
    Game.time = BALANCE.ancientLordAt;
    const ancient = new EpicMonster('lord', LORD_PIT);
    Game.epics.lord.unit = ancient;
    ok('19i late Lord evolves into a visibly stronger objective',
      ancient.evolved && ancient.name === 'Ancient Lord' && ancient.maxHp === 9000 &&
      Game.objectiveState().some(o => o.key === 'lord' && o.label === 'Ancient Lord'));
    Game.minions.length = 0;
    Game.spawnLordMinion(TEAM_BLUE, true);
    const siege = Game.minions.filter(x => x.kind === 'lord');
    ok('19j Ancient Lord creates one empowered siege wave in every lane',
      siege.length === 3 && siege.every(x => x.empowered) &&
      new Set(siege.map(x => x.lane)).size === 3);
  }

  /* ---- 20. Auric Caldera 10v10 is its own board ----
     These checks are the contract that 10v10 is not a padded 5v5: north/south
     citadels, four outer roads, a central crater, no Dawn-board names. */
  {
    const W = TEN_MAP.world;
    const rot = p => ({ x: W - p.x, y: W - p.y });
    const twin = (list, p, same = () => true) =>
      list.some(o => dist(o, rot(p)) < 1 && same(o));

    ok('20a Caldera is larger than the 5v5 board', TEN_MAP.world > WORLD);
    ok('20b citadels sit on the north-south spine, not the 5v5 diagonal',
      Math.abs(TEN_MAP.bases[0].x - TEN_MAP.bases[1].x) < 1 &&
      Math.abs(TEN_MAP.bases[0].x - W / 2) < 1 &&
      TEN_MAP.bases[0].y > W * 0.6 && TEN_MAP.bases[1].y < W * 0.4);
    ok('20c four outer roads and no mid/top/bot identity',
      TEN_MAP.pushLanes.join() === 'dusk,west,east,dawn' &&
      !TEN_MAP.lanes.mid && !TEN_MAP.lanes.top && !TEN_MAP.lanes.bot);
    ok('20d Colossus crater is the map centre',
      dist(TEN_MAP.crater, { x: W / 2, y: W / 2 }) < 1);
    ok('20e twin beacons are a rotated pair and equidistant from both citadels',
      dist(rot(TEN_MAP.beaconWest), TEN_MAP.beaconEast) < 1 &&
      Math.abs(dist(TEN_MAP.bases[0], TEN_MAP.beaconWest) - dist(TEN_MAP.bases[1], TEN_MAP.beaconWest)) < 1 &&
      Math.abs(dist(TEN_MAP.bases[0], TEN_MAP.beaconEast) - dist(TEN_MAP.bases[1], TEN_MAP.beaconEast)) < 1);
    ok('20f every camp has a rotated twin of the same kind',
      TEN_MAP.camps.every(c => twin(TEN_MAP.camps, c, o => o.kind === c.kind)));
    ok('20g every bush has a rotated twin of the same radius',
      TEN_MAP.bushes.every(b => twin(TEN_MAP.bushes, b, o => Math.abs(o.r - b.r) < 1)));
    ok('20h every turret has a rotated twin on the other team',
      TEN_MAP.towers.every(t => twin(TEN_MAP.towers, t, o => o.team !== t.team && o.frac === t.frac)));
    let worstLane = Infinity;
    for (const L of Object.values(TEN_MAP.lanes)) {
      for (const p of L) {
        for (const w of TEN_MAP.walls) {
          const c = wallClosest(w, p.x, p.y);
          worstLane = Math.min(worstLane, Math.hypot(c.x - p.x, c.y - p.y) - w.r);
        }
      }
    }
    ok('20i Caldera roads stay clear of terrain', worstLane > 25,
      `worst gap ${worstLane.toFixed(1)}`);
    ok('20j Caldera does not reuse the 5v5 river or epic pits',
      typeof RIVER !== 'undefined' &&
      dist(TEN_MAP.crater, LORD_PIT) > 800 &&
      dist(TEN_MAP.beaconWest, TURTLE_PIT) > 800);

    RNG.seed(2010);
    Recorder.enabled = false;
    Game.experiment = {
      lineup: LINEUP_IDS.map(id => HEROES.find(h => h.id === id)),
      botTypes: ['heuristic', 'heuristic'],
    };
    Game.mode = 'ten';
    Game.start(null);
    ok('20k 10v10 fields twenty heroes', Game.heroes.length === 20);
    ok('20l 10v10 has four push lanes', Game.pushLanes().join() === 'dusk,west,east,dawn');
    Game.waveT = 0;
    Game.update(0.05);
    const waveLanes = new Set(Game.minions.map(m => m.lane));
    ok('20m waves march the four Caldera roads, never a mid lane',
      ['dusk', 'west', 'east', 'dawn'].every(l => waveLanes.has(l)) && !waveLanes.has('mid') &&
      !waveLanes.has('top') && !waveLanes.has('bot'));
    const cit0 = TEN_MAP.bases[0];
    const blueWave = Game.minions.filter(m => m.team === TEAM_BLUE && m.alive);
    const meanX = lane => {
      const g = blueWave.filter(m => m.lane === lane);
      return g.reduce((s, m) => s + m.x, 0) / Math.max(1, g.length);
    };
    ok('20n Caldera waves spawn on their own road, not in one citadel pile',
      meanX('dusk') < meanX('west') && meanX('west') < meanX('east') && meanX('east') < meanX('dawn') &&
      blueWave.every(m => m.minionPathDist(m) < 60 && dist(m, cit0) > 24),
      `x ${['dusk','west','east','dawn'].map(l => l + '=' + meanX(l).toFixed(0)).join(' ')}`);
    for (const h of Game.heroes) {
      const f = TEN_MAP.fountains[h.team];
      h.x = f.x; h.y = f.y; h.alive = false;
    }
    for (let i = 0; i < 480; i++) Game.update(1 / 60);
    const marched = Game.minions.filter(m => m.team === TEAM_BLUE && m.alive);
    const meanX2 = lane => {
      const g = marched.filter(m => m.lane === lane);
      return g.reduce((s, m) => s + m.x, 0) / Math.max(1, g.length);
    };
    ok('20o Caldera minions march their road instead of stalling at the citadel',
      marched.length >= 8 &&
      marched.every(m => m.wpIdx >= 8 && m.minionPathDist(m) < 90 && !Game.wallAt(m.x, m.y, m.radius)) &&
      meanX2('dusk') < meanX2('west') && meanX2('west') < meanX2('east') && meanX2('east') < meanX2('dawn'),
      `n=${marched.length} wp=${marched.map(m => m.wpIdx).join(',')} ` +
      `x ${['dusk','west','east','dawn'].map(l => l + '=' + meanX2(l).toFixed(0)).join(' ')}`);
    Game.mode = 'standard';
    Game.draft = null;
    Game.experiment = null;
    RNG.restore();
  }

  /* ---- 21. minion, turret, jungle and hero combat AI ---- */
  {
    let h = freshMatch(210); isolate(h);
    const wave = makeMinion(TEAM_BLUE, h.x, h.y);
    const creep = makeMinion(TEAM_RED, h.x + 180, h.y);
    const foe = enemyHeroFor(h);
    foe.x = h.x + 160; foe.y = h.y; foe.alive = true; foe.bush = -1;
    wave.retargetT = 0;
    wave.update(0.45);
    ok('21a a minion prefers the enemy wave over a nearby hero',
      wave.target === creep, `chose ${wave.target && wave.target.type}`);

    h = freshMatch(211); isolate(h);
    const walker = makeMinion(TEAM_BLUE, h.x, h.y);
    const wi = Math.min(2, walker.path.length - 2);
    const wp = walker.path[wi], wp2 = walker.path[wi + 1] || wp;
    walker.x = wp.x; walker.y = wp.y; walker.wpIdx = wi;
    const pdx = wp2.x - wp.x, pdy = wp2.y - wp.y, pm = Math.hypot(pdx, pdy) || 1;
    const stray = enemyHeroFor(h);
    stray.x = wp.x - pdy / pm * 310; stray.y = wp.y + pdx / pm * 310; stray.alive = true;
    walker.retargetT = 0;
    walker.update(0.45);
    ok('21b a minion will not peel off the road to chase a hero in the jungle',
      walker.target !== stray);

    h = freshMatch(212); isolate(h, { keepStructures: true });
    for (const s of Game.structures()) s.alive = false;
    const tower = Game.towers[0];
    tower.alive = true; tower.hp = tower.maxHp; tower.team = TEAM_BLUE;
    tower.x = h.x; tower.y = h.y;
    const ally = Game.heroes.find(x => x !== h && x.team === h.team);
    ally.x = h.x + 70; ally.y = h.y; ally.alive = true;
    const diver = enemyHeroFor(h);
    diver.x = h.x + 110; diver.y = h.y; diver.alive = true;
    const closerCreep = makeMinion(TEAM_RED, h.x + 40, h.y);
    ally.recentDmg = [{ h: diver, t: Game.time, amt: 50 }];
    tower.target = closerCreep;
    tower.update(0.05);
    ok('21c a turret switches to the hero who is hitting an allied hero',
      tower.target === diver, `chose ${tower.target && tower.target.type}`);

    h = freshMatch(213); isolate(h);
    const shooter = enemyHeroFor(h);
    shooter.x = h.x - 500; shooter.y = h.y;
    Game.projectiles.length = 0;
    Game.projectiles.push(new Projectile({
      kind: 'skillshot', x: h.x - 160, y: h.y, src: shooter, team: shooter.team,
      dx: 1, dy: 0, speed: 720, maxDist: 700, radius: 28, hitSet: new Set(),
      dmg: 120, dmgType: 'magic', s: {},
    }));
    h.avoidsZones = true;
    const y0 = h.y;
    ok('21d a bot sidesteps an incoming skillshot it can clear',
      h.dodgeProjectiles(1 / 60) === true && Math.abs(h.y - y0) > 0.15);

    h = freshMatch(214);
    const jungler = Game.heroes.find(x => x.team === TEAM_BLUE && x.lane === 'jungle');
    isolate(jungler);
    const topLaner = Game.heroes.find(x => x.team === TEAM_BLUE && x.lane === 'top');
    topLaner.x = jungler.x + 240; topLaner.y = jungler.y; topLaner.alive = true;
    Game.updateVision();
    const shadowed = jungler.shadowAlly();
    ok('21e a jungler shadows a living laner instead of requiring a mid lane',
      shadowed && shadowed.lane !== 'jungle' && shadowed.team === jungler.team);

    h = freshMatch(215); isolate(h, { keepStructures: true });
    const nyx = Game.heroes.find(x => x.def0.id === 'nyx' && x.team === TEAM_BLUE);
    isolate(nyx, { keepStructures: true });
    for (const s of Game.structures()) s.alive = false;
    const diveTower = Game.towers[0];
    diveTower.alive = true; diveTower.hp = diveTower.maxHp; diveTower.team = TEAM_RED;
    diveTower.x = nyx.x + 280; diveTower.y = nyx.y;
    const under = enemyHeroFor(nyx);
    under.x = diveTower.x + 20; under.y = diveTower.y; under.hp = under.maxHp; under.bush = -1;
    Game.updateVision();
    nyx.hp = nyx.maxHp * 0.7;
    ok('21f an assassin refuses to dash under an uncovered turret',
      nyx.gapCloseLegal(under) === false);
    makeMinion(TEAM_BLUE, diveTower.x + 30, diveTower.y);
    ok('21g minion cover makes that same gap-close legal',
      nyx.gapCloseLegal(under) === true);

    Game.mode = 'standard'; Game.draft = null; Game.experiment = null;
    Game.projectiles.length = 0;
    RNG.restore();
  }

  /* ---- 22. feature pack ---- */
  {
    ok('22a the catalog ships one hundred named features', FEATURE_CATALOG.length === 100,
      `count ${FEATURE_CATALOG.length}`);
    ok('22b missing is a ping kind', !!Game.PING_KINDS.missing);
    const h = freshMatch(220); isolate(h);
    h.spawnProtT = 3;
    const foe = enemyHeroFor(h);
    foe.x = h.x + 40; foe.y = h.y;
    const hp0 = h.hp;
    resolveDamage(foe, h, { amount: 400, type: 'physical' });
    ok('22c spawn protection blocks incoming damage', h.hp === hp0);
    h.spawnProtT = 0;
    resolveDamage(foe, h, { amount: 50, type: 'physical' });
    ok('22d damage lands after protection expires', h.hp < hp0);

    const creep = makeMinion(TEAM_RED, h.x + 80, h.y);
    creep.hp = 1;
    resolveDamage(h, creep, { amount: 400, type: 'physical', isBasic: true });
    ok('22e last-hitting a minion raises creep score', (h.cs || 0) >= 1);

    const pot = ITEM_BY_ID.hpPotion;
    ok('22f health potions exist in the shop', !!(pot && pot.consume === 'hp'));
    h.items.length = 0; h.gold = 1000; h.combatT = 0; h.hp = h.maxHp * 0.4;
    ok('22g a hero can buy and drink a potion', h.buyItem(pot) && Features.consumeItem(h, 0));

    Game.mode = 'ten'; Game.start(null);
    ok('22h Caldera matches seed honeyfruit and shrines',
      Features.plants.some(p => p.kind === 'fruit') && Features.shrines.length >= 1);
    Game.mode = 'standard'; Game.draft = null; Game.experiment = null;
    RNG.restore();
  }

  /* ---- 23. Mobile Legends pack ---- */
  {
    ok('23a fifty named MLBB systems', typeof MLBB_CATALOG !== 'undefined' && MLBB_CATALOG.length === 50);
    ok('23b Flameshot, Arrival, Icequake, Weaken and Revitalize are battle spells',
      !!(SPELL_BY_ID.flameshot && SPELL_BY_ID.arrival && SPELL_BY_ID.icequake &&
         SPELL_BY_ID.weaken && SPELL_BY_ID.revitalize));
    ok('23c Flicker is documented to pass through walls',
      /wall/i.test(SPELL_BY_ID.flicker.desc));
    const h = new Hero(HEROES[0], TEAM_BLUE, true, 'mid');
    h.skillPoints = 1; h.skillRank = [0, 0, 0]; h.level = 1;
    ok('23d skill 2 is locked at level 1', !h.canRankUp(1) && h.canRankUp(0));
    h.level = 2; h.skillRank = [1, 0, 0]; h.skillPoints = 1;
    ok('23e skill 2 unlocks at level 2', h.canRankUp(1));
    ok('23f recall is a 6 second channel', BALANCE.recallTime === 6);
  }

  log(`\n=== ${pass} passed, ${fail} failed ===`);
  return { pass, fail };
}
