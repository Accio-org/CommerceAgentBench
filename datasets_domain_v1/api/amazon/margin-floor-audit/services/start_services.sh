#!/usr/bin/env bash
# Launch the runtime-loaded amazon_sp_api mock copied by the harness under
# $BENCH_RUNTIME_MOCKS_DIR on :4000, wait for /__bench/health, then load this
# task's dataset via POST /__bench/seed (verifier-token gated). The seed lives
# in the mock private dir (shipped + scrubbed by the harness), so the agent
# never sees it.
set -euo pipefail

TASK_ID="api-amazon-margin-floor-audit"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
SERVICE_ROOT="${BENCH_RUNTIME_MOCK_AMAZON_SP_API_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/amazon_sp_api}"
PORT="4000"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"
HEALTH_URL="http://127.0.0.1:${PORT}/__bench/health"
SEED_FILE="${PRIVATE_DIR}/mock_runtime/amazon_seed.json"

mkdir -p "$WORKDIR/tmp"
LOG_FILE="$WORKDIR/tmp/amazon_sp_api.log"
PID_FILE="$WORKDIR/tmp/amazon_sp_api.pid"

[[ -d "$SERVICE_ROOT" ]] || { echo "amazon_sp_api runtime source missing at $SERVICE_ROOT" >&2; exit 2; }
command -v bun >/dev/null 2>&1 || { echo "bun not found in container" >&2; exit 2; }
[[ -f "$SEED_FILE" ]] || { echo "task seed missing at $SEED_FILE" >&2; exit 3; }

probe() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

cd "$SERVICE_ROOT"
PORT="$PORT" MOCK_PORT="$PORT" MOCK_VERIFIER_TOKEN="$TOKEN" \
  nohup bun server.js >"$LOG_FILE" 2>&1 &
echo "$!" > "$PID_FILE"

ready=0
for _ in $(seq 1 60); do
  if probe "$HEALTH_URL"; then ready=1; break; fi
  sleep 0.5
done
if [[ "$ready" != "1" ]]; then
  echo "amazon_sp_api failed to become ready within 30s; tail of $LOG_FILE:" >&2
  tail -n 50 "$LOG_FILE" >&2 || true
  exit 1
fi

# Load this task's dataset (resets the store first, then loads).
seed_status="$(python3 - "$PORT" "$TOKEN" "$SEED_FILE" <<'PY'
import sys, json, urllib.request
port, token, path = sys.argv[1], sys.argv[2], sys.argv[3]
body = open(path, "rb").read()
req = urllib.request.Request(f"http://127.0.0.1:{port}/__bench/seed", data=body, method="POST",
                             headers={"Authorization": f"Bearer {token}", "content-type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=20)
    out = json.loads(r.read())
    print("ok", out.get("counts", {}).get("listings"), out.get("counts", {}).get("orders"))
except Exception as e:
    print("ERR", e); raise SystemExit(1)
PY
)" || { echo "amazon_sp_api seed POST failed: $seed_status" >&2; exit 4; }

echo "amazon_sp_api ready + seeded on :$PORT ($seed_status, pid=$(cat "$PID_FILE"))"
exit 0
