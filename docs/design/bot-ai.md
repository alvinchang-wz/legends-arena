# Bot AI: layered heuristic design

Design spec for the hand-coded bot in `js/entities.js` (Hero class). Written 2026-09-21 against the code as it is today, with the baseline measured in the headless simulator (`node headless/simulate.js`, seeds 1 and 2, random lineups, until end). Reference behaviour and timings come from `docs/research/mlbb-reference.md` section 6 (macro play and bot heuristics); its confidence tags apply here too.

This is a design, not a patch. Every change is written as *current -> new*, with the file and function it lives in and how to see it in the simulator. Nothing here needs a planner, learning, or map-hacking: it is scoring tables, a clock, and two timers.

Units: world units (WORLD = 6400; 1 map px = 14.68 world units). Hero base speed 236-280 (`HEROES[].speed`, 262 typical), hero radius 38, turret attack range 410 plus turret radius 100, hero vision 900, minion vision 420, side lane polyline 10,797 long, mid 7,598. A hero walks fountain -> mid outer turret (3,216) in about 12 s and fountain -> either pit (about 4,500) in about 17 s. Waves every 26 s (`BALANCE.waveInterval`), first at 0:03, minion speed 180, so mid waves meet at about 0:25 and side waves at about 0:33.

---

## 1. Where the bot lives today

