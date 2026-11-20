const cellSize = 4;
const cell = value => Math.floor(value / cellSize);
const cellKey = (x, z) => x + ',' + z;
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const limit = (v, low, high) => Math.max(low, Math.min(high, v));
const turnOptions = [0, -.48, .48, -.91, .91, -1.36, 1.36, -1.92, 1.92, Math.PI];
const ring = Array.from({ length: 14 }, (_, i) => {
  const angle = i * Math.PI * 2 / 14;
  return { x: -.52 + Math.cos(angle) * 5.69, z: Math.sin(angle) * 3.31 };
});

function crossesNest(a, b) {
  const x = (a.x + .52) / 4.80, z = a.z / 2.1;
  const dx = (b.x - a.x) / 4.80, dz = (b.z - a.z) / 2.1;
  const length = dx * dx + dz * dz;
  if (!length) return false;
  const t = -(x * dx + z * dz) / length;
  if (t <= .08 || t >= .94) return false;
  return (x + t * dx) ** 2 + (z + t * dz) ** 2 < .88;
}

function nestWaypoint(body, target) {
  if (!crossesNest(body, target)) { body.ringRoute = null; return target; }
  const current = body.ringRoute;
  if (current && Math.hypot(body.x - current.x, body.z - current.z) > .38) return current;
  let choice = null, score = Infinity;
  for (const waypoint of ring) {
    if (crossesNest(body, waypoint)) continue;
    const distance = Math.hypot(body.x - waypoint.x, body.z - waypoint.z);
    if (distance < .42) continue;
    const blocked = crossesNest(waypoint, target);
    const cost = distance + Math.hypot(waypoint.x - target.x, waypoint.z - target.z) + (blocked ? 5.2 : 0);
    if (cost < score) { score = cost; choice = waypoint; }
  }
  body.ringRoute = choice;
  return choice ?? target;
}

// Ellipsoids fitted separately to the head, mouth, thorax, waist and gaster.
const form = [
  { part: 'head', x: .94, y: .75, a: .446, b: .285, c: .322 },
  { part: 'head', x: 1.38, y: .60, a: .175, b: .128, c: .183 },
  { part: 'body', x: .12, y: .746, a: .491, b: .239, c: .249 },
  { part: 'body', x: -.345, y: .664, a: .284, b: .192, c: .191 },
  { part: 'body', x: -.762, y: .666, a: .307, b: .166, c: .137 },
  { part: 'gaster', x: -1.422, y: .574, a: .535, b: .345, c: .352 },
  { part: 'gaster', x: -1.824, y: .447, a: .236, b: .197, c: .224 },
];

export function bodyShells(body, ground, x = body.x, z = body.z, heading = body.heading, lift = body.lift ?? 0, target = []) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const scale = body.queen ? 1.67 : 1;
  const base = ground(x, z) + lift;
  for (const [i, lobe] of form.entries()) {
    const rear = body.queen && lobe.part === 'gaster';
    const offset = scale * (rear ? -1.024 + (lobe.x + 1.024) * 1.34 : lobe.x);
    const shape = target[i] ?? (target[i] = {});
    const segments = body.body?.joints;
    const front = lobe.part === 'head', gaster = lobe.part === 'gaster';
    const flexYaw = segments ? front ? segments.headYaw : gaster ? segments.waistYaw + segments.postYaw + segments.gasterYaw : 0 : 0;
    const flexPitch = segments ? front ? segments.headPitch + .19
      : gaster ? segments.waistPitch + segments.postPitch + segments.gasterPitch - .14 : 0 : 0;
    const pivot = front ? .585 : gaster ? -.86 : offset;
    const arm = offset - pivot;
    const turnCos = flexYaw ? Math.cos(heading + flexYaw) : cos;
    const turnSin = flexYaw ? Math.sin(heading + flexYaw) : sin;
    const reach = arm * Math.cos(flexPitch);
    shape.x = x + cos * pivot + turnCos * reach;
    shape.z = z - sin * pivot - turnSin * reach;
    shape.y = base + scale * lobe.y * (rear ? .992 : 1) + arm * Math.sin(flexPitch);
    shape.a = lobe.a * scale * (rear ? 1.34 : 1);
    shape.b = lobe.b * scale * (rear ? 1.19 : 1);
    shape.c = lobe.c * scale * (rear ? 1.28 : 1);
    shape.cos = turnCos;
    shape.sin = turnSin;
  }
  return target;
}

