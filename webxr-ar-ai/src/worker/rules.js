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

/** The Quest app's Android package (quest/twa-manifest.json, `packageId`). */
export const DEFAULT_QUEST_APP_PACKAGE = 'computer.ci.meta.twa';

const ANDROID_PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/**
 * SHA-256 certificate fingerprints in the form Digital Asset Links uses: 32 upper-case
 * hex bytes joined by colons. Accepts that form (any case) or 64 bare hex digits, so a
 * value can come from keytool, apksigner or `wrangler deploy --var`. Several are
 * separated by commas or white space.
 * @param {string} raw
 * @returns {string[] | null} the fingerprints, [] when none is set, or null when any
 *   entry is malformed (so a typo serves nothing rather than a key that matches no app)
 */
export function parseCertFingerprints(raw) {
  const entries = String(raw ?? '').split(/[\s,]+/).filter(Boolean);
  const out = [];
  for (const entry of entries) {
    const hex = entry.replace(/:/g, '');
    const colonsOk = !entry.includes(':') || /^([0-9a-f]{2}:){31}[0-9a-f]{2}$/i.test(entry);
    if (!colonsOk || !/^[0-9a-f]{64}$/i.test(hex)) return null;
    out.push(hex.toUpperCase().match(/../g).join(':'));
  }
  return [...new Set(out)];
}

/**
 * The Digital Asset Links statements for /.well-known/assetlinks.json: this site lets
 * the Quest app (its package, signed by these certificates) open it as a trusted web
 * activity. Horizon OS checks the file before an immersive app may launch.
 *
 * Read from the Worker's settings: `QUEST_APP_PACKAGE` (defaults to the package in
 * quest/twa-manifest.json) and `QUEST_APP_CERT_SHA256`, the SHA-256 fingerprint of the
 * certificate the release keystore signs with. Null until a fingerprint is set, or when
 * either value is malformed.
 * @returns {object[] | null}
 */
export function assetLinks(env = {}) {
  const fingerprints = parseCertFingerprints(env.QUEST_APP_CERT_SHA256);
  const packageName = env.QUEST_APP_PACKAGE || DEFAULT_QUEST_APP_PACKAGE;
  if (!fingerprints?.length || !ANDROID_PACKAGE.test(packageName)) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
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
