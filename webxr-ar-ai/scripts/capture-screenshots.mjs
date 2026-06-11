/**
 * capture-screenshots.mjs — generates the documentation screenshots in
 * docs/images/ by driving the real app and viewer in headless Chromium
 * (with IWER emulating a Quest 3 WebXR runtime).
 *
 * Usage:  node scripts/capture-screenshots.mjs
 * Requires: npx playwright install chromium (and the dev deps installed).
 */

import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUT       = path.resolve(__dirname, '../../docs/images');
const BASE      = 'http://127.0.0.1:4174';
const IWER      = path.resolve(__dirname, '../node_modules/iwer/build/iwer.min.js');

mkdirSync(OUT, { recursive: true });

// A representative living-room scan used across the screenshots.
const SAMPLE_SCAN = {
  version: '1.1',
  session_id: 'demo-session',
  exported_at: new Date().toISOString(),
  anchor_uuid: '3f9a1c2e-demo-anchor',
  pins: [
    { id: 'p1', source: 'MetaScene', label: 'floor',  hit_type: 'plane',
      position_anchor_local: { x: 0, y: 0, z: 0 } },
    { id: 'p2', source: 'MetaScene', label: 'wall',   hit_type: 'plane',
      position_anchor_local: { x: 0, y: 1.4, z: -2 } },
    { id: 'p3', source: 'MetaScene', label: 'table',  hit_type: 'mesh',
      position_anchor_local: { x: 0.9, y: 0.75, z: -1.2 } },
    { id: 'p4', source: 'CvServer',  label: 'sofa',   confidence: 0.92, hit_type: 'mesh',
      position_anchor_local: { x: -1.2, y: 0.45, z: -1.4 },
      florence_caption: 'a cozy living room with a grey sofa and a wooden coffee table' },
    { id: 'p5', source: 'CvServer',  label: 'coffee table', confidence: 0.88, hit_type: 'mesh',
      position_anchor_local: { x: 0.9, y: 0.78, z: -1.2 } },
    { id: 'p6', source: 'CvServer',  label: 'plant',  confidence: 0.74, hit_type: 'mesh',
      position_anchor_local: { x: 1.7, y: 0.6, z: -2.1 } },
    { id: 'p7', source: 'CvServer',  label: 'tv',     confidence: 0.81, hit_type: 'plane',
      position_anchor_local: { x: 0, y: 1.3, z: -2.4 } },
  ],
  floorplan: {
    bounds: { min: { x: -2.2, y: 0, z: -2.6 }, max: { x: 2.2, y: 2.4, z: 1.8 } },
    cv_pin_count: 4, scene_pin_count: 3,
  },
};

/** Build a wireframe room GLB inside the page (floor, walls, furniture). */
const BUILD_ROOM_GLB = `
  async (scan) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');

    const root = new THREE.Group();
    root.name = 'companion-scan-geometry';
    const mat = new THREE.MeshBasicMaterial();
    const add = (name, geo, pos, rot = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(...pos);
      m.rotation.set(...rot);
      m.visible = false;
      root.add(m);
    };

    add('plane-floor',   new THREE.BoxGeometry(4.4, 0.001, 4.4), [0, 0, -0.4]);
    add('plane-wall',    new THREE.BoxGeometry(4.4, 0.001, 2.4), [0, 1.2, -2.6], [Math.PI / 2, 0, 0]);
    add('plane-wall_2',  new THREE.BoxGeometry(4.4, 0.001, 2.4), [-2.2, 1.2, -0.4], [Math.PI / 2, 0, Math.PI / 2]);
    add('mesh-couch',    new THREE.BoxGeometry(1.8, 0.9, 0.85),  [-1.2, 0.45, -1.4]);
    add('mesh-table',    new THREE.BoxGeometry(1.2, 0.78, 0.6),  [0.9, 0.39, -1.2]);
    add('mesh-plant',    new THREE.BoxGeometry(0.4, 1.2, 0.4),   [1.7, 0.6, -2.1]);
    add('mesh-screen',   new THREE.BoxGeometry(1.4, 0.8, 0.06),  [0, 1.3, -2.45]);
    root.userData.companion_scan = scan;

    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(root, resolve, reject, { binary: true, onlyVisible: false });
    });
  }
`;

function startServer() {
  const proc = spawn('npx', ['vite', '--config', 'vite.test.config.js'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
    detached: false,
  });
  return proc;
}

async function waitForServer(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Dev server did not start');
}

const server = startServer();
try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // ── 1. Desktop overlay on the app page (IWER → XR supported) ────────────
  await page.addInitScript({ path: IWER });
  await page.addInitScript(`
    (() => {
      const { XRDevice, metaQuest3 } = window.IWER ?? {};
      if (!XRDevice) return;
      const device = new XRDevice(metaQuest3);
      device.stereoEnabled = false;
      device.installRuntime();
      window.__xrDevice = device;
    })();
  `);
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__companionScan);
  await page.waitForSelector('#co-xr-status .co-badge.ok');
  // Give the health check a moment to settle on Offline
  await page.waitForSelector('#co-cv-status .co-badge', { state: 'visible' });
  await page.waitForTimeout(1500);

  // Populate pin counts + status line so the overlay shows a live scan
  await page.evaluate((scan) => {
    const { pinManager, appState, SpatialPin } = window.__companionScan;
    for (const p of scan.pins) {
      const pin = new SpatialPin();
      pin.source = p.source;
      pin.label = p.label;
      pin.confidence = p.confidence ?? 0;
      pin.trackId = p.id;
      pin.hitType = p.hit_type;
      pin.worldPosition = p.position_anchor_local;
      pinManager.addOrUpdate(pin);
    }
    appState.setStatus('4 detections · 3 scene pins', 'ok');
  }, SAMPLE_SCAN);
  await page.locator('#co-overlay').screenshot({ path: `${OUT}/desktop-overlay.png` });
  console.log('✓ desktop-overlay.png');

  // ── 2. Viewer: empty state ───────────────────────────────────────────────
  const viewer = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await viewer.goto(`${BASE}/viewer.html`);
  await viewer.waitForFunction(() => !!window.__companionViewer);
  await viewer.waitForSelector('#server-scans li');
  await viewer.screenshot({ path: `${OUT}/viewer-empty.png` });
  console.log('✓ viewer-empty.png');

  // ── 3. Viewer: loaded living-room scan (real GLB round trip) ────────────
  await viewer.evaluate(`
    (async () => {
      const glb = await (${BUILD_ROOM_GLB})(${JSON.stringify(SAMPLE_SCAN)});
      await window.__companionViewer.loadGlb(glb);
    })()
  `);
  await viewer.waitForSelector('#pin-list li');
  await viewer.waitForTimeout(800);   // settle camera framing + first render
  await viewer.screenshot({ path: `${OUT}/viewer-scan.png` });
  console.log('✓ viewer-scan.png');

  await browser.close();
} finally {
  server.kill();
}
console.log(`Screenshots written to ${OUT}`);
