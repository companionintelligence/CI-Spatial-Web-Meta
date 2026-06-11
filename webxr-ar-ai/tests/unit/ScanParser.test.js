/**
 * Unit tests for the viewer's scanParser helpers.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  extractCompanionScan,
  pinDisplayPosition,
  summarizeScan,
} from '../../src/viewer/scanParser.js';

describe('extractCompanionScan', () => {
  it('finds the block on the root userData (current export format)', () => {
    const root = new THREE.Group();
    root.userData.companion_scan = { version: '1.1', pins: [] };
    expect(extractCompanionScan(root)).toEqual({ version: '1.1', pins: [] });
  });

  it('finds the block on a nested child node', () => {
    const root  = new THREE.Group();
    const inner = new THREE.Group();
    const leaf  = new THREE.Group();
    leaf.userData.companion_scan = { version: '1.1', pins: [{ label: 'x' }] };
    inner.add(leaf);
    root.add(inner);
    expect(extractCompanionScan(root)?.pins).toHaveLength(1);
  });

  it('supports the legacy gltfExtras nesting', () => {
    const root = new THREE.Group();
    root.userData.gltfExtras = { companion_scan: { version: '1.0', pins: [] } };
    expect(extractCompanionScan(root)?.version).toBe('1.0');
  });

  it('returns null when no scan block exists', () => {
    expect(extractCompanionScan(new THREE.Group())).toBeNull();
  });
});

describe('pinDisplayPosition', () => {
  it('prefers the anchor-local position', () => {
    const pin = {
      position:              { x: 1, y: 2, z: 3 },
      position_anchor_local: { x: 9, y: 8, z: 7 },
    };
    expect(pinDisplayPosition(pin)).toEqual({ x: 9, y: 8, z: 7 });
  });

  it('falls back to world position, then origin', () => {
    expect(pinDisplayPosition({ position: { x: 1, y: 2, z: 3 } })).toEqual({ x: 1, y: 2, z: 3 });
    expect(pinDisplayPosition({})).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('summarizeScan', () => {
  it('counts pins by source and formats bounds', () => {
    const s = summarizeScan({
      exported_at: '2026-06-11T00:00:00Z',
      anchor_uuid: 'abc',
      pins: [
        { source: 'CvServer' },
        { source: 'CvServer' },
        { source: 'MetaScene' },
      ],
      floorplan: {
        bounds: { min: { x: -2, y: 0, z: -3 }, max: { x: 2, y: 2.5, z: 3 } },
      },
    });

    expect(s.pinCount).toBe(3);
    expect(s.cvCount).toBe(2);
    expect(s.sceneCount).toBe(1);
    expect(s.boundsSize).toBe('4.0 × 2.5 × 6.0 m');
    expect(s.anchorUuid).toBe('abc');
  });

  it('handles empty / missing fields', () => {
    const s = summarizeScan({});
    expect(s.pinCount).toBe(0);
    expect(s.boundsSize).toBeNull();
    expect(s.exportedAt).toBeNull();
    expect(s.anchorUuid).toBeNull();
  });
});
