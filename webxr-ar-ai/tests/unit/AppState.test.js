/**
 * Unit tests for AppState — singleton reactive state.
 *
 * Tests: cycle methods, subscriber notifications, label helpers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// AppState exports a singleton but also named constants.
// We import the module dynamically so we can reset the singleton between tests.
let appState, ModelPreset, DisplayMode, PreviewDistance;

// Re-import cleanly for each describe block by using dynamic import.
// Vitest isolates modules per file, so this is reliable.
beforeEach(async () => {
  // Reset module registry to get a fresh singleton each test.
  vi.resetModules();
  const mod = await import('../../src/app/AppState.js');
  appState       = mod.appState;
  ModelPreset    = mod.ModelPreset;
  DisplayMode    = mod.DisplayMode;
  PreviewDistance = mod.PreviewDistance;
});

describe('AppState — constants', () => {
  it('exports immutable ModelPreset enum', () => {
    expect(ModelPreset.Florence).toBe('Florence');
    expect(ModelPreset.GDino).toBe('GDino');
    expect(ModelPreset.SAM2).toBe('SAM2');
    expect(() => { ModelPreset.Florence = 'x'; }).toThrow();
  });

  it('exports immutable DisplayMode enum', () => {
    expect(DisplayMode.BoundingBox2D).toBe('BoundingBox2D');
    expect(DisplayMode.SpatialLabel3D).toBe('SpatialLabel3D');
    expect(DisplayMode.Both).toBe('Both');
    expect(() => { DisplayMode.Both = 'x'; }).toThrow();
  });

  it('exports immutable PreviewDistance enum', () => {
    expect(PreviewDistance.Near).toBe(1);
    expect(PreviewDistance.Far).toBe(3);
    expect(PreviewDistance.Off).toBe(0);
    expect(() => { PreviewDistance.Near = 99; }).toThrow();
  });
});

describe('AppState — initial state', () => {
  it('starts with Florence model preset', () => {
    expect(appState.modelPreset).toBe('Florence');
  });

  it('starts with Both display mode', () => {
    expect(appState.displayMode).toBe('Both');
  });

  it('starts with Near (1m) preview distance', () => {
    expect(appState.previewDistance).toBe(1);
  });

  it('starts not busy', () => {
    expect(appState.isBusy).toBe(false);
  });

  it('has a captureSessionId string', () => {
    expect(typeof appState.captureSessionId).toBe('string');
    expect(appState.captureSessionId.length).toBeGreaterThan(0);
  });
});

describe('AppState — cycleModel()', () => {
  it('cycles Florence → GDino → SAM2 → Florence', () => {
    expect(appState.modelPreset).toBe('Florence');

    appState.cycleModel();
    expect(appState.modelPreset).toBe('GDino');

    appState.cycleModel();
    expect(appState.modelPreset).toBe('SAM2');

    appState.cycleModel();
    expect(appState.modelPreset).toBe('Florence');
  });

  it('returns the new preset value', () => {
    const result = appState.cycleModel();
    expect(result).toBe('GDino');
  });
});

describe('AppState — cycleDisplayMode()', () => {
  it('cycles BoundingBox2D → SpatialLabel3D → Both → BoundingBox2D', () => {
    // Starts at Both
    appState.cycleDisplayMode(); // Both → BoundingBox2D
    expect(appState.displayMode).toBe('BoundingBox2D');

    appState.cycleDisplayMode(); // BoundingBox2D → SpatialLabel3D
    expect(appState.displayMode).toBe('SpatialLabel3D');

    appState.cycleDisplayMode(); // SpatialLabel3D → Both
    expect(appState.displayMode).toBe('Both');

    appState.cycleDisplayMode(); // Both → BoundingBox2D
    expect(appState.displayMode).toBe('BoundingBox2D');
  });

  it('returns the new display mode', () => {
    const result = appState.cycleDisplayMode();
    expect(result).toBe('BoundingBox2D');
  });
});

describe('AppState — cyclePreviewDistance()', () => {
  it('cycles Near → Far → Off → Near', () => {
    // Starts at Near (1)
    appState.cyclePreviewDistance();
    expect(appState.previewDistance).toBe(3); // Far

    appState.cyclePreviewDistance();
    expect(appState.previewDistance).toBe(0); // Off

    appState.cyclePreviewDistance();
    expect(appState.previewDistance).toBe(1); // Near again
  });

  it('returns the new preview distance value', () => {
    const result = appState.cyclePreviewDistance();
    expect(result).toBe(3);
  });
});

describe('AppState — setBusy()', () => {
  it('sets isBusy to true', () => {
    appState.setBusy(true);
    expect(appState.isBusy).toBe(true);
  });

  it('sets isBusy to false', () => {
    appState.setBusy(true);
    appState.setBusy(false);
    expect(appState.isBusy).toBe(false);
  });
});

describe('AppState — subscribe()', () => {
  it('notifies subscriber with field name and state on cycleModel', () => {
    const calls = [];
    appState.subscribe((field, state) => calls.push({ field, state }));
    appState.cycleModel();
    expect(calls).toHaveLength(1);
    expect(calls[0].field).toBe('modelPreset');
    expect(calls[0].state).toBe(appState);
  });

  it('notifies subscriber on cycleDisplayMode', () => {
    const fields = [];
    appState.subscribe((f) => fields.push(f));
    appState.cycleDisplayMode();
    expect(fields).toContain('displayMode');
  });

  it('notifies subscriber on cyclePreviewDistance', () => {
    const fields = [];
    appState.subscribe((f) => fields.push(f));
    appState.cyclePreviewDistance();
    expect(fields).toContain('previewDistance');
  });

  it('notifies subscriber on setBusy', () => {
    const fields = [];
    appState.subscribe((f) => fields.push(f));
    appState.setBusy(true);
    expect(fields).toContain('isBusy');
  });

  it('can have multiple subscribers all called', () => {
    const a = vi.fn(), b = vi.fn();
    appState.subscribe(a);
    appState.subscribe(b);
    appState.cycleModel();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops notifications', () => {
    const calls = [];
    const unsub = appState.subscribe((f) => calls.push(f));
    appState.cycleModel(); // received
    unsub();
    appState.cycleModel(); // NOT received
    expect(calls).toHaveLength(1);
  });
});

describe('AppState — previewDistanceLabel()', () => {
  it('returns "Near (1m)" when previewDistance is Near', () => {
    // Starts at Near
    expect(appState.previewDistanceLabel()).toBe('Near (1m)');
  });

  it('returns "Far (3m)" when previewDistance is Far', () => {
    appState.cyclePreviewDistance(); // Near → Far
    expect(appState.previewDistanceLabel()).toBe('Far (3m)');
  });

  it('returns "Off" when previewDistance is Off', () => {
    appState.cyclePreviewDistance(); // Near → Far
    appState.cyclePreviewDistance(); // Far → Off
    expect(appState.previewDistanceLabel()).toBe('Off');
  });

  it('returns "Unknown" for unexpected value (robustness)', () => {
    // Inject unexpected value directly
    appState.previewDistance = 999;
    expect(appState.previewDistanceLabel()).toBe('Unknown');
  });
});

describe('AppState — status line', () => {
  it('starts with an empty info status', () => {
    expect(appState.status).toEqual({ text: '', level: 'info', at: 0 });
  });

  it('setStatus updates text, level, and timestamp', () => {
    appState.setStatus('12 detections', 'ok');
    expect(appState.status.text).toBe('12 detections');
    expect(appState.status.level).toBe('ok');
    expect(appState.status.at).toBeGreaterThan(0);
  });

  it('setStatus defaults to info level and notifies subscribers', () => {
    const fn = vi.fn();
    appState.subscribe(fn);
    appState.setStatus('hello');
    expect(appState.status.level).toBe('info');
    expect(fn).toHaveBeenCalledWith('status', appState);
  });
});
