/**
 * PortalSession — "Sign in with Companion Intelligence".
 *
 * This is the sign-on Companion Hub, CI-Server and the other first-party apps
 * use: OpenID Connect Authorization Code with PKCE (S256) against the CI Portal.
 * The app is a public client (no secret), registered with the Portal as
 * `ci-meta`. The code is exchanged on this site's Worker (/api/oauth/token),
 * because the Portal does not allow this origin to call its token endpoint.
 *
 * Tokens are kept per browser in localStorage, with their expiry. Refresh tokens
 * never reach the browser; a session simply ends when its access token does.
 */

/** The scopes this app asks for. Matches the Portal's first-party clients. */
export const PORTAL_SCOPE = 'openid profile email';

const LS_SESSION = 'companionScan.portalSession';
const SS_PKCE = 'companionScan.portalPkce';
const DEFAULT_LIFETIME_S = 3600;

/**
 * The Portal and client this app signs in with, as the Worker is configured
 * (`CI_PORTAL_URL` and `CI_OAUTH_CLIENT_ID` in wrangler.toml). The browser reads them
 * from the Worker, so the authorize request and the code exchange cannot disagree.
 * @returns {Promise<{ portalUrl: string, clientId: string }>}
 * @throws {Error} when the Worker does not answer with its settings
 */
export async function portalConfig({ fetchFn = globalThis.fetch, api = '/api' } = {}) {
  const res = await fetchFn(`${api}/health`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (typeof data?.portalUrl !== 'string' || typeof data?.clientId !== 'string') {
    throw new Error('Sign-in is not available right now. Try again later.');
  }
  return { portalUrl: data.portalUrl, clientId: data.clientId };
}

/** Base64url without padding, as RFC 7636 and RFC 7515 require. */
export function base64url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random token of `byteLength` bytes, base64url-encoded. */
export function randomToken(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** The S256 code challenge for a verifier (RFC 7636 §4.2). */
export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The callback the Portal returns the user to: this site's root, exactly. */
export function siteRedirect(location) {
  return `${location.origin}/`;
}

/**
 * The Portal's authorize URL for this app.
 * @returns {string}
 */
export function authorizeUrl({ portalUrl, clientId, redirectUri, state, challenge }) {
  const url = new URL(`${portalUrl}/api/auth/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', PORTAL_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Start sign-in: read the Portal's settings from the Worker, remember the verifier
 * and state for this tab, then send the user to the Portal.
 * @returns {Promise<string>} the authorize URL the page navigates to
 * @throws {Error} when the Worker gives no settings; nothing is stored or sent
 */
export async function beginSignIn({
  win = globalThis.window,
  storage = globalThis.sessionStorage,
  fetchFn = globalThis.fetch,
  api = '/api',
} = {}) {
  const config = await portalConfig({ fetchFn, api });
  const verifier = randomToken(32);
  const state = randomToken(16);
  const redirectUri = siteRedirect(win.location);
  storage.setItem(SS_PKCE, JSON.stringify({ verifier, state, redirectUri }));
  const challenge = await pkceChallenge(verifier);
  const url = authorizeUrl({ ...config, redirectUri, state, challenge });
  win.location.assign(url);
  return url;
}

/**
 * Finish sign-in when the Portal has sent the user back with a code. Returns
 * the new session, or null when this load is not a sign-in return.
 * @throws {Error} when the return does not match this tab's sign-in, or the
 *   exchange fails. The one-time verifier is removed either way.
 */
export async function finishSignIn({
  win = globalThis.window,
  storage = globalThis.sessionStorage,
  local = globalThis.localStorage,
  fetchFn = globalThis.fetch,
  now = Date.now,
  api = '/api',
} = {}) {
  const params = new URLSearchParams(win.location.search);
  const code = params.get('code');
  if (!code) return null;
  const state = params.get('state');

  const saved = readJson(storage, SS_PKCE);
  storage.removeItem(SS_PKCE);
  scrubQuery(win, ['code', 'state']);

  if (!saved || !state || state !== saved.state) {
    throw new Error('That sign-in did not start in this browser. Start it again.');
  }

  const res = await fetchFn(`${api}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, codeVerifier: saved.verifier, redirectUri: saved.redirectUri }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.accessToken) {
    throw new Error(data.message ?? 'Sign-in did not complete. Start again.');
  }

  const session = {
    accessToken: data.accessToken,
    idToken: data.idToken ?? null,
    expiresAt: now() + (data.expiresIn ?? DEFAULT_LIFETIME_S) * 1000,
    identity: null,
  };
  local.setItem(LS_SESSION, JSON.stringify(session));
  return session;
}

/** The stored session, or null when there is none or it has expired. */
export function getSession({ local = globalThis.localStorage, now = Date.now } = {}) {
  const session = readJson(local, LS_SESSION);
  if (!session?.accessToken || !(session.expiresAt > now())) return null;
  return session;
}

/** Forget the session in this browser. */
export function clearSession(local = globalThis.localStorage) {
  local.removeItem(LS_SESSION);
}

/**
 * Who the session belongs to (the Portal's userinfo, via this site's Worker).
 * Stores the identity with the session. A refused call ends the session.
 * @returns {Promise<{ sub: string|null, email: string|null, name: string|null }>}
 */
export async function fetchIdentity({
  session,
  fetchFn = globalThis.fetch,
  local = globalThis.localStorage,
  api = '/api',
} = {}) {
  const res = await fetchFn(`${api}/session`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    clearSession(local);
    throw new Error('Your sign-in has expired. Sign in again.');
  }
  const data = await res.json();
  const identity = { sub: data.sub ?? null, email: data.email ?? null, name: data.name ?? null };
  local.setItem(LS_SESSION, JSON.stringify({ ...session, identity }));
  return identity;
}

/**
 * The memory servers and language models the Portal lists for this account.
 * A refused listing ends the session (401); anything else is reported as-is.
 * @returns {Promise<{ portal: { ok: boolean, status: number }, memory: Array<object> }>}
 */
export async function discoverResources({
  session,
  fetchFn = globalThis.fetch,
  local = globalThis.localStorage,
  api = '/api',
} = {}) {
  const res = await fetchFn(`${api}/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ accessToken: session.accessToken, idToken: session.idToken }),
  });
  if (!res.ok && res.status !== 401) {
    throw new Error('Could not look up your servers just now. Try again.');
  }
  const listing = await res.json().catch(() => ({}));
  // The Worker answers 200 with portal.status 401 when the Portal has refused the
  // sign-in, and that ends the session just as a 401 does.
  if (res.status === 401 || listing?.portal?.status === 401) clearSession(local);
  return listing;
}

function readJson(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Remove query parameters from the address bar without a reload. */
function scrubQuery(win, names) {
  const params = new URLSearchParams(win.location.search);
  for (const name of names) params.delete(name);
  const rest = params.toString();
  win.history?.replaceState?.(null, '', win.location.pathname + (rest ? `?${rest}` : ''));
}
