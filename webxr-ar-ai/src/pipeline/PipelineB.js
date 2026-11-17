/**
 * Pipeline B — Camera → CV → local raycast → SpatialPins.
 *
 * Flow (camera on only):
 *   1. Snapshot the viewer pose, then capture the current video frame from the
 *      CameraSource entity (async JPEG encode off the main thread).
 *   2. Send it to the active model: the local scan API (ModelPreset.Local, the
 *      default: keyframe + pose + intrinsics + planes to /v1/scans), or a legacy
 *      server model (Florence caption + OD, GDino detect, or GDino+SAM2).
 *   3. For each detection, compute a world-space ray from the *snapshotted*
 *      pose (not the current one — the CV round trip takes seconds and the
 *      user's head moves) using a pinhole camera model.
 *   4. Raycast synchronously against the scene-understanding geometry
 *      (SceneRaycaster). On a hit, the pin lands on the real surface; on a
 *      miss, it falls back to a fixed distance along the ray.
 *
 * Privacy: the camera is off until setCameraOn(true). Nothing is captured, encoded
 * or sent while it is off, and turning it off stops the stream and removes the
 * CameraSource component (IWSDK would otherwise restart it on re-entry).
 *
 * The CV server is optional. When it cannot be reached, capture still places
 * the scene pins (Pipeline A) and returns an `error` that describes the
 * failure, which the caller reports as a partial result.
 *
 * Camera intrinsics: the passthrough RGB camera has its own FOV, distinct
 * from the render-eye projection. There is no browser API to query it, so the
 * horizontal FOV comes from cameraCalibration.js: a `?hfov=<degrees>` URL
 * parameter, else the value saved on this device from the overlay, else the
 * default. It is re-read at every capture, so a saved change applies at once.
 * The vertical FOV is derived from the video aspect ratio via the pinhole model.
 */

import * as THREE from 'three';
import { CameraSource, CameraFacing, CameraSystem } from '@iwsdk/core';
import { SpatialPin, PinSource } from '../spatial/SpatialPin.js';
import { encodeVideoFrame } from '../cv/CaptureEncoder.js';
import { describeCvError } from '../cv/CvServerClient.js';
import { ModelPreset, appState } from '../app/AppState.js';
import { SceneRaycaster } from './SceneRaycaster.js';
import { resolveCameraHfov, getLocalStorage } from './cameraCalibration.js';
import { buildKeyframe, clientRecord } from '../scan/payload.js';
import { currentHierarchy } from '../scan/hierarchy.js';

/** Pin distance along the ray when no scene geometry is hit (metres). */
const DEFAULT_FALLBACK_DISTANCE = 2.5;
/** Maximum scene-raycast distance (metres). */
const MAX_RAY_DISTANCE = 10;
/** The passthrough camera stream the app asks for. */
const CAMERA_SOURCE_CONFIG = Object.freeze({
  facing:    CameraFacing.Back,
  width:     1280,
  height:    720,
  frameRate: 30,
});

let _captureSeq = 0;

export class PipelineB {
  /**
   * @param {import('@iwsdk/core').World} world
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
   * @param {import('../cv/CvServerClient.js').CvServerClient} cvClient
   * @param {import('../scan/LocalScanClient.js').LocalScanClient|null} [localScan]
   *        posts keyframes to the local scan API; required for ModelPreset.Local
   */
  constructor(world, pinManager, cvClient, localScan = null) {
    this.world      = world;
    this.pinManager = pinManager;
    this.cvClient   = cvClient;
    this.localScan  = localScan;

    /** @type {import('@iwsdk/core').Entity|null} Camera entity; CameraSource is added only when the camera is on */
    this._cameraEntity = null;
    this._cameraOn = false;

    this._raycaster = new SceneRaycaster();

    this._hfovDeg = null;
    this._hfov    = 0;
    this._refreshHfov();
    this._vfov = this._deriveVfov(16 / 9);

    /** Pose at the moment of the last frame capture (world space). */
    this._capturePos  = new THREE.Vector3();
    this._captureQuat = new THREE.Quaternion();

    /** @type {{scanId: string, keyframes: object[]}|null} the last local-scan result */
    this.lastScan = null;
  }

