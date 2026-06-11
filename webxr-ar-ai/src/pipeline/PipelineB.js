/**
 * Pipeline B — Camera → CV Server (Florence / GDino / SAM2) → local raycast → SpatialPins.
 *
 * Flow:
 *   1. Snapshot the viewer pose, then capture the current video frame from the
 *      CameraSource entity (async JPEG encode off the main thread).
 *   2. Send to CV server (Florence caption + OD, GDino detect, or GDino+SAM2)
 *      depending on the active ModelPreset.
 *   3. For each detection, compute a world-space ray from the *snapshotted*
 *      pose (not the current one — the CV round trip takes seconds and the
 *      user's head moves) using a pinhole camera model.
 *   4. Raycast synchronously against the scene-understanding geometry
 *      (SceneRaycaster). On a hit, the pin lands on the real surface; on a
 *      miss, it falls back to a fixed distance along the ray.
 *
 * Camera intrinsics: the passthrough RGB camera has its own FOV, distinct
 * from the render-eye projection. There is no browser API to query it, so the
 * horizontal FOV defaults to DEFAULT_CAMERA_HFOV_DEG and can be calibrated
 * per device via the `?hfov=<degrees>` URL parameter. The vertical FOV is
 * derived from the video aspect ratio via the pinhole model.
 */

import * as THREE from 'three';
import { CameraSource, CameraFacing } from '@iwsdk/core';
import { SpatialPin, PinSource } from '../spatial/SpatialPin.js';
import { encodeVideoFrame } from '../cv/CaptureEncoder.js';
import { ModelPreset, appState } from '../app/AppState.js';
import { SceneRaycaster } from './SceneRaycaster.js';

/** Approximate Quest 3 passthrough-camera horizontal FOV; tune with ?hfov= */
const DEFAULT_CAMERA_HFOV_DEG = 80;
/** Pin distance along the ray when no scene geometry is hit (metres). */
const DEFAULT_FALLBACK_DISTANCE = 2.5;
/** Maximum scene-raycast distance (metres). */
const MAX_RAY_DISTANCE = 10;

let _captureSeq = 0;

export class PipelineB {
  /**
   * @param {import('@iwsdk/core').World} world
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
   * @param {import('../cv/CvServerClient.js').CvServerClient} cvClient
   */
  constructor(world, pinManager, cvClient) {
    this.world      = world;
    this.pinManager = pinManager;
    this.cvClient   = cvClient;

    /** @type {import('@iwsdk/core').Entity|null} Camera entity with CameraSource component */
    this._cameraEntity = null;

    this._raycaster = new SceneRaycaster();

    this._hfov = (_hfovOverrideDeg() ?? DEFAULT_CAMERA_HFOV_DEG) * Math.PI / 180;
    this._vfov = this._deriveVfov(16 / 9);

    /** Pose at the moment of the last frame capture (world space). */
    this._capturePos  = new THREE.Vector3();
    this._captureQuat = new THREE.Quaternion();
  }

  /** Horizontal FOV of the passthrough camera model (radians). */
  get hfov() { return this._hfov; }
  /** Vertical FOV of the passthrough camera model (radians). */
  get vfov() { return this._vfov; }

  /** Viewer pose snapshotted at the last capture. */
  get lastCapturePose() {
    return { position: this._capturePos.clone(), quaternion: this._captureQuat.clone() };
  }

  // ── Camera entity setup ───────────────────────────────────────────────────

  /**
   * Call once after World.create to create the CameraSource entity used by Pipeline B.
   * @returns {import('@iwsdk/core').Entity}
   */
  initCameraEntity() {
    const { world } = this;
    const anchor = new THREE.Object3D();
    anchor.name = 'pipeline-b-camera-anchor';
    world.scene.add(anchor);

    this._cameraEntity = world.createTransformEntity(anchor);
    this._cameraEntity.addComponent(CameraSource, {
      facing:    CameraFacing.Back,
      width:     1280,
      height:    720,
      frameRate: 30,
    });
    return this._cameraEntity;
  }

  // ── Main capture method ────────────────────────────────────────────────────

