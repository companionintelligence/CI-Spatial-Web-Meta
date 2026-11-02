/**
 * ServerConnection — where the app finds its servers, and the tokens it sends to them.
 *
 *   - CV server   the `serverUrl` (a local `cv-server`, or any server that speaks its API).
 *                 Scans upload and the capture pipeline use it.
 *   - Memory      the `memoryUrl`, a user's Companion Memory server, found by discovery
 *                 (see PortalSession and ftueModel) or set by hand.
 *   - Static key  an optional `?token=` / Settings token for a server that hands out a
 *                 static API key. It is bound to the server it was issued for.
 *
 * Sign-in with Companion Intelligence lives in ./PortalSession.js. Nothing here
 * stores or sends a Portal token; those are kept by that module.
 *
 * Everything is stored in localStorage so it survives reloads and is shared between
 * the main app and the desktop viewer (same origin).
 */

const LS_SERVER_URL   = 'companionScan.serverUrl';
const LS_MEMORY_URL   = 'companionScan.memoryUrl';
const LS_TOKEN        = 'companionScan.serverToken';
const LS_TOKEN_ORIGIN = 'companionScan.serverTokenOrigin';

function readEnv(key) {
  try {
    return import.meta.env?.[key] ?? '';
  } catch {
    return '';
  }
}

function storage(kind) {
  // Guards Node/SSR contexts (unit tests, non-browser bundling) where
  // localStorage doesn't exist.
  return typeof globalThis[kind] !== 'undefined' ? globalThis[kind] : null;
}

// ── Server URLs ──────────────────────────────────────────────────────────

/**
 * @returns {string} the CV server base; '' means same-origin (Vite dev proxy, or a Worker route)
 */
export function getServerUrl() {
  const stored = storage('localStorage')?.getItem(LS_SERVER_URL);
  if (stored) return stored;
  return readEnv('VITE_CV_BASE_URL') || readEnv('VITE_DEFAULT_SERVER_URL') || '';
}

/**
 * Validate and tidy a server base URL. Only http(s) addresses are accepted.
 * @param {string} url
 * @returns {string} the cleaned URL, or '' for same-origin
 * @throws {TypeError} when the value is not an http(s) URL
 */
export function normaliseServerUrl(url) {
  const clean = (url ?? '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    throw new TypeError('Server address must be a full URL, such as https://host:8000');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Server address must start with https:// or http://');
  }
  return clean;
}

/**
 * Save the CV server base URL ('' = same-origin). A static token issued for a
 * different server is dropped, so it can never reach the new one.
 * @param {string} url
 * @returns {string} the saved URL
 * @throws {TypeError} when the URL is not http(s)
 */
export function setServerUrl(url) {
  const clean = normaliseServerUrl(url);
  const ls = storage('localStorage');
  if (!ls) return clean;
  if (clean) ls.setItem(LS_SERVER_URL, clean);
  else ls.removeItem(LS_SERVER_URL);
  if (ls.getItem(LS_TOKEN_ORIGIN) !== currentServerOrigin()) dropToken(ls);
  return clean;
}

/** @returns {string} the memory server the user chose, or '' */
export function getMemoryUrl() {
  return storage('localStorage')?.getItem(LS_MEMORY_URL) ?? '';
}

/**
 * Save the memory server the user chose ('' clears it).
 * @param {string} url
 * @returns {string} the saved URL
 * @throws {TypeError} when the URL is not http(s)
 */
export function setMemoryUrl(url) {
  const clean = normaliseServerUrl(url);
  const ls = storage('localStorage');
  if (!ls) return clean;
  if (clean) ls.setItem(LS_MEMORY_URL, clean);
  else ls.removeItem(LS_MEMORY_URL);
  return clean;
}

/**
 * Origin the app talks to right now: the saved CV server, or this page's own
 * origin when none is saved.
 * @returns {string|null} null when the saved URL cannot be parsed
 */
export function currentServerOrigin() {
  const pageOrigin = globalThis.window?.location?.origin ?? '';
  const url = getServerUrl();
  if (!url) return pageOrigin;
  try {
    return new URL(url, pageOrigin || undefined).origin;
  } catch {
    return null;
  }
}

// ── Static token / auth header ───────────────────────────────────────────

/**
 * The saved static token, but only while the app is talking to the server it was
 * issued for. Otherwise null.
 */
export function getToken() {
  const ls = storage('localStorage');
  const token = ls?.getItem(LS_TOKEN);
  if (!token) return null;
  return ls.getItem(LS_TOKEN_ORIGIN) === currentServerOrigin() ? token : null;
}

/** Save a static token for the CV server the app is talking to now. Falsy clears it. */
export function setToken(token) {
  const ls = storage('localStorage');
  if (!ls) return;
  if (token) {
    ls.setItem(LS_TOKEN, token);
    ls.setItem(LS_TOKEN_ORIGIN, currentServerOrigin() ?? '');
  } else {
    dropToken(ls);
  }
}

function dropToken(ls) {
  ls.removeItem(LS_TOKEN);
  ls.removeItem(LS_TOKEN_ORIGIN);
}

export function isConnected() {
  return Boolean(getToken());
}

/** Merge into fetch headers; `{}` when there's no token (anonymous/local server). */
export function getAuthHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Drop the static token. The server URLs are kept — they are not secrets. */
export function disconnect() {
  setToken(null);
}

// ── Quick-connect via URL params ────────────────────────────────────────

/**
 * Opening `https://<app>/?server=https://host&token=xyz` once saves both
 * and scrubs them from the address bar — the point is a headset user never
 * has to type them on the in-headset keyboard.
 *
 * An invalid `?server=` is ignored (and still scrubbed from the address bar).
 *
 * @returns {{ serverSet: string | null, tokenSet: boolean }} what was applied
 */
export function applyUrlParams() {
  const applied = { serverSet: null, tokenSet: false };
  if (typeof window === 'undefined') return applied;
  const params = new URLSearchParams(window.location.search);
  let changed = false;

  const server = params.get('server');
  if (server) {
    params.delete('server');
    changed = true;
    try {
      applied.serverSet = setServerUrl(server) || window.location.origin;
    } catch (err) {
      console.warn('[ServerConnection] Ignoring ?server=:', err.message);
    }
  }

  const token = params.get('token');
  if (token) {
    params.delete('token');
    changed = true;
    setToken(token);
    applied.tokenSet = true;
  }

  if (changed) {
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
  return applied;
}
