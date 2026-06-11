/**
 * Unit tests for ScanReport — Markdown report generation.
 */
import { describe, it, expect } from 'vitest';
import { buildScanReport } from '../../src/export/ScanReport.js';

const SCAN = {
  session_id:  'sess-1',
  exported_at: '2026-06-11T12:00:00Z',
  anchor_uuid: 'anchor-1',
  pins: [
    {
      source: 'MetaScene', label: 'wall', hit_type: 'plane',
      position_anchor_local: { x: 0, y: 1.5, z: -3 },
      plane_extents: { center: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 0, z: 2.5 } },
    },
    {
      source: 'MetaScene', label: 'table', hit_type: 'mesh',
      position: { x: 1, y: 0.7, z: -1 },
      volume_extents: { center: { x: 0, y: 0, z: 0 }, size: { x: 1.2, y: 0.75, z: 0.8 } },
    },
    {
      source: 'CvServer', label: 'chair', confidence: 0.87, hit_type: 'mesh',
      position_anchor_local: { x: 1.25, y: 0.5, z: -2 },
      florence_caption: 'a cozy living room with a chair',
    },
    {
      source: 'CvServer', label: 'lamp', confidence: 0.6, hit_type: 'fallback',
      placement_confidence: 0.5,
      position: { x: 0, y: 1, z: -2.5 },
    },
  ],
  floorplan: {
    bounds: { min: { x: -2, y: 0, z: -3 }, max: { x: 2, y: 2.5, z: 3 } },
  },
};

describe('buildScanReport', () => {
  const md = buildScanReport(SCAN);

  it('includes the header summary', () => {
    expect(md).toContain('# Companion Scan Report');
    expect(md).toContain('| Session | `sess-1` |');
    expect(md).toContain('| Anchor UUID | `anchor-1` |');
    expect(md).toContain('| Pins | 4 (2 detections · 2 scene surfaces) |');
    expect(md).toContain('| Room bounds | 4.0 × 2.5 × 6.0 m |');
  });

  it('lists scene surfaces with extents', () => {
    expect(md).toContain('## Room structure (WebXR Scene Understanding)');
    expect(md).toContain('| wall | plane | (0.00, 1.50, -3.00) | 4.00 × 2.50 m |');
    expect(md).toContain('| table | mesh | (1.00, 0.70, -1.00) | 1.20 × 0.75 × 0.80 m |');
  });

  it('lists detections with confidence and placement', () => {
    expect(md).toContain('## Detected objects (CV pipeline)');
    expect(md).toContain('| chair | 87% | on room mesh | (1.25, 0.50, -2.00) |');
    expect(md).toContain('| lamp | 60% | estimated (50%) | (0.00, 1.00, -2.50) |');
  });

  it('quotes Florence captions once', () => {
    expect(md).toContain('### Scene descriptions (Florence-2)');
    expect(md).toContain('> a cozy living room with a chair');
    expect(md.match(/a cozy living room/g)).toHaveLength(1);
  });

  it('handles an empty scan', () => {
    const empty = buildScanReport({ pins: [] });
    expect(empty).toContain('_No pins captured._');
    expect(empty).not.toContain('## Room structure');
    expect(empty).not.toContain('## Detected objects');
  });

  it('prefers anchor-local positions and falls back to world', () => {
    expect(md).toContain('(1.25, 0.50, -2.00)');   // anchor-local used
    expect(md).toContain('(1.00, 0.70, -1.00)');   // world fallback
  });
});
