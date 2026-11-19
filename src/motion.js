export const mm = 1;
export const arenaLimit = 6.6;
export const bodyLength = 3.5;

export const legTypes = [
  { name: 'Front', x: .306, y: -.027, socket: .157, coxaSweep: -.103, coxaDrop: .150, kneeRise: .92, kneeSpread: .39, spread: .86, reach: 1.02, upper: .53, lower: .52, foot: .25 },
  { name: 'Middle', x: -.046, y: -.151, socket: .139, coxaSweep: -.015, coxaDrop: .121, kneeRise: .77, kneeSpread: -.64, spread: 1.09, reach: -.015, upper: .58, lower: .54, foot: .27 },
  { name: 'Rear', x: -.423, y: -.160, socket: .129, coxaSweep: -.031, coxaDrop: .108, kneeRise: .48, kneeSpread: -.88, spread: .94, reach: -1.17, upper: .70, lower: .72, foot: .34 },
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

const neutralPose = () => ({ height: .528, pitch: 0, roll: 0 });
const neutralJoints = () => ({ headYaw: 0, headPitch: -.24, waistYaw: 0, waistPitch: .036, gasterYaw: 0, gasterPitch: .016, gasterRoll: 0 });
const footClearance = .022;
const stanceTime = .64;
const maximumYawRate = 2.58;
const approach = (current, target, response, dt) => mix(current, target, 1 - Math.exp(-response * dt));
const easeStep = t => t * t * t * (10 + t * (-15 + 6 * t));

export class AntMotion {
  constructor(terrain = 'loam') {
    this.terrain = terrain;
    this.reset();
  }

  reset() {
    this.x = 0;
    this.z = 0;
    this.heading = .12;
    this.yawRate = 0;
    this.stride = 0;
    this.clock = 0;
    this.speed = 0;
    this.distance = 0;
    this.arrived = false;
    this.routeIndex = 0;
    this.destination = null;
    this.manual = null;
    this.pose = neutralPose();
    this.joints = neutralJoints();
    this.legs = [];
    for (const side of [-1, 1]) {
      for (const [index, type] of legTypes.entries()) {
        const foot = this.footRest(type, side);
        this.legs.push({
          type, side, phase: (index + (side === 1 ? 1 : 0)) % 2 / 2 + index * .022,
          ...foot, fromX: foot.x, fromY: foot.y, fromZ: foot.z, toX: foot.x, toY: foot.y, toZ: foot.z,
          fromAngle: foot.footAngle, toAngle: foot.footAngle,
          arcX: 0, arcZ: 0, swingTime: 0, swingDuration: .14, swingProgress: 0, lift: .13, swinging: false,
        });
      }
    }
    this.updateBody(1);
  }

  steerTo(x, z) {
    this.arrived = false;
    this.destination = [
      clamp(x, -arenaLimit, arenaLimit),
      clamp(z, -arenaLimit, arenaLimit),
    ];
  }

  footprintAngle(type, side, x, z, pose) {
    const mountX = type.x;
    const mountZ = side * (type.socket + .095);
    const cosine = Math.cos(pose.heading), sine = Math.sin(pose.heading);
    const hipX = pose.x + mountX * cosine + mountZ * sine;
    const hipZ = pose.z - mountX * sine + mountZ * cosine;
    return Math.atan2(z - hipZ, x - hipX);
  }

  footRest(type, side, pose = this) {
    const lateral = type.spread * side;
    const cosine = Math.cos(pose.heading);
    const sine = Math.sin(pose.heading);
    const x = pose.x + type.reach * cosine + lateral * sine;
    const z = pose.z - type.reach * sine + lateral * cosine;
    return { x, z, y: terrainHeight(this.terrain, x, z) + footClearance, footAngle: this.footprintAngle(type, side, x, z, pose) };
  }

  advance(pose, speed, yawRate, duration) {
    const heading = pose.heading + yawRate * duration;
    // Integrate a constant-speed arc in the world coordinates shared by the feet.
    const midHeading = (heading + pose.heading) * .5;
    const halfTurn = (heading - pose.heading) * .5;
    const span = speed * duration * (Math.abs(halfTurn) < .001 ? 1 : Math.sin(halfTurn) / halfTurn);
    return {
      heading,
      x: clamp(pose.x + Math.cos(midHeading) * span, -arenaLimit, arenaLimit),
      z: clamp(pose.z - Math.sin(midHeading) * span, -arenaLimit, arenaLimit),
    };
  }

  updateSteering(dt) {
    const route = routes[this.terrain];
    let [targetX, targetZ] = this.destination ?? route[this.routeIndex];
    let gap = Math.hypot(targetX - this.x, targetZ - this.z);
    if (!this.destination && !this.manual && gap < .44) {
      this.routeIndex = (this.routeIndex + 1) % route.length;
      [targetX, targetZ] = route[this.routeIndex];
      gap = Math.hypot(targetX - this.x, targetZ - this.z);
    }
    if (this.destination && gap < .145) this.arrived = true;
    if (this.manual && gap > .27) this.arrived = false;

    const targetHeading = this.manual ? Math.atan2(-this.manual[1], this.manual[0]) : Math.atan2(this.z - targetZ, targetX - this.x);
    const stopping = this.destination && this.arrived && !this.manual;
    const error = stopping ? 0 : angleDelta(this.heading, targetHeading);
    const targetYaw = clamp(error * 4.6, -maximumYawRate, maximumYawRate);
    this.yawRate = approach(this.yawRate, targetYaw, 15, dt);
    if (Math.abs(error) < .008 && Math.abs(this.yawRate) < .018) this.yawRate = 0;

    const cruising = this.manual ? 2.75 : 2.45;
    const arrival = this.destination && !this.manual ? clamp(gap / .76, .12, 1) : 1;
    const alignment = .09 + .91 * Math.max(0, Math.cos(error)) ** 2;
    const turning = Math.max(.45, 1 - Math.abs(this.yawRate) * .18);
    const targetSpeed = stopping ? 0 : cruising * arrival * alignment * turning;
    const nextSpeed = approach(this.speed, targetSpeed, stopping ? 13 : 7.5, dt);
    const previousX = this.x, previousZ = this.z;
    const next = this.advance(this, nextSpeed, this.yawRate, dt);
    this.x = next.x;
    this.z = next.z;
    this.heading = next.heading;
    const distance = Math.hypot(this.x - previousX, this.z - previousZ);
    this.distance += distance;
    this.speed = distance / dt;
  }

  landing(leg, horizon) {
    const pose = this.advance(this, this.speed, this.yawRate, horizon);
    const preferred = this.footRest(leg.type, leg.side, pose);
    const distance = Math.hypot(preferred.x - leg.fromX, preferred.z - leg.fromZ);
    const maxStep = leg.type.upper + leg.type.lower - .11;
    const weight = distance > maxStep ? maxStep / distance : 1;
    const x = mix(leg.fromX, preferred.x, weight), z = mix(leg.fromZ, preferred.z, weight);
    return { x, z, footAngle: this.footprintAngle(leg.type, leg.side, x, z, pose) };
  }

  swingArc(leg, timeToMidpoint) {
    const middle = this.advance(this, this.speed, this.yawRate, Math.max(0, timeToMidpoint));
    const lateralX = Math.sin(middle.heading) * leg.side;
    const lateralZ = Math.cos(middle.heading) * leg.side;
    const x = (leg.fromX + leg.toX) * .5;
    const z = (leg.fromZ + leg.toZ) * .5;
    const footSide = (x - middle.x) * lateralX + (z - middle.z) * lateralZ;
    const margin = Math.max(0, leg.type.spread * .85 - footSide);
    return { x: margin * lateralX, z: margin * lateralZ };
  }

  startSwing(leg, cadence) {
    leg.fromX = leg.x;
    leg.fromY = leg.y;
    leg.fromZ = leg.z;
    leg.fromAngle = leg.footAngle;
    leg.swingTime = 0;
    leg.swingProgress = 0;
    leg.swingDuration = Math.max(.151, (1 - stanceTime) / cadence) + .048 * Math.abs(this.yawRate) / maximumYawRate;
    const target = this.landing(leg, leg.swingDuration + stanceTime * .46 / cadence);
    leg.toX = target.x;
    leg.toZ = target.z;
    leg.toAngle = target.footAngle;
    leg.toY = terrainHeight(this.terrain, target.x, target.z) + footClearance;
    const distance = Math.hypot(target.x - leg.x, target.z - leg.z);
    const arc = this.swingArc(leg, leg.swingDuration * .5);
    leg.arcX = arc.x;
    leg.arcZ = arc.z;
    const midHeight = terrainHeight(this.terrain, (leg.x + target.x) * .5 + arc.x,
      (leg.z + target.z) * .5 + arc.z) + footClearance;
    const obstacle = Math.max(0, midHeight - (leg.fromY + leg.toY) * .5);
    leg.lift = .080 + Math.min(.095, distance * .088) + Math.min(.25, obstacle);
    leg.swinging = true;
  }

  updateSwing(leg, dt, cadence) {
    leg.swingTime = Math.min(leg.swingDuration, leg.swingTime + dt);
    const phase = leg.swingTime / leg.swingDuration;
    leg.swingProgress = phase;
    if (phase < .52) {
      const remaining = leg.swingDuration - leg.swingTime;
      const target = this.landing(leg, remaining + stanceTime * .46 / cadence);
      const response = 15 * (1 - phase / .53);
      leg.toX = approach(leg.toX, target.x, response, dt);
      leg.toZ = approach(leg.toZ, target.z, response, dt);
      leg.toAngle += angleDelta(leg.toAngle, target.footAngle) * (1 - Math.exp(-response * dt));
      leg.toY = terrainHeight(this.terrain, leg.toX, leg.toZ) + footClearance;
      const arc = this.swingArc(leg, leg.swingDuration * .5 - leg.swingTime);
      leg.arcX = approach(leg.arcX, arc.x, response, dt);
      leg.arcZ = approach(leg.arcZ, arc.z, response, dt);
    }

    const progress = easeStep(phase);
    // Follow a bowed path around the shell. Its offset vanishes at both contacts.
    const bow = Math.sin(Math.PI * phase) ** 2;
    leg.x = mix(leg.fromX, leg.toX, progress) + bow * leg.arcX;
    leg.z = mix(leg.fromZ, leg.toZ, progress) + bow * leg.arcZ;
    leg.footAngle = leg.fromAngle + angleDelta(leg.fromAngle, leg.toAngle) * progress;
    const ground = terrainHeight(this.terrain, leg.x, leg.z) + footClearance;
    const lift = leg.lift * bow;
    leg.y = Math.max(ground, mix(leg.fromY, leg.toY, progress) + lift);
    if (phase === 1) {
      leg.swinging = false;
      leg.swingProgress = 0;
      leg.phase = 0;
    }
  }

  step(dt) {
    this.clock += dt;
    this.updateSteering(dt);
    const activity = this.speed + Math.abs(this.yawRate) * .52;
    const cadence = clamp(1.45 + activity * .53, 1.45, 3.12);
    this.stride += cadence * Math.min(1, activity * 2.5) * dt;

    for (const leg of this.legs) {
      if (leg.swinging) this.updateSwing(leg, dt, cadence);
    }
    if (activity > .11) {
      const candidates = [];
      for (const leg of this.legs) {
        if (leg.swinging) continue;
        leg.phase += cadence * dt;
        const rest = this.footRest(leg.type, leg.side);
        const reach = Math.hypot(rest.x - leg.x, rest.z - leg.z);
        const urgency = reach - (leg.type.upper + leg.type.lower) * .51;
        if (leg.phase >= stanceTime || (leg.phase > .27 && urgency > 0)) {
          candidates.push({ leg, urgency: Math.max(leg.phase - stanceTime, urgency * 1.6) });
        }
      }
      const grounded = this.legs.filter(leg => !leg.swinging);
      const support = [grounded.filter(leg => leg.side < 0).length, grounded.filter(leg => leg.side > 0).length];
      let available = grounded.length - 3;
      candidates.sort((a, b) => b.urgency - a.urgency);
      for (const { leg } of candidates) {
        if (!available) break;
        const side = leg.side < 0 ? 0 : 1;
        if (support[side] <= 1) continue;
        this.startSwing(leg, cadence);
        support[side]--;
        available--;
      }
    }
    this.updateBody(dt);
  }

  updateBody(dt) {
    const forwardX = Math.cos(this.heading), forwardZ = -Math.sin(this.heading);
    const heightAt = (along, across) => terrainHeight(this.terrain,
      this.x + along * forwardX - across * forwardZ, this.z + along * forwardZ + across * forwardX);
    const front = heightAt(.51, 0), rear = heightAt(-.51, 0);
    const right = heightAt(0, .47), left = heightAt(0, -.47);
    const grounded = this.legs.filter(leg => !leg.swinging);
    const support = grounded.reduce((sum, leg) => sum + leg.y - footClearance, 0) / grounded.length;
    const average = (front + rear + left + right) * .25;
    const activity = clamp(this.speed / 2.45 + Math.abs(this.yawRate) * .19, 0, 1);
    const step = this.stride * twoPi;
    const turn = this.yawRate / maximumYawRate;
    this.pose.height = approach(this.pose.height, .528 + average * .85 + support * .15 + Math.cos(step * 2) * .014 * activity, 17, dt);
    this.pose.pitch = approach(this.pose.pitch, Math.atan2(front - rear, 1.02) + Math.sin(step + .5) * .033 * activity, 13, dt);
    this.pose.roll = approach(this.pose.roll, Math.atan2(left - right, .94) + Math.cos(step) * .043 * activity - turn * .10, 14, dt);
    const target = {
      headYaw: turn * .225 + Math.sin(step + .44) * .038 * activity,
      headPitch: -.24 - this.pose.pitch * .39 + Math.sin(step * 2 + .65) * .037 * activity,
      waistYaw: -turn * .14 + Math.sin(step - .8) * .061 * activity,
      waistPitch: .036 - this.pose.pitch * .22 + Math.sin(step - .45) * .047 * activity,
      gasterYaw: -turn * .125 + Math.sin(step - 1.2) * .054 * activity,
      gasterPitch: .016 - this.pose.pitch * .18 + Math.cos(step - .85) * .045 * activity,
      gasterRoll: -this.pose.roll * .25 + Math.sin(step - 1.12) * .037 * activity,
    };
    for (const name of Object.keys(target)) {
      this.joints[name] = approach(this.joints[name], target[name], name.startsWith('head') ? 19 : 10, dt);
    }
  }

  bodyPose() { return this.pose; }
}
