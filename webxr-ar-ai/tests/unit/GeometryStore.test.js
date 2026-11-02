/**
 * Unit tests for GeometryStore. A small in-memory IndexedDB stand-in drives the
 * real transaction code path (open → upgrade → request → oncomplete), with
 * structuredClone standing in for IndexedDB's structured-clone storage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeometryStore } from '../../src/spatial/GeometryStore.js';

/** Minimal IDBFactory double: one object store, async callbacks like the real API. */
function fakeIndexedDB() {
  const data = new Map();

  const makeRequest = (work, tx) => {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      req.result = work();
      req.onsuccess?.();
      setTimeout(() => tx.oncomplete?.(), 0);
    }, 0);
    return req;
  };

  const makeDb = () => ({
    createObjectStore() {},
    transaction() {
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      const store = {
        get:    (key) => makeRequest(() => data.get(key), tx),
        put:    (value, key) => makeRequest(() => { data.set(key, structuredClone(value)); }, tx),
        delete: (key) => makeRequest(() => { data.delete(key); }, tx),
      };
      tx.objectStore = () => store;
      return tx;
    },
  });

  return {
    _data: data,
    open() {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      setTimeout(() => {
        req.result = makeDb();
        req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}

const RECORD = [{
  kind: 'mesh',
  name: 'mesh',
  position: [1, 2, 3],
  attributes: { position: { itemSize: 3, array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) } },
  index: new Uint16Array([0, 1, 2]),
}];

describe('GeometryStore with IndexedDB', () => {
  let idb;
  beforeEach(() => { idb = fakeIndexedDB(); });

  it('loads an empty list before anything is saved', async () => {
    expect(await new GeometryStore(idb).load()).toEqual([]);
  });

  it('round-trips typed arrays through save and load', async () => {
    const store = new GeometryStore(idb);
    expect(await store.save(RECORD)).toBe(true);

    const loaded = await new GeometryStore(idb).load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].kind).toBe('mesh');
    expect(loaded[0].position).toEqual([1, 2, 3]);
    expect(loaded[0].attributes.position.array).toBeInstanceOf(Float32Array);
    expect(Array.from(loaded[0].attributes.position.array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(loaded[0].index).toBeInstanceOf(Uint16Array);
  });

  it('clear removes the stored record', async () => {
    const store = new GeometryStore(idb);
    await store.save(RECORD);
    expect(await store.clear()).toBe(true);
    expect(await store.load()).toEqual([]);
  });

  it('runs operations in order, so a clear issued after a save wins', async () => {
    const store = new GeometryStore(idb);
    const saved = store.save(RECORD);
    const cleared = store.clear();
    await Promise.all([saved, cleared]);
    expect(await store.load()).toEqual([]);
  });
});

describe('GeometryStore without IndexedDB', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loads an empty list instead of throwing', async () => {
    expect(await new GeometryStore(null).load()).toEqual([]);
  });

  it('reports a failed save as false instead of throwing', async () => {
    expect(await new GeometryStore(null).save(RECORD)).toBe(false);
  });

  it('reports a failed clear as false instead of throwing', async () => {
    expect(await new GeometryStore(null).clear()).toBe(false);
  });
});
