/**
 * Unit tests for ScanStorage — localStorage persistence of the pin store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScanStorage, SCAN_STORAGE_KEY } from '../../src/spatial/ScanStorage.js';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { SpatialPin, PinSource } from '../../src/spatial/SpatialPin.js';

/** Minimal Storage implementation for Node. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem:    (k) => (map.has(k) ? map.get(k) : null),
    setItem:    (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

/** Scan root stub: anchor offset of (10, 0, 0). */
const scanRootStub = {
  worldToAnchorLocal: (p) => ({ x: p.x - 10, y: p.y, z: p.z }),
};

function makePin(overrides = {}) {
  const pin = new SpatialPin();
  Object.assign(pin, {
    source: PinSource.CvServer,
    label: 'chair',
    confidence: 0.9,
    trackId: 't-1',
    worldPosition: { x: 11, y: 1.5, z: -2 },
    hitType: 'mesh',
  }, overrides);
  return pin;
}

describe('ScanStorage — save/restore round trip', () => {
  let storage, mgr, store;

  beforeEach(() => {
    storage = fakeStorage();
    store   = new ScanStorage(storage);
    mgr     = new SpatialPinManager();
  });

  it('saves pins with anchor-local positions and reports the count', () => {
    mgr.addOrUpdate(makePin());
    mgr.addOrUpdate(makePin({ trackId: 't-2', label: 'desk' }));

    expect(store.save(mgr, scanRootStub)).toBe(2);

    const data = JSON.parse(storage.getItem(SCAN_STORAGE_KEY));
    expect(data.version).toBe(1);
    expect(data.pins).toHaveLength(2);
    expect(data.pins[0].anchorLocalPosition).toEqual({ x: 1, y: 1.5, z: -2 });
  });

  it('restores pins as anchor-local-authoritative', () => {
    mgr.addOrUpdate(makePin({ florenceCaption: 'a chair', semanticLabels: ['CHAIR'] }));
    store.save(mgr, scanRootStub);

    const fresh = new SpatialPinManager();
    expect(store.restore(fresh)).toBe(1);

    const pin = fresh.pins[0];
    expect(pin.label).toBe('chair');
    expect(pin.source).toBe(PinSource.CvServer);
    expect(pin.trackId).toBe('t-1');
    expect(pin.hitType).toBe('mesh');
    expect(pin.florenceCaption).toBe('a chair');
    expect(pin.semanticLabels).toEqual(['CHAIR']);
    expect(pin.anchorLocalPosition).toEqual({ x: 1, y: 1.5, z: -2 });
    // Best-effort world position mirrors the anchor-local value
    expect(pin.worldPosition).toEqual({ x: 1, y: 1.5, z: -2 });
  });

  it('keeps an existing anchorLocalPosition on re-save (no double conversion)', () => {
    const pin = makePin();
    pin.anchorLocalPosition = { x: 5, y: 5, z: 5 };
    mgr.addOrUpdate(pin);
    store.save(mgr, scanRootStub);

    const data = JSON.parse(storage.getItem(SCAN_STORAGE_KEY));
    expect(data.pins[0].anchorLocalPosition).toEqual({ x: 5, y: 5, z: 5 });
  });

  it('returns 0 when nothing is stored', () => {
    expect(store.restore(mgr)).toBe(0);
    expect(store.savedAt()).toBeNull();
  });

  it('clear removes the stored scan', () => {
    mgr.addOrUpdate(makePin());
    store.save(mgr, scanRootStub);
    store.clear();
    expect(storage.getItem(SCAN_STORAGE_KEY)).toBeNull();
    expect(store.restore(new SpatialPinManager())).toBe(0);
  });

  it('recovers from a corrupt store', () => {
    storage.setItem(SCAN_STORAGE_KEY, '{not json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(store.restore(mgr)).toBe(0);
    expect(storage.getItem(SCAN_STORAGE_KEY)).toBeNull();
    warnSpy.mockRestore();
  });

  it('drops SAM2 masks and retries when the first write fails (quota)', () => {
    const pin = makePin({ maskRleJson: JSON.stringify({ counts: [1, 2, 3] }) });
    mgr.addOrUpdate(pin);

    let calls = 0;
    const realSet = storage.setItem;
    storage.setItem = (k, v) => {
      calls++;
      if (calls === 1) throw new Error('QuotaExceededError');
      realSet(k, v);
    };

    expect(store.save(mgr, scanRootStub)).toBe(1);
    const data = JSON.parse(storage.getItem(SCAN_STORAGE_KEY));
    expect(data.pins[0].maskRleJson).toBeNull();
  });

  it('handles a missing storage backend gracefully', () => {
    const noStore = new ScanStorage(undefined);
    expect(noStore.save(mgr, scanRootStub)).toBe(0);
    expect(noStore.restore(mgr)).toBe(0);
    expect(() => noStore.clear()).not.toThrow();
  });
});
