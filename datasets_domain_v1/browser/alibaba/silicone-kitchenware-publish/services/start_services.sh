#!/usr/bin/env bash
# Launch the alibaba_publish mock site bundled into the derived workstation
# image at /opt/mock_services/alibaba_publish/. Runs under Bun (already in
# the workstation), persists SQLite under /opt/mock_services/alibaba_publish/data,
# and waits for the service to answer /health before returning.
set -euo pipefail

TASK_ID="browser-alibaba-silicone-kitchenware-publish"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
SERVICE_ROOT="/opt/mock_services/alibaba_publish"
LISTEN_PORT="${ALIBABA_PUBLISH_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${LISTEN_PORT}/health"
LEGACY_HEALTH_URL="http://127.0.0.1:${LISTEN_PORT}/api/fields"

mkdir -p "$WORKDIR/tmp"
PID_FILE="$WORKDIR/tmp/alibaba_publish.pid"
LOG_FILE="$WORKDIR/tmp/alibaba_publish.log"

if [[ ! -d "$SERVICE_ROOT" ]]; then
  echo "alibaba_publish source missing at $SERVICE_ROOT; expected the workstation image to be acciolyk/accio_bench@sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859" >&2
  exit 2
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found in container; cannot launch alibaba_publish mock" >&2
  exit 2
fi

probe_health() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

if probe_health "$HEALTH_URL" || probe_health "$LEGACY_HEALTH_URL"; then
  echo "alibaba_publish already running on $LISTEN_PORT"
  exit 0
fi

cd "$SERVICE_ROOT"
PORT="$LISTEN_PORT" \
  MOCK_VERIFIER_TOKEN="${MOCK_VERIFIER_TOKEN:-}" \
  DB_PATH="$SERVICE_ROOT/data/benchmark.db" \
  nohup bun server.js >"$LOG_FILE" 2>&1 &
echo "$!" > "$PID_FILE"

for _ in $(seq 1 60); do
  if probe_health "$HEALTH_URL" || probe_health "$LEGACY_HEALTH_URL"; then
    echo "alibaba_publish ready on port $LISTEN_PORT (pid=$(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 0.5
done

echo "alibaba_publish failed to become ready within 30s; tail of $LOG_FILE:" >&2
tail -n 50 "$LOG_FILE" >&2 || true
exit 1
