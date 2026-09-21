# Legends Arena — a Mobile Legends–style 5v5 MOBA

A browser-based replica of Mobile Legends: Bang Bang gameplay, built with plain
HTML5 canvas + JavaScript. No dependencies, no build step.

## Run it locally

Serve the folder over HTTP:

```bash
python3 serve.py
```

Then open <http://localhost:8642>. Works on desktop and mobile (landscape).
(`serve.py` is a plain static server that disables browser caching so code
edits always take effect; any static server works, but bump the `?v=` tags
in `index.html` after editing files if yours sends cache headers.)

## Headless simulator

The command-line simulator runs the real game state and bot logic without a
browser, canvas, audio, or UI. It uses a seeded random stream and emits one
JSON object per line at exact simulated-time boundaries (50 ms by default).
Node.js 18 or newer is required, but there are no package dependencies.
If Node is not on your command path, the Python launcher will also find the
Node runtime bundled with Codex Desktop.

```bash
# One second of simulation: state at 0, 50, 100, ... 1000 ms
node headless/simulate.js --duration-ms 1000

# A compact human-readable trace
node headless/simulate.js --duration-ms 500 --format pretty

# A complete match sampled once per second, written as JSON Lines
node headless/simulate.js --until-end --interval-ms 1000 --output match.jsonl

# Equivalent launcher when `node` is not on PATH
python3 headless/simulate.py --duration-ms 500 --format pretty
```

Every state frame includes match time, score and team economy, every hero's
position/resources/KDA/AI target/cooldowns/items/buffs, all structures and
monsters, objective clocks, grouped minion counts, projectile/zone counts,
and events since the previous frame. Pass `--detail full` to include every
individual minion, projectile, and zone. `--seed`, `--blue-lineup`, and
`--red-lineup` make scenarios reproducible; `--mode duel` runs an AI-vs-AI
duel. Run `node headless/simulate.js --help` for the complete option list.

## Features

### Combat

- **Three damage types** — Physical, Magic and True. Physical is reduced by
  Armor, magic by Magic Resist, true by nothing. Both defences use the same
  diminishing curve (`COMBAT.DEF_K`), and penetration is applied to the
  defence *before* the curve — percent first, then flat.
- **Full secondary stat line** — crit chance and crit damage, physical
  lifesteal, spell vamp, cooldown reduction (capped at 40%), tenacity
  (capped at 60%), HP/mana regen, flat and percent penetration for both
  damage types.
- **Six kinds of crowd control**, each defined by what it takes away:
  slow, immobilize (rooted, can still act), silence (can move and attack,
  cannot cast), stun, airborne, and suppression — which ignores tenacity.
  Knockback resolves instantly rather than as a timer. Every one has a
  colour, a unit aura and a health-bar pip.
- **Shields** absorb before health and draw as a continuation of the health
  bar, so total effective HP is one length to read.
- Damage over time, on-hit passives, and reflected damage all run through
  the same single `resolveDamage()` pipeline in `js/combat.js`.

### Heroes

- **28 original heroes** across Marksman (4) / Mage (6) / Tank (4) / Assassin (4) /
  Support (4) / Fighter (6), each with a **passive**, two skills and an ultimate.
- Passives are real mechanics, not flavour: Zephyr's every-third-attack
  proc, Ignis's stacking Ember burn, Grom's crowd-scaling resists and panic
  shield, Nyx's positional true damage, Sylva's heal-linked haste, Torren's
  lifesteal that grows as he drops, Mira's four-stack freeze, Karn's
  attack-driven cooldown reduction and damage-stacked armor — plus 20 more
  (Vesper, Quill, Lumen, Volt, Nadir, Ashara, Hexa, Wraith, Sable, Rook,
  Brass, Omen, Tide, Cinder, Bastion, Marrow, Anchor, Bell, Wick, Pact).
- **Manual skill leveling** — one point per hero level, ultimate gated at
  levels 4 / 8 / 12. Ranks sum to exactly the level cap, so a hero finishes
  with everything spent. `Shift`+`1/2/3`, or tap the rank pips on touch.

### Loadout

- **Item shop** — 25 finished items across Attack / Magic / Defense / Boots /
  Roam / Jungle, each built from two of nine components plus a recipe cost.
  Six slots, 70% sell refund, open at your own base with `P`. Bots shop
  situationally: they buy the resist the enemy team is actually threatening
  them with, and carries are forced to buy damage before defence.
