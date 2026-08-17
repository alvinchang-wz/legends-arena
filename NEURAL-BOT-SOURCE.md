# Neural Bot — Complete Source Code
Every file that makes up the neural bot, verbatim and complete.
Companion to NEURAL-BOT-EXPLAINED.md (which explains what this code does).

The hero-side integration lives in `js/entities.js` and is reproduced at the
end of this file (the dispatcher + the hand-coded teacher it falls back to).

---

## Table of contents
- `js/ai/observation.js` — Game state -> numbers. The ONE encoder used by both recording and live play.
- `js/ai/neural-runtime.js` — Hand-written MLP inference + model loading + validation. This is the 'AI engine'.
- `js/ai/neural-controller.js` — The decision step + hard legality/safety masks.
- `js/ai/recorder.js` — Optional teacher-data recording with sampling.
- `js/ai/rng.js` — Seeded RNG for reproducible matches.
- `training/train.py` — PyTorch behavior cloning: model, training loop, metrics, JSON export.
- `js/entities.js` (excerpt) — Hero bot dispatcher + original heuristic teacher
- Trained weights — description of `models/neural-bot-v1/model.json`

---

## `js/ai/observation.js`

Game state -> numbers. The ONE encoder used by both recording and live play.

(200 lines)

```javascript
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
    const p = hero.p || (typeof Brains !== 'undefined' ? Brains.defaults() : {});

    // --- self features (fixed order; see SELF_FEATURE_NAMES) ---
    const fountain = FOUNTAINS[hero.team], base = BASES[hero.team];
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
    s[i++] = fd.x; s[i++] = fd.y;
    s[i++] = clamp(dist(hero, fountain) / N.world, 0, 1);
    s[i++] = bd.x; s[i++] = bd.y;
    s[i++] = clamp(dist(hero, base) / N.world, 0, 1);
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
    s[i++] = clamp(allies / N.count, 0, 1);
    s[i++] = clamp(enemies / N.count, 0, 1);
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
    const p = hero.p || Brains.defaults();
    out = out || [0, 0, 0];
    out[0] = out[1] = out[2] = 0;
    if (!target) return out;
    const d = hero.distTo(target);
    const isHero = target.type === 'hero';
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
        case 'skillshot': ok = isHero && d < s.range * 0.9; break;
        case 'nova': ok = d < s.radius + target.radius; break;
        case 'dash': ok = isHero && d > 150 && d < s.dist + 100; break;
        case 'zone': ok = isHero && d < s.range; break;
        case 'heal': ok = hero.hpPct < 0.65; break;
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

```

---

## `js/ai/neural-runtime.js`

Hand-written MLP inference + model loading + validation. This is the 'AI engine'.

(164 lines)

```javascript
'use strict';
/* ============================================================
   neural-runtime.js — hand-written MLP inference.

   The model is tiny (~7k params) and runs at ~4 Hz per bot, so a
   dependency-free implementation is smaller and faster to debug than
   TF.js/ONNX. All buffers are preallocated: a think tick allocates
   nothing.

   Architecture (v1, target selection):
     selfEnc  : selfDim -> H -> H            (ReLU)
     candEnc  : candDim -> H -> H            (ReLU)   applied per candidate
     scorer   : [selfEmb, candEmb] -> H -> 1 (ReLU)   score per candidate
     noTarget : selfEmb -> H -> 1            (ReLU)   score for "no target"
   ============================================================ */

const NEURAL_MODEL_SCHEMA = 1;

/* out = relu?(W·x + b);  W row-major [outDim x inDim] */
function mlpLinear(out, W, b, x, inDim, outDim, relu) {
  for (let o = 0; o < outDim; o++) {
    let sum = b[o];
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += W[base + i] * x[i];
    out[o] = relu && sum < 0 ? 0 : sum;
  }
}

const NeuralRuntime = {
  ready: false, model: null, cfg: null, warned: false, loadError: null,
  _buf: null,

  /* Validate + install a model object. Returns true on success. */
  loadFromObject(obj) {
    try {
      if (!obj || typeof obj !== 'object') throw new Error('model is not an object');
      if (obj.schemaVersion !== NEURAL_MODEL_SCHEMA) {
        throw new Error(`model schemaVersion ${obj.schemaVersion} != ${NEURAL_MODEL_SCHEMA}`);
      }
      if (obj.obsVersion !== NEURAL_OBSERVATION_VERSION) {
        throw new Error(`observation version ${obj.obsVersion} != ${NEURAL_OBSERVATION_VERSION}`);
      }
      const c = obj.config || {};
      if (c.selfDim !== OBS.SELF_DIM) throw new Error(`selfDim ${c.selfDim} != ${OBS.SELF_DIM}`);
      if (c.candDim !== OBS.CAND_DIM) throw new Error(`candDim ${c.candDim} != ${OBS.CAND_DIM}`);
      if (c.K !== OBS.K) throw new Error(`K ${c.K} != ${OBS.K}`);
      const H = c.hidden;
      if (!(H > 0)) throw new Error('bad hidden size');

      const need = ['se0w', 'se0b', 'se1w', 'se1b', 'ce0w', 'ce0b', 'ce1w', 'ce1b',
        'sc0w', 'sc0b', 'sc1w', 'sc1b', 'nt0w', 'nt0b', 'nt1w', 'nt1b'];
      const P = {};
      for (const k of need) {
        const arr = obj.params[k];
        if (!arr || !arr.length) throw new Error(`missing param ${k}`);
        for (let i = 0; i < arr.length; i++) {
          if (!Number.isFinite(arr[i])) throw new Error(`non-finite weight in ${k}`);
        }
        P[k] = Float32Array.from(arr);
      }
      const expect = {
        se0w: H * OBS.SELF_DIM, se0b: H, se1w: H * H, se1b: H,
        ce0w: H * OBS.CAND_DIM, ce0b: H, ce1w: H * H, ce1b: H,
        sc0w: H * (2 * H), sc0b: H, sc1w: H, sc1b: 1,
        nt0w: H * H, nt0b: H, nt1w: H, nt1b: 1,
      };
      for (const k of need) {
        if (P[k].length !== expect[k]) throw new Error(`${k} length ${P[k].length} != ${expect[k]}`);
      }
      this.model = P; this.cfg = { H, K: c.K };
      this._buf = {
        s0: new Float32Array(H), sEmb: new Float32Array(H),
        c0: new Float32Array(H), cEmb: new Float32Array(H),
        pair: new Float32Array(2 * H), h: new Float32Array(H),
        one: new Float32Array(1), scores: new Float32Array(OBS.K + 1),
      };
      this.ready = true; this.loadError = null; this.warned = false;
      return true;
    } catch (e) {
      this.ready = false; this.model = null; this.loadError = e.message;
      this.warnOnce(`neural model rejected: ${e.message} — falling back to heuristic bot`);
      return false;
    }
  },

  async load(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return this.loadFromObject(await res.json());
    } catch (e) {
      this.ready = false; this.loadError = e.message;
      this.warnOnce(`neural model not loaded (${e.message}) — using heuristic bot`);
      return false;
    }
  },

  warnOnce(msg) {
    if (this.warned) return;
    this.warned = true;
    console.warn('[NeuralRuntime]', msg);
  },

  /* Score every candidate + the no-target option.
     Returns the scores buffer (length n+1, last = no-target), or null on failure. */
  scoreTargets(obs) {
    if (!this.ready) return null;
    const P = this.model, H = this.cfg.H, B = this._buf;
    mlpLinear(B.s0, P.se0w, P.se0b, obs.self, OBS.SELF_DIM, H, true);
    mlpLinear(B.sEmb, P.se1w, P.se1b, B.s0, H, H, true);

    const scores = B.scores;
    scores.fill(-Infinity);
    for (let k = 0; k < OBS.K; k++) {
      if (obs.mask[k] !== 1) continue;
      const view = obs.cand.subarray(k * OBS.CAND_DIM, (k + 1) * OBS.CAND_DIM);
      mlpLinear(B.c0, P.ce0w, P.ce0b, view, OBS.CAND_DIM, H, true);
      mlpLinear(B.cEmb, P.ce1w, P.ce1b, B.c0, H, H, true);
      B.pair.set(B.sEmb, 0); B.pair.set(B.cEmb, H);
      mlpLinear(B.h, P.sc0w, P.sc0b, B.pair, 2 * H, H, true);
      mlpLinear(B.one, P.sc1w, P.sc1b, B.h, H, 1, false);
      scores[k] = B.one[0];
    }
    mlpLinear(B.h, P.nt0w, P.nt0b, B.sEmb, H, H, true);
    mlpLinear(B.one, P.nt1w, P.nt1b, B.h, H, 1, false);
    scores[OBS.K] = B.one[0];

    for (let k = 0; k <= OBS.K; k++) {
      const v = scores[k];
      if (v !== -Infinity && !Number.isFinite(v)) {
        this.warnOnce('model produced NaN/Inf — falling back to heuristic bot');
        this.ready = false;
        return null;
      }
    }
    return scores;
  },

  /* argmax over legal options; index OBS.K means "no target". */
  argmaxIndex(scores) {
    let bi = OBS.K, bv = scores[OBS.K];
    for (let k = 0; k < OBS.K; k++) if (scores[k] > bv) { bv = scores[k]; bi = k; }
    return bi;
  },

  /* Softmax sample over legal options (stochastic play). */
  sampleIndex(scores, n, temperature) {
    const T = temperature || 1;
    let max = -Infinity;
    for (let k = 0; k < n; k++) if (scores[k] > max) max = scores[k];
    if (scores[OBS.K] > max) max = scores[OBS.K];
    let total = 0;
    const probs = [];
    for (let k = 0; k < n; k++) { const e = Math.exp((scores[k] - max) / T); probs.push(e); total += e; }
    const eNo = Math.exp((scores[OBS.K] - max) / T); probs.push(eNo); total += eNo;
    let r = Math.random() * total;
    for (let k = 0; k < probs.length; k++) { r -= probs[k]; if (r <= 0) return k === n ? OBS.K : k; }
    return OBS.K;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NeuralRuntime, NEURAL_MODEL_SCHEMA };
}

```

