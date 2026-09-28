/**
 * ServerConnection — where the app finds its Companion Intelligence server
 * (a local `cv-server`, or a hosted CI-Server instance) and how it proves
 * who's asking.
 *
 * Two ways in, both meant to be usable from inside a Quest headset where
 * typing is painful:
 *
 *   - URL  — paste/save a base URL (or open the app once with
 *            `?server=https://host` to save it without typing on the
 *            in-headset keyboard). Optionally pair it with `?token=...`
 *            for a server that hands out a static API key.
 *   - OAuth — Authorization Code + PKCE against a configurable issuer
 *            (`VITE_CI_OAUTH_*` build-time env vars). No client secret is
 *            embedded, since this is a public browser client. The flow is
 *            inert — `isOAuthConfigured()` is false and the UI hides the
 *            button — until a deployment sets those env vars.
 *
 * Everything is stored in localStorage so it survives reloads and is
 * shared between the main app and the desktop viewer (same origin).
 */

const LS_SERVER_URL = 'companionScan.serverUrl';
const LS_TOKEN       = 'companionScan.serverToken';
const SS_OAUTH_STATE    = 'companionScan.oauthState';
const SS_OAUTH_VERIFIER = 'companionScan.oauthVerifier';

function readEnv(key) {
  try {
    return import.meta.env?.[key] ?? '';
  } catch {
    return '';
  }
}

function storage(kind) {
  // Guards Node/SSR contexts (unit tests, non-browser bundling) where
  // localStorage/sessionStorage don't exist.
  return typeof globalThis[kind] !== 'undefined' ? globalThis[kind] : null;
}

export const oauthConfig = {
  get authorizeUrl() { return readEnv('VITE_CI_OAUTH_AUTHORIZE_URL'); },
  get tokenUrl()      { return readEnv('VITE_CI_OAUTH_TOKEN_URL'); },
  get clientId()      { return readEnv('VITE_CI_OAUTH_CLIENT_ID'); },
  get scope()         { return readEnv('VITE_CI_OAUTH_SCOPE') || 'openid profile scan:write'; },
};

export function isOAuthConfigured() {
  return Boolean(oauthConfig.authorizeUrl && oauthConfig.tokenUrl && oauthConfig.clientId);
}

// ── Server URL ───────────────────────────────────────────────────────────

/**
 * @returns {string} '' means same-origin (Vite dev proxy, or a Worker route)
 */
export function getServerUrl() {
  const stored = storage('localStorage')?.getItem(LS_SERVER_URL);
  if (stored) return stored;
  return readEnv('VITE_CV_BASE_URL') || readEnv('VITE_DEFAULT_SERVER_URL') || '';
}

/** @param {string} url */
export function setServerUrl(url) {
  const clean = (url ?? '').trim().replace(/\/+$/, '');
  const ls = storage('localStorage');
  if (!ls) return clean;
  if (clean) ls.setItem(LS_SERVER_URL, clean);
  else ls.removeItem(LS_SERVER_URL);
  return clean;
}

// ── Token / auth header ─────────────────────────────────────────────────

export function getToken() {
  return storage('localStorage')?.getItem(LS_TOKEN) || null;
}

export function setToken(token) {
  const ls = storage('localStorage');
  if (!ls) return;
  if (token) ls.setItem(LS_TOKEN, token);
  else ls.removeItem(LS_TOKEN);
}

export function isConnected() {
  return Boolean(getToken());
}

/** Merge into fetch headers; `{}` when there's no token (anonymous/local server). */
export function getAuthHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Drop the token. The server URL is kept — it's not a secret. */
export function disconnect() {
  setToken(null);
}

// ── Quick-connect via URL params ────────────────────────────────────────

/**
 * Opening `https://<app>/?server=https://host&token=xyz` once saves both
 * and scrubs them from the address bar — the point is a headset user never
 * has to type them on the in-headset keyboard.
 */
export function applyUrlParams() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  let changed = false;

  const server = params.get('server');
  if (server) { setServerUrl(server); params.delete('server'); changed = true; }

  const token = params.get('token');
  if (token) { setToken(token); params.delete('token'); changed = true; }

  if (changed) {
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
}

// ── OAuth 2.0 Authorization Code + PKCE ─────────────────────────────────

function base64UrlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair() {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

/** Redirects the page to the configured OAuth authorize endpoint. */
export async function startOAuthLogin() {
  if (!isOAuthConfigured()) {
    throw new Error('OAuth is not configured for this deployment (VITE_CI_OAUTH_* env vars unset)');
  }
  const { verifier, challenge } = await pkcePair();
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  storage('sessionStorage')?.setItem(SS_OAUTH_VERIFIER, verifier);
  storage('sessionStorage')?.setItem(SS_OAUTH_STATE, state);

  const url = new URL(oauthConfig.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', oauthConfig.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.toString());
}

/**
 * Call once on page load. If the URL carries an OAuth `code` (i.e. we just
 * got redirected back), exchanges it for a token and scrubs the query
 * string. No-op (returns false) otherwise.
 * @returns {Promise<boolean>} true if a token was obtained
 */
export async function completeOAuthLogin() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;

  const state = params.get('state');
  const expectedState = storage('sessionStorage')?.getItem(SS_OAUTH_STATE);
  const verifier = storage('sessionStorage')?.getItem(SS_OAUTH_VERIFIER);

  // Scrub the query string regardless of outcome so a refresh never replays it.
  params.delete('code');
  params.delete('state');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  storage('sessionStorage')?.removeItem(SS_OAUTH_STATE);
  storage('sessionStorage')?.removeItem(SS_OAUTH_VERIFIER);

  if (!verifier || !state || state !== expectedState) {
    console.warn('[ServerConnection] OAuth callback missing/mismatched state — ignoring');
    return false;
  }

  const res = await fetch(oauthConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri(),
      client_id:     oauthConfig.clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth token response missing access_token');

  setToken(data.access_token);
  // A server that's multi-tenant can hand back which base URL to talk to
  // (e.g. a per-user worker/route); a single-tenant one just won't send it.
  if (data.server_url) setServerUrl(data.server_url);
  return true;
}
