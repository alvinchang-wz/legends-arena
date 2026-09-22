'use strict';
/* ============================================================
   screens.js — the out-of-match flow.

     title  →  lobby  ⇄  modes
                 ↓
               pick  →  (match)  →  end  →  lobby

   Screens own the DOM sections in index.html that are not the HUD.
   ui.js still builds the roster, draft slots and loadout pickers
   inside the pick screen; this file decides which screen is on
   top, what the lobby shows, and which mode the START button fires.

   Behind every menu the real engine runs a bot-vs-bot match in
   "attract" mode (Game.attract) so the first thing a player sees
   is the game itself. It is muted, HUD-less, drawn at half rate,
   and replaced the moment a real match starts.
   ============================================================ */

const Screens = {
  VERSION: '0.9.0',

  MODES: {
    standard: {
      name: 'CLASSIC 5V5', short: 'CLASSIC', color: '#ffc94a', em: '⚔', icon: 'misc:attack',
      desc: 'Three lanes, a jungle, Turtle and Lord. Destroy the enemy base.',
      meta: ['5 V 5', 'DAWN BOARD', '12-18 MIN'],
    },
    ten: {
      name: 'CALDERA 10V10', short: 'CALDERA', color: '#ff9d5c', em: '🌋', icon: null,
      desc: 'Twenty heroes on the Auric Caldera: four outer roads around a molten crater.',
      meta: ['10 V 10', 'AURIC CALDERA', 'LONG'],
    },
    duel: {
      name: '1V1 DUEL', short: 'DUEL', color: '#a78bfa', em: '🗡', icon: null,
      desc: 'You against one hero on the duel ground, with a rune shrine to fight over. First to 5 kills.',
      meta: ['1 V 1', 'DUEL GROUND', '~5 MIN'],
    },
  },

  current: null,
  mode: 'standard',
  spectate: false,
  pendingMode: null,      // card highlighted on the mode screen before CONFIRM
  pendingSpectate: false,
  els: {},
  _attractTimer: null,

  /* ---------------- boot ---------------- */
  init() {
    const $ = id => document.getElementById(id);
    this.app = $('app');
    this.screens = [...document.querySelectorAll('.screen')];
    for (const id of ['title', 'lobby', 'modes', 'pick', 'pfAvatar', 'pfName', 'pfSub', 'pfRecord',
      'scRing', 'scName', 'scRole', 'showcase', 'lbMode', 'lbModeName', 'lbStart', 'lbHeroes', 'lbHistory',
      'lbNews', 'lbSpectate', 'lbSettings', 'lbProfile', 'matchHist', 'histModal', 'histList', 'histClose',
      'modeCards', 'specCards', 'btnModeConfirm', 'pickPhase', 'btnStart', 'btnHome', 'btnAgain',
      'modalBackdrop', 'whatsNew', 'titleVer']) this.els[id] = $(id);

    try { this.prefs = JSON.parse(localStorage.getItem('legends.profile') || '{}'); } catch (e) { this.prefs = {}; }
    if (this.els.titleVer) this.els.titleVer.textContent = 'v' + this.VERSION;

    // title: any tap or Enter continues
    const go = () => { SFX.ensure(); this.show('lobby'); };
    // 'click', not 'pointerup': the lobby appears under the finger synchronously and
    // a pointerup-driven switch would let the same tap click the lobby's showcase.
    this.els.title.addEventListener('click', go);
    window.addEventListener('keydown', e => {
      if (this.current === 'title' && (e.code === 'Enter' || e.code === 'Space')) { go(); e.preventDefault(); return; }
      if (e.code === 'Escape' && this.current && this.current !== 'title') {
        if (!this.closeModals()) this.back();
      }
    });

    // lobby
    this.els.lbStart.addEventListener('click', () => this.show('pick'));
    this.els.lbMode.addEventListener('click', () => this.show('modes'));
    this.els.lbHeroes.addEventListener('click', () => this.show('pick'));
    this.els.showcase.addEventListener('click', () => this.show('pick'));
    this.els.lbSpectate.addEventListener('click', () => { this.pendingSpectate = true; this.show('modes'); });
    this.els.lbHistory.addEventListener('click', () => this.openModal(this.els.histModal));
    this.els.lbNews.addEventListener('click', () => this.openModal(this.els.whatsNew));
    this.els.lbSettings.addEventListener('click', () => { this.closeModals(); UI.toggleSettings(true); });
    this.els.lbProfile.addEventListener('click', () => this.renameProfile());
    if (this.els.histClose) this.els.histClose.addEventListener('click', () => this.closeModals());
    this.els.modalBackdrop.addEventListener('click', () => { this.closeModals(); UI.toggleSettings(false); });

    // modes
    this.buildModeCards();
    this.els.btnModeConfirm.addEventListener('click', () => this.confirmMode());

    // pick + end
    for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => this.back());
    this.els.btnStart.addEventListener('click', () => this.launch());
    if (this.els.btnHome) this.els.btnHome.addEventListener('click', () => UI.returnToSelect());
    if (this.els.btnAgain) this.els.btnAgain.addEventListener('click', () => { UI.returnToSelect(); this.show('pick'); });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.initGate();
    this.show(this.gateLocked() ? 'gate' : 'title');
  },

  /* ---------------- passphrase gate ----------------
     The hosted build carries <meta name="legends-gate" content="<sha256>">
     (see scripts/build-www.js). Local dev and the Android app carry no meta,
     so they never see this screen. The hash is public: this keeps strangers
     out, it is not a substitute for a server-side login. */
  GATE_SALT: 'legends-arena:gate:v1:',
  gateHash() {
    const m = document.querySelector('meta[name="legends-gate"]');
    return m ? m.content : null;
  },
  gateLocked() {
    const hash = this.gateHash();
    if (!hash) return false;
    try { return localStorage.getItem('legends.gate') !== hash; } catch (e) { return true; }
  },
  initGate() {
    const form = document.getElementById('gateForm');
    if (!form) return;
    const input = document.getElementById('gateInput');
    const msg = document.getElementById('gateMsg');
    // The in-game hotkey handlers listen on window; keep typing out of them,
    // and submit on Enter ourselves since they may swallow the key.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, e => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
      });
    }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const expected = this.gateHash();
      if (!expected || !window.crypto || !crypto.subtle) { this.show('title'); return; }
      const bytes = new TextEncoder().encode(this.GATE_SALT + input.value.trim());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hex === expected) {
        try { localStorage.setItem('legends.gate', expected); } catch (err) { /* session only */ }
        SFX.ensure();
        this.show('title');
      } else {
        msg.textContent = 'That passphrase is not right.';
        input.select();
      }
    });
  },

  /* Menu scale: author at 1280x720, fit the short edge, never let a phone
     shrink tap targets below ~60% (a 92px hero card stays ≥ 55px). */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const s = clamp(Math.min(w / 1280, h / 720), 0.6, 1.3);
    document.documentElement.style.setProperty('--ms', s.toFixed(3));
  },

  /* ---------------- routing ---------------- */
  show(name) {
    for (const s of this.screens) s.hidden = s.id !== name;
    this.current = name;
    this.closeModals();
    UI.toggleSettings(false);
    this.app.classList.add('inMenu');
    this.app.classList.toggle('onTitle', name === 'title');
    if (!Game.attract && Game.state !== 'play') this.attractStart();
    if (name === 'lobby') this.syncLobby();
    else if (name === 'modes') this.syncModes();
    else if (name === 'pick') this.syncPick();
  },

  hideAll() {
    for (const s of this.screens) s.hidden = true;
    this.current = null;
    this.closeModals();
    this.app.classList.remove('inMenu', 'onTitle');
  },

  back() {
    if (this.current === 'pick' || this.current === 'modes') this.show('lobby');
  },

  openModal(el) {
    if (!el) return;
    this.closeModals();
    el.classList.remove('hidden');
    this.els.modalBackdrop.classList.remove('hidden');
  },
  closeModals() {
    let any = false;
    for (const el of document.querySelectorAll('.modal')) {
      if (!el.classList.contains('hidden')) any = true;
      el.classList.add('hidden');
    }
    this.els.modalBackdrop.classList.add('hidden');
    return any;
  },

  /* ---------------- lobby ---------------- */
  readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
  },

  /* Only real results. Rows written before Features.recordMatch existed can
     be a hero with an empty scoreline and a zero clock — an abandoned or
     spectated match that was saved anyway — and they are still in players'
     local storage, so they are filtered here as well as at the source. */
  history() {
    const floor = (typeof Features !== 'undefined' && Features.MIN_MATCH_SECONDS) || 30;
    return this.readJSON('legends.history', []).filter(r => r && r.hero && (r.clock || 0) >= floor);
  },

  featuredHero() {
    const hist = this.history();
    const byId = id => HEROES.find(h => h.id === id);
    const last = hist.length ? byId(hist[0].hero) : null;
    if (last) return last;
    const fav = this.readJSON('legends.favHeroes', []);
    if (fav.length) { const h = byId(fav[fav.length - 1]); if (h) return h; }
    // rotate the featured hero daily so the lobby is not the same every launch
    const day = Math.floor(Date.now() / 86400000);
    return HEROES[day % HEROES.length];
  },

  syncLobby() {
    const e = this.els;
    const hero = this.featuredHero();
    const mastery = this.readJSON('legends.mastery', {});
    const played = Object.values(mastery).reduce((a, b) => a + b, 0);
    const hist = this.history();
    const wins = hist.filter(r => r.win).length;

    e.pfName.textContent = (this.prefs.name || 'PLAYER').toUpperCase();
    e.pfSub.textContent = `Level ${1 + Math.floor(played / 2)} · ${played} match${played === 1 ? '' : 'es'}`;
    e.pfRecord.textContent = hist.length ? `${wins}W · ${hist.length - wins}L recent` : 'NO RESULTS YET';
    e.pfAvatar.style.setProperty('--hc', hero.color);
    e.pfAvatar.innerHTML = UI.heroIcon(hero, 40);

    e.showcase.style.setProperty('--hc', hero.color);
    e.scRing.innerHTML = UI.heroIcon(hero, 180);
    e.scName.textContent = hero.name.toUpperCase();
    e.scRole.textContent = `${hero.role.toUpperCase()} · ${hero.damageStyle.toUpperCase()}`;

    const m = this.MODES[this.mode];
    e.lbModeName.textContent = this.spectate ? `WATCH ${m.short}` : m.name;
    e.lbStart.textContent = this.spectate ? 'WATCH' : 'START';
    this.renderHistory();
  },

  renderHistory() {
    const hist = this.history();
    const modeName = m => (this.MODES[m] ? this.MODES[m].short : (m || '').toUpperCase());
    const html = hist.length ? hist.map(r => {
      const h = HEROES.find(x => x.id === r.hero);
      const mins = Math.floor((r.clock || 0) / 60);
      return `<div class="histRow ${r.win ? 'win' : 'lose'}">
        <span class="hrIco">${h ? UI.heroIcon(h, 30) : ''}</span>
        <span><b>${h ? h.name : r.hero}</b><small>${r.kda || ''} · ${mins} min · ${modeName(r.mode)}</small></span>
        <span class="hrRes">${r.win ? 'WIN' : 'LOSS'}</span></div>`;
    }).join('') : '<div class="histEmpty">Your recent matches will show up here.</div>';
    if (this.els.matchHist) this.els.matchHist.innerHTML = html;
    if (this.els.histList) this.els.histList.innerHTML = html;
  },

  renameProfile() {
    const cur = this.prefs.name || 'Player';
    const name = window.prompt('Your name', cur);
    if (name == null) return;
    this.prefs.name = name.trim().slice(0, 16) || cur;
    try { localStorage.setItem('legends.profile', JSON.stringify(this.prefs)); } catch (e) { /* ignore */ }
    this.syncLobby();
  },

  /* ---------------- modes ---------------- */
  buildModeCards() {
    const card = (id, m, spectate) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modeCard' + (spectate ? ' spec' : '');
      b.style.setProperty('--mc', m.color);
      b.dataset.mode = id; b.dataset.spec = spectate ? '1' : '';
      b.innerHTML = `<span class="mcIco">${spectate ? '👁' : (m.icon && typeof Icons !== 'undefined' && Icons.has(m.icon) ? Icons.img(m.icon, 40) : m.em)}</span>
        <b>${spectate ? 'WATCH ' + m.short : m.name}</b>
        <small>${spectate ? 'Sit back and watch the bots play a full match.' : m.desc}</small>
        ${spectate ? '' : `<span class="mcMeta">${m.meta.map(t => `<span>${t}</span>`).join('')}</span>`}`;
      b.addEventListener('click', () => {
        if (this.pendingMode === id && this.pendingSpectate === spectate) { this.confirmMode(); return; }
        this.pendingMode = id; this.pendingSpectate = spectate;
        this.paintModes();
      });
      return b;
    };
    for (const [id, m] of Object.entries(this.MODES)) this.els.modeCards.appendChild(card(id, m, false));
    for (const id of ['standard', 'ten']) this.els.specCards.appendChild(card(id, this.MODES[id], true));
  },

  syncModes() {
    this.pendingMode = this.mode;
    if (!this.pendingSpectate) this.pendingSpectate = this.spectate;
    this.paintModes();
  },

  paintModes() {
    for (const b of document.querySelectorAll('.modeCard')) {
      b.classList.toggle('sel', b.dataset.mode === this.pendingMode && !!b.dataset.spec === this.pendingSpectate);
    }
  },

  confirmMode() {
    this.mode = this.pendingMode || 'standard';
    this.spectate = this.pendingSpectate;
    this.pendingSpectate = false;
    this.show('lobby');
  },

  /* ---------------- pick ---------------- */
  syncPick() {
    const pick = this.els.pick;
    const m = this.MODES[this.mode];
    UI.setDraftSize(this.mode === 'ten' ? 10 : 5);
    pick.classList.toggle('spectating', this.spectate);
    pick.classList.toggle('duelDraft', this.mode === 'duel');
    this.els.pickPhase.textContent = this.spectate ? `SET THE LINEUPS · ${m.short}` : `PICK YOUR HERO · ${m.short}`;
    this.els.btnStart.textContent = this.spectate ? 'WATCH MATCH' : this.mode === 'duel' ? 'START DUEL' : 'ENTER BATTLE';
    this.syncConfirm();
    UI.renderDraft();
    if (typeof Mlbb !== 'undefined') Mlbb.paintBans();
  },

  syncConfirm() {
    if (!this.els.btnStart) return;
    this.els.btnStart.disabled = !this.spectate && !UI.selectedHero;
  },

  launch() {
    if (!this.spectate && !UI.selectedHero) return;
    this.attractStop();
    this.hideAll();
    UI.launch(this.mode, this.spectate);
  },

  /* ---------------- attract mode ----------------
     A bot match behind the menus. Cheap on purpose: standard map only,
     heuristic bots, no HUD sync work, camera drifting between heroes. */
  attractStart() {
    if (typeof REDUCE_MOTION !== 'undefined' && REDUCE_MOTION) { this.app.classList.add('noAttract'); return; }
    this.app.classList.remove('noAttract');
    Game.attract = true;
    Game.mode = 'standard';
    Game.draft = null;
    Game.botTypes = null;
    Game.simSpeed = 1;
    Game.autoTrain = false;
    Game.start(null);
    Game.cam.zoom = 0.5; Game.cam.zoomWant = 0.62;
    this.attractFollow();
    clearInterval(this._attractTimer);
    this._attractTimer = setInterval(() => this.attractFollow(), 7000);
  },

  attractFollow() {
    if (!Game.attract || Game.state !== 'play') return;
    const alive = Game.heroes.filter(h => h.alive);
    if (!alive.length) return;
    // prefer heroes that are actually fighting so the background has action in it
    const busy = alive.filter(h => h.curTarget || (h.lastHitT != null && Game.time - h.lastHitT < 3));
    const pool = busy.length ? busy : alive;
    Game.followHero = pool[Math.floor(Math.random() * pool.length)];
    Game.cam.zoomWant = 0.55 + Math.random() * 0.2;
  },

  /* Called by Game.endGame when an attract match finishes: roll another one. */
  attractRestart() {
    if (!Game.attract || !this.current) return;
    Game.state = 'select';
    this.attractStart();
  },

  attractStop() {
    clearInterval(this._attractTimer);
    this._attractTimer = null;
    if (Game.attract) {
      Game.attract = false;
      Game.followHero = null;
      Game.state = 'select';
    }
  },
};
