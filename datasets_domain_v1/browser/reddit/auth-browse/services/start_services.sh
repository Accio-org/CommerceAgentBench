#!/usr/bin/env bash
# Launch the reddit_mock forum site bundled into the derived workstation
# image at /opt/mock_services/reddit_mock/. Runs under Bun (already in
# the workstation), waits for /health before returning.
set -euo pipefail

TASK_ID="browser-reddit-auth-browse"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
OUTDIR="${BENCH_OUTPUT_DIR:-${CONTAINER_OUTPUT_DIR:-$WORKDIR/outputs}}"
SERVICE_ROOT="/opt/mock_services/reddit_mock"
LISTEN_PORT="${REDDIT_MOCK_PORT:-3001}"
HEALTH_URL="http://127.0.0.1:${LISTEN_PORT}/health"

mkdir -p "$WORKDIR/tmp" "$OUTDIR/mock_audit"
PID_FILE="$WORKDIR/tmp/mock_service_pids"
LOG_FILE="$WORKDIR/tmp/reddit_mock.log"
: > "$PID_FILE"

if [[ ! -d "$SERVICE_ROOT" ]]; then
  echo "reddit_mock source missing at $SERVICE_ROOT; expected the workstation image to be acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859" >&2
  exit 2
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found in container; cannot launch reddit_mock" >&2
  exit 2
fi

probe_health() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

if probe_health "$HEALTH_URL"; then
  echo "reddit_mock already running on $LISTEN_PORT"
  exit 0
fi

cd "$SERVICE_ROOT"
PORT="$LISTEN_PORT" \
  MOCK_VERIFIER_TOKEN="${MOCK_VERIFIER_TOKEN:-}" \
  nohup bun server.js >"$LOG_FILE" 2>&1 &
echo "$!" >> "$PID_FILE"

for _ in $(seq 1 60); do
  if probe_health "$HEALTH_URL"; then
    echo "reddit_mock ready: http://127.0.0.1:${LISTEN_PORT}/session/source (pid=$(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 0.5
done

echo "reddit_mock failed to become ready within 30s; tail of $LOG_FILE:" >&2
tail -n 50 "$LOG_FILE" >&2 || true
exit 1
