import { seeded } from './brain.js';
import { ColonyMap } from './colony-map.js';
import { inheritPolicy, policyWeightCount, selectAction, taskNames, updatePolicy } from './colony-policy.js';

export const defaultSettings = Object.freeze({
  eggSeconds: 10, stageSeconds: 60, ageLimit: 0, needRate: 1, resourceDensity: 1,
  resourceRenewal: .085, mutation: .10, learning: true, restart: true, populationLimit: 40,
});
export const broodStages = ['Egg', 'Larva', 'Pupa'];
export const colonyStep = .1;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angularError = (goal, heading) => Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));
const actionResource = {
  eat: 'food', drink: 'water', queenFood: 'food', queenWater: 'water',
  broodFood: 'food', peerFood: 'food', peerWater: 'water',
};
const nest = { x: 0, z: 0 };
const queenDose = .58;
const learningRate = .032;

function stackPosition(slot, x, z, ringSize) {
  const angle = slot * 2.399963;
  const radius = ringSize + Math.sqrt(slot % 32) * .19;
  return { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius, layer: Math.floor(slot / 32) };
}

export class Colony {
  constructor(settings = {}, seed = 8241, history = null) {
    this.settings = { ...defaultSettings, ...settings };
    this.seed = seed;
    this.run = 0;
    this.best = Array.isArray(history?.weights) && history.weights.length === policyWeightCount &&
      history.weights.every(Number.isFinite) && Number.isFinite(history.score)
      ? { score: history.score, weights: history.weights.slice() } : null;
    this.restart();
  }

  restart(newWorld = false) {
    if (newWorld) this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    this.run++;
    this.time = 0;
    this.random = seeded((this.seed ^ Math.imul(this.run, 8419)) || 1);
    this.map = new ColonyMap(this.seed, this.settings);
    this.queen = { ...nest, food: .94, water: .94, living: true };
    this.eggClock = 0;
    this.nextId = 1;
    this.brood = [];
    this.workers = [];
    this.messages = [];
    this.signals = { food: .06, water: .06, brood: 0 };
    this.stats = { eggs: 0, hatched: 0, deaths: 0, care: 0, delivered: 0, shared: 0, updates: 0 };
    this.failed = null;
    this.failureTime = 0;
    this.championCheck = 0;
    this.previousWorker = this.spawnWorker(this.best?.weights, 0, 1.55, .13);
  }

  spawnWorker(weights, generation, x, z) {
    const worker = {
      id: this.nextId++, x, z, heading: Math.atan2(-z, x), speed: 0, age: 0,
      food: .88, water: .9, fatigue: .05, dirt: .08, generation, weights: inheritPolicy(weights, 0, this.random),
      hold: null, cargo: null, task: null, state: 'Assessing nest', known: new Set(),
      recall: { food: 0, water: 0, brood: 0 }, requests: { food: 0, water: 0, until: 0 },
      scanAt: 0, reward: 0, looking: 0, turn: 0,
    };
    worker.previous = { x, z, heading: worker.heading };
    this.workers.push(worker);
    return worker;
  }

  layEgg() {
    const parent = this.previousWorker;
    const occupied = new Set(this.brood.filter(item => !item.moved).map(item => item.slot));
    let slot = 0;
    while (occupied.has(slot)) slot++;
    const id = this.nextId++;
    this.brood.push({
      id, slot, ...stackPosition(slot, 0, 0, 1.38), stage: 0, age: 0, care: .94, food: .80, moved: false,
      parentId: parent.id, generation: parent.generation + 1,
      weights: inheritPolicy(parent.weights, this.settings.mutation, this.random),
    });
    this.stats.eggs++;
  }

  updateBrood(dt) {
    const careDrain = [.0056, .011, .0075];
    const survivors = [];
    for (const larva of this.brood) {
      const carrier = larva.carriedBy;
      if (carrier) {
        larva.x = carrier.x + Math.cos(carrier.heading) * 1.26;
        larva.z = carrier.z - Math.sin(carrier.heading) * 1.26;
      }
      larva.age += dt;
      larva.care -= dt * careDrain[larva.stage] * this.settings.needRate * (larva.moved ? .79 : 1);
      if (larva.stage === 1) larva.food -= dt * .024 * this.settings.needRate;
      if (larva.care <= 0 || larva.food <= 0) {
        this.stats.deaths++;
        continue;
      }
      if (larva.age + 1e-7 >= this.settings.stageSeconds) {
        if (larva.stage < 2) {
          larva.stage++;
          larva.age = 0;
        } else if (!carrier && this.workers.length < this.settings.populationLimit) {
          const exitDistance = Math.hypot(larva.x, larva.z);
          const x = exitDistance < 2.2 ? 2.2 * Math.cos(larva.id) : larva.x;
          const z = exitDistance < 2.2 ? 2.2 * Math.sin(larva.id) : larva.z;
          this.previousWorker = this.spawnWorker(larva.weights, larva.generation, x, z);
          this.stats.hatched++;
          continue;
        }
      }
      survivors.push(larva);
    }
    this.brood = survivors;
  }

