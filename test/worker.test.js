import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scene, Vector3 } from 'three';
import { AntMotion, terrainHeight } from '../src/motion.js';
import { anatomy, sculpt } from '../src/sculpt.js';
import { WorkerRig } from '../src/worker.js';
import { WorkerBatches } from '../src/worker-batches.js';

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

test('a crowded batch keeps each worker’s articulated shells, legs, and antennae', () => {
  const display = new Scene();
  const poses = new Scene();
  const batch = new WorkerBatches(display);
  let reference;
  for (let i = 0; i < 12; i++) {
    const motion = new AntMotion();
    motion.reset(i * .3, 0);
    const rig = new WorkerRig(poses, motion.legs, true);
    rig.update(motion, false, false);
    assert.equal(rig.legs.length, 6);
    assert.deepEqual(rig.antennae.map(antenna => antenna.pieces.length), [10, 10]);
    const gaster = rig.gaster.children[0].geometry;
    assert.ok(gaster.userData.profile.seamRows.length >= 3);
    if (reference) assert.equal(gaster, reference);
    reference = gaster;
    batch.add(rig.root);
  }
  batch.commit();
  const gasters = display.children.find(mesh => mesh.geometry === reference);
  assert.equal(gasters.count, 12);
  assert.ok(display.children.length < 35);
});

test('the visible antenna tip reaches a close tactile target', () => {
  const motion = new AntMotion();
  motion.reset(0, 0, 0);
  const rig = new WorkerRig(new Scene(), motion.legs, true);
  const target = new Vector3(1.95, .53, -.43);
  rig.update(motion, false, false, 0, { probes: [{ aim: target }] });
  const tipJoint = rig.antennae[0].pieces.at(-1);
  assert.ok(tipJoint.localToWorld(new Vector3(.137, 0, 0)).distanceTo(target) < .07);
});