  /** Horizontal FOV of the passthrough camera model (radians). */
  get hfov() { return this._hfov; }
  /** Vertical FOV of the passthrough camera model (radians). */
  get vfov() { return this._vfov; }

  /** Whether the camera is on for this headset session. */
  get cameraOn() { return this._cameraOn; }

  /** Viewer pose snapshotted at the last capture. */
  get lastCapturePose() {
    return { position: this._capturePos.clone(), quaternion: this._captureQuat.clone() };
  }

  // ── Camera entity setup ───────────────────────────────────────────────────

  /**
   * Call once after World.create to create the entity the camera is attached to.
   * The camera itself stays off until setCameraOn(true).
   * @returns {import('@iwsdk/core').Entity}
   */
  initCameraEntity() {
    const { world } = this;
    const anchor = new THREE.Object3D();
    anchor.name = 'pipeline-b-camera-anchor';
    world.scene.add(anchor);

    this._cameraEntity = world.createTransformEntity(anchor);
    return this._cameraEntity;
  }

  /**
   * Turn the passthrough camera on or off for this session. Turning it on starts the
   * stream (the browser asks for permission then). Turning it off stops the stream and
   * removes the component, so it does not restart on the next frame or session.
   * @param {boolean} on
   * @returns {boolean} the state now in force
   */
  setCameraOn(on) {
    const want = Boolean(on);
    if (!this._cameraEntity) return false;
    if (want === this._cameraOn) return want;

    if (want) {
      this._cameraEntity.addComponent(CameraSource, { ...CAMERA_SOURCE_CONFIG });
    } else if (this._cameraEntity.hasComponent?.(CameraSource)) {
      this.world.getSystem?.(CameraSystem)?.stopCamera?.(this._cameraEntity);
      this._cameraEntity.removeComponent(CameraSource);
    }
    this._cameraOn = want;
    return want;
  }

  // ── Main capture method ────────────────────────────────────────────────────

  /**
   * Capture one frame, run the CV server pipeline, and place pins by
   * raycasting against the scene geometry from the capture-time pose.
   *
   * @param {string} captureId
   * @param {Array<{object: THREE.Object3D, hitType: 'plane'|'mesh'}>} raycastTargets
   *        collected via collectRaycastTargets() from the caller's queries
   * @param {{planes?: Array<object>}} [options]  contract Plane records for the local scan
   * @returns {Promise<{pins: SpatialPin[], rays: Array<{origin: THREE.Vector3, dir: THREE.Vector3}>, error?: string, skipped?: 'camera-off'}>}
   */
  async capture(captureId, raycastTargets = [], options = {}) {
    // Off means nothing is read, encoded or sent. The caller reports the scene pins alone.
    if (!this._cameraOn) {
      return { pins: [], rays: [], skipped: 'camera-off' };
    }

    const videoEl = this._cameraEntity?.getValue(CameraSource, 'videoElement');
    if (!videoEl || videoEl.readyState < 2) {
      console.warn('[PipelineB] Camera not ready');
      return { pins: [], rays: [], error: 'Camera not ready' };
    }

    // Freeze the viewer pose at the same moment the frame is sampled —
    // by the time the CV server responds, the head will have moved.
    this.snapshotPose();
    this._vfov = this._deriveVfov(
      (videoEl.videoWidth || 1280) / (videoEl.videoHeight || 720),
    );

    const base64 = await encodeVideoFrame(videoEl, 0.7);

    let detections = [];
    try {
      detections = await this._runModels(base64, videoEl, {
        captureId,
        planes: options.planes ?? [],
      });
    } catch (err) {
      console.warn('[PipelineB] CV server unavailable:', err);
      return { pins: [], rays: [], error: describeCvError(err) };
    }

    return this.placeDetections(captureId, detections, raycastTargets);
  }

