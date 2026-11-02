/**
 * Unit tests for FrustumRenderer — the capture-ray visualisation. A batch of
 * rays is one line set in the canon orange, fading out over its lifetime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { FrustumRenderer } from '../../src/rendering/FrustumRenderer.js';
import { XR_SCHEME, threeColor } from '../../src/ui/theme.js';

function makeWorld() {
  return { scene: { add: vi.fn(), remove: vi.fn() } };
}

const ray = (x = 0) => ({
  origin: new THREE.Vector3(x, 1.6, 0),
  dir: new THREE.Vector3(0, 0, -1),
});

describe('FrustumRenderer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it('draws a batch as one line set in the canon orange, ending at the given depth', () => {
    const world = makeWorld();
    new FrustumRenderer(world).draw([ray(0), ray(1)], 2);

    expect(world.scene.add).toHaveBeenCalledTimes(1);
    const line = world.scene.add.mock.calls[0][0];
    expect(line.geometry.attributes.position.count).toBe(4);   // two rays, two points each
    expect(line.geometry.attributes.position.getZ(1)).toBeCloseTo(-2);
    expect(line.material.color.getHex()).toBe(threeColor('level-orange', XR_SCHEME));
  });

  it('ignores an empty or missing batch', () => {
    const world = makeWorld();
    const renderer = new FrustumRenderer(world);
    renderer.draw([]);
    renderer.draw(undefined);
    expect(world.scene.add).not.toHaveBeenCalled();
  });

  it('fades a batch as it ages, then removes and disposes it', () => {
    const world = makeWorld();
    const renderer = new FrustumRenderer(world);
    renderer.draw([ray()], 1);
    const line = world.scene.add.mock.calls[0][0];

    vi.setSystemTime(750);
    renderer.update();
    expect(line.material.opacity).toBeCloseTo(0.4, 2);
    expect(world.scene.remove).not.toHaveBeenCalled();

    vi.setSystemTime(1600);
    renderer.update();
    expect(world.scene.remove).toHaveBeenCalledWith(line);
    expect(renderer._batches).toHaveLength(0);
  });

  it('does nothing on update when there is nothing to fade', () => {
    expect(() => new FrustumRenderer(makeWorld()).update()).not.toThrow();
  });
});
