#!/usr/bin/env bash
set -euo pipefail

: "${REWARD_JSON:?REWARD_JSON not set}"
: "${OUTPUT_DIR:?OUTPUT_DIR not set}"

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"
: "${MOCK_SITE_URL:?MOCK_SITE_URL not set (harness should publish google_workspace_cli :3081)}"
MOCK_URL="${MOCK_SITE_URL_GOOGLE_WORKSPACE_CLI:-$MOCK_SITE_URL}"

mkdir -p "$(dirname "$REWARD_JSON")" "$OUTPUT_DIR"

python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$TASK_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON" \
  --mock-url "$MOCK_URL"
