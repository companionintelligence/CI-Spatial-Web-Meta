# Companion Scan Quest as a Quest app

The Quest app is https://meta.ci.computer packaged for Meta Horizon OS. It is a
Trusted Web Activity (a PWA in an Android package) built with Meta's fork of Bubblewrap
(`@meta-quest/bubblewrap-cli`). The app holds no copy of the web app: it opens the
deployed site, so a deploy updates the app's behaviour without a new APK. A new APK is
needed only when the package itself changes (its name, icon, permissions or launch mode).

| | |
|---|---|
| Package name | `computer.ci.meta.twa` (Bubblewrap's default for the host). It is permanent once the app is in the Meta Horizon Store. |
| Launch mode | `immersive`: the app starts straight into the passthrough AR session |
| Launch URL | `https://meta.ci.computer/?source=quest-app` |
| Bubblewrap project | [`quest/twa-manifest.json`](../quest/twa-manifest.json) |
| Build | [`quest/build.sh`](../quest/build.sh), then [`quest/sign.sh`](../quest/sign.sh) |
| CI | [`.github/workflows/quest-app.yml`](../.github/workflows/quest-app.yml), manual only |

Desktop and phone wrappers are out of scope. The scanner needs an immersive-ar WebXR session with
Quest scene features (plane and mesh detection, anchors, the passthrough camera and
`session.initiateRoomCapture()`), which no Android WebView or WKWebView can host. The native
Unity runtime for Quest is a separate project, CI-Spatial-Unity.

## Why the app starts in immersive mode

Bubblewrap packages a Quest PWA in one of two modes, `2D` (a windowed site) or `immersive`
(the app starts in a WebXR session). This app uses `immersive`, for reasons in the code:

- **Everything a scan needs is in the headset.** Capture (Right A), export (Left Y), the model,
  preview and display settings, the wrist HUD and the Space Setup prompt all run inside the AR
  session. The 2D panel (`src/ui/DesktopOverlay.js`) holds setup only: sign-in, the server address
  and the camera FOV. All of it is optional and kept in the browser's storage, and the page itself
  calls the panel "pre-AR".
- **In a browser the page never asks for the session itself.** `main.js` created the IWSDK world
  with `offer: 'always'`, so the only way into AR was the Enter AR button that the Meta Quest
  Browser draws in its own toolbar (`navigator.xr.offerSession`). A packaged app has no browser
  toolbar, and Meta documents no offer UI inside a PWA.
- **Meta documents WebXR in PWAs for immersive mode.** Meta's guidance is that an immersive PWA
  requests its session right after load, and that the tap that launched the app counts as the user
  activation `requestSession` needs. Its description of 2D mode covers windowed content only.
  Bubblewrap's immersive template also adds the passthrough splash (`com.oculus.ossplash.background`,
  `passthrough-contextual`) that an AR app wants.

The page does this in `src/app/questApp.js` and `src/app/arSession.js`:

- The package opens `/?source=quest-app`. The page records that for the tab (so a reload stays
  in the app) and removes it from the address bar. Only then does it act differently from a tab.
- In the app, IWSDK offers nothing (`offer: 'none'`). Once everything is registered, the page
  requests immersive-ar itself, with the same features and reference space as before.
- The panel stays reachable. When the user leaves AR, it reappears with an **Enter AR** button
  that starts the session again. If the launch request is refused, the panel says why, and the
  button retries.
- A load that returns from sign-in shows the panel first, so its result is seen.
- A browser tab behaves exactly as before: the offered session and no Enter AR button.

`tests/e2e/questApp.spec.js` covers both paths on IWER's emulated Quest 3.

## What the site serves for the app

