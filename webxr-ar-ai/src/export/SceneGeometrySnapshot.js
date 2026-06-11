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
 * Snapshot meshes are invisible (zero render cost); the exporter runs with
 * `onlyVisible: false`.
 */

import * as THREE from 'three';
import { XRPlane, XRMesh } from '@iwsdk/core';

export class SceneGeometrySnapshot {
  /**
   * @param {import('../spatial/ScanAnchorRoot.js').ScanAnchorRoot} scanRoot
   */
  constructor(scanRoot) {
    this.scanRoot = scanRoot;
    this.root     = scanRoot.geometryRoot;
    /** @type {Map<object, THREE.Mesh>} native XRPlane/XRMesh → snapshot mesh */
    this._snapshots = new Map();
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

    for (const entity of planeEntities) {
      const native = entity.getValue(XRPlane, '_plane');
      if (native && entity.object3D) {
        this._snapshotEntity(native, entity.object3D, {
          kind:          'plane',
          semanticLabel: native.semanticLabel ?? null,
          orientation:   native.orientation ?? null,
        });
      }
    }
    for (const entity of meshEntities) {
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

  clear() {
    for (const mesh of this._snapshots.values()) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this._snapshots.clear();
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
}

// One shared material for all snapshots — they are never rendered.
const _snapshotMaterial = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true });
