/**
 * Unit tests for PipelineB — Camera → CV Server → local scene raycast → SpatialPins.
 *
 * Covers the pinhole direction model, capture-time pose snapshotting,
 * synchronous raycast placement against scene geometry, fallback placement,
 * and model-preset dispatch.
 *
 * Uses real three.js objects (camera, meshes) so the raycast path is
 * exercised for real; only IWSDK and the frame encoder are mocked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { PinSource } from '../../src/spatial/SpatialPin.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock @iwsdk/core (CameraSource component token + facing enum)
const FAKE_CameraSource = Symbol('CameraSource');
vi.mock('@iwsdk/core', () => ({
  CameraSource: FAKE_CameraSource,
  CameraFacing: { Back: 'back' },
}));

// Mock the frame encoder — no canvas / createImageBitmap in node
vi.mock('../../src/cv/CaptureEncoder.js', () => ({
  encodeVideoFrame: vi.fn(async () => 'mockBase64'),
}));

// Import after mocks
const { PipelineB } = await import('../../src/pipeline/PipelineB.js');
const { appState } = await import('../../src/app/AppState.js');

// ── World / entity stubs ──────────────────────────────────────────────────

function makeWorld({ videoElement = null } = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.updateMatrixWorld(true);

  return {
    camera,
    scene: new THREE.Group(),
    createTransformEntity: vi.fn((obj) => ({
      _obj: obj,
      addComponent: vi.fn(),
      getValue: vi.fn((comp, key) => {
        if (comp === FAKE_CameraSource && key === 'videoElement') return videoElement;
        return null;
      }),
      object3D: obj,
    })),
  };
}

const FAKE_VIDEO = { readyState: 4, videoWidth: 1280, videoHeight: 720 };

function makePipeline(cvMock, { videoElement = FAKE_VIDEO } = {}) {
  const world = makeWorld({ videoElement });
  const mgr   = new SpatialPinManager();
  const pb    = new PipelineB(world, mgr, cvMock);
  pb.initCameraEntity();
  return { pb, mgr, world };
}

/** A 10×10 m wall facing the camera at z = -2 (world space). */
function makeWallTarget(z = -2, hitType = 'mesh') {
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial(),
  );
  wall.position.set(0, 1.6, z);
  wall.updateMatrixWorld(true);
  return { object: wall, hitType };
}

function gdinoCv(detections) {
  return { detect: vi.fn().mockResolvedValue({ detections }) };
}

function setPreset(name) {
  while (appState.modelPreset !== name) appState.cycleModel();
}

function setPreviewDistance(value) {
  while (appState.previewDistance !== value) appState.cyclePreviewDistance();
}

afterEach(() => {
  setPreset('Florence');
  setPreviewDistance(1);
  vi.restoreAllMocks();
});

// ── Intrinsics ─────────────────────────────────────────────────────────────

describe('PipelineB — camera intrinsics', () => {
  it('defaults to the configured passthrough-camera HFOV (80°)', () => {
    const { pb } = makePipeline({});
    expect(pb.hfov).toBeCloseTo((80 * Math.PI) / 180, 5);
  });

  it('derives the vertical FOV from the aspect ratio (pinhole model)', async () => {
    setPreset('GDino');
    const { pb } = makePipeline(gdinoCv([]));
    await pb.capture('cap', []);
    const expected = 2 * Math.atan(Math.tan(pb.hfov / 2) / (1280 / 720));
    expect(pb.vfov).toBeCloseTo(expected, 5);
  });
});

// ── Capture guard rails ────────────────────────────────────────────────────

