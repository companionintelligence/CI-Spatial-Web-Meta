/**
 * scanParser — pure helpers for reading companion_scan metadata out of a
 * loaded glTF scene graph. Kept DOM/renderer-free so it can be unit tested.
 */

/**
 * Find the companion_scan extras block anywhere in a loaded glTF object tree.
 * GLTFLoader maps node `extras` onto `Object3D.userData`; current exports put
 * the block at `userData.companion_scan`, older builds nested it under
 * `userData.gltfExtras`.
 *
 * @param {import('three').Object3D} root
 * @returns {object|null}
 */
export function extractCompanionScan(root) {
  let found = null;
  const visit = (obj) => {
    if (found || !obj) return;
    const ud = obj.userData ?? {};
    found = ud.companion_scan ?? ud.gltfExtras?.companion_scan ?? null;
    if (!found && obj.children) obj.children.forEach(visit);
  };
  visit(root);
  return found;
}

/**
 * Position to render a pin at. Geometry nodes in the export are
 * anchor-relative, so prefer the anchor-local position when present.
 *
 * @param {object} pin serialised pin from extras
 * @returns {{x:number,y:number,z:number}}
 */
export function pinDisplayPosition(pin) {
  return pin.position_anchor_local ?? pin.position ?? { x: 0, y: 0, z: 0 };
}

/**
 * Human-readable summary of a scan for the sidebar header.
 * @param {object} scan companion_scan extras block
 * @returns {{pinCount:number, cvCount:number, sceneCount:number, boundsSize:string|null, exportedAt:string|null, anchorUuid:string|null}}
 */
export function summarizeScan(scan) {
  const pins = scan?.pins ?? [];
  const cvCount    = pins.filter(p => p.source === 'CvServer').length;
  const sceneCount = pins.filter(p => p.source === 'MetaScene').length;

  let boundsSize = null;
  const b = scan?.floorplan?.bounds;
  if (b?.min && b?.max) {
    const dx = (b.max.x - b.min.x).toFixed(1);
    const dy = (b.max.y - b.min.y).toFixed(1);
    const dz = (b.max.z - b.min.z).toFixed(1);
    boundsSize = `${dx} × ${dy} × ${dz} m`;
  }

  return {
    pinCount:   pins.length,
    cvCount,
    sceneCount,
    boundsSize,
    exportedAt: scan?.exported_at ?? null,
    anchorUuid: scan?.anchor_uuid ?? null,
  };
}