- **Quick Buy** — a live recommended-item card uses the same role- and
  matchup-aware scoring as the bots. It shows the remaining gold anywhere
  on the map and becomes a one-tap purchase at your fountain.
- **14 battle spells** — Flicker, Execute, Retribution, Sprint, Purify,
  Inspire, Petrify, Aegis, Vengeance, plus Flameshot, Arrival, Icequake,
  Weaken, Revitalize (see `js/mlbb.js`). One per hero, chosen at hero select,
  cast with `F`. Retribution is the only way to steal an epic objective.
- **6 emblems** — a stat package plus one keystone each (Killing Spree,
  Impure Rage, Weakness Finder, Brave Smite, Focusing Mark, Festival of
  Blood).

### Map and objectives

- **5v5** on a three-lane map with jungle, river and bushes. The original
  **Aether Current** grants 12% movement speed while a hero is in the river,
  turning rotations and objective approaches into a map-position decision.
- **Fog of war** — a per-team vision grid, rebuilt each frame. Heroes see
  far, minions barely past their own nose, and hiding in a bush shrinks your
  own sight. Terrain you have explored stays dimly visible; terrain you have
  never seen is dark.
- **Epic objectives** — Turtle from 2:00 (respawning), replaced by the
  **Lord** at 8:00. Killing the Lord buffs the whole team and sends Lord
  minions down the lane where they will convert. Both pits sit on the river
  line, which is the perpendicular bisector of the two bases — the only
  placement that is the same walk for either team.
- **Buff camps** — the eight jungle camps grant the Sage Rune (cooldown
  reduction and mana) or the Fury Rune (attack, magic power, tenacity).
  Runes are dropped on death. Each jungle holds two of each, so the two
  halves offer identical farm.
- **A symmetric board** — a 180° turn through the centre swaps the bases and
  must map every lane, turret, inhibitor, bush, camp, wall and pit onto an
  identical one. This is asserted in the test suite rather than trusted,
  because a side advantage of this kind is invisible in play and shows up
  only as a win-rate drift.
- **Structures** — 12 turrets, 6 inhibitors, 2 bases. Inner turrets are
  shielded while the outer turret in their lane stands. Destroying an
  inhibitor sends super minions down that lane until it respawns. Hero
  damage to structures with no allied minion nearby is cut to 35%
  (back-door protection).
- **Minion aggro** — attacking an enemy hero standing in their own wave
  turns that wave onto you.
