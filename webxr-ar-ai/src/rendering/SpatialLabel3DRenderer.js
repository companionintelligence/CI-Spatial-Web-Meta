/**
 * SpatialLabel3DRenderer — manages persistent 3D label meshes for SpatialPins.
 *
 * Creates a group (disc + billboarded text label) for each pin.
 * Respects DisplayMode: shown only when mode is SpatialLabel3D or Both.
 * Labels persist across captures; pins replaced via mergeByTrackId are moved.
 *
 * Usage:
 *   const renderer = new SpatialLabel3DRenderer(world, pinManager);
 *   renderer.setDisplayMode(appState.displayMode); // call when mode changes
 *   renderer.update();  // call every frame to billboard labels
 */

import * as THREE from 'three';
import { DisplayMode } from '../app/AppState.js';
import { PinSource } from '../spatial/SpatialPin.js';

// Colour coding by source
const PIN_COLOR = {
  [PinSource.CvServer]:  0x00ff50,   // green
  [PinSource.MetaScene]: 0x5599ff,   // blue
};

export class SpatialLabel3DRenderer {
  /**
   * @param {import('@iwsdk/core').World} world
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
   */
  constructor(world, pinManager) {
    this.world      = world;
    this.pinManager = pinManager;
    this._meshMap   = new Map();   // pinId → THREE.Group
    this._visible   = true;
    this._headPos   = new THREE.Vector3();

    // Listen for pin store events
    pinManager.addEventListener('add',    e => this._onCreate(e.pin));
    pinManager.addEventListener('update', e => this._onUpdate(e.pin));
    pinManager.addEventListener('remove', e => this._onRemove(e.pinId));
    pinManager.addEventListener('clear',  () => this._onClearAll());
  }

  setDisplayMode(mode) {
    this._visible =
      mode === DisplayMode.SpatialLabel3D ||
      mode === DisplayMode.Both;
    this._meshMap.forEach(group => { group.visible = this._visible; });
  }

  /** Call every frame — billboards labels toward the camera. */
  update() {
    if (!this._visible) return;
    this.world.camera.getWorldPosition(this._headPos);
    this._meshMap.forEach(group => {
      const lbl = group.userData.labelMesh;
      if (lbl) lbl.lookAt(this._headPos);
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _onCreate(pin) {
    const group = _buildLabelGroup(pin, PIN_COLOR[pin.source] ?? 0xffffff);
    group.visible = this._visible;
    group.position.set(pin.worldPosition.x, pin.worldPosition.y, pin.worldPosition.z);

    const q = pin.worldRotation;
    group.quaternion.set(q.x, q.y, q.z, q.w);

    this.world.scene.add(group);
    this._meshMap.set(pin.id, group);
  }

  _onUpdate(pin) {
    const group = this._meshMap.get(pin.id);
    if (!group) return;
    group.position.set(pin.worldPosition.x, pin.worldPosition.y, pin.worldPosition.z);
    const q = pin.worldRotation;
    group.quaternion.set(q.x, q.y, q.z, q.w);
  }

  _onRemove(pinId) {
    const group = this._meshMap.get(pinId);
    if (group) {
      this.world.scene.remove(group);
      _disposeGroup(group);
      this._meshMap.delete(pinId);
    }
  }

  _onClearAll() {
    this._meshMap.forEach(group => {
      this.world.scene.remove(group);
      _disposeGroup(group);
    });
    this._meshMap.clear();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _buildLabelGroup(pin, color) {
  const group = new THREE.Group();
  group.name  = `spatial-label-${pin.id}`;

  // Disc marker
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.025, 20),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  group.add(disc);

  // Text label canvas
  const text     = pin.label;
  const subLabel = pin.source === PinSource.CvServer
    ? `${Math.round(pin.confidence * 100)}%`
    : (pin.semanticLabels?.[0] ?? pin.source);

  const canvas  = document.createElement('canvas');
  canvas.width  = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, 320, 80, 10);
  ctx.fill();
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.font      = 'bold 28px sans-serif';
  ctx.fillText(text, 12, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font      = '18px sans-serif';
  ctx.fillText(subLabel, 12, 64);

  const tex    = new THREE.CanvasTexture(canvas);
  const lblGeo = new THREE.PlaneGeometry(0.16, 0.04);
  const lblMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
  const lblMesh = new THREE.Mesh(lblGeo, lblMat);
  lblMesh.position.y = 0.05;
  lblMesh.renderOrder = 3;
  group.add(lblMesh);

  group.userData.labelMesh = lblMesh;
  return group;
}

function _disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
}
