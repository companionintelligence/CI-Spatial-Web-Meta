/**
 * CvServerClient — REST client for the local CV server.
 *
 * Endpoints:
 *   POST /v1/detect   — GroundingDINO detections
 *   POST /v1/segment  — SAM 2 segmentation masks
 *   POST /v1/florence — Florence-2 caption / object detection
 *   POST /v1/gltf     — Upload glTF export
 *   GET  /v1/health   — Health check
 *
 * All image endpoints accept { image: <base64 JPEG> }.
 * baseUrl defaults to '' (Vite proxy forwards /v1/* to localhost:8000).
 */
export class CvServerClient {
  /**
   * @param {object}  [opts]
   * @param {string}  [opts.baseUrl='']
   * @param {number}  [opts.timeoutMs=30000]
   * @param {number}  [opts.boxThreshold=0.35]
   * @param {number}  [opts.textThreshold=0.25]
   * @param {string}  [opts.detectionPrompt]
   * @param {() => object} [opts.getAuthHeader]  returns extra headers (e.g. a
   *   Bearer token) merged into every request; defaults to none, for a
   *   trusted local server that needs no auth.
   */
  constructor({
    baseUrl        = '',
    timeoutMs      = 30_000,
    boxThreshold   = 0.35,
    textThreshold  = 0.25,
    detectionPrompt = 'object . person . chair . table . cup . bottle . door . screen . shelf . bed . sofa',
    getAuthHeader  = () => ({}),
  } = {}) {
    this.baseUrl         = baseUrl.replace(/\/$/, '');
    this.timeoutMs       = timeoutMs;
    this.boxThreshold    = boxThreshold;
    this.textThreshold   = textThreshold;
    this.detectionPrompt = detectionPrompt;
    this.getAuthHeader   = getAuthHeader;
  }

  /** Point at a different server at runtime (e.g. after the user saves a new URL). */
  setBaseUrl(baseUrl) {
    this.baseUrl = (baseUrl ?? '').replace(/\/$/, '');
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async health() {
    const res = await this._get('/v1/health');
    return res.ok;
  }

  // ── Models ───────────────────────────────────────────────────────────────

  /**
   * Fetch the server's model registry.
   * @returns {Promise<{models: Array<{id:string,label:string,kind:string}>}>}
   */
  async models() {
    const res = await this._get('/v1/models');
    if (!res.ok) throw new Error(`models query failed: ${res.status}`);
    return res.json();
  }

  // ── Detect ───────────────────────────────────────────────────────────────

  /**
   * @param {string} base64Jpeg
   * @param {object} [opts]
   * @returns {Promise<{detections:Array<{label:string,cx:number,cy:number,confidence:number,bbox_cxcywh:number[]}>}>}
   */
  async detect(base64Jpeg, opts = {}) {
    return this._postJson('/v1/detect', {
      image:          base64Jpeg,
      prompt:         opts.prompt         ?? this.detectionPrompt,
      box_threshold:  opts.boxThreshold   ?? this.boxThreshold,
      text_threshold: opts.textThreshold  ?? this.textThreshold,
      ...(opts.model ? { model: opts.model } : {}),
    });
  }

  // ── Segment ──────────────────────────────────────────────────────────────

  /**
   * @param {string}      base64Jpeg
   * @param {number[][]}  boxes  normalised [cx,cy,w,h]
   * @returns {Promise<{segments:Array<{index:number,score:number,area:number,rle:object}>}>}
   */
  async segment(base64Jpeg, boxes) {
    return this._postJson('/v1/segment', { image: base64Jpeg, boxes });
  }

  // ── Florence ─────────────────────────────────────────────────────────────

  /**
   * @param {string} base64Jpeg
   * @param {string} [task='<MORE_DETAILED_CAPTION>']
   * @returns {Promise<{task:string, result:object}>}
   */
  async florence(base64Jpeg, task = '<MORE_DETAILED_CAPTION>') {
    return this._postJson('/v1/florence', { image: base64Jpeg, task });
  }

  // ── glTF upload ──────────────────────────────────────────────────────────

  /**
   * Upload a glTF file (ArrayBuffer or Blob) to the server.
   * @param {Blob|ArrayBuffer} gltfData
   * @param {string} [filename='export.gltf']
   * @returns {Promise<{status:string, path:string, bytes:number}>}
   */
  async uploadGltf(gltfData, filename = 'export.gltf') {
    const form = new FormData();
    const blob = gltfData instanceof Blob
      ? gltfData
      : new Blob([gltfData], { type: 'model/gltf+json' });
    form.append('file', blob, filename);

    const res = await this._fetchWithTimeout(`${this.baseUrl}/v1/gltf`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: form,
    });
    if (!res.ok) throw new Error(`glTF upload failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async _postJson(path, body) {
    const res = await this._fetchWithTimeout(`${this.baseUrl}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`CV server error ${res.status}: ${text}`);
    }
    return res.json();
  }

  async _get(path) {
    return this._fetchWithTimeout(`${this.baseUrl}${path}`, { headers: this.getAuthHeader() });
  }

  _fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }
}

// ── Utility: canvas / video → base64 JPEG ─────────────────────────────────

/**
 * Capture the current frame of an HTMLVideoElement as a base64 JPEG string.
 * @param {HTMLVideoElement} videoEl
 * @param {number} [quality=0.7]
 * @returns {string} base64 data without the data-URL prefix
 */
export function videoToBase64Jpeg(videoEl, quality = 0.7) {
  const canvas = document.createElement('canvas');
  canvas.width  = videoEl.videoWidth  || 640;
  canvas.height = videoEl.videoHeight || 360;
  canvas.getContext('2d').drawImage(videoEl, 0, 0);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}
