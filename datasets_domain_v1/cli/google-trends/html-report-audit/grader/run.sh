#!/usr/bin/env bash
set -euo pipefail

: "${REWARD_JSON:?REWARD_JSON is required}"
: "${OUTPUT_DIR:?OUTPUT_DIR is required}"

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(cd "$GRADER_DIR/.." && pwd)"

mkdir -p "$(dirname "$REWARD_JSON")"

python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$SCRIPT_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON"
