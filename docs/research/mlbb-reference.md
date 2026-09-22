# Mobile Legends reference for Legends Arena

Numbers and rules from Mobile Legends: Bang Bang (Sanctum Island map, patches ~1.9 to 2.2, sources parsed 2026-09-21) that Legends Arena uses as its model. It is a reference, not a spec: copy the shapes and ranges, tune the values in our own game.

Confidence tags on every number: **[H]** high (wiki data module or several agreeing sources), **[M]** medium (single source, or sources disagree by a little), **[L]** low (unverified, contradictory, or inferred). Where sources disagree both values are given.

Units: one MLBB "unit" is the distance a 100-movement-speed hero covers per second (260 MS = 2.6 units/s). Melee range 1.8, ranged 4.1-5.0, turret attack range 5.3, sight range 8.

---

## 1 Roles and hero design patterns

### 1.1 Roster shape

| Measure | Value | Conf |
|---|---|---|
| Roles (134 heroes) | Fighter 37, Mage 26, Assassin 20, Marksman 20, Tank 18, Support 13 | [H] |
| Attack type | Melee 73, Ranged 54, Hybrid 7 | [H] |
| Resource | Mana 84, none 21, Rage/indicator 19, Energy 10 | [H] |
| Level cap | 15; ult unlocks at 4, upgrades at ~8 and ~12 | [H] |
| Kit skeleton | Passive + 3 skills; S1/S2 have 6 levels, ult 3 levels. Exceptions: Julian/Suyou learn ult at 1 with 5 levels; Hirara has 2 skills | [H] |

For a 28-hero roster scaled from these proportions: 8 fighters, 5 mages, 4 assassins, 4 marksmen, 4 tanks, 3 supports.

### 1.2 Base stat envelopes, level 1 -> level 15 (min/median/max) [H]

| Role (n) | HP | HP regen | Phys ATK | Phys DEF | Atk speed | Move speed (mode) | Range |
|---|---|---|---|---|---|---|---|
| Tank (18) | 2350/2614/2859 -> 5000/6030/6900 | 3.0/8.4/18.4 -> 11.4/16.8/40.8 | 105/116/135 -> 190/207/259 | 10/19.5/27 -> 47/72.5/119 | 1.01 -> 1.23 | 240-268 (260) | melee 1.4-3.0, mostly 1.8 |
| Fighter (37) | med 2600, max 2908 (X.Borg 998) -> 5568, max 6250 | 7.8 -> 14.2 | 121 (90-148) -> 244 (191-317) | 22 (15-25) -> 84 (50-124) | 1.07 (0.88-1.22) -> 1.34 (1.0-1.6) | 240-265 (260) | melee 1.4-2.0; hybrids 3.8-4.1 |
| Assassin (20) | 2549 (2320-2878) -> 4746 (4356-5664) | 7.0 -> 13.2 | 120 (108-128) -> 255 (201-289) | 18 (15-24) -> 73 (60-83) | 1.085 -> 1.35 (max 1.54) | 240-265 (260) | melee 1.8 |
| Mage (26) | 2421 (2260-2880) -> 4496 (4150-5655) | 6.8 (6.4-7.6) -> 11.0 | 112 -> 199 (lowest) | 18 (13-21) -> 72 (55-79) | 1.0 -> 1.14 (lowest growth) | 240 (11), 245 (5), 250 (7), 255 (2) | ranged 4.1-5.0 (median 4.7) |
| Marksman (20) | 2286 (2225-2620) -> 4397 (4052-4699) (lowest) | 6.5 (5.4-8.0) -> 9.5 | 115.5 (90-145) -> 244.5 (193-348) | 17 (14-22) -> 72.5 (56-80) | 1.03 (0.87-1.21) -> 1.245 (1.0-1.91, highest growth) | 240-260 (240) | ranged 4.3-5.0 |
| Support (13) | 2468 (2221-2950) -> 4902 (3950-5706) | 7.6 -> 11.8 | 119 -> 216 | 20 (12-30) -> 70 | 1.0 -> 1.14 | 240 or 260 | healers 4.1-4.9; melee roamers 1.4-2.0 |

Universal defaults [H]: magic DEF 15 at level 1 for almost everyone (Minotaur/Ruby 10, Lylia 17) = 11.1% magic reduction, typically 50 at level 15 (38 low, 71 tanks). Mana 500 -> 1900, mana regen 4 -> 6.8 (Cecilion 700 -> 2660, Zhuxin flat 1200). Energy pool 100, fast regen, cannot be raised by items. Estes has the lowest HP in the game (2221 -> 3950).

Read-out: tanks get ~+15% HP, 1.5-2x regen and +5-10 base DEF; marksmen the lowest HP/regen but the highest attack-speed growth and range; assassins/fighters the highest attack growth and 260-265 speed; mages the weakest basics but 4.1-5.0 range.

### 1.3 Movement speed [H]

- Base 240-270 (Kaja 270 highest, Suyou 225 special). Ranged carries and healers 240-250, melee and roamers 260, a few chase heroes 265-270.
- Speed = base x (100% + speedups - slows). Slows/speedups from different sources stack multiplicatively. Max slow 90%. Effectiveness of modifiers decays below 230 and above 420 (rate undocumented [L]).
- A 260-speed hero crosses a 5-unit range in ~1.9 s; a 3.8-unit Flicker is ~1.5 s of walking.

### 1.4 Damage formula and ratio bands [H]

`skill damage = base(skill level, linear) + ratio x Total ATK (base + items)` or `ratio x Extra ATK (items/emblem only)`. Extra-attack ratios are used on assassins/fighters so items, not levels, unlock their kill threshold; tanks/supports scale on Total attack or max HP so they stay useful with no damage items.

| Skill type | Ratio band | Examples |
|---|---|---|
| Poke / spam | 65-105% Total ATK | Layla S1 80%, Eudora S1 100% MP, Fanny S1 85% |
| Targeted / CC | 40-80% | Eudora S2 50% MP, Tigreal S1 70%, Zilong S2 60% |
| Burst | 100-160% | Karina S2 125% MP, Alucard S2 120% Extra PA |
| Ultimate | 130-200% | Layla 150% PA, Eudora 160% MP, Tigreal 130% PA, Karina 160% MP, Chou/Fanny 200% Extra PA |
| Heal | 35-110% Total MP instant; 60-225% over time | Estes ult 210-225% MP |
| Shield | 40-100% Total PA or 80-300% Total MP | Angela ult 200-300% MP |

Per-level scaling [H]: base damage +30-60 per level on S1/S2 (Layla S1 +40, Eudora +45, Nana +24, Tigreal +50); +100-200 per ult level (Layla 500/650/800, Eudora 600/800/1000, Karina 350/550/750). Cooldowns drop 0.2-0.6 s per level on basics and 3-7 s per ult level. Mana costs rise 5-10 per level on basics and 20-50 per ult level (rare inversions: Saber Charge 70 -> 45).

Basic attacks [H]: 100% Total Phys ATK, can crit. Melee 1.4-2.0 (Chou/Aldous 1.4, Freya 1.5, most 1.8, Argus 1.9); ranged 4.1-5.0 (Layla 4.3, Eudora 4.5, Estes 4.7, Miya 4.8, Angela 4.9). Range can scale: Layla ult passive +0.6/1.2/1.8 (4.9/5.5/6.1) plus +1.6..1.0 for 3 s on S1 hit; enhanced basics on melee heroes reach 2.5-3.5 (Zilong, Karina, Freya). Attack animation = wind-up + backswing scaled by attack speed; skills cancel the backswing.

Attack speed [M]: base ~0.9-1.2 at level 1, ~1.1-1.9 at 15; items give %AS multiplied by a per-hero ratio (usually 100%). Hero buffs: Miya +5%/stack to 25%, Zilong ult +35-55% 7.5 s, Argus S2 +30-55% 3 s, Hanabi shield +25%, Martis up to +120%, Freya +100% on an orb-enhanced basic.

### 1.5 Cooldown and cost bands [H]

| Slot | Cooldown L1 -> max level | Mana L1 -> max |
|---|---|---|
| Spam/damage skill | 3.5-9 s -> 2.5-6.5 s (Fanny 3.5->2.5, Nana 5.5->4, Layla 6->4, Eudora 7->5, Alucard S2 6->4) | 35-75 (Layla 40->65, Eudora 50->70, Nana 50->75) |
| CC/utility skill | 8-16 s (Miya 8, Zilong 12->9.5, Franco hook 15->11, Tigreal S2 16->13 Liquipedia / 12.5->10 fandom) | 65-130 (Layla 65->90, Miya 80->130); hooks priced high (Franco 135->160) |
| Ultimate | 25-62 s (Fanny 35/30/25, Eudora 32/29/26, Layla 37/32/27, Chou 34, Karina 34/30/26, Tigreal 55/50/45, Franco 62/55/48, Angela/Aldous 60). Longest: Zetian 90, Yu Zhong 85, Faramis 80 | 100-200 rising 20-50/level (Layla 130/150/170, Estes 150/250/350, Hylos 150/300/450) |

Charge skills [H]: Angela Love Waves 5 charges, 2.0 s between casts; Badang 2 charges 10.4->7.2 s; Clint 3 charges 10/8/6 s; Natalia 2 charges 30/24/18 s (creep kills refund). Charges start at 0 when learned; recharge ignores CDR, the inter-cast delay does not.

### 1.6 Resource archetypes [H]

| Type | Count | Rule |
|---|---|---|
| Mana | 84 | Cost per cast, rising per level (taxes spam) |
| Energy | 10 (Fanny, Hanzo, Hayabusa, Lesley, Ling, Granger, Nolan, Hirara...) | Pool 100, fast regen (rate undocumented [L]), short cooldowns, cannot be raised by items |
| Resourceless | 21 (Alucard, Balmond, Freya, Martis, Yu Zhong, Paquito...) | Gated by cooldown only |
| Rage / indicator | 19 (Chou, Argus, Alice, Dyrroth, Thamuz, X.Borg...) | Builds through attacks/time, unlocks enhanced effects instead of being spent per cast. Argus Malice: +5/s, +25 per basic, +25 on crit, cap 200, Demonic Slash at 100. Lukas needs full stacks to unlock ult |
| Hybrid | few | Hylos converts each extra mana to 1.5 HP and casts from HP when dry; X.Borg has armor HP (120% extra HP) rebuilding at 3 energy/s |

### 1.7 Crowd control [H]

Tiers (official skill notes): Low = Disarm, Restrain, Root, Immobilize (do not interrupt skills). Basic = Stun, Silence, Terrify, Taunt (interrupt some). High = Freeze, Petrify, Airborne, Transform (interrupt many; airborne stops blinks/charges). Ultimate = Frozen Moment, Suppress (cannot be removed; suppress ignores resilience, immunity and Purify). Only Franco, Kaja, Barats suppress. Fanny is the only hero with zero CC. Slow is on 90 of the first 100 heroes.

| CC | Observed durations |
|---|---|
| Stun | 0.25-1.8 s (Layla mark 0.25, Lolita S1 0.5, Argus S1 0.7, Eudora/Hylos 1.0, Rafaela ult 1.5, Tigreal ult 1.8-2.0, Lolita ult up to 2.0 by charge) |
| Airborne | 0.4-1.2 s (Freya 0.4, Tigreal 0.6-1.0, Saber ult 1.2 ignoring resilience) |
| Immobilize | 0.8-1.5 s (Hanabi 0.8, Miya 1.2, Angela 1.5) |
| Transform | 1.5 s (Nana) |
| Suppress | 1.8 s (Franco) |
| Slow | 30-90% for 0.5-3 s (Franco 70% 1.5 s, Estes edge 90% 1.5 s decaying, Angela ramping to 80% over 3 s) |

Rules: CC does not stack; a new CC replaces the current one. Resilience: duration x (1 - resilience), floor 0.1 s, sources multiply (30%+25%+15%+15% = 62%); it does not reduce airborne, knockback/pull or suppress. Control immunity ignores all CC except suppress but does not clear existing CC (Chou Shunpo, Hanabi shielded, Freya ult, X.Borg ult, Kagura dash, Purify). Slow immunity is a lighter tier (Zilong ult, Hylos on his path). Untargetable beats immune. Taunt/silence/terrify/petrify/freeze durations were not sampled [L].

### 1.8 Defense, penetration, reduction, sustain [H]

