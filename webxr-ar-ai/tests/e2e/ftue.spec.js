/**
 * E2E tests for the first-run flow in the desktop overlay: sign in with Companion
 * Intelligence, find the memory servers and language models on the account without
 * a tap, and choose one. The Worker's /api routes and the Portal are mocked with
 * page.route, so nothing leaves the test machine.
 */
import { test, expect } from '@playwright/test';
import { installIwer } from './helpers/iwer-setup.js';

const PORTAL = 'https://hub.ci.computer';
const MEMORY_URL = 'https://mem.example.com';
const IDENTITY = { sub: 'user-1', email: 'me@example.com', name: 'Me' };
const LISTING = {
  portal: { ok: true, status: 200 },
  memory: [{
    name: 'Companion Memory',
    url: MEMORY_URL,
    health: { ok: true, status: 200, portalAuthEnabled: true, apiVersion: '1' },
    llm: {
      ok: true,
      status: 200,
      models: [
        { id: 'llama3', vision: false, tools: true, thinking: false },
        { id: 'llava', vision: true, tools: false, thinking: false },
      ],
    },
  }],
};

/** A signed-in session in this browser, unless one is already stored. */
async function seedSession(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('companionScan.portalSession')) return;
    localStorage.setItem('companionScan.portalSession', JSON.stringify({
      accessToken: 'access-test',
      idToken: 'id-test',
      expiresAt: Date.now() + 3600_000,
      identity: null,
    }));
  });
}

/** Mock the Worker's session and discovery routes. The returned counter counts discoveries. */
async function mockWorker(page, { listing = LISTING } = {}) {
  const calls = { discover: 0 };
  await page.route('**/api/session', route => route.fulfill({ json: IDENTITY }));
  await page.route('**/api/discover', route => {
    calls.discover += 1;
    route.fulfill({ json: listing });
  });
  return calls;
}

test.describe('First-run flow', () => {
  test.beforeEach(async ({ page }) => {
    await installIwer(page);
  });

  test('asks a visitor who is not signed in to sign in first', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#co-ftue-title')).toHaveText('Sign in with Companion Intelligence');
    await expect(page.locator('#co-ftue-primary')).toHaveText('Sign in with Companion Intelligence');
    await expect(page.locator('#co-ftue-use')).toBeHidden();
  });

  test('sign-in starts at the Portal with PKCE S256 and the ci-meta client', async ({ page }) => {
    await page.route('**/api/health', route => route.fulfill({
      json: { ok: true, portalUrl: PORTAL, clientId: 'ci-meta' },
    }));
    await page.goto('/');
    const origin = new URL(page.url()).origin;

    let authorize = null;
    await page.route(`${PORTAL}/**`, route => {
      authorize = new URL(route.request().url());
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'Portal stub' });
    });
    await page.click('#co-ftue-primary');

    await expect.poll(() => authorize).not.toBeNull();
    expect(authorize.origin + authorize.pathname).toBe(`${PORTAL}/api/auth/oauth2/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('ci-meta');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${origin}/`);
    expect(authorize.searchParams.get('scope')).toBe('openid profile email');
  });

  test('finishes sign-in when the Portal sends the user back with a code', async ({ page }) => {
    // The verifier and state this tab stored before it sent the user to the Portal.
    await page.addInitScript(() => {
      if (!location.search.includes('code=')) return;
      sessionStorage.setItem('companionScan.portalPkce', JSON.stringify({
        verifier: 'v'.repeat(43),
        state: 'state-test',
        redirectUri: `${location.origin}/`,
      }));
    });
    let tokenRequest = null;
    await page.route('**/api/oauth/token', route => {
      tokenRequest = route.request().postDataJSON();
      route.fulfill({ json: { accessToken: 'access-test', idToken: 'id-test', expiresIn: 3600 } });
    });
    await mockWorker(page);

    await page.goto('/?code=code-test&state=state-test');
    const origin = new URL(page.url()).origin;

    await expect(page.locator('#co-ftue-title')).toHaveText('Found Companion Memory', { timeout: 15_000 });
    expect(tokenRequest).toEqual({
      code: 'code-test',
      codeVerifier: 'v'.repeat(43),
      redirectUri: `${origin}/`,
    });
    await expect(page).toHaveURL(`${origin}/`);
  });

  test('finds the memory server and its models on its own once signed in', async ({ page }) => {
    await seedSession(page);
    const calls = await mockWorker(page);

    await page.goto('/');

    await expect(page.locator('#co-ftue-title')).toHaveText('Found Companion Memory', { timeout: 15_000 });
    await expect(page.locator('#co-ftue-detail')).toHaveText('2 language models, 1 with vision. Use it to connect.');
    await expect(page.locator('#co-ftue-use')).toHaveText('Use Companion Memory');
    expect(calls.discover).toBe(1);
  });

  test('uses the server it found, and keeps that choice across a reload', async ({ page }) => {
    await seedSession(page);
    await mockWorker(page);
    await page.goto('/');

    await expect(page.locator('#co-ftue-use')).toBeVisible({ timeout: 15_000 });
    await page.click('#co-ftue-use');

    await expect(page.locator('#co-ftue-title')).toHaveText('Using Companion Memory');
    await expect(page.locator('#co-ftue-use')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('companionScan.memoryUrl'))).toBe(MEMORY_URL);

    await page.reload();
    await expect(page.locator('#co-ftue-title')).toHaveText('Using Companion Memory', { timeout: 15_000 });
  });

  test('asks for sign-in again when the Portal refuses the session', async ({ page }) => {
    await seedSession(page);
    await mockWorker(page, { listing: { portal: { ok: false, status: 401 }, memory: [] } });

    await page.goto('/');

    await expect(page.locator('#co-ftue-detail')).toHaveText('Your sign-in has expired. Sign in again.', { timeout: 15_000 });
    await expect(page.locator('#co-ftue-primary')).toHaveText('Sign in with Companion Intelligence');
    expect(await page.evaluate(() => localStorage.getItem('companionScan.portalSession'))).toBeNull();
  });

  test('signing out forgets the account and the server chosen with it', async ({ page }) => {
    await seedSession(page);
    await mockWorker(page);
    await page.goto('/');
    await expect(page.locator('#co-ftue-use')).toBeVisible({ timeout: 15_000 });
    await page.click('#co-ftue-use');
    await expect(page.locator('#co-ftue-title')).toHaveText('Using Companion Memory');

    await page.click('#co-oauth-disconnect');

    await expect(page.locator('#co-ftue-title')).toHaveText('Sign in with Companion Intelligence');
    expect(await page.evaluate(() => localStorage.getItem('companionScan.portalSession'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('companionScan.memoryUrl'))).toBeNull();
  });
});
