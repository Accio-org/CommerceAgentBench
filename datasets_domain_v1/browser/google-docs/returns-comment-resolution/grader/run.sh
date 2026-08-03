#!/usr/bin/env bash
set -euo pipefail

: "${REWARD_JSON:?REWARD_JSON is required}"
: "${OUTPUT_DIR:?OUTPUT_DIR is required}"

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"
MOCK_URL="${MOCK_SITE_URL:-${MOCK_URL:-http://127.0.0.1:3081}}"

mkdir -p "$(dirname "$REWARD_JSON")" "$OUTPUT_DIR"

python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$TASK_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON" \
  --mock-url "$MOCK_URL"
