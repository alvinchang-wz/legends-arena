# Lanes, economy, structures and objectives

Design spec for the 5v5 match loop of Legends Arena, written 2026-09-22 against branch `overnight`. Reference numbers come from `docs/research/mlbb-reference.md` (sections 2-4); their confidence tags [H]/[M]/[L] are carried over. Every rule below is written as **now** (what the code does, with file and function) -> **reference** -> **target** (our units) -> **change** (the exact edit). An implementer should be able to work through it top to bottom without asking questions.

The headless simulator (`node headless/simulate.js --until-end --seed N`) is the acceptance tool. Note that `headless/runtime.js` `CORE_SCRIPTS` loads `data.js, map.js, combat.js, entities.js, objectives.js, items.js` and the simulation half of `main.js` but **not** `js/features.js` or `js/mlbb.js`. Any economy rule that lives in `mlbb.js` today (roam share, proximity assists, first-turret gold, jungler creep bonus) is invisible to the simulator. Rule for this spec: **economy and objective rules move into `data.js` / `entities.js` / `objectives.js` / `main.js`; `mlbb.js` keeps only HUD, chat and callouts.**

---

## 0 Units and conversion rules

| Quantity | Our unit | Conversion from the reference |
|---|---|---|
| Distance | world units (wu). `WORLD = 6400`, `MAP_K = 6400 / 436 = 14.68 wu per map px` (`js/map.js`) | 1 MLBB unit = the distance a 100-MS hero walks in 1 s; our typical hero walks 262 wu/s = 2.62 units/s, so **1 MLBB unit = 100 wu**. (The measured turret ring, 28 px = 410 wu, is kept as is; do not re-derive ranges from units.) |
| Time | seconds of `Game.time` | 1:1. The MLBB event clock is copied unchanged. |
| HP and damage | hero HP 595 at L1 (marksman 540 + `heroHpPad` 55), about 1,600 at L15 before items | MLBB marksman 2,500 -> 5,300. **HP scale 0.3x.** |
| Gold | full 6-slot build = boots 850-950 + 5 x 1,100-1,550 = **7,950-8,400** (`js/items.js ITEM_DEFS`) | MLBB full build about 13,000. **Gold scale 0.6x.** |

Map facts used below (computed from `js/map-data.js` through `MAP_K`):

| Measure | Side lanes (top, bot) | Mid |
|---|---|---|
| Base to base along the polyline | 10,797 wu (735.5 px) | 7,598 wu (517.6 px) |
| Halfway point from either base | 5,399 wu | 3,799 wu |
| Own outer turret from own base | 4,232 (top) / 4,329 (bot) | 2,849 |
| Own middle turret | 2,872 / 2,440 | 1,831 |
| Own inner turret | 1,090 / 1,166 | 995 |
| Inhibitor (`INHIBITOR_FRAC 0.085`) | 918 | 646 |
| Enemy outer turret from own base | 6,478 | 4,749 |

Hero base speed 236-280 wu/s (`HEROES[].speed`, 262 typical): fountain -> mid outer 11 s, fountain -> side outer 16.5 s, fountain -> either pit about 17 s.

Lane identity (verified in `docs/design/bot-ai.md` section 1): the Turtle pit (4,433, 4,533) sits beside the physical `bot` polyline and the Lord pit (1,967, 1,867) beside the physical `top` polyline for both teams, so **`top` is the gold lane and `bot` is the EXP lane for both teams**, exactly as MLBB puts the Lord on the gold-lane side. Red turrets carry mirrored lane labels (`TOWER_SPOTS` red `top` turrets lie on the physical `bot` polyline); anything that picks a lane for structures must use the physical polyline, not `tower.lane`.

### 0.1 Baseline (what the current numbers produce)

Four seeded matches, random lineups, heuristic bots, `--until-end`:

| Measure | Seeds 1-3 (previous run) | Seed 7 (this run) |
|---|---|---|
| Length | 29.5, 30.0 (cap), 30.0 (cap) | 30.0 (cap, decided on crystal HP: blue 100%, red 73%) |
| Hero deaths per minute (both teams) | 3.66 / 4.57 / 4.40 | 3.9 (118 deaths) |
| Level 15 reached | - | every hero between 8:00 and 11:00 |
| Gold at 10:00 | 2,071-7,243 per hero | 2,519-6,921 per hero; team 20,451 vs 18,383 |
| Turrets destroyed | 12-15 | 15 |
| Lord | 4/5, 7/7, 5/5 spawns killed | 6 kills (5 blue, 1 red), incl. 3 evolved |
| Inhibitors | - | red bot + top down at 16:30, both back at 19:00; red top down again 24:30 |

Diagnosis, in order of weight:

1. **Deaths are free.** `BALANCE.respawnTime = 4.2 + 1.15 * level` gives 21.5 s at L15 at any minute (reference: 54.7 s at 20:00). A won fight never buys enough time to walk 5,400 wu and take an inhibitor plus the crystal.
2. **Power plateaus at 10 minutes.** Passive XP 4/s (240/min) plus full minion XP to every hero within 600 puts everyone at L15 by 8-11 min; item slots fill by 12-15 min. From then on both teams are identical and the fight loop repeats.
3. **The Lord's payload dies on arrival.** Two `LordMinion`s (3,200 HP, no damage reduction) walk into five full-build defenders and are deleted in 2-3 s; the Lord kill converts to nothing.
4. **Inhibitors come back** after 150 s (`Inhibitor.die`), and the crystal is targetable at any time, so a breach neither sticks nor is required.
5. **Kill gold is 35% of all gold** (about 118 deaths x 420 average). Laning income is small by comparison, so the economy rewards the fight loop, not the map.

Everything in sections 1-14 is tuned so that a match is decided between 12:00 and 18:00 (section 15) and can be checked in the simulator (section 16).

---

## 1 Wave timing and composition

**Now** (`Game.update`, `js/main.js` about line 1155; `Game.start` line 124 sets `waveT = 3`):
- First wave at **0:03**, then every `BALANCE.waveInterval = 26` s.
- Each wave, per team, per lane: `meleeN = 3 + (time > 300) + (time > 600)`, `rangedN = 2`. So 5 minions per lane until 5:00, 6 until 10:00, 7 after. No siege minion.
- One `SuperMinion` is appended per wave in a lane whose enemy inhibitor is dead.
- Hard cap: no wave spawns while `Game.minions.length >= 180`.

**Reference** (mlbb-reference 2.1): first spawn 0:10 [H]; 30 s interval, all lanes, whole match [H]; side wave = 1 Infantry (melee) + 1 Lancer (ranged) + 1 Cannon (siege) every wave [M]; mid wave = 3 Lancers + 1 Infantry for waves 1-10, then one of each from wave 11 (5:10) [M]; super minions once the enemy Base turret dies [H].

**Target**

| Rule | Value |
|---|---|
| First spawn | 0:10 |
| Interval | 30 s, all lanes, whole match |
| Side lane wave (top, bot) | 1 melee + 1 ranged + 1 siege, every wave from wave 1 |
| Mid wave, waves 1-10 (0:10-4:40) | 1 melee + 3 ranged |
| Mid wave, wave 11+ (5:10 on) | 1 melee + 1 ranged + 1 siege |
| Super minion | 1 per wave per lane while the enemy inhibitor in that lane is dead (unchanged), spawned behind the siege minion |
| Summoned Lord | see section 14; not part of the wave |
| Cap | 180 (unchanged; a full board is 2 teams x 3 lanes x 3-4 = 18-20 per wave, the cap only matters if waves stall) |

