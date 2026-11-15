/**
 * E2E tests for the Quest app launch (src/app/questApp.js), with IWER emulating a
 * Quest 3. The Quest app opens `/?source=quest-app` and must start AR by itself; a
 * browser tab must keep waiting for the session IWSDK offers.
 */
import { test, expect } from '@playwright/test';
import { installIwer, grantXrSession } from './helpers/iwer-setup.js';

test.describe('Quest app launch', () => {
  test.beforeEach(async ({ page }) => {
    await installIwer(page);
  });

  test('the Quest app starts the AR session by itself and tidies the address', async ({ page }) => {
    await page.goto('/?source=quest-app');
    await expect(page.locator('#co-overlay')).toBeHidden({ timeout: 15_000 });
    expect(new URL(page.url()).search).toBe('');
    expect(await page.evaluate(() => window.__companionScan.questApp)).toBe(true);
    // The app asked for the session itself; nothing was offered to the browser.
    expect(await page.evaluate(() => Boolean(window.__xrDevice.sessionOffered))).toBe(false);
  });

  test('Enter AR on the panel brings the user back into AR after leaving it', async ({ page }) => {
    await page.goto('/?source=quest-app');
    const overlay = page.locator('#co-overlay');
    await expect(overlay).toBeHidden({ timeout: 15_000 });

    await page.evaluate(() => window.__companionScan.exitAr());
    await expect(overlay).toBeVisible();
    const enter = page.locator('#co-enter-ar');
    await expect(enter).toBeVisible();

    await enter.click();
    await expect(overlay).toBeHidden({ timeout: 10_000 });
  });

  test('a reload inside the app is still the app', async ({ page }) => {
    await page.goto('/?source=quest-app');
    await expect(page.locator('#co-overlay')).toBeHidden({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('#co-overlay')).toBeHidden({ timeout: 15_000 });
    expect(await page.evaluate(() => window.__companionScan.questApp)).toBe(true);
  });

  test('a browser tab shows the panel without Enter AR and waits for the offered session', async ({ page }) => {
    await page.goto('/');
    const overlay = page.locator('#co-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#co-enter-ar')).toHaveCount(0);
    expect(await page.evaluate(() => window.__companionScan.questApp)).toBe(false);

    await grantXrSession(page);
    await expect(overlay).toBeHidden({ timeout: 10_000 });
  });
});
