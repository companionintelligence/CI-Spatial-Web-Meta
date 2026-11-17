"""HTTP routes for the local-scan API, mounted under /v1/scans by cv-server/main.py.

    POST /v1/scans                     capture payload in (hierarchy, planes, keyframes) -> detections out
    POST /v1/scans/{scan_id}/keyframes later keyframes of the same scan (optionally new planes)
    GET  /v1/scans/{scan_id}           the stored scan record
    GET  /v1/scans                     summaries, newest first

Every route runs in FastAPI's thread pool (plain `def`), so a slow detector never
blocks the event loop. Bodies are contract models from contract.py: unknown
fields are rejected, and a keyframe's declared size must match its JPEG.
"""

from __future__ import annotations

import base64
import binascii
import io
import uuid
from typing import Callable

from fastapi import APIRouter, HTTPException
from PIL import Image, UnidentifiedImageError

from .contract import (
    CONTRACT_VERSION,
    MAX_IMAGE_BYTES,
    CaptureResult,
    Consent,
    Detection,
    DetectorInfo,
    ImageOut,
    ImageIn,
    KeyframeIn,
    KeyframeOut,
    KeyframesAppend,
    ScanCreate,
    ScanRecord,
    ScanSummary,
)
from .detectors import Detector, DetectorUnavailable, RawDetection
from .store import ScanNotFound, ScanStore, utc_now_iso

DetectorProvider = Callable[[], Detector]


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def _decode_jpeg(image: ImageIn) -> tuple[bytes, Image.Image]:
    """Validate one keyframe image. Returns the raw JPEG bytes and the decoded RGB image."""
    if len(image.base64) > (MAX_IMAGE_BYTES * 4) // 3 + 8:
        raise HTTPException(status_code=413, detail="keyframe image is larger than 8 MB")
    try:
        raw = base64.b64decode(image.base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail="keyframe image is not valid base64") from exc
    if not raw:
        raise HTTPException(status_code=422, detail="keyframe image is empty")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="keyframe image is larger than 8 MB")
    if raw[:3] != b"\xff\xd8\xff":
        raise HTTPException(status_code=422, detail="keyframe image is not a JPEG")
    try:
        decoded = Image.open(io.BytesIO(raw))
        decoded.load()  # a full decode catches truncated files now, not inside the detector
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="keyframe image cannot be decoded") from exc
    if decoded.format != "JPEG":
        raise HTTPException(status_code=422, detail="keyframe image is not a JPEG")
    if decoded.size != (image.width, image.height):
        raise HTTPException(
            status_code=422,
            detail=(
                f"keyframe declares {image.width}x{image.height} but the image is "
                f"{decoded.width}x{decoded.height}"
            ),
        )
    return raw, decoded.convert("RGB")


def _require_camera_consent(consent: Optional[Consent]) -> None:
    """Keyframes are camera frames: they are kept only when the user opted in to the camera."""
    if consent is None or not consent.camera:
        raise HTTPException(
            status_code=403,
            detail="keyframes need the camera opt-in: consent.camera must be true",
        )


def _stored_consent(consent: Optional[Consent]) -> Optional[dict]:
    """The consent as the record keeps it, with the time the server accepted it."""
    if consent is None:
        return None
    return {
        "camera": consent.camera,
        "granted_at": consent.granted_at,
        "recorded_at": utc_now_iso(),
    }


def _detector(provider: DetectorProvider) -> Detector:
    try:
        return provider()
    except DetectorUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _to_detections(kf_id: str, raws: list[RawDetection], info: DetectorInfo) -> list[Detection]:
    out: list[Detection] = []
    for number, raw in enumerate(raws, start=1):
        cx, cy = _clamp01(raw.cx), _clamp01(raw.cy)
        out.append(Detection(
            detection_id=f"{kf_id}-d{number:02d}",
            keyframe_id=kf_id,
            label=(raw.label or "object")[:120],
            confidence=_clamp01(raw.confidence),
            bbox_cxcywh=[cx, cy, _clamp01(raw.w), _clamp01(raw.h)],
            cx=cx,
            cy=cy,
            detector=info,
        ))
    return out


