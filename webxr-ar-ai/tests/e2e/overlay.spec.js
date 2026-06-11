/**
 * E2E tests for the desktop status overlay (DesktopOverlay).
 *
 * Runs against the real app page with IWER providing an emulated Quest 3
 * WebXR runtime. The CV server is NOT running in CI, so the health badge
 * must report Offline.
 */
import { test, expect } from '@playwright/test';
import { installIwer, grantXrSession } from './helpers/iwer-setup.js';

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
});
