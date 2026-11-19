const size = 3;
const key = (x, z) => `${x}/${z}`;
const axis = value => Math.floor(value / size);
export const probeReach = 1.10;
const minimumReach = .14;

export function makeProbes() {
  return [-1, 1].map(side => ({ side, tip: null, aim: null, target: null, kind: '', observedAt: -Infinity, sentAt: -Infinity }));
}

function offers(character, x, y, z, radius, kind) {
  return { character, x, y, z, radius, kind };
}

export class TouchField {
  constructor(colony) {
    this.colony = colony;
    this.grid = new Map();
  }

  rebuild() {
    const { map, queen, workers, brood } = this.colony;
    this.grid.clear();
    this.add(offers(queen, 0, map.height(0, 0) + 1.14, 0, .65, 'queen'));
    this.add(offers(queen, 1.59, map.height(1.59, .2) + 1.18, .20, .54, 'queen'));
    this.add(offers(queen, -1.69, map.height(-1.69, -.2) + .85, -.20, .62, 'queen'));
    for (const worker of workers) {
      const y = map.height(worker.x, worker.z) + .62;
      const cos = Math.cos(worker.heading), sin = Math.sin(worker.heading);
      this.add(offers(worker, worker.x + cos * .75, y + .07, worker.z - sin * .75, .29, 'worker'));
      this.add(offers(worker, worker.x, y, worker.z, .23, 'worker'));
      this.add(offers(worker, worker.x - cos * .95, y - .03, worker.z + sin * .95, .37, 'worker'));
    }
    for (const item of brood) {
      const height = map.height(item.x, item.z) + (item.carriedBy ? .52 : .075 + item.layer * .129);
      this.add(offers(item, item.x, height, item.z, .16 + .055 * item.stage, 'brood'));
    }
  }

  add(node) {
    const index = key(axis(node.x), axis(node.z));
    const cell = this.grid.get(index);
    if (cell) cell.push(node);
    else this.grid.set(index, [node]);
  }

  sample(worker, dt) {
    const { colony } = this;
    const { map, time } = colony;
    const cos = Math.cos(worker.heading), sin = Math.sin(worker.heading);
    const forwardX = worker.x + cos * 1.24;
    const forwardZ = worker.z - sin * 1.24;
    const baseY = map.height(worker.x, worker.z) + .72;
    const minX = axis(forwardX - 1.8), maxX = axis(forwardX + 1.8);
    const minZ = axis(forwardZ - 1.8), maxZ = axis(forwardZ + 1.8);
    const patches = map.nearby(forwardX, forwardZ, 2.45);
    for (const probe of worker.probes) {
      const side = probe.side;
      const phase = time * 5.3 + (side > 0 ? 1.8 : 0) + worker.id * .41;
      const socketX = forwardX + side * .20 * sin;
      const socketZ = forwardZ + side * .20 * cos;
      const sweep = .38 + Math.sin(phase) * .25;
      const freeX = socketX + .73 * cos + side * sweep * sin;
      const freeZ = socketZ - .73 * sin + side * sweep * cos;
      const freeY = baseY + .09 + .17 * Math.cos(phase * .73);
      let picked = null, best = Infinity;
      const check = (character, x, y, z, radius, kind) => {
        if (character === worker || character.carriedBy === worker) return;
        const dx = x - socketX, dy = y - baseY, dz = z - socketZ;
        if (side * (dx * sin + dz * cos) < -radius - .12 || dx * cos - dz * sin < -radius - .22) return;
        const distSquared = dx * dx + dy * dy + dz * dz;
        if (distSquared > (probeReach + radius) ** 2 || distSquared < 1e-8) return;
        const distance = Math.sqrt(distSquared);
        const ray = Math.max(minimumReach, distance - radius * .80) / distance;
        const px = socketX + dx * ray, py = baseY + dy * ray, pz = socketZ + dz * ray;
        const score = (px - freeX) ** 2 + .38 * (py - freeY) ** 2 + (pz - freeZ) ** 2
          + (kind === 'stone' || kind === 'plant' ? .22 : kind === 'ground' ? .55 : 0) - (probe.target === character ? .36 : 0);
        if (score >= best) return;
        best = score;
        picked = { character, x: px, y: py, z: pz, kind };
      };
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const cell = this.grid.get(key(x, z));
          if (cell) for (const node of cell) check(node.character, node.x, node.y, node.z, node.radius, node.kind);
        }
      }
      for (const patch of patches) {
        if (patch.units >= 1) check(patch, patch.x, map.height(patch.x, patch.z) + .10, patch.z,
          patch.kind === 'water' ? .62 : .40, patch.kind);
      }
      map.forEachObstacle(socketX, socketZ, 1.76,
        (item, y, radius, kind) => check(item, item.x, y, item.z, radius, kind));
      if (!picked && Math.cos(phase * .43) < -.89) {
        check(map, socketX + .47 * cos + side * .27 * sin, map.height(freeX, freeZ) + .015,
          socketZ - .47 * sin + side * .27 * cos, .025, 'ground');
      }
      if (!picked && !probe.tip) probe.tip = { x: freeX, y: freeY, z: freeZ };
      const target = picked ?? { x: freeX, y: freeY, z: freeZ };
      const tip = probe.tip ?? { x: freeX, y: freeY, z: freeZ };
      const dx = target.x - tip.x, dy = target.y - tip.y, dz = target.z - tip.z;
      const blend = Math.min(1, 4.9 * dt / Math.max(.001, Math.hypot(dx, dy, dz)));
      tip.x += dx * blend;
      tip.y += dy * blend;
      tip.z += dz * blend;
      probe.tip = tip;
      probe.aim = picked ? tip : null;
      if (picked && Math.hypot(tip.x - target.x, tip.y - target.y, tip.z - target.z) < .17) {
        if (probe.target !== picked.character || time - probe.sentAt > .70) {
          colony.receiveTouch(worker, picked.character, picked.kind);
          probe.sentAt = time;
        }
        probe.observedAt = time;
        probe.target = picked.character;
        probe.kind = picked.kind;
      } else if (time - probe.observedAt > .28) {
        probe.target = null;
        probe.kind = '';
      }
    }
  }
}
