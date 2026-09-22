'use strict';

/*
 * Dependency-free Node.js adapter for the browser game.
 *
 * The game is intentionally kept as classic browser scripts. Rather than
 * maintain a second combat implementation, this adapter loads those scripts
 * into an isolated VM, replaces browser-only UI/audio/effects with no-ops,
 * and advances the real Game.update() loop with a seeded RNG.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CORE_SCRIPTS = [
  'js/theme.js',
  'js/data.js',
  'js/map-data.js',
  'js/map.js',
  'js/combat.js',
  'js/bot-params.js',
  'js/ai/rng.js',
  'js/ai/observation.js',
  'js/ai/neural-runtime.js',
  'js/ai/neural-controller.js',
  'js/ai/recorder.js',
  'js/entities.js',
  'js/objectives.js',
  'js/items.js',
];

const MAIN_RENDER_MARKER = '/* ============================================================\n   Rendering';
const STATE_SCHEMA = 'legends-arena.headless-state/v1';
const TEAM_LABELS = ['blue', 'red', 'neutral'];

const BROWSER_STUBS = String.raw`
const CW = 1280, CH = 720;
const __headlessEvents = [];
function __headlessRef(u) {
  if (!u) return null;
  return {
    type: u.type || (u.isStructure ? 'structure' : 'unit'),
    name: u.name || u.kind || u.lane || null,
    team: u.team,
  };
}
function __recordHeadlessEvent(type, data) {
  __headlessEvents.push(Object.assign({
    type,
    timeMs: typeof Game === 'undefined' ? 0 : Math.round(Game.time * 1000),
  }, data || {}));
}
const UI = {
  els: { end: { classList: { add() {}, remove() {} } } },
  pickedEmblem: null,
  pickedSpell: null,
  toggleScoreboard() {},
  toggleShop() {},
  buildMinimapStatic() {},
  setupHUD() {},
  syncObjectiveTimers() {},
  hideTip() {},
  announce(message, kind) {
    __recordHeadlessEvent('announcement', { kind: kind || 'minor', message });
  },
  killFeed(source, target) {
    __recordHeadlessEvent('kill', { source: __headlessRef(source), target: __headlessRef(target) });
  },
  pingFeed(kind, by) {
    __recordHeadlessEvent('ping', { kind, source: __headlessRef(by) });
  },
  showEnd(blueWon) {
    __recordHeadlessEvent('match_end', { winner: blueWon ? 'blue' : 'red' });
  },
};
const SFX = new Proxy({}, { get() { return function () {}; } });
const Input = {
  releaseAim: false,
  attackHeld: false,
  attackMode: 'auto',
  casts: [],
  lockedTarget: null,
  recallQueued: false,
  spellQueued: false,
  targetPriority: 'lowHp',
  isFinePointer() { return false; },
  aimPoint() { return null; },
  moveVector() { return null; },
};
`;

function readScript(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

/* The game's scripts are compiled once into a single function whose body is
   the concatenation of every simulation script, and each simulator instance
   is a fresh call of that function.

   Why not vm.createContext? A contextified sandbox routes every global
   lookup (Math, Infinity, Uint8Array, ...) through Node's property
   interceptors, which defeat V8's inline caches: the same code ran 18-36x
   slower there than in the main realm, and most of the simulation is that
   kind of code. Inside one function the scripts' top-level constants become
   closure variables, and globals are the real ones.

   Isolation is kept where it matters: `Math` is a per-instance shadow object
   (RNG.seed swaps its `random`, so two simulators in one thread never share
   a random stream), and the browser-only globals are parameters. */
