/**
 * Unit tests for the test-home fixture library — validates that all 24 homes
 * produce structurally sound SEM environments and consistent expectations.
 */
import { describe, it, expect } from 'vitest';
import {
  TEST_HOMES,
  WEBXR_LABEL,
  homeToSemJson,
  expectedSceneSummary,
  homeToScanFixture,
} from '../../src/fixtures/homes.js';

describe('TEST_HOMES fixture library', () => {
  it('provides at least 20 distinct homes', () => {
    expect(TEST_HOMES.length).toBeGreaterThanOrEqual(20);
    const names = TEST_HOMES.map(h => h.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every furniture/decor label is in the SEM vocabulary', () => {
    for (const home of TEST_HOMES) {
      for (const [label] of home.furniture) {
        expect(WEBXR_LABEL[label], `${home.name}: ${label}`).toBeDefined();
      }
      for (const [label] of home.decor ?? []) {
        expect(WEBXR_LABEL[label], `${home.name}: ${label}`).toBeDefined();
      }
    }
  });

  it('variants are deterministic', () => {
    const a = JSON.stringify(TEST_HOMES.find(h => h.name === 'studio_alt'));
    const b = JSON.stringify(TEST_HOMES.find(h => h.name === 'studio_alt'));
    expect(a).toBe(b);
  });
});

describe('homeToSemJson', () => {
  for (const home of TEST_HOMES) {
    it(`${home.name}: produces a valid SEM environment`, () => {
      const sem = homeToSemJson(home);
      const expected = expectedSceneSummary(home);

      expect(sem.type).toBe('scene');
      const planes = sem.spatialEntities.filter(e => e.bounded2D_META);
      const boxes  = sem.spatialEntities.filter(e => e.bounded3D_META);
      expect(planes).toHaveLength(expected.planes);
      expect(boxes).toHaveLength(expected.meshes);

      for (const e of sem.spatialEntities) {
        expect(e.uuid).toBeTruthy();
        expect(e.semanticLabel_META).toBeTruthy();
        expect(e.locatable_META?.position).toBeDefined();
        const q = e.locatable_META.orientation;
        const norm = Math.hypot(q.x, q.y, q.z, q.w);
        expect(norm).toBeCloseTo(1, 3);
        // Extents must be positive
        const ext = e.bounded2D_META?.extent ?? e.bounded3D_META?.extent;
        expect(ext.width).toBeGreaterThan(0);
        expect(ext.height).toBeGreaterThan(0);
      }

      // Furniture must sit inside some room footprint (with small tolerance)
      for (const box of boxes) {
        const p = box.locatable_META.position;
        const inside = home.rooms.some(r =>
          Math.abs(p.x - r.x) <= r.w / 2 + 0.05 &&
          Math.abs(p.z - r.z) <= r.d / 2 + 0.05,
        );
        expect(inside, `${home.name}: ${box.semanticLabel_META} at (${p.x}, ${p.z}) outside rooms`).toBe(true);
        // Resting on the floor: centre height is half the box height
        expect(p.y).toBeCloseTo((box.bounded3D_META.extent.height) / 2, 5);
      }
    });
  }
});

describe('homeToScanFixture', () => {
  it('builds a viewer scan with pins for every room and furniture item', () => {
    const home = TEST_HOMES[0];
    const { scan, boxes } = homeToScanFixture(home);

    expect(scan.pins.length).toBe(home.rooms.length + home.furniture.length);
    expect(scan.floorplan.cv_pin_count).toBe(home.furniture.length);
    expect(boxes).toHaveLength(home.furniture.length);

    const bounds = scan.floorplan.bounds;
    for (const pin of scan.pins) {
      expect(pin.position.x).toBeGreaterThanOrEqual(bounds.min.x - 0.001);
      expect(pin.position.x).toBeLessThanOrEqual(bounds.max.x + 0.001);
    }
  });

  it('confidence values are deterministic and within (0, 1]', () => {
    const a = homeToScanFixture(TEST_HOMES[2]).scan.pins.map(p => p.confidence);
    const b = homeToScanFixture(TEST_HOMES[2]).scan.pins.map(p => p.confidence);
    expect(a).toEqual(b);
    for (const c of a.filter(Boolean)) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
