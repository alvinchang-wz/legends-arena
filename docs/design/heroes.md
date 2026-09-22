# Legends Arena hero design spec (final)

Design document only. No repository code is changed by this spec. Companion data file: `docs/design/hero-kits.json`.

Conventions
- Field names follow `js/data.js` where a field exists (`dmg`, `dmgLv`, `scaleAd`, `scaleAp`, `cd`, `mana`, `range`, `radius`, `stun`, `slowPct`, `slowDur`, `knockback`, `pierce`, `explodeR`, `stopOnHero`, `endNova`, `buff`, `heal`, `healLv`, `shieldPct`, `physPenPct`, `hook`, `ticks`, `interval`, `delay`). New fields are marked **(new)** and specified in "New engine features required".
- Rank scaling: S1/S2 have 6 ranks, ults 3 (learned at 4/8/12). `dmgLv` is per rank as today. `cdLv` and `manaLv` **(new)** are per-rank deltas (cd falls, mana rises). Ult `cd`, `mana` and CC durations may be 3-element arrays **(new)** indexed by rank.
- "X -> Y" means rank 1 -> rank 6 (or rank 1 -> rank 3 for ults).
- All skill damage still passes through `COMBAT.SKILL_DMG` (0.88) vs non-structures, mitigation 95/(95+def), tenacity cap 0.6. Airborne is reworked to ignore tenacity (see features).
- MLBB bands used (from `docs/research/mlbb-reference.md`): S1/S2 cd 5-13 s, ult 30-55 s; poke ratios 65-105%, CC/targeted 40-80%, ult 90-140%; stun 0.5-1.2 s; airborne 0.5-1.0 s; root 1.0-1.5 s; silence 1.0-1.6 s; suppress 0.6-1.5 s single target; ranged carry speed 240-252, melee 250-280.

Judge resolutions applied (majority of the three verdicts; where they split, the option that removed a listed duplicate and used an already-required feature was chosen)
- Trap object: Quill keeps it. Ashara becomes the roster's only conceal hero (Sand Veil) with a progressive quicksand ult.
- Energy: Wraith keeps the fast pool (regen 8/s). Lumen keeps Focus but as a sniper battery (no passive regen; basics and standing still charge it); Flash Powder becomes Recoil (dash-back); Overcharge loses its stun.
- Mark-and-consume: Ignis keeps it (Fireball becomes a cone so it no longer mirrors Nadir). Sable becomes the %-max-HP poison assassin with the only hero-only projectile.
- Enemy tether: Anchor keeps the root-on-completion tether and loses his stun dash for Weigh Anchor (control-immune self root). Hexa's thread becomes a drain (heals, bursts and spreads Blight; no root).
- HP-cost casting: Marrow keeps it (costs are % of max HP). Pact is hybrid: mana for Let and Covenant; only Offering costs HP and it is the roster's single-target ally heal. Covenant's AoE suppress becomes immobilize + silence.
- Missing-HP scaling: Nyx keeps target-missing-HP (Deathmark loses the silence; Fan of Knives becomes Shade Step, the only untargetable state). Torren scales on his OWN missing HP and gets the leap-to-point.
- Pull ults: Nadir owns the tweened pull-to-point (speed 260 u/s, refused by immuneT, does not clear dashS). Grom keeps his channelled pull + launch (tween). Karn's Reel In becomes Gaol (chains that punish leaving).
- Dash + slowing endNova S2s: only Vesper keeps one. Cinder's Coal Dash has no slow unless overheated; Torren's War Leap is a leap-to-point; Lumen's becomes Recoil.
- Slowing S1 skillshots: Zephyr's Gale Shot and Bell's Chime lose their slows; Quill's Bola becomes a boomerang (slow only on the return pass).
- Stun dashes: Grom and Brass (difficulty-1 heroes) keep theirs; Anchor's is replaced; Omen's is an ult.
- Multi-tick zone ults: Quill 3 ticks, Volt's slow ramps per tick, Hexa 4 ticks that spread Blight, Ashara's becomes progressive quicksand.
- Balance caps adopted: Zephyr AS steroids take the max instead of multiplying and a volley counts as one basic; Vesper Deadeye 1.10 AD with Last Light limited to basics + Deadeye and the recharge refund once per 2.5 s; Ignis stun lock 1.5 s and 20% MP per Ember; Mira 2.5 s Chill immunity after a freeze; Volt bounce decay 0.75 and Static heroes only; Brass taunt 0.8/1.0/1.2 s at 260 radius; Omen full reset on kill, half on assist; Sylva Canopy 12 x 12/17/22 (+8% MP) not stacking with Vine Link; Bell Carillon +0.20 -> +0.30 AS for 3.5 s (max with other steroids); Wick shieldPct 0.08 and the lantern has no slow; Cinder Heat +8 per skill hit; Tide ult push 130 and wall stun 0.7; Grom Bull Charge stun 0.7; Anchor Harbour slow 2.0 s and tether snaps on hard CC; Rook Return window 3 s with the ult cd starting on cast.

---

## Marksmen

### Zephyr (Marksman, physical, difficulty 2)
**Identity.** Attack-speed hypercarry. Weak in the first 3 s of a fight, unmatched once Slipstream is stacked and Storm Volley turns every basic into a piercing gale. No hard CC, one reposition, pure sustained damage.

**Signature mechanic.** Basic-attack replacement state (`basicMod`): Storm Volley makes her basics fire as piercing wind arrows for 6 s. Only hero that changes what her basic attack is.

**Resource.** Mana. mp 200, mpLv 22.

**Base stats.** hp 520 (+68), atk 60 (+7.0), armor 12 (+2.2), mr 10 (+1.6), range 345, atkSpd 1.12, speed 248.

**Passive: Slipstream** (`slipstream`, new id replacing `tailwind`). Each basic attack that hits grants +6% move speed for 2 s, stacking to 5 (30%). At 5 stacks basics deal +18 (+12% AD) bonus physical damage. A Storm Volley volley grants one stack regardless of how many enemies it pierces. Stacks drop together when the timer lapses. Engine: onBasicHit (primary hit only) adds a `speedPct` timed buff scaled by `pv.stacks`; onDealDamage adds the bonus when stacks === 5.

**S1 Gale Shot** - `skillshot`, `pierce: true`. range 700, speed 1000, radius 26. physical dmg 110 +16/rank (110 -> 190), scaleAd 0.75. No CC. cd 7, cdLv -0.3 (-> 5.5); mana 40, manaLv 4. Poke and wave clear; hitting a hero counts as one Slipstream stack.

**S2 Updraft** - `dash`. dist 260, speed 1100, no damage. `buff: { asMult: 1.5, dur: 3.0 }`. cd 11, cdLv -0.4 (-> 9); mana 50. Her only mobility: engage steroid or escape, never both. asMult buffs take the max with Storm Volley (do not multiply).

**Ult Storm Volley** - `basicMod` **(new)**. duration 6 s, lineRange 420, radius 30, pierce. Every basic becomes a piercing projectile: the primary target takes a full basic (crit, lifesteal, onBasicHit); every other enemy in the line takes 100% AD + bonus as a secondary basic hit (40% lifesteal, no crit re-roll, no passive stacking). bonusDmg 40/65/90 (+25% AD) physical per enemy hit. asMult 1.3/1.4/1.5 (max with Updraft). cd 48/42/36; mana 100/120/140. Casting other skills does not end it; death does.

**Counterplay.** Zero hard CC and one dash: commit a dive the moment Updraft is spent, and burst her before Slipstream reaches 5 stacks. Storm Volley is a visible 6 s state; spread out so the line hits one target or disengage until it expires.

**Bot hint.** Kite at 300-345 and keep attacking one target to hold Slipstream; Updraft toward the fight when an ally engages, away when a melee enemy is within 200; cast Storm Volley when 2+ enemy heroes are within 420 and roughly in a line, then keep auto-attacking instead of chasing.

### Vesper (Marksman, physical, difficulty 3)
**Identity.** Burst-crit skirmisher. Three fanned shots, a sidestep, then one Deadeye round to end a low target. Wins duels and picks, loses long even fights to Zephyr.

**Signature mechanic.** Charge skill: Fan the Hammer stores 3 charges that recharge one at a time and ignore CDR. Only charge-based skill in the roster.

**Resource.** Mana. mp 190, mpLv 20. Charges drawn as 3 pips on the S1 button.

**Base stats.** hp 535 (+70), atk 66 (+7.6), armor 12 (+2.1), mr 10 (+1.5), range 330, atkSpd 1.0, speed 252.

**Passive: Last Light** (`lastlight`, replaces `chambered`). Basic attacks and Deadeye Round against heroes below 40% HP deal +20% damage (Fan the Hammer shots do not benefit). A critical basic attack on a hero refunds 1.0 s of Fan the Hammer's current recharge, at most once per 2.5 s. Engine: onDealDamage checks `target.isHero && hp/maxHp < 0.4` for isBasic or the ult; onBasicHit with `pkt.crit` calls the charge-refund helper with a `pv.refundT` lockout.

**S1 Fan the Hammer** - `skillshot`, non-pierce, with `charges` **(new)**. charges 3, recharge 9 s, rechargeLv -0.4 (-> 7), castDelay 0.6 s. range 560, speed 1300, radius 22. physical dmg 100 +14/rank (100 -> 170), scaleAd 0.60. mana 30 per shot, manaLv 3. Charges start at 0 when learned. Minions block the shot.

**S2 Sidestep** - `dash` with `endNova`. dist 250, speed 1150, no path damage. endNova: radius 170, physical dmg 70 +10/rank, scaleAd 0.45, slowPct 0.30, slowDur 1.0. cd 10, cdLv -0.3 (-> 8.5); mana 45. The only dash + slowing landing burst left in the roster.

**Ult Deadeye Round** - `skillshot`, non-pierce (first unit hit). range 820, speed 1500, radius 20. physical dmg 280/380/480, scaleAd 1.10 (Last Light: 336/456/576 +132% AD on a target under 40%). cd 40/35/30; mana 100/120/140.

**Counterplay.** Every shot stops on the first unit: a minion wave or a tank in front blocks the whole kit. Charge pips are visible; engage at 0-1 charges. Keep teammates above 40% to deny Last Light. Sidestep is her only dash.

**Bot hint.** Poke with one charge when a hero is unblocked and keep 2 banked; in a fight Sidestep for a clear line, dump charges on the nearest hero, fire Deadeye only at a hero below 45% with no minion between; Sidestep away if a melee enemy reaches 220 and no charges remain.

### Quill (Marksman, physical, difficulty 3)
**Identity.** Trapper / zone-control marksman. Slow, no dash, low burst, but he owns the ground: pre-placed snares turn bushes and chokes into a hunting floor, the Bola boomerang pins runners on the way back, Killbox grinds whoever is caught.

**Signature mechanic.** Placed persistent trap objects (`trap`): Snare plants an armed object that waits up to 20 s and triggers on an enemy hero. Only hero who places a hostile object. Secondary: Bola is the only return projectile.

**Resource.** Mana. mp 220, mpLv 24.

**Base stats.** hp 550 (+72), atk 58 (+6.6), armor 14 (+2.4), mr 11 (+1.7), range 320, atkSpd 1.02, speed 245.

**Passive: Quarry** (`quarry`, replaces `barbed`). Enemies hit by Quill's skills or traps are marked 4 s. Basics on a marked target deal +12% damage and grant +8% move speed for 1.5 s (stacks to 3). Engine: onSkillHit writes `marks.quarryT`; onDealDamage checks isBasic + mark; onBasicHit adds a `speedPct` buff.

