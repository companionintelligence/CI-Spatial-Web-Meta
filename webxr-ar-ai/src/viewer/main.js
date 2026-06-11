/**
 * Companion Scan Quest — desktop viewer & editor for exported scan GLBs.
 *
 * Viewer: loads a companion-scan .glb (file picker, drag & drop, or the CV
 * server's scan store), renders the room geometry, and overlays the spatial
 * pins from the `companion_scan` extras block.
 *
 * Editor (absorbed from PR #3): select a pin to edit its label, confidence,
 * position, and caption, or delete it; the floorplan recomputes from the
 * edited pins. Edited scans re-export as JSON metadata or a full GLB.
 *
 * Test data: the "Sample home" picker loads any of the 24 fixture homes —
 * no headset required to exercise the editor.
 *
 * Exposes `window.__companionViewer` for Playwright tests.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { extractCompanionScan, pinDisplayPosition, summarizeScan } from './scanParser.js';
import { normalizeScan, updatePin, removePin, scanToJson } from './scanMetadata.js';
import { buildScanReport } from '../export/ScanReport.js';
import { saveBlob } from '../export/GltfDownload.js';
import { TEST_HOMES, homeToScanFixture } from '../fixtures/homes.js';

// Light (ci.computer) palette for the 3D view
const PIN_COLOR  = { CvServer: 0x0a7d43, MetaScene: 0x2b5fd9 };
const KIND_COLOR = { plane: 0x2b5fd9, mesh: 0x666670 };

// ── Three.js scene ─────────────────────────────────────────────────────────

const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f1f1);
scene.add(new THREE.GridHelper(10, 20, 0xbcbcbc, 0xdadada));
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

// ── State ──────────────────────────────────────────────────────────────────

let contentGroup    = null;    // loaded geometry + pin markers
let geometryGroup   = null;    // geometry subtree (re-exported on Export GLB)
let currentScan     = null;    // normalized companion_scan block
let selectedPinId   = null;
const markerMap     = new Map();   // pinId → THREE.Group
const filters       = { CvServer: true, MetaScene: true };
let boundsHelper    = null;

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
  geometryGroup = null;
  markerMap.clear();
  boundsHelper = null;
  selectedPinId = null;
}

// ── Loading ────────────────────────────────────────────────────────────────

/** Load a scan from a GLB ArrayBuffer. */
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
        color: KIND_COLOR[kind] ?? 0x666670,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
      });
    }
  });
  geometryGroup = gltf.scene;
  contentGroup.add(gltf.scene);

  loadScan(extractCompanionScan(gltf.scene) ?? { pins: [] }, { keepContent: true });
}

/**
 * Render scan metadata (pins + sidebar). Usable without a GLB (tests,
 * sample homes).
 */
function loadScan(scan, { keepContent = false } = {}) {
  if (!keepContent) clearContent();
  currentScan = normalizeScan(scan);
  _rebuildMarkers();
  _renderAll();
  _frameContent();
}

/** Load one of the fixture homes as editable sample data. */
function loadSampleHome(name) {
  const home = TEST_HOMES.find(h => h.name === name);
  if (!home) return;
  const { scan, boxes, rooms } = homeToScanFixture(home);

  clearContent();
  geometryGroup = new THREE.Group();
  geometryGroup.name = 'sample-home-geometry';
  for (const r of rooms) {
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(r.w, r.h, r.d),
      new THREE.MeshBasicMaterial({ color: 0xaaaaaa, wireframe: true, transparent: true, opacity: 0.45 }),
    );
    shell.position.set(r.x, r.h / 2, r.z);
    shell.name = 'plane-room-shell';
    geometryGroup.add(shell);
  }
  for (const b of boxes) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      new THREE.MeshBasicMaterial({ color: KIND_COLOR.mesh, wireframe: true, transparent: true, opacity: 0.7 }),
    );
    mesh.position.set(b.x, b.y, b.z);
    mesh.rotation.y = b.yaw;
    mesh.name = `mesh-${b.label}`;
    geometryGroup.add(mesh);
  }
  contentGroup.add(geometryGroup);
  loadScan(scan, { keepContent: true });
}

// ── Markers ────────────────────────────────────────────────────────────────

