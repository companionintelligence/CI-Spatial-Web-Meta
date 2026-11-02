/**
 * E2E tests for the desktop status overlay (DesktopOverlay).
 *
 * Runs against the real app page with IWER providing an emulated Quest 3
 * WebXR runtime. The CV server is NOT running in CI, so the health badge
 * must report Offline.
 */
import { test, expect } from '@playwright/test';
import { installIwer, grantXrSession } from './helpers/iwer-setup.js';
import { canon, hexToRgb } from './helpers/canon.js';

test.describe('Desktop overlay', () => {
  test.beforeEach(async ({ page }) => {
    await installIwer(page);
    await page.goto('/');
  });

  test('renders the status panel with title and legend', async ({ page }) => {
    const overlay = page.locator('#co-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('h1')).toHaveText('Companion Scan Quest');
    // Five controller legend rows
    await expect(overlay.locator('.co-key')).toHaveCount(5);
  });

  test('reports WebXR immersive-ar support (via IWER)', async ({ page }) => {
    await expect(page.locator('#co-xr-status')).toContainText(/immersive-ar supported/i, {
      timeout: 10_000,
    });
  });

  test('reports the CV server as online (mock backend)', async ({ page }) => {
    await expect(page.locator('#co-cv-status')).toContainText(/online/i, {
      timeout: 15_000,
    });
  });

  test('reports the CV server as offline when unreachable', async ({ page }) => {
    await page.route('**/v1/health', route => route.abort());
    await page.reload();
    await expect(page.locator('#co-cv-status')).toContainText(/offline/i, {
      timeout: 15_000,
    });
  });

  test('adopts the model registry from the CV server', async ({ page }) => {
    await page.waitForFunction(
      () => window.__companionScan?.appState?.models?.length === 4,
      { timeout: 15_000 },
    );
    const models = await page.evaluate(() => window.__companionScan.appState.models);
    expect(models).toContain('YoloWorld');
  });

  test('shows the capture session id and zero pin counts', async ({ page }) => {
    await expect(page.locator('#co-session')).not.toBeEmpty();
    await expect(page.locator('#co-pins')).toHaveText('0 cv · 0 scene');
  });

  test('Download GLB produces both .glb and .md scan artifacts', async ({ page }) => {
    // Wait for the app (and the overlay wiring) to be fully up
    await expect(page.locator('#co-overlay')).toBeVisible();

    const downloads = [];
    page.on('download', d => downloads.push(d.suggestedFilename()));
    await page.click('#co-download');
    await expect(page.locator('#co-status-line')).toContainText(/^Saved companion-scan-/);
    await expect.poll(() => downloads.length).toBe(2);

    expect(downloads.find(f => /^companion-scan-.*\.glb$/.test(f))).toBeTruthy();
    expect(downloads.find(f => /^companion-scan-.*\.md$/.test(f))).toBeTruthy();
  });

  test('hides while an immersive session is presenting', async ({ page }) => {
    await expect(page.locator('#co-overlay')).toBeVisible();
    await grantXrSession(page);
    await expect(page.locator('#co-overlay')).toBeHidden({ timeout: 10_000 });
  });

  test('explains that scanning still works when the CV server is offline', async ({ page }) => {
    await page.route('**/v1/health', route => route.abort());
    await page.reload();
    await expect(page.locator('#co-cv-note')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#co-cv-note')).toContainText('Scene pins and GLB export still work');
  });

  test('saves a camera FOV for this device and shows it after a reload', async ({ page }) => {
    await page.fill('#co-hfov', '74');
    await page.click('#co-hfov-save');
    await expect(page.locator('#co-hfov-note')).toContainText('Saved 74°');
    expect(await page.evaluate(() => localStorage.getItem('companionScan.cameraHfovDeg'))).toBe('74');

    await page.reload();
    await expect(page.locator('#co-hfov')).toHaveValue('74');
    await expect(page.locator('#co-hfov-note')).toContainText('Saved on this device');
  });

  test('rejects a camera FOV outside the allowed range', async ({ page }) => {
    await page.fill('#co-hfov', '5');
    await page.click('#co-hfov-save');
    await expect(page.locator('#co-hfov-note')).toContainText('more than 20 and less than 160');
    expect(await page.evaluate(() => localStorage.getItem('companionScan.cameraHfovDeg'))).toBeNull();
  });

  test('reset removes the saved camera FOV', async ({ page }) => {
    await page.fill('#co-hfov', '74');
    await page.click('#co-hfov-save');
    await page.click('#co-hfov-reset');
    await expect(page.locator('#co-hfov')).toHaveValue('80');
    expect(await page.evaluate(() => localStorage.getItem('companionScan.cameraHfovDeg'))).toBeNull();
  });

  test('copies the link to open on a headset', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const link = `${new URL(page.url()).origin}/`;
    await expect(page.locator('#co-headset-link')).toHaveValue(link);

    await page.click('#co-copy-link');
    await expect(page.locator('#co-copy-note')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });

  test('refuses a server address that is not http(s)', async ({ page }) => {
    await page.fill('#co-server-url', 'javascript:alert(1)');
    await page.click('#co-server-save');
    await expect(page.locator('#co-status-line')).toContainText('must start with https:// or http://');
    expect(await page.evaluate(() => localStorage.getItem('companionScan.serverUrl'))).toBeNull();
  });
});

test.describe('Canon theme', () => {
  test.beforeEach(async ({ page }) => {
    await installIwer(page);
    await page.goto('/');
  });

  test('the overlay uses the canon face and the light surface', async ({ page }) => {
    const overlay = page.locator('#co-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('background-color', hexToRgb(canon.surfaces.light['surface-3'].hex));
    await expect(overlay).toHaveCSS('color', hexToRgb(canon.light.foreground.hex));
    expect(await overlay.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Manrope');
  });

  test('the self-hosted Manrope is the face that loads', async ({ page }) => {
    const loaded = await page.evaluate(() => document.fonts.check('600 13px Manrope'));
    expect(loaded).toBe(true);
  });

  test('the viewer uses the same canon surfaces', async ({ page }) => {
    await page.goto('/viewer.html');
    await expect(page.locator('body')).toHaveCSS('background-color', hexToRgb(canon.light.background.hex));
  });

  test.describe('on a dark device', () => {
    test.use({ colorScheme: 'dark' });

    test('follows the device to the canon dark set', async ({ page }) => {
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      const overlay = page.locator('#co-overlay');
      await expect(overlay).toHaveCSS('background-color', hexToRgb(canon.surfaces.dark['surface-3'].hex));
      await expect(overlay).toHaveCSS('color', hexToRgb(canon.dark.foreground.hex));
    });

    test('the browser chrome colour follows the canon background', async ({ page }) => {
      const themeColor = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.content);
      expect(themeColor).toBe(canon.dark.background.hex);
    });
  });
});
