/**
 * E2E: a capture without a CV server is a partial result, not an error.
 *
 * Scene pins come from the headset's own room model, so they are placed even
 * when the CV server is unreachable. The status line says so, as a warning
 * (not red), and names the scene-pin count.
 */
import { test, expect } from '@playwright/test';
import {
  installIwerWithSem,
  grantXrSession,
  loadHomeEnvironment,
} from './helpers/iwer-setup.js';
import { TEST_HOMES, homeToSemJson } from '../../src/fixtures/homes.js';
import { canon, hexToRgb } from './helpers/canon.js';

test.describe.configure({ timeout: 120_000 });

test('a capture with the CV server unreachable still places scene pins and says so', async ({ page }) => {
  await installIwerWithSem(page);
  await page.route('/v1/**', (route) => route.abort());   // CV server unreachable
  await page.goto('/');
  await page.waitForFunction(() => !!window.__companionScan?.runCapture, { timeout: 20_000 });
  await grantXrSession(page, 20_000);
  await page.waitForTimeout(800);

  await loadHomeEnvironment(page, homeToSemJson(TEST_HOMES[0]));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__companionScan.runCapture());

  const status = page.locator('#co-status-line');
  await expect(status).toContainText('scene pins');
  await expect(status).not.toContainText('Capture failed');
  // The canon warning colour (light set), not the destructive one.
  await expect(status).toHaveCSS('color', hexToRgb(canon.status.light.warning.hex));

  const scenePins = await page.evaluate(() => window.__companionScan.pinManager.bySource('MetaScene').length);
  expect(scenePins).toBeGreaterThan(0);
});
