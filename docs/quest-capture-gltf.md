# Quest Capture + glTF Export — Component Wiring

This document describes how the browser AR app components connect together.

## World Initialization (`src/main.js`)

```
World.create(container, {
  xr: {
    sessionMode: ImmersiveAR,
    features: { planeDetection, meshDetection, anchors }
  },
  features: { sceneUnderstanding, camera, spatialUI }
})
```

The `anchors` feature backs the persistent scan root (below). The previous
`environmentRaycast` feature is no longer used — detection placement runs
through a local raycaster instead of XR hit-test sources.

## Systems Registered

| System | Package | Purpose |
|--------|---------|---------|
| `SceneUnderstandingSystem` | `@iwsdk/core` | Manages XRPlane / XRMesh entities from WebXR; owns the persistent XRAnchor |
| `CameraSystem` | `@iwsdk/core` | Starts/stops the passthrough camera stream with XR visibility |
| `ControllerInputSystem` | app | Reads `StatefulGamepad` buttons, fires capture/export actions |
| `CompanionScanSystem` | app | Per-frame orchestration; session lifecycle; capture + export |

## Persistent scan root (`src/spatial/ScanAnchorRoot.js`)

```
ScanAnchorRoot
  ├─ group (entity with XRAnchor component)
  │    └─ SceneUnderstandingSystem attaches it to its world-anchored group;
  │       the anchor UUID persists in localStorage across sessions
  ├─ labelsRoot   — SpatialLabel3DRenderer groups (visual only)
  └─ geometryRoot — SceneGeometrySnapshot meshes (export payload)
```

Pin positions are recorded in session world space and converted to
anchor-local space at export time (`worldToAnchorLocal`).

## Pipeline A — Scene Understanding

```
SceneUnderstandingSystem creates entities with XRPlane / XRMesh components
  └─ runPipelineA(planeEntities, meshEntities, pinManager, captureId, sessionId)
       ├─ XRPlane → pin (label = semanticLabel ?? orientation, planeExtents)
       ├─ XRMesh  → pin (label = semanticLabel, volumeExtents from vertices)
       └─ trackId: WeakMap keyed on the NATIVE plane/mesh object —
          re-captures update pins in place; same-label surfaces stay distinct
```

At capture time `SceneGeometrySnapshot` also clones each plane/mesh entity's
geometry into `geometryRoot` (transforms re-expressed anchor-locally), so the
real room geometry survives `sessionend` and lands in the GLB.

## Pipeline B — CV Server

```
CameraSource entity (CameraFacing.Back, 1280×720, 30fps)
  └─ capture(captureId, raycastTargets):
       1. snapshot camera pose             ← BEFORE any async work
       2. encodeVideoFrame()               ← createImageBitmap + OffscreenCanvas
       3. model preset:
            Florence: /v1/florence (<MORE_DETAILED_CAPTION> + <OD>)
            GDino:    /v1/detect
            SAM2:     /v1/detect → /v1/segment
       4. per detection: pinhole ray from the snapshot pose
            x = (cx − 0.5)·2·tan(hfov/2),  y = −(cy − 0.5)·2·tan(vfov/2)
            hfov: 80° default, ?hfov=<deg> URL override
            vfov: derived from the video aspect ratio
       5. SceneRaycaster.raycast(origin, dir, targets)
            hit  → pin at hit.point, hitType = 'plane'|'mesh', confidence 0.95
            miss → pin at previewDistance (or 2.5 m if Off), hitType 'fallback'
       └─ returns { pins, rays } — rays feed FrustumRenderer
```

`raycastTargets` are the plane/mesh entity `object3D`s collected from the
CompanionScanSystem queries (`collectRaycastTargets`). Detections are never
dropped: a miss produces a fallback pin regardless of the preview setting.

## Rendering