function support(shell, x, y, z) {
  const u = (x * shell.cos - z * shell.sin) * shell.a;
  const v = (x * shell.sin + z * shell.cos) * shell.c;
  return Math.sqrt(u * u + v * v + (y * shell.b) ** 2);
}

export function shellsOverlap(a, b) {
  for (const lobe of a) {
    for (const other of b) {
      const x = lobe.x - other.x, y = lobe.y - other.y, z = lobe.z - other.z;
      if (Math.abs(y) >= lobe.b + other.b - .012) continue;
      const reach = Math.max(lobe.a, lobe.c) + Math.max(other.a, other.c);
      const horizontal = x * x + z * z;
      if (horizontal > reach * reach) continue;
      const distance = Math.sqrt(horizontal + y * y);
      if (distance < .001 || distance * (distance + .011) < support(lobe, x, y, z) + support(other, x, y, z)) return true;
    }
  }
  return false;
}

export function shellRoof(shape, x, z, margin = 0) {
  const xx = x - shape.x, zz = z - shape.z;
  const a = (xx * shape.cos - zz * shape.sin) / (shape.a + margin);
  const c = (xx * shape.sin + zz * shape.cos) / (shape.c + margin);
  const rest = 1 - a * a - c * c;
  return rest < 0 ? -Infinity : shape.y + Math.sqrt(rest) * (shape.b + margin);
}

export function segmentBlocked(shapes, from, to, radius = .03) {
  const lowX = Math.min(from.x, to.x), highX = Math.max(from.x, to.x);
  const lowY = Math.min(from.y, to.y), highY = Math.max(from.y, to.y);
  const lowZ = Math.min(from.z, to.z), highZ = Math.max(from.z, to.z);
  for (const shape of shapes) {
    const horizontal = Math.max(shape.a, shape.c) + radius;
    const vertical = shape.b + radius;
    if (shape.x < lowX - horizontal || shape.x > highX + horizontal ||
        shape.z < lowZ - horizontal || shape.z > highZ + horizontal ||
        shape.y < lowY - vertical || shape.y > highY + vertical) continue;
    const dx = from.x - shape.x, dz = from.z - shape.z;
    const vx = to.x - from.x, vz = to.z - from.z;
    const ax = shape.a + radius, by = shape.b + radius, cz = shape.c + radius;
    const u = (dx * shape.cos - dz * shape.sin) / ax;
    const v = (from.y - shape.y) / by;
    const w = (dx * shape.sin + dz * shape.cos) / cz;
    const du = (vx * shape.cos - vz * shape.sin) / ax;
    const dv = (to.y - from.y) / by;
    const dw = (vx * shape.sin + vz * shape.cos) / cz;
    const denominator = du * du + dv * dv + dw * dw;
    const t = denominator > 0 ? limit(-(u * du + v * dv + w * dw) / denominator, 0, 1) : 0;
    if ((u + du * t) ** 2 + (v + dv * t) ** 2 + (w + dw * t) ** 2 < 1) return true;
  }
  return false;
}

