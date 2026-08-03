#!/usr/bin/env bash
set -euo pipefail

# Start BOTH mock services for the stripe -> jira renewal-risk task:
#   - stripe_cli (source: subscription data, seeded from private/) on port 3000
#   - jira_cli (sink: PROJ project for renewal-risk issues) on port 3100
# The harness publishes both ports and exposes them to the verifier as
#   MOCK_SITE_URL_STRIPE_CLI / MOCK_SITE_URL_JIRA_CLI.

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_ID="${BENCH_TASK_ID:-$(basename "$TASK_DIR")}"
WORKDIR="${BENCH_WORKDIR:-${CONTAINER_WORKDIR:-/task}}"
PRIVATE_DIR="${BENCH_PRIVATE_DIR:-${CONTAINER_PRIVATE_DIR:-}}"
TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

# --- source: stripe_cli ---
STRIPE_ROOT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/stripe_cli}"
STRIPE_PORT="${BENCH_RUNTIME_MOCK_STRIPE_CLI_PORT:-3000}"
"$STRIPE_ROOT/bin/stripe-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$STRIPE_PORT" --token "$TOKEN"

# --- sink: jira_cli ---
JIRA_ROOT="${BENCH_RUNTIME_MOCK_JIRA_CLI_DIR:-${BENCH_RUNTIME_MOCKS_DIR:-}/jira_cli}"
JIRA_PORT="${BENCH_RUNTIME_MOCK_JIRA_CLI_PORT:-3100}"
"$JIRA_ROOT/bin/jira-daemon-start" \
  --workdir "$WORKDIR" --private-dir "$PRIVATE_DIR" \
  --port "$JIRA_PORT" --token "$TOKEN"
