'use strict';

/*
 * Reinforcement-learning style environment over the headless simulator.
 *
 *   const { Env } = require('./headless/env');
 *   const env = new Env({ controlled: 'blue' });       // all five blue heroes
 *   let obs = env.reset(1);
 *   while (true) {
 *     const actions = {};
 *     for (const id of env.controlledIds) actions[id] = { move: { dx: 1, dy: 0 } };
 *     const { obs: next, reward, done, info } = env.step(actions, 100);
 *     if (done) break;
 *     obs = next;
 *   }
 *
 * Controlled heroes have their heuristic brain switched off (per instance:
 * botThink/botControl are replaced, opportunity attacks and auto-shopping are
 * disabled) and follow the actions given to step(). Every other hero keeps
 * the normal heuristic bot. Nothing in js/ is modified.
 */

const { createSimulator } = require('./runtime');

const ROLES = ['Marksman', 'Mage', 'Tank', 'Assassin', 'Fighter', 'Support'];
const NORM = { world: 6400, speed: 1000, level: 15, gold: 10000, cooldown: 60, respawn: 60, spawnIn: 300, kills: 50, teamGold: 50000 };
const SLOTS = { allies: 4, enemies: 5, minions: 8, monsters: 4, structures: 26, objectives: 2 };
const NEAR_RADIUS = 1500;   // minions/monsters considered "nearby"

/* ---------------- flat observation layout ----------------
   Built once; every field has a name, an offset and a description so the
   encoding is documented by the code that produces it (see Env.layout). */
function buildLayout() {
  const fields = [];
  let offset = 0;
  const add = (name, doc) => { fields.push({ name, offset: offset++, doc }); };
  const group = (prefix, count, members) => {
    for (let i = 0; i < count; i++) for (const [name, doc] of members) add(`${prefix}[${i}].${name}`, doc);
  };
  add('time', 'game time / 1800 s');
  add('team', '0 = blue, 1 = red');
  add('team.kills', 'own team kills / 50');
  add('team.enemyKills', 'enemy team kills / 50');
  add('team.gold', 'own team gold earned / 50000');
  add('team.enemyGold', 'enemy team gold earned / 50000');
  add('team.towers', 'own towers alive / 9');
  add('team.enemyTowers', 'enemy towers alive / 9');
  add('objective.lordUp', 'Lord available (0/1)');
  add('objective.turtleUp', 'Turtle available (0/1)');
  const self = [
    ['x', 'x / 6400'], ['y', 'y / 6400'], ['vx', 'velocity x / 1000'], ['vy', 'velocity y / 1000'],
    ['alive', '0/1'], ['hp', 'hp fraction'], ['mana', 'mana fraction'], ['level', 'level / 15'],
    ['xp', 'progress to next level (0..1)'], ['goldHeld', 'gold held / 10000'], ['goldEarned', 'gold earned / 10000'],
    ['respawn', 'respawn timer s / 60'], ['attackCd', 'basic attack cooldown s / 60'],
    ['skillCd1', 'skill 1 cooldown s / 60 (also 1 when not learned)'], ['skillCd2', 'skill 2 cooldown s / 60'], ['skillCd3', 'ultimate cooldown s / 60'],
    ['spellCd', 'battle spell cooldown s / 60'], ['items', 'item slots used / 6'], ['recalling', '0/1'],
    ['inBush', '0/1'], ['disabled', '1 when crowd control prevents acting'],
  ];
  for (const [name, doc] of self) add(`self.${name}`, doc);
  group('ally', SLOTS.allies, [
    ['present', '1 when the slot holds a hero'], ['dx', '(ally.x - self.x) / 6400'], ['dy', '(ally.y - self.y) / 6400'],
    ['dist', 'distance / 6400'], ['hp', 'hp fraction'], ['alive', '0/1'], ['level', 'level / 15'], ['role', 'role index / 5 (Marksman, Mage, Tank, Assassin, Fighter, Support)'],
  ]);
  group('enemy', SLOTS.enemies, [
    ['known', '1 when visible to own team or dead (scoreboard)'], ['dx', '(enemy.x - self.x) / 6400, 0 when unknown'], ['dy', '(enemy.y - self.y) / 6400, 0 when unknown'],
    ['dist', 'distance / 6400, 0 when unknown'], ['hp', 'hp fraction when known'], ['alive', '0/1'], ['level', 'level / 15'], ['role', 'role index / 5'],
  ]);
  group('minion', SLOTS.minions, [
    ['present', '1 when the slot holds a minion (nearest first, within 1500)'], ['dx', '/ 6400'], ['dy', '/ 6400'], ['dist', '/ 6400'], ['hp', 'hp fraction'], ['ally', '1 own team, 0 enemy'],
  ]);
  group('monster', SLOTS.monsters, [
    ['present', '1 when the slot holds a visible monster (nearest first, within 1500)'], ['dx', '/ 6400'], ['dy', '/ 6400'], ['dist', '/ 6400'], ['hp', 'hp fraction'], ['epic', '1 for Turtle/Lord'],
  ]);
  group('structure', SLOTS.structures, [
    ['alive', '0/1 (fixed order: base-blue, base-red, 18 towers, 6 inhibitors as in the state snapshot)'], ['hp', 'hp fraction'], ['dx', '/ 6400'], ['dy', '/ 6400'], ['ally', '1 own team'],
  ]);
  group('objective', SLOTS.objectives, [['available', '0/1 (lord, turtle)'], ['spawnIn', 'seconds until spawn / 300']]);
  return { fields, length: offset };
}
const LAYOUT = buildLayout();

