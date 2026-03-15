/**
 * GltfExporter — exports the Three.js scene as a glTF 2.0 file and injects
 * rich spatial metadata into the glTF `extras` section.
 *
 * Extras structure:
 *   extras.companion_scan: {
 *     version:            "1.0",
 *     session_id:         string,
 *     exported_at:        ISO string,
 *     pins:               SpatialPin[],
 *     floorplan:          { bounds: {min,max} } | null,
 *   }
 *
 * Each pin is serialised as:
 *   { id, source, label, position, rotation, confidence, bbox, hit_type,
 *     placement_confidence, track_id, capture_id, session_id, frame_index,
 *     semantic_labels, plane_extents, volume_extents, mask_rle, florence_caption }
 */

import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { appState } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';

/**
 * Export the scene + spatial pins to a glTF JSON string.
 *
 * @param {import('three').Scene} scene
 * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
 * @returns {Promise<ArrayBuffer>}  glTF binary (GLB)
 */
export async function exportGltf(scene, pinManager) {
  const exporter = new GLTFExporter();

  // ── Build extras ─────────────────────────────────────────────────────────
  const pins  = pinManager.pins.map(_serialisePin);
  const floor = _computeFloorplan(pinManager);

  const extras = {
    companion_scan: {
      version:      '1.0',
      session_id:   appState.captureSessionId,
      exported_at:  new Date().toISOString(),
      pins,
      floorplan:    floor,
    },
  };

  // Inject extras onto the scene object (GLTFExporter reads scene.userData.gltfExtras)
  const prevExtras = scene.userData.gltfExtras;
  scene.userData.gltfExtras = extras;

  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      gltf => {
        scene.userData.gltfExtras = prevExtras;
        // parse returns an ArrayBuffer (binary glTF = GLB) when binary: true
        resolve(gltf);
      },
      err => {
        scene.userData.gltfExtras = prevExtras;
        reject(err);
      },
      { binary: true, embedImages: false },
    );
  });
}

// ── Serialisation helpers ─────────────────────────────────────────────────

function _serialisePin(pin) {
  return {
    id:                   pin.id,
    source:               pin.source,
    label:                pin.label,
    position:             pin.worldPosition,
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
  const allPins = pinManager.pins;
  if (!allPins.length) return null;

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of allPins) {
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
