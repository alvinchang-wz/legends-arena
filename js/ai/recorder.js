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
