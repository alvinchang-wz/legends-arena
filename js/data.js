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
  slow:       { move: false, act: true,  cast: true,  tenacity: true,  icon: '❄', label: 'Slowed' },
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
    desc: 'A wind archer who shreds from long range.',
    difficulty: 2, damageStyle: 'physical',
    hp: 540, hpLv: 72, mp: 200, mpLv: 22, atk: 64, atkLv: 7.5,
    armor: 12, armorLv: 2.2, mr: 10, mrLv: 1.6,
    range: 340, atkSpd: 1.1, speed: 262,
    passive: {
      name: 'Tailwind', icon: '🍃', id: 'tailwind',
      desc: 'Every 3rd basic attack deals 40 (+60% ATK) bonus physical damage and grants +90 move speed for 1.5s.',
    },
    skills: [
      { name: 'Piercing Bolt', icon: '➹', type: 'skillshot', cd: 6, mana: 40, dmgType: 'physical', dmg: 120, dmgLv: 15, scaleAd: 0.8, range: 720, speed: 950, radius: 26, pierce: true, desc: 'Fire a bolt that pierces every enemy in a line.' },
      { name: 'Agile Hop', icon: '💨', type: 'dash', cd: 9, mana: 45, dist: 280, speed: 1000, buff: { asMult: 1.7, dur: 3 }, desc: 'Leap in a direction and gain rapid attack speed.' },
      { name: 'Arrow Storm', icon: '🌧️', type: 'zone', cd: 36, mana: 100, dmgType: 'physical', range: 620, radius: 250, delay: 0.5, ticks: 4, interval: 0.5, dmg: 70, dmgLv: 9, scaleAd: 0.35, slowPct: 0.3, slowDur: 0.8, desc: 'Rain arrows on a wide area, striking 4 times and slowing. The teamfight answer to Vesper.' },
    ],
  },
  {
    id: 'ignis', name: 'Ignis', role: 'Mage', icon: '🔥', color: '#fb923c', projColor: '#ffb066',
    desc: 'A pyromancer with devastating burst damage.',
    difficulty: 2, damageStyle: 'magic',
    hp: 500, hpLv: 64, mp: 300, mpLv: 34, atk: 46, atkLv: 4,
    armor: 10, armorLv: 2, mr: 12, mrLv: 2,
    range: 330, atkSpd: 0.9, speed: 255,
    passive: {
      name: 'Combustion', icon: '🔥', id: 'combustion',
      desc: 'Skills apply an Ember stack for 4s. At 3 stacks the target ignites, taking 90 (+50% MAGIC) magic damage over 3s and losing the stacks.',
    },
    skills: [
      { name: 'Fireball', icon: '☄️', type: 'skillshot', cd: 7, mana: 55, dmgType: 'magic', dmg: 190, dmgLv: 22, scaleAp: 0.85, range: 700, speed: 800, radius: 26, explodeR: 150, desc: 'Hurl a fireball that explodes on the first enemy hit.' },
      { name: 'Blazing Ring', icon: '🔆', type: 'nova', cd: 9, mana: 60, dmgType: 'magic', radius: 250, dmg: 150, dmgLv: 18, scaleAp: 0.6, slowPct: 0.35, slowDur: 1.5, desc: 'Erupt in flames, damaging and slowing nearby enemies.' },
      { name: 'Meteor', icon: '💥', type: 'zone', cd: 42, mana: 120, dmgType: 'magic', range: 640, radius: 240, delay: 0.95, dmg: 320, dmgLv: 34, scaleAp: 0.95, stun: 0.65, desc: 'Call a meteor that devastates and stuns an area.' },
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
    desc: 'A shadow blade who erases squishy targets.',
    difficulty: 3, damageStyle: 'physical',
    /* An assassin has to buy its damage with something. Nyx used to beat the
       Marksman on health, armour, attack, attack speed AND move speed at the
       same time while also topping the game in burst — no axis was left for
       the Marksman to win on, so picking one over Nyx was strictly wrong. The
       durability is what pays for the damage now: squishier than the Marksman
       and the Support, still tougher than the two Mages. Damage, mobility and
       burst are untouched — that is the archetype. */
    hp: 515, hpLv: 68, mp: 230, mpLv: 25, atk: 68, atkLv: 8,
    armor: 12, armorLv: 2.0, mr: 10, mrLv: 1.6,
    range: 95, atkSpd: 1.15, speed: 275,
    passive: {
      name: 'Backstab', icon: '🌑', id: 'backstab',
      desc: 'Attacks and skills that land on a target facing away deal 18% bonus true damage. Killing a hero grants +25% move speed for 3s.',
    },
    skills: [
      { name: 'Shadow Strike', icon: '🌑', type: 'dash', cd: 8, mana: 45, dmgType: 'physical', dist: 340, speed: 1100, dmg: 140, dmgLv: 17, scaleAd: 0.7, desc: 'Dash through enemies, damaging everyone in your path.' },
      { name: 'Fan of Knives', icon: '🔪', type: 'nova', cd: 7, mana: 40, dmgType: 'physical', radius: 230, dmg: 130, dmgLv: 15, scaleAd: 0.7, desc: 'Fling blades at every enemy around you.' },
      { name: 'Deathmark', icon: '☠️', type: 'blinkstrike', cd: 44, mana: 100, dmgType: 'physical', range: 500, dmg: 300, dmgLv: 34, scaleAd: 0.85, physPenPct: 0.22, silence: 0.9, desc: 'Blink to a target, silence them, and strike a lethal armor-piercing blow. The biggest single hit of any assassin, less often.' },
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
    desc: 'A berserker who thrives in extended brawls.',
    difficulty: 1, damageStyle: 'physical',
    hp: 680, hpLv: 95, mp: 210, mpLv: 23, atk: 62, atkLv: 7.2,
    armor: 18, armorLv: 3, mr: 14, mrLv: 2.2,
    range: 95, atkSpd: 1.0, speed: 265,
    passive: {
      name: 'Bloodthirst', icon: '🩸', id: 'bloodthirst',
      desc: 'Gain up to 25% Lifesteal as your health drops — the lower your HP, the more you drain.',
    },
    skills: [
      { name: 'Whirling Axe', icon: '🌀', type: 'nova', cd: 7, mana: 45, dmgType: 'physical', radius: 220, dmg: 140, dmgLv: 16, scaleAd: 0.8, desc: 'Spin your axe, shredding everything nearby.' },
      { name: 'War Leap', icon: '🦵', type: 'dash', cd: 10, mana: 50, dist: 340, speed: 1000, endNova: { radius: 180, dmgType: 'physical', dmg: 110, dmgLv: 13, scaleAd: 0.5, slowPct: 0.3, slowDur: 1.5 }, desc: 'Leap to a spot, slamming down to damage and slow.' },
      { name: 'Rampage', icon: '😤', type: 'buff', cd: 48, mana: 100, atkMult: 1.28, spdAdd: 55, hotPct: 0.16, tenacityAdd: 0.35, dur: 5.5, desc: 'Go berserk: bonus attack, speed, regeneration, and resistance to crowd control.' },
    ],
  },
  {
    id: 'mira', name: 'Mira', role: 'Mage', icon: '❄️', color: '#93c5fd', projColor: '#bfdbfe',
    desc: 'A frost witch who locks enemies in place.',
    difficulty: 2, damageStyle: 'magic',
    hp: 490, hpLv: 62, mp: 310, mpLv: 35, atk: 45, atkLv: 4,
    armor: 10, armorLv: 2, mr: 12, mrLv: 2,
    range: 335, atkSpd: 0.9, speed: 252,
    passive: {
      name: 'Frostbite', icon: '🧊', id: 'frostbite',
      desc: 'Your damage applies a Chill stack for 4s (max 4), each slowing by 8%. At 4 stacks the target is frozen solid for 0.8s and the stacks are consumed.',
    },
    skills: [
      { name: 'Frost Shard', icon: '🧿', type: 'skillshot', cd: 6, mana: 45, dmgType: 'magic', dmg: 160, dmgLv: 19, scaleAp: 0.7, range: 700, speed: 900, radius: 24, slowPct: 0.4, slowDur: 2, desc: 'Fire an icy shard that heavily slows the first enemy hit.' },
      { name: 'Ice Nova', icon: '⭕', type: 'nova', cd: 9, mana: 60, dmgType: 'magic', radius: 240, dmg: 150, dmgLv: 17, scaleAp: 0.6, slowPct: 0.5, slowDur: 2, desc: 'Freeze the air around you, damaging and slowing.' },
      { name: 'Glacial Prison', icon: '🧊', type: 'zone', cd: 42, mana: 115, dmgType: 'magic', range: 620, radius: 230, delay: 0.75, dmg: 270, dmgLv: 28, scaleAp: 0.9, stun: 1.1, desc: 'Freeze an area solid, stunning everyone inside.' },
    ],
  },
  {
    id: 'karn', name: 'Karn', role: 'Fighter', icon: '⛓️', color: '#fbbf24', projColor: '#fde68a',
    desc: 'A chained warden who drags enemies to their doom.',
    difficulty: 3, damageStyle: 'physical',
    hp: 685, hpLv: 94, mp: 230, mpLv: 25, atk: 60, atkLv: 6.8,
    /* Lighter evidence than the Nyx change, so a lighter touch: Karn was
       carrying 90% of the dedicated Tank's effective HP while out-damaging
       every other melee and holding the best crowd control in the game. The
       armour growth is the cheapest thing to give back — it lands Karn between
       the other Fighter and the Tank, which is where a Fighter belongs.
       Balance pass: base HP 720 -> 685 so the hook has a real durability cost. */
    armor: 20, armorLv: 2.6, mr: 16, mrLv: 2.6,
    range: 100, atkSpd: 0.9, speed: 260,
    passive: {
      name: 'Ironclad', icon: '⚙', id: 'ironclad',
      desc: 'Basic attacks cut 0.5s from every skill cooldown. Taking hero damage grants 3 Armor for 4s, stacking to 5.',
    },
    skills: [
      { name: 'Chain Hook', icon: '🪝', type: 'skillshot', cd: 10, mana: 55, dmgType: 'physical', dmg: 120, dmgLv: 14, scaleAd: 0.5, range: 620, speed: 800, radius: 28, hook: true, suppress: 0.6, desc: 'Throw a hook that drags the first enemy hero to you, suppressing them.' },
      { name: 'Iron Slam', icon: '🔨', type: 'nova', cd: 8, mana: 50, dmgType: 'physical', radius: 240, dmg: 145, dmgLv: 17, scaleAd: 0.7, slowPct: 0.35, slowDur: 1.5, desc: 'Smash the ground, damaging and slowing nearby enemies.' },
      { name: 'Groundbreaker', icon: '🌋', type: 'nova', cd: 42, mana: 110, dmgType: 'physical', radius: 320, dmg: 300, dmgLv: 30, scaleAd: 0.8, stun: 1, knockback: 120, desc: 'Shatter the battlefield, stunning and hurling back all enemies around you.' },
    ],
  },
  {
    id: 'vesper', name: 'Vesper', role: 'Marksman', icon: '🔫', color: '#f4bf4f', projColor: '#ffe08a',
    desc: 'A dusk gunslinger who reloads violence into every fourth shot.',
    difficulty: 2, damageStyle: 'physical',
    hp: 528, hpLv: 70, mp: 190, mpLv: 20, atk: 61, atkLv: 7.2,
    armor: 11, armorLv: 2.0, mr: 9, mrLv: 1.5,
    range: 355, atkSpd: 1.08, speed: 268,
    passive: {
      name: 'Chambered', icon: '🪙', id: 'chambered',
      desc: 'Every 4th basic attack deals 55 (+45% ATK) bonus true damage and refunds 8 mana.',
    },
    skills: [
      { name: 'Twin Report', icon: '💥', type: 'skillshot', cd: 7, mana: 40, dmgType: 'physical', dmg: 95, dmgLv: 12, scaleAd: 0.55, range: 640, speed: 1100, radius: 22, pierce: true, desc: 'Fire both pistols in a line, piercing every enemy.' },
      { name: 'Sidestep', icon: '↷', type: 'dash', cd: 10, mana: 40, dist: 240, speed: 1050, buff: { asMult: 1.45, dur: 2.4 }, desc: 'Slide aside and fan the hammers for a burst of attack speed.' },
      { name: 'Deadeye Round', icon: '🎯', type: 'skillshot', cd: 40, mana: 95, dmgType: 'physical', dmg: 300, dmgLv: 30, scaleAd: 1.0, range: 760, speed: 1500, radius: 20, desc: 'One long-range round for one target. No splash, no storm — the opposite of Zephyr.' },
    ],
  },
  {
    id: 'quill', name: 'Quill', role: 'Marksman', icon: '🎯', color: '#c4b581', projColor: '#e7d9a8',
    desc: 'A trapper who turns the ground into a hunting floor.',
    difficulty: 3, damageStyle: 'physical',
    hp: 520, hpLv: 70, mp: 210, mpLv: 24, atk: 58, atkLv: 6.6,
    armor: 13, armorLv: 2.3, mr: 11, mrLv: 1.7,
    range: 315, atkSpd: 1.02, speed: 248,
    passive: {
      name: 'Barbed', icon: '📌', id: 'barbed',
      desc: 'Skills apply a barb for 3s. Barbed enemies take 12% more damage from your basic attacks.',
    },
    skills: [
      { name: 'Caltrops', icon: '✴', type: 'zone', cd: 8, mana: 50, dmgType: 'physical', range: 520, radius: 170, delay: 0.25, dmg: 110, dmgLv: 14, scaleAd: 0.4, slowPct: 0.4, slowDur: 2, desc: 'Seed an area with caltrops that damage and slow.' },
      { name: 'Bola', icon: '◎', type: 'skillshot', cd: 11, mana: 55, dmgType: 'physical', dmg: 90, dmgLv: 11, scaleAd: 0.45, range: 600, speed: 780, radius: 28, immobilize: 1.1, desc: 'Throw a weighted net that roots the first enemy hit.' },
      { name: 'Killbox', icon: '⬡', type: 'zone', cd: 42, mana: 110, dmgType: 'physical', range: 560, radius: 240, delay: 0.55, ticks: 3, interval: 0.6, dmg: 80, dmgLv: 10, scaleAd: 0.4, slowPct: 0.35, slowDur: 1, desc: 'Drop a snare field that bites three times and keeps prey slow.' },
    ],
  },
  {
    id: 'lumen', name: 'Lumen', role: 'Marksman', icon: '🔆', color: '#9ab6e8', projColor: '#dbe7ff',
    desc: 'A glass cannon sniper who is weakest up close and lethal at the horizon.',
    difficulty: 3, damageStyle: 'physical',
    hp: 480, hpLv: 60, mp: 180, mpLv: 18, atk: 72, atkLv: 8.4,
    armor: 8, armorLv: 1.6, mr: 8, mrLv: 1.3,
    range: 385, atkSpd: 0.82, speed: 240,
    passive: {
      name: 'Aperture', icon: '📷', id: 'aperture',
      desc: 'Basic attacks deal up to 35% more damage the farther the target is (starts past 280 range).',
    },
    skills: [
      { name: 'Railshot', icon: '━', type: 'skillshot', cd: 8, mana: 50, dmgType: 'physical', dmg: 160, dmgLv: 20, scaleAd: 0.9, range: 820, speed: 1400, radius: 18, pierce: true, desc: 'Fire a piercing rail that rewards long sightlines.' },
      { name: 'Displace', icon: '↩', type: 'dash', cd: 12, mana: 40, dist: 200, speed: 900, desc: 'A short hop to reset your footing. No extra damage.' },
      { name: 'Overcharge', icon: '✦', type: 'zone', cd: 46, mana: 120, dmgType: 'physical', range: 700, radius: 90, delay: 1.15, dmg: 420, dmgLv: 44, scaleAd: 1.0, stun: 0.5, desc: 'Charge a thin beam that detonates on one victim. Single-target damage no AoE ult is allowed to match.' },
    ],
  },
  {
    id: 'volt', name: 'Volt', role: 'Mage', icon: '⚡', color: '#fde047', projColor: '#fef08a',
    desc: 'A stormcaller who shreds magic resist with every spark.',
    difficulty: 2, damageStyle: 'magic',
    hp: 505, hpLv: 63, mp: 290, mpLv: 32, atk: 44, atkLv: 3.8,
    armor: 9, armorLv: 1.9, mr: 13, mrLv: 2.1,
    range: 325, atkSpd: 0.88, speed: 270,
    passive: {
      name: 'Static', icon: '⚡', id: 'static',
      desc: 'Skill hits cut 8 Magic Resist for 4s, stacking to 5. The anti-tank mage: nobody else shreds resists.',
    },
    skills: [
      { name: 'Arc Lance', icon: '↯', type: 'skillshot', cd: 6, mana: 50, dmgType: 'magic', dmg: 170, dmgLv: 20, scaleAp: 0.75, range: 680, speed: 1050, radius: 22, pierce: true, desc: 'Throw a bolt that chains through a line of enemies.' },
      { name: 'Flashover', icon: '✳', type: 'nova', cd: 9, mana: 60, dmgType: 'magic', radius: 230, dmg: 140, dmgLv: 16, scaleAp: 0.55, stun: 0.5, desc: 'Detonate a shock around you, briefly stunning.' },
      { name: 'Thunderhead', icon: '☁', type: 'zone', cd: 40, mana: 115, dmgType: 'magic', range: 600, radius: 220, delay: 0.4, ticks: 5, interval: 0.45, dmg: 64, dmgLv: 8, scaleAp: 0.28, desc: 'A storm cloud that strikes five times. Pays for the shred with softer ticks.' },
    ],
  },
  {
    id: 'nadir', name: 'Nadir', role: 'Mage', icon: '🌀', color: '#7c3aed', projColor: '#c4b5fd',
    desc: 'A gravity mage who collapses space onto a single point.',
    difficulty: 3, damageStyle: 'magic',
    hp: 510, hpLv: 66, mp: 300, mpLv: 33, atk: 42, atkLv: 3.6,
    armor: 11, armorLv: 2.1, mr: 14, mrLv: 2.2,
    range: 310, atkSpd: 0.86, speed: 244,
    passive: {
      name: 'Event Horizon', icon: '●', id: 'horizon',
      desc: 'Killing a hero restores 12% missing HP and 40 mana. Assists restore half.',
    },
    skills: [
      { name: 'Singularity', icon: '◉', type: 'skillshot', cd: 7, mana: 55, dmgType: 'magic', dmg: 175, dmgLv: 21, scaleAp: 0.8, range: 640, speed: 720, radius: 30, explodeR: 140, slowPct: 0.45, slowDur: 1.4, desc: 'Hurl a collapsing star that explodes and slows.' },
      { name: 'Crush', icon: '⬤', type: 'nova', cd: 10, mana: 65, dmgType: 'magic', radius: 260, dmg: 130, dmgLv: 15, scaleAp: 0.5, knockback: -80, desc: 'Pull nearby enemies inward and damage them.' },
      { name: 'Implosion', icon: '◎', type: 'zone', cd: 44, mana: 125, dmgType: 'magic', range: 580, radius: 260, delay: 0.85, dmg: 320, dmgLv: 34, scaleAp: 1.05, stun: 1.1, desc: 'After a delay, crush a huge area and stun everyone inside. Widest mage ult in the game, paid for with damage.' },
    ],
  },
  {
    id: 'ashara', name: 'Ashara', role: 'Mage', icon: '🏜️', color: '#d4a017', projColor: '#f5d76e',
    desc: 'A sand seer who steals voices and buries the careless.',
    difficulty: 2, damageStyle: 'magic',
    hp: 495, hpLv: 64, mp: 280, mpLv: 30, atk: 47, atkLv: 4.2,
    armor: 10, armorLv: 2.0, mr: 11, mrLv: 1.9,
    range: 305, atkSpd: 0.92, speed: 256,
    passive: {
      name: 'Dry Mouth', icon: '🌬️', id: 'drymouth',
      desc: 'The third skill hit on a target silences them for 0.9s (8s per target).',
    },
    skills: [
      { name: 'Glass Needle', icon: '↾', type: 'skillshot', cd: 6, mana: 45, dmgType: 'magic', dmg: 155, dmgLv: 18, scaleAp: 0.65, range: 660, speed: 880, radius: 22, slowPct: 0.25, slowDur: 1.2, desc: 'A shard of fused sand that damages and slows.' },
      { name: 'Dune Wake', icon: '〜', type: 'nova', cd: 9, mana: 55, dmgType: 'magic', radius: 250, dmg: 145, dmgLv: 17, scaleAp: 0.55, slowPct: 0.4, slowDur: 1.6, desc: 'Kick up a scouring ring of sand.' },
      { name: 'Burial', icon: '⏳', type: 'zone', cd: 41, mana: 110, dmgType: 'magic', range: 560, radius: 210, delay: 0.6, ticks: 4, interval: 0.5, dmg: 55, dmgLv: 7, scaleAp: 0.3, slowPct: 0.3, slowDur: 0.7, silence: 1.0, desc: 'A sandpit that chews four times and seals voices shut. The only mage ult with a silence.' },
    ],
  },
  {
    id: 'hexa', name: 'Hexa', role: 'Mage', icon: '🔮', color: '#a78bfa', projColor: '#ddd6fe',
    desc: 'A hexwright whose glances leave rotting marks.',
    difficulty: 2, damageStyle: 'magic',
    hp: 488, hpLv: 61, mp: 315, mpLv: 36, atk: 43, atkLv: 3.7,
    armor: 9, armorLv: 1.8, mr: 15, mrLv: 2.3,
    range: 345, atkSpd: 0.84, speed: 238,
    passive: {
      name: 'Blight', icon: '🧿', id: 'blight',
      desc: 'Basic attacks apply a blight that deals 50 (+30% MAGIC) magic damage over 3s. Refreshing it stacks to 2. The rot mage: weakest upfront hit, strongest damage over time.',
    },
    skills: [
      { name: 'Hex Bolt', icon: '☽', type: 'skillshot', cd: 7, mana: 50, dmgType: 'magic', dmg: 145, dmgLv: 17, scaleAp: 0.7, range: 690, speed: 820, radius: 24, desc: 'A cursed bolt that carries your blight with it.' },
      { name: 'Ruin Pulse', icon: '✺', type: 'nova', cd: 10, mana: 60, dmgType: 'magic', radius: 220, dmg: 155, dmgLv: 18, scaleAp: 0.6, desc: 'Pulse hex-fire around you.' },
      { name: 'Black Mass', icon: '⬤', type: 'zone', cd: 42, mana: 120, dmgType: 'magic', range: 600, radius: 230, delay: 0.5, ticks: 6, interval: 0.4, dmg: 58, dmgLv: 8, scaleAp: 0.22, desc: 'A lingering curse that ticks six times — more ticks than any other mage ult.' },
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
    desc: 'A buckler brawler who shrugs hero damage and answers with the rim.',
    difficulty: 1, damageStyle: 'physical',
    hp: 700, hpLv: 92, mp: 200, mpLv: 22, atk: 56, atkLv: 6.2,
    armor: 21, armorLv: 3.2, mr: 15, mrLv: 2.4,
    range: 105, atkSpd: 0.96, speed: 250,
    passive: {
      name: 'Rimguard', icon: '○', id: 'rimguard',
      desc: 'Take 10% less damage from enemy heroes. The protector: lowest fighter damage, highest team value.',
    },
    skills: [
      { name: 'Buckler', icon: '◎', type: 'nova', cd: 7, mana: 45, dmgType: 'physical', radius: 200, dmg: 130, dmgLv: 15, scaleAd: 0.55, slowPct: 0.3, slowDur: 1.2, desc: 'Bash the buckler, damaging and slowing.' },
      { name: 'Shoulder', icon: '▶', type: 'dash', cd: 11, mana: 50, dmgType: 'physical', dist: 340, speed: 900, dmg: 100, dmgLv: 12, scaleAd: 0.5, stopOnHero: true, stun: 0.7, desc: 'Shoulder-check the first hero, stunning them.' },
      { name: 'Hold the Line', icon: '▣', type: 'buff', cd: 44, mana: 90, atkMult: 1.2, spdAdd: 40, tenacityAdd: 0.35, dur: 5, desc: 'Brace: bonus attack, speed, and tenacity.' },
    ],
  },
  {
    id: 'omen', name: 'Omen', role: 'Fighter', icon: '⚔️', color: '#94a3b8', projColor: '#e2e8f0',
    desc: 'A twin-blade duelist who speeds up the longer the fight lasts.',
    difficulty: 2, damageStyle: 'physical',
    hp: 640, hpLv: 88, mp: 205, mpLv: 22, atk: 65, atkLv: 7.4,
    armor: 16, armorLv: 2.6, mr: 13, mrLv: 2.0,
    range: 108, atkSpd: 1.04, speed: 266,
    passive: {
      name: 'Cadence', icon: '♪', id: 'cadence',
      desc: 'Basic attacks grant 4% attack speed for 3s, stacking to 8.',
    },
    skills: [
      { name: 'Crosscut', icon: '✕', type: 'nova', cd: 6, mana: 40, dmgType: 'physical', radius: 190, dmg: 125, dmgLv: 14, scaleAd: 0.75, desc: 'A tight X of steel around you.' },
      { name: 'Pass', icon: '↦', type: 'dash', cd: 9, mana: 45, dmgType: 'physical', dist: 300, speed: 1050, dmg: 90, dmgLv: 11, scaleAd: 0.5, desc: 'Step through, cutting the lane.' },
      { name: 'Duelist\'s End', icon: '†', type: 'dash', cd: 40, mana: 100, dmgType: 'physical', dist: 400, speed: 1200, dmg: 260, dmgLv: 28, scaleAd: 0.85, stopOnHero: true, stun: 0.9, desc: 'A committed lunge that stuns the first hero.' },
    ],
  },
  {
    id: 'tide', name: 'Tide', role: 'Fighter', icon: '🌊', color: '#0ea5e9', projColor: '#7dd3fc',
    desc: 'A breaker who shoves people off the objective they wanted.',
    difficulty: 2, damageStyle: 'magic',
    hp: 660, hpLv: 90, mp: 230, mpLv: 26, atk: 55, atkLv: 6.0,
    armor: 17, armorLv: 2.7, mr: 16, mrLv: 2.5,
    range: 112, atkSpd: 0.98, speed: 254,
    passive: {
      name: 'Undertow', icon: '〰', id: 'undertow',
      desc: 'Basic attacks slow by 12% for 1s. Heroes already slowed take 8% bonus magic damage from you.',
    },
    skills: [
      { name: 'Breaker', icon: '≈', type: 'skillshot', cd: 8, mana: 50, dmgType: 'magic', dmg: 140, dmgLv: 16, scaleAp: 0.45, range: 560, speed: 700, radius: 32, pierce: true, knockback: 90, desc: 'A wave that knocks everyone in a line back.' },
      { name: 'Riptide', icon: '↻', type: 'nova', cd: 9, mana: 50, dmgType: 'magic', radius: 240, dmg: 135, dmgLv: 16, scaleAp: 0.5, knockback: 70, desc: 'A circular surge that shoves enemies out.' },
      { name: 'High Water', icon: '🌊', type: 'zone', cd: 42, mana: 110, dmgType: 'magic', range: 500, radius: 250, delay: 0.5, dmg: 260, dmgLv: 28, scaleAp: 0.7, airborne: 0.7, desc: 'A crashing wall of water that launches the area.' },
    ],
  },
  {
    id: 'cinder', name: 'Cinder', role: 'Fighter', icon: '🧨', color: '#ea580c', projColor: '#fdba74',
    desc: 'A coal-fist brawler who burns what she cannot break.',
    difficulty: 1, damageStyle: 'magic',
    hp: 650, hpLv: 86, mp: 215, mpLv: 24, atk: 57, atkLv: 6.2,
    armor: 15, armorLv: 2.5, mr: 14, mrLv: 2.2,
    range: 118, atkSpd: 1.06, speed: 246,
    passive: {
      name: 'Live Coal', icon: '🔶', id: 'livecoal',
      desc: 'Basic attacks apply a 3s burn for 25 (+20% MAGIC) magic damage. Skills refresh it.',
    },
    skills: [
      { name: 'Haymaker', icon: '✊', type: 'nova', cd: 7, mana: 45, dmgType: 'magic', radius: 200, dmg: 145, dmgLv: 17, scaleAp: 0.55, desc: 'A burning haymaker around you.' },
      { name: 'Coal Dash', icon: '☄', type: 'dash', cd: 10, mana: 50, dist: 320, speed: 980, endNova: { radius: 170, dmgType: 'magic', dmg: 100, dmgLv: 12, scaleAp: 0.4, slowPct: 0.25, slowDur: 1.2 }, desc: 'Dash and detonate cinders on landing.' },
      { name: 'Furnace', icon: '♨', type: 'buff', cd: 43, mana: 95, atkMult: 1.25, spdAdd: 50, hotPct: 0.18, dur: 5.5, desc: 'Stoke the furnace: attack, speed, and regeneration.' },
    ],
  },
  {
    id: 'bastion', name: 'Bastion', role: 'Tank', icon: '🏰', color: '#78716c', projColor: '#d6d3d1',
    desc: 'A walking keep who shares armor with whoever stands in his shadow.',
    difficulty: 1, damageStyle: 'physical',
    hp: 740, hpLv: 100, mp: 230, mpLv: 25, atk: 52, atkLv: 5.4,
    armor: 24, armorLv: 3.8, mr: 17, mrLv: 2.6,
    range: 88, atkSpd: 0.80, speed: 242,
    passive: {
      name: 'Rampart', icon: '☗', id: 'rampart',
      desc: 'Every 8s, grant nearby allied heroes a shield equal to 8% of your max HP for 3s.',
    },
    skills: [
      { name: 'Portcullis', icon: '⊓', type: 'nova', cd: 8, mana: 50, dmgType: 'physical', radius: 230, dmg: 120, dmgLv: 14, scaleAd: 0.45, stun: 0.7, desc: 'Slam a gate down, stunning nearby enemies.' },
      { name: 'Sally', icon: '⇉', type: 'dash', cd: 13, mana: 55, dmgType: 'physical', dist: 380, speed: 850, dmg: 90, dmgLv: 11, scaleAd: 0.4, stopOnHero: true, slowPct: 0.4, slowDur: 1.5, desc: 'A committed sally that slows the first hero.' },
      { name: 'Siege Law', icon: '⬡', type: 'zone', cd: 44, mana: 115, dmgType: 'physical', range: 420, radius: 260, delay: 0.4, dmg: 220, dmgLv: 24, scaleAd: 0.5, immobilize: 1.4, desc: 'Claim ground: enemies inside are rooted.' },
    ],
  },
  {
    id: 'marrow', name: 'Marrow', role: 'Tank', icon: '🦴', color: '#e7e5e4', projColor: '#fafaf9',
    desc: 'An ossuary knight who gets harder to kill the closer he is to dying.',
    difficulty: 2, damageStyle: 'magic',
    hp: 720, hpLv: 96, mp: 240, mpLv: 26, atk: 50, atkLv: 5.2,
    armor: 19, armorLv: 3.0, mr: 20, mrLv: 3.0,
    range: 85, atkSpd: 0.78, speed: 236,
    passive: {
      name: 'Ossify', icon: '🦴', id: 'ossify',
      desc: 'Take up to 25% less damage as your health falls (full reduction below 25% HP).',
    },
    skills: [
      { name: 'Ribcage', icon: '☰', type: 'nova', cd: 8, mana: 50, dmgType: 'magic', radius: 220, dmg: 125, dmgLv: 14, scaleAp: 0.4, slowPct: 0.35, slowDur: 1.6, desc: 'Fan of bones that slows.' },
      { name: 'Splint', icon: '✚', type: 'heal', cd: 12, mana: 60, heal: 90, healLv: 14, scaleAp: 0.35, radius: 280, shieldPct: 0.05, desc: 'Knit bone: heal nearby allies and shield them briefly.' },
      { name: 'Catacomb', icon: '⚰', type: 'zone', cd: 43, mana: 110, dmgType: 'magic', range: 480, radius: 240, delay: 0.7, dmg: 240, dmgLv: 26, scaleAp: 0.6, airborne: 0.8, desc: 'The floor gives way, launching enemies.' },
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
      desc: 'Skill hits against slowed, rooted, or stunned enemies deal 15% bonus damage.',
    },
    skills: [
      { name: 'Hawser', icon: '⌇', type: 'skillshot', cd: 11, mana: 55, dmgType: 'physical', dmg: 110, dmgLv: 13, scaleAd: 0.4, range: 580, speed: 760, radius: 26, immobilize: 1.3, desc: 'A heavy line that roots the first enemy. It does not drag them.' },
      { name: 'Heave', icon: '⇧', type: 'dash', cd: 12, mana: 50, dmgType: 'physical', dist: 280, speed: 800, dmg: 100, dmgLv: 12, scaleAd: 0.45, stopOnHero: true, stun: 0.6, desc: 'Heave into the first hero and daze them.' },
      { name: 'Harbour', icon: '◉', type: 'nova', cd: 42, mana: 110, dmgType: 'physical', radius: 300, dmg: 240, dmgLv: 26, scaleAd: 0.55, slowPct: 0.5, slowDur: 2.2, desc: 'Drop the harbour: a massive slow around you.' },
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
