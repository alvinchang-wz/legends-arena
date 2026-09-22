'use strict';
/* ============================================================
   objectives.js — jungle buffs, epic monsters (Turtle / Lord),
   inhibitors and super minions.

   These are the things a team gives up map position to take, so
   every one of them has to be legible on the HUD before it spawns —
   see UI.syncObjectiveTimers, which reads Game.objectiveState().
   Numbers follow docs/design/lanes-economy.md sections 12-14.
   ============================================================ */

/* ---- jungle buff definitions ----
   Buffs are held by the hero, expire on a timer, and are dropped on death,
   which is what makes killing a buffed jungler worth the detour. 75 s
   outlives the 90 s camp respawn by the walk time. */
const JUNGLE_BUFFS = {
  blueBuff: {
    name: 'Sage Rune', icon: '🔷', color: '#60a5fa', dur: 75,
    stats: { cdr: 0.12, manaRegen: 14 },
    desc: '+12% Cooldown Reduction, +14 mana/s',
  },
  redBuff: {
    name: 'Fury Rune', icon: '🔶', color: '#fb923c', dur: 75,
    stats: { physAtk: 18, magicPower: 22, tenacity: 0.2 },
    desc: '+18 Attack, +22 Magic Power, +20% Tenacity; basic attacks slow heroes 30% for 1s',
  },
  litho: {
    name: 'River Current', icon: '🌊', color: '#5eead4', dur: 22,
    stats: { speed: 45, manaRegen: 10 },
    desc: '+45 Movement Speed, +10 mana/s',
  },
};

/* Per-kind camp bodies, evaluated as `base + perMin * minutes` at spawn.
   Buffs stay the costly early contest; lizards are the clear loop; river
   crabs and lithos are lighter camps that sit still. XP is tuned so purple +
   orange + three small camps with Retribution is exactly level 4. */
const CAMP_STATS = {
  blueBuff: { hp: 1250, hpPerMin: 50, atk: 62, atkPerMin: 1.0, armor: 24, armorPerMin: 0.5, gold: 80, goldPerMin: 1.0, xp: 90, r: 26, respawn: 90 },
  redBuff:  { hp: 1250, hpPerMin: 50, atk: 62, atkPerMin: 1.0, armor: 24, armorPerMin: 0.5, gold: 80, goldPerMin: 1.0, xp: 90, r: 26, respawn: 90 },
  normal:   { hp: 820,  hpPerMin: 33, atk: 46, atkPerMin: 0.7, armor: 16, armorPerMin: 0.5, gold: 50, goldPerMin: 0.5, xp: 55, r: 20, respawn: 70 },
  crab:     { hp: 540,  hpPerMin: 40, atk: 34, atkPerMin: 0.5, armor: 12, armorPerMin: 0.5, gold: 40, goldPerMin: 0,   xp: 40, r: 18, respawn: 60 },
  litho:    { hp: 680,  hpPerMin: 40, atk: 38, atkPerMin: 0.5, armor: 14, armorPerMin: 0,   gold: 50, goldPerMin: 0,   xp: 60, r: 22, respawn: 90 },
};

/* ---- buffed jungle monster ---- */
class BuffMonster extends Monster {
  constructor(camp) {
    super(camp);
    this.kind = camp.kind || 'normal';
    const spec = CAMP_STATS[this.kind] || CAMP_STATS.normal;
    const mins = Game.time / 60;
    this.buff = JUNGLE_BUFFS[this.kind] || null;
    this.respawn = spec.respawn;
    this.radius = spec.r;
    this.maxHp = this.hp = Math.round(spec.hp + spec.hpPerMin * mins);
    const A = this.attrs.base;
    A.maxHp = this.maxHp; A.physAtk = spec.atk + spec.atkPerMin * mins;
    A.armor = A.mr = spec.armor + spec.armorPerMin * mins;
    this.goldValue = spec.gold + spec.goldPerMin * mins; this.xpValue = spec.xp;
    if (this.buff) this.color = this.buff.color;
    else if (this.kind === 'crab') this.color = '#94a3b8';
    else if (this.kind === 'litho') this.color = '#5eead4';
  }
  die(src) {
    super.die(src);
    if (this.buff && src instanceof Hero) {
      src.applyBuffRune(this.kind);
      if (src.isPlayer) UI.announce(`${this.buff.icon} ${this.buff.name} acquired`, 'minor');
    }
  }
}

