# Companion Scan Quest — Architecture

Companion Scan Quest is a browser-based Quest 3 world mapper: WebXR Scene
Understanding plus an optional CV inference server produce a portable scan
(GLB + Markdown report) that re-localizes across sessions via a persistent
WebXR anchor.

## System context

```mermaid
flowchart LR
    subgraph Quest3["Meta Quest 3 — Quest Browser"]
        APP["Immersive AR app<br/>(webxr-ar-ai, IWSDK + three.js)"]
        STORE[("localStorage<br/>pins + anchor UUID")]
        DL[("Headset Downloads<br/>.glb + .md")]
    end
    subgraph PC["PC on the same LAN"]
        VITE["Vite dev server<br/>HTTPS :8081, /v1 proxy"]
        VIEWER["Desktop Viewer & Editor<br/>/viewer.html"]
    end
    subgraph GPU["GPU machine (optional)"]
        CV["CV server — FastAPI :8000<br/>Florence-2 · GroundingDINO · SAM 2"]
        GLTFS[("glTF store")]
    end

    APP -- "HTTPS (page + assets)" --> VITE
    APP -- "/v1/detect · florence · segment · models" --> VITE
    VITE -- "proxy /v1/*" --> CV
    APP -- "POST /v1/gltf" --> VITE
    CV --- GLTFS
    APP --- STORE
    APP -- "Left Y export" --> DL
    VIEWER -- "GET /v1/gltf (list + fetch)" --> VITE
```

## Module map (webxr-ar-ai/src)

```mermaid
flowchart TD
    MAIN["main.js<br/>World.create + CompanionScanSystem"]

    subgraph pipeline
        PA["PipelineA<br/>XRPlane/XRMesh → pins"]
        PB["PipelineB<br/>camera → CV → placeDetections"]
        SR["SceneRaycaster<br/>local raycast vs scene geometry"]
    end
    subgraph spatial
        PIN["SpatialPin / SpatialPinManager"]
        ROOT["ScanAnchorRoot<br/>persistent XRAnchor"]
        STG["ScanStorage<br/>localStorage persistence"]
    end
    subgraph rendering
        LBL["SpatialLabel3DRenderer"]
        VF["CameraViewfinder"]
        FR["FrustumRenderer"]
    end
    subgraph ui
        HUD["WristHUD"]
        OVR["DesktopOverlay"]
        MENU["ControllerMenuBuilder"]
    end
    subgraph export
        SNAP["SceneGeometrySnapshot"]
        EXP["GltfExporter (+ buildScanMeta)"]
        RPT["ScanReport (Markdown)"]
        DLM["GltfDownload"]
        SYNC["GltfSyncClient"]
    end
    subgraph viewer["viewer (desktop, /viewer.html)"]
        VMAIN["viewer/main.js"]
        VMETA["scanMetadata (editor ops)"]
        VPARSE["scanParser"]
    end
    FIX["fixtures/homes.js<br/>24 test homes"]

    MAIN --> PA & PB & LBL & VF & FR & HUD & OVR & MENU & SNAP & SYNC & STG
    PB --> SR
    PA & PB --> PIN
    PIN --> LBL & HUD & OVR & STG
    SNAP & LBL --> ROOT
    EXP --> RPT
    DLM --> EXP & RPT
    SYNC --> EXP
    VMAIN --> VMETA & VPARSE & RPT & FIX
```

## Capture sequence

```mermaid
sequenceDiagram
    actor U as User (Right A)
    participant SYS as CompanionScanSystem
    participant SU as SceneUnderstanding (IWSDK)
    participant PA as Pipeline A
    participant PB as Pipeline B
    participant CV as CV server
    participant PM as SpatialPinManager

    U->>SYS: capture
    SYS->>SU: read XRPlane/XRMesh entities
    SYS->>SYS: SceneGeometrySnapshot (anchor-local copies)
    SYS->>PA: runPipelineA(planes, meshes)
    PA->>PM: MetaScene pins (stable track IDs)
    SYS->>PB: capture(captureId, raycastTargets)
    PB->>PB: snapshotPose() — freeze head pose
    PB->>PB: encodeVideoFrame (off main thread)
    PB->>CV: detect / florence / segment
    CV-->>PB: detections (normalized bboxes)
    PB->>PB: pinhole ray per bbox centre (capture-time pose)
    PB->>PB: SceneRaycaster vs room geometry
    PB->>PM: CvServer pins (hit point or fallback)
    PM-->>SYS: events → labels, HUD, overlay
    SYS->>SYS: ScanStorage.save (autosave)
```

## Export sequence

```mermaid
sequenceDiagram
    actor U as User (Left Y)
    participant SYS as CompanionScanSystem
    participant EXP as GltfExporter
    participant RPT as ScanReport
    participant DL as Browser downloads
    participant CV as CV server

    U->>SYS: export
    SYS->>EXP: exportGltf(geometryRoot, pins, anchor)
    EXP-->>SYS: GLB (extras.companion_scan v1.1)
    SYS->>RPT: buildScanReport(buildScanMeta(...))
    RPT-->>SYS: Markdown
    SYS->>DL: companion-scan-<ts>.glb + .md
    SYS->>CV: POST /v1/gltf (best-effort upload)
    CV-->>SYS: saved | unreachable → warn status
```

