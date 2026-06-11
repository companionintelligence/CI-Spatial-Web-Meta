# Companion Scan

Quest 3 local world/space mapper — combines **WebXR Scene Understanding** with a **local CV server** (Grounding DINO, SAM 2, Florence-2) to produce a glTF export with rich spatial metadata, re-localizable across sessions via a **persistent WebXR anchor**.

## Architecture

```
Quest 3 Browser (webxr-ar-ai/)
  ├─ Pipeline A: WebXR Scene Understanding
  │    XRPlane / XRMesh → SpatialPin (MetaScene)
  │    (stable track IDs keyed on native plane/mesh identity)
  │
  ├─ Pipeline B: CV Server (network)
  │    1. snapshot viewer pose          ← frozen at frame-grab time
  │    2. CameraSource → async JPEG     ← OffscreenCanvas, off main thread
  │    3. Florence-2 / GroundingDINO / SAM2 (HTTP)
  │    4. pinhole ray per detection     ← passthrough-camera intrinsics
  │    5. SceneRaycaster                ← local raycast vs. scene geometry
  │    6. SpatialPin (CvServer)         ← hit point, or fallback distance
  │
  ├─ ScanAnchorRoot (persistent XRAnchor — scan content re-localizes)
  │    ├─ geometryRoot: SceneGeometrySnapshot (plane/mesh copies → export)
  │    └─ labelsRoot:   SpatialLabel3DRenderer (3D persistent labels)
  ├─ SpatialPinManager (unified pin store, O(1) track-id index)
  ├─ ControllerInputSystem (Quest controller buttons)
  ├─ CameraViewfinder (2D preview + BBox overlay, 30 Hz texture upload)
  ├─ WristHUD (left-wrist status panel)
  └─ GltfExporter + GltfSyncClient → POST /v1/gltf
       (exports geometryRoot only — anchor-relative, no UI meshes)

Local CV Server (cv-server/ — Docker)
  POST /v1/detect   — GroundingDINO
  POST /v1/segment  — SAM 2
  POST /v1/florence — Florence-2
  POST /v1/gltf     — Upload
  GET  /v1/health
```

### Key behaviours

- **Capture-time pose snapshot** — detection rays are cast from the head pose at the moment the camera frame was grabbed, not where the head is seconds later when the CV server responds.
- **Local scene raycast** — detections are projected onto the room geometry already captured by Scene Understanding (no per-detection XR hit-test sources, no async timeout). If nothing is hit, the pin is placed at a fallback distance along the ray — detections are never dropped.
- **Persistent anchor** — all scan content lives under a root group bound to a persistent `XRAnchor` (UUID in localStorage). Exports carry both session-world and anchor-local coordinates plus the anchor UUID.
- **Space Setup prompt** — if the session starts with no scene data, the app calls `session.initiateRoomCapture()` to launch the native Quest room-scan flow.
- **Quest tuning** — fixed foveation 1.0 and a 90 Hz target frame rate are applied on session start; canvas textures skip mipmaps; the viewfinder uploads video frames at camera rate (30 Hz) instead of render rate.

## Quick Start

### 1. Run the CV server

```bash
cd cv-server
# Download weights to cv-server/weights/ (see cv-server/README.md)
docker compose up --build
```

### 2. Run the web frontend

```bash
cd webxr-ar-ai
npm install
npm run dev
# Starts on https://0.0.0.0:8081
# If the CV server runs on another machine:
#   CV_SERVER_URL=http://<cv-host>:8000 npm run dev
```

### 3. Open on Quest 3

Navigate to `https://<PC-IP>:8081` in the Meta Quest browser and accept the certificate.
The app requests `immersive-ar` automatically (with `plane-detection`, `mesh-detection`, and `anchors`).

> The dev-server proxies `/v1/*` to the CV server so the headset never makes
> a mixed-content (HTTPS page → HTTP API) request.

**Optional camera calibration:** the passthrough camera's horizontal FOV defaults to 80° and can be tuned per device with a URL parameter, e.g. `https://<PC-IP>:8081/?hfov=75`. If pins land short of / past object edges consistently, adjust this value.

## Controller Button Map

