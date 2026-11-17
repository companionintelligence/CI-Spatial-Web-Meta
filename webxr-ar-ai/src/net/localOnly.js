/**
 * Local-only guard for scan data.
 *
 * A scan (camera frames, room planes, headset poses) may go only to a server on
 * this network: loopback, a private (RFC 1918 or unique-local) address, a
 * link-local address, or a `.local` / `.localhost` name. Anything else is refused
 * before a request is made, so a mistyped or public URL cannot receive scan data.
 *
 * Pure functions, so the rule can be tested in Node.
 */

/** Thrown instead of sending scan data to a host that is not on this network. */
export class NonLocalDestinationError extends Error {
  /** @param {string} host */
  constructor(host) {
    super(`${host} is not on this network. Scan data stays on the local server.`);
    this.name = 'NonLocalDestinationError';
    this.host = host;
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Whether a hostname (as URL.hostname gives it) is on this network.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLocalHostname(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const v4 = IPV4.exec(host);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return false;
    const [a, b] = octets;
    return a === 127                              // loopback
      || a === 10                                 // 10.0.0.0/8
      || (a === 172 && b >= 16 && b <= 31)        // 172.16.0.0/12
      || (a === 192 && b === 168)                 // 192.168.0.0/16
      || (a === 169 && b === 254);                // link-local
  }

  if (host.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);   // IPv4-mapped
    if (mapped) return isLocalHostname(mapped[1]);
    if (host === '::1') return true;                              // loopback
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;            // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;           // fc00::/7 unique-local
    return false;
  }
  return false;
}

/**
 * Parse a URL against an optional base. Returns null when it is not an http(s) URL.
 * @param {string} url
 * @param {string} [base]
 * @returns {URL|null}
 */
function parseHttpUrl(url, base) {
  let parsed;
  try {
    parsed = base === undefined ? new URL(url) : new URL(url, base);
  } catch {
    return null;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
}

/**
 * Whether a URL (absolute, or relative to `base`) points at a local host.
 * @param {string} url
 * @param {string} [base]
 * @returns {boolean}
 */
export function isLocalUrl(url, base) {
  const parsed = parseHttpUrl(url, base);
  return Boolean(parsed) && isLocalHostname(parsed.hostname);
}

/**
 * Throw unless the URL is a local http(s) URL. Call this before every scan request.
 * @param {string} url
 * @param {string} [base]  the page address, for same-origin (relative) URLs
 * @returns {string} the absolute URL, ready to fetch
 * @throws {NonLocalDestinationError}
 */
export function assertLocalUrl(url, base) {
  const parsed = parseHttpUrl(String(url ?? ''), base);
  if (!parsed) throw new NonLocalDestinationError(String(url ?? ''));
  if (!isLocalHostname(parsed.hostname)) throw new NonLocalDestinationError(parsed.host);
  return parsed.href;
}
