'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runBatch, parseOptions, buildJobs, drawLineup, prng } = require('./batch');
const { createSimulator } = require('./runtime');

const roster = createSimulator({ seed: 1, stats: false }).availableHeroes();

test('random lineups follow the role composition and are reproducible', () => {
  const jobs = buildJobs(parseOptions({ matches: '6', 'seed-start': '100' }), roster);
  assert.deepEqual(jobs.map(j => j.seed), [100, 101, 102, 103, 104, 105]);
  for (const job of jobs) {
    for (const [team, ids] of [['blue', job.blueLineup], ['red', job.redLineup]]) {
      assert.equal(ids.length, 5);
      const roles = ids.map(id => roster.find(h => h.id === id).role);
      assert.equal(roles.filter(r => r === 'Marksman').length, 1, `${team} ${roles}`);
      assert.equal(roles.filter(r => r === 'Mage').length, 1);
      assert.equal(roles.filter(r => r === 'Tank').length, 1);
      assert.ok(roles.filter(r => r === 'Assassin' || r === 'Fighter').length >= 1);
      assert.ok(roles.filter(r => r === 'Support' || r === 'Fighter').length >= 1);
    }
    assert.equal(new Set([...job.blueLineup, ...job.redLineup]).size, 10, 'no hero on both teams');
    // blue order is roam, top, jungle, mid, bot: marksman last, mage fourth
    assert.equal(roster.find(h => h.id === job.blueLineup[4]).role, 'Marksman');
    assert.equal(roster.find(h => h.id === job.blueLineup[3]).role, 'Mage');
  }
  const again = buildJobs(parseOptions({ matches: '6', 'seed-start': '100' }), roster);
  assert.deepEqual(again, jobs);
  const taken = new Set();
  assert.equal(drawLineup(roster, prng(1), taken, 'red').length, 5);
});

test('batch runs matches in workers and aggregates them', async () => {
  const options = parseOptions({ matches: '3', 'seed-start': '11', 'duration-cap-ms': '45000', workers: '3', quiet: true });
  const { aggregate, results, markdown } = await runBatch(options);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map(r => r.match.seed), [11, 12, 13]);
  assert.ok(results.every(r => r.match.lengthMs === 45000 && r.match.reason === 'duration-reached'));
  assert.equal(aggregate.matches, 3);
  assert.equal(aggregate.perHero.reduce((sum, h) => sum + h.picks, 0), 30);
  assert.equal(aggregate.perRole.reduce((sum, r) => sum + r.picks, 0), 30);
  assert.ok(aggregate.perRole.every(r => typeof r.winRate === 'number' || r.winRate === null));
  assert.match(markdown, /## Per hero/);
  assert.match(markdown, /\| Marksman \|/);
  // a worker's result is the same as an in-process run of the same seed
  const local = createSimulator({ seed: 12, intervalMs: 1000, blueLineup: results[1].match.lineups.blue, redLineup: results[1].match.lineups.red });
  local.run({ durationMs: 45000, onSnapshot() {} });
  const localStats = local.stats();
  assert.deepEqual(results[1].heroes, localStats.heroes);
});
