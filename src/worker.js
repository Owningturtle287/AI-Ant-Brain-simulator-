import * as THREE from 'three';
import { terrainHeight } from './motion.js';
import { anatomy, sculpt } from './sculpt.js';
import { segmentBlocked, segmentReach, shellRoof } from './body-space.js';

const up = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3(1, 0, 0);
const markerGeometry = new THREE.SphereGeometry(1, 12, 8);
const footRing = new THREE.RingGeometry(.049, .061, 20);
const antennaLengths = [.485, .089, .061, .059, .055, .055, .056, .060, .094, .137];
const feelerReach = antennaLengths.slice(1).reduce((total, length) => total + length, 0);
const tarsalEnds = [.37, .56, .72, .86, 1];
const sharedGeometry = new Map();
let sharedMaterials;

function reuseGeometry(key, factory) {
  if (!sharedGeometry.has(key)) sharedGeometry.set(key, factory());
  return sharedGeometry.get(key);
}

function shellGeometry(name, radial, axial, compact) {
  if (compact) {
    radial = Math.max(6, Math.round(radial * .55));
    axial = Math.max(5, Math.round(axial * .53));
  }
  return reuseGeometry(`shell/${name}/${radial}/${axial}`, () => {
    const geometry = sculpt(anatomy[name], radial, axial);
    geometry.userData.slimProfile = ['coxa', 'trochanter', 'femur', 'tibia', 'tarsomere', 'scape', 'funiculus', 'club', 'clubTip'].includes(name);
    return geometry;
  });
}

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
    color, roughness, ...maps, bumpScale: bumpScale * .34, clearcoat: .58, clearcoatRoughness: .20, vertexColors: true,
  });
  return {
    mesosoma: shell('#883d22', .32, .017),
    head: shell('#8a3d22', .31, .016),
    waist: shell('#77351e', .32, .014),
    gaster: shell('#321918', .27, .015),
    femur: shell('#8f4a2c', .39, .011),
    tibia: shell('#995331', .38, .010),
    hinge: shell('#65301c', .39, .010),
    tarsi: shell('#9e5b34', .42, .006),
    antenna: shell('#8e482c', .40, .009),
    club: shell('#a3613b', .42, .008),
    jaws: shell('#532618', .31, .019),
    sting: shell('#9e6b3c', .31, .004),
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

const feelTarget = new THREE.Vector3();
const feelDirection = new THREE.Vector3();
const feelPole = new THREE.Vector3();
const feelElbow = new THREE.Vector3();
const feelOuter = new THREE.Vector3();
const reverseFeeler = new THREE.Quaternion();
const feelBase = new THREE.Vector3(), feelMiddle = new THREE.Vector3(), feelTip = new THREE.Vector3();
const alternateFeel = new THREE.Vector3(), contactAim = new THREE.Vector3();

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
const forward = new THREE.Vector3();
const bodyForward = new THREE.Vector3(), bodyOutward = new THREE.Vector3(), bodyUp = new THREE.Vector3();
const along = new THREE.Vector3(), pieceStart = new THREE.Vector3(), pieceEnd = new THREE.Vector3();
const upperPole = new THREE.Vector3(), sidePole = new THREE.Vector3(), desiredPole = new THREE.Vector3();
const poleCross = new THREE.Vector3();
const transport = new THREE.Quaternion();
const angle = new THREE.Euler(0, 0, 0, 'YXZ');
const restToe = new THREE.Vector3(), safeToe = new THREE.Vector3();
const standardKnee = new THREE.Vector3(), jointAxis = new THREE.Vector3();
const cleaningPoint = new THREE.Vector3(), idealAnkle = new THREE.Vector3();
const stepsAround = [[0, 0], [0, .19], [.24, -.18], [-.25, -.19], [0, -.44], [.38, .02], [-.40, .04], [0, -.65]];
const kneeTurns = [0, .34, -.34, .68, -.68, 1.04, -1.04, 1.52, -1.52, 2.02, -2.02, Math.PI];

function poseLink(part, start, end, thickness, width = 1, twist = 0) {
  aim.subVectors(end, start);
  part.position.copy(start);
  part.scale.set(aim.length(), thickness, thickness * width);
  part.quaternion.setFromUnitVectors(axis, aim.normalize());
  part.rotateX(twist);
}

function solveKnee(base, target, joint, rig, leg, swing, dt) {
  const { type, side } = leg;
  along.subVectors(target, base);
  const targetDistance = along.length();
  if (targetDistance > .0001) along.multiplyScalar(1 / targetDistance);
  else along.copy(footDirection);
  const distance = THREE.MathUtils.clamp(targetDistance, Math.abs(type.upper - type.lower) + .001, type.upper + type.lower - .001);
  if (targetDistance !== distance) target.copy(base).addScaledVector(along, distance);

  sidePole.crossVectors(up, along);
  const horizontal = sidePole.length();
  if (horizontal > .0001) {
    sidePole.multiplyScalar(-1 / horizontal);
    upperPole.copy(up).addScaledVector(along, -along.y).normalize();
    desiredPole.copy(upperPole).multiplyScalar(type.kneeRise + swing * .12)
      .addScaledVector(sidePole, side * type.kneeSpread).normalize();
  } else {
    desiredPole.copy(footDirection).addScaledVector(along, -footDirection.dot(along)).normalize();
  }

  if (rig.poleReady) {
    // Carry the previous bend around with the leg before steering it toward the new plane.
    transport.setFromUnitVectors(rig.lastAxis, along);
    rig.pole.applyQuaternion(transport);
    const turn = Math.atan2(along.dot(poleCross.crossVectors(rig.pole, desiredPole)), rig.pole.dot(desiredPole));
    const limit = dt * 8.5 * THREE.MathUtils.smoothstep(horizontal, .025, .25);
    rig.pole.applyAxisAngle(along, THREE.MathUtils.clamp(turn, -limit, limit)).normalize();
  } else {
    rig.pole.copy(desiredPole);
    rig.poleReady = true;
  }
  rig.lastAxis.copy(along);
  const projection = (type.upper ** 2 - type.lower ** 2 + distance ** 2) / (2 * distance);
  joint.copy(base).addScaledVector(along, projection);
  joint.addScaledVector(rig.pole, Math.sqrt(Math.max(0, type.upper ** 2 - projection ** 2)));
}

export class WorkerRig {
  constructor(scene, legs, compact = false) {
    this.compact = compact;
    this.material = sharedMaterials ??= materials();
    const m = this.material;
    this.root = group(scene);
    this.body = group(this.root);
    this.addShell(this.body, 'mesosoma', m.mesosoma, 26, 52, 152, .039, 45).userData.zone = 'thorax';

    this.head = group(this.body, .585, .124);
    mesh(this.head, shellGeometry('neck', 14, 18, compact), m.hinge).position.set(-.047, -.043, 0);
    this.addShell(this.head, 'head', m.head, 34, 54, 203, .039, 63).userData.zone = 'head';
    this.headSamples = [.25, .43, .58, .70, .76].flatMap(x =>
      [Math.PI - .60, Math.PI, Math.PI + .60].map(angle => anatomy.head.surface(x, angle)));
    this.headSamples.push(new THREE.Vector3(.89, -.287, 0));
    this.jaws = [];
    this.antennae = [];
    const blade = shellGeometry('mandible', 24, 40, compact);
    const antennalShells = ['scape', 'funiculus', 'club', 'clubTip'].map(name => shellGeometry(name, 12, 10, compact));
    for (const side of [-1, 1]) {
      const jaw = group(this.head, .679, -.164, side * .169);
      const geometry = side === 1 ? blade : reuseGeometry(`mirrored/${blade.id}`, () => {
        const other = blade.clone().scale(1, 1, -1);
        const indices = other.index.array;
        for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
        other.index.needsUpdate = true;
        return other;
      });
      mesh(jaw, geometry, m.jaws);
      this.jaws.push(jaw);
      const eye = mesh(this.head, reuseGeometry(`eye/${side}`, () => eyeGeometry(side)), m.eye);
      eye.castShadow = false;
      this.antennae.push(this.buildAntenna(side, antennalShells));
    }

    this.waist = group(this.body, -.598, -.067);
    this.addShell(this.waist, 'petiole', m.waist, 22, 28, 32, .033, 75);
    this.postWaist = group(this.waist, -.226, -.006);
    this.addShell(this.postWaist, 'postpetiole', m.waist, 22, 28, 34, .031, 76);
    this.gaster = group(this.postWaist, -.198, -.002);
    this.addShell(this.gaster, 'gaster', m.gaster, 32, 60, 169, .039, 84).userData.zone = 'abdomen';
    this.gasterSamples = [-.30, -.47, -.59, -.73, -.88, -.976].flatMap(x =>
      [Math.PI - .61, Math.PI, Math.PI + .61].map(angle => anatomy.gaster.surface(x, angle)));
    this.clearancePoint = new THREE.Vector3();
    this.extendedStingSample = new THREE.Vector3();
    this.sting = group(this.gaster);
    this.stingTip = anatomy.sting.surface(-.179, Math.PI);
    mesh(this.sting, shellGeometry('sting', 12, 24, compact), m.sting);
    this.sting.visible = false;

    this.markerGroup = group(this.root);
    this.markerGroup.visible = false;
    this.contacts = group(this.root);
    this.contacts.visible = false;
    const sockets = ['coxa', 'trochanter', 'femur', 'tibia', 'tarsomere'].map(name => shellGeometry(name, 12, 12, compact));
    const hairs = compact ? [] : sockets.slice(2, 4).map((shape, index) =>
      reuseGeometry(`leg-hair/${index}`, () => hairGeometry(shape, index ? 24 : 13, index ? .46 : .32, 95 + index, true)));
    const claws = compact ? [] : [-1, 1].map(side => reuseGeometry(`claw/${side}`, () => terminalClaw(side)));
    this.legs = legs.map(({ type, side }) => {
      const segments = [
        mesh(this.root, sockets[0], m.hinge), mesh(this.root, sockets[1], m.hinge),
        mesh(this.root, sockets[2], m.femur), mesh(this.root, sockets[3], m.tibia),
        ...Array.from({ length: 5 }, () => mesh(this.root, sockets[4], m.tarsi)),
      ];
      for (const [index, geometry] of hairs.entries()) segments[index + 2].add(new THREE.Mesh(geometry, m.setae));
      const foot = group(this.root);
      const zone = (side < 0 ? 'left' : 'right') + type.name;
      for (const part of segments) part.userData.zone = zone;
      for (const geometry of claws) mesh(foot, geometry, m.claw);
      const markers = Array.from({ length: 5 }, () => this.marker(this.markerGroup, .032));
      const contact = new THREE.Mesh(footRing, m.feetMarker);
      contact.rotation.x = -Math.PI / 2;
      this.contacts.add(contact);
      return { segments, foot, markers, contact, pole: new THREE.Vector3(), lastAxis: new THREE.Vector3(), poleReady: false };
    });
    this.anatomyMarkers = [
      this.marker(this.head, .035), this.marker(this.waist, .032),
      this.marker(this.postWaist, .032), this.marker(this.gaster, .034),
      ...this.jaws.map(jaw => this.marker(jaw, .029)),
      ...this.antennae.flatMap(a => [this.marker(a.pieces[0], .028), this.marker(a.pieces[1], .024)]),
    ];
    this.stained = [];
    this.root.traverse(part => { if (part.userData.zone) this.stained.push(part); });
  }

  addShell(parent, name, material, radial, axial, hairCount, length, seed) {
    const geometry = shellGeometry(name, radial, axial, this.compact);
    if (name === 'mesosoma' || name === 'head' || name === 'gaster') geometry.userData.bodyShadow = true;
    const part = mesh(parent, geometry, material);
    if (!this.compact) {
      part.add(new THREE.Mesh(reuseGeometry(`shell-hair/${name}`,
        () => hairGeometry(geometry, hairCount, length, seed)), this.material.setae));
    }
    return part;
  }

  buildAntenna(side, shapes) {
    const socket = anatomy.head.surface(.710, side * 1.58);
    const base = group(this.head, socket.x, socket.y + .009, socket.z);
    const conicalSocket = mesh(base, shapes[1], this.material.hinge);
    conicalSocket.position.x = -.036;
    conicalSocket.scale.set(.078, .049, .049);
    const pieces = [];
    const skins = [];
    let pivot = base;
    for (const [index, length] of antennaLengths.entries()) {
      const shape = index === 0 ? 0 : index === 8 ? 2 : index === 9 ? 3 : 1;
      const thickness = index === 0 ? .041 : index === 8 ? .035 : index === 9 ? .043 : .030;
      const part = mesh(pivot, shapes[shape], index >= 8 ? this.material.club : this.material.antenna);
      part.userData.zone = side < 0 ? 'leftAntenna' : 'rightAntenna';
      skins.push(part);
      part.scale.set(length * 1.02, thickness, thickness * .87);
      if (!this.compact && (index === 0 || index >= 8)) {
        part.add(new THREE.Mesh(reuseGeometry(`antenna-hair/${index}`,
          () => hairGeometry(shapes[shape], 13, .25, index + 702, true)), this.material.setae));
      }
      pieces.push(pivot);
      pivot = group(pivot, length, 0, 0);
    }
    return { side, pieces, skins, tip: pivot };
  }

  marker(parent, size) {
    const marker = new THREE.Mesh(markerGeometry, this.material.jointMarker);
    marker.scale.setScalar(size);
    marker.renderOrder = 8;
    parent.add(marker);
    return marker;
  }

  setGrime(grime) {
    for (const part of this.stained) part.userData.grime = grime[part.userData.zone];
  }

  update(motion, showJoints, showContacts, stingExtension = 0, acting = null) {
    const restarted = this.motionLegs !== motion.legs;
    const dt = restarted ? 0 : Math.max(0, motion.clock - this.lastMotionTime);
    if (restarted) {
      for (const leg of this.legs) leg.poleReady = false;
      this.motionLegs = motion.legs;
    }
    this.lastMotionTime = motion.clock;
    const pose = motion.bodyPose();
    this.body.position.set(motion.x, pose.height, motion.z);
    this.body.quaternion.setFromEuler(angle.set(pose.roll, motion.heading, pose.pitch));
    const time = motion.clock;
    const joints = motion.joints;
    this.head.rotation.set(joints.headRoll, joints.headYaw + (acting?.yaw ?? 0),
      joints.headPitch + (acting?.nod ?? 0), 'YXZ');
    this.waist.rotation.set(0, joints.waistYaw, joints.waistPitch);
    this.postWaist.rotation.set(0, joints.postYaw, joints.postPitch);
    this.gaster.rotation.set(joints.gasterRoll, joints.gasterYaw, joints.gasterPitch + (acting?.curl ?? 0));
    this.sting.position.set(THREE.MathUtils.lerp(-.788, -.978, stingExtension),
      THREE.MathUtils.lerp(-.169, -.230, stingExtension), 0);
    this.sting.rotation.z = .065 * stingExtension;
    this.sting.visible = stingExtension > .24;
    this.clearBody(motion.terrain);
    for (const [index, hinge] of this.jaws.entries()) {
      const side = index === 0 ? -1 : 1;
      hinge.rotation.y = -side * (.03 + .07 * (.5 + .5 * Math.sin(time * 2.2)) ** 5 + (acting?.jaw ?? 0));
    }
    for (const [index, antenna] of this.antennae.entries()) {
      const { side, pieces, skins, tip } = antenna;
      for (const [part, length] of antennaLengths.entries()) {
        const next = pieces[part + 1] ?? tip;
        next.position.x = length;
        skins[part].visible = true;
        skins[part].scale.x = length * 1.02;
      }
      const sweep = Math.sin(time * 5.8 + (side === -1 ? 0 : 1.6));
      pieces[0].rotation.set(0, -side * (.69 + .22 * sweep), .83 + .11 * Math.sin(time * 3.8 + side));
      pieces[1].rotation.set(0, side * (.07 + .21 * sweep), -1.29 + .12 * Math.sin(time * 5.1 + side));
      for (let index = 2; index < pieces.length; index++) {
        pieces[index].rotation.z = -.043 + Math.sin(time * 5.9 - index * .32 + side) * .037;
        pieces[index].rotation.y = side * (.016 + Math.sin(time * 3.7 - index * .17) * .023);
      }
      let target = acting?.probes?.[index]?.aim;
      const groom = acting?.groom;
      if (groom?.kind === 'antenna' && Math.sign(groom.z) === side && groom.reach > .12) {
        this.body.localToWorld(contactAim.set(groom.x, groom.y - .675, groom.z));
        target = contactAim;
      }
      if (target) this.aimAntenna(pieces, side, target, time);
      if (acting?.antennaObstacles?.length) this.guardAntenna(antenna, acting.antennaObstacles, time);
    }

    this.markerGroup.visible = showJoints;
    this.contacts.visible = showContacts;
    for (const marker of this.anatomyMarkers) marker.visible = showJoints;
    forward.set(Math.cos(motion.heading), 0, -Math.sin(motion.heading));
    bodyForward.copy(axis).applyQuaternion(this.body.quaternion);
    bodyOutward.set(0, 0, 1).applyQuaternion(this.body.quaternion);
    bodyUp.copy(up).applyQuaternion(this.body.quaternion);
    for (const [index, leg] of motion.legs.entries()) {
      this.poseLeg(this.legs[index], leg, dt, acting?.obstacles, acting?.groom?.leg === index ? acting.groom : null);
    }
  }

  guardAntenna({ side, pieces, skins, tip }, obstacles, time) {
    const safe = () => {
      pieces[0].getWorldPosition(feelBase);
      pieces[1].getWorldPosition(feelMiddle);
      tip.getWorldPosition(feelTip);
      return !segmentBlocked(obstacles, feelBase, feelMiddle, .026) &&
        !segmentBlocked(obstacles, feelMiddle, feelTip, .044);
    };
    if (safe()) return;
    const reach = segmentReach(obstacles, feelBase, feelTip, .045);
    alternateFeel.copy(feelBase).lerp(feelTip, Math.max(.23, reach * .93));
    this.aimAntenna(pieces, side, alternateFeel, time);
    if (safe()) return;
    for (const [x, y, z] of [[.39, .59, .57], [.12, .76, .44], [.37, .36, -.33], [-.29, .56, .35], [-.20, .41, -.33]]) {
      this.head.localToWorld(alternateFeel.set(x, y, z * side));
      this.aimAntenna(pieces, side, alternateFeel, time);
      if (safe()) return;
    }
    // In a packed gap, retract the articulated tip at its first obstruction.
    for (const [index, part] of pieces.entries()) {
      const next = pieces[index + 1] ?? tip;
      part.getWorldPosition(feelBase);
      next.getWorldPosition(feelTip);
      const fraction = segmentReach(obstacles, feelBase, feelTip, .034);
      if (fraction > .995) continue;
      skins[index].scale.x = antennaLengths[index] * Math.max(0, fraction - .035);
      skins[index].visible = fraction > .07;
      for (let rear = index + 1; rear < pieces.length; rear++) skins[rear].visible = false;
      break;
    }
  }

  aimAntenna(pieces, side, target, time) {
    const base = pieces[0];
    this.head.worldToLocal(feelTarget.set(target.x, target.y, target.z));
    feelDirection.subVectors(feelTarget, base.position);
    const length = feelDirection.length();
    if (length < .001) return;
    feelDirection.multiplyScalar(1 / length);
    const scape = antennaLengths[0];
    const span = THREE.MathUtils.clamp(length, feelerReach - scape + .025, feelerReach + scape - .025);
    const along = (scape * scape + span * span - feelerReach * feelerReach) / (2 * span);
    feelPole.set(-.15, .92, side * .55);
    feelPole.addScaledVector(feelDirection, -feelPole.dot(feelDirection));
    if (feelPole.lengthSq() < .000001) feelPole.set(0, 0, side).addScaledVector(feelDirection, -side * feelDirection.z);
    feelPole.normalize();
    feelElbow.copy(feelDirection).multiplyScalar(along)
      .addScaledVector(feelPole, Math.sqrt(Math.max(0, scape * scape - along * along)));
    feelOuter.copy(feelDirection).multiplyScalar(span).sub(feelElbow);
    base.quaternion.setFromUnitVectors(axis, feelElbow.normalize());
    reverseFeeler.copy(base.quaternion).invert();
    pieces[1].quaternion.setFromUnitVectors(axis, feelOuter.applyQuaternion(reverseFeeler).normalize());
    for (let index = 2; index < pieces.length; index++) {
      pieces[index].rotation.set(0, .015 * side * Math.sin(time * 10 + index * .31), -.012);
    }
  }

  groundRisk(part, samples, terrain) {
    part.updateWorldMatrix(true, false);
    let height = 0, pitch = 0;
    for (const point of samples) {
      this.clearancePoint.copy(point).applyMatrix4(part.matrixWorld);
      const ground = terrainHeight(terrain, this.clearancePoint.x, this.clearancePoint.z);
      const deficit = ground + .027 - this.clearancePoint.y;
      height = Math.max(height, deficit);
      pitch = Math.max(pitch, deficit / Math.max(.23, Math.abs(point.x)));
    }
    return { height, pitch };
  }

  clearBody(terrain) {
    // Use the neck and the three waist articulations for clearance on banks.
    if (this.sting.visible) {
      this.sting.updateMatrix();
      this.extendedStingSample.copy(this.stingTip).applyMatrix4(this.sting.matrix);
      this.gasterSamples.push(this.extendedStingSample);
    }
    let trunkLift = 0;
    for (let pass = 0; pass < 3; pass++) {
      const rear = this.groundRisk(this.gaster, this.gasterSamples, terrain);
      const front = this.groundRisk(this.head, this.headSamples, terrain);
      if (rear.height < .002 && front.height < .002) {
        if (this.sting.visible) this.gasterSamples.pop();
        return;
      }
      const neckLift = Math.min(Math.max(0, .25 - this.head.rotation.z), front.pitch);
      this.head.rotation.z += neckLift;
      const trunkPitch = Math.min(.25 - trunkLift, Math.max(0, front.height - neckLift * .58) * .86);
      this.body.rotateZ(trunkPitch);
      trunkLift += trunkPitch;
      this.waist.rotation.z = Math.max(-.24, this.waist.rotation.z - rear.pitch * .20);
      this.postWaist.rotation.z = Math.max(-.18, this.postWaist.rotation.z - rear.pitch * .17);
      this.gaster.rotation.z = Math.max(-.35, this.gaster.rotation.z - rear.pitch * .63);
    }
    const rear = this.groundRisk(this.gaster, this.gasterSamples, terrain);
    const front = this.groundRisk(this.head, this.headSamples, terrain);
    this.body.position.y += Math.min(.13, Math.max(rear.height, front.height));
    if (this.sting.visible) this.gasterSamples.pop();
  }

  poseLeg(rig, leg, dt, obstacles, groom) {
    const { type, side } = leg;
    hip.set(type.x, type.y, side * type.socket).applyQuaternion(this.body.quaternion).add(this.body.position);
    toe.set(leg.x, leg.y, leg.z);
    if (groom?.reach > 0) {
      cleaningPoint.set(groom.x, groom.y - .675, groom.z).applyQuaternion(this.body.quaternion).add(this.body.position);
      toe.lerp(cleaningPoint, groom.reach);
      toe.y += Math.sin(Math.PI * groom.reach) * .14;
    }
    const swing = Math.sin(Math.PI * leg.swingProgress);
    const foreAft = THREE.MathUtils.clamp((toe.x - hip.x) * forward.x + (toe.z - hip.z) * forward.z, -.85, .85);
    coxa.copy(hip).addScaledVector(bodyOutward, side * .062)
      .addScaledVector(bodyForward, type.coxaSweep + foreAft * .080)
      .addScaledVector(bodyUp, -type.coxaDrop + swing * .025);
    femurBase.copy(coxa).addScaledVector(bodyOutward, side * .052)
      .addScaledVector(bodyForward, foreAft * .027)
      .addScaledVector(bodyUp, -.018);
    footDirection.set(Math.cos(leg.footAngle), 0, Math.sin(leg.footAngle));
    toeBase.copy(toe).addScaledVector(footDirection, -.035);
    toeBase.y += .010;
    ankle.copy(toeBase).addScaledVector(footDirection, -type.foot * (.70 - swing * .14));
    ankle.y += type.foot * (.47 + swing * .16);
    solveKnee(femurBase, ankle, knee, rig, leg, swing, dt);
    if (obstacles?.length) this.clearLeg(obstacles, rig, leg, swing, dt);

    const { segments } = rig;
    for (const segment of segments) segment.visible = true;
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
    rig.foot.rotateZ(-swing * .34);
    rig.foot.visible = true;
    if (obstacles?.length) {
      let clear = true;
      for (const segment of segments) {
        pieceStart.copy(axis).applyQuaternion(segment.quaternion).multiplyScalar(segment.scale.x).add(segment.position);
        clear &&= !segmentBlocked(obstacles, segment.position, pieceStart, segment.scale.y * .80);
        segment.visible = clear;
      }
      rig.foot.visible = clear;
    }
    if (this.markerGroup.visible) {
      for (const [index, point] of [hip, femurBase, knee, ankle, toe].entries()) {
        rig.markers[index].position.copy(point);
      }
    }
    if (this.contacts.visible) {
      rig.contact.visible = !leg.swinging;
      rig.contact.position.set(toe.x, toe.y + .004, toe.z);
    }
  }

  clearLeg(obstacles, rig, leg, swing, dt) {
    const safe = () => !segmentBlocked(obstacles, coxa, femurBase, .044) &&
      !segmentBlocked(obstacles, femurBase, knee, .064) && !segmentBlocked(obstacles, knee, ankle, .054) &&
      !segmentBlocked(obstacles, ankle, toeBase, .034);
    if (safe()) return;
    restToe.copy(toe);
    idealAnkle.copy(ankle);
    for (const [ahead, spread] of stepsAround) {
      safeToe.copy(restToe).addScaledVector(bodyForward, ahead).addScaledVector(bodyOutward, spread * leg.side);
      for (const shell of obstacles) safeToe.y = Math.max(safeToe.y, shellRoof(shell, safeToe.x, safeToe.z, .037) + .022);
      toeBase.copy(safeToe).addScaledVector(footDirection, -.035);
      ankle.copy(toeBase).addScaledVector(footDirection, -leg.type.foot * (.70 - swing * .14));
      ankle.y += leg.type.foot * (.47 + swing * .16);
      if (femurBase.distanceTo(ankle) > leg.type.upper + leg.type.lower + .045) continue;
      solveKnee(femurBase, ankle, knee, rig, leg, swing, dt);
      standardKnee.subVectors(knee, femurBase);
      jointAxis.subVectors(ankle, femurBase).normalize();
      for (const turn of kneeTurns) {
        knee.copy(standardKnee).applyAxisAngle(jointAxis, turn).add(femurBase);
        if (!safe()) continue;
        toe.copy(safeToe);
        return;
      }
    }
    ankle.copy(idealAnkle);
    toeBase.copy(restToe).addScaledVector(footDirection, -.035);
    solveKnee(femurBase, ankle, knee, rig, leg, 0, dt);
  }
}
