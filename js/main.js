'use strict';
/* ============================================================
   main.js — Game object: match setup, update loop, rendering
   ============================================================ */

const Game = {
  state: 'select',
  time: 0, waveT: 3, waveN: 0,
  heroes: [], minions: [], monsters: [], towers: [], bases: [], inhibitors: [],
  projectiles: [], zones: [], effects: [], floaters: [], indicators: [],
  tethers: [],            // F16 tether entities
  objects: [],            // F9 placed objects (traps, lanterns, barriers)
  camps: [],
  /* Epic objectives share one slot each: `next` is the spawn clock, `unit` is
     the live monster if there is one. Turtle is replaced by Lord at LORD_AT. */
  epics: null,
  duelRune: null,         // {up, next, kind, n} shrine state, duel mode only
  goldHistory: [],        // [{t, blue, red}] sampled for the post-match graph
  phaseFlags: null,       // one-shot announcements for opening / late-game changes
  pings: [],              // [{x, y, kind, team, age, by}] live map pings
  surrender: null,        // {team, yes, no, endsAt} active vote
  player: null,
  hitStop: 0,             // brief slow-mo on player crits / kills / deaths
  cam: { x: BASES[0].x, y: BASES[0].y, zoom: 1, zoomWant: 1 },
  kills: [0, 0], firstBlood: false,
  spectate: false, simSpeed: 1, followHero: null, autoTrain: false,
  attract: false,         // bot match running silently behind the menus (see screens.js)
  paused: false,
  mode: 'standard',       // 'standard' (5v5), 'ten' (10v10 Caldera), or 'duel'
  DUEL_TO: 5,             // first to N kills wins a practice duel
  experiment: null,   // {featureTeam, lineup[5], botTypes[2]}: mirrored A/B test, no learning
  lastWinner: null,
  botTypes: null,     // ['heuristic'|'neural', ...] by team, for normal matches
  draft: null,        // [[heroDef|null ×N], [...]] by team — nulls roll randomly

  isDuel() { return this.mode === 'duel'; },
  isTen() { return this.mode === 'ten'; },
  teamSize() { return this.isDuel() ? 1 : this.isTen() ? 10 : 5; },
  worldSize() { return this.isTen() ? TEN_MAP.world : WORLD; },
  pushLanes() { return this.isTen() ? TEN_MAP.pushLanes : ['top', 'mid', 'bot']; },
  mapBounds() {
    if (this.isDuel()) return DUEL_MAP.bounds;
    if (this.isTen()) return TEN_MAP.bounds;
    // one shared object: every clampWorld() asks for this, every frame
    return this._stdBounds || (this._stdBounds = { minX: 0, minY: 0, maxX: WORLD, maxY: WORLD });
  },
  /* The old spectator floor was a fixed 0.3x, which only shows about half of
     this 6400-unit map on a laptop. Derive the floor from the viewport so the
     entire battlefield, plus a slim border, can always fit on screen. */
  spectatorMinZoom(viewW = CW, viewH = CH) {
    const b = this.mapBounds();
    const border = 180;
    // the tilt squash means the board needs less vertical screen space
    const fit = Math.min(viewW / (b.maxX - b.minX + border),
      viewH / ((b.maxY - b.minY + border) * TILT));
    return clamp(fit, 0.07, 0.3);
  },
  clampSpectatorCamera(viewW = CW, viewH = CH) {
    const b = this.mapBounds();
    const halfW = viewW / (2 * this.cam.zoom);
    const halfH = viewH / (2 * this.cam.zoom * TILT);
    const clampAxis = (v, lo, hi, half) => lo + half > hi - half
      ? (lo + hi) / 2 : clamp(v, lo + half, hi - half);
    this.cam.x = clampAxis(this.cam.x, b.minX, b.maxX, halfW);
    this.cam.y = clampAxis(this.cam.y, b.minY, b.maxY, halfH);
  },
  fountain(team) {
    if (this.isDuel()) return DUEL_MAP.fountains[team];
    if (this.isTen()) return TEN_MAP.fountains[team];
    return FOUNTAINS[team];
  },
  basePoint(team) {
    if (this.isDuel()) return DUEL_MAP.bases[team];
    if (this.isTen()) return TEN_MAP.bases[team];
    return BASES[team];
  },
  lanesFor(team) {
    if (this.isDuel()) return team === TEAM_BLUE ? DUEL_MAP.lanes : DUEL_MAP.lanesRed;
    if (this.isTen()) return team === TEAM_BLUE ? TEN_MAP.lanes : TEN_MAP.lanesRed;
    return team === TEAM_BLUE ? LANES : LANES_RED;
  },
  nearestLane(p, maxDist = Infinity) {
    if (this.isDuel()) return null;
    const lanes = this.isTen() ? TEN_MAP.lanes : LANES;
    let best = null, bd = maxDist;
    for (const [name, path] of Object.entries(lanes)) {
      for (const q of path) {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bd) { bd = d; best = name; }
      }
    }
    return best;
  },
  clampPoint(p, padding = 40) {
    const b = this.mapBounds();
    p.x = clamp(p.x, b.minX + padding, b.maxX - padding);
    p.y = clamp(p.y, b.minY + padding, b.maxY - padding);
    return p;
  },

  /* Turn a (possibly sparse) drafted side into a full five. Explicit picks are
     kept exactly as drafted; empty slots roll random heroes that the side isn't
     already fielding, which is what the old shuffle did for every slot. */
  rosterFor(wanted) {
    const n = this.teamSize();
    const out = (wanted || []).slice(0, n);
    while (out.length < n) out.push(null);
    const used = new Set(out.filter(Boolean));
    const unique = shuffle(HEROES).filter(h => !used.has(h) && !(typeof Mlbb !== 'undefined' && Mlbb.isBanned(h)));
    const pool = unique.concat(shuffle(HEROES));
    let pi = 0;
    return out.map(h => h || pool[pi++] || HEROES[0]);
  },

  /* ---------- setup (heroDef = null -> spectator mode, all 10 are bots) ---------- */
  start(heroDef) {
    this.state = 'play';
    this.paused = false;
    this._clockReset = true;
    // a new match must clear whatever the last one left on screen
    UI.els.end.classList.add('hidden');
    UI.toggleScoreboard(false);
    UI.toggleShop(false);
    this.spectate = !heroDef;
    this.followHero = null;
    if (!this.spectate) this.simSpeed = 1;
    this.time = 0; this.waveT = BALANCE.firstWaveAt; this.waveN = 0;
    this.waveBoost = [0, 0];      // per team: clock time until which new waves spawn enhanced (Lord)
    this.kills = [0, 0]; this.firstBlood = false; this.firstTurret = false;
    this.heroes = []; this.minions = []; this.monsters = [];
    this.projectiles = []; this.zones = []; this.effects = []; this.floaters = []; this.indicators = [];
    this.tethers = []; this.objects = [];

    const towerSpots = this.isDuel() ? [] : this.isTen() ? TEN_MAP.towers : TOWER_SPOTS;
    const basePts = this.isDuel() ? [] : this.isTen() ? TEN_MAP.bases : BASES;
    const inhibSpots = this.isDuel() ? [] : this.isTen() ? TEN_MAP.inhibitors : INHIBITOR_SPOTS;
    const campSpots = this.isDuel() ? [] : this.isTen() ? TEN_MAP.camps : CAMPS;
    this.towers = towerSpots.map(s => {
      const t = new Tower(s.x, s.y, s.team, false);
      t.lane = s.lane; t.frac = s.frac;
      /* A turret is a siege objective, not a large minion. Outer towers can be
         pressured early (behind an energy shield until 5:00), while middle
         and inner towers are immune until the tier in front of them falls. */
      t.setTier(s.frac >= 0.39 ? 'outer' : s.frac >= 0.26 ? 'middle' : 'inner', this.isTen() ? 1.28 : 1);
      return t;
    });
    this.bases = basePts.map((b, i) => {
      const t = new Tower(b.x, b.y, i, true);
      t.setTier('base', this.isTen() ? 1.7 : 1);
      return t;
    });

    this.inhibitors = inhibSpots.map(s => new Inhibitor(s.x, s.y, s.team, s.lane));
    /* The three structure lists never change after this point, so their
       union is built once: structures() used to concatenate three arrays on
       every call, and it is called hundreds of times a frame. */
    this._structures = this.towers.concat(this.bases, this.inhibitors);
    this._structGrid = null;
    this._navFrame = null;

    this.camps = campSpots.map(c => ({ x: c.x, y: c.y, kind: c.kind, respawnT: 0 }));
    for (const c of this.camps) this.monsters.push(new BuffMonster(c));

    this.epics = this.isDuel() ? null : {
      turtle: { next: this.TURTLE_AT, unit: null, pos: this.isTen() ? TEN_MAP.beaconWest : TURTLE_PIT, n: 0, taken: 0 },
      lord:   { next: this.LORD_AT,   unit: null, pos: this.isTen() ? TEN_MAP.crater : LORD_PIT },
    };
    /* `kind` is always the rune that is up *or* the one the clock is counting
       down to, so the HUD can name it before it lands. */
    this.duelRune = this.isDuel()
      ? { up: false, next: this.SHRINE_FIRST, kind: this.SHRINE_KINDS[0], n: 0 }
      : null;
    this.goldHistory = [{ t: 0, blue: 0, red: 0 }];
    this.hitStop = 0;
    this.goldSampleT = 0;
    this.phaseFlags = { laningEnded: false, ancientLord: false };
    this.pings = []; this.surrender = null;
    if (this.explored) this.explored.fill(0);

    const drafted = t => this.experiment ? null : (this.draft ? this.draft[t] : null);
    if (this.isDuel()) {
      this.spectate = false;
      const redPick = (drafted(TEAM_RED) || [])[0];
      const enemyDef = redPick || shuffle(HEROES.filter(h => h !== heroDef))[0] || HEROES[0];
      this.player = new Hero(heroDef, TEAM_BLUE, true, null);
      const enemy = new Hero(enemyDef, TEAM_RED, false, 'duel');
      this.heroes.push(this.player, enemy);
    } else if (this.spectate) {
      this.player = null;
      const blue = this.experiment ? this.experiment.lineup : this.rosterFor(drafted(TEAM_BLUE));
      const specLanes = this.isTen()
        ? ['roam', 'dusk', 'west', 'jungle', 'east', 'dawn', 'jungle', 'roam', 'west', 'east']
        : ['roam', 'top', 'jungle', 'mid', 'bot'];
      specLanes.forEach((lane, i) =>
        this.heroes.push(new Hero(blue[i % blue.length], TEAM_BLUE, false, lane)));
    } else {
      const blue = this.rosterFor([heroDef].concat((drafted(TEAM_BLUE) || []).slice(1)));
      this.player = new Hero(blue[0], TEAM_BLUE, true, null);
      this.heroes.push(this.player);
      const allyLanes = this.isTen()
        ? ['dusk', 'west', 'east', 'dawn', 'jungle', 'jungle', 'roam', 'roam', 'west']
        : ['top', 'jungle', 'mid', 'bot'];
      allyLanes.forEach((lane, i) => this.heroes.push(new Hero(blue[i + 1], TEAM_BLUE, false, lane)));
    }
    if (!this.isDuel()) {
      const red = this.experiment ? this.experiment.lineup : this.rosterFor(drafted(TEAM_RED));
      const enemyLanes = this.isTen()
        ? ['dusk', 'west', 'east', 'dawn', 'jungle', 'jungle', 'roam', 'roam', 'west', 'east']
        : ['top', 'jungle', 'mid', 'bot', 'roam'];
      enemyLanes.forEach((lane, i) => this.heroes.push(new Hero(red[i % red.length], TEAM_RED, false, lane)));
    }
    if (this.experiment) {
      const ex = this.experiment;
      /* Mirrored A/B: identical five heroes on both sides, one behaviour flag
         switched on for `featureTeam` only, so the win rate over a batch is
         attributable to that flag and nothing else. `features` names the hero
         flags under test — it defaults to the original attack-on-move trial. */
      if (ex.featureTeam !== undefined) {
        for (const flag of ex.features || ['attackOnMove']) {
          for (const h of this.heroes) h[flag] = h.team === ex.featureTeam;
        }
      }
      // botTypes: ['heuristic'|'neural', 'heuristic'|'neural'] indexed by team
      if (ex.botTypes) {
        for (const h of this.heroes) if (!h.isPlayer) h.botType = ex.botTypes[h.team] || 'heuristic';
      }
    } else if (this.botTypes) {
      // outside experiments too: Game.botTypes = ['neural','heuristic'] etc.
      for (const h of this.heroes) if (!h.isPlayer) h.botType = this.botTypes[h.team] || 'heuristic';
    }

    /* Loadouts. The player's picks come from the select screen; every bot
       takes the default emblem and spell for its role, so a bot team always
       fields a Retribution carrier and is able to contest epics. */
    for (const h of this.heroes) {
      if (h.isPlayer) {
        h.emblem = EMBLEM_BY_ID[UI.pickedEmblem] || EMBLEM_BY_ID[EMBLEM_BY_ROLE[h.def0.role]];
        h.spell = SPELL_BY_ID[UI.pickedSpell] || SPELL_BY_ID[BOT_SPELL_BY_ROLE[h.def0.role]];
      } else {
        h.emblem = EMBLEM_BY_ID[EMBLEM_BY_ROLE[h.def0.role]];
        // Position beats character archetype here: every team must have one
        // real objective secure, even if its drafted jungler is not an Assassin.
        h.spell = SPELL_BY_ID[h.lane === 'jungle' ? 'retribution' : BOT_SPELL_BY_ROLE[h.def0.role]];
      }
      h.recalcStats(true);
    }
    if (this.isDuel()) {
      for (const h of this.heroes) {
        h.gold = BALANCE.duelStartGold;
        h.goldEarned = BALANCE.duelStartGold;
      }
      this.goldHistory = [{ t: 0, blue: this.teamGold(TEAM_BLUE), red: this.teamGold(TEAM_RED) }];
    }

    UI.buildMinimapStatic();
    /* 5v5: the reference game shows 106 map px of ground across the screen
       at the hero and 157 at the top edge (perspective, measured through its
       calibrated camera); our flat view uses the middle of that, 124, so the
       amount of map in sight feels the same. The other modes keep their
       height rule. */
    this.cam.zoom = this.cam.zoomWant = this.isDuel() || this.isTen()
      ? clamp(CH / (this.isDuel() ? 900 : 1450), 0.45, 1.3)
      : clamp(CW / (124 * MAP_K), 0.4, 1.6);
    if (typeof Mlbb !== 'undefined') Mlbb.onMatchStart();
    if (this.spectate) {
      this.cam.x = this.worldSize() / 2; this.cam.y = this.worldSize() / 2;
      UI.announce(this.isTen() ? '👁 Spectating 10v10 — Auric Caldera' : '👁 Spectating: Blue vs Red', 'major');
    } else {
      this.cam.x = this.player.x; this.cam.y = this.player.y;
      UI.setupHUD(this.player);
      UI.announce(this.isDuel() ? `⚔ Duel — first to ${this.DUEL_TO} kills!`
        : this.isTen() ? '⚔ 10v10 — hold the Caldera, destroy their citadel!'
        : '⚔ Destroy the enemy base!', 'major');
      if (Input.releaseAim && Input.isFinePointer()) {
        setTimeout(() => UI.announce('Hold 1/2/3/F to aim · click to attack · scroll to zoom', 'minor'), 2200);
      }
    }
    if (typeof Features !== 'undefined') Features.onMatchStart();
  },

  endGame(winnerTeam) {
    if (this.state !== 'play') return;
    if (this.attract) {
      // the menu background finished a match: no history, no end screen, roll another
      this.state = 'end';
      setTimeout(() => { if (typeof Screens !== 'undefined') Screens.attractRestart(); }, 1800);
      return;
    }
    this.resume();
    this.state = 'end';
    this.lastWinner = winnerTeam;
    if (typeof Features !== 'undefined') Features.saveHistory(winnerTeam);
    UI.showEnd(winnerTeam === TEAM_BLUE);
    if (this.spectate && this.autoTrain) {
      setTimeout(() => {
        if (Game.state === 'end' && Game.autoTrain) {
          UI.els.end.classList.add('hidden');
          Game.start(null);
        }
      }, 2200);
    }
  },

  /* Objective clocks, in seconds. Turtle is early and repeatable; Lord
     arrives once the game is decided enough for a siege unit to matter. */
  TURTLE_AT: 120, TURTLE_RESPAWN: 120,
  LORD_AT: 480, LORD_RESPAWN: 180,

  /* The duel shrine, alternating between the two jungle runes so the icon on
     the HUD tells you which fight you are about to have. SHRINE_DUR is much
     shorter than the 70s a camp grants in 5v5: in a duel that resets every
     twenty seconds, a 70-second buff decides the match rather than a fight. */
  SHRINE_KINDS: ['redBuff', 'blueBuff'],
  SHRINE_FIRST: 40, SHRINE_RESPAWN: 55, SHRINE_DUR: 25,

  /* A rune is picked up by standing on it — no monster to kill, because the
     interesting contest in a 1v1 is over the ground, not over a health bar. */
  updateDuelRune(dt) {
    const r = this.duelRune;
    if (!r) return;
    const def = JUNGLE_BUFFS[r.kind];
    const s = DUEL_MAP.shrine;
    if (!r.up) {
      r.next -= dt;
      if (r.next > 0) return;
      r.up = true; r.next = 0;
      this.fx.ring(s.x, s.y, s.r + 60, def.color, 0.9);
      UI.announce(`${def.icon} ${def.name} is up at the shrine`, 'minor');
      return;
    }
    for (const h of this.heroes) {
      if (!h.alive || dist(h, s) > s.r + h.radius) continue;
      h.applyBuffRune(r.kind, this.SHRINE_DUR);
      this.fx.ring(s.x, s.y, s.r + 80, def.color, 0.7);
      UI.announce(`${def.icon} ${h.name} took the ${def.name}`, h.isPlayer ? 'kill' : 'minor');
      r.up = false;
      r.next = this.SHRINE_RESPAWN;
      r.kind = this.SHRINE_KINDS[++r.n % this.SHRINE_KINDS.length];
      return;                     // first hero to reach it takes it outright
    }
  },

  /* ---------- queries ---------- */
  structures() {
    return this._structures || (this._structures = this.towers.concat(this.bases, this.inhibitors));
  },
  /* Structures never move, so "which structures could a body of radius
     `pad` at (x, y) be touching" is answered from a coarse grid built once
     per match: each cell lists, in structures() order, every structure whose
     footprint (plus the largest pad any caller uses) reaches into it. Most
     cells are empty, so the movement, sampling and push-out tests that used
     to walk all 26 structures now look at zero or one. */
  STRUCT_GRID_PAD: 96,
  STRUCT_HEAT_PAD: 280,
  structureGrid(pad = this.STRUCT_GRID_PAD) {
    const S = this.structures();
    const grids = this._structGrid && this._structGrid.source === S
      ? this._structGrid : (this._structGrid = { source: S, byPad: new Map() });
    let g = grids.byPad.get(pad);
    if (g) return g;
    const b = this.mapBounds(), cell = 320;
    const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell) + 1);
    const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell) + 1);
    const cells = new Array(cols * rows).fill(null);
    const empty = [];
    for (let i = 0; i < S.length; i++) {
      const s = S[i], r = s.radius + pad;
      s._sIndex = i;
      const x0 = clamp(Math.floor((s.x - r - b.minX) / cell), 0, cols - 1);
      const x1 = clamp(Math.floor((s.x + r - b.minX) / cell), 0, cols - 1);
      const y0 = clamp(Math.floor((s.y - r - b.minY) / cell), 0, rows - 1);
      const y1 = clamp(Math.floor((s.y + r - b.minY) / cell), 0, rows - 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const id = y * cols + x;
        (cells[id] || (cells[id] = [])).push(s);
      }
    }
    g = { pad, minX: b.minX, minY: b.minY, cell, cols, rows, cells, empty, all: S };
    grids.byPad.set(pad, g);
    return g;
  },
  /* Candidate structures for a point, in structures() order: every structure
     whose footprint plus `pad` can reach (x, y). Falls back to the full list
     for a pad larger than the grids are built for. */
  structuresNear(x, y, pad) {
    const g = this.structureGrid(pad <= this.STRUCT_GRID_PAD ? this.STRUCT_GRID_PAD : this.STRUCT_HEAT_PAD);
    if (pad > g.pad) return g.all;
    const cx = clamp(Math.floor((x - g.minX) / g.cell), 0, g.cols - 1);
    const cy = clamp(Math.floor((y - g.minY) / g.cell), 0, g.rows - 1);
    return g.cells[cy * g.cols + cx] || g.empty;
  },
  bushes() {
    if (this.isDuel()) return DUEL_MAP.bushes;
    if (this.isTen()) return TEN_MAP.bushes;
    return BUSHES;
  },
  /* The duel arena's terrain, or the 5v5 board's pits, jungle ridges and base
     shoulders. Both lists are module constants — every moving unit asks this
     question every frame, so it must never allocate. */
  walls() {
    if (this.isDuel()) return DUEL_MAP.walls;
    if (this.isTen()) return TEN_MAP.walls;
    return MAP_WALLS;
  },
  wallAt(x, y, pad) {
    if (this.isDuel() || this.isTen() || !WALL_DIST.clear(x, y, pad)) {
      for (const w of this.walls()) if (wallBlocks(w, x, y, pad)) return w;
    }
    /* standing structures are round obstacles: minions and heroes slide
       around a turret the way they slide along rock */
    return this.structureAt(x, y, pad);
  },
  structureAt(x, y, pad) {
    const near = this.structuresNear(x, y, pad);
    for (let i = 0; i < near.length; i++) {
      const s = near[i];
      if (!s.alive) continue;
      const rr = s.radius + pad, dx = x - s.x, dy = y - s.y;
      if (dx * dx + dy * dy < rr * rr) return s._wall || (s._wall = { circle: s, r: 0, pts: [] });
    }
    return null;
  },

  /* The first wall standing between (ax,ay) and (bx,by), or null for a clear
     walk. Sampled rather than solved: a wall is a thick polyline, the exact
     capsule-segment intersection is fiddly, and a step every `pad` units cannot
     miss a body of radius `pad`. `maxDist` stops a bot routing around terrain
     that is still half a map away and will have been re-evaluated by then. */
  wallOnSegment(ax, ay, bx, by, pad, maxDist = 1400) {
    const walls = this.walls();
    if (!walls.length) return null;
    const dx = bx - ax, dy = by - ay;
    const len = hyp(dx, dy);
    const d = Math.min(len, maxDist);
    if (d < 1) return null;
    const ux = dx / len, uy = dy / len;
    const step = Math.max(20, pad);
    if (this.isDuel() || this.isTen()) {
      for (let t = step; t <= d; t += step) {
        const w = this.wallAt(ax + ux * t, ay + uy * t, pad);
        if (w) return w;
      }
      return null;
    }
    /* Same samples, same answer, far fewer tests. The distance field says how
       far the nearest rock is from a sample; every later sample closer than
       that (less the field's own cell slack) is clear of rock too, so the
       walk jumps straight past them. Rock is checked in one pass and the
       standing structures in another, each finding the first sample it
       blocks; the earlier sample wins and rock wins a tie, exactly as the
       one-test-per-sample loop decided it. */
    const slack = WALL_DIST.slack, cellPad = 2 * WALL_DIST.cell;
    let rockT = Infinity, rockW = null;
    for (let t = step; t <= d; t += step) {
      const x = ax + ux * t, y = ay + uy * t;
      const c = WALL_DIST.at(x, y);
      if (c > pad + slack) {
        const free = c - pad - slack - cellPad;
        if (free >= step) t += Math.floor(free / step) * step;
        continue;
      }
      for (const w of walls) if (wallBlocks(w, x, y, pad)) { rockT = t; rockW = w; break; }
      if (rockW) break;
    }
    let structT = rockT, structW = null;
    const S = this.structures();
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!s.alive) continue;
      const rr = s.radius + pad, rr2 = rr * rr;
      const px = s.x - ax, py = s.y - ay;
      const along = px * ux + py * uy;
      const perp2 = px * px + py * py - along * along;
      if (perp2 > rr2 + 1e-6 * rr2 + 1e-6) continue;      // the ray misses this circle
      const half = Math.sqrt(Math.max(0, rr2 - perp2)) + 1e-3;
      const tEnd = Math.min(d, along + half, structT);
      let t = Math.max(step, Math.ceil((along - half) / step) * step);
      for (; t <= tEnd + step && t <= d && t < structT; t += step) {
        const ddx = ax + ux * t - s.x, ddy = ay + uy * t - s.y;
        if (ddx * ddx + ddy * ddy < rr2) { structT = t; structW = s; break; }
      }
    }
    if (rockW && rockT <= structT) return rockW;
    if (structW) return structW._wall || (structW._wall = { circle: structW, r: 0, pts: [] });
    return null;
  },

  /* ---------- bot navigation ----------
     The old bot mover only reacted after touching a wall. That works on an
     empty lane, but a dense jungle needs actual route planning: which pit
     entrance to use, which end of a ridge is nearer, and whether the shorter
     road runs through an uncovered enemy turret. The grid is built once per
     map/radius and A* is only re-run when a goal moves or a route stalls. */
  navGrid(pad = 32) {
    const clearance = Math.max(20, Math.round(pad / 4) * 4);
    const bounds = this.mapBounds();
    const cell = this.isDuel() ? 64 : this.isTen() ? 96 : 80;
    const key = `${this.mode}:${clearance}:${bounds.minX}:${bounds.maxX}`;
    this._navGrids = this._navGrids || new Map();
    if (this._navGrids.has(key)) return this._navGrids.get(key);

    const inset = clearance + 8;
    const minX = bounds.minX + inset, minY = bounds.minY + inset;
    const cols = Math.max(2, Math.floor((bounds.maxX - bounds.minX - inset * 2) / cell) + 1);
    const rows = Math.max(2, Math.floor((bounds.maxY - bounds.minY - inset * 2) / cell) + 1);
    const blocked = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (this.wallAt(minX + x * cell, minY + y * cell, clearance)) blocked[y * cols + x] = 1;
    }
    const grid = { key, clearance, cell, minX, minY, cols, rows, blocked };
    this._navGrids.set(key, grid);
    return grid;
  },

  /* Nearest walkable grid cell. Goals can sit between cells or next to a
     rounded wall cap, so simply rounding to one cell is not reliable. */
  navCell(grid, x, y) {
    const cx = clamp(Math.round((x - grid.minX) / grid.cell), 0, grid.cols - 1);
    const cy = clamp(Math.round((y - grid.minY) / grid.cell), 0, grid.rows - 1);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= 6 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (r && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ix = cx + dx, iy = cy + dy;
        if (ix < 0 || iy < 0 || ix >= grid.cols || iy >= grid.rows) continue;
        const id = iy * grid.cols + ix;
        if (grid.blocked[id]) continue;
        const px = grid.minX + ix * grid.cell, py = grid.minY + iy * grid.cell;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  },

  /* Dynamic terrain cost. Walls are hard obstacles; uncovered enemy turret
     circles and visible enemies during a retreat are expensive rather than
     impossible, so a cornered bot can still take the least-bad exit. */
  navRisk(hero, x, y, opts = {}) {
    if (!hero) return 1;
    let risk = 1;
    if (opts.avoidTowers !== false) {
      const D = this.navFrame().teams[hero.team].danger;
      for (let i = 0; i < D.length; i++) {
        const e = D[i], s = e.s;
        if (!s.alive) continue;
        const edge = e.edge;
        const d = hyp(x - s.x, y - s.y);
        if (d >= edge || e.covered()) continue;
        risk += 8 + (edge - d) / edge * 12;
      }
    }
    if (opts.retreat) {
      for (const foe of this.heroes) {
        if (!foe.alive || foe.team === hero.team || !this.canSee(hero.team, foe)) continue;
        const d = hyp(x - foe.x, y - foe.y);
        if (d < 720) risk += (720 - d) / 90;
      }
    }
    return risk;
  },

  /* The facts navRisk needs that are the same for every bot on a team:
     which enemy turrets and bases are there to fear, and which allied
     minions stand close enough to each to make it safe. Built once per
     frame (bots run before minions move, so the minion positions hold for
     every bot) and read hundreds of times. Liveness is still checked at
     read time, so a turret or a covering minion that dies mid-frame is
     seen by the next bot exactly as before. */
  navFrame() {
    const F = this._navFrame;
    if (F && F.t === this.time && F.nMin === this.minions.length && F.source === this.structures()) return F;
    const S = this.structures();
    const teams = [];
    for (const team of [TEAM_BLUE, TEAM_RED]) {
      const danger = [];
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        if (s.team === team || (s.type !== 'tower' && !s.isBase)) continue;
        const cover = [];
        for (const m of this.minions) {
          if (m.team === team && m.alive && dist(m, s) < 330) cover.push(m);
        }
        danger.push({
          s, index: i, edge: s.range + s.radius + 70, cover,
          covered() { for (let k = 0; k < this.cover.length; k++) if (this.cover[k].alive) return true; return false; },
        });
      }
      teams[team] = { danger };
    }
    return (this._navFrame = { t: this.time, nMin: this.minions.length, source: S, teams });
  },

  /* navRisk evaluated at every cell of the nav grid, for A*. The turret
     part depends only on which dangerous structures are live and uncovered,
     so it is kept until that set changes; the retreat part depends on where
     the visible enemies stand right now and is re-added per search over
     the cells near them only. The sums are formed in the same order as
     navRisk's loops, so the values are identical. */
  navRiskGrid(hero, grid, opts) {
    const towers = opts.avoidTowers !== false;
    const D = this.navFrame().teams[hero.team].danger;
    let key = `${hero.team}:${towers ? 1 : 0}`;
    const live = [];
    if (towers) for (let i = 0; i < D.length; i++) {
      const e = D[i];
      if (e.s.alive && !e.covered()) { live.push(e); key += ':' + e.index; }
    }
    const cache = grid.riskCache || (grid.riskCache = new Map());
    let base = cache.get(key);
    const count = grid.cols * grid.rows;
    if (!base) {
      base = new Float64Array(count);
      for (let id = 0; id < count; id++) {
        const px = grid.minX + (id % grid.cols) * grid.cell, py = grid.minY + Math.floor(id / grid.cols) * grid.cell;
        let risk = 1;
        for (let k = 0; k < live.length; k++) {
          const e = live[k], s = e.s, edge = e.edge;
          const d = hyp(px - s.x, py - s.y);
          if (d >= edge) continue;
          risk += 8 + (edge - d) / edge * 12;
        }
        base[id] = risk;
      }
      if (cache.size > 64) cache.clear();
      cache.set(key, base);
    }
    if (!opts.retreat) return base;
    const out = grid.riskScratch && grid.riskScratch.length === count
      ? grid.riskScratch : (grid.riskScratch = new Float64Array(count));
    out.set(base);
    for (const foe of this.heroes) {
      if (!foe.alive || foe.team === hero.team || !this.canSee(hero.team, foe)) continue;
      const x0 = clamp(Math.floor((foe.x - 720 - grid.minX) / grid.cell), 0, grid.cols - 1);
      const x1 = clamp(Math.ceil((foe.x + 720 - grid.minX) / grid.cell), 0, grid.cols - 1);
      const y0 = clamp(Math.floor((foe.y - 720 - grid.minY) / grid.cell), 0, grid.rows - 1);
      const y1 = clamp(Math.ceil((foe.y + 720 - grid.minY) / grid.cell), 0, grid.rows - 1);
      for (let cy = y0; cy <= y1; cy++) {
        const py = grid.minY + cy * grid.cell;
        for (let cx = x0; cx <= x1; cx++) {
          const px = grid.minX + cx * grid.cell;
          const d = hyp(px - foe.x, py - foe.y);
          if (d < 720) out[cy * grid.cols + cx] += (720 - d) / 90;
        }
      }
    }
    return out;
  },

  navSegmentClear(hero, a, b, opts = {}) {
    const pad = (hero ? hero.radius : 26) + 8;
    const length = hyp(b.x - a.x, b.y - a.y);
    if (this.wallOnSegment(a.x, a.y, b.x, b.y, pad, length + pad)) return false;
    if (!hero || (opts.avoidTowers === false && !opts.retreat)) return true;
    /* Do not let route smoothing erase A*'s safer path by drawing a long line
       back through a turret circle or directly past the pursuer. */
    const steps = Math.max(1, Math.ceil(length / 70));
    /* Risk only rises near a live, uncovered enemy turret (or, retreating,
       a visible enemy). If none of those is within reach of the segment,
       every sample's risk is exactly 1 and cannot exceed `allowed`. */
    if (opts.avoidTowers !== false && !opts.retreat) {
      const D = this.navFrame().teams[hero.team].danger;
      let anyNear = false;
      for (let i = 0; i < D.length && !anyNear; i++) {
        const e = D[i], s = e.s;
        if (!s.alive) continue;
        const reach = e.edge + 1;
        if (segDist2(s.x, s.y, a.x, a.y, b.x, b.y) >= reach * reach) continue;
        if (e.covered()) continue;
        anyNear = true;
      }
      if (!anyNear) return true;
    }
    const allowed = Math.max(this.navRisk(hero, a.x, a.y, opts), this.navRisk(hero, b.x, b.y, opts)) + 0.75;
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (this.navRisk(hero, lerp(a.x, b.x, f), lerp(a.y, b.y, f), opts) > allowed) return false;
    }
    return true;
  },

  /* A* over the cached map grid. Returns meaningful turn points rather than
     every grid cell; the hero mover can then follow the route naturally. */
  findNavPath(hero, goal, opts = {}) {
    const grid = this.navGrid((hero ? hero.radius : 26) + 8);
    const startId = this.navCell(grid, hero.x, hero.y);
    const goalId = this.navCell(grid, goal.x, goal.y);
    if (startId < 0 || goalId < 0) return [];
    const count = grid.cols * grid.rows, cols = grid.cols, rows = grid.rows, cell = grid.cell;
    const blocked = grid.blocked;
    const risk = this.navRiskGrid(hero, grid, opts);
    /* Search scratch lives on the grid: no per-search allocation. The heap
       is two parallel arrays (ids, scores) run by the same sift rules the
       object heap used, so equal scores pop in the same order. */
    let W = grid.work;
    if (!W) {
      W = grid.work = {
        gScore: new Float64Array(count), came: new Int32Array(count), closed: new Uint8Array(count),
        hId: new Int32Array(count * 2), hScore: new Float64Array(count * 2),
      };
    }
    const gScore = W.gScore, came = W.came, closed = W.closed;
    gScore.fill(Infinity); came.fill(-1); closed.fill(0);
    let hId = W.hId, hScore = W.hScore, hn = 0;
    const gx = goalId % cols, gy = Math.floor(goalId / cols);
    const heuristic = id => {
      const x = id % cols, y = Math.floor(id / cols);
      return hyp(gx - x, gy - y) * cell;
    };
    const push = (id, score) => {
      if (hn === hId.length) {
        const nId = new Int32Array(hn * 2), nScore = new Float64Array(hn * 2);
        nId.set(hId); nScore.set(hScore);
        hId = W.hId = nId; hScore = W.hScore = nScore;
      }
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hScore[p] <= score) break;
        hId[i] = hId[p]; hScore[i] = hScore[p]; i = p;
      }
      hId[i] = id; hScore[i] = score;
    };
    const pop = () => {
      const root = hId[0];
      hn--;
      if (hn > 0) {
        const lastId = hId[hn], lastScore = hScore[hn];
        let i = 0;
        while (true) {
          let c = i * 2 + 1;
          if (c >= hn) break;
          if (c + 1 < hn && hScore[c + 1] < hScore[c]) c++;
          if (hScore[c] >= lastScore) break;
          hId[i] = hId[c]; hScore[i] = hScore[c]; i = c;
        }
        hId[i] = lastId; hScore[i] = lastScore;
      }
      return root;
    };

    gScore[startId] = 0; push(startId, heuristic(startId));
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    const diag = cell * Math.SQRT2;
    while (hn > 0) {
      const cur = pop();
      if (closed[cur]) continue;
      if (cur === goalId) break;
      closed[cur] = 1;
      const x = cur % cols, y = Math.floor(cur / cols);
      const g = gScore[cur];
      for (let k = 0; k < 8; k++) {
        const dx = DX[k], dy = DY[k];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (blocked[ni] || closed[ni]) continue;
        /* No diagonal corner cutting: both shoulder cells must be open. */
        if (dx && dy && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
        const step = (dx && dy ? diag : cell) * risk[ni];
        const score = g + step;
        if (score >= gScore[ni]) continue;
        came[ni] = cur; gScore[ni] = score;
        push(ni, score + heuristic(ni));
      }
    }
    if (goalId !== startId && came[goalId] < 0) return [];

    const raw = [];
    for (let at = goalId; at >= 0 && at !== startId; at = came[at]) {
      raw.push({ x: grid.minX + (at % grid.cols) * grid.cell,
        y: grid.minY + Math.floor(at / grid.cols) * grid.cell });
    }
    raw.reverse();
    const last = raw.length ? raw[raw.length - 1] : hero;
    if (this.navSegmentClear(hero, last, goal, opts)) raw.push({ x: goal.x, y: goal.y });

    const smooth = [], origin = { x: hero.x, y: hero.y };
    let from = origin, i = 0;
    while (i < raw.length) {
      let far = i;
      for (let j = raw.length - 1; j > i; j--) {
        if (this.navSegmentClear(hero, from, raw[j], opts)) { far = j; break; }
      }
      smooth.push(raw[far]); from = raw[far]; i = far + 1;
    }
    return smooth;
  },

  /* Deflect a step that would end inside a wall onto the wall's face, so a
     unit walking into terrain follows it round instead of standing still.
     Returns a replacement direction, {x:0,y:0} to stay put, or null to let the
     caller move as it intended. Dashes never come through here — they move
     their own position directly, which is how they cross walls. */
  wallSlide(u, ux, uy, step) {
    const walls = this.walls();
    if (!walls.length) return null;
    const nx = u.x + ux * step, ny = u.y + uy * step;
    const w = this.wallAt(nx, ny, u.radius);
    if (!w) { u.slideDir = null; return null; }
    const c = wallClosest(w, nx, ny);
    let ox = nx - c.x, oy = ny - c.y;
    const od = hyp(ox, oy);
    if (od < 0.01) { u.slideDir = null; return { x: 0, y: 0 }; }  // on the centreline; separate() ejects
    ox /= od; oy /= od;
    const tx = -oy, ty = ox;                  // the wall's face, as a direction
    /* Which way round? Normally the intent decides. But a unit walking *square*
       into a wall has almost no tangential intent, so that sign flips on
       floating-point noise and the unit vibrates on the spot instead of walking
       round. So a slide already under way wins the tie: commit to one way and
       hold it until the wall lets go. */
    const prev = u.slideDir;
    const along = ux * tx + uy * ty;
    const s = (prev && Math.abs(along) < 0.35 ? prev.x * tx + prev.y * ty : along) >= 0 ? 1 : -1;
    /* Try the chosen way, then the other. Rounding the end cap of a wall puts a
       unit somewhere both the way forward and the preferred way round are
       blocked, and a unit that simply stops there is stuck against a doorway
       for the rest of the match. Failing that, move as intended and let the
       push-out in separate() walk it back out — grinding beats deadlock. */
    for (const dir of [s, -s]) {
      const sx = tx * dir, sy = ty * dir;
      if (this.wallAt(u.x + sx * step, u.y + sy * step, u.radius)) continue;
      u.slideDir = { x: sx, y: sy };
      return { x: sx, y: sy };
    }
    u.slideDir = null;
    return null;
  },
  teamGold(team) {
    let g = 0;
    for (const h of this.heroes) if (h.team === team) g += h.goldEarned;
    return g;
  },
  /* A losing team gets a small, smoothly scaled income boost. At the 8k cap
     it is only 0.45 gold/s per hero (25% of passive income), enough to keep a
     comeback reachable without erasing earned leads. Duel mode stays pure. */
  goldDeficit(team) {
    if (this.isDuel()) return 0;
    return Math.max(0, this.teamGold(1 - team) - this.teamGold(team));
  },
  comebackFactor(team) {
    const span = BALANCE.comebackFullGold - BALANCE.comebackStartGold;
    return clamp((this.goldDeficit(team) - BALANCE.comebackStartGold) / span, 0, 1);
  },
  comebackGoldRate(team) {
    return BALANCE.comebackMaxGoldPerSec * this.comebackFactor(team);
  },
  /* Taking a structure or epic while behind is the active comeback route.
     Its direct gold scales up by at most 50%; the buff/map reward is unchanged. */
  objectiveGoldPerHero(team, base) {
    return base * (1 + BALANCE.objectiveComebackMax * this.comebackFactor(team));
  },
  /* Snapshot for the objective HUD: [{key, label, icon, up, in}] */
  objectiveState() {
    if (this.duelRune) {
      const d = JUNGLE_BUFFS[this.duelRune.kind];
      return [{
        key: 'shrine', icon: d.icon, label: d.name,
        up: this.duelRune.up, in: Math.max(0, this.duelRune.next),
      }];
    }
    if (!this.epics) return [];
    const out = [];
    for (const k of ['lord', 'turtle']) {
      const e = this.epics[k];
      // the turtle stops spawning once Lord is on the clock, as in ML
      if (k === 'turtle' && (this.time >= this.LORD_AT || (!e.unit && e.next === Infinity))) continue;
      out.push({
        key: k,
        icon: this.isTen() ? (k === 'lord' ? '🌋' : '🕯️') : (k === 'lord' ? '👑' : '🐢'),
        label: k === 'lord'
          ? (this.isTen()
            ? ((e.unit && e.unit.evolved) || this.time >= BALANCE.ancientLordAt ? 'Elder Colossus' : 'Colossus')
            : ((e.unit && e.unit.evolved) || this.time >= BALANCE.ancientLordAt ? 'Elder Warden' : 'Warden'))
          : (this.isTen() ? 'Sentinel' : 'Leviathan'),
        up: !!(e.unit && e.unit.alive),
        in: Math.max(0, e.next - this.time),
      });
    }
    return out;
  },
  /* ---------- pings ----------
     A ping is a world-space marker with a team, so it shows on the minimap
     and in the world for allies only. Bots ping too — a retreat call from a
     bot is the only way the player learns what the bot is about to do. */
  PING_KINDS: {
    danger:   { icon: '⚠', label: 'Danger',      color: '#ff4d6d' },
    retreat:  { icon: '↩', label: 'Retreat',     color: '#fbbf24' },
    attack:   { icon: '⚔', label: 'Attack',      color: '#ff9d5c' },
    gather:   { icon: '🎯', label: 'Gather',     color: '#4cc2ff' },
    help:     { icon: '🆘', label: 'Need help',  color: '#a78bfa' },
    omw:      { icon: '🏃', label: 'On my way',  color: '#4ade80' },
    missing:  { icon: '❓', label: 'Missing',     color: '#e879f9' },
    turtle:   { icon: '🐢', label: 'Leviathan',   color: '#4ade80' },
    lord:     { icon: '👑', label: 'Warden',      color: '#ffc94a' },
    careful:  { icon: '👀', label: 'Careful',     color: '#fbbf24' },
  },
  ping(kind, x, y, by) {
    if (!this.PING_KINDS[kind]) return;
    // one ping per source at a time, so a panicking bot cannot spam the map
    this.pings = this.pings.filter(p => p.by !== by);
    this.pings.push({ kind, x, y, team: by ? by.team : TEAM_BLUE, by, age: 0 });
    if (by && by.team === TEAM_BLUE && !this.spectate) SFX.ping();
    UI.pingFeed(kind, by);
  },

  /* ---------- surrender ----------
     Available after 8 minutes, 4 of 5 to pass. Bots vote on how badly the
     match is actually going rather than at random. */
  SURRENDER_AT: 480,
  startSurrender(team, by) {
    if (this.surrender) return false;
    if (this.time < this.SURRENDER_AT) {
      if (by && by.isPlayer) UI.announce(`Surrender unlocks at ${this.SURRENDER_AT / 60}:00`, 'minor');
      return false;
    }
    const voters = this.heroes.filter(h => h.team === team);
    let yes = 1, no = 0;
    for (const h of voters) {
      if (h === by) continue;
      if (h.isPlayer) continue;          // the player votes through the UI
      // a bot agrees when the game is genuinely lost, not on a whim
      const behind = this.teamGold(1 - team) - this.teamGold(team);
      const structs = this.structures().filter(s => s.team === team && s.alive).length;
      const enemyStructs = this.structures().filter(s => s.team !== team && s.alive).length;
      const hopeless = behind > 9000 && structs < enemyStructs - 3;
      if (hopeless) yes++; else no++;
    }
    this.surrender = { team, yes, no, endsAt: this.time + 12 };
    UI.announce(`🏳 ${TEAM_NAMES[team]} called a surrender vote (${yes}/${voters.length})`, 'minor');
    return true;
  },
  resolveSurrender() {
    const v = this.surrender;
    if (!v) return;
    const need = Math.ceil(this.heroes.filter(h => h.team === v.team).length * 0.8);
    if (v.yes >= need) {
      UI.announce(`🏳 ${TEAM_NAMES[v.team]} surrendered`, 'major');
      this.surrender = null;
      this.endGame(1 - v.team);
      return;
    }
    UI.announce('Surrender vote failed', 'minor');
    this.surrender = null;
  },

  /* Turtle: 120 s after each death, but nothing is scheduled after a death at
     6:00 or later, so there are at most three (2:00, ~4:30, ~7:00) before the
     Lord takes the clock at 8:00. Lord: 180 s, 120 s from 20:00. */
  scheduleEpic(kind) {
    const e = this.epics[kind];
    e.unit = null;
    if (kind === 'turtle' && !this.isTen() && this.time >= BALANCE.turtleLastSpawnBefore) { e.next = Infinity; return; }
    const lordRespawn = this.time >= BALANCE.lateSiegeAt ? 120 : this.LORD_RESPAWN;
    e.next = this.time + (kind === 'lord' ? lordRespawn : this.TURTLE_RESPAWN);
  },
  /* Wave composition per lane. Side lanes: melee + ranged + siege from wave
     one; mid: melee + three ranged until the cannon joins from wave 11. The
     array order is the marching order (first = front). 10v10 keeps its own
     smaller waves. */
  WAVE_SIDE: ['melee', 'ranged', 'siege'],
  WAVE_MID_EARLY: ['melee', 'ranged', 'ranged', 'ranged'],
  WAVE_TEN: ['melee', 'melee', 'ranged'],
  waveComposition(lane, waveN) {
    if (this.isTen()) return this.WAVE_TEN;
    if (lane === 'mid' && waveN < BALANCE.midCannonFromWave) return this.WAVE_MID_EARLY;
    return this.WAVE_SIDE;
  },
  /* The lane a Summoned Lord walks: fewest live enemy structures on that
     polyline (turret labels are physical for both teams), tie -> the enemy
     outer with the least HP, tie -> mid. */
  lordMinionLane(team) {
    const lanes = this.pushLanes();
    let best = 'mid', bestScore = -Infinity;
    for (const lane of lanes) {
      let left = 0, outerHp = 1;
      for (const t of this.towers) {
        if (!t.alive || t.team === team || t.lane !== lane) continue;
        left++;
        if (t.tier === 'outer') outerHp = t.hp / t.maxHp;
      }
      for (const inh of this.inhibitors) if (inh.alive && inh.team !== team && inh.lane === lane) left++;
      const score = -left * 10 - outerHp + (lane === 'mid' ? 0.001 : 0);
      if (score > bestScore) { bestScore = score; best = lane; }
    }
    return best;
  },
  /* One Summoned Lord per Lord kill (one per lane once the Lord has evolved),
     starting at the river so it arrives while the fight that won it still
     matters. Waves spawned by the killing team are enhanced for a minute. */
  spawnLordMinion(team, evolved = false) {
    this.waveBoost[team] = this.time + BALANCE.lordWaveBoost;
    if (evolved) {
      for (const lane of this.pushLanes()) this.minions.push(new LordMinion(team, lane, true));
      UI.announce(this.isTen()
        ? '🌋 ELDER COLOSSUS — siege engines on every road!'
        : '👑 ANCIENT LORD — empowered waves marching every lane!', 'major');
      return;
    }
    const best = this.lordMinionLane(team);
    this.minions.push(new LordMinion(team, best, false));
    UI.announce(this.isTen() ? `🌋 Colossus engine marching ${best}!` : `👑 The Warden's host marching ${best}!`, 'minor');
  },
  enemyUnits(team, opts = {}) {
    const out = [];
    for (const h of this.heroes) if (h.team !== team && h.alive && !h.untargetable) out.push(h);
    for (const m of this.minions) if (m.team !== team && m.alive) out.push(m);
    if (opts.neutral) for (const mo of this.monsters) if (mo.alive) out.push(mo);
    if (opts.structures) for (const t of this.structures()) if (t.team !== team && t.alive) out.push(t);
    return out;
  },
  /* ---------- vision ----------
     A coarse per-team occupancy grid, rebuilt each frame. Stamping circles
     into a grid once costs far less than the alternative — canSee is called
     dozens of times per bot per think tick, and a naive version would walk
     every allied unit each time.

     Only heroes, structures and minions grant vision, at deliberately
     different radii: heroes see far, minions barely past their own nose.
     That is what makes warding lanes with a minion wave meaningfully
     different from standing there yourself. */
  VIS_N: 64,
  vision: null,
  explored: null,          // sticky union of every cell the player's team has seen
  visionRadius(u) {
    if (u.isStructure) return u.isBase ? 900 : 760;
    if (u.type === 'hero') return 900;
    return 420;
  },
  updateVision() {
    const N = this.VIS_N, cell = this.worldSize() / N;
    if (!this.vision) this.vision = [new Uint8Array(N * N), new Uint8Array(N * N)];
    if (!this.explored) this.explored = new Uint8Array(N * N);

    const stamp = (g, x, y, r) => {
      const cx = x / cell, cy = y / cell, cr = r / cell;
      const x0 = Math.max(0, Math.floor(cx - cr)), x1 = Math.min(N - 1, Math.ceil(cx + cr));
      const y0 = Math.max(0, Math.floor(cy - cr)), y1 = Math.min(N - 1, Math.ceil(cy + cr));
      const cr2 = cr * cr;
      /* Each row of the circle is one span. Its ends are found with the
         exact per-cell test (the span is an interval, so scanning in from a
         safe outer bound stops at the first cell that passes); the inside
         is filled in one call rather than tested cell by cell. */
      for (let gy = y0; gy <= y1; gy++) {
        const dy = gy + 0.5 - cy, dy2 = dy * dy;
        if (dy2 > cr2) continue;
        const half = Math.sqrt(cr2 - dy2);
        let lo = Math.max(x0, Math.floor(cx - 0.5 - half) - 1);
        let hi = Math.min(x1, Math.ceil(cx - 0.5 + half) + 1);
        while (lo <= hi) { const dx = lo + 0.5 - cx; if (dx * dx + dy2 <= cr2) break; lo++; }
        while (hi >= lo) { const dx = hi + 0.5 - cx; if (dx * dx + dy2 <= cr2) break; hi--; }
        const base = gy * N;
        for (let k = base + lo; k <= base + hi; k++) g[k] = 1;
      }
    };
    /* Structures never move, so the vision they grant is a fixed layer per
       team that only changes when one falls or an inhibitor comes back. It is
       kept and copied in as the frame's starting grid; heroes and minions are
       stamped on top. */
    if (!this._staticVision) this._staticVision = [{ key: null, g: new Uint8Array(N * N) }, { key: null, g: new Uint8Array(N * N) }];
    for (const t of [TEAM_BLUE, TEAM_RED]) {
      let key = this.mode + ':';
      const S = this.structures();
      for (let i = 0; i < S.length; i++) if (S[i].team === t && S[i].alive) key += i + ',';
      const sv = this._staticVision[t];
      if (sv.key !== key || sv.n !== N) {
        sv.key = key; sv.n = N;
        if (sv.g.length !== N * N) sv.g = new Uint8Array(N * N);
        sv.g.fill(0);
        for (const s of S) if (s.team === t && s.alive) stamp(sv.g, s.x, s.y, this.visionRadius(s));
      }
      const g = this.vision[t];
      g.set(sv.g);
      for (const h of this.heroes) if (h.team === t && h.alive) stamp(g, h.x, h.y, this.visionRadius(h));
      for (const m of this.minions) if (m.team === t && m.alive) stamp(g, m.x, m.y, this.visionRadius(m));
      if (typeof Features !== 'undefined') {
        for (const w of Features.wards) if (w.team === t && w.t > 0) stamp(g, w.x, w.y, w.r || 420);
        for (const h of this.heroes) if (h.team === t && h.alive && h.sweepT > 0) stamp(g, h.x, h.y, 380);
      }
    }
    // remember where the player's team has been, for the fog's middle state
    const pv = this.vision[TEAM_BLUE], ex = this.explored;
    for (let i = 0; i < ex.length; i++) if (pv[i]) ex[i] = 1;
  },
  visible(team, x, y) {
    if (!this.vision) return true;
    const N = this.VIS_N, cell = this.worldSize() / N;
    const gx = clamp(Math.floor(x / cell), 0, N - 1);
    const gy = clamp(Math.floor(y / cell), 0, N - 1);
    return this.vision[team][gy * N + gx] === 1;
  },

  canSee(team, u) {
    if (u.team === team) return true;
    if (u.isStructure) return true;         // structures are always on the map
    if (u.untargetable) return false;       // F19: a Shade-Stepped hero is nobody's target
    // The duel arena has no fog: it is small enough that hiding in it would
    // only mean walking around looking for each other.
    if (this.isDuel()) return true;
    if (u.concealT > 0 && this.concealedFrom(team, u)) return false;   // F13
    if (typeof Mlbb !== 'undefined' && Mlbb.bushHiddenFrom(team, u)) return false;
    return this.visible(team, u.x, u.y);
  },
  /* F13 conceal: hidden like a bush, unless revealed (dealing damage does
     that for 1.6 s) or an enemy hero is right on top of the unit. */
  concealedFrom(team, u) {
    if (u.revealT > 0) return false;
    for (const h of this.heroes) {
      if (h.team !== team || !h.alive) continue;
      if (dist(h, u) < 72) return false;
    }
    return true;
  },
  targetMatchesMode(u, mode = 'auto') {
    if (mode === 'hero') return u.type === 'hero';
    if (mode === 'lane') return u.type === 'minion' || u.isStructure;
    return true;
  },
  basicAttackDamage(hero, target) {
    if (!hero || !target) return 0;
    const mult = mitigation(target.armorValue(), hero.attrs.get('physPen'), hero.attrs.get('physPenPct'));
    return Math.max(1, Math.round(hero.curAtk() * mult));
  },
  canLastHit(hero, target) {
    return !!(target && target.alive && target.type === 'minion' &&
      this.basicAttackDamage(hero, target) >= target.hp);
  },
  validLockedTarget(hero, target, maxDist) {
    return !!(target && target.alive && target.team !== hero.team && target.type === 'hero' &&
      this.canSee(hero.team, target) && dist(hero, target) - target.radius <= maxDist);
  },
  screenToWorld(sx, sy) {
    const z = (this.cam && this.cam.zoom) || 1;
    const vw = (typeof CW === 'number' && CW > 0) ? CW : innerWidth;
    const vh = (typeof CH === 'number' && CH > 0) ? CH : innerHeight;
    // vertical axis divides by TILT too: the ground plane is drawn squashed
    return { x: this.cam.x + (sx - vw / 2) / z, y: this.cam.y + (sy - vh / 2) / (z * TILT) };
  },
  acquireTarget(hero, maxDist, mode = 'auto', priority = 'lowHp', aim = null) {
    let best = null, bestScore = Infinity;
    const lastHitAssist = hero.isPlayer && (mode === 'lane' || !Input.attackHeld);
    for (const u of this.enemyUnits(hero.team, { structures: true, neutral: true })) {
      if (!this.targetMatchesMode(u, mode)) continue;
      const d = dist(hero, u);
      if (d - u.radius > maxDist) continue;
      if (!this.canSee(hero.team, u)) continue;
      let score;
      if (aim) {
        const md = Math.hypot(u.x - aim.x, u.y - aim.y) - u.radius;
        const hovered = md <= 24;
        /* Cursor-over-unit always wins. Otherwise pick whoever sits nearest
           the mouse, with a light last-hit / hero nudge as a tie-break. */
        score = hovered ? md - 2500 : md * 1.25 + d * 0.2;
        if (!hovered && u.type === 'hero' && mode === 'auto') {
          score -= priority === 'nearest' ? 40 : 80;
        }
        if (lastHitAssist && this.canLastHit(hero, u)) score -= hovered ? 30 : 200;
      } else {
        score = d;
        if (u.type === 'hero') {
          score = priority === 'nearest' ? d : u.hpPct * 1000 + d * 0.15;
          // The general attack button still favours heroes, while its dedicated
          // sibling compares only heroes and therefore needs no type bonus.
          if (mode === 'auto') score -= priority === 'nearest' ? 140 : 400;
        }
        if (mode === 'lane' && u.isStructure) score += 100;
        // Farming: prefer a minion you can last-hit when not attack-moving.
        if (lastHitAssist && this.canLastHit(hero, u)) score -= 600;
      }
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  },
  /* F9: does an enemy barrier lie across the path (ax,ay)->(bx,by)? `len`
     caps the path (a homing shot only travels its step). Proper segment
     intersection: a projectile that ends exactly on the line still counts. */
  barrierBlocks(team, ax, ay, bx, by, len) {
    if (len !== undefined) {
      const dx = bx - ax, dy = by - ay, d = hyp(dx, dy);
      if (d > len && d > 0) { bx = ax + dx / d * len; by = ay + dy / d * len; }
    }
    for (const o of this.objects) {
      if (o.dead || o.mode !== 'barrier' || o.team === team) continue;
      const r = (o.bx - o.ax) * (by - ay) - (o.by - o.ay) * (bx - ax);
      if (Math.abs(r) < 1e-9) continue;   // parallel
      const qx = ax - o.ax, qy = ay - o.ay;
      const t = (qx * (by - ay) - qy * (bx - ax)) / r;        // along the barrier
      const u = (qx * (o.by - o.ay) - qy * (o.bx - o.ax)) / r; // along the path
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return o;
    }
    return null;
  },
  /* F16: register a tether (see the Tether class). */
  addTether(spec) {
    const t = new Tether(spec);
    this.tethers.push(t);
    return t;
  },
  /* Lead a moving target for skillshots / delayed zones. */
  aimLeadPoint(from, target, projSpeed) {
    if (!target) return { x: from.x, y: from.y };
    const spd = Math.max(200, projSpeed || 800);
    const d = dist(from, target);
    const t = Math.min(0.85, d / spd);
    const vx = target.vx || 0, vy = target.vy || 0;
    return { x: target.x + vx * t, y: target.y + vy * t };
  },
  autoAimPoint(hero, s) {
    const reach = (s.range || s.dist || 500) + 150;
    let best = null, bd = Infinity;
    for (const u of this.enemyUnits(hero.team, { neutral: true })) {
      const d = dist(hero, u);
      if (d > reach || !this.canSee(hero.team, u)) continue;
      const score = d - (u.type === 'hero' ? 250 : 0) - (u.type === 'hero' && u.hpPct < 0.35 ? 80 : 0);
      if (score < bd) { bd = score; best = u; }
    }
    if (best) {
      if (s && (s.type === 'skillshot' || s.speed)) return this.aimLeadPoint(hero, best, s.speed);
      if (s && s.type === 'zone') return this.aimLeadPoint(hero, best, 500);
      return { x: best.x, y: best.y };
    }
    return { x: hero.x + Math.cos(hero.facing) * 200, y: hero.y + Math.sin(hero.facing) * 200 };
  },

  /* ---------- update ---------- */
  update(dt) {
    this.time += dt;
    // hard cap: at 30 min the healthier base wins (keeps training loops moving)
    if (!this.isDuel() && this.time > 1800) {
      const hp0 = this.bases[0].hp / this.bases[0].maxHp, hp1 = this.bases[1].hp / this.bases[1].maxHp;
      const winner = hp0 !== hp1 ? (hp0 > hp1 ? TEAM_BLUE : TEAM_RED)
        : (this.kills[0] >= this.kills[1] ? TEAM_BLUE : TEAM_RED);
      UI.announce('⏱ Time! Decided on base health', 'major');
      this.endGame(winner);
      return;
    }

    if (!this.isDuel() && this.phaseFlags) {
      if (!this.phaseFlags.laningEnded && this.time >= BALANCE.laneBonusEnd) {
        this.phaseFlags.laningEnded = true;
        UI.announce(this.isTen()
          ? '🛡 TURRET SHIELDS DOWN — Dusk tribute and Dawn ascendant bonuses ended'
          : '🛡 TURRET SHIELDS DOWN — cannon gold and EXP bonuses ended', 'major');
      }
      if (!this.phaseFlags.ancientLord && this.time >= BALANCE.ancientLordAt) {
        this.phaseFlags.ancientLord = true;
        const liveLord = this.epics && this.epics.lord.unit;
        if (liveLord && liveLord.alive && liveLord.evolve) liveLord.evolve();
        UI.announce(this.isTen()
          ? '🌋 THE ELDER COLOSSUS HAS AWAKENED — siege on every road'
          : '👑 ANCIENT LORD HAS AWAKENED — three-lane siege unlocked', 'major');
      }
    }

    // minion waves
    if (!this.isDuel()) this.waveT -= dt;
    if (!this.isDuel() && this.waveT <= 0) {
      this.waveT += BALANCE.waveInterval;
      this.waveN++;
      if (this.minions.length < (this.isTen() ? 260 : 180)) {
        for (const team of [TEAM_BLUE, TEAM_RED]) {
          for (const lane of this.pushLanes()) {
            const kinds = this.waveComposition(lane, this.waveN);
            const inh = this.inhibitors.find(x => x.team !== team && x.lane === lane);
            const superN = inh && !inh.alive ? 1 : 0;
            const count = kinds.length + superN;
            kinds.forEach((kind, i) => this.minions.push(new Minion(team, lane, kind, i, count)));
            if (superN) this.minions.push(new SuperMinion(team, lane, kinds.length, count));
          }
        }
      }
    }
    // jungle respawns
    for (const c of this.camps) {
      if (c.respawnT > 0) {
        c.respawnT -= dt;
        if (c.respawnT <= 0) this.monsters.push(new BuffMonster(c));
      }
    }

    // epic objectives
    if (this.epics) {
      for (const k of ['turtle', 'lord']) {
        const e = this.epics[k];
        if (e.unit && !e.unit.alive) e.unit = null;
        if (e.unit) continue;
        // the turtle retires once Lord is due, so the pit only ever holds one
        if (k === 'turtle' && this.time >= this.LORD_AT && !this.isTen()) continue;
        if (this.time >= e.next) {
          if (k === 'turtle' && this.isTen()) {
            e.pos = (e.n++ % 2 === 0) ? TEN_MAP.beaconWest : TEN_MAP.beaconEast;
          }
          e.unit = new EpicMonster(k, e.pos);
          this.monsters.push(e.unit);
          const spawnName = this.isTen()
            ? (k === 'lord' ? '🌋 THE COLOSSUS' : '🕯️ The Sentinel')
            : (k === 'lord' ? '👑 THE WARDEN' : '🐢 The Leviathan');
          UI.announce(`${spawnName} has spawned!`, 'major');
        }
      }
      // when Lord's clock arrives, clear any turtle still sitting in the world
      if (!this.isTen() && this.time >= this.LORD_AT && this.epics.turtle.unit && this.epics.turtle.unit.alive) {
        this.epics.turtle.unit.alive = false;
        this.epics.turtle.unit = null;
      }
    }

    /* Sieges are sequential: a tier is immune until every tower farther down
       that lane has fallen; an inhibitor is immune while its inner turret
       stands; the crystal is immune while all of its inhibitors stand. */
    for (const t of this.towers) {
      if (!t.alive) continue;
      t.shieldedByOuter = this.towers.some(o => o.alive && o.team === t.team &&
        o.lane === t.lane && o.frac > t.frac);
    }
    for (const inh of this.inhibitors) {
      if (!inh.alive) continue;
      inh.shieldedByOuter = this.towers.some(o => o.alive && o.team === inh.team && o.lane === inh.lane);
    }
    for (const b of this.bases) {
      if (!b.alive) continue;
      b.shieldedByOuter = this.inhibitors.length > 0 && this.inhibitors.every(i => i.team !== b.team || i.alive);
    }

    for (const inh of this.inhibitors) inh.update(dt);

    // pings fade after 4s; the vote resolves on its own clock
    for (const pg of this.pings) pg.age += dt;
    this.pings = this.pings.filter(pg => pg.age < 4);
    if (this.surrender && this.time >= this.surrender.endsAt) this.resolveSurrender();

    // team gold sampled twice a minute — enough shape for the post-match graph
    this.goldSampleT -= dt;
    if (this.goldSampleT <= 0) {
      this.goldSampleT = 30;
      this.goldHistory.push({ t: this.time, blue: this.teamGold(TEAM_BLUE), red: this.teamGold(TEAM_RED) });
    }

    this.updateDuelRune(dt);

    const bushes = this.bushes();
    for (const h of this.heroes) {
      h.bush = -1; h.inRiver = false;
      if (!h.alive) continue;
      for (let i = 0; i < bushes.length; i++) {
        if (inBush(bushes[i], h.x, h.y)) { h.bush = i; break; }
      }
      if (!this.isDuel()) {
        if (this.isTen()) {
          const vein = TEN_MAP.vein;
          let best = Infinity;
          for (let i = 1; i < vein.length; i++) {
            const c = segClosest(h.x, h.y, vein[i - 1].x, vein[i - 1].y, vein[i].x, vein[i].y);
            const d = (h.x - c.x) * (h.x - c.x) + (h.y - c.y) * (h.y - c.y);
            if (d < best) best = d;
          }
          h.inRiver = best <= 110 * 110;
        } else {
          // the river channel and both pit pools carry the current
          const currentR = RIVER_HALF_W;
          let best = Infinity;
          for (const s of STREAMS) {
            for (let i = 1; i < s.length; i++) {
              const d = segDist2(h.x, h.y, s[i - 1].x, s[i - 1].y, s[i].x, s[i].y);
              if (d < best) best = d;
            }
          }
          h.inRiver = best <= currentR * currentR ||
            POOLS.some(p => (h.x - p.x) * (h.x - p.x) + (h.y - p.y) * (h.y - p.y) <= p.r * p.r);
        }
      }
    }

    // Every canSee below this line — bots, targeting, rendering — reads the grid.
    this.updateVision();

    // Fountains heal allies in every mode. Standard-mode fountains also zap
    // intruders; duel bases are recovery zones without defensive structures.
    for (const team of [TEAM_BLUE, TEAM_RED]) {
      const b = this.fountain(team);
      for (const h of this.heroes) {
        if (!h.alive) continue;
        const d = hyp(h.x - b.x, h.y - b.y);
        if (d < 300) {
          if (h.team === team) {
            h.heal(h.maxHp * 0.10 * dt);
            if (h.resource === 'energy') h.gainEnergy(h.maxMana * 0.12 * dt);
            else h.gainMana(h.maxMana * 0.12 * dt);
          } else if (!this.isDuel() && this.bases[team] && this.bases[team].alive) {
            h.takeDamage(350 * dt, this.bases[team]);
          }
        }
      }
    }

    for (const h of this.heroes) h.update(dt);
    for (const m of this.minions) m.update(dt);
    for (const mo of this.monsters) mo.update(dt);
    for (const t of this.towers) t.update(dt);
    for (const b of this.bases) b.update(dt);
    for (const p of this.projectiles) p.update(dt);
    for (const z of this.zones) z.update(dt);
    if (this.tethers.length) {
      for (const t of this.tethers) t.update(dt);
      this.tethers = this.tethers.filter(t => !t.dead);
    }
    if (this.objects.length) {
      for (const o of this.objects) o.update(dt);
      this.objects = this.objects.filter(o => !o.dead);
    }

    this.minions = this.minions.filter(m => m.alive);
    this.monsters = this.monsters.filter(m => m.alive);
    this.projectiles = this.projectiles.filter(p => !p.dead);
    this.zones = this.zones.filter(z => !z.dead);

    this.separate();
    if (typeof Features !== 'undefined') Features.update(dt);
    if (typeof Mlbb !== 'undefined') Mlbb.update(dt);
  },

  pause() {
    if (this.attract) return;   // nothing to protect; the frame loop already idles when hidden
    if (this.paused || this.state !== 'play' || this.spectate) return;
    this.paused = true;
    if (UI.showPause) UI.showPause(true);
  },
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._clockReset = true;
    if (UI.showPause) UI.showPause(false);
  },

  /* Camera runs on the display clock, not the 60 Hz sim clock, so a 120 Hz
     panel still eases instead of hitching between simulation ticks. */
  updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 9);
    const zK = 1 - Math.exp(-dt * 11);
    if (this.cam.zoomWant == null) this.cam.zoomWant = this.cam.zoom;
    this.cam.zoom += (this.cam.zoomWant - this.cam.zoom) * zK;

    if (this.spectate) {
      if (this.followHero && !this.followHero.alive) this.followHero = null;
      if (this.followHero) {
        this.cam.x += (this.followHero.x - this.cam.x) * k;
        this.cam.y += (this.followHero.y - this.cam.y) * k;
      } else {
        const mv = Input.moveVector();
        if (mv) {
          this.cam.x += mv.x * 1300 / this.cam.zoom * dt;
          this.cam.y += mv.y * 1300 / this.cam.zoom * dt;
        }
      }
      this.clampSpectatorCamera();
      return;
    }
    const p = this.player;
    if (!p) return;
    let tx = p.x, ty = p.y;
    if (!p.alive) {
      const ftn = this.fountain(p.team);
      const arrive = p.respawnT < 1.55 ? clamp(1 - p.respawnT / 1.55, 0, 1) : 0;
      const a = arrive * arrive;
      tx = lerp(p.x, ftn.x, a);
      ty = lerp(p.y, ftn.y, a);
    } else {
      // small look-ahead so the cam leads motion without overshooting a stop
      tx += (p.vx || 0) * 0.05;
      ty += (p.vy || 0) * 0.05;
      const peek = (typeof Features !== 'undefined' ? Features.prefs.peek : 0);
      if (peek > 0 && Input.mouse && Input.mouse.seen && Input.isFinePointer && Input.isFinePointer() &&
          !(typeof Features !== 'undefined' && Features.camLock)) {
        tx += (Input.mouse.x / Math.max(1, CW) - 0.5) * 170 * peek;
        ty += (Input.mouse.y / Math.max(1, CH) - 0.5) * 170 * peek;
      }
    }
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  },

  separate() {
    const walls = this.walls();
    const mob = [];
    for (const h of this.heroes) if (h.alive && !h.dashS && !h.forced) mob.push(h);
    for (const m of this.minions) if (m.alive) mob.push(m);
    for (const mo of this.monsters) if (mo.alive) mob.push(mo);
    /* Units never block each other (heroes walk through minions, monsters and
       other heroes, as in the reference game); only structures and terrain
       push them out. */
    const useGrid = !this.isDuel() && !this.isTen();
    for (let i = 0; i < mob.length; i++) {
      const a = mob[i];
      /* Immovable structures push mobiles out, in structures() order. Only the
         structures near the unit can overlap it, so each pass looks at the
         grid cell's candidates; after a push the unit has moved, so the
         candidates are fetched again for the new spot and the walk resumes
         after the structure that pushed — the same sequence of tests and
         pushes the full loop made. */
      let from = 0;
      for (;;) {
        const near = useGrid ? this.structuresNear(a.x, a.y, a.radius) : this.structures();
        let pushed = false;
        for (let k = 0; k < near.length; k++) {
          const s = near[k];
          if (!s.alive || (useGrid && s._sIndex < from)) continue;
          const dx = a.x - s.x, dy = a.y - s.y;
          const min = a.radius + s.radius - 2;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 < 1e-4) continue;
          const d = Math.sqrt(d2);
          a.x = s.x + dx / d * min; a.y = s.y + dy / d * min;
          if (!useGrid) continue;
          from = s._sIndex + 1; pushed = true;
          break;
        }
        if (!pushed) break;
      }
      if (!this.isDuel() && !this.isTen() && WALL_DIST.clear(a.x, a.y, a.radius)) { a.clampWorld(); continue; }
      /* Walls do the same. Movement already slides along them, so this is the
         backstop for everything that does not go through moveToward — a dash
         that ends inside a rock, a knock-back, two units squeezing a third. */
      for (const w of walls) {
        if (w.minX !== undefined && (a.x < w.minX - a.radius || a.x > w.maxX + a.radius ||
            a.y < w.minY - a.radius || a.y > w.maxY + a.radius)) continue;
        const c = wallClosest(w, a.x, a.y);
        let dx = a.x - c.x, dy = a.y - c.y;
        const d = Math.hypot(dx, dy);
        const min = c.r + a.radius;
        if (!c.inside && d >= min) continue;
        if (c.inside) { dx = -dx; dy = -dy; }   // inside a polygon: leave through the nearest edge
        if (d < 0.01) {           // dead centre: leave along the nearest segment's normal
          if (w.circle) { a.x = c.x + min; a.y = c.y; continue; }
          const p0 = w.pts[0], p1 = w.pts[w.pts.length - 1];
          dx = -(p1.y - p0.y); dy = p1.x - p0.x;
          const n = Math.hypot(dx, dy) || 1;
          a.x = c.x + dx / n * min; a.y = c.y + dy / n * min;
          continue;
        }
        a.x = c.x + dx / d * min; a.y = c.y + dy / d * min;
      }
      a.clampWorld();
    }
  },

  /* ---------- effects ---------- */
  shakeAmp: 0, shakeT: 0, shakeX: 0, shakeY: 0,

  fx: {
    push(e) { Game.effects.push(e); },

    /* Screen shake. Amplitude in screen pixels; repeated calls take the
       strongest rather than summing, so a teamfight cannot black out the
       camera. Spectators get it too — it reads as impact, not as damage. */
    shake(amp, dur = 0.28) {
      if (REDUCE_MOTION) return;
      const scale = (typeof Features !== 'undefined' && Features.prefs) ? Features.prefs.shake : 1;
      amp *= scale;
      if (amp <= 0.01) return;
      if (amp <= Game.shakeAmp && Game.shakeT > 0) return;
      Game.shakeAmp = amp; Game.shakeT = dur; Game.shakeDur = dur;
    },

    /* --- transient range indicators (player only) ---
       {key?, unit|x,y, r, color, dur, fill?, dash?, lw?, grow?}
       A keyed indicator refreshes in place instead of stacking, so holding
       attack keeps one ring alive rather than piling up dozens. */
    range(o) {
      if (o.key) {
        const ex = Game.indicators.find(i => i.key === o.key);
        if (ex) { Object.assign(ex, o); ex.age = 0; return; }
      }
      Game.indicators.push(Object.assign({ dur: 0.9, color: '#fff', lw: 3, age: 0 }, o));
    },
    attackRange(u) {
      this.range({ key: 'atk', unit: u, r: u.range + u.radius, color: THEME.gold, dur: 0.85, lw: 2.5, dash: true });
    },
    /* flash the shape a skill just covered, so keyboard casts read the same
       as drag-aimed ones */
    skillRange(h, s, at) {
      const c = h.color || '#fff';
      switch (s.type) {
        case 'nova':
          this.range({ unit: h, r: s.radius, color: c, dur: 0.8, fill: true, grow: true });
          break;
        case 'heal':
          this.range({ unit: h, r: s.radius, color: THEME.heal, dur: 0.9, fill: true, grow: true });
          break;
        case 'buff':
          this.range({ unit: h, r: 130, color: c, dur: 0.8, fill: true, grow: true });
          break;
        case 'dash':
          this.range({ unit: h, r: s.dist, color: c, dur: 0.7, dash: true, lw: 2.5 });
          if (s.endNova && at) this.range({ x: at.x, y: at.y, r: s.endNova.radius, color: c, dur: 0.8, fill: true });
          break;
        default:   // skillshot / zone / blinkstrike — show the cast range
          this.range({ unit: h, r: s.range || 400, color: c, dur: 0.7, dash: true, lw: 2.5 });
          if (s.type === 'zone' && at) this.range({ x: at.x, y: at.y, r: s.radius, color: c, dur: 0.9 });
      }
    },
    ghost(u) {
      this.push({
        kind: 'ghost', x: u.x, y: u.y, r: u.radius,
        shape: (typeof ROLE_SHAPE !== 'undefined' && u.def0) ? (ROLE_SHAPE[u.def0.role] || 'circle') : 'circle',
        color: u.color || TEAM_COLORS[u.team],
        dur: 0.32, age: 0,
      });
    },
    ring(x, y, r, color, dur = 0.4) { this.push({ kind: 'ring', x, y, r, color, dur, age: 0 }); },
    slash(x, y, ang, team) {
      this.push({ kind: 'slash', x, y, ang, dur: 0.18, age: 0, color: team === undefined ? '#fff' : TEAM_COLORS[team] });
    },
    spark(x, y, color, n = 6) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = rand(60, 220);
        this.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, dur: rand(0.25, 0.5), age: 0 });
      }
    },
    /* Spinning debris triangles. The one effect that sells "something broke". */
    shards(x, y, color, n = 9, speed = 340) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = rand(speed * 0.35, speed);
        this.push({
          kind: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          rot: rand(0, TAU), vr: rand(-9, 9), size: rand(4, 9),
          color, dur: rand(0.4, 0.75), age: 0,
        });
      }
    },
    flash(x, y, r, color = '#fff') { this.push({ kind: 'flash', x, y, r, color, dur: 0.22, age: 0 }); },
    rays(x, y, color, r1 = 150, n = 12) { this.push({ kind: 'rays', x, y, r1, n, color, dur: 0.4, age: 0 }); },
    /* Ultimate cast: a flash, a shock ring and radial rays in the hero's
       colour. Ults decide fights; the cast itself should be unmissable. */
    ultBlast(u) {
      const c = u.color || THEME.gold;
      this.flash(u.x, u.y, 90, '#fff');
      this.rays(u.x, u.y, c, 170, 14);
      this.ring(u.x, u.y, 130, c, 0.55);
    },
    /* Per-skill world juice so kits read as themselves, not a shared ring. */
    skillCast(h, s, at) {
      const c = h.color || THEME.gold;
      const col = (typeof DMG_COLORS !== 'undefined' && s.dmgType && DMG_COLORS[s.dmgType]) || c;
      const ox = h.x + Math.cos(h.facing) * 28, oy = h.y + Math.sin(h.facing) * 28;
      switch (s.type) {
        case 'nova':
          this.flash(h.x, h.y, (s.radius || 180) * 0.55, col);
          this.shards(h.x, h.y, col, s.airborne ? 16 : 8, s.airborne ? 380 : 240);
          this.ring(h.x, h.y, s.radius || 180, c, 0.5);
          if (s.airborne) this.shake(5, 0.32);
          break;
        case 'heal':
          this.flash(h.x, h.y, (s.radius || 200) * 0.5, THEME.heal);
          this.rays(h.x, h.y, THEME.heal, (s.radius || 200) * 0.65, 10);
          break;
        case 'skillshot':
          this.spark(ox, oy, col, s.explodeR ? 8 : 4);
          if (s.explodeR) this.flash(ox, oy, 28, col);
          break;
        case 'dash':
          this.ghost(h);
          this.flash(h.x, h.y, 34, c);
          break;
        case 'blinkstrike':
          this.flash(h.x, h.y, 52, c);
          this.shards(h.x, h.y, c, 7, 240);
          break;
        case 'buff':
          this.rays(h.x, h.y, c, 110, 8);
          this.ring(h.x, h.y, 100, c, 0.55);
          break;
        case 'zone':
          this.flash(h.x, h.y, 36, c);
          if (at && s.stun) this.flash(at.x, at.y, 40, THEME.physical);
          break;
      }
    },
    zoneImpact(z) {
      const col = z.color || TEAM_COLORS[z.team];
      this.ring(z.x, z.y, z.radius, col, 0.4);
      if (z.s && z.s.stun) {
        this.flash(z.x, z.y, z.radius * 0.85, THEME.physical);
        this.shards(z.x, z.y, THEME.physical, 14, 420);
        this.shake(6, 0.38);
      } else if (z.s && (z.s.ticks || 1) > 1) {
        this.spark(z.x, z.y, col, 10);
      } else {
        this.spark(z.x, z.y, col, 6);
      }
    },
    explosion(x, y, r) {
      this.ring(x, y, r, THEME.physical, 0.7);
      this.spark(x, y, THEME.gold, 18);
      this.flash(x, y, r * 0.8, '#fff');
      this.shards(x, y, THEME.gold, 12, 420);
    },
    death(u) {
      const c = TEAM_COLORS[u.team] || THEME.text;
      this.ring(u.x, u.y, 60, THEME.text, 0.5);
      this.spark(u.x, u.y, c, 10);
      this.flash(u.x, u.y, u.radius * 2.6, '#fff');
      this.shards(u.x, u.y, c, 10, 300);
    },
    levelup(u) {
      this.ring(u.x, u.y, 80, THEME.gold, 0.6);
      if (u.isPlayer) Game.floaters.push({ x: u.x, y: u.y - 50, vy: -50, txt: 'LEVEL UP!', color: THEME.gold, age: 0, dur: 1.2, size: 26 });
    },
    healFx(u, v) {
      Game.floaters.push({ x: u.x + rand(-15, 15), y: u.y - u.radius - 14, vy: -55, txt: '+' + v, color: THEME.heal, age: 0, dur: 0.9, size: 16 });
    },
    /* Lifesteal / spell vamp tick. Deliberately smaller and dimmer than a heal
       so a marksman's constant drain does not bury the damage numbers. */
    drainFx(u, v) {
      if (Game.floaters.length > 70 || v < 3) return;
      Game.floaters.push({ x: u.x + rand(-10, 10), y: u.y - u.radius - 6, vy: -34, txt: '+' + v, color: rgba(THEME.heal, 0.75), age: 0, dur: 0.6, size: 11 });
    },
    critMark(u) {
      this.push({ kind: 'crit', x: u.x, y: u.y - u.radius - 10, dur: 0.32, age: 0 });
    },

    /* Damage numbers are coloured by TYPE, not by who dealt them — reading
       "am I being shredded by physical or magic" is the decision the player
       actually makes with this information (it tells them which resist to
       buy). Ownership is carried by size and outline instead. */
    floater(u, dmg, src, type, crit) {
      if (Game.floaters.length > 60) return;
      const mine = src === Game.player;
      const onMe = u === Game.player;
      const base = DMG_COLORS[type] || THEME.true;
      Game.floaters.push({
        x: u.x + rand(-16, 16), y: u.y - u.radius - 12, vy: crit ? -95 : -65,
        txt: crit ? String(dmg) + '!' : String(dmg),
        color: crit ? THEME.crit : base,
        outline: mine || onMe,
        age: 0, dur: crit ? 1.0 : 0.8,
        size: crit ? 26 : (mine || onMe ? 18 : 13),
        shake: crit ? 3 : 0,
      });
    },
  },

  updateEffects(dt) {
    // A damped sine reads as impact. Random per-frame offsets read as noise.
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.shakePhase = (this.shakePhase || 0) + dt;
      const k = Math.max(0, this.shakeT / (this.shakeDur || 0.28));
      const a = REDUCE_MOTION ? 0 : this.shakeAmp * k * k;
      this.shakeX = a * Math.sin(this.shakePhase * 52);
      this.shakeY = a * Math.cos(this.shakePhase * 41);
      if (this.shakeT <= 0) { this.shakeAmp = 0; this.shakeX = this.shakeY = 0; }
    }
    if (this.effects.length > 160) this.effects.splice(0, this.effects.length - 160);
    if (this.floaters.length > 70) this.floaters.splice(0, this.floaters.length - 70);
    for (const e of this.effects) {
      e.age += dt;
      if (e.kind === 'spark') { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.92; e.vy *= 0.92; }
      else if (e.kind === 'shard') {
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.vx *= 0.9; e.vy *= 0.9; e.rot += e.vr * dt;
      }
    }
    this.effects = this.effects.filter(e => e.age < e.dur);
    for (const f of this.floaters) { f.age += dt; f.y += f.vy * dt; }
    this.floaters = this.floaters.filter(f => f.age < f.dur);
    for (const i of this.indicators) i.age += dt;
    this.indicators = this.indicators.filter(i => i.age < i.dur && (!i.unit || i.unit.alive));

    /* Combat heat drives the soundtrack's intensity and cools on its own.
       Fed by hero-on-hero damage (see Hero.onDamaged). */
    this.combatHeat = Math.max(0, (this.combatHeat || 0) - dt * 0.16);

    // low-health heartbeat: audible before the screen is checked
    const p = this.player;
    if (p && p.alive && p.hpPct < 0.3 && !this.spectate) {
      this._heartT = (this._heartT || 0) - dt;
      if (this._heartT <= 0) {
        this._heartT = 0.55 + p.hpPct * 1.4;   // faster as health drops
        SFX.heartbeat();
      }
    }
  },
};

