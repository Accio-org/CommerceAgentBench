#!/usr/bin/env bash
set -euo pipefail

: "${REWARD_JSON:?REWARD_JSON is required}"
: "${OUTPUT_DIR:?OUTPUT_DIR is required}"

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$GRADER_DIR/.." && pwd)"
REPO_ROOT="$(cd "$TASK_DIR/../.." && pwd)"
MOCK_URL="${MOCK_SITE_URL:-${MOCK_URL:-http://127.0.0.1:3098}}"

mkdir -p "$(dirname "$REWARD_JSON")" "$OUTPUT_DIR"

PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -m bench_core.verifiers.shopify_online_store_v2 \
  --task-dir "$TASK_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --reward-json "$REWARD_JSON" \
  --mock-url "$MOCK_URL"
