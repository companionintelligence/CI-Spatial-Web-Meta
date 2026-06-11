/**
 * DesktopOverlay — DOM status panel shown on the 2D page (desktop browser, or
 * the Quest browser window before entering AR).
 *
 * Shows:
 *   - WebXR immersive-ar support
 *   - CV server health (polled)
 *   - Live pin counts (subscribes to the SpatialPinManager)
 *   - Capture session id + last status message
 *   - Controller button legend
 *   - Export controls: download the scan GLB locally / open the desktop viewer
 *
 * The overlay hides itself while an immersive session is presenting and
 * reappears on session end (where it shows the scan gathered in-headset —
 * useful when the headset window is mirrored or remote-viewed).
 */

import { appState } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';

const HEALTH_POLL_MS = 8000;

const LEGEND = [
  ['Right A',  'Capture (both pipelines)'],
  ['Right B',  'Cycle model — Florence → GDino → SAM2'],
  ['Left X',   'Preview distance — 1 m → 3 m → Off'],
  ['Left Y',   'Save & Export (download + upload)'],
  ['Trigger',  'Display mode — BBox2D → Label3D → Both'],
];

const STYLE = `
#co-overlay {
  position: fixed; top: 16px; left: 16px; z-index: 1000;
  width: 340px; max-height: calc(100dvh - 32px); overflow-y: auto;
  background: rgba(12, 14, 18, 0.92); color: #e8e8e8;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
  font: 13px/1.5 system-ui, sans-serif; padding: 16px;
  backdrop-filter: blur(6px);
}
#co-overlay.co-hidden { display: none; }
#co-overlay h1 { font-size: 16px; margin: 0 0 2px; }
#co-overlay .co-sub { color: #9aa0a8; font-size: 12px; margin-bottom: 12px; }
#co-overlay table { width: 100%; border-collapse: collapse; }
#co-overlay td { padding: 3px 0; vertical-align: top; }
#co-overlay td:first-child { color: #9aa0a8; width: 96px; }
#co-overlay .co-section { margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; }
#co-overlay .co-badge {
  display: inline-block; padding: 0 8px; border-radius: 8px;
  font-size: 12px; font-weight: 600;
}
.co-badge.ok    { background: #14432a; color: #2ecc71; }
.co-badge.warn  { background: #4a3c10; color: #f1c40f; }
.co-badge.error { background: #4a1714; color: #ff6655; }
.co-badge.info  { background: #2a3242; color: #9ec3ff; }
#co-overlay .co-key { color: #9ec3ff; font-weight: 600; white-space: nowrap; padding-right: 10px; }
#co-overlay button {
  background: #2a3242; color: #e8e8e8; border: 1px solid rgba(255,255,255,0.18);
  border-radius: 8px; padding: 6px 12px; font: 600 13px system-ui, sans-serif;
  cursor: pointer; margin-right: 8px;
}
#co-overlay button:hover { background: #36405494; }
#co-status-line { min-height: 18px; margin-top: 8px; font-weight: 600; }
`;

export class DesktopOverlay {
  /**
   * @param {object} deps
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} deps.pinManager
   * @param {import('../cv/CvServerClient.js').CvServerClient} deps.cvClient
   * @param {() => Promise<string>} deps.onDownload  triggers a local GLB download
   */
  constructor({ pinManager, cvClient, onDownload }) {
    this.pinManager = pinManager;
    this.cvClient   = cvClient;
    this.onDownload = onDownload;
    this._root       = null;
    this._healthTimer = 0;
  }

  /**
   * Build the DOM and start watching app state.
   * @param {import('@iwsdk/core').World} world
   */
  init(world) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this._root = document.createElement('div');
    this._root.id = 'co-overlay';
    this._root.innerHTML = `
      <h1>Companion Scan</h1>
      <div class="co-sub">Quest 3 world mapper — put on the headset and enter AR</div>
      <table>
        <tr><td>WebXR</td><td id="co-xr-status"><span class="co-badge info">Checking…</span></td></tr>
        <tr><td>CV server</td><td id="co-cv-status"><span class="co-badge info">Checking…</span></td></tr>
        <tr><td>Pins</td><td id="co-pins">0 cv · 0 scene</td></tr>
        <tr><td>Session</td><td id="co-session" style="word-break: break-all;"></td></tr>
      </table>
      <div class="co-section">
        <table>${LEGEND.map(([k, v]) => `<tr><td class="co-key">${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>
      <div class="co-section">
        <button id="co-download">Download GLB</button>
        <button id="co-viewer">Open Viewer</button>
        <div id="co-status-line"></div>
      </div>
    `;
    document.body.appendChild(this._root);

    this._root.querySelector('#co-session').textContent = appState.captureSessionId;
    this._root.querySelector('#co-download').addEventListener('click', () => this._download());
    this._root.querySelector('#co-viewer').addEventListener('click', () => {
      window.open('/viewer.html', '_blank');
    });

    // ── Live data ─────────────────────────────────────────────────────────
    const refreshPins = () => this._refreshPins();
    this.pinManager.addEventListener('add',    refreshPins);
    this.pinManager.addEventListener('remove', refreshPins);
    this.pinManager.addEventListener('clear',  refreshPins);

    appState.subscribe((field) => {
      if (field === 'status') this._refreshStatus();
    });

    this._checkXrSupport();
    this._checkHealth();
    this._healthTimer = setInterval(() => this._checkHealth(), HEALTH_POLL_MS);

    // ── Hide while presenting ─────────────────────────────────────────────
    world.renderer.xr.addEventListener('sessionstart', () => {
      this._root.classList.add('co-hidden');
    });
    world.renderer.xr.addEventListener('sessionend', () => {
      this._root.classList.remove('co-hidden');
      this._refreshPins();
    });
  }

  dispose() {
    clearInterval(this._healthTimer);
    this._root?.remove();
    this._root = null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async _checkXrSupport() {
    const el = this._root.querySelector('#co-xr-status');
    try {
      const ok = await navigator.xr?.isSessionSupported('immersive-ar');
      el.innerHTML = ok
        ? '<span class="co-badge ok">immersive-ar supported</span>'
        : '<span class="co-badge warn">immersive-ar not supported</span>';
    } catch {
      el.innerHTML = '<span class="co-badge error">WebXR unavailable</span>';
    }
  }

  async _checkHealth() {
    const el = this._root?.querySelector('#co-cv-status');
    if (!el) return;
    try {
      const ok = await this.cvClient.health();
      el.innerHTML = ok
        ? '<span class="co-badge ok">Online</span>'
        : '<span class="co-badge error">Offline</span>';
    } catch {
      el.innerHTML = '<span class="co-badge error">Offline</span>';
    }
  }

  _refreshPins() {
    const el = this._root?.querySelector('#co-pins');
    if (!el) return;
    const cv    = this.pinManager.bySource(PinSource.CvServer).length;
    const scene = this.pinManager.bySource(PinSource.MetaScene).length;
    el.textContent = `${cv} cv · ${scene} scene`;
  }

  _refreshStatus() {
    const el = this._root?.querySelector('#co-status-line');
    if (!el) return;
    const { text, level } = appState.status;
    el.textContent = text;
    el.style.color = { ok: '#2ecc71', warn: '#f1c40f', error: '#ff6655' }[level] ?? '#cccccc';
  }

  async _download() {
    try {
      const filename = await this.onDownload();
      appState.setStatus(`Saved ${filename}`, 'ok');
    } catch (err) {
      appState.setStatus(`Download failed: ${err?.message ?? err}`, 'error');
    }
  }
}
