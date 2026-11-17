/**
 * Capture privacy: the camera is off until someone turns it on, in this session.
 *
 * - The camera defaults to off on every page load, every headset session start and
 *   every session end. Nothing persists the choice, so a frame can never be captured
 *   by a setting someone forgot they had turned on.
 * - The microphone is never requested. The app has no audio path, and a test asserts
 *   that no audio constraint is ever built.
 * - While the camera is on, every surface says so: the wrist panel shows a red REC
 *   line, and the desktop overlay shows a REC pill with the server the frames go to.
 *
 * Pure functions only, so the policy is testable in Node.
 */

/** The camera's state when the app starts. Opt-in only. */
export const CAMERA_DEFAULT_ON = false;

/** The app never asks for a microphone. */
export const MICROPHONE_REQUESTED = false;

/**
 * The indicator text and colour role for the camera state.
 * @param {{cameraOn: boolean, destination?: string}} state
 *   destination: the host the frames are sent to (shown when on)
 * @returns {{active: boolean, text: string, level: 'muted'|'alert'}}
 */
export function recordingIndicator({ cameraOn, destination = '' }) {
  if (!cameraOn) return { active: false, text: 'Camera off', level: 'muted' };
  const to = destination ? ` · frames go to ${destination}` : '';
  return { active: true, text: `REC camera${to}`, level: 'alert' };
}

/**
 * The label for the camera control.
 * @param {boolean} cameraOn
 * @returns {string}
 */
export function cameraToggleLabel(cameraOn) {
  return cameraOn ? 'Turn camera off' : 'Turn camera on';
}

/**
 * Refuse any media constraint that asks for audio. Used before getUserMedia.
 * @param {MediaStreamConstraints} constraints
 * @returns {MediaStreamConstraints}
 * @throws {Error} when the constraints request audio
 */
export function assertNoAudio(constraints) {
  if (constraints && constraints.audio) {
    throw new Error('Companion Scan never records audio: audio constraints are refused.');
  }
  return constraints;
}
