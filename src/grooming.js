import { segmentBlocked } from './body-space.js';

const patch = (name, kind, leg, x, y, z) => ({ name, kind, leg, x, y, z });

export const groomZones = {
  leftAntenna: patch('Left antenna', 'antenna', 0, .97, .69, -.37),
  rightAntenna: patch('Right antenna', 'antenna', 3, .97, .69, .37),
  head: patch('Head', 'shell', 0, .78, .78, -.31),
  thorax: patch('Thorax', 'shell', 1, .12, .60, -.27),
  abdomen: patch('Abdomen', 'shell', 2, -1.31, .59, -.34),
  leftFront: patch('Left front leg', 'leg', 0, 1.01, .54, -.32),
  leftMiddle: patch('Left middle leg', 'leg', 0, .18, .31, -.73),
  leftRear: patch('Left rear leg', 'leg', 1, -.52, .34, -.65),
  rightFront: patch('Right front leg', 'leg', 3, 1.01, .54, .32),
  rightMiddle: patch('Right middle leg', 'leg', 3, .18, .31, .73),
  rightRear: patch('Right rear leg', 'leg', 4, -.52, .34, .65),
};

export const groomingActions = Object.entries(groomZones).map(([key, zone]) => ({
  key, zone, action: 'groom:' + key,
}));
const parts = groomingActions.map(item => item.key);
const ownFeet = ['leftFront', 'leftMiddle', 'leftRear', 'rightFront', 'rightMiddle', 'rightRear'];
const bound = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);

export function freshGrime() {
  return Object.fromEntries(parts.map((part, index) => [part, index === 2 ? .055 : .02]));
}

export function inheritReach(parent, mutation, random) {
  return Object.fromEntries(parts.map(part => {
    const prior = Number.isFinite(parent?.[part]) ? parent[part] : 0;
    const change = mutation ? (random() - random()) * mutation * .58 : 0;
    return [part, Math.max(-1, Math.min(1, prior + change))];
  }));
}

export function addGrime(worker, part, amount) {
  worker.grime[part] = bound(worker.grime[part] + amount);
}

export function pickUpGrime(worker, ground, time, dt) {
  const travel = worker.speed * dt;
  const cos = Math.cos(worker.heading), sin = Math.sin(worker.heading);
  for (const [index, key] of ownFeet.entries()) {
    const side = index < 3 ? -1 : 1;
    const ahead = [1.02, -.01, -1.17][index % 3];
    const sideOffset = side * [.76, .95, .83][index % 3];
    const x = worker.x + ahead * cos + sideOffset * sin;
    const z = worker.z - ahead * sin + sideOffset * cos;
    const texture = .46 + .49 * Math.sin(x * .97 - z * .23) * Math.cos(z * .76 + .41 * x);
    const contact = Math.sin(time * (8.2 + worker.speed) + (index + Number(index > 2)) * Math.PI) > 0 ? 1 : .68;
    const climb = worker.lift > .15 ? .35 : 1;
    addGrime(worker, key, dt * .0009 + travel * (.006 + texture * .026) * contact * climb);
    if (index % 3 === 0) addGrime(worker, side < 0 ? 'leftAntenna' : 'rightAntenna', travel * (.0018 + texture * .004));
  }
  const debris = Math.abs(ground(worker.x + .46, worker.z) - ground(worker.x - .46, worker.z));
  addGrime(worker, 'head', dt * .0006 + travel * .0042);
  addGrime(worker, 'thorax', dt * .00035 + travel * (.0024 + debris * .019));
  addGrime(worker, 'abdomen', dt * .00045 + travel * (.0033 + debris * .016));
}

export function beginGroom(worker, key, trial, time) {
  const zone = groomZones[key];
  const dirty = worker.grime[key];
  const learned = worker.groomSkill[key];
  return {
    key, zone, start: time, level: dirty, trial, bias: learned, contact: 0, removed: 0,
    side: zone.kind === 'shell' && trial > 0 ? 1 : Math.sign(zone.z),
    duration: 1.21 + dirty * .87,
  };
}

export function groomPose(groom, time) {
  const { zone, side, duration, start, trial, bias } = groom;
  const progress = bound((time - start) / duration);
  const reach = smooth(bound(progress / .29)) * smooth(bound((1 - progress) / .21));
  const strokes = Math.sin(progress * Math.PI * 8);
  // The foot follows a local contact target. Its initial alignment comes from
  // a heritable calibration, with small exploration on each new attempt.
  const offset = bias + trial;
  const x = zone.x + offset * .18 + strokes * .063 * reach;
  const y = zone.y + offset * .12 + Math.cos(progress * Math.PI * 8) * .031 * reach;
  const z = side * (Math.abs(zone.z) + .078 * offset);
  const leg = zone.kind === 'shell' && side > 0 ? zone.leg + 3 : zone.leg;
  return { leg, part: groom.key, kind: zone.kind, x, y, z, reach, side, progress };
}

export function scrubGroom(worker, time, dt, obstacles = [], terrain) {
  const state = worker.grooming;
  const pose = groomPose(state, time);
  const { zone, side } = state;
  const anchorX = [ .34, -.05, -.43 ][pose.leg % 3];
  const anchorY = [.50, .42, .38][pose.leg % 3];
  const anchorZ = side * .20;
  const distance = Math.hypot(pose.x - anchorX, pose.y - anchorY, pose.z - anchorZ);
  const maxReach = [1.08, 1.14, 1.39][pose.leg % 3];
  // Reward only actual contact with the intended patch, within the limb’s working reach.
  const miss = Math.hypot(pose.x - zone.x, pose.y - zone.y, Math.abs(pose.z) - Math.abs(zone.z));
  let contact = pose.reach > .8 && distance < maxReach && miss < .124 ? 1 - miss / .15 : 0;
  if (contact && obstacles.length) {
    const cos = Math.cos(worker.heading), sin = Math.sin(worker.heading);
    const ground = terrain(worker.x, worker.z) + worker.lift;
    const world = (x, y, z) => ({ x: worker.x + x * cos + z * sin, y: ground + y, z: worker.z - x * sin + z * cos });
    if (segmentBlocked(obstacles, world(anchorX, anchorY, anchorZ), world(pose.x, pose.y, pose.z))) contact = 0;
  }
  const removed = Math.min(worker.grime[state.key], contact * dt * .70);
  addGrime(worker, state.key, -removed);
  state.removed += removed;
  state.contact += contact * dt;
  return pose.progress;
}

export function completeGroom(worker, learning) {
  const groom = worker.grooming;
  if (learning && groom.level > .03) {
    const effectiveness = Math.min(1, groom.removed / groom.level);
    const update = (effectiveness - .56) * groom.trial * .28;
    worker.groomSkill[groom.key] = Math.max(-1, Math.min(1, groom.bias + update));
  }
  worker.grooming = null;
  return groom.removed * 3.35 - (groom.contact < .10 ? .28 : 0);
}
