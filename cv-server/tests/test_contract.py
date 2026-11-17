"""The written contract: the published schemas match the models, the examples are valid, and bad input is refused."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from localscan.contract import PUBLISHED_MODELS, CaptureResult, ScanCreate

REPO_DIR = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_DIR / "contracts" / "schemas"


@pytest.mark.parametrize("name", sorted(PUBLISHED_MODELS))
def test_published_schema_matches_the_model(name):
    committed = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))
    generated = json.loads(json.dumps(PUBLISHED_MODELS[name].model_json_schema()))
    assert committed == generated, (
        f"contracts/schemas/{name}.schema.json is out of date: "
        "run python cv-server/scripts/export_contract.py"
    )


def test_example_request_is_a_valid_capture_payload(example_request):
    ScanCreate.model_validate(example_request)


def test_example_result_is_a_valid_capture_result(example_result):
    CaptureResult.model_validate(example_result)


def test_unknown_fields_are_rejected(example_request):
    payload = copy.deepcopy(example_request)
    payload["keyframes"][0]["pose"]["units"] = "cm"
    with pytest.raises(ValidationError):
        ScanCreate.model_validate(payload)


def test_poses_must_be_in_the_local_floor_frame(example_request):
    payload = copy.deepcopy(example_request)
    payload["keyframes"][0]["pose"]["frame"] = "unbounded"
    with pytest.raises(ValidationError):
        ScanCreate.model_validate(payload)


def test_hierarchy_ids_cannot_be_paths(example_request):
    payload = copy.deepcopy(example_request)
    payload["hierarchy"]["room"]["id"] = "../etc"
    with pytest.raises(ValidationError):
        ScanCreate.model_validate(payload)


def test_keyframe_count_per_request_is_capped(example_request):
    payload = copy.deepcopy(example_request)
    payload["keyframes"] = [payload["keyframes"][0]] * 9
    with pytest.raises(ValidationError):
        ScanCreate.model_validate(payload)


def test_detection_boxes_are_fractions_of_the_frame(example_result):
    result = copy.deepcopy(example_result)
    result["detections"][0]["bbox_cxcywh"][0] = 1.5
    with pytest.raises(ValidationError):
        CaptureResult.model_validate(result)
