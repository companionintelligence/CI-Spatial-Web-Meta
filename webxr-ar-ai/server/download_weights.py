"""
Downloads the GroundingDINO SwinT-OGC weights (~680 MB) to server/weights/.
"""

from __future__ import annotations

import urllib.request
from pathlib import Path


WEIGHTS_URL = (
    "https://github.com/IDEA-Research/GroundingDINO/releases/download/"
    "v0.1.0-alpha/groundingdino_swint_ogc.pth"
)
WEIGHTS_PATH = Path(__file__).parent / "weights" / "groundingdino_swint_ogc.pth"


def _progress(block_num: int, block_size: int, total_size: int) -> None:
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(downloaded / total_size * 100, 100)
        bar = "#" * int(pct / 2)
        print(f"\r  [{bar:<50}] {pct:.1f}%", end="", flush=True)


def main() -> None:
    WEIGHTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if WEIGHTS_PATH.exists():
        print(f"Weights already present at {WEIGHTS_PATH}")
        return

    print(f"Downloading GroundingDINO weights from\n  {WEIGHTS_URL}")
    print(f"  → {WEIGHTS_PATH}")
    urllib.request.urlretrieve(WEIGHTS_URL, WEIGHTS_PATH, reporthook=_progress)
    print(f"\nDone. Saved to {WEIGHTS_PATH}")


if __name__ == "__main__":
    main()