---

## `js/ai/neural-controller.js`

The decision step + hard legality/safety masks.

(68 lines)

```javascript
'use strict';
/* ============================================================
   neural-controller.js — the neural bot's DECISION step.

   v1 scope: the network replaces TARGET SELECTION only. Strategic
   state (push/retreat), recall, skill casting, and all 60 Hz execution
   stay with the existing heuristic code, unchanged.

   The controller never touches position, health, cooldowns, or any
   other simulation state — it only writes hero.aiTarget, which the
   normal per-frame executor then acts on through the shared
   moveToward / tryAttack / castSkill methods.
   ============================================================ */

const NeuralController = {
  sampling: true,        // false => deterministic argmax (evaluation mode)
  temperature: 1.0,
  stats: { ticks: 0, fallbacks: 0, noTarget: 0, picked: 0 },

  ready() { return NeuralRuntime.ready; },

  /* Returns:
       Unit      — model picked this target
       null      — model deliberately picked "no target"
       undefined — model unavailable/failed; caller must fall back  */
  selectTarget(hero) {
    if (!NeuralRuntime.ready) return undefined;
    try {
      this.stats.ticks++;
      const obs = Observation.encode(hero);
      const scores = NeuralRuntime.scoreTargets(obs);
      if (!scores) { this.stats.fallbacks++; return undefined; }

      const idx = this.sampling
        ? NeuralRuntime.sampleIndex(scores, obs.n, this.temperature)
        : NeuralRuntime.argmaxIndex(scores);

      if (idx === OBS.K || idx >= obs.n) { this.stats.noTarget++; return null; }

      const u = obs.units[idx];
      // hard legality re-check: the model may not target dead/invisible/allied units
      if (!u || !u.alive || u.team === hero.team || !Game.canSee(hero.team, u)) {
        this.stats.noTarget++;
        return null;
      }
      // hard safety: never commit to a structure without minion cover
      if (u.isStructure) {
        const cover = Game.minions.some(m => m.team === hero.team && m.alive && dist(m, u) < 320);
        const p = hero.p || Brains.defaults();
        if (!cover && hero.hpPct < clamp(p.diveHp + hero.adapt.caution, 0.4, 1)) {
          this.stats.noTarget++;
          return null;
        }
      }
      this.stats.picked++;
      return u;
    } catch (e) {
      NeuralRuntime.warnOnce(`inference error (${e.message}) — falling back to heuristic bot`);
      NeuralRuntime.ready = false;
      this.stats.fallbacks++;
      return undefined;
    }
  },

  resetStats() { this.stats = { ticks: 0, fallbacks: 0, noTarget: 0, picked: 0 }; },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { NeuralController };

```

---

## `js/ai/recorder.js`

Optional teacher-data recording with sampling.

(108 lines)

