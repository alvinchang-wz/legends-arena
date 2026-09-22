'use strict';
/* ============================================================
   ui.js — sound, HUD, minimap, hero select, announcements,
   kill feed, end screen
   ============================================================ */

/* ---------------- tiny synthesized SFX ---------------- */
const SFX = {
  ctx: null, on: true, lastHit: 0,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  toggle() {
    this.on = !this.on;
    const b = document.getElementById('btnMute');
    if (b) b.innerHTML = UI.icon(this.on ? 'misc:sound' : 'misc:muted', 20, this.on ? '🔊' : '🔇');
    if (!this.on) this.stopAmbience();
    else if (typeof Game !== 'undefined' && Game.state === 'play') this.startAmbience();
  },
  tone(freq, dur, type = 'sine', vol = 0.06, slide = 0) {
    if (Game.attract) return;
    if (typeof Features !== 'undefined') vol *= Features.prefs.sfx;
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  noise(dur, vol = 0.05, hp = 1600) {
    if (Game.attract) return;
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  },
  hit() { const n = performance.now(); if (n - this.lastHit < 70) return; this.lastHit = n; this.noise(0.05, 0.05, 1500); this.tone(200, 0.07, 'square', 0.032, -90); },
  shoot() { this.tone(820, 0.055, 'triangle', 0.034, -300); this.tone(1280, 0.04, 'sine', 0.018, -420); },
  skill() { this.noise(0.07, 0.028, 900); this.tone(400, 0.12, 'sawtooth', 0.042, 70); this.tone(640, 0.16, 'triangle', 0.036, -260); },
  ult() {
    this.noise(0.2, 0.07, 480);
    this.tone(130, 0.3, 'sawtooth', 0.08, 80);
    this.tone(260, 0.22, 'square', 0.048, 140);
    setTimeout(() => { this.tone(880, 0.14, 'triangle', 0.05, -300); this.tone(1320, 0.1, 'sine', 0.028, -420); }, 80);
  },
  zone() { this.noise(0.12, 0.055, 600); this.tone(150, 0.22, 'sawtooth', 0.055, -70); },
  kill() {
    this.noise(0.1, 0.05, 1100);
    this.tone(980, 0.09, 'square', 0.065, -240);
    this.tone(740, 0.14, 'triangle', 0.048);
    setTimeout(() => this.tone(520, 0.24, 'square', 0.04, -220), 70);
  },
  death() { this.noise(0.22, 0.06, 400); this.tone(200, 0.45, 'sawtooth', 0.07, -150); this.tone(98, 0.4, 'sine', 0.045, -30); },
  levelup() { this.tone(523, 0.09, 'triangle', 0.055); setTimeout(() => this.tone(784, 0.14, 'triangle', 0.055), 90); },
  gear() { this.tone(700, 0.08, 'triangle', 0.048, 140); this.tone(1040, 0.06, 'sine', 0.025); },
  tower() { this.noise(0.18, 0.06, 350); this.tone(90, 0.5, 'sawtooth', 0.08, -35); },
  ping() { this.tone(1180, 0.07, 'sine', 0.048); setTimeout(() => this.tone(1560, 0.09, 'sine', 0.038), 70); },
  victory() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 'triangle', 0.075), i * 160)); },
  defeat() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.32, 'sawtooth', 0.055), i * 200)); },
  /* Soft thud when the player is critically low — cadence is driven by
     Game.updateEffects so it speeds up as health drops. */
  heartbeat() {
    this.tone(70, 0.08, 'sine', 0.05);
    setTimeout(() => this.tone(55, 0.12, 'sine', 0.035), 90);
  },

  /* ---- ambient bed ----
     A quiet looping pad that sits under the match. Intensity is driven by
     Game.combatHeat (0 = idle lane, 1 = teamfight) so fights feel louder
     without a discrete "combat music" track. */
  amb: null,
  startAmbience() {
    this.ensure();
    if (!this.on || !this.ctx || this.amb) return;
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // two detuned saws through a slow LFO for a soft pad
    const makePad = (freq, type, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g); g.connect(master);
      o.start();
      return { o, g };
    };
    const a = makePad(55, 'sine', 0.55);
    const b = makePad(82.5, 'triangle', 0.28);
    const c = makePad(110.5, 'sine', 0.18);

    // high shimmer that brightens with combat heat
    const shim = ctx.createOscillator();
    const shimG = ctx.createGain();
    shim.type = 'sine'; shim.frequency.value = 440;
    shimG.gain.value = 0.0;
    shim.connect(shimG); shimG.connect(master);
    shim.start();

    this.amb = { master, pads: [a, b, c], shim, shimG, started: performance.now() };
  },
  stopAmbience() {
    if (!this.amb) return;
    try {
      this.amb.master.disconnect();
      for (const p of this.amb.pads) p.o.stop();
      this.amb.shim.stop();
    } catch (e) { /* already stopped */ }
    this.amb = null;
  },
  /* Call once per frame from the HUD sync. Heat ∈ [0,1]. */
  syncAmbience(heat) {
    if (!this.on) { if (this.amb) this.stopAmbience(); return; }
    if (!this.amb) this.startAmbience();
    if (!this.amb || !this.ctx) return;
    const t = this.ctx.currentTime;
    // idle bed sits quietly; fights push the pad up and open the shimmer
    const target = (0.012 + heat * 0.05) * (typeof Features !== 'undefined' ? Features.prefs.amb : 1);
    this.amb.master.gain.setTargetAtTime(target, t, 0.4);
    this.amb.shimG.gain.setTargetAtTime(heat * 0.025, t, 0.3);
    // gentle pitch drift so the pad never feels static
    const wobble = 1 + Math.sin(performance.now() * 0.0004) * 0.01;
    this.amb.pads[0].o.frequency.setTargetAtTime(55 * wobble, t, 0.5);
    this.amb.pads[1].o.frequency.setTargetAtTime(82.5 * (2 - wobble), t, 0.5);
  },
};