  step(dt = colonyStep) {
    if (this.failed) {
      this.failureTime += dt;
      if (this.settings.restart && this.failureTime >= 4) this.restart(true);
      return;
    }
    this.time += dt;
    const need = this.settings.needRate;
    this.queen.food = clamp(this.queen.food - dt * .0046 * need);
    this.queen.water = clamp(this.queen.water - dt * .0056 * need);
    if (!this.queen.food || !this.queen.water) {
      this.queen.living = false;
      this.fail(!this.queen.food ? 'Queen starved' : 'Queen dehydrated');
      return;
    }
    this.eggClock += dt;
    while (this.eggClock + 1e-7 >= this.settings.eggSeconds) {
      this.eggClock -= this.settings.eggSeconds;
      this.layEgg();
    }
    this.updateBrood(dt);
    this.signals.food = 1 - this.queen.food;
    this.signals.water = 1 - this.queen.water;
    this.signals.brood = this.brood.reduce((urgent, brood) => Math.max(urgent,
      1 - (brood.stage === 1 ? Math.min(brood.food, brood.care) : brood.care)), 0);
    for (const worker of this.workers) {
      worker.previous.x = worker.x;
      worker.previous.z = worker.z;
      worker.previous.heading = worker.heading;
      worker.age += dt;
      worker.food = clamp(worker.food - dt * (.0033 + worker.speed * .0009) * need);
      worker.water = clamp(worker.water - dt * (.0046 + worker.speed * .0011) * need);
      worker.fatigue = clamp(worker.fatigue + dt * (worker.speed > .2 ? .018 : -.012));
      worker.dirt = clamp(worker.dirt + dt * (worker.speed > .2 ? .016 : .004));
      if (worker.food && worker.water && (!this.settings.ageLimit || worker.age < this.settings.ageLimit)) {
        this.runWorker(worker, dt);
      }
    }
    const live = this.workers.filter(worker =>
      worker.food && worker.water && (!this.settings.ageLimit || worker.age < this.settings.ageLimit));
    for (const worker of this.workers) {
      if (worker.task?.pickedUp && !live.includes(worker)) worker.task.pickedUp.carriedBy = null;
    }
    this.stats.deaths += this.workers.length - live.length;
    this.workers = live;
    if (!live.length) {
      this.fail('Last worker lost');
      return;
    }
    if (this.time >= this.championCheck) {
      this.championCheck = this.time + 5;
      this.saveChampion();
    }
  }

  fail(reason) {
    this.saveChampion();
    this.failed = reason;
    this.failureTime = 0;
  }

  saveChampion() {
    if (!this.settings.learning || this.time < 30 || !this.stats.delivered) return;
    const score = this.time * .04 + this.stats.hatched * 5 + this.stats.delivered * .28
      - this.stats.deaths * .52 + Math.min(this.queen.food, this.queen.water) * 2;
    if (this.best && this.best.score >= score) return;
    const parent = this.workers.reduce((best, worker) => worker.reward > best.reward ? worker : best, this.previousWorker);
    this.best = { score, weights: Array.from(parent.weights) };
  }

  sense(worker) {
    for (const resource of this.map.nearby(worker.x, worker.z, 8.5)) {
      if (worker.known.has(resource)) continue;
      worker.known.add(resource);
      this.messages.push({ resource, x: worker.x, z: worker.z, by: worker.id, until: this.time + 28 });
    }
    this.messages = this.messages.filter(message => message.until >= this.time);
    const nearNest = gap(worker, nest) < 10;
    for (const message of this.messages) {
      if (nearNest || gap(worker, message) < 7.5) worker.known.add(message.resource);
    }
    if (worker.known.size > 36) {
      const closest = [...worker.known].sort((a, b) => gap(worker, a) - gap(worker, b)).slice(0, 36);
      worker.known = new Set(closest);
    }
    if (nearNest) Object.assign(worker.recall, this.signals);
    worker.requests.food = worker.food < .36 ? 1 - worker.food : 0;
    worker.requests.water = worker.water < .36 ? 1 - worker.water : 0;
    worker.requests.until = this.time + 1.8;
  }

