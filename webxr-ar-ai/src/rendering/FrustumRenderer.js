/**
 * FrustumRenderer — draws frustum rays on each capture.
 *
 * Visualises the detection directions from the current camera position using
 * THREE.LineSegments. Lines fade out after a short duration.
 */

import * as THREE from 'three';

const RAY_DURATION_MS = 1500;

export class FrustumRenderer {
  /** @param {import('@iwsdk/core').World} world */
  constructor(world) {
    this.world  = world;
    this._lines = [];
  }

  /**
   * Draw rays from the camera toward each detection direction.
   * @param {Array<{cx:number,cy:number}>} detections normalised cx/cy
   * @param {number} hfov radians
   * @param {number} vfov radians
   * @param {number} depth metres
   */
  draw(detections, hfov, vfov, depth = 1.5) {
    const camPos = new THREE.Vector3();
    this.world.camera.getWorldPosition(camPos);
    const camQuat = this.world.camera.quaternion.clone();

    for (const det of detections) {
      const aH = -(det.cx - 0.5) * hfov;
      const aV = -(det.cy - 0.5) * vfov;
      const dir = new THREE.Vector3(
        Math.sin(aH) * Math.cos(aV),
        Math.sin(aV),
        -Math.cos(aH) * Math.cos(aV),
      ).applyQuaternion(camQuat).normalize();

      const end  = camPos.clone().addScaledVector(dir, depth);
      const pts  = new Float32Array([camPos.x, camPos.y, camPos.z, end.x, end.y, end.z]);
      const geo  = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat  = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.8 });
      const line = new THREE.LineSegments(geo, mat);
      this.world.scene.add(line);
      this._lines.push({ line, born: Date.now() });
    }
  }

  /** Call every frame to fade and remove old rays. */
  update() {
    const now   = Date.now();
    const alive = [];
    for (const item of this._lines) {
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
    this._lines = alive;
  }
}
