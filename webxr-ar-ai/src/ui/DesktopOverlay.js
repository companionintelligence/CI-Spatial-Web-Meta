/**
 * DesktopOverlay — DOM status panel shown on the 2D page (desktop browser, or
 * the Quest browser window before entering AR).
 *
 * Shows:
 *   - The link to open this page on a headset (copy button)
 *   - WebXR immersive-ar support, with a hint when the page is not in a
 *     WebXR-capable browser
 *   - CV server health (polled), with a note that scanning still works without it
 *   - Live pin counts (subscribes to the SpatialPinManager)
 *   - Capture session id + last status message
 *   - Camera FOV calibration for this device (saved in localStorage)
 *   - Server connection: point the CV/CI server at a URL, or sign in via
 *     OAuth (button hidden unless the deployment configures an issuer)
 *   - Controller button legend
 *   - Export controls: download the scan GLB locally / open the desktop viewer
 *   - In the Quest app only: an Enter AR button. The app starts AR by itself on
 *     launch (src/app/questApp.js); the button brings it back after the user
 *     leaves AR, or when the launch could not start it.
 *
 * The overlay hides itself while an immersive session is presenting and
 * reappears on session end (where it shows the scan gathered in-headset —
 * useful when the headset window is mirrored or remote-viewed).
 *
 * Styling is the Companion Intelligence canon: every colour, size and face is
 * a canon custom property (tokens.css), so the overlay follows the light and
 * dark sets without any literal values here.
 */

import { appState } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';
import {
  clearCameraHfov,
  getLocalStorage,
  resolveCameraHfov,
  saveCameraHfov,
} from '../pipeline/cameraCalibration.js';
import { cssVar } from './theme.js';
import {
  beginSignIn,
  checkMemoryServer,
  clearSession,
  discoverResources,
  fetchIdentity,
  getSession,
  listMemoryModels,
} from '../net/PortalSession.js';
import { firstRunStatus, FTUE_STEP, hostOf } from '../net/ftueModel.js';
import { describeArError } from '../app/questApp.js';
import { cameraToggleLabel, recordingIndicator } from '../privacy/capturePolicy.js';
import { loadRoomName, saveRoomName } from '../scan/hierarchy.js';
import { summarisePlanes } from '../scan/planes.js';

const HEALTH_POLL_MS = 8000;
const HEALTH_MAX_OFFLINE_MS = 60_000;

/**
 * Delay before the next health check. While the server answers, poll every
 * HEALTH_POLL_MS. While it does not, back off (doubling, capped at a minute) so
 * an offline site is not asking for /v1/health every few seconds.
 * @param {number} failures  consecutive failed checks
 * @returns {number} milliseconds
 */
export function healthDelayMs(failures) {
  if (failures <= 0) return HEALTH_POLL_MS;
  return Math.min(HEALTH_MAX_OFFLINE_MS, HEALTH_POLL_MS * 2 ** Math.min(failures, 4));
}

const LEGEND = [
  ['Right A',  'Capture (both pipelines)'],
  ['Right B',  'Cycle CV model (from the server registry)'],
  ['Left X',   'Preview distance — 1 m → 3 m → Off'],
  ['Left Y',   'Save & Export (download + upload)'],
  ['Left stick', 'Camera on or off (off at the start of each session)'],
  ['Trigger',  'Display mode — BBox2D → Label3D → Both'],
];

/** Note colour per level, as canon custom properties. */
const NOTE_COLOR = {
  info:  cssVar('muted-foreground'),
  ok:    cssVar('success'),
  warn:  cssVar('warning'),
  error: cssVar('destructive'),
};

