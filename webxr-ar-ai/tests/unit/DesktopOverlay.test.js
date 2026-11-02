/**
 * Unit tests for the overlay's health-check schedule. The DOM behaviour of the
 * overlay is covered by the e2e overlay specs; this checks the back-off rule.
 */
import { describe, it, expect } from 'vitest';
import { healthDelayMs } from '../../src/ui/DesktopOverlay.js';

describe('healthDelayMs', () => {
  it('checks every 8 seconds while the CV server answers', () => {
    expect(healthDelayMs(0)).toBe(8_000);
  });

  it('backs off while the server stays offline, doubling each time', () => {
    expect(healthDelayMs(1)).toBe(16_000);
    expect(healthDelayMs(2)).toBe(32_000);
  });

  it('never waits longer than a minute between checks', () => {
    expect(healthDelayMs(3)).toBe(60_000);
    expect(healthDelayMs(50)).toBe(60_000);
  });

  it('treats a negative failure count as online', () => {
    expect(healthDelayMs(-1)).toBe(8_000);
  });
});
