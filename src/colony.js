import { seeded } from './brain.js';
import { ColonyMap } from './colony-map.js';
import { acceptsPolicy, inheritPolicy, selectAction, taskNames, updatePolicy } from './colony-policy.js';
import { makeProbes, TouchField } from './touch.js';
import { BodySpace } from './body-space.js';
import { addGrime, beginGroom, completeGroom, freshGrime, groomingActions, inheritReach, pickUpGrime, scrubGroom } from './grooming.js';

export const defaultSettings = Object.freeze({
  eggSeconds: 10, stageSeconds: 60, ageLimit: 0, needRate: 1, resourceDensity: 1,
  resourceRenewal: .085, mutation: .10, learning: true, restart: true, populationLimit: 40,
});
export const broodStages = ['Egg', 'Larva', 'Pupa'];
export const colonyStep = .1;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const actionResource = {
  eat: 'food', drink: 'water', queenFood: 'food', queenWater: 'water',
  broodFood: 'food', peerFood: 'food', peerWater: 'water',
};
export const queenHeading = -.13;
export const nursery = { x: -2.61, z: -3.48 };
const nest = { x: 0, z: 0 };
const queenMouth = { x: 2.20, z: .29 };
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
    this.best = acceptsPolicy(history?.weights) && Number.isFinite(history.score)
      ? { score: history.score, weights: history.weights.slice(), reach: history.reach } : null;
    this.restart();
  }

  restart(newWorld = false) {
    if (newWorld) this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    this.run++;
    this.time = 0;
    this.random = seeded((this.seed ^ Math.imul(this.run, 8419)) || 1);
    this.map = new ColonyMap(this.seed, this.settings);
    this.queen = { ...nest, heading: queenHeading, queen: true, food: .94, water: .94, living: true, events: [] };
    this.space = new BodySpace(this.map.height);
    this.space.record(this.queen);
    this.touch = new TouchField(this);
    this.eggClock = 0;
    this.nextId = 1;
    this.brood = [];
    this.workers = [];
    this.messages = [];
    this.signals = { food: .06, water: .06, brood: 0 };
    this.stats = { eggs: 0, hatched: 0, deaths: 0, care: 0, delivered: 0, shared: 0, updates: 0, exchanges: 0, grooming: 0 };
    this.failed = null;
    this.failureTime = 0;
    this.championCheck = 0;
    this.previousWorker = this.spawnWorker(this.best?.weights, 0, 4.39, .77, this.best?.reach);
  }

  spawnWorker(weights, generation, x, z, reach) {
    const worker = {
      id: this.nextId++, x, z, heading: Math.atan2(-z, x), speed: 0, age: 0,
      food: .88, water: .9, fatigue: .05, generation, weights: inheritPolicy(weights, 0, this.random),
      grime: freshGrime(), groomSkill: inheritReach(reach, 0, this.random), grooming: null, lastCleaned: null,
      lift: 0, blocked: 0, bypass: undefined,
      hold: null, cargo: null, task: null, state: 'Assessing nest', known: new Set(),
      recall: { food: 0, water: 0, brood: 0 }, requests: { food: 0, water: 0, until: 0 },
      scanAt: 0, reward: 0, looking: 0, turn: 0,
      probes: makeProbes(), peerSignals: new Map(), broodSignals: new Map(), lastTouch: null, slowUntil: 0,
    };
    const vacant = this.space.place(worker, worker.heading);
    if (!vacant) return null;
    Object.assign(worker, vacant);
    worker.previous = { ...vacant, lift: 0 };
    this.workers.push(worker);
    this.space.record(worker);
    return worker;
  }

  layEgg() {
    const parent = this.previousWorker;
    const occupied = new Set(this.brood.filter(item => !item.moved).map(item => item.slot));
    let slot = 0;
    while (occupied.has(slot)) slot++;
    const id = this.nextId++;
    this.brood.push({
      id, slot, ...stackPosition(slot, -3.63, -1.56, .53), stage: 0, age: 0, care: .94, food: .80, moved: false,
      parentId: parent.id, generation: parent.generation + 1,
      weights: inheritPolicy(parent.weights, this.settings.mutation, this.random),
      reach: inheritReach(parent.groomSkill, this.settings.mutation, this.random),
    });
    this.stats.eggs++;
    this.queenEvent('egg', { id: this.nextId - 1 });
  }

  queenEvent(kind, payload) {
    this.queen.events.push({ kind, time: this.time, ...payload });
    if (this.queen.events.length > 16) this.queen.events.shift();
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
          const adult = this.spawnWorker(larva.weights, larva.generation, x, z, larva.reach);
          if (adult) {
            this.previousWorker = adult;
            this.stats.hatched++;
            continue;
          }
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
    this.space.rebuild(this.queen, this.workers);
    this.signals.food = 1 - this.queen.food;
    this.signals.water = 1 - this.queen.water;
    this.signals.brood = this.brood.reduce((urgent, brood) => Math.max(urgent,
      1 - (brood.stage === 1 ? Math.min(brood.food, brood.care) : brood.care)), 0);
    this.touch.rebuild();
    for (const worker of this.workers) {
      worker.previous.x = worker.x;
      worker.previous.z = worker.z;
      worker.previous.heading = worker.heading;
      worker.previous.lift = worker.lift;
      worker.age += dt;
      worker.food = clamp(worker.food - dt * (.0033 + worker.speed * .0009) * need);
      worker.water = clamp(worker.water - dt * (.0046 + worker.speed * .0011) * need);
      worker.fatigue = clamp(worker.fatigue + dt * (worker.speed > .2 ? .018 : -.012));
      pickUpGrime(worker, this.map.height, this.time, dt);
      if (worker.food && worker.water && (!this.settings.ageLimit || worker.age < this.settings.ageLimit)) {
        if (!worker.grooming) this.touch.sample(worker, dt);
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
    this.best = { score, weights: Array.from(parent.weights), reach: { ...parent.groomSkill } };
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

  receiveTouch(worker, target, kind, side) {
    worker.lastTouch = { kind, id: target.id, time: this.time };
    if (side) {
      const part = side < 0 ? 'leftAntenna' : 'rightAntenna';
      if (kind === 'water') addGrime(worker, part, -.058);
      else if (kind === 'ground' || kind === 'stone' || kind === 'plant') addGrime(worker, part, .025);
      else if (kind === 'worker') addGrime(worker, part, (target.grime.head - worker.grime[part]) * .045);
      else if (kind === 'food' || kind === 'brood') addGrime(worker, part, .012);
    }
    if (kind === 'worker') {
      const previous = worker.peerSignals.get(target);
      const newExchange = !previous || this.time - previous.exchangeAt > 2.5;
      const exchangeAt = newExchange ? this.time : previous.exchangeAt;
      const remember = (receiver, sender) => {
        receiver.peerSignals.set(sender, {
          food: 1 - sender.food, water: 1 - sender.water, until: this.time + 8, exchangeAt,
        });
        if (newExchange) for (const patch of sender.known) receiver.known.add(patch);
      };
      remember(worker, target);
      remember(target, worker);
      if (newExchange) {
        this.stats.exchanges++;
        worker.slowUntil = this.time + .27;
        if (target.slowUntil < this.time) target.slowUntil = this.time + .18;
      }
    } else if (kind === 'queen') {
      Object.assign(worker.recall, this.signals);
    } else if (kind === 'brood') {
      worker.broodSignals.set(target, { demand: 1 - Math.min(target.care, target.stage === 1 ? target.food : 1),
        until: this.time + 10 });
    } else if (kind === 'food' || kind === 'water') {
      worker.known.add(target);
    } else if (kind === 'stone' || kind === 'plant') {
      worker.slowUntil = Math.max(worker.slowUntil, this.time + .15);
    }
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
      if (demand > .12 || worker.cargo) add(action, demand, worker.cargo ? queenMouth : resources[kind], 0, Number(!!worker.cargo));
    }
    for (const [action, kind] of [['peerFood', 'food'], ['peerWater', 'water']]) {
      if (worker[kind] < .32 || (worker.cargo && worker.cargo !== kind)) continue;
      let recipient;
      let bestNeed = 0;
      for (const peer of this.workers) {
        if (peer === worker || gap(worker, peer) >= 7.5) continue;
        const contact = worker.peerSignals.get(peer);
        const viaContact = contact?.until >= this.time && contact[kind] > .61 ? contact[kind] + .08 : 0;
        const cue = peer.requests.until >= this.time ? peer.requests[kind] : 0;
        const need = Math.max(cue, viaContact);
        if (need > bestNeed) { recipient = peer; bestNeed = need; }
      }
      if (recipient) {
        add(action, bestNeed, worker.cargo ? recipient : resources[kind], .4, Number(!!worker.cargo));
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
        const contact = worker.broodSignals.get(target);
        const seen = contact?.until > this.time ? contact.demand * .22 : 0;
        add('tend', 1 - target.care + (target.moved ? 0 : .19) + seen, target, untidy.length / 8);
      }
    }
    if (!worker.cargo) {
      add('rest', worker.fatigue, worker);
      if (worker.lift < .12) for (const { action, key } of groomingActions) {
        if (worker.grime[key] > .23) add(action, worker.grime[key], worker, 1 - worker.fatigue);
      }
    }
    const surroundings = Number(Boolean(resources.food)) + Number(Boolean(resources.water));
    add('explore', .23 + .25 * (2 - surroundings), worker, worker.recall.brood);
    return result;
  }

  runWorker(worker, dt) {
    if (this.time >= worker.scanAt) {
      worker.scanAt = this.time + .72;
      this.sense(worker);
      for (const [peer, signal] of worker.peerSignals) {
        if (signal.until < this.time) worker.peerSignals.delete(peer);
      }
      for (const [brood, signal] of worker.broodSignals) {
        if (signal.until < this.time) worker.broodSignals.delete(brood);
      }
    }
    if (worker.grooming) {
      worker.speed *= Math.exp(-15 * dt);
      worker.turn = 0;
      const obstacles = this.space.near(worker, 2.9).flatMap(other => other.lobes);
      if (scrubGroom(worker, this.time, dt, obstacles, this.map.height) >= 1) {
        if (worker.grooming.removed > .015) {
          worker.lastCleaned = worker.grooming.key;
          this.stats.grooming++;
        }
        this.finish(worker, completeGroom(worker, this.settings.learning));
      }
      return;
    }
    if (!worker.task) {
      const choice = selectAction(worker.weights, this.candidates(worker), this.random, this.settings.learning ? .15 : .04);
      const { action } = choice;
      let target = choice.target;
      if (action === 'explore') {
        const limit = this.workers.length === 1 ? 13 : 32;
        const towardsNest = gap(worker, nest) > limit && (this.random() < .82 || worker.cargo);
        const direction = towardsNest ? Math.atan2(worker.z, -worker.x) : worker.heading + (this.random() - .5) * 2.85;
        const distance = 4.4 + this.random() * 7;
        target = { x: worker.x + Math.cos(direction) * distance, z: worker.z - Math.sin(direction) * distance };
      }
      worker.task = { ...choice, target, phase: worker.cargo ? 'return' : 'approach', starts: this.time,
        ready: 0, known: worker.known.size };
      worker.ringRoute = null;
      worker.looking = (this.random() - .5) * .45;
      if (action.startsWith('groom:')) {
        const trial = (this.random() - .5) * .92;
        worker.grooming = beginGroom(worker, action.slice(6), trial, this.time);
      }
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
    if (worker.grooming) return;
    const dwell = action === 'rest' ? 1.9 : .42;
    if (action === 'tend' && !this.brood.includes(task.pickedUp ?? target)) {
      this.finish(worker, 0);
      return;
    }

    const stop = target === worker ? 0 : target === queenMouth ? 1.62 : task.recipient ? 2.18 :
      target.kind === 'water' ? 1.40 : target.kind ? 1.18 : action === 'explore' ? .86 : 1.75;
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
    const urgency = task.features[1];
    const cruise = (1.34 + .83 * urgency) * (1 - .19 * worker.fatigue) * (worker.cargo ? .85 : 1);
    const pace = cruise * clamp((distance - stop) * 1.8, .20, 1) * (worker.slowUntil > this.time ? .52 : 1);
    this.space.move(worker, goal, pace, dt, target, !worker.cargo);
  }

  resolve(worker) {
    const { task } = worker;
    const { action, target } = task;
    if (action === 'rest') {
      const improvement = worker.fatigue;
      worker.fatigue *= .26;
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
        task.target = { ...stackPosition(slot, nursery.x, nursery.z, .12), slot };
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
      task.target = task.recipient ?? (action === 'broodFood' ? this.hungryBrood() ?? queenMouth : queenMouth);
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
      if (gain > 0) {
        this.queenEvent(kind, { x: worker.x + Math.cos(worker.heading) * 1.17,
          z: worker.z - Math.sin(worker.heading) * 1.17, y: this.map.height(worker.x, worker.z) + .55 });
      }
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
