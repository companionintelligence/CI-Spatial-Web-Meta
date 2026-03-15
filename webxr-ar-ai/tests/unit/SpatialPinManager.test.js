/**
 * Unit tests for SpatialPinManager — unified pin store with EventTarget events.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpatialPinManager } from '../../src/spatial/SpatialPinManager.js';
import { SpatialPin, PinSource } from '../../src/spatial/SpatialPin.js';

/** Helper: build a pin with convenient overrides. */
function makePin(overrides = {}) {
  const p = new SpatialPin();
  Object.assign(p, overrides);
  return p;
}

describe('SpatialPinManager — constructor', () => {
  it('creates an empty store', () => {
    const m = new SpatialPinManager();
    expect(m.pins).toHaveLength(0);
  });

  it('is an EventTarget', () => {
    const m = new SpatialPinManager();
    expect(m).toBeInstanceOf(EventTarget);
  });

  it('respects mergeByTrackId option (default true)', () => {
    const m = new SpatialPinManager();
    expect(m.mergeByTrackId).toBe(true);
  });

  it('respects mergeByTrackId=false option', () => {
    const m = new SpatialPinManager({ mergeByTrackId: false });
    expect(m.mergeByTrackId).toBe(false);
  });

  it('respects stalePinAgeMs option', () => {
    const m = new SpatialPinManager({ stalePinAgeMs: 5000 });
    expect(m.stalePinAgeMs).toBe(5000);
  });
});

describe('SpatialPinManager — addOrUpdate()', () => {
  let mgr;
  beforeEach(() => { mgr = new SpatialPinManager(); });

  it('adds a new pin and returns it', () => {
    const p = makePin({ label: 'chair' });
    const returned = mgr.addOrUpdate(p);
    expect(returned).toBe(p);
    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].label).toBe('chair');
  });

  it('fires "add" event with the pin', () => {
    const p = makePin();
    let addedPin;
    mgr.addEventListener('add', (e) => { addedPin = e.pin; });
    mgr.addOrUpdate(p);
    expect(addedPin).toBe(p);
  });

  it('updates existing pin when trackId + source match', () => {
    const p1 = makePin({ label: 'chair', trackId: 'track-1', source: PinSource.CvServer });
    p1.worldPosition = { x: 1, y: 0, z: 0 };
    mgr.addOrUpdate(p1);

    const p2 = makePin({ label: 'chair', trackId: 'track-1', source: PinSource.CvServer });
    p2.worldPosition = { x: 5, y: 0, z: 0 };
    const returned = mgr.addOrUpdate(p2);

    // Should still have only 1 pin
    expect(mgr.pins).toHaveLength(1);
    // The existing pin's position should be updated
    expect(mgr.pins[0].worldPosition).toEqual({ x: 5, y: 0, z: 0 });
    // Returns the existing (updated) pin
    expect(returned).toBe(p1);
  });

  it('fires "update" event (not "add") when merging', () => {
    const p1 = makePin({ trackId: 'track-1', source: PinSource.CvServer });
    mgr.addOrUpdate(p1);

    const addCalls = [], updateCalls = [];
    mgr.addEventListener('add',    (e) => addCalls.push(e.pin));
    mgr.addEventListener('update', (e) => updateCalls.push(e.pin));

    const p2 = makePin({ trackId: 'track-1', source: PinSource.CvServer });
    mgr.addOrUpdate(p2);

    expect(addCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
  });

  it('does NOT merge when source differs despite same trackId', () => {
    const p1 = makePin({ trackId: 'same', source: PinSource.CvServer });
    const p2 = makePin({ trackId: 'same', source: PinSource.MetaScene });
    mgr.addOrUpdate(p1);
    mgr.addOrUpdate(p2);
    expect(mgr.pins).toHaveLength(2);
  });

  it('always adds new pin when trackId is null (even with mergeByTrackId)', () => {
    const p1 = makePin({ trackId: null, source: PinSource.CvServer });
    const p2 = makePin({ trackId: null, source: PinSource.CvServer });
    mgr.addOrUpdate(p1);
    mgr.addOrUpdate(p2);
    expect(mgr.pins).toHaveLength(2);
  });

  it('always adds duplicate when mergeByTrackId=false', () => {
    const mgr2 = new SpatialPinManager({ mergeByTrackId: false });
    const p1 = makePin({ trackId: 'same', source: PinSource.CvServer });
    const p2 = makePin({ trackId: 'same', source: PinSource.CvServer });
    mgr2.addOrUpdate(p1);
    mgr2.addOrUpdate(p2);
    expect(mgr2.pins).toHaveLength(2);
  });

  it('gracefully ignores null pin', () => {
    expect(() => mgr.addOrUpdate(null)).not.toThrow();
    expect(mgr.pins).toHaveLength(0);
  });

  it('merge preserves existing florenceCaption if new one is null', () => {
    const p1 = makePin({ trackId: 't', source: PinSource.CvServer, florenceCaption: 'a nice room' });
    mgr.addOrUpdate(p1);
    const p2 = makePin({ trackId: 't', source: PinSource.CvServer, florenceCaption: null });
    mgr.addOrUpdate(p2);
    expect(mgr.pins[0].florenceCaption).toBe('a nice room');
  });

  it('merge updates florenceCaption when new one is provided', () => {
    const p1 = makePin({ trackId: 't', source: PinSource.CvServer, florenceCaption: 'old' });
    mgr.addOrUpdate(p1);
    const p2 = makePin({ trackId: 't', source: PinSource.CvServer, florenceCaption: 'new caption' });
    mgr.addOrUpdate(p2);
    expect(mgr.pins[0].florenceCaption).toBe('new caption');
  });
});

