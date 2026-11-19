import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Colony, colonyStep } from './colony.js';
import { ColonyScene } from './colony-scene.js';
import { SoftwareView } from './software-view.js';
import { WorkerBrain } from './brain.js';

const cameraOffsets = {
  nest: new THREE.Vector3(5.7, 9.4, 12.2),
  worker: new THREE.Vector3(2.8, 3.7, 6.3),
  explore: new THREE.Vector3(4.6, 13.3, 16.1),
};

export class ColonyArena {
  constructor(host, settings, seed, history) {
    this.host = host;
    this.colony = new Colony(settings, seed, history);
    this.flags = { paused: false, rate: 1, signals: true, joints: false, contacts: false, sting: false };
    this.brainInputs = { odor: [0, 0], contact: [0, 0], vision: 0, touch: 0, turn: 0, pace: 0 };
    this.mode = 'nest';
    this.workerId = 1;
    this.accumulated = 0;
    this.lastFrame = 0;
    this.lastStamp = 0;
    this.lastUI = -Infinity;
    this.lastBrain = -Infinity;
    this.dirty = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#3f3326');
    this.camera = new THREE.PerspectiveCamera(43, 1, .06, 240);
    const surface = document.createElement('canvas');
    const context = surface.getContext('webgl2', { alpha: false, antialias: true });
    this.software = !context;
    this.renderer = context ? new THREE.WebGLRenderer({ canvas: surface, context }) : new SoftwareView();
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.19;
    this.renderer.shadowMap.enabled = !this.software;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Interactive 3D colony world');
    host.replaceChildren(canvas);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = .14;
    this.orbit.maxPolarAngle = Math.PI * .464;
    this.orbit.minDistance = 2.8;
    this.orbit.maxDistance = 68;
    this.orbit.rotateSpeed = .68;
    this.orbit.panSpeed = .88;
    this.orbit.addEventListener('change', () => { this.dirty = true; });
    if (!this.software) {
      const room = new RoomEnvironment();
      const lighting = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = lighting.fromScene(room, .08).texture;
      this.scene.environmentIntensity = .76;
      room.dispose();
      lighting.dispose();
    }
    this.scene.add(new THREE.HemisphereLight('#f4e9d6', '#786344', 1.61));
    this.sun = new THREE.DirectionalLight('#ffe4b9', 3.2);
    this.sun.castShadow = !this.software;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = .15;
    this.sun.shadow.camera.far = 52;
    this.sun.shadow.normalBias = .028;
    this.sun.shadow.bias = -.00019;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#e6ebec', .86);
    fill.position.set(-4, 5, 4);
    this.scene.add(fill);
    this.lowPower = this.software || matchMedia('(pointer: coarse)').matches;
    this.objects = new ColonyScene(this.scene, this.renderer, this.software, this.lowPower);
    this.track = new THREE.Vector3();
    this.shift = new THREE.Vector3();
    this.presentWorld = null;
    this.setQuality('auto');
    this.setView('nest');
    this.objects.setWorld(this.colony.map, this.orbit.target);
    this.presentWorld = this.colony.map;
    new ResizeObserver(() => this.resize()).observe(host);
    document.addEventListener('visibilitychange', () => { this.lastStamp = 0; this.dirty = true; });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.flags.paused = true;
      this.onStats?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
    });
    this.renderer.setAnimationLoop(stamp => this.frame(stamp));
    window.setTimeout(() => { this.dirty = true; }, 600);
  }

  get selected() {
    return this.colony.workers.find(worker => worker.id === this.workerId) ?? this.colony.workers[0];
  }

  inspect(id) {
    this.workerId = id;
    this.brain?.reset();
    this.onBrain?.();
    this.lastBrain = -Infinity;
    this.dirty = true;
  }

  enableBrain(enabled) {
    if (enabled && !this.brain) this.brain = new WorkerBrain();
    this.brainEnabled = enabled;
    this.lastBrain = -Infinity;
  }

  updateBrain() {
    const agent = this.selected;
    if (!agent) return;
    if (this.brainWorkerId !== agent.id) {
      this.brain.reset();
      this.brainWorkerId = agent.id;
    }
    const { turn, speed } = agent;
    const signal = this.colony.signals;
    const input = this.brainInputs;
    input.odor[0] = Math.min(1, Math.max(0, .25 + turn * .27 + signal.food * .4));
    input.odor[1] = Math.min(1, Math.max(0, .25 - turn * .27 + signal.water * .4));
    input.vision = Math.min(1, .08 + speed * .30);
    for (const [i, probe] of agent.probes.entries()) input.contact[i] = probe.kind ? .82 : 0;
    input.touch = Math.max(...input.contact);
    input.turn = turn / 2;
    input.pace = Math.min(1, speed / 2);
    this.brain.step(input);
  }

  restart(newWorld = true) {
    this.colony.restart(newWorld);
    this.prepareRun();
  }

  prepareRun() {
    this.workerId = 1;
    this.accumulated = 0;
    this.brain?.reset();
    this.onBrain?.();
    this.setView('nest');
    this.objects.setWorld(this.colony.map, this.orbit.target);
    this.presentWorld = this.colony.map;
    this.onStats?.();
    this.dirty = true;
  }

  setView(mode) {
    this.mode = mode;
    const worker = mode === 'worker' ? this.selected : null;
    this.orbit.target.set(worker?.x ?? 0, worker ? .42 : .38, worker?.z ?? 0);
    this.camera.position.copy(this.orbit.target).add(cameraOffsets[mode]);
    this.orbit.enablePan = mode === 'explore';
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

  setQuality(quality) {
    this.lowPower = this.software || quality === 'low' || (quality !== 'high' && matchMedia('(pointer: coarse)').matches);
    this.objects.lowPower = this.lowPower;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.lowPower ? 1.25 : 1.65));
    this.resize();
    this.dirty = true;
  }

  resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < .88 ? 49 : 40;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.dirty = true;
  }

  frame(stamp) {
    if (document.hidden) return;
    const dt = this.lastStamp ? Math.min(.18, (stamp - this.lastStamp) / 1000) : 0;
    this.lastStamp = stamp;
    if (!this.flags.paused) {
      this.accumulated += dt * this.flags.rate;
      while (this.accumulated + 1e-7 >= colonyStep) {
        this.accumulated -= colonyStep;
        this.colony.step();
        if (this.presentWorld !== this.colony.map) this.prepareRun();
      }
      this.dirty = true;
    }
    if (stamp - this.lastUI > 185) {
      this.onStats?.();
      this.lastUI = stamp;
    }
    if (this.brainEnabled && !this.flags.paused && stamp - this.lastBrain > 66) {
      this.updateBrain();
      this.onBrain?.();
      this.lastBrain = stamp;
    }
    if (this.mode === 'worker' && this.selected) {
      const { x, z } = this.selected;
      this.track.set(x, this.colony.map.height(x, z) + .41, z);
      this.shift.subVectors(this.track, this.orbit.target).multiplyScalar(1 - Math.exp(-8 * dt));
      if (this.shift.lengthSq() > .000001) {
        this.orbit.target.add(this.shift);
        this.camera.position.add(this.shift);
        this.dirty = true;
      }
    }
    this.orbit.update();
    const renderPeriod = this.software ? 38 : this.lowPower ? 30 : 21;
    if (!this.dirty || (this.lastFrame && stamp - this.lastFrame < renderPeriod)) return;
    const elapsed = this.lastFrame ? (stamp - this.lastFrame) / 1000 : 0;
    this.lastFrame = stamp;
    this.objects.update(this.colony, this.orbit.target, this.selected,
      this.flags.paused ? 0 : elapsed * this.flags.rate, this.flags, Math.max(0, this.accumulated / colonyStep),
      this.camera, this.flags.paused ? 0 : Math.min(.12, elapsed));
    if (!this.software && (!this.lastShadow || stamp - this.lastShadow > (this.lowPower ? 95 : 65))) {
      const target = this.orbit.target;
      this.sun.target.position.set(target.x, 0, target.z);
      this.sun.position.set(target.x + 8.4, 14.5, target.z - 12.7);
      const shadow = this.sun.shadow.camera;
      shadow.left = shadow.bottom = -11;
      shadow.right = shadow.top = 11;
      shadow.updateProjectionMatrix();
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadow = stamp;
    }
    this.renderer.render(this.scene, this.camera, this.objects.queenMotion);
    this.dirty = false;
  }
}
