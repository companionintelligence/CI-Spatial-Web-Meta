/**
 * E2E scan tests across the 24 synthetic test homes.
 *
 * Each home is converted to an @iwer/sem environment and loaded into the
 * emulated Quest 3 runtime (the same IWER core that powers Meta's
 * immersive-web-emulator). The real app then runs a capture against the real
 * WebXR plane/mesh-detection path:
 *
 *   homeToSemJson → device.sem.loadEnvironment → XRFrame.detectedPlanes/Meshes
 *     → IWSDK SceneUnderstandingSystem → Pipeline A → SpatialPinManager
 *
 * Assertions compare the resulting MetaScene pins against each home's
 * expected plane/mesh counts and semantic labels.
 */
import { test, expect } from '@playwright/test';
import {
  installIwerWithSem,
  grantXrSession,
  loadHomeEnvironment,
} from './helpers/iwer-setup.js';
import {
  TEST_HOMES,
  homeToSemJson,
  expectedSceneSummary,
} from '../../src/fixtures/homes.js';

test.describe.configure({ timeout: 120_000 });

async function bootApp(page) {
  await installIwerWithSem(page);
  // CV server calls are irrelevant here — fulfil them cheaply
  await page.route('/v1/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', detections: [], segments: [], result: {}, models: [] }),
  }));
  await page.goto('/');
  await page.waitForFunction(() => !!window.__companionScan?.runCapture, { timeout: 20_000 });
  await grantXrSession(page, 20_000);
  await page.waitForTimeout(800);   // let IWSDK systems spin up
}

/** Run a capture for one home and return the MetaScene pin summary. */
async function scanHome(page, home) {
  await loadHomeEnvironment(page, homeToSemJson(home));
  await page.waitForTimeout(400);   // SceneUnderstandingSystem ingests per-frame

  return page.evaluate(async () => {
    const { pinManager, clearScan, runCapture } = window.__companionScan;
    await runCapture();
    const pins = pinManager.bySource('MetaScene');
    const summary = {
      planes: pins.filter(p => p.hitType === 'plane').length,
      meshes: pins.filter(p => p.hitType === 'mesh').length,
      labels: [...new Set(pins.map(p => p.label))],
    };
    clearScan();
    return summary;
  });
}

function homeBatch(homes) {
  return async ({ page }) => {
    await bootApp(page);
    for (const home of homes) {
      const summary  = await scanHome(page, home);
      const expected = expectedSceneSummary(home);

      expect(summary.planes, `${home.name}: plane count`).toBe(expected.planes);
      expect(summary.meshes, `${home.name}: mesh count`).toBe(expected.meshes);
      for (const label of expected.labels) {
        expect(summary.labels, `${home.name}: missing label '${label}'`).toContain(label);
      }
    }
  };
}

// Three batches of 8 homes each — one page boot per batch, 24 homes total.
const third = Math.ceil(TEST_HOMES.length / 3);
test('scans test homes 1–8 through the emulated WebXR scene path',
  homeBatch(TEST_HOMES.slice(0, third)));
test('scans test homes 9–16 through the emulated WebXR scene path',
  homeBatch(TEST_HOMES.slice(third, third * 2)));
test('scans test homes 17–24 through the emulated WebXR scene path',
  homeBatch(TEST_HOMES.slice(third * 2)));

test('re-scanning the same home updates pins in place (no duplicates)', async ({ page }) => {
  await bootApp(page);
  const home = TEST_HOMES[0];
  await loadHomeEnvironment(page, homeToSemJson(home));
  await page.waitForTimeout(400);

  const counts = await page.evaluate(async () => {
    const { pinManager, runCapture, clearScan } = window.__companionScan;
    await runCapture();
    const first = pinManager.bySource('MetaScene').length;
    await runCapture();
    const second = pinManager.bySource('MetaScene').length;
    clearScan();
    return { first, second };
  });

  expect(counts.first).toBeGreaterThan(0);
  expect(counts.second).toBe(counts.first);
});

// ── Full pipeline: ground-truth detections → pinhole rays → scene raycast ──

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as nodePath from 'path';

const __dir = fileURLToPath(new URL('.', import.meta.url));

test('places ground-truth CV detections onto the home geometry', async ({ page }) => {
  const gt = JSON.parse(
    readFileSync(nodePath.resolve(__dir, '../../test-assets/cv/studio.json'), 'utf8'),
  );
  const home = TEST_HOMES.find(h => h.name === gt.home);

  await bootAppForPlacement(page);
  await loadHomeEnvironment(page, homeToSemJson(home));
  await page.waitForTimeout(400);

  // Put the emulated head exactly where the ground-truth camera was
  await page.evaluate(async ({ camera }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const device = window.__xrDevice;
    const [px, py, pz] = camera.position;
    const eye = new THREE.Vector3(px, py, pz);
    const target = new THREE.Vector3(...camera.look_at);
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    device.position.x = px; device.position.y = py; device.position.z = pz;
    device.quaternion.x = q.x; device.quaternion.y = q.y;
    device.quaternion.z = q.z; device.quaternion.w = q.w;
  }, gt);
  await page.waitForTimeout(300);   // let the render camera adopt the pose

  const placed = await page.evaluate((detections) => {
    const { placeDetections, pinManager, clearScan } = window.__companionScan;
    placeDetections('cap-gt', detections);
    const pins = pinManager.bySource('CvServer').map(p => ({
      label: p.label, hitType: p.hitType, pos: p.worldPosition,
    }));
    clearScan();
    return pins;
  }, gt.detections);

  expect(placed).toHaveLength(gt.detections.length);

  const cam = gt.camera.position;
  const dist = (p, q) => Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]);
  let strictHits = 0;

  for (const det of gt.detections) {
    const pin = placed.find(p => p.label === det.label && p.hitType !== 'fallback');
    expect(pin, `${det.label}: no non-fallback pin`).toBeTruthy();

    const spec = home.furniture.find(([l]) => l.toLowerCase() === det.label);
    const [, w, h, d] = spec;
    const g = det.world_position;

    const onOwnBox =
      Math.abs(pin.pos.x - g.x) <= w / 2 + 0.25 &&
      Math.abs(pin.pos.z - g.z) <= d / 2 + 0.25 &&
      pin.pos.y >= -0.05 && pin.pos.y <= h + 0.35;
    if (onOwnBox) strictHits++;

    // A bbox-centre ray may legitimately strike a nearer occluder — but it
    // must never land BEHIND the detected object or outside the room.
    const margin = Math.max(w, d) / 2 + 0.3;
    expect(dist(pin.pos, cam), `${det.label}: pin behind its object`)
      .toBeLessThanOrEqual(dist(g, cam) + margin);
    const room = home.rooms[0];
    expect(Math.abs(pin.pos.x - room.x)).toBeLessThanOrEqual(room.w / 2 + 0.1);
    expect(Math.abs(pin.pos.z - room.z)).toBeLessThanOrEqual(room.d / 2 + 0.1);
  }

  // At least half the detections must land directly on their own object
  // (the rest may strike legitimate nearer occluders — deterministic for
  // this fixture, so this is a regression floor, not a flaky heuristic).
  expect(strictHits / gt.detections.length).toBeGreaterThanOrEqual(0.5);
});

async function bootAppForPlacement(page) {
  await installIwerWithSem(page);
  await page.route('/v1/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', detections: [], segments: [], result: {}, models: [] }),
  }));
  await page.goto('/');
  await page.waitForFunction(() => !!window.__companionScan?.placeDetections, { timeout: 20_000 });
  await grantXrSession(page, 20_000);
  await page.waitForTimeout(800);
}
