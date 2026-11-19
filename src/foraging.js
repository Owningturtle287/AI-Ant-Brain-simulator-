import { WorkerBrain, neuralStep, seeded } from './brain.js';
import { arenaLimit, terrainHeight } from './motion.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const angle = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const radial = (dx, dz, spread) => Math.exp(-(dx * dx + dz * dz) / spread);
const defaultFood = [4.45, -1.67];
const starterTrail = [[0, 0], [1.2, -.07], [2.35, -.55], [3.4, -1.27], defaultFood];

function trailNodes() {
  const nodes = [];
  for (let i = 1; i < starterTrail.length; i++) {
    const [x, z] = starterTrail[i - 1];
    const [endX, endZ] = starterTrail[i];
    const steps = Math.ceil(Math.hypot(endX - x, endZ - z) / .18);
    for (let j = 0; j < steps; j++) {
      nodes.push({ x: x + (endX - x) * j / steps, z: z + (endZ - z) * j / steps, strength: .84 });
    }
  }
  return nodes;
}

export class ForagingWorker {
  constructor() {
    this.brain = new WorkerBrain();
    this.output = { turn: 0, pace: 0 };
    this.senses = { odor: [0, 0], contact: [0, 0], touch: 0, vision: 0, turn: 0, pace: 0 };
    this.reset();
  }

  reset() {
    this.brain.reset();
    this.food = { x: defaultFood[0], z: defaultFood[1], units: 6 };
    this.trail = trailNodes();
    this.random = seeded(723017);
    this.state = 'Searching';
    this.carrying = false;
    this.delivered = 0;
    this.foodContact = 0;
    this.nestPause = 0;
    this.searchDirection = 0;
    this.searchTime = 0;
    this.odometerX = 0;
    this.odometerZ = 0;
    this.previousX = 0;
    this.previousZ = 0;
    this.lastDeposit = null;
    this.elapsed = 0;
    this.output.turn = 0;
    this.output.pace = 0;
  }

  placeFood(x, z) {
    this.food = { x: clamp(x, -5.9, 5.9), z: clamp(z, -5.9, 5.9), units: 6 };
    this.foodContact = 0;
  }

  sniff(x, z, biasForTrail) {
    let trail = 0;
    for (const node of this.trail) {
      const dx = x - node.x, dz = z - node.z;
      if (Math.abs(dx) < 1.1 && Math.abs(dz) < 1.1) {
        trail = Math.max(trail, node.strength * radial(dx, dz, .25));
      }
    }
    const food = this.food.units ? radial(x - this.food.x, z - this.food.z, 1.65) : 0;
    return Math.max(food, trail * biasForTrail);
  }

  step(dt, motion) {
    this.elapsed += dt;
    if (this.elapsed + 1e-10 < neuralStep) return this.output;
    this.elapsed -= neuralStep;
    const dx = motion.x - this.previousX, dz = motion.z - this.previousZ;
    this.odometerX += dx;
    this.odometerZ += dz;
    this.previousX = motion.x;
    this.previousZ = motion.z;
    const controlled = Boolean(motion.destination || motion.manual);
    this.sample(motion);
    this.decide(motion, controlled);
    this.brain.step(this.senses);
    this.output.turn = this.state === 'Sampling food' ? this.brain.turn * .18 : this.brain.turn;
    this.output.pace = this.senses.pace === 0 ? 0 : this.brain.pace;
    return this.output;
  }

