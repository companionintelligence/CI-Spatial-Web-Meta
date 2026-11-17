/**
 * Unit tests for the Worker in front of the app: the sign-in code exchange, the
 * identity call and memory-server discovery. The Portal and the memory servers
 * are stubbed at fetch(); the assets binding is stubbed too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const worker = (await import('../../src/worker/index.js')).default;
const {
  DEFAULT_QUEST_APP_PACKAGE,
  assetLinks,
  isAllowedRedirect,
  memoryBase,
  parseCertFingerprints,
} = await import('../../src/worker/rules.js');

const SITE = 'https://meta.ci.computer';
const PORTAL = 'https://hub.ci.computer';
const VERIFIER = 'a'.repeat(43);

const env = {
  ASSETS: { fetch: vi.fn(async () => new Response('static asset', { status: 200 })) },
  CI_PORTAL_URL: PORTAL,
  CI_OAUTH_CLIENT_ID: 'ci-meta',
};

/** Route fetch() calls by URL prefix. Anything unmocked answers 599 so a test sees it. */
function portalRouter(routes) {
  return vi.fn(async (input, init = {}) => {
    const url = String(input);
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) return handler(url, init);
    }
    return new Response(`not mocked: ${url}`, { status: 599 });
  });
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function call(path, init = {}, origin = SITE) {
  return worker.fetch(new Request(`${origin}${path}`, init), env);
}

function post(path, body, headers = {}) {
  return call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

let fetchMock;

beforeEach(() => {
  env.ASSETS.fetch.mockClear();
  fetchMock = portalRouter([]);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routing', () => {
  it('answers the health route with the configured Portal and client', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, portalUrl: PORTAL, clientId: 'ci-meta' });
  });

  it('hands every non-API path to the static assets', async () => {
    const res = await call('/index.html');
    expect(await res.text()).toBe('static asset');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for an unknown API route, and 404 for the wrong method', async () => {
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/discover')).status).toBe(404);
  });
});

