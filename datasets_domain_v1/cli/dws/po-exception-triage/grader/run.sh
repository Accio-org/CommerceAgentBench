#!/usr/bin/env bash
set -euo pipefail

: "${REWARD_JSON:?REWARD_JSON env var must be set}"
: "${OUTPUT_DIR:?OUTPUT_DIR env var must be set}"

TASK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$TASK_DIR/grader/verify_task.py" \
  --task-dir "$TASK_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON"
