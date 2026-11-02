/**
 * Unit tests for WristHUD — the status panel on the left wrist. Its canvas is a
 * recording stand-in, so the tests check what the panel paints: the canon ink
 * for each row, the canon colour for each status level, and the BUSY state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { fakeCanvas } from './helpers/fakeCanvas.js';
import { appState } from '../../src/app/AppState.js';
import { WristHUD } from '../../src/ui/WristHUD.js';
import { SpatialPin, PinSource } from '../../src/spatial/SpatialPin.js';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { FONT_STACK, XR_SCHEME, canonColor } from '../../src/ui/theme.js';

let canvas;

beforeEach(() => {
  canvas = fakeCanvas();
  vi.stubGlobal('document', { createElement: (tag) => (tag === 'canvas' ? canvas : null) });
  appState.setBusy(false);
  appState.setStatus('', 'info');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A world whose left grip space exists, as it does once the session has started. */
function worldWithLeftGrip() {
  const grip = new THREE.Object3D();
  return { world: { input: { xrOrigin: { gripSpaces: { left: grip } } } }, grip };
}

function attachedHud(pinManager = new SpatialPinManager()) {
  const { world, grip } = worldWithLeftGrip();
  const hud = new WristHUD(world, pinManager);
  hud.init();
  return { hud, grip };
}

describe('WristHUD attachment', () => {
  it('waits until the left grip space exists, then attaches exactly once', () => {
    const waiting = new WristHUD({ input: { xrOrigin: { gripSpaces: {} } } }, new SpatialPinManager());
    expect(waiting.init()).toBe(false);

    const { world, grip } = worldWithLeftGrip();
    const hud = new WristHUD(world, new SpatialPinManager());
    expect(hud.init()).toBe(true);
    expect(hud.init()).toBe(true);
    expect(grip.children).toHaveLength(1);
  });
});

describe('WristHUD painting', () => {
  it('draws each setting label in the muted canon ink and each value in the foreground', () => {
    attachedHud();

    const label = canvas.draws.find(d => d.text === 'Model:');
    const value = canvas.draws.find(d => d.text === appState.modelPreset);
    expect(label.fillStyle).toBe(canonColor('muted-foreground', XR_SCHEME));
    expect(value.fillStyle).toBe(canonColor('foreground', XR_SCHEME));
  });

  it('sets its type in the canon face', () => {
    attachedHud();
    const label = canvas.draws.find(d => d.text === 'Model:');
    expect(label.font).toBe(`700 28px ${FONT_STACK}`);
    expect(label.font).toContain('Manrope');
  });

  it('summarises the pins from the pin store', () => {
    const pins = new SpatialPinManager();
    const pin = new SpatialPin();
    pin.source = PinSource.CvServer;
    pins.addOrUpdate(pin);

    attachedHud(pins);

    expect(canvas.draws.some(d => d.text === '1 cv · 0 scene')).toBe(true);
  });

  it('colours the status line by level from the canon', () => {
    const { hud } = attachedHud();
    canvas.draws.length = 0;

    appState.setStatus('Exported companion-scan.glb', 'ok');
    hud.update();

    const line = canvas.draws.find(d => d.text.startsWith('Exported'));
    expect(line.fillStyle).toBe(canonColor('success', XR_SCHEME));
  });

  it('uses the canon warning and destructive colours for warn and error', () => {
    const { hud } = attachedHud();

    canvas.draws.length = 0;
    appState.setStatus('Scene pins only', 'warn');
    hud.update();
    expect(canvas.draws.find(d => d.text.startsWith('Scene')).fillStyle)
      .toBe(canonColor('warning', XR_SCHEME));

    canvas.draws.length = 0;
    appState.setStatus('Capture failed', 'error');
    hud.update();
    expect(canvas.draws.find(d => d.text.startsWith('Capture')).fillStyle)
      .toBe(canonColor('destructive', XR_SCHEME));
  });

  it('falls back to the muted ink for an informational status', () => {
    const { hud } = attachedHud();
    canvas.draws.length = 0;
    appState.setStatus('Scan cleared', 'info');
    hud.update();
    expect(canvas.draws.find(d => d.text === 'Scan cleared').fillStyle)
      .toBe(canonColor('muted-foreground', XR_SCHEME));
  });

  it('truncates a long status line to fit the panel', () => {
    const { hud } = attachedHud();
    canvas.draws.length = 0;
    appState.setStatus('x'.repeat(40), 'ok');
    hud.update();
    const line = canvas.draws.find(d => d.text.startsWith('xxx'));
    expect(line.text).toHaveLength(30);
    expect(line.text.endsWith('…')).toBe(true);
  });

  it('shows BUSY in the canon warning colour while a capture runs', () => {
    const { hud } = attachedHud();
    canvas.draws.length = 0;

    appState.setBusy(true);
    hud.update();

    const busy = canvas.draws.find(d => d.text === 'BUSY…');
    expect(busy.fillStyle).toBe(canonColor('warning', XR_SCHEME));
    expect(canvas.draws.some(d => d.text === 'Scene pins only')).toBe(false);
  });

  it('redraws only when something changed', () => {
    const { hud } = attachedHud();
    hud.update();                 // the first frame after attaching draws the panel
    canvas.draws.length = 0;
    hud.update();                 // nothing changed since: no redraw
    expect(canvas.draws).toHaveLength(0);
  });
});