/* The rule helpers of combat.js, reachable by name from outside the scripts
   (the headless tests in tests/ drive them directly; the browser never
   needs this table). Keep it in step with docs/design/heroes.md. */
Game.rules = { rankVal, applySkillCC, applyChill, applyKnockback, applyDisplacement, applyPullTo,
  markStacks, applyMark, consumeMark, refreshMark, clearMark, applyTaunt, CHANNEL_BREAKERS };
Game.PlacedObject = PlacedObject;
Game.Tether = Tether;

/* ============================================================
   Rendering
   ============================================================ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
let DPR = 1, CW = 0, CH = 0;
const REDUCE_MOTION = typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = Math.round(CW * DPR);
  canvas.height = Math.round(CH * DPR);
  canvas.style.width = CW + 'px';
  canvas.style.height = CH + 'px';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  // divisors retuned for the tilted projection (less vertical world per px)
  const defaultZoom = clamp(CH / (Game.isDuel() ? 780 : Game.isTen() ? 1250 : 1240), 0.45, 1.3);
  if (Game.spectate && Game.state !== 'select') {
    Game.cam.zoomWant = clamp(Game.cam.zoomWant || defaultZoom, Game.spectatorMinZoom(CW, CH), 1.6);
    Game.cam.zoom = Game.cam.zoomWant;
    Game.clampSpectatorCamera(CW, CH);
  } else if (Game.state !== 'play') {
    Game.cam.zoom = Game.cam.zoomWant = defaultZoom;
  }
  HudScale.compute();
}
window.addEventListener('resize', resize);

/* Font stacks. A condensed face for numbers and headings if the platform has
   one, falling back to the UI face — no webfont, so nothing to download and
   nothing to block first paint. */