  sample(motion) {
    const bearing = motion.heading + motion.joints.headYaw * .34;
    const cos = Math.cos(bearing), sin = Math.sin(bearing);
    const { odor, contact } = this.senses;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const spread = side * (.33 + .055 * Math.sin(motion.clock * 8.7 + i * 1.9));
      const reach = 1.16 + .095 * Math.cos(motion.clock * 6 + i * 2);
      const x = motion.x + cos * reach + sin * spread;
      const z = motion.z - sin * reach + cos * spread;
      odor[i] = this.sniff(x, z, .95);
      const border = Math.max(Math.abs(x), Math.abs(z));
      const rise = terrainHeight(motion.terrain, x, z) - terrainHeight(motion.terrain, motion.x, motion.z);
      contact[i] = clamp(Math.max((border - 5.3) / .76, (rise - .25) / .44), 0, 1);
    }
    const mouthX = motion.x + cos * 1.21, mouthZ = motion.z - sin * 1.21;
    const foodDistance = Math.hypot(mouthX - this.food.x, mouthZ - this.food.z);
    this.senses.touch = this.food.units && foodDistance < (this.foodContact ? .58 : .45) ? 1 : 0;
    this.foodOdor = this.food.units ? Math.exp(-foodDistance * foodDistance / 1.65) : 0;
    this.senses.vision = clamp(.07 + motion.speed * .26 + Math.abs(motion.yawRate) * .15, 0, 1);
  }

  decide(motion, controlled) {
    const sense = this.senses;
    for (const node of this.trail) node.strength *= .99945;
    if (this.brain.tick % 100 === 0) this.trail = this.trail.filter(node => node.strength > .07);
    if (controlled) {
      this.state = 'Guided';
      sense.turn = motion.turnIntent;
      sense.pace = clamp(motion.speed / 2.3, 0, 1);
      return;
    }

    if (this.carrying) {
      const distance = Math.hypot(this.odometerX, this.odometerZ);
      if (distance < .43) {
        this.carrying = false;
        this.delivered++;
        this.nestPause = .72;
        this.odometerX = motion.x;
        this.odometerZ = motion.z;
      } else {
        const previous = this.lastDeposit;
        if (!previous || Math.hypot(motion.x - previous.x, motion.z - previous.z) > .24) {
          this.lastDeposit = { x: motion.x, z: motion.z, strength: .92 };
          this.trail.push(this.lastDeposit);
          if (this.trail.length > 145) this.trail.shift();
        }
        const error = angle(motion.heading, Math.atan2(this.odometerZ, -this.odometerX));
        sense.turn = clamp(error / .83, -1, 1);
        sense.pace = .28 + .68 * Math.max(0, Math.cos(error));
        this.state = 'Returning to nest';
        return;
      }
    }

    if (this.nestPause > 0) {
      this.nestPause -= neuralStep;
      const meanRoute = Math.max(sense.odor[0], sense.odor[1]);
      const error = angle(motion.heading, .19);
      sense.turn = clamp(error / .77, -1, 1);
      sense.pace = this.nestPause < .29 && meanRoute > .1 ? .30 : 0;
      this.state = 'At nest';
      return;
    }

    if (sense.touch) {
      this.foodContact += neuralStep;
      sense.pace = 0;
      sense.turn = 0;
      this.state = 'Sampling food';
      if (this.foodContact >= .32) {
        this.carrying = true;
        this.food.units--;
        this.foodContact = 0;
        this.lastDeposit = null;
      }
      return;
    }
    this.foodContact = 0;

    const odor = Math.max(...sense.odor);
    const avoidance = (sense.contact[1] - sense.contact[0]) * 1.75;
    if (odor > .13) {
      this.state = 'Following scent';
      sense.turn = clamp((sense.odor[0] - sense.odor[1]) * 1.55 + avoidance, -1, 1);
      sense.pace = .87 - Math.max(0, this.foodOdor - .46) * .64;
      return;
    }
    this.state = 'Searching';
    this.searchTime -= neuralStep;
    if (this.searchTime <= 0) {
      this.searchTime = .6 + this.random() * 1.15;
      this.searchDirection = (this.random() - .5) * 1.12;
    }
    const inward = Math.hypot(motion.x, motion.z) > 5.2
      ? angle(motion.heading, Math.atan2(motion.z, -motion.x)) * .67 : 0;
    sense.turn = clamp(this.searchDirection + Math.sin(motion.clock * 2.65) * .31 + avoidance + inward, -1, 1);
    sense.pace = .83 - .35 * Math.max(...sense.contact);
  }
}
