'use strict';

/*
 * Match statistics for the headless simulator.
 *
 * Everything here is collected from the outside: entity prototypes are
 * wrapped (onDamaged, die, castSkill, castSpell, buyItem) and Game.update is
 * wrapped so every simulation frame is sampled. No game code is modified and
 * no random draws are added, so an instrumented match is bit-identical to an
 * uninstrumented one.
 *
 *   const sim = createSimulator({ seed: 1 });   // stats attach by default
 *   sim.run({ untilEnd: true });
 *   const report = sim.stats();                  // plain JSON, see report()
 */

const TEAM_LABELS = ['blue', 'red', 'neutral'];
const teamName = team => TEAM_LABELS[team] || 'unknown';
const ms = seconds => Math.max(0, Math.round((seconds || 0) * 1000));
const r1 = value => Math.round(value * 10) / 10;

/* A single-frame move longer than this is a teleport (respawn, recall,
   blink), not distance travelled on foot. */
const TELEPORT_DISTANCE = 400;

class MatchStats {
  constructor(simulator, options = {}) {
    this.sim = simulator;
    this.G = simulator.Game;
    this.R = simulator.runtime;
    this.sampleEveryMs = options.sampleEveryMs || 30000;
    this.heroes = new Map();      // Hero -> record
    this.structureIds = new Map();
    this.teams = { blue: this._teamRecord(), red: this._teamRecord() };
    this.killTimeline = [];
    this.firstBloodMs = null;
    this.nextSampleMs = 0;
    this._damageDepth = 0;
    this._attach();
  }

  _teamRecord() {
    return {
      kills: 0,
      structuresDestroyed: [],      // [{timeMs, id, kind, lane, by}]  enemy structures this team took
      epicKills: [],                // [{timeMs, kind, name, by}]
      goldTimeline: [],             // [{timeMs, gold}]
      xpTimeline: [],               // [{timeMs, xp}]  sum of hero xp-to-date (levels folded in)
    };
  }

  _heroRecord(hero) {
    const skills = (hero.def0.skills || []).map((skill, index) => skill.id || `skill-${index + 1}`);
    return {
      id: hero.__headlessId,
      heroId: hero.def0.id,
      name: hero.name,
      team: teamName(hero.team),
      role: hero.def0.role,
      lane: hero.lane,
      kills: 0, deaths: 0, assists: 0,
      damage: { heroes: 0, structures: 0, minions: 0, monsters: 0, total: 0 },
      damageTaken: 0,
      healingDone: 0,
      goldEarned: 0,
      xp: 0,
      level: 1,
      levelTimeline: [],            // [{timeMs, level, xp, goldEarned}]
      timeDeadMs: 0,
      distanceTravelled: 0,
      timeInBushMs: 0,
      skills: (hero.def0.skills || []).map((skill, index) => ({ id: skills[index], name: skill.name })),
      skillCasts: Object.fromEntries(skills.map(id => [id, 0])),
      spellCasts: 0,
      itemsBought: [],
      _lastX: hero.x, _lastY: hero.y,
      _skillIds: skills,
    };
  }

  _attach() {
    const G = this.G, R = this.R;
    for (const hero of G.heroes) this.heroes.set(hero, this._heroRecord(hero));
    G.bases.forEach((unit, index) => this.structureIds.set(unit, `base-${teamName(unit.team)}-${index}`));
    G.towers.forEach((unit, index) => this.structureIds.set(unit, `tower-${index}`));
    G.inhibitors.forEach((unit, index) => this.structureIds.set(unit, `inhibitor-${index}`));

    const stats = this;
    const Hero = R.Hero;

    /* Damage: every resolveDamage() ends in target.onDamaged(src, dmg).
       Subclasses may call super.onDamaged, so a depth counter makes sure a
       single hit is counted once. */
    for (const Cls of [R.Unit, R.Hero, R.Tower, R.Monster, R.EpicMonster, R.Inhibitor, R.Minion]) {
      if (!Cls || !Object.prototype.hasOwnProperty.call(Cls.prototype, 'onDamaged')) continue;
      const original = Cls.prototype.onDamaged;
      Cls.prototype.onDamaged = function (src, dmg, packet) {
        if (stats._damageDepth === 0) stats._recordDamage(src, this, dmg);
        stats._damageDepth++;
        try { return original.call(this, src, dmg, packet); } finally { stats._damageDepth--; }
      };
    }

    const wrap = (Cls, method, before) => {
      const original = Cls.prototype[method];
      Cls.prototype[method] = function (...args) {
        before(this, args);
        return original.apply(this, args);
      };
    };
    const wrapResult = (Cls, method, after) => {
      const original = Cls.prototype[method];
      Cls.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        after(this, args, result);
        return result;
      };
    };