| Piece | File / function | Cadence |
|---|---|---|
| Think tick (state machine, target pick, casts) | `Hero.update` -> `botThink` -> `heuristicThink` -> `heuristicStateStep`, `heuristicSelectTarget`, `botCast` | every 0.12-0.20 s, 0.06-0.10 s when "hot" (`Hero.update`, entities.js ~line 925) |
| Execute (move, attack, kite, idle fallbacks) | `Hero.botControl` | every frame (60 Hz) |
| Attack anything in reach while moving | `Hero.opportunityAttack` | every frame |
| Navigation | `Hero.botMoveTo` -> `Game.navSegmentClear`, `Game.navRisk`, `Game.findNavPath` (main.js 395-570) | every frame; A* replan every 0.65-0.83 s or when the goal moves > 110 |
| Vision | `Game.updateVision`, `Game.canSee` (main.js 766-823) | every frame, 64x64 grid per team |
| Lane assignment | `Game.start` (main.js 178-200): fixed slot lists `['roam','top','jungle','mid','bot']` (spectator and red) and `['top','jungle','mid','bot']` (the player's allies) | once |
| Thresholds | `js/bot-params.js` `BOT_PARAMS` | static |
| Objective clock | `Game.TURTLE_AT 120`, `TURTLE_RESPAWN 120`, `LORD_AT 480`, `LORD_RESPAWN 180` (main.js 303-304), `BALANCE.ancientLordAt 900` (data.js 638) | - |
| Headless | `headless/runtime.js` loads `CORE_SCRIPTS` plus the simulation half of `main.js`; **not** `js/features.js` or `js/mlbb.js` | - |

Lane names on a hero (`hero.lane`) are polyline names: `LANES.top` runs blue base -> left edge -> top edge -> red base, `LANES.bot` runs bottom edge -> right edge, `LANES.mid` is the diagonal; red heroes walk `LANES_RED[lane]` (the same polyline reversed). The Turtle pit (4433, 4533) sits beside the physical `bot` polyline and the Lord pit (1967, 1867) beside the physical `top` polyline for **both** teams, so `bot` is the EXP lane and `top` is the gold lane for both teams. `Minion.die` (entities.js 2382-2392) already applies `goldLaneMult` to `top` and `expLaneMult` to `bot`.

**Label mismatch to know about:** red turrets carry lane labels from red's own perspective. `TOWER_SPOTS` red `top` turrets at (6126, 4688), (6126, 3326), (6126, 1549) lie on the physical `bot` polyline and red `bot` turrets at (4801, 294), (3529, 294), (1632, 294) on the physical `top` polyline (verified by projecting every turret onto `LANES`). Blue labels match the polylines. `Game.spawnLordMinion` counts enemy turrets by label and then walks `LANES[label]`, so a blue Lord picks its lane from the wrong counts. This design keys structures by `physLane(structure)` (section 4.1), computed once at match start, never by `tower.lane`.

---

## 2. Diagnosis of the current bot

Baseline, three seeds of `createSimulator({seed, intervalMs: 1000}).run({untilEnd: true})` with random lineups:

| Measure | Seed 1 | Seed 2 | Seed 3 |
|---|---|---|---|
| Length | 29.5 min (red) | 30.0 min, decided by the cap (red) | 30.0 min, cap (blue) |
| Hero deaths | 108 (3.66 per minute, both teams) | 137 (4.57 per minute) | 132 (4.40 per minute) |
| Deaths to turrets | 15 (14%) | 10 (7%) | 10 (8%) |
| Turrets destroyed | 15 | 12 | 14 |
| Turtle | 2 of 2 spawns killed, alive 163 s total | 3 of 3, alive 47 s | 3 of 3, alive 43 s |
| Lord | 4 of 5 killed, alive 571 s total | 7 of 7, alive 131 s | 5 of 5, alive 480 s |
| Gold at 10:00, one team | 2,266 to 4,905 (2.2x spread) | 2,071 to 7,067 (3.4x) | 3,838 to 7,243 (1.9x) |
| Positions | Support jungle, Mage roam, Support mid, Fighter gold | Marksman jungle (60/0/13, 42,299 gold), Fighter mid, Fighter roam | Assassin roam, Support jungle, Mage jungle, Marksman mid |
| Pings | 307 gather, 163 retreat, 72 help | 46 gather, 99 retreat, 110 help | 200 gather, 89 retreat, 101 help |
| Wall time | 464 s | 492 s | 469 s |

60 simulated seconds cost 15.6 s of wall time (about 4x real time), and the CPU profile of a 4-minute run puts `Game.navRisk` at 15.6% self time, `WALL_DIST.at` 12.4%, `distTo` + `dist` 18.3%, `Game.structures` 5.5%, `findNavPath` 4.0%, `Game.update` (the per-hero bush loop) 4.5%.

### 2.1 What it does well (keep)

- Retreat hysteresis with an escape cast (`heuristicStateStep`, `botEscapeCast`): dashes aim away from the chaser and prefer putting a wall between them.
- Power comparison instead of head counts (`botStrength`, `localFightPower`, `fightPowerRatio 1.42`).
- Turret cover rule (`botTargetSafe`, `hasMinionCover`, `gapCloseLegal`): no structure target without an allied minion within 330.
- Zone and skillshot dodging (`dodgeZones`, `dodgeProjectiles`) is cheap and effective.
- Skill urgency ordering (`botSkillUrgency`): CC before damage, ult gated on execute HP or 2+ enemies, farm casts gated on a mana floor and no visible enemy.
- Objective secure by damage, not HP% (`botCastSpell` retribution branch: 500 camp, 800 epic).
- Retribution goes to the jungle slot regardless of hero (`Game.start` line 240).
- Wall-aware navigation with route caching (`botMoveTo`); combat-point sampling with a stable flank (`chooseCombatPoint`).

### 2.2 What makes it look dumb (concrete, from the code)

1. **No macro layer.** There is no team state, no clock, no goals. `aiState` is only `push` or `retreat`. Every bot decides alone from what it can see; "teamwork" is five copies of the same score function agreeing (ORIGINAL-BOT.md says so).
2. **Roles are ignored at lane assignment.** `Game.start` hands out lanes by slot index, so seed 1 fielded a Support jungler, a Mage roamer, a Support mid and a Fighter in the gold lane, and seed 2 a Marksman jungler who went 60/0. `botRole()` is only consulted for target biases and combat spacing.
3. **Re-planning every frame.** Per hero per frame `botControl` runs `Game.structures().find(...)` (allocates three concatenated arrays, line 2087) and, when idle, `recallingEnemy()`, `isolatedEnemy()` (O(heroes^2)), `alliedTowerInTrouble()`, `nearbySkirmish()`, `lastSeenHunt()`, `roamAnchor()`, `shadowAlly()` (lines 2136-2175). None of those changes meaningfully inside 100 ms. `navRisk` (main.js 440) loops every structure and calls `hasMinionCover` (a full minion scan) per structure per sampled point, and `navSegmentClear` samples every 70 units; that is where half the frame goes.
4. **No wave management.** `laneWaveAnchor` follows the leading allied cluster; there is no freeze, slow push or crash. `lastHitBias 340` competes with `heroBias 240` inside one score, so a laner walks off a killable minion to poke a full-HP hero and back. `opportunityAttack` autos the wave every frame, so every lane pushes permanently.
5. **Dives happen one at a time.** `botTargetSafe` lets a bot under an uncovered turret fight a hero when `u.hpPct < 0.18 || botCanKill(u)` and it has > 55% HP, with no check that an ally is coming. `gapCloseLegal` waives the turret test for Tanks and Fighters ("Tanks may still go"). The turret's ramp (`Tower.attackPacket`: 1.22 x (1 + 0.18 x hits, cap 4)) is never read. 7-14% of deaths are turret deaths.
6. **No objective timing.** `pickEpicTarget` only reacts to a monster that already exists within `objectiveRange 2200`; nobody prepares, nobody arrives early, the pit bushes are never used. Lord stood alive 571 s in seed 1 while 307 gather pings fired.
7. **No grouping decision.** `groupAfterMin 8` switches every laner to "rotate to any fight within 1100" and "walk to the nearest ally if > 900 away". Before 8:00 the jungler and roamer shadow whoever is under most threat (`shadowAlly`, and `roamAnchor` cycling lanes every 40 s), which is a random walk; after 8:00 the team dribbles into fights in ones and twos. Blue "closeness" (share of allied pairs within 700) averaged 0.10 over the first ten minutes on both seeds.
8. **Kiting is an orbit, not a kite.** `kiteBuffer` moves the hero to a combat point during attack recovery, but the point is chosen around the *target*, not away from the nearest *melee threat*, and the melee threshold (`atkCd > 0.4/atkSpd`) makes melee heroes shuffle too. A marksman never steps out of a diver's reach while its attack is on cooldown.
9. **Skill use ignores the kit shape.** Every skill goes through one `type` switch. A hook (`Karn` Chain Hook, `hook: true`) is fired like any skillshot at whatever the target is, a knock-up (`Rook` Dive) is not held for the engage, `endNova` dashes are used as gap closers onto full-HP tanks, and `buff` skills fire at 300 range whether or not a fight is starting.
10. **Recalls are reactive.** `shouldEconomyRecall` fires when an item is affordable and nothing is visible within 920, mid-wave, without crashing the wave; `startRecall` at `hpPct < retreatHp 0.28` happens wherever the bot stands, and any damage cancels it (the comment above `botEscapeCast` reports 81% of deaths while retreating).
11. **No memory of unseen enemies in the simulator.** `Features.lastSeen` lives in `js/features.js`, which the headless runtime does not load, so headless bots have no last-seen data and `lastSeenHunt` is a no-op there. Bush stealth (`Mlbb.bushHiddenFrom`) is not loaded headless either, and `cs` is never counted. What the simulator measures is not what ships.
12. **Junglers have a camp scorer, not a route.** `pickJungleCamp` re-scores all camps each think tick with a soft `jungleFocus`; a jungler at 0:20 walks to whichever camp scores nearest, may take a small camp first, and has no idea when Turtle is due.
13. **Idle fallbacks are ordered by code position, not by value.** `botControl`'s chain (punish recall > isolated enemy > tower in trouble > skirmish > hunt > roam/shadow > group > wave > waypoint) means an assassin walking toward a recalling enemy 1,400 away outranks its own turret dying.
14. **Match length.** All three seeds ran to the 30-minute cap. The winning team does not convert a Lord into a base push because nothing tells it to push a lane together.

---

## 3. Architecture

Three layers, three cadences. Lower layers never scan the world; they read what the layer above wrote.

```
TeamBrain.tick(team)            1 Hz per team (blue on t % 1 == 0.0, red on 0.5)
  enemy memory, danger map, wave states, objective clock, plan
  -> hero.goal for each of the 5 heroes

Hero.microThink()               10 Hz per hero (0.10 s +/- 0.02 jitter)
  retreat/engage gate, target focus, kite point, skill plan, last-hit pick
  -> hero.micro = {target, movePoint, holdFire, kiteUntil}

Hero.botControl(dt)             every frame
  dodge, move toward micro.movePoint along the cached path, attack micro.target
  no scans, no allocations
```

`aiState` keeps its two values (`push`/`retreat`) and `aiTarget` stays the committed target, so `headless/runtime.js` `_heroState`, `js/ai/recorder.js` and the neural path keep working unchanged. New fields are added next to them.

### 3.1 New data on Hero (constructor, entities.js ~line 205)

```js
this.role = null;                 // position: 'gold' | 'exp' | 'mid' | 'jungle' | 'roam' (def0.role stays the archetype)
this.goal = { kind: 'lane', lane: null, x: 0, y: 0, target: null, wave: 'hold', holdSpell: false, until: 0, seq: 0 };
this.goalSeq = -1;                // last goal.seq micro reacted to
this.micro = { target: null, movePoint: null, holdFire: false, kiteUntil: 0 };
this.microTimer = rand(0, 0.1);
this.turretHits = 0;              // turret shots taken since last leaving a turret ring
this.bushGoal = null;             // BUSHES entry to wait in
```

### 3.2 New per-team object `TeamBrain` (new file `js/bot-macro.js`)

Loaded after `js/bot-params.js` in `index.html`, in `scripts/build-www.js` if it lists scripts, and in `headless/runtime.js` `CORE_SCRIPTS`.

```js
Game.brains = [new TeamBrain(TEAM_BLUE), new TeamBrain(TEAM_RED)];   // created at the end of Game.start
class TeamBrain {
  team; tickT;                       // next tick time
  danger = new Float32Array(64 * 64);          // path cost per vision cell (section 4.3)
  dangerNoTurret = new Float32Array(64 * 64);  // same without the turret component
  memory = new Map();                // enemy hero -> {x, y, t, hpPct}, last seen (section 4.2)
  heat = new Map();                  // structure -> pressure (moved from alliedTowerInTrouble)
  waves = { top: null, mid: null, bot: null };  // section 4.4
  objective = { kind: null, phase: 'none', at: 0, pos: null, bush: null, lane: null };
  plan = 'lane'; planUntil = 0; rally = null;
  killsAtTick = [0, 0];              // Game.kills snapshot for the "won a fight" window
}
```

Everything the brain computes is O(cells) or O(units) once per second for the whole team, so its cost is bounded by the vision grid (4,096 cells) and the unit list (about 200), not by 5 heroes x 60 frames.

### 3.3 Position roles

`hero.role` is the position; `hero.def0.role` stays the hero archetype. Polyline per position: gold -> `top`, exp -> `bot`, mid -> `mid`, jungle and roam -> none. `hero.lane` keeps holding the polyline name or `'jungle'`/`'roam'`, because `Mlbb.prepHero`, `Minion.die`, `shouldRotateTo` and the headless snapshot read it.

---

## 4. Macro layer (1 Hz per team)

`TeamBrain.tick()` runs from `Game.update` right after `this.updateVision()` (main.js line 1040), guarded by `if (this.time >= brain.tickT)`; `tickT += 1`. Order inside a tick: 4.2 memory, 4.3 danger, 4.4 waves and heat, 4.5 objective clock, 4.6 plan and goals. Steps 4.2-4.5 are bookkeeping; 4.6 is the decision.

### 4.1 Static tables (once, in the `TeamBrain` constructor)

- `physLane(s)` for every tower and inhibitor: nearest polyline in `LANES` by point-to-polyline distance (`distToPolyline` exists at main.js 1560 in the render half; move it above the render marker). Stored as `s.physLane`. `laneFrac(s)`: arc-length fraction of `s` along that polyline in *this team's* direction (0 = own base), from `TOWER_SPOTS[].posFrac` for blue and `1 - posFrac` for red.
- `lanesTowers[lane]`: alive-or-dead structure list per physical lane sorted by `laneFrac`, so "next enemy structure in this lane" is a scan of six.
- `pitBushes[kind]`: the three `BUSHES` entries nearest each pit (by today's data: Turtle (4368, 5362), (5273, 4222), (4062, 4073); Lord (1127, 2178), (2338, 2327), (1587, 2616)). Chosen by distance so a map regen does not break it.
- `ownCamps` / `enemyCamps`: `Game.camps` split by nearer base (the test in `pickJungleCamp`). Blue side: redBuff (2958, 5189), blueBuff (1596, 3350), normal (3251, 4686), (3978, 5405), (947, 2748), crab (1121, 1634), litho (2497, 2516).
- `openingRoute`: `[buff nearest the gold-lane outer turret, the two normals nearest that buff, the other buff, the remaining normal, litho]`, all from `ownCamps` by distance. Blue: redBuff -> normal (3251, 4686) -> normal (3978, 5405) -> blueBuff -> normal (947, 2748) -> litho. XP: 150 + 95 + 95 + 150 + 95 + 85 = 670 plus 4/s passive; `BALANCE.xpNeed` cumulative is 435 to level 4 and 710 to level 5, so the jungler is level 4 after buff + two camps (about 1:05) and level 5-6 at the end of the route (about 1:40).

### 4.2 Enemy memory (`TeamBrain.updateMemory()`)

For each enemy hero: if `Game.canSee(team, h)` set `memory[h] = {x, y, t: Game.time, hpPct}`. Also record from `Hero.onDamaged` when `src` is an enemy hero (a hit from the fog is a sighting). Entries older than 12 s count as unknown. This replaces `Features.lastSeen` for bots so the headless build has it; `lastSeenHunt` reads `brain.memory`.

Derived per tick: `missing` (enemy heroes unseen for > 6 s), `enemyPowerAt(x, y, r)` (sum of `botStrength` of visible enemies within r plus 0.6 x for remembered ones with age < 6 s), `allyPowerAt(x, y, r)`.

### 4.3 Danger map (`TeamBrain.buildDanger()`)

`danger` uses the same 100-unit cells as `Game.vision` (`VIS_N 64`, `worldSize() / 64`). Value = extra path-cost multiplier minus 1 (0 = free ground). Rebuilt per team per second by stamping discs, the same loop shape as `updateVision`'s `stamp`:

| Source | Disc radius | Value at distance d |
|---|---|---|
| each alive enemy turret / base | `s.range + s.radius + 70` (580 turret, 690 base) | 8 + 12 x (1 - d / r); halved when an allied minion is within 330 of that turret (`hasMinionCover`, evaluated once per turret per tick) |
| each visible enemy hero | 720 | 3 x botStrength(h) x (1 - d / 720) |
| each remembered enemy hero, age a in 0-12 s | 720 + 260 x a / 12 | 2 x (1 - a / 12) x (1 - d / r) |
| enemy fountain | 600 | 40 |

A 580 disc touches about 105 cells, a 720 disc about 160; with 9-13 enemy structures and 5 heroes that is under 3,000 writes per team per second. `dangerNoTurret` is written in the same pass without the first row.

Consumers:
- `Game.navRisk(hero, x, y, opts)` **current** (main.js 440-461): loops `structures()` with `hasMinionCover` per structure and loops heroes when `opts.retreat`. **New**: `const b = this.brains[hero.team]; return 1 + (opts.avoidTowers === false ? b.dangerNoTurret : b.danger)[cell(x, y)];`. One array read instead of 26 distance tests and a minion scan.
- `Game.navSegmentClear`, `Game.findNavPath`, `chooseCombatPoint` are unchanged in shape and become cheap.
- `Game.structures()` **current** (main.js 341): `this.towers.concat(this.bases).concat(this.inhibitors)` on every call. **New**: cached `this._structs`, rebuilt in `Game.start`, `Tower.die`, `Inhibitor.die` and the inhibitor respawn branch of `Inhibitor.update`. Callers only read it.

### 4.4 Wave states and structure heat (`TeamBrain.updateWaves()`)

One pass over `Game.minions`, bucketed by `m.lane` and `m.team`, then per physical lane:

```
waves[lane] = { ours, theirs, front: {x, y}, frac, nextEnemy: s, nextOwn: s, state }
```
- `front`: centroid of the leading allied cluster (the rule in `laneWaveAnchor`, computed once here instead of per hero per frame); `frac`: its arc-length fraction in this team's direction.
- `nextEnemy` / `nextOwn`: nearest alive structure on the polyline ahead of / behind `front` (from `lanesTowers`).
- `state`: `'empty'` (ours = 0), `'crashed'` (front within 520 of `nextEnemy`), `'pushing'` (ours >= theirs + 2), `'pushed'` (theirs >= ours + 2), else `'even'`.

Structure heat (the `Game._heat` block in `alliedTowerInTrouble`, lines 1160-1175) moves here unchanged: +3 per enemy hero within `range + 90`, +1 per enemy minion within 280, using the minion pass above.

`laneWaveAnchor()` **current**: filters `Game.minions` per hero per frame. **New**: reads `brain.waves[this.lane].front` and adds the same offset toward our base (175 ranged, 105 melee).

### 4.5 Objective clock (`TeamBrain.updateObjective()`)

Reads `Game.epics` (`turtle.next`, `lord.next`, `unit`, `pos`). Both teams see the clock (it is on the HUD). Turtle at 2:00 then every 120 s until `LORD_AT` 8:00; Lord at 8:00 then every 180 s; evolved at 15:00.

```
next     = turtle if Game.time < LORD_AT else lord
tToSpawn = next.next - Game.time          (<= 0 once it is up)
phase    = 'contest' if next.unit && next.unit.alive
         = 'prep'    if 0 < tToSpawn <= prepWindow (45 s)
         = 'done'    for 30 s after an epic died (either team)
         = 'none'    otherwise
objective = { kind, phase, at: next.next, pos: next.pos,
              lane: kind == 'turtle' ? 'bot' : 'top',
              bush: pitBushes[kind] entry nearest our base }
```

### 4.6 Plan and goals (`TeamBrain.decide()`)

One team plan per tick, then one goal per hero. Plans are tested in this order; the first that fires wins, and each has a minimum hold (`planUntil`) so the team does not flicker. `alive(t)` counts living heroes of team t.

| Priority | Plan | Fires when | Hold |
|---|---|---|---|
| 1 | `defend` | an allied structure has `heat >= 3` and is inner or base (`laneFrac <= 0.27`, or `isBase`) | 8 s |
| 2 | `end` | any enemy lane has all three turrets and its inhibitor down, and (`alive(ours) - alive(theirs) >= 2` or `Game.time > 1500`) | 20 s |
| 3 | `objective` | `objective.phase` is `prep` or `contest` and not skipped by 4.6.2 | until the epic dies, or 25 s after `at` with no ally within 900 of the pit |
| 4 | `push` | in the last 12 s our kills - our deaths >= 2 (`Game.kills` deltas kept in `killsAtTick`), or `objective.phase == 'done'` and we took it, or `alive(ours) - alive(theirs) >= 2`, or a `LordMinion` of ours is alive | 30 s |
| 5 | `group` | `Game.time >= 600` and no lane has `state == 'pushing'` for us, or `alive(theirs) - alive(ours) >= 2` | 15 s |
| 6 | `lane` | otherwise | - |

Rally point per plan: `defend` -> 300 units on our side of the threatened structure; `push`/`end` -> 300 units on our side of `nextEnemy` in `chooseLane()` (the lane with the fewest alive enemy structures; tie -> lowest-HP outer; tie -> mid; the `spawnLordMinion` rule on `physLane`); `group` -> our mid outer turret if alive, else our mid inner; `objective` -> `objective.bush` in `prep`, `objective.pos` in `contest`.

#### 4.6.1 Goals per position

`goal = {kind, lane, x, y, target, wave, holdSpell, until}`; `kind` in `lane`, `jungle`, `gank`, `objective`, `rally`, `recall`, `escort`, `hunt`; `wave` in `freeze`, `slow`, `fast`, `crash`, `hold`.

Common rules (every plan, evaluated first):
- Dead heroes get `recall` (a no-op) so respawn re-evaluates cleanly.
- `recall` when `hpPct < 0.35` or `mana / maxMana < 0.15` and no visible enemy within 920, **and** the hero's lane wave is `crashed`, `empty` or `pushed` (nothing is lost by leaving), or the plan is `group`, or `tToSpawn > 60`. Otherwise `lane` with `wave: 'crash'`; the recall follows next tick once the wave state flips. This is "crash before recalling".
- Economy recall (`shouldEconomyRecall` moves here): `ItemAI.recommend(h)` affordable and `gold >= shopRecallMinGold 720`, same wave condition, and `tToSpawn > 60` or phase `done`.

Plan `lane` (default):
- gold: `lane top`; `wave: freeze` before 1:30 (the roamer is with them), `slow` while `objective.phase == 'prep'`, `fast` until 5:00 (`BALANCE.laneBonusEnd`), then `slow`. From 9:00 the gold laner follows the team plan (two items are in).
- exp: `lane bot`; `wave: freeze` until level 4, then `fast` when the enemy exp laner is missing or dead, `slow` in `prep`, otherwise `hold` (trade, do not shove).
- mid: `lane mid, wave: fast`. When `waves.mid.state == 'crashed'` and `Game.time > 55`, `gank` toward the side lane where `waves[lane].theirs > waves[lane].ours` and a visible enemy laner is within 1,200 of the river; `until = now + gankWindow 15`; if no kill and no visible enemy by then, back to `lane mid`. This is the reference's 0:55-1:25 first rotation.
- jungle: `jungle` with `target = next alive camp of openingRoute` until the route is done or 1:50; then `jungle` with `target = pickJungleCamp()` (unchanged scorer). After each buff camp, if a side lane has a visible enemy laner with `frac > 0.5` (past the river) and (`hpPct < 0.7` or no `dash`/`blinkstrike` skill ready), `gank` that lane for 15 s. Never `gank` when `tToSpawn < 40` for an objective we will contest; from `tToSpawn < 35` set `holdSpell = true` (Retribution `cd 35`, `BATTLE_SPELLS` in items.js).
- roam: 0:00-1:30 `escort` the jungler's first camp (stand at the camp; the leash matters for the 1,250-HP buff), then `escort` gold standing in the nearest `BUSHES` entry to the gold-lane front (`bushGoal`); from 1:30 `gank` the lane whose visible enemy laner has the largest `frac`; in `prep`, `rally` at `objective.bush` from `tToSpawn <= bushWait 25`; otherwise `escort` the laner with the most enemies within 650 (the `roamAnchor` score, computed here once per second).

Plan `objective`:
- `prep`: mid `lane mid, wave: fast` until `crashed`, then `rally` at `objective.bush`; gold and exp `lane, wave: slow` until `tToSpawn < 20`, then `crash`, then `rally`; roam `rally` at the bush at `tToSpawn <= 25`; jungle `jungle` (last camp on the way) until `tToSpawn <= 15`, then `rally` at the pit with `holdSpell`.
- `contest`: everyone whose lane wave is not `pushed` gets `objective` with `target = epic`; the per-hero gates in `pickEpicTarget` still apply (with `objectiveMinAllies` 2 for Turtle, 3 for Lord). The gold laner may stay when `dist(hero, pit) > 2,400` and `waves.top.state == 'pushed'`.
- skipped (4.6.2): fall through to `lane`, except the jungler, who takes `jungle` on the `enemyCamps` nearest the pit if `enemyPowerAt(pit, 900) > 1.4 x allyPowerAt(pit, 900)`.

#### 4.6.2 Skip or trade

Skip this cycle when any of: (a) `enemyPowerAt(pit, 1000) > 1.35 x allyPowerAt(pit, 1000)` and a visible enemy was within 700 of the pit before any of ours; (b) `alive(ours) < 3`; (c) our gold-lane outer turret has `heat >= 3` (it would fall for free). When skipped, the plan is `push` in the lane farthest from the pit for 30 s (the trade).

Plan `push` / `end`: the tank/support (`def0.role`) and the two heroes with the highest `hpPct` `rally` at the rally point with `wave: fast`; the gold laner and one more `lane` the other side lane with `wave: fast` (3-2 split); the jungler takes `enemyCamps` nearest the rally lane. In `end` all five `rally`. While a `LordMinion` of ours is alive, two heroes `escort` it (`target` = the minion) and three push elsewhere.

Plan `group`: all five `rally` at the group point; laners keep `wave: hold`. Anyone at the rally with `hpPct < 0.5` gets `recall` first (the rally is beside our turret).

Plan `defend`: the three nearest heroes `rally` at the structure, the other two `lane` their own lanes with `wave: fast` (never five to one turret).

#### 4.6.3 Hand-off

`TeamBrain.assign(hero, goal)` bumps `goal.seq` only when `kind`, `lane`, `target` or `wave` changed, so micro drops `aiTarget` and `nav.path` once per real change (`hero.goalSeq !== hero.goal.seq`), not every second.

---

## 5. Micro layer (10 Hz per hero)

`Hero.update` **current**: `aiTimer = hot ? 0.06-0.10 : 0.12-0.20`, then `botThink()`. **New**: `microTimer = 0.10 + rand(-0.02, 0.02)`, then `botThink()` -> `microThink()`. `runThink`/`neuralThink` keep calling the gate and the target pick as now; the neural controller only replaces the target pick.

`microThink()` in order: 1) `microGate()` (was `heuristicStateStep`), 2) `microTarget()` (was `heuristicSelectTarget`), 3) `microMove()` (new: the move point for the next 100 ms), 4) `botCast(target)`.

