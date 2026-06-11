import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

/**
 * Playwright configuration for Companion Scan E2E tests.
 *
 * Test layers:
 *   tests/e2e/modules.spec.js   — module-level tests via /harness.html (no WebXR needed)
 *   tests/e2e/webxr.spec.js     — full app with IWER WebXR emulation
 *   tests/e2e/spatial.spec.js   — spatial pin creation with IWER plane/mesh emulation
 *
 * The Vite dev server (HTTP, no HTTPS for CI) is started automatically.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    // Ignore HTTPS errors if the server uses a self-signed cert
    ignoreHTTPSErrors: true,
    // Collect traces on test failures for debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable WebXR features in Chromium
        launchOptions: {
          args: [
            '--enable-features=WebXR',
            '--enable-blink-features=WebXRARModule,WebXRHitTest',
            '--ignore-certificate-errors',
          ],
        },
      },
    },
  ],
  // Start a plain HTTP Vite dev server for E2E tests (no mkcert), plus the
  // mock CV server that the vite /v1 proxy forwards to — so the full capture
  // and export paths run against a live (fake) backend.
  webServer: [
    {
      command: 'npx vite --config vite.test.config.js',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node tests/mocks/mock-cv-server.mjs 8000',
      url: 'http://127.0.0.1:8000/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
