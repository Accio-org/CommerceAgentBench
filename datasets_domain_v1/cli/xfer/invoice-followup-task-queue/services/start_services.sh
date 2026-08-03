#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

STRIPE_ROOT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/stripe_cli}"
STRIPE_PORT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_PORT:-3000}"
"$STRIPE_ROOT/bin/stripe-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$STRIPE_PORT" --token "$TOKEN"

TODOIST_ROOT="${BENCH_RUNTIME_MOCK_TODOIST_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/todoist_cli}"
TODOIST_PORT="${BENCH_RUNTIME_MOCK_TODOIST_CLI_PORT:-3200}"
"$TODOIST_ROOT/bin/todoist-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$TODOIST_PORT" --token "$TOKEN"
