/**
 * WristHUD — small world-space status panel attached to the left controller wrist.
 *
 * Displays:
 *   Model:   Florence | GDino | SAM2
 *   Display: BoundingBox2D | SpatialLabel3D | Both
 *   Preview: Near (1m) | Far (3m) | Off
 *   Pins:    <cv> cv · <scene> scene
 *   status line (capture/export results, errors)  — or BUSY… while capturing
 *
 * Attached to world.input.xrOrigin.gripSpaces.left.
 */

import * as THREE from 'three';
import { appState } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';

const HUD_WIDTH  = 0.14;   // metres
const HUD_HEIGHT = 0.10;   // metres
const CANVAS_W   = 420;
const CANVAS_H   = 300;

const STATUS_COLOR = {
  info:  '#cccccc',
  ok:    '#2ecc71',
  warn:  '#f1c40f',
  error: '#ff5544',
};

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
    this._mesh.position.set(0, 0.04, -0.02);
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

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 16);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, 15);
    ctx.stroke();

    // Text rows
    const rows = [
      { label: 'Model:',   value: appState.modelPreset },
      { label: 'Display:', value: appState.displayMode },
      { label: 'Preview:', value: appState.previewDistanceLabel() },
      { label: 'Pins:',    value: this._pinSummary() },
    ];

    ctx.font      = 'bold 28px sans-serif';
    const lineH   = 52;
    const startY  = 44;
    rows.forEach(({ label, value }, i) => {
      const y = startY + i * lineH;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(label, 16, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(value, 160, y);
    });

    // Bottom line: BUSY indicator wins over the status message
    if (appState.isBusy) {
      ctx.fillStyle = '#ff8800';
      ctx.font      = 'bold 30px sans-serif';
      ctx.fillText('BUSY…', 16, H - 20);
    } else if (appState.status.text) {
      ctx.fillStyle = STATUS_COLOR[appState.status.level] ?? STATUS_COLOR.info;
      ctx.font      = 'bold 24px sans-serif';
      ctx.fillText(_truncate(appState.status.text, 30), 16, H - 20);
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
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
