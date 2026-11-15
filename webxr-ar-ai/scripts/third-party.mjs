/**
 * Writes the third-party notices from package-lock.json:
 *
 *   ../THIRD_PARTY.md      every package the web app ships, with version and licence, plus
 *                          the build tools and the CV server's Python packages
 *   ../NOTICE.md           the attribution the licences require, and where the texts are
 *   ../CREDITS.md          acknowledgements
 *   public/licenses.txt    the licence text of everything the web app ships. Vite copies it
 *                          into the build, so it is served at /licenses.txt and the Quest app
 *                          (which opens the site) carries it too.
 *
 *   node scripts/third-party.mjs          write the files
 *   node scripts/third-party.mjs --check  exit 1 when a file is out of date
 *
 * "Ships" means the runtime dependency graph: `dependencies` in package.json and everything
 * they depend on, as package-lock.json resolves it. The bundle holds only what the app
 * imports, so this is a superset. Licence texts come from the installed packages, so run
 * `npm ci` first. Everything is read locally; no network is used.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(APP_DIR, '..');
const SCRIPT = 'webxr-ar-ai/scripts/third-party.mjs';
const SITE = 'https://meta.ci.computer';
const REQUIRED_NOTICE = 'Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)';
const POLYFORM_URL = 'https://polyformproject.org/licenses/noncommercial/1.0.0';
const FIRST_PARTY_SCOPE = '@companionintelligence/';

/**
 * Packages whose package.json does not give a plain SPDX licence. Each entry was checked
 * against the licence file the package ships, or the upstream repository when it ships none.
 */
const OVERRIDES = {
  // "SEE LICENSE IN LICENSE": the file is the MIT licence, with two copyright notices.
  '@pmndrs/handle': { license: 'MIT' },
  '@pmndrs/pointer-events': { license: 'MIT' },
  '@pmndrs/uikit': { license: 'MIT' },
  // "SEE LICENSE IN LICENSE": MSDF versions of Google Fonts. Roboto is Apache-2.0; Inter,
  // Open Sans, Lato, Poppins and Montserrat are SIL OFL 1.1.
  '@pmndrs/msdfonts': { license: 'Apache-2.0 AND OFL-1.1' },
  // MIT in package.json, but the package ships no licence file. Upstream's LICENSE is
  // https://github.com/facebook/yoga/blob/main/LICENSE.
  'yoga-layout': { holder: 'Meta Platforms, Inc. and affiliates' },
};

/** The parts of the first-party packages that ship, and the licence of each. */
const FIRST_PARTY = {
  '@companionintelligence/tokens': {
    what: 'Design tokens: tokens.css in the bundle',
    licence: 'CI-Commercial-1.0 (CI-Common)',
  },
  '@companionintelligence/fonts': {
    what: 'Self-hosted Manrope (manrope.css and its woff2)',
    licence: 'CI-Commercial-1.0 (CI-Common); the Manrope font is OFL-1.1',
    texts: ['files/LICENSE-Manrope.txt'],
  },
  '@companionintelligence/assets': {
    what: 'Logo and icon files that scripts/sync-brand.mjs copies into public/',
    licence: 'CI-Commercial-1.0 (CI-Common)',
  },
};

/** Fetched by the running app from public CDNs; not in the bundle. */
const RUNTIME_FETCHED = [
  {
    what: 'Controller models: `@webxr-input-profiles/assets` 1.0, through IWSDK',
    from: 'cdn.jsdelivr.net',
    license: 'MIT',
  },
  {
    what: 'Draco and Basis Universal decoders, through three',
    from: 'unpkg.com',
    license: 'Apache-2.0',
  },
];

/**
 * The CV server's Python packages (cv-server/ and webxr-ar-ai/server/). They run on the
 * user's own GPU host and never ship with the app. Licences as PyPI gives them; the script
 * fails on a requirement missing here, so a new one gets looked up.
 */
