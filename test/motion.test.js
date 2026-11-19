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
    for (const [index, foot] of motion.legs.entries()) {
      const floor = terrainHeight('gravel', foot.x, foot.z);
      assert.ok(foot.y >= floor);
      if (foot.swinging) swingObserved = true;
      if (!foot.swinging && !before[index].swinging) {
        assert.equal(foot.x, before[index].x);
        assert.equal(foot.z, before[index].z);
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
