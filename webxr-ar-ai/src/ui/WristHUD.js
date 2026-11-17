/**
 * WristHUD — small world-space status panel attached to the left controller wrist.
 *
 * Displays:
 *   Room:    the room name the next scan is filed under
 *   Camera:  OFF, or a red REC line while the camera is on (privacy indicator)
 *   Model:   Local | Florence | GDino | SAM2
 *   Display: BoundingBox2D | SpatialLabel3D | Both
 *   Preview: Near (1m) | Far (3m) | Off
 *   Pins:    <cv> cv · <scene> scene
 *   Planes:  the room's planes, largest first (up to three, then "+N more")
 *   status line (capture/export results, errors)  — or BUSY… while capturing
 *
 * Attached to world.input.xrOrigin.gripSpaces.left.
 */

import * as THREE from 'three';
import { appState } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';
import { FONT_STACK, XR_SCHEME, canonColor, withAlpha } from './theme.js';
import { recordingIndicator } from '../privacy/capturePolicy.js';
import { summarisePlanes } from '../scan/planes.js';
import { currentHierarchy } from '../scan/hierarchy.js';

const HUD_WIDTH  = 0.14;   // metres
const CANVAS_W   = 420;
const CANVAS_H   = 420;
const HUD_HEIGHT = HUD_WIDTH * CANVAS_H / CANVAS_W;
const PLANE_ROWS = 3;
const STATUS_MAX = 30;

/** Status line colour, from the canon's dark set (the HUD sits on passthrough). */
function statusColor(level) {
  switch (level) {
    case 'ok':    return canonColor('success', XR_SCHEME);
    case 'warn':  return canonColor('warning', XR_SCHEME);
    case 'error': return canonColor('destructive', XR_SCHEME);
    default:      return canonColor('muted-foreground', XR_SCHEME);
  }
}

export class WristHUD {
  /**
   * @param {import('@iwsdk/core').World} world
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} [pinManager]
   */
  constructor(world, pinManager = null) {
    this.world      = world;
    this.pinManager = pinManager;
    this._canvas = null;
    this._ctx    = null;
    this._tex    = null;
    this._mesh   = null;
    this._dirty  = true;

    // React to state changes
    appState.subscribe(() => { this._dirty = true; });
    if (pinManager) {
      const markDirty = () => { this._dirty = true; };
      pinManager.addEventListener('add',    markDirty);
      pinManager.addEventListener('update', markDirty);
      pinManager.addEventListener('remove', markDirty);
      pinManager.addEventListener('clear',  markDirty);
    }
  }

  /**
   * Attach the HUD to the left grip space. Safe to call repeatedly until it
   * returns true — grip spaces appear asynchronously after session start.
   * @returns {boolean} true once attached
   */
  init() {
    if (this._mesh) return true;
    const grip = this.world.input?.xrOrigin?.gripSpaces?.left;
    if (!grip) return false;

    this._canvas = document.createElement('canvas');
    this._canvas.width  = CANVAS_W;
    this._canvas.height = CANVAS_H;
    this._ctx = this._canvas.getContext('2d');
    this._tex = new THREE.CanvasTexture(this._canvas);
    this._tex.generateMipmaps = false;
    this._tex.minFilter = THREE.LinearFilter;

    const mat  = new THREE.MeshBasicMaterial({ map: this._tex, transparent: true, depthTest: false });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(HUD_WIDTH, HUD_HEIGHT), mat);

    // Position on wrist (palm-facing, slightly above grip)
    this._mesh.position.set(0, 0.05, -0.02);
    this._mesh.rotation.x = -0.6;   // tilt toward viewer
    this._mesh.renderOrder = 10;

    grip.add(this._mesh);
    this._redraw();
    return true;
  }

  /** Call every frame — redraws canvas if state changed. */
  update() {
    if (!this._dirty || !this._ctx) return;
    this._dirty = false;
    this._redraw();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _redraw() {
    const ctx = this._ctx;
    const W   = CANVAS_W;
    const H   = CANVAS_H;

    ctx.clearRect(0, 0, W, H);

    // Background: the canon dark background, slightly translucent over passthrough
    ctx.fillStyle = withAlpha(canonColor('background', XR_SCHEME), 0.82);
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 16);
    ctx.fill();

    // Border
    ctx.strokeStyle = withAlpha(canonColor('foreground', XR_SCHEME), 0.2);
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, 15);
    ctx.stroke();

    const indicator = recordingIndicator({ cameraOn: appState.cameraOn });
    const rows = [
      { label: 'Room:',    value: currentHierarchy().room.name },
      { label: 'Camera:',  value: indicator.text, level: indicator.level },
      { label: 'Model:',   value: appState.modelPreset },
      { label: 'Display:', value: appState.displayMode },
      { label: 'Preview:', value: appState.previewDistanceLabel() },
      { label: 'Pins:',    value: this._pinSummary() },
    ];

    ctx.font      = `700 28px ${FONT_STACK}`;
    const lineH   = 38;
    const startY  = 42;
    rows.forEach(({ label, value, level }, i) => {
      const y = startY + i * lineH;
      ctx.fillStyle = canonColor('muted-foreground', XR_SCHEME);
      ctx.fillText(label, 16, y);
      ctx.fillStyle = level === 'alert'
        ? canonColor('destructive', XR_SCHEME)
        : canonColor('foreground', XR_SCHEME);
      ctx.fillText(_truncate(value, 26), 160, y);
    });

    // The room's planes, largest first
    const planes = summarisePlanes(appState.planes, PLANE_ROWS);
    const hidden = Math.max(0, appState.planes.length - planes.length);
    let y = startY + rows.length * lineH + 10;
    ctx.fillStyle = canonColor('muted-foreground', XR_SCHEME);
    ctx.font      = `700 22px ${FONT_STACK}`;
    ctx.fillText(`Planes: ${appState.planes.length}`, 16, y);
    ctx.fillStyle = canonColor('foreground', XR_SCHEME);
    ctx.font      = `500 21px ${FONT_STACK}`;
    planes.forEach((plane) => {
      y += 24;
      ctx.fillText(_truncate(plane.text, 34), 24, y);
    });
    if (hidden > 0) {
      y += 24;
      ctx.fillStyle = canonColor('muted-foreground', XR_SCHEME);
      ctx.fillText(`+${hidden} more`, 24, y);
    }

    // Bottom line: BUSY indicator wins over the status message
    if (appState.isBusy) {
      ctx.fillStyle = canonColor('warning', XR_SCHEME);
      ctx.font      = `700 28px ${FONT_STACK}`;
      ctx.fillText('BUSY…', 16, H - 18);
    } else if (appState.status.text) {
      ctx.fillStyle = statusColor(appState.status.level);
      ctx.font      = `700 24px ${FONT_STACK}`;
      ctx.fillText(_truncate(appState.status.text, STATUS_MAX), 16, H - 18);
    }

    if (this._tex) this._tex.needsUpdate = true;
  }

  _pinSummary() {
    if (!this.pinManager) return '—';
    const cv    = this.pinManager.bySource(PinSource.CvServer).length;
    const scene = this.pinManager.bySource(PinSource.MetaScene).length;
    return `${cv} cv · ${scene} scene`;
  }
}

function _truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