  candidates(worker) {
    const resources = {};
    for (const patch of worker.known) {
      this.map.refill(patch, this.time);
      if (patch.units < 1) continue;
      const current = resources[patch.kind];
      if (!current || gap(worker, current) > gap(worker, patch)) resources[patch.kind] = patch;
    }
    const result = [];
    const add = (action, shortage, target, scope = 0, carried = 0) => {
      if (!target) return;
      const distance = gap(worker, target);
      const deficit = clamp(shortage);
      result.push({ action, target, features: [1, deficit, deficit * deficit, 1 / (1 + distance * .19), carried, clamp(scope)] });
    };
    if (!worker.cargo) {
      add('eat', 1 - worker.food, resources.food);
      add('drink', 1 - worker.water, resources.water);
    }
    for (const [action, kind] of [['queenFood', 'food'], ['queenWater', 'water']]) {
      if (worker.cargo && worker.cargo !== kind) continue;
      const demand = worker.recall[kind];
      if (demand > .12 || worker.cargo) add(action, demand, worker.cargo ? nest : resources[kind], 0, Number(!!worker.cargo));
    }
    for (const [action, kind] of [['peerFood', 'food'], ['peerWater', 'water']]) {
      if (worker[kind] < .32 || (worker.cargo && worker.cargo !== kind)) continue;
      let recipient;
      for (const peer of this.workers) {
        if (peer !== worker && peer.requests.until >= this.time && gap(worker, peer) < 7.5 &&
            peer.requests[kind] > (recipient?.requests[kind] ?? 0)) recipient = peer;
      }
      if (recipient) {
        add(action, recipient.requests[kind], worker.cargo ? recipient : resources[kind], .4, Number(!!worker.cargo));
        if (worker.cargo || resources[kind]) result.at(-1).recipient = recipient;
      }
    }
    if (gap(worker, nest) < 22) {
      const hungry = this.brood.filter(b => b.stage === 1 && b.food < .83).sort((a, b) => a.food - b.food);
      if (hungry.length && worker.cargo !== 'water') {
        add('broodFood', 1 - hungry[0].food, worker.cargo ? hungry[0] : resources.food, hungry.length / 6, Number(!!worker.cargo));
      }
      const untidy = this.brood.filter(b => !b.carriedBy).sort((a, b) => (a.care + .14 * a.moved) - (b.care + .14 * b.moved));
      if (!worker.cargo && untidy.length) {
        const target = untidy[0];
        add('tend', 1 - target.care + (target.moved ? 0 : .19), target, untidy.length / 8);
      }
    }
    if (!worker.cargo) {
      add('rest', worker.fatigue, worker);
      add('groom', worker.dirt, worker);
    }
    const surroundings = Number(Boolean(resources.food)) + Number(Boolean(resources.water));
    add('explore', .23 + .25 * (2 - surroundings), worker, worker.recall.brood);
    return result;
  }

  runWorker(worker, dt) {
    if (this.time >= worker.scanAt) {
      worker.scanAt = this.time + .72;
      this.sense(worker);
    }
    if (!worker.task) {
      const choice = selectAction(worker.weights, this.candidates(worker), this.random, this.settings.learning ? .15 : .04);
      const { action } = choice;
      let target = choice.target;
      if (action === 'explore') {
        const towardsNest = gap(worker, nest) > 37 && (this.random() < .70 || worker.cargo);
        const direction = towardsNest ? Math.atan2(worker.z, -worker.x) : worker.heading + (this.random() - .5) * 2.85;
        const distance = 4.4 + this.random() * 7;
        target = { x: worker.x + Math.cos(direction) * distance, z: worker.z - Math.sin(direction) * distance };
      }
      worker.task = { ...choice, target, phase: worker.cargo ? 'return' : 'approach', starts: this.time,
        ready: 0, known: worker.known.size };
      worker.looking = (this.random() - .5) * .45;
    }

    const task = worker.task;
    const { action, target } = task;
    if (task.recipient && !this.workers.includes(task.recipient)) {
      this.finish(worker, -.12);
      return;
    }
    if (this.time - task.starts > 35) {
      this.finish(worker, -.24);
      return;
    }
    worker.state = taskNames[action];
    const dwell = action === 'groom' ? 1.65 : action === 'rest' ? 1.9 : .42;
    if (action === 'tend' && !this.brood.includes(task.pickedUp ?? target)) {
      this.finish(worker, 0);
      return;
    }

    const stop = target === worker ? 0 : target === nest ? 2.04 : target.kind === 'water' ? 1.24 : target.kind ? .93 : .92;
    const distance = gap(worker, target);
    const stationary = distance <= stop + .12;
    if (distance > stop + .47) task.ready = 0;
    if (stationary && !task.ready) task.ready = this.time + dwell;
    if (task.ready) {
      worker.speed *= Math.exp(-11 * dt);
      worker.turn = 0;
      if (this.time >= task.ready) this.resolve(worker);
      return;
    }
    worker.state = action === 'explore' ? 'Scouting'
      : task.phase === 'return' ? (worker.cargo === 'water' ? 'Carrying water' : 'Carrying food')
        : target.kind ? (target.kind === 'water' ? 'Seeking water' : 'Seeking food') : taskNames[action];
    const goal = Math.atan2(worker.z - target.z, target.x - worker.x);
    const error = angularError(goal, worker.heading);
    worker.turn = clamp(error * 3.15, -2.0, 2.0);
    worker.heading += worker.turn * dt;
    const urgency = task.features[1];
    const cruise = (1.34 + .83 * urgency) * (1 - .19 * worker.fatigue) * (worker.cargo ? .85 : 1);
    const alignment = Math.max(0, Math.cos(error)) ** 2;
    const pace = cruise * alignment * clamp((distance - stop) * 1.8, .20, 1);
    worker.speed += (pace - worker.speed) * (1 - Math.exp(-6.2 * dt));
    worker.x += Math.cos(worker.heading) * worker.speed * dt;
    worker.z -= Math.sin(worker.heading) * worker.speed * dt;
  }