- Multiplier = 120 / (120 + DEF). 15 DEF -> 88.9% taken, 100 -> 54.5%, 120 -> 50%, 240 -> 33%, -36 -> 142.9%, -60 -> 200%. Floor -60.
- Total DEF = [(DEF - flat DEF reduction) x (1 - %DEF reduction - %pen)] - flat pen. Hero shreds: Chou passive -10(+1/level) phys DEF, Zilong S2 -15..30 for 2 s, Balmond S1 -40% phys DEF 3 s, Eudora S2 -10..25 magic DEF 1.8 s, Saber passive -3..8 per hit x5.
- Damage reduction applies after DEF, stacks additively, does not reduce true damage: Terizla passive up to 35%, Aldous S2 30% 2 s, Freya ult 50%, Minsitthar/Aulus 25-50% frontal, Guardian Helmet flat 20 + 0.2% HP.
- Shields absorb after DEF/DR and absorb true damage. True damage ignores DEF and DR; countered by HP and shields. Sources: Lesley Lethal Shot 100 (+100% PA), Balmond ult 150 (+70% PA) + 30-45% lost HP (cap 2000 vs non-hero), Karina 3rd hit 50 + ~5% lost HP, Karrie 5% max HP per 5 marks, X.Borg ult 300/500/700 + 15% max HP, Martis ult 700-1100 (+120% PA) below 50% HP.
- Lifesteal only from basic attacks (items 8-20%); spell vamp only from skills (items 8-10%, passives 3-20%); multi-hit skills carry a 40-100% vamp ratio (Eudora S1, Nana S1/ult, Hylos S2, Rafaela ult at 50%). Alucard ult passive 10/20/30% hybrid.

### 1.9 Conceal [H]

Concealed units leave the minimap and cannot be locked by single-target skills; ends on dealing or taking damage. Camouflage shows a distortion and does not dodge projectiles already fired (Lesley S1 3 s, +40% MS, +85-135 ATK, CD 5->2, 30 energy). Half-stealth (Ling) is visible-translucent and targetable. Miya ult: purge + conceal + 65% MS for 2 s or until attacking, CD 30/25/20.

### 1.10 Tags and ratings

Specialty vocabulary (each hero gets two) [H]: Regen, Crowd Control, Finisher, Charge, Push, Damage, Burst, Poke, Initiator, Magic Damage, Control, Guard, Support, Chase. Examples: Layla Finisher/Damage, Saber Charge/Finisher, Eudora Control/Burst, Franco Initiator/Control, Estes Regen/Guard, Angela Guard/Support.

Wiki ratings durability/offense/control/difficulty (1-10) [M]: Layla 1/8/1/2, Miya 1/7/4/1, Eudora 1/8/8/2, Tigreal 8/1/10/1, Franco 8/1/10/2, Hylos 10/2/8/5, Lolita 10/1/9/5, Fanny 6/7/0/10, Saber 2/6/6/3, Gusion 3/9/1/8, Karina 5/7/1/5, Chou 5/3/8/7, Zilong 2/5/6/1, Balmond 8/3/2/2, Alucard 5/5/1/4, Freya 6/5/5/5, Estes 7/1/2/3, Rafaela 6/2/7/4, Angela 3/2/5/6, Aldous 7/3/5/7, Argus 8/6/6/7, X.Borg 8/3/1/6. Every role has at least one difficulty 1-2 hero.

### 1.11 Example kits (all [H] unless marked; fandom numbers, Liquipedia variants in section 1.13)

**Layla** (MM, mana, range 4.3, MS 240; HP 2250->4378, PA 133->252, PDEF 15->71, AS 1.06->1.34). Passive: damage 100% -> 130% at 6 units (Liquipedia 115%). S1 line skillshot, first hit, 200->400 (+80% PA), can crit, +range 3 s, +60% MS decaying 1.2 s; CD 6->4; mana 40->65. S2 AoE 170->320 (+65% PA) + 3 s mark; hitting a marked enemy pops 100->200 (+35% PA) AoE + 0.25 s stun; CD 7.5->6.5; mana 65->90. Ult line 500/650/800 (+150% PA); CD 37/32/27; mana 130/150/170; passive +0.6/1.2/1.8 range.

**Eudora** (Mage, Control/Burst, mana, range 4.5, MS 250; HP 2403->4771, PA 112->193, PDEF 19->77). Passive: skills mark non-minions 5 s (Liquipedia 3 s). S1 cone 275->500 (+100% MP), 200% vs minions; on marked: chain 1 s, +40% MS, delayed +275->500 and 50% CD refund; CD 7->5; mana 50->70. S2 targeted 300->400 (+50% MP), stun 1 s, -10..25 magic DEF 1.8 s; AoE stun on marked; CD 11->8.5; mana 70->95. Ult ground AoE 600/800/1000 (+160% MP) centre, 300/400/500 (+100%) edge, +330/440/550 (+110%) per marked target; CD 32/29/26; mana 130/160/190.

**Tigreal** (Tank, CC, mana, melee 1.8, MS 260; HP 2581->6879, regen 8.4->16.8, PA 112->207, PDEF 20->95, MDEF 15->71). Passive: 4 stacks (casts or basics taken) block the next basic incl. turret. S1 three fan pulses 270->520 (+70% PA), slow 20/40/60% 1.5 s; CD 7->4; mana 45. S2 charge 100% PA pushing enemies, recast within 4 s: 280->380 (+60% PA) airborne 0.6-1.0 s; CD 16->13 (Liquipedia) / 12.5->10 (fandom); mana 70. Ult channel pull + stun 1.8-2 s, 600/800/1000 (+130% PA) (fandom 270/350/430); first half interruptible by any CC, second only by suppress; CD 55/50/45 (fandom 45/41/37); mana 120/140/160.

**Franco** (Tank, Initiator/Control, mana, melee 1.8, MS 260; HP 2600->6534, regen 9.2->18.6, PA 116->217, PDEF 25->93). Passive: after 5 s undamaged +10% MS, 1% max HP/s, 10 stacks adding up to +150% damage to the next skill. S1 hook skillshot, first unit hit (minions block), 400->650 (+100% PA), drags to Franco; CD 15->11; mana 135->160. S2 AoE 300->450 + 4% own max HP, slow 70% 1.5 s; CD 7->4.5; mana 40->65. Ult targeted suppress 1.8 s, 6 x 50/60/70 (+70% PA); CD 62/55/48; mana 110/125/140.

**Fanny** (Assassin, Chase/Finisher, energy 100, melee 1.8, MS 265; HP 2426->4400 (Liquipedia 2267 L1), PA 126->269, PDEF 16->68, AS 1.12->1.44). Passive: +10-20% damage while flying, each hit applies Prey Mark (2 stacks), skill hits on marked heroes restore 8 energy per stack (reduced vs many heroes). S1 AoE 275->525 (+85% PA); CD 3.5->2.5; 12 energy; auto-cast when a cable flight hits. S2 cable, no cooldown, pulls to first terrain hit, recast 2 s, 19->14 energy, -2 per consecutive cast. Ult targeted leap 400/525/650 (+200% Extra PA), +30% per Prey Mark; CD 35/30/25.

**Saber** (Assassin, Charge/Finisher, mana, melee 1.8, MS 260; HP 2440->4960, PA 118->254, PDEF 20->77, AS 1.08->1.36). Passive: each hit -3..8 phys DEF, 5 stacks, 5 s. S1 five orbiting swords ~5 s, 80->105 (+30% Extra PA) on contact; each attack fires one for 210->260 (+60% Extra PA) (50% to non-heroes) and cuts Charge CD 1 s; CD 9; mana 75->125. S2 dash 75->150 (+50% Extra PA) + enhanced basic 75->150 (+120% PA), 60% slow 1 s; CD 7; mana 70->45. Ult targeted, airborne 1.2 s (ignores resilience), 2 x 120->180 (+100% Extra PA) then 240->360 (+200% Extra PA); CD 44/40/36; mana 100/120/140.

**Chou** (Fighter, Chase/Control, rage bar, melee 1.4, MS 260; HP 2530->5568, regen 7.8->14, PA 121->262, PDEF 23->87, AS 1.10->1.45). Passive: after moving 5 units the next basic deals 180% (no crit), brief 80-90% slow, -10(+1 x level) phys DEF 3 s (2 stacks). S1 three casts 180->280 (+70% PA), 3rd knocks airborne, hitting a hero with the 3rd resets Shunpo; CD 9.5->8. S2 dash with control immunity + shield 200->350 (+200% Extra PA); CD 5. Ult targeted kick 400/450/500 (+200% Extra PA) knockback, recast chase 480/530/580 (+220-240% Extra PA); CD 34.

**Estes** (Support, Regen/Guard, mana, range 4.7, MS 240; HP 2221->3950, PA 120->221, PDEF 13->65). Passive: energy charges to 100 -> enhanced basic 250 (+100% PA)(+150% MP) magic + 125 splash, 60% slow 1.5 s. S1 ally heal 250->325 (+110% MP) + 3 s link healing 325->400 (+60% MP), Estes gets +20..45 hybrid DEF and +15% MS, breaks on distance; CD 11->7; mana 110->210 (free during ult). S2 AoE 350->600 (+70% MP), reveals, 90% decaying slow 1.5 s at the edge; CD 12->9.5; mana 80->130. Ult enhanced S1 on all nearby allies for 8 s, heals 1230/1350/1470 (+210% MP) over time; CD 55/50/45; mana 150/250/350.

**Angela** (Support, Guard, mana, range 4.9, MS 240; HP 2300->4206). Passive +7.5% MS per cast to 30% for 4 s (transfers when attached). S1 5 charges / 2.0 s, line 170->320 (+80% MP) + Lover's Mark (5 stacks, +20% damage each, 8% slow 3 s), heals allies passed 150->200 (+75% MP); mana 60->110. S2 tether 300->450 (+40% MP) with slow ramping to 80%; still tethered after 3 s: immobilize 1.5 s + 450->675 (+60% MP), +20% per mark; CD 13->10; mana 90->140. Ult 2 s channel, global shield 1000/1300/1600 (+200/250/300% MP) 6 s, then attach 12 s casting at 0 mana; CD 60; mana 100/150/200 (Liquipedia: 600/800/1000 +150% MP, 20 s attach).

**Karina** (Assassin, magic, mana, melee 1.8, MS 260; HP 2633->5262, PA 121->236, PDEF 20->83, AS 1.13->1.54). Passive: 3rd consecutive hit on one target deals true damage 50 + (5% + 2.5% per MP step) of lost HP (cap 2000 vs creeps); on heroes -1.5 s non-ult CDs. S1 3.5 s state, +45% MS, blocks all basics and reflects 100->200 (+30% MP); enhanced basic 150->255 (+55% MP), 45% slow 1 s, guaranteed crit; CD 7; mana 70->120. S2 spin 375->600 (+125% MP); CD 6->4.5. Ult targeted dash 350/550/750 (+160% MP), leaves Shadowform 5 s, resets if target dies; recast returns dealing 150/200/250 (+50% MP); CD 34/30/26; mana 100/120/140.

**Balmond** (Fighter, Damage/Regen, resourceless, melee 1.8, MS 260; HP 2558->6212, regen 9.4->17.8, PA 119->237, PDEF 25->90). Passive: heal 5% max HP on minion/creep kill, 20% on hero kill. S1 charge until first hero, 150->275 (+60% PA), knockback, -40% MS and -40% phys DEF 3 s; CD 8->5. S2 3 s spin, up to 14 hits x 25->100 (+2% Extra HP)(+25% PA), each repeat +8.5% up to +68%, max 350->1400, +15% MS decaying; CD 6. Ult AoE true damage 150 (+70% PA) + 30-45% target lost HP, cap 2000 vs non-heroes.

**Freya** (Fighter, transform, orbs, melee 1.5 / 3.5 in ult, MS 260; HP 2550->5560, regen 9.8->16.2, PA 120->242, AS 1.00->1.28). Passive: each basic grants a Sacred Orb (max 6), spending one gives +100% AS on the next basic; orbs regen out of combat. S1 jump + shield 500->900 (+100% PA), 200->300 (+80% Extra PA), airborne 0.4 s; CD 8->6. S2 no cooldown (0.4 s), 2 orbs, dash-slash 150->300, 30% slow 0.5 s, 50% to creeps. Ult dive with control immunity + 50% DR, 300/425/500 (+75% PA), 40% slow 2 s, then 12 s state: +30/45/60 per basic, heal 60/90/120 (+40% PA) per basic, splash, range 3.5; CD 34/30/26.

**Zilong** (Fighter/Assassin, mana, melee 1.8 (2.5 enhanced), MS 265; HP 2511->5549, PA 123->249, PDEF 25->90). Passive: every 3rd damage instance makes the next basic hit 3x (80 +30% PA each) healing 50 (+20% PA) per hit; +30 vs targets under 50% HP. S1 targeted flip-over 250->350 (+80% PA); CD 12->9.5; mana 80->105. S2 lunge 250->450 (+60% PA), -15..30 phys DEF 2 s, resets on kill; CD 12->9; mana 40. Ult purge slows, +40% MS, +35/45/55% AS, slow immunity 7.5 s, passive every 2 basics; CD 35/31/27; mana 120->160.

