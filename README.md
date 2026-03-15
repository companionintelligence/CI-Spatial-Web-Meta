# Companion Scan

Quest 3 local world/space mapper — combines **WebXR Scene Understanding** with a **local CV server** (Grounding DINO, SAM 2, Florence-2) to produce a glTF export with rich spatial metadata.

## Architecture

```
Quest 3 Browser (webxr-ar-ai/)
  ├─ Pipeline A: WebXR Scene Understanding
  │    XRPlane / XRMesh → SpatialPin (MetaScene)
  │
  ├─ Pipeline B: CV Server (network)
  │    CameraSource → base64 JPEG
  │    → Florence-2 caption + OD
  │    → GroundingDINO detect
  │    → SAM2 segment
  │    → EnvironmentRaycastTarget (IWSDK)
  │    → SpatialPin (CvServer)
  │
  ├─ SpatialPinManager (unified pin store)
  ├─ ControllerInputSystem (Quest controller buttons)
  ├─ CameraViewfinder (2D preview + BBox overlay)
  ├─ SpatialLabel3DRenderer (3D persistent labels)
  ├─ WristHUD (left-wrist status panel)
  └─ GltfExporter + GltfSyncClient → POST /v1/gltf

Local CV Server (cv-server/ — Docker)
  POST /v1/detect   — GroundingDINO
  POST /v1/segment  — SAM 2
  POST /v1/florence — Florence-2
  POST /v1/gltf     — Upload
  GET  /v1/health
```

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
```

### 3. Open on Quest 3

Navigate to `https://<PC-IP>:8081` in the Meta Quest browser and accept the certificate.  
The app requests `immersive-ar` automatically.

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
│   ├── main.js                       # Entry: World.create + system wiring
│   ├── app/
│   │   └── AppState.js               # Reactive singleton state
│   ├── spatial/
│   │   ├── SpatialPin.js             # Pin data class
│   │   └── SpatialPinManager.js      # Unified pin store (EventTarget)
│   ├── pipeline/
│   │   ├── PipelineA.js              # WebXR planes/meshes → pins
│   │   └── PipelineB.js              # Camera → CV server → raycast → pins
│   ├── cv/
│   │   └── CvServerClient.js         # REST client for /v1/*
│   ├── rendering/
│   │   ├── CameraViewfinder.js       # Camera preview + 2D bbox overlay
│   │   ├── SpatialLabel3DRenderer.js # 3D persistent label groups
│   │   └── FrustumRenderer.js        # Capture-time ray visualisation
│   ├── input/
│   │   └── ControllerInputSystem.js  # IWSDK ECS system for buttons
│   ├── ui/
│   │   ├── ControllerMenuBuilder.js  # Coloured disc indicators on controllers
│   │   └── WristHUD.js               # Left-wrist canvas panel
│   └── export/
│       ├── GltfExporter.js           # GLTFExporter + spatial metadata extras
│       └── GltfSyncClient.js         # Upload GLB to /v1/gltf

cv-server/
├── Dockerfile
├── docker-compose.yml
├── main.py                           # FastAPI with /v1/* endpoints
├── requirements.txt
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AR runtime | Meta IWSDK (`@iwsdk/core`) |
| 3D engine | Three.js (bundled in IWSDK) |
| Build | Vite 6 + vite-plugin-mkcert |
| Scene Understanding | WebXR `plane-detection` + `mesh-detection` |
| Raycast | IWSDK `EnvironmentRaycastTarget` / `RaycastSpace.Viewer` |
| Camera | IWSDK `CameraSource` component |
| AI models | Florence-2, GroundingDINO, SAM 2 (Docker) |
| Export | Three.js `GLTFExporter` |
| Backend | FastAPI + Uvicorn (Docker) |