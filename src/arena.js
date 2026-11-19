import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { arenaLimit, AntMotion, terrainHeight } from './motion.js';
import { randomGenerator, WorkerRig } from './worker.js';
import { SoftwareView } from './software-view.js';

const origin = new THREE.Vector3();
const terrainColors = { loam: '#94775a', gravel: '#8d8172', tunnel: '#826a4f' };
const scatterPalette = ['#877260', '#715744', '#584738', '#766450', '#b18e68', '#54483e', '#c1a684'];

function makeTerrain(scene, renderer) {
  const texture = new THREE.TextureLoader().load('./textures/loam.webp');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(13, 13);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const material = new THREE.MeshStandardMaterial({
    map: texture, bumpMap: texture, bumpScale: .027, color: terrainColors.loam, roughness: .94,
  });
  const geometry = new THREE.PlaneGeometry(34, 34, 220, 220).rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(geometry, material);
  floor.receiveShadow = true;
  scene.add(floor);

  const stone = new THREE.IcosahedronGeometry(1, 1);
  const position = stone.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const variation = 1 + .2 * Math.sin(x * 14 + z * 8) * Math.cos(y * 13 + x * 6);
    position.setXYZ(index, x * variation, y * variation, z * variation);
  }
  stone.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(stone, new THREE.MeshStandardMaterial({
    roughness: .96, flatShading: true, color: '#ffffff',
  }), 760);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);
  const scratch = new THREE.Object3D();
  const tint = new THREE.Color();

  function set(preset) {
    const points = geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const x = points.getX(i), z = points.getZ(i);
      points.setY(i, terrainHeight(preset, x, z));
    }
    points.needsUpdate = true;
    geometry.computeVertexNormals();
    material.color.set(terrainColors[preset]);
    const seeded = randomGenerator(429);
    rocks.count = preset === 'gravel' ? 760 : 580;
    for (let i = 0; i < rocks.count; i++) {
      const x = (seeded() - .5) * 23;
      const z = (seeded() - .5) * 23;
      const floorHeight = terrainHeight(preset, x, z);
      // Keep large pieces outside the walking area. Small grit sits within the contact surface.
      const edge = Math.max(Math.abs(x), Math.abs(z)) > 7.75 || (preset === 'tunnel' && floorHeight > .92);
      const size = edge ? .05 + seeded() ** 3 * .55 : .012 + seeded() ** 3 * (preset === 'gravel' ? .084 : .059);
      scratch.position.set(x, floorHeight + size * (edge ? .11 : -.14), z);
      scratch.scale.set(size * (1 + seeded()), size * (.40 + seeded() * .27), size * (.64 + seeded() * .57));
      scratch.rotation.set(seeded(), seeded() * Math.PI * 2, seeded());
      scratch.updateMatrix();
      rocks.setMatrixAt(i, scratch.matrix);
      tint.set(scatterPalette[Math.floor(seeded() * scatterPalette.length)]).multiplyScalar(.78 + seeded() * .22);
      rocks.setColorAt(i, tint);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
  }
  return { floor, set };
}

