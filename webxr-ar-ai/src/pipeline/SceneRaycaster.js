/**
 * SceneRaycaster — synchronous world-space raycasts against the geometry
 * already captured by the IWSDK SceneUnderstandingSystem.
 *
 * Each XRPlane / XRMesh entity carries a THREE.Mesh object3D (a thin box for
 * planes, the real room geometry for meshes). Raycasting against those locally
 * replaces the previous per-detection XR hit-test sources, which:
 *   - consumed a limited system resource (one transient hit-test source per
 *     detection),
 *   - resolved asynchronously over multiple frames with a 500 ms timeout, and
 *   - could only raycast from the *current* viewer pose, not the pose at
 *     which the camera frame was captured.
 *
 * THREE.Raycaster ignores `visible`, so the (hidden) wireframe scene meshes
 * work as targets without being rendered.
 */

import * as THREE from 'three';

export class SceneRaycaster {
  constructor() {
    this._raycaster = new THREE.Raycaster();
  }

  /**
   * Cast a world-space ray against scene-understanding geometry.
   *
   * @param {THREE.Vector3} origin     world-space ray origin
   * @param {THREE.Vector3} direction  world-space unit direction
   * @param {Array<{object: THREE.Object3D, hitType: 'plane'|'mesh'}>} targets
   * @param {number} [maxDistance=10] metres
   * @returns {{point: THREE.Vector3, hitType: 'plane'|'mesh', distance: number}|null}
   */
  raycast(origin, direction, targets, maxDistance = 10) {
    if (!targets?.length) return null;

    this._raycaster.set(origin, direction);
    this._raycaster.near = 0.05;
    this._raycaster.far  = maxDistance;

    let best = null;
    for (const { object, hitType } of targets) {
      if (!object) continue;
      // Room-mesh winding faces the user, but plane boxes may be hit from
      // either side — make the shared scene-understanding materials
      // double-sided so backfaces register (idempotent).
      if (object.material && object.material.side !== THREE.DoubleSide) {
        object.material.side = THREE.DoubleSide;
      }
      const hits = this._raycaster.intersectObject(object, false);
      if (hits.length && (!best || hits[0].distance < best.distance)) {
        best = { point: hits[0].point.clone(), hitType, distance: hits[0].distance };
      }
    }
    return best;
  }
}

/**
 * Collect raycast targets from the CompanionScanSystem's XRPlane / XRMesh
 * query results.
 *
 * @param {Iterable<import('@iwsdk/core').Entity>} planeEntities
 * @param {Iterable<import('@iwsdk/core').Entity>} meshEntities
 * @returns {Array<{object: THREE.Object3D, hitType: 'plane'|'mesh'}>}
 */
export function collectRaycastTargets(planeEntities, meshEntities) {
  const targets = [];
  for (const e of planeEntities) {
    if (e.object3D) targets.push({ object: e.object3D, hitType: 'plane' });
  }
  for (const e of meshEntities) {
    if (e.object3D) targets.push({ object: e.object3D, hitType: 'mesh' });
  }
  return targets;
}
