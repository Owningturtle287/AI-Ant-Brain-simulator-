import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scene, Vector3 } from 'three';
import { AntMotion, terrainHeight } from '../src/motion.js';
import { anatomy, sculpt } from '../src/sculpt.js';
import { WorkerRig } from '../src/worker.js';

test('authored shell profiles produce finite geometry with mixed station curvature', () => {
  for (const [part, definition] of Object.entries(anatomy)) {
    const geometry = sculpt(definition);
    for (const attribute of ['position', 'normal']) {
      assert.ok(geometry.getAttribute(attribute).array.every(Number.isFinite), `${part} ${attribute}`);
    }
  }
});

test('leg joints stay continuous when the walking direction reverses', () => {
  const motion = new AntMotion();
  const rig = new WorkerRig(new Scene(), motion.legs);
  rig.update(motion, false, false);
  const previous = rig.legs.map(leg => leg.segments[3].position.clone());
  assert.ok(rig.legs[0].segments[0].position.y > rig.legs[1].segments[0].position.y + .10);
  for (let frame = 0; frame < 1250; frame++) {
    if (frame === 430) motion.steerTo(-1.4, 1.8);
    if (frame === 750) motion.steerTo(1.7, -1.8);
    if (frame === 1000) motion.manual = [-1, 1];
    motion.step(1 / 120);
    rig.update(motion, false, false);
    for (const [index, leg] of rig.legs.entries()) {
      const knee = leg.segments[3].position;
      assert.ok(knee.distanceTo(previous[index]) < .24);
      previous[index].copy(knee);
    }
  }
});

test('the curved abdomen and extended sting clear the terrain', () => {
  const motion = new AntMotion('tunnel');
  const rig = new WorkerRig(new Scene(), motion.legs);
  const point = new Vector3();
  rig.update(motion, false, false);
  assert.equal(rig.sting.visible, false);
  motion.steerTo(1.7, -1.8);
  for (let frame = 0; frame < 720; frame++) {
    motion.step(1 / 120);
    rig.update(motion, false, false, 1);
    const tip = rig.sting.localToWorld(point.copy(rig.stingTip));
    assert.ok(tip.y > terrainHeight(motion.terrain, tip.x, tip.z) + .018);
  }
  assert.equal(rig.sting.visible, true);
  assert.ok(rig.sting.position.x < -.95);
});
