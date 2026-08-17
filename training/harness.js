'use strict';
/* ============================================================
   harness.js — headless data collection + bot-vs-bot evaluation.

   Runs the real game loop with rendering disabled (requestAnimationFrame
   is stubbed before boot), a fixed timestep, and a seeded RNG, so a given
   seed reproduces the same match.
   ============================================================ */

const DT = 1 / 60;
const MAX_STEPS = 115000;          // ~32 game-minutes; the 30-min cap ends matches first
const LINEUP_IDS = ['grom', 'ignis', 'zephyr', 'nyx', 'karn'];

const logEl = document.getElementById('log');
const log = (...a) => {
  logEl.textContent += '\n' + a.join(' ');
  logEl.scrollTop = logEl.scrollHeight;
  console.log(...a);
};
const $ = id => document.getElementById(id);

const Harness = {
  dataBlobUrl: null, evalResults: null,

  lineup() { return LINEUP_IDS.map(id => HEROES.find(h => h.id === id)); },

  /* One headless match. botTypes indexed by team. Returns per-team stats. */
  runMatch({ seed, botTypes = ['heuristic', 'heuristic'], record = false, matchId = 0 }) {
    RNG.seed(seed);
    NeuralController.resetStats();
    Game.experiment = { lineup: this.lineup(), botTypes };
    if (record) Recorder.start(matchId, seed);
    Game.start(null);

    const tele = [
      { retreatTicks: 0, ticks: 0, targetSwitches: 0, recallsStarted: 0, recallsDone: 0, deathsNearTower: 0 },
      { retreatTicks: 0, ticks: 0, targetSwitches: 0, recallsStarted: 0, recallsDone: 0, deathsNearTower: 0 },
    ];
    const prev = new Map();
    let steps = 0;
    while (Game.state === 'play' && steps < MAX_STEPS) {
      Game.update(DT);
      steps++;
      if (steps % 15 === 0) {                     // ~4 Hz telemetry, matching think rate
        for (const h of Game.heroes) {
          const t = tele[h.team];
          t.ticks++;
          if (h.alive && h.aiState === 'retreat') t.retreatTicks++;
          const p = prev.get(h);
          if (p && p.target !== h.aiTarget && h.aiTarget) t.targetSwitches++;
          if (p && p.recallT <= 0 && h.recallT > 0) t.recallsStarted++;
          if (p && p.recallT > 0 && h.recallT <= 0 && h.alive &&
              dist(h, FOUNTAINS[h.team]) < 200) t.recallsDone++;
          if (p && p.alive && !h.alive) {
            const nearTower = Game.structures().some(s =>
              s.alive && s.team !== h.team && dist(h, s) < s.range + 60);
            if (nearTower) t.deathsNearTower++;
          }
          prev.set(h, { target: h.aiTarget, recallT: h.recallT, alive: h.alive });
        }
      }
    }
    const winner = Game.lastWinner;
    const goldDiffs = Game.goldHistory.map(s => s.blue - s.red);
    goldDiffs.push(Game.teamGold(TEAM_BLUE) - Game.teamGold(TEAM_RED));
    const per = [0, 1].map(team => {
      const hs = Game.heroes.filter(h => h.team === team);
      const sum = f => hs.reduce((s, h) => s + f(h), 0);
      return {
        team, botType: botTypes[team],
        won: winner === team ? 1 : 0,
        kills: sum(h => h.kills), deaths: sum(h => h.deaths), assists: sum(h => h.assists),
        dmgHero: Math.round(sum(h => h.stats.dmgHero)),
        dmgStruct: Math.round(sum(h => h.stats.dmgStruct)),
        gold: Math.round(sum(h => h.goldEarned)),
        level: +(sum(h => h.level) / hs.length).toFixed(1),
        towersKilled: Game.towers.filter(t => !t.alive && t.team !== team).length,
        retreatFrac: +(tele[team].retreatTicks / Math.max(1, tele[team].ticks)).toFixed(3),
        targetSwitches: tele[team].targetSwitches,
        recallsStarted: tele[team].recallsStarted,
        recallsDone: tele[team].recallsDone,
        deathsNearTower: tele[team].deathsNearTower,
      };
    });
    const out = {
      seed, matchId, minutes: +(Game.time / 60).toFixed(2), steps,
      winnerTeam: winner, teams: per,
      finalGoldLead: Math.round(goldDiffs[goldDiffs.length - 1]),
      peakGoldLead: Math.round(Math.max(...goldDiffs.map(Math.abs))),
      neural: { ...NeuralController.stats },
      timedOut: steps >= MAX_STEPS,
    };
    Game.experiment = null;
    $('end').classList.add('hidden');
    RNG.restore();
    return out;
  },

  /* ---- 1. teacher data collection ---- */
  async collect(nMatches, seedBase, maxExamples) {
    Recorder.reset();
    Recorder.enabled = true;
    Recorder.cfg.maximumExamples = maxExamples;
    log(`\ncollecting ${nMatches} teacher matches (seeds ${seedBase}..${seedBase + nMatches - 1})`);
    const t0 = performance.now();
    for (let i = 0; i < nMatches; i++) {
      const r = this.runMatch({ seed: seedBase + i, matchId: i, record: true,
        botTypes: ['heuristic', 'heuristic'] });
      log(`  match ${i + 1}/${nMatches}  seed=${r.seed}  ${r.minutes}min  ` +
          `rows=${Recorder.rows.length}`);
      await new Promise(res => setTimeout(res, 0));   // let the page breathe
      if (Recorder.rows.length >= maxExamples) { log('  reached maximumExamples, stopping'); break; }
    }
    Recorder.enabled = false;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const s = Recorder.summary();
    log(`\ndone in ${secs}s — ${s.rows} examples (dropped ${s.dropped} repetitive ticks)`);
    log(`  withTarget=${s.withTarget}  retreat=${s.retreat}  recall=${s.recall}  skillEligible=${s.skill}`);
    log(`  examples/sec = ${(s.rows / secs).toFixed(0)}`);

    const jsonl = Recorder.toJSONL();
    const blob = new Blob([jsonl], { type: 'application/x-jsonlines' });
    if (this.dataBlobUrl) URL.revokeObjectURL(this.dataBlobUrl);
    this.dataBlobUrl = URL.createObjectURL(blob);
    $('btnDownloadData').disabled = false;
    log(`dataset ready: ${(blob.size / 1048576).toFixed(2)} MB`);
    log(await this.save('training/data/dataset.jsonl', jsonl));
    return s;
  },

  /* write straight into the project via the dev server's /_save endpoint */
  async save(path, text) {
    try {
      const res = await fetch('/_save?path=' + encodeURIComponent(path),
        { method: 'POST', body: text });
      return res.ok ? '  ' + (await res.text()) : `  save failed: HTTP ${res.status}`;
    } catch (e) { return `  save failed (${e.message}) — use the download button instead`; }
  },

  /* ---- 3. bot-vs-bot evaluation (sides alternated) ---- */
  async evaluate(matchesPerPair, seedBase) {
    const pairs = [
      ['heuristic', 'heuristic'],
      ['neural', 'heuristic'],
      ['heuristic', 'neural'],
      ['neural', 'neural'],
    ];
    const results = { generated: new Date().toISOString(), matchesPerPair, seedBase,
      modelLoaded: NeuralRuntime.ready, sampling: NeuralController.sampling, pairs: [] };
    for (const bt of pairs) {
      const label = `blue=${bt[0]} vs red=${bt[1]}`;
      log(`\n${label}`);
      const rows = [];
      for (let i = 0; i < matchesPerPair; i++) {
        const r = this.runMatch({ seed: seedBase + i, matchId: i, botTypes: bt });
        rows.push(r);
        log(`  seed=${r.seed} ${r.minutes}min winner=${r.winnerTeam === 0 ? 'BLUE' : 'RED'}` +
            ` k=${r.teams[0].kills}/${r.teams[1].kills}` +
            ` towers=${r.teams[0].towersKilled}/${r.teams[1].towersKilled}` +
            ` goldGap=${Math.abs(r.finalGoldLead)} peak=${r.peakGoldLead}` +
            (r.neural.ticks ? ` neuralTicks=${r.neural.ticks} fallbacks=${r.neural.fallbacks}` : ''));
        await new Promise(res => setTimeout(res, 0));
      }
      const agg = t => {
        const a = {};
        for (const k of ['won', 'kills', 'deaths', 'assists', 'dmgHero', 'dmgStruct', 'gold',
          'towersKilled', 'retreatFrac', 'targetSwitches', 'recallsStarted', 'recallsDone',
          'deathsNearTower', 'level']) {
          a[k] = +(rows.reduce((s, r) => s + r.teams[t][k], 0) / rows.length).toFixed(2);
        }
        a.wins = rows.reduce((s, r) => s + r.teams[t].won, 0);
        return a;
      };
      const entry = { botTypes: bt, matches: rows.length,
        avgMinutes: +(rows.reduce((s, r) => s + r.minutes, 0) / rows.length).toFixed(2),
        avgFinalGoldGap: +(rows.reduce((s, r) => s + Math.abs(r.finalGoldLead), 0) / rows.length).toFixed(2),
        avgPeakGoldGap: +(rows.reduce((s, r) => s + r.peakGoldLead, 0) / rows.length).toFixed(2),
        blue: agg(0), red: agg(1),
        neuralTicks: rows.reduce((s, r) => s + r.neural.ticks, 0),
        neuralFallbacks: rows.reduce((s, r) => s + r.neural.fallbacks, 0),
        neuralNoTarget: rows.reduce((s, r) => s + r.neural.noTarget, 0),
        neuralPicked: rows.reduce((s, r) => s + r.neural.picked, 0),
        matchesDetail: rows };
      results.pairs.push(entry);
      log(`  => blue wins ${entry.blue.wins}/${rows.length}, red wins ${entry.red.wins}/${rows.length},` +
          ` avg ${entry.avgMinutes}min`);
    }
    // side-balanced neural summary
    const nh = results.pairs[1], hn = results.pairs[2];
    const neuralWins = nh.blue.wins + hn.red.wins;
    const total = nh.matches + hn.matches;
    results.summary = {
      neuralVsHeuristic: { neuralWins, total, winRate: +(neuralWins / total).toFixed(3) },
      neuralFallbackRate: nh.neuralTicks ? +((nh.neuralFallbacks + hn.neuralFallbacks) /
        (nh.neuralTicks + hn.neuralTicks)).toFixed(4) : null,
    };
    log(`\n=== neural vs heuristic (sides balanced): ${neuralWins}/${total} ` +
        `= ${(neuralWins / total * 100).toFixed(0)}% win rate ===`);
    this.evalResults = results;
    $('btnDownloadEval').disabled = false;
    return results;
  },
};

