'use strict';
/* ============================================================
   entities.js — units, heroes (player + bots), minions,
   towers, jungle monsters, projectiles, zones

   All damage goes through resolveDamage() in combat.js; all crowd
   control goes through the CCState on each unit. Nothing here
   subtracts from `hp` directly except the pipeline itself.
   ============================================================ */

/* Lanes that have a minion wave to follow (see Hero.laneWaveAnchor). */
const LANE_WAVE_INDEX = { top: 0, mid: 1, bot: 2, dusk: 3, west: 4, east: 5, dawn: 6 };
const LANE_WAVE_LANES = new Set(Object.keys(LANE_WAVE_INDEX));

class Unit {
  constructor(x, y, team) {
    this.x = x; this.y = y; this.team = team;
    this.radius = 20; this.type = 'unit';
    this.maxHp = 100; this.hp = 100;
    this.range = 80;
    this.atkCd = 0; this.alive = true;
    this.facing = rand(0, TAU);
    this.attackAnim = 0; this.bush = -1;
    this.slideDir = null;     // which way this unit is currently rounding a wall
    this.routeVia = null;     // {wall, aim} the tip a bot committed to going round
    this.ranged = false; this.projColor = '#fff';
    this.isStructure = false;
    this.goldValue = 0; this.xpValue = 0;
    this.vx = 0; this.vy = 0; // smoothed world velocity for skillshot lead
    this._px = x; this._py = y;

    this.attrs = new Stats();
    this.cc = new CCState();
    this.marks = {};             // passive stacks placed on this unit by others
    this.shields = [];           // [{amount, t}]
    this.dots = [];              // [{src, perSec, t, type, color, tag}]
    this.hitFlash = 0;           // white-out on taking damage, for the renderer
  }

  get hpPct() { return this.hp / this.maxHp; }
  get shieldTotal() { let s = 0; for (const sh of this.shields) s += sh.amount; return s; }

  /* --- stat reads: every combat system goes through these --- */
  curAtk() { return this.attrs.get('physAtk'); }
  magicPower() { return this.attrs.get('magicPower'); }
  curAtkSpd() { return this.attrs.get('atkSpd'); }
  armorValue() { return this.attrs.get('armor'); }
  mrValue() { return this.attrs.get('mr'); }
  curSpeed() {
    const s = this.attrs.get('speed');
    return this.cc.canMove ? s * (1 - this.cc.slowPct) : 0;
  }

  distTo(u) { const dx = u.x - this.x, dy = u.y - this.y; return Math.sqrt(dx * dx + dy * dy); }
  inAttackRange(u) { return this.distTo(u) <= this.range + this.radius + u.radius; }

  moveToward(tx, ty, dt) {
    if (!this.cc.canMove) return;
    const dx = tx - this.x, dy = ty - this.y;
    const d = hyp(dx, dy);
    if (d < 3) return;
    const step = Math.min(d, this.curSpeed() * dt);
    let ux = dx / d, uy = dy / d;
    /* Terrain. Sliding along a wall rather than stopping dead against it is
       what lets a bot walking into one follow it round to the opening, and
       what keeps the player from feeling glued to the rock they brushed. */
    const slide = Game.wallSlide(this, ux, uy, step);
    if (slide) { ux = slide.x; uy = slide.y; }
    this.x += ux * step; this.y += uy * step;
    this.facing = Math.atan2(dy, dx);   // keep facing the intent, not the slide
    this.clampWorld();
  }
  clampWorld() { Game.clampPoint(this, 40); }

  /* --- shields --- */
  addShield(amount, dur) {
    if (amount <= 0) return;
    this.shields.push({ amount, t: dur });
  }
  /* Spend shield charges oldest-first; returns how much of `dmg` they ate. */
  absorbWithShield(dmg) {
    let left = dmg, used = 0;
    for (const sh of this.shields) {
      if (left <= 0) break;
      const take = Math.min(sh.amount, left);
      sh.amount -= take; left -= take; used += take;
    }
    if (used > 0) this.shields = this.shields.filter(s => s.amount > 0.5);
    return used;
  }

  /* --- damage over time --- */
  addDot({ src, total, dur, type, color, tag }) {
    // a re-applied dot of the same tag refreshes rather than stacking
    const ex = this.dots.find(d => d.tag === tag && d.src === src);
    if (ex) { ex.perSec = total / dur; ex.t = dur; return; }
    this.dots.push({ src, perSec: total / dur, t: dur, type: type || 'magic', color, tag });
  }

  heal(v) {
    if (!this.alive || v <= 0) return 0;
    const h = Math.min(v, this.maxHp - this.hp);
    if (h > 0) this.hp += h;
    return h;
  }

  /* Basic-attack damage packet. Overridden where a unit hits structures or
     heroes differently. */
  attackPacket(target) {
    return { amount: this.curAtk(), type: 'physical', canCrit: true, isBasic: true };
  }

  /* Compatibility shim for anything that still wants a one-argument hit. */
  takeDamage(amount, src, type = 'physical') {
    return resolveDamage(src, this, { amount, type });
  }

  baseUpdate(dt) {
    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.cc.update(dt);
    for (const sh of this.shields) sh.t -= dt;
    if (this.shields.length) this.shields = this.shields.filter(s => s.t > 0 && s.amount > 0.5);
    if (this.dots.length) {
      for (const d of this.dots) {
        d.t -= dt;
        /* accumulate and tick at 4 Hz: same total damage, but one readable
           floater per tick instead of a "1" every frame */
        d._acc = (d._acc || 0) + d.perSec * dt;
        d._cd = (d._cd || 0) - dt;
        if ((d._cd <= 0 || d.t <= 0) && d._acc > 0) {
          resolveDamage(d.src, this, { amount: d._acc, type: d.type, noPassive: true, lifestealMult: 0 });
          d._acc = 0; d._cd = 0.25;
        }
      }
      this.dots = this.dots.filter(d => d.t > 0);
    }
  }

  /* Call after movement each frame so aim-lead uses real travel, not facing. */
  trackVelocity(dt) {
    const inv = 1 / Math.max(dt, 1e-3);
    const rx = (this.x - this._px) * inv, ry = (this.y - this._py) * inv;
    this.vx = this.vx * 0.55 + rx * 0.45;
    this.vy = this.vy * 0.55 + ry * 0.45;
    this._px = this.x; this._py = this.y;
  }

  tryAttack(target) {
    if (!this.cc.canAct || !target || !target.alive) return;
    this.facing = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.atkCd > 0) return;
    this.atkCd = 1 / Math.max(0.15, this.curAtkSpd());
    this.attackAnim = 0.18;
    if (this.isPlayer) Game.fx.attackRange(this);
    if (this.ranged) {
      Game.projectiles.push(Projectile.homing(this, target, this.attackPacket(target)));
      if (this.isPlayer) SFX.shoot();
    } else {
      const dealt = resolveDamage(this, target, this.attackPacket(target));
      Game.fx.slash(target.x, target.y, this.facing, this.team);
      if (dealt && this.onBasicLanded) this.onBasicLanded(target, dealt);
      if (this.isPlayer || target.isPlayer) SFX.hit();
    }
  }

  onDamaged(src, dmg) { this.hitFlash = 0.12; }
  die(src) { this.alive = false; }
}

/* ================= Hero ================= */
class Hero extends Unit {
  constructor(def, team, isPlayer, lane) {
    super(0, 0, team);
    this.type = 'hero';
    this.def0 = def; this.name = def.name; this.icon = def.icon; this.color = def.color;
    this.isPlayer = !!isPlayer; this.lane = lane; this.radius = 38;      // 2.6 map px, the reference hero's collision radius
    this.ranged = def.range > 150; this.projColor = def.projColor || '#fff';
    this.level = 1; this.xp = 0; this.goldEarned = 0; this.gold = 0;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.streak = 0;
    this.deathStreak = 0;
    this.skillCd = [0, 0, 0];
    /* One point per hero level, and maxSkillRank sums to exactly BALANCE
       .maxLevel — so a hero finishes the game with every rank spent and no
       dangling point. Nothing starts pre-learned; level 1 hands you the
       first point to place. */
    this.skillRank = [0, 0, 0];
    this.skillPoints = 1;

    /* named temporary buffs, all additive-with-refresh: {value, t} */
    this.buffs = {};
    this.runes = {};          // jungle/epic buff -> remaining seconds
    this.items = [];
    this.emblem = null;       // EMBLEMS entry
    this.spell = null;        // BATTLE_SPELLS entry
    this.spellCd = 0;
    this.reflectT = 0;        // Vengeance window
    this.shopT = 0;           // bot shopping throttle
    this.buffAtkMult = 1; this.buffAtkT = 0;
    this.buffAsMult = 1; this.buffAsT = 0;

    this.hot = null;          // {rate, t} heal over time
    this.dashS = null;        // active dash state
    this.forced = null;       // hook drag {src, t}
    this.recallT = 0; this.respawnT = 0;
    this.recentDmg = [];      // [{h, t}] recent hero damagers for assists
    this.aiTimer = rand(0, 0.3); this.aiState = 'push'; this.aiTarget = null;
    this.wpIdx = 0;
    /* Per-bot navigation and combat positioning. The route is regenerated when
       its goal moves, not every frame; side gives otherwise identical bots a
       stable preference for opposite flanks instead of making them stack. */
    this.nav = { path: [], index: 0, gx: NaN, gy: NaN, repath: 0,
      stalled: 0, lastD: Infinity, lastX: 0, lastY: 0 };
    this.combatSide = rand(0, 1) < 0.5 ? -1 : 1;
    this.combatPoint = null; this.combatPointT = 0;
    this.stats = { dmgHero: 0, dmgStruct: 0, dmgOther: 0, dmgTaken: 0, healDone: 0 };
    this.cs = 0; this.visionScore = 0; this.combatT = 0;
    this.spawnProtT = 0; this.spawnGateT = 0; this.itemCd = {}; this.shrineT = 0;
    this.dirHurt = []; this.sweepT = 0;
    this.adapt = { caution: 0 };
    this.fleeT = 0;
    this.attackOnMove = true;
    this.inRiver = false;         // Aether Current terrain modifier
    /* Tactical behaviours, on by default and switchable per team so a mirrored
       A/B run can measure what they are actually worth (see Game.experiment). */
    this.avoidsZones = true;      // step out of telegraphed zone skills
    this.escapeCasts = true;      // spend heal/buff/dash on getting out alive
    this.farmsWithSkills = true;  // clear creeps with the kit, not just autos
    this.advancedAI = true;       // power, economy, focus-fire and secure logic
    this.botType = 'heuristic';
    // every hero carries bot parameters: the idle autopilot drives the player's
    // hero through the same heuristics, so a null here crashed every frame
    this.p = defaultBotParams();
    const lanes = Game.lanesFor(team);
    this.path = lane && lanes[lane] ? lanes[lane] : null;
    this.curTarget = null;
    this.lastKillT = -99; this.comboKills = 0;
    this.statT = 0;                    // dynamic-stat refresh timer

    this.passive = def.passive || null;
    this.pv = null;                    // passive scratch state
    const P = this.passiveDef();
    if (P && P.init) P.init(this);
    if (!this.isPlayer) this.autoSpendSkillPoints();

    this.recalcStats(true);
    const b = Game.fountain(team);
    this.x = b.x + rand(-70, 70); this.y = b.y + rand(-70, 70);
    // Unit starts at (0,0), but heroes are placed at their fountain here.
    // Keep the velocity origin in sync with that spawn position so the first
    // update does not report a map-wide teleport (or wildly over-lead a shot).
    this._px = this.x; this._py = this.y;
  }

  passiveDef() { return this.passive ? PASSIVES[this.passive.id] : null; }
  /* Invoke a passive hook if the hero has one. Hooks take (hero, ...args). */
  fire(hook, ...args) {
    const P = this.passiveDef();
    if (P && P[hook]) return P[hook](this, ...args);
    return undefined;
  }

  /* ---------- stats ----------
     base = level curve. bonus = gear + passives + buffs, rebuilt from
     scratch each time so nothing can leak across recalcs. */
  recalcStats(full) {
    const d = this.def0, l = this.level - 1;
    const A = this.attrs;
    const prevMax = this.maxHp || 0;

    A.base.maxHp = d.hp + d.hpLv * l + (BALANCE.heroHpPad || 0);
    A.base.maxMana = d.mp + d.mpLv * l;
    A.base.physAtk = d.atk + d.atkLv * l;
    A.base.magicPower = 0;
    A.base.armor = d.armor + d.armorLv * l + (BALANCE.heroArmorPad || 0);
    A.base.mr = d.mr + d.mrLv * l + (BALANCE.heroMrPad || 0);
    A.base.atkSpd = d.atkSpd;
    A.base.speed = d.speed;
    A.base.range = d.range;
    A.base.critChance = 0; A.base.critDmg = 0;
    A.base.lifesteal = 0; A.base.spellVamp = 0;
    A.base.cdr = 0; A.base.tenacity = 0;
    A.base.physPen = 0; A.base.physPenPct = 0;
    A.base.magicPen = 0; A.base.magicPenPct = 0;
    A.base.hpRegen = 0; A.base.manaRegen = 0;

    A.clearBonus();

    /* Items and emblem. */
    for (const it of this.items) if (it && it.stats) A.addBonus(it.stats);
    if (this.emblem && this.emblem.stats) A.addBonus(this.emblem.stats);

    /* Dynamic passive contribution. */
    const P = this.passiveDef();
    if (P && P.statMod) {
      const table = P.statMod(this);
      if (table) A.addBonus(table);
    }
    if (this.marks && this.marks.weakenUntil > Game.time) A.addBonus({ armor: -18, mr: -18 });

    /* Jungle / epic runes. */
    for (const k in this.runes) {
      if (this.runes[k] > 0 && JUNGLE_BUFFS[k]) A.addBonus(JUNGLE_BUFFS[k].stats);
    }

    /* Named timed buffs. */
    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (!b || b.t <= 0) continue;
      if (k === 'speed') A.addBonus({ speed: b.value });
      else if (k === 'armor') A.addBonus({ armor: b.value });
      else if (k === 'mr') A.addBonus({ mr: b.value });
      else if (k === 'tenacity') A.addBonus({ tenacity: b.value });
      else if (k === 'atkSpd') A.addBonus({ atkSpd: b.value });
    }

    this.maxHp = Math.round(A.get('maxHp'));
    this.maxMana = Math.round(A.get('maxMana'));
    this.range = A.get('range');

