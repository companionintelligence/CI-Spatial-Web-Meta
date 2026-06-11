/**
 * GltfDownload — saves the scan GLB to the local device.
 *
 * On the Quest browser the file lands in the headset's Downloads folder, so
 * scans can be exported and inspected (e.g. in the desktop viewer at
 * /viewer.html) without a reachable CV server.
 */

import { exportGltf } from './GltfExporter.js';

/**
 * Export the scan and trigger a browser download.
 *
 * @param {import('../spatial/ScanAnchorRoot.js').ScanAnchorRoot} scanRoot
 * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
 * @returns {Promise<string>} the downloaded filename
 */
export async function downloadGlb(scanRoot, pinManager) {
  const glb = await exportGltf(scanRoot.geometryRoot, pinManager, {
    anchorUuid:         scanRoot.anchorUuid,
    worldToAnchorLocal: p => scanRoot.worldToAnchorLocal(p),
  });

  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `companion-scan-${ts}.glb`;
  saveBlob(new Blob([glb], { type: 'model/gltf-binary' }), filename);
  return filename;
}

/**
 * Trigger a browser download for a blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before revoking
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
