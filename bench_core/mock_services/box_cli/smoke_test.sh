#!/usr/bin/env bash
# Smoke test for Box CLI mock
# Exercises all major command groups and output formats
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOX="$SCRIPT_DIR/bin/box"
BOX_BENCH="$SCRIPT_DIR/bin/box-bench"
# bin/box-bench honors MOCK_VERIFIER_TOKEN, defaulting to 'bench-verifier'.
BENCH_TOKEN="${MOCK_VERIFIER_TOKEN:-bench-verifier}"

# Use a temp directory for test state
export BOX_MOCK_HOME="$(mktemp -d)"
trap 'rm -rf "$BOX_MOCK_HOME"' EXIT

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "  PASS  $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $desc"
    echo "        Command: $*"
  fi
}

check_output() {
  local desc="$1"
  local pattern="$2"
  shift 2
  local out
  out=$("$@" 2>&1) || true
  if echo "$out" | grep -qi "$pattern"; then
    PASS=$((PASS + 1))
    echo "  PASS  $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $desc"
    echo "        Expected pattern: $pattern"
    echo "        Got: $(echo "$out" | head -5)"
  fi
}

check_exit_code() {
  local desc="$1"
  local expected_code="$2"
  shift 2
  local actual_code=0
  "$@" > /dev/null 2>&1 || actual_code=$?
  if [ "$actual_code" = "$expected_code" ]; then
    PASS=$((PASS + 1))
    echo "  PASS  $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $desc (expected exit $expected_code, got $actual_code)"
  fi
}

# Golden-output oracle. Runs the mock in NON-TTY (stdout redirected to a file →
# chalk/the mock auto-disable color → plain output) against a PRISTINE, ISOLATED
# seed (its own throwaway BOX_MOCK_HOME, so the golden entities are never touched
# by the state mutations elsewhere in this script), then diffs the mock's stdout
# BYTE-FOR-BYTE against a committed golden file.
#
# The golden files are produced by `bun golden/gen_golden.mjs`, which renders with
# the REAL js-yaml library (`yaml.dump(..., {indent:4, noRefs:true})`) + the
# documented upstream key transform — it does NOT import the mock's
# lib/output/text.js. So the authority is real js-yaml, not the mock renderer:
# any drift in the mock's text/json renderer (hand-rolled YAML, wrong indent,
# broken key mapping, mangled null/[]/nested collections, trailing-newline
# changes) fails here. Regenerate after a deliberate seed/schema change with
# `bun golden/gen_golden.mjs` (see golden/README.md). Each diff is one honest check.
GOLDEN_DIR="$SCRIPT_DIR/golden"
check_golden() {
  local desc="$1"
  local golden="$2"
  shift 2
  local tmp_home tmp_out
  tmp_home="$(mktemp -d)"
  tmp_out="$(mktemp)"
  # Per-invocation BOX_MOCK_HOME override → fresh default seed, plain (non-TTY) output.
  BOX_MOCK_HOME="$tmp_home" "$@" > "$tmp_out" 2>/dev/null || true
  if diff "$GOLDEN_DIR/$golden" "$tmp_out" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "  PASS  $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $desc"
    echo "        golden: $GOLDEN_DIR/$golden  (regenerate: bun golden/gen_golden.mjs)"
    echo "        diff (< golden | > mock):"
    diff "$GOLDEN_DIR/$golden" "$tmp_out" 2>&1 | head -20 | sed 's/^/        /'
  fi
  rm -rf "$tmp_home" "$tmp_out"
}

echo "=== Box CLI Mock Smoke Test ==="
echo ""

# ──────────────────────────────────────
echo "--- Health Check ---"
check "bench health" "$BOX_BENCH" health
check_output "bench health returns ok" "ok" "$BOX_BENCH" health

# ──────────────────────────────────────
echo ""
echo "--- Login / Logout ---"
check "login" "$BOX" login
# Real upstream prints "Successfully logged in as <login>!" to stderr (src/commands/login.js:372).
check_output "login shows real success banner" "Successfully logged in as" "$BOX" login

# ──────────────────────────────────────
echo ""
echo "--- Users ---"
check_output "users:get me" "Admin User" "$BOX" users:get
check_output "users:list" "alice" "$BOX" users:list
check_output "users:list --json" '"type": "user"' "$BOX" users:list --json
check_output "users:list --csv" "type,id,name" "$BOX" users:list --csv

