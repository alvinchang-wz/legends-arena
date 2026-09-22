#!/usr/bin/env node
'use strict';

/*
 * Batch runner: many headless matches in parallel worker threads, aggregated
 * into per-hero / per-role / per-match statistics.
 *
 *   node headless/batch.js --matches 100 --out ./batch-out
 *
 * Each match is fully determined by (seed, lineups, mode, bots), so a batch
 * is reproducible from its --seed-start. Random lineups are drawn from the
 * batch seed, not from the game's RNG.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const HELP = `Legends Arena batch runner

Usage:
  node headless/batch.js [options]

Options:
  --matches N            Matches to run (default: 20)
  --seed-start S         First game seed; match i uses S + i (default: 1)
  --duration-cap-ms N    Stop a match after this much game time (default: none; the game caps at 30 min)
  --mode standard|duel   Match mode (default: standard)
  --lineups random|fixed random: 5 per team drawn by role composition (default)
                         fixed: --blue-lineup / --red-lineup (or the game's own draft when omitted)
  --blue-lineup IDS      Comma-separated hero ids (fixed lineups)
  --red-lineup IDS       Comma-separated hero ids (fixed lineups)
  --bots heuristic|neural  Bot controller for both teams (default: heuristic)
  --workers N            Worker threads (default: all cores)
  --out DIR              Output directory (default: <tmp>/legends-arena-batch)
  --quiet                No progress output
  --help                 Show this help

Outputs (in --out):
  batch.json             Aggregates plus every match's statistics
  batch.md               Markdown tables of the aggregates
`;

const ROLE_ORDER = ['Marksman', 'Mage', 'Tank', 'Assassin', 'Fighter', 'Support'];

function parseArgs(argv) {
  const out = {};
  const booleanFlags = new Set(['help', 'quiet']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const equals = arg.indexOf('=');
    const rawKey = arg.slice(2, equals < 0 ? undefined : equals);
    if (booleanFlags.has(rawKey)) { out[rawKey] = true; continue; }
    const value = equals >= 0 ? arg.slice(equals + 1) : argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
    out[rawKey] = value;
  }
  return out;
}

/* Small seeded PRNG for lineup draws (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Draw one team by role composition: 1 marksman, 1 mage, 1 tank,
   1 assassin-or-fighter, 1 support-or-fighter, no hero twice. The returned
   order matches the lane order Game.start() assigns for that team, so the
   marksman lands bot, the mage mid, and so on. */
function drawLineup(roster, random, taken, team) {
  const byRole = role => roster.filter(h => h.role === role && !taken.has(h.id));
  const pick = roles => {
    const pool = roles.flatMap(byRole);
    if (!pool.length) throw new Error(`No hero left for roles ${roles.join('/')}`);
    const hero = pool[Math.floor(random() * pool.length)];
    taken.add(hero.id);
    return hero;
  };
  const marksman = pick(['Marksman']);
  const mage = pick(['Mage']);
  const tank = pick(['Tank']);
  const jungler = pick(['Assassin', 'Fighter']);
  const fifth = pick(['Support', 'Fighter']);
  // lanes: the tank roams when the fifth is a fighter (who then goes top);
  // a support roams and the tank takes top.
  const lanes = fifth.role === 'Support'
    ? { top: tank, jungle: jungler, mid: mage, bot: marksman, roam: fifth }
    : { top: fifth, jungle: jungler, mid: mage, bot: marksman, roam: tank };
  const order = team === 'blue'
    ? ['roam', 'top', 'jungle', 'mid', 'bot']
    : ['top', 'jungle', 'mid', 'bot', 'roam'];
  return order.map(lane => lanes[lane].id);
}

function buildJobs(options, roster) {
  const jobs = [];
  for (let i = 0; i < options.matches; i++) {
    const seed = options.seedStart + i;
    const job = { index: i, seed, mode: options.mode, bots: options.bots, durationCapMs: options.durationCapMs };
    if (options.lineups === 'random' && options.mode === 'standard') {
      const random = prng(seed * 7919 + 17);
      const taken = new Set();
      job.blueLineup = drawLineup(roster, random, taken, 'blue');
      job.redLineup = drawLineup(roster, random, taken, 'red');
    } else {
      job.blueLineup = options.blueLineup || null;
      job.redLineup = options.redLineup || null;
    }
    jobs.push(job);
  }
  return jobs;
}

