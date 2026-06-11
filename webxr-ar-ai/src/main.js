/**
 * Companion Scan — main entry point.
 *
 * Creates the IWSDK World in immersive-AR mode and registers all systems.
 *
 * Systems:
 *   (auto) SceneUnderstandingSystem  — registered by World.create via features.sceneUnderstanding
 *                                      (also owns the persistent XRAnchor that
 *                                      the scan root re-localizes against)
 *   (auto) CameraSystem              — registered by World.create via features.camera
 *   ControllerInputSystem            — reads Quest controller buttons
 *   CompanionScanSystem              — main orchestration, pipelines, UI
 */

import {
  World,
  SessionMode,
  ReferenceSpaceType,
  VisibilityState,
  XRPlane,
  XRMesh,
  createSystem,
} from '@iwsdk/core';

import { appState }                  from './app/AppState.js';
import { SpatialPin }                from './spatial/SpatialPin.js';
import { SpatialPinManager }         from './spatial/SpatialPinManager.js';
import { ScanAnchorRoot }            from './spatial/ScanAnchorRoot.js';
import { ScanStorage }               from './spatial/ScanStorage.js';
import { CvServerClient }            from './cv/CvServerClient.js';
import { PipelineB }                 from './pipeline/PipelineB.js';
import { runPipelineA }              from './pipeline/PipelineA.js';
import { collectRaycastTargets }     from './pipeline/SceneRaycaster.js';
import { CameraViewfinder }          from './rendering/CameraViewfinder.js';
import { SpatialLabel3DRenderer }    from './rendering/SpatialLabel3DRenderer.js';
import { FrustumRenderer }           from './rendering/FrustumRenderer.js';
import { ControllerInputSystem }     from './input/ControllerInputSystem.js';
import { buildControllerMenu }       from './ui/ControllerMenuBuilder.js';
import { WristHUD }                  from './ui/WristHUD.js';
import { DesktopOverlay }            from './ui/DesktopOverlay.js';
import { SceneGeometrySnapshot }     from './export/SceneGeometrySnapshot.js';
import { GltfSyncClient }            from './export/GltfSyncClient.js';
import { downloadGlb }               from './export/GltfDownload.js';

// Target refresh rate for the immersive session (Hz).
const TARGET_FRAME_RATE = 90;
// How long to wait after session start before prompting native Space Setup
// when no scene data exists (ms).
const ROOM_CAPTURE_GRACE_MS = 2000;

// ── Bootstrap ──────────────────────────────────────────────────────────────

const container = /** @type {HTMLDivElement} */ (document.getElementById('scene-container'));

const world = await World.create(container, {
  xr: {
    sessionMode:    SessionMode.ImmersiveAR,
    referenceSpace: ReferenceSpaceType.LocalFloor,
    features: {
      planeDetection: true,
      meshDetection:  true,
      anchors:        true,   // persistent anchor — scans re-localize across sessions
    },
    offer: 'always',
  },
  features: {
    sceneUnderstanding: true,      // auto-registers SceneUnderstandingSystem + XRPlane/XRMesh
    camera:             true,      // auto-registers CameraSystem + CameraSource
    spatialUI:          true,
    locomotion:         false,
    grabbing:           false,
  },
});

// ── Shared services ────────────────────────────────────────────────────────

const pinManager  = new SpatialPinManager({ mergeByTrackId: true });
const cvClient    = new CvServerClient({ baseUrl: import.meta.env.VITE_CV_BASE_URL ?? '' });
const scanRoot    = new ScanAnchorRoot(world);
const scanStorage = new ScanStorage();

// Filled in by CompanionScanSystem.init (the system owns the snapshot store).
const scanHooks = { clearGeometry: null };

function clearScan() {
  pinManager.clearAll();
  scanHooks.clearGeometry?.();
  scanStorage.clear();
  appState.setStatus('Scan cleared', 'info');
}

// Desktop / pre-AR status panel (auto-hides while presenting)
const desktopOverlay = new DesktopOverlay({
  pinManager,
  cvClient,
  onDownload: () => downloadGlb(scanRoot, pinManager),
  onClear:    clearScan,
});
desktopOverlay.init(world);

// Adopt the CV server's model registry when reachable (silent fallback to
// the static Florence/GDino/SAM2 cycle otherwise).
cvClient.models()
  .then(r => appState.setModels(r.models?.map(m => m.id)))
  .catch(() => {});

