#!/usr/bin/env bash
set -euo pipefail

TASK_ID="$(basename "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")"
TASK_DIR="${CONTAINER_TASK_DIR:-${BENCH_TASK_DIR:-/benchmark/tasks/${TASK_ID}}}"
WORKDIR="${CONTAINER_WORKDIR:-${BENCH_WORKDIR:-/task}}"
OUTDIR="${CONTAINER_OUTPUT_DIR:-${BENCH_OUTPUT_DIR:-${WORKDIR}/outputs}}"
SERVICE_ROOT="${TASK_DIR}/services/logistics_tracker"
PID_FILE="${WORKDIR}/tmp/mock_service_pids"
PORT="3003"

mkdir -p "${WORKDIR}/tmp" "${OUTDIR}/mock_audit" "${OUTDIR}/mock_state"
: > "${PID_FILE}"

if ! command -v node >/dev/null 2>&1; then
  echo "node runtime is required for logistics_tracker mock" >&2
  exit 2
fi

if [[ ! -f "${SERVICE_ROOT}/server.js" ]]; then
  echo "missing logistics tracker server: ${SERVICE_ROOT}/server.js" >&2
  exit 2
fi

cd "${SERVICE_ROOT}"

if [[ ! -d node_modules ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm runtime is required to install logistics_tracker mock dependencies" >&2
    exit 2
  fi
  npm ci --omit=dev --no-audit --no-fund \
    --cache "${WORKDIR}/tmp/npm-cache" \
    --registry="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
fi

PRELOAD_FILE="${WORKDIR}/tmp/logistics_tracker_preload.cjs"
cat > "${PRELOAD_FILE}" <<'NODE'
const path = require('path');
const { createRequire } = require('module');

const serviceRoot = process.env.LOGISTICS_TRACKER_SERVICE_ROOT;
if (!serviceRoot) {
  throw new Error('LOGISTICS_TRACKER_SERVICE_ROOT is required');
}

const serviceRequire = createRequire(path.join(serviceRoot, 'server.js'));
const iconv = serviceRequire('iconv-lite');

if (!iconv.encodingExists('utf8')) {
  throw new Error('failed to preload iconv-lite utf8 encoding');
}

serviceRequire('body-parser');
serviceRequire('body-parser/lib/types/json');
serviceRequire('body-parser/lib/types/urlencoded');
serviceRequire('raw-body');
NODE

LOGISTICS_TRACKER_SERVICE_ROOT="${SERVICE_ROOT}" \
  nohup node -r "${PRELOAD_FILE}" server.js > "${WORKDIR}/tmp/logistics_tracker.log" 2>&1 &
echo "$!" >> "${PID_FILE}"

python3 - "${PORT}" <<'PY'
import sys
import time
import urllib.request

port = sys.argv[1]
url = f"http://127.0.0.1:{port}/health"
for _ in range(80):
    try:
        urllib.request.urlopen(url, timeout=1).read()
        print("logistics_tracker mock ready")
        break
    except Exception:
        time.sleep(0.25)
else:
    raise SystemExit("logistics_tracker mock failed health check")
PY

echo "FreightOS mock ready: http://127.0.0.1:${PORT}/login"
