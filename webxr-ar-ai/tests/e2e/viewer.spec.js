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
    await expect(page.locator('header h1')).toHaveText('Companion Scan Quest');
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

  test('Download Report produces a Markdown report for the loaded scan', async ({ page }) => {
    await page.evaluate((scan) => window.__companionViewer.loadScan(scan), SAMPLE_SCAN);
    await expect(page.locator('#report-btn')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.click('#report-btn');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^companion-scan-report-.*\.md$/);
    const path = await download.path();
    const fs = await import('fs');
    const md = fs.readFileSync(path, 'utf8');
    expect(md).toContain('# Companion Scan Report');
    expect(md).toContain('chair');
  });

  test('shows "CV server unreachable" when the glTF store is offline', async ({ page }) => {
    await page.route('**/v1/gltf', route => route.abort());
    await page.reload();
    await page.waitForFunction(() => !!window.__companionViewer);
    await expect(page.locator('#server-scans')).toContainText(/unreachable/i, {
      timeout: 15_000,
    });
  });

  test('lists server scans and loads one on click', async ({ page }) => {
    // Build a real GLB in-page (the server is not running in CI)
    const glbBase64 = await page.evaluate(async (scan) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { GLTFExporter } = await import(
        '/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
      );
      const root = new THREE.Group();
      root.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial()));
      root.userData.companion_scan = scan;
      const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(root, resolve, reject, { binary: true, onlyVisible: false });
      });
      // ArrayBuffer → base64 for transport back to the test runner
      let bin = '';
      const bytes = new Uint8Array(glb);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }, SAMPLE_SCAN);

    // Mock the CV server's glTF store endpoints
    await page.route('**/v1/gltf', route => route.fulfill({
      json: { files: [{ name: 'scan-a.glb', bytes: 2048, modified: '2026-06-11T12:00:00Z' }] },
    }));
    await page.route('**/v1/gltf/scan-a.glb', route => route.fulfill({
      contentType: 'model/gltf-binary',
      body: Buffer.from(glbBase64, 'base64'),
    }));

    await page.click('#scan-refresh');
    const item = page.locator('#server-scans li', { hasText: 'scan-a.glb' });
    await expect(item).toBeVisible();

    await item.click();
    await expect(page.locator('#pin-list li')).toHaveCount(2);
    await expect(page.locator('#scan-stats')).toContainText('anchor-e2e-uuid');
  });

  test('loads a sample home as editable test data', async ({ page }) => {
    await page.selectOption('#sample-select', 'studio');
    await expect(page.locator('#pin-list li')).toHaveCount(7);   // 1 room + 6 furniture
    const state = await page.evaluate(() => window.__companionViewer.getState());
    expect(state.pinCount).toBe(7);
    expect(state.markerCount).toBe(7);
    await expect(page.locator('#scan-stats')).toContainText('6 cv · 1 scene');
  });

  test('edits a pin: rename + confidence + position, floorplan recomputes', async ({ page }) => {
    await page.selectOption('#sample-select', 'studio');
    await page.evaluate(() => {
      const scan = window.__companionViewer.getScan();
      const pin = scan.pins.find(p => p.source === 'CvServer');
      window.__companionViewer.selectPin(pin.id);
    });
    await expect(page.locator('#editor')).toBeVisible();

    await page.fill('#pin-label', 'reading chair');
    await page.fill('#pin-confidence', '0.55');
    await page.fill('#pin-x', '9.5');
    await page.click('#pin-apply');

    await expect(page.locator('#pin-list li.selected')).toContainText('reading chair 55%');
    const scan = await page.evaluate(() => window.__companionViewer.getScan());
    const edited = scan.pins.find(p => p.label === 'reading chair');
    expect(edited.position_anchor_local.x).toBe(9.5);
    // Floorplan recomputed to include the moved pin
    expect(scan.floorplan.bounds.max.x).toBe(9.5);
  });

  test('form controls are named: sample picker, pin editor, and nothing else unlabeled', async ({ page }) => {
    // axe reported label x6 and select-name x1 (both critical): the editor rows
    // put a bare <span> beside each input, and the sample picker's only text was
    // its first <option>. A screen reader announced them as "edit text" / "pop
    // up button" with no name.
    await expect(page.locator('#sample-select')).toHaveAccessibleName('Sample home');

    await page.selectOption('#sample-select', 'studio');
    await page.evaluate(() => {
      const pin = window.__companionViewer.getScan().pins.find(p => p.source === 'CvServer');
      window.__companionViewer.selectPin(pin.id);
    });
    await expect(page.locator('#editor')).toBeVisible();

    const names = {
      '#pin-label': 'Label',
      '#pin-confidence': 'Confidence',
      '#pin-x': 'Position X',
      '#pin-y': 'Position Y',
      '#pin-z': 'Position Z',
      '#pin-caption': 'Caption',
    };
    for (const [selector, name] of Object.entries(names)) {
      await expect(page.locator(selector)).toHaveAccessibleName(name);
    }

    // Sweep, so the next control added without a label fails here too.
    for (const role of ['textbox', 'spinbutton', 'combobox', 'checkbox']) {
      for (const control of await page.getByRole(role).all()) {
        await expect(control).toHaveAccessibleName(/\S/);
      }
    }
  });

  test('deletes a pin and filters by source', async ({ page }) => {
    await page.selectOption('#sample-select', 'studio');
    await page.evaluate(() => {
      const pin = window.__companionViewer.getScan().pins.find(p => p.source === 'CvServer');
      window.__companionViewer.selectPin(pin.id);
    });
    await page.click('#pin-delete');
    await expect(page.locator('#pin-list li')).toHaveCount(6);

    await page.uncheck('#filter-cv');
    await expect(page.locator('#pin-list li')).toHaveCount(1);   // MetaScene floor only
    await page.check('#filter-cv');
    await expect(page.locator('#pin-list li')).toHaveCount(6);
  });

  test('exports edited scans as JSON and GLB', async ({ page }) => {
    await page.selectOption('#sample-select', 'office_solo');
    await page.evaluate(() => {
      const pin = window.__companionViewer.getScan().pins.find(p => p.source === 'CvServer');
      window.__companionViewer.selectPin(pin.id);
    });
    await page.fill('#pin-label', 'standing desk');
    await page.click('#pin-apply');

    // JSON export carries the edit
    const jsonDl = page.waitForEvent('download');
    await page.click('#json-btn');
    const jsonFile = await jsonDl;
    expect(jsonFile.suggestedFilename()).toMatch(/\.json$/);
    const fs = await import('fs');
    const exported = JSON.parse(fs.readFileSync(await jsonFile.path(), 'utf8'));
    expect(exported.pins.some(p => p.label === 'standing desk')).toBe(true);

    // GLB re-export downloads
    const glbDl = page.waitForEvent('download');
    await page.click('#glb-btn');
    expect((await glbDl).suggestedFilename()).toMatch(/\.glb$/);
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
