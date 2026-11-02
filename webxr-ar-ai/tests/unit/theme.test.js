/**
 * Unit tests for the canon theme: colours resolved from tokens.json for code
 * that cannot read CSS variables, the colour-scheme follow, and the helpers.
 * The expected hex values are the published canon (@companionintelligence/tokens).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import canon from '@companionintelligence/tokens/tokens.json';

const {
  FONT_STACK,
  SCHEMES,
  XR_SCHEME,
  canonColor,
  currentScheme,
  cssVar,
  initColorScheme,
  threeColor,
  withAlpha,
} = await import('../../src/ui/theme.js');

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A minimal <html> whose class list the theme can toggle. */
function makeRoot(initial = []) {
  const classes = new Set(initial);
  return {
    classes,
    classList: {
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force ?? !classes.has(c);
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
  };
}

/** A fake document with <head> and an optional theme-color <meta>. */
function makeDocument(root, { themeMeta = null } = {}) {
  const head = { children: [], appendChild(el) { this.children.push(el); el.parentNode = this; return el; } };
  let meta = themeMeta;
  return {
    documentElement: root,
    head,
    querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
    createElement: () => ({ name: '', content: '' }),
    _setMeta: (m) => { meta = m; },
    get _meta() { return meta; },
  };
}

/** A fake window with a matchMedia query that can flip to dark. */
function makeWindow({ dark = false, withMeta = false } = {}) {
  const root = makeRoot();
  const listeners = new Set();
  const query = {
    matches: dark,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    _flip(nextDark) {
      this.matches = nextDark;
      for (const fn of listeners) fn();
    },
    _listenerCount: () => listeners.size,
  };
  const document = makeDocument(root, { themeMeta: withMeta ? { name: 'theme-color', content: '' } : null });
  return {
    document,
    query,
    matchMedia: vi.fn(() => query),
    root,
  };
}

describe('canon colours from tokens.json', () => {
  it('resolves the light and dark primary to the published canon', () => {
    expect(canonColor('primary', 'light')).toBe('#0a6358');
    expect(canonColor('primary', 'dark')).toBe('#c5e8dc');
  });

  it('resolves the semantic status set per scheme', () => {
    expect(canonColor('success', 'light')).toBe(canon.status.light.success.hex);
    expect(canonColor('success', 'dark')).toBe('#34d399');
    expect(canonColor('warning', 'light')).toBe('#855500');
    expect(canonColor('warning', 'dark')).toBe('#fbbf24');
    expect(canonColor('info', 'dark')).toBe('#38bdf8');
  });

  it('resolves the surfaces and text roles per scheme', () => {
    expect(canonColor('background', 'dark')).toBe('#041620');
    expect(canonColor('foreground', 'dark')).toBe('#e8f2f4');
    expect(canonColor('muted-foreground', 'dark')).toBe('#a3babf');
    expect(canonColor('destructive', 'light')).toBe('#da302f');
    expect(canonColor('ci-surface-3', 'dark')).toBe('#143e48');
  });

  it('resolves the mode-independent accents whatever the scheme', () => {
    for (const scheme of SCHEMES) {
      expect(canonColor('cta', scheme)).toBe('#069b5b');
      expect(canonColor('level-red', scheme)).toBe('#ef4444');
      expect(canonColor('level-blue', scheme)).toBe('#0ea5e9');
      expect(canonColor('heat', scheme)).toBe('#ff3f00');
      expect(canonColor('mark-deep', scheme)).toBe('#066c80');
    }
  });

  it('falls back to the light set for an unknown scheme name', () => {
    expect(canonColor('primary', 'sepia')).toBe('#0a6358');
  });

  it('rejects a role that is not in the canon map', () => {
    expect(() => canonColor('chartreuse')).toThrow('Unknown canon colour role: chartreuse');
  });

  it('uses the page scheme when none is given', () => {
    vi.stubGlobal('document', makeDocument(makeRoot(['dark'])));
    expect(canonColor('primary')).toBe('#c5e8dc');
    vi.stubGlobal('document', makeDocument(makeRoot()));
    expect(canonColor('primary')).toBe('#0a6358');
  });
});

describe('threeColor, withAlpha, cssVar', () => {
  it('gives three.js a 0xrrggbb number for the same canon colour', () => {
    expect(threeColor('primary', 'light')).toBe(0x0a6358);
    expect(threeColor('info', 'dark')).toBe(0x38bdf8);
  });

  it('gives a canvas-ready rgba() string from a canon hex', () => {
    expect(withAlpha('#0a6358', 0.5)).toBe('rgba(10, 99, 88, 0.5)');
    expect(withAlpha('#ffffff', 0)).toBe('rgba(255, 255, 255, 0)');
  });

  it('refuses anything that is not a six-digit hex', () => {
    expect(() => withAlpha('#abc', 0.5)).toThrow(TypeError);
    expect(() => withAlpha('rgb(1, 2, 3)', 0.5)).toThrow(TypeError);
  });

  it('wraps a canon property name in var()', () => {
    expect(cssVar('muted-foreground')).toBe('var(--muted-foreground)');
  });
});

describe('theme constants', () => {
  it('uses the canon sans stack for canvas text', () => {
    expect(FONT_STACK).toBe(canon.font.stack);
    expect(FONT_STACK).toContain('Manrope');
  });

  it('draws XR surfaces from the dark set', () => {
    expect(XR_SCHEME).toBe('dark');
  });
});

describe('currentScheme', () => {
  it('reports dark when the <html> element carries the dark class', () => {
    vi.stubGlobal('document', makeDocument(makeRoot(['dark'])));
    expect(currentScheme()).toBe('dark');
  });

  it('reports light otherwise, and with no document at all', () => {
    vi.stubGlobal('document', makeDocument(makeRoot()));
    expect(currentScheme()).toBe('light');
    vi.stubGlobal('document', undefined);
    expect(currentScheme()).toBe('light');
  });
});

describe('initColorScheme', () => {
  it('applies the device scheme at start and sets the browser chrome colour', () => {
    const win = makeWindow({ dark: true });
    initColorScheme(win);
    expect(win.root.classes.has('dark')).toBe(true);
    expect(win.document._meta).toBeNull();   // created below, not via querySelector
    expect(win.document.head.children).toHaveLength(1);
    expect(win.document.head.children[0].content).toBe('#041620');
  });

  it('follows the device when its scheme changes, and stops on request', () => {
    const win = makeWindow({ dark: false, withMeta: true });
    const stop = initColorScheme(win);
    expect(win.root.classes.has('dark')).toBe(false);
    expect(win.document._meta.content).toBe('#f3faf7');

    win.query._flip(true);
    expect(win.root.classes.has('dark')).toBe(true);
    expect(win.document._meta.content).toBe('#041620');

    expect(win.query._listenerCount()).toBe(1);
    stop();
    expect(win.query._listenerCount()).toBe(0);
  });

  it('does nothing without a window or without matchMedia', () => {
    expect(initColorScheme(undefined)).toBeTypeOf('function');
    const win = { document: makeDocument(makeRoot()) };
    expect(() => initColorScheme(win)).not.toThrow();
    expect(win.document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('scheme list', () => {
  it('lists the two canon schemes', () => {
    expect([...SCHEMES]).toEqual(['light', 'dark']);
  });
});
