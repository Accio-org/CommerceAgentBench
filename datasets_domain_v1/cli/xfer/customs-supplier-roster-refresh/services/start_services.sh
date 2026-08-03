#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"
START="${CCB_DAEMON_CLI_START:-/opt/mock_services/cli_daemon/start-daemon-cli-mock}"

[[ -x "$START" ]] || { echo "daemon_cli helper missing at $START" >&2; exit 2; }

# --- Jira CLI ---
JIRA_ROOT="${BENCH_RUNTIME_MOCK_JIRA_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/jira_cli}"
JIRA_PORT="${BENCH_RUNTIME_MOCK_JIRA_CLI_PORT:-3100}"
"$JIRA_ROOT/bin/jira-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$JIRA_PORT" --token "$TOKEN"

# --- Notion CLI ---
NOTION_ROOT="${BENCH_RUNTIME_MOCK_NOTION_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/notion_cli}"
NOTION_PORT="${BENCH_RUNTIME_MOCK_NOTION_CLI_PORT:-3300}"
"$NOTION_ROOT/bin/ntn-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$NOTION_PORT" --token "$TOKEN"

# --- Box CLI ---
BOX_ROOT="${BENCH_RUNTIME_MOCK_BOX_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/box_cli}"
BOX_PORT="${BENCH_RUNTIME_MOCK_BOX_CLI_PORT:-3500}"
"$BOX_ROOT/bin/box-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$BOX_PORT" --token "$TOKEN"
