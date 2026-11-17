/**
 * The local-only rule for scan data: a scan may go only to this network.
 */
import { describe, it, expect } from 'vitest';
import {
  NonLocalDestinationError,
  assertLocalUrl,
  isLocalHostname,
  isLocalUrl,
} from '../../src/net/localOnly.js';

describe('isLocalHostname — what counts as this network', () => {
  it.each([
    'localhost', 'cafe.localhost', 'ci-desktop.local',
    '127.0.0.1', '127.8.9.10', '10.0.0.5', '10.255.255.255',
    '172.16.0.5', '172.31.255.1', '192.168.1.20', '169.254.10.1',
    '::1', 'fe80::1', 'fd12:3456::1', 'fc00::9', '::ffff:192.168.1.5',
  ])('treats %s as local', (host) => {
    expect(isLocalHostname(host)).toBe(true);
  });

  it.each([
    'example.com', 'meta.ci.computer', 'hub.ci.computer', '8.8.8.8',
    '172.32.0.1', '172.15.0.1', '192.169.0.1', '11.0.0.1', '256.1.1.1',
    '2001:db8::1', '::ffff:8.8.8.8', '', undefined, null,
  ])('treats %s as not local', (host) => {
    expect(isLocalHostname(host)).toBe(false);
  });

  it('accepts a bracketed IPv6 host as URL.hostname reports it', () => {
    expect(isLocalHostname('[fd00::1]')).toBe(true);
    expect(isLocalHostname('[2001:db8::1]')).toBe(false);
  });
});

describe('assertLocalUrl — refuses before anything is sent', () => {
  it('returns the absolute URL for a LAN server', () => {
    expect(assertLocalUrl('http://192.168.1.20:8000/v1/scans'))
      .toBe('http://192.168.1.20:8000/v1/scans');
  });

  it('resolves a same-origin path against a local page', () => {
    expect(assertLocalUrl('/v1/scans', 'https://192.168.1.20:8081/room.html'))
      .toBe('https://192.168.1.20:8081/v1/scans');
  });

  it('refuses a public host and names it', () => {
    let caught;
    try {
      assertLocalUrl('https://meta.ci.computer/v1/scans');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NonLocalDestinationError);
    expect(caught.host).toBe('meta.ci.computer');
    expect(caught.message).toMatch(/not on this network/);
  });

  it('refuses a same-origin path when the page itself is public', () => {
    expect(() => assertLocalUrl('/v1/scans', 'https://meta.ci.computer/'))
      .toThrow(NonLocalDestinationError);
  });

  it('refuses a relative path with no page address to resolve it against', () => {
    expect(() => assertLocalUrl('/v1/scans')).toThrow(NonLocalDestinationError);
  });

  it('refuses a non-HTTP scheme even on a local host', () => {
    expect(() => assertLocalUrl('ws://192.168.1.20:8000/v1/scans')).toThrow(NonLocalDestinationError);
    expect(() => assertLocalUrl('file:///home/liam/scan.json')).toThrow(NonLocalDestinationError);
  });
});

describe('isLocalUrl', () => {
  it('answers for absolute and relative URLs', () => {
    expect(isLocalUrl('http://10.0.0.2:8000/')).toBe(true);
    expect(isLocalUrl('https://example.com/')).toBe(false);
    expect(isLocalUrl('/v1/scans', 'https://192.168.1.2:8081/')).toBe(true);
    expect(isLocalUrl('not a url')).toBe(false);
  });
});