- **1v1 duel arena** — a separate compact map on the middle half of the
  board: two bases, a direct lane between them, two flank routes bowing
  around it, six bushes, four walls and a centre **shrine**. The shrine
  drops a Fury or Sage rune on a repeating clock (first at 0:40, then every
  0:55, held for 25s rather than the 5v5's 70) and is taken by standing on
  it, so the one thing worth contesting sits in the open on the shortest
  path. Every feature is placed as a 180°-rotated pair, so neither duellist
  has the shorter walk. No structures, minions, camps or epics; no fog
  either, but the bushes still hide you from more than 180 units away.
- **Walls** — impassable terrain, as a thick polyline (`js/map.js`). Two
  arcs enclose the duel shrine into a pit with a doorway at each end of the
  lane, and a ridge in each corner gives the flank routes an outer edge.
  The 5v5 Lord and Turtle each sit in a two-door objective pit, so taking an
  epic means committing through a doorway the other team can hold. Those
  doors open *along* the river rather than toward the bases, which keeps the
  Aether Current route unbroken and hands the walls to the jungles either
  side. Walking into a wall slides you along it; **dashes, skill shots and
  projectiles all cross freely**, which is what makes a wall an escape tool
  rather than a second health bar.

### Interface

- **MOBA controls** — floating joystick (bottom-left), attack button + skill
  wheel (bottom-right) with **drag-to-aim** skills; tap casts auto-aim. A
  quick tap on keyboard still casts immediately, while a hold aims at the
  cursor and casts on release. `Esc`, right-click, or the cancel zone aborts.
- **Precision targeting** — dedicated HERO and LANE attack controls filter
  out the wrong unit type (`G` and `T`). Visible enemy portraits can be
  locked, and settings switch hero priority between lowest HP and nearest.
- **Keyboard** — WASD/arrows move, `Space` general attack, `G` hero attack,
  `T` minion/structure attack, `1/2/3` skills,
  `Shift`+`1/2/3` level a skill, `F` battle spell, `B` recall, `P` shop,
  `V` ping wheel, `Z/X/C` quick pings, `Tab` scoreboard, `M` mute.
- **HUD** — minimap with objective timers, team score with a live gold-
  advantage bar, ally strip with HP/mana/ult-ready, kill feed, carried
  items, a recommended build card, target-lock portraits, terrain status,
  and a resist readout. Enemy minions that a basic attack will kill receive
  a gold last-hit ring using post-Armor damage rather than raw Attack.
- **Ping wheel** — Danger / Retreat / Attack / Gather / Need help / On my
  way, drawn in the world and on the minimap. Bots ping too: a bot calls
  retreat when it disengages and gathers the team onto an epic.
- **Scoreboard** (`Tab`) — full K/D/A, gold, damage dealt and taken, with a
  damage-share bar.
- **Surrender vote** from 8:00, 4 of 5 to pass. Bots vote on how badly the
  game is actually going, not at random.
- **Post-match** — MVP card (weighted so a tank or support can win it), a
  gold-advantage graph over the whole match, and a full damage breakdown.
- **Spectator mode** — "👁 Spectate Bots" runs a full 10-bot match: drag to
  pan, scroll to zoom, click a hero to follow, click the minimap to jump,
  and a 1×–16× speed toggle.

### Design system

Colour, type, spacing, radii, shadows and motion all live in `js/theme.js`,
which writes them into CSS custom properties at boot. The canvas and the DOM
read the same palette, so they cannot drift. HUD sizes are authored against a
1280×720 landscape viewport and multiplied by `--hud-scale`; every
edge-anchored element honours `env(safe-area-inset-*)`.

### Bots

- Bots retreat when low, avoid tower dives, push lanes, use their skills,
  contest epic objectives (with a commitment threshold so they do not hand
  the pit back at the first hit), take buff camps when idle, shop
  situationally, and use their battle spell in the one situation it is for.
- **They read telegraphs.** Every zone skill warns for `delay` seconds before
  it lands, and nothing in the AI used to look at `Game.zones` at all — bots
  walked through meteors. They now step out, summing overlapping telegraphs
  as repulsion so a bot caught between two leaves through the gap. A dodge it
  cannot finish in time is skipped: a hit is binary, so half an escape costs
  the same seconds and still takes the damage. Measured over a match, this
  cuts heroes hit **per zone cast** from 1.92 to 1.31.
- **They flee with their kit.** A retreating bot reaches no target, so it
  never entered the casting path and would die holding an unused dash. It now
  spends heals, self-buffs and dashes on getting out — with the dash aimed
  *away* from the nearest enemy, since the same skill is aimed at a target to
  engage. The battle spell had the identical bug for the identical reason
  (`botCastSpell` is only called from `botCast`, which needs a target), so
  Flicker, Sprint, Purify and Aegis were held to the grave: 74% of deaths
  happened with the spell still off cooldown, and 81% of deaths happened while
  retreating. Fixing it took deaths from 50 to 32 in a measured match, with
  "died holding the spell" falling from 74% to 16%.
- **They farm with the kit, not just with basic attacks.** Every damage skill
  was gated on the target being a hero, so a bot cleared a 1250-HP buff camp
  by auto-attacking it for sixteen seconds with its whole rotation off
  cooldown — 8,356 refused opportunities in a single measured match. Skills
  now go on waves and camps too, guarded by two conditions that stop it being
  a downgrade: no enemy hero in sight, and a mana floor (`farmManaFloor`), so
  the rotation is still there for the fight. Measured across two seeds: casts
  per hero per minute 4.8 → 6.8, team gold per minute +5–8%, and casting at
  *heroes* unchanged.
- **They know the terrain is there.** Colliding with a wall was handled purely
  locally — a bot walked into the middle of a rock and shuffled along whichever
  way it happened to touch first, with no idea which end was the way through.
  Bots now build a hero-sized navigation grid for the active map and use A* to
  plan the complete journey through jungle corridors and objective entrances.
  Routes are smoothed, cached and replanned only when a moving goal changes or
  progress stalls. Enemy turret circles and visible pursuers add dynamic cost,
  so a retreat chooses the safer open route rather than merely the shortest
  straight line.
- **They position instead of forming a firing line.** Laners anchor to the live
  allied wave rather than a fixed timetable of coordinates. In fights, bots
  sample legal positions around their target, preserve role-appropriate range,
  avoid walls and turret threat, spread away from allies and keep a stable
  left/right flank preference. The result is rotation and kiting without random
  per-frame jitter.
- **They use walls, not just avoid them.** Dashes ignore terrain, so a fleeing
  bot now scores its dash directions and prefers the one that leaves a wall
  between it and the chaser, who then has to walk round. In scenarios where the
  chaser stands alongside a wall (so dashing straight away runs parallel to
  it), the old behaviour broke line of sight 40% of the time and the scored
  choice does it 100%, at a cost of 13 units of raw distance.
- **They evaluate fights, not just headcounts.** Visible heroes are weighted
  by health, level, gear and ready skills. Bots focus an ally's target, stay
  committed instead of thrashing between equal targets, secure real last
  hits, and refuse hero chases under an uncovered turret.
- **They convert advantages.** A safe bot recalls when it can complete its
  next role-aware item instead of carrying thousands of unspent gold.
  Supports heal wounded allies, Purify can actually be used while disabled,
  and Retribution is held for its exact 500/800-damage secure window and
  explicitly aimed at the epic objective.
- These behaviours are per-hero flags (`avoidsZones`, `escapeCasts`,
  `farmsWithSkills`, `advancedAI`), so `Game.experiment` can run them as a
  mirrored A/B — same five heroes a side, feature on for one team — and price
  them in win rate rather than opinion.
- Every threshold lives in `js/bot-params.js`, including fight-power ratios,
  recall safety, focus-fire weight, last-hit value and objective commitment.
- **Neural bot (imitation learning)** — a second, selectable bot controller
  whose target selection is a small trained network (6,850 params) cloned
  from the heuristic bot. The heuristic bot is the default and the fallback.
  See [TRAINING.md](TRAINING.md) and [training/harness.html](training/harness.html).

> **Note on the shipped model.** `models/neural-bot-v1/model.json` was trained
> against the pre-combat-rework game. It still loads and infers correctly
> (fixed observation shapes: `selfDim 30`, `candDim 16`, `K 16`), but it is
> now choosing targets in a game with damage types, items, fog of war and
> epic objectives that it never saw during training, and it loses to the
> heuristic bot. Re-collect and retrain before drawing any conclusions from
> it.

- Matches are bounded for training: waves scale sharply after 18 min and a
  30-min cap awards the win to the healthier base.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page + HUD DOM |
| `css/style.css` | All styling, driven by the tokens in `theme.js` |
| `js/theme.js` | Palette, type scale, motion, HUD scale — the design system |
| `js/data.js` | Constants, combat model, CC vocabulary, hero/skill definitions |
| `js/combat.js` | Stat block, damage pipeline, crowd control, hero passives |
| `js/map.js` | Lane paths, tower/inhibitor spots, bushes, camps, objective pits, duel arena |
| `js/entities.js` | Unit/Hero/Minion/Tower/Monster/Projectile/Zone + bot AI |
| `js/objectives.js` | Buff camps, Turtle/Lord, inhibitors, super minions |
| `js/items.js` | Item shop, battle spells, emblems, bot shopping |
| `js/mlbb.js` | MLBB layer: extra spells, Retribution evolves, blessings, slogans, bans, HUD callouts |
| `js/features.js` | Feature flags / experiment toggles |
| `js/input.js` | Joystick, skill drag-aim, keyboard |
| `js/ui.js` | Sound, HUD, minimap, shop, scoreboard, pings, end screen |
| `js/main.js` | Game state, match loop, vision, rendering |
| `headless/runtime.js` | Deterministic, browser-free adapter over the real game loop |
| `headless/simulate.js` | JSONL / readable command-line state stream |
| `headless/simulate.py` | Launcher for systems where Node is not on the command path |

Balance lives in `COMBAT` and `BALANCE` (`js/data.js`), the item table
(`js/items.js`), and the constructors in `js/entities.js` and
`js/objectives.js`.

## Not implemented

Called out so the list above can be trusted: there is no account
progression, rank tier, hero mastery or match history; the draft screen picks
line-ups plus one ban per side (see `js/mlbb.js`); the 1v1 duel is a
practice arena with no win condition — it runs until you leave it, and its
bases are recovery zones, not shops; and the audio is still the original
synthesized bleeps rather than a designed sound set.
