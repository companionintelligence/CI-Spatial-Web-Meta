/**
 * Unit tests for the first-run model. It is pure, so nothing is stubbed: each test
 * gives it a state the Worker can return and checks what the user is told.
 */
import { describe, it, expect } from 'vitest';
import { FTUE_STEP, firstRunStatus, modelsLine } from '../../src/net/ftueModel.js';

const ONE_MODEL = { ok: true, models: [{ id: 'llama', vision: false }] };

/** One memory server, as the Worker's /api/discover describes it. */
function memory(name, url, { up = true, status = up ? 200 : 503, llm = ONE_MODEL } = {}) {
  return { name, url, health: { ok: up, status }, llm };
}

const discovered = (servers, portal = { ok: true, status: 200 }) => ({ portal, memory: servers });

describe('FTUE_STEP', () => {
  it('is frozen, with the three steps in order', () => {
    expect(Object.isFrozen(FTUE_STEP)).toBe(true);
    expect(Object.values(FTUE_STEP)).toEqual(['sign-in', 'find', 'ready']);
  });
});

describe('firstRunStatus — signing in', () => {
  it('asks for sign-in first, and says capture works without it', () => {
    const s = firstRunStatus({ signedIn: false });
    expect(s.step).toBe(FTUE_STEP.SIGN_IN);
    expect(s.tone).toBe('info');
    expect(s.title).toBe('Sign in with Companion Intelligence');
    expect(s.detail).toContain('Scene capture works without signing in');
    expect(s.memory).toBeNull();
  });

  it('greets the user by email, then by name, then falls back to a plain phrase', () => {
    expect(firstRunStatus({ signedIn: true, identity: { email: 'me@example.com', name: 'Me' } }).title)
      .toBe('Signed in as me@example.com');
    expect(firstRunStatus({ signedIn: true, identity: { name: 'Me' } }).title).toBe('Signed in as Me');
    expect(firstRunStatus({ signedIn: true }).title).toBe('Signed in as your account');
  });

  it('says the sign-in has expired when the Portal refused it, even after the session is cleared', () => {
    const s = firstRunStatus({ signedIn: false, discovery: discovered([], { ok: false, status: 401 }) });
    expect(s.step).toBe(FTUE_STEP.SIGN_IN);
    expect(s.tone).toBe('warn');
    expect(s.title).toBe('Sign in with Companion Intelligence');
    expect(s.detail).toBe('Your sign-in has expired. Sign in again.');
  });

  it('moves on to finding servers once signed in, before discovery has run', () => {
    const s = firstRunStatus({ signedIn: true, identity: { email: 'me@example.com' } });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('info');
    expect(s.memory).toBeNull();
  });
});

describe('firstRunStatus — what discovery found', () => {
  it('says discovery is not available when the Portal did not answer', () => {
    const s = firstRunStatus({ signedIn: true, discovery: discovered([], { ok: false, status: 502 }) });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('warn');
    expect(s.title).toBe('Memory discovery is not available yet');
    expect(s.detail).toContain('Scene capture still works');
  });

  it('asks for a fresh sign-in when the Portal refused the session', () => {
    const s = firstRunStatus({ signedIn: true, discovery: discovered([], { ok: false, status: 401 }) });
    expect(s.detail).toBe('Your sign-in has expired. Sign in again.');
  });

  it('says so when the account has no memory server', () => {
    const s = firstRunStatus({ signedIn: true, discovery: discovered([]) });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('warn');
    expect(s.title).toBe('No memory server on this account');
    expect(s.detail).toContain('Install Companion Memory from Companion Hub');
  });

  it('treats a listing that is not an array as no servers', () => {
    const s = firstRunStatus({ signedIn: true, discovery: { portal: { ok: true }, memory: null } });
    expect(s.title).toBe('No memory server on this account');
  });

  it('ignores a server with no address, since nothing can be connected to it', () => {
    const s = firstRunStatus({ signedIn: true, discovery: discovered([memory('Companion Memory', '')]) });
    expect(s.title).toBe('No memory server on this account');
  });

  it('says why a server was left out when its address is not secure', () => {
    const insecure = {
      name: 'Companion Memory',
      url: null,
      health: { ok: false, status: 0, reason: 'insecure_address' },
      llm: null,
    };
    const s = firstRunStatus({ signedIn: true, discovery: discovered([insecure]) });
    expect(s.tone).toBe('warn');
    expect(s.title).toBe('Companion Memory has an address this app cannot use');
    expect(s.detail).toContain('https://');
  });
});

