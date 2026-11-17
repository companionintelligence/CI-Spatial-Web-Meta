"""The v1 local-scan contract: scan, keyframe, detection, plane and hierarchy.

This module is the source of truth. `contracts/schemas/*.json` is generated from
it by `cv-server/scripts/export_contract.py`, and a test fails when the two drift.
The written contract, with units and frames, is docs/data-contract.md.

Hierarchy (names kept from the Companion Scan data model, so a later sync is a
mapping, not a rewrite): PLACE > BUILDING > FLOOR > ROOM > SCAN > OBJECT. A
detection is the OBJECT level.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_VERSION = "1.0"

# A value that is a fraction of the keyframe image (0 at the left or top edge, 1 at the right or bottom).
Unit = Annotated[float, Field(ge=0, le=1)]

# Limits the server enforces. Keep in step with docs/data-contract.md.
MAX_KEYFRAMES_PER_REQUEST = 8
MAX_PLANES = 256
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_SIDE = 8192

ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$"
SCAN_ID_PATTERN = r"^scan_[0-9a-f]{32}$"
KEYFRAME_ID_PATTERN = r"^kf-[0-9]{4,}$"


class _Model(BaseModel):
    # Unknown fields are rejected so a typo in a client payload is an error,
    # not a silently dropped value.
    model_config = ConfigDict(extra="forbid")


class Vec3(_Model):
    x: float
    y: float
    z: float


class Quaternion(_Model):
    x: float
    y: float
    z: float
    w: float


class Pose(_Model):
    """A headset or plane pose in the WebXR local-floor frame: metres, Y up, right-handed."""

    frame: Literal["local-floor"] = "local-floor"
    position: Vec3
    quaternion: Quaternion


class Intrinsics(_Model):
    """Pinhole model of the passthrough camera, in pixels of the keyframe image."""

    fx: float = Field(gt=0)
    fy: float = Field(gt=0)
    cx: float
    cy: float


class Named(_Model):
    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)


class Floor(Named):
    level: int = 0


class Hierarchy(_Model):
    """PLACE, BUILDING, FLOOR and ROOM. The scan itself is the SCAN level."""

    place: Named
    building: Named
    floor: Floor
    room: Named


class Client(_Model):
    name: str = Field(default="companion-scan-quest", max_length=64)
    version: str = Field(default="1.0.0", max_length=32)
    device: str = Field(default="meta-quest-3", max_length=64)
    session_id: Optional[str] = Field(default=None, max_length=64)


class Extent2(_Model):
    """A size or centre on a plane, in plane-local metres (x and z; the plane normal is +y)."""

    x: float
    z: float


class Plane(_Model):
    id: str = Field(pattern=ID_PATTERN)
    label: str = Field(min_length=1, max_length=40)
    orientation: Optional[Literal["horizontal", "vertical"]] = None
    pose: Pose
    center: Extent2
    size: Extent2


class ImageIn(_Model):
    format: Literal["jpeg"] = "jpeg"
    width: int = Field(ge=1, le=MAX_IMAGE_SIDE)
    height: int = Field(ge=1, le=MAX_IMAGE_SIDE)
    # Base64 of the JPEG bytes, without a data-URL prefix.
    base64: str = Field(min_length=4)


class KeyframeIn(_Model):
    """One camera frame with the headset pose it was taken from (capture-time, not send-time)."""

    client_keyframe_id: Optional[str] = Field(default=None, max_length=64)
    captured_at_ms: Optional[int] = Field(default=None, ge=0)
    image: ImageIn
    pose: Pose
    intrinsics: Intrinsics


class ImageOut(_Model):
    format: Literal["jpeg"] = "jpeg"
    width: int
    height: int
    # Path of the stored file, relative to the scan's folder.
    file: str


class KeyframeOut(_Model):
    keyframe_id: str = Field(pattern=KEYFRAME_ID_PATTERN)
    client_keyframe_id: Optional[str] = None
    captured_at_ms: Optional[int] = None
    image: ImageOut
    pose: Pose
    intrinsics: Intrinsics
    detection_count: int = Field(ge=0)


class DetectorInfo(_Model):
    id: str
    version: str


class Detection(_Model):
    """One OBJECT: a labelled 2D box in one keyframe. Placed in the room by the headset."""

    detection_id: str
    keyframe_id: str = Field(pattern=KEYFRAME_ID_PATTERN)
    level: Literal["OBJECT"] = "OBJECT"
    label: str
    confidence: Unit
    # [cx, cy, w, h], each in 0..1 of the keyframe image, origin top-left.
    bbox_cxcywh: list[Unit] = Field(min_length=4, max_length=4)
    # Same as the bbox centre. Kept so the existing Quest placement code reads them unchanged.
    cx: Unit
    cy: Unit
    # Reserved for SAM 2 masks (a hook, not implemented in v1).
    mask: None = None
    detector: DetectorInfo


class ScanCreate(_Model):
    """Capture payload: the first request of a scan. Planes and keyframes may be empty."""

    hierarchy: Hierarchy
    client: Optional[Client] = None
    planes: list[Plane] = Field(default_factory=list, max_length=MAX_PLANES)
    keyframes: list[KeyframeIn] = Field(default_factory=list, max_length=MAX_KEYFRAMES_PER_REQUEST)


class KeyframesAppend(_Model):
    """Later captures of the same scan. `planes`, when present, replaces the stored planes."""

    keyframes: list[KeyframeIn] = Field(min_length=1, max_length=MAX_KEYFRAMES_PER_REQUEST)
    planes: Optional[list[Plane]] = Field(default=None, max_length=MAX_PLANES)


class CaptureResult(_Model):
    """What the server returns for a create or append: what this request added."""

    contract_version: str = CONTRACT_VERSION
    scan_id: str = Field(pattern=SCAN_ID_PATTERN)
    keyframes: list[KeyframeOut]
    detections: list[Detection]


class ScanRecord(_Model):
    """A stored scan, as GET /v1/scans/{scan_id} returns it."""

    contract_version: str = CONTRACT_VERSION
    scan_id: str = Field(pattern=SCAN_ID_PATTERN)
    created_at: str
    updated_at: str
    hierarchy: Hierarchy
    client: Optional[Client] = None
    planes: list[Plane]
    keyframes: list[KeyframeOut]
    detections: list[Detection]
    detector: Optional[DetectorInfo] = None


class ScanSummary(_Model):
    scan_id: str = Field(pattern=SCAN_ID_PATTERN)
    created_at: str
    room: str
    keyframe_count: int = Field(ge=0)
    detection_count: int = Field(ge=0)


# Models whose JSON Schemas are published under contracts/schemas/.
PUBLISHED_MODELS: dict[str, type[BaseModel]] = {
    "scan": ScanRecord,
    "keyframe": KeyframeIn,
    "detection": Detection,
    "plane": Plane,
    "hierarchy": Hierarchy,
    "capture-request": ScanCreate,
    "keyframes-append": KeyframesAppend,
    "capture-result": CaptureResult,
}
