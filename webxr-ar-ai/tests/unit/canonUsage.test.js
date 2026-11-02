/**
 * Canon guard. The app takes every colour and face from the company canon
 * (@companionintelligence/tokens and @companionintelligence/fonts). These tests
 * read the source and the HTML pages, so a literal colour, a retired or
 * off-canon face, a Google-hosted font, or an entry point that skips the canon
 * CSS fails the suite the moment it is written.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The HTML pages the canon applies to. */
const PAGES = ['index.html', 'viewer.html', '404.html'];

/** The one module that resolves canon values. Vendored code is not ours to restyle. */
const EXEMPT_FILES = new Set(['src/ui/theme.js']);
const EXEMPT_PREFIXES = ['src/shims/'];

/** Entry points that must load the canon stylesheet and the self-hosted Manrope. */
const ENTRY_POINTS = ['src/main.js', 'src/viewer/main.js', 'src/notfound.js'];

/** Literal colour notations: hex (3, 4, 6 or 8 digits), rgb()/hsl() and three.js 0xrrggbb. */
const LITERAL_COLOUR = [
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/,
  /\b(?:rgba?|hsla?)\(\s*[\d.]/,
  /\b0x[0-9a-fA-F]{6}\b/,
];

/** Faces the canon has retired, or that are not in the canon stack. */
const OFF_CANON_FACE = [/montserrat/i, /\bsystem-ui\b/, /\bsans-serif\b/, /-apple-system/];

/** Google-hosted fonts break the strict CSP and the offline build. */
const GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function rel(path) {
  return relative(ROOT, path).split(sep).join('/');
}

/** The app's JS and HTML that the canon applies to, as { file, lines }. */
function governedSources() {
  const js = walk(join(ROOT, 'src'))
    .filter(p => p.endsWith('.js'))
    .map(rel)
    .filter(f => !EXEMPT_FILES.has(f) && !EXEMPT_PREFIXES.some(p => f.startsWith(p)));
  const html = PAGES.filter(p => existsSync(join(ROOT, p)));
  return [...js, ...html].map(file => ({
    file,
    lines: readFileSync(join(ROOT, file), 'utf8').split('\n'),
  }));
}

/** Every line that matches any pattern, as "file:line: text". */
function offenders(patterns) {
  const found = [];
  for (const { file, lines } of governedSources()) {
    lines.forEach((text, i) => {
      if (patterns.some(re => re.test(text))) found.push(`${file}:${i + 1}: ${text.trim()}`);
    });
  }
  return found;
}

describe('canon guard: colours', () => {
  it('finds at least the app sources it is meant to govern', () => {
    const files = governedSources().map(s => s.file);
    expect(files).toContain('src/main.js');
    expect(files).toContain('src/ui/DesktopOverlay.js');
    expect(files).toContain('index.html');
    expect(files).not.toContain('src/ui/theme.js');
  });

  it('has no literal colour outside the theme module', () => {
    expect(offenders(LITERAL_COLOUR)).toEqual([]);
  });
});

describe('canon guard: faces', () => {
  it('uses no retired or off-canon face', () => {
    expect(offenders(OFF_CANON_FACE)).toEqual([]);
  });

  it('loads no Google-hosted font', () => {
    expect(offenders([GOOGLE_FONTS])).toEqual([]);
  });
});

describe('canon guard: wiring', () => {
  for (const entry of ENTRY_POINTS) {
    it(`${entry} loads the canon tokens and the self-hosted Manrope`, () => {
      const source = readFileSync(join(ROOT, entry), 'utf8');
      expect(source).toContain("'@companionintelligence/tokens/tokens.css'");
      expect(source).toContain("'@companionintelligence/fonts/manrope.css'");
    });
  }

  it('builds the not-found page as dist/404.html', () => {
    const config = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');
    expect(config).toMatch(/notFound:\s*resolve\(__dirname,\s*'404\.html'\)/);
    expect(existsSync(join(ROOT, 'public/404.html'))).toBe(false);
  });

  it('takes the canon packages from the org registry, pinned', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    for (const name of ['@companionintelligence/tokens', '@companionintelligence/fonts']) {
      // Exact versions: no ranges, no file: paths into sibling checkouts.
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.devDependencies['@companionintelligence/config']).toMatch(/^\d+\.\d+\.\d+$/);
    const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf8');
    expect(npmrc).toContain('@companionintelligence:registry=https://npm.pkg.github.com');
    expect(npmrc).not.toMatch(/_authToken=[^$]/);   // the token is read from the environment
  });
});