function _rebuildMarkers() {
  for (const group of markerMap.values()) contentGroup.remove(group);
  markerMap.clear();
  if (boundsHelper) { contentGroup.remove(boundsHelper); boundsHelper = null; }

  for (const pin of currentScan?.pins ?? []) {
    const group = _buildPinMarker(pin);
    group.visible = filters[pin.source] ?? true;
    contentGroup.add(group);
    markerMap.set(pin.id, group);
  }

  if (currentScan?.floorplan?.bounds) {
    const { min, max } = currentScan.floorplan.bounds;
    const box = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, max.y, max.z),
    );
    boundsHelper = new THREE.Box3Helper(box, 0xb07d10);
    contentGroup.add(boundsHelper);
  }
}

function _buildPinMarker(pin) {
  const group = new THREE.Group();
  const p = pinDisplayPosition(pin);
  group.position.set(p.x, p.y, p.z);

  const color = PIN_COLOR[pin.source] ?? 0x111111;
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  group.add(sphere);
  group.add(_textSprite(pin.label || '?', color));
  group.userData.pin = pin;
  return group;
}

function _textSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.roundRect(1, 1, 254, 62, 12); ctx.fill(); ctx.stroke();
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

function _renderAll() {
  _renderStats();
  _renderPinList();
  _renderEditor();
  document.getElementById('dropzone').classList.add('hidden');
  for (const id of ['report-btn', 'json-btn', 'glb-btn']) {
    document.getElementById(id).style.display = '';
  }
}

function _renderStats() {
  const stats = document.getElementById('scan-stats');
  const s = summarizeScan(currentScan);
  stats.innerHTML = `
    <tr><td>Pins</td><td>${s.pinCount} (${s.cvCount} cv · ${s.sceneCount} scene)</td></tr>
    <tr><td>Bounds</td><td>${s.boundsSize ?? '—'}</td></tr>
    <tr><td>Exported</td><td>${s.exportedAt ? new Date(s.exportedAt).toLocaleString() : '—'}</td></tr>
    <tr><td>Anchor</td><td style="word-break: break-all;">${s.anchorUuid ?? '—'}</td></tr>
  `;
}

function _renderPinList() {
  const list = document.getElementById('pin-list');
  list.innerHTML = '';
  for (const pin of currentScan?.pins ?? []) {
    if (!(filters[pin.source] ?? true)) continue;
    const li = document.createElement('li');
    li.dataset.pinId = pin.id;
    if (pin.id === selectedPinId) li.classList.add('selected');
    const conf = pin.source === 'CvServer'
      ? ` ${Math.round((pin.confidence ?? 0) * 100)}%`
      : '';
    li.innerHTML = `
      <span class="src-${pin.source}">${pin.label || '?'}${conf}</span>
      <span class="meta">${pin.hit_type ?? ''}</span>
    `;
    if (pin.florence_caption) li.title = pin.florence_caption;
    li.addEventListener('click', () => _selectPin(pin.id));
    list.appendChild(li);
  }
}

// ── Editor ─────────────────────────────────────────────────────────────────

function _selectPin(pinId) {
  selectedPinId = pinId;
  const pin = currentScan.pins.find(p => p.id === pinId);
  if (pin) _focusPin(pin);
  _renderPinList();
  _renderEditor();
}

function _renderEditor() {
  const editor = document.getElementById('editor');
  const title  = document.getElementById('editor-title');
  const pin = currentScan?.pins.find(p => p.id === selectedPinId);
  if (!pin) {
    editor.classList.add('hidden');
    title.style.display = 'none';
    return;
  }
  editor.classList.remove('hidden');
  title.style.display = '';
  const p = pinDisplayPosition(pin);
  document.getElementById('pin-label').value      = pin.label ?? '';
  document.getElementById('pin-confidence').value = pin.confidence ?? 0;
  document.getElementById('pin-x').value = p.x.toFixed(2);
  document.getElementById('pin-y').value = p.y.toFixed(2);
  document.getElementById('pin-z').value = p.z.toFixed(2);
  document.getElementById('pin-caption').value = pin.florence_caption ?? '';
}