/* ---- epic monsters ----
   Turtle first, Lord later in the same slot. Both are neutral, both leash,
   and both hand their reward to the whole team rather than the last hitter —
   the fight is the cost, not the last hit. Both scale with the clock at
   spawn: Turtle 2,800 + 300/min; Lord 8,000 + 400 per minute past 8:00,
   frozen at 18:00. */
class EpicMonster extends Unit {
  constructor(kind, pos) {
    super(pos.x, pos.y, TEAM_NEUTRAL);
    this.type = 'monster'; this.epic = kind;
    this.home = { x: pos.x, y: pos.y };
    const lord = kind === 'lord';
    const mins = Game.time / 60;
    this.radius = lord ? 46 : 36;
    const A = this.attrs.base;
    if (lord) {
      this.maxHp = this.hp = Math.round(8000 + 400 * clamp(mins - 8, 0, 10));
      /* The design's 200 + 10/min true damage assumes a five-hero group.
         Heuristic bots start the Lord two or three at a time, and at that
         number it killed the party and reset to full every time (46 resets
         in one 30:00 match). Scaled to 0.6x until bots group (bot-ai.md). */
      A.physAtk = 120 + 6 * mins;
      A.armor = A.mr = 30;
      A.speed = 190; this.range = 130;
    } else {
      this.maxHp = this.hp = Math.round(2800 + 300 * mins);
      A.physAtk = 120 + 8 * mins;
      A.armor = A.mr = 18 + 3 * mins;
      A.speed = 170; this.range = 100;
    }
    A.maxHp = this.maxHp;
    A.atkSpd = 1.0;
    this.thunderT = 4;            // Lord's Thunder Strike cadence
    const ten = typeof Game !== 'undefined' && Game.isTen && Game.isTen();
    this.color = lord ? THEME.gold : (ten ? '#f0b429' : THEME.hp);
    this.icon = lord ? (ten ? '🌋' : '👑') : (ten ? '🕯️' : '🐢');
    this.name = lord ? (ten ? 'Colossus' : 'Warden') : (ten ? 'Sentinel' : 'Leviathan');
    this.evolved = false;
    this.target = null; this.leashed = false;
    if (lord && Game.time >= BALANCE.ancientLordAt) this.evolve();
  }
  evolve() {
    if (this.epic !== 'lord' || this.evolved) return false;
    this.evolved = true;
    this.name = Game.isTen && Game.isTen() ? 'Elder Colossus' : 'Elder Warden';
    this.radius = 54;
    this.attrs.base.armor = 37;
    this.attrs.base.mr = 37;
    this.color = THEME.warn;
    if (Game.fx) Game.fx.ring(this.x, this.y, 190, THEME.gold, 0.8);
    return true;
  }
  /* The Lord hits for true damage; the Turtle is physical. */
  attackPacket(target) {
    return { amount: this.curAtk(), type: this.epic === 'lord' ? 'true' : 'physical', isBasic: true };
  }
  onDamaged(src, dmg) {
    this.hitFlash = 0.12;
    if (src && src.type === 'hero') {
      if (!this.target || !this.target.alive || dist(src, this) + 36 < dist(this.target, this))
        this.target = src;
    }
  }
  update(dt) {
    if (!this.alive) return;
    this.baseUpdate(dt);
    if (!this.cc.canAct) return;
    const lord = this.epic === 'lord';
    const regen = lord ? BALANCE.lordLeashRegen : 0.16;
    if (this.leashed) {
      this.heal(this.maxHp * regen * dt);
      if (dist(this, this.home) < 40) { this.leashed = false; if (!lord || BALANCE.lordLeashSnap) this.hp = this.maxHp; }
      else this.moveToward(this.home.x, this.home.y, dt);
      return;
    }
    if (!this.target) { if (this.hp < this.maxHp) this.heal(this.maxHp * regen * dt); return; }
    if (!this.target.alive || dist(this, this.home) > 620) {
      this.target = null; this.leashed = true; return;
    }
    let best = null, bd = Infinity;
    for (const h of Game.heroes) {
      if (!h.alive || dist(h, this.home) > 700) continue;
      const d = dist(this, h);
      if (d < bd) { bd = d; best = h; }
    }
    if (!best) { this.target = null; this.leashed = true; return; }
    this.target = best;
    if (this.inAttackRange(best)) this.tryAttack(best);
    else this.moveToward(best.x, best.y, dt);
    // Thunder Strike: every 4 s in a fight, 110% ATK true damage around the Lord
    if (this.epic === 'lord') {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 4;
        const amount = this.curAtk() * 1.1;
        for (const h of Game.heroes) {
          if (h.alive && dist(h, this) < 260 + h.radius) resolveDamage(this, h, { amount, type: 'true' });
        }
        Game.fx.ring(this.x, this.y, 260, THEME.warn, 0.5);
      }
    }
  }
  /* Rewards to the team of the last-hitting hero (a Retribution steal
     works). Turtle: 45 / 55 / 65 gold per hero for the 1st / 2nd / 3rd, XP
     120 + 20 x minute, a shield for two minutes (bigger for the killer).
     Lord: gold 45 + 9 x minute, XP 200 + 20 x minute, the Summoned Lord and
     a minute of enhanced waves. */
  die(src) {
    this.alive = false;
    Game.fx.explosion(this.x, this.y, this.radius * 3);
    Game.fx.shake(12);
    const team = src instanceof Hero ? src.team : null;
    if (team === null) { Game.scheduleEpic(this.epic); return; }

    const mins = Game.time / 60;
    const lord = this.epic === 'lord';
    let gold, xp;
    if (lord) { gold = 45 + 9 * mins; xp = 200 + 20 * mins; }
    else {
      const n = Game.epics.turtle.taken++;
      gold = BALANCE.turtleGold[Math.min(BALANCE.turtleGold.length - 1, n)];
      xp = 120 + 20 * mins;
    }
    const reward = Game.objectiveGoldPerHero(team, gold);
    for (const h of Game.heroes) {
      if (h.team !== team) continue;
      h.gainGold(reward);
      h.gainXp(xp);
      if (!lord) h.addShield(h === src ? 240 + 24 * h.level : 120 + 12 * h.level, 120);
    }
    UI.announce(team === TEAM_BLUE ? `${this.icon} ${this.name} taken!` : `${this.icon} Enemy took ${this.name}!`,
      team === TEAM_BLUE ? 'major' : 'death');
    if (lord) Game.spawnLordMinion(team, this.evolved);
    if (typeof Mlbb !== 'undefined') Mlbb.onEpicKill(this, src);
    Game.scheduleEpic(this.epic);
  }
}

