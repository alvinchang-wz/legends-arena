'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Env, LAYOUT } = require('./env');

const LINEUP = 'grom,ignis,zephyr,nyx,karn';
const options = { blueLineup: LINEUP, redLineup: LINEUP };

test('flat observation layout is contiguous, unique and documented', () => {
  assert.equal(LAYOUT.fields.length, LAYOUT.length);
  const names = new Set();
  LAYOUT.fields.forEach((field, index) => {
    assert.equal(field.offset, index);
    assert.ok(field.doc && field.doc.length > 0, `${field.name} has no doc`);
    assert.ok(!names.has(field.name), `${field.name} duplicated`);
    names.add(field.name);
  });
});

test('reset controls one team and leaves the other on the heuristic bot', () => {
  const env = new Env({ controlled: 'blue', ...options });
  const obs = env.reset(3);
  assert.deepEqual(env.controlledIds, ['blue-0', 'blue-1', 'blue-2', 'blue-3', 'blue-4']);
  assert.equal(obs.timeMs, 0);
  for (const id of env.controlledIds) {
    const view = obs.heroes[id];
    assert.equal(view.flat.length, env.flatLength);
    assert.ok(view.flat instanceof Float32Array);
    assert.equal(view.self.id, id);
    assert.equal(view.allies.length, 4);
    assert.equal(view.structures.length, 26);
    assert.equal(view.objectives.length, 2);
    assert.equal(view.flat[LAYOUT.fields.find(f => f.name === 'self.alive').offset], 1);
    assert.equal(view.flat[LAYOUT.fields.find(f => f.name === 'team').offset], 0);
  }
  const before = env.snapshot().heroes.find(h => h.id === 'red-2').position;
  const idle = env.step({}, 3000);
  assert.equal(idle.done, false);
  const after = env.snapshot().heroes.find(h => h.id === 'red-2').position;
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 200, 'uncontrolled red hero should walk to lane');
  const blue = env.snapshot().heroes.find(h => h.id === 'blue-2');
  assert.ok(Math.hypot(blue.position.x - obs.heroes['blue-2'].self.position.x,
    blue.position.y - obs.heroes['blue-2'].self.position.y) < 50, 'controlled hero without actions stays put');
});

test('move actions move the hero and one-shot actions report their result', () => {
  const env = new Env({ controlled: ['blue-3'], ...options });
  const obs = env.reset(5);
  const start = obs.heroes['blue-3'].self.position;
  let result;
  for (let i = 0; i < 20; i++) result = env.step({ 'blue-3': { move: { dx: 1, dy: -1 } } }, 100);
  const end = result.obs.heroes['blue-3'].self.position;
  // walls near the fountain make the hero slide, so check the heading loosely
  assert.ok(end.y < start.y - 300 && end.x > start.x, `moved ${JSON.stringify(start)} -> ${JSON.stringify(end)}`);
  assert.equal(result.info.timeMs, 2000);

  result = env.step({ 'blue-3': { cast: { skill: 0 }, buy: 'no-such-item', attack: 'red-0' } }, 50);
  assert.equal(result.info.actions['blue-3'].cast, 'ok');
  assert.equal(result.info.actions['blue-3'].buy, 'unknown-item');
  assert.equal(result.info.actions['blue-3'].attack, 'ok');
  result = env.step({ 'blue-3': { cast: { skill: 0 }, cast2: null } }, 50);
  assert.equal(result.info.actions['blue-3'].cast, 'not-ready');
  result = env.step({ 'blue-3': { cast: { skill: 2 } } }, 50);
  assert.equal(result.info.actions['blue-3'].cast, 'not-ready', 'ultimate is not learned at level 1');
  result = env.step({ 'blue-3': { buy: 'hpPotion' } }, 50);
  assert.equal(result.info.actions['blue-3'].buy, 'not-at-shop');
  result = env.step({ 'blue-3': { recall: true } }, 50);
  assert.equal(result.info.actions['blue-3'].recall, 'ok');
  assert.equal(result.obs.heroes['blue-3'].self.recallMs > 0, true);
});

test('same seed and actions give identical observations and rewards', () => {
  const play = () => {
    const env = new Env({ controlled: 'red', ...options });
    env.reset(21);
    const log = [];
    for (let i = 0; i < 60; i++) {
      const actions = {};
      env.controlledIds.forEach((id, k) => { actions[id] = { move: { dx: Math.cos(i * 0.3 + k), dy: Math.sin(i * 0.3 + k) } }; });
      if (i % 10 === 0) actions['red-1'].cast = { skill: 0 };
      const { obs, reward, done } = env.step(actions, 100);
      log.push([Array.from(obs.heroes['red-1'].flat), reward, done]);
    }
    return JSON.stringify(log);
  };
  assert.equal(play(), play());
});

test('default reward tracks gold, kills, deaths and structure damage; custom reward is used', () => {
  const env = new Env({ controlled: ['blue-1'], ...options });
  env.reset(8);
  let total = 0;
  for (let i = 0; i < 10; i++) total += env.step({}, 1000).reward['blue-1'];
  const hero = env.sim.Game.heroes[1];
  assert.ok(Math.abs(total - hero.goldEarned / 100) < 1e-6, 'idle hero only earns passive gold');

  const custom = new Env({ controlled: ['blue-1'], reward: ({ cur, prev, hero }) => (cur.level - prev.level) + hero.self.level * 0, ...options });
  custom.reset(8);
  assert.equal(custom.step({}, 1000).reward['blue-1'], 0);
});

test('episode ends at the time cap', () => {
  const env = new Env({ controlled: 'blue', maxTimeMs: 3000, ...options });
  env.reset(2);
  let result;
  for (let i = 0; i < 100; i++) { result = env.step({}, 500); if (result.done) break; }
  assert.equal(result.done, true);
  assert.equal(result.info.reason, 'time-cap');
  assert.equal(result.info.timeMs, 3000);
  assert.ok(env.stats().heroes.length === 10);
});
