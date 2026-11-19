import { DynamicDrawUsage, InstancedMesh } from 'three';

export class WorkerBatches {
  constructor(parent) {
    this.parent = parent;
    this.groups = new Map();
  }

  reset() {
    for (const batch of this.groups.values()) batch.matrices.length = 0;
  }

  add(root) {
    root.updateMatrixWorld(true);
    root.traverseVisible(part => {
      if (!part.isMesh) return;
      const { geometry, material, renderOrder } = part;
      const key = geometry.id + ':' + material.id;
      let batch = this.groups.get(key);
      if (!batch) {
        batch = { geometry, material, renderOrder, matrices: [], mesh: null, capacity: 0 };
        this.groups.set(key, batch);
      }
      batch.matrices.push(part.matrixWorld);
    });
  }

  commit() {
    for (const batch of this.groups.values()) {
      const { geometry, material, matrices, renderOrder } = batch;
      if (!matrices.length) {
        if (batch.mesh) batch.mesh.visible = false;
        continue;
      }
      if (matrices.length > batch.capacity) {
        const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(matrices.length)));
        if (batch.mesh) {
          this.parent.remove(batch.mesh);
          batch.mesh.dispose();
        }
        batch.mesh = new InstancedMesh(geometry, material, capacity);
        batch.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        batch.mesh.castShadow = Boolean(geometry.userData.bodyShadow);
        batch.mesh.receiveShadow = batch.mesh.castShadow;
        batch.mesh.frustumCulled = false;
        batch.mesh.renderOrder = renderOrder;
        this.parent.add(batch.mesh);
        batch.capacity = capacity;
      }
      const mesh = batch.mesh;
      mesh.visible = true;
      mesh.count = matrices.length;
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, matrices.length * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
