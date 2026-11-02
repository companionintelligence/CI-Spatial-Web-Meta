/**
 * SceneGeometrySnapshot — copies the real-world geometry captured by the
 * SceneUnderstandingSystem (plane boxes + room meshes) into the anchored
 * scan root so it survives session end and lands in the glTF export.
 *
 * The IWSDK plane/mesh entities are destroyed on `sessionend`, and their
 * geometry lives in session-relative coordinates. Snapshots are keyed by the
 * native XRPlane/XRMesh object so repeated captures update transforms in
 * place instead of duplicating geometry; geometry buffers are cloned once so
 * entity destruction can't invalidate the export payload.
 *
 * Persistence: serialize() turns the snapshots into plain records (typed
 * arrays and transforms) that GeometryStore keeps in IndexedDB, and restore()
 * rebuilds them after a reload so an export still contains the room. Restored
 * snapshots are provisional: native XRPlane/XRMesh objects do not survive a
 * reload, so the next capture that sees live planes or meshes replaces them.
 *
 * Snapshot meshes are invisible (zero render cost); the exporter runs with
 * `onlyVisible: false`.
 */

import * as THREE from 'three';
import { XRPlane, XRMesh } from '@iwsdk/core';
import { threeColor } from '../ui/theme.js';

export class SceneGeometrySnapshot {
  /**
   * @param {import('../spatial/ScanAnchorRoot.js').ScanAnchorRoot} scanRoot
   */
  constructor(scanRoot) {
    this.scanRoot = scanRoot;
    this.root     = scanRoot.geometryRoot;
    /** @type {Map<object, THREE.Mesh>} native XRPlane/XRMesh (or the mesh itself, when restored) → snapshot mesh */
    this._snapshots = new Map();
    /** @type {Set<THREE.Mesh>} snapshots rebuilt from storage, not from live entities */
    this._restored  = new Set();
    this._mat       = new THREE.Matrix4();
    this._rootInv   = new THREE.Matrix4();
  }

  /**
   * Snapshot the current plane + mesh entities. Call at capture time.
   * @param {Iterable<import('@iwsdk/core').Entity>} planeEntities
   * @param {Iterable<import('@iwsdk/core').Entity>} meshEntities
   */
  snapshot(planeEntities, meshEntities) {
    this.root.updateWorldMatrix(true, false);
    this._rootInv.copy(this.root.matrixWorld).invert();

    const planes = [...planeEntities];
    const meshes = [...meshEntities];
    // Live scene data is newer than anything restored from storage.
    if (planes.length + meshes.length > 0) this._dropRestored();

    for (const entity of planes) {
      const native = entity.getValue(XRPlane, '_plane');
      if (native && entity.object3D) {
        this._snapshotEntity(native, entity.object3D, {
          kind:          'plane',
          semanticLabel: native.semanticLabel ?? null,
          orientation:   native.orientation ?? null,
        });
      }
    }
    for (const entity of meshes) {
      const native = entity.getValue(XRMesh, '_mesh');
      if (native && entity.object3D) {
        this._snapshotEntity(native, entity.object3D, {
          kind:          'mesh',
          semanticLabel: native.semanticLabel ?? null,
        });
      }
    }
  }

  /** Number of snapshotted objects (for HUD / debugging). */
  get count() { return this._snapshots.size; }

  /** Snapshots rebuilt from storage that no live capture has replaced yet. */
  get restoredCount() { return this._restored.size; }

  clear() {
    for (const mesh of this._snapshots.values()) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this._snapshots.clear();
    this._restored.clear();
  }

  /**
   * Plain, structured-cloneable records of every snapshot, for GeometryStore.
   * Buffers are copied, so the records stay valid after later captures.
   * @returns {Array<object>}
   */
  serialize() {
    const records = [];
    for (const mesh of this._snapshots.values()) {
      const { geometry } = mesh;
      const meta = mesh.userData.companionScan;
      const attributes = {};
      for (const [name, attr] of Object.entries(geometry.attributes)) {
        attributes[name] = { itemSize: attr.itemSize, array: attr.array.slice() };
      }
      records.push({
        name:          mesh.name,
        kind:          meta.kind,
        semanticLabel: meta.semanticLabel ?? null,
        orientation:   meta.orientation ?? null,
        position:      mesh.position.toArray(),
        quaternion:    mesh.quaternion.toArray(),
        scale:         mesh.scale.toArray(),
        attributes,
        index:         geometry.index ? geometry.index.array.slice() : null,
      });
    }
    return records;
  }

  /**
   * Rebuild snapshots from serialize() records. Does nothing while live
   * snapshots exist, because those are newer.
   * @param {Array<object>} records
   * @returns {number} number of snapshots restored
   */
  restore(records) {
    if (!Array.isArray(records) || !records.length) return 0;
    if (this._snapshots.size > this._restored.size) return 0;

    this._dropRestored();
    let restored = 0;
    for (const record of records) {
      if (!record?.attributes?.position) continue;

      const geometry = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(record.attributes)) {
        geometry.setAttribute(name, new THREE.BufferAttribute(attr.array, attr.itemSize));
      }
      if (record.index) geometry.setIndex(new THREE.BufferAttribute(record.index, 1));

      const mesh = new THREE.Mesh(geometry, _snapshotMaterial);
      mesh.name = record.name ?? record.kind ?? 'snapshot';
      mesh.position.fromArray(record.position ?? [0, 0, 0]);
      mesh.quaternion.fromArray(record.quaternion ?? [0, 0, 0, 1]);
      mesh.scale.fromArray(record.scale ?? [1, 1, 1]);
      mesh.visible = false;
      mesh.userData.companionScan = {
        kind:          record.kind ?? 'mesh',
        semanticLabel: record.semanticLabel ?? null,
        orientation:   record.orientation ?? null,
      };

      this.root.add(mesh);
      this._snapshots.set(mesh, mesh);
      this._restored.add(mesh);
      restored++;
    }
    return restored;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _snapshotEntity(native, sourceObj, meta) {
    let snap = this._snapshots.get(native);
    if (!snap) {
      if (!sourceObj.geometry) return;
      snap = new THREE.Mesh(sourceObj.geometry.clone(), _snapshotMaterial);
      snap.name = meta.semanticLabel
        ? `${meta.kind}-${meta.semanticLabel}`.replace(/\s+/g, '_')
        : meta.kind;
      snap.visible = false;
      snap.userData.companionScan = meta;
      this.root.add(snap);
      this._snapshots.set(native, snap);
    }

    // Re-express the entity's world transform in scan-root local space so the
    // exported geometry is anchor-relative.
    sourceObj.updateWorldMatrix(true, false);
    this._mat.multiplyMatrices(this._rootInv, sourceObj.matrixWorld);
    this._mat.decompose(snap.position, snap.quaternion, snap.scale);
  }

  _dropRestored() {
    for (const mesh of this._restored) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      this._snapshots.delete(mesh);
    }
    this._restored.clear();
  }
}

// One shared material for all snapshots — they are never rendered on screen, but
// the glTF export carries the colour. Fixed to the canon light neutral so an
// export looks the same whatever scheme the browser is showing.
const _snapshotMaterial = new THREE.MeshBasicMaterial({
  color: threeColor('muted-foreground', 'light'),
  wireframe: true,
});