// Debug / test hook (used by Playwright and chrome://inspect on-device)
window.__companionScan = { pinManager, appState, scanRoot, scanStorage, clearScan, SpatialPin };

// ── CompanionScanSystem ────────────────────────────────────────────────────
//
// Defines queries for XRPlane and XRMesh so Pipeline A and the local
// raycaster can iterate them, and orchestrates per-frame rendering + capture.

let _captureSeq = 0;

class CompanionScanSystem extends createSystem({
  planeEntities: { required: [XRPlane] },
  meshEntities:  { required: [XRMesh]  },
}) {
  init() {
    this._capturing = false;
    this._hudReady  = false;
    this._menuReady = false;
    this._sessionStartedAt   = 0;
    this._roomCaptureChecked = false;

    // ── Services ─────────────────────────────────────────────────────────
    this._pipelineB     = new PipelineB(this.world, pinManager, cvClient);
    this._cameraEntity  = this._pipelineB.initCameraEntity();
    this._viewfinder    = new CameraViewfinder(this.world);
    this._labelRenderer = new SpatialLabel3DRenderer(this.world, pinManager, scanRoot);
    this._frustum       = new FrustumRenderer(this.world);
    this._wristHUD      = new WristHUD(this.world, pinManager);
    this._geomSnapshot  = new SceneGeometrySnapshot(scanRoot);
    this._gltfSync      = new GltfSyncClient(cvClient);
    scanHooks.clearGeometry = () => this._geomSnapshot.clear();

    this._viewfinder.init(this._cameraEntity);

    // Restore a previous scan (after the label renderer subscribes, so the
    // restored pins get their 3D labels rebuilt).
    const restored = scanStorage.restore(pinManager);
    if (restored) appState.setStatus(`Restored ${restored} pins`, 'info');

    // Keep label renderer in sync with display mode
    this._labelRenderer.setDisplayMode(appState.displayMode);
    appState.subscribe((field) => {
      if (field === 'displayMode') this._labelRenderer.setDisplayMode(appState.displayMode);
    });

    // Wire controller actions (ControllerInputSystem is registered first)
    const inputSys = this.world.getSystem(ControllerInputSystem);
    if (inputSys) {
      inputSys.setHandlers({
        capture: () => this._doCapture(),
        export:  () => this._doExport(),
      });
    }

    // ── Session lifecycle ─────────────────────────────────────────────────
    this.renderer.xr.addEventListener('sessionstart', () => {
      this._sessionStartedAt   = Date.now();
      this._roomCaptureChecked = false;
      this._applyQuestSessionSettings();
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      // CameraSystem stops the camera itself (visibilityState subscription);
      // release the viewfinder's binding to the now-dead video element.
      this._viewfinder.unbind();
      this._hudReady  = false;
      this._menuReady = false;
      scanStorage.save(pinManager, scanRoot);
    });

    // ── WebGL context loss ────────────────────────────────────────────────
    // The pin store is the source of truth for visual state, so labels can be
    // rebuilt wholesale after a context restore.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[CompanionScan] WebGL context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[CompanionScan] WebGL context restored — rebuilding labels');
      this._labelRenderer.rebuildAll();
    });
  }

  update(_delta, _time) {
    // Grip spaces / gamepads appear asynchronously after session start —
    // retry attachment each frame until they exist.
    if (this.renderer.xr.isPresenting) {
      if (!this._hudReady)  this._hudReady  = this._wristHUD.init();
      if (!this._menuReady) this._menuReady = buildControllerMenu(this.world);
      this._maybeInitiateRoomCapture();
    }

    this._viewfinder.update();
    this._labelRenderer.update();
    this._frustum.update();
    this._wristHUD.update();
  }

  // ── Quest session tuning ──────────────────────────────────────────────────

  _applyQuestSessionSettings() {
    // Fixed foveated rendering — content is line/label heavy near screen
    // center, so peripheral resolution loss is essentially free.
    try { this.renderer.xr.setFoveation(1.0); } catch { /* not supported */ }

    const session = this.renderer.xr.getSession();
    if (session?.supportedFrameRates && session.updateTargetFrameRate) {
      const rates = session.supportedFrameRates;
      if (rates.includes(TARGET_FRAME_RATE)) {
        session.updateTargetFrameRate(TARGET_FRAME_RATE).catch(() => {});
      }
    }
  }

  /**
   * If the user has never run Space Setup there is no scene data and both
   * pipelines degrade (no Pipeline A pins, no raycast targets). After a grace
   * period with zero planes/meshes, launch the native capture flow.
   *
   * Note: room capture can invalidate existing spatial anchors, which is why
   * this only fires when there is no scene data (and therefore no scan yet).
   */
  _maybeInitiateRoomCapture() {
    if (this._roomCaptureChecked || !this._sessionStartedAt) return;
    if (Date.now() - this._sessionStartedAt < ROOM_CAPTURE_GRACE_MS) return;
    this._roomCaptureChecked = true;

    const hasScene =
      this.queries.planeEntities.entities.size > 0 ||
      this.queries.meshEntities.entities.size > 0;
    const session = this.renderer.xr.getSession();
    if (!hasScene && session?.initiateRoomCapture) {
      console.log('[CompanionScan] No scene data — launching Space Setup');
      session.initiateRoomCapture().catch(err =>
        console.warn('[CompanionScan] initiateRoomCapture failed:', err),
      );
    }
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  async _doCapture() {
    if (this._capturing || appState.isBusy) return;
    if (this.world.visibilityState.value !== VisibilityState.Visible) return;
    this._capturing = true;
    appState.setBusy(true);

    const captureId = `cap-${++_captureSeq}`;

    try {
      const planeEntities = this.queries.planeEntities.entities;
      const meshEntities  = this.queries.meshEntities.entities;

      // Snapshot scene geometry into the anchored export subtree
      this._geomSnapshot.snapshot(planeEntities, meshEntities);

      // Pipeline A — XR Scene Understanding planes + meshes
      runPipelineA(planeEntities, meshEntities, pinManager, captureId, appState.captureSessionId);

      // Pipeline B — camera → CV server → local raycast against scene geometry
      const targets = collectRaycastTargets(planeEntities, meshEntities);
      const { pins, rays, error } = await this._pipelineB.capture(captureId, targets);

      // Frustum visualisation (rays already originate from the capture pose)
      if (appState.previewDistance > 0 && rays.length) {
        this._frustum.draw(rays, appState.previewDistance);
      }

      // 2D overlay
      const overlayPins = pinManager
        .bySource('CvServer')
        .filter(p => p.captureId === captureId);
      this._viewfinder.setOverlayData(overlayPins);

      if (error) {
        appState.setStatus(error, 'error');
      } else {
        const scenePins = pinManager
          .bySource('MetaScene')
          .filter(p => p.captureId === captureId).length;
        appState.setStatus(`${pins.length} detections · ${scenePins} scene pins`, 'ok');
      }

    } catch (err) {
      console.error('[CompanionScan] Capture failed:', err);
      appState.setStatus(`Capture failed: ${err?.message ?? err}`, 'error');
    } finally {
      scanStorage.save(pinManager, scanRoot);
      appState.setBusy(false);
      this._capturing = false;
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async _doExport() {
    if (appState.isBusy) return;
    appState.setBusy(true);

    // Local download always works (Quest saves to the Downloads folder),
    // so a scan is never lost to an unreachable CV server.
    let filename = null;
    try {
      filename = await downloadGlb(scanRoot, pinManager);
    } catch (err) {
      console.error('[CompanionScan] Local export failed:', err);
    }

    try {
      const result = await this._gltfSync.sync(scanRoot, pinManager);
      appState.setStatus(`Exported ${result.path ?? filename ?? 'scan'}`, 'ok');
    } catch (err) {
      console.error('[CompanionScan] Upload failed:', err);
      appState.setStatus(
        filename ? `Saved ${filename} · upload failed` : `Export failed: ${err?.message ?? err}`,
        filename ? 'warn' : 'error',
      );
    } finally {
      appState.setBusy(false);
    }
  }
}

// ── Register custom systems ────────────────────────────────────────────────

world
  .registerSystem(ControllerInputSystem)
  .registerSystem(CompanionScanSystem);

// Debug hook completion: trigger a capture programmatically (Playwright /
// on-device console) exactly as the controller button would, and drive the
// detection-placement path directly with synthetic detections.
window.__companionScan.runCapture = () =>
  world.getSystem(CompanionScanSystem)?._doCapture();
window.__companionScan.placeDetections = (captureId, detections) => {
  const sys = world.getSystem(CompanionScanSystem);
  if (!sys) return { pins: [], rays: [] };
  const targets = collectRaycastTargets(
    sys.queries.planeEntities.entities,
    sys.queries.meshEntities.entities,
  );
  sys._pipelineB.snapshotPose();
  return sys._pipelineB.placeDetections(captureId, detections, targets);
};
