/**
 * Pipeline B — Camera → CV Server (Florence / GDino / SAM2) → Raycast → SpatialPins.
 *
 * Flow:
 *   1. Capture current video frame from the CameraSource entity.
 *   2. Send to CV server (Florence caption + OD, then GDino detect, then SAM2 segment)
 *      depending on the active ModelPreset.
 *   3. For each detection, create a temporary EnvironmentRaycastTarget entity
 *      oriented toward the detection direction (using HFOV/VFOV from the XR projection matrix).
 *   4. On the next frame when the entity has a hit-test result, promote it to a
 *      permanent SpatialPin and remove the temporary entity.
 *
 * If the hit-test misses (no XR hit), fall back to placing the pin at
 * previewDistance metres from the camera.
 */

import * as THREE from 'three';
import {
  EnvironmentRaycastTarget,
  RaycastSpace,
  CameraSource,
  CameraFacing,
} from '@iwsdk/core';
import { SpatialPin, PinSource } from '../spatial/SpatialPin.js';
import { videoToBase64Jpeg } from '../cv/CvServerClient.js';
import { ModelPreset, appState } from '../app/AppState.js';

// Default FOV when XR projection matrix is unavailable
const DEFAULT_HFOV = (100 * Math.PI) / 180;
const DEFAULT_VFOV = (85  * Math.PI) / 180;

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
    /** Pending raycast entities waiting for a hit-test result */
    this._pending = [];
    /** Calibrated FOV from XR projection matrix */
    this._hfov = DEFAULT_HFOV;
    this._vfov = DEFAULT_VFOV;
    this._fovCalibrated = false;
  }

  // ── Camera entity setup ───────────────────────────────────────────────────

  /**
   * Call once after World.create to create the CameraSource entity used by Pipeline B.
   * @returns {import('@iwsdk/core').Entity}
   */
  initCameraEntity() {
    const { world } = this;
    // Create a dummy Object3D to anchor the entity
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

  // ── FOV calibration from XR projection matrix ─────────────────────────────

  calibrateFOV() {
    if (this._fovCalibrated) return;
    try {
      const xrCam = this.world.renderer.xr.getCamera();
      const m     = xrCam.projectionMatrix.elements;
      if (m[0] && m[5]) {
        this._hfov = 2 * Math.atan(1 / Math.abs(m[0]));
        this._vfov = 2 * Math.atan(1 / Math.abs(m[5]));
        const h = ((this._hfov * 180) / Math.PI).toFixed(1);
        const v = ((this._vfov * 180) / Math.PI).toFixed(1);
        console.log(`[PipelineB] XR FOV detected: H=${h}° V=${v}°`);
        this._fovCalibrated = true;
      }
    } catch (_) {}
  }

  // ── Per-frame: resolve pending raycasts ───────────────────────────────────

  /**
   * Call every frame. Resolves any pending EnvironmentRaycastTarget entities
   * that now have a hit result, converts them to SpatialPins.
   */
  resolvePending() {
    const stillPending = [];
    for (const item of this._pending) {
      const { entity, pin, createdFrame } = item;
      const hitResult = entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult');

      if (hitResult) {
        // Hit — use the entity's world position (set by EnvironmentRaycastSystem)
        const obj = entity.object3D;
        if (obj) {
          pin.worldPosition = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
          pin.worldRotation = { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w };
          pin.hitType = 'plane';
          pin.placementConfidence = 0.95;
        }
        this.pinManager.addOrUpdate(pin);
        entity.destroy();
      } else if (Date.now() - createdFrame > 500) {
        // Timeout — fall back to previewDistance
        const d = appState.previewDistance;
        if (d > 0) {
          const dir = _directionFromAngles(item.angleH, item.angleV);
          const cam = this.world.camera;
          const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
          const worldDir = dir.clone().applyQuaternion(cam.quaternion);
          const pos = camPos.addScaledVector(worldDir, d);
          pin.worldPosition = { x: pos.x, y: pos.y, z: pos.z };
          pin.hitType       = 'fallback';
          pin.placementConfidence = 0.5;
          this.pinManager.addOrUpdate(pin);
        }
        entity.destroy();
      } else {
        stillPending.push(item);
      }
    }
    this._pending = stillPending;
  }

  // ── Main capture method ────────────────────────────────────────────────────

  /**
   * Capture one frame, run the CV server pipeline, and schedule raycasts.
   * @param {string} captureId
   * @returns {Promise<void>}
   */
  async capture(captureId) {
    this.calibrateFOV();

    // Get video element from CameraSource
    const videoEl = this._cameraEntity?.getValue(CameraSource, 'videoElement');
    if (!videoEl || videoEl.readyState < 2) {
      console.warn('[PipelineB] Camera not ready');
      return;
    }

    const base64 = videoToBase64Jpeg(videoEl, 0.7);
    const seq    = ++_captureSeq;

    let detections = [];

    try {
      // ── Florence ──────────────────────────────────────────────────────
      if (appState.modelPreset === ModelPreset.Florence ||
          appState.modelPreset === ModelPreset.GDino    ||
          appState.modelPreset === ModelPreset.SAM2) {

        if (appState.modelPreset === ModelPreset.Florence) {
          const [cap, od] = await Promise.all([
            this.cvClient.florence(base64, '<MORE_DETAILED_CAPTION>'),
            this.cvClient.florence(base64, '<OD>'),
          ]);
          const caption = cap.result?.['<MORE_DETAILED_CAPTION>'] ?? '';
          const odItems = od.result?.['<OD>'] ?? {};
          // Florence OD returns {bboxes, labels} or similar — normalise
          const labels  = odItems.labels  ?? [];
          const bboxes  = odItems.bboxes  ?? [];
          detections = labels.map((lbl, i) => {
            const b = bboxes[i] ?? [0, 0, 1, 1];
            const cx = (b[0] + b[2]) / 2 / (videoEl.videoWidth  || 1280);
            const cy = (b[1] + b[3]) / 2 / (videoEl.videoHeight || 720);
            const bw = (b[2] - b[0]) / (videoEl.videoWidth  || 1280);
            const bh = (b[3] - b[1]) / (videoEl.videoHeight || 720);
            return { label: lbl, cx, cy, confidence: 0.9, bbox_cxcywh: [cx, cy, bw, bh], florenceCaption: caption };
          });
        }

        // ── GDino detect ────────────────────────────────────────────────
        if (appState.modelPreset === ModelPreset.GDino) {
          const resp = await this.cvClient.detect(base64);
          detections = resp.detections ?? [];
        }

        // ── SAM2 segment ────────────────────────────────────────────────
        if (appState.modelPreset === ModelPreset.SAM2) {
          // First detect with GDino to get boxes, then segment
          const detectResp = await this.cvClient.detect(base64);
          const dets       = detectResp.detections ?? [];
          if (dets.length) {
            const segResp = await this.cvClient.segment(base64, dets.map(d => d.bbox_cxcywh));
            detections = dets.map((d, i) => ({
              ...d,
              maskRleJson: segResp.segments?.[i]
                ? JSON.stringify(segResp.segments[i].rle)
                : null,
            }));
          }
        }
      }
    } catch (err) {
      console.error('[PipelineB] CV server error:', err);
      return;
    }

    // ── Create EnvironmentRaycastTarget for each detection ─────────────────
    let frameIdx = 0;
    for (const det of detections) {
      const angleH = -(det.cx - 0.5) * this._hfov;
      const angleV = -(det.cy - 0.5) * this._vfov;

      const offsetQuat = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(angleV, angleH, 0, 'YXZ'));

      // Dummy mesh for the entity
      const marker = new THREE.Object3D();
      marker.name  = `raycast-target-${seq}-${frameIdx}`;
      this.world.scene.add(marker);

      const entity = this.world.createTransformEntity(marker);
      entity.addComponent(EnvironmentRaycastTarget, {
        space:            RaycastSpace.Viewer,
        maxDistance:      appState.previewDistance > 0 ? appState.previewDistance : 3,
        offsetQuaternion: offsetQuat,
      });

      const pin = new SpatialPin();
      pin.source           = PinSource.CvServer;
      pin.label            = det.label ?? 'object';
      pin.confidence       = det.confidence ?? 0;
      pin.bboxCxCyWH       = det.bbox_cxcywh ?? null;
      pin.trackId          = `${seq}-${frameIdx}`;
      pin.captureId        = captureId;
      pin.captureSessionId = appState.captureSessionId;
      pin.captureFrameIndex = frameIdx++;
      pin.florenceCaption  = det.florenceCaption ?? null;
      pin.maskRleJson      = det.maskRleJson     ?? null;
      // worldPosition will be set when hit resolves

      this._pending.push({ entity, pin, createdFrame: Date.now(), angleH, angleV });
    }
  }
}

// ── Helper ────────────────────────────────────────────────────────────────

function _directionFromAngles(angleH, angleV) {
  return new THREE.Vector3(
    Math.sin(angleH) * Math.cos(angleV),
    Math.sin(angleV),
    -Math.cos(angleH) * Math.cos(angleV),
  ).normalize();
}
