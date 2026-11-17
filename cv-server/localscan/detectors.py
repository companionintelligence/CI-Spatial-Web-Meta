"""Pluggable detectors behind the local-scan API.

A detector turns one keyframe image into labelled 2D boxes. The API does not care
which one runs, so the backend is a configuration switch:

    CV_DETECTOR=stub            (default) no model, no GPU, deterministic boxes
    CV_DETECTOR=groundingdino   open-vocabulary GroundingDINO (needs torch,
                                groundingdino-py, and the weights file)

Adding a backend: implement `Detector`, add a branch in `detector_from_env`.

Nothing here imports torch or groundingdino at import time or at construction.
The GroundingDINO backend imports them on first use, so the server and its tests
run on a machine with neither installed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Protocol, Sequence

from PIL import Image

DEFAULT_LABELS = ("chair", "table", "cup", "bottle", "door", "screen", "shelf", "bed", "sofa")
DEFAULT_GDINO_WEIGHTS = "/weights/groundingdino_swint_ogc.pth"
# The stub emits at most this many labels per keyframe (keeps placeholder output readable).
STUB_MAX_LABELS = 3


class DetectorUnavailable(RuntimeError):
    """The configured backend cannot run here (missing package, weights, or device)."""


@dataclass(frozen=True)
class RawDetection:
    label: str
    confidence: float
    # Normalised to the keyframe image: centre and size, origin top-left.
    cx: float
    cy: float
    w: float
    h: float


class Detector(Protocol):
    id: str
    version: str

    def detect(self, image: Image.Image, keyframe_index: int) -> list[RawDetection]:
        """Boxes for one keyframe. `keyframe_index` is the 0-based position in the scan."""
        ...


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def _fraction(value: float) -> float:
    return value - int(value)


class StubDetector:
    """Placeholder boxes for running the whole pipeline without a model.

    It reads the image size and nothing else, and places one box per label at a
    position that depends only on the keyframe index and the label index. The same
    input always gives the same output, so tests can assert on it. Every result
    carries detector id "stub", so a placeholder is never mistaken for a real one.
    """

    id = "stub"
    version = "1"

    def __init__(self, labels: Sequence[str] = DEFAULT_LABELS):
        self.labels = tuple(labels[:STUB_MAX_LABELS]) or ("object",)

    def detect(self, image: Image.Image, keyframe_index: int) -> list[RawDetection]:
        found: list[RawDetection] = []
        for j, label in enumerate(self.labels):
            cx = _clamp(0.2 + 0.6 * _fraction(0.618 * (keyframe_index + 1) + 0.31 * j), 0.2, 0.8)
            cy = _clamp(0.3 + 0.4 * _fraction(0.414 * (keyframe_index + 1) + 0.57 * j), 0.3, 0.7)
            found.append(RawDetection(label=label, confidence=0.5, cx=cx, cy=cy, w=0.14 + 0.02 * j, h=0.2))
        return found


class GroundingDinoDetector:
    """Open-vocabulary detection with GroundingDINO (Swin-T OGC).

    The heavy imports and the weights load happen on the first `detect` call. If
    anything is missing, that call raises DetectorUnavailable with the reason, and
    the API answers 503 instead of crashing the server.
    """

    id = "groundingdino"
    version = "swint-ogc"

    def __init__(
        self,
        labels: Sequence[str] = DEFAULT_LABELS,
        *,
        config_path: Optional[str] = None,
        weights_path: str = DEFAULT_GDINO_WEIGHTS,
        device: Optional[str] = None,
        box_threshold: float = 0.35,
        text_threshold: float = 0.25,
    ):
        self.labels = tuple(labels) or DEFAULT_LABELS
        self.config_path = config_path
        self.weights_path = weights_path
        self.device = device
        self.box_threshold = box_threshold
        self.text_threshold = text_threshold
        self._model = None
        self._transform = None
        self._predict = None
        self._torch = None
        self._device = None

    @property
    def prompt(self) -> str:
        return " . ".join(self.labels) + " ."

    def _load(self) -> None:
        if self._model is not None:
            return
        try:
            import groundingdino  # type: ignore[import-not-found]
            import groundingdino.datasets.transforms as T  # type: ignore[import-not-found]
            from groundingdino.util.inference import load_model, predict  # type: ignore[import-not-found]
            import torch  # type: ignore[import-not-found]
        except ImportError as exc:
            raise DetectorUnavailable(
                "GroundingDINO is not installed. Install torch and groundingdino-py, "
                "or set CV_DETECTOR=stub."
            ) from exc

        weights = Path(self.weights_path)
        if not weights.is_file():
            raise DetectorUnavailable(f"GroundingDINO weights not found at {weights}. Set GDINO_WEIGHTS.")

        config = Path(self.config_path) if self.config_path else (
            Path(groundingdino.__file__).parent / "config" / "GroundingDINO_SwinT_OGC.py"
        )
        device = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        model = load_model(str(config), str(weights), device=device)
        model.eval()

        self._transform = T.Compose([
            T.RandomResize([800], max_size=1333),
            T.ToTensor(),
            T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        self._model = model
        self._predict = predict
        self._torch = torch
        self._device = device

    def detect(self, image: Image.Image, keyframe_index: int) -> list[RawDetection]:
        self._load()
        tensor, _ = self._transform(image.convert("RGB"), None)
        with self._torch.no_grad():
            boxes, logits, phrases = self._predict(
                model=self._model,
                image=tensor,
                caption=self.prompt,
                box_threshold=self.box_threshold,
                text_threshold=self.text_threshold,
                device=self._device,
            )
        found: list[RawDetection] = []
        for box, logit, phrase in zip(boxes, logits, phrases):
            cx, cy, w, h = (float(v) for v in box)
            found.append(RawDetection(
                label=str(phrase), confidence=float(logit), cx=cx, cy=cy, w=w, h=h,
            ))
        return found


def parse_labels(raw: Optional[str]) -> tuple[str, ...]:
    """Comma-separated vocabulary from CV_LABELS, or the default list."""
    if not raw or not raw.strip():
        return DEFAULT_LABELS
    labels = tuple(part.strip() for part in raw.split(",") if part.strip())
    return labels or DEFAULT_LABELS


def detector_from_env(env: Mapping[str, str] = os.environ) -> Detector:
    """Build the detector named by CV_DETECTOR. Construction never loads a model."""
    name = (env.get("CV_DETECTOR") or "stub").strip().lower()
    labels = parse_labels(env.get("CV_LABELS"))
    if name == "stub":
        return StubDetector(labels)
    if name == "groundingdino":
        return GroundingDinoDetector(
            labels,
            config_path=env.get("GDINO_CONFIG") or None,
            weights_path=env.get("GDINO_WEIGHTS") or DEFAULT_GDINO_WEIGHTS,
            device=env.get("CV_DEVICE") or None,
            box_threshold=float(env.get("CV_BOX_THRESHOLD") or 0.35),
            text_threshold=float(env.get("CV_TEXT_THRESHOLD") or 0.25),
        )
    raise ValueError(f"Unknown CV_DETECTOR {name!r}: use 'stub' or 'groundingdino'.")
