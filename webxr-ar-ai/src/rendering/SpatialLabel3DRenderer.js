/**
 * SpatialLabel3DRenderer — manages persistent 3D label meshes for SpatialPins.
 *
 * Creates a group (disc + billboarded text label) for each pin.
 * Respects DisplayMode: shown only when mode is SpatialLabel3D or Both.
 * Labels persist across captures; pins replaced via mergeByTrackId are moved.
 *
 * Labels are parented under the scan anchor root when provided, so they
 * re-localize with the persistent anchor across sessions.
 *
 * GPU-cost notes (Quest 3 is tile-based — draw calls and texture uploads
 * dominate): disc geometry and per-color materials are shared across all
 * pins, and label canvas textures skip mipmap generation.
 *
 * Usage:
 *   const renderer = new SpatialLabel3DRenderer(world, pinManager, scanRoot);
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

// Shared across all pins — never disposed per pin.
const _discGeometry  = new THREE.CircleGeometry(0.025, 20);
const _labelGeometry = new THREE.PlaneGeometry(0.16, 0.04);
const _discMaterials = new Map();   // color → MeshBasicMaterial

function _discMaterial(color) {
  let mat = _discMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    _discMaterials.set(color, mat);
  }
  return mat;
}

export class SpatialLabel3DRenderer {
  /**
   * @param {import('@iwsdk/core').World} world
   * @param {import('../spatial/SpatialPinManager.js').SpatialPinManager} pinManager
   * @param {import('../spatial/ScanAnchorRoot.js').ScanAnchorRoot} [scanRoot]
   */
  constructor(world, pinManager, scanRoot = null) {
    this.world      = world;
    this.pinManager = pinManager;
    this._parent    = scanRoot?.labelsRoot ?? world.scene;
    this._meshMap   = new Map();   // pinId → THREE.Group
    this._visible   = true;
    this._headPos   = new THREE.Vector3();
    this._tmpVec    = new THREE.Vector3();
    this._tmpQuat   = new THREE.Quaternion();

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
    if (!this._visible || !this._meshMap.size) return;
    this.world.camera.getWorldPosition(this._headPos);
    this._meshMap.forEach(group => {
      const lbl = group.userData.labelMesh;
      if (lbl) lbl.lookAt(this._headPos);
    });
  }

  /**
   * Rebuild every label group from the pin store. Used after WebGL context
   * restore — the pin manager is the source of truth for visual state.
   */
  rebuildAll() {
    this._onClearAll();
    for (const pin of this.pinManager.pins) this._onCreate(pin);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _setTransform(group, pin) {
    // Pins store world-space poses; the group lives under the anchored scan
    // root, so convert into parent-local space.
    this._parent.updateWorldMatrix(true, false);
    this._tmpVec.set(pin.worldPosition.x, pin.worldPosition.y, pin.worldPosition.z);
    this._parent.worldToLocal(this._tmpVec);
    group.position.copy(this._tmpVec);

    const q = pin.worldRotation;
    this._tmpQuat.set(q.x, q.y, q.z, q.w);
    const parentQuat = new THREE.Quaternion();
    this._parent.getWorldQuaternion(parentQuat);
    group.quaternion.copy(parentQuat.invert().multiply(this._tmpQuat));
  }

  _onCreate(pin) {
    const group = _buildLabelGroup(pin, PIN_COLOR[pin.source] ?? 0xffffff);
    group.visible = this._visible;
    this._setTransform(group, pin);
    this._parent.add(group);
    this._meshMap.set(pin.id, group);
  }

  _onUpdate(pin) {
    const group = this._meshMap.get(pin.id);
    if (!group) return;
    this._setTransform(group, pin);
  }

  _onRemove(pinId) {
    const group = this._meshMap.get(pinId);
    if (group) {
      this._parent.remove(group);
      _disposeGroup(group);
      this._meshMap.delete(pinId);
    }
  }

  _onClearAll() {
    this._meshMap.forEach(group => {
      this._parent.remove(group);
      _disposeGroup(group);
    });
    this._meshMap.clear();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _buildLabelGroup(pin, color) {
  const group = new THREE.Group();
  group.name  = `spatial-label-${pin.id}`;

  // Disc marker — shared geometry + material
  const disc = new THREE.Mesh(_discGeometry, _discMaterial(color));
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

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;

  const lblMat  = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
  const lblMesh = new THREE.Mesh(_labelGeometry, lblMat);
  lblMesh.position.y = 0.05;
  lblMesh.renderOrder = 3;
  group.add(lblMesh);

  group.userData.labelMesh = lblMesh;
  return group;
}

function _disposeGroup(group) {
  // Only per-pin resources (label texture + material) are disposed; disc
  // geometry/materials and label geometry are shared across all pins.
  const lbl = group.userData.labelMesh;
  if (lbl) {
    if (lbl.material.map) lbl.material.map.dispose();
    lbl.material.dispose();
  }
}
