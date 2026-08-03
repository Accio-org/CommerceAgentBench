#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

GWS_ROOT="${BENCH_RUNTIME_MOCK_GOOGLE_WORKSPACE_CLI_DIR:-/opt/mock_services/google_workspace_cli}"
GWS_PORT="${BENCH_RUNTIME_MOCK_GOOGLE_WORKSPACE_CLI_PORT:-3081}"
GWS_STATE_ROOT="/var/lib/mocksvc/google_workspace_cli"
mkdir -p "$GWS_STATE_ROOT" "$WORKDIR/tmp"
export PORT="$GWS_PORT"
export MOCK_VERIFIER_TOKEN="$TOKEN"
export CCB_CLI_MOCK_NAME="google_workspace_cli"
export CCB_CLI_TARGET_BIN="$GWS_ROOT/bin/gws"
export CCB_CLI_BENCH_BIN="$GWS_ROOT/bin/gws-bench"
export CCB_CLI_BENCH_TOKEN_MODE="env"
export CCB_CLI_BENCH_PATHS_JSON='{"\/__bench\/state":"state","\/__bench\/audit":"audit","\/api\/state":"state","\/api\/audit":"audit"}'
export CCB_CLI_STATE_ENV_JSON="{\"GWS_MOCK_HOME\":\"$GWS_STATE_ROOT\"}"
nohup bun /opt/mock_services/cli_daemon/server.mjs >>/tmp/google_workspace_cli.log 2>&1 &
echo "$!" >> "$WORKDIR/tmp/mock_service_pids"
GWS_READY=0
for _ in $(seq 1 60); do
  if python3 - <<PY >/dev/null 2>&1
import urllib.request
urllib.request.urlopen("http://127.0.0.1:$GWS_PORT/health", timeout=2).read()
PY
  then
    GWS_READY=1
    break
  fi
  sleep 1
done
[[ "$GWS_READY" == "1" ]] || { echo "google_workspace_cli failed health check" >&2; cat /tmp/google_workspace_cli.log >&2 || true; exit 2; }

JIRA_ROOT="${BENCH_RUNTIME_MOCK_JIRA_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/jira_cli}"
JIRA_PORT="${BENCH_RUNTIME_MOCK_JIRA_CLI_PORT:-3100}"
"$JIRA_ROOT/bin/jira-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$JIRA_PORT" --token "$TOKEN"

TODOIST_ROOT="${BENCH_RUNTIME_MOCK_TODOIST_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/todoist_cli}"
TODOIST_PORT="${BENCH_RUNTIME_MOCK_TODOIST_CLI_PORT:-3200}"
"$TODOIST_ROOT/bin/todoist-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$TODOIST_PORT" --token "$TOKEN"
