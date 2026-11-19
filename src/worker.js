import * as THREE from 'three';
import { anatomy, sculpt } from './sculpt.js';

const up = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3(1, 0, 0);
const markerGeometry = new THREE.SphereGeometry(1, 12, 8);
const antennaLengths = [.485, .089, .061, .059, .055, .055, .056, .060, .094, .137];
const tarsalEnds = [.37, .56, .72, .86, 1];

export function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function dataTexture(values, size, colorSpace = THREE.NoColorSpace) {
  const texture = new THREE.DataTexture(values, size, size);
  texture.colorSpace = colorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function cuticle() {
  const size = 256;
  const random = randomGenerator(27);
  const pigment = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const address = (y * size + x) * 4;
      const u = Math.PI * 2 * x / size;
      const v = Math.PI * 2 * y / size;
      const cloud = .51 * Math.sin(3 * u + v + .6 * Math.sin(5 * v)) +
        .29 * Math.sin(9 * u - 5 * v + 2 * Math.sin(3 * u)) + .20 * Math.cos(16 * u + 13 * v);
      const striae = Math.cos(40 * u + 5 * Math.sin(8 * v) + 5 * Math.sin(9 * u + v));
      const noise = random();
      const pit = noise > .980 ? 29 : noise * 9;
      const brightness = 229 + cloud * 19 + striae * 3 - pit;
      pigment.set([brightness + 8, brightness - 3 + cloud * 4, brightness - 8 + cloud * 6, 255], address);
      const height = 131 + striae * 17 + cloud * 11 - pit * 1.85;
      relief.set([height, height, height, 255], address);
    }
  }
  return { map: dataTexture(pigment, size, THREE.SRGBColorSpace), bumpMap: dataTexture(relief, size) };
}

function facets() {
  const size = 96;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / 8);
    for (let x = 0; x < size; x++) {
      const a = Math.abs((x + (row % 2) * 4) % 8 - 3.5) / 4;
      const b = Math.abs(y % 8 - 3.5) / 4;
      const level = Math.max(0, 1 - Math.max(a, b * .82 + a * .46));
      const depth = 74 + 142 * Math.sqrt(level);
      bytes.set([depth, depth, depth, 255], (y * size + x) * 4);
    }
  }
  return dataTexture(bytes, size);
}

function materials() {
  const maps = cuticle();
  const shell = (color, roughness, bumpScale) => new THREE.MeshPhysicalMaterial({
    color, roughness, ...maps, bumpScale, clearcoat: .35, clearcoatRoughness: .26, vertexColors: true,
  });
  return {
    mesosoma: shell('#883d22', .36, .017),
    head: shell('#8a3d22', .35, .016),
    waist: shell('#77351e', .32, .014),
    gaster: shell('#321918', .30, .015),
    femur: shell('#8f4a2c', .39, .011),
    tibia: shell('#995331', .38, .010),
    hinge: shell('#65301c', .39, .010),
    tarsi: shell('#9e5b34', .42, .006),
    antenna: shell('#8e482c', .40, .009),
    club: shell('#a3613b', .42, .008),
    jaws: shell('#532618', .31, .019),
    claw: new THREE.MeshStandardMaterial({ color: '#775035', roughness: .43 }),
    eye: new THREE.MeshPhysicalMaterial({ color: '#1b1513', roughness: .45, clearcoat: .23, bumpMap: facets(), bumpScale: .0065 }),
    setae: new THREE.MeshStandardMaterial({ color: '#be9365', roughness: .78, side: THREE.DoubleSide }),
    jointMarker: new THREE.MeshBasicMaterial({ color: '#ffd58e', depthTest: false }),
    feetMarker: new THREE.MeshBasicMaterial({ color: '#92dfaa', transparent: true, opacity: .83, side: THREE.DoubleSide }),
  };
}