## User flow

| # | Step | Surface | Outcome |
|---|------|---------|---------|
| 1 | Open `https://<pc>:8081` on the Quest | Desktop overlay | XR/CV status, controller legend |
| 2 | Enter AR, grant camera | Quest browser | Passthrough + viewfinder + wrist HUD |
| 3 | (first run) Space Setup prompt | Native OS flow | Scene model (planes + meshes) |
| 4 | **Right A** — capture | In-headset | Scene pins (blue) + CV detections (green) placed on real surfaces |
| 5 | **Right B / Left X / Trigger** | In-headset | Cycle model (from server registry) / preview distance / display mode |
| 6 | **Left Y** — export | In-headset | `.glb` + `.md` to Downloads, upload to CV server |
| 7 | Inspect / edit | `/viewer.html` | Load from server store or file; edit pins; re-export GLB/JSON/report |
| 8 | Reload / next session | Automatic | Pins restored from localStorage; persistent anchor re-localizes |

## Scan schema (`extras.companion_scan`, v1.1)

| Field | Type | Notes |
|---|---|---|
| `version` | string | `"1.1"` |
| `session_id` | string | capture session UUID |
| `exported_at` | ISO string | export time |
| `anchor_uuid` | string\|null | persistent WebXR anchor (re-localization key) |
| `pins[]` | array | see below |
| `floorplan.bounds` | min/max vec3 | excludes `fallback` pins |
| `floorplan.cv_pin_count` / `scene_pin_count` | number | per-source counts |

Per pin:

| Field | Type | Notes |
|---|---|---|
| `id`, `track_id` | string | identity; track IDs are stable per real-world surface |
| `source` | `CvServer` \| `MetaScene` | detection vs. scene-understanding |
| `label` | string | semantic or detector label |
| `position` | vec3 | session world space (`local-floor`) — session-ephemeral |
| `position_anchor_local` | vec3 | anchor-relative — survives sessions; **use this for re-localization** |
| `rotation` | quat | capture-time orientation |
| `confidence` | 0–1 | detector confidence |
| `hit_type` | `plane`\|`mesh`\|`fallback` | placement quality (`fallback` = distance guess) |
| `placement_confidence` | 0–1 | 0.95 raycast hit · 0.5 fallback · 1.0 scene |
| `bbox_cxcywh` | [cx,cy,w,h] | normalized image bbox |
| `semantic_labels` | string[]\|null | WebXR semantic labels |
| `plane_extents` / `volume_extents` | center+size | local-frame extents |
| `mask_rle` | object\|null | SAM 2 segmentation |
| `florence_caption` | string\|null | scene description |

### Coordinate conventions

| Frame | Origin | Used by |
|---|---|---|
| Session world | `local-floor` (floor under headset at session start) | `position`, live rendering |
| Anchor-local | persistent `XRAnchor` (UUID in localStorage) | `position_anchor_local`, exported geometry node transforms, storage |
| Plane-local | plane centre, +Y normal, polygon in XZ | `plane_extents` |
| Mesh-local | mesh space pose | `volume_extents`, vertex buffers |

Units are metres; Y is up; right-handed (WebXR convention).

## CV model system

```mermaid
flowchart LR
    BOOT["app boot"] -->|"GET /v1/models"| REG["MODEL_REGISTRY<br/>(cv-server)"]
    REG -->|ids| AS["appState.models<br/>(fallback: Florence/GDino/SAM2)"]
    AS -->|"Right B cycles"| PRESET["modelPreset"]
    PRESET -->|Florence| F["/v1/florence ×2<br/>caption + OD"]
    PRESET -->|SAM2| S["/v1/detect → /v1/segment"]
    PRESET -->|"GDino / any other id"| D["/v1/detect {model: id}"]
```

Adding a detector = one registry entry + a lazy loader + a `req.model`
branch in `/v1/detect`. Clients need no changes.

## Test architecture

| Layer | Harness | What it proves |
|---|---|---|
| Unit (242+) | Vitest, Node | fixtures, pipelines, storage, exporters, editor ops, report |
| E2E (78) | Playwright + IWER (+ @iwer/sem) + mock CV server | real app against an emulated Quest 3 runtime |
| **24 test homes** | `fixtures/homes.js` → SEM environments | full WebXR plane/mesh-detection path: every home's plane/mesh counts and semantic labels |
| Placement ground truth | `test-assets/cv/*.png/.json` | pinhole + raycast placement vs. rendered ground truth (occlusion-aware) |
| Real-model eval | `cv-server/eval_images.py` | recall/IoU of the actual models on the synthetic frames (GPU box) |

```mermaid
flowchart LR
    HOMES["fixtures/homes.js<br/>24 home specs"] --> SEM["@iwer/sem environments"]
    HOMES --> IMGS["scripts/generate-cv-test-images.mjs<br/>frames + GT bboxes"]
    HOMES --> SAMPLES["viewer sample homes<br/>(editor test data)"]
    SEM --> E2E["Playwright e2e<br/>real WebXR scene path"]
    IMGS --> MOCK["mock CV server replay"] --> E2E
    IMGS --> EVAL["eval_images.py<br/>real models, GPU box"]
```
