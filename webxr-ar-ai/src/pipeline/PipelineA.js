/**
 * Pipeline A — WebXR Scene Understanding → SpatialPins.
 *
 * Converts XRPlane / XRMesh Query results (from the IWSDK
 * SceneUnderstandingSystem) into SpatialPin objects tagged MetaScene.
 *
 * Must be called from within a System that has XRPlane / XRMesh queries
 * so the entity objects and their Object3Ds are fully resolved.
 *
 * @param {Set<import('@iwsdk/core').Entity>} planeEntities  from query.entities
 * @param {Set<import('@iwsdk/core').Entity>} meshEntities   from query.entities
 * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
 * @param {string} captureId
 * @param {string} captureSessionId
 */

import { XRPlane, XRMesh } from '@iwsdk/core';
import { SpatialPin, PinSource } from '../spatial/SpatialPin.js';

let _frameIndex = 0;

export function runPipelineA(planeEntities, meshEntities, pinManager, captureId, captureSessionId) {
  // ── Planes ────────────────────────────────────────────────────────────────
  for (const entity of planeEntities) {
    const plane = entity.getValue(XRPlane, '_plane');
    if (!plane) continue;
    const obj = entity.object3D;
    if (!obj) continue;

    const pin = new SpatialPin();
    pin.source           = PinSource.MetaScene;
    pin.label            = plane.orientation ?? 'plane';
    pin.worldPosition    = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    pin.worldRotation    = { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w };
    pin.hitType          = 'plane';
    pin.placementConfidence = 1;
    pin.captureId        = captureId;
    pin.captureSessionId = captureSessionId;
    pin.captureFrameIndex = _frameIndex++;
    pin.trackId          = plane.semanticLabel ?? String(plane.lastChangedTime ?? _frameIndex);
    pin.semanticLabels   = plane.semanticLabel ? [plane.semanticLabel] : null;

    if (plane.polygon?.length) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const pt of plane.polygon) {
        if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z; if (pt.z > maxZ) maxZ = pt.z;
      }
      pin.planeExtents = {
        center: { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 },
        size:   { x: maxX - minX, y: 0, z: maxZ - minZ },
      };
    }
    pinManager.addOrUpdate(pin);
  }

  // ── Meshes ─────────────────────────────────────────────────────────────────
  for (const entity of meshEntities) {
    const mesh = entity.getValue(XRMesh, '_mesh');
    if (!mesh) continue;
    const obj = entity.object3D;
    if (!obj) continue;

    const pin = new SpatialPin();
    pin.source           = PinSource.MetaScene;
    pin.label            = mesh.semanticLabel ?? 'mesh';
    pin.worldPosition    = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    pin.worldRotation    = { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w };
    pin.hitType          = 'mesh';
    pin.placementConfidence = 1;
    pin.captureId        = captureId;
    pin.captureSessionId = captureSessionId;
    pin.captureFrameIndex = _frameIndex++;
    pin.trackId          = `mesh-${mesh.lastChangedTime ?? _frameIndex}`;
    pin.semanticLabels   = mesh.semanticLabel ? [mesh.semanticLabel] : null;

    pinManager.addOrUpdate(pin);
  }
}
