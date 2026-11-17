"""Detector backends: the stub is deterministic, and the GroundingDINO switch builds without importing anything heavy."""

from __future__ import annotations

import sys

import pytest
from PIL import Image

from localscan.detectors import (
    DEFAULT_LABELS,
    DetectorUnavailable,
    GroundingDinoDetector,
    StubDetector,
    detector_from_env,
    parse_labels,
)


def _frame():
    return Image.new("RGB", (64, 36), (120, 120, 120))


def test_stub_caps_labels_and_keeps_boxes_inside_the_frame():
    found = StubDetector(["a", "b", "c", "d", "e"]).detect(_frame(), keyframe_index=0)
    assert [d.label for d in found] == ["a", "b", "c"]
    for d in found:
        assert 0.0 <= d.cx <= 1.0 and 0.0 <= d.cy <= 1.0
        assert 0.0 < d.w <= 1.0 and 0.0 < d.h <= 1.0
        assert d.confidence == 0.5


def test_stub_positions_depend_only_on_the_keyframe_index():
    stub = StubDetector(["chair", "table"])
    same_a = stub.detect(_frame(), keyframe_index=2)
    same_b = stub.detect(Image.new("RGB", (640, 360)), keyframe_index=2)   # pixels do not matter
    other = stub.detect(_frame(), keyframe_index=3)
    assert same_a == same_b
    assert same_a != other


def test_default_detector_is_the_stub():
    detector = detector_from_env({})
    assert isinstance(detector, StubDetector)
    assert detector.id == "stub"
    assert detector.labels == DEFAULT_LABELS[:3]


def test_labels_are_read_from_the_environment():
    assert parse_labels(" chair , table ,, ") == ("chair", "table")
    assert parse_labels("   ") == DEFAULT_LABELS


def test_unknown_detector_name_is_an_error():
    with pytest.raises(ValueError, match="Unknown CV_DETECTOR"):
        detector_from_env({"CV_DETECTOR": "yolo"})


def test_groundingdino_is_selected_without_importing_it(monkeypatch):
    before = set(sys.modules)
    detector = detector_from_env({"CV_DETECTOR": "groundingdino", "GDINO_WEIGHTS": "/no/such.pth"})
    loaded = set(sys.modules) - before
    assert detector.id == "groundingdino"
    assert not [m for m in loaded if m == "torch" or m.startswith(("torch.", "groundingdino"))]


def test_groundingdino_reports_missing_dependencies_as_unavailable(monkeypatch):
    monkeypatch.setitem(sys.modules, "groundingdino", None)   # forces ImportError on the first use
    detector = GroundingDinoDetector(weights_path="/no/such.pth")
    with pytest.raises(DetectorUnavailable, match="not installed"):
        detector.detect(_frame(), keyframe_index=0)
