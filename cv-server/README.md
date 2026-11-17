# CV Server

Local Docker server providing AI inference for the Companion Scan pipeline.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/scans` | Local scan: capture payload in (hierarchy, planes, keyframes), detections out |
| POST | `/v1/scans/{scan_id}/keyframes` | Local scan: more keyframes for an existing scan |
| GET | `/v1/scans/{scan_id}` | Local scan: the stored scan record |
| GET | `/v1/scans` | Local scan: summaries, newest first |
| GET | `/v1/health` | Health / readiness check (includes `local_detector`). Needs the token |
| GET | `/healthz` | Liveness for container healthchecks. No token, reveals nothing |
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

## Local scan API (v1)

`POST /v1/scans` is what the Quest app calls: it takes a capture payload (a hierarchy,
the room's planes, and keyframes, each with its pose and camera intrinsics) and returns
the detections. The contract is [docs/data-contract.md](../docs/data-contract.md), and the
schemas are in [contracts/](../contracts/).

The detector is chosen by `CV_DETECTOR`:

| Value | What runs | Needs |
|---|---|---|
| `stub` (default) | placeholder boxes, deterministic, marked `"detector": "stub"` | nothing |
| `groundingdino` | GroundingDINO (Swin-T OGC), open-vocabulary | `torch`, `groundingdino-py`, the weights |

| Setting | Default | Meaning |
|---|---|---|
| `CV_DETECTOR` | `stub` | `stub` or `groundingdino` |
| `CV_LABELS` | `chair,table,cup,bottle,door,screen,shelf,bed,sofa` | the vocabulary (GroundingDINO's prompt; the stub uses the first three) |
| `GDINO_WEIGHTS` | `/weights/groundingdino_swint_ogc.pth` | the weights file |
| `GDINO_CONFIG` | the config shipped with `groundingdino` | optional override |
| `CV_DEVICE` | `cuda` if available, else `cpu` | the torch device for GroundingDINO |
| `CV_BOX_THRESHOLD` / `CV_TEXT_THRESHOLD` | `0.35` / `0.25` | GroundingDINO thresholds |
| `CV_DATA_DIR` | `cv-server/data` | where scans are stored (`scans/<scan_id>/`) |

Run it without a GPU (the stub):

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
CV_DETECTOR=stub python serve.py        # 127.0.0.1:8000
```

Run the real detector, with the weights in `weights/`:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install groundingdino-py
CV_DETECTOR=groundingdino GDINO_WEIGHTS=$PWD/weights/groundingdino_swint_ogc.pth python serve.py
```

With Docker, `docker compose up --build` builds with `CV_DETECTOR=groundingdino` by default.
Set `CV_DETECTOR=stub` in the environment to run without the weights. Scans persist in
`./data` on the host.

## Access

- **Token.** Every `/v1` route needs `Authorization: Bearer <token>`, and the glTF and detection
  routes are included. The token is `CV_API_TOKEN` when set (at least 24 characters). Otherwise
  the server creates one at `CV_DATA_DIR/api-token` (mode `0600`) on its first start, and reuses
  it after that. It is never logged. `GET /healthz` is the only route without the token.
- **Cross-origin.** None by default. `CORS_ALLOW_ORIGINS` takes explicit origins
  (`https://webxr.example.com`, comma-separated). `*` is refused, and an origin with a path is refused.
- **Address.** `serve.py` listens on `127.0.0.1` unless `CV_HOST` or `--host` says otherwise. The
  Docker image listens on all of its own interfaces, and compose publishes port 8000 to the host's
  loopback only (`127.0.0.1:8000`).
- **Storage.** Scans, glTF exports and the token live under `CV_DATA_DIR` (`/data` in Docker, so
  they sit on a volume). Nothing is kept in `/tmp`. `GLTF_STORE` can still point elsewhere on purpose.

Read the token with `cat cv-server/data/api-token` (or from `CV_API_TOKEN` in your environment),
and give it to the app once, as `?token=` on the app's address.

Requests are validated against the contract. Unknown fields, a JPEG whose size differs from
the declared size, and a non-JPEG image all get `422`. The server makes no outbound
connections of its own; the tests check that.

Tests, which need no torch, no GPU and no weights:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest cv-server/tests          # from the repository root
```

The published schemas are generated from `localscan/contract.py`. After a contract change,
run `python cv-server/scripts/export_contract.py`. A test fails when they are out of date.

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
