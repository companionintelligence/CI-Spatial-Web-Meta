const DEFAULT_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const DEFAULT_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });

export function createEmptyMetadata() {
  return {
    version: '1.0',
    session_id: '',
    exported_at: null,
    floorplan: null,
    pins: [],
  };
}

export function extractCompanionScanMetadata(gltf) {
  const parserSceneIndex = gltf?.parser?.json?.scene ?? 0;
  const metadata = [
    gltf?.scene?.userData?.companion_scan,
    gltf?.scene?.userData?.gltfExtras?.companion_scan,
    gltf?.scenes?.[0]?.userData?.companion_scan,
    gltf?.parser?.json?.scenes?.[parserSceneIndex]?.extras?.companion_scan,
    gltf?.parser?.json?.extras?.companion_scan,
  ].find(Boolean);

  return normaliseCompanionScanMetadata(metadata);
}

export function normaliseCompanionScanMetadata(metadata) {
  const base = metadata ? clonePlainObject(metadata) : createEmptyMetadata();
  const pins = Array.isArray(base.pins)
    ? base.pins.map((pin, index) => normalisePin(pin, index))
    : [];

  return {
    version: base.version ?? '1.0',
    session_id: base.session_id ?? '',
    exported_at: base.exported_at ?? null,
    floorplan: normaliseFloorplan(base.floorplan, pins),
    pins,
  };
}

export function updateMetadataPin(metadata, pinId, updates) {
  const next = normaliseCompanionScanMetadata(metadata);
  next.pins = next.pins.map(pin => {
    if (pin.id !== pinId) return pin;

    return normalisePin({
      ...pin,
      ...clonePlainObject(updates),
      position: {
        ...pin.position,
        ...(updates?.position ?? {}),
      },
      rotation: {
        ...pin.rotation,
        ...(updates?.rotation ?? {}),
      },
    });
  });
  next.floorplan = normaliseFloorplan(null, next.pins);
  return next;
}

export function applyMetadataToObject(object3D, metadata) {
  const next = normaliseCompanionScanMetadata(metadata);
  object3D.userData.companion_scan = next;
  object3D.userData.gltfExtras = { companion_scan: next };
  return next;
}

export function metadataToJson(metadata) {
  return JSON.stringify(normaliseCompanionScanMetadata(metadata), null, 2);
}

export function createDemoMetadata() {
  return normaliseCompanionScanMetadata({
    version: '1.0',
    session_id: 'demo-session',
    exported_at: '2026-03-24T00:00:00.000Z',
    pins: [
      {
        id: 'pin-demo-floor',
        source: 'MetaScene',
        label: 'Floor Anchor',
        position: { x: 0, y: 0.02, z: 0 },
        semantic_labels: ['FLOOR', 'HORIZONTAL_PLANE'],
        confidence: 1,
        hit_type: 'plane',
        placement_confidence: 1,
      },
      {
        id: 'pin-demo-desk',
        source: 'CvServer',
        label: 'Desk',
        position: { x: 0.8, y: 0.76, z: -1.1 },
        confidence: 0.93,
        hit_type: 'plane',
        florence_caption: 'A work desk with a monitor and lamp.',
      },
      {
        id: 'pin-demo-chair',
        source: 'CvServer',
        label: 'Chair',
        position: { x: -0.65, y: 0.45, z: -0.85 },
        confidence: 0.88,
        hit_type: 'fallback',
        florence_caption: 'An office chair near the desk.',
      },
    ],
  });
}

function normalisePin(pin, index = 0) {
  const source = pin?.source === 'MetaScene' ? 'MetaScene' : 'CvServer';

  return {
    id: pin?.id ?? `pin-${index + 1}`,
    source,
    label: pin?.label ?? '',
    position: normaliseVec3(pin?.position, DEFAULT_POSITION),
    rotation: normaliseQuat(pin?.rotation),
    confidence: normaliseNumber(pin?.confidence, 0),
    bbox_cxcywh: Array.isArray(pin?.bbox_cxcywh) ? [...pin.bbox_cxcywh] : null,
    hit_type: pin?.hit_type ?? 'fallback',
    placement_confidence: normaliseNumber(pin?.placement_confidence, 1),
    track_id: pin?.track_id ?? null,
    capture_id: pin?.capture_id ?? '',
    capture_session_id: pin?.capture_session_id ?? '',
    capture_frame_index: normaliseNumber(pin?.capture_frame_index, 0),
    semantic_labels: Array.isArray(pin?.semantic_labels) ? [...pin.semantic_labels] : null,
    plane_extents: pin?.plane_extents ? clonePlainObject(pin.plane_extents) : null,
    volume_extents: pin?.volume_extents ? clonePlainObject(pin.volume_extents) : null,
    mask_rle: pin?.mask_rle ? clonePlainObject(pin.mask_rle) : null,
    florence_caption: pin?.florence_caption ?? null,
    created_at: pin?.created_at ?? null,
  };
}

function normaliseFloorplan(floorplan, pins) {
  if (!floorplan) return computeFloorplanFromPins(pins);

  return {
    bounds: {
      min: normaliseVec3(floorplan?.bounds?.min, DEFAULT_POSITION),
      max: normaliseVec3(floorplan?.bounds?.max, DEFAULT_POSITION),
    },
    cv_pin_count: normaliseNumber(floorplan?.cv_pin_count, pins.filter(pin => pin.source === 'CvServer').length),
    scene_pin_count: normaliseNumber(floorplan?.scene_pin_count, pins.filter(pin => pin.source === 'MetaScene').length),
  };
}

function computeFloorplanFromPins(pins) {
  if (!pins.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const pin of pins) {
    const { x, y, z } = pin.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    cv_pin_count: pins.filter(pin => pin.source === 'CvServer').length,
    scene_pin_count: pins.filter(pin => pin.source === 'MetaScene').length,
  };
}

function normaliseVec3(value, fallback) {
  return {
    x: normaliseNumber(value?.x, fallback.x),
    y: normaliseNumber(value?.y, fallback.y),
    z: normaliseNumber(value?.z, fallback.z),
  };
}

function normaliseQuat(value) {
  return {
    x: normaliseNumber(value?.x, DEFAULT_ROTATION.x),
    y: normaliseNumber(value?.y, DEFAULT_ROTATION.y),
    z: normaliseNumber(value?.z, DEFAULT_ROTATION.z),
    w: normaliseNumber(value?.w, DEFAULT_ROTATION.w),
  };
}

function normaliseNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clonePlainObject(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}
