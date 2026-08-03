#!/usr/bin/env bash
set -euo pipefail
: "${REWARD_JSON:?REWARD_JSON not set}"
: "${OUTPUT_DIR:?OUTPUT_DIR not set}"
GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"
mkdir -p "$(dirname "$REWARD_JSON")" "$OUTPUT_DIR"
python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$TASK_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON"
