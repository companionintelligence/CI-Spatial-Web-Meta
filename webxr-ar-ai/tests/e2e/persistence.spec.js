/**
 * E2E tests for scan persistence (ScanStorage) and the Clear Scan flow.
 *
 * Drives the real app through the `window.__companionScan` debug hook:
 * pins are injected, saved, and verified to survive a full page reload.
 */
import { test, expect } from '@playwright/test';
import { installIwer } from './helpers/iwer-setup.js';

async function appReady(page) {
  await page.waitForFunction(() => !!window.__companionScan, { timeout: 15_000 });
}

function addTwoPinsAndSave() {
  const { pinManager, scanStorage, scanRoot, SpatialPin } = window.__companionScan;
  for (const [label, x] of [['chair', 1], ['desk', -1]]) {
    const pin = new SpatialPin();
    pin.label = label;
    pin.trackId = `e2e-${label}`;
    pin.worldPosition = { x, y: 1, z: -2 };
    pin.hitType = 'mesh';
    pinManager.addOrUpdate(pin);
  }
  return scanStorage.save(pinManager, scanRoot);
}

test.describe('Scan persistence', () => {
  test.beforeEach(async ({ page }) => {
    await installIwer(page);
    await page.goto('/');
    await appReady(page);
    // Isolate from earlier tests
    await page.evaluate(() => window.__companionScan.clearScan());
  });

  test('pins survive a page reload and labels are rebuilt', async ({ page }) => {
    const saved = await page.evaluate(addTwoPinsAndSave);
    expect(saved).toBe(2);
    await expect(page.locator('#co-pins')).toHaveText('2 cv · 0 scene');

    await page.reload();
    await appReady(page);

    // Pin store restored
    const state = await page.evaluate(() => {
      const { pinManager, scanRoot } = window.__companionScan;
      return {
        count:  pinManager.pins.length,
        labels: pinManager.pins.map(p => p.label).sort(),
        anchorLocal: pinManager.pins[0].anchorLocalPosition,
        // 3D label groups rebuilt under the anchored labels root
        labelGroups: scanRoot.labelsRoot.children.length,
      };
    });
    expect(state.count).toBe(2);
    expect(state.labels).toEqual(['chair', 'desk']);
    expect(state.anchorLocal).not.toBeNull();
    expect(state.labelGroups).toBe(2);

    // Overlay reflects the restored scan
    await expect(page.locator('#co-pins')).toHaveText('2 cv · 0 scene');
    await expect(page.locator('#co-status-line')).toHaveText('Restored 2 pins');
  });

  test('Clear Scan empties the store, the overlay, and persisted state', async ({ page }) => {
    await page.evaluate(addTwoPinsAndSave);
    await expect(page.locator('#co-pins')).toHaveText('2 cv · 0 scene');

    await page.click('#co-clear');

    await expect(page.locator('#co-pins')).toHaveText('0 cv · 0 scene');
    await expect(page.locator('#co-status-line')).toHaveText('Scan cleared');

    const cleared = await page.evaluate(() => ({
      pins:   window.__companionScan.pinManager.pins.length,
      stored: localStorage.getItem('companion_scan_pins_v1'),
      labels: window.__companionScan.scanRoot.labelsRoot.children.length,
    }));
    expect(cleared).toEqual({ pins: 0, stored: null, labels: 0 });

    // Nothing comes back after a reload
    await page.reload();
    await appReady(page);
    const after = await page.evaluate(() => window.__companionScan.pinManager.pins.length);
    expect(after).toBe(0);
  });
});
