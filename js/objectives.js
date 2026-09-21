'use strict';
/* ============================================================
   objectives.js — jungle buffs, epic monsters (Turtle / Lord),
   inhibitors and super minions.

   These are the things a team gives up map position to take, so
   every one of them has to be legible on the HUD before it spawns —
   see UI.syncObjectiveTimers, which reads Game.objectiveState().
   ============================================================ */

/* ---- jungle buff definitions ----
   Buffs are held by the hero, expire on a timer, and are dropped on death,
   which is what makes killing a buffed jungler worth the detour. */
const JUNGLE_BUFFS = {
  blueBuff: {
    name: 'Sage Rune', icon: '🔷', color: '#60a5fa', dur: 70,
    stats: { cdr: 0.12, manaRegen: 14 },
    desc: '+12% Cooldown Reduction, +14 mana/s',
  },
  redBuff: {
    name: 'Fury Rune', icon: '🔶', color: '#fb923c', dur: 70,
    stats: { physAtk: 18, magicPower: 22, tenacity: 0.2 },
    desc: '+18 Attack, +22 Magic Power, +20% Tenacity',
  },
  lord: {
    name: "Crown's Sight", icon: '👑', color: '#ffc94a', dur: 90,
    stats: { physAtk: 22, magicPower: 28, maxHp: 350 },
    desc: '+22 Attack, +28 Magic Power, +350 HP',
  },
  turtle: {
    name: 'Tidewave', icon: '🐢', color: '#4ade80', dur: 60,
    stats: { physAtk: 12, magicPower: 15, hpRegen: 12 },
    desc: '+12 Attack, +15 Magic Power, +12 HP/s',
  },
  litho: {
    name: 'River Current', icon: '🌊', color: '#5eead4', dur: 22,
    stats: { speed: 45, manaRegen: 10 },
    desc: '+45 Movement Speed, +10 mana/s',
  },
};

/* Per-kind camp bodies. Buffs stay the costly early contest; lizards are the
   clear loop; river crabs and lithos are lighter gold camps that sit still. */
const CAMP_STATS = {
  blueBuff: { hp: 1250, atk: 62, armor: 24, gold: 120, xp: 150, r: 26, respawn: 70 },
  redBuff:  { hp: 1250, atk: 62, armor: 24, gold: 120, xp: 150, r: 26, respawn: 70 },
  normal:   { hp: 820,  atk: 46, armor: 16, gold: 72,  xp: 95,  r: 20, respawn: 42 },
  crab:     { hp: 540,  atk: 34, armor: 12, gold: 88,  xp: 70,  r: 18, respawn: 48 },
  litho:    { hp: 680,  atk: 38, armor: 14, gold: 96,  xp: 85,  r: 22, respawn: 55 },
};