`botControl(dt)` **current**: a ladder with per-frame scans. **New**: (a) `dodgeZones` / `dodgeProjectiles` (unchanged); (b) if `micro.movePoint`, `botMoveTo(movePoint, opts)`; (c) if `micro.target` is alive, visible or epic/route, in range and `!holdFire`, `tryAttack`; (d) `opportunityAttack` only when `goal.wave` is `fast`/`crash` or `micro.target` is a hero. Delete lines 2087-2096 (per-frame turret scan; the leash moves to `microGate`) and 2136-2175 (idle fallbacks). `recallingEnemy`, `isolatedEnemy`, `nearbySkirmish` are called from `microTarget` at 10 Hz; `alliedTowerInTrouble`, `roamAnchor`, `shadowAlly` from `TeamBrain.decide` at 1 Hz.

### 5.1 Retreat thresholds (`microGate`)

Keep the hysteresis; scale the threshold by incoming burst instead of the flat `retreatHp 0.28`:

```
burstIn   = sum over the 3 nearest visible enemy heroes within 700 of their botBurstVs(me)
turretDmg = my danger cell has a turret component && turretHits >= 1
          ? 190 * 1.22 * (1 + 0.18 * min(4, turretHits)) : 0
retreatAt = clamp(retreatHp 0.18 + 0.9 * (burstIn + turretDmg) / maxHp + adapt.caution, 0.18, 0.62)
```
- Enter `retreat` when `hpPct < retreatAt` and not `finishing` (unchanged `finishing`).
- Enter `flee` (2.4 s) when `localFightPower` ratio > `fightPowerRatio 1.42`, **or** `enemies - allies >= outnumberMargin 2` within 620 (today the count rule only runs when `advancedAI` is false; run both).
- Leave `retreat` at `reengageHp 0.72`, or at `hpPct > 0.55` when the goal is `rally`/`objective` and no enemy is within 700.
- Turret leash: if the cell has a turret component, the nearest enemy turret (`brain.waves[lane].nextEnemy`, or the nearest in `lanesTowers`) has no minion cover, and (`turretHits >= turretHitsMax 2` or `hpPct < 0.5`), `flee` toward `Game.basePoint` for 1.5 s. `Tower.attackPacket` increments `target.turretHits` for hero targets; `microGate` resets it when the cell has no turret component.
- Recall is no longer started here. `microGate` starts the channel only when `goal.kind == 'recall'`, no visible enemy within `recallSafeDist 920`, and no damage for 3 s. When a recall is cancelled by damage, `flee` toward the nearest allied turret for 2 s before retrying.

