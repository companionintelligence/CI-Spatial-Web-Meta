/**
 * LocalScanClient — posts keyframes to the local scan API (cv-server, /v1/scans).
 *
 * The first capture of a headset session creates the scan (POST /v1/scans, with the
 * hierarchy, the planes and the keyframe). Later captures append to it
 * (POST /v1/scans/{id}/keyframes). If the server no longer has the scan (404, for
 * example after its data folder was cleared), the next capture starts a new one.
 *
 * Every request is checked with assertLocalUrl first. A non-local host is refused
 * before anything is sent, so scan data cannot leave the network.
 */

import { assertLocalUrl } from '../net/localOnly.js';
import { buildAppendPayload, buildCapturePayload } from './payload.js';

/** A scan request the server answered with an error. */
export class LocalScanError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number}} [opts]
   */
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'LocalScanError';
    this.status = status;
  }
}

/**
 * A contract Detection, reshaped for PipelineB.placeDetections (the same fields the
 * legacy CV detections use, so placement and labels work unchanged).
 * @param {object} detection
 */
export function detectionForPlacement(detection) {
  return {
    label: detection.label,
    cx: detection.cx,
    cy: detection.cy,
    confidence: detection.confidence,
    bbox_cxcywh: detection.bbox_cxcywh,
    detectionId: detection.detection_id,
    keyframeId: detection.keyframe_id,
    detector: detection.detector?.id ?? null,
  };
}

export class LocalScanClient {
  /**
   * @param {object} [opts]
   * @param {() => string} [opts.getBaseUrl]     the scan server; '' means this page's own origin
   * @param {() => object} [opts.getAuthHeader]  extra headers for that server only
   * @param {number} [opts.timeoutMs=30000]
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {() => (string|undefined)} [opts.getPageHref]  the page address, for same-origin URLs
   */
  constructor({
    getBaseUrl = () => '',
    getAuthHeader = () => ({}),
    timeoutMs = 30_000,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getPageHref = () => globalThis.location?.href,
  } = {}) {
    this.getBaseUrl = getBaseUrl;
    this.getAuthHeader = getAuthHeader;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.getPageHref = getPageHref;
    this._scanId = null;
  }

  /** The scan this headset session is filing into, or null before the first capture. */
  get scanId() {
    return this._scanId;
  }

  /** Forget the scan, so the next capture starts a new one. */
  reset() {
    this._scanId = null;
  }

  /**
   * Send one keyframe, with the current planes, and get its detections back.
   * @param {object} args
   * @param {object} args.hierarchy   contract Hierarchy
   * @param {object} args.client      contract Client
   * @param {Array<object>} args.planes
   * @param {object} args.keyframe    from buildKeyframe()
   * @returns {Promise<{scanId: string, keyframes: object[], detections: object[]}>}
   *          detections are reshaped with detectionForPlacement
   */
  async submit({ hierarchy, client, planes, keyframe }) {
    if (this._scanId) {
      const appended = await this._send('POST', `/v1/scans/${this._scanId}/keyframes`,
        buildAppendPayload({ keyframes: [keyframe], planes }));
      if (appended.status !== 404) return this._take(appended.json);
      this._scanId = null;   // the server does not have this scan any more
    }
    const created = await this._send('POST', '/v1/scans',
      buildCapturePayload({ hierarchy, client, planes, keyframes: [keyframe] }));
    return this._take(created.json);
  }

  _take(body) {
    this._scanId = body.scan_id;
    return {
      scanId: body.scan_id,
      keyframes: body.keyframes ?? [],
      detections: (body.detections ?? []).map(detectionForPlacement),
    };
  }

  /**
   * One JSON request to the scan server. Returns the parsed body, or {status: 404}
   * with no body for a missing scan; any other error status throws LocalScanError.
   */
  async _send(method, path, body) {
    const url = assertLocalUrl(`${this.getBaseUrl()}${path}`, this.getPageHref());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 404) return { status: 404, json: null };
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new LocalScanError(`Scan server error ${res.status}: ${text}`, { status: res.status });
      }
      return { status: res.status, json: await res.json() };
    } finally {
      clearTimeout(timer);
    }
  }
}
