/**
 * SpatialPin — a single spatially-anchored observation.
 *
 * Written by both Pipeline A (MetaScene) and Pipeline B (CvServer).
 */

export const PinSource = Object.freeze({
  CvServer:  'CvServer',
  MetaScene: 'MetaScene',
});

let _seq = 0;

export class SpatialPin {
  constructor() {
    /** @type {string} */
    this.id = `pin-${++_seq}-${Date.now()}`;

    // ── Source ──────────────────────────────────────────────────────────────
    /** @type {'CvServer'|'MetaScene'} */
    this.source = PinSource.CvServer;
    /** @type {string} */
    this.label = '';

    // ── Pose ────────────────────────────────────────────────────────────────
    /** @type {{x:number,y:number,z:number}} */
    this.worldPosition = { x: 0, y: 0, z: 0 };
    /** @type {{x:number,y:number,z:number,w:number}} */
    this.worldRotation = { x: 0, y: 0, z: 0, w: 1 };

    // ── Detection metadata ───────────────────────────────────────────────────
    /** @type {number} */
    this.confidence = 0;
    /** @type {number[]|null} normalised [cx,cy,w,h] */
    this.bboxCxCyWH = null;
    /** @type {string} 'plane'|'mesh'|'fallback' */
    this.hitType = 'fallback';
    /** @type {number} */
    this.placementConfidence = 1;

    // ── Tracking ─────────────────────────────────────────────────────────────
    /** @type {string|null} */
    this.trackId = null;
    /** @type {number} */
    this.captureFrameIndex = 0;

    // ── Session ──────────────────────────────────────────────────────────────
    /** @type {string} */
    this.captureId = '';
    /** @type {string} */
    this.captureSessionId = '';

    // ── Pipeline A extras ────────────────────────────────────────────────────
    /** @type {string[]|null} e.g. ['FLOOR','HORIZONTAL_PLANE'] */
    this.semanticLabels = null;
    /** @type {{center:{x,y,z},size:{x,y,z}}|null} */
    this.planeExtents = null;
    /** @type {{center:{x,y,z},size:{x,y,z}}|null} */
    this.volumeExtents = null;

    // ── Pipeline B extras ────────────────────────────────────────────────────
    /** @type {string|null} SAM2 RLE JSON */
    this.maskRleJson = null;
    /** @type {string|null} Florence caption */
    this.florenceCaption = null;

    /** @type {number} Unix ms */
    this.createdAt = Date.now();
  }
}
