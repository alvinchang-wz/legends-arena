'use strict';
/* ============================================================
   mlbb.js — fifty Mobile Legends match systems.

   The replica already had a MOBA loop. This pack is the MLBB-shaped
   layer on top: battle spells, Retribution evolves, bush stealth,
   role blessings, kill slogans, and the HUD callouts that make a
   5v5 read like that game rather than a League clone.
   ============================================================ */

const MLBB_CATALOG = [
  'Flameshot battle spell',
  'Arrival battle spell',
  'Icequake battle spell',
  'Weaken battle spell',
  'Revitalize battle spell',
  'Ice Retribution evolve',
  'Flame Retribution evolve',
  'Bloody Retribution evolve',
  'Retribution evolve picker',
  'Flicker through walls',
  'Roaming Blessing',
  'Jungle Blessing',
  'Roam gold from nearby last-hits',
  'Proximity assists',
  'Bush stealth',
  'Same-bush reveal',
  'Damage reveals from a bush',
  'Close-range brush check',
  'Killing Spree through Beyond Godlike',
  'You / ally / enemy slain callouts',
  'First turret gold and banner',
  'Buff stolen announcement',
  'Objective stolen announcement',
  'Turtle and Lord spawn warning',
  'Epic has spawned banner',
  'Global Turtle / Lord HP bar',
  'Ally death timers on portraits',
  'Ally battle-spell gems',
  'Click an ally portrait to ping On My Way',
  'Scoreboard shows spell and emblem',
  'Minimap ult-ready pip',
  'Retribution execute pip on camps',
  'Recommended six-item path',
  'Ban one hero per side',
  'Lane adjust (swap Blue slots)',
  'Skill 1 starts learned',
  'Skill 2 unlocks at level 2',
  'Six-second recall',
  'Arrival cancelled by damage',
  'Fountain regen surge',
  '2.5s spawn protection',
  'AFK bot takeover',
  'Quick chat: Request backup',
  'Quick chat: Group for Turtle',
  'Quick chat: Push now',
  'Quick chat: Be careful',
  'Quick chat: Nice',
  'Turtle and Lord pings',
  'Bots ping when they start an epic',
  'Kill-feed shows the slayer’s battle spell',
];

const RETRI_EVOLVES = {
  ice:    { name: 'Ice Retribution',   icon: '❄', desc: 'Retribution also slows the target by 40% for 2s.' },
  flame:  { name: 'Flame Retribution', icon: '🔥', desc: 'Retribution burns the target for 180 true damage over 3s.' },
  bloody: { name: 'Bloody Retribution', icon: '🩸', desc: 'Retribution heals you for 12% of your max health.' },
};

const MLBB_CHAT = [
  { id: 'backup',  text: 'Request backup!',     ping: 'help' },
  { id: 'turtle',  text: 'Group for Turtle!',   ping: 'turtle' },
  { id: 'push',    text: 'Push now!',           ping: 'attack' },
  { id: 'careful', text: 'Be careful!',         ping: 'careful' },
  { id: 'nice',    text: 'Nice!',               ping: null },
];

const STREAK_NAMES = {
  3: 'Killing Spree',
  4: 'Rampage',
  5: 'Unstoppable',
  6: 'Dominating',
  7: 'Godlike',
  8: 'Legendary',
};