/* ---------------- UI ---------------- */
const UI = {
  /* Spectator fast-forward ladder. Steps stay fine-grained where you actually
     watch and coarsen towards the top, so the button still wraps in 8 clicks. */
  SIM_SPEEDS: [1, 2, 3, 4, 6, 8, 12, 16],

  els: {}, selectedHero: null,
  announceQueue: [], announceT: 0,
  feedItems: [],
  miniStatic: null,

  /* ---------------- vector icon helpers ----------------
     Everything renders through Icons (js/icons.js); emoji text is the
     fallback for anything without a hand-drawn glyph yet (e.g. items). */
  ICON_ALIAS: { '🐢': 'epic:turtle', '👑': 'epic:lord', '🔷': 'buff:blueBuff', '🔶': 'buff:redBuff', '🌊': 'buff:litho' },

  icon(key, px, fallback, cls = '') {
    if (typeof Icons !== 'undefined' && key && Icons.has(key)) return Icons.img(key, px, cls);
    return `<span class="emIcon" style="font-size:${Math.round(px * 0.8)}px">${fallback ?? ''}</span>`;
  },

  heroIcon(h, px, cls = '') {
    const def = h.def0 || h;
    return this.icon('hero:' + def.id, px, def.icon, cls);
  },

  itemIcon(def, px, cls = '') {
    return this.icon('item:' + def.id, px, def.icon, cls);
  },

  setTxt(el, v) {
    if (!el) return;
    const s = String(v);
    if (el.textContent !== s) el.textContent = s;
  },

  showPause(on) {
    const el = this.els.pauseOverlay;
    if (!el) return;
    el.classList.toggle('hidden', !on);
  },

  init() {
    const ids = ['hud', 'pick', 'end', 'heroGrid', 'heroInfo', 'btnStart', 'btnAgain', 'scoreBlue', 'scoreRed',
      'clock', 'killfeed', 'announce', 'minimap', 'ppIcon', 'ppHp', 'ppMp', 'ppHpT', 'ppLevel', 'ppKda', 'ppGold',
      'ppGear', 'deathOverlay', 'deathTimer', 'deathBy', 'deathRecap', 'endTitle', 'endStats', 'btnMute', 'rotate',
      'specBar', 'specFollow', 'btnSpeed', 'btnLeave', 'btnAuto',
      'matchup', 'muStatus', 'specTypes', 'skillTip',
      'draftBlue', 'draftRed', 'draftHint', 'btnDraftRandom', 'btnDraftClear',
      'ppArmor', 'ppMr', 'skillPts', 'ppShield', 'teamStrip', 'banner', 'scoreboard',
      'goldBlue', 'goldRed', 'goldDiffFill', 'objTimers', 'skillPtsBadge',
      'itemBar', 'btnShop', 'shop', 'spellPick', 'emblemPick', 'loDesc',
      'pingWheel', 'btnPing', 'pingFeed', 'surrenderBox',
      'btnSettings', 'settingsPanel', 'btnSettingsClose', 'setReleaseAim', 'setTargetPriority', 'btnExitDuel',
      'targetLock', 'terrainBuff', 'laneBuff', 'quickBuy', 'pauseOverlay'];
    for (const id of ids) this.els[id] = document.getElementById(id);
    // vector glyphs for the fixed HUD chrome (emoji fallback if missing)
    const btnAtk = document.getElementById('btnAtk');
    if (btnAtk) btnAtk.innerHTML = this.icon('misc:attack', 44, '⚔');
    const btnRecall = document.getElementById('btnRecall');
    if (btnRecall) btnRecall.innerHTML = this.icon('misc:recall', 28, '🏠');
    if (this.els.btnPing) this.els.btnPing.innerHTML = this.icon('misc:ping', 26, '📣');
    if (this.els.btnShop) this.els.btnShop.innerHTML = `${this.icon('misc:shop', 18, '🛒')}<span>SHOP</span>`;
    if (this.els.btnMute) this.els.btnMute.innerHTML = this.icon('misc:sound', 20, '🔊');
    const btnScore = document.getElementById('btnScore');
    if (btnScore) btnScore.innerHTML = this.icon('misc:score', 20, '📊');
    if (this.els.btnSettings) this.els.btnSettings.innerHTML = this.icon('misc:gear', 20, '⚙');
    this.buildHeroSelect();
    this.buildRoleFilter();
    this.buildDraft();
    this.buildScoreboardToggle();
    this.buildLoadoutPickers();
    this.buildShop();
    this.buildPingWheel();
    this.initTooltips();
    if (typeof Mlbb !== 'undefined') Mlbb.bindSelect();
    Input.loadSettings();
    if (typeof Features !== 'undefined') Features.bindHud();
    if (this.els.setReleaseAim) {
      this.els.setReleaseAim.checked = Input.releaseAim;
      this.els.setReleaseAim.addEventListener('change', e => Input.setReleaseAim(e.target.checked));
    }
    if (this.els.setTargetPriority) {
      this.els.setTargetPriority.value = Input.targetPriority;
      this.els.setTargetPriority.addEventListener('change', e => Input.setTargetPriority(e.target.value));
    }
    if (this.els.quickBuy) this.els.quickBuy.addEventListener('click', () => this.buyRecommended());
    if (this.els.btnSettings) this.els.btnSettings.addEventListener('click', () => this.toggleSettings());
    if (this.els.btnSettingsClose) this.els.btnSettingsClose.addEventListener('click', () => this.toggleSettings(false));
    if (this.els.btnExitDuel) this.els.btnExitDuel.addEventListener('click', () => this.returnToSelect());
    if (this.els.pauseOverlay) {
      this.els.pauseOverlay.addEventListener('click', () => Game.resume());
      this.els.pauseOverlay.addEventListener('pointerdown', () => Game.resume());
    }
    this.els.btnMute.addEventListener('click', () => SFX.toggle());
    this.botTypes = ['heuristic', 'heuristic'];
    this.els.matchup.querySelectorAll('.muBtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const team = +btn.dataset.team, type = btn.dataset.type;
        this.els.matchup.querySelectorAll(`.muBtn[data-team="${team}"]`)
          .forEach(b => b.classList.toggle('sel', b === btn));
        this.botTypes[team] = type;
        if (type === 'neural' && !NeuralRuntime.ready) await this.ensureModel();
        this.updateMatchupStatus();
      });
    });
    this.updateMatchupStatus();

    this.els.btnSpeed.addEventListener('click', () => {
      const i = this.SIM_SPEEDS.indexOf(Game.simSpeed);
      Game.simSpeed = this.SIM_SPEEDS[(i + 1) % this.SIM_SPEEDS.length];
      this.els.btnSpeed.textContent = Game.simSpeed + '×';
    });
    this.els.btnLeave.addEventListener('click', () => this.returnToSelect());
    this.els.btnAuto.addEventListener('click', () => {
      Game.autoTrain = !Game.autoTrain;
      this.els.btnAuto.textContent = 'AUTO: ' + (Game.autoTrain ? 'ON' : 'OFF');
      this.els.btnAuto.classList.toggle('on', Game.autoTrain);
      if (Game.autoTrain && Game.spectate && Game.state === 'end') {
        this.els.end.classList.add('hidden');
        Game.start(null);
      }
    });
    this.buildMinimapStatic();
    this.bindMinimap();
    window.addEventListener('resize', () => this.checkOrientation());
    this.checkOrientation();
    if (typeof Screens !== 'undefined') Screens.init();
  },

  /* Start a match from the pick screen. `mode` is 'standard' | 'ten' | 'duel';
     `spectate` runs it bot-vs-bot with the spectator bar. Screens has already
     hidden the menus and stopped the attract match. */
  async launch(mode, spectate) {
    if (!spectate && !this.selectedHero) return;
    SFX.ensure();
    this.setDraftSize(mode === 'ten' ? 10 : 5);
    Game.mode = mode;
    Game.draft = this.draft;
    this.els.hud.classList.remove('hidden', 'duel', 'ten', 'spectating');
    if (mode === 'ten') this.els.hud.classList.add('ten');
    if (mode === 'duel') this.els.hud.classList.add('duel');
    if (!spectate) { Game.start(this.selectedHero); return; }
    if (this.botTypes.includes('neural') && !NeuralRuntime.ready) await this.ensureModel();
    Game.botTypes = this.botTypes.slice();
    this.els.hud.classList.add('spectating');
    this.els.specBar.classList.remove('hidden');
    Game.start(null);
    SFX.startAmbience();
    this.els.specTypes.innerHTML =
      `<b style="color:${TEAM_COLORS[0]}">${this.label(0)}</b> vs ` +
      `<b style="color:${TEAM_COLORS[1]}">${this.label(1)}</b>` +
      (mode === 'ten' ? ' · Caldera' : '');
  },

  /* Keep draft/loadout selections instead of a hard reload. */
  returnToSelect() {
    SFX.stopAmbience();
    this.els.end.classList.add('hidden');
    this.els.hud.classList.add('hidden');
    this.els.hud.classList.remove('spectating', 'duel', 'ten');
    this.els.specBar.classList.add('hidden');
    this.toggleShop(false);
    this.toggleSettings(false);
    this.toggleScoreboard(false);
    this.closePingWheel && this.closePingWheel();
    Game.state = 'select';
    Game.spectate = false;
    Game.paused = false;
    this.showPause(false);
    Game.player = null;
    Game.followHero = null;
    Game.attract = false;
    if (typeof Screens !== 'undefined') Screens.show('lobby');
  },

  /* neural bots need the trained weights; load once, on demand */
  async ensureModel() {
    this.els.muStatus.textContent = 'loading model…';
    this.els.muStatus.style.color = '#9fb3c8';
    await NeuralRuntime.load('models/neural-bot-v1/model.json');
    this.updateMatchupStatus();
  },

  label(team) {
    const t = this.botTypes[team];
    return t === 'neural' && !NeuralRuntime.ready ? 'neural→heuristic' : t;
  },

  updateMatchupStatus() {
    const el = this.els.muStatus;
    if (!this.botTypes.includes('neural')) {
      el.textContent = 'hand-coded bots on both sides';
      el.style.color = '#7d93aa';
    } else if (NeuralRuntime.ready) {
      el.textContent = '✓ neural model loaded';
      el.style.color = '#6ee7a0';
    } else {
      el.textContent = `⚠ no model (${NeuralRuntime.loadError || 'not found'}) — falls back to heuristic`;
      el.style.color = '#ffb3b3';
    }
  },

  checkOrientation() {
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    const bad = isTouch && window.innerHeight > window.innerWidth && window.innerWidth < 700;
    this.els.rotate.classList.toggle('hidden', !bad);
  },

  toggleSettings(force) {
    const panel = this.els.settingsPanel;
    if (!panel) return;
    const show = force === undefined ? panel.classList.contains('hidden') : force;
    panel.classList.toggle('hidden', !show);
    if (show && this.els.setReleaseAim) this.els.setReleaseAim.checked = Input.releaseAim;
  },

  /* ---------------- hero & skill copy ----------------
     One source of formatting for both the select screen (scaling text, no hero
     instance yet) and the in-game tooltips (live values for the played hero). */
  SKILL_TYPE: {
    skillshot: 'Line skillshot',
    nova: 'Burst around you',
    dash: 'Dash',
    zone: 'Ground zone',
    heal: 'Heal',
    blinkstrike: 'Blink strike',
    buff: 'Self buff',
  },

  /* "Magic Damage" / "Physical Damage" / "True Damage" — naming the type in
     the label is what tells a player which resistance would blunt it. */
  dmgLabel(s) {
    const t = s.dmgType || 'physical';
    return t[0].toUpperCase() + t.slice(1) + ' dmg';
  },
  /* Scaling text for the select screen, where there is no hero instance yet. */
  scalingText(s) {
    const parts = [`${s.dmg}`, `+${s.dmgLv || 0}/lv`];
    if (s.scaleAd) parts.push(`+${Math.round(s.scaleAd * 100)}% ATK`);
    if (s.scaleAp) parts.push(`+${Math.round(s.scaleAp * 100)}% MAGIC`);
    return parts.join(' ');
  },

  /* [label, value] rows. Pass a live hero for current-level numbers. */
  skillStats(s, hero) {
    const rows = [['Cooldown', s.cd + 's'], ['Mana', s.mana]];
    const reach = s.type === 'dash' ? s.dist : s.range;
    if (reach) rows.push([s.type === 'dash' ? 'Dash distance' : 'Cast range', reach]);
    const rad = (s.type === 'nova' || s.type === 'zone' || s.type === 'heal') ? s.radius
      : s.explodeR ? s.explodeR
        : s.endNova ? s.endNova.radius : 0;
    if (rad) rows.push([s.explodeR ? 'Blast radius' : 'Radius', rad]);
    if (s.type === 'heal') {
      rows.push(['Heal', hero ? Math.round(hero.skillHeal(s))
        : `${s.heal} +${s.healLv}/lv${s.scaleAp ? ` +${Math.round(s.scaleAp * 100)}% MAGIC` : ''}`]);
    } else if (s.dmg) {
      rows.push([this.dmgLabel(s), hero ? Math.round(hero.skillDmg(s)) : this.scalingText(s)]);
    } else if (s.endNova) {
      rows.push([this.dmgLabel(s.endNova), hero ? Math.round(hero.skillDmg(s.endNova, hero.skillRankOf(s)))
        : this.scalingText(s.endNova)]);
    }
    if (s.dur) rows.push(['Duration', s.dur + 's']);
    if (s.ticks > 1) rows.push(['Hits', `${s.ticks} × ${s.interval}s`]);
    return rows;
  },

  /* short effect chips: crowd control, buffs, quirks */
  skillTags(s) {
    const t = [];
    for (const k of CC_PRIORITY) {
      if (k === 'slow' || !s[k]) continue;
      t.push(`${CC_TYPES[k].icon} ${CC_TYPES[k].label} ${s[k]}s`);
    }
    if (s.knockback) t.push(`↞ Knocks back ${s.knockback}`);
    if (s.physPenPct) t.push(`Ignores ${Math.round(s.physPenPct * 100)}% Armor`);
    if (s.shieldPct) t.push(`Shield ${Math.round(s.shieldPct * 100)}% max HP`);
    if (s.tenacityAdd) t.push(`+${Math.round(s.tenacityAdd * 100)}% Tenacity`);
    if (s.slowPct) t.push(`${CC_TYPES.slow.icon} Slow ${Math.round(s.slowPct * 100)}% / ${s.slowDur || 1.5}s`);
    if (s.pierce) t.push('Pierces all');
    if (s.hook) t.push('Drags target to you');
    if (s.explodeR) t.push('Explodes on hit');
    if (s.stopOnHero) t.push('Stops on first hero');
    if (s.endNova) t.push('Slams on landing');
    if (s.buff && s.buff.asMult) t.push(`+${Math.round((s.buff.asMult - 1) * 100)}% attack speed`);
    if (s.atkMult) t.push(`+${Math.round((s.atkMult - 1) * 100)}% attack`);
    if (s.spdAdd) t.push(`+${s.spdAdd} move speed`);
    if (s.hotPct) t.push(`Regen ${Math.round(s.hotPct * 100)}% HP`);
    if (s.type === 'heal') t.push('Also heals allies');
    if (s.delay) t.push(`${s.delay}s wind-up`);
    return t;
  },

  /* hero stat bars, scaled against the rest of the roster */
  heroStatBars(h) {
    const rows = [
      ['Health', d => d.hp, h.hp],
      ['Attack', d => d.atk, h.atk],
      ['Armor', d => d.armor, h.armor],
      ['Magic RES', d => d.mr, h.mr],
      ['Atk range', d => d.range, h.range],
      ['Atk speed', d => d.atkSpd, h.atkSpd.toFixed(2)],
      ['Move speed', d => d.speed, h.speed],
      ['Mana', d => d.mp, h.mp],
    ];
    return `<div class="statBars">${rows.map(([label, get, shown]) => {
      const vals = HEROES.map(get);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const pct = hi === lo ? 100 : 12 + 88 * (get(h) - lo) / (hi - lo);
      return `<div class="sbRow"><span>${label}</span>
        <span class="sbTrack"><span class="sbFill" style="width:${pct}%;background:linear-gradient(90deg,${h.color}99,${h.color})"></span></span>
        <span class="sbVal">${shown}</span></div>`;
    }).join('')}</div>`;
  },

  heroInfoHTML(h) {
    return `
      <div class="infoHead" style="--hc:${h.color}"><span class="infoIcon">${this.heroIcon(h, 52)}</span>
        <div><div class="infoName" style="color:${h.color}">${h.name}</div>
        <div class="infoRole">${h.role} · ${h.range > 150 ? 'Ranged' : 'Melee'} ·
          <span style="color:${DMG_COLORS[h.damageStyle]}">${h.damageStyle} damage</span> ·
          ${'★'.repeat(h.difficulty)}${'☆'.repeat(3 - h.difficulty)}</div></div></div>
      <p class="infoDesc">${h.desc}</p>
      ${this.heroStatBars(h)}
      ${h.passive ? `<div class="infoSkill passiveRow">
          <span class="siIcon">${this.icon('passive:' + h.id, 34, h.passive.icon)}</span>
          <div class="siBody"><b>${h.passive.name}</b>
            <span class="siKey">PASSIVE</span>
            <div class="siType">Always active</div>
            <small>${h.passive.desc}</small></div>
        </div>` : ''}
      <div class="infoSkills">${h.skills.map((s, i) => `
        <div class="infoSkill">
          <span class="siIcon">${this.icon(`skill:${h.id}:${i}`, 34, s.icon)}</span>
          <div class="siBody">
            <b>${s.name}</b>${i === 2 ? ' <span class="ultTag">ULT</span>' : ''}
            <span class="siKey">${i + 1}</span>
            <div class="siType">${this.SKILL_TYPE[s.type] || s.type}</div>
            <small>${s.desc}</small>
            <div class="infoMeta">${this.skillStats(s).map(([k, v]) => `<span class="metaChip">${k} <b>${v}</b></span>`).join('')}</div>
            ${this.skillTags(s).length ? `<div class="tagList">${this.skillTags(s).map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
          </div>
        </div>`).join('')}
      </div>
      ${this.recommendedPathHTML(h)}`;
  },

  recommendedPathHTML(h) {
    if (typeof Mlbb === 'undefined') return '';
    const path = Mlbb.recommendPath(h);
    if (!path.length) return '';
    return `<div class="recPath"><span class="loLabel">Recommended</span>${path.map(it =>
      `<span title="${it.name}">${this.itemIcon(it, 22)}</span>`).join('<i>›</i>')}</div>`;
  },

  buildRoleFilter() {
    const host = document.getElementById('roleFilter');
    if (!host) return;
    const roles = ['All', ...new Set(HEROES.map(h => h.role))];
    this.roleFilter = 'All';
    for (const r of roles) {
      const b = document.createElement('button');
      b.className = 'roleChip' + (r === 'All' ? ' sel' : '');
      b.textContent = r;
      b.addEventListener('click', () => {
        this.roleFilter = r;
        host.querySelectorAll('.roleChip').forEach(c => c.classList.toggle('sel', c === b));
        for (const card of this.els.heroGrid.children) {
          card.classList.toggle('filtered', r !== 'All' && card.heroDef.role !== r);
        }
      });
      host.appendChild(b);
    }
  },

  buildHeroSelect() {
    const grid = this.els.heroGrid;
    for (const h of HEROES) {
      const card = document.createElement('div');
      card.className = 'heroCard';
      card.style.setProperty('--hc', h.color);
      card.innerHTML = `<span class="hStyle" style="background:${DMG_COLORS[h.damageStyle]}"></span>
        <div class="hPortrait">${this.heroIcon(h, 46)}</div>
        <div class="hName">${h.name}</div><div class="hRole">${h.role}</div>
        <div class="cardPips"></div>`;
      card.addEventListener('click', () => this.pickHero(h));
      card.heroDef = h;
      grid.appendChild(card);
    }
  },

  /* ---------------- draft ----------------
     Ten slots, five a side. Anything left empty rolls a random hero at kick-off,
     so you can pick one hero, a whole team, or the entire match-up. Blue slot 0
     is the hero you play when you Enter Battle (and just the first blue bot when
     you spectate). */
  /* Position labels, not just path names. Blue slot zero is the player's flex
     pick (and becomes the roamer in spectator mode); its four allies guarantee
     EXP, jungle, mid and gold coverage. Red fields all five positions. */
  DRAFT_LANES: [['flex', 'gold', 'jungle', 'mid', 'exp'], ['gold', 'jungle', 'mid', 'exp', 'roam']],
  DRAFT_LANES_TEN: [
    ['flex', 'dusk', 'west', 'east', 'dawn', 'jung', 'jung', 'roam', 'roam', 'west'],
    ['dusk', 'west', 'east', 'dawn', 'jung', 'jung', 'roam', 'roam', 'west', 'east'],
  ],
  draftSize: 5,

  laneLabels() { return this.draftSize === 10 ? this.DRAFT_LANES_TEN : this.DRAFT_LANES; },

  setDraftSize(n) {
    const prev = this.draft;
    const prevSlot = this.activeSlot;
    if (this.draftSize === n && prev && prev[0] && prev[0].length === n &&
        this.els.draftBlue && this.els.draftBlue.children.length === n) {
      return;
    }
    this.draftSize = n;
    const hostBlue = this.els.draftBlue, hostRed = this.els.draftRed;
    if (hostBlue) hostBlue.innerHTML = '';
    if (hostRed) hostRed.innerHTML = '';
    if (this.els.pick) this.els.pick.classList.toggle('tenDraft', n === 10);
    this.draft = [Array(n).fill(null), Array(n).fill(null)];
    if (prev) {
      for (const team of [TEAM_BLUE, TEAM_RED]) {
        for (let i = 0; i < n; i++) this.draft[team][i] = (prev[team] && prev[team][i]) || null;
      }
    }
    this.activeSlot = prevSlot && prevSlot.i < n ? prevSlot : { team: TEAM_BLUE, i: 0 };
    const labels = this.laneLabels();
    for (const team of [TEAM_BLUE, TEAM_RED]) {
      const host = team === TEAM_BLUE ? this.els.draftBlue : this.els.draftRed;
      if (!host) continue;
      for (let i = 0; i < n; i++) {
        const slot = document.createElement('div');
        slot.className = 'draftSlot';
        slot.innerHTML = `<span class="slotIcon"></span>
          ${team === TEAM_BLUE && i === 0 ? '<span class="slotYou">YOU</span>' : ''}
          <span class="slotLane">${labels[team][i]}</span>`;
        slot.addEventListener('click', () => {
          const a = this.activeSlot;
          if (a.team === team && a.i === i && this.draft[team][i]) this.setSlot(team, i, null);
          else { this.activeSlot = { team, i }; this.renderDraft(); }
        });
        host.appendChild(slot);
      }
    }
    this.syncDraft();
  },

  buildDraft() {
    this.setDraftSize(5);
    this.els.btnDraftRandom.addEventListener('click', () => {
      const n = this.draftSize;
      for (const team of [TEAM_BLUE, TEAM_RED]) {
        const roll = shuffle(HEROES).concat(shuffle(HEROES));
        for (let i = 0; i < n; i++) this.draft[team][i] = roll[i];
      }
      this.syncDraft();
    });
    this.els.btnDraftClear.addEventListener('click', () => {
      for (const team of [TEAM_BLUE, TEAM_RED]) this.draft[team].fill(null);
      this.activeSlot = { team: TEAM_BLUE, i: 0 };
      this.syncDraft();
    });
  },

  setSlot(team, i, hero) {
    this.draft[team][i] = hero;
    this.syncDraft();
  },

  /* Clicking a hero card fills the active slot and then steps to the next one,
     so a whole match-up is ten clicks on the cards and none on the slots. The
     slots stay clickable for jumping back to one you want to change, and the
     hint under them always names where the next card click will land. */
  pickHero(hero) {
    if (typeof Mlbb !== 'undefined' && Mlbb.banMode != null) {
      Mlbb.tryBan(hero);
      return;
    }
    if (typeof Mlbb !== 'undefined' && Mlbb.isBanned(hero)) {
      this.announce(`${hero.name} is banned`, 'minor');
      return;
    }
    this.els.heroInfo.innerHTML = this.heroInfoHTML(hero);
    const a = this.activeSlot;
    this.draft[a.team][a.i] = hero;
    // preselect the loadout this role usually wants; the player can change it.
    // Only for your own pick — a bot's role should not rewrite your spell.
    if (a.team === TEAM_BLUE && a.i === 0) this.presetLoadout(hero);
    this.activeSlot = this.nextSlot(a);
    this.syncDraft();
  },

  /* Blue 0-4, then red 0-4, then round to the top again. Wrapping rather than
     stopping means the last pick of a full draft leaves you back on your own
     hero, which is the slot you are most likely to want to change next. */
  nextSlot(a) {
    const n = this.draftSize;
    const idx = (a.team * n + a.i + 1) % (n * 2);
    return { team: Math.floor(idx / n), i: idx % n };
  },

  syncDraft() {
    this.selectedHero = this.draft[TEAM_BLUE][0];
    if (typeof Screens !== 'undefined') Screens.syncConfirm();
    else this.els.btnStart.disabled = !this.selectedHero;
    this.renderDraft();
  },

  renderDraft() {
    for (const team of [TEAM_BLUE, TEAM_RED]) {
      const host = team === TEAM_BLUE ? this.els.draftBlue : this.els.draftRed;
      [...host.children].forEach((slot, i) => {
        const h = this.draft[team][i];
        slot.querySelector('.slotIcon').innerHTML = h ? this.heroIcon(h, 28) : '?';
        slot.classList.toggle('filled', !!h);
        slot.classList.toggle('active', this.activeSlot.team === team && this.activeSlot.i === i);
        slot.style.borderColor = h && !(this.activeSlot.team === team && this.activeSlot.i === i)
          ? TEAM_COLORS[team] : '';
        slot.title = h ? `${h.name} — ${h.role}` : 'Random hero';
      });
    }
    // per-card pips: which teams have this hero drafted. The highlight tracks
    // the hero YOU are taking in, not the last card clicked — those two differ
    // the moment a click lands on a bot slot.
    for (const card of this.els.heroGrid.children) {
      card.classList.toggle('sel', card.heroDef === this.draft[TEAM_BLUE][0]);
      const pips = card.querySelector('.cardPips');
      pips.innerHTML = [TEAM_BLUE, TEAM_RED]
        .flatMap(t => this.draft[t].filter(h => h === card.heroDef)
          .map(() => `<span class="cardPip" style="background:${TEAM_COLORS[t]}"></span>`))
        .join('');
    }
    const a = this.activeSlot;
    const spectating = typeof Screens !== 'undefined' && Screens.spectate;
    this.els.draftHint.textContent = a.team === TEAM_BLUE && a.i === 0 && !spectating
      ? 'Tap a hero card to pick yours · empty slots roll random'
      : `Filling ${TEAM_NAMES[a.team]} ${this.laneLabels()[a.team][a.i]} slot · empty slots roll random`;
  },

  /* ---------------- in-game tooltips ----------------
     Hover with a mouse, or press and hold on touch (the hold also aims the
     skill, so the card explains what you are about to throw). */
  initTooltips() {
    const tip = this.els.skillTip;
    let holdT = null;
    const show = kind => {
      const html = this.tipHTML(kind);
      if (!html) return;
      tip.innerHTML = html;
      tip.classList.remove('hidden');
    };
    const hide = () => { clearTimeout(holdT); tip.classList.add('hidden'); };
    const bind = (el, kind) => {
      if (!el) return;
      el.addEventListener('mouseenter', () => show(kind));
      el.addEventListener('mouseleave', hide);
      el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') return;    // hover already covers mice
        clearTimeout(holdT);
        holdT = setTimeout(() => show(kind), 350);
      });
      el.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') hide(); });
      el.addEventListener('pointercancel', hide);
    };
    for (let i = 0; i < 3; i++) bind(document.getElementById('btnS' + i), i);
    bind(document.getElementById('btnAtk'), 'atk');
    bind(document.getElementById('btnRecall'), 'recall');
    bind(document.getElementById('btnSpell'), 'spell');
    this.hideTip = hide;
  },

  tipHTML(kind) {
    const p = Game.player;
    if (!p) return '';
    const row = (k, v) => `<div class="statRow"><span>${k}</span><span>${v}</span></div>`;
    if (kind === 'atk') {
      return `<div class="tipHead"><span class="tipIcon">${this.icon('misc:attack', 34, '⚔')}</span>
          <div><div class="tipName">Basic Attack</div>
          <div class="tipType">${p.ranged ? 'Ranged' : 'Melee'} · click / Space / G / T in place · Q chase</div></div></div>
        <div class="tipDesc">Attack buttons and Space / G / T swing at whoever is already in range without walking. Hold Q to attack-move into range. Tap an enemy portrait to lock them; gold-ringed minions can be last-hit.</div>
        ${row('Damage', Math.round(p.curAtk()))}
        ${row('Attack range', p.range)}
        ${row('Attacks / sec', p.curAtkSpd().toFixed(2))}`;
    }
    if (kind === 'recall') {
      return `<div class="tipHead"><span class="tipIcon">${this.icon('misc:recall', 34, '🏠')}</span>
          <div><div class="tipName">Recall</div><div class="tipType">Channel · key B</div></div></div>
        <div class="tipDesc">Teleport back to your fountain to heal up. Moving or taking damage interrupts it.</div>
        ${row('Channel time', '3.2s')}`;
    }
    if (kind === 'spell') {
      const sp = p.spell;
      if (!sp) return '';
      return `<div class="tipHead"><span class="tipIcon">${this.icon('spell:' + sp.id, 34, sp.icon)}</span>
          <div><div class="tipName">${sp.name}</div><div class="tipType">Battle spell · key F</div></div></div>
        <div class="tipDesc">${sp.desc}</div>
        ${row('Cooldown', sp.cd + 's')}
        ${row('Status', p.spellCd > 0 ? `on cooldown ${p.spellCd.toFixed(1)}s` : 'ready')}`;
    }
    const s = p.skills[kind];
    if (!s) return '';
    const cd = p.skillCd[kind];
    return `<div class="tipHead"><span class="tipIcon">${this.icon(`skill:${p.def0.id}:${kind}`, 34, s.icon)}</span>
        <div><div class="tipName">${s.name}${kind === 2 ? ' <span class="ultTag">ULT</span>' : ''}</div>
        <div class="tipType">${this.SKILL_TYPE[s.type] || s.type} · key ${kind + 1}</div></div></div>
      <div class="tipDesc">${s.desc}</div>
      ${this.skillStats(s, p).map(([k, v]) => row(k, v)).join('')}
      ${row('Status', p.skillRank[kind] < 1 ? `locked — unlocks at level ${BALANCE.ultLevels[0]}`
        : cd > 0 ? `on cooldown ${cd.toFixed(1)}s`
        : p.mana < s.mana ? 'not enough mana' : 'ready')}
      ${row('Rank', `${p.skillRank[kind]} / ${BALANCE.maxSkillRank[kind]}`)}
      ${this.skillTags(s).length ? `<div class="tagList">${this.skillTags(s).map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}`;
  },

  setupHUD(player) {
    Input.clearTargetLock();
    SFX.ensure();
    SFX.startAmbience();
    this.els.ppIcon.innerHTML = this.heroIcon(player, 44);
    this.els.ppIcon.style.borderColor = player.color;
    for (let i = 0; i < 3; i++) {
      const btn = document.getElementById('btnS' + i);
      btn.querySelector('.sIcon').innerHTML =
        this.icon(`skill:${player.def0.id}:${i}`, i === 2 ? 44 : 36, player.skills[i].icon);
    }
    this.buildTeamStrip(player);
    if (this.els.surrenderBox) { this.els.surrenderBox._voted = false; this.els.surrenderBox.classList.add('hidden'); }
    if (this.els.btnPing) this.els.btnPing.classList.remove('hidden');
    const sb = document.getElementById('btnSpell');
    if (sb && player.spell) {
      sb.querySelector('.sIcon').innerHTML = this.icon('spell:' + player.spell.id, 28, player.spell.icon);
    }
    if (this.els.btnShop) this.els.btnShop.classList.remove('hidden');
    if (this.els.itemBar) this.els.itemBar._k = null;
    this._targetLockKey = null;
    this._quickBuyKey = null;
  },

  /* Multi-kills and objectives get the full-screen banner; everything else
     queues into the smaller #announce line so the two never fight for the
     same moment. */
  BANNER_WORDS: /DOUBLE KILL|TRIPLE KILL|MANIAC|SAVAGE|FIRST BLOOD|FIRST TURRET|LORD|TURTLE|PLATING|HAS SPAWNED|GODLIKE|LEGENDARY/i,

  announce(text, style = 'minor') {
    if (style === 'major' && this.BANNER_WORDS.test(text)) { this.banner(text); return; }
    this.announceQueue.push({ text, style });
  },

  banner(text) {
    const el = this.els.banner;
    if (!el) return;
    el.innerHTML = `<span class="bText">${text}</span>`;
    el.classList.remove('show');
    void el.offsetWidth;                 // restart the animation
    el.classList.add('show');
  },

  /* ---------------- ally strip ---------------- */
  buildTeamStrip(player) {
    const host = this.els.teamStrip;
    if (!host) return;
    host.innerHTML = '';
    this.stripCards = [];
    for (const h of Game.heroes) {
      if (h.team !== player.team || h === player) continue;
      const el = document.createElement('div');
      el.className = 'allyCard';
      el.innerHTML = `<span class="allyIcon">${this.heroIcon(h, 24)}</span>
        <span class="allyLv">1</span>
        <span class="allyBars">
          <span class="allyBar"><i></i></span>
          <span class="allyBar mp"><i></i></span>
        </span>
        <span class="allyUlt">${this.icon(`skill:${h.def0.id}:2`, 18, h.skills[2].icon)}</span>
        <span class="allySpell">${h.spell ? this.icon('spell:' + h.spell.id, 16, h.spell.icon) : ''}</span>
        <span class="allyDeadT"></span>`;
      el.addEventListener('click', () => {
        if (Game.player) Game.ping('omw', h.x, h.y, Game.player);
      });
      host.appendChild(el);
      this.stripCards.push({ h, el,
        hp: el.querySelector('.allyBar > i'),
        mp: el.querySelector('.allyBar.mp > i'),
        lv: el.querySelector('.allyLv'),
        ult: el.querySelector('.allyUlt'),
        spell: el.querySelector('.allySpell'),
        deadT: el.querySelector('.allyDeadT') });
    }
  },

  syncTeamStrip() {
    if (!this.stripCards) return;
    for (const c of this.stripCards) {
      const h = c.h;
      c.el.classList.toggle('dead', !h.alive);
      c.hp.style.width = (clamp(h.hpPct, 0, 1) * 100) + '%';
      c.mp.style.width = ((h.maxMana ? h.mana / h.maxMana : 0) * 100) + '%';
      c.lv && this.setTxt(c.lv, h.level);
      c.ult.classList.toggle('ready', h.skillRank[2] > 0 && h.skillCd[2] <= 0 && h.mana >= h.skills[2].mana);
      if (c.spell) c.spell.classList.toggle('ready', h.spell && h.spellCd <= 0);
      if (c.deadT) this.setTxt(c.deadT, h.alive ? '' : Math.ceil(h.respawnT));
    }
  },

  /* ---------------- loadout pickers ---------------- */
  pickedSpell: null, pickedEmblem: null,

  buildLoadoutPickers() {
    const mk = (host, list, prefix, onPick) => {
      if (!host) return;
      for (const d of list) {
        const b = document.createElement('button');
        b.className = 'loChip';
        b.innerHTML = this.icon(`${prefix}:${d.id}`, 26, d.icon);
        b.title = d.name;
        b.addEventListener('click', () => {
          host.querySelectorAll('.loChip').forEach(c => c.classList.toggle('sel', c === b));
          onPick(d);
          this.showLoadoutDesc(d);
        });
        b.addEventListener('mouseenter', () => this.showLoadoutDesc(d));
        host.appendChild(b);
      }
    };
    mk(this.els.spellPick, BATTLE_SPELLS, 'spell', d => { this.pickedSpell = d.id; });
    mk(this.els.emblemPick, EMBLEMS, 'emblem', d => { this.pickedEmblem = d.id; });
  },

  /* Highlight the default spell/emblem for a role without locking the choice. */
  presetLoadout(heroDef) {
    const sId = BOT_SPELL_BY_ROLE[heroDef.role];
    const eId = EMBLEM_BY_ROLE[heroDef.role];
    if (!this.pickedSpell) this.pickedSpell = sId;
    if (!this.pickedEmblem) this.pickedEmblem = eId;
    const mark = (host, list, id) => {
      if (!host) return;
      [...host.children].forEach((c, i) => c.classList.toggle('sel', list[i].id === id));
    };
    mark(this.els.spellPick, BATTLE_SPELLS, this.pickedSpell);
    mark(this.els.emblemPick, EMBLEMS, this.pickedEmblem);
  },

  showLoadoutDesc(d) {
    if (!this.els.loDesc) return;
    const body = d.keystone
      ? `<b>${d.name} Emblem</b><br><small>${this.statLine(d.stats)}</small>
         <div class="loKey">★ ${d.keystone.name} — ${d.keystone.desc}</div>`
      : `<b>${d.name}</b> <span class="loCd">${d.cd}s</span><br><small>${d.desc}</small>`;
    this.els.loDesc.innerHTML = body;
  },

  /* "+22 Attack, +12 Armor Pen" from a raw stat table. */
  STAT_LABELS: {
    maxHp: 'HP', maxMana: 'Mana', physAtk: 'Attack', magicPower: 'Magic Power',
    armor: 'Armor', mr: 'Magic RES', atkSpd: 'Atk Speed', speed: 'Move Speed',
    critChance: 'Crit', critDmg: 'Crit DMG', lifesteal: 'Lifesteal', spellVamp: 'Spell Vamp',
    cdr: 'CD Reduction', tenacity: 'Tenacity', physPen: 'Armor Pen', physPenPct: 'Armor Pen',
    magicPen: 'Magic Pen', magicPenPct: 'Magic Pen', hpRegen: 'HP Regen', manaRegen: 'Mana Regen',
  },
  PCT_STATS: new Set(['critChance', 'critDmg', 'lifesteal', 'spellVamp', 'cdr', 'tenacity',
                      'physPenPct', 'magicPenPct']),
  statLine(stats) {
    return Object.entries(stats).map(([k, v]) => {
      const label = this.STAT_LABELS[k] || k;
      const val = this.PCT_STATS.has(k) ? Math.round(v * 100) + '%'
        : k === 'atkSpd' ? '+' + (v * 100).toFixed(0) + '%'
        : Math.round(v);
      return `+${String(val).replace(/^\+/, '')} ${label}`;
    }).join(', ');
  },

  /* ---------------- shop ---------------- */
  buildShop() {
    const btn = this.els.btnShop;
    if (btn) btn.addEventListener('click', () => this.toggleShop());
    this.shopCat = 'All';
  },
  toggleShop(force) {
    const el = this.els.shop;
    if (!el) return;
    const show = force === undefined ? el.classList.contains('hidden') : force;
    el.classList.toggle('hidden', !show);
    if (show) this.renderShop();
  },
  renderShop() {
    const el = this.els.shop, p = Game.player;
    if (!el || !p) return;
    const cats = ['All', ...ITEM_CATEGORIES, 'Parts'];
    const q = (typeof Features !== 'undefined' ? (Features.shopQuery || '') : '').toLowerCase();
    const pool = this.shopCat === 'Parts'
      ? Object.values(COMPONENTS).map(c => ({ ...c, cat: 'Parts', from: [], desc: 'Component', stats: c.stats }))
      : ITEM_DEFS.filter(it => this.shopCat === 'All' || it.cat === this.shopCat);
    const cards = pool
      .filter(it => !q || it.name.toLowerCase().includes(q) || it.id.includes(q))
      .map(it => {
        const owned = p.items.some(i => i.id === it.id);
        const afford = p.gold >= it.cost;
        const cls = owned ? 'owned' : afford ? 'afford' : 'poor';
        const parts = (it.from || []).map(c => COMPONENTS[c] ? this.itemIcon(COMPONENTS[c], 15) : '').filter(Boolean).join(' + ');
        return `<button class="shopItem ${cls}" data-id="${it.id}" ${owned ? 'disabled' : ''}>
            <span class="siIco">${this.itemIcon(it, 30)}</span>
            <span class="siMain">
              <b>${it.name}</b>
              <i>${this.statLine(it.stats)}</i>
              <small>${it.desc}</small>
              <em>${parts}</em>
            </span>
            <span class="siCost">${it.cost}</span>
          </button>`;
      }).join('');
    el.innerHTML = `
      <div class="shopHead">
        <b>Shop</b>
        <span class="shopGold">💰 ${Math.floor(p.gold)}</span>
        <span class="shopSlots">${p.items.length}/${ITEM_SLOTS} slots</span>
        <span class="shopWhere">${p.atShop() ? 'at base' : '⚠ return to base to buy'}</span>
        <input id="shopSearch" class="shopSearch" placeholder="Search" value="${q.replace(/"/g, '')}">
        <button class="shopClose">✕</button>
      </div>
      <div class="shopCats">${cats.map(c =>
        `<button class="roleChip ${c === this.shopCat ? 'sel' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
      <div class="shopGrid">${cards}</div>
      <div class="shopOwned">${p.items.map((it, i) =>
        `<button class="ownedItem" data-sell="${i}" title="Sell ${it.name} for ${Math.floor(it.cost * 0.7)}">
          ${this.itemIcon(it, 22)}<span>↩</span></button>`).join('') || '<span class="shopHint">No items yet</span>'}</div>`;

    el.querySelector('.shopClose').addEventListener('click', () => this.toggleShop(false));
    el.querySelectorAll('.shopCats .roleChip').forEach(b =>
      b.addEventListener('click', () => { this.shopCat = b.dataset.cat; this.renderShop(); }));
    el.querySelectorAll('.shopItem').forEach(b =>
      b.addEventListener('click', () => {
        const def = ITEM_BY_ID[b.dataset.id] || COMPONENTS[b.dataset.id];
        if (!def) return;
        if (!p.atShop()) { this.announce('Return to base to buy items', 'minor'); return; }
        if (!p.canBuy(def)) { this.announce('Not enough gold', 'minor'); return; }
        p.buyItem(def);
        this.renderShop();
      }));
    el.querySelectorAll('.ownedItem').forEach(b =>
      b.addEventListener('click', () => { p.sellItem(+b.dataset.sell); this.renderShop(); }));
    const search = el.querySelector('#shopSearch');
    if (search && typeof Features !== 'undefined') {
      search.addEventListener('input', () => { Features.shopQuery = search.value; this.renderShop(); search.focus(); });
    }
  },

  syncItemBar() {
    const host = this.els.itemBar, p = Game.player;
    if (!host || !p) return;
    const cds = p.itemCd ? Object.values(p.itemCd).map(v => Math.ceil(v)).join(',') : '';
    const key = p.items.map(i => i.id).join(',') + '|' + p.items.length + '|' + cds;
    if (host._k === key) return;
    host._k = key;
    host.innerHTML = Array.from({ length: ITEM_SLOTS }, (_, i) => {
      const it = p.items[i];
      const cd = it && it.active && p.itemCd ? p.itemCd[it.active.id] : 0;
      const use = it && (it.consume || it.active);
      return `<span class="itemSlot ${it ? 'full' : ''} ${use ? 'useable' : ''}" title="${it ? it.name + (use ? ' — click to use' : '') : 'Empty slot'}">${it ? this.itemIcon(it, 19) : ''}${cd > 0 ? `<i class="itemCd">${Math.ceil(cd)}</i>` : ''}</span>`;
    }).join('');
  },

  buyRecommended() {
    const p = Game.player;
    if (!p || Game.isDuel()) return;
    const def = ItemAI.recommend(p);
    if (!def) { this.announce('Build complete', 'minor'); return; }
    if (!p.atShop()) { this.announce('Return to base for Quick Buy', 'minor'); return; }
    if (!p.canBuy(def)) {
      this.announce(p.items.length >= ITEM_SLOTS ? 'Inventory full' : `Need ${Math.ceil(def.cost - p.gold)} more gold`, 'minor');
      return;
    }
    p.buyItem(def);
    this._quickBuyKey = null;
    if (this.els.shop && !this.els.shop.classList.contains('hidden')) this.renderShop();
  },

  syncQuickBuy() {
    const el = this.els.quickBuy, p = Game.player;
    if (!el || !p || Game.isDuel() || p.items.length >= ITEM_SLOTS) {
      if (el) el.classList.add('hidden');
      return;
    }
    const def = ItemAI.recommend(p);
    if (!def) { el.classList.add('hidden'); return; }
    const ready = p.atShop() && p.canBuy(def);
    const state = ready ? 'BUY NOW' : p.gold < def.cost
      ? `SAVE ${Math.ceil(def.cost - p.gold)}` : 'AT BASE';
    const key = `${def.id}|${state}|${Math.floor(p.gold / 25)}`;
    if (this._quickBuyKey !== key) {
      this._quickBuyKey = key;
      el.innerHTML = `<span class="qbIcon">${this.itemIcon(def, 24)}</span><span class="qbText"><small>RECOMMENDED</small><b>${def.name}</b></span><span class="qbCost">${def.cost}<i>${state}</i></span>`;
      el.title = `${def.desc} — ${state === 'AT BASE' ? 'return to base to buy' : state.toLowerCase()}`;
    }
    el.classList.remove('hidden');
    el.classList.toggle('ready', ready);
  },

  syncTargetLock() {
    const host = this.els.targetLock, p = Game.player;
    if (!host || !p || !p.alive) {
      if (host) host.classList.add('hidden');
      return;
    }
    const validLock = Input.lockedTarget && Input.lockedTarget.alive &&
      Input.lockedTarget.team !== p.team && Game.canSee(p.team, Input.lockedTarget) &&
      dist(p, Input.lockedTarget) <= 1400;
    if (Input.lockedTarget && !validLock) Input.clearTargetLock();
    const enemies = Game.heroes
      .filter(h => h.team !== p.team && h.alive && Game.canSee(p.team, h) && dist(p, h) <= 1200)
      .sort((a, b) => dist(p, a) - dist(p, b)).slice(0, 5);
    if (!enemies.length) { host.classList.add('hidden'); this._targetLockKey = ''; return; }
    const key = enemies.map(h => `${h.def0.id}:${Math.ceil(h.hpPct * 20)}:${h === Input.lockedTarget ? 1 : 0}`).join('|');
    if (this._targetLockKey !== key) {
      this._targetLockKey = key;
      host.innerHTML = `<span class="lockLabel">TARGET</span>` + enemies.map((h, i) =>
        `<button class="lockHero ${h === Input.lockedTarget ? 'locked' : ''}" data-i="${i}" title="${h === Input.lockedTarget ? 'Unlock' : 'Lock'} ${h.name}">
          <span class="lockFace">${this.heroIcon(h, 22)}</span><i><b style="width:${Math.round(h.hpPct * 100)}%"></b></i>
        </button>`).join('');
      host.querySelectorAll('.lockHero').forEach(b => b.addEventListener('click', () => {
        Input.setLockedTarget(enemies[+b.dataset.i]);
        this._targetLockKey = null;
        this.syncTargetLock();
      }));
    }
    host.classList.remove('hidden');
  },

  /* ---------------- ping wheel ----------------
     Opens under the thumb, commits on release over a segment. Six options is
     the most that stays selectable without looking. */
  buildPingWheel() {
    const host = this.els.pingWheel;
    const btn = this.els.btnPing;
    if (!host || !btn) return;
    const kinds = Object.entries(Game.PING_KINDS);
    host.innerHTML = kinds.map(([k, d], i) => {
      const a = (i / kinds.length) * TAU - Math.PI / 2;
      const R = 74;
      return `<button class="pingOpt" data-kind="${k}"
        style="left:calc(50% + ${(Math.cos(a) * R).toFixed(1)}px);
               top:calc(50% + ${(Math.sin(a) * R).toFixed(1)}px);
               border-color:${d.color}">
        <span>${this.icon('ping:' + k, 22, d.icon)}</span><i>${d.label}</i></button>`;
    }).join('');

    const open = () => { host.classList.remove('hidden'); };
    const close = () => { host.classList.add('hidden'); };
    btn.addEventListener('click', () => {
      if (host.classList.contains('hidden')) open(); else close();
    });
    host.querySelectorAll('.pingOpt').forEach(b =>
      b.addEventListener('click', () => { this.sendPing(b.dataset.kind); close(); }));
    this.closePingWheel = close;
  },

  /* Where a ping lands: on the player's current target if they have one,
     otherwise on the player. Aiming a ping precisely is not worth a mode —
     use the minimap for world-space pings instead. */
  sendPing(kind, x, y) {
    const p = Game.player;
    if (!p) return;
    if (x !== undefined && y !== undefined) {
      Game.ping(kind, x, y, p);
      return;
    }
    const t = p.curTarget && p.curTarget.alive ? p.curTarget : p;
    Game.ping(kind, t.x, t.y, p);
  },

  bindMinimap() {
    const cv = this.els.minimap;
    if (!cv || cv._bound) return;
    cv._bound = true;
    cv.addEventListener('pointerdown', e => {
      if (Game.state !== 'play') return;
      const bounds = Game.mapBounds();
      const r = cv.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
      const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
      const wx = bounds.minX + nx * (bounds.maxX - bounds.minX);
      const wy = bounds.minY + ny * (bounds.maxY - bounds.minY);
      if (Game.spectate) {
        Game.followHero = null;
        Game.cam.x = clamp(wx, bounds.minX, bounds.maxX);
        Game.cam.y = clamp(wy, bounds.minY, bounds.maxY);
      } else if (Game.player) {
        const kind = e.shiftKey ? 'danger' : 'attack';
        this.sendPing(kind, wx, wy);
      }
      e.preventDefault();
      e.stopPropagation();
    });
  },

  pingFeed(kind, by) {
    const host = this.els.pingFeed;
    if (!host || !by || by.team !== TEAM_BLUE || Game.spectate) return;
    const d = Game.PING_KINDS[kind];
    const el = document.createElement('div');
    el.className = 'pingItem';
    el.innerHTML = `${this.icon('ping:' + kind, 15, d.icon)} ${this.heroIcon(by, 16)} ${by.name}: <b>${d.label}</b>`;
    host.prepend(el);
    setTimeout(() => el.remove(), 4200);
    while (host.children.length > 4) host.lastChild.remove();
  },

  /* ---------------- surrender ---------------- */
  syncSurrender() {
    const host = this.els.surrenderBox;
    if (!host) return;
    const v = Game.surrender;
    if (!v || (Game.player && v.team !== Game.player.team)) {
      if (!host.classList.contains('hidden')) host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    const left = Math.max(0, v.endsAt - Game.time);
    if (host._voted) {
      host.innerHTML = `<b>Surrender vote</b><span>${v.yes} yes · ${v.no} no</span>
        <small>${left.toFixed(0)}s</small>`;
      return;
    }
    host.innerHTML = `<b>Surrender?</b><span>${v.yes} yes · ${v.no} no · ${left.toFixed(0)}s</span>
      <button data-v="1">Yes</button><button data-v="0">No</button>`;
    host.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.v === '1') v.yes++; else v.no++;
      host._voted = true;
    }));
  },

  /* Objective clocks under the minimap. Only the next two matter, and the
     row turns amber inside 30s so it registers peripherally. */
  syncObjectiveTimers() {
    const host = this.els.objTimers;
    if (!host) return;
    const st = Game.objectiveState();
    const html = st.map(o => {
      const cls = o.up ? 'up' : o.in <= 30 ? 'soon' : '';
      const val = o.up ? 'UP' : `${Math.floor(o.in / 60)}:${String(Math.floor(o.in % 60)).padStart(2, '0')}`;
      return `<div class="objRow ${cls}"><span>${this.icon(this.ICON_ALIAS[o.icon], 15, o.icon)} ${o.label}</span><b>${val}</b></div>`;
    }).join('');
    if (host._h !== html) { host._h = html; host.innerHTML = html; }
  },

  /* ---------------- scoreboard ---------------- */
  buildScoreboardToggle() {
    const btn = document.getElementById('btnScore');
    if (btn) btn.addEventListener('click', () => this.toggleScoreboard());
  },
  toggleScoreboard(force) {
    const el = this.els.scoreboard;
    if (!el) return;
    const show = force === undefined ? el.classList.contains('hidden') : force;
    el.classList.toggle('hidden', !show);
    if (show) this.renderScoreboard();
  },
  renderScoreboard() {
    const el = this.els.scoreboard;
    if (!el || Game.state === 'select') return;
    // damage bars are scaled to the biggest number on the board, so the shape
    // of the graph answers "who is actually carrying" at a glance
    const maxDmg = Math.max(1, ...Game.heroes.map(h => h.stats.dmgHero));
    const team = t => {
      const rows = Game.heroes.filter(h => h.team === t)
        .sort((a, b) => b.stats.dmgHero - a.stats.dmgHero)
        .map(h => `<div class="sbRowP${h.isPlayer ? ' you' : ''}">
            <span>${this.heroIcon(h, 20)}</span>
            <span class="nm"><span>${h.name}</span> <span class="lv">${h.level}</span></span>
            <span class="sbLoad">${h.spell ? this.icon('spell:' + h.spell.id, 16, h.spell.icon) : ''}${h.emblem ? this.icon('emblem:' + h.emblem.id, 16, h.emblem.icon) : ''}</span>
            <span>${h.kills}/${h.deaths}/${h.assists}</span>
            <span>${Math.floor(h.goldEarned)}</span>
            <span>${h.cs || 0}</span>
            <span>${Math.round((typeof Features !== 'undefined' ? Features.kp(h) : 0) * 100)}%</span>
            <span>${Math.round(h.stats.dmgHero)}</span>
            <span>${Math.round(h.stats.dmgTaken)}</span>
            <span>${Math.round(h.stats.healDone || 0)}</span>
            <span class="sbBar"><i style="width:${h.stats.dmgHero / maxDmg * 100}%"></i></span>
          </div>`).join('');
      return `<div class="sbTeam ${t === TEAM_BLUE ? 'blue' : 'red'}">
        <div class="sbHead"><span></span><span>${TEAM_NAMES[t]} — ${Game.kills[t]} kills</span>
          <span>Load</span>
          <span>K/D/A</span><span>Gold</span><span>CS</span><span>KP</span><span>Dmg</span><span>Taken</span><span>Heal</span><span>Share</span></div>
        ${rows}</div>`;
    };
    const m = Math.floor(Game.time / 60), sec = Math.floor(Game.time % 60);
    el.innerHTML = team(TEAM_BLUE) + team(TEAM_RED) +
      `<div class="sbTotals">
         <span>⏱ ${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}</span>
         <span style="color:var(--team-blue)">${Math.round(Game.teamGold(TEAM_BLUE))} gold</span>
         <span style="color:var(--team-red)">${Math.round(Game.teamGold(TEAM_RED))} gold</span>
       </div><div class="sbHint">Hold Tab or press 📊 to toggle</div>`;
  },

  killFeed(killer, victim) {
    const lbl = u => {
      if (!u) return `<span style="color:${THEME.textFaint}">the world</span>`;
      const tc = u.team === TEAM_NEUTRAL ? THEME.neutral : TEAM_COLORS[u.team];
      if (u instanceof Hero) return `<span style="color:${tc}">${this.heroIcon(u, 17)} ${u.name}</span>`;
      if (u instanceof EpicMonster) return `<span style="color:${u.color}">${this.icon(this.ICON_ALIAS[u.icon], 17, u.icon)} ${u.name}</span>`;
      if (u instanceof Inhibitor) return `<span style="color:${tc}">${this.icon('misc:gate', 17, '🚪')} Inhibitor</span>`;
      if (u instanceof Tower) return `<span style="color:${tc}">${this.icon('misc:turret', 17, '🗼')} ${u.isBase ? 'Base' : 'Turret'}</span>`;
      if (u instanceof Minion) {
        const k = u.kind === 'super' ? 'Super Minion' : u.kind === 'lord' ? 'Warden Minion' : 'Minion';
        return `<span style="color:${tc}">${k}</span>`;
      }
      if (u instanceof Monster) return `<span style="color:${THEME.neutral}">${u.buff ? u.buff.name : 'Monster'}</span>`;
      return `<span style="color:${THEME.textFaint}">Unknown</span>`;
    };
    const div = document.createElement('div');
    div.className = 'feedItem';
    const badge = (killer instanceof Hero && killer.streak >= 3) ? '<i class="sdBadge">🔥</i>' : '';
    const spell = (killer instanceof Hero && killer.spell)
      ? `<i class="feedSpell" title="${killer.spell.name}">${this.icon('spell:' + killer.spell.id, 14, killer.spell.icon)}</i>` : '';
    div.innerHTML = `${lbl(killer)} ${spell}<span class="sword">${this.icon('misc:attack', 14, '⚔')}</span> ${lbl(victim)}${badge}`;
    this.els.killfeed.prepend(div);
    this.feedItems.push({ el: div, t: Game.time });
    while (this.feedItems.length > 5) this.feedItems.shift().el.remove();
  },

  syncHUD(dt) {
    if (Game.state === 'select' || Game.attract) {
      if (SFX.amb) SFX.stopAmbience();
      return;
    }
    const p = Game.player;
    // ambient pad tracks combat intensity; mute toggle kills it via syncAmbience
    if (Game.state === 'play') SFX.syncAmbience(Game.combatHeat || 0);
    else if (SFX.amb) SFX.stopAmbience();

    // announcements
    this.announceT -= dt;
    if (this.announceT <= 0 && this.announceQueue.length) {
      const a = this.announceQueue.shift();
      const el = this.els.announce;
      el.textContent = a.text;
      el.className = 'ann-' + a.style;
      el.classList.add('show');
      this.announceT = 1.9;
      clearTimeout(this._annHide);
      this._annHide = setTimeout(() => el.classList.remove('show'), 1750);
    }
    // feed expiry
    this.feedItems = this.feedItems.filter(f => {
      if (Game.time - f.t > 7) { f.el.remove(); return false; }
      return true;
    });

    // top bar
    this.setTxt(this.els.scoreBlue, Game.kills[0]);
    this.setTxt(this.els.scoreRed, Game.kills[1]);
    const m = Math.floor(Game.time / 60), s = Math.floor(Game.time % 60);
    this.setTxt(this.els.clock, `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);

    // team economy: the bar grows from the centre toward whoever leads, and
    // saturates at a 10k lead so early noise does not peg it
    const gb = Game.teamGold(TEAM_BLUE), gr = Game.teamGold(TEAM_RED);
    this.setTxt(this.els.goldBlue, (gb / 1000).toFixed(1) + 'k');
    this.setTxt(this.els.goldRed, (gr / 1000).toFixed(1) + 'k');
    const diff = clamp((gb - gr) / 10000, -1, 1);
    const f = this.els.goldDiffFill;
    f.style.width = Math.abs(diff) * 50 + '%';
    f.style.left = diff >= 0 ? '50%' : (50 - Math.abs(diff) * 50) + '%';
    f.style.background = diff >= 0 ? THEME.blue : THEME.red;

    this.syncTeamStrip();
    this.syncObjectiveTimers();
    this.syncSurrender();
    if (this.els.scoreboard && !this.els.scoreboard.classList.contains('hidden')) this.renderScoreboard();

    if (!p) { // spectator: no player panel / skills / death overlay
      if (this.els.targetLock) this.els.targetLock.classList.add('hidden');
      if (this.els.quickBuy) this.els.quickBuy.classList.add('hidden');
      if (this.els.terrainBuff) this.els.terrainBuff.classList.add('hidden');
      if (this.els.laneBuff) this.els.laneBuff.classList.add('hidden');
      if (Game.spectate) {
        const f = Game.followHero;
        this.els.specFollow.textContent = f
          ? `Following ${f.name} [${f.botType}]` : 'Free camera';
      }
      this.drawMinimap();
      if (typeof Features !== 'undefined') Features.onHudTick(dt);
      return;
    }

    // player panel
    const hpW = clamp(p.hpPct, 0, 1) * 100;
    this.els.ppHp.style.width = hpW + '%';
    this.els.ppShield.style.width =
      Math.min(100 - hpW, p.shieldTotal / p.maxHp * 100) + '%';
    this.els.ppMp.style.width = (p.maxMana ? p.mana / p.maxMana * 100 : 0) + '%';
    this.setTxt(this.els.ppHpT, `${Math.ceil(p.hp)}/${p.maxHp}`);
    this.setTxt(this.els.ppLevel, p.level);
    this.setTxt(this.els.ppKda, `${p.kills}/${p.deaths}/${p.assists}`);
    this.setTxt(this.els.ppGold, Math.floor(p.gold));
    this.setTxt(this.els.ppGear, `${p.items.length}/${ITEM_SLOTS}`);
    this.setTxt(this.els.ppArmor, Math.round(p.armorValue()));
    this.setTxt(this.els.ppMr, Math.round(p.mrValue()));
    this.syncTargetLock();
    if (this.els.terrainBuff) {
      this.els.terrainBuff.classList.toggle('hidden', !p.alive || !p.inRiver);
      this.els.terrainBuff.classList.toggle('ember', Game.isTen());
      if (p.alive && p.inRiver) {
        const html = Game.isTen()
          ? '≈ EMBER VEIN <b>+12% MOVE</b>'
          : '≈ AETHER CURRENT <b>+12% MOVE</b>';
        if (this._terrainHtml !== html) {
          this._terrainHtml = html;
          this.els.terrainBuff.innerHTML = html;
        }
      }
    }
    if (this.els.laneBuff) {
      const lane = Game.time < BALANCE.laneBonusEnd ? Game.nearestLane(p, 260) : null;
      const goldLane = Game.isTen() ? 'dusk' : 'top';
      const expLane = Game.isTen() ? 'dawn' : 'bot';
      const rule = lane === goldLane
        ? [Game.isTen() ? 'DUSK ROAD' : 'GOLD LANE', `+${Math.round((BALANCE.goldLaneMult - 1) * 100)}% CANNON GOLD`, 'gold']
        : lane === expLane
          ? [Game.isTen() ? 'DAWN ROAD' : 'EXP LANE', `+${Math.round((BALANCE.expLaneMult - 1) * 100)}% CANNON XP`, 'exp']
          : null;
      this.els.laneBuff.classList.toggle('hidden', !p.alive || !rule);
      if (rule) {
        this.els.laneBuff.className = rule[2];
        const html = `${rule[0]} <b>${rule[1]}</b> <small>${Math.ceil(BALANCE.laneBonusEnd - Game.time)}s</small>`;
        if (this._laneHtml !== html) {
          this._laneHtml = html;
          this.els.laneBuff.innerHTML = html;
        }
      }
    }
    const heroAtk = document.getElementById('btnHeroAtk');
    const laneAtk = document.getElementById('btnLaneAtk');
    if (heroAtk) heroAtk.classList.toggle('active', Input.attackHeld && Input.attackMode === 'hero');
    if (laneAtk) laneAtk.classList.toggle('active', Input.attackHeld && Input.attackMode === 'lane');

    // skill buttons
    for (let i = 0; i < 3; i++) {
      const btn = document.getElementById('btnS' + i);
      const s = p.skills[i];
      const cd = p.skillCd[i];
      const mask = btn.querySelector('.cdMask');
      const num = btn.querySelector('.cdNum');
      const learned = p.skillRank[i] > 0;
      if (cd > 0) {
        mask.style.setProperty('--p', cd / p.cooldownFor(s));
        mask.style.display = 'block';
        this.setTxt(num, Math.ceil(cd));
      } else { mask.style.display = 'none'; this.setTxt(num, ''); }
      btn.classList.toggle('nomana', p.mana < s.mana);
      btn.classList.toggle('locked', !learned);
      btn.classList.toggle('ready', i === 2 && learned && cd <= 0 && p.mana >= s.mana);
      // rank pips + the "spend a point here" affordance
      let pips = btn.querySelector('.rankPips');
      if (!pips) {
        pips = document.createElement('div');
        pips.className = 'rankPips';
        btn.appendChild(pips);
      }
      let rankBtn = btn.querySelector('.rankUpBtn');
      if (!rankBtn) {
        rankBtn = document.createElement('button');
        rankBtn.type = 'button';
        rankBtn.className = 'rankUpBtn hidden';
        rankBtn.textContent = '+';
        rankBtn.setAttribute('aria-label', `Upgrade ${s.name}`);
        rankBtn.title = `Spend one skill point on ${s.name}`;
        btn.appendChild(rankBtn);
      }
      const maxR = BALANCE.maxSkillRank[i];
      if (pips.dataset.r !== String(p.skillRank[i])) {
        pips.dataset.r = String(p.skillRank[i]);
        pips.innerHTML = Array.from({ length: maxR },
          (_, k) => `<i class="${k < p.skillRank[i] ? 'on' : ''}"></i>`).join('');
      }
      const canRank = p.canRankUp(i);
      btn.classList.toggle('canRank', canRank);
      rankBtn.classList.toggle('hidden', !canRank);
    }
    this.setTxt(this.els.skillPts, p.skillPoints);
    this.els.skillPts.parentElement.classList.toggle('hidden', p.skillPoints <= 0);
    // battle spell
    const sb = document.getElementById('btnSpell');
    if (sb && p.spell) {
      const mask = sb.querySelector('.cdMask'), num = sb.querySelector('.cdNum');
      if (p.spellCd > 0) {
        mask.style.setProperty('--p', p.spellCd / p.spell.cd);
        mask.style.display = 'block';
        this.setTxt(num, Math.ceil(p.spellCd));
      } else { mask.style.display = 'none'; this.setTxt(num, ''); }
      sb.classList.toggle('ready', p.spellCd <= 0);
    }

    // item bar + shop affordance
    this.syncItemBar();
    this.syncQuickBuy();
    this.els.btnShop.classList.toggle('atBase', p.atShop());
    if (!this.els.shop.classList.contains('hidden')) {
      // keep the gold readout and affordability live while the panel is open
      this._shopT = (this._shopT || 0) - dt;
      if (this._shopT <= 0) { this._shopT = 0.4; this.renderShop(); }
    }

    // recall spin
    document.getElementById('btnRecall').classList.toggle('channeling', p.recallT > 0);

    // death overlay
    if (!p.alive) {
      this.els.deathOverlay.classList.remove('hidden');
      this.setTxt(this.els.deathTimer, p.respawnT >= 3 ? Math.ceil(p.respawnT) : p.respawnT.toFixed(1));
      if (this._deathKey !== p.deaths) {
        this._deathKey = p.deaths;
        this.renderDeathRecap(p.deathRecap);
      }
      this.hideTip();
    } else {
      this.els.deathOverlay.classList.add('hidden');
      this._deathKey = 0;
    }

    this.drawMinimap();
    if (typeof Features !== 'undefined') Features.onHudTick(dt);
  },

  buildMinimapStatic() {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const g = c.getContext('2d');
    const bounds = Game.mapBounds();
    const k = 200 / (bounds.maxX - bounds.minX);
    const mx = x => (x - bounds.minX) * k;
    const my = y => (y - bounds.minY) * k;
    g.fillStyle = Game.isTen() ? '#0b0c12' : THEME.canopyDark;
    g.fillRect(0, 0, 200, 200);
    g.fillStyle = Game.isTen() ? '#16141c' : THEME.groundMid;
    g.fillRect(4, 4, 192, 192);
    if (Game.isTen()) {
      g.strokeStyle = '#c45a18'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath();
      const vein = TEN_MAP.vein;
      g.moveTo(mx(vein[0].x), my(vein[0].y));
      for (const q of vein) g.lineTo(mx(q.x), my(q.y));
      g.stroke();
      g.fillStyle = '#e07020';
      g.beginPath(); g.arc(mx(TEN_MAP.crater.x), my(TEN_MAP.crater.y), 14, 0, TAU); g.fill();
      g.fillStyle = '#f0b429';
      for (const p of [TEN_MAP.beaconWest, TEN_MAP.beaconEast]) {
        g.beginPath(); g.arc(mx(p.x), my(p.y), 6, 0, TAU); g.fill();
      }
      for (const c of TEN_MAP.camps) {
        g.fillStyle = c.kind === 'normal' ? '#6a5840' : (c.kind === 'blueBuff' ? '#3d7a9a' : '#c45a18');
        g.beginPath(); g.arc(mx(c.x), my(c.y), c.kind === 'normal' ? 2.6 : 3.6, 0, TAU); g.fill();
      }
    } else if (!Game.isDuel()) {
      for (const c of CAMPS) {
        const col = c.kind === 'blueBuff' ? '#3d7a9a'
          : c.kind === 'redBuff' ? '#c45a18'
          : c.kind === 'litho' ? '#2dd4bf'
          : c.kind === 'crab' ? '#94a3b8'
          : '#6a5840';
        g.fillStyle = rgba(col, 0.95);
        const rr = (c.kind === 'blueBuff' || c.kind === 'redBuff') ? 4.2
          : (c.kind === 'litho' || c.kind === 'crab') ? 2.8 : 3.2;
        g.beginPath(); g.arc(mx(c.x), my(c.y), rr, 0, TAU); g.fill();
      }
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [w, col] of [[9, '#0e4a48'], [6, rgba(THEME.river, 0.95)]]) {
        g.strokeStyle = col; g.lineWidth = w;
        for (const s of STREAMS) {
          g.beginPath(); g.moveTo(mx(s[0].x), my(s[0].y));
          for (const q of s) g.lineTo(mx(q.x), my(q.y));
          g.stroke();
        }
      }
      for (const p of POOLS) {
        g.fillStyle = rgba(THEME.river, 0.95);
        g.beginPath(); g.arc(mx(p.x), my(p.y), p.r * k, 0, TAU); g.fill();
        g.fillStyle = rgba(THEME.riverLight, 0.8);
        g.beginPath(); g.arc(mx(p.x), my(p.y), 5, 0, TAU); g.fill();
      }
    }
    const lanes = Game.isDuel() ? DUEL_MAP.lanes : Game.isTen() ? TEN_MAP.lanes : LANES;
    for (const [name, lane] of Object.entries(lanes)) {
      const flank = name.startsWith('flank');
      g.strokeStyle = Game.isTen() ? '#c4a060' : rgba(THEME.lane, flank ? 0.4 : 0.9);
      g.lineWidth = flank ? 5 : Game.isTen() ? 4 : 9;
      g.beginPath();
      g.moveTo(mx(lane[0].x), my(lane[0].y));
      for (const pt of lane) g.lineTo(mx(pt.x), my(pt.y));
      g.stroke();
    }
    if (!Game.isDuel() && !Game.isTen()) {
      for (const [name, text, color] of [['top', 'G', THEME.gold], ['bot', 'XP', THEME.xp]]) {
        const p = pathPoint(LANES[name], 0.5);
        g.fillStyle = rgba(THEME.void, 0.78);
        g.beginPath(); g.arc(mx(p.x), my(p.y), 8, 0, TAU); g.fill();
        g.fillStyle = color; g.font = '800 8px system-ui';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, mx(p.x), my(p.y) + 0.5);
      }
    }
    // walls, under the bushes — terrain you cannot cross is worth reading on
    // the minimap, since it decides which way a rotation actually goes
    g.strokeStyle = THEME.wallLight; g.lineJoin = 'round'; g.lineCap = 'round';
    for (const w of Game.walls()) {
      if (w.hidden) continue;
      if (w.poly) {
        g.fillStyle = THEME.wallLight;
        g.beginPath(); g.moveTo(mx(w.poly[0].x), my(w.poly[0].y));
        for (const p of w.poly) g.lineTo(mx(p.x), my(p.y));
        g.closePath(); g.fill();
        continue;
      }
      for (let i = 1; i < w.pts.length; i++) {
        const a = w.pts[i - 1], b = w.pts[i], r = a.r !== undefined ? (a.r + b.r) / 2 : w.r;
        g.lineWidth = Math.max(3, r * 2 * k);
        g.beginPath(); g.moveTo(mx(a.x), my(a.y)); g.lineTo(mx(b.x), my(b.y)); g.stroke();
      }
    }
    // bushes
    for (const b of Game.bushes()) {
      g.fillStyle = rgba(THEME.bush, 0.85);
      if (b.poly) {
        g.beginPath(); g.moveTo(mx(b.poly[0].x), my(b.poly[0].y));
        for (const p of b.poly) g.lineTo(mx(p.x), my(p.y));
        g.closePath(); g.fill();
        continue;
      }
      if (b.ax !== undefined) {
        g.strokeStyle = rgba(THEME.bush, 0.85); g.lineWidth = b.r * 2 * k; g.lineCap = 'round';
        g.beginPath(); g.moveTo(mx(b.ax), my(b.ay)); g.lineTo(mx(b.bx), my(b.by)); g.stroke();
        continue;
      }
      const mid = Game.worldSize() / 2;
      const ang = Math.atan2(b.y - mid, b.x - mid) + Math.PI / 4;
      g.save(); g.translate(mx(b.x), my(b.y)); g.rotate(ang); g.scale(1.45, 0.78);
      g.beginPath(); g.arc(0, 0, b.r * k, 0, TAU); g.fill();
      g.restore();
    }
    if (Game.isDuel()) {
      const s = DUEL_MAP.shrine;
      g.strokeStyle = rgba(THEME.gold, 0.5); g.lineWidth = 2;
      g.beginPath(); g.arc(mx(s.x), my(s.y), Math.max(4, s.r * k), 0, TAU); g.stroke();
      g.strokeStyle = rgba(THEME.gold, 0.65); g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, 197, 197);
    }
    this.miniStatic = c;
  },

  drawMinimap() {
    const now = performance.now();
    if (this._miniAt && now - this._miniAt < 48 && Game.state === 'play' && !Game.paused) return;
    this._miniAt = now;
    const cv = this.els.minimap;
    const g = cv.getContext('2d');
    const bounds = Game.mapBounds();
    const k = 200 / (bounds.maxX - bounds.minX);
    const mx = x => (x - bounds.minX) * k;
    const my = y => (y - bounds.minY) * k;
    const mk = k;                 // alias: `k` is reused as an animation phase below
    g.clearRect(0, 0, 200, 200);
    g.drawImage(this.miniStatic, 0, 0);
    // structures
    for (const t of Game.structures()) {
      if (!t.alive) continue;
      g.fillStyle = TEAM_COLORS[t.team];
      const s = t.isBase ? 9 : 6;
      g.fillRect(mx(t.x) - s / 2, my(t.y) - s / 2, s, s);
    }
    // monsters
    g.fillStyle = THEME.neutral;
    for (const mo of Game.monsters) {
      if (!mo.alive) continue;
      g.beginPath(); g.arc(mx(mo.x), my(mo.y), 2.5, 0, TAU); g.fill();
    }
    // a live duel rune, pulsing like a ping so it pulls the eye to the centre
    if (Game.duelRune && Game.duelRune.up) {
      const s = DUEL_MAP.shrine, def = JUNGLE_BUFFS[Game.duelRune.kind];
      g.fillStyle = def.color;
      g.beginPath(); g.arc(mx(s.x), my(s.y), 4, 0, TAU); g.fill();
      g.strokeStyle = rgba(def.color, 0.7); g.lineWidth = 2;
      g.beginPath(); g.arc(mx(s.x), my(s.y), 5 + ((Game.time * 1.4) % 1) * 7, 0, TAU); g.stroke();
    }
    // heroes
    for (const h of Game.heroes) {
      if (!h.alive) continue;
      if (!Game.spectate && h.team !== TEAM_BLUE && !Game.canSee(TEAM_BLUE, h)) continue;
      g.beginPath();
      g.arc(mx(h.x), my(h.y), h.isPlayer ? 5 : 4, 0, TAU);
      g.fillStyle = TEAM_COLORS[h.team];
      g.fill();
      if (h.isPlayer) { g.strokeStyle = THEME.text; g.lineWidth = 2; g.stroke(); }
    }
    if (typeof Mlbb !== 'undefined') Mlbb.drawMinimapUlt(g, mx, my);
    if (typeof Features !== 'undefined') Features.renderMinimap(g, mx, my);
    // pings, pulsing so they catch the eye at minimap scale
    for (const pg of Game.pings) {
      if (!Game.spectate && pg.team !== TEAM_BLUE) continue;
      const def = Game.PING_KINDS[pg.kind];
      const k = (pg.age * 1.4) % 1;
      g.beginPath();
      g.arc(mx(pg.x), my(pg.y), 3 + k * 9, 0, TAU);
      g.strokeStyle = rgba(def.color, (1 - k) * (1 - pg.age / 4));
      g.lineWidth = 2;
      g.stroke();
    }
  },

  /* ---------------- post-match ----------------
     MVP is a weighted score rather than raw kills, so the tank who held the
     front and the support who kept everyone alive can win it. Weights are
     normalised against the best performer in each category so the scale does
     not shift with match length. */
  mvpScore(h, max) {
    const n = (v, m) => (m > 0 ? v / m : 0);
    return 0.28 * n(h.kills, max.kills)
         + 0.22 * n(h.assists, max.assists)
         + 0.20 * n(h.stats.dmgHero, max.dmgHero)
         + 0.12 * n(h.stats.dmgStruct, max.dmgStruct)
         + 0.10 * n(h.stats.dmgTaken, max.dmgTaken)
         + 0.08 * n(h.stats.healDone, max.healDone)
         - 0.18 * n(h.deaths, max.deaths);
  },

  pickMvp(team) {
    const pool = Game.heroes.filter(h => team === undefined || h.team === team);
    if (!pool.length) return null;
    const max = {
      kills: Math.max(1, ...pool.map(h => h.kills)),
      assists: Math.max(1, ...pool.map(h => h.assists)),
      deaths: Math.max(1, ...pool.map(h => h.deaths)),
      dmgHero: Math.max(1, ...pool.map(h => h.stats.dmgHero)),
      dmgStruct: Math.max(1, ...pool.map(h => h.stats.dmgStruct)),
      dmgTaken: Math.max(1, ...pool.map(h => h.stats.dmgTaken)),
      healDone: Math.max(1, ...pool.map(h => h.stats.healDone)),
    };
    let best = pool[0], bs = -Infinity;
    for (const h of pool) {
      const sc = this.mvpScore(h, max);
      if (sc > bs) { bs = sc; best = h; }
    }
    return { hero: best, score: bs };
  },

  /* Gold-advantage graph. One filled path around a centre line: above the
     line is blue ahead, below is red. Absolute gold totals are far less
     useful here than the shape of the lead changing hands. */
  goldGraphSVG() {
    const hist = Game.goldHistory;
    if (!hist || hist.length < 2) return '';
    const W = 520, H = 76, mid = H / 2;
    const peak = Math.max(1200, ...hist.map(p => Math.abs(p.blue - p.red)));
    const x = i => (i / (hist.length - 1)) * W;
    const y = p => mid - ((p.blue - p.red) / peak) * (mid - 4);
    const pts = hist.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    const area = `${0},${mid} ${pts} ${W},${mid}`;
    const lead = hist[hist.length - 1].blue - hist[hist.length - 1].red;
    return `<svg class="goldGraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
              aria-label="Gold advantage over time">
        <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="${THEME.line}" stroke-width="1"/>
        <polygon points="${area}" fill="${rgba(lead >= 0 ? THEME.blue : THEME.red, 0.22)}"/>
        <polyline points="${pts}" fill="none" stroke="${lead >= 0 ? THEME.blue : THEME.red}"
                  stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <div class="graphCap">Gold advantage · peak ${Math.round(peak)}</div>`;
  },

  dmgGraphSVG() {
    const hist = typeof Features !== 'undefined' ? Features.dmgHistory : null;
    if (!hist || hist.length < 2) return '';
    const W = 520, H = 64, mid = H / 2;
    const peak = Math.max(400, ...hist.map(p => Math.abs(p.blue - p.red)));
    const x = i => (i / (hist.length - 1)) * W;
    const y = p => mid - ((p.blue - p.red) / peak) * (mid - 4);
    const pts = hist.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    return `<svg class="goldGraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="${THEME.line}" stroke-width="1"/>
        <polyline points="${pts}" fill="none" stroke="${THEME.gold}" stroke-width="2"/>
      </svg>
      <div class="graphCap">Hero damage advantage</div>`;
  },

  renderDeathRecap(recap) {
    const by = this.els.deathBy, box = this.els.deathRecap;
    if (!by || !box) return;
    if (!recap) { by.innerHTML = ''; box.innerHTML = ''; box.classList.add('hidden'); return; }
    const killer = recap.killer;
    by.innerHTML = killer
      ? `<span class="deathFace">${this.heroIcon(killer, 36)}</span> Slain by <b>${recap.by}</b>`
      : `Slain by <b>${recap.by}</b>`;
    const hits = (recap.hits || []).filter(r => r.h && r.amt > 0).slice(0, 4);
    box.innerHTML = hits.length
      ? hits.map(r => `<div class="deathHit">${this.heroIcon(r.h, 16)} ${r.h.name} <b>${Math.round(r.amt)}</b></div>`).join('')
      : '';
    box.classList.toggle('hidden', !hits.length);
  },

  showEnd(win) {
    const p = Game.player;
    this.els.end.classList.remove('hidden');
    this.toggleShop(false);
    const m = Math.floor(Game.time / 60), s = Math.floor(Game.time % 60);
    const clock = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const mvp = this.pickMvp(Game.lastWinner);

    if (Game.spectate) {
      this.els.endTitle.textContent = win ? 'BLUE TEAM WINS' : 'RED TEAM WINS';
    } else if (Game.isDuel()) {
      this.els.endTitle.textContent = win ? 'DUEL VICTORY' : 'DUEL DEFEAT';
    } else {
      this.els.endTitle.textContent = win ? 'VICTORY' : 'DEFEAT';
    }
    this.els.endTitle.className = win ? 'win' : 'lose';

    const maxDmg = Math.max(1, ...Game.heroes.map(h => h.stats.dmgHero));
    const rows = Game.heroes
      .slice().sort((a, b) => a.team - b.team || b.stats.dmgHero - a.stats.dmgHero)
      .map(h => `<div class="endRow${h.isPlayer ? ' you' : ''}">
          <span style="color:${TEAM_COLORS[h.team]}">${this.heroIcon(h, 18)} ${h.name} <small>Lv${h.level}</small>
            ${h === (mvp && mvp.hero) ? '<b class="mvpDot">MVP</b>' : ''}</span>
          <span class="endKda">${h.kills}/${h.deaths}/${h.assists}
            <small>${Math.round(h.stats.dmgHero)} dmg</small>
            <span class="sbBar"><i style="width:${h.stats.dmgHero / maxDmg * 100}%"></i></span></span>
        </div>`).join('');

    const mvpCard = mvp ? `<div class="endMvp">
        <span class="mvpIcon" style="--hc:${mvp.hero.color}">${this.heroIcon(mvp.hero, 40)}</span>
        <div>
          <div class="mvpTag">MVP · ${TEAM_NAMES[mvp.hero.team].toUpperCase()}</div>
          <div class="mvpName">${mvp.hero.name}</div>
          <div class="mvpLine">${mvp.hero.kills}/${mvp.hero.deaths}/${mvp.hero.assists} ·
            ${Math.round(mvp.hero.stats.dmgHero)} hero damage ·
            ${Math.round(mvp.hero.stats.dmgTaken)} taken${
              mvp.hero.stats.healDone > 50 ? ` · ${Math.round(mvp.hero.stats.healDone)} healed` : ''}</div>
          <div class="mvpItems">${mvp.hero.items.map(i => `<span title="${i.name}">${this.itemIcon(i, 20)}</span>`).join('') || '—'}</div>
        </div>
      </div>` : '';

    this.els.endStats.innerHTML = mvpCard + this.goldGraphSVG() + this.dmgGraphSVG() + `
      <div class="endRow"><span>Score</span><span>
        <span style="color:${TEAM_COLORS[0]}">${Game.kills[0]}</span> —
        <span style="color:${TEAM_COLORS[1]}">${Game.kills[1]}</span></span></div>
      <div class="endRow"><span>Match time</span><span>${clock}</span></div>
      ${p ? `<div class="endRow"><span>Your gold earned</span><span>${Math.floor(p.goldEarned)}</span></div>` : ''}
      ${typeof Features !== 'undefined' && Features.fightBest
        ? `<div class="endRow"><span>Biggest fight</span><span>${Features.fightBest} heroes · ${Math.floor(Features.fightAt / 60)}:${String(Math.floor(Features.fightAt % 60)).padStart(2, '0')}</span></div>` : ''}
      ${typeof Features !== 'undefined' ? `<div class="endAwards">${Features.awards().map(a =>
        `<span class="awardChip">${a.label}: ${a.hero.name}</span>`).join('')}</div>` : ''}
      ${rows}`;

    if (Game.spectate) SFX.victory();
    else if (win) SFX.victory(); else SFX.defeat();
  },
};