export class Arena {
  constructor(host, onStats) {
    this.host = host;
    this.onStats = onStats;
    this.motion = new AntMotion();
    this.flags = { paused: false, joints: false, contacts: false, rate: 1, quality: 'auto', guide: false };
    this.lastStamp = 0;
    this.accumulator = 0;
    this.lastUIUpdate = -Infinity;
    this.view = 'orbit';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a221b');
    this.scene.fog = new THREE.FogExp2('#2b241d', .051);
    this.camera = new THREE.PerspectiveCamera(36, 1, .07, 72);
    const surface = document.createElement('canvas');
    const context = surface.getContext('webgl2', { antialias: true, alpha: false });
    this.software = !context;
    this.renderer = context ? new THREE.WebGLRenderer({ canvas: surface, context }) : new SoftwareView();
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D simulation. Arrow keys steer the ant.');
    this.host.replaceChildren(canvas);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = .10;
    this.orbit.enablePan = false;
    this.orbit.minPolarAngle = .065;
    this.orbit.maxPolarAngle = Math.PI * .474;
    this.orbit.minDistance = 2.3;
    this.orbit.maxDistance = 16.5;
    this.orbit.rotateSpeed = .74;

    if (!this.software) {
      const studio = new RoomEnvironment();
      const generator = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = generator.fromScene(studio, .08).texture;
      this.scene.environmentIntensity = .63;
      studio.dispose();
      generator.dispose();
    }

    this.scene.add(new THREE.HemisphereLight('#e8e0d2', '#836250', 1.2));
    this.sun = new THREE.DirectionalLight('#ffe2bd', 3.4);
    this.sun.position.set(3.3, 6.0, -4.0);
    this.sun.castShadow = true;
    this.sun.shadow.camera.near = .2;
    this.sun.shadow.camera.far = 27;
    this.sun.shadow.normalBias = .025;
    this.sun.shadow.bias = -.00016;
    this.scene.add(this.sun, this.sun.target);
    const bounce = new THREE.DirectionalLight('#e0e5f7', .80);
    bounce.position.set(-3, 3, 4);
    this.scene.add(bounce);

    this.terrain = makeTerrain(this.scene, this.renderer);
    this.terrain.set(this.motion.terrain);
    this.rig = new WorkerRig(this.scene, this.motion.legs);
    this.rig.update(this.motion, false, false);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.compass = new THREE.Mesh(
      new THREE.RingGeometry(.14, .18, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffcf96', side: THREE.DoubleSide, depthWrite: false }),
    );
    this.compass.visible = false;
    this.scene.add(this.compass);

    this.focusPoint = new THREE.Vector3();
    this.shift = new THREE.Vector3();
    this.lastShadow = -Infinity;
    this.dirty = true;
    this.setQuality('auto');
    this.setView('orbit');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.orbit.addEventListener('change', () => { this.dirty = true; });
    this.installPointerControls(canvas);
    this.keys = new Set();
    canvas.addEventListener('keydown', event => this.keyboard(event, true));
    canvas.addEventListener('keyup', event => this.keyboard(event, false));
    canvas.addEventListener('blur', () => this.clearKeys());
    window.addEventListener('blur', () => this.clearKeys());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearKeys();
      this.lastStamp = 0;
      this.dirty = true;
    });
    this.textureRefresh = window.setTimeout(() => { this.dirty = true; }, 550);
    this.renderer.setAnimationLoop(stamp => this.frame(stamp));
  }

  setTerrain(preset) {
    this.motion.terrain = preset;
    this.terrain.set(preset);
    this.reset();
  }

  reset() {
    this.motion.reset();
    this.clearKeys();
    this.lastUIUpdate = -Infinity;
    this.accumulator = 0;
    this.compass.visible = false;
    this.dirty = true;
    this.renderer.shadowMap.needsUpdate = true;
    this.setView(this.view);
  }

  installPointerControls(canvas) {
    let press = null;
    const fingers = new Set();
    canvas.addEventListener('pointerdown', event => {
      fingers.add(event.pointerId);
      press = event.button === 0 && fingers.size === 1 ? [event.clientX, event.clientY, event.pointerId] : null;
    });
    canvas.addEventListener('pointercancel', event => {
      fingers.delete(event.pointerId);
      press = null;
    });
    canvas.addEventListener('lostpointercapture', event => {
      fingers.delete(event.pointerId);
      if (press?.[2] === event.pointerId) press = null;
    });
    canvas.addEventListener('pointerup', event => {
      fingers.delete(event.pointerId);
      if (this.flags.guide && press?.[2] === event.pointerId &&
          Math.hypot(press[0] - event.clientX, press[1] - event.clientY) < 8) {
        const box = canvas.getBoundingClientRect();
        this.pointer.set((event.clientX - box.left) / box.width * 2 - 1, 1 - (event.clientY - box.top) / box.height * 2);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const point = this.raycaster.intersectObject(this.terrain.floor)[0]?.point;
        if (point) {
          this.motion.steerTo(point.x, point.z);
          const [x, z] = this.motion.destination;
          const y = terrainHeight(this.motion.terrain, x, z);
          this.compass.position.set(x, y + .048, z);
          this.compass.visible = true;
          this.dirty = true;
        }
      }
      press = null;
    });
  }

  keyboard(event, pressed) {
    const vectors = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!vectors[event.key]) return;
    event.preventDefault();
    if (pressed) this.keys.add(event.key);
    else this.keys.delete(event.key);
    let x = 0;
    let z = 0;
    for (const key of this.keys) {
      x += vectors[key][0];
      z += vectors[key][1];
    }
    if (x || z) {
      this.camera.getWorldDirection(this.shift);
      this.shift.y = 0;
      this.shift.normalize();
      this.motion.manual = [x * -this.shift.z - z * this.shift.x, x * this.shift.x - z * this.shift.z];
    } else {
      this.motion.manual = null;
    }
  }

  clearKeys() {
    this.keys?.clear();
    this.motion.manual = null;
  }

  setQuality(quality) {
    this.flags.quality = quality;
    this.lowPower = quality === 'low' || (quality === 'auto' && matchMedia('(pointer: coarse)').matches);
    const ratio = quality === 'high' ? 2 : this.lowPower ? 1.20 : 1.65;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    const size = this.lowPower ? 768 : 1536;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  resize() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 1 ? 44 : 36;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.dirty = true;
  }

  setView(view) {
    this.view = view;
    this.orbit.target.set(this.motion.x, this.motion.bodyPose().height, this.motion.z);
    if (view === 'top') this.camera.position.copy(this.orbit.target).add(new THREE.Vector3(.07, 6.7, .46));
    else {
      const narrow = this.camera.aspect < 1.17;
      this.camera.position.copy(this.orbit.target).add(narrow ? new THREE.Vector3(3.2, 3.5, 5.8) : new THREE.Vector3(2.9, 3.1, 5.7));
    }
    this.orbit.update();
    this.dirty = true;
  }

  zoom(multiplier) {
    this.shift.subVectors(this.camera.position, this.orbit.target);
    const distance = THREE.MathUtils.clamp(this.shift.length() * multiplier, this.orbit.minDistance, this.orbit.maxDistance);
    this.camera.position.copy(this.orbit.target).add(this.shift.setLength(distance));
    this.orbit.update();
    this.dirty = true;
  }

  frame(stamp) {
    if (document.hidden) return;
    const dt = this.lastStamp ? Math.min(.05, (stamp - this.lastStamp) / 1000) : 0;
    this.lastStamp = stamp;
    if (!this.flags.paused) {
      this.accumulator += dt * this.flags.rate;
      const step = 1 / 120;
      while (this.accumulator >= step) {
        this.motion.step(step);
        this.accumulator -= step;
      }
      this.dirty = true;
    }
    this.rig.update(this.motion, this.flags.joints, this.flags.contacts);
    this.focusPoint.set(this.motion.x + .12, this.motion.bodyPose().height * .82, this.motion.z);
    this.shift.subVectors(this.focusPoint, this.orbit.target).multiplyScalar(1 - Math.exp(-8 * dt));
    if (this.shift.lengthSq() > .00000001) {
      this.orbit.target.add(this.shift);
      this.camera.position.add(this.shift);
      this.dirty = true;
    }
    this.orbit.update();

    if (stamp - this.lastUIUpdate > 110) {
      this.onStats(this.motion.clock, this.motion.legs.filter(leg => !leg.swinging).length);
      this.lastUIUpdate = stamp;
    }
    if (!this.dirty) return;
    if ((!this.flags.paused || this.renderer.shadowMap.needsUpdate) && stamp - this.lastShadow > (this.lowPower ? 63 : 30)) {
      this.sun.target.position.set(this.motion.x, 0, this.motion.z);
      this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(3.3, 6.0, -4.0));
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -4.6;
      cam.right = cam.top = 4.6;
      cam.updateProjectionMatrix();
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadow = stamp;
    }
    this.renderer.render(this.scene, this.camera, this.motion);
    this.dirty = false;
  }
}
