import { seeded } from './brain.js';
import { feelers } from './lab-antenna.js';
import { BodySpace, segmentBlocked } from './body-space.js';
import { ColonyMap, chunkAt } from './colony-map.js';
import { labBody, driveBody } from './lab-body.js';
import { crossover, JointPolicy, readGenome, zeroWeights } from './lab-policy.js';
import { groomingActions } from './grooming.js';

export const labCapacity = 120;
export const reproductionMinimum = .75;
const birthInterval = 28;
const sensesRange = 7;
const step = .05;
const groundDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const emptyGrime = Object.freeze(Object.fromEntries(groomingActions.map(({ key }) => [key, 0])));
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));

export class ScratchLab {
  constructor(mode, seed = 8241) {
    this.mode = mode;
    this.seed = seed;
    this.limits = mode === 'individual' ? 1 : labCapacity;
    this.settings = { resourceDensity: 0, resourceRenewal: 0, starterResources: false, learning: true,
      reproduction: false, whichNeeds: true };
    this.run = 0;
    this.restart();
  }

  restart() {
    this.run++;
    this.random = seeded(this.seed + this.run);
    this.workers = [];
    this.brood = [];
    this.time = 0;
    this.signals = { food: 0, water: 0 };
    this.stats = { updates: 0, born: 0, food: 0, water: 0, contacts: 0, shared: 0 };
    this.queen = { x: 0, z: 0, heading: 0, living: false, events: [] };
    this.map = new ColonyMap(this.seed, this.settings);
    const originalHeight = this.map.height;
    this.map.height = (x, z) => originalHeight(x, z) * .23;
    this.space = new BodySpace(this.map.height);
    this.scents = [];
    this.nextId = 1;
    if (this.mode === 'individual') {
      this.addResource('food', 4, -.7, 25);
      this.addResource('water', -1, 3.7, 25);
      this.spawn(0, 0);
    }
  }

  addResource(kind, x, z, amount) {
    if (!['food', 'water'].includes(kind) || ![x, z, amount].every(Number.isFinite) || amount <= 0) return;
    const chunk = this.map.chunk(chunkAt(x), chunkAt(z));
    const existing = chunk.resources.find(patch => patch.kind === kind && groundDistance(patch, { x, z }) < .65);
    if (existing) {
      existing.capacity += amount;
      existing.units += amount;
      existing.lastRefill = this.time;
    } else {
      chunk.resources.push({ kind, x, z, units: amount, capacity: amount, lastRefill: this.time });
    }
    this.map.resourceVersion++;
  }

  eraseResource(x, z) {
    const patch = this.map.nearby(x, z, 1.1).sort((a, b) => groundDistance(a, { x, z }) - groundDistance(b, { x, z }))[0];
    if (!patch) return false;
    const list = this.map.chunk(chunkAt(patch.x), chunkAt(patch.z)).resources;
    list.splice(list.indexOf(patch), 1);
    this.map.resourceVersion++;
    return true;
  }

  spawn(x, z, genome = null) {
    if (this.workers.length >= this.limits || ![x, z].every(Number.isFinite)) return null;
    const inherited = genome && readGenome(genome);
    const initialHeading = this.random() * 2 * Math.PI;
    const ant = { id: this.nextId, x, z, heading: initialHeading, lift: 0, turn: 0, speed: 0, age: 0,
      generation: inherited?.generation ?? 0, weights: inherited ? Float32Array.from(inherited.weights) : zeroWeights(),
      food: .84, water: .84, body: labBody(), reward: 0, birthReady: this.time + birthInterval,
      lastEmit: -2, lastTouch: null, lastTouching: false, lastMeal: -2, state: 'Resting', distance: 0, alive: true,
      probes: [{}, {}], grime: emptyGrime };
    const placement = this.space.place(ant, initialHeading);
    if (!placement) return null;
    Object.assign(ant, placement);
    ant.previous = { ...placement, lift: 0 };
    ant.body.height += this.map.height(ant.x, ant.z);
    ant.controller = new JointPolicy(ant.weights, this.random);
    driveBody(ant, ant.controller.commands, this.map.height, this.space, step);
    this.nextId++;
    this.workers.push(ant);
    this.space.record(ant);
    return ant;
  }

