'use strict';
/* ============================================================
   items.js — the shop, battle spells and emblems.

   Three loadout systems that all feed the same place: a hero's
   `attrs.bonus` block, rebuilt by Hero.recalcStats. None of them
   touch combat directly, which is why a new item never needs a
   change to the damage pipeline.
   ============================================================ */

/* ============================================================
   Items
   ============================================================
   Two tiers. Components are single-stat and cheap; finished items
   are built from two components plus a recipe cost, and are where
   the interesting effects live.

   `tags` drive the bot shopper (see ItemAI.pick): it scores an item
   by how well its tags answer the match the bot is actually in,
   rather than walking a fixed build order that ignores the enemy. */

const ITEM_SLOTS = 6;

const COMPONENTS = {
  longsword:  { id: 'longsword',  name: 'Longsword',       icon: '🗡', cost: 350, stats: { physAtk: 15 } },
  dagger:     { id: 'dagger',     name: 'Swift Dagger',    icon: '🔪', cost: 300, stats: { atkSpd: 0.15 } },
  chainmail:  { id: 'chainmail',  name: 'Chainmail',       icon: '⛓', cost: 400, stats: { armor: 22 } },
  cloak:      { id: 'cloak',      name: 'Null Cloak',      icon: '🧣', cost: 400, stats: { mr: 22 } },
  vitality:   { id: 'vitality',   name: 'Vitality Crystal',icon: '💗', cost: 450, stats: { maxHp: 250 } },
  focus:      { id: 'focus',      name: 'Focus Shard',     icon: '🔮', cost: 400, stats: { magicPower: 25 } },
  boots:      { id: 'boots',      name: 'Boots',           icon: '👢', cost: 300, stats: { speed: 40 } },
  loop:       { id: 'loop',       name: 'Chrono Loop',     icon: '⏳', cost: 350, stats: { cdr: 0.05 } },
  whetstone:  { id: 'whetstone',  name: 'Whetstone',       icon: '🪨', cost: 380, stats: { critChance: 0.10 } },
};

/* Finished items. `from` lists component ids; `recipe` is the extra gold.
   Total cost is derived, never hand-written, so a component price change
   can't silently desync a build path. */