const PYTHON_LICENCES = {
  fastapi: 'MIT',
  uvicorn: 'BSD-3-Clause',
  pillow: 'MIT-CMU',
  numpy: 'BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0',
  'opencv-python-headless': 'Apache-2.0',
  aiofiles: 'Apache-2.0',
  'python-multipart': 'Apache-2.0',
  'groundingdino-py': 'Apache-2.0',
};
const PYTHON_REQUIREMENTS = ['cv-server/requirements.txt', 'webxr-ar-ai/server/requirements.txt'];

const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|EUPL|CDDL|CPAL|OSL|SSPL|CC-BY-SA)/i;
const LICENCE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;
const NOTICE_FILE = /^notice(\..*)?$/i;

const MIT_TEXT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

// ── Reading the lockfile ─────────────────────────────────────────────────────

/** Where npm installed `name` for the package at `from`, by node's lookup rule. */
export function resolveLocation(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

/** Every package reachable from `names`, following dependencies and required peers. */
export function closure(lock, names) {
  const packages = lock.packages;
  const seen = new Map();
  const stack = names.map((name) => ['', name]);
  while (stack.length) {
    const [from, name] = stack.pop();
    const location = resolveLocation(packages, from, name);
    if (!location) throw new Error(`package-lock.json has no ${name} for ${from || 'the root'}`);
    if (seen.has(location)) continue;
    seen.set(location, name);
    const entry = packages[location];
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    const next = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}).filter((dep) => resolveLocation(packages, location, dep)),
      ...Object.keys(entry.peerDependencies ?? {}).filter((dep) => !optionalPeers[dep]?.optional),
    ];
    for (const dep of next) stack.push([location, dep]);
  }
  return [...seen].map(([location, name]) => ({ location, name, version: packages[location].version }));
}

function repoUrl(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!raw) return pkg.homepage ?? null;
  const url = raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/');
  return /^https?:\/\//.test(url) ? url : `https://github.com/${url}`;
}

/** A package's metadata, licence and licence files, from the lockfile and node_modules. */
function describe(lock, { location, name, version }) {
  const dir = join(APP_DIR, location);
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`${name} is not installed (${location}); run npm ci first`);
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const override = OVERRIDES[name] ?? {};
  const files = readdirSync(dir);
  const license = override.license ?? lock.packages[location].license ?? pkg.license ?? 'UNKNOWN';
  return {
    name,
    version,
    location,
    license,
    url: repoUrl(pkg) ?? `https://www.npmjs.com/package/${name}`,
    description: (pkg.description ?? '').replace(/\s+/g, ' ').trim(),
    licenceFiles: files.filter((f) => LICENCE_FILE.test(f)).sort(),
    noticeFiles: files.filter((f) => NOTICE_FILE.test(f)).sort(),
    holder: override.holder ?? null,
    firstParty: name.startsWith(FIRST_PARTY_SCOPE),
  };
}