export function segmentReach(shapes, from, to, radius = .03) {
  let result = 1;
  for (const shape of shapes) {
    const dx = from.x - shape.x, dz = from.z - shape.z;
    const vx = to.x - from.x, vz = to.z - from.z;
    const ax = shape.a + radius, by = shape.b + radius, cz = shape.c + radius;
    const x = (dx * shape.cos - dz * shape.sin) / ax;
    const y = (from.y - shape.y) / by;
    const z = (dx * shape.sin + dz * shape.cos) / cz;
    const u = (vx * shape.cos - vz * shape.sin) / ax;
    const v = (to.y - from.y) / by;
    const w = (vx * shape.sin + vz * shape.cos) / cz;
    const a = u * u + v * v + w * w;
    const b = x * u + y * v + z * w;
    const c = x * x + y * y + z * z - 1;
    const root = b * b - a * c;
    if (c <= 0) return 0;
    if (root < 0 || a < 1e-9) continue;
    const entry = (-b - Math.sqrt(root)) / a;
    if (entry >= 0) result = Math.min(result, entry);
  }
  return result;
}

export class BodySpace {
  constructor(ground) {
    this.ground = ground;
    this.cells = new Map();
    this.bodies = new Map();
    this.preview = [];
  }

  rebuild(queen, workers) {
    this.cells.clear();
    const present = new Set(workers);
    if (queen.living !== false) present.add(queen);
    for (const actor of this.bodies.keys()) if (!present.has(actor)) this.bodies.delete(actor);
    for (const body of present) this.record(body);
  }

  record(body) {
    const key = cellKey(cell(body.x), cell(body.z));
    let entry = this.bodies.get(body);
    if (!entry) {
      entry = { body, lobes: [], key: '' };
      this.bodies.set(body, entry);
    }
    if (entry.key !== key) this.cells.get(entry.key)?.delete(entry);
    if (!this.cells.has(key)) this.cells.set(key, new Set());
    this.cells.get(key).add(entry);
    entry.key = key;
    bodyShells(body, this.ground, body.x, body.z, body.heading, body.lift ?? 0, entry.lobes);
  }

  near(body, range = 4.35) {
    const found = [];
    const extent = range + 1.55;
    for (let x = cell(body.x - extent); x <= cell(body.x + extent); x++) {
      for (let z = cell(body.z - extent); z <= cell(body.z + extent); z++) {
        for (const entry of this.cells.get(cellKey(x, z)) ?? []) {
          const other = entry.body;
          const radius = other.queen ? range + 1.55 : range;
          if (other !== body && (body.x - other.x) ** 2 + (body.z - other.z) ** 2 <= radius ** 2) found.push(entry);
        }
      }
    }
    return found;
  }

  clear(body, x, z, heading, lift, nearby) {
    if (!nearby.length) return true;
    const shell = bodyShells(body, this.ground, x, z, heading, lift, this.preview);
    for (const other of nearby) if (shellsOverlap(shell, other.lobes)) return false;
    return true;
  }

  place(body, heading) {
    const x = body.x, z = body.z;
    const nearby = this.near(body, 7);
    for (let ring = 0; ring <= 7; ring++) {
      const steps = ring ? 12 : 1;
      for (let i = 0; i < steps; i++) {
        const direction = heading + i * Math.PI * 2 / steps + ring * .29;
        const px = x + Math.cos(direction) * ring * .54, pz = z - Math.sin(direction) * ring * .54;
        if (this.clear(body, px, pz, direction, 0, nearby)) return { x: px, z: pz, heading: direction };
      }
    }
    return null;
  }

