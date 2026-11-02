/**
 * Unit tests for ServerConnection — where the app finds its CV server and its memory
 * server, the static token sent to the CV server, and the ?server= / ?token= quick
 * connect. Sign-in with Companion Intelligence is covered in PortalSession.test.js.
 *
 * localStorage and window are stubbed (vitest runs this suite in the Node environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function makeStorage() {
  const map = new Map();
  return {
    getItem:    (k) => (map.has(k) ? map.get(k) : null),
    setItem:    (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function makeWindow(search = '') {
  return {
    location: {
      search,
      pathname: '/',
      origin: 'https://meta.ci.computer',
      assign: vi.fn(),
    },
    history: { replaceState: vi.fn() },
  };
}

let ServerConnection;
let win;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', makeStorage());
  win = makeWindow();
  vi.stubGlobal('window', win);
  ServerConnection = await import('../../src/net/ServerConnection.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ServerConnection — CV server URL', () => {
  it('defaults to empty string (same-origin)', () => {
    expect(ServerConnection.getServerUrl()).toBe('');
  });

  it('round-trips a saved URL and strips trailing slashes', () => {
    ServerConnection.setServerUrl('https://my-box.example.com//');
    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
  });

  it('trims whitespace around a pasted address', () => {
    ServerConnection.setServerUrl('  https://my-box.example.com  ');
    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
  });

  it('clears the stored URL when set to an empty string', () => {
    ServerConnection.setServerUrl('https://my-box.example.com');
    ServerConnection.setServerUrl('');
    expect(ServerConnection.getServerUrl()).toBe('');
  });

  it('falls back to VITE_CV_BASE_URL when nothing is stored', () => {
    vi.stubEnv('VITE_CV_BASE_URL', 'https://default.example.com');
    expect(ServerConnection.getServerUrl()).toBe('https://default.example.com');
  });
});

describe('ServerConnection — server URL validation', () => {
  it('rejects anything that is not an http(s) address', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://files.example.com', 'not a url', 'data:text/plain,hi']) {
      expect(() => ServerConnection.setServerUrl(bad)).toThrow(TypeError);
    }
    expect(ServerConnection.getServerUrl()).toBe('');
  });

  it('keeps the saved server when a new address is rejected', () => {
    ServerConnection.setServerUrl('https://a.example.com');
    expect(() => ServerConnection.setServerUrl('ftp://files.example.com')).toThrow(TypeError);
    expect(ServerConnection.getServerUrl()).toBe('https://a.example.com');
  });

  it('accepts http and https addresses', () => {
    expect(ServerConnection.setServerUrl('http://192.168.1.50:8000')).toBe('http://192.168.1.50:8000');
    expect(ServerConnection.setServerUrl('https://ci.example.com')).toBe('https://ci.example.com');
  });
});

describe('ServerConnection — static token / auth header', () => {
  it('has no token and reports disconnected by default', () => {
    expect(ServerConnection.getToken()).toBeNull();
    expect(ServerConnection.isConnected()).toBe(false);
    expect(ServerConnection.getAuthHeader()).toEqual({});
  });

  it('stores a token and reports connected', () => {
    ServerConnection.setToken('abc123');
    expect(ServerConnection.isConnected()).toBe(true);
    expect(ServerConnection.getAuthHeader()).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('clears the token when set to a falsy value', () => {
    ServerConnection.setToken('abc123');
    ServerConnection.setToken('');
    expect(ServerConnection.getToken()).toBeNull();
  });

  it('disconnect clears the token but keeps the server URL', () => {
    ServerConnection.setServerUrl('https://my-box.example.com');
    ServerConnection.setToken('abc123');
    ServerConnection.disconnect();
    expect(ServerConnection.isConnected()).toBe(false);
    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
  });
});

describe('ServerConnection — a token belongs to its server', () => {
  it('does not send a token to a different server', () => {
    ServerConnection.setServerUrl('https://a.example.com');
    ServerConnection.setToken('secret-a');
    ServerConnection.setServerUrl('https://b.example.com');
    expect(ServerConnection.getToken()).toBeNull();
    expect(ServerConnection.getAuthHeader()).toEqual({});
  });

  it('forgets the token when the server changes, so switching back does not revive it', () => {
    ServerConnection.setServerUrl('https://a.example.com');
    ServerConnection.setToken('secret-a');
    ServerConnection.setServerUrl('https://b.example.com');
    ServerConnection.setServerUrl('https://a.example.com');
    expect(ServerConnection.getToken()).toBeNull();
  });

  it('keeps the token when the same server is saved again with a trailing slash', () => {
    ServerConnection.setServerUrl('https://a.example.com');
    ServerConnection.setToken('secret-a');
    ServerConnection.setServerUrl('https://a.example.com/');
    expect(ServerConnection.getToken()).toBe('secret-a');
  });

  it('binds a token to the page origin when no server is saved', () => {
    ServerConnection.setToken('local-token');
    expect(ServerConnection.getToken()).toBe('local-token');
    ServerConnection.setServerUrl('https://elsewhere.example.com');
    expect(ServerConnection.getToken()).toBeNull();
  });

  it('does not use a token issued for a saved server against the page origin', () => {
    ServerConnection.setServerUrl('https://a.example.com');
    ServerConnection.setToken('secret-a');
    ServerConnection.setServerUrl('');
    expect(ServerConnection.getToken()).toBeNull();
  });

  it('ignores a token stored before origins were recorded', () => {
    localStorage.setItem('companionScan.serverToken', 'legacy-token');
    expect(ServerConnection.getToken()).toBeNull();
  });

  it('sends no token when the saved server address cannot be read', () => {
    win.location.origin = '';
    ServerConnection.setToken('x');
    localStorage.setItem('companionScan.serverUrl', 'not a url');
    expect(ServerConnection.getToken()).toBeNull();
  });
});

describe('ServerConnection — memory server', () => {
  it('defaults to empty', () => {
    expect(ServerConnection.getMemoryUrl()).toBe('');
  });

  it('round-trips a saved memory URL and strips trailing slashes', () => {
    expect(ServerConnection.setMemoryUrl('https://memory.example.com/')).toBe('https://memory.example.com');
    expect(ServerConnection.getMemoryUrl()).toBe('https://memory.example.com');
  });

  it('clears the memory URL when set to an empty string', () => {
    ServerConnection.setMemoryUrl('https://memory.example.com');
    ServerConnection.setMemoryUrl('');
    expect(ServerConnection.getMemoryUrl()).toBe('');
  });

  it('rejects a memory address that is not http(s) and keeps the saved one', () => {
    ServerConnection.setMemoryUrl('https://memory.example.com');
    expect(() => ServerConnection.setMemoryUrl('javascript:alert(1)')).toThrow(TypeError);
    expect(ServerConnection.getMemoryUrl()).toBe('https://memory.example.com');
  });

  it('is not moved by a change of CV server', () => {
    ServerConnection.setMemoryUrl('https://memory.example.com');
    ServerConnection.setServerUrl('https://cv.example.com');
    expect(ServerConnection.getMemoryUrl()).toBe('https://memory.example.com');
  });

  it('is not a credential, so disconnect keeps it', () => {
    ServerConnection.setMemoryUrl('https://memory.example.com');
    ServerConnection.setToken('abc123');
    ServerConnection.disconnect();
    expect(ServerConnection.getMemoryUrl()).toBe('https://memory.example.com');
  });
});

describe('ServerConnection — currentServerOrigin', () => {
  it('is the page origin when no CV server is saved', () => {
    expect(ServerConnection.currentServerOrigin()).toBe('https://meta.ci.computer');
  });

  it('is the origin of the saved CV server, whatever its path', () => {
    ServerConnection.setServerUrl('https://cv.example.com/base');
    expect(ServerConnection.currentServerOrigin()).toBe('https://cv.example.com');
  });
});

describe('ServerConnection — ?server= and ?token= quick connect', () => {
  it('saves ?server= and ?token= and scrubs them from the URL', () => {
    win.location.search = '?server=https://my-box.example.com&token=xyz&keep=1';

    const applied = ServerConnection.applyUrlParams();

    expect(applied).toEqual({ serverSet: 'https://my-box.example.com', tokenSet: true });
    expect(ServerConnection.getServerUrl()).toBe('https://my-box.example.com');
    expect(ServerConnection.getToken()).toBe('xyz');
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/?keep=1');
  });

  it('drops the token saved for the old server when ?server= points elsewhere', () => {
    ServerConnection.setServerUrl('https://a.example.com');
    ServerConnection.setToken('secret-a');
    win.location.search = '?server=https://evil.example.com';

    const applied = ServerConnection.applyUrlParams();

    expect(applied).toEqual({ serverSet: 'https://evil.example.com', tokenSet: false });
    expect(ServerConnection.getToken()).toBeNull();
  });

  it('applies a token from the same link to the server that link names', () => {
    win.location.search = '?server=https://ci.example.com&token=link-token';

    const applied = ServerConnection.applyUrlParams();

    expect(applied).toEqual({ serverSet: 'https://ci.example.com', tokenSet: true });
    expect(ServerConnection.getAuthHeader()).toEqual({ Authorization: 'Bearer link-token' });
  });

  it('ignores an invalid ?server= but still scrubs it from the address bar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    win.location.search = '?server=javascript:alert(1)&keep=1';

    const applied = ServerConnection.applyUrlParams();

    expect(applied.serverSet).toBeNull();
    expect(ServerConnection.getServerUrl()).toBe('');
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/?keep=1');
    warn.mockRestore();
  });

  it('does nothing when there are no relevant params', () => {
    win.location.search = '?keep=1';

    expect(ServerConnection.applyUrlParams()).toEqual({ serverSet: null, tokenSet: false });
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  it('reports nothing applied when the address has no query', () => {
    win.location.search = '';
    expect(ServerConnection.applyUrlParams()).toEqual({ serverSet: null, tokenSet: false });
  });
});
