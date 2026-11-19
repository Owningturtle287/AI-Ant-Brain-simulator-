export const neuronCount = 250_000;
export const neuralStep = 1 / 20;

// Population estimates for one adult worker. Kenyon-cell allocation uses a comparative
// myrmicine prior. The other allocations reserve cells for plausible worker circuitry.
export const regions = [
  { name: 'Mushroom bodies', short: 'MB', count: 60_000, color: '#e79b8b', function: 'Sparse Kenyon-cell responses to combinations of sensory input.' },
  { name: 'Antennal lobes', short: 'AL', count: 18_000, color: '#ffbd77', function: 'Process odor signals from the left and right antennae.' },
  { name: 'Optic lobes', short: 'OL', count: 12_000, color: '#9bc8eb', function: 'Respond to changes in the visual field during movement.' },
  { name: 'Lateral horns', short: 'LH', count: 14_000, color: '#d9b0de', function: 'Relay odor cues into innate orientation pathways.' },
  { name: 'Central complex', short: 'CX', count: 9_000, color: '#ffdf94', function: 'Represents heading and contributes to steering.' },
  { name: 'Subesophageal zone', short: 'SEZ', count: 24_000, color: '#a9d4ac', function: 'Processes contact and taste, with nearby descending motor relays represented here.' },
  { name: 'Other central brain', short: 'CB', count: 113_000, color: '#a7a9cd', function: 'Other protocerebral and relay populations in the model.' },
];
export const [MB, AL, OL, LH, CX, SEZ, CB] = regions.map((_, index) => index);

let offset = 0;
for (const region of regions) {
  region.start = offset;
  offset += region.count;
}