**Change**
- `js/data.js BALANCE`: `waveInterval: 26` -> `30`; add `firstWaveAt: 10`, `midCannonFromWave: 11`.
- `js/main.js Game.start`: `this.waveT = 3` -> `this.waveT = BALANCE.firstWaveAt`.
- `js/main.js Game.update` wave block: replace the `meleeN/rangedN/extra` arithmetic with a per-lane composition function `waveComposition(lane, waveN)` returning `['melee','ranged','siege']` for side lanes, `['melee','ranged','ranged','ranged']` for mid when `waveN < midCannonFromWave`, else `['melee','ranged','siege']`. Spawn order = array order so the siege minion walks last (it is created last, and `Minion` constructor scatter `along = 40 + rand(0, 96)` is replaced by `along = 40 + 60 * indexInWave` so the wave is a column, not a cloud).
- 10v10 keeps its own branch (`isTen()`), untouched.

---

## 2 Minion stats and growth over time

**Now** (`Minion` constructor, `js/entities.js` line 2243-2255): scale `s = 1 + mins * 0.045 + max(0, mins - 18) * 0.12` applied to HP and ATK only.

| Kind | HP | ATK | Armor/MR | Range | AS | Radius | Gold | XP | Notes |
|---|---|---|---|---|---|---|---|---|---|
| melee | 330 s | 14 s | 8 | 55 | 1.0 | 16 | 38 | 55 | 2x damage to structures (`attackPacket`) |
| ranged | 230 s | 22 s | 8 | 260 | 1.0 | 16 | 42 | 45 | kites to 62% range; 2x to structures |
| super (`objectives.js SuperMinion`) | 1,800 | 95 | 30 | 90 | 1.0 | 24 | 70 | 85 | 3.4x to structures, speed 195, no time scaling |
| lord minion | 3,200 / 4,400 | 140 / 180 | 40 / 50 | 120 | 1.0 | 30 / 34 | 90 | 110 | 4.5x / 5.2x to structures |

At 10:00 s = 1.45 (melee 479 HP / 20 ATK); at 18:00 s = 1.81; at 30:00 s = 3.79.

**Reference** (2.2): absolute HP/ATK unpublished [M]; siege ATK growth 15 -> 25 per minute, 30 after an enemy Base turret falls, 33 after Lord [M]; gold 33/65/100 at 0:00 growing linearly to about 90/120/150 at 30:00 [M]; super minions have the same gold/EXP as normal minions and do 50% damage to the crystal [H]; move speed +10/min from 12:00 to a +120 cap [M].

**Target** (linear per-minute growth, `mins = Game.time / 60`; gold at 0.6x scale so a side wave is worth 120 at 0:00 vs the reference 198)

| Kind | HP | ATK | Armor = MR | Range | AS | Radius | vs structures | Gold | XP pool |
|---|---|---|---|---|---|---|---|---|---|
| melee (Infantry) | 330 + 14/min | 14 + 0.6/min | 8 + 0.4/min | 55 | 1.0 | 16 | x2 | 40 + 0.7/min | 44 |
| ranged (Lancer) | 230 + 9/min | 22 + 0.9/min | 8 + 0.4/min | 260 | 1.0 | 16 | x2 | 20 + 1.1/min | 30 |
| siege (Cannon) | 620 + 30/min | 32 + 2.0/min (+3.0/min after 12:00) | 14 + 0.5/min | 300 | 0.8 | 22 | x3 | 60 + 1.0/min | 60 |
| super | 1,800 + 60/min | 95 + 3/min | 30 + 0.5/min | 90 | 1.0 | 24 | x3.4 | 60 | 60 |
| Lord minion | section 14 | | | | | | | | |

Growth after 18:00 (the old `+0.12/min` kicker) is removed: matches must not depend on it. All minions deal **50% damage to the crystal** (section 10); super and Lord minions deal 100%.

Sanity check against turret damage (section 9): an outer turret (190/s) kills a fresh side wave in 6 s at 0:00 and in 10 s at 15:00 (540 + 365 + 1,070 HP). A wave alone never kills an early turret; two stacked waves plus a cannon at 15:00 take about 900 HP off an outer before dying. That is the intended shape: minions are pressure, heroes and the Lord are the siege.

**Change**
- `js/entities.js Minion` constructor: replace the `s` multiplier and the two-branch stat block with a `MINION_STATS` table in `js/data.js` keyed by kind (`melee`, `ranged`, `siege`, `super`) with fields `{hp, hpPerMin, atk, atkPerMin, atkPerMinLate, armor, armorPerMin, range, atkSpd, radius, structMult, gold, goldPerMin, xp}`; the constructor evaluates `base + perMin * mins`. `kind === 'siege'` sets `this.ranged = true` and `this.siege = true`.
- `Minion.attackPacket`: `target.isStructure ? structMult : 1` from the table (today hard-coded 2).
- `objectives.js SuperMinion`: read the `super` row instead of its own constants; keep the class.
- `combat.js resolveDamage`: after the structure block, `if (target.isBase && src.type === 'minion' && src.kind !== 'super' && src.kind !== 'lord') amount *= 0.5`.

---

## 3 Minion movement speed

**Now**: `A.speed = 180` wu/s for every minion kind (`Minion` constructor); super 195; Lord minion 200/210. No change over time. With the first wave at 0:03 the side waves meet at about 0:33 and mid at about 0:24.

**Reference**: minion speed is "base +15% (Classic)" and gains +10/min from 12:00 to a +120 cap [M]; the reference doc puts the first mid clash at 0:15-0:25 and side clash at 0:25-0:35 after a 0:10 spawn [H], i.e. 5-25 s of walking. The brief for this spec says the reference waves meet about 40 s after spawning. The two disagree; we derive from lane length and pick the clash time we want on the clock.

**Derivation**: a side wave must walk 5,399 wu to the halfway point, a mid wave 3,799 wu.

| Candidate | Side clash | Mid clash | Speed | Verdict |
|---|---|---|---|---|
| Reference doc (side 20 s after spawn) | 0:30 | 0:24 | 270 wu/s (hero speed) | waves outrun laners walking to lane; LoL feel |
| Brief (40 s after spawn) | 0:50 | 0:38 | 135 wu/s | 0.52x hero speed; a wave needs 48 s to reach the enemy outer turret in mid, 80 s on a side lane; lanes feel dead |
| **Chosen: 30 s after spawn** | **0:40** | **0:31** | **180 wu/s** | 0.69x hero speed; the same number the code has, now justified; a hero leaving fountain at 0:10 reaches the side halfway point at 0:31 and watches the wave arrive |

**Target**
- Base minion speed **180 wu/s** for melee, ranged and siege; super 195; Lord minion 210 (evolved 220).
- Late speed-up: from **10:00**, +10 wu/s per minute, cap +80 (260 wu/s at 18:00, about hero base speed). Applied in the constructor from `Game.time` at spawn (a wave keeps its speed), not per frame.
- Derived timings the simulator must show: first side clash 0:38-0:42, first mid clash 0:29-0:33; an unopposed wave reaches the enemy outer turret 36 s (side) / 26 s (mid) after spawning.

**Change**
- `js/data.js BALANCE`: add `minionSpeed: 180, minionSpeedUpFrom: 600, minionSpeedUpPerMin: 10, minionSpeedUpCap: 80`.
- `js/entities.js Minion` constructor: `A.speed = BALANCE.minionSpeed + clamp((mins - 10) * 10, 0, 80)` (super/Lord override after calling super, as today).

---

## 4 Minion aggro and targeting

