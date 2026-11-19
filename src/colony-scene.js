import * as THREE from 'three';
import { seeded } from './brain.js';
import { chunkAt, chunkKey, chunkSize } from './colony-map.js';
import { AntMotion } from './motion.js';
import { WorkerRig } from './worker.js';

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
  skin: new THREE.MeshStandardMaterial({ color: '#b75127', roughness: .53 }),
  rear: new THREE.MeshStandardMaterial({ color: '#542b25', roughness: .44 }),
  signal: new THREE.MeshBasicMaterial({ color: '#a4d7b5', transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide }),
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
  const surface = new THREE.PlaneGeometry(size, size, 48, 48).rotateX(-Math.PI / 2);
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
    ellipsoid(parent, materials.nurse, -2.75 + Math.cos(angle) * radius, .008,
      .15 + Math.sin(angle) * radius, .18, .055, .15);
  }
}

function makeRemoteWorker(parent) {
  const group = new THREE.Group();
  const legs = [];
  ellipsoid(group, materials.skin, .55, .47, 0, .35, .29, .28);
  ellipsoid(group, materials.skin, .03, .43, 0, .40, .24, .23);
  ellipsoid(group, materials.rear, -.67, .40, 0, .46, .32, .33);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = .32 - i * .31;
      const angle = side * (.64 + i * .51);
      const knee = ellipsoid(group, materials.skin, x + .22 * Math.cos(angle), .29, side * .32, .35, .048, .054);
      knee.rotation.y = -side * angle;
      const foot = ellipsoid(group, materials.skin, x, .16, side * .60, .31, .04, .043);
      foot.rotation.x = side * .44;
      foot.rotation.y = side * 1.05;
      legs.push(foot);
    }
  }
  parent.add(group);
  return { group, legs };
}

export class ColonyScene {
  constructor(scene, renderer, software, lowPower) {
    this.scene = scene;
    this.software = software;
    this.lowPower = lowPower;
    this.tiles = new Map();
    this.entities = new THREE.Group();
    this.detail = new THREE.Group();
    this.nest = new THREE.Group();
    this.scene.add(this.entities, this.detail, this.nest);
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
    this.detailed = [];
    this.remote = [];
    this.brood = [];
  }

  setWorld(world, orbitTarget) {
    this.world = world;
    for (const [key, tile] of this.tiles) this.removeTile(key, tile);
    for (const entry of this.detailed) entry.id = null;
    this.queenMotion.terrain = world.height;
    this.queenMotion.reset(0, 0, -.13);
    this.queen.update(this.queenMotion, false, false);
    this.updateTiles(orbitTarget);
  }

  removeTile(key, tile) {
    this.scene.remove(tile.group);
    tile.ground.geometry.dispose();
    tile.scatter.dispose();
    this.tiles.delete(key);
  }

  updateTiles(target) {
    const x = chunkAt(target.x), z = chunkAt(target.z);
    const span = this.lowPower ? 1 : 2;
    for (const [key, tile] of this.tiles) {
      if (Math.abs(x - tile.x) > span || Math.abs(z - tile.z) > span) this.removeTile(key, tile);
    }
    for (let tx = x - span; tx <= x + span; tx++) {
      for (let tz = z - span; tz <= z + span; tz++) {
        const key = chunkKey(tx, tz);
        if (this.tiles.has(key)) continue;
        this.addTile(key, this.world.chunk(tx, tz));
      }
    }
  }

  addTile(key, chunk) {
    const group = new THREE.Group();
    const ground = tileSurface(this.world, chunk, this.ground);
    group.add(ground);
    const patches = chunk.resources.map(patch => makePatch(patch, this.world));
    for (const { group: visual } of patches) group.add(visual);
    const random = seeded(chunk.seed);
    const scatter = new THREE.InstancedMesh(grit, materials.rock, 85);
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    for (let i = 0; i < scatter.count; i++) {
      const x = chunk.x * chunkSize + (random() - .5) * chunkSize;
      const z = chunk.z * chunkSize + (random() - .5) * chunkSize;
      const radius = .035 + random() ** 5 * (.32 + .34 * Number(Math.hypot(x, z) > 18));
      transform.position.set(x, this.world.height(x, z) + radius * .13, z);
      transform.scale.set(radius * (1 + random()), radius * .47, radius * (1 + random() * .45));
      transform.rotation.set(random() * .4, random() * 6, random() * .3);
      transform.updateMatrix();
      scatter.setMatrixAt(i, transform.matrix);
      shade.setRGB(.45 + random() * .55, .52 + random() * .42, .51 + random() * .4);
      scatter.setColorAt(i, shade);
    }
    scatter.computeBoundingSphere();
    group.add(scatter);
    const stems = this.lowPower ? 4 : 8;
    for (let i = 0; i < stems; i++) {
      const x = chunk.x * chunkSize + (random() - .5) * chunkSize;
      const z = chunk.z * chunkSize + (random() - .5) * chunkSize;
      if (Math.hypot(x, z) < 7 || chunk.resources.some(patch => Math.hypot(x - patch.x, z - patch.z) < 1.6)) continue;
      const y = this.world.height(x, z);
      const height = .34 + random() ** 2 * 1.65;
      for (let blade = 0; blade < 3; blade++) {
        const leaf = ellipsoid(group, materials.sprout, x + (blade - 1) * .11, y + height * .41,
          z + (blade === 1 ? .11 : 0), .077, height * (.41 + random() * .18), .025);
        leaf.rotation.z = (blade - 1) * .36;
        leaf.rotation.x = random() * .48;
      }
    }
    this.scene.add(group);
    this.tiles.set(key, { group, ground, patches, x: chunk.x, z: chunk.z, scatter });
  }