**S1 Snare** - `trap` **(new)**. range 540, triggerRadius 110, armDelay 0.7, lifetime 20, maxActive 3 (4th removes oldest). Visible to allies always, to enemies within 120 or after triggering. Hero-only trigger. physical dmg 110 +15/rank (110 -> 185), scaleAd 0.50, immobilize 1.0, reveal 2 s. cd 8, cdLv -0.4 (-> 6); mana 45, manaLv 4. Traps persist through Quill's death.

**S2 Bola** - `skillshot`, `boomerang: true` **(new)**, non-pierce on each pass. range 620, speed 850, radius 28. Outbound pass: physical dmg 80 +11/rank (80 -> 135), scaleAd 0.45, no CC. At max range (or on hitting a unit) it turns and flies back to Quill; hitSet is cleared on the turn; the return pass deals the same damage and slows 40% for 1.2 s. cd 10, cdLv -0.3; mana 50. Walk a runner into the return path.

**Ult Killbox** - `zone`. range 580, radius 260, delay 0.6, ticks 3, interval 0.6. physical dmg 100/130/160 per tick (300/390/480 total), scaleAd 0.45 per tick (135% total), slowPct 0.40, slowDur 0.8 refreshed per tick. cd 44/38/32; mana 100/120/140.

**Counterplay.** Traps trigger only on heroes and are visible within 120: a tank walks the bush first. No dash, 245 speed. Bola is 850-speed and telegraphed twice. Killbox has a 0.6 s delay; leave after tick one.

**Bot hint.** Keep 2-3 Snares down: nearest bush mouth to the lane and one behind himself when retreating; Bola any hero walking toward him (aim so the return crosses them); Killbox on 2+ heroes or one rooted/slowed hero; never chase past his traps.

### Lumen (Marksman, physical, difficulty 4)
**Identity.** Long-range sniper on a Focus battery. Lowest HP in the game, longest reach: 900-unit rails and a 950-range Overcharge. She plants, shoots, hops back, and wins by never being reached.

**Signature mechanic.** Sniper battery (`resource: 'energy'`, battery parameters): Focus has no passive regen; it is charged by landing basics and by standing still. Only hero whose resource rewards not moving. Secondary: Recoil is the roster's only dash-back.

**Resource.** Focus 100 flat at all levels. regen 0/s; +20 per basic hit; +30/s while no movement input for at least 0.5 s (bots: while not pathing). Immune to mana items, blue rune, mana burn. Bar colour yellow.

**Base stats.** hp 485 (+60), atk 72 (+8.4), armor 9 (+1.7), mr 8 (+1.3), range 390, atkSpd 0.85, speed 240.

**Passive: Aperture** (`aperture`, unchanged). Basics deal up to +35% damage ramping linearly from 280 range to max range.

**S1 Railshot** - `skillshot`, `pierce: true`. range 900, speed 1500, radius 18. physical dmg 140 +20/rank (140 -> 240), scaleAd 0.70. cd 6, cdLv -0.3 (-> 4.5); energy 30. Three rails empty her; then she must plant or auto-attack.

**S2 Recoil** - `dash`, `dashBack: true` **(new)**. dist 220 opposite to the aim direction, speed 1000, no damage, no CC; restores 20 Focus on landing. cd 10; energy 0. Reopens the distance Aperture needs.

**Ult Overcharge** - `zone`. range 950, radius 100, delay 1.0, ticks 1. physical dmg 380/500/620, scaleAd 1.20. No CC. cd 40/34/28; energy 50. Lands on rooted, slowed or channelling targets, not on runners.

**Counterplay.** Inside 280 Aperture gives nothing, AS 0.85, 485 HP, one 220 hop. Focus is a hard gate: after a volley she is empty until she stands still. Overcharge has a 1.0 s delay and 100 radius: keep moving.

**Bot hint.** Hold 380+ behind the frontline; stand still to charge when Focus < 30 and no enemy is within 500; Railshot any hero in a clear 900 line when Focus >= 60; Recoil when an enemy is within 250; Overcharge only on a rooted, stunned, slowed, channelling or sub-40% hero.

---

## Mages

### Ignis (Mage, magic, difficulty 2)
**Identity.** Short-range burst combo mage. Stacks Embers with Flame Fan and Pyroclasm, then walks in and detonates them with Flashburn for the roster's biggest single-target magic combo. Highest burst, no escape.

**Signature mechanic.** Skill-owned mark-then-payoff (`applyMark` / `consumeMark`): Embers (max 3, 4 s) are applied by skills and consumed by Flashburn, which reads the stacks per victim, adds damage per stack and stuns at 3. Only hero whose skills consume marks. Secondary: Flame Fan is the only cone hitbox.

**Resource.** Mana. mp 300, mpLv 34.

**Base stats.** hp 530 (+68), atk 46 (+4.0), armor 10 (+2.0), mr 12 (+2.0), range 330, atkSpd 0.9, speed 250.

**Passive: Kindling** (`kindling`, replaces `combustion`). Basic attacks against an Embered hero deal +25 (+20% MP) bonus magic damage. Embers are drawn as flame pips on the target's HP bar. (Ember application is done by the skills' `applyMark`; the passive only reads the mark.)

**S1 Flame Fan** - `cone` **(new)**: instant, angle 60 deg, length 480. magic dmg 150 +20/rank (150 -> 250), scaleAp 0.75. applyMark ember x1 (max 3, dur 4). cd 6, cdLv -0.3 (-> 4.5); mana 45, manaLv 5.

**S2 Flashburn** - `nova` with `consumeMark`. radius 260. magic dmg 110 +15/rank (110 -> 185), scaleAp 0.45. Per Ember consumed: +65 (+20% MP). At 3 Embers: stun 0.6 s, unless the victim has `marks.stunLockT` set (1.5 s after any Ignis stun). Mark and pips deleted on consume. cd 9, cdLv -0.4 (-> 7); mana 60, manaLv 5. Rank-6 three-stack hit: 380 +105% MP.

**Ult Pyroclasm** - `zone`. range 640, radius 230, delay 0.9, ticks 1. magic dmg 280/360/440, scaleAp 1.0, stun 0.5. applyMark ember: 2 stacks to units within 100 of the zone centre, 1 to the rest. cd 40/35/30; mana 110/130/150. Combo: Fan (1) -> Pyroclasm centre (2) -> Flashburn at 3 = stun + ~600 +2.0x MP at rank 6/3.

**Counterplay.** Ember pips are visible and expire in 4 s; back off when tagged. The stun needs Ignis within 260, dragging a 500-HP mage into melee. Pyroclasm has a 0.9 s tell; a rim hit only gives one Ember. Flashburn at 0 Embers is harmless.

**Bot hint.** Open Flame Fan at 450; if the target carries >= 1 Ember and Pyroclasm is ready, cast it centred on them; then walk in and Flashburn only when a hero within 240 has 3 Embers or Ignis is below 30% HP.

### Mira (Mage, magic, difficulty 2)
**Identity.** Area-control mage. Paints the ground with lingering Rime Fields that slow enemies, speed allies and stack Chill until targets freeze. Wins by denying space; lowest burst of the six, no mobility.

**Signature mechanic.** Lingering field (`linger`): a zone that stays for seconds and applies continuous effects to enemies and allies instead of discrete ticks. Only mage whose zones help allies.

**Resource.** Mana. mp 310, mpLv 35.

**Base stats.** hp 490 (+62), atk 45 (+3.8), armor 10 (+2.0), mr 12 (+2.0), range 335, atkSpd 0.9, speed 250.

**Passive: Frostbite** (`frostbite`, retuned). Mira's damage applies Chill (4 s, max 4), 8% slow per stack (applied as one applySlow with the strongest value; does not stack multiplicatively with field slows). At 4 stacks the target is Frozen 0.8 s (stun kind), stacks are consumed and the target gains `marks.chillImmuneT` = 2.5 s during which no Chill is applied.

**S1 Frost Shard** - `skillshot`. range 700, speed 900, radius 24. magic dmg 150 +20/rank (150 -> 250), scaleAp 0.7, slowPct 0.25, slowDur 1.5. cd 5.5, cdLv -0.3 (-> 4); mana 40, manaLv 5. Applies 1 Chill.

**S2 Rime Field** - `zone` + `linger` **(new)**. range 600, radius 200, delay 0.3, one pulse: magic dmg 90 +12/rank (90 -> 150), scaleAp 0.4. linger: dur 3, enemySlowPct 0.28, allySpeedAdd 40, chillPerSec 1 (only after an enemy has been inside for 1.0 s). cd 12, cdLv -0.4 (-> 10); mana 70, manaLv 5.

**Ult Glacial Prison** - `zone` + `linger`. range 620, radius 200, delay 0.75. magic dmg 260/340/420, scaleAp 0.9, Frozen (stun) 1.0/1.1/1.2, then leaves a Rime Field (same linger values) centred on the zone. cd 42/37/32; mana 110/130/150.

**Counterplay.** Fields are visible ice patches: step out and the slow ends instantly; Chill pips show how close a freeze is and a freeze buys 2.5 s of immunity. Mira has no dash and 250 speed: dive her with Purify or a blink. The ult's 0.75 s tell allows a Flicker.

**Bot hint.** Drop Rime Field between Mira and the nearest melee threat, or on the enemy carry when allies engage; Frost Shard into the field. Save Glacial Prison for 2+ heroes or a single target at 3 Chill.

### Volt (Mage, magic, difficulty 2)
**Identity.** Sustained anti-tank battle mage. Chain Arc bounces between clustered enemies and every hit strips magic resist, so his damage climbs the longer a fight lasts. Best 5v5 teamfight damage, weakest 1v1 burst.

**Signature mechanic.** Chain-bounce projectile (`bounce`): on hit the projectile retargets the nearest un-hit enemy within range and continues with decaying damage. Only retargeting projectile.

**Resource.** Mana. mp 290, mpLv 32.

**Base stats.** hp 505 (+63), atk 44 (+3.8), armor 9 (+1.9), mr 13 (+2.1), range 325, atkSpd 0.88, speed 250.

**Passive: Static** (`static`, retuned). Skill hits on enemy HEROES apply a Static stack (4 s, max 5); each stack is 8 flat magic penetration against that target. Non-heroes never gain stacks.

**S1 Chain Arc** - `skillshot` with `bounce` **(new)**. range 680, speed 1100, radius 22, non-pierce. magic dmg 140 +20/rank (140 -> 240), scaleAp 0.75. bounce: count 3, range 320, decay 0.75 (0.75, 0.56, 0.42 of first hit), hero bias -150, structures excluded. cd 5.5, cdLv -0.2 (-> 4.5); mana 45, manaLv 5.

**S2 Flashover** - `nova`. radius 240. magic dmg 130 +16/rank (130 -> 210), scaleAp 0.55, stun 0.5. cd 10, cdLv -0.4 (-> 8); mana 60, manaLv 4.

**Ult Thunderhead** - `zone`. range 600, radius 240, delay 0.4, ticks 5, interval 0.45. magic dmg 70/95/120 per tick, scaleAp 0.3 per tick (350/475/600 +150% MP). Slow ramps per tick **(new field `slowPctLv`)**: slowPct 0.10 +0.08 per tick (10% -> 42%), slowDur 0.6. Each tick applies Static to heroes. cd 40/35/30; mana 110/130/150.

**Counterplay.** Spread out: bounces need another enemy within 320. Minions body-block the first hit. Thunderhead is a stationary 2.2 s circle whose slow is light early: leave after tick one. His only hard CC is a 0.5 s stun at 240.

