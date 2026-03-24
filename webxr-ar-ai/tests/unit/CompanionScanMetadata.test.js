import { describe, expect, it } from 'vitest';
import {
  applyMetadataToObject,
  createDemoMetadata,
  createEmptyMetadata,
  extractCompanionScanMetadata,
  metadataToJson,
  updateMetadataPin,
} from '../../src/viewer/companionScanMetadata.js';

describe('companionScanMetadata', () => {
  it('returns empty metadata when no companion_scan payload is present', () => {
    expect(extractCompanionScanMetadata({ scene: { userData: {} } })).toEqual(createEmptyMetadata());
  });

  it('extracts metadata from scene extras in loaded glTF data', () => {
    const metadata = extractCompanionScanMetadata({
      scene: {
        userData: {
          companion_scan: {
            session_id: 'session-1',
            pins: [{ id: 'pin-1', source: 'MetaScene', position: { x: 1, y: 2, z: 3 } }],
          },
        },
      },
    });

    expect(metadata.session_id).toBe('session-1');
    expect(metadata.pins[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(metadata.floorplan.bounds.max).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('falls back to parser json scene extras when userData is missing', () => {
    const metadata = extractCompanionScanMetadata({
      parser: {
        json: {
          scene: 0,
          scenes: [{
            extras: {
              companion_scan: {
                pins: [{ id: 'pin-2', source: 'CvServer', position: { x: -1, y: 0, z: 2 } }],
              },
            },
          }],
        },
      },
    });

    expect(metadata.pins).toHaveLength(1);
    expect(metadata.floorplan.cv_pin_count).toBe(1);
    expect(metadata.floorplan.scene_pin_count).toBe(0);
  });

  it('updates an existing pin while preserving a normalised schema', () => {
    const next = updateMetadataPin(createDemoMetadata(), 'pin-demo-chair', {
      label: 'Updated Chair',
      position: { x: 1.25 },
    });

    const pin = next.pins.find(item => item.id === 'pin-demo-chair');
    expect(pin.label).toBe('Updated Chair');
    expect(pin.position).toEqual({ x: 1.25, y: 0.45, z: -0.85 });
    expect(next.floorplan.bounds.max.x).toBe(1.25);
  });

  it('applies metadata to an object in exporter-compatible fields', () => {
    const target = { userData: {} };
    const metadata = applyMetadataToObject(target, createDemoMetadata());

    expect(target.userData.companion_scan).toEqual(metadata);
    expect(target.userData.gltfExtras.companion_scan).toEqual(metadata);
  });

  it('serialises metadata as readable JSON', () => {
    const json = metadataToJson(createDemoMetadata());
    expect(json).toContain('"session_id": "demo-session"');
    expect(json).toContain('"pins"');
  });
});
