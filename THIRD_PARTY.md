# Third-party software

What Companion Scan Quest is built from, read from `webxr-ar-ai/package-lock.json`.
[NOTICE.md](NOTICE.md) says what the licences require, and [CREDITS.md](CREDITS.md) thanks the projects.

## In the web app

The runtime dependencies (`dependencies` in `webxr-ar-ai/package.json`) and everything they
depend on, as the lockfile resolves them: 33 packages, 2 of them first-party. The bundle
holds only the parts the app imports, so this list is a superset. The licence text of each
ships with the site at [/licenses.txt](https://meta.ci.computer/licenses.txt) (`webxr-ar-ai/public/licenses.txt`),
which the Quest app opens too.

| Package | Version | Licence |
| --- | --- | --- |
| [`@babylonjs/havok`](https://www.npmjs.com/package/@babylonjs/havok) | 1.3.11 | MIT |
| [`@iwsdk/core`](https://github.com/facebook/immersive-web-sdk) | 0.3.1 | MIT |
| [`@iwsdk/glxf`](https://github.com/facebook/immersive-web-sdk) | 0.3.1 | MIT |
| [`@iwsdk/locomotor`](https://github.com/facebook/immersive-web-sdk) | 0.3.1 | MIT |
| [`@iwsdk/xr-input`](https://github.com/facebook/immersive-web-sdk) | 0.3.1 | MIT |
| [`@pmndrs/handle`](https://github.com/pmndrs/xr) | 6.6.29 | MIT |
| [`@pmndrs/msdfonts`](https://github.com/pmndrs/uikit) | 1.0.64 | Apache-2.0 AND OFL-1.1 |
| [`@pmndrs/pointer-events`](https://github.com/pmndrs/xr) | 6.6.29 | MIT |
| [`@pmndrs/uikit`](https://github.com/pmndrs/uikit) | 1.0.64 | MIT |
| [`@pmndrs/uikit-pub-sub`](https://github.com/pmndrs/uikit) | 1.0.64 | MIT |
| [`@pmndrs/uikitml`](https://github.com/pmndrs/uikit) | 0.1.12 | MIT |
| [`@preact/signals-core`](https://github.com/preactjs/signals) | 1.14.0 | MIT |
| [`@types/emscripten`](https://github.com/DefinitelyTyped/DefinitelyTyped) | 1.41.5 | MIT |
| [`@zappar/msdf-generator`](https://www.npmjs.com/package/@zappar/msdf-generator) | 1.2.4 | MIT |
| [`assertion-error`](https://github.com/chaijs/assertion-error) | 2.0.1 | MIT |
| [`chai`](https://github.com/chaijs/chai) | 5.3.3 | MIT |
| [`check-error`](https://github.com/chaijs/check-error) | 2.1.3 | MIT |
| [`comlink`](https://github.com/GoogleChromeLabs/comlink) | 4.4.2 | Apache-2.0 |
| [`deep-eql`](https://github.com/chaijs/deep-eql) | 5.0.2 | MIT |
| [`elics`](https://github.com/elixr-games/elics) | 3.4.2 | MIT |
| [`entities`](https://github.com/fb55/entities) | 6.0.1 | BSD-2-Clause |
| [`inline-style-parser`](https://github.com/remarkablemark/inline-style-parser) | 0.2.7 | MIT |
| [`loupe`](https://github.com/chaijs/loupe) | 3.2.1 | MIT |
| [`parse5`](https://github.com/inikulin/parse5) | 7.3.0 | MIT |
| [`pathval`](https://github.com/chaijs/pathval) | 2.0.1 | MIT |
| [`react`](https://github.com/facebook/react) | 19.2.4 | MIT |
| [`three`](https://github.com/mrdoob/three.js) | 0.183.2 | MIT |
| [`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh) | 0.9.9 | MIT |
| [`use-sync-external-store`](https://github.com/facebook/react) | 1.6.0 | MIT |
| [`yoga-layout`](https://github.com/facebook/yoga) | 3.2.1 | MIT |
| [`zustand`](https://github.com/pmndrs/zustand) | 4.5.7 | MIT |

By licence: MIT 28 · Apache-2.0 1 · Apache-2.0 AND OFL-1.1 1 · BSD-2-Clause 1.

### First-party

Companion Intelligence's own packages, from the CI-Common repository.

| Package | Version | What ships | Licence |
| --- | --- | --- | --- |
| `@companionintelligence/fonts` | 1.0.0 | Self-hosted Manrope (manrope.css and its woff2) | CI-Commercial-1.0 (CI-Common); the Manrope font is OFL-1.1 |
| `@companionintelligence/tokens` | 1.6.0 | Design tokens: tokens.css in the bundle | CI-Commercial-1.0 (CI-Common) |
| `@companionintelligence/assets` | 1.5.2 | Logo and icon files that scripts/sync-brand.mjs copies into public/ | CI-Commercial-1.0 (CI-Common) |

### Loaded at run time, not bundled

| What | From | Licence |
| --- | --- | --- |
| Controller models: `@webxr-input-profiles/assets` 1.0, through IWSDK | cdn.jsdelivr.net | MIT |
| Draco and Basis Universal decoders, through three | unpkg.com | Apache-2.0 |

## Build and test tools

The direct `devDependencies`, which never ship. The lockfile pins 483 packages in all.

| Package | Version | Licence |
| --- | --- | --- |
| [`@iwer/sem`](https://github.com/meta-quest/immersive-web-emulation-runtime) | 0.2.5 | MIT |
| [`@playwright/test`](https://github.com/microsoft/playwright) | 1.58.2 | Apache-2.0 |
| [`@vitest/coverage-v8`](https://github.com/vitest-dev/vitest) | 4.1.0 | MIT |
| [`iwer`](https://github.com/meta-quest/immersive-web-emulation-runtime) | 2.1.1 | MIT |
| [`vite`](https://github.com/vitejs/vite) | 6.4.4 | MIT |
| [`vite-plugin-mkcert`](https://github.com/liuweiGL/vite-plugin-mkcert) | 1.17.10 | MIT |
| [`vitest`](https://github.com/vitest-dev/vitest) | 4.1.0 | MIT |
| [`wrangler`](https://github.com/cloudflare/workers-sdk) | 4.153.0 | MIT OR Apache-2.0 |

## CV server (Python)

The packages `cv-server/` and `webxr-ar-ai/server/` install. The CV server runs on your own
GPU host and never ships with the app. PyTorch is installed separately (see `cv-server/README.md`).

| Package | Requirement | Licence | Listed in |
| --- | --- | --- | --- |
| [`aiofiles`](https://pypi.org/project/aiofiles/) | >=23.0.0 | Apache-2.0 | `cv-server/requirements.txt` |
| [`fastapi`](https://pypi.org/project/fastapi/) | >=0.111.0 | MIT | `cv-server/requirements.txt`, `webxr-ar-ai/server/requirements.txt` |
| [`groundingdino-py`](https://pypi.org/project/groundingdino-py/) | >=0.1.0 | Apache-2.0 | `webxr-ar-ai/server/requirements.txt` |
| [`numpy`](https://pypi.org/project/numpy/) | >=1.26.0 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | `cv-server/requirements.txt` |
| [`opencv-python-headless`](https://pypi.org/project/opencv-python-headless/) | >=4.9.0 | Apache-2.0 | `cv-server/requirements.txt` |
| [`Pillow`](https://pypi.org/project/pillow/) | >=10.0.0 | MIT-CMU | `cv-server/requirements.txt`, `webxr-ar-ai/server/requirements.txt` |
| [`python-multipart`](https://pypi.org/project/python-multipart/) | >=0.0.9 | Apache-2.0 | `cv-server/requirements.txt` |
| [`uvicorn`](https://pypi.org/project/uvicorn/) | >=0.29.0 | BSD-3-Clause | `cv-server/requirements.txt`, `webxr-ar-ai/server/requirements.txt` |

---

_Generated by [`webxr-ar-ai/scripts/third-party.mjs`](webxr-ar-ai/scripts/third-party.mjs) from `webxr-ar-ai/package-lock.json`. Run `npm run licenses` in `webxr-ar-ai/` to regenerate it, rather than editing it by hand._
