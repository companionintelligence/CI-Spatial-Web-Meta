/**
 * Unit tests for the capture encoder — turns a video frame into the base64 JPEG
 * the CV server takes. The off-thread path uses ImageBitmap and OffscreenCanvas;
 * where they are missing it falls back to a canvas snapshot.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fakeCanvas } from './helpers/fakeCanvas.js';

const { encodeVideoFrame, blobToBase64 } = await import('../../src/cv/CaptureEncoder.js');
const { videoToBase64Jpeg } = await import('../../src/cv/CvServerClient.js');

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A FileReader that reads the blob as a data URL: 'WFla' is its base64 payload. */
class ReaderOk {
  readAsDataURL() {
    queueMicrotask(() => {
      this.result = 'data:image/jpeg;base64,WFla';
      this.onload();
    });
  }
}

class ReaderFails {
  readAsDataURL() {
    queueMicrotask(() => {
      this.error = new Error('unreadable blob');
      this.onerror();
    });
  }
}

describe('videoToBase64Jpeg', () => {
  it('snapshots the frame and returns the base64 payload of the JPEG', () => {
    const canvas = fakeCanvas();
    vi.stubGlobal('document', { createElement: () => canvas });

    const base64 = videoToBase64Jpeg({ videoWidth: 320, videoHeight: 180 }, 0.5);

    expect(base64).toBe('QUJD');
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(canvas.ctx.drawImage).toHaveBeenCalled();
  });

  it('falls back to 640 by 360 when the video has no size yet', () => {
    const canvas = fakeCanvas();
    vi.stubGlobal('document', { createElement: () => canvas });
    videoToBase64Jpeg({});
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
  });
});

describe('blobToBase64', () => {
  it('resolves with the base64 payload of the blob', async () => {
    vi.stubGlobal('FileReader', ReaderOk);
    await expect(blobToBase64(new Blob(['x']))).resolves.toBe('WFla');
  });

  it('rejects when the blob cannot be read', async () => {
    vi.stubGlobal('FileReader', ReaderFails);
    await expect(blobToBase64(new Blob(['x']))).rejects.toThrow('unreadable blob');
  });
});

describe('encodeVideoFrame', () => {
  it('uses the canvas snapshot when ImageBitmap or OffscreenCanvas is unavailable', async () => {
    const canvas = fakeCanvas();
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);

    await expect(encodeVideoFrame({ videoWidth: 8, videoHeight: 6 })).resolves.toBe('QUJD');
  });

  it('snapshots an ImageBitmap off the main thread, then closes it', async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    class FakeOffscreenCanvas {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() { return { drawImage }; }
      convertToBlob() { return Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })); }
    }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4, height: 3, close })));
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('FileReader', ReaderOk);

    const videoEl = { videoWidth: 4, videoHeight: 3 };
    await expect(encodeVideoFrame(videoEl, 0.7)).resolves.toBe('WFla');

    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(videoEl);
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
