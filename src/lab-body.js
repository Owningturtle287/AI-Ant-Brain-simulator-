import { legTypes } from './motion.js';
import { segmentBlocked } from './body-space.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rad = Math.PI / 180;
const legs = [-1, 1].flatMap(side => legTypes.map((type, i) => ({ type, side, i })));
export const bodyAxes = [
  ['headYaw', 0, 37.5], ['headPitch', -.19, 38], ['headRoll', 0, 20],
  ['waistYaw', 0, 12.5], ['waistPitch', .02, 26], ['postYaw', 0, 12.5], ['postPitch', .02, 24],
  ['gasterYaw', 0, 10], ['gasterPitch', .10, 26], ['gasterRoll', 0, 22],
];
const jointRange = [
  [35, 40, 55], [40, 50, 52.5], [20, 27.5, 52.5],
  [55, 43, 45], [49, 57, 47], [66, 69, 77], [60, 63, 58], [44, 44, 44],
];

// The resting geometry and joint limits describe an exoskeleton. Angles
// within the limits come from the policy, including the motion of each foot.
function pointsFor(leg, angles, lift = 0) {
  const { type, side, i } = leg;
  const [sweep, drop, roll, trochanter, femur, knee, ankle, tarsi] = angles;
  const yaw = [.84, 1.57, 2.26][i] + sweep;
  const chain = [{ x: type.x, y: type.y, z: side * type.socket }];
  const extend = (length, pitch, turn = 0) => {
    const p = chain.at(-1), stretch = length * Math.cos(pitch);
    chain.push({ x: p.x + stretch * Math.cos(yaw + turn), y: p.y + length * Math.sin(pitch),
      z: p.z + side * stretch * Math.sin(yaw + turn) });
  };
  const upper = .20 + drop * .6 + trochanter * .4 + femur + lift;
  const lower = clamp(upper - 1.31 + knee, -1.62, .45);
  extend(.165, -.89 + drop, roll * .62);
  extend(.072, -.32 + drop + trochanter, roll * .48);
  extend(type.upper, upper, roll * .43);
  extend(type.lower, lower, roll * .27);
  for (const [index, portion] of [.37, .19, .16, .14, .14].entries()) {
    extend(type.foot * portion, clamp(-.37 + ankle + (lower + 1.11) * .62 + tarsi * index * .25, -1.48, .80));
  }
  return chain;
}

function orient(points, ant) {
  const a = Math.cos(ant.roll), b = Math.sin(ant.roll), c = Math.cos(ant.pitch), d = Math.sin(ant.pitch);
  const cos = Math.cos(ant.heading), sin = Math.sin(ant.heading);
  return points.map(({ x, y, z }) => {
    const pitchedX = x * c - y * d, pitchedY = y * c + x * d;
    const rolledZ = z * a + pitchedY * b;
    return { x: pitchedX * cos + rolledZ * sin, y: pitchedY * a - z * b, z: -pitchedX * sin + rolledZ * cos };
  });
}

export function labBody() {
  return {
    height: .68, pitch: 0, roll: 0, clearance: 0, jaw: 0, clock: 0, activity: 0,
    legs: legs.map(leg => ({ ...leg, angles: new Float32Array(8), ground: false, points: [], last: null })),
    joints: Object.fromEntries(bodyAxes.map(([key, neutral]) => [key, neutral])),
    antennae: [-1, 1].map(() => new Float32Array(12)),
  };
}