# ──────────────────────────────────────
echo ""
echo "--- Folders ---"
check_output "folders:get 0 (root)" "All Files" "$BOX" folders:get 0
check_output "folders:get 0 --json" '"name": "All Files"' "$BOX" folders:get 0 --json
check_output "folders:items 0" "Project Alpha" "$BOX" folders:items 0

# Create a folder
FOLDER_ID=$("$BOX" folders:create 0 "Test Folder" --id-only 2>&1)
check_output "folders:create" "Test Folder" "$BOX" folders:get "$FOLDER_ID"

# Update folder
check_output "folders:update --name" "Renamed Folder" "$BOX" folders:update "$FOLDER_ID" --name "Renamed Folder"
check_output "folders:update --description" "A test description" "$BOX" folders:update "$FOLDER_ID" --description "A test description"

# Copy folder
COPIED_FOLDER_ID=$("$BOX" folders:copy "$FOLDER_ID" 0 --name "Copied Folder" --id-only 2>&1)
check_output "folders:copy" "Copied Folder" "$BOX" folders:get "$COPIED_FOLDER_ID"

# Move folder
check "folders:move" "$BOX" folders:move "$COPIED_FOLDER_ID" 20001

# ──────────────────────────────────────
echo ""
echo "--- Files ---"

# Create a temp file for upload
TMPFILE="$(mktemp)"
echo "Hello Box Mock World" > "$TMPFILE"

# Upload
UPLOADED_ID=$("$BOX" files:upload "$TMPFILE" --parent-id "$FOLDER_ID" --name "test-upload.txt" --id-only 2>&1)
check_output "files:upload" "test-upload.txt" "$BOX" files:get "$UPLOADED_ID"

# Get file
check_output "files:get" "test-upload.txt" "$BOX" files:get "$UPLOADED_ID"
check_output "files:get --json" '"type": "file"' "$BOX" files:get "$UPLOADED_ID" --json

# Update file
check_output "files:update --name" "renamed-upload.txt" "$BOX" files:update "$UPLOADED_ID" --name "renamed-upload.txt"
check_output "files:update --description" "My test file" "$BOX" files:update "$UPLOADED_ID" --description "My test file"
check_output "files:update --tags" "test" "$BOX" files:update "$UPLOADED_ID" --tags "test,upload"

# Copy file
COPIED_FILE_ID=$("$BOX" files:copy "$UPLOADED_ID" 0 --name "copied-upload.txt" --id-only 2>&1)
check_output "files:copy" "copied-upload.txt" "$BOX" files:get "$COPIED_FILE_ID"

# Move file
check "files:move" "$BOX" files:move "$COPIED_FILE_ID" 20001

# Download file
DOWNLOAD_DIR="$(mktemp -d)"
check_output "files:download" "downloaded" "$BOX" files:download "$UPLOADED_ID" --destination "$DOWNLOAD_DIR"
check_output "download content correct" "Hello Box Mock World" cat "$DOWNLOAD_DIR/renamed-upload.txt"
rm -rf "$DOWNLOAD_DIR"

# File comments
check_output "files:comments" "comment" "$BOX" files:comments 30001
check_output "files:comments --json" '"type": "comment"' "$BOX" files:comments 30001 --json
check_output "files:tasks" "Review and sign off" "$BOX" files:tasks 30001
check_output "files:tasks --json" '"type": "task"' "$BOX" files:tasks 30001 --json
check_output "files:tasks:list alias" "Review and sign off" "$BOX" files:tasks:list 30001
check "files:tasks empty list" bash -c "\"$BOX\" files:tasks 30003 --json | grep -q '^\\[\\]$'"

# ──────────────────────────────────────
echo ""
echo "--- Search ---"
check_output "search by name" "Budget" "$BOX" search "Budget"
check_output "search --type file" "file" "$BOX" search "Report" --type file
check_output "search --json" '"type":' "$BOX" search "Project" --json

