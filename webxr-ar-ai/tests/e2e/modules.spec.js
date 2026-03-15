/**
 * E2E tests — module-level via /harness.html
 *
 * These tests load the lightweight harness page which exposes the pure-logic
 * modules (AppState, SpatialPin, SpatialPinManager, CvServerClient) on
 * window.CS without requiring IWSDK or WebXR.
 *
 * This layer runs in any Chromium browser, including headless CI.
 */
import { test, expect } from '@playwright/test';

const HARNESS = '/harness.html';

async function waitForHarness(page) {
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 5000 });
}

// ── AppState ──────────────────────────────────────────────────────────────

test.describe('AppState (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await waitForHarness(page);
  });

  test('initial model preset is Florence', async ({ page }) => {
    const preset = await page.evaluate(() => window.CS.appState.modelPreset);
    expect(preset).toBe('Florence');
  });

  test('cycleModel advances through Florence → GDino → SAM2 → Florence', async ({ page }) => {
    const steps = await page.evaluate(() => {
      const { appState } = window.CS;
      return [
        appState.cycleModel(), // Florence → GDino
        appState.cycleModel(), // GDino → SAM2
        appState.cycleModel(), // SAM2 → Florence
      ];
    });
    expect(steps).toEqual(['GDino', 'SAM2', 'Florence']);
  });

  test('cycleDisplayMode advances through all modes', async ({ page }) => {
    const modes = await page.evaluate(() => {
      const { appState } = window.CS;
      // Start at Both, cycle 3 times to return
      return [
        appState.cycleDisplayMode(), // Both → BoundingBox2D
        appState.cycleDisplayMode(), // BoundingBox2D → SpatialLabel3D
        appState.cycleDisplayMode(), // SpatialLabel3D → Both
      ];
    });
    expect(modes).toEqual(['BoundingBox2D', 'SpatialLabel3D', 'Both']);
  });

  test('cyclePreviewDistance advances Near → Far → Off', async ({ page }) => {
    const distances = await page.evaluate(() => {
      const { appState } = window.CS;
      return [
        appState.cyclePreviewDistance(), // Near → Far  (3)
        appState.cyclePreviewDistance(), // Far → Off   (0)
        appState.cyclePreviewDistance(), // Off → Near  (1)
      ];
    });
    expect(distances).toEqual([3, 0, 1]);
  });

  test('setBusy toggles isBusy flag', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { appState } = window.CS;
      appState.setBusy(true);
      const busy = appState.isBusy;
      appState.setBusy(false);
      return { busy, notBusy: appState.isBusy };
    });
    expect(result.busy).toBe(true);
    expect(result.notBusy).toBe(false);
  });

  test('subscriber is notified with the changed field name', async ({ page }) => {
    const fields = await page.evaluate(() => {
      const { appState } = window.CS;
      const seen = [];
      appState.subscribe((f) => seen.push(f));
      appState.cycleModel();
      appState.cycleDisplayMode();
      appState.setBusy(true);
      return seen;
    });
    expect(fields).toContain('modelPreset');
    expect(fields).toContain('displayMode');
    expect(fields).toContain('isBusy');
  });

  test('previewDistanceLabel returns correct string for each value', async ({ page }) => {
    const labels = await page.evaluate(() => {
      const { appState } = window.CS;
      const results = {};
      results.near = appState.previewDistanceLabel(); // Near
      appState.cyclePreviewDistance();
      results.far  = appState.previewDistanceLabel(); // Far
      appState.cyclePreviewDistance();
      results.off  = appState.previewDistanceLabel(); // Off
      return results;
    });
    expect(labels.near).toBe('Near (1m)');
    expect(labels.far).toBe('Far (3m)');
    expect(labels.off).toBe('Off');
  });
});

// ── SpatialPin ────────────────────────────────────────────────────────────

test.describe('SpatialPin (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await waitForHarness(page);
  });

  test('creates a pin with unique id', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const { SpatialPin } = window.CS;
      return [new SpatialPin().id, new SpatialPin().id, new SpatialPin().id];
    });
    expect(new Set(ids).size).toBe(3);
  });

  test('id starts with "pin-"', async ({ page }) => {
    const id = await page.evaluate(() => new window.CS.SpatialPin().id);
    expect(id).toMatch(/^pin-\d+-\d+$/);
  });

  test('default source is CvServer', async ({ page }) => {
    const source = await page.evaluate(() => new window.CS.SpatialPin().source);
    expect(source).toBe('CvServer');
  });

  test('PinSource enum is correct', async ({ page }) => {
    const ps = await page.evaluate(() => window.CS.PinSource);
    expect(ps.CvServer).toBe('CvServer');
    expect(ps.MetaScene).toBe('MetaScene');
  });
});

