import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const unitSphere = new THREE.SphereGeometry(1, 18, 12);
const rod = new THREE.CylinderGeometry(.76, 1, 1, 10, 1);
const fineRod = new THREE.CylinderGeometry(.53, 1, 1, 7, 1);
const jointGeometry = new THREE.SphereGeometry(1, 10, 7);

export function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function cuticle() {
  const size = 256;
  const random = randomGenerator(27);
  const colors = new Uint8Array(size * size * 4);
  const bumps = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const u = Math.PI * 2 * x / size;
      const v = Math.PI * 2 * y / size;
      const mottle = Math.sin(4 * u + 2 * Math.sin(3 * v)) * Math.cos(4 * v + u);
      const fine = Math.sin(63 * u + 111 * v) * Math.cos(49 * v - 51 * u);
      const pore = random();
      const color = 225 + 13 * mottle + 9 * fine - (pore > .98 ? 22 : pore * 9);
      colors.set([color + mottle * 5, color - mottle * 7, color - mottle * 8, 255], offset);
      const relief = 126 + 35 * fine + 12 * mottle - (pore > .97 ? 35 : 0);
      bumps.set([relief, relief, relief, 255], offset);
    }
  }
  const make = (pixels, colorSpace) => {
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = colorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: make(colors, THREE.SRGBColorSpace), bumpMap: make(bumps, THREE.NoColorSpace) };
}

function materials() {
  const maps = cuticle();
  const shell = (color, roughness, bumpScale = .009) => new THREE.MeshPhysicalMaterial({
    color, roughness, ...maps, bumpScale, clearcoat: .27, clearcoatRoughness: .33,
  });
  return {
    thorax: shell('#ab4824', .43),
    head: shell('#a33b1b', .42),
    waist: shell('#78301b', .44),
    gaster: shell('#461e16', .37),
    plates: shell('#391b16', .44),
    legs: shell('#a65936', .48, .005),
    hinge: shell('#713923', .55, .003),
    tarsi: shell('#84482b', .53, .003),
    antenna: shell('#a95a37', .48, .004),
    jaws: shell('#662f1b', .36, .005),
    eye: new THREE.MeshPhysicalMaterial({ color: '#1b1210', roughness: .27, clearcoat: .65 }),
    setae: new THREE.MeshStandardMaterial({ color: '#bd905f', roughness: .75 }),
    jointMarker: new THREE.MeshBasicMaterial({ color: '#ffd58e', depthTest: false }),
    feetMarker: new THREE.MeshBasicMaterial({ color: '#92dfaa', transparent: true, opacity: .83, side: THREE.DoubleSide }),
  };
}

