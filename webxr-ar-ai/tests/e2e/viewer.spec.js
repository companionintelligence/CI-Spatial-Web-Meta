/**
 * E2E tests for the desktop scan viewer (/viewer.html).
 *
 * The viewer renders exported companion-scan GLBs. Tests drive it through
 * the `window.__companionViewer` hook: `loadScan` renders metadata directly,
 * and a real GLB round trip is exercised by building one in-page with the
 * app's own exporter.
 */
import { test, expect } from '@playwright/test';

const SAMPLE_SCAN = {
  version: '1.1',
  session_id: 'sess-e2e',
  exported_at: '2026-06-11T12:00:00Z',
  anchor_uuid: 'anchor-e2e-uuid',
  pins: [
    {
      id: 'pin-1', source: 'CvServer', label: 'chair', confidence: 0.87,
      hit_type: 'mesh', position: { x: 1, y: 0.5, z: -2 },
      position_anchor_local: { x: 1, y: 0.5, z: -2 },
      florence_caption: 'a wooden chair',
    },
    {
      id: 'pin-2', source: 'MetaScene', label: 'wall', hit_type: 'plane',
      position: { x: 0, y: 1.5, z: -3 },
    },
  ],
  floorplan: {
    bounds: { min: { x: -2, y: 0, z: -3 }, max: { x: 2, y: 2.5, z: 3 } },
    cv_pin_count: 1, scene_pin_count: 1,
  },
};

test.describe('Scan viewer page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/viewer.html');
    await page.waitForFunction(() => !!window.__companionViewer);
  });

  test('loads with header, drop zone, and empty state', async ({ page }) => {
    await expect(page.locator('header h1')).toHaveText('Companion Scan Viewer');
    await expect(page.locator('#dropzone')).toBeVisible();
    await expect(page.locator('#empty-note')).toHaveText('No scan loaded');
    // Renderer canvas is mounted
    await expect(page.locator('#viewport canvas')).toHaveCount(1);
  });

  test('renders pins and stats from a scan block', async ({ page }) => {
    await page.evaluate((scan) => window.__companionViewer.loadScan(scan), SAMPLE_SCAN);

    await expect(page.locator('#pin-list li')).toHaveCount(2);
    await expect(page.locator('#pin-list li').first()).toContainText('chair 87%');
    await expect(page.locator('#pin-list li').nth(1)).toContainText('wall');

    const stats = page.locator('#scan-stats');
    await expect(stats).toContainText('2 (1 cv · 1 scene)');
    await expect(stats).toContainText('4.0 × 2.5 × 6.0 m');
    await expect(stats).toContainText('anchor-e2e-uuid');

    await expect(page.locator('#dropzone')).toBeHidden();

    const state = await page.evaluate(() => window.__companionViewer.getState());
    expect(state.pinCount).toBe(2);
    expect(state.hasContent).toBe(true);
  });

  test('round-trips a real GLB produced by the app exporter', async ({ page }) => {
    // Build a GLB in-page using the same three.js GLTFExporter the app uses,
    // with the companion_scan block in userData (mirrors GltfExporter.js).
    const result = await page.evaluate(async (scan) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { GLTFExporter } = await import(
        '/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
      );

      const root = new THREE.Group();
      root.name = 'companion-scan-geometry';
      const wallMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial(),
      );
      wallMesh.name = 'plane-wall';
      wallMesh.visible = false;          // snapshots are invisible at runtime
      root.add(wallMesh);
      root.userData.companion_scan = scan;

      const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(root, resolve, reject, {
          binary: true, embedImages: false, onlyVisible: false,
        });
      });

      await window.__companionViewer.loadGlb(glb);
      return window.__companionViewer.getState();
    }, SAMPLE_SCAN);

    expect(result.pinCount).toBe(2);
    expect(result.hasContent).toBe(true);
    await expect(page.locator('#pin-list li')).toHaveCount(2);
    await expect(page.locator('#scan-stats')).toContainText('anchor-e2e-uuid');
  });
});
