/**
 * Unit tests for PipelineA — WebXR entity → SpatialPin conversion.
 *
 * PipelineA imports XRPlane and XRMesh from @iwsdk/core, which we mock here.
 * We supply hand-crafted entity stubs that match the IWSDK Entity shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { PinSource } from '../../src/spatial/SpatialPin.js';

// ── Stubs ─────────────────────────────────────────────────────────────────

/** Fake XRPlane / XRMesh component tokens (just objects for identity checks). */
const FAKE_XRPlane = Symbol('XRPlane');
const FAKE_XRMesh  = Symbol('XRMesh');

vi.mock('@iwsdk/core', () => ({
  XRPlane: FAKE_XRPlane,
  XRMesh:  FAKE_XRMesh,
}));

/**
 * Build a minimal IWSDK Entity stub.
 * getValue(component, key) dispatches to the stored data map.
 */
function makeEntity({ planeData = null, meshData = null, position = { x: 0, y: 0, z: 0 }, quaternion = { x: 0, y: 0, z: 0, w: 1 } } = {}) {
  const data = {};
  if (planeData) data[FAKE_XRPlane] = planeData;
  if (meshData)  data[FAKE_XRMesh]  = meshData;

  return {
    getValue: (component, key) => {
      const store = data[component];
      return store ? store[key] : null;
    },
    object3D: {
      position: { ...position },
      quaternion: { ...quaternion },
    },
  };
}

// ── Import after mocks ────────────────────────────────────────────────────

const { runPipelineA } = await import('../../src/pipeline/PipelineA.js');

// ── Tests ─────────────────────────────────────────────────────────────────