const ITEM_DEFS = [
  /* ---------------- Attack ---------------- */
  { id: 'ruin', name: 'Blade of Ruin', icon: '⚔️', cat: 'Attack', tags: ['phys', 'damage'],
    from: ['longsword', 'longsword'], recipe: 450, stats: { physAtk: 65 },
    desc: 'Raw physical power.' },
  { id: 'executioner', name: "Executioner's Edge", icon: '🪓', cat: 'Attack', tags: ['phys', 'pen'],
    from: ['longsword', 'whetstone'], recipe: 620, stats: { physAtk: 40, physPenPct: 0.25 },
    desc: 'Ignores 25% of the target’s Armor.' },
  { id: 'bloodthirster', name: 'Bloodthirster', icon: '🩸', cat: 'Attack', tags: ['phys', 'sustain'],
    from: ['longsword', 'vitality'], recipe: 700, stats: { physAtk: 45, lifesteal: 0.22 },
    desc: '22% of physical damage dealt is returned as health.' },
  { id: 'berserker', name: "Berserker's Fang", icon: '💥', cat: 'Attack', tags: ['phys', 'crit'],
    from: ['whetstone', 'whetstone'], recipe: 700, stats: { critChance: 0.25, critDmg: 0.4, physAtk: 20 },
    desc: '+25% Crit Chance and heavier crits.' },
  { id: 'windtalker', name: 'Windtalker', icon: '🌪', cat: 'Attack', tags: ['phys', 'speed'],
    from: ['dagger', 'boots'], recipe: 500, stats: { atkSpd: 0.35, speed: 40, critChance: 0.10 },
    desc: 'Attack speed, move speed and a little crit.' },
  { id: 'demonhunter', name: 'Demon Hunter Blade', icon: '😈', cat: 'Attack', tags: ['phys', 'antitank'],
    from: ['dagger', 'longsword'], recipe: 720, stats: { physAtk: 30, atkSpd: 0.25, physPen: 20 },
    desc: 'Flat Armor penetration — best against stacked defence.' },

  /* ---------------- Magic ---------------- */
  { id: 'starfall', name: 'Starfall Crown', icon: '👑', cat: 'Magic', tags: ['magic', 'damage'],
    from: ['focus', 'focus'], recipe: 550, stats: { magicPower: 85 },
    desc: 'Overwhelming raw Magic Power.' },
  { id: 'voidsigil', name: 'Void Sigil', icon: '🕳', cat: 'Magic', tags: ['magic', 'pen'],
    from: ['focus', 'loop'], recipe: 650, stats: { magicPower: 45, magicPenPct: 0.25 },
    desc: 'Ignores 25% of the target’s Magic Resist.' },
  { id: 'soulstealer', name: 'Soulstealer', icon: '👻', cat: 'Magic', tags: ['magic', 'sustain'],
    from: ['focus', 'vitality'], recipe: 700, stats: { magicPower: 50, spellVamp: 0.20, maxHp: 200 },
    desc: '20% of skill damage is returned as health.' },
  { id: 'chronomancer', name: 'Chronomancer', icon: '⌛', cat: 'Magic', tags: ['magic', 'cdr'],
    from: ['loop', 'loop'], recipe: 600, stats: { cdr: 0.20, magicPower: 35, manaRegen: 10 },
    desc: '+20% Cooldown Reduction and mana sustain.' },
  { id: 'frostgale', name: 'Frostgale Orb', icon: '❄️', cat: 'Magic', tags: ['magic', 'defense'],
    from: ['focus', 'chainmail'], recipe: 640, stats: { magicPower: 40, armor: 30, maxHp: 150 },
    desc: 'Magic damage that survives being dived.' },
  { id: 'lightbringer', name: 'Lightbringer', icon: '🌟', cat: 'Magic', tags: ['magic', 'pen'],
    from: ['focus', 'longsword'], recipe: 700, stats: { magicPower: 55, magicPen: 20 },
    desc: 'Flat Magic penetration.' },

  /* ---------------- Defense ---------------- */
  { id: 'ironhide', name: 'Ironhide Plate', icon: '🛡', cat: 'Defense', tags: ['armor', 'defense'],
    from: ['chainmail', 'chainmail'], recipe: 500, stats: { armor: 70 },
    desc: 'Heavy Armor against physical damage.' },
  { id: 'warden', name: "Warden's Mail", icon: '🏰', cat: 'Defense', tags: ['armor', 'hp', 'defense'],
    from: ['chainmail', 'vitality'], recipe: 620, stats: { armor: 45, maxHp: 500, hpRegen: 8 },
    desc: 'Armor, health and regeneration.' },
  { id: 'aegis', name: 'Aegis Cloak', icon: '✨', cat: 'Defense', tags: ['mr', 'defense'],
    from: ['cloak', 'cloak'], recipe: 500, stats: { mr: 70 },
    desc: 'Heavy Magic Resist.' },
  { id: 'nullstone', name: 'Nullstone', icon: '🪬', cat: 'Defense', tags: ['mr', 'cdr', 'defense'],
    from: ['cloak', 'loop'], recipe: 600, stats: { mr: 48, cdr: 0.10, maxHp: 200 },
    desc: 'Magic Resist plus cooldown reduction.' },
  { id: 'colossus', name: 'Colossus Heart', icon: '💚', cat: 'Defense', tags: ['hp', 'defense'],
    from: ['vitality', 'vitality'], recipe: 550, stats: { maxHp: 1100, hpRegen: 12 },
    desc: 'An enormous health pool.' },
  { id: 'bulwark', name: 'Oathkeeper Bulwark', icon: '🔰', cat: 'Defense', tags: ['armor', 'mr', 'defense'],
    from: ['chainmail', 'cloak'], recipe: 680, stats: { armor: 40, mr: 40, tenacity: 0.30 },
    desc: 'Balanced resists and +30% Tenacity.' },

  /* ---------------- Boots ---------------- */
  { id: 'swiftboots', name: 'Swift Boots', icon: '👟', cat: 'Boots', tags: ['boots', 'speed'],
    from: ['boots', 'dagger'], recipe: 250, stats: { speed: 40, atkSpd: 0.20 },
    desc: 'Movement and attack speed.' },
  { id: 'arcaneboots', name: 'Arcane Boots', icon: '🥾', cat: 'Boots', tags: ['boots', 'magic'],
    from: ['boots', 'focus'], recipe: 250, stats: { speed: 40, magicPen: 12 },
    desc: 'Movement and flat Magic penetration.' },
  { id: 'warriorboots', name: 'Warrior Boots', icon: '🦿', cat: 'Boots', tags: ['boots', 'armor'],
    from: ['boots', 'chainmail'], recipe: 250, stats: { speed: 40, armor: 25 },
    desc: 'Movement and Armor.' },
  { id: 'toughboots', name: 'Tough Boots', icon: '🧦', cat: 'Boots', tags: ['boots', 'mr'],
    from: ['boots', 'cloak'], recipe: 250, stats: { speed: 40, mr: 25, tenacity: 0.20 },
    desc: 'Movement, Magic Resist and +20% Tenacity.' },

  /* ---------------- Roam / Jungle ---------------- */
  { id: 'guardian', name: 'Guardian Charm', icon: '🕊', cat: 'Roam', tags: ['support', 'hp'],
    from: ['vitality', 'loop'], recipe: 520, stats: { maxHp: 450, cdr: 0.10, hpRegen: 10 },
    desc: 'Health and cooldown reduction for front-liners.' },
  { id: 'rally', name: 'Rally Banner', icon: '🚩', cat: 'Roam', tags: ['support', 'speed'],
    from: ['boots', 'vitality'], recipe: 520, stats: { speed: 50, maxHp: 350, mr: 20 },
    desc: 'Roaming speed and staying power.' },
  { id: 'beastbane', name: 'Beastbane', icon: '🐗', cat: 'Jungle', tags: ['jungle', 'phys'],
    from: ['longsword', 'dagger'], recipe: 480, stats: { physAtk: 30, atkSpd: 0.15, hpRegen: 10 },
    desc: 'Clears camps quickly and sustains through them.' },

  /* ---------------- Consumables / Vision / Actives ---------------- */
  { id: 'hpPotion', name: 'Health Potion', icon: '🧪', cat: 'Consumable', tags: ['consumable', 'sustain'],
    from: [], recipe: 150, stats: {},
    desc: 'Restore 420 HP over 3s. Cannot be used in combat. Hotkey 4.',
    consume: 'hp' },
  { id: 'manaPotion', name: 'Mana Tonic', icon: '💧', cat: 'Consumable', tags: ['consumable'],
    from: [], recipe: 125, stats: {},
    desc: 'Restore 280 mana over 3s. Cannot be used in combat. Hotkey 5.',
    consume: 'mana' },
  { id: 'flask', name: 'Mixed Flask', icon: '🍷', cat: 'Consumable', tags: ['consumable', 'sustain'],
    from: [], recipe: 220, stats: {},
    desc: 'Restore 260 HP and 160 mana over 4s, even in combat. Hotkey 6.',
    consume: 'flask' },
  { id: 'stealthWard', name: 'Stealth Ward', icon: '👁', cat: 'Vision', tags: ['ward', 'vision'],
    from: [], recipe: 75, stats: {},
    desc: 'Place an invisible ward (90s, 2 max). Grants vision in a 420 radius.',
    consume: 'ward' },
  { id: 'controlWard', name: 'Control Ward', icon: '🧿', cat: 'Vision', tags: ['ward', 'vision'],
    from: [], recipe: 100, stats: {},
    desc: 'A revealed ward that also disables enemy wards nearby. Lasts 120s.',
    consume: 'controlWard' },
  { id: 'sweeper', name: 'Sweeper Lens', icon: '📡', cat: 'Vision', tags: ['ward', 'vision'],
    from: [], recipe: 90, stats: {},
    desc: 'Pulse true sight in 380 radius for 6s and clear enemy wards.',
    consume: 'sweeper' },
  { id: 'aegisPulse', name: 'Aegis Pulse', icon: '🛡', cat: 'Active', tags: ['defense', 'active'],
    from: ['cloak', 'vitality'], recipe: 480, stats: { mr: 28, maxHp: 280 },
    desc: 'Active: shield yourself for 280 + 8% max HP for 2.5s (60s CD).',
    active: { id: 'aegisPulse', cd: 60 } },
  { id: 'frostheart', name: 'Frostheart', icon: '❄️', cat: 'Active', tags: ['magic', 'active'],
    from: ['focus', 'cloak'], recipe: 520, stats: { magicPower: 35, mr: 22 },
    desc: 'Active: slow enemies in 260 radius by 40% for 2s (50s CD).',
    active: { id: 'frostheart', cd: 50 } },
  { id: 'windfeather', name: 'Windfeather', icon: '🪶', cat: 'Active', tags: ['speed', 'active'],
    from: ['boots', 'loop'], recipe: 400, stats: { speed: 25, cdr: 0.08 },
    desc: 'Active: dash 280 units toward your aim (75s CD).',
    active: { id: 'windfeather', cd: 75 } },
];

