#!/usr/bin/env bash
# Launch the serpapi_replay mock at port 4500.
#
# Mock-loading convention: source ships under the task's private/mock_runtime/
# subtree and the harness copies it into ${BENCH_PRIVATE_DIR}/mock_runtime/
# inside the container. No image rebuild is needed; bun is already present in
# the workstation image.
set -euo pipefail

TASK_ID="cli-amazon-headphone-sourcing"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-/benchmark/runtime/private/$TASK_ID}}"
SERVICE_ROOT="${PRIVATE_DIR}/mock_runtime/serpapi_replay"
LISTEN_PORT="${SERPAPI_REPLAY_PORT:-4500}"
HEALTH_URL="http://127.0.0.1:${LISTEN_PORT}/health"

mkdir -p "$WORKDIR/tmp"
PID_FILE="$WORKDIR/tmp/mock_service_pids"
LOG_FILE="$WORKDIR/tmp/serpapi_replay.log"
: > "$PID_FILE"

if [[ ! -d "$SERVICE_ROOT" ]]; then
  cat >&2 <<EOF
serpapi_replay source missing at $SERVICE_ROOT.

Expected the harness to copy this task's private/mock_runtime/serpapi_replay/
into \${BENCH_PRIVATE_DIR}/mock_runtime/. Verify the harness handles the
mock_runtime/ subdirectory.
EOF
  exit 2
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found in container; cannot launch serpapi_replay" >&2
  exit 2
fi

probe_health() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

if probe_health "$HEALTH_URL"; then
  echo "serpapi_replay already running on $LISTEN_PORT"
  exit 0
fi

cd "$SERVICE_ROOT"
PORT="$LISTEN_PORT" nohup bun server.js >"$LOG_FILE" 2>&1 &
echo "$!" >> "$PID_FILE"

for _ in $(seq 1 60); do
  if probe_health "$HEALTH_URL"; then
    echo "serpapi_replay ready: $HEALTH_URL (pid=$(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 0.5
done

echo "serpapi_replay failed to become ready within 30s; tail of $LOG_FILE:" >&2
tail -n 50 "$LOG_FILE" >&2 || true
exit 1
