import { metadataToJson } from './viewer/companionScanMetadata.js';
import { WorldMapViewer } from './viewer/WorldMapViewer.js';

const viewer = new WorldMapViewer({
  container: document.getElementById('viewer-canvas'),
  onMetadataChange: metadata => renderMetadata(metadata),
  onSelectionChange: pin => renderEditor(pin),
  onStatusChange: message => {
    document.getElementById('status').textContent = message;
  },
});

const fileInput = document.getElementById('world-file');
const pinList = document.getElementById('pin-list');
const pinForm = document.getElementById('pin-form');
const emptyEditor = document.getElementById('pin-empty');
const stats = {
  session: document.getElementById('meta-session'),
  exported: document.getElementById('meta-exported'),
  total: document.getElementById('meta-total'),
  cv: document.getElementById('meta-cv'),
  scene: document.getElementById('meta-scene'),
};

document.getElementById('load-demo').addEventListener('click', () => viewer.loadDemoScene());
document.getElementById('reset-view').addEventListener('click', () => viewer.resetView());
document.getElementById('download-json').addEventListener('click', () => {
  const fileName = viewer.exportFileName().replace(/\.glb$/i, '.json');
  downloadFile(fileName, metadataToJson(viewer.getMetadata()), 'application/json');
});
document.getElementById('download-glb').addEventListener('click', async () => {
  const buffer = await viewer.exportGlb();
  downloadFile(viewer.exportFileName(), buffer, 'model/gltf-binary');
});

for (const source of ['CvServer', 'MetaScene']) {
  document.getElementById(`toggle-${source}`).addEventListener('change', event => {
    viewer.setSourceVisibility(source, event.target.checked);
  });
}

fileInput.addEventListener('change', async event => {
  const [file] = event.target.files ?? [];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  await viewer.loadArrayBuffer(buffer, file.name);
});

pinForm.addEventListener('input', () => {
  const pinId = pinForm.dataset.pinId;
  if (!pinId) return;
  const currentPin = viewer.getMetadata().pins.find(pin => pin.id === pinId);
  if (!currentPin) return;

  viewer.updatePin(pinId, {
    label: document.getElementById('pin-label').value,
    source: document.getElementById('pin-source').value,
    confidence: parseNumberInput('pin-confidence', currentPin.confidence),
    position: {
      x: parseNumberInput('pin-x', currentPin.position.x),
      y: parseNumberInput('pin-y', currentPin.position.y),
      z: parseNumberInput('pin-z', currentPin.position.z),
    },
    florence_caption: document.getElementById('pin-caption').value || null,
  });
});

viewer.loadDemoScene();

function renderMetadata(metadata) {
  stats.session.textContent = metadata.session_id || '—';
  stats.exported.textContent = metadata.exported_at || '—';
  stats.total.textContent = String(metadata.pins.length);
  stats.cv.textContent = String(metadata.floorplan?.cv_pin_count ?? 0);
  stats.scene.textContent = String(metadata.floorplan?.scene_pin_count ?? 0);

  pinList.innerHTML = '';
  for (const pin of metadata.pins) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pin-list-item${pin.id === pinForm.dataset.pinId ? ' is-selected' : ''}`;
    button.textContent = `${pin.label || 'Unlabelled pin'} · ${pin.source}`;
    button.addEventListener('click', () => viewer.selectPin(pin.id));
    pinList.appendChild(button);
  }
}

function renderEditor(pin) {
  if (!pin) {
    pinForm.dataset.pinId = '';
    pinForm.hidden = true;
    emptyEditor.hidden = false;
    return;
  }

  pinForm.dataset.pinId = pin.id;
  pinForm.hidden = false;
  emptyEditor.hidden = true;

  document.getElementById('pin-id').textContent = pin.id;
  document.getElementById('pin-label').value = pin.label ?? '';
  document.getElementById('pin-source').value = pin.source;
  document.getElementById('pin-confidence').value = String(pin.confidence ?? 0);
  document.getElementById('pin-x').value = String(pin.position.x);
  document.getElementById('pin-y').value = String(pin.position.y);
  document.getElementById('pin-z').value = String(pin.position.z);
  document.getElementById('pin-caption').value = pin.florence_caption ?? '';
  renderMetadata(viewer.getMetadata());
}

function downloadFile(fileName, content, contentType) {
  const blob = content instanceof ArrayBuffer
    ? new Blob([content], { type: contentType })
    : new Blob([content], { type: contentType });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseNumberInput(elementId, fallback) {
  const value = Number.parseFloat(document.getElementById(elementId).value);
  return Number.isFinite(value) ? value : fallback;
}
