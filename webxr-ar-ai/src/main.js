/**
 * Companion Scan — main entry point.
 *
 * Creates the IWSDK World in immersive-AR mode and registers all systems.
 *
 * Systems:
 *   (auto) SceneUnderstandingSystem  — registered by World.create via features.sceneUnderstanding
 *   (auto) EnvironmentRaycastSystem  — registered by World.create via features.environmentRaycast
 *   (auto) CameraSystem              — registered by World.create via features.camera
 *   ControllerInputSystem            — reads Quest controller buttons
 *   CompanionScanSystem              — main orchestration, pipelines, UI
 */

import {
  World,
  SessionMode,
  ReferenceSpaceType,
  XRPlane,
  XRMesh,
  createSystem,
  CameraSource,
  CameraFacing,
} from '@iwsdk/core';
import * as THREE from 'three';

import { appState }                  from './app/AppState.js';
import { SpatialPinManager }         from './spatial/SpatialPinManager.js';
import { CvServerClient }            from './cv/CvServerClient.js';
import { PipelineB }                 from './pipeline/PipelineB.js';
import { runPipelineA }              from './pipeline/PipelineA.js';
import { CameraViewfinder }          from './rendering/CameraViewfinder.js';
import { SpatialLabel3DRenderer }    from './rendering/SpatialLabel3DRenderer.js';
import { FrustumRenderer }           from './rendering/FrustumRenderer.js';
import { ControllerInputSystem }     from './input/ControllerInputSystem.js';
import { buildControllerMenu }       from './ui/ControllerMenuBuilder.js';
import { WristHUD }                  from './ui/WristHUD.js';
import { GltfSyncClient }            from './export/GltfSyncClient.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────

const container = /** @type {HTMLDivElement} */ (document.getElementById('scene-container'));

const world = await World.create(container, {
  xr: {
    sessionMode:    SessionMode.ImmersiveAR,
    referenceSpace: ReferenceSpaceType.LocalFloor,
    features: {
      planeDetection: true,
      meshDetection:  true,
    },
    offer: 'always',
  },
  features: {
    sceneUnderstanding: true,      // auto-registers SceneUnderstandingSystem + XRPlane/XRMesh
    environmentRaycast: true,      // auto-registers EnvironmentRaycastSystem + EnvironmentRaycastTarget
    camera:             true,      // auto-registers CameraSystem + CameraSource
    spatialUI:          true,
    locomotion:         false,
    grabbing:           false,
  },
});

// ── Shared services ────────────────────────────────────────────────────────

const pinManager   = new SpatialPinManager({ mergeByTrackId: true });
const cvClient     = new CvServerClient({ baseUrl: '' }); // Vite proxies /v1 → localhost:8000

// ── CompanionScanSystem ────────────────────────────────────────────────────
//
// Defines queries for XRPlane and XRMesh so Pipeline A can iterate them,
// and orchestrates the per-frame rendering + capture logic.

let _captureSeq = 0;

class CompanionScanSystem extends createSystem({
  planeEntities: { required: [XRPlane] },
  meshEntities:  { required: [XRMesh]  },
}) {
  init() {
    this._capturing = false;

    // ── Services ─────────────────────────────────────────────────────────
    this._pipelineB     = new PipelineB(this.world, pinManager, cvClient);
    this._cameraEntity  = this._pipelineB.initCameraEntity();
    this._viewfinder    = new CameraViewfinder(this.world);
    this._labelRenderer = new SpatialLabel3DRenderer(this.world, pinManager);
    this._frustum       = new FrustumRenderer(this.world);
    this._wristHUD      = new WristHUD(this.world);
    this._gltfSync      = new GltfSyncClient(cvClient);

    // Initialise viewfinder (async, fire-and-forget)
    this._viewfinder.init(this._cameraEntity).catch(err =>
      console.error('[CompanionScan] Viewfinder init failed:', err),
    );

    // Keep label renderer in sync with display mode
    this._labelRenderer.setDisplayMode(appState.displayMode);
    appState.subscribe((field) => {
      if (field === 'displayMode') this._labelRenderer.setDisplayMode(appState.displayMode);
    });

    // Wire controller actions + build HUD on session start
    this.renderer.xr.addEventListener('sessionstart', () => {
      // Slight delay so input manager has time to register gamepads
      setTimeout(() => {
        const inputSys = this.world.getSystem(ControllerInputSystem);
        if (inputSys) {
          inputSys.setHandlers({
            capture: () => this._doCapture(),
            export:  () => this._doExport(),
          });
        }
        buildControllerMenu(this.world);
        this._wristHUD.init();
      }, 300);
    });
  }

  update(_delta, _time) {
    this._pipelineB.resolvePending();
    this._viewfinder.update();
    this._labelRenderer.update();
    this._frustum.update();
    this._wristHUD.update();
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  async _doCapture() {
    if (this._capturing || appState.isBusy) return;
    this._capturing = true;
    appState.setBusy(true);

    const captureId = `cap-${++_captureSeq}`;

    try {
      // Pipeline A — XR Scene Understanding planes + meshes
      runPipelineA(
        this.queries.planeEntities.entities,
        this.queries.meshEntities.entities,
        pinManager,
        captureId,
        appState.captureSessionId,
      );

      // Pipeline B — camera → CV server → EnvironmentRaycast
      await this._pipelineB.capture(captureId);

      // Frustum visualisation
      if (appState.previewDistance > 0) {
        const rayDirs = pinManager
          .bySource('CvServer')
          .filter(p => p.captureId === captureId && p.bboxCxCyWH)
          .map(p => ({ cx: p.bboxCxCyWH[0], cy: p.bboxCxCyWH[1] }));
        if (rayDirs.length) {
          this._frustum.draw(rayDirs, this._pipelineB._hfov, this._pipelineB._vfov, appState.previewDistance);
        }
      }

      // 2D overlay
      const overlayPins = pinManager
        .bySource('CvServer')
        .filter(p => p.captureId === captureId);
      this._viewfinder.setOverlayData(overlayPins);

    } catch (err) {
      console.error('[CompanionScan] Capture failed:', err);
    } finally {
      appState.setBusy(false);
      this._capturing = false;
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async _doExport() {
    if (appState.isBusy) return;
    appState.setBusy(true);
    try {
      await this._gltfSync.sync(this.world.scene, pinManager);
    } catch (err) {
      console.error('[CompanionScan] Export failed:', err);
    } finally {
      appState.setBusy(false);
    }
  }
}

// ── Register custom systems ────────────────────────────────────────────────

world
  .registerSystem(ControllerInputSystem)
  .registerSystem(CompanionScanSystem);
