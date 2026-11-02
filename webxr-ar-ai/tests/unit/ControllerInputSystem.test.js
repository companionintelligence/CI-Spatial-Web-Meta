/**
 * Unit tests for ControllerInputSystem — maps Quest controller buttons to app
 * actions, as documented in the README's controller button map.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@iwsdk/core', () => ({
  // The IWSDK base system is a class the app extends; a plain class is enough here.
  createSystem: () => class {},
  InputComponent: {
    A_Button: 'a-button',
    B_Button: 'b-button',
    X_Button: 'x-button',
    Y_Button: 'y-button',
    Trigger:  'trigger',
  },
}));

const { ControllerInputSystem } = await import('../../src/input/ControllerInputSystem.js');
const { appState, ModelPreset, PreviewDistance, DisplayMode } = await import('../../src/app/AppState.js');

/** A gamepad whose listed buttons were pressed this frame. */
const pad = (...pressed) => ({ getButtonDown: (id) => pressed.includes(id) });

function systemWith({ right, left } = {}) {
  const system = new ControllerInputSystem();
  system.init();
  system.input = { gamepads: { right, left } };
  return system;
}

let handlers;

beforeEach(() => {
  handlers = { capture: vi.fn(), export: vi.fn() };
  appState.modelPreset     = ModelPreset.Florence;
  appState.previewDistance = PreviewDistance.Near;
  appState.displayMode     = DisplayMode.Both;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ControllerInputSystem', () => {
  it('captures on Right A', () => {
    const system = systemWith({ right: pad('a-button') });
    system.setHandlers(handlers);
    system.update();
    expect(handlers.capture).toHaveBeenCalledTimes(1);
    expect(handlers.export).not.toHaveBeenCalled();
  });

  it('exports on Left Y', () => {
    const system = systemWith({ left: pad('y-button') });
    system.setHandlers(handlers);
    system.update();
    expect(handlers.export).toHaveBeenCalledTimes(1);
    expect(handlers.capture).not.toHaveBeenCalled();
  });

  it('cycles the CV model on Right B', () => {
    const system = systemWith({ right: pad('b-button') });
    system.setHandlers(handlers);
    system.update();
    expect(appState.modelPreset).not.toBe(ModelPreset.Florence);
  });

  it('cycles the preview distance on Left X', () => {
    const system = systemWith({ left: pad('x-button') });
    system.setHandlers(handlers);
    system.update();
    expect(appState.previewDistance).toBe(PreviewDistance.Far);
  });

  it('cycles the display mode on either trigger', () => {
    for (const hand of ['right', 'left']) {
      appState.displayMode = DisplayMode.BoundingBox2D;
      const system = systemWith({ [hand]: pad('trigger') });
      system.setHandlers(handlers);
      system.update();
      expect(appState.displayMode).toBe(DisplayMode.SpatialLabel3D);
    }
  });

  it('does nothing when no controller is connected', () => {
    const system = systemWith({});
    system.setHandlers(handlers);
    expect(() => system.update()).not.toThrow();
    expect(handlers.capture).not.toHaveBeenCalled();
    expect(handlers.export).not.toHaveBeenCalled();
  });

  it('ignores button presses before handlers are wired', () => {
    const system = systemWith({ right: pad('a-button') });
    expect(() => system.update()).not.toThrow();
  });
});
