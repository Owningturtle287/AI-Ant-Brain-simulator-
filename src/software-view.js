import { Matrix4, SRGBColorSpace, Vector3 } from 'three';
import { terrainHeight } from './motion.js';

const center = new Vector3();
const world = new Vector3();
const nearEnd = new Vector3();
const farEnd = new Vector3();
const horizontal = new Vector3();
const vertical = new Vector3();
const transform = new Matrix4();
const scratch = new Matrix4();

function tint(hex, amount) {
  const red = hex >> 16;
  const green = (hex >> 8) & 255;
  const blue = hex & 255;
  const adjust = channel => Math.round(channel + ((amount > 0 ? 255 : 0) - channel) * Math.abs(amount));
  return `rgb(${adjust(red)},${adjust(green)},${adjust(blue)})`;
}

export class SoftwareView {
  constructor() {
    this.domElement = document.createElement('canvas');
    this.context = this.domElement.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('Could not create a canvas context');
    this.capabilities = { getMaxAnisotropy: () => 1 };
    this.shadowMap = {};
    this.ratio = 1;
    this.width = 1;
    this.height = 1;
    this.patternImage = new Image();
    this.patternImage.src = './textures/loam.webp';
  }

  setPixelRatio(ratio) { this.ratio = Math.min(1.25, ratio); }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.domElement.width = Math.round(width * this.ratio);
    this.domElement.height = Math.round(height * this.ratio);
  }

  setAnimationLoop(frame) {
    const next = stamp => {
      requestAnimationFrame(next);
      frame(stamp);
    };
    requestAnimationFrame(next);
  }

  position(point, x, y, z, matrix) {
    return point.set(x, y, z).applyMatrix4(matrix);
  }

  screen(point) {
    return [
      (.5 + .5 * point.x) * this.width,
      (.5 - .5 * point.y) * this.height,
    ];
  }

  rockShapes(mesh, camera, shapes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, scratch);
      world.setFromMatrixPosition(scratch);
      center.copy(world).applyMatrix4(transform);
      if (Math.abs(center.x) > 1.08 || Math.abs(center.y) > 1.08) continue;
      horizontal.setFromMatrixColumn(scratch, 0);
      const width = horizontal.length();
      const scale = this.height / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.distanceTo(world));
      if (width * scale < .95) continue;
      shapes.push({ screen: this.screen(center), width: width * scale, height: width * scale * .51, angle: -.12, depth: center.z, color: 0x6e5440, rock: true });
    }
  }

  sceneShapes(scene, camera) {
    const shapes = [];
    scene.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.material.color) return;
      if (mesh.isInstancedMesh && mesh.geometry.type === 'IcosahedronGeometry') {
        this.rockShapes(mesh, camera, shapes);
        return;
      }
      const geometry = mesh.geometry;
      if (geometry.type === 'PlaneGeometry' || geometry.type === 'BufferGeometry') return;
      world.setFromMatrixPosition(mesh.matrixWorld);
      center.copy(world).applyMatrix4(transform);
      if (Math.abs(center.x) > 1.3 || Math.abs(center.y) > 1.3 || Math.abs(center.z) > 1) return;
      const screen = this.screen(center);
      const color = mesh.material.color.getHex(SRGBColorSpace);
      const depth = center.z;
      const distance = camera.position.distanceTo(world);
      const scale = this.height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
      if (geometry.type === 'CylinderGeometry') {
        const first = this.screen(this.position(nearEnd, 0, -.5, 0, mesh.matrixWorld).applyMatrix4(transform));
        const last = this.screen(this.position(farEnd, 0, .5, 0, mesh.matrixWorld).applyMatrix4(transform));
        horizontal.setFromMatrixColumn(mesh.matrixWorld, 0);
        const radius = horizontal.length() * scale;
        if (radius > .23) shapes.push({ first, last, radius, screen, depth, color });
      } else if (geometry.type === 'RingGeometry') {
        const r = geometry.parameters.outerRadius * scale;
        shapes.push({ screen, width: r, height: r * .65, angle: 0, depth: depth - .00004, ring: true, color });
      } else if (geometry.type === 'SphereGeometry') {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const bounds = geometry.boundingBox.max;
        const axes = [
          [bounds.x, 0, 0],
          [0, bounds.y, 0],
          [0, 0, bounds.z],
        ];
        let xx = 0, xy = 0, yy = 0;
        for (const [x, y, z] of axes) {
          const edge = this.screen(this.position(nearEnd, x, y, z, mesh.matrixWorld).applyMatrix4(transform));
          const dx = edge[0] - screen[0], dy = edge[1] - screen[1];
          xx += dx * dx;
          xy += dx * dy;
          yy += dy * dy;
        }
        const discriminant = Math.hypot(xx - yy, 2 * xy);
        const radius = Math.sqrt((xx + yy + discriminant) * .5);
        if (radius < .52) return;
        const height = Math.max(.35, Math.sqrt(Math.max(0, (xx + yy - discriminant) * .5)));
        const angle = .5 * Math.atan2(2 * xy, xx - yy);
        shapes.push({ screen, width: radius, height, angle, depth, color, marker: !mesh.material.depthTest });
      } else if (geometry.type === 'TubeGeometry') {
        const path = [];
        for (const point of geometry.parameters.path.getPoints(10)) path.push(this.screen(point.applyMatrix4(mesh.matrixWorld).applyMatrix4(transform)));
        shapes.push({ path, radius: scale * .028, screen, depth, color });
      }
    });
    return shapes.sort((a, b) => Number(Boolean(a.marker)) - Number(Boolean(b.marker)) || b.depth - a.depth);
  }

  background(camera, motion) {
    const ctx = this.context;
    const [w, h] = [this.width, this.height];
    ctx.fillStyle = motion.terrain === 'gravel' ? '#625448' : '#5f4634';
    ctx.fillRect(0, 0, w, h);
    if (this.patternImage.complete && this.patternImage.naturalWidth) {
      const pattern = ctx.createPattern(this.patternImage, 'repeat');
      const size = Math.max(.38, Math.min(1.1, 3.8 / camera.position.distanceTo(world.set(motion.x, .4, motion.z))));
      pattern.setTransform(new DOMMatrix().translate(w * .45 - (motion.x * 71) % 900, h * .45 - (motion.z * 61) % 900).rotate(12).scale(size, size * .82));
      ctx.globalAlpha = motion.terrain === 'gravel' ? .74 : .83;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    if (motion.terrain === 'tunnel') {
      const slope = ctx.createLinearGradient(0, 0, 0, h);
      slope.addColorStop(0, '#18130de8');
      slope.addColorStop(.36, '#291e1540');
      slope.addColorStop(.68, '#291e1511');
      slope.addColorStop(1, '#221911bb');
      ctx.fillStyle = slope;
      ctx.fillRect(0, 0, w, h);
    }
    const shade = ctx.createRadialGradient(w * .52, h * .47, w * .05, w * .52, h * .47, Math.max(w, h) * .66);
    shade.addColorStop(0, '#d4a16d1a');
    shade.addColorStop(1, '#19140fba');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  }

  drawShape(shape) {
    const ctx = this.context;
    if (shape.first || shape.path) {
      const path = shape.path ?? [shape.first, shape.last];
      const [x, y] = path[0];
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (const [nextX, nextY] of path.slice(1)) ctx.lineTo(nextX, nextY);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = tint(shape.color, -.40);
      ctx.lineWidth = Math.max(.75, shape.radius * 2.04);
      ctx.stroke();
      ctx.strokeStyle = tint(shape.color, .07);
      ctx.lineWidth = Math.max(.32, shape.radius * 1.32);
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.translate(...shape.screen);
    ctx.rotate(shape.angle);
    ctx.scale(shape.width, shape.height);
    ctx.beginPath();
    ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2);
    if (shape.ring) {
      ctx.lineWidth = .17;
      ctx.strokeStyle = tint(shape.color, .06);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const gloss = ctx.createRadialGradient(-.30, -.53, .035, -.16, -.25, 1.24);
    gloss.addColorStop(0, tint(shape.color, shape.rock ? .17 : .40));
    gloss.addColorStop(.45, tint(shape.color, .04));
    gloss.addColorStop(.82, tint(shape.color, -.28));
    gloss.addColorStop(1, tint(shape.color, -.57));
    ctx.fillStyle = shape.marker ? tint(shape.color, 0) : gloss;
    ctx.fill();
    ctx.restore();
  }

  render(scene, camera, motion) {
    const ctx = this.context;
    if (!motion) return;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    transform.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.background(camera, motion);
    const shapes = this.sceneShapes(scene, camera);
    ctx.fillStyle = '#1d120e36';
    for (const foot of motion.legs) {
      if (foot.swinging) continue;
      center.set(foot.x, terrainHeight(motion.terrain, foot.x, foot.z), foot.z).applyMatrix4(transform);
      const [x, y] = this.screen(center);
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const shape of shapes) this.drawShape(shape);
  }
}