/* Derived: full cost of every item, and a lookup by id. */
for (const it of ITEM_DEFS) {
  it.componentCost = it.from.reduce((s, c) => s + COMPONENTS[c].cost, 0);
  it.cost = it.componentCost + it.recipe;
}
const ITEM_BY_ID = Object.fromEntries(ITEM_DEFS.map(i => [i.id, i]));
const ITEM_CATEGORIES = [...new Set(ITEM_DEFS.map(i => i.cat))];

/* ============================================================
   Bot shopping
   ============================================================
   A bot buys the item that best answers the game in front of it. The
   score is deliberately simple and readable: match your own damage
   type, then buy the resist the enemy team is actually threatening
   you with, then fill out damage. */
const ItemAI = {
  /* Where the enemy's damage is coming from, as a fraction in [0,1]
     leaning magic. Reads their hero definitions, not their build, which
     is what a player would do at draft. */
  enemyMagicShare(hero) {
    let magic = 0, total = 0;
    for (const h of Game.heroes) {
      if (h.team === hero.team) continue;
      total++;
      if (h.def0.damageStyle === 'magic') magic++;
    }
    return total ? magic / total : 0.5;
  },

  /* damageStyle is 'physical'/'magic'; item tags are 'phys'/'magic'. Mapping
     them explicitly beats hoping the two vocabularies stay in step. */
  STYLE_TAG: { physical: 'phys', magic: 'magic' },

  score(item, hero) {
    if (item.tags && (item.tags.includes('consumable') || item.tags.includes('ward'))) {
      if (hero.items.some(i => i.id === item.id)) return -Infinity;
      if (item.id === 'hpPotion' && hero.hpPct < 0.42) return 35;
      return -40;
    }
    const mine = this.STYLE_TAG[hero.def0.damageStyle] || 'phys';
    const other = mine === 'phys' ? 'magic' : 'phys';
    const magicShare = this.enemyMagicShare(hero);
    let s = 0;

    // offence that matches the hero's own scaling is worth the most, and
    // offence that scales off the stat they do not have is worth negative
    if (item.tags.includes(mine)) s += 110;
    if (item.tags.includes(other)) s -= 90;

    // exactly one pair of boots, bought early
    if (item.cat === 'Boots') {
      if (hero.items.some(i => i.cat === 'Boots')) return -Infinity;
      s += 130 - hero.items.length * 20;
    }

    // buy the resist that is actually being used against you
    if (item.tags.includes('armor')) s += 90 * (1 - magicShare);
    if (item.tags.includes('mr')) s += 90 * magicShare;

    const role = hero.def0.role;
    const carry = role === 'Marksman' || role === 'Mage' || role === 'Assassin';
    // tanks and supports weight survivability over damage
    if (role === 'Tank' || role === 'Support') {
      if (item.tags.includes('defense') || item.tags.includes('hp')) s += 70;
      if (item.tags.includes('damage')) s -= 40;
    }
    /* Carries buy damage first. Without this the resist bonuses below win
       every early slot and a marksman finishes the game with five defensive
       items and no way to kill anything. */
    if (carry) {
      const offence = hero.items.filter(i => i.tags.includes(mine)).length;
      if (item.tags.includes(mine)) s += Math.max(0, 90 - offence * 30);
      if (item.tags.includes('defense') && offence < 2) s -= 80;
    }
    if (role === 'Marksman' && (item.tags.includes('crit') || item.tags.includes('speed'))) s += 45;
    if (role === 'Assassin' && item.tags.includes('pen')) s += 45;
    if (role === 'Support' && item.tags.includes('support')) s += 60;

    // never buy two of the same thing
    if (hero.items.some(i => i.id === item.id)) return -Infinity;

    // mild preference for finishing cheaper items first so gold keeps moving
    s -= item.cost / 120;
    return s;
  },

  /* Shared by bots and the player's Quick Buy card. Keeping one recommender
     means the shop suggestion reacts to role and enemy damage instead of
     following a brittle six-item script. */
  recommend(hero, affordableOnly = false) {
    if (!hero || hero.items.length >= ITEM_SLOTS) return null;
    let best = null, bestScore = -Infinity;
    for (const it of ITEM_DEFS) {
      if (affordableOnly && it.cost > hero.gold) continue;
      const sc = this.score(it, hero);
      if (sc > bestScore) { bestScore = sc; best = it; }
    }
    return bestScore === -Infinity ? null : best;
  },

  /* Buy at most one item per call. Bots only shop at their own fountain,
     which is what makes recalling a real decision for them too. */
  tryBuy(hero) {
    if (hero.items.length >= ITEM_SLOTS) return false;
    // being dead means being at the fountain: buy on the respawn timer too
    if (Game.isDuel() || (hero.alive && dist(hero, Game.fountain(hero.team)) > 380)) return false;
    const best = this.recommend(hero, true);
    if (!best) return false;
    hero.buyItem(best);
    return true;
  },
};

