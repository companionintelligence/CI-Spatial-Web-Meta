/**
 * Unit tests for GltfExporter — serialisation helpers and floorplan computation.
 *
 * The `exportGltf` function is tested via mocking GLTFExporter.
 * Private helpers (_serialisePin, _computeFloorplan) are tested indirectly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpatialPin, PinSource } from '../../src/spatial/SpatialPin.js';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';

// ── Mock three/examples/jsm/exporters/GLTFExporter.js ─────────────────────

vi.mock('three/examples/jsm/exporters/GLTFExporter.js', () => {
  class GLTFExporter {
    parse(scene, onDone, _onError, _opts) {
      // Return a simple ArrayBuffer to simulate GLB output
      onDone(new ArrayBuffer(64));
    }
  }
  return { GLTFExporter };
});

// Mock AppState (the exporter reads appState.captureSessionId)
vi.mock('../../src/app/AppState.js', () => ({
  appState: { captureSessionId: 'test-session-id' },
}));

// ── Import after mocks ────────────────────────────────────────────────────

const { exportGltf } = await import('../../src/export/GltfExporter.js');

// ── Helpers ───────────────────────────────────────────────────────────────

function makeScene() {
  return { userData: {} };
}

function makePin(overrides = {}) {
  const p = new SpatialPin();
  Object.assign(p, overrides);
  return p;
}

describe('exportGltf — basic output', () => {
  it('returns an ArrayBuffer', async () => {
    const scene = makeScene();
    const mgr = new SpatialPinManager();
    const glb = await exportGltf(scene, mgr);
    expect(glb).toBeInstanceOf(ArrayBuffer);
  });

  it('cleans up scene.userData.companion_scan after export', async () => {
    const scene = makeScene();
    const mgr = new SpatialPinManager();
    await exportGltf(scene, mgr);
    expect(scene.userData.companion_scan).toBeUndefined();
  });

  it('restores previous companion_scan userData after export', async () => {
    const scene = makeScene();
    scene.userData.companion_scan = { prev: true };
    const mgr = new SpatialPinManager();
    await exportGltf(scene, mgr);
    expect(scene.userData.companion_scan).toEqual({ prev: true });
  });
});

describe('exportGltf — extras structure', () => {
  let capturedExtras;

  beforeEach(() => {
    capturedExtras = null;
  });

  it('injects companion_scan extras with correct schema', async () => {
    // Intercept the extras by reading them from the scene mid-parse
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    GLTFExporter.prototype.parse = function (scene, onDone) {
      capturedExtras = JSON.parse(JSON.stringify({ companion_scan: scene.userData.companion_scan }));
      onDone(new ArrayBuffer(8));
    };

    const scene = makeScene();
    const mgr = new SpatialPinManager();
    const pin = makePin({
      source: PinSource.CvServer,
      label: 'chair',
      confidence: 0.87,
      bboxCxCyWH: [0.5, 0.5, 0.1, 0.2],
      hitType: 'plane',
      placementConfidence: 0.95,
      trackId: 'track-1',
      captureId: 'cap-1',
      captureSessionId: 'session-abc',
      captureFrameIndex: 3,
      semanticLabels: null,
      planeExtents: null,
      florenceCaption: 'A wooden chair',
      maskRleJson: null,
    });
    pin.worldPosition = { x: 1.2, y: 0.5, z: -2.1 };
    pin.worldRotation = { x: 0, y: 0, z: 0, w: 1 };
    mgr.addOrUpdate(pin);

    await exportGltf(scene, mgr);

    expect(capturedExtras).toBeDefined();
    const cs = capturedExtras.companion_scan;
    expect(cs.version).toBe('1.1');
    expect(cs.session_id).toBe('test-session-id');
    expect(typeof cs.exported_at).toBe('string');
    expect(cs.anchor_uuid).toBeNull();
    expect(cs.pins).toHaveLength(1);
  });

  it('includes anchor uuid and anchor-local positions when provided', async () => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    GLTFExporter.prototype.parse = function (scene, onDone) {
      capturedExtras = JSON.parse(JSON.stringify({ companion_scan: scene.userData.companion_scan }));
      onDone(new ArrayBuffer(8));
    };

    const mgr = new SpatialPinManager();
    const pin = makePin({ hitType: 'plane' });
    pin.worldPosition = { x: 1, y: 2, z: 3 };
    mgr.addOrUpdate(pin);

    await exportGltf(makeScene(), mgr, {
      anchorUuid: 'uuid-1234',
      worldToAnchorLocal: (p) => ({ x: p.x - 1, y: p.y - 1, z: p.z - 1 }),
    });

    const cs = capturedExtras.companion_scan;
    expect(cs.anchor_uuid).toBe('uuid-1234');
    expect(cs.pins[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(cs.pins[0].position_anchor_local).toEqual({ x: 0, y: 1, z: 2 });
  });

  it('serialises all pin fields correctly', async () => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    GLTFExporter.prototype.parse = function (scene, onDone) {
      capturedExtras = JSON.parse(JSON.stringify({ companion_scan: scene.userData.companion_scan }));
      onDone(new ArrayBuffer(8));
    };

    const scene = makeScene();
    const mgr = new SpatialPinManager();
    const pin = makePin({
      source: PinSource.MetaScene,
      label: 'floor',
      confidence: 0.99,
      bboxCxCyWH: null,
      hitType: 'plane',
      placementConfidence: 1,
      trackId: 'floor-track',
      captureId: 'cap-2',
      captureSessionId: 'session-xyz',
      captureFrameIndex: 0,
      semanticLabels: ['FLOOR'],
      planeExtents: { center: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 0, z: 4 } },
      florenceCaption: null,
      maskRleJson: JSON.stringify({ counts: [], size: [100, 100] }),
    });
    mgr.addOrUpdate(pin);

    await exportGltf(scene, mgr);

    const serialised = capturedExtras.companion_scan.pins[0];
    expect(serialised.id).toBe(pin.id);
    expect(serialised.source).toBe('MetaScene');
    expect(serialised.label).toBe('floor');
    expect(serialised.confidence).toBe(0.99);
    expect(serialised.hit_type).toBe('plane');
    expect(serialised.placement_confidence).toBe(1);
    expect(serialised.track_id).toBe('floor-track');
    expect(serialised.capture_id).toBe('cap-2');
    expect(serialised.capture_session_id).toBe('session-xyz');
    expect(serialised.capture_frame_index).toBe(0);
    expect(serialised.semantic_labels).toEqual(['FLOOR']);
    expect(serialised.plane_extents).toEqual({ center: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 0, z: 4 } });
    expect(serialised.mask_rle).toEqual({ counts: [], size: [100, 100] });
    expect(serialised.florence_caption).toBeNull();
  });
});

describe('exportGltf — floorplan computation', () => {
  let capturedExtras;
  beforeEach(() => { capturedExtras = null; });

  async function captureExtras(mgr) {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    GLTFExporter.prototype.parse = function (scene, onDone) {
      capturedExtras = JSON.parse(JSON.stringify({ companion_scan: scene.userData.companion_scan }));
      onDone(new ArrayBuffer(8));
    };
    await exportGltf(makeScene(), mgr);
    return capturedExtras.companion_scan.floorplan;
  }

  it('returns null floorplan when no pins', async () => {
    const mgr = new SpatialPinManager();
    const fp = await captureExtras(mgr);
    expect(fp).toBeNull();
  });

  it('computes correct bounding box from pin positions', async () => {
    const mgr = new SpatialPinManager();
    const positions = [
      { x: -1, y:  0, z: -2 },
      { x:  3, y:  2, z:  4 },
      { x:  0, y: -1, z:  0 },
    ];
    for (const pos of positions) {
      const p = makePin({ hitType: 'plane' });
      p.worldPosition = pos;
      mgr.addOrUpdate(p);
    }

    const fp = await captureExtras(mgr);
    expect(fp.bounds.min).toEqual({ x: -1, y: -1, z: -2 });
    expect(fp.bounds.max).toEqual({ x:  3, y:  2, z:  4 });
  });

  it('excludes fallback pins (distance guesses) from the bounds', async () => {
    const mgr = new SpatialPinManager();
    const placed = makePin({ hitType: 'mesh' });
    placed.worldPosition = { x: 1, y: 1, z: 1 };
    mgr.addOrUpdate(placed);

    const guess = makePin({ hitType: 'fallback' });
    guess.worldPosition = { x: 100, y: 100, z: 100 };
    mgr.addOrUpdate(guess);

    const fp = await captureExtras(mgr);
    expect(fp.bounds.max).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('returns null floorplan when all pins are fallback guesses', async () => {
    const mgr = new SpatialPinManager();
    mgr.addOrUpdate(makePin({ hitType: 'fallback' }));
    const fp = await captureExtras(mgr);
    expect(fp).toBeNull();
  });

  it('counts cv and scene pins separately in floorplan', async () => {
    const mgr = new SpatialPinManager();
    mgr.addOrUpdate(makePin({ source: PinSource.CvServer, hitType: 'plane' }));
    mgr.addOrUpdate(makePin({ source: PinSource.CvServer, hitType: 'plane' }));
    mgr.addOrUpdate(makePin({ source: PinSource.MetaScene, hitType: 'plane' }));

    const fp = await captureExtras(mgr);
    expect(fp.cv_pin_count).toBe(2);
    expect(fp.scene_pin_count).toBe(1);
  });
});