/* ---------- buttons ---------- */
$('btnCollect').addEventListener('click', async e => {
  e.target.disabled = true;
  try { await Harness.collect(+$('nMatches').value, +$('seedBase').value, +$('maxEx').value); }
  catch (err) { log('ERROR: ' + err.message + '\n' + err.stack); }
  e.target.disabled = false;
});
$('btnDownloadData').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = Harness.dataBlobUrl; a.download = 'dataset.jsonl'; a.click();
});
$('btnLoadModel').addEventListener('click', async () => {
  const ok = await NeuralRuntime.load('../models/neural-bot-v1/model.json');
  log(ok ? `model loaded: hidden=${NeuralRuntime.cfg.H}, K=${NeuralRuntime.cfg.K}`
         : `model NOT loaded (${NeuralRuntime.loadError}) — neural bots fall back to heuristic`);
});
$('btnEval').addEventListener('click', async e => {
  e.target.disabled = true;
  try { await Harness.evaluate(+$('nMatches').value, +$('seedBase').value); }
  catch (err) { log('ERROR: ' + err.message + '\n' + err.stack); }
  e.target.disabled = false;
});
$('btnDownloadEval').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(Harness.evalResults, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'eval.json'; a.click();
});
$('btnTests').addEventListener('click', () => {
  logEl.textContent = 'running deterministic AI scenarios…';
  /* Yield once so browser automation and the visible harness can observe the
     click before the deliberately synchronous simulation suite occupies the
     main thread. */
  setTimeout(() => {
    logEl.textContent = '';
    try { runAITests(log); }
    catch (err) { log(`\nTEST RUN ABORTED: ${err && err.stack ? err.stack : err}`); }
  }, 0);
});
$('btnClear').addEventListener('click', () => { logEl.textContent = 'ready.'; });

log('harness loaded — rendering disabled, fixed timestep ' + DT.toFixed(5) + 's');

/* Automation-friendly entry point: opening ?autorun=1 runs the same scenarios
   as the button after the page has finished booting. */
if (new URLSearchParams(location.search).has('autorun')) {
  setTimeout(() => $('btnTests').click(), 100);
}