/* ---------------- worker side ---------------- */

function runMatch(job) {
  const { createSimulator } = require('./runtime');
  const started = Date.now();
  const sim = createSimulator({
    seed: job.seed,
    mode: job.mode,
    intervalMs: 1000,
    blueBot: job.bots,
    redBot: job.bots,
    blueLineup: job.blueLineup,
    redLineup: job.redLineup,
    stats: true,
  });
  const result = job.durationCapMs
    ? sim.run({ durationMs: job.durationCapMs, onSnapshot() {} })
    : sim.run({ untilEnd: true, onSnapshot() {} });
  const stats = sim.stats();
  stats.match.reason = result.reason;
  stats.match.wallMs = Date.now() - started;
  stats.match.index = job.index;
  stats.match.lineups = {
    blue: sim.Game.heroes.filter(h => h.team === 0).map(h => h.def0.id),
    red: sim.Game.heroes.filter(h => h.team === 1).map(h => h.def0.id),
  };
  stats.match.warnings = sim.warnings;
  return stats;
}

if (!isMainThread && workerData && workerData.role === 'batch-worker') {
  parentPort.on('message', message => {
    if (message.type === 'run') {
      try {
        parentPort.postMessage({ type: 'done', index: message.job.index, stats: runMatch(message.job) });
      } catch (error) {
        parentPort.postMessage({ type: 'error', index: message.job.index, error: error.stack || String(error) });
      }
    } else if (message.type === 'exit') {
      process.exit(0);
    }
  });
}

/* ---------------- aggregation ---------------- */

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const r2 = value => Math.round(value * 100) / 100;

function goldAt(hero, timeMs) {
  const sample = hero.levelTimeline.find(s => s.timeMs === timeMs);
  return sample ? sample.goldEarned : null;
}

function aggregate(results, options) {
  const heroes = new Map();
  const roles = new Map();
  const bucket = key => {
    if (!heroes.has(key)) {
      heroes.set(key, { picks: 0, wins: 0, kills: [], deaths: [], assists: [], damageShare: [], goldAt10: [] });
    }
    return heroes.get(key);
  };
  const roleBucket = key => {
    if (!roles.has(key)) {
      roles.set(key, { picks: 0, wins: 0, kills: [], deaths: [], assists: [], damageShare: [], goldAt10: [] });
    }
    return roles.get(key);
  };

  for (const result of results) {
    const winner = result.match.winner;
    const teamDamage = { blue: 0, red: 0 };
    for (const hero of result.heroes) teamDamage[hero.team] += hero.damage.heroes;
    for (const hero of result.heroes) {
      const share = teamDamage[hero.team] > 0 ? hero.damage.heroes / teamDamage[hero.team] : 0;
      const gold10 = goldAt(hero, 600000);
      for (const rec of [bucket(hero.heroId), roleBucket(hero.role)]) {
        rec.picks++;
        if (winner === hero.team) rec.wins++;
        rec.kills.push(hero.kills); rec.deaths.push(hero.deaths); rec.assists.push(hero.assists);
        rec.damageShare.push(share);
        if (gold10 !== null) rec.goldAt10.push(gold10);
      }
    }
  }

  const finish = ([key, rec]) => ({
    id: key,
    picks: rec.picks,
    wins: rec.wins,
    winRate: rec.picks ? r2(rec.wins / rec.picks) : null,
    kills: r2(mean(rec.kills)),
    deaths: r2(mean(rec.deaths)),
    assists: r2(mean(rec.assists)),
    damageShare: r2(mean(rec.damageShare)),
    goldAt10: rec.goldAt10.length ? Math.round(mean(rec.goldAt10)) : null,
  });

  const roster = options.roster || [];
  const nameOf = id => (roster.find(h => h.id === id) || {}).name || id;
  const roleOf = id => (roster.find(h => h.id === id) || {}).role || '';
  const perHero = [...heroes.entries()].map(finish)
    .map(h => ({ ...h, name: nameOf(h.id), role: roleOf(h.id) }))
    .sort((a, b) => b.picks - a.picks || (b.winRate || 0) - (a.winRate || 0) || a.id.localeCompare(b.id));
  const perRole = [...roles.entries()].map(finish)
    .sort((a, b) => ROLE_ORDER.indexOf(a.id) - ROLE_ORDER.indexOf(b.id));

  const lengths = results.map(r => r.match.lengthMs / 60000);
  const histogram = {};
  for (const minutes of lengths) {
    const from = Math.floor(minutes / 5) * 5;
    const key = `${from}-${from + 5} min`;
    histogram[key] = (histogram[key] || 0) + 1;
  }
  const kpm = results.map(r => r.match.killsPerMinute);
  const wallMs = results.map(r => r.match.wallMs);
  return {
    matches: results.length,
    finished: results.filter(r => r.match.finished).length,
    blueWins: results.filter(r => r.match.winner === 'blue').length,
    redWins: results.filter(r => r.match.winner === 'red').length,
    matchLengthMinutes: {
      mean: r2(mean(lengths)), median: r2(median(lengths)),
      min: r2(Math.min(...lengths)), max: r2(Math.max(...lengths)),
      histogram,
    },
    killsPerMinute: { mean: r2(mean(kpm)), median: r2(median(kpm)), min: r2(Math.min(...kpm)), max: r2(Math.max(...kpm)) },
    firstBloodMs: { mean: Math.round(mean(results.map(r => r.match.firstBloodMs).filter(v => v !== null))) },
    wallMsPerMatch: { mean: Math.round(mean(wallMs)), max: Math.max(...wallMs) },
    perHero,
    perRole,
  };
}

