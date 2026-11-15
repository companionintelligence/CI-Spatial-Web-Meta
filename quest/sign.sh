#!/usr/bin/env bash
# Signs the APK and the AAB that quest/build.sh made, with the Quest app's release
# keystore, and checks the result.
#
#   quest/sign.sh <dir-with-unsigned-builds> <out-dir>
#
# The keystore comes from the environment, never from the command line:
#   QUEST_KEYSTORE           path to the keystore (.jks or .p12)
#   QUEST_KEY_ALIAS          the key's alias (default: android, as in twa-manifest.json)
#   QUEST_KEYSTORE_PASSWORD  the keystore password
#   QUEST_KEY_PASSWORD       the key password (default: the keystore password)
#   EXPECTED_CERT_SHA256     optional: refuse to sign unless the certificate's SHA-256
#                            fingerprint is this one, the fingerprint
#                            https://meta.ci.computer/.well-known/assetlinks.json names
#
# Every update of the app must be signed with the same key: Horizon OS and the store
# refuse an update signed with another one, and the immersive app does not start
# unless the site's assetlinks.json names this certificate.
set -euo pipefail

in_dir=${1:?usage: quest/sign.sh <dir-with-unsigned-builds> <out-dir>}
out_dir=${2:?usage: quest/sign.sh <dir-with-unsigned-builds> <out-dir>}
build_tools="$ANDROID_HOME/build-tools/34.0.0"

fail() { echo "quest/sign.sh: $*" >&2; exit 1; }

[ -f "${QUEST_KEYSTORE:-}" ] || fail "QUEST_KEYSTORE must name the release keystore."
[ -n "${QUEST_KEYSTORE_PASSWORD:-}" ] || fail "QUEST_KEYSTORE_PASSWORD is not set."
export QUEST_KEY_ALIAS=${QUEST_KEY_ALIAS:-android}
export QUEST_KEY_PASSWORD=${QUEST_KEY_PASSWORD:-$QUEST_KEYSTORE_PASSWORD}
[ -x "$build_tools/apksigner" ] || [ -f "$build_tools/lib/apksigner.jar" ] \
  || fail "Android SDK package build-tools;34.0.0 is missing."

apksigner() { java -jar "$build_tools/lib/apksigner.jar" "$@"; }
upper_colons() { tr -d ': \r' | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//'; }

shopt -s nullglob
apks=("$in_dir"/*-unsigned.apk)
aabs=("$in_dir"/*-unsigned.aab)
[ ${#apks[@]} -eq 1 ] && [ ${#aabs[@]} -eq 1 ] || fail "expected one unsigned APK and one unsigned AAB in $in_dir."

# The certificate the keystore signs with, before anything is signed.
cert=$(keytool -list -v -keystore "$QUEST_KEYSTORE" -alias "$QUEST_KEY_ALIAS" \
         -storepass:env QUEST_KEYSTORE_PASSWORD \
       | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -n 1 | upper_colons)
[ ${#cert} -eq 95 ] || fail "could not read the certificate of key '$QUEST_KEY_ALIAS' from the keystore."
echo "Release certificate SHA-256: $cert"
if [ -n "${EXPECTED_CERT_SHA256:-}" ]; then
  expected=$(printf '%s' "$EXPECTED_CERT_SHA256" | upper_colons)
  [ "$cert" = "$expected" ] || fail "the keystore's certificate is $cert, but the site names $expected. Horizon OS would not start this app."
fi

mkdir -p "$out_dir"
apk_out="$out_dir/$(basename "${apks[0]}" -unsigned.apk).apk"
aab_out="$out_dir/$(basename "${aabs[0]}" -unsigned.aab).aab"

# The APK: zip-aligned already (quest/build.sh checks), so sign it as it is.
apksigner sign --ks "$QUEST_KEYSTORE" --ks-key-alias "$QUEST_KEY_ALIAS" \
  --ks-pass env:QUEST_KEYSTORE_PASSWORD --key-pass env:QUEST_KEY_PASSWORD \
  --out "$apk_out" "${apks[0]}"
rm -f "$apk_out.idsig"

# The AAB: a JAR signature, as Bubblewrap and Android Studio sign bundles.
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore "$QUEST_KEYSTORE" \
  -storepass:env QUEST_KEYSTORE_PASSWORD -keypass:env QUEST_KEY_PASSWORD \
  -signedjar "$aab_out" "${aabs[0]}" "$QUEST_KEY_ALIAS" > /dev/null

# Check both signatures, and that the APK carries the certificate checked above.
signed=$(apksigner verify --print-certs "$apk_out" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | upper_colons)
[ "$signed" = "$cert" ] || fail "the signed APK carries certificate $signed, not $cert."
apksigner verify --verbose "$apk_out" | grep -E '^Verified using v[12] scheme.*: true' > /dev/null \
  || fail "the APK has neither a v1 nor a v2 signature, which Horizon OS requires."
jarsigner -verify "$aab_out" | grep -q 'jar verified' || fail "the AAB signature does not verify."

echo "Signed $apk_out and $aab_out"
