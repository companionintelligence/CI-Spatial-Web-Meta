/**
 * Builders for the v1 local-scan contract (docs/data-contract.md, contracts/).
 *
 * They return plain JSON-ready objects with the field names the server expects.
 * Units are metres and radians, poses are in the WebXR local-floor frame (Y up,
 * right-handed), and the image is a base64 JPEG without a data-URL prefix.
 */

export const CONTRACT_VERSION = '1.0';
export const CLIENT_NAME = 'companion-scan-quest';
export const CLIENT_VERSION = '1.0.0';
export const CLIENT_DEVICE = 'meta-quest-3';

/** The server's per-request limits. Keep in step with cv-server/localscan/contract.py. */
export const CAPTURE_LIMITS = Object.freeze({ maxKeyframesPerRequest: 8, maxPlanes: 256 });

const finiteOr = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const round = (value, digits = 4) => {
  const scale = 10 ** digits;
  return Math.round(finiteOr(value) * scale) / scale;
};

/** @param {{x:number,y:number,z:number}} v */
export function vec3Record(v) {
  return { x: round(v?.x), y: round(v?.y), z: round(v?.z) };
}

/** @param {{x:number,y:number,z:number,w:number}} q */
export function quatRecord(q) {
  return { x: round(q?.x), y: round(q?.y), z: round(q?.z), w: round(q?.w) };
}

/**
 * A pose in the local-floor frame.
 * @returns {{frame: 'local-floor', position: object, quaternion: object}}
 */
export function poseRecord(position, quaternion) {
  return { frame: 'local-floor', position: vec3Record(position), quaternion: quatRecord(quaternion) };
}

/**
 * Pinhole intrinsics for a keyframe, from the camera's horizontal FOV (radians).
 * Pixels are square, so fy equals fx.
 * @returns {{fx: number, fy: number, cx: number, cy: number}}
 */
export function intrinsicsFor({ width, height, hfovRad }) {
  const tan = Math.tan(hfovRad / 2);
  if (!(tan > 0)) throw new Error('The camera horizontal FOV must be positive.');
  const fx = round((width / 2) / tan, 2);
  return { fx, fy: fx, cx: round(width / 2, 2), cy: round(height / 2, 2) };
}

/** @returns {{name: string, version: string, device: string, session_id: string|null}} */
export function clientRecord({ sessionId = null } = {}) {
  return {
    name: CLIENT_NAME,
    version: CLIENT_VERSION,
    device: CLIENT_DEVICE,
    session_id: sessionId ? String(sessionId).slice(0, 64) : null,
  };
}

/**
 * One keyframe: the frame, the pose it was taken from (capture time), and the intrinsics.
 * @returns {object} contract KeyframeIn
 */
export function buildKeyframe({
  clientKeyframeId = null,
  capturedAtMs = null,
  width,
  height,
  base64,
  position,
  quaternion,
  hfovRad,
}) {
  return {
    client_keyframe_id: clientKeyframeId,
    captured_at_ms: Number.isFinite(capturedAtMs) ? Math.round(capturedAtMs) : null,
    image: { format: 'jpeg', width, height, base64 },
    pose: poseRecord(position, quaternion),
    intrinsics: intrinsicsFor({ width, height, hfovRad }),
  };
}

/**
 * The first request of a scan.
 * @returns {object} contract ScanCreate
 */
export function buildCapturePayload({ hierarchy, client, planes = [], keyframes = [] }) {
  return { hierarchy, client, planes, keyframes };
}

/**
 * A later capture of the same scan. The planes replace the stored planes.
 * @returns {object} contract KeyframesAppend
 */
export function buildAppendPayload({ keyframes, planes }) {
  return { keyframes, planes };
}
