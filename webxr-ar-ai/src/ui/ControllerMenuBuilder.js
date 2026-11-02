/**
 * ControllerMenuBuilder — attaches coloured circle indicators + text labels
 * to the physical controller grip spaces at runtime.
 *
 * Controller indicators:
 *   Right A → Red    disc + "Capture"
 *   Right B → Blue   disc + "Cycle Model"
 *   Left  X → Yellow disc + "Preview Dist"
 *   Left  Y → Green  disc + "Save & Export"
 *   Index Trigger (both) → Orange disc + "Display Mode"
 *
 * Uses world.input.xrOrigin.gripSpaces to attach to controllers.
 */

import * as THREE from 'three';
import { FONT_STACK, XR_SCHEME, canonColor, threeColor, withAlpha } from './theme.js';

/**
 * Each button's disc is a step on the canon level scale (red → orange → gold →
 * green → blue), so the legend uses named canon hues rather than literals.
 */
const INDICATORS = {
  right: [
    { label: 'Capture',      role: 'level-red',    offset: [  0.01,  0.01, -0.04 ] },   // A
    { label: 'Cycle Model',  role: 'level-blue',   offset: [ -0.01,  0.01, -0.04 ] },   // B
    { label: 'Display Mode', role: 'level-orange', offset: [  0,    -0.01, -0.04 ] },   // Trigger
  ],
  left: [
    { label: 'Preview Dist', role: 'level-gold',   offset: [  0.01,  0.01, -0.04 ] },   // X
    { label: 'Save & Export',role: 'level-green',  offset: [ -0.01,  0.01, -0.04 ] },   // Y
    { label: 'Display Mode', role: 'level-orange', offset: [  0,    -0.01, -0.04 ] },   // Trigger
  ],
};

/**
 * Build controller indicators on both grip spaces. Safe to call repeatedly —
 * grip spaces appear asynchronously after session start, and each hand is
 * only built once.
 *
 * @param {import('@iwsdk/core').World} world
 * @returns {boolean} true once both hands have indicators
 */
export function buildControllerMenu(world) {
  const origin = world.input?.xrOrigin;
  if (!origin) return false;

  let built = 0;
  for (const [hand, items] of Object.entries(INDICATORS)) {
    const grip = origin.gripSpaces[hand];
    if (!grip) continue;

    if (!grip.userData.companionMenuBuilt) {
      grip.userData.companionMenuBuilt = true;
      for (const item of items) {
        const group = _makeIndicator(item.label, threeColor(item.role, XR_SCHEME), item.offset);
        grip.add(group);
      }
    }
    built++;
  }
  return built === Object.keys(INDICATORS).length;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _makeIndicator(label, color, offset) {
  const group = new THREE.Group();
  group.position.set(...offset);

  // Glowing disc
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.006, 16),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  group.add(disc);

  // Canvas label
  const canvas  = document.createElement('canvas');
  canvas.width  = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = withAlpha(canonColor('background', XR_SCHEME), 0.7);
  ctx.beginPath();
  ctx.roundRect(0, 0, 256, 48, 6);
  ctx.fill();
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.font      = `700 18px ${FONT_STACK}`;
  ctx.fillText(label, 8, 32);

  const tex  = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.012),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  mesh.position.set(0.04, 0, 0);
  mesh.renderOrder = 5;
  group.add(mesh);

  return group;
}
