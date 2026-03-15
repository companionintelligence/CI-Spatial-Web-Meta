# Quest Capture + glTF Export — Component Wiring

This document describes how the browser AR app components connect together.

## World Initialization (`src/main.js`)

```
World.create(container, {
  xr: { sessionMode: ImmersiveAR, features: { planeDetection, meshDetection } },
  features: { sceneUnderstanding, environmentRaycast, camera, spatialUI }
})
```

## Systems Registered

| System | Package | Purpose |
|--------|---------|---------|
| `SceneUnderstandingSystem` | `@iwsdk/core` | Manages XRPlane / XRMesh entities from WebXR |
| `ControllerInputSystem` | app | Reads `StatefulGamepad` buttons, fires capture/export actions |
| `CompanionScanSystem` | app | Per-frame orchestration; inits viewfinder + HUD on session start |

## Pipeline A — Scene Understanding

```
SceneUnderstandingSystem creates entities with XRPlane / XRMesh components
  └─ PipelineA.runPipelineA(world, pinManager, captureId)
       ├─ world.queryEntities({ required: [XRPlane] }) → pin.source = MetaScene
       │    └─ plane.orientation, plane.polygon → planeExtents
       └─ world.queryEntities({ required: [XRMesh] }) → pin.source = MetaScene
            └─ mesh.semanticLabel, mesh.vertices
```

## Pipeline B — CV Server

```
CameraSource entity (CameraFacing.Back, 1280×720, 30fps)
  └─ videoElement → videoToBase64Jpeg()
       └─ CvServerClient
            ├─ Florence preset:  /v1/florence (<MORE_DETAILED_CAPTION> + <OD>)
            ├─ GDino preset:     /v1/detect
            └─ SAM2 preset:      /v1/detect → /v1/segment
                 └─ For each detection:
                      EnvironmentRaycastTarget(space=Viewer, offsetQuaternion)
                        └─ next frame: xrHitTestResult → pin.worldPosition
                             OR timeout → fallback to previewDistance metres
```

## Rendering

```
CameraViewfinder
  ├─ PlaneGeometry 24cm × auto-height, attached to world.camera at z=-0.4
  ├─ VideoTexture from CameraSource.texture
  └─ CanvasTexture overlay for 2D bboxes (updated via setOverlayData)

SpatialLabel3DRenderer
  ├─ Listens to SpatialPinManager add/update/remove/clear events
  ├─ Creates disc + billboarded label group per pin
  ├─ Groups attached to world.scene at pin.worldPosition
  └─ Labels look-at camera each frame

FrustumRenderer
  └─ Draws LineSegments for detection rays on each capture (fade 1.5s)
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

WristHUD
  └─ world.input.xrOrigin.gripSpaces.left
       └─ PlaneGeometry 14cm × 8cm at position (0, 0.04, -0.02)
            └─ CanvasTexture: Model / Display / Preview / BUSY
```

## Export

```
GltfSyncClient.sync(scene, pinManager)
  ├─ GltfExporter.exportGltf(scene, pinManager)
  │    ├─ scene.userData.gltfExtras = { companion_scan: { pins, floorplan, session_id } }
  │    └─ GLTFExporter.parse(scene, ..., { binary: true }) → ArrayBuffer (GLB)
  └─ CvServerClient.uploadGltf(glb, filename) → POST /v1/gltf
```

## glTF Extras Structure

```json
{
  "extras": {
    "companion_scan": {
      "version": "1.0",
      "session_id": "<uuid>",
      "exported_at": "2024-...",
      "floorplan": {
        "bounds": { "min": {...}, "max": {...} },
        "cv_pin_count": 12,
        "scene_pin_count": 8
      },
      "pins": [
        {
          "id": "pin-1-...",
          "source": "CvServer",
          "label": "chair",
          "position": { "x": 1.2, "y": 0.5, "z": -2.1 },
          "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
          "confidence": 0.87,
          "bbox_cxcywh": [0.45, 0.62, 0.12, 0.18],
          "hit_type": "plane",
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
