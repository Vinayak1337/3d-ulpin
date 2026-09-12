#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/platform-lib.sh"
ulpin_compose --profile app stop
echo 'Services stopped; database, objects, and queue volumes preserved.'
