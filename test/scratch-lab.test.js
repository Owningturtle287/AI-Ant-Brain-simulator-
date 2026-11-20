import test from 'node:test';
import assert from 'node:assert/strict';
import { ScratchLab } from '../src/scratch-lab.js';
import { crossover, readGenome, snapshot, weightCount } from '../src/lab-policy.js';
import { feelers } from '../src/lab-antenna.js';

test('From Scratch starts empty and a new ant stays almost still with zero weights and exploration off', () => {
  const lab = new ScratchLab('scratch');
  assert.equal(lab.workers.length, 0);
  assert.deepEqual(lab.map.nearby(0, 0, 15), []);
  lab.settings.learning = false;
  const ant = lab.spawn(0, 0);
  assert.ok(ant.weights.every(value => value === 0));
  for (let i = 0; i < 120; i++) lab.step();
  assert.ok(ant.distance < .1);
  assert.equal(ant.controller.updates, 0);
  assert.ok(ant.body.legs.every(leg => leg.points.length === 10));
  const single = new ScratchLab('individual');
  assert.equal(single.workers.length, 1);
  assert.equal(single.spawn(8, 8), null);
  assert.equal(single.map.nearby(0, 0, 10).length, 2);
});

test('an untrained worker discovers food and water by contact and learns reusable joint motion', () => {
  const lab = new ScratchLab('scratch', 331);
  lab.settings.whichNeeds = false;
  const ant = lab.spawn(0, 0);
  const mouth = feelers(ant).mouth;
  lab.addResource('food', mouth.x, mouth.z, 25);
  lab.addResource('water', mouth.x - .14, mouth.z + .3, 25);
  for (let i = 0; i < 1500; i++) lab.step();
  assert.ok(lab.stats.food > .10 && lab.stats.water > .10);
  assert.ok(ant.controller.updates >= 3);
  const learned = readGenome(JSON.parse(JSON.stringify(snapshot(ant))));

  const playback = new ScratchLab('scratch', 331);
  playback.settings.learning = false;
  const offspring = playback.spawn(0, 0, learned);
  const control = playback.spawn(0, 12);
  assert.deepEqual(Array.from(offspring.weights), learned.weights);
  for (let i = 0; i < 240; i++) playback.step();
  assert.ok(offspring.distance > 10 && control.distance < .1);
  assert.ok(offspring.body.legs.every(leg => leg.points.every(({ x, y, z }) => [x, y, z].every(Number.isFinite))));
});

test('reproduction requires both reserves on both ants and copies exactly half of each genome', () => {
  const lab = new ScratchLab('scratch');
  const a = lab.spawn(0, 0);
  const b = lab.spawn(0, 2.2);
  a.weights.fill(.25);
  b.weights.fill(-.5);
  lab.time = 30;
  a.food = a.water = b.food = b.water = .75;
  lab.breed();
  assert.equal(lab.workers.length, 2);
  lab.settings.reproduction = true;
  for (const parent of [a, b]) for (const need of ['food', 'water']) {
    parent[need] = .7499;
    lab.breed();
    assert.equal(lab.workers.length, 2);
    parent[need] = .75;
  }
  lab.breed();
  const child = lab.workers[2];
  assert.ok(child);
  assert.equal(child.generation, 1);
  assert.equal(child.weights.filter(value => value === .25).length, weightCount / 2);
  assert.equal(child.weights.filter(value => value === -.5).length, weightCount / 2);
  lab.breed();
  assert.equal(lab.workers.length, 3);
  const clone = crossover(a, b, () => .5);
  assert.throws(() => readGenome({ ...clone, weights: [...clone.weights.slice(1), 'invalid'] }), /compatible/);
});

test('resource placement, refill and removal are independent of the camera', () => {
  const lab = new ScratchLab('scratch');
  lab.addResource('water', -15, 15, 12);
  lab.addResource('water', -15.2, 15, 5);
  const [water] = lab.map.nearby(-15, 15, 2);
  assert.equal(water.units, 17);
  water.units = 9;
  lab.settings.resourceRenewal = .5;
  lab.map.refill(water, 8);
  assert.equal(water.units, 13);
  assert.equal(lab.eraseResource(-15, 15), true);
  assert.deepEqual(lab.map.nearby(-15, 15, 2), []);
});

test('antenna contact lets a worker learn from sharing reserves with a neighbor', () => {
  const lab = new ScratchLab('scratch', 8242);
  const donor = lab.spawn(0, 0);
  const recipient = lab.spawn(0, 8);
  donor.heading = 0;
  Object.assign(recipient, { x: 1.8, z: 0, heading: 1.57, food: .30, water: .30 });
  lab.space.rebuild(lab.queen, lab.workers);
  assert.equal(lab.sense(donor).other, recipient);
  for (let i = 0; i < 8; i++) lab.step();
  assert.ok(lab.stats.contacts > 0);
  assert.ok(lab.stats.shared > 0 && recipient.food > .30 && recipient.water > .30);
  assert.ok(donor.weights.some(weight => weight > 0));
});
