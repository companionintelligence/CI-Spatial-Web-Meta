/**
 * GltfExporter — exports the scan geometry root as a GLB and injects
 * rich spatial metadata into the glTF `extras` section.
 *
 * The export root is the dedicated scan subtree (snapshotted scene geometry
 * under the persistent-anchor root) — NOT the live render scene, so UI
 * meshes, labels and viewfinder planes never leak into the export, and node
 * transforms are anchor-relative.
 *
 * Extras structure:
 *   extras.companion_scan: {
 *     version:            "1.1",
 *     session_id:         string,
 *     exported_at:        ISO string,
 *     anchor_uuid:        string|null,   // persistent WebXR anchor UUID
 *     pins:               SpatialPin[],
 *     floorplan:          { bounds: {min,max}, ... } | null,
 *   }
 *
 * Each pin carries `position` (session world space) and
 * `position_anchor_local` (relative to the persistent anchor — the frame
 * that survives across sessions).
 */

import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { appState } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';

/**
 * Export the scan subtree + spatial pins to a GLB.
 *
 * @param {import('three').Object3D} exportRoot  scan geometry root
 * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
 * @param {object}   [opts]
 * @param {string|null} [opts.anchorUuid]
 * @param {(p: {x,y,z}) => {x,y,z}} [opts.worldToAnchorLocal]
 * @returns {Promise<ArrayBuffer>}  glTF binary (GLB)
 */
export async function exportGltf(exportRoot, pinManager, opts = {}) {
  const exporter = new GLTFExporter();
  const scanMeta = buildScanMeta(pinManager, opts);

  // GLTFExporter serialises the entire userData object into the node's
  // `extras`, so the GLB carries `extras.companion_scan` directly.
  const prevMeta = exportRoot.userData.companion_scan;
  exportRoot.userData.companion_scan = scanMeta;

  const restore = () => {
    if (prevMeta === undefined) delete exportRoot.userData.companion_scan;
    else exportRoot.userData.companion_scan = prevMeta;
  };

  return new Promise((resolve, reject) => {
    exporter.parse(
      exportRoot,
      gltf => {
        restore();
        // parse returns an ArrayBuffer (binary glTF = GLB) when binary: true
        resolve(gltf);
      },
      err => {
        restore();
        reject(err);
      },
      // onlyVisible: false — geometry snapshots are kept invisible so they
      // cost nothing to render, but they ARE the export payload.
      { binary: true, embedImages: false, onlyVisible: false },
    );
  });
}

/**
 * Build the `companion_scan` metadata block (serialised pins + floorplan).
 * Shared between the GLB extras and the Markdown scan report.
 *
 * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
 * @param {object}   [opts]
 * @param {string|null} [opts.anchorUuid]
 * @param {(p: {x,y,z}) => {x,y,z}} [opts.worldToAnchorLocal]
 * @returns {object}
 */
export function buildScanMeta(pinManager, opts = {}) {
  const { anchorUuid = null, worldToAnchorLocal = null } = opts;
  return {
    version:      '1.1',
    session_id:   appState.captureSessionId,
    exported_at:  new Date().toISOString(),
    anchor_uuid:  anchorUuid,
    pins:         pinManager.pins.map(p => _serialisePin(p, worldToAnchorLocal)),
    floorplan:    _computeFloorplan(pinManager),
  };
}

// ── Serialisation helpers ─────────────────────────────────────────────────

function _serialisePin(pin, worldToAnchorLocal) {
  return {
    id:                   pin.id,
    source:               pin.source,
    label:                pin.label,
    position:             pin.worldPosition,
    // Restored pins carry an authoritative anchor-local position (their
    // stored worldPosition came from a previous session's frame).
    position_anchor_local: pin.anchorLocalPosition
      ?? (worldToAnchorLocal ? worldToAnchorLocal(pin.worldPosition) : pin.worldPosition),
    rotation:             pin.worldRotation,
    confidence:           pin.confidence,
    bbox_cxcywh:          pin.bboxCxCyWH,
    hit_type:             pin.hitType,
    placement_confidence: pin.placementConfidence,
    track_id:             pin.trackId,
    capture_id:           pin.captureId,
    capture_session_id:   pin.captureSessionId,
    capture_frame_index:  pin.captureFrameIndex,
    semantic_labels:      pin.semanticLabels,
    plane_extents:        pin.planeExtents,
    volume_extents:       pin.volumeExtents,
    mask_rle:             pin.maskRleJson ? JSON.parse(pin.maskRleJson) : null,
    florence_caption:     pin.florenceCaption,
    created_at:           pin.createdAt,
  };
}

function _computeFloorplan(pinManager) {
  // Fallback pins are distance guesses along a ray — excluding them keeps
  // the room bounds honest.
  const placedPins = pinManager.pins.filter(p => p.hitType !== 'fallback');
  if (!placedPins.length) return null;

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of placedPins) {
    const { x, y, z } = p.worldPosition;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return {
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    cv_pin_count:    pinManager.bySource(PinSource.CvServer).length,
    scene_pin_count: pinManager.bySource(PinSource.MetaScene).length,
  };
}