const UI_FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";
const DISPLAY_FONT = "'Bahnschrift', 'Oswald', 'Avenir Next Condensed', 'Roboto Condensed', 'Segoe UI', system-ui, sans-serif";

/* --- fog of war ---
   The vision grid is drawn into a 64x64 offscreen canvas — one pixel per
   cell — and then scaled up over the viewport with smoothing on. The
   browser's bilinear filter gives soft vision edges for free; drawing
   4096 rounded rects per frame would not. */
let fogLayer = null;
let fogImg = null;
function drawFog() {
  if (Game.spectate || Game.isDuel() || !Game.vision) return; // duel keeps both fighters observable
  const N = Game.VIS_N;
  if (!fogLayer) {
    fogLayer = document.createElement('canvas');
    fogLayer.width = N; fogLayer.height = N;
  }
  const fg = fogLayer.getContext('2d');
  if (!fogImg) fogImg = fg.createImageData(N, N);
  const img = fogImg;
  const grid = Game.vision[TEAM_BLUE];
  const seen = Game.explored;
  /* Three states, not two. Terrain you have never visited is darkest;
     terrain you have seen before stays readable but clearly unwatched;
     terrain you currently hold is untouched. Blacking out everything you
     cannot see makes the map unnavigable — enemies are already hidden by
     canSee, so the fog only has to communicate *attention*, not occlusion. */
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    img.data[o] = 3; img.data[o + 1] = 6; img.data[o + 2] = 12;
    img.data[o + 3] = grid[i] ? 0 : seen[i] ? 92 : 168;
  }
  fg.putImageData(img, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // inset by half a cell so the smoothed edge lands on the cell boundary
  const cell = Game.worldSize() / N;
  ctx.drawImage(fogLayer, cell * 0.5, cell * 0.5, Game.worldSize() - cell, Game.worldSize() - cell);
  ctx.restore();
}

