#!/usr/bin/env bash
set -euo pipefail

REWARD_JSON="${REWARD_JSON:-/output/reward.json}"
OUTPUT_DIR="${OUTPUT_DIR:-}"
GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"

mkdir -p "$(dirname "$REWARD_JSON")"
python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$TASK_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON"
