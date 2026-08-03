#!/usr/bin/env bash
set -euo pipefail

TASK_ID="cli-google-trends-counterfactual-rebalance"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-/benchmark/runtime/private/$TASK_ID}}"
SERVICE_ROOT="${PRIVATE_DIR}/mock_runtime/serpapi_trends_replay"
LISTEN_PORT="${SERPAPI_TRENDS_PORT:-4500}"
HEALTH_URL="http://127.0.0.1:${LISTEN_PORT}/health"

mkdir -p "$WORKDIR/tmp"
PID_FILE="$WORKDIR/tmp/mock_service_pids"
LOG_FILE="$WORKDIR/tmp/serpapi_trends_replay.log"
: > "$PID_FILE"

if [[ ! -d "$SERVICE_ROOT" ]]; then
  echo "serpapi_trends_replay source missing at $SERVICE_ROOT" >&2
  exit 2
fi
command -v bun >/dev/null 2>&1 || { echo "bun not found" >&2; exit 2; }

probe_health() { python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

if probe_health "$HEALTH_URL"; then
  echo "serpapi_trends_replay already running on $LISTEN_PORT"; exit 0
fi

cd "$SERVICE_ROOT"
PORT="$LISTEN_PORT" nohup bun server.js >"$LOG_FILE" 2>&1 &
echo "$!" >> "$PID_FILE"

for _ in $(seq 1 60); do
  if probe_health "$HEALTH_URL"; then
    echo "serpapi_trends_replay ready"; exit 0
  fi
  sleep 0.5
done

echo "serpapi_trends_replay failed within 30s" >&2
tail -n 50 "$LOG_FILE" >&2 || true
exit 1
