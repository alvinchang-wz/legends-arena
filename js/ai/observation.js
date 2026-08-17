'use strict';
/* ============================================================
   observation.js — the single place where game state becomes a
   fixed, normalized neural observation.

   Used by BOTH the teacher recorder and the neural controller, so
   training and inference can never drift apart.

   Schema v1:
     self      : Float32Array(SELF_DIM)      — hero's own situation
     candidates: Float32Array(K * CAND_DIM)  — top-K legal targets
     mask      : Float32Array(K)             — 1 = real candidate

   Candidates are hard-filtered to LEGAL targets only (enemy/neutral,
   alive, visible, within MAX_DIST). Illegal units never reach the
   model, so the network cannot select them even if it wanted to.
   ============================================================ */

const NEURAL_OBSERVATION_VERSION = 1;

const OBS = {
  K: 16,                 // max candidates considered per think tick
  SELF_DIM: 30,
  CAND_DIM: 16,
  MAX_DIST: 900,         // candidate inclusion radius (> chase 720, so the
                         // model can learn the acquire/chase cutoffs itself)
  NORM: { pos: 800, dist: 900, radius: 64, level: 15, count: 5, world: WORLD },
};

const Observation = {
  version: NEURAL_OBSERVATION_VERSION,

  // reusable buffers — no per-tick allocation
  _self: new Float32Array(OBS.SELF_DIM),
  _cand: new Float32Array(OBS.K * OBS.CAND_DIM),
  _mask: new Float32Array(OBS.K),
  _units: new Array(OBS.K).fill(null),

  /* Deterministic candidate list: legal targets, nearest first.
     Stable tie-break keeps recording and inference identical. */
  buildCandidates(hero) {
    const pool = [];
    for (const u of Game.enemyUnits(hero.team, { structures: true, neutral: true })) {
      if (!u.alive) continue;
      const d = dist(hero, u);
      if (d > OBS.MAX_DIST) continue;
      if (!Game.canSee(hero.team, u)) continue;
      pool.push({ u, d });
    }
    pool.sort((a, b) => (a.d - b.d) || (a.u.x - b.u.x) || (a.u.y - b.u.y) ||
      (a.u.type < b.u.type ? -1 : a.u.type > b.u.type ? 1 : 0));
    return pool.slice(0, OBS.K);
  },

  /* Fill the shared buffers for this hero. Returns {self, cand, mask, units, n}.
     Buffers are reused: copy them if you need to retain the values. */
  encode(hero) {
    const N = OBS.NORM;
    const s = this._self;
    s.fill(0);

    const cands = this.buildCandidates(hero);
    const p = hero.p || BOT_PARAMS;

    // --- self features (fixed order; see SELF_FEATURE_NAMES) ---
    const fountain = Game.fountain(hero.team), base = Game.basePoint(hero.team);
    const fd = norm(fountain.x - hero.x, fountain.y - hero.y);
    const bd = norm(base.x - hero.x, base.y - hero.y);
    let wp = hero.path ? hero.path[Math.min(hero.wpIdx, hero.path.length - 1)] : null;
    const wd = wp ? norm(wp.x - hero.x, wp.y - hero.y) : { x: 0, y: 0 };

    let allies = 0, enemies = 0;
    for (const h of Game.heroes) {
      if (!h.alive || h === hero) continue;
      if (dist(hero, h) > 620) continue;
      if (h.team === hero.team) allies++; else enemies++;
    }
    // danger: standing in an enemy tower's range with no friendly minion cover
    let towerDanger = 0;
    for (const st of Game.structures()) {
      if (!st.alive || st.team === hero.team) continue;
      if (dist(hero, st) < st.range + 80) {
        const cover = Game.minions.some(m => m.team === hero.team && m.alive && dist(m, st) < 320);
        if (!cover) { towerDanger = 1; break; }
      }
    }
    const t = hero.aiTarget;
    let i = 0;
    s[i++] = clamp(hero.hpPct, 0, 1);
    s[i++] = hero.maxMana ? clamp(hero.mana / hero.maxMana, 0, 1) : 0;
    s[i++] = hero.aiState === 'retreat' ? 1 : 0;
    s[i++] = dist(hero, fountain) > 350 ? 1 : 0;                       // recall legal
    s[i++] = clamp(hero.atkCd * hero.curAtkSpd(), 0, 1);
    for (let k = 0; k < 3; k++) s[i++] = clamp(hero.skillCd[k] / hero.skills[k].cd, 0, 1);
    for (let k = 0; k < 3; k++) s[i++] = hero.mana >= hero.skills[k].mana ? 1 : 0;
    const worldN = (typeof Game !== 'undefined' && Game.worldSize) ? Game.worldSize() : N.world;
    const countN = (typeof Game !== 'undefined' && Game.isTen && Game.isTen()) ? 10 : N.count;
    s[i++] = fd.x; s[i++] = fd.y;
    s[i++] = clamp(dist(hero, fountain) / worldN, 0, 1);
    s[i++] = bd.x; s[i++] = bd.y;
    s[i++] = clamp(dist(hero, base) / worldN, 0, 1);
    s[i++] = wd.x; s[i++] = wd.y;
    s[i++] = wp ? clamp(dist(hero, wp) / N.dist, 0, 1) : 1;
    s[i++] = t && t.alive ? 1 : 0;
    s[i++] = t && t.type === 'hero' ? 1 : 0;
    s[i++] = t && t.type === 'minion' ? 1 : 0;
    s[i++] = t && t.isStructure ? 1 : 0;
    s[i++] = hero.team === TEAM_BLUE ? 0 : 1;
    s[i++] = clamp(hero.level / N.level, 0, 1);
    s[i++] = clamp((hero.adapt ? hero.adapt.caution : 0) / 0.2, -1, 1);
    s[i++] = towerDanger;
    s[i++] = clamp(allies / countN, 0, 1);
    s[i++] = clamp(enemies / countN, 0, 1);
    s[i++] = clamp(Game.time / 1800, 0, 1);                            // match progress

    // --- candidate features ---
    const c = this._cand, m = this._mask;
    c.fill(0); m.fill(0);
    for (let k = 0; k < OBS.K; k++) this._units[k] = null;

    const acquire = p.acquireRange !== undefined ? p.acquireRange : 560;
    const chase = p.chaseRange !== undefined ? p.chaseRange : 720;

    for (let k = 0; k < cands.length; k++) {
      const { u, d } = cands[k];
      const o = k * OBS.CAND_DIM;
      let cover = 0;
      if (u.isStructure) {
        cover = Game.minions.some(mm => mm.team === hero.team && mm.alive && dist(mm, u) < 320) ? 1 : 0;
      }
      c[o + 0] = clamp((u.x - hero.x) / N.pos, -1, 1);
      c[o + 1] = clamp((u.y - hero.y) / N.pos, -1, 1);
      c[o + 2] = clamp(d / N.dist, 0, 1);
      c[o + 3] = clamp(u.hpPct, 0, 1);
      c[o + 4] = u.type === 'hero' ? 1 : 0;
      c[o + 5] = u.type === 'minion' ? 1 : 0;
      c[o + 6] = u.isStructure ? 1 : 0;
      c[o + 7] = u.type === 'monster' ? 1 : 0;
      c[o + 8] = clamp(u.radius / N.radius, 0, 1);
      c[o + 9] = hero.inAttackRange(u) ? 1 : 0;
      c[o + 10] = d <= acquire ? 1 : 0;
      c[o + 11] = d <= chase ? 1 : 0;
      c[o + 12] = cover;
      c[o + 13] = u === hero.aiTarget ? 1 : 0;
      c[o + 14] = k / OBS.K;
      c[o + 15] = u.team === TEAM_NEUTRAL ? 0 : 1;
      m[k] = 1;
      this._units[k] = u;
    }
    return { self: s, cand: c, mask: m, units: this._units, n: cands.length };
  },

  /* Deterministic skill eligibility — mirrors botCast's conditions with the
     random roll removed and no side effects. Used for teacher labels. */
  skillEligibility(hero, target, out) {
    const p = hero.p || BOT_PARAMS;
    out = out || [0, 0, 0];
    out[0] = out[1] = out[2] = 0;
    if (!target) return out;
    const d = hero.distTo(target);
    const isHero = target.type === 'hero';
    const farmOk = hero.farmsWithSkills && !isHero &&
      hero.mana > hero.maxMana * p.farmManaFloor &&
      !Game.heroes.some(e => e.team !== hero.team && e.alive &&
        hero.distTo(e) < p.acquireRange && Game.canSee(hero.team, e));
    for (let i = 0; i < 3; i++) {
      const s = hero.skills[i];
      if (hero.skillCd[i] > 0 || hero.mana < s.mana) continue;
      if (i === 2) {
        if (!isHero) continue;
        const crowd = Game.heroes.filter(h => h.team !== hero.team && h.alive && hero.distTo(h) < 420).length;
        if (target.hpPct > p.ultExecuteHp && crowd < 2) continue;
      }
      let ok = false;
      switch (s.type) {
        case 'skillshot': ok = (isHero || farmOk) && d < s.range * 0.9; break;
        case 'nova': ok = d < s.radius + target.radius && (isHero || farmOk); break;
        case 'dash': ok = (isHero || (farmOk && (s.dmg || s.endNova))) && d > 150 && d < s.dist + 100; break;
        case 'zone': ok = (isHero || farmOk) && d < s.range; break;
        case 'heal': {
          const patient = hero.lowestHealTarget ? hero.lowestHealTarget(s.radius || 360) : hero;
          ok = !!(patient && patient.hpPct < (hero.advancedAI ? p.healAllyHp : 0.65));
          break;
        }
        case 'blinkstrike': ok = isHero && d < s.range; break;
        case 'buff': ok = isHero && d < 300; break;
      }
      out[i] = ok ? 1 : 0;
    }
    return out;
  },
};

const SELF_FEATURE_NAMES = [
  'hpFrac', 'manaFrac', 'isRetreating', 'recallLegal', 'atkCdFrac',
  'skillCd0', 'skillCd1', 'skillCd2', 'skillAfford0', 'skillAfford1', 'skillAfford2',
  'fountainDirX', 'fountainDirY', 'fountainDist', 'baseDirX', 'baseDirY', 'baseDist',
  'wpDirX', 'wpDirY', 'wpDist', 'hasTarget', 'targetIsHero', 'targetIsMinion',
  'targetIsStructure', 'team', 'levelFrac', 'caution', 'towerDanger',
  'alliesNear', 'enemiesNear',
];
const CAND_FEATURE_NAMES = [
  'relX', 'relY', 'dist', 'hpFrac', 'isHero', 'isMinion', 'isStructure', 'isMonster',
  'radius', 'inAttackRange', 'inNoticeRadius', 'inChaseRadius', 'minionCover',
  'isCurrentTarget', 'rank', 'isEnemy',
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Observation, OBS, NEURAL_OBSERVATION_VERSION };
}
