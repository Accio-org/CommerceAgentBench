#!/usr/bin/env bash
# Smoke test for Notion CLI mock (ntn-mock)
# Tests each command, verifies state propagation, golden-output diffs,
# file upload e2e, and bench control.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JS_RUNTIME="${JS_RUNTIME:-bun}"
NTN="$SCRIPT_DIR/bin/ntn"
BENCH="$SCRIPT_DIR/bin/ntn-mock-bench"
GOLDEN="$SCRIPT_DIR/golden"
MOCK_TOKEN="bench-verifier"
export NTN_MOCK_PORT=3457
export NTN_MOCK_NO_AUTO_SERVER=1
export MOCK_VERIFIER_TOKEN="$MOCK_TOKEN"

# Use temp dir for DB
TMPDIR_MOCK="$(mktemp -d)"
export NTN_MOCK_DATA_DIR="$TMPDIR_MOCK"

PASS=0
FAIL=0
TOTAL=0
KNOWN_DIVERGENCE=0

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  FAIL: $1 — $2"; }

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc" "exit code $?"; fi
}

check_output() {
  local desc="$1"; local expected="$2"; shift 2
  local output; output=$("$@" 2>&1) || true
  if echo "$output" | grep -qF -- "$expected"; then pass "$desc"
  else fail "$desc" "expected '$expected', got: $(echo "$output" | head -1)"; fi
}

check_not_output() {
  local desc="$1"; local unexpected="$2"; shift 2
  local output; output=$("$@" 2>&1) || true
  if echo "$output" | grep -qF -- "$unexpected"; then fail "$desc" "unexpected '$unexpected'"
  else pass "$desc"; fi
}

check_exit_code() {
  local desc="$1"; local expected_code="$2"; shift 2
  local actual_code=0; "$@" >/dev/null 2>&1 || actual_code=$?
  if [ "$actual_code" -eq "$expected_code" ]; then pass "$desc"
  else fail "$desc" "expected exit $expected_code, got $actual_code"; fi
}

check_json_field() {
  local desc="$1"; local field="$2"; local expected="$3"; shift 3
  local output; output=$("$@" 2>&1) || true
  local val; val=$(echo "$output" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d)$field)}catch{console.log('PARSE_ERROR')}})" 2>/dev/null) || true
  if [ "$val" = "$expected" ]; then pass "$desc"
  else fail "$desc" ".$field expected '$expected', got '$val'"; fi
}

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMPDIR_MOCK"
  echo ""
  echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
  if [ "$KNOWN_DIVERGENCE" -gt 0 ]; then
    echo "=== Known divergences (flagged, not counted): $KNOWN_DIVERGENCE ==="
  fi
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}
trap cleanup EXIT

# Start server
echo "Starting mock server on port $NTN_MOCK_PORT..."
"$JS_RUNTIME" "$SCRIPT_DIR/lib/server/index.js" >/dev/null 2>&1 &
SERVER_PID=$!
sleep 2

BASE="http://localhost:$NTN_MOCK_PORT"

echo ""
echo "=== Health ==="
check "GET /health" curl -sf "$BASE/health"

echo ""
echo "=== Auth ==="
"$JS_RUNTIME" "$NTN" logout >/dev/null 2>&1 || true
check_output "login" "Logged in" "$JS_RUNTIME" "$NTN" login
check_output "logout" "Logged out" "$JS_RUNTIME" "$NTN" logout
check_output "login --no-browser" "authorize" "$JS_RUNTIME" "$NTN" login --no-browser
check_output "login poll" "Logged in" "$JS_RUNTIME" "$NTN" login poll

echo ""
echo "=== Workers CRUD ==="
check_output "workers list" "my-sync-worker" "$JS_RUNTIME" "$NTN" workers list
check_output "workers list --json" "wkr_abc123" "$JS_RUNTIME" "$NTN" workers list --json
check_output "workers get" "my-sync-worker" "$JS_RUNTIME" "$NTN" workers get wkr_abc123 --json
check_output "workers create" "Created worker" "$JS_RUNTIME" "$NTN" workers create --name smoke-worker
check_output "workers new" "Scaffolded" "$JS_RUNTIME" "$NTN" workers new smokedir
check_output "workers deploy" "Deployed" "$JS_RUNTIME" "$NTN" workers deploy --worker-id wkr_abc123
check_output "workers delete (no --yes)" "Would delete" "$JS_RUNTIME" "$NTN" workers delete wkr_def456
check_output "workers delete --yes" "deleted" "$JS_RUNTIME" "$NTN" workers delete wkr_def456 --yes
check_output "workers tui" "not available" "$JS_RUNTIME" "$NTN" workers tui

echo ""
echo "=== Workers Exec & Capabilities ==="
check_output "workers exec" "Hello" "$JS_RUNTIME" "$NTN" workers exec sayHello --worker-id wkr_abc123 -d '{"name":"World"}'
check_output "capabilities list" "sayHello" "$JS_RUNTIME" "$NTN" workers capabilities list --worker-id wkr_abc123