const clamp01 = value => value < 0 ? 0 : value > 1 ? 1 : value;
const roleIndex = role => Math.max(0, ROLES.indexOf(role)) / (ROLES.length - 1);

/* Default reward per controlled hero per step:
     gold earned delta / 100
   + kills delta
   - deaths delta
   + damage dealt to structures delta / 1000
   Replace with options.reward(ctx) -> number; ctx = { hero, prev, cur, done, winner, env }. */
function defaultReward({ prev, cur }) {
  return (cur.goldEarned - prev.goldEarned) / 100
    + (cur.kills - prev.kills)
    - (cur.deaths - prev.deaths)
    + (cur.structureDamage - prev.structureDamage) / 1000;
}

class Env {
  constructor(options = {}) {
    this.options = {
      controlled: options.controlled || 'blue',   // 'blue' | 'red' | ['blue-0', 'red-3', ...]
      mode: 'standard',
      blueLineup: options.blueLineup || null,
      redLineup: options.redLineup || null,
      blueBot: options.blueBot || 'heuristic',
      redBot: options.redBot || 'heuristic',
      stepMs: options.stepMs || 1000 / 60,
      autoAttack: !!options.autoAttack,   // keep the bot's opportunity attacks for controlled heroes
      autoShop: !!options.autoShop,       // keep ItemAI shopping for controlled heroes
      maxTimeMs: options.maxTimeMs || null,
      reward: options.reward || defaultReward,
      stats: options.stats !== false,
    };
    if (options.mode && options.mode !== 'standard') throw new Error('Env supports mode "standard" only');
    this.sim = null;
    this.controlledIds = [];
    this.layout = LAYOUT;
    this.flatLength = LAYOUT.length;
  }

  /* ---------------- lifecycle ---------------- */

  reset(seed = 1) {
    this.sim = createSimulator({
      seed,
      mode: 'standard',
      stepMs: this.options.stepMs,
      intervalMs: 50,
      blueLineup: this.options.blueLineup,
      redLineup: this.options.redLineup,
      blueBot: this.options.blueBot,
      redBot: this.options.redBot,
      stats: this.options.stats,
    });
    this.G = this.sim.Game;
    this.R = this.sim.runtime;
    this.controlled = new Map();   // heroId -> { hero, intent, counters }
    const wanted = this.options.controlled;
    for (const hero of this.G.heroes) {
      const id = hero.__headlessId;
      const take = Array.isArray(wanted) ? wanted.includes(id) : hero.team === (wanted === 'red' ? 1 : 0);
      if (take) this._takeControl(hero);
    }
    this.controlledIds = [...this.controlled.keys()];
    this.stepCount = 0;
    this._structures = [...this.G.bases, ...this.G.towers, ...this.G.inhibitors];
    this._structureIds = this.sim._structureStates().map(s => s.id);
    return this.observe();
  }

