'use strict';
/* ============================================================
   Legends Arena — a Mobile Legends–style 5v5 MOBA
   data.js — constants, combat model, hero & skill definitions

   Colour lives in theme.js, not here. This file owns numbers.
   ============================================================ */

const WORLD = 6400;                 // world is WORLD x WORLD units (map.js scales the layout to it)
const TEAM_BLUE = 0, TEAM_RED = 1, TEAM_NEUTRAL = 2;
const TEAM_NAMES  = ['Blue', 'Red'];
const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const dist  = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };   // hot path: sqrt is several times faster than hypot
const hyp   = (dx, dy) => Math.sqrt(dx * dx + dy * dy);   // Math.hypot for the loops that run thousands of times a frame
const norm  = (x, y) => { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; };
const rand  = (a, b) => a + Math.random() * (b - a);
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ============================================================
   Combat model
   ============================================================
   Three damage types. Physical is reduced by Armor, magic by Magic
   Resist, true by nothing. Both defences use the same diminishing
   curve — DEF_K sets how much of a stat you need to halve incoming
   damage (at armor == DEF_K you take 50%).

   Penetration is applied to the DEFENCE before the curve, percent
   first then flat, which is the order that keeps flat pen valuable
   into the late game instead of being erased by percent pen.
*/
const COMBAT = {
  DEF_K: 95,            // armor/MR value that halves incoming damage of that type
  SKILL_DMG: 0.88,      // skills deal a hair under their listed numbers so combos don't delete
  CRIT_DMG_BASE: 2.0,   // a crit deals 200% before defences
  CDR_CAP: 0.40,        // cooldown reduction hard cap
  TENACITY_CAP: 0.60,   // CC-duration reduction hard cap
  LIFESTEAL_MINION: 0.4,// lifesteal is weaker off non-heroes, as in ML
  BACKDOOR_MULT: 0.5,   // hero damage to structures with no allied minion within COVER_RADIUS
  COVER_RADIUS: 410,    // = turret range: a wave standing in the turret's ring is cover
};

/* ============================================================
   Minions
   ============================================================
   One row per kind, evaluated as `base + perMin * minutes` at spawn (a wave
   keeps the stats it spawned with). Side waves are melee + ranged + siege
   every wave; mid runs melee + 3 ranged until the eleventh wave. Gold is at
   the 0.6x scale of the whole economy (docs/design/lanes-economy.md, 2).
   `atkPerMinLate` replaces `atkPerMin` for the minutes after
   BALANCE.minionLateAtkFrom (the cannon's late-game ramp). */
const MINION_STATS = {
  melee:  { hp: 330,  hpPerMin: 14, atk: 14, atkPerMin: 0.6, atkPerMinLate: 0.6, armor: 8,  armorPerMin: 0.4, range: 55,  atkSpd: 1.0, radius: 16, structMult: 2,   gold: 40, goldPerMin: 0.7, xp: 44 },
  ranged: { hp: 230,  hpPerMin: 9,  atk: 22, atkPerMin: 0.9, atkPerMinLate: 0.9, armor: 8,  armorPerMin: 0.4, range: 260, atkSpd: 1.0, radius: 16, structMult: 2,   gold: 20, goldPerMin: 1.1, xp: 30 },
  siege:  { hp: 620,  hpPerMin: 30, atk: 32, atkPerMin: 2.0, atkPerMinLate: 3.0, armor: 14, armorPerMin: 0.5, range: 300, atkSpd: 0.8, radius: 22, structMult: 3,   gold: 60, goldPerMin: 1.0, xp: 60 },
  super:  { hp: 1800, hpPerMin: 60, atk: 95, atkPerMin: 3.0, atkPerMinLate: 3.0, armor: 30, armorPerMin: 0.5, range: 90,  atkSpd: 1.0, radius: 24, structMult: 3.4, gold: 60, goldPerMin: 0,   xp: 60 },
};

/* Effective post-mitigation multiplier for one damage type. */
function mitigation(defence, flatPen, pctPen) {
  const d = Math.max(0, defence * (1 - clamp(pctPen, 0, 1)) - flatPen);
  return COMBAT.DEF_K / (COMBAT.DEF_K + d);
}

/* ============================================================
   Crowd control
   ============================================================
   Every CC is a named timer on the unit. `move`/`act`/`cast` say what
   the state takes away, which is the whole reason these are separate
   types rather than one "disabled" flag:

     slow        — move slower, everything else fine
     immobilize  — rooted: cannot move, CAN attack and cast
     silence     — cannot cast, CAN move and attack
     stun        — nothing at all
     airborne    — nothing at all, displaces you, and IGNORES tenacity
                   (docs/design/heroes.md F28: a launch is a launch)
     taunt       — you walk at whoever taunted you and hit them; no casting
                   (F23: the forced state does the walking, so move/act stay on)
     suppress    — nothing at all, and IGNORES tenacity

   Tenacity shortens every type except airborne and suppression. */
const CC_TYPES = {
  slow:       { move: true,  act: true,  cast: true,  tenacity: true,  icon: '❄', label: 'Slowed' },   // the pct lives in CCState.slowPct: canMove stays true
  immobilize: { move: false, act: true,  cast: true,  tenacity: true,  icon: '🌿', label: 'Rooted' },
  silence:    { move: true,  act: true,  cast: false, tenacity: true,  icon: '🔇', label: 'Silenced' },
  stun:       { move: false, act: false, cast: false, tenacity: true,  icon: '💫', label: 'Stunned' },
  airborne:   { move: false, act: false, cast: false, tenacity: false, icon: '🌪', label: 'Airborne' },
  taunt:      { move: true,  act: true,  cast: false, tenacity: true,  icon: '😤', label: 'Taunted' },
  suppress:   { move: false, act: false, cast: false, tenacity: false, icon: '⛓', label: 'Suppressed' },
};
/* Ordered hardest-first, for "what does the health bar pip show". */
const CC_PRIORITY = ['suppress', 'airborne', 'taunt', 'stun', 'silence', 'immobilize', 'slow'];

