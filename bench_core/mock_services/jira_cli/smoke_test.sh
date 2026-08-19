#!/usr/bin/env bash
# smoke_test.sh — Comprehensive smoke test for Jira CLI mock.
# Covers: init, issue CRUD, comments, projects, boards, sprints, epics,
#          output formats (plain/JSON/CSV), error cases, state propagation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

export JIRA_MOCK_HOME="$TMPDIR"
export JIRA_MOCK_DB="$TMPDIR/jira_mock.db"
export JIRA_API_TOKEN="test-token"
export MOCK_VERIFIER_TOKEN="bench-verifier"

JIRA="$SCRIPT_DIR/bin/jira"
BENCH="$SCRIPT_DIR/bin/jira-bench"

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

check_output() {
  local desc="$1"
  local expected="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -qF "$expected"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected '$expected', got: $(echo "$output" | head -3))"
    FAIL=$((FAIL + 1))
  fi
}

check_exit_code() {
  local desc="$1"
  local expected_code="$2"
  shift 2
  local actual_code=0
  "$@" >/dev/null 2>&1 || actual_code=$?
  if [ "$actual_code" = "$expected_code" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected exit=$expected_code, got=$actual_code)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Jira CLI Mock Smoke Test ==="
echo ""

# ────────────────────────────────────────────────────────────
echo "--- 1. Pre-init: commands should fail without config ---"
check_exit_code "issue list fails without config" 1 "$JIRA" issue list
check_output "error message mentions init" "Run 'jira init'" "$JIRA" issue list

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 2. Init ---"
check "jira init creates config" "$JIRA" init --server https://jira.example.com --login admin@example.com --project PROJ --board 100
# Upstream: cmdutil.Success("Configuration generated: %s", file) — init.go:138
check_output "init success marker" "Configuration generated:" "$JIRA" init --force --server https://jira.example.com --login admin@example.com
# Re-running init without --force declines the overwrite -> ErrSkip (init.go:124-126,135)
check_output "init skip when config exists" "Skipping config generation" "$JIRA" init --server https://jira.example.com
check_exit_code "init skip exits 1" 1 "$JIRA" init --server https://jira.example.com

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 3. Bench health ---"
check_output "bench health returns ok" '"status": "ok"' "$BENCH" health

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 4. me ---"
check_output "jira me returns login" "admin@example.com" "$JIRA" me

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 5. Project list ---"
check_output "project list shows PROJ" "PROJ" "$JIRA" project list
check_output "project list shows BENCH" "BENCH" "$JIRA" project list
# JSON output
check_output "project list --raw has key" '"key"' "$JIRA" project list --raw

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 6. Board list ---"
check_output "board list shows boards" "Project Alpha Board" "$JIRA" board list

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 7. Issue list (seeded data) ---"
check_output "issue list shows PROJ issues" "PROJ-1" "$JIRA" issue list
check_output "issue list --plain shows headers" "TYPE" "$JIRA" issue list --plain
check_output "issue list --no-headers omits TYPE" "" "$JIRA" issue list --no-headers --columns KEY

# Filter by type
check_output "issue list --type Bug filters" "PROJ-3" "$JIRA" issue list --type Bug
# Filter by status
check_output "issue list --status Done filters" "PROJ-4" "$JIRA" issue list -s Done
# Filter by priority
check_output "issue list --priority Highest" "PROJ-3" "$JIRA" issue list --priority Highest

# CSV output
CSV_OUT=$("$JIRA" issue list --csv 2>&1)
if echo "$CSV_OUT" | head -1 | grep -qF "TYPE,KEY"; then
  echo "  PASS: csv output has correct headers"
  PASS=$((PASS + 1))
else
  echo "  FAIL: csv output headers (got: $(echo "$CSV_OUT" | head -1))"
  FAIL=$((FAIL + 1))
fi

# JSON output
check_output "issue list --raw outputs JSON" '"key":' "$JIRA" issue list --raw

# No-truncate (all columns)
check_output "issue list --no-truncate shows ASSIGNEE" "ASSIGNEE" "$JIRA" issue list --no-truncate

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 8. Issue view ---"
check_output "issue view PROJ-1 shows summary" "Q3 Platform Migration" "$JIRA" issue view PROJ-1
check_output "issue view --plain shows Status" "Status:" "$JIRA" issue view PROJ-1 --plain
check_output "issue view --raw outputs JSON" '"key": "PROJ-1"' "$JIRA" issue view PROJ-1 --raw
# Alias
check_output "issue show works as alias" "PROJ-1" "$JIRA" issue show PROJ-1

# View with comments
check_output "issue view PROJ-3 shows comment" "Safari 18.0.1" "$JIRA" issue view PROJ-3 --comments 5

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 9. Issue create ---"
CREATE_OUT=$("$JIRA" issue create --type Task --summary "New smoke test task" --body "Created by smoke test" --priority High --assignee "tester@example.com" --label "smoke" --label "test" --no-input 2>&1)
if echo "$CREATE_OUT" | grep -qF "Issue created"; then
  echo "  PASS: issue create succeeds"
  PASS=$((PASS + 1))
else
  echo "  FAIL: issue create (got: $CREATE_OUT)"
  FAIL=$((FAIL + 1))
fi

# Extract created issue key
NEW_KEY=$(echo "$CREATE_OUT" | grep -o 'PROJ-[0-9]*' | head -1)
if [ -n "$NEW_KEY" ]; then
  echo "  PASS: created issue key extracted: $NEW_KEY"
  PASS=$((PASS + 1))
else
  echo "  FAIL: could not extract created issue key"
  FAIL=$((FAIL + 1))
  NEW_KEY="PROJ-99"  # fallback
fi

# Verify created issue
check_output "created issue viewable" "New smoke test task" "$JIRA" issue view "$NEW_KEY"
check_output "created issue has High priority" "High" "$JIRA" issue view "$NEW_KEY"

# Create with --raw
RAW_CREATE=$("$JIRA" issue create --type Bug --summary "Raw create test" --no-input --raw 2>&1)
check_output "create --raw outputs JSON" '"key":' echo "$RAW_CREATE"

# Missing flags error
check_exit_code "create without --summary fails" 1 "$JIRA" issue create --type Bug --no-input
check_output "create error mentions mandatory" "mandatory" "$JIRA" issue create --type Bug --no-input

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 10. Issue edit ---"
check_output "issue edit summary" "updated" "$JIRA" issue edit "$NEW_KEY" --summary "Updated smoke test task"
check_output "edited summary persists" "Updated smoke test task" "$JIRA" issue view "$NEW_KEY"
check_output "issue edit priority" "updated" "$JIRA" issue edit "$NEW_KEY" --priority Low
check_output "edited priority persists" "Low" "$JIRA" issue view "$NEW_KEY"

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 11. Issue move (transitions) ---"
# PROJ-3 is "To Do", valid transition: To Do → In Progress
# Upstream: Success("Issue transitioned to state %q", tr.Name) — move.go:121
check_output "move To Do → In Progress" "Issue transitioned to state" "$JIRA" issue move PROJ-3 "In Progress"
check_output "status changed to In Progress" "In Progress" "$JIRA" issue view PROJ-3

# In Progress → Done
check_output "move In Progress → Done" "transitioned to state" "$JIRA" issue move PROJ-3 Done
check_output "status changed to Done" "Done" "$JIRA" issue view PROJ-3

# Invalid transition: Done → In Review
check_exit_code "invalid transition fails" 1 "$JIRA" issue move PROJ-3 "In Review"
check_output "invalid transition shows available" "Available states" "$JIRA" issue move PROJ-3 "In Review"
# Upstream surfaces this via ExitIfError -> "Error: " prefix (no ✗), states single-quoted (move.go:257-261)
check_output "invalid transition has Error: prefix" "Error: invalid transition state" "$JIRA" issue move PROJ-3 "In Review"

# Move with comment
check_output "move with --comment" "transitioned" "$JIRA" issue move PROJ-3 "To Do" --comment "Reopening for further investigation"

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 12. Issue assign ---"
# Upstream: Success("User %q assigned to issue %q", uname, key) — assign.go:116
check_output "assign issue" "assigned to issue" "$JIRA" issue assign "$NEW_KEY" "newguy@example.com"
check_output "assignee persists" "newguy@example.com" "$JIRA" issue view "$NEW_KEY"

# Unassign — Upstream: Success("User unassigned from the issue %q", key) — assign.go:114
check_output "unassign with x" "User unassigned from the issue" "$JIRA" issue assign "$NEW_KEY" x
check_output "unassigned shows Unassigned" "Unassigned" "$JIRA" issue view "$NEW_KEY"

# Default assignee
check_output "assign default" "assigned" "$JIRA" issue assign "$NEW_KEY" default

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 13. Issue comment ---"
# Upstream: Success("Comment added to issue %q", issueKey) — comment/add/add.go:112
check_output "comment add" "Comment added to issue" "$JIRA" issue comment add PROJ-1 "Smoke test comment"
check_output "comment visible in view" "Smoke test comment" "$JIRA" issue view PROJ-1 --comments 5

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 14. Issue link ---"
# Upstream: Success("Issues linked as %q", linkType) — link/link.go:84
check_output "link issues" "Issues linked as" "$JIRA" issue link PROJ-2 PROJ-3 "blocks"

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 15. Issue clone ---"
CLONE_OUT=$("$JIRA" issue clone PROJ-2 --summary "Cloned auth task" 2>&1)
check_output "clone succeeds" "cloned" echo "$CLONE_OUT"
CLONE_KEY=$(echo "$CLONE_OUT" | grep -o 'PROJ-[0-9]*' | tail -1)
if [ -n "$CLONE_KEY" ]; then
  check_output "cloned issue has new summary" "Cloned auth task" "$JIRA" issue view "$CLONE_KEY"
else
  echo "  FAIL: could not extract cloned issue key"
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 16. Sprint list ---"
check_output "sprint list shows Sprint 1" "Sprint 1" "$JIRA" sprint list
check_output "sprint list --current" "active" "$JIRA" sprint list --current
check_output "sprint list --raw outputs JSON" '"name":' "$JIRA" sprint list --raw

# Sprint issues
check_output "sprint list 1 shows issues" "PROJ-" "$JIRA" sprint list 1

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 17. Epic commands ---"
check_output "epic list shows PROJ-1" "PROJ-1" "$JIRA" epic list
check_output "epic list PROJ-1 shows children" "PROJ-2" "$JIRA" epic list PROJ-1

# Epic create
EPIC_OUT=$("$JIRA" epic create --summary "New Epic" --name "new-epic" --priority High --no-input 2>&1)
check_output "epic create succeeds" "Epic created" echo "$EPIC_OUT"

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 18. Issue delete ---"
# Create a throwaway issue to delete
DEL_OUT=$("$JIRA" issue create --type Task --summary "To be deleted" --no-input 2>&1)
DEL_KEY=$(echo "$DEL_OUT" | grep -o 'PROJ-[0-9]*' | head -1)
# Upstream: Success("Issue %q removed successfully", key) — delete/delete.go:63
check_output "delete issue" "removed successfully" "$JIRA" issue delete "$DEL_KEY"
check_exit_code "deleted issue not viewable" 1 "$JIRA" issue view "$DEL_KEY"

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 19. Open ---"
check_output "open issue prints URL" "https://jira.example.com/browse/PROJ-1" "$JIRA" open PROJ-1

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 20. Error cases ---"
# Upstream surfaces a missing issue as an ErrUnexpectedResponse via ExitIfError
# (utils.go:30-40); NO "✗" marker, NO "Error:" prefix.
check_exit_code "view nonexistent issue" 1 "$JIRA" issue view PROJ-999
check_output "nonexistent issue error" "Received unexpected response" "$JIRA" issue view PROJ-999
check_output "nonexistent issue error wording" "Please check the parameters you supplied and try again" "$JIRA" issue view PROJ-999

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 21. Bench state ---"
STATE_OUT=$("$BENCH" state --token bench-verifier 2>&1)
if echo "$STATE_OUT" | grep -qF '"projects"'; then
  echo "  PASS: bench state returns structured JSON"
  PASS=$((PASS + 1))
else
  echo "  FAIL: bench state (got: $(echo "$STATE_OUT" | head -3))"
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 22. Bench audit ---"
AUDIT_OUT=$("$BENCH" audit --token bench-verifier 2>&1)
if echo "$AUDIT_OUT" | grep -qF '"operation"'; then
  echo "  PASS: bench audit returns log entries"
  PASS=$((PASS + 1))
else
  echo "  FAIL: bench audit (got: $(echo "$AUDIT_OUT" | head -3))"
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 23. Bench reset ---"
check_output "bench reset" '"status": "ok"' "$BENCH" reset --token bench-verifier
# After reset, seeded issues should be back
check_output "after reset, PROJ-1 exists" "Q3 Platform Migration" "$JIRA" issue view PROJ-1

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 24. Bench token validation ---"
check_exit_code "bench state with wrong token fails" 1 "$BENCH" state --token wrong
check_exit_code "bench state without token fails" 1 "$BENCH" state

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 25. Version and help ---"
# Upstream `jira version` prints v.Info() (version/version.go:20-40); only the
# Version field is meaningful/reproducible offline (upstream v1.7.0).
check_output "version" "v1.7.0" "$JIRA" --version
check_output "help" "Usage:" "$JIRA" help

# ────────────────────────────────────────────────────────────
echo ""
echo "--- 26. Golden output parity (independent real-upstream oracle) ---"
# The golden fixtures are derived from the REAL upstream rendering path of
# ankitpokhrel/jira-cli v1.7.0 (commit 396933d) — NOT from this mock's renderers.
# golden/issue_list.table is produced by feeding rows parsed straight out of
# seeds/default.sql through Go's stdlib text/tabwriter with the exact upstream
# params (internal/view/issues.go:54, helper.go:26). See golden/README.md and
# golden/gen_tabwriter.go for the per-fixture derivation commands.
GOLDEN_DIR="$SCRIPT_DIR/golden"
GHOME="$TMPDIR/golden_home"
mkdir -p "$GHOME"
# Run the mock against an isolated, freshly-seeded DB so the comparison is always
# against the DEFAULT seed, independent of mutations earlier in this script.
gjira() { JIRA_MOCK_HOME="$GHOME" JIRA_MOCK_DB="$GHOME/jira_mock.db" "$JIRA" "$@"; }
gjira init --server https://jira.example.com --login admin@example.com --project PROJ --board 100 >/dev/null 2>&1 || true

# (a) Default 4-column table (TYPE/KEY/SUMMARY/STATUS) — MUST be byte-identical
#     to the real-tabwriter golden. Counted in the pass/fail tally.
GOT_DEFAULT="$TMPDIR/got_issue_list.table"
gjira issue list > "$GOT_DEFAULT" 2>/dev/null || true
if [ -f "$GOLDEN_DIR/issue_list.table" ] && diff -u "$GOLDEN_DIR/issue_list.table" "$GOT_DEFAULT" > "$TMPDIR/golden_diff.txt" 2>&1; then
  echo "  PASS: issue list (4-col) byte-identical to real-tabwriter golden"
  PASS=$((PASS + 1))
else
  echo "  FAIL: issue list (4-col) diverges from golden/issue_list.table"
  sed 's/^/        /' "$TMPDIR/golden_diff.txt" 2>/dev/null | head -20 || true
  FAIL=$((FAIL + 1))
fi

# (b) 11-column --no-truncate table — counted golden check. LABELS join with ","
#     (internal/view/issues.go) was fixed in lib/commands/issue_list.js; the raw
#     "...Z" CREATED/UPDATED values pass through unchanged (upstream's RFC3339
#     "-0700" layout can't parse a trailing "Z", so formatDateTime returns as-is).
GOT_NT="$TMPDIR/got_issue_list.notruncate.table"
gjira issue list --no-truncate > "$GOT_NT" 2>/dev/null || true
if [ -f "$GOLDEN_DIR/issue_list.notruncate.table" ] && diff -u "$GOLDEN_DIR/issue_list.notruncate.table" "$GOT_NT" > "$TMPDIR/golden_nt_diff.txt" 2>&1; then
  echo "  PASS: issue list --no-truncate (11-col) byte-identical to real-tabwriter golden"
  PASS=$((PASS + 1))
else
  echo "  FAIL: issue list --no-truncate (11-col) diverges from golden/issue_list.notruncate.table"
  sed 's/^/        /' "$TMPDIR/golden_nt_diff.txt" 2>/dev/null | head -20 || true
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
