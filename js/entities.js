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
    this.cc = new CCState(this);
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
  /* A tagged shield (Wick's lantern) refreshes the one already there instead
     of stacking another on top. */
  addShield(amount, dur, tag) {
    if (amount <= 0) return;
    if (tag) {
      const ex = this.shields.find(sh => sh.tag === tag);
      if (ex) { ex.amount = Math.max(ex.amount, amount); ex.t = Math.max(ex.t, dur); return; }
    }
    this.shields.push({ amount, t: dur, tag });
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
          const dealt = resolveDamage(d.src, this, { amount: d._acc, type: d.type, noPassive: true, lifestealMult: 0 });
          d._acc = 0; d._cd = 0.25;
          // a passive may read its own dot's ticks (Hexa heals off Blight); the tick itself stays noPassive
          if (dealt && d.src && d.src.fire) d.src.fire('onDotTick', this, dealt, d);
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
    this.launchBasic(target);
  }
  /* The swing itself, once the cooldown and facing are settled: an arrow
     for a ranged unit, a slash for a melee one. Heroes override it for
     their basic-attack states (F7 volley, F25 thrown blades). */
  launchBasic(target) {
    if (this.ranged) {
      Game.projectiles.push(Projectile.homing(this, target, this.attackPacket(target)));
      if (this.isPlayer) SFX.shoot();
    } else {
      const pkt = this.attackPacket(target);
      const dealt = resolveDamage(this, target, pkt);
      Game.fx.slash(target.x, target.y, this.facing, this.team);
      if (dealt && this.onBasicLanded) this.onBasicLanded(target, dealt, pkt);
      if (this.isPlayer || target.isPlayer) SFX.hit();
    }
  }

  onDamaged(src, dmg) { this.hitFlash = 0.12; }
  die(src) { this.alive = false; }

  /* ---------- movement the unit does not choose (F15 hook / slide / point, F23 taunt) ----------
     Returns true while the forced state owns the unit's movement this frame,
     so the caller skips its own steering. A slide or point tween waits for a
     dash in progress to finish (its clock keeps running) and marches in
     short sub-steps so a thin wall is never skipped. */
  updateForced(dt) {
    const f = this.forced;
    if (!f) return false;
    if (f.mode === 'hook') {
      f.t -= dt;
      const d = dist(this, f.src);
      if (d > 80 && f.t > 0 && f.src.alive) {
        const dir = norm(f.src.x - this.x, f.src.y - this.y);
        this.x += dir.x * 1100 * dt; this.y += dir.y * 1100 * dt;
        this.clampWorld();
      } else this.forced = f.prev && f.prev.mode === 'taunt' && this.cc.has('taunt') ? f.prev : null;
      return true;
    }
    if (f.mode === 'taunt') return this.updateTaunt(dt, f);
    f.t -= dt;
    if (this.dashS) { if (f.t <= 0) this.endForced(f, false); return false; }
    let stepLen = f.speed * dt, dx, dy;
    if (f.mode === 'slide') {
      stepLen = Math.min(stepLen, f.dist);
      dx = f.dx; dy = f.dy;
      f.dist -= stepLen;
    } else {
      const rx = f.x - this.x, ry = f.y - this.y, d = Math.sqrt(rx * rx + ry * ry);
      if (d < 1) { this.endForced(f, false); return true; }
      stepLen = Math.min(stepLen, d);
      dx = rx / d; dy = ry / d;
    }
    const sub = stepLen > 20 ? Math.ceil(stepLen / 20) : 1;
    const ds = stepLen / sub;
    let hitWall = false;
    for (let i = 0; i < sub; i++) {
      const nx = this.x + dx * ds, ny = this.y + dy * ds;
      if (Game.wallAt(nx, ny, this.radius)) { hitWall = true; break; }
      this.x = nx; this.y = ny;
    }
    this.clampWorld();
    if (hitWall) { this.onForcedWall(f); this.endForced(f, true); return true; }
    if (f.t <= 0 || (f.mode === 'slide' && f.dist <= 0.01)) this.endForced(f, false);
    return true;
  }
  endForced(f, hitWall) {
    if (this.forced !== f) return;
    this.forced = (f.prev && f.prev.mode === 'taunt' && this.cc.has('taunt')) ? f.prev : null;
    // noWallCC: the CC a launch applies when nothing stopped it (Tide's High Water)
    if (!hitWall && f.s && f.s.noWallCC && this.alive) applySkillCC(f.src, this, f.s.noWallCC, f.rank);
  }
  /* The victim met rock or a turret: wallDmg (+wallScaleAp of the caster's
     magic power) and wallStun from the skill that threw it. */
  onForcedWall(f) {
    const s = f.s, src = f.src;
    if (!s) return;
    if (s.wallDmg || s.wallScaleAp) {
      const amount = (rankVal(s, 'wallDmg', f.rank) || 0) + (src && src.magicPower ? src.magicPower() : 0) * (s.wallScaleAp || 0);
      const dealt = resolveDamage(src, this, { amount, type: s.dmgType || 'magic', skill: s });
      if (dealt && src && src.onSkillLanded) src.onSkillLanded(this, dealt, s);
    }
    if (s.wallStun && this.cc) this.cc.apply('stun', rankVal(s, 'wallStun', f.rank), this.attrs ? this.attrs.get('tenacity') : 0);
    Game.fx.spark(this.x, this.y, THEME.ccKnockback, 8);
  }
  /* Taunt (F23) walks the unit at its source and swings when in reach;
     heroes override this with their own steering. */
  updateTaunt(dt, f) {
    if (!this.cc.has('taunt') || !f.src || !f.src.alive) { this.forced = null; return false; }
    if (this.inAttackRange(f.src)) this.tryAttack(f.src);
    else this.moveToward(f.src.x, f.src.y, dt);
    return true;
  }
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
    this.forced = null;       // {mode: 'hook'|'slide'|'point'|'taunt', ...} movement the hero does not choose (F15, F23)
    /* Resource (docs/design/heroes.md F3-F6). `mana` is the bar whatever it
       holds: mana, energy (F4) or heat (F5); `resource` says which. */
    this.resource = def.resource || 'mana';
    this.stillT = 0;          // F4 battery: seconds without moving
    this.lastDmgT = -99;      // F5: last time this hero dealt or took damage (heat decay)
    this._sx = 0; this._sy = 0;   // position at the top of the previous update (stillness)
    this.state = null;        // F19 self state {s, t}
    this.untargetable = false; // F19: mirrors state.s.untargetable (a plain field: enemyUnits/canSee read it constantly)
    this.channelS = null;     // F18 channel {s, t, i, rank}
    this.basicRangeState = null;   // F25 {s, rank, count, t}: basics are thrown at rangeSet
    this.basicMod = null;     // F7 {s, rank, t, asMult}: basics are piercing volleys
    this.recast = null;       // F22 {x, y, until, skillIdx, s}: a Return is open on that button
    this.buffState = null;    // {s, t}: the self steroid running (Cinder's Furnace upgrades her burn while it lasts)
    /* F8 charge skills: charges banked per skill and the seconds left on the
       one charge that is recharging (one at a time, never reduced by cdr) */
    this.skillCharges = [0, 0, 0];
    this.skillRecharge = [0, 0, 0];
    this.revealT = 0;         // seconds this hero is revealed through bush / conceal
    this.concealT = 0;        // F13: standing in a concealing zone (hidden like a bush)
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
    if (def.botRetreatHp) this.p.retreatHp = def.botRetreatHp;   // F29 (Hexa's hint): she retreats to heal earlier than most
    this.lastTetherDone = null;        // {t, target}: the last hostile tether of hers that ran its course (F29, Hexa)
    const lanes = Game.lanesFor(team);
    this.path = lane && lanes[lane] ? lanes[lane] : null;
    this.curTarget = null;
    this.lastKillT = -99; this.comboKills = 0;
    this.lastTakedownT = -99;          // last hero kill or assist (F24 bots: Omen chains onto the next target)
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
    // F24: a takedown refunds part of every skill that carries resetOnKill / resetOnAssist
    if (hook === 'onKill') { this.resetCooldowns('resetOnKill'); this.lastTakedownT = Game.time; }
    else if (hook === 'onAssist') { this.resetCooldowns('resetOnAssist'); this.lastTakedownT = Game.time; }
    const P = this.passiveDef();
    if (P && P[hook]) return P[hook](this, ...args);
    return undefined;
  }
  /* F24: take `fraction x fullCd` off each skill carrying `key`. */
  resetCooldowns(key) {
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (!s || !(s[key] > 0) || !(this.skillCd[i] > 0)) continue;
      this.skillCd[i] = Math.max(0, this.skillCd[i] - s[key] * this.cooldownFor(s, this.skillRank[i]));
    }
  }

  /* ---------- stats ----------
     base = level curve. bonus = gear + passives + buffs, rebuilt from
     scratch each time so nothing can leak across recalcs. */
  recalcStats(full) {
    const d = this.def0, l = this.level - 1;
    const A = this.attrs;
    const prevMax = this.maxHp || 0;

    A.base.maxHp = d.hp + d.hpLv * l + (BALANCE.heroHpPad || 0);
    A.base.maxMana = (d.mp || 0) + (d.mpLv || 0) * l;
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
      // 'atkSpd' is read by curAtkSpd (max against a steroid, F26), not summed here
    }

    /* F25: while the basic-range state runs, range reads rangeSet exactly */
    if (this.basicRangeState && this.basicRangeState.s.rangeSet) {
      A.addBonus({ range: this.basicRangeState.s.rangeSet - A.get('range') });
    }

    this.maxHp = Math.round(A.get('maxHp'));
    this.maxMana = Math.round(A.get('maxMana'));
    /* F3/F4/F5: an energy pool is flat whatever the level or items, a heat
       gauge is 0-100, a cooldown-only hero has no bar at all */
    if (this.resource === 'energy') this.maxMana = (d.energy && d.energy.max) || 100;
    else if (this.resource === 'heat') this.maxMana = 100;
    else if (this.resource === 'none') this.maxMana = 0;
    this.range = A.get('range');

    if (full) {
      this.hp = this.maxHp;
      this.mana = this.resource === 'heat' ? 0 : this.maxMana;
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
  /* Attack-speed steroids never stack on each other: a dash asMult and a
     basicMod asMult (F7) resolve to the larger one, and the additive
     `atkSpd` timed buff (an allybuff's asAdd, F26; Inspire) is taken as
     the max against that multiplier rather than on top of it. */
  curAtkSpd() {
    const base = this.attrs.get('atkSpd');
    let m = this.buffAsT > 0 ? this.buffAsMult : 1;
    if (this.basicMod && this.basicMod.asMult > m) m = this.basicMod.asMult;
    const b = this.buffs.atkSpd;
    const add = b && b.t > 0 ? b.value : 0;
    return Math.max(base * m, base + add);
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

  /* F18 / F19: a channelling hero and a self-rooted one do not walk
     (forced movement is separate and refused by a displacement immunity). */
  moveToward(tx, ty, dt) {
    if (this.channelS || (this.state && this.state.t > 0 && this.state.s.selfRoot)) return;
    super.moveToward(tx, ty, dt);
  }
  tryAttack(target) {
    if (this.channelS || (this.state && this.state.t > 0 && this.state.s.noAttack)) return;
    super.tryAttack(target);
  }
  /* F7 / F25: a basic-attack state replaces the swing. A volley (basicMod)
     is a piercing line through the aimed target; thrown blades (basicRange)
     take the ranged path with the state's bonus folded into the packet and
     spend one of its count. */
  launchBasic(target) {
    if (this.basicMod) {
      Game.projectiles.push(Projectile.volley(this, target, this.basicMod));
      if (this.isPlayer) SFX.shoot();
      return;
    }
    const st = this.basicRangeState;
    if (st) {
      const pkt = this.attackPacket(target);
      pkt.amount += (rankVal(st.s, 'bonusDmg', st.rank) || 0) + this.curAtk() * (st.s.bonusScaleAd || 0);
      Game.projectiles.push(Projectile.homing(this, target, pkt));
      if (this.isPlayer) SFX.shoot();
      if (--st.count <= 0) this.endBasicRange();
      return;
    }
    super.launchBasic(target);
  }
  endBasicRange() {
    if (!this.basicRangeState) return;
    this.basicRangeState = null;
    this.recalcStats(false);
  }
  /* F8: the recharge of one charge at a rank. Cooldown reduction never
     touches it. */
  rechargeFor(s, rank) {
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    return Math.max(0.5, rankVal(s, 'recharge', r) || 0);
  }
  /* F8: one charge at a time refills; an idle counter below max starts one
     (which is also how a freshly learned skill begins at 0 charges). */
  tickCharges(dt) {
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (!s || !s.charges || this.skillRank[i] < 1 || this.skillCharges[i] >= s.charges) continue;
      if (!(this.skillRecharge[i] > 0)) this.skillRecharge[i] = this.rechargeFor(s, this.skillRank[i]);
      this.skillRecharge[i] -= dt;
      if (this.skillRecharge[i] <= 0) {
        this.skillCharges[i]++;
        this.skillRecharge[i] = this.skillCharges[i] < s.charges ? this.rechargeFor(s, this.skillRank[i]) : 0;
      }
    }
  }
  /* End a self state early (expiry or recast): its stat buffs go with it. */
  endState() {
    const st = this.state;
    if (!st) return;
    this.state = null;
    this.untargetable = false;
    for (const k of st.buffs) if (this.buffs[k]) this.buffs[k].t = 0;
    if (st.buffs.length) this.recalcStats(false);
  }
  /* F18: stop a channel. `interrupted` (a hard CC, a Flicker or Purify
     cast) leaves the cost paid and sets the cooldown to fullCd x
     interruptRefund; the payload never lands. */
  cancelChannel(interrupted) {
    const c = this.channelS;
    if (!c) return;
    this.channelS = null;
    if (interrupted) {
      const refund = c.s.interruptRefund !== undefined ? c.s.interruptRefund : 0.5;
      this.skillCd[c.i] = this.cooldownFor(c.s, c.rank) * refund;
    }
  }
  /* F23: the taunted hero walks at its source and swings when in reach.
     The player's queued input is dropped; bots path there. */
  updateTaunt(dt, f) {
    if (!this.cc.has('taunt') || !f.src || !f.src.alive) {
      this.forced = null;
      if (this.cc.t.taunt > 0) { this.cc.t.taunt = 0; this.cc.recount(); }
      return false;
    }
    if (this.isPlayer) { Input.casts.length = 0; Input.spellQueued = null; Input.recallQueued = false; }
    this.curTarget = f.src;
    if (this.inAttackRange(f.src)) this.tryAttack(f.src);
    else if (this.isPlayer) this.moveToward(f.src.x, f.src.y, dt);
    else this.botMoveTo(f.src.x, f.src.y, dt);
    return true;
  }

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
    this.lastDmgT = Game.time;
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
  onBasicLanded(target, dmg, pkt) {
    if (this.concealT > 0) this.revealT = Math.max(this.revealT, 1.6);
    this.fire('onBasicHit', target, dmg, pkt);
    if (this.resource === 'energy') this.gainEnergy((this.def0.energy && this.def0.energy.perBasic) || 0);
    else if (this.resource === 'heat') this.gainHeat(target, 'Basic');
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
    if (this.concealT > 0 && dmg) this.revealT = Math.max(this.revealT, 1.6);
    this.fire('onSkillHit', target, dmg, s);
    if (this.resource === 'heat') this.gainHeat(target, 'Skill');
    if (this.emblem && this.emblem.id === 'fighter') this.heal(dmg * 0.06);
    if (this.emblem && this.emblem.id === 'mage' && target.maxMana && (!target.usesMana || target.usesMana())) {
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
    // F8: a charge skill is learned empty and starts recharging at once
    if (this.skills[i].charges && this.skillRank[i] === 1) {
      this.skillCharges[i] = 0;
      this.skillRecharge[i] = this.rechargeFor(this.skills[i], 1);
    }
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
    if (this.channelS) this.cancelChannel(true);   // F18: casting a spell is choosing to stop
    this.spellCd = this.spell.cd;
    if (this.isPlayer) SFX.skill();
    return true;
  }

  /* Skill damage at its current rank. `s` may be a nested sub-skill (endNova),
     in which case it inherits the parent's rank via the explicit argument. */
  skillRankOf(s) {
    const i = this.skills.indexOf(s._base || s);   // _base: a per-cast copy (overheat, F5)
    return i >= 0 ? Math.max(1, this.skillRank[i]) : 1;
  }
  /* Skill damage before mitigation (docs/design/heroes.md F2). The optional
     `target` adds the victim-dependent terms: %-max-HP and missing-HP (capped
     against non-heroes, never against structures), the consumeMark bonus
     (F12), bonusVsMark and the caster's own missing-HP terms. Callers that
     hit several units call this once per victim. */
  skillDmg(s, rank, target, o) {
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    let dmg = (rankVal(s, 'dmg', r) || 0)
      + this.curAtk() * (s.scaleAd || 0)
      + this.magicPower() * (s.scaleAp || 0);
    if (s.selfMissingBonus) {
      const b = s.selfMissingBonus;
      const missing = 1 - this.hpPct;
      dmg *= 1 + Math.min(b.max || Infinity, missing / (b.per || 1) * (b.perPct || 0));
    }
    /* F21: the caster's own missing HP, computed once at cast for a multi-victim
       skill (o.selfMissing) so lifesteal off the first victim does not shrink it */
    if (o && o.selfMissing !== undefined) dmg += o.selfMissing;
    else if (s.selfMissingPct) dmg += this.selfMissingAmount(s, r);
    if (s.bank) dmg += this.bankedHp(s.bank);   // Marrow's Catacomb: the HP his skills cost lately
    if (target && !target.isStructure) {
      const hero = target.type === 'hero';
      if (s.pctMaxHp) {
        let v = target.maxHp * (rankVal(s, 'pctMaxHp', r) || 0);
        if (!hero && s.pctMaxHpCap) v = Math.min(v, s.pctMaxHpCap);
        dmg += v;
      }
      if (s.missingPct) {
        let v = (target.maxHp - target.hp) * (rankVal(s, 'missingPct', r) || 0);
        if (!hero && s.missingCap) v = Math.min(v, s.missingCap);
        dmg += v;
      }
      if (s.consumeMark && target.marks) dmg += markConsumeBonus(this, target, s.consumeMark, r);
      if (s.bonusVsMark && target.marks) {
        const b = s.bonusVsMark, at = target.marks[b.tag + 'At'];
        if (at !== undefined && Game.time - at <= (b.within || 0)) dmg *= b.mult || 1;
      }
    }
    if (s.dmgMult) dmg *= s.dmgMult;
    return dmg;
  }
  /* bank: {window, pct, capMaxHpPct} (F2/F6, Marrow's Catacomb). The HP
     paid for skills in the last `window` seconds (Hero.payCost keeps
     pv.bank), capped at capMaxHpPct of max HP, times pct. Bonus damage of
     the skill's own type; nothing when the passive keeps no bank. */
  bankedHp(b) {
    if (!this.pv || !this.pv.bank) return 0;
    let sum = 0;
    for (const e of this.pv.bank) if (Game.time - e.t <= (b.window || 6)) sum += e.amt;
    return Math.min(sum, this.maxHp * (b.capMaxHpPct || 1)) * (b.pct !== undefined ? b.pct : 1);
  }
  /* F21: selfMissingPct (per rank) of the caster's missing HP, capped at
     selfMissingCap of max HP. */
  selfMissingAmount(s, rank) {
    if (!s.selfMissingPct) return 0;
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    const cap = (s.selfMissingCap || 1) * this.maxHp;
    return Math.min(this.maxHp - this.hp, cap) * (rankVal(s, 'selfMissingPct', r) || 0);
  }
  skillHeal(s, rank) {
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    return (rankVal(s, 'heal', r) || 0) + this.magicPower() * (s.scaleAp || 0);
  }
  /* Cooldown of a skill at a rank after cooldown reduction (F1). Never
     under one second, whatever the reduction. */
  cooldownFor(s, rank) {
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    return Math.max(1, (rankVal(s, 'cd', r) || 0) * (1 - this.cdr()));
  }
  /* ---------- resource (docs/design/heroes.md F3-F6) ----------
     mana  : s.mana (per rank) from the mana bar
     energy: s.energy from a flat 0-100 pool that regenerates on its own
             terms (F4)
     heat  : free; at 100 the cast overheats (F5)
     hp    : s.hpCost as a fraction of max HP (F6), or s.mana when the skill
             has no hpCost (Pact's hybrid)
     none  : free, no bar */
  usesMana() { return this.resource === 'mana' || this.resource === 'hp'; }
  /* What a cast takes from the bar (mana or energy) at a rank. */
  costOf(s, rank) {
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    if (this.resource === 'energy') return rankVal(s, 'energy', r) || 0;
    if (this.resource === 'mana' || (this.resource === 'hp' && !s.hpCost)) return rankVal(s, 'mana', r) || 0;
    return 0;
  }
  canAfford(s, rank) {
    if (!s) return false;
    if (this.resource === 'hp' && s.hpCost) return this.hpPct >= (this.def0.hpFloor || 0);
    return this.mana >= this.costOf(s, rank);
  }
  /* Runs after the effect. An HP cost is never lethal (1 HP floor), is not a
     damage event (no passives, no kill credit, no spawn-protection break) and
     is banked for Marrow's Catacomb when the passive keeps a bank. */
  payCost(s, rank) {
    if (this.resource === 'hp' && s.hpCost) {
      const amt = Math.min(this.hp - 1, Math.floor(this.maxHp * s.hpCost));
      if (amt > 0) {
        this.hp -= amt;
        if (this.pv && this.pv.bank) {
          const bank = this.pv.bank;
          bank.push({ amt, t: Game.time });
          if (bank.length > 12) bank.splice(0, bank.length - 12);   // a match's worth never accumulates
        }
      }
      return;
    }
    const c = this.costOf(s, rank);
    if (c) this.mana = Math.max(0, this.mana - c);
  }
  /* Refunds and regeneration from passives, runes and the fountain are mana
     things: an energy, heat or cooldown hero ignores them. */
  gainMana(v) {
    if (!(v > 0) || !this.usesMana()) return;
    this.mana = Math.min(this.maxMana, this.mana + v);
  }
  gainEnergy(v) {
    if (this.resource !== 'energy' || !v) return;
    this.mana = clamp(this.mana + v, 0, this.maxMana);
  }
  /* F5: heat from a hit that landed (`kind` is 'Basic' or 'Skill'). Dot
     ticks never reach onBasicLanded/onSkillLanded, so they never count. */
  gainHeat(target, kind) {
    const ht = this.def0.heat;
    if (!ht) return;
    const v = target.type === 'hero' ? ht['gain' + kind + 'Hero'] : ht['gain' + kind];
    if (v) this.mana = Math.min(100, this.mana + v);
  }
  /* Per-frame resource movement: mana regen, energy trickle and battery
     charge, heat burn-up and decay. */
  tickResource(dt) {
    const res = this.resource;
    if (res === 'mana' || res === 'hp') {
      this.mana = Math.min(this.maxMana,
        this.mana + (this.maxMana * BALANCE.manaRegenPct + this.attrs.get('manaRegen')) * dt);
      return;
    }
    if (res === 'energy') {
      const e = this.def0.energy || {};
      let gain = (e.regen || 0) * dt;
      if (e.stillRegen) {
        // a dash or forced movement counts as moving; so does any real step since last frame
        const dx = this.x - this._sx, dy = this.y - this._sy;
        if (dx * dx + dy * dy > 0.25 || this.dashS || this.forced) this.stillT = 0;
        else this.stillT += dt;
        if (this.stillT >= (e.stillDelay || 0)) gain += e.stillRegen * dt;
      }
      if (gain) this.mana = clamp(this.mana + gain, 0, this.maxMana);
      return;
    }
    if (res === 'heat') {
      const ht = this.def0.heat || {};
      let burning = false;
      if (ht.burnPerSec) {
        const tag = ht.burnTag || 'burn';
        for (const e of Game.heroes) {
          if (e.team === this.team || !e.alive) continue;
          for (const d of e.dots) if (d.src === this && d.tag === tag) { burning = true; break; }
          if (burning) break;
        }
      }
      if (burning) this.mana = Math.min(100, this.mana + ht.burnPerSec * dt);
      else if (Game.time - this.lastDmgT > (ht.decayDelay || 4)) this.mana = Math.max(0, this.mana - (ht.decay || 5) * dt);
    }
  }
  /* One skill hit on one victim: per-victim damage (F2), CC at rank (F1),
     marks (F12) and the on-hit hooks. Novas, zones, dashes, blinkstrikes,
     projectiles, traps and tethers all land through here. `o` may carry
     `mult` (an explosion's 0.8), `pen`, `slowPct` (a zone tick's ramp),
     `crit` (pre-rolled, F28), `noCC` and `zone` (centre stacks, F12). */
  skillHit(u, s, rank, o) {
    let amount = this.skillDmg(s, rank, u, o);
    if (o && o.mult) amount *= o.mult;
    let dealt = 0;
    if (amount > 0) {
      const pkt = { amount, type: s.dmgType || 'physical', skill: s };
      if (o && o.pen) pkt.pen = o.pen;
      if (o && o.crit) pkt.critRolled = true;
      dealt = resolveDamage(this, u, pkt);
    }
    if (!(o && o.noCC)) applySkillCC(this, u, s, rank, o);
    // markOnHit: a timestamp mark (marks[tag + 'At']) another skill's bonusVsMark reads (Karn's hook)
    if (s.markOnHit && u.marks && !u.isStructure) u.marks[s.markOnHit + 'At'] = Game.time;
    if (s.applyMark) applyMark(this, u, s, rank, o);
    if (s.consumeMark) consumeMark(this, u, s, rank);
    if (s.refreshMark) refreshMark(this, u, s.refreshMark);
    if (dealt) this.onSkillLanded(u, dealt, s);
    return dealt;
  }
  /* ---------- tethers (docs/design/heroes.md F16) ----------
     A hostile tether (Anchor's chain, Hexa's drain, Karn's Gaol) from this
     hero to `target`: each frame the slow lerps slowStart -> slowEnd, every
     `interval` the tick damage lands (healPct of it back to the caster), at
     the end `payload` lands, and crossing breakRange snaps it (breakPayload).
     One per caster unless the skill is `multi`. */
  tetherTo(target, s, rank) {
    const tt = s.tether;
    if (!tt || !target || !target.alive) return null;
    if (!tt.multi) for (const t of Game.tethers) if (!t.dead && t.hostile && t.src === this && !t.multi) t.dead = true;
    const h = this, r = rank || this.skillRankOf(s);
    const dmgType = s.dmgType || 'magic';
    const tickDmg = tt.tickDmg || tt.tickScaleAp
      ? (rankVal(tt, 'tickDmg', r) || 0) + this.magicPower() * (tt.tickScaleAp || 0) : 0;
    const t = Game.addTether({
      src: h, target, hostile: true, s, rank: r, t: tt.dur || 2, breakRange: tt.breakRange || Infinity,
      interval: tt.interval || 0, anchored: !!tt.anchored, multi: !!tt.multi, drawColor: h.color,
      onFrame(tr, dt) {
        if (tt.slowStart === undefined && tt.slowEnd === undefined) return;
        let pct = lerp(tt.slowStart || 0, tt.slowEnd !== undefined ? tt.slowEnd : (tt.slowStart || 0), Math.min(1, tr.elapsed / tr.dur));
        // F19 tetherSlowMult / tetherSlowCap (Weigh Anchor): the live tether's slow is multiplied, to a cap
        const st = h.state && h.state.t > 0 ? h.state.s : null;
        if (st && st.tetherSlowMult) pct = Math.min(st.tetherSlowCap || 0.95, pct * st.tetherSlowMult);
        if (pct > 0) target.cc.applySlow(Math.min(0.95, pct), 0.2, target.attrs ? target.attrs.get('tenacity') : 0);
      },
      onTick() {
        if (!tickDmg) return;
        const dealt = resolveDamage(h, target, { amount: tickDmg, type: dmgType, skill: s });
        if (dealt) {
          h.onSkillLanded(target, dealt, s);
          if (tt.healPct) { h.heal(dealt * tt.healPct); Game.fx.drainFx(h, Math.round(dealt * tt.healPct)); }
        }
      },
      onComplete() {
        h.lastTetherDone = { t: Game.time, target };   // F29 (Hexa's hint): Black Mass on the burst
        if (!tt.payload || !target.alive) return;
        const p = Object.assign({ dmgType }, tt.payload);
        h.skillHit(target, p, r);
        if (p.spreadMark) {
          const sm = p.spreadMark;
          for (const u of Game.enemyUnits(h.team, { neutral: true })) {
            if (dist(u, target) <= (sm.radius || 0) + u.radius) applyMark(h, u, { applyMark: sm }, r);
          }
        }
      },
      onBreak() {
        if (!tt.breakPayload || !target.alive) return;
        h.skillHit(target, Object.assign({ dmgType }, tt.breakPayload), r);
      },
    });
    return t;
  }
  /* A friendly link (Sylva's Vine Link and Canopy) from this hero to an
     ally: every `interval` the ally is healed (no passive triggers) and
     hastened, the caster gains armour / magic resist. Only one link per
     caster unless `all`; on the same ally the larger tick wins. */
  linkTo(ally, s, rank) {
    const lk = s.link;
    if (!lk || !ally || !ally.alive || ally === this) return null;
    const h = this, r = rank || this.skillRankOf(s);
    const tickHeal = (rankVal(lk, 'tickHeal', r) || 0) + this.magicPower() * (lk.tickScaleAp || 0);
    for (const t of Game.tethers) {
      if (t.dead || t.hostile || t.src !== this) continue;
      if (t.target === ally) { if (t.tickHeal >= tickHeal) return t; t.dead = true; }
      else if (!lk.all && !t.all) t.dead = true;
    }
    const hold = (lk.interval || 0.5) + 0.15;
    return Game.addTether({
      src: h, target: ally, hostile: false, s, rank: r, t: lk.dur || 4, breakRange: lk.breakRange || Infinity,
      interval: lk.interval || 0.5, all: !!lk.all, tickHeal, drawColor: THEME.heal,
      onTick() {
        if (tickHeal > 0) { const healed = ally.heal(tickHeal); h.stats.healDone += healed; }
        if (lk.targetSpeedAdd) ally.addTimedBuff('speed', lk.targetSpeedAdd, hold);
        if (lk.casterArmorAdd) h.addTimedBuff('armor', lk.casterArmorAdd, hold);
        if (lk.casterMrAdd) h.addTimedBuff('mr', lk.casterMrAdd, hold);
      },
    });
  }
  /* F9: put an object down; `maxActive` per owner and mode drops the oldest. */
  placeObject(mode, s, x, y, rank, dir) {
    const max = s.maxActive || 1;
    const mine = Game.objects.filter(o => !o.dead && o.owner === this && o.mode === mode);
    for (let i = 0; i + max <= mine.length; i++) mine[i].dead = true;
    const o = new PlacedObject(this, s, x, y, rank || this.skillRankOf(s), mode, dir);
    Game.objects.push(o);
    return o;
  }
  /* F17: the allied hero a cast lands on. The one nearest the aim point
     within range; with no aim (bots, an untouched joystick) the lowest-HP
     ally in range. `self: false` excludes the caster. */
  pickAllyTarget(s, point) {
    const a = s.allyTarget;
    let best = null, bd = Infinity;
    for (const h of Game.heroes) {
      if (h.team !== this.team || !h.alive || (h === this && !a.self)) continue;
      if (dist(this, h) > (a.range || 500)) continue;
      const score = point ? Math.hypot(h.x - point.x, h.y - point.y) : h.hpPct;
      if (score < bd) { bd = score; best = h; }
    }
    return best;
  }
  /* F28: the CC state calls back when a timer starts. An airborne drops a
     dash in progress; a channel (F18) breaks on any hard CC. */
  onCC(type) {
    if (type === 'airborne') { this.dashS = null; this.endBasicRange(); }
    if (this.channelS && CHANNEL_BREAKERS[type]) this.cancelChannel(true);
  }

  attackPacket() {
    return { amount: this.curAtk(), type: 'physical', canCrit: true, isBasic: true };
  }

  onDamaged(src, dmg, packet) {
    this.hitFlash = 0.14;
    this.lastDmgT = Game.time;
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
    this.state = null; this.untargetable = false; this.channelS = null; this.basicRangeState = null; this.basicMod = null; this.recast = null; this.buffState = null;
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
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    /* canCrit (F28): one roll for the whole cast, so a crit Cleave crits everyone */
    let o = null;
    if (s.canCrit) {
      const chance = this.attrs.get('critChance');
      if (chance > 0 && Math.random() < chance) {
        o = { mult: COMBAT.CRIT_DMG_BASE + this.attrs.get('critDmg'), crit: true };
      }
    }
    if (s.selfMissingPct) { o = o || {}; o.selfMissing = this.selfMissingAmount(s, r); }   // F21: once per cast
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (dist(this, u) <= s.radius + u.radius) this.skillHit(u, s, r, o);
    }
  }
  /* F22 recast Return: dash back to the stored takeoff point at the recast
     speed, no damage, no CC, unhookable, free. Uses Flicker's wall back-off
     so a point that has since become rock stops short along the line. */
  dashBackTo(rc) {
    const spec = (rc.s && rc.s.recast) || {};
    const dx0 = rc.x - this.x, dy0 = rc.y - this.y, d0 = Math.hypot(dx0, dy0);
    if (d0 < 1) return true;
    const dir = { x: dx0 / d0, y: dy0 / d0 };
    let distBack = d0;
    if (Game.wallAt(rc.x, rc.y, this.radius + 8)) {
      distBack = 0;
      for (let t = 0.95; t >= 0.15; t -= 0.05) {
        if (!Game.wallAt(this.x + dir.x * d0 * t, this.y + dir.y * d0 * t, this.radius + 8)) { distBack = d0 * t; break; }
      }
    }
    this.recallT = 0;
    this.dashS = {
      dx: dir.x, dy: dir.y, remaining: distBack, speed: spec.speed || 1300,
      dmg: 0, hitSet: new Set(), s: null, stopOnHero: false, endNova: null, rank: 1, unhookable: true,
    };
    Game.fx.ghost(this);
    Game.fx.flash(this.x, this.y, 34, this.color);
    if (this.isPlayer) SFX.skill();
    return true;
  }
  /* Cone (F11): instant; every enemy unit whose circle meets the sector
     (apex = caster, `angle` degrees wide, `length` long, along `dir`) is
     hit once. The unit's disc widens the angular test by asin(r/d), so a
     body straddling the edge is inside. Drawn as a fan for 0.2 s. */
  doCone(s, rank, dir) {
    const r = rank !== undefined ? rank : this.skillRankOf(s);
    const aim = Math.atan2(dir.y, dir.x);
    const half = ((s.angle || 60) / 2) * Math.PI / 180, len = s.length || 400;
    let n = 0;
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      const dx = u.x - this.x, dy = u.y - this.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d - u.radius > len) continue;
      let diff = Math.abs(Math.atan2(dy, dx) - aim) % TAU;
      if (diff > Math.PI) diff = TAU - diff;
      const reach = half + (d > u.radius ? Math.asin(u.radius / d) : Math.PI);
      if (diff > reach) continue;
      this.skillHit(u, s, r);
      n++;
    }
    if (Game.fx.fan) Game.fx.fan(this.x, this.y, aim, half, len, this.color);
    return n;
  }

  castSkill(i, point) {
    const s0 = this.skills[i];
    const rank = this.skillRank[i];
    if (!this.alive || !s0) return false;
    // F19 recastCancel: pressing an active self state again ends it early, free
    if (s0.recastCancel && this.state && this.state.t > 0 && (this.state.s._base || this.state.s) === s0) {
      this.endState();
      return true;
    }
    // F22 recast: while the Return is open, the button flies back instead of casting
    if (this.recast && this.recast.skillIdx === i) {
      const rc = this.recast;
      if (Game.time >= rc.until) this.recast = null;   // expired: nothing happens, the cast below applies
      else {
        if (!this.cc.canCast || this.dashS || this.forced || this.channelS) return false;
        this.recast = null;
        return this.dashBackTo(rc);
      }
    }
    const ox = this.x, oy = this.y;   // the takeoff point a recast returns to
    if (this.skillCd[i] > 0 || !this.canAfford(s0, rank)) return false;
    if (rank < 1) return false;                          // ultimate not learned yet
    if (s0.charges && !(this.skillCharges[i] > 0)) return false;   // F8: nothing banked
    if (!this.cc.canCast || this.dashS || this.forced || this.channelS) return false;
    if (this.state && this.state.t > 0 && this.state.s.noAttack) return false;   // F19
    this.recallT = 0;
    /* F5 overheat: at 100 heat this cast uses the skill's overheat variant
       (a per-cast copy; `_base` keeps rank and index lookups working) and
       the gauge empties. */
    let s = s0, overheated = false;
    if (this.resource === 'heat' && this.mana >= 100 && s0.overheat) {
      s = Object.assign({}, s0, s0.overheat, { _base: s0 });
      overheated = true;
    }
    let dir;
    if (point && (point.x !== this.x || point.y !== this.y)) dir = norm(point.x - this.x, point.y - this.y);
    else dir = { x: Math.cos(this.facing), y: Math.sin(this.facing) };
    this.facing = Math.atan2(dir.y, dir.x);
    let castAt = null;
    /* F17: an ally-targeted skill needs someone to land on, or it is not cast */
    let ally = null;
    if (s.allyTarget) {
      ally = this.pickAllyTarget(s, point);
      if (!ally) return false;
      castAt = { x: ally.x, y: ally.y };
    }

    switch (s.type) {
      case 'skillshot':
        Game.projectiles.push(Projectile.skillshot(this, s, dir));
        break;
      case 'tether': {   // F16 hostile: one hero in the aim cone, or every hero around (multi)
        const tt = s.tether || {};
        const victims = [];
        if (tt.multi) {
          for (const e of Game.heroes) {
            if (e.team !== this.team && e.alive && !e.untargetable && dist(this, e) <= tt.multi.radius) victims.push(e);
          }
        } else {
          const reach = s.targetRange || s.range || 500;
          const half = ((s.targetCone || 360) / 2) * Math.PI / 180;
          let best = null, bd = Infinity, nearest = null, nd = Infinity;
          for (const e of Game.heroes) {
            if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
            const d = dist(this, e);
            if (d > reach) continue;
            if (d < nd) { nd = d; nearest = e; }
            const ang = Math.atan2(e.y - this.y, e.x - this.x);
            let diff = Math.abs(ang - this.facing) % TAU;
            if (diff > Math.PI) diff = TAU - diff;
            if (diff > half) continue;
            if (d < bd) { bd = d; best = e; }
          }
          if (!best && s.targetFallback) best = nearest;   // Hexa's thread: nobody in the cone, take the nearest in reach
          if (best) victims.push(best);
        }
        if (!victims.length) return false;   // nothing to chain: no cost
        for (const v of victims) this.tetherTo(v, s, rank);
        castAt = { x: victims[0].x, y: victims[0].y };
        break;
      }
      case 'trap':       // F9: an armed object at the aim point, hero-only by default
      case 'object': {   // F9: a pulsing lantern at the aim point
        const reach = s.range || 400;
        let tx = point ? point.x : this.x + dir.x * reach;
        let ty = point ? point.y : this.y + dir.y * reach;
        const dd = Math.hypot(tx - this.x, ty - this.y);
        if (dd > reach) { tx = this.x + (tx - this.x) / dd * reach; ty = this.y + (ty - this.y) / dd * reach; }
        const spot = Game.clampPoint({ x: tx, y: ty }, 40);
        if (Game.wallAt(spot.x, spot.y, 12)) return false;   // nothing is planted inside rock
        this.placeObject(s.type === 'trap' ? 'trap' : 'pulse', s, spot.x, spot.y, rank, dir);
        castAt = spot;
        break;
      }
      case 'channel': {  // F18: stand and channel; the payload nova lands at the end
        this.channelS = { s, t: s.channel || 1, i, rank };
        Game.fx.ring(this.x, this.y, (s.payload && s.payload.radius) || 200, this.color, s.channel || 1);
        break;
      }
      case 'basicMod': {    // F7: basics become piercing volleys for dur seconds
        this.basicMod = { s, rank, t: s.dur || 6, asMult: rankVal(s, 'asMult', rank) || 1 };
        Game.fx.ring(this.x, this.y, this.radius + 30, this.color, 0.5);
        break;
      }
      case 'basicRange': {  // F25: the next `count` basics are thrown from rangeSet
        this.basicRangeState = { s, rank, count: s.count || 3, t: s.dur || 4 };
        this.recalcStats(false);
        Game.fx.ring(this.x, this.y, this.radius + 24, this.color, 0.4);
        break;
      }
      case 'selfState': {   // F19: a timed state on the caster (immunities, root, untargetable...)
        const dur = s.dur || 1;
        this.state = { s, t: dur, buffs: [] };
        this.untargetable = !!s.untargetable;   // nobody's target while it runs (dots keep ticking)
        if (s.armorAdd) { this.addTimedBuff('armor', s.armorAdd, dur); this.state.buffs.push('armor'); }
        if (s.mrAdd) { this.addTimedBuff('mr', s.mrAdd, dur); this.state.buffs.push('mr'); }
        if (s.speedPct) { this.addTimedBuff('speedPct', s.speedPct, dur); this.state.buffs.push('speedPct'); }
        if (s.untargetable) { this.curTarget = null; }
        Game.fx.ring(this.x, this.y, this.radius + 30, this.color, 0.5);
        break;
      }
      case 'barrier': {  // F9: a wall segment across the aim direction that eats enemy projectiles
        const off = s.offset || 80;
        const o = this.placeObject('barrier', s, this.x + dir.x * off, this.y + dir.y * off, rank, dir);
        castAt = { x: o.x, y: o.y };
        break;
      }
      case 'link': {     // F16 friendly: heal the ally once, then keep a link on them
        if (s.heal || s.healLv) {
          const healed = ally.heal(this.skillHeal(s, rank));
          this.stats.healDone += healed;
          Game.fx.healFx(ally, Math.round(healed));
          this.fire('onHealAlly', ally, healed);
        }
        this.linkTo(ally, s, rank);
        break;
      }
      case 'nova':
        this.doNova(s);
        break;
      case 'cone':       // F11: an instant sector along the aim
        this.doCone(s, rank, dir);
        castAt = { x: this.x + dir.x * (s.length || 400), y: this.y + dir.y * (s.length || 400) };
        break;
      case 'dash': {
        if (s.buff) { this.buffAsMult = s.buff.asMult || 1; this.buffAsT = s.buff.dur || 3; }
        /* F22: dashToPoint stops at the aim point when that is nearer than
           dist; dashBack flies the other way from the aim */
        let ddx = dir.x, ddy = dir.y, remaining = s.dist;
        if (s.dashBack) { ddx = -ddx; ddy = -ddy; }
        if (s.dashToPoint && point) remaining = Math.min(s.dist, Math.hypot(point.x - this.x, point.y - this.y));
        this.dashS = {
          dx: ddx, dy: ddy, remaining, speed: s.speed,
          dmg: s.dmg ? this.skillDmg(s, this.skillRank[i]) : 0, hitSet: new Set(), s,
          stopOnHero: !!s.stopOnHero, endNova: s.endNova || null,
          rank: this.skillRank[i], keepFacing: !!s.dashBack,
        };
        castAt = { x: this.x + ddx * remaining, y: this.y + ddy * remaining };
        break;
      }
      case 'allybuff': {   // F26: attack speed and move speed for every allied hero around (incl. self)
        const asAdd = rankVal(s, 'asAdd', rank) || 0, dur = s.dur || 3, rad = s.radius || 380;
        for (const h of Game.heroes) {
          if (h.team !== this.team || !h.alive || dist(this, h) > rad) continue;
          if (asAdd) h.addTimedBuff('atkSpd', asAdd, dur);
          if (s.spdAdd) h.addTimedBuff('speed', s.spdAdd, dur);
          if (h !== this) Game.fx.ring(h.x, h.y, h.radius + 18, this.color, 0.4);
        }
        Game.fx.ring(this.x, this.y, rad, this.color, 0.5);
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
        let amt = this.skillHeal(s, rank);
        if (s.healFromCost && s.hpCost) amt += Math.floor(this.maxHp * s.hpCost) * s.healFromCost;   // Pact's Offering
        for (const h of Game.heroes) {
          if (ally ? h !== ally : !(h.team === this.team && h.alive && dist(this, h) <= s.radius)) continue;
          const healed = h.heal(amt);
          this.stats.healDone += healed;
          if (s.shieldPct) h.addShield(h.maxHp * s.shieldPct, 3);
          Game.fx.healFx(h, Math.round(amt));
          this.fire('onHealAlly', h, healed);
          if (s.link && s.link.all && h !== this) this.linkTo(h, s, rank);   // Sylva's Canopy
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
        this.skillHit(best, s, this.skillRank[i], { pen: { pct: s.physPenPct || 0 } });
        Game.fx.ring(this.x, this.y, 80, this.color, 0.35);
        Game.fx.slash(best.x, best.y, this.facing, this.team);
        break;
      }
      case 'buff': {
        this.buffState = { s, t: s.dur || 3 };
        if (s.atkMult) { this.buffAtkMult = s.atkMult; this.buffAtkT = s.dur; }
        if (s.spdAdd) this.addTimedBuff('speed', s.spdAdd, s.dur);
        if (s.tenacityAdd) this.addTimedBuff('tenacity', s.tenacityAdd, s.dur);
        if (s.hotPct) this.hot = { rate: this.maxHp * s.hotPct / s.dur, t: s.dur };
        Game.fx.ring(this.x, this.y, 100, this.color, 0.6);
        break;
      }
    }
    /* F27: a damage skill's own shield and resist buffs land on the caster after the effect
       (a selfState owns its armorAdd / mrAdd for its own duration, see above) */
    if (s.type !== 'selfState') {
      if (s.selfShieldPct) this.addShield(this.maxHp * s.selfShieldPct, s.selfShieldDur || 3);
      const bd = s.buffDur || 3;
      if (s.armorAdd) this.addTimedBuff('armor', s.armorAdd, bd);
      if (s.mrAdd) this.addTimedBuff('mr', s.mrAdd, bd);
    }
    // F22: open the Return window; the cooldown below starts now, the Return itself is free
    if (s.recast) this.recast = { x: ox, y: oy, until: Game.time + (s.recast.window || 3), skillIdx: i, s: s0 };
    this.payCost(s0, rank);
    if (overheated) { this.mana = 0; Game.fx.ring(this.x, this.y, this.radius + 30, this.color, 0.5); }
    if (s0.charges) {
      // F8: spend a charge; the recharge starts if none is running; castDelay (with cdr) gates the next shot
      this.skillCharges[i]--;
      if (!(this.skillRecharge[i] > 0)) this.skillRecharge[i] = this.rechargeFor(s0, rank);
      this.skillCd[i] = (s0.castDelay || 0) * (1 - this.cdr());
    } else this.skillCd[i] = this.cooldownFor(s0, rank);
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
    this.tickCharges(dt);
    if (this.buffAtkT > 0) this.buffAtkT -= dt;
    if (this.buffAsT > 0) this.buffAsT -= dt;
    if (this.basicMod) { this.basicMod.t -= dt; if (this.basicMod.t <= 0) this.basicMod = null; }
    if (this.buffState) { this.buffState.t -= dt; if (this.buffState.t <= 0) this.buffState = null; }
    if (this.basicRangeState) { this.basicRangeState.t -= dt; if (this.basicRangeState.t <= 0) this.endBasicRange(); }
    if (this.recast && Game.time >= this.recast.until) this.recast = null;   // F22: an unused Return just closes
    if (this.revealT > 0) this.revealT -= dt;
    if (this.concealT > 0) this.concealT -= dt;
    if (this.state) { this.state.t -= dt; if (this.state.t <= 0) this.endState(); }
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
    this.tickResource(dt);
    this._sx = this.x; this._sy = this.y;
    this.gainXp(BALANCE.passiveXpPerSec * dt);

    // movement the hero does not choose: a hook drag, a shove or pull (F15), a taunt (F23)
    if (this.forced && this.updateForced(dt)) { this.trackVelocity(dt); return; }
    // active dash
    if (this.dashS) {
      const d = this.dashS;
      const step = Math.min(d.remaining, d.speed * dt);
      this.x += d.dx * step; this.y += d.dy * step;
      d.remaining -= step;
      if (!d.keepFacing) this.facing = Math.atan2(d.dy, d.dx);   // a dashBack keeps facing the enemy
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
            this.skillHit(u, d.s, d.rank);
            if (d.stopOnHero && u.type === 'hero') d.remaining = 0;
          }
        }
      }
      if (d.remaining <= 0.5) {
        if (d.endNova) { this.doNova(d.endNova, d.rank); Game.fx.skillCast(this, d.endNova, null); }
        if (d.s && d.s.energyRefund) this.gainEnergy(d.s.energyRefund);   // F22: Recoil lands with Focus back
        this.dashS = null;
      }
      this.trackVelocity(dt);
      return;
    }
    // F18 channel: rooted and silent until the payload lands or a hard CC breaks it
    if (this.channelS) {
      const c = this.channelS;
      c.t -= dt;
      if (this.isPlayer) Input.casts.length = 0;
      if (c.t <= 0) {
        this.channelS = null;
        if (c.s.payload) {
          this.doNova(c.s.payload, c.rank);
          Game.fx.skillCast(this, c.s.payload, null);
          Game.fx.shake(4);
        }
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
        const maxR = s.range || s.dist || (s.allyTarget && s.allyTarget.range) || 500;
        const fr = c.dist ? clamp((c.dist - 20) / 70, 0.3, 1) : 1;
        const pull = (s.type === 'zone' || s.dashToPoint) ? fr : 1;   // F22: a short joystick pull shortens a leap-to-point
        point = { x: this.x + c.dir.x * maxR * pull, y: this.y + c.dir.y * maxR * pull };
      } else if (!s.allyTarget) {
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
    if (!best || best.type !== 'hero') this.botIdlePlant();
  }
  /* F29 (Quill's hint): with no hero to fight, a botBush trap goes at the
     nearest bush centre inside its range that has none of his traps within
     200 and no enemy turret over it, until maxActive - 1 are down (the last
     is kept for planting under a hero in a fight). */
  botIdlePlant() {
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (!s || s.type !== 'trap' || !s.botBush || this.skillRank[i] < 1 || this.skillCd[i] > 0 || !this.canAfford(s, this.skillRank[i])) continue;
      if (this.usesMana() && this.maxMana && this.mana < this.maxMana * this.p.farmManaFloor) continue;
      const mine = Game.objects.filter(o => !o.dead && o.owner === this && o.mode === 'trap');
      if (mine.length >= (s.maxActive || 1) - 1) continue;
      let best = null, bd = s.range || 400;
      for (const b of Game.bushes()) {
        const d = this.distTo(b);
        if (d >= bd || d < 80) continue;
        if (mine.some(o => Math.hypot(o.x - b.x, o.y - b.y) < 200)) continue;
        if (this.enemyTowerCovering(b)) continue;
        bd = d; best = b;
      }
      if (best) this.castSkill(i, { x: best.x, y: best.y });
    }
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
      if (!s || this.skillRank[i] < 1 || this.skillCd[i] > 0 || !this.canAfford(s, this.skillRank[i])) continue;
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
    const lowMana = this.usesMana() && this.maxMana > 0 && this.mana / this.maxMana < this.p.manaRecallPct && this.hpPct < 0.9;
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
    if (!s) return false;
    const c = s.payload || s;   // a channel's nova (F18)
    if (c.stun || c.immobilize || c.airborne || c.silence || c.hook || c.suppress || c.taunt) return true;
    const p = s.tether && s.tether.payload;   // a tether that roots on completion (F16)
    return !!(p && (p.stun || p.immobilize || p.airborne || p.silence || p.suppress));
  }
  /* F29 (Anchor's bot hint). The live hostile tether from this hero, if any. */
  liveTether() {
    for (const t of Game.tethers) if (!t.dead && t.hostile && t.src === this && t.target && t.target.alive) return t;
    return null;
  }
  /* Is a non-hero enemy body (a creep) on the line from here to `t` within
     the shot's width? A non-pierce line is blocked by it. */
  lineBlocked(t, s) { return this.lineBlockedFrom(this.x, this.y, t, s); }
  lineBlockedFrom(x0, y0, t, s) {
    const dx = t.x - x0, dy = t.y - y0, len2 = dx * dx + dy * dy;
    if (len2 < 1) return false;
    const w = (s.radius || 24);
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (u.type === 'hero' || u === t) continue;
      const k = clamp(((u.x - x0) * dx + (u.y - y0) * dy) / len2, 0, 1);
      const px = x0 + dx * k - u.x, py = y0 + dy * k - u.y, r = w + u.radius;
      if (px * px + py * py <= r * r) return true;
    }
    return false;
  }
  /* The hero a tether line should go at: the most mobile visible enemy hero
     (most dash / blink skills) inside botRange on a clear line; else the
     target itself. */
  tetherPick(s, t) {
    const reach = s.botRange || s.range || 500;
    let best = null, bm = -1, bd = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
      const d = this.distTo(e);
      if (d >= reach || this.lineBlocked(e, s)) continue;
      const m = e.skills.filter(k => k && (k.type === 'dash' || k.type === 'blinkstrike' || k.dashToPoint)).length;
      if (m > bm || (m === bm && d < bd)) { bm = m; bd = d; best = e; }
    }
    return best || t;
  }
  /* A tethered target inside `radius` of this hero who is about to slip the
     line: past half its break range and moving away. */
  tetherEscaping(radius) {
    const tt = this.liveTether();
    if (!tt) return false;
    const e = tt.target, dx = e.x - this.x, dy = e.y - this.y, d = Math.sqrt(dx * dx + dy * dy);
    return d < radius + e.radius && d > tt.breakRange * 0.5 && (e.vx || 0) * dx + (e.vy || 0) * dy > 0;
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
    let retreatAt = clamp(p.retreatHp + this.adapt.caution, 0.08, 0.6);
    // botRetreatWhenDown (F29, Omen's hint): with the escape on cooldown, fall back earlier
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i];
      if (s && s.botRetreatWhenDown && this.skillRank[i] >= 1 && this.skillCd[i] > 0 && s.botRetreatWhenDown > retreatAt) retreatAt = s.botRetreatWhenDown;
    }
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
      if (allies < p.objectiveMinAllies + (mo.epic === 'lord' ? BALANCE.lordExtraAllies : 0)) continue;
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
      if (!s || this.skillRank[i] < 1) continue;
      // F22: the Return is the cleanest exit there is
      if (this.recast && this.recast.skillIdx === i && Game.time < this.recast.until) { this.castSkill(i, null); continue; }
      if (this.skillCd[i] > 0 || !this.canAfford(s, this.skillRank[i])) continue;
      if (s.charges && !(this.skillCharges[i] > 0)) continue;   // F8
      if (s.type === 'heal') { if (this.hpPct < 0.7) this.castSkill(i, null); continue; }
      // F29 (Quill's hint): a trap goes down between him and the chaser as he runs
      if (s.type === 'trap') {
        if (threat && bd < 700) { const k = Math.min(1, 140 / Math.max(1, bd)); this.castSkill(i, { x: this.x + (threat.x - this.x) * k, y: this.y + (threat.y - this.y) * k }); }
        continue;
      }
      // a self-buff (Rampage's regen and tenacity) is at its best mid-escape
      if (s.type === 'buff') { if (threat && bd < 560) this.castSkill(i, null); continue; }
      // F22: a dashBack flies away from the aim, so it is aimed AT the chaser
      if (s.type === 'dash' && s.dashBack) { if (threat && bd < 620) this.castSkill(i, { x: threat.x, y: threat.y }); continue; }
      if (s.type === 'dash' && threat && bd < 620) this.castSkill(i, this.escapeDashPoint(s, threat));
    }
  }
  /* Where a dash away from `threat` should land. Dashes ignore terrain —
     that is the whole reason a wall is an escape tool rather than a second
     health bar. A bot that only ever dashes directly away throws that away:
     the same 340 units spent crossing a rock forces the chaser to walk all
     the way round it, which is worth far more than the 340 units themselves.
     So the candidate directions are scored, and putting a wall between us
     and the chaser outweighs raw distance gained. Landing inside a wall is
     rejected outright. */
  escapeDashPoint(s, threat) {
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
    return { x: this.x + Math.cos(bestA) * s.dist, y: this.y + Math.sin(bestA) * s.dist };
  }
  /* Any visible enemy hero within `r`? */
  enemyHeroWithin(r) {
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable) continue;
      if (this.distTo(e) < r && Game.canSee(this.team, e)) return true;
    }
    return false;
  }
  /* The nearest visible melee enemy hero within `r`, or null. */
  meleeThreat(r) {
    let best = null, bd = r;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.ranged || e.untargetable) continue;
      const d = this.distTo(e);
      if (d < bd && Game.canSee(this.team, e)) { bd = d; best = e; }
    }
    return best;
  }
  /* F29 (Zephyr's / Vesper's hint): the melee hero a botKite dash should
     carry this marksman away from — one inside s.botKite; with
     botKiteNoCharges (Sidestep) only once the first skill has no charge
     left to shoot him with. */
  kiteThreat(s) {
    if (s.botKiteNoCharges && this.skillCharges[0] > 0) return null;
    return this.meleeThreat(s.botKite);
  }
  /* F29 (Vesper's hint): is this bot in a fight around `t`? It dealt or
     took damage in the last 2 s, or an ally has engaged near the target. */
  inFight(t) { return Game.time - this.lastDmgT < 2 || (t && this.allyEngagedNear(t)); }
  /* F29 (Lumen's hint): a unit that cannot run right now — slowed, rooted,
     stunned, airborne, suppressed or channelling. */
  unitHeld(u) { return !!(u && u.cc && (u.cc.has('slow') || !u.cc.canMove || u.channelS)); }
  /* F29 (Ignis's / Mira's hint): does `t` carry at least botMark.stacks of
     the botMark.tag mark (a skill-owned mark or a passive's, F12)? */
  botMarkOk(bm, t) {
    return !!(bm && t && t.type === 'hero' && t.marks && markStacks(t, bm.tag) >= (bm.stacks || 1));
  }
  /* The nearest visible enemy hero inside `r` carrying the botMark stacks, or null. */
  markedHeroWithin(bm, r) {
    let best = null, bd = r;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable) continue;
      const d = this.distTo(e);
      if (d < bd && this.botMarkOk(bm, e) && Game.canSee(this.team, e)) { bd = d; best = e; }
    }
    return best;
  }
  /* F29: the distance a botHold hero keeps from its target right now. The
     def's botHold, shrunk to a mark-consuming skill's ring while that skill
     is ready and a hero within its botMark.walkIn carries the stacks (Ignis
     walks in for Flashburn); replaced by a live tether's botKiteHold (Hexa
     backs off to 400-580 while her thread holds). 0 when the def has none. */
  botHoldNow() {
    let hold = this.def0.botHold || 0;
    if (!hold) return 0;
    for (let i = 0; i < 3; i++) {
      const s = this.skills[i], bm = s && s.botMark;
      if (!bm || !bm.walkIn || this.skillRank[i] < 1 || this.skillCd[i] > 0 || !this.canAfford(s, this.skillRank[i])) continue;
      // walkInStacks: the stacks that start the walk (Ignis goes in at one Ember: the ring pays per stack)
      if (this.markedHeroWithin({ tag: bm.tag, stacks: bm.walkInStacks || bm.stacks }, bm.walkIn)) hold = Math.min(hold, (s.radius || 260) - 60);
    }
    const tt = this.liveTether();
    if (tt && tt.s && tt.s.botKiteHold) hold = tt.s.botKiteHold;
    return hold;
  }
  /* F29 (Volt's hint): is there another enemy unit (not a structure) inside
     the shot's bounce range of `t` for the arc to jump to? */
  bounceCompany(s, t) {
    const r = (s.bounce && s.bounce.range) || 300;
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (u === t || u.isStructure || !u.alive) continue;
      if (u.distTo(t) < r) return true;
    }
    return false;
  }
  /* F29 (Quill's / Mira's / Nadir's hint): the lone-target case of a
     botCrowd zone: a target carrying the skill's botMark stacks (Glacial
     Prison at 3 Chill), under its botExecuteHp (Implosion under 40%), or,
     with neither field, one who is held (Killbox on a slowed hero). */
  crowdZoneSingleOk(s, t) {
    if (!t || t.type !== 'hero') return false;
    if (s.botMark) return this.botMarkOk(s.botMark, t);
    if (s.botExecuteHp) return t.hpPct < s.botExecuteHp;
    // F29 (Hexa's hint): Black Mass on the completion burst: her thread ran its course on this hero within botAfterTether seconds
    if (s.botAfterTether) { const ld = this.lastTetherDone; return !!(ld && ld.target === t && Game.time - ld.t < s.botAfterTether); }
    return this.unitHeld(t);
  }
  /* F29 (Hexa's hint): the live hostile tether's target when it is inside
     the shot's range, else null. */
  tetheredInReach(s) {
    const tt = this.liveTether();
    if (!tt || !tt.target.alive || tt.target.untargetable) return null;
    return this.distTo(tt.target) < (s.range || 500) * 0.95 ? tt.target : null;
  }
  /* F29 (Mira's hint): is `t` standing inside a lingering zone of this hero's? */
  inOwnLinger(t) {
    for (const z of Game.zones) {
      if (z.dead || z.owner !== this || !(z.lingerT > 0)) continue;
      if (hyp(t.x - z.x, t.y - z.y) <= z.radius + t.radius) return true;
    }
    return false;
  }
  /* F29 (Mira's hint): the point between this hero and `threat`, inside the
     skill's cast range: 60% of the way toward the threat so the patch
     covers the ground it must cross, never past the range. */
  betweenPoint(s, threat) {
    const dx = threat.x - this.x, dy = threat.y - this.y, d = Math.hypot(dx, dy) || 1;
    const k = Math.min(0.6 * d, s.range || 500) / d;
    return { x: this.x + dx * k, y: this.y + dy * k };
  }
  /* F29 (Nadir's hint): an enemy hero inside `r` whom this hero displaced
     (Heavy from him, F15) and who is still stunned: the moment after an
     Implosion lands. */
  pulledHeroInside(r) {
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || !e.marks || this.distTo(e) >= r + e.radius) continue;
      if (e.marks.heavyBy === this && e.marks.heavyUntil > Game.time && e.cc.has('stun')) return e;
    }
    return null;
  }
  /* F29 (Volt's hint): a visible enemy hero inside `r` who is on this bot:
     targeting it, or having damaged it in the last 1.5 s. */
  diverInRing(r) {
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || this.distTo(e) >= r || !Game.canSee(this.team, e)) continue;
      if (e.curTarget === this || e.aiTarget === this) return e;
      if (this.recentDmg.some(k => k.h === e && Game.time - k.t < 1.5)) return e;
    }
    return null;
  }
  /* F29 (Volt's hint): a target a multi-tick zone can sit on: a Tank or
     Fighter (the frontliner), or a hero standing still (under 30 u/s)
     while this bot is in a fight around them. */
  frontlineTarget(t) {
    if (!t || t.type !== 'hero') return false;
    const role = t.def0 && t.def0.role;
    if (role === 'Tank' || role === 'Fighter') return true;
    return Math.hypot(t.vx || 0, t.vy || 0) < 30 && this.inFight(t);
  }
  /* F29 (Quill's hint): enemy heroes a zone centred on `t` would cover;
     with botAttacking (Ashara's hint) only those not retreating from this
     hero (moving away at over 60 u/s does not count). */
  zoneCrowd(s, t) {
    let n = 0;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || h.distTo(t) >= s.radius + h.radius) continue;
      if (s.botAttacking && this.retreatingFromMe(h)) continue;
      n++;
    }
    return n;
  }
  /* Is `u` walking away from this hero (its velocity away from here over 60 u/s)? */
  retreatingFromMe(u) {
    const dx = u.x - this.x, dy = u.y - this.y, d = Math.hypot(dx, dy) || 1;
    return ((u.vx || 0) * dx + (u.vy || 0) * dy) / d > 60;
  }
  /* F29 (Ashara's hint): where a veil for the allied group goes: the
     centroid of the allied heroes (this one included) within `r`. */
  allyGroupPoint(r) {
    let x = 0, y = 0, n = 0;
    for (const h of Game.heroes) {
      if (h.team !== this.team || !h.alive || this.distTo(h) > r) continue;
      x += h.x; y += h.y; n++;
    }
    return n ? { x: x / n, y: y / n } : { x: this.x, y: this.y };
  }
  /* F29 (Vesper's hint): where a botClearLine dash should land so the
     first skill (a charge shot that stops on the first unit) has a clear
     line to `t`: only when it has a charge and the line from here is
     blocked; six landings around the target are tried, nearest to the
     current heading first, each inside the shot's range and off rock.
     Null when nothing opens the line. */
  clearLinePoint(s, t) {
    const gun = this.skills[0];
    if (!gun || !gun.charges || !(this.skillCharges[0] > 0) || !this.lineBlocked(t, gun)) return null;
    const a0 = Math.atan2(t.y - this.y, t.x - this.x);
    for (const off of [1.05, -1.05, 1.57, -1.57, 2.1, -2.1]) {
      const a = a0 + off, lx = this.x + Math.cos(a) * s.dist, ly = this.y + Math.sin(a) * s.dist;
      if (Game.wallAt(lx, ly, this.radius)) continue;
      if (Math.hypot(t.x - lx, t.y - ly) >= gun.range * 0.95) continue;
      if (!this.lineBlockedFrom(lx, ly, t, gun)) return { x: lx, y: ly };
    }
    return null;
  }
  /* F29 (Zephyr's hint): the enemy heroes within `lr` of this hero and
     whether two of them stand roughly on one line from here (the second
     within 90 units of the ray through the first), which is what a
     piercing volley wants. */
  volleyLine(lr) {
    const near = [];
    for (const h of Game.heroes) if (h.team !== this.team && h.alive && !h.untargetable && this.distTo(h) < lr) near.push(h);
    let aligned = false;
    for (let i = 0; i < near.length && !aligned; i++) {
      const ax = near[i].x - this.x, ay = near[i].y - this.y, ad = Math.hypot(ax, ay) || 1;
      for (let j = 0; j < near.length; j++) {
        if (j === i) continue;
        const bx = near[j].x - this.x, by = near[j].y - this.y;
        const along = (bx * ax + by * ay) / ad;
        if (along <= 0) continue;
        const perp = Math.abs(bx * ay - by * ax) / ad;
        if (perp <= 90) { aligned = true; break; }
      }
    }
    return { near: near.length, aligned };
  }

  botSkillUrgency(i, t, d, isHero, farmOk) {
    const s = this.skills[i];
    const p = this.p;
    if (!s || this.skillRank[i] < 1) return 0;
    // F22: an open Return outranks everything when the dive went wrong
    if (this.recast && this.recast.skillIdx === i && Game.time < this.recast.until) {
      let near = 0;
      for (const h of Game.heroes) if (h.team !== this.team && h.alive && this.distTo(h) < 300) near++;
      return (this.hpPct < 0.45 || near >= 2) ? 950 : 0;
    }
    if (this.skillCd[i] > 0 || !this.canAfford(s, this.skillRank[i])) return 0;
    if (s.charges && !(this.skillCharges[i] > 0)) return 0;   // F8
    if (s.botMinHp && this.hpPct < s.botMinHp) return 0;      // never below this HP (Grom's channel, Marrow's HP costs)
    if (s.botMinMana && this.mana < s.botMinMana) return 0;   // F29 (Lumen's hint): Railshot only from 60 Focus
    // botOwnHpBelow: the skill is for when the caster is hurt (Torren's Toll, Cinder's Furnace)
    const ownLow = s.botOwnHpBelow ? this.hpPct < s.botOwnHpBelow : false;
    if (i === 2 && s.type !== 'basicMod') {
      if (!isHero) return 0;
      // F29 (Vesper's / Lumen's hint): a pure execute (botExecuteOnly) waits for its threshold whatever the
      // crowd; with botCcOk a slowed, rooted, stunned or channelling target qualifies too
      if (s.botExecuteOnly && t.hpPct > (s.botExecuteHp || p.ultExecuteHp) && !(s.botCcOk && this.unitHeld(t))) return 0;
      const crowd = Game.heroes.filter(h => h.team !== this.team && h.alive && this.distTo(h) < 420).length;
      // F29 (Anchor's hint): Harbour also answers a tethered target slipping the line;
      // botExecuteHp: the skill's own execute threshold (Omen's End at 60%)
      if (t.hpPct > (s.botExecuteHp || p.ultExecuteHp) && crowd < 2 && !ownLow &&
          !(s.botAllyEngaged && this.allyEngagedNear(t)) &&   // F29 (Omen's hint): an ally has engaged
          !(s.tether && s.tether.multi && this.gaolCrowd(s).leaving) &&   // F29 (Karn's hint): someone is leaving
          !(s.type === 'zone' && s.wallStun && s.knockback && this.wallShoveDir(t, s.knockback + 10)) &&   // F29 (Tide's hint): a wall to throw at
          !(s.type === 'zone' && s.botCrowd && (this.zoneCrowd(s, t) >= 2 || this.crowdZoneSingleOk(s, t))) &&   // F29 (Quill's / Mira's hint): a crowd in the box, or one hero who qualifies alone
          !(s.botCcOk && this.unitHeld(t)) &&   // F29 (Lumen's hint): a target that cannot run
          !(s.type === 'zone' && s.botMark && this.botMarkOk(s.botMark, t)) &&   // F29 (Ignis's hint): a target already carrying the mark
          !(s.type === 'zone' && s.botFrontline && this.frontlineTarget(t)) &&   // F29 (Volt's hint): a frontliner, or a hero standing still in a fight
          !(s.type === 'nova' && this.tetherEscaping(s.radius))) return 0;
    }
    const locked = isHero && this.unitLockedDown(t);
    const cc = this.skillHasHardCC(s);
    switch (s.type) {
      case 'skillshot':
        if (d >= s.range * 0.95 || !(isHero || farmOk)) return 0;
        if (s.heroOnly && !isHero) return 0;   // F20: it flies straight through creeps
        // F29 (Vesper's hint): a shot that stops on the first unit is held while a creep is on the line to the hero
        if (s.botClearLine && isHero && this.lineBlocked(t, s)) return 0;
        // F29 (Vesper's hint): out of a fight keep botBank charges for the fight; in one, dump them
        if (s.charges && s.botBank && this.skillCharges[i] <= s.botBank && !this.inFight(t)) return 0;
        if (s.hook) {     // F29 (Karn's hint): only an unblocked, isolated hero, carries first
          if (!isHero) return 0;
          const pick = this.hookPick(s);
          if (!pick) return 0;
          return this.unitLockedDown(pick) ? 500 : 840;
        }
        // F29 (Tide's hint): a wave that stuns on rock is best when the push through the target meets a wall
        if (s.wallStun && s.knockback && isHero && this.wallBehind(t, t.x - this.x, t.y - this.y, s.knockback + 10)) return 850;
        if (s.tether) {   // F16 / F29 (Anchor's hint): heroes only, inside botRange, no creep on the line, one at a time
          if (!isHero || d >= (s.botRange || s.range * 0.95) || this.liveTether()) return 0;
          const pick = this.tetherPick(s, t);
          if (this.lineBlocked(pick, s)) return 0;
          return this.unitLockedDown(pick) ? 500 : 820;
        }
        if (locked && !cc) return 860;
        if (cc && isHero && !locked) return 820;
        // F29 (Volt's hint): a bouncing shot is best when a second enemy unit stands inside its bounce range of the target
        if (s.bounce && s.botBounce && isHero && this.bounceCompany(s, t)) return 720;
        // F29 (Mira's hint): Frost Shard into the field: a hero standing in one of her lingering patches
        if (s.botField && isHero && this.inOwnLinger(t)) return 700;
        // F29 (Nadir's hint): Singularity on whoever retreats: a hero moving away from him
        if (s.botRetreating && isHero && (t.vx || 0) * (t.x - this.x) + (t.vy || 0) * (t.y - this.y) > 40 * d) return 700;
        // F29 (Hexa's hint): Hex Bolt the tethered target while the thread holds (botFireSkill aims at it)
        if (s.botTethered && isHero && this.tetheredInReach(s)) return 720;
        // F29 (Quill's hint): a boomerang is best at a hero walking toward him, so the return pass crosses them too
        if (s.boomerang && isHero && (t.vx || 0) * (this.x - t.x) + (t.vy || 0) * (this.y - t.y) > 40 * d) return 560;
        return isHero ? 500 : 220;
      case 'cone':       // F11: instant, so it wants the target well inside its length
        if (d >= (s.length || 400) - 20 || !(isHero || farmOk)) return 0;
        if (locked && !cc) return 850;
        if (cc && isHero && !locked) return 815;
        return isHero ? 510 : 220;
      case 'nova': {
        /* heroes inside the ring, whoever the bot's own target is: a crowd is
           worth the cast even when the target itself stands outside */
        let near = 0;
        const hot = !!(s.overheat && this.overheatReady());   // F5: the Overheated variant's ring counts
        const nr = hot && s.overheat.radius ? s.overheat.radius : s.radius;
        for (const h of Game.heroes) {
          if (h.team !== this.team && h.alive && this.distTo(h) < nr + h.radius) near++;
        }
        /* F29 (Ignis's hint): a mark-consuming ring (botMark with walkIn) fires only when a
           hero inside `within` carries the stacks, or when he is under botOwnHpBelow with
           anyone in the ring; at 0 Embers it is harmless, so it is never a crowd tool */
        if (s.consumeMark && s.botMark && s.botMark.walkIn) {
          if (ownLow && near >= 1) return 860;
          const reach = s.botMark.within || s.radius;
          if (this.markedHeroWithin(s.botMark, reach)) return 880;
          /* against bots that step out of a 0.9 s meteor a third Ember is a once-a-match event
             (measured: one 3-Ember window in 16 minutes), so a hero inside the ring carrying
             any Ember is still worth the ring as a routine nuke (+65 +20% MAGIC per stack) */
          return this.markedHeroWithin({ tag: s.botMark.tag, stacks: 1 }, reach) ? 520 : 0;
        }
        // F29 (Nadir's hint): Crush right after the detonation: a hero he just pulled (Heavy from him) still stunned inside the ring
        if (s.botAfterPull && this.pulledHeroInside(s.radius)) return 900;
        if (near >= 2) return hot ? 900 : 880;
        // F29 (Volt's hint): a botMelee ring (Flashover) is held for a melee hero reaching it (830) or, since a
        // diver's window inside 240 is too short for the think tick to catch a melee there (measured: none in
        // 16 minutes), for any hero inside it who is attacking this bot (800)
        if (s.botMelee) return this.meleeThreat(s.radius + 20) ? 830 : this.diverInRing(s.radius + 20) ? 800 : 0;
        if (i === 2 && this.tetherEscaping(s.radius)) return 880;   // F29 (Anchor's hint)
        // F29 (Karn's hint): Iron Slam straight after a hook, while the mark's bonus still applies
        if (s.bonusVsMark && this.markedHeroInside(s)) return 900;
        /* F29 (Cinder's hint): at 100 Heat the Overheated Haymaker wants 2+ heroes in its
           wider ring (900, above); with one hero it is held for Coal Dash when a
           marksman or mage is within the dash's reach and the dash is ready */
        if (s.overheat && this.overheatReady()) {
          const dash = this.skills[1];
          if (dash && dash.type === 'dash' && this.skillCd[1] <= 0 && this.carryWithin(dash.dist || 320)) return 0;
        }
        // F29 (Brass's hint): a crowd tool waits for 2+ heroes inside, or one hero inside who is on an
        // ally (botAllyWithin: with that ally close enough to matter)
        if (s.botCrowd) {
          if (!this.guardTarget(s.radius + t.radius, 0)) return 0;
          return (!s.botAllyWithin || this.allyWithin(s.botAllyWithin)) ? 820 : 0;
        }
        if (ownLow && near >= 1) return 860;   // F29 (Torren's hint): Reaver's Toll under 50% HP with a hero inside
        if (d >= s.radius + t.radius) return 0;
        if (!isHero && !farmOk) return 0;
        if (locked && !cc) return 840;
        if (cc && isHero && !locked) return 800;
        return isHero ? 480 : 200;
      }
      case 'dash':
        if (s.dashBack) return isHero && d < (s.botKite || 260) ? 600 : 0;   // F22 / F29 (Lumen's hint): a hop away from whoever got close
        // F29 (Zephyr's / Vesper's hint): a marksman's dash goes away from a melee hero inside botKite
        if (s.botKite && this.kiteThreat(s)) return 800;
        // F29 (Vesper's hint): Sidestep to a spot with a clear line when the hammer has a charge and a creep blocks it
        if (s.botClearLine && isHero && this.clearLinePoint(s, t)) return 760;
        // F29 (Brass's hint): Shoulder any enemy hero attacking an allied hero within its reach
        if (s.botGuardAlly && isHero && this.guardTarget(s.dist)) return 800;
        // F29 (Omen's hint): fresh from a takedown, Pass onto the next-lowest hero in reach
        if (s.resetOnKill && !s.stopOnHero && this.chainTarget(s.dist)) return 800;
        // F29 (Cinder's hint): at 100 Heat the Overheated Coal Dash goes onto the nearest marksman or mage in reach
        if (s.overheat && isHero && this.overheatReady() && this.carryWithin(s.dist)) return 850;
        if (d <= 150 || d >= s.dist + 100) return 0;
        if (!(isHero || (farmOk && (s.dmg || s.endNova)))) return 0;
        if (isHero && this.advancedAI && !this.gapCloseLegal(t)) return 0;
        // F29 (Zephyr's hint): a carry's engage dash (botWithAlly) waits for an ally to be on the target
        if (s.botWithAlly && isHero && !this.allyEngagedNear(t)) return 0;
        return cc && isHero && !locked ? 780 : 360;
      case 'zone':
        if (d >= s.range || !(isHero || farmOk)) return 0;
        // F29 (Ignis's hint): Pyroclasm centred on a target already carrying an Ember
        if (s.botMark && !s.botCrowd && isHero && this.botMarkOk(s.botMark, t)) return 860;
        // F29 (Volt's hint): Thunderhead on the enemy frontliner, or on a hero standing still in a fight
        if (s.botFrontline && isHero && this.frontlineTarget(t)) return 820;
        // F29 (Quill's hint): a crowd zone (botCrowd) wants 2+ heroes inside its radius around the target, or one who is held
        if (s.botCrowd) {
          if (!isHero) return 0;
          if (this.zoneCrowd(s, t) >= 2) return 880;
          return this.crowdZoneSingleOk(s, t) ? 820 : 0;
        }
        // F29 (Ashara's hint): Sand Veil on herself with a melee enemy inside botVeil.melee, or on the allied
        // group with an enemy hero inside botVeil.enemy (aimed by botFireSkill); never on creeps
        if (s.botVeil) {
          if (!isHero) return 0;
          if (this.meleeThreat(s.botVeil.melee || 300)) return 850;
          return this.enemyHeroWithin(s.botVeil.enemy || 600) ? 700 : 0;
        }
        // F29 (Mira's hint): Rime Field between her and a melee threat inside botBetween (aimed by botFireSkill),
        // or on the target once an ally has engaged it; otherwise a routine drop on a hero
        if (s.botBetween) {
          if (this.meleeThreat(s.botBetween)) return 800;
          if (isHero && this.allyEngagedNear(t)) return 600;
        }
        // F29 (Tide's hint): High Water when the target can be thrown into a wall
        if (s.wallStun && s.knockback && isHero && this.wallShoveDir(t, s.knockback + 10)) return 850;
        if (s.bank) {   // F29 (Marrow's hint): Catacomb on 2+ heroes in its radius, best within 6 s of two other casts
          let near = 0;
          for (const h of Game.heroes) if (h.team !== this.team && h.alive && h.distTo(t) < s.radius + h.radius) near++;
          if (near < 2 && !(isHero && t.hpPct < 0.35)) return 0;
          let paid = 0;
          if (this.pv && this.pv.bank) for (const e of this.pv.bank) if (Game.time - e.t <= (s.bank.window || 6)) paid++;
          return paid >= 2 ? 880 : 720;
        }
        if (cc && isHero && !locked) return 810;
        return isHero ? 520 : 210;
      case 'heal': {
        const patient = s.allyTarget ? this.pickAllyTarget(s, null) : this.lowestHealTarget(s.radius || 360);
        // botHealHp: the skill's own threshold (Marrow's Splint at 60%)
        if (!patient || patient.hpPct >= (s.botHealHp || (this.advancedAI ? p.healAllyHp : 0.65))) return 0;
        return patient.hpPct < 0.4 ? 980 : 900;
      }
      case 'blinkstrike':
        if (!isHero || d >= s.range) return 0;
        if (this.advancedAI && !this.gapCloseLegal(t)) return 0;
        return t.hpPct < 0.35 ? 870 : 540;
      case 'buff':
        if (!isHero || d >= 300) return 0;
        // F29 (Cinder's hint): a steroid with botOwnHpBelow (Furnace) waits until she is hurt
        if (s.botOwnHpBelow) return ownLow ? 720 : 0;
        return 420;
      case 'tether': {   // F16: chain a hero in reach
        if (!isHero) return 0;
        const tt = s.tether || {};
        if (tt.multi) {
          /* F29 (Karn's hint): Gaol on 2+ heroes inside botRadius (300), best when
             one of them is already retreating; a lone hero who is leaving is
             chained too (nobody leaves), a crowd not leaving yet is still worth it */
          const g = this.gaolCrowd(s);
          if (g.n >= 2) return g.leaving ? 880 : 720;
          return g.leaving ? 840 : 0;
        }
        const reach = s.targetRange || s.range || 500;
        if (d >= reach) return 0;
        return locked ? 500 : 640;
      }
      case 'link': {     // F16/F17: link the ally who needs it
        const patient = this.pickAllyTarget(s, null);
        if (!patient || patient.hpPct >= 0.8) return 0;
        return patient.hpPct < 0.45 ? 900 : 620;
      }
      case 'trap':       // F9: plant under an approaching hero
        if (!isHero || d >= (s.range || 400)) return 0;
        return 330;
      case 'object':     // F9: a lantern goes down where the fight is
        if (!isHero || d >= 700) return 0;
        return 350;
      case 'barrier':    // F9 / F29 (Bastion's hint): a gate against a ranged hero within 700 who is on an ally
        return this.barrierThreat() ? 520 : 0;
      case 'channel': {  // F18: a channelled nova wants a crowd in its radius and no interrupt waiting
        const pr = (s.payload && s.payload.radius) || 300;
        if (!isHero || d >= pr + t.radius - 40) return 0;
        let near = 0;
        for (const h of Game.heroes) if (h.team !== this.team && h.alive && this.distTo(h) < pr + h.radius) near++;
        if (near < 2) return 0;
        if (this.enemyInterruptReady(pr + 260)) return 0;
        return 860;
      }
      case 'selfState': { // F19: vanish when in danger; dig in when the enemy is on top of you
        if (!isHero) return 0;
        if (s.untargetable) return this.hpPct < 0.5 && d < 450 ? 760 : 0;
        if (s.tetherSlowMult) {   // F29 (Anchor's hint): Weigh Anchor when the tethered target is slowed inside 400
          const tt = this.liveTether();
          return tt && tt.target.cc.has('slow') && this.distTo(tt.target) < 400 ? 760 : 0;
        }
        return d < 300 ? 420 : 0;
      }
      case 'basicMod': { // F7 / F29 (Zephyr's hint): the volley wants 2+ heroes inside its line, best roughly lined up
        const lr = s.lineRange || 420;
        if (!isHero || d >= lr) return 0;
        const v = this.volleyLine(lr);
        if (v.near >= 2) return v.aligned ? 900 : 640;
        return t.hpPct < p.ultExecuteHp ? 560 : 0;   // a lone hero only when the volley can finish them
      }
      case 'basicRange': // F25: thrown blades for a target just past melee reach
        if (!isHero || d < 150 || d >= (s.rangeSet || 300)) return 0;
        return 560;
      case 'allybuff': { // F26: when someone it would reach (self included) is on an enemy hero
        if (!isHero) return 0;
        const rad = s.radius || 380;
        for (const h of Game.heroes) {
          if (h.team !== this.team || !h.alive || this.distTo(h) > rad) continue;
          if (h.distTo(t) < 520) return 520;
        }
        return 0;
      }
    }
    return 0;
  }

  /* F29 (Grom's bot hint): a visible enemy hero within `reach` who could
     cancel a channel right now — a stun, silence, airborne, suppress or taunt
     skill that is learned, off cooldown and affordable, and a caster who is
     not locked down herself. */
  enemyInterruptReady(reach) {
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || this.distTo(e) > reach || !Game.canSee(this.team, e)) continue;
      if (!e.cc.canCast) continue;
      for (let j = 0; j < 3; j++) {
        const s = e.skills[j];
        if (!s || e.skillRank[j] < 1 || e.skillCd[j] > 0 || !e.canAfford(s, e.skillRank[j])) continue;
        const cc = s.payload || s.endNova || s;
        if (cc.stun || cc.silence || cc.airborne || cc.suppress || cc.taunt || s.hook) return e;
      }
    }
    return null;
  }

  /* F29 (Bastion's bot hint): the ranged enemy hero a gate should face — the
     nearest visible one between 120 and 700 away who is attacking or aiming
     at one of our heroes. Whatever the bot's own target is, the gate answers
     the archer. */
  barrierThreat() {
    let best = null, bd = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || !e.ranged || e.untargetable) continue;
      const d = this.distTo(e);
      if (d >= 700 || d < 120 || d >= bd || !Game.canSee(this.team, e)) continue;
      if (!this.rangedThreatensAlly(e)) continue;
      bd = d; best = e;
    }
    return best;
  }
  /* Is this enemy ranged hero attacking or aiming at one of our heroes (self
     included)? Its current target, or any allied hero inside its reach plus
     a step. */
  rangedThreatensAlly(e) {
    const ct = e.curTarget;
    if (ct && ct.type === 'hero' && ct.team === this.team && ct.alive) return true;
    const reach = (e.range || 300) + 120;
    for (const a of Game.heroes) {
      if (a.team !== this.team || !a.alive) continue;
      if (a.distTo(e) <= reach) return true;
    }
    return false;
  }

  /* F29 (Grom's bot hint): a stopOnHero dash is a pick, so it goes at the
     lowest-HP ranged hero it can reach (the backline), else at the target. */
  dashPick(s, t) {
    // F29 (Zephyr's / Vesper's hint): a botKite dash flies away from the melee hero who got close
    if (s.botKite) { const m = this.kiteThreat(s); if (m) return this.escapeDashPoint(s, m); }
    if (!t || t.type !== 'hero') return t;
    // F29 (Vesper's hint): Sidestep lands where the hammer has a clear line to the target
    if (s.botClearLine) { const c = this.clearLinePoint(s, t); if (c) return c; }
    /* F29 (Torren's hint): a leap-to-point (F22) lands short of the
       lowest-HP-percent hero it can reach, so the slam covers the body. */
    if (s.dashToPoint) {
      let pick = t, bh = t.hpPct;
      for (const e of Game.heroes) {
        if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
        const d = this.distTo(e);
        if (d > s.dist || d <= 150 || e.hpPct >= bh) continue;
        bh = e.hpPct; pick = e;
      }
      const d = this.distTo(pick);
      if (d <= 60) return pick;
      const k = Math.max(0, d - 60) / d;
      return { x: this.x + (pick.x - this.x) * k, y: this.y + (pick.y - this.y) * k };
    }
    if (!s.stopOnHero) {
      // F29 (Omen's hint): after a kill or assist the step goes through the next-lowest hero
      if (s.resetOnKill) { const c = this.chainTarget(s.dist); if (c) return c; }
      // F29 (Cinder's hint): the Overheated Coal Dash lands on the nearest marksman or mage in reach
      if (s.overheat && this.overheatReady()) { const c = this.carryWithin(s.dist); if (c) return c; }
      /* F29 (Tide's hint): Surge to the open side of a target standing next to
         a wall, so the target ends up between Tide and the rock for the wave */
      if (s.botOpenSide) {
        const w = this.wallShoveDir(t, 170);
        if (w) {
          const lx = t.x - w.x * 140, ly = t.y - w.y * 140;
          if (Math.hypot(lx - this.x, ly - this.y) <= s.dist + 40 && !Game.wallAt(lx, ly, this.radius)) return { x: lx, y: ly };
        }
      }
      // never aim a dash whose landing is inside rock: turn to the nearest open angle
      const a0 = Math.atan2(t.y - this.y, t.x - this.x);
      for (const off of [0, 0.35, -0.35, 0.7, -0.7]) {
        const a = a0 + off, lx = this.x + Math.cos(a) * s.dist, ly = this.y + Math.sin(a) * s.dist;
        if (!Game.wallAt(lx, ly, this.radius)) return off === 0 ? t : { x: lx, y: ly };
      }
      return t;
    }
    // F29 (Brass's hint): the guard's shoulder goes at whoever is on an ally
    if (s.botGuardAlly) { const g = this.guardTarget(s.dist); if (g) return g; }
    let best = null, bh = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || !e.ranged || !Game.canSee(this.team, e)) continue;
      const d = this.distTo(e);
      if (d > s.dist || d <= 150) continue;
      if (e.hpPct < bh) { bh = e.hpPct; best = e; }
    }
    return best || t;
  }
  /* F29 (Brass's hint): the visible enemy hero between `minD` and `reach`
     away who is attacking one of our other heroes (its current target),
     lowest HP first. */
  guardTarget(reach, minD = 150) {
    let best = null, bh = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
      const ct = e.curTarget;
      if (!ct || ct.type !== 'hero' || ct.team !== this.team || ct === this || !ct.alive) continue;
      const d = this.distTo(e);
      if (d > reach || d <= minD || e.hpPct >= bh) continue;
      bh = e.hpPct; best = e;
    }
    return best;
  }
  /* Another allied hero alive within `r`. */
  allyWithin(r) {
    for (const a of Game.heroes) if (a !== this && a.team === this.team && a.alive && this.distTo(a) <= r) return true;
    return false;
  }
  /* F29 (Omen's hint): an allied hero within 450 of `t` who dealt or took
     damage in the last 2 s — the fight is already on. */
  allyEngagedNear(t) {
    for (const a of Game.heroes) {
      if (a === this || a.team !== this.team || !a.alive || a.distTo(t) > 450) continue;
      if (Game.time - a.lastDmgT < 2) return true;
    }
    return false;
  }
  /* F29 (Karn's hint): the hero a hook should go at — visible, inside 95% of
     the range, past 120, no creep on the line, isolated (no second enemy
     hero within 400 of it); marksmen and mages first, then the lowest HP.
     Null when nobody qualifies: the hook is held. */
  hookPick(s) {
    const reach = (s.range || 600) * 0.95;
    let best = null, bc = -1, bh = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
      const d = this.distTo(e);
      if (d >= reach || d <= 120 || this.lineBlocked(e, s)) continue;
      let alone = true;
      for (const o of Game.heroes) if (o !== e && o.team === e.team && o.alive && o.distTo(e) < 400) { alone = false; break; }
      if (!alone) continue;
      const role = e.def0 && e.def0.role;
      const carry = role === 'Marksman' || role === 'Mage' ? 1 : 0;
      if (carry > bc || (carry === bc && e.hpPct < bh)) { bc = carry; bh = e.hpPct; best = e; }
    }
    return best;
  }
  /* F29 (Cinder's hint): the gauge is full, so the next cast Overheats (F5). */
  overheatReady() { return this.resource === 'heat' && this.mana >= 100; }
  /* F29 (Cinder's hint): the nearest visible enemy marksman or mage between
     100 and `reach` away, or null. */
  carryWithin(reach) {
    let best = null, bd = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
      const role = e.def0 && e.def0.role;
      if (role !== 'Marksman' && role !== 'Mage') continue;
      const d = this.distTo(e);
      if (d > reach || d <= 100 || d >= bd) continue;
      bd = d; best = e;
    }
    return best;
  }
  /* F29 (Tide's hint): does a push of `reach` through `t` along (dx, dy) meet
     rock or a turret? The same test the displacement tween runs (Game.wallAt
     with the victim's radius), sampled along the vector. */
  wallBehind(t, dx, dy, reach) {
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    return !!Game.wallOnSegment(t.x, t.y, t.x + ux * reach, t.y + uy * reach, t.radius, reach + 1);
  }
  /* F29 (Tide's hint): a unit vector from `t` toward a wall within `reach`
     of it (12 directions sampled, the one closest to straight away from this
     hero first), or null in the open. */
  wallShoveDir(t, reach) {
    const away = Math.atan2(t.y - this.y, t.x - this.x);
    for (let k = 0; k < 12; k++) {
      const a = away + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 6);
      const ux = Math.cos(a), uy = Math.sin(a);
      if (this.wallBehind(t, ux, uy, reach)) return { x: ux, y: uy };
    }
    return null;
  }
  /* F29 (Karn's hint): the enemy heroes inside a multi tether's botRadius
     (else its radius) and how many of them are leaving: moving away faster
     than 40 u/s, or a bot that has decided to retreat or flee. */
  gaolCrowd(s) {
    const tt = s.tether || {};
    const r = s.botRadius || (tt.multi && tt.multi.radius) || 320;
    let n = 0, leaving = 0;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || h.untargetable) continue;
      const dx = h.x - this.x, dy = h.y - this.y, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd >= r) continue;
      n++;
      if ((h.vx || 0) * dx + (h.vy || 0) * dy > 40 * dd || h.aiState === 'retreat' || h.fleeT > 0) leaving++;
    }
    return { n, leaving };
  }
  /* F29 (Karn's hint): an enemy hero inside the nova whose bonusVsMark mark
     is still fresh (a hook landed within `within` seconds). */
  markedHeroInside(s) {
    const b = s.bonusVsMark;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || !h.marks || this.distTo(h) >= s.radius + h.radius) continue;
      const at = h.marks[b.tag + 'At'];
      if (at !== undefined && Game.time - at <= (b.within || 0)) return h;
    }
    return null;
  }
  /* F29 (Omen's hint): within 3 s of a hero kill or assist, the lowest-HP
     visible enemy hero between 60 and `reach` away; null otherwise. */
  chainTarget(reach) {
    if (Game.time - this.lastTakedownT > 3) return null;
    let best = null, bh = Infinity;
    for (const e of Game.heroes) {
      if (e.team === this.team || !e.alive || e.untargetable || !Game.canSee(this.team, e)) continue;
      const d = this.distTo(e);
      if (d > reach || d <= 60 || e.hpPct >= bh) continue;
      bh = e.hpPct; best = e;
    }
    return best;
  }

  botFireSkill(i, t, d, isHero, farmOk) {
    const s = this.skills[i];
    switch (s.type) {
      case 'skillshot': {
        // F29 (Hexa's hint): a botTethered shot goes at the hero on her thread
        const at = s.tether ? this.tetherPick(s, t) : s.hook ? (this.hookPick(s) || t) : (s.botTethered && this.tetheredInReach(s)) || t;
        this.castSkill(i, Game.aimLeadPoint(this, at, s.speed));
        break;
      }
      case 'nova':
        this.castSkill(i, t);
        break;
      case 'cone':
        this.castSkill(i, t);
        break;
      case 'dash':
        this.castSkill(i, this.dashPick(s, t));
        break;
      case 'zone': {
        // F29 (Tide's hint): centre a wall-slamming zone so its outward throw sends the target at the rock
        const w = s.wallStun && s.knockback && t.type === 'hero' ? this.wallShoveDir(t, s.knockback + 10) : null;
        // F29 (Mira's hint): a botBetween patch goes between her and the melee threat
        const threat = s.botBetween ? this.meleeThreat(s.botBetween) : null;
        // F29 (Ashara's hint): a veil goes on herself against a melee inside botVeil.melee, else on the allied group
        const veil = s.botVeil ? (this.meleeThreat(s.botVeil.melee || 300) ? { x: this.x, y: this.y } : this.allyGroupPoint(s.botVeil.group || 400)) : null;
        this.castSkill(i, w ? { x: t.x - w.x * 100, y: t.y - w.y * 100 } : threat ? this.betweenPoint(s, threat) : veil || Game.aimLeadPoint(this, t, 550));
        break;
      }
      case 'heal':
        this.castSkill(i, null);
        break;
      case 'blinkstrike':
        this.castSkill(i, t);
        break;
      case 'buff':
        this.castSkill(i, null);
        break;
      case 'tether':
        this.castSkill(i, t);
        break;
      case 'link':
        this.castSkill(i, null);
        break;
      case 'trap':
        this.castSkill(i, Game.aimLeadPoint(this, t, 400));
        break;
      case 'object':
        this.castSkill(i, { x: this.x + (t.x - this.x) * 0.5, y: this.y + (t.y - this.y) * 0.5 });
        break;
      case 'barrier':
        this.castSkill(i, this.barrierThreat() || t);
        break;
      case 'channel':
        this.castSkill(i, t);
        break;
      case 'selfState':
        this.castSkill(i, null);
        break;
      case 'basicMod':
        this.castSkill(i, t);
        break;
      case 'basicRange':
        this.castSkill(i, null);
        break;
      case 'allybuff':
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
      (!this.usesMana() || !this.maxMana || this.mana > this.maxMana * p.farmManaFloor) &&   // no bar (Marrow): nothing to run dry
      !Game.heroes.some(e => e.team !== this.team && e.alive &&
        this.distTo(e) < p.acquireRange && Game.canSee(this.team, e));
    /* Crowd-control first, then damage, so a stun is not wasted on a target
       that is already locked down. High-urgency casts skip the random roll. */
    const order = [0, 1, 2];
    order.sort((a, b) => this.botSkillUrgency(b, t, d, isHero, farmOk) -
      this.botSkillUrgency(a, t, d, isHero, farmOk));
    /* Ult mana reserve. A mana hero whose ultimate is learned and ready keeps
       its cost in the bar during a hero fight: a routine (sub-700) cast that
       would dip under it is skipped. Measured on Brass, the 120-mana Call to
       the Rim was affordable at 0 of 18 crowd moments in a match because
       Buckler and Shoulder had drained the 210 pool first. */
    const ult = this.skills[2];
    const reserve = (isHero && ult && this.usesMana() && !ult.hpCost && this.skillRank[2] >= 1 && this.skillCd[2] <= 0)
      ? this.costOf(ult, this.skillRank[2]) : 0;
    for (const i of order) {
      const urgency = this.botSkillUrgency(i, t, d, isHero, farmOk);
      if (urgency <= 0) continue;
      if (urgency < 700 && Math.random() > p.castChance) continue;
      if (i !== 2 && reserve && urgency < 700 && this.mana - this.costOf(this.skills[i], this.skillRank[i]) < reserve) continue;
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
      // botHold (F29, Lumen's and the mages' hints): a hold hero keeps exactly this distance while
      // it fits its reach (Hero.botHoldNow shrinks it for a walk-in or a tether kite)
      if (this.ranged) {
        const reach = this.range + this.radius + target.radius - 28;
        const hold = this.botHoldNow();
        // a tether kite (Hexa) stands past her reach on purpose; any other hold stays inside it
        if (hold) return Math.max(170, hold > reach && !this.liveTether() ? reach : hold) + fear;
        return Math.max(170, Math.min(this.range * 0.84, reach)) + fear;
      }
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
    /* F29 (Lumen's hint): a battery hero (F4 stillRegen) under botChargeBelow
       with no visible enemy hero inside botChargeSafe plants and charges;
       she still shoots whatever is in reach. */
    const bat = this.def0.energy;
    const charging = !!(bat && bat.stillRegen && bat.botChargeBelow && this.mana < bat.botChargeBelow &&
      !this.enemyHeroWithin(bat.botChargeSafe || 500));
    if (t) {
      if (charging) { if (this.inAttackRange(t)) this.tryAttack(t); return; }
      if (this.inAttackRange(t)) {
        this.tryAttack(t);
        /* Move during attack recovery instead of freezing in a firing line.
           Only heroes provoke tactical orbiting; waves and objectives should
           still be cleared efficiently. */
        if (t.type === 'hero' && p.kiteBuffer > 10 &&
            this.atkCd > (this.ranged ? 0.18 : 0.4) / this.curAtkSpd()) {
          /* A marksman with a melee hero inside 250 steps straight away from
             him during attack recovery (the orbit below is chosen around the
             target, which is not where the diver is). Rock behind: orbit. */
          const role = this.botRole(), hold = this.botHoldNow();
          // a mage walking in for a mark payoff (the hold shrunk under 250, Ignis) does not step back from the melee it is walking at
          const melee = this.ranged && (role === 'Marksman' || role === 'Mage') && !(hold && hold < 250) ? this.meleeThreat(250) : null;
          const kx = melee ? this.x + (this.x - melee.x) / Math.max(1, this.distTo(melee)) * 120 : 0;
          const ky = melee ? this.y + (this.y - melee.y) / Math.max(1, this.distTo(melee)) * 120 : 0;
          if (melee && !Game.wallAt(kx, ky, this.radius + 4)) {
            this.botMoveTo(kx, ky, dt, { avoidTowers: true });
          } else {
            if (!this.combatPoint || this.combatPointT <= 0 || dist(this.combatPoint, t) > this.range * 1.15) {
              this.combatPoint = this.chooseCombatPoint(t);
              this.combatPointT = 0.28 + rand(0, 0.14);
            }
            if (this.combatPoint && dist(this, this.combatPoint) > 36)
              this.botMoveTo(this.combatPoint.x, this.combatPoint.y, dt, { avoidTowers: true });
          }
        }
      } else if (t.type === 'hero') {
        const cut = this.interceptPoint(t);
        /* a botHold hero (the mages, Lumen) always closes to its hold point, never to melee,
           whatever the target's health; the walk-in for a mark payoff shrinks the hold instead */
        if (this.ranged && (this.botHoldNow() || (t.hpPct > 0.42 && !this.botCanKill(t))) && t.recallT <= 0) {
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
    if (charging) return;   // F29 (Lumen's hint): nothing to shoot, nobody near: stand and charge
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
    if (this.forced && this.updateForced(dt)) { this.trackVelocity(dt); return; }
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
          if (h.team === this.team || !h.alive || h.untargetable) continue;
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
    if (this.forced && this.updateForced(dt)) return;
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
      if (!h.alive || h.untargetable || dist(h, this.home) > 620) continue;
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
  /* A skillshot and its variants (docs/design/heroes.md):
       bounce    (F14) {count, range, decay}: after a hit the shot re-aims at
                 the nearest un-hit enemy unit within range (heroes count as
                 150 closer, structures never) with its damage x decay,
                 `count` times.
       boomerang (F10): at max range, or on its first hit, the shot turns and
                 homes back to the caster; hitSet is cleared for the return
                 pass, where returnSlowPct / returnSlowDur apply; one hit per
                 pass when non-pierce; gone when it reaches the caster.
       heroOnly  (F20): minions, monsters and structures are not hit at all. */
  static skillshot(src, s, dir) {
    const idx = src.skills ? src.skills.indexOf(s._base || s) : -1;
    const rank = src.skillRankOf ? src.skillRankOf(s) : 1;
    return new Projectile({
      kind: 'skillshot', x: src.x, y: src.y, src, team: src.team, s, rank,
      dx: dir.x, dy: dir.y, dmg: src.skillDmg(s, rank), speed: s.speed, maxDist: s.range,
      radius: s.radius || 24, pierce: !!s.pierce, explodeR: s.explodeR || 0,
      hook: !!s.hook, hitSet: new Set(), size: s.explodeR ? 13 : s.hook ? 9 : 10,
      color: src.color, icon: s.icon,
      skillKey: (src.def0 && idx >= 0) ? `skill:${src.def0.id}:${idx}` : null,
      style: s.hook ? 'hook' : s.explodeR ? 'orb' : s.boomerang ? 'disc' : s.pierce ? 'bolt' : 'shard',
      dmgType: s.dmgType || 'physical',
      bounce: s.bounce || null, bounceLeft: s.bounce ? (s.bounce.count || 0) : 0, bounceMult: 1, bounceTarget: null,
      boomerang: !!s.boomerang, returning: false, spent: false,
      heroOnly: !!s.heroOnly,
    });
  }
  /* F7: a basic attack under basicMod. A piercing line through the aimed
     target: crit is rolled once here for every unit it meets; the aimed
     target (or, if it is gone, the first unit met) is the primary hit with
     full basic rules (lifesteal, onBasicHit); everyone else in the line
     takes AD + bonus as a secondary basic hit with 40% lifesteal and no
     on-hit hooks. Structures are only ever hit as the aimed target. */
  static volley(src, target, bm) {
    const s = bm.s, S = src.attrs;
    const dir = norm(target.x - src.x, target.y - src.y);
    const chance = S.get('critChance');
    const crit = chance > 0 && Math.random() < chance;
    const bonus = (rankVal(s, 'bonusDmg', bm.rank) || 0) + src.curAtk() * (s.bonusScaleAd || 0);
    return new Projectile({
      kind: 'volley', x: src.x, y: src.y, src, team: src.team, s, rank: bm.rank, primary: target, primaryDone: false,
      dx: dir.x, dy: dir.y, speed: s.speed || 1400, maxDist: s.lineRange || 420, radius: s.radius || 30,
      pierce: true, hitSet: new Set(), atk: src.curAtk(), bonus,
      crit, critMult: crit ? COMBAT.CRIT_DMG_BASE + S.get('critDmg') : 1,
      size: 7, color: src.projColor, style: 'bolt', dmgType: 'physical',
    });
  }
  updateVolley(dt, px, py) {
    const step = this.speed * dt;
    this.x += this.dx * step; this.y += this.dy * step;
    this.traveled += step;
    if (Game.objects.length && Game.barrierBlocks(this.team, px, py, this.x, this.y)) {
      this.dead = true; Game.fx.spark(this.x, this.y, this.color, 4); return;
    }
    const list = Game.enemyUnits(this.team, { neutral: true });
    const pr = this.primary;
    if (pr && pr.isStructure && pr.alive) list.push(pr);
    for (const u of list) {
      if (this.hitSet.has(u)) continue;
      if (Math.hypot(u.x - this.x, u.y - this.y) > this.radius + u.radius) continue;
      this.hitSet.add(u);
      const primary = !this.primaryDone && (u === pr || !(pr && pr.alive && !pr.untargetable));
      const isStruct = u.type === 'structure';
      const amount = (this.atk + this.bonus) * (isStruct ? 1 : this.critMult);
      const pkt = { amount, type: 'physical', isBasic: true, critRolled: this.crit && !isStruct };
      if (!primary) pkt.lifestealMult = 0.4;
      const dealt = resolveDamage(this.src, u, pkt);
      if (primary) {
        this.primaryDone = true;
        if (dealt && this.src.onBasicLanded) this.src.onBasicLanded(u, dealt, pkt);
        if (u.isPlayer) SFX.hit();
      }
    }
    const bounds = Game.mapBounds();
    if (this.traveled >= this.maxDist || this.x < bounds.minX || this.y < bounds.minY ||
        this.x > bounds.maxX || this.y > bounds.maxY) this.dead = true;
  }
  /* One victim of a skillshot pass (per-victim damage, CC, marks, hooks). */
  landOn(u) {
    let o = null;
    if (this.bounceMult !== 1) o = { mult: this.bounceMult };
    if (this.returning && this.s.returnSlowPct) {
      o = o || {};
      o.slowPct = this.s.returnSlowPct; o.slowDur = this.s.returnSlowDur || 1.2;
    }
    // F15: a wave's shove carries the victim along the line of flight (Tide's Breaker)
    if (this.s.knockback) { o = o || {}; o.dir = { x: this.dx, y: this.dy }; }
    if (this.src.skillHit) this.src.skillHit(u, this.s, this.rank, o);
    else {
      const dealt = resolveDamage(this.src, u, { amount: this.dmg * (o && o.mult || 1), type: this.dmgType, skill: this.s });
      applySkillCC(this.src, u, this.s, this.rank, o);
      if (dealt && this.src.onSkillLanded) this.src.onSkillLanded(u, dealt, this.s);
    }
    // F16: a skillshot carrying `tether` ties the hero it hits to the caster (creeps just take the hit)
    if (this.s.tether && u.type === 'hero' && u.alive && this.src.tetherTo) this.src.tetherTo(u, this.s, this.rank);
    // F19: a displacement-immune hero (Weigh Anchor) is not dragged by a hook either
    if (this.hook && u.type === 'hero' && !(u.dashS && u.dashS.unhookable) && !(u.cc && u.cc.immuneTo('displacement'))) {
      u.forced = { mode: 'hook', src: this.src, t: 0.6, prev: u.forced && u.forced.mode === 'taunt' ? u.forced : null };
      u.marks.hookedAt = Game.time;
    }
  }
  /* F10: the turn. */
  turnBack() {
    this.returning = true;
    this.hitSet.clear();
    this.traveled = 0; this.maxDist = Infinity;
    Game.fx.spark(this.x, this.y, this.color, 3);
  }
  /* F14: re-aim at the next victim after hitting `from`. False when nothing
     is in range (the shot dies) or the bounces are spent. */
  rebound(from) {
    const b = this.bounce;
    if (!b || this.bounceLeft <= 0) return false;
    let best = null, bd = Infinity;
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (this.hitSet.has(u) || u.isStructure) continue;
      const d = Math.hypot(u.x - from.x, u.y - from.y);
      if (d > (b.range || 300)) continue;
      const score = d - (u.type === 'hero' ? 150 : 0);
      if (score < bd) { bd = score; best = u; }
    }
    if (!best) return false;
    this.bounceLeft--;
    this.bounceMult *= b.decay !== undefined ? b.decay : 1;
    this.bounceTarget = best;
    const dir = norm(best.x - this.x, best.y - this.y);
    this.dx = dir.x; this.dy = dir.y;
    this.traveled = 0; this.maxDist = (b.range || 300) + best.radius + 80;
    Game.fx.spark(this.x, this.y, this.color, 3);
    return true;
  }
  explode(cx, cy) {
    const o = { mult: 0.8, noCC: true };
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (!this.hitSet.has(u) && Math.hypot(u.x - cx, u.y - cy) <= this.explodeR + u.radius) {
        this.hitSet.add(u);
        if (this.src.skillHit) this.src.skillHit(u, this.s, this.rank, o);
        else resolveDamage(this.src, u, { amount: this.dmg * 0.8, type: this.dmgType, skill: this.s });
      }
    }
    Game.fx.ring(cx, cy, this.explodeR, this.color, 0.4);
  }
  update(dt) {
    if (this.dead) return;
    const px = this.x, py = this.y;   // for the barrier crossing test (F9)
    if (this.kind === 'volley') { this.updateVolley(dt, px, py); return; }
    if (this.kind === 'homing') {
      const t = this.target;
      if (!t || !t.alive || t.untargetable) { this.dead = true; return; }
      const d = dist(this, t);
      const step = this.speed * dt;
      if (Game.objects.length && Game.barrierBlocks(this.team, px, py, t.x, t.y, Math.min(d, step + t.radius))) { this.dead = true; return; }
      if (d <= step + t.radius) {
        const dealt = resolveDamage(this.src, t, this.packet);
        if (dealt && this.src.onBasicLanded) this.src.onBasicLanded(t, dealt, this.packet);
        if (t.isPlayer) SFX.hit();
        this.dead = true;
        return;
      }
      const dir = norm(t.x - this.x, t.y - this.y);
      this.x += dir.x * step; this.y += dir.y * step;
      return;
    }
    // skillshot (and its bounce / boomerang / hero-only variants)
    const step = this.speed * dt;
    if (this.returning) {
      // F10: home to wherever the caster is now; gone on arrival or when the caster dies
      const src = this.src;
      if (!src || !src.alive) { this.dead = true; return; }
      const d = dist(this, src);
      if (d <= step + src.radius) { this.dead = true; return; }
      const dir = norm(src.x - this.x, src.y - this.y);
      this.dx = dir.x; this.dy = dir.y;
    } else if (this.bounceTarget) {
      // F14: keep the re-aim on the unit it bounced toward while it lives
      const bt = this.bounceTarget;
      if (bt.alive && !bt.untargetable) { const dir = norm(bt.x - this.x, bt.y - this.y); this.dx = dir.x; this.dy = dir.y; }
      else this.bounceTarget = null;
    }
    this.x += this.dx * step; this.y += this.dy * step;
    this.traveled += step;
    if (Game.objects.length && Game.barrierBlocks(this.team, px, py, this.x, this.y)) {
      this.dead = true; Game.fx.spark(this.x, this.y, this.color, 4); return;
    }
    if (!this.spent) {
      for (const u of Game.enemyUnits(this.team, { neutral: true })) {
        if (this.hitSet.has(u)) continue;
        if (this.heroOnly && u.type !== 'hero') continue;   // F20
        if (Math.hypot(u.x - this.x, u.y - this.y) > this.radius + u.radius) continue;
        this.hitSet.add(u);
        this.landOn(u);
        if (this.explodeR) this.explode(this.x, this.y);
        if (this.pierce) continue;
        if (this.boomerang) {
          if (!this.returning) this.turnBack();
          else this.spent = true;   // one hit per pass: it still flies home
          return;
        }
        if (this.rebound(u)) return;
        this.dead = true; Game.fx.spark(this.x, this.y, this.color, 6);
        return;
      }
    }
    if (this.returning) return;
    const bounds = Game.mapBounds();
    if (this.traveled >= this.maxDist || this.x < bounds.minX || this.y < bounds.minY ||
        this.x > bounds.maxX || this.y > bounds.maxY) {
      if (this.boomerang) { this.turnBack(); return; }
      if (this.explodeR) this.explode(this.x, this.y);
      this.dead = true;
    }
  }
}

/* ================= Placed object (docs/design/heroes.md F9) =================
   Something a hero leaves on the ground: untargetable, expires at t <= 0,
   drawn each frame. Three modes:
     trap    — arms after armDelay, then the first enemy (hero, when heroOnly)
               overlapping triggerRadius takes the skill and is revealed; the
               trap is spent. Outlives its owner.
     pulse   — every `tick` seconds shields allied heroes in allyRadius (tag
               'lantern': refreshed, never stacked) and reveals enemy heroes in
               revealRadius for the rest of its life. Dies with its owner.
     barrier — a segment across the cast direction; enemy projectiles that
               cross it are removed (Game.barrierBlocks). Units, dashes, novas
               and zones pass. Dies with its owner. */
class PlacedObject {
  constructor(owner, s, x, y, rank, mode, dir) {
    this.owner = owner; this.team = owner.team; this.s = s; this.rank = rank || 1;
    this.x = x; this.y = y; this.mode = mode; this.dead = false; this.age = 0;
    this.color = owner.color;
    this.t = mode === 'trap' ? (s.lifetime || 20) : (s.dur || 5);
    this.armT = mode === 'trap' ? (s.armDelay || 0) : 0;
    this.tickT = 0;
    this.radius = mode === 'trap' ? (s.triggerRadius || 100) : mode === 'pulse' ? (s.allyRadius || 300) : 0;
    if (mode === 'barrier') {
      const d = dir || { x: 1, y: 0 }, half = (s.length || 200) / 2;
      this.ax = x - d.y * half; this.ay = y + d.x * half;
      this.bx = x + d.y * half; this.by = y - d.x * half;
    }
  }
  get armed() { return this.armT <= 0; }
  update(dt) {
    if (this.dead) return;
    this.age += dt; this.t -= dt;
    if (this.t <= 0) { this.dead = true; return; }
    if (this.mode === 'trap') { this.updateTrap(dt); return; }
    if (!this.owner.alive) { this.dead = true; return; }
    if (this.mode === 'pulse') this.updatePulse(dt);
  }
  updateTrap(dt) {
    if (this.armT > 0) { this.armT -= dt; return; }
    const s = this.s, r = this.radius, x = this.x, y = this.y;
    const list = s.heroOnly === false ? Game.enemyUnits(this.team, { neutral: true }) : Game.heroes;
    for (const u of list) {
      if (u.team === this.team || !u.alive || u.untargetable) continue;
      const dx = u.x - x, dy = u.y - y, rr = r + u.radius;
      if (dx * dx + dy * dy > rr * rr) continue;
      this.dead = true;
      this.owner.skillHit(u, s, this.rank);
      if (s.revealDur && u.type === 'hero') u.revealT = Math.max(u.revealT || 0, s.revealDur);
      Game.fx.ring(x, y, r, this.color, 0.4);
      Game.fx.spark(x, y, this.color, 8);
      return;
    }
  }
  updatePulse(dt) {
    this.tickT -= dt;
    if (this.tickT > 0) return;
    const s = this.s;
    this.tickT += s.tick || 1;
    const shield = (rankVal(s, 'shield', this.rank) || 0) + this.owner.magicPower() * (s.shieldScaleAp || 0);
    const ar = s.allyRadius || 300, rr = s.revealRadius || 0;
    for (const h of Game.heroes) {
      if (!h.alive) continue;
      const d = hyp(h.x - this.x, h.y - this.y);
      if (h.team === this.team) {
        if (shield > 0 && d <= ar + h.radius) h.addShield(shield, s.shieldDur || 2, 'lantern');
      } else if (rr && d <= rr + h.radius) {
        h.revealT = Math.max(h.revealT || 0, this.t);
        h.marks.lanternRevealed = Game.time + this.t;
      }
    }
    Game.fx.ring(this.x, this.y, ar, this.color, 0.3);
  }
}

/* ================= Tether (docs/design/heroes.md F16) =================
   A line between two units that lives `t` seconds, ticks every `interval`
   (onTick; onFrame runs every frame) and ends with onComplete, or snaps
   with onBreak when the units part beyond breakRange, when the target
   Purifies, or, for a hostile tether that is not `anchored`, when the
   source is stunned, airborne, suppressed or taunted. Either unit dying
   removes it quietly. */
class Tether {
  constructor(o) {
    this.src = null; this.target = null; this.hostile = true; this.anchored = false;
    this.t = 2; this.dur = 0; this.elapsed = 0; this.breakRange = Infinity;
    this.interval = 0; this.tickT = 0; this.dead = false; this.drawColor = null;
    this.onTick = null; this.onFrame = null; this.onBreak = null; this.onComplete = null;
    Object.assign(this, o);
    this.dur = this.t;
    this.tickT = this.interval;
  }
  snap() {
    if (this.dead) return;
    this.dead = true;
    if (this.onBreak) this.onBreak(this);
  }
  /* End it without the break payload (a Purify, the caster's death). */
  release() { this.dead = true; }
  update(dt) {
    if (this.dead) return;
    const a = this.src, b = this.target;
    if (!a || !b || !a.alive || !b.alive) { this.dead = true; return; }
    if (dist(a, b) > this.breakRange) { this.snap(); return; }
    if (this.hostile && !this.anchored) {
      const c = a.cc;
      if (c && (c.has('stun') || c.has('airborne') || c.has('suppress') || c.has('taunt'))) { this.snap(); return; }
    }
    this.elapsed += dt; this.t -= dt;
    if (this.onFrame) this.onFrame(this, dt);
    if (this.interval > 0 && this.onTick) {
      this.tickT -= dt;
      if (this.tickT <= 0) { this.tickT += this.interval; this.onTick(this); }
    }
    if (this.t <= 0 && !this.dead) {
      this.dead = true;
      if (this.onComplete) this.onComplete(this);
    }
  }
}

/* ================= Zone (delayed AoE) ================= */
class Zone {
  constructor(owner, s, x, y) {
    this.owner = owner; this.team = owner.team; this.s = s;
    this.x = x; this.y = y; this.radius = s.radius;
    this.delay = s.delay || 0.6; this.delay0 = this.delay;
    this.ticks = s.ticks !== undefined ? s.ticks : 1; this.interval = s.interval || 0;
    this.ticks0 = this.ticks;
    this.next = 0; this.dead = false; this.age = 0;
    this.color = owner.color;
    this.rank = owner.skillRankOf ? owner.skillRankOf(s) : 1;
    this.dmg = owner.skillDmg(s, this.rank);
    /* F13: after its ticks the zone may stay as a patch (see updateLinger) */
    this.linger = s.linger || null;
    this.lingerT = 0; this.lingerAge = 0; this.chillT = 0; this.buffT = 0;
    this.hitSet = this.linger && this.linger.countsAsSkillHit ? new Set() : null;
  }
  /* The ticks are done: linger or die. */
  finish() {
    if (this.linger && this.linger.dur > 0) { this.lingerT = this.linger.dur; this.lingerAge = 0; return; }
    this.dead = true;
  }
  /* linger: {dur, enemySlowPct, enemySlowRamp?: [from, to], allySpeedAdd,
     chillPerSec, chillDelay, conceal, countsAsSkillHit, endPayload?}.
     Each frame: enemies inside are slowed (the pct lerps over dur with a
     ramp), allied heroes inside are hastened and, with conceal, hidden like
     a bush (revealed 1.6 s on dealing damage); after chillDelay enemies take
     one Chill per 1/chillPerSec s; countsAsSkillHit fires onSkillLanded once
     per enemy per cast; endPayload lands on everyone inside at t = 0. */
  updateLinger(dt) {
    const L = this.linger, s = this.s, owner = this.owner;
    this.lingerT -= dt; this.lingerAge += dt;
    const ending = this.lingerT <= 0;
    const k = Math.min(1, this.lingerAge / L.dur);
    const slow = L.enemySlowRamp ? lerp(L.enemySlowRamp[0], L.enemySlowRamp[1], k) : (L.enemySlowPct || 0);
    let chillNow = false;
    if (L.chillPerSec && this.lingerAge >= (L.chillDelay || 0)) {
      this.chillT -= dt;
      if (this.chillT <= 0) { this.chillT += 1 / L.chillPerSec; chillNow = true; }
    }
    const payload = ending && L.endPayload ? Object.assign({ dmgType: s.dmgType }, L.endPayload) : null;
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (hyp(u.x - this.x, u.y - this.y) > this.radius + u.radius) continue;
      const ten = u.attrs ? u.attrs.get('tenacity') : 0;
      if (slow > 0 && u.cc) u.cc.applySlow(slow, 0.2, ten);
      if (this.hitSet && !this.hitSet.has(u)) { this.hitSet.add(u); owner.onSkillLanded(u, 0, s); }
      if (chillNow) applyChill(owner, u);
      if (payload) owner.skillHit(u, payload, this.rank);
    }
    if (L.allySpeedAdd || L.conceal) {
      this.buffT -= dt;
      const buff = this.buffT <= 0;
      if (buff) this.buffT = 0.1;
      for (const h of Game.heroes) {
        if (h.team !== this.team || !h.alive) continue;
        if (hyp(h.x - this.x, h.y - this.y) > this.radius + h.radius) continue;
        if (buff && L.allySpeedAdd) h.addTimedBuff('speed', L.allySpeedAdd, 0.25);
        if (L.conceal) h.concealT = 0.15;
      }
    }
    if (ending) this.dead = true;
  }
  tick() {
    const s = this.s, ti = this.ticks0 - this.ticks;   // 0 for the first tick
    this.ticks--;
    /* slowPctLv (F28): a multi-tick zone's slow ramps per tick, not per rank;
       a knockback is radial from the centre and a pullTo point is the centre (F15) */
    const o = { zone: this, from: this, point: this };
    if (s.slowPctLv) o.slowPct = Math.min(0.95, (s.slowPct || 0) + s.slowPctLv * ti);
    for (const u of Game.enemyUnits(this.team, { neutral: true })) {
      if (Math.hypot(u.x - this.x, u.y - this.y) <= this.radius + u.radius) {
        if (this.owner.skillHit) this.owner.skillHit(u, s, this.rank, o);
        else {
          const dealt = resolveDamage(this.owner, u, { amount: this.dmg, type: s.dmgType || 'physical', skill: s });
          applySkillCC(this.owner, u, s, this.rank, o);
          if (dealt && this.owner.onSkillLanded) this.owner.onSkillLanded(u, dealt, s);
        }
      }
    }
    if (Game.fx.zoneImpact) Game.fx.zoneImpact(this);
    else Game.fx.ring(this.x, this.y, this.radius, this.color, 0.35);
    SFX.zone();
  }
  /* pullSpeed (F15): while the zone arms, enemy heroes inside are dragged
     toward its centre. Ignores tenacity, refused by Purify immunity and a
     displacement self-immunity, waits for a dash or a hook, stops at rock. */
  pull(dt) {
    const step = this.s.pullSpeed * dt;
    for (const h of Game.heroes) {
      if (h.team === this.team || !h.alive || h.dashS || h.forced) continue;
      if (h.cc.immuneT > 0 || h.cc.immuneTo('displacement')) continue;
      const rx = this.x - h.x, ry = this.y - h.y, d = Math.sqrt(rx * rx + ry * ry);
      if (d > this.radius + h.radius || d < 4) continue;
      const k = Math.min(step, d) / d;
      const nx = h.x + rx * k, ny = h.y + ry * k;
      if (Game.wallAt(nx, ny, h.radius)) continue;
      h.x = nx; h.y = ny;
      h.marks.heavyUntil = Game.time + 3; h.marks.heavyBy = this.owner;   // Nadir's Accretion
    }
  }
  update(dt) {
    if (this.dead) return;
    this.age += dt;
    if (this.lingerT > 0) { this.updateLinger(dt); return; }
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.s.pullSpeed) this.pull(dt);
      if (this.delay <= 0) {
        if (this.ticks > 0) this.tick();
        if (this.ticks <= 0) this.finish(); else this.next = this.interval;
      }
      return;
    }
    this.next -= dt;
    if (this.next <= 0) {
      this.tick();
      if (this.ticks <= 0) this.finish(); else this.next = this.interval;
    }
  }
}