// ── SpatialPinManager ─────────────────────────────────────────────────────

test.describe('SpatialPinManager (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await waitForHarness(page);
    // Create a fresh pinManager for each test
    await page.evaluate(() => {
      const { SpatialPinManager } = window.CS;
      window._mgr = new SpatialPinManager({ mergeByTrackId: true });
    });
  });

  test('starts empty', async ({ page }) => {
    const count = await page.evaluate(() => window._mgr.pins.length);
    expect(count).toBe(0);
  });

  test('addOrUpdate adds a new pin and fires "add" event', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { SpatialPin, PinSource } = window.CS;
      const events = [];
      window._mgr.addEventListener('add', (e) => events.push(e.pin.label));

      const p = new SpatialPin();
      p.label = 'couch';
      window._mgr.addOrUpdate(p);
      return { count: window._mgr.pins.length, events };
    });
    expect(result.count).toBe(1);
    expect(result.events).toContain('couch');
  });

  test('merges pin by trackId + source and fires "update"', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { SpatialPin, PinSource } = window.CS;
      const addEvents = [], updateEvents = [];
      window._mgr.addEventListener('add',    () => addEvents.push(true));
      window._mgr.addEventListener('update', () => updateEvents.push(true));

      const p1 = new SpatialPin();
      p1.label = 'chair'; p1.trackId = 'track-1'; p1.source = PinSource.CvServer;
      p1.worldPosition = { x: 1, y: 0, z: 0 };
      window._mgr.addOrUpdate(p1);

      const p2 = new SpatialPin();
      p2.label = 'chair'; p2.trackId = 'track-1'; p2.source = PinSource.CvServer;
      p2.worldPosition = { x: 5, y: 0, z: 0 };
      window._mgr.addOrUpdate(p2);

      return {
        count:         window._mgr.pins.length,
        position:      window._mgr.pins[0].worldPosition.x,
        addEventCount: addEvents.length,
        updEventCount: updateEvents.length,
      };
    });
    expect(result.count).toBe(1);
    expect(result.position).toBe(5);
    expect(result.addEventCount).toBe(1);  // only the first add
    expect(result.updEventCount).toBe(1);  // then update
  });

  test('remove deletes pin and fires "remove" event', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { SpatialPin } = window.CS;
      const p = new SpatialPin();
      p.label = 'table';
      window._mgr.addOrUpdate(p);

      const removed = [];
      window._mgr.addEventListener('remove', (e) => removed.push(e.pinId));
      window._mgr.remove(p.id);

      return { count: window._mgr.pins.length, removedId: removed[0], pid: p.id };
    });
    expect(result.count).toBe(0);
    expect(result.removedId).toBe(result.pid);
  });

  test('clearAll empties store and fires "clear"', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { SpatialPin } = window.CS;
      window._mgr.addOrUpdate(new SpatialPin());
      window._mgr.addOrUpdate(new SpatialPin());

      let cleared = false;
      window._mgr.addEventListener('clear', () => { cleared = true; });
      window._mgr.clearAll();
      return { count: window._mgr.pins.length, cleared };
    });
    expect(result.count).toBe(0);
    expect(result.cleared).toBe(true);
  });

  test('bySource returns only matching pins', async ({ page }) => {
    const counts = await page.evaluate(() => {
      const { SpatialPin, PinSource } = window.CS;

      const cv1 = new SpatialPin(); cv1.source = PinSource.CvServer;
      const cv2 = new SpatialPin(); cv2.source = PinSource.CvServer;
      const ms1 = new SpatialPin(); ms1.source = PinSource.MetaScene;
      window._mgr.addOrUpdate(cv1);
      window._mgr.addOrUpdate(cv2);
      window._mgr.addOrUpdate(ms1);

      return {
        cv: window._mgr.bySource(PinSource.CvServer).length,
        ms: window._mgr.bySource(PinSource.MetaScene).length,
      };
    });
    expect(counts.cv).toBe(2);
    expect(counts.ms).toBe(1);
  });

  test('pruneStale removes old pins', async ({ page }) => {
    const count = await page.evaluate(() => {
      const { SpatialPin, SpatialPinManager } = window.CS;
      const mgr = new SpatialPinManager({ stalePinAgeMs: 50 });

      const oldPin = new SpatialPin();
      oldPin.createdAt = Date.now() - 500;
      const freshPin = new SpatialPin();

      mgr.addOrUpdate(oldPin);
      mgr.addOrUpdate(freshPin);
      mgr.pruneStale();
      return mgr.pins.length;
    });
    expect(count).toBe(1);
  });
});