```javascript
'use strict';
/* ============================================================
   recorder.js — optional teacher-data recording.

   Records ONE example per AI think tick (~4 Hz per bot), never per
   rendered frame. Disabled by default: ordinary gameplay records
   nothing.

   Sampling keeps every rare/safety-critical decision and only a
   fraction of the repetitive lane-push ticks that would otherwise
   dominate the dataset.
   ============================================================ */

const Recorder = {
  enabled: false,
  cfg: {
    maximumExamples: 200000,
    keepPushNoTarget: 0.08,     // ordinary "walking down the lane" ticks
    keepTargetMaintain: 0.25,   // same target as last tick, nothing notable
    keepRetreat: 0.15,          // mid-retreat ticks (transitions always kept)
    // state changes, recalls, skill-eligible ticks and tower danger are always kept
  },
  rows: [],
  matchId: 0, seed: null, thinkStep: 0, dropped: 0,

  start(matchId, seed) {
    this.matchId = matchId; this.seed = seed; this.thinkStep = 0;
  },
  reset() { this.rows = []; this.dropped = 0; this.matchId = 0; this.thinkStep = 0; },

  /* Snapshot the observation BEFORE the teacher decides (aiTarget is still
     last tick's, which is what the model will also see at inference time). */
  snapshot(hero) {
    const obs = Observation.encode(hero);
    return {
      self: Array.from(obs.self),
      cand: Array.from(obs.cand.subarray(0, obs.n * OBS.CAND_DIM)),
      mask: Array.from(obs.mask),
      n: obs.n,
      units: obs.units.slice(0, obs.n),
      prevTarget: hero.aiTarget,
      prevState: hero.aiState,
      prevRecallT: hero.recallT,
      towerDanger: obs.self[27] === 1,
      hpPct: hero.hpPct,
    };
  },

  /* Commit labels AFTER the teacher decided. */
  commit(hero, snap) {
    if (!this.enabled || this.rows.length >= this.cfg.maximumExamples) return;
    if (hero.botType !== 'heuristic') return;   // only the teacher is recorded
    this.thinkStep++;

    const chosen = hero.aiTarget;
    let targetIdx = OBS.K;                       // OBS.K == "no target" class
    if (chosen) {
      const i = snap.units.indexOf(chosen);
      if (i < 0) return;                         // chosen unit wasn't a legal candidate: skip
      targetIdx = i;
    }
    const retreat = hero.aiState === 'retreat' ? 1 : 0;
    const recalled = snap.prevRecallT <= 0 && hero.recallT > 0 ? 1 : 0;
    const elig = Observation.skillEligibility(hero, chosen);

    // ---- sampling: always keep the informative ticks ----
    const stateChanged = (snap.prevState === 'retreat' ? 1 : 0) !== retreat;
    const targetChanged = snap.prevTarget !== chosen;
    const anySkill = elig[0] || elig[1] || elig[2];
    const critical = stateChanged || recalled || anySkill || snap.towerDanger;
    if (!critical) {
      let p = 1;
      if (retreat) p = this.cfg.keepRetreat;                       // mid-retreat coasting
      else if (targetChanged) p = 1;                               // acquisitions always kept
      else if (targetIdx === OBS.K) p = this.cfg.keepPushNoTarget; // lane walking
      else p = this.cfg.keepTargetMaintain;                        // holding a target
      if (p < 1 && Math.random() > p) { this.dropped++; return; }
    }

    this.rows.push({
      v: NEURAL_OBSERVATION_VERSION,
      m: this.matchId, sd: this.seed, st: this.thinkStep,
      h: hero.def0.id, tm: hero.team,
      self: snap.self.map(r2), cand: snap.cand.map(r2), n: snap.n,
      y_target: targetIdx,
      y_state: retreat,
      y_recall: recalled,
      y_skill: [elig[0], elig[1], elig[2]],
    });
  },

  toJSONL() { return this.rows.map(r => JSON.stringify(r)).join('\n') + '\n'; },

  summary() {
    const s = { rows: this.rows.length, dropped: this.dropped, withTarget: 0, retreat: 0, recall: 0, skill: 0 };
    for (const r of this.rows) {
      if (r.y_target !== OBS.K) s.withTarget++;
      if (r.y_state) s.retreat++;
      if (r.y_recall) s.recall++;
      if (r.y_skill[0] || r.y_skill[1] || r.y_skill[2]) s.skill++;
    }
    return s;
  },
};

const r2 = v => Math.round(v * 1000) / 1000;   // 3 decimals keeps files small

if (typeof module !== 'undefined' && module.exports) module.exports = { Recorder };

```

---

## `js/ai/rng.js`

Seeded RNG for reproducible matches.

(35 lines)

```javascript
'use strict';
/* ============================================================
   rng.js — seeded deterministic RNG for reproducible matches.

   The game calls Math.random() in many places (spawn jitter, bot cast
   rolls, effects). Rather than thread a generator through every call
   site, seeding swaps Math.random for a mulberry32 stream. Call
   RNG.restore() to put the original back.
   ============================================================ */

const RNG = {
  _s: 1, _orig: null, active: false, seedValue: null,

  seed(s) {
    this.seedValue = s >>> 0;
    this._s = (s >>> 0) || 1;
    if (!this._orig) this._orig = Math.random;
    Math.random = () => this.next();
    this.active = true;
  },

  next() {
    this._s = (this._s + 0x6D2B79F5) | 0;
    let t = Math.imul(this._s ^ (this._s >>> 15), 1 | this._s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  restore() {
    if (this._orig) Math.random = this._orig;
    this.active = false; this.seedValue = null;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { RNG };

```

---

## `training/train.py`

PyTorch behavior cloning: model, training loop, metrics, JSON export.

(292 lines)

