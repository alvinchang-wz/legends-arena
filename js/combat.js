'use strict';
/* ============================================================
   combat.js — the stat block, the damage pipeline, crowd control,
   shields, and hero passives.

   Every point of damage in the game goes through resolveDamage().
   Having exactly one path is what makes crit, penetration, shields,
   lifesteal, damage tallies and passives composable instead of each
   caller re-implementing a slice of them.
   ============================================================ */

/* ============================================================
   Stat block
   ============================================================
   `base` is what the hero is worth naked at this level. Items,
   emblems, buffs and passives push into `bonus`. Reading a stat sums
   the two, so a temporary buff can be removed without recomputing
   levels and gear from scratch. */
class Stats {
  constructor() {
    this.base = Stats.zero();
    this.bonus = Stats.zero();
  }
  static zero() {
    return {
      maxHp: 0, maxMana: 0,
      physAtk: 0, magicPower: 0,
      armor: 0, mr: 0,
      atkSpd: 0, speed: 0, range: 0,
      critChance: 0, critDmg: 0,
      lifesteal: 0, spellVamp: 0,
      cdr: 0, tenacity: 0,
      physPen: 0, physPenPct: 0,
      magicPen: 0, magicPenPct: 0,
      hpRegen: 0, manaRegen: 0,
    };
  }
  get(k) { return this.base[k] + this.bonus[k]; }
  /* Bonus stats are additive from every source; multiplicative buffs are
     applied at read time by the hero (see Hero.curAtk) so that a 40% steroid
     scales items too. */
  addBonus(table, mult = 1) {
    for (const k in table) if (k in this.bonus) this.bonus[k] += table[k] * mult;
  }
  clearBonus() { this.bonus = Stats.zero(); }
}

/* ============================================================
   Crowd control
   ============================================================
   One timer per CC type. Reading `canMove/canAct/canCast` walks the
   live timers rather than caching flags, so a CC expiring mid-frame
   frees the unit on the same frame. */
class CCState {
  constructor() {
    this.t = {};                 // type -> remaining seconds
    for (const k in CC_TYPES) this.t[k] = 0;
    this.slowPct = 0;
    this.immuneT = 0;            // purify / spell immunity window
  }
  /* Returns the applied duration (0 if the CC was refused). */
  apply(type, dur, tenacity = 0) {
    const def = CC_TYPES[type];
    if (!def || !(dur > 0)) return 0;
    if (this.immuneT > 0 && type !== 'suppress') return 0;
    let d = dur;
    if (def.tenacity) d *= 1 - clamp(tenacity, 0, COMBAT.TENACITY_CAP);
    // CC does not stack, it refreshes: the longer of old and new wins
    if (d > this.t[type]) this.t[type] = d;
    return d;
  }
  applySlow(pct, dur, tenacity = 0) {
    const d = this.apply('slow', dur, tenacity);
    if (d <= 0) return 0;
    if (pct >= this.slowPct || this.t.slow <= 0) this.slowPct = pct;
    return d;
  }
  clear() {
    for (const k in this.t) this.t[k] = 0;
    this.slowPct = 0;
  }
  /* Purify: drop every CC currently running and refuse new ones briefly. */
  purify(immuneFor = 0) {
    this.clear();
    this.immuneT = Math.max(this.immuneT, immuneFor);
  }
  update(dt) {
    for (const k in this.t) if (this.t[k] > 0) this.t[k] -= dt;
    if (this.t.slow <= 0) this.slowPct = 0;
    if (this.immuneT > 0) this.immuneT -= dt;
  }
  has(type) { return this.t[type] > 0; }
  get canMove() {
    for (const k in this.t) if (this.t[k] > 0 && !CC_TYPES[k].move) return false;
    return true;
  }
  get canAct() {
    for (const k in this.t) if (this.t[k] > 0 && !CC_TYPES[k].act) return false;
    return true;
  }
  get canCast() {
    for (const k in this.t) if (this.t[k] > 0 && !CC_TYPES[k].cast) return false;
    return true;
  }
  /* Hardest active CC, for the health-bar pip and the unit aura. */
  get dominant() {
    for (const k of CC_PRIORITY) if (this.t[k] > 0) return k;
    return null;
  }
  get list() {
    return CC_PRIORITY.filter(k => this.t[k] > 0);
  }
}

