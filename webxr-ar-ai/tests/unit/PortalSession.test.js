/**
 * Unit tests for PortalSession — the "Sign in with Companion Intelligence" flow
 * (OIDC Authorization Code with PKCE S256). Storage, the window and fetch are
 * stubbed; the PKCE challenge is checked against the RFC 7636 test vector.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  authorizeUrl,
  base64url,
  beginSignIn,
  clearSession,
  discoverResources,
  fetchIdentity,
  finishSignIn,
  getSession,
  pkceChallenge,
  portalConfig,
  randomToken,
  siteRedirect,
} from '../../src/net/PortalSession.js';

const PORTAL = 'https://hub.ci.computer';
const SITE = 'https://meta.ci.computer';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

function fakeWindow(search = '') {
  return {
    location: {
      origin: SITE,
      pathname: '/',
      search,
      assign: vi.fn(),
    },
    history: { replaceState: vi.fn() },
  };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('encoding helpers', () => {
  it('encodes base64url without padding or + and /', () => {
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
    expect(base64url(new Uint8Array([0]))).toBe('AA');
  });

  it('makes random tokens of the requested size with a URL-safe alphabet', () => {
    const token = randomToken(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomToken(32)).not.toBe(token);
  });

  it('derives the S256 code challenge (RFC 7636 appendix B)', async () => {
    const challenge = await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('configuration and URLs', () => {
  it('reads the Portal and client from the Worker settings', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, portalUrl: PORTAL, clientId: 'ci-meta' }));
    expect(await portalConfig({ fetchFn })).toEqual({ portalUrl: PORTAL, clientId: 'ci-meta' });
    expect(fetchFn.mock.calls[0][0]).toBe('/api/health');
  });

  it('refuses to start sign-in when the Worker gives no settings', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'server_error' }, 500));
    await expect(portalConfig({ fetchFn })).rejects.toThrow('Sign-in is not available');
  });

  it('refuses to start sign-in when the Worker cannot be reached', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(portalConfig({ fetchFn })).rejects.toThrow('Sign-in is not available');
  });

  it('redirects back to exactly this site root', () => {
    expect(siteRedirect({ origin: SITE })).toBe(`${SITE}/`);
  });

  it('builds the Portal authorize request with OIDC, PKCE S256 and the app scopes', () => {
    const url = new URL(authorizeUrl({
      portalUrl: PORTAL,
      clientId: 'ci-meta',
      redirectUri: `${SITE}/`,
      state: 'state-1',
      challenge: 'challenge-1',
    }));
    expect(url.origin + url.pathname).toBe(`${PORTAL}/api/auth/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'ci-meta',
      redirect_uri: `${SITE}/`,
      scope: 'openid profile email',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    });
  });
});

describe('beginSignIn', () => {
  const healthFetch = () => vi.fn(async () => jsonResponse({ ok: true, portalUrl: PORTAL, clientId: 'ci-meta' }));

  it('remembers the verifier and state for this tab, then sends the user to the Portal', async () => {
    const win = fakeWindow();
    const storage = memoryStorage();

    const url = await beginSignIn({ win, storage, fetchFn: healthFetch() });

    expect(win.location.assign).toHaveBeenCalledWith(url);
    const sent = new URL(url);
    expect(sent.origin).toBe(PORTAL);
    expect(sent.searchParams.get('client_id')).toBe('ci-meta');
    expect(sent.searchParams.get('code_challenge_method')).toBe('S256');
    const saved = JSON.parse(storage.getItem('companionScan.portalPkce'));
    expect(saved.state).toBe(sent.searchParams.get('state'));
    expect(saved.redirectUri).toBe(`${SITE}/`);
    expect(await pkceChallenge(saved.verifier)).toBe(sent.searchParams.get('code_challenge'));
  });

  it('sends nothing and stores nothing when the Worker gives no settings', async () => {
    const win = fakeWindow();
    const storage = memoryStorage();
    const fetchFn = vi.fn(async () => jsonResponse({}, 500));

    await expect(beginSignIn({ win, storage, fetchFn })).rejects.toThrow('Sign-in is not available');
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(storage.getItem('companionScan.portalPkce')).toBeNull();
  });
});

describe('finishSignIn', () => {
  it('does nothing when the page was not returned from the Portal', async () => {
    const session = await finishSignIn({ win: fakeWindow(''), storage: memoryStorage(), local: memoryStorage() });
    expect(session).toBeNull();
  });

  it('exchanges the code on this site and stores the session with its expiry', async () => {
    const storage = memoryStorage({
      'companionScan.portalPkce': JSON.stringify({ verifier: 'v'.repeat(43), state: 's-1', redirectUri: `${SITE}/` }),
    });
    const local = memoryStorage();
    const win = fakeWindow('?code=code-1&state=s-1');
    const fetchFn = vi.fn(async () => jsonResponse({ accessToken: 'a-1', idToken: 'i-1', expiresIn: 60 }));

    const session = await finishSignIn({
      win, storage, local, fetchFn, now: () => 1_000_000,
    });

    expect(session).toEqual({ accessToken: 'a-1', idToken: 'i-1', expiresAt: 1_060_000, identity: null });
    expect(getSession({ local, now: () => 1_000_001 })).toEqual(session);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/oauth/token');
    expect(JSON.parse(init.body)).toEqual({ code: 'code-1', codeVerifier: 'v'.repeat(43), redirectUri: `${SITE}/` });
    expect(storage.getItem('companionScan.portalPkce')).toBeNull();
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('refuses a return whose state does not match this tab, and clears the one-time verifier', async () => {
    const storage = memoryStorage({
      'companionScan.portalPkce': JSON.stringify({ verifier: 'v'.repeat(43), state: 'expected', redirectUri: `${SITE}/` }),
    });
    const fetchFn = vi.fn();
    await expect(finishSignIn({
      win: fakeWindow('?code=c&state=other'), storage, local: memoryStorage(), fetchFn,
    })).rejects.toThrow('did not start in this browser');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(storage.getItem('companionScan.portalPkce')).toBeNull();
  });

  it('reports a failed exchange with the message the Worker gives', async () => {
    const storage = memoryStorage({
      'companionScan.portalPkce': JSON.stringify({ verifier: 'v'.repeat(43), state: 's', redirectUri: `${SITE}/` }),
    });
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'Start again.' }, 400));
    await expect(finishSignIn({
      win: fakeWindow('?code=c&state=s'), storage, local: memoryStorage(), fetchFn,
    })).rejects.toThrow('Start again.');
  });
});

describe('session storage', () => {
  it('ends a session once its access token has expired', () => {
    const local = memoryStorage({
      'companionScan.portalSession': JSON.stringify({ accessToken: 'a', expiresAt: 100 }),
    });
    expect(getSession({ local, now: () => 50 })).not.toBeNull();
    expect(getSession({ local, now: () => 200 })).toBeNull();
  });

  it('treats an unreadable stored session as none', () => {
    const local = memoryStorage({ 'companionScan.portalSession': '{not json' });
    expect(getSession({ local })).toBeNull();
  });

  it('forgets the session on sign-out', () => {
    const local = memoryStorage({ 'companionScan.portalSession': JSON.stringify({ accessToken: 'a', expiresAt: 1e15 }) });
    clearSession(local);
    expect(getSession({ local })).toBeNull();
  });
});

describe('fetchIdentity', () => {
  it('stores who the session belongs to', async () => {
    const local = memoryStorage({
      'companionScan.portalSession': JSON.stringify({ accessToken: 'a-1', expiresAt: 1e15, identity: null }),
    });
    const fetchFn = vi.fn(async () => jsonResponse({ sub: 'u', email: 'me@example.com', name: 'Me' }));

    const identity = await fetchIdentity({ session: { accessToken: 'a-1' }, fetchFn, local });

    expect(identity).toEqual({ sub: 'u', email: 'me@example.com', name: 'Me' });
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer a-1');
    expect(JSON.parse(local.getItem('companionScan.portalSession')).identity).toEqual(identity);
  });

  it('ends the session when the sign-in has expired', async () => {
    const local = memoryStorage({ 'companionScan.portalSession': JSON.stringify({ accessToken: 'a', expiresAt: 1e15 }) });
    const fetchFn = vi.fn(async () => jsonResponse({}, 401));
    await expect(fetchIdentity({ session: { accessToken: 'a' }, fetchFn, local })).rejects.toThrow('expired');
    expect(local.getItem('companionScan.portalSession')).toBeNull();
  });
});

describe('discoverResources', () => {
  it('sends both tokens to this site and returns the listing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ portal: { ok: true, status: 200 }, memory: [] }));
    const out = await discoverResources({
      session: { accessToken: 'a', idToken: 'i' }, fetchFn, local: memoryStorage(),
    });
    expect(out).toEqual({ portal: { ok: true, status: 200 }, memory: [] });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ accessToken: 'a', idToken: 'i' });
  });

  it('ends the session when the sign-in is refused', async () => {
    const local = memoryStorage({ 'companionScan.portalSession': JSON.stringify({ accessToken: 'a', expiresAt: 1e15 }) });
    const fetchFn = vi.fn(async () => jsonResponse({}, 401));
    await discoverResources({ session: { accessToken: 'a' }, fetchFn, local });
    expect(local.getItem('companionScan.portalSession')).toBeNull();
  });

  it('ends the session when the Portal refuses the sign-in behind the listing', async () => {
    const local = memoryStorage({ 'companionScan.portalSession': JSON.stringify({ accessToken: 'a', expiresAt: 1e15 }) });
    const fetchFn = vi.fn(async () => jsonResponse({ portal: { ok: false, status: 401 }, memory: [] }));
    const out = await discoverResources({ session: { accessToken: 'a' }, fetchFn, local });
    expect(out.portal).toEqual({ ok: false, status: 401 });
    expect(local.getItem('companionScan.portalSession')).toBeNull();
  });

  it('says so when the lookup fails for any other reason', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 502));
    await expect(discoverResources({ session: { accessToken: 'a' }, fetchFn, local: memoryStorage() }))
      .rejects.toThrow('Could not look up your servers');
  });
});
