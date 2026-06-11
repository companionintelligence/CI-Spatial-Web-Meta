/**
 * ScanStorage — persists the pin store to localStorage so a scan survives
 * page reloads and browser restarts on the headset.
 *
 * Coordinates: pins are stored with an anchor-local position (computed via
 * the scan root at save time). Restored pins keep that as their
 * authoritative position (`pin.anchorLocalPosition`) — paired with the
 * persistent WebXR anchor, this re-localizes the scan in the real room.
 * Their `worldPosition` is also set to the anchor-local value, which is
 * exact while the anchor sits at the original session origin and a
 * best-effort approximation otherwise.
 *
 * Geometry snapshots are NOT persisted (too large for localStorage); the
 * room geometry is re-captured on the next capture press.
 */

import { SpatialPin } from './SpatialPin.js';

export const SCAN_STORAGE_KEY = 'companion_scan_pins_v1';

/** Pin fields persisted verbatim. */
const PIN_FIELDS = [
  'id', 'source', 'label', 'worldRotation', 'confidence', 'bboxCxCyWH',
  'hitType', 'placementConfidence', 'trackId', 'captureFrameIndex',
  'captureId', 'captureSessionId', 'semanticLabels', 'planeExtents',
  'volumeExtents', 'maskRleJson', 'florenceCaption', 'createdAt',
];

export class ScanStorage {
  /**
   * @param {Storage} [storage] injectable for tests; defaults to localStorage
   */
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  /**
   * Persist all pins (anchor-local coordinates).
   * @param {import('./SpatialPinManager.js').SpatialPinManager} pinManager
   * @param {import('./ScanAnchorRoot.js').ScanAnchorRoot} scanRoot
   * @returns {number} number of pins saved
   */
  save(pinManager, scanRoot) {
    if (!this.storage) return 0;
    const pins = pinManager.pins.map(pin => {
      const record = {};
      for (const f of PIN_FIELDS) record[f] = pin[f];
      record.anchorLocalPosition =
        pin.anchorLocalPosition ?? scanRoot.worldToAnchorLocal(pin.worldPosition);
      return record;
    });

    try {
      this.storage.setItem(SCAN_STORAGE_KEY, JSON.stringify({
        version:  1,
        saved_at: Date.now(),
        pins,
      }));
    } catch (err) {
      // Quota exceeded (e.g. huge SAM2 masks) — drop the masks and retry once.
      try {
        for (const p of pins) p.maskRleJson = null;
        this.storage.setItem(SCAN_STORAGE_KEY, JSON.stringify({
          version: 1, saved_at: Date.now(), pins,
        }));
      } catch {
        console.warn('[ScanStorage] Save failed:', err);
        return 0;
      }
    }
    return pins.length;
  }

  /**
   * Restore pins into the pin manager.
   * @param {import('./SpatialPinManager.js').SpatialPinManager} pinManager
   * @returns {number} number of pins restored
   */
  restore(pinManager) {
    const data = this._read();
    if (!data?.pins?.length) return 0;

    let count = 0;
    for (const record of data.pins) {
      const pin = new SpatialPin();
      for (const f of PIN_FIELDS) {
        if (record[f] !== undefined) pin[f] = record[f];
      }
      pin.anchorLocalPosition = record.anchorLocalPosition ?? null;
      // Best-effort world position: exact while the anchor is at the origin
      // of the original session (see module docs).
      pin.worldPosition = record.anchorLocalPosition ?? { x: 0, y: 0, z: 0 };
      pinManager.addOrUpdate(pin);
      count++;
    }
    return count;
  }

  /** @returns {number|null} epoch ms of the stored scan, if any */
  savedAt() {
    return this._read()?.saved_at ?? null;
  }

  clear() {
    try {
      this.storage?.removeItem(SCAN_STORAGE_KEY);
    } catch { /* storage unavailable */ }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _read() {
    try {
      const raw = this.storage?.getItem(SCAN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[ScanStorage] Corrupt scan store, clearing:', err);
      this.clear();
      return null;
    }
  }
}