describe('PipelineB — capture() — no camera', () => {
  it('warns and returns empty when the camera is not ready', async () => {
    const cv = { detect: vi.fn() };
    const { pb } = makePipeline(cv, { videoElement: null });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await pb.capture('cap-test', []);

    expect(result).toEqual({ pins: [], rays: [], error: 'Camera not ready' });
    expect(cv.detect).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ── Placement ──────────────────────────────────────────────────────────────

describe('PipelineB — pin placement via local raycast', () => {
  it('places a centred detection on the scene geometry it hits', async () => {
    setPreset('GDino');
    const cv = gdinoCv([
      { label: 'chair', cx: 0.5, cy: 0.5, confidence: 0.87, bbox_cxcywh: [0.5, 0.5, 0.2, 0.3] },
    ]);
    const { pb, mgr } = makePipeline(cv);

    const { pins, rays } = await pb.capture('cap-hit', [makeWallTarget(-2, 'mesh')]);

    expect(pins).toHaveLength(1);
    expect(rays).toHaveLength(1);
    expect(mgr.pins).toHaveLength(1);

    const pin = mgr.pins[0];
    expect(pin.label).toBe('chair');
    expect(pin.hitType).toBe('mesh');
    expect(pin.placementConfidence).toBe(0.95);
    // Camera at (0, 1.6, 0) looking -z; centred detection hits the wall at z=-2
    expect(pin.worldPosition.x).toBeCloseTo(0, 3);
    expect(pin.worldPosition.y).toBeCloseTo(1.6, 3);
    expect(pin.worldPosition.z).toBeCloseTo(-2, 3);
  });

  it('reports the hit type of the surface that was struck', async () => {
    setPreset('GDino');
    const cv = gdinoCv([{ label: 'rug', cx: 0.5, cy: 0.5, confidence: 0.8 }]);
    const { pb, mgr } = makePipeline(cv);

    await pb.capture('cap-plane', [makeWallTarget(-1.5, 'plane')]);
    expect(mgr.pins[0].hitType).toBe('plane');
  });

  it('falls back to previewDistance along the ray when nothing is hit', async () => {
    setPreset('GDino');
    setPreviewDistance(3);
    const cv = gdinoCv([{ label: 'sofa', cx: 0.5, cy: 0.5, confidence: 0.8 }]);
    const { pb, mgr } = makePipeline(cv);

    await pb.capture('cap-miss', []);   // no raycast targets

    const pin = mgr.pins[0];
    expect(pin.hitType).toBe('fallback');
    expect(pin.placementConfidence).toBe(0.5);
    expect(pin.worldPosition.z).toBeCloseTo(-3, 3);
  });

  it('still places a fallback pin when previewDistance is Off (detections are never dropped)', async () => {
    setPreset('GDino');
    setPreviewDistance(0);
    const cv = gdinoCv([{ label: 'lamp', cx: 0.5, cy: 0.5, confidence: 0.8 }]);
    const { pb, mgr } = makePipeline(cv);

    await pb.capture('cap-off', []);

    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].hitType).toBe('fallback');
    // Default fallback distance (2.5 m) used when preview is Off
    expect(mgr.pins[0].worldPosition.z).toBeCloseTo(-2.5, 3);
  });

  it('casts off-centre detections in the right direction', async () => {
    setPreset('GDino');
    const cv = gdinoCv([
      { label: 'left',  cx: 0.1, cy: 0.5, confidence: 0.8 },
      { label: 'right', cx: 0.9, cy: 0.5, confidence: 0.8 },
    ]);
    const { pb, mgr } = makePipeline(cv);

    await pb.capture('cap-sides', [makeWallTarget(-2, 'mesh')]);

    const left  = mgr.pins.find(p => p.label === 'left');
    const right = mgr.pins.find(p => p.label === 'right');
    // Image x grows rightward; camera looks down -z, so cx<0.5 lands at x<0
    expect(left.worldPosition.x).toBeLessThan(-0.5);
    expect(right.worldPosition.x).toBeGreaterThan(0.5);
    expect(left.worldPosition.x).toBeCloseTo(-right.worldPosition.x, 2);
  });

  it('raycasts from the pose at capture time, not the pose at CV response time', async () => {
    setPreset('GDino');
    let world;
    const cv = {
      detect: vi.fn().mockImplementation(async () => {
        // Simulate head movement during the CV round trip
        world.camera.position.set(5, 1.6, 0);
        world.camera.rotation.y = Math.PI / 2;
        world.camera.updateMatrixWorld(true);
        return { detections: [{ label: 'desk', cx: 0.5, cy: 0.5, confidence: 0.9 }] };
      }),
    };
    const built = makePipeline(cv);
    world = built.world;

    await built.pb.capture('cap-moved', [makeWallTarget(-2, 'mesh')]);

    // Pin must land where the camera was looking when the frame was grabbed
    const pin = built.mgr.pins[0];
    expect(pin.worldPosition.z).toBeCloseTo(-2, 3);
    expect(pin.worldPosition.x).toBeCloseTo(0, 3);
  });
});

// ── Model dispatch ─────────────────────────────────────────────────────────

describe('PipelineB — model presets', () => {
  it('calls detect once for the GDino preset', async () => {
    setPreset('GDino');
    const cv = gdinoCv([{ label: 'chair', cx: 0.5, cy: 0.5, confidence: 0.87 }]);
    const { pb } = makePipeline(cv);

    await pb.capture('cap-gdino', []);
    expect(cv.detect).toHaveBeenCalledOnce();
  });

  it('calls detect then segment for the SAM2 preset and stores the RLE mask', async () => {
    setPreset('SAM2');
    const cv = {
      detect: vi.fn().mockResolvedValue({
        detections: [{ label: 'bottle', cx: 0.3, cy: 0.7, confidence: 0.9, bbox_cxcywh: [0.3, 0.7, 0.1, 0.15] }],
      }),
      segment: vi.fn().mockResolvedValue({
        segments: [{ index: 0, score: 0.95, area: 1200, rle: { counts: [], size: [720, 1280] } }],
      }),
    };
    const { pb, mgr } = makePipeline(cv);

    await pb.capture('cap-sam2', []);

    expect(cv.detect).toHaveBeenCalledOnce();
    expect(cv.segment).toHaveBeenCalledOnce();
    expect(mgr.pins[0].maskRleJson).not.toBeNull();
  });

  it('calls both florence endpoints for the Florence preset and normalises bboxes', async () => {
    expect(appState.modelPreset).toBe('Florence');

    const cv = {
      florence: vi.fn().mockResolvedValue({
        result: {
          '<MORE_DETAILED_CAPTION>': 'a cozy living room',
          '<OD>': { labels: ['sofa', 'table'], bboxes: [[100, 50, 300, 250], [350, 80, 500, 180]] },
        },
      }),
    };
    const { pb, mgr } = makePipeline(cv);

    await pb.capture('cap-florence', []);

    expect(cv.florence).toHaveBeenCalledTimes(2);
    expect(mgr.pins).toHaveLength(2);
    expect(mgr.pins[0].florenceCaption).toBe('a cozy living room');
    // bbox centre of [100,50,300,250] in a 1280×720 frame
    expect(mgr.pins[0].bboxCxCyWH[0]).toBeCloseTo(200 / 1280, 4);
    expect(mgr.pins[0].bboxCxCyWH[1]).toBeCloseTo(150 / 720, 4);
  });

  it('handles CV server errors gracefully (no pins, error surfaced)', async () => {
    setPreset('GDino');
    const cv = { detect: vi.fn().mockRejectedValue(new Error('CV server down')) };
    const { pb, mgr } = makePipeline(cv);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await pb.capture('cap-fail', []);

    expect(result.pins).toHaveLength(0);
    expect(result.rays).toHaveLength(0);
    expect(result.error).toBe('CV server down');
    expect(mgr.pins).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});
