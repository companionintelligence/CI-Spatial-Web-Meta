/**
 * The rules the Worker applies: where a sign-in may return to, which memory addresses
 * it may call, and the settings it runs with. They live apart from index.js because
 * the Workers runtime treats every named export of a Worker's entry module as an
 * entrypoint, and rejects anything that is not a handler or a class.
 */

/** The production CI Portal (its OIDC issuer). */
export const DEFAULT_PORTAL_URL = 'https://hub.ci.computer';
/** This app's public client, registered with the Portal (see docs/integration/ci-platform.md). */
export const DEFAULT_CLIENT_ID = 'ci-meta';

/** @returns {{ portalUrl: string, clientId: string }} */
export function settings(env = {}) {
  return {
    portalUrl: (env.CI_PORTAL_URL || DEFAULT_PORTAL_URL).replace(/\/+$/, ''),
    clientId: env.CI_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID,
  };
}

/**
 * Where the Portal may send the user back to: this site's root, or the root of a
 * loopback origin for local development. Nothing else is accepted, so this route
 * cannot be used to exchange codes for another application. In local development
 * Vite serves the page over https on a loopback address while the Worker sees its
 * own origin, so the loopback rule covers both schemes.
 * @param {string} redirectUri
 * @param {string} siteOrigin the origin the request arrived on
 */
export function isAllowedRedirect(redirectUri, siteOrigin) {
  let target;
  try {
    target = new URL(redirectUri);
  } catch {
    return false;
  }
  if (target.search || target.hash || target.pathname !== '/') return false;
  if (target.origin === siteOrigin) return true;
  return ['http:', 'https:'].includes(target.protocol) && ['127.0.0.1', 'localhost'].includes(target.hostname);
}

/**
 * A memory server's base address, if it is safe to call: https, or loopback http
 * for local development, with no credentials, query or fragment.
 * @returns {string | null}
 */
export function memoryBase(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  const loopback = target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname);
  if (target.protocol !== 'https:' && !loopback) return null;
  if (target.username || target.password || target.search || target.hash) return null;
  return `${target.origin}${target.pathname.replace(/\/+$/, '')}`;
}
