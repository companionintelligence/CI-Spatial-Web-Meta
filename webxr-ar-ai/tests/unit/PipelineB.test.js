/**
 * Unit tests for PipelineB — Camera → CV Server → Raycast → SpatialPins.
 *
 * Tests FOV calibration, pending raycast resolution, fallback timeout,
 * and the capture() pipeline dispatch logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { PinSource } from '../../src/spatial/SpatialPin.js';

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock three
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Vector3: class {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      setFromMatrixPosition(m) { this.x = 0; this.y = 1.6; this.z = 0; return this; }
      clone()                  { return new this.constructor(this.x, this.y, this.z); }
      addScaledVector(dir, d)  { this.x += dir.x * d; this.y += dir.y * d; this.z += dir.z * d; return this; }
      applyQuaternion(_q)      { return this; }
      normalize()              { return this; }
    },
    Quaternion: class {
      constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
      setFromEuler() { return this; }
    },
    Euler: class { constructor() {} },
    Object3D: class {
      constructor() { this.name = ''; }
      add() {}
    },
  };
});

// Mock @iwsdk/core
vi.mock('@iwsdk/core', () => {
  const EnvironmentRaycastTarget = { schema: { xrHitTestResult: {}, space: {} } };
  const RaycastSpace = { Viewer: 'viewer', Right: 'right', Left: 'left' };
  const CameraSource  = {};
  const CameraFacing  = { Back: 'back' };
  return { EnvironmentRaycastTarget, RaycastSpace, CameraSource, CameraFacing };
});

// Mock videoToBase64Jpeg
vi.mock('../../src/cv/CvServerClient.js', () => ({
  videoToBase64Jpeg: vi.fn(() => 'mockBase64'),
  CvServerClient: class {},
}));

// Import after mocks
const { PipelineB } = await import('../../src/pipeline/PipelineB.js');
const { appState, ModelPreset } = await import('../../src/app/AppState.js');
const { EnvironmentRaycastTarget } = await import('@iwsdk/core');

// ── World / entity stubs ──────────────────────────────────────────────────

function makeWorld(options = {}) {
  const camera = {
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    matrixWorld: { elements: new Float32Array(16) },
    getWorldPosition: (v) => { v.x = 0; v.y = 1.6; v.z = 0; },
  };

  // Fake XR camera projection matrix for FOV calibration
  if (options.withXrCamera) {
    const fovElements = new Array(16).fill(0);
    fovElements[0] = 1.19;  // m[0] — tan(HFOV/2)^-1
    fovElements[5] = 1.43;  // m[5] — tan(VFOV/2)^-1
    camera.projectionMatrix = { elements: fovElements };
    camera.getWorldPosition = (v) => { v.x = 0; v.y = 1.6; v.z = 0; return v; };
  }

  const entities = [];
  return {
    camera,
    scene: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    renderer: {
      xr: {
        getCamera: () => options.withXrCamera ? camera : (() => { throw new Error('no xr'); })(),
      },
    },
    createTransformEntity: vi.fn((obj) => {
      const entity = {
        _obj: obj,
        _components: {},
        addComponent: vi.fn((comp, data) => { entity._components[String(comp)] = data; }),
        getValue: vi.fn((comp, key) => {
          if (comp === EnvironmentRaycastTarget && key === 'xrHitTestResult') {
            return entity._xrHitResult ?? undefined;
          }
          if (key === 'videoElement') return options.videoElement ?? null;
          return null;
        }),
        destroy: vi.fn(),
        object3D: obj ? { position: { x: 0.5, y: 1, z: -1 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } } : null,
      };
      entities.push(entity);
      return entity;
    }),
    _entities: entities,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PipelineB — FOV calibration', () => {
  it('uses default FOV values when xr camera is unavailable', () => {
    const world = makeWorld({ withXrCamera: false });
    const mgr = new SpatialPinManager();
    const cv = { detect: vi.fn(), florence: vi.fn(), segment: vi.fn() };
    const pb = new PipelineB(world, mgr, cv);

    pb.calibrateFOV(); // Should not throw, just silently skip
    expect(pb._fovCalibrated).toBe(false);
    expect(pb._hfov).toBeCloseTo((100 * Math.PI) / 180, 3);
    expect(pb._vfov).toBeCloseTo((85  * Math.PI) / 180, 3);
  });

  it('calibrates FOV from XR camera projection matrix', () => {
    const world = makeWorld({ withXrCamera: true });
    const mgr = new SpatialPinManager();
    const cv = {};
    const pb = new PipelineB(world, mgr, cv);

    pb.calibrateFOV();

    expect(pb._fovCalibrated).toBe(true);
    // 2 * atan(1 / |m[0]|) = 2 * atan(1/1.19) ≈ 1.444 rad
    expect(pb._hfov).toBeCloseTo(2 * Math.atan(1 / 1.19), 2);
    expect(pb._vfov).toBeCloseTo(2 * Math.atan(1 / 1.43), 2);
  });

  it('does not re-calibrate once calibrated', () => {
    const world = makeWorld({ withXrCamera: true });
    const getCameraSpy = vi.spyOn(world.renderer.xr, 'getCamera');
    const pb = new PipelineB(world, new SpatialPinManager(), {});
    pb.calibrateFOV();
    pb.calibrateFOV(); // second call
    expect(getCameraSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineB — resolvePending() hit result', () => {
  it('promotes entity with hit result to a SpatialPin', async () => {
    const world = makeWorld();
    const mgr = new SpatialPinManager();
    const pb = new PipelineB(world, mgr, {});

    // Manually push a pending item
    const { SpatialPin } = await import('../../src/spatial/SpatialPin.js');
    const pin = new SpatialPin();
    pin.source = PinSource.CvServer;
    pin.label  = 'chair';

    const entity = {
      getValue: vi.fn((comp, key) => {
        if (key === 'xrHitTestResult') return { some: 'hit' };
        return null;
      }),
      object3D: { position: { x: 1, y: 0.5, z: -2 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
      destroy: vi.fn(),
    };

    pb._pending.push({ entity, pin, createdFrame: Date.now(), angleH: 0, angleV: 0 });
    pb.resolvePending();

    expect(entity.destroy).toHaveBeenCalled();
    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].label).toBe('chair');
    expect(mgr.pins[0].hitType).toBe('plane');
    expect(mgr.pins[0].placementConfidence).toBe(0.95);
    expect(pb._pending).toHaveLength(0);
  });
});

describe('PipelineB — resolvePending() timeout fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
    // Reset appState
    while (appState.previewDistance !== 1) appState.cyclePreviewDistance();
  });

  it('falls back to previewDistance placement after 500ms', async () => {
    vi.useFakeTimers();

    const world = makeWorld();
    const mgr = new SpatialPinManager();
    const pb = new PipelineB(world, mgr, {});

    const { SpatialPin } = await import('../../src/spatial/SpatialPin.js');
    const pin = new SpatialPin();
    pin.source = PinSource.CvServer;
    pin.label = 'sofa';

    const entity = {
      getValue: vi.fn(() => undefined), // no hit result
      object3D: null,
      destroy: vi.fn(),
    };

    pb._pending.push({ entity, pin, createdFrame: Date.now(), angleH: 0.1, angleV: 0.05 });

    // Advance time past the 500ms timeout
    vi.advanceTimersByTime(600);
    pb.resolvePending();

    expect(entity.destroy).toHaveBeenCalled();
    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].hitType).toBe('fallback');
    expect(mgr.pins[0].placementConfidence).toBe(0.5);
  });

  it('does not add fallback pin when previewDistance is Off (0)', async () => {
    vi.useFakeTimers();

    // Set previewDistance to Off
    while (appState.previewDistance !== 0) appState.cyclePreviewDistance();

    const world = makeWorld();
    const mgr = new SpatialPinManager();
    const pb = new PipelineB(world, mgr, {});

    const entity = { getValue: vi.fn(() => undefined), object3D: null, destroy: vi.fn() };
    const { SpatialPin } = await import('../../src/spatial/SpatialPin.js');
    const pin = new SpatialPin();
    pin.source = PinSource.CvServer;
    pin.trackId = null;

    pb._pending.push({ entity, pin, createdFrame: Date.now(), angleH: 0, angleV: 0 });
    vi.advanceTimersByTime(600);
    pb.resolvePending();

    expect(mgr.pins).toHaveLength(0);
    expect(entity.destroy).toHaveBeenCalled();
  });
});

describe('PipelineB — capture() — no camera', () => {
  it('logs warning and returns early if camera entity is not ready', async () => {
    const world = makeWorld({ videoElement: null });
    const mgr = new SpatialPinManager();
    const cv = { detect: vi.fn(), florence: vi.fn(), segment: vi.fn() };

    const pb = new PipelineB(world, mgr, cv);
    pb.initCameraEntity();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await pb.capture('cap-test');

    expect(cv.detect).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('PipelineB — capture() — with ready camera', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makePbWithCamera(cvMock) {
    const fakeVideo = { readyState: 4, videoWidth: 1280, videoHeight: 720 };
    const world = makeWorld({ videoElement: fakeVideo });
    const mgr = new SpatialPinManager();
    const pb = new PipelineB(world, mgr, cvMock);
    pb.initCameraEntity();
    return { pb, mgr, world };
  }

  it('calls detect for GDino preset and creates pending entities', async () => {
    // Set to GDino
    while (appState.modelPreset !== 'GDino') appState.cycleModel();

    const cv = {
      detect: vi.fn().mockResolvedValue({
        detections: [
          { label: 'chair', cx: 0.5, cy: 0.5, confidence: 0.87, bbox_cxcywh: [0.5, 0.5, 0.2, 0.3] },
        ],
      }),
    };

    const { pb, mgr } = makePbWithCamera(cv);
    await pb.capture('cap-gdino');

    expect(cv.detect).toHaveBeenCalledOnce();
    expect(pb._pending).toHaveLength(1);
    expect(pb._pending[0].pin.label).toBe('chair');

    // Restore state
    while (appState.modelPreset !== 'Florence') appState.cycleModel();
  });

  it('calls segment for SAM2 preset after detect', async () => {
    while (appState.modelPreset !== 'SAM2') appState.cycleModel();

    const cv = {
      detect: vi.fn().mockResolvedValue({
        detections: [
          { label: 'bottle', cx: 0.3, cy: 0.7, confidence: 0.9, bbox_cxcywh: [0.3, 0.7, 0.1, 0.15] },
        ],
      }),
      segment: vi.fn().mockResolvedValue({
        segments: [{ index: 0, score: 0.95, area: 1200, rle: { counts: [], size: [720, 1280] } }],
      }),
    };

    const { pb } = makePbWithCamera(cv);
    await pb.capture('cap-sam2');

    expect(cv.detect).toHaveBeenCalledOnce();
    expect(cv.segment).toHaveBeenCalledOnce();
    expect(pb._pending[0].pin.maskRleJson).not.toBeNull();

    while (appState.modelPreset !== 'Florence') appState.cycleModel();
  });

  it('handles CV server errors gracefully (no pending pins)', async () => {
    while (appState.modelPreset !== 'GDino') appState.cycleModel();

    const cv = { detect: vi.fn().mockRejectedValue(new Error('CV server down')) };
    const { pb, mgr } = makePbWithCamera(cv);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pb.capture('cap-fail');

    expect(pb._pending).toHaveLength(0);
    expect(mgr.pins).toHaveLength(0);
    errorSpy.mockRestore();
    while (appState.modelPreset !== 'Florence') appState.cycleModel();
  });

  it('calls both florence endpoints for Florence preset', async () => {
    // Already at Florence
    expect(appState.modelPreset).toBe('Florence');

    const cv = {
      florence: vi.fn().mockResolvedValue({
        result: {
          '<MORE_DETAILED_CAPTION>': 'a cozy living room',
          '<OD>': { labels: ['sofa', 'table'], bboxes: [[100, 50, 300, 250], [350, 80, 500, 180]] },
        },
      }),
    };

    const { pb } = makePbWithCamera(cv);
    await pb.capture('cap-florence');

    // florence is called twice (caption + OD)
    expect(cv.florence).toHaveBeenCalledTimes(2);
  });
});
