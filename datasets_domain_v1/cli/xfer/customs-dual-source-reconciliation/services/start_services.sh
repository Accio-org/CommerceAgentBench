#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"
START="${CCB_DAEMON_CLI_START:-/opt/mock_services/cli_daemon/start-daemon-cli-mock}"

[[ -x "$START" ]] || { echo "daemon_cli helper missing at $START" >&2; exit 2; }

# --- DWS doc CLI ---
DWS_ROOT="${BENCH_RUNTIME_MOCK_DWS_DOC_CLI_DIR:-/opt/mock_services/dws_doc_cli}"
DWS_PORT="${BENCH_RUNTIME_MOCK_DWS_DOC_CLI_PORT:-3400}"
"$START" --mock dws_doc_cli --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$DWS_PORT" --token "$TOKEN" --service-root "$DWS_ROOT"

# --- Jira CLI ---
JIRA_ROOT="${BENCH_RUNTIME_MOCK_JIRA_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/jira_cli}"
JIRA_PORT="${BENCH_RUNTIME_MOCK_JIRA_CLI_PORT:-3100}"
"$JIRA_ROOT/bin/jira-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$JIRA_PORT" --token "$TOKEN"

# --- Todoist CLI ---
TODOIST_ROOT="${BENCH_RUNTIME_MOCK_TODOIST_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/todoist_cli}"
TODOIST_PORT="${BENCH_RUNTIME_MOCK_TODOIST_CLI_PORT:-3200}"
"$TODOIST_ROOT/bin/todoist-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$TODOIST_PORT" --token "$TOKEN"
