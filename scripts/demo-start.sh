#!/usr/bin/env bash
set -euo pipefail
ULPIN_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ULPIN_PROJECT_ROOT"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"

if curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health 2>/dev/null | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{try{process.exit(JSON.parse(body).ok===true?0:1)}catch{process.exit(1)}})' 2>/dev/null; then
  echo 'The workbench is already running at http://127.0.0.1:3000'
  echo 'To rebuild, first stop the existing web terminal with Ctrl+C, then run pnpm demo again.'
  exit 0
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo 'pnpm is required. Install it, then run this command again.' >&2
  exit 1
fi
pnpm install --frozen-lockfile
bash scripts/platform-start.sh
pnpm db:migrate
if curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health 2>/dev/null | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{try{process.exit(JSON.parse(body).ok===true?0:1)}catch{process.exit(1)}})' 2>/dev/null; then
  echo 'Processing services recovered. The workbench is running at http://127.0.0.1:3000'
  exit 0
fi
pnpm build
echo 'Open http://127.0.0.1:3000 — keep this terminal open during the demo.'
exec pnpm start
