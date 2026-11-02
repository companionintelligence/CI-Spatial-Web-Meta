/**
 * Unit tests for describeCvError — the short reason the HUD and the desktop
 * overlay show when a CV round trip fails.
 */
import { describe, it, expect } from 'vitest';
import { describeCvError } from '../../src/cv/CvServerClient.js';

describe('describeCvError', () => {
  it('reports a timeout for an aborted request', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(describeCvError(err)).toBe('CV server timed out');
  });

  it('reports an unreachable server for a network failure in each browser', () => {
    expect(describeCvError(new TypeError('Failed to fetch'))).toBe('CV server unreachable');
    expect(describeCvError(new TypeError('NetworkError when attempting to fetch resource.')))
      .toBe('CV server unreachable');
    expect(describeCvError(new TypeError('Load failed'))).toBe('CV server unreachable');
  });

  it('does not mistake a programming error for a network failure', () => {
    expect(describeCvError(new TypeError("Cannot read properties of undefined (reading 'map')")))
      .toBe('CV server error');
  });

  it('reports the HTTP status the server returned', () => {
    expect(describeCvError(new Error('CV server error 503: busy'))).toBe('CV server error 503');
    expect(describeCvError(new Error('CV server error 404: Not Found'))).toBe('CV server error 404');
  });

  it('falls back to a generic message for anything else', () => {
    expect(describeCvError(new Error('boom'))).toBe('CV server error');
    expect(describeCvError(undefined)).toBe('CV server error');
  });
});
