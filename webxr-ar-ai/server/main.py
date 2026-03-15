"""
FastAPI + Grounding DINO inference server.

Start with:
    python start_server.py
or directly:
    uvicorn main:app --host 0.0.0.0 --port 8000

WebSocket endpoint: ws://localhost:8000/ws
  - Receives JSON: { image: <base64 JPEG>, prompt: str, box_threshold: float, text_threshold: float }
  - Returns  JSON: { detections: [{ label, cx, cy, confidence }] }
"""

from __future__ import annotations

import base64
import io
import json
import logging
from pathlib import Path

import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from PIL import Image

logger = logging.getLogger("gdino-server")
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

WEIGHTS_PATH = Path(__file__).parent / "weights" / "groundingdino_swint_ogc.pth"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_model = None
_transform = None


def _load_model():
    global _model, _transform
    if _model is not None:
        return

    try:
        from groundingdino.util.inference import load_model as gd_load
        from groundingdino.util.inference import predict as gd_predict  # noqa: F401 — ensure importable
        import groundingdino.datasets.transforms as T

        config_file = (
            Path(__file__).parent.parent
            / "GroundingDINO"
            / "groundingdino"
            / "config"
            / "GroundingDINO_SwinT_OGC.py"
        )
        if not config_file.exists():
            # Fall back to installed package config
            import groundingdino
            pkg_dir = Path(groundingdino.__file__).parent
            config_file = pkg_dir / "config" / "GroundingDINO_SwinT_OGC.py"

        logger.info("Loading GroundingDINO from %s …", WEIGHTS_PATH)
        _model = gd_load(str(config_file), str(WEIGHTS_PATH), device=DEVICE)
        _model.eval()

        _transform = T.Compose(
            [
                T.RandomResize([800], max_size=1333),
                T.ToTensor(),
                T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ]
        )
        logger.info("GroundingDINO loaded on %s", DEVICE)
    except Exception as exc:
        logger.error("Failed to load GroundingDINO: %s", exc)
        raise


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="GroundingDINO Detection Server", version="1.0.0")


@app.on_event("startup")
async def _startup():
    _load_model()


@app.get("/health")
async def health():
    return {"status": "ok", "device": DEVICE}


@app.websocket("/ws")
async def websocket_detect(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket client connected")
    try:
        while True:
            raw = await ws.receive_text()
            payload = json.loads(raw)

            base64_img   = payload.get("image", "")
            prompt       = payload.get("prompt", "object")
            box_thresh   = float(payload.get("box_threshold", 0.35))
            text_thresh  = float(payload.get("text_threshold", 0.25))

            detections = _run_detection(base64_img, prompt, box_thresh, text_thresh)
            await ws.send_text(json.dumps({"detections": detections}))

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as exc:
        logger.error("WebSocket error: %s", exc)
        await ws.send_text(json.dumps({"error": str(exc), "detections": []}))


# ---------------------------------------------------------------------------
# Inference helper
# ---------------------------------------------------------------------------

def _run_detection(
    base64_img: str,
    prompt: str,
    box_threshold: float,
    text_threshold: float,
) -> list[dict]:
    from groundingdino.util.inference import predict

    img_bytes = base64.b64decode(base64_img)
    pil_img   = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img_tensor, _ = _transform(pil_img, None)

    with torch.no_grad():
        boxes, logits, phrases = predict(
            model=_model,
            image=img_tensor,
            caption=prompt,
            box_threshold=box_threshold,
            text_threshold=text_threshold,
            device=DEVICE,
        )

    detections = []
    for box, logit, phrase in zip(boxes, logits, phrases):
        # box is [cx, cy, w, h] normalised 0-1
        cx, cy = float(box[0]), float(box[1])
        detections.append(
            {
                "label": phrase,
                "cx": cx,
                "cy": cy,
                "confidence": float(logit),
                "bbox_cxcywh": [float(v) for v in box],
            }
        )
    return detections