  sense(ant) {
    const { mouth, paths } = feelers(ant);
    const patches = this.map.nearby(ant.x, ant.z, sensesRange);
    const ants = this.space.near(ant, 5.6);
    const features = [1, 1 - ant.food, 1 - ant.water, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      clamp(ant.speed / 2), ant.body.legs.filter(leg => leg.ground).length / 6, 0];
    const edible = {};
    for (const patch of patches) {
      this.map.refill(patch, this.time);
      if (patch.units <= .001) continue;
      const index = patch.kind === 'food' ? 3 : 5;
      for (const [i, path] of paths.entries()) {
        features[index + i] = Math.max(features[index + i], Math.exp(-groundDistance(path.at(-1), patch) * .65));
      }
      if (groundDistance(mouth, patch) < (patch.kind === 'water' ? .92 : .65) &&
        mouth.y < this.map.height(patch.x, patch.z) + .58 &&
        (!edible[patch.kind] || groundDistance(mouth, patch) < groundDistance(mouth, edible[patch.kind]))) edible[patch.kind] = patch;
    }
    const touched = new Set();
    for (const [i, path] of paths.entries()) {
      const tip = path.at(-1);
      for (const { body: neighbor, lobes } of ants) {
        const distance = groundDistance(tip, neighbor);
        features[7 + i] = Math.max(features[7 + i], Math.exp(-distance * .68));
        if (distance < 2.65 && path.slice(1).some((point, index) => segmentBlocked(lobes, path[index], point, .058))) {
          features[9 + i] = 1;
          touched.add(neighbor);
        }
      }
      for (const mark of this.scents) {
        if (mark.by === ant.id) continue;
        features[13] = Math.max(features[13], clamp(1 - groundDistance(tip, mark) / 3.8));
      }
    }
    features[11] = Number(!!edible.food);
    features[12] = Number(!!edible.water);
    const other = [...touched].find(neighbor => neighbor.alive && groundDistance(mouth, neighbor) < 1.9);
    features[16] = other ? Math.max(1 - other.food, 1 - other.water) : 0;
    ant.probes.forEach((probe, index) => {
      probe.kind = features[9 + index] ? 'ant' : null;
    });
    return { features, edible, other };
  }

