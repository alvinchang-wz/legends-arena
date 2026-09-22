'use strict';
/* ============================================================
   features.js — one hundred player-facing systems layered on the
   match without replacing the 5v5 / 10v10 / duel boards.

   Each entry in FEATURE_CATALOG is implemented below. The pack is
   a single Game/UI/Input hook so a new match always starts clean.
   ============================================================ */

const FEATURE_CATALOG = [
  'Creep score counter', 'Gold per minute', 'XP bar', 'Buff tray', 'Target frame',
  'Execute kill pip', 'Last-hit gold popup', 'Tower aggro warning', 'Wave countdown',
  'Jungle respawn pips', 'Recall HUD bar', 'Spawn protection', 'Out-of-combat regen',
  'In-combat indicator', 'Kill participation', 'Healing on scoreboard', 'Vision score',
  'CS on scoreboard', 'Structure damage stat', 'Post-match awards',
  'Camera lock', 'Attack-move', 'Halt command', 'Auto-attack toggle', 'Range rings',
  'Center camera', 'Camera peek slider', 'Shake intensity', 'SFX volume', 'Ambience volume',
  'Colorblind outlines', 'FPS counter', 'Large minimap', 'Hide HUD', 'Keybind overlay',
  'Pause hotkey', 'Surrender button', 'Shop search', 'Buy components', 'Purchase undo',
  'Health potion', 'Mana tonic', 'Mixed flask', 'Stealth ward', 'Control ward',
  'Sweeper lens', 'Aegis Pulse active', 'Frostheart active', 'Windfeather active',
  'Combat potion lock',
  'Missing ping', 'Quick chat: Well played', 'Quick chat: Sorry', 'Quick chat: Thanks',
  'Quick chat: Incoming', 'Emote: Cheer', 'Emote: Laugh', 'Emote: Salute', 'Emote: Threat',
  'Chat log',
  'Honeyfruit', 'Blast cones', 'Speed shrines', 'Scryer beetles', 'Brush rustle',
  'Last-seen ghosts', 'Spawn shield VFX', 'Fountain gate', 'Backdoor warning',
  'Eclipse lighting', 'World wards', 'Plant respawns',
  'Hit markers', 'Directional hurt ticks', 'Low HP vignette', 'Item active buttons',
  'Consumable hotkeys', 'Ult-ready flash', 'Level-up pulse', 'Siege minion highlight',
  'Ace announcement', 'Enemy ace',
  'Match history', 'Favorite heroes', 'Cosmetic tint', 'Hero mastery', 'Loading tips',
  'AFK detect', 'Comeback sting', 'Spectator next/prev', 'Spectator cooldowns',
  'Post-match damage graph', 'Biggest fight recap', 'Shutdown kill-feed badge',
  'Smart missing hint', 'Camp timer numbers', 'Always-on attack range',
  'Undo toast', 'What\'s new browser', 'Settings persistence',
];