  move(body, bearing, pace, dt, destination, allowClimb) {
    const nearby = this.near(body);
    const { x, z, heading } = body;
    const waypoint = nestWaypoint(body, destination);
    if (waypoint !== destination) bearing = Math.atan2(z - waypoint.z, waypoint.x - x);
    let lift = body.lift ?? 0;
    const approach = (a, b, response) => a + (b - a) * (1 - Math.exp(-response * dt));
    const clean = (h, distance, rise = lift) =>
      this.clear(body, x + Math.cos(h) * distance, z - Math.sin(h) * distance, h, rise, nearby);
    const limitTurn = angle => heading + limit(angleTo(heading, angle) * 3.3, -2.05, 2.05) * dt;
    if (body.escape?.remaining > 0) {
      if (this.retreat(body, body.escape.direction, lift, dt, nearby)) {
        body.escape.remaining -= dt;
        return;
      }
      body.escape = null;
    }
    const climbable = allowClimb && nearby.some(entry => !entry.body.queen &&
      entry.body.speed < .62 && (entry.body.x - x) ** 2 + (entry.body.z - z) ** 2 < 2.85 ** 2);
    if (lift > 0) {
      const lower = Math.max(0, lift - .78 * dt);
      if (clean(heading, 0, lower)) lift = lower;
    }
    const horizon = .38 + pace * .10;
    const clearAhead = clean(bearing, horizon);
    let chosen = bearing;
    if (!clearAhead) {
      const prior = body.bypass;
      if (prior !== undefined && clean(prior, horizon * .73)) chosen = prior;
      else {
        let nearest = Infinity;
        for (const offset of turnOptions.slice(1)) {
          const alternative = bearing + offset;
          const turn = limitTurn(alternative);
          if (!clean(turn, 0) || !clean(alternative, horizon)) continue;
          const progress = Math.cos(alternative) * (destination.x - x) - Math.sin(alternative) * (destination.z - z);
          const score = .8 * Math.abs(offset) + .31 * Math.abs(angleTo(heading, alternative)) - .06 * progress
            + (offset > 0 ? .08 : 0);
          if (score < nearest) { nearest = score; chosen = alternative; }
        }
        body.bypass = chosen === bearing ? undefined : chosen;
      }
    } else if (body.bypass !== undefined && Math.abs(angleTo(bearing, heading)) < .38) {
      body.bypass = undefined;
    }

    let nextHeading = limitTurn(chosen);
    if (!clean(nextHeading, 0)) nextHeading = heading;
    const alignment = Math.max(0, Math.cos(angleTo(nextHeading, chosen))) ** 2;
    let speed = approach(body.speed, pace * alignment * (lift > .13 ? .56 : 1), 6.2);
    let step = speed * dt;
    while (step > .009 && (!clean(nextHeading, step) || !clean(nextHeading, step * .5))) step *= .5;
    if (step <= .009) step = speed = 0;
    const halted = step < .014 && Math.abs(angleTo(heading, nextHeading)) < .018;
    body.blocked = halted ? (body.blocked ?? 0) + dt : 0;
    if (body.blocked >= .2) {
      const raised = Math.min(.72, lift + 1.05 * dt);
      if (climbable && body.blocked > .54 && clean(heading, 0, raised) && clean(bearing, horizon, .72)) {
        lift = raised;
      } else {
        // Increase turning room with a short backward or lateral step.
        const obstruction = nearby.reduce((nearest, entry) => {
          if (!nearest) return entry;
          const distance = other => Math.hypot(x - other.body.x, z - other.body.z) - (other.body.queen ? 1.25 : 0);
          return distance(entry) < distance(nearest) ? entry : nearest;
        }, null);
        const away = obstruction ? Math.atan2(obstruction.body.z - z, x - obstruction.body.x) : heading + Math.PI;
        for (const direction of [away, away - .72, away + .72, heading + Math.PI, heading - 1.57, heading + 1.57]) {
          if (!this.retreat(body, direction, lift, dt, nearby)) continue;
          body.escape = { direction, remaining: .90 };
          body.bypass = bearing - .95;
          body.ringRoute = null;
          return;
        }
      }
    }
    body.x = x + Math.cos(nextHeading) * step;
    body.z = z - Math.sin(nextHeading) * step;
    body.heading = nextHeading;
    body.speed = step / dt;
    body.turn = angleTo(heading, nextHeading) / dt;
    body.lift = lift;
    this.record(body);
  }

  retreat(body, direction, lift, dt, nearby) {
    const step = .72 * dt;
    const nx = body.x + Math.cos(direction) * step, nz = body.z - Math.sin(direction) * step;
    if (!this.clear(body, nx, nz, body.heading, lift, nearby)) return false;
    body.x = nx;
    body.z = nz;
    body.speed = .72;
    body.turn = 0;
    body.lift = lift;
    this.record(body);
    return true;
  }
}