**Bot hint.** Chain Arc whenever two enemy units are within 320 of each other; Thunderhead on the enemy frontliner or any hero standing still in a teamfight; hold Flashover for a melee reaching 240.

### Nadir (Mage, magic, difficulty 3)
**Identity.** Teamfight-initiator mage. Sturdier and slower than the others, with a huge delayed ult that drags enemies into its centre before it detonates. Sets up wombos; helpless once the ult is down.

**Signature mechanic.** Tweened pull-to-point (`pullTo` / zone `pullSpeed`): victims are dragged over time toward a point rather than teleported. Only hero with travelling displacement toward a point.

**Resource.** Mana. mp 300, mpLv 33.

**Base stats.** hp 520 (+68), atk 42 (+3.6), armor 12 (+2.2), mr 14 (+2.2), range 310, atkSpd 0.86, speed 245.

**Passive: Accretion** (`accretion`, replaces `horizon`). Enemy heroes displaced by Nadir's skills become Heavy for 3 s: -20% move speed and +12% damage taken from Nadir. Engine: the tween sets `marks.heavyUntil`; passive tick applies the slow, onDealDamage reads the mark.

**S1 Singularity** - `skillshot`, `explodeR: 140`. range 640, speed 720, radius 30. magic dmg 160 +20/rank (160 -> 260), scaleAp 0.75, slowPct 0.40, slowDur 1.2; splash 80%. cd 7, cdLv -0.4 (-> 5); mana 50, manaLv 5. (The only explodeR skillshot now that Ignis has a cone.)

**S2 Crush** - `nova` + `pullTo` **(new)**. radius 280. magic dmg 120 +14/rank (120 -> 190), scaleAp 0.5. pullTo: target 'caster', dist 120, speed 900 (0.13 s tween; heroes and minions). cd 11, cdLv -0.4 (-> 9); mana 60, manaLv 4.

**Ult Implosion** - `zone` + `pullSpeed` **(new)**. range 560, radius 280, delay 0.9. During the delay enemy heroes inside are moved toward the centre at 260 u/s (max ~235 units); the pull ignores tenacity, is refused by immuneT (Purify), and does NOT clear dashS (a dash or Flicker leaves). Detonation: magic dmg 300/390/480, scaleAp 1.1, stun 0.8. cd 44/38/32; mana 120/140/160.

**Counterplay.** The pull is slower than a dash or Flicker and Purify refuses it. The ring is visible from the first frame. Nadir walks at 245 with no escape and a 720-speed orb for poke; dive him on the ult's cooldown.

**Bot hint.** Hold Implosion until 2+ enemy heroes are within 280 of one point (or one hero under 40%); Crush right after the detonation to keep them stacked; Singularity on whoever retreats.

### Ashara (Mage, magic, difficulty 3)
**Identity.** Ambush and terrain mage. She hides her team in sand, silences whoever pushes through it, and turns ground into quicksand that swallows anyone who stays. Strongest pick potential of the mages, worst straight duel.

**Signature mechanic.** Concealment from a skill (`linger.conceal`): Sand Veil hides allied heroes inside it the way a bush does. Only source of stealth outside bushes. Secondary: Burial is the only progressive CC (slow ramps to a root).

**Resource.** Mana. mp 280, mpLv 30.

**Base stats.** hp 500 (+64), atk 47 (+4.2), armor 10 (+2.0), mr 11 (+1.9), range 305, atkSpd 0.92, speed 255.

**Passive: Dry Mouth** (`drymouth`, unchanged). The third skill damage instance on a target within 6 s silences it 0.9 s (8 s lockout per target). Entering Sand Veil or Burial counts as one skill hit.

**S1 Glass Needle** - `skillshot`. range 660, speed 900, radius 22. magic dmg 160 +20/rank (160 -> 260), scaleAp 0.72, slowPct 0.25, slowDur 1.2. cd 6, cdLv -0.3 (-> 4.5); mana 45, manaLv 4.

**S2 Sand Veil** - `zone` + `linger` with `conceal` **(new)**. range 500, radius 180, delay 0.2, one pulse: magic dmg 115 +15/rank (115 -> 190), scaleAp 0.55. linger: dur 4, conceal allied heroes inside (bush rules: hidden from enemies beyond 250, revealed 1.6 s on dealing damage), enemySlowPct 0.30; an enemy entering counts as a Dry Mouth skill hit once per cast. cd 11, cdLv -0.5 (-> 8.5); mana 55, manaLv 4.

**Ult Burial** - `zone` + `linger` with `ramp` **(new)**. range 560, radius 220, delay 0.4, no initial damage. linger dur 3: enemy slow ramps linearly 30% -> 60% over the 3 s; entering counts as a Dry Mouth hit. At the end everyone still inside takes magic dmg 260/340/420, scaleAp 1.0 and is rooted 1.2 s. cd 42/37/32; mana 105/125/145.

**Counterplay.** The veil is a visible sand patch: skills into it still hit. Burial is a 3 s telegraph; walk out before the slow reaches 60%. Ashara has no mobility and 500 HP; Purify clears the root.

**Bot hint.** Cast Sand Veil on the allied group when an enemy hero approaches within 600, or on herself when a melee enemy is within 300; Glass Needle at max range; Burial under 2+ enemy heroes who are attacking (not retreating) or on a hero already slowed.

### Hexa (Mage, magic, difficulty 3)
**Identity.** Drain and attrition mage. Rots targets with stacking Blight, latches a thread that feeds her health, then spreads the rot. Lowest upfront burst; highest total damage in a long fight; the only mage who heals herself.

**Signature mechanic.** Drain tether (`tether`, hostile, drain payload): a link to one hero that heals Hexa per tick and bursts + spreads Blight on completion. Only self-healing tether.

**Resource.** Mana. mp 315, mpLv 36.

**Base stats.** hp 488 (+61), atk 43 (+3.7), armor 9 (+1.8), mr 15 (+2.3), range 345, atkSpd 0.84, speed 240.

**Passive: Blight** (`blight`, extended). Basics and skill hits apply a rot dealing 45 (+30% MP) magic over 3 s; reapplying stacks to 2. Hexa heals 12% of Blight damage dealt to heroes.

**S1 Hex Bolt** - `skillshot`. range 690, speed 820, radius 24. magic dmg 140 +17/rank (140 -> 225), scaleAp 0.7. cd 6, cdLv -0.3; mana 45, manaLv 4.

**S2 Leech Thread** - `tether` **(new)**, hostile. Target: nearest visible enemy hero within 520 in a 60-degree aim cone (fallback nearest). dur 3.0, breakRange 620, 5 ticks at 0.6 s of 40 +6/rank (+25% MP) (200 -> 350 +125% MP total), slowPct 0.15 while linked; Hexa heals 40% of each tick. Breaks on distance, death, or Hexa stunned/airborne/suppressed/taunted; Purify on the target removes it. Completion payoff: 120 +16/rank (+50% MP) magic, slowPct 0.40 for 1.5 s, 2 Blight stacks to every enemy within 200 of the target. No root. cd 13, cdLv -0.5 (-> 10.5); mana 70, manaLv 5.

**Ult Black Mass** - `zone`. range 600, radius 240, delay 0.5, ticks 4, interval 0.5. magic dmg 80/105/130 per tick, scaleAp 0.35 per tick (320/420/520 +140% MP). Each tick applies Blight. cd 40/35/30; mana 110/130/150.

**Counterplay.** The thread is a visible line: walk past 620 or dash and it snaps with no payoff; stun her to cut it. Blight caps at 2 stacks. 240 speed, no escape, no hard CC: any stun on a dive ends her.

**Bot hint.** Leech Thread the closest enemy hero, then walk away keeping 400-580 for 3 s; Hex Bolt the tethered target; Black Mass on the completion burst or on 2+ heroes; retreat to heal on Blight ticks below 40% HP.

---

## Tanks

### Grom (Tank, physical, difficulty 1)
**Identity.** Hard-engage initiator. Walks into the enemy team, gets tougher the more heroes surround him, and wins fights by dragging the whole enemy team onto his allies.

**Signature mechanic.** Channelled ultimate (`channel`) with an interrupt window: Earthsplitter locks Grom for 0.9 s and any stun/silence/airborne/suppress/taunt cancels it. Only channelled skill.

**Resource.** Mana. mp 220, mpLv 24.

**Base stats.** hp 760 (+105), atk 56 (+6.0), armor 22 (+3.6), mr 18 (+2.8), range 95, atkSpd 0.85, speed 258.

**Passive: Bulwark** (`bulwark`, retuned). +5 armor and +5 MR per enemy hero within 420 (max +25). Below 40% HP: shield 12% max HP for 4 s, 35 s cd.

**S1 Shockwave** - `nova`. radius 240. physical dmg 120 +16/rank (120 -> 200), scaleAd 0.6, slowPct 0.40, slowDur 1.5. cd 7; mana 45.

**S2 Bull Charge** - `dash`, `stopOnHero: true`. dist 420, speed 950. physical dmg 110 +14/rank, scaleAd 0.6, stun 0.7, knockback 90 (tweened slide, wallDmg 0). cd 13; mana 60.

**Ult Earthsplitter** - `channel` **(new)** 0.9 s -> `nova` payload. radius 320, physical dmg 280/320/360, scaleAd 0.9, knockback -140 (tween toward Grom over 0.3 s), airborne 0.9. Interrupt: mana kept, cd set to 50%. Slows and roots do not interrupt. cd 46/42/38; mana 110.

**Counterplay.** The 0.9 s channel is a visible telegraph: any stun/silence/airborne wastes the ult. Bull Charge is a straight line; sidestep and he has committed 420 units. Away from enemy heroes Bulwark gives nothing. Purify refuses the pull.

**Bot hint.** Walk toward the enemy backline; Bull Charge the lowest-HP ranged hero within 420, Shockwave on landing; start Earthsplitter only when 2+ enemy heroes are within 320 and no visible enemy stun is off cooldown; never channel below 25% HP.

### Bastion (Tank, physical, difficulty 2)
**Identity.** Anti-ranged peel guardian. Stands in front of his carries: a raised gate eats enemy skillshots and arrows, his passive keeps shields ticking, and his ult shoves the enemy out of his ring. The mirror of Grom.

**Signature mechanic.** Projectile-blocking barrier (`barrier`): Gatehouse destroys every enemy projectile that crosses it for 3 s. Only projectile denial in the roster.

**Resource.** Mana. mp 240, mpLv 26.

**Base stats.** hp 740 (+100), atk 52 (+5.4), armor 24 (+3.8), mr 17 (+2.6), range 88, atkSpd 0.80, speed 248.

**Passive: Rampart** (`rampart`, unchanged). Every 8 s allied heroes within 420 (incl. Bastion) gain a shield of 8% of Bastion's max HP for 3 s.

**S1 Portcullis** - `nova`. radius 230. physical dmg 110 +14/rank, scaleAd 0.45, stun 0.6. cd 8; mana 50.

**S2 Gatehouse** - `barrier` **(new)**. Segment length 260 centred 90 in front of Bastion, perpendicular to aim, fixed in place, duration 3.0. Deletes enemy skillshot projectiles and ranged basic-attack projectiles crossing it; units, dashes, novas, zones, melee unaffected; no HP. cd 16; mana 70.

**Ult Hold the Line** - `nova`. radius 320. physical dmg 200/228/256, scaleAd 0.5, knockback 70 (tween outward), slowPct 0.50, slowDur 1.5. cd 40/36/32; mana 105.