/* ============================================================
   Battle spells
   ============================================================
   One per hero, chosen before the match. Each is a function of the
   caster; `cd` is in seconds and is not affected by cooldown
   reduction, as in ML. */
const BATTLE_SPELLS = [
  {
    id: 'flicker', name: 'Flicker', icon: '💫', cd: 100,
    desc: 'Blink a short distance toward your aim point. Passes through walls.',
    aimRange: 420,
    cast(h, point) {
      const dir = point ? norm(point.x - h.x, point.y - h.y) : { x: Math.cos(h.facing), y: Math.sin(h.facing) };
      const ox = h.x, oy = h.y, distBlink = 420;
      Game.fx.ghost(h);
      Game.fx.ring(h.x, h.y, 60, THEME.magic, 0.4);
      h.x += dir.x * distBlink;
      h.y += dir.y * distBlink;
      Game.clampPoint(h, 40);
      if (Game.wallAt(h.x, h.y, h.radius + 8)) {
        for (let t = 0.95; t >= 0.15; t -= 0.05) {
          const nx = ox + dir.x * distBlink * t, ny = oy + dir.y * distBlink * t;
          if (!Game.wallAt(nx, ny, h.radius + 8)) { h.x = nx; h.y = ny; break; }
        }
      }
      Game.fx.ghost(h);
      Game.fx.ring(h.x, h.y, 60, THEME.magic, 0.4);
      Game.fx.flash(h.x, h.y, 50, THEME.magic);
      return true;
    },
  },
  {
    id: 'execute', name: 'Execute', icon: '☄️', cd: 80,
    desc: 'Burn the nearest enemy hero for 12% of their missing health as true damage.',
    cast(h, point) {
      let best = point && point.type === 'hero' && point.team !== h.team && point.alive && dist(h, point) < 520
        ? point : null;
      let bd = best ? dist(h, best) : 520;
      for (const e of Game.heroes) {
        if (e.team === h.team || !e.alive) continue;
        const d = dist(h, e);
        if (!best && d < bd) { bd = d; best = e; }
      }
      if (!best) return false;
      const missing = best.maxHp - best.hp;
      resolveDamage(h, best, { amount: 120 + missing * 0.12, type: 'true' });
      Game.fx.ring(best.x, best.y, 90, THEME.physical, 0.5);
      return true;
    },
  },
  {
    id: 'retribution', name: 'Retribution', icon: '🐾', cd: 35,
    desc: 'Deal 400 (+40 per level) true damage to a nearby monster, Turtle and Lord included. +40% creep rewards, 40% less creep damage. The only objective-steal spell.',
    cast(h, point) {
      let best = point && point.type === 'monster' && point.alive && dist(h, point) < 420
        ? point : null;
      let bd = best ? dist(h, best) : 420;
      for (const m of Game.monsters) {
        if (!m.alive) continue;
        const d = dist(h, m);
        if (!best && d < bd) { bd = d; best = m; }
      }
      if (!best) return false;
      resolveDamage(h, best, { amount: retributionDamage(h), type: 'true' });
      if (typeof Mlbb !== 'undefined') Mlbb.applyRetriEvolve(h, best);
      Game.fx.ring(best.x, best.y, best.radius + 40, THEME.warn, 0.5);
      return true;
    },
  },
  {
    id: 'sprint', name: 'Sprint', icon: '💨', cd: 70,
    desc: 'Gain +40% movement speed for 5s and shed all slows.',
    cast(h) {
      h.cc.t.slow = 0; h.cc.slowPct = 0;
      h.addTimedBuff('speedPct', 0.4, 5);
      Game.fx.ring(h.x, h.y, 80, THEME.hp, 0.5);
      return true;
    },
  },
  {
    id: 'purify', name: 'Purify', icon: '🧼', cd: 90,
    desc: 'Remove all crowd control and become immune to it for 1.2s.',
    cast(h) {
      h.cc.purify(1.2);
      Game.fx.ring(h.x, h.y, 90, THEME.shield, 0.5);
      return true;
    },
  },
  {
    id: 'inspire', name: 'Inspire', icon: '🎯', cd: 75,
    desc: 'Gain +55% attack speed and 12 Armor penetration for 5s.',
    cast(h) {
      h.addTimedBuff('atkSpd', h.attrs.get('atkSpd') * 0.55, 5);
      Game.fx.ring(h.x, h.y, 80, THEME.gold, 0.5);
      return true;
    },
  },
  {
    id: 'petrify', name: 'Petrify', icon: '🗿', cd: 80,
    desc: 'Stun every enemy within 260 units for 0.8s.',
    cast(h) {
      let hit = 0;
      for (const u of Game.enemyUnits(h.team, {})) {
        if (dist(h, u) > 260 + u.radius) continue;
        u.cc.apply('stun', 0.8, u.attrs ? u.attrs.get('tenacity') : 0);
        hit++;
      }
      Game.fx.ring(h.x, h.y, 260, THEME.ccStun, 0.6);
      return hit > 0;
    },
  },
  {
    id: 'aegis', name: 'Aegis', icon: '🛡', cd: 75,
    desc: 'Shield yourself and nearby allies for 15% of your max health.',
    cast(h) {
      for (const a of Game.heroes) {
        if (a.team !== h.team || !a.alive || dist(h, a) > 320) continue;
        a.addShield(h.maxHp * 0.15, 4);
      }
      Game.fx.ring(h.x, h.y, 320, THEME.shield, 0.6);
      return true;
    },
  },
  {
    id: 'vengeance', name: 'Vengeance', icon: '🔁', cd: 90,
    desc: 'For 3s, reflect 30% of the damage you take back at the attacker.',
    cast(h) {
      h.reflectT = 3;
      Game.fx.ring(h.x, h.y, 90, THEME.danger, 0.5);
      return true;
    },
  },
  {
    id: 'flameshot', name: 'Flameshot', icon: '🔥', cd: 85, aimRange: 900,
    desc: 'Fire a long-range magic bolt at the first enemy in a line.',
    cast(h, point) {
      const dir = point ? norm(point.x - h.x, point.y - h.y) : { x: Math.cos(h.facing), y: Math.sin(h.facing) };
      const s = { name: 'Flameshot', icon: '🔥', type: 'skillshot', dmgType: 'magic',
        dmg: 160 + h.level * 8, range: 900, speed: 1100, radius: 28, explodeR: 0 };
      Game.projectiles.push(Projectile.skillshot(h, s, dir));
      Game.fx.ring(h.x, h.y, 50, THEME.warn, 0.35);
      return true;
    },
  },
  {
    id: 'arrival', name: 'Arrival', icon: '🚪', cd: 100,
    desc: 'Channel for 4.6s, then teleport to the nearest allied turret. Damage or moving cancels it.',
    cast(h) {
      return typeof Mlbb !== 'undefined' && Mlbb.startArrival(h);
    },
  },
  {
    id: 'icequake', name: 'Icequake', icon: '❄', cd: 75,
    desc: 'Slam the ground, dealing magic damage and slowing nearby enemies by 40% for 1.5s.',
    cast(h) {
      let hit = 0;
      for (const u of Game.enemyUnits(h.team, { neutral: true })) {
        if (dist(h, u) > 280 + u.radius) continue;
        resolveDamage(h, u, { amount: 140 + h.level * 6, type: 'magic' });
        if (u.cc) u.cc.applySlow(0.4, 1.5, u.attrs ? u.attrs.get('tenacity') : 0);
        hit++;
      }
      Game.fx.ring(h.x, h.y, 280, '#7dd3fc', 0.55);
      return hit > 0;
    },
  },
  {
    id: 'weaken', name: 'Weaken', icon: '⬇', cd: 70,
    desc: 'Shred 18 Armor and Magic Resist from nearby enemies for 4s.',
    cast(h) {
      let hit = 0;
      for (const u of Game.enemyUnits(h.team, {})) {
        if (u.type !== 'hero' || dist(h, u) > 300 + u.radius) continue;
        u.marks = u.marks || {};
        u.marks.weakenUntil = Game.time + 4;
        if (u.recalcStats) u.recalcStats(false);
        hit++;
      }
      Game.fx.ring(h.x, h.y, 300, '#c4b5fd', 0.5);
      return hit > 0;
    },
  },
  {
    id: 'revitalize', name: 'Revitalize', icon: '💚', cd: 85,
    desc: 'Heal yourself and nearby allies for 12% of your max health.',
    cast(h) {
      for (const a of Game.heroes) {
        if (a.team !== h.team || !a.alive || dist(h, a) > 340) continue;
        const amt = a.heal(h.maxHp * 0.12);
        a.stats.healDone = (a.stats.healDone || 0) + amt;
        Game.fx.healFx(a, Math.round(amt));
      }
      Game.fx.ring(h.x, h.y, 340, THEME.hp, 0.55);
      return true;
    },
  },
];
const SPELL_BY_ID = Object.fromEntries(BATTLE_SPELLS.map(s => [s.id, s]));

