/**
 * The Companion Scan Quest app: this site packaged for Meta Horizon OS with Meta's
 * Bubblewrap (quest/twa-manifest.json, docs/quest-app.md).
 *
 * The package is an immersive Horizon OS app. Meta's PWA runtime expects an immersive
 * app to request its WebXR session as soon as the page has loaded, and it counts the
 * tap that launched the app as the user activation `requestSession` needs. A browser
 * tab keeps the flow it always had: IWSDK offers the session and the Meta Quest Browser
 * shows Enter AR. The session itself is started by ./arSession.js.
 *
 * The package opens `/?source=quest-app` (twa-manifest.json `startUrl`). Nothing else
 * links there, so that marker tells the app from a tab. It is remembered for the life
 * of the tab, so a reload inside the app is still the app, and removed from the
 * address bar.
 */

/** The `source` query value the Quest app's launch URL carries. */
export const QUEST_APP_SOURCE = 'quest-app';

const SS_QUEST_APP = 'companionScan.questApp';

/**
 * Whether this page belongs to the Quest app. Reads the launch marker, remembers it in
 * sessionStorage for this tab, and takes it out of the address bar.
 * @returns {boolean}
 */
export function detectQuestApp({
  win = globalThis.window,
  storage = globalThis.sessionStorage,
} = {}) {
  if (!win?.location) return false;
  const params = new URLSearchParams(win.location.search);
  const launched = params.get('source') === QUEST_APP_SOURCE;
  if (launched) {
    params.delete('source');
    const rest = params.toString();
    win.history?.replaceState?.(null, '', win.location.pathname + (rest ? `?${rest}` : '') + (win.location.hash ?? ''));
    try {
      storage?.setItem(SS_QUEST_APP, '1');
    } catch {
      // Storage can be unavailable; the marker still counts for this load.
    }
    return true;
  }
  try {
    return storage?.getItem(SS_QUEST_APP) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether to start the AR session as soon as the page is ready: only in the Quest app,
 * only where immersive-ar is supported, and not on a load that finishes a sign-in,
 * whose result the user should see on the panel first.
 */
export function shouldEnterArOnLoad({ questApp, arSupported, signInReturn }) {
  return Boolean(questApp && arSupported && !signInReturn);
}

/** A sentence for the panel when the AR session did not start. */
export function describeArError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The headset did not let AR start. Press Enter AR to try again.';
    case 'NotSupportedError':
      return 'This device cannot start an AR session.';
    case 'InvalidStateError':
      return 'An AR session is already running.';
    default:
      return `AR did not start: ${err?.message ?? err}`;
  }
}
