#!/usr/bin/env bash
# Re-fetch GSAP and TextPlugin from cdnjs and verify their SHA-384
# fingerprints. Pin the expected hashes in this script; if a release
# upgrades GSAP, update the hashes and commit them.
#
# Hashes as of 2024 (cdnjs gsap 3.12.5). Verify at:
#   https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js
#   https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/TextPlugin.min.js

set -euo pipefail

EXPECTED_GSAP='TQXQLPKOQnWIgfqFXFY9IebLCFj6RXRaRHkBpu6/J40='
EXPECTED_PLUGIN='y6OvIHl/xJOAmI42rlZ3LsrJlrPM4LsENcWVoB/vJFI='

mkdir -p public/lib

# gsap.min.js
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
if ! curl -fsSL --proto '=https' --tlsv1.2 \
     'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js' \
     -o "$TMP"; then
  echo "ERROR: failed to download gsap.min.js" >&2
  exit 1
fi
ACTUAL=$(openssl dgst -sha384 -binary "$TMP" | openssl base64 -A)
if [ "$ACTUAL" != "$EXPECTED_GSAP" ]; then
  echo "ERROR: gsap.min.js hash mismatch" >&2
  echo "  expected: $EXPECTED_GSAP" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi
mv "$TMP" public/lib/gsap.min.js
trap - EXIT
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
if ! curl -fsSL --proto '=https' --tlsv1.2 \
     'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/TextPlugin.min.js' \
     -o "$TMP"; then
  echo "ERROR: failed to download TextPlugin.min.js" >&2
  exit 1
fi
ACTUAL=$(openssl dgst -sha384 -binary "$TMP" | openssl base64 -A)
if [ "$ACTUAL" != "$EXPECTED_PLUGIN" ]; then
  echo "ERROR: TextPlugin.min.js hash mismatch" >&2
  echo "  expected: $EXPECTED_PLUGIN" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi
mv "$TMP" public/lib/TextPlugin.min.js
trap - EXIT

echo "OK: $(ls -lh public/lib/)"
