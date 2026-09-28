/**
 * Unit tests for ServerConnection — server URL storage, token/auth header,
 * URL-param quick-connect, and the OAuth Authorization Code + PKCE flow.
 *
 * localStorage/sessionStorage/window are stubbed (vitest runs this suite in
 * the Node environment); crypto/btoa/fetch are real Node globals except
 * `fetch`, which is stubbed per-test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function makeStorage() {
  const map = new Map();
  return {
    getItem:    (k) => (map.has(k) ? map.get(k) : null),
    setItem:    (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function makeWindow(search = '') {
  return {
    location: {
      search,
      pathname: '/',
      origin: 'https://webxr.ci.computer',
      assign: vi.fn(),
    },
    history: { replaceState: vi.fn() },
  };
}

let ServerConnection;
let win;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
  win = makeWindow();
  vi.stubGlobal('window', win);
  ServerConnection = await import('../../src/net/ServerConnection.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ServerConnection — server URL', () => {
  it('defaults to empty string (same-origin)', () => {
    expect(ServerConnection.getServerUrl()).toBe('');
  });

  it('round-trips a saved URL and strips trailing slashes', () => {
    ServerConnection.setServerUrl('https://my-box.example.com//');
    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
  });

  it('clears the stored URL when set to an empty string', () => {
    ServerConnection.setServerUrl('https://my-box.example.com');
    ServerConnection.setServerUrl('');
    expect(ServerConnection.getServerUrl()).toBe('');
  });

  it('falls back to VITE_CV_BASE_URL when nothing is stored', () => {
    vi.stubEnv('VITE_CV_BASE_URL', 'https://default.example.com');
    expect(ServerConnection.getServerUrl()).toBe('https://default.example.com');
  });
});

describe('ServerConnection — token / auth header', () => {
  it('has no token and reports disconnected by default', () => {
    expect(ServerConnection.getToken()).toBeNull();
    expect(ServerConnection.isConnected()).toBe(false);
    expect(ServerConnection.getAuthHeader()).toEqual({});
  });

  it('stores a token and reports connected', () => {
    ServerConnection.setToken('abc123');
    expect(ServerConnection.isConnected()).toBe(true);
    expect(ServerConnection.getAuthHeader()).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('disconnect clears the token but keeps the server URL', () => {
    ServerConnection.setServerUrl('https://my-box.example.com');
    ServerConnection.setToken('abc123');
    ServerConnection.disconnect();
    expect(ServerConnection.isConnected()).toBe(false);
    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
  });
});

describe('ServerConnection — isOAuthConfigured', () => {
  it('is false when no OAuth env vars are set', () => {
    expect(ServerConnection.isOAuthConfigured()).toBe(false);
  });

  it('is true only once authorize URL, token URL, and client id are all set', () => {
    vi.stubEnv('VITE_CI_OAUTH_AUTHORIZE_URL', 'https://issuer.example.com/authorize');
    expect(ServerConnection.isOAuthConfigured()).toBe(false);
    vi.stubEnv('VITE_CI_OAUTH_TOKEN_URL', 'https://issuer.example.com/token');
    expect(ServerConnection.isOAuthConfigured()).toBe(false);
    vi.stubEnv('VITE_CI_OAUTH_CLIENT_ID', 'companion-scan-quest');
    expect(ServerConnection.isOAuthConfigured()).toBe(true);
  });
});

describe('ServerConnection — applyUrlParams', () => {
  it('saves ?server= and ?token= and scrubs them from the URL', () => {
    win.location.search = '?server=https://my-box.example.com&token=xyz&keep=1';
    ServerConnection.applyUrlParams();

    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
    expect(ServerConnection.getToken()).toBe('xyz');
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/?keep=1');
  });

  it('does nothing when there are no relevant params', () => {
    win.location.search = '?keep=1';
    ServerConnection.applyUrlParams();
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });
});

describe('ServerConnection — startOAuthLogin', () => {
  it('throws when OAuth is not configured', async () => {
    await expect(ServerConnection.startOAuthLogin()).rejects.toThrow('not configured');
  });

  it('redirects to the authorize endpoint with PKCE params', async () => {
    vi.stubEnv('VITE_CI_OAUTH_AUTHORIZE_URL', 'https://issuer.example.com/authorize');
    vi.stubEnv('VITE_CI_OAUTH_TOKEN_URL', 'https://issuer.example.com/token');
    vi.stubEnv('VITE_CI_OAUTH_CLIENT_ID', 'companion-scan-quest');

    await ServerConnection.startOAuthLogin();

    expect(win.location.assign).toHaveBeenCalledTimes(1);
    const url = new URL(win.location.assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://issuer.example.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('companion-scan-quest');
    expect(url.searchParams.get('redirect_uri')).toBe('https://webxr.ci.computer/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();

    // PKCE verifier + state are staged for the callback to consume.
    expect(sessionStorage.getItem('companionScan.oauthVerifier')).toBeTruthy();
    expect(sessionStorage.getItem('companionScan.oauthState')).toBe(url.searchParams.get('state'));
  });
});

describe('ServerConnection — completeOAuthLogin', () => {
  it('returns false when the URL carries no ?code=', async () => {
    win.location.search = '';
    expect(await ServerConnection.completeOAuthLogin()).toBe(false);
  });

  it('returns false and does not call fetch on a state mismatch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('companionScan.oauthState', 'expected-state');
    sessionStorage.setItem('companionScan.oauthVerifier', 'the-verifier');
    win.location.search = '?code=abc123&state=wrong-state';

    expect(await ServerConnection.completeOAuthLogin()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the code for a token and stores it (+ server_url if given)', async () => {
    sessionStorage.setItem('companionScan.oauthState', 'the-state');
    sessionStorage.setItem('companionScan.oauthVerifier', 'the-verifier');
    win.location.search = '?code=abc123&state=the-state&keep=1';

    vi.stubEnv('VITE_CI_OAUTH_TOKEN_URL', 'https://issuer.example.com/token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'minted-token', server_url: 'https://ci-server.example.com' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ServerConnection.completeOAuthLogin();

    expect(result).toBe(true);
    expect(ServerConnection.getToken()).toBe('minted-token');
    expect(ServerConnection.getServerUrl()).toBe('https://ci-server.example.com');
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/?keep=1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://issuer.example.com/token');
    const body = new URLSearchParams(opts.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc123');
    expect(body.get('code_verifier')).toBe('the-verifier');

    // one-time use: the verifier/state are cleared after the callback runs
    expect(sessionStorage.getItem('companionScan.oauthVerifier')).toBeNull();
    expect(sessionStorage.getItem('companionScan.oauthState')).toBeNull();
  });

  it('throws when the token endpoint rejects the exchange', async () => {
    sessionStorage.setItem('companionScan.oauthState', 'the-state');
    sessionStorage.setItem('companionScan.oauthVerifier', 'the-verifier');
    win.location.search = '?code=abc123&state=the-state';
    vi.stubEnv('VITE_CI_OAUTH_TOKEN_URL', 'https://issuer.example.com/token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(ServerConnection.completeOAuthLogin()).rejects.toThrow('400');
  });
});
