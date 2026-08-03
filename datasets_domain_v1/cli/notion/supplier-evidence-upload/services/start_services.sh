#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
SERVICE_ROOT="${BENCH_RUNTIME_MOCK_NOTION_CLI_DIR:-/opt/mock_services/notion_cli}"
PORT="${BENCH_RUNTIME_MOCK_NOTION_CLI_PORT:-3456}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"
START="${CCB_DAEMON_CLI_START:-/opt/mock_services/cli_daemon/start-daemon-cli-mock}"

[[ -x "$START" ]] || { echo "daemon_cli helper missing at $START" >&2; exit 2; }

"$START" --mock notion_cli --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" --port "$PORT" --token "$TOKEN" --service-root "$SERVICE_ROOT"