function organicGeometry(rx, ry, rz, character) {
  const geometry = new THREE.SphereGeometry(1, 36, 24);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const irregularity = 1 + .013 * Math.cos(11 * x + 5 * y) * Math.cos(11 * z - 3 * y);
    const cheek = 1 + character * x * .27;
    p.setXYZ(i,
      x * rx * irregularity,
      y * ry * (1 + character * x * .12) * irregularity,
      z * rz * cheek * irregularity,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function ellipsoid(parent, sizes, position, material, character = 0) {
  const mesh = new THREE.Mesh(organicGeometry(...sizes, character), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function hairs(surface, material, count, length, seed) {
  const random = randomGenerator(seed);
  const samples = surface.geometry.attributes.position;
  const normals = surface.geometry.attributes.normal;
  const points = [];
  const base = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const tip = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const index = Math.floor(random() * samples.count);
    base.fromBufferAttribute(samples, index);
    if (base.y < -.09) continue;
    normal.fromBufferAttribute(normals, index).normalize();
    tangent.crossVectors(normal, Math.abs(normal.y) < .93 ? up : new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(.0028);
    tip.copy(base).addScaledVector(normal, length * (.5 + random() * .65));
    tip.x -= length * .25;
    points.push(
      base.x + tangent.x, base.y + tangent.y, base.z + tangent.z,
      base.x - tangent.x, base.y - tangent.y, base.z - tangent.z,
      tip.x, tip.y, tip.z,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  surface.add(mesh);
}

function group(parent, x = 0, y = 0, z = 0) {
  const part = new THREE.Group();
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function sphere(parent, material, size, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(unitSphere, material);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(size);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function link(parent, material, slender = false) {
  const mesh = new THREE.Mesh(slender ? fineRod : rod, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function poseLink(mesh, start, end, radius) {
  mesh.position.addVectors(start, end).multiplyScalar(.5);
  aim.subVectors(end, start);
  mesh.scale.set(radius, aim.length(), radius);
  mesh.quaternion.setFromUnitVectors(up, aim.normalize());
}

const aim = new THREE.Vector3();
const hip = new THREE.Vector3();
const toe = new THREE.Vector3();
const ankle = new THREE.Vector3();
const tarsusDirection = new THREE.Vector3();
const knee = new THREE.Vector3();
const forward = new THREE.Vector3();
const outward = new THREE.Vector3();
const kneeHint = new THREE.Vector3();
const along = new THREE.Vector3();
const pieceStart = new THREE.Vector3();
const pieceEnd = new THREE.Vector3();
const angle = new THREE.Euler(0, 0, 0, 'YXZ');

function bentJoint(base, target, joint, direction, first, second) {
  along.subVectors(target, base);
  const targetDistance = along.length();
  const distance = Math.max(Math.abs(first - second) + .001, Math.min(first + second - .001, targetDistance));
  along.normalize();
  if (targetDistance > distance) target.copy(base).addScaledVector(along, distance);
  direction.addScaledVector(along, -direction.dot(along)).normalize();
  const projection = (first * first - second * second + distance * distance) / (2 * distance);
  joint.copy(base).addScaledVector(along, projection);
  joint.addScaledVector(direction, Math.sqrt(Math.max(0, first * first - projection * projection)));
}

function jaw(parent, material, side) {
  const hinge = group(parent, .323, -.085, .213 * side);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(.112, -.01, .011 * side),
    new THREE.Vector3(.215, -.038, -.048 * side),
    new THREE.Vector3(.225, -.049, -.158 * side),
  ]);
  const geo = new THREE.TubeGeometry(curve, 14, .036, 9, false);
  const attr = geo.attributes.position;
  const center = new THREE.Vector3();
  for (let ring = 0; ring <= 14; ring++) {
    const t = ring / 14;
    curve.getPointAt(t, center);
    for (let vertex = 0; vertex <= 9; vertex++) {
      const index = ring * 10 + vertex;
      const width = 1.54 - .98 * t;
      attr.setXYZ(index, center.x + (attr.getX(index) - center.x) * width,
        center.y + (attr.getY(index) - center.y) * .83,
        center.z + (attr.getZ(index) - center.z) * width);
    }
  }
  geo.computeVertexNormals();
  const blade = new THREE.Mesh(geo, material);
  blade.castShadow = true;
  hinge.add(blade);
  for (let index = 0; index < 4; index++) {
    const base = curve.getPointAt(.43 + index * .134);
    const end = base.clone().add(new THREE.Vector3(.018, 0, -side * (.052 - index * .007)));
    poseLink(link(hinge, material, true), base, end, .024 - index * .003);
  }
  return hinge;
}

function antenna(parent, material, side) {
  const base = group(parent, .252, .197, .183 * side);
  const lengths = [.46, .092, .090, .072, .065, .062, .060, .060, .078, .091];
  const pieces = [];
  let pivot = base;
  for (const [index, length] of lengths.entries()) {
    const radius = index === 0 ? .028 : index >= 8 ? .031 + (index - 8) * .005 : .020;
    const body = ellipsoid(pivot, [length * .56, radius, radius * .97], [length * .5, 0, 0], material, -.20);
    if (index >= 8) body.rotation.z = -.06;
    pieces.push(pivot);
    pivot = group(pivot, length, 0, 0);
  }
  return { side, pieces };
}

export class WorkerRig {
  constructor(scene, legs) {
    this.material = materials();
    const m = this.material;
    this.root = group(scene);
    this.body = group(this.root);
    this.segment(.28, .039, 0, [.405, .246, .251], m.thorax, .6, 105, 32);
    this.segment(-.12, .025, 0, [.340, .185, .210], m.thorax, .1, 62, 30);
    this.segment(-.42, .008, 0, [.256, .158, .176], m.waist, .38, 38, 14);
    this.segment(.62, .032, 0, [.22, .133, .158], m.hinge, .2, 34, 35);

    this.head = group(this.body, .83, .105, 0);
    const cap = ellipsoid(this.head, [.45, .316, .348], [0, 0, 0], m.head, -.28);
    hairs(cap, m.setae, 160, .044, 63);
    ellipsoid(this.head, [.23, .146, .255], [.235, -.07, 0], m.thorax, -.45);
    this.jaws = [-1, 1].map(side => jaw(this.head, m.jaws, side));
    this.antennae = [-1, 1].map(side => antenna(this.head, m.antenna, side));
    for (const side of [-1, 1]) {
      const eye = ellipsoid(this.head, [.102, .087, .038], [.105, .090, side * .323], m.eye, 0);
      eye.rotation.y = -side * .34;
      const random = randomGenerator(810);
      for (let i = 0; i < 34; i++) {
        const azimuth = random() * Math.PI * 2;
        const radial = Math.sqrt(random()) * .85;
        const x = Math.cos(azimuth) * radial;
        const y = Math.sin(azimuth) * radial;
        const z = Math.sqrt(1 - radial * radial);
        sphere(eye, m.eye, .006, .102 * x, .087 * y, side * (.038 * z + .001));
      }
    }

    this.waist = group(this.body, -.55, -.012, 0);
    ellipsoid(this.waist, [.201, .115, .107], [-.124, .004, 0], m.waist);
    ellipsoid(this.waist, [.118, .123, .110], [-.176, .055, 0], m.thorax);
    this.postWaist = group(this.waist, -.296, .019, 0);
    ellipsoid(this.postWaist, [.158, .126, .134], [-.097, .006, 0], m.waist, -.36);
    this.gaster = group(this.postWaist, -.172, -.01, 0);
    const abdomen = ellipsoid(this.gaster, [.596, .332, .365], [-.326, .012, 0], m.gaster, .66);
    hairs(abdomen, m.setae, 160, .042, 84);
    for (const [x, ry, rz] of [[-.53, .318, .339], [-.65, .284, .306], [-.765, .229, .234]]) {
      const plates = ellipsoid(this.gaster, [.126, ry, rz], [x, .011, 0], m.plates, .53);
      hairs(plates, m.setae, 27, .035, Math.round(1000 * -x));
    }
    this.sting = group(this.gaster, -.89, -.077, 0);
    poseLink(link(this.sting, m.jaws, true), new THREE.Vector3(.018, 0, 0), new THREE.Vector3(-.071, -.025, 0), .017);

    this.markerGroup = group(this.root);
    this.markerGroup.visible = false;
    this.contacts = group(this.root);
    this.contacts.visible = false;
    const footRing = new THREE.RingGeometry(.056, .071, 22);
    this.legs = legs.map(leg => {
      const socket = sphere(this.body, m.hinge, .092, leg.type.x, -.095, leg.side * .174);
      socket.scale.set(.103, .082, .102);
      const segments = [
        link(this.root, m.hinge), link(this.root, m.legs), link(this.root, m.legs),
        ...Array.from({ length: 5 }, () => link(this.root, m.tarsi, true)),
      ];
      const joints = Array.from({ length: 3 }, () => new THREE.Mesh(jointGeometry, m.hinge));
      this.root.add(...joints);
      const markers = Array.from({ length: 4 }, () => {
        const marker = sphere(this.markerGroup, m.jointMarker, .042);
        marker.renderOrder = 8;
        marker.castShadow = false;
        return marker;
      });
      const contact = new THREE.Mesh(footRing, m.feetMarker);
      contact.rotation.x = -Math.PI / 2;
      this.contacts.add(contact);
      return { segments, joints, markers, contact };
    });
    this.updateAnatomyMarkers();
  }

  segment(x, y, z, sizes, material, character, count, seed) {
    const segment = ellipsoid(this.body, sizes, [x, y, z], material, character);
    hairs(segment, this.material.setae, count, .039, seed);
  }

  updateAnatomyMarkers() {
    const addMarker = (parent, size) => {
      const marker = sphere(parent, this.material.jointMarker, size);
      marker.castShadow = false;
      marker.renderOrder = 8;
      return marker;
    };
    this.anatomyMarkers = [
      addMarker(this.head, .044), addMarker(this.waist, .043),
      addMarker(this.postWaist, .041), addMarker(this.gaster, .04),
      ...this.jaws.map(j => addMarker(j, .033)),
      ...this.antennae.flatMap(a => [addMarker(a.pieces[0], .036), addMarker(a.pieces[1], .029)]),
    ];
  }

  update(motion, showJoints, showContacts) {
    const pose = motion.bodyPose();
    this.body.position.set(motion.x, pose.height, motion.z);
    this.body.quaternion.setFromEuler(angle.set(pose.roll, motion.heading, pose.pitch));
    const time = motion.clock;
    const activity = Math.min(1, motion.speed / 2.45);
    this.head.rotation.set(Math.sin(time * 5.4) * .019, Math.sin(time * 3.4) * .097, -.024 + Math.sin(time * 4.1) * .043);
    this.waist.rotation.y = Math.sin(motion.stride * 2 * Math.PI) * .044 * activity;
    this.waist.rotation.z = Math.sin(time * 3.5) * .043 + .07;
    this.postWaist.rotation.y = -.56 * this.waist.rotation.y;
    this.gaster.rotation.z = Math.sin(time * 3.5 - .65) * .033 - .025;
    this.sting.rotation.z = .11 + Math.sin(time * 2) * .07;
    for (const [index, hinge] of this.jaws.entries()) {
      const side = index === 0 ? -1 : 1;
      hinge.rotation.y = side * (-.10 - .10 * (.5 + .5 * Math.sin(time * 3.2)) ** 4);
    }
    for (const { side, pieces } of this.antennae) {
      const sweep = Math.sin(time * 6.6 + (side === -1 ? 0 : 1.8));
      pieces[0].rotation.set(0, -side * (.49 + .27 * sweep), .38 + .13 * Math.sin(time * 4.8 + side));
      pieces[1].rotation.set(0, side * (.31 + .23 * sweep), -.72 + .13 * Math.sin(time * 6.3 + side));
      for (let index = 2; index < pieces.length; index++) {
        pieces[index].rotation.z = -.046 + Math.sin(time * 6.8 - index * .31 + side) * .047;
        pieces[index].rotation.y = side * (.025 + Math.sin(time * 3.7 - index * .17) * .021);
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
    hip.set(type.x, -.102, side * .220).applyQuaternion(this.body.quaternion).add(this.body.position);
    toe.set(leg.x, leg.y, leg.z);
    tarsusDirection.subVectors(hip, toe);
    tarsusDirection.y = 0;
    tarsusDirection.normalize();
    ankle.copy(toe).addScaledVector(tarsusDirection, type.foot * .77);
    ankle.y += type.foot * .57;
    kneeHint.set(0, 1, 0).addScaledVector(outward, .86 * side).addScaledVector(forward, type.x * .55);
    bentJoint(hip, ankle, knee, kneeHint, type.upper, type.lower);

    pieceEnd.copy(hip).lerp(knee, .16);
    poseLink(rig.segments[0], hip, pieceEnd, .054);
    poseLink(rig.segments[1], pieceEnd, knee, .047);
    poseLink(rig.segments[2], knee, ankle, .036);
    pieceStart.copy(ankle);
    for (let index = 0; index < 5; index++) {
      const fraction = (index + 1) / 5;
      pieceEnd.copy(ankle).lerp(toe, fraction);
      pieceEnd.y -= .028 * Math.sin(Math.PI * fraction);
      poseLink(rig.segments[index + 3], pieceStart, pieceEnd, .024 - .0027 * index);
      pieceStart.copy(pieceEnd);
    }
    for (const [index, point] of [hip, knee, ankle, toe].entries()) {
      rig.markers[index].position.copy(point);
      if (index < 3) {
        rig.joints[index].position.copy(point);
        rig.joints[index].scale.setScalar([.052, .041, .029][index]);
      }
    }
    rig.contact.visible = !leg.swinging;
    rig.contact.position.set(toe.x, toe.y + .004, toe.z);
  }
}