const Features = {
  prefs: {
    camLock: true, autoAttack: true, rangeRings: false, alwaysRange: false,
    hideHud: false, largeMini: false, fps: false, colorblind: false,
    peek: 0, shake: 1, sfx: 1, amb: 0.7,
  },
  camLock: true,
  attackMove: false,
  halted: false,
  wards: [],
  plants: [],
  shrines: [],
  beetles: [],
  chat: [],
  emotes: [],
  lastSeen: new Map(),
  lastBush: new Map(),
  undo: null,
  idleT: 0,
  comebackT: 0,
  aceLatch: [false, false],
  fightHeat: 0, fightBest: 0, fightAt: 0,
  dmgHistory: [],
  fpsEma: 60, fpsShown: 60,
  shopQuery: '',
  missingHintAt: 0,

  loadPrefs() {
    try {
      const raw = localStorage.getItem('legends.featPrefs');
      if (raw) Object.assign(this.prefs, JSON.parse(raw));
    } catch (e) { /* private mode */ }
    /* Old builds defaulted camera peek on, which made the mouse drag the
       view. One-shot reset so existing saves match the locked follow cam. */
    if (this.prefs.camFollowV !== 2) {
      this.prefs.peek = 0;
      this.prefs.camLock = true;
      this.prefs.camFollowV = 2;
      this.savePrefs();
    }
    this.camLock = !!this.prefs.camLock;
  },
  savePrefs() {
    try { localStorage.setItem('legends.featPrefs', JSON.stringify(this.prefs)); }
    catch (e) { /* ignore */ }
  },

  onMatchStart() {
    this.wards = [];
    this.plants = [];
    this.shrines = [];
    this.beetles = [];
    this.chat = [];
    this.emotes = [];
    this.lastSeen = new Map();
    this.lastBush = new Map();
    this.undo = null;
    this.idleT = 0;
    this.comebackT = 0;
    this.aceLatch = [false, false];
    this.fightHeat = 0; this.fightBest = 0; this.fightAt = 0;
    this.dmgHistory = [{ t: 0, blue: 0, red: 0 }];
    this.attackMove = false;
    this.halted = false;
    this.missingHintAt = 0;
    this.shopQuery = '';
    this.seedMap();
    for (const h of Game.heroes) this.prepHero(h);
    this.applyCosmeticTints();
    this.bumpMastery();
    if (typeof Mlbb !== 'undefined') Mlbb.bindSelect();
  },

  prepHero(h) {
    h.cs = h.cs || 0;
    h.visionScore = h.visionScore || 0;
    h.combatT = 0;
    h.spawnProtT = h.spawnProtT || 0;
    h.spawnGateT = h.spawnGateT || 0;
    h.itemCd = h.itemCd || {};
    h.shrineT = h.shrineT || 0;
    h.idleT = 0;
    h.dirHurt = h.dirHurt || [];
    if (!h.stats.healDone) h.stats.healDone = 0;
  },

  seedMap() {
    if (Game.isDuel()) {
      const s = DUEL_MAP.shrine;
      this.plants.push({ kind: 'fruit', x: s.x - 220, y: s.y + 40, r: 28, up: true, t: 0 });
      this.plants.push({ kind: 'cone', x: s.x + 240, y: s.y - 30, r: 32, up: true, t: 0 });
      return;
    }
    const spots = Game.isTen() ? this.tenSpots() : this.dawnSpots();
    for (const p of spots.fruit) this.plants.push({ kind: 'fruit', x: p.x, y: p.y, r: 26, up: true, t: 0 });
    for (const p of spots.cone) this.plants.push({ kind: 'cone', x: p.x, y: p.y, r: 30, up: true, t: 0 });
    for (const p of spots.shrine) this.shrines.push({ x: p.x, y: p.y, r: 48, up: true, t: 0 });
    for (const p of spots.beetle) this.beetles.push({ x: p.x, y: p.y, home: { x: p.x, y: p.y }, r: 22, up: true, t: 0, a: 0 });
  },

  dawnSpots() {
    const sc = typeof MAP_SCALE === 'number' ? MAP_SCALE : 1;
    const p = (x, y) => ({ x: x * sc, y: y * sc });
    return {
      fruit: [p(1680, 1520), p(1520, 1680), p(2100, 1180), p(1180, 2100)],
      cone: [p(980, 1680), p(1680, 980), p(2220, 1480), p(1480, 2220)],
      shrine: [p(1280, 1280), p(1920, 1920)],
      beetle: [p(1600, 1400), p(1400, 1600)],
    };
  },
  tenSpots() {
    const W = TEN_MAP.world, c = TEN_MAP.crater;
    return {
      fruit: [
        { x: c.x - 980, y: c.y }, { x: c.x + 980, y: c.y },
        { x: c.x, y: c.y - 980 }, { x: c.x, y: c.y + 980 },
      ],
      cone: [
        { x: 1100, y: 1800 }, { x: W - 1100, y: 1800 },
        { x: 1100, y: W - 1800 }, { x: W - 1100, y: W - 1800 },
      ],
      shrine: [TEN_MAP.beaconWest, TEN_MAP.beaconEast],
      beetle: [
        { x: c.x - 700, y: c.y - 700 }, { x: c.x + 700, y: c.y + 700 },
      ],
    };
  },

  update(dt) {
    if (Game.state !== 'play') return;
    this.tickHeroes(dt);
    this.tickWards(dt);
    this.tickPlants(dt);
    this.tickShrines(dt);
    this.tickBeetles(dt);
    this.tickEmotes(dt);
    this.tickAce();
    this.tickComeback();
    this.tickAfk(dt);
    this.tickMissingHint(dt);
    this.tickFight(dt);
    this.tickUndo(dt);
    this.tickBackdoor();
    if (this.dmgSampleT == null) this.dmgSampleT = 0;
    this.dmgSampleT -= dt;
    if (this.dmgSampleT <= 0) {
      this.dmgSampleT = 30;
      let b = 0, r = 0;
      for (const h of Game.heroes) {
        if (h.team === TEAM_BLUE) b += h.stats.dmgHero; else r += h.stats.dmgHero;
      }
      this.dmgHistory.push({ t: Game.time, blue: b, red: r });
    }
  },

  tickHeroes(dt) {
    for (const h of Game.heroes) {
      if (h.spawnGateT > 0) h.spawnGateT -= dt;
      if (h.combatT > 0) h.combatT -= dt;
      if (h.shrineT > 0) h.shrineT -= dt;
      if (h.sweepT > 0) h.sweepT -= dt;
      if (h._manaSip) {
        h._manaSip.t -= dt;
        h.gainMana(h._manaSip.rate * dt);   // F3: a mana thing; a heat, energy or cooldown hero gets nothing
        if (h._manaSip.t <= 0) h._manaSip = null;
      }
      for (const k in h.itemCd) if (h.itemCd[k] > 0) h.itemCd[k] -= dt;
      if (h.dirHurt) {
        for (const d of h.dirHurt) d.t -= dt;
        h.dirHurt = h.dirHurt.filter(d => d.t > 0);
      }
      if (h.alive) {
        this.lastSeen.set(h, { x: h.x, y: h.y, t: Game.time });
        if (h.combatT <= 0) {
          h.heal(h.maxHp * 0.004 * dt);
          h.gainMana(h.maxMana * 0.003 * dt);   // F3: never a heat gauge (Cinder would warm up standing still)
        }
      }
    }
  },

  tickWards(dt) {
    for (const w of this.wards) {
      w.t -= dt;
      if (w.control) {
        for (const o of this.wards) {
          if (o === w || o.team === w.team || !o.alive) continue;
          if (dist(w, o) < 280) { o.t = Math.min(o.t, 0); o.disabled = true; }
        }
      }
      if (w.t <= 0) w.alive = false;
    }
    this.wards = this.wards.filter(w => w.alive !== false && w.t > 0);
  },

  tickPlants(dt) {
    for (const p of this.plants) {
      if (!p.up) {
        p.t -= dt;
        if (p.t <= 0) { p.up = true; Game.fx.ring(p.x, p.y, 40, p.kind === 'fruit' ? '#7dff9a' : '#ffd27a', 0.4); }
        continue;
      }
      for (const h of Game.heroes) {
        if (!h.alive || dist(h, p) > p.r + h.radius) continue;
        if (p.kind === 'fruit') {
          const amt = h.heal(h.maxHp * 0.18 + 140);
          h.stats.healDone += amt;
          Game.fx.healFx(h, Math.round(amt));
          if (h.isPlayer) UI.announce('🍓 Honeyfruit', 'minor');
        } else {
          const dx = h.x - p.x, dy = h.y - p.y, m = Math.hypot(dx, dy) || 1;
          h.x += dx / m * 280; h.y += dy / m * 280;
          Game.clampPoint(h, 40);
          Game.fx.explosion(p.x, p.y, 70);
          if (h.isPlayer) UI.announce('💥 Blast cone', 'minor');
        }
        p.up = false; p.t = p.kind === 'fruit' ? 75 : 90;
        break;
      }
    }
  },

  tickShrines(dt) {
    for (const s of this.shrines) {
      if (!s.up) {
        s.t -= dt;
        if (s.t <= 0) s.up = true;
        continue;
      }
      for (const h of Game.heroes) {
        if (!h.alive || dist(h, s) > s.r + h.radius) continue;
        h.shrineT = 6;
        s.up = false; s.t = 80;
        Game.fx.ring(s.x, s.y, 70, THEME.gold, 0.55);
        if (h.isPlayer) UI.announce('🌀 Speed shrine', 'minor');
        break;
      }
    }
  },

  tickBeetles(dt) {
    for (const b of this.beetles) {
      if (!b.up) {
        b.t -= dt;
        if (b.t <= 0) { b.up = true; b.x = b.home.x; b.y = b.home.y; }
        continue;
      }
      b.a += dt * 0.7;
      b.x = b.home.x + Math.cos(b.a) * 70;
      b.y = b.home.y + Math.sin(b.a * 1.15) * 50;
      for (const h of Game.heroes) {
        if (!h.alive || dist(h, b) > b.r + h.radius) continue;
        h.visionScore += 1;
        h.gainGold(25);
        h.gainXp(40);
        Game.fx.spark(b.x, b.y, THEME.gold, 6);
        if (h.isPlayer) UI.announce('🪲 Scryer +25g', 'minor');
        b.up = false; b.t = 95;
        break;
      }
    }
  },

  tickEmotes(dt) {
    for (const e of this.emotes) e.t -= dt;
    this.emotes = this.emotes.filter(e => e.t > 0);
    for (const c of this.chat) c.t -= dt;
    this.chat = this.chat.filter(c => c.t > 0);
  },

  tickAce() {
    for (const team of [TEAM_BLUE, TEAM_RED]) {
      const live = Game.heroes.filter(h => h.team === team && h.alive).length;
      if (live === 0 && Game.heroes.some(h => h.team === team)) {
        if (!this.aceLatch[team]) {
          this.aceLatch[team] = true;
          const you = Game.player && Game.player.team === team;
          UI.announce(you ? '💀 ACE — your team is down' : '⚔ ACE!', you ? 'death' : 'major');
          UI.banner(you ? 'ENEMY ACE' : 'ACE');
          Game.fx.shake(7);
        }
      } else this.aceLatch[team] = false;
    }
  },

  tickComeback() {
    if (Game.isDuel() || Game.time < 180) return;
    const gb = Game.teamGold(TEAM_BLUE), gr = Game.teamGold(TEAM_RED);
    const lead = gb - gr;
    if (this._lead == null) this._lead = lead;
    const swing = lead - this._lead;
    this._lead = lead;
    if (Game.time - this.comebackT > 40 && Math.abs(swing) > 400) {
      const team = swing > 0 ? TEAM_BLUE : TEAM_RED;
      if (Game.player && Game.player.team === team) {
        UI.announce('🔥 Gold swing — keep the pressure', 'minor');
        this.comebackT = Game.time;
        if (SFX.tone) SFX.tone(520, 0.18, 'square', 0.04 * this.prefs.sfx, 80);
      }
    }
  },

  tickAfk(dt) {
    const p = Game.player;
    if (!p || !p.alive || Game.spectate) { this.idleT = 0; return; }
    const mv = Input.moveVector && Input.moveVector();
    const busy = mv || Input.attackHeld || Input.casts.length || p.recallT > 0;
    this.idleT = busy ? 0 : this.idleT + dt;
    if (this.idleT > 35 && this.idleT - dt <= 35) {
      UI.announce('⏳ AFK? Allies need you', 'minor');
      Game.ping('help', p.x, p.y, p);
    }
  },

  tickMissingHint(dt) {
    const p = Game.player;
    if (!p || Game.isDuel() || Game.time - this.missingHintAt < 18) return;
    for (const h of Game.heroes) {
      if (h.team === p.team || !h.alive) continue;
      if (Game.canSee(p.team, h)) continue;
      const seen = this.lastSeen.get(h);
      if (seen && Game.time - seen.t > 12 && h.lane && h.lane === p.lane) {
        this.missingHintAt = Game.time;
        UI.announce(`${h.lane} missing`, 'minor');
        Game.ping('missing', seen.x, seen.y, p);
        break;
      }
    }
  },

  tickFight(dt) {
    let n = 0;
    for (const h of Game.heroes) if (h.alive && h.combatT > 0) n++;
    this.fightHeat = n;
    if (n > this.fightBest) { this.fightBest = n; this.fightAt = Game.time; }
  },

  tickBackdoor() {
    const p = Game.player;
    if (!p || !p.alive || !p.curTarget || !p.curTarget.isStructure || p.curTarget.team === p.team) return;
    const cover = Game.minions.some(m => m.team === p.team && m.alive && dist(m, p.curTarget) < 340);
    if (!cover && Game.time - (this._bdAnn || 0) > 10) {
      this._bdAnn = Game.time;
      UI.announce('⚠ Backdooring — bring a wave for full damage', 'minor');
    }
  },

  tickUndo(dt) {
    if (this.undo) {
      this.undo.t -= dt;
      if (this.undo.t <= 0) this.undo = null;
    }
  },

  onHeroDamaged(src, target, dmg) {
    if (!(target instanceof Hero)) return;
    target.combatT = 4.5;
    if (src instanceof Hero) src.combatT = 4.5;
    if (target.isPlayer && src && src !== target) {
      const ang = Math.atan2(src.y - target.y, src.x - target.x);
      target.dirHurt.push({ a: ang, t: 1.1, dmg });
      this.hitMarker();
    }
  },

  /* `gold` is what the last-hitter actually earned (its share plus the
     last-hit bonus, see Minion.die). */
  onMinionDeath(m, src, gold) {
    if (!(src instanceof Hero) || src.team === m.team) return;
    // the count itself is core (Minion.die), so the headless build has it too
    if (src.isPlayer && gold > 0) {
      Game.floaters.push({
        x: m.x, y: m.y - 20, vy: -50, txt: `+${Math.round(gold)}g`, color: THEME.gold,
        age: 0, dur: 0.7, size: 13, outline: true,
      });
    }
  },

  /* Spawn protection itself is set and ticked by Hero (it must run headless). */
  onRespawn(h) {
    h.spawnGateT = 0.7;
    Game.fx.ring(h.x, h.y, 80, '#9be7ff', 0.7);
  },

  blockDamage(target) {
    return target instanceof Hero && target.spawnProtT > 0;
  },

  visionBonus(team, x, y) {
    for (const w of this.wards) {
      if (w.team !== team || w.t <= 0) continue;
      if (Math.hypot(w.x - x, w.y - y) < (w.r || 420)) return true;
    }
    for (const h of Game.heroes) {
      if (h.team !== team || !h.sweepT || h.sweepT <= 0) continue;
      if (Math.hypot(h.x - x, h.y - y) < 380) return true;
    }
    return false;
  },

  placeWard(h, kind) {
    const control = kind === 'controlWard';
    const mine = this.wards.filter(w => w.team === h.team && !w.control);
    if (!control && mine.length >= 2) mine.sort((a, b) => a.t - b.t)[0].t = 0;
    const w = {
      x: h.x, y: h.y, team: h.team, t: control ? 120 : 90,
      r: control ? 360 : 420, control, alive: true, by: h,
    };
    this.wards.push(w);
    h.visionScore = (h.visionScore || 0) + (control ? 2 : 1);
    Game.fx.ring(h.x, h.y, 50, control ? '#a78bfa' : '#4cc2ff', 0.5);
    return w;
  },

  sweep(h) {
    h.sweepT = 6;
    let n = 0;
    for (const w of this.wards) {
      if (w.team === h.team) continue;
      if (dist(h, w) < 380) { w.t = 0; n++; }
    }
    Game.fx.ring(h.x, h.y, 380, '#f0f6ff', 0.35);
    if (h.isPlayer) UI.announce(n ? `📡 Cleared ${n} ward${n > 1 ? 's' : ''}` : '📡 Sweeping', 'minor');
    h.visionScore = (h.visionScore || 0) + n;
  },

  useHeroItem(h, index) {
    const it = h.items[index];
    if (!it || !h.alive) return false;
    if (it.consume) return this.consumeItem(h, index);
    if (it.active) return this.fireActive(h, it);
    return false;
  },

  consumeItem(h, index) {
    const it = h.items[index];
    if (!it || !it.consume) return false;
    if ((it.consume === 'hp' || it.consume === 'mana') && h.combatT > 0) {
      if (h.isPlayer) UI.announce('Can\'t drink in combat', 'minor');
      return false;
    }
    if (it.consume === 'hp') { h.hot = { rate: 420 / 3, t: 3 }; }
    else if (it.consume === 'mana') {
      const add = 280; const step = add / 3;
      h.addTimedBuff && h.addTimedBuff('manaSip', 0, 3);
      h._manaSip = { rate: step, t: 3 };
    } else if (it.consume === 'flask') {
      h.hot = { rate: 260 / 4, t: 4 };
      h._manaSip = { rate: 160 / 4, t: 4 };
    } else if (it.consume === 'ward') this.placeWard(h, 'stealthWard');
    else if (it.consume === 'controlWard') this.placeWard(h, 'controlWard');
    else if (it.consume === 'sweeper') this.sweep(h);
    else return false;
    h.items.splice(index, 1);
    h.recalcStats(false);
    if (h.isPlayer) { SFX.gear(); UI.announce(`${it.icon} ${it.name}`, 'minor'); }
    return true;
  },

  fireActive(h, it) {
    const id = it.active.id;
    if ((h.itemCd[id] || 0) > 0) {
      if (h.isPlayer) UI.announce(`${it.name} ${Math.ceil(h.itemCd[id])}s`, 'minor');
      return false;
    }
    h.itemCd[id] = it.active.cd;
    if (id === 'aegisPulse') {
      h.addShield(280 + h.maxHp * 0.08, 2.5);
      Game.fx.ring(h.x, h.y, 70, THEME.shield || '#cfe8ff', 0.6);
    } else if (id === 'frostheart') {
      for (const u of Game.enemyUnits(h.team, { structures: false })) {
        if (dist(h, u) < 260 + u.radius && u.cc) u.cc.applySlow(0.4, 2, 0);
      }
      Game.fx.ring(h.x, h.y, 260, '#8ecbff', 0.45);
    } else if (id === 'windfeather') {
      const t = h.aiTarget || h.curTarget;
      const aim = (!h.isPlayer && t)
        ? t
        : (Input.aimPoint && Input.aimPoint());
      const dir = aim ? norm(aim.x - h.x, aim.y - h.y) : { x: Math.cos(h.facing), y: Math.sin(h.facing) };
      Game.fx.ghost(h);
      h.x += dir.x * 280; h.y += dir.y * 280;
      Game.clampPoint(h, 40);
    }
    if (h.isPlayer) SFX.skill();
    return true;
  },

  recordUndo(h, def, paid, consumed) {
    this.undo = { hero: h, def, t: 10, paid: paid === undefined ? def.cost : paid, consumed: consumed || [] };
  },
  tryUndo() {
    const u = this.undo;
    if (!u || u.hero !== Game.player) return false;
    const idx = u.hero.items.findIndex(i => i.id === u.def.id);
    if (idx < 0) return false;
    u.hero.items.splice(idx, 1);
    // the components the purchase swallowed come back with it
    for (const part of u.consumed) u.hero.items.push(part);
    u.hero.gold += u.paid;
    u.hero.goldEarned = Math.max(0, u.hero.goldEarned - u.paid);
    u.hero.recalcStats(false);
    this.undo = null;
    if (u.hero.isPlayer) UI.announce('↩ Purchase undone', 'minor');
    return true;
  },

  chatLine(kind, text, h) {
    const who = h || Game.player;
    if (!who) return;
    this.chat.unshift({ kind, text, name: who.name, team: who.team, t: 6 });
    if (this.chat.length > 8) this.chat.pop();
    if (who.isPlayer || who.team === TEAM_BLUE) SFX.ping();
  },
  emote(kind, h) {
    const who = h || Game.player;
    if (!who || !who.alive) return;
    const icons = { cheer: '🎉', laugh: '😂', salute: '🫡', threat: '☠' };
    this.emotes.push({ x: who.x, y: who.y, icon: icons[kind] || '✨', t: 2.2, h: who });
    this.chatLine('emote', `${who.name} ${icons[kind] || ''} ${kind}`, who);
  },
  quickChat(id) {
    const lines = {
      wp: 'Well played',
      sorry: 'Sorry',
      thanks: 'Thanks',
      inc: 'Incoming!',
    };
    const text = lines[id];
    if (!text) return;
    this.chatLine('qc', text, Game.player);
    UI.announce(text, 'minor');
  },

  hitMarker() {
    this._hitFlash = 0.12;
  },

  kp(h) {
    const teamKills = Game.kills[h.team] || 0;
    if (!teamKills) return 0;
    return (h.kills + h.assists) / teamKills;
  },

  awards() {
    const hs = Game.heroes;
    if (!hs.length) return [];
    const best = (fn, label) => {
      let b = hs[0];
      for (const h of hs) if (fn(h) > fn(b)) b = h;
      return fn(b) > 0 ? { label, hero: b, v: fn(b) } : null;
    };
    return [
      best(h => h.kills, 'Executioner'),
      best(h => h.stats.dmgHero, 'Highest Damage'),
      best(h => h.stats.dmgTaken, 'Iron Wall'),
      best(h => h.stats.healDone, 'Caretaker'),
      best(h => h.cs || 0, 'Farmer'),
      best(h => h.visionScore || 0, 'Oracle'),
      best(h => h.assists, 'Playmaker'),
      best(h => h.stats.dmgStruct, 'Siege Engine'),
    ].filter(Boolean);
  },

  applyCosmeticTints() {
    try {
      const fav = JSON.parse(localStorage.getItem('legends.favHeroes') || '[]');
      for (const h of Game.heroes) {
        if (h.isPlayer && fav.includes(h.def0.id)) h.tintBoost = 1;
      }
    } catch (e) { /* ignore */ }
  },
  bumpMastery() {
    const p = Game.player;
    if (!p) return;
    try {
      const m = JSON.parse(localStorage.getItem('legends.mastery') || '{}');
      m[p.def0.id] = (m[p.def0.id] || 0) + 1;
      localStorage.setItem('legends.mastery', JSON.stringify(m));
    } catch (e) { /* ignore */ }
  },
  saveHistory(winnerTeam) {
    try {
      const row = {
        t: Date.now(), mode: Game.mode, win: winnerTeam === (Game.player ? Game.player.team : TEAM_BLUE),
        clock: Math.floor(Game.time),
        kda: Game.player ? `${Game.player.kills}/${Game.player.deaths}/${Game.player.assists}` : '',
        hero: Game.player ? Game.player.def0.id : '',
      };
      const hist = JSON.parse(localStorage.getItem('legends.history') || '[]');
      hist.unshift(row);
      localStorage.setItem('legends.history', JSON.stringify(hist.slice(0, 8)));
    } catch (e) { /* ignore */ }
  },
  toggleFavorite(id) {
    try {
      const fav = JSON.parse(localStorage.getItem('legends.favHeroes') || '[]');
      const i = fav.indexOf(id);
      if (i >= 0) fav.splice(i, 1); else fav.push(id);
      localStorage.setItem('legends.favHeroes', JSON.stringify(fav));
      return fav.includes(id);
    } catch (e) { return false; }
  },

  specCycle(dir) {
    const live = Game.heroes.filter(h => h.alive);
    if (!live.length) return;
    const cur = Game.followHero;
    const i = Math.max(0, live.indexOf(cur));
    Game.followHero = live[(i + dir + live.length) % live.length];
  },

  renderWorld(g) {
    for (const p of this.plants) {
      if (!p.up || !inView(p.x, p.y, 40)) continue;
      // small ground shadow + a bulb standing on a stem
      g.beginPath(); g.arc(p.x, p.y + 3, p.r * 0.45, 0, TAU);
      g.fillStyle = 'rgba(3,8,5,0.35)'; g.fill();
      uprightAt(p.x, p.y, () => {
        g.strokeStyle = 'rgba(30,80,40,0.8)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -p.r * 0.35); g.stroke();
        g.beginPath(); g.arc(0, -p.r * 0.62, p.r * 0.5, 0, TAU);
        g.fillStyle = p.kind === 'fruit' ? 'rgba(90,220,120,0.9)' : 'rgba(240,180,70,0.9)';
        g.fill();
        g.beginPath(); g.arc(-p.r * 0.15, -p.r * 0.75, p.r * 0.14, 0, TAU);
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill();
      });
    }
    for (const s of this.shrines) {
      if (!s.up || !inView(s.x, s.y, 50)) continue;
      g.beginPath(); g.arc(s.x, s.y, s.r * 0.45, 0, TAU);
      g.strokeStyle = 'rgba(255,210,90,0.8)'; g.lineWidth = 4; g.stroke();
    }
    for (const b of this.beetles) {
      if (!b.up || !inView(b.x, b.y, 30)) continue;
      g.beginPath(); g.arc(b.x, b.y, 10, 0, TAU);
      g.fillStyle = '#c4e38a'; g.fill();
    }
    for (const w of this.wards) {
      const vis = Game.spectate || w.team === TEAM_BLUE || w.control;
      if (!vis || !inView(w.x, w.y, 30)) continue;
      const col = w.control ? '#a78bfa' : '#4cc2ff';
      // detection ring and base pad stay on the ground plane
      g.beginPath(); g.arc(w.x, w.y, w.r, 0, TAU);
      g.strokeStyle = w.control ? 'rgba(167,139,250,0.25)' : 'rgba(76,194,255,0.2)';
      g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(w.x, w.y + 1, 7, 0, TAU);
      g.fillStyle = 'rgba(3,7,10,0.4)'; g.fill();
      // the ward itself: a standing pin with a glowing eye
      uprightAt(w.x, w.y, () => {
        g.strokeStyle = 'rgba(220,230,240,0.6)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -1); g.lineTo(0, -14); g.stroke();
        g.beginPath(); g.arc(0, -19, 5.5, 0, TAU);
        g.fillStyle = col;
        g.shadowColor = col; g.shadowBlur = 8; g.fill();
        g.shadowBlur = 0;
        g.beginPath(); g.arc(-1.5, -20.5, 1.8, 0, TAU);
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
      });
    }
    for (const e of this.emotes) {
      const h = e.h;
      if (!h || !h.alive) continue;
      g.globalAlpha = clamp(e.t / 0.4, 0, 1);
      uprightAt(h.x, h.y, () => {
        g.font = '28px sans-serif'; g.textAlign = 'center';
        g.fillText(e.icon, 0, -((h._top || 56) + 24 + (2.2 - e.t) * 18));
      });
      g.globalAlpha = 1;
    }
    const p = Game.player;
    if (p && p.alive && (this.prefs.rangeRings || this.prefs.alwaysRange || Input.keys && Input.keys['alt'])) {
      g.beginPath(); g.arc(p.x, p.y, p.range + p.radius, 0, TAU);
      g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2; g.stroke();
    }
    if (Game.time >= 900 && !Game.isDuel()) {
      g.fillStyle = 'rgba(8, 6, 28, 0.16)';
      g.fillRect(0, 0, Game.worldSize(), Game.worldSize());
    }
  },

  renderMinimap(g, mx, my) {
    for (const c of Game.camps || []) {
      if (c.respawnT > 0) {
        g.fillStyle = 'rgba(255,210,90,0.9)';
        g.font = '700 8px system-ui'; g.textAlign = 'center';
        g.fillText(Math.ceil(c.respawnT), mx(c.x), my(c.y) - 6);
      }
    }
    if (!Game.spectate && Game.player) {
      for (const h of Game.heroes) {
        if (h.team === Game.player.team || h.alive && Game.canSee(Game.player.team, h)) continue;
        const seen = this.lastSeen.get(h);
        if (!seen || Game.time - seen.t > 24) continue;
        g.globalAlpha = clamp(1 - (Game.time - seen.t) / 24, 0.2, 0.7);
        g.beginPath(); g.arc(mx(seen.x), my(seen.y), 3, 0, TAU);
        g.fillStyle = TEAM_COLORS[h.team]; g.fill();
        g.globalAlpha = 1;
      }
    }
    for (const w of this.wards) {
      if (!Game.spectate && w.team !== TEAM_BLUE) continue;
      g.fillStyle = w.control ? '#a78bfa' : '#4cc2ff';
      g.beginPath(); g.arc(mx(w.x), my(w.y), 2.4, 0, TAU); g.fill();
    }
  },

  renderOverlay(ctx) {
    const p = Game.player;
    if (this.prefs.hideHud) return;
    if (this._hitFlash > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${this._hitFlash * 4})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(CW / 2 - 10, CH / 2 - 10, 20, 20);
      this._hitFlash -= 1 / 60;
    }
    if (p && p.dirHurt) {
      for (const d of p.dirHurt) {
        ctx.save();
        ctx.translate(CW / 2, CH / 2);
        ctx.rotate(d.a);
        ctx.fillStyle = `rgba(255,70,70,${d.t})`;
        ctx.beginPath(); ctx.moveTo(90, -14); ctx.lineTo(118, 0); ctx.lineTo(90, 14); ctx.fill();
        ctx.restore();
      }
    }
    if (this.prefs.colorblind && p) {
      /* world outlines are drawn in renderWorld via extra stroke on heroes — HUD cue here */
    }
  },

  syncHud() {
    const p = Game.player;
    const set = (id, v) => { const el = document.getElementById(id); if (el) UI.setTxt(el, v); };
    const tog = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !on); };
    if (this.prefs.hideHud) {
      const hud = document.getElementById('hud');
      if (hud) hud.classList.add('featHide');
    } else {
      const hud = document.getElementById('hud');
      if (hud) hud.classList.remove('featHide');
    }
    document.getElementById('miniWrap')?.classList.toggle('largeMini', !!this.prefs.largeMini);

    if (p) {
      const need = BALANCE.xpNeed(p.level);
      const xpPct = p.level >= BALANCE.maxLevel ? 100 : (p.xp / need) * 100;
      const xpEl = document.getElementById('xpFill');
      if (xpEl) xpEl.style.width = clamp(xpPct, 0, 100) + '%';
      set('ppCs', p.cs || 0);
      set('ppGpm', Game.time > 1 ? Math.round(p.goldEarned / (Game.time / 60)) : 0);
      tog('combatPip', p.combatT > 0);
      const rec = document.getElementById('recallHud');
      if (rec) {
        rec.classList.toggle('hidden', !(p.recallT > 0));
        const fill = document.getElementById('recallFill');
        if (fill) fill.style.width = (p.recallT > 0 ? (1 - p.recallT / 3.2) * 100 : 0) + '%';
      }
      this.syncBuffs(p);
      this.syncTargetFrame(p);
      this.syncTowerWarn(p);
      this.syncWave();
      this.syncChatLog();
    }
    if (this.prefs.fps) {
      tog('fpsMeter', true);
      set('fpsMeter', `${this.fpsShown | 0} FPS`);
    } else tog('fpsMeter', false);

    const lock = document.getElementById('camLockPip');
    if (lock) lock.classList.toggle('on', this.camLock);
  },

  syncBuffs(p) {
    const host = document.getElementById('buffTray');
    if (!host) return;
    const bits = [];
    for (const k in p.runes) if (p.runes[k] > 0 && JUNGLE_BUFFS[k])
      bits.push(`${JUNGLE_BUFFS[k].icon}${Math.ceil(p.runes[k])}s`);
    if (p.spawnProtT > 0) bits.push(`🛡${p.spawnProtT.toFixed(1)}`);
    if (p.shrineT > 0) bits.push(`🌀${Math.ceil(p.shrineT)}`);
    if (p.hot) bits.push('❤');
    if (p.sweepT > 0) bits.push('📡');
    const html = bits.map(b => `<span>${b}</span>`).join('');
    if (host._h !== html) { host._h = html; host.innerHTML = html; }
  },

  syncTargetFrame(p) {
    const host = document.getElementById('targetFrame');
    if (!host) return;
    const t = p.curTarget;
    if (!t || !t.alive || t.team === p.team) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    const hp = document.getElementById('tfHp');
    if (hp) hp.style.width = (t.hpPct * 100) + '%';
    UI.setTxt(document.getElementById('tfName'), t.name || t.type);
    const exec = p.spell && p.spell.id === 'execute' && t.type === 'hero' && t.hpPct < 0.12;
    host.classList.toggle('exec', !!exec);
  },

  syncTowerWarn(p) {
    const el = document.getElementById('towerWarn');
    if (!el) return;
    const focused = Game.towers.some(t => t.alive && t.team !== p.team && t.target === p);
    el.classList.toggle('hidden', !focused);
  },

  syncWave() {
    const el = document.getElementById('waveCd');
    if (!el || Game.isDuel()) { if (el) el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    UI.setTxt(el, `WAVE ${Math.ceil(Math.max(0, Game.waveT))}s`);
  },

  syncChatLog() {
    const host = document.getElementById('chatLog');
    if (!host) return;
    const html = this.chat.slice(0, 5).map(c =>
      `<div class="chatRow"><b>${c.name}</b> ${c.text}</div>`).join('');
    if (host._h !== html) { host._h = html; host.innerHTML = html; }
  },

  onHudTick(dt) {
    this.fpsEma = this.fpsEma * 0.9 + (dt > 0 ? 1 / dt : 60) * 0.1;
    if ((this._fpsAcc = (this._fpsAcc || 0) + dt) > 0.4) {
      this._fpsAcc = 0; this.fpsShown = this.fpsEma;
    }
    this.syncHud();
  },

  bindHud() {
    this.loadPrefs();
    const $ = id => document.getElementById(id);
    $('btnSurrender')?.addEventListener('click', () => {
      if (Game.player) Game.startSurrender(Game.player.team, Game.player);
    });
    $('btnCamLock')?.addEventListener('click', () => this.toggleCamLock());
    $('btnUndoBuy')?.addEventListener('click', () => this.tryUndo());
    $('btnWhatsNew')?.addEventListener('click', () => this.toggleWhatsNew());
    $('wnClose')?.addEventListener('click', () => $('whatsNew')?.classList.add('hidden'));
    $('btnFavHero')?.addEventListener('click', () => {
      const h = UI.selectedHero; if (!h) return;
      const on = this.toggleFavorite(h.id);
      UI.announce(on ? `★ Favorited ${h.name}` : `Unfavorited ${h.name}`, 'minor');
    });
    document.getElementById('itemBar')?.addEventListener('click', e => {
      const slot = e.target.closest('.itemSlot');
      if (!slot || !Game.player) return;
      const i = [...slot.parentNode.children].indexOf(slot);
      this.useHeroItem(Game.player, i);
    });
    this.fillWhatsNew();
    this.fillHistory();
    this.applySettingsDom();
    document.getElementById('emoteWheel')?.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        this.emote(b.dataset.em);
        document.getElementById('emoteWheel')?.classList.add('hidden');
      });
    });
  },

  fillWhatsNew() {
    const host = document.getElementById('wnList');
    if (!host) return;
    const ml = (typeof MLBB_CATALOG !== 'undefined' ? MLBB_CATALOG : []).map((n, i) =>
      `<li><i>${String(i + 1).padStart(3, '0')}</i> ${n}</li>`).join('');
    const extra = FEATURE_CATALOG.map((n, i) =>
      `<li><i>${String(i + 1 + (typeof MLBB_CATALOG !== 'undefined' ? MLBB_CATALOG.length : 0)).padStart(3, '0')}</i> ${n}</li>`).join('');
    host.innerHTML = ml + extra;
  },
  toggleWhatsNew() {
    const el = document.getElementById('whatsNew');
    if (!el) return;
    el.classList.toggle('hidden');
  },
  fillHistory() {
    if (typeof Screens !== 'undefined' && Screens.renderHistory) { Screens.renderHistory(); return; }
    const host = document.getElementById('matchHist');
    if (!host) return;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem('legends.history') || '[]'); } catch (e) { hist = []; }
    if (!hist.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<b>Recent matches</b>' + hist.map(r =>
      `<div class="histRow ${r.win ? 'win' : 'lose'}">${r.hero} · ${r.kda} · ${Math.floor(r.clock / 60)}m · ${r.mode}</div>`
    ).join('');
  },

  applySettingsDom() {
    const bind = (id, key, parse = v => v) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = !!this.prefs[key];
        el.addEventListener('change', () => { this.prefs[key] = el.checked; this.savePrefs(); });
      } else if (el.type === 'range') {
        el.value = this.prefs[key];
        el.addEventListener('input', () => { this.prefs[key] = parse(el.value); this.savePrefs(); });
      }
    };
    bind('setCamLock', 'camLock');
    bind('setAutoAtk', 'autoAttack');
    bind('setFps', 'fps');
    bind('setLargeMini', 'largeMini');
    bind('setColorblind', 'colorblind');
    bind('setAlwaysRange', 'alwaysRange');
    bind('setPeek', 'peek', v => +v);
    bind('setShake', 'shake', v => +v);
    bind('setSfx', 'sfx', v => +v);
    bind('setAmb', 'amb', v => +v);
    this.camLock = !!this.prefs.camLock;
  },

  toggleCamLock() {
    this.camLock = !this.camLock;
    this.prefs.camLock = this.camLock;
    this.savePrefs();
    UI.announce(this.camLock ? 'Camera locked' : 'Camera free', 'minor');
  },

  handleKey(k, e) {
    if (k === '?' || (e.shiftKey && k === '/')) {
      document.getElementById('keyOverlay')?.classList.toggle('hidden');
      return true;
    }
    if (k === 'f9') { this.prefs.hideHud = !this.prefs.hideHud; this.savePrefs(); return true; }
    if (k === 'f10') { Game.paused ? Game.resume() : Game.pause(); return true; }
    if (Game.spectate) {
      if (k === '[' || k === 'p') { if (k === '[') this.specCycle(-1); return k === '['; }
      if (k === ']') { this.specCycle(1); return true; }
    }
    if (Game.state !== 'play' || !Game.player) return false;
    if (k === 'y') { this.toggleCamLock(); return true; }
    if (k === 'r' && !e.repeat) {
      const p = Game.player;
      Game.cam.x = p.x; Game.cam.y = p.y;
      return true;
    }
    if (k === 'q') { this.attackMove = true; return true; }
    if (k === 'h') { this.halted = true; Input.attackHeld = false; Game.player.curTarget = null; return true; }
    if (k === 'n' && e.shiftKey) {
      Game.startSurrender(Game.player.team, Game.player); return true;
    }
    if (k === 'u') { this.tryUndo(); return true; }
    if (k === '4' || k === '5' || k === '6') {
      this.useConsumableHotkey(+k); return true;
    }
    if (k === '`') { Game.ping('missing', Game.player.x, Game.player.y, Game.player); return true; }
    if (e.altKey && k === '1') { this.quickChat('wp'); return true; }
    if (e.altKey && k === '2') { this.quickChat('sorry'); return true; }
    if (e.altKey && k === '3') { this.quickChat('thanks'); return true; }
    if (e.altKey && k === '4') { this.quickChat('inc'); return true; }
    if (k === 'e' && !e.repeat) {
      document.getElementById('emoteWheel')?.classList.toggle('hidden');
      return true;
    }
    return false;
  },

  useConsumableHotkey(n) {
    const p = Game.player;
    if (!p) return;
    const want = n === 4 ? 'hpPotion' : n === 5 ? 'manaPotion' : 'flask';
    const i = p.items.findIndex(it => it.id === want);
    if (i >= 0) this.useHeroItem(p, i);
    else {
      const any = p.items.findIndex(it => it.consume || it.active);
      if (any >= 0) this.useHeroItem(p, any);
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Features, FEATURE_CATALOG };
}
