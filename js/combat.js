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
  constructor(owner) {
    this.owner = owner || null;  // the unit these timers belong to (hooks: onCC, self states)
    this.t = {};                 // type -> remaining seconds
    for (const k in CC_TYPES) this.t[k] = 0;
    this.slowPct = 0;
    this.slows = [];             // live slows [{pct, t}]: the strongest applies, each on its own timer
    this.immuneT = 0;            // purify / spell immunity window
    this.active = 0;             // how many timers are running: 0 lets the getters answer at once
  }
  /* F19: a self state (Weigh Anchor, Shade Step) can list CC kinds it ignores. */
  immuneTo(kind) {
    const o = this.owner;
    return !!(o && o.state && o.state.t > 0 && o.state.s.ccImmune && o.state.s.ccImmune.indexOf(kind) >= 0);
  }
  recount() {
    let n = 0;
    for (const k in this.t) if (this.t[k] > 0) n++;
    this.active = n;
  }
  /* Returns the applied duration (0 if the CC was refused). */
  apply(type, dur, tenacity = 0) {
    const def = CC_TYPES[type];
    if (!def || !(dur > 0)) return 0;
    if (this.immuneT > 0 && type !== 'suppress') return 0;
    if (this.immuneTo(type)) return 0;
    let d = dur;
    if (def.tenacity) d *= 1 - clamp(tenacity, 0, COMBAT.TENACITY_CAP);
    // CC does not stack, it refreshes: the longer of old and new wins
    if (d > this.t[type]) this.t[type] = d;
    this.recount();
    // F28 / F18 / F23: the unit reacts (airborne drops a dash, a channel breaks, a taunt walks)
    if (this.owner && this.owner.onCC) this.owner.onCC(type, d);
    return d;
  }
  /* Slows do not stack: the strongest live one applies, and each keeps its
     own timer, so a strong short slow (a Rime Field's 35% refreshed 0.2 s at
     a time while inside, F13) ends the moment it stops being refreshed
     instead of riding a longer, weaker slow's timer. */
  applySlow(pct, dur, tenacity = 0) {
    const d = this.apply('slow', dur, tenacity);
    if (d <= 0) return 0;
    let e = null;
    for (const k of this.slows) if (k.pct === pct) { e = k; break; }
    if (e) { if (d > e.t) e.t = d; } else this.slows.push({ pct, t: d });
    if (pct > this.slowPct) this.slowPct = pct;
    return d;
  }
  clear() {
    for (const k in this.t) this.t[k] = 0;
    this.slowPct = 0;
    this.slows.length = 0;
    this.active = 0;
  }
  /* Purify: drop every CC currently running and refuse new ones briefly. */
  purify(immuneFor = 0) {
    this.clear();
    this.immuneT = Math.max(this.immuneT, immuneFor);
    // F16: a hostile tether on the purified unit is released (quietly: no break
    // payload, so a Purify beats Karn's Gaol); F23: a taunt walk ends
    const o = this.owner;
    if (o) {
      if (o.forced && o.forced.mode === 'taunt') o.forced = null;
      if (Game.tethers) for (const t of Game.tethers) if (!t.dead && t.hostile && t.target === o) t.release();
    }
  }
  update(dt) {
    if (this.active > 0) {
      let n = 0;
      for (const k in this.t) if (this.t[k] > 0) { this.t[k] -= dt; if (this.t[k] > 0) n++; }
      this.active = n;
    }
    if (this.slows.length) {
      let n = 0, best = 0;
      for (const e of this.slows) { e.t -= dt; if (e.t > 0) { this.slows[n++] = e; if (e.pct > best) best = e.pct; } }
      this.slows.length = n;
      this.slowPct = best;
    }
    if (this.t.slow <= 0) this.slowPct = 0;
    if (this.immuneT > 0) this.immuneT -= dt;
  }
  has(type) { return this.t[type] > 0; }
  get canMove() {
    if (this.active === 0) return true;
    for (const k in this.t) if (this.t[k] > 0 && !CC_TYPES[k].move) return false;
    return true;
  }
  get canAct() {
    if (this.active === 0) return true;
    for (const k in this.t) if (this.t[k] > 0 && !CC_TYPES[k].act) return false;
    return true;
  }
  get canCast() {
    if (this.active === 0) return true;
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
  } else if (packet.critRolled) {
    crit = true;   // a nova with canCrit rolled once for the whole cast (F28); amount already scaled
  }
  packet.crit = crit;   // readable by the on-hit hooks (Vesper's Last Light refunds on a critical basic)

  /* --- attacker-side damage modifiers (passives, buffs) --- */
  if (src && src.onDealDamage && !packet.noPassive) {
    amount = src.onDealDamage(target, amount, packet) ?? amount;
  }
  if (packet.skill && COMBAT.SKILL_DMG && target.type !== 'structure') {
    amount *= COMBAT.SKILL_DMG;
  }

  if (target.type === 'hero' && target.spawnProtT > 0) return 0;   // spawn protection

  /* --- structures (docs/design/lanes-economy.md, 9-10, 14) --- */
  let fixed = false;   // the hit ignores mitigation (fixed minion damage to a shield)
  if (target.isStructure) {
    // the tier behind a live one, an inhibitor behind its inner, the crystal behind its inhibitors
    if (target.shieldedByOuter) return 0;
    const srcType = src ? src.type : null;
    if (srcType === 'hero') {
      // no minion cover -> half damage; a Summoned Lord nearby -> +15%
      let cover = false, escort = false;
      for (const m of Game.minions) {
        if (m.team !== src.team || !m.alive) continue;
        if (!cover && dist(m, target) < COMBAT.COVER_RADIUS) cover = true;
        if (!escort && m.kind === 'lord' && dist(m, src) < 600) escort = true;
        if (cover && escort) break;
      }
      if (!cover) amount *= COMBAT.BACKDOOR_MULT;
      if (escort) amount *= 1.15;
    } else if (srcType === 'minion') {
      if (target.shieldActive) { amount = BALANCE.towerShieldMinionHit * (src.siege ? 2 : 1); fixed = true; }
      else if (target.isBase && src.kind !== 'super' && src.kind !== 'lord') amount *= 0.5;
    }
    if (target.shieldPhase && !target.shieldActive && !fixed) amount *= 1 - BALANCE.towerShieldDr;
    if (target.alertT > Game.time) amount *= BALANCE.orangeAlertDr;
    if ((target.isBase || target.type === 'inhibitor') && Game.time >= BALANCE.lateSiegeAt) amount *= BALANCE.lateSiegeMult;
  } else if (target.type === 'hero' && src) {
    if (src.type === 'hero' && Game.time < BALANCE.towerShieldEnd) {
      // allied heroes standing with a shielded outer take less from heroes
      for (const t of Game.towers) {
        if (t.team !== target.team || !t.alive || !t.shieldActive) continue;
        if (dist(t, target) < t.range) { amount *= 1 - BALANCE.towerShieldAllyDr; break; }
      }
    } else if (src.type === 'monster' && target.spell && target.spell.id === 'retribution') {
      amount *= 1 - BALANCE.junglerCreepDr;
    }
  }

  /* --- mitigation --- */
  let mult = 1;
  if (fixed) {
    // already final
  } else if (type === 'physical') {
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

/* ============================================================
   Rank scaling (docs/design/heroes.md F1)
   ============================================================
   A skill field at a rank. Arrays index by rank (an ultimate's
   cd: [46, 42, 38]); a scalar with a sibling `<key>Lv` delta grows per
   rank (cd: 8, cdLv: -0.4). Rank 0 (unlearned) reads as rank 1: nothing
   unlearned ever casts, but tooltips and sub-skills still need a number.
   `slowPctLv` is per zone tick (F28), never per rank, so it is skipped. */
const RANK_TICK_KEYS = { slowPct: true };
function rankVal(s, key, rank) {
  if (!s) return undefined;
  const v = s[key];
  if (Array.isArray(v)) {
    const r = rank > v.length ? v.length : rank > 1 ? rank : 1;
    return v[(r | 0) - 1];
  }
  if (typeof v !== 'number' || RANK_TICK_KEYS[key]) return v;
  const lv = s[key + 'Lv'];
  return (typeof lv === 'number' && rank > 1) ? v + lv * (rank - 1) : v;
}

/* Apply every CC a skill definition carries, in one call. `rank` resolves
   per-rank arrays (F1); `over` may carry a `slowPct` computed by the caller
   (a zone tick's slowPctLv ramp, F28; a boomerang's return pass, F10, which
   also sets `slowDur`). */
function applySkillCC(src, target, s, rank, over) {
  if (!s || !target.cc) return;
  const r = rank || (src && src.skillRankOf ? src.skillRankOf(s) : 1);
  const ten = target.attrs ? target.attrs.get('tenacity') : 0;
  for (const type in CC_TYPES) {
    if (type === 'slow' || type === 'taunt') continue;
    if (s[type]) target.cc.apply(type, rankVal(s, type, r), ten);
  }
  const slowPct = (over && over.slowPct !== undefined) ? over.slowPct : rankVal(s, 'slowPct', r);
  const slowDur = (over && over.slowDur !== undefined) ? over.slowDur : rankVal(s, 'slowDur', r);
  if (slowPct) target.cc.applySlow(slowPct, slowDur || 1.5, ten);
  if (s.taunt) applyTaunt(src, target, rankVal(s, 'taunt', r), ten);
  if (s.knockback) applyKnockback(src, target, rankVal(s, 'knockback', r), s, r, over && over.from, over && over.dir);
  if (s.pullTo) applyPullTo(src, target, s, r, over);
}

/* ============================================================
   Skill-owned marks (docs/design/heroes.md F12)
   ============================================================
   marks[tag] holds the stacks, marks[tag+'T'] the expiry (the convention
   the passives already use: emberT, chillT...), marks[tag+'At'] when it
   was last applied (bonusVsMark's `within`), marks[tag+'C'] its pip colour.
   A mark whose expiry has passed reads as 0 stacks. */
function markStacks(target, tag) {
  const m = target.marks;
  if (!m || !(m[tag] > 0) || !(m[tag + 'T'] > Game.time)) return 0;
  return m[tag];
}
/* applyMark: {tag, max, dur, stacks?, centreStacks?: {within, stacks},
   dot?: {base, scaleAp, pctMaxHp, pctPerMp, dur, capNonHero}}. With a dot,
   the total is stacks x the per-stack amount over dur, refreshed on re-apply. */
function applyMark(src, target, s, rank, over) {
  const a = s.applyMark;
  if (!a || !target.marks || target.isStructure || !target.alive) return 0;
  const m = target.marks;
  let add = a.stacks || 1;
  if (a.centreStacks && over && over.zone) {
    const z = over.zone;
    if (hyp(target.x - z.x, target.y - z.y) <= a.centreStacks.within) add = a.centreStacks.stacks;
  }
  const n = Math.min(a.max || 99, markStacks(target, a.tag) + add);
  const dur = a.dur || 4;
  m[a.tag] = n; m[a.tag + 'T'] = Game.time + dur; m[a.tag + 'At'] = Game.time;
  m[a.tag + 'D'] = dur; m[a.tag + 'C'] = src.color || THEME.magic;
  if (!target.markTags) target.markTags = [];
  if (target.markTags.indexOf(a.tag) < 0) target.markTags.push(a.tag);
  if (a.dot) {
    const d = a.dot, mp = src.magicPower ? src.magicPower() : 0;
    let per = (d.base || 0) + mp * (d.scaleAp || 0) + target.maxHp * ((d.pctMaxHp || 0) + (d.pctPerMp || 0) * mp);
    if (target.type !== 'hero' && d.capNonHero) per = Math.min(per, d.capNonHero);
    if (per > 0) target.addDot({ src, total: per * n, dur: d.dur || dur, type: d.type || s.dmgType || 'magic', color: src.color, tag: a.tag });
  }
  return n;
}
/* The damage a consumeMark adds per victim (read by skillDmg, F2):
   stacks x (dmg + dmgLv per rank + scaleAp of magic power). */
function markConsumeBonus(src, target, c, rank) {
  const n = markStacks(target, c.tag);
  if (!n) return 0;
  return n * ((rankVal(c, 'dmg', rank) || 0) + (src.magicPower ? src.magicPower() : 0) * (c.scaleAp || 0));
}
/* consumeMark: {tag, dmg, dmgLv, scaleAp, stunAtStacks, stunDur, stunLock}.
   After the hit: at stunAtStacks the victim is stunned unless its
   stunLockT is still running, and the mark and its dot are removed. */
function consumeMark(src, target, s, rank) {
  const c = s.consumeMark;
  const n = markStacks(target, c.tag);
  if (!n) return 0;
  const m = target.marks;
  if (c.stunAtStacks && n >= c.stunAtStacks && target.cc && !(m.stunLockT > Game.time)) {
    target.cc.apply('stun', c.stunDur || 0.5, target.attrs ? target.attrs.get('tenacity') : 0);
    m.stunLockT = Game.time + (c.stunLock || 0);
    Game.fx.ring(target.x, target.y, target.radius + 22, src.color || THEME.magic, 0.45);
  }
  clearMark(target, c.tag);
  return n;
}
function clearMark(target, tag) {
  const m = target.marks;
  if (!m) return;
  delete m[tag]; delete m[tag + 'T'];
  if (target.dots && target.dots.length) target.dots = target.dots.filter(d => d.tag !== tag);
}
/* refreshMark: {tag, dur?} resets the timer (and the dot's) without consuming. */
function refreshMark(src, target, r) {
  if (!markStacks(target, r.tag)) return false;
  const m = target.marks;
  m[r.tag + 'T'] = Game.time + (r.dur || m[r.tag + 'D'] || 4);
  if (target.dots) for (const d of target.dots) if (d.tag === r.tag && d.src === src) d.t = Math.max(d.t, r.dur || m[r.tag + 'D'] || 4);
  return true;
}

/* ============================================================
   Charge skills (docs/design/heroes.md F8)
   ============================================================
   Take `sec` off the recharge in progress on skill `i` (Vesper's Last
   Light). A refund that would finish it leaves a hair, so the next frame
   grants the charge instead of restarting the timer. */
function refundRecharge(h, i, sec) {
  if (!h || !h.skillRecharge || !(h.skillRecharge[i] > 0) || !(sec > 0)) return false;
  h.skillRecharge[i] = Math.max(1e-3, h.skillRecharge[i] - sec);
  return true;
}

/* ============================================================
   Taunt (docs/design/heroes.md F23) and channel breakers (F18)
   ============================================================ */
/* The CC kinds that break a channel the moment they land. */
const CHANNEL_BREAKERS = { stun: 1, silence: 1, airborne: 1, suppress: 1, taunt: 1 };

/* A taunt is a CC timer plus a forced state: while `taunt` runs the victim
   ignores its own input, walks at `src` and swings at it. A shove or hook
   already carrying the victim finishes first (the taunt is queued behind
   it, see Unit.endForced). Tenacity shortens it; Purify ends it. */
function applyTaunt(src, target, dur, ten) {
  if (!src || !target.cc || target.isStructure || !target.alive || src === target) return 0;
  const d = target.cc.apply('taunt', dur, ten);
  if (d <= 0) return 0;
  const f = { mode: 'taunt', src, t: d };
  const cur = target.forced;
  if (cur && cur.mode !== 'taunt') cur.prev = f;
  else target.forced = f;
  Game.fx.ring(target.x, target.y, target.radius + 18, THEME.warn, 0.4);
  return d;
}

/* F28 chill lock. Every Chill stack (Mira's passive, her lingering Rime
   Fields) lands through here so `marks.chillImmuneT` is honoured in one
   place: a target that has just thawed cannot be re-chilled until it
   passes. Four stacks freeze 0.8 s (stun), consume the stacks and lock the
   target for CHILL_IMMUNE seconds (2.5, docs/design/heroes.md: Mira);
   `opts.immuneAfter` overrides the lock. */
const CHILL_IMMUNE = 2.5;
function applyChill(src, target, opts) {
  if (!target.marks || !target.cc || target.isStructure || !target.alive) return false;
  const m = target.marks;
  if (m.chillImmuneT > Game.time) return false;
  m.chill = (m.chill && m.chillT > Game.time) ? m.chill + 1 : 1;
  m.chillT = Game.time + 4;
  const ten = target.attrs ? target.attrs.get('tenacity') : 0;
  if (m.chill >= 4) {
    m.chill = 0;
    target.cc.apply('stun', 0.8, ten);
    const lock = opts && opts.immuneAfter !== undefined ? opts.immuneAfter : CHILL_IMMUNE;
    if (lock > 0) m.chillImmuneT = Game.time + lock;
    Game.fx.ring(target.x, target.y, target.radius + 26, THEME.ccSlow, 0.5);
  } else {
    target.cc.applySlow(0.08 * m.chill, 4, ten);
  }
  return true;
}

/* ============================================================
   Displacement (docs/design/heroes.md F15)
   ============================================================
   A shove, pull or launch is a tween, not a teleport: the unit is carried
   over a few frames by `u.forced` (Unit.updateForced) and stops at the
   first rock or turret it meets, where the skill's wallDmg / wallStun land.
   It is not a CC timer: the unit is free the moment it stops, which is
   what separates a shove from an airborne. Tenacity does not shorten it;
   Purify immunity and a `displacement` self-immunity (F19) refuse it; a
   dash in progress finishes first; a hook keeps its victim; a taunt is
   put aside and restored afterwards.

   spec: {mode: 'slide', dx, dy, dist, speed?, t?} or {mode: 'point', x, y, speed, t?},
         plus s / rank for the wall payload and noWallCC. */
function applyDisplacement(src, target, spec) {
  if (!target || target.isStructure || !target.alive) return false;
  const cc = target.cc;
  if (cc && (cc.immuneT > 0 || cc.immuneTo('displacement'))) return false;
  const cur = target.forced;
  if (cur && cur.mode === 'hook') return false;
  const f = {
    mode: spec.mode || 'slide', src: src || null, s: spec.s || null, rank: spec.rank || 1,
    dx: spec.dx || 0, dy: spec.dy || 0, dist: spec.dist || 0,
    x: spec.x, y: spec.y, speed: spec.speed || 0, t: spec.t || 0, prev: null,
  };
  if (f.mode === 'slide') {
    if (!f.t) f.t = 0.25;
    if (!f.speed) f.speed = f.dist / f.t;
  } else {
    if (!f.speed) f.speed = 900;
    if (!f.t) f.t = Math.hypot(f.x - target.x, f.y - target.y) / f.speed + 0.05;
  }
  if (cur && cur.mode === 'taunt') f.prev = cur;
  else if (cur && cur.prev) f.prev = cur.prev;
  target.forced = f;
  if (target.marks) { target.marks.heavyUntil = Game.time + 3; target.marks.heavyBy = src || null; }   // Nadir's Accretion reads these
  Game.fx.spark(target.x, target.y, THEME.ccKnockback, 5);
  return true;
}

/* A `knockback` field: slide away from the origin (the caster, or a zone's
   centre) — or toward it when the distance is negative (a pull, which stops
   at the bodies rather than dragging the victim through the caster). A
   skillshot passes its flight direction as `dir` (Tide's wave carries its
   victims along the line, not away from the caster).
   0.25 s for a shove, 0.3 s for a pull; `knockbackT` on the skill overrides. */
function applyKnockback(src, target, distance, s, rank, from, dir) {
  if (!src || !distance || target.isStructure || !target.alive) return false;
  const o = from || src;
  let rx = target.x - o.x, ry = target.y - o.y;
  let d = Math.sqrt(rx * rx + ry * ry);
  if (dir && distance > 0) { rx = dir.x; ry = dir.y; d = Math.hypot(rx, ry) || 1; }
  else if (d < 1) { rx = Math.cos(target.facing); ry = Math.sin(target.facing); d = 1; }
  rx /= d; ry /= d;
  let dist = distance;
  if (dist < 0) {
    rx = -rx; ry = -ry; dist = -dist;
    if (o === src) dist = Math.min(dist, Math.max(0, d - (src.radius + target.radius)));
    if (dist <= 0) return false;
  }
  const t = (s && s.knockbackT) || (distance < 0 ? 0.3 : 0.25);
  return applyDisplacement(src, target, { mode: 'slide', dx: rx, dy: ry, dist, t, s, rank });
}

/* pullTo: {target: 'caster'|'point', dist, speed} — a tweened drag toward
   the caster (stopping at the bodies) or toward the cast point (`over.point`). */
function applyPullTo(src, target, s, rank, over) {
  const p = s.pullTo;
  if (!p || !src || target.isStructure || !target.alive) return false;
  const to = (p.target === 'point' && over && over.point) ? over.point : src;
  const rx = to.x - target.x, ry = to.y - target.y, d = Math.sqrt(rx * rx + ry * ry);
  if (d < 1) return false;
  const stop = to === src ? src.radius + target.radius : 0;
  const dist = Math.min(p.dist || d, Math.max(0, d - stop));
  if (dist <= 0) return false;
  const speed = p.speed || 900;
  return applyDisplacement(src, target, { mode: 'slide', dx: rx / d, dy: ry / d, dist, speed, t: dist / speed + 1e-3, s, rank });
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
     onBasicHit(h, target, dmg, pkt)— after a basic attack lands (pkt.crit says whether it crit)
     onSkillHit(h, target, dmg, s)  — after any skill damage lands
     onDealDamage(h, t, amt, pkt)   — modify outgoing damage, return a number
     onIncoming(h, src, dmg, pkt)   — modify incoming damage, return a number
     onKill(h, victim)              — after securing a hero kill
     onHealAlly(h, ally, amount)    — after healing someone
*/
const PASSIVES = {
  /* Zephyr — each basic that lands (a volley's primary hit only, F7) is a
     Slipstream stack: +6% move speed per stack for 2 s, five at most, all
     dropped together when the timer lapses; at five stacks basics carry
     +18 (+12% ATK). A Gale Shot that hits a hero is one stack per cast. */
  slipstream: {
    init(h) { h.pv = { stacks: 0, t: 0, galeT: -1 }; },
    _stack(h) {
      h.pv.stacks = Math.min(5, (h.pv.t > 0 ? h.pv.stacks : 0) + 1);
      h.pv.t = 2;
      h.addTimedBuff('speedPct', 0.06 * h.pv.stacks, 2);
    },
    onBasicHit(h) { PASSIVES.slipstream._stack(h); },
    onSkillHit(h, target, dmg, s) {
      if (!target || target.type !== 'hero' || !s || (s._base || s) !== h.skills[0]) return;
      if (Game.time < h.pv.galeT) return;   // one cast, one stack, however many heroes it pierces over its flight
      h.pv.galeT = Game.time + 1;           // the shot flies 0.7 s; the cooldown is never under 5.5 s
      PASSIVES.slipstream._stack(h);
    },
    tick(h, dt) { if (h.pv && h.pv.t > 0) { h.pv.t -= dt; if (h.pv.t <= 0) h.pv.stacks = 0; } },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.isBasic || !h.pv || h.pv.stacks < 5 || h.pv.t <= 0) return amount;
      return amount + 18 + h.curAtk() * 0.12;
    },
  },

  /* Ignis — the Embers are his skills' mark (F12 applyMark on Flame Fan and
     Pyroclasm, consumed by Flashburn); the passive only reads them: a basic
     on a hero carrying one lands +25 (+20% MAGIC) bonus magic damage as a
     packet of its own (no crit, no drain, no passive re-entry). */
  kindling: {
    onBasicHit(h, target) {
      if (target.type !== 'hero' || !markStacks(target, 'ember')) return;
      resolveDamage(h, target, { amount: 25 + h.magicPower() * 0.2, type: 'magic', noPassive: true, lifestealMult: 0 });
      Game.fx.spark(target.x, target.y, h.color, 3);
    },
  },

  /* Grom — resists scale with how many enemies are on him (+5/+5 per enemy
     hero within 420, five at most); panic shield low. */
  bulwark: {
    init(h) { h.pv = { shieldCd: 0 }; },
    statMod(h) {
      let near = 0;
      for (const e of Game.heroes) if (e.team !== h.team && e.alive && dist(h, e) < 420) near++;
      if (near > 5) near = 5;
      return { armor: near * 5, mr: near * 5 };
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
      h.gainMana(12);
    },
  },

  /* Torren — 8% lifesteal plus 1% per 3% of missing HP, 35% at or below
     20% HP. The stat only drains on basics (resolveDamage reads spellVamp
     for skills). */
  bloodthirst: {
    statMod(h) {
      const pct = h.hpPct;
      return { lifesteal: pct <= 0.2 ? 0.35 : Math.min(0.35, 0.08 + (1 - pct) / 0.03 * 0.01) };
    },
  },

  /* Mira — every basic and skill hit is one Chill (applyChill: 8% slow per
     stack, a 0.8 s freeze at four, then 2.5 s of immunity). */
  frostbite: {
    onSkillHit(h, target) { applyChill(h, target); },
    onBasicHit(h, target) { applyChill(h, target); },
  },

  /* Karn — attacks cut cooldowns, hits build armor. */
  ironclad: {
    init(h) { h.pv = { plates: 0, plateT: 0 }; },
    onBasicHit(h) {
      for (let i = 0; i < h.skillCd.length; i++) {
        if (h.skillCd[i] > 0) h.skillCd[i] = Math.max(0, h.skillCd[i] - 0.5);
      }
    },
    statMod(h) { return { armor: (h.pv ? h.pv.plates : 0) * 4 }; },
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

  /* Vesper — basics and Deadeye Round on a hero under 40% HP deal +20%
     (Fan the Hammer shots do not); a critical basic on a hero takes 1.0 s
     off Fan the Hammer's running recharge (F8 refundRecharge), once per
     2.5 s. */
  lastlight: {
    init(h) { h.pv = { refundT: -99 }; },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || target.type !== 'hero' || !(target.hpPct < 0.4)) return amount;
      if (pkt.isBasic || (pkt.skill && (pkt.skill._base || pkt.skill) === h.skills[2])) return amount * 1.2;
      return amount;
    },
    onBasicHit(h, target, dmg, pkt) {
      if (!pkt || !pkt.crit || target.type !== 'hero' || Game.time - h.pv.refundT < 2.5) return;
      if (refundRecharge(h, 0, 1.0)) h.pv.refundT = Game.time;
    },
  },

  /* Quill — a skill or trap hit marks the victim 4 s (marks.quarryT);
     basics on a marked target deal +12% and stack +8% move speed for
     1.5 s, three at most, refreshed per hit. */
  quarry: {
    init(h) { h.pv = { n: 0, t: 0 }; },
    onSkillHit(h, target) {
      if (!target.marks || target.isStructure) return;
      target.marks.quarryT = Game.time + 4;
    },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.isBasic || !target.marks || !(target.marks.quarryT > Game.time)) return amount;
      return amount * 1.12;
    },
    onBasicHit(h, target) {
      if (!target.marks || !(target.marks.quarryT > Game.time)) return;
      h.pv.n = Math.min(3, (h.pv.t > 0 ? h.pv.n : 0) + 1);
      h.pv.t = 1.5;
      h.addTimedBuff('speedPct', 0.08 * h.pv.n, 1.5);
    },
    tick(h, dt) { if (h.pv && h.pv.t > 0) { h.pv.t -= dt; if (h.pv.t <= 0) h.pv.n = 0; } },
  },

  /* Lumen — basics deal up to +35% the farther the target is: nothing
     inside 280, the full +35% at her max attack range. */
  aperture: {
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.isBasic) return amount;
      const d = dist(h, target);
      if (d < 280) return amount;
      const span = Math.max(1, (h.range || 390) - 280);
      return amount * (1 + Math.min(0.35, (d - 280) / span * 0.35));
    },
  },

  /* Volt — skill hits on enemy HEROES stack Static (4 s, five at most),
     8 flat magic penetration per stack against that target; creeps,
     monsters and structures never carry it. */
  static: {
    onSkillHit(h, target) {
      if (target.type !== 'hero' || !target.marks) return;
      const m = target.marks;
      m.static = (m.staticT > Game.time) ? Math.min(5, m.static + 1) : 1;
      m.staticT = Game.time + 4;
    },
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || pkt.type !== 'magic' || !target.marks || target.marks.staticT < Game.time) return amount;
      pkt.pen = pkt.pen || { flat: 0, pct: 0 };
      pkt.pen.flat = (pkt.pen.flat || 0) + target.marks.static * 8;
      return amount;
    },
  },

  /* Nadir — the displacement tween (F15: a pullTo, a knockback, a zone's
     pullSpeed) stamps marks.heavyBy / heavyUntil on whoever it moves; an
     enemy hero Nadir moved is Heavy 3 s: a flat 20% slow refreshed each
     frame (the strongest slow wins, so it never weakens a Singularity
     slow) and +12% damage taken from Nadir alone. */
  accretion: {
    _heavy(h, u) { return !!(u.marks && u.marks.heavyBy === h && u.marks.heavyUntil > Game.time); },
    tick(h) {
      for (const e of Game.heroes) {
        if (e.team === h.team || !e.alive || !e.cc || !PASSIVES.accretion._heavy(h, e)) continue;
        e.cc.applySlow(0.2, 0.25, 0);
      }
    },
    onDealDamage(h, target, amount) {
      return PASSIVES.accretion._heavy(h, target) ? amount * 1.12 : amount;
    },
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
        src: h, total: (50 + h.magicPower() * 0.3) * m.blight, dur: 3,
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

  /* Omen — basics stack +5% attack speed 3 s (eight at most); a Crosscut
     that hits an enemy hero is worth two stacks, once per cast. */
  cadence: {
    init(h) { h.pv = { n: 0, t: 0, crossT: -1 }; },
    _stack(h, k) {
      h.pv.n = Math.min(8, (h.pv.t > 0 ? h.pv.n : 0) + k);
      h.pv.t = 3;
    },
    onBasicHit(h) { PASSIVES.cadence._stack(h, 1); },
    onSkillHit(h, target, dmg, s) {
      if (!target || target.type !== 'hero' || !s || (s._base || s) !== h.skills[0]) return;
      if (h.pv.crossT === Game.time) return;   // one cast, two stacks, however many heroes it cut
      h.pv.crossT = Game.time;
      PASSIVES.cadence._stack(h, 2);
    },
    tick(h, dt) { if (h.pv && h.pv.t > 0) { h.pv.t -= dt; if (h.pv.t <= 0) h.pv.n = 0; } },
    statMod(h) { return { atkSpd: h.def0.atkSpd * 0.05 * ((h.pv && h.pv.t > 0) ? h.pv.n : 0) }; },
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

  /* Cinder — every basic and skill hit burns 25 (+20% MAGIC) over 3 s,
     refreshed on re-apply; while a burnUpgrade buff (Furnace) runs the
     burn is 50 (+40% MAGIC). The 'coal' tag is what her Heat burn-up reads. */
  livecoal: {
    _burn(h, target) {
      if (!target.addDot || target.isStructure) return;
      const hot = h.buffState && h.buffState.t > 0 && h.buffState.s.burnUpgrade;
      target.addDot({
        src: h, total: hot ? 50 + h.magicPower() * 0.4 : 25 + h.magicPower() * 0.2, dur: 3,
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

  /* Marrow — up to 25% less damage as he drops (0% at full HP, 25% at or
     below 25%); true damage is not reduced. The bank holds the HP his
     skills cost (F6, Hero.payCost) for Catacomb's bonus (F2, Hero.bankedHp). */
  ossify: {
    init(h) { h.pv = { bank: [] }; },
    onIncoming(h, src, dmg, pkt) {
      if (pkt && pkt.type === 'true') return dmg;
      const red = 0.25 * clamp((1 - h.hpPct) / 0.75, 0, 1);
      return dmg * (1 - red);
    },
  },

  /* Anchor — skill hits on a slowed, rooted, stunned or airborne enemy deal +15%. */
  deadweight: {
    onDealDamage(h, target, amount, pkt) {
      if (!pkt || !pkt.skill || !target.cc) return amount;
      const c = target.cc;
      if (c.has('slow') || c.has('immobilize') || c.has('stun') || c.has('airborne')) return amount * 1.15;
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
  module.exports = { Stats, CCState, resolveDamage, applySkillCC, applyKnockback, applyDisplacement, applyPullTo, rankVal, applyChill,
    markStacks, applyMark, consumeMark, refreshMark, clearMark, applyTaunt, refundRecharge, CHANNEL_BREAKERS, PASSIVES };
}