**Argus** (Fighter, Malice rage, melee 1.9, MS 240; HP 2600->5372, PA 120->232, PDEF 21->78). Passive: +5 energy/s, +25 per basic (+25 on crit), cap 200; at 100 next basic = Demonic Slash 120 (+25% PA), heals ~140, ignores 30% phys DEF. S1 skillshot hand 125->250 (+60% PA), stun 0.7 s, pulls both together (self-pull on miss), 40% slow 2 s; recast dash 175->300 (+100% PA); CD 12->10. S2 delayed thrust 60->180 (+100% PA), counts as basic, charge shortens with AS; hero hit -> +100 energy, +30-55% AS 3 s; CD 8->6. Ult purge + 4 s death immunity (auto-cast at 3 s on fatal damage if ready), converts damage dealt to heroes into HP after; CD 42/38/35.

**Aldous** (Fighter, infinite stacks, mana, melee 1.4, MS 260; HP 2668->5328, PA 129->279). Passive: every 2 basics -> shield 500 (+3 x stacks) 3 s, once per 5 s. S1 enhanced basic 200->450 (+100% PA) + 5 x stacks; kills grant 4-12 stacks (hero 12), cap 650; CD 4; mana 60->85. S2 stance 30% DR + 20% MS up to 2 s then AoE 100-200..200-400 (+20-40% PA) and stun 0.5-1 s by stance time; CD 12->9.5; mana 80->130. Ult global vision 5 s, recast flies to any enemy hero, 400/550/750 + 8% target max HP, knockback 1 s; CD 60/55/50; mana 150/200/250.

**Kagura** [M] (Mage, placed object, mana, ranged, MS 240; HP 2375->4376, PA 118->230). Passive: retrieving the umbrella grants shield 450 (+80% MP), 0.5 s AoE stun, 60% slow 1 s, 4.5 s CD. Every skill has two modes. S1 send umbrella 365->590 (+105% MP), 60% slow 0.5 s (CD 5->3.5, mana 50->80). S2 with umbrella = purge + dash leaving it; without = teleport to it dealing 300->400 (+90% MP) (CD 12->9.5). Ult with = 250->420 (+95% MP) AoE knockback; without = resets S1, 235->355 (+60% MP) slow, after 1.5 s pulls heroes to the umbrella for 480->720 (+155% MP); CD 43/38/33; mana 85/100/115.

**Hylos** (Tank, mana->HP, aura, MS 260; HP 2700->6900, regen 18.4->40.8 highest, PA 105->198). Passive: +1.5 max HP per extra max mana; casts from HP when dry. S1 +50% decaying MS, next basic 300->550 (+80% MP) knockback + 1 s stun; CD 12->8; mana 80->130. S2 toggle aura 100->300 (+20% MP)/s, 8 stacks: 4-6% slow, -7.5..15% AS, +5..20% damage taken per stack; 30->150 mana/s; CD 1. Ult 6 s lane: allies +60% MS, enemies -25% (initial -75% 1 s), Hylos slow-immune + 3% max HP/s; CD 40/36/32; mana 150/300/450.

**Lolita** (Support/Tank, projectile block, mana, melee 1.8, MS 260; HP 2451->4803). S1 dash, next basic within 4 s short-dashes 300->550 (+100% PA) + 0.5 s stun (double vs minions); CD 10; mana 70->120. S2 3 s frontal shield blocking and reflecting ranged basics/projectiles, breaks after 1500->3000 (+15% HP); CD 17.5->15; mana 90->115. Ult 2 s charge slowing 50% in a cone, slam up to 500/700/900 (+100% PA), stun up to 2 s by charge, early release allowed; CD 55/50/45; mana 120/140/160.

**Miya** (MM, range 4.8, MS 240; HP 2225->4367, PA 115->227, AS 1.06->1.41). Passive +5% AS per stack to 25% 4 s. S1 two extra arrows per basic 10->35 (+100% PA) + 30% splash for 4->9 s (CD 11, mana 50->75). S2 ground AoE 270->420 (+45% PA) immobilize 1.2 s + 6 scatter arrows 40->105 (+20% PA) 30% slow (CD 8, mana 80->130). Ult purge + conceal + 65% MS 2 s, exits with full stacks (CD 30/25/20).

**Hanabi** (MM). Passive petal bounces up to 4 targets (40%, x0.85 each). S1 shield 300->600 (+40% PA) 5 s with +20% MS/+25% AS and CC immunity while any shield is up (CD 14->12, mana 35->60). S2 line 450->600 (+80% PA), 60% slow 1 s, marks for a 30->180 (+100% PA) no-decay bounce (CD 8->6). Ult 300/400/500 (+50% PA) first hero, immobilize 0.8 s, blooms after 1 s for 300/400/500 AoE (CD 40/35/30, mana 120/160/200).

**Lesley** (energy MM). Passive: after 5 s undamaged, next basic gets extra range, +50% crit chance, 100 (+100% PA) true damage; each point/% of phys pen becomes +1% crit damage but base crit damage drops to 130%; basics restore 5 energy (10 with Lethal Shot). S1 3 s camouflage, double energy regen, +40% MS, +85-135 ATK; ends on damage; CD 5->2; 30 energy. S2 cone knockback 150->300 (+50% PA) with a backhop; CD 10->7; 40 energy. Ult lock-on, 4 bullets 250->350 (+80% Extra PA)(+5% lost HP), body-blockable, +10 energy per hit, unfired bullets refund 10% CD each; passive +5-15% crit; CD 40; 0 energy.

**Nana** (Mage, MS 250). S1 boomerang 320->440 (+100% MP), -20% per extra target (max -60%), CD 5.5->4, mana 50->75. S2 summon chases nearest hero 2.5 s, 250->375 (+50% MP), Transform 1.5 s, 50-70% slow, -25% magic DEF; CD 14.5->12; mana 80->105. Ult 3 ground strikes 440/550/660 (+160% MP), 50% slow 1 s, consecutive hits stun 1 s; CD 36/32/28.

**Rafaela** (Support, MS 245). Passive periodic ally resurrection. S1 auto-hits 3 nearest 225->500 (+120% MP), reveal, 40% slow 1.5 s, +20% per stack (3); CD 4; mana 70->145. S2 AoE heal 100->125 (+35% MP) + 150->250 (+45% MP) to self and most injured, +30% MS (+1% per 20 MP to 80%), slow immunity 1 s; CD 10.5->8.5; mana 100->150. Ult line 460/560/660 (+120% MP), stun 1.5 s; CD 42/38/34.

**Alucard** (resourceless fighter). Passive: after any skill the next basic dashes for 140% PA. S1 roll+slam 270->370 (+110% Extra PA) 40% slow 2 s (CD 8.5->6.5). S2 spin 345->570 (+120% Extra PA) (CD 6->4). Ult passive +10/20/30% hybrid lifesteal; active AoE -30% MS, -10/15/20 hybrid DEF on enemies, +10/15/20 DEF per hero hit, other CDs halved 6 s, recast shockwave 400/550/700 (+200% Extra PA) (CD 40/35/30).

**Gusion** (magic assassin, mana). Passive: each cast adds a rune (4): next basic +3% target max HP, heals 50 (+25% MP). S1 throw 200->300 (+50% MP) then blink behind for 200->300 (+100% MP) (CD 9->6, mana 70). S2 5 daggers 110->210 (+50% MP), 6% slow stacking to 30%, recall 65->115 (+40% MP) (CD 11->9).

**X.Borg** (energy fighter, armor HP). Base HP 998->2524; armor inherits 120% extra HP; on break rolls out invulnerable. S1 flame cone 7 x 25->100 (+60% PA)(+40% MP) over 2 s (CD 4). S2 5 stakes 50->100 (+20% PA) that pull (CD 12->9). Ult charging spray 12 x 90-110 (+130% Extra PA)(+90% MP), 25% slow, detonates after 3 s for 300/500/700 + 15% max HP true (CD 30/27/24).

### 1.12 Archetype and signature-mechanic catalogue [H]

| Archetype | MLBB instances |
|---|---|
| Dash / blink | Chou Shunpo (CC-immune), Saber Charge, Gusion blink-behind, Fanny cable (terrain hook), Karina dash + return, Lesley backhop |
| Skillshot | Layla bomb (first hit), Franco hook (first unit), Eudora cone, Nana boomerang, Hanabi kunai |
| Zone | Hylos pathway, Estes domain, Eudora ult, Nana ult (3 delayed strikes) |
| Targeted | Eudora S2, Zilong S1/S2, Angela tether, Saber/Chou/Fanny ults |
| Shield | Hanabi, Chou, Freya, Angela (global), Aldous |
| Heal | Estes, Rafaela, Angela waves, Zilong/Freya per-hit |
| Stun / airborne / pull | Eudora, Tigreal ult, Rafaela ult, Lolita / Tigreal S2, Chou S1 3rd, Saber ult, Freya S1 / Franco hook, Tigreal ult, Argus hand, X.Borg stakes, Kagura ult |
| Suppression | Franco ult (3 heroes game-wide) |
| Conceal | Lesley S1, Miya ult |
| Execute / true damage | Balmond ult, Karina 3rd hit, Zilong <50% bonus / Lesley, X.Borg |
| DEF shred | Chou, Zilong, Balmond, Saber, Eudora |
| CC resistance | Chou, Hanabi shielded, Freya ult (immunity); Zilong ult (slow immunity); Aldous 30%, Freya 50%, Terizla 35% (DR) |

Signature mechanics seen: marks with payoff (Eudora 5 s, Layla 3 s, Fanny 2 stacks, Angela 5, Saber 5, Hanabi); permanent stacks (Aldous cap 650); combat states with enhanced basics (Karina 3.5 s, Freya 12 s, Zilong 7.5 s, Lesley 3 s); placed object with dual-mode skills (Kagura); terrain traversal (Fanny, Hylos); alternate resources (energy, rage, mana->HP, armor HP, orbs); attach to ally (Angela); global reach (Aldous, Rafaela revive, Angela shield); projectile block/reflect (Lolita S2, Karina S1, Tigreal 4-stack); conditional CD resets (Zilong S2 on kill, Karina ult on kill, Chou 3rd hit, Eudora 50% refund); multi-cast skills (Chou x3, Tigreal S2 recast, Gusion throw+blink, Argus hand+dash, X.Borg early detonate); channels with interrupt windows (Tigreal ult half/half, Lolita 2 s, Angela 2 s, Aldous stance).

### 1.13 Source discrepancies (patch drift) [H]

Fandom (newer) vs Liquipedia (official skill pages from Feb 2023) differ on: Tigreal S2 CD (12.5->10 vs 16->13), Tigreal ult (270/350/430, 2 s, CD 45/41/37 vs 600/800/1000, 1.8 s, CD 55/50/45), Layla passive (130% vs 115%), Layla S1 mana (40-65 vs 35-60), Eudora passive (5 s vs 3 s), Angela ult (1000-1600 +200-300% MP, 12 s attach vs 600-1000 +150% MP, 20 s), Angela passive (7.5%/30% vs 5%/20%), Estes S1, Fanny L1 HP (2426 vs 2267), Franco ult CD L3 (48 vs 45). Verify in practice mode before copying any threshold.

### 1.14 Design rules distilled

1. Stat budget is the first layer of identity; movement speed is a readable role signal (240 ranged, 260 melee, 265+ only for chase heroes). Never give ranged heroes melee speed. Keep base magic DEF flat at 15 and let physical DEF differentiate.
2. One damage formula everywhere; ratio bands by slot; Extra-ATK scaling on assassins/fighters, Total-ATK or max-HP scaling on tanks/supports.
3. Kit skeleton: passive = identity hook; S1 spammable 3.5-9 s; S2 8-16 s utility/CC/mobility; ult 25-60 s with one big effect. At most one "weird" rule per hero.
4. Pick one resource per hero and make the bar colour say which.
5. CC is rationed: slows everywhere, 0.5-1.5 s stuns/immobilizes common, airborne/pull short and resilience-proof, suppression on ~3 heroes. Strong CC is short, long-cooldown, or channelled with an interrupt window.
6. Counterplay lives in conditions the target influences: first-unit skillshots minions can block, delay windows (3 s tether, 1 s bloom, 2 s charge), mark-then-payoff, conceal that breaks on damage, body-blockable projectiles, channels CC can cancel.
7. Uniqueness = one signature mechanic + one supporting interaction, not a pile of effects.
8. Tag every skill (Burst, CC, Blink, Slow, Shield, Heal, AoE, Conceal, Remove CC), give two specialty tags and a 1-10 difficulty; keep per-level constants regular.
9. Sustain split by source (lifesteal = basics, spell vamp = skills, reduced ratio on multi-hit).
10. Every role gets at least one difficulty 1-2 hero that is a clean instance of the skeleton; exotic mechanics go on high-difficulty heroes.