/* ============================================================
   Skills
   ============================================================
   type:
     skillshot  — projectile in a direction   (range, speed, radius, pierce?, explodeR?, hook?)
     nova       — burst around the hero       (radius)
     dash       — lunge in a direction        (dist, speed, stopOnHero?, endNova?, buff?)
     zone       — delayed area at a point     (range, radius, delay, ticks?, interval?)
     heal       — heal self + nearby allies   (heal, healLv, radius, shield?)
     blinkstrike— teleport to a target + hit  (range)
     buff       — self steroid                (atkMult?, spdAdd?, hotPct?, dur)

   damage:
     dmgType    — 'physical' | 'magic' | 'true'
     dmg+dmgLv  — flat base, per skill level
     scaleAd    — fraction of the caster's physical attack
     scaleAp    — fraction of the caster's magic power

   crowd control — any CC_TYPES key as a duration in seconds, e.g.
     stun: 1.2, silence: 1.5, immobilize: 1.6, airborne: 0.7
     slowPct + slowDur for slows, knockback for a tweened shove (F15).

   rank scaling (docs/design/heroes.md F1, read through rankVal()):
     cd / mana / dmg / heal / any CC key may be a per-rank array
     ([46, 42, 38] for an ultimate), or a scalar with a `<key>Lv` delta
     (cd: 8, cdLv: -0.4 -> 8, 7.6, ... 6). slowPctLv is the one exception:
     it grows per zone TICK, not per rank (F28).
   target-aware damage (F2): pctMaxHp (+pctMaxHpCap vs non-heroes),
     missingPct / missingPctLv / missingCap, selfMissingPct / selfMissingCap,
     bonusVsMark {tag, within, mult}, selfMissingBonus {perPct, per, max},
     canCrit (one roll per cast, novas), dmgMult (overheat, F5).
*/
const HEROES = [
  {
    id: 'zephyr', name: 'Zephyr', role: 'Marksman', icon: '🏹', color: '#7dd3fc', projColor: '#bde9ff',
    desc: 'An attack-speed hypercarry: weak for three seconds, unmatched once Slipstream is stacked and every basic is a piercing gale.',
    difficulty: 2, damageStyle: 'physical',
    /* docs/design/heroes.md, Marksmen: Zephyr. The only hero whose basic
       attack changes: Storm Volley (F7 basicMod) makes every basic a piercing
       420 line for 6 s, primary target with full basic rules, everyone else
       in the line a secondary hit. No hard CC, one dash. Bot fields: botKite
       is the melee-within distance that turns Updraft into a hop away;
       toward the target it only goes when an ally has engaged. */
    hp: 520, hpLv: 68, mp: 200, mpLv: 22, atk: 60, atkLv: 7.0,
    armor: 12, armorLv: 2.2, mr: 10, mrLv: 1.6,
    range: 345, atkSpd: 1.12, speed: 248,
    passive: {
      name: 'Slipstream', icon: '🍃', id: 'slipstream',
      desc: 'Each basic attack that hits grants +6% move speed for 2s, stacking to 5. At 5 stacks basics deal +18 (+12% ATK) bonus physical damage. A Storm Volley volley or a Gale Shot that hits a hero counts as one basic.',
    },
    skills: [
      { name: 'Gale Shot', icon: '➹', type: 'skillshot', cd: 7, cdLv: -0.3, mana: 40, manaLv: 4, dmgType: 'physical', dmg: 110, dmgLv: 16, scaleAd: 0.75, range: 700, speed: 1000, radius: 26, pierce: true, desc: 'A razor gust that pierces every enemy in a line; hitting a hero counts as one Slipstream stack.' },
      { name: 'Updraft', icon: '💨', type: 'dash', cd: 11, cdLv: -0.4, mana: 50, dist: 260, speed: 1100, buff: { asMult: 1.5, dur: 3 }, botKite: 200, botWithAlly: true, desc: 'Ride a gust 260 units and gain +50% attack speed for 3s (the larger of this and Storm Volley, never both).' },
      { name: 'Storm Volley', icon: '🌧️', type: 'basicMod', cd: [48, 42, 36], mana: [100, 120, 140], dur: 6, lineRange: 420, radius: 30, pierce: true, dmgType: 'physical', bonusDmg: 40, bonusDmgLv: 25, bonusScaleAd: 0.25, asMult: [1.3, 1.4, 1.5], desc: 'For 6s every basic attack is a piercing wind arrow hitting everyone in a 420 line for +40/65/90 (+25% ATK) per enemy; +30/40/50% attack speed. Casting other skills does not end it.' },
    ],
  },
  {
    id: 'ignis', name: 'Ignis', role: 'Mage', icon: '🔥', color: '#fb923c', projColor: '#ffb066',
    desc: 'A short-range burst mage: stack Embers with a fan of flame and a meteor, then step in and detonate them.',
    difficulty: 2, damageStyle: 'magic',
    /* docs/design/heroes.md, Mages: Ignis. The only hero whose skills consume
       marks (F12): Flame Fan (the roster's only cone, F11) and Pyroclasm
       apply Embers (three at most, 4 s), Flashburn reads them per victim,
       adds damage per stack, stuns at three unless the victim's stunLockT
       (1.5 s after any Ignis stun) is running, and deletes them. No escape.
       Bot fields: botHold keeps him 330 from his target; botMark on
       Pyroclasm asks for a target carrying an Ember; botMark on Flashburn
       fires it at 880 on a hero with 3 Embers inside `within` (520 with
       any Ember: a third one is a once-a-match event against bots that
       step out of the meteor), its walkIn shrinks the hold to the ring
       while an Embered hero (walkInStacks) is within 400 and the skill is
       ready, and botOwnHpBelow fires it under 30% HP. */
    botHold: 330,
    hp: 500, hpLv: 64, mp: 300, mpLv: 34, atk: 46, atkLv: 4.0,
    armor: 10, armorLv: 2.0, mr: 12, mrLv: 2.0,
    range: 330, atkSpd: 0.9, speed: 250,
    passive: {
      name: 'Kindling', icon: '🔥', id: 'kindling',
      desc: 'Basic attacks against an Embered hero deal +25 (+20% MAGIC) bonus magic damage. Embers show as flame pips on the target\'s HP bar.',
    },
    skills: [
      { name: 'Flame Fan', icon: '🔥', type: 'cone', cd: 6, cdLv: -0.3, mana: 45, manaLv: 5, dmgType: 'magic', angle: 60, length: 480, dmg: 150, dmgLv: 20, scaleAp: 0.75, applyMark: { tag: 'ember', max: 3, dur: 4, stacks: 1 }, desc: 'An instant 60-degree fan of flame 480 long: 150+20/rank (+75% MAGIC) and one Ember (max 3, 4s) on every enemy inside.' },
      { name: 'Flashburn', icon: '🔆', type: 'nova', cd: 9, cdLv: -0.4, mana: 60, manaLv: 5, dmgType: 'magic', radius: 260, dmg: 110, dmgLv: 15, scaleAp: 0.45, consumeMark: { tag: 'ember', dmg: 65, dmgLv: 0, scaleAp: 0.20, stunAtStacks: 3, stunDur: 0.6, stunLock: 1.5 }, botMark: { tag: 'ember', stacks: 3, within: 240, walkIn: 400, walkInStacks: 1 }, botOwnHpBelow: 0.3, desc: 'A ring of flame in 260 that consumes Embers: 110+15/rank (+45% MAGIC) plus 65 (+20% MAGIC) per Ember; at 3 Embers the victim is stunned 0.6s (not again within 1.5s of an Ignis stun). The Embers are spent.' },
      { name: 'Pyroclasm', icon: '💥', type: 'zone', cd: [40, 35, 30], mana: [110, 130, 150], dmgType: 'magic', range: 640, radius: 230, delay: 0.9, ticks: 1, dmg: [280, 360, 440], scaleAp: 1.0, stun: 0.5, applyMark: { tag: 'ember', max: 3, dur: 4, stacks: 1, centreStacks: { within: 100, stacks: 2 } }, botMark: { tag: 'ember', stacks: 1 }, desc: 'A meteor after 0.9s: 280/360/440 (+100% MAGIC) in 230 and a 0.5s stun; 2 Embers within 100 of the centre, 1 on the rim.' },
    ],
  },
  {
    id: 'grom', name: 'Grom', role: 'Tank', icon: '🛡️', color: '#94a3b8', projColor: '#cbd5e1',
    desc: 'An unbreakable vanguard who leads every charge.',
    difficulty: 1, damageStyle: 'physical',
    hp: 760, hpLv: 105, mp: 220, mpLv: 24, atk: 56, atkLv: 6,
    armor: 22, armorLv: 3.6, mr: 18, mrLv: 2.8,
    range: 95, atkSpd: 0.85, speed: 258,
    passive: {
      name: 'Bulwark', icon: '🛡', id: 'bulwark',
      desc: '+5 Armor and +5 Magic Resist per enemy hero within 420 (max +25). Below 40% HP gain a shield of 12% max HP for 4s (35s cooldown).',
    },
    /* docs/design/heroes.md, Tanks: Grom. The ultimate is the roster's only
       channel (F18): 0.9 s rooted, broken by any stun/silence/airborne/
       suppress/taunt (half cooldown back), then the payload nova drags
       everyone 140 toward him and launches them. botMinHp: bots never start
       the channel below 25% HP. */
    skills: [
      { name: 'Shockwave', icon: '🌊', type: 'nova', cd: 7, mana: 45, dmgType: 'physical', radius: 240, dmg: 120, dmgLv: 16, scaleAd: 0.6, slowPct: 0.4, slowDur: 1.5, desc: 'Slam the ground: damage and slow every enemy around Grom.' },
      { name: 'Bull Charge', icon: '🐂', type: 'dash', cd: 13, mana: 60, dmgType: 'physical', dist: 420, speed: 950, dmg: 110, dmgLv: 14, scaleAd: 0.6, stopOnHero: true, stun: 0.7, knockback: 90, wallDmg: 0, desc: 'Charge in a line; the first enemy hero hit is stunned 0.7s and shoved 90 units.' },
      { name: 'Earthsplitter', icon: '⛰️', type: 'channel', cd: [46, 42, 38], mana: 110, channel: 0.9, interruptRefund: 0.5, botMinHp: 0.25,
        dmgType: 'physical', radius: 320, dmg: 280, dmgLv: 40, scaleAd: 0.9, airborne: 0.9,   // mirrored from the payload for tooltips and burst estimates
        payload: { type: 'nova', radius: 320, dmgType: 'physical', dmg: 280, dmgLv: 40, scaleAd: 0.9, knockback: -140, airborne: 0.9 },
        desc: 'Plant for 0.9s, then split the earth: every enemy within 320 is dragged 140 units toward Grom and launched 0.9s. Stun, silence, airborne, suppress or taunt cancel it (half the cooldown refunded).' },
    ],
  },
  {
    id: 'nyx', name: 'Nyx', role: 'Assassin', icon: '🗡️', color: '#c084fc', projColor: '#d8b4fe',
    desc: 'The execute assassin: one long-cooldown, armor-piercing blow that grows the lower the target is; she vanishes to reach her spot and does nothing to a full-HP frontline.',
    difficulty: 3, damageStyle: 'physical',
    /* docs/design/heroes.md, Assassins: Nyx. The only kit scaled on the
       TARGET's missing HP (F21): Deathmark adds 20/25/30% of it (cap 400 vs
       non-heroes) behind 22% armor penetration and carries no CC at all.
       Shade Step is the roster's only untargetable state (F19): 0.8 s out of
       every target list, hit test, nova and zone, +30% move speed, no
       attacks or casts, dots keep ticking. Squishier than the Marksman, the
       durability pays for the burst. Bot fields: Deathmark is held for a
       hero under 50% (botExecuteHp) and never thrown above 70%
       (botNeverAbove); Shade Step goes through an incoming skillshot or
       closes the last 200 on a hunted target (botClose), and is her exit. */
    hp: 515, hpLv: 68, mp: 230, mpLv: 25, atk: 68, atkLv: 8.0,
    armor: 12, armorLv: 2.0, mr: 10, mrLv: 1.6,
    range: 95, atkSpd: 1.15, speed: 275,
    passive: {
      name: 'Backstab', icon: '🌑', id: 'backstab',
      desc: 'Attacks and skills that land on a target facing away deal 18% bonus true damage. Killing a hero grants +25% move speed for 3s.',
    },
    skills: [
      { name: 'Shadow Strike', icon: '🌑', type: 'dash', cd: 8, mana: 45, dmgType: 'physical', dist: 340, speed: 1100, dmg: 130, dmgLv: 16, scaleAd: 0.7, desc: 'Dash 340 units through enemies in a line for 130+16/rank (+70% ATK) physical damage to everyone on the path.' },
      { name: 'Shade Step', icon: '🌫', type: 'selfState', cd: 12, mana: 40, dur: 0.8, untargetable: true, speedPct: 0.3, noAttack: true, botClose: 200, desc: 'Vanish for 0.8s: untargetable, skipped by projectiles, novas and zones, +30% move speed; she cannot attack or cast, and dots on her keep ticking.' },
      { name: 'Deathmark', icon: '☠️', type: 'blinkstrike', cd: [42, 38, 34], mana: 100, dmgType: 'physical', range: 500, dmg: 260, dmgLv: 40, scaleAd: 1.0, missingPct: 0.2, missingPctLv: 0.05, missingCap: 400, physPenPct: 0.22, botExecuteHp: 0.5, botNeverAbove: 0.7, desc: 'Blink behind the nearest hero within 500 and strike for 260/300/340 (+100% ATK) plus 20/25/30% of its missing HP (cap 400 vs non-heroes), ignoring 22% of its armor. No CC.' },
    ],
  },
  {
    id: 'sylva', name: 'Sylva', role: 'Support', icon: '🌿', color: '#4ade80', projColor: '#86efac',
    desc: 'A forest guardian who keeps allies standing.',
    difficulty: 2, damageStyle: 'magic',
    hp: 540, hpLv: 70, mp: 320, mpLv: 36, atk: 48, atkLv: 4.5,
    armor: 12, armorLv: 2.4, mr: 14, mrLv: 2.4,
    range: 320, atkSpd: 0.95, speed: 258,
    passive: {
      name: 'Verdant Gift', icon: '🌱', id: 'verdant',
      desc: 'Healing an ally grants them +60 move speed for 2s and restores 12 mana to Sylva.',
    },
    skills: [
      { name: 'Thorn Volley', icon: '🌱', type: 'skillshot', cd: 6, mana: 45, dmgType: 'magic', dmg: 140, dmgLv: 16, scaleAp: 0.55, range: 680, speed: 850, radius: 26, slowPct: 0.3, slowDur: 1.5, desc: 'Launch a thorn that damages and slows the first enemy hit.' },
      { name: 'Healing Bloom', icon: '🌸', type: 'heal', cd: 11, mana: 65, heal: 130, healLv: 20, scaleAp: 0.5, radius: 320, shieldPct: 0.06, desc: 'Bloom with life, healing nearby allies and shielding them briefly.' },
      { name: 'Entangling Grove', icon: '🍃', type: 'zone', cd: 42, mana: 110, dmgType: 'magic', range: 600, radius: 250, delay: 0.75, dmg: 170, dmgLv: 18, scaleAp: 0.55, immobilize: 1.4, desc: 'Roots burst from the ground, binding enemies in place.' },
    ],
  },
  {
    id: 'torren', name: 'Torren', role: 'Fighter', icon: '🪓', color: '#f87171', projColor: '#fca5a5',
    desc: 'A resourceless reaver who hits harder the more of his own blood he has lost.',
    difficulty: 1, damageStyle: 'physical',
    /* docs/design/heroes.md, Fighters: Torren. No resource at all (F3 'none'):
       no bar, every skill free, cooldowns are the only gate. The only kit
       scaled on the caster's own missing HP (F21): Whirling Axe grows +1% per
       2% lost (cap +40%), Reaver's Toll adds a slice of it as true damage,
       computed once at cast. War Leap is the roster's only leap-to-point
       (F22). botOwnHpBelow: bots also cast the ult on a single hero once
       Torren himself is under 50%. */
    resource: 'none',
    hp: 690, hpLv: 96, mp: 0, mpLv: 0, atk: 63, atkLv: 7.4,
    armor: 19, armorLv: 3.0, mr: 14, mrLv: 2.2,
    range: 95, atkSpd: 1.02, speed: 262,
    passive: {
      name: 'Bloodthirst', icon: '🩸', id: 'bloodthirst',
      desc: '8% Lifesteal plus 1% for every 3% of missing HP, capped at 35% at or below 20% HP. Basic attacks only.',
    },
    skills: [
      { name: 'Whirling Axe', icon: '🌀', type: 'nova', cd: 7, cdLv: -0.3, mana: 0, dmgType: 'physical', radius: 220, dmg: 130, dmgLv: 16, scaleAd: 0.8, selfMissingBonus: { perPct: 0.01, per: 0.02, max: 0.4 }, desc: 'Spin the axe around Torren: +1% damage per 2% of his missing HP (max +40%).' },
      { name: 'War Leap', icon: '🦵', type: 'dash', cd: 11, cdLv: -0.3, mana: 0, dashToPoint: true, dist: 340, speed: 950, endNova: { radius: 180, dmgType: 'physical', dmg: 110, dmgLv: 13, scaleAd: 0.6, slowPct: 0.3, slowDur: 1.2 }, desc: 'Leap to the aimed point up to 340 away and slam down, damaging and slowing 30% for 1.2s.' },
      { name: 'Reaver\'s Toll', icon: '🪓', type: 'nova', cd: [42, 38, 34], mana: 0, botOwnHpBelow: 0.5, dmgType: 'true', radius: 260, dmg: [160, 220, 280], scaleAd: 0.7, selfMissingPct: [0.2, 0.25, 0.3], selfMissingCap: 0.5, desc: 'A true-damage cleave that adds 20/25/30% of Torren\'s own missing HP (cap 50% of his max HP).' },
    ],
  },
  {
    id: 'mira', name: 'Mira', role: 'Mage', icon: '❄️', color: '#93c5fd', projColor: '#bfdbfe',
    desc: 'An area-control mage: lingering Rime Fields slow enemies, speed allies and stack Chill until they freeze.',
    difficulty: 2, damageStyle: 'magic',
    /* docs/design/heroes.md, Mages: Mira. The only mage whose zones help
       allies: Rime Field and Glacial Prison leave a lingering patch (F13)
       that slows enemies, hastens allied heroes and Chills whoever stays.
       Frostbite's freeze grants 2.5 s of Chill immunity (F28
       chillImmuneT). No burst, no mobility. Bot fields: botHold 335;
       botBetween drops Rime Field between her and a melee threat inside
       520 (or on the target when an ally has engaged); botField rates
       Frost Shard highest at a hero standing in one of her patches;
       botCrowd + botMark hold Glacial Prison for 2+ heroes or one at
       3 Chill. */
    botHold: 335,
    hp: 490, hpLv: 62, mp: 310, mpLv: 35, atk: 45, atkLv: 3.8,
    armor: 10, armorLv: 2.0, mr: 12, mrLv: 2.0,
    range: 335, atkSpd: 0.9, speed: 250,
    passive: {
      name: 'Frostbite', icon: '🧊', id: 'frostbite',
      desc: 'Mira\'s damage applies Chill for 4s (max 4), 8% slow per stack (the strongest slow wins). At 4 stacks the target is Frozen 0.8s, the stacks are consumed and the target is Chill-immune for 2.5s.',
    },
    skills: [
      { name: 'Frost Shard', icon: '🧿', type: 'skillshot', cd: 5.5, cdLv: -0.3, mana: 40, manaLv: 5, dmgType: 'magic', dmg: 150, dmgLv: 20, scaleAp: 0.7, range: 700, speed: 900, radius: 24, slowPct: 0.30, slowDur: 1.5, botField: true, desc: 'An icy shard that stops on the first enemy: 150+20/rank (+70% MAGIC), a 30% slow for 1.5s and one Chill.' },
      { name: 'Rime Field', icon: '❄', type: 'zone', cd: 12, cdLv: -0.4, mana: 70, manaLv: 5, dmgType: 'magic', range: 600, radius: 200, delay: 0.3, ticks: 1, dmg: 90, dmgLv: 12, scaleAp: 0.4, linger: { dur: 4, enemySlowPct: 0.35, allySpeedAdd: 40, chillPerSec: 1, chillDelay: 1.0 }, botBetween: 520, desc: 'A pulse of 90+12/rank (+40% MAGIC) in 200, then the ground stays frozen 4s: enemies inside are slowed 35% and take one Chill per second after the first, allied heroes gain +40 speed.' },
      { name: 'Glacial Prison', icon: '🧊', type: 'zone', cd: [42, 37, 32], mana: [110, 130, 150], dmgType: 'magic', range: 620, radius: 200, delay: 0.75, ticks: 1, dmg: [260, 340, 420], scaleAp: 0.9, stun: [1.0, 1.1, 1.2], linger: { dur: 4, enemySlowPct: 0.35, allySpeedAdd: 40, chillPerSec: 1, chillDelay: 1.0 }, botCrowd: true, botMark: { tag: 'chill', stacks: 3 }, desc: 'After 0.75s the area freezes solid: 260/340/420 (+90% MAGIC) in 200 and Frozen 1.0/1.1/1.2s, then a Rime Field stays 4s.' },
    ],
  },
  {
    id: 'karn', name: 'Karn', role: 'Fighter', icon: '⛓️', color: '#fbbf24', projColor: '#fde68a',
    desc: 'A chained warden who hooks one target out and chains the whole fight to himself.',
    difficulty: 3, damageStyle: 'physical',
    /* docs/design/heroes.md, Fighters: Karn. The roster's only hook (a drag
       with suppression; the first body stops it) and Gaol, a multi-target
       anchored tether (F16) that punishes leaving: a chained hero crossing
       450 is struck and stunned, one who stays pays nothing; a hard CC on
       Karn does not cut it, a Purify releases it quietly. Iron Slam reads
       the hook's mark (F2 bonusVsMark: +50% within 2 s of the drag). Bot
       fields: botRadius is Gaol's tighter crowd test (300). */
    hp: 700, hpLv: 96, mp: 240, mpLv: 26, atk: 58, atkLv: 6.4,
    armor: 21, armorLv: 3.0, mr: 16, mrLv: 2.5,
    range: 100, atkSpd: 0.90, speed: 255,
    passive: {
      name: 'Ironclad', icon: '⚙', id: 'ironclad',
      desc: 'Basic attacks cut 0.5s from every skill cooldown. Taking damage from an enemy hero grants 4 Armor for 4s, stacking to 5.',
    },
    skills: [
      { name: 'Chain Hook', icon: '🪝', type: 'skillshot', cd: 13, cdLv: -0.5, mana: 80, manaLv: 5, dmgType: 'physical', dmg: 110, dmgLv: 14, scaleAd: 0.5, range: 640, speed: 850, radius: 26, pierce: false, hook: true, suppress: 0.6, markOnHit: 'hooked', desc: 'Throw the chain; the first unit hit stops it. A hero is reeled to Karn and suppressed 0.6s.' },
      { name: 'Iron Slam', icon: '🔨', type: 'nova', cd: 8, cdLv: -0.4, mana: 50, dmgType: 'physical', radius: 240, dmg: 140, dmgLv: 17, scaleAd: 0.7, slowPct: 0.4, slowDur: 1.2, bonusVsMark: { tag: 'hooked', within: 2, mult: 1.5 }, desc: 'Smash the ground, slowing 40% for 1.2s; +50% damage to a target hooked within the last 2s.' },
      { name: 'Gaol', icon: '⛓', type: 'tether', cd: [44, 40, 36], mana: 120, dmgType: 'physical', botRadius: 300,
        tether: { multi: { radius: 320 }, dur: 2.5, breakRange: 450, anchored: true, breakPayload: { dmg: [260, 340, 420], scaleAd: 1.0, stun: 1.0 } },
        desc: 'Chain every enemy hero within 320 to Karn for 2.5s. A hero that moves beyond 450 snaps its chain and is struck for 260/340/420 (+100% ATK) and stunned 1s; staying is free. Purify releases the chain.' },
    ],
  },
  {
    id: 'vesper', name: 'Vesper', role: 'Marksman', icon: '🔫', color: '#f4bf4f', projColor: '#ffe08a',
    desc: 'A burst-crit skirmisher: three fanned shots, a sidestep, then one Deadeye round to end a low target.',
    difficulty: 3, damageStyle: 'physical',
    /* docs/design/heroes.md, Marksmen: Vesper. The roster's only charge
       skill (F8): Fan the Hammer banks three charges that refill one at a
       time, immune to cooldown reduction, learned empty; every shot in the
       kit stops on the first unit. Bot fields: botClearLine holds a shot
       (and aims the Sidestep) while a creep is on the line to the hero;
       botBank keeps two charges out of a fight; botExecuteOnly makes
       Deadeye a pure execute; botKite + botKiteNoCharges: Sidestep away
       from a melee inside 220 once the hammer is empty. */
    hp: 535, hpLv: 70, mp: 190, mpLv: 20, atk: 66, atkLv: 7.6,
    armor: 12, armorLv: 2.1, mr: 10, mrLv: 1.5,
    range: 330, atkSpd: 1.0, speed: 252,
    passive: {
      name: 'Last Light', icon: '🪙', id: 'lastlight',
      desc: 'Basic attacks and Deadeye Round against heroes below 40% HP deal +20% damage. A critical basic on a hero refunds 1.0s of Fan the Hammer\'s recharge (once per 2.5s).',
    },
    skills: [
      { name: 'Fan the Hammer', icon: '💥', type: 'skillshot', charges: 3, recharge: 9, rechargeLv: -0.4, castDelay: 0.6, mana: 30, manaLv: 3, dmgType: 'physical', dmg: 100, dmgLv: 14, scaleAd: 0.6, range: 560, speed: 1300, radius: 22, pierce: false, botClearLine: true, botBank: 2, desc: 'One fast pistol round at the first enemy in a line. Three rounds banked, each a separate cast, refilling one at a time (9 -> 7s, no cooldown reduction).' },
      { name: 'Sidestep', icon: '↷', type: 'dash', cd: 10, cdLv: -0.3, mana: 45, dist: 250, speed: 1150, endNova: { radius: 170, dmgType: 'physical', dmg: 70, dmgLv: 10, scaleAd: 0.45, slowPct: 0.3, slowDur: 1.0 }, botClearLine: true, botKite: 220, botKiteNoCharges: true, desc: 'Slide 250 units and detonate a powder burst on landing: 70+10/rank (+45% ATK) in 170, slowing 30% for 1s.' },
      { name: 'Deadeye Round', icon: '🎯', type: 'skillshot', cd: [40, 35, 30], mana: [100, 120, 140], dmgType: 'physical', dmg: [280, 380, 480], scaleAd: 1.1, range: 820, speed: 1500, radius: 20, pierce: false, botExecuteHp: 0.45, botExecuteOnly: true, botClearLine: true, desc: 'One long-range round that stops on the first unit in its path; +20% against a hero under 40% HP (Last Light).' },
    ],
  },
  {
    id: 'quill', name: 'Quill', role: 'Marksman', icon: '🎯', color: '#c4b581', projColor: '#e7d9a8',
    desc: 'A trapper who owns the ground: pre-placed snares, a boomerang bola and a Killbox that grinds whoever is caught.',
    difficulty: 3, damageStyle: 'physical',
    /* docs/design/heroes.md, Marksmen: Quill. The only hero who places a
       hostile object (F9 trap): Snare arms after 0.7 s, waits 20 s, and the
       first enemy hero on it is struck, rooted and revealed; three at once,
       the fourth removes the oldest, and they outlive him. Bola is the only
       return projectile (F10). No dash. Bot fields: botBush plants Snares
       at the nearest bush centre while he has no hero to fight and one
       between him and the chaser when he runs; botCrowd gates Killbox on
       2+ heroes inside it, or one who is slowed, rooted or stunned. */
    hp: 550, hpLv: 72, mp: 220, mpLv: 24, atk: 58, atkLv: 6.6,
    armor: 14, armorLv: 2.4, mr: 11, mrLv: 1.7,
    range: 320, atkSpd: 1.02, speed: 245,
    passive: {
      name: 'Quarry', icon: '📌', id: 'quarry',
      desc: 'Enemies hit by Quill\'s skills or traps are marked for 4s. Basics on a marked target deal +12% damage and grant +8% move speed for 1.5s (stacks to 3).',
    },
    skills: [
      { name: 'Snare', icon: '✴', type: 'trap', cd: 8, cdLv: -0.4, mana: 45, manaLv: 4, range: 540, triggerRadius: 110, armDelay: 0.7, lifetime: 20, maxActive: 3, heroOnly: true, enemyVisibleWithin: 120, revealDur: 2, dmgType: 'physical', dmg: 110, dmgLv: 15, scaleAd: 0.5, immobilize: 1.0, botBush: true, desc: 'Plant a snare (up to 3, 20s, armed after 0.7s). The first enemy hero to step within 110 takes 110+15/rank (+50% ATK), is rooted 1s and revealed 2s. Enemies only see it within 120. Snares outlive Quill.' },
      { name: 'Bola', icon: '◎', type: 'skillshot', cd: 10, cdLv: -0.3, mana: 50, boomerang: true, dmgType: 'physical', dmg: 80, dmgLv: 11, scaleAd: 0.45, range: 620, speed: 850, radius: 28, pierce: false, returnSlowPct: 0.4, returnSlowDur: 1.2, desc: 'Throw a bola 620 units; it turns on its first hit or at max range and flies back to Quill. Each pass hits one enemy for 80+11/rank (+45% ATK); the return also slows 40% for 1.2s.' },
      { name: 'Killbox', icon: '⬡', type: 'zone', cd: [44, 38, 32], mana: [100, 120, 140], dmgType: 'physical', range: 580, radius: 260, delay: 0.6, ticks: 3, interval: 0.6, dmg: [100, 130, 160], scaleAd: 0.45, slowPct: 0.4, slowDur: 0.8, botCrowd: true, desc: 'After 0.6s a 260 snare field bites three times over 1.8s for 100/130/160 (+45% ATK) each, slowing 40% with every bite.' },
    ],
  },
  {
    id: 'lumen', name: 'Lumen', role: 'Marksman', icon: '🔆', color: '#9ab6e8', projColor: '#dbe7ff',
    desc: 'A long-range sniper on a Focus battery: plants, shoots, hops back, and wins by never being reached.',
    difficulty: 4, damageStyle: 'physical',
    /* docs/design/heroes.md, Marksmen: Lumen. The only battery resource
       (F3/F4): Focus is a flat 100 with no regen of its own, +20 per basic
       that lands and +30/s after 0.5 s without moving; mana items, the blue
       rune and mana burn do nothing to it. Recoil is the roster's only
       dash-back (F22). Lowest HP in the game, longest reach. Bot fields:
       energy.botChargeBelow / botChargeSafe make her plant and charge
       under 30 Focus with no enemy hero inside 500; botHold is the
       distance she keeps from her target; botMinMana holds Railshot under
       60 Focus; botKite is Recoil's melee-within trigger; Overcharge is a
       pure execute (botExecuteOnly, 40%) unless the target is held
       (botCcOk). */
    resource: 'energy',
    energy: { max: 100, regen: 0, perBasic: 20, stillRegen: 30, stillDelay: 0.5, botChargeBelow: 30, botChargeSafe: 500 },
    botHold: 380,
    hp: 485, hpLv: 60, mp: 0, mpLv: 0, atk: 72, atkLv: 8.4,
    armor: 9, armorLv: 1.7, mr: 8, mrLv: 1.3,
    range: 390, atkSpd: 0.85, speed: 240,
    passive: {
      name: 'Aperture', icon: '📷', id: 'aperture',
      desc: 'Basic attacks deal up to +35% damage the farther the target is, ramping linearly from 280 range to max range.',
    },
    skills: [
      { name: 'Railshot', icon: '━', type: 'skillshot', cd: 6, cdLv: -0.3, energy: 30, mana: 0, dmgType: 'physical', dmg: 140, dmgLv: 20, scaleAd: 0.7, range: 900, speed: 1500, radius: 18, pierce: true, botMinMana: 60, desc: 'A hair-thin rail that pierces everything in a 900 line for 140+20/rank (+70% ATK). 30 Focus.' },
      { name: 'Recoil', icon: '↩', type: 'dash', cd: 10, energy: 0, mana: 0, dashBack: true, dist: 220, speed: 1000, energyRefund: 20, botKite: 250, desc: 'Hop 220 units away from the aim direction and regain 20 Focus on landing. No damage, no CC.' },
      { name: 'Overcharge', icon: '✦', type: 'zone', cd: [40, 34, 28], energy: 50, mana: 0, dmgType: 'physical', range: 950, radius: 100, delay: 1.0, ticks: 1, dmg: [380, 500, 620], scaleAd: 1.2, botExecuteHp: 0.4, botExecuteOnly: true, botCcOk: true, desc: 'Charge 1s, then detonate a 100-radius spot up to 950 away for 380/500/620 (+120% ATK). No CC. 50 Focus.' },
    ],
  },
  {
    id: 'volt', name: 'Volt', role: 'Mage', icon: '⚡', color: '#fde047', projColor: '#fef08a',
    desc: 'A sustained anti-tank battle mage: Chain Arc bounces through a crowd and every hit strips magic resist.',
    difficulty: 2, damageStyle: 'magic',
    /* docs/design/heroes.md, Mages: Volt. The only retargeting projectile
       (F14 bounce): Chain Arc stops on the first unit and arcs to up to
       three more within 320 at 0.75 per hop (heroes count as 150 closer,
       structures never). Static is heroes-only. Thunderhead's slow ramps
       per tick (F28 slowPctLv). Bot fields: botHold 320; botBounce rates
       Chain Arc highest with a second enemy unit inside its bounce range
       of the target; botMelee holds Flashover for a melee hero inside its
       ring (or 2+ heroes); botFrontline lets Thunderhead through the ult
       gate on a Tank / Fighter, or on a hero standing still in a fight. */
    botHold: 320,
    hp: 505, hpLv: 63, mp: 290, mpLv: 32, atk: 44, atkLv: 3.8,
    armor: 9, armorLv: 1.9, mr: 13, mrLv: 2.1,
    range: 325, atkSpd: 0.88, speed: 250,
    passive: {
      name: 'Static', icon: '⚡', id: 'static',
      desc: 'Skill hits on enemy heroes apply a Static stack for 4s (max 5); each stack is 8 flat magic penetration against that target. Non-heroes never gain stacks.',
    },
    skills: [
      { name: 'Chain Arc', icon: '↯', type: 'skillshot', cd: 5, cdLv: -0.2, mana: 45, manaLv: 5, dmgType: 'magic', dmg: 160, dmgLv: 20, scaleAp: 0.75, range: 680, speed: 1100, radius: 22, pierce: false, bounce: { count: 3, range: 320, decay: 0.75 }, botBounce: true, desc: 'A bolt that stops on the first enemy for 160+20/rank (+75% MAGIC), then arcs to up to three more within 320 at 75% per hop (heroes first, never a structure).' },
      { name: 'Flashover', icon: '✳', type: 'nova', cd: 10, cdLv: -0.4, mana: 60, manaLv: 4, dmgType: 'magic', radius: 240, dmg: 130, dmgLv: 16, scaleAp: 0.55, stun: 0.5, botMelee: true, desc: 'Discharge a shock in 240 around Volt: 130+16/rank (+55% MAGIC) and a 0.5s stun.' },
      { name: 'Thunderhead', icon: '☁', type: 'zone', cd: [40, 35, 30], mana: [110, 130, 150], dmgType: 'magic', range: 600, radius: 240, delay: 0.4, ticks: 5, interval: 0.45, dmg: [70, 95, 120], scaleAp: 0.3, slowPct: 0.10, slowPctLv: 0.08, slowDur: 0.6, botFrontline: true, desc: 'A storm cloud in 240 that strikes five times over 2.2s for 70/95/120 (+30% MAGIC) each; the slow builds from 10% to 42% per strike (0.6s) and every strike applies Static.' },
    ],
  },
  {
    id: 'nadir', name: 'Nadir', role: 'Mage', icon: '🌀', color: '#7c3aed', projColor: '#c4b5fd',
    desc: 'A teamfight-initiator mage: a huge delayed ult drags enemies into its centre before it detonates.',
    difficulty: 3, damageStyle: 'magic',
    /* docs/design/heroes.md, Mages: Nadir. The only hero with travelling
       displacement toward a point (F15): Crush drags everyone in its ring
       120 toward him over 0.13 s (pullTo), Implosion pulls enemy heroes
       toward its centre at 260 u/s for its whole 0.9 s delay (pullSpeed),
       refused by Purify, not clearing a dash, stopping at rock. Anyone
       his skills displace is Heavy 3 s (Accretion reads marks.heavyBy /
       heavyUntil). Sturdier and slower than the other mages, no escape.
       Bot fields: botHold 310; botCrowd + botExecuteHp hold Implosion for
       2+ heroes within 280 of the target or one under 40%; botAfterPull
       fires Crush at 900 while a hero he just pulled is stunned inside its
       ring (right after the detonation); botRetreating rates Singularity
       700 at a hero moving away from him. */
    botHold: 310,
    hp: 520, hpLv: 68, mp: 300, mpLv: 33, atk: 42, atkLv: 3.6,
    armor: 12, armorLv: 2.2, mr: 14, mrLv: 2.2,
    range: 310, atkSpd: 0.86, speed: 245,
    passive: {
      name: 'Accretion', icon: '●', id: 'accretion',
      desc: 'Enemy heroes displaced by Nadir\'s skills become Heavy for 3s: -20% move speed and +12% damage taken from Nadir.',
    },
    skills: [
      { name: 'Singularity', icon: '◉', type: 'skillshot', cd: 7, cdLv: -0.4, mana: 50, manaLv: 5, dmgType: 'magic', dmg: 160, dmgLv: 20, scaleAp: 0.75, range: 640, speed: 720, radius: 30, explodeR: 140, slowPct: 0.40, slowDur: 1.2, botRetreating: true, desc: 'A collapsing star that bursts on the first enemy hit: 160+20/rank (+75% MAGIC) and a 40% slow for 1.2s, 80% of the damage to everyone else within 140.' },
      { name: 'Crush', icon: '⬤', type: 'nova', cd: 11, cdLv: -0.4, mana: 60, manaLv: 4, dmgType: 'magic', radius: 280, dmg: 120, dmgLv: 14, scaleAp: 0.5, pullTo: { target: 'caster', dist: 120, speed: 900 }, botAfterPull: true, desc: 'Collapse space in 280 around Nadir: 120+14/rank (+50% MAGIC), and every enemy (heroes and minions) is dragged 120 units toward him over 0.13s.' },
      { name: 'Implosion', icon: '◎', type: 'zone', cd: [44, 38, 32], mana: [120, 140, 160], dmgType: 'magic', range: 560, radius: 280, delay: 0.9, ticks: 1, pullSpeed: 260, dmg: [300, 390, 480], scaleAp: 1.1, stun: 0.8, botCrowd: true, botExecuteHp: 0.4, desc: 'For 0.9s enemy heroes inside the 280 ring are dragged toward its centre at 260 u/s (Purify refuses it, a dash or Flicker leaves, rock stops it), then it implodes: 300/390/480 (+110% MAGIC) and a 0.8s stun.' },
    ],
  },
  {
    id: 'ashara', name: 'Ashara', role: 'Mage', icon: '🏜️', color: '#d4a017', projColor: '#f5d76e',
    desc: 'An ambush and terrain mage: hides her team in sand, silences whoever pushes through it, and turns ground into quicksand.',
    difficulty: 3, damageStyle: 'magic',
    /* docs/design/heroes.md, Mages: Ashara. The roster's only stealth
       outside bushes (F13 linger.conceal): allied heroes inside Sand Veil
       are hidden from enemies beyond 250 and revealed 1.6 s by dealing
       damage. Burial is the only progressive CC (a linger whose slow
       ramps 20% -> 60%, then an endPayload that roots). Entering either
       counts as one Dry Mouth hit per cast (countsAsSkillHit). No
       mobility. Bot fields: botHold 305; botVeil drops Sand Veil on
       herself with a melee enemy inside 300, or on the allied group with
       an enemy hero inside 600; botCrowd + botAttacking hold Burial for
       2+ heroes who are not retreating, or one already held. */
    botHold: 305,
    hp: 500, hpLv: 64, mp: 280, mpLv: 30, atk: 47, atkLv: 4.2,
    armor: 10, armorLv: 2.0, mr: 11, mrLv: 1.9,
    range: 305, atkSpd: 0.92, speed: 255,
    passive: {
      name: 'Dry Mouth', icon: '🌬️', id: 'drymouth',
      desc: 'The third skill damage instance on a target within 6s silences it for 0.9s (8s lockout per target). Entering Sand Veil or Burial counts as one skill hit.',
    },
    skills: [
      { name: 'Glass Needle', icon: '↾', type: 'skillshot', cd: 6, cdLv: -0.3, mana: 45, manaLv: 4, dmgType: 'magic', dmg: 150, dmgLv: 18, scaleAp: 0.65, range: 660, speed: 900, radius: 22, slowPct: 0.25, slowDur: 1.2, desc: 'A shard of fused sand that stops on the first enemy: 150+18/rank (+65% MAGIC) and a 25% slow for 1.2s.' },
      { name: 'Sand Veil', icon: '〜', type: 'zone', cd: 13, cdLv: -0.5, mana: 55, manaLv: 4, dmgType: 'magic', range: 500, radius: 180, delay: 0.2, ticks: 1, dmg: 70, dmgLv: 10, scaleAp: 0.35, linger: { dur: 4, conceal: true, enemySlowPct: 0.30, countsAsSkillHit: true }, botVeil: { melee: 300, enemy: 600, group: 400 }, desc: 'A pulse of 70+10/rank (+35% MAGIC) in 180, then a sand patch for 4s: allied heroes inside are concealed like a bush (hidden beyond 250, revealed 1.6s by dealing damage); enemies inside are slowed 30% and count a Dry Mouth hit on entry.' },
      { name: 'Burial', icon: '⏳', type: 'zone', cd: [42, 37, 32], mana: [105, 125, 145], dmgType: 'magic', range: 560, radius: 220, delay: 0.4, ticks: 0,
        dmg: [260, 340, 420], scaleAp: 1.0, immobilize: 1.2,   // mirrored from the endPayload for tooltips and burst estimates (ticks: 0 never applies them)
        linger: { dur: 4, enemySlowRamp: [0.20, 0.60], countsAsSkillHit: true, endPayload: { dmg: [260, 340, 420], scaleAp: 1.0, immobilize: 1.2 } },
        botCrowd: true, botAttacking: true,
        desc: 'Quicksand in 220 for 4s: the slow ramps from 20% to 60%, entering counts a Dry Mouth hit, and everyone still inside at the end takes 260/340/420 (+100% MAGIC) and is rooted 1.2s.' },
    ],
  },
  {
    id: 'hexa', name: 'Hexa', role: 'Mage', icon: '🔮', color: '#a78bfa', projColor: '#ddd6fe',
    desc: 'A drain and attrition mage: stacking Blight, a thread that feeds her health, and rot that spreads.',
    difficulty: 3, damageStyle: 'magic',
    /* docs/design/heroes.md, Mages: Hexa. The only self-healing tether
       (F16 hostile, drain payload): Leech Thread ticks five times over 3 s,
       healing her 40% of each, and if it holds it bursts, slows and
       spreads two Blight to everyone around the target; a stun on her, a
       Purify or 620 of distance cuts it with no payoff. Blight is the
       passive's mark (F12 applyMark with a dot: BLIGHT_MARK in combat.js)
       and the thread's spreadMark carries the same shape. The only mage
       who heals herself; lowest burst, no hard CC. Bot fields: botHold
       345; botRetreatHp 0.4 (she retreats to heal on Blight ticks under
       40%); botKiteHold 490 on the thread keeps her at 400-580 while it
       holds; botTethered rates Hex Bolt at the tethered target; botCrowd +
       botAfterTether hold Black Mass for 2+ heroes or the thread's burst. */
    botHold: 345, botRetreatHp: 0.4,
    hp: 488, hpLv: 61, mp: 315, mpLv: 36, atk: 43, atkLv: 3.7,
    armor: 9, armorLv: 1.8, mr: 15, mrLv: 2.3,
    range: 345, atkSpd: 0.84, speed: 240,
    passive: {
      name: 'Blight', icon: '🧿', id: 'blight',
      desc: 'Basic attacks and skill hits apply a rot dealing 45 (+30% MAGIC) magic damage over 3s; reapplying stacks it to 2. Hexa heals for 12% of Blight damage dealt to heroes.',
    },
    skills: [
      { name: 'Hex Bolt', icon: '☽', type: 'skillshot', cd: 6, cdLv: -0.3, mana: 45, manaLv: 4, dmgType: 'magic', dmg: 140, dmgLv: 17, scaleAp: 0.7, range: 690, speed: 820, radius: 24, botTethered: true, desc: 'A cursed bolt that stops on the first enemy: 140+17/rank (+70% MAGIC) and a Blight.' },
      { name: 'Leech Thread', icon: '⌇', type: 'tether', cd: 13, cdLv: -0.5, mana: 70, manaLv: 5, dmgType: 'magic', targetRange: 520, targetCone: 60, targetFallback: true, botKiteHold: 490,
        tether: { dur: 3.0, breakRange: 620, slowStart: 0.15, slowEnd: 0.15, interval: 0.6, tickDmg: 40, tickDmgLv: 6, tickScaleAp: 0.25, healPct: 0.40,
          payload: { dmg: 120, dmgLv: 16, scaleAp: 0.50, slowPct: 0.40, slowDur: 1.5, spreadMark: { tag: 'blight', stacks: 2, max: 2, dur: 3, radius: 200, dot: { base: 45, scaleAp: 0.3, dur: 3 } } } },
        desc: 'Latch a thread onto the nearest enemy hero in a 60-degree aim cone within 520 (else the nearest): 3s, 5 ticks of 40+6/rank (+25% MAGIC) that each heal Hexa 40%, a 15% slow while linked. If it holds it bursts for 120+16/rank (+50% MAGIC), slows 40% for 1.5s and puts 2 Blight on every enemy within 200 of the target. Breaks past 620, on death, or when Hexa is stunned, launched, suppressed or taunted; Purify on the target cuts it.' },
      { name: 'Black Mass', icon: '⬤', type: 'zone', cd: [40, 35, 30], mana: [110, 130, 150], dmgType: 'magic', range: 600, radius: 240, delay: 0.5, ticks: 4, interval: 0.5, dmg: [80, 105, 130], scaleAp: 0.35, botCrowd: true, botAfterTether: 1.5, desc: 'After 0.5s a 240 curse pulses four times over 2s for 80/105/130 (+35% MAGIC) each; every pulse applies Blight.' },
    ],
  },
  {
    id: 'wraith', name: 'Wraith', role: 'Assassin', icon: '👤', color: '#64748b', projColor: '#cbd5e1',
    desc: 'A afterimage killer whose next strike is always the loud one.',
    difficulty: 3, damageStyle: 'physical',
    hp: 500, hpLv: 65, mp: 220, mpLv: 24, atk: 66, atkLv: 7.6,
    armor: 11, armorLv: 1.9, mr: 9, mrLv: 1.5,
    range: 90, atkSpd: 1.18, speed: 280,
    passive: {
      name: 'Afterimage', icon: '👻', id: 'afterimage',
      desc: 'After a skill hits, your next basic attack within 3s deals 30% bonus physical damage.',
    },
    skills: [
      { name: 'Phase Cut', icon: '╱', type: 'dash', cd: 8, mana: 40, dmgType: 'physical', dist: 360, speed: 1200, dmg: 120, dmgLv: 15, scaleAd: 0.65, desc: 'Dash through, carving everyone in the path.' },
      { name: 'Shred', icon: '✕', type: 'nova', cd: 7, mana: 40, dmgType: 'physical', radius: 200, dmg: 115, dmgLv: 14, scaleAd: 0.65, desc: 'A close burst of cuts.' },
      { name: 'Haunt', icon: '☠', type: 'blinkstrike', cd: 30, mana: 95, dmgType: 'physical', range: 460, dmg: 265, dmgLv: 30, scaleAd: 0.85, silence: 0.5, desc: 'Blink onto a target for a quick cut. Smaller than Deathmark, back 14s sooner — the skirmisher to Nyx.' },
    ],
  },
  {
    id: 'sable', name: 'Sable', role: 'Assassin', icon: '🦂', color: '#16a34a', projColor: '#86efac',
    desc: 'A venomant who wins fights after they have already left.',
    difficulty: 2, damageStyle: 'magic',
    hp: 508, hpLv: 67, mp: 240, mpLv: 26, atk: 60, atkLv: 6.4,
    armor: 12, armorLv: 2.0, mr: 12, mrLv: 1.8,
    range: 92, atkSpd: 1.12, speed: 272,
    passive: {
      name: 'Venom Bank', icon: '🧪', id: 'venom',
      desc: 'Hero kills grant 18% spell vamp for 5s. Assists grant 8% for 3s.',
    },
    skills: [
      { name: 'Needle', icon: '┊', type: 'skillshot', cd: 6, mana: 40, dmgType: 'magic', dmg: 130, dmgLv: 16, scaleAp: 0.5, range: 520, speed: 980, radius: 20, desc: 'A venom dart that starts the rot.' },
      { name: 'Lunge', icon: '→', type: 'dash', cd: 9, mana: 45, dmgType: 'magic', dist: 300, speed: 1100, dmg: 125, dmgLv: 15, scaleAp: 0.45, desc: 'Lunge through, coating enemies in toxin.' },
      { name: 'Kiss', icon: '💋', type: 'blinkstrike', cd: 38, mana: 100, dmgType: 'magic', range: 460, dmg: 280, dmgLv: 32, scaleAp: 0.9, slowPct: 0.5, slowDur: 1.6, desc: 'Blink in and deliver a slowing venom kiss.' },
    ],
  },
  {
    id: 'rook', name: 'Rook', role: 'Assassin', icon: '🦅', color: '#fb7185', projColor: '#fecdd3',
    desc: 'A sky-diver who slams prey into the dirt.',
    difficulty: 2, damageStyle: 'physical',
    hp: 530, hpLv: 70, mp: 200, mpLv: 22, atk: 64, atkLv: 7.0,
    armor: 13, armorLv: 2.1, mr: 10, mrLv: 1.6,
    range: 98, atkSpd: 1.05, speed: 278,
    passive: {
      name: 'Stoop', icon: '⬇', id: 'stoop',
      desc: 'Dealing skill damage from more than 250 range away (your dash/ult) grants +40 move speed for 2s.',
    },
    skills: [
      { name: 'Dive', icon: '⬇', type: 'dash', cd: 9, mana: 45, dmgType: 'physical', dist: 380, speed: 1150, dmg: 130, dmgLv: 16, scaleAd: 0.6, airborne: 0.55, stopOnHero: true, desc: 'Dive onto the first hero, knocking them up.' },
      { name: 'Talon Fan', icon: '彡', type: 'nova', cd: 7, mana: 40, dmgType: 'physical', radius: 210, dmg: 125, dmgLv: 15, scaleAd: 0.6, desc: 'Rake everyone nearby.' },
      { name: 'Skyfall', icon: '☄', type: 'blinkstrike', cd: 42, mana: 105, dmgType: 'physical', range: 540, dmg: 270, dmgLv: 30, scaleAd: 0.9, airborne: 0.55, desc: 'Appear above a target and slam them into the air.' },
    ],
  },
  {
    id: 'brass', name: 'Brass', role: 'Fighter', icon: '🔰', color: '#d97706', projColor: '#fbbf24',
    desc: 'A buckler-and-shoulder line-holder who makes enemies hit him instead of his carry.',
    difficulty: 1, damageStyle: 'physical',
    /* docs/design/heroes.md, Fighters: Brass. The roster's only taunt (F23):
       Call to the Rim makes every enemy within 260 walk at him and swing
       while he armours up; Buckler's shield and the ult's resists are the
       F27 self fields. Lowest fighter damage on purpose. Bot fields:
       botGuardAlly sends Shoulder at the enemy hero attacking an allied
       hero; botCrowd / botAllyWithin gate the ult on 2+ heroes inside its
       radius with an ally within 400 to protect. */
    hp: 720, hpLv: 98, mp: 210, mpLv: 22, atk: 55, atkLv: 6.0,
    armor: 22, armorLv: 3.3, mr: 16, mrLv: 2.5,
    range: 105, atkSpd: 0.95, speed: 252,
    passive: {
      name: 'Rimguard', icon: '○', id: 'rimguard',
      desc: 'Take 10% less damage from enemy heroes.',
    },
    skills: [
      { name: 'Buckler', icon: '◎', type: 'nova', cd: 7, cdLv: -0.3, mana: 45, manaLv: 3, dmgType: 'physical', radius: 200, dmg: 120, dmgLv: 14, scaleAd: 0.55, selfShieldPct: 0.06, selfShieldDur: 3, desc: 'Bash the buckler in a circle and gain a shield of 6% max HP for 3s.' },
      { name: 'Shoulder', icon: '▶', type: 'dash', cd: 12, cdLv: -0.5, mana: 60, dmgType: 'physical', dist: 340, speed: 900, dmg: 100, dmgLv: 12, scaleAd: 0.5, stopOnHero: true, stun: 0.6, botGuardAlly: true, desc: 'Shoulder-check forward and stop on the first hero, stunning 0.6s.' },
      { name: 'Call to the Rim', icon: '▣', type: 'nova', cd: [44, 40, 36], mana: 120, dmgType: 'physical', radius: 260, dmg: [220, 290, 360], scaleAd: 0.7, taunt: [0.8, 1.0, 1.2], armorAdd: 30, mrAdd: 30, buffDur: 4, botCrowd: true, botAllyWithin: 400, desc: 'Every enemy within 260 must turn and hit Brass for 0.8/1.0/1.2s while he gains +30 armor and MR for 4s.' },
    ],
  },
  {
    id: 'omen', name: 'Omen', role: 'Fighter', icon: '⚔️', color: '#94a3b8', projColor: '#e2e8f0',
    desc: 'A twin-blade duelist who chains kills: every takedown resets his step.',
    difficulty: 2, damageStyle: 'physical',
    /* docs/design/heroes.md, Fighters: Omen. The roster's only conditional
       cooldown reset (F24): a hero kill refunds all of Pass and half of
       Duelist's End, an assist half of Pass. Crosscut is the one nova that
       can crit (F28 canCrit, one roll per cast). Bot fields: botExecuteHp
       opens the ult on a hero under 60%, botAllyEngaged when an ally is
       already fighting near the target; botRetreatWhenDown makes him fall
       back under 40% HP while Pass is on cooldown. */
    hp: 640, hpLv: 88, mp: 200, mpLv: 22, atk: 66, atkLv: 7.6,
    armor: 16, armorLv: 2.6, mr: 13, mrLv: 2.0,
    range: 108, atkSpd: 1.06, speed: 266,
    passive: {
      name: 'Cadence', icon: '♪', id: 'cadence',
      desc: 'Basic attacks grant +5% attack speed for 3s, stacking to 8. A Crosscut that hits an enemy hero grants 2 stacks.',
    },
    skills: [
      { name: 'Crosscut', icon: '✕', type: 'nova', cd: 6, cdLv: -0.3, mana: 40, manaLv: 3, dmgType: 'physical', radius: 190, dmg: 120, dmgLv: 14, scaleAd: 0.8, canCrit: true, desc: 'A tight X of steel around Omen that can critically strike.' },
      { name: 'Pass', icon: '↦', type: 'dash', cd: 10, cdLv: -0.4, mana: 45, dmgType: 'physical', dist: 300, speed: 1050, dmg: 90, dmgLv: 11, scaleAd: 0.6, resetOnKill: 1, resetOnAssist: 0.5, botRetreatWhenDown: 0.4, desc: 'Step through the target; a hero kill resets it fully, an assist refunds half.' },
      { name: 'Duelist\'s End', icon: '†', type: 'dash', cd: [38, 34, 30], mana: 120, dmgType: 'physical', dist: 420, speed: 1200, dmg: [240, 300, 360], scaleAd: 1.1, stopOnHero: true, stun: 0.8, resetOnKill: 0.5, botExecuteHp: 0.6, botAllyEngaged: true, desc: 'A committed lunge that stops on the first hero and stuns 0.8s; a kill refunds half the cooldown.' },
    ],
  },
  {
    id: 'tide', name: 'Tide', role: 'Fighter', icon: '🌊', color: '#0ea5e9', projColor: '#7dd3fc',
    desc: 'A breaker who fights with the map: everything he does shoves, and a wall turns a shove into a stun.',
    difficulty: 2, damageStyle: 'magic',
    /* docs/design/heroes.md, Fighters: Tide. The only kit built on the
       displacement tween's wall collision (F15 wallDmg / wallScaleAp /
       wallStun): Breaker carries everyone on its line 120 along the wave,
       High Water throws everyone 130 out from its centre, and a victim that
       meets rock stops, takes the bonus and is stunned; High Water's victims
       that hit nothing are launched instead (noWallCC). No stun at all in
       open ground. Bots read Game.wallAt along the push vector. */
    hp: 670, hpLv: 92, mp: 240, mpLv: 26, atk: 56, atkLv: 6.0,
    armor: 17, armorLv: 2.8, mr: 17, mrLv: 2.6,
    range: 112, atkSpd: 0.98, speed: 256,
    passive: {
      name: 'Undertow', icon: '〰', id: 'undertow',
      desc: 'Basic attacks slow by 12% for 1s. Slowed heroes take 8% bonus magic damage from Tide.',
    },
    skills: [
      { name: 'Breaker', icon: '≈', type: 'skillshot', cd: 8, cdLv: -0.4, mana: 55, manaLv: 4, dmgType: 'magic', dmg: 130, dmgLv: 16, scaleAp: 0.5, range: 560, speed: 750, radius: 32, pierce: true, knockback: 120, wallDmg: 80, wallScaleAp: 0.3, wallStun: 0.6, desc: 'A wave that carries everyone on its line 120 units along it; a victim that hits a wall takes +80 (+30% MAGIC) and is stunned 0.6s.' },
      { name: 'Surge', icon: '⤳', type: 'dash', cd: 10, cdLv: -0.4, mana: 55, dmgType: 'magic', dist: 320, speed: 950, dmg: 90, dmgLv: 11, scaleAp: 0.4, slowPct: 0.3, slowDur: 1.2, botOpenSide: true, desc: 'Ride a surge 320 forward, slowing everything along the path 30% for 1.2s.' },
      { name: 'High Water', icon: '🌊', type: 'zone', cd: [42, 38, 34], mana: 120, dmgType: 'magic', range: 480, radius: 250, delay: 0.5, ticks: 1, dmg: [250, 320, 390], scaleAp: 0.8, knockback: 130, wallDmg: 120, wallScaleAp: 0.4, wallStun: 0.7, noWallCC: { airborne: 0.5 }, desc: 'After 0.5s a wall of water throws everyone within 250 of the point 130 units outward; wall hits take +120 (+40% MAGIC) and are stunned 0.7s, the rest are airborne 0.5s.' },
    ],
  },
  {
    id: 'cinder', name: 'Cinder', role: 'Fighter', icon: '🧨', color: '#ea580c', projColor: '#fdba74',
    desc: 'A coal-fist brawler who runs on Heat instead of mana and overheats into a bigger, controlling cast.',
    difficulty: 2, damageStyle: 'magic',
    /* docs/design/heroes.md, Fighters: Cinder. The roster's only rage-style
       resource (F5): a 0-100 Heat gauge fed by hits (+8 on a hero, +4 on
       anything else, per basic or skill hit) and by any enemy hero carrying
       her burn (+2/s), decaying 5/s after 4 s out of combat. Skills are
       free; at 100 the next cast is Overheated (the skill's `overheat`
       overrides) and the gauge empties. burnTag names Live Coal's dot so the
       burn-up reads the right tag. Furnace's burnUpgrade doubles the burn
       while it runs; botOwnHpBelow: bots stoke it under 60% HP. */
    resource: 'heat',
    heat: { gainBasicHero: 8, gainBasic: 4, gainSkillHero: 8, gainSkill: 4, burnPerSec: 2, decay: 5, decayDelay: 4, burnTag: 'coal' },
    hp: 660, hpLv: 88, mp: 0, mpLv: 0, atk: 58, atkLv: 6.4,
    armor: 16, armorLv: 2.6, mr: 15, mrLv: 2.3,
    range: 118, atkSpd: 1.06, speed: 250,
    passive: {
      name: 'Live Coal', icon: '🔶', id: 'livecoal',
      desc: 'Basic attacks and skills apply a 3s burn of 25 (+20% MAGIC) magic damage; reapplying refreshes it. During Furnace the burn is 50 (+40% MAGIC).',
    },
    skills: [
      { name: 'Haymaker', icon: '✊', type: 'nova', cd: 7, cdLv: -0.4, mana: 0, dmgType: 'magic', radius: 200, dmg: 140, dmgLv: 17, scaleAp: 0.55, overheat: { radius: 260, dmgMult: 1.4, slowPct: 0.4, slowDur: 1.5 }, desc: 'A burning haymaker around Cinder. Overheated: 260 radius, 40% more damage and a 40% slow for 1.5s.' },
      { name: 'Coal Dash', icon: '☄', type: 'dash', cd: 10, cdLv: -0.4, mana: 0, dist: 320, speed: 980, endNova: { radius: 170, dmgType: 'magic', dmg: 100, dmgLv: 12, scaleAp: 0.4 }, overheat: { endNova: { radius: 220, dmgType: 'magic', dmg: 100, dmgLv: 12, scaleAp: 0.4, stun: 0.5 } }, desc: 'Dash 320 and detonate cinders on landing (no CC). Overheated: a 220 blast that stuns 0.5s.' },
      { name: 'Furnace', icon: '♨', type: 'buff', cd: [42, 38, 34], mana: 0, atkMult: 1.25, spdAdd: 50, hotPct: 0.18, dur: 6, burnUpgrade: true, overheat: { dur: 9, tenacityAdd: 0.35 }, botOwnHpBelow: 0.6, desc: 'Stoke the furnace 6s: +25% basic damage, +50 speed, 18% max HP over time and a burn twice as hot. Overheated: 9s and +35% tenacity.' },
    ],
  },
  {
    id: 'bastion', name: 'Bastion', role: 'Tank', icon: '🏰', color: '#78716c', projColor: '#d6d3d1',
    desc: 'A walking keep who stands in front of his carries and eats the arrows meant for them.',
    difficulty: 2, damageStyle: 'physical',
    hp: 740, hpLv: 100, mp: 240, mpLv: 26, atk: 52, atkLv: 5.4,
    armor: 24, armorLv: 3.8, mr: 17, mrLv: 2.6,
    range: 88, atkSpd: 0.80, speed: 248,
    passive: {
      name: 'Rampart', icon: '☗', id: 'rampart',
      desc: 'Every 8s allied heroes within 420 (including Bastion) gain a shield equal to 8% of Bastion\'s max HP for 3s.',
    },
    /* docs/design/heroes.md, Tanks: Bastion. Gatehouse is the roster's only
       projectile denial (F9 barrier): a fixed 260 segment 90 ahead that
       deletes enemy skillshots and ranged basics for 3 s; units, dashes,
       novas and zones pass. The mirror of Grom: he pushes, never pulls. */
    skills: [
      { name: 'Portcullis', icon: '⊓', type: 'nova', cd: 8, mana: 50, dmgType: 'physical', radius: 230, dmg: 110, dmgLv: 14, scaleAd: 0.45, stun: 0.6, desc: 'Drop the gate on everyone around Bastion: stun 0.6s.' },
      { name: 'Gatehouse', icon: '⊓', type: 'barrier', cd: 16, mana: 70, length: 260, offset: 90, dur: 3.0, desc: 'Raise a fixed stone gate 90 units ahead for 3s that destroys enemy skillshots and arrows crossing it; units walk through.' },
      { name: 'Hold the Line', icon: '⬡', type: 'nova', cd: [40, 36, 32], mana: 105, dmgType: 'physical', radius: 320, dmg: 200, dmgLv: 28, scaleAd: 0.5, knockback: 70, slowPct: 0.5, slowDur: 1.5, desc: 'Shove every enemy within 320 away 70 units and slow them 50% for 1.5s.' },
    ],
  },
  {
    id: 'marrow', name: 'Marrow', role: 'Tank', icon: '🦴', color: '#e7e5e4', projColor: '#fafaf9',
    desc: 'An ossuary knight who pays for every spell in blood and gets harder to kill the closer he is to dying.',
    difficulty: 3, damageStyle: 'magic',
    /* docs/design/heroes.md, Tanks: Marrow. No mana bar (F3/F6): every cast
       costs a slice of max HP, paid after the effect and never lethal, and
       the HP he spends is banked six seconds for Catacomb (the only
       max-HP-shaped damage). Mana items and the blue rune give him nothing. */
    resource: 'hp', hpFloor: 0,
    hp: 750, hpLv: 102, mp: 0, mpLv: 0, atk: 50, atkLv: 5.2,
    armor: 19, armorLv: 3.0, mr: 20, mrLv: 3.0,
    range: 85, atkSpd: 0.78, speed: 244,
    passive: {
      name: 'Ossify', icon: '🦴', id: 'ossify',
      desc: 'Take up to 25% less damage as HP falls, scaling linearly from 0% at full HP to 25% at or below 25% HP. Does not reduce true damage.',
    },
    skills: [
      { name: 'Ribcage', icon: '☰', type: 'nova', cd: 6, hpCost: 0.06, botMinHp: 0.2, dmgType: 'magic', radius: 220, dmg: 120, dmgLv: 15, scaleAd: 0.55, slowPct: 0.35, slowDur: 1.5, desc: 'A fan of bone erupts around Marrow, damaging and slowing. Costs 6% max HP.' },
      { name: 'Splint', icon: '✚', type: 'heal', cd: 12, hpCost: 0.08, botHealHp: 0.6, heal: 100, healLv: 16, scaleAp: 0.35, radius: 300, desc: 'Heal every allied hero within 300, himself included. Costs 8% max HP.' },
      { name: 'Catacomb', icon: '⚰', type: 'zone', cd: [42, 38, 34], hpCost: 0.1, dmgType: 'magic', range: 480, radius: 240, delay: 0.7, ticks: 1, dmg: [240, 275, 310], scaleAd: 0.7, airborne: 0.8, bank: { window: 6, pct: 1.0, capMaxHpPct: 0.2 }, desc: 'The floor gives way after 0.7s, launching everyone inside 0.8s, plus bonus damage equal to the HP Marrow paid for skills in the last 6s (cap 20% of his max HP). Costs 10% max HP.' },
    ],
  },
  {
    id: 'anchor', name: 'Anchor', role: 'Tank', icon: '⚓', color: '#1d4e89', projColor: '#60a5fa',
    desc: 'A harbour warden who pins runners without ever reeling them in.',
    difficulty: 2, damageStyle: 'physical',
    hp: 730, hpLv: 98, mp: 220, mpLv: 24, atk: 54, atkLv: 5.8,
    armor: 23, armorLv: 3.3, mr: 16, mrLv: 2.5,
    range: 102, atkSpd: 0.84, speed: 241,
    passive: {
      name: 'Deadweight', icon: '⚓', id: 'deadweight',
      desc: 'Skill hits against slowed, rooted, stunned or airborne enemies deal 15% bonus damage.',
    },
    /* docs/design/heroes.md, Tanks: Anchor. He never moves anyone. Hawser
       is a minion-blockable line whose hero hit ties the victim to him
       (F16): stay inside 560 for 2 s and you are rooted and struck again,
       leave and it snaps; a hard CC on Anchor or a Purify cuts it. Weigh
       Anchor is the roster's only control-immune self state (F19).
       botRange: bots throw the line only inside 500 with no creep on it. */
    skills: [
      { name: 'Hawser', icon: '⌇', type: 'skillshot', cd: 12, mana: 60, dmgType: 'physical', dmg: 90, dmgLv: 12, scaleAd: 0.4, range: 580, speed: 760, radius: 26, pierce: false, botRange: 500,
        tether: { dur: 2.0, breakRange: 560, slowStart: 0.25, slowEnd: 0.5, payload: { dmg: 130, dmgLv: 16, scaleAd: 0.5, immobilize: 1.3 } },
        desc: 'Throw a heavy line; a hero it hits is tied to Anchor 2s with a slow ramping 25% to 50%. Past 560 it snaps; if it holds, the target is rooted 1.3s and struck again. Minions block it; breaks if Anchor is hard-CC\'d.' },
      { name: 'Weigh Anchor', icon: '⇧', type: 'selfState', cd: 11, mana: 50, dur: 1.5, selfRoot: true, ccImmune: ['slow', 'displacement'], armorAdd: 20, mrAdd: 20, tetherSlowMult: 2.0, tetherSlowCap: 0.8, recastCancel: true, desc: 'Root himself 1.5s: immune to slows, pulls and pushes, +20 armor/MR, and a tethered target\'s slow is doubled (cap 80%). Recast to end it early.' },
      { name: 'Harbour', icon: '◉', type: 'nova', cd: [40, 36, 32], mana: 105, dmgType: 'physical', radius: 320, dmg: 230, dmgLv: 32, scaleAd: 0.55, slowPct: 0.55, slowDur: 2.0, desc: 'Every enemy within 320 is slowed 55% for 2s.' },
    ],
  },
  {
    id: 'bell', name: 'Bell', role: 'Support', icon: '🔔', color: '#f5d0fe', projColor: '#f0abfc',
    desc: 'A campanologist who peals haste into her team and dread into the rest.',
    difficulty: 2, damageStyle: 'magic',
    hp: 555, hpLv: 72, mp: 300, mpLv: 34, atk: 44, atkLv: 4.0,
    armor: 11, armorLv: 2.2, mr: 13, mrLv: 2.2,
    range: 290, atkSpd: 0.94, speed: 249,
    passive: {
      name: 'Peal', icon: '♪', id: 'peal',
      desc: 'Every 6s, nearby allied heroes gain +50 move speed for 2s.',
    },
    skills: [
      { name: 'Chime', icon: '♩', type: 'skillshot', cd: 7, mana: 45, dmgType: 'magic', dmg: 120, dmgLv: 14, scaleAp: 0.5, range: 620, speed: 800, radius: 26, slowPct: 0.28, slowDur: 1.4, desc: 'A ringing note that slows the first enemy.' },
      { name: 'Evensong', icon: '♫', type: 'heal', cd: 10, mana: 60, heal: 110, healLv: 16, scaleAp: 0.45, radius: 340, desc: 'A chord that heals nearby allies.' },
      { name: 'Knell', icon: '🔔', type: 'zone', cd: 40, mana: 105, dmgType: 'magic', range: 540, radius: 220, delay: 0.45, dmg: 200, dmgLv: 22, scaleAp: 0.55, silence: 1.6, desc: 'A knell that damages and silences an area.' },
    ],
  },
  {
    id: 'wick', name: 'Wick', role: 'Support', icon: '🕯️', color: '#fcd34d', projColor: '#fde68a',
    desc: 'A lantern bearer who turns heals into hard light.',
    difficulty: 1, damageStyle: 'magic',
    hp: 525, hpLv: 68, mp: 310, mpLv: 35, atk: 50, atkLv: 4.6,
    armor: 13, armorLv: 2.5, mr: 15, mrLv: 2.5,
    range: 300, atkSpd: 0.98, speed: 253,
    passive: {
      name: 'Lampglass', icon: '◇', id: 'lampglass',
      desc: 'Healing an ally also shields them for 40% of the heal for 2.5s.',
    },
    skills: [
      { name: 'Spark', icon: '·', type: 'skillshot', cd: 6, mana: 40, dmgType: 'magic', dmg: 130, dmgLv: 15, scaleAp: 0.5, range: 640, speed: 900, radius: 22, desc: 'A lantern spark that stings the first enemy.' },
      { name: 'Warding Glow', icon: '✦', type: 'heal', cd: 11, mana: 70, heal: 140, healLv: 22, scaleAp: 0.55, radius: 300, shieldPct: 0.04, desc: 'Flood nearby allies with light and a thin shield.' },
      { name: 'Beacon', icon: '◉', type: 'zone', cd: 41, mana: 110, dmgType: 'magic', range: 520, radius: 240, delay: 0.5, ticks: 4, interval: 0.55, dmg: 55, dmgLv: 8, scaleAp: 0.25, slowPct: 0.25, slowDur: 0.8, desc: 'Plant a beacon that burns and slows four times.' },
    ],
  },
  {
    id: 'pact', name: 'Pact', role: 'Support', icon: '🫀', color: '#9f1239', projColor: '#fb7185',
    desc: 'A blood liturgist who spends her own life to rewrite someone else\'s.',
    difficulty: 3, damageStyle: 'magic',
    hp: 545, hpLv: 72, mp: 280, mpLv: 30, atk: 52, atkLv: 4.8,
    armor: 14, armorLv: 2.6, mr: 12, mrLv: 2.0,
    range: 270, atkSpd: 0.91, speed: 247,
    passive: {
      name: 'Tithe', icon: '✝', id: 'tithe',
      desc: '15% of skill damage you deal to heroes returns as healing to the lowest-HP allied hero within 520 range (including you).',
    },
    skills: [
      { name: 'Let', icon: '╱', type: 'skillshot', cd: 6, mana: 45, dmgType: 'magic', dmg: 145, dmgLv: 17, scaleAp: 0.55, range: 600, speed: 860, radius: 24, desc: 'A blood lash. Your tithe drinks from it.' },
      { name: 'Offering', icon: '♥', type: 'heal', cd: 12, mana: 70, heal: 100, healLv: 16, scaleAp: 0.4, radius: 260, desc: 'A costly hymn that heals allies in a tighter radius.' },
      { name: 'Covenant', icon: '⛓', type: 'zone', cd: 43, mana: 115, dmgType: 'true', range: 480, radius: 200, delay: 0.6, dmg: 180, dmgLv: 20, scaleAp: 0.4, suppress: 0.7, desc: 'Bind an area in true damage and a brief suppression.' },
    ],
  },
];