**Counterplay.** Gatehouse stops only projectiles: dashes, blinks, novas and zones go through. The gate is fixed and 260 wide: walk around it. Portcullis needs melee range. His ult pushes, it does not lock; he has no dash.

**Bot hint.** Stay within 300 of the lowest-HP allied hero; Gatehouse when an enemy ranged hero is attacking or aiming at that ally within 700; Portcullis when an enemy hero is within 230 of that ally; Hold the Line when 2+ enemy heroes are within 320 of an ally under 50%.

### Marrow (Tank, magic, difficulty 3)
**Identity.** HP-fuelled sustain bruiser. No mana bar: every cast costs a slice of his maximum health and every cast heals the team or banks toward a bigger Catacomb. He wants a long, grinding fight.

**Signature mechanic.** Resourceless HP-cost casting (`resource: 'hp'`, `hpCost` as a fraction of max HP). Only hero whose whole kit costs health. Secondary: the only max-HP-shaped damage (Catacomb banks HP he has spent).

**Resource.** HP. mp 0, mpLv 0, no mana bar. Costs: S1 6%, S2 8%, ult 10% of max HP, deducted after the effect, never lethal (capped at current HP - 1). Mana items and blue rune give him nothing.

**Base stats.** hp 750 (+102), atk 50 (+5.2), armor 19 (+3.0), mr 20 (+3.0), range 85, atkSpd 0.78, speed 244.

**Passive: Ossify** (`ossify`, unchanged). Up to 25% damage reduction scaling linearly from 0% at 100% HP to 25% at or below 25% HP. Not true damage.

**S1 Ribcage** - `nova`. radius 220. magic dmg 120 +15/rank, scaleAd 0.55, slowPct 0.35, slowDur 1.5. cd 6; hpCost 0.06.

**S2 Splint** - `heal`. heal 100 +16/rank (100 -> 180), scaleAp 0.35, radius 300, no shieldPct. cd 12; hpCost 0.08. A transfer to the team; net zero on Marrow at full HP.

**Ult Catacomb** - `zone` + `bank` **(new)**. range 480, radius 240, delay 0.7. magic dmg 240/275/310, scaleAd 0.7, airborne 0.8, plus bonus magic damage equal to 100% of the HP Marrow paid for skills in the last 6 s, capped at 20% of his max HP. cd 42/38/34; hpCost 0.10.

**Counterplay.** He pays for everything in health: poke him and each cast digs deeper. Ossify ignores true and %-HP damage. No dash, no stun, 0.7 s telegraph on his only hard CC. Burst him from 60% to 0 in one window.

**Bot hint.** Fight only above 50% HP or while an ally is within 300; Splint when an ally within 300 is under 60%; never Ribcage below 20% HP; Catacomb on 2+ enemies within 240, preferably within 6 s of two other casts.

### Anchor (Tank, physical, difficulty 2)
**Identity.** Anti-mobility lockdown tank. He never moves anyone; he stops them moving. A tether that snaps or roots, a self-anchoring stance that no displacement can move, and a huge slow field.

**Signature mechanic.** Root-on-completion enemy tether (`tether`, hostile): Hawser ties a hero to Anchor; leave and it snaps, stay and you are rooted. Secondary: Weigh Anchor is the roster's only control-immune state on a skill.

**Resource.** Mana. mp 220, mpLv 24.

**Base stats.** hp 730 (+98), atk 54 (+5.8), armor 23 (+3.8), mr 16 (+2.9), range 102, atkSpd 0.84, speed 241.

**Passive: Deadweight** (`deadweight`, unchanged). Skill hits on slowed, rooted, stunned or airborne enemies deal +15%.

**S1 Hawser** - `skillshot` + `tether`. range 580, speed 760, radius 26, non-pierce (minions block; non-heroes take the hit, no tether). Hit: physical dmg 90 +12/rank, scaleAd 0.4. Tether: dur 2.0, breakRange 560, slow ramps 25% -> 50%. Breaks on distance, death, Anchor hard-CC'd, or Purify on the target. Completion: physical dmg 130 +16/rank, scaleAd 0.5, immobilize 1.3. One tether at a time. cd 12; mana 60.

**S2 Weigh Anchor** - `selfState` **(new)** with `ccImmune`. Anchor roots himself for 1.5 s: immune to displacement, slows and pulls (stuns and airborne still apply), +20 armor and +20 MR, and a live Hawser target's slow is doubled (cap 80%). Can be cancelled by recasting. cd 11; mana 50.

**Ult Harbour** - `nova`. radius 320. physical dmg 230/262/294, scaleAd 0.55, slowPct 0.55, slowDur 2.0. cd 40/36/32; mana 105.

**Counterplay.** Hawser is minion-blockable and needs you within 560 for 2 s: dash, Flicker or walk away. Purify cuts the tether; stunning Anchor cuts it too. He has no dash at all; ranged heroes at 600 are never tied. Harbour is a slow: mobility works inside it.

**Bot hint.** Target the hero with the most dash skills; Hawser only when no minion is on the line and the target is within 500; while a tether is live walk toward the target, and Weigh Anchor when the target is slowed inside 400; Harbour when 2+ heroes are within 320 or a tethered target is about to escape.

---

## Assassins

### Nyx (Assassin, physical, difficulty 3)
**Identity.** The execute assassin. One long-cooldown, armor-piercing blow that grows the lower the target is. She vanishes to reach her spot, and does nothing to a full-HP frontline.

**Signature mechanic.** Missing-HP execute (`missingPct`): Deathmark adds a share of the target's missing HP. Only target-missing-HP scaling. Secondary: Shade Step is the roster's only untargetable state.

**Resource.** Mana. mp 230, mpLv 25.

**Base stats.** hp 540 (+71), atk 68 (+8.0), armor 13 (+2.2), mr 11 (+1.7), range 95, atkSpd 1.15, speed 275.

**Passive: Backstab** (`backstab`, unchanged). Hits on a target facing away deal 18% bonus true damage; hero kills grant +25% move speed 3 s.

**S1 Shadow Strike** - `dash`. dist 340, speed 1100. physical dmg 130 +16/rank (130 -> 210), scaleAd 0.7. cd 8; mana 45.

**S2 Shade Step** - `selfState` with `untargetable` **(new)**. 0.8 s: removed from targeting and projectile hit tests, zones and novas skip her, +30% move speed (speedPct), cannot attack or cast; existing dots keep ticking. cd 10.5; mana 40.

**Ult Deathmark** - `blinkstrike`. range 500. physical dmg 260/300/340, scaleAd 1.0, missingPct 0.20, missingPctLv 0.05 (20/25/30% of missing HP), missingCap 400 vs non-heroes, physPenPct 0.22. No CC. cd 42/38/34; mana 100.

**Counterplay.** Deathmark is worthless on full HP: heal or shield the carry (shields absorb true damage). She appears on the far side of the target: a stun there ends the combo. Shade Step is 0.8 s; wait it out. 42 s ult.

**Bot hint.** Hold Deathmark until a hero within 500 is below 50%; Shadow Strike through the target to land behind it, Shade Step through a skillshot or to close the last 200, ult to finish; never ult above 70%.

### Wraith (Assassin, physical, difficulty 2)
**Identity.** The energy skirmisher. A 100-point pool that refills in seconds, cooldowns under 6 s, low per-hit damage that adds up because she casts three times as often as anyone. Dips in and out; throws spectral blades while kiting.

**Signature mechanic.** Fast energy (`resource: 'energy'`, fast parameters): flat pool, 8/s regen, item-immune. Secondary: Phantom Blades is the only skill that changes basic-attack range.

**Resource.** Energy 100 at every level, regen 8/s, +10 on an empowered basic vs a hero. Costs S1 25, S2 30, ult 40.

**Base stats.** hp 545 (+70), atk 66 (+7.6), armor 13 (+2.2), mr 10 (+1.7), range 90, atkSpd 1.18, speed 280.

**Passive: Afterimage** (`afterimage`, extended). After any skill hits, the next basic within 3 s deals +30% and, on a hero, restores 10 energy.

**S1 Phase Cut** - `dash`. dist 360, speed 1200. physical dmg 100 +14/rank (100 -> 170), scaleAd 0.6. cd 5; energy 25.

**S2 Phantom Blades** - `basicRange` **(new)**. Her next 3 basic attacks within 4 s are 300-range thrown blades (projectile basics, full basic rules) dealing +20 +3/rank (+15% AD) bonus physical damage each. cd 8; energy 30.

**Ult Haunt** - `blinkstrike`. range 460. physical dmg 240/280/320, scaleAd 0.85, silence 0.5. cd 30/27/24; energy 40.

**Counterplay.** Every hit is small: armor and HP blunt her. Phase Cut is a fixed line. A stun between casts leaves her at half energy; below ~25 energy (visible) she cannot dash out, so collapse then.

**Bot hint.** Phase Cut only when energy >= 55; weave a basic after every skill hit; Phantom Blades when a target is between 150 and 300 away; Haunt the lowest-HP hero within 460; retreat with Phase Cut when energy < 25 or HP < 35%.

### Sable (Assassin, magic, difficulty 3)
**Identity.** The %-HP poison assassin. Her darts ignore minions and find the hero behind them, her venom eats a share of the target's health every second, and her Kiss bites a tenth of it at once. Tanks fear her; she has no hard CC.

**Signature mechanic.** %-max-HP damage on skills (`pctMaxHp`) and the only hero-only projectile (`heroOnly`). No other skill reads target max HP or passes through minions.

**Resource.** Mana. mp 240, mpLv 26.

**Base stats.** hp 508 (+67), atk 64 (+7.0), armor 12 (+2.0), mr 12 (+1.8), range 92, atkSpd 1.12, speed 272.

**Passive: Venom Bank** (`venom`, extended). Hero kills grant 18% spell vamp 5 s, assists 8% 3 s. Basics on a Venomed hero refresh the Venom timer (once per stack lifetime).

**S1 Needle** - `skillshot`, `heroOnly: true` **(new)**. range 560, speed 1000, radius 20; passes through minions and monsters, hits the first HERO. magic dmg 105 +14/rank (105 -> 175), scaleAp 0.5. applyMark venom (max 3, dur 4) whose dot ticks 1.5% (+0.01% per MP) of target max HP per second per stack as magic (cap 40/s per stack vs non-heroes). cd 5, cdLv -0.2; mana 40.

**S2 Lunge** - `dash`. dist 300, speed 1100. magic dmg 125 +16/rank (125 -> 205), scaleAp 0.6; applyMark venom x1 to each enemy hit. cd 9, cdLv -0.3; mana 45.

**Ult Kiss** - `blinkstrike`. range 460. magic dmg 220/260/300, scaleAp 0.7, plus pctMaxHp 0.09/0.11/0.13 of the target's max HP (cap 500 vs non-heroes), slowPct 0.50, slowDur 1.5, refreshes all Venom stacks to full duration (no consume). cd 38/34/30; mana 100.

**Counterplay.** Venom pips are visible: back off at 2 stacks and let them expire. Needle cannot be body-blocked but it is narrow and slow. No hard CC: Purify or a speed buff walks out of the slow. Lowest AD assassin: MR and early aggression shut her down.

**Bot hint.** Needle the chosen hero at max range until 2+ stacks, Lunge for the third and Kiss immediately; prefer the enemy with the highest max HP when two are equally reachable; keep Lunge for the exit if the target already has 3.

### Rook (Assassin, physical, difficulty 3)
**Identity.** The dive-and-return striker. Airborne on both gap-closers, and an ult that can be recast to fly back to where she took off. In, slam, one basic, out.

**Signature mechanic.** Recast return (`recast` + `dashToPoint`): Skyfall stores the takeoff point and can be recast within 3 s to leap back. Only recast skill.

