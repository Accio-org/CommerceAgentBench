#!/usr/bin/env bash
# Launch the runtime-loaded gmail_mock copied by the harness under
# $BENCH_RUNTIME_MOCKS_DIR on :3071, seeded with THIS task's corpus. gmail_mock
# seeds a fresh per-run SQLite DB from seeds/*.json on first boot; to inject
# this task's mailbox we overwrite the copied seeds with files shipped under the
# private dir, point GMAIL_MOCK_DB at a fresh writable path, and let it reseed.
# The full-state endpoint stays verifier-token protected; the agent uses the
# Workspace-style Gmail tool surface instead.
set -euo pipefail

TASK_ID="api-gmail-supplier-rfq-triage"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
SERVICE_ROOT="${BENCH_RUNTIME_MOCK_GMAIL_MOCK_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/gmail_mock}"
PORT="3071"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
STATE_URL="http://127.0.0.1:${PORT}/api/state"
SEED_SRC="${PRIVATE_DIR}/mock_runtime/gmail_seeds"

mkdir -p "$WORKDIR/tmp"
LOG_FILE="$WORKDIR/tmp/gmail_mock.log"
PID_FILE="$WORKDIR/tmp/gmail_mock.pid"
DB_FILE="$WORKDIR/tmp/gmail.db"

[[ -d "$SERVICE_ROOT" ]] || { echo "gmail_mock runtime source missing at $SERVICE_ROOT" >&2; exit 2; }
command -v bun >/dev/null 2>&1 || { echo "bun not found in container" >&2; exit 2; }
[[ -d "$SEED_SRC" ]] || { echo "task seeds missing at $SEED_SRC" >&2; exit 3; }
ls "$SEED_SRC"/*.json >/dev/null 2>&1 || { echo "no seed json under $SEED_SRC" >&2; exit 3; }

# Inject this task's corpus over the copied default seeds, then force a fresh reseed.
cp "$SEED_SRC"/*.json "$SERVICE_ROOT/seeds/"
rm -rf "$SERVICE_ROOT/data" "$DB_FILE" "${DB_FILE}-shm" "${DB_FILE}-wal"

probe() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

cd "$SERVICE_ROOT"
PORT="$PORT" GMAIL_MOCK_DB="$DB_FILE" GMAIL_MOCK_MODE=mcp nohup bun server.js >"$LOG_FILE" 2>&1 &
echo "$!" > "$PID_FILE"

ready=0
for _ in $(seq 1 60); do
  if probe "$HEALTH_URL"; then ready=1; break; fi
  sleep 0.5
done
if [[ "$ready" != "1" ]]; then
  echo "gmail_mock failed to become ready within 30s; tail of $LOG_FILE:" >&2
  tail -n 50 "$LOG_FILE" >&2 || true
  exit 1
fi

# Report how many messages loaded (sanity for the launch log).
count="$(python3 - "$STATE_URL" "${MOCK_VERIFIER_TOKEN:-bench-verifier}" <<'PY'
import sys, json, urllib.request
try:
    req = urllib.request.Request(sys.argv[1], headers={"X-Mock-Verifier-Token": sys.argv[2]})
    s = json.loads(urllib.request.urlopen(req, timeout=5).read())
    print(len(s.get("messages", [])))
except Exception as e:
    print(f"ERR {e}")
PY
)"
echo "gmail_mock ready on :$PORT (messages=$count, pid=$(cat "$PID_FILE"))"
exit 0
