#!/usr/bin/env bash
set -euo pipefail
ULPIN_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_PROJECT_ROOT"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"

if node scripts/demo-running.mjs; then
  echo 'The workbench is already running at http://127.0.0.1:3000'
  echo 'To rebuild, first stop the existing web terminal with Ctrl+C, then run pnpm demo again.'
  exit 0
elif [[ "$?" = 2 ]]; then
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo 'pnpm is required. Install it, then run this command again.' >&2
  exit 1
fi
pnpm install --frozen-lockfile
bash scripts/platform-start.sh
pnpm db:migrate
if node scripts/demo-running.mjs; then
  echo 'Processing services recovered. The workbench is running at http://127.0.0.1:3000'
  exit 0
elif [[ "$?" = 2 ]]; then
  exit 1
fi
pnpm build
echo 'Open http://127.0.0.1:3000 — keep this terminal open during the demo.'
exec pnpm start
