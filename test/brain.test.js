import test from 'node:test';
import assert from 'node:assert/strict';
import { AL, neuronCount, regions, WorkerBrain } from '../src/brain.js';
import { ForagingWorker } from '../src/foraging.js';
import { AntMotion } from '../src/motion.js';

test('the full neural population has distinct, valid presynaptic partners', () => {
  const brain = new WorkerBrain();
  assert.equal(regions.reduce((total, region) => total + region.count, 0), neuronCount);
  assert.equal(brain.voltage.length, 250_000);
  assert.equal(brain.sources.length, 750_000);
  for (let i = 0, edge = 0; i < neuronCount; i++, edge += 3) {
    const a = brain.sources[edge], b = brain.sources[edge + 1], c = brain.sources[edge + 2];
    assert.ok(a !== i && b !== i && c !== i && a !== b && a !== c && b !== c);
    assert.ok(a >= 0 && a < neuronCount && b >= 0 && b < neuronCount && c >= 0 && c < neuronCount);
  }
});

test('antennae activate ipsilateral neurons and the descending pathways steer both ways', () => {
  const brain = new WorkerBrain();
  const input = { odor: [.95, .03], vision: .18, contact: [0, 0], touch: 0, turn: 1, pace: .8 };
  for (let tick = 0; tick < 24; tick++) brain.step(input);
  assert.ok(brain.turn > .6);
  const { start, count } = regions[AL];
  const half = count / 2;
  const sum = values => values.reduce((a, b) => a + b, 0);
  assert.ok(sum(brain.spikes.subarray(start, start + half)) > 10 * sum(brain.spikes.subarray(start + half, start + count)));
  assert.equal(brain.active, sum(brain.totals));
  const previous = brain.spikes.slice();
  brain.step(input);
  assert.deepEqual(brain.previousSpikes, previous);

  for (let tick = 0; tick < 24; tick++) brain.step({ ...input, turn: -1 });
  assert.ok(brain.turn < -.6);
  brain.reset();
  assert.equal(brain.tick, 0);
  assert.equal(sum(brain.spikes), 0);
});

test('autonomous walking samples, carries and returns food while strengthening the trail', () => {
  const motion = new AntMotion();
  const worker = new ForagingWorker();
  const states = new Set();
  for (let i = 0; i < 120 * 12 && !worker.delivered; i++) {
    motion.step(1 / 120, worker.step(1 / 120, motion));
    states.add(worker.state);
  }
  assert.ok(states.has('Following scent') && states.has('Sampling food') && states.has('Returning to nest'));
  assert.equal(worker.delivered, 1);
  assert.equal(worker.food.units, 5);
  assert.equal(worker.carrying, false);
  assert.ok(worker.trail.some(node => node.strength > .84));
  assert.ok(Math.hypot(motion.x, motion.z) < .43);
});
