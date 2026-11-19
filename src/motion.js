export const mm = 1;
export const arenaLimit = 6.6;
export const bodyLength = 3.5;

export const legTypes = [
  { name: 'Front', x: .329, socket: .165, spread: .87, reach: 1.03, upper: .53, lower: .52, foot: .25 },
  { name: 'Middle', x: -.022, socket: .161, spread: 1.11, reach: -.025, upper: .58, lower: .54, foot: .27 },
  { name: 'Rear', x: -.411, socket: .151, spread: .94, reach: -1.20, upper: .70, lower: .72, foot: .34 },
];

export const gravelHills = [
  [-3.0, -1.15, .82, .29],
  [-1.45, 1.65, .76, .36],
  [1.8, -.35, .82, .32],
  [3.8, -.95, 1.05, .40],
  [2.5, 2.45, .96, .32],
  [-4.1, 3.1, 1.08, .27],
  [-.6, -3.6, .92, .29],
];

const twoPi = Math.PI * 2;
const stanceFraction = .60;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (from, to, weight) => from + (to - from) * weight;
const smooth = weight => weight * weight * (3 - 2 * weight);
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function terrainHeight(terrain, x, z) {
  const grain = .009 * Math.sin(10 * x + 3 * z) * Math.cos(12 * z - 2 * x);
  if (terrain === 'tunnel') {
    const channel = z - .30 * Math.sin(x * .55);
    const bank = smooth(clamp((Math.abs(channel) - .82) / 1.35, 0, 1));
    return grain + bank * (1.08 + .12 * Math.sin(x * 2.1)) + .031 * Math.cos(x * 3.4 + z * .8);
  }
  if (terrain === 'gravel') {
    let height = grain + .022 * Math.sin(3.8 * x + 1.4 * z) * Math.cos(4.8 * z);
    for (const [centerX, centerZ, radius, peak] of gravelHills) {
      const normalized = Math.hypot(x - centerX, z - centerZ) / radius;
      height += peak * (1 - smooth(clamp(normalized, 0, 1)));
    }
    return height;
  }
  return grain + .016 * Math.sin(x * 1.7) * Math.sin(z * 1.9);
}

const routes = {
  loam: [[2.5, -.8], [3.8, -2.5], [.2, -3.55], [-3.3, -2.8], [-3.85, .9], [-1.45, 3.1], [2.2, 2.4]],
  gravel: [[2.9, -.65], [4.05, -2.3], [.3, -3.7], [-3.1, -1.6], [-3.8, 1.5], [-.8, 2.5], [2.7, 2.0]],
  tunnel: [[4.65, .18], [5.55, .65], [4.65, -.45], [1.3, -.23], [-4.8, -.18], [-5.55, .42], [-4.65, .5]],
};

export class AntMotion {
  constructor(terrain = 'loam') {
    this.terrain = terrain;
    this.reset();
  }

  reset() {
    this.x = 0;
    this.z = 0;
    this.heading = .12;
    this.stride = 0;
    this.clock = 0;
    this.speed = 0;
    this.distance = 0;
    this.routeIndex = 0;
    this.destination = null;
    this.manual = null;
    this.legs = [];
    for (const side of [-1, 1]) {
      for (const [index, type] of legTypes.entries()) {
        const foot = this.footRest(type, side, 0);
        this.legs.push({
          type, side, phase: (index + (side === 1 ? 1 : 0)) % 2 / 2,
          ...foot, fromX: foot.x, fromZ: foot.z, toX: foot.x, toZ: foot.z, swinging: false,
        });
      }
    }
  }

  steerTo(x, z) {
    this.destination = [
      clamp(x, -arenaLimit, arenaLimit),
      clamp(z, -arenaLimit, arenaLimit),
    ];
  }

  footRest(type, side, lead) {
    const forward = type.reach + lead;
    const outward = type.spread * side;
    const cosine = Math.cos(this.heading);
    const sine = Math.sin(this.heading);
    const x = this.x + forward * cosine + outward * sine;
    const z = this.z - forward * sine + outward * cosine;
    return { x, z, y: terrainHeight(this.terrain, x, z) + .022 };
  }

