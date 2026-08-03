#!/usr/bin/env bash
set -euo pipefail

TASK_ID="cli-box-supplier-docroom-audit"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
PORT="${BENCH_RUNTIME_MOCK_BOX_CLI_PORT:-3000}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"
START="${CCB_DAEMON_CLI_START:-/opt/mock_services/cli_daemon/start-daemon-cli-mock}"

[[ -x "$START" ]] || { echo "daemon_cli helper missing at $START" >&2; exit 2; }

"$START" --mock box_cli --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" --port "$PORT" --token "$TOKEN"