    if (full) {
      this.hp = this.maxHp;
      this.mana = this.maxMana;
    } else {
      // grant the delta so a level-up or an HP item is felt immediately,
      // and never let a shrinking pool leave hp above the cap
      if (this.maxHp > prevMax) this.hp += this.maxHp - prevMax;
      this.hp = clamp(this.hp, 0, this.maxHp);
      this.mana = clamp(this.mana || 0, 0, this.maxMana);
    }
  }

  get skills() { return this.def0.skills; }

  /* Percentage buffs multiply on read so they scale items too. */
  curAtk() {
    const m = this.buffAtkT > 0 ? this.buffAtkMult : 1;
    return this.attrs.get('physAtk') * m;
  }
  curAtkSpd() {
    const m = this.buffAsT > 0 ? this.buffAsMult : 1;
    return this.attrs.get('atkSpd') * m;
  }
  curSpeed() {
    const pct = this.buffs.speedPct && this.buffs.speedPct.t > 0 ? this.buffs.speedPct.value : 0;
    const river = this.inRiver && !Game.isDuel() ? 1.12 : 1;
    const shrine = this.shrineT > 0 ? 1.18 : 1;
    const gate = this.spawnGateT > 0 ? 0.15 : 1;
    const s = this.attrs.get('speed') * (1 + pct) * river * shrine * gate;
    return this.cc.canMove ? s * (1 - this.cc.slowPct) : 0;
  }
  cdr() { return clamp(this.attrs.get('cdr'), 0, COMBAT.CDR_CAP); }

  /* Jungle and epic buffs. Kept separate from `buffs` because they are
     dropped wholesale on death and shown individually on the HUD. */
  /* `dur` overrides the rune's own duration — the duel shrine hands out the
     same runes on a much shorter clock than a 5v5 camp does. */
  applyBuffRune(kind, dur) {
    const def = JUNGLE_BUFFS[kind];
    if (!def) return;
    this.runes[kind] = Math.max(this.runes[kind] || 0, dur || def.dur);
    this.recalcStats(false);
    Game.fx.ring(this.x, this.y, this.radius + 34, def.color, 0.6);
  }

  /* Timed additive buff by name. Refreshes to the stronger/longer value. */
  addTimedBuff(name, value, dur) {
    const b = this.buffs[name];
    if (!b || b.t <= 0 || value >= b.value) this.buffs[name] = { value, t: Math.max(dur, b && b.t > 0 ? b.t : 0) };
    else b.t = Math.max(b.t, dur);
    this.recalcStats(false);
  }

  /* --- passive plumbing used by the damage pipeline --- */
  onDealDamage(target, amount, packet) {
    let a = this.fire('onDealDamage', target, amount, packet) ?? amount;
    // Focusing Mark: a support's target is softer for everyone on their team
    if (target.marks && target.marks.focused > Game.time && target.marks.focusBy === this.team) a *= 1.06;
    return a;
  }
  onIncomingDamage(src, dmg, packet) {
    let d = this.fire('onIncoming', src, dmg, packet) ?? dmg;
    // Vengeance reflects a slice straight back; noPassive stops it looping
    if (this.reflectT > 0 && src && src !== this && src.alive && !packet.noPassive) {
      resolveDamage(this, src, { amount: d * 0.3, type: 'true', noPassive: true, lifestealMult: 0 });
    }
    return d;
  }
  onBasicLanded(target, dmg) {
    this.fire('onBasicHit', target, dmg);
    if (this.emblem && this.emblem.id === 'marksman' && target.cc) {
      target.cc.applySlow(0.15, 1, target.attrs ? target.attrs.get('tenacity') : 0);
    }
    // Fury Rune: basic attacks on heroes slow 30% for 1 s, once per 3 s per target
    if (this.runes.redBuff > 0 && target.type === 'hero' && target.cc && target.marks &&
        !(target.marks.furyT > Game.time)) {
      target.marks.furyT = Game.time + 3;
      target.cc.applySlow(0.3, 1, target.attrs ? target.attrs.get('tenacity') : 0);
    }
    this.emblemOnHeroDamage(target, dmg);
  }
  onSkillLanded(target, dmg, s) {
    this.fire('onSkillHit', target, dmg, s);
    if (this.emblem && this.emblem.id === 'fighter') this.heal(dmg * 0.06);
    if (this.emblem && this.emblem.id === 'mage' && target.maxMana) {
      target.mana = Math.max(0, target.mana - target.maxMana * 0.015);
    }
    this.emblemOnHeroDamage(target, dmg);
  }
  /* Keystones that only care that the victim was a hero. */
  emblemOnHeroDamage(target, dmg) {
    if (!this.emblem || target.type !== 'hero') return;
    if (this.emblem.id === 'tank') this.heal(this.maxHp * 0.015);
    if (this.emblem.id === 'support') { target.marks.focused = Game.time + 3; target.marks.focusBy = this.team; }
  }

  gainXp(v) {
    if (this.level >= BALANCE.maxLevel) return;
    this.xp += v;
    let need = BALANCE.xpNeed(this.level);
    while (this.xp >= need && this.level < BALANCE.maxLevel) {
      this.xp -= need; this.level++;
      this.skillPoints++;
      this.recalcStats(false);
      this.heal(this.maxHp * 0.12);
      if (!this.isPlayer) this.autoSpendSkillPoints();
      Game.fx.levelup(this);
      if (this.isPlayer) SFX.levelup();
      need = BALANCE.xpNeed(this.level);
    }
  }

  /* Can this skill index take a point right now? */
  canRankUp(i) {
    if (this.skillPoints <= 0) return false;
    if (this.skillRank[i] >= BALANCE.maxSkillRank[i]) return false;
    if (i === 2) {
      const idx = this.skillRank[2];              // 0,1,2 -> needs level 4,8,12
      if (idx >= BALANCE.ultLevels.length) return false;
      return this.level >= BALANCE.ultLevels[idx];
    }
    if (i === 1 && this.skillRank[1] === 0 && this.level < 2) return false;
    return true;
  }
  rankUp(i) {
    if (!this.canRankUp(i)) return false;
    this.skillRank[i]++; this.skillPoints--;
    if (this.isPlayer) {
      SFX.levelup();
      if (UI.hideTip) UI.hideTip();
      UI.announce(`${this.skills[i].name} → Lv.${this.skillRank[i]}`, 'minor');
    }
    return true;
  }
  /* Bots max the ultimate on cooldown, then follow a simple damage-first order. */
  autoSpendSkillPoints() {
    let guard = 0;
    while (this.skillPoints > 0 && guard++ < 8) {
      if (this.canRankUp(2)) { this.rankUp(2); continue; }
      const order = this.def0.damageStyle === 'magic' ? [0, 1] : [0, 1];
      const pick = order.find(i => this.canRankUp(i) &&
        this.skillRank[i] <= Math.min(...order.map(j => this.skillRank[j])));
      if (pick === undefined) { if (!this.rankUp(order[0])) break; }
      else this.rankUp(pick);
    }
  }

  gainGold(v) {
    this.goldEarned += v; this.gold += v;
  }

  /* ---------- shop ---------- */
  canBuy(def) {
    return this.items.length < ITEM_SLOTS && this.gold >= def.cost
      && !this.items.some(i => i.id === def.id);
  }
  buyItem(def) {
    if (!this.canBuy(def)) return false;
    this.gold -= def.cost;
    this.items.push(def);
    this.recalcStats(false);
    if (this.isPlayer) {
      UI.announce(`${def.icon} ${def.name} purchased`, 'minor'); SFX.gear();
      if (typeof Features !== 'undefined') Features.recordUndo(this, def);
    }
    return true;
  }
  /* Selling refunds 70%: enough that a mis-buy is recoverable, not so much
     that swapping resists every fight is free. */
  sellItem(index) {
    const it = this.items[index];
    if (!it) return false;
    this.items.splice(index, 1);
    this.gold += Math.floor(it.cost * 0.7);
    this.recalcStats(false);
    if (this.isPlayer) SFX.gear();
    return true;
  }
  atShop() { return dist(this, Game.fountain(this.team)) < (Game.isDuel() ? 420 : 380); }

  /* ---------- battle spell ---------- */
  castSpell(point) {
    if (!this.spell || this.spellCd > 0 || !this.alive) return false;
    // Purify is specifically the answer to being disabled. Treating it like a
    // normal spell made both its selection and the bot logic meaningless.
    if (!this.cc.canCast && this.spell.id !== 'purify') return false;
    const ok = this.spell.cast(this, point);
    if (!ok) return false;
    this.spellCd = this.spell.cd;
    if (this.isPlayer) SFX.skill();
    return true;
  }

  /* Skill damage at its current rank. `s` may be a nested sub-skill (endNova),
     in which case it inherits the parent's rank via the explicit argument. */
  skillRankOf(s) {
    const i = this.skills.indexOf(s);
    return i >= 0 ? Math.max(1, this.skillRank[i]) : 1;
  }
  skillDmg(s, rank) {
    const r = (rank !== undefined ? rank : this.skillRankOf(s)) - 1;
    return (s.dmg || 0) + (s.dmgLv || 0) * r
      + this.curAtk() * (s.scaleAd || 0)
      + this.magicPower() * (s.scaleAp || 0);
  }
  skillHeal(s, rank) {
    const r = (rank !== undefined ? rank : this.skillRankOf(s)) - 1;
    return (s.heal || 0) + (s.healLv || 0) * r + this.magicPower() * (s.scaleAp || 0);
  }
  /* Cost of a skill after cooldown reduction. */
  cooldownFor(s) { return s.cd * (1 - this.cdr()); }

  attackPacket() {
    return { amount: this.curAtk(), type: 'physical', canCrit: true, isBasic: true };
  }

  onDamaged(src, dmg, packet) {
    this.hitFlash = 0.14;
    if (this.recallT > 0) { this.recallT = 0; if (this.isPlayer) UI.announce('Recall interrupted!', 'minor'); }
    if (typeof Mlbb !== 'undefined') Mlbb.onDamaged(this);
    if (src instanceof Hero && src.team !== this.team) {
      const prev = this.recentDmg.find(r => r.h === src && Game.time - r.t < 8);
      if (prev) { prev.amt = (prev.amt || 0) + dmg; prev.t = Game.time; }
      else {
        this.recentDmg = this.recentDmg.filter(r => Game.time - r.t < 8);
        this.recentDmg.push({ h: src, t: Game.time, amt: dmg });
      }
      this.pullMinionAggro(src);
    }
    if (this.isPlayer && dmg > this.maxHp * 0.08) Game.fx.shake(Math.min(9, dmg / this.maxHp * 40));
    // hero-on-hero hits warm the combat soundtrack; the heat cools on its own
    if (src instanceof Hero && (this.isPlayer || src.isPlayer)) {
      Game.combatHeat = Math.min(1, (Game.combatHeat || 0) + clamp(dmg / 220, 0.08, 0.28));
    }
  }

  die(src) {
    const bountyStreak = this.streak;
    const repeatedDeaths = this.deathStreak;
    this.alive = false;
    this.deaths++; this.deathStreak++; this.streak = 0;
    this.dashS = null; this.forced = null; this.recallT = 0; this.hot = null;
    this.cc.clear(); this.shields = []; this.dots = []; this.marks = {};
    this.runes = {};
    this.curTarget = null; this.aiTarget = null;
    this.fleeT = 0;
    this.adapt.caution = Math.min(0.2, this.adapt.caution + 0.05);
    this.respawnT = BALANCE.respawnTime(this.level, Game.time);
    Game.fx.death(this);
    Game.kills[1 - this.team]++;

    /* A turret or minion kill is credited to the enemy hero that hurt the
       victim most recently (within 8 s); with no hero involved the death is
       an execution and pays nothing. */
    let killer = (src instanceof Hero && src.team !== this.team) ? src : null;
    if (!killer) {
      let latest = -Infinity;
      for (const r of this.recentDmg) {
        if (r.h && r.h.alive !== undefined && r.h.team !== this.team && Game.time - r.t < 8 && r.t > latest) {
          latest = r.t; killer = r.h;
        }
      }
    }
    const xp = BALANCE.heroKillXp(this);
    if (killer) {
      killer.kills++; killer.streak++; killer.deathStreak = 0;
      killer.adapt.caution = Math.max(-0.06, killer.adapt.caution - 0.02);
      const killBase = BALANCE.heroKillGold(this);
      const repeatMult = Math.max(BALANCE.repeatDeathFloor,
        1 - repeatedDeaths * BALANCE.repeatDeathPenalty);
      const shutdown = BALANCE.shutdownGold(bountyStreak);
      killer.gainGold(killBase * repeatMult + shutdown);
      killer.fire('onKill', this);
      if (killer.emblem && killer.emblem.id === 'assassin') killer.heal(killer.maxHp * 0.12);
      let firstBloodNow = false;
      if (!Game.firstBlood) {
        Game.firstBlood = true; firstBloodNow = true;
        UI.announce(`🩸 FIRST BLOOD — ${killer.name}!`, 'major'); Game.fx.shake(8);
      }
      // multi-kill window is shared by every hero so bots announce Savage too
      if (Game.time - killer.lastKillT < 10) killer.comboKills++;
      else killer.comboKills = 1;
      killer.lastKillT = Game.time;
      if (killer.comboKills >= 2) {
        const names = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'MANIAC', 5: 'SAVAGE' };
        const label = names[Math.min(5, killer.comboKills)];
        UI.announce(`${killer.isPlayer ? '' : killer.name + ' — '}${label}!`, 'major');
        Game.fx.shake(6);
      }
      if (typeof Mlbb !== 'undefined')
        Mlbb.killSlogan(killer, this, { firstBlood: firstBloodNow, combo: killer.comboKills });
      else if (killer.isPlayer && killer.comboKills < 2) UI.announce('You have slain an enemy', 'kill');
      if (shutdown > 0) UI.announce(`💰 SHUTDOWN — ${killer.name} +${shutdown}`, 'major');
      if (killer.isPlayer) SFX.kill();
      /* Assists: everyone who damaged the victim in the last 8 s, plus any
         teammate close enough to have been part of the fight. The pool is
         60% of the kill base, split equally; kill XP is split between the
         killer and the assisters. */
      const assisters = this.recentDmg
        .filter(r => r.h !== killer && r.h.alive !== undefined && r.h.team === killer.team && Game.time - r.t < 8)
        .map(r => r.h);
      for (const h of Game.heroes) {
        if (h.team !== killer.team || h === killer || !h.alive || assisters.includes(h)) continue;
        if (dist(h, this) < BALANCE.assistRadius) assisters.push(h);
      }
      const assistShare = assisters.length ? killBase * BALANCE.assistShare / assisters.length : 0;
      const xpEach = xp / (1 + assisters.length);
      killer.gainXp(xpEach);
      for (const assister of assisters) {
        assister.assists++;
        assister.gainGold(assistShare);
        assister.gainXp(xpEach);
        assister.fire('onAssist', this);
      }
    } else {
      // executed: no gold anywhere, XP only to the enemies standing there
      for (const h of Game.heroes) {
        if (h.team !== this.team && h.alive && dist(h, this) < 700) h.gainXp(xp);
      }
    }
    const recapHits = this.recentDmg.slice();
    this.recentDmg = [];
    UI.killFeed(src, this);
    if (this.isPlayer) {
      this.deathRecap = {
        killer: (src instanceof Hero) ? src : null,
        by: (src instanceof Hero) ? src.name
          : (src && src.isStructure) ? (src.isBase ? 'the enemy base' : 'a turret')
          : (src && src.name) ? src.name
          : 'the battlefield',
        hits: recapHits.sort((a, b) => (b.amt || 0) - (a.amt || 0)),
      };
      UI.announce('You have been slain', 'death');
      SFX.death();
      Game.fx.shake(10);
      Game.hitStop = Math.max(Game.hitStop || 0, 0.09);
    }
    if (killer && killer.isPlayer) Game.hitStop = Math.max(Game.hitStop || 0, 0.07);
    if (Game.isDuel() && Game.state === 'play') {
      const need = Game.DUEL_TO;
      if (Game.kills[TEAM_BLUE] >= need) {
        UI.announce(`⚔ First to ${need}!`, 'major');
        Game.endGame(TEAM_BLUE);
      } else if (Game.kills[TEAM_RED] >= need) {
        UI.announce(`⚔ First to ${need}!`, 'major');
        Game.endGame(TEAM_RED);
      }
    }
  }

  /* Minion aggro rule: hitting a hero who is standing in their own wave
     turns that wave onto you. This is the single rule that makes trading
     under a wave costly, and it is why "attack the hero, not the minions"
     is a decision rather than a default. */
  pullMinionAggro(attacker) {
    for (const m of Game.minions) {
      if (!m.alive || m.team !== this.team) continue;
      if (dist(m, this) > 500) continue;
      if (dist(m, attacker) > 600) continue;
      m.target = attacker;
      m.retargetT = 3.0;              // hold the new target through a retarget tick
    }
  }

  /* The roamer, for the early minion-share rule: whoever carries a Roam item,
     or a bot assigned the roam position (bots do not reliably buy one). */
  isRoamer() {
    if (this.lane === 'roam') return true;
    for (const it of this.items) if (it && it.cat === 'Roam') return true;
    return false;
  }

  respawn() {
    this.recalcStats(true);
    this.alive = true;
    this.spawnProtT = BALANCE.spawnProtection;
    this.cc.clear();
    const b = Game.fountain(this.team);
    this.x = b.x + rand(-70, 70); this.y = b.y + rand(-70, 70);
    this.wpIdx = 0; this.aiState = 'push'; this.aiTarget = null; this.curTarget = null;
    this.nav.path.length = 0; this.nav.index = 0; this.nav.gx = this.nav.gy = NaN;
    this.nav.repath = 0; this.nav.stalled = 0; this.nav.lastD = Infinity;
    this.combatSide *= -1; this.combatPoint = null; this.combatPointT = 0;
    Game.fx.ring(this.x, this.y, 90, this.color, 0.6);
    if (typeof Features !== 'undefined') Features.onRespawn(this);
  }

  startRecall() {
    if (!this.alive || this.recallT > 0) return;
    if (Game.isDuel() || dist(this, Game.fountain(this.team)) < 350) return;
    this.recallT = BALANCE.recallTime || 6.0;
    this.arrivalT = 0; this.arrivalDest = null;
    Game.fx.ring(this.x, this.y, 70, THEME.blue, 0.5);
  }

  /* Nova: damage + CC everything in a radius. `rank` lets a nested sub-skill
     inherit the rank of the skill that spawned it. */
  doNova(s, rank) {
    const dmg = this.skillDmg(s, rank);
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (dist(this, u) <= s.radius + u.radius) {
        const dealt = resolveDamage(this, u, { amount: dmg, type: s.dmgType || 'physical', skill: s });
        applySkillCC(this, u, s);
        if (dealt) this.onSkillLanded(u, dealt, s);
      }
    }
  }

  castSkill(i, point) {
    const s = this.skills[i];
    if (!this.alive || this.skillCd[i] > 0 || this.mana < s.mana) return false;
    if (this.skillRank[i] < 1) return false;              // ultimate not learned yet
    if (!this.cc.canCast || this.dashS || this.forced) return false;
    this.recallT = 0;
    let dir;
    if (point && (point.x !== this.x || point.y !== this.y)) dir = norm(point.x - this.x, point.y - this.y);
    else dir = { x: Math.cos(this.facing), y: Math.sin(this.facing) };
    this.facing = Math.atan2(dir.y, dir.x);
    let castAt = null;

    switch (s.type) {
      case 'skillshot':
        Game.projectiles.push(Projectile.skillshot(this, s, dir));
        break;
      case 'nova':
        this.doNova(s);
        break;
      case 'dash': {
        if (s.buff) { this.buffAsMult = s.buff.asMult || 1; this.buffAsT = s.buff.dur || 3; }
        this.dashS = {
          dx: dir.x, dy: dir.y, remaining: s.dist, speed: s.speed,
          dmg: s.dmg ? this.skillDmg(s) : 0, hitSet: new Set(), s,
          stopOnHero: !!s.stopOnHero, endNova: s.endNova || null,
          rank: this.skillRank[i],
        };
        castAt = { x: this.x + dir.x * s.dist, y: this.y + dir.y * s.dist };
        break;
      }
      case 'zone': {
        let tx = point ? point.x : this.x + dir.x * s.range;
        let ty = point ? point.y : this.y + dir.y * s.range;
        const d = Math.hypot(tx - this.x, ty - this.y);
        if (d > s.range) { tx = this.x + (tx - this.x) / d * s.range; ty = this.y + (ty - this.y) / d * s.range; }
        Game.zones.push(new Zone(this, s, tx, ty));
        castAt = { x: tx, y: ty };
        break;
      }
      case 'heal': {
        const amt = this.skillHeal(s);
        for (const h of Game.heroes) {
          if (h.team === this.team && h.alive && dist(this, h) <= s.radius) {
            const healed = h.heal(amt);
            this.stats.healDone += healed;
            if (s.shieldPct) h.addShield(h.maxHp * s.shieldPct, 3);
            Game.fx.healFx(h, Math.round(amt));
            this.fire('onHealAlly', h, healed);
          }
        }
        Game.fx.ring(this.x, this.y, s.radius, THEME.heal, 0.5);
        break;
      }
      case 'blinkstrike': {
        let best = null, bd = Infinity;
        for (const u of Game.enemyUnits(this.team, { neutral: true })) {
          const dd = dist(this, u) + (u.type === 'hero' ? -150 : 0);
          if (dist(this, u) <= s.range && dd < bd && Game.canSee(this.team, u)) { bd = dd; best = u; }
        }
        if (!best) return false; // no target: don't consume
        const ang = Math.atan2(this.y - best.y, this.x - best.x);
        this.x = best.x + Math.cos(ang) * (best.radius + this.radius + 4);
        this.y = best.y + Math.sin(ang) * (best.radius + this.radius + 4);
        this.clampWorld();
        this.facing = Math.atan2(best.y - this.y, best.x - this.x);
        const dealt = resolveDamage(this, best, {
          amount: this.skillDmg(s), type: s.dmgType || 'physical', skill: s,
          pen: { pct: s.physPenPct || 0 },
        });
        applySkillCC(this, best, s);
        if (dealt) this.onSkillLanded(best, dealt, s);
        Game.fx.ring(this.x, this.y, 80, this.color, 0.35);
        Game.fx.slash(best.x, best.y, this.facing, this.team);
        break;
      }
      case 'buff': {
        if (s.atkMult) { this.buffAtkMult = s.atkMult; this.buffAtkT = s.dur; }
        if (s.spdAdd) this.addTimedBuff('speed', s.spdAdd, s.dur);
        if (s.tenacityAdd) this.addTimedBuff('tenacity', s.tenacityAdd, s.dur);
        if (s.hotPct) this.hot = { rate: this.maxHp * s.hotPct / s.dur, t: s.dur };
        Game.fx.ring(this.x, this.y, 100, this.color, 0.6);
        break;
      }
    }
    this.mana -= s.mana;
    this.skillCd[i] = this.cooldownFor(s);
    Game.fx.skillCast(this, s, castAt);
    if (this.isPlayer) {
      if (i === 2) SFX.ult(); else SFX.skill();
      Game.fx.skillRange(this, s, castAt);
    }
    if (i === 2) {
      Game.fx.shake(5);
      Game.fx.ultBlast(this);
    }
    return true;
  }

  update(dt) {
    // Baseline income keeps ticking through death. A death already costs lane
    // farm, XP and map pressure; also pausing passive gold made every respawn
    // timer a second hidden snowball multiplier.
    this.gainGold((BALANCE.passiveGoldPerSec + Game.comebackGoldRate(this.team)) * dt);
    if (!this.alive) {
      this.respawnT -= dt;
      // dead heroes are standing in the shop; let bots spend while they wait
      if (!this.isPlayer) {
        this.shopT -= dt;
        if (this.shopT <= 0) { this.shopT = 1.5; ItemAI.tryBuy(this); }
      }
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.baseUpdate(dt);
    for (let i = 0; i < 3; i++) if (this.skillCd[i] > 0) this.skillCd[i] -= dt;
    if (this.buffAtkT > 0) this.buffAtkT -= dt;
    if (this.buffAsT > 0) this.buffAsT -= dt;
    if (this.fleeT > 0) this.fleeT -= dt;
    if (this.spellCd > 0) this.spellCd -= dt;
    if (this.reflectT > 0) this.reflectT -= dt;
    if (this.spawnProtT > 0) this.spawnProtT -= dt;
    if (this.hot) { this.heal(this.hot.rate * dt); this.hot.t -= dt; if (this.hot.t <= 0) this.hot = null; }
    // the crab's Gold Buff: a trickle rather than a lump, so it is worth holding on to
    if (this.buffs.goldBuff && this.buffs.goldBuff.t > 0) this.gainGold(this.buffs.goldBuff.value * dt);

    // bots shop whenever they are home with gold to spend
    if (!this.isPlayer) {
      this.shopT -= dt;
      if (this.shopT <= 0) { this.shopT = 1.5; ItemAI.tryBuy(this); }
    }

    // timed named buffs and runes
    let buffChanged = false;
    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (b && b.t > 0) { b.t -= dt; if (b.t <= 0) buffChanged = true; }
    }
    for (const k in this.runes) {
      if (this.runes[k] > 0) { this.runes[k] -= dt; if (this.runes[k] <= 0) buffChanged = true; }
    }

    // dynamic passives (Grom's resists, Torren's lifesteal) need a periodic
    // rebuild; 0.2s is well under a fight's decision cadence and costs nothing
    this.statT -= dt;
    if (this.statT <= 0 || buffChanged) { this.statT = 0.2; this.recalcStats(false); }
    this.fire('tick', dt);

    // passive regen + income
    this.heal((this.maxHp * BALANCE.hpRegenPct + this.attrs.get('hpRegen')) * dt);
    this.mana = Math.min(this.maxMana,
      this.mana + (this.maxMana * BALANCE.manaRegenPct + this.attrs.get('manaRegen')) * dt);
    this.gainXp(BALANCE.passiveXpPerSec * dt);

    // hook drag overrides everything
    if (this.forced) {
      const f = this.forced; f.t -= dt;
      const d = dist(this, f.src);
      if (d > 80 && f.t > 0 && f.src.alive) {
        const dir = norm(f.src.x - this.x, f.src.y - this.y);
        this.x += dir.x * 1100 * dt; this.y += dir.y * 1100 * dt;
        this.clampWorld();
      } else this.forced = null;
      this.trackVelocity(dt);
      return;
    }
    // active dash
    if (this.dashS) {
      const d = this.dashS;
      const step = Math.min(d.remaining, d.speed * dt);
      this.x += d.dx * step; this.y += d.dy * step;
      d.remaining -= step;
      this.facing = Math.atan2(d.dy, d.dx);
      this.clampWorld();
      // afterimage every ~45 world units so a dash reads as a trail, not a teleport
      d._trail = (d._trail || 0) + step;
      if (d._trail > 45) {
        d._trail = 0;
        Game.fx.push({
          kind: 'ghost', x: this.x, y: this.y,
          r: this.radius,
          shape: typeof ROLE_SHAPE !== 'undefined' ? (ROLE_SHAPE[this.def0.role] || 'circle') : 'circle',
          color: this.color || TEAM_COLORS[this.team],
          dur: 0.28, age: 0,
        });
      }
      if (d.dmg) {
        for (const u of Game.enemyUnits(this.team, { neutral: true })) {
          if (!d.hitSet.has(u) && dist(this, u) < 70 + u.radius) {
            d.hitSet.add(u);
            const dealt = resolveDamage(this, u, { amount: d.dmg, type: d.s.dmgType || 'physical', skill: d.s });
            applySkillCC(this, u, d.s);
            if (dealt) this.onSkillLanded(u, dealt, d.s);
            if (d.stopOnHero && u.type === 'hero') d.remaining = 0;
          }
        }
      }
      if (d.remaining <= 0.5) {
        if (d.endNova) { this.doNova(d.endNova, d.rank); Game.fx.skillCast(this, d.endNova, null); }
        this.dashS = null;
      }
      this.trackVelocity(dt);
      return;
    }
    // recall / Arrival channel
    if (this.recallT > 0 || this.arrivalT > 0) {
      if (this.isPlayer && Input.moveVector()) {
        this.recallT = 0; this.arrivalT = 0; this.arrivalDest = null;
        return;
      }
      if (this.recallT > 0) {
        this.recallT -= dt;
        if (this.recallT <= 0) {
          const b = Game.fountain(this.team);
          Game.fx.ring(this.x, this.y, 80, THEME.blue, 0.5);
          this.x = b.x + rand(-60, 60); this.y = b.y + rand(-60, 60);
          Game.fx.ring(this.x, this.y, 90, THEME.blue, 0.6);
          this.wpIdx = 0;
          this.nav.path.length = 0; this.nav.index = 0; this.nav.gx = this.nav.gy = NaN;
        }
      }
      this.trackVelocity(dt);
      return;
    }

    if (!this.cc.canAct) {
      if (!this.isPlayer && this.spell && this.spell.id === 'purify' && this.spellCd <= 0 &&
          this.cc.dominant !== 'slow') this.castSpell(null);
      this.trackVelocity(dt); return;
    }
    if (this.isPlayer && this.aiTakeover) {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        this.aiTimer = 0.12 + rand(0, 0.08);
        this.botThink();
      }
      this.botControl(dt);
    } else if (this.isPlayer) this.playerControl(dt);
    else {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        const hot = !!(this.aiTarget && this.aiTarget.type === 'hero') || this.fleeT > 0 ||
          this.aiState === 'retreat';
        this.aiTimer = hot ? 0.06 + rand(0, 0.04) : 0.12 + rand(0, 0.08);
        this.botThink();
      }
      this.botControl(dt);
      if (this.attackOnMove && this.atkCd <= 0) this.opportunityAttack();
    }
    this.trackVelocity(dt);
  }

  opportunityAttack() {
    let best = null, bd = Infinity;
    const reach = this.range + this.radius;
    /* runs every frame for every bot: walk the three lists in enemyUnits'
       order without building the combined array */
    const x = this.x, y = this.y;
    const consider = u => {
      /* squared pre-filter: units clearly out of reach skip the sqrt; anything
         near the boundary still gets the original distance test */
      const dx = u.x - x, dy = u.y - y, r = reach + u.radius;
      if (dx * dx + dy * dy > r * r * 1.000001) return;
      const d = this.distTo(u);
      if (d > r) return;
      if (!Game.canSee(this.team, u)) return;
      const score = d - (u.type === 'hero' ? 220 : 0) -
        (u.type === 'minion' && Game.canLastHit(this, u) ? 160 : 0);
      if (score < bd) { bd = score; best = u; }
    };
    for (const h of Game.heroes) if (h.team !== this.team && h.alive) consider(h);
    for (const m of Game.minions) if (m.team !== this.team && m.alive) consider(m);
    for (const t of Game.structures()) if (t.team !== this.team && t.alive) consider(t);
    if (best) this.tryAttack(best);
  }

  /* ---------- player control ---------- */
  playerControl(dt) {
    while (Input.casts.length) {
      const c = Input.casts.shift();
      const s = this.skills[c.skill];
      if (!s) continue;
      let point = null;
      if (c.dir) {
        const maxR = s.range || s.dist || 500;
        const fr = c.dist ? clamp((c.dist - 20) / 70, 0.3, 1) : 1;
        point = { x: this.x + c.dir.x * maxR * (s.type === 'zone' ? fr : 1), y: this.y + c.dir.y * maxR * (s.type === 'zone' ? fr : 1) };
      } else {
        point = Game.autoAimPoint(this, s);
      }
      this.castSkill(c.skill, point);
    }
    if (Input.recallQueued) { Input.recallQueued = false; this.startRecall(); }
    if (Input.spellQueued) {
      const c = Input.spellQueued;
      Input.spellQueued = null;
      // Flicker uses an explicitly aimed point; target/self spells safely ignore it.
      const aimR = (this.spell && this.spell.aimRange) || 420;
      const point = c.dir
        ? { x: this.x + c.dir.x * aimR, y: this.y + c.dir.y * aimR }
        : Game.autoAimPoint(this, { range: aimR });
      this.castSpell(point);
    }

    const mv = Input.moveVector();
    if (typeof Features !== 'undefined' && Features.halted) {
      Features.halted = false;
      this.curTarget = null;
      this.trackVelocity(dt);
      return;
    }
    if (this.recallT > 0) { if (mv) this.recallT = 0; else return; }
    if (mv) {
      this.moveToward(this.x + mv.x * 200, this.y + mv.y * 200, dt);
      if (!Input.attackHeld) this.curTarget = null;
    }
    if (Input.attackHeld) Game.fx.attackRange(this);
    const amove = typeof Features !== 'undefined' && Features.attackMove;
    const aa = typeof Features === 'undefined' || Features.prefs.autoAttack !== false;
    const wantAttack = Input.attackHeld || (!mv && aa) || amove;
    if (!wantAttack) return;
    const mode = Input.attackHeld ? Input.attackMode : 'auto';
    /* Attack buttons and keys stand and swing. Only Q (attack-move) walks
       into range; WASD still moves on its own. */
    const inPlace = !amove;
    const maxAcq = inPlace ? (this.range + this.radius + 8)
      : ((Input.attackHeld || amove) ? 750 : this.range + this.radius + 60);
    const lockRange = inPlace ? maxAcq : (Input.attackHeld ? 1400 : maxAcq);
    const aim = inPlace ? null : (typeof Input.aimPoint === 'function' ? Input.aimPoint() : null);
    const locked = !inPlace && mode !== 'lane' && Game.validLockedTarget(this, Input.lockedTarget, lockRange)
      ? Input.lockedTarget : null;
    // Mouse aim re-picks every frame so the attack follows the cursor.
    // Touch / no-cursor keeps the previous sticky lock while attack-moving.
    let t = locked || (aim ? null : this.curTarget);
    if (!t || !t.alive || !Game.targetMatchesMode(t, mode) || !Game.canSee(this.team, t) ||
        this.distTo(t) > (locked ? lockRange : maxAcq) + t.radius ||
        (Input.lockedTarget && mode !== 'lane' && t !== Input.lockedTarget)) {
      t = locked || Game.acquireTarget(this, maxAcq, mode, Input.targetPriority, aim);
    }
    this.curTarget = t;
    if (t) {
      if (this.inAttackRange(t)) this.tryAttack(t);
      else if (!inPlace && (Input.attackHeld || amove) && !mv) this.moveToward(t.x, t.y, dt);
    }
  }

  /* ---------- bot AI (unchanged decision logic; see bot-params.js) ---------- */
  botThink() {
    if (!Recorder.enabled) { this.runThink(); return; }
    const snap = Recorder.snapshot(this);
    this.runThink();
    Recorder.commit(this, snap);
  }
  runThink() {
    if (this.botType === 'neural') this.neuralThink();
    else this.heuristicThink();
  }

  neuralThink() {
    if (this.heuristicStateStep()) return;
    const pick = NeuralController.selectTarget(this);
    if (pick === undefined) {
      const best = this.heuristicSelectTarget();
      this.aiTarget = best;
      if (best) this.botCast(best);
      return;
    }
    this.aiTarget = pick;
    if (pick) this.botCast(pick);
  }

  heuristicThink() {
    if (this.heuristicStateStep()) return;
    const best = this.heuristicSelectTarget();
    this.aiTarget = best;
    if (best) this.botCast(best);
  }

  /* Tried and rejected: a "botIdleCast" that let a bot with no target still
     heal a hurt ally and use a target-free battle spell. It fired as designed
     (heals per minute 3.2 -> 4.1 on one seed) but bought nothing — deaths per
     minute came out slightly WORSE on both seeds tested, and matches ran
     longer. Kept here as a note so the same idea is not re-derived and
     re-shipped on the strength of how sensible it sounds. */

  /* A compact, explainable estimate used for both skirmishes and objective
     contests. It deliberately reads only visible enemies, so smarter bots do
     not become map-hacking bots. Health matters most; levels, gear and ready
     skills break otherwise even comparisons. */
  botStrength(h) {
    const health = clamp(h.hpPct, 0.08, 1);
    const level = 0.72 + h.level * 0.05;
    const gear = 1 + h.items.length * 0.08;
    let ready = 0;
    for (let i = 0; i < 3; i++) if (h.skillRank[i] > 0 && h.skillCd[i] <= 0 && h.mana >= h.skills[i].mana) ready++;
    return health * level * gear * (0.9 + ready * 0.06);
  }

  localFightPower(x = this.x, y = this.y, radius = this.p.fightRadius) {
    const out = { allies: 0, enemies: 0, allyPower: 0, enemyPower: 0 };
    for (const h of Game.heroes) {
      if (!h.alive || hyp(h.x - x, h.y - y) > radius) continue;
      if (h.team === this.team) { out.allies++; out.allyPower += this.botStrength(h); }
      else if (Game.canSee(this.team, h)) { out.enemies++; out.enemyPower += this.botStrength(h); }
    }
    return out;
  }

  enemyTowerCovering(u) {
    return Game.structures().find(s => s.alive && s.team !== this.team &&
      (s.type === 'tower' || s.isBase) && dist(s, u) < s.range + 65) || null;
  }

  hasMinionCover(s) {
    return Game.minions.some(m => m.team === this.team && m.alive && dist(m, s) < 330);
  }

  /* Burst estimate used to decide "stay and finish" vs "walk away". Skills
     that are still on cooldown do not count; a bot that pretends it has its
     ult ready will dive and die. */
  botBurstVs(u) {
    if (!u || !u.alive) return 0;
    const auto = Game.basicAttackDamage(this, u);
    let burst = auto * (this.ranged ? 2.1 : 1.6);
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (!s || this.skillRank[i] < 1 || this.skillCd[i] > 0 || this.mana < s.mana) continue;
      burst += this.skillDmg(s, this.skillRank[i]) || auto;
    }
    if (this.spell && this.spellCd <= 0) {
      if (this.spell.id === 'execute' && u.type === 'hero') burst += 120 + (u.maxHp - u.hp) * 0.12;
      if (this.spell.id === 'retribution' && u.type === 'monster') burst += u.epic ? 800 : 500;
    }
    return burst;
  }

  botCanKill(u) {
    return !!(u && u.type === 'hero' && u.alive && u.hp <= this.botBurstVs(u) * 1.12);
  }

  /* Walk to where they will be, not where they are. A fleeing marksman is
     already 200 units further along their path by the time a melee bot arrives. */
  interceptPoint(u) {
    const vx = u.vx || 0, vy = u.vy || 0;
    if (Math.hypot(vx, vy) < 50) return { x: u.x, y: u.y };
    const eta = clamp(dist(this, u) / Math.max(this.curSpeed(), 80), 0, 0.9);
    return { x: u.x + vx * eta, y: u.y + vy * eta };
  }

  isolatedEnemy(radius = 980) {
    let pick = null, best = -Infinity;
    const home = Game.basePoint(this.team), enemyBase = Game.basePoint(1 - this.team);
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || !Game.canSee(this.team, h)) continue;
      const d = dist(this, h);
      if (d > radius) continue;
      let friends = 0;
      for (const a of Game.heroes) {
        if (a === h || a.team !== h.team || !a.alive) continue;
        if (dist(a, h) < 620) friends++;
      }
      if (friends > 0) continue;
      const overextend = dist(h, enemyBase) < dist(h, home) * 0.88 ? 150 : 0;
      const score = (1 - h.hpPct) * 400 + (this.botCanKill(h) ? 260 : 0) + overextend - d * 0.12;
      if (score > best) { best = score; pick = h; }
    }
    return pick;
  }

  recallingEnemy() {
    let best = null, bd = Infinity;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || h.recallT <= 0) continue;
      if (!Game.canSee(this.team, h)) continue;
      const d = dist(this, h);
      if (d < bd && d < 1400) { bd = d; best = h; }
    }
    return best;
  }

  alliedTowerInTrouble() {
    if (Game.isDuel()) return null;
    /* the pressure on every structure is the same for all ten bots: measured
       once per frame, not once per bot */
    if (Game._heatT !== Game.time) {
      Game._heatT = Game.time; Game._heat = Game._heat || new Map(); Game._heat.clear();
      for (const s of Game.structures()) {
        if (!s.alive) continue;
        let heat = 0;
        const hr = (s.range || 400) + 90, hr2 = hr * hr;
        for (const h of Game.heroes) {
          if (h.team === s.team || !h.alive) continue;
          const dx = h.x - s.x, dy = h.y - s.y;
          if (dx * dx + dy * dy < hr2) heat += 3;
        }
        Game._heat.set(s, heat);
      }
      /* minion pressure: each minion can only be near the few structures its
         grid cell lists, rather than every structure testing every minion */
      const useGrid = !Game.isDuel() && !Game.isTen();
      for (const m of Game.minions) {
        if (!m.alive) continue;
        const near = useGrid ? Game.structuresNear(m.x, m.y, Game.STRUCT_HEAT_PAD) : Game.structures();
        for (let k = 0; k < near.length; k++) {
          const s = near[k];
          if (!s.alive || m.team === s.team) continue;
          const dx = m.x - s.x, dy = m.y - s.y;
          if (dx * dx + dy * dy < 280 * 280) Game._heat.set(s, Game._heat.get(s) + 1);
        }
      }
    }
    let best = null, bd = Infinity;
    for (const s of Game.structures()) {
      if (!s.alive || s.team !== this.team) continue;
      const heat = Game._heat.get(s) || 0;
      if (heat < 2 && s.hpPct > 0.72) continue;
      if (heat < 1) continue;
      const d = dist(this, s);
      if (d < 2000 && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  lastSeenHunt() {
    if (typeof Features === 'undefined' || Game.isDuel()) return null;
    const role = this.botRole();
    if (role !== 'Assassin' && this.lane !== 'jungle' && this.lane !== 'roam') return null;
    if (this.hpPct < 0.5) return null;
    let best = null, bestScore = -Infinity;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive) continue;
      if (Game.canSee(this.team, h)) continue;
      const seen = Features.lastSeen.get(h);
      if (!seen) continue;
      const age = Game.time - seen.t;
      if (age < 1.2 || age > 7) continue;
      const d = Math.hypot(this.x - seen.x, this.y - seen.y);
      if (d > 1100) continue;
      const score = (1 - h.hpPct) * 180 - d * 0.1 - age * 12;
      if (score > bestScore) { bestScore = score; best = seen; }
    }
    return best;
  }

  botTargetSafe(u) {
    if (u.isStructure && u.shieldedByOuter) return false;   // immune while the tier in front stands
    if (!this.advancedAI) return true;
    const tower = this.enemyTowerCovering(u);
    if (!tower || this.hasMinionCover(tower)) return true;
    if (u.isStructure) return false;
    if (u.type === 'hero' && (u.hpPct < 0.18 || this.botCanKill(u)) && this.hpPct > 0.55) {
      const f = this.localFightPower(u.x, u.y, 460);
      return f.enemies <= 2 && f.enemyPower < f.allyPower * 1.15;
    }
    return false;
  }

  shouldEconomyRecall() {
    if (!this.advancedAI || Game.isDuel() || Game.time < 45 || this.items.length >= ITEM_SLOTS ||
        dist(this, Game.fountain(this.team)) < 420) return false;
    for (const h of Game.heroes) {
      if (h.team !== this.team && h.alive && Game.canSee(this.team, h) && dist(this, h) < this.p.recallSafeDist) return false;
    }
    if (this.recentDmg.some(r => Game.time - r.t < 4)) return false;
    // Do not abandon a live contest just because an item became affordable.
    if (Game.monsters.some(m => m.epic && m.alive && m.hpPct < 0.95 && dist(this, m) < this.p.objectiveRange)) return false;
    if (this.lane === 'jungle' && this.aiTarget && this.aiTarget.type === 'monster' && this.aiTarget.alive)
      return false;
    const next = ItemAI.recommend(this);
    const canFinishItem = next && this.gold >= Math.max(this.p.shopRecallMinGold, next.cost);
    const lowMana = this.maxMana > 0 && this.mana / this.maxMana < this.p.manaRecallPct && this.hpPct < 0.9;
    return canFinishItem || lowMana;
  }

  lowestHealTarget(radius) {
    let best = null, hp = 1;
    for (const h of Game.heroes) {
      if (h.team !== this.team || !h.alive || dist(this, h) > radius) continue;
      if (h.hpPct < hp) { hp = h.hpPct; best = h; }
    }
    return best;
  }

  botRole() { return (this.def0 && this.def0.role) || ''; }

  skillHasHardCC(s) {
    return !!(s && (s.stun || s.immobilize || s.airborne || s.silence || s.hook || s.suppress));
  }

  unitLockedDown(u) {
    return !!(u && u.cc && (!u.cc.canMove || !u.cc.canAct));
  }

  /* Dashes and blinks that land under an uncovered turret, or into a lost
     1v3, are how assassins and marksmen donate kills. Tanks may still go. */
  gapCloseLegal(t) {
    if (!t) return false;
    const tower = this.enemyTowerCovering(t);
    if (tower && !this.hasMinionCover(tower) && this.hpPct < 0.88 && !this.botCanKill(t)) return false;
    const role = this.botRole();
    if (role === 'Tank' || role === 'Fighter') return true;
    if (this.botCanKill(t) && this.hpPct > 0.32) return true;
    const f = this.localFightPower(t.x, t.y, 420);
    if (f.enemies >= 3 && this.hpPct < 0.75) return false;
    if (f.enemyPower > f.allyPower * 1.35 && this.hpPct < 0.7) return false;
    return true;
  }

  /* Between camps the jungler used to walk to whoever was labelled `mid`.
     10v10 has no mid lane, so that was a freeze. Shadow the laner who is
     actually under pressure — or the nearest living laner. */
  shadowAlly() {
    const allies = Game.heroes.filter(h => h !== this && h.team === this.team && h.alive);
    if (!allies.length) return null;
    let best = null, bestScore = -Infinity;
    for (const ally of allies) {
      if (ally.lane === 'jungle') continue;
      let threats = 0;
      for (const foe of Game.heroes) {
        if (foe.team === this.team || !foe.alive || !Game.canSee(this.team, foe)) continue;
        if (dist(ally, foe) < 680) threats++;
      }
      let score = threats * 420 - dist(this, ally) * 0.12;
      if (ally.lane === 'roam') score -= 40;
      if (ally.hpPct < 0.55) score += 90;
      if (score > bestScore) { bestScore = score; best = ally; }
    }
    return best || allies[0];
  }

  nearbySkirmish() {
    const p = this.p;
    const reach = p.collapseRange || 860;
    let best = null, bestScore = -Infinity;
    for (const ally of Game.heroes) {
      if (ally === this || ally.team !== this.team || !ally.alive) continue;
      const foe = ally.aiTarget;
      if (!foe || foe.type !== 'hero' || !foe.alive || !Game.canSee(this.team, foe)) continue;
      const d = dist(this, foe);
      if (d > reach || d < 160) continue;
      const score = (1 - foe.hpPct) * 200 + (1 - ally.hpPct) * 140 - d * 0.08;
      if (score > bestScore) { bestScore = score; best = foe; }
    }
    return best;
  }

  shouldRotateTo(fight) {
    if (!fight || !fight.alive) return false;
    if (this.lane === 'jungle') {
      // Opening clear beats a screen-away skirmish on the bigger board.
      if (Game.time < 80 && dist(this, fight) > 560 && !this.botCanKill(fight)) return false;
      return true;
    }
    if (this.lane === 'roam') return true;
    if (Game.time > (this.p.groupAfterMin || 12) * 60) return true;
    if (Game.time < 90) return false;
    const wave = this.laneWaveAnchor();
    if (!wave) return dist(this, fight) < 720;
    const home = Game.basePoint(this.team);
    const enemyBase = Game.basePoint(1 - this.team);
    const pushed = dist(wave, enemyBase) < dist(wave, home);
    return pushed && dist(this, fight) < 1100;
  }

  /* Position-specific macro. A jungler needs a route that exists even when no
     camp happens to be inside the ordinary 420-unit idle radius; otherwise
     "jungle" is only a draft label and the fifth hero returns to lane. */
  pickJungleCamp() {
    if (this.lane !== 'jungle' || this.hpPct < this.p.campHp) return null;
    const ownBase = Game.basePoint(this.team), enemyBase = Game.basePoint(1 - this.team);
    const own = [], enemy = [];
    for (const mo of Game.monsters) {
      if (!mo.alive || mo.epic) continue;
      const home = mo.home || mo;
      if (dist(home, ownBase) <= dist(home, enemyBase)) own.push(mo);
      else enemy.push(mo);
    }
    // Finish our jungle before invading. Counter-jungle only when the loop is
    // empty or the game is already mid.
    const pool = (own.length && Game.time < 240) ? own : own.concat(enemy);
    if (!pool.length) return null;
    const focus = this.jungleFocus;
    if (focus && dist(this, focus) > 1600) this.jungleFocus = null;
    const hasMajor = (this.runes.blueBuff || 0) > 0 || (this.runes.redBuff || 0) > 0;
    const opening = Game.time < 80 && !hasMajor;
    let best = null, bestScore = Infinity;
    for (const mo of pool) {
      const home = mo.home || mo;
      const ownSide = dist(home, ownBase) <= dist(home, enemyBase);
      if (!ownSide && Game.time < 180) continue;
      let score = dist(this, mo);
      if (this.jungleFocus) score += dist(home, this.jungleFocus) * 0.6;
      const major = mo.kind === 'blueBuff' || mo.kind === 'redBuff';
      if (opening && major) score -= 480;
      else if (major && !hasMajor) score -= 260;
      else if (major) score -= 80;
      else if (mo.kind === 'litho') score -= 30;
      if (mo.hpPct < 0.85) score -= 110;
      if (!ownSide) score += 820;
      const f = this.localFightPower(home.x, home.y, 500);
      if (f.enemies > 0 && f.enemyPower > f.allyPower * 1.2 && mo.hpPct > 0.45) score += 640;
      if (score < bestScore) { bestScore = score; best = mo; }
    }
    if (best) {
      const h = best.home || best;
      this.jungleFocus = { x: h.x, y: h.y };
    }
    return best;
  }

  /* The roamer cycles between lanes when the map is calm and immediately
     abandons that cycle for an ally who is wounded or visibly outnumbered. */
  roamAnchor() {
    if (this.lane !== 'roam') return null;
    const allies = Game.heroes.filter(h => h !== this && h.team === this.team && h.alive);
    if (!allies.length) return null;
    let urgent = null, urgentScore = 0;
    for (const ally of allies) {
      let threats = 0;
      for (const foe of Game.heroes) {
        if (foe.team === this.team || !foe.alive || !Game.canSee(this.team, foe)) continue;
        if (dist(ally, foe) < 650) threats++;
      }
      const score = threats * 1000 + (1 - ally.hpPct) * 500 - dist(this, ally) * 0.04;
      if (score > urgentScore) { urgentScore = score; urgent = ally; }
    }
    if (urgent) return urgent;
    const lane = (Game.pushLanes())[Math.floor(Game.time / 40) % Game.pushLanes().length];
    return allies.find(h => h.lane === lane) || allies.reduce((a, h) => dist(this, h) < dist(this, a) ? h : a);
  }

  heuristicStateStep() {
    const p = this.p;
    const retreatAt = clamp(p.retreatHp + this.adapt.caution, 0.08, 0.6);
    const nearest = (() => {
      let n = null, bd = Infinity;
      for (const h of Game.heroes) {
        if (h.team === this.team || !h.alive || !Game.canSee(this.team, h)) continue;
        const d = dist(this, h);
        if (d < bd) { bd = d; n = h; }
      }
      return n;
    })();
    const finishing = nearest && this.botCanKill(nearest) && dist(this, nearest) < 620;

    if (this.aiState === 'retreat') {
      if (this.hpPct > p.reengageHp || finishing) this.aiState = 'push';
    } else if (this.hpPct < retreatAt && !finishing) {
      const wasPushing = this.aiState !== 'retreat';
      this.aiState = 'retreat'; this.aiTarget = null;
      const danger = Game.heroes.some(h => h.team !== this.team && h.alive && dist(this, h) < p.recallSafeDist);
      if (wasPushing && Math.random() < 0.5) {
        Game.ping(danger ? 'help' : 'retreat', this.x, this.y, this);
      }
      if (!danger) this.startRecall();
      this.botEscapeCast();
      return true;
    }
    if (this.aiState === 'retreat' && !finishing) { this.botEscapeCast(); return true; }

    if (this.fleeT > 0 && !finishing) { this.aiTarget = null; this.botEscapeCast(); return true; }
    if (finishing) this.fleeT = 0;

    if (this.advancedAI) {
      const f = this.localFightPower();
      if (!finishing && f.enemies > 0 && f.enemyPower > f.allyPower * p.fightPowerRatio && this.hpPct < 0.82) {
        this.fleeT = 2.4; this.aiTarget = null; this.botEscapeCast();
        if (Math.random() < 0.35) Game.ping('retreat', this.x, this.y, this);
        return true;
      }
      // won the fight: cash the gold and reset instead of lingering at 40%
      if (this.shouldEconomyRecall() ||
          (Game.time - (this.lastKillT || -99) < 5 && this.hpPct < 0.52 && this.hpPct > 0.22 &&
           f.enemies === 0 && dist(this, Game.fountain(this.team)) > 520)) {
        this.aiTarget = null; this.startRecall();
        return this.recallT > 0;
      }
    } else if (p.outnumberMargin < 3.9 && !finishing) {
      let e = 0, a = 0;
      for (const h of Game.heroes) {
        if (!h.alive || dist(this, h) > 620) continue;
        if (h.team === this.team) a++; else e++;
      }
      if (e - a >= Math.round(p.outnumberMargin)) { this.fleeT = 3; this.aiTarget = null; return true; }
    }
    return false;
  }

  heuristicSelectTarget() {
    const p = this.p;
    const role = this.botRole();
    const notice = p.acquireRange;
    const collapse = p.collapseRange || 860;
    let best = null, bestScore = Infinity;
    for (const u of Game.enemyUnits(this.team, { structures: true })) {
      const d = dist(this, u);
      if (d > collapse) continue;
      if (!Game.canSee(this.team, u)) continue;
      if (!this.botTargetSafe(u)) continue;
      if (d > notice) {
        /* Join a fight an ally is already in, but do not wander off a last-hit
           to a hero nobody is contesting — unless they are isolated, recalling,
           or already dead-to-burst. */
        if (u.type !== 'hero') continue;
        const helping = Game.heroes.some(h => h !== this && h.team === this.team && h.alive &&
          (h.aiTarget === u || dist(h, u) < 380));
        const juicy = u.recallT > 0 || this.botCanKill(u) || u.hpPct < 0.28;
        let alone = true;
        for (const a of Game.heroes) {
          if (a === u || a.team !== u.team || !a.alive) continue;
          if (dist(a, u) < 580) { alone = false; break; }
        }
        const roam = this.lane === 'jungle' || this.lane === 'roam' || Game.time > (p.groupAfterMin || 8) * 60;
        if (!helping && !juicy && !(alone && roam)) continue;
      }
      let score = d;
      if (d > notice) score += (d - notice) * 1.15;
      if (u.type === 'hero') {
        score -= p.heroBias + (1 - u.hpPct) * p.lowHpBias;
        if (this.advancedAI) {
          const hit = Game.basicAttackDamage(this, u);
          if (u.hp <= hit * 2) score -= p.killBias;
          if (this.botCanKill(u)) score -= p.killBias * 0.7;
          const focusers = Game.heroes.filter(h => h !== this && h.team === this.team && h.alive &&
            h.aiTarget === u && dist(h, u) < p.chaseRange).length;
          score -= focusers * p.focusBias;
          if (this.recentDmg.some(r => r.h === u && Game.time - r.t < 4)) score -= 55;
          if (u.recallT > 0) score -= (p.recallPunish || 280);
          let friends = 0;
          for (const a of Game.heroes) {
            if (a === u || a.team !== u.team || !a.alive) continue;
            if (dist(a, u) < 580) friends++;
          }
          if (friends === 0) score -= (p.isolateBias || 220);
          if (role === 'Tank' || role === 'Support' || role === 'Fighter') {
            for (const ally of Game.heroes) {
              if (ally === this || ally.team !== this.team || !ally.alive || ally.hpPct > 0.58) continue;
              if (ally.recentDmg.some(r => r.h === u && Game.time - r.t < 3)) score -= (p.peelBias || 95);
            }
          }
          if (role === 'Assassin' || role === 'Marksman' || role === 'Mage') {
            const squish = u.def0 && (u.def0.role === 'Marksman' || u.def0.role === 'Mage' ||
              u.def0.role === 'Support' || u.def0.role === 'Assassin');
            if (squish) score -= (p.squishBias || 45);
            if (role === 'Assassin' && u.hpPct < 0.38) score -= 55;
          }
          if (this.unitLockedDown(u)) score -= 40;
          const ourTower = Game.structures().find(s => s.alive && s.team === this.team &&
            dist(u, s) < (s.range || 400) + 40);
          if (ourTower) score -= (p.siegeBias || 190);
        }
      }
      if (this.advancedAI && u.type === 'minion' && Game.canLastHit(this, u)) score -= p.lastHitBias;
      if (u.isStructure) score += p.structPenalty;
      if (this.advancedAI && u === this.aiTarget) score -= p.stickyBias;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    if (best && best.isStructure) {
      const cover = Game.minions.some(m => m.team === this.team && m.alive && dist(m, best) < 320);
      if (!cover && (this.advancedAI || this.hpPct < clamp(p.diveHp + this.adapt.caution, 0.4, 1))) best = null;
    }

    if (this.lane === 'jungle' && Game.time < 80 && best && best.type === 'hero' &&
        dist(this, best) > 560 && !this.botCanKill(best)) {
      best = null;
    }

    const punish = this.recallingEnemy();
    if (punish && this.botTargetSafe(punish) && (!best || best.type !== 'hero' || best.hpPct > 0.22))
      return punish;

    /* Epic objectives outrank a lane target. A bot that keeps farming its
       wave while the Lord is up loses the game in a way no amount of good
       laning recovers from, so this check comes before the idle fallbacks
       and can override a minion or structure pick — but never a hero, since
       being caught mid-objective is exactly how teams throw. */
    const epic = this.pickEpicTarget();
    if (epic && (!best || best.type !== 'hero')) return epic;

    // A designated jungler clears a real route rather than waiting until it
    // accidentally walks within lane-bot camp range.
    if (this.lane === 'jungle' && (!best || best.type !== 'hero')) {
      const sticky = this.aiTarget && this.aiTarget.type === 'monster' && this.aiTarget.alive &&
        !this.aiTarget.epic && dist(this, this.aiTarget) < 460;
      const camp = sticky ? this.aiTarget : this.pickJungleCamp();
      if (camp) return camp;
    }

    /* Buff camps when there is nothing to fight. Distinct from the nearby
       jungleRange farm below — this one only takes camps that grant a rune,
       and laners only walk if the buff is actually next to them. */
    if (!best && this.hpPct > p.campHp) {
      let bd = this.lane === 'jungle' ? Infinity : p.campRange;
      for (const mo of Game.monsters) {
        if (!mo.alive || mo.epic || (mo.kind !== 'blueBuff' && mo.kind !== 'redBuff')) continue;
        const d = dist(this, mo);
        if (d < bd) { bd = d; best = mo; }
      }
    }
    if (!best && p.jungleRange > 80 && this.hpPct > 0.6 && this.lane !== 'jungle') {
      let bd = p.jungleRange;
      for (const mo of Game.monsters) {
        if (!mo.alive || mo.epic) continue;
        const d = dist(this, mo);
        if (d < bd) { bd = d; best = mo; }
      }
    }
    return best;
  }

  /* Should this bot be hitting Turtle/Lord right now? */
  pickEpicTarget() {
    const p = this.p;
    for (const mo of Game.monsters) {
      if (!mo.epic || !mo.alive) continue;
      const d = dist(this, mo);
      if (d > p.objectiveRange) continue;
      /* Commitment. Starting an epic needs a healthy bar, but once the pit
         is already contested, backing off at the first hit just hands the
         objective back at full health — the monster leash-heals. So the
         threshold drops sharply for a fight that is already underway. */
      const engaged = mo.hpPct < 0.9;
      const need = (engaged ? p.objectiveCommitHp : p.objectiveHp) + this.adapt.caution;
      if (this.hpPct < need) continue;
      // don't solo an epic: count teammates who are also close enough to help
      let allies = 0;
      for (const h of Game.heroes) {
        if (h === this || h.team !== this.team || !h.alive) continue;
        if (dist(h, mo) < p.objectiveRange) allies++;
      }
      if (allies < p.objectiveMinAllies) continue;
      if (this.advancedAI) {
        const f = this.localFightPower(mo.x, mo.y, p.objectiveRange);
        const secureDamage = this.spell && this.spell.id === 'retribution' && this.spellCd <= 0 ? retributionDamage(this) : 0;
        const secureWindow = mo.hp <= secureDamage + Game.basicAttackDamage(this, mo);
        if (!secureWindow && f.enemies > 0 && f.enemyPower > f.allyPower * p.objectiveEnemyRatio) continue;
      }
      if (mo.hpPct > 0.95 && Math.random() < 0.04) Game.ping('gather', mo.x, mo.y, this);
      return mo;
    }
    return null;
  }

  /* Skills worth using while running away.

     botCast is only ever reached with a target, and a retreating bot has none
     — heuristicStateStep returns first — so until now a fleeing hero cast
     nothing at all and died holding a dash it never pressed. These are the
     three kinds of skill that are worth more as an exit than as an opener:
     heal yourself, buff yourself, and put distance between you and whoever is
     chasing. Note the dash is aimed directly AWAY from the nearest enemy —
     botCast aims the same skill at a target to engage, and firing an escape
     into the face of the hero chasing you is how a bot dies with its
     cooldowns spent. */
  botEscapeCast() {
    if (!this.escapeCasts) return;
    let threat = null, bd = Infinity;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive) continue;
      const d = dist(this, h);
      if (d < bd) { bd = d; threat = h; }
    }
    /* The battle spell has exactly the same problem the skills did: its only
       other call site is inside botCast, which needs a target, so a retreating
       bot never reached it. Flicker, Sprint, Purify and Aegis are survival
       tools and retreating is when they are worth the most — measured, 73% of
       bot deaths happened with the battle spell still off cooldown, and 81% of
       deaths happened while retreating. */
    this.botCastSpell(threat);
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (!s || this.skillRank[i] < 1 || this.skillCd[i] > 0 || this.mana < s.mana) continue;
      if (s.type === 'heal') { if (this.hpPct < 0.7) this.castSkill(i, null); continue; }
      // a self-buff (Rampage's regen and tenacity) is at its best mid-escape
      if (s.type === 'buff') { if (threat && bd < 560) this.castSkill(i, null); continue; }
      if (s.type === 'dash' && threat && bd < 620) {
        /* Dashes ignore terrain — that is the whole reason a wall is an escape
           tool rather than a second health bar. A bot that only ever dashes
           directly away throws that away: the same 340 units spent crossing a
           rock forces the chaser to walk all the way round it, which is worth
           far more than the 340 units themselves. So the candidate directions
           are scored, and putting a wall between us and the chaser outweighs
           raw distance gained. Landing inside a wall is rejected outright. */
        const away = Math.atan2(this.y - threat.y, this.x - threat.x);
        let bestA = away, bestScore = -Infinity;
        for (const off of [0, 0.45, -0.45, 0.9, -0.9]) {
          const a = away + off;
          const lx = this.x + Math.cos(a) * s.dist, ly = this.y + Math.sin(a) * s.dist;
          if (Game.wallAt(lx, ly, this.radius)) continue;
          let score = Math.hypot(lx - threat.x, ly - threat.y);
          if (Game.wallOnSegment(lx, ly, threat.x, threat.y, threat.radius, 900)) score += 600;
          if (score > bestScore) { bestScore = score; bestA = a; }
        }
        this.castSkill(i, { x: this.x + Math.cos(bestA) * s.dist, y: this.y + Math.sin(bestA) * s.dist });
      }
    }
  }

  botSkillUrgency(i, t, d, isHero, farmOk) {
    const s = this.skills[i];
    const p = this.p;
    if (!s || this.skillRank[i] < 1 || this.skillCd[i] > 0 || this.mana < s.mana) return 0;
    if (i === 2) {
      if (!isHero) return 0;
      const crowd = Game.heroes.filter(h => h.team !== this.team && h.alive && this.distTo(h) < 420).length;
      if (t.hpPct > p.ultExecuteHp && crowd < 2) return 0;
    }
    const locked = isHero && this.unitLockedDown(t);
    const cc = this.skillHasHardCC(s);
    switch (s.type) {
      case 'skillshot':
        if (d >= s.range * 0.95 || !(isHero || farmOk)) return 0;
        if (locked && !cc) return 860;
        if (cc && isHero && !locked) return 820;
        return isHero ? 500 : 220;
      case 'nova': {
        if (d >= s.radius + t.radius) return 0;
        if (!isHero && !farmOk) return 0;
        let near = 0;
        for (const h of Game.heroes) {
          if (h.team !== this.team && h.alive && this.distTo(h) < s.radius + h.radius) near++;
        }
        if (near >= 2) return 880;
        if (locked && !cc) return 840;
        if (cc && isHero && !locked) return 800;
        return isHero ? 480 : 200;
      }
      case 'dash':
        if (d <= 150 || d >= s.dist + 100) return 0;
        if (!(isHero || (farmOk && (s.dmg || s.endNova)))) return 0;
        if (isHero && this.advancedAI && !this.gapCloseLegal(t)) return 0;
        return cc && isHero && !locked ? 780 : 360;
      case 'zone':
        if (d >= s.range || !(isHero || farmOk)) return 0;
        if (cc && isHero && !locked) return 810;
        return isHero ? 520 : 210;
      case 'heal': {
        const patient = this.lowestHealTarget(s.radius || 360);
        if (!patient || patient.hpPct >= (this.advancedAI ? p.healAllyHp : 0.65)) return 0;
        return patient.hpPct < 0.4 ? 980 : 900;
      }
      case 'blinkstrike':
        if (!isHero || d >= s.range) return 0;
        if (this.advancedAI && !this.gapCloseLegal(t)) return 0;
        return t.hpPct < 0.35 ? 870 : 540;
      case 'buff':
        if (!isHero || d >= 300) return 0;
        return 420;
    }
    return 0;
  }

  botFireSkill(i, t, d, isHero, farmOk) {
    const s = this.skills[i];
    switch (s.type) {
      case 'skillshot':
        this.castSkill(i, Game.aimLeadPoint(this, t, s.speed));
        break;
      case 'nova':
        this.castSkill(i, t);
        break;
      case 'dash':
        this.castSkill(i, t);
        break;
      case 'zone':
        this.castSkill(i, Game.aimLeadPoint(this, t, 550));
        break;
      case 'heal':
        this.castSkill(i, null);
        break;
      case 'blinkstrike':
        this.castSkill(i, t);
        break;
      case 'buff':
        this.castSkill(i, null);
        break;
    }
  }

  botUseActives(t) {
    if (typeof Features === 'undefined') return;
    const isHero = t && t.type === 'hero';
    const d = t ? this.distTo(t) : Infinity;
    for (const it of this.items) {
      if (!it || !it.active) continue;
      const id = it.active.id;
      if ((this.itemCd[id] || 0) > 0) continue;
      if (id === 'aegisPulse' && this.hpPct < 0.55 && isHero) Features.fireActive(this, it);
      else if (id === 'frostheart' && isHero && d < 250) Features.fireActive(this, it);
      else if (id === 'windfeather' && isHero && this.botCanKill(t) && d > this.range + 40 && d < 620)
        Features.fireActive(this, it);
    }
    if (this.hpPct < 0.38 && this.combatT <= 0) {
      const pot = this.items.findIndex(i => i && (i.consume === 'hp' || i.consume === 'flask'));
      if (pot >= 0) Features.consumeItem(this, pot);
    }
  }

  botCast(t) {
    const p = this.p;
    if (this.advancedAI && !this.botTargetSafe(t)) return;
    this.botUseActives(t);
    this.botCastSpell(t);
    const d = this.distTo(t);
    const isHero = t.type === 'hero';
    /* Farming with the kit, not just with basic attacks.

       Every damage skill was gated on the target being a hero, so a bot
       cleared a 1250-HP buff camp by auto-attacking it for sixteen seconds
       with its whole rotation off cooldown. Measured over one match: 8,356
       think-ticks where a damage skill was ready against a minion or camp
       and was refused purely for the target's type.

       The two guards are what keep this from being a downgrade. No enemy
       hero in sight, so a skillshot is never spent on a creep with a fight
       one screen away; and a mana floor, so farming never leaves the bot dry
       for the fight it is farming towards. The ultimate stays hero-only
       inside botSkillUrgency. */
    const farmOk = this.farmsWithSkills && !isHero &&
      this.mana > this.maxMana * p.farmManaFloor &&
      !Game.heroes.some(e => e.team !== this.team && e.alive &&
        this.distTo(e) < p.acquireRange && Game.canSee(this.team, e));
    /* Crowd-control first, then damage, so a stun is not wasted on a target
       that is already locked down. High-urgency casts skip the random roll. */
    const order = [0, 1, 2];
    order.sort((a, b) => this.botSkillUrgency(b, t, d, isHero, farmOk) -
      this.botSkillUrgency(a, t, d, isHero, farmOk));
    for (const i of order) {
      const urgency = this.botSkillUrgency(i, t, d, isHero, farmOk);
      if (urgency <= 0) continue;
      if (urgency < 700 && Math.random() > p.castChance) continue;
      this.botFireSkill(i, t, d, isHero, farmOk);
    }
  }

  /* Battle-spell usage. Each spell has one situation it is obviously for;
     anything cleverer would need a planner the rest of this bot does not have. */
  botCastSpell(t) {
    if (!this.spell || this.spellCd > 0) return;
    const id = this.spell.id;
    const d = t ? this.distTo(t) : Infinity;
    const isHero = t && t.type === 'hero';
    if (id === 'retribution') {
      // Secure on actual damage, not an HP percentage that fires thousands of
      // health too early on Lord. Prefer the epic when two monsters overlap.
      let best = null, bestScore = Infinity;
      const damage = retributionDamage(this);
      for (const m of Game.monsters) {
        if (!m.alive || dist(this, m) > 380) continue;
        if (m.hp > damage) continue;
        const score = m.hp - (m.epic ? 10000 : 0);
        if (score < bestScore) { bestScore = score; best = m; }
      }
      if (best) this.castSpell(best);
      return;
    }
    if (id === 'execute') {
      const damage = isHero ? 120 + (t.maxHp - t.hp) * 0.12 : 0;
      if (isHero && d < 480 && t.hp <= damage) this.castSpell(t);
      return;
    }
    if (id === 'petrify') {
      let near = 0;
      for (const h of Game.heroes) if (h.team !== this.team && h.alive && this.distTo(h) < 250) near++;
      if (near >= 2 || (isHero && d < 240)) this.castSpell(null);
      return;
    }
    if (id === 'purify') { if (!this.cc.canMove && this.cc.dominant !== 'slow') this.castSpell(null); return; }
    if (id === 'sprint' || id === 'flicker') {
      if (this.aiState === 'retreat' && this.hpPct < 0.48) {
        this.castSpell(id === 'flicker' ? Game.fountain(this.team) : null);
        return;
      }
      // blink onto a kill that is just out of reach instead of watching them walk
      if (id === 'flicker' && isHero && this.botCanKill(t) && d > this.range + 30 && d < 520 &&
          this.gapCloseLegal(t)) {
        this.castSpell(t);
      }
      if (id === 'sprint' && isHero && this.botCanKill(t) && d > this.range && d < 780)
        this.castSpell(null);
      return;
    }
    if (id === 'aegis') { if (this.hpPct < 0.62 && isHero && d < 560) this.castSpell(null); return; }
    if (id === 'inspire') { if (isHero && d < this.range + 140) this.castSpell(null); return; }
    if (id === 'vengeance') { if (this.hpPct < 0.55 && isHero && d < 480) this.castSpell(null); return; }
    if (id === 'flameshot') {
      if (isHero && d < 860 && d > 180) this.castSpell(t);
      return;
    }
    if (id === 'icequake') {
      let near = 0;
      for (const h of Game.heroes) if (h.team !== this.team && h.alive && this.distTo(h) < 270) near++;
      if (near >= 2 || (isHero && d < 260)) this.castSpell(null);
      return;
    }
    if (id === 'weaken') { if (isHero && d < 280) this.castSpell(null); return; }
    if (id === 'revitalize') {
      if (this.hpPct < 0.55) this.castSpell(null);
      else {
        for (const a of Game.heroes) {
          if (a.team !== this.team || a === this || !a.alive) continue;
          if (a.hpPct < 0.5 && this.distTo(a) < 320) { this.castSpell(null); break; }
        }
      }
      return;
    }
    if (id === 'arrival') {
      if (this.aiState === 'retreat' && this.hpPct < 0.28 && dist(this, Game.fountain(this.team)) > 1400)
        this.castSpell(null);
    }
  }

  /* Step out of a telegraphed zone.

     Every zone skill announces itself for `delay` seconds before its first
     tick — that window is the whole point of a telegraph, and the bot was
     walking through it as if it were not there (measured: 568 hero-ticks a
     match spent standing inside a warning circle). Nothing else in the AI
     reads Game.zones at all.

     Overlapping zones are summed as repulsion rather than handled one at a
     time, so a bot cornered by two telegraphs leaves through the gap between
     them instead of stepping out of one and into the other.

     Returns true if it took the step, and the caller gives up its normal
     movement for this frame — dodging a meteor beats one auto-attack. Casting
     is decided elsewhere, so the bot still fights on its way out. */
  dodgeZones(dt) {
    if (!this.avoidsZones) return false;
    let rx = 0, ry = 0, deepest = 0, soonest = Infinity;
    for (const z of Game.zones) {
      if (z.team === this.team || z.delay <= 0) continue;   // already firing: too late to move
      const need = z.radius + this.radius + 24;
      const dx = this.x - z.x, dy = this.y - z.y;
      const d = Math.hypot(dx, dy);
      if (d > need) continue;
      const depth = need - d;
      deepest = Math.max(deepest, depth);
      /* How long there is to get clear. A single-tick zone gives you its
         telegraph and nothing more, but one that rains (Arrow Storm ticks four
         times over two seconds) keeps paying out, so leaving late still saves
         every tick after you go. */
      soonest = Math.min(soonest, z.delay + (Math.max(1, z.ticks) - 1) * (z.interval || 0));
      const w = depth / need;
      if (d < 1) { rx += Math.cos(this.facing); ry += Math.sin(this.facing); }
      else { rx += dx / d * w; ry += dy / d * w; }
    }
    if (!deepest) return false;
    /* Only move if the step actually clears the circle in the time left.
       A hit is binary, so a dodge that half-works is worse than none — it
       spends the same seconds and still eats the damage. */
    if (this.curSpeed() * soonest < deepest) return false;
    const m = Math.hypot(rx, ry);
    if (m < 1e-4) return false;
    this.moveToward(this.x + rx / m * 400, this.y + ry / m * 400, dt);
    return true;
  }

  /* Sidestep an incoming skillshot. Homing autos are not worth the step —
     they turn with you. Linear skillshots do not, so a perpendicular dodge
     that clears the remaining travel time is a free miss. */
  dodgeProjectiles(dt) {
    if (!this.avoidsZones) return false;
    let rx = 0, ry = 0, hits = 0;
    for (const p of Game.projectiles) {
      if (!p || p.dead || p.kind !== 'skillshot' || p.team === this.team) continue;
      const dx = p.dx, dy = p.dy;
      const relX = this.x - p.x, relY = this.y - p.y;
      const along = relX * dx + relY * dy;
      if (along < 0) continue;
      const remaining = (p.maxDist || 800) - (p.traveled || 0);
      if (along > remaining + this.radius) continue;
      const cx = p.x + dx * along, cy = p.y + dy * along;
      const miss = Math.hypot(this.x - cx, this.y - cy);
      const need = (p.radius || 24) + this.radius + 18;
      if (miss > need) continue;
      const eta = along / Math.max(120, p.speed || 800);
      const depth = need - miss;
      if (this.curSpeed() * eta < depth * 0.55) continue;
      /* Strafe perpendicular to the shot. The side that already has more
         clearance wins, so two overlapping bolts do not cancel out. */
      let px = -dy, py = dx;
      if (relX * px + relY * py < 0) { px = -px; py = -py; }
      rx += px; ry += py; hits++;
    }
    if (!hits) return false;
    const m = Math.hypot(rx, ry);
    if (m < 1e-4) return false;
    this.moveToward(this.x + rx / m * 400, this.y + ry / m * 400, dt);
    return true;
  }

  /* The live lane position is the allied wave, not a time-coded coordinate.
     Following its leading cluster makes laners pause, crash and regroup with
     the actual state of the road instead of marching through fixed waypoints. */
  laneWaveAnchor() {
    if (!LANE_WAVE_LANES.has(this.lane)) return null;
    /* The wave's leading cluster is a fact about the lane, not the bot, and
       every idle laner asks for it every frame: find it once per frame per
       lane, keyed so that a minion dying or spawning mid-frame invalidates it. */
    const key = `${Game.time}:${Game.minions.length}:${Game._minionDeaths || 0}`;
    let cache = Game._waveCache;
    if (!cache || cache.key !== key) cache = Game._waveCache = { key, lanes: new Map() };
    const laneKey = this.team * 16 + LANE_WAVE_INDEX[this.lane];
    let lead = cache.lanes.get(laneKey);
    if (lead === undefined) {
      lead = null;
      const wave = Game.minions.filter(m => m.alive && m.team === this.team && m.lane === this.lane);
      if (wave.length) {
        let front = wave[0];
        for (const m of wave) if ((m.wpIdx || 0) > (front.wpIdx || 0)) front = m;
        const cluster = wave.filter(m => Math.abs((m.wpIdx || 0) - (front.wpIdx || 0)) <= 1 && dist(m, front) < 260);
        const x = cluster.reduce((s, m) => s + m.x, 0) / cluster.length;
        const y = cluster.reduce((s, m) => s + m.y, 0) / cluster.length;
        lead = { x, y };
      }
      cache.lanes.set(laneKey, lead);
    }
    if (!lead) return null;
    const x = lead.x, y = lead.y;
    const home = Game.basePoint(this.team);
    const d = Math.hypot(home.x - x, home.y - y) || 1;
    const behind = this.ranged ? 175 : 105;
    return { x: x + (home.x - x) / d * behind, y: y + (home.y - y) / d * behind };
  }

  /* Sample several legal positions around a fight. Ranged heroes value their
     spacing, melee heroes value access, everyone dislikes enemy threat zones,
     and a stable left/right preference prevents five allies choosing one dot. */
  chooseCombatPoint(target) {
    const dNow = Math.max(1, dist(this, target));
    const baseA = Math.atan2(this.y - target.y, this.x - target.x);
    const desired = (() => {
      const role = this.botRole();
      const fear = this.hpPct < 0.4 ? 55 : this.hpPct < 0.55 ? 25 : 0;
      if (role === 'Tank') return Math.max(48, this.range * 0.52);
      if (role === 'Support') {
        return this.ranged
          ? Math.max(170, Math.min(this.range * 0.88, this.range + this.radius + target.radius - 20)) + fear
          : Math.max(70, this.range + this.radius + target.radius - 10);
      }
      if (role === 'Assassin') {
        return target.hpPct < 0.42 || this.botCanKill(target)
          ? Math.max(40, this.range * 0.42)
          : Math.max(70, this.range + this.radius + target.radius + 8);
      }
      if (this.ranged)
        return Math.max(170, Math.min(this.range * 0.84, this.range + this.radius + target.radius - 28)) + fear;
      return Math.max(45, this.range + this.radius + target.radius - 16);
    })();
    let best = null, bestScore = -Infinity;
    const offsets = [0, this.combatSide * 0.42, -this.combatSide * 0.42,
      this.combatSide * 0.82, -this.combatSide * 0.82, Math.PI];
    for (const off of offsets) {
      const a = baseA + off;
      const x = target.x + Math.cos(a) * desired, y = target.y + Math.sin(a) * desired;
      if (Game.wallAt(x, y, this.radius + 8)) continue;
      if (!Game.navSegmentClear(this, this, { x, y }, { avoidTowers: true })) continue;
      let score = -Math.abs(Math.hypot(x - target.x, y - target.y) - desired) * 2;
      score -= Game.navRisk(this, x, y, { avoidTowers: true }) * 110;
      /* Space from allies and additional enemies keeps teamfights from becoming
         one rigid pile and gives area skills a reason to matter. */
      for (const h of Game.heroes) {
        if (!h.alive || h === this) continue;
        const d = Math.hypot(x - h.x, y - h.y);
        if (h.team === this.team && d < 150) score -= (150 - d) * 1.4;
        else if (h.team !== this.team && h !== target && Game.canSee(this.team, h) && d < 360)
          score -= (360 - d) * (this.ranged ? 1.1 : 0.35);
      }
      const role = this.botRole();
      if (role === 'Tank' || role === 'Support') {
        const patient = this.lowestHealTarget(560);
        if (patient && patient !== this) {
          const mx = (patient.x + target.x) / 2, my = (patient.y + target.y) / 2;
          score -= Math.hypot(x - mx, y - my) * 0.22;
        }
      }
      /* The preferred flank changes only after respawn, so it looks intentional
         rather than like random jitter. */
      score += Math.sign(off || this.combatSide) === this.combatSide ? 24 : 0;
      score -= Math.hypot(x - this.x, y - this.y) * 0.08;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best || { x: target.x + (this.x - target.x) / dNow * desired,
      y: target.y + (this.y - target.y) / dNow * desired };
  }

  /* Walk to a point using a cached, wall-aware route. Direct travel is retained
     on open ground; only blocked or strategically unsafe journeys invoke A*.
     A moving target causes a bounded replan instead of frame-by-frame wobble. */
  botMoveTo(gx, gy, dt, opts = {}) {
    const nav = this.nav;
    nav.repath -= dt;
    const goalD = hyp(gx - this.x, gy - this.y);
    const movedGoal = !Number.isFinite(nav.gx) || hyp(gx - nav.gx, gy - nav.gy) > 110;
    const direct = Game.navSegmentClear(this, this, { x: gx, y: gy }, opts);

    if (direct && Game.navRisk(this, gx, gy, opts) <= Math.max(2, Game.navRisk(this, this.x, this.y, opts) + 0.5)) {
      nav.path.length = 0; nav.index = 0; nav.gx = gx; nav.gy = gy;
      nav.stalled = 0; nav.lastD = goalD;
      this.routeVia = { stuck: 0, lastD: goalD, aim: null };
      this.moveToward(gx, gy, dt);
      return;
    }

    if (goalD < nav.lastD - 0.6) nav.stalled = Math.max(0, nav.stalled - dt * 2);
    else nav.stalled += dt;
    nav.lastD = goalD;
    /* A consumed route asks for the next one at once. An empty result (the
       goal is unreachable, or start and goal share a cell and the straight
       line is unsafe) is not retried every frame: the bot heads straight for
       the goal until the repath clock, a stall or a moved goal says otherwise. */
    const pathDone = nav.path.length > 0 && nav.index >= nav.path.length;
    if (movedGoal || pathDone || nav.repath <= 0 || nav.stalled > 0.45) {
      nav.path = Game.findNavPath(this, { x: gx, y: gy }, opts);
      nav.index = 0; nav.gx = gx; nav.gy = gy;
      nav.repath = 0.65 + rand(0, 0.18); nav.stalled = 0;
    }

    while (nav.index < nav.path.length && dist(this, nav.path[nav.index]) < 62) nav.index++;
    /* Skip an obsolete corner when the next one has become directly reachable. */
    while (nav.index + 1 < nav.path.length &&
      Game.navSegmentClear(this, this, nav.path[nav.index + 1], opts)) nav.index++;
    const aim = nav.path[nav.index] || { x: gx, y: gy };
    this.routeVia = { stuck: nav.stalled, lastD: goalD, aim: nav.path.length ? aim : null };
    this.moveToward(aim.x, aim.y, dt);
  }

  botControl(dt) {
    const p = this.p;
    this.combatPointT -= dt;
    if (this.dodgeZones(dt)) return;
    if (this.dodgeProjectiles(dt)) return;
    if (this.fleeT > 0) {
      const b = Game.fountain(this.team);
      this.botMoveTo(b.x, b.y, dt, { retreat: true, avoidTowers: true });
      return;
    }
    if (this.aiState === 'retreat') {
      if (this.recallT > 0) return;
      const b = Game.fountain(this.team);
      if (dist(this, b) > 200) this.botMoveTo(b.x, b.y, dt, { retreat: true, avoidTowers: true });
      return;
    }
    const twr = Game.structures().find(s => s.alive && s.team !== this.team && dist(this, s) < s.range + 80);
    if (twr) {
      const cover = Game.minions.some(m => m.team === this.team && m.alive && dist(m, twr) < 320);
      if (!cover && this.hpPct < clamp(p.diveHp + this.adapt.caution, 0.4, 1)) {
        const b = Game.basePoint(this.team);
        this.botMoveTo(b.x, b.y, dt, { retreat: true, avoidTowers: true });
        if (this.aiTarget && this.aiTarget.isStructure) this.aiTarget = null;
        return;
      }
    }
    let t = this.aiTarget;
    // Turtle and Lord sit in known pits: you do not need vision on them to
    // walk there, and the chase cutoff would drop them before arrival
    const isEpic = t && t.epic;
    const isJungleRoute = t && t.type === 'monster' && this.lane === 'jungle';
    if (t && (!t.alive || (this.advancedAI && !this.botTargetSafe(t)) ||
        (!isEpic && !isJungleRoute && (!Game.canSee(this.team, t) || this.distTo(t) > p.chaseRange)))) {
      t = this.aiTarget = null;
    }
    if (t) {
      if (this.inAttackRange(t)) {
        this.tryAttack(t);
        /* Move during attack recovery instead of freezing in a firing line.
           Only heroes provoke tactical orbiting; waves and objectives should
           still be cleared efficiently. */
        if (t.type === 'hero' && p.kiteBuffer > 10 &&
            this.atkCd > (this.ranged ? 0.18 : 0.4) / this.curAtkSpd()) {
          if (!this.combatPoint || this.combatPointT <= 0 || dist(this.combatPoint, t) > this.range * 1.15) {
            this.combatPoint = this.chooseCombatPoint(t);
            this.combatPointT = 0.28 + rand(0, 0.14);
          }
          if (this.combatPoint && dist(this, this.combatPoint) > 36)
            this.botMoveTo(this.combatPoint.x, this.combatPoint.y, dt, { avoidTowers: true });
        }
      } else if (t.type === 'hero') {
        const cut = this.interceptPoint(t);
        if (this.ranged && t.hpPct > 0.42 && !this.botCanKill(t) && t.recallT <= 0) {
          if (!this.combatPoint || this.combatPointT <= 0) {
            this.combatPoint = this.chooseCombatPoint(t);
            this.combatPointT = 0.28 + rand(0, 0.14);
          }
          this.botMoveTo(this.combatPoint.x, this.combatPoint.y, dt, { avoidTowers: true });
        } else this.botMoveTo(cut.x, cut.y, dt, { avoidTowers: true });
      } else if (t.type === 'monster') {
        const dest = t.home && (t.leashed || dist(t, t.home) > 40) ? t.home : t;
        this.botMoveTo(dest.x, dest.y, dt, { avoidTowers: true });
      } else this.botMoveTo(t.x, t.y, dt, { avoidTowers: true });
      return;
    }
    const punish = this.recallingEnemy();
    if (punish && dist(this, punish) > 80) {
      this.botMoveTo(punish.x, punish.y, dt, { avoidTowers: true });
      return;
    }
    const pick = this.isolatedEnemy(this.p.collapseRange);
    if (pick && this.shouldRotateTo(pick) && dist(this, pick) > 160) {
      this.botMoveTo(pick.x, pick.y, dt, { avoidTowers: true });
      return;
    }
    const hold = this.alliedTowerInTrouble();
    if (hold && dist(this, hold) > 180) {
      this.botMoveTo(hold.x, hold.y, dt, { avoidTowers: true });
      return;
    }
    const fight = this.nearbySkirmish();
    if (fight && this.shouldRotateTo(fight) && dist(this, fight) > 180) {
      this.botMoveTo(fight.x, fight.y, dt, { avoidTowers: true });
      return;
    }
    const hunt = this.lastSeenHunt();
    if (hunt && dist(this, hunt) > 140) {
      this.botMoveTo(hunt.x, hunt.y, dt, { avoidTowers: true });
      return;
    }
    if (Game.time <= p.groupAfterMin * 60 && this.lane === 'roam') {
      const ally = this.roamAnchor();
      if (ally && dist(this, ally) > 220) this.botMoveTo(ally.x, ally.y, dt);
      return;
    }
    if (Game.time <= p.groupAfterMin * 60 && this.lane === 'jungle') {
      const ally = this.shadowAlly();
      if (ally && dist(this, ally) > 380) this.botMoveTo(ally.x, ally.y, dt);
      return;
    }
    if (Game.time > p.groupAfterMin * 60) {
      let ally = null, bd = Infinity;
      for (const h of Game.heroes) {
        if (h === this || h.team !== this.team || !h.alive) continue;
        const d = dist(this, h);
        if (d < bd) { bd = d; ally = h; }
      }
      if (ally && bd > 900) { this.botMoveTo(ally.x, ally.y, dt); return; }
    }
    /* Duel shrine. With nothing to fight, a live rune is the only thing on the
       arena worth walking to, and a bot that strolls the lane past it loses to
       one that does not. Health-gated like a buff camp: contesting the open
       centre at 20% health is just handing over the rune and the kill. */
    if (Game.duelRune && Game.duelRune.up && this.hpPct > p.campHp) {
      this.botMoveTo(DUEL_MAP.shrine.x, DUEL_MAP.shrine.y, dt);
      return;
    }
    const wave = this.laneWaveAnchor();
    if (wave && dist(this, wave) > 150) {
      this.botMoveTo(wave.x, wave.y, dt, { avoidTowers: true });
      return;
    }
    if (!this.path) return;
    let wp = this.path[this.wpIdx];
    if (!wp || this.distTo(wp) > 900) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < this.path.length; i++) {
        const d = this.distTo(this.path[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      this.wpIdx = Math.min(bi + 1, this.path.length - 1);
      wp = this.path[this.wpIdx];
    }
    while (wp && this.distTo(wp) < 80 && this.wpIdx < this.path.length - 1) { this.wpIdx++; wp = this.path[this.wpIdx]; }
    if (wp) this.botMoveTo(wp.x, wp.y, dt);
  }
}

/* ================= Minion ================= */
class Minion extends Unit {
  /* `slot` / `count`: this minion's place in its wave, front to back. A wave
     spawns as a column (melee in front, the cannon last) rather than a
     cloud, so the clash timing is the same for every wave. Kinds without a
     MINION_STATS row (the Lord minion) start from the melee row and
     override in their own constructor. */
  constructor(team, lane, kind, slot = 0, count = 1) {
    const path = Game.lanesFor(team)[lane];
    const p0 = path[0];
    const p1 = path[Math.min(1, path.length - 1)];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const seg = Math.hypot(dx, dy) || 1;
    const ux = dx / seg, uy = dy / seg;
    const spec = MINION_STATS[kind] || MINION_STATS.melee;
    /* Spawn on this lane's first stretch, not on the shared citadel pixel.
       10v10's four roads all begin at the same point; a scatter there makes
       twelve minions walk back into the fountain before they split. */
    const formSide = rand(0, 1) < 0.5 ? -1 : 1;
    const formOff = spec.range < 100 ? 16 : 24;
    const along = 40 + 60 * Math.max(0, count - 1 - slot);
    const lat = formOff * formSide;
    let x = p0.x + ux * along - uy * lat;
    let y = p0.y + uy * along + ux * lat;
    if (Game.wallAt(x, y, 18)) { x = p0.x + ux * along; y = p0.y + uy * along; }
    super(x, y, team);
    this.type = 'minion'; this.lane = lane; this.kind = kind;
    this.siege = kind === 'siege';
    this.path = path; this.wpIdx = path.length > 1 ? 1 : 0;
    this.waveN = Game.waveN;
    this.radius = spec.radius;
    /* Linear growth per minute of the clock at spawn; a wave keeps the stats
       it spawned with. The old post-18:00 kicker is gone: matches must not
       depend on it. */
    const mins = Game.time / 60;
    const late = Math.max(0, mins - BALANCE.minionLateAtkFrom / 60);
    const boosted = Game.waveBoost && Game.waveBoost[team] > Game.time ? 1.5 : 1;
    const A = this.attrs.base;
    A.speed = BALANCE.minionSpeed + clamp((mins - BALANCE.minionSpeedUpFrom / 60) * BALANCE.minionSpeedUpPerMin, 0, BALANCE.minionSpeedUpCap);
    A.atkSpd = spec.atkSpd;
    A.armor = A.mr = spec.armor + spec.armorPerMin * mins;
    this.maxHp = Math.round((spec.hp + spec.hpPerMin * mins) * boosted);
    A.physAtk = Math.round((spec.atk + spec.atkPerMin * (mins - late) + spec.atkPerMinLate * late) * boosted);
    this.range = spec.range;
    this.structMult = spec.structMult;
    this.goldValue = spec.gold + spec.goldPerMin * mins;
    this.xpValue = spec.xp;
    if (spec.range > 150) { this.ranged = true; this.projColor = TEAM_COLORS[team]; }
    A.maxHp = this.maxHp;
    this.hp = this.maxHp;
    this.target = null; this.retargetT = 0;
    this.formSide = formSide;
    this.formOff = formOff;
  }
  attackPacket(target) {
    return {
      amount: this.curAtk() * (target && target.isStructure ? this.structMult : 1),
      type: 'physical', isBasic: true,
    };
  }

  /* Distance to the lane we are supposed to be walking. Used as a leash so
     a wave does not follow a hero into jungle and never come back. */
  minionPathDist(u = this) {
    if (!this.path || !this.path.length) return 0;
    if (this.path.length < 2) return dist(u, this.path[0]);
    let best = Infinity;
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;
      let t = ((u.x - a.x) * abx + (u.y - a.y) * aby) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(u.x - (a.x + abx * t), u.y - (a.y + aby * t));
      if (d < best) best = d;
    }
    return best;
  }

  pickMinionTarget() {
    const siege = this.kind === 'super' || this.kind === 'lord' || this.kind === 'siege';
    const pathLeash = siege ? 640 : 240;
    let nearbyMinion = false;
    for (const u of Game.enemyUnits(this.team, { structures: true })) {
      if (u.type !== 'minion' || this.distTo(u) - u.radius >= 340) continue;
      if (u.lane === this.lane || this.minionPathDist(u) <= 150) { nearbyMinion = true; break; }
    }
    let best = null, bestScore = Infinity;
    for (const u of Game.enemyUnits(this.team, { structures: true })) {
      const d = this.distTo(u) - u.radius;
      if (d > 340) continue;
      let score = d;
      if (u.type === 'minion') {
        /* 10v10 dusk/west (and east/dawn) run close near the first towers.
           A wave that peels onto the neighbour road never comes back. */
        if (u.lane !== this.lane && this.minionPathDist(u) > 150) continue;
        score -= (1 - u.hpPct) * 90;
        if (u.lane === this.lane) score -= 70;
      } else if (u.isStructure) {
        score += nearbyMinion ? 170 : (siege ? -50 : 55);
      } else if (u.type === 'hero') {
        if (!siege && nearbyMinion) score += 250;
        else score += siege ? 35 : 95;
        if (this.minionPathDist(u) > pathLeash) continue;
      }
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }

  /* Aim a step beside the road, but never into rock — offset into a crater
     wall is how a Caldera wave starts sliding and never reaches the waypoint. */
  minionSteer(tx, ty) {
    const dx = tx - this.x, dy = ty - this.y, m = hyp(dx, dy) || 1;
    const ax = tx - dy / m * this.formSide * this.formOff;
    const ay = ty + dx / m * this.formSide * this.formOff;
    if (Game.wallAt(ax, ay, this.radius + 6)) return { x: tx, y: ty };
    return { x: ax, y: ay };
  }

  /* Keep wpIdx on the point ahead of us. dist<60 skip fails when a turret
     (sitting on the polyline) plus separate() holds the minion 56 units out,
     so the wave orbits its own T1 forever. */
  advanceLaneWp() {
    const path = this.path;
    if (!path || !path.length) return;
    let bi = 0, bd = Infinity;
    /* the nearest waypoint is almost always next to the last one; a full
       search every 1.5 s catches knock-backs and respawns */
    const prev = this.wpIdx | 0;
    const full = this._wpFullT === undefined || Game.time - this._wpFullT > 1.5 || prev >= path.length;
    const k0 = full ? 0 : Math.max(0, prev - 4), k1 = full ? path.length - 1 : Math.min(path.length - 1, prev + 10);
    const x = this.x, y = this.y;
    for (let k = k0; k <= k1; k++) {          // squared distances: same nearest point, no sqrt
      const p = path[k], dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = k; }
    }
    if (full) this._wpFullT = Game.time;
    let i = Math.min(bi + 1, path.length - 1);
    while (i < path.length - 1) {
      const p = path[i], dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy >= 80 * 80) break;
      i++;
    }
    this.wpIdx = i;
  }

  update(dt) {
    if (!this.alive) return;
    this.baseUpdate(dt);
    if (!this.cc.canAct) { this.trackVelocity(dt); return; }
    this.retargetT -= dt;
    let t = this.target;
    if (t && (!t.alive || this.distTo(t) > 480)) t = this.target = null;
    /* After hero-aggro expires, drop a chase that has left the road so the
       wave returns to the lane instead of wandering the jungle. */
    if (t && t.type === 'hero' && this.retargetT <= 0.45 && this.minionPathDist(this) > 400)
      t = this.target = null;
    if (this.retargetT <= 0) {
      this.retargetT = 0.4;
      const best = this.pickMinionTarget();
      if (best) t = this.target = best;
    }
    this.advanceLaneWp();
    if (t) {
      if (this.inAttackRange(t)) {
        this.tryAttack(t);
        if (this.ranged && !this.siege && this.distTo(t) < this.range * 0.62) {
          const dx = this.x - t.x, dy = this.y - t.y, m = Math.hypot(dx, dy) || 1;
          const kx = this.x + dx / m * 90, ky = this.y + dy / m * 90;
          if (!Game.wallAt(kx, ky, this.radius + 4)) this.moveToward(kx, ky, dt);
        }
      } else {
        const aim = this.minionSteer(t.x, t.y);
        this.moveToward(aim.x, aim.y, dt);
      }
      this.trackVelocity(dt);
      return;
    }
    const wp = this.path[this.wpIdx];
    if (wp) {
      const aim = this.minionSteer(wp.x, wp.y);
      this.moveToward(aim.x, aim.y, dt);
    }
    this.trackVelocity(dt);
  }
  /* Minion rewards are proximity-shared (docs/design/lanes-economy.md, 5):
     the gold and XP pools are split equally among enemy heroes within the
     share radius; the last-hitting hero adds a bonus on top; a kill by a
     turret or a minion pays 80% of the pool. The jungler (Retribution) takes
     half a share and is not counted against the laner before 5:00; the
     roamer (Roam item) takes nothing while a teammate is nearby before 8:00.
     The cannon of the gold lane pays +30% gold and the cannon of the EXP
     lane +35% XP for the first ten waves. */
  die(src) {
    this.alive = false;
    Game._minionDeaths = (Game._minionDeaths || 0) + 1;   // invalidates per-frame wave caches
    Game.fx.spark(this.x, this.y, TEAM_COLORS[this.team], 5);
    let gold = this.goldValue, xp = this.xpValue;
    if (this.siege && this.waveN <= BALANCE.laneBonusWaves && !Game.isDuel()) {
      if (this.lane === 'top' || this.lane === 'dusk') gold *= BALANCE.goldLaneMult;
      else if (this.lane === 'bot' || this.lane === 'dawn') xp *= BALANCE.expLaneMult;
    }
    const heroKill = src instanceof Hero && src.team !== this.team;
    const R = BALANCE.minionShareRadius;
    const junglerEarly = Game.time < BALANCE.junglerMinionPenaltyUntil;
    const roamEarly = Game.time < BALANCE.roamNoFarmUntil;
    const sharers = Minion._sharers; sharers.length = 0;
    let counted = 0;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || dist(h, this) >= R) continue;
      let weight = 1;
      if (junglerEarly && h.spell && h.spell.id === 'retribution') weight = BALANCE.junglerMinionShare;
      else if (roamEarly && h.isRoamer()) {
        let ally = false;
        for (const a of Game.heroes) {
          if (a !== h && a.team === h.team && a.alive && dist(a, this) < R) { ally = true; break; }
        }
        if (ally) continue;
      }
      if (weight >= 1) counted++;
      sharers.push(h, weight);
    }
    if (sharers.length) {
      const pool = gold * (heroKill ? 1 : BALANCE.nonHeroKillShare);
      const n = Math.max(1, counted);
      for (let i = 0; i < sharers.length; i += 2) {
        const h = sharers[i], w = sharers[i + 1];
        let g = pool / n * w;
        if (h === src) g += gold * BALANCE.lastHitBonus;
        h.gainGold(g);
        h.gainXp(xp / n * w);
        if (h === src && typeof Features !== 'undefined') Features.onMinionDeath(this, src, g);
      }
    } else if (heroKill && typeof Features !== 'undefined') Features.onMinionDeath(this, src, 0);
    sharers.length = 0;
  }
}
Minion._sharers = [];   // scratch list, so a wave dying under a turret allocates nothing