```python
#!/usr/bin/env python3
"""Behavior cloning for the Legends Arena neural bot (v1: target selection).

Trains a small candidate-scoring MLP to imitate the hand-coded heuristic bot's
target choices, then exports weights as JSON for the game's hand-written
JavaScript inference runtime.

  python3 training/train.py --data training/data/dataset.jsonl
  python3 training/train.py --device mps --epochs 30
  python3 training/train.py --resume            # continue from last checkpoint

Runs on CPU or Apple MPS. No CUDA, no cloud, no large dependencies.
"""
import argparse
import json
import os
import random
import sys
import time

import torch
import torch.nn as nn
import torch.nn.functional as F

OBS_VERSION = 1          # must match NEURAL_OBSERVATION_VERSION in js/ai/observation.js
MODEL_SCHEMA = 1         # must match NEURAL_MODEL_SCHEMA in js/ai/neural-runtime.js
SELF_DIM, CAND_DIM, K = 30, 16, 16
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# --------------------------------------------------------------------------- device
def pick_device(pref):
    if pref == 'cpu':
        return torch.device('cpu')
    if pref == 'mps':
        if not torch.backends.mps.is_available():
            print('  ! MPS requested but unavailable; using CPU')
            return torch.device('cpu')
        return torch.device('mps')
    # auto: this model is tiny, so CPU usually wins on transfer overhead alone.
    return torch.device('cpu')


# --------------------------------------------------------------------------- data
def load_jsonl(path, limit=None):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get('v') != OBS_VERSION:
                raise SystemExit(f'observation version {r.get("v")} != {OBS_VERSION} — regenerate the dataset')
            rows.append(r)
            if limit and len(rows) >= limit:
                break
    if not rows:
        raise SystemExit(f'no rows in {path}')
    return rows


def to_tensors(rows):
    n = len(rows)
    xs = torch.zeros(n, SELF_DIM, dtype=torch.float32)
    xc = torch.zeros(n, K, CAND_DIM, dtype=torch.float32)
    xm = torch.zeros(n, K, dtype=torch.float32)
    y = torch.zeros(n, dtype=torch.long)
    for i, r in enumerate(rows):
        xs[i] = torch.tensor(r['self'], dtype=torch.float32)
        cnt = int(r['n'])
        if cnt:
            flat = torch.tensor(r['cand'], dtype=torch.float32)
            xc[i, :cnt] = flat.view(cnt, CAND_DIM)
        xm[i, :cnt] = 1.0
        y[i] = int(r['y_target'])
    return xs, xc, xm, y


def split_by_match(rows, seed=0, val_frac=0.15, test_frac=0.15):
    """Split by whole match so adjacent think ticks never straddle splits."""
    ids = sorted({r['m'] for r in rows})
    rng = random.Random(seed)
    rng.shuffle(ids)
    n_val = max(1, int(round(len(ids) * val_frac)))
    n_test = max(1, int(round(len(ids) * test_frac)))
    if len(ids) < 3:
        raise SystemExit(f'need at least 3 matches to split, got {len(ids)}')
    val, test = set(ids[:n_val]), set(ids[n_val:n_val + n_test])
    train = set(ids[n_val + n_test:])
    buckets = {'train': [], 'val': [], 'test': []}
    for r in rows:
        buckets['val' if r['m'] in val else 'test' if r['m'] in test else 'train'].append(r)
    return buckets, {'train': sorted(train), 'val': sorted(val), 'test': sorted(test)}


# --------------------------------------------------------------------------- model
class TargetPolicy(nn.Module):
    """Per-candidate scoring; mirrors the JS runtime exactly."""

    def __init__(self, hidden=32):
        super().__init__()
        h = hidden
        self.se0, self.se1 = nn.Linear(SELF_DIM, h), nn.Linear(h, h)
        self.ce0, self.ce1 = nn.Linear(CAND_DIM, h), nn.Linear(h, h)
        self.sc0, self.sc1 = nn.Linear(2 * h, h), nn.Linear(h, 1)
        self.nt0, self.nt1 = nn.Linear(h, h), nn.Linear(h, 1)

    def forward(self, xs, xc, xm):
        s = F.relu(self.se1(F.relu(self.se0(xs))))              # (B,H)
        c = F.relu(self.ce1(F.relu(self.ce0(xc))))              # (B,K,H)
        pair = torch.cat([s.unsqueeze(1).expand(-1, c.size(1), -1), c], dim=-1)
        cand = self.sc1(F.relu(self.sc0(pair))).squeeze(-1)     # (B,K)
        cand = cand.masked_fill(xm == 0, -1e9)
        no_target = self.nt1(F.relu(self.nt0(s)))               # (B,1)
        return torch.cat([cand, no_target], dim=-1)             # (B,K+1)


def export_json(model, hidden, meta, path):
    p = {}
    pairs = [('se0', model.se0), ('se1', model.se1), ('ce0', model.ce0), ('ce1', model.ce1),
             ('sc0', model.sc0), ('sc1', model.sc1), ('nt0', model.nt0), ('nt1', model.nt1)]
    for name, layer in pairs:
        p[name + 'w'] = layer.weight.detach().cpu().flatten().tolist()   # row-major [out,in]
        p[name + 'b'] = layer.bias.detach().cpu().flatten().tolist()
    obj = {
        'schemaVersion': MODEL_SCHEMA,
        'obsVersion': OBS_VERSION,
        'config': {'K': K, 'selfDim': SELF_DIM, 'candDim': CAND_DIM, 'hidden': hidden},
        'heads': ['target'],
        'meta': meta,
        'params': p,
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as fh:
        json.dump(obj, fh)
    n_params = sum(len(v) for v in p.values())
    return n_params, os.path.getsize(path)


# --------------------------------------------------------------------------- metrics
@torch.no_grad()
def evaluate(model, data, device, batch=4096):
    model.eval()
    xs, xc, xm, y = data
    correct = tot = 0
    c_tgt = n_tgt = c_no = n_no = 0
    loss_sum = 0.0
    for i in range(0, len(y), batch):
        b = slice(i, i + batch)
        logits = model(xs[b].to(device), xc[b].to(device), xm[b].to(device))
        yb = y[b].to(device)
        loss_sum += F.cross_entropy(logits, yb, reduction='sum').item()
        pred = logits.argmax(-1)
        hit = (pred == yb)
        correct += hit.sum().item()
        tot += len(yb)
        is_t = yb != K
        n_tgt += is_t.sum().item()
        c_tgt += (hit & is_t).sum().item()
        n_no += (~is_t).sum().item()
        c_no += (hit & ~is_t).sum().item()
    return {
        'loss': loss_sum / max(1, tot),
        'acc': correct / max(1, tot),
        'acc_when_target': c_tgt / max(1, n_tgt),
        'acc_when_no_target': c_no / max(1, n_no),
        'n': tot, 'n_target': n_tgt, 'n_no_target': n_no,
    }


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='training/data/dataset.jsonl')
    ap.add_argument('--out', default='models/neural-bot-v1/model.json')
    ap.add_argument('--ckpt', default='training/checkpoints/target_v1.pt')
    ap.add_argument('--device', default='auto', choices=['auto', 'cpu', 'mps'])
    ap.add_argument('--hidden', type=int, default=32)
    ap.add_argument('--epochs', type=int, default=30)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--patience', type=int, default=6)
    ap.add_argument('--no-target-weight', type=float, default=0.4,
                    help='loss weight for the "no target" class (it is over-represented)')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--resume', action='store_true')
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = pick_device(args.device)
    data_path = args.data if os.path.isabs(args.data) else os.path.join(ROOT, args.data)

    print(f'device: {device.type}  (mps available: {torch.backends.mps.is_available()})')
    print(f'loading {data_path}')
    rows = load_jsonl(data_path, args.limit or None)
    buckets, split_ids = split_by_match(rows, seed=args.seed)
    print(f'  {len(rows)} examples from {len(split_ids["train"]) + len(split_ids["val"]) + len(split_ids["test"])} matches')
    print(f'  train {len(buckets["train"])} | val {len(buckets["val"])} | test {len(buckets["test"])}')
    print(f'  match split: train={split_ids["train"]} val={split_ids["val"]} test={split_ids["test"]}')

    train = to_tensors(buckets['train'])
    val = to_tensors(buckets['val'])
    test = to_tensors(buckets['test'])

    y_train = train[3]
    n_no = int((y_train == K).sum())
    print(f'  label balance: with-target {len(y_train) - n_no}  no-target {n_no}')

    model = TargetPolicy(args.hidden).to(device)
    n_trainable = sum(p.numel() for p in model.parameters())
    print(f'  trainable parameters: {n_trainable}')
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    weights = torch.ones(K + 1, device=device)
    weights[K] = args.no_target_weight

    start_epoch, best_val, bad = 0, float('inf'), 0
    ckpt_path = os.path.join(ROOT, args.ckpt)
    if args.resume and os.path.exists(ckpt_path):
        ck = torch.load(ckpt_path, map_location=device, weights_only=False)
        if ck.get('obsVersion') != OBS_VERSION:
            raise SystemExit('checkpoint observation version mismatch')
        model.load_state_dict(ck['model'])
        opt.load_state_dict(ck['opt'])
        start_epoch, best_val = ck['epoch'], ck['best_val']
        print(f'  resumed from epoch {start_epoch} (best val loss {best_val:.4f})')

    xs, xc, xm, y = train
    n = len(y)
    best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    t0 = time.time()
    for epoch in range(start_epoch, args.epochs):
        model.train()
        perm = torch.randperm(n)
        total = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            logits = model(xs[idx].to(device), xc[idx].to(device), xm[idx].to(device))
            loss = F.cross_entropy(logits, y[idx].to(device), weight=weights)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)
        vm = evaluate(model, val, device)
        print(f'  epoch {epoch + 1:3d}/{args.epochs}  train {total / n:.4f}  '
              f'val {vm["loss"]:.4f}  acc {vm["acc"]:.3f}  '
              f'acc|target {vm["acc_when_target"]:.3f}  acc|none {vm["acc_when_no_target"]:.3f}')
        if vm['loss'] < best_val - 1e-4:
            best_val, bad = vm['loss'], 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            os.makedirs(os.path.dirname(ckpt_path), exist_ok=True)
            torch.save({'model': best_state, 'opt': opt.state_dict(), 'epoch': epoch + 1,
                        'best_val': best_val, 'obsVersion': OBS_VERSION,
                        'config': {'hidden': args.hidden, 'K': K,
                                   'selfDim': SELF_DIM, 'candDim': CAND_DIM}},
                       ckpt_path)
        else:
            bad += 1
            if bad >= args.patience:
                print(f'  early stopping at epoch {epoch + 1}')
                break

    model.load_state_dict(best_state)
    secs = time.time() - t0
    tm = evaluate(model, test, device)
    vm = evaluate(model, val, device)
    print(f'\ntrained in {secs:.1f}s')
    print(f'  val : acc {vm["acc"]:.3f}  acc|target {vm["acc_when_target"]:.3f}  '
          f'acc|none {vm["acc_when_no_target"]:.3f}  (n={vm["n"]})')
    print(f'  test: acc {tm["acc"]:.3f}  acc|target {tm["acc_when_target"]:.3f}  '
          f'acc|none {tm["acc_when_no_target"]:.3f}  (n={tm["n"]})')

    meta = {
        'trainedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'device': device.type, 'epochsRun': epoch + 1, 'hidden': args.hidden,
        'examples': len(rows), 'matchSplit': split_ids,
        'val': vm, 'test': tm, 'trainSeconds': round(secs, 1),
        'noTargetWeight': args.no_target_weight,
    }
    out_path = os.path.join(ROOT, args.out)
    n_params, size = export_json(model, args.hidden, meta, out_path)
    print(f'\nexported {out_path}')
    print(f'  {n_params} weights, {size / 1024:.1f} KB')
    with open(os.path.join(ROOT, 'training/data/last_metrics.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)


if __name__ == '__main__':
    sys.exit(main())

```