const STYLE = `
#co-overlay {
  position: fixed; top: 16px; left: 16px; z-index: 1000;
  width: 340px; max-height: calc(100dvh - 32px); overflow-y: auto;
  background: var(--ci-surface-3); color: var(--foreground);
  border: 1px solid var(--ci-border-2); border-radius: var(--radius-lg);
  font: 13px/1.5 var(--font-sans); letter-spacing: var(--font-letter-spacing);
  padding: 16px;
  box-shadow: var(--shadow-elev-2);
}
#co-overlay.co-hidden { display: none; }
#co-overlay .co-lockup { display: block; height: 34px; width: auto; margin-bottom: 10px; }
#co-overlay .co-lockup-dark { display: none; }
.dark #co-overlay .co-lockup-light { display: none; }
.dark #co-overlay .co-lockup-dark { display: block; }
#co-overlay h1 {
  font-size: var(--type-card-title); font-weight: var(--type-card-title-weight);
  line-height: var(--type-card-title-leading); letter-spacing: var(--type-title-tracking);
  margin: 0;
}
#co-overlay .co-brand {
  color: var(--label-ink); font-size: var(--type-label); font-weight: var(--type-label-weight);
  letter-spacing: var(--type-label-tracking); text-transform: var(--type-label-transform);
  margin-bottom: 2px;
}
#co-overlay .co-sub { color: var(--muted-foreground); font-size: 12px; margin-bottom: 12px; }
#co-overlay table { width: 100%; border-collapse: collapse; }
#co-overlay td { padding: 3px 0; vertical-align: top; }
#co-overlay td:first-child { color: var(--muted-foreground); width: 96px; }
#co-overlay tr[hidden] { display: none; }
#co-overlay .co-section { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 10px; }
#co-overlay .co-badge {
  display: inline-block; padding: 0 8px; border-radius: var(--radius-control);
  font-size: 12px; font-weight: 600;
}
.co-badge.ok    { background: var(--ci-success-bg); color: var(--success); }
.co-badge.warn  { background: var(--ci-warning-bg); color: var(--warning); }
.co-badge.error { background: var(--ci-danger-bg); color: var(--destructive); }
.co-badge.info  { background: color-mix(in srgb, var(--info) 14%, transparent); color: var(--info); }
#co-overlay .co-key { color: var(--label-ink); font-weight: 600; white-space: nowrap; padding-right: 10px; }
#co-overlay button {
  background: var(--button-primary); color: var(--button-primary-foreground);
  border: 1px solid transparent; border-radius: var(--radius-control);
  padding: 6px 12px; font: 600 13px var(--font-sans); cursor: pointer;
  margin-right: 8px; margin-bottom: 6px;
  box-shadow: var(--button-primary-shadow);
}
#co-overlay button:hover {
  background: var(--button-primary-hover); box-shadow: var(--button-primary-shadow-hover);
  transform: var(--button-primary-lift-hover);
}
#co-status-line { min-height: 18px; margin-top: 8px; font-weight: 600; }
#co-overlay .co-legal { margin-top: 8px; font-size: 11.5px; }
#co-overlay .co-legal a { color: var(--muted-foreground); }
#co-overlay .co-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
#co-overlay .co-row input {
  flex: 1; min-width: 0; border: 1px solid var(--ci-border-2); border-radius: var(--radius-control);
  padding: 4px 6px; font: 12.5px var(--font-sans); color: var(--foreground); background: var(--background);
}
#co-overlay .co-row input[type="number"] { flex: 0 0 72px; }
#co-overlay .co-label { color: var(--muted-foreground); font-size: 12px; white-space: nowrap; }
#co-overlay .co-note { color: var(--muted-foreground); font-size: 11.5px; line-height: 1.4; }
#co-overlay .co-note:empty { display: none; }
#co-conn-status { color: var(--muted-foreground); font-size: 11px; margin-top: 4px; }
#co-overlay .co-ftue-title { font-weight: 600; margin-bottom: 2px; }
#co-overlay .co-ftue-actions { flex-wrap: wrap; }
#co-overlay .co-ftue-actions button:disabled { opacity: 0.6; cursor: progress; }
#co-overlay #co-enter-ar { margin-bottom: 0; }
#co-overlay #co-enter-ar:disabled { opacity: 0.6; cursor: progress; }
#co-enter-ar-note { margin-bottom: 8px; }
`;