- **`/manifest.webmanifest`**, linked from `index.html`: name, `start_url` and `scope` `/`,
  `display: standalone`, the canon dark background, and the 192 and 512 px icons that
  `scripts/sync-brand.mjs` copies from `@companionintelligence/assets` (the 512 px icon doubles as
  the maskable one; the brand package's own maskable icon is the same file).
- **`/.well-known/assetlinks.json`**, from the Worker (`src/worker/rules.js`, `assetLinks`). Horizon
  OS will not start an immersive app unless this file names the app's package and the SHA-256
  fingerprint of the certificate it is signed with. The Worker builds it from two settings in
  `webxr-ar-ai/wrangler.toml`:

  ```toml
  QUEST_APP_PACKAGE = "computer.ci.meta.twa"
  QUEST_APP_CERT_SHA256 = ""   # the release certificate's SHA-256; several can be listed, separated by commas
  ```

  While `QUEST_APP_CERT_SHA256` is empty the path is a 404. It accepts keytool's colon form or
  64 bare hex digits, and serves `application/json` with a five-minute cache. A malformed value
  serves nothing rather than a statement that matches no app. `wrangler deploy --var
  QUEST_APP_CERT_SHA256:<64 hex digits>` overrides it for one deploy.

## Building

### In GitHub Actions

Run **Quest app (APK + AAB)** from the Actions tab, or:

```bash
gh workflow run quest-app.yml --repo companionintelligence/CI-Spatial-Web-Meta --ref main -f version_name=1.0.0
```

| Input | Meaning |
|---|---|
| `version_name` | The version people see. Blank keeps the one in `twa-manifest.json`. |
| `version_code` | A whole number that must grow with every release. Blank uses the run number. |
| `sign` | Sign with the release keystore. Main only. |

The **build** job checks that the site serves the manifest and the icon (Bubblewrap copies both
from the live site, so deploy first), generates the Android project, and uploads
`companion-scan-quest-<version>-<code>-unsigned` with the APK, the AAB, `LICENSE`, `NOTICE.md`,
`THIRD_PARTY.md` and `SHA256SUMS`. It never sees a signing secret.

The **sign** job runs only with `sign` ticked. It uses the `quest-release` environment, which needs:

| Kind | Name | Value |
|---|---|---|
| Secret | `QUEST_KEYSTORE_BASE64` | The release keystore, base64-encoded |
| Secret | `QUEST_KEYSTORE_PASSWORD` | Its password |
| Secret | `QUEST_KEY_PASSWORD` | The key's password, if it differs (PKCS12 keystores use one password) |
| Variable | `QUEST_KEY_ALIAS` | The key's alias, if it is not `android` |

Before it signs, the job reads `https://meta.ci.computer/.well-known/assetlinks.json` and refuses a
keystore whose certificate is not the one named there. It uploads
`companion-scan-quest-<version>-<code>` with the signed APK and AAB and the same notices. Nothing
is published: the workflow builds artifacts only.

### On a workstation

```bash
export JAVA_HOME=/path/to/jdk-17          # Bubblewrap accepts JDK 17 only
export ANDROID_HOME=/path/to/android-sdk  # with platforms;android-32 and build-tools;34.0.0
quest/build.sh out 3 1.0.0                # unsigned APK and AAB in out/
QUEST_KEYSTORE=release.keystore QUEST_KEYSTORE_PASSWORD=… quest/sign.sh out out/signed
```

`quest/build.sh` takes the steps `bubblewrap build` takes (`bubblewrap update`, then `gradlew
assembleRelease bundleRelease`, then the zip-alignment check) but keeps signing apart, gives
Bubblewrap a home directory of its own, and copies `LICENSE`, `NOTICE.md` and `THIRD_PARTY.md` into
the APK's assets. It also works in Git Bash on Windows, where `bubblewrap build` itself fails with
`spawn EINVAL` (current Node refuses to start `gradlew.bat` without a shell). For a dry run before the
manifest is deployed, point `WEB_MANIFEST_URL` at another copy of it.

## Releasing: the owner's steps

1. **Create the release keystore, once, and keep it safe.** Every update must be signed with the
   same key, and `assetlinks.json` pins its certificate, so a lost key means a new package name and
   a new store listing. Keep a backup outside GitHub.

   ```bash
   keytool -genkeypair -v -keystore companion-scan-quest.keystore -storetype PKCS12 \
     -alias android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Companion Intelligence"
   keytool -list -v -keystore companion-scan-quest.keystore -alias android   # the "SHA256:" line
   ```

2. **Publish its fingerprint.** Put the `SHA256:` value in `QUEST_APP_CERT_SHA256` in
   `webxr-ar-ai/wrangler.toml`, merge, and deploy the site (README, "Deploy"). Check that
   `https://meta.ci.computer/.well-known/assetlinks.json` and `/manifest.webmanifest` answer 200.
3. **Add the secrets.** Create the `quest-release` environment (Settings → Environments), add
   required reviewers, and add the secrets above (`base64 -w0 companion-scan-quest.keystore` gives
   `QUEST_KEYSTORE_BASE64`).
4. **Build** with `sign` ticked on main, and download the signed artifact.
5. **Check it on a Quest 3** (below) by sideloading: turn on developer mode for the headset in the
   Meta Horizon app, connect it over USB, run `adb install -r companion-scan-quest-<version>-<code>.apk`,
   and open the app from the library's Unknown Sources.
6. **Pre-release** on GitHub if wanted: attach the signed APK, `LICENSE`, `NOTICE.md`,
   `THIRD_PARTY.md` and `SHA256SUMS` from the artifact.
7. **Meta Horizon Store**, when wanted, through the owner's Meta developer account. Before
   submitting:
   - Create the app on the developer dashboard and put its app ID in `applicationId` in
     `quest/twa-manifest.json`. Bubblewrap's default is `0`.
   - Check the target API level. Bubblewrap 1.24.1 builds Quest apps for API 32. Meta's store
     manifest requirements ask new apps for a newer target. A newer Bubblewrap, or a patched template,
     may be needed. Sideloading is not affected.
   - Upload the signed APK, signed with this same key.

## Checking it on a Quest 3

| # | Step | Expect |
|---|---|---|
| 1 | Open the app from Unknown Sources | Passthrough AR straight away, with no browser bar. A URL bar, or an app that closes at once, means the Digital Asset Links check failed: `adb logcat \| grep -i "TWA verification"`. |
| 2 | Allow spatial data when asked | Planes and meshes are found. With no Space Setup, the room-capture flow starts after about 2 s. |
| 3 | Capture (Right A) without a CV server | Scene pins appear; the HUD reports the CV server unreachable. |
| 4 | Allow the camera, if asked, and capture with a CV server set | The viewfinder shows the camera; detections land on surfaces. Note whether the app asks at all. |
| 5 | Export (Left Y) | Note where the `.glb` and `.md` go: the Downloads folder, or nowhere. |
| 6 | Leave AR (Meta button) and come back to the app | The panel shows with **Enter AR**, which starts AR again. Note what the app shows between. |
| 7 | **Sign in with Companion Intelligence** on the panel | Note where the Portal opens. Meta's docs say an immersive PWA opens other sites in the Meta Quest Browser, so the sign-in may finish there rather than in the app. Scanning does not need it. |
| 8 | Install a build with a higher version code over it | It updates in place, and the scan and settings survive. |

Steps 4 to 7 are where Meta's documentation is silent for PWAs. Their results decide whether
anything needs to change (for example, a sign-in that stays in the app).
