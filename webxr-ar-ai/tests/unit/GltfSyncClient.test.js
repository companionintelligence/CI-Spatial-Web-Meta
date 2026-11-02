/**
 * Unit tests for GltfSyncClient — exports the scan and uploads it to the CV
 * server. The exporter is mocked; the upload is a stub.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../../src/export/GltfExporter.js', () => ({
  exportGltf: vi.fn(async () => new ArrayBuffer(16)),
}));

const { GltfSyncClient } = await import('../../src/export/GltfSyncClient.js');
const { exportGltf } = await import('../../src/export/GltfExporter.js');
const { SpatialPinManager } = await import('../../src/spatial/SpatialPinManager.js');

const scanRoot = (anchorUuid = 'anchor-1') => ({
  geometryRoot: new THREE.Group(),
  anchorUuid,
  worldToAnchorLocal: (p) => p,
});

describe('GltfSyncClient.sync', () => {
  it('exports the scan with its anchor and uploads it under a timestamped name', async () => {
    const uploadGltf = vi.fn(async (glb, name) => ({ status: 'saved', path: `/store/${name}`, bytes: glb.byteLength }));
    const root = scanRoot();
    const pins = new SpatialPinManager();

    const result = await new GltfSyncClient({ uploadGltf }).sync(root, pins);

    expect(exportGltf).toHaveBeenCalledWith(root.geometryRoot, pins, expect.objectContaining({ anchorUuid: 'anchor-1' }));
    const [glb, name] = uploadGltf.mock.calls[0];
    expect(glb.byteLength).toBe(16);
    expect(name).toMatch(/^companion-scan-.*\.glb$/);
    expect(result).toEqual({ status: 'saved', path: `/store/${name}`, bytes: 16 });
  });

  it('passes a null anchor through when the platform has none', async () => {
    const uploadGltf = vi.fn(async () => ({ status: 'saved', path: '/x.glb', bytes: 16 }));
    await new GltfSyncClient({ uploadGltf }).sync(scanRoot(null), new SpatialPinManager());

    expect(exportGltf).toHaveBeenLastCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ anchorUuid: null }));
  });

  it('propagates an upload failure to the caller', async () => {
    const uploadGltf = vi.fn(async () => { throw new Error('glTF upload failed: 503'); });
    await expect(new GltfSyncClient({ uploadGltf }).sync(scanRoot(), new SpatialPinManager()))
      .rejects.toThrow('503');
  });
});
