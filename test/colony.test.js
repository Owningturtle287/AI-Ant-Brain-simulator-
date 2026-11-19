import test from 'node:test';
import assert from 'node:assert/strict';
import { ColonyMap } from '../src/colony-map.js';
import { Colony, defaultSettings } from '../src/colony.js';

const advance = (colony, seconds) => {
  for (let tick = 0; tick < seconds * 10; tick++) colony.step();
};

test('world tiles reproduce terrain and patches far beyond the nest', () => {
  const map = new ColonyMap(157, defaultSettings);
  const copy = new ColonyMap(157, defaultSettings);
  assert.deepEqual(map.chunk(-30, 27), copy.chunk(-30, 27));
  assert.notDeepEqual(map.chunk(-30, 27).resources, map.chunk(30, 27).resources);
  assert.ok(Number.isFinite(map.height(720.001, 648.91)));
  assert.deepEqual(new Set(map.chunk(0, 0).resources.map(patch => patch.kind)), new Set(['food', 'water']));
});

test('queen starts with one worker and lays a mutated copy after ten seconds', () => {
  const colony = new Colony({ learning: false });
  const parent = colony.workers[0];
  assert.equal(colony.settings.ageLimit, 0);
  assert.equal(colony.settings.stageSeconds, 60);
  assert.equal(colony.workers.length, 1);
  advance(colony, 9.9);
  assert.equal(colony.brood.length, 0);
  advance(colony, .1);
  const [egg] = colony.brood;
  assert.equal(egg.stage, 0);
  assert.equal(egg.parentId, parent.id);
  assert.equal(egg.generation, 1);
  assert.notDeepEqual(egg.weights, parent.weights);
  assert.ok(egg.weights.every((weight, index) => Math.abs(weight - parent.weights[index]) <= colony.settings.mutation + .0001));
  assert.equal(colony.queen.x, 0);
  assert.equal(colony.queen.z, 0);
});

test('uncared-for larva starves and well-tended brood matures through all stages', () => {
  const colony = new Colony({ stageSeconds: 60, mutation: 0 });
  colony.layEgg();
  const brood = colony.brood[0];
  colony.updateBrood(60);
  assert.equal(brood.stage, 1);
  colony.updateBrood(60);
  assert.equal(colony.brood.length, 0);
  assert.equal(colony.stats.deaths, 1);
  colony.settings.stageSeconds = 4;
  colony.layEgg();
  const healthy = colony.brood[0];
  colony.updateBrood(4);
  assert.equal(healthy.stage, 1);
  colony.updateBrood(4);
  assert.equal(healthy.stage, 2);
  colony.updateBrood(4);
  assert.equal(colony.workers.length, 2);
  assert.deepEqual(colony.workers[1].weights, healthy.weights);
  assert.notEqual(colony.workers[1].weights, healthy.weights);
});

test('workers change their policy, nurse the brood, and grow a colony with the default schedule', () => {
  const colony = new Colony({ restart: false });
  const founder = colony.workers[0];
  const startingPolicy = founder.weights.slice();
  const activities = new Set();
  let carried = false;
  for (let i = 0; i < 3500 && !colony.failed; i++) {
    colony.step();
    activities.add(founder.state);
    carried ||= colony.brood.some(brood => brood.carriedBy);
  }
  assert.equal(colony.failed, null);
  assert.equal(colony.stats.eggs, 35);
  assert.ok(colony.stats.hatched >= 8);
  assert.ok(colony.stats.care && colony.stats.delivered && colony.stats.updates);
  assert.ok(activities.has('Grooming') && activities.has('Resting and scanning'));
  assert.ok(carried);
  assert.notDeepEqual(founder.weights, startingPolicy);
  assert.ok(colony.best?.weights.length > 0);
});

test('queen loss triggers a fresh seeded run using the saved champion', () => {
  const colony = new Colony();
  advance(colony, 150);
  assert.ok(colony.best);
  colony.queen.water = .00001;
  colony.step();
  assert.equal(colony.failed, 'Queen dehydrated');
  const best = colony.best.weights;
  const seed = colony.seed;
  advance(colony, 4.2);
  assert.notEqual(colony.seed, seed);
  assert.equal(colony.run, 2);
  assert.equal(colony.failed, null);
  assert.equal(colony.workers.length, 1);
  assert.deepEqual(Array.from(colony.workers[0].weights), best);
});
