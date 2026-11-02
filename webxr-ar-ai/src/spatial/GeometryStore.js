/**
 * GeometryStore — keeps the room-geometry snapshots in IndexedDB so an export
 * made after a reload still contains the room, not only the pins.
 *
 * localStorage (about 5 MB, strings only) cannot hold room meshes; IndexedDB
 * stores typed arrays natively through structured clone. The store holds a
 * single record, the latest full snapshot set. Operations run one at a time,
 * so a save can never overtake a clear. Every failure is logged and degrades
 * to "no stored geometry" rather than breaking the scan.
 */

const DB_NAME    = 'companion-scan';
const DB_VERSION = 1;
const STORE_NAME = 'geometry';
const RECORD_KEY = 'current';
export const GEOMETRY_RECORD_VERSION = 1;

export class GeometryStore {
  /**
   * @param {IDBFactory | null} [idb] injectable for tests; defaults to indexedDB
   */
  constructor(idb = globalThis.indexedDB ?? null) {
    this._idb       = idb;
    this._dbPromise = null;
    this._queue     = Promise.resolve();
  }

  /** Resolves once every operation queued so far has finished. */
  flush() {
    return this._queue;
  }

  /** @returns {Promise<Array<object>>} stored snapshot records, or [] */
  load() {
    return this._enqueue(async () => {
      const record = await this._request('readonly', store => store.get(RECORD_KEY));
      return Array.isArray(record?.objects) ? record.objects : [];
    }).catch(err => {
      console.warn('[GeometryStore] load failed:', err);
      return [];
    });
  }

  /**
   * @param {Array<object>} objects  records from SceneGeometrySnapshot.serialize()
   * @returns {Promise<boolean>} true once the write has committed
   */
  save(objects) {
    const record = { version: GEOMETRY_RECORD_VERSION, saved_at: Date.now(), objects };
    return this._enqueue(() => this._request('readwrite', store => store.put(record, RECORD_KEY)))
      .then(() => true)
      .catch(err => {
        console.warn('[GeometryStore] save failed:', err);
        return false;
      });
  }

  clear() {
    return this._enqueue(() => this._request('readwrite', store => store.delete(RECORD_KEY)))
      .then(() => true)
      .catch(err => {
        console.warn('[GeometryStore] clear failed:', err);
        return false;
      });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Chain an operation after the previous one; a failure does not stop the chain. */
  _enqueue(fn) {
    const run = this._queue.then(fn);
    this._queue = run.catch(() => {});
    return run;
  }

  /**
   * Run one request in its own transaction and resolve once it has committed.
   * @param {'readonly' | 'readwrite'} mode
   * @param {(store: IDBObjectStore) => IDBRequest} op
   */
  async _request(mode, op) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, mode);
      const req = op(tx.objectStore(STORE_NAME));
      let result;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  _open() {
    if (!this._idb) return Promise.reject(new Error('IndexedDB is unavailable'));
    if (!this._dbPromise) {
      this._dbPromise = new Promise((resolve, reject) => {
        const req = this._idb.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB open is blocked'));
      });
      // Allow a retry on the next operation if opening failed.
      this._dbPromise.catch(() => { this._dbPromise = null; });
    }
    return this._dbPromise;
  }
}
