#!/usr/bin/env bash
set -euo pipefail
TASK_ID="api-slack-contacts-procurement-issue-escalation-routing"
TASK_DIR="${BENCH_TASK_DIR:-/benchmark/tasks/$TASK_ID}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-/benchmark/private/$TASK_ID}}"
WORKDIR="${BENCH_WORKDIR:-/task}"
OUTDIR="${BENCH_OUTPUT_DIR:-$WORKDIR/outputs}"
AUTH_TOKEN="${MOCK_AUTH_TOKEN:-local-mock-token}"
ERROR_RATE="${MOCK_ERROR_RATE:-0}"
mkdir -p "$OUTDIR/mock_audit" "$OUTDIR/mock_state" "$WORKDIR/tmp"
PIDFILE="$WORKDIR/tmp/mock_service_pids"
: > "$PIDFILE"
SERVER="$TASK_DIR/services/mock_api_server.py"
PRIVATE_REPLIES="$PRIVATE_DIR/reactive_replies.json"
wait_health() {
  local url="$1"
  for _ in $(seq 1 30); do
    python3 - "$url" <<'PY' >/dev/null 2>&1 && return 0 || true
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=1).read()
PY
    sleep 0.2
  done
  return 1
}
start_one() {
  local service="$1" port="$2" fixture="$3" audit="$4"
  if python3 - "$port" <<'PY' >/dev/null 2>&1; then
import sys, urllib.request
urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/health", timeout=0.5).read()
PY
    echo "$service already running on $port"
    return 0
  fi
  local private_arg=()
  if [[ -f "$PRIVATE_REPLIES" ]]; then
    private_arg=(--private-fixture "$PRIVATE_REPLIES")
  fi
  nohup python3 "$SERVER" --service "$service" --port "$port" --fixture "$fixture" "${private_arg[@]}" --audit "$audit" --auth-token "$AUTH_TOKEN" --error-rate "$ERROR_RATE" > "$WORKDIR/tmp/${service}.log" 2>&1 &
  echo "$!" >> "$PIDFILE"
  wait_health "http://127.0.0.1:$port/health"
}
start_one "slack" "9110" "$PRIVATE_DIR/mock_runtime/slack_messages.json" "$OUTDIR/mock_audit/slack_audit.json"
start_one "contacts" "9103" "$PRIVATE_DIR/mock_runtime/contacts.json" "$OUTDIR/mock_audit/contacts_audit.json"
echo "Mock services ready. Use Authorization: Bearer $AUTH_TOKEN. Audit files are under $OUTDIR/mock_audit; state snapshots under $OUTDIR/mock_state"