// ── CvServerClient ────────────────────────────────────────────────────────

test.describe('CvServerClient (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await waitForHarness(page);
  });

  test('constructor strips trailing slash from baseUrl', async ({ page }) => {
    const url = await page.evaluate(() => {
      const { CvServerClient } = window.CS;
      return new CvServerClient({ baseUrl: 'http://myserver/' }).baseUrl;
    });
    expect(url).toBe('http://myserver');
  });

  test('health() returns false on network error (fetch rejects)', async ({ page }) => {
    // Intercept fetch to simulate server down
    await page.route('/v1/health', (route) => route.abort());

    const result = await page.evaluate(async () => {
      const { CvServerClient } = window.CS;
      const c = new CvServerClient({ timeoutMs: 2000 });
      try {
        return await c.health();
      } catch {
        return false;
      }
    });
    expect(result).toBe(false);
  });

  test('detect() sends correct JSON to /v1/detect', async ({ page }) => {
    let capturedBody;
    await page.route('/v1/detect', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ detections: [] }),
      });
    });

    await page.evaluate(async () => {
      const { CvServerClient } = window.CS;
      const c = new CvServerClient({ timeoutMs: 5000 });
      await c.detect('base64img', { prompt: 'cat . dog', boxThreshold: 0.5, textThreshold: 0.3 });
    });

    expect(capturedBody.image).toBe('base64img');
    expect(capturedBody.prompt).toBe('cat . dog');
    expect(capturedBody.box_threshold).toBe(0.5);
    expect(capturedBody.text_threshold).toBe(0.3);
  });

  test('segment() sends image and boxes to /v1/segment', async ({ page }) => {
    let capturedBody;
    await page.route('/v1/segment', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ segments: [] }),
      });
    });

    await page.evaluate(async () => {
      const { CvServerClient } = window.CS;
      const c = new CvServerClient({ timeoutMs: 5000 });
      await c.segment('img64', [[0.5, 0.5, 0.2, 0.3]]);
    });

    expect(capturedBody.image).toBe('img64');
    expect(capturedBody.boxes).toEqual([[0.5, 0.5, 0.2, 0.3]]);
  });

  test('florence() sends image and task to /v1/florence', async ({ page }) => {
    let capturedBody;
    await page.route('/v1/florence', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task: '<OD>', result: {} }),
      });
    });

    await page.evaluate(async () => {
      const { CvServerClient } = window.CS;
      const c = new CvServerClient({ timeoutMs: 5000 });
      await c.florence('myimage64', '<OD>');
    });

    expect(capturedBody.image).toBe('myimage64');
    expect(capturedBody.task).toBe('<OD>');
  });

  test('uploadGltf() sends multipart form to /v1/gltf', async ({ page }) => {
    let capturedContentType;
    await page.route('/v1/gltf', async (route) => {
      capturedContentType = route.request().headers()['content-type'] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'saved', path: '/out.glb', bytes: 64 }),
      });
    });

    const result = await page.evaluate(async () => {
      const { CvServerClient } = window.CS;
      const c = new CvServerClient({ timeoutMs: 5000 });
      const blob = new Blob([new Uint8Array(64)], { type: 'model/gltf-binary' });
      return await c.uploadGltf(blob, 'test.glb');
    });

    expect(result.status).toBe('saved');
    expect(capturedContentType).toContain('multipart/form-data');
  });

  test('detect() throws on 500 response', async ({ page }) => {
    await page.route('/v1/detect', (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' })
    );

    const threw = await page.evaluate(async () => {
      const { CvServerClient } = window.CS;
      const c = new CvServerClient({ timeoutMs: 5000 });
      try {
        await c.detect('img');
        return false;
      } catch (e) {
        return e.message.includes('500');
      }
    });

    expect(threw).toBe(true);
  });
});
