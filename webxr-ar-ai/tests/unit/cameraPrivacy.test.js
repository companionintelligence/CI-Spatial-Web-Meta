/**
 * Camera privacy in PipelineB: off at start, on only by an explicit opt-in, stopped and
 * detached when turned off, and no frame or request leaves while it is off.
 * The local-only refusal is checked end to end with the real LocalScanClient.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { LocalScanClient } from '../../src/scan/LocalScanClient.js';

const { encodeVideoFrame } = vi.hoisted(() => ({
  encodeVideoFrame: vi.fn(async () => 'QkFTRTY0'),
}));
const FAKE_CameraSource = Symbol('CameraSource');
const FAKE_CameraSystem = Symbol('CameraSystem');
vi.mock('@iwsdk/core', () => ({
  CameraSource: FAKE_CameraSource,
  CameraFacing: { Back: 'back' },
  CameraSystem: FAKE_CameraSystem,
}));
vi.mock('../../src/cv/CaptureEncoder.js', () => ({ encodeVideoFrame }));

const { PipelineB } = await import('../../src/pipeline/PipelineB.js');
const { appState, ModelPreset } = await import('../../src/app/AppState.js');

const VIDEO = { readyState: 4, videoWidth: 1280, videoHeight: 720 };

function makeWorld(stopCamera = vi.fn()) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.updateMatrixWorld(true);
  const entity = {
    addComponent: vi.fn(),
    removeComponent: vi.fn(),
    hasComponent: vi.fn((component) => component === FAKE_CameraSource),
    getValue: vi.fn((component, key) => (component === FAKE_CameraSource && key === 'videoElement' ? VIDEO : null)),
  };
  const world = {
    camera,
    scene: new THREE.Group(),
    createTransformEntity: vi.fn(() => entity),
    getSystem: vi.fn((system) => (system === FAKE_CameraSystem ? { stopCamera } : undefined)),
  };
  return { world, entity, stopCamera };
}

function makePipeline({ cv = {}, localScan = null, world } = {}) {
  const mgr = new SpatialPinManager();
  const pb = new PipelineB(world, mgr, cv, localScan);
  pb.initCameraEntity();
  return { pb, mgr };
}

afterEach(() => {
  appState.modelPreset = ModelPreset.Local;
  appState.setCameraOn(false);
  encodeVideoFrame.mockClear();
});

describe('camera opt-in', () => {
  it('is off when the app starts: no stream is requested and nothing is captured or sent', async () => {
    const { world, entity } = makeWorld();
    const cv = { detect: vi.fn(), florence: vi.fn(), segment: vi.fn() };
    const { pb } = makePipeline({ cv, world });

    expect(pb.cameraOn).toBe(false);
    expect(entity.addComponent).not.toHaveBeenCalled();

    const result = await pb.capture('cap-off', []);
    expect(result).toEqual({ pins: [], rays: [], skipped: 'camera-off' });
    expect(encodeVideoFrame).not.toHaveBeenCalled();
    expect(cv.detect).not.toHaveBeenCalled();
    expect(cv.florence).not.toHaveBeenCalled();
  });

  it('turning it on attaches the CameraSource that starts the stream', () => {
    const { world, entity } = makeWorld();
    const { pb } = makePipeline({ world });

    expect(pb.setCameraOn(true)).toBe(true);
    expect(entity.addComponent).toHaveBeenCalledTimes(1);
    expect(entity.addComponent).toHaveBeenCalledWith(FAKE_CameraSource, {
      facing: 'back', width: 1280, height: 720, frameRate: 30,
    });
    expect(pb.cameraOn).toBe(true);
  });

  it('turning it on twice attaches it once', () => {
    const { world, entity } = makeWorld();
    const { pb } = makePipeline({ world });
    pb.setCameraOn(true);
    pb.setCameraOn(true);
    expect(entity.addComponent).toHaveBeenCalledTimes(1);
  });

  it('turning it off stops the stream and detaches the component, so it cannot restart', async () => {
    const { world, entity, stopCamera } = makeWorld();
    const cv = { detect: vi.fn() };
    const { pb } = makePipeline({ cv, world });
    pb.setCameraOn(true);

    expect(pb.setCameraOn(false)).toBe(false);
    expect(stopCamera).toHaveBeenCalledWith(entity);
    expect(entity.removeComponent).toHaveBeenCalledWith(FAKE_CameraSource);

    const result = await pb.capture('cap-after-off', []);
    expect(result.skipped).toBe('camera-off');
    expect(cv.detect).not.toHaveBeenCalled();
  });

  it('captures and sends a keyframe, with its pose, intrinsics and the planes, only while on', async () => {
    const { world } = makeWorld();
    const submit = vi.fn(async () => ({ scanId: 'scan_x', keyframes: [], detections: [] }));
    const { pb } = makePipeline({ world, localScan: { submit } });
    appState.modelPreset = ModelPreset.Local;
    pb.setCameraOn(true);

    const planes = [{ id: 'plane-1', label: 'floor' }];
    await pb.capture('cap-on', [], { planes });

    expect(encodeVideoFrame).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    const sent = submit.mock.calls[0][0];
    expect(sent.planes).toBe(planes);
    expect(sent.keyframe.image).toMatchObject({ format: 'jpeg', width: 1280, height: 720, base64: 'QkFTRTY0' });
    expect(sent.keyframe.pose.frame).toBe('local-floor');
    expect(sent.keyframe.intrinsics.cx).toBe(640);
    expect(sent.keyframe.client_keyframe_id).toBe('cap-on');
    expect(sent.hierarchy.room.id).toMatch(/^room-/);
    expect(sent.client.device).toBe('meta-quest-3');
  });

  it('sends the camera consent with the keyframe, dated to the moment the user opted in', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-16T19:40:00.000Z'));
      const { world } = makeWorld();
      const submit = vi.fn(async () => ({ scanId: 'scan_x', keyframes: [], detections: [] }));
      const { pb } = makePipeline({ world, localScan: { submit } });
      appState.modelPreset = ModelPreset.Local;

      pb.setCameraOn(true);
      vi.setSystemTime(new Date('2026-11-16T19:45:00.000Z'));
      await pb.capture('cap-consent', []);

      expect(submit.mock.calls[0][0].consent).toEqual({
        camera: true,
        granted_at: '2026-11-16T19:40:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('dates a second opt-in to the second time, and sends no consent once the camera is off', async () => {
    vi.useFakeTimers();
    try {
      const { world } = makeWorld();
      const submit = vi.fn(async () => ({ scanId: 'scan_x', keyframes: [], detections: [] }));
      const { pb } = makePipeline({ world, localScan: { submit } });
      appState.modelPreset = ModelPreset.Local;

      vi.setSystemTime(new Date('2026-11-16T19:40:00.000Z'));
      pb.setCameraOn(true);
      pb.setCameraOn(false);
      vi.setSystemTime(new Date('2026-11-16T20:00:00.000Z'));
      pb.setCameraOn(true);
      await pb.capture('cap-again', []);
      expect(submit.mock.calls[0][0].consent.granted_at).toBe('2026-11-16T20:00:00.000Z');

      pb.setCameraOn(false);
      const off = await pb.capture('cap-off-again', []);
      expect(off.skipped).toBe('camera-off');
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a public scan server: the status names the host and nothing is sent', async () => {
    const { world } = makeWorld();
    const fetchImpl = vi.fn();
    const localScan = new LocalScanClient({ getBaseUrl: () => 'https://meta.ci.computer', fetchImpl });
    const { pb } = makePipeline({ world, localScan });
    appState.modelPreset = ModelPreset.Local;
    pb.setCameraOn(true);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await pb.capture('cap-public', []);
    warn.mockRestore();

    expect(result.error).toBe('meta.ci.computer is not on this network. Scan data stays on the local server.');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.pins).toHaveLength(0);
  });
});
