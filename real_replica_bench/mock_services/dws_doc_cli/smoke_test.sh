#!/usr/bin/env bash
# Smoke test for DingTalk Workspace CLI (dws) doc mock
# Tests each command, verifies state propagation, checks error handling,
# closed-set enum validation, bench binary token guard, and golden diffs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOCK_HOME="$(mktemp -d)"
export DWS_MOCK_HOME="$MOCK_HOME"

DWS="bun $SCRIPT_DIR/bin/dws.js"
BENCH="bun $SCRIPT_DIR/bin/dws-bench.js"
GOLDEN="$SCRIPT_DIR/golden"

PASS=0
FAIL=0
TOTAL=0

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  FAIL: $1 — $2"; }

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc" "exit code $?"
  fi
}

check_output() {
  local desc="$1"
  local expected="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -qF "$expected"; then
    pass "$desc"
  else
    fail "$desc" "expected '$expected' in output"
  fi
}

check_not_output() {
  local desc="$1"
  local unexpected="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -qF "$unexpected"; then
    fail "$desc" "unexpected '$unexpected' in output"
  else
    pass "$desc"
  fi
}

check_exit_code() {
  local desc="$1"
  local expected_code="$2"
  shift 2
  local actual_code=0
  "$@" >/dev/null 2>&1 || actual_code=$?
  if [ "$actual_code" -eq "$expected_code" ]; then
    pass "$desc"
  else
    fail "$desc" "expected exit code $expected_code, got $actual_code"
  fi
}

check_json_field() {
  local desc="$1"
  local jq_expr="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $jq_expr, 'assertion failed'" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc" "json assertion '$jq_expr' failed"
  fi
}

golden_diff() {
  local desc="$1"
  local fixture="$2"
  shift 2
  local tmpout tmpstderr actual_exit
  tmpout="$(mktemp)"
  tmpstderr="$(mktemp)"
  actual_exit=0
  "$@" >"$tmpout" 2>"$tmpstderr" || actual_exit=$?
  local expected_exit
  expected_exit=$(cat "$GOLDEN/$fixture.exit" | tr -d '[:space:]')

  local ok=true
  if [ "$actual_exit" != "$expected_exit" ]; then
    fail "$desc (exit)" "expected $expected_exit, got $actual_exit"
    ok=false
  fi
  if ! diff -q "$GOLDEN/$fixture.stdout" "$tmpout" >/dev/null 2>&1; then
    fail "$desc (stdout)" "diff vs golden"
    diff "$GOLDEN/$fixture.stdout" "$tmpout" || true
    ok=false
  fi
  if ! diff -q "$GOLDEN/$fixture.stderr" "$tmpstderr" >/dev/null 2>&1; then
    fail "$desc (stderr)" "diff vs golden"
    diff "$GOLDEN/$fixture.stderr" "$tmpstderr" || true
    ok=false
  fi
  if [ "$ok" = true ]; then
    pass "$desc"
  fi
  rm -f "$tmpout" "$tmpstderr"
}

cleanup() {
  rm -rf "$MOCK_HOME"
  echo ""
  echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
}
trap cleanup EXIT

echo "=== DWS Doc CLI Mock Smoke Test ==="
echo "Mock home: $MOCK_HOME"

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Golden Oracle ---"
golden_diff "golden: version" "version" $DWS --version
golden_diff "golden: help" "help" $DWS --help
golden_diff "golden: doc help" "doc-help" $DWS doc --help
golden_diff "golden: boguscmd" "boguscmd" $DWS boguscmd

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Bench Token Guard ---"
check_output "bench health (no token)" '"status": "ok"' $BENCH health
check_exit_code "bench health exit 0" 0 $BENCH health

check_output "bench state wrong token rejected" "invalid or missing verifier token" $BENCH state --token WRONG
check_exit_code "bench state wrong token exit 1" 1 $BENCH state --token WRONG

check_output "bench state no token rejected" "invalid or missing verifier token" $BENCH state
check_exit_code "bench state no token exit 1" 1 $BENCH state

check_output "bench reset correct token" "reset to default" $BENCH reset --token bench-verifier
check_exit_code "bench reset exit 0" 0 $BENCH reset --token bench-verifier

