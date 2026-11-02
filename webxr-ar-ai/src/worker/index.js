/**
 * Companion Scan Quest — the Worker in front of the static app.
 *
 * It serves the app from the ASSETS binding and answers the few /api routes the
 * browser cannot call itself. The CI Portal's token endpoint and its app listing
 * do not allow this site's origin, so the Worker makes those calls server-side,
 * the same way the Companion Scan web app exchanges its code. Every client here
 * is a public PKCE client: there is no client secret anywhere.
 *
 *   GET  /api/health        → { ok, portalUrl, clientId }
 *   POST /api/oauth/token   { code, codeVerifier, redirectUri } → { accessToken, idToken, expiresIn, scope }
 *   GET  /api/session       Bearer <idToken> → { sub, email, name }
 *   POST /api/discover      { accessToken, idToken } → memory servers and their language models
 *
 * Refresh tokens never leave the Worker. Discovery only ever calls the memory
 * servers the Portal itself lists for the signed-in user, over https (or loopback
 * for local development), with a short timeout.
 *
 * The rules this file applies live in ./rules.js. Only the default export is a
 * named entry here: the Workers runtime rejects any other export from this module.
 */

import { isAllowedRedirect, memoryBase, settings } from './rules.js';

/** The Portal app slug a user's memory server is installed under. */
const MEMORY_APP_SLUG = 'ci-memory';

const PROBE_TIMEOUT_MS = 5_000;
const MAX_MEMORY_SERVERS = 3;
const MAX_MODELS = 50;
const MAX_BODY_BYTES = 8 * 1024;

export default {
  /** @param {Request} request @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> }, CI_PORTAL_URL?: string, CI_OAUTH_CLIENT_ID?: string }} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, url, settings(env));
    } catch {
      return json({ error: 'server_error', message: 'Something went wrong on the server. Try again.' }, 500);
    }
  },
};

async function route(request, url, cfg) {
  const { pathname } = url;
  const method = request.method;
  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, portalUrl: cfg.portalUrl, clientId: cfg.clientId });
  }
  if (pathname === '/api/oauth/token' && method === 'POST') {
    return tokenExchange(request, url, cfg);
  }
  if (pathname === '/api/session' && method === 'GET') {
    return session(request, cfg);
  }
  if (pathname === '/api/discover' && method === 'POST') {
    return discover(request, cfg);
  }
  return json({ error: 'not_found', message: 'No such endpoint.' }, 404);
}

async function tokenExchange(request, url, cfg) {
  const body = await readJson(request);
  const { code, codeVerifier, redirectUri } = body ?? {};
  if (typeof code !== 'string' || !code) return badRequest('The sign-in code is missing.');
  if (typeof codeVerifier !== 'string' || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return badRequest('The sign-in verifier is missing or malformed.');
  }
  if (typeof redirectUri !== 'string' || !isAllowedRedirect(redirectUri, url.origin)) {
    return badRequest('The redirect address is not this site.');
  }

  const res = await fetch(`${cfg.portalUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.access_token !== 'string') {
    return json({
      error: 'token_exchange_failed',
      status: res.status,
      message: 'Companion Intelligence did not complete the sign-in. Start again.',
    }, res.status === 400 ? 400 : 401);
  }
  return json({
    accessToken: data.access_token,
    idToken: typeof data.id_token === 'string' ? data.id_token : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
  });
}

async function session(request, cfg) {
  const token = bearer(request);
  if (!token) return json({ error: 'unauthorized', message: 'Sign in first.' }, 401);
  const res = await fetch(`${cfg.portalUrl}/api/auth/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return json({ error: 'unauthorized', message: 'Your sign-in has expired. Sign in again.' }, 401);
  const info = await res.json().catch(() => ({}));
  return json({
    sub: typeof info.sub === 'string' ? info.sub : null,
    email: typeof info.email === 'string' ? info.email : null,
    name: typeof info.name === 'string' ? info.name : null,
  });
}

async function discover(request, cfg) {
  const body = await readJson(request);
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : null;
  const idToken = typeof body?.idToken === 'string' ? body.idToken : null;
  if (!accessToken) return json({ error: 'unauthorized', message: 'Sign in first.' }, 401);

  // Which memory servers does this user have? The Portal answers this only for a
  // registered public client, so a refusal here means the app is not registered yet.
  const listing = await fetch(`${cfg.portalUrl}/api/users/me/apps?slug=${MEMORY_APP_SLUG}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!listing.ok) {
    return json({
      portal: { ok: false, status: listing.status },
      memory: [],
    });
  }
  const data = await listing.json().catch(() => ({}));
  const apps = (Array.isArray(data.apps) ? data.apps : [])
    .filter((app) => app && typeof app.url === 'string')
    .slice(0, MAX_MEMORY_SERVERS);

  const memory = await Promise.all(apps.map((app) => describeMemory(app, idToken)));
  return json({ portal: { ok: true, status: listing.status }, memory });
}

async function describeMemory(app, idToken) {
  const name = typeof app.deviceName === 'string' && app.deviceName ? app.deviceName : 'Memory server';
  const base = memoryBase(app.url);
  if (!base) {
    return { name, url: null, health: { ok: false, status: 0, reason: 'insecure_address' }, llm: null };
  }
  const health = await probe(`${base}/api/health`);
  const llm = health.ok && idToken ? await listModels(`${base}/api/llm/models`, idToken) : null;
  return {
    name,
    url: base,
    health: {
      ok: health.ok,
      status: health.status,
      portalAuthEnabled: health.body?.portalAuthEnabled ?? null,
      apiVersion: health.body?.apiVersion ?? null,
    },
    llm,
  };
}

async function listModels(url, idToken) {
  const res = await probe(url, { Authorization: `Bearer ${idToken}` });
  if (!res.ok) return { ok: false, status: res.status, models: [] };
  const list = Array.isArray(res.body) ? res.body : Array.isArray(res.body?.models) ? res.body.models : [];
  const models = list.slice(0, MAX_MODELS)
    .map((m) => ({
      id: String(m?.name ?? m?.model ?? m?.id ?? ''),
      vision: m?.vision === true,
      tools: m?.tools === true,
      thinking: m?.thinking === true,
    }))
    .filter((m) => m.id);
  return { ok: true, status: res.status, models };
}

/** A GET with a timeout that never throws: { ok, status, body }. */
async function probe(url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function bearer(request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match ? match[1] : null;
}

async function readJson(request) {
  const text = await request.text();
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function badRequest(message) {
  return json({ error: 'bad_request', message }, 400);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
