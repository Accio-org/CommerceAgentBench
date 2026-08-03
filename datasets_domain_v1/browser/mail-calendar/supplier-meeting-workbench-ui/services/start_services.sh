#!/usr/bin/env bash
set -euo pipefail

TASK_ID="browser-mail-calendar-supplier-meeting-workbench-ui"
WORKDIR="${CONTAINER_WORKDIR:-/task}"
TASK_DIR="${CONTAINER_TASK_DIR:-/benchmark/tasks/${TASK_ID}}"
PRIVATE_DIR="${CONTAINER_PRIVATE_DIR:-/benchmark/private/${TASK_ID}}"
mkdir -p "${WORKDIR}/tmp" "${WORKDIR}/outputs/mock_audit" "${WORKDIR}/outputs/mock_state"

PID_FILE="${WORKDIR}/tmp/mock_service_pids"
if [[ -f "${PID_FILE}" ]]; then
  while read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done < "${PID_FILE}"
fi
: > "${PID_FILE}"

python3 "${TASK_DIR}/services/mock_workbench_server.py" \
  --fixture "${PRIVATE_DIR}/mock_runtime/workbench_state.json" \
  --private-fixture "${PRIVATE_DIR}/reactive_replies.json" \
  --output-dir "${WORKDIR}/outputs" \
  --port 9200 \
  > "${WORKDIR}/tmp/workbench.log" 2>&1 &
echo "$!" >> "${PID_FILE}"

sleep 0.6
python3 - <<'PY'
import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:9200/health", timeout=3) as resp:
    print(resp.read().decode())
PY

echo "Mock workbench ready: http://127.0.0.1:9200/workbench"
