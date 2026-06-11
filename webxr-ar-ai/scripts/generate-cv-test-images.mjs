/**
 * generate-cv-test-images.mjs — renders synthetic camera frames of the test
 * homes plus ground-truth detection JSON, for computer-vision testing.
 *
 * Outputs to test-assets/cv/:
 *   <home>.png   1280×720 camera frame (eye height, looking into the room)
 *   <home>.json  ground truth: camera intrinsics/pose + per-furniture
 *                normalized bounding boxes [cx, cy, w, h]
 *
 * Consumers:
 *   - cv-server/eval_images.py — runs the real models against these frames
 *     and scores IoU vs. ground truth (needs the GPU box)
 *   - e2e tests — the mock CV server replays the ground truth so the full
 *     capture → raycast → pin path can be verified deterministically
 *
 * Usage: node scripts/generate-cv-test-images.mjs [count]
 */

import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TEST_HOMES } from '../src/fixtures/homes.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUT   = path.resolve(__dirname, '../test-assets/cv');
const BASE  = 'http://127.0.0.1:4174';
const COUNT = Number(process.argv[2] ?? 8);
const HFOV_DEG = 80;   // matches PipelineB's default camera model

mkdirSync(OUT, { recursive: true });

const RENDER_HOME = `
  async ({ home, hfovDeg }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');

    const W = 1280, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd8d2c8);

    // Pinhole camera identical to PipelineB's model
    const vfov = 2 * Math.atan(Math.tan((hfovDeg * Math.PI / 180) / 2) / (W / H));
    const camera = new THREE.PerspectiveCamera(vfov * 180 / Math.PI, W / H, 0.05, 50);
    const room = home.rooms[0];
    camera.position.set(room.x, 1.6, room.z + room.d / 2 - 0.3);
    camera.lookAt(room.x, 1.0, room.z - room.d / 2);
    camera.updateMatrixWorld(true);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    // Room shell
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x8a7a64 });
    const wallMat  = new THREE.MeshLambertMaterial({ color: 0xcfc8bb, side: THREE.BackSide });
    for (const r of home.rooms) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(r.x, 0, r.z);
      scene.add(floor);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), wallMat);
      shell.position.set(r.x, r.h / 2, r.z);
      scene.add(shell);
    }

    // Furniture: stable distinct colour per label
    const colorFor = (label) => {
      let h = 0;
      for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360;
      return new THREE.Color().setHSL(h / 360, 0.55, 0.45);
    };

    const detections = [];
    const v = new THREE.Vector3();
    for (const [label, w, h, d, x, z, yaw = 0] of home.furniture) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: colorFor(label) }),
      );
      mesh.position.set(x, h / 2, z);
      mesh.rotation.y = yaw;
      mesh.updateMatrixWorld(true);
      scene.add(mesh);

      // Project the 8 box corners → screen-space bbox
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let anyInFront = false;
      for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        v.set(sx * w, sy * h, sz * d).applyMatrix4(mesh.matrixWorld).project(camera);
        if (v.z < 1) anyInFront = true;
        const px = (v.x + 1) / 2, py = (1 - v.y) / 2;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      // Clamp to frame; skip boxes fully outside the view or mostly cut off
      // (edge-of-frame objects produce degenerate bbox centres — a real
      // detector yields garbage there too)
      const rawArea = (maxX - minX) * (maxY - minY);
      minX = Math.max(0, minX); minY = Math.max(0, minY);
      maxX = Math.min(1, maxX); maxY = Math.min(1, maxY);
      const clampedArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
      if (!anyInFront || clampedArea < 0.0001 || clampedArea / rawArea < 0.6) continue;

      detections.push({
        label: label.toLowerCase(),
        cx: +((minX + maxX) / 2).toFixed(4),
        cy: +((minY + maxY) / 2).toFixed(4),
        confidence: 1.0,
        bbox_cxcywh: [
          +((minX + maxX) / 2).toFixed(4), +((minY + maxY) / 2).toFixed(4),
          +(maxX - minX).toFixed(4), +(maxY - minY).toFixed(4),
        ],
        world_position: { x, y: h / 2, z },
      });
    }

    renderer.render(scene, camera);
    const png = canvas.toDataURL('image/png').split(',')[1];
    renderer.dispose();

    return {
      png,
      groundTruth: {
        home: home.name,
        image_size: [W, H],
        camera: {
          hfov_deg: hfovDeg,
          position: camera.position.toArray(),
          look_at: [room.x, 1.0, room.z - room.d / 2],
        },
        detections,
      },
    };
  }
`;

function startServer() {
  return spawn('npx', ['vite', '--config', 'vite.test.config.js'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
  });
}

async function waitForServer(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Dev server did not start');
}

const server = startServer();
try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + '/viewer.html');

  const homes = TEST_HOMES.slice(0, COUNT);
  const index = [];
  for (const home of homes) {
    const { png, groundTruth } = await page.evaluate(`(${RENDER_HOME})(${JSON.stringify({ home, hfovDeg: HFOV_DEG })})`);
    writeFileSync(`${OUT}/${home.name}.png`, Buffer.from(png, 'base64'));
    writeFileSync(`${OUT}/${home.name}.json`, JSON.stringify(groundTruth, null, 2));
    index.push({ home: home.name, detections: groundTruth.detections.length });
    console.log(`✓ ${home.name}.png (${groundTruth.detections.length} GT detections)`);
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
  await browser.close();
} finally {
  server.kill();
}
console.log(`CV test images written to ${OUT}`);