/* ================= Tower / Base ================= */
class Tower extends Unit {
  /* `tier` is 'outer' | 'middle' | 'inner' | 'base', a BALANCE.turret row.
     Game.start sets it from the spot's `frac` after construction. */
  constructor(x, y, team, isBase) {
    super(x, y, team);
    this.type = 'tower'; this.isStructure = true; this.isBase = !!isBase;
    this.radius = isBase ? 150 : 100;     // the reference turret footprint is about 7 map px
    const A = this.attrs.base;
    A.atkSpd = 1.0; A.speed = 0;
    this.setTier(isBase ? 'base' : 'outer');
    this.range = isBase ? 470 : 410;     // 28 map px: the reference turret's range ring, measured on the phone
    this.ranged = true; this.projColor = THEME.gold;
    this.target = null;
    this.focusTarget = null; this.focusHits = 0; this.focusT = -Infinity;
    this.shieldedByOuter = false;   // set by Game each frame (the tier behind a live one is immune)
    this.alertT = 0;                // Orange Alert: 50% damage taken until this clock time
    this.disabledT = 0;             // cannot fire while > 0 (Summoned Lord charge)
    this.chargeT = 0;               // fire telegraph, for the renderer
  }
  setTier(tier, hpMult = 1) {
    const T = BALANCE.turret[tier] || BALANCE.turret.outer;
    this.tier = tier;
    this.maxHp = this.hp = Math.round(T.hp * hpMult);
    const A = this.attrs.base;
    A.maxHp = this.maxHp;
    A.armor = T.armor; A.mr = T.armor;
    A.physAtk = T.atk;
    this.atkPerMin = T.atkPerMin;
    this.shield = Game.isDuel() ? 0 : T.shield;   // energy shield pool, outers only
    this.shieldMax = this.shield;
    this.shieldGold = 0;
  }
  curAtk() { return this.attrs.get('physAtk') + this.atkPerMin * Game.time / 60; }
  /* The outer's opening energy shield: absorbs before HP until 5:00. */
  get shieldActive() { return this.shield > 0 && Game.time < BALANCE.towerShieldEnd; }
  get shieldPhase() { return this.shieldMax > 0 && Game.time < BALANCE.towerShieldEnd; }
  /* Hero ramp: hit n on the same hero deals ATK x (1 + 0.35 x min(8, n - 1)).
     It resets 2 s after the turret last damaged that hero, not when the
     turret shoots a minion in between. */
  attackPacket(target) {
    let ramp = 1;
    if (target && target.type === 'hero') {
      if (this.focusTarget !== target || Game.time - this.focusT > BALANCE.towerRampReset) {
        this.focusTarget = target; this.focusHits = 0;
      }
      ramp += Math.min(BALANCE.towerRampCap, this.focusHits) * BALANCE.towerRamp;
      this.focusHits++;
      this.focusT = Game.time;
    }
    return { amount: this.curAtk() * ramp, type: 'true', isBasic: false };
  }
  onDamaged(src, dmg, packet) {
    super.onDamaged(src, dmg, packet);
    if (!this.shieldActive || !src || src.team === this.team) return;
    // the shield eats the hit before health, and pays the hero that chips it
    const absorbed = Math.min(this.shield, dmg);
    this.shield -= absorbed;
    this.hp += absorbed;
    if (src.type === 'hero') {
      const pay = Math.min(absorbed / 10, BALANCE.towerShieldGoldCap - this.shieldGold);
      if (pay > 0) { this.shieldGold += pay; src.gainGold(pay); }
    }
    if (this.shield <= 0) {
      this.shield = 0;
      Game.fx.ring(this.x, this.y, this.radius + 34, THEME.gold, 0.45);
      if (Game.player && Game.player.team === src.team) UI.announce('🛡 Enemy turret shield broken', 'minor');
    }
  }
  update(dt) {
    if (!this.alive) return;
    this.baseUpdate(dt);
    if (this.disabledT > 0) { this.disabledT -= dt; this.chargeT = 0; return; }
    if (this.focusHits > 0 && Game.time - this.focusT > BALANCE.towerRampReset) this.focusHits = 0;
    let t = this.target;
    if (t && (!t.alive || this.distTo(t) > this.range + this.radius + t.radius + 30)) t = null;
    /* Protect allied heroes: if an enemy in range just hit one of ours, that
       attacker outranks a minion. This is the rule that makes diving a
       teammate under turret actually costly. */
    let defender = null;
    for (const ally of Game.heroes) {
      if (ally.team !== this.team || !ally.alive) continue;
      if (this.distTo(ally) > this.range + this.radius + ally.radius + 70) continue;
      for (const r of ally.recentDmg) {
        if (Game.time - r.t > 2.8) continue;
        const foe = r.h;
        if (!foe || !foe.alive || foe.team === this.team) continue;
        if (this.distTo(foe) <= this.range + this.radius + foe.radius)
          defender = foe;
      }
    }
    if (defender) t = defender;
    if (!t) {
      // squared distances: the nearest unit in reach, without a sqrt per candidate
      let bd = Infinity;
      const reach = this.range + this.radius;
      for (const m of Game.minions) {
        if (m.team === this.team || !m.alive) continue;
        const dx = m.x - this.x, dy = m.y - this.y, d2 = dx * dx + dy * dy, r = reach + m.radius;
        if (d2 > r * r) continue;
        // the Summoned Lord is shot before any other non-hero
        if (m.kind === 'lord') { t = m; break; }
        if (d2 < bd) { bd = d2; t = m; }
      }
      if (!t) {
        bd = Infinity;
        for (const h of Game.heroes) {
          if (h.team === this.team || !h.alive) continue;
          const dx = h.x - this.x, dy = h.y - this.y, d2 = dx * dx + dy * dy, r = reach + h.radius;
          if (d2 <= r * r && d2 < bd) { bd = d2; t = h; }
        }
      }
    }
    this.target = t;
    this.chargeT = t && this.atkCd > 0 ? clamp(1 - this.atkCd * this.curAtkSpd(), 0, 1) : 0;
    if (t) this.tryAttack(t);
  }
  die(src) {
    this.alive = false;
    Game.fx.explosion(this.x, this.y, this.isBase ? 160 : 100);
    Game.fx.shake(this.isBase ? 14 : 8);
    SFX.tower();
    if (this.isBase) { Game.endGame(1 - this.team); return; }
    const enemyTeam = 1 - this.team;
    const T = BALANCE.turret[this.tier] || BALANCE.turret.outer;
    let reward = Game.objectiveGoldPerHero(enemyTeam, T.gold);
    let first = false;
    if (!Game.firstTurret && !Game.isDuel()) {
      Game.firstTurret = true; first = true;
      reward += BALANCE.firstTowerGold;
    }
    for (const h of Game.heroes) if (h.team === enemyTeam) h.gainGold(reward);
    /* Orange Alert: an outer lost before 8:00 hardens the middle turret
       behind it for a minute, so an early snowball cannot run a whole lane. */
    if (this.tier === 'outer' && Game.time < BALANCE.orangeAlertUntil) {
      for (const o of Game.towers) {
        if (o.alive && o.team === this.team && o.lane === this.lane && o.tier === 'middle') o.alertT = Game.time + BALANCE.orangeAlertDur;
      }
    }
    UI.announce(this.team === TEAM_BLUE ? '💔 Your turret has fallen!' : '🎉 Enemy turret destroyed!', this.team === TEAM_BLUE ? 'death' : 'kill');
    UI.killFeed(src, this);
    if (first) UI.announce('🗼 FIRST TURRET', 'major');
    if (typeof Mlbb !== 'undefined') Mlbb.onTurretKill(this, src, first);
  }
}

