/**
 * WristHUD — small world-space status panel attached to the left controller wrist.
 *
 * Displays:
 *   Model: Florence | GDino | SAM2
 *   Display: BoundingBox2D | SpatialLabel3D | Both
 *   Preview: Near (1m) | Far (3m) | Off
 *   BUSY…  ← shown while a capture is running
 *
 * Attached to world.input.xrOrigin.gripSpaces.left.
 */

import * as THREE from 'three';
import { appState } from '../app/AppState.js';

const HUD_WIDTH  = 0.14;   // metres
const HUD_HEIGHT = 0.08;   // metres
const CANVAS_W   = 420;
const CANVAS_H   = 240;

export class WristHUD {
  /** @param {import('@iwsdk/core').World} world */
  constructor(world) {
    this.world   = world;
    this._canvas = null;
    this._ctx    = null;
    this._tex    = null;
    this._mesh   = null;
    this._dirty  = true;

    // React to state changes
    appState.subscribe(() => { this._dirty = true; });
  }

  /** Attach the HUD to the left grip space. Call after World.create. */
  init() {
    const grip = this.world.input?.xrOrigin?.gripSpaces?.left;
    if (!grip) {
      console.warn('[WristHUD] Left grip space not available');
      return;
    }

    this._canvas = document.createElement('canvas');
    this._canvas.width  = CANVAS_W;
    this._canvas.height = CANVAS_H;
    this._ctx = this._canvas.getContext('2d');
    this._tex = new THREE.CanvasTexture(this._canvas);

    const mat  = new THREE.MeshBasicMaterial({ map: this._tex, transparent: true, depthTest: false });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(HUD_WIDTH, HUD_HEIGHT), mat);

    // Position on wrist (palm-facing, slightly above grip)
    this._mesh.position.set(0, 0.04, -0.02);
    this._mesh.rotation.x = -0.6;   // tilt toward viewer
    this._mesh.renderOrder = 10;

    grip.add(this._mesh);
    this._redraw();
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
    ];

    ctx.font      = 'bold 28px sans-serif';
    const lineH   = 56;
    const startY  = 48;
    rows.forEach(({ label, value }, i) => {
      const y = startY + i * lineH;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(label, 16, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(value, 160, y);
    });

    // BUSY indicator
    if (appState.isBusy) {
      ctx.fillStyle = '#ff8800';
      ctx.font      = 'bold 30px sans-serif';
      ctx.fillText('BUSY…', W / 2 - 50, H - 20);
    }

    if (this._tex) this._tex.needsUpdate = true;
  }
}