/* ============================================================
   Damage pipeline
   ============================================================
   packet: {
     amount, type, canCrit?, isBasic?, skill?,
     pen? { flat, pct }        — extra penetration from this source only
     lifestealMult?            — 0 disables drain for this hit
     noPassive?                — internal hits (burns, reflects) that must
                                 not re-trigger the passive that spawned them
   }
   Returns the dealt damage (post-mitigation, post-shield), or 0. */
function resolveDamage(src, target, packet) {
  if (!target || !target.alive || Game.state !== 'play') return 0;

  const type = packet.type || 'physical';
  let amount = packet.amount;
  if (!(amount > 0)) return 0;

  const S = src && src.attrs ? src.attrs : null;   // attacker stat block, if any

  /* --- crit --- */
  let crit = false;
  if (packet.canCrit && S && target.type !== 'structure') {
    const chance = S.get('critChance');
    if (chance > 0 && Math.random() < chance) {
      crit = true;
      amount *= COMBAT.CRIT_DMG_BASE + S.get('critDmg');
    }
  }

  /* --- attacker-side damage modifiers (passives, buffs) --- */
  if (src && src.onDealDamage && !packet.noPassive) {
    amount = src.onDealDamage(target, amount, packet) ?? amount;
  }
  if (packet.skill && COMBAT.SKILL_DMG && target.type !== 'structure') {
    amount *= COMBAT.SKILL_DMG;
  }

  if (target instanceof Hero && typeof Features !== 'undefined' && Features.blockDamage(target)) {
    return 0;
  }
  /* --- structures take reduced hero damage without minion support --- */
  if (target.isStructure && src && src.type === 'hero') {
    if (target.shieldedByOuter) amount *= 0.4;
    const cover = Game.minions.some(m => m.team === src.team && m.alive && dist(m, target) < 340);
    if (!cover) amount *= COMBAT.BACKDOOR_MULT;
  }

  /* --- mitigation --- */
  let mult = 1;
  if (type === 'physical') {
    const flat = (S ? S.get('physPen') : 0) + (packet.pen ? packet.pen.flat || 0 : 0);
    const pct = (S ? S.get('physPenPct') : 0) + (packet.pen ? packet.pen.pct || 0 : 0);
    mult = mitigation(target.armorValue(), flat, pct);
  } else if (type === 'magic') {
    const flat = (S ? S.get('magicPen') : 0) + (packet.pen ? packet.pen.flat || 0 : 0);
    const pct = (S ? S.get('magicPenPct') : 0) + (packet.pen ? packet.pen.pct || 0 : 0);
    mult = mitigation(target.mrValue(), flat, pct);
  }
  let dmg = amount * mult;

  /* --- target-side reduction (passives, damage-reduction buffs) --- */
  if (target.onIncomingDamage) dmg = target.onIncomingDamage(src, dmg, packet) ?? dmg;

  dmg = Math.max(1, Math.round(dmg));

  /* --- shields absorb before health --- */
  const absorbed = target.absorbWithShield ? target.absorbWithShield(dmg) : 0;
  const toHp = dmg - absorbed;
  target.hp -= toHp;

  /* --- bookkeeping --- */
  if (src instanceof Hero && src !== target) {
    if (target.type === 'hero') src.stats.dmgHero += dmg;
    else if (target.isStructure) src.stats.dmgStruct += dmg;
    else src.stats.dmgOther += dmg;
  }
  if (target instanceof Hero) target.stats.dmgTaken += dmg;

  /* --- drain --- */
  if (src && S && dmg > 0 && packet.lifestealMult !== 0) {
    const rate = packet.isBasic ? S.get('lifesteal') : S.get('spellVamp');
    if (rate > 0) {
      const scale = target.type === 'hero' ? 1 : COMBAT.LIFESTEAL_MINION;
      const healed = dmg * rate * scale * (packet.lifestealMult ?? 1);
      if (healed >= 1) { src.heal(healed); Game.fx.drainFx(src, Math.round(healed)); }
    }
  }

  Game.fx.floater(target, dmg, src, type, crit);
  if (crit) {
    Game.fx.critMark(target);
    if (src === Game.player || target === Game.player) Game.hitStop = Math.max(Game.hitStop || 0, 0.04);
  }
  if ((src === Game.player || target === Game.player) && dmg > 12 && target.type === 'hero') {
    Game.fx.spark(target.x, target.y, DMG_COLORS[type] || THEME.true, crit ? 7 : 3);
  }

  /* --- reactions --- */
  if (target.onDamaged) target.onDamaged(src, dmg, packet);
  if (src && src.onDamageDealt && !packet.noPassive) src.onDamageDealt(target, dmg, packet);
  if (typeof Features !== 'undefined') Features.onHeroDamaged(src, target, dmg);

  if (target.hp <= 0) { target.hp = 0; target.die(src); }
  return dmg;
}