/* Fast lookup — several systems (draft, mastery, save files) key on hero id. */
const HERO_BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));

/* Retribution's true damage to any monster, camps and epics alike: 560 at L4,
   1,000 at L15 (8% of a late Lord), so a secure is contested rather than a
   coin flip. Bots cast it when the epic's HP is at or under this. */
const retributionDamage = h => 400 + 40 * (h ? h.level : 1);

/* ============================================================
   Misc tuning
   ============================================================ */
const BALANCE = {
  xpNeed: l => 80 + 65 * (l - 1),
  maxLevel: 15,
  /* Respawn grows with the clock, not only with level: a won fight late has
     to buy the time to walk a lane and take an inhibitor. x1.25 from 18:00,
     hard cap 75 s (L12 at 12:00 = 40.4 s, L15 at 18:00 = 66.5 s). */
  respawnTime: (l, t = 0) => Math.min(75, (3.2 + 2.1 * l + t / 60) * (t >= BALANCE.respawnLateFrom ? 1.25 : 1)),
  respawnLateFrom: 900,        // section-15 lever 3: the x1.25 starts at 15:00 (spec default 18:00)
  spawnProtection: 2.5,
  /* Economy rewards are deliberately flatter than combat power (0.6x of the
     reference). A level-15 pick is worth 160 before modifiers, so kills are
     15-25% of team gold and the map is the main income. */
  heroKillGold: victim => 100 + 4 * victim.level,
  heroKillXp: victim => 70 + 15 * victim.level,
  assistShare: 0.60,           // of the kill base, split among assisters
  assistRadius: 720,           // allies this close to the victim assist without touching it
  repeatDeathPenalty: 0.12,
  repeatDeathFloor: 0.30,
  shutdownGold: streak => Math.min(180, Math.max(0, streak - 2) * 40),
  /* Structures. Turret tiers by `frac` (outer >= 0.39, middle >= 0.26, else
     inner); the base crystal has its own row. Gold is per hero of the
     taking team. `shield` is the outer's opening energy shield pool. */
  turret: {
    outer:  { hp: 3000, armor: 20, atk: 190, atkPerMin: 2.3, gold: 50, shield: 1800 },
    middle: { hp: 3400, armor: 20, atk: 215, atkPerMin: 2.5, gold: 65, shield: 0 },
    inner:  { hp: 3800, armor: 40, atk: 300, atkPerMin: 3.0, gold: 80, shield: 0 },
    base:   { hp: 4000, armor: 40, atk: 300, atkPerMin: 1.2, gold: 0,  shield: 0 },   // section-15 lever 1 (spec default 4800)
  },
  firstTowerGold: 30,
  towerRamp: 0.35,             // turret hit n on the same hero = ATK x (1 + ramp x min(rampCap, n - 1))
  towerRampCap: 8,
  towerRampReset: 2.0,         // seconds without the turret damaging that hero
  towerShieldEnd: 300,         // the six outers' energy shield lasts 0:00-5:00
  towerShieldDr: 0.30,         // damage reduction on what leaks past the shield
  towerShieldMinionHit: 25,    // minions deal a fixed amount to the shield (siege: x2)
  towerShieldGoldCap: 180,     // 1 gold per 10 shield damage, per outer
  towerShieldAllyDr: 0.15,     // allied heroes within turret range of a shielded outer
  orangeAlertUntil: 480,       // an outer dying before this arms the middle turret behind it
  orangeAlertDur: 60,
  orangeAlertDr: 0.5,
  inhibitorHp: 1800,
  inhibitorGold: 80,
  lateSiegeAt: 1200,           // from 20:00 inhibitors and the crystal take +25% and Lord respawns faster
  lateSiegeMult: 1.25,
  objectiveComebackMax: 0.7,
  comebackStartGold: 1200,
  comebackFullGold: 5200,
  comebackMaxGoldPerSec: 1.35,
  passiveGoldPerSec: 1.8,
  passiveXpPerSec: 2,
  /* Padding applied in Hero.recalcStats so every kit gets a longer TTK
     without rewriting 28 stat blocks. Armor/MR now halve damage around 95. */
  heroHpPad: 55,
  heroArmorPad: 8,
  heroMrPad: 8,
  /* Duel starts with enough gold for boots plus a component so the 1v1 is a
     build-and-fight, not a naked auto-attack trade. */
  duelStartGold: 1800,
  /* Waves: first at 0:10, then every 30 s on every lane for the whole match.
     Mid gets its cannon from wave 11 (5:10). */
  waveInterval: 30,
  firstWaveAt: 10,
  midCannonFromWave: 11,
  minionSpeed: 180,            // 0.69x hero speed: side waves clash at 0:40, mid at 0:31
  minionSpeedUpFrom: 480,      // section-15 lever 4: from 8:00 (spec default 10:00), +10 wu/s per minute, cap +80
  minionSpeedUpPerMin: 10,
  minionSpeedUpCap: 80,
  minionLateAtkFrom: 720,      // the cannon's ATK growth steepens from 12:00
  /* Minion gold is proximity-shared: the pool is split among enemy heroes
     within the share radius, the last-hitting hero adds a bonus on top, and
     a non-hero kill (turret, minion) pays 80% of the pool. The jungler
     (Retribution) and the roamer (Roam item) stay out of lane income early. */
  minionShareRadius: 600,
  lastHitBonus: 0.20,
  nonHeroKillShare: 0.80,
  junglerMinionPenaltyUntil: 300,
  junglerMinionShare: 0.5,
  roamNoFarmUntil: 480,
  junglerCreepMult: 1.4,       // Retribution holder: creep gold and XP
  junglerCreepDr: 0.4,         // ... and takes 40% less damage from creeps

  /* The opening waves have jobs instead of three identical roads. The cannon
     of the gold lane (top) pays more gold, the cannon of the EXP lane (bot)
     more XP, for the first ten waves; the outers' energy shield gives early
     pressure a bounded reward. laneBonusEnd is the shield / announcement clock. */
  laneBonusEnd: 300,
  laneBonusWaves: 10,
  goldLaneMult: 1.30,
  expLaneMult: 1.35,

  /* Epics. Turtle: three at most (2:00, then 120 s after each death, none
     scheduled after a 6:00 death); Lord from 8:00, evolves at 15:00 and
     pressures all three lanes. */
  turtleLastSpawnBefore: 360,
  turtleGold: [45, 55, 65],
  ancientLordAt: 900,
  lordWaveBoost: 60,           // seconds of +50% HP/ATK waves for the team that took Lord
  lordChargeFrac: [0.4, 0.5],  // Summoned Lord's charge: fraction of a structure's max HP (normal, evolved); section-15 lever 2 (spec default 0.3)
  /* Stalemate levers (docs/design/lanes-economy.md, 15). A Lord that is left
     alone heals this fraction of max HP per second; with `lordLeashSnap` it
     would also snap to full on reaching the pit (the Turtle always does).
     Without the snap a failed attempt still costs the Lord health, which is
     what stops heuristic bots from resetting it forty times a match.
     `lordExtraAllies` is added to the allies a bot needs nearby before it
     starts the Lord (0: measured worse, the Lord is then rarely taken). */
  lordLeashRegen: 0.01,
  lordLeashSnap: false,
  lordExtraAllies: 0,

  /* Skill points: one per hero level, ultimate gated behind these levels.
     maxSkillRank must sum to maxLevel or heroes finish with points they can
     never spend. */
  ultLevels: [4, 8, 12],
  maxSkillRank: [6, 6, 3],

  /* base regeneration, as a fraction of max per second */
  hpRegenPct: 0.006,
  manaRegenPct: 0.012,
  recallTime: 6,
};