  step(dt) {
    this.clock += dt;
    const route = routes[this.terrain];
    const [targetX, targetZ] = this.destination ?? route[this.routeIndex];
    const gap = Math.hypot(targetX - this.x, targetZ - this.z);
    let desiredHeading = Math.atan2(this.z - targetZ, targetX - this.x);
    let desiredSpeed = 2.45;
    if (this.manual) {
      desiredHeading = Math.atan2(-this.manual[1], this.manual[0]);
      desiredSpeed = 2.8;
    } else if (gap < .23) {
      if (!this.destination) this.routeIndex = (this.routeIndex + 1) % route.length;
      desiredHeading = this.heading;
      desiredSpeed = 0;
    } else if (this.destination) {
      desiredSpeed *= clamp(gap / .85, .28, 1);
    }

    const turn = angleDelta(this.heading, desiredHeading);
    this.heading += clamp(turn, -3.5 * dt, 3.5 * dt);
    this.speed = mix(this.speed, desiredSpeed * Math.max(.47, Math.cos(turn)), 1 - Math.exp(-8 * dt));
    const strideDistance = this.speed * dt;
    const nextX = clamp(this.x + Math.cos(this.heading) * strideDistance, -arenaLimit, arenaLimit);
    const nextZ = clamp(this.z - Math.sin(this.heading) * strideDistance, -arenaLimit, arenaLimit);
    this.distance += Math.hypot(nextX - this.x, nextZ - this.z);
    this.x = nextX;
    this.z = nextZ;
    if (this.speed < .025 && !this.legs.some(leg => leg.swinging)) return;
    const inMotion = this.speed > .055;
    const frequency = Math.max(1.6, this.speed * 1.19);
    this.stride += frequency * dt;
    const lead = inMotion ? .55 * this.speed / frequency : 0;

    for (const leg of this.legs) {
      const phase = (this.stride + leg.phase) % 1;
      if (phase < stanceFraction || (!inMotion && !leg.swinging)) {
        if (leg.swinging) {
          leg.x = leg.toX;
          leg.z = leg.toZ;
          leg.y = terrainHeight(this.terrain, leg.x, leg.z) + .022;
        }
        leg.swinging = false;
        continue;
      }
      if (!leg.swinging) {
        leg.fromX = leg.x;
        leg.fromZ = leg.z;
        const next = this.footRest(leg.type, leg.side, lead);
        leg.toX = next.x;
        leg.toZ = next.z;
        leg.swinging = true;
      }
      const progress = clamp((phase - stanceFraction) / (1 - stanceFraction), 0, 1);
      leg.x = mix(leg.fromX, leg.toX, smooth(progress));
      leg.z = mix(leg.fromZ, leg.toZ, smooth(progress));
      const lift = this.terrain === 'gravel' ? .21 : .145;
      leg.y = terrainHeight(this.terrain, leg.x, leg.z) + .022 + lift * Math.sin(Math.PI * progress) ** 1.2;
    }
  }

  bodyPose() {
    const cosine = Math.cos(this.heading);
    const sine = Math.sin(this.heading);
    const front = terrainHeight(this.terrain, this.x + cosine * .55, this.z - sine * .55);
    const rear = terrainHeight(this.terrain, this.x - cosine * .55, this.z + sine * .55);
    const right = terrainHeight(this.terrain, this.x + sine * .53, this.z + cosine * .53);
    const left = terrainHeight(this.terrain, this.x - sine * .53, this.z - cosine * .53);
    const activity = Math.min(1, this.speed / 2.45);
    const stepWave = this.stride * twoPi;
    return {
      height: .502 + (front + rear + right + left) * .25 + Math.cos(stepWave * 2) * .012 * activity,
      pitch: Math.atan2(front - rear, 1.1) + Math.sin(stepWave) * .013 * activity,
      roll: Math.atan2(left - right, 1.06) + Math.cos(stepWave) * .027 * activity,
    };
  }
}