/* Which spell a bot takes, by role. Junglers need Retribution or the epic
   objectives are uncontestable against a team that has it. */
const BOT_SPELL_BY_ROLE = {
  Tank: 'petrify', Fighter: 'execute', Assassin: 'retribution',
  Marksman: 'inspire', Mage: 'flameshot', Support: 'revitalize',
};

/* ============================================================
   Emblems
   ============================================================
   A flat stat package plus one keystone. Deliberately shallow — the
   depth in this game is meant to live in items and skills, and a
   three-page talent tree would only dilute both. */
const EMBLEMS = [
  { id: 'assassin', name: 'Assassin', icon: '🗡',
    stats: { physAtk: 22, physPen: 12, speed: 15 },
    keystone: { name: 'Killing Spree', desc: 'Hero kills restore 12% of your max health.' } },
  { id: 'mage', name: 'Mage', icon: '🔮',
    stats: { magicPower: 30, cdr: 0.05, manaRegen: 8 },
    keystone: { name: 'Impure Rage', desc: 'Skill damage also burns 1.5% of the target’s max mana.' } },
  { id: 'marksman', name: 'Marksman', icon: '🏹',
    stats: { physAtk: 16, atkSpd: 0.15, lifesteal: 0.08 },
    keystone: { name: 'Weakness Finder', desc: 'Basic attacks slow the target by 15% for 1s.' } },
  { id: 'tank', name: 'Tank', icon: '🛡',
    stats: { maxHp: 450, armor: 18, mr: 18, tenacity: 0.15 },
    keystone: { name: 'Brave Smite', desc: 'Damaging a hero heals you for 1.5% of your max health.' } },
  { id: 'support', name: 'Support', icon: '🌿',
    stats: { cdr: 0.08, speed: 25, hpRegen: 8, maxHp: 200 },
    keystone: { name: 'Focusing Mark', desc: 'Allies deal 6% more damage to heroes you have damaged.' } },
  { id: 'fighter', name: 'Fighter', icon: '🪓',
    stats: { physAtk: 15, maxHp: 350, spellVamp: 0.08, armor: 10 },
    keystone: { name: 'Festival of Blood', desc: 'Skill damage heals you for 6% of the damage dealt.' } },
];
const EMBLEM_BY_ID = Object.fromEntries(EMBLEMS.map(e => [e.id, e]));

/* Sensible default emblem per role, used for bots and as the player's
   pre-selection on the hero-select screen. */
const EMBLEM_BY_ROLE = {
  Assassin: 'assassin', Mage: 'mage', Marksman: 'marksman',
  Tank: 'tank', Support: 'support', Fighter: 'fighter',
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ITEM_DEFS, ITEM_BY_ID, COMPONENTS, ItemAI, BATTLE_SPELLS, EMBLEMS };
}