# ──────────────────────────────────────
echo ""
echo "--- Comments ---"
COMMENT_ID=$("$BOX" comments:create "$UPLOADED_ID" --message "Great file!" --json 2>&1 | grep '"id"' | head -1 | sed 's/.*: "//;s/".*//')
check_output "comments:create" "Great file" "$BOX" comments:get "$COMMENT_ID"
check_output "comments:get --json" '"type": "comment"' "$BOX" comments:get "$COMMENT_ID" --json
check "comments:delete" "$BOX" comments:delete "$COMMENT_ID"

# ──────────────────────────────────────
echo ""
echo "--- Collaborations ---"
COLLAB_ID=$("$BOX" collaborations:create "$FOLDER_ID" folder --role viewer --user-id 10003 --json 2>&1 | grep '"id"' | head -1 | sed 's/.*: "//;s/".*//')
check_output "collaborations:create" "viewer" "$BOX" collaborations:get "$COLLAB_ID"
check "collaborations:delete" "$BOX" collaborations:delete "$COLLAB_ID"

# ──────────────────────────────────────
echo ""
echo "--- Shared Links ---"
check_output "shared-links:create" "boxmock.box.com" "$BOX" shared-links:create "$UPLOADED_ID" file --access open
check "shared-links:delete" "$BOX" shared-links:delete "$UPLOADED_ID" file

# ──────────────────────────────────────
echo ""
echo "--- Tasks ---"
TASK_ID=$("$BOX" tasks:create "$UPLOADED_ID" --message "Review this file" --due-at "2026-07-01T00:00:00Z" --json 2>&1 | grep '"id"' | head -1 | sed 's/.*: "//;s/".*//')
check_output "tasks:create" "Review this file" "$BOX" tasks:get "$TASK_ID"
check_output "tasks:update" "Updated message" "$BOX" tasks:update "$TASK_ID" --message "Updated message"
check "tasks:delete" "$BOX" tasks:delete "$TASK_ID"

# ──────────────────────────────────────
echo ""
echo "--- Trash ---"

# Delete a file (move to trash)
"$BOX" files:delete "$COPIED_FILE_ID" > /dev/null 2>&1
check_output "trash list shows trashed file" "$COPIED_FILE_ID" "$BOX" trash --json

# Restore from trash
check_output "trash:restore" "$COPIED_FILE_ID" "$BOX" trash:restore file "$COPIED_FILE_ID" --json

# Delete again and permanently delete
"$BOX" files:delete "$COPIED_FILE_ID" > /dev/null 2>&1
check "trash:delete" "$BOX" trash:delete file "$COPIED_FILE_ID"

# ──────────────────────────────────────
echo ""
echo "--- Error Cases (upstream-verbatim / SDK / oclif wording) ---"
# Verbatim upstream string (src/commands/folders/delete.js:11-13)
check_exit_code "delete root folder returns error" 2 "$BOX" folders:delete 0
check_output "delete root folder error message" "Cannot delete folder '0': this is the root (All Files) folder and cannot be deleted." "$BOX" folders:delete 0

# Verbatim upstream string (src/commands/files/upload.js:20-21)
check_exit_code "upload non-existent file" 2 "$BOX" files:upload /nonexistent/path/file.txt
check_output "upload non-existent file error message" "File not found: /nonexistent/path/file.txt. Please check the file path and try again." "$BOX" files:upload /nonexistent/path/file.txt

# SDK 404 surfaced via box-command.js:1692 template (request_id varies)
check_exit_code "get non-existent file" 2 "$BOX" files:get 99999999
check_output "get non-existent file -> SDK 404 format" "Unexpected API Response \[404 Not Found |" "$BOX" files:get 99999999
check_output "get non-existent file -> not_found code" "not_found - Not Found" "$BOX" files:get 99999999

# SDK 409 folder_not_empty (no local check upstream; comes from the API)
check_exit_code "delete non-empty folder without --recursive" 2 "$BOX" folders:delete 20001
check_output "non-empty folder -> 409 folder_not_empty" "folder_not_empty" "$BOX" folders:delete 20001