**Now** (`Minion.pickMinionTarget`, `js/entities.js` line 2282; `Minion.update` line 2354; `Hero.pullMinionAggro` line 647):
- Retarget every 0.4 s; candidates within 340 wu (edge distance). Score = distance, minus `(1 - hpPct) * 90` for minions, minus 70 for same-lane minions; structures +170 if an enemy minion is within 340 (else +55, or -50 for siege/super/lord); heroes +250 when an enemy minion is nearby (else +95; siege/super/lord +35). Heroes further than 240 wu (640 for siege kinds) from the lane polyline are ignored.
- Current target dropped when dead or beyond 480 wu; a hero chase is dropped when the minion is more than 400 wu off the lane and the aggro hold has 0.45 s left.
- `Hero.onDamaged` -> `pullMinionAggro(attacker)`: enemy minions within 420 of the victim and 520 of the attacker switch to the attacker for 2.5 s.
- Ranged minions back off to 62% of range when a target is closer than that.

**Reference** (2.7, 6.5): MLBB minions prioritise the nearest enemy minion, then structures, then heroes, and switch to a hero that attacks an allied hero nearby; exact radii unpublished [L].

**Target**: the current rules are the right shape and are kept. Three concrete fixes:

| Rule | Now | Target |
|---|---|---|
| Aggro pull radius | victim 420 / attacker 520 | victim 500 / attacker 600 (a full ranged-hero trade at 340-385 range must pull aggro) |
| Aggro hold | 2.5 s | 3.0 s |
| Siege minion targeting | n/a | `siege` uses the siege/super scores (structures -50, heroes +35, leash 640) and never kites |
| Super/Lord minion | share the melee scores except as above | unchanged |

**Change**
- `Hero.pullMinionAggro`: `420 -> 500`, `520 -> 600`, `retargetT = 2.5 -> 3.0`.
- `Minion.pickMinionTarget`: `const siege = this.kind === 'super' || this.kind === 'lord'` -> add `|| this.kind === 'siege'`.
- `Minion.update`: the kite branch (`this.ranged && this.distTo(t) < this.range * 0.62`) gets `&& !this.siege`.

---

## 5 Minion gold: last hit, proximity share, XP

**Now**
- `Minion.die` (`js/entities.js` line 2395): 100% of `goldValue` to the killing hero only (last hit); nothing if a minion or turret kills it. XP: every enemy hero within 600 gets the full `xpValue` (no split).
- `Mlbb.onMinionKill` (`js/mlbb.js`): allies whose `lane === 'roam'` within 820 get an extra 22% (not in the simulator).
- `Game.canLastHit` / `acquireTarget` (`js/main.js` 1048, 1065): the player's auto-target prefers a minion whose HP <= one basic attack.

**Reference** (2.3, 2.4): gold is proximity-shared to nearby enemy heroes, no last hit needed (radius undocumented, likely about 8 units = 800 wu); if a non-hero lands the kill, nearby heroes get 80% [M]. EXP shared among nearby allies [L]. Jungler with Retribution: minion gold/EXP heavily reduced until 5:00 and no sharing [M]. Roamer: no minion rewards for the first 8 min while an ally is near [M]. Design rule: "add a small last-hit bonus only to create a skill ceiling".

**Target**

| Rule | Value |
|---|---|
| Share radius | 600 wu from the dying minion (hero vision is 900, turret reach 510; 600 is "in the lane") |
| Hero last hit | gold pool split equally among enemy heroes within 600 (killer included); the killer then gets a **+20% last-hit bonus** of the pool on top |
| Non-hero kill (turret, minion, Lord minion) | 80% of the pool split equally among enemy heroes within 600; nothing if none |
| XP | XP pool split equally among enemy heroes within 600; no bonus for the killer |
| Jungler (hero whose `spell.id === 'retribution'`) before 5:00 | takes 50% of its minion gold/XP share and is **not counted** in the split for others (so the laner keeps a full share) |
| Roamer (hero holding a `Roam`-category item) before 8:00 | takes no minion gold/XP while an allied hero is within 600 of the minion, and is not counted in the split; after 8:00 shares normally. Replaces the 22% roam bonus. |

Worked numbers: a solo gold laner at 10:00 takes a side wave worth (47 + 31 + 70) x 1.2 = 178 gold every 30 s = 356/min if it last-hits everything, 296/min if the turret kills them all. With passive 108/min (section 6) the laner is on 400-460/min, which is the 0.6x-scaled reference carry income of 650-750/min.

**Change**
- `js/entities.js Minion.die`: replace the `src instanceof Hero` branch and the XP loop with one pass: collect `sharers = Game.heroes.filter(h => h.team !== this.team && h.alive && dist(h, this) < BALANCE.minionShareRadius && !excluded(h))` where `excluded` implements the jungler and roamer rows; `pool = this.goldValue * (src instanceof Hero ? 1 : 0.8)`; each sharer gains `pool / sharers.length` (times 0.5 for the jungler before 5:00); if `src` is a sharer add `this.goldValue * BALANCE.lastHitBonus`; XP identically with `this.xpValue`. Apply the lane bonus of section 8 to the pool before splitting.
- `js/data.js BALANCE`: add `minionShareRadius: 600, lastHitBonus: 0.20, nonHeroKillShare: 0.80, junglerMinionPenaltyUntil: 300, junglerMinionShare: 0.5, roamNoFarmUntil: 480`.
- `js/mlbb.js Mlbb.onMinionKill`: delete the gold part (keep the floater).

---

## 6 Passive gold and XP

**Now**: `Hero.update` (`js/entities.js` 794): `passiveGoldPerSec 1.8` + `Game.comebackGoldRate(team)` (0 to 1.35/s once the team is 1,200-5,200 gold behind), ticking through death. `passiveXpPerSec 4` while alive (line 840). Starting gold 0.

**Reference**: 6 gold per 2 s = 3/s = 180/min [M]; comeback bounty only when the deficit exceeds 2,000 [M]; passive EXP is implied by the roamer rule (25 EXP per 4 s to a teammate) but not published [L].

**Target**
- Passive gold **1.8/s (108/min), unchanged.** At our 0.6x gold scale the reference 180/min is 108/min; the current value is already right. Keep the through-death rule.
- Comeback income: unchanged (`comebackStartGold 1200` is the 0.6x-scaled 2,000 gate).
- Passive XP **4/s -> 2/s (120/min)**. Total XP to L15 is 7,035 (`xpNeed = 80 + 65 (l-1)`, summed over 14 levels); 2/s alone is 31% of that over 18 minutes instead of 61% today. Combined with the XP split of section 5 a solo laner earns about 388 XP/min: L4 at about 1:35, L7 at 5:00, L10-11 at 10:00, L15 at about 18:00. Today every hero is L15 by 8-11 min.
- Starting gold 0, unchanged (the reference value is unpublished; the first wave clash at 0:40 plus 108/min buys a component at about 2:00).

**Change**: `js/data.js BALANCE.passiveXpPerSec: 4 -> 2`. Nothing else.

---

## 7 Kill, assist and shutdown gold

**Now** (`Hero.die`, `js/entities.js` 548-606; `BALANCE`):
- Killer: `heroKillGold = 145 + 11 * victimLevel` (L5 200, L15 310) x `repeatMult = max(0.50, 1 - 0.14 * victim.deathStreak)` + `shutdownGold = min(280, 56 * max(0, victimStreak - 2))`.
- Assist pool `110` split equally among heroes that damaged the victim in the last 8 s plus (via `Mlbb.proximityAssists`, not in the simulator) every ally within 720; roamers get 1.35x their share.
- Kill XP `95 + 24 * level` to every enemy hero within 700 (each gets the full amount).
- First blood: announcement only, no gold.

**Reference** (2.3): fresh kill about 200; each repeat death lowers the victim's value by 20 (floor 50); streak bounty pays only the ender, max bonus 300 per match; assist 60% of the kill reward; "executed" (no hero credit) pays nothing [M].