### 5.2 Engage gate (`canEngage(target)`)

Replaces `botTargetSafe` and `gapCloseLegal`; used by target selection, dashes, blinks and Flicker:

```
alliesNear  = allied heroes within 600 of target (not self)
enemiesNear = visible enemy heroes within 600 of target
tower       = enemy turret whose ring (range + radius + 60 = 570) contains target
if tower && !hasMinionCover(tower):
    return botCanKill(target) && alliesNear >= engageAllies && turretHits == 0 && hpPct > 0.6
    (a dive is group-only; Tanks and Fighters get no exemption)
if enemiesNear >= 2 && alliesNear < 1 && !finishing: return false
if role == 'roam' && def0.role in (Tank, Support): return alliesNear >= 2   (carries in follow-up range)
if enemyPowerAt(target, 600) > allyPowerAt(target, 600) * fightPowerRatio && !finishing: return false
return true
```

### 5.3 Target focus (`microTarget`)

Keep the scan shape of `heuristicSelectTarget` (enemies within `acquireRange 700`, `collapseRange 1280` when an ally already hits them, `canSee` required); replace the additive soup for heroes with the reference's product:

```
ttk         = target.hp / max(1, myDps + allyDpsOnTarget)   (allies whose aiTarget is this hero: basicAttackDamage x curAtkSpd)
killability = clamp(6 / ttk, 0, 3)
isolation   = 1 + 0.5 * (no allied hero of theirs within 580 of target)
roleValue   = {Marksman 1.4, Mage 1.3, Assassin 1.1, Support 1.0, Fighter 0.9, Tank 0.7}[target.def0.role]
score       = killability * isolation * roleValue
            + 0.8 if target is the team focus (most allies' aiTarget)
            + 0.6 if target.recallT > 0
            + 0.5 if target is hitting an ally under 0.58 hp (Tank/Support/Fighter only)
            + 0.5 if target is inside our turret ring
            - 0.4 * dist / 700
            - 1.0 if !canEngage(target)
            + 0.3 if target === aiTarget (sticky)
```
Role overrides: Assassin +0.6 for Marksman/Mage targets and no Tank targets unless `finishing`; Marksman takes the best target already within `range + 60` and only steps forward when there is none; Mage prefers targets at 0.7-0.95 of its longest skill range; roam Tank/Support targets only the team focus or whoever hits the marksman.

