"""
Convenience launcher for the GroundingDINO inference server.

1. Checks model weights (downloads if missing).
2. Validates PyTorch + CUDA.
3. Starts the FastAPI/Uvicorn server on port 8000.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _banner():
    print("Grounding DINO Object Detection Server")
    print("=" * 30)


def _check_weights():
    weights = Path(__file__).parent / "weights" / "groundingdino_swint_ogc.pth"
    print("Step 1: Checking model weights…", end=" ")
    if not weights.exists():
        print("\n  Weights not found — downloading now…")
        subprocess.check_call([sys.executable, str(Path(__file__).parent / "download_weights.py")])
    print("✓")
    return weights


def _check_torch():
    print("Step 2: Checking PyTorch installation…")
    import torch  # noqa: PLC0415

    print(f"  ✓ PyTorch version: {torch.__version__}")
    print(f"  ✓ CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  ✓ CUDA device: {torch.cuda.get_device_name(0)}")


def _start():
    print("Step 3: Starting FastAPI server…")
    import uvicorn  # noqa: PLC0415

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    _banner()
    _check_weights()
    _check_torch()
    _start()