**Target** (0.6x gold scale; kills should be 15-20% of team gold, not 35%)

| Reward | Value |
|---|---|
| Kill base | `100 + 4 * victimLevel` (L5 120, L10 140, L15 160) |
| Repeat-death decay | -12% of base per consecutive death of the victim, floor 30% (L15 victim on a 5-death streak: 64) |
| Streak bounty (shutdown) | victim streak 3 -> +40, +40 per further kill, cap +180; paid to the killer only |
| Assist pool | 60% of the kill base (not of the total), split equally among assisters; assisters = heroes that damaged the victim in the last 8 s, plus heroes within 720 of the victim (proximity assists move from `mlbb.js` into `Hero.die`); no roam multiplier |
| Kill XP | `70 + 15 * victimLevel`, split equally among the killer and assisters (not everyone within 700) |
| Executed (killed by turret/minion with no hero damage in 8 s) | 0 gold, XP to enemy heroes within 700 only |

**Change**
- `js/data.js BALANCE`: `heroKillGold: v => 100 + 4 * v.level`; `heroKillXp: v => 70 + 15 * v.level`; `repeatDeathPenalty: 0.12`; `repeatDeathFloor: 0.30`; `shutdownGold: s => Math.min(180, Math.max(0, s - 2) * 40)`; replace `assistGoldPool: 110` with `assistShare: 0.60`.
- `js/entities.js Hero.die`: `assistShare = assisters.length ? BALANCE.heroKillGold(this) * BALANCE.assistShare / assisters.length : 0`; inline the proximity-assist loop (720 wu) so it runs headless; drop the `Mlbb.assistGold` call; change the XP loop to `[killer, ...assisters]` each gaining `xp / (1 + assisters.length)`.

---

## 8 Gold-lane and EXP-lane bonuses

**Now** (`Minion.die`; `BALANCE.laneBonusEnd 300, goldLaneMult 1.25, expLaneMult 1.25`): for the first 300 s every minion in `top` pays x1.25 gold and every minion in `bot` pays x1.25 XP.

**Reference** (2.1): +30% gold on the **cannon only** in the side lane far from the first Turtle; +35% EXP on the cannon only in the lane next to the first Turtle; first 10 waves [M].

**Target**
- Gold lane = `top` (both teams), bonus **+30% gold on the siege minion only**, waves 1-10 (spawned before 5:10).
- EXP lane = `bot`, bonus **+35% XP on the siege minion only**, waves 1-10.
- Worth: 10 waves x 60 x 0.3 = 180 gold to the gold laner; 10 x 60 x 0.35 = 210 XP to the EXP laner (a level ahead by 5:00, as intended).

**Change**
- `js/data.js BALANCE`: `laneBonusEnd: 300 -> 310`; `goldLaneMult: 1.25 -> 1.30`; `expLaneMult: 1.25 -> 1.35`.
- `Minion` constructor: store `this.waveN = Game.waveN`; `Minion.die`: the multipliers apply only when `this.kind === 'siege' && this.waveN <= 10`.
- Rename the `laningEnded` announcement text in `Game.update` to match (shield down, cannon bonuses ended).

---

## 9 Turrets

**Now** (`Tower`, `js/entities.js` 2413-2520; tier HP in `Game.start`, `js/main.js` 133-146; hero-vs-structure multipliers in `js/combat.js` 157-161):

| Tier (`frac`) | HP | Armor/MR | ATK (true) | Attacks/s | Range + radius | Plates |
|---|---|---|---|---|---|---|
| outer 0.40 | 3,600 | 45 | 190 | 0.8 (one shot per 1.25 s) | 410 + 100 | 3 (80 gold each, split among heroes within 760, until 5:00) |
| middle 0.27 | 4,100 | 45 | 190 | 0.8 | 510 | 0 |
| inner 0.13 | 4,800 | 45 | 190 | 0.8 | 510 | 0 |

- Damage vs heroes: `190 x 1.22 x (1 + 0.18 x min(4, consecutiveHits))` = 232, 273, 315, 357, 399 (cap from the 5th hit). The ramp resets when the target changes; it does **not** reset on time.
- Targeting (`Tower.update`): an enemy hero within range + 70 that damaged an allied hero (within range + 70) in the last 2.8 s beats everything; else nearest enemy minion; else nearest enemy hero. Target dropped beyond range + radius + target radius + 30.
- Hero damage to a structure is x0.4 while a tower with a larger `frac` in the same lane and team is alive (`shieldedByOuter`), and x0.25 with no allied minion within 340 (`COMBAT.BACKDOOR_MULT`). Both stack (x0.10).
- No ATK growth. No regeneration. Destruction: `towerGold 85` per hero of the killing team (x up to 1.7 with comeback), plus a 60-gold team bonus for the first turret from `Mlbb.onTurretKill` (not in the simulator). Structures never target jungle creeps (they are neutral, not in `enemyUnits`).

**Reference** (3.2-3.4): outer 4,500 / inner 5,500 / base turret 6,900 HP; ATK 320 -> 404, 360 -> 459, 520 -> 641 (+3.8/min); DEF 20/20/40 [M]; 1 attack/s true damage, ramp +75% of the first hit per consecutive hit to a 20-hit cap, ramp resets after 2 s without the turret damaging that hero, first hit -10% [H]; locks the first enemy in range, switches to a hero that damages an allied hero in range, never switches because of damage to itself [H]; 50% damage taken with no enemy minion in range [H]; turrets behind are invincible until the one in front falls [H]; outer energy shield 0:00-5:00 absorbing 5,000, 30% DR, 1 gold per 10 shield damage (max 360 per lane), minions deal a fixed 75 to it, allied heroes near it take 15% less [H]; Orange Alert: inner gets 50% DR for 60 s if its outer dies before 8:00 [H]; turret gold 60-100 / 80-120 / 100-160 team-wide [M].

**Target**

| Tier | HP | Armor = MR | ATK (true) | Attacks/s | Range | Destruction gold, per hero of the taking team |
|---|---|---|---|---|---|---|
| outer | 3,000 | 20 | 190 + 2.3/min | 1.0 | 410 (unchanged) | 50 |
| middle | 3,400 | 20 | 215 + 2.5/min | 1.0 | 410 | 65 |
| inner | 3,800 | 40 | 300 + 3.0/min | 1.0 | 410 | 80 |
| first turret of the match | | | | | | +30 per hero, applied in `Tower.die` (moved out of `mlbb.js`) |

Effective HP (armor through `DEF_K 95`): outer 3,630 (today 5,300), middle 4,120 (6,040), inner 5,400 (7,070). A full-build marksman (about 350 physical DPS after armor) kills an outer in 9 s with minion cover; five heroes in 2-3 s. Turret ATK growth is +26% over 20 minutes while hero HP grows 2.7x from L1 to L15 plus items: turrets are lethal until about 8:00 and porous from 12:00, which is the reference shape.

Damage rules:

| Rule | Value |
|---|---|
| Hero ramp | hit n on the same hero = `ATK x (1 + 0.35 x min(8, n-1))`; outer at 0:00: 190, 257, 323, 390, 456, 523, 589, 656, 722 (cap). An L1 hero (595 HP) dies on the 3rd hit, 2 s after the first; an L15 hero with 1,900 HP on the 5th-6th; a 3,000-HP tank on the 8th. |
| Ramp reset | 2.0 s after the turret last damaged that hero (`focusT` timestamp), not on target change alone |
| Retarget | unchanged rule set (defend an allied hero within 2.8 s, else nearest minion, else nearest hero); add: a Lord minion counts as a hero for the "nearest minion" pass so it is shot **first** among non-heroes |
| No minion in range | hero damage to the structure x0.5 (was 0.25). Cover radius 340 -> 410 (= turret range) |
| Turret behind a live one | **immune** (was x0.4). `shieldedByOuter` -> `resolveDamage` returns 0; bots must skip structures with `shieldedByOuter` in `botTargetSafe` (one-line check, otherwise they waste time) |
| Orange Alert | if an outer dies before 8:00, the middle turret in that lane takes 50% damage for 60 s (`t.alertT = 60`, checked in `resolveDamage`) |
| Regeneration | none |

