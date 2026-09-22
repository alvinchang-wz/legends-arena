'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimulator } = require('./runtime');

const LINEUP = 'grom,ignis,zephyr,nyx,karn';

test('stats report matches the game\'s own tallies and is deterministic', () => {
  const run = () => {
    const sim = createSimulator({ seed: 31, intervalMs: 1000, blueLineup: LINEUP, redLineup: LINEUP });
    sim.run({ durationMs: 240000, onSnapshot() {} });
    return sim;
  };
  const sim = run();
  const report = sim.stats();
  assert.equal(report.schema, 'legends-arena.headless-stats/v1');
  assert.equal(report.match.lengthMs, 240000);
  assert.equal(report.heroes.length, 10);
  assert.equal(report.match.totalKills, sim.Game.kills[0] + sim.Game.kills[1]);
  // Game.kills counts every hero death, including executions by turrets.
  assert.equal(report.match.killTimeline.length, report.match.totalKills);
  const heroKills = report.match.killTimeline.filter(k => k.killer);
  if (heroKills.length) assert.equal(report.match.firstBloodMs, heroKills[0].timeMs);
  for (const [index, hero] of sim.Game.heroes.entries()) {
    const rec = report.heroes[index];
    assert.equal(rec.id, hero.__headlessId);
    assert.equal(rec.kills, hero.kills);
    assert.equal(rec.deaths, hero.deaths);
    assert.equal(rec.assists, hero.assists);
    assert.equal(rec.damage.heroes, hero.stats.dmgHero);
    assert.equal(rec.damage.structures, hero.stats.dmgStruct);
    assert.equal(rec.damage.minions + rec.damage.monsters, hero.stats.dmgOther);
    assert.equal(rec.damageTaken, hero.stats.dmgTaken);
    assert.equal(rec.level, hero.level);
    assert.ok(rec.distanceTravelled > 1000, `${rec.id} should have walked somewhere`);
    assert.ok(rec.timeDeadMs >= 0 && rec.timeInBushMs >= 0);
    assert.deepEqual(rec.levelTimeline.map(s => s.timeMs), [0, 30000, 60000, 90000, 120000, 150000, 180000, 210000, 240000]);
    assert.equal(Object.keys(rec.skillCasts).length, 3);
  }
  assert.deepEqual(report.teams.blue.goldTimeline.map(s => s.timeMs), report.heroes[0].levelTimeline.map(s => s.timeMs));
  assert.equal(report.teams.blue.kills, sim.Game.kills[0]);
  assert.equal(JSON.stringify(report), JSON.stringify(run().stats()));
});

test('stats collection does not change the simulation', () => {
  const withStats = createSimulator({ seed: 5, intervalMs: 1000, stats: true }).run({ durationMs: 90000 }).snapshots.at(-1);
  const without = createSimulator({ seed: 5, intervalMs: 1000, stats: false }).run({ durationMs: 90000 }).snapshots.at(-1);
  assert.deepEqual(withStats, without);
});
