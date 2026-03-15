/**
 * Unit tests for CvServerClient — REST client for the local CV server.
 *
 * Uses vi.stubGlobal to mock global `fetch` so no network calls are made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CvServerClient, videoToBase64Jpeg } from '../../src/cv/CvServerClient.js';

// ── Helper: create a mock fetch response ─────────────────────────────────

function mockFetch(body, { status = 200, ok = true } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ── Restore fetch after each test ────────────────────────────────────────

afterEach(() => { vi.restoreAllMocks(); });

describe('CvServerClient — constructor defaults', () => {
  it('sets baseUrl to empty string by default', () => {
    const c = new CvServerClient();
    expect(c.baseUrl).toBe('');
  });

  it('strips trailing slash from baseUrl', () => {
    const c = new CvServerClient({ baseUrl: 'http://example.com/' });
    expect(c.baseUrl).toBe('http://example.com');
  });

  it('defaults boxThreshold to 0.35', () => {
    expect(new CvServerClient().boxThreshold).toBe(0.35);
  });

  it('defaults textThreshold to 0.25', () => {
    expect(new CvServerClient().textThreshold).toBe(0.25);
  });

  it('defaults timeoutMs to 30000', () => {
    expect(new CvServerClient().timeoutMs).toBe(30_000);
  });

  it('respects custom options', () => {
    const c = new CvServerClient({
      baseUrl: 'http://myserver.local',
      boxThreshold: 0.5,
      textThreshold: 0.3,
      timeoutMs: 5000,
      detectionPrompt: 'cat . dog',
    });
    expect(c.baseUrl).toBe('http://myserver.local');
    expect(c.boxThreshold).toBe(0.5);
    expect(c.textThreshold).toBe(0.3);
    expect(c.timeoutMs).toBe(5000);
    expect(c.detectionPrompt).toBe('cat . dog');
  });
});

describe('CvServerClient — health()', () => {
  it('GETs /v1/health and returns true when ok', async () => {
    const mockFn = mockFetch({});
    vi.stubGlobal('fetch', mockFn);
    const c = new CvServerClient({ baseUrl: 'http://server' });
    const result = await c.health();
    expect(result).toBe(true);
    expect(mockFn).toHaveBeenCalledWith('http://server/v1/health', expect.anything());
  });

  it('returns false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const c = new CvServerClient();
    const result = await c.health();
    expect(result).toBe(false);
  });
});

describe('CvServerClient — detect()', () => {
  it('POSTs to /v1/detect with correct JSON body', async () => {
    const response = { detections: [{ label: 'chair', cx: 0.5, cy: 0.5, confidence: 0.8, bbox_cxcywh: [0.5, 0.5, 0.2, 0.3] }] };
    const mockFn = mockFetch(response);
    vi.stubGlobal('fetch', mockFn);

    const c = new CvServerClient({ baseUrl: 'http://s' });
    const result = await c.detect('base64data');

    expect(result).toEqual(response);
    const [url, opts] = mockFn.mock.calls[0];
    expect(url).toBe('http://s/v1/detect');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.image).toBe('base64data');
    expect(body.box_threshold).toBe(0.35);
    expect(body.text_threshold).toBe(0.25);
  });

  it('uses custom prompt when provided', async () => {
    const mockFn = mockFetch({ detections: [] });
    vi.stubGlobal('fetch', mockFn);

    const c = new CvServerClient();
    await c.detect('img', { prompt: 'cat . dog', boxThreshold: 0.6, textThreshold: 0.4 });

    const body = JSON.parse(mockFn.mock.calls[0][1].body);
    expect(body.prompt).toBe('cat . dog');
    expect(body.box_threshold).toBe(0.6);
    expect(body.text_threshold).toBe(0.4);
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'error' }, { status: 500, ok: false }));
    const c = new CvServerClient();
    await expect(c.detect('img')).rejects.toThrow('500');
  });
});

describe('CvServerClient — segment()', () => {
  it('POSTs to /v1/segment with image and boxes', async () => {
    const response = { segments: [] };
    const mockFn = mockFetch(response);
    vi.stubGlobal('fetch', mockFn);

    const c = new CvServerClient({ baseUrl: 'http://s' });
    const boxes = [[0.5, 0.5, 0.2, 0.3]];
    const result = await c.segment('img64', boxes);

    expect(result).toEqual(response);
    const body = JSON.parse(mockFn.mock.calls[0][1].body);
    expect(body.image).toBe('img64');
    expect(body.boxes).toEqual(boxes);
  });
});

describe('CvServerClient — florence()', () => {
  it('POSTs to /v1/florence with image and default task', async () => {
    const mockFn = mockFetch({ task: '<MORE_DETAILED_CAPTION>', result: {} });
    vi.stubGlobal('fetch', mockFn);

    const c = new CvServerClient({ baseUrl: 'http://s' });
    await c.florence('img64');

    const body = JSON.parse(mockFn.mock.calls[0][1].body);
    expect(body.image).toBe('img64');
    expect(body.task).toBe('<MORE_DETAILED_CAPTION>');
  });

  it('uses custom task when provided', async () => {
    const mockFn = mockFetch({});
    vi.stubGlobal('fetch', mockFn);
    const c = new CvServerClient();
    await c.florence('img', '<OD>');
    const body = JSON.parse(mockFn.mock.calls[0][1].body);
    expect(body.task).toBe('<OD>');
  });
});

describe('CvServerClient — uploadGltf()', () => {
  it('POSTs multipart form to /v1/gltf with a Blob', async () => {
    const response = { status: 'saved', path: '/tmp/out.glb', bytes: 1024 };
    const mockFn = mockFetch(response);
    vi.stubGlobal('fetch', mockFn);

    const c = new CvServerClient({ baseUrl: 'http://s' });
    const blob = new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], { type: 'model/gltf-binary' });
    const result = await c.uploadGltf(blob, 'scan.glb');

    expect(result).toEqual(response);
    const [url, opts] = mockFn.mock.calls[0];
    expect(url).toBe('http://s/v1/gltf');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('wraps ArrayBuffer in Blob', async () => {
    const mockFn = mockFetch({ status: 'saved', path: '/out.glb', bytes: 4 });
    vi.stubGlobal('fetch', mockFn);

    const c = new CvServerClient();
    const buf = new ArrayBuffer(4);
    await c.uploadGltf(buf);
    const [, opts] = mockFn.mock.calls[0];
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetch({}, { status: 500, ok: false }));
    const c = new CvServerClient();
    await expect(c.uploadGltf(new Blob([]))).rejects.toThrow('glTF upload failed');
  });
});

describe('CvServerClient — timeout', () => {
  it('aborts fetch after timeoutMs', async () => {
    // Mock fetch that hangs forever
    let abortSignal;
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      abortSignal = opts.signal;
      return new Promise(() => {}); // never resolves
    }));
    vi.useFakeTimers();

    const c = new CvServerClient({ timeoutMs: 100 });
    const promise = c.health();

    vi.advanceTimersByTime(200);
    // AbortController.abort() is called - verify signal is aborted
    expect(abortSignal.aborted).toBe(true);

    vi.useRealTimers();
    // The fetch never resolved, so the promise hangs - that's expected
    // (in real code the AbortError would propagate)
  });
});

describe('CvServerClient — URL construction', () => {
  it('uses empty baseUrl by default (Vite proxy)', async () => {
    const mockFn = mockFetch({ detections: [] });
    vi.stubGlobal('fetch', mockFn);
    const c = new CvServerClient();
    await c.detect('img');
    expect(mockFn.mock.calls[0][0]).toBe('/v1/detect');
  });
});
