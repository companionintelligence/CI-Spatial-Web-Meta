"""Local scan API for Companion Scan Quest: the v1 contract, detectors and store.

It runs on the LAN next to the headset with no cloud API. The stub detector needs
no GPU, and the GroundingDINO backend is selected with CV_DETECTOR=groundingdino.
The contract is in contract.py and docs/data-contract.md.
"""

from .api import build_router
from .contract import CONTRACT_VERSION, PUBLISHED_MODELS
from .detectors import (
    DetectorUnavailable,
    GroundingDinoDetector,
    StubDetector,
    detector_from_env,
)
from .store import ScanNotFound, ScanStore

__all__ = [
    "CONTRACT_VERSION",
    "DetectorUnavailable",
    "GroundingDinoDetector",
    "PUBLISHED_MODELS",
    "ScanNotFound",
    "ScanStore",
    "StubDetector",
    "build_router",
    "detector_from_env",
]
