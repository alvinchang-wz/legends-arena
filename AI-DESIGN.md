# The AI We're Building: Continuously Self-Improving Heuristic Bots

> **Status (verified 2026-09-04): design doc / roadmap — NOT fully implemented.**
> Implemented today: static hand-tuned bot (`js/entities.js` + thresholds in
> `js/bot-params.js`), plus the neural target-selection clone described in
> TRAINING.md. There is no `js/brain.js`, no genome mutation/promotion/archive,
> and no localStorage trainer. The four "dormant" heuristics now ship live at
> sensible defaults (see `js/bot-params.js` header).

## The Vision

Each of the 10 heroes in a match is controlled by its own independent bot.
We are building a system where those bots **automatically improve their own
heuristics** — after every game, and to a lesser degree during a game — with
every version of every bot's decision rules saved as a permanent record.

The guiding theory is how humans actually form game sense:

1. **Repeated experience** — the brain is exposed to recurring input
2. **Pattern extraction** — subconscious identification of cause-and-effect
3. **Heuristic compaction** — the decision rule is automated into System 1
   (a fast shortcut)

We are not doing tabula-rasa reinforcement learning. Most AI-learns-to-play
projects start from an agent with no clue what to do and burn millions of
simulations rediscovering "walk down the lane and hit minions." That is
wasteful. Our starting point is the opposite: the hand-coded bots already
play a competent game — they lane, fight, retreat, avoid tower dives, and
close out matches. Those hand-coded rules **are** heuristics; they are
version 1 of every bot's brain. The system's job is not to learn the game
from scratch but to **refine, extend, and discover heuristics on top of an
already-sensible player**.

## Current Architecture (implemented)

### 1. Heuristics as genomes
Every decision threshold in the bot AI is a **gene** — a bounded number in
the `GENES` table (`js/brain.js`). ~15 genes per hero: retreat/re-engage HP
thresholds, aggro and chase radii, hero-focus and low-HP-focus biases,
tower-dive caution, skill-cast eagerness, ult execute discipline, recall
safety distance, and more. The hand-coded values are the seed genome.
Each of the 8 heroes has its own brain (roles should learn different
values — a tank's dive threshold shouldn't match a mage's).

### 2. The improvement loop (after each game)
- Every match, each bot instance plays either its **incumbent** genome or a
  small **mutation** of it (~40% of genes jittered by ~12% of their range).
- When the same hero appears on both teams, one side runs the incumbent and
  one the mutant — a live A/B test under shared match conditions.
- After the match, a **fitness function** scores every bot (win bonus,
  K/D/A, damage to heroes, damage to structures, gold — normalized per
  match length).
- A mutant that beats the hero's running baseline (an exponential moving
  average over its games) by a real margin is **promoted**: it becomes the
  new incumbent, the version number increments, and the full genome +
  fitness + timestamp is archived. Failed mutants are discarded.

### 3. Heuristic discovery (the hard part, tractable version)
Beyond tuning, the system can "discover" behaviors: some genes are
**dormant candidate heuristics** that ship disabled (value = off) and only
activate if evolution finds them profitable:
- kiting during attack recovery
- taking jungle camps when idle
- grouping with allies late-game
- fleeing when locally outnumbered

This is selection over a rule library — the practical stand-in for
pattern extraction → compaction. (In early testing, Ignis discovered
jungling within 7 matches; Karn evolved to never tower-dive.)

Adding a new candidate heuristic takes two steps: one gene line in
`GENES`, one gated `if` block in `botThink`/`botControl`. The trainer,
mutation engine, and archive pick it up automatically.

### 4. Within-game adaptation (during each game)
A System-1-style layer on top of the genome: every death raises a bot's
effective caution (earlier retreats, less diving), every kill lowers it.
Runtime-only; resets each match. Cross-game persistence happens only
through the trainer.

### 5. Records
Every promoted version of every bot — full genome, fitness, timestamp —
is archived to localStorage. The 🧠 panel shows versions, games played,
promotion ratios, baseline fitness, and history, with Export/Import JSON
(back up your training; the in-app preview pane can lose localStorage on
restart) and Reset-to-seed.

### 6. Training throughput
Spectator mode runs all-bot matches at 1×–8× speed with an AUTO mode that
restarts matches endlessly. Matches are bounded so the loop never stalls:
minion waves scale sharply after 18 minutes, and at 30 minutes the
healthier base wins. Bots also train (at 1×) during normal player matches.

## Known Weaknesses (acknowledged, not yet fixed)

These were identified in design discussion and are the real frontier:

1. **Single-match promotion is statistically unsound.** MOBA outcomes are
   high-variance *and compounding* (an early lucky kill snowballs), so a
   one-match A/B can promote luck as if it were skill. Correlation ≠
   causation at n=1.
2. **The fitness function is gameable (Goodhart's law).** Rewarding K/D/A,
   damage, and gold invites stat-farming that doesn't serve winning. The
   goal is the win; personal stats were included only to soften the
   credit-assignment problem (five bots share one outcome — pure win
   reward promotes free-riders and punishes good bots on bad teams).
3. **The discovery bottleneck.** The system can only select among rules a
   human wrote. It cannot conceive a new rule shape on its own.
4. **No meta-level strategy.** Every gene is individual; "we group mid at
   minute 12" has no representation, so team strategy cannot be learned —
   and meta strategy often matters more than personal stats.

## Roadmap (agreed direction)

1. **Event logging with context** — record every kill/death with its
   situation (HP%, tower fire, local numbers advantage, chasing?, minute).
   Mined across hundreds of matches, recurring death-patterns *suggest*
   the next candidate heuristics, aiming human rule-writing at what the
   data supports. This automates step 2 of the human pipeline.
2. **Seeded deterministic simulation + mirror matches** — replace
   `Math.random` with a seeded PRNG so the identical match can be replayed
   with only one heuristic flipped: a true counterfactual that isolates
   causation and slashes variance.
3. **Sequential trials (SPRT-style) instead of one-shot promotion** — a
   mutation stays "on trial" across multiple matches and is promoted only
   when its accumulated evidence separates from the baseline beyond noise
   (the method Stockfish uses to tune chess parameters). Slower per
   promotion (~5–20 matches), but promotions become trustworthy.
4. **Win-gated, win-dominated fitness** — mutations only eligible for
   promotion when their team wins (or wins more mirror seed-pairs than the
   incumbent); speed-of-win / base-HP margin secondary; personal stats
   demoted to tiebreakers.
5. **Team-level genes** — a small shared genome per team (when to group,
   which lane to commit, when to base-race) evolved purely on win-rate,
   where credit assignment is clean because the whole team owns the
   decision.
6. **(Long-term) rule-grammar search** — evolving rule *structure* from
   condition/action atoms rather than only tuning parameters. Genuine
   automated discovery, but needs orders of magnitude more games; only
   worth attempting on top of the seeded fast-sim infrastructure.

## Where Things Live

| Piece | Location | Status |
|---|---|---|
| Gene definitions, mutation, fitness, promotion, archive | `js/brain.js` | **Not implemented — no such file** |
| Bot decision-making using genes (`botThink` / `botControl` / `botCast`) | `js/entities.js` (Hero class) | Implemented with static `BOT_PARAMS` |
| Static tuning thresholds | `js/bot-params.js` | Implemented (nothing mutates at runtime) |
| Match-end training hook, auto-train restart, match caps | `js/main.js` | Partial (caps + auto-restart exist; no trainer hook) |
| 🧠 panel, speed/AUTO controls, export/import | `js/ui.js` | Partial (speed/AUTO exist; no genome panel) |