export class DesktopOverlay {
  /**
   * @param {object} deps
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} deps.pinManager
   * @param {import('../cv/CvServerClient.js').CvServerClient} deps.cvClient
   * @param {() => Promise<string>} deps.onDownload  triggers a local GLB download
   * @param {() => void} [deps.onClear]  clears pins, geometry snapshots, and storage
   * @param {typeof import('../net/ServerConnection.js')} [deps.connection]
   *   server URL + OAuth helpers; the Server section is omitted without it
   * @param {() => Promise<unknown>} [deps.onEnterAr]  starts the AR session; the Enter AR
   *   button is shown only with it (the Quest app, which has no browser Enter AR)
   */
  constructor({ pinManager, cvClient, onDownload, onClear = null, connection = null, onEnterAr = null, onToggleCamera = null }) {
    this.pinManager = pinManager;
    this.cvClient   = cvClient;
    this.onDownload = onDownload;
    this.onClear    = onClear;
    this.connection = connection;
    this.onEnterAr  = onEnterAr;
    this.onToggleCamera = onToggleCamera;
    this._root       = null;
    this._healthTimer = 0;
    this._healthFailures = 0;
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
      <img class="co-lockup co-lockup-light" src="/brand/lockup-light.svg" alt="Companion Intelligence" />
      <img class="co-lockup co-lockup-dark" src="/brand/lockup-dark.svg" alt="" aria-hidden="true" />
      <h1>Companion Scan Quest</h1>
      <div class="co-sub">Quest 3 world mapper — put on the headset and enter AR</div>
      <div id="co-rec" class="co-badge error" hidden></div>
      <div class="co-row" id="co-enter-ar-row">
        <button id="co-enter-ar">Enter AR</button>
      </div>
      <div id="co-enter-ar-note" class="co-note"></div>
      <div class="co-section co-ftue" id="co-ftue">
        <div class="co-brand">Set up</div>
        <div id="co-ftue-title" class="co-ftue-title"></div>
        <div id="co-ftue-detail" class="co-note"></div>
        <div class="co-row co-ftue-actions">
          <button id="co-ftue-primary">Sign in with Companion Intelligence</button>
          <button id="co-ftue-check" hidden>Check this server</button>
          <button id="co-ftue-use" hidden>Use this memory server</button>
        </div>
      </div>
      <div class="co-section" style="margin-top: 0; border-top: 0; padding-top: 0;">
        <div class="co-brand">Open on your Quest</div>
        <div class="co-row">
          <input id="co-headset-link" type="text" readonly aria-label="Link to open on the headset" />
          <button id="co-copy-link">Copy</button>
        </div>
        <div id="co-copy-note" class="co-note"></div>
      </div>
      <table class="co-section">
        <tr><td>WebXR</td><td id="co-xr-status"><span class="co-badge info">Checking…</span></td></tr>
        <tr id="co-xr-hint" hidden><td></td><td class="co-note">Open this page in the Meta Quest Browser to scan a room.</td></tr>
        <tr><td>CV server</td><td id="co-cv-status"><span class="co-badge info">Checking…</span></td></tr>
        <tr id="co-cv-note" hidden><td></td><td class="co-note">No CV server answered. Scene pins and GLB export still work.</td></tr>
        <tr><td>Pins</td><td id="co-pins">0 cv · 0 scene</td></tr>
        <tr><td>Session</td><td id="co-session" style="word-break: break-all;"></td></tr>
      </table>
      <div class="co-section">
        <div class="co-row">
          <input id="co-server-url" type="text" placeholder="Server URL (blank = same origin)" aria-label="Server URL" />
          <button id="co-server-save">Save</button>
        </div>
        <button id="co-oauth-disconnect">Sign out</button>
        <div id="co-conn-status"></div>
      </div>
      <div class="co-section">
        <div class="co-brand">Camera calibration</div>
        <div class="co-row">
          <label class="co-label" for="co-hfov">Camera FOV (°)</label>
          <input id="co-hfov" type="number" min="21" max="159" step="1" inputmode="numeric" />
          <button id="co-hfov-save">Save</button>
          <button id="co-hfov-reset">Reset</button>
        </div>
        <div id="co-hfov-note" class="co-note"></div>
      </div>
      <div class="co-section" id="co-camera-section">
        <div class="co-brand">Camera</div>
        <div class="co-row">
          <span id="co-camera-state" class="co-badge info">Camera off</span>
          <button id="co-camera-toggle">Turn camera on</button>
        </div>
        <div class="co-note">Off until you turn it on. While it is on, frames go only to the local scan server and the headset shows a red REC line. The Left stick also toggles it in the headset.</div>
      </div>
      <div class="co-section" id="co-room-section">
        <div class="co-brand">Room</div>
        <div class="co-row">
          <label class="co-label" for="co-room">Name</label>
          <input id="co-room" type="text" maxlength="120" aria-label="Room name" />
          <button id="co-room-save">Save</button>
        </div>
        <div id="co-room-note" class="co-note"></div>
        <div id="co-scan" class="co-note"></div>
        <div class="co-brand">Planes</div>
        <ul id="co-planes" class="co-note" style="margin: 0; padding-left: 18px;"></ul>
      </div>
      <div class="co-section">
        <table>${LEGEND.map(([k, v]) => `<tr><td class="co-key">${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>
      <div class="co-section">
        <button id="co-download">Download GLB</button>
        <button id="co-viewer">Open Viewer</button>
        <button id="co-clear">Clear Scan</button>
        <div id="co-status-line"></div>
      </div>
      <div class="co-legal"><a href="/licenses.txt" target="_blank" rel="noopener">Licences</a></div>
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

    if (this.onEnterAr) {
      this._root.querySelector('#co-enter-ar').addEventListener('click', () => this._enterAr());
    } else {
      this._root.querySelector('#co-enter-ar-row').remove();
      this._root.querySelector('#co-enter-ar-note').remove();
    }

    this._initHeadsetLink();
    this._initConnection();
    this._initCalibration();
    this._initFirstRun();
    this._initCamera();
    this._initRoom();

    // ── Live data ─────────────────────────────────────────────────────────
    const refreshPins = () => this._refreshPins();
    this.pinManager.addEventListener('add',    refreshPins);
    this.pinManager.addEventListener('remove', refreshPins);
    this.pinManager.addEventListener('clear',  refreshPins);

    appState.subscribe((field) => {
      if (field === 'status') this._refreshStatus();
      if (field === 'cameraOn') this._refreshCamera();
      if (field === 'planes') this._refreshPlanes();
      if (field === 'scan') this._refreshScan();
    });

    this._refreshCamera();
    this._refreshPlanes();
    this._refreshScan();
    this._checkXrSupport();
    this._checkHealth();

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
    clearTimeout(this._healthTimer);
    this._root?.remove();
    this._root = null;
  }

  /** Say on the panel why the AR session did not start (the Quest app's launch). */
  reportArError(err) {
    this._note('#co-enter-ar-note', describeArError(err), 'error');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async _enterAr() {
    const button = this._root?.querySelector('#co-enter-ar');
    if (!button || button.disabled) return;
    button.disabled = true;
    this._note('#co-enter-ar-note', '');
    try {
      await this.onEnterAr();
    } catch (err) {
      console.warn('[CompanionScan] Enter AR failed:', err);
      this.reportArError(err);
    } finally {
      button.disabled = false;
    }
  }

  /** The address to type or paste into the Quest Browser: this page, without query or hash. */
  _initHeadsetLink() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const link  = url.href;
    const input = this._root.querySelector('#co-headset-link');
    input.value = link;

    this._root.querySelector('#co-copy-link').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        this._note('#co-copy-note', 'Copied. Paste it into the Meta Quest Browser address bar.', 'ok');
      } catch {
        input.select();
        this._note('#co-copy-note', 'Copying is blocked here. The link is selected, so copy it by hand.', 'warn');
      }
    });
  }

  _initConnection() {
    const urlInput   = this._root.querySelector('#co-server-url');
    const saveBtn    = this._root.querySelector('#co-server-save');
    const signOutBtn = this._root.querySelector('#co-oauth-disconnect');

    if (!this.connection) {
      [urlInput.parentElement, signOutBtn, this._root.querySelector('#co-conn-status')]
        .forEach(el => el.remove());
      return;
    }

    urlInput.value = this.connection.getServerUrl();
    saveBtn.addEventListener('click', () => {
      let clean;
      try {
        clean = this.connection.setServerUrl(urlInput.value);
      } catch (err) {
        appState.setStatus(err.message, 'error');
        return;
      }
      urlInput.value = clean;
      this.cvClient.setBaseUrl(clean);
      this._refreshConnStatus();
      this._checkHealth();
    });

    signOutBtn.addEventListener('click', () => {
      clearSession();
      this._session = null;
      this._discovery = null;
      this.connection.disconnect();
      // The chosen memory server belongs to the account, so the next sign-in starts afresh.
      this.connection.setMemoryUrl('');
      this._refreshConnStatus();
      this._refreshFtue();
      this._checkHealth();
    });

    this._refreshConnStatus();
  }

  _refreshConnStatus() {
    if (!this.connection) return;
    const signOutBtn = this._root?.querySelector('#co-oauth-disconnect');
    const statusEl    = this._root?.querySelector('#co-conn-status');
    if (!statusEl) return;

    const connected = Boolean(this._session) || this.connection.isConnected();
    if (signOutBtn) signOutBtn.style.display = connected ? '' : 'none';

    const url = this.connection.getServerUrl();
    const where = url || 'same origin';
    statusEl.textContent = connected ? `${where} · signed in` : where;
  }

  /** The first-run flow: sign in, find the memory servers, use one. */
  _initFirstRun() {
    this._session = getSession();
    this._discovery = null;
    this._root.querySelector('#co-ftue-primary').addEventListener('click', () => this._onFtuePrimary());
    this._root.querySelector('#co-ftue-use').addEventListener('click', () => this._useMemory());
    this._root.querySelector('#co-ftue-check').addEventListener('click', () => this._checkMemory());

    this._refreshFtue();
    if (this._session) this._autoDiscover();
  }

  /**
   * Signed in already: learn who the account is, then find its memory servers and
   * language models, with no tap needed. The user still chooses which server to use.
   */
  async _autoDiscover() {
    if (!this._session.identity) {
      try {
        await fetchIdentity({ session: this._session });
      } catch {
        // fetchIdentity clears a refused sign-in; a network error keeps the session.
      }
      this._session = getSession();
      this._refreshFtue();
      if (!this._session) return;
    }
    await this._findServers();
  }

  _firstRun() {
    return firstRunStatus({
      signedIn: Boolean(this._session),
      identity: this._session?.identity ?? null,
      discovery: this._discovery,
      memoryUrl: this.connection?.getMemoryUrl?.() ?? '',
    });
  }

  _refreshFtue() {
    if (!this._root?.querySelector('#co-ftue-title')) return;
    const status = this._firstRun();
    this._note('#co-ftue-title', status.title, status.tone);
    this._note('#co-ftue-detail', status.detail, 'info');

    const primary = this._root.querySelector('#co-ftue-primary');
    const use = this._root.querySelector('#co-ftue-use');
    if (status.step === FTUE_STEP.SIGN_IN) {
      primary.textContent = 'Sign in with Companion Intelligence';
    } else if (status.step === FTUE_STEP.READY) {
      primary.textContent = 'Find my servers again';
    } else {
      primary.textContent = this._discovery ? 'Find my servers again' : 'Find my servers';
    }

    const candidate = status.memory?.url && status.memory.health?.ok && status.step !== FTUE_STEP.READY;
    use.hidden = !candidate;
    if (candidate) use.textContent = `Use ${status.memory.name}`;

    // A server the Portal lists but nothing has contacted yet: the user checks it first.
    const check = this._root.querySelector('#co-ftue-check');
    const unchecked = Boolean(status.memory?.url) && status.memory.health === null;
    check.hidden = !unchecked;
    if (unchecked) {
      check.textContent = this._checkConfirmFor === status.memory.url
        ? `Confirm: contact ${hostOf(status.memory.url)}`
        : `Check ${status.memory.name}`;
    }
    this._refreshConnStatus();
  }

  _onFtuePrimary() {
    if (!this._session) {
      beginSignIn().catch(err => appState.setStatus(`Sign-in did not start: ${err?.message ?? err}`, 'error'));
      return;
    }
    this._findServers();
  }

  async _findServers() {
    if (!this._session) return;
    this._setFtueBusy(true);
    try {
      this._discovery = await discoverResources({ session: this._session });
      this._session = getSession();
    } catch (err) {
      appState.setStatus(err?.message ?? String(err), 'error');
    } finally {
      this._setFtueBusy(false);
    }
    this._refreshFtue();
  }

  /**
   * Checking a memory server contacts it, so the first press only asks and the second
   * confirms. The check sends no credential to the server; it asks only whether it answers.
   */
  async _checkMemory() {
    const memory = this._firstRun().memory;
    if (!memory?.url || !this._session || memory.health !== null) return;
    if (this._checkConfirmFor !== memory.url) {
      this._checkConfirmFor = memory.url;
      appState.setStatus(`Checking contacts ${hostOf(memory.url)}. Press Confirm to go ahead.`, 'warn');
      this._refreshFtue();
      return;
    }
    this._checkConfirmFor = null;
    this._setFtueBusy(true);
    try {
      const answer = await checkMemoryServer({ session: this._session, url: memory.url });
      this._mergeMemory(memory.url, { health: answer.health });
      appState.setStatus(
        answer.health.ok ? `${memory.name} answered` : `${memory.name} did not answer`,
        answer.health.ok ? 'ok' : 'warn',
      );
    } catch (err) {
      appState.setStatus(err?.message ?? String(err), 'error');
    } finally {
      this._setFtueBusy(false);
      this._refreshFtue();
    }
  }

  _useMemory() {
    const memory = this._firstRun().memory;
    if (!memory?.url || !memory.health?.ok) return;
    try {
      this.connection.setMemoryUrl(memory.url);
      appState.setStatus(`Using ${memory.name} as your memory server`, 'ok');
    } catch (err) {
      appState.setStatus(err.message, 'error');
    }
    this._refreshFtue();
    this._loadModels(memory);
  }

  /**
   * The language models of the server just chosen. The sign-in goes to that server only:
   * listMemoryModels refuses any other address.
   */
  async _loadModels(memory) {
    if (!this._session || memory.llm) return;
    try {
      const answer = await listMemoryModels({
        session: this._session,
        url: memory.url,
        chosenUrl: this.connection?.getMemoryUrl?.() ?? '',
      });
      this._mergeMemory(memory.url, { llm: answer.llm });
    } catch {
      this._mergeMemory(memory.url, { llm: { ok: false, status: 0, models: [] } });
    }
    this._refreshFtue();
  }

  /** Replace one server's entry in the discovery result, found by its address. */
  _mergeMemory(url, patch) {
    if (!this._discovery?.memory) return;
    this._discovery = {
      ...this._discovery,
      memory: this._discovery.memory.map((entry) => (entry.url === url ? { ...entry, ...patch } : entry)),
    };
  }

  _setFtueBusy(busy) {
    const primary = this._root?.querySelector('#co-ftue-primary');
    if (primary) primary.disabled = busy;
  }

  _initCalibration() {
    const input = this._root.querySelector('#co-hfov');
    this._root.querySelector('#co-hfov-save').addEventListener('click', () => this._saveHfov(input.value));
    this._root.querySelector('#co-hfov-reset').addEventListener('click', () => {
      clearCameraHfov(getLocalStorage());
      this._refreshCalibration();
      this._note('#co-hfov-note', 'Reset to the default. Applies to the next capture.', 'ok');
    });
    this._refreshCalibration();
  }

  /** Show the FOV in effect and where it comes from. */
  _refreshCalibration() {
    const { deg, source } = this._resolveHfov();
    this._root.querySelector('#co-hfov').value = String(deg);
    this._note('#co-hfov-note', {
      url:     'Set by ?hfov= in the address bar, which overrides the saved value.',
      saved:   'Saved on this device. Applies to the next capture.',
      default: 'Default. Calibrate once per headset (see the headset testing guide).',
    }[source], 'info');
  }

  _saveHfov(raw) {
    try {
      const deg = saveCameraHfov(Number(raw), getLocalStorage());
      this._refreshCalibration();
      if (this._resolveHfov().source === 'url') {
        this._note('#co-hfov-note', `Saved ${deg}°, but ?hfov= in the address bar still overrides it.`, 'warn');
      } else {
        this._note('#co-hfov-note', `Saved ${deg}°. Applies to the next capture.`, 'ok');
      }
    } catch (err) {
      const message = err instanceof RangeError ? err.message : `Could not save: ${err.message}`;
      this._note('#co-hfov-note', message, 'error');
    }
  }

  _resolveHfov() {
    return resolveCameraHfov({ search: window.location.search, storage: getLocalStorage() });
  }

  async _checkXrSupport() {
    const el   = this._root.querySelector('#co-xr-status');
    const hint = this._root.querySelector('#co-xr-hint');
    let supported = false;
    try {
      supported = Boolean(await navigator.xr?.isSessionSupported('immersive-ar'));
      el.innerHTML = supported
        ? '<span class="co-badge ok">immersive-ar supported</span>'
        : '<span class="co-badge warn">immersive-ar not supported</span>';
    } catch {
      el.innerHTML = '<span class="co-badge error">WebXR unavailable</span>';
    }
    if (hint) hint.hidden = supported;
  }

  async _checkHealth() {
    const el = this._root?.querySelector('#co-cv-status');
    if (!el) return;
    let online = false;
    try {
      online = await this.cvClient.health();
    } catch {
      online = false;
    }
    this._healthFailures = online ? 0 : this._healthFailures + 1;
    el.innerHTML = online
      ? '<span class="co-badge ok">Online</span>'
      : '<span class="co-badge error">Offline</span>';
    const note = this._root.querySelector('#co-cv-note');
    if (note) note.hidden = online;

    // One pending check at a time: a manual check (after Save) reschedules too.
    clearTimeout(this._healthTimer);
    this._healthTimer = setTimeout(() => this._checkHealth(), healthDelayMs(this._healthFailures));
  }

  // ── Camera, room and planes ───────────────────────────────────────────────

  _initCamera() {
    const section = this._root.querySelector('#co-camera-section');
    if (!this.onToggleCamera) {
      section.remove();
      return;
    }
    this._root.querySelector('#co-camera-toggle').addEventListener('click', () => this.onToggleCamera());
  }

  _refreshCamera() {
    if (!this._root) return;
    const indicator = recordingIndicator({
      cameraOn: appState.cameraOn,
      destination: globalThis.location?.host ?? '',
    });
    const state = this._root.querySelector('#co-camera-state');
    if (state) {
      state.textContent = indicator.text;
      state.className = `co-badge ${indicator.active ? 'error' : 'info'}`;
    }
    const toggle = this._root.querySelector('#co-camera-toggle');
    if (toggle) toggle.textContent = cameraToggleLabel(appState.cameraOn);
    const rec = this._root.querySelector('#co-rec');
    if (rec) {
      rec.hidden = !indicator.active;
      rec.textContent = indicator.text;
    }
  }

  _initRoom() {
    const input = this._root.querySelector('#co-room');
    input.value = loadRoomName(getLocalStorage());
    this._root.querySelector('#co-room-save').addEventListener('click', () => this._saveRoom(input.value));
  }

  _saveRoom(raw) {
    try {
      const name = saveRoomName(raw, getLocalStorage());
      this._root.querySelector('#co-room').value = name;
      this._note('#co-room-note', `Saved. The next scan is filed under "${name}".`, 'ok');
    } catch (err) {
      this._note('#co-room-note', err.message, 'error');
    }
  }

  /** The room's planes, largest first. Names are set with textContent, never as HTML. */
  _refreshPlanes() {
    const list = this._root?.querySelector('#co-planes');
    if (!list) return;
    const rows = summarisePlanes(appState.planes, 8);
    const more = appState.planes.length - rows.length;
    const items = rows.length
      ? rows.map((row) => row.text)
      : ['No planes yet. They appear once the headset has scanned the room.'];
    if (more > 0) items.push(`+${more} more`);
    list.replaceChildren(...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
  }

  _refreshScan() {
    const el = this._root?.querySelector('#co-scan');
    if (!el) return;
    el.textContent = appState.scan
      ? `Last scan ${appState.scan.id} · ${appState.scan.detections} detections`
      : 'No scan yet. Turn the camera on, then press Right A to capture a keyframe.';
  }

  _refreshPins() {
    const el = this._root?.querySelector('#co-pins');
    if (!el) return;
    const cv    = this.pinManager.bySource(PinSource.CvServer).length;
    const scene = this.pinManager.bySource(PinSource.MetaScene).length;
    el.textContent = `${cv} cv · ${scene} scene`;
  }

  _refreshStatus() {
    const { text, level } = appState.status;
    this._note('#co-status-line', text, level);
  }

  /** Set a line of text in the overlay, coloured by level. */
  _note(selector, text, level = 'info') {
    const el = this._root?.querySelector(selector);
    if (!el) return;
    el.textContent = text;
    el.style.color = NOTE_COLOR[level] ?? NOTE_COLOR.info;
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