/* --- static map layer, pre-rendered at half resolution --- */
let mapLayer = null, duelMapLayer = null, tenMapLayer = null;

/* Deterministic PRNG used for foliage placement. Same seed → same forest. */
function mapRng(seed) {
  let s = seed | 0;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function paintReed(g, x, y, s, rnd) {
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const ox = (i - 1.5) * s * 0.22;
    g.strokeStyle = `rgba(${18 + rnd() * 20 | 0},${72 + rnd() * 36 | 0},${28 + rnd() * 16 | 0},${0.45 + rnd() * 0.25})`;
    g.lineWidth = 1.6 + rnd() * 1.1;
    g.beginPath();
    g.moveTo(x + ox, y + s * 0.2);
    g.quadraticCurveTo(x + ox + (rnd() - 0.5) * 6, y - s * 0.55, x + ox + (rnd() - 0.5) * 4, y - s * 1.15);
    g.stroke();
  }
}

function paintTuft(g, x, y, s, rnd) {
  g.strokeStyle = `rgba(${40 + rnd() * 28 | 0},${110 + rnd() * 40 | 0},${40 + rnd() * 22 | 0},0.42)`;
  g.lineWidth = 1.8; g.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(x + i * s * 0.45, y + s * 0.3);
    g.quadraticCurveTo(x + i * s * 0.3, y - s * 0.5, x + i * s * 0.15, y - s);
    g.stroke();
  }
}

/* Smooth a resampled route without changing the route itself. This is only a
   paint helper: minions still walk the authored points, while the road reads
   as a landscaped curve instead of a connected set of ruler strokes. */
