/**
 * AppState — singleton reactive state shared across all systems.
 *
 * Model preset: which AI models run on each capture. `Local` posts the keyframe to
 * the local scan API (/v1/scans) and is the default.
 * Display mode: what spatial visualisation is shown.
 * Preview distance: fallback raycast depth.
 * Camera: whether the camera is on for this headset session (off by default).
 * Planes: the room's planes as of the last refresh. Scan: the last scan's id and count.
 */

export const ModelPreset = Object.freeze({
  Local:    'Local',
  Florence: 'Florence',
  GDino:    'GDino',
  SAM2:     'SAM2',
});

export const DisplayMode = Object.freeze({
  BoundingBox2D:  'BoundingBox2D',
  SpatialLabel3D: 'SpatialLabel3D',
  Both:           'Both',
});

export const PreviewDistance = Object.freeze({
  Near: 1,   // metres
  Far:  3,
  Off:  0,
});

const MODEL_CYCLE  = [ModelPreset.Local, ModelPreset.Florence, ModelPreset.GDino, ModelPreset.SAM2];
const DISPLAY_CYCLE = [
  DisplayMode.BoundingBox2D,
  DisplayMode.SpatialLabel3D,
  DisplayMode.Both,
];
const PREVIEW_CYCLE = [
  PreviewDistance.Near,
  PreviewDistance.Far,
  PreviewDistance.Off,
];

class AppState {
  constructor() {
    /** Model ids available for cycling; replaced by the server registry at boot. */
    this.models          = [...MODEL_CYCLE];
    this.modelPreset     = ModelPreset.Local;
    this.displayMode     = DisplayMode.Both;
    this.previewDistance = PreviewDistance.Near;
    this.isBusy          = false;
    this.captureSessionId = crypto.randomUUID?.() ?? String(Date.now());
    /** Camera opt-in for this headset session. Never persisted (src/privacy/capturePolicy.js). */
    this.cameraOn = false;
    /** @type {Array<object>} contract Plane records for the room, largest first */
    this.planes = [];
    /** @type {{id: string, detections: number}|null} the scan this session files into */
    this.scan = null;
    /** @type {{text: string, level: 'info'|'ok'|'warn'|'error', at: number}} */
    this.status = { text: '', level: 'info', at: 0 };
    /** @type {Set<Function>} */
    this._listeners = new Set();
  }

  /** @param {boolean} on */
  setCameraOn(on) {
    this.cameraOn = Boolean(on);
    this._notify('cameraOn');
  }

  /** @param {Array<object>} planes */
  setPlanes(planes) {
    this.planes = Array.isArray(planes) ? planes : [];
    this._notify('planes');
  }

  /** @param {{id: string, detections: number}|null} scan */
  setScan(scan) {
    this.scan = scan ?? null;
    this._notify('scan');
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify(field) {
    this._listeners.forEach(fn => fn(field, this));
  }

  cycleModel() {
    const i = this.models.indexOf(this.modelPreset);
    this.modelPreset = this.models[(i + 1) % this.models.length];
    this._notify('modelPreset');
    return this.modelPreset;
  }

  /**
   * Replace the cycling model list with the server's registry (boot-time).
   * Ignored when empty so an unreachable server keeps the static defaults.
   * @param {string[]} ids
   */
  setModels(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    this.models = [...ids];
    if (!this.models.includes(this.modelPreset)) this.modelPreset = this.models[0];
    this._notify('models');
  }

  cycleDisplayMode() {
    const i = DISPLAY_CYCLE.indexOf(this.displayMode);
    this.displayMode = DISPLAY_CYCLE[(i + 1) % DISPLAY_CYCLE.length];
    this._notify('displayMode');
    return this.displayMode;
  }

  cyclePreviewDistance() {
    const i = PREVIEW_CYCLE.indexOf(this.previewDistance);
    this.previewDistance = PREVIEW_CYCLE[(i + 1) % PREVIEW_CYCLE.length];
    this._notify('previewDistance');
    return this.previewDistance;
  }

  setBusy(val) {
    this.isBusy = val;
    this._notify('isBusy');
  }

  /**
   * Set the user-facing status line (shown on the WristHUD and the desktop
   * overlay).
   * @param {string} text
   * @param {'info'|'ok'|'warn'|'error'} [level='info']
   */
  setStatus(text, level = 'info') {
    this.status = { text, level, at: Date.now() };
    this._notify('status');
  }

  previewDistanceLabel() {
    switch (this.previewDistance) {
      case PreviewDistance.Near: return 'Near (1m)';
      case PreviewDistance.Far:  return 'Far (3m)';
      case PreviewDistance.Off:  return 'Off';
      default: return 'Unknown';
    }
  }
}

export const appState = new AppState();
