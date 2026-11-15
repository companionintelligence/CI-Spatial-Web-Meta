#!/usr/bin/env bash
# Builds the Companion Scan Quest app, unsigned: an APK to sideload and an AAB for
# stores that take bundles. .github/workflows/quest-app.yml runs it; it runs the same
# way on a workstation (Linux, macOS, or Git Bash on Windows).
#
#   quest/build.sh <out-dir> [version-code] [version-name]
#
# version-code is a whole number that must grow with every release (Android refuses
# to install a lower one over a higher one). Both default to quest/twa-manifest.json.
#
# Needs Node 18+, JDK 17 in JAVA_HOME (Bubblewrap accepts no other), and the Android
# SDK in ANDROID_HOME with "platforms;android-32" and "build-tools;34.0.0". The app is
# generated from the live site: Meta's Bubblewrap copies the web manifest and the icon
# from https://meta.ci.computer, so deploy first. WEB_MANIFEST_URL points it at another
# copy of the manifest for a dry run before a deploy.
#
# Steps, in the order `bubblewrap build` takes them: generate the Android project from
# twa-manifest.json (`bubblewrap update`), `gradlew assembleRelease bundleRelease`, and
# check the APK's zip alignment. In between, the notices go into the APK's assets: this
# repository's LICENSE, NOTICE.md and THIRD_PARTY.md, and the licences of the Android
# libraries the build includes. Signing is quest/sign.sh, kept apart so the build never
# sees the keystore.
set -euo pipefail

out_dir=${1:?usage: quest/build.sh <out-dir> [version-code] [version-name]}
version_code=${2:-}
version_name=${3:-}

quest_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(dirname "$quest_dir")
build_tools_version=34.0.0   # the build-tools Bubblewrap 1.24.1 signs and aligns with
platform=android-32          # compileSdkVersion of Bubblewrap's Meta Quest template

fail() { echo "quest/build.sh: $*" >&2; exit 1; }

[ -n "${JAVA_HOME:-}" ] && grep -q 'JAVA_VERSION="17\.' "$JAVA_HOME/release" 2>/dev/null \
  || fail "JAVA_HOME must point at a JDK 17 (Bubblewrap checks for it)."
[ -n "${ANDROID_HOME:-}" ] || fail "ANDROID_HOME must point at the Android SDK."
[ -d "$ANDROID_HOME/platforms/$platform" ] || fail "Android SDK package platforms;$platform is missing."
[ -d "$ANDROID_HOME/build-tools/$build_tools_version" ] || fail "Android SDK package build-tools;$build_tools_version is missing."
if [ -n "$version_code" ] && ! [[ "$version_code" =~ ^[1-9][0-9]{0,8}$ ]]; then
  fail "version-code must be a whole number from 1 to 999999999, not '$version_code'."
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/quest-app.XXXXXX")
project="$work/project"
mkdir -p "$project" "$work/home/.bubblewrap" "$out_dir"
out_dir=$(cd "$out_dir" && pwd)

# Bubblewrap reads its JDK and SDK paths from ~/.bubblewrap/config.json. Give it a home
# of its own, so a workstation's own Bubblewrap setup is left alone.
node -e '
  const [file, jdkPath, androidSdkPath] = process.argv.slice(1);
  require("fs").writeFileSync(file, JSON.stringify({ jdkPath, androidSdkPath }, null, 2));
' "$work/home/.bubblewrap/config.json" "$JAVA_HOME" "$ANDROID_HOME"

# This build's copy of twa-manifest.json, with the versions asked for.
node -e '
  const fs = require("fs");
  const [src, dest, code, name, manifestUrl] = process.argv.slice(1);
  const twa = JSON.parse(fs.readFileSync(src, "utf8"));
  if (code) twa.appVersionCode = Number(code);
  if (name) { twa.appVersionName = name; twa.appVersion = name; }
  if (manifestUrl) twa.webManifestUrl = manifestUrl;
  fs.writeFileSync(dest, JSON.stringify(twa, null, 2) + "\n");
  console.log(`${twa.packageId} ${twa.appVersionName} (${twa.appVersionCode}), ${twa.horizonOSAppMode}, ${twa.startUrl}`);
