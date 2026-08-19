#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v commerce-agent-bench >/dev/null 2>&1; then
  commerce-agent-bench run api-amazon-margin-floor-audit "$@"
else
  python3 -m bench_core run api-amazon-margin-floor-audit "$@"
fi