/* ---- Summoned Lord ----
   A siege unit that walks the lane with the fewest enemy structures and
   converts a won Lord fight into structures: on first reaching each enemy
   turret, inhibitor or crystal it deals 30% (50% evolved) of that
   structure's max HP as true damage and silences it for 3 s; it takes
   25-45% less damage depending on how many allied heroes escort it; turrets
   shoot it first; allied heroes near it deal +15% to structures. */
class LordMinion extends Minion {
  constructor(team, lane, empowered = false) {
    super(team, lane, 'lord');
    this.kind = 'lord';
    this.empowered = empowered;
    this.radius = empowered ? 34 : 30;
    const mins = Game.time / 60;
    this.maxHp = this.hp = Math.round((empowered ? 5500 : 4000) + 200 * mins);
    const A = this.attrs.base;
    A.maxHp = this.maxHp; A.physAtk = empowered ? 180 : 150;
    A.armor = A.mr = empowered ? 50 : 40;
    A.speed = empowered ? 220 : 210; A.atkSpd = 1.0;
    this.range = 120;
    this.structMult = empowered ? 5 : 4;
    this.goldValue = 60; this.xpValue = 60;
    this.charged = new Set();     // structures already hit by the charge
    // start it at the river rather than the fountain so it arrives while the
    // fight that won it is still meaningful
    const p = pathPoint(this.path, 0.45);
    this.x = p.x; this.y = p.y;
    this.wpIdx = Math.floor(this.path.length * 0.45);
  }
  onIncomingDamage(src, dmg) {
    let allies = 0;
    for (const h of Game.heroes) if (h.team === this.team && h.alive && dist(h, this) < 600) allies++;
    return dmg * (1 - Math.min(0.45, 0.25 + 0.04 * allies));
  }
  chargeStructures() {
    for (const s of Game.structures()) {
      if (!s.alive || s.team === this.team || s.shieldedByOuter || this.charged.has(s)) continue;
      if (dist(this, s) > 410 + s.radius) continue;
      this.charged.add(s);
      resolveDamage(this, s, { amount: s.maxHp * BALANCE.lordChargeFrac[this.empowered ? 1 : 0], type: 'true' });
      if (s.alive) s.disabledT = 3;
      Game.fx.ring(s.x, s.y, s.radius + 40, THEME.warn, 0.6);
    }
  }
  update(dt) {
    if (this.alive) this.chargeStructures();
    super.update(dt);
  }
}

