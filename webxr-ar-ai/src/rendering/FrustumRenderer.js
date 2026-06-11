/**
 * FrustumRenderer — draws capture-ray visualisations.
 *
 * All rays from one capture are batched into a single LineSegments (one
 * geometry, one material, one draw call) instead of one object per ray.
 * Batches fade out and are disposed after a short duration.
 */

import * as THREE from 'three';

const RAY_DURATION_MS = 1500;

export class FrustumRenderer {
  /** @param {import('@iwsdk/core').World} world */
  constructor(world) {
    this.world    = world;
    this._batches = [];
  }

  /**
   * Draw one batch of rays (typically the detection rays of a capture).
   * @param {Array<{origin: THREE.Vector3, dir: THREE.Vector3}>} rays
   * @param {number} depth metres
   */
  draw(rays, depth = 1.5) {
    if (!rays?.length) return;

    const pts = new Float32Array(rays.length * 6);
    for (let i = 0; i < rays.length; i++) {
      const { origin, dir } = rays[i];
      const end = origin.clone().addScaledVector(dir, depth);
      pts.set([origin.x, origin.y, origin.z, end.x, end.y, end.z], i * 6);
    }

    const geo  = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat  = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.8 });
    const line = new THREE.LineSegments(geo, mat);
    this.world.scene.add(line);
    this._batches.push({ line, born: Date.now() });
  }

  /** Call every frame to fade and remove old batches. */
  update() {
    if (!this._batches.length) return;
    const now   = Date.now();
    const alive = [];
    for (const item of this._batches) {
      const age = now - item.born;
      if (age > RAY_DURATION_MS) {
        this.world.scene.remove(item.line);
        item.line.geometry.dispose();
        item.line.material.dispose();
      } else {
        item.line.material.opacity = 0.8 * (1 - age / RAY_DURATION_MS);
        alive.push(item);
      }
    }
    this._batches = alive;
  }
}
