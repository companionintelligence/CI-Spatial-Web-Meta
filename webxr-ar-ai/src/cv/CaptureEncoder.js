/**
 * CaptureEncoder — asynchronous video-frame → base64 JPEG encoding.
 *
 * The previous implementation (videoToBase64Jpeg) ran drawImage + toDataURL
 * synchronously on the main thread (~20–60 ms for a 1280×720 frame on Quest 3),
 * which stalls the immersive render loop. This version:
 *
 *   1. createImageBitmap(video)  — captures the frame at call time (async)
 *   2. OffscreenCanvas.convertToBlob — JPEG encode off the main thread
 *   3. FileReader → base64        — async, no copy on the main thread
 *
 * Falls back to the synchronous canvas path when OffscreenCanvas /
 * createImageBitmap are unavailable (e.g. unit tests, old browsers).
 */

import { videoToBase64Jpeg } from './CvServerClient.js';

/**
 * Encode the current frame of a video element to base64 JPEG (no data-URL prefix).
 * The frame is sampled at call time; safe to await afterwards.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {number} [quality=0.7]
 * @returns {Promise<string>}
 */
export async function encodeVideoFrame(videoEl, quality = 0.7) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return videoToBase64Jpeg(videoEl, quality);
  }

  // Snapshot the frame immediately — the bitmap is immutable from here on.
  const bitmap = await createImageBitmap(videoEl);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return blobToBase64(blob);
  } finally {
    bitmap.close();
  }
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>} base64 payload without the data-URL prefix
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