Non-hero candidates: structures only when `goal.wave` is `fast`/`crash` or the plan is `push`/`end`, and `hasMinionCover`; epic via `pickEpicTarget` (unchanged gates) when `goal.kind == 'objective'` or the epic is within 900; camps when `goal.kind == 'jungle'` (route target first, `pickJungleCamp` fallback); minions per 5.6. A hero target wins over a minion only when `canEngage` and the hero is within `range + 120`.

### 5.4 Kiting and spacing (`microMove`)

Ranged heroes (`this.ranged`) with a hero target:
- After each `tryAttack` (`atkCd` was just set: `atkCd > 0.9 / curAtkSpd()`), `kiteUntil = Game.time + min(kiteMax 0.35, atkCd - 0.12)`.
- While `Game.time < kiteUntil`: move point = my position + `kiteStep 120` directly away from the nearest **melee** enemy hero within 420 (not away from the target); rejected if it leaves `dist(target) > range + radius + target.radius` when the target is the only threat, or if its danger cell is worse than mine. No melee enemy within 420: stand and shoot.
- Otherwise, when out of range, move point = `chooseCombatPoint(target)` (unchanged sampler; `Game.navRisk(...) * 110` becomes `brain.danger[cell] * 110`) constrained to our side of `waves[lane].front + 60` when an allied wave exists; never walk forward past the front to auto a target retreating under its turret; never enter the enemy turret ring unless `canEngage`.