check_output "bench state correct token" '"documents"' $BENCH state --token bench-verifier
check_output "bench audit correct token" '"audit"' $BENCH audit --token bench-verifier

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Version & Help ---"
check_output "version" "1.0.33" $DWS --version
check_output "help has MCP Services" "Discovered MCP Services" $DWS --help
check_output "help has doc" "doc" $DWS --help
check_output "doc help has search" "search" $DWS doc --help
check_output "doc help has block" "block" $DWS doc --help
check_output "doc help has comment" "comment" $DWS doc --help

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Unknown Command ---"
check_exit_code "unknown cmd exits 5" 5 $DWS boguscmd
check_output "unknown cmd error message" "unknown command" $DWS boguscmd

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Auth ---"
check_output "auth help" "认证凭证" $DWS auth --help
check_output "auth login help" "登录钉钉" $DWS auth login --help
check_output "auth status (not logged in)" "未登录" $DWS auth status --format json
check_exit_code "doc list without auth exits 2" 2 $DWS doc list --workspace X --format json
check_output "doc list without auth error" "未登录" $DWS doc list --workspace X --format json

check_output "auth login succeeds" "登录成功" $DWS auth login --client-id mock-key --client-secret mock-secret --format json
check_output "auth status (logged in)" "authenticated" $DWS auth status --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Reset & Seeded State ---"
$DWS mock-reset >/dev/null 2>&1

check_output "doc list has seeded docs" "success" $DWS doc list --workspace Y7kmbeElo8lkqXLq --format json
check_output "doc list has folder" "我的文档" $DWS doc list --workspace Y7kmbeElo8lkqXLq --format json
check_output "doc search finds API doc" "API" $DWS doc search --query "API" --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Doc Info ---"
check_output "doc info returns name" "API 设计规范" $DWS doc info --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
check_output "doc info returns nodeId" "dxXB52LJqnX4ovLvfMoneyXo8qjMp697" $DWS doc info --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Doc Read ---"
check_output "doc read returns content" "API 设计规范" $DWS doc read --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json
check_output "doc read returns markdown" "RESTful" $DWS doc read --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --format json

# URL-style node ID
check_output "doc read with URL node" "API 设计规范" $DWS doc read --node "https://alidocs.dingtalk.com/i/nodes/dxXB52LJqnX4ovLvfMoneyXo8qjMp697" --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Doc Create + State Propagation ---"
CREATE_OUT=$($DWS doc create --name "Smoke Test Doc" --markdown "# Hello" --yes --format json 2>&1)
check_output "create returns success" "success" echo "$CREATE_OUT"
CREATED_ID=$(echo "$CREATE_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['nodeId'])" 2>/dev/null || echo "")

if [ -n "$CREATED_ID" ]; then
  check_output "read created doc" "Hello" $DWS doc read --node "$CREATED_ID" --format json
  pass "create → read propagation"
else
  fail "create → read propagation" "could not extract nodeId from create output"
fi

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Doc Update (overwrite + append) ---"
if [ -n "$CREATED_ID" ]; then
  $DWS doc update --node "$CREATED_ID" --content "# Overwritten" --mode overwrite --yes --format json >/dev/null 2>&1
  check_output "overwrite replaces content" "Overwritten" $DWS doc read --node "$CREATED_ID" --format json
  check_not_output "overwrite removes old content" "Hello" $DWS doc read --node "$CREATED_ID" --format json

  $DWS doc update --node "$CREATED_ID" --content "# Appended" --mode append --yes --format json >/dev/null 2>&1
  check_output "append keeps old content" "Overwritten" $DWS doc read --node "$CREATED_ID" --format json
  check_output "append adds new content" "Appended" $DWS doc read --node "$CREATED_ID" --format json
