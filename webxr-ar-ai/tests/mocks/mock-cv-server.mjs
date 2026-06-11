/**
 * Mock CV server — a dependency-free stand-in for cv-server/main.py used by
 * the Playwright e2e suite (started via playwright.config webServer).
 *
 * Implements the same /v1 contract:
 *   GET  /v1/health    GET  /v1/models
 *   POST /v1/detect    POST /v1/florence    POST /v1/segment
 *   POST /v1/gltf      GET  /v1/gltf        GET /v1/gltf/{name}
 *
 * Plus test-control endpoints:
 *   POST /__mock/detections   set the detections returned by detect/florence
 *   POST /__mock/reset        restore defaults
 *
 * Usage: node tests/mocks/mock-cv-server.mjs [port]
 */

import http from 'http';

const PORT = Number(process.argv[2] ?? process.env.MOCK_CV_PORT ?? 8000);

const DEFAULT_DETECTIONS = [
  { label: 'chair', cx: 0.42, cy: 0.6, confidence: 0.87, bbox_cxcywh: [0.42, 0.6, 0.18, 0.3] },
  { label: 'table', cx: 0.68, cy: 0.55, confidence: 0.81, bbox_cxcywh: [0.68, 0.55, 0.22, 0.25] },
];

const MODELS = [
  { id: 'Florence', label: 'Florence-2', kind: 'caption+detect' },
  { id: 'GDino',    label: 'GroundingDINO', kind: 'detect' },
  { id: 'SAM2',     label: 'GroundingDINO + SAM 2', kind: 'detect+segment' },
  { id: 'YoloWorld', label: 'YOLO-World (mock)', kind: 'detect' },
];

let detections = [...DEFAULT_DETECTIONS];
const gltfStore = new Map();   // name → Buffer

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    // ── Test control ────────────────────────────────────────────────────
    if (route === 'POST /__mock/detections') {
      detections = JSON.parse((await readBody(req)).toString() || '[]');
      return json(res, 200, { status: 'ok', count: detections.length });
    }
    if (route === 'POST /__mock/reset') {
      detections = [...DEFAULT_DETECTIONS];
      gltfStore.clear();
      return json(res, 200, { status: 'ok' });
    }

    // ── /v1 contract ────────────────────────────────────────────────────
    if (route === 'GET /v1/health') {
      return json(res, 200, { status: 'ok', device: 'mock', cuda: false });
    }
    if (route === 'GET /v1/models') {
      return json(res, 200, { models: MODELS });
    }
    if (route === 'POST /v1/detect') {
      await readBody(req);
      return json(res, 200, { detections });
    }
    if (route === 'POST /v1/florence') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (body.task === '<OD>') {
        // Florence OD returns pixel-space boxes for a 1280×720 frame
        const labels = detections.map(d => d.label);
        const bboxes = detections.map(d => {
          const [cx, cy, w, h] = d.bbox_cxcywh;
          return [(cx - w / 2) * 1280, (cy - h / 2) * 720, (cx + w / 2) * 1280, (cy + h / 2) * 720];
        });
        return json(res, 200, { task: '<OD>', result: { '<OD>': { labels, bboxes } } });
      }
      return json(res, 200, {
        task: body.task,
        result: { [body.task ?? '<MORE_DETAILED_CAPTION>']: 'a mock room with test furniture' },
      });
    }
    if (route === 'POST /v1/segment') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const segments = (body.boxes ?? []).map((_, i) => ({
        index: i, score: 0.9, area: 100, rle: { counts: [10, 10], size: [720, 1280] },
      }));
      return json(res, 200, { segments });
    }
    if (route === 'POST /v1/gltf') {
      const body = await readBody(req);
      const name = `upload-${Date.now()}.glb`;
      gltfStore.set(name, body);
      return json(res, 200, { status: 'saved', path: `/mock/${name}`, bytes: body.length });
    }
    if (route === 'GET /v1/gltf') {
      return json(res, 200, {
        files: [...gltfStore.entries()].map(([name, buf]) => ({
          name, bytes: buf.length, modified: new Date().toISOString(),
        })),
      });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/gltf/')) {
      const name = decodeURIComponent(url.pathname.slice('/v1/gltf/'.length));
      const buf = gltfStore.get(name);
      if (!buf) return json(res, 404, { detail: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': buf.length });
      return res.end(buf);
    }

    json(res, 404, { detail: `No mock for ${route}` });
  } catch (err) {
    json(res, 500, { detail: String(err?.message ?? err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-cv-server] listening on http://127.0.0.1:${PORT}`);
});