---

## `js/entities.js` (bot AI section, lines 442-626)

The dispatcher, the neural think step, and the original hand-coded teacher it clones and falls back to.

```javascript
  /* ---------- bot AI (all thresholds come from this.p, the brain genome) ----------
     botThink() dispatches to the selected controller. The heuristic bot below is
     the original hand-coded teacher, split into named steps but otherwise
     unchanged; the neural bot reuses its state step and safety rules and only
     replaces target selection. */
  botThink() {
    if (!Recorder.enabled) { this.runThink(); return; }
    const snap = Recorder.snapshot(this);      // observation BEFORE the decision
    this.runThink();
    Recorder.commit(this, snap);               // labels AFTER the decision
  }
  runThink() {
    if (this.botType === 'neural') this.neuralThink();
    else this.heuristicThink();
  }

  /* ---- neural controller: model picks the target, everything else heuristic ---- */
  neuralThink() {
    if (this.heuristicStateStep()) return;
    const pick = NeuralController.selectTarget(this);
    if (pick === undefined) {                  // model missing/failed -> teacher
      const best = this.heuristicSelectTarget();
      this.aiTarget = best;
      if (best) this.botCast(best);
      return;
    }
    this.aiTarget = pick;
    if (pick) this.botCast(pick);
  }

  /* ---- original hand-coded teacher ---- */
  heuristicThink() {
    if (this.heuristicStateStep()) return;
    const best = this.heuristicSelectTarget();
    this.aiTarget = best;
    if (best) this.botCast(best);
  }

  /* strategic state + flee; returns true if the bot should act no further */
  heuristicStateStep() {
    const p = this.p;
    const retreatAt = clamp(p.retreatHp + this.adapt.caution, 0.1, 0.65);
    if (this.aiState === 'retreat') {
      if (this.hpPct > p.reengageHp) this.aiState = 'push';
    } else if (this.hpPct < retreatAt) {
      this.aiState = 'retreat'; this.aiTarget = null;
      const danger = Game.heroes.some(h => h.team !== this.team && h.alive && dist(this, h) < p.recallSafeDist);
      if (!danger) this.startRecall();
      return true;
    }
    if (this.aiState === 'retreat') return true;

    // discoverable heuristic: panic-flee when locally outnumbered
    if (p.outnumberMargin < 3.9 && this.fleeT <= 0) {
      let e = 0, a = 0;
      for (const h of Game.heroes) {
        if (!h.alive || dist(this, h) > 620) continue;
        if (h.team === this.team) a++; else e++;
      }
      if (e - a >= Math.round(p.outnumberMargin)) { this.fleeT = 3; this.aiTarget = null; return true; }
    }
    return false;
  }

  /* target scoring + tower-dive veto + jungle fallback; returns the chosen unit or null */
  heuristicSelectTarget() {
    const p = this.p;
    // pick a target: prefer heroes, low hp bias
    let best = null, bestScore = Infinity;
    for (const u of Game.enemyUnits(this.team, { structures: true })) {
      const d = dist(this, u);
      if (d > p.acquireRange) continue;
      if (!Game.canSee(this.team, u)) continue;
      let score = d;
      if (u.type === 'hero') score -= p.heroBias + (1 - u.hpPct) * p.lowHpBias;
      if (u.isStructure) score += p.structPenalty;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    // avoid tower-diving with no minion cover
    if (best && best.isStructure) {
      const cover = Game.minions.some(m => m.team === this.team && m.alive && dist(m, best) < 320);
      if (!cover && this.hpPct < clamp(p.diveHp + this.adapt.caution, 0.4, 1)) best = null;
    }
    // discoverable heuristic: farm a jungle camp when nothing else to do
    if (!best && p.jungleRange > 80 && this.hpPct > 0.6) {
      for (const mo of Game.monsters) {
        if (mo.alive && dist(this, mo) < p.jungleRange) { best = mo; break; }
      }
    }
    return best;
  }
  botCast(t) {
    const p = this.p;
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (this.skillCd[i] > 0 || this.mana < s.mana) continue;
      if (Math.random() > p.castChance) continue;
      const d = this.distTo(t);
      const isHero = t.type === 'hero';
      if (i === 2) { // ult discipline: heroes only, execute threshold or a crowd
        if (!isHero) continue;
        const crowd = Game.heroes.filter(h => h.team !== this.team && h.alive && this.distTo(h) < 420).length;
        if (t.hpPct > p.ultExecuteHp && crowd < 2) continue;
      }
      switch (s.type) {
        case 'skillshot': if (d < s.range * 0.9 && isHero) this.castSkill(i, t); break;
        case 'nova': if (d < s.radius + t.radius) this.castSkill(i, t); break;
        case 'dash': if (isHero && d > 150 && d < s.dist + 100) this.castSkill(i, t); break;
        case 'zone': if (isHero && d < s.range) this.castSkill(i, t); break;
        case 'heal': if (this.hpPct < 0.65) this.castSkill(i, null); break;
        case 'blinkstrike': if (isHero && d < s.range) this.castSkill(i, t); break;
        case 'buff': if (isHero && d < 300) this.castSkill(i, null); break;
      }
    }
  }
  botControl(dt) {
    const p = this.p;
    if (this.fleeT > 0) {
      const b = FOUNTAINS[this.team];
      this.moveToward(b.x, b.y, dt);
      return;
    }
    if (this.aiState === 'retreat') {
      if (this.recallT > 0) return;
      const b = FOUNTAINS[this.team];
      if (dist(this, b) > 200) this.moveToward(b.x, b.y, dt);
      return;
    }
    // danger: enemy tower nearby with no minion cover
    const twr = Game.structures().find(s => s.alive && s.team !== this.team && dist(this, s) < s.range + 80);
    if (twr) {
      const cover = Game.minions.some(m => m.team === this.team && m.alive && dist(m, twr) < 320);
      if (!cover && this.hpPct < clamp(p.diveHp + this.adapt.caution, 0.4, 1)) {
        const b = BASES[this.team];
        this.moveToward(this.x + (b.x - this.x) * 0.1, this.y + (b.y - this.y) * 0.1, dt);
        if (this.aiTarget && this.aiTarget.isStructure) this.aiTarget = null;
        return;
      }
    }
    let t = this.aiTarget;
    if (t && (!t.alive || !Game.canSee(this.team, t) || this.distTo(t) > p.chaseRange)) t = this.aiTarget = null;
    if (t) {
      if (this.inAttackRange(t)) {
        this.tryAttack(t);
        // discoverable heuristic: kite away while the attack recovers
        if (this.ranged && p.kiteBuffer > 10 && this.atkCd > 0.35 / this.curAtkSpd()) {
          let threat = null, bd = Infinity;
          for (const h of Game.heroes) {
            if (h.team === this.team || !h.alive) continue;
            const d = dist(this, h);
            if (d < this.range * 0.7 && d < bd) { bd = d; threat = h; }
          }
          if (threat) this.moveToward(this.x + (this.x - threat.x), this.y + (this.y - threat.y), dt);
        }
      } else this.moveToward(t.x, t.y, dt);
      return;
    }
    // discoverable heuristic: stop split-pushing late game, walk with allies
    if (Game.time > p.groupAfterMin * 60) {
      let ally = null, bd = Infinity;
      for (const h of Game.heroes) {
        if (h === this || h.team !== this.team || !h.alive) continue;
        const d = dist(this, h);
        if (d < bd) { bd = d; ally = h; }
      }
      if (ally && bd > 900) { this.moveToward(ally.x, ally.y, dt); return; }
    }
    // follow lane
    if (!this.path) return;
    // re-sync waypoint if we drifted (e.g., after respawn/chase)
    let wp = this.path[this.wpIdx];
    if (!wp || this.distTo(wp) > 900) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < this.path.length; i++) {
        const d = this.distTo(this.path[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      this.wpIdx = Math.min(bi + 1, this.path.length - 1);
      wp = this.path[this.wpIdx];
    }
    while (wp && this.distTo(wp) < 80 && this.wpIdx < this.path.length - 1) { this.wpIdx++; wp = this.path[this.wpIdx]; }
    if (wp) this.moveToward(wp.x, wp.y, dt);
  }
}
```