  /** Record the current viewer pose as the capture pose, and re-read the camera FOV. */
  snapshotPose() {
    this._refreshHfov();
    this.world.camera.getWorldPosition(this._capturePos);
    this.world.camera.getWorldQuaternion(this._captureQuat);
  }

  /**
   * Project detections from the snapshotted pose onto the scene geometry and
   * create pins. Public so tests (and future detection sources) can exercise
   * the placement path without a camera or CV round trip.
   *
   * @param {string} captureId
   * @param {Array<object>} detections  normalised {label, cx, cy, confidence, …}
   * @param {Array<{object: THREE.Object3D, hitType: 'plane'|'mesh'}>} raycastTargets
   * @returns {{pins: SpatialPin[], rays: Array<{origin: THREE.Vector3, dir: THREE.Vector3}>}}
   */
  placeDetections(captureId, detections, raycastTargets = []) {
    const seq  = ++_captureSeq;
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
      let distance = fallbackDist;
      if (hit) {
        pin.worldPosition       = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
        pin.hitType             = hit.hitType;
        pin.placementConfidence = 0.95;
        distance = this._capturePos.distanceTo(hit.point);
      } else {
        const p = this._capturePos.clone().addScaledVector(dir, fallbackDist);
        pin.worldPosition       = { x: p.x, y: p.y, z: p.z };
        pin.hitType             = 'fallback';
        pin.placementConfidence = 0.5;
      }
      // The box at its real size where it lands: the frame's width and height in
      // metres at that distance, from the same pinhole model as the ray.
      if (Array.isArray(det.bbox_cxcywh) && det.bbox_cxcywh.length === 4) {
        const [, , bw, bh] = det.bbox_cxcywh;
        pin.boxSizeM = {
          w: 2 * distance * Math.tan(this._hfov / 2) * bw,
          h: 2 * distance * Math.tan(this._vfov / 2) * bh,
        };
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
   * Re-read the camera calibration: the `?hfov=` URL override, else the value
   * saved on this device, else the default.
   * @returns {number} horizontal FOV in radians
   */
  _refreshHfov() {
    const { deg } = resolveCameraHfov({
      search:  globalThis.location?.search ?? '',
      storage: getLocalStorage(),
    });
    if (deg !== this._hfovDeg) {
      this._hfovDeg = deg;
      this._hfov    = deg * Math.PI / 180;
    }
    return this._hfov;
  }

  /**
   * Run the active model preset against an encoded frame.
   * @param {string} base64
   * @param {HTMLVideoElement} videoEl
   * @param {{captureId: string, planes: Array<object>}} context
   * @returns {Promise<Array<object>>} normalised detections
   */
  async _runModels(base64, videoEl, context) {
    if (appState.modelPreset === ModelPreset.Local) {
      return this._runLocalScan(base64, videoEl, context);
    }

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

    // GDino and any future detector from the server registry: plain
    // detection, with the model id forwarded for server-side routing.
    const resp = await this.cvClient.detect(base64, { model: appState.modelPreset });
    return resp.detections ?? [];
  }

  /**
   * Send this capture's keyframe (frame, capture-time pose, intrinsics) and the room's
   * planes to the local scan API. The detections come back in the same shape as the
   * legacy ones, so placement is shared.
   * @returns {Promise<Array<object>>}
   */
  async _runLocalScan(base64, videoEl, { captureId, planes }) {
    if (!this.localScan) throw new Error('The local scan is not configured.');
    const width  = videoEl.videoWidth  || 1280;
    const height = videoEl.videoHeight || 720;
    const keyframe = buildKeyframe({
      clientKeyframeId: captureId,
      capturedAtMs: Date.now(),
      width,
      height,
      base64,
      position: this._capturePos,
      quaternion: this._captureQuat,
      hfovRad: this._hfov,
    });
    const result = await this.localScan.submit({
      hierarchy: currentHierarchy(),
      client: clientRecord({ sessionId: appState.captureSessionId }),
      planes,
      keyframe,
    });
    this.lastScan = { scanId: result.scanId, keyframes: result.keyframes };
    return result.detections;
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