describe('runPipelineA — plane entities', () => {
  let mgr;
  beforeEach(() => { mgr = new SpatialPinManager(); });

  it('converts a plane entity to a MetaScene pin', () => {
    const plane = { orientation: 'horizontal', semanticLabel: 'FLOOR', lastChangedTime: 100 };
    const entity = makeEntity({
      planeData: { _plane: plane },
      position:  { x: 1, y: 0, z: 2 },
    });

    runPipelineA(new Set([entity]), new Set(), mgr, 'cap-1', 'sess-1');

    expect(mgr.pins).toHaveLength(1);
    const p = mgr.pins[0];
    expect(p.source).toBe(PinSource.MetaScene);
    expect(p.label).toBe('FLOOR');          // semanticLabel preferred over orientation
    expect(p.hitType).toBe('plane');
    expect(p.worldPosition).toEqual({ x: 1, y: 0, z: 2 });
    expect(p.captureId).toBe('cap-1');
    expect(p.captureSessionId).toBe('sess-1');
  });

  it('falls back to orientation, then "plane", for the label', () => {
    const oriented = makeEntity({ planeData: { _plane: { orientation: 'vertical' } } });
    const bare     = makeEntity({ planeData: { _plane: {} } });
    runPipelineA(new Set([oriented, bare]), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins.map(p => p.label).sort()).toEqual(['plane', 'vertical']);
  });

  it('keeps two planes with the same semantic label as distinct pins', () => {
    const wallA = makeEntity({ planeData: { _plane: { semanticLabel: 'wall' } }, position: { x: -2, y: 0, z: 0 } });
    const wallB = makeEntity({ planeData: { _plane: { semanticLabel: 'wall' } }, position: { x:  2, y: 0, z: 0 } });
    runPipelineA(new Set([wallA, wallB]), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(2);
    expect(mgr.pins[0].trackId).not.toBe(mgr.pins[1].trackId);
  });

  it('updates the same pin when the same native plane is re-captured', () => {
    const plane  = { semanticLabel: 'floor', lastChangedTime: 1 };
    const first  = makeEntity({ planeData: { _plane: plane }, position: { x: 0, y: 0, z: 0 } });
    runPipelineA(new Set([first]), new Set(), mgr, 'cap-1', 'sess');

    // Same native plane object, refined pose and lastChangedTime
    plane.lastChangedTime = 2;
    const second = makeEntity({ planeData: { _plane: plane }, position: { x: 0.1, y: 0, z: 0 } });
    runPipelineA(new Set([second]), new Set(), mgr, 'cap-2', 'sess');

    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].worldPosition.x).toBeCloseTo(0.1);
  });

  it('sets semanticLabels from plane.semanticLabel', () => {
    const plane = { semanticLabel: 'CEILING', lastChangedTime: 5 };
    const entity = makeEntity({ planeData: { _plane: plane } });
    runPipelineA(new Set([entity]), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins[0].semanticLabels).toEqual(['CEILING']);
  });

  it('sets semanticLabels to null when plane has no semanticLabel', () => {
    const plane = { orientation: 'vertical', lastChangedTime: 1 };
    const entity = makeEntity({ planeData: { _plane: plane } });
    runPipelineA(new Set([entity]), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins[0].semanticLabels).toBeNull();
  });

  it('computes planeExtents from polygon', () => {
    const plane = {
      semanticLabel: 'FLOOR',
      lastChangedTime: 1,
      polygon: [
        { x: -2, z: -3 },
        { x:  2, z: -3 },
        { x:  2, z:  3 },
        { x: -2, z:  3 },
      ],
    };
    const entity = makeEntity({ planeData: { _plane: plane } });
    runPipelineA(new Set([entity]), new Set(), mgr, 'cap', 'sess');

    const extents = mgr.pins[0].planeExtents;
    expect(extents).not.toBeNull();
    expect(extents.size.x).toBeCloseTo(4);   // maxX - minX = 2 - (-2) = 4
    expect(extents.size.z).toBeCloseTo(6);   // maxZ - minZ = 3 - (-3) = 6
    expect(extents.center.x).toBeCloseTo(0);
    expect(extents.center.z).toBeCloseTo(0);
  });

  it('skips entity when _plane is null', () => {
    const entity = makeEntity({ planeData: { _plane: null } });
    runPipelineA(new Set([entity]), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(0);
  });

  it('skips entity when object3D is null', () => {
    const entity = {
      getValue: (comp, key) => key === '_plane'
        ? { semanticLabel: 'FLOOR', lastChangedTime: 1 }
        : null,
      object3D: null,
    };
    runPipelineA(new Set([entity]), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(0);
  });

  it('handles multiple plane entities', () => {
    const planes = ['horizontal', 'vertical'].map((orientation, i) =>
      makeEntity({
        planeData: { _plane: { orientation, lastChangedTime: i } },
        position: { x: i, y: 0, z: 0 },
      })
    );
    runPipelineA(new Set(planes), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(2);
  });
});

describe('runPipelineA — mesh entities', () => {
  let mgr;
  beforeEach(() => { mgr = new SpatialPinManager(); });

  it('converts a mesh entity to a MetaScene pin', () => {
    const mesh = { semanticLabel: 'TABLE', lastChangedTime: 200 };
    const entity = makeEntity({
      meshData:  { _mesh: mesh },
      position:  { x: 3, y: 1, z: -1 },
    });

    runPipelineA(new Set(), new Set([entity]), mgr, 'cap-2', 'sess-2');

    expect(mgr.pins).toHaveLength(1);
    const p = mgr.pins[0];
    expect(p.source).toBe(PinSource.MetaScene);
    expect(p.label).toBe('TABLE');
    expect(p.hitType).toBe('mesh');
    expect(p.worldPosition).toEqual({ x: 3, y: 1, z: -1 });
  });

  it('uses "mesh" as label fallback when semanticLabel is undefined', () => {
    const mesh = { lastChangedTime: 1 };
    const entity = makeEntity({ meshData: { _mesh: mesh } });
    runPipelineA(new Set(), new Set([entity]), mgr, 'cap', 'sess');
    expect(mgr.pins[0].label).toBe('mesh');
  });

  it('sets track id with mesh prefix', () => {
    const mesh = { semanticLabel: 'SOFA', lastChangedTime: 42 };
    const entity = makeEntity({ meshData: { _mesh: mesh } });
    runPipelineA(new Set(), new Set([entity]), mgr, 'cap', 'sess');
    expect(mgr.pins[0].trackId).toMatch(/^mesh-/);
  });

  it('computes volumeExtents from the raw vertex buffer', () => {
    const mesh = {
      semanticLabel: 'table',
      vertices: new Float32Array([
        -1, 0, -2,
         1, 0.8, 2,
         0, 0.4, 0,
      ]),
    };
    const entity = makeEntity({ meshData: { _mesh: mesh } });
    runPipelineA(new Set(), new Set([entity]), mgr, 'cap', 'sess');

    const v = mgr.pins[0].volumeExtents;
    expect(v).not.toBeNull();
    expect(v.size.x).toBeCloseTo(2);
    expect(v.size.y).toBeCloseTo(0.8);
    expect(v.size.z).toBeCloseTo(4);
    expect(v.center.x).toBeCloseTo(0);
    expect(v.center.y).toBeCloseTo(0.4);
    expect(v.center.z).toBeCloseTo(0);
  });

  it('leaves volumeExtents null when the mesh has no vertices', () => {
    const entity = makeEntity({ meshData: { _mesh: { semanticLabel: 'lamp' } } });
    runPipelineA(new Set(), new Set([entity]), mgr, 'cap', 'sess');
    expect(mgr.pins[0].volumeExtents).toBeNull();
  });

  it('skips mesh entity when _mesh is null', () => {
    const entity = makeEntity({ meshData: { _mesh: null } });
    runPipelineA(new Set(), new Set([entity]), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(0);
  });
});

describe('runPipelineA — mixed planes + meshes', () => {
  it('processes both entity sets in one call', () => {
    const mgr = new SpatialPinManager();
    const planeEntity = makeEntity({
      planeData: { _plane: { semanticLabel: 'FLOOR', lastChangedTime: 1 } },
    });
    const meshEntity = makeEntity({
      meshData: { _mesh: { semanticLabel: 'COUCH', lastChangedTime: 2 } },
    });

    runPipelineA(new Set([planeEntity]), new Set([meshEntity]), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(2);
    expect(mgr.bySource(PinSource.MetaScene)).toHaveLength(2);
  });

  it('adds nothing when both sets are empty', () => {
    const mgr = new SpatialPinManager();
    runPipelineA(new Set(), new Set(), mgr, 'cap', 'sess');
    expect(mgr.pins).toHaveLength(0);
  });
});
