#!/usr/bin/env bash
set -euo pipefail

TASK_ID="cli-box-artwork-launch-cleanup"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
SERVICE_ROOT="${BENCH_RUNTIME_MOCK_BOX_CLI_DIR:-/opt/mock_services/box_cli}"
PORT="${BENCH_RUNTIME_MOCK_BOX_CLI_PORT:-3000}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

"$SERVICE_ROOT/bin/box-daemon-start" \
  --workdir "$WORKDIR" \
  --private-dir "$PRIVATE_DIR" \
  --port "$PORT" \
  --token "$TOKEN"