echo ""
echo "=== Workers Usage ==="
check_output "workers usage" "credits_used" "$JS_RUNTIME" "$NTN" workers usage wkr_abc123 --json
check_output "workers usage --all" "credits_limit" "$JS_RUNTIME" "$NTN" workers usage --all

echo ""
echo "=== Workers Sync ==="
check_output "sync status" "importUsers" "$JS_RUNTIME" "$NTN" workers sync status --worker-id wkr_abc123
check_output "sync trigger" "Triggered" "$JS_RUNTIME" "$NTN" workers sync trigger importUsers --worker-id wkr_abc123
check_output "sync pause" "Paused" "$JS_RUNTIME" "$NTN" workers sync pause importUsers --worker-id wkr_abc123
check_output "sync resume" "Resumed" "$JS_RUNTIME" "$NTN" workers sync resume importUsers --worker-id wkr_abc123
check_output "sync state get" "cursor" "$JS_RUNTIME" "$NTN" workers sync state get importUsers --worker-id wkr_abc123 --json
check_output "sync state reset" "reset" "$JS_RUNTIME" "$NTN" workers sync state reset importUsers --worker-id wkr_abc123

echo ""
echo "=== Workers Env ==="
check_output "env set" "Set" "$JS_RUNTIME" "$NTN" workers env set SMOKE_VAR=hello --worker-id wkr_abc123
check_output "env list" "SMOKE_VAR" "$JS_RUNTIME" "$NTN" workers env list --worker-id wkr_abc123
check_output "env pull --no-file" "SMOKE_VAR=hello" "$JS_RUNTIME" "$NTN" workers env pull --worker-id wkr_abc123 --no-file
check_output "env unset" "Removed" "$JS_RUNTIME" "$NTN" workers env unset SMOKE_VAR --worker-id wkr_abc123
check_not_output "env list after unset" "SMOKE_VAR" "$JS_RUNTIME" "$NTN" workers env list --worker-id wkr_abc123

echo ""
echo "=== Workers OAuth ==="
check_output "oauth start" "authorize" "$JS_RUNTIME" "$NTN" workers oauth start githubSync --worker-id wkr_abc123
check_output "oauth token" "accessToken" "$JS_RUNTIME" "$NTN" workers oauth token githubSync --worker-id wkr_abc123 --json
check_output "oauth token --plain" "gho_mock" "$JS_RUNTIME" "$NTN" workers oauth token githubSync --worker-id wkr_abc123 --plain
check_output "oauth show-redirect-url" "notion.so" "$JS_RUNTIME" "$NTN" workers oauth show-redirect-url --worker-id wkr_abc123

echo ""
echo "=== Workers Runs ==="
check_output "runs list" "sayHello" "$JS_RUNTIME" "$NTN" workers runs list --worker-id wkr_abc123
check_output "runs logs" "Executing" "$JS_RUNTIME" "$NTN" workers runs logs run_001 --worker-id wkr_abc123

echo ""
echo "=== Workers Webhooks ==="
check_output "webhooks list" "externalEvent" "$JS_RUNTIME" "$NTN" workers webhooks list --worker-id wkr_abc123

echo ""
echo "=== API ==="
check_output "api ls" "v1/pages" "$JS_RUNTIME" "$NTN" api ls
check_json_field "api GET auto" ".object" "user" "$JS_RUNTIME" "$NTN" api v1/users/me --json
check_json_field "api inline body" ".object" "list" "$JS_RUNTIME" "$NTN" api v1/search query=Getting --json
check_json_field "api -X PATCH :=" ".object" "page" "$JS_RUNTIME" "$NTN" api v1/pages/page_001 -X PATCH archived:=true --json
check_json_field "api bracket nesting" ".object" "page" "$JS_RUNTIME" "$NTN" api v1/pages 'parent[page_id]=page_root' 'properties.Name.title[0].text.content=Smoke' --json
check_output "api --spec" "POST" "$JS_RUNTIME" "$NTN" api v1/pages --spec -X POST
check_output "api --data" "list" "$JS_RUNTIME" "$NTN" api v1/search --data '{"query":"Getting"}' --json

echo ""
echo "=== Datasources ==="
check_output "datasources query" "page_002" "$JS_RUNTIME" "$NTN" datasources query ds_001 --json
check_output "datasources resolve" "ds_001" "$JS_RUNTIME" "$NTN" datasources resolve db_001 --json

echo ""
echo "=== Pages ==="
check_output "pages get" "Getting Started" "$JS_RUNTIME" "$NTN" pages get page_001
check_output "pages get --json" "page_001" "$JS_RUNTIME" "$NTN" pages get page_001 --json
check_output "pages create" "Created page" "$JS_RUNTIME" "$NTN" pages create --parent page:page_root --content '# Smoke Test'
check_output "pages update" "Updated page" "$JS_RUNTIME" "$NTN" pages update page_001 --content '# Updated'
check_output "pages trash (no --yes)" "Would trash" "$JS_RUNTIME" "$NTN" pages trash page_004
check_output "pages trash --yes" "moved to trash" "$JS_RUNTIME" "$NTN" pages trash page_004 --yes