let gameFactory = null;
let gameFactorySource = null;
function buildGameFactory() {
  if (gameFactory) return gameFactory;
  const parts = ["'use strict';", BROWSER_STUBS];
  for (const relativePath of CORE_SCRIPTS) {
    parts.push(`/* ==== ${relativePath} ==== */`, readScript(relativePath));
  }
  const mainSource = readScript('js/main.js').split(String.fromCharCode(13)).join('');   // the sources are CRLF on Windows; the marker is LF
  const marker = mainSource.indexOf(MAIN_RENDER_MARKER);
  if (marker < 0) throw new Error('Could not isolate the simulation portion of js/main.js');
  parts.push('/* ==== js/main.js (simulation) ==== */', mainSource.slice(0, marker));
  parts.push(String.raw`
    // All Game.fx methods are presentation-only. Disabling them prevents
    // particle allocations (and visual-only random draws) during long runs.
    for (const key of Object.keys(Game.fx)) Game.fx[key] = function () {};
    Game.updateEffects = function () {};
    return {
      Game,
      HEROES,
      HERO_BY_ID,
      RNG,
      NeuralRuntime,
      defaultBotParams,
      ItemAI,
      ITEM_DEFS,
      BALANCE,
      TEAM_BLUE,
      TEAM_RED,
      TEAM_NEUTRAL,
      WORLD,
      Hero,
      /* Entity classes and helpers, so headless instrumentation (stats,
         environment) can wrap prototypes instead of editing the game. */
      Unit,
      Minion,
      SuperMinion,
      LordMinion,
      Tower,
      Inhibitor,
      Monster,
      BuffMonster,
      EpicMonster,
      Projectile,
      Zone,
      ITEM_BY_ID,
      ITEM_SLOTS,
      BATTLE_SPELLS,
      dist,
      events: __headlessEvents,
      Math,
    };
  `);
  gameFactorySource = parts.join('\n');
  gameFactory = new Function('Math', 'console', 'setTimeout', 'clearTimeout', 'performance', gameFactorySource);
  return gameFactory;
}

function shadowMath() {
  const M = {};
  for (const name of Object.getOwnPropertyNames(Math)) {
    const desc = Object.getOwnPropertyDescriptor(Math, name);
    if ('value' in desc) M[name] = desc.value;
  }
  return M;
}

function loadGameRuntime(onWarning) {
  const factory = buildGameFactory();
  const console = {
    log() {},
    info() {},
    warn: (...args) => onWarning(args.join(' ')),
    error: (...args) => onWarning(args.join(' ')),
  };
  // Timers are visual/UI conveniences in the game. A headless match should
  // never leave background work behind after the deterministic loop exits.
  const setTimeout = () => 0;
  const clearTimeout = () => {};
  const performance = { now: () => 0 };
  return factory(shadowMath(), console, setTimeout, clearTimeout, performance);
}

function numberOption(value, fallback, name, minimum) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < minimum) throw new Error(`${name} must be at least ${minimum}`);
  return n;
}

