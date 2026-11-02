/**
 * Unit tests for ControllerMenuBuilder — the coloured legend on each controller.
 * Each disc is a step on the canon level scale, so the legend uses canon hues.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { fakeCanvas } from './helpers/fakeCanvas.js';
import { buildControllerMenu } from '../../src/ui/ControllerMenuBuilder.js';
import { FONT_STACK, XR_SCHEME, threeColor } from '../../src/ui/theme.js';

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The colour of each indicator disc on a grip, in the order they were added. */
function discColours(grip) {
  return grip.children.map(group => group.children[0].material.color.getHex());
}

describe('ControllerMenuBuilder', () => {
  it('puts the canon level colours on the right and left hands', () => {
    const grips = { right: new THREE.Object3D(), left: new THREE.Object3D() };
    const world = { input: { xrOrigin: { gripSpaces: grips } } };

    expect(buildControllerMenu(world)).toBe(true);

    expect(discColours(grips.right)).toEqual([
      threeColor('level-red', XR_SCHEME),      // A: capture
      threeColor('level-blue', XR_SCHEME),     // B: cycle model
      threeColor('level-orange', XR_SCHEME),   // trigger: display mode
    ]);
    expect(discColours(grips.left)).toEqual([
      threeColor('level-gold', XR_SCHEME),     // X: preview distance
      threeColor('level-green', XR_SCHEME),    // Y: save and export
      threeColor('level-orange', XR_SCHEME),   // trigger: display mode
    ]);
  });

  it('labels each indicator in the canon face', () => {
    const grips = { right: new THREE.Object3D(), left: new THREE.Object3D() };
    buildControllerMenu({ input: { xrOrigin: { gripSpaces: grips } } });

    const label = grips.right.children[0].children[1].material.map;
    expect(label.image.ctx.font).toBe(`700 18px ${FONT_STACK}`);
  });

  it('builds each hand once, so repeated calls do not double the legend', () => {
    const origin = { gripSpaces: { right: new THREE.Object3D() } };
    const world = { input: { xrOrigin: origin } };

    expect(buildControllerMenu(world)).toBe(false);   // left hand not there yet

    origin.gripSpaces.left = new THREE.Object3D();
    expect(buildControllerMenu(world)).toBe(true);
    expect(buildControllerMenu(world)).toBe(true);
    expect(origin.gripSpaces.right.children).toHaveLength(3);
    expect(origin.gripSpaces.left.children).toHaveLength(3);
  });

  it('reports false before the XR origin exists', () => {
    expect(buildControllerMenu({})).toBe(false);
  });
});