/* ================= Jungle monster ================= */
class Monster extends Unit {
  constructor(camp) {
    super(camp.x, camp.y, TEAM_NEUTRAL);
    this.type = 'monster'; this.radius = 24;
    this.maxHp = this.hp = 950;
    const A = this.attrs.base;
    A.maxHp = 950; A.physAtk = 52; A.armor = 20; A.mr = 20;
    A.atkSpd = 0.9; A.speed = 215;
    this.range = 70;
    this.goldValue = 90; this.xpValue = 120;
    this.home = camp; this.target = null; this.leashed = false;
    this.kind = camp.kind || 'normal';
    this.respawn = 55;
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
      this.heal(this.maxHp * 0.4 * dt);
      if (dist(this, this.home) < 30) { this.leashed = false; this.hp = this.maxHp; }
      else this.moveToward(this.home.x, this.home.y, dt);
      return;
    }
    if (!this.target) {
      if (dist(this, this.home) > 14) this.moveToward(this.home.x, this.home.y, dt);
      return;
    }
    if (!this.target.alive || dist(this, this.home) > 520) {
      this.target = null; this.leashed = true; return;
    }
    let best = null, bd = Infinity;
    for (const h of Game.heroes) {
      if (!h.alive || dist(h, this.home) > 620) continue;
      const d = dist(this, h);
      if (d < bd) { bd = d; best = h; }
    }
    if (!best) { this.target = null; this.leashed = true; return; }
    this.target = best;
    if (this.inAttackRange(best)) this.tryAttack(best);
    else this.moveToward(best.x, best.y, dt);
  }
  /* Camp rewards go to the killer; a Retribution holder gets x1.4. The crab
     pays a Gold Buff trickle (+2/s for 18 s) instead of a lump. */
  die(src) {
    this.alive = false;
    Game.fx.spark(this.x, this.y, THEME.neutral, 10);
    if (src instanceof Hero) {
      const mult = src.spell && src.spell.id === 'retribution' ? BALANCE.junglerCreepMult : 1;
      let gold = Math.round(this.goldValue * mult);
      const xp = Math.round(this.xpValue * mult);
      if (this.kind === 'crab') src.addTimedBuff('goldBuff', 2 * mult, 18);
      src.gainGold(gold);
      src.gainXp(xp);
      src.jungleHits = (src.jungleHits || 0) + 1;
      if (typeof Mlbb !== 'undefined') Mlbb.onBuffKill(this, src);
      if (src.isPlayer) UI.announce(this.kind === 'crab' ? `Crab slain +${gold} 💰 and Gold Buff (+2/s for 18s)` : `Jungle monster slain +${gold} 💰`, 'minor');
    }
    this.home.respawnT = this.respawn || 55;
  }
}

