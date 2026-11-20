import * as THREE from 'three';
import { seeded } from './brain.js';
import { chunkAt, chunkKey, chunkSize } from './colony-map.js';
import { AntMotion } from './motion.js';
import { WorkerRig } from './worker.js';
import { nursery, queenHeading } from './colony.js';
import { QueenActing } from './queen-acting.js';
import { WorkerBatches } from './worker-batches.js';
import { bodyShells } from './body-space.js';
import { groomPose } from './grooming.js';

const sphere = new THREE.SphereGeometry(1, 12, 8);
const grit = new THREE.IcosahedronGeometry(1, 1);
const ring = new THREE.RingGeometry(.95, 1, 54).rotateX(-Math.PI / 2);
const materials = {
  rock: new THREE.MeshStandardMaterial({ color: '#806852', roughness: .94 }),
  sprout: new THREE.MeshStandardMaterial({ color: '#5e6c46', roughness: .84 }),
  crumb: new THREE.MeshStandardMaterial({ color: '#d9a04b', roughness: .80 }),
  rind: new THREE.MeshStandardMaterial({ color: '#9b632e', roughness: .89 }),
  bank: new THREE.MeshStandardMaterial({ color: '#544f47', roughness: .91 }),
  water: new THREE.MeshPhysicalMaterial({ color: '#4d9c9c', metalness: .42, roughness: .20, clearcoat: 1 }),
  ripple: new THREE.MeshBasicMaterial({ color: '#98cfcb', transparent: true, opacity: .38, depthWrite: false, side: THREE.DoubleSide }),
  nurse: new THREE.MeshStandardMaterial({ color: '#8d7056', roughness: .98 }),
  egg: new THREE.MeshStandardMaterial({ color: '#ede6c8', roughness: .55 }),
  larva: new THREE.MeshStandardMaterial({ color: '#e0c69a', roughness: .73 }),
  pupa: new THREE.MeshStandardMaterial({ color: '#c69a70', roughness: .76 }),
  signal: new THREE.MeshBasicMaterial({ color: '#a4d7b5', transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide }),
  selected: new THREE.MeshBasicMaterial({ color: '#e9b985', transparent: true, opacity: .75, depthWrite: false, side: THREE.DoubleSide }),
};

function ellipsoid(parent, material, x, y, z, sx, sy, sz) {
  const part = new THREE.Mesh(sphere, material);
  part.position.set(x, y, z);
  part.scale.set(sx, sy, sz);
  parent.add(part);
  return part;
}

function tileSurface(world, chunk, material) {
  const size = chunkSize;
  const surface = new THREE.PlaneGeometry(size, size, 24, 24).rotateX(-Math.PI / 2);
  const data = surface.attributes.position;
  const uv = surface.attributes.uv;
  const offsetX = chunk.x * size, offsetZ = chunk.z * size;
  const colors = new Float32Array(data.count * 3);
  const shade = new THREE.Color();
  for (let i = 0; i < data.count; i++) {
    const x = data.getX(i) + offsetX, z = data.getZ(i) + offsetZ;
    const elevation = world.height(x, z);
    data.setY(i, elevation);
    uv.setXY(i, x * .42, z * .42);
    const earth = .5 + .5 * Math.sin(x * .112 + z * .137) * Math.cos(z * .093 - .12 * x);
    const bed = .5 + .5 * Math.sin(x * .32 - z * .27) * Math.cos(x * .18 + z * .24);
    shade.setRGB(.65 + earth * .18 + bed * .12, .46 + earth * .14 + bed * .13, .33 + earth * .12 + bed * .11);
    shade.toArray(colors, i * 3);
  }
  surface.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  surface.computeVertexNormals();
  const plane = new THREE.Mesh(surface, material);
  plane.position.set(offsetX, 0, offsetZ);
  plane.receiveShadow = true;
  return plane;
}

