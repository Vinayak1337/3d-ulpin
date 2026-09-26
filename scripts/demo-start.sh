#!/usr/bin/env bash
set -euo pipefail
ULPIN_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_PROJECT_ROOT"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo 'pnpm is required. Install it, then run this command again.' >&2
  exit 1
fi
pnpm web:build
echo 'Open http://127.0.0.1:3000 — keep this terminal open for the preserved web UI.'
exec pnpm web:start
