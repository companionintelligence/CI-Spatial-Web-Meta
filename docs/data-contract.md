# Local scan data contract (v1)

The headset captures a room and posts it to a scan server on the same network. This
document is the contract for that exchange: the scan, the keyframe, the detection
(the OBJECT level), and the planes and hierarchy they sit in. It is version `1.0`.

The machine-readable copies are in [`contracts/`](../contracts/):

| File | What it is |
|---|---|
| `contracts/schemas/*.schema.json` | JSON Schema for each entity and request, generated from the models |
| `contracts/examples/capture-request.v1.json` | A worked capture payload (one kitchen, two planes, one keyframe) |
| `contracts/examples/capture-result.v1.json` | What the server returns for that payload with the stub detector |

The server's models are the source of truth: [`cv-server/localscan/contract.py`](../cv-server/localscan/contract.py).
Change them, then run `python cv-server/scripts/export_contract.py`. A test fails when the
committed schemas drift from the models.

## Hierarchy

Scans are filed under the Companion Scan hierarchy, with the same names, so a later
sync to the Companion Scan server is a mapping and not a rewrite:

```
PLACE > BUILDING > FLOOR > ROOM > SCAN > OBJECT
```

| Level | Field | Required | Example |
|---|---|---|---|
| PLACE | `hierarchy.place` `{id, name}` | yes | `Home` |
| BUILDING | `hierarchy.building` `{id, name}` | yes | `Main house` |
| FLOOR | `hierarchy.floor` `{id, name, level}` | yes | `Ground floor`, level `0` |
| ROOM | `hierarchy.room` `{id, name}` | yes | `Kitchen` |
| SCAN | `scan_id`, `created_at`, `keyframes[]`, `planes[]` | created by the server | `scan_0f3c…` |
| OBJECT | `detections[]` (one per detected object) | created by the server | `kf-0001-d01` |

v1 uses fixed defaults for PLACE, BUILDING and FLOOR, and the room name is set on the
desktop overlay. The ids are server-safe slugs, for example `room-kitchen`.

## Conventions

- **Units.** Metres, radians, seconds only where a name says `_ms` (milliseconds).
- **Frame.** Every pose and plane is in the WebXR `local-floor` frame: origin on the floor
  under the headset at session start, Y up, right-handed. Poses are `{frame, position,
  quaternion}` with `frame` fixed to `"local-floor"`.
- **Image.** A keyframe is one JPEG, sent as base64 with no data-URL prefix. The server
  checks the JPEG bytes and the declared width and height.
- **Boxes.** `bbox_cxcywh` is `[cx, cy, w, h]`, each a fraction (0 to 1) of the keyframe
  image, origin top-left. `cx` and `cy` repeat the box centre.