function markdown(agg, options, elapsedMs) {
  const lines = [];
  lines.push(`# Batch: ${agg.matches} matches (${options.mode}, ${options.lineups} lineups, ${options.bots} bots, seeds ${options.seedStart}-${options.seedStart + agg.matches - 1})`, '');
  lines.push(`- Finished: ${agg.finished}/${agg.matches}, blue wins ${agg.blueWins}, red wins ${agg.redWins}`);
  lines.push(`- Match length (min): mean ${agg.matchLengthMinutes.mean}, median ${agg.matchLengthMinutes.median}, min ${agg.matchLengthMinutes.min}, max ${agg.matchLengthMinutes.max}`);
  lines.push(`- Kills per minute: mean ${agg.killsPerMinute.mean}, median ${agg.killsPerMinute.median}, min ${agg.killsPerMinute.min}, max ${agg.killsPerMinute.max}`);
  lines.push(`- First blood: mean ${Math.round(agg.firstBloodMs.mean / 1000)} s`);
  lines.push(`- Wall time: ${(elapsedMs / 1000).toFixed(1)} s total on ${options.workers} workers, ${(agg.wallMsPerMatch.mean / 1000).toFixed(1)} s mean per match`, '');
  lines.push('## Match length distribution', '', '| Bucket | Matches |', '|---|---|');
  for (const [key, count] of Object.entries(agg.matchLengthMinutes.histogram).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))) {
    lines.push(`| ${key} | ${count} |`);
  }
  lines.push('', '## Per role', '', '| Role | Picks | Win rate | K | D | A | Damage share | Gold at 10:00 |', '|---|---|---|---|---|---|---|---|');
  for (const role of agg.perRole) {
    lines.push(`| ${role.id} | ${role.picks} | ${pct(role.winRate)} | ${role.kills} | ${role.deaths} | ${role.assists} | ${pct(role.damageShare)} | ${role.goldAt10 ?? '-'} |`);
  }
  lines.push('', '## Per hero', '', '| Hero | Role | Picks | Win rate | K | D | A | Damage share | Gold at 10:00 |', '|---|---|---|---|---|---|---|---|---|');
  for (const hero of agg.perHero) {
    lines.push(`| ${hero.name} | ${hero.role} | ${hero.picks} | ${pct(hero.winRate)} | ${hero.kills} | ${hero.deaths} | ${hero.assists} | ${pct(hero.damageShare)} | ${hero.goldAt10 ?? '-'} |`);
  }
  return lines.join('\n') + '\n';
}
const pct = value => value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`;

/* ---------------- main ---------------- */

function runBatch(options) {
  const { createSimulator } = require('./runtime');
  const roster = createSimulator({ seed: 1, stats: false }).availableHeroes();
  const jobs = buildJobs(options, roster);
  const workers = Math.max(1, Math.min(options.workers, jobs.length));
  const started = Date.now();
  const results = new Array(jobs.length);
  const log = options.quiet ? () => {} : message => process.stderr.write(message + '\n');

  return new Promise((resolve, reject) => {
    let next = 0, done = 0, failed = null;
    const pool = [];
    const finish = () => {
      for (const worker of pool) worker.postMessage({ type: 'exit' });
      if (failed) { reject(failed); return; }
      const elapsedMs = Date.now() - started;
      const agg = aggregate(results, { ...options, roster });
      resolve({ aggregate: agg, results, elapsedMs, markdown: markdown(agg, options, elapsedMs) });
    };
    const feed = worker => {
      if (next >= jobs.length) return;
      const job = jobs[next++];
      worker.postMessage({ type: 'run', job });
    };
    for (let i = 0; i < workers; i++) {
      const worker = new Worker(__filename, { workerData: { role: 'batch-worker' } });
      pool.push(worker);
      worker.on('message', message => {
        if (message.type === 'done') {
          results[message.index] = message.stats;
          done++;
          const m = message.stats.match;
          log(`[${String(done).padStart(String(jobs.length).length)}/${jobs.length}] seed ${m.seed} ` +
            `${m.winner || '-'} wins in ${(m.lengthMs / 60000).toFixed(1)} min ` +
            `(${m.totalKills} kills, ${(m.wallMs / 1000).toFixed(1)} s wall)`);
        } else if (message.type === 'error') {
          failed = failed || new Error(`match ${message.index} failed: ${message.error}`);
          done++;
        }
        if (done >= jobs.length) finish(); else feed(worker);
      });
      worker.on('error', error => { failed = failed || error; if (++done >= jobs.length) finish(); });
      feed(worker);
    }
  });
}

function parseOptions(args) {
  const options = {
    matches: Number(args.matches ?? 20),
    seedStart: Number(args['seed-start'] ?? 1),
    durationCapMs: args['duration-cap-ms'] === undefined ? null : Number(args['duration-cap-ms']),
    mode: args.mode || 'standard',
    lineups: args.lineups || 'random',
    blueLineup: args['blue-lineup'] ? args['blue-lineup'].split(',') : null,
    redLineup: args['red-lineup'] ? args['red-lineup'].split(',') : null,
    bots: args.bots || 'heuristic',
    workers: Number(args.workers ?? os.cpus().length),
    out: args.out || path.join(os.tmpdir(), 'legends-arena-batch'),
    quiet: !!args.quiet,
  };
  if (!Number.isInteger(options.matches) || options.matches < 1) throw new Error('--matches must be a positive integer');
  if (!['random', 'fixed'].includes(options.lineups)) throw new Error('--lineups must be random or fixed');
  if (!['heuristic', 'neural'].includes(options.bots)) throw new Error('--bots must be heuristic or neural');
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const options = parseOptions(args);
  const { aggregate: agg, results, elapsedMs, markdown: md } = await runBatch(options);
  fs.mkdirSync(options.out, { recursive: true });
  const jsonPath = path.join(options.out, 'batch.json');
  const mdPath = path.join(options.out, 'batch.md');
  fs.writeFileSync(jsonPath, JSON.stringify({ options, elapsedMs, aggregate: agg, matches: results }, null, 2) + '\n');
  fs.writeFileSync(mdPath, md);
  process.stdout.write(md);
  if (!options.quiet) process.stderr.write(`Wrote ${jsonPath} and ${mdPath}\n`);
}

if (isMainThread && require.main === module) {
  main().catch(error => {
    process.stderr.write(`batch: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runBatch, parseOptions, buildJobs, drawLineup, aggregate, markdown, prng };
