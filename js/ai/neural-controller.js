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
      // Shared tactical safety keeps the model from walking under a turret to
      // follow an otherwise legal target. This happens after inference, so an
      // older model still benefits without changing its observation schema.
      if (hero.advancedAI && !hero.botTargetSafe(u)) {
        this.stats.noTarget++;
        return null;
      }
      // Legacy fallback when advanced tactics are disabled for an A/B run.
      if (!hero.advancedAI && u.isStructure) {
        const cover = Game.minions.some(m => m.team === hero.team && m.alive && dist(m, u) < 320);
        const p = hero.p || BOT_PARAMS;
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