**Resource.** Mana. mp 200, mpLv 22.

**Base stats.** hp 540 (+72), atk 64 (+7.0), armor 13 (+2.2), mr 10 (+1.6), range 98, atkSpd 1.05, speed 278.

**Passive: Stoop** (`stoop`, reworked). Landing Dive or Skyfall on a hero grants +40 move speed 2 s and makes her next basic within 3 s deal +50% total AD bonus physical damage.

**S1 Dive** - `dash`, `stopOnHero: true`. dist 380, speed 1150. physical dmg 120 +15/rank (120 -> 195), scaleAd 0.6, airborne 0.5. cd 10; mana 45.

**S2 Talon Fan** - `nova`. radius 210. physical dmg 115 +14/rank (115 -> 185), scaleAd 0.6. No CC. cd 7; mana 40.

**Ult Skyfall** - `blinkstrike` + `recast` **(new)**. range 540. physical dmg 250/290/330, scaleAd 0.9, airborne 0.6. Stores the takeoff point; recast within 3 s = Return: dash-to-point at 1300 u/s, no damage, unhookable, uses the Flicker wall back-off so it cannot cross terrain. cd 40/36/32 starting on the first cast; mana 105; Return costs 0.

**Counterplay.** Her return point is known: stand on it. CC on her landing traps her inside the 3 s window. Both gap-closers are fixed lines with no penetration; with 508 mana she runs dry after two rotations.

**Bot hint.** Dive the squishiest hero only when an ally is within 400; Skyfall the marksman or mage, Talon Fan, one basic, then Return if HP < 45% or 2+ enemy heroes are within 300, else stay and Dive the next target.

---

## Fighters

### Torren (Fighter, physical, difficulty 1)
**Identity.** The Reaver: a resourceless sustain brawler who hits harder the more of his own blood he has lost and finishes with a true-damage cleave. Walk in, spin, leap, cleave.

**Signature mechanic.** Own-missing-HP scaling (`selfMissingPct`): Whirling Axe and Reaver's Toll grow with Torren's lost health. Only self-HP-scaled damage. Secondary: the only pure cooldown-gated hero; War Leap is the only leap-to-point.

**Resource.** None. mp 0, every skill mana 0, no bar.

**Base stats.** hp 650 (+88), atk 60 (+6.8), armor 19 (+3.0), mr 14 (+2.2), range 95, atkSpd 1.02, speed 262.

**Passive: Bloodthirst** (`bloodthirst`, retuned). 8% lifesteal plus 1% per 3% missing HP, capped at 35% at or below 20% HP. Basics only.

**S1 Whirling Axe** - `nova`. radius 220. physical dmg 110 +13/rank (110 -> 175), scaleAd 0.55, selfMissingBonus: +1% damage per 2% of Torren's missing HP (max +30%). cd 8, cdLv -0.3 (-> 6.5); mana 0.

**S2 War Leap** - `dash` with `dashToPoint: true` **(new)**. Leap to the aimed point up to 340 away (joystick pull shortens it), speed 950, no path damage. endNova: radius 180, physical dmg 110 +13/rank, scaleAd 0.6, slowPct 0.30, slowDur 1.2. cd 11, cdLv -0.3 (-> 9.5); mana 0.

**Ult Reaver's Toll** - `nova`. radius 260. true dmg 135/175/215, scaleAd 0.7, plus selfMissingPct 0.12/0.16/0.20 of Torren's own missing HP (cap 50% of his max HP), computed once at cast. cd 42/38/34; mana 0.

**Counterplay.** Kite him: no ranged tool, one leap on 11 s, no CC. Burst him at high HP before Bloodthirst and the missing-HP bonus ramp, or finish him instead of letting him sit at 30%. Shields eat the true damage.

**Bot hint.** Fight in extended melee; War Leap onto the lowest-HP-percent enemy hero within 340; Reaver's Toll when own HP is below 50% and a hero is inside 260, or when two heroes are inside 260.

### Karn (Fighter, physical, difficulty 3)
**Identity.** Chained Warden: an armoured control fighter who picks one target out with a hook and then chains the whole fight to himself. Nobody leaves.

**Signature mechanic.** Hook drag with suppression (Karn-only `hook: true`) plus Gaol, a multi-target tether that punishes leaving rather than staying (inverse of Anchor).

**Resource.** Mana. mp 240, mpLv 26.

**Base stats.** hp 700 (+96), atk 58 (+6.4), armor 21 (+3.0), mr 16 (+2.5), range 100, atkSpd 0.90, speed 255.

**Passive: Ironclad** (`ironclad`, unchanged). Basics cut 0.5 s from every skill cooldown; damage from an enemy hero grants 4 armor 4 s, stacking to 5.

**S1 Chain Hook** - `skillshot`, non-pierce, `hook: true`. range 640, speed 850, radius 26. physical dmg 110 +14/rank (110 -> 180), scaleAd 0.5, suppress 0.6 (drag at 1100 u/s up to 0.6 s). Writes `marks.hookedT` on the victim. cd 13, cdLv -0.5 (-> 10.5); mana 80, manaLv 5.

**S2 Iron Slam** - `nova`. radius 240. physical dmg 140 +17/rank (140 -> 225), scaleAd 0.7, slowPct 0.40, slowDur 1.2; +50% damage against a target hooked within the last 2 s **(new field `bonusVsMark`)**. cd 8, cdLv -0.4 (-> 6); mana 50.

**Ult Gaol** - `tether` **(new)**, multi-target. Every enemy hero within 320 is chained to Karn for 2.5 s. Chains have breakRange 450: a hero that crosses it snaps the chain, taking physical dmg 260/340/420, scaleAd 1.0 and stun 1.0. Staying inside costs nothing; chains end quietly at 2.5 s or if Karn dies. Chains are not removed by hard CC on Karn (they are anchored, not channelled). cd 44/40/36; mana 120.

**Counterplay.** Keep a minion between you and him: the hook dies on the first body, and it is sidesteppable at range. 255 speed, no dash. Gaol punishes leaving: stand your ground for 2.5 s or Purify the chain; do not run through it.

**Bot hint.** Hold Chain Hook until an enemy hero is unblocked and isolated (no second enemy hero within 400), preferring marksmen and mages; Iron Slam immediately after a hook; Gaol when 2+ enemy heroes are within 300 and at least one is retreating.

### Brass (Fighter, physical, difficulty 1)
**Identity.** Line-Holder: a buckler-and-shoulder protector who does the least damage of any fighter and forces enemies to hit him instead of his carry. The roster's only taunt.

**Signature mechanic.** Taunt CC (`taunt`): victims must walk to Brass and basic-attack him.

**Resource.** Mana. mp 210, mpLv 22.

**Base stats.** hp 720 (+98), atk 55 (+6.0), armor 22 (+3.3), mr 16 (+2.5), range 105, atkSpd 0.95, speed 252.

**Passive: Rimguard** (`rimguard`, unchanged). 10% less damage from enemy heroes.

**S1 Buckler** - `nova` with `selfShieldPct` **(new)**. radius 200. physical dmg 120 +14/rank (120 -> 190), scaleAd 0.55, no slow; Brass gains a shield of 6% max HP for 3 s. cd 7, cdLv -0.3; mana 45, manaLv 3.

**S2 Shoulder** - `dash`, `stopOnHero: true`. dist 340, speed 900. physical dmg 100 +12/rank, scaleAd 0.5, stun 0.6. cd 12, cdLv -0.5; mana 60.

**Ult Call to the Rim** - `nova`. radius 260. physical dmg 220/290/360, scaleAd 0.7, taunt 0.8/1.0/1.2 (tenacity shortens, Purify refuses, ends if Brass dies), plus armorAdd 30 / mrAdd 30 for 4 s on Brass. cd 44/40/36; mana 120.

**Counterplay.** Purify beats the taunt outright; otherwise stay outside 260. His only gap-closer stops on the first hero. Lowest fighter damage: kill him last.

**Bot hint.** Stand between the enemy and the allied carry; Shoulder any enemy hero attacking an allied hero within 340; Call to the Rim when 2+ enemy heroes are within 240 and an ally is within 400.

### Omen (Fighter, physical, difficulty 2)
**Identity.** Twin-blade Duelist: a fast, low-durability fighter-assassin who chains kills; every takedown resets his step and he flows to the next target.

**Signature mechanic.** Kill-reset mobility (`resetOnKill` / `resetOnAssist`). Only conditional cooldown reset.

**Resource.** Mana. mp 200, mpLv 22.

**Base stats.** hp 640 (+88), atk 66 (+7.6), armor 16 (+2.6), mr 13 (+2.0), range 108, atkSpd 1.06, speed 266.

**Passive: Cadence** (`cadence`, retuned). Basics grant +5% AS 3 s, stacking to 8; a Crosscut that hits a hero grants 2 stacks.

**S1 Crosscut** - `nova`, `canCrit: true` **(new)**. radius 190. physical dmg 120 +14/rank (120 -> 190), scaleAd 0.68; can critically strike using his crit chance. cd 6, cdLv -0.3 (-> 4.5); mana 40, manaLv 3.

**S2 Pass** - `dash`. dist 300, speed 1050. physical dmg 90 +11/rank, scaleAd 0.6, no CC. resetOnKill 1.0, resetOnAssist 0.5. cd 10, cdLv -0.4 (-> 8); mana 45.

**Ult Duelist's End** - `dash`, `stopOnHero: true`. dist 420, speed 1200. physical dmg 220/275/330, scaleAd 1.1, stun 0.8. resetOnKill 0.5 (kill only). cd 38/34/30; mana 120.

**Counterplay.** Do not feed the reset. Any stun or root mid-chain kills him (assassin HP, no sustain). His ult stops on the first hero: a tank steps in front.

**Bot hint.** Engage when an enemy hero within 420 is below 60% or an ally has engaged; after any kill or assist Pass onto the next-lowest enemy hero within 300; retreat when Pass is down and HP < 40%.

### Tide (Fighter, magic, difficulty 2)
**Identity.** Breaker: a magic bruiser who fights with the map. Everything he does shoves, and anyone shoved into a wall is slammed and stunned. Near terrain the best CC fighter; in the open a pusher with no stun.

**Signature mechanic.** Terrain-collision displacement (`wallDmg` / `wallStun` on the shared displacement tween): a victim that hits a wall stops, takes bonus damage and is stunned. Only wall-collision effects.

**Resource.** Mana. mp 240, mpLv 26.

**Base stats.** hp 670 (+92), atk 56 (+6.0), armor 17 (+2.8), mr 17 (+2.6), range 112, atkSpd 0.98, speed 256.

**Passive: Undertow** (`undertow`, unchanged). Basics slow 12% for 1 s; slowed heroes take +8% magic damage from Tide.

**S1 Breaker** - `skillshot`, `pierce: true`. range 560, speed 850, radius 32. magic dmg 145 +18/rank (145 -> 235), scaleAp 0.7, knockback 120 along the wave direction (0.25 s slide); wallDmg 80 (+30% MP), wallStun 0.6. cd 7.5, cdLv -0.4 (-> 5.5); mana 55, manaLv 4.

**S2 Surge** - `dash`. dist 320, speed 950. magic dmg 105 +13/rank, scaleAp 0.45, slowPct 0.30, slowDur 1.2. cd 10, cdLv -0.4; mana 55.

**Ult High Water** - `zone`. range 480, radius 250, delay 0.5. magic dmg 270/350/430, scaleAp 0.8, knockback 130 radial from the zone centre; wallDmg 120 (+40% MP), wallStun 0.7; victims that hit no wall are airborne 0.5. cd 40/36/32; mana 120.

