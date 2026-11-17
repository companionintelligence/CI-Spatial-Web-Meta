/**
 * The wrist panel's privacy and scan rows: the camera line (with a red REC when on),
 * the room name, and the list of the room's planes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { fakeCanvas } from './helpers/fakeCanvas.js';
import { appState } from '../../src/app/AppState.js';
import { WristHUD } from '../../src/ui/WristHUD.js';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { XR_SCHEME, canonColor } from '../../src/ui/theme.js';

let canvas;

beforeEach(() => {
  canvas = fakeCanvas();
  vi.stubGlobal('document', { createElement: (tag) => (tag === 'canvas' ? canvas : null) });
  appState.setBusy(false);
  appState.setStatus('', 'info');
  appState.setCameraOn(false);
  appState.setPlanes([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function attachedHud() {
  const grip = new THREE.Object3D();
  const hud = new WristHUD({ input: { xrOrigin: { gripSpaces: { left: grip } } } }, new SpatialPinManager());
  hud.init();
  return hud;
}

const plane = (id, label, x, z) => ({
  id, label, orientation: 'horizontal', pose: {}, center: { x: 0, z: 0 }, size: { x, z },
});

describe('WristHUD — camera line', () => {
  it('shows the camera as off while it is off', () => {
    attachedHud();
    expect(canvas.draws.some((d) => d.text === 'Camera off')).toBe(true);
    expect(canvas.draws.some((d) => d.text.startsWith('REC'))).toBe(false);
  });

  it('shows a red REC line while the camera is on', () => {
    const hud = attachedHud();
    appState.setCameraOn(true);
    canvas.draws.length = 0;
    hud.update();
    const rec = canvas.draws.find((d) => d.text.startsWith('REC camera'));
    expect(rec).toBeDefined();
    expect(rec.fillStyle).toBe(canonColor('destructive', XR_SCHEME));
  });
});

describe('WristHUD — room and planes', () => {
  it('shows the room the next scan is filed under', () => {
    attachedHud();
    expect(canvas.draws.find((d) => d.text === 'Room:')).toBeDefined();
    expect(canvas.draws.find((d) => d.text === 'Room 1')).toBeDefined();
  });

  it('lists the largest planes, then says how many are not shown', () => {
    const hud = attachedHud();
    appState.setPlanes([
      plane('plane-1', 'floor', 3.2, 2.9),
      plane('plane-2', 'wall', 4, 2.4),
      plane('plane-3', 'table', 1, 0.6),
      plane('plane-4', 'wall', 2, 2.4),
      plane('plane-5', 'door', 0.9, 2.0),
    ]);
    canvas.draws.length = 0;
    hud.update();
    expect(canvas.draws.find((d) => d.text === 'Planes: 5')).toBeDefined();
    expect(canvas.draws.find((d) => d.text === 'floor · 3.2 × 2.9 m')).toBeDefined();
    expect(canvas.draws.find((d) => d.text === 'wall · 4.0 × 2.4 m')).toBeDefined();
    expect(canvas.draws.find((d) => d.text === 'table · 1.0 × 0.6 m')).toBeDefined();
    expect(canvas.draws.find((d) => d.text === '+2 more')).toBeDefined();
  });
});
