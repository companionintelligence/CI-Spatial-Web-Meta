/**
 * The Quest app's packaging stays consistent: the web app manifest Bubblewrap reads,
 * the Bubblewrap project (quest/twa-manifest.json), the Worker settings that serve
 * /.well-known/assetlinks.json, and the launch marker the page looks for. A mismatch in
 * any of these builds an app that Horizon OS will not start, so it fails here instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import canon from '@companionintelligence/tokens/tokens.json';
import { QUEST_APP_SOURCE } from '../../src/app/questApp.js';
import { DEFAULT_QUEST_APP_PACKAGE } from '../../src/worker/rules.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const manifest = JSON.parse(read('../../public/manifest.webmanifest'));
const twa = JSON.parse(read('../../../quest/twa-manifest.json'));
const wrangler = read('../../wrangler.toml');
const syncBrand = read('../../scripts/sync-brand.mjs');
const SITE = 'https://meta.ci.computer';

describe('web app manifest', () => {
  it('describes the whole site as one standalone app', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Companion Scan Quest',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('is linked from the app page', () => {
    expect(read('../../index.html')).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it('uses the canon dark background, the scheme the headset surfaces use', () => {
    expect(manifest.background_color).toBe(canon.dark.background.hex);
    expect(manifest.theme_color).toBe(canon.dark.background.hex);
  });

  it('points only at icons scripts/sync-brand.mjs copies from the brand package', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(syncBrand).toContain(`'${icon.src.replace(/^\//, '')}']`);
    }
  });
});

describe('Bubblewrap project (quest/twa-manifest.json)', () => {
  it('is an immersive Meta Quest app for this site', () => {
    expect(twa).toMatchObject({
      host: 'meta.ci.computer',
      isMetaQuest: true,
      horizonOSAppMode: 'immersive',
      display: 'standalone',
      fullScopeUrl: `${SITE}/`,
      webManifestUrl: `${SITE}/manifest.webmanifest`,
    });
  });

  it('asks for the scene permission that plane and mesh detection need', () => {
    expect(twa.enableXRScene).toBe(true);
  });

  it('opens the page with the marker that starts AR in the app', () => {
    const start = new URL(twa.startUrl, SITE);
    expect(start.pathname).toBe('/');
    expect(start.searchParams.get('source')).toBe(QUEST_APP_SOURCE);
  });

  it('carries the names and icon of the web app manifest', () => {
    expect(twa.name).toBe(manifest.name);
    expect(twa.launcherName).toBe(manifest.short_name);
    expect(twa.iconUrl).toBe(`${SITE}/icon-512.png`);
    expect(twa.backgroundColor).toBe(manifest.background_color);
  });

  it('has a whole-number version code', () => {
    expect(Number.isInteger(twa.appVersionCode)).toBe(true);
    expect(twa.appVersionCode).toBeGreaterThan(0);
  });
});

describe('Digital Asset Links settings', () => {
  it('serve the package the app is built with', () => {
    expect(DEFAULT_QUEST_APP_PACKAGE).toBe(twa.packageId);
    expect(wrangler).toMatch(new RegExp(`^QUEST_APP_PACKAGE = "${twa.packageId.replace(/\./g, '\\.')}"$`, 'm'));
    expect(wrangler).toMatch(/^QUEST_APP_CERT_SHA256 = "[0-9A-Fa-f:, ]*"$/m);
  });

  it('let the Worker answer /.well-known/assetlinks.json before the static files', () => {
    expect(wrangler).toMatch(/^run_worker_first = \[.*"\/\.well-known\/assetlinks\.json".*\]$/m);
  });
});
