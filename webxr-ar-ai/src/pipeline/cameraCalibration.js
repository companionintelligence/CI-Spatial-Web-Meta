/**
 * Camera calibration — the passthrough camera's horizontal field of view.
 *
 * The browser exposes no intrinsics for the Quest passthrough camera, so the
 * pinhole model in PipelineB needs an HFOV. Resolution order:
 *
 *   1. `?hfov=<degrees>` in the URL — one-off tests and shared links
 *   2. the value saved on this device (localStorage, set from the overlay)
 *   3. DEFAULT_CAMERA_HFOV_DEG
 *
 * Values outside (HFOV_MIN_DEG, HFOV_MAX_DEG) are ignored. The saved value is
 * per device because the camera differs between headsets.
 */

export const DEFAULT_CAMERA_HFOV_DEG = 80;
export const HFOV_MIN_DEG = 20;
export const HFOV_MAX_DEG = 160;
export const LS_CAMERA_HFOV = 'companionScan.cameraHfovDeg';

/**
 * localStorage, or null where storage is unavailable (Node, sandboxed frames).
 * @returns {Storage | null}
 */
export function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {number|null} the value as degrees if it is a usable HFOV, else null
 */
export function parseHfovDeg(value) {
  if (value === null || value === undefined || value === '') return null;
  const deg = Number(value);
  return Number.isFinite(deg) && deg > HFOV_MIN_DEG && deg < HFOV_MAX_DEG ? deg : null;
}

/**
 * @param {{ search?: string, storage?: Storage | null }} [opts]
 * @returns {{ deg: number, source: 'url' | 'saved' | 'default' }}
 */
export function resolveCameraHfov({ search = '', storage = null } = {}) {
  const fromUrl = parseHfovDeg(new URLSearchParams(search).get('hfov'));
  if (fromUrl !== null) return { deg: fromUrl, source: 'url' };

  const fromStorage = parseHfovDeg(readSaved(storage));
  if (fromStorage !== null) return { deg: fromStorage, source: 'saved' };

  return { deg: DEFAULT_CAMERA_HFOV_DEG, source: 'default' };
}

/**
 * Save an HFOV for this device.
 * @param {number} deg
 * @param {Storage | null} storage
 * @returns {number} the saved value
 * @throws {RangeError} when deg is outside the accepted range
 */
export function saveCameraHfov(deg, storage) {
  const valid = parseHfovDeg(deg);
  if (valid === null) {
    throw new RangeError(`Camera FOV must be more than ${HFOV_MIN_DEG} and less than ${HFOV_MAX_DEG} degrees`);
  }
  storage?.setItem(LS_CAMERA_HFOV, String(valid));
  return valid;
}

/** Forget the saved HFOV so the default (or URL override) applies again. */
export function clearCameraHfov(storage) {
  try {
    storage?.removeItem(LS_CAMERA_HFOV);
  } catch { /* storage unavailable */ }
}

function readSaved(storage) {
  try {
    return storage?.getItem(LS_CAMERA_HFOV) ?? null;
  } catch {
    return null;
  }
}
