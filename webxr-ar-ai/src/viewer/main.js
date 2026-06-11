/**
 * Companion Scan Viewer — desktop inspection page for exported scan GLBs.
 *
 * Loads a companion-scan .glb (file picker or drag & drop), renders the
 * snapshotted room geometry, and overlays the spatial pins from the
 * `companion_scan` extras block. Pins are listed in the sidebar; clicking one
 * focuses the camera on it.
 *
 * Exposes `window.__companionViewer` (loadGlb / loadScan / getState) for
 * Playwright tests.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { extractCompanionScan, pinDisplayPosition, summarizeScan } from './scanParser.js';
import { buildScanReport } from '../export/ScanReport.js';
import { saveBlob } from '../export/GltfDownload.js';

const PIN_COLOR = { CvServer: 0x00ff50, MetaScene: 0x5599ff };
const KIND_COLOR = { plane: 0x5599ff, mesh: 0x777788 };

// ── Three.js scene ─────────────────────────────────────────────────────────

const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0e12);
scene.add(new THREE.GridHelper(10, 20, 0x334455, 0x1d2430));
scene.add(new THREE.AxesHelper(0.5));

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 200);
camera.position.set(3, 2.5, 4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ── Scan content ───────────────────────────────────────────────────────────

let contentGroup = null;   // loaded geometry + pin markers
let currentScan  = null;

function clearContent() {
  if (contentGroup) {
    scene.remove(contentGroup);
    contentGroup.traverse(o => {
      o.geometry?.dispose?.();
      if (o.material?.map) o.material.map.dispose();
      o.material?.dispose?.();
    });
  }
  contentGroup = new THREE.Group();
  scene.add(contentGroup);
}

/**
 * Load a scan from a GLB ArrayBuffer.
 * @param {ArrayBuffer} buffer
 */
async function loadGlb(buffer) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) =>
    loader.parse(buffer, '', resolve, reject),
  );

  clearContent();

  // Room geometry — snapshots are exported invisible; show them as wireframe
  gltf.scene.traverse(obj => {
    if (obj.isMesh) {
      obj.visible = true;
      const kind = obj.userData?.companionScan?.kind
        ?? (obj.name.startsWith('plane') ? 'plane' : 'mesh');
      obj.material = new THREE.MeshBasicMaterial({
        color: KIND_COLOR[kind] ?? 0x777788,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      });
    }
  });
  contentGroup.add(gltf.scene);

  loadScan(extractCompanionScan(gltf.scene) ?? { pins: [] }, { keepContent: true });
}

/**
 * Render scan metadata (pins + sidebar). Usable without a GLB (tests).
 * @param {object} scan companion_scan extras block
 * @param {{keepContent?: boolean}} [opts]
 */
function loadScan(scan, { keepContent = false } = {}) {
  if (!keepContent) clearContent();
  currentScan = scan;

  const pins = scan?.pins ?? [];
  for (const pin of pins) {
    contentGroup.add(_buildPinMarker(pin));
  }

  if (scan?.floorplan?.bounds) {
    const { min, max } = scan.floorplan.bounds;
    const box = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, max.y, max.z),
    );
    contentGroup.add(new THREE.Box3Helper(box, 0xf1c40f));
  }

  _renderSidebar(scan);
  _frameContent();
  document.getElementById('report-btn').style.display = '';
}

function _buildPinMarker(pin) {
  const group = new THREE.Group();
  const p = pinDisplayPosition(pin);
  group.position.set(p.x, p.y, p.z);

  const color = PIN_COLOR[pin.source] ?? 0xffffff;
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  group.add(sphere);
  group.add(_textSprite(pin.label ?? '?', color));
  group.userData.pin = pin;
  return group;
}

function _textSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath(); ctx.roundRect(0, 0, 256, 64, 12); ctx.fill();
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.font = 'bold 30px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(0.32, 0.08, 1);
  sprite.position.y = 0.07;
  return sprite;
}