  update(colony, target, selected, dt, flags, alpha) {
    this.updateTiles(target);
    for (const tile of this.tiles.values()) {
      for (const visual of tile.patches) {
        const { patch, group } = visual;
        if (patch.units < 1) colony.map.refill(patch, colony.time);
        if (!group.visible && patch.units >= 1) group.visible = true;
        else if (group.visible && patch.units < 1) group.visible = false;
      }
    }
    this.queenPivot.visible = colony.queen.living;
    this.needs.visible = flags.signals && colony.queen.living;
    const urgency = Math.max(colony.signals.food, colony.signals.water);
    this.needs.position.y = .037;
    this.needs.scale.setScalar(2.16 + urgency * .8 + .22 * Math.sin(colony.time * 3));
    materials.signal.opacity = .24 + urgency * .56;
    this.updateBrood(colony.brood);
    this.updateWorkers(colony.workers, target, selected, dt, flags, alpha);
  }

  updateBrood(brood) {
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
      part.scale.set(.17 * size, .072 * size, .083 * size);
      part.rotation.y = specimen.id * 2.4;
    }
    for (let i = brood.length; i < this.brood.length; i++) this.brood[i].visible = false;
  }

  updateWorkers(workers, target, selected, dt, flags, alpha) {
    const limit = this.software ? 2 : this.lowPower ? 3 : 5;
    const visible = workers.filter(worker => Math.hypot(worker.x - target.x, worker.z - target.z) < 39);
    visible.sort((a, b) => (a !== selected) - (b !== selected) ||
      (a.x - target.x) ** 2 + (a.z - target.z) ** 2 - (b.x - target.x) ** 2 - (b.z - target.z) ** 2);
    const chosen = new Set(visible.slice(0, limit).map(worker => worker.id));
    for (const entry of this.detailed) {
      if (chosen.has(entry.id)) continue;
      entry.id = null;
      entry.rig.root.visible = false;
    }
    for (const worker of visible.slice(0, limit)) {
      let entry = this.detailed.find(candidate => candidate.id === worker.id)
        ?? this.detailed.find(candidate => candidate.id === null);
      if (!entry) {
        const motion = new AntMotion(this.world.height);
        const rig = new WorkerRig(this.detail, motion.legs);
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
      if (dt > 0) {
        const previous = worker.previous;
        motion.follow(Math.min(dt, .11), {
          x: THREE.MathUtils.lerp(previous.x, worker.x, alpha),
          z: THREE.MathUtils.lerp(previous.z, worker.z, alpha),
          heading: THREE.MathUtils.lerp(previous.heading, worker.heading, alpha),
          speed: worker.speed, turn: worker.turn, state: worker.state, looking: worker.looking,
        });
      }
      rig.update(motion, flags.joints && selected === worker, flags.contacts && selected === worker,
        flags.sting && selected === worker ? 1 : 0);
      cargo.visible = !!worker.cargo;
      cargo.material = worker.cargo === 'water' ? materials.water : materials.crumb;
    }
    const distant = visible.slice(limit, limit + 75);
    for (const [index, agent] of distant.entries()) {
      const entry = this.remote[index] ?? (this.remote[index] = makeRemoteWorker(this.entities));
      entry.group.visible = true;
      entry.group.position.set(agent.x, this.world.height(agent.x, agent.z), agent.z);
      entry.group.rotation.y = agent.heading;
      for (const [i, foot] of entry.legs.entries()) {
        const phase = Math.sin(agent.age * (12 + agent.speed * 2) + i * Math.PI);
        foot.position.y = .16 + phase * Math.min(.12, agent.speed * .058);
      }
    }
    for (let i = distant.length; i < this.remote.length; i++) this.remote[i].group.visible = false;
  }
}
