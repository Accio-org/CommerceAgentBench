#!/usr/bin/env bash
set -euo pipefail

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"

python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$TASK_DIR" \
  --output-dir "${OUTPUT_DIR:-$TASK_DIR/outputs}" \
  --reward-json "${REWARD_JSON:-$TASK_DIR/reward.json}" \
  --mock-url "${MOCK_SITE_URL:-}"
