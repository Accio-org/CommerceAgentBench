#!/usr/bin/env bash
set -euo pipefail

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(cd "$GRADER_DIR/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/outputs}"
REWARD_JSON="${REWARD_JSON:-$SCRIPT_DIR/verifier/reward.json}"

mkdir -p "$(dirname "$REWARD_JSON")"
python3 "$GRADER_DIR/verify_task.py" \
  --task-dir "$SCRIPT_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON"