```
CameraViewfinder
  ├─ PlaneGeometry 24cm × auto-height, attached to world.camera at z=-0.4
  ├─ Re-binds the video texture every frame (camera restarts across sessions)
  ├─ requestVideoFrameCallback throttles uploads to video rate (30 Hz)
  └─ CanvasTexture overlay for 2D bboxes (updated via setOverlayData)

SpatialLabel3DRenderer
  ├─ Listens to SpatialPinManager add/update/remove/clear events
  ├─ Shared disc geometry + per-colour materials; label textures skip mipmaps
  ├─ Groups parented under scanRoot.labelsRoot (anchor-relative)
  ├─ Labels look-at camera each frame
  └─ rebuildAll() reconstructs everything from the pin store
     (used after WebGL context restore)

FrustumRenderer
  └─ One batched LineSegments per capture (single draw call), fades over 1.5 s
```

## Session lifecycle (`CompanionScanSystem`)

```
sessionstart → setFoveation(1.0), updateTargetFrameRate(90)
             → after 2 s grace: if no planes/meshes, session.initiateRoomCapture()
update       → retry WristHUD.init() / buildControllerMenu() until grip spaces exist
sessionend   → viewfinder.unbind(); HUD/menu flags reset
               (CameraSystem stops the camera stream itself)
contextlost / contextrestored → labels rebuilt from the pin store
```

## Input

```
ControllerInputSystem.update()
  ├─ world.input.gamepads.right
  │    ├─ A_Button down → _doCapture()
  │    └─ B_Button down → appState.cycleModel()
  ├─ world.input.gamepads.left
  │    ├─ X_Button down → appState.cyclePreviewDistance()
  │    └─ Y_Button down → _doExport()
  └─ Either Trigger down → appState.cycleDisplayMode()
```

## UI

```
ControllerMenuBuilder
  └─ world.input.xrOrigin.gripSpaces.{left,right}
       └─ Adds coloured disc + canvas label meshes for each button
          (idempotent — retried each frame until both grips exist)

WristHUD
  └─ world.input.xrOrigin.gripSpaces.left
       └─ PlaneGeometry 14cm × 8cm at position (0, 0.04, -0.02)
            └─ CanvasTexture: Model / Display / Preview / BUSY
```

## Export

```
Left Y / overlay buttons
  ├─ downloadGlb(scanRoot, pinManager)            ← always; headset Downloads folder
  └─ GltfSyncClient.sync(scanRoot, pinManager)    ← upload; failure leaves a warn status

exportGltf(scanRoot.geometryRoot, pinManager, { anchorUuid, worldToAnchorLocal })
  ├─ geometryRoot.userData.companion_scan = {...}  → GLB `extras.companion_scan`
  └─ GLTFExporter.parse(..., { binary: true, onlyVisible: false }) → GLB
     (geometry snapshots are invisible at runtime but ARE the payload;
      labels / viewfinder / HUD are never exported)
```

Exports can be inspected on a desktop browser at `/viewer.html` (drag & drop
the GLB): wireframe room geometry, pin markers, floorplan bounds, metadata.

## glTF Extras Structure

```json
{
  "extras": {
    "companion_scan": {
      "version": "1.1",
      "session_id": "<uuid>",
      "exported_at": "2026-...",
      "anchor_uuid": "<persistent XRAnchor uuid or null>",
      "floorplan": {
        "bounds": { "min": {}, "max": {} },
        "cv_pin_count": 12,
        "scene_pin_count": 8
      },
      "pins": [
        {
          "id": "pin-1-...",
          "source": "CvServer",
          "label": "chair",
          "position": { "x": 1.2, "y": 0.5, "z": -2.1 },
          "position_anchor_local": { "x": 1.1, "y": 0.5, "z": -2.0 },
          "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
          "confidence": 0.87,
          "bbox_cxcywh": [0.45, 0.62, 0.12, 0.18],
          "hit_type": "mesh",
          "placement_confidence": 0.95,
          "track_id": "1-0",
          "capture_id": "cap-1",
          "capture_session_id": "<uuid>",
          "capture_frame_index": 0,
          "semantic_labels": null,
          "plane_extents": null,
          "volume_extents": null,
          "mask_rle": null,
          "florence_caption": null,
          "created_at": 1718000000000
        }
      ]
    }
  }
}
```

Notes:

- `position` is session world space (`local-floor`) — only valid within the
  session that produced it.
- `position_anchor_local` is relative to the persistent anchor and is the
  frame to use for re-localization on the same device.
- Floorplan bounds exclude `hit_type: "fallback"` pins (distance guesses).
