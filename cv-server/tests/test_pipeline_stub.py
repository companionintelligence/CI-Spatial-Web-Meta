"""End to end on the stub detector: capture payload in, detections out, scan stored under its id.

These run the real routes through FastAPI's TestClient. No torch, GPU or headset.
"""

from __future__ import annotations

import base64
import copy
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from localscan import GroundingDinoDetector, ScanStore, build_router


def _post_capture(client, payload):
    response = client.post("/v1/scans", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_capture_payload_in_detections_out(client, example_request, example_result):
    body = _post_capture(client, example_request)

    assert body["scan_id"].startswith("scan_") and len(body["scan_id"]) == len("scan_") + 32
    assert body["keyframes"] == example_result["keyframes"]
    assert body["detections"] == example_result["detections"]
    assert body["detections"], "the stub should place boxes for every keyframe"
    assert all(d["detector"] == {"id": "stub", "version": "1"} for d in body["detections"])
    assert all(d["level"] == "OBJECT" and d["mask"] is None for d in body["detections"])


def test_scan_is_stored_under_its_scan_id(client, example_request, data_root):
    body = _post_capture(client, example_request)
    scan_id = body["scan_id"]

    folder = Path(data_root) / "scans" / scan_id
    assert (folder / "scan.json").is_file()
    jpeg = (folder / "keyframes" / "kf-0001.jpg").read_bytes()
    assert jpeg[:3] == b"\xff\xd8\xff"

    stored = client.get(f"/v1/scans/{scan_id}").json()
    assert stored["scan_id"] == scan_id
    assert stored["hierarchy"]["room"] == {"id": "room-kitchen", "name": "Kitchen"}
    assert len(stored["planes"]) == len(example_request["planes"])
    assert stored["keyframes"] == body["keyframes"]
    assert stored["detections"] == body["detections"]
    assert stored["detector"] == {"id": "stub", "version": "1"}


def test_appending_a_keyframe_continues_the_scan(client, example_request):
    scan_id = _post_capture(client, example_request)["scan_id"]

    extra = copy.deepcopy(example_request["keyframes"][0])
    extra["client_keyframe_id"] = "cap-2"
    response = client.post(
        f"/v1/scans/{scan_id}/keyframes",
        json={"keyframes": [extra], "planes": example_request["planes"][:1]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [k["keyframe_id"] for k in body["keyframes"]] == ["kf-0002"]
    assert body["detections"][0]["detection_id"] == "kf-0002-d01"

    stored = client.get(f"/v1/scans/{scan_id}").json()
    assert [k["keyframe_id"] for k in stored["keyframes"]] == ["kf-0001", "kf-0002"]
    assert len(stored["planes"]) == 1


def test_stub_output_is_deterministic(client, example_request):
    first = _post_capture(client, example_request)["detections"]
    second = _post_capture(client, example_request)["detections"]
    assert [d["bbox_cxcywh"] for d in first] == [d["bbox_cxcywh"] for d in second]
    assert [d["label"] for d in first] == [d["label"] for d in second]


def test_unknown_or_malformed_scan_id_is_not_found(client, example_request):
    assert client.get("/v1/scans/scan_does_not_exist").status_code == 404
    response = client.post("/v1/scans/scan_00/keyframes", json={"keyframes": [example_request["keyframes"][0]]})
    assert response.status_code == 404


def test_non_jpeg_bytes_are_rejected(client, example_request):
    payload = copy.deepcopy(example_request)
    payload["keyframes"][0]["image"]["base64"] = base64.b64encode(b"not a jpeg at all").decode("ascii")
    assert client.post("/v1/scans", json=payload).status_code == 422


def test_declared_size_must_match_the_image(client, example_request):
    payload = copy.deepcopy(example_request)
    payload["keyframes"][0]["image"]["width"] = 65
    response = client.post("/v1/scans", json=payload)
    assert response.status_code == 422
    assert "declares 65x36" in response.text


def test_invalid_base64_is_rejected(client, example_request):
    payload = copy.deepcopy(example_request)
    payload["keyframes"][0]["image"]["base64"] = "@@@@ not base64 @@@@"
    assert client.post("/v1/scans", json=payload).status_code == 422


def test_list_shows_the_scan_with_its_room(client, example_request):
    scan_id = _post_capture(client, example_request)["scan_id"]
    summaries = client.get("/v1/scans").json()
    found = [s for s in summaries if s["scan_id"] == scan_id]
    assert found and found[0]["room"] == "Kitchen"
    assert found[0]["keyframe_count"] == 1 and found[0]["detection_count"] >= 1


def test_groundingdino_without_its_dependencies_answers_503(tmp_path, example_request, monkeypatch):
    """A GPU backend that is not installed must not crash the server; it answers 503 with the reason."""
    monkeypatch.setitem(sys.modules, "groundingdino", None)   # `import groundingdino` fails
    app = FastAPI()
    store = ScanStore(tmp_path)
    app.include_router(build_router(store, lambda: GroundingDinoDetector(weights_path=str(tmp_path / "w.pth"))))

    response = TestClient(app).post("/v1/scans", json=example_request)
    assert response.status_code == 503
    assert "GroundingDINO is not installed" in response.json()["detail"]
    assert list((tmp_path / "scans").iterdir()) == [], "a failed capture must not leave a scan behind"