fi

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Block CRUD ---"
if [ -n "$CREATED_ID" ]; then
  # Reset doc to known state
  $DWS doc update --node "$CREATED_ID" --content "# Base" --mode overwrite --yes --format json >/dev/null 2>&1

  # List blocks
  BLOCKS_OUT=$($DWS doc block list --node "$CREATED_ID" --format json 2>&1)
  check_output "block list returns blocks" '"blocks"' echo "$BLOCKS_OUT"

  # Insert block
  INSERT_OUT=$($DWS doc block insert --node "$CREATED_ID" --element '{"blockType":"paragraph","paragraph":{"text":"Inserted paragraph"}}' --format json 2>&1)
  check_output "block insert succeeds" "success" echo "$INSERT_OUT"

  # Verify insertion
  check_output "inserted block appears" "Inserted paragraph" $DWS doc read --node "$CREATED_ID" --format json

  # Get block ID
  BLOCK_LIST=$($DWS doc block list --node "$CREATED_ID" --format json 2>&1)
  BLOCK_ID=$(echo "$BLOCK_LIST" | python3 -c "
import sys,json
d = json.load(sys.stdin)
blocks = d.get('blocks', [])
for b in blocks:
  el = b.get('element', {})
  if el.get('blockType') == 'paragraph' and 'Inserted' in str(el.get('paragraph',{}).get('text','')):
    print(el['id']); break
" 2>/dev/null || echo "")

  if [ -n "$BLOCK_ID" ]; then
    # Update block
    $DWS doc block update --node "$CREATED_ID" --block-id "$BLOCK_ID" --element '{"blockType":"paragraph","paragraph":{"text":"Updated paragraph"}}' --format json >/dev/null 2>&1
    check_output "block update propagates" "Updated paragraph" $DWS doc read --node "$CREATED_ID" --format json

    # Delete block
    $DWS doc block delete --node "$CREATED_ID" --block-id "$BLOCK_ID" --yes --format json >/dev/null 2>&1
    check_not_output "block delete removes it" "Updated paragraph" $DWS doc read --node "$CREATED_ID" --format json
  else
    fail "block update/delete" "could not extract blockId"
  fi
fi

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Comment CRUD ---"
TARGET_NODE="dxXB52LJqnX4ovLvfMoneyXo8qjMp697"

# List existing comments
check_output "comment list returns commentList" "commentList" $DWS doc comment list --node "$TARGET_NODE" --format json

# Create global comment
COMMENT_OUT=$($DWS doc comment create --node "$TARGET_NODE" --content "Smoke test comment" --format json 2>&1)
check_output "comment create succeeds" "commentKey" echo "$COMMENT_OUT"
COMMENT_KEY=$(echo "$COMMENT_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('commentKey',''))" 2>/dev/null || echo "")

if [ -n "$COMMENT_KEY" ]; then
  # Verify comment appears in list
  check_output "created comment in list" "Smoke test comment" $DWS doc comment list --node "$TARGET_NODE" --format json

  # Reply to comment
  REPLY_OUT=$($DWS doc comment reply --node "$TARGET_NODE" --comment-key "$COMMENT_KEY" --content "Reply to smoke test" --format json 2>&1)
  check_output "comment reply succeeds" "success" echo "$REPLY_OUT"
fi

# Create inline comment
BLOCK_LIST=$($DWS doc block list --node "$TARGET_NODE" --format json 2>&1)
FIRST_BLOCK=$(echo "$BLOCK_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['blocks'][0]['element']['id'])" 2>/dev/null || echo "")
if [ -n "$FIRST_BLOCK" ]; then
  INLINE_OUT=$($DWS doc comment create-inline --node "$TARGET_NODE" --block-id "$FIRST_BLOCK" --start 0 --end 5 --content "Inline smoke" --selected-text "API" --format json 2>&1)
  check_output "inline comment succeeds" "commentKey" echo "$INLINE_OUT"
fi

# ──────────────────────────────────────────────────────────
echo ""
echo "--- File/Folder Operations ---"

# Folder create
FOLDER_OUT=$($DWS doc folder create --name "SmokeFolderTest" --yes --format json 2>&1)
check_output "folder create succeeds" "success" echo "$FOLDER_OUT"
FOLDER_ID=$(echo "$FOLDER_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nodeId',''))" 2>/dev/null || echo "")

# File create (typed)
FILE_OUT=$($DWS doc file create --name "SmokeSheet" --type axls --yes --format json 2>&1)
check_output "file create axls succeeds" "success" echo "$FILE_OUT"

# Copy
if [ -n "$CREATED_ID" ] && [ -n "$FOLDER_ID" ]; then
  COPY_OUT=$($DWS doc copy --node "$CREATED_ID" --folder "$FOLDER_ID" --yes --format json 2>&1)
  check_output "doc copy succeeds" "success" echo "$COPY_OUT"
fi

# Move
if [ -n "$CREATED_ID" ] && [ -n "$FOLDER_ID" ]; then
  MOVE_OUT=$($DWS doc move --node "$CREATED_ID" --folder "$FOLDER_ID" --yes --format json 2>&1)
  check_output "doc move succeeds" "success" echo "$MOVE_OUT"
fi

# Rename
if [ -n "$CREATED_ID" ]; then
  RENAME_OUT=$($DWS doc rename --node "$CREATED_ID" --name "Renamed Smoke Doc" --yes --format json 2>&1)
  check_output "doc rename succeeds" "success" echo "$RENAME_OUT"
  check_output "renamed doc has new name" "Renamed Smoke Doc" $DWS doc info --node "$CREATED_ID" --format json
fi

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Closed-Set Enum Negative Tests ---"

# Invalid --mode
check_exit_code "invalid mode exits 1" 1 $DWS doc update --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --content "x" --mode invalid --format json
check_output "invalid mode error message" "Invalid mode" $DWS doc update --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --content "x" --mode invalid --format json

# Invalid --type for file create
check_exit_code "invalid file type exits 1" 1 $DWS doc file create --name "X" --type bogus --format json
check_output "invalid type error message" "Invalid type" $DWS doc file create --name "X" --type bogus --format json

# Invalid --where for block insert
check_output "invalid where error" "Invalid where" $DWS doc block insert --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --element '{"blockType":"paragraph","paragraph":{"text":"x"}}' --where bogus --format json

# Invalid --type for comment list
check_output "invalid comment type error" "Invalid type" $DWS doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --type bogus --format json

# Invalid --resolve-status for comment list
check_output "invalid resolve-status error" "Invalid resolve-status" $DWS doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --resolve-status bogus --format json

# Valid enum values accepted
check_output "valid mode overwrite accepted" "success" $DWS doc update --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --content "valid" --mode overwrite --format json
check_output "valid mode append accepted" "success" $DWS doc update --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --content "valid" --mode append --format json
check_output "valid comment type global" "commentList" $DWS doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --type global --format json
check_output "valid comment type inline" "commentList" $DWS doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --type inline --format json
check_output "valid resolve-status resolved" "commentList" $DWS doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --resolve-status resolved --format json
check_output "valid resolve-status unresolved" "commentList" $DWS doc comment list --node dxXB52LJqnX4ovLvfMoneyXo8qjMp697 --resolve-status unresolved --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Missing Required Params ---"
check_exit_code "doc info missing node exits 3" 3 $DWS doc info --format json
check_exit_code "doc read missing node exits 3" 3 $DWS doc read --format json
check_exit_code "doc create missing name exits 3" 3 $DWS doc create --format json
check_exit_code "doc update missing node exits 3" 3 $DWS doc update --content "x" --format json
check_exit_code "doc file create missing name exits 3" 3 $DWS doc file create --type adoc --format json
check_exit_code "doc file create missing type exits 3" 3 $DWS doc file create --name "X" --format json
check_exit_code "doc block insert missing node exits 3" 3 $DWS doc block insert --element '{}' --format json
check_exit_code "doc rename missing node exits 3" 3 $DWS doc rename --name "X" --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Not Found ---"
check_output "doc info nonexistent node" "未找到" $DWS doc info --node NONEXISTENT --format json
check_output "doc read nonexistent node" "未找到" $DWS doc read --node NONEXISTENT --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Schema Command ---"
check_output "schema returns JSON" "products" $DWS schema --format json

# ──────────────────────────────────────────────────────────
echo ""
echo "--- Mock Reset ---"
$DWS mock-reset >/dev/null 2>&1
check_output "post-reset doc list" "success" $DWS doc list --workspace Y7kmbeElo8lkqXLq --format json