    wrap(Hero, 'die', (hero, [src]) => stats._recordHeroDeath(hero, src));
    wrap(R.Tower, 'die', (unit, [src]) => stats._recordStructure(unit, src));
    wrap(R.Inhibitor, 'die', (unit, [src]) => stats._recordStructure(unit, src));
    wrap(R.EpicMonster, 'die', (unit, [src]) => stats._recordEpic(unit, src));
    wrapResult(Hero, 'castSkill', (hero, [index], ok) => {
      const rec = stats.heroes.get(hero);
      if (ok && rec) rec.skillCasts[rec._skillIds[index]] = (rec.skillCasts[rec._skillIds[index]] || 0) + 1;
    });
    wrapResult(Hero, 'castSpell', (hero, args, ok) => {
      const rec = stats.heroes.get(hero);
      if (ok && rec) rec.spellCasts++;
    });
    wrapResult(Hero, 'buyItem', (hero, [def], ok) => {
      const rec = stats.heroes.get(hero);
      if (ok && rec) rec.itemsBought.push({ timeMs: ms(G.time), id: def.id });
    });

    const update = G.update;
    G.update = function (dt) {
      update.call(this, dt);
      stats._frame(dt);
    };
    this._sample();
  }

  _recordDamage(src, target, dmg) {
    if (!(dmg > 0)) return;
    const R = this.R;
    if (target instanceof R.Hero) {
      const rec = this.heroes.get(target);
      if (rec) rec.damageTaken += dmg;
    }
    if (!(src instanceof R.Hero) || src === target) return;
    const rec = this.heroes.get(src);
    if (!rec) return;
    if (target.type === 'hero') rec.damage.heroes += dmg;
    else if (target.isStructure) rec.damage.structures += dmg;
    else if (target.type === 'minion') rec.damage.minions += dmg;
    else if (target.type === 'monster') rec.damage.monsters += dmg;
    rec.damage.total += dmg;
  }

  _recordHeroDeath(victim, src) {
    const G = this.G, R = this.R;
    const timeMs = ms(G.time);
    const killer = src instanceof R.Hero ? src : null;
    // Damage-based assists only; the game may also grant proximity assists.
    const assists = (victim.recentDmg || [])
      .filter(entry => entry.h !== killer && entry.h.team !== victim.team && G.time - entry.t < 8)
      .map(entry => entry.h.__headlessId);
    const entry = {
      timeMs,
      victim: victim.__headlessId,
      victimTeam: teamName(victim.team),
      killer: killer ? killer.__headlessId : null,
      killerSource: killer ? 'hero' : (src && src.isStructure ? 'structure' : src && src.type ? src.type : 'unknown'),
      assists,
      firstBlood: false,
    };
    if (this.firstBloodMs === null && killer) {
      this.firstBloodMs = timeMs;
      entry.firstBlood = true;
    }
    this.killTimeline.push(entry);
  }

  _recordStructure(unit, src) {
    if (unit.isBase) return;   // the base falling is the match end, reported there
    const by = src instanceof this.R.Hero ? src.__headlessId : null;
    const takerTeam = teamName(1 - unit.team);
    this.teams[takerTeam].structuresDestroyed.push({
      timeMs: ms(this.G.time),
      id: this.structureIds.get(unit) || null,
      kind: unit.type === 'inhibitor' ? 'inhibitor' : 'tower',
      lane: unit.lane || null,
      by,
      bySource: src instanceof this.R.Hero ? 'hero' : src && src.type ? src.type : 'unknown',
    });
  }

  _recordEpic(unit, src) {
    if (!(src instanceof this.R.Hero)) return;
    this.teams[teamName(src.team)].epicKills.push({
      timeMs: ms(this.G.time),
      kind: unit.epic,
      name: unit.name,
      by: src.__headlessId,
    });
  }

  _frame(dt) {
    const dtMs = dt * 1000;
    for (const [hero, rec] of this.heroes) {
      if (!hero.alive) {
        rec.timeDeadMs += dtMs;
        rec._lastX = hero.x; rec._lastY = hero.y;
        continue;
      }
      const moved = Math.hypot(hero.x - rec._lastX, hero.y - rec._lastY);
      if (moved < TELEPORT_DISTANCE) rec.distanceTravelled += moved;
      rec._lastX = hero.x; rec._lastY = hero.y;
      if (hero.bush >= 0) rec.timeInBushMs += dtMs;
    }
    const nowMs = this.G.time * 1000;
    if (nowMs + 1e-6 >= this.nextSampleMs) this._sample();
  }

  _sample() {
    const G = this.G, R = this.R;
    const timeMs = Math.round(this.nextSampleMs);
    this.nextSampleMs += this.sampleEveryMs;
    const xpByTeam = [0, 0];
    for (const [hero, rec] of this.heroes) {
      rec.levelTimeline.push({ timeMs, level: hero.level, xp: r1(this._totalXp(hero)), goldEarned: r1(hero.goldEarned) });
      xpByTeam[hero.team] += this._totalXp(hero);
    }
    for (const team of [R.TEAM_BLUE, R.TEAM_RED]) {
      const rec = this.teams[teamName(team)];
      rec.goldTimeline.push({ timeMs, gold: r1(G.teamGold(team)) });
      rec.xpTimeline.push({ timeMs, xp: r1(xpByTeam[team]) });
    }
  }

  /* Cumulative xp: the game subtracts each level's requirement on level-up. */
  _totalXp(hero) {
    const B = this.R.BALANCE;
    let total = hero.xp;
    for (let level = 1; level < hero.level; level++) total += B.xpNeed(level);
    return total;
  }

  report() {
    const G = this.G, R = this.R;
    const heroes = [];
    for (const [hero, rec] of this.heroes) {
      const out = { ...rec };
      delete out._lastX; delete out._lastY; delete out._skillIds;
      out.kills = hero.kills; out.deaths = hero.deaths; out.assists = hero.assists;
      out.goldEarned = r1(hero.goldEarned);
      out.goldHeld = r1(hero.gold);
      out.xp = r1(this._totalXp(hero));
      out.level = hero.level;
      out.healingDone = r1(hero.stats.healDone || 0);
      out.damage = Object.fromEntries(Object.entries(rec.damage).map(([k, v]) => [k, r1(v)]));
      out.damageTaken = r1(rec.damageTaken);
      out.timeDeadMs = Math.round(rec.timeDeadMs);
      out.timeInBushMs = Math.round(rec.timeInBushMs);
      out.distanceTravelled = r1(rec.distanceTravelled);
      out.items = hero.items.map(item => item.id);
      heroes.push(out);
    }
    const teams = {};
    for (const team of [R.TEAM_BLUE, R.TEAM_RED]) {
      const label = teamName(team);
      teams[label] = {
        ...this.teams[label],
        kills: G.kills[team],
        goldEarned: r1(G.teamGold(team)),
        towersAlive: G.towers.filter(t => t.team === team && t.alive).length,
        inhibitorsAlive: G.inhibitors.filter(i => i.team === team && i.alive).length,
        baseHpPct: G.bases[team] ? Math.round(G.bases[team].hp / G.bases[team].maxHp * 1000) / 1000 : null,
      };
    }
    const lengthMs = ms(G.time);
    return {
      schema: 'legends-arena.headless-stats/v1',
      match: {
        seed: this.sim.options.seed,
        mode: G.mode,
        finished: G.state === 'end',
        winner: G.lastWinner === null || G.lastWinner === undefined ? null : teamName(G.lastWinner),
        lengthMs,
        firstBloodMs: this.firstBloodMs,
        totalKills: G.kills[0] + G.kills[1],
        killsPerMinute: lengthMs > 0 ? Math.round((G.kills[0] + G.kills[1]) / (lengthMs / 60000) * 100) / 100 : 0,
        killTimeline: this.killTimeline,
      },
      teams,
      heroes,
    };
  }
}

module.exports = { MatchStats, attachStats: (simulator, options) => new MatchStats(simulator, options) };