**Sources (section 1):** mobile-legends.fandom.com/wiki/Module:Hero/data (parsed 2026-09-21); fandom pages Ultimate, Magic_defense, Resource, Movement_speed, List_of_heroes_by_movement_speed, Slow, Physical_defense, Physical_penetration, Magic_penetration, Damage_reduction, Shield, True_damage, Lifesteal_and_Spell_Vamp, Basic_attack, Attack_speed, Cooldown, Crowd_control, Resilience, Control_and_slowing_immunity, Conceal, Hero_specialties; fandom and liquipedia.net/mobilelegends hero pages for Layla, Eudora, Tigreal, Franco, Fanny, Saber, Chou, Estes, Angela, Karina, Balmond, Freya, Zilong, Argus, Aldous, Kagura, Hylos, Lolita, Miya, Hanabi, Lesley, Nana, Rafaela, Alucard, Gusion, X.Borg.

---

## 2 Economy and minions

### 2.1 Waves

| Rule | Value | Conf |
|---|---|---|
| First spawn | 0:10 (some guides 0:11); mid wave meets at ~0:15-0:25, side lanes ~0:25-0:35 | [H] |
| Interval | 30 s, all lanes, whole match | [H] |
| Side-lane wave | 1 Infantry (melee) + 1 Lancer (ranged) + 1 Cannon (siege) every wave | [M] |
| Mid wave | 3 Lancers + 1 Infantry for the first 10 waves, then one of each type (cannon joins ~5:10) | [M] |
| Bonus window | First 10 waves, through 5:00 (was 7 waves / 3:30 before 1.6.42) | [H] |
| Gold-lane cannon | Extra gold on the cannon only, in the side lane FAR from the first Turtle: current ~30% (1.9.64 nerfed 35 -> 30); wiki also shows +45% and "20% for 5 min" (older/aggregate figures) | [M] |
| EXP-lane cannon | +35% EXP on the cannon in the side lane NEXT to the first Turtle (older: 25%); purpose: EXP laner hits level 4 before the 2:00 Turtle | [M] |
| Super minions | Spawn in a lane once its enemy Base (inhibitor) turret dies, forever; high hero damage, fast clear; same gold/EXP as normal minions; minions do 50% damage to the crystal | [H] |

### 2.2 Minion values and growth

| Stat | Value | Conf |
|---|---|---|
| Gold at 0:00 | Lancer 33, Infantry 65, Cannon 100 | [M] |
| Gold at 30:00 | ~90 / 120 / 150 (about +1.9/+1.8/+1.7 per minute, linear); 2.2.16 slightly reduced growth | [M] |
| Gold sharing | Proximity-shared to nearby enemy heroes, no last-hit needed (radius undocumented, likely ~8 units); if a non-hero lands the kill, nearby heroes get 80% | [M] |
| EXP per minion | Not published; siege minion base EXP of first 2 waves +10% (1.4.86); shared among nearby allies | [L] |
| HP / ATK absolute | Not published. Siege ATK growth 15 -> 25 per minute, 30 after an enemy Base turret falls, 33 after Lord | [M] |
| Move speed | Base +15% (Classic); from 12:00 +10/min (wiki) or +30/min (NamuWiki, patch "15 -> 30") to a +120 cap (older: from 9:00, +15/min) | [M] |
| Lord effect | Next wave(s) greatly enhanced | [M] |

### 2.3 Gold sources

| Source | Value | Conf |
|---|---|---|
| Passive income | 6 gold per 2 s (3/s, 180/min); history 2/s -> 5 per 2 s (1.5.24) -> 6 per 2 s. Brawl: 2500 start + 8/s | [M] |
| Starting gold (Classic) | Not on any wiki; measure in practice mode | [L] |
| Hero kill | 50-400 depending on victim's deaths and bounty; community shorthand ~200 fresh. Kill bonus gold 80 -> 60, max bonus per match 400 -> 300; each repeat death reduces the victim's value by 20 (was 30), floor 50 gold / 30 EXP; killing-spree bounty grows with streak and pays only the ender; scoreboard shows bounty when >= 120 | [M] |
| Assist | 60% of the kill reward (was 70%); credit for damage, shields/heals/buffs on the killer or debuffs on the victim; summons credit the owner; death to minions/turrets with no hero credit = "executed", no gold | [M] |
| Comeback bounty | When the team behind in total gold kills an enemy with a lead, the whole behind team gets extra gold scaled by that enemy's gap to their 5-player average; activates only when the team deficit > 2000 (was 2500); boosted +33% then +50% | [M] |
| Turret destroyed | Team-wide: Outer 60-100, Inner 80-120, Base turret 100-160 (retuned many times); Gold page: main 100-150, outer energy shield 120-200; 2.2.16 "Golden Turrets" raised turret gold | [M] |
| Outer shield damage | 1 gold per 10 damage to the 5000 shield = up to 360 per lane | [H] |
| Turtle | 60/70/80 gold to every player for the 1st/2nd/3rd | [H] |
| Lord | 75 + 15 x game-minute team gold (older flat 300) | [H] |
| Jungle | Buffs ~120 each, camps ~50-70, crab ~90 (see 4.3) | [M] |

### 2.4 Role economy rules

- Jungler (Retribution): minion gold/EXP heavily reduced until 5:00 (wiki -70% with jungle boots; guides 40-50%), cannot share minion rewards with allies before then, +30 gold per kill/assist as compensation [M].
- Roamer (Roaming boots "Devotion"): takes no minion/creep rewards for the first 8-9 min while allies are nearby; must earn 600 roam gold to unlock the blessing; the lowest-gold teammate receives the roamer's passive gold (12 per 4 s) or EXP (25 per 4 s) until they overtake; gold sharing starts at 8:00; roaming bonus is lost if the roamer overfarms [M].

### 2.5 Recall and respawn

| Rule | Value | Conf |
|---|---|---|
| Recall | Channel, free, interrupted by damage/CC. Duration reported as 8 s by one guide and ~3.5-4 s by community; not on the wiki | [L] |
| Respawn (since 1.4.86) | 3.2 s + 2.1 s x level + match minutes. L1 at 1:00 = 6.3 s; L8 at 8:00 = 28 s; L15 at 20:00 = 54.7 s; L15 at 30:00 = 64.7 s. Later patches: shorter before 20 min, faster growth after, reduced again after 25 min, "greatly increased" at 18:00. Guides: early 5-20 s, mid <= 60 s, late up to ~100 s. Brawl max 50 s | [M] |

### 2.6 Match phases [M]

Early 0-5 min (0:10 minions, 0:20-0:25 buffs, ~0:30 camps, ~0:45 crabs, 2:00 Turtle, 5:00 shields/bonuses/jungler penalty end). Mid 5-12 min (8:00 Lord, roamer starts sharing). Late 12+ (12:00 Lord enhanced + minion speed-up; 18:00 Lord evolved, longer death timers, faster fountain/base speed). Typical match 10-25 min (fast 10-15, normal 16-25, 26+ very late); surrender unlocks at 5:00.

### 2.7 Design rules distilled

1. Small frequent waves (3-4 units every 30 s from 0:10) make wave-clear speed a real balance stat.
2. Gold is proximity-shared; laning is positioning and trading, not last-hitting. Add a small last-hit bonus only to create a skill ceiling.
3. Lane identity comes from the cannon minion: far lane +~30% gold, near lane +~35% EXP, for 10 waves.
4. Passive income of 3 gold/s keeps tanks/supports relevant; pair with a comeback bounty gated at >2000 deficit.
5. Kill gold decays on repeat deaths (-20, floor 50), streak bounties pay the ender, assists pay 60%.
6. Respawn is a linear formula (3.2 + 2.1 x level + minutes): cheap to implement, easy to tune; late deaths should cost 55-65 s.
7. Role split is enforced by items (jungle and roam penalties), not by hard rules.

**Sources (section 2):** mobile-legends.fandom.com/wiki/Minions, Match_Details_&_Timestamps, Turret, Battlefield_Guide, Gold, Kill, Gold_Laner, EXP_Laner, Lane_cutting, Classic, Patch_Notes 1.1.23.109.1 / 1.1.40 / 1.4.86 / 1.5.24 / 1.6.42 / 1.8.88; liquipedia.net/mobilelegends/Patch_1.6.42, Patch_1.9.06, Patch_1.9.64; en.esportsku.com (minion spawn, respawn, match length); NamuWiki MLBB Minions & Monsters; grandvoucher.com recall guide; mlbbhub.com/patch-notes/original/2.2.16.

---

## 3 Turrets and base

### 3.1 Layout [H]

9 turrets per team: 3 lanes x (Outer, Inner, Base/inhibitor) plus the Base crystal. Turrets in a lane are invincible with hidden HP until the one in front falls. Any Base turret falling exposes the crystal and releases super minions in that lane. Turrets never attack jungle creeps.

### 3.2 Stats (Classic) [M]

| Structure | HP | ATK (start -> late) | Phys/Mag DEF | Notes |
|---|---|---|---|---|
| Outer | 4500 (one snippet says 6000; wiki attributes 5500 -> 6000 to Inner in the Mythic variant) | 320 -> 404 (+3.82/min) | 20/20 | Energy shield until 5:00 |
| Inner | 5500 (6000 Mythic) | 360 -> 459 | 20/20 | 2.2.16 raised HP |
| Base turret | 6900 | 520 -> 641 | 40/40 | Doubles as inhibitor; 2.2.16 raised HP |
| Base crystal | 7900 | 539 -> 585 | 40/40 | Self-repairs 165 HP every 5 s; minions do 50% damage |
| All | attack range 5.3 units, sight 8 units, 1 attack/s | | | |

Footprint / collision radius is not documented anywhere; measure it in practice mode (see 7). For reference the attack range is 5.3 units against a melee reach of 1.8 and a hero-to-hero spacing of well under 1 unit, so the visual base should read as a fraction of the range ring, not a large fraction of it.

### 3.3 Damage rules [H]

- True damage = 100% ATK, once per second, cannot be reduced by hero defenses; two turrets stack independently.
- Hero ramp: each consecutive hit on the same hero adds 75% of the initial hit (320, 560, 800, 1040 ... 4880 at the 20-hit cap = +240 per hit for an outer). Ramp resets after 2 s without the turret damaging that hero (leaving range not required). First hit on a hero is reduced 10%.
- Priority: locks the first targetable enemy that enters range; among non-heroes prefers a Summoned Lord; switches to an enemy hero that damages an allied hero within (slightly beyond) range and stays on them until untargetable, out of range or dead; damage to the turret itself never causes a switch. Reveals camouflaged/invisible units after a short delay.
- Anti-backdoor: 50% reduced damage taken when no enemy minions are in its range.
- Range indicator [M]: yellow = you would be targeted, green = a minion is tanking, red = you are the target.

### 3.4 Early protection [H]

- Outer Energy Shield 0:00-5:00 (was 210 s before 1.5.24): absorbs 5000 damage, reduces damage taken 30% (older: 60% vs ranged / 30% vs melee); attackers earn 1 gold per 10 shield damage (max 360 per lane); minions deal a fixed 75 to it; allied heroes near a shielded turret take 15% less damage (25% on the Gold-lane outer in the Mythic variant).
- Orange Alert: if an Outer dies before 8:00 the Inner behind it gets +60 phys/mag DEF and 50% (was 40%) damage reduction for 1 minute.
- Base turret: since 1.6.42 deals heavy damage to the next enemy minion wave entering its range during the first 12 min ("Holy Defense"); inner/base DR windows expire at 8:00 / 12:00.
- Summoned Lord charge disables a turret for a few seconds and deals 30% (8-18 min) / 50% (Enhanced/Evolved) of its max HP as true damage; the turret shield cannot knock it back.

### 3.5 Design rules distilled

1. Turrets are lethal but predictable: 1 hit/s true damage, +75% per consecutive hero hit to a 20-hit cap, 2 s reset, retarget only when a hero hits an allied hero, never because of damage to the turret.
2. Use the 5-minute 5000-HP shield with 30% DR and 1 gold/10 damage instead of LoL-style plates; add a 1-minute 50% DR on the next turret if one falls before 8:00.
3. 50% damage reduction with no enemy minions in range makes lone backdoors inefficient without banning them.
4. The Base turret is the inhibitor: its death releases super minions and exposes a 7900-HP crystal that regens 165 per 5 s and takes half damage from minions, so heroes must commit.

