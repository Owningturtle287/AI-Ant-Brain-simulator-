import * as THREE from 'three';
import { terrainHeight } from './motion.js';
import { seeded } from './brain.js';

const grainGeometry = new THREE.SphereGeometry(1, 12, 8);
const grainColors = ['#ce8c47', '#e0b06b', '#ad683c', '#edbf7b'].map(color =>
  new THREE.MeshStandardMaterial({ color, roughness: .81 }));

export class ForagingScene {
  constructor(scene, head) {
    this.food = new THREE.Group();
    this.nest = new THREE.Group();
    this.trail = new THREE.Group();
    scene.add(this.food, this.nest, this.trail);
    const random = seeded(61831);
    this.grains = Array.from({ length: 6 }, (_, i) => {
      const crumb = new THREE.Mesh(grainGeometry, grainColors[i % grainColors.length]);
      const bearing = i * 2.4;
      crumb.position.set(Math.cos(bearing) * .14, .08 + random() * .025, Math.sin(bearing) * .14);
      crumb.scale.set(.091 + .025 * random(), .048 + .028 * random(), .071 + .03 * random());
      crumb.rotation.set(.4 + random(), bearing, random() * .6);
      crumb.castShadow = true;
      this.food.add(crumb);
      return crumb;
    });
    this.carry = new THREE.Mesh(grainGeometry, grainColors[1]);
    this.carry.scale.set(.105, .056, .080);
    this.carry.position.set(.853, -.207, 0);
    this.carry.castShadow = true;
    head.add(this.carry);

    const entrance = new THREE.Mesh(grainGeometry, new THREE.MeshBasicMaterial({ color: '#271d16' }));
    entrance.scale.set(.33, .019, .25);
    this.nest.add(entrance);
    const earth = new THREE.MeshStandardMaterial({ color: '#786049', roughness: .95 });
    for (let i = 0; i < 18; i++) {
      const dirt = new THREE.Mesh(grainGeometry, earth);
      const bearing = i * Math.PI / 9;
      const radius = .34 + random() * .055;
      dirt.position.set(Math.cos(bearing) * radius, random() * .023, Math.sin(bearing) * radius * .79);
      dirt.scale.set(.10 + random() * .038, .036 + random() * .042, .092);
      this.nest.add(dirt);
    }

    const marker = new THREE.SphereGeometry(1, 8, 5);
    const scent = new THREE.MeshBasicMaterial({ color: '#adeac5' });
    this.dots = Array.from({ length: 145 }, () => {
      const dot = new THREE.Mesh(marker, scent);
      this.trail.add(dot);
      return dot;
    });
  }

  update(worker, terrain, showTrail) {
    const { x, z, units } = worker.food;
    this.food.position.set(x, terrainHeight(terrain, x, z), z);
    for (const [index, grain] of this.grains.entries()) grain.visible = index < units;
    this.nest.position.y = terrainHeight(terrain, 0, 0) + .02;
    this.carry.visible = worker.carrying;
    this.trail.visible = showTrail;
    if (!showTrail) return;
    for (const [index, dot] of this.dots.entries()) {
      const node = worker.trail[index];
      dot.visible = Boolean(node);
      if (!node) continue;
      dot.position.set(node.x, terrainHeight(terrain, node.x, node.z) + .026, node.z);
      const size = .028 + node.strength * .056;
      dot.scale.set(size, .021, size);
    }
  }
}