**Counterplay.** Fight in open ground: every stun needs a wall within 120-130 behind you. The wave is 850-speed; High Water has a 0.5 s delay. Purify refuses the slide. No sustain, one 320 dash.

**Bot hint.** Prefer Breaker / High Water when the push vector through the target, extended 130 units, hits a wall tile; otherwise shove the enemy hero attacking an allied carry; Surge to the open side of a target standing next to a wall.

### Cinder (Fighter, magic, difficulty 2)
**Identity.** Coal-Fist: a relentless magic brawler who burns what she touches and runs on Heat instead of mana. At full Heat her next skill overheats into a bigger, controlling version.

**Signature mechanic.** Heat gauge with overheat (`resource: 'heat'`, `overheat` overrides). Only rage-style resource.

**Resource.** Heat 0-100, orange bar. Gains: +8 per basic hit on a hero (+4 non-hero), +8 per skill hit on a hero (+4), +2/s while an enemy hero is burning. Decay 5/s after 4 s without dealing or taking damage. At 100 the next cast is Overheated and Heat resets to 0. Skills cost nothing.

**Base stats.** hp 660 (+88), atk 58 (+6.4), armor 16 (+2.6), mr 15 (+2.3), range 118, atkSpd 1.06, speed 250.

**Passive: Live Coal** (`livecoal`, retuned). Basics and skills apply a 3 s burn of 25 (+20% MP) magic; refreshes. During Furnace the burn is 50 (+40% MP).

**S1 Haymaker** - `nova`. radius 200. magic dmg 152 +18/rank (152 -> 242), scaleAp 0.55. cd 7, cdLv -0.4 (-> 5). overheat: radius 260, dmgMult 1.4, slowPct 0.40, slowDur 1.5.

**S2 Coal Dash** - `dash` with `endNova`. dist 320, speed 980, no path damage. endNova: radius 170, magic dmg 115 +14/rank, scaleAp 0.4, no CC. cd 10, cdLv -0.4 (-> 8). overheat: endNova radius 220, stun 0.5.

**Ult Furnace** - `buff`. dur 6: atkMult 1.25, spdAdd 50, hotPct 0.18, burn upgraded. cd 42/38/34. overheat: dur 9, tenacityAdd 0.35.

**Counterplay.** All melee and she needs hits to gain Heat: poke and kite deny both. The gauge is visible; at 100 back off for one cast. Her only stun is the overheated dash.

**Bot hint.** Stay in extended melee; at 100 Heat cast Haymaker if 2+ enemy heroes are within 260, else Coal Dash onto the nearest enemy marksman or mage within 320; Furnace once HP drops below 60% during a fight.

---

## Supports

### Sylva (Support, magic, difficulty 2)
**Identity.** The lifeline healer. Picks one ally and keeps them alive through a visible vine, then opens the whole canopy in a team fight. No hard CC, no shield; her value is choosing the right ally.

**Signature mechanic.** Ally link (`tether`, friendly payload, `allyTarget`): the only single-ally targeted skill and the only ally tether.

**Resource.** Mana. mp 330, mpLv 36.

**Base stats.** hp 545 (+70), atk 48 (+4.4), armor 12 (+2.4), mr 15 (+2.3), range 330, atkSpd 0.95, speed 242.

**Passive: Verdant Gift** (`verdant`, unchanged). Healing an ally with a cast grants them +60 move speed 2 s and restores 12 mana to Sylva (link ticks carry noPassive).

**S1 Thorn Volley** - `skillshot`. range 680, speed 850, radius 26. magic dmg 130 +16/rank (130 -> 210), scaleAp 0.6, slowPct 0.30, slowDur 1.5. cd 7, cdLv -0.4; mana 45, manaLv 4.

**S2 Vine Link** - `tether` friendly with `allyTarget`. Target: allied hero (not self) nearest the aim point within 520, fallback lowest-HP ally; no target = no cost. Instant heal 100 +16/rank (100 -> 180), scaleAp 0.55. Link dur 4, 8 ticks of 15 +2/rank (+12% MP) (120 -> 200 +96% MP), target +40 speed, Sylva +12 armor/MR while linked, breakRange 650. Recasting replaces. cd 12, cdLv -0.6 (-> 9); mana 70, manaLv 5.

**Ult Canopy** - `heal` + friendly `tether` to all. Instant heal 140/190/240 (+50% MP) to allied heroes within 420; then every allied hero within 420 (incl. self) is linked 6 s: 12 ticks of 12/17/22 (+8% MP) (144/204/264 +96% MP), +40 speed, breakRange 550. A Canopy link does not stack with a Vine Link on the same ally (stronger tick wins). cd 58/52/46; mana 120/150/180.

**Counterplay.** Kill or displace the linked target, or knock Sylva 650 away to snap the vine. No escape, no CC, no shield: dive her first. Anti-heal shrinks every tick; Canopy is a 6 s window, not a burst.

**Bot hint.** Stay 350-500 behind the nearest ally; Vine Link the ally that took damage most recently (prefer lowest HP); Thorn Volley enemies chasing an ally; Canopy when 2+ allied heroes within 420 are below 55%.

### Bell (Support, magic, difficulty 2)
**Identity.** The tempo caller. Makes the team hit harder and move faster the moment a fight starts, then silences the enemy casters. Heals nothing.

**Signature mechanic.** Ally offensive buff (`allybuff`): the only skill that raises allies' attack speed.

**Resource.** Mana. mp 300, mpLv 34.

**Base stats.** hp 560 (+74), atk 46 (+4.2), armor 13 (+2.4), mr 15 (+2.3), range 300, atkSpd 0.95, speed 250.

**Passive: Peal** (`peal`, unchanged). Every 6 s allied heroes within 420 gain +50 move speed 2 s.

**S1 Chime** - `skillshot`, `pierce: true`. range 620, speed 800, radius 28. magic dmg 115 +14/rank (115 -> 185), scaleAp 0.5. No CC. cd 6, cdLv -0.3; mana 40, manaLv 4.

**S2 Carillon** - `allybuff` **(new)**. radius 380 (incl. self). asAdd 0.20 +0.02/rank (0.20 -> 0.30, additive; takes the max against a dash asMult or Storm Volley rather than adding), spdAdd 35, dur 3.5. cd 14, cdLv -0.6 (-> 11); mana 65, manaLv 5.

**Ult Knell** - `zone`. range 540, radius 220, delay 0.5, ticks 1. magic dmg 200/260/320, scaleAp 0.6, silence 1.2, slowPct 0.40, slowDur 1.5. cd 46/40/34; mana 100/125/150.

**Counterplay.** Carillon is 3.5 s and visible on every buffed ally: disengage or CC the buffed carry. Knell has a 0.5 s telegraph; silence does not stop basics. No heal, no shield, no escape.

**Bot hint.** Shadow the allied marksman; Chime enemies within 620 on cooldown; Carillon when an allied hero within 380 is basic-attacking an enemy hero; Knell onto 2+ enemy heroes or an enemy mage/support within 540.

### Wick (Support, magic, difficulty 1)
**Identity.** The lantern guardian. Plant a lantern, stand next to it, shield whoever fights around it, and see everything that tries to hide from it. No CC, no mobility, the most durable support.

**Signature mechanic.** Lantern (`object`, pulse mode): a placed ally-serving object that pulses shields and grants the roster's only skill-based vision.

**Resource.** Mana. mp 310, mpLv 34.

**Base stats.** hp 575 (+76), atk 48 (+4.4), armor 15 (+2.7), mr 15 (+2.4), range 290, atkSpd 0.95, speed 244.

**Passive: Lampglass** (`lampglass`, unchanged). Whenever Wick heals an ally, that ally also gains a shield for 40% of the heal for 2.5 s.

**S1 Spark** - `skillshot`. range 640, speed 900, radius 22. magic dmg 135 +16/rank (135 -> 215), scaleAp 0.5, slowPct 0.25, slowDur 1.0. cd 6, cdLv -0.3; mana 40, manaLv 4.

**S2 Lantern** - `object` **(new)**. range 480, duration 5, tick 1.0. Each tick: allied heroes within 300 gain a lantern-tagged shield of 60 +9/rank (+25% MP) for 2 s (refreshes, does not stack). Enemy heroes within 300 are revealed for the whole 5 s (bush stealth and Sand Veil broken); Wick's basics on revealed enemies deal +15%. No slow. Untargetable, expires on owner death. cd 13, cdLv -0.6 (-> 10); mana 60, manaLv 4.

**Ult Warding Glow** - `heal`. heal 200/270/340 (+55% MP) to allied heroes within 320, shieldPct 0.08 (3 s), plus Lampglass. cd 44/39/34; mana 110/140/170.

**Counterplay.** The lantern is stationary: pull the fight 300 away or wait a pulse out. Wick's only CC is a 25% slow. Kill Wick and the lantern goes out.

**Bot hint.** Lantern under the allied frontliner when 2+ enemy heroes are within 500 of an ally, then stand within 250 of it; Spark on cooldown; Warding Glow when an ally within 320 drops below 45% or three allies are fighting in range.

### Pact (Support, magic, difficulty 3)
**Identity.** The blood liturgist. She lashes with mana, but her one true gift, Offering, is paid in her own health and given to a single ally. Her damage to heroes tithes back to whoever is lowest.

**Signature mechanic.** Single-target blood transfusion (`allyTarget` + `hpCost` on one skill): the only single-ally heal and the only skill whose output scales with the caster's own HP.

**Resource.** Mana for Let and Covenant (mp 280, mpLv 30); Offering costs 12% max HP and is refused below 25% HP.

**Base stats.** hp 600 (+80), atk 52 (+4.8), armor 14 (+2.6), mr 15 (+2.2), range 270, atkSpd 0.92, speed 246.

**Passive: Tithe** (`tithe`, unchanged). 15% of skill damage Pact deals to heroes heals the lowest-HP allied hero within 520 (incl. herself).

**S1 Let** - `skillshot`. range 600, speed 860, radius 24. magic dmg 140 +17/rank (140 -> 225), scaleAp 0.6. No CC. cd 6, cdLv -0.3; mana 45, manaLv 4.

**S2 Offering** - `heal` with `allyTarget` and `hpCost` **(new)**. Target: allied hero (not self) nearest the aim point within 520, fallback lowest HP; no target = no cost. Pact pays 12% of her max HP and the target is healed for 180% of the HP paid +20/rank (+45% MP) (level 1: ~130 +45% MP; level 15: ~378 +45% MP). cd 12, cdLv -0.6 (-> 9); hpCost 0.12.

**Ult Covenant** - `zone`. range 480, radius 200, delay 0.6, ticks 1. true dmg 190/250/310, scaleAp 0.4, immobilize 1.0, silence 1.0 (both purifiable). cd 50/44/38; mana 100/120/140.

**Counterplay.** Poke her below 25% and Offering is locked. Covenant has a 0.6 s telegraph and is purifiable. Anti-heal shrinks Tithe and Offering together. No mobility, no shield.

**Bot hint.** Offering the ally with the lowest HP within 520 when they are under 55% and Pact is above 40%; Let at enemy heroes when an ally within 520 is under 60%; Covenant on 2+ enemy heroes or on the single enemy about to kill an ally.

---

## New engine features required

Each entry: behaviour, fields, edge cases, users. Field names marked **(new)**. Existing code paths referenced: `castSkill` / `Hero.update` / `doNova` / `Projectile.skillshot` / `Zone` (entities.js), `resolveDamage` / `applySkillCC` / `CCState` / `PASSIVES` (combat.js), `botSkillUrgency` (main.js), HUD (ui.js).