  _takeControl(hero) {
    const env = this;
    const record = { hero, intent: { move: null, attack: null }, counters: this._counters(hero) };
    this.controlled.set(hero.__headlessId, record);
    hero.botThink = function () {};
    hero.botControl = function (dt) { env._control(record, dt); };
    hero.attackOnMove = this.options.autoAttack;
    if (!this.options.autoShop) hero.shopT = Number.POSITIVE_INFINITY;
  }

  _counters(hero) {
    return {
      goldEarned: hero.goldEarned, kills: hero.kills, deaths: hero.deaths, assists: hero.assists,
      structureDamage: hero.stats.dmgStruct, heroDamage: hero.stats.dmgHero, damageTaken: hero.stats.dmgTaken,
      level: hero.level,
    };
  }

  /* Per-frame control for a controlled hero, called by the game where the
     heuristic bot would move. Only runs while alive, not disabled, not dashing
     and not recalling, exactly like the bot. */
  _control(record, dt) {
    const hero = record.hero;
    const { move, attack } = record.intent;
    const target = attack && attack.alive && this.G.canSee(hero.team, attack) ? attack : null;
    if (move) {
      hero.moveToward(hero.x + move.dx * 200, hero.y + move.dy * 200, dt);
      if (target && hero.inAttackRange(target)) hero.tryAttack(target);
      return;
    }
    if (target) {
      if (hero.inAttackRange(target)) hero.tryAttack(target);
      else hero.moveToward(target.x, target.y, dt);
    }
  }

  /* ---------------- actions ---------------- */

  _entityById(id) {
    if (!id) return null;
    for (const hero of this.G.heroes) if (hero.__headlessId === id) return hero;
    const structureIndex = this._structureIds.indexOf(id);
    if (structureIndex >= 0) return this._structures[structureIndex];
    for (const unit of this.G.minions) if (this.sim._entityRef(unit) === id) return unit;
    for (const unit of this.G.monsters) if (this.sim._entityRef(unit) === id) return unit;
    return null;
  }

  _applyAction(record, action) {
    const hero = record.hero;
    const result = {};
    const intent = record.intent;
    intent.move = null;
    intent.attack = null;
    if (!action) return result;
    if (action.move && (action.move.dx || action.move.dy)) {
      const length = Math.hypot(action.move.dx, action.move.dy);
      intent.move = { dx: action.move.dx / length, dy: action.move.dy / length };
    }
    if (action.attack) {
      const unit = this._entityById(action.attack);
      intent.attack = unit && unit.team !== hero.team ? unit : null;
      result.attack = intent.attack ? 'ok' : 'invalid-target';
    }
    if (action.cast) {
      const index = action.cast.skill | 0;
      const skill = hero.skills[index];
      if (!skill) result.cast = 'invalid-skill';
      else {
        let point = null;
        if (action.cast.point) point = { x: action.cast.point.x, y: action.cast.point.y };
        else if (action.cast.target) {
          const unit = this._entityById(action.cast.target);
          point = unit ? { x: unit.x, y: unit.y } : null;
        }
        if (!point && skill.type !== 'heal' && skill.type !== 'buff') point = this.G.autoAimPoint(hero, skill);
        result.cast = hero.castSkill(index, point) ? 'ok' : 'not-ready';
      }
    }
    if (action.spell) {
      const point = action.spell.point ? { x: action.spell.point.x, y: action.spell.point.y }
        : this.G.autoAimPoint(hero, { range: (hero.spell && hero.spell.aimRange) || 420 });
      result.spell = hero.castSpell(point) ? 'ok' : 'not-ready';
    }
    if (action.recall) {
      hero.startRecall();
      result.recall = hero.recallT > 0 ? 'ok' : 'not-possible';
    }
    if (action.buy) {
      const def = this.R.ITEM_BY_ID[action.buy];
      if (!def) result.buy = 'unknown-item';
      else if (hero.alive && !hero.atShop()) result.buy = 'not-at-shop';
      else result.buy = hero.buyItem(def) ? 'ok' : 'cannot-buy';
    }
    return result;
  }

