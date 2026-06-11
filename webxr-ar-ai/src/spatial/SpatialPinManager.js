/**
 * SpatialPinManager — unified store for pins from both pipelines.
 *
 * Events: 'add', 'update', 'remove', 'clear'
 */

import { PinSource } from './SpatialPin.js';

export class SpatialPinManager extends EventTarget {
  constructor({ mergeByTrackId = true, stalePinAgeMs = 0 } = {}) {
    super();
    /** @type {Map<string, import('./SpatialPin.js').SpatialPin>} */
    this._pins = new Map();
    /** @type {Map<string, import('./SpatialPin.js').SpatialPin>} `${source}:${trackId}` → pin */
    this._byTrack = new Map();
    this.mergeByTrackId = mergeByTrackId;
    this.stalePinAgeMs = stalePinAgeMs;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  get pins() { return [...this._pins.values()]; }

  bySource(source) {
    return this.pins.filter(p => p.source === source);
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Add a new pin or update an existing one if mergeByTrackId is enabled
   * and a pin with the same source + trackId already exists.
   * @param {import('./SpatialPin.js').SpatialPin} pin
   */
  addOrUpdate(pin) {
    if (!pin) return;

    if (this.mergeByTrackId && pin.trackId) {
      const existing = this._byTrack.get(`${pin.source}:${pin.trackId}`);
      if (existing) {
        Object.assign(existing, {
          worldPosition:       pin.worldPosition,
          worldRotation:       pin.worldRotation,
          confidence:          pin.confidence,
          bboxCxCyWH:         pin.bboxCxCyWH,
          hitType:             pin.hitType,
          placementConfidence: pin.placementConfidence,
          florenceCaption:     pin.florenceCaption ?? existing.florenceCaption,
          maskRleJson:         pin.maskRleJson     ?? existing.maskRleJson,
        });
        this.dispatchEvent(Object.assign(new Event('update'), { pin: existing }));
        return existing;
      }
    }

    this._pins.set(pin.id, pin);
    if (pin.trackId) this._byTrack.set(`${pin.source}:${pin.trackId}`, pin);
    this.dispatchEvent(Object.assign(new Event('add'), { pin }));
    return pin;
  }

  remove(pinId) {
    const pin = this._pins.get(pinId);
    if (!pin) return false;
    this._pins.delete(pinId);
    if (pin.trackId) this._byTrack.delete(`${pin.source}:${pin.trackId}`);
    this.dispatchEvent(Object.assign(new Event('remove'), { pinId }));
    return true;
  }

  clearSource(source) {
    for (const [id, pin] of this._pins) {
      if (pin.source === source) {
        this._pins.delete(id);
        if (pin.trackId) this._byTrack.delete(`${pin.source}:${pin.trackId}`);
        this.dispatchEvent(Object.assign(new Event('remove'), { pinId: id }));
      }
    }
  }

  clearAll() {
    this._pins.clear();
    this._byTrack.clear();
    this.dispatchEvent(new Event('clear'));
  }

  // ── Stale pruning (call each frame / on interval) ─────────────────────────

  pruneStale() {
    if (!this.stalePinAgeMs) return;
    const cutoff = Date.now() - this.stalePinAgeMs;
    for (const [id, pin] of this._pins) {
      if (pin.createdAt < cutoff) this.remove(id);
    }
  }
}