Plating phase -> **energy shield** (replaces `plates` and `towerPlateGold`; keep the plate arcs renderer but drive it from shield fraction):

| Rule | Value |
|---|---|
| Which turrets | the six outers |
| Shield | 1,800 absorb pool, 0:00-5:00; damage hits the shield before HP |
| Turret DR while shielded | 30% on whatever leaks past the shield (so an outer cannot fall before 5:00 without an all-in) |
| Minion damage to the shield | fixed 25 per hit (siege 50) |
| Gold | 1 gold per 10 shield damage to the hero that dealt it, cap 180 per outer (the plate track paid at most 240 for 25% of the turret; this pays 180 for chipping) |
| Allied heroes within 410 of a shielded outer | take 15% less damage from heroes |
| Expiry | 5:00, remaining shield vanishes, announcement (existing `laningEnded` flag) |

**Change**
- `js/main.js Game.start`: `tierHp = frac >= 0.39 ? 3000 : frac >= 0.26 ? 3400 : 3800`; `t.attrs.base.armor = t.attrs.base.mr = frac >= 0.26 ? 20 : 40`; `t.attrs.base.physAtk = frac >= 0.39 ? 190 : frac >= 0.26 ? 215 : 300`; `t.atkPerMin` = 2.3 / 2.5 / 3.0; `t.shield = frac >= 0.39 ? 1800 : 0`; `t.shieldGold = 0`; delete `plates/plateMaxHp`.
- `js/entities.js Tower` constructor: `A.atkSpd = 0.8 -> 1.0`; `curAtk()` override returning `physAtk + atkPerMin * mins`.
- `Tower.attackPacket`: `amount = atk x (1 + 0.35 * min(8, focusHits))` for heroes (drop the 1.22), `focusHits++`, `focusT = Game.time`; in `update`, `if (Game.time - focusT > 2) focusHits = 0`.
- `Tower.onDamaged`: replace the plate loop with the shield: `if (this.shield > 0 && Game.time < BALANCE.laneBonusEnd) { absorbed = min(this.shield, dmg); this.shield -= absorbed; this.hp += absorbed (undo); if (src is enemy hero) { pay = min(absorbed / 10, 180 - this.shieldGold); this.shieldGold += pay; src.gainGold(pay); } }` with the 30% DR and the fixed minion 25/50 applied in `resolveDamage` before the call.
- `js/combat.js resolveDamage`: `if (target.shieldedByOuter) return 0;` `BACKDOOR_MULT: 0.25 -> 0.5`; cover radius `340 -> 410`; add the Orange Alert and shielded-ally checks.
- `Tower.die`: per-tier gold from `BALANCE.towerGold = {outer: 50, middle: 65, inner: 80}`; first-turret +30 per hero (move from `Mlbb.onTurretKill`, keep the banner call); if `Game.time < 480` set `alertT = 60` on the same-lane turret with the next lower `frac`.

---

## 10 Base crystal, inhibitors and super minions

**Now**
- Crystal = `Tower(isBase = true)`: 5,600 HP, armor 45, ATK 280 true, 0.8/s, range 470 + radius 150, same hero ramp as turrets; **targetable from minute 0** (only the backdoor multiplier applies); its death ends the game (`Tower.die` -> `Game.endGame`). No regeneration. Fountain (367 wu behind the crystal) zaps enemies within 300 for 350/s and heals allies 10%/s.
- `Inhibitor` (`js/objectives.js`): 2,200 HP, armor 25, does not attack, at 8.5% of the lane (918 wu side / 646 mid, 80-250 wu behind the inner turret and inside its range); **respawns after 150 s**; gold `inhibitorGold 95` per hero. While it is dead one `SuperMinion` joins every wave in that lane.
- 30:00 cap (`Game.update`, `js/main.js` 1128): winner = higher crystal HP fraction, then kills.

**Reference** (3.1-3.4): the Base turret is the inhibitor (6,900 HP, 520 ATK); it never returns; any Base turret falling exposes the 7,900-HP crystal (DEF 40/40, ATK 539, self-repairs 165 per 5 s, minions do 50%) and releases super minions in that lane forever [H]; the base turret deals heavy damage to the first minion wave in range during the first 12 min [H].

**Target**

| Structure | HP | Armor = MR | ATK (true, 1/s, hero ramp as section 9) | Rules |
|---|---|---|---|---|
| Inhibitor | 1,800 | 25 | none (unchanged) | **does not respawn**; immune while the inner turret of its lane stands (extend `shieldedByOuter` to inhibitors); gold 80 per hero |
| Crystal | 4,800 | 40 | 300 + 1.2/min | **immune while all three inhibitors stand**; takes 50% from normal minions, 100% from super and Lord minions; no regeneration (the reference 165 per 5 s is a later tuning knob, listed in section 15) |
| Super minion | section 2 | | | spawns forever once the inhibitor is dead |
| Time cap | 30:00 unchanged as a safety; from **20:00** the crystal and inhibitors take +25% damage from everything and Lord respawn drops to 120 s |

**Change**
- `js/main.js Game.start` bases: `t.maxHp = t.hp = 4800`, armor/MR 40, `physAtk 300`, `atkPerMin 1.2`.
- `js/objectives.js Inhibitor`: `maxHp 1800`; `die`: remove `this.respawnT = 150` (set `Infinity`) and the restore branch in `update`; gold via `BALANCE.inhibitorGold: 80`.
- `js/main.js` shield loop (line 1210): also set `inh.shieldedByOuter = innerTurretAlive(lane, team)` and `base.shieldedByOuter = inhibitors.every(alive)`.
- `js/combat.js`: `if (target.isBase && Game.time >= 1200) amount *= 1.25` and the same for inhibitors.

---

## 11 Recall and respawn

**Now**: recall `BALANCE.recallTime 6` s channel (`Hero.startRecall`, cancelled by damage or movement, not allowed within 350 of the fountain); respawn `4.2 + 1.15 * level` (L1 5.4 s, L8 13.4 s, L15 21.5 s, independent of the clock); 2.5 s spawn protection (`features.js onRespawn`, not headless).

**Reference** (2.5): recall 3.5-8 s [L]; respawn `3.2 + 2.1 x level + match minutes` since 1.4.86 (L1 at 1:00 = 6.3 s, L8 at 8:00 = 28 s, L15 at 20:00 = 54.7 s), "greatly increased" at 18:00, late deaths should cost 55-65 s [M].

**Target**
- Recall **6 s, unchanged** (the reference is unverified and our lanes are 20 s long; 6 s is 23% of a side-lane return trip, the same proportion as 4 s in MLBB).
- Respawn `t = 3.2 + 2.1 x level + minutes`, x1.25 after 18:00, hard cap 75 s. Values: L4 at 2:00 = 13.6 s; L8 at 8:00 = 28 s; L12 at 12:00 = 40.4 s; L15 at 15:00 = 49.7 s; L15 at 18:00 = 66.5 s; cap from about 21:00. This is the single largest lever on match length (section 15).
- Spawn protection 2.5 s: move `spawnProtT` from `features.js` into `Hero.respawn` so the simulator has it.

