/**
 * E2E: camera privacy and the local scan, on the real app page with an emulated Quest 3.
 *
 *   - The camera is off when the session starts: no camera request at all.
 *   - The Left stick turns it on: the request asks for video only, and the REC line shows.
 *   - With the camera on, a capture sends one keyframe to the local scan API and nothing
 *     to any other host. The detections come back as placed pins with box sizes.
 *   - With the camera off, a capture sends nothing to the scan API.
 *
 * The scan server is the mock on 127.0.0.1:8000 (see playwright.config.js), reached
 * through the Vite proxy, so the browser only ever talks to the page's own origin.
 */
import { test, expect } from '@playwright/test';
import { installIwer, grantXrSession, connectControllers, pressButton } from './helpers/iwer-setup.js';
import { installFakeCamera } from './helpers/fakeCamera.js';

const MOCK = 'http://127.0.0.1:8000';

async function resetMock(request) {
  await request.post(`${MOCK}/__mock/reset`);
}

async function scanPosts(request) {
  const res = await request.get(`${MOCK}/__mock/scans`);
  return (await res.json()).scans;
}

test.describe('Camera privacy and the local scan', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetMock(request);
    await installIwer(page);
    await installFakeCamera(page);
    await page.goto('/');
    await grantXrSession(page, 15_000);
    await connectControllers(page);
    await page.waitForTimeout(500);
  });

  test('the camera is off when the session starts: no camera request, and the panels say so', async ({ page }) => {
    expect(await page.evaluate(() => window.__gum.calls.length)).toBe(0);
    expect(await page.evaluate(() => window.__companionScan.appState.cameraOn)).toBe(false);
    await expect(page.locator('#co-camera-state')).toHaveText('Camera off');
    await expect(page.locator('#co-rec')).toHaveAttribute('hidden', '');
  });

  test('the Left stick turns the camera on: video only, and the REC line shows', async ({ page }) => {
    // IWER names the Meta controller's stick 'thumbstick' (the xr-standard-thumbstick button).
    await pressButton(page, 'left', 'thumbstick');
    await page.waitForFunction(() => window.__companionScan.appState.cameraOn === true, null, { timeout: 5000 });

    const calls = await page.evaluate(() => window.__gum.calls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.video)).toBe(true);
    expect(calls.some((c) => c.audio)).toBe(false);
    await expect(page.locator('#co-rec')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#co-rec')).toContainText('REC camera');
    await expect(page.locator('#co-camera-state')).toContainText('REC camera');
  });

  test('a capture with the camera on sends one keyframe to the local scan, and nothing to any other host', async ({ page, request }) => {
    await page.evaluate(() => window.__companionScan.setCameraOn(true));
    await page.waitForTimeout(1500);   // the fake stream starts and the video is ready

    const hosts = new Set();
    page.on('request', (req) => hosts.add(new URL(req.url()).host));
    const posted = page.waitForRequest(
      (req) => req.method() === 'POST' && new URL(req.url()).pathname === '/v1/scans',
      { timeout: 15_000 },
    );

    await page.evaluate(() => window.__companionScan.runCapture());
    const body = (await posted).postDataJSON();

    expect(body.keyframes).toHaveLength(1);
    expect(body.keyframes[0].image.base64.length).toBeGreaterThan(100);
    expect(body.keyframes[0].image.format).toBe('jpeg');
    expect(body.keyframes[0].pose.frame).toBe('local-floor');
    expect(body.keyframes[0].intrinsics.fx).toBeGreaterThan(0);
    expect(body.hierarchy.room.name).toBe('Room 1');
    expect(body.client.device).toBe('meta-quest-3');

    // The detections come back and are placed in the room, each with its box size.
    await page.waitForFunction(() => window.__companionScan.pinManager.bySource('CvServer').length > 0, null, { timeout: 15_000 });
    const pins = await page.evaluate(() =>
      window.__companionScan.pinManager.bySource('CvServer').map((p) => ({ label: p.label, box: p.boxSizeM })),
    );
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((p) => p.box && p.box.w > 0 && p.box.h > 0)).toBe(true);

    // The overlay says what was scanned.
    await expect(page.locator('#co-scan')).toContainText('Last scan scan_');

    // Nothing left for another host: the browser saw only the page's own origin.
    const own = new URL(page.url()).host;
    expect([...hosts].every((host) => host === own)).toBe(true);

    // The server stored exactly that keyframe under the scan id.
    const scans = await scanPosts(request);
    expect(scans).toHaveLength(1);
    expect(scans[0].record.keyframes).toHaveLength(1);
    expect(scans[0].record.detections.length).toBe(pins.length);
  });

  test('with the camera off, a capture sends nothing to the scan API', async ({ page, request }) => {
    const before = (await scanPosts(request)).length;
    const posts = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname.startsWith('/v1/scans')) posts.push(req.url());
    });

    await page.evaluate(() => window.__companionScan.runCapture());
    await page.waitForTimeout(1500);

    expect(posts).toHaveLength(0);
    expect((await scanPosts(request)).length).toBe(before);
    await expect.poll(() => page.evaluate(() => window.__companionScan.appState.status.text)).toMatch(/^Camera off · \d+ scene pins$/);
    expect(await page.evaluate(() => window.__gum.calls.length)).toBe(0);
  });

  test('the room name typed on the overlay files the scan under that room', async ({ page, request }) => {
    await page.evaluate(() => localStorage.setItem('companionScan.roomName', 'Kitchen'));
    await page.evaluate(() => window.__companionScan.setCameraOn(true));
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.__companionScan.runCapture());
    await expect.poll(async () => (await scanPosts(request)).length, { timeout: 15_000 }).toBeGreaterThan(0);

    const scans = await scanPosts(request);
    const latest = scans[scans.length - 1];
    expect(latest.record.hierarchy.room).toEqual({ id: 'room-kitchen', name: 'Kitchen' });
  });
});
