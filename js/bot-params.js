'use strict';
/* ============================================================
   bot-params.js — the hand-coded bot's tuning constants.

   Every threshold the heuristic bot uses lives here in one place, so
   behaviour can be tuned without hunting through entities.js. These are
   the original hand-coded values; nothing mutates them at runtime.

   (The last four used to ship disabled; they are now live at sensible
    defaults so bots kite, jungle when idle, group late, and flee when
    outnumbered.)
   ============================================================ */

const BOT_PARAMS = {
  retreatHp: 0.18,        // retreat floor; the live threshold adds the burst aimed at you (bot-ai.md §5.1)
  reengageHp: 0.72,       // resume pushing above this HP fraction
  acquireRange: 700,      // notice-enemy radius
  chaseRange: 980,        // give-up-chase radius
  heroBias: 240,          // prefer heroes over minions (score bonus)
  lowHpBias: 210,         // prefer wounded heroes (score bonus, scaled by missing HP)
  diveHp: 0.88,           // legacy: only the !advancedAI branch of the neural controller reads it
  castChance: 0.97,       // per-think-tick chance to use a ready skill
  farmManaFloor: 0.28,    // spend skills on creeps only above this mana fraction
  ultExecuteHp: 0.68,     // use the ultimate on targets below this HP fraction
  recallSafeDist: 920,    // recall only if no visible enemy hero is within this range
  shopRecallMinGold: 720, // cash in a completed-item purchase instead of hoarding gold
  manaRecallPct: 0.18,    // also reset when nearly dry and the lane is safe
  collapseRange: 1280,    // join an ally's visible hero fight out to this range
  peelBias: 140,          // tanks/supports prefer the hero currently hitting a wounded ally
  squishBias: 80,         // assassins and mages extra-prefer Marksman/Mage/Support targets

  /* Tactical evaluation. Counts are not enough: one healthy level-10 hero
     should not flee two enemies who each have 5% HP. */
  fightRadius: 740,
  fightPowerRatio: 1.42,  // flee only when visibly outclassed, not even fights
  focusBias: 170,         // help an ally finish the hero they are already hitting
  stickyBias: 90,         // avoid changing targets every think tick
  killBias: 260,          // prioritize heroes within roughly two basic attacks of death
  healAllyHp: 0.68,       // supports heal a nearby wounded teammate, not only themselves
  isolateBias: 220,       // collapse on a lone visible hero
  recallPunish: 280,      // interrupt a channeling recall
  siegeBias: 190,         // peel the hero hitting our turret

  /* Epic objectives (Turtle / Lord) and buff camps. These are live values,
     not dormant experiments: an objective nobody contests is scenery. */
  objectiveRange: 2200,   // notice Turtle/Lord from this far
  objectiveHp: 0.50,      // don't start an epic below this HP fraction
  objectiveCommitHp: 0.24, // ...but stay in a contest already under way to here
  objectiveMinAllies: 2,  // allies nearby (excluding self) needed to commit (Lord adds lordExtraAllies)
  objectiveEnemyRatio: 1.28, // don't start into a visibly stronger enemy contest
  campRange: 640,         // laners steal a nearby buff — junglers use pickJungleCamp
  campHp: 0.48,           // ...and above this HP fraction

  /* Spacing and grouping. `kiteStep` is a step directly away from the
     nearest melee threat during attack recovery, not an orbit around the
     target (bot-ai.md §5.4); grouping is a team plan now, not a clock. */
  kiteStep: 120,          // units stepped away from a diver while the swing recharges
  kiteMax: 0.35,          // seconds of that step per swing, at most
  jungleRange: 0,         // laners no longer wander into camps; the jungler has a route
  outnumberMargin: 2,     // flee when outnumbered locally by this many (always on)

  /* Macro (bot-ai.md §4-5). */
  engageAllies: 2,        // allies within 600 of the target needed to dive a live turret
  turretHitsMax: 2,       // turret shots taken before the leash pulls you out
  gankWindow: 15,         // seconds a gank goal lives
  prepWindow: 45,         // seconds before an epic spawns that the team prepares
  bushWait: 25,           // seconds before spawn the roamer sits in the pit bush
  /* §5.3 target value by archetype, as a score bonus: a marksman is worth
     killing, a tank is a wall you have to go through to reach one. */
  roleValue: { Marksman: 130, Mage: 100, Assassin: 70, Support: 50, Fighter: 25, Tank: 0 },
};

/* Fresh copy per hero so nothing can accidentally share/mutate the table. */
function defaultBotParams() { return { ...BOT_PARAMS }; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BOT_PARAMS, defaultBotParams };
}
