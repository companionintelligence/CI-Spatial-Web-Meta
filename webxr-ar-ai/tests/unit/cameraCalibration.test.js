/**
 * Unit tests for camera calibration — the passthrough camera HFOV used by
 * the pinhole model. Resolution order: ?hfov= URL override, then the value
 * saved on this device, then the default.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CAMERA_HFOV_DEG,
  LS_CAMERA_HFOV,
  parseHfovDeg,
  resolveCameraHfov,
  saveCameraHfov,
  clearCameraHfov,
} from '../../src/pipeline/cameraCalibration.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem:    (k) => (map.has(k) ? map.get(k) : null),
    setItem:    (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe('parseHfovDeg', () => {
  it('accepts numbers and numeric strings inside the range', () => {
    expect(parseHfovDeg(76)).toBe(76);
    expect(parseHfovDeg('75.5')).toBe(75.5);
  });

  it('rejects empty, non-numeric, non-finite and out-of-range values', () => {
    for (const v of [null, undefined, '', 'abc', 20, 160, 5, 400, NaN, Infinity]) {
      expect(parseHfovDeg(v)).toBeNull();
    }
  });
});

describe('resolveCameraHfov', () => {
  it('uses the default when nothing is set', () => {
    expect(resolveCameraHfov()).toEqual({ deg: DEFAULT_CAMERA_HFOV_DEG, source: 'default' });
  });

  it('uses the saved value when there is no URL override', () => {
    const storage = makeStorage({ [LS_CAMERA_HFOV]: '76' });
    expect(resolveCameraHfov({ storage })).toEqual({ deg: 76, source: 'saved' });
  });

  it('prefers ?hfov= over the saved value', () => {
    const storage = makeStorage({ [LS_CAMERA_HFOV]: '76' });
    expect(resolveCameraHfov({ search: '?hfov=72', storage })).toEqual({ deg: 72, source: 'url' });
  });

  it('ignores an invalid saved value and an invalid URL value', () => {
    const storage = makeStorage({ [LS_CAMERA_HFOV]: '999' });
    expect(resolveCameraHfov({ search: '?hfov=nope', storage }))
      .toEqual({ deg: DEFAULT_CAMERA_HFOV_DEG, source: 'default' });
  });

  it('treats unreadable storage as empty', () => {
    const storage = { getItem() { throw new Error('SecurityError'); } };
    expect(resolveCameraHfov({ storage }).source).toBe('default');
  });
});

describe('saveCameraHfov / clearCameraHfov', () => {
  it('saves a valid value and returns it as a number', () => {
    const storage = makeStorage();
    expect(saveCameraHfov('74', storage)).toBe(74);
    expect(storage._map.get(LS_CAMERA_HFOV)).toBe('74');
  });

  it('refuses out-of-range values without touching storage', () => {
    const storage = makeStorage();
    expect(() => saveCameraHfov(10, storage)).toThrow(RangeError);
    expect(storage._map.size).toBe(0);
  });

  it('clears the saved value so the default applies again', () => {
    const storage = makeStorage({ [LS_CAMERA_HFOV]: '74' });
    clearCameraHfov(storage);
    expect(resolveCameraHfov({ storage }).source).toBe('default');
  });
});
