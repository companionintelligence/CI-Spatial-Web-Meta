/**
 * The capture privacy policy: camera opt-in, the recording indicator, and no microphone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMERA_DEFAULT_ON,
  MICROPHONE_REQUESTED,
  assertNoAudio,
  cameraToggleLabel,
  recordingIndicator,
} from '../../src/privacy/capturePolicy.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.js') ? [path] : [];
  });
}

/** Source text with comments removed, so the rule checks code, not prose. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('camera and microphone defaults', () => {
  it('starts with the camera off and never requests a microphone', () => {
    expect(CAMERA_DEFAULT_ON).toBe(false);
    expect(MICROPHONE_REQUESTED).toBe(false);
  });

  it('no source file asks for audio or builds an audio constraint', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      const text = code(readFileSync(file, 'utf8'));
      if (/\baudio\s*:\s*(true|\{|1)/.test(text) || /getUserMedia\(\s*\{[^}]*\baudio\b/.test(text)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('refuses media constraints that ask for audio', () => {
    expect(() => assertNoAudio({ video: true, audio: true })).toThrow(/never records audio/);
    expect(assertNoAudio({ video: { width: 1280 } })).toEqual({ video: { width: 1280 } });
  });
});

describe('recording indicator', () => {
  it('reads as off, in the muted role, while the camera is off', () => {
    expect(recordingIndicator({ cameraOn: false })).toEqual({ active: false, text: 'Camera off', level: 'muted' });
  });

  it('reads as REC, in the alert role, and names where the frames go while it is on', () => {
    expect(recordingIndicator({ cameraOn: true, destination: '192.168.1.20:8081' })).toEqual({
      active: true,
      text: 'REC camera · frames go to 192.168.1.20:8081',
      level: 'alert',
    });
  });

  it('labels the control for the action it will take', () => {
    expect(cameraToggleLabel(false)).toBe('Turn camera on');
    expect(cameraToggleLabel(true)).toBe('Turn camera off');
  });
});