describe('SpatialPinManager — remove()', () => {
  let mgr, pin;
  beforeEach(() => {
    mgr = new SpatialPinManager();
    pin = makePin({ label: 'table' });
    mgr.addOrUpdate(pin);
  });

  it('removes pin by id and returns true', () => {
    const result = mgr.remove(pin.id);
    expect(result).toBe(true);
    expect(mgr.pins).toHaveLength(0);
  });

  it('fires "remove" event with the pinId', () => {
    let removedId;
    mgr.addEventListener('remove', (e) => { removedId = e.pinId; });
    mgr.remove(pin.id);
    expect(removedId).toBe(pin.id);
  });

  it('returns false for non-existent id', () => {
    const result = mgr.remove('does-not-exist');
    expect(result).toBe(false);
  });

  it('does not alter other pins', () => {
    const other = makePin({ label: 'sofa' });
    mgr.addOrUpdate(other);
    mgr.remove(pin.id);
    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].label).toBe('sofa');
  });
});

describe('SpatialPinManager — clearAll()', () => {
  it('empties the store and fires "clear" event', () => {
    const mgr = new SpatialPinManager();
    mgr.addOrUpdate(makePin());
    mgr.addOrUpdate(makePin());

    let cleared = false;
    mgr.addEventListener('clear', () => { cleared = true; });
    mgr.clearAll();

    expect(mgr.pins).toHaveLength(0);
    expect(cleared).toBe(true);
  });
});

describe('SpatialPinManager — clearSource()', () => {
  it('removes only pins of the specified source', () => {
    const mgr = new SpatialPinManager();
    const cv1 = makePin({ source: PinSource.CvServer  });
    const cv2 = makePin({ source: PinSource.CvServer  });
    const ms1 = makePin({ source: PinSource.MetaScene });
    mgr.addOrUpdate(cv1);
    mgr.addOrUpdate(cv2);
    mgr.addOrUpdate(ms1);

    mgr.clearSource(PinSource.CvServer);

    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0].source).toBe(PinSource.MetaScene);
  });

  it('fires "remove" events for each removed pin', () => {
    const mgr = new SpatialPinManager();
    const p1 = makePin({ source: PinSource.CvServer });
    const p2 = makePin({ source: PinSource.CvServer });
    mgr.addOrUpdate(p1);
    mgr.addOrUpdate(p2);

    const removed = [];
    mgr.addEventListener('remove', (e) => removed.push(e.pinId));
    mgr.clearSource(PinSource.CvServer);

    expect(removed).toContain(p1.id);
    expect(removed).toContain(p2.id);
  });
});

describe('SpatialPinManager — bySource()', () => {
  it('returns only pins of matching source', () => {
    const mgr = new SpatialPinManager();
    mgr.addOrUpdate(makePin({ source: PinSource.CvServer  }));
    mgr.addOrUpdate(makePin({ source: PinSource.MetaScene }));
    mgr.addOrUpdate(makePin({ source: PinSource.CvServer  }));

    expect(mgr.bySource(PinSource.CvServer)).toHaveLength(2);
    expect(mgr.bySource(PinSource.MetaScene)).toHaveLength(1);
  });

  it('returns empty array when no pins of that source', () => {
    const mgr = new SpatialPinManager();
    expect(mgr.bySource(PinSource.MetaScene)).toHaveLength(0);
  });
});

describe('SpatialPinManager — pins getter', () => {
  it('returns a new array snapshot each time', () => {
    const mgr = new SpatialPinManager();
    mgr.addOrUpdate(makePin());
    const arr1 = mgr.pins;
    const arr2 = mgr.pins;
    expect(arr1).not.toBe(arr2); // different references
    expect(arr1).toEqual(arr2);  // same content
  });
});

describe('SpatialPinManager — pruneStale()', () => {
  it('removes pins older than stalePinAgeMs', async () => {
    const mgr = new SpatialPinManager({ stalePinAgeMs: 50 });
    const old = makePin();
    old.createdAt = Date.now() - 200; // already old
    mgr.addOrUpdate(old);

    const fresh = makePin();
    mgr.addOrUpdate(fresh);

    mgr.pruneStale();
    expect(mgr.pins).toHaveLength(1);
    expect(mgr.pins[0]).toBe(fresh);
  });

  it('does nothing when stalePinAgeMs is 0 (disabled)', () => {
    const mgr = new SpatialPinManager({ stalePinAgeMs: 0 });
    const p = makePin();
    p.createdAt = Date.now() - 99999;
    mgr.addOrUpdate(p);
    mgr.pruneStale();
    expect(mgr.pins).toHaveLength(1);
  });

  it('fires "remove" for each stale pin', () => {
    const mgr = new SpatialPinManager({ stalePinAgeMs: 10 });
    const p = makePin();
    p.createdAt = Date.now() - 100;
    mgr.addOrUpdate(p);

    const removed = [];
    mgr.addEventListener('remove', (e) => removed.push(e.pinId));
    mgr.pruneStale();
    expect(removed).toContain(p.id);
  });
});