**Change**
- `js/data.js BALANCE.respawnTime: (l) => 4.2 + 1.15 * l` -> `(l, t) => Math.min(75, (3.2 + 2.1 * l + t / 60) * (t >= 1080 ? 1.25 : 1))`; `Hero.die`: `BALANCE.respawnTime(this.level, Game.time)`.
- `Hero.respawn`: `this.spawnProtT = 2.5` (and `combat.js` already reads `Features.blockDamage`; replace with `target.spawnProtT > 0`).

---

## 12 Jungle camps, buffs and Retribution

**Now** (`CAMP_STATS`, `JUNGLE_BUFFS` in `js/objectives.js`; `Monster` in `js/entities.js` 2522; `Mlbb.monsterGold/monsterXp`; Retribution in `js/items.js` 328):

| Camp (per side) | HP | ATK | Armor = MR | Gold | XP | Respawn | First spawn |
|---|---|---|---|---|---|---|---|
| purple (`blueBuff`) | 1,250 | 62 | 24 | 120 | 150 | 70 s | 0:00 |
| orange (`redBuff`) | 1,250 | 62 | 24 | 120 | 150 | 70 s | 0:00 |
| lizard, beetle, golem (`normal`) | 820 | 46 | 16 | 72 | 95 | 42 s | 0:00 |
| crab | 540 | 34 | 12 | 88 | 70 | 48 s | 0:00 |
| lithowanderer (`litho`) | 680 | 38 | 14 | 96 | 85 | 55 s | 0:00 |

- No growth over time. All attack 0.9/s, speed 215, range 70; leash 520 from home (heal 40%/s while returning), target heroes within 620 of home.
- Jungler (`lane === 'jungle'`, not spell-based) gets x1.18 gold / x1.12 XP from camps (`mlbb.js`, not headless). Rewards go to the killer only.
- Buffs (`applyBuffRune`, dropped on death): Sage Rune 70 s (+12% CDR, +14 mana/s); Fury Rune 70 s (+18 ATK, +22 MP, +20% tenacity); River Current 22 s (+45 speed, +10 mana/s). Crab has no buff.
- Retribution: 500 true damage to the nearest monster within 420 (800 to Turtle/Lord), CD 35 s; evolves (ice/flame/bloody) at 5:00 or 8 camp kills; bots always give it to the jungle slot.

**Reference** (4.1, 4.3-4.5): buffs spawn 0:20-0:25, respawn 90 s; small camps 0:25-0:40, respawn 70 s; litho 0:35, respawn 120 s; crab 0:42, respawn 20 s (little) / 120 s (full) [M]; creeps scale linearly (HP mostly, ATK slightly); a full 5-camp clear = exactly L4 at 1:20-1:45 [H]; buffs 75 s [H]; Retribution 750 + 150/level true damage, CD 35 s, +60% creep rewards, -40% creep damage, minion penalty until 5:00 [H/M]; creep gold: buffs about 120, camps 50-70, crab about 90, incl. Retribution [M].

**Target** (gold at 0.6x; XP tuned so purple + orange + three small camps = L4 and not L5)

| Camp | HP | ATK | Armor = MR | Gold | XP | Respawn | First spawn |
|---|---|---|---|---|---|---|---|
| purple, orange | 1,250 + 50/min | 62 + 1/min | 24 + 0.5/min | 80 + 1/min | 90 | 90 s | 0:20 |
| lizard, beetle, golem | 820 + 33/min | 46 + 0.7/min | 16 + 0.5/min | 50 + 0.5/min | 55 | 70 s | 0:30 |
| crab | 540 + 40/min | 34 + 0.5/min | 12 + 0.5/min | 40 | 40 + Gold Buff | 60 s | 0:42 |
| lithowanderer | 680 + 40/min | 38 + 0.5/min | 14 | 50 | 60 | 90 s | 0:35 |

- Jungler = any hero whose `spell.id === 'retribution'` (not `lane`): creep gold and XP **x1.4**; creep damage taken x0.6; minion share 50% before 5:00 (section 5). Full clear check (purple + orange + three small camps, done by about 1:45): (90 x 2 + 55 x 3) x 1.4 = 483 XP + passive 2/s x 100 s = 200 -> 683 XP, which is L4 (435 <= 683 < 710) and not L5, matching the reference "five creeps = exactly L4". (Buff XP 100 / small 60 would give 732 and tip into L5; do not round up.)
- Buffs: duration **75 s** (so a buff always outlives the 90 s respawn by the walk time). Sage Rune unchanged. Fury Rune: keep the flat stats and add on-hit vs heroes: 30% slow for 1 s, 3 s internal cooldown (`h.marks.fury`), the reference's "slow-heavy for melee" without a role table. River Current unchanged. Crab: Gold Buff, +2 gold/s for 18 s (36 gold) to the killer, replacing the flat 88.
- Retribution: `500 -> 400 + 40 x level` (L4 560, L10 800, L15 1,000) to camps and epics alike (the 800 flat epic value goes away; at L15 it is 1,000 vs a 12,000-HP Lord = 8%, the reference ratio). CD 35 s, range 420 unchanged. Secure rule for bots: cast when `epic.hp <= 400 + 40 x level`.
- Creep leash and "punish ganks" rules unchanged.

**Change**
- `js/objectives.js CAMP_STATS`: add `hpPerMin, atkPerMin, armorPerMin, goldPerMin, firstSpawn` columns with the values above; `BuffMonster` constructor multiplies by `Game.time / 60`; `Game.start`: `c.respawnT = spec.firstSpawn` instead of pushing every monster at 0:00.
- `JUNGLE_BUFFS.blueBuff/redBuff.dur: 70 -> 75`; Fury on-hit in `Hero.onBasicLanded` guarded by `this.runes.redBuff > 0`.
- `Monster.die`: replace the `Mlbb.monsterGold/Xp` calls with `src.spell && src.spell.id === 'retribution' ? 1.4 : 1`; crab kill -> `src.addTimedBuff('goldBuff', 2, 18)` and `Hero.update` pays `buffs.goldBuff.value * dt`.
- `js/items.js` Retribution `cast`: `amount = 400 + 40 * h.level`; `Mlbb.retriDamage` returns the same.
- `combat.js`: creep damage to a Retribution holder x0.6.

---

## 13 Turtle

**Now** (`EpicMonster('turtle')`, `js/objectives.js`; clocks in `js/main.js` 309: `TURTLE_AT 120, TURTLE_RESPAWN 120`; retired at `LORD_AT 480`): 3,400 HP flat, ATK 120 physical at 0.7/s, armor 18, speed 170, range 100, leash 620 from the pit (heals 16%/s while returning), retargets to the nearest hero within 700 of the pit. Reward on death to the killing team: 100 gold per hero (x comeback up to 1.7), 180 XP each, Tidewave 60 s (+12 ATK, +15 MP, +12 HP/s). Rewards go to the team of the hero that dealt the killing blow (a minion or creep kill pays nothing and reschedules).

**Reference** (4.6): 2:00, respawn 120 s, none after 6:00, turns into Lord at 8:00; HP 10,367 + 1,067/min, ATK 260 + 22/min, DEF 15 + 10/min; team reward 60/70/80 gold each for the 1st/2nd/3rd, large scaling EXP, shield 200 + 20/level for 120 s; killer gets a bigger shield and ATK/MP [H].

**Target**

