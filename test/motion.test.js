import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AntMotion, arenaLimit, terrainHeight } from '../src/motion.js';

const step = 1 / 120;

test('planted feet stay at their contact coordinates', () => {
  const motion = new AntMotion('gravel');
  let swingObserved = false;
  for (let i = 0; i < 1440; i++) {
    const before = motion.legs.map(leg => ({ ...leg }));
    motion.step(step);
    const planted = motion.legs.filter(leg => !leg.swinging);
    assert.ok(planted.length >= 3);
    assert.ok(planted.some(leg => leg.side < 0) && planted.some(leg => leg.side > 0));
    for (const [index, foot] of motion.legs.entries()) {
      const floor = terrainHeight('gravel', foot.x, foot.z);
      assert.ok(foot.y >= floor);
      if (foot.swinging) swingObserved = true;
      if (!foot.swinging && !before[index].swinging) {
        assert.equal(foot.x, before[index].x);
        assert.equal(foot.z, before[index].z);
        assert.equal(foot.footAngle, before[index].footAngle);
      }
    }
  }
  assert.ok(swingObserved);
  assert.ok(motion.distance > 15);
});

test('guidance stops near a selected point and reset clears it', () => {
  const motion = new AntMotion();
  motion.steerTo(2, -.75);
  for (let i = 0; i < 1200; i++) motion.step(step);
  assert.ok(Math.hypot(motion.x - 2, motion.z + .75) < .3);
  assert.ok(motion.legs.every(leg => !leg.swinging));
  assert.ok(motion.speed < .01);
  const distanceWhenStopped = motion.distance;
  motion.destination = null;
  for (let i = 0; i < 240; i++) motion.step(step);
  assert.ok(motion.distance > distanceWhenStopped + 1);
  motion.steerTo(100, -100);
  assert.deepEqual(motion.destination, [arenaLimit, -arenaLimit]);
  motion.reset();
  assert.equal(motion.destination, null);
  assert.equal(motion.distance, 0);
  assert.equal(motion.clock, 0);
});

test('tunnel banks slope up from the channel', () => {
  assert.ok(terrainHeight('tunnel', 0, 3) > 1);
  assert.ok(terrainHeight('tunnel', 0, .4) < .08);
});

test('curved foot placement gives the inside legs shorter strides', () => {
  const motion = new AntMotion();
  motion.updateSteering = function (dt) {
    const forwardSpeed = 1.65, turningSpeed = .62;
    const next = this.advance(this, forwardSpeed, turningSpeed, dt);
    this.x = next.x;
    this.z = next.z;
    this.heading = next.heading;
    this.speed = forwardSpeed;
    this.yawRate = turningSpeed;
  };
  const inside = [], outside = [];
  for (let i = 0; i < 960; i++) {
    const wasSwinging = motion.legs.map(leg => leg.swinging);
    motion.step(step);
    for (const [index, leg] of motion.legs.entries()) {
      if (i < 175 || !wasSwinging[index] || leg.swinging) continue;
      const strides = leg.side < 0 ? inside : outside;
      strides.push(Math.hypot(leg.x - leg.fromX, leg.z - leg.fromZ));
    }
  }
  const mean = strides => strides.reduce((sum, stride) => sum + stride, 0) / strides.length;
  assert.ok(inside.length > 20 && outside.length > 20);
  assert.ok(mean(inside) < mean(outside) * .85);
});

test('head leads and abdomen trails a sharp change in direction', () => {
  const motion = new AntMotion();
  motion.manual = [1, 0];
  for (let i = 0; i < 150; i++) motion.step(step);
  motion.manual = [-1, -1];
  for (let i = 0; i < 30; i++) motion.step(step);
  assert.ok(motion.yawRate > 0);
  assert.ok(motion.joints.headYaw > .47 && motion.joints.headYaw <= .66);
  const abdomenYaw = motion.joints.waistYaw + motion.joints.postYaw + motion.joints.gasterYaw;
  assert.ok(abdomenYaw < -.48);
  assert.ok(motion.legs.filter(leg => !leg.swinging).length >= 3);
});

test('the body stands higher and lifts slightly as it walks', () => {
  const motion = new AntMotion();
  const floor = terrainHeight(motion.terrain, motion.x, motion.z);
  const restingHeight = motion.bodyPose().height - floor;
  assert.ok(restingHeight > .66);
  motion.manual = [1, 0];
  let height = 0, samples = 0;
  for (let frame = 0; frame < 170; frame++) {
    motion.step(step);
    if (motion.speed < 1.8) continue;
    height += motion.bodyPose().height - terrainHeight(motion.terrain, motion.x, motion.z);
    samples++;
  }
  assert.ok(samples > 75);
  assert.ok(height / samples > restingHeight + .012);
});