### F1. Per-rank cooldown, cost and CC scaling
- Fields **(new)**: `cdLv` (per-rank delta, negative), `manaLv` (per-rank delta), and 3-element arrays for ult `cd`, `mana`/`energy`, and any CC key (`stun`, `taunt`, `frozen`...), `pctMaxHp`, `selfMissingPct`.
- Behaviour: `skillCd[i] = (cdAt(rank)) * (1 - cdr)` where `cdAt = Array.isArray(s.cd) ? s.cd[rank-1] : s.cd + (s.cdLv||0)*(rank-1)`; cost likewise; `applySkillCC` resolves array values by rank before applying. Helper `rankVal(s, key, rank)` used everywhere.
- Edge cases: rank 0 (unlearned) never casts; clamp cd to >= 1.0.
- Users: every hero.

### F2. Target-aware skill damage
- Behaviour: `skillDmg(s, rank, target)` optional third argument; nova, zone, dash, blinkstrike and cone loops call it per victim. Adds `consumeMark` bonus (F12), `missingPct` (F23), `pctMaxHp` (F22), `bonusVsMark` (Karn) and `selfMissingBonus` (Torren) before mitigation.
- Fields **(new)**: `bonusVsMark: {tag, within, mult}`, `selfMissingBonus: {perPct, per, max}`.
- Edge cases: caps vs non-heroes (`missingCap`, pctMaxHp cap); structures never receive %-HP or missing-HP terms.
- Users: Ignis, Sable, Nyx, Torren, Karn, Marrow (bank).

### F3. Hero resource framework
- Field **(new)** on the hero def: `resource: 'mana' | 'energy' | 'heat' | 'hp' | 'none'` (default mana).
- Behaviour: `castSkill` routes the cost check/deduction: mana -> `s.mana`; energy -> `s.energy`; heat -> free, may overheat (F5); hp -> `s.hpCost` (F6) or `s.mana` if present (Pact hybrid); none -> free. HUD draws the bar colour per type (blue/yellow/orange/red/hidden). Mana items, blue rune manaRegen, mage emblem mana burn and passive mana refunds are skipped for non-mana heroes.
- Users: Lumen, Wraith (energy), Cinder (heat), Marrow, Pact (hp), Torren (none).