  experience(ant, dt) {
    const { features, edible, other } = this.sense(ant);
    const policy = ant.controller;
    const acts = policy.act(features, ant.body.legs.map(leg => leg.ground), dt, this.settings.learning);
    const beforeX = ant.x, beforeZ = ant.z;
    const { effort, planted } = driveBody(ant, policy.commands, this.map.height, this.space, dt);
    ant.body.jaw += (Number(acts[0].fires || acts[1].fires) * .72 - ant.body.jaw) * .3;
    const motion = Math.hypot(ant.x - beforeX, ant.z - beforeZ);
    const forward = (ant.x - beforeX) * Math.cos(ant.heading) - (ant.z - beforeZ) * Math.sin(ant.heading);
    ant.distance += motion;
    ant.food = clamp(ant.food - dt * (this.settings.whichNeeds ? .0017 : 0) - effort * .000009);
    ant.water = clamp(ant.water - dt * (this.settings.whichNeeds ? .0023 : 0) - effort * .000013);
    const benefits = [0, 0, 0];
    if (acts[0].fires) {
      for (const kind of ['food', 'water']) {
        const patch = edible[kind];
        if (!patch) continue;
        const gain = Math.min(dt * 1.95, 1 - ant[kind], patch.units * .15);
        ant[kind] += gain;
        patch.units -= gain / .15;
        // Reward replenishment in proportion to how depleted the ant was.
        benefits[0] += gain * (2.5 + features[kind === 'food' ? 1 : 2] * 2.5);
        this.stats[kind] += gain;
        if (gain > .001) {
          ant.lastMeal = this.time;
          ant.lastTouch = { kind };
        }
      }
    }
    const touching = Boolean(features[9] || features[10]);
    if (touching && !ant.lastTouching) {
      this.stats.contacts++;
      ant.lastTouch = { kind: other ? 'ant ' + other.id : 'ant' };
    }
    ant.lastTouching = touching;
    if (other && acts[1].fires) {
      for (const kind of ['food', 'water']) {
        if (ant[kind] < .36) continue;
        const donation = Math.min(.032, Math.max(0, (ant[kind] - other[kind] - .11) * .15));
        ant[kind] -= donation;
        other[kind] += donation;
        benefits[1] += donation * 3.8;
        this.stats.shared += donation;
      }
    }
    if (acts[2].fires && this.time - ant.lastEmit >= 1.1) {
      ant.lastEmit = this.time;
      this.scents.push({ by: ant.id, x: ant.x, z: ant.z, expiry: this.time + 7 });
      benefits[2] = other && benefits[1] ? .11 : 0;
    }

    policy.learnIO(features, acts, benefits);
    // Odor gradients are sensory reinforcement. There is no resource coordinate
    // or destination passed into the motor controller.
    const scent = Math.max(features[3], features[4]) * features[1] +
      Math.max(features[5], features[6]) * features[2];
    const gradient = clamp(scent - (ant.lastScent ?? scent), -.08, .08);
    ant.lastScent = scent;
    const reward = .79 * Math.max(0, forward) + .31 * motion - Math.abs(ant.turn) * dt * .027 -
      effort * .007 - (planted < 2 ? dt * .045 : 0) + benefits[0] * 1.5 + benefits[1] + gradient * .7;
    const oldUpdates = policy.updates;
    policy.observe(reward, dt);
    this.stats.updates += policy.updates - oldUpdates;
    ant.reward += reward;
    ant.age += dt;
    ant.alive = ant.food > 0 && ant.water > 0;
    ant.state = this.time - ant.lastMeal < .4 ? (ant.lastTouch?.kind === 'water' ? 'Drinking' : 'Eating')
      : ant.speed > 1.6 ? 'Running' : ant.speed > .21 ? 'Walking' : touching ? 'Antenna contact'
        : effort > .025 ? 'Testing joints' : 'Resting';
    this.space.record(ant);
  }

  breed() {
    if (!this.settings.reproduction || this.workers.length >= this.limits) return;
    const eligible = ant => ant.alive && ant.food >= reproductionMinimum && ant.water >= reproductionMinimum &&
      ant.birthReady <= this.time && ant.generation < 1_000_000;
    for (const ant of this.workers) {
      if (!eligible(ant)) continue;
      const mate = this.space.near(ant, 3).map(entry => entry.body).find(eligible);
      if (!mate) continue;
      const child = this.spawn((ant.x + mate.x) / 2, (ant.z + mate.z) / 2, crossover(ant, mate, this.random));
      if (!child) continue;
      ant.birthReady = mate.birthReady = this.time + birthInterval;
      this.stats.born++;
    }
  }

  step() {
    for (const ant of this.workers) {
      const { body, x, z, heading, lift } = ant;
      ant.previous = { x, z, heading, lift, height: body.height, pitch: body.pitch, roll: body.roll,
        jaw: body.jaw, joints: { ...body.joints }, feet: body.legs.map(leg => leg.points) };
    }
    for (let i = 0; i < 2; i++) {
      this.time += step;
      for (const ant of this.workers) if (ant.alive) this.experience(ant, step);
    }
    this.scents = this.scents.filter(mark => mark.expiry > this.time);
    if (this.workers.some(ant => !ant.alive)) {
      this.workers = this.workers.filter(ant => ant.alive);
      this.space.rebuild(this.queen, this.workers);
    }
    this.breed();
  }
}