function integerOption(value, fallback, name, minimum) {
  const n = numberOption(value, fallback, name, minimum);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function round(value, places = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function milliseconds(seconds) {
  return Math.max(0, Math.round((seconds || 0) * 1000));
}

function teamName(team) {
  return TEAM_LABELS[team] || 'unknown';
}

class HeadlessSimulator {
  constructor(options = {}) {
    this.options = {
      seed: integerOption(options.seed, 1, 'seed', 0),
      intervalMs: numberOption(options.intervalMs, 50, 'intervalMs', 1),
      stepMs: numberOption(options.stepMs, 1000 / 60, 'stepMs', 0.1),
      mode: options.mode || 'standard',
      detail: options.detail || 'summary',
      blueBot: options.blueBot || 'heuristic',
      redBot: options.redBot || 'heuristic',
      blueLineup: options.blueLineup || null,
      redLineup: options.redLineup || null,
      neuralModelPath: options.neuralModelPath || path.join(PROJECT_ROOT, 'models/neural-bot-v1/model.json'),
    };
    if (!['standard', 'duel'].includes(this.options.mode)) {
      throw new Error('mode must be "standard" or "duel"');
    }
    if (!['summary', 'full'].includes(this.options.detail)) {
      throw new Error('detail must be "summary" or "full"');
    }
    for (const bot of [this.options.blueBot, this.options.redBot]) {
      if (!['heuristic', 'neural'].includes(bot)) {
        throw new Error('bot controller must be "heuristic" or "neural"');
      }
    }

    this.warnings = [];
    this.runtime = loadGameRuntime(message => this.warnings.push(message));
    this.context = this.runtime;   // alias: the game's globals, as one object
    this.Game = this.runtime.Game;
    this.sequence = 0;
    this.outputTimeMs = 0;
    this._dynamicIds = new WeakMap();
    this._nextDynamicId = 1;
    this._start();
  }

  _resolveLineup(value, label) {
    if (!value) return null;
    const ids = Array.isArray(value) ? value : String(value).split(',');
    if (ids.length > 5) throw new Error(`${label} lineup can contain at most five heroes`);
    return ids.map(raw => {
      const id = String(raw).trim().toLowerCase();
      const hero = this.runtime.HERO_BY_ID[id];
      if (!hero) {
        const valid = this.runtime.HEROES.map(h => h.id).join(', ');
        throw new Error(`Unknown hero "${id}" in ${label} lineup. Valid heroes: ${valid}`);
      }
      return hero;
    });
  }

  _loadNeuralModelIfNeeded() {
    if (this.options.blueBot !== 'neural' && this.options.redBot !== 'neural') return;
    const model = JSON.parse(fs.readFileSync(this.options.neuralModelPath, 'utf8'));
    if (!this.runtime.NeuralRuntime.loadFromObject(model)) {
      throw new Error(`Neural model could not be loaded: ${this.runtime.NeuralRuntime.loadError}`);
    }
  }

  _start() {
    const R = this.runtime;
    const G = this.Game;
    R.RNG.seed(this.options.seed);
    this._loadNeuralModelIfNeeded();
    G.mode = this.options.mode;
    G.botTypes = [this.options.blueBot, this.options.redBot];

    const blue = this._resolveLineup(this.options.blueLineup, 'blue');
    const red = this._resolveLineup(this.options.redLineup, 'red');
    if (this.options.mode === 'standard') {
      G.draft = [blue, red];
      G.start(null);
    } else {
      const blueHero = (blue && blue[0]) || R.HERO_BY_ID.zephyr || R.HEROES[0];
      const redHero = (red && red[0]) || R.HERO_BY_ID.ignis || R.HEROES[1];
      G.draft = [[blueHero], [redHero]];
      G.start(blueHero);

      // Duel start normally reserves blue for a human. Convert it to the same
      // bot path used by every other hero so a headless duel is truly 1v1 AI.
      const player = G.player;
      player.isPlayer = false;
      player.p = R.defaultBotParams();
      player.lane = 'duel';
      player.path = G.lanesFor(R.TEAM_BLUE).duel;
      player.autoSpendSkillPoints();
      G.player = null;
      G.spectate = true;
      for (const hero of G.heroes) hero.botType = G.botTypes[hero.team] || 'heuristic';
    }

    G.heroes.forEach((hero, index) => {
      const teamSlot = G.heroes.slice(0, index).filter(h => h.team === hero.team).length;
      hero.__headlessId = `${teamName(hero.team)}-${teamSlot}`;
    });
  }

  availableHeroes() {
    return this.runtime.HEROES.map(h => ({ id: h.id, name: h.name, role: h.role }));
  }

  _entityRef(unit) {
    if (!unit) return null;
    if (unit.__headlessId) return unit.__headlessId;
    let id = this._dynamicIds.get(unit);
    if (!id) {
      id = `${unit.type || unit.kind || 'unit'}-${this._nextDynamicId++}`;
      this._dynamicIds.set(unit, id);
    }
    return id;
  }

  _resource(current, maximum) {
    return {
      current: round(current),
      max: round(maximum),
      pct: maximum > 0 ? round(current / maximum, 3) : 0,
    };
  }

  _heroState(hero) {
    const skillDefs = hero.def0.skills || [];
    const buffs = {};
    for (const [key, value] of Object.entries(hero.buffs || {})) {
      if (value && value.t > 0) buffs[key] = { value: round(value.value, 3), remainingMs: milliseconds(value.t) };
    }
    const runes = {};
    for (const [key, value] of Object.entries(hero.runes || {})) {
      if (value > 0) runes[key] = milliseconds(value);
    }
    return {
      id: hero.__headlessId,
      heroId: hero.def0.id,
      name: hero.name,
      role: hero.def0.role,
      team: teamName(hero.team),
      lane: hero.lane,
      alive: !!hero.alive,
      respawnMs: milliseconds(hero.respawnT),
      position: { x: round(hero.x), y: round(hero.y) },
      velocity: { x: round(hero.vx), y: round(hero.vy) },
      facingRad: round(hero.facing, 3),
      hp: this._resource(hero.hp, hero.maxHp),
      shield: round(hero.shieldTotal || 0),
      mana: this._resource(hero.mana, hero.maxMana),
      level: hero.level,
      xp: round(hero.xp),
      gold: { held: round(hero.gold), earned: round(hero.goldEarned) },
      kda: { kills: hero.kills, deaths: hero.deaths, assists: hero.assists },
      ai: {
        controller: hero.botType,
        state: hero.aiState,
        target: this._entityRef(hero.aiTarget),
      },
      cooldownsMs: {
        attack: milliseconds(hero.atkCd),
        skills: hero.skillCd.map(milliseconds),
        spell: milliseconds(hero.spellCd),
      },
      skills: skillDefs.map((skill, index) => ({
        id: skill.id || `skill-${index + 1}`,
        name: skill.name,
        rank: hero.skillRank[index],
      })),
      crowdControl: hero.cc.list.map(type => ({ type, remainingMs: milliseconds(hero.cc.t[type]) })),
      items: hero.items.map(item => item.id),
      spell: hero.spell ? hero.spell.id : null,
      emblem: hero.emblem ? hero.emblem.id : null,
      buffs,
      runes,
    };
  }

  _structureStates() {
    const G = this.Game;
    const structures = [];
    G.bases.forEach((unit, index) => structures.push({ id: `base-${teamName(unit.team)}-${index}`, kind: 'base', unit }));
    G.towers.forEach((unit, index) => structures.push({ id: `tower-${index}`, kind: 'tower', unit }));
    G.inhibitors.forEach((unit, index) => structures.push({ id: `inhibitor-${index}`, kind: 'inhibitor', unit }));
    return structures.map(({ id, kind, unit }) => ({
      id,
      kind,
      team: teamName(unit.team),
      lane: unit.lane || null,
      alive: !!unit.alive,
      position: { x: round(unit.x), y: round(unit.y) },
      hp: this._resource(unit.hp, unit.maxHp),
      respawnMs: milliseconds(unit.respawnT),
      shieldedByOuter: !!unit.shieldedByOuter,
    }));
  }

  _monsterStates() {
    return this.Game.monsters.map(monster => ({
      id: this._entityRef(monster),
      kind: monster.epic || monster.kind || 'jungle',
      name: monster.name || (monster.buff && monster.buff.name) || 'Jungle Monster',
      alive: !!monster.alive,
      position: { x: round(monster.x), y: round(monster.y) },
      hp: this._resource(monster.hp, monster.maxHp),
      target: this._entityRef(monster.target),
    }));
  }

  _minionSummary() {
    const groups = new Map();
    for (const minion of this.Game.minions) {
      const key = `${teamName(minion.team)}:${minion.lane}:${minion.kind || 'normal'}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return [...groups.entries()].map(([key, count]) => {
      const [team, lane, kind] = key.split(':');
      return { team, lane, kind, count };
    });
  }

  _fullMinionStates() {
    return this.Game.minions.map(minion => ({
      id: this._entityRef(minion),
      team: teamName(minion.team),
      lane: minion.lane,
      kind: minion.kind || 'normal',
      position: { x: round(minion.x), y: round(minion.y) },
      hp: this._resource(minion.hp, minion.maxHp),
      target: this._entityRef(minion.target),
    }));
  }

  _objectiveStates() {
    return this.Game.objectiveState().map(objective => ({
      id: objective.key,
      name: objective.label,
      available: !!objective.up,
      spawnInMs: objective.up ? 0 : milliseconds(objective.in),
    }));
  }

  _teamState(team) {
    const G = this.Game;
    const base = G.bases[team];
    return {
      kills: G.kills[team],
      goldEarned: round(G.teamGold(team)),
      heroesAlive: G.heroes.filter(h => h.team === team && h.alive).length,
      towersAlive: G.towers.filter(t => t.team === team && t.alive).length,
      inhibitorsAlive: G.inhibitors.filter(i => i.team === team && i.alive).length,
      baseHp: base ? this._resource(base.hp, base.maxHp) : null,
    };
  }

  _drainEvents() {
    const events = this.runtime.events.splice(0);
    return events.map(event => {
      const out = { ...event };
      if (out.source && typeof out.source.team === 'number') out.source.team = teamName(out.source.team);
      if (out.target && typeof out.target.team === 'number') out.target.team = teamName(out.target.team);
      return out;
    });
  }

  snapshot() {
    const G = this.Game;
    const snapshot = {
      schema: STATE_SCHEMA,
      type: 'state',
      sequence: this.sequence++,
      timeMs: Math.round(G.time * 1000),
      gameState: G.state,
      mode: G.mode,
      winner: G.lastWinner === null || G.lastWinner === undefined ? null : teamName(G.lastWinner),
      teams: {
        blue: this._teamState(this.runtime.TEAM_BLUE),
        red: this._teamState(this.runtime.TEAM_RED),
      },
      entityCounts: {
        heroes: G.heroes.length,
        heroesAlive: G.heroes.filter(h => h.alive).length,
        minions: G.minions.length,
        monsters: G.monsters.length,
        structures: G.structures().length,
        structuresAlive: G.structures().filter(s => s.alive).length,
        projectiles: G.projectiles.length,
        zones: G.zones.length,
      },
      objectives: this._objectiveStates(),
      heroes: G.heroes.map(hero => this._heroState(hero)),
      structures: this._structureStates(),
      monsters: this._monsterStates(),
      minionGroups: this._minionSummary(),
      events: this._drainEvents(),
    };

    if (this.options.detail === 'full') {
      snapshot.minions = this._fullMinionStates();
      snapshot.projectiles = G.projectiles.map(projectile => ({
        id: this._entityRef(projectile),
        kind: projectile.kind,
        team: teamName(projectile.team),
        position: { x: round(projectile.x), y: round(projectile.y) },
        source: this._entityRef(projectile.src),
        target: this._entityRef(projectile.target),
      }));
      snapshot.zones = G.zones.map(zone => ({
        id: this._entityRef(zone),
        team: teamName(zone.team),
        position: { x: round(zone.x), y: round(zone.y) },
        radius: round(zone.radius),
        delayMs: milliseconds(zone.delay),
        ticksRemaining: zone.ticks,
        owner: this._entityRef(zone.owner),
      }));
    }
    // VM-owned arrays have a different prototype than Node-owned arrays.
    // State frames are a JSON contract, so normalize the whole tree before
    // returning it to callers (and prove that every exposed field serializes).
    return JSON.parse(JSON.stringify(snapshot));
  }

  step(intervalMs = this.options.intervalMs) {
    intervalMs = numberOption(intervalMs, this.options.intervalMs, 'intervalMs', 0);
    if (this.Game.state !== 'play') return this.snapshot();
    let remaining = intervalMs;
    while (remaining > 1e-9 && this.Game.state === 'play') {
      const dtMs = Math.min(this.options.stepMs, remaining);
      this.Game.update(dtMs / 1000);
      remaining -= dtMs;
    }
    this.outputTimeMs += intervalMs - remaining;
    return this.snapshot();
  }

  run({ durationMs = 1000, untilEnd = false, onSnapshot } = {}) {
    if (!untilEnd) durationMs = numberOption(durationMs, 1000, 'durationMs', 0);
    const snapshots = [];
    const emit = snapshot => {
      if (onSnapshot) onSnapshot(snapshot);
      else snapshots.push(snapshot);
    };
    emit(this.snapshot());
    while (this.Game.state === 'play' && (untilEnd || this.outputTimeMs + 1e-9 < durationMs)) {
      const interval = untilEnd
        ? this.options.intervalMs
        : Math.min(this.options.intervalMs, durationMs - this.outputTimeMs);
      emit(this.step(interval));
    }
    return {
      snapshots,
      reason: this.Game.state === 'end' ? 'match-ended' : 'duration-reached',
      finalTimeMs: Math.round(this.Game.time * 1000),
      winner: this.Game.lastWinner === null || this.Game.lastWinner === undefined
        ? null : teamName(this.Game.lastWinner),
    };
  }
}

module.exports = {
  HeadlessSimulator,
  STATE_SCHEMA,
  createSimulator: options => new HeadlessSimulator(options),
  /* The assembled source of the game function, for mapping profiler line
     numbers back to code (new Function puts the body on line 3). */
  assembledSource: () => { buildGameFactory(); return gameFactorySource; },
};
