#!/usr/bin/env bash
set -euo pipefail

TASK_ID="cli-stripe-webhook-payment-pipeline"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
SERVICE_ROOT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/stripe_cli}"
PORT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_PORT:-3000}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

"$SERVICE_ROOT/bin/stripe-daemon-start" \
  --workdir "$WORKDIR" \
  --private-dir "$PRIVATE_DIR" \
  --port "$PORT" \
  --token "$TOKEN"
