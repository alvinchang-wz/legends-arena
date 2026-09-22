# Headless simulator

Runs the browser game's real `Game.update()` loop in Node (no build step, no
dependencies) at roughly 35-45x real time single-threaded (full match,
stats on), bit-identical for a given seed. The
game scripts under `js/` are loaded as-is; everything in this directory is
instrumentation around them.

| File | Purpose |
|---|---|
| `runtime.js` | Loads the game, `createSimulator(options)`, `step`, `run`, `snapshot`, `stats` |
| `simulate.js` | CLI: JSONL / pretty state stream, `--stats` |
| `stats.js` | Match statistics collected from outside the game |
| `batch.js` | Many matches on worker threads, aggregated to JSON + Markdown |
| `env.js` | RL-style `Env`: `reset(seed)`, `step(actions, dtMs)` |
| `*.test.js` | `node headless/runtime.test.js` etc. (node:test, no runner needed) |

```sh
node headless/simulate.js --until-end --interval-ms 1000 --seed 7 --stats match-stats.json > match.jsonl
node headless/batch.js --matches 100 --lineups draft --seed-start 1 --out ./batch-out
for f in headless/*.test.js; do node "$f"; done
```

## Determinism

`RNG.seed(seed)` swaps `Math.random` on a per-instance shadow `Math`; timers
and `performance.now` are stubbed. Two fresh simulators with the same seed and
options produce identical state streams, event logs and statistics
(`runtime.test.js`: 300 s of game time compared as JSON). Instrumentation
adds no random draws, so `stats: true|false` does not change a match.

The timestep is genuinely fixed: every `Game.update` call receives exactly
`stepMs` (1/60 s) and the number of steps is an integer derived from the total
time requested, so `intervalMs`, `step(n)` and `Env.step(actions, dtMs)` only
decide *when you look*, never what happens. Seed 1 is the same match whether
you snapshot every 50 ms or every minute (`runtime.test.js`). The price is that
snapshot times quantize to whole steps (`run({durationMs: 125})` stops at
116.67 ms, reported as 117); a duration that is not a multiple of 16.67 ms is
never overshot.

## Statistics (`sim.stats()`)

Enabled by default (`createSimulator({ stats: false })` turns it off). The
report is plain JSON:

- `match`: seed, mode, finished, winner, lengthMs, firstBloodMs, totalKills,
  killsPerMinute, `killTimeline[]` (timeMs, victim, killer, killerSource,
  assists, firstBlood). Note that the game counts every hero death in
  `Game.kills`, including turret executions, so `totalKills` does too.
- `teams.blue|red`: kills, goldEarned, `structuresDestroyed[]` (timeMs, id,
  kind, lane, by, bySource), `epicKills[]` (timeMs, kind, name, by),
  `goldTimeline[]` and `xpTimeline[]` every 30 s, towersAlive,
  inhibitorsAlive, baseHpPct.
- `heroes[]`: id, heroId, name, team, role, lane, kills, deaths, assists,
  `damage {heroes, structures, minions, monsters, total}`, damageTaken,
  healingDone, goldEarned, goldHeld, xp (cumulative), level,
  `levelTimeline[]` every 30 s (level, xp, goldEarned), timeDeadMs,
  distanceTravelled (teleports excluded), timeInBushMs, `skills[]`,
  `skillCasts {skill-1..3}`, spellCasts, `itemsBought[]`, items.

How it is collected: `onDamaged` on every entity prototype (one count per
hit, guarded against `super` calls), `die` on Hero/Tower/Inhibitor/
EpicMonster, `castSkill`/`castSpell`/`buyItem` on Hero, and a wrapper around
`Game.update` that samples every frame. Damage totals equal the game's own
`hero.stats` tallies (`stats.test.js`). Assists in the kill timeline are
damage-based (`recentDmg`); the game may also grant proximity assists, so
`hero.assists` is the authoritative number.

## Batch runner

