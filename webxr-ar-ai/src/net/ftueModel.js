/**
 * The first-run flow, as the overlay shows it. Pure: given what the user has done
 * so far, say what comes next. The overlay and the tests read the same rules, so
 * the copy and the behaviour cannot drift apart.
 *
 *   sign in  →  find my servers  →  use a memory server  →  ready
 */

export const FTUE_STEP = Object.freeze({
  SIGN_IN: 'sign-in',
  FIND: 'find',
  READY: 'ready',
});

/**
 * @param {object} state
 * @param {boolean} state.signedIn
 * @param {{ email?: string|null, name?: string|null } | null} [state.identity]
 * @param {{ portal: { ok: boolean, status?: number }, memory: Array<object> } | null} [state.discovery]
 *   the Worker's answer from /api/discover, or null before it has run
 * @param {string} [state.memoryUrl] the memory server the user chose, or ''
 * @returns {{ step: string, tone: 'info'|'ok'|'warn', title: string, detail: string, memory: object | null }}
 */
export function firstRunStatus({ signedIn, identity = null, discovery = null, memoryUrl = '' }) {
  if (!signedIn) {
    // The Portal refusing the sign-in ends it. Say so, rather than a first-time welcome.
    const expired = discovery?.portal?.status === 401;
    return {
      step: FTUE_STEP.SIGN_IN,
      tone: expired ? 'warn' : 'info',
      title: 'Sign in with Companion Intelligence',
      detail: expired
        ? 'Your sign-in has expired. Sign in again.'
        : 'Use the account you use for Companion Hub and Companion Memory. Scene capture works without signing in.',
      memory: null,
    };
  }

  const who = identity?.email ?? identity?.name ?? 'your account';
  if (!discovery) {
    return {
      step: FTUE_STEP.FIND,
      tone: 'info',
      title: `Signed in as ${who}`,
      detail: 'Find your memory server and its language models.',
      memory: null,
    };
  }

  if (!discovery.portal?.ok) {
    const expired = discovery.portal?.status === 401;
    return {
      step: FTUE_STEP.FIND,
      tone: 'warn',
      title: 'Memory discovery is not available yet',
      detail: expired
        ? 'Your sign-in has expired. Sign in again.'
        : 'Companion Intelligence did not list your memory servers for this app. Scene capture still works.',
      memory: null,
    };
  }

  // A server with no usable address cannot be connected to, so it does not count.
  const listed = Array.isArray(discovery.memory) ? discovery.memory : [];
  const servers = listed.filter((server) => server?.url);
  if (!servers.length) {
    const insecure = listed.find((server) => server?.health?.reason === 'insecure_address');
    if (insecure) {
      return {
        step: FTUE_STEP.FIND,
        tone: 'warn',
        title: `${insecure.name} has an address this app cannot use`,
        detail: 'It must be reached over https://. Check its address in Companion Hub, then find servers again.',
        memory: null,
      };
    }
    return {
      step: FTUE_STEP.FIND,
      tone: 'warn',
      title: 'No memory server on this account',
      detail: 'Install Companion Memory from Companion Hub, then find servers again.',
      memory: null,
    };
  }

  const chosen = servers.find((server) => server.url === memoryUrl) ?? null;
  if (chosen) {
    if (chosen.health?.ok) {
      return { step: FTUE_STEP.READY, tone: 'ok', title: `Using ${chosen.name}`, detail: modelsLine(chosen), memory: chosen };
    }
    return {
      step: FTUE_STEP.FIND,
      tone: 'warn',
      title: `${chosen.name} is not responding`,
      detail: `${answerText(chosen)} Find servers again later.`,
      memory: chosen,
    };
  }

  const healthy = servers.find((server) => server.health?.ok) ?? null;
  if (healthy) {
    return {
      step: FTUE_STEP.FIND,
      tone: 'ok',
      title: `Found ${healthy.name}`,
      detail: `${modelsLine(healthy)} Use it to connect.`,
      memory: healthy,
    };
  }

  const first = servers[0];
  return {
    step: FTUE_STEP.FIND,
    tone: 'warn',
    title: `${first.name} is not responding`,
    detail: answerText(first),
    memory: first,
  };
}

/** What the language-model check found, in one plain sentence. */
export function modelsLine(server) {
  if (!server.llm?.ok) {
    return 'Its language models need a sign-in the server accepts.';
  }
  const models = Array.isArray(server.llm.models) ? server.llm.models : [];
  if (!models.length) return 'No language models are installed on it yet.';
  const vision = models.filter((model) => model.vision).length;
  const count = `${models.length} language model${models.length === 1 ? '' : 's'}`;
  return vision ? `${count}, ${vision} with vision.` : `${count}.`;
}

/** What the health check got back, in one plain sentence. */
function answerText(server) {
  return server.health?.status
    ? `It answered with status ${server.health.status}.`
    : 'It did not answer.';
}