---

## `models/neural-bot-v1/model.json` — the trained weights

Not reproduced here: it is 143 KB of raw
floating-point numbers with no human-readable meaning. Structure:

```json
{
  "schemaVersion": 1,
  "obsVersion": 1,
  "config": {"K": 16, "selfDim": 30, "candDim": 16, "hidden": 32},
  "heads": ["target"],
  "meta": { ...training provenance: date, device, epochs, match split, metrics... },
  "params": { "se0w": [...], "se0b": [...], ... }
}
```

Parameter blocks (`w` = weight matrix, row-major [outputs x inputs]; `b` = bias):

```
  ce0b       32 numbers
  ce0w      512 numbers
  ce1b       32 numbers
  ce1w     1024 numbers
  nt0b       32 numbers
  nt0w     1024 numbers
  nt1b        1 numbers
  nt1w       32 numbers
  sc0b       32 numbers
  sc0w     2048 numbers
  sc1b        1 numbers
  sc1w       32 numbers
  se0b       32 numbers
  se0w      960 numbers
  se1b       32 numbers
  se1w     1024 numbers
  TOTAL    6850 numbers
```

Naming: `se`=self encoder, `ce`=candidate encoder, `sc`=scorer, `nt`=no-target head;
`0`/`1` = first/second layer. These names are the contract between `train.py`
(which writes them) and `neural-runtime.js` (which reads them).

Measured quality on held-out matches: accuracy 0.987
(target present 0.985, no target 0.990).


---

# APPENDIX — Game-engine primitives the code above depends on

