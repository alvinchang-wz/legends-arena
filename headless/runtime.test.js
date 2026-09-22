'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimulator, STATE_SCHEMA } = require('./runtime');

const FIXED_LINEUP = 'grom,ignis,zephyr,nyx,karn';

function deterministicSimulator(seed = 123) {
  return createSimulator({
    seed,
    intervalMs: 50,
    blueLineup: FIXED_LINEUP,
    redLineup: FIXED_LINEUP,
  });
}

test('emits initial state and exact 50 ms snapshots', () => {
  const simulator = deterministicSimulator();
  const result = simulator.run({ durationMs: 200 });
  assert.deepEqual(result.snapshots.map(snapshot => snapshot.timeMs), [0, 50, 100, 150, 200]);
  assert.ok(result.snapshots.every(snapshot => snapshot.schema === STATE_SCHEMA));
});

test('does not overshoot a duration that is not an interval multiple (time quantizes to whole steps)', () => {
  const simulator = deterministicSimulator();
  const result = simulator.run({ durationMs: 125 });
  // 125 ms is 7.5 fixed steps; the simulator never takes a partial step, so the last
  // snapshot is at 7 steps = 116.67 ms. (A partial step would make the match depend
  // on intervalMs.)
  assert.deepEqual(result.snapshots.map(snapshot => snapshot.timeMs), [0, 50, 100, 117]);
});

test('same seed reproduces the same state stream', () => {
  const first = deterministicSimulator(777).run({ durationMs: 500 }).snapshots;
  const second = deterministicSimulator(777).run({ durationMs: 500 }).snapshots;
  assert.deepEqual(first, second);
});

test('snapshot exposes heroes, objectives, structures, and entity counts', () => {
  const snapshot = deterministicSimulator().run({ durationMs: 50 }).snapshots.at(-1);
  assert.equal(snapshot.heroes.length, 10);
  // 18 lane turrets + 2 bases + 6 inhibitors.
  assert.equal(snapshot.structures.length, 26);
  assert.equal(snapshot.entityCounts.heroes, 10);
  assert.equal(snapshot.entityCounts.monsters, 14); // seven camps per team on the surveyed map
  assert.deepEqual(snapshot.objectives.map(objective => objective.id), ['lord', 'turtle']);
  for (const hero of snapshot.heroes) {
    assert.match(hero.id, /^(blue|red)-[0-4]$/);
    assert.ok(hero.hp.current >= 0 && hero.hp.current <= hero.hp.max);
    assert.ok(Number.isFinite(hero.position.x) && Number.isFinite(hero.position.y));
    assert.ok(Math.hypot(hero.velocity.x, hero.velocity.y) < 1000);
  }
});

test('duel mode converts both sides to autonomous bots', () => {
  const simulator = createSimulator({ mode: 'duel', intervalMs: 50, seed: 9 });
  const snapshot = simulator.run({ durationMs: 100 }).snapshots.at(-1);
  assert.equal(snapshot.heroes.length, 2);
  assert.ok(snapshot.heroes.every(hero => hero.ai.controller === 'heuristic'));
  assert.equal(snapshot.structures.length, 0);
  assert.equal(snapshot.objectives[0].id, 'shrine');
});

test('the output interval does not change the match (fixed timestep)', () => {
  const finalState = intervalMs => {
    const simulator = createSimulator({ seed: 4242, intervalMs });
    simulator.run({ durationMs: 60000, onSnapshot() {} });
    const { sequence, ...state } = simulator.snapshot(); // sequence counts snapshots, not time
    return JSON.stringify(state);
  };
  const at50 = finalState(50);
  assert.equal(finalState(1000), at50);
  assert.equal(finalState(60000), at50);
  assert.equal(finalState(333), at50);
});

test('same seed is bit-identical to 300 s of game time: final state and event log', () => {
  const runs = [1, 2].map(() => {
    const simulator = createSimulator({ seed: 4242, intervalMs: 1000 });
    const events = [];
    const result = simulator.run({ durationMs: 300000, onSnapshot: s => events.push(...s.events) });
    return { finalState: JSON.stringify(simulator.snapshot()), events: JSON.stringify(events), result };
  });
  assert.equal(runs[0].result.finalTimeMs, 300000);
  assert.equal(runs[0].events, runs[1].events);
  assert.equal(runs[0].finalState, runs[1].finalState);
});

test('the simulate.js CLI parses, runs and writes --stats', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const os = require('node:os');
  const statsPath = path.join(os.tmpdir(), `legends-arena-cli-test-${process.pid}.json`);
  const out = execFileSync(process.execPath, [path.join(__dirname, 'simulate.js'), '--duration-ms', '100', '--seed', '1', '--stats', statsPath], { encoding: 'utf8' });
  const lines = out.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.at(-1).type, 'complete');
  assert.equal(JSON.parse(require('node:fs').readFileSync(statsPath, 'utf8')).match.seed, 1);
  require('node:fs').unlinkSync(statsPath);
});
