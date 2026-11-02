/**
 * The published canon, read from the installed @companionintelligence/tokens
 * package, so e2e expectations follow the canon rather than hard-coded values.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const canon = JSON.parse(
  readFileSync(resolve(here, '../../../node_modules/@companionintelligence/tokens/src/tokens.json'), 'utf8'),
);

/** '#0a6358' → 'rgb(10, 99, 88)', the form getComputedStyle reports. */
export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