/* Apply every CC a skill definition carries, in one call. */
function applySkillCC(src, target, s) {
  if (!s || !target.cc) return;
  const ten = target.attrs ? target.attrs.get('tenacity') : 0;
  for (const type in CC_TYPES) {
    if (type === 'slow') continue;
    if (s[type]) target.cc.apply(type, s[type], ten);
  }
  if (s.slowPct) target.cc.applySlow(s.slowPct, s.slowDur || 1.5, ten);
  if (s.knockback) applyKnockback(src, target, s.knockback);
}

/* Instant displacement away from `src`. Not a timer — it resolves now and the
   unit is free the moment it lands, which is what separates a shove from an
   airborne. Structures and suppressed-immune units ignore it. */
function applyKnockback(src, target, distance) {
  if (!src || target.isStructure || !target.alive) return;
  const d = norm(target.x - src.x, target.y - src.y);
  target.x += d.x * distance;
  target.y += d.y * distance;
  Game.clampPoint(target, 40);
  Game.fx.spark(target.x, target.y, THEME.ccKnockback, 5);
}

/* ============================================================
   Hero passives
   ============================================================
   Each entry is a bag of optional hooks. Heroes call into these by id;
   any hook a passive does not define is simply skipped.

     init(h)                        — one-time setup on spawn
     tick(h, dt)                    — per frame while alive
     statMod(h)                     — return a bonus-stat table, applied
                                      every recalc (dynamic passives)
     onBasicHit(h, target, dmg)     — after a basic attack lands
     onSkillHit(h, target, dmg, s)  — after any skill damage lands
     onDealDamage(h, t, amt, pkt)   — modify outgoing damage, return a number
     onIncoming(h, src, dmg, pkt)   — modify incoming damage, return a number
     onKill(h, victim)              — after securing a hero kill
     onHealAlly(h, ally, amount)    — after healing someone
*/
const PASSIVES = {
  /* Zephyr — every 3rd basic attack hits harder and grants speed. */
  tailwind: {
    init(h) { h.pv = { hits: 0 }; },
    onBasicHit(h, target) {
      h.pv.hits++;
      if (h.pv.hits < 3) return;
      h.pv.hits = 0;
      resolveDamage(h, target, {
        amount: 40 + h.curAtk() * 0.6, type: 'physical', noPassive: true,
      });
      h.addTimedBuff('speed', 90, 1.5);
      Game.fx.ring(h.x, h.y, 54, THEME.hp, 0.35);
    },
  },

  /* Ignis — skill hits stack Embers; the third ignites for damage over time. */
  combustion: {
    onSkillHit(h, target) {
      if (!target.marks) return;
      const m = target.marks;
      m.ember = (m.ember && m.emberT > Game.time) ? m.ember + 1 : 1;
      m.emberT = Game.time + 4;
      if (m.ember >= 3) {
        m.ember = 0;
        target.addDot({
          src: h, total: 90 + h.magicPower() * 0.5, dur: 3, type: 'magic',
          color: THEME.magic, tag: 'ignite',
        });
        Game.fx.ring(target.x, target.y, target.radius + 22, THEME.magic, 0.45);
      }
    },
  },

  /* Grom — resists scale with how many enemies are on him; panic shield low. */
  bulwark: {
    init(h) { h.pv = { shieldCd: 0 }; },
    statMod(h) {
      let near = 0;
      for (const e of Game.heroes) if (e.team !== h.team && e.alive && dist(h, e) < 420) near++;
      return { armor: near * 6, mr: near * 6 };
    },
    tick(h, dt) {
      if (h.pv.shieldCd > 0) h.pv.shieldCd -= dt;
      if (h.hpPct < 0.4 && h.pv.shieldCd <= 0) {
        h.pv.shieldCd = 35;
        h.addShield(h.maxHp * 0.12, 4);
        Game.fx.ring(h.x, h.y, h.radius + 30, THEME.shield, 0.5);
      }
    },
  },

  /* Nyx — bonus true damage from behind, speed burst on a kill. */
  backstab: {
    onDealDamage(h, target, amount) {
      if (!target.facing && target.facing !== 0) return amount;
      if (target.isStructure) return amount;
      // angle between the target's facing and the direction back to Nyx
      const toSrc = Math.atan2(h.y - target.y, h.x - target.x);
      let diff = Math.abs(((toSrc - target.facing + Math.PI) % TAU + TAU) % TAU - Math.PI);
      if (diff < Math.PI * 0.55) return amount;   // target is looking at Nyx
      return amount * 1.18;
    },
    onKill(h, victim) {
      if (victim.type !== 'hero') return;
      h.addTimedBuff('speedPct', 0.25, 3);
      Game.fx.ring(h.x, h.y, 70, h.color, 0.5);
    },
  },

  /* Sylva — her heals also hasten the ally and refund her mana. */
  verdant: {
    onHealAlly(h, ally) {
      ally.addTimedBuff('speed', 60, 2);
      h.mana = Math.min(h.maxMana, h.mana + 12);
    },
  },

  /* Torren — lifesteal that grows as he drops. */
  bloodthirst: {
    statMod(h) { return { lifesteal: 0.25 * (1 - h.hpPct) }; },
  },

  /* Mira — stacking chill that freezes at four stacks. */
  frostbite: {
    onSkillHit(h, target) { PASSIVES.frostbite._chill(h, target); },
    onBasicHit(h, target) { PASSIVES.frostbite._chill(h, target); },
    _chill(h, target) {
      if (!target.marks || target.isStructure) return;
      const m = target.marks;
      m.chill = (m.chill && m.chillT > Game.time) ? m.chill + 1 : 1;
      m.chillT = Game.time + 4;
      const ten = target.attrs ? target.attrs.get('tenacity') : 0;
      if (m.chill >= 4) {
        m.chill = 0;
        target.cc.apply('stun', 0.8, ten);
        Game.fx.ring(target.x, target.y, target.radius + 26, THEME.ccSlow, 0.5);
      } else {
        target.cc.applySlow(0.08 * m.chill, 4, ten);
      }
    },
  },

  /* Karn — attacks cut cooldowns, hits build armor. */
  ironclad: {
    init(h) { h.pv = { plates: 0, plateT: 0 }; },
    onBasicHit(h) {
      for (let i = 0; i < h.skillCd.length; i++) {
        if (h.skillCd[i] > 0) h.skillCd[i] = Math.max(0, h.skillCd[i] - 0.5);
      }
    },
    statMod(h) { return { armor: (h.pv ? h.pv.plates : 0) * 3 }; },
    tick(h, dt) {
      if (!h.pv) return;
      if (h.pv.plateT > 0) { h.pv.plateT -= dt; if (h.pv.plateT <= 0) h.pv.plates = 0; }
    },
    onIncoming(h, src, dmg) {
      if (src && src.type === 'hero' && h.pv) {
        h.pv.plates = Math.min(5, h.pv.plates + 1);
        h.pv.plateT = 4;
      }
      return dmg;
    },
  },

  chambered: {
    init(h) { h.pv = { shots: 0 }; },
    onBasicHit(h, target) {
      h.pv.shots++;
      if (h.pv.shots < 4) return;
      h.pv.shots = 0;
      resolveDamage(h, target, {
        amount: 55 + h.curAtk() * 0.45, type: 'true', noPassive: true,
      });
      h.mana = Math.min(h.maxMana, h.mana + 8);
      Game.fx.ring(target.x, target.y, target.radius + 16, h.color, 0.35);
    },
  },

  barbed: {
    onSkillHit(h, target) {
      if (!target.marks || target.isStructure) return;
      target.marks.barbT = Game.time + 3;
    },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.isBasic || !target.marks || target.marks.barbT < Game.time) return amount;
      return amount * 1.12;
    },
  },

  aperture: {
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.isBasic) return amount;
      const d = dist(h, target);
      if (d < 280) return amount;
      return amount * (1 + Math.min(0.35, (d - 280) / 400 * 0.35));
    },
  },

  static: {
    onSkillHit(h, target) {
      if (!target.marks || target.isStructure) return;
      const m = target.marks;
      m.static = (m.staticT > Game.time) ? Math.min(5, m.static + 1) : 1;
      m.staticT = Game.time + 4;
    },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || pkt.type !== 'magic' || !target.marks || target.marks.staticT < Game.time) return amount;
      pkt.pen = pkt.pen || { flat: 0, pct: 0 };
      pkt.pen.flat = (pkt.pen.flat || 0) + target.marks.static * 6;
      return amount;
    },
  },

  horizon: {
    _restore(h, frac) {
      h.heal((h.maxHp - h.hp) * frac);
      h.mana = Math.min(h.maxMana, h.mana + (frac >= 0.12 ? 40 : 20));
      Game.fx.ring(h.x, h.y, 64, h.color, 0.4);
    },
    onKill(h, victim) { if (victim && victim.type === 'hero') PASSIVES.horizon._restore(h, 0.12); },
    onAssist(h, victim) { if (victim && victim.type === 'hero') PASSIVES.horizon._restore(h, 0.06); },
  },

  drymouth: {
    onSkillHit(h, target) {
      if (!target.marks || !target.cc || target.isStructure) return;
      const m = target.marks;
      m.sand = (m.sandT > Game.time) ? m.sand + 1 : 1;
      m.sandT = Game.time + 5;
      if (m.sand < 3) return;
      if (m.sandSilence && m.sandSilence > Game.time) return;
      m.sand = 0;
      m.sandSilence = Game.time + 8;
      const ten = target.attrs ? target.attrs.get('tenacity') : 0;
      target.cc.apply('silence', 0.9, ten);
      Game.fx.ring(target.x, target.y, target.radius + 20, h.color, 0.4);
    },
  },

  blight: {
    onBasicHit(h, target) {
      if (!target.marks || target.isStructure) return;
      const m = target.marks;
      m.blight = (m.blightT > Game.time) ? Math.min(2, m.blight + 1) : 1;
      m.blightT = Game.time + 3;
      target.addDot({
        src: h, total: (40 + h.magicPower() * 0.3) * m.blight, dur: 3,
        type: 'magic', color: h.color, tag: 'blight',
      });
    },
  },

  afterimage: {
    init(h) { h.pv = { until: 0 }; },
    onSkillHit(h) { h.pv.until = Game.time + 3; },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.isBasic || !h.pv || Game.time > h.pv.until) return amount;
      h.pv.until = 0;
      Game.fx.ring(target.x, target.y, 22, h.color, 0.3);
      return amount * 1.3;
    },
  },

  venom: {
    init(h) { h.pv = { vamp: 0, t: 0 }; },
    statMod(h) { return { spellVamp: h.pv && h.pv.t > 0 ? h.pv.vamp : 0 }; },
    tick(h, dt) { if (h.pv && h.pv.t > 0) h.pv.t -= dt; },
    onKill(h, victim) {
      if (!victim || victim.type !== 'hero' || !h.pv) return;
      h.pv.vamp = 0.18; h.pv.t = 5;
    },
    onAssist(h, victim) {
      if (!victim || victim.type !== 'hero' || !h.pv) return;
      if (h.pv.vamp >= 0.18 && h.pv.t > 0) return;
      h.pv.vamp = 0.08; h.pv.t = 3;
    },
  },

  stoop: {
    onSkillHit(h, target) {
      if (dist(h, target) > 250) h.addTimedBuff('speed', 40, 2);
    },
  },

  rimguard: {
    onIncoming(h, src, dmg) {
      if (src && src.type === 'hero') return dmg * 0.9;
      return dmg;
    },
  },

  cadence: {
    init(h) { h.pv = { n: 0, t: 0 }; },
    onBasicHit(h) {
      h.pv.n = Math.min(8, (h.pv.t > 0 ? h.pv.n : 0) + 1);
      h.pv.t = 3;
    },
    tick(h, dt) { if (h.pv && h.pv.t > 0) { h.pv.t -= dt; if (h.pv.t <= 0) h.pv.n = 0; } },
    statMod(h) { return { atkSpd: h.def0.atkSpd * 0.04 * ((h.pv && h.pv.t > 0) ? h.pv.n : 0) }; },
  },

  undertow: {
    onBasicHit(h, target) {
      if (!target.cc) return;
      const ten = target.attrs ? target.attrs.get('tenacity') : 0;
      target.cc.applySlow(0.12, 1, ten);
    },
    onDealDamage(h, target, amount) {
      if (!target.cc || !target.cc.has('slow')) return amount;
      return amount * 1.08;
    },
  },

  livecoal: {
    _burn(h, target) {
      if (!target.addDot || target.isStructure) return;
      target.addDot({
        src: h, total: 25 + h.magicPower() * 0.2, dur: 3,
        type: 'magic', color: h.color, tag: 'coal',
      });
    },
    onBasicHit(h, target) { PASSIVES.livecoal._burn(h, target); },
    onSkillHit(h, target) { PASSIVES.livecoal._burn(h, target); },
  },

  rampart: {
    init(h) { h.pv = { t: 8 }; },
    tick(h, dt) {
      if (!h.pv) return;
      h.pv.t -= dt;
      if (h.pv.t > 0) return;
      h.pv.t = 8;
      const shield = h.maxHp * 0.08;
      for (const a of Game.heroes) {
        if (a.team !== h.team || !a.alive || dist(h, a) > 420) continue;
        a.addShield(shield, 3);
      }
      Game.fx.ring(h.x, h.y, 80, THEME.shield, 0.35);
    },
  },

  ossify: {
    onIncoming(h, src, dmg) {
      const red = 0.25 * clamp(1 - h.hpPct / 0.75, 0, 1);
      return dmg * (1 - red);
    },
  },

  deadweight: {
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.skill || !target.cc) return amount;
      if (target.cc.has('slow') || target.cc.has('immobilize') || target.cc.has('stun')) return amount * 1.15;
      return amount;
    },
  },

  peal: {
    init(h) { h.pv = { t: 6 }; },
    tick(h, dt) {
      if (!h.pv) return;
      h.pv.t -= dt;
      if (h.pv.t > 0) return;
      h.pv.t = 6;
      for (const a of Game.heroes) {
        if (a.team !== h.team || !a.alive || dist(h, a) > 420) continue;
        a.addTimedBuff('speed', 50, 2);
      }
    },
  },

  lampglass: {
    onHealAlly(h, ally, amount) {
      if (amount > 0) ally.addShield(amount * 0.4, 2.5);
    },
  },

  tithe: {
    onSkillHit(h, target, dmg) {
      if (!target || target.type !== 'hero' || !dmg) return;
      const heal = dmg * 0.15;
      let best = h, worst = h.hpPct;
      for (const a of Game.heroes) {
        if (a.team !== h.team || !a.alive || dist(h, a) > 520) continue;
        if (a.hpPct < worst) { worst = a.hpPct; best = a; }
      }
      best.heal(heal);
      Game.fx.drainFx(best, Math.round(heal));
    },
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Stats, CCState, resolveDamage, applySkillCC, applyKnockback, PASSIVES };
}
