/**
 * Unit tests for the Quest app launch: the `?source=quest-app` marker, the rule for
 * entering AR on load, and starting the session with the world's own settings. The
 * session helpers are IWSDK's real ones (dist/init/xr.js has no imports), so the
 * request matches what `world.launchXR()` would send.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  QUEST_APP_SOURCE,
  describeArError,
  detectQuestApp,
  shouldEnterArOnLoad,
} from '../../src/app/questApp.js';

vi.mock('@iwsdk/core', async () => import('@iwsdk/core/dist/init/xr.js'));

const { startArSession } = await import('../../src/app/arSession.js');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

function fakeWindow(search = '', hash = '') {
  return {
    location: { pathname: '/', search, hash },
    history: { replaceState: vi.fn() },
  };
}

describe('detectQuestApp', () => {
  it('recognises the launch URL of the Quest app and remembers it for the tab', () => {
    const win = fakeWindow(`?source=${QUEST_APP_SOURCE}`);
    const storage = memoryStorage();
    expect(detectQuestApp({ win, storage })).toBe(true);
    expect(storage._map.get('companionScan.questApp')).toBe('1');
  });

  it('takes the marker out of the address bar and keeps any other parameter', () => {
    const win = fakeWindow('?server=https%3A%2F%2Fcv.example&source=quest-app', '#x');
    detectQuestApp({ win, storage: memoryStorage() });
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/?server=https%3A%2F%2Fcv.example#x');
  });

  it('stays the app after a reload inside the app, which has no marker', () => {
    const storage = memoryStorage({ 'companionScan.questApp': '1' });
    expect(detectQuestApp({ win: fakeWindow(''), storage })).toBe(true);
  });

  it('is a browser tab without the marker, and leaves the address alone', () => {
    const win = fakeWindow('?source=newsletter');
    expect(detectQuestApp({ win, storage: memoryStorage() })).toBe(false);
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  it('still honours the marker when storage cannot be written or read', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(detectQuestApp({ win: fakeWindow('?source=quest-app'), storage: broken })).toBe(true);
    expect(detectQuestApp({ win: fakeWindow(''), storage: broken })).toBe(false);
  });

  it('is false where there is no window', () => {
    expect(detectQuestApp({ win: undefined, storage: memoryStorage() })).toBe(false);
  });
});

describe('shouldEnterArOnLoad', () => {
  it('enters AR in the Quest app where immersive-ar is supported', () => {
    expect(shouldEnterArOnLoad({ questApp: true, arSupported: true, signInReturn: false })).toBe(true);
  });

  it('never enters AR by itself in a browser tab', () => {
    expect(shouldEnterArOnLoad({ questApp: false, arSupported: true, signInReturn: false })).toBe(false);
  });

  it('waits when immersive-ar is not supported', () => {
    expect(shouldEnterArOnLoad({ questApp: true, arSupported: false, signInReturn: false })).toBe(false);
  });

  it('shows the panel first on a load that finishes a sign-in', () => {
    expect(shouldEnterArOnLoad({ questApp: true, arSupported: true, signInReturn: true })).toBe(false);
  });
});

/** A fake XRSession that accepts the reference space types listed. */
function fakeSession(supported = ['local-floor']) {
  const listeners = new Map();
  return {
    requestReferenceSpace: vi.fn(async (type) => {
      if (!supported.includes(type)) throw new DOMException(`${type} unsupported`, 'NotSupportedError');
      return { type };
    }),
    addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name) => listeners.delete(name)),
    end: vi.fn(async () => listeners.get('end')?.()),
    fire: (name) => listeners.get(name)?.(),
  };
}

function fakeWorld() {
  return {
    session: undefined,
    xrDefaults: {
      sessionMode: 'immersive-ar',
      referenceSpace: 'local-floor',
      features: { planeDetection: true, meshDetection: true, anchors: true },
    },
    renderer: {
      xr: {
        setReferenceSpaceType: vi.fn(),
        setSession: vi.fn(async () => {}),
      },
    },
  };
}

describe('startArSession', () => {
  it('requests immersive-ar with the scene features the app is created with', async () => {
    const world = fakeWorld();
    const session = fakeSession();
    const xr = { requestSession: vi.fn(async () => session) };

    await expect(startArSession(world, xr)).resolves.toBe(session);

    const [mode, init] = xr.requestSession.mock.calls[0];
    expect(mode).toBe('immersive-ar');
    expect(init.optionalFeatures).toEqual(
      expect.arrayContaining(['local-floor', 'plane-detection', 'mesh-detection', 'anchors']),
    );
    expect(world.renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local-floor');
    expect(world.renderer.xr.setSession).toHaveBeenCalledWith(session);
    expect(world.renderer.xr.getDepthSensingMesh()).toBeNull();
    expect(world.session).toBe(session);
  });

  it('falls back to the local reference space when local-floor is refused', async () => {
    const world = fakeWorld();
    const xr = { requestSession: vi.fn(async () => fakeSession(['local'])) };
    await startArSession(world, xr);
    expect(world.renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local');
  });

  it('ends the session and reports the error when no reference space can be had', async () => {
    const world = fakeWorld();
    const session = fakeSession([]);
    const xr = { requestSession: vi.fn(async () => session) };
    await expect(startArSession(world, xr)).rejects.toThrow(/reference space/);
    expect(session.end).toHaveBeenCalled();
    expect(world.session).toBeUndefined();
    expect(world.renderer.xr.setSession).not.toHaveBeenCalled();
  });

  it('passes a refused request on to the caller', async () => {
    const xr = { requestSession: vi.fn(async () => { throw new DOMException('no gesture', 'NotAllowedError'); }) };
    await expect(startArSession(fakeWorld(), xr)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('forgets the session when it ends', async () => {
    const world = fakeWorld();
    const session = fakeSession();
    await startArSession(world, { requestSession: async () => session });
    session.fire('end');
    expect(world.session).toBeUndefined();
  });

  it('returns the running session instead of asking for a second one', async () => {
    const world = fakeWorld();
    world.session = { running: true };
    const xr = { requestSession: vi.fn() };
    await expect(startArSession(world, xr)).resolves.toBe(world.session);
    expect(xr.requestSession).not.toHaveBeenCalled();
  });

  it('says so when the browser has no WebXR', async () => {
    await expect(startArSession(fakeWorld(), undefined)).rejects.toThrow(/WebXR is not available/);
  });
});

describe('describeArError', () => {
  it('turns a refused request into an instruction', () => {
    expect(describeArError(new DOMException('x', 'NotAllowedError'))).toMatch(/Press Enter AR/);
    expect(describeArError(new DOMException('x', 'SecurityError'))).toMatch(/Press Enter AR/);
  });

  it('names an unsupported device and a session already running', () => {
    expect(describeArError(new DOMException('x', 'NotSupportedError'))).toMatch(/cannot start an AR session/);
    expect(describeArError(new DOMException('x', 'InvalidStateError'))).toMatch(/already running/);
  });

  it('falls back to the error message', () => {
    expect(describeArError(new Error('boom'))).toBe('AR did not start: boom');
  });
});
