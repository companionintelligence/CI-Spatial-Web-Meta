/**
 * LocalScanClient: the create-then-append flow, the 404 restart, refusal of non-local hosts,
 * and the local-only test. No network: fetch is a recording fake.
 */
import { describe, it, expect, vi } from 'vitest';
import { LocalScanClient, LocalScanError, detectionForPlacement } from '../../src/scan/LocalScanClient.js';
import { NonLocalDestinationError } from '../../src/net/localOnly.js';
import { buildKeyframe } from '../../src/scan/payload.js';
import { defaultHierarchy } from '../../src/scan/hierarchy.js';

const SCAN_ID = `scan_${'a'.repeat(32)}`;

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A fake fetch that answers from a queue and records every call. */
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
  return { fetchImpl, calls };
}

const createdBody = {
  contract_version: '1.0',
  scan_id: SCAN_ID,
  keyframes: [{ keyframe_id: 'kf-0001' }],
  detections: [{
    detection_id: 'kf-0001-d01',
    keyframe_id: 'kf-0001',
    label: 'chair',
    confidence: 0.5,
    bbox_cxcywh: [0.4, 0.6, 0.14, 0.2],
    cx: 0.4,
    cy: 0.6,
    detector: { id: 'stub', version: '1' },
  }],
};

function keyframe(captureId = 'cap-1') {
  return buildKeyframe({
    clientKeyframeId: captureId,
    capturedAtMs: 1763300000000,
    width: 64,
    height: 36,
    base64: 'AAAA',
    position: { x: 0, y: 1.6, z: 0.5 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    hfovRad: (80 * Math.PI) / 180,
  });
}

const HIERARCHY = defaultHierarchy('Kitchen');
const CLIENT = { name: 'companion-scan-quest', version: '1.0.0', device: 'meta-quest-3', session_id: null };

describe('LocalScanClient — create, then append', () => {
  it('creates the scan on the first capture and returns the detections in placement shape', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(201, createdBody)]);
    const client = new LocalScanClient({ getBaseUrl: () => 'http://192.168.1.20:8000', fetchImpl });

    const result = await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://192.168.1.20:8000/v1/scans');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body.hierarchy.room.name).toBe('Kitchen');
    expect(calls[0].body.keyframes).toHaveLength(1);
    expect(result.scanId).toBe(SCAN_ID);
    expect(result.detections[0]).toEqual({
      label: 'chair', cx: 0.4, cy: 0.6, confidence: 0.5,
      bbox_cxcywh: [0.4, 0.6, 0.14, 0.2],
      detectionId: 'kf-0001-d01', keyframeId: 'kf-0001', detector: 'stub',
    });
    expect(client.scanId).toBe(SCAN_ID);
  });

  it('appends to the same scan on later captures', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse(201, createdBody),
      jsonResponse(200, { ...createdBody, keyframes: [{ keyframe_id: 'kf-0002' }], detections: [] }),
    ]);
    const client = new LocalScanClient({ getBaseUrl: () => 'http://10.0.0.2:8000', fetchImpl });
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe('cap-1') });
    const second = await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [{ id: 'plane-1' }], keyframe: keyframe('cap-2') });

    expect(calls[1].url).toBe(`http://10.0.0.2:8000/v1/scans/${SCAN_ID}/keyframes`);
    expect(calls[1].body.keyframes[0].client_keyframe_id).toBe('cap-2');
    expect(calls[1].body.planes).toEqual([{ id: 'plane-1' }]);
    expect(second.keyframes[0].keyframe_id).toBe('kf-0002');
  });

  it('starts a new scan when the server no longer has the old one (404)', async () => {
    const newScan = `scan_${'b'.repeat(32)}`;
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse(201, createdBody),
      jsonResponse(404, { detail: 'scan not found' }),
      jsonResponse(201, { ...createdBody, scan_id: newScan }),
    ]);
    const client = new LocalScanClient({ getBaseUrl: () => 'http://10.0.0.2:8000', fetchImpl });
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() });
    const result = await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() });

    expect(calls[2].url).toBe('http://10.0.0.2:8000/v1/scans');
    expect(result.scanId).toBe(newScan);
  });

  it('reset() makes the next capture start a new scan', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(201, createdBody), jsonResponse(201, createdBody)]);
    const client = new LocalScanClient({ getBaseUrl: () => 'http://10.0.0.2:8000', fetchImpl });
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() });
    client.reset();
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() });
    expect(calls.map((c) => c.url)).toEqual(['http://10.0.0.2:8000/v1/scans', 'http://10.0.0.2:8000/v1/scans']);
  });

  it('turns a server error into a LocalScanError with the status', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(503, { detail: 'GroundingDINO is not installed' })]);
    const client = new LocalScanClient({ getBaseUrl: () => 'http://10.0.0.2:8000', fetchImpl });
    const failure = await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() })
      .catch((err) => err);
    expect(failure).toBeInstanceOf(LocalScanError);
    expect(failure.status).toBe(503);
    expect(failure.message).toMatch(/Scan server error 503/);
  });

  it('sends the auth header only with the requests it is given for', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(201, createdBody)]);
    const client = new LocalScanClient({
      getBaseUrl: () => 'http://10.0.0.2:8000',
      getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
      fetchImpl,
    });
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() });
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' });
  });
});

describe('LocalScanClient — the local-only rule', () => {
  it('refuses a public server before any request is made', async () => {
    const { fetchImpl } = fakeFetch([]);
    const client = new LocalScanClient({ getBaseUrl: () => 'https://meta.ci.computer', fetchImpl });
    await expect(
      client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() }),
    ).rejects.toBeInstanceOf(NonLocalDestinationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses same-origin requests when the page itself is on a public host', async () => {
    const { fetchImpl } = fakeFetch([]);
    const client = new LocalScanClient({
      getBaseUrl: () => '',
      getPageHref: () => 'https://meta.ci.computer/',
      fetchImpl,
    });
    await expect(
      client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe() }),
    ).rejects.toBeInstanceOf(NonLocalDestinationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends every request of a whole capture to local hosts only', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse(201, createdBody),
      jsonResponse(200, { ...createdBody, keyframes: [{ keyframe_id: 'kf-0002' }], detections: [] }),
    ]);
    const client = new LocalScanClient({
      getBaseUrl: () => '',
      getPageHref: () => 'https://192.168.1.20:8081/',
      fetchImpl,
    });
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe('cap-1') });
    await client.submit({ hierarchy: HIERARCHY, client: CLIENT, planes: [], keyframe: keyframe('cap-2') });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const host = new URL(call.url).hostname;
      expect(['192.168.1.20', '127.0.0.1', 'localhost']).toContain(host);
    }
  });
});

describe('detectionForPlacement', () => {
  it('keeps the fields the placement code reads', () => {
    const out = detectionForPlacement(createdBody.detections[0]);
    expect(out).toMatchObject({ label: 'chair', cx: 0.4, cy: 0.6, confidence: 0.5 });
    expect(out.bbox_cxcywh).toEqual([0.4, 0.6, 0.14, 0.2]);
  });
});
