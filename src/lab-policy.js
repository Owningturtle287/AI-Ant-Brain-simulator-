// A shared timing signal is available to every joint. There are no leg phase
// offsets, gait templates, or pretrained motor or sensory connections.
const legChannels = 6 * 8;
const bodyChannels = 10 + 2 * 12;
export const motorChannels = legChannels + bodyChannels;
const bases = 4;
const motorSize = motorChannels * bases;
const senseSize = 17;
const driveCount = 5; // Clock, left/right torque bias, mouth, transfer, signal
export const weightCount = motorSize + senseSize * driveCount + 1;
export const zeroWeights = () => new Float32Array(weightCount);
const limit = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function readGenome(value) {
  if (value?.format !== 'fire-ant-lab/joint-policy-1' ||
    !Number.isInteger(value.generation) || value.generation < 0 || value.generation > 1_000_000 ||
    !Array.isArray(value.weights) || value.weights.length !== weightCount ||
    !value.weights.every(weight => typeof weight === 'number' && Number.isFinite(weight) && Math.abs(weight) <= 3)) {
    throw new Error('This file does not contain compatible From Scratch weights.');
  }
  return { format: value.format, generation: value.generation, weights: [...value.weights] };
}

export function snapshot(ant) {
  return { format: 'fire-ant-lab/joint-policy-1', generation: ant.generation, weights: Array.from(ant.weights) };
}

export function crossover(a, b, random) {
  const weights = Array.from(a.weights);
  const order = weights.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < weightCount / 2; i++) weights[order[i]] = b.weights[order[i]];
  return { format: 'fire-ant-lab/joint-policy-1', generation: Math.max(a.generation, b.generation) + 1, weights };
}

export class JointPolicy {
  constructor(weights, random) {
    this.weights = weights;
    this.random = random;
    this.trial = new Float32Array(weightCount);
    this.commands = new Float32Array(motorChannels);
    this.changes = [];
    this.score = 0;
    this.phase = 0;
    this.window = 0;
    this.updates = 0;
    this.baseline = 0;
    this.training = null;
  }

  begin() {
    const amplitude = .24 / (1 + this.updates * .009) + .055;
    // Most trials explore a few nearby joint coefficients, with occasional
    // broader coordination trials to get out of a stationary pose.
    const changes = this.random() < .20 ? 34 : 11;
    for (let i = 0; i < changes; i++) {
      const range = this.random();
      const index = range < .93 ? Math.floor(this.random() * legChannels * bases)
        : range < .99 ? Math.floor(this.random() * (motorSize + 2 * senseSize)) : weightCount - 1;
      if (this.trial[index]) continue;
      this.trial[index] = (2 * this.random() - 1) * amplitude;
      this.changes.push(index);
    }
  }

  act(senses, contacts, dt, training) {
    if (this.training !== training) {
      this.trial.fill(0);
      this.changes.length = 0;
      this.score = this.window = 0;
      this.baseline = null;
      this.training = training;
    }
    const drive = output => {
      let sum = 0;
      const start = motorSize + output * senseSize;
      for (let i = 0; i < senses.length; i++) sum += (this.weights[start + i] + this.trial[start + i]) * senses[i];
      return sum;
    };
    const clock = this.weights[weightCount - 1] + this.trial[weightCount - 1];
    this.phase = (this.phase + dt * (8.8 + 6.5 * Math.tanh(drive(0) + clock))) % (2 * Math.PI);
    const sine = Math.sin(this.phase), cosine = Math.cos(this.phase);
    const bend = Math.tanh(drive(1)) * .34;
    for (let i = 0; i < motorChannels; i++) {
      const j = i * bases;
      const w = this.weights, t = this.trial;
      const leg = Math.floor(i / 8);
      const feedback = i < legChannels ? Number(contacts[leg]) : (senses[9] + senses[10]) * .5;
      const lateral = i < legChannels && i % 8 === 0 ? bend * (leg < 3 ? -1 : 1) : 0;
      this.commands[i] = Math.tanh(w[j] + t[j] + sine * (w[j + 1] + t[j + 1]) +
        cosine * (w[j + 2] + t[j + 2]) + feedback * (w[j + 3] + t[j + 3]) + lateral);
    }
    const acts = [];
    for (let i = 2; i < driveCount; i++) {
      const raw = drive(i);
      const chance = 1 / (1 + Math.exp(2.8 - raw));
      acts.push({ fires: training ? this.random() < chance : raw > .40, chance });
    }
    return acts;
  }

  learnIO(senses, acts, benefits) {
    if (!this.training) return;
    for (const [i, action] of acts.entries()) {
      if (!action.fires && !benefits[i]) continue;
      const gain = (benefits[i] - (action.fires ? .022 : 0)) * (Number(action.fires) - action.chance);
      const start = motorSize + (i + 2) * senseSize;
      for (let j = 0; j < senses.length; j++) {
        const index = start + j;
        this.weights[index] = limit(this.weights[index] + senses[j] * gain * .53, -3, 3);
      }
    }
  }

  observe(reward, dt) {
    if (!this.training) return;
    this.score += reward;
    this.window += dt;
    if (this.window < 2.4 - .00001) return;
    // Compare a perturbation with a fresh evaluation of the inherited policy.
    // A mode change discards unfinished trials. Only committed weights are saved.
    if (this.baseline === null) {
      this.baseline = this.score;
      this.begin();
    } else {
      if (this.score > this.baseline + .009) {
        for (const i of this.changes) this.weights[i] = limit(this.weights[i] + this.trial[i], -3, 3);
        this.updates++;
      }
      for (const i of this.changes) this.trial[i] = 0;
      this.changes.length = 0;
      this.baseline = null;
    }
    this.window = this.score = 0;
  }
}
