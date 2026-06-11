/**
 * Pipeline A — WebXR Scene Understanding → SpatialPins.
 *
 * Converts XRPlane / XRMesh Query results (from the IWSDK
 * SceneUnderstandingSystem) into SpatialPin objects tagged MetaScene.
 *
 * Track identity: native XRPlane/XRMesh objects keep the same JS identity for
 * the lifetime of the tracked surface, so track IDs are assigned from a
 * WeakMap keyed on the native object. Re-capturing the same wall updates its
 * pin in place; two walls sharing the semantic label 'wall' stay distinct.
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

// Stable per-surface IDs, keyed on the native WebXR object identity.
const _trackIds = new WeakMap();
let _trackSeq = 0;

function trackIdFor(native, prefix) {
  let id = _trackIds.get(native);
  if (!id) {
    id = `${prefix}-${++_trackSeq}`;
    _trackIds.set(native, id);
  }
  return id;
}

export function runPipelineA(planeEntities, meshEntities, pinManager, captureId, captureSessionId) {
  // ── Planes ────────────────────────────────────────────────────────────────
  for (const entity of planeEntities) {
    const plane = entity.getValue(XRPlane, '_plane');
    if (!plane) continue;
    const obj = entity.object3D;
    if (!obj) continue;

    const pin = new SpatialPin();
    pin.source           = PinSource.MetaScene;
    pin.label            = plane.semanticLabel ?? plane.orientation ?? 'plane';
    pin.worldPosition    = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    pin.worldRotation    = { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w };
    pin.hitType          = 'plane';
    pin.placementConfidence = 1;
    pin.captureId        = captureId;
    pin.captureSessionId = captureSessionId;
    pin.captureFrameIndex = _frameIndex++;
    pin.trackId          = trackIdFor(plane, 'plane');
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
    pin.trackId          = trackIdFor(mesh, 'mesh');
    pin.semanticLabels   = mesh.semanticLabel ? [mesh.semanticLabel] : null;
    pin.volumeExtents    = _volumeExtentsFromVertices(mesh.vertices);

    pinManager.addOrUpdate(pin);
  }
}

/**
 * Mesh-local axis-aligned bounds from the raw XRMesh vertex buffer.
 * @param {Float32Array|undefined} vertices
 * @returns {{center:{x,y,z},size:{x,y,z}}|null}
 */
function _volumeExtentsFromVertices(vertices) {
  if (!vertices || vertices.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size:   { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}