function readPythonRequirements() {
  const rows = [];
  for (const file of PYTHON_REQUIREMENTS) {
    const text = readFileSync(join(REPO_DIR, file), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const spec = line.replace(/#.*/, '').trim();
      if (!spec) continue;
      const match = /^([A-Za-z0-9_.-]+)(\[[^\]]*\])?\s*(.*)$/.exec(spec);
      const key = match[1].toLowerCase();
      const license = PYTHON_LICENCES[key];
      if (!license) throw new Error(`${file}: no licence recorded for ${match[1]}; add it to PYTHON_LICENCES`);
      const existing = rows.find((row) => row.key === key);
      if (existing) existing.usedBy.push(file);
      else rows.push({ key, name: match[1], requirement: match[3] || 'any', license, usedBy: [file] });
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** Everything the notices are made from. */
export function collect() {
  const lock = JSON.parse(readFileSync(join(APP_DIR, 'package-lock.json'), 'utf8'));
  const root = lock.packages[''];
  const runtimeNames = Object.keys(root.dependencies ?? {});
  const devNames = Object.keys(root.devDependencies ?? {});
  const shipped = closure(lock, runtimeNames)
    .map((entry) => describe(lock, entry))
    .sort((a, b) => a.name.localeCompare(b.name));
  const direct = (names, kind) => names
    .map((name) => describe(lock, { location: `node_modules/${name}`, name, version: lock.packages[`node_modules/${name}`].version }))
    .map((info) => ({ ...info, kind }));
  return {
    shipped,
    thirdParty: shipped.filter((pkg) => !pkg.firstParty),
    // The shipped first-party packages, and the dev ones whose files ship (the brand assets).
    firstParty: [
      ...shipped.filter((pkg) => pkg.firstParty),
      ...direct(devNames, 'dev').filter((pkg) => pkg.firstParty && FIRST_PARTY[pkg.name]),
    ],
    runtime: direct(runtimeNames, 'runtime'),
    dev: direct(devNames, 'dev').filter((pkg) => !pkg.firstParty),
    installed: Object.keys(lock.packages).filter(Boolean).length,
    python: readPythonRequirements(),
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const FOOTER = `---\n\n_Generated by [\`${SCRIPT}\`](${SCRIPT}) from \`webxr-ar-ai/package-lock.json\`. Run \`npm run licenses\` in \`webxr-ar-ai/\` to regenerate it, rather than editing it by hand._\n`;
const code = (text) => `\`${text}\``;
const link = (pkg) => `[${code(pkg.name)}](${pkg.url})`;

function countBy(list, key) {
  const counts = new Map();
  for (const item of list) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function renderThirdParty(data) {
  const shippedRows = data.thirdParty.map((pkg) => `| ${link(pkg)} | ${pkg.version} | ${pkg.license} |`);
  const licenceSummary = countBy(data.thirdParty, 'license').map(([licence, n]) => `${licence} ${n}`).join(' · ');
  const firstPartyRows = data.firstParty.map((pkg) => {
    const known = FIRST_PARTY[pkg.name];
    if (!known) throw new Error(`${pkg.name} ships but has no FIRST_PARTY entry saying what ships and under which licence`);
    return `| ${code(pkg.name)} | ${pkg.version} | ${known.what} | ${known.licence} |`;
  });
  const fetchedRows = RUNTIME_FETCHED.map((item) => `| ${item.what} | ${item.from} | ${item.license} |`);
  const devRows = data.dev.map((pkg) => `| ${link(pkg)} | ${pkg.version} | ${pkg.license} |`);
  const pythonRows = data.python.map((row) =>
    `| [${code(row.name)}](https://pypi.org/project/${row.key}/) | ${row.requirement} | ${row.license} | ${row.usedBy.map(code).join(', ')} |`);
  return `# Third-party software

What Companion Scan Quest is built from, read from \`webxr-ar-ai/package-lock.json\`.
[NOTICE.md](NOTICE.md) says what the licences require, and [CREDITS.md](CREDITS.md) thanks the projects.

## In the web app

The runtime dependencies (\`dependencies\` in \`webxr-ar-ai/package.json\`) and everything they
depend on, as the lockfile resolves them: ${data.shipped.length} packages, ${data.firstParty.filter((p) => p.kind !== 'dev').length} of them first-party. The bundle
holds only the parts the app imports, so this list is a superset. The licence text of each
ships with the site at [/licenses.txt](${SITE}/licenses.txt) (\`webxr-ar-ai/public/licenses.txt\`),
which the Quest app opens too.

| Package | Version | Licence |
| --- | --- | --- |
${shippedRows.join('\n')}

By licence: ${licenceSummary}.

### First-party

Companion Intelligence's own packages, from the CI-Common repository.

| Package | Version | What ships | Licence |
| --- | --- | --- | --- |
${firstPartyRows.join('\n')}

### Loaded at run time, not bundled

| What | From | Licence |
| --- | --- | --- |
${fetchedRows.join('\n')}

## Build and test tools

The direct \`devDependencies\`, which never ship. The lockfile pins ${data.installed} packages in all.

| Package | Version | Licence |
| --- | --- | --- |
${devRows.join('\n')}

## CV server (Python)

The packages \`cv-server/\` and \`webxr-ar-ai/server/\` install. The CV server runs on your own
GPU host and never ships with the app. PyTorch is installed separately (see \`cv-server/README.md\`).

| Package | Requirement | Licence | Listed in |
| --- | --- | --- | --- |
${pythonRows.join('\n')}

${FOOTER}`;
}

export function renderNotice(data) {
  const copyleft = data.thirdParty.filter((pkg) => COPYLEFT.test(pkg.license));
  const ids = [...new Set(data.thirdParty.flatMap((pkg) => pkg.license.split(/\s+(?:AND|OR)\s+/)))];
  const softwareIds = ids.filter((id) => id !== 'OFL-1.1').sort();
  const copyleftText = copyleft.length
    ? copyleft.map((pkg) => `- ${code(pkg.name)} ${pkg.version}: ${pkg.license}`).join('\n')
    : `None. The web app's third-party code is under permissive licences (${softwareIds.join(', ')})` +
      (ids.includes('OFL-1.1')
        ? ',\nand its fonts under the SIL Open Font License 1.1, which lets them be bundled with\n' +
          'software under any licence as long as their licence goes with them.'
        : '.');
  const notices = data.thirdParty.filter((pkg) => pkg.noticeFiles.length);
  const noticeText = notices.length
    ? notices.map((pkg) => `- ${code(pkg.name)} ${pkg.version}: ${pkg.noticeFiles.join(', ')}, reproduced in licenses.txt`).join('\n')
    : 'None of the Apache-2.0 packages in the web app ships a NOTICE file.';
  return `# NOTICE

Companion Scan Quest is free for noncommercial use under the PolyForm Noncommercial License
1.0.0: [LICENSE](LICENSE), <${POLYFORM_URL}>.

${REQUIRED_NOTICE}

## Third-party software

The web app bundles third-party packages, listed with their versions in
[THIRD_PARTY.md](THIRD_PARTY.md). Their licences ask that their copyright notices and licence
texts go with every copy. They do:

- at <${SITE}/licenses.txt>, served from \`webxr-ar-ai/public/licenses.txt\`;
- in the Quest app, which opens the same site, and in its APK under \`assets/licenses/\`
  (with this file, \`THIRD_PARTY.md\` and \`LICENSE\`).

## Copyleft and reciprocal licences

${copyleftText}

## Apache-2.0 NOTICE files

${noticeText}

## Fonts

- Manrope, in \`@companionintelligence/fonts\`: Copyright 2019 The Manrope Project Authors, SIL
  Open Font License 1.1.
- The MSDF fonts in \`@pmndrs/msdfonts\`, used by IWSDK's spatial UI: Roboto (Copyright 2011
  Google Inc., Apache-2.0), and Inter, Open Sans, Lato, Poppins and Montserrat (SIL Open Font
  License 1.1). Their notices are in licenses.txt.

## First-party packages

\`@companionintelligence/tokens\`, \`fonts\` and \`assets\` are Companion Intelligence's own,
from CI-Common, under CI-Common's licence (CI-Commercial-1.0). They are not covered by this
repository's LICENSE.

${FOOTER}`;
}

function avatar(pkg) {
  const owner = /github\.com\/([^/]+)\//.exec(pkg.url)?.[1];
  return owner ? `<img src="https://github.com/${owner}.png?size=40" width="20" height="20" alt="">` : '';
}

export function renderCredits(data) {
  const row = (pkg) => `| ${avatar(pkg)} | ${link(pkg)} | ${pkg.license} | ${pkg.description.replace(/\|/g, '\\|')} |`;
  const table = (list) => ['| | Project | Licence | What it does |', '| :-: | --- | --- | --- |', ...list.map(row)].join('\n');
  const core = ['three', '@iwsdk/core', 'vite'];
  const all = [...data.thirdParty, ...data.dev];
  const pick = (names) => names.map((name) => all.find((pkg) => pkg.name === name)).filter(Boolean);
  const bundled = data.thirdParty.filter((pkg) => !core.includes(pkg.name));
  const tools = data.dev.filter((pkg) => !core.includes(pkg.name));
  const python = data.python.map((pkg) =>
    `|  | [${code(pkg.name)}](https://pypi.org/project/${pkg.key}/) | ${pkg.license} | |`);
  return `# Credits

Companion Intelligence is built on the work of the open-source community. This page names
the projects Companion Scan Quest stands on, from \`webxr-ar-ai/package-lock.json\`.

## 1. Core stack

${table(pick(core))}

## 2. In the web app

Everything else the app's runtime dependencies bring in.

${table(bundled)}

## 3. Build and test tools

${table(tools)}

## 4. CV server (Python)

| | Project | Licence | |
| :-: | --- | --- | --- |
${python.join('\n')}

---

Thank you to everyone who maintains these projects.

${FOOTER}`;
}

function licenceTexts(pkg) {
  const dir = join(APP_DIR, pkg.location);
  const texts = [];
  for (const file of [...(FIRST_PARTY[pkg.name]?.texts ?? pkg.licenceFiles), ...pkg.noticeFiles]) {
    texts.push(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim());
  }
  if (!texts.length && pkg.holder && pkg.license === 'MIT') {
    texts.push(`The package ships no licence file. ${pkg.url} gives the MIT licence:\n\n${MIT_TEXT(pkg.holder).trim()}`);
  }
  if (!texts.length) throw new Error(`${pkg.name} ships no licence text; add an entry to OVERRIDES`);
  return texts.join('\n\n');
}

export function renderLicencesTxt(data) {
  const rule = '='.repeat(78);
  const thin = '-'.repeat(78);
  const blocks = [...data.thirdParty, ...data.firstParty.filter((pkg) => FIRST_PARTY[pkg.name]?.texts)]
    .map((pkg) => [rule, `${pkg.name} ${pkg.version}`, `${FIRST_PARTY[pkg.name]?.licence ?? pkg.license}`, pkg.url, thin, licenceTexts(pkg)].join('\n'));
  const fetched = RUNTIME_FETCHED.map((item) => `- ${item.what.replace(/`/g, '')}: ${item.license}, from ${item.from}`).join('\n');
  return `Companion Scan Quest
${SITE}

Free for noncommercial use under the PolyForm Noncommercial License 1.0.0:
${POLYFORM_URL}

${REQUIRED_NOTICE}

The third-party software in this web app, each with its licence text, as its licence asks.
The first-party @companionintelligence packages are Companion Intelligence's own (CI-Common,
CI-Commercial-1.0); the Manrope font they include is listed below with its licence.

Loaded at run time from public CDNs, not part of this app:
${fetched}

Generated by ${SCRIPT} from package-lock.json.

${blocks.join('\n\n')}
`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function outputs(data = collect()) {
  return [
    [join(REPO_DIR, 'THIRD_PARTY.md'), renderThirdParty(data)],
    [join(REPO_DIR, 'NOTICE.md'), renderNotice(data)],
    [join(REPO_DIR, 'CREDITS.md'), renderCredits(data)],
    [join(APP_DIR, 'public', 'licenses.txt'), renderLicencesTxt(data)],
  ];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [file, text] of outputs()) {
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === text) continue;
    if (check) stale.push(file);
    else writeFileSync(file, text);
  }
  if (check && stale.length) {
    console.error(`third-party: out of date, run \`npm run licenses\`:\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? 'third-party: notices are current' : 'third-party: notices written');
}