function makePatch(patch, world) {
  const group = new THREE.Group();
  const y = world.height(patch.x, patch.z);
  group.position.set(patch.x, y + .025, patch.z);
  const random = seeded((Math.floor(patch.x * 752) ^ Math.floor(patch.z * 13301)) || 1);
  if (patch.kind === 'food') {
    for (let i = 0; i < 13; i++) {
      const a = i * 2.399963;
      const radius = Math.sqrt(i) * .15;
      const grain = ellipsoid(group, i % 4 ? materials.crumb : materials.rind,
        Math.cos(a) * radius, .045 + random() * .07, Math.sin(a) * radius,
        .086 + random() * .15, .06 + random() * .065, .078 + random() * .105);
      grain.rotation.y = a;
      grain.rotation.z = (random() - .5) * .4;
      grain.castShadow = true;
    }
  } else {
    ellipsoid(group, materials.bank, 0, .005, 0, .94, .045, .73);
    ellipsoid(group, materials.water, 0, .042, 0, .84, .064, .67);
    for (const size of [.41, .68]) {
      const ripple = new THREE.Mesh(ring, materials.ripple);
      ripple.position.y = .106;
      ripple.scale.set(size, 1, size * .76);
      group.add(ripple);
    }
    for (let i = 0; i < 11; i++) {
      const a = i * Math.PI * 2 / 11;
      ellipsoid(group, materials.rock, Math.cos(a) * .93, .03, Math.sin(a) * .75,
        .09 + .09 * random(), .04 + .08 * random(), .105 + .068 * random());
    }
  }
  return { patch, group };
}

function makeNursery(parent) {
  for (let i = 0; i < 25; i++) {
    const angle = i * 2.399963;
    const radius = 1 + Math.sqrt(i) * .066;
    ellipsoid(parent, materials.nurse, nursery.x + Math.cos(angle) * radius, .008,
      nursery.z + Math.sin(angle) * radius, .18, .055, .15);
  }
}

const inView = new THREE.Frustum();
const cameraTransform = new THREE.Matrix4();
const workerBounds = new THREE.Sphere(new THREE.Vector3(), 2.8);
const contactFrom = new THREE.Vector3();
const contactTo = new THREE.Vector3();