def _ingest(
    store: ScanStore,
    scan_id: str,
    record: dict,
    keyframes: list[KeyframeIn],
    provider: DetectorProvider,
) -> tuple[list[KeyframeOut], list[Detection]]:
    """Validate, store and detect each keyframe, appending to `record` in place."""
    added_keyframes: list[KeyframeOut] = []
    added_detections: list[Detection] = []
    if not keyframes:
        return added_keyframes, added_detections

    detector = _detector(provider)
    info = DetectorInfo(id=detector.id, version=detector.version)
    for keyframe in keyframes:
        raw, decoded = _decode_jpeg(keyframe.image)
        index = len(record["keyframes"])
        keyframe_id = f"kf-{index + 1:04d}"
        try:
            found = detector.detect(decoded, index)
        except DetectorUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        detections = _to_detections(keyframe_id, found, info)
        file_name = store.write_keyframe(scan_id, keyframe_id, raw)
        out = KeyframeOut(
            keyframe_id=keyframe_id,
            client_keyframe_id=keyframe.client_keyframe_id,
            captured_at_ms=keyframe.captured_at_ms,
            image=ImageOut(width=decoded.width, height=decoded.height, file=file_name),
            pose=keyframe.pose,
            intrinsics=keyframe.intrinsics,
            detection_count=len(detections),
        )
        record["keyframes"].append(out.model_dump(mode="json"))
        record["detections"].extend(d.model_dump(mode="json") for d in detections)
        record["detector"] = info.model_dump(mode="json")
        added_keyframes.append(out)
        added_detections.extend(detections)
    return added_keyframes, added_detections


def build_router(store: ScanStore, get_detector: DetectorProvider) -> APIRouter:
    router = APIRouter(prefix="/v1/scans", tags=["local-scan"])

    @router.get("", response_model=list[ScanSummary])
    def list_scans() -> list[dict]:
        return store.list()

    @router.post("", response_model=CaptureResult, status_code=201)
    def create_scan(body: ScanCreate) -> CaptureResult:
        if body.keyframes:
            _require_camera_consent(body.consent)   # refused before anything is written
        scan_id = f"scan_{uuid.uuid4().hex}"
        now = utc_now_iso()
        record = {
            "contract_version": CONTRACT_VERSION,
            "scan_id": scan_id,
            "created_at": now,
            "updated_at": now,
            "hierarchy": body.hierarchy.model_dump(mode="json"),
            "client": body.client.model_dump(mode="json") if body.client else None,
            "consent": _stored_consent(body.consent),
            "planes": [p.model_dump(mode="json") for p in body.planes],
            "keyframes": [],
            "detections": [],
            "detector": None,
        }
        store.create(record)
        try:
            with store.transaction(scan_id) as stored:
                added_keyframes, added_detections = _ingest(
                    store, scan_id, stored, body.keyframes, get_detector,
                )
        except Exception:
            store.discard(scan_id)
            raise
        return CaptureResult(
            scan_id=scan_id, keyframes=added_keyframes, detections=added_detections,
        )

    @router.post("/{scan_id}/keyframes", response_model=CaptureResult)
    def append_keyframes(scan_id: str, body: KeyframesAppend) -> CaptureResult:
        _require_camera_consent(body.consent)   # refused before anything is written
        try:
            with store.transaction(scan_id) as stored:
                stored["consent"] = _stored_consent(body.consent)
                if body.planes is not None:
                    stored["planes"] = [p.model_dump(mode="json") for p in body.planes]
                added_keyframes, added_detections = _ingest(
                    store, scan_id, stored, body.keyframes, get_detector,
                )
        except ScanNotFound as exc:
            raise HTTPException(status_code=404, detail="scan not found") from exc
        return CaptureResult(
            scan_id=scan_id, keyframes=added_keyframes, detections=added_detections,
        )

    @router.get("/{scan_id}", response_model=ScanRecord)
    def read_scan(scan_id: str) -> dict:
        try:
            return store.read(scan_id)
        except ScanNotFound as exc:
            raise HTTPException(status_code=404, detail="scan not found") from exc

    return router