describe('firstRunStatus — choosing a memory server', () => {
  it('is ready once the chosen server answers its health check', () => {
    const chosen = memory('Companion Memory', 'https://mem.example.com');
    const s = firstRunStatus({
      signedIn: true,
      discovery: discovered([chosen]),
      memoryUrl: 'https://mem.example.com',
    });
    expect(s.step).toBe(FTUE_STEP.READY);
    expect(s.tone).toBe('ok');
    expect(s.title).toBe('Using Companion Memory');
    expect(s.detail).toBe('1 language model.');
    expect(s.memory).toBe(chosen);
  });

  it('keeps the chosen server in view when it stops answering', () => {
    const chosen = memory('Companion Memory', 'https://mem.example.com', { up: false, status: 503 });
    const s = firstRunStatus({
      signedIn: true,
      discovery: discovered([chosen]),
      memoryUrl: 'https://mem.example.com',
    });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('warn');
    expect(s.title).toBe('Companion Memory is not responding');
    expect(s.detail).toBe('It answered with status 503. Find servers again later.');
    expect(s.memory).toBe(chosen);
  });

  it('says it did not answer when the chosen server gave no status', () => {
    const chosen = { name: 'Companion Memory', url: 'https://mem.example.com', health: { ok: false }, llm: ONE_MODEL };
    const s = firstRunStatus({ signedIn: true, discovery: discovered([chosen]), memoryUrl: 'https://mem.example.com' });
    expect(s.detail).toBe('It did not answer. Find servers again later.');
  });

  it('offers a healthy server it found when none is chosen yet', () => {
    const down = memory('Old Memory', 'https://old.example.com', { up: false, status: 500 });
    const up = memory('Companion Memory', 'https://mem.example.com', {
      llm: { ok: true, models: [{ id: 'a', vision: true }, { id: 'b', vision: false }] },
    });
    const s = firstRunStatus({ signedIn: true, discovery: discovered([down, up]) });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('ok');
    expect(s.title).toBe('Found Companion Memory');
    expect(s.detail).toBe('2 language models, 1 with vision. Use it to connect.');
    expect(s.memory).toBe(up);
  });

  it('reports the first server when none answers', () => {
    const first = memory('Memory A', 'https://a.example.com', { up: false, status: 500 });
    const second = memory('Memory B', 'https://b.example.com', { up: false, status: 502 });
    const s = firstRunStatus({ signedIn: true, discovery: discovered([first, second]) });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('warn');
    expect(s.title).toBe('Memory A is not responding');
    expect(s.detail).toBe('It answered with status 500.');
    expect(s.memory).toBe(first);
  });

  it('does not treat a saved address as chosen when the listing no longer has it', () => {
    const healthyServer = memory('Companion Memory', 'https://mem.example.com');
    const s = firstRunStatus({
      signedIn: true,
      discovery: discovered([healthyServer]),
      memoryUrl: 'https://gone.example.com',
    });
    expect(s.step).toBe(FTUE_STEP.FIND);
    expect(s.tone).toBe('ok');
    expect(s.title).toBe('Found Companion Memory');
  });
});

describe('modelsLine', () => {
  it('says when the language-model check needs a sign-in', () => {
    expect(modelsLine({ llm: { ok: false } })).toBe('Its language models need a sign-in the server accepts.');
    expect(modelsLine({})).toBe('Its language models need a sign-in the server accepts.');
  });

  it('says when no models are installed', () => {
    expect(modelsLine({ llm: { ok: true, models: [] } })).toBe('No language models are installed on it yet.');
  });

  it('counts models, singular and plural, and the vision models among them', () => {
    expect(modelsLine({ llm: { ok: true, models: [{ id: 'a' }] } })).toBe('1 language model.');
    expect(modelsLine({ llm: { ok: true, models: [{ id: 'a' }, { id: 'b' }] } })).toBe('2 language models.');
    expect(modelsLine({ llm: { ok: true, models: [{ id: 'a', vision: true }] } }))
      .toBe('1 language model, 1 with vision.');
    expect(modelsLine({
      llm: { ok: true, models: [{ id: 'a', vision: true }, { id: 'b', vision: true }, { id: 'c' }] },
    })).toBe('3 language models, 2 with vision.');
  });

  it('treats a model list that is not an array as none', () => {
    expect(modelsLine({ llm: { ok: true, models: 'llama' } })).toBe('No language models are installed on it yet.');
  });
});