### F4. Energy pool (two parameter sets)
- Fields **(new)** on the def: `energy: {max: 100, regen, perBasic, stillRegen?, stillDelay?}`.
- Behaviour: `maxMana` is a flat `energy.max` regardless of level/items; `Hero.update` adds `regen*dt`; onBasicHit adds `perBasic` (Lumen 20, Wraith 0; Wraith's +10 lives in Afterimage); Lumen: if no movement input for `stillDelay` (0.5 s) add `stillRegen` (30/s). Bots count "not pathing" as still.
- Edge cases: energy clamps 0-100; dash and forced movement count as moving.
- Users: Lumen (battery: regen 0), Wraith (fast: regen 8).

### F5. Heat gauge with overheat
- Fields **(new)**: def `heat: {gainBasicHero: 8, gainBasic: 4, gainSkillHero: 8, gainSkill: 4, burnPerSec: 2, decay: 5, decayDelay: 4}`; skill `overheat: {...}` override table (`radius`, `dmgMult`, `slowPct`, `slowDur`, `stun`, `dur`, `tenacityAdd`).
- Behaviour: gauge 0-100 stored as mp; gains in onBasicHit/onSkillHit (once per hit, dot ticks excluded) and `+burnPerSec*dt` while any enemy hero carries the hero's burn tag; decays after `decayDelay` seconds without dealing or taking damage. At cast with heat >= 100 the skill object is `Object.assign({}, s, s.overheat)` for that cast (`dmgMult` multiplies skillDmg) and heat = 0. HUD flashes at 100.
- Users: Cinder.

### F6. HP-cost casting
- Field **(new)**: `hpCost` (fraction of max HP); def-level `hpFloor` (Pact 0.25; Marrow 0 = never lethal, min 1 HP).
- Behaviour: skip the mana check when `hpCost` is set (Pact's other skills still use mana), run the effect, then `hp = max(1, hp - floor(maxHp*hpCost))`; refuse the cast if `hp/maxHp < hpFloor`. Counts as nothing else (no kill credit, no passives, does not break spawn protection, not a "damage taken" event for Heat/Ossify timers). Marrow: the amount paid is pushed into `pv.bank = [{amt, t}]` for the Catacomb bonus (F2).
- Users: Marrow (all skills), Pact (Offering).

### F7. Basic-attack replacement state (`basicMod`)
- Fields **(new)** on the ult: `type: 'basicMod'`, `dur`, `lineRange`, `radius`, `bonusDmg`, `bonusDmgLv`, `bonusScaleAd`, `asMult` (array by rank).
- Behaviour: `castSkill` sets `h.basicMod = {t, ...}`. While set, `Unit.basicAttack` spawns a piercing `Projectile` aimed at the current target with `isBasic: true`; the first unit hit (or the aimed target) is the primary hit: full basic rules (crit rolled once, lifesteal, onBasicHit, Slipstream stack). Every other unit in the line takes `100% AD + bonus` as a secondary hit: same crit result, 40% lifesteal, no onBasicHit. `asMult` applies as the max of (basicMod.asMult, buffAsMult), not the product. Ends on death or expiry; casting does not end it.
- Users: Zephyr.

### F8. Charge skills
- Fields **(new)**: `charges`, `recharge`, `rechargeLv`, `castDelay`.
- Behaviour: `Hero.skillCharges[i]`, `Hero.skillRecharge[i]` (seconds left on the current charge; only one recharges at a time; ignores cdr). Learning the skill sets charges 0 and starts recharging. `castSkill` refuses at 0 charges or while `skillCd[i] > 0` (castDelay respects cdr), spends one, starts recharge if idle. Helper `refundRecharge(h, i, sec)` for Last Light. HUD draws pips and uses the cd ring for the recharge.
- Edge cases: charges do not refill on death or recall beyond normal recharge.
- Users: Vesper.

### F9. Placed objects (base class) with trap, pulse and barrier modes
- Base: `Game.objects` list entries `{owner, team, x, y, t, mode, s, rank}` updated and drawn each frame; untargetable; expire at t <= 0; `maxActive` per owner (oldest removed).
- Trap mode (Quill): fields **(new)** `type: 'trap'`, `armDelay`, `lifetime`, `triggerRadius`, `maxActive`, `heroOnly: true`, `revealDur`, `enemyVisibleWithin: 120`. After arming, the first enemy hero overlapping `triggerRadius + u.radius` takes `resolveDamage({skill:s})`, `applySkillCC`, `revealT = revealDur`, fires onSkillLanded, and the trap is removed. Persists through owner death.
- Pulse mode (Wick Lantern): fields **(new)** `type: 'object'`, `dur`, `tick`, `allyRadius`, `shield`, `shieldLv`, `shieldScaleAp`, `shieldDur`, `revealRadius`, `revealBasicBonus`. Each tick: `addShield` with tag `lantern` (refresh, not stack) on allied heroes; enemy heroes within `revealRadius` get `revealT` covering the remaining duration and `marks.lanternRevealed`. Expires on owner death.
- Barrier mode (Bastion): fields **(new)** `type: 'barrier'`, `length`, `offset`, `dur`. Stores a segment; each frame every enemy projectile (skillshot, bounce, boomerang, basicMod volley and homing ranged basic projectiles) whose previous->current position crosses the segment is removed without hitting. Units, dashes, novas, zones, cones and melee unaffected; no HP.
- Users: Quill, Wick, Bastion.

### F10. Return projectile (`boomerang`)
- Field **(new)**: `boomerang: true` on a skillshot.
- Behaviour: the projectile travels to `range` (or until it hits a unit if non-pierce), then reverses direction and homes back to the caster's current position; `hitSet` is cleared on the turn; `returnSlowPct`/`returnSlowDur` **(new)** apply only on the return pass. Removed when it reaches the caster or the caster dies.
- Users: Quill.

### F11. Cone hitbox
- Fields **(new)**: `type: 'cone'`, `angle` (degrees), `length`.
- Behaviour: instant; every enemy unit whose circle intersects the sector (centre = caster, direction = aim) takes skillDmg per victim, applySkillCC, applyMark; onSkillLanded. Drawn as a fan for 0.2 s.
- Users: Ignis.

### F12. Skill-owned marks (`applyMark` / `consumeMark`)
- Fields **(new)**: `applyMark: {tag, max, dur, stacks?: 1, centreStacks?: {within, stacks}, dot?: {base, scaleAp, pctMaxHp, pctPerMp, dur, capNonHero}}`, `consumeMark: {tag, dmg, dmgLv, scaleAp, stunAtStacks, stunDur, stunLock}`.
- Behaviour: on hit `marks[tag] = min(max, cur+1)` (or the centre/rim stack count for zones), `marks[tag+'T'] = now`; if `dot`, addDot with tag so total = stacks * per-stack amount over `dur`, refreshed on re-apply. `consumeMark`: per victim (F2) add stacks*(dmg + dmgLv*(rank-1) + scaleAp*MP); if stacks >= stunAtStacks and no `marks.stunLockT`, apply stun and set `stunLockT = now + stunLock`; then delete the mark and its dot. Pips drawn on the target HP bar. `refreshMark: {tag}` **(new)** resets the timer without consuming (Sable Kiss).
- Users: Ignis (consume), Sable (apply + %HP dot + refresh).

### F13. Zone linger (`linger`)
- Fields **(new)**: `linger: {dur, enemySlowPct, enemySlowRamp?: [from, to], allySpeedAdd, chillPerSec, chillDelay, conceal, countsAsSkillHit, endPayload?: {dmg, dmgLv, scaleAp, immobilize}}`.
- Behaviour: after its damage ticks (or immediately if `ticks: 0`) the Zone stays alive `dur` seconds; each frame applies `applySlow(pct, 0.2)` to enemies inside (pct lerped over dur when `enemySlowRamp` is set), `addTimedBuff('speed', allySpeedAdd, 0.2)` to allied heroes inside, one Chill mark per second to enemies inside after `chillDelay`, and marks allied heroes inside as bush-hidden when `conceal` (existing `bushHiddenFrom` path, revealed 1.6 s on dealing damage). `countsAsSkillHit`: the first frame an enemy is inside fires onSkillLanded once per cast (Dry Mouth). `endPayload` fires on every enemy inside at t = 0 (Burial). Drawn as a patch.
- Users: Mira, Ashara.

### F14. Projectile bounce
- Field **(new)**: `bounce: {count, range, decay}`.
- Behaviour: on hit a non-pierce projectile picks the nearest enemy unit (not structure) within `range` not in hitSet, hero bias -150, re-aims, multiplies its damage by `decay`, continues; dies when no target or count exhausted.
- Users: Volt.

### F15. Displacement tween (shared) with wall collision
- Replaces `applyKnockback`'s teleport for every `knockback` and adds `pullTo` / zone `pullSpeed`.
- Fields **(new)**: `pullTo: {target: 'caster'|'point', dist, speed}`, zone `pullSpeed` (u/s toward centre during delay, heroes only), skill-level `wallDmg`, `wallScaleAp`, `wallStun`, `noWallCC` (airborne value when no wall is hit, Tide ult).
- Behaviour: `u.forced = {mode: 'slide', dx, dy, dist, speed, t}` or `{mode: 'point', x, y, speed, t}` handled in `Hero.update` (and minions) before input; moves the unit each frame, checks `Game.wallAt` each step: on wall contact stop, apply `wallDmg` via resolveDamage and `wallStun`. Ignores tenacity, refused by `immuneT`, does NOT clear `dashS` (a dash in progress finishes first and the pull resumes if time remains), sets `marks.heavyUntil` for Nadir. Knockback slide default t 0.25 s; pull -140 (Grom) 0.3 s.
- Edge cases: structures immune; a unit already forced by a hook keeps the hook; taunt forced state is replaced by displacement then restored.
- Users: Nadir, Tide, Grom, Bastion, Karn hook (unchanged path).

### F16. Tether entity (hostile and friendly payloads)
- `Game.tethers` entries `{src, target, t, breakRange, tickT, interval, onTick, onBreak, onComplete, drawColor}`.
- Fields **(new)** on skills: `tether: {dur, breakRange, slowStart, slowEnd, tickDmg, tickDmgLv, tickScaleAp, interval, healPct, payload: {dmg, dmgLv, scaleAd|scaleAp, immobilize, slowPct, slowDur, spreadMark: {tag, stacks, radius}}, breakPayload: {dmg, dmgLv, scaleAd, stun}, multi: {radius}}`; friendly: `link: {dur, interval, tickHeal, tickHealLv, tickScaleAp, targetSpeedAdd, casterArmorAdd, casterMrAdd, breakRange, all: bool}`.
- Behaviour: each frame remove on death of either unit or `dist > breakRange` (firing `breakPayload` if set: Karn Gaol); hostile tethers also break when the source is stunned/airborne/suppressed/taunted unless `anchored: true` (Gaol) and when the target Purifies. Hostile tick: damage + `applySlow(lerp(slowStart, slowEnd, elapsed/dur), 0.2)` + `healPct` to src. Friendly tick: `target.heal` with noPassive + speed buff on target + armor/MR on caster. On t = 0 fire `payload`. One tether per caster except `all` links (Sylva ult) and `multi` (Karn ult). A Canopy link does not stack with a Vine Link on the same ally (larger tick wins). Drawn as a line.
- Users: Anchor, Hexa, Karn, Sylva.

### F17. Ally targeting
- Field **(new)**: `allyTarget: {range, self: false}`.
- Behaviour: `castSkill` picks the allied hero (excluding self when `self: false`) nearest the aim point within `range`; untouched joystick and bots use the lowest-HP ally in range; no target = return false, no cost.
- Users: Sylva (Vine Link), Pact (Offering).

### F18. Channel skill
- Fields **(new)**: `type: 'channel'`, `channel` (seconds), `payload` (a nova skill object), `interruptRefund: 0.5`.
- Behaviour: `h.channelS = {s, t}`; caster rooted, cannot basic/cast, movement input ignored, bar drawn. `CCState.apply` of stun/silence/airborne/suppress/taunt cancels it: mana kept, `skillCd = fullCd * interruptRefund`. Slow/immobilize do not cancel. Flicker/Purify cast cancels (player choice). On t <= 0 `doNova(payload, rank)`.
- Users: Grom.

### F19. Self states: control immunity and untargetable
- Fields **(new)**: `type: 'selfState'`, `dur`, `ccImmune: ['slow', 'displacement']`, `selfRoot: true`, `armorAdd`, `mrAdd`, `tetherSlowMult`, `untargetable: true`, `speedPct`, `noAttack: true`, `recastCancel: true`.
- Behaviour: `h.state = {s, t}`. `ccImmune` makes `applySlow`/forced displacement return without effect for the listed kinds; `selfRoot` blocks movement input; `untargetable` removes the hero from `Game.canSee` targeting, projectile hit tests, nova/zone/cone victim lists and blinkstrike picks (dots continue); `noAttack` blocks basics and casts. Ends on death or expiry.
- Users: Anchor (Weigh Anchor), Nyx (Shade Step).

### F20. Hero-only projectile and %-max-HP damage
- Fields **(new)**: `heroOnly: true` (projectile ignores minions, monsters and structures), `pctMaxHp` (fraction or per-rank array), `pctMaxHpCap` (vs non-heroes); dot variant inside `applyMark.dot` (`pctMaxHp`, `pctPerMp`).
- Behaviour: in F2, add `target.maxHp * pct` before mitigation, capped for non-heroes; structures excluded.
- Users: Sable.

### F21. Missing-HP scaling (target and self)
- Fields **(new)**: `missingPct`, `missingPctLv`, `missingCap` (target's missing HP; Nyx); `selfMissingPct` (array by rank), `selfMissingCap` (fraction of caster max HP; Torren ult); `selfMissingBonus` (F2; Torren S1).
- Behaviour: target term resolved per victim in F2; self term computed once at cast from `(maxHp - hp)` and added to every victim.
- Users: Nyx, Torren.

### F22. Dash-to-point, dash-back and recast return
- Fields **(new)**: `dashToPoint: true` (distance = min(dist, aim distance), joystick pull shortens), `dashBack: true` (direction inverted), `energyRefund`, `recast: {window, speed, label: 'Return'}`.
- Behaviour: `dashToPoint` sets dashS toward the aim point with the computed distance. `recast`: on cast store `h.recast = {x, y, until, skillIdx}`; the ult button relabels while open; pressing it sets dashS to the stored point (speed 1300, no damage, no CC, unhookable, Flicker wall back-off); cooldown starts on the first cast; expiry does nothing.
- Users: Rook (recast), Torren (dashToPoint), Lumen (dashBack).

### F23. Taunt CC
- `CC_TYPES.taunt` {tenacity: true, priority above stun}; applied via `applySkillCC` from a `taunt` field.
- Behaviour: sets `u.forced = {mode: 'taunt', src, t}`; `Hero.update` (player and bots) ignores movement, skill and spell input, paths toward src and basic-attacks it when in range; bots skip botThink while forced; ends early if src dies; Purify/immuneT refuse; tenacity shortens.
- Users: Brass.

### F24. Conditional cooldown reset
- Fields **(new)**: `resetOnKill`, `resetOnAssist` (fractions).
- Behaviour: in `Hero.fire('onKill')` / `('onAssist')`, for every skill carrying the field reduce `skillCd[i]` by `fraction * fullCd`.
- Users: Omen.

### F25. Basic-range state (`basicRange`)
- Fields **(new)**: `type: 'basicRange'`, `rangeSet` (300), `count` (3), `dur` (4), `bonusDmg`, `bonusDmgLv`, `bonusScaleAd`.
- Behaviour: `h.basicRangeState = {count, t}`; while active `Stats.range` reads `rangeSet`, basics spawn a projectile (ranged path) with the bonus added as isBasic damage; each basic decrements count; ends at 0 or expiry.
- Users: Wraith.

### F26. Ally-radius buff (`allybuff`)
- Fields **(new)**: `type: 'allybuff'`, `radius`, `asAdd`, `asAddLv`, `spdAdd`, `dur`.
- Behaviour: loop allied heroes within radius (incl. self): `addTimedBuff('atkSpd', ...)`, `addTimedBuff('speed', ...)`; the atkSpd bonus is applied as the max against an active dash asMult / basicMod asMult rather than added. Buff icon on units.
- Users: Bell.

### F27. Self shield and self resist fields on damage skills
- Fields **(new)**: `selfShieldPct`, `selfShieldDur`, `armorAdd`, `mrAdd`, `buffDur`.
- Behaviour: after the effect, `addShield(maxHp*selfShieldPct, dur)` and `addTimedBuff('armor'/'mr')` on the caster.
- Users: Brass (Buckler, ult).

### F28. Airborne rework and CC locks
- `CC_TYPES.airborne` becomes `{tenacity: false}`; applying it clears `dashS`, `channelS` and `basicRangeState` casts on the victim; still refused by immuneT.
- Marks `chillImmuneT` (Mira) and `stunLockT` (Ignis) are read by the applying hooks to prevent chain freezes/stuns.
- `slowPctLv` **(new)** on multi-tick zones: slowPct + slowPctLv*(tickIndex) (Volt).
- `canCrit: true` **(new)** on a nova: roll the caster's crit chance once per cast (Omen).
- Users: Grom, Marrow, Rook, Tide (airborne); Mira, Ignis, Volt, Omen.

### F29. Bot support
- `botSkillUrgency` handlers per new type: trap placement (bush mouth / behind self), object placement (under frontliner), barrier placement (between enemy ranged and ally), tether kiting (keep 400-580 / walk toward), channel safety (no visible enemy stun), ally-target selection (lowest HP), charge banking, energy/heat thresholds, recast return conditions, cone/boomerang aim, dash-to-point aim, selfState triggers (Shade Step vs incoming projectile, Weigh Anchor when tethered target slowed), wall-vector check for Tide.
- All 28 bot hints above are the acceptance criteria.

---

## Implementation order

Engine features first, in dependency order; then heroes by role, each role's difficulty-1 skeleton first so the pattern is validated before the special cases.

**Phase 0 - foundations (no hero changes yet)**
1. F1 per-rank scaling and `rankVal` helper (every kit reads it).
2. F2 target-aware `skillDmg` (unblocks marks, %HP, missing-HP, bank).
3. F28 airborne rework, CC locks, `slowPctLv`, `canCrit`.
4. F3 resource framework (+ HUD bar colours), then F4 energy, F5 heat, F6 hp-cost.
5. F15 displacement tween replacing `applyKnockback` (all existing knockbacks migrate; verify Grom/Bastion/Karn/Tide/Nadir current kits still play).

**Phase 1 - shared entities**
6. F16 tether entity (hostile + friendly) and F17 ally targeting.
7. F9 placed-object base class with trap, pulse and barrier modes.
8. F13 zone linger (with conceal, ramp, endPayload).
9. F12 skill-owned marks with pips.
10. F19 self states (ccImmune, untargetable), F18 channel, F23 taunt (all three touch `Hero.update` input gating: do them together).

**Phase 2 - projectile and basic variants**
11. F14 bounce, F10 boomerang, F11 cone, F20 hero-only projectile.
12. F7 basicMod volley, F25 basicRange, F8 charges.
13. F22 dash-to-point / dash-back / recast; F24 resetOnKill; F26 allybuff; F27 self shield/resist fields; F21 missing-HP fields.

**Phase 3 - heroes (data.js + combat.js passives), by role**
14. Tanks: Grom (channel, tween), Bastion (barrier), Anchor (tether, selfState), Marrow (hp resource, bank).
15. Fighters: Torren (none resource, self-missing, dashToPoint), Brass (taunt, self shield), Omen (resetOnKill, canCrit), Karn (Gaol tether, bonusVsMark), Tide (wall collision), Cinder (heat/overheat).
16. Marksmen: Zephyr (basicMod), Vesper (charges), Quill (trap, boomerang), Lumen (battery energy, dashBack).
17. Mages: Ignis (cone, marks), Volt (bounce), Mira (linger), Nadir (pullTo/pullSpeed), Ashara (conceal, ramp), Hexa (drain tether).
18. Assassins: Rook (recast), Nyx (untargetable, missingPct), Wraith (fast energy, basicRange), Sable (heroOnly, pctMaxHp, marks).
19. Supports: Wick (pulse object), Bell (allybuff), Sylva (friendly tether, ally target), Pact (hybrid resource, allyTarget heal).

**Phase 4 - bots and polish**
20. F29 bot handlers per type, validated against each hero's bot hint.
21. HUD: pips (charges, marks), resource bars, recast relabel, channel bar, tether/link lines, object visibility rules.
22. Balance pass against the MLBB bands with the caps listed at the top of this document.
