/**
 * Unit tests for SpatialPin — spatially-anchored observation data class.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialPin, PinSource } from '../../src/spatial/SpatialPin.js';

describe('PinSource enum', () => {
  it('has CvServer and MetaScene values', () => {
    expect(PinSource.CvServer).toBe('CvServer');
    expect(PinSource.MetaScene).toBe('MetaScene');
  });

  it('is frozen/immutable', () => {
    expect(() => { PinSource.CvServer = 'x'; }).toThrow();
  });
});

describe('SpatialPin — construction', () => {
  it('creates a pin with a string id', () => {
    const p = new SpatialPin();
    expect(typeof p.id).toBe('string');
    expect(p.id.startsWith('pin-')).toBe(true);
  });

  it('creates unique IDs for every instance', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(new SpatialPin().id);
    }
    expect(ids.size).toBe(50);
  });

  it('has sequential numeric prefix in IDs', () => {
    const p1 = new SpatialPin();
    const p2 = new SpatialPin();
    const n1 = parseInt(p1.id.split('-')[1], 10);
    const n2 = parseInt(p2.id.split('-')[1], 10);
    expect(n2).toBe(n1 + 1);
  });
});

describe('SpatialPin — default values', () => {
  let pin;
  beforeEach(() => { pin = new SpatialPin(); });

  it('defaults source to CvServer', () => {
    expect(pin.source).toBe(PinSource.CvServer);
  });

  it('defaults label to empty string', () => {
    expect(pin.label).toBe('');
  });

  it('defaults worldPosition to origin', () => {
    expect(pin.worldPosition).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('defaults worldRotation to identity quaternion', () => {
    expect(pin.worldRotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('defaults confidence to 0', () => {
    expect(pin.confidence).toBe(0);
  });

  it('defaults bboxCxCyWH to null', () => {
    expect(pin.bboxCxCyWH).toBeNull();
  });

  it('defaults hitType to "fallback"', () => {
    expect(pin.hitType).toBe('fallback');
  });

  it('defaults placementConfidence to 1', () => {
    expect(pin.placementConfidence).toBe(1);
  });

  it('defaults trackId to null', () => {
    expect(pin.trackId).toBeNull();
  });

  it('defaults captureFrameIndex to 0', () => {
    expect(pin.captureFrameIndex).toBe(0);
  });

  it('defaults captureId to empty string', () => {
    expect(pin.captureId).toBe('');
  });

  it('defaults captureSessionId to empty string', () => {
    expect(pin.captureSessionId).toBe('');
  });

  it('defaults semanticLabels to null', () => {
    expect(pin.semanticLabels).toBeNull();
  });

  it('defaults planeExtents to null', () => {
    expect(pin.planeExtents).toBeNull();
  });

  it('defaults volumeExtents to null', () => {
    expect(pin.volumeExtents).toBeNull();
  });

  it('defaults maskRleJson to null', () => {
    expect(pin.maskRleJson).toBeNull();
  });

  it('defaults florenceCaption to null', () => {
    expect(pin.florenceCaption).toBeNull();
  });

  it('createdAt is a recent timestamp', () => {
    const now = Date.now();
    expect(pin.createdAt).toBeGreaterThanOrEqual(now - 100);
    expect(pin.createdAt).toBeLessThanOrEqual(now + 100);
  });
});