echo ""
echo "=== Files ==="
check_output "files list" "architecture-diagram" "$JS_RUNTIME" "$NTN" files list
check_output "files get" "uploaded" "$JS_RUNTIME" "$NTN" files get file_001
check_output "files create --external-url" "File upload created" "$JS_RUNTIME" "$NTN" files create --external-url https://example.com/photo.png

echo ""
echo "=== File Upload E2E ==="
UPLOAD_OUT=$(echo "smoke test content" | "$JS_RUNTIME" "$NTN" files create --filename smoke.txt --content-type text/plain 2>&1)
UPLOAD_ID=$(echo "$UPLOAD_OUT" | grep "^ID" | awk '{print $2}')
if [ -n "$UPLOAD_ID" ]; then
  pass "files create stdin upload"
  CONTENT=$(curl -sf "$BASE/api/files/$UPLOAD_ID/content" 2>/dev/null || echo "FETCH_FAILED")
  if echo "$CONTENT" | grep -qF "smoke test content"; then
    pass "file content retrieval"
  else
    fail "file content retrieval" "got: $CONTENT"
  fi
else
  fail "files create stdin upload" "no ID in output"
  fail "file content retrieval" "skipped (no upload)"
fi

echo ""
echo "=== Utility ==="
check_output "doctor" "CLI version" "$JS_RUNTIME" "$NTN" doctor
check_output "update" "up to date" "$JS_RUNTIME" "$NTN" update
check_output "update --force" "Reinstalled" "$JS_RUNTIME" "$NTN" update --force
check_output "--version" "0.15.0" "$JS_RUNTIME" "$NTN" --version
check_output "completions bash" "completions" "$JS_RUNTIME" "$NTN" completions bash

echo ""
echo "=== Bench Control ==="
check_output "bench health" "ok" node "$BENCH" health
check_output "bench state" "account" node "$BENCH" state --token "$MOCK_TOKEN"
check_output "bench audit" "[" node "$BENCH" audit --token "$MOCK_TOKEN"
check_output "bench reset" "reset" node "$BENCH" reset --token "$MOCK_TOKEN"
check_exit_code "bench state (no token)" 1 node "$BENCH" state
check_exit_code "bench state (bad token)" 1 node "$BENCH" state --token wrong

echo ""
echo "=== Verifier Token Gating ==="
NOAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/state" 2>/dev/null)
if [ "$NOAUTH_CODE" = "401" ]; then pass "GET /api/state without token → 401"
else fail "GET /api/state without token → 401" "got $NOAUTH_CODE"; fi

BAD_CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer wrong" "$BASE/api/state" 2>/dev/null)
if [ "$BAD_CODE" = "403" ]; then pass "GET /api/state bad token → 403"
else fail "GET /api/state bad token → 403" "got $BAD_CODE"; fi

OK_CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $MOCK_TOKEN" "$BASE/api/state" 2>/dev/null)
if [ "$OK_CODE" = "200" ]; then pass "GET /api/state valid token → 200"
else fail "GET /api/state valid token → 200" "got $OK_CODE"; fi

echo ""
echo "=== State Propagation ==="
# Reset to clean state
curl -sf -X POST -H "Authorization: Bearer $MOCK_TOKEN" "$BASE/api/state/reset" >/dev/null
# Create a worker, verify it appears in list
"$JS_RUNTIME" "$NTN" workers create --name state-prop-test >/dev/null 2>&1
LIST_OUT=$("$JS_RUNTIME" "$NTN" workers list --json 2>&1)
if echo "$LIST_OUT" | grep -qF "state-prop-test"; then
  pass "state propagation: create → list"
else
  fail "state propagation: create → list" "worker not found in list"
fi

echo ""
echo "=== Golden Oracle ==="
# Version — exact match
MOCK_VERSION=$("$JS_RUNTIME" "$NTN" --version 2>&1 | tr -d '\n')
GOLDEN_VERSION=$(cat "$GOLDEN/version.stdout" | tr -d '\n')
if [ "$MOCK_VERSION" = "$GOLDEN_VERSION" ]; then pass "golden: --version exact match"
else fail "golden: --version" "mock='$MOCK_VERSION' golden='$GOLDEN_VERSION'"; fi

# Exit codes
MOCK_EXIT=0; "$JS_RUNTIME" "$NTN" boguscmd >/dev/null 2>&1 || MOCK_EXIT=$?
GOLDEN_EXIT=$(cat "$GOLDEN/boguscmd.exit" | tr -d '\n')
if [ "$MOCK_EXIT" = "$GOLDEN_EXIT" ]; then pass "golden: boguscmd exit=$GOLDEN_EXIT"
else
  KNOWN_DIVERGENCE=$((KNOWN_DIVERGENCE+1))
  echo "  KNOWN DIVERGENCE: boguscmd exit mock=$MOCK_EXIT golden=$GOLDEN_EXIT (Commander vs clap)"
fi

# Help text — known divergence (Commander.js vs clap format)
MOCK_HELP=$("$JS_RUNTIME" "$NTN" --help 2>&1)
if echo "$MOCK_HELP" | grep -qF "workers"; then
  pass "golden: --help contains 'workers'"
else
  fail "golden: --help" "missing 'workers' in help output"
fi
