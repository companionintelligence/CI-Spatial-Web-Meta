/**
 * GltfSyncClient — uploads a glTF export to the CV server at POST /v1/gltf.
 *
 * Usage:
 *   const syncer = new GltfSyncClient(cvClient);
 *   await syncer.sync(scanRoot, pinManager);
 */

import { exportGltf } from './GltfExporter.js';

export class GltfSyncClient {
  /**
   * @param {import('../cv/CvServerClient.js').CvServerClient} cvClient
   */
  constructor(cvClient) {
    this.cvClient = cvClient;
  }

  /**
   * Export and upload the scan geometry + pins.
   * @param {import('../spatial/ScanAnchorRoot.js').ScanAnchorRoot} scanRoot
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
   * @returns {Promise<{status:string, path:string, bytes:number}>}
   */
  async sync(scanRoot, pinManager) {
    const glb = await exportGltf(scanRoot.geometryRoot, pinManager, {
      anchorUuid:         scanRoot.anchorUuid,
      worldToAnchorLocal: p => scanRoot.worldToAnchorLocal(p),
    });
    const ts       = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `companion-scan-${ts}.glb`;
    const result   = await this.cvClient.uploadGltf(glb, filename);
    console.log(`[GltfSyncClient] Uploaded ${filename}: ${result.bytes} bytes → ${result.path}`);
    return result;
  }
}