  /**
   * Capture one frame, run the CV server pipeline, and place pins by
   * raycasting against the scene geometry from the capture-time pose.
   *
   * @param {string} captureId
   * @param {Array<{object: THREE.Object3D, hitType: 'plane'|'mesh'}>} raycastTargets
   *        collected via collectRaycastTargets() from the caller's queries
   * @returns {Promise<{pins: SpatialPin[], rays: Array<{origin: THREE.Vector3, dir: THREE.Vector3}>, error?: string}>}
   */
  async capture(captureId, raycastTargets = []) {
    const videoEl = this._cameraEntity?.getValue(CameraSource, 'videoElement');
    if (!videoEl || videoEl.readyState < 2) {
      console.warn('[PipelineB] Camera not ready');
      return { pins: [], rays: [], error: 'Camera not ready' };
    }

    // Freeze the viewer pose at the same moment the frame is sampled —
    // by the time the CV server responds, the head will have moved.
    this.world.camera.getWorldPosition(this._capturePos);
    this.world.camera.getWorldQuaternion(this._captureQuat);
    this._vfov = this._deriveVfov(
      (videoEl.videoWidth || 1280) / (videoEl.videoHeight || 720),
    );

    const base64 = await encodeVideoFrame(videoEl, 0.7);
    const seq    = ++_captureSeq;

    let detections = [];
    try {
      detections = await this._runModels(base64, videoEl);
    } catch (err) {
      console.error('[PipelineB] CV server error:', err);
      return { pins: [], rays: [], error: String(err?.message ?? err) };
    }

    // ── Place pins via local scene raycast from the snapshotted pose ────────
    const pins = [];
    const rays = [];
    const fallbackDist =
      appState.previewDistance > 0 ? appState.previewDistance : DEFAULT_FALLBACK_DISTANCE;

    let frameIdx = 0;
    for (const det of detections) {
      const dir = this._detectionDirection(det.cx, det.cy);
      rays.push({ origin: this._capturePos.clone(), dir: dir.clone() });

      const pin = new SpatialPin();
      pin.source            = PinSource.CvServer;
      pin.label             = det.label ?? 'object';
      pin.confidence        = det.confidence ?? 0;
      pin.bboxCxCyWH        = det.bbox_cxcywh ?? null;
      pin.trackId           = `${seq}-${frameIdx}`;
      pin.captureId         = captureId;
      pin.captureSessionId  = appState.captureSessionId;
      pin.captureFrameIndex = frameIdx++;
      pin.florenceCaption   = det.florenceCaption ?? null;
      pin.maskRleJson       = det.maskRleJson     ?? null;

      const hit = this._raycaster.raycast(this._capturePos, dir, raycastTargets, MAX_RAY_DISTANCE);
      if (hit) {
        pin.worldPosition       = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
        pin.hitType             = hit.hitType;
        pin.placementConfidence = 0.95;
      } else {
        const p = this._capturePos.clone().addScaledVector(dir, fallbackDist);
        pin.worldPosition       = { x: p.x, y: p.y, z: p.z };
        pin.hitType             = 'fallback';
        pin.placementConfidence = 0.5;
      }
      // Orient the pin to face back along the capture ray.
      pin.worldRotation = {
        x: this._captureQuat.x, y: this._captureQuat.y,
        z: this._captureQuat.z, w: this._captureQuat.w,
      };

      this.pinManager.addOrUpdate(pin);
      pins.push(pin);
    }

    return { pins, rays };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Run the active model preset against an encoded frame.
   * @returns {Promise<Array<object>>} normalised detections
   */
  async _runModels(base64, videoEl) {
    if (appState.modelPreset === ModelPreset.Florence) {
      const [cap, od] = await Promise.all([
        this.cvClient.florence(base64, '<MORE_DETAILED_CAPTION>'),
        this.cvClient.florence(base64, '<OD>'),
      ]);
      const caption = cap.result?.['<MORE_DETAILED_CAPTION>'] ?? '';
      const odItems = od.result?.['<OD>'] ?? {};
      const labels  = odItems.labels ?? [];
      const bboxes  = odItems.bboxes ?? [];
      const vw = videoEl.videoWidth  || 1280;
      const vh = videoEl.videoHeight || 720;
      return labels.map((lbl, i) => {
        const b  = bboxes[i] ?? [0, 0, 1, 1];
        const cx = (b[0] + b[2]) / 2 / vw;
        const cy = (b[1] + b[3]) / 2 / vh;
        const bw = (b[2] - b[0]) / vw;
        const bh = (b[3] - b[1]) / vh;
        return { label: lbl, cx, cy, confidence: 0.9, bbox_cxcywh: [cx, cy, bw, bh], florenceCaption: caption };
      });
    }

    if (appState.modelPreset === ModelPreset.GDino) {
      const resp = await this.cvClient.detect(base64);
      return resp.detections ?? [];
    }

    if (appState.modelPreset === ModelPreset.SAM2) {
      const detectResp = await this.cvClient.detect(base64);
      const dets       = detectResp.detections ?? [];
      if (!dets.length) return [];
      const segResp = await this.cvClient.segment(base64, dets.map(d => d.bbox_cxcywh));
      return dets.map((d, i) => ({
        ...d,
        maskRleJson: segResp.segments?.[i]
          ? JSON.stringify(segResp.segments[i].rle)
          : null,
      }));
    }

    return [];
  }

  /**
   * World-space unit direction for a normalised image coordinate, using the
   * pinhole model from the capture-time pose. (cx, cy) ∈ [0,1], origin top-left.
   * @returns {THREE.Vector3}
   */
  _detectionDirection(cx, cy) {
    const x = (cx - 0.5) * 2 * Math.tan(this._hfov / 2);
    const y = -(cy - 0.5) * 2 * Math.tan(this._vfov / 2);
    return new THREE.Vector3(x, y, -1).normalize().applyQuaternion(this._captureQuat);
  }

  /** Pinhole-consistent vertical FOV for the given aspect ratio. */
  _deriveVfov(aspect) {
    return 2 * Math.atan(Math.tan(this._hfov / 2) / aspect);
  }
}

/** Optional per-device calibration via `?hfov=<degrees>`. */
function _hfovOverrideDeg() {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('hfov');
    const deg = v ? Number(v) : NaN;
    return Number.isFinite(deg) && deg > 20 && deg < 160 ? deg : null;
  } catch {
    return null;
  }
}