const Mlbb = {
  bans: [null, null],
  banMode: null,          // TEAM_BLUE | TEAM_RED | null
  evolveShown: false,
  spawnWarned: { turtle: false, lord: false },
  spawnBannered: { turtle: false, lord: false },
  botEpicPingAt: 0,

  onMatchStart() {
    this.evolveShown = false;
    this.spawnWarned = { turtle: false, lord: false };
    this.spawnBannered = { turtle: false, lord: false };
    this.botEpicPingAt = 0;
    Game.firstTurret = false;
    for (const h of Game.heroes) this.prepHero(h);
    this.hideEvolve();
    this.hideChatWheel();
  },

  prepHero(h) {
    h.retriEvolve = h.retriEvolve || null;
    h.jungleHits = h.jungleHits || 0;
    h.revealT = 0;
    h.arrivalT = 0;
    h.arrivalDest = null;
    h.aiTakeover = false;
    h.marks = h.marks || {};
    /* MLBB hands you skill 1 at spawn. Skill 2 waits for level 2; ult for 4. */
    if (h.skillRank[0] === 0 && h.skillPoints > 0) {
      h.skillRank[0] = 1;
      h.skillPoints--;
    }
    if (!h.isPlayer && h.lane === 'roam' && SPELL_BY_ID.revitalize)
      h.spell = SPELL_BY_ID.revitalize;
  },

  update(dt) {
    if (Game.state !== 'play' || Game.paused) return;
    for (const h of Game.heroes) {
      if (h.arrivalT > 0) this.tickArrival(h, dt);   // revealT ticks in Hero.update (core rule)
    }
    this.tickEvolveUnlock();
    this.tickEpicClocks();
    this.tickAfkTakeover(dt);
    this.tickBotEpicPing();
    this.syncEpicBar();
    this.syncRetriPips();
  },

  /* ---------- vision: bushes hide you unless sharing, close, or revealed ---------- */
  bushHiddenFrom(team, u) {
    if (!u || u.bush < 0 || u.isStructure) return false;
    if (u.team === team) return false;
    if (Game.isDuel && Game.isDuel()) return false;
    if (u.revealT > 0) return false;
    let close = false, same = false;
    for (const h of Game.heroes) {
      if (h.team !== team || !h.alive) continue;
      if (h.bush === u.bush) same = true;
      if (dist(h, u) < 72) close = true;
    }
    return !same && !close;
  },

  onDamaged(u) {
    if (u && u.type === 'hero') u.revealT = 1.6;
    if (u && u.arrivalT > 0) {
      u.arrivalT = 0; u.arrivalDest = null;
      if (u.isPlayer) UI.announce('Arrival interrupted!', 'minor');
    }
  },

  /* ---------- economy / roles ----------
     Every economy rule (minion share, roam and jungle roles, proximity
     assists, first-turret gold) lives in entities.js / data.js so the
     headless simulator sees it. This file keeps HUD, chat and callouts. */

  /* ---------- slogans ---------- */
  killSlogan(killer, victim, info) {
    const firstBlood = !!(info && info.firstBlood);
    const combo = (info && info.combo) || 1;
    const streak = killer.streak;
    const name = STREAK_NAMES[Math.min(8, streak)] || (streak >= 9 ? 'Beyond Godlike' : null);
    if (name && streak >= 3) {
      UI.announce(`${killer.name} is ${name}!`, streak >= 5 ? 'major' : 'minor');
    }
    if (firstBlood || combo >= 2) return;
    const p = Game.player;
    if (!p || Game.spectate) return;
    if (killer === p) UI.announce('You have slain an enemy', 'kill');
    else if (victim === p) return;
    else if (killer.team === p.team) UI.announce(`An enemy has been slain — ${killer.name}`, 'kill');
    else if (victim.team === p.team) UI.announce(`An ally has been slain — ${victim.name}`, 'death');
  },

  onBuffKill(monster, src) {
    if (!(src instanceof Hero) || !monster.buff) return;
    const homeTeam = this.campOwnerHint(monster);
    if (homeTeam != null && src.team !== homeTeam) {
      UI.announce(`${src.name} stole ${monster.buff.name}!`, 'major');
    }
  },

  onEpicKill(epic, src) {
    if (!(src instanceof Hero) || !epic.epic) return;
    const contest = Game.heroes.some(h => h.team !== src.team && h.alive && dist(h, epic) < 640);
    if (contest) UI.announce(`${src.name} stole the ${epic.name}!`, 'major');
  },

  campOwnerHint(monster) {
    const home = monster.home;
    if (!home) return null;
    const b0 = Game.fountain(TEAM_BLUE), b1 = Game.fountain(TEAM_RED);
    return dist(home, b0) < dist(home, b1) ? TEAM_BLUE : TEAM_RED;
  },

  /* The first-turret gold is paid in Tower.die; this is the banner only. */
  onTurretKill(tower, src, first) {
    if (!first || tower.isBase || Game.isDuel()) return;
    UI.banner('FIRST TURRET');
  },

  /* ---------- Retribution evolve ---------- */
  retriDamage(h, monster) {
    return retributionDamage(h);
  },
  applyRetriEvolve(h, monster) {
    const ev = h.retriEvolve;
    if (!ev || !monster) return;
    if (ev === 'ice' && monster.cc) monster.cc.applySlow(0.4, 2, 0);
    if (ev === 'flame' && monster.addDot)
      monster.addDot({ src: h, total: 180, dur: 3, type: 'true', color: THEME.warn, tag: 'flame-retri' });
    if (ev === 'bloody') h.heal(h.maxHp * 0.12);
  },
  retriReady(h) {
    if (!h || !h.spell || h.spell.id !== 'retribution') return false;
    if (h.retriEvolve) return false;
    if (Game.time >= 300) return true;
    if ((h.jungleHits || 0) >= 8) return true;
    if (h.items && h.items.some(i => i.tags && i.tags.includes('jungle'))) return true;
    return false;
  },
  pickEvolve(id) {
    const p = Game.player;
    if (!p || !RETRI_EVOLVES[id]) return;
    p.retriEvolve = id;
    this.hideEvolve();
    UI.announce(`${RETRI_EVOLVES[id].icon} ${RETRI_EVOLVES[id].name}`, 'minor');
  },
  tickEvolveUnlock() {
    for (const h of Game.heroes) {
      if (h.isPlayer) continue;
      if (!this.retriReady(h)) continue;
      h.retriEvolve = h.def0.damageStyle === 'magic' ? 'flame'
        : (h.def0.role === 'Assassin' ? 'bloody' : 'ice');
    }
    const p = Game.player;
    if (!p || this.evolveShown || !this.retriReady(p)) return;
    this.evolveShown = true;
    const host = document.getElementById('retriPick');
    if (!host) return;
    host.classList.remove('hidden');
    host.innerHTML = `<b>Evolve Retribution</b>` + Object.entries(RETRI_EVOLVES).map(([id, d]) =>
      `<button data-ev="${id}"><span>${d.icon}</span>${d.name}<small>${d.desc}</small></button>`).join('');
    host.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => this.pickEvolve(b.dataset.ev)));
  },
  hideEvolve() {
    const host = document.getElementById('retriPick');
    if (host) host.classList.add('hidden');
  },

  /* ---------- Arrival ---------- */
  startArrival(h) {
    if (!h.alive || h.arrivalT > 0 || Game.isDuel()) return false;
    const dest = this.arrivalDest(h);
    if (!dest) return false;
    h.arrivalT = 4.6;
    h.arrivalDest = dest;
    h.recallT = 0;
    Game.fx.ring(h.x, h.y, 80, THEME.gold, 0.5);
    if (h.isPlayer) UI.announce('Arrival…', 'minor');
    return true;
  },
  arrivalDest(h) {
    let best = null, bd = Infinity;
    for (const t of Game.towers.concat(Game.bases || [])) {
      if (!t.alive || t.team !== h.team) continue;
      const d = dist(h, t);
      if (d < 280) continue;
      if (d < bd) { bd = d; best = t; }
    }
    return best || Game.fountain(h.team);
  },
  tickArrival(h, dt) {
    if (h.arrivalT <= 0) return;
    if (!h.alive) { h.arrivalT = 0; return; }
    h.arrivalT -= dt;
    if (h.arrivalT > 0) return;
    const d = h.arrivalDest || Game.fountain(h.team);
    h.x = d.x + rand(-40, 40); h.y = d.y + rand(-40, 40);
    Game.clampPoint(h, 40);
    h.arrivalT = 0; h.arrivalDest = null;
    Game.fx.ring(h.x, h.y, 90, THEME.gold, 0.6);
    Game.fx.flash(h.x, h.y, 50, THEME.gold);
  },

  /* ---------- epic clocks / HUD ---------- */
  tickEpicClocks() {
    if (Game.isDuel()) return;
    for (const key of ['turtle', 'lord']) {
      const e = Game.epics && Game.epics[key];
      if (!e) continue;
      const left = e.next - Game.time;
      if (!this.spawnWarned[key] && left > 0 && left <= 15 && !e.unit) {
        this.spawnWarned[key] = true;
        const label = key === 'lord' ? 'Lord' : 'Turtle';
        UI.announce(`${label} spawns in ${Math.ceil(left)}s`, 'minor');
      }
      if (e.unit && e.unit.alive && !this.spawnBannered[key]) {
        this.spawnBannered[key] = true;
        const label = e.unit.name || (key === 'lord' ? 'Lord' : 'Turtle');
        UI.announce(`${label} has spawned!`, 'major');
        UI.banner(label.toUpperCase() + ' HAS SPAWNED');
      }
      if (!e.unit || !e.unit.alive) this.spawnBannered[key] = false;
    }
  },

  tickBotEpicPing() {
    if (Game.time - this.botEpicPingAt < 18) return;
    for (const key of ['turtle', 'lord']) {
      const e = Game.epics && Game.epics[key];
      const u = e && e.unit;
      if (!u || !u.alive) continue;
      for (const h of Game.heroes) {
        if (h.isPlayer || !h.alive || h.team !== TEAM_BLUE) continue;
        if (dist(h, u) > 420) continue;
        Game.ping(key, u.x, u.y, h);
        this.botEpicPingAt = Game.time;
        return;
      }
    }
  },

  syncEpicBar() {
    const host = document.getElementById('epicBar');
    if (!host) return;
    if (Game.isDuel() || Game.state !== 'play') { host.classList.add('hidden'); return; }
    let best = null;
    for (const key of ['turtle', 'lord']) {
      const u = Game.epics && Game.epics[key] && Game.epics[key].unit;
      if (u && u.alive && u.hp < u.maxHp) best = u;
    }
    if (!best) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    const pct = clamp(best.hp / best.maxHp, 0, 1);
    const html = `<i>${best.icon || ''} ${best.name}</i><b style="width:${(pct * 100).toFixed(1)}%"></b><span>${Math.round(best.hp)} / ${best.maxHp}</span>`;
    if (host._h !== html) { host._h = html; host.innerHTML = html; }
  },

  syncRetriPips() {
    const p = Game.player;
    const host = document.getElementById('targetFrame');
    if (!p || !host || Game.state !== 'play') return;
    if (!p.spell || p.spell.id !== 'retribution') return;
    const t = p.curTarget;
    if (!t || t.type !== 'monster' || !t.alive) return;
    const dmg = this.retriDamage(p, t);
    host.classList.toggle('exec', t.hp <= dmg);
  },

  /* ---------- AFK takeover ---------- */
  tickAfkTakeover(dt) {
    const p = Game.player;
    if (!p || Game.spectate) return;
    const mv = Input.moveVector && Input.moveVector();
    const busy = mv || Input.attackHeld || (Input.casts && Input.casts.length) || p.recallT > 0 || p.arrivalT > 0;
    if (busy) {
      if (p.aiTakeover) {
        p.aiTakeover = false;
        UI.announce('You are back — taking control', 'minor');
      }
      return;
    }
    if ((Features.idleT || 0) > 40 && !p.aiTakeover && p.alive) {
      p.aiTakeover = true;
      UI.announce('AFK — a bot is playing your hero', 'minor');
    }
  },

  /* ---------- select screen: bans, adjust, recs ---------- */
  bindSelect() {
    const bans = document.getElementById('banRow');
    if (bans && !bans._bound) {
      bans._bound = true;
      bans.innerHTML =
        `<button type="button" data-ban="0">Ban Blue</button>
         <button type="button" data-ban="1">Ban Red</button>
         <span id="banPips"></span>
         <button type="button" id="btnAdjust">Adjust lanes</button>`;
      bans.querySelectorAll('[data-ban]').forEach(b =>
        b.addEventListener('click', () => {
          this.banMode = +b.dataset.ban;
          this.paintBans();
        }));
      document.getElementById('btnAdjust')?.addEventListener('click', () => this.adjustLanes());
    }
    this.paintBans();
    const chat = document.getElementById('chatWheel');
    if (chat && !chat._bound) {
      chat._bound = true;
      chat.innerHTML = MLBB_CHAT.map(c =>
        `<button type="button" data-chat="${c.id}">${c.text}</button>`).join('');
      chat.querySelectorAll('button').forEach(b =>
        b.addEventListener('click', () => this.sendChat(b.dataset.chat)));
    }
    const retri = document.getElementById('retriPick');
    if (retri) retri.addEventListener('click', e => e.stopPropagation());
  },

  tryBan(hero) {
    if (this.banMode == null) return false;
    const team = this.banMode;
    this.bans[team] = this.bans[team] === hero ? null : hero;
    this.banMode = null;
    this.paintBans();
    return true;
  },
  isBanned(hero) {
    return this.bans[0] === hero || this.bans[1] === hero;
  },
  paintBans() {
    const host = document.getElementById('banPips');
    if (host) {
      host.innerHTML = this.bans.map((h, i) =>
        `<i class="${i === this.banMode ? 'on' : ''}">${h ? (h.icon || h.name) : '—'}</i>`).join('');
    }
    if (UI.els && UI.els.heroGrid) {
      for (const card of UI.els.heroGrid.children) {
        card.classList.toggle('banned', this.isBanned(card.heroDef));
      }
    }
    document.getElementById('banRow')?.querySelectorAll('[data-ban]').forEach(b =>
      b.classList.toggle('sel', this.banMode === +b.dataset.ban));
  },
  adjustLanes() {
    if (!UI.draft || !UI.draft[TEAM_BLUE]) return;
    const row = UI.draft[TEAM_BLUE];
    if (row.length < 2) return;
    const first = row.shift();
    row.push(first);
    if (UI.syncDraft) UI.syncDraft();
  },

  recommendPath(heroDef) {
    if (!heroDef || typeof ItemAI === 'undefined') return [];
    const fake = {
      def0: heroDef, team: TEAM_BLUE, items: [], gold: 99999,
      lane: 'mid',
    };
    const out = [];
    for (let i = 0; i < 6; i++) {
      const it = ItemAI.recommend(fake, false);
      if (!it) break;
      out.push(it);
      fake.items.push(it);
    }
    return out;
  },

  sendChat(id) {
    const row = MLBB_CHAT.find(c => c.id === id);
    const p = Game.player;
    if (!row || !p) return;
    if (typeof Features !== 'undefined' && Features.chatLine)
      Features.chatLine('qc', `${p.name}: ${row.text}`, p);
    UI.announce(row.text, 'minor');
    if (row.ping) {
      const aim = row.ping === 'turtle' || row.ping === 'lord'
        ? (Game.epics[row.ping] && Game.epics[row.ping].unit) || p
        : p;
      Game.ping(row.ping, aim.x, aim.y, p);
    }
    this.hideChatWheel();
  },
  toggleChatWheel() {
    const el = document.getElementById('chatWheel');
    if (!el) return;
    el.classList.toggle('hidden');
  },
  hideChatWheel() {
    document.getElementById('chatWheel')?.classList.add('hidden');
  },

  drawMinimapUlt(g, mx, my) {
    for (const h of Game.heroes) {
      if (!h.alive || h.team !== TEAM_BLUE) continue;
      if (!(h.skillRank[2] > 0 && h.skillCd[2] <= 0)) continue;
      g.fillStyle = THEME.gold;
      g.beginPath();
      g.moveTo(mx(h.x), my(h.y) - 9);
      g.lineTo(mx(h.x) + 3.5, my(h.y) - 5.5);
      g.lineTo(mx(h.x) - 3.5, my(h.y) - 5.5);
      g.closePath();
      g.fill();
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Mlbb, MLBB_CATALOG, RETRI_EVOLVES };
}