/* ================= Projectile ================= */
class Projectile {
  constructor(o) { Object.assign(this, o); this.dead = false; this.traveled = 0; }
  static homing(src, target, packet) {
    return new Projectile({
      kind: 'homing', x: src.x, y: src.y, src, team: src.team, target, packet,
      speed: src.isStructure ? 620 : 850, size: src.isStructure ? 9 : 5, color: src.projColor,
    });
  }
  static skillshot(src, s, dir) {
    const idx = src.skills ? src.skills.indexOf(s) : -1;
    return new Projectile({
      kind: 'skillshot', x: src.x, y: src.y, src, team: src.team, s,
      dx: dir.x, dy: dir.y, dmg: src.skillDmg(s), speed: s.speed, maxDist: s.range,
      radius: s.radius || 24, pierce: !!s.pierce, explodeR: s.explodeR || 0,
      hook: !!s.hook, hitSet: new Set(), size: s.explodeR ? 13 : s.hook ? 9 : 10,
      color: src.color, icon: s.icon,
      skillKey: (src.def0 && idx >= 0) ? `skill:${src.def0.id}:${idx}` : null,
      style: s.hook ? 'hook' : s.explodeR ? 'orb' : s.pierce ? 'bolt' : 'shard',
      dmgType: s.dmgType || 'physical',
    });
  }
  explode(cx, cy) {
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (!this.hitSet.has(u) && Math.hypot(u.x - cx, u.y - cy) <= this.explodeR + u.radius) {
        this.hitSet.add(u);
        const dealt = resolveDamage(this.src, u, { amount: this.dmg * 0.8, type: this.dmgType, skill: this.s });
        if (dealt && this.src.onSkillLanded) this.src.onSkillLanded(u, dealt, this.s);
      }
    }
    Game.fx.ring(cx, cy, this.explodeR, this.color, 0.4);
  }
  update(dt) {
    if (this.dead) return;
    if (this.kind === 'homing') {
      const t = this.target;
      if (!t || !t.alive) { this.dead = true; return; }
      const d = dist(this, t);
      const step = this.speed * dt;
      if (d <= step + t.radius) {
        const dealt = resolveDamage(this.src, t, this.packet);
        if (dealt && this.src.onBasicLanded) this.src.onBasicLanded(t, dealt);
        if (t.isPlayer) SFX.hit();
        this.dead = true;
        return;
      }
      const dir = norm(t.x - this.x, t.y - this.y);
      this.x += dir.x * step; this.y += dir.y * step;
      return;
    }
    // skillshot
    const step = this.speed * dt;
    this.x += this.dx * step; this.y += this.dy * step;
    this.traveled += step;
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (this.hitSet.has(u)) continue;
      if (Math.hypot(u.x - this.x, u.y - this.y) <= this.radius + u.radius) {
        this.hitSet.add(u);
        const dealt = resolveDamage(this.src, u, { amount: this.dmg, type: this.dmgType, skill: this.s });
        applySkillCC(this.src, u, this.s);
        if (dealt && this.src.onSkillLanded) this.src.onSkillLanded(u, dealt, this.s);
        if (this.hook && u.type === 'hero') u.forced = { src: this.src, t: 0.6 };
        if (this.explodeR) this.explode(this.x, this.y);
        if (!this.pierce) { this.dead = true; Game.fx.spark(this.x, this.y, this.color, 6); return; }
      }
    }
    const bounds = Game.mapBounds();
    if (this.traveled >= this.maxDist || this.x < bounds.minX || this.y < bounds.minY ||
        this.x > bounds.maxX || this.y > bounds.maxY) {
      if (this.explodeR) this.explode(this.x, this.y);
      this.dead = true;
    }
  }
}