Melee heroes: move point = `interceptPoint(target)` (unchanged); an Assassin that is `finishing` sticks.

Bush use: when the goal is `rally`/`escort` at a bush, or `gank` with no visible enemy, and `bushGoal` is set, move point = the bush centre (`BUSHES[i]`, `lobes[0]` for polygon bushes) and `holdFire = true` until a hero target is within `range + 150` or an ally within 600 engages a hero. This only matters once bush concealment exists headless (section 8).

### 5.5 Skill usage by kit hint

Add an optional `hint` per skill in `HEROES[].skills`: `poke`, `engage`, `cc`, `burst`, `escape`, `wave`, `sustain`, `buff`, `finisher`. Missing hints are derived in `Hero.constructor`, so no data edit is needed to start: `hook/suppress/stun/airborne/immobilize/silence -> cc`; `dash` without damage -> `escape`; `dash` with `stopOnHero`, `dmg` or `endNova` -> `engage`; `skillshot` -> `poke`; `zone` with `ticks` -> `wave`; `zone` with a CC -> `cc`; `heal -> sustain`; `buff -> buff`; `blinkstrike -> finisher`; skill index 2 without CC -> `burst`.

`botSkillUrgency` keeps its numbers and adds per-hint gates:
- `cc`: hero targets only; hold if `unitLockedDown` (unchanged); hold a hook (`s.hook`) unless the target is Marksman/Mage/Support or `hpPct < 0.5`.
- `engage`: only when `canEngage(target)` and (`alliesNear >= 1` or `botCanKill`); never as a farm tool.
- `escape`: never from `botCast`, only `botEscapeCast` (today a damage-less `dash` is used as a gap closer).
- `poke`: hero within 0.95 x range, or the wave when `goal.wave` is `fast`/`crash` and `farmOk`.
- `wave`: 3+ minions or 2+ heroes in the radius; never a single hero.
- `burst`: `target.hp <= botBurstVs(target)` or 2+ enemies in the radius (the existing ult gate).
- `finisher`: `target.hpPct < 0.35` or `botCanKill(target)`, and `canEngage`.
- `sustain`/`buff`: unchanged, plus `buff` when this hero or an ally within 400 cast an `engage` skill in the last 1.5 s.
- Retribution: `botCastSpell` refuses camps while `goal.holdSpell`.

### 5.6 Last-hitting and wave intent

`goal.wave` drives minion targeting in `microTarget`:

| Intent | Rule |
|---|---|
| `freeze` | Attack a minion only when `basicAttackDamage(this, m) >= m.hp - incomingAllyDps(m) x travelTime` (`travelTime = dist / projectile speed`, 0 for melee). No farm casts. Stand at `waves[lane].front` offset 175/105 toward our base; if the enemy wave is beyond our outer turret ring, stand 300 in front of the turret to pull it. |
| `slow` | Enemy ranged minions (`m.ranged`) first; ignore melee minions above 60% HP; no farm casts. |
| `fast` | Lowest-HP enemy minion in range; farm casts allowed (`farmOk`); `opportunityAttack` on. |
| `crash` | As `fast`; the goal completes when `waves[lane].state == 'crashed'` (macro flips it next tick). |
| `hold` | Attack what is in range; never walk forward for a minion. |

`incomingAllyDps(m)`: allied minions with `target === m` x `curAtk() * atkSpd` (a scan of at most about 12 minions in that lane). `lastHitBias` goes away: minions come from the intent, heroes from 5.3.

### 5.7 Recall micro

Only when `goal.kind == 'recall'`: walk to the nearest cell with danger 0 within 400 (a bush or behind our turret) and channel there. If `dist(fountain) < 1,400`, walk instead (6 s channel vs about 5 s of walking).

---

## 6. CPU budget

| Computation | Where | Cadence | Bound |
|---|---|---|---|
| Danger maps (2 arrays) | `TeamBrain.buildDanger` | per team per second | 2 x 4,096 clears + about 3,000 stamped writes |
| Enemy memory | `TeamBrain.updateMemory` | per team per second | 5 `canSee` calls |
| Wave states + structure heat | `TeamBrain.updateWaves` | per team per second | one pass over <= 180 minions, 26 structures x 10 heroes |
| Plan + goals | `TeamBrain.decide` | per team per second | 5 heroes x <= 8 candidate goals reading cached fields |
| Lane assignment | `assignLanes` | once per match | 120 permutations x 5 |
| Gate, target, move, cast | `microThink` | per hero per 100 ms | enemy units within 700-1280 (<= 40), 10 heroes, 3 skills, 6 combat-point samples with O(1) danger reads |
| Move, attack, dodge | `botControl` | per hero per frame | no scans; `botMoveTo` follows the cached path; A* replans stay at 0.65-0.83 s with one array read per expanded cell |
| `Game.structures()` | main.js 341 | per call | cached; rebuilt on structure death/respawn |

Target: a 20-minute match under `--until-end` in <= 90 s of wall time on the dev machine (today about 310 s), which is check 10 below. Under this design, anything per hero per frame that iterates `Game.minions`, `Game.heroes` or `structures()` is a bug.

---

## 7. Function-by-function change list

