/**
 * Unit tests for scanMetadata — the editor's normalization + edit operations.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeScan,
  normalizePin,
  updatePin,
  removePin,
  scanToJson,
  computeFloorplan,
} from '../../src/viewer/scanMetadata.js';

const SCAN = {
  version: '1.1',
  session_id: 's1',
  anchor_uuid: 'a1',
  pins: [
    { id: 'p1', source: 'CvServer', label: 'chair', confidence: 0.9, hit_type: 'mesh',
      position: { x: 1, y: 0.5, z: -2 } },
    { id: 'p2', source: 'MetaScene', label: 'wall', hit_type: 'plane',
      position: { x: 0, y: 1.4, z: -3 } },
    { id: 'p3', source: 'CvServer', label: 'ghost', hit_type: 'fallback',
      position: { x: 50, y: 50, z: 50 } },
  ],
};

describe('normalizeScan / normalizePin', () => {
  it('fills defaults for missing pin fields', () => {
    const pin = normalizePin({ label: 'desk' }, 4);
    expect(pin.id).toBe('pin-5');
    expect(pin.source).toBe('CvServer');
    expect(pin.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(pin.position_anchor_local).toEqual({ x: 0, y: 0, z: 0 });
    expect(pin.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(pin.hit_type).toBe('fallback');
    expect(pin.placement_confidence).toBe(1);
  });

  it('anchor-local defaults to the world position', () => {
    const pin = normalizePin({ position: { x: 1, y: 2, z: 3 } });
    expect(pin.position_anchor_local).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('does not mutate the input scan', () => {
    const before = JSON.stringify(SCAN);
    normalizeScan(SCAN);
    expect(JSON.stringify(SCAN)).toBe(before);
  });

  it('recomputes a missing floorplan, excluding fallback pins', () => {
    const scan = normalizeScan(SCAN);
    expect(scan.floorplan.bounds.max.x).toBe(1);   // ghost at x=50 excluded
    expect(scan.floorplan.cv_pin_count).toBe(2);
    expect(scan.floorplan.scene_pin_count).toBe(1);
  });
});

describe('updatePin', () => {
  it('updates label/confidence and keeps other pins untouched', () => {
    const next = updatePin(SCAN, 'p1', { label: 'armchair', confidence: 0.5 });
    const p1 = next.pins.find(p => p.id === 'p1');
    expect(p1.label).toBe('armchair');
    expect(p1.confidence).toBe(0.5);
    expect(next.pins.find(p => p.id === 'p2').label).toBe('wall');
  });

  it('merges partial position updates and recomputes the floorplan', () => {
    const next = updatePin(SCAN, 'p1', { position: { x: 4 } });
    const p1 = next.pins.find(p => p.id === 'p1');
    expect(p1.position).toEqual({ x: 4, y: 0.5, z: -2 });
    expect(p1.position_anchor_local.x).toBe(4);
    expect(next.floorplan.bounds.max.x).toBe(4);
  });

  it('is a no-op for unknown pin ids', () => {
    const next = updatePin(SCAN, 'nope', { label: 'x' });
    expect(next.pins.map(p => p.label)).toEqual(['chair', 'wall', 'ghost']);
  });
});

describe('removePin', () => {
  it('removes the pin and recomputes counts', () => {
    const next = removePin(SCAN, 'p1');
    expect(next.pins).toHaveLength(2);
    expect(next.floorplan.cv_pin_count).toBe(1);
  });

  it('floorplan becomes null when no placed pins remain', () => {
    const onlyFallback = removePin(removePin(SCAN, 'p1'), 'p2');
    expect(onlyFallback.floorplan).toBeNull();
  });
});

describe('scanToJson / computeFloorplan', () => {
  it('produces parseable, normalized JSON', () => {
    const parsed = JSON.parse(scanToJson(SCAN));
    expect(parsed.version).toBe('1.1');
    expect(parsed.anchor_uuid).toBe('a1');
    expect(parsed.pins).toHaveLength(3);
  });

  it('computeFloorplan uses anchor-local positions when present', () => {
    const fp = computeFloorplan([
      normalizePin({ id: 'a', hit_type: 'mesh',
        position: { x: 100, y: 0, z: 0 },
        position_anchor_local: { x: 1, y: 0, z: 0 } }),
    ]);
    expect(fp.bounds.max.x).toBe(1);
  });
});
