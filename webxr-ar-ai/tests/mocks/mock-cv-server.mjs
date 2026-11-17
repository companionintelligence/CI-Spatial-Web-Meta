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
  { id: 'Local', label: 'Local scan', kind: 'detect' },
  { id: 'Florence', label: 'Florence-2', kind: 'caption+detect' },
  { id: 'GDino',    label: 'GroundingDINO', kind: 'detect' },
  { id: 'SAM2',     label: 'GroundingDINO + SAM 2', kind: 'detect+segment' },
  { id: 'YoloWorld', label: 'YOLO-World (mock)', kind: 'detect' },
];

let detections = [...DEFAULT_DETECTIONS];
const gltfStore = new Map();   // name → Buffer
// The local scan API (/v1/scans), as cv-server/localscan implements it, with the
// request bodies kept so a test can check exactly what the headset sent.
const scans = new Map();       // scan_id → { record, received: [...bodies] }
let scanSeq = 0;

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

/**
 * A contract ScanRecord-shaped result for the mock: the keyframes and detections a
 * request adds. Boxes come from the current mock detections, so a test can set them.
 */
function mockScanRecord(scanId, body, keyframeOffset = 0) {
  const hierarchy = body.hierarchy ?? null;
  const keyframes = (body.keyframes ?? []).map((kf, i) => {
    const number = keyframeOffset + i + 1;
    const keyframeId = `kf-${String(number).padStart(4, '0')}`;
    return {
      keyframe_id: keyframeId,
      client_keyframe_id: kf.client_keyframe_id ?? null,
      captured_at_ms: kf.captured_at_ms ?? null,
      image: { format: 'jpeg', width: kf.image?.width ?? 0, height: kf.image?.height ?? 0, file: `keyframes/${keyframeId}.jpg` },
      pose: kf.pose,
      intrinsics: kf.intrinsics,
      detection_count: detections.length,
      _detections: detections.map((d, j) => ({
        detection_id: `${keyframeId}-d${String(j + 1).padStart(2, '0')}`,
        keyframe_id: keyframeId,
        level: 'OBJECT',
        label: d.label,
        confidence: d.confidence,
        bbox_cxcywh: d.bbox_cxcywh,
        cx: d.cx,
        cy: d.cy,
        mask: null,
        detector: { id: 'mock', version: '1' },
      })),
    };
  });
  const allDetections = keyframes.flatMap((kf) => kf._detections);
  for (const kf of keyframes) delete kf._detections;
  const record = {
    contract_version: '1.0',
    scan_id: scanId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    hierarchy,
    client: body.client ?? null,
    planes: body.planes ?? [],
    keyframes: keyframes.map((kf) => ({ ...kf })),
    detections: allDetections,
    detector: keyframes.length ? { id: 'mock', version: '1' } : null,
  };
  return { ...record, keyframes: record.keyframes, detections: record.detections };
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
      scans.clear();
      return json(res, 200, { status: 'ok' });
    }
    if (route === 'GET /__mock/scans') {
      return json(res, 200, {
        scans: [...scans.values()].map(({ record, received }) => ({ record, received })),
      });
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

    // ── Local scan API ──────────────────────────────────────────────────
    if (route === 'POST /v1/scans') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const scanId = `scan_${String(++scanSeq).padStart(32, '0')}`;
      const record = mockScanRecord(scanId, body);
      scans.set(scanId, { record, received: [body] });
      return json(res, 201, { contract_version: '1.0', scan_id: scanId, keyframes: record.keyframes, detections: record.detections });
    }
    const appendMatch = /^\/v1\/scans\/([^/]+)\/keyframes$/.exec(url.pathname);
    if (req.method === 'POST' && appendMatch) {
      const entry = scans.get(appendMatch[1]);
      if (!entry) return json(res, 404, { detail: 'scan not found' });
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      entry.received.push(body);
      const before = entry.record.keyframes.length;
      const added = mockScanRecord(appendMatch[1], { hierarchy: entry.record.hierarchy, keyframes: body.keyframes ?? [] }, before);
      entry.record.keyframes.push(...added.keyframes);
      entry.record.detections.push(...added.detections);
      if (body.planes) entry.record.planes = body.planes;
      return json(res, 200, { contract_version: '1.0', scan_id: appendMatch[1], keyframes: added.keyframes, detections: added.detections });
    }
    const readMatch = /^\/v1\/scans\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && readMatch) {
      const entry = scans.get(readMatch[1]);
      return entry ? json(res, 200, entry.record) : json(res, 404, { detail: 'scan not found' });
    }

    json(res, 404, { detail: `No mock for ${route}` });
  } catch (err) {
    json(res, 500, { detail: String(err?.message ?? err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-cv-server] listening on http://127.0.0.1:${PORT}`);
});
