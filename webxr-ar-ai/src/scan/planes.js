/**
 * The room's planes as contract records, and the short rows the headset and the overlay list.
 *
 * Input is the WebXR plane entities the scene-understanding query returns. The two
 * accessors are passed in, so this module does not import IWSDK and can be tested in Node.
 */

import { poseRecord, CAPTURE_LIMITS } from './payload.js';

const MAX_LABEL = 40;

/** @returns {'horizontal'|'vertical'|null} */
export function planeOrientation(plane) {
  if (plane?.orientation === 'horizontal' || plane?.orientation === 'vertical') return plane.orientation;
  return null;
}

/** The plane's name: its semantic label (floor, wall, ...), else its orientation. */
export function planeLabel(plane) {
  const raw = String(plane?.semanticLabel || plane?.orientation || 'plane').trim().toLowerCase();
  return (raw || 'plane').slice(0, MAX_LABEL);
}

/** Bounds of the plane polygon in plane-local metres (x and z). */
export function polygonExtents(polygon) {
  if (!polygon?.length) return { center: { x: 0, z: 0 }, size: { x: 0, z: 0 } };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
  }
  return {
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, z: maxZ - minZ },
  };
}

const r3 = (value) => Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;

/**
 * Contract plane records for the current scene, largest first.
 * @param {Iterable<object>} entities                  WebXR plane entities
 * @param {object} accessors
 * @param {(entity: object) => object|null} accessors.readPlane   the XRPlane data, or null
 * @param {(plane: object) => string} accessors.trackIdFor        a stable id per real surface
 * @returns {Array<object>} contract Plane records
 */
export function planeRecords(entities, { readPlane, trackIdFor } = {}) {
  const records = [];
  for (const entity of entities ?? []) {
    const plane = readPlane?.(entity);
    const object = entity?.object3D;
    if (!plane || !object) continue;
    const { center, size } = polygonExtents(plane.polygon);
    records.push({
      id: trackIdFor(plane),
      label: planeLabel(plane),
      orientation: planeOrientation(plane),
      pose: poseRecord(object.position, object.quaternion),
      center: { x: r3(center.x), z: r3(center.z) },
      size: { x: r3(size.x), z: r3(size.z) },
    });
    if (records.length >= CAPTURE_LIMITS.maxPlanes) break;
  }
  return records.sort((a, b) => (b.size.x * b.size.z) - (a.size.x * a.size.z));
}

/**
 * Short rows for the wrist panel and the overlay: "floor · 3.2 × 2.9 m".
 * @param {Array<object>} records
 * @param {number} [limit=8]
 * @returns {Array<{id: string, label: string, text: string}>}
 */
export function summarisePlanes(records, limit = 8) {
  return (records ?? []).slice(0, limit).map((plane) => ({
    id: plane.id,
    label: plane.label,
    text: `${plane.label} · ${plane.size.x.toFixed(1)} × ${plane.size.z.toFixed(1)} m`,
  }));
}

/**
 * A string that changes whenever the list of planes changes, so the UI redraws only then.
 * @param {Array<object>} records
 */
export function planesSignature(records) {
  return (records ?? []).map((p) => `${p.id}:${p.label}:${p.size.x}:${p.size.z}`).join('|');
}