' "$quest_dir/twa-manifest.json" "$project/twa-manifest.json" "$version_code" "$version_name" "${WEB_MANIFEST_URL:-}"

npm ci --prefix "$quest_dir" --no-audit --no-fund --loglevel=error
bw_home="$work/home"
if command -v cygpath >/dev/null; then bw_home=$(cygpath -w "$bw_home"); fi   # Git Bash on Windows
HOME="$bw_home" USERPROFILE="$bw_home" \
  "$quest_dir/node_modules/.bin/bubblewrap" update --skipVersionUpgrade \
  --manifest="$project/twa-manifest.json" --directory="$project"

# The app's licence and notices travel inside the APK, as the PolyForm Notices clause asks.
licences="$project/app/src/main/assets/licenses"
mkdir -p "$licences"
cp "$repo_dir/LICENSE" "$repo_dir/NOTICE.md" "$repo_dir/THIRD_PARTY.md" "$licences/"
chmod +x "$project/gradlew"

# So do the notices of the Android libraries the generated project builds in. They are
# read from what Gradle resolves, so they cannot drift from the build.
libraries=$(cd "$project" && ./gradlew -q :app:dependencies --configuration releaseRuntimeClasspath --no-daemon \
  | sed -n -E 's/^[|[:space:]]*[+\\]--- //p' \
  | sed -E 's/ \((\*|c|n)\)$//; s/^([^:]+:[^:]+):[^ ]* -> ([^ ]+)$/\1:\2/; s/^([^:]+:[^:]+) -> ([^ ]+)$/\1:\2/' \
  | sort -u)
meta=()
apache=()
while IFS= read -r lib; do
  [ -n "$lib" ] || continue
  case "$lib" in
    com.meta.*) meta+=("$lib") ;;
    androidx.*|com.google.guava:*|org.jetbrains:*|org.jetbrains.kotlin:*) apache+=("$lib") ;;
    *) fail "no licence is recorded for the Android library $lib; add it to quest/build.sh." ;;
  esac
done <<< "$libraries"
[ ${#meta[@]} -gt 0 ] || fail "Gradle listed none of Meta's Android libraries; check its output format."
{
  echo "Android libraries in the Companion Scan Quest app"
  echo
  echo "The app's Android project is generated by Meta's Bubblewrap from the Trusted Web"
  echo "Activity template (Copyright 2019 Google Inc., Apache-2.0, with changes by Meta"
  echo "Platforms, Inc. and affiliates). The app is built with these libraries."
  echo
  echo "Under the Meta Platform Technologies SDK License Agreement,"
  echo "https://developer.oculus.com/licenses/oculussdk/:"
  printf '  %s\n' "${meta[@]}"
  echo
  echo "Under the Apache License, Version 2.0, whose text follows:"
  printf '  %s\n' "${apache[@]}"
  cat "$quest_dir/notices/apache-2.0.txt"
} > "$licences/ANDROID-LIBRARIES.txt"

(cd "$project" && ./gradlew assembleRelease bundleRelease --stacktrace --no-daemon)

apk="$project/app/build/outputs/apk/release/app-release-unsigned.apk"
aab="$project/app/build/outputs/bundle/release/app-release.aab"
"$ANDROID_HOME/build-tools/$build_tools_version/zipalign" -c -p 4 "$apk" \
  || fail "the APK is not zip-aligned."

name=$(node -e '
  const t = require(process.argv[1]);
  console.log(`companion-scan-quest-${t.appVersionName}-${t.appVersionCode}`);
' "$project/twa-manifest.json")
cp "$apk" "$out_dir/$name-unsigned.apk"
cp "$aab" "$out_dir/$name-unsigned.aab"
cp "$project/twa-manifest.json" "$licences/ANDROID-LIBRARIES.txt" "$out_dir/"
rm -rf "$work"
echo "Built $out_dir/$name-unsigned.apk and $out_dir/$name-unsigned.aab"