- **Identifiers.** Hierarchy ids match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`. Scan ids are
  `scan_` plus 32 lowercase hex digits, and the server issues them. Keyframe ids are
  `kf-NNNN` and detection ids `kf-NNNN-dNN`, both issued by the server in order.
- **Unknown fields are refused.** A typo in a payload is an error (422), not a silently
  dropped value.
- **Limits** (enforced by the server, mirrored by the client):

| Limit | Value |
|---|---|
| Keyframes per request | 8 |
| Planes per request | 256 |
| Image size | 8 MB after base64 decoding |
| Image side | 8192 px |
| Room name | 120 characters |

## Entities

### Hierarchy

```json
{
  "place":    { "id": "place-home", "name": "Home" },
  "building": { "id": "building-main", "name": "Main house" },
  "floor":    { "id": "floor-ground", "name": "Ground floor", "level": 0 },
  "room":     { "id": "room-kitchen", "name": "Kitchen" }
}
```

### Client

Who sent the scan, and from which headset session. Optional.

| Field | Notes |
|---|---|
| `name` | `companion-scan-quest` |
| `version` | the app version |
| `device` | `meta-quest-3` |
| `session_id` | the headset session (a UUID), used to tell sessions apart |

### Plane

A surface the headset's scene understanding found: a floor, a wall, a table top.

| Field | Notes |
|---|---|
| `id` | stable for the surface within the headset session (`plane-N`) |
| `label` | the semantic label (`floor`, `wall`, `table`, ...) or the orientation |
| `orientation` | `horizontal`, `vertical`, or null |
| `pose` | the plane's pose in `local-floor` |
| `center` | `{x, z}` of the plane's bounds, in plane-local metres |
| `size` | `{x, z}` of the plane's bounds, in plane-local metres (its extent) |

### Keyframe

One camera frame and the pose it was taken from, at capture time (not when it was sent).

| Field | Notes |
|---|---|
| `client_keyframe_id` | the headset's id for the capture, echoed back |
| `captured_at_ms` | the headset clock, in milliseconds |
| `image` | `{format: "jpeg", width, height, base64}` on the way in; `{format, width, height, file}` when stored |
| `pose` | the headset pose at capture |
| `intrinsics` | pinhole model of the passthrough camera, in image pixels: `{fx, fy, cx, cy}` |

The headset derives `fx` and `fy` from the camera's horizontal field of view (80 degrees
by default, calibrated per device). Pixels are square, so `fy` equals `fx`.

The server returns a keyframe with its `keyframe_id`, its stored `file`
(`keyframes/kf-NNNN.jpg`, relative to the scan's folder), and `detection_count`.

### Detection (OBJECT)

A labelled box in one keyframe. The headset places it in the room with a ray from the
keyframe's pose and a raycast against the planes.

| Field | Notes |
|---|---|
| `detection_id` | `kf-NNNN-dNN` |
| `keyframe_id` | the keyframe it was found in |
| `level` | `OBJECT` |
| `label` | the detector's label |
| `confidence` | 0 to 1 |
| `bbox_cxcywh`, `cx`, `cy` | see Conventions |
| `mask` | reserved for SAM 2 masks; always `null` in v1 |
| `detector` | `{id, version}`: `stub` or `groundingdino`, so a placeholder is never mistaken for a real result |

### Scan (stored record)

`GET /v1/scans/{scan_id}` returns the whole record:

| Field | Notes |
|---|---|
| `contract_version` | `"1.0"` |
| `scan_id` | server-issued |
| `created_at`, `updated_at` | server time, UTC, ISO 8601 |
| `hierarchy` | the Hierarchy above |
| `client` | the Client above, or null |
| `planes` | the latest planes (replaced on each capture that sends them) |
| `keyframes` | every keyframe, in order |
| `detections` | every OBJECT, in order |
| `detector` | the detector used for the latest keyframe, or null |

On disk, the server stores `<CV_DATA_DIR>/scans/<scan_id>/scan.json` and
`<CV_DATA_DIR>/scans/<scan_id>/keyframes/kf-NNNN.jpg`. Nothing is kept outside that folder.

## Requests

| Method and path | Body | Returns |
|---|---|---|
| `POST /v1/scans` | capture payload: `hierarchy`, `client`, `planes`, `keyframes` | `201` with a `CaptureResult` (the new keyframes and detections, and the `scan_id`) |
| `POST /v1/scans/{scan_id}/keyframes` | `keyframes` (1 to 8), and `planes` (replaces the stored planes when present) | `200` with a `CaptureResult` for the keyframes added |
| `GET /v1/scans/{scan_id}` | none | the stored Scan record |
| `GET /v1/scans` | none | summaries, newest first: `scan_id`, `created_at`, `room`, counts |
| `GET /v1/health` | none | includes `local_detector` (`stub` or `groundingdino`) |

Errors: `404` for an unknown scan (the headset then starts a new one), `413` for an
image over 8 MB, `422` for a payload that does not match the contract (a bad base64,
a non-JPEG image, or a declared size that differs from the image), `503` when the
configured detector cannot run (for example GroundingDINO is not installed), with the
reason in `detail`.

## Worked example

`contracts/examples/capture-request.v1.json` is a capture of one kitchen with a floor and a
wall, and `contracts/examples/capture-result.v1.json` is the server's answer to it with the
stub detector. The test suite checks that the server reproduces the result exactly.

## Privacy

- A scan leaves the headset only for a server on the same network: loopback, a private
  (RFC 1918 or unique-local) address, a link-local address, or a `.local` name. The headset
  refuses any other host before it sends anything.
- The camera is off until someone turns it on in the session. While it is on, the headset
  shows a red REC line. Turning it off, or leaving AR, stops the stream.
- The server makes no outbound connections, and the stub detector needs no model. A test
  checks both.

## Mapping to Companion Scan

The product model (`docs/product/PLACE_SCAN_DESIGN.md` in Companion-Scan) names the same
things differently. The mapping for a later sync:

| This contract | Companion Scan | Notes |
|---|---|---|
| PLACE | Place (`projectId` in storage) | the site: home, store, workshop |
| BUILDING, FLOOR, ROOM | Areas (`areaId`) in the Place's Area tree, or the Place hierarchy (Building, Floor, Room) | the Place hierarchy links separately managed Places; Areas split one Place into regions |
| SCAN | Scan (`scanId`) within a Scan session (`sessionId`) | one headset session makes one scan |
| keyframe | a scanned image with its pose (the "Scanned images" layer) | the stored JPEG and `pose` carry over |
| plane | a ground plane or surface in the scan | the `pose` and `size` are local metres |
| OBJECT (detection) | an Observation (one immutable sighting) | a Thing is inferred later from several observations |

## Compatibility

- A `1.x` change adds optional fields only. A client or server that reads `1.0` must
  ignore fields it does not know. Note that the server refuses unknown fields in requests,
  so a new client must send only what the server version accepts.
- Any other change bumps `contract_version`, and the server answers requests for the
  version it knows.