/* ================= Zone (delayed AoE) ================= */
class Zone {
  constructor(owner, s, x, y) {
    this.owner = owner; this.team = owner.team; this.s = s;
    this.x = x; this.y = y; this.radius = s.radius;
    this.delay = s.delay || 0.6; this.delay0 = this.delay;
    this.ticks = s.ticks || 1; this.interval = s.interval || 0;
    this.next = 0; this.dead = false; this.age = 0;
    this.color = owner.color;
    this.dmg = owner.skillDmg(s);
  }
  tick() {
    this.ticks--;
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (Math.hypot(u.x - this.x, u.y - this.y) <= this.radius + u.radius) {
        const dealt = resolveDamage(this.owner, u, {
          amount: this.dmg, type: this.s.dmgType || 'physical', skill: this.s,
        });
        applySkillCC(this.owner, u, this.s);
        if (dealt && this.owner.onSkillLanded) this.owner.onSkillLanded(u, dealt, this.s);
      }
    }
    if (Game.fx.zoneImpact) Game.fx.zoneImpact(this);
    else Game.fx.ring(this.x, this.y, this.radius, this.color, 0.35);
    SFX.zone();
  }
  update(dt) {
    if (this.dead) return;
    this.age += dt;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay <= 0) {
        this.tick();
        if (this.ticks <= 0) this.dead = true; else this.next = this.interval;
      }
      return;
    }
    this.next -= dt;
    if (this.next <= 0) {
      this.tick();
      if (this.ticks <= 0) this.dead = true; else this.next = this.interval;
    }
  }
}
