/**
 * IWER (Immersive Web Emulation Runtime) setup helpers for Playwright E2E tests.
 *
 * Usage in a test file:
 *
 *   import { test, expect } from '@playwright/test';
 *   import { installIwer, connectControllers, pressButton } from './helpers/iwer-setup.js';
 *
 *   test('my webxr test', async ({ page }) => {
 *     await installIwer(page);
 *     await page.goto('/');
 *     await grantXrSession(page);
 *     await connectControllers(page);
 *     await pressButton(page, 'right', 'a-button');
 *   });
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const IWER_BUNDLE = path.resolve(__dirname, '../../../node_modules/iwer/build/iwer.min.js');

/**
 * Inject IWER into the page as an init script (runs before the app JS).
 * Sets up a Meta Quest 3 emulated device and installs it on `window.navigator.xr`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {boolean} [opts.stereoEnabled=false]  Disable stereo for headless tests
 */
export async function installIwer(page, { stereoEnabled = false } = {}) {
  // Inject the IWER browser bundle so window.iwer is available
  await page.addInitScript({ path: IWER_BUNDLE });

  // Create and install the XRDevice from metaQuest3 preset
  await page.addInitScript(`
    (() => {
      const { XRDevice, metaQuest3 } = window.IWER ?? {};
      if (!XRDevice || !metaQuest3) {
        console.error('[test] IWER not loaded — window.IWER is', typeof window.IWER);
        return;
      }
      const device = new XRDevice(metaQuest3);
      device.stereoEnabled = ${stereoEnabled};
      device.installRuntime();
      window.__xrDevice = device;
      console.log('[test] IWER device installed:', device.name);
    })();
  `);
}

/**
 * Wait for IWER device to be available on the page.
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=5000]
 */
export async function waitForDevice(page, timeout = 5000) {
  await page.waitForFunction(() => !!window.__xrDevice, { timeout });
}

/**
 * Grant the pending XR session offered by the IWSDK (auto-called by World.create).
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=10000]
 */
export async function grantXrSession(page, timeout = 10000) {
  // Wait for the device to have an offered session
  await page.waitForFunction(() => !!window.__xrDevice?.sessionOffered, { timeout });
  // Grant it
  await page.evaluate(() => window.__xrDevice.grantOfferedSession());
}

/**
 * Connect both left and right controllers on the emulated device.
 * @param {import('@playwright/test').Page} page
 */
export async function connectControllers(page) {
  await page.evaluate(() => {
    const d = window.__xrDevice;
    if (!d) throw new Error('IWER device not found');
    const { left, right } = d.controllers;
    if (left)  left.connected  = true;
    if (right) right.connected = true;
  });
}

/**
 * Press a button on the emulated controller for one frame, then release.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'left'|'right'} hand
 * @param {string} componentId  IWSDK InputComponent id, e.g. 'a-button', 'b-button',
 *                              'x-button', 'y-button', 'xr-standard-trigger'
 */
export async function pressButton(page, hand, componentId) {
  await page.evaluate(([h, id]) => {
    const d = window.__xrDevice;
    if (!d) throw new Error('IWER device not found');
    const ctrl = d.controllers[h];
    if (!ctrl) throw new Error(`No ${h} controller`);
    // Press (value = 1)
    ctrl.updateButtonValue(id, 1);
  }, [hand, componentId]);

  // Give the IWSDK render loop one tick to process the input
  await page.waitForTimeout(50);

  await page.evaluate(([h, id]) => {
    const d = window.__xrDevice;
    const ctrl = d.controllers[h];
    // Release (value = 0)
    ctrl.updateButtonValue(id, 0);
  }, [hand, componentId]);

  // Another tick for release processing
  await page.waitForTimeout(50);
}

/**
 * Read the current window.__state object (set by the test harness page).
 * @param {import('@playwright/test').Page} page
 */
export async function getState(page) {
  return page.evaluate(() => window.__state);
}

/**
 * Expose window.__state on the harness page.
 * The harness page must call window.__exposeState(appState) during its init.
 * This helper is for use with the full app page that exposes state via a script.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForAppReady(page, timeout = 15000) {
  await page.waitForFunction(() => window.__appReady === true, { timeout });
}

const SEM_BUNDLE = path.resolve(__dirname, '../../../node_modules/@iwer/sem/build/iwer-sem.min.js');

/**
 * Inject IWER plus the Synthetic Environment Module (@iwer/sem) and install
 * both before any page script runs. Test homes can then be loaded with
 * `loadHomeEnvironment(page, semJson)`.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function installIwerWithSem(page) {
  await page.addInitScript({ path: IWER_BUNDLE });
  await page.addInitScript({ path: SEM_BUNDLE });
  await page.addInitScript(`
    (() => {
      const { XRDevice, metaQuest3 } = window.IWER ?? {};
      const sem = window.IWER_SEM;
      if (!XRDevice || !sem) {
        console.error('[test] IWER/SEM not loaded:', typeof window.IWER, typeof window.IWER_SEM);
        return;
      }
      const device = new XRDevice(metaQuest3);
      device.stereoEnabled = false;
      device.installRuntime();
      device.installSEM(sem.SyntheticEnvironmentModule);
      window.__xrDevice = device;
    })();
  `);
}

/**
 * Load a synthetic home environment into the emulated device. The
 * SceneUnderstandingSystem picks the planes/meshes up on subsequent frames.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} semJson  output of homeToSemJson()
 */
export async function loadHomeEnvironment(page, semJson) {
  await page.evaluate((json) => {
    window.__xrDevice.sem.loadEnvironment(json);
  }, semJson);
}