| Button | Colour | Action |
|--------|--------|--------|
| Right **A** | 🔴 Red | **Capture** — run both pipelines, place 3D labels |
| Right **B** | 🔵 Blue | **Cycle Model** — Florence → GDino → SAM2 |
| Left **X** | 🟡 Yellow | **Preview Distance** — Near 1m → Far 3m → Off |
| Left **Y** | 🟢 Green | **Save & Export** — glTF upload to CV server |
| **Trigger** | 🟠 Orange | **Display Mode** — BBox2D → Label3D → Both |

## Wrist HUD (left controller)

```
Model:   Florence
Display: Both
Preview: Near (1m)
BUSY…       ← during capture
```

## Project Structure

```
webxr-ar-ai/
├── index.html
├── vite.config.js
├── package.json
├── src/
│   ├── main.js                       # Entry: World.create + system wiring + session lifecycle
│   ├── app/
│   │   └── AppState.js               # Reactive singleton state
│   ├── spatial/
│   │   ├── SpatialPin.js             # Pin data class
│   │   ├── SpatialPinManager.js      # Unified pin store (EventTarget)
│   │   └── ScanAnchorRoot.js         # Persistent-anchor root for scan content
│   ├── pipeline/
│   │   ├── PipelineA.js              # WebXR planes/meshes → pins (stable track IDs)
│   │   ├── PipelineB.js              # Camera → CV server → local raycast → pins
│   │   └── SceneRaycaster.js         # Synchronous raycast vs. scene geometry
│   ├── cv/
│   │   ├── CvServerClient.js         # REST client for /v1/*
│   │   └── CaptureEncoder.js         # Async off-main-thread JPEG encoding
│   ├── rendering/
│   │   ├── CameraViewfinder.js       # Camera preview + 2D bbox overlay
│   │   ├── SpatialLabel3DRenderer.js # 3D persistent label groups (shared geo/mats)
│   │   └── FrustumRenderer.js        # Capture-ray visualisation (batched)
│   ├── input/
│   │   └── ControllerInputSystem.js  # IWSDK ECS system for buttons
│   ├── ui/
│   │   ├── ControllerMenuBuilder.js  # Coloured disc indicators on controllers
│   │   └── WristHUD.js               # Left-wrist canvas panel
│   └── export/
│       ├── SceneGeometrySnapshot.js  # Plane/mesh geometry copies for export
│       ├── GltfExporter.js           # GLTFExporter + spatial metadata extras
│       └── GltfSyncClient.js         # Upload GLB to /v1/gltf

cv-server/
├── Dockerfile
├── docker-compose.yml
├── main.py                           # FastAPI with /v1/* endpoints
├── requirements.txt
└── README.md
```

## Export format

The GLB contains the snapshotted room geometry (anchor-relative transforms) and a `companion_scan` extras block:

```jsonc
{
  "companion_scan": {
    "version": "1.1",
    "session_id": "…",
    "exported_at": "2026-06-11T…",
    "anchor_uuid": "…",            // persistent WebXR anchor (null if unsupported)
    "pins": [{
      "position":              { "x": 0, "y": 0, "z": 0 },  // session world space
      "position_anchor_local": { "x": 0, "y": 0, "z": 0 },  // survives re-localization
      "hit_type": "mesh | plane | fallback",
      "placement_confidence": 0.95,
      // … label, bbox, semantic labels, extents, SAM2 RLE mask, caption …
    }],
    "floorplan": { "bounds": { "min": {}, "max": {} } }      // fallback pins excluded
  }
}
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AR runtime | Meta IWSDK (`@iwsdk/core`) |
| 3D engine | Three.js (bundled in IWSDK) |
| Build | Vite 6 + vite-plugin-mkcert |
| Scene Understanding | WebXR `plane-detection` + `mesh-detection` + `anchors` |
| Raycast | Local `THREE.Raycaster` vs. scene-understanding geometry |
| Camera | IWSDK `CameraSource` component |
| AI models | Florence-2, GroundingDINO, SAM 2 (Docker) |
| Export | Three.js `GLTFExporter` |
| Backend | FastAPI + Uvicorn (Docker) |

## Testing

```bash
cd webxr-ar-ai
npm run test:unit    # Vitest unit tests
npm run test:e2e     # Playwright + IWER (emulated Quest 3 WebXR runtime)
npm run test:all
```