function traceSoftPath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], n = pts[i + 1];
    g.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
  }
  g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const c = segClosest(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function paintStoneCluster(g, x, y, r, angle, rnd) {
  g.save(); g.translate(x, y); g.rotate(angle);
  g.fillStyle = 'rgba(22,24,22,0.32)';
  g.beginPath(); g.ellipse(r * 0.15, r * 0.42, r * 1.15, r * 0.45, 0, 0, TAU); g.fill();
  const stones = [
    [-0.48, 0.12, 0.58, 0.43], [0.1, -0.06, 0.72, 0.52],
    [0.62, 0.16, 0.46, 0.36], [-0.08, 0.3, 0.42, 0.3],
  ];
  for (const [ox, oy, rx, ry] of stones) {
    const shade = 118 + (rnd() * 28 | 0);
    g.fillStyle = `rgb(${shade},${shade - 2},${shade - 10})`;
    g.beginPath(); g.ellipse(ox * r, oy * r, rx * r, ry * r, -0.18 + rnd() * 0.25, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(220,224,214,0.28)'; g.lineWidth = Math.max(2, r * 0.055);
    g.beginPath(); g.arc(ox * r - rx * r * 0.08, oy * r - ry * r * 0.1,
      Math.min(rx, ry) * r * 0.66, Math.PI * 1.08, Math.PI * 1.72); g.stroke();
  }
  g.restore();
}

/* A standing tree: cast shadow, trunk, then the canopy lifted well above its
   ground anchor. Once the camera squash flattens the board, the offset reads
   as height — a forest of round-topped trees instead of green pancakes. */
function paintTree(g, x, y, s, rnd) {
  g.fillStyle = 'rgba(6, 18, 8, 0.42)';
  g.beginPath(); g.ellipse(x + s * 0.38, y + s * 0.18, s * 0.92, s * 0.34, 0.16, 0, TAU); g.fill();
  g.fillStyle = '#4a3318';
  g.beginPath();
  g.moveTo(x - s * 0.11, y + s * 0.08);
  g.lineTo(x + s * 0.11, y + s * 0.08);
  g.lineTo(x + s * 0.055, y - s * 0.62);
  g.lineTo(x - s * 0.055, y - s * 0.62);
  g.closePath(); g.fill();
  g.fillStyle = '#2a1c0c';
  g.beginPath();
  g.moveTo(x + s * 0.02, y + s * 0.08);
  g.lineTo(x + s * 0.11, y + s * 0.08);
  g.lineTo(x + s * 0.055, y - s * 0.62);
  g.lineTo(x + s * 0.01, y - s * 0.62);
  g.closePath(); g.fill();
  const lift = -s * 0.72;
  const lobes = [
    [-0.32, 0.14, 0.68, 0.56, 0],
    [0.28, 0.08, 0.64, 0.52, 1],
    [0.04, -0.28, 0.6, 0.54, 2],
    [-0.18, -0.08, 0.5, 0.42, 0],
    [0.16, 0.22, 0.46, 0.38, 1],
  ];
  for (const [ox, oy, rx, ry, pal] of lobes) {
    const shade = pal === 2 ? 22 + rnd() * 12 : pal === 1 ? 10 + rnd() * 10 : rnd() * 10;
    const r = 22 + shade | 0, gg = 92 + shade * 1.8 | 0, b = 24 + shade * 0.45 | 0;
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.beginPath();
    g.ellipse(x + ox * s, y + oy * s + lift, rx * s, ry * s, rnd() * 0.35 - 0.18, 0, TAU);
    g.fill();
  }
  g.fillStyle = `rgba(${110 + rnd() * 50 | 0},${190 + rnd() * 40 | 0},${70 + rnd() * 24 | 0},0.38)`;
  g.beginPath();
  g.ellipse(x - s * 0.18, y - s * 0.34 + lift, s * 0.34, s * 0.22, -0.35, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(8, 36, 12, 0.22)';
  g.beginPath();
  g.ellipse(x + s * 0.16, y + s * 0.08 + lift, s * 0.38, s * 0.2, 0.2, 0, TAU);
  g.fill();
}

function paintBushBed(g, b) {
  const ang = Math.atan2(b.y - WORLD / 2, b.x - WORLD / 2) + Math.PI / 4;
  g.save(); g.translate(b.x, b.y); g.rotate(ang);
  g.fillStyle = 'rgba(8, 28, 12, 0.5)';
  g.beginPath(); g.ellipse(0, 10, b.r * 1.22, b.r * 0.7, 0, 0, TAU); g.fill();
  g.fillStyle = THEME.bush;
  g.beginPath(); g.ellipse(-b.r * 0.28, 2, b.r * 0.82, b.r * 0.52, -0.25, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(b.r * 0.3, 6, b.r * 0.76, b.r * 0.48, 0.28, 0, TAU); g.fill();
  g.fillStyle = THEME.bushLight;
  g.beginPath(); g.ellipse(-b.r * 0.08, -b.r * 0.12, b.r * 0.58, b.r * 0.4, 0.1, 0, TAU); g.fill();
  g.fillStyle = THEME.canopyDark;
  g.beginPath(); g.ellipse(b.r * 0.12, b.r * 0.08, b.r * 0.5, b.r * 0.32, -0.1, 0, TAU); g.fill();
  g.fillStyle = 'rgba(180, 230, 120, 0.22)';
  g.beginPath(); g.ellipse(-b.r * 0.3, -b.r * 0.22, b.r * 0.28, b.r * 0.16, -0.4, 0, TAU); g.fill();
  g.restore();
}

/* Circular dirt/stone bowls, matching the camp clearings on the reference. */
function paintCampArena(g, c, index) {
  const river = c.kind === 'crab' || c.kind === 'litho';
  const s = river ? 0.68 : 1;
  g.save(); g.translate(c.x, c.y); g.scale(s, s);
  g.fillStyle = 'rgba(20,28,16,0.4)';
  g.beginPath(); g.ellipse(8, 18, 175, 155, 0, 0, TAU); g.fill();

  g.fillStyle = river ? '#1a3a38' : '#4a3a24';
  g.beginPath(); g.arc(0, 0, 168, 0, TAU); g.fill();
  const bowl = g.createRadialGradient(-30, -28, 12, 0, 0, 160);
  if (c.kind === 'blueBuff') {
    bowl.addColorStop(0, '#2a8a8c'); bowl.addColorStop(0.45, '#1a5c5e'); bowl.addColorStop(1, '#3d3220');
  } else if (c.kind === 'redBuff') {
    bowl.addColorStop(0, '#c56a28'); bowl.addColorStop(0.45, '#7a3e18'); bowl.addColorStop(1, '#3d3220');
  } else if (c.kind === 'litho') {
    bowl.addColorStop(0, '#5eead4'); bowl.addColorStop(0.45, '#0f766e'); bowl.addColorStop(1, '#1a3a38');
  } else if (c.kind === 'crab') {
    bowl.addColorStop(0, '#cbd5e1'); bowl.addColorStop(0.5, '#64748b'); bowl.addColorStop(1, '#1e293b');
  } else {
    bowl.addColorStop(0, '#8a6a3c'); bowl.addColorStop(0.55, '#5c4628'); bowl.addColorStop(1, '#3d3220');
  }
  g.fillStyle = bowl;
  g.beginPath(); g.arc(0, 0, 148, 0, TAU); g.fill();

  g.strokeStyle = 'rgba(150,148,128,0.55)'; g.lineWidth = 10;
  g.beginPath(); g.arc(0, 0, 160, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(90,88,72,0.7)'; g.lineWidth = 4;
  g.beginPath(); g.arc(0, 0, 154, 0, TAU); g.stroke();

  const rockRnd = mapRng(9100 + index * 97);
  const rim = 158;
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU + 0.2;
    paintStoneCluster(g, Math.cos(a) * rim, Math.sin(a) * rim, 32 + rockRnd() * 10, a + 1.2, rockRnd);
  }

  const col = c.kind === 'blueBuff' ? THEME.blue
    : c.kind === 'redBuff' ? '#fb923c'
    : c.kind === 'litho' ? '#5eead4'
    : c.kind === 'crab' ? '#94a3b8'
    : '#c4b48a';
  g.strokeStyle = rgba(col, c.kind === 'normal' ? 0.28 : 0.55);
  g.lineWidth = 5; g.setLineDash([16, 12]);
  g.beginPath(); g.arc(0, 0, 88, 0, TAU); g.stroke();
  g.setLineDash([]);
  g.restore();
}

function buildMapLayer() {
  const S = 0.62, M = MapArt.MARGIN;
  mapLayer = document.createElement('canvas');
  mapLayer.width = (WORLD + 2 * M) * S; mapLayer.height = (WORLD + 2 * M) * S;
  mapLayer.margin = M;                     // world units painted beyond the square
  const g = mapLayer.getContext('2d');
  g.scale(S, S); g.translate(M, M);
  MapArt.paintBoard(g);
}

/* The duel arena is a separate static layer rather than a crop of the 5v5
   board. Keeping the same world coordinate system lets every combat and input
   calculation stay shared while the active bounds make the playable space
   genuinely smaller. */
function buildDuelMapLayer() {
  const S = 0.5, b = DUEL_MAP.bounds;
  duelMapLayer = document.createElement('canvas');
  duelMapLayer.width = WORLD * S; duelMapLayer.height = WORLD * S;
  const g = duelMapLayer.getContext('2d');
  g.scale(S, S);
  g.fillStyle = THEME.void;
  g.fillRect(0, 0, WORLD, WORLD);

  const grad = g.createLinearGradient(b.minX, b.maxY, b.maxX, b.minY);
  grad.addColorStop(0, THEME.groundBlue);
  grad.addColorStop(0.5, THEME.groundMid);
  grad.addColorStop(1, THEME.groundRed);
  g.fillStyle = grad;
  g.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

  // quiet tactical grid: makes distance and motion legible during experiments
  g.strokeStyle = rgba(THEME.text, 0.035);
  g.lineWidth = 2;
  for (let x = b.minX + 160; x < b.maxX; x += 160) {
    g.beginPath(); g.moveTo(x, b.minY); g.lineTo(x, b.maxY); g.stroke();
  }
  for (let y = b.minY + 160; y < b.maxY; y += 160) {
    g.beginPath(); g.moveTo(b.minX, y); g.lineTo(b.maxX, y); g.stroke();
  }

  const trace = path => {
    g.beginPath(); g.moveTo(path[0].x, path[0].y);
    for (const p of path) g.lineTo(p.x, p.y);
    g.stroke();
  };
  g.lineJoin = 'round'; g.lineCap = 'round';

  /* The two flank routes are paved narrower than the direct lane, which is the
     whole read: the wide road is fast and passes the shrine, the thin ones are
     slow and do not. */
  for (const flank of [DUEL_MAP.lanes.flankTop, DUEL_MAP.lanes.flankBot]) {
    for (const [w, col] of [[150, rgba(THEME.void, 0.32)], [120, rgba(THEME.laneEdge, 0.75)],
                            [80, rgba(THEME.lane, 0.7)]]) {
      g.strokeStyle = col; g.lineWidth = w; trace(flank);
    }
  }

  const lane = DUEL_MAP.lanes.duel;
  for (const [w, col] of [[260, rgba(THEME.void, 0.42)], [220, THEME.laneEdge], [160, THEME.lane]]) {
    g.strokeStyle = col; g.lineWidth = w; trace(lane);
  }
  g.setLineDash([34, 50]);
  g.strokeStyle = rgba(THEME.gold, 0.18); g.lineWidth = 6;
  trace(lane);
  g.setLineDash([]);

  /* Shrine platform. The tiles point at the centre so the ground itself says
     "this is the thing you are standing on", and the outer ring is drawn at
     the rune's real pickup radius rather than an arbitrary decorative size. */
  const s = DUEL_MAP.shrine;
  const plate = g.createRadialGradient(s.x, s.y, 20, s.x, s.y, 340);
  plate.addColorStop(0, rgba(THEME.gold, 0.20));
  plate.addColorStop(0.55, rgba(THEME.gold, 0.06));
  plate.addColorStop(1, rgba(THEME.gold, 0));
  g.fillStyle = plate; g.beginPath(); g.arc(s.x, s.y, 340, 0, TAU); g.fill();
  g.strokeStyle = rgba(THEME.gold, 0.30); g.lineWidth = 6;
  g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.stroke();
  g.strokeStyle = rgba(THEME.gold, 0.14); g.lineWidth = 4;
  g.beginPath(); g.arc(s.x, s.y, 250, 0, TAU); g.stroke();
  g.strokeStyle = rgba(THEME.gold, 0.16); g.lineWidth = 5;
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + TAU / 16;
    g.beginPath();
    g.moveTo(s.x + Math.cos(a) * (s.r + 20), s.y + Math.sin(a) * (s.r + 20));
    g.lineTo(s.x + Math.cos(a) * 244, s.y + Math.sin(a) * 244);
    g.stroke();
  }

  /* Base glows are drawn at 300 units — the radius that actually heals — so
     "am I safe yet?" is answered by the floor and not by guesswork. */
  for (const team of [TEAM_BLUE, TEAM_RED]) {
    const f = DUEL_MAP.fountains[team];
    const glow = g.createRadialGradient(f.x, f.y, 10, f.x, f.y, 300);
    glow.addColorStop(0, rgba(TEAM_COLORS[team], 0.55));
    glow.addColorStop(0.7, rgba(TEAM_COLORS[team], 0.16));
    glow.addColorStop(1, rgba(TEAM_COLORS[team], 0));
    g.fillStyle = glow; g.beginPath(); g.arc(f.x, f.y, 300, 0, TAU); g.fill();
    g.strokeStyle = rgba(TEAM_COLORS[team], 0.36); g.lineWidth = 5;
    g.setLineDash([26, 20]);
    g.beginPath(); g.arc(f.x, f.y, 300, 0, TAU); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = rgba(TEAM_COLORS[team], 0.62); g.lineWidth = 7;
    g.beginPath(); g.arc(f.x, f.y, 92, 0, TAU); g.stroke();
  }

  g.strokeStyle = rgba(THEME.gold, 0.42); g.lineWidth = 10;
  g.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  g.strokeStyle = rgba(THEME.void, 0.82); g.lineWidth = 70;
  g.strokeRect(b.minX - 35, b.minY - 35, b.maxX - b.minX + 70, b.maxY - b.minY + 70);

  // cool arena floodlight, same top-left key light as the other boards
  const arenaLight = g.createLinearGradient(b.minX, b.minY, b.maxX, b.maxY);
  arenaLight.addColorStop(0, 'rgba(220,235,255,0.08)');
  arenaLight.addColorStop(0.55, 'rgba(0,0,0,0)');
  arenaLight.addColorStop(1, 'rgba(5,10,22,0.2)');
  g.fillStyle = arenaLight;
  g.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
}

/* Auric Caldera — night mesa, brass roads, molten crater. No forest, no
   cobble lanes, no diagonal river: a different planet from the 5v5 board. */
function buildTenMapLayer() {
  const W = TEN_MAP.world, S = 0.42;
  tenMapLayer = document.createElement('canvas');
  tenMapLayer.width = W * S; tenMapLayer.height = W * S;
  const g = tenMapLayer.getContext('2d');
  g.scale(S, S);

  const floor = g.createRadialGradient(W / 2, W / 2, 200, W / 2, W / 2, W * 0.72);
  floor.addColorStop(0, '#2a1a14');
  floor.addColorStop(0.45, '#16141c');
  floor.addColorStop(1, '#0b0c12');
  g.fillStyle = floor;
  g.fillRect(0, 0, W, W);

  const rnd = mapRng(64001);
  for (let i = 0; i < 280; i++) {
    const x = rnd() * W, y = rnd() * W, r = 70 + rnd() * 220;
    g.fillStyle = rnd() > 0.5 ? 'rgba(80, 40, 22, 0.14)' : 'rgba(40, 30, 70, 0.12)';
    g.beginPath(); g.ellipse(x, y, r, r * (0.45 + rnd() * 0.4), rnd() * TAU, 0, TAU); g.fill();
  }

  g.lineCap = 'round'; g.lineJoin = 'round';
  const vein = TEN_MAP.vein;
  g.beginPath(); g.moveTo(vein[0].x, vein[0].y);
  for (const q of vein) g.lineTo(q.x, q.y);
  g.strokeStyle = 'rgba(90, 30, 12, 0.7)'; g.lineWidth = 150; g.stroke();
  g.strokeStyle = '#c45a18'; g.lineWidth = 88; g.stroke();
  g.strokeStyle = 'rgba(255, 180, 70, 0.45)'; g.lineWidth = 36; g.stroke();

  const crater = TEN_MAP.crater;
  g.fillStyle = '#1a0c08';
  g.beginPath(); g.arc(crater.x, crater.y, TEN_MAP.craterR + 70, 0, TAU); g.fill();
  const lava = g.createRadialGradient(crater.x - 40, crater.y - 50, 30, crater.x, crater.y, TEN_MAP.craterR);
  lava.addColorStop(0, '#ffe08a');
  lava.addColorStop(0.35, '#e07020');
  lava.addColorStop(0.72, '#8a220c');
  lava.addColorStop(1, '#3a100c');
  g.fillStyle = lava;
  g.beginPath(); g.arc(crater.x, crater.y, TEN_MAP.craterR - 20, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255, 200, 90, 0.28)'; g.lineWidth = 8;
  g.beginPath(); g.arc(crater.x, crater.y, TEN_MAP.craterR * 0.55, 0, TAU); g.stroke();

  const paintBeacon = (pt, col) => {
    g.fillStyle = '#1c1612';
    g.beginPath(); g.arc(pt.x, pt.y, 210, 0, TAU); g.fill();
    const bg = g.createRadialGradient(pt.x, pt.y, 10, pt.x, pt.y, 190);
    bg.addColorStop(0, col);
    bg.addColorStop(0.5, rgba(col, 0.35));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg;
    g.beginPath(); g.arc(pt.x, pt.y, 190, 0, TAU); g.fill();
    g.strokeStyle = col; g.lineWidth = 8;
    g.beginPath(); g.arc(pt.x, pt.y, 96, 0, TAU); g.stroke();
  };
  paintBeacon(TEN_MAP.beaconWest, '#f0b429');
  paintBeacon(TEN_MAP.beaconEast, '#f0b429');

  TEN_MAP.camps.forEach((c, i) => {
    g.save(); g.translate(c.x, c.y);
    g.fillStyle = '#2a2218';
    g.beginPath(); g.arc(0, 0, 150, 0, TAU); g.fill();
    const bowl = g.createRadialGradient(-20, -18, 8, 0, 0, 140);
    if (c.kind === 'blueBuff') { bowl.addColorStop(0, '#3d7a9a'); bowl.addColorStop(1, '#1a2830'); }
    else if (c.kind === 'redBuff') { bowl.addColorStop(0, '#c45a18'); bowl.addColorStop(1, '#3a2010'); }
    else { bowl.addColorStop(0, '#6a5840'); bowl.addColorStop(1, '#2a2418'); }
    g.fillStyle = bowl;
    g.beginPath(); g.arc(0, 0, 128, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(200, 170, 110, 0.4)'; g.lineWidth = 6;
    g.beginPath(); g.arc(0, 0, 138, 0, TAU); g.stroke();
    g.restore();
  });

  const paintBrass = (lane, seed) => {
    const rr = mapRng(seed);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, col] of [[210, '#1a1410'], [176, '#4a3820'], [148, '#8a6a32'], [118, '#c4a060']]) {
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath(); g.moveTo(lane[0].x, lane[0].y);
      for (let i = 1; i < lane.length - 1; i++) {
        const q = lane[i], n = lane[i + 1];
        g.quadraticCurveTo(q.x, q.y, (q.x + n.x) * 0.5, (q.y + n.y) * 0.5);
      }
      g.lineTo(lane[lane.length - 1].x, lane[lane.length - 1].y);
      g.stroke();
    }
    for (let i = 1; i < lane.length; i += 2) {
      const a = lane[i - 1], b = lane[i];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      g.save(); g.translate(b.x, b.y); g.rotate(ang);
      g.strokeStyle = `rgba(255, 220, 140, ${0.08 + rr() * 0.08})`;
      g.lineWidth = 2;
      g.strokeRect(-22, -48, 44, 96);
      g.restore();
    }
  };
  let seed = 91001;
  for (const lane of Object.values(TEN_MAP.lanes)) paintBrass(lane, seed++);

  for (const t of [0, 1]) {
    const b = TEN_MAP.bases[t], f = TEN_MAP.fountains[t];
    const ang = Math.atan2(W / 2 - b.y, W / 2 - b.x);
    g.fillStyle = t === 0 ? '#3a4a58' : '#5a3a38';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = ang + i / 6 * TAU;
      const x = b.x + Math.cos(a) * 380, y = b.y + Math.sin(a) * 380;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    g.strokeStyle = rgba(TEAM_COLORS[t], 0.7); g.lineWidth = 14; g.stroke();
    const fg = g.createRadialGradient(f.x, f.y, 8, f.x, f.y, 280);
    fg.addColorStop(0, rgba(TEAM_COLORS[t], 0.75));
    fg.addColorStop(0.5, rgba(TEAM_COLORS[t], 0.2));
    fg.addColorStop(1, rgba(TEAM_COLORS[t], 0));
    g.fillStyle = fg;
    g.beginPath(); g.arc(f.x, f.y, 280, 0, TAU); g.fill();
    // citadel crystal, pre-stretched against the squash like the 5v5 board's
    g.save(); g.translate(f.x, f.y);
    g.scale(1, 1 / TILT);
    g.fillStyle = 'rgba(2,4,8,0.4)';
    g.beginPath(); g.ellipse(0, 28, 24, 8, 0, 0, TAU); g.fill();
    g.translate(0, -14);
    g.fillStyle = TEAM_COLORS[t];
    g.beginPath();
    g.moveTo(0, -56); g.lineTo(16, 2); g.lineTo(0, 48); g.lineTo(-16, 2);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 2; g.stroke();
    g.restore();
  }

  const rockRnd = mapRng(64077);
  for (const w of TEN_MAP.walls) {
    const step = Math.max(1, Math.floor(w.pts.length / 4));
    for (let i = 0; i < w.pts.length; i += step) {
      const q = w.pts[i], n = w.pts[Math.min(i + 1, w.pts.length - 1)];
      g.save(); g.translate(q.x, q.y);
      g.rotate(Math.atan2(n.y - q.y, n.x - q.x));
      const r = w.r * (0.95 + rockRnd() * 0.3);
      g.fillStyle = 'rgba(8, 8, 12, 0.4)';
      g.beginPath(); g.ellipse(0, r * 0.4, r * 1.2, r * 0.4, 0, 0, TAU); g.fill();
      const shade = 48 + (rockRnd() * 22 | 0);
      g.fillStyle = `rgb(${shade + 8},${shade},${shade - 6})`;
      g.beginPath(); g.ellipse(0, 0, r * 1.05, r * 0.7, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(180, 140, 90, 0.22)'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(-r * 0.15, -r * 0.12, r * 0.55, r * 0.35, -0.2, 0, TAU); g.stroke();
      g.restore();
    }
  }

  for (const b of TEN_MAP.bushes) {
    g.save(); g.translate(b.x, b.y);
    g.fillStyle = 'rgba(40, 16, 10, 0.7)';
    g.beginPath(); g.ellipse(0, 6, b.r * 1.1, b.r * 0.65, 0.2, 0, TAU); g.fill();
    g.fillStyle = '#4a2214';
    g.beginPath(); g.ellipse(-b.r * 0.2, 0, b.r * 0.7, b.r * 0.5, -0.3, 0, TAU); g.fill();
    g.fillStyle = '#6a3218';
    g.beginPath(); g.ellipse(b.r * 0.25, -4, b.r * 0.55, b.r * 0.42, 0.25, 0, TAU); g.fill();
    g.restore();
  }

  g.strokeStyle = 'rgba(20, 16, 12, 0.85)'; g.lineWidth = 80;
  g.strokeRect(0, 0, W, W);
  g.strokeStyle = 'rgba(180, 140, 70, 0.28)'; g.lineWidth = 10;
  g.strokeRect(36, 36, W - 72, W - 72);

  // cold moonlight from the top-left against the crater's ember glow
  const moon = g.createLinearGradient(0, 0, W, W);
  moon.addColorStop(0, 'rgba(150,180,255,0.07)');
  moon.addColorStop(0.5, 'rgba(0,0,0,0)');
  moon.addColorStop(1, 'rgba(0,0,0,0.24)');
  g.fillStyle = moon;
  g.fillRect(0, 0, W, W);
}

/* ============================================================
   Fake-3D projection.

   The reference game's camera looks at the board from a tilt, not from
   straight above. We fake that tilt in 2D: the whole ground plane is
   compressed vertically by TILT (so any circle painted on the ground —
   range rings, team rings, shadows — renders as an ellipse for free),
   while everything that has height (characters, towers, walls, text)
   is drawn *upright* inside an `uprightAt` frame that undoes the squash
   around a ground anchor point.

   Gameplay math never sees any of this: the sim stays pure top-down,
   and only worldTransform / screenToWorld translate between the two.
   ============================================================ */
const TILT = 0.78;

function worldTransform() {
  const z = Game.cam.zoom;
  const sx = Game.shakeX, sy = Game.shakeY;
  ctx.setTransform(DPR * z, 0, 0, DPR * z * TILT,
    DPR * (CW / 2 - Game.cam.x * z + sx), DPR * (CH / 2 - Game.cam.y * z * TILT + sy));
}

/* Run `fn` with (0,0) anchored at ground point (x, y), y-up in true screen
   proportions (the TILT squash undone). Everything drawn inside reads as a
   billboard standing on the ground at that point. */
function uprightAt(x, y, fn) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 1 / TILT);
  fn();
  ctx.restore();
}

function inView(x, y, pad = 90) {
  const z = Game.cam.zoom || 1;
  const hx = CW / (2 * z) + pad, hy = CH / (2 * z * TILT) + pad;
  return x > Game.cam.x - hx && x < Game.cam.x + hx &&
    y > Game.cam.y - hy && y < Game.cam.y + hy;
}

/* Screen-space shake is stored in pixels; convert it back to world so a crop
   of the baked map still covers the shaken viewport. */
function visibleWorldRect(pad = 80) {
  const z = Game.cam.zoom || 1;
  const camX = Game.cam.x - (Game.shakeX || 0) / z;
  const camY = Game.cam.y - (Game.shakeY || 0) / (z * TILT);
  const hx = CW / (2 * z) + pad;
  const hy = CH / (2 * z * TILT) + pad;
  return { x: camX - hx, y: camY - hy, w: hx * 2, h: hy * 2 };
}

function drawMapLayer(layer, W) {
  if (!layer) return;
  const v = visibleWorldRect(160);
  const m = layer.margin || 0;             // the 5v5 board paints a rim past its edge
  const x = Math.max(-m, v.x);
  const y = Math.max(-m, v.y);
  const dw = Math.min(W + m, v.x + v.w) - x;
  const dh = Math.min(W + m, v.y + v.h) - y;
  if (dw <= 1 || dh <= 1) return;
  const Sx = layer.width / (W + 2 * m), Sy = layer.height / (W + 2 * m);
  ctx.drawImage(layer, (x + m) * Sx, (y + m) * Sy, dw * Sx, dh * Sy, x, y, dw, dh);
}

/* Health bar with a shield overlay and crowd-control pips.
   Shields draw as a white segment continuing past the health fill rather than
   overlaying it, so "I have 300 effective HP left" is one length to read.
   Drawn in an upright frame floating above the unit's body — `u._top` is the
   body height the figure renderer measured this frame. */
function drawHpBar(u, w, h, yOff, color) {
  const top = u._top || u.radius * 1.9;
  uprightAt(u.x, u.y, () => {
    const x = -w / 2, y = -(top + yOff * 0.6) - h;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);

    const pct = clamp(u.hpPct, 0, 1);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * pct, h);

    const sh = u.shieldTotal;
    if (sh > 0) {
      const sw = Math.min(w * (1 - pct), w * (sh / u.maxHp));
      ctx.fillStyle = THEME.shield;
      ctx.fillRect(x + w * pct, y, sw, h);
    }
    // segment ticks every 25% give the bar a readable scale at a glance
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 1; i < 4; i++) ctx.fillRect(x + w * i / 4, y, 1, h);

    if (u.cc) {
      const list = u.cc.list;
      for (let i = 0; i < list.length && i < 4; i++) {
        const k = list[i];
        ctx.fillStyle = THEME['cc' + k[0].toUpperCase() + k.slice(1)] || THEME.warn;
        const px = x + 5 + i * 9, py = y - 7;
        ctx.beginPath();
        ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py);
        ctx.lineTo(px, py + 4); ctx.lineTo(px - 4, py);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.8; ctx.stroke();
      }
    }
  });
}