  step(actionsByHeroId = {}, dtMs = 50) {
    if (!this.sim) throw new Error('call reset(seed) first');
    const info = { actions: {}, timeMs: 0, winner: null };
    for (const [id, record] of this.controlled) {
      const result = this._applyAction(record, actionsByHeroId[id]);
      if (Object.keys(result).length) info.actions[id] = result;
    }
    this.sim.step(dtMs);
    this.stepCount++;
    const timeMs = Math.round(this.G.time * 1000);
    const capped = this.options.maxTimeMs !== null && timeMs >= this.options.maxTimeMs;
    const done = this.G.state !== 'play' || capped;
    const winner = this.G.lastWinner === null || this.G.lastWinner === undefined ? null : ['blue', 'red'][this.G.lastWinner];
    const obs = this.observe();
    const reward = {};
    for (const [id, record] of this.controlled) {
      const cur = this._counters(record.hero);
      reward[id] = this.options.reward({ hero: obs.heroes[id], prev: record.counters, cur, done, winner, env: this });
      record.counters = cur;
    }
    info.timeMs = timeMs;
    info.winner = winner;
    info.reason = capped ? 'time-cap' : this.G.state !== 'play' ? 'match-ended' : null;
    return { obs, reward, done, info };
  }

  stats() { return this.sim ? this.sim.stats() : null; }
  snapshot() { return this.sim.snapshot(); }

  /* ---------------- observation ---------------- */

  observe() {
    const G = this.G;
    const heroes = {};
    for (const [id, record] of this.controlled) heroes[id] = this._heroObservation(record.hero);
    return {
      timeMs: Math.round(G.time * 1000),
      gameState: G.state,
      heroes,
    };
  }

  _unitView(unit, from) {
    return {
      id: this.sim._entityRef(unit),
      type: unit.type,
      team: ['blue', 'red', 'neutral'][unit.team],
      x: unit.x, y: unit.y,
      hp: unit.hp, maxHp: unit.maxHp,
      alive: !!unit.alive,
      dist: Math.hypot(unit.x - from.x, unit.y - from.y),
    };
  }

