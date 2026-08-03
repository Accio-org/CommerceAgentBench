#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"
START="${CCB_DAEMON_CLI_START:-/opt/mock_services/cli_daemon/start-daemon-cli-mock}"

[[ -x "$START" ]] || { echo "daemon_cli helper missing at $START" >&2; exit 2; }

# --- DWS doc CLI ---
DWS_ROOT="${BENCH_RUNTIME_MOCK_DWS_DOC_CLI_DIR:-/opt/mock_services/dws_doc_cli}"
DWS_PORT="${BENCH_RUNTIME_MOCK_DWS_DOC_CLI_PORT:-3400}"
"$START" --mock dws_doc_cli --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$DWS_PORT" --token "$TOKEN" --service-root "$DWS_ROOT"

# --- Stripe CLI ---
STRIPE_ROOT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/stripe_cli}"
STRIPE_PORT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_PORT:-3000}"
"$STRIPE_ROOT/bin/stripe-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$STRIPE_PORT" --token "$TOKEN"

# --- Box CLI ---
BOX_ROOT="${BENCH_RUNTIME_MOCK_BOX_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/box_cli}"
BOX_PORT="${BENCH_RUNTIME_MOCK_BOX_CLI_PORT:-3500}"
"$BOX_ROOT/bin/box-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$BOX_PORT" --token "$TOKEN"
