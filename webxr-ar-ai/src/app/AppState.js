/**
 * AppState — singleton reactive state shared across all systems.
 *
 * Model preset: which AI models run on each capture.
 * Display mode: what spatial visualisation is shown.
 * Preview distance: fallback raycast depth.
 */

export const ModelPreset = Object.freeze({
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

const MODEL_CYCLE  = [ModelPreset.Florence, ModelPreset.GDino, ModelPreset.SAM2];
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
    this.modelPreset     = ModelPreset.Florence;
    this.displayMode     = DisplayMode.Both;
    this.previewDistance = PreviewDistance.Near;
    this.isBusy          = false;
    this.captureSessionId = crypto.randomUUID?.() ?? String(Date.now());
    /** @type {Set<Function>} */
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify(field) {
    this._listeners.forEach(fn => fn(field, this));
  }

  cycleModel() {
    const i = MODEL_CYCLE.indexOf(this.modelPreset);
    this.modelPreset = MODEL_CYCLE[(i + 1) % MODEL_CYCLE.length];
    this._notify('modelPreset');
    return this.modelPreset;
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

  previewDistanceLabel() {
    switch (this.previewDistance) {
      case PreviewDistance.Near: return 'Near (1m)';
      case PreviewDistance.Far:  return 'Far (3m)';
      case PreviewDistance.Off:  return 'Off';
    }
  }
}

export const appState = new AppState();
