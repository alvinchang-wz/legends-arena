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
  retreatHp: 0.28,        // retreat below this HP fraction
  reengageHp: 0.72,       // resume pushing above this HP fraction
  acquireRange: 700,      // notice-enemy radius
  chaseRange: 980,        // give-up-chase radius
  heroBias: 240,          // prefer heroes over minions (score bonus)
  lowHpBias: 210,         // prefer wounded heroes (score bonus, scaled by missing HP)
  structPenalty: 70,      // deprioritize towers (score penalty)
  diveHp: 0.88,           // HP fraction needed to fight under an enemy tower
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
  lastHitBias: 340,       // secure a killable minion when no hero is more urgent
  killBias: 260,          // prioritize heroes within roughly two basic attacks of death
  healAllyHp: 0.68,       // supports heal a nearby wounded teammate, not only themselves
  isolateBias: 220,       // collapse on a lone visible hero
  recallPunish: 280,      // interrupt a channeling recall
  siegeBias: 190,         // peel the hero hitting our turret

  /* Epic objectives (Turtle / Lord) and buff camps. These are live values,
     not dormant experiments: an objective nobody contests is scenery. */
  objectiveRange: 2200,   // notice Turtle/Lord from this far
  objectiveHp: 0.46,      // don't start an epic below this HP fraction
  objectiveCommitHp: 0.24, // ...but stay in a contest already under way to here
  objectiveMinAllies: 1,  // allies nearby (excluding self) needed to commit
  objectiveEnemyRatio: 1.28, // don't start into a visibly stronger enemy contest
  campRange: 640,         // laners steal a nearby buff — junglers use pickJungleCamp
  campHp: 0.48,           // ...and above this HP fraction

  /* Optional behaviours — thresholds below enable them (see comments). */
  kiteBuffer: 78,         // >10 : ranged heroes back off during attack recovery
  jungleRange: 520,       // >80 : take jungle camps when idle, within this range
  groupAfterMin: 8,       // <28 : regroup with allies after this many minutes
  outnumberMargin: 2.4,   // <3.9: flee when outnumbered locally by this many
};

/* Fresh copy per hero so nothing can accidentally share/mutate the table. */
function defaultBotParams() { return { ...BOT_PARAMS }; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BOT_PARAMS, defaultBotParams };
}