function _applyEdits() {
  if (!selectedPinId) return;
  const num = (id) => Number(document.getElementById(id).value);
  currentScan = updatePin(currentScan, selectedPinId, {
    label:      document.getElementById('pin-label').value,
    confidence: Math.min(1, Math.max(0, num('pin-confidence'))),
    position:   { x: num('pin-x'), y: num('pin-y'), z: num('pin-z') },
    florence_caption: document.getElementById('pin-caption').value || null,
  });
  _rebuildMarkers();
  _renderAll();
}

function _deleteSelected() {
  if (!selectedPinId) return;
  currentScan = removePin(currentScan, selectedPinId);
  selectedPinId = null;
  _rebuildMarkers();
  _renderAll();
}

function _focusPin(pin) {
  const p = pinDisplayPosition(pin);
  const target = new THREE.Vector3(p.x, p.y, p.z);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(0.8, 0.5, 0.8));
}

document.getElementById('pin-apply').addEventListener('click', _applyEdits);
document.getElementById('pin-delete').addEventListener('click', _deleteSelected);

document.getElementById('filter-cv').addEventListener('change', (e) => {
  filters.CvServer = e.target.checked;
  _rebuildMarkers(); _renderPinList();
});
document.getElementById('filter-scene').addEventListener('change', (e) => {
  filters.MetaScene = e.target.checked;
  _rebuildMarkers(); _renderPinList();
});

// ── Exports ────────────────────────────────────────────────────────────────

function _timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

document.getElementById('report-btn').addEventListener('click', () => {
  if (!currentScan) return;
  saveBlob(
    new Blob([buildScanReport(currentScan)], { type: 'text/markdown' }),
    `companion-scan-report-${_timestamp()}.md`,
  );
});

document.getElementById('json-btn').addEventListener('click', () => {
  if (!currentScan) return;
  saveBlob(
    new Blob([scanToJson(currentScan)], { type: 'application/json' }),
    `companion-scan-${_timestamp()}.json`,
  );
});

document.getElementById('glb-btn').addEventListener('click', async () => {
  if (!currentScan) return;
  const root = geometryGroup ?? new THREE.Group();
  const prev = root.userData.companion_scan;
  root.userData.companion_scan = normalizeScan(currentScan);
  try {
    const glb = await new Promise((resolve, reject) =>
      new GLTFExporter().parse(root, resolve, reject, {
        binary: true, embedImages: false, onlyVisible: false,
      }),
    );
    saveBlob(new Blob([glb], { type: 'model/gltf-binary' }), `companion-scan-${_timestamp()}.glb`);
  } finally {
    if (prev === undefined) delete root.userData.companion_scan;
    else root.userData.companion_scan = prev;
  }
});

// ── Sample homes ───────────────────────────────────────────────────────────

const sampleSelect = document.getElementById('sample-select');
for (const home of TEST_HOMES) {
  const opt = document.createElement('option');
  opt.value = home.name;
  opt.textContent = home.name.replaceAll('_', ' ');
  sampleSelect.appendChild(opt);
}
sampleSelect.addEventListener('change', (e) => {
  if (e.target.value) loadSampleHome(e.target.value);
});

// ── File handling ──────────────────────────────────────────────────────────

async function loadFile(file) {
  try {
    await loadGlb(await file.arrayBuffer());
  } catch (err) {
    console.error('[Viewer] Failed to load GLB:', err);
    document.getElementById('empty-note')?.remove();
    document.getElementById('scan-stats').innerHTML =
      `<tr><td colspan="2" style="color: var(--error)">Failed to load: ${err?.message ?? err}</td></tr>`;
  }
}

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadFile(file);
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
      `<tr><td colspan="2" style="color: var(--error)">Failed to load ${name}: ${err?.message ?? err}</td></tr>`;
  }
}

document.getElementById('scan-refresh').addEventListener('click', refreshServerScans);
refreshServerScans();

// ── Test hook ──────────────────────────────────────────────────────────────

window.__companionViewer = {
  loadGlb,
  loadScan,
  loadSampleHome,
  refreshServerScans,
  selectPin: _selectPin,
  getScan: () => currentScan,
  getState: () => ({
    pinCount: currentScan?.pins?.length ?? 0,
    hasContent: !!contentGroup && contentGroup.children.length > 0,
    markerCount: markerMap.size,
    selectedPinId,
  }),
};
