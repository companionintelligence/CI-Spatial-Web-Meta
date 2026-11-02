/**
 * Unit tests for GltfDownload — saves the scan GLB and its Markdown report
 * through the browser's download path. The exporter is mocked; the DOM and
 * object URLs are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

vi.mock('../../src/export/GltfExporter.js', () => ({
  exportGltf: vi.fn(async () => new ArrayBuffer(8)),
  buildScanMeta: vi.fn(() => ({
    version: '1.1',
    session_id: 'session-1',
    exported_at: '2026-11-01T00:00:00.000Z',
    anchor_uuid: null,
    pins: [],
    floorplan: null,
  })),
}));

const { downloadGlb, saveBlob } = await import('../../src/export/GltfDownload.js');
const { SpatialPinManager } = await import('../../src/spatial/SpatialPinManager.js');

let clicks;
let anchor;

beforeEach(() => {
  vi.useFakeTimers();
  clicks = [];
  anchor = { href: '', download: '', click: vi.fn(() => clicks.push(anchor.download)), remove: vi.fn() };
  vi.stubGlobal('document', {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => anchor),
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:scan');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('downloadGlb', () => {
  it('saves the GLB and the Markdown report under one timestamp', async () => {
    const scanRoot = { geometryRoot: new THREE.Group(), anchorUuid: null, worldToAnchorLocal: (p) => p };

    const name = await downloadGlb(scanRoot, new SpatialPinManager());

    expect(name).toMatch(/^companion-scan-.*\.glb$/);
    expect(clicks).toHaveLength(2);
    expect(clicks[0]).toBe(name);
    expect(clicks[1]).toBe(name.replace(/\.glb$/, '.md'));
  });

  it('removes the temporary link after each download', async () => {
    const scanRoot = { geometryRoot: new THREE.Group(), anchorUuid: null, worldToAnchorLocal: (p) => p };
    await downloadGlb(scanRoot, new SpatialPinManager());
    expect(anchor.remove).toHaveBeenCalledTimes(2);
    expect(document.body.appendChild).toHaveBeenCalledTimes(2);
  });
});

describe('saveBlob', () => {
  it('points a link at an object URL and clicks it', () => {
    saveBlob(new Blob(['x']), 'scan.md');

    expect(anchor.href).toBe('blob:scan');
    expect(anchor.download).toBe('scan.md');
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL after the download has had time to start', () => {
    saveBlob(new Blob(['x']), 'scan.md');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:scan');
  });
});
