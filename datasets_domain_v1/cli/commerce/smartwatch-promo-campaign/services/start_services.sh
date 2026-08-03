#!/usr/bin/env bash
set -euo pipefail

TASK_ID="cli-commerce-smartwatch-promo-campaign"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LISTEN_PORT="${DTC_CAMPAIGN_PORT:-${MOCK_PORT:-3000}}"
HEALTH_URL="http://127.0.0.1:${LISTEN_PORT}/health"

mkdir -p "$WORKDIR/tmp"
PID_FILE="$WORKDIR/tmp/dtc_campaign.pid"
LOG_FILE="$WORKDIR/tmp/dtc_campaign.log"

probe_health() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

if probe_health "$HEALTH_URL"; then
  echo "dtc_campaign already running on $LISTEN_PORT"
  exit 0
fi

if command -v setsid >/dev/null 2>&1; then
  MOCK_PORT="$LISTEN_PORT" \
    MOCK_CLI_TOKEN="${MOCK_CLI_TOKEN:-local-mock-token}" \
    setsid python3 "$SCRIPT_DIR/mock_form_server.py" >"$LOG_FILE" 2>&1 &
else
  MOCK_PORT="$LISTEN_PORT" \
    MOCK_CLI_TOKEN="${MOCK_CLI_TOKEN:-local-mock-token}" \
    nohup python3 "$SCRIPT_DIR/mock_form_server.py" >"$LOG_FILE" 2>&1 &
fi
echo "$!" > "$PID_FILE"

for _ in $(seq 1 60); do
  if probe_health "$HEALTH_URL"; then
    echo "dtc_campaign ready on port $LISTEN_PORT (pid=$(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 0.5
done

echo "dtc_campaign failed to become ready within 30s; tail of $LOG_FILE:" >&2
tail -n 50 "$LOG_FILE" >&2 || true
exit 1