/* ---- fake-3D unit figurines ----
   Every unit is drawn as a small upright figure standing on a team-coloured
   ground ring: contact shadow and ring live on the (tilted) ground plane,
   the body is a volume-shaded billboard lit from the top-left. The role
   silhouette is kept as the figure's cross-section, so a tank still reads
   blocky and an assassin sharp from across the map. */

/* Ground-plane part: shadow, team ring, facing chevron, and status auras.
   Drawn for every unit BEFORE any body, so no figure ever stands on top of
   another unit's ring. The tilt turns all of these circles into ellipses. */
function drawUnitGround(u) {
  const r = u.radius * (BODY_SCALE[u.type] || 1);
  const teamCol = u.team === TEAM_NEUTRAL ? THEME.neutral : TEAM_COLORS[u.team];

  // contact shadow, pushed slightly down-screen (the sun sits top-left)
  ctx.beginPath();
  ctx.arc(u.x, u.y + r * 0.12, r * 0.98, 0, TAU);
  ctx.fillStyle = 'rgba(3,7,10,0.4)';
  ctx.fill();

  // team ring: soft glow band, crisp line, faint floor tint
  ctx.beginPath(); ctx.arc(u.x, u.y, r + 6, 0, TAU);
  ctx.strokeStyle = rgba(teamCol, 0.26); ctx.lineWidth = 5; ctx.stroke();
  ctx.beginPath(); ctx.arc(u.x, u.y, r + 4, 0, TAU);
  ctx.strokeStyle = rgba(teamCol, 0.88); ctx.lineWidth = 2.2; ctx.stroke();
  ctx.beginPath(); ctx.arc(u.x, u.y, r + 1, 0, TAU);
  ctx.fillStyle = rgba(teamCol, 0.08); ctx.fill();

  // facing chevron on the ring — a ground decal, so it projects with the tilt
  ctx.save();
  ctx.translate(u.x, u.y); ctx.rotate(u.facing);
  ctx.beginPath();
  ctx.moveTo(r + 13, 0); ctx.lineTo(r + 2.5, -5.5); ctx.lineTo(r + 2.5, 5.5);
  ctx.closePath();
  ctx.fillStyle = rgba(teamCol, 0.95); ctx.fill();
  ctx.restore();

  // crowd-control aura, coloured by the hardest CC currently applied
  if (u.cc && u.cc.dominant) {
    const dom = u.cc.dominant;
    const col = THEME['cc' + dom[0].toUpperCase() + dom.slice(1)] || THEME.warn;
    ctx.beginPath();
    ctx.arc(u.x, u.y, r + 9 + Math.sin(Game.time * 9) * 1.6, 0, TAU);
    ctx.strokeStyle = col; ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
  }
  // shield shell
  if (u.shieldTotal > 0) {
    ctx.beginPath();
    ctx.arc(u.x, u.y, r + 13, 0, TAU);
    ctx.strokeStyle = rgba(THEME.shield, 0.8); ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  // burn / chill / other DoT auras
  if (u.dots && u.dots.length) {
    const col = u.dots[0].color || THEME.physical;
    ctx.beginPath();
    ctx.arc(u.x, u.y, r + 7 + Math.sin(Game.time * 11) * 1.8, 0, TAU);
    ctx.strokeStyle = rgba(col, 0.7); ctx.lineWidth = 2.2;
    ctx.stroke();
  }
}

/* Cross-section of the figure in upright coords (0,0 = feet, cy = chest). */
function bodyPath(shape, r, cy) {
  ctx.beginPath();
  if (shape === 'square') {
    const w = r * 0.92;
    ctx.rect(-w, cy - r * 0.8, w * 2, r * 1.75);
  } else if (shape === 'diamond') {
    ctx.moveTo(0, cy - r * 1.14); ctx.lineTo(r * 0.84, cy);
    ctx.lineTo(0, cy + r * 1.02); ctx.lineTo(-r * 0.84, cy);
    ctx.closePath();
  } else if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU - Math.PI / 2;
      const px = Math.cos(a) * r * 0.96, py = cy + Math.sin(a) * r * 1.06;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(0, cy, r * 0.98, 0, TAU);
  }
}

/* Body volume: face fill with directional lighting plus a lighter top facet
   and a darker flank, which is what makes the figure read as a solid. */
function bodyShape(shape, r, cy, baseCol, teamCol) {
  if (shape === 'square') {
    // oblique block: lit top slab, mid front face, dark right flank
    const w = r * 0.92, top = cy - r * 0.8, bot = cy + r * 0.95;
    const dx = r * 0.3, dy = r * 0.34;
    ctx.beginPath();
    ctx.moveTo(w, top); ctx.lineTo(w + dx, top - dy);
    ctx.lineTo(w + dx, bot - dy); ctx.lineTo(w, bot);
    ctx.closePath();
    ctx.fillStyle = mixHex(baseCol, '#05070c', 0.5); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-w, top); ctx.lineTo(w, top);
    ctx.lineTo(w + dx, top - dy); ctx.lineTo(-w + dx, top - dy);
    ctx.closePath();
    ctx.fillStyle = mixHex(baseCol, '#ffffff', 0.38); ctx.fill();
    const fg = ctx.createLinearGradient(0, top, 0, bot);
    fg.addColorStop(0, mixHex(baseCol, '#ffffff', 0.16));
    fg.addColorStop(1, mixHex(baseCol, '#05070c', 0.32));
    ctx.fillStyle = fg;
    ctx.fillRect(-w, top, w * 2, bot - top);
  } else if (shape === 'diamond') {
    // floating octahedron gem with facet lines
    const grad = ctx.createLinearGradient(-r * 0.5, cy - r * 1.1, r * 0.4, cy + r);
    grad.addColorStop(0, mixHex(baseCol, '#ffffff', 0.42));
    grad.addColorStop(0.5, baseCol);
    grad.addColorStop(1, mixHex(baseCol, '#05070c', 0.42));
    bodyPath(shape, r, cy);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(0, cy - r * 1.14); ctx.lineTo(0, cy + r * 1.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r * 0.84, cy); ctx.lineTo(r * 0.84, cy); ctx.stroke();
  } else if (shape === 'hex') {
    // hex prism: gradient front, squashed lighter cap
    const grad = ctx.createLinearGradient(-r * 0.7, cy - r, r * 0.6, cy + r);
    grad.addColorStop(0, mixHex(baseCol, '#ffffff', 0.3));
    grad.addColorStop(0.55, baseCol);
    grad.addColorStop(1, mixHex(baseCol, '#05070c', 0.36));
    bodyPath(shape, r, cy);
    ctx.fillStyle = grad; ctx.fill();
    ctx.save();
    ctx.translate(0, cy - r * 1.06); ctx.scale(1, 0.34);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU - Math.PI / 2;
      const px = Math.cos(a) * r * 0.94, py = Math.sin(a) * r * 0.94;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = mixHex(baseCol, '#ffffff', 0.34); ctx.fill();
    ctx.restore();
  } else {
    // sphere: offset radial gradient + ground-bounce shade + spec highlight
    const grad = ctx.createRadialGradient(-r * 0.34, cy - r * 0.42, r * 0.1, 0, cy, r * 1.05);
    grad.addColorStop(0, mixHex(baseCol, '#ffffff', 0.5));
    grad.addColorStop(0.55, baseCol);
    grad.addColorStop(1, mixHex(baseCol, '#05070c', 0.44));
    bodyPath(shape, r, cy);
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, cy + r * 0.58, r * 0.72, r * 0.26, 0, 0, TAU);
    ctx.fillStyle = 'rgba(5,9,14,0.2)'; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, cy - r * 0.48, r * 0.2, r * 0.12, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
  }
  // team rim light keeps side identification from the old neon look
  bodyPath(shape, r, cy);
  ctx.strokeStyle = rgba(teamCol, 0.7); ctx.lineWidth = 2;
  ctx.shadowColor = teamCol; ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/* Bodies are drawn larger than their collision circle: the reference game's
   heroes stand about a fifth of a lane's width tall on screen. */
const BODY_SCALE = { hero: 1.4, minion: 1.15 };
function drawUnitBody(u, emoji, size, shape) {
  const r = u.radius * (BODY_SCALE[u.type] || 1);
  const teamCol = u.team === TEAM_NEUTRAL ? THEME.neutral : TEAM_COLORS[u.team];
  // colourless units (minions, small camps) get a team-tinted armour tone so
  // sides read at a glance without stealing the heroes' saturated palette
  const baseCol = u.color ||
    (u.team === TEAM_NEUTRAL ? '#5d6672' : mixHex(TEAM_COLORS[u.team], '#97a0af', 0.42));

  // attack wind-up nudges the body toward the target; walk bob sells motion
  const lunge = u.attackAnim > 0 ? Math.sin(u.attackAnim / 0.18 * Math.PI) * r * 0.22 : 0;
  const spd = Math.hypot(u.vx || 0, u.vy || 0);
  const bob = spd > 18
    ? Math.abs(Math.sin(Game.time * 9 + (u.x || 0) * 0.04)) * Math.min(4, spd * 0.014)
    : (Math.sin(Game.time * 2.2 + (u.x || 0) * 0.02) + 1) * 0.4;
  const hover = shape === 'diamond' ? Math.sin(Game.time * 3 + (u.x || 0) * 0.01) * 2 + 3 : 0;
  const bx = u.x + Math.cos(u.facing) * lunge;
  const by = u.y + Math.sin(u.facing) * lunge;

  uprightAt(bx, by, () => {
    ctx.translate(0, -bob - hover);
    const cy = -r * 1.04;      // chest height above the feet
    // feet shade plugs the visual gap between ring and body
    ctx.beginPath();
    ctx.ellipse(0, -1 + hover, r * 0.7, r * 0.24, 0, 0, TAU);
    ctx.fillStyle = 'rgba(5,9,14,0.45)'; ctx.fill();

    bodyShape(shape, r, cy, baseCol, teamCol);

    if (u.hitFlash > 0) {
      bodyPath(shape, r, cy);
      ctx.fillStyle = `rgba(255,255,255,${clamp(u.hitFlash / 0.14, 0, 1) * 0.6})`;
      ctx.fill();
    }

    if (emoji) {
      if (typeof Icons !== 'undefined' && Icons.has(emoji)) {
        // vector glyph on a dark medallion so it reads on any team colour
        ctx.beginPath(); ctx.arc(0, cy, r * 0.68, 0, TAU);
        ctx.fillStyle = 'rgba(7,11,20,0.8)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.3; ctx.stroke();
        Icons.paint(ctx, emoji, 0, cy, r * 1.2);
      } else {
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 0, cy + 1);
      }
    }
  });
  // measured body offsets, used by bars / marks / name plates this frame
  u._bob = bob + hover;
  u._top = r * 2.2 + bob + hover;
}

/* Minion kind emblem on the chest: ranged = gold orb, siege/super = spinning
   spiked core, melee = an upward blade. Drawn in the body's upright frame,
   tracking the walk bob the body renderer measured. */
function drawMinionKind(m) {
  uprightAt(m.x, m.y, () => {
    ctx.translate(0, -(m._bob || 0));
    const r = m.radius, cy = -r * 1.04;
    if (m.kind === 'ranged') {
      ctx.beginPath(); ctx.arc(0, cy, r * 0.4, 0, TAU);
      ctx.fillStyle = THEME.gold; ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,24,0.55)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 0.12, cy - r * 0.14, r * 0.13, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    } else if (m.kind === 'super' || m.kind === 'lord') {
      ctx.save();
      ctx.translate(0, cy);
      ctx.rotate(Game.time * 1.2);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
      }
      ctx.strokeStyle = THEME.text; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, TAU);
      ctx.fillStyle = THEME.gold; ctx.fill();
      ctx.restore();
    } else if (m.kind === 'siege') {
      // the cannon: a squat barrel on a gold wheel
      ctx.beginPath(); ctx.arc(0, cy + r * 0.1, r * 0.34, 0, TAU);
      ctx.fillStyle = THEME.gold; ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,24,0.55)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath();
      ctx.rect(-r * 0.16, cy - r * 0.62, r * 0.32, r * 0.7);
      ctx.fillStyle = THEME.text; ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, cy - r * 0.42);
      ctx.lineTo(r * 0.3, cy + r * 0.3);
      ctx.lineTo(0, cy + r * 0.08);
      ctx.lineTo(-r * 0.3, cy + r * 0.3);
      ctx.closePath();
      ctx.fillStyle = THEME.text; ctx.fill();
    }
  });
}

/* One extruded wall segment: contact shadow, a side face rising from the
   base, then the lit top slab with a pale crest. Round caps make adjacent
   segments fuse into one continuous ridge. */
function drawWallPiece(a, b, r) {
  const ten = Game.isTen();
  if (!ten && typeof MapArt !== 'undefined') { MapArt.drawWall(ctx, a, b, r); return; }
  const h = r * 1.05 + 28;
  const base = ten ? '#241b16' : '#2e3830';
  const mid = ten ? '#4a3a2e' : THEME.wall;
  const top = ten ? '#6a5648' : THEME.wallLight;
  const line = (dy, w, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = w * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + dy); ctx.lineTo(b.x, b.y + dy);
    ctx.stroke();
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  line(r * 0.3 + 8, r + 8, 'rgba(6,12,9,0.32)');
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    line(-h * t, r * (1 - t * 0.14), mixHex(base, mid, t));
  }
  line(-h, r * 0.8, top);
  line(-h - 2, r * 0.48, mixHex(top, '#ffffff', 0.16));
}

/* Passive stacks sit on the health bar so Ember / Chill / plates are readable
   in a fight instead of living only in the combat log. */
