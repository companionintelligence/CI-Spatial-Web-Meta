#!/usr/bin/env python3
"""Regenerate contracts/schemas/*.json and the worked examples in contracts/examples/.

The schemas come from cv-server/localscan/contract.py, the single source of truth.
tests/test_contract.py fails when the committed files drift from the models, so
run this after changing the contract:

    python cv-server/scripts/export_contract.py
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

CV_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = CV_DIR.parent
SCHEMA_DIR = REPO_DIR / "contracts" / "schemas"
EXAMPLE_DIR = REPO_DIR / "contracts" / "examples"
sys.path.insert(0, str(CV_DIR))

from PIL import Image, ImageDraw  # noqa: E402

from localscan.contract import PUBLISHED_MODELS  # noqa: E402


def dump(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def tiny_jpeg_base64(width: int = 64, height: int = 36) -> str:
    """A small, plain JPEG. Only used as a worked example; the tests never regenerate it."""
    image = Image.new("RGB", (width, height), (96, 104, 112))
    draw = ImageDraw.Draw(image)
    draw.rectangle([8, 10, 40, 30], fill=(190, 150, 110))   # a box-like object
    draw.rectangle([44, 4, 60, 32], fill=(60, 70, 80))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=70)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def example_request() -> dict:
    """A realistic capture payload: one kitchen, two planes, one keyframe."""
    identity = {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
    return {
        "hierarchy": {
            "place": {"id": "place-home", "name": "Home"},
            "building": {"id": "building-main", "name": "Main house"},
            "floor": {"id": "floor-ground", "name": "Ground floor", "level": 0},
            "room": {"id": "room-kitchen", "name": "Kitchen"},
        },
        "client": {
            "name": "companion-scan-quest",
            "version": "1.0.0",
            "device": "meta-quest-3",
            "session_id": "3f0c9a7e-2d1b-4b8e-9c57-1a2b3c4d5e6f",
        },
        # The camera was turned on in this session, so the keyframes may be kept.
        "consent": {"camera": True, "granted_at": "2026-11-16T19:40:00Z"},
        "planes": [
            {
                "id": "plane-1",
                "label": "floor",
                "orientation": "horizontal",
                "pose": {
                    "frame": "local-floor",
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "quaternion": identity,
                },
                "center": {"x": 0.0, "z": 0.0},
                "size": {"x": 3.2, "z": 2.9},
            },
            {
                "id": "plane-2",
                "label": "wall",
                "orientation": "vertical",
                "pose": {
                    "frame": "local-floor",
                    "position": {"x": 0.0, "y": 1.2, "z": -1.45},
                    "quaternion": {"x": 0.70711, "y": 0.0, "z": 0.0, "w": 0.70711},
                },
                "center": {"x": 0.0, "z": 0.0},
                "size": {"x": 3.2, "z": 2.4},
            },
        ],
        "keyframes": [
            {
                "client_keyframe_id": "cap-1",
                "captured_at_ms": 1763300000000,
                "image": {
                    "format": "jpeg",
                    "width": 64,
                    "height": 36,
                    "base64": tiny_jpeg_base64(),
                },
                "pose": {
                    "frame": "local-floor",
                    "position": {"x": 0.0, "y": 1.6, "z": 0.5},
                    "quaternion": identity,
                },
                "intrinsics": {"fx": 38.14, "fy": 38.14, "cx": 32.0, "cy": 18.0},
            },
        ],
    }


def example_result(request: dict) -> dict:
    """Run the real route on the request, with a fixed scan id, to record the worked result."""
    from fastapi.testclient import TestClient

    import localscan.api as api
    from localscan import ScanStore, StubDetector, build_router
    from fastapi import FastAPI

    with tempfile.TemporaryDirectory() as tmp:
        app = FastAPI()
        app.include_router(build_router(ScanStore(tmp), lambda: StubDetector()))
        original = api.uuid.uuid4
        api.uuid.uuid4 = lambda: uuid.UUID(int=0)   # scan_000… keeps the example stable
        try:
            response = TestClient(app).post("/v1/scans", json=request)
        finally:
            api.uuid.uuid4 = original
        response.raise_for_status()
        return response.json()


def main() -> None:
    for name, model in PUBLISHED_MODELS.items():
        dump(SCHEMA_DIR / f"{name}.schema.json", model.model_json_schema())

    request = example_request()
    dump(EXAMPLE_DIR / "capture-request.v1.json", request)
    dump(EXAMPLE_DIR / "capture-result.v1.json", example_result(request))
    print(f"wrote {len(PUBLISHED_MODELS)} schemas to {SCHEMA_DIR}")
    print(f"wrote examples to {EXAMPLE_DIR}")


if __name__ == "__main__":
    os.environ.setdefault("CV_DETECTOR", "stub")
    main()
