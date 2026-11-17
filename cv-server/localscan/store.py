"""On-disk store for local scans: one folder per scan id, nothing else.

    <CV_DATA_DIR>/scans/<scan_id>/scan.json          the scan record (contract ScanRecord)
    <CV_DATA_DIR>/scans/<scan_id>/keyframes/kf-NNNN.jpg

Writes go through `transaction`, which holds one lock and rewrites scan.json
atomically on success. A failed request leaves the record as it was. Concurrent
requests for the same scan run one after another, which is what a single LAN
client needs.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping, Union

from .contract import SCAN_ID_PATTERN

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_SCAN_ID = re.compile(SCAN_ID_PATTERN)


class ScanNotFound(LookupError):
    """No scan with that id (also raised for a malformed id, which can never exist)."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2), encoding="utf-8")
    os.replace(tmp, path)


class ScanStore:
    def __init__(self, root: Union[str, Path]):
        self.root = Path(root)
        self._lock = threading.RLock()

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "ScanStore":
        return cls(env.get("CV_DATA_DIR") or DEFAULT_DATA_DIR)

    def scan_dir(self, scan_id: str) -> Path:
        if not _SCAN_ID.fullmatch(scan_id or ""):
            raise ScanNotFound(scan_id)
        return self.root / "scans" / scan_id

    def create(self, record: dict) -> None:
        """Write a new scan. Creates the folder, so nothing is created until a scan is."""
        with self._lock:
            folder = self.scan_dir(record["scan_id"])
            if folder.exists():
                raise FileExistsError(folder)
            (folder / "keyframes").mkdir(parents=True)
            _write_json(folder / "scan.json", record)

    def read(self, scan_id: str) -> dict:
        path = self.scan_dir(scan_id) / "scan.json"
        if not path.is_file():
            raise ScanNotFound(scan_id)
        return json.loads(path.read_text(encoding="utf-8"))

    @contextmanager
    def transaction(self, scan_id: str) -> Iterator[dict]:
        """Yield the stored record for editing. Saved only if the block finishes."""
        with self._lock:
            record = self.read(scan_id)
            yield record
            record["updated_at"] = utc_now_iso()
            _write_json(self.scan_dir(scan_id) / "scan.json", record)

    def write_keyframe(self, scan_id: str, keyframe_id: str, data: bytes) -> str:
        """Store the JPEG bytes. Returns the path relative to the scan folder."""
        relative = f"keyframes/{keyframe_id}.jpg"
        with self._lock:
            (self.scan_dir(scan_id) / relative).write_bytes(data)
        return relative

    def discard(self, scan_id: str) -> None:
        """Remove a scan that was created but never completed."""
        with self._lock:
            shutil.rmtree(self.scan_dir(scan_id), ignore_errors=True)

    def list(self) -> list[dict]:
        base = self.root / "scans"
        if not base.is_dir():
            return []
        summaries: list[dict] = []
        for folder in base.iterdir():
            path = folder / "scan.json"
            if not (folder.is_dir() and _SCAN_ID.fullmatch(folder.name) and path.is_file()):
                continue
            record = json.loads(path.read_text(encoding="utf-8"))
            summaries.append({
                "scan_id": record["scan_id"],
                "created_at": record["created_at"],
                "room": record["hierarchy"]["room"]["name"],
                "keyframe_count": len(record["keyframes"]),
                "detection_count": len(record["detections"]),
            })
        return sorted(summaries, key=lambda s: s["created_at"], reverse=True)
