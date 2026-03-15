/**
 * CameraViewfinder — world-space camera preview plane.
 *
 * Creates a flat plane anchored 40 cm in front of the viewer's head.
 * The material uses the VideoTexture from the CameraSource entity.
 * A second overlay plane carries a CanvasTexture for 2D bounding-box drawing.
 *
 * Usage:
 *   const vf = new CameraViewfinder(world);
 *   await vf.init(cameraEntity);    // call once after CameraSource is running
 *   vf.setOverlayData(detections);  // call each capture
 *   vf.update();                    // call every frame to redraw if dirty
 */

import * as THREE from 'three';
import { CameraSource } from '@iwsdk/core';

const PLANE_WIDTH = 0.24;   // metres
const PLANE_DEPTH = -0.4;   // metres forward from head

export class CameraViewfinder {
  /**
   * @param {import('@iwsdk/core').World} world
   */
  constructor(world) {
    this.world       = world;
    this._group      = null;
    this._overlayCtx = null;
    this._overlayTex = null;
    this._detections = [];
    this._dirty      = false;
  }

  /**
   * Create the viewfinder + overlay planes and attach them to the camera.
   * @param {import('@iwsdk/core').Entity} cameraEntity  entity with CameraSource
   */
  async init(cameraEntity) {
    // Poll for CameraSource to produce a video element (CameraSystem starts it async)
    let videoEl = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      videoEl = cameraEntity.getValue(CameraSource, 'videoElement');
      if (videoEl) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!videoEl) {
      console.warn('[CameraViewfinder] Camera video element not available after timeout');
    }

    const videoTex = cameraEntity.getValue(CameraSource, 'texture')
                  ?? new THREE.VideoTexture(videoEl);

    const aspect = videoEl?.videoWidth && videoEl?.videoHeight
      ? videoEl.videoWidth / videoEl.videoHeight
      : 16 / 9;
    const planeH = PLANE_WIDTH / aspect;

    // ── Video plane ──────────────────────────────────────────────────────
    const videoMat  = new THREE.MeshBasicMaterial({ map: videoTex, transparent: true, depthTest: false });
    const videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, planeH), videoMat);
    videoMesh.renderOrder = 1;

    // ── Overlay canvas ────────────────────────────────────────────────────
    const ow = 512;
    const oh = Math.round(512 / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    this._overlayCtx = canvas.getContext('2d');
    this._overlayTex = new THREE.CanvasTexture(canvas);

    const overlayMat  = new THREE.MeshBasicMaterial({ map: this._overlayTex, transparent: true, depthTest: false });
    const overlayMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANE_WIDTH * 1.001, planeH * 1.001),
      overlayMat,
    );
    overlayMesh.position.z = 0.001;
    overlayMesh.renderOrder = 2;

    // ── Group, attach to camera ────────────────────────────────────────────
    this._group = new THREE.Group();
    this._group.add(videoMesh, overlayMesh);
    this._group.position.set(0, 0, PLANE_DEPTH);

    // Attach to camera (follows head)
    this.world.camera.add(this._group);
    this._planeH = planeH;
  }

  // ── Overlay API ───────────────────────────────────────────────────────────

  /**
   * Queue a new set of detections to draw on the overlay.
   * @param {Array<{label:string,cx:number,cy:number,confidence:number,bboxCxCyWH:number[]}>} detections
   */
  setOverlayData(detections) {
    this._detections = detections;
    this._dirty = true;
  }

  /** Redraw the overlay canvas if dirty (call every frame). */
  update() {
    if (!this._dirty || !this._overlayCtx) return;
    this._dirty = false;
    this._redraw();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _redraw() {
    const ctx = this._overlayCtx;
    const w   = ctx.canvas.width;
    const h   = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (const det of this._detections) {
      const cx = det.cx * w;
      const cy = det.cy * h;
      const bb = det.bboxCxCyWH ?? det.bbox_cxcywh;

      // BBox rectangle
      if (bb) {
        const [bcx, bcy, bw, bh] = bb;
        const rx = (bcx - bw / 2) * w;
        const ry = (bcy - bh / 2) * h;
        ctx.strokeStyle = 'rgba(0, 255, 80, 0.9)';
        ctx.lineWidth   = 2;
        ctx.strokeRect(rx, ry, bw * w, bh * h);
      }

      // Glowing dot
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
      grad.addColorStop(0, 'rgba(0,255,80,0.95)');
      grad.addColorStop(1, 'rgba(0,255,80,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fill();

      // Label pill
      const text  = `${det.label} ${Math.round((det.confidence ?? 0) * 100)}%`;
      ctx.font     = 'bold 13px sans-serif';
      const tw    = ctx.measureText(text).width;
      const px    = cx + 14;
      const py    = cy - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(px, py, tw + 10, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#00ff50';
      ctx.fillText(text, px + 5, py + 14);
    }

    if (this._overlayTex) this._overlayTex.needsUpdate = true;
  }
}
