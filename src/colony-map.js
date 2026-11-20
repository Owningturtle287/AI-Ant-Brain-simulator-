import { seeded } from './brain.js';

export const chunkSize = 24;
export const chunkAt = value => Math.floor((value + chunkSize / 2) / chunkSize);
export const chunkKey = (x, z) => `${x},${z}`;

function coordinateSeed(seed, x, z) {
  let hash = (seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) | 0;
  hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b);
  return (hash ^ hash >>> 16) || 1;
}

export class ColonyMap {
  constructor(seed, settings) {
    this.seed = seed;
    this.settings = settings;
    this.chunks = new Map();
    this.resourceVersion = 0;
    const phase = seeded(seed || 1)() * Math.PI * 2;
    this.height = (x, z) => {
      const flat = Math.min(1, Math.hypot(x, z) / 11) ** 2;
      return flat * (.63 * Math.sin(x * .16 + phase) * Math.cos(z * .14 - phase)
        + .35 * Math.sin(x * .29 + z * .18 + phase) * Math.sin(z * .24 - x * .13)
        + .105 * Math.cos(x * .7 - z * .57))
        + .019 * Math.sin(x * 2.2) * Math.cos(z * 2.5);
    };
  }

  chunk(x, z) {
    const id = chunkKey(x, z);
    if (this.chunks.has(id)) return this.chunks.get(id);
    const seed = coordinateSeed(this.seed, x, z);
    const random = seeded(seed);
    const patch = (kind, x, z, capacity) => ({
      kind, x, z, units: capacity, capacity, lastRefill: 0,
    });
    const resources = [];
    if (this.settings.starterResources !== false && x === 0 && z === 0) {
      // One discoverable pair prevents the opening from depending on a lucky seed.
      const angle = .18 + random() * .55;
      resources.push(patch('food', Math.cos(angle) * 7.4, -Math.sin(angle) * 7.4, 34));
      resources.push(patch('water', 3.0 + random() * 1.4, 5.6 + random() * 1.7, 34));
    }
    const density = this.settings.resourceDensity;
    const expected = 3 * density;
    const quantity = Math.floor(expected) + Number(random() < expected % 1);
    for (let i = 0; i < quantity; i++) {
      const px = x * chunkSize + (random() - .5) * (chunkSize - 3);
      const pz = z * chunkSize + (random() - .5) * (chunkSize - 3);
      if (Math.hypot(px, pz) < 5.2) continue;
      resources.push(patch(random() > .33 ? 'food' : 'water', px, pz, 9 + Math.floor(random() * 20)));
    }
    const stoneRandom = seeded((seed ^ 0x37ad71) || 1);
    const stones = Array.from({ length: 85 }, (_, index) => {
      const px = x * chunkSize + (stoneRandom() - .5) * chunkSize;
      const pz = z * chunkSize + (stoneRandom() - .5) * chunkSize;
      const radius = .035 + stoneRandom() ** 5 * (.32 + .34 * Number(Math.hypot(px, pz) > 18));
      return { index, x: px, z: pz, radius, y: this.height(px, pz) + radius * .13 };
    });
    const plantRandom = seeded((seed ^ 0x482371) || 1);
    const plants = [];
    for (let i = 0; i < 7; i++) {
      const px = x * chunkSize + (plantRandom() - .5) * chunkSize;
      const pz = z * chunkSize + (plantRandom() - .5) * chunkSize;
      const height = .34 + plantRandom() ** 2 * 1.65;
      if (Math.hypot(px, pz) < 7 || resources.some(patch => Math.hypot(px - patch.x, pz - patch.z) < 1.6)) continue;
      plants.push({ x: px, z: pz, height, y: this.height(px, pz) });
    }
    const tile = { seed, resources, stones, plants, x, z };
    this.chunks.set(id, tile);
    return tile;
  }

  nearby(x, z, radius) {
    const found = [];
    for (let az = chunkAt(z - radius); az <= chunkAt(z + radius); az++) {
      for (let ax = chunkAt(x - radius); ax <= chunkAt(x + radius); ax++) {
        for (const resource of this.chunk(ax, az).resources) {
          if ((resource.x - x) ** 2 + (resource.z - z) ** 2 <= radius ** 2) found.push(resource);
        }
      }
    }
    return found;
  }

  refill(patch, time) {
    if (time <= patch.lastRefill) return;
    patch.units = Math.min(patch.capacity, patch.units + (time - patch.lastRefill) * this.settings.resourceRenewal);
    patch.lastRefill = time;
  }

  forEachObstacle(x, z, radius, visit) {
    for (let tz = chunkAt(z - radius); tz <= chunkAt(z + radius); tz++) {
      for (let tx = chunkAt(x - radius); tx <= chunkAt(x + radius); tx++) {
        const tile = this.chunk(tx, tz);
        for (const stone of tile.stones) {
          if (stone.radius > .135 && (x - stone.x) ** 2 + (z - stone.z) ** 2 < radius * radius) visit(stone,
            stone.y + stone.radius * .15, stone.radius * .73, 'stone');
        }
        for (const plant of tile.plants) {
          if ((x - plant.x) ** 2 + (z - plant.z) ** 2 < radius * radius) visit(plant,
            plant.y + Math.min(.68, plant.height * .42), .19, 'plant');
        }
      }
    }
  }
}