describe('POST /api/oauth/token', () => {
  it('refuses a missing code without calling the Portal', async () => {
    const res = await post('/api/oauth/token', { codeVerifier: VERIFIER, redirectUri: `${SITE}/` });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a verifier that is too short or too long', async () => {
    expect((await post('/api/oauth/token', { code: 'c', codeVerifier: 'short', redirectUri: `${SITE}/` })).status).toBe(400);
    expect((await post('/api/oauth/token', { code: 'c', codeVerifier: 'b'.repeat(129), redirectUri: `${SITE}/` })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a redirect address that is not this site', async () => {
    const res = await post('/api/oauth/token', { code: 'c', codeVerifier: VERIFIER, redirectUri: 'https://evil.example/' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the code with the Portal as a public client and returns no refresh token', async () => {
    fetchMock = portalRouter([[`${PORTAL}/api/auth/oauth2/token`, () => json({
      access_token: 'access-1',
      id_token: 'id-1',
      refresh_token: 'refresh-must-not-leave',
      expires_in: 3600,
      scope: 'openid profile email',
    })]]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await post('/api/oauth/token', { code: 'code-1', codeVerifier: VERIFIER, redirectUri: `${SITE}/` });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: 'access-1',
      idToken: 'id-1',
      expiresIn: 3600,
      scope: 'openid profile email',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PORTAL}/api/auth/oauth2/token`);
    const form = new URLSearchParams(init.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe('ci-meta');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('code_verifier')).toBe(VERIFIER);
    expect(form.get('redirect_uri')).toBe(`${SITE}/`);
    expect(form.has('client_secret')).toBe(false);
  });

  it('accepts the loopback callback for local development', async () => {
    fetchMock = portalRouter([[`${PORTAL}/api/auth/oauth2/token`, () => json({ access_token: 'a' })]]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await post('/api/oauth/token', {
      code: 'c', codeVerifier: VERIFIER, redirectUri: 'http://127.0.0.1:8787/',
    }, {});
    expect(res.status).toBe(200);
  });

  it('reports a failed exchange without echoing the Portal', async () => {
    fetchMock = portalRouter([[`${PORTAL}/api/auth/oauth2/token`, () => json({ error: 'invalid_grant', error_description: 'secret detail' }, 400)]]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await post('/api/oauth/token', { code: 'c', codeVerifier: VERIFIER, redirectUri: `${SITE}/` });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('token_exchange_failed');
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });
});

describe('GET /api/session', () => {
  it('requires a bearer token', async () => {
    expect((await call('/api/session')).status).toBe(401);
  });

  it('answers 401 when the Portal refuses the token', async () => {
    fetchMock = portalRouter([[`${PORTAL}/api/auth/oauth2/userinfo`, () => new Response('no', { status: 401 })]]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/api/session', { headers: { Authorization: 'Bearer expired' } });
    expect(res.status).toBe(401);
  });

  it('returns only the identity fields', async () => {
    fetchMock = portalRouter([[`${PORTAL}/api/auth/oauth2/userinfo`, () => json({
      sub: 'user-1', email: 'me@example.com', name: 'Me', phone: 'do-not-return',
    })]]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/api/session', { headers: { Authorization: 'Bearer good' } });
    expect(await res.json()).toEqual({ sub: 'user-1', email: 'me@example.com', name: 'Me' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer good');
  });
});

describe('POST /api/discover', () => {
  it('requires the access token', async () => {
    expect((await post('/api/discover', { idToken: 'i' })).status).toBe(401);
  });

  it('reports the Portal refusing the listing, so the app can say so', async () => {
    fetchMock = portalRouter([[`${PORTAL}/api/users/me/apps`, () => new Response('forbidden', { status: 403 })]]);
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await post('/api/discover', { accessToken: 'a', idToken: 'i' })).json();
    expect(body).toEqual({ portal: { ok: false, status: 403 }, memory: [] });
  });

  it('lists the memory servers without contacting them or sending any token to them', async () => {
    fetchMock = portalRouter([
      [`${PORTAL}/api/users/me/apps`, () => json({
        apps: [{ slug: 'ci-memory', url: 'https://memory.example.com', deviceName: 'Living room Core' }],
      })],
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const body = await (await post('/api/discover', { accessToken: 'a', idToken: 'id-1' })).json();

    expect(body.portal).toEqual({ ok: true, status: 200 });
    expect(body.memory).toEqual([{
      name: 'Living room Core',
      url: 'https://memory.example.com',
      checked: false,
      health: null,
      llm: null,
    }]);
    const contacted = fetchMock.mock.calls.map(([url]) => String(url));
    expect(contacted.some((url) => url.startsWith('https://memory.example.com'))).toBe(false);
  });

  it('never calls an insecure memory address', async () => {
    fetchMock = portalRouter([
      [`${PORTAL}/api/users/me/apps`, () => json({ apps: [{ url: 'http://memory.example.com' }] })],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await post('/api/discover', { accessToken: 'a' })).json();
    expect(body.memory[0]).toMatchObject({ url: null, health: { ok: false, reason: 'insecure_address' }, llm: null });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('http://memory'))).toBe(false);
  });

  it('looks at no more than three memory servers', async () => {
    const apps = [1, 2, 3, 4, 5].map((i) => ({ url: `https://m${i}.example.com` }));
    fetchMock = portalRouter([
      [`${PORTAL}/api/users/me/apps`, () => json({ apps })],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await post('/api/discover', { accessToken: 'a' })).json();
    expect(body.memory).toHaveLength(3);
  });
});

describe('POST /api/memory/check — a health check the user asks for', () => {
  const LISTED = [`${PORTAL}/api/users/me/apps`, () => json({ apps: [{ url: 'https://memory.example.com' }] })];

  it('requires the access token', async () => {
    expect((await post('/api/memory/check', { url: 'https://memory.example.com' })).status).toBe(401);
  });

  it('checks the health of a listed server with no credentials, and refuses redirects', async () => {
    fetchMock = portalRouter([
      LISTED,
      ['https://memory.example.com/api/health', () => json({ status: 'ok', portalAuthEnabled: true, apiVersion: 1 })],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await post('/api/memory/check', { accessToken: 'a', url: 'https://memory.example.com/' }, {});
    expect(await res.json()).toEqual({
      url: 'https://memory.example.com',
      health: { ok: true, status: 200, portalAuthEnabled: true, apiVersion: 1 },
    });
    const health = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/health'));
    expect(health[1].headers.Authorization).toBeUndefined();
    expect(health[1].redirect).toBe('error');
  });

  it('refuses an address that is not on the account, and contacts it not at all', async () => {
    fetchMock = portalRouter([LISTED]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await post('/api/memory/check', { accessToken: 'a', url: 'https://elsewhere.example.com' });
    expect(res.status).toBe(404);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('elsewhere.example.com'))).toBe(false);
  });

  it('refuses an insecure address before anything is requested', async () => {
    fetchMock = portalRouter([LISTED]);
    vi.stubGlobal('fetch', fetchMock);
    expect((await post('/api/memory/check', { accessToken: 'a', url: 'http://memory.example.com' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers a server that is down as unhealthy, not as an error', async () => {
    fetchMock = portalRouter([
      LISTED,
      ['https://memory.example.com/api/health', () => { throw new TypeError('Failed to fetch'); }],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await post('/api/memory/check', { accessToken: 'a', url: 'https://memory.example.com' })).json();
    expect(body.health).toEqual({ ok: false, status: 0, portalAuthEnabled: null, apiVersion: null });
  });
});

describe('POST /api/memory/models — the sign-in token goes to one listed server', () => {
  const LISTED = [`${PORTAL}/api/users/me/apps`, () => json({ apps: [{ url: 'https://memory.example.com' }] })];

  it('requires both tokens', async () => {
    expect((await post('/api/memory/models', { accessToken: 'a', url: 'https://memory.example.com' })).status).toBe(401);
    expect((await post('/api/memory/models', { idToken: 'i', url: 'https://memory.example.com' })).status).toBe(401);
  });

  it('sends the id token to the listed server it is asked about, and to no redirect', async () => {
    fetchMock = portalRouter([
      LISTED,
      ['https://memory.example.com/api/llm/models', () => json([{ name: 'qwen-vl', vision: true, tools: true }])],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await post('/api/memory/models', { accessToken: 'a', idToken: 'id-1', url: 'https://memory.example.com' })).json();
    expect(body.llm.ok).toBe(true);
    expect(body.llm.models).toEqual([{ id: 'qwen-vl', vision: true, tools: true, thinking: false }]);
    const models = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/llm/models'));
    expect(models[1].headers.Authorization).toBe('Bearer id-1');
    expect(models[1].redirect).toBe('error');
  });

  it('never sends the id token to an address the account does not list', async () => {
    fetchMock = portalRouter([LISTED]);
    vi.stubGlobal('fetch', fetchMock);
    const res = await post('/api/memory/models', { accessToken: 'a', idToken: 'id-1', url: 'https://attacker.example.com' });
    expect(res.status).toBe(404);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('attacker.example.com'))).toBe(false);
  });
});

describe('redirect and memory address rules', () => {
  it('admits only this site root, or a loopback root', () => {
    expect(isAllowedRedirect(`${SITE}/`, SITE)).toBe(true);
    expect(isAllowedRedirect('http://localhost:5173/', SITE)).toBe(true);
    expect(isAllowedRedirect('https://127.0.0.1:8081/', SITE)).toBe(true);
    expect(isAllowedRedirect(`${SITE}/other`, SITE)).toBe(false);
    expect(isAllowedRedirect(`${SITE}/?x=1`, SITE)).toBe(false);
    expect(isAllowedRedirect('https://evil.example/', SITE)).toBe(false);
    expect(isAllowedRedirect('not a url', SITE)).toBe(false);
  });

  it('keeps only safe memory addresses, normalised', () => {
    expect(memoryBase('https://memory.example.com/')).toBe('https://memory.example.com');
    expect(memoryBase('https://memory.example.com/base/')).toBe('https://memory.example.com/base');
    expect(memoryBase('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(memoryBase('http://memory.example.com')).toBeNull();
    expect(memoryBase('https://user:pw@memory.example.com')).toBeNull();
    expect(memoryBase('https://memory.example.com/?token=1')).toBeNull();
    expect(memoryBase('javascript:alert(1)')).toBeNull();
  });
});

// A made-up certificate digest: 32 bytes, as keytool prints them.
const CERT = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const CERT_HEX = CERT.replace(/:/g, '').toLowerCase();

describe('GET /.well-known/assetlinks.json', () => {
  const linked = { ...env, QUEST_APP_CERT_SHA256: CERT };

  it('lets the Quest app, signed by the configured certificate, open this site', async () => {
    const res = await worker.fetch(new Request(`${SITE}/.well-known/assetlinks.json`), linked);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: DEFAULT_QUEST_APP_PACKAGE,
          sha256_cert_fingerprints: [CERT],
        },
      },
    ]);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the package the Worker is configured with', async () => {
    const res = await worker.fetch(
      new Request(`${SITE}/.well-known/assetlinks.json`),
      { ...linked, QUEST_APP_PACKAGE: 'computer.ci.example' },
    );
    expect((await res.json())[0].target.package_name).toBe('computer.ci.example');
  });

  it('answers HEAD without a body', async () => {
    const res = await worker.fetch(new Request(`${SITE}/.well-known/assetlinks.json`, { method: 'HEAD' }), linked);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('is the site 404 until a fingerprint is configured', async () => {
    const res = await call('/.well-known/assetlinks.json');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe('static asset');
  });

  it('serves nothing for a malformed fingerprint or package', async () => {
    for (const bad of [
      { ...env, QUEST_APP_CERT_SHA256: 'AB:CD' },
      { ...env, QUEST_APP_CERT_SHA256: CERT, QUEST_APP_PACKAGE: 'not a package' },
    ]) {
      env.ASSETS.fetch.mockClear();
      await worker.fetch(new Request(`${SITE}/.well-known/assetlinks.json`), bad);
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses other methods', async () => {
    const res = await worker.fetch(new Request(`${SITE}/.well-known/assetlinks.json`, { method: 'POST' }), linked);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('certificate fingerprints', () => {
  it('accepts the keytool form in either case, and bare hex', () => {
    expect(parseCertFingerprints(CERT)).toEqual([CERT]);
    expect(parseCertFingerprints(CERT.toLowerCase())).toEqual([CERT]);
    expect(parseCertFingerprints(CERT_HEX)).toEqual([CERT]);
  });

  it('takes several, separated by commas or spaces, without duplicates', () => {
    const other = '01'.repeat(32);
    expect(parseCertFingerprints(`${CERT}, ${other}
${CERT_HEX}`)).toEqual([
      CERT,
      '01:'.repeat(31) + '01',
    ]);
  });

  it('is empty when nothing is set, and null when any entry is malformed', () => {
    expect(parseCertFingerprints('')).toEqual([]);
    expect(parseCertFingerprints(undefined)).toEqual([]);
    expect(parseCertFingerprints(`${CERT},AB:CD`)).toBeNull();
    expect(parseCertFingerprints('g'.repeat(64))).toBeNull();
    expect(parseCertFingerprints('ABC:D'.repeat(16))).toBeNull();
  });

  it('builds no statement without a fingerprint', () => {
    expect(assetLinks({})).toBeNull();
    expect(assetLinks({ QUEST_APP_CERT_SHA256: CERT })[0].target.package_name).toBe(DEFAULT_QUEST_APP_PACKAGE);
  });
});