export function driveBody(ant, commands, ground, space, dt) {
  const body = ant.body;
  const nearby = space.near(ant);
  const obstacleShells = nearby.flatMap(entry => entry.lobes);
  let effort = 0;
  const follow = 1 - Math.exp(-12 * dt);
  for (const [index, leg] of body.legs.entries()) {
    for (let j = 0; j < 8; j++) {
      const target = commands[index * 8 + j] * jointRange[j][leg.i] * rad;
      const delta = (target - leg.angles[j]) * follow;
      leg.angles[j] += delta;
      effort += Math.abs(delta);
    }
    leg.local = orient(pointsFor(leg, leg.angles), { heading: ant.heading, roll: body.roll, pitch: body.pitch });
  }
  const lastJoints = nearby.length ? { ...body.joints } : null;
  for (const [i, [key, neutral, span]] of bodyAxes.entries()) {
    const cap = span * rad;
    body.joints[key] += (neutral + commands[48 + i] * cap - body.joints[key]) * follow;
  }
  for (const [i, antenna] of body.antennae.entries()) {
    for (let j = 0; j < antenna.length; j++) antenna[j] += (commands[58 + i * 12 + j] - antenna[j]) * follow;
  }
  const bottom = ground(ant.x, ant.z);
  const support = body.legs.map(leg => {
    const tip = leg.local.at(-1);
    return ground(ant.x + tip.x, ant.z + tip.z) - tip.y + .025;
  });
  const sorted = [...support].sort((a, b) => b - a);
  const ideal = clamp(sorted[2], bottom + .39, bottom + 1.15);
  body.height += (ideal - body.height) * Math.min(1, dt * 13);
  if (nearby.length && !space.clear(ant, ant.x, ant.z, ant.heading, body.height - bottom - .675, nearby)) {
    body.height = bottom + .675 + ant.lift;
    body.joints = lastJoints;
  }
  const elevation = body.height;
  const bendLeg = (leg, required) => {
    if (required <= .038) return leg.local;
    const articulate = flex => orient(pointsFor(leg, leg.angles, flex),
      { heading: ant.heading, roll: body.roll, pitch: body.pitch });
    // Passive joint compliance under ground load.
    let lower = 0, upper = Math.min(.57, required * 2);
    for (let j = 0; j < 4; j++) {
      const middle = (lower + upper) * .5;
      const tip = articulate(middle).at(-1);
      const floor = ground(ant.x + tip.x, ant.z + tip.z) + .025;
      if (tip.y + elevation < floor) lower = middle;
      else upper = middle;
    }
    return articulate(upper);
  };

  const yawDelta = ant.heading - (body.lastHeading ?? ant.heading);
  const yawCos = Math.cos(yawDelta), yawSin = Math.sin(yawDelta);
  body.lastHeading = ant.heading;
  let xForce = 0, zForce = 0, twist = 0, contactCount = 0, planted = 0;
  let fore = 0, flank = 0;
  for (const [i, leg] of body.legs.entries()) {
    const chain = bendLeg(leg, support[i] - elevation);
    const tip = chain.at(-1);
    leg.pose = chain;
    const knee = chain[3], ankle = chain[4];
    const absolute = point => ({ x: ant.x + point.x, y: elevation + point.y, z: ant.z + point.z });
    const blocked = obstacleShells.length && (segmentBlocked(obstacleShells, absolute(knee), absolute(ankle), .055) ||
      segmentBlocked(obstacleShells, absolute(ankle), absolute(tip), .038));
    const onFloor = elevation + tip.y <= ground(ant.x + tip.x, ant.z + tip.z) + .084 && !blocked;
    if (onFloor) {
      planted++;
      fore += leg.type.x;
      flank += leg.side;
      if (leg.last && leg.ground) {
        const fx = leg.last.x * yawCos + leg.last.z * yawSin - tip.x;
        const fz = -leg.last.x * yawSin + leg.last.z * yawCos - tip.z;
        xForce += fx;
        zForce += fz;
        twist += (tip.z * fx - tip.x * fz) / Math.max(.56, tip.x ** 2 + tip.z ** 2);
        contactCount++;
      }
    }
    leg.ground = onFloor;
    leg.last = tip;
  }

  const friction = 1 / Math.max(2.1, contactCount);
  const dx = clamp(xForce * friction, -3.6 * dt, 3.6 * dt);
  const dz = clamp(zForce * friction, -3.6 * dt, 3.6 * dt);
  const turn = clamp(twist * friction * .89, -2.5 * dt, 2.5 * dt);
  const previousHeading = ant.heading;
  const frameLift = elevation - bottom - .675;
  if (space.clear(ant, ant.x + dx, ant.z + dz, ant.heading + turn, frameLift, nearby)) {
    ant.x += dx;
    ant.z += dz;
    ant.heading += turn;
    ant.speed += (Math.hypot(dx, dz) / dt - ant.speed) * .38;
  } else {
    ant.speed *= .5;
  }
  ant.turn = (ant.heading - previousHeading) / dt;
  ant.lift = frameLift;
  body.pitch += (clamp(-fore * .055, -.16, .16) - body.pitch) * dt * 4;
  body.roll += (clamp(flank * .048, -.19, .19) - body.roll) * dt * 4;
  for (const leg of body.legs) {
    leg.points = leg.pose.map(point => ({ x: ant.x + point.x, y: elevation + point.y, z: ant.z + point.z }));
    const tip = leg.points.at(-1);
    const floor = ground(tip.x, tip.z) + .018;
    tip.y = Math.max(floor, tip.y);
  }
  body.clock += dt;
  body.activity = effort;
  return { planted, effort };
}
