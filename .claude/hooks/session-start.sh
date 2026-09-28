#!/bin/bash
set -euo pipefail

# Only needed for Claude Code on the web — local sessions already have the
# repo set up however the developer likes it.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/webxr-ar-ai"
npm install
