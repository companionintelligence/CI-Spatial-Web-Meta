# CV Server

Local Docker server providing AI inference for the Companion Scan pipeline.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/health` | Health / readiness check |
| POST | `/v1/detect` | GroundingDINO object detection |
| POST | `/v1/segment` | Grounded SAM 2 segmentation |
| POST | `/v1/florence` | Florence-2 caption + OD |
| POST | `/v1/gltf` | Upload and store glTF export |

## Quick Start

### Prerequisites

- Docker + NVIDIA Container Toolkit
- NVIDIA GPU with ≥ 8 GB VRAM recommended

### 1. Download model weights

Place weights in `cv-server/weights/`:

```bash
mkdir -p weights

# GroundingDINO SwinT-OGC (~680 MB)
wget -P weights https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth

# SAM 2 Hiera-Large (~900 MB)
wget -P weights https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt
```

Florence-2 is downloaded from HuggingFace automatically on first inference.

### 2. Build + run

```bash
cd cv-server
docker compose up --build
```

The server starts on **http://localhost:8000**.

### 3. Verify

```bash
curl http://localhost:8000/v1/health
# { "status": "ok", "device": "cuda", "cuda": true }
```

## API Reference

### POST /v1/detect

```json
{
  "image": "<base64 JPEG>",
  "prompt": "chair . table . person",
  "box_threshold": 0.35,
  "text_threshold": 0.25
}
```

Response:
```json
{
  "detections": [
    { "label": "chair", "cx": 0.45, "cy": 0.60, "confidence": 0.82, "bbox_cxcywh": [0.45, 0.60, 0.12, 0.18] }
  ]
}
```

### POST /v1/segment

```json
{
  "image": "<base64 JPEG>",
  "boxes": [[0.45, 0.60, 0.12, 0.18]]
}
```

Response:
```json
{
  "segments": [
    { "index": 0, "score": 0.97, "rle": { "size": [720, 1280], "counts": [...], "starts": [...] }, "area": 9234 }
  ]
}
```

### POST /v1/florence

```json
{
  "image": "<base64 JPEG>",
  "task": "<MORE_DETAILED_CAPTION>"
}
```

Response:
```json
{
  "task": "<MORE_DETAILED_CAPTION>",
  "result": { "<MORE_DETAILED_CAPTION>": "A living room with a grey sofa …" }
}
```

### POST /v1/gltf

Multipart form upload (`file` field). Returns:
```json
{ "status": "saved", "path": "/tmp/gltf_uploads/export.gltf", "bytes": 123456 }
```

## CI / Self-Hosted Runner

The GitHub Actions CI workflow targets a Windows self-hosted runner with GPU support.
Ensure:

- Runner labels: `self-hosted`, `windows`, `x64`, `gpu`
- The cv-server Docker container is running as a stable local service
- Health check passes: `http://localhost:8000/v1/health`