Everything below is pre-existing game code, not part of the neural bot. It is
included because the neural-bot code calls it constantly, and you cannot fully
follow that code without it.

## Math helpers and constants

`js/data.js` (from line 7)

Used everywhere: `dist(a,b)` is distance between two units, `clamp(v,a,b)` bounds a number, `norm(x,y)` makes a unit direction vector.

```javascript
const WORLD = 3200;                 // world is WORLD x WORLD units
const TEAM_BLUE = 0, TEAM_RED = 1, TEAM_NEUTRAL = 2;
const TEAM_COLORS = ['#4da3ff', '#ff5252'];
const TEAM_NAMES  = ['Blue', 'Red'];
const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const norm  = (x, y) => { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; };
const rand  = (a, b) => a + Math.random() * (b - a);
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
```

## Game.enemyUnits() — who is a legal target at all

`js/main.js` (from line 97)

The candidate builder calls this. It only ever returns units on OTHER teams — the first reason the network can never attack an ally.

```javascript
  enemyUnits(team, opts = {}) {
    const out = [];
    for (const h of this.heroes) if (h.team !== team && h.alive) out.push(h);
    for (const m of this.minions) if (m.team !== team && m.alive) out.push(m);
    if (opts.neutral) for (const mo of this.monsters) if (mo.alive) out.push(mo);
    if (opts.structures) for (const t of this.structures()) if (t.team !== team && t.alive) out.push(t);
    return out;
  },
```

## Game.canSee() — bush stealth

`js/main.js` (from line 105)

A unit in a bush is invisible unless an enemy hero or minion is within 180 units. Candidates failing this check are excluded from the network's input entirely.

```javascript
  canSee(team, u) {
    if (u.team === team || u.bush < 0) return true;
    for (const h of this.heroes) if (h.team === team && h.alive && dist(h, u) < 180) return true;
    for (const m of this.minions) if (m.team === team && m.alive && dist(m, u) < 180) return true;
    return false;
  },
```

## Game.structures() — towers and bases

`js/main.js` (from line 96)

Towers plus the two bases.

```javascript
  structures() { return this.towers.concat(this.bases); },
  enemyUnits(team, opts = {}) {
    const out = [];
    for (const h of this.heroes) if (h.team !== team && h.alive) out.push(h);
    for (const m of this.minions) if (m.team !== team && m.alive) out.push(m);
    if (opts.neutral) for (const mo of this.monsters) if (mo.alive) out.push(mo);
    if (opts.structures) for (const t of this.structures()) if (t.team !== team && t.alive) out.push(t);
    return out;
  },
```

## Hero.update() — the 60 Hz loop and the hard override chain

`js/entities.js` (from line 312)

THIS IS THE SAFETY BOUNDARY. Read the early `return`s: if the hero is dead, hook-dragged, mid-dash, channelling a recall, or stunned, the function returns BEFORE `botThink()` is reached. That is what 'the network is never consulted during hard overrides' means concretely.

```javascript
  update(dt) {
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.baseUpdate(dt);
    for (let i = 0; i < 3; i++) if (this.skillCd[i] > 0) this.skillCd[i] -= dt;
    if (this.buffAtkT > 0) this.buffAtkT -= dt;
    if (this.buffAsT > 0) this.buffAsT -= dt;
    if (this.buffSpdT > 0) this.buffSpdT -= dt;
    if (this.fleeT > 0) this.fleeT -= dt;
    if (this.hot) { this.heal(this.hot.rate * dt); this.hot.t -= dt; if (this.hot.t <= 0) this.hot = null; }

    // passive regen + income
    this.heal(this.maxHp * 0.008 * dt);
    this.mana = Math.min(this.maxMana, this.mana + this.maxMana * 0.014 * dt);
    this.gainGold(BALANCE.passiveGoldPerSec * dt);
    this.gainXp(BALANCE.passiveXpPerSec * dt);

    // hook drag overrides everything
    if (this.forced) {
      const f = this.forced; f.t -= dt;
      const d = dist(this, f.src);
      if (d > 80 && f.t > 0 && f.src.alive) {
        const dir = norm(f.src.x - this.x, f.src.y - this.y);
        this.x += dir.x * 1100 * dt; this.y += dir.y * 1100 * dt;
        this.clampWorld();
      } else this.forced = null;
      return;
    }
    // active dash
    if (this.dashS) {
      const d = this.dashS;
      const step = Math.min(d.remaining, d.speed * dt);
      this.x += d.dx * step; this.y += d.dy * step;
      d.remaining -= step;
      this.facing = Math.atan2(d.dy, d.dx);
      this.clampWorld();
      if (d.dmg) {
        for (const u of Game.enemyUnits(this.team, { neutral: true })) {
          if (!d.hitSet.has(u) && dist(this, u) < 70 + u.radius) {
            d.hitSet.add(u);
            u.takeDamage(d.dmg, this);
            if (d.stun) u.applyStun(d.stun);
            if (d.stopOnHero && u.type === 'hero') d.remaining = 0;
          }
        }
      }
      if (d.remaining <= 0.5) { if (d.endNova) this.doNova(d.endNova); this.dashS = null; }
      return;
    }
    // recall channel
    if (this.recallT > 0) {
      if (this.isPlayer && Input.moveVector()) { this.recallT = 0; return; }
      this.recallT -= dt;
      if (this.recallT <= 0) {
        const b = FOUNTAINS[this.team];
        Game.fx.ring(this.x, this.y, 80, '#8ecbff', 0.5);
        this.x = b.x + rand(-60, 60); this.y = b.y + rand(-60, 60);
        Game.fx.ring(this.x, this.y, 90, '#8ecbff', 0.6);
        this.wpIdx = 0;
      }
      if (this.isPlayer) return; // player recall cancel handled in playerControl via input check before this
      return;
    }

    if (this.stunT > 0) return;
    if (this.isPlayer) this.playerControl(dt);
    else {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) { this.aiTimer = 0.22 + rand(0, 0.12); this.botThink(); }
      this.botControl(dt);
      if (this.attackOnMove && this.atkCd <= 0) this.opportunityAttack();
    }
  }
```

## Hero.botControl() — the 60 Hz executor that consumes aiTarget

`js/entities.js` (from line 557)

The network writes `hero.aiTarget`; THIS reads it. It re-validates the target every frame (alive? still visible? within chase range?), so a stale or now-illegal target is dropped regardless of what the model said. This code is shared identically by heuristic and neural bots.