  resolve(worker) {
    const { task } = worker;
    const { action, target } = task;
    if (action === 'rest' || action === 'groom') {
      const field = action === 'rest' ? 'fatigue' : 'dirt';
      const improvement = worker[field];
      worker[field] *= .26;
      this.finish(worker, improvement * .83);
      return;
    }
    if (action === 'tend') {
      if (task.pickedUp) {
        const brood = task.pickedUp;
        Object.assign(brood, { ...target, moved: true, carriedBy: null });
        this.finish(worker, task.benefit + .32);
        return;
      }
      if (target.carriedBy) {
        this.finish(worker, 0);
        return;
      }
      let benefit = 0;
      for (const bro of this.brood) {
        if (gap(target, bro) > 1.34) continue;
        const improvement = Math.min(.60, 1 - bro.care);
        bro.care += improvement;
        benefit += improvement;
      }
      if (!target.moved) {
        const occupied = new Set(this.brood.filter(b => b.moved || b.carriedBy).map(b => b.slot));
        let slot = 0;
        while (occupied.has(slot)) slot++;
        target.slot = slot;
        target.carriedBy = worker;
        task.pickedUp = target;
        task.target = { ...stackPosition(slot, -2.75, .15, .12), slot };
        task.benefit = Math.min(2.5, benefit);
        task.ready = 0;
        this.stats.care++;
        return;
      }
      this.stats.care++;
      this.finish(worker, Math.min(2.5, benefit));
      return;
    }
    if (action === 'explore') {
      this.finish(worker, .13 + Math.min(.80, (worker.known.size - task.known) * .21));
      return;
    }

    const kind = actionResource[action];
    if (task.phase === 'approach') {
      this.map.refill(target, this.time);
      if (target.units < 1) {
        this.finish(worker, -.36);
        return;
      }
      target.units--;
      if (action === 'eat' || action === 'drink') {
        const previous = worker[kind];
        worker[kind] = clamp(previous + .79);
        this.finish(worker, (worker[kind] - previous) * 2.4);
        return;
      }
      worker.cargo = kind;
      task.phase = 'return';
      task.ready = 0;
      task.target = task.recipient ?? (action === 'broodFood' ? this.hungryBrood() ?? nest : nest);
      return;
    }

    const broodTarget = action === 'broodFood' ? this.hungryBrood() : null;
    if (broodTarget && gap(worker, broodTarget) > 2.2) {
      task.target = broodTarget;
      task.ready = 0;
      return;
    }
    let gain = 0;
    if (task.recipient) {
      gain = Math.min(.62, 1 - task.recipient[kind]);
      task.recipient[kind] += gain;
      if (gain) this.stats.shared++;
    } else if (broodTarget) {
      for (const brood of this.brood) {
        if (brood.stage !== 1 || gap(brood, broodTarget) > 1.8) continue;
        const amount = Math.min(.64, 1 - brood.food);
        brood.food += amount;
        brood.care = clamp(brood.care + .19);
        gain += amount;
      }
      this.stats.care++;
    } else {
      gain = Math.min(queenDose, 1 - this.queen[kind]);
      this.queen[kind] += gain;
      this.stats.delivered++;
    }
    worker.cargo = null;
    this.finish(worker, Math.min(3.2, gain * 3.8));
  }

  hungryBrood() {
    return this.brood.filter(b => b.stage === 1 && b.food < .93).sort((a, b) => a.food - b.food)[0];
  }

  finish(worker, reward) {
    if (worker.task.pickedUp) worker.task.pickedUp.carriedBy = null;
    const score = reward - (this.time - worker.task.starts) * .011;
    worker.reward += score;
    if (this.settings.learning) {
      updatePolicy(worker.weights, worker.task, this.candidates(worker), score, learningRate);
      this.stats.updates++;
    }
    worker.task = null;
  }
}
