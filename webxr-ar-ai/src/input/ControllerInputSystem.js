/**
 * ControllerInputSystem — IWSDK ECS system that reads StatefulGamepad events
 * and dispatches named actions.
 *
 * Button mapping (Quest 3):
 *   Right A (red)      → 'capture'
 *   Right B (blue)     → 'cycleModel'
 *   Left  X (yellow)   → 'cyclePreviewDistance'
 *   Left  Y (green)    → 'export'
 *   Either Trigger     → 'cycleDisplayMode'
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { appState } from '../app/AppState.js';

export class ControllerInputSystem extends createSystem({}) {
  init() {
    this._onCapture = null;
    this._onExport  = null;
  }

  /** @param {{ capture: Function, export: Function }} handlers */
  setHandlers({ capture, export: exportFn }) {
    this._onCapture = capture;
    this._onExport  = exportFn;
  }

  update(_delta, _time) {
    const { gamepads } = this.input;
    const right = gamepads.right;
    const left  = gamepads.left;

    if (right) {
      if (right.getButtonDown(InputComponent.A_Button)) this._onCapture?.();
      if (right.getButtonDown(InputComponent.B_Button)) appState.cycleModel();
    }

    if (left) {
      if (left.getButtonDown(InputComponent.X_Button)) appState.cyclePreviewDistance();
      if (left.getButtonDown(InputComponent.Y_Button)) this._onExport?.();
    }

    if (right?.getButtonDown(InputComponent.Trigger) ||
        left?.getButtonDown(InputComponent.Trigger)) {
      appState.cycleDisplayMode();
    }
  }
}