New file `js/bot-macro.js`:
- `class TeamBrain`: `constructor(team)`, `tick()`, `updateMemory()`, `buildDanger()`, `updateWaves()`, `updateObjective()`, `decide()`, `assign(hero, goal)`, `chooseLane()`, `enemyPowerAt(x, y, r)`, `allyPowerAt(x, y, r)`, static `physLane(s)`, `laneFrac(team, s)`.
- `function assignLanes(team, heroes, fixedPlayerPosition)`: returns `Map(hero -> position)` maximising the sum of `LANE_PREF[hero.def0.role][position]` over all 120 permutations of the five positions; the player's hero (if any) is fixed to `fixedPlayerPosition`, or to its best position when none was picked. Ties: the faster hero jungles, the longer-range hero goes gold. A Marksman or Support in the jungle scores -1e6 whenever the five include an Assassin or a Fighter, so the position is never handed to a hero who cannot clear a camp (measured 2026-09-22: 5 of 80 drafted teams had one before the guard, 0 after).
- `Game.DRAFT_SLOTS` / `Game.rosterFor` feed it a composition rather than five random heroes: the empty slots of a side are filled as gold carry (Marksman), mid (Mage), jungler (Assassin/Fighter), front-liner (Tank/Fighter) and roamer (Support/Tank), the alternate coming up about two times in five. Explicit draft picks are kept and claim the slot they fit. Measured over 80 drafted teams: doubled archetypes 85% -> 44%, teams with two or more doubled 31 -> 0.
- `const LANE_PREF = { Marksman: {gold: 10, mid: 5, jungle: 2, exp: 1, roam: 0}, Mage: {mid: 10, gold: 4, jungle: 3, exp: 2, roam: 2}, Fighter: {exp: 10, jungle: 7, gold: 3, roam: 3, mid: 2}, Assassin: {jungle: 10, exp: 4, mid: 4, gold: 2, roam: 1}, Tank: {roam: 9, exp: 6, jungle: 3, mid: 1, gold: 0}, Support: {roam: 10, mid: 3, gold: 1, exp: 1, jungle: 1} }`.
- `const POSITION_LANE = { gold: 'top', exp: 'bot', mid: 'mid', jungle: 'jungle', roam: 'roam' }`.

`js/main.js`:
- `Game.start` lines 178-200: **current** fixed slot lists -> **new** build the roster, `const pos = assignLanes(team, roster, playerPosition)`, construct each `Hero` with `POSITION_LANE[pos]` and set `hero.role = pos`. The player's position comes from the select screen if it offers one, else their best fit. The 10v10 lists stay as they are. After all heroes exist: `this.brains = [new TeamBrain(TEAM_BLUE), new TeamBrain(TEAM_RED)]` with `tickT` 0.0 and 0.5.
- `Game.update` after `this.updateVision()` (line 1040): `for (const b of this.brains) if (this.time >= b.tickT) b.tick();`.
- `Game.structures()` line 341: cached array (4.3).
- `Game.navRisk` lines 440-461: danger lookup (4.3).
- `Game.spawnLordMinion` line 730: count by `physLane`, not `t.lane` (bug fix).
- move `distToPolyline` (line 1560) above the render marker.

`js/entities.js` (Hero unless noted):
- constructor: fields in 3.1; derive skill `hint`s (5.5).
- `update`: `aiTimer` block -> `microTimer` at 0.1 s; `opportunityAttack` gated by wave intent (5).
- `heuristicThink` -> `microThink`; `neuralThink` calls `microGate` then the neural pick.
- `heuristicStateStep` -> `microGate` (5.1); remove its `startRecall` / `shouldEconomyRecall` calls.
- `heuristicSelectTarget` -> `microTarget` (5.3, 5.6); it calls `recallingEnemy`, `isolatedEnemy`, `nearbySkirmish`.
- `botTargetSafe`, `gapCloseLegal` -> both call `canEngage` (5.2); delete the Tank/Fighter exemption.
- `botCast`, `botSkillUrgency`: hint gates (5.5); `botCastSpell`: `goal.holdSpell` in the retribution branch.
- `chooseCombatPoint`: danger lookup instead of `navRisk`; wave-front constraint (5.4).
- `laneWaveAnchor`: read `brain.waves[lane].front`.
- `botControl`: dodge + move + attack only (5); delete lines 2087-2096 and 2136-2175.
- `pickJungleCamp`: unchanged; called only from `microTarget` when `goal.kind == 'jungle'` and the route target is dead.
- `alliedTowerInTrouble`: read `brain.heat`; called from `decide`.
- `lastSeenHunt`: read `Game.brains[this.team].memory`.
- `shadowAlly`, `roamAnchor`: called from `TeamBrain.decide` to produce `escort` goals; per-frame call sites deleted.
- `Hero.onDamaged`: enemy hero `src` -> `Game.brains[this.team].memory.set(src, {...})`.
- `Tower.attackPacket`: `if (target && target.type === 'hero') target.turretHits = (target.turretHits || 0) + 1`.
- `Minion.die`: `src.cs++` (today only `Features.onMinionDeath` counts it, which is not loaded headless).

`js/bot-params.js` (current -> new; keys not listed are unchanged):

| Key | Current | New | Why |
|---|---|---|---|
| `retreatHp` | 0.28 | 0.18 (floor; the live threshold is burst-scaled, 5.1) | a flat 28% dies to burst and flees pokes |
| `diveHp` | 0.88 | removed (dives are gated by `canEngage`) | HP is not what makes a dive safe |
| `kiteBuffer` | 78 | removed; new `kiteStep` 120, `kiteMax` 0.35 | 5.4 |
| `groupAfterMin` | 8 | removed; `group` is a plan (10:00 by default) | 4.6 |
| `jungleRange` | 520 | 0 for laners | laners wandering into camps |
| `campRange` | 640 | 0 for laners | same |
| `lastHitBias` | 340 | removed (wave intent) | 5.6 |
| `objectiveMinAllies` | 1 | `{turtle: 2, lord: 3}` | no two-man Lord |
| `objectiveHp` | 0.46 | 0.55 | arrive healthy |
| `outnumberMargin` | 2.4 | 2 (always on in `microGate`) | 1v3 is never a fight |
| new `engageAllies` | - | 1 | 5.2 |
| new `turretHitsMax` | - | 2 | turret leash |
| new `gankWindow` | - | 15 | gank goal length (s) |
| new `prepWindow` | - | 45 | objective prep (s) |
| new `bushWait` | - | 25 | roamer at the pit bush before spawn (s) |
| `castChance`, `recallSafeDist`, `collapseRange`, `fightPowerRatio`, `reengageHp`, `shopRecallMinGold` | 0.97, 920, 1280, 1.42, 0.72, 720 | unchanged | - |