```javascript
  botControl(dt) {
    const p = this.p;
    if (this.fleeT > 0) {
      const b = FOUNTAINS[this.team];
      this.moveToward(b.x, b.y, dt);
      return;
    }
    if (this.aiState === 'retreat') {
      if (this.recallT > 0) return;
      const b = FOUNTAINS[this.team];
      if (dist(this, b) > 200) this.moveToward(b.x, b.y, dt);
      return;
    }
    // danger: enemy tower nearby with no minion cover
    const twr = Game.structures().find(s => s.alive && s.team !== this.team && dist(this, s) < s.range + 80);
    if (twr) {
      const cover = Game.minions.some(m => m.team === this.team && m.alive && dist(m, twr) < 320);
      if (!cover && this.hpPct < clamp(p.diveHp + this.adapt.caution, 0.4, 1)) {
        const b = BASES[this.team];
        this.moveToward(this.x + (b.x - this.x) * 0.1, this.y + (b.y - this.y) * 0.1, dt);
        if (this.aiTarget && this.aiTarget.isStructure) this.aiTarget = null;
        return;
      }
    }
    let t = this.aiTarget;
    if (t && (!t.alive || !Game.canSee(this.team, t) || this.distTo(t) > p.chaseRange)) t = this.aiTarget = null;
    if (t) {
      if (this.inAttackRange(t)) {
        this.tryAttack(t);
        // discoverable heuristic: kite away while the attack recovers
        if (this.ranged && p.kiteBuffer > 10 && this.atkCd > 0.35 / this.curAtkSpd()) {
          let threat = null, bd = Infinity;
          for (const h of Game.heroes) {
            if (h.team === this.team || !h.alive) continue;
            const d = dist(this, h);
            if (d < this.range * 0.7 && d < bd) { bd = d; threat = h; }
          }
          if (threat) this.moveToward(this.x + (this.x - threat.x), this.y + (this.y - threat.y), dt);
        }
      } else this.moveToward(t.x, t.y, dt);
      return;
    }
    // discoverable heuristic: stop split-pushing late game, walk with allies
    if (Game.time > p.groupAfterMin * 60) {
      let ally = null, bd = Infinity;
      for (const h of Game.heroes) {
        if (h === this || h.team !== this.team || !h.alive) continue;
        const d = dist(this, h);
        if (d < bd) { bd = d; ally = h; }
      }
      if (ally && bd > 900) { this.moveToward(ally.x, ally.y, dt); return; }
    }
    // follow lane
    if (!this.path) return;
    // re-sync waypoint if we drifted (e.g., after respawn/chase)
    let wp = this.path[this.wpIdx];
    if (!wp || this.distTo(wp) > 900) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < this.path.length; i++) {
        const d = this.distTo(this.path[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      this.wpIdx = Math.min(bi + 1, this.path.length - 1);
      wp = this.path[this.wpIdx];
    }
    while (wp && this.distTo(wp) < 80 && this.wpIdx < this.path.length - 1) { this.wpIdx++; wp = this.path[this.wpIdx]; }
    if (wp) this.moveToward(wp.x, wp.y, dt);
  }
```

## Unit methods used by the neural bot

`js/entities.js` (class Unit)

`moveToward` and `tryAttack` are the ONLY ways any controller — player, heuristic bot, or neural bot — can affect the world. They enforce stun checks, attack cooldowns, and world bounds.

```javascript
  get hpPct() { return this.hp / this.maxHp; }
  curAtk() { return this.atk; }

  inAttackRange(u) { return this.distTo(u) <= this.range + this.radius + u.radius; }
  moveToward(tx, ty, dt) {
    if (this.stunT > 0) return;
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return;
    const step = Math.min(d, this.curSpeed() * dt);
    this.x += dx / d * step; this.y += dy / d * step;
    this.facing = Math.atan2(dy, dx);
    this.clampWorld();
  }

  moveToward(tx, ty, dt) {
    if (this.stunT > 0) return;
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return;
    const step = Math.min(d, this.curSpeed() * dt);
    this.x += dx / d * step; this.y += dy / d * step;
    this.facing = Math.atan2(dy, dx);
    this.clampWorld();
  }

  tryAttack(target) {
    if (this.stunT > 0 || !target || !target.alive) return;
    this.facing = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.atkCd > 0) return;
    this.atkCd = 1 / this.curAtkSpd();
    this.attackAnim = 0.18;
    if (this.ranged) {
      Game.projectiles.push(Projectile.homing(this, target, this.attackDamageFor(target)));
      if (this.isPlayer) SFX.shoot();
    } else {
      target.takeDamage(this.attackDamageFor(target), this);
      Game.fx.slash(target.x, target.y, this.facing);
      if (this.isPlayer || target.isPlayer) SFX.hit();
    }
  }
```

## What `this.p` is (the tuning parameters)

`js/brain.js`

Bot thresholds live in a parameter object `hero.p`: `p.acquireRange` is 560, `p.chaseRange` is 720, `p.diveHp` is 0.95, etc. The neural bot reads a few of these for its safety checks and for encoding `inNoticeRadius` / `inChaseRadius`. The `d` field is the original hand-coded default.

```javascript
const GENES = [
  { k: 'retreatHp',       min: 0.12, max: 0.55, d: 0.36, desc: 'retreat below this HP%' },
  { k: 'reengageHp',      min: 0.60, max: 0.95, d: 0.85, desc: 'rejoin fight above this HP%' },
  { k: 'acquireRange',    min: 380,  max: 720,  d: 560,  desc: 'notice-enemy radius' },
  { k: 'chaseRange',      min: 500,  max: 950,  d: 720,  desc: 'give-up-chase radius' },
  { k: 'heroBias',        min: 40,   max: 320,  d: 180,  desc: 'prefer heroes over minions' },
  { k: 'lowHpBias',       min: 0,    max: 300,  d: 150,  desc: 'prefer wounded heroes' },
  { k: 'structPenalty',   min: 0,    max: 250,  d: 100,  desc: 'deprioritize structures' },
  { k: 'diveHp',          min: 0.50, max: 1.00, d: 0.95, desc: 'HP% needed to fight under tower' },
  { k: 'castChance',      min: 0.20, max: 0.90, d: 0.45, desc: 'skill-cast eagerness' },
  { k: 'ultExecuteHp',    min: 0.30, max: 0.95, d: 0.55, desc: 'ult when target below this HP%' },
  { k: 'recallSafeDist',  min: 500,  max: 1200, d: 900,  desc: 'recall if no enemy within' },
  /* dormant candidate heuristics — start off, discoverable by mutation */
  { k: 'kiteBuffer',      min: 0,    max: 170,  d: 0,    desc: 'kite during attack recovery (0=off)' },
  { k: 'jungleRange',     min: 0,    max: 700,  d: 0,    desc: 'take jungle camps when idle (0=off)' },
  { k: 'groupAfterMin',   min: 3,    max: 30,   d: 30,   desc: 'group with allies after N min (30=off)' },
  { k: 'outnumberMargin', min: 1.5,  max: 4,    d: 4,    desc: 'flee when outnumbered by N (4=off)' },
];
```