**Sources (section 3):** mobile-legends.fandom.com/wiki/Turret (infoboxes, Turret Damage table, Turret Priority, Energy Shield, Mythic Battlefield), Battlefield_Guide, Match_Details_&_Timestamps, Classic, Lord, Patch_Notes_1.5.24, Patch_Notes_1.1.23.109.1; liquipedia.net/mobilelegends/Patch_1.6.42; mlbbhub.com/patch-notes/original/2.2.16; boostroom.com (range indicator colours).

---

## 4 Jungle and objectives with timings

### 4.1 Event clock

| Time | Event | Conf |
|---|---|---|
| 0:10 | First minion wave | [H] |
| 0:20-0:25 | Molten Fiend (orange) 20 s, Thunder Fenrir (purple) 25 s (1.5.38 moved 30 -> 25); respawn 90 s (was 120) | [H] |
| 0:25-0:40 | Small camps: Lava Golem 31 s, Fire Beetle 39 s, Horned Lizard 40 s; respawn 70 s. Patch 2.1.88 moved first spawn to 25 s and made the first small-camp kill grant Lv2 instantly | [M] |
| 0:35-0:45 | Lithowanderer (river) 35 s wiki / ~45 s guides; respawn 120 s | [M] |
| 0:42 | Little Crab (respawn 20 s); full Scavenger Crab from 3:00 (Battlefield Guide 2:00), respawn 120 s (older guides: small crab 15 s, full crab 45 s) | [M] |
| 1:20-1:45 | Full 5-camp clear = exactly Lv4 | [H] |
| 2:00 | First Turtle; jungler's own-jungle 15% DR and anti-invade creep damage end | [H] |
| 5:00 | Outer shields drop, cannon bonuses end, jungler minion penalty ends | [H] |
| 6:00 | No new Turtle if the last one dies after this | [H] |
| 8:00 | First Lord (or 2 min after the last Turtle dies); inner-turret DR expires; roamer shares gold | [H] |
| 12:00 | Lord Enhanced; base-turret DR expires; minion speed-up | [H] |
| 18:00 | Lord Evolved, stats frozen; death timers up; fountain speed up; Lord respawn 120 s (wiki body) / 150 s (infobox, mlbbhub, 1.9.64) | [M] |

### 4.2 Layout [M]

Each jungle has two quadrants: EXP-lane side = Thunder Fenrir duo (purple) + Horned Lizard; Gold-lane side = Molten Fiend (orange) + Lava Golem + Fire Beetle. The crab sits at the outer edge of each side lane; the Lithowanderer patrols the river beside mid between two single river bushes. First Turtle always spawns in the pit next to the EXP lane; the Lord pit is on the Gold-lane side. Both teams' EXP laners share the same physical lane (map mirrored; each team sees itself bottom-left). Clearing Fenrir opens a "Hero's Path" shortcut behind the camp until it respawns.

### 4.3 Creep stats (spawn value, +per minute; value at 12:00) [H unless noted]

| Creep | HP | Phys ATK | DEF (P/M) | Special | Reward |
|---|---|---|---|---|---|
| Thunder Fenrir (purple) | 4090 +230.22 (6622) | 226 +3.84 (268) | 60 +2 / 0 | Duo with Little Fenrir (fast, low HP; kill first); 3 fruits on death healing 153 (+1% ATK) and 0.2% mana, 5 s | 100 + 22 gold (wiki, likely incl. Retribution) [L]; base 28 (+1.07/min), little 6 gold / 78 EXP (1.5.38) |
| Molten Fiend (orange) | 4941 +158.22 (8111) | 214 +3.84 (256) | 37 +2 / 37 +2 | 3 fruits | 120 gold [L]; base 32 (+1.07/min) |
| Horned Lizard | 3019 +156.69 (4743) | 110 +2.30 (135) | 37/37 | Ranged; below 50% HP +70 P/M DEF | 92 gold [L]; Healing Buff |
| Fire Beetle | 2501 +126.69 (3895) | 113 +2.30 (138) | 37/37 | Leaves Little Fire Beetle for 15 s (bonus kill) | Healing Buff |
| Lava Golem | 3000 +81.50 (3897) | 156 +2.30 (238) | 37/37 | none | 81 gold [L]; Healing Buff |
| Scavenger Crab | 3640 +384.30 (7867) | 55 +1.15 (68) | 37/37 | | 36 gold [L]; Gold Buff 60 over 18 s (older: 100 over 30 s); Little Crab 30 over ~10 s; Gold-lane crab gives gold, EXP-lane crab gives EXP [M] |
| Lithowanderer | 2251 +345.90 (6056) | none (never fights) | 60 / 0 | CC-immune; dies at HP < 3 | 92 gold [L]; +15% MS in river 45 s (survives death); Walkie Grass follows killer restoring 1% mana/s to allies within 6 units; friendly Stone Roamer patrols the spot 45 s, alerts and reveals enemies, killable |

All creeps attack every 1 s for 100% ATK physical. Healing Buff: 5% mana + 350 HP over 2 s. Creep gold after 2.1.90 (+20% buffs, +15% small) and 2.2.16 (-13% small) is unverified [L]. Creep EXP was rebalanced in 2.1.88 so five creeps still equal Lv4 exactly [H]. Anti-duo: a creep takes less damage with more than one hero near it; creeps see through bushes and stealth, and reset if the attacker leaves [M]. Jungle rewards were 85% last-hitter / 30% allies in 2017 [L].

### 4.4 Buffs (75 s, were 120 s before 1.5.38) [H]

- Purple, Thunder Morale: -10% cooldown, -60% mana cost (Jungle page -40%), -25% energy cost; kills heal 3% (minion) / 8% (hero) / 12% (creep) HP.
- Orange, Molten Morale: each attack on a hero triggers Soul of Lava (3 s CD) true damage + 1 s slow, role-based. Assassin/Fighter/Tank: 5% adaptive pen, 50 (+20% PA)(+30 x AS) true, 60% slow. MM/Mage/Support: 10% adaptive pen, 50 (+30% PA)(+50 x AS) true, 20% slow.
- Buff transfer on killing the holder: not documented; treat as unconfirmed [L].

### 4.5 Retribution (jungle spell)

| Piece | Value | Conf |
|---|---|---|
| Active | 750 (+150 x level) true damage to a creep/minion (Lv4 1350, Lv15 3000), CD 35 s; pre-2.1.88: 520 (+80 x level) | [H] |
| Passive | Creep rewards +60%; creep damage taken -40% (older -50%; Lord/Turtle excluded); +15% DR in own jungle for the first 2 min; marksmen deal 50% Retribution damage to creeps (guides only) | [M] |
| Penalty | Minion gold/EXP -70% (wiki) / 40-50% (guides) until 5:00, no sharing; +30 gold per kill/assist | [M] |
| Upgrade | After 5 creep kills + kills + assists (minions excluded) becomes the boots-chosen variant; at 15 grants +15 PA and +15 MP. Vs hero: 100 true damage + Flame steals 35-70 (or 58-100) ATK/MP 3-4 s; Ice steals 41-90 (or 52-80) MS; Bloody steals 250-300 (+20-24% caster extra HP) HP over 3 s; jungle boots make creep damage 150% | [M] |
| Secure rule | Retribution secures when objective HP <= 750 + 150 x level | [M] |

### 4.6 Turtle [H unless noted]

| Piece | Value |
|---|---|
| Timing | 2:00; respawn 120 s; countdown and location shown 120 s; none after 6:00; alive at 8:00 and undamaged for 5 s -> becomes Lord (delayable to 9:00); max ~3-4 per game |
| Stats | HP 10367 +1067.15/min (4:00 12,501; 6:00 14,636); ATK 260 +21.72/min; DEF 15 +10/min; 1 attack/s physical; HP bar segments of 2000 (heroes/creeps 1000); chase ~460 units then resets and heals [M] |
| Team reward | 60/70/80 gold each (300/350/400 team) + large scaling EXP + shield 200 (+20 x level) for 120 s |
| Killer reward | Instant heal + Turtle's Blessing shield 400 (+40 x level), re-forms after 5 s without hero damage, +20 (+2 x level) PA and +25 (+4 x level) MP while up, 120 s (June 2025: until the next Turtle dies) [M] |
| 28 Sep 2026 rework | "Healing Turtle": no shield; an allied Turtle spawns on the enemy's strongest lane and pushes, allies near it heal rapidly and get Turtle companions; gold still team-wide; numbers unpublished [M] |

### 4.7 Lord [H unless noted]

| Piece | Value |
|---|---|
| Timing | 8:00 or 2 min after the last Turtle; respawn 180 s (8-18 min), then 120-150 s; Enhanced 12:00, Evolved 18:00 |
| Stats | HP 31,743 +2,242/min (~43k at 12, ~56k at 18, frozen); ATK 428 +20.15/min (670 at 12); DEF 37/37; cannot be stunned; 2025 patch cut HP growth 5% |
| Attacks (all true) | Basic every 1 s 100% ATK small AoE; Thunder Strike every 4 s 110% ATK large AoE; Torrent every 8 s 150% ATK + 1 s airborne. Before 12:00 it uses Thunder Strike only after 3 basics and Torrent after strike + 4 basics; later Lords cast immediately |
| Pit | Its animations are visible to everyone without vision; if enemies attack it with no ally nearby a sound and glowing icon fire (Turtle has neither); the pit area has the most bushes on the map |
| Kill reward | Team gold 75 + 15 x minute + EXP; Lord summoned for the killers |
| Summoned Lord | Spawns at base with the next wave (3-33 s delay: slain xx:10-xx:40 -> xx:43; slain xx:40-xx:10 -> xx:10) behind the siege minion; walks the lane with the fewest enemy turrets (tie: lowest-HP outer; else mid); counts as an allied hero; turrets target it first; charges a sighted turret for 30% (50% Enhanced+) max-HP true damage and disables it briefly; DR 15-35% (+4% per nearby ally); allies near a 12 min+ Lord deal +250 (+50% PA)(+50% MP)(+2.5% max HP) magic every 2 s; enhances the next wave (infobox) or every wave until it dies (body) [M]; its damage never affects the Lithowanderer |
| Contest heuristics [M] | Clean pit 1x time, contested 1.6-3.2x; needs Retribution up; safest after an ace, with 2-3 enemies dead, or when the enemy Retribution is on cooldown; Seasoned Hunter talent +15% damage to Lord/Turtle |

### 4.8 Bushes and vision [H unless noted]

- No purchasable wards. Vision comes from allied heroes, minions (8 units, cannot see into bushes or camouflage), turrets (8 units, reveal stealth after a delay), jungle creeps (see everything nearby incl. bushes/stealth), summons (Stone Roamer 45 s), Selena trap (1 min), Yi Sun-shin ult (map-wide), and from 28 Sep 2026 "Revealing Wisps" pickups that orbit the hero then fly to and reveal hidden enemy heroes in a large range [M]. Hero vision radius is identical for all heroes; exact value unpublished [L].
- Bush concealment after 0.25 s with no enemy vision source inside, 0.75 s if an enemy saw you before entering; concealment lingers (a dash between adjacent bushes keeps you hidden).
- Revealed for 3 s (and on the minimap) when you basic-attack a minion or damage a nearby enemy hero with a basic or skill, even inside the bush; skills on minions with no enemy hero nearby do not reveal; enemy skills that hit you still show your HP bar; any enemy unit or trap in the same bush sees everyone in it; re-entering a bush refreshes concealment faster than staying.
- Camouflage vs invisible vs half-stealth: see 1.9. Roaming boots Conceal = 5 s camouflage; Natalia camouflages after 1 s in a bush.
- Scale references: Flicker 3.8 units, Walkie Grass 6 units, minion/turret sight 8, turret attack 5.3 (Layla max range ~1.5x turret range).

### 4.9 Design rules distilled