| Piece | Value |
|---|---|
| Clock | spawns 2:00; respawns 120 s after death; **no respawn scheduled if it died at or after 6:00**; any live Turtle is removed at 8:00 (existing rule) -> at most 3 per match (2:00, about 4:30, about 7:00) |
| HP | 2,800 + 300/min (2:00 = 3,400, 4:30 = 4,150, 7:00 = 4,900); a 5-hero team at 2:00 (about 500 DPS combined after armor) takes it in 7 s, a solo jungler in 40+ s |
| ATK | 120 + 8/min, physical, 1/s (AS 0.7 -> 1.0) |
| Armor = MR | 18 + 3/min |
| Team reward | 45 / 55 / 65 gold **per hero** for the 1st / 2nd / 3rd Turtle (x comeback), XP 120 + 20 x minute per hero, shield 120 + 12 x level for 120 s (new: `addShield`), Tidewave buff removed (its stats fold into the shield) |
| Killer reward | shield 240 + 24 x level instead of the team value |
| Credit | team of the last-hitting hero, unchanged; a Retribution-secured steal therefore works |

**Change**
- `js/main.js`: add `TURTLE_LAST_SPAWN_BEFORE: 360`; `scheduleEpic('turtle')`: `if (kind === 'turtle' && this.time >= 360) { e.next = Infinity; return; }`.
- `js/objectives.js EpicMonster`: constructor reads `Game.time` for HP/ATK/armor; `A.atkSpd 0.7 -> 1.0`; `this.turtleN = Game.epics.turtle.n++` (5v5 too); `die`: gold `[45, 55, 65][min(2, turtleN)]`, XP `120 + 20 * mins`, shields as above; delete the `applyBuffRune('turtle')` call (keep `JUNGLE_BUFFS.turtle` for the HUD or remove both).

---

## 14 Lord

**Now** (`EpicMonster('lord')`, `LordMinion`, `Game.spawnLordMinion` in `js/main.js` 937; `LORD_AT 480, LORD_RESPAWN 180`; `BALANCE.ancientLordAt 900`):
- 6,200 HP flat, ATK 220 physical at 0.7/s, armor 30, range 130; evolves at 15:00 (`evolve()`): 9,000 HP, ATK 280, armor 42.
- Kill reward to the killing team: 170 gold per hero (220 evolved, x comeback), 300 / 420 XP, Crown's Sight 90 s (+22 ATK, +28 MP, +350 HP), and `spawnLordMinion`: **two** `LordMinion`s in the enemy lane with the fewest live turrets (counted by `tower.lane`, which is mirrored for red, see section 0), spawned at 45% of the lane; evolved: **one** empowered `LordMinion` per lane.
- `LordMinion`: 3,200 HP / 140 ATK / armor 40 / speed 200 / x4.5 to structures (empowered 4,400 / 180 / 50 / 210 / x5.2); targets like a siege minion; gold 90 / XP 110 to whoever kills it; no damage reduction, no turret interaction beyond being a minion.

**Reference** (4.7): 8:00, respawn 180 s (120-150 after 18:00), Enhanced 12:00, Evolved 18:00; HP 31,743 + 2,242/min frozen at 18:00, ATK 428 + 20/min true; team gold 75 + 15 x minute; the Summoned Lord spawns with the next wave, walks the lane with the fewest enemy turrets, counts as an allied hero, turrets target it first, charges a turret for 30% (50% Enhanced+) of its max HP as true damage and disables it briefly, has 15-35% DR (+4% per nearby ally), enhances the next wave(s) [H/M].

**Target**