# oclif closed-set rejections (exit 2) — captured verbatim from @oclif/core@4.8.0
check_exit_code "invalid --role exits 2" 2 "$BOX" collaborations:create 20001 folder --role owner --user-id 10003
check_output "invalid --role oclif wording" "Expected --role=owner to be one of:" "$BOX" collaborations:create 20001 folder --role owner --user-id 10003
check_output "invalid --role NOT accepted (owner removed)" "to be one of: editor, viewer, previewer, uploader, previewer_uploader, viewer_uploader, co-owner" "$BOX" collaborations:create 20001 folder --role owner --user-id 10003
check_exit_code "invalid itemType arg exits 2" 2 "$BOX" shared-links:create 30001 bogus
check_output "invalid itemType oclif wording" "Expected bogus to be one of: file, folder" "$BOX" shared-links:create 30001 bogus
check_exit_code "invalid trash type arg exits 2" 2 "$BOX" trash:delete bogus 123
check_output "invalid trash type allows web_link" "Expected bogus to be one of: file, folder, web_link" "$BOX" trash:delete bogus 123

# oclif missing-required-arg wording
check_output "missing required arg oclif wording" "Missing 1 required arg:" "$BOX" files:get

# --access is NOT validated at the CLI layer upstream (no oclif options): accept any value
check "shared-links:create accepts arbitrary --access (no CLI validation)" "$BOX" shared-links:create 20002 folder --access bogus

# ── Delete/unshare success messages (real CLI prints these to STDERR via this.info) ──
echo ""
echo "--- Success Messages (stderr) ---"
SM_FILE_ID=$("$BOX" files:upload "$TMPFILE" --parent-id "$FOLDER_ID" --name "sm.txt" --id-only 2>&1)
check_output "files:delete prints 'Deleted file <id>'" "Deleted file $SM_FILE_ID" "$BOX" files:delete "$SM_FILE_ID"
SM_COLLAB=$("$BOX" collaborations:create "$FOLDER_ID" folder --role viewer --user-id 10003 --json 2>&1 | grep '"id"' | head -1 | sed 's/.*: "//;s/".*//')
check_output "collaborations:delete prints removal message" "Collaboration $SM_COLLAB successfully removed" "$BOX" collaborations:delete "$SM_COLLAB"
SM_TASK=$("$BOX" tasks:create 30001 --message "x" --json 2>&1 | grep '"id"' | head -1 | sed 's/.*: "//;s/".*//')
check_output "tasks:delete prints success message" "Successfully deleted task $SM_TASK" "$BOX" tasks:delete "$SM_TASK"

# ──────────────────────────────────────
echo ""
echo "--- Output Formats ---"
check_output "text output has Title Case keys" "Type:" "$BOX" files:get 30001
check_output "json output valid JSON" '"type": "file"' "$BOX" files:get 30001 --json
check_output "csv output has header" "type," "$BOX" files:get 30001 --csv

# ──────────────────────────────────────
echo ""
echo "--- Golden Output (independent oracle: real js-yaml, NOT the mock renderer) ---"
# Diffs live mock stdout byte-for-byte against golden/<entity>.{text,json}
# (generated by `bun golden/gen_golden.mjs`; see golden/README.md). Fresh seed
# per check via isolated BOX_MOCK_HOME, so these are deterministic.
check_golden "files:get 30001 (text) == golden"   file-30001.text    "$BOX" files:get 30001
check_golden "files:get 30001 (json) == golden"    file-30001.json    "$BOX" files:get 30001 --json
check_golden "folders:get 20001 (text) == golden"  folder-20001.text  "$BOX" folders:get 20001
check_golden "folders:get 20001 (json) == golden"  folder-20001.json  "$BOX" folders:get 20001 --json
check_golden "users:get (text) == golden"          user-10001.text    "$BOX" users:get
check_golden "users:get (json) == golden"          user-10001.json    "$BOX" users:get --json

# ──────────────────────────────────────
echo ""
echo "--- Bench Control ---"
check_output "bench state" '"users"' "$BOX_BENCH" state --token "$BENCH_TOKEN"
check_output "bench audit" 'operation' "$BOX_BENCH" audit --token "$BENCH_TOKEN"
check "bench reset" "$BOX_BENCH" reset --token "$BENCH_TOKEN"
check_exit_code "bench state without token" 2 "$BOX_BENCH" state --token wrong-token

# ──────────────────────────────────────
echo ""
echo "--- Logout ---"
check_output "logout" "Successfully logged out" "$BOX" logout

# ──────────────────────────────────────
# Clean up
rm -f "$TMPFILE"

echo ""
echo "==================================="
echo "Results: $PASS passed, $FAIL failed"
echo "==================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
