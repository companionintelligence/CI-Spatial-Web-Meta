"""The store: a failed edit changes nothing, and only scan folders are listed."""

from __future__ import annotations

import pytest

from localscan.store import ScanNotFound, ScanStore

SCAN_ID = "scan_" + "a" * 32


def _record(scan_id=SCAN_ID):
    return {
        "scan_id": scan_id,
        "created_at": "2026-11-16T10:00:00Z",
        "updated_at": "2026-11-16T10:00:00Z",
        "hierarchy": {"room": {"id": "room-1", "name": "Office"}},
        "keyframes": [],
        "detections": [],
        "planes": [],
    }


def test_a_failed_edit_leaves_the_stored_record_unchanged(tmp_path):
    store = ScanStore(tmp_path)
    store.create(_record())
    with pytest.raises(RuntimeError):
        with store.transaction(SCAN_ID) as record:
            record["keyframes"].append({"keyframe_id": "kf-0001"})
            raise RuntimeError("detector failed")
    assert store.read(SCAN_ID)["keyframes"] == []


def test_malformed_ids_never_reach_the_disk(tmp_path):
    store = ScanStore(tmp_path)
    for bad in ("../../etc/passwd", "scan_xyz", "", "scan_" + "A" * 32):
        with pytest.raises(ScanNotFound):
            store.read(bad)
    assert not (tmp_path / "scans").exists()


def test_listing_ignores_folders_that_are_not_scans(tmp_path):
    store = ScanStore(tmp_path)
    store.create(_record())
    (tmp_path / "scans" / "notes").mkdir()
    summaries = store.list()
    assert [s["scan_id"] for s in summaries] == [SCAN_ID]
    assert summaries[0]["room"] == "Office"


def test_discard_removes_an_incomplete_scan(tmp_path):
    store = ScanStore(tmp_path)
    store.create(_record())
    store.discard(SCAN_ID)
    with pytest.raises(ScanNotFound):
        store.read(SCAN_ID)