| Piece | Value |
|---|---|
| Clock | 8:00; respawn 180 s; 120 s from 20:00 (section 10). Evolved at **15:00** (unchanged `ancientLordAt`; our target match is shorter than MLBB's, so 18:00 is too late) |
| HP | 8,000 + 400 x (minute - 8) from 8:00 (12:00 = 9,600, 15:00 = 11,200, frozen at 18:00 = 12,000). Five heroes at 8:00 (about 900 DPS after armor) need about 9 s; a jungler alone about 45 s and it hits back for 200 true/s |
| ATK | 200 + 10/min **true** damage, 1/s, plus Thunder Strike every 4 s: 110% ATK in a 260-wu circle (cheap: reuse `doNova`-style loop in `EpicMonster.update`) |
| Armor = MR | 30 (37 evolved) |
| Team reward | gold `45 + 9 x minute` per hero (8:00 = 117, 15:00 = 180; x comeback), XP `200 + 20 x minute` per hero; **Crown's Sight removed** (the Lord is a siege unit, not a stat buff) |
| Enhanced waves | for 60 s after the kill, waves spawned by the killing team get +50% HP and ATK (flag in `Game.waveBoost[team] = Game.time + 60`, read in the `Minion` constructor) |

Summoned Lord (`LordMinion`), one per Lord kill (evolved: one per lane, as now):

| Piece | Value |
|---|---|
| Spawn | immediately at 45% of the chosen lane (unchanged; the fight that won it is still going on). Lane choice by physical lane: fewest live enemy structures on that polyline, tie -> lowest-HP enemy outer, tie -> mid |
| HP | 4,000 + 200/min (evolved 5,500 + 200/min); armor 40 (50) |
| ATK | 150 physical (180), 1/s, x4 to structures (x5); 100% to the crystal |
| Speed | 210 (220) |
| Damage reduction | 25% + 4% per allied hero within 600, cap 45%; no leash (it walks until it dies) |
| Turret interaction | turrets shoot it before any other non-hero; on first coming within 410 of each enemy turret/inhibitor/crystal it deals **30% of that structure's max HP as true damage** (50% evolved) and the structure cannot attack for 3 s (`t.disabledT = 3`); it is minion cover for allied heroes |
| Escort aura | allied heroes within 600 deal +15% damage to structures |
| Bounty | 60 gold / 60 XP to the killer's nearby heroes (section 5 share) |

Payload check: a Lord minion at 12:00 walking into a lane with its outer down meets the middle turret (3,400 HP): charge 1,020, then 150 x 4 x 0.83 = 498 per second; the turret dies in 5 s while shooting the minion for 215 x 0.7 (DR) = 150/s of its 4,800 HP. With even two escorting heroes the middle and inner turrets and the inhibitor fall inside one 40-s death timer. That is what converts a won fight into a win.

**Change**
- `js/objectives.js EpicMonster`: Lord HP/ATK/armor per the table, `atkSpd 1.0`, `attackPacket` type `'true'`, `thunderT` timer for the AoE; `die`: new gold/XP formulas, drop `applyBuffRune('lord')`, set `Game.waveBoost[team]`.
- `js/objectives.js LordMinion`: stats per the table; `takeDamage`/`resolveDamage` hook applying DR from allies within 600; `update`: keep a `Set` of structures already charged; when entering 410 of a new one apply `resolveDamage(this, t, {amount: t.maxHp * (empowered ? 0.5 : 0.3), type: 'true'})` and `t.disabledT = 3`.
- `js/entities.js Tower.update`: `if (this.disabledT > 0) { this.disabledT -= dt; return; }`; in the minion pass, `if (m.kind === 'lord') { t = m; break; }`.
- `js/main.js spawnLordMinion`: one minion (not two) in the non-evolved case; lane scoring by `physLane` (from bot-ai.md 4.1); `Minion` constructor: `if (Game.waveBoost[team] > Game.time) { hp *= 1.5; atk *= 1.5 }`.
- `combat.js`: `if (src.type === 'hero' && target.isStructure && Game.minions.some(m => m.kind === 'lord' && m.team === src.team && m.alive && dist(m, src) < 600)) amount *= 1.15`.

---

## 15 Match length target and the stalemate levers

**Target: a 5v5 between two heuristic-bot teams is decided (crystal destroyed) between 12:00 and 18:00 in at least 80% of seeded matches, median 14-16 min, never by the 30:00 cap.** MLBB's own spread is 10-25 min with 10-15 counted as fast (reference 2.6); we aim at the fast end because our lanes are shorter in seconds and a phone session is short.

Why the baseline runs to 30:00, and which change above addresses each cause:

| Cause (section 0.1) | Lever | Sections |
|---|---|---|
| A won fight buys 21 s | respawn `3.2 + 2.1 L + minutes` -> 40 s at 12:00, 50 s at 15:00, 66 s at 18:00 | 11 |
| Nothing to convert into | inhibitors never return, crystal immune until one falls, then 4,800 HP at armor 40 with super and Lord minions at full damage | 10 |
| Lord kill converts to nothing | Summoned Lord: 30%/50% max-HP charge, 3 s disable, 25-45% DR, turret-first targeting, escort aura, enhanced wave; one payload that a defending team must actually stop | 14 |
| Waves never threaten a turret | siege minion every wave, ATK +2/min (+3 after 12:00), speed-up from 10:00 so late waves stack, 50% crystal damage from normals but 100% from supers | 1, 2, 3 |
| Turrets too durable for the DPS on the board | HP 3,000 / 3,400 / 3,800, armor 20/20/40, ATK grows only +26% over 20 min while hero power keeps growing; shielded tiers immune (no wasted damage) so the siege is sequential and readable | 9 |
| Everyone is full-build L15 by 12:00, so the late game is symmetric | passive XP halved, minion XP split, kill XP split; kill gold 100 + 4L with assists at 60%; power keeps climbing until 16-18 min | 5, 6, 7 |
| The turtle/lord loop is farmed without stakes | 3 Turtles max, Lord scales and hits true damage, Retribution scales with level so secures are contested | 12, 13, 14 |
| Safety | 30:00 cap stays; from 20:00 structures take +25% and Lord respawns in 120 s | 10 |

What this spec does **not** do: teach bots to group and push. `docs/design/bot-ai.md` sections 4-5 (`push`/`end` plans, escort of a `LordMinion`, `chooseLane`) are the other half. The economy changes here make a push possible and profitable; the bot plan makes it happen. The verification targets below assume both land; run the checks after this spec alone first and expect match length to drop from 30 to about 20-24 min, then to 12-18 with the bot plan.

Tuning knobs, in the order to turn them if the median is still above 18:00 after both land: (1) crystal HP 4,800 -> 4,000; (2) Lord charge 30% -> 40%; (3) respawn multiplier 1.25 from 18:00 -> from 15:00; (4) minion speed-up from 10:00 -> 8:00. If the median is below 12:00: (1) crystal regen 25 HP/s while no enemy is within 600 (the reference's 165 per 5 s at 0.7x); (2) Orange Alert 60 s -> 90 s; (3) energy shield 1,800 -> 2,400.

**Where the levers stand (measured 2026-09-22, `node headless/batch.js --matches 40 --lineups draft`, the game's own draft, heuristic bots, seeds 1-40).** All four shortening knobs had been turned and the game had overshot the band: median 12.08 min, 20 of 40 matches under 12:00, p10 9.79. The endgame was not a phase — the crystal died a median 14 s after the last inhibitor fell, and a median match took only 4 of the 9 turrets. Knobs 1, 2 and 4 are therefore back at their spec defaults (crystal 4,800, Lord charge 30%, minion speed-up from 10:00); knob 3 stays at 15:00 because it only engages in matches that are already long, and the tail does not need lengthening.

| | Before (all four turned) | After (1, 2, 4 reverted) |
|---|---|---|
| Match length median / mean | 12.08 / 12.52 min | **13.20 / 13.13 min** |
| p10 / p90 | 9.79 / 16.37 | 9.85 / 17.10 |
| Under 12:00 / in 12-18 / over 18:00 | 20 / 20 / 0 | 15 / 22 / 3 |
| First turret (median) | 8.85 min | 8.88 min |
| First inhibitor (median) | 10.50 min | 10.59 min |
| Last inhibitor -> crystal (median / mean) | 0.23 / 0.61 min | 0.29 / 1.22 min |
| Turrets destroyed (median) | 4 | 5 |
| Matches reaching the 30:00 cap | 0 | 0 |

The laning phase was never the problem: first turret and first inhibitor barely moved. What the reverts bought is a longer close, which is the part the player is meant to be able to defend.

---

## 16 Verification plan (headless simulator)

All checks run with `node headless/simulate.js --until-end --interval-ms 1000 --seed N` (or `createSimulator({seed, intervalMs: 1000}).run({untilEnd: true, onSnapshot})` from a script in the scratchpad, like the previous `baseline.js`). Snapshots carry `heroes[].gold.earned / level / respawnMs / kda`, `structures[].hp`, `minionGroups`, `objectives`, `events`. "Median over 20 seeds" means seeds 1-20 with the default random lineups. Add a `--detail full` run where per-minion positions are needed.

| # | Check | Measure | Target |
|---|---|---|---|
| 1 | First wave and clash | `entityCounts.minions` first becomes > 0; first snapshot where a blue and a red minion of the same lane are within 300 wu (`--detail full`) | spawn at 10.0 s (20 minions); side clash 0:38-0:42, mid clash 0:29-0:33 |
| 2 | Wave cadence and composition | minion count deltas; `minionGroups` kinds | spawns every 30.0 s; side lanes 1/1/1 every wave; mid 1 melee + 3 ranged for waves 1-10, 1/1/1 from the 5:10 wave |
| 3 | Minion speed | position of one unopposed minion over 5 s on a straight segment (`--detail full`, mid lane, before 0:30) | 180 +/- 3 wu/s at 0:20; 200 +/- 3 for a wave spawned at 12:00 |
| 4 | Minion growth | a melee minion's `hp.max` in the wave spawned at 10:00 | 470 +/- 2; siege 920 +/- 2 |
| 5 | Turret fire | time between two `kill` events by the same tower on minions, and hero HP deltas while standing in range (`--detail full`) | 1.00 s cadence; hero hits 190, 257, 323, 390 for an outer at 0:00; ramp back to 190 after 2 s out of fire |
| 6 | Gold economy at 10:00 | `gold.earned` of the `top`-lane hero at 10:00; team total; share of team gold from kills (sum of kill+assist events) | gold laner median 3,600-4,600; team 14,000-18,000; kill share 15-25% |
| 7 | Levels | median level of the four laners at 5:00 and 10:00; first time any hero hits L15; jungler level at 1:45 | L7 +/- 1 at 5:00, L10-11 at 10:00; no L15 before 14:00; jungler L4 (not L5) after its first full clear |
| 8 | Respawn | `respawnMs` on the first snapshot after a death, versus the victim's level and the clock | equals `3.2 + 2.1 L + min` +/- 0.1 s; 40.4 s for L12 at 12:00; >= 60 s for L15 after 18:00 |
| 9 | Structures and objectives | events: first outer death time; any crystal HP change while 3 inhibitors alive; Turtle spawn times; Lord death -> `LordMinion` spawn; structure HP drop on Lord-minion contact | first outer dies 5:00-9:00 (median); crystal HP never drops while all inhibitors stand; Turtles at 2:00 and 120 s after each death, none scheduled after a 6:00+ death; Lord minion appears within 1 s of a Lord kill and each turret contact removes 30% (50% evolved) of max HP |
| 10 | Match length and death rate | `complete.timeMs` and `reason`; total deaths / minutes | over seeds 1-20: median 12:00-18:00, >= 80% end before 18:00 after the bot plan lands (20:00-24:00 with this spec alone), 0 matches reaching the 30:00 cap; hero deaths 2.5-3.5 per minute (both teams) |

Regression guard: `node headless/runtime.test.js` must still pass, and the 60-s wall-time cost per simulated minute (about 15.6 s today) must not grow by more than 10% (the new per-minion share loop and the Lord DR check are the only hot-path additions; both are bounded by hero count).
