/**
 * Unit tests for SceneRaycaster — local world-space raycasts against
 * scene-understanding geometry. Uses real three.js meshes.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SceneRaycaster, collectRaycastTargets } from '../../src/pipeline/SceneRaycaster.js';

function wall(z, { hitType = 'mesh', size = 10 } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld(true);
  return { object: mesh, hitType };
}

const ORIGIN  = new THREE.Vector3(0, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

describe('SceneRaycaster', () => {
  it('returns the hit point and type for a struck surface', () => {
    const rc = new SceneRaycaster();
    const hit = rc.raycast(ORIGIN, FORWARD, [wall(-2, { hitType: 'plane' })]);

    expect(hit).not.toBeNull();
    expect(hit.hitType).toBe('plane');
    expect(hit.point.z).toBeCloseTo(-2, 5);
    expect(hit.distance).toBeCloseTo(2, 5);
  });

  it('returns the closest hit across multiple targets', () => {
    const rc = new SceneRaycaster();
    const hit = rc.raycast(ORIGIN, FORWARD, [
      wall(-5, { hitType: 'mesh' }),
      wall(-1.5, { hitType: 'plane' }),
      wall(-3, { hitType: 'mesh' }),
    ]);

    expect(hit.hitType).toBe('plane');
    expect(hit.distance).toBeCloseTo(1.5, 5);
  });

  it('returns null when nothing is hit', () => {
    const rc = new SceneRaycaster();
    expect(rc.raycast(ORIGIN, FORWARD, [wall(5)])).toBeNull();   // behind the ray
    expect(rc.raycast(ORIGIN, FORWARD, [])).toBeNull();
    expect(rc.raycast(ORIGIN, FORWARD, null)).toBeNull();
  });

  it('respects maxDistance', () => {
    const rc = new SceneRaycaster();
    expect(rc.raycast(ORIGIN, FORWARD, [wall(-8)], 5)).toBeNull();
    expect(rc.raycast(ORIGIN, FORWARD, [wall(-4)], 5)).not.toBeNull();
  });

  it('hits backfaces (forces double-sided materials)', () => {
    // Plane at z=+2 faces +z; ray from origin toward +z strikes its back
    const rc = new SceneRaycaster();
    const target = wall(2);
    // flip so the front face points away from the ray
    target.object.rotation.y = Math.PI;
    target.object.updateMatrixWorld(true);

    const hit = rc.raycast(ORIGIN, new THREE.Vector3(0, 0, 1), [target]);
    expect(hit).not.toBeNull();
    expect(target.object.material.side).toBe(THREE.DoubleSide);
  });

  it('ignores hits closer than the near distance (own-head exclusion)', () => {
    const rc = new SceneRaycaster();
    expect(rc.raycast(ORIGIN, FORWARD, [wall(-0.01)])).toBeNull();
  });
});

describe('collectRaycastTargets', () => {
  it('tags plane and mesh entities and skips missing object3Ds', () => {
    const planeObj = new THREE.Object3D();
    const meshObj  = new THREE.Object3D();
    const targets = collectRaycastTargets(
      [{ object3D: planeObj }, { object3D: null }],
      [{ object3D: meshObj }],
    );

    expect(targets).toEqual([
      { object: planeObj, hitType: 'plane' },
      { object: meshObj,  hitType: 'mesh'  },
    ]);
  });
});