/* ---- inhibitor ----
   Not a turret: it does not shoot. It is a wall whose only job is to gate
   super minions and the crystal. It never comes back, so losing one changes
   the shape of the rest of the match. Immune while its inner turret stands. */
class Inhibitor extends Unit {
  constructor(x, y, team, lane) {
    super(x, y, team);
    this.type = 'inhibitor'; this.isStructure = true; this.lane = lane;
    this.radius = 34;
    this.maxHp = this.hp = BALANCE.inhibitorHp;
    const A = this.attrs.base;
    A.maxHp = this.maxHp; A.armor = 25; A.mr = 25; A.speed = 0;
    this.respawnT = 0;
    this.shieldedByOuter = false;   // set by Game each frame
  }
  update(dt) {
    if (this.alive) this.baseUpdate(dt);
  }
  die(src) {
    this.alive = false;
    this.respawnT = 0;
    Game.fx.explosion(this.x, this.y, 130);
    Game.fx.shake(9);
    SFX.tower();
    const enemyTeam = 1 - this.team;
    const reward = Game.objectiveGoldPerHero(enemyTeam, BALANCE.inhibitorGold);
    for (const h of Game.heroes) if (h.team === enemyTeam) h.gainGold(reward);
    UI.announce(this.team === TEAM_BLUE
      ? `💔 ${this.lane} inhibitor destroyed — super minions incoming, the crystal is exposed!`
      : `🎉 Enemy ${this.lane} inhibitor down — super minions, their crystal is exposed!`,
      this.team === TEAM_BLUE ? 'death' : 'kill');
    UI.killFeed(src, this);
  }
}

/* ---- super minion ----
   Spawns behind the cannon in a lane whose enemy inhibitor is down, for the
   rest of the match. Stats from MINION_STATS.super; it keeps pace with the
   late wave speed-up. */
class SuperMinion extends Minion {
  constructor(team, lane, slot = 0, count = 1) {
    super(team, lane, 'super', slot, count);
    this.attrs.base.speed = 195 + clamp((Game.time / 60 - BALANCE.minionSpeedUpFrom / 60) * BALANCE.minionSpeedUpPerMin, 0, BALANCE.minionSpeedUpCap);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JUNGLE_BUFFS, BuffMonster, EpicMonster, LordMinion, Inhibitor, SuperMinion };
}
