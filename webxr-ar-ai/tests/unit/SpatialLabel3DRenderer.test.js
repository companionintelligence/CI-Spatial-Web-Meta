/**
 * Unit tests for SpatialLabel3DRenderer — one disc-and-label group per pin.
 * CvServer pins are the canon success green, MetaScene pins the canon info blue,
 * both from the dark set because the labels sit on passthrough.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { fakeCanvas } from './helpers/fakeCanvas.js';
import { SpatialLabel3DRenderer } from '../../src/rendering/SpatialLabel3DRenderer.js';
import { SpatialPin, PinSource } from '../../src/spatial/SpatialPin.js';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { DisplayMode } from '../../src/app/AppState.js';
import { FONT_STACK, XR_SCHEME, canonColor, threeColor } from '../../src/ui/theme.js';

let canvas;

beforeEach(() => {
  canvas = fakeCanvas();
  vi.stubGlobal('document', { createElement: () => canvas });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const world = { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() };
  const scanRoot = { labelsRoot: new THREE.Group() };
  const pins = new SpatialPinManager();
  const renderer = new SpatialLabel3DRenderer(world, pins, scanRoot);
  return { world, scanRoot, pins, renderer };
}

function pin(source, label = 'Sofa') {
  const p = new SpatialPin();
  p.source = source;
  p.label = label;
  p.confidence = 0.9;
  return p;
}

describe('SpatialLabel3DRenderer', () => {
  it('builds one group per pin under the labels root, coloured by source', () => {
    const { scanRoot, pins, renderer } = setup();

    const cv = pin(PinSource.CvServer);
    const scene = pin(PinSource.MetaScene, 'Wall');
    pins.addOrUpdate(cv);
    pins.addOrUpdate(scene);

    expect(renderer._meshMap.size).toBe(2);
    expect(scanRoot.labelsRoot.children).toHaveLength(2);
    const discOf = (p) => renderer._meshMap.get(p.id).children[0].material.color.getHex();
    expect(discOf(cv)).toBe(threeColor('success', XR_SCHEME));
    expect(discOf(scene)).toBe(threeColor('info', XR_SCHEME));
  });

  it('writes the label in the canon face, in the source colour', () => {
    const { pins } = setup();
    pins.addOrUpdate(pin(PinSource.CvServer, 'Lamp'));

    const title = canvas.draws.find(d => d.text === 'Lamp');
    expect(title.fillStyle).toBe(canonColor('success', XR_SCHEME));
    expect(title.font).toBe(`700 28px ${FONT_STACK}`);
    const sub = canvas.draws.find(d => d.text === '90%');
    expect(sub.fillStyle).toBe(canonColor('muted-foreground', XR_SCHEME));
  });

  it('shows the semantic label under a scene pin, and the source when there is none', () => {
    const { pins } = setup();
    const withLabel = pin(PinSource.MetaScene, 'Wall');
    withLabel.semanticLabels = ['wall'];
    pins.addOrUpdate(withLabel);
    expect(canvas.draws.some(d => d.text === 'wall')).toBe(true);

    canvas.draws.length = 0;
    pins.addOrUpdate(pin(PinSource.MetaScene, 'Floor'));
    expect(canvas.draws.some(d => d.text === PinSource.MetaScene)).toBe(true);
  });

  it('follows the display mode: labels show for SpatialLabel3D and Both only', () => {
    const { pins, renderer } = setup();
    const p = pin(PinSource.CvServer);
    pins.addOrUpdate(p);
    const group = renderer._meshMap.get(p.id);

    renderer.setDisplayMode(DisplayMode.BoundingBox2D);
    expect(group.visible).toBe(false);

    renderer.setDisplayMode(DisplayMode.SpatialLabel3D);
    expect(group.visible).toBe(true);

    renderer.setDisplayMode(DisplayMode.BoundingBox2D);
    renderer.setDisplayMode(DisplayMode.Both);
    expect(group.visible).toBe(true);
  });

  it('removes a pin\'s group when the pin is removed', () => {
    const { scanRoot, pins, renderer } = setup();
    const p = pin(PinSource.CvServer);
    pins.addOrUpdate(p);
    pins.remove(p.id);

    expect(renderer._meshMap.size).toBe(0);
    expect(scanRoot.labelsRoot.children).toHaveLength(0);
  });

  it('clears every group when the pin store is cleared', () => {
    const { pins, renderer } = setup();
    pins.addOrUpdate(pin(PinSource.CvServer));
    pins.addOrUpdate(pin(PinSource.MetaScene));
    pins.clearAll();
    expect(renderer._meshMap.size).toBe(0);
  });

  it('billboards visible labels toward the camera each frame', () => {
    const { world, pins, renderer } = setup();
    world.camera.position.set(0, 1.6, 2);
    world.camera.updateMatrixWorld(true);
    const p = pin(PinSource.CvServer);
    pins.addOrUpdate(p);
    renderer.setDisplayMode(DisplayMode.Both);

    const label = renderer._meshMap.get(p.id).userData.labelMesh;
    const lookAt = vi.spyOn(label, 'lookAt');
    renderer.update();
    expect(lookAt).toHaveBeenCalledTimes(1);
  });

  it('rebuilds every label after a WebGL context restore', () => {
    const { pins, renderer } = setup();
    pins.addOrUpdate(pin(PinSource.CvServer));
    pins.addOrUpdate(pin(PinSource.MetaScene));
    renderer.rebuildAll();
    expect(renderer._meshMap.size).toBe(2);
  });

  it('places a restored pin at its anchor-local position', () => {
    const { pins, renderer } = setup();
    const p = pin(PinSource.CvServer);
    p.anchorLocalPosition = { x: 0.4, y: 1.1, z: -0.8 };
    pins.addOrUpdate(p);

    const group = renderer._meshMap.get(p.id);
    expect(group.position.x).toBeCloseTo(0.4);
    expect(group.position.y).toBeCloseTo(1.1);
    expect(group.position.z).toBeCloseTo(-0.8);
  });

  it('uses the foreground colour for a pin of unknown source', () => {
    const { pins, renderer } = setup();
    const p = pin('Elsewhere');
    pins.addOrUpdate(p);
    expect(renderer._meshMap.get(p.id).children[0].material.color.getHex())
      .toBe(threeColor('foreground', XR_SCHEME));
  });
});
