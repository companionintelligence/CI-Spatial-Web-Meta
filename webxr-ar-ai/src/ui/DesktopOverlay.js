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
  ['Right B',  'Cycle CV model (from the server registry)'],
  ['Left X',   'Preview distance — 1 m → 3 m → Off'],
  ['Left Y',   'Save & Export (download + upload)'],
  ['Trigger',  'Display mode — BBox2D → Label3D → Both'],
];

const STYLE = `
#co-overlay {
  position: fixed; top: 16px; left: 16px; z-index: 1000;
  width: 340px; max-height: calc(100dvh - 32px); overflow-y: auto;
  background: #ffffff; color: #111111;
  border: 1px solid #e4e4e4; border-radius: 12px;
  font: 13px/1.5 system-ui, -apple-system, sans-serif; padding: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.10);
}
#co-overlay.co-hidden { display: none; }
#co-overlay h1 { font-size: 16px; margin: 0; letter-spacing: -0.01em; }
#co-overlay .co-brand { color: #6b6b6b; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 2px; }
#co-overlay .co-sub { color: #6b6b6b; font-size: 12px; margin-bottom: 12px; }
#co-overlay table { width: 100%; border-collapse: collapse; }
#co-overlay td { padding: 3px 0; vertical-align: top; }
#co-overlay td:first-child { color: #6b6b6b; width: 96px; }
#co-overlay .co-section { margin-top: 12px; border-top: 1px solid #ececec; padding-top: 10px; }
#co-overlay .co-badge {
  display: inline-block; padding: 0 8px; border-radius: 8px;
  font-size: 12px; font-weight: 600;
}
.co-badge.ok    { background: #e5f4ec; color: #0a7d43; }
.co-badge.warn  { background: #faf3dc; color: #8a6207; }
.co-badge.error { background: #fbe9e7; color: #b3261e; }
.co-badge.info  { background: #eef1f6; color: #2b5fd9; }
#co-overlay .co-key { color: #2b5fd9; font-weight: 600; white-space: nowrap; padding-right: 10px; }
#co-overlay button {
  background: #111111; color: #ffffff; border: 1px solid #111111;
  border-radius: 8px; padding: 6px 12px; font: 600 13px system-ui, sans-serif;
  cursor: pointer; margin-right: 8px; margin-bottom: 6px;
}
#co-overlay button:hover { background: #333333; }
#co-status-line { min-height: 18px; margin-top: 8px; font-weight: 600; }
`;

export class DesktopOverlay {
  /**
   * @param {object} deps
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} deps.pinManager
   * @param {import('../cv/CvServerClient.js').CvServerClient} deps.cvClient
   * @param {() => Promise<string>} deps.onDownload  triggers a local GLB download
   * @param {() => void} [deps.onClear]  clears pins, geometry snapshots, and storage
   */
  constructor({ pinManager, cvClient, onDownload, onClear = null }) {
    this.pinManager = pinManager;
    this.cvClient   = cvClient;
    this.onDownload = onDownload;
    this.onClear    = onClear;
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
      <div class="co-brand">Companion Intelligence</div>
      <h1>Companion Scan Quest</h1>
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
        <button id="co-clear">Clear Scan</button>
        <div id="co-status-line"></div>
      </div>
    `;
    document.body.appendChild(this._root);

    this._root.querySelector('#co-session').textContent = appState.captureSessionId;
    this._root.querySelector('#co-download').addEventListener('click', () => this._download());
    this._root.querySelector('#co-viewer').addEventListener('click', () => {
      window.open('/viewer.html', '_blank');
    });
    const clearBtn = this._root.querySelector('#co-clear');
    if (this.onClear) clearBtn.addEventListener('click', () => this.onClear());
    else clearBtn.remove();

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
    el.style.color = { ok: '#0a7d43', warn: '#8a6207', error: '#b3261e' }[level] ?? '#6b6b6b';
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
