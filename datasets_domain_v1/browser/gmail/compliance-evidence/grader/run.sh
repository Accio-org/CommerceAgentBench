#!/usr/bin/env bash
set -euo pipefail

: "${REWARD_JSON:?REWARD_JSON is required}"

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"
MOCK_URL="${MOCK_SITE_URL_GMAIL_MOCK:-${MOCK_SITE_URL:-http://127.0.0.1:3071}}"

mkdir -p "$(dirname "$REWARD_JSON")"

python3 -m real_replica_bench.verifiers.gmail_ui_state \
  --task-dir "$TASK_DIR" \
  --reward-json "$REWARD_JSON" \
  --mock-url "$MOCK_URL"
