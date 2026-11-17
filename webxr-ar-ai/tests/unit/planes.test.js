/**
 * The room's planes as contract records, and the rows the wrist panel and overlay list.
 */
import { describe, it, expect } from 'vitest';
import { planeRecords, planesSignature, planeLabel, polygonExtents, summarisePlanes } from '../../src/scan/planes.js';

const square = (w, d) => [
  { x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 },
  { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 },
];

function entity({ label, orientation = 'horizontal', polygon, position = { x: 0, y: 0, z: 0 }, quaternion = { x: 0, y: 0, z: 0, w: 1 } }) {
  return {
    _plane: { semanticLabel: label, orientation, polygon },
    object3D: { position, quaternion },
  };
}

const ids = new Map();
const trackIdFor = (plane) => {
  if (!ids.has(plane)) ids.set(plane, `plane-${ids.size + 1}`);
  return ids.get(plane);
};
const readPlane = (e) => e._plane;

describe('planeRecords', () => {
  it('turns plane entities into contract Plane records, largest first', () => {
    const floor = entity({ label: 'FLOOR', polygon: square(3.2, 2.9) });
    const table = entity({ label: 'TABLE', polygon: square(1, 0.6), position: { x: 1, y: 0.75, z: -1 } });
    const records = planeRecords([table, floor], { readPlane, trackIdFor });

    expect(records.map((r) => r.label)).toEqual(['floor', 'table']);
    expect(records[0]).toMatchObject({
      id: expect.stringMatching(/^plane-\d+$/),
      label: 'floor',
      orientation: 'horizontal',
      center: { x: 0, z: 0 },
      size: { x: 3.2, z: 2.9 },
    });
    expect(records[0].pose).toEqual({
      frame: 'local-floor',
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(records[1].pose.position).toEqual({ x: 1, y: 0.75, z: -1 });
  });

  it('skips entities with no plane data or no pose, and keeps ids stable across calls', () => {
    const wall = entity({ label: 'WALL', orientation: 'vertical', polygon: square(2, 2.4) });
    const noPlane = { _plane: null, object3D: { position: {}, quaternion: {} } };
    const noObject = { _plane: { polygon: square(1, 1) } };
    const first = planeRecords([wall, noPlane, noObject], { readPlane, trackIdFor });
    const second = planeRecords([wall], { readPlane, trackIdFor });
    expect(first).toHaveLength(1);
    expect(first[0].orientation).toBe('vertical');
    expect(second[0].id).toBe(first[0].id);
  });

  it('gives a plane with no polygon a zero size rather than NaN', () => {
    const bare = {
      _plane: { semanticLabel: undefined, orientation: undefined, polygon: undefined },
      object3D: { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
    };
    const [record] = planeRecords([bare], { readPlane, trackIdFor });
    expect(record.label).toBe('plane');
    expect(record.orientation).toBeNull();
    expect(record.size).toEqual({ x: 0, z: 0 });
  });
});

describe('helpers', () => {
  it('labels planes by semantic label, then orientation, and keeps labels short', () => {
    expect(planeLabel({ semanticLabel: 'WALL_FACE' })).toBe('wall_face');
    expect(planeLabel({ orientation: 'vertical' })).toBe('vertical');
    expect(planeLabel({ semanticLabel: 'x'.repeat(80) })).toHaveLength(40);
  });

  it('measures the polygon in plane-local metres', () => {
    expect(polygonExtents(square(2, 4))).toEqual({ center: { x: 0, z: 0 }, size: { x: 2, z: 4 } });
  });

  it('summarises planes as short rows and limits how many', () => {
    const records = planeRecords([
      entity({ label: 'FLOOR', polygon: square(3.2, 2.9) }),
      entity({ label: 'WALL', orientation: 'vertical', polygon: square(4, 2.4) }),
    ], { readPlane, trackIdFor });
    expect(summarisePlanes(records, 1)).toEqual([
      { id: records[0].id, label: 'wall', text: 'wall · 4.0 × 2.4 m' },
    ]);
    expect(summarisePlanes(records)).toHaveLength(2);
  });

  it('changes its signature only when a plane appears, resizes, or goes', () => {
    // The same native plane object across frames, as WebXR provides it.
    const floor = entity({ label: 'FLOOR', polygon: square(3, 3) });
    const a = planeRecords([floor], { readPlane, trackIdFor });
    const b = planeRecords([floor], { readPlane, trackIdFor });
    expect(planesSignature(a)).toBe(planesSignature(b));

    floor._plane.polygon = square(3, 4);   // the plane grew
    const c = planeRecords([floor], { readPlane, trackIdFor });
    expect(planesSignature(a)).not.toBe(planesSignature(c));
    expect(planesSignature([])).toBe('');
  });
});