function _frameContent() {
  const box = new THREE.Box3().setFromObject(contentGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3()).length() || 4;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.6, size * 0.45, size * 0.6));
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function _renderSidebar(scan) {
  const stats = document.getElementById('scan-stats');
  const list  = document.getElementById('pin-list');
  const s = summarizeScan(scan);

  stats.innerHTML = `
    <tr><td>Pins</td><td>${s.pinCount} (${s.cvCount} cv · ${s.sceneCount} scene)</td></tr>
    <tr><td>Bounds</td><td>${s.boundsSize ?? '—'}</td></tr>
    <tr><td>Exported</td><td>${s.exportedAt ? new Date(s.exportedAt).toLocaleString() : '—'}</td></tr>
    <tr><td>Anchor</td><td style="word-break: break-all;">${s.anchorUuid ?? '—'}</td></tr>
  `;

  list.innerHTML = '';
  for (const pin of scan?.pins ?? []) {
    const li = document.createElement('li');
    const conf = pin.source === 'CvServer'
      ? ` ${Math.round((pin.confidence ?? 0) * 100)}%`
      : '';
    li.innerHTML = `
      <span class="src-${pin.source}">${pin.label ?? '?'}${conf}</span>
      <span class="meta">${pin.hit_type ?? ''}</span>
    `;
    if (pin.florence_caption) li.title = pin.florence_caption;
    li.addEventListener('click', () => _focusPin(pin));
    list.appendChild(li);
  }

  document.getElementById('dropzone').classList.toggle('hidden', true);
}

function _focusPin(pin) {
  const p = pinDisplayPosition(pin);
  const target = new THREE.Vector3(p.x, p.y, p.z);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(0.8, 0.5, 0.8));
}

// ── File handling ──────────────────────────────────────────────────────────

async function loadFile(file) {
  try {
    await loadGlb(await file.arrayBuffer());
  } catch (err) {
    console.error('[Viewer] Failed to load GLB:', err);
    document.getElementById('empty-note')?.remove();
    document.getElementById('scan-stats').innerHTML =
      `<tr><td colspan="2" style="color:#ff6655">Failed to load: ${err?.message ?? err}</td></tr>`;
  }
}

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadFile(file);
});

document.getElementById('report-btn').addEventListener('click', () => {
  if (!currentScan) return;
  const md = buildScanReport(currentScan);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  saveBlob(new Blob([md], { type: 'text/markdown' }), `companion-scan-report-${ts}.md`);
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

// ── Server scans (CV server glTF store, via the dev-server /v1 proxy) ──────

async function refreshServerScans() {
  const list = document.getElementById('server-scans');
  try {
    const res = await fetch('/v1/gltf');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { files = [] } = await res.json();

    list.innerHTML = '';
    if (!files.length) {
      list.innerHTML = '<li class="note">No scans on server yet</li>';
      return;
    }
    for (const f of files) {
      const li = document.createElement('li');
      const kb = Math.max(1, Math.round(f.bytes / 1024));
      const when = f.modified ? new Date(f.modified).toLocaleString() : '';
      li.innerHTML = `<span>${f.name}</span><span class="meta">${kb} KB · ${when}</span>`;
      li.title = f.name;
      li.addEventListener('click', () => loadServerScan(f.name));
      list.appendChild(li);
    }
  } catch {
    list.innerHTML = '<li class="note">CV server unreachable</li>';
  }
}

async function loadServerScan(name) {
  try {
    const res = await fetch(`/v1/gltf/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadGlb(await res.arrayBuffer());
  } catch (err) {
    console.error('[Viewer] Failed to load server scan:', err);
    document.getElementById('scan-stats').innerHTML =
      `<tr><td colspan="2" style="color:#ff6655">Failed to load ${name}: ${err?.message ?? err}</td></tr>`;
  }
}

document.getElementById('scan-refresh').addEventListener('click', refreshServerScans);
refreshServerScans();

// ── Test hook ──────────────────────────────────────────────────────────────

window.__companionViewer = {
  loadGlb,
  loadScan,
  refreshServerScans,
  getState: () => ({
    pinCount: currentScan?.pins?.length ?? 0,
    hasContent: !!contentGroup && contentGroup.children.length > 0,
  }),
};
