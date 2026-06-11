/**
 * scanMetadata — normalization and editing operations for companion_scan
 * blocks, powering the desktop editor.
 *
 * Absorbed from PR #3 (Pascal-style GLTF world map viewer/editor): pin
 * normalization with defaults, in-place pin updates with floorplan
 * recomputation, and JSON serialisation — adapted to the v1.1 schema
 * (anchor-local positions, anchor_uuid).
 *
 * Pure data module: no DOM, no three.js — unit-testable in Node.
 */

const DEFAULT_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** @returns {object} an empty, normalized scan block */
export function createEmptyScan() {
  return {
    version: '1.1',
    session_id: '',
    exported_at: null,
    anchor_uuid: null,
    pins: [],
    floorplan: null,
  };
}

/**
 * Normalize a scan block: defaults for every pin field, floorplan recomputed
 * when missing. Never mutates the input.
 */
export function normalizeScan(scan) {
  const base = scan ? clone(scan) : createEmptyScan();
  const pins = Array.isArray(base.pins)
    ? base.pins.map((pin, i) => normalizePin(pin, i))
    : [];

  return {
    version:     base.version ?? '1.1',
    session_id:  base.session_id ?? '',
    exported_at: base.exported_at ?? null,
    anchor_uuid: base.anchor_uuid ?? null,
    pins,
    floorplan:   base.floorplan ? clone(base.floorplan) : computeFloorplan(pins),
  };
}

/**
 * Return a new scan with one pin updated (position/rotation merged
 * field-wise) and the floorplan recomputed from the edited pins.
 *
 * @param {object} scan
 * @param {string} pinId
 * @param {object} updates partial pin fields
 */
export function updatePin(scan, pinId, updates) {
  const next = normalizeScan(scan);
  next.pins = next.pins.map(pin => {
    if (pin.id !== pinId) return pin;
    return normalizePin({
      ...pin,
      ...clone(updates),
      position: { ...pin.position, ...(updates?.position ?? {}) },
      position_anchor_local: {
        ...(pin.position_anchor_local ?? pin.position),
        ...(updates?.position_anchor_local ?? updates?.position ?? {}),
      },
      rotation: { ...pin.rotation, ...(updates?.rotation ?? {}) },
    });
  });
  next.floorplan = computeFloorplan(next.pins);
  return next;
}

/** Return a new scan with one pin removed and the floorplan recomputed. */
export function removePin(scan, pinId) {
  const next = normalizeScan(scan);
  next.pins = next.pins.filter(pin => pin.id !== pinId);
  next.floorplan = computeFloorplan(next.pins);
  return next;
}

/** Pretty JSON of the normalized scan (the "Export JSON" payload). */
export function scanToJson(scan) {
  return JSON.stringify(normalizeScan(scan), null, 2);
}

/**
 * Floorplan bounds from pin positions, excluding fallback placements
 * (distance guesses) — same policy as the in-headset exporter.
 */
export function computeFloorplan(pins) {
  const placed = pins.filter(p => p.hit_type !== 'fallback');
  if (!placed.length) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const pin of placed) {
    const p = pin.position_anchor_local ?? pin.position;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }

  return {
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    cv_pin_count:    pins.filter(p => p.source === 'CvServer').length,
    scene_pin_count: pins.filter(p => p.source === 'MetaScene').length,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function normalizePin(pin, index = 0) {
  const source = pin?.source === 'MetaScene' ? 'MetaScene' : 'CvServer';
  const position = vec3(pin?.position, DEFAULT_POSITION);
  return {
    id:                   pin?.id ?? `pin-${index + 1}`,
    source,
    label:                pin?.label ?? '',
    position,
    position_anchor_local: vec3(pin?.position_anchor_local, position),
    rotation:             quat(pin?.rotation),
    confidence:           num(pin?.confidence, 0),
    bbox_cxcywh:          Array.isArray(pin?.bbox_cxcywh) ? [...pin.bbox_cxcywh] : null,
    hit_type:             pin?.hit_type ?? 'fallback',
    placement_confidence: num(pin?.placement_confidence, 1),
    track_id:             pin?.track_id ?? null,
    capture_id:           pin?.capture_id ?? '',
    capture_session_id:   pin?.capture_session_id ?? '',
    capture_frame_index:  num(pin?.capture_frame_index, 0),
    semantic_labels:      Array.isArray(pin?.semantic_labels) ? [...pin.semantic_labels] : null,
    plane_extents:        pin?.plane_extents ? clone(pin.plane_extents) : null,
    volume_extents:       pin?.volume_extents ? clone(pin.volume_extents) : null,
    mask_rle:             pin?.mask_rle ? clone(pin.mask_rle) : null,
    florence_caption:     pin?.florence_caption ?? null,
    created_at:           pin?.created_at ?? null,
  };
}

function vec3(value, fallback) {
  return {
    x: num(value?.x, fallback.x),
    y: num(value?.y, fallback.y),
    z: num(value?.z, fallback.z),
  };
}

function quat(value) {
  return {
    x: num(value?.x, DEFAULT_ROTATION.x),
    y: num(value?.y, DEFAULT_ROTATION.y),
    z: num(value?.z, DEFAULT_ROTATION.z),
    w: num(value?.w, DEFAULT_ROTATION.w),
  };
}

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}