// Three synthetic incoming synapses per neuron. Pathways are chosen at the
// population level. The individual partners and weights are deterministic priors.
const inputs = [
  [AL, AL, OL], [AL, AL, CB], [OL, OL, CB], [AL, AL, LH],
  [LH, CB, CX], [CX, CX, SEZ], [MB, LH, CX],
];
const polarity = new Uint8Array([0, 1]);
export function seeded(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class WorkerBrain {
  constructor() {
    this.voltage = new Float32Array(neuronCount);
    this.trace = [new Float32Array(neuronCount), new Float32Array(neuronCount)];
    this.spikes = new Uint8Array(neuronCount);
    this.previousSpikes = new Uint8Array(neuronCount);
    this.threshold = new Float32Array(neuronCount);
    this.leak = new Float32Array(neuronCount);
    this.bias = new Float32Array(neuronCount);
    this.sources = new Int32Array(neuronCount * 3);
    this.weights = new Float32Array(neuronCount * 3);
    this.regionOf = new Uint8Array(neuronCount);
    this.channel = new Uint8Array(neuronCount);
    this.groupSize = new Uint32Array(regions.length * 4);
    this.groupActivity = new Float32Array(regions.length * 4);
    this.totals = new Uint32Array(regions.length);
    this.build();
    this.reset();
  }

  build() {
    const random = seeded(98623);
    for (const [regionIndex, region] of regions.entries()) {
      const half = region.count / 2;
      for (let local = 0; local < region.count; local++) {
        const id = region.start + local;
        const side = local < half ? 0 : 1;
        const subtype = local % 2;
        const group = regionIndex * 4 + side * 2 + subtype;
        this.bias[id] = .075 + random() * .125;
        this.threshold[id] = .82 + random() * .65;
        this.leak[id] = .44 + random() * .25;
        this.regionOf[id] = regionIndex;
        this.channel[id] = group;
        this.groupSize[group]++;
        let edge = id * 3;
        for (const sourceRegion of inputs[regionIndex]) {
          const source = regions[sourceRegion];
          const sourceHalf = source.count / 2;
          const motor = regionIndex === SEZ && sourceRegion === CX;
          const sourceSide = motor || random() > .12 ? side : 1 - side;
          const candidate = motor ? 2 * Math.floor(random() * sourceHalf / 2) + subtype : Math.floor(random() * sourceHalf);
          const sourceStart = source.start + sourceSide * sourceHalf;
          let sourceId = sourceStart + candidate;
          const step = motor ? 2 : 1;
          while (sourceId === id ||
              (edge > id * 3 && sourceId === this.sources[edge - 1]) ||
              (edge > id * 3 + 1 && sourceId === this.sources[edge - 2])) {
            sourceId = sourceStart + (sourceId - sourceStart + step) % sourceHalf;
          }
          this.sources[edge] = sourceId;
          this.weights[edge] = motor ? .69 + random() * .2
            : (.10 + random() * .27) * (random() > .78 ? -1 : 1);
          edge++;
        }
      }
    }
  }

  reset() {
    this.voltage.fill(0);
    this.trace[0].fill(0);
    this.trace[1].fill(0);
    this.spikes.fill(0);
    this.previousSpikes.fill(0);
    this.groupActivity.fill(0);
    this.totals.fill(0);
    this.tick = 0;
    this.active = 0;
    this.turn = 0;
    this.pace = 0;
    this.drive = new Float32Array(regions.length * 4);
  }

  step(input) {
    const { drive } = this;
    for (const side of polarity) {
      const left = side === 0;
      const lane = side * 2;
      drive[MB * 4 + lane] = .01 + input.odor[side] * .10;
      drive[MB * 4 + lane + 1] = .02 + input.vision * .06;
      drive[AL * 4 + lane] = .035 + input.odor[side] * .87;
      drive[AL * 4 + lane + 1] = .035 + input.odor[side] * .46;
      drive[OL * 4 + lane] = .04 + input.vision * .72;
      drive[OL * 4 + lane + 1] = .04 + input.vision * .50;
      drive[LH * 4 + lane] = .045 + input.odor[side] * .24;
      drive[LH * 4 + lane + 1] = .05 + input.contact[side] * .20;
      drive[CX * 4 + lane] = .43 + input.turn * (left ? .35 : -.35);
      drive[CX * 4 + lane + 1] = .14 + input.pace * .78;
      drive[SEZ * 4 + lane] = .07 + input.contact[side] * .11;
      drive[SEZ * 4 + lane + 1] = .045 + input.touch * .15;
      drive[CB * 4 + lane] = .08 + input.vision * .14 + input.odor[side] * .10;
      drive[CB * 4 + lane + 1] = .08 + input.touch * .22 + input.contact[side] * .19;
    }

    const { voltage, trace, spikes, threshold, leak, bias, channel, sources, weights, regionOf, totals, groupActivity } = this;
    const previous = trace[this.tick % 2];
    const next = trace[(this.tick + 1) % 2];
    this.previousSpikes.set(spikes);
    totals.fill(0);
    groupActivity.fill(0);
    let active = 0;
    for (let id = 0, edge = 0; id < neuronCount; id++, edge += 3) {
      const group = channel[id];
      const incoming = previous[sources[edge]] * weights[edge]
        + previous[sources[edge + 1]] * weights[edge + 1]
        + previous[sources[edge + 2]] * weights[edge + 2];
      const membrane = Math.max(0, voltage[id] * leak[id] + drive[group] + bias[id] + incoming);
      const fired = membrane >= threshold[id] ? 1 : 0;
      spikes[id] = fired;
      voltage[id] = fired ? 0 : membrane;
      const signal = previous[id] * .73 + fired * .27;
      next[id] = signal;
      totals[regionOf[id]] += fired;
      groupActivity[group] += signal;
      active += fired;
    }
    this.tick++;
    this.active = active;

    const readout = SEZ * 4;
    const mean = lane => groupActivity[readout + lane] / this.groupSize[readout + lane];
    const turn = clamp((mean(0) - mean(2)) * 2.35, -1, 1);
    const pace = clamp(((mean(1) + mean(3)) / 2 - .09) * 1.17, 0, 1);
    this.turn += (turn - this.turn) * .66;
    this.pace += (pace - this.pace) * .62;
  }
}