export class ColonyScene {
  constructor(scene, renderer, software, lowPower) {
    this.scene = scene;
    this.software = software;
    this.lowPower = lowPower;
    this.tiles = new Map();
    this.entities = new THREE.Group();
    this.detail = new THREE.Group();
    this.nest = new THREE.Group();
    this.scene.add(this.entities, this.nest);
    if (software) this.scene.add(this.detail);
    this.batches = software ? null : new WorkerBatches(scene);
    const texture = new THREE.TextureLoader().load('./textures/loam.webp');
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.ground = new THREE.MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: .026,
      vertexColors: true, roughness: .98 });
    this.queenMotion = new AntMotion();
    this.queenPivot = new THREE.Group();
    this.queenPivot.scale.setScalar(1.67);
    this.nest.add(this.queenPivot);
    this.queen = new WorkerRig(this.queenPivot, this.queenMotion.legs);
    this.queen.gaster.scale.set(1.34, 1.19, 1.28);
    makeNursery(this.nest);
    this.needs = new THREE.Mesh(ring, materials.signal);
    this.nest.add(this.needs);
    this.selectionRing = new THREE.Mesh(ring, materials.selected);
    this.scene.add(this.selectionRing);
    this.selectionRing.visible = false;
    this.detailed = [];
    this.visualShells = new Map();
    this.queenActing = new QueenActing();
    this.queenTransfer = ellipsoid(this.entities, materials.water, 0, 0, 0, .10, .10, .10);
    this.queenTransfer.visible = false;
    this.eggOrigin = new THREE.Vector3();
    this.brood = [];
  }

  pick(raycaster) {
    const meshes = [];
    const collect = (rig, id) => {
      rig.root.updateWorldMatrix(true, true);
      rig.root.traverseVisible(part => {
        if (!part.isMesh || !part.geometry.userData.profile) return;
        part.userData.antId = id;
        meshes.push(part);
      });
    };
    if (this.queenPivot.visible) collect(this.queen, 0);
    for (const entry of this.detailed) if (entry.id !== null) collect(entry.rig, entry.id);
    return raycaster.intersectObjects(meshes, false)[0]?.object.userData.antId ?? null;
  }

  setWorld(world, orbitTarget) {
    this.world = world;
    for (const [key, tile] of this.tiles) this.removeTile(key, tile);
    for (const entry of this.detailed) entry.id = null;
    this.queenMotion.terrain = world.height;
    this.tileWindow = '';
    this.resourceVersion = world.resourceVersion;
    this.queenActing.reset();
    this.queenMotion.reset(0, 0, queenHeading);
    this.queen.update(this.queenMotion, false, false);
    this.updateTiles(orbitTarget);
  }

  removeTile(key, tile) {
    this.scene.remove(tile.group);
    tile.ground.geometry.dispose();
    tile.scatter?.dispose();
    this.tiles.delete(key);
  }

  updateTiles(target, distance = 17) {
    const x = chunkAt(target.x), z = chunkAt(target.z);
    const detail = this.lowPower ? 1 : 2;
    const span = this.software ? 1 : distance > 37 ? 3 : 2;
    const window = `${x}/${z}/${span}/${detail}`;
    if (window === this.tileWindow) return;
    this.tileWindow = window;
    for (const [key, tile] of this.tiles) {
      if (Math.abs(x - tile.x) > span || Math.abs(z - tile.z) > span) this.removeTile(key, tile);
    }
    for (let tx = x - span; tx <= x + span; tx++) {
      for (let tz = z - span; tz <= z + span; tz++) {
        const key = chunkKey(tx, tz);
        const decorate = Math.abs(tx - x) <= detail && Math.abs(tz - z) <= detail;
        const existing = this.tiles.get(key);
        if (!existing) this.addTile(key, this.world.chunk(tx, tz), decorate);
        else if (existing.props) existing.props.visible = decorate;
        else if (decorate) this.decorateTile(existing, this.world.chunk(tx, tz));
      }
    }
  }

  addTile(key, chunk, decorate) {
    const group = new THREE.Group();
    const ground = tileSurface(this.world, chunk, this.ground);
    group.add(ground);
    this.scene.add(group);
    const tile = { group, ground, patches: [], x: chunk.x, z: chunk.z };
    this.tiles.set(key, tile);
    if (decorate) this.decorateTile(tile, chunk);
  }

  decorateTile(tile, chunk) {
    const group = new THREE.Group();
    tile.group.add(group);
    tile.props = group;
    this.syncPatches(tile, chunk);
    const random = seeded(chunk.seed);
    const scatter = new THREE.InstancedMesh(grit, materials.rock, chunk.stones.length);
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    for (const [i, { x, y, z, radius }] of chunk.stones.entries()) {
      transform.position.set(x, y, z);
      transform.scale.set(radius * (1 + random() * .33), radius * .47, radius * (1 + random() * .27));
      transform.rotation.set(random() * .4, random() * 6, random() * .3);
      transform.updateMatrix();
      scatter.setMatrixAt(i, transform.matrix);
      shade.setRGB(.45 + random() * .55, .52 + random() * .42, .51 + random() * .4);
      scatter.setColorAt(i, shade);
    }
    scatter.computeBoundingSphere();
    group.add(scatter);
    for (const { x, y, z, height } of chunk.plants) {
      for (let blade = 0; blade < 3; blade++) {
        const leaf = ellipsoid(group, materials.sprout, x + (blade - 1) * .11, y + height * .41,
          z + (blade === 1 ? .11 : 0), .077, height * (.41 + random() * .18), .025);
        leaf.rotation.z = (blade - 1) * .36;
        leaf.rotation.x = random() * .48;
      }
    }
    tile.scatter = scatter;
  }

  syncPatches(tile, chunk) {
    const active = new Map(tile.patches.map(visual => [visual.patch, visual]));
    tile.patches = chunk.resources.map(patch => {
      const existing = active.get(patch);
      if (existing) {
        active.delete(patch);
        return existing;
      }
      const visual = makePatch(patch, this.world);
      tile.props.add(visual.group);
      return visual;
    });
    for (const { group } of active.values()) tile.props.remove(group);
  }

  update(colony, target, selected, dt, flags, alpha, camera, visualDt) {
    this.updateTiles(target, camera.position.distanceTo(target));
    camera.updateMatrixWorld();
    cameraTransform.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    inView.setFromProjectionMatrix(cameraTransform);
    const resourcesMoved = this.resourceVersion !== this.world.resourceVersion;
    this.resourceVersion = this.world.resourceVersion;
    for (const tile of this.tiles.values()) {
      if (resourcesMoved && tile.props) this.syncPatches(tile, this.world.chunk(tile.x, tile.z));
      for (const visual of tile.patches) {
        const { patch, group } = visual;
        if (patch.units < 1) colony.map.refill(patch, colony.time);
        if (!group.visible && patch.units >= 1) group.visible = true;
        else if (group.visible && patch.units < 1) group.visible = false;
      }
    }
    this.nest.visible = !colony.mode;
    this.queenPivot.visible = colony.queen.living;
    this.visualShells.clear();
    for (const worker of colony.workers) {
      const previous = worker.previous;
      const x = THREE.MathUtils.lerp(previous.x, worker.x, alpha);
      const z = THREE.MathUtils.lerp(previous.z, worker.z, alpha);
      const heading = THREE.MathUtils.lerp(previous.heading, worker.heading, alpha);
      const lift = THREE.MathUtils.lerp(previous.lift ?? 0, worker.lift, alpha);
      this.visualShells.set(worker, { x, z, heading, lift, alpha,
        lobes: bodyShells(worker, this.world.height, x, z, heading, lift) });
    }
    this.visualShells.set(colony.queen, { lobes: bodyShells(colony.queen, this.world.height) });
    const highlighted = flags.selectedId === 0 ? colony.queen
      : colony.workers.find(worker => worker.id === flags.selectedId);
    this.selectionRing.visible = !!highlighted && highlighted.living !== false;
    if (this.selectionRing.visible) {
      const at = highlighted.queen ? highlighted : this.visualShells.get(highlighted);
      this.selectionRing.position.set(at.x, this.world.height(at.x, at.z) + .035, at.z);
      this.selectionRing.scale.setScalar(highlighted.queen ? 1.24 : .58);
    }
    this.needs.visible = flags.signals && colony.queen.living;
    const urgency = Math.max(colony.signals.food, colony.signals.water);
    this.needs.position.y = .037;
    this.needs.scale.setScalar(2.16 + urgency * .8 + .22 * Math.sin(colony.time * 3));
    materials.signal.opacity = .24 + urgency * .56;
    const performance = this.queenActing.step(colony.queen.events, visualDt, colony.time);
    this.updateQueen(performance, visualDt, this.obstacles(colony, colony.queen, 4.25));
    this.updateBrood(colony.brood, performance);
    this.updateWorkers(colony, selected, dt, flags);
  }

  obstacles(colony, body, distance = 3.75) {
    return colony.space.near(body, distance).flatMap(entry => this.visualShells.get(entry.body)?.lobes ?? []);
  }

  updateQueen(performance, dt, obstacles) {
    this.queenMotion.clock += dt;
    this.queenTransfer.visible = false;
    if (!this.queenPivot.visible) return;
    if (!dt && !performance) return;
    const scale = this.queenPivot.scale.x;
    const local = obstacles.map(lobe => ({ ...lobe, x: lobe.x / scale, y: lobe.y / scale,
      z: lobe.z / scale, a: lobe.a / scale, b: lobe.b / scale, c: lobe.c / scale }));
    this.queen.update(this.queenMotion, false, false, 0, { ...performance, obstacles: local, antennaObstacles: obstacles });
    if (!performance) return;
    if (performance.event.kind === 'egg') {
      this.queen.gaster.localToWorld(this.eggOrigin.set(-.97, -.145, 0));
    } else if (performance.visible) {
      const event = performance.event;
      this.queen.head.localToWorld(contactTo.set(.87, -.21, 0));
      this.queenTransfer.position.copy(contactFrom.set(event.x, event.y, event.z)).lerp(contactTo, performance.transfer);
      const size = .104 * (1 - performance.transfer * .62);
      this.queenTransfer.scale.set(size, size * 1.13, size);
      this.queenTransfer.material = event.kind === 'water' ? materials.water : materials.crumb;
      this.queenTransfer.visible = true;
    }
  }

  updateBrood(brood, performance) {
    const stages = [materials.egg, materials.larva, materials.pupa];
    for (let i = 0; i < brood.length; i++) {
      const specimen = brood[i];
      const part = this.brood[i] ?? (this.brood[i] =
        ellipsoid(this.entities, materials.egg, 0, 0, 0, .17, .09, .08));
      part.visible = true;
      part.material = stages[specimen.stage];
      const size = 1 + .57 * specimen.stage;
      part.position.set(specimen.x, this.world.height(specimen.x, specimen.z) +
        (specimen.carriedBy ? .52 : .075 + specimen.layer * .129), specimen.z);
      if (!specimen.carriedBy && specimen.id === performance?.event.id && performance.event.kind === 'egg') {
        part.visible = performance.visible;
        part.position.lerp(this.eggOrigin, 1 - performance.deposit);
        part.position.y += Math.sin(performance.deposit * Math.PI) * .12;
      }
      part.scale.set(.17 * size, .072 * size, .083 * size);
      part.rotation.y = specimen.id * 2.4;
    }
    for (let i = brood.length; i < this.brood.length; i++) this.brood[i].visible = false;
  }

  blendLabPose(worker, entry, alpha) {
    const { body, previous } = worker;
    if (!previous.feet) return body;
    const pose = entry.labPose ?? (entry.labPose = {
      joints: {}, legs: body.legs.map(() => ({ points: Array.from({ length: 10 }, () => new THREE.Vector3()) })),
    });
    const mix = THREE.MathUtils.lerp;
    for (const key of ['height', 'pitch', 'roll', 'jaw']) pose[key] = mix(previous[key], body[key], alpha);
    for (const key of Object.keys(body.joints)) pose.joints[key] = mix(previous.joints[key], body.joints[key], alpha);
    pose.antennae = body.antennae;
    pose.clock = body.clock;
    for (const [i, leg] of body.legs.entries()) {
      const rendered = pose.legs[i];
      rendered.type = leg.type;
      rendered.side = leg.side;
      rendered.ground = leg.ground;
      for (const [j, point] of rendered.points.entries()) {
        const start = previous.feet[i][j], end = leg.points[j];
        point.set(mix(start.x, end.x, alpha), mix(start.y, end.y, alpha), mix(start.z, end.z, alpha));
      }
    }
    return pose;
  }

  updateWorkers(colony, selected, dt, flags) {
    const visible = colony.workers.filter(worker => {
      workerBounds.center.set(worker.x, .60, worker.z);
      return inView.intersectsSphere(workerBounds);
    });
    const visibleIds = new Set(visible.map(worker => worker.id));
    const available = [];
    for (const entry of this.detailed) {
      if (visibleIds.has(entry.id)) continue;
      entry.id = null;
      entry.rig.root.visible = false;
      available.push(entry);
    }
    const active = new Map(this.detailed.filter(entry => entry.id !== null).map(entry => [entry.id, entry]));
    this.batches?.reset();
    for (const worker of visible) {
      let entry = active.get(worker.id) ?? available.pop();
      if (!entry) {
        const motion = new AntMotion(this.world.height);
        const rig = new WorkerRig(this.detail, motion.legs, true);
        const cargo = ellipsoid(rig.head, materials.crumb, .84, -.19, .012, .102, .057, .078);
        entry = { id: null, motion, rig, cargo };
        this.detailed.push(entry);
      }
      const { motion, rig, cargo } = entry;
      if (entry.id !== worker.id || Math.hypot(worker.x - motion.x, worker.z - motion.z) > 2.5) {
        entry.id = worker.id;
        motion.terrain = this.world.height;
        motion.reset(worker.x, worker.z, worker.heading);
      }
      rig.root.visible = true;
      const pose = this.visualShells.get(worker);
      const groom = worker.grooming ? groomPose(worker.grooming, colony.time) : null;
      if (!worker.body && dt > 0) {
        motion.follow(Math.min(dt, .11), {
          ...pose, speed: worker.speed, turn: worker.turn, state: worker.state, looking: worker.looking, groom,
        });
      }
      const obstacles = this.obstacles(colony, worker);
      const direct = worker.body ? this.blendLabPose(worker, entry, pose.alpha) : null;
      const rigMotion = direct ? { x: pose.x, z: pose.z, heading: pose.heading, clock: direct.clock, legs: direct.legs,
        joints: direct.joints, bodyPose: () => direct, terrain: this.world.height } : motion;
      rig.update(rigMotion, flags.joints && selected === worker, flags.contacts && selected === worker,
        flags.sting && selected === worker ? 1 : 0, { probes: groom ? null : worker.probes, obstacles,
          antennaObstacles: obstacles, groom, manual: direct });
      rig.setGrime(worker.grime);
      cargo.visible = !!worker.cargo;
      cargo.material = worker.cargo === 'water' ? materials.water : materials.crumb;
      this.batches?.add(rig.root);
    }
    this.batches?.commit();
  }
}
