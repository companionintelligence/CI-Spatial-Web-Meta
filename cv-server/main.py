"""
CV Server — FastAPI inference server for the Companion Scan pipeline.

Endpoints:
  POST /v1/detect   — GroundingDINO object detection
  POST /v1/segment  — Grounded SAM 2 segmentation
  POST /v1/florence — Florence-2 caption + object detection
  POST /v1/gltf     — Receive and store glTF export
  GET  /v1/health   — Health / readiness check

All image endpoints accept:
  { "image": "<base64 JPEG>", ... }
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel

logger = logging.getLogger("cv-server")
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
GLTF_STORE = Path(os.getenv("GLTF_STORE", "/tmp/gltf_uploads"))
GLTF_STORE.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Lazy model registry
# ---------------------------------------------------------------------------

_models: dict[str, Any] = {}


def _gdino():
    if "gdino" not in _models:
        logger.info("Loading GroundingDINO…")
        from groundingdino.util.inference import load_model, predict  # noqa: F401
        import groundingdino.datasets.transforms as T
        import groundingdino

        pkg_dir = Path(groundingdino.__file__).parent
        cfg     = pkg_dir / "config" / "GroundingDINO_SwinT_OGC.py"
        weights = Path("/weights/groundingdino_swint_ogc.pth")

        model = load_model(str(cfg), str(weights), device=DEVICE)
        model.eval()

        transform = T.Compose([
            T.RandomResize([800], max_size=1333),
            T.ToTensor(),
            T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        _models["gdino"] = (model, transform, predict)
        logger.info("GroundingDINO ready on %s", DEVICE)
    return _models["gdino"]


def _sam2():
    if "sam2" not in _models:
        logger.info("Loading SAM 2…")
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        cfg     = "sam2_hiera_large.yaml"
        weights = Path("/weights/sam2_hiera_large.pt")
        sam     = build_sam2(cfg, str(weights), device=DEVICE)
        _models["sam2"] = SAM2ImagePredictor(sam)
        logger.info("SAM 2 ready on %s", DEVICE)
    return _models["sam2"]


def _florence():
    if "florence" not in _models:
        logger.info("Loading Florence-2…")
        from transformers import AutoProcessor, AutoModelForCausalLM

        model_id = os.getenv("FLORENCE_MODEL_ID", "microsoft/Florence-2-large")
        processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        model     = AutoModelForCausalLM.from_pretrained(
            model_id, trust_remote_code=True, torch_dtype=torch.float16
        ).to(DEVICE)
        model.eval()
        _models["florence"] = (model, processor)
        logger.info("Florence-2 ready on %s", DEVICE)
    return _models["florence"]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DetectRequest(BaseModel):
    image: str
    prompt: str = "object . person . chair . table . cup . bottle . door . screen"
    box_threshold: float = 0.35
    text_threshold: float = 0.25


class SegmentRequest(BaseModel):
    image: str
    boxes: list[list[float]]      # List of [cx, cy, w, h] normalised


class FlorenceRequest(BaseModel):
    image: str
    task: str = "<MORE_DETAILED_CAPTION>"   # or <OD>, <CAPTION>, etc.
    text_input: str | None = None


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Companion Scan CV Server", version="1.0.0")


@app.get("/v1/health")
async def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "cuda": torch.cuda.is_available(),
    }


# ---------------------------------------------------------------------------
# /v1/detect — GroundingDINO
# ---------------------------------------------------------------------------

@app.post("/v1/detect")
async def detect(req: DetectRequest):
    try:
        model, transform, predict = _gdino()
        pil_img = _decode_image(req.image)
        img_tensor, _ = transform(pil_img, None)

        with torch.no_grad():
            boxes, logits, phrases = predict(
                model=model,
                image=img_tensor,
                caption=req.prompt,
                box_threshold=req.box_threshold,
                text_threshold=req.text_threshold,
                device=DEVICE,
            )

        detections = [
            {
                "label": phrase,
                "cx": float(box[0]),
                "cy": float(box[1]),
                "confidence": float(logit),
                "bbox_cxcywh": [float(v) for v in box],
            }
            for box, logit, phrase in zip(boxes, logits, phrases)
        ]
        return {"detections": detections}
    except Exception as exc:
        logger.exception("Detection error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# /v1/segment — Grounded SAM 2
# ---------------------------------------------------------------------------

@app.post("/v1/segment")
async def segment(req: SegmentRequest):
    try:
        import numpy as np

        predictor = _sam2()
        pil_img   = _decode_image(req.image)
        img_np    = np.array(pil_img)
        w, h      = pil_img.size

        # Convert normalised cx/cy/bw/bh → pixel x1y1x2y2
        input_boxes = []
        for box in req.boxes:
            cx, cy, bw, bh = box
            x1 = int((cx - bw / 2) * w)
            y1 = int((cy - bh / 2) * h)
            x2 = int((cx + bw / 2) * w)
            y2 = int((cy + bh / 2) * h)
            input_boxes.append([x1, y1, x2, y2])

        predictor.set_image(img_np)
        import numpy as np
        masks_out, scores_out, _ = predictor.predict(
            box=np.array(input_boxes),
            multimask_output=False,
        )

        segments = []
        for i, (mask, score) in enumerate(zip(masks_out, scores_out)):
            rle = _mask_to_rle(mask[0] if mask.ndim == 3 else mask)
            segments.append({
                "index": i,
                "score": float(score[0] if hasattr(score, "__len__") else score),
                "rle": rle,
                "area": int((mask[0] if mask.ndim == 3 else mask).sum()),
            })
        return {"segments": segments}
    except Exception as exc:
        logger.exception("Segmentation error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# /v1/florence — Florence-2
# ---------------------------------------------------------------------------

@app.post("/v1/florence")
async def florence(req: FlorenceRequest):
    try:
        model, processor = _florence()
        pil_img = _decode_image(req.image)

        inputs = processor(
            text=req.task,
            images=pil_img,
            return_tensors="pt",
        ).to(DEVICE, torch.float16)

        with torch.no_grad():
            generated_ids = model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                num_beams=3,
            )

        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(
            generated_text,
            task=req.task,
            image_size=(pil_img.width, pil_img.height),
        )
        return {"task": req.task, "result": parsed}
    except Exception as exc:
        logger.exception("Florence error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# /v1/gltf — Upload + store glTF export
# ---------------------------------------------------------------------------

@app.post("/v1/gltf")
async def upload_gltf(file: UploadFile = File(...)):
    try:
        content  = await file.read()
        filename = file.filename or f"export_{uuid.uuid4().hex}.gltf"
        dest     = GLTF_STORE / filename
        dest.write_bytes(content)
        logger.info("Saved glTF: %s (%d bytes)", dest, len(content))
        return {"status": "saved", "path": str(dest), "bytes": len(content)}
    except Exception as exc:
        logger.exception("glTF upload error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _decode_image(b64: str) -> Image.Image:
    img_bytes = base64.b64decode(b64)
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")


def _mask_to_rle(mask) -> dict:
    """Simple RLE encoding for a boolean numpy mask."""
    import numpy as np

    flat  = mask.flatten(order="F").astype(bool)
    diffs = np.diff(flat.view(np.uint8), prepend=0, append=0)
    starts = list(np.where(diffs == 1)[0] + 1)
    ends   = list(np.where(diffs == 255)[0] + 1)
    counts = [e - s for s, e in zip(starts, ends)]
    return {"size": list(mask.shape), "counts": counts, "starts": starts}