function drawStatusMarks(u, yOff) {
  const pips = [];
  const m = u.marks;
  if (m && m.ember && m.emberT > Game.time) {
    for (let i = 0; i < m.ember; i++) pips.push(THEME.physical);
  }
  if (m && m.chill && m.chillT > Game.time) {
    for (let i = 0; i < m.chill; i++) pips.push(THEME.ccSlow);
  }
  if (u.pv && u.pv.hits > 0) {
    for (let i = 0; i < u.pv.hits; i++) pips.push(THEME.hp);
  }
  if (u.pv && u.pv.plates > 0) {
    for (let i = 0; i < u.pv.plates; i++) pips.push(THEME.shield);
  }
  // skill-owned marks (F12): one pip per live stack in the mark's colour
  if (u.markTags && m) {
    for (const tag of u.markTags) {
      if (tag === 'ember' || tag === 'chill') continue;   // the passive pips above already draw these
      if (!(m[tag] > 0) || !(m[tag + 'T'] > Game.time)) continue;
      for (let i = 0; i < m[tag]; i++) pips.push(m[tag + 'C'] || THEME.magic);
    }
  }
  if (!pips.length) return;
  const top = u._top || u.radius * 1.9;
  uprightAt(u.x, u.y, () => {
    const y = -(top + yOff * 0.6) + 11;
    const x0 = -(pips.length - 1) * 4.5;
    for (let i = 0; i < pips.length; i++) {
      ctx.beginPath();
      ctx.arc(x0 + i * 9, y, 3.2, 0, TAU);
      ctx.fillStyle = pips[i];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
  });
}

/* Role silhouettes. All inscribed in the same radius so collision and the
   health bar stay aligned no matter which shape a unit draws with. */
function drawSilhouette(x, y, r, shape) {
  if (shape === 'square') {                     // tanks / structures: blocky
    const s = r * 0.88;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (shape === 'diamond') {             // assassins / mages: sharp
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
  } else if (shape === 'hex') {                 // fighters: heavy but mobile
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {                                      // marksman / support / minion
    ctx.arc(x, y, r, 0, TAU);
  }
}

/* Role -> silhouette. Kept as a table so a new hero picks a shape by role
   instead of every renderer growing another branch. */
const ROLE_SHAPE = {
  Tank: 'square', Fighter: 'hex', Assassin: 'diamond',
  Mage: 'diamond', Marksman: 'circle', Support: 'circle',
};

/* transient rings: attack range on every swing, skill shape on every cast */
function drawIndicators() {
  for (const ind of Game.indicators) {
    const t = clamp(ind.age / ind.dur, 0, 1);
    const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
    const x = ind.unit ? ind.unit.x : ind.x;
    const y = ind.unit ? ind.unit.y : ind.y;
    const r = ind.r * (ind.grow ? lerp(0.75, 1, Math.min(1, t / 0.15)) : 1);
    ctx.save();
    if (ind.fill) {
      ctx.globalAlpha = fade * 0.16;
      ctx.fillStyle = ind.color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = fade * 0.9;
    ctx.strokeStyle = ind.color;
    ctx.lineWidth = ind.lw;
    if (ind.dash) ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

/* Turret threat rings. With a hero to judge from (the player, or the hero a
   spectator is following) they fade in on approach and glow red once that hero
   is inside. On the spectator's free camera there is no such reference, so every
   turret shows its reach at a flat, quiet alpha. */
function drawTowerRanges() {
  const ref = Game.player || Game.followHero;
  const live = !!(ref && ref.alive);
  if (!live && !Game.spectate) return;
  const FADE = 320;
  for (const t of Game.structures()) {
    if (!t.alive) continue;
    const R = t.range + t.radius;
    let alpha = 0.24, dash = true, lw = 3, hostile = false, inside = false;
    if (live) {
      const d = Math.hypot(ref.x - t.x, ref.y - t.y) - ref.radius;
      if (d > R + FADE) continue;
      hostile = t.team !== ref.team;
      inside = d <= R;
      const prox = clamp(1 - (d - R) / FADE, 0, 1);
      alpha = inside ? (hostile ? 0.55 + Math.sin(Game.time * 6) * 0.15 : 0.3)
        : 0.12 + prox * 0.25;
      dash = !inside;
      lw = inside && hostile ? 4 : 2.5;
    }
    ctx.save();
    if (inside && hostile) {
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = THEME.danger;
      ctx.beginPath(); ctx.arc(t.x, t.y, R, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = live && hostile ? THEME.danger : live ? THEME.blue : TEAM_COLORS[t.team];
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.arc(t.x, t.y, R, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

/* The duel shrine's rune. Drawn at ground level under the duellists, because
   the thing that matters while contesting it is where the two heroes are — but
   it pulses, so "the rune is up" is readable from the edge of the arena. */
function drawDuelRune() {
  const r = Game.duelRune;
  if (!r || !r.up) return;
  const s = DUEL_MAP.shrine, def = JUNGLE_BUFFS[r.kind];
  const pulse = 0.5 + Math.sin(Game.time * 3) * 0.5;

  const glow = ctx.createRadialGradient(s.x, s.y, 8, s.x, s.y, s.r + 70);
  glow.addColorStop(0, rgba(def.color, 0.42 + pulse * 0.18));
  glow.addColorStop(1, rgba(def.color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 70, 0, TAU); ctx.fill();

  ctx.strokeStyle = rgba(def.color, 0.75); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = rgba(def.color, 0.5 * (1 - pulse)); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.55 + pulse * 0.45), 0, TAU); ctx.stroke();

  // the rune itself hovers over the shrine — upright, so it reads as an
  // object floating above the floor rather than a decal painted on it
  uprightAt(s.x, s.y, () => {
    const hy = -(14 + pulse * 10);
    if (!Icons.paint(ctx, 'buff:' + r.kind, 0, hy, 52)) {
      ctx.font = '46px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, 0, hy);
      ctx.textBaseline = 'alphabetic';
    }
  });
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = THEME.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (Game.state === 'select') return;

  worldTransform();
  const W = Game.worldSize();
  const layer = Game.isDuel() ? duelMapLayer : Game.isTen() ? tenMapLayer : mapLayer;
  drawMapLayer(layer, W);

  // ground-level range overlays
  drawTowerRanges();
  drawIndicators();
  drawDuelRune();
  if (typeof Features !== 'undefined') Features.renderWorld(ctx);

  // zones (telegraphs + active). While the zone is arming, a white ring
  // collapses inward — "impact when it reaches the centre" is readable at a
  // glance — and the rim spins so a zone is never mistaken for ground paint.
  for (const z of Game.zones) {
    if (!inView(z.x, z.y, z.radius + 40)) continue;
    const col = TEAM_COLORS[z.team];
    if (z.lingerT > 0) {            // F13: a patch on the ground fading with its time left
      const k = clamp(z.lingerT / z.linger.dur, 0, 1);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.fillStyle = rgba(z.color || col, 0.08 + 0.14 * k);
      ctx.fill();
      ctx.strokeStyle = rgba(z.color || col, 0.35 + 0.3 * k); ctx.lineWidth = 2;
      ctx.setLineDash([5, 9]); ctx.lineDashOffset = -Game.time * 20;
      ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      continue;
    }
    const warm = z.delay > 0 ? 1 - z.delay / z.delay0 : 1;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, TAU);
    ctx.fillStyle = rgba(col, 0.10 + warm * 0.16);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = rgba(col, 0.85);
    ctx.setLineDash([16, 10]);
    ctx.lineDashOffset = -Game.time * 55;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (z.delay > 0) {
      ctx.beginPath(); ctx.arc(z.x, z.y, Math.max(6, z.radius * (1 - warm)), 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + warm * 0.5})`;
      ctx.lineWidth = 2.5 + warm * 2;
      ctx.stroke();
      if (warm > 0.7) {                       // about to pop: interior flares
        ctx.beginPath(); ctx.arc(z.x, z.y, z.radius, 0, TAU);
        ctx.fillStyle = rgba(col, (warm - 0.7) * 0.5 * (0.6 + 0.4 * Math.sin(Game.time * 26)));
        ctx.fill();
      }
    } else {
      ctx.beginPath(); ctx.arc(z.x, z.y, z.radius * (0.35 + 0.1 * Math.sin(Game.time * 6)), 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      ctx.stroke();
    }
    const sname = z.s && z.s.name;
    if (sname === 'Meteor' && z.delay > 0) {
      const fall = z.delay / z.delay0;
      // growing ground shadow (a circle: the tilt makes it an ellipse)...
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius * (0.24 + 0.6 * (1 - fall)), 0, TAU);
      ctx.fillStyle = `rgba(0,0,0,${0.18 + 0.42 * (1 - fall)})`;
      ctx.fill();
      // ...under a rock that falls through upright space toward it
      uprightAt(z.x, z.y, () => {
        const hy = -z.radius * 2.6 * fall - 16;
        ctx.beginPath(); ctx.arc(0, hy, 16 + (1 - fall) * 26, 0, TAU);
        ctx.fillStyle = rgba(THEME.physical, 0.5 + (1 - fall) * 0.45);
        ctx.shadowColor = THEME.physical; ctx.shadowBlur = 18;
        ctx.fill(); ctx.shadowBlur = 0;
      });
    } else if (z.s && (z.s.ticks > 1 || sname === 'Arrow Storm')) {
      ctx.strokeStyle = rgba(col, 0.4); ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + Game.time * 2.4;
        const rr = z.radius * (0.22 + (i % 3) * 0.2);
        const ax = z.x + Math.cos(a) * rr, ay = z.y + Math.sin(a) * rr;
        ctx.beginPath(); ctx.moveTo(ax, ay - 26); ctx.lineTo(ax + 3, ay + 8); ctx.stroke();
      }
    }
  }

  /* ---- the world's standing things, drawn in two stages ----
     Stage 1 (ground): shadows, team rings and auras — flat decals that the
     tilt projects into ellipses. They all draw before any body so a figure
     never stands on top of another unit's ring.
     Stage 2 (depth): every body — minions, monsters, heroes, structures and
     wall segments — queued with its ground-front edge and drawn
     back-to-front, so a hero can stand in front of a rock or vanish behind
     a tower. That painter's pass is what makes the height read as real. */
  const drawables = [];
  const pushBody = (y, fn) => drawables.push({ y, fn });

  // structures
  for (const t of Game.towers) {
    if (!inView(t.x, t.y, 320)) continue;
    if (t.alive) drawStructureGround(t);
    pushBody(t.y + t.radius * 0.85, () => drawStructure(t));
  }
  for (const b of Game.bases) {
    if (!inView(b.x, b.y, 320)) continue;
    if (b.alive) drawStructureGround(b);
    pushBody(b.y + b.radius * 0.85, () => drawStructure(b));
  }
  for (const i of Game.inhibitors) {
    if (!inView(i.x, i.y, 220)) continue;
    if (i.alive) drawStructureGround(i);
    pushBody(i.y + i.radius * 0.85, () => drawInhibitor(i));
  }

  // minions
  for (const m of Game.minions) {
    if (!inView(m.x, m.y, 70)) continue;
    drawUnitGround(m);
    const farmer = Game.player;
    const lastHit = !!(farmer && farmer.alive && m.team !== farmer.team &&
      Game.canSee(farmer.team, m) && farmer.inAttackRange(m) && Game.canLastHit(farmer, m));
    if (lastHit) {
      const pulse = 3 + Math.sin(Game.time * 7) * 1.5;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.radius + 7 + pulse, 0, TAU);
      ctx.strokeStyle = rgba(THEME.gold, 0.88); ctx.lineWidth = 3; ctx.stroke();
    }
    pushBody(m.y + m.radius, () => {
      drawUnitBody(m, null, 0, 'circle');
      drawMinionKind(m);
      drawHpBar(m, 34, 4, 12, TEAM_COLORS[m.team]);
      if (lastHit) {
        uprightAt(m.x, m.y, () => {
          ctx.fillStyle = THEME.gold; ctx.font = `800 13px ${UI_FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText('◆', 0, -(m._top || m.radius * 2) - 16);
        });
      }
    });
  }

  // monsters (jungle camps, buff camps, and the two epics)
  for (const mo of Game.monsters) {
    if (!inView(mo.x, mo.y, mo.epic ? 280 : 80)) continue;
    if (mo.epic) {
      // pit ring: marks the leash area so a contest has a visible arena
      ctx.beginPath();
      ctx.arc(mo.home.x, mo.home.y, 260, 0, TAU);
      ctx.strokeStyle = rgba(mo.color, 0.25); ctx.lineWidth = 3;
      ctx.setLineDash([18, 14]); ctx.stroke(); ctx.setLineDash([]);
      drawUnitGround(mo);
      pushBody(mo.y + mo.radius, () => {
        drawUnitBody(mo, mo.icon === '👑' ? 'epic:lord' : 'epic:turtle', 40, 'hex');
        drawHpBar(mo, 130, 9, 20, mo.color);
        uprightAt(mo.x, mo.y, () => {
          ctx.font = `800 13px ${UI_FONT}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = mo.color;
          ctx.fillText(mo.name.toUpperCase(), 0, -(mo._top || mo.radius * 2) - 30);
        });
      });
      continue;
    }
    const campCol = mo.buff ? mo.buff.color : (mo.color || THEME.neutral);
    const major = mo.kind === 'blueBuff' || mo.kind === 'redBuff';
    const glyph = major || mo.kind === 'litho' ? 'buff:' + mo.kind
      : mo.kind === 'crab' ? 'monster:crab' : 'monster:jungle';
    const campPulse = 1 + Math.sin(Game.time * 2.4 + mo.home.x * 0.006) * 0.05;
    const campGlow = ctx.createRadialGradient(mo.x, mo.y, 5, mo.x, mo.y, (major ? 58 : 46) * campPulse);
    campGlow.addColorStop(0, rgba(campCol, 0.28));
    campGlow.addColorStop(1, rgba(campCol, 0));
    ctx.fillStyle = campGlow;
    ctx.beginPath(); ctx.arc(mo.x, mo.y, (major ? 58 : 46) * campPulse, 0, TAU); ctx.fill();
    drawUnitGround(mo);
    pushBody(mo.y + mo.radius, () => {
      drawUnitBody(mo, glyph, major ? 26 : 22, mo.kind === 'crab' ? 'round' : 'hex');
      drawHpBar(mo, 50, 5, 14, campCol);
    });
  }

  // heroes (spectator sees everyone, bushes included)
  for (const h of Game.heroes) {
    if (!h.alive) continue;
    if (!inView(h.x, h.y, 80)) continue;
    const hidden = !Game.spectate && h.team !== TEAM_BLUE && !Game.canSee(TEAM_BLUE, h);
    if (hidden) continue;
    if (typeof Features !== 'undefined' && h.bush >= 0) {
      const prev = Features.lastBush.get(h) ?? -1;
      if (prev !== h.bush && h.team !== TEAM_BLUE && Game.canSee(TEAM_BLUE, h)) {
        Game.fx.spark(h.x, h.y, '#cde8c0', 4);
        if (SFX.tone) SFX.tone(220, 0.08, 'triangle', 0.03, 40);
      }
      Features.lastBush.set(h, h.bush);
    }
    const alpha = h.bush >= 0 ? (h.isPlayer ? 0.65 : 0.8) : 1;
    ctx.globalAlpha = alpha;
    // player halo
    if (h.isPlayer) {
      ctx.beginPath(); ctx.arc(h.x, h.y, h.radius + 10, 0, TAU);
      ctx.strokeStyle = rgba(THEME.text, 0.6); ctx.lineWidth = 2.5; ctx.stroke();
    }
    if (typeof Features !== 'undefined' && Features.prefs.colorblind) {
      ctx.beginPath(); ctx.arc(h.x, h.y, h.radius + 4, 0, TAU);
      ctx.strokeStyle = h.team === TEAM_BLUE ? '#4cc2ff' : '#ff9d5c';
      ctx.lineWidth = 3; ctx.stroke();
    }
    drawUnitGround(h);
    // active rune / buff aura: a soft coloured ring so "this hero has Sage"
    // is readable across a lane without opening the scoreboard
    for (const k in h.runes) {
      if (!(h.runes[k] > 0) || !JUNGLE_BUFFS[k]) continue;
      const bc = JUNGLE_BUFFS[k].color;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius + 13 + Math.sin(Game.time * 4 + h.x * 0.01) * 2, 0, TAU);
      ctx.strokeStyle = rgba(bc, 0.7); ctx.lineWidth = 2.6;
      ctx.shadowColor = bc; ctx.shadowBlur = 10;
      ctx.stroke(); ctx.shadowBlur = 0;
      break;   // one aura is enough; stacking would just muddy the silhouette
    }
    if (h.buffAtkT > 0 || h.buffAsT > 0) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius + 8, 0, TAU);
      ctx.strokeStyle = rgba(THEME.gold, 0.55 + 0.25 * Math.sin(Game.time * 8));
      ctx.lineWidth = 2; ctx.stroke();
    }
    if (h.recallT > 0) {
      ctx.beginPath(); ctx.arc(h.x, h.y, h.radius + 16 + Math.sin(Game.time * 8) * 4, 0, TAU);
      ctx.strokeStyle = rgba(THEME.blue, 0.85); ctx.lineWidth = 3; ctx.stroke();
      // recall channel: a progress arc that empties as the teleport approaches
      const frac = clamp(h.recallT / 3.2, 0, 1);
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius + 22, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - frac));
      ctx.strokeStyle = rgba(THEME.blue, 0.95); ctx.lineWidth = 3.5;
      ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    pushBody(h.y + h.radius, () => {
      ctx.globalAlpha = alpha;
      drawUnitBody(h, 'hero:' + h.def0.id, 28, ROLE_SHAPE[h.def0.role] || 'circle');
      const barCol = h.isPlayer ? THEME.hp : TEAM_COLORS[h.team];
      drawHpBar(h, 60, 7, 26, barCol);
      drawStatusMarks(h, 26);
      // level badge + name, floating over the figure
      uprightAt(h.x, h.y, () => {
        const top = h._top || h.radius * 2.2;
        ctx.textAlign = 'center';
        ctx.font = `800 11px ${UI_FONT}`;
        ctx.fillStyle = THEME.gold;
        ctx.beginPath();
        ctx.arc(-37, -(top + 18), 8, 0, TAU);
        ctx.fill();
        ctx.fillStyle = THEME.textInk;
        ctx.fillText(String(h.level), -37, -(top + 17.5));
        ctx.font = `700 12px ${UI_FONT}`;
        ctx.fillStyle = rgba(THEME.text, 0.9);
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
        ctx.strokeText(h.name, 0, -(top + 32));
        ctx.fillText(h.name, 0, -(top + 32));
      });
      ctx.globalAlpha = 1;
    });
  }

  // player's current target marker
  const pt = Game.player && Game.player.curTarget;
  if (pt && pt.alive && Game.player.alive) {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.radius + 8, 0, TAU);
    const locked = pt === Input.lockedTarget;
    ctx.strokeStyle = rgba(locked ? THEME.gold : THEME.danger, 0.92); ctx.lineWidth = locked ? 4 : 3;
    if (!locked) ctx.setLineDash([8, 6]);
    ctx.stroke(); ctx.setLineDash([]);
    if (locked) {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.radius + 15 + Math.sin(Game.time * 5) * 2, 0, TAU);
      ctx.strokeStyle = rgba(THEME.danger, 0.68); ctx.lineWidth = 2; ctx.setLineDash([3, 7]);
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // spectator follow ring
  if (Game.spectate && Game.followHero && Game.followHero.alive) {
    const f = Game.followHero;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.radius + 14, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
  }

  /* Terrain joins the same depth pass: each wall is chopped into its
     polyline segments so one long ridge can be in front of one hero and
     behind another at the same time. */
  const runArt = !Game.isTen() && typeof MapArt !== 'undefined';
  for (const w of Game.walls()) {
    if (w.hidden) continue;
    if (w.poly) {
      if (!inView((w.minX + w.maxX) / 2, (w.minY + w.maxY) / 2, (w.maxX - w.minX) / 2 + w.r * 2 + 120)) continue;
      pushBody(w.maxY, () => MapArt.drawWallPoly(ctx, w));
      continue;
    }
    let run = null;
    const flush = () => { if (run) { const segs = run.segs; pushBody(run.depth, () => MapArt.drawWallRun(ctx, segs)); run = null; } };
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1], b = w.pts[i];
      if (!inView((a.x + b.x) / 2, (a.y + b.y) / 2, w.r + 170)) { flush(); continue; }
      const r = a.r !== undefined ? (a.r + b.r) / 2 : w.r;
      const depth = Math.max(a.y, b.y) + r;
      if (!runArt) { pushBody(depth, () => drawWallPiece(a, b, r)); continue; }
      /* consecutive pieces at about one depth are painted as one body */
      if (run && Math.abs(depth - run.depth0) > 140) flush();
      if (!run) run = { segs: [], depth0: depth, depth };
      run.segs.push({ a, b, r }); run.depth = Math.max(run.depth, depth);
    }
    flush();
  }

  // back-to-front by ground-front edge: the painter's pass that turns the
  // extrusions into occlusion — the one honest depth cue this camera has
  drawables.sort((q, p) => q.y - p.y);
  for (const d of drawables) d.fn();

  // projectiles: a comet — motion streak behind a glowing core. The streak
  // uses last frame's position so it needs no per-projectile bookkeeping
  // placed objects (F9): traps show to their own side (and to an enemy who
  // has walked within enemyVisibleWithin), lanterns as a soft ring, barriers as a wall
  for (const o of Game.objects) {
    if (o.dead || !inView(o.x, o.y, 320)) continue;
    const col = o.color || TEAM_COLORS[o.team];
    if (o.mode === 'trap') {
      const p = Game.player;
      const mine = !p || p.team === o.team;
      if (!mine && !(o.s.enemyVisibleWithin && p.alive && dist(p, o) <= o.s.enemyVisibleWithin)) continue;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(Math.PI / 4);
      const sz = o.armed ? 11 : 8;
      ctx.fillStyle = rgba(col, o.armed ? 0.85 : 0.45);
      ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
      ctx.restore();
      if (mine) {
        ctx.beginPath(); ctx.arc(o.x, o.y, o.radius, 0, TAU);
        ctx.strokeStyle = rgba(col, 0.25); ctx.lineWidth = 1; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
      }
    } else if (o.mode === 'pulse') {
      const k = 1 - (o.tickT / (o.s.tick || 1));
      ctx.beginPath(); ctx.arc(o.x, o.y, o.radius, 0, TAU);
      ctx.fillStyle = rgba(col, 0.06 + 0.06 * k); ctx.fill();
      ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(o.x, o.y, 14 + 4 * Math.sin(Game.time * 5), 0, TAU);
      ctx.fillStyle = rgba(col, 0.9); ctx.fill();
    } else if (o.mode === 'barrier') {
      ctx.strokeStyle = rgba(col, 0.85); ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(o.bx, o.by); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(o.ax, o.ay - 6); ctx.lineTo(o.bx, o.by - 6); ctx.stroke();
    }
  }

  // tethers (F16): a line between the two units, pulsing as it nears its end
  for (const t of Game.tethers) {
    if (t.dead || !t.src || !t.target) continue;
    if (!inView(t.src.x, t.src.y, 40) && !inView(t.target.x, t.target.y, 40)) continue;
    const col = t.drawColor || (t.src.color || TEAM_COLORS[t.src.team]);
    const k = t.dur > 0 ? clamp(t.t / t.dur, 0, 1) : 1;
    ctx.strokeStyle = rgba(col, 0.55 + 0.35 * Math.sin(Game.time * (t.hostile ? 14 : 6)) * (1 - k));
    ctx.lineWidth = t.hostile ? 3.5 : 3;
    ctx.lineCap = 'round';
    ctx.setLineDash(t.hostile ? [10, 6] : [4, 8]);
    ctx.lineDashOffset = -Game.time * 60;
    ctx.beginPath(); ctx.moveTo(t.src.x, t.src.y - 18); ctx.lineTo(t.target.x, t.target.y - 18); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }

  // beyond two numbers, and it makes speed readable in a way a dot never was.
  // They fly at chest height: the body rides above the ground plane while a
  // small shadow tracks the true position beneath it.
  for (const p of Game.projectiles) {
    if (!inView(p.x, p.y, 90)) { p._lx = p.x; p._ly = p.y; continue; }
    const col = p.color || '#fff';
    const sz = p.size || 6;
    const FLY = 24;    // flight height above the ground plane
    ctx.beginPath();
    ctx.arc(p.x, p.y + 4, sz * 0.6, 0, TAU);
    ctx.fillStyle = 'rgba(2,6,8,0.3)'; ctx.fill();
    if (p._lx !== undefined) {
      const dx = p.x - p._lx, dy = p.y - p._ly;
      const len = Math.hypot(dx, dy);
      if (len > 0.5) {
        const k = Math.min(3.2, 46 / len);    // streak ~2-3 frames of travel
        const grad = ctx.createLinearGradient(p.x - dx * k, p.y - dy * k - FLY, p.x, p.y - FLY);
        grad.addColorStop(0, rgba(col, 0));
        grad.addColorStop(1, rgba(col, 0.55));
        ctx.strokeStyle = grad;
        ctx.lineWidth = sz * 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - dx * k, p.y - dy * k - FLY);
        ctx.lineTo(p.x, p.y - FLY);
        ctx.stroke();
      }
    }
    p._lx = p.x; p._ly = p.y;
    const ang = (p.dx || p.dy) ? Math.atan2(p.dy || 0, p.dx || 0)
      : (p.target ? Math.atan2(p.target.y - p.y, p.target.x - p.x) : 0);
    if (p.kind === 'skillshot' && p.style === 'hook' && p.src && p.src.alive) {
      ctx.strokeStyle = rgba(col, 0.7); ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(p.src.x, p.src.y - FLY); ctx.lineTo(p.x, p.y - FLY); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.translate(p.x, p.y - FLY);
    ctx.rotate(ang);
    if (p.style === 'bolt') {
      ctx.beginPath();
      ctx.moveTo(sz * 2.4, 0);
      ctx.lineTo(-sz * 1.4, -sz * 0.7);
      ctx.lineTo(-sz * 0.6, 0);
      ctx.lineTo(-sz * 1.4, sz * 0.7);
      ctx.closePath();
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.fill();
    } else if (p.style === 'orb') {
      ctx.beginPath(); ctx.arc(0, 0, sz, 0, TAU);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, sz * 1.55, 0, TAU);
      ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 2; ctx.stroke();
    } else if (p.style === 'hook') {
      ctx.beginPath();
      ctx.arc(sz * 0.4, 0, sz * 0.9, -0.9, 0.9);
      ctx.strokeStyle = col; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, sz, 0, TAU);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(-sz * 0.25, -sz * 0.25, sz * 0.35, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    ctx.restore();
    if (p.skillKey && typeof Icons !== 'undefined' && Icons.has(p.skillKey)) {
      Icons.paint(ctx, p.skillKey, p.x, p.y - FLY, sz * 2.6);
    }
  }

  // Bushes over units — concealment must cover the concealed. Dark under-
  // lobes below, lit lobes lifted above them, and a contact shadow: the
  // thicket reads as a mound you stand inside rather than paint you stand on.
  const bushLobes = (b, x, y, ang) => {
    const bush = Game.isTen() ? '#4a2214' : THEME.bush;
    const bushLt = Game.isTen() ? '#8a4a22' : THEME.bushLight;
    ctx.beginPath(); ctx.arc(x, y + 6, b.r * 0.95, 0, TAU);
    ctx.fillStyle = 'rgba(4,10,6,0.32)'; ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const lift = -b.r * 0.3;
    for (const [ox, oy, rr, col] of [
      [-0.44, 0.14, 0.6, rgba(mixHex(bush, '#020604', 0.4), 0.88)],
      [0.02, 0.06, 0.7, rgba(mixHex(bush, '#020604', 0.32), 0.86)],
      [0.46, 0.14, 0.56, rgba(mixHex(bush, '#020604', 0.4), 0.85)],
      [-0.42, 0.08 + lift / b.r, 0.6, rgba(bush, 0.92)],
      [0, -0.08 + lift / b.r, 0.72, rgba(bush, 0.94)],
      [0.42, 0.08 + lift / b.r, 0.6, rgba(bush, 0.9)],
      [-0.18, -0.16 + lift / b.r, 0.38, rgba(bushLt, 0.6)],
      [0.25, -0.2 + lift / b.r, 0.36, rgba(bushLt, 0.55)],
    ]) {
      ctx.beginPath(); ctx.arc(ox * b.r, oy * b.r, rr * b.r, 0, TAU);
      ctx.fillStyle = col; ctx.fill();
    }
    ctx.restore();
  };
  const bushPoly = b => {
    const path = (dx, dy) => { ctx.beginPath(); b.poly.forEach((p, i) => i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)); ctx.closePath(); };
    /* the grass itself is baked into the board; live, the bush is a lifted
       translucent canopy so units inside stay readable */
    ctx.globalAlpha = 0.55;
    path(0, -12); ctx.fillStyle = Game.isTen() ? '#4a2a18' : THEME.bushLight; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = Game.isTen() ? 'rgba(90,50,30,0.5)' : 'rgba(40,110,50,0.55)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    path(0, -12); ctx.stroke();
  };
  for (const b of Game.bushes()) {
    if (b.poly) {
      if (!inView((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.maxX - b.minX) / 2 + b.r + 60)) continue;
      bushPoly(b);
      continue;
    }
    const pad = b.ax === undefined ? b.r + 60 : b.r + 60 + Math.hypot(b.bx - b.ax, b.by - b.ay) / 2;
    if (!inView(b.x, b.y, pad)) continue;
    if (b.ax === undefined) {
      bushLobes(b, b.x, b.y, Math.atan2(b.y - Game.worldSize() / 2, b.x - Game.worldSize() / 2) + Math.PI / 4);
      continue;
    }
    // a capsule bush is a row of thickets along its axis
    const len = Math.hypot(b.bx - b.ax, b.by - b.ay), ang = Math.atan2(b.by - b.ay, b.bx - b.ax);
    const n = Math.max(1, Math.round(len / (b.r * 0.9)));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0.5;
      bushLobes(b, b.ax + (b.bx - b.ax) * t, b.ay + (b.by - b.ay) * t, ang);
    }
  }

  // effects
  for (const e of Game.effects) {
    if (!inView(e.x, e.y, (e.r || 40) + 40)) continue;
    const t = e.age / e.dur;
    if (e.kind === 'ring') {
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + 0.6 * t), 0, TAU);
      ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = 5;
      ctx.stroke(); ctx.globalAlpha = 1;
    } else if (e.kind === 'slash') {
      ctx.save();
      ctx.translate(e.x, e.y - 18); ctx.rotate(e.ang);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = e.color || '#fff'; ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      // the arc sweeps as it fades, so a hit reads as a swing not a flash
      ctx.beginPath(); ctx.arc(0, 0, 26 + t * 8, -0.7 + t * 0.5, 0.7 + t * 0.5); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.kind === 'spark') {
      ctx.beginPath(); ctx.arc(e.x, e.y, 3.5 * (1 - t), 0, TAU);
      ctx.fillStyle = e.color; ctx.globalAlpha = 1 - t;
      ctx.fill(); ctx.globalAlpha = 1;
    } else if (e.kind === 'crit') {
      // four expanding spikes: unmistakable at a glance, cheap to draw
      ctx.save();
      ctx.translate(e.x, e.y - 20);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = THEME.crit; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU + Math.PI / 4;
        const r0 = 10 + t * 22, r1 = r0 + 12;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.kind === 'shard') {
      ctx.save();
      ctx.translate(e.x, e.y - 14); ctx.rotate(e.rot);
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(e.size, 0);
      ctx.lineTo(-e.size * 0.6, -e.size * 0.55);
      ctx.lineTo(-e.size * 0.6, e.size * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.kind === 'flash') {
      const g2 = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
      g2.addColorStop(0, rgba(e.color, (1 - t) * 0.75));
      g2.addColorStop(1, rgba(e.color, 0));
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill();
    } else if (e.kind === 'rays') {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = e.color; ctx.lineCap = 'round';
      for (let i = 0; i < e.n; i++) {
        const a = i / e.n * TAU + 0.35;
        const r0 = 24 + t * e.r1, r1 = r0 + e.r1 * 0.4 * (1 - t);
        ctx.lineWidth = i % 2 ? 2 : 3.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.kind === 'ghost') {
      // dash afterimage: the silhouette, not a blob, so the trail reads as
      // "the hero was here" instead of generic smoke — drawn upright at the
      // height the body actually occupied
      ctx.globalAlpha = (1 - t) * 0.3;
      uprightAt(e.x, e.y, () => {
        ctx.beginPath();
        drawSilhouette(0, -e.r * 1.04, e.r, e.shape);
        ctx.fillStyle = e.color;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
  }

  // map pings (allies only — an enemy ping would leak their intent)
  for (const pg of Game.pings) {
    if (!Game.spectate && pg.team !== TEAM_BLUE) continue;
    const def = Game.PING_KINDS[pg.kind];
    const t = pg.age / 4;
    ctx.save();
    ctx.globalAlpha = 1 - t * t;
    // three rings pulsing outward: readable in a fight without being opaque
    for (let i = 0; i < 3; i++) {
      const k = (pg.age * 1.4 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(pg.x, pg.y, 20 + k * 70, 0, TAU);
      ctx.strokeStyle = rgba(def.color, (1 - k) * 0.85);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const bounce = 34 + Math.sin(pg.age * 5) * 4;
    uprightAt(pg.x, pg.y, () => {
      if (!Icons.paint(ctx, 'ping:' + pg.kind, 0, -bounce, 30)) {
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(def.icon, 0, -bounce);
      }
    });
    ctx.restore();
  }

  // aim indicator while dragging a skill
  drawAimIndicator();

  // floating numbers — upright text lifted to chest height, so damage pops
  // off the figure it belongs to instead of lying on the floor
  for (const f of Game.floaters) {
    if (!inView(f.x, f.y, 40)) continue;
    const t = f.age / f.dur;
    const jitter = f.shake ? Math.sin(f.age * 60) * f.shake * (1 - t) : 0;
    ctx.globalAlpha = 1 - t * t;
    uprightAt(f.x, f.y, () => {
      ctx.font = `900 ${f.size || 14}px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // only the player's own numbers get an outline; everything else stays
      // flat so a teamfight does not turn into a wall of high-contrast text
      if (f.outline) {
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
        ctx.strokeText(f.txt, jitter, -30);
      }
      ctx.fillStyle = f.color;
      ctx.fillText(f.txt, jitter, -30);
    });
    ctx.globalAlpha = 1;
  }

  // fog of war sits above the world and below the HUD
  drawFog();

  // screen-space overlays (in pixel space, after the world transform)
  drawScreenOverlays();
}

/* Low-HP vignette and combat-heat rim. Drawn in screen space so they frame
   the whole viewport rather than tracking a world position. */
function drawScreenOverlays() {
  const p = Game.player;
  if (!p || Game.spectate) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const W = canvas.width, H = canvas.height;

  if (p.alive && p.hpPct < 0.35) {
    const a = (0.35 - p.hpPct) / 0.35;
    const pulse = 0.72 + 0.28 * Math.sin(Game.time * (2.8 + (1 - p.hpPct) * 3));
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.74);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(160, 10, 30, ${a * 0.42 * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const heat = Game.combatHeat || 0;
  if (heat > 0.05) {
    const g2 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.78);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, `rgba(255, 140, 40, ${heat * 0.22})`);
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
  }
  if (typeof Features !== 'undefined') Features.renderOverlay(ctx);
}

/* Ground footing shared by towers, bases and inhibitors: contact shadow,
   paved pad, team ring, and the ground-anchored status rings (plates,
   outer-tower shield). All of it projects into ellipses under the tilt. */
function drawStructureGround(t) {
  const col = TEAM_COLORS[t.team];
  const R = t.radius;
  ctx.beginPath(); ctx.arc(t.x, t.y + R * 0.14, R * 1.2, 0, TAU);
  ctx.fillStyle = 'rgba(3,7,10,0.42)'; ctx.fill();
  ctx.beginPath(); ctx.arc(t.x, t.y, R * 1.14, 0, TAU);
  ctx.fillStyle = 'rgba(84,92,102,0.45)'; ctx.fill();
  ctx.beginPath(); ctx.arc(t.x, t.y, R * 1.14, 0, TAU);
  ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 2.5; ctx.stroke();
  // a shielded inner turret shows why it is not taking full damage
  if (t.shieldedByOuter) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, R + 12, 0, TAU);
    ctx.strokeStyle = rgba(THEME.shield, 0.45); ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
  }
  // The outer's opening energy shield is both a reward track and a readable
  // timer: three gold arcs, each fading with its third of the pool; every arc
  // disappears at five minutes.
  if (t.shieldActive) {
    const frac = t.shield / t.shieldMax;
    ctx.lineWidth = 4;
    ctx.shadowColor = THEME.gold; ctx.shadowBlur = 9;
    for (let i = 0; i < 3; i++) {
      const fill = clamp(frac * 3 - i, 0, 1);
      if (fill <= 0) continue;
      ctx.strokeStyle = rgba(THEME.gold, 0.25 + 0.57 * fill);
      const a = -Math.PI / 2 + i * TAU / 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, R + 17, a + 0.16, a + TAU / 3 - 0.16); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  // Orange Alert: the hardened middle turret shows a warm ring
  if (t.alertT > Game.time) {
    ctx.beginPath(); ctx.arc(t.x, t.y, R + 22, 0, TAU);
    ctx.strokeStyle = rgba(THEME.warn, 0.5); ctx.lineWidth = 3; ctx.stroke();
  }
}

/* Inhibitor. Drawn as a standing gate rather than a tower so it never reads
   as something that shoots back, and shows its respawn countdown when down. */
function drawInhibitor(u) {
  const col = TEAM_COLORS[u.team];
  const deep = TEAM_DEEP[u.team];
  const R = u.radius;
  if (!u.alive) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(u.x, u.y, R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    uprightAt(u.x, u.y, () => {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = rgba(THEME.text, 0.8);
      ctx.font = `800 14px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('DESTROYED', 0, -10);   // inhibitors never come back
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    });
    return;
  }
  uprightAt(u.x, u.y, () => {
    const span = R * 0.72, pw = R * 0.3, ph = R * 1.62;
    // pillars, lit face toward the sun side
    for (const s of [-1, 1]) {
      const px = s * span;
      ctx.fillStyle = mixHex(deep, s < 0 ? '#ffffff' : '#05070c', 0.22);
      ctx.fillRect(px - pw / 2, -ph, pw, ph);
      ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 1.5;
      ctx.strokeRect(px - pw / 2, -ph, pw, ph);
      ctx.fillStyle = mixHex(deep, '#ffffff', 0.3);
      ctx.fillRect(px - pw * 0.72, -ph - R * 0.14, pw * 1.44, R * 0.14);
    }
    // lintel across the top
    ctx.fillStyle = deep;
    ctx.fillRect(-span - pw * 0.72, -ph, span * 2 + pw * 1.44, R * 0.24);
    ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1.5;
    ctx.strokeRect(-span - pw * 0.72, -ph, span * 2 + pw * 1.44, R * 0.24);
    // glowing portcullis bars hang inside the frame
    ctx.strokeStyle = rgba(col, 0.75); ctx.lineWidth = 2.2;
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * span * 0.5, -ph + R * 0.28);
      ctx.lineTo(i * span * 0.5, -R * 0.08);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  });
  u._top = R * 1.85;
  if (u.hp < u.maxHp) drawHpBar(u, 64, 6, 18, col);
}

/* Turret / base as standing architecture. Damage states are read off HP so a
   sieged turret looks sieged from across the map — no extra state to sync. */
function drawStructure(t) {
  const R = t.radius;
  if (!t.alive) {
    // rubble mound + broken stump: "was a tower" from any distance
    ctx.beginPath(); ctx.arc(t.x, t.y + R * 0.1, R * 0.95, 0, TAU);
    ctx.fillStyle = 'rgba(3,7,10,0.3)'; ctx.fill();
    uprightAt(t.x, t.y, () => {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#2c3138';
      ctx.beginPath(); ctx.ellipse(0, -3, R * 0.8, R * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a4049';
      ctx.beginPath(); ctx.ellipse(-R * 0.26, -R * 0.26, R * 0.32, R * 0.18, 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(R * 0.3, -R * 0.18, R * 0.26, R * 0.15, -0.4, 0, TAU); ctx.fill();
      const sg = ctx.createLinearGradient(-R * 0.3, 0, R * 0.3, 0);
      sg.addColorStop(0, '#4a515c'); sg.addColorStop(1, '#262b33');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(-R * 0.3, -R * 0.16);
      ctx.lineTo(-R * 0.24, -R * 0.88);
      ctx.lineTo(-R * 0.02, -R * 0.62);
      ctx.lineTo(R * 0.16, -R * 0.98);
      ctx.lineTo(R * 0.28, -R * 0.16);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,20,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    });
    return;
  }
  const col = TEAM_COLORS[t.team];
  const deep = TEAM_DEEP[t.team];
  const pct = t.hpPct;

  if (t.isBase) {
    // the base: a great crystal floating over a stepped plinth
    const bob = Math.sin(Game.time * 1.6) * 3;
    uprightAt(t.x, t.y, () => {
      ctx.fillStyle = '#3f4650';
      ctx.beginPath(); ctx.ellipse(0, -2, R * 0.98, R * 0.36, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4a525e';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.24, R * 0.76, R * 0.28, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#565f6c';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.44, R * 0.52, R * 0.2, 0, 0, TAU); ctx.fill();

      ctx.save();
      ctx.translate(0, -R * 1.35 + bob);
      const grad = ctx.createLinearGradient(-R * 0.5, -R * 0.95, R * 0.45, R * 0.8);
      grad.addColorStop(0, 'rgba(255,255,255,0.92)');
      grad.addColorStop(0.45, rgba(col, 0.95));
      grad.addColorStop(1, rgba(deep, 1));
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.98); ctx.lineTo(R * 0.55, 0);
      ctx.lineTo(0, R * 0.82); ctx.lineTo(-R * 0.55, 0);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.shadowColor = col; ctx.shadowBlur = 22;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(10,14,26,0.7)'; ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.moveTo(0, -R * 0.98); ctx.lineTo(0, R * 0.82); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * 0.55, 0); ctx.lineTo(R * 0.55, 0); ctx.stroke();
      // heartbeat glow while healthy
      ctx.beginPath(); ctx.arc(0, 0, R * (0.18 + 0.05 * Math.sin(Game.time * 2.4)), 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      ctx.restore();

      // light beam anchoring the crystal to its plinth
      const beam = ctx.createLinearGradient(0, -R * 0.4, 0, -R * 1.2);
      beam.addColorStop(0, rgba(col, 0.35)); beam.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(-R * 0.3, -R * 0.4); ctx.lineTo(R * 0.3, -R * 0.4);
      ctx.lineTo(R * 0.12, -R * 1.3); ctx.lineTo(-R * 0.12, -R * 1.3);
      ctx.closePath(); ctx.fill();
    });
    t._top = R * 2.45;
  } else {
    // turret: pedestal, tapered stone column, team cap, watching eye
    const H = R * 2.35;
    uprightAt(t.x, t.y, () => {
      ctx.fillStyle = '#3f4650';
      ctx.beginPath(); ctx.ellipse(0, -2, R * 0.9, R * 0.32, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4a525e';
      ctx.beginPath(); ctx.ellipse(0, -R * 0.22, R * 0.7, R * 0.25, 0, 0, TAU); ctx.fill();

      const cg = ctx.createLinearGradient(-R * 0.52, 0, R * 0.52, 0);
      cg.addColorStop(0, mixHex(deep, '#ffffff', 0.5));
      cg.addColorStop(0.5, '#c9d2dd');
      cg.addColorStop(1, mixHex(deep, '#070a10', 0.15));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(-R * 0.52, -R * 0.2);
      ctx.lineTo(-R * 0.36, -H * 0.8);
      ctx.lineTo(R * 0.36, -H * 0.8);
      ctx.lineTo(R * 0.52, -R * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,26,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      // masonry joints
      ctx.strokeStyle = 'rgba(10,14,26,0.26)'; ctx.lineWidth = 1.4;
      for (const f of [0.34, 0.56]) {
        const yy = -H * 0.8 * f - R * 0.08;
        const ww = lerp(R * 0.48, R * 0.38, f);
        ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.stroke();
      }
      // team-coloured cap with battlement teeth
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, -H * 0.8);
      ctx.lineTo(R * 0.5, -H * 0.8);
      ctx.lineTo(R * 0.42, -H * 0.95);
      ctx.lineTo(-R * 0.42, -H * 0.95);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = mixHex(deep, '#ffffff', 0.16);
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(i * R * 0.28 - R * 0.09, -H * 1.03, R * 0.18, H * 0.09);
      }
      // eye orb: brighter and swollen while charging a shot
      const charge = t.chargeT > 0 ? t.chargeT : 0;
      const ey = -H * 1.1;
      ctx.beginPath(); ctx.arc(0, ey, R * (0.2 + charge * 0.1), 0, TAU);
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 12 + charge * 16;
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(-R * 0.05, ey - R * 0.06, R * 0.07, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
      // damage state: cracks appear past 40% lost
      if (pct < 0.6) {
        ctx.globalAlpha = (0.6 - pct) / 0.6;
        ctx.strokeStyle = 'rgba(8,10,14,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-R * 0.2, -R * 0.3); ctx.lineTo(-R * 0.05, -H * 0.4);
        ctx.lineTo(-R * 0.3, -H * 0.56);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(R * 0.26, -H * 0.72); ctx.lineTo(R * 0.1, -H * 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });
    t._top = R * 2.75;
  }
  if (pct < 0.25 && Math.random() < 0.25) {
    Game.fx.spark(t.x + rand(-R, R), t.y + rand(-R, 0), THEME.physical, 1);
  }
  if (t.hp < t.maxHp) drawHpBar(t, t.isBase ? 110 : 70, 8, 22, col);
}

function drawAimIndicator() {
  const p = Game.player;
  if (!p || !p.alive || !Input.aim.active) return;
  const s = Input.aim.spell
    ? { type: 'dash', dist: 420, color: THEME.magic }
    : p.skills[Input.aim.skill];
  if (!s) return;
  const hasDir = Input.aim.dist > 28;
  const dir = hasDir ? norm(Input.aim.dx, Input.aim.dy) : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  const col = s.color || p.color || p.projColor || '#ffffff';
  const cancel = Input.aim.cancelHover;
  ctx.lineWidth = 3;
  ctx.strokeStyle = cancel ? 'rgba(255,80,80,0.75)' : rgba(col, 0.75);
  ctx.fillStyle = cancel ? 'rgba(255,60,60,0.14)' : rgba(col, 0.16);
  if (s.type === 'nova' || s.type === 'heal' || s.type === 'buff') {
    const r = s.radius || 150;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); ctx.stroke();
  } else if (s.type === 'zone') {
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(p.x, p.y, s.range, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    const fr = hasDir ? clamp((Input.aim.dist - 20) / 70, 0.3, 1) : 1;
    const tx = p.x + dir.x * s.range * fr, ty = p.y + dir.y * s.range * fr;
    ctx.beginPath(); ctx.arc(tx, ty, s.radius, 0, TAU); ctx.fill(); ctx.stroke();
    // telegraph delay ring so delayed ults feel readable
    if (s.delay) {
      ctx.beginPath();
      ctx.arc(tx, ty, s.radius * 0.55, 0, TAU);
      ctx.strokeStyle = rgba(col, 0.45);
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (s.type === 'dash' || Input.aim.spell) {
    const len = s.dist || s.range || 400;
    const tx = p.x + dir.x * len, ty = p.y + dir.y * len;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, p.radius + 8, 0, TAU);
    ctx.fill();
    ctx.stroke();
  } else {
    const len = s.range || s.dist || 400;
    const halfW = Math.max(14, (s.radius || 22) * 0.95);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(dir.y, dir.x));
    ctx.beginPath();
    ctx.moveTo(0, -halfW);
    ctx.lineTo(len, -halfW);
    ctx.lineTo(len + halfW * 0.6, 0);
    ctx.lineTo(len, halfW);
    ctx.lineTo(0, halfW);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/* ---------- main loop ---------- */
const SIM_STEP = 1 / 60;
const RENDER_STEP = 1 / 60;
let lastT = performance.now();
let simAcc = 0;
let drawAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;

  if (Game._clockReset) {
    lastT = now;
    simAcc = 0;
    drawAcc = 0;
    Game._clockReset = false;
  }
  const raw = Math.min(0.08, (now - lastT) / 1000);
  lastT = now;

  if (Game.paused) {
    drawAcc += raw;
    if (drawAcc >= RENDER_STEP * 0.85) {
      drawAcc = 0;
      render();
      UI.syncHUD(0);
    }
    return;
  }

  if (Game.state === 'play') {
    let simDt = raw;
    if (Game.hitStop > 0 && !Game.spectate) {
      Game.hitStop = Math.max(0, Game.hitStop - raw);
      simDt *= 0.42;
    }
    simAcc += simDt;
    if (simAcc > 0.25) simAcc = 0.25;
    const n = Game.spectate ? Game.simSpeed : 1;
    while (simAcc >= SIM_STEP && Game.state === 'play') {
      for (let i = 0; i < n && Game.state === 'play'; i++) Game.update(SIM_STEP);
      simAcc -= SIM_STEP;
    }
    Game.updateCamera(raw);
  } else {
    simAcc = 0;
  }
  Game.updateEffects(raw);

  /* High-refresh displays were painting this canvas twice a frame for no
     visible gain. Cap the paint + HUD at 60 Hz; the sim already steps there. */
  drawAcc += raw;
  const step = Game.attract ? RENDER_STEP * 2 : RENDER_STEP;
  if (drawAcc < step * 0.85) return;
  const hudDt = drawAcc;
  drawAcc -= step;
  if (drawAcc > step) drawAcc = 0;
  render();
  UI.syncHUD(hudDt);
}

/* ---------- spectator camera: drag pan, wheel zoom, click to follow ---------- */
let panPtr = null;
canvas.addEventListener('pointerdown', e => {
  if (!Game.spectate || Game.state === 'select') return;
  panPtr = { id: e.pointerId, lx: e.clientX, ly: e.clientY, moved: 0 };
});
document.addEventListener('pointermove', e => {
  if (!panPtr || e.pointerId !== panPtr.id) return;
  const dx = e.clientX - panPtr.lx, dy = e.clientY - panPtr.ly;
  panPtr.lx = e.clientX; panPtr.ly = e.clientY;
  panPtr.moved += Math.abs(dx) + Math.abs(dy);
  if (panPtr.moved > 8) {
    Game.followHero = null;
    canvas.classList.add('panning');
    Game.cam.x -= dx / Game.cam.zoom;
    Game.cam.y -= dy / (Game.cam.zoom * TILT);
    Game.clampSpectatorCamera(CW, CH);
  }
});
document.addEventListener('pointerup', e => {
  if (!panPtr || e.pointerId !== panPtr.id) return;
  canvas.classList.remove('panning');
  if (panPtr.moved <= 8) {
    // click: follow the hero under the cursor (or release follow)
    const { x: wx, y: wy } = Game.screenToWorld(e.clientX, e.clientY);
    let best = null, bd = Infinity;
    for (const h of Game.heroes) {
      if (!h.alive) continue;
      const d = Math.hypot(h.x - wx, h.y - wy);
      if (d < h.radius + 22 && d < bd) { bd = d; best = h; }
    }
    Game.followHero = best;
  }
  panPtr = null;
});
canvas.addEventListener('wheel', e => {
  if (Game.state !== 'play') return;
  e.preventDefault();
  if (Game.spectate) {
    Game.cam.zoomWant = clamp((Game.cam.zoomWant || Game.cam.zoom) * (e.deltaY < 0 ? 1.12 : 0.89),
      Game.spectatorMinZoom(CW, CH), 1.6);
  } else {
    Game.cam.zoomWant = clamp((Game.cam.zoomWant || Game.cam.zoom) * (e.deltaY < 0 ? 1.08 : 0.93), 0.72, 1.45);
  }
}, { passive: false });

/* ---------- boot ---------- */
applyThemeToCSS();
buildMapLayer();
buildDuelMapLayer();
buildTenMapLayer();
resize();
UI.init();
if (typeof Native !== 'undefined') Native.init();
Input.init();
document.addEventListener('pointerdown', () => SFX.ensure(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Game.pause();
});
document.addEventListener('keydown', e => {
  if (!Game.paused) return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
    Game.resume();
    e.preventDefault();
  }
});
requestAnimationFrame(frame);