  _heroObservation(hero) {
    const G = this.G, R = this.R;
    const team = hero.team;
    const enemyTeam = 1 - team;
    const flat = new Float32Array(LAYOUT.length);
    let i = 0;
    const put = value => { flat[i++] = Number.isFinite(value) ? value : 0; };

    // globals
    put(clamp01(G.time / 1800));
    put(team);
    put(G.kills[team] / NORM.kills);
    put(G.kills[enemyTeam] / NORM.kills);
    put(G.teamGold(team) / NORM.teamGold);
    put(G.teamGold(enemyTeam) / NORM.teamGold);
    put(G.towers.filter(t => t.team === team && t.alive).length / 9);
    put(G.towers.filter(t => t.team === enemyTeam && t.alive).length / 9);
    const objectives = G.objectiveState();
    const lord = objectives.find(o => o.key === 'lord'), turtle = objectives.find(o => o.key === 'turtle');
    put(lord && lord.up ? 1 : 0);
    put(turtle && turtle.up ? 1 : 0);

    // self
    const xpNeed = R.BALANCE.xpNeed(hero.level);
    put(hero.x / NORM.world); put(hero.y / NORM.world);
    put(hero.vx / NORM.speed); put(hero.vy / NORM.speed);
    put(hero.alive ? 1 : 0);
    put(hero.maxHp > 0 ? hero.hp / hero.maxHp : 0);
    put(hero.maxMana > 0 ? hero.mana / hero.maxMana : 0);
    put(hero.level / NORM.level);
    put(xpNeed > 0 ? clamp01(hero.xp / xpNeed) : 1);
    put(hero.gold / NORM.gold); put(hero.goldEarned / NORM.gold);
    put(Math.max(0, hero.respawnT) / NORM.respawn);
    put(Math.max(0, hero.atkCd) / NORM.cooldown);
    for (let s = 0; s < 3; s++) put(hero.skillRank[s] < 1 ? 1 : Math.max(0, hero.skillCd[s]) / NORM.cooldown);
    put(Math.max(0, hero.spellCd) / NORM.cooldown);
    put(hero.items.length / R.ITEM_SLOTS);
    put(hero.recallT > 0 ? 1 : 0);
    put(hero.bush >= 0 ? 1 : 0);
    put(hero.alive && !hero.cc.canAct ? 1 : 0);

    const rel = unit => [(unit.x - hero.x) / NORM.world, (unit.y - hero.y) / NORM.world, Math.hypot(unit.x - hero.x, unit.y - hero.y) / NORM.world];

    // allies
    const allies = G.heroes.filter(h => h.team === team && h !== hero);
    for (let slot = 0; slot < SLOTS.allies; slot++) {
      const ally = allies[slot];
      if (!ally) { i += 8; continue; }
      put(1); rel(ally).forEach(put); put(ally.hp / ally.maxHp); put(ally.alive ? 1 : 0); put(ally.level / NORM.level); put(roleIndex(ally.def0.role));
    }
    // enemies
    const enemies = G.heroes.filter(h => h.team === enemyTeam);
    const visibleEnemies = [];
    for (let slot = 0; slot < SLOTS.enemies; slot++) {
      const enemy = enemies[slot];
      if (!enemy) { i += 8; continue; }
      const visible = enemy.alive && G.canSee(team, enemy);
      const known = visible || !enemy.alive;
      if (visible) visibleEnemies.push(enemy);
      put(known ? 1 : 0);
      if (visible) rel(enemy).forEach(put); else { put(0); put(0); put(0); }
      put(known ? enemy.hp / enemy.maxHp : 0);
      put(enemy.alive ? 1 : 0);
      put(enemy.level / NORM.level);
      put(roleIndex(enemy.def0.role));
    }
    // nearby minions and monsters, nearest first
    const near = list => list
      .filter(u => u.alive && Math.hypot(u.x - hero.x, u.y - hero.y) <= NEAR_RADIUS && G.canSee(team, u))
      .map(u => ({ u, d: Math.hypot(u.x - hero.x, u.y - hero.y) }))
      .sort((a, b) => a.d - b.d || a.u.x - b.u.x || a.u.y - b.u.y)
      .map(e => e.u);
    const minions = near(G.minions);
    for (let slot = 0; slot < SLOTS.minions; slot++) {
      const unit = minions[slot];
      if (!unit) { i += 6; continue; }
      put(1); rel(unit).forEach(put); put(unit.hp / unit.maxHp); put(unit.team === team ? 1 : 0);
    }
    const monsters = near(G.monsters);
    for (let slot = 0; slot < SLOTS.monsters; slot++) {
      const unit = monsters[slot];
      if (!unit) { i += 6; continue; }
      put(1); rel(unit).forEach(put); put(unit.hp / unit.maxHp); put(unit.epic ? 1 : 0);
    }
    // structures, fixed order
    for (let slot = 0; slot < SLOTS.structures; slot++) {
      const unit = this._structures[slot];
      if (!unit) { i += 5; continue; }
      put(unit.alive ? 1 : 0); put(unit.maxHp > 0 ? unit.hp / unit.maxHp : 0);
      const [dx, dy] = rel(unit); put(dx); put(dy);
      put(unit.team === team ? 1 : 0);
    }
    // objectives
    for (const objective of [lord, turtle]) {
      if (!objective) { i += 2; continue; }
      put(objective.up ? 1 : 0); put(objective.up ? 0 : Math.max(0, objective.in) / NORM.spawnIn);
    }
    if (i !== LAYOUT.length) throw new Error(`flat observation wrote ${i} of ${LAYOUT.length} fields`);

    const view = this.sim._heroState(hero);
    return {
      self: view,
      allies: allies.map(a => this.sim._heroState(a)),
      visibleEnemies: visibleEnemies.map(e => this.sim._heroState(e)),
      minions: minions.slice(0, SLOTS.minions).map(u => ({ ...this._unitView(u, hero), lane: u.lane, kind: u.kind || 'normal' })),
      monsters: monsters.slice(0, SLOTS.monsters).map(u => ({ ...this._unitView(u, hero), epic: u.epic || null, name: u.name || null })),
      structures: this.sim._structureStates(),
      objectives: this.sim._objectiveStates(),
      teams: { own: this.sim._teamState(team), enemy: this.sim._teamState(enemyTeam) },
      timeMs: Math.round(G.time * 1000),
      flat,
    };
  }
}

module.exports = { Env, LAYOUT, defaultReward, ROLES, SLOTS };