/* ---- buffed jungle monster ---- */
class BuffMonster extends Monster {
  constructor(camp) {
    super(camp);
    this.kind = camp.kind || 'normal';
    const spec = CAMP_STATS[this.kind] || CAMP_STATS.normal;
    this.buff = JUNGLE_BUFFS[this.kind] || null;
    this.respawn = spec.respawn;
    this.radius = spec.r;
    this.maxHp = this.hp = spec.hp;
    const A = this.attrs.base;
    A.maxHp = spec.hp; A.physAtk = spec.atk;
    A.armor = spec.armor; A.mr = spec.armor;
    this.goldValue = spec.gold; this.xpValue = spec.xp;
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
   the fight is the cost, not the last hit. */
class EpicMonster extends Unit {
  constructor(kind, pos) {
    super(pos.x, pos.y, TEAM_NEUTRAL);
    this.type = 'monster'; this.epic = kind;
    this.home = { x: pos.x, y: pos.y };
    const lord = kind === 'lord';
    this.radius = lord ? 46 : 36;
    this.maxHp = this.hp = lord ? 6200 : 3400;
    const A = this.attrs.base;
    A.maxHp = this.maxHp;
    A.physAtk = lord ? 220 : 120;
    A.armor = lord ? 30 : 18; A.mr = lord ? 30 : 18;
    A.atkSpd = 0.7; A.speed = lord ? 190 : 170;
    this.range = lord ? 130 : 100;
    this.goldValue = lord ? 170 : 100;
    this.xpValue = lord ? 300 : 180;
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
    const pct = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.evolved = true;
    this.name = Game.isTen && Game.isTen() ? 'Elder Colossus' : 'Elder Warden';
    this.radius = 54;
    this.maxHp = 9000;
    this.hp = Math.max(1, Math.round(this.maxHp * pct));
    this.attrs.base.maxHp = this.maxHp;
    this.attrs.base.physAtk = 280;
    this.attrs.base.armor = 42;
    this.attrs.base.mr = 42;
    this.goldValue = 220;
    this.xpValue = 420;
    this.color = THEME.warn;
    if (Game.fx) Game.fx.ring(this.x, this.y, 190, THEME.gold, 0.8);
    return true;
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
    if (this.leashed) {
      this.heal(this.maxHp * 0.16 * dt);
      if (dist(this, this.home) < 40) { this.leashed = false; this.hp = this.maxHp; }
      else this.moveToward(this.home.x, this.home.y, dt);
      return;
    }
    if (!this.target) return;
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
  }
  die(src) {
    this.alive = false;
    Game.fx.explosion(this.x, this.y, this.radius * 3);
    Game.fx.shake(12);
    const team = src instanceof Hero ? src.team : null;
    if (team === null) { Game.scheduleEpic(this.epic); return; }

    // The buff is the main prize; direct gold is bounded, with a comeback
    // premium only when the team taking the risk was already behind.
    const reward = Game.objectiveGoldPerHero(team, this.goldValue);
    for (const h of Game.heroes) {
      if (h.team !== team) continue;
      h.gainGold(reward);
      h.gainXp(this.xpValue);
      if (this.epic === 'lord') h.applyBuffRune('lord');
      else h.applyBuffRune('turtle');
    }
    UI.announce(team === TEAM_BLUE ? `${this.icon} ${this.name} taken!` : `${this.icon} Enemy took ${this.name}!`,
      team === TEAM_BLUE ? 'major' : 'death');
    if (this.epic === 'lord') Game.spawnLordMinion(team, this.evolved);
    if (typeof Mlbb !== 'undefined') Mlbb.onEpicKill(this, src);
    Game.scheduleEpic(this.epic);
  }
}

/* ---- Lord minion ----
   A siege unit that walks the lane nearest the base it is pushing toward and
   hits structures far harder than a normal wave. It is the reason taking Lord
   ends games rather than just paying gold. */
class LordMinion extends Minion {
  constructor(team, lane, empowered = false) {
    super(team, lane, 'melee');
    this.kind = 'lord';
    this.empowered = empowered;
    this.radius = empowered ? 34 : 30;
    this.maxHp = this.hp = empowered ? 4400 : 3200;
    const A = this.attrs.base;
    A.maxHp = this.maxHp; A.physAtk = empowered ? 180 : 140;
    A.armor = empowered ? 50 : 40; A.mr = empowered ? 50 : 40;
    A.speed = empowered ? 210 : 200;
    this.range = 120;
    this.goldValue = 90; this.xpValue = 110;
    // start it at the river rather than the fountain so it arrives while the
    // fight that won it is still meaningful
    const p = pathPoint(this.path, 0.45);
    this.x = p.x; this.y = p.y;
    this.wpIdx = Math.floor(this.path.length * 0.45);
  }
  attackPacket(target) {
    return {
      amount: this.curAtk() * (target && target.isStructure ? (this.empowered ? 5.2 : 4.5) : 1),
      type: 'physical', isBasic: true,
    };
  }
}

/* ---- inhibitor ----
   Not a turret: it does not shoot. It is a wall whose only job is to gate
   super minions, so losing one changes the shape of the next five minutes
   rather than the next five seconds. */
class Inhibitor extends Unit {
  constructor(x, y, team, lane) {
    super(x, y, team);
    this.type = 'inhibitor'; this.isStructure = true; this.lane = lane;
    this.radius = 34;
    this.maxHp = this.hp = 2200;
    const A = this.attrs.base;
    A.maxHp = this.maxHp; A.armor = 25; A.mr = 25; A.speed = 0;
    this.respawnT = 0;
  }
  update(dt) {
    if (this.alive) { this.baseUpdate(dt); return; }
    // inhibitors come back, which is what stops one lost lane from being
    // an automatic loss
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        this.alive = true; this.hp = this.maxHp;
        Game.fx.ring(this.x, this.y, 90, TEAM_COLORS[this.team], 0.7);
        UI.announce(`${this.team === TEAM_BLUE ? 'Your' : 'Enemy'} ${this.lane} inhibitor restored`, 'minor');
      }
    }
  }
  die(src) {
    this.alive = false;
    this.respawnT = 150;
    Game.fx.explosion(this.x, this.y, 130);
    Game.fx.shake(9);
    SFX.tower();
    const enemyTeam = 1 - this.team;
    const reward = Game.objectiveGoldPerHero(enemyTeam, BALANCE.inhibitorGold);
    for (const h of Game.heroes) if (h.team === enemyTeam) h.gainGold(reward);
    UI.announce(this.team === TEAM_BLUE
      ? `💔 ${this.lane} inhibitor destroyed — super minions incoming!`
      : `🎉 Enemy ${this.lane} inhibitor down — super minions!`,
      this.team === TEAM_BLUE ? 'death' : 'kill');
    UI.killFeed(src, this);
  }
}

/* ---- super minion ----
   Spawns in a lane whose enemy inhibitor is down. */
class SuperMinion extends Minion {
  constructor(team, lane) {
    super(team, lane, 'melee');
    this.kind = 'super';
    this.radius = 24;
    this.maxHp = this.hp = 1800;
    const A = this.attrs.base;
    A.maxHp = 1800; A.physAtk = 95; A.armor = 30; A.mr = 30;
    A.speed = 195;
    this.range = 90;
    this.goldValue = 70; this.xpValue = 85;
  }
  attackPacket(target) {
    return {
      amount: this.curAtk() * (target && target.isStructure ? 3.4 : 1),
      type: 'physical', isBasic: true,
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JUNGLE_BUFFS, BuffMonster, EpicMonster, LordMinion, Inhibitor, SuperMinion };
}
