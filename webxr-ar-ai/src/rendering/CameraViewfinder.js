/**
 * CameraViewfinder — world-space camera preview plane.
 *
 * Creates a flat plane anchored 40 cm in front of the viewer's head.
 * A second overlay plane carries a CanvasTexture for 2D bounding-box drawing.
 *
 * Video binding is re-evaluated every frame: IWSDK's CameraSystem stops the
 * camera (and disposes its texture) whenever the XR session ends and restarts
 * it on re-entry, so the viewfinder must re-bind rather than cache.
 *
 * Texture upload throttling: a VideoTexture re-uploads 1280×720 every render
 * frame (90 Hz). When `requestVideoFrameCallback` is available, the
 * viewfinder owns a plain Texture and marks it dirty per *video* frame
 * (30 Hz) instead — a 3× cut in texture-upload bandwidth.
 *
 * Usage:
 *   const vf = new CameraViewfinder(world);
 *   vf.init(cameraEntity);          // sync — builds the planes
 *   vf.setOverlayData(detections);  // call each capture
 *   vf.update();                    // call every frame (binds video, redraws)
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
    this.world         = world;
    this._cameraEntity = null;
    this._group        = null;
    this._videoMat     = null;
    this._overlayCtx   = null;
    this._overlayTex   = null;
    this._detections   = [];
    this._dirty        = false;
    this._boundVideo   = null;
    this._ownTexture   = null;
    this._rvfcId       = 0;
  }

  /**
   * Build the viewfinder + overlay planes and attach them to the camera.
   * Video binding happens lazily in update() once the camera is streaming.
   * @param {import('@iwsdk/core').Entity} cameraEntity  entity with CameraSource
   */
  init(cameraEntity) {
    this._cameraEntity = cameraEntity;

    const aspect = 16 / 9;
    const planeH = PLANE_WIDTH / aspect;

    // ── Video plane ──────────────────────────────────────────────────────
    this._videoMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.4, depthTest: false,
    });
    const videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, planeH), this._videoMat);
    videoMesh.renderOrder = 1;

    // ── Overlay canvas ────────────────────────────────────────────────────
    const ow = 512;
    const oh = Math.round(512 / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    this._overlayCtx = canvas.getContext('2d');
    this._overlayTex = new THREE.CanvasTexture(canvas);
    this._overlayTex.generateMipmaps = false;
    this._overlayTex.minFilter = THREE.LinearFilter;

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

  /** Call every frame — rebinds video if needed, redraws overlay if dirty. */
  update() {
    this._bindVideo();
    if (this._dirty && this._overlayCtx) {
      this._dirty = false;
      this._redraw();
    }
  }

  /** Release video binding (e.g. on dispose). */
  unbind() {
    if (this._boundVideo && this._rvfcId && this._boundVideo.cancelVideoFrameCallback) {
      this._boundVideo.cancelVideoFrameCallback(this._rvfcId);
    }
    this._rvfcId = 0;
    this._boundVideo = null;
    if (this._ownTexture) {
      this._ownTexture.dispose();
      this._ownTexture = null;
    }
    if (this._videoMat) {
      this._videoMat.map = null;
      this._videoMat.needsUpdate = true;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _bindVideo() {
    if (!this._videoMat || !this._cameraEntity) return;
    const videoEl = this._cameraEntity.getValue(CameraSource, 'videoElement');
    if (videoEl === this._boundVideo) return;

    this.unbind();
    if (!videoEl) return;
    this._boundVideo = videoEl;

    if (typeof videoEl.requestVideoFrameCallback === 'function') {
      // Own texture, uploaded once per video frame instead of per render frame.
      const tex = new THREE.Texture(videoEl);
      tex.colorSpace      = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter       = THREE.LinearFilter;
      tex.magFilter       = THREE.LinearFilter;
      this._ownTexture = tex;
      const onFrame = () => {
        tex.needsUpdate = true;
        if (this._boundVideo === videoEl) {
          this._rvfcId = videoEl.requestVideoFrameCallback(onFrame);
        }
      };
      this._rvfcId = videoEl.requestVideoFrameCallback(onFrame);
      this._applyMap(tex);
    } else {
      // Fall back to IWSDK's managed VideoTexture (per-render-frame upload).
      const tex = this._cameraEntity.getValue(CameraSource, 'texture')
               ?? new THREE.VideoTexture(videoEl);
      this._applyMap(tex);
    }
  }

  _applyMap(tex) {
    this._videoMat.map = tex;
    this._videoMat.color.set(0xffffff);
    this._videoMat.opacity = 1;
    this._videoMat.needsUpdate = true;
  }

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