```
node headless/batch.js --matches 100 --lineups draft --seed-start 1 --workers 8 --out ./batch-out
  --duration-cap-ms N      stop each match at N ms of game time
  --mode standard|duel
  --lineups draft          the game drafts both sides itself (Game.rosterFor +
                           assignLanes off the seeded RNG): the compositions a
                           player actually gets. Use this to measure the game
  --lineups random         (default) 1 marksman, 1 mage, 1 tank, 1 assassin/fighter,
                           1 support/fighter per team, drawn from the batch seed
                           (not the game's RNG) and ordered to the lanes Game.start assigns.
                           Role win rates from it are partly arithmetic: the composition
                           is forced, so it answers "this hero in this slot", not "this draft"
  --lineups fixed          --blue-lineup a,b,c,d,e --red-lineup ...
  --bots heuristic|neural
```

Writes `batch.json` (options, aggregate, every match's statistics) and
`batch.md`: per hero (picks, win rate, mean K/D/A, damage share of the team's
hero damage, gold earned at 10:00), per role, draft composition (doubled
archetypes, what jungles), match length distribution, kills per minute, wall
time. Progress goes to stderr, the Markdown to stdout.
Measured: 20 full matches in 156 s on a 16-thread machine (each match is
single-threaded, ~33 s alone, ~90 s with 16 running at once).

## Environment (`env.js`)

```js
const { Env } = require('./headless/env');
const env = new Env({
  controlled: 'blue',          // or 'red', or ['blue-0', 'red-3']
  blueLineup: 'grom,ignis,zephyr,nyx,karn',   // optional; null = the game's own draft
  autoAttack: false,           // true keeps the bot's opportunity attacks
  autoShop: false,             // true keeps ItemAI shopping
  maxTimeMs: 20 * 60 * 1000,   // optional episode cap
  reward: undefined,           // ({ hero, prev, cur, done, winner, env }) => number
});
let obs = env.reset(1);
for (;;) {
  const actions = {};
  for (const id of env.controlledIds) {
    const me = obs.heroes[id];
    const enemy = me.visibleEnemies[0];
    actions[id] = enemy
      ? { attack: enemy.id, cast: { skill: 0, target: enemy.id } }
      : { move: { dx: 1, dy: -1 } };
  }
  const { obs: next, reward, done, info } = env.step(actions, 100);
  if (done) break;
  obs = next;
}
console.log(env.stats().match);
```

Controlled heroes get a no-op `botThink` and a `botControl` that executes the
step's intent, per instance; skill points are still spent automatically on
level-up. Uncontrolled heroes keep the heuristic bot. Everything runs at the
game's fixed timestep (`stepMs`, default 1/60 s); `step(actions, dtMs)`
advances `dtMs` of game time.

### Actions (per controlled hero id)

| Key | Value | Effect |
|---|---|---|
| `move` | `{dx, dy}` | Walk in that direction for this step (normalized; walls slide). Missing = stand still. |
| `attack` | entity id | Attack that enemy when in range, otherwise walk to it (unless `move` is given). Ids: `blue-0`.., `tower-3`, `inhibitor-1`, `base-red-1`, `minion-N`, `monster-N` as they appear in observations. |
| `cast` | `{skill: 0..2, point?: {x, y}, target?: id}` | One-shot. Without point/target the game's auto-aim picks the nearest visible enemy. |
| `spell` | `{point?: {x, y}}` | One-shot battle spell. |
| `recall` | `true` | Start recalling. |
| `buy` | item id | Buy when at the shop (fountain or dead). |

`info.actions[id]` reports each one-shot: `ok`, `not-ready`, `invalid-skill`,
`invalid-target`, `not-at-shop`, `cannot-buy`, `unknown-item`,
`not-possible`.

### Observation

`obs = { timeMs, gameState, heroes: { [id]: view } }` where each view has
`self` (the same hero record as the state snapshot: position, velocity, hp,
mana, level, xp, gold, cooldownsMs, skills, items, buffs, crowdControl,
respawnMs, recallMs ...), `allies`, `visibleEnemies`, `minions` (nearest 8
within 1500, visible), `monsters` (nearest 4 within 1500, visible),
`structures` (all 26), `objectives`, `teams {own, enemy}`, `timeMs` and
`flat`, a `Float32Array(309)`. `Env.layout.fields` lists every flat field
with its offset and description (`env.flatLength`, `LAYOUT` export):

| Offsets | Group | Fields |
|---|---|---|
| 0-9 | globals | time/1800, team, own kills/50, enemy kills/50, own gold/50000, enemy gold/50000, own towers/9, enemy towers/9, lord up, turtle up |
| 10-30 | self | x, y (/6400), vx, vy (/1000), alive, hp, mana (fractions), level/15, xp progress, gold held/10000, gold earned/10000, respawn s/60, attack cd, skill cd 1-3, spell cd (s/60; an unlearned skill reads 1), items/6, recalling, in bush, disabled |
| 31-62 | ally[0..3] × 8 | present, dx, dy, dist (/6400), hp, alive, level/15, role/5 |
| 63-102 | enemy[0..4] × 8 | known (visible or dead), dx, dy, dist (0 when unknown), hp, alive, level/15, role/5 |
| 103-150 | minion[0..7] × 6 | present, dx, dy, dist, hp, ally |
| 151-174 | monster[0..3] × 6 | present, dx, dy, dist, hp, epic |
| 175-304 | structure[0..25] × 5 | alive, hp, dx, dy, ally (fixed order: base-blue, base-red, towers 0-17, inhibitors 0-5) |
| 305-308 | objective[0..1] × 2 | available, spawn-in s/300 (lord, turtle) |

Role index: Marksman 0, Mage 1, Tank 2, Assassin 3, Fighter 4, Support 5,
divided by 5. Enemies are only positioned when the own team can see them
(fog of war and bushes apply, as for the bots).

### Reward

Default, per controlled hero and step:
`gold earned delta / 100 + kills delta - deaths delta + structure damage delta / 1000`.
Pass `reward(ctx)` to replace it; `ctx.prev`/`ctx.cur` hold goldEarned,
kills, deaths, assists, structureDamage, heroDamage, damageTaken, level;
`ctx.hero` is the observation view; `ctx.done`/`ctx.winner` are the
episode's. `done` is true when a base falls, at the 30-minute cap, or at
`maxTimeMs`.

Measured: about 540 env steps/s at 50 ms per step with five controlled
heroes (27x real time; observation encoding is most of the cost).

## Not exposed yet

- Skill-point allocation (automatic), selling items, choosing emblem or
  battle spell (role defaults), pings, surrender.
- Projectiles, zones and the vision grid are not in the flat vector
  (`snapshot({detail: 'full'})` has projectiles and zones).
- Enemy items, buffs and cooldowns; hero passive state; minion lane/kind in
  the flat vector (they are in the structured view).
- `duel` and `ten` modes in `Env` (the simulator and batch support `duel`).
- Neural bots as opponents inside `Env` need `models/neural-bot-v1`.
- The bots' own decision inputs (`js/ai/observation.js`) are separate from
  this observation.

## Things noticed in the game (not changed here)

- Bot shopping has been reworked twice (`ItemAI` in `js/items.js`). The second
  pass gave components a purpose: a part already in a slot is credited in full
  against the item it builds (`Hero.priceOf` / `partsFor`), so `ItemAI.nextBuy`
  can convert 400 gold into stats while the 1,150 item is still a wave away,
  and `TeamBrain.goalFor` sends a hero home whenever that purchase exists
  rather than only when it is also hurt. Measured over 20 matches of the
  game's own draft (seeds 1-20), before -> after: unspent gold per hero median
  891 -> 494, heroes over 1,000 unspent 44% -> 4%, slots filled mean 3.2 -> 4.3
  (median 3 -> 4), gold spent per hero median 2,450 -> 3,248. The remaining
  ceiling is income, not willingness: a median hero earns 3,779 gold in a
  14-minute match and the cheapest real build step is 300 (a component) to
  850 (boots).
