/**
 * Unit tests for ScanAnchorRoot — the persistent-anchor group all scan content
 * lives under, and the world-to-anchor conversion used by exports and pins.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

vi.mock('@iwsdk/core', () => ({ XRAnchor: Symbol('XRAnchor') }));

const { ScanAnchorRoot, ANCHOR_UUID_STORAGE_KEY } = await import('../../src/spatial/ScanAnchorRoot.js');
const { XRAnchor } = await import('@iwsdk/core');

function makeWorld() {
  return {
    createTransformEntity: vi.fn((object3D) => ({
      object3D,
      addComponent: vi.fn(),
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ScanAnchorRoot structure', () => {
  it('builds the anchored group with label and geometry subtrees', () => {
    const world = makeWorld();
    const root = new ScanAnchorRoot(world);

    expect(root.group.name).toBe('companion-scan-root');
    expect(root.group.children).toEqual([root.labelsRoot, root.geometryRoot]);
    expect(root.labelsRoot.name).toBe('companion-scan-labels');
    expect(root.geometryRoot.name).toBe('companion-scan-geometry');
  });

  it('binds the group to a persistent XRAnchor', () => {
    const world = makeWorld();
    const root = new ScanAnchorRoot(world);

    expect(world.createTransformEntity).toHaveBeenCalledWith(root.group);
    const entity = world.createTransformEntity.mock.results[0].value;
    expect(entity.addComponent).toHaveBeenCalledWith(XRAnchor);
  });
});

describe('ScanAnchorRoot.anchorUuid', () => {
  it('reads the persisted anchor UUID', () => {
    vi.stubGlobal('localStorage', { getItem: (k) => (k === ANCHOR_UUID_STORAGE_KEY ? 'uuid-1' : null) });
    expect(new ScanAnchorRoot(makeWorld()).anchorUuid).toBe('uuid-1');
  });

  it('reports null when storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('SecurityError'); } });
    expect(new ScanAnchorRoot(makeWorld()).anchorUuid).toBeNull();
  });
});

describe('ScanAnchorRoot.worldToAnchorLocal', () => {
  it('expresses a world point relative to the anchored group', () => {
    const root = new ScanAnchorRoot(makeWorld());
    root.group.position.set(1, 2, 3);

    const local = root.worldToAnchorLocal({ x: 2, y: 2, z: 3 });

    expect(local.x).toBeCloseTo(1);
    expect(local.y).toBeCloseTo(0);
    expect(local.z).toBeCloseTo(0);
  });

  it('is the identity while the group sits at the origin', () => {
    const root = new ScanAnchorRoot(makeWorld());
    expect(root.worldToAnchorLocal({ x: 0.5, y: 1.2, z: -2 })).toEqual({ x: 0.5, y: 1.2, z: -2 });
  });
});

describe('ScanAnchorRoot dependencies', () => {
  it('is built from the three.js group type', () => {
    expect(new ScanAnchorRoot(makeWorld()).group).toBeInstanceOf(THREE.Group);
  });
});
