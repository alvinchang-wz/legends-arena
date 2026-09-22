#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { createSimulator, STATE_SCHEMA } = require('./runtime');

const HELP = `Legends Arena headless simulator

Usage:
  node headless/simulate.js [options]

Options:
  --duration-ms N       Simulated duration (default: 1000)
  --until-end           Run until a base falls or the 30-minute cap
  --interval-ms N       State output interval (default: 50)
  --step-ms N           Internal fixed timestep (default: 16.6667)
  --seed N              Deterministic RNG seed (default: 1)
  --mode standard|duel  Match mode (default: standard)
  --blue-lineup IDS     Comma-separated hero ids (up to 5)
  --red-lineup IDS      Comma-separated hero ids (up to 5)
  --blue-bot TYPE       heuristic or neural (default: heuristic)
  --red-bot TYPE        heuristic or neural (default: heuristic)
  --detail summary|full Include grouped or per-minion state (default: summary)
  --format jsonl|pretty Output format (default: jsonl)
  --output PATH         Write output to a file instead of stdout
  --stats PATH          Write match statistics JSON (see headless/stats.js) at the end
  --list-heroes         Print valid hero ids and exit
  --help                Show this help

Examples:
  node headless/simulate.js --duration-ms 500 --format pretty
  node headless/simulate.js --duration-ms 10000 --seed 42 > match.jsonl
  node headless/simulate.js --until-end --interval-ms 1000 --output match.jsonl
`;

function parseArgs(argv) {
  const out = {};
  const booleanFlags = new Set(['help', 'until-end', 'list-heroes']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const equals = arg.indexOf('=');
    const rawKey = arg.slice(2, equals < 0 ? undefined : equals);
    if (booleanFlags.has(rawKey)) {
      out[rawKey] = true;
      continue;
    }
    const value = equals >= 0 ? arg.slice(equals + 1) : argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`);
    out[rawKey] = value;
  }
  return out;
}

function prettyResource(resource) {
  return `${Math.round(resource.current)}/${Math.round(resource.max)}`;
}

function prettySnapshot(snapshot) {
  const blue = snapshot.teams.blue;
  const red = snapshot.teams.red;
  const lines = [
    `[${String(snapshot.timeMs).padStart(7, '0')} ms] ${snapshot.gameState.toUpperCase()} ` +
      `| kills blue ${blue.kills}-${red.kills} red ` +
      `| gold ${Math.round(blue.goldEarned)}-${Math.round(red.goldEarned)} ` +
      `| minions ${snapshot.entityCounts.minions} monsters ${snapshot.entityCounts.monsters} ` +
      `projectiles ${snapshot.entityCounts.projectiles} zones ${snapshot.entityCounts.zones}`,
  ];
  for (const hero of snapshot.heroes) {
    const cc = hero.crowdControl.length ? ` cc=${hero.crowdControl.map(c => c.type).join(',')}` : '';
    lines.push(
      `  ${hero.id.padEnd(7)} ${hero.name.padEnd(7)} ${hero.alive ? 'alive' : 'dead '} ` +
      `hp=${prettyResource(hero.hp)} mp=${prettyResource(hero.mana)} ` +
      `pos=(${hero.position.x},${hero.position.y}) lv=${hero.level} ` +
      `gold=${Math.round(hero.gold.held)} ai=${hero.ai.state} target=${hero.ai.target || '-'}${cc}`,
    );
  }
  for (const event of snapshot.events) {
    lines.push(`  EVENT ${event.type}: ${event.message || event.kind || event.winner || ''}`);
  }
  return lines.join('\n') + '\n';
}

function jsonLine(value) {
  return JSON.stringify(value) + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const options = {
    seed: args.seed === undefined ? undefined : Number(args.seed),
    intervalMs: args['interval-ms'] === undefined ? undefined : Number(args['interval-ms']),
    stepMs: args['step-ms'] === undefined ? undefined : Number(args['step-ms']),
    mode: args.mode,
    detail: args.detail,
    blueBot: args['blue-bot'],
    redBot: args['red-bot'],
    blueLineup: args['blue-lineup'],
    redLineup: args['red-lineup'],
    stats: !!args.stats,
  };
  Object.keys(options).forEach(key => options[key] === undefined && delete options[key]);
  const simulator = createSimulator(options);

  if (args['list-heroes']) {
    for (const hero of simulator.availableHeroes()) {
      process.stdout.write(`${hero.id.padEnd(8)} ${hero.name.padEnd(8)} ${hero.role}\n`);
    }
    return;
  }

  const format = args.format || 'jsonl';
  if (!['jsonl', 'pretty'].includes(format)) throw new Error('format must be "jsonl" or "pretty"');
  const stream = args.output ? fs.createWriteStream(args.output, { encoding: 'utf8' }) : process.stdout;
  const writeSnapshot = snapshot => stream.write(format === 'pretty' ? prettySnapshot(snapshot) : jsonLine(snapshot));
  const result = simulator.run({
    durationMs: args['duration-ms'] === undefined ? 1000 : Number(args['duration-ms']),
    untilEnd: !!args['until-end'],
    onSnapshot: writeSnapshot,
  });
  const complete = {
    schema: STATE_SCHEMA,
    type: 'complete',
    reason: result.reason,
    timeMs: result.finalTimeMs,
    winner: result.winner,
    warnings: simulator.warnings,
  };
  if (format === 'pretty') {
    stream.write(`COMPLETE reason=${complete.reason} time=${complete.timeMs}ms winner=${complete.winner || '-'}\n`);
    for (const warning of complete.warnings) stream.write(`WARNING ${warning}\n`);
  } else {
    stream.write(jsonLine(complete));
  }
  if (args.output) stream.end();
  if (args.stats) fs.writeFileSync(args.stats, JSON.stringify(simulator.stats(), null, 2) + '
');
}

process.stdout.on('error', error => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

try {
  main();
} catch (error) {
  process.stderr.write(`headless simulator: ${error.message}\n`);
  process.exitCode = 1;
}

