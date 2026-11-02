/**
 * Theme — the Companion Intelligence canon, for the app's surfaces.
 *
 * Every colour and face in the app comes from @companionintelligence/tokens
 * (and the self-hosted Manrope in @companionintelligence/fonts). CSS uses the
 * canon custom properties from tokens.css. JavaScript that cannot read CSS
 * variables (three.js materials, canvas drawing) resolves the same values from
 * tokens.json, so the two never drift. No literal colour lives in this file.
 */

import canon from '@companionintelligence/tokens/tokens.json';

export const SCHEMES = Object.freeze(['light', 'dark']);

/** The canon sans stack, for canvas text (which cannot read `var(--font-sans)`). */
export const FONT_STACK = canon.font.stack;

/**
 * The headset shows the room through passthrough, so XR surfaces use the dark
 * ramp (bright text and marks on a dark plate) whatever the browser's scheme.
 */
export const XR_SCHEME = 'dark';

/** Role → hex, per scheme. Role names are the canon custom-property names. */
const RESOLVE = {
  background:         (s) => canon[s].background.hex,
  foreground:         (s) => canon[s].foreground.hex,
  'muted-foreground': (s) => canon[s]['muted-foreground'].hex,
  border:             (s) => canon[s].border.hex,
  primary:            (s) => canon[s].primary.hex,
  destructive:        (s) => canon[s].destructive.hex,
  success:            (s) => canon.status[s].success.hex,
  warning:            (s) => canon.status[s].warning.hex,
  info:               (s) => canon.status[s].info.hex,
  'ci-surface-3':     (s) => canon.surfaces[s]['surface-3'].hex,
  cta:                () => canon.cta.cta.hex,
  'cta-foreground':   () => canon.cta['cta-foreground'].hex,
  heat:               () => canon.heat.heat.hex,
  'mark-deep':        () => canon.mark['mark-deep'].hex,
  'level-red':        () => canon.level.red.hex,
  'level-orange':     () => canon.level.orange.hex,
  'level-gold':       () => canon.level.gold.hex,
  'level-green':      () => canon.level.green.hex,
  'level-blue':       () => canon.level.blue.hex,
};

/** @returns {'light' | 'dark'} the scheme the page is currently showing */
export function currentScheme() {
  const root = globalThis.document?.documentElement;
  return root?.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * @param {keyof typeof RESOLVE} role
 * @param {'light' | 'dark'} [scheme]  defaults to the page's scheme
 * @returns {string} the canon colour as #rrggbb
 */
export function canonColor(role, scheme = currentScheme()) {
  const resolve = RESOLVE[role];
  if (!resolve) throw new Error(`Unknown canon colour role: ${role}`);
  return resolve(SCHEMES.includes(scheme) ? scheme : 'light');
}

/**
 * The same colour as a three.js colour value (0xrrggbb).
 * @returns {number}
 */
export function threeColor(role, scheme = currentScheme()) {
  return Number.parseInt(canonColor(role, scheme).slice(1), 16);
}

/**
 * A canon colour with alpha, as a canvas-ready rgba() string.
 * @param {string} hex  #rrggbb
 * @param {number} alpha  0–1
 */
export function withAlpha(hex, alpha) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new TypeError(`Expected #rrggbb, got ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * A canon custom property for inline styles, e.g. cssVar('muted-foreground').
 * @param {string} name  a canon custom-property name without the leading `--`
 */
export function cssVar(name) {
  return `var(--${name})`;
}

/**
 * Follow the device's colour scheme by toggling the `dark` class on <html>,
 * which is how tokens.css selects the dark set. Keeps following while the page
 * is open.
 * @param {Window} [win]
 * @returns {() => void} stops following
 */
export function initColorScheme(win = globalThis.window) {
  const doc = win?.document;
  const root = doc?.documentElement;
  if (!root) return () => {};
  const query = win.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = Boolean(query?.matches);
    root.classList.toggle('dark', dark);
    // The browser chrome colour (mobile) follows the canon background too.
    themeColorMeta(doc).content = canonColor('background', dark ? 'dark' : 'light');
  };
  apply();
  query?.addEventListener?.('change', apply);
  return () => query?.removeEventListener?.('change', apply);
}

/** The <meta name="theme-color"> element, created if the page does not have one. */
function themeColorMeta(doc) {
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.appendChild(meta);
  }
  return meta;
}
