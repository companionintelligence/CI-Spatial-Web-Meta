/**
 * E2E: the room geometry survives a reload.
 *
 * A capture copies the emulated room (IWER + an @iwer/sem home) into the scan
 * root and saves it to IndexedDB. After a reload the room is restored from
 * there, so an export still contains it. A capture that sees live planes and
 * meshes then replaces the restored copy instead of adding to it.
 */
import { test, expect } from '@playwright/test';
import {
  installIwerWithSem,
  grantXrSession,
  loadHomeEnvironment,
} from './helpers/iwer-setup.js';
import { TEST_HOMES, homeToSemJson } from '../../src/fixtures/homes.js';

test.describe.configure({ timeout: 120_000 });

async function bootApp(page) {
  await installIwerWithSem(page);
  // CV server calls are irrelevant here: answer them cheaply.
  await page.route('/v1/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', detections: [], segments: [], result: {}, models: [] }),
  }));
  await page.goto('/');
  await page.waitForFunction(() => !!window.__companionScan?.geometry, { timeout: 20_000 });
  await grantXrSession(page, 20_000);
  await page.waitForTimeout(800);   // let IWSDK systems spin up
}

test('room geometry is restored after a reload and replaced by the next capture', async ({ page }) => {
  const home = homeToSemJson(TEST_HOMES[0]);

  await bootApp(page);
  await loadHomeEnvironment(page, home);
  await page.waitForTimeout(400);   // SceneUnderstandingSystem ingests per-frame

  const captured = await page.evaluate(async () => {
    await window.__companionScan.runCapture();
    await window.__companionScan.flushGeometry();
    return window.__companionScan.geometry.count;
  });
  expect(captured).toBeGreaterThan(0);

  // Reload: the emulated room is gone, so it can only come back from storage.
  await page.reload();
  await page.waitForFunction(() => !!window.__companionScan?.geometry, { timeout: 20_000 });
  await expect.poll(
    () => page.evaluate(() => window.__companionScan.geometry.restoredCount),
    { timeout: 10_000 },
  ).toBe(captured);
  expect(await page.evaluate(() => window.__companionScan.geometry.count)).toBe(captured);

  // Enter AR again, let the room come back, and capture: the restored copy is replaced.
  await grantXrSession(page, 20_000);
  await page.waitForTimeout(800);
  await loadHomeEnvironment(page, home);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__companionScan.runCapture());

  const after = await page.evaluate(() => ({
    count:    window.__companionScan.geometry.count,
    restored: window.__companionScan.geometry.restoredCount,
  }));
  expect(after.restored).toBe(0);
  expect(after.count).toBe(captured);
});
