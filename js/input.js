'use strict';
/* ============================================================
   input.js — floating joystick, skill buttons with drag-to-aim,
   mouse-linked attacks, keyboard fallback (WASD + 1/2/3 + click/Space + B)
   ============================================================ */

const Input = {
  keys: {},
  joy: { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 },
  aim: { active: false, source: null, id: null, keyCode: null, skill: -1, spell: false, startedAt: 0, cancelHover: false, dx: 0, dy: 0, dist: 0 },
  mouse: { x: innerWidth / 2, y: innerHeight / 2, seen: false },
  releaseAim: false,
  targetPriority: 'lowHp',
  lockedTarget: null,
  attackHeld: false, attackPointer: null, attackKey: null, attackMode: 'auto',
  casts: [],           // queued {skill, dir|null, dist}
  recallQueued: false, spellQueued: null,
  JOY_MAX: 60,
  QUICK_CAST_MS: 180,

  moveVector() {
    if (this.joy.active) {
      const m = Math.hypot(this.joy.dx, this.joy.dy);
      if (m > 8) { const c = Math.min(1, m / this.JOY_MAX); return { x: this.joy.dx / m * c, y: this.joy.dy / m * c }; }
      return null;
    }
    let x = 0, y = 0;
    if (this.keys['w'] || this.keys['arrowup']) y -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) y += 1;
    if (this.keys['a'] || this.keys['arrowleft']) x -= 1;
    if (this.keys['d'] || this.keys['arrowright']) x += 1;
    if (x || y) return norm(x, y);
    return null;
  },

  loadSettings() {
    try {
      const stored = localStorage.getItem('legends.releaseAim');
      if (stored === null) {
        // Desktop: aim with the mouse by default. Touch keeps quick-cast taps.
        this.releaseAim = window.matchMedia('(pointer: fine)').matches;
      } else {
        this.releaseAim = stored === '1';
      }
      const priority = localStorage.getItem('legends.targetPriority');
      this.targetPriority = priority === 'nearest' ? 'nearest' : 'lowHp';
    } catch (e) {
      this.releaseAim = false;
      this.targetPriority = 'lowHp';
    }
  },

  isFinePointer() {
    try { return window.matchMedia('(pointer: fine)').matches; }
    catch (e) { return false; }
  },

  setReleaseAim(enabled) {
    this.releaseAim = !!enabled;
    if (!this.releaseAim && this.aim.source === 'keyboard') this.cancelAim();
    try { localStorage.setItem('legends.releaseAim', this.releaseAim ? '1' : '0'); }
    catch (e) { /* storage can be unavailable in private/local-file contexts */ }
  },

  setTargetPriority(value) {
    this.targetPriority = value === 'nearest' ? 'nearest' : 'lowHp';
    try { localStorage.setItem('legends.targetPriority', this.targetPriority); }
    catch (e) { /* storage can be unavailable in private/local-file contexts */ }
  },

  setLockedTarget(target) {
    this.lockedTarget = this.lockedTarget === target ? null : target;
    if (Game.player) Game.player.curTarget = this.lockedTarget;
  },

  /* World-space point under the mouse. Null on touch so mobile keeps the
     original auto-target. */
  aimPoint() {
    if (!this.mouse.seen || !this.isFinePointer() || !Game || !Game.cam) return null;
    if (typeof Game.screenToWorld === 'function') return Game.screenToWorld(this.mouse.x, this.mouse.y);
    return null;
  },

  clearTargetLock() { this.lockedTarget = null; },

  clearAimButton() {
    document.querySelectorAll('.skillBtn').forEach(b => b.classList.remove('aiming'));
  },

  showCancelZone(show) {
    const zone = document.getElementById('aimCancelZone');
    if (!zone) return;
    zone.classList.toggle('hidden', !show);
    if (!show) zone.classList.remove('hot');
  },

  updateCancelHover(x, y) {
    const zone = document.getElementById('aimCancelZone');
    if (!zone || !this.aim.active) return false;
    const r = zone.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    this.aim.cancelHover = over;
    zone.classList.toggle('hot', over);
    return over;
  },

  cancelAim() {
    this.aim.active = false;
    this.aim.source = null;
    this.aim.id = null;
    this.aim.keyCode = null;
    this.aim.skill = -1;
    this.aim.spell = false;
    this.aim.startedAt = 0;
    this.aim.cancelHover = false;
    this.aim.dx = this.aim.dy = this.aim.dist = 0;
    this.clearAimButton();
    this.showCancelZone(false);
  },

  updateKeyboardAim(x = this.mouse.x, y = this.mouse.y) {
    if (!this.aim.active || this.aim.source !== 'keyboard' || !Game.player) return;
    if (this.mouse.seen) {
      const zoom = Game.cam && Game.cam.zoom ? Game.cam.zoom : 1;
      const px = innerWidth / 2 + (Game.player.x - Game.cam.x) * zoom;
      const py = innerHeight / 2 + (Game.player.y - Game.cam.y) * zoom;
      this.aim.dx = x - px;
      this.aim.dy = y - py;
    } else {
      this.aim.dx = Math.cos(Game.player.facing) * 100;
      this.aim.dy = Math.sin(Game.player.facing) * 100;
    }
    this.aim.dist = Math.hypot(this.aim.dx, this.aim.dy);
  },

  beginKeyboardAim(skill, keyCode, spell = false) {
    if (this.aim.active) return;
    this.aim.active = true;
    this.aim.source = 'keyboard';
    this.aim.id = null;
    this.aim.keyCode = keyCode;
    this.aim.skill = skill;
    this.aim.spell = spell;
    this.aim.startedAt = performance.now();
    this.aim.cancelHover = false;
    this.updateKeyboardAim();
    const btn = document.getElementById(spell ? 'btnSpell' : 'btnS' + skill);
    if (btn) btn.classList.add('aiming');
    this.showCancelZone(true);
  },

  finishKeyboardAim(keyCode) {
    const a = this.aim;
    if (!a.active || a.source !== 'keyboard' || a.keyCode !== keyCode) return false;
    // A tap keeps the original quick-cast/auto-aim behavior. Only a deliberate
    // hold commits the mouse direction when the key is released.
    const heldLongEnough = performance.now() - a.startedAt >= this.QUICK_CAST_MS;
    const dir = heldLongEnough && a.dist > 28 ? norm(a.dx, a.dy) : null;
    if (a.spell) this.spellQueued = { dir, dist: a.dist };
    else this.casts.push({ skill: a.skill, dir, dist: a.dist });
    this.cancelAim();
    return true;
  },

  init() {
    this.loadSettings();
    const joyZone = document.getElementById('joyZone');
    const joyBase = document.getElementById('joyBase');
    const joyKnob = document.getElementById('joyKnob');

    // Right-click is the fast cancel gesture for any active aimed cast.
    document.addEventListener('pointerdown', e => {
      if (e.button !== 2 || !this.aim.active) return;
      this.cancelAim();
      e.preventDefault(); e.stopPropagation();
    }, true);

    const setKnob = () => {
      const m = Math.hypot(this.joy.dx, this.joy.dy);
      const c = m > this.JOY_MAX ? this.JOY_MAX / m : 1;
      joyKnob.style.transform = `translate(${this.joy.dx * c}px, ${this.joy.dy * c}px)`;
    };

    joyZone.addEventListener('pointerdown', e => {
      // Mouse on desktop uses WASD — don't steal left-side clicks for the stick.
      if (this.isFinePointer() && e.pointerType === 'mouse') return;
      if (this.joy.active) return;
      SFX.ensure();
      this.joy.active = true; this.joy.id = e.pointerId;
      this.joy.cx = e.clientX; this.joy.cy = e.clientY;
      this.joy.dx = 0; this.joy.dy = 0;
      joyBase.classList.remove('hidden');
      joyBase.style.left = e.clientX + 'px';
      joyBase.style.top = e.clientY + 'px';
      setKnob();
      e.preventDefault();
    });

    const canvas = document.getElementById('game');
    if (canvas) {
      canvas.addEventListener('pointerdown', e => {
        if (Game.state !== 'play' || Game.spectate || !Game.player) return;
        if (e.button !== 0 || e.pointerType !== 'mouse' || !this.isFinePointer()) return;
        if (this.aim.active) return;
        SFX.ensure();
        this.attackHeld = true;
        this.attackPointer = e.pointerId;
        this.attackMode = 'auto';
      });
    }

    document.addEventListener('pointermove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
      if (this.joy.active && e.pointerId === this.joy.id) {
        this.joy.dx = e.clientX - this.joy.cx;
        this.joy.dy = e.clientY - this.joy.cy;
        setKnob();
      }
      if (this.aim.active && this.aim.source === 'pointer' && e.pointerId === this.aim.id) {
        this.aim.dx = e.clientX - this.aim.cx;
        this.aim.dy = e.clientY - this.aim.cy;
        this.aim.dist = Math.hypot(this.aim.dx, this.aim.dy);
      }
      if (this.aim.active && this.aim.source === 'keyboard') this.updateKeyboardAim(e.clientX, e.clientY);
      if (this.aim.active) this.updateCancelHover(e.clientX, e.clientY);
    });

    const endPointer = (e, cancelled = false) => {
      if (this.joy.active && e.pointerId === this.joy.id) {
        this.joy.active = false; this.joy.id = null;
        this.joy.dx = this.joy.dy = 0;
        joyBase.classList.add('hidden');
      }
      if (this.aim.active && this.aim.source === 'pointer' && e.pointerId === this.aim.id) {
        const a = this.aim;
        if (cancelled || a.cancelHover || this.updateCancelHover(e.clientX, e.clientY)) {
          this.cancelAim();
          return;
        }
        const dir = a.dist > 28 ? norm(a.dx, a.dy) : null;
        if (a.spell) this.spellQueued = { dir, dist: a.dist };
        else this.casts.push({ skill: a.skill, dir, dist: a.dist });
        this.cancelAim();
      }
      if (this.attackPointer === e.pointerId) {
        this.attackPointer = null;
        if (!this.attackKey) { this.attackHeld = false; this.attackMode = 'auto'; }
      }
    };
    document.addEventListener('pointerup', e => endPointer(e));
    document.addEventListener('pointercancel', e => endPointer(e, true));

    // skill buttons 0,1,2
    for (let i = 0; i < 3; i++) {
      const btn = document.getElementById('btnS' + i);
      // Touch has no Shift key. The visible + button is the primary rank-up
      // control; the pips remain a secondary target for existing players.
      btn.addEventListener('pointerdown', e => {
        if (!e.target.closest || !e.target.closest('.rankUpBtn, .rankPips')) return;
        if (Game.player && Game.player.canRankUp(i)) {
          Game.player.rankUp(i);
          e.preventDefault(); e.stopPropagation();
        }
      }, true);
      btn.addEventListener('pointerdown', e => {
        SFX.ensure();
        if (this.aim.active) return;
        const r = btn.getBoundingClientRect();
        this.aim.active = true; this.aim.source = 'pointer'; this.aim.id = e.pointerId; this.aim.skill = i;
        this.aim.spell = false; this.aim.keyCode = null;
        this.aim.cancelHover = false;
        this.aim.cx = r.left + r.width / 2; this.aim.cy = r.top + r.height / 2;
        this.aim.dx = e.clientX - this.aim.cx; this.aim.dy = e.clientY - this.aim.cy;
        this.aim.dist = Math.hypot(this.aim.dx, this.aim.dy);
        btn.classList.add('aiming');
        this.showCancelZone(true);
        e.preventDefault(); e.stopPropagation();
      });
    }

    const bindAttack = (id, mode) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('pointerdown', e => {
        SFX.ensure();
        this.attackHeld = true; this.attackPointer = e.pointerId; this.attackMode = mode;
        e.preventDefault(); e.stopPropagation();
      });
    };
    bindAttack('btnAtk', 'auto');
    bindAttack('btnHeroAtk', 'hero');
    bindAttack('btnLaneAtk', 'lane');

    document.getElementById('btnRecall').addEventListener('pointerdown', e => {
      this.recallQueued = true;
      e.preventDefault(); e.stopPropagation();
    });

    const btnSpell = document.getElementById('btnSpell');
    btnSpell.addEventListener('pointerdown', e => {
      SFX.ensure();
      if (this.aim.active) return;
      // Drag-aim Flicker (and any future directed spells); tap still auto-aims.
      const r = btnSpell.getBoundingClientRect();
      this.aim.active = true; this.aim.source = 'pointer'; this.aim.id = e.pointerId;
      this.aim.skill = -1; this.aim.spell = true; this.aim.keyCode = null;
      this.aim.cancelHover = false;
      this.aim.cx = r.left + r.width / 2; this.aim.cy = r.top + r.height / 2;
      this.aim.dx = e.clientX - this.aim.cx; this.aim.dy = e.clientY - this.aim.cy;
      this.aim.dist = Math.hypot(this.aim.dx, this.aim.dy);
      btnSpell.classList.add('aiming');
      this.showCancelZone(true);
      e.preventDefault(); e.stopPropagation();
    });

    // keyboard
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (typeof Features !== 'undefined' && Features.handleKey(k, e)) { e.preventDefault(); return; }
      if (k === 'm') SFX.toggle();
      // Tab toggles the scoreboard in every mode, including spectating
      if (k === 'tab') { e.preventDefault(); UI.toggleScoreboard(true); return; }
      if (Game.state !== 'play' || !Game.player) return;
      /* Shift changes e.key from "1/2/3" into "!/@/#" on standard keyboard
         layouts. e.code remains Digit1/Digit2/Digit3, so use the physical key
         code for rank-up shortcuts. */
      const rankKey = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
      if (e.shiftKey && rankKey !== undefined) {
        e.preventDefault();
        Game.player.rankUp(rankKey);
        return;
      }
      const skillKey = { Digit1: 0, Digit2: 1, Digit3: 2, KeyJ: 0, KeyK: 1, KeyL: 2 }[e.code];
      if (skillKey !== undefined) {
        e.preventDefault();
        if (this.releaseAim) {
          if (!e.repeat) this.beginKeyboardAim(skillKey, e.code);
        } else if (!e.repeat) this.casts.push({ skill: skillKey, dir: null });
      }
      if (k === ' ') {
        // attack in place — playerThink will not chase on this key
        this.attackHeld = true; this.attackKey = e.code; this.attackMode = 'auto'; e.preventDefault();
      }
      if (e.code === 'KeyG' || e.code === 'KeyT') {
        this.attackHeld = true; this.attackKey = e.code;
        this.attackMode = e.code === 'KeyG' ? 'hero' : 'lane';
        e.preventDefault();
      }
      if (k === 'b') this.recallQueued = true;
      if (k === 'f') {                                // battle spell
        e.preventDefault();
        if (this.releaseAim) {
          if (!e.repeat) this.beginKeyboardAim(-1, e.code, true);
        } else if (!e.repeat) this.spellQueued = { dir: null, dist: 0 };
      }
      if (k === 'p') UI.toggleShop();                  // shop
      if (k === 'v') UI.els.pingWheel.classList.toggle('hidden');
      // quick pings without opening the wheel
      if (k === 'z') UI.sendPing('danger');
      if (k === 'x') UI.sendPing('retreat');
      if (k === 'c') UI.sendPing('gather');
      if (e.code === 'Enter' && typeof Mlbb !== 'undefined') {
        e.preventDefault();
        Mlbb.toggleChatWheel();
      }
      if (k === 'escape') {
        this.cancelAim(); this.clearTargetLock();
        UI.closePingWheel(); UI.toggleShop(false); UI.toggleSettings(false);
      }
    });
    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      if (this.releaseAim) this.finishKeyboardAim(e.code);
      if (k === 'tab') { UI.toggleScoreboard(false); return; }
      if (e.code === this.attackKey) {
        this.attackKey = null;
        if (this.attackPointer === null) { this.attackHeld = false; this.attackMode = 'auto'; }
      }
      if (k === 'q' && typeof Features !== 'undefined') Features.attackMove = false;
    });

    window.addEventListener('blur', () => {
      this.cancelAim();
      this.attackHeld = false; this.attackPointer = null; this.attackKey = null; this.attackMode = 'auto';
    });

    document.addEventListener('contextmenu', e => e.preventDefault());
  },
};