1. Run the match on a fixed event clock; every system change lands on one of those timestamps.
2. First full clear = Lv4 at ~1:20-1:45; tune creep EXP as a set; instant Lv2 on the first small camp.
3. Scale every neutral linearly per minute (HP mostly, ATK slightly, DEF a little); freeze the Lord at 18:00.
4. Gate jungling behind a spell: +60% creep rewards, -40% creep damage, a 35 s true-damage secure, heavy minion penalty and no sharing until 5:00.
5. Make "secure" a readable puzzle: Retribution = 750 + 150 x level vs HP bars drawn in 2000-HP segments.
6. Buffs last 75 s vs a 90 s respawn so the jungler always has a next camp; orange is slow-heavy for melee and damage-heavy for ranged.
7. Turtle = early team gold + EXP + shield; Lord = late siege unit (true damage, turret charge, enhanced waves, escort-scaled DR), not a stat buff.
8. Vision from units, not wards; bushes conceal after 0.25/0.75 s; damaging a hero reveals for 3 s; one enemy in the bush breaks it for everyone.
9. Creeps punish ganks on the jungler (see through stealth, take less damage from multiple heroes, reset if you leave) and never fight turrets.
10. Heroes pass through each other and through jungle monsters (user requirement; matches MLBB's non-blocking unit collision). Only terrain and walls block.

**Sources (section 4):** mobile-legends.fandom.com/wiki/Jungle, Thunder_Fenrir, Molten_Fiend, Horned_Lizard, Fire_Beetle, Lava_Golem, Lithowanderer, Crab, Turtle, Lord, Bush, Conceal, Buff, Kill, Turret, Minions, Emblems, Battle_spells, Battlefield_Guide, Match_Details_&_Timestamps, Patch_Notes/1.8.56; mlbbhub.com (map, guides/jungle-rotation, retribution-simulator, patch-notes 2.1.88 / 2.1.90 / 2.2.16); oneesports.gg (Lithowanderer, EXP laner); theriagames.com Retribution guide; mlbbcentral.com Retribution types; pinoytechsaga.blogspot.com vision guide; timesaver.gg Sanctum Island S42; news.bittopup.com 2.1.18 roaming rework; synnmlbb.com June 2025 patch; NamuWiki MLBB Minions & Monsters.

---

## 5 Items, spells and formulas

### 5.1 Formulas [H]

| Formula | Statement |
|---|---|
| Defense multiplier | taken = 120 / (120 + DEF), floor DEF -60, same for magic |
| Penetration order | TotalDEF = (DEF - flat DEF reduction) x (100% - %DEF reduction - %pen) - flat pen; if DEF <= 0 the percentage terms are skipped |
| Full pipeline | Actual = (Attacker DMG x 120/(120 + TotalDEF)) x (100% - %DR) - flat DR. Crit is applied before defense; %DR after; DR stacks additively with no cap and does not reduce true damage (except debuff-type reductions like Gloo passive / Kaja Paralyzed) |
| Crit | Default 0% chance, 200% damage; total = DMG x (200% + extra crit dmg); chance and damage stack additively; basic attacks only (plus Windtalker's Typhoon and a few skills) |
| Attack speed | Total = base + (item %AS x hero AS ratio); cap 3.00/s (5.00 with Inspire; Golden Staff 3rd hit 500%) [M] |
| Cooldown reduction | Cap 40% (45% with Enchanted Talisman) |
| Movement | MS x (100% + speedups - slows); x/100 units per second; diminished below 230 and above 420; max slow 90% [M] |
| Lifesteal / spell vamp | Lifesteal heals from basic-attack damage only: dmg x lifesteal x per-attack ratio (30-120%); spell vamp from skill damage only: dmg x vamp x per-skill ratio (30-120%, multi-hit usually 40-100%); hybrid lifesteal covers both; both scale with healing-received modifiers, not healing-effect modifiers |

### 5.2 Stat sources [H]

- Crit chance: Berserker's Fury 25%, Great Dragon Spear 20%, Haas' Claws 20%, Windtalker 20%, Rogue Meteor 10%, Javelin 8%, Fatal talent 5%.
- Attack speed: Windtalker 35%, Corrosion Scythe 30% (+6%/stack x5), Demon Hunter Sword / Feather of Heaven / Malefic Gun / Rose Gold Meteor / Sea Halberd / Wind of Nature / Swift Crossbow 20%, Golden Staff 15% (+1% AS per 1% crit), Haas' 15% (+20% 2 s on crit), Swift Boots 15%, Rogue Meteor 15%, Regular Spear / Knife 10%, MM emblem 15%, Swift talent 10%.
- Physical pen: flat Heptaseas 15, Hunter Strike 15, Fury Hammer 12, Assassin emblem 14 adaptive, Rupture 5; percent Malefic Roar 30% + Breaker (0.1% per enemy phys DEF, cap 30%), Malefic Gun 30%, Orange buff 5/10% adaptive, MM emblem 10% adaptive.
- Magic pen: Divine Glaive 40% + Spellbreaker (0.1% per enemy magic DEF, cap 20%), Arcane Boots 10, Genius Wand 10, Mage emblem 8.
- Lifesteal: Haas' 20%, Feather / Rose Gold / Wind of Nature 10%, Vampire Mallet 8%. Spell vamp: Ice Queen Wand 10%, Queen's Wings 10%, Mystic Container 8%, Festival of Blood 6-12%. Hybrid: Fighter emblem 10%, War Axe 8%, Concentrated Energy 20%, Starlium 8%.

### 5.3 Shop rules [H]

6 slots. Sell-back 100% within 15 s, then 60% (boots 20%). Unique passives and attributes never stack; boots and jungle items do not stack; basic attributes do stack if bought twice. Price ladder: tier-1 components 120-450, tier-2 600-1050, finished 1820-2500, two capstones at 3000+ (Blade of Despair 3010, Holy Crystal 3000). All finished boots 720 (Boots 250).

### 5.4 Boots and roam blessings [H]

| Boots (720, +40 MS) | Stats and passive |
|---|---|
| Warrior | +18 phys DEF; Valor +4 phys DEF (3 s) per physical hit taken, up to 20 |
| Tough | +18 magic DEF; Fortitude CC and slow durations -25% |
| Swift | +15% AS |
| Magic Shoes | +10% CDR, +150 HP |
| Rapid | +55 MS instead of 40, +35% slow reduction, +12 HP regen |
| Demon | +10 mana regen; minion kill/assist restores 4% mana |
| Arcane | +15 MP, +10 magic pen |
| Boots (250) | +20 MS |

Roaming blessings (roamer takes no minion/creep gold for 8 min with allies nearby; 600 roam gold to unlock; extra gold/EXP flows to the poorest ally; assists pay extra): Conceal = allies camouflaged + 30-75% MS 5 s; Encourage = nearby allies +13-33 PA/MP and +15% AS; Favor = every 15 s the next heal/shield also heals 480-1200 to the lowest-HP ally within 5 units; Dire Hit = every 30 s, hitting a hero below 35% HP deals 7-18% max HP (half phys, half magic).

### 5.5 Attack items [H]

| Item | Price | Stats | Passive |
|---|---|---|---|
| Blade of Despair | 3010 | +160 PA, +5% MS | Despair: damaging non-minions below 50% HP grants +25% PA 2 s (applied before the hit) |
| Malefic Roar | 2060 | +60 PA | +30% phys pen; Breaker +0.1% pen per enemy phys DEF, cap 30% |
| Malefic Gun | 2120 | +40 PA, +20% AS | +30% phys pen; +12% basic range; +10% MS 0.5 s on hit |
| Berserker's Fury | 2390 | +60 PA, +25% crit, +30% crit dmg | Doom: basic crits deal 12% of pre-reduction damage as true |
| Windtalker | 1880 | +35% AS, +20% crit, +20 MS | Typhoon: every 5 -> 2 s (-0.2 s per basic) next basic hits up to 3 for 150-362 magic (can crit; 200% vs minions) |
| Demon Hunter Sword | 2180 | +35 PA, +20% AS | Engulf: basics deal 8% target current HP (cap 60 vs minions); Devour: heal 10 (+4 x level) per basic, halved vs minions |
| Golden Staff | 2000 | +55 PA, +15% AS | 1% AS per 1% extra crit; every 2 non-crit basics the next gets +80% AS (cap 500%) and triggers on-hit effects 2 extra times |
| Sea Halberd | 2050 | +80 PA, +20% AS | Lifebane: shields/HP regen on target -> 60% for 3 s; +8% damage vs heroes with more extra HP than you |
| Endless Battle | 2330 | +60 PA, +250 HP, +10% CDR, +5% MS, +5 mana regen | After a skill, next basic within 3 s deals +60% PA true and heals 80 (+40% PA); 1.5 s CD |
| Hunter Strike | 2010 | +80 PA, +10% CDR, +15 phys pen | 5 consecutive hits on the same hero/creep -> +50% MS decaying 3 s (8 s CD) |
| Blade of the Heptaseas | 1950 | +70 PA, +250 HP, +15 phys pen | Ambush: after 5 s out of hero combat next basic +160 (+40% PA) and 40% slow 1.5 s |
| Sky Piercer | 1500 | +60 adaptive, +15 MS | Executes heroes below 4% HP after you damage them; +10 stacks per kill, -30% on death, +0.1% threshold per stack, max 80 (12%) |
| War Axe | 2100 | +35 PA, +400 HP, +10% CDR, +8% hybrid LS | +12 PA per second in combat 4 s up to 6 stacks; at full, 10% of damage dealt as extra true (50% for MM/Mage/Support) |
| Rose Gold Meteor | 2030 | +30 PA, +20% AS, +10% LS | +1 hybrid DEF per 4 extra PA to 50 (halved if not Fighter); below 30% HP: 120 x level shield + 50% MS decaying 3 s (60 s CD) |
| Great Dragon Spear | 2140 | +70 PA, +10% CDR, +20% crit | After ult +30% MS 7.5 s (15 s CD) |
| Haas' Claws | 2020 | +40 PA, +15% AS, +20% crit, +20% LS | Crits grant +20% AS 2 s |
| Corrosion Scythe | 2050 | +30 PA, +30% AS, +5% MS | Basics +80 phys and 8% slow (halved for ranged) 1.5 s up to 5 stacks; +6% AS per basic 3 s up to 5 |
| Wind of Nature | 1910 | +30 PA, +20% AS, +10% LS | Active: immune to physical damage 2 s (halved if not MM); 90 s CD |
| Winter Crown | 1910 | +45 adaptive, +400 HP, +5% CDR | Active: untargetable and immune 2 s, cannot move/cast; 100 s CD |
| Fleeting Time | 2050 | +30 adaptive, +600 HP, +15% CDR | Kill/assist reduces current ult CD 30% |

### 5.6 Magic items [H]

| Item | Price | Stats | Passive |
|---|---|---|---|
| Holy Crystal | 3000 | +165 MP | +21-35% extra MP scaling with level |
| Lightning Truncheon | 2250 | +75 MP, +400 mana, +10% CDR | Every 6 s the next skill echoes 255 (+85% MP) magic to all enemies in range |
| Divine Glaive | 1970 | +65 MP | +40% magic pen; Spellbreaker +0.1% per enemy magic DEF, cap 20% |
| Genius Wand | 2000 | +75 MP, +5% MS, +10 magic pen | Magic damage to heroes -2.5 (+0.5 x level) magic DEF 2 s, up to 3 stacks |
| Glowing Wand | 2150 (mlbbhub 2050) | +60 MP, +300 HP, +5% MS | Scorch: 1% max HP per second for 3 s; Lifebane 60% shields/regen 3 s |
| Concentrated Energy | 2020 | +75 MP, +400 HP, +20% hybrid LS | +5 MP per magic hit up to 6 (1 per 0.4 s); at full +12% magic damage 5 s |
| Blood Wings | 2100 | +90 MP | 800 (+100% MP) shield regenerating 20 s after damage; +30 MS while up, +150 MS 1 s on break |
| Ice Queen Wand | 2040 | +60 MP, +10% SV, +300 HP, +7% MS | Skill hits slow 10% 2 s up to 3 stacks, 0.4 s internal CD |
| Starlium Scythe | 2120 | +75 MP, +10% CDR, +8% hybrid LS, +6 mana regen | After a skill next basic within 3 s deals 90 (+60% MP) true and slows 15% 1.5 s (1.5 s CD) |
| Calamity Reaper | 1950 | +70 MP, +100 mana, +6 mana regen, +10% CDR | After a skill next basic within 3 s deals 120% MP true (1.5 s CD), brief +10% MS |
| Feather of Heaven | 2030 | +60 MP, +20% AS, +10% LS, +5% CDR | Basics +50 (+30% MP) magic; +6% AS per basic 3 s up to 5 |
| Enchanted Talisman | 2070 | +70 MP, +300 HP, +15% CDR | 15% max mana every 10 s; CDR cap 45% |
| Clock of Destiny | 2030 | +45 MP, +400 HP, +400 mana, +10% CDR | +4.5 (+0.5 x level) hybrid DEF 5 s per magic hit on heroes up to 6; below 50% HP/mana recover 15% over 3 s (60 s CD) |
| Wishing Lantern | 2250 | +75 MP, +400 mana, +10% CDR | Every 900 magic damage to a hero summons a butterfly dealing 8% current HP |
| Flask of the Oasis | 1850 | +60 MP, +300 HP, +10% CDR, +12% healing | Healing/shielding an ally below 35% grants 100 x level shield 3 s and -2 s on caster CDs (60 s per target) |
| Necklace of Durance (legacy) [M] | 2010 | +60 MP, +300 HP, +380 mana, +5% CDR | Lifebane -50% 3 s; 20% HP/mana on level-up; appears removed from the 2026 shop |

### 5.7 Defense items [H unless noted]

| Item | Price | Stats | Passive |
|---|---|---|---|
| Immortality | 2120 | +850 HP (mlbbhub 800), +15 phys DEF | Resurrect after 2.5 s with 16% HP and 150 (+70 x level) shield 3 s; 210 s CD |
| Athena's Shield [M] | 2150 | +900 HP, +48 magic DEF, +2 HP regen | On taking magic damage 25% magic DR 3 s (before the hit); resets 5 s after combat |
| Antique Cuirass | 2170 | +920 HP, +40 phys DEF, +4 HP regen | Hit by a skill: attacker phys damage -6% 2 s, 3 stacks |
| Dominance Ice | 2010 | +40/+40 DEF, +5% MS | +8 hybrid DEF per enemy hero within 5 units up to 40; aura Lifebane 60% within 5 units |
| Oracle | 1860 | +850 HP, +20/+20 DEF, +10% CDR | Shields and HP regen received +25% |
| Queen's Wings | 2250 | +750 HP (mlbbhub 600), +30 adaptive, +10% CDR, +10% SV | Below 40% HP: 30% DR 3 s and -2 s CDs (60 s CD); +0.25% damage per 1% HP lost up to 15% |
| Radiant Armor | 1880 | +950 HP, +40 magic DEF, +12 HP regen | +5 (+1 x level) magic DEF 5 s per magic hit up to 6 (1 per 0.4 s) |
| Guardian Helmet | 2500 (mlbbhub 2200) | +1800 HP, +20 HP regen | After 5 s out of combat regen 2.5% HP/s; on single hits >500 recover 30 (+0.3% HP)% of the excess |
| Brute Force Breastplate | 2070 | +800 HP, +20 phys DEF, +10% CDR | +8 adaptive and +2% MS per second after dealing damage, 4 s, 6 stacks; +25% CC reduction at full |
| Thunder Belt | 1820 | +600 HP, +15/+15 DEF, +20 MS | Every 4 s next basic deals 50 (+100% extra phys DEF)(+100% extra magic DEF) true AoE with a brief 99% slow; +1 permanent hybrid DEF per hero hit (50% for MM/Mage/Assassin) |
| Cursed Helmet | 1910 | +1200 HP, +20 magic DEF | 1.2% HP magic per second to nearby enemies, +125 (+15 x level)% vs creeps/minions; -3 hybrid DEF 3 s up to 3 stacks |
| Blade Armor | 1910 | +80 phys DEF, +20% crit damage reduction | Reflect 30 (+2% phys DEF)% of pre-reduction basic damage, slow attacker 15% 1 s |
| Chastise Pauldron | 2100 | +900 HP, +40 phys DEF | Taking damage sets attacker AS and AS cap to 75% 2 s; below 30% HP recover 20% over 2 s (60 s CD) |
| Twilight Armor | 2100 | +1200 HP, +15 phys DEF | Single hits >500: excess reduced 20 (+0.2% HP)%; below 30% HP recover 20% over 4 s (60 s CD) |

### 5.8 Battle spells [H unless noted]

| Spell | Unlock | CD | Effect |
|---|---|---|---|
| Retribution | 3 | 35 s | See 4.5 |
| Execute [M] | | 90 s | 100 (+10 x level) + 13% target lost HP true, ignores shields; kill refunds 40% CD |
| Inspire | 5 | 75 s | Next 6 basics within 5 s: AS x1.5 with cap 500%, ignore 8 (+1 x level) hybrid DEF, heal 60 (+15% PA)(+10% MP) per hit |
| Sprint | 7 | 100 s | Up to +50% MS and slow immunity 6 s; decays after 2 s |
| Revitalize | 9 | 100 s | Spring: 2.5% max HP per 0.5 s for 5 s (25%), +25% shield/regen effects inside; usable while CC'd |
| Aegis | 11 | 75 s | Self shield 750 (+50 x level) 5 s; lowest-HP nearby ally 525 (+35 x level)(+70% of their lost HP); usable while CC'd |
| Petrify | 13 | 75 s | 100 (+15 x level) magic AoE, petrify 0.8 s, then 50% slow 0.8 s |
| Purify | 15 | 90 s | Remove all debuffs, 1.2 s CC immunity, +15% MS; not suppression |
| Flameshot | 17 | 50 s | Skillshot 160 (+60% MP) to 640 (+180% MP) by distance, 30% slow 0.5 s, knockback on cast, reveal 0.5 s |
| Flicker | 19 | 120 s | Blink 3.8 units, +6 (+1 x level) hybrid DEF 1 s; disabled while rooted |
| Arrival | 21 | 75 s | 3 s channel teleport to allied turret (even destroyed), base or minion; +60% MS decaying 3 s; interrupt refunds 30 s; target untargetable during channel |
| Vengeance | 23 | 75 s | 3 s: reflect 40% of damage taken as magic, 35% DR |
| Removed | | | Healing Spell (110 s, 14% max HP), Interference, Weaken, Track, Iron Wall (40% DR 3 s, 60 s) |

### 5.9 Emblems [H]

7 emblems, each 3 flat lines + 2 standard talents (of 16) + 1 core talent (of 8).

| Emblem | Lines |
|---|---|
| Common | +12 hybrid regen, +275 HP, +22 adaptive attack |
| Tank | +500 HP, +10 hybrid DEF, +4 HP regen |
| Assassin | +14 adaptive pen, +10 adaptive attack, +3% MS |
| Mage | +30 MP, +5% CDR, +8 magic pen |
| Fighter | +10% hybrid LS, +16 adaptive attack, +8 hybrid DEF |
| Support | +12% healing, +10% CDR, +6% MS |
| Marksman | +15% AS, +16 adaptive attack, +10% adaptive pen |

Standard talents: Thrill +16 adaptive; Swift +10% AS; Vitality +225 HP; Rupture +5 adaptive pen; Inspire +5% CDR +2 mana regen; Firmness +8 hybrid DEF; Agility +4% MS; Fatal +5% crit chance/damage; Wilderness Blessing +10% MS in jungle/river (halved in combat); Seasoned Hunter +15% vs Lord/Turtle; Tenacity +5% DR below 50% HP; Master Assassin +7% damage when only one enemy hero nearby; Bargain Hunter items 95%; Festival of Blood 6% SV +0.5% per K/A to 12; Pull Yourself Together -12% spell/active CD (+1% per K/A to 8); Weapon Master +8% PA/MP from equipment/emblem/talents/skills.

Core talents: Impure Rage (skill hit 4% max HP adaptive + 2% mana, cap 120 vs non-heroes, 5 s); Quantum Charge (basic hit +30% MS 1.5 s + heal 75-180, 10 s); War Cry / Temporal Reign (next ult makes other CDs tick 1.5x for 4 s, +2 s on K/A, 20 s; the two show identical text on fandom [L]); Concussive Blast (next basic 100 + 7% HP magic AoE, 15 s); Killing Spree (hit hero <30% HP: recover 15% lost HP + 20% MS 3 s, resets on kill, 30 s); Lethal Ignition (3 hits each >7% max HP within 5 s -> 162-750 adaptive, 15 s); Brave Smite (skill hit on hero heals 5% max HP, 6 s); Focusing Mark (after damaging a hero, allies +6% vs them and +10% MS 3 s, 4 s); Weakness Finder (basic slows 50% and -30% AS 1 s, 10 s CD, -1 s per basic, min 3 s).

### 5.10 Typical 6-slot builds (2026 guide) [M]

Crit MM: Windtalker, Berserker's Fury, Scarlet Phantom/Haas, Malefic Roar, Blade of Despair, Immortality. AS MM: Windtalker, Golden Staff, Demon Hunter Sword, Corrosion Scythe, Wind of Nature, Immortality. Phys assassin: Heptaseas, Sky Piercer, Hunter Strike, Blade of Despair, Malefic Roar, Immortality. Magic jungle: Genius Wand, Sky Piercer, Calamity Reaper, Holy Crystal, Divine Glaive, Blood Wings. EXP fighter: War Axe, Hunter Strike, Dominance Ice, Queen's Wings, Oracle, Immortality. Mid mage: Glowing Wand, Sky Piercer, Wishing Lantern, Holy Crystal, Divine Glaive, Blood Wings. Tank/roam: Antique Cuirass, Radiant Armor, Athena's Shield, Dominance Ice, Guardian Helmet, Immortality. Plus boots in every case.

### 5.11 Design rules distilled

1. One defense curve for both damage types, flat shred -> (%reduction + %pen) -> flat pen, crit before defense, %DR after, true damage skips all of it.
2. Every finished item has one or two non-stacking passives that answer a specific problem (anti-heal 60%, anti-burst on hits >500, anti-tank 8% current HP or 30-40% pen, anti-crit 20% crit DR, panic buttons on 60 s CDs, resurrection on 210 s).
3. Price ladder 120-450 / 600-1050 / 1820-2500 / two 3000+ capstones so spikes are legible.
4. Boots are a fixed 720 slot with +40 MS and a role flavour; roam and jungle variants swap the passive for an economy rule.
5. Caps: 3.0 attacks/s, 40% CDR (45% with one item), 90% slow, MS tapering past 420; per-hero AS ratios make AS items scale differently.
6. Sustain split by source with 30-120% per-skill vamp ratios.
7. Crit is basic-attack only, 200% default, additive chance; on-hit true damage is the anti-tank valve for auto-attackers.
8. Battle spells are a 7th ability, 35-120 s CDs, level-gated unlock order, each answering one job.
9. Emblems: three flat lines + two small talents + one core talent with a 4-30 s CD; identity from the core talent.
10. Defensive items stack reactively (per hit taken, per nearby enemy, per magic hit), not as flat walls.
11. Penetration ladder: cheap flat (12-15) early, % items (30-40%) mid, breaker +0.1% per enemy DEF capped 20-30%.

**Sources (section 5):** mobile-legends.fandom.com/wiki/Physical_defense, Magic_defense, Physical_penetration, Damage_reduction, Critical_strike, Attack_speed, Equipment, Movement_speed, Lifesteal_and_Spell_Vamp, Hybrid_Lifesteal, Boots, Battle_spells, Emblems, User_blog:Chrodotme/The_Complete_Damage_Calculation_Formula, and item pages named in the tables (Blade_of_Despair ... Twilight_Armor, Ice/Flame/Bloody_Retribution); mlbbhub.com/items, /items/athenas-shield, /emblems; mlbbmeta.com/spells; hotspawn.com best-mlbb-items.

---

## 6 Macro play and bot heuristics

### 6.1 Roles and lanes [H]

| Role | Lane | Hero type | Job |
|---|---|---|---|
| Gold laner | Side lane FAR from the first Turtle | Marksman | Farm cannon bonus, first core item by 5-6 min, group after two items (~9-11 min) |
| EXP laner | Side lane NEXT to the first Turtle | Fighter / solo tank | Level 4 before 2:00, duels, contest Turtle |
| Mid | Mid | Mage | Fast clear, rotate both sides; first rotation window 0:55-1:25 after waves 2-3 |
| Jungler | Jungle, Retribution | Assassin / Fighter | Tempo, ganks, objective secure |
| Roamer | Everywhere, Roaming boots | Tank / Support | Bush vision, CC, escort jungler, never farms minions |

### 6.2 Opening scripts [H]

- Jungler: clear all 5 own camps = Lv4 by 1:20-1:45. Start at the buff nearest the gold laner so MM and roamer leash. Purple first for mana/energy assassins (Lancelot, Fanny, Hayabusa); orange first for auto-attack/burst junglers (Yi Sun-shin, Helcurt) [M]. Pattern: buff -> buff -> small camps/crab -> gank an overextended lane -> Turtle at 2:00. Use Retribution on the first buff immediately so it is back for the second buff and Turtle; never use it on a camp within 35 s of an objective spawn. Check bushes around an objective before starting it.
- Roamer: 0:00-1:30 leash the first buff then rotate mid; ~1:30 (jungler Lv4) gank overextended enemies and take river bushes; 1:45 arrive at the Turtle pit 15-20 s early and hold its bushes; shadow the jungler to the second buff to stop invades.
- Mid: first wave ~0:25, clear with one skill by Lv2-3; shove into turret before rotating so enemy mid cannot follow; pick the side where an ally froze the wave, an enemy used an escape, or the jungler can collapse; slow-push mid 15-20 s before 2:00; if a gank fails return immediately (missing 2-3 waves erases the gain).
- MM: pre-5:10 farm cannons and avoid trades; fight only from max range if forced; never farm a side lane alone mid-game unless all 5 enemies are on the minimap; never cross the river line without locating the enemy jungler.

### 6.3 Gank, engage, retreat gates [H]

- Jungler gank only when: target has no escape up AND has pushed past the river, OR you just hit a spike (Lv4 / new item), OR your laner has CC ready. Otherwise farm.
- Tank/roamer engage only when: enemies are clustered, your carries are in follow-up range (>= 2 allies), enemy defensive spells/items are on cooldown (Purify, Flicker, Wind of Nature 90 s, Winter Crown 100 s), and an objective is nearby to convert. Never initiate with carries absent. Peel (CC the diver) when an assassin jumps your MM. Stand between enemy frontline and own backline; bodyblock skillshots.
- Retreat when: HP below a threshold scaled by nearby enemy burst; targeted by a turret with no minion tank; locally outnumbered; the chase would cross the river/turret line without vision. Never chase past an enemy turret unless the kill lands within 2 attacks and no other enemy is near. Dives are group-only, never one at a time.
- Recall only after crashing a wave; recall when HP/mana are low or a core item is affordable; MM finishes an item rather than chasing; EXP laner leaves lost duels. Pressure a lane only when the enemy jungler is visible, minions cover you, escapes are up, or mid/roam can support [M].

### 6.4 Objective play [H unless noted]

- Turtle checklist (every 2 min from 2:00): mid clears its wave first; side laners slow-push 15-30 s early then rotate; roamer takes the best pit bush; jungler arrives with Retribution up and holds aggro; EXP and mid at Lv4+; gold laner weighs the distance and may stay. After the Turtle: convert at once into a turret, a river gank, or farm.
- Skip/trade Turtle when [M]: the gold-lane turret would fall for free, no wave control, jungler behind on secure, enemy has a stronger early fight, or the team is split. A fair trade for a lost Turtle: a turret or two enemy camps without dying.
- Five questions before committing: arrive first with numbers? control the nearest waves? key cooldowns + Retribution up? win-con snowball (Turtle) or finish (Lord)? what can the enemy trade? After 5:00 a single pick should become a turret. "Turtle helps you get strong; Lord helps you end the game." After every objective, convert immediately.
- Lord push: prepare (slow-push) the other lanes before taking Lord; do not send all 5 with it; 1-2 escort, the rest push elsewhere or force a numbers fight. Win the fight, then take Lord, once it is Enhanced (12:00+) [M].
- Defending Lord: group at base, avoid open fights, AoE the enhanced waves, kill the Lord under turrets (they focus it); heroes without minions nearby do ~50% to turrets [M].
- Late game (18:00+): any won fight converts immediately into Lord, turrets, jungle invade or ending; the losing team turtles at base [M].

### 6.5 Wave states [H]

Freeze: last-hit only, keep the wave just outside own turret range, no skills on the wave (default early on EXP lane). Slow push: kill the ranged minions of 2-3 waves, leave melee, then crash 15-30 s before Turtle/Lord. Fast push: skills to shove into turret, then recall/rotate/invade. Always crash before recalling or roaming. Mid waves arrive faster.

### 6.6 Teamfight targeting and kiting [H]

- Priority: (1) an enemy carry out of position that dies fast; (2) any low-HP target that creates a numbers edge; (3) whatever the team already focuses. Role overrides: assassins dive MM/mage; marksmen hit the nearest SAFE target; mages poke at max range; supports stay near the MM. Switch targets rather than chase the unreachable; keep one mobility spell for escape; protect a living damage dealer over trading kills. A disruptive CC tank can be worth killing first.
- Kiting: basic -> step away from the nearest melee threat during the attack cooldown -> basic; stand behind own ranged minions at max range and behind peelers; short-range MMs (Karrie/Wanwan/Granger ~4.4-4.5) stay near the turret retreat path, long-range (Brody 4.9) can farm further; never walk forward to auto a target retreating under its turret.
- Split push: only fast-clear mobile heroes (Karrie, Beatrix, Bruno, Fanny, Ling, Lancelot, Zilong, Sun), only while the enemy is occupied and your team pressures, only with enemy positions visible, always with an escape; stop when enemies go missing or converge.

### 6.7 What MLBB's own bots do [M] and where bots go wrong

Documented (AI Training): know the jungle rotation; secure Lord/Turtle/buffs; steal buffs; help the jungler early; rotate mid; recall at low HP; Flicker to escape and dodge; Flameshot low-HP targets; CC players standing under turret; avoid turret dives (one guide says they do dive [L]); group to push when opponents are dead; top difficulty advertised as Mythic-Honor level. Weaknesses reported [L]: predictable patterns, over-aggression, poor adaptation; offline bots are more aggressive than online fill-ins.

Generic MOBA-bot failures (Dota 2 threads [M]): all 5 group mid after level 6 and fight forever; ignore a free-farming enemy unless a tower is hit; dive one at a time into 5 defenders; ally bots wait, then go in after you die, or flee when you engage; cheat with map knowledge; difficulty cliff.

Difficulty should change execution, not decisions [H]: utility-scored actions re-evaluated every few hundred ms; one decisionQuality parameter (0.3-0.98) sets how often the bot takes the top action; easy bots are slower, less accurate, less coordinated, never dumber strategically. Lane-bot state machine reference [H]: lane, last-hit, trade, all-in, retreat-to-tower, recall, shop-and-return, idle; threat = enemy damage in range + turret aggro + own HP/mana thresholds; last-hit on projected HP at impact tick; acceptance: ~70% last-hit solo, survive turret aggro in seeded scenarios, deterministic output, per-tick budget. Academic framing [M]: split macro (phase-aware goal on the map) from micro execution; influence maps for positioning; a turret targeting the agent is a strong negative, one busy with another target is attackable.

### 6.8 Bot design rules distilled

1. Two layers: macro every ~1 s assigns lane/objective goals from the game clock and map state; micro every 100-300 ms runs attack/kite/retreat/last-hit. Hard-code the MLBB clock as the macro schedule.
2. Assign roles at spawn like MLBB (MM far lane, fighter near lane, mage mid, one jungler with the smite-equivalent, one roamer who never farms); jungler route as in 6.2.
3. Objective attendance: at T-30 s mid has cleared; side laners slow-push then rotate only if their turret is safe; roamer reaches the pit bush first; jungler holds smite (never on a camp within 35 s of a spawn); MM may skip if far or behind.
4. After any objective or won fight, always convert: nearest turret, enemy jungle, or Lord push. Never idle or path home after a win.
5. Target score = killable-within-N-seconds x isolation x role value (MM/mage > support > fighter > tank), with a strong bonus for the team's current target and for low HP; role overrides as in 6.6.
6. Engage gate for tanks/roamers: >= 2 allies in follow-up range, enemies clustered or an escape just spent, no local numbers disadvantage; otherwise hold, bodyblock, zone.
7. Retreat rules are the biggest feel-bad fixer (6.3); no solo dives, ever.
8. Ranged kiting: step away during the attack cooldown, stay behind the front minion, keep max range, never chase under turret.
9. Wave management per 6.5: early freeze, slow-push before objectives, crash before recall/rotate.
10. Ally bots mirror the human's engage within ~1 s if winnable, follow pings, never abandon the human mid-fight, share the Lord push; slightly more risk tolerance when the human commits.
11. No vision cheating: compute knowledge from real fog/bush visibility with a decaying last-seen memory. Difficulty scales reaction time, accuracy and decision-quality probability, not strategy.
12. Small randomness in timings (gank +-10 s, bush choice, recall) so bots are not perfectly predictable, but the macro schedule stays fixed so the game teaches MLBB timings.
13. Summoned Lord AI: lane with the fewest turrets (tie: lowest-HP outer, else mid), charges turrets, turrets target it; 1-2 bots escort, the rest push; defenders group at base and kill it under turrets.
14. Heroes and jungle monsters never body-block heroes (user requirement); pathing treats other units as non-colliding, walls and turrets as solid.

**Sources (section 6):** mobile-legends.fandom.com/wiki/Turtle, Lord, Turret, Minions, Gold_Laner, EXP_Laner, Match_Details_&_Timestamps, AI_Training; mlbbhub.com (roles, roles/tank, guides: jungle-rotation, roaming-guide, mid-lane-tips, gold-lane-tips, exp-lane-tips, teamfight-positioning, map); gamingonphone.com (laning guide, defend the high ground); oneesports.gg (Turtle tips, Lord guide, split push, roamer guide); boostroom.com (Turtle vs Lord, wave states, top 10 tips); u7buy.com jungle pathing; bittopup.com jungle guide; strafe.com jungle buffs; getrivals.com roaming; theriagames.com marksman guide; boosteria.org positioning; playaware.in role primer; toolify.ai bot article; Steam Dota 2 discussions 357288572115750360 / 1697221160907045108 / 618460171320949533; voidgun.itch.io devlog 1445940; github.com/wildware-uk/Udea/issues/133; arXiv 1812.07887, 2103.02943, 1705.10443, 1706.02789.

---

## 7 Open questions to measure in practice mode

Grouped by system; each is a concrete test. Wiki numbers above stay [M]/[L] until measured.

**Heroes**
1. Which source matches the live patch, fandom or Liquipedia (Feb 2023)? Check Tigreal S2/ult, Angela ult, Estes S1, Layla passive against the in-game skill panel.
2. Base-stat growth between Lv1 and Lv15: linear per level or front/back-loaded? Read HP/ATK/DEF at Lv1, 5, 10, 15 on one hero.
3. Energy regen per second (Fanny, Lesley) and the multi-hero reduction rule on Fanny's Prey Mark refunds.
4. Attack-speed growth per level and AS-to-attacks-per-second mapping (time 10 basics at Lv1 and Lv15).
5. Hero XP curve: clock when a solo laner reaches Lv4, 8, 12, 15.
6. Durations of taunt, silence, terrify, petrify, freeze on heroes that have them (Natalia silence, Ruby/Minotaur-style taunts).
7. Re-pull Lesley and Hanabi base stats (the data-module parse mis-read their rows).
8. The slow/speed-up decay rate below 230 and above 420 MS.

**Economy**
9. Classic starting gold: read the counter at 0:00.
10. Fresh hero-kill gold and first-blood bonus: kill a bot at 1:00 and read the popup.
11. Minion HP/ATK/DEF per type at 0:30, 5:00, 10:00, 15:00; EXP per minion; whether cannons appear every wave after 5:00; count units per wave per lane.
12. Gold-share radius: stand at increasing distances from a dying minion.
13. Lane EXP sharing radius and split between two allies.
14. Recall duration (8 s vs ~3.5-4 s claims).
15. Respawn timer at Lv15 at 20:00 and 30:00 after the post-1.4.86 tweaks.
16. Turret-kill gold per tier now ("Golden Turrets") and whether the last-hitter gets extra.

**Turrets**
17. Turret footprint / collision radius versus its 5.3 attack ring (the user finds our base too wide): walk a melee hero around an outer turret and note where movement blocks relative to the range indicator.
18. Outer turret HP 4500 vs 6000; inner/base HP after 2.2.16.
19. Is hero-to-turret damage without allied minions really -50%?
20. Do minions switch aggro to a hero that attacks an allied hero nearby (LoL-style)?

**Jungle and objectives**
21. Hero vision radius in units (compare against turret range 5.3 and Flicker 3.8).
22. Does a buff transfer to the killer of its holder, and with what duration?
23. Current per-camp gold and EXP after 2.1.88 / 2.1.90 / 2.2.16; confirm the 5-camp = Lv4 timing.
24. Retribution's minion penalty (-70% vs 40-50%) and whether the 50% marksman penalty is live.
25. Buff respawn 75 vs 90 s; buff first spawn 0:20 vs 0:30; small-camp first spawn 0:25.
26. Lord post-18:00 respawn (120 vs 150 s); does the summoned Lord enhance one wave or every wave?
27. Where a Turtle converting at 8:00 spawns the Lord; whether the Turtle pit alternates.
28. Turtle EXP per Turtle and the killer's instant-heal amount; Turtle chase/leash range (~460) and reset.
29. Healing Turtle, Revealing Wisps and Golden Turret numbers (28 Sep 2026 patch): heal per second, companion stats, wisp count/respawn/reveal range.
30. Creep damage reduction with several heroes nearby; jungler's own-jungle 15% DR before 2:00.

**Items and spells**
31. Execute's numbers (100 + 10/level + 13% lost HP, 90 s) from a single source.
32. Per-hero attack-speed ratio table.
33. Athena's Shield passive wording (25% magic DR / 3 s / 5 s reset).
34. Price/stat disagreements: Glowing Wand 2050/2150, Immortality +800/850, Guardian Helmet 2200/2500, Rose Gold Meteor 1820/2030, Queen's Wings +600/750, Sea Halberd; check the live shop.
35. Is Necklace of Durance gone; is Glowing Wand the only mage anti-heal?
36. War Cry vs Temporal Reign actual difference.

**Bots**
37. Do MLBB bots dive turrets? Observe in AI Training.
38. How MLBB bots pick lanes and heroes in custom/AI modes.
39. Time a full jungle clear post-2.1.88 to re-confirm the Lv4 timing.
