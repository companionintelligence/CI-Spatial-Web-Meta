/**
 * ScanAnchorRoot — a spatial root group bound to a persistent WebXR anchor.
 *
 * Pin positions in `local-floor` coordinates are only valid for the session
 * that produced them: the origin moves between sessions (recenter, reboot).
 * IWSDK's SceneUnderstandingSystem maintains one persistent XRAnchor
 * (UUID stored in localStorage) and re-poses an "anchored group" to it each
 * frame. Any entity with the XRAnchor component is re-parented into that
 * group, so content placed under it re-localizes across sessions.
 *
 * This class owns:
 *   - `group`        — the anchored root all scan content lives under
 *   - `labelsRoot`   — visual pin labels (excluded from glTF export)
 *   - `geometryRoot` — captured scene-geometry snapshots (the export payload)
 *
 * Requires the `anchors` XR feature. Without it, the group simply stays at
 * the scene origin, and anchor-local coordinates degrade to world coordinates.
 */

import * as THREE from 'three';
import { XRAnchor } from '@iwsdk/core';

/** Must match SceneUnderstandingSystem.ANCHOR_UUID_STORAGE_KEY. */
export const ANCHOR_UUID_STORAGE_KEY = 'iwsdk_scene_anchor_uuid';

export class ScanAnchorRoot {
  /** @param {import('@iwsdk/core').World} world */
  constructor(world) {
    this.world = world;

    this.group = new THREE.Group();
    this.group.name = 'companion-scan-root';

    this.labelsRoot = new THREE.Group();
    this.labelsRoot.name = 'companion-scan-labels';
    this.group.add(this.labelsRoot);

    this.geometryRoot = new THREE.Group();
    this.geometryRoot.name = 'companion-scan-geometry';
    this.group.add(this.geometryRoot);

    // SceneUnderstandingSystem attaches this entity to its world-anchored
    // group once the session is running with the 'anchors' feature.
    this._entity = world.createTransformEntity(this.group);
    this._entity.addComponent(XRAnchor);

    this._vec = new THREE.Vector3();
  }

  /** UUID of the persistent anchor, if one has been created/restored. */
  get anchorUuid() {
    try {
      return localStorage.getItem(ANCHOR_UUID_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Convert a world-space position to anchor-local coordinates.
   * @param {{x:number,y:number,z:number}} p
   * @returns {{x:number,y:number,z:number}}
   */
  worldToAnchorLocal(p) {
    this.group.updateWorldMatrix(true, false);
    const v = this._vec.set(p.x, p.y, p.z);
    this.group.worldToLocal(v);
    return { x: v.x, y: v.y, z: v.z };
  }
}
