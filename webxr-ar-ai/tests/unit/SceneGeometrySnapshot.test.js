/**
 * Unit tests for SceneGeometrySnapshot persistence: serialize() produces plain
 * records, restore() rebuilds invisible export meshes from them, and a live
 * capture replaces restored geometry instead of duplicating it.
 *
 * Entities are minimal doubles: the snapshot only calls getValue(component,
 * key) for the native XRPlane/XRMesh object and reads object3D.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// The real IWSDK bundle needs a browser; the snapshot only uses these as keys.
vi.mock('@iwsdk/core', () => ({
  XRPlane: Symbol('XRPlane'),
  XRMesh:  Symbol('XRMesh'),
}));

const { SceneGeometrySnapshot } = await import('../../src/export/SceneGeometrySnapshot.js');

function makeRoot() {
  return { geometryRoot: new THREE.Group() };
}

function planeEntity(id, position = [0, 0, 0]) {
  const native = { id, semanticLabel: 'floor', orientation: 'horizontal' };
  const object3D = new THREE.Mesh(new THREE.PlaneGeometry(2, 3));
  object3D.position.set(...position);
  return {
    object3D,
    getValue: (_component, key) => (key === '_plane' ? native : undefined),
  };
}

function meshEntity(id, position = [0, 0, 0]) {
  const native = { id, semanticLabel: 'wall' };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2]);
  const object3D = new THREE.Mesh(geometry);
  object3D.position.set(...position);
  return {
    object3D,
    getValue: (_component, key) => (key === '_mesh' ? native : undefined),
  };
}

describe('SceneGeometrySnapshot.serialize', () => {
  it('returns one plain record per snapshot with geometry and placement', () => {
    const snap = new SceneGeometrySnapshot(makeRoot());
    snap.snapshot([planeEntity(1, [0, 1, 0])], [meshEntity(2, [4, 0, 0])]);

    const records = snap.serialize();
    expect(records).toHaveLength(2);

    const plane = records.find(r => r.kind === 'plane');
    expect(plane.semanticLabel).toBe('floor');
    expect(plane.orientation).toBe('horizontal');
    expect(plane.position[1]).toBeCloseTo(1);
    expect(plane.quaternion).toHaveLength(4);
    expect(plane.attributes.position.itemSize).toBe(3);
    expect(plane.attributes.position.array).toBeInstanceOf(Float32Array);

    const mesh = records.find(r => r.kind === 'mesh');
    expect(mesh.position[0]).toBeCloseTo(4);
    expect(mesh.index).toBeInstanceOf(Uint16Array);
    expect(Array.from(mesh.index)).toEqual([0, 1, 2]);
  });

  it('copies buffers so later edits to the live geometry do not change the record', () => {
    const root = makeRoot();
    const snap = new SceneGeometrySnapshot(root);
    snap.snapshot([], [meshEntity(3)]);
    const [record] = snap.serialize();
    const before = Array.from(record.attributes.position.array);

    const live = root.geometryRoot.children[0];
    live.geometry.attributes.position.array[0] = 99;

    expect(Array.from(record.attributes.position.array)).toEqual(before);
  });
});

describe('SceneGeometrySnapshot.restore', () => {
  it('rebuilds invisible export meshes with the same names and metadata', () => {
    const source = new SceneGeometrySnapshot(makeRoot());
    source.snapshot([planeEntity(1)], [meshEntity(2)]);
    const records = source.serialize();

    const root = makeRoot();
    const restored = new SceneGeometrySnapshot(root);
    expect(restored.restore(records)).toBe(2);

    const meshes = root.geometryRoot.children;
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      expect(m.visible).toBe(false);
      expect(m.userData.companionScan.kind).toMatch(/^(plane|mesh)$/);
    }
    expect(meshes.map(m => m.name).sort()).toEqual(['mesh-wall', 'plane-floor']);
    expect(restored.count).toBe(2);
    expect(restored.restoredCount).toBe(2);
  });

  it('does nothing while live snapshots exist', () => {
    const root = makeRoot();
    const snap = new SceneGeometrySnapshot(root);
    snap.snapshot([planeEntity(1)], []);
    const other = new SceneGeometrySnapshot(makeRoot());
    other.snapshot([meshEntity(9)], []);

    expect(snap.restore(other.serialize())).toBe(0);
    expect(root.geometryRoot.children).toHaveLength(1);
    expect(snap.restoredCount).toBe(0);
  });

  it('is replaced by the next live capture instead of duplicated', () => {
    const source = new SceneGeometrySnapshot(makeRoot());
    source.snapshot([planeEntity(1)], [meshEntity(2)]);

    const root = makeRoot();
    const snap = new SceneGeometrySnapshot(root);
    snap.restore(source.serialize());
    expect(root.geometryRoot.children).toHaveLength(2);

    snap.snapshot([planeEntity(7)], []);
    expect(root.geometryRoot.children).toHaveLength(1);
    expect(snap.restoredCount).toBe(0);
    expect(snap.count).toBe(1);
  });

  it('keeps restored geometry when a capture has no scene data yet', () => {
    const source = new SceneGeometrySnapshot(makeRoot());
    source.snapshot([planeEntity(1)], []);

    const root = makeRoot();
    const snap = new SceneGeometrySnapshot(root);
    snap.restore(source.serialize());
    snap.snapshot([], []);

    expect(root.geometryRoot.children).toHaveLength(1);
    expect(snap.restoredCount).toBe(1);
  });

  it('keeps the geometry through a second save and restore', () => {
    const source = new SceneGeometrySnapshot(makeRoot());
    source.snapshot([planeEntity(1, [0, 1, 0])], [meshEntity(2, [4, 0, 0])]);

    const first = new SceneGeometrySnapshot(makeRoot());
    first.restore(source.serialize());
    const second = new SceneGeometrySnapshot(makeRoot());
    expect(second.restore(first.serialize())).toBe(2);

    const kinds = second.serialize().map(r => r.kind).sort();
    expect(kinds).toEqual(['mesh', 'plane']);
    const mesh = second.serialize().find(r => r.kind === 'mesh');
    expect(Array.from(mesh.attributes.position.array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});
