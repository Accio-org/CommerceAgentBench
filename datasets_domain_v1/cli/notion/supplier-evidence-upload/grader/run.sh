#!/usr/bin/env bash
set -euo pipefail

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"
REPO_ROOT="$(cd "$TASK_DIR/../.." && pwd)"

PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -m real_replica_bench.verifiers.notion_cli_state \
  --task-dir "$TASK_DIR" \
  --output-dir "${OUTPUT_DIR:-$TASK_DIR/outputs}" \
  --reward-json "${REWARD_JSON:-$TASK_DIR/reward.json}" \
  --mock-url "${MOCK_SITE_URL:-}"