`headless/runtime.js`:
- `CORE_SCRIPTS`: add `'js/bot-macro.js'` after `'js/bot-params.js'`.
- Bush concealment: move `bushHiddenFrom` (mlbb.js 138-150), the `revealT` decay and `onDamaged` reveal, and `proximityAssists` into `js/combat.js` (already core) behind the same `Mlbb` guard shape, so headless bots hide in bushes like the browser ones. Until that lands, push a line onto `simulator.warnings` when `typeof Mlbb === 'undefined'`.
- `_heroState`: add `role: hero.role`, `goal: {kind, lane, wave, target: this._entityRef(hero.goal.target)}`, `plan: G.brains[hero.team].plan`, `turretHits`, `cs: hero.cs`.
- `BROWSER_STUBS` `UI`: add `botEvent(kind, data) { __recordHeadlessEvent(kind, data); }`; `js/ui.js` gets a no-op `botEvent`. Emit `recall_start` (`Hero.startRecall`), `recall_cancel` (the damage path that zeroes `recallT`), `recall_done` (`Hero.update` when the channel completes), `plan` (`TeamBrain.decide` on change, `{team, plan}`), `goal` (`TeamBrain.assign` on `seq` change, `{hero, kind, lane, wave}`), `epic_start` (`EpicMonster.onDamaged`, first hero hit per spawn), `turret_flee` (`microGate`).

---

## 8. What the headless build must gain before the numbers mean anything

1. `js/bot-macro.js` in `CORE_SCRIPTS` (otherwise `Game.start` throws on `assignLanes`).
2. Bush concealment in core code (section 7). Without it checks 6 and 7 measure bots that are always visible.
3. `cs` counted in `Minion.die`.
4. `headless/metrics.js` (new, no game code): runs N seeds of `createSimulator({seed, intervalMs: 500, blueLineup, redLineup}).run({untilEnd: true, onSnapshot})`, consumes snapshots and events, prints one JSON object per seed plus the aggregate for the ten checks below. Default lineups: two fixed mirrored rosters covering all six archetypes, `zephyr,ignis,grom,nyx,sylva` and `vesper,mira,karn,rook,bell`, both sides identical, seeds 1-10.

---

## 9. Verification: ten measurable checks

Measured by `headless/metrics.js` over seeds 1-10, mirrored lineups, standard mode, until end. "Sample" = one 500 ms snapshot. Baselines are seeds 1, 2 and 3 of today's bot (section 2). Targets are for the median over ten seeds unless stated.

| # | Check | Computation | Baseline (seeds 1 / 2 / 3) | Target |
|---|---|---|---|---|
| 1 | Match length | `finalTimeMs`; share of seeds ending at the cap (`timeMs >= 1,800,000`) | 29.5 / 30.0 / 30.0 min, all at or near the cap | median 12-22 min; <= 1 of 10 at the cap |
| 2 | Kills per minute | `kill` events with `target.type == 'hero'` / minutes, both teams | 3.66 / 4.57 / 4.40 | 1.6-3.0 |
| 3 | Deaths to turrets | share of hero deaths with `source.type == 'tower'`; "solo dives" = turret deaths with no allied minion within 330 of that turret and no allied hero within 600 of the victim at the previous sample | 14% / 7% / 8% | <= 6%; solo dives <= 1 per match |
| 4 | Turtle timing | per Turtle spawn (announcement "has spawned" with Leviathan): seconds until "taken"; first Turtle dead by 3:30 | 82 / 16 / 14 s alive per spawn; every spawn taken | first Turtle dead by 3:30 in >= 8 of 10 seeds; median time-to-kill <= 60 s |
| 5 | Lord timing and conversion | per Lord spawn: seconds alive; share of Lord kills followed by an enemy structure death within 90 s | 114 / 19 / 96 s alive per spawn; conversion not measured | median alive <= 75 s; >= 60% of Lord kills convert |
| 6 | Gold curve per role | `gold.earned` at 10:00 by `role`: gold laner's rank in its team; jungler / gold laner; roamer / gold laner; team max / min | spread 2.2x / 3.4x / 1.9x with random positions | gold laner 1st or 2nd in >= 8 of 10 seeds; jungler 0.85-1.05 of gold laner; roamer 0.55-0.75; max/min 1.3-1.8 |
| 7 | Lane discipline 0:40-5:00 | share of samples with each laner within 600 of its polyline; jungler level >= 4 by 1:45; mid and exp laners with no allied hero within 500 | not measured (lanes by slot) | laners on lane >= 75% of samples; jungler L4 by 1:45 in >= 9 of 10 seeds; mid and exp solo >= 70% of samples |
| 8 | Grouping | closeness = share of allied pairs within 700 (30 s samples): mean before 8:00 vs mean while the plan is `group`/`push`/`end` after 10:00 (`plan` events); isolated deaths = no ally within 900 | 0.10 / 0.10 / 0.10 before 10:00 | <= 0.25 before 8:00; >= 0.45 during `group`/`push`/`end`; isolated deaths <= 30% after 10:00 |
| 9 | Recall discipline and idle time | `recall_cancel` / `recall_start`; share of `recall_start` whose lane wave was `crashed`/`empty`/`pushed`; idle = alive samples with speed < 20, > 350 from the fountain, no CC; share of deaths with `aiState == 'retreat'` | not measured; 81% of deaths while retreating per the code comment | cancelled <= 15%; >= 70% after a crash/empty lane; idle <= 3% of alive samples; deaths while retreating <= 50% |
| 10 | Simulator speed | wall time per seed; per-frame cost = wall / simulated frames | 464 / 492 / 469 s for about 30 min (about 260 us per frame) | <= 90 s for a 20-minute match (<= 75 us per frame) |

Tests to add to `headless/runtime.test.js` (deterministic, short):
- `assigns positions by archetype`: lineup `zephyr,ignis,grom,nyx,sylva` on both sides -> the first snapshot has exactly one hero per position per team, Marksman gold, Mage mid, Assassin jungle, one of Tank/Support roam, the other exp.
- `danger map marks turret rings`: after one tick, `Game.brains[0].danger` at the red mid outer turret (3874, 2531) is >= 8 and at the blue fountain (245, 6136) is 0.
- `objective prep goals`: run to 1:55 with `intervalMs 1000`; at 1:40 at least one blue laner has `goal.wave == 'slow'`, and by 1:55 the blue roamer is within 400 of a Turtle-pit bush and the blue jungler's `goal.holdSpell` is true.

---

## 10. Rollout order

1. `Game.structures()` cache, `navRisk` on the danger map, `TeamBrain` skeleton with memory, waves and danger but no decisions. Re-run check 10; most of the speedup lands here.
2. `assignLanes` + `hero.role`; opening jungle route; wave intents in `microTarget`. Checks 6 and 7.
3. `microGate` burst-scaled retreat, `canEngage`, turret leash. Check 3.
4. Objective clock, prep/contest/skip, roamer bush wait, Retribution hold. Checks 4 and 5.
5. Plans `push`/`group`/`defend`/`end`, rally points, recall rules. Checks 1, 8, 9.
6. Kit hints and kiting. Check 2 and the marksman share of deaths.

Each step is measurable on its own with `headless/metrics.js`; do not merge a step that regresses check 10.