function group(parent, x = 0, y = 0, z = 0) {
  const part = new THREE.Group();
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function mesh(parent, geometry, material) {
  const part = new THREE.Mesh(geometry, material);
  part.castShadow = part.receiveShadow = true;
  parent.add(part);
  return part;
}

// Sample the actual shell instead of distributing hairs inside a bounding sphere.
function hairGeometry(shell, count, length, seed, onLimb = false) {
  const random = randomGenerator(seed);
  const samples = shell.getAttribute('position');
  const normals = shell.getAttribute('normal');
  const triangles = [];
  const origin = new THREE.Vector3(), normal = new THREE.Vector3();
  const side = new THREE.Vector3(), bend = new THREE.Vector3(), tip = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const index = Math.floor(random() * samples.count);
    origin.fromBufferAttribute(samples, index);
    normal.fromBufferAttribute(normals, index).normalize();
    if ((onLimb && (origin.x < .13 || origin.x > .95)) || (!onLimb && normal.y < -.59)) continue;
    if (onLimb) normal.set(0, normal.y, normal.z).normalize();
    side.crossVectors(normal, Math.abs(normal.y) < .89 ? up : axis).normalize().multiplyScalar(onLimb ? .022 : .0019);
    bend.copy(origin).addScaledVector(normal, length * (.48 + .14 * random()));
    tip.copy(origin).addScaledVector(normal, length * (.69 + .55 * random()));
    tip.x += (onLimb ? .085 : -.52) * length * (.35 + random() * .5);
    triangles.push(
      origin.x + side.x, origin.y + side.y, origin.z + side.z,
      origin.x - side.x, origin.y - side.y, origin.z - side.z,
      bend.x, bend.y, bend.z,
      origin.x - side.x * .43, bend.y, origin.z - side.z * .43,
      bend.x, bend.y, bend.z,
      tip.x, tip.y, tip.z,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function eyeGeometry(side) {
  const divisions = 32;
  const rings = 7;
  const vertices = [], uvs = [], triangles = [];
  const sample = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring++) {
    const radius = ring / rings;
    for (let slice = 0; slice <= divisions; slice++) {
      const turn = slice / divisions * Math.PI * 2;
      const along = Math.cos(turn) * radius, across = Math.sin(turn) * radius;
      const x = .566 + along * .051 + across * .013;
      const angle = side * (1.57 + across * .242 - along * .08);
      anatomy.head.surface(x, angle, sample);
      sample.z += side * (.0035 + .0145 * (1 - radius * radius));
      vertices.push(sample.x, sample.y, sample.z);
      uvs.push(.5 + along * .5, .5 + across * .5);
      if (!ring || !slice) continue;
      const point = ring * (divisions + 1) + slice;
      const before = point - divisions - 1;
      if (side > 0) triangles.push(point, before, point - 1, point - 1, before, before - 1);
      else triangles.push(point - 1, before, point, before - 1, before, point - 1);
    }
  }
  const eye = new THREE.BufferGeometry();
  eye.setIndex(triangles);
  eye.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  eye.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  eye.computeVertexNormals();
  // Mirrored eyes have opposite winding. Make the outside front-facing.
  const sampleIndex = (divisions + 1) * 4 + 3;
  if (eye.getAttribute('normal').getZ(sampleIndex) * side < 0) {
    for (let i = 0; i < triangles.length; i += 3) {
      [triangles[i], triangles[i + 1]] = [triangles[i + 1], triangles[i]];
    }
    eye.setIndex(triangles);
    eye.computeVertexNormals();
  }
  eye.userData.oval = true;
  return eye;
}

function terminalClaw(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(.016, .008, side * .009),
    new THREE.Vector3(.034, .006, side * .015),
    new THREE.Vector3(.043, -.013, side * .015),
  ]);
  const geometry = new THREE.TubeGeometry(curve, 8, .0037, 6, false);
  const points = geometry.getAttribute('position');
  const center = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  for (let row = 0; row <= 8; row++) {
    curve.getPointAt(row / 8, center);
    for (let slice = 0; slice <= 6; slice++) {
      const index = row * 7 + slice;
      vertex.fromBufferAttribute(points, index).lerp(center, .93 * (row / 8) ** 2);
      points.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

const aim = new THREE.Vector3();
const hip = new THREE.Vector3(), coxa = new THREE.Vector3(), femurBase = new THREE.Vector3();
const toe = new THREE.Vector3(), toeBase = new THREE.Vector3(), footDirection = new THREE.Vector3();
const ankle = new THREE.Vector3(), knee = new THREE.Vector3();
const forward = new THREE.Vector3(), outward = new THREE.Vector3(), kneeHint = new THREE.Vector3();
const along = new THREE.Vector3(), pieceStart = new THREE.Vector3(), pieceEnd = new THREE.Vector3();
const angle = new THREE.Euler(0, 0, 0, 'YXZ');

function poseLink(part, start, end, thickness, width = 1, twist = 0) {
  aim.subVectors(end, start);
  part.position.copy(start);
  part.scale.set(aim.length(), thickness, thickness * width);
  part.quaternion.setFromUnitVectors(axis, aim.normalize());
  part.rotateX(twist);
}

function solveKnee(base, target, joint, direction, first, second) {
  along.subVectors(target, base);
  const targetDistance = along.length();
  const distance = THREE.MathUtils.clamp(targetDistance, Math.abs(first - second) + .001, first + second - .001);
  along.normalize();
  if (targetDistance > distance) target.copy(base).addScaledVector(along, distance);
  direction.addScaledVector(along, -direction.dot(along)).normalize();
  const projection = (first * first - second * second + distance * distance) / (2 * distance);
  joint.copy(base).addScaledVector(along, projection);
  joint.addScaledVector(direction, Math.sqrt(Math.max(0, first * first - projection * projection)));
}

export class WorkerRig {
  constructor(scene, legs) {
    this.material = materials();
    const m = this.material;
    this.root = group(scene);
    this.body = group(this.root);
    this.addShell(this.body, 'mesosoma', m.mesosoma, 26, 52, 152, .039, 45);

    this.head = group(this.body, .614, .062);
    this.addShell(this.head, 'head', m.head, 34, 54, 203, .039, 63);
    this.jaws = [];
    this.antennae = [];
    const blade = sculpt(anatomy.mandible, 24, 40);
    const antennalShells = ['scape', 'funiculus', 'club', 'clubTip'].map(name => sculpt(anatomy[name], 12, 10));
    for (const side of [-1, 1]) {
      const jaw = group(this.head, .679, -.164, side * .169);
      const mandible = mesh(jaw, blade, m.jaws);
      mandible.scale.z = side;
      this.jaws.push(jaw);
      const eye = mesh(this.head, eyeGeometry(side), m.eye);
      eye.castShadow = false;
      this.antennae.push(this.buildAntenna(side, antennalShells));
    }

    this.waist = group(this.body, -.615, .012);
    this.addShell(this.waist, 'petiole', m.waist, 22, 28, 32, .033, 75);
    this.postWaist = group(this.waist, -.222, -.013);
    this.addShell(this.postWaist, 'postpetiole', m.waist, 22, 28, 34, .031, 76);
    this.gaster = group(this.postWaist, -.198, -.002);
    this.addShell(this.gaster, 'gaster', m.gaster, 32, 60, 169, .039, 84);

    this.markerGroup = group(this.root);
    this.markerGroup.visible = false;
    this.contacts = group(this.root);
    this.contacts.visible = false;
    const footRing = new THREE.RingGeometry(.049, .061, 20);
    const sockets = ['coxa', 'trochanter', 'femur', 'tibia', 'tarsomere'].map(name => sculpt(anatomy[name], 12, 12));
    const hairs = [hairGeometry(sockets[2], 13, .32, 95, true), hairGeometry(sockets[3], 24, .46, 96, true)];
    const claws = [-1, 1].map(terminalClaw);
    this.legs = legs.map(() => {
      const segments = [
        mesh(this.root, sockets[0], m.hinge), mesh(this.root, sockets[1], m.hinge),
        mesh(this.root, sockets[2], m.femur), mesh(this.root, sockets[3], m.tibia),
        ...Array.from({ length: 5 }, () => mesh(this.root, sockets[4], m.tarsi)),
      ];
      for (const [index, geometry] of hairs.entries()) segments[index + 2].add(new THREE.Mesh(geometry, m.setae));
      const foot = group(this.root);
      for (const geometry of claws) mesh(foot, geometry, m.claw);
      const markers = Array.from({ length: 5 }, () => this.marker(this.markerGroup, .032));
      const contact = new THREE.Mesh(footRing, m.feetMarker);
      contact.rotation.x = -Math.PI / 2;
      this.contacts.add(contact);
      return { segments, foot, markers, contact };
    });
    this.anatomyMarkers = [
      this.marker(this.head, .035), this.marker(this.waist, .032),
      this.marker(this.postWaist, .032), this.marker(this.gaster, .034),
      ...this.jaws.map(jaw => this.marker(jaw, .029)),
      ...this.antennae.flatMap(a => [this.marker(a.pieces[0], .028), this.marker(a.pieces[1], .024)]),
    ];
  }

  addShell(parent, name, material, radial, axial, hairCount, length, seed) {
    const geometry = sculpt(anatomy[name], radial, axial);
    const part = mesh(parent, geometry, material);
    part.add(new THREE.Mesh(hairGeometry(geometry, hairCount, length, seed), this.material.setae));
    return part;
  }

  buildAntenna(side, shapes) {
    const socket = anatomy.head.surface(.710, side * 1.58);
    const base = group(this.head, socket.x, socket.y + .009, socket.z);
    const conicalSocket = mesh(base, shapes[1], this.material.hinge);
    conicalSocket.position.x = -.036;
    conicalSocket.scale.set(.078, .049, .049);
    const pieces = [];
    let pivot = base;
    for (const [index, length] of antennaLengths.entries()) {
      const shape = index === 0 ? 0 : index === 8 ? 2 : index === 9 ? 3 : 1;
      const thickness = index === 0 ? .041 : index === 8 ? .035 : index === 9 ? .043 : .030;
      const part = mesh(pivot, shapes[shape], index >= 8 ? this.material.club : this.material.antenna);
      part.scale.set(length * 1.02, thickness, thickness * .87);
      if (index === 0 || index >= 8) {
        part.add(new THREE.Mesh(hairGeometry(shapes[shape], 13, .25, index + 702, true), this.material.setae));
      }
      pieces.push(pivot);
      pivot = group(pivot, length, 0, 0);
    }
    return { side, pieces };
  }

  marker(parent, size) {
    const marker = new THREE.Mesh(markerGeometry, this.material.jointMarker);
    marker.scale.setScalar(size);
    marker.renderOrder = 8;
    parent.add(marker);
    return marker;
  }

  update(motion, showJoints, showContacts) {
    const pose = motion.bodyPose();
    this.body.position.set(motion.x, pose.height, motion.z);
    this.body.quaternion.setFromEuler(angle.set(pose.roll, motion.heading, pose.pitch));
    const time = motion.clock;
    const activity = Math.min(1, motion.speed / 2.45);
    this.head.rotation.set(Math.sin(time * 3.6) * .016, Math.sin(time * 2.95) * .062, -.17 + Math.sin(time * 3.8) * .034);
    this.waist.rotation.y = Math.sin(motion.stride * 2 * Math.PI) * .044 * activity;
    this.waist.rotation.z = Math.sin(time * 3.5) * .034 + .047;
    this.postWaist.rotation.y = -.56 * this.waist.rotation.y;
    this.gaster.rotation.z = Math.sin(time * 3.5 - .65) * .026 + .038;
    for (const [index, hinge] of this.jaws.entries()) {
      const side = index === 0 ? -1 : 1;
      hinge.rotation.y = -side * (.03 + .07 * (.5 + .5 * Math.sin(time * 2.2)) ** 5);
    }
    for (const { side, pieces } of this.antennae) {
      const sweep = Math.sin(time * 5.8 + (side === -1 ? 0 : 1.6));
      pieces[0].rotation.set(0, -side * (.69 + .22 * sweep), .83 + .11 * Math.sin(time * 3.8 + side));
      pieces[1].rotation.set(0, side * (.07 + .21 * sweep), -1.29 + .12 * Math.sin(time * 5.1 + side));
      for (let index = 2; index < pieces.length; index++) {
        pieces[index].rotation.z = -.043 + Math.sin(time * 5.9 - index * .32 + side) * .037;
        pieces[index].rotation.y = side * (.016 + Math.sin(time * 3.7 - index * .17) * .023);
      }
    }

    this.markerGroup.visible = showJoints;
    this.contacts.visible = showContacts;
    for (const marker of this.anatomyMarkers) marker.visible = showJoints;
    forward.set(Math.cos(motion.heading), 0, -Math.sin(motion.heading));
    outward.set(Math.sin(motion.heading), 0, Math.cos(motion.heading));
    for (const [index, leg] of motion.legs.entries()) this.poseLeg(this.legs[index], leg);
  }

  poseLeg(rig, leg) {
    const { type, side } = leg;
    hip.set(type.x, -.091, side * type.socket).applyQuaternion(this.body.quaternion).add(this.body.position);
    coxa.copy(hip).addScaledVector(outward, side * .066).addScaledVector(forward, type.x * -.095);
    coxa.y -= .138;
    femurBase.copy(coxa).addScaledVector(outward, side * .052).addScaledVector(forward, type.x * .10);
    femurBase.y -= .021;
    toe.set(leg.x, leg.y, leg.z);
    footDirection.subVectors(toe, femurBase);
    footDirection.y = 0;
    footDirection.normalize();
    toeBase.copy(toe).addScaledVector(footDirection, -.035);
    toeBase.y += .010;
    ankle.copy(toeBase).addScaledVector(footDirection, -type.foot * .69);
    ankle.y += type.foot * .52;
    kneeHint.set(0, .56, 0).addScaledVector(outward, .96 * side).addScaledVector(forward, type.x * 1.02);
    solveKnee(femurBase, ankle, knee, kneeHint, type.upper, type.lower);

    const { segments } = rig;
    poseLink(segments[0], hip, coxa, .069, .98, .2 * side);
    poseLink(segments[1], coxa, femurBase, .043, .91);
    poseLink(segments[2], femurBase, knee, .064 + .009 * (type.x < 0), .92, .27 * side);
    poseLink(segments[3], knee, ankle, .054 + .004 * (type.x < 0), .82, .11 * side);
    pieceStart.copy(ankle);
    for (const [index, fraction] of tarsalEnds.entries()) {
      pieceEnd.copy(ankle).lerp(toeBase, fraction);
      pieceEnd.y -= .044 * Math.sin(Math.PI * fraction);
      poseLink(segments[index + 4], pieceStart, pieceEnd, .033 - .0039 * index, 1.02);
      pieceStart.copy(pieceEnd);
    }
    rig.foot.position.copy(toeBase);
    rig.foot.quaternion.setFromUnitVectors(axis, footDirection);
    for (const [index, point] of [hip, femurBase, knee, ankle, toe].entries()) {
      rig.markers[index].position.copy(point);
    }
    rig.contact.visible = !leg.swinging;
    rig.contact.position.set(toe.x, toe.y + .004, toe.z);
  }
}
